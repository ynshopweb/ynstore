// ============================================================
// AUTH MODULE (CORE)
// ============================================================
// Modul inti autentikasi: listener status login Firebase (real-time,
// termasuk deteksi akun dinonaktifkan admin & perubahan role secara
// live), sinkronisasi profil user ke Firestore, guard verifikasi email
// & role admin, pencatatan Login History, Last Activity, serta kontrol
// shell modal Auth (tab login/daftar, dialog "Login Diperlukan",
// "Email Belum Diverifikasi", "Akun Dinonaktifkan", "Sesi Berakhir").
//
// Form handler LOGIN ada di js/login.js. Form handler REGISTER ada di
// js/register.js. Rendering halaman Profil ada di js/profile.js.
// Login History ada di js/login-logs.js. Manajemen Pengguna (admin)
// ada di js/users-admin.js. Pemisahan ini supaya kode tetap rapi,
// modular, dan tidak duplikat (lihat instruksi optimasi).
// ============================================================
import {
    signOut,
    onAuthStateChanged,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { auth, db, appId } from './config.js';
import { state } from './state.js';
import { writeLoginLog, closeLoginLog } from './login-logs.js';

// --- Menerjemahkan kode error Firebase Auth ke pesan yang mudah dipahami ---
// PENTING: kode error Firebase mentah TIDAK PERNAH ditampilkan ke user.
export function translateAuthError(err) {
    switch (err.code) {
        case 'auth/user-not-found':
            return 'Email belum terdaftar.';
        case 'auth/wrong-password':
            return 'Password yang Anda masukkan salah.';
        case 'auth/invalid-credential':
            return 'Email atau password salah, atau akun belum terdaftar.';
        case 'auth/invalid-email':
            return 'Format email tidak valid.';
        case 'auth/user-disabled':
            return 'Akun ini telah dinonaktifkan oleh admin.';
        case 'auth/email-already-in-use':
            return 'Email sudah terdaftar. Silakan login atau gunakan email lain.';
        case 'auth/weak-password':
            return 'Password minimal 6 karakter.';
        case 'auth/too-many-requests':
            return 'Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.';
        case 'auth/network-request-failed':
            return 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.';
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return 'Proses login Google dibatalkan.';
        default:
            return 'Terjadi kesalahan saat autentikasi. Silakan coba lagi.';
    }
}

// --- Tampilkan/sembunyikan alert box error di dalam form login/register ---
export function showAuthError(formType, message) {
    const box = document.getElementById(`${formType}-error-alert`);
    const text = document.getElementById(`${formType}-error-text`);
    if (box && text) {
        text.textContent = message;
        box.classList.remove('hidden');
    }
}

export function hideAuthError(formType) {
    const box = document.getElementById(`${formType}-error-alert`);
    if (box) box.classList.add('hidden');
}

// --- SINKRONISASI DOKUMEN PROFIL USER DI FIRESTORE ---
// Dipanggil setiap kali login berhasil (Email/Password maupun Google).
// - Jika dokumen profil belum ada -> buat baru (mis. first-time Google
//   Sign-In) dengan role default 'customer' & status 'active'.
// - Jika sudah ada -> hanya update lastLogin + emailVerified (mirror
//   dari status verifikasi Auth yang sedang berjalan), data lain
//   (nama, role, status, dll) TIDAK ditimpa supaya perubahan admin
//   (mis. menonaktifkan akun / naikkan role) tetap awet.
export async function syncUserProfileOnLogin(user, extra = {}) {
    const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    const snap = await getDoc(ref);

    if (snap.exists()) {
        await updateDoc(ref, {
            lastLogin: Date.now(),
            emailVerified: !!user.emailVerified
        });
        return { ...snap.data(), lastLogin: Date.now(), emailVerified: !!user.emailVerified };
    }

    const profileData = {
        uid: user.uid,
        nama: extra.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Pelanggan'),
        email: user.email || '',
        noHp: extra.phone || '',
        provider: extra.provider || 'password',
        role: 'customer',
        status: 'active',
        emailVerified: !!user.emailVerified,
        createdAt: Date.now(),
        lastLogin: Date.now()
    };
    await setDoc(ref, profileData);
    return profileData;
}

// --- LAST ACTIVITY ---
// Dipanggil di setiap aktivitas penting: Login, Logout, Checkout, dll
// (lihat pemanggilnya di login.js, register.js, checkout.js, dan
// handleLogout di bawah). Memakai server timestamp sesuai instruksi.
export async function touchLastActivity(uid) {
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data'), {
            lastActivity: serverTimestamp()
        });
    } catch (_) {
        // Non-fatal — kegagalan mencatat last activity tidak boleh
        // menghalangi alur utama (login/logout/checkout tetap lanjut).
    }
}

// --- FINALISASI LOGIN BERHASIL (dipakai bersama oleh login.js) ---
// Satu titik terpusat supaya logika ini TIDAK diduplikasi antara alur
// Login Email dan Login Google:
//   1. Sinkron profil Firestore (buat baru / update lastLogin).
//   2. Guard status akun -> jika 'disabled', paksa logout & tampilkan
//      pesan, kembalikan null (pemanggil harus berhenti di sini).
//   3. Catat Login History + set Last Activity.
export async function finalizeSuccessfulLogin(user, extra = {}) {
    const profileData = await syncUserProfileOnLogin(user, extra);

    if (profileData.status === 'disabled') {
        await forceLogoutDisabledAccount();
        return null;
    }

    try {
        const logId = await writeLoginLog(user, profileData, extra.provider || profileData.provider);
        currentLoginLogId = logId;
    } catch (e) {
        console.error('Gagal mencatat login_logs:', e);
    }
    await touchLastActivity(user.uid);

    return profileData;
}

// --- REDIRECT SETELAH LOGIN BERHASIL (dipakai login.js & register.js) ---
export function handlePostLoginRedirect(role) {
    const redirectTarget = (state && state.pendingRedirect) || window.pendingRedirect;
    if (state) state.pendingRedirect = null;
    window.pendingRedirect = null;

    if (redirectTarget === 'checkout') {
        if (typeof window.toggleCartDrawer === 'function') {
            window.toggleCartDrawer(true);
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan lanjutkan checkout dari Keranjang Anda.', 'success');
        }
    } else if (role === 'admin') {
        if (typeof window.switchToViewMode === 'function') {
            window.switchToViewMode('admin');
        }
    }
}

// ================= FLAGS INTERNAL SESI =================
// Membedakan penyebab user menjadi "logged out" di listener
// onAuthStateChanged: logout manual, dipaksa karena akun dinonaktifkan,
// atau sesi berakhir tanpa sebab eksplisit (token invalid/logout dari
// perangkat lain) -> masing-masing menampilkan dialog yang berbeda.
let isExplicitLogout = false;
let isForcedDisableLogout = false;
let currentLoginLogId = null;
let profileUnsubscribe = null;

async function forceLogoutDisabledAccount() {
    isForcedDisableLogout = true;
    if (currentLoginLogId) {
        await closeLoginLog(currentLoginLogId);
        currentLoginLogId = null;
    }
    try { await signOut(auth); } catch (_) {}
    window.closeAuthModal();
    window.showAccountDisabledModal();
}

// ================= LISTENER STATUS LOGIN (Firebase) =================
onAuthStateChanged(auth, async (user) => {
    const hadSession = !!state.user;
    state.user = user;

    // Listener profil sebelumnya (jika ada) harus dihentikan dulu
    // setiap kali status auth berubah, supaya tidak menumpuk listener.
    if (profileUnsubscribe) {
        profileUnsubscribe();
        profileUnsubscribe = null;
    }

    const navName = document.getElementById('user-nav-name');
    const authLinksGuest = document.getElementById('auth-links-guest');
    const authLinksLogged = document.getElementById('auth-links-logged');
    const adminMenuLink = document.getElementById('admin-menu-link');

    if (user) {
        const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');

        // --- LISTENER REAL-TIME PADA DOKUMEN PROFIL SENDIRI ---
        // Dipakai supaya perubahan yang dilakukan ADMIN saat user sedang
        // aktif (menonaktifkan akun / mengubah role) langsung terdeteksi
        // tanpa perlu reload halaman.
        profileUnsubscribe = onSnapshot(userDocRef, (snap) => {
            let profileData = { nama: user.email ? user.email.split('@')[0] : 'Pelanggan', email: user.email, role: 'customer', status: 'active' };
            if (snap.exists()) {
                profileData = snap.data();
            }
            state.userProfile = profileData;

            // --- GUARD STATUS AKUN (live) ---
            if (profileData.status === 'disabled') {
                forceLogoutDisabledAccount();
                return;
            }

            if (navName) navName.textContent = profileData.nama || 'Pelanggan';

            const dropName = document.getElementById('dropdown-user-name');
            const dropEmail = document.getElementById('dropdown-user-email');
            if (dropName) dropName.textContent = profileData.nama || 'Pelanggan';
            if (dropEmail) dropEmail.textContent = profileData.email || user.email;

            if (authLinksGuest) authLinksGuest.classList.add('hidden');
            if (authLinksLogged) authLinksLogged.classList.remove('hidden');

            if (adminMenuLink) {
                adminMenuLink.classList.toggle('hidden', profileData.role !== 'admin');
            }

            if (typeof window.renderProfilePageInfo === 'function') {
                window.renderProfilePageInfo(profileData, user);
            }
            if (typeof window.renderAdminUsersTable === 'function' && state.viewMode === 'admin') {
                window.renderAdminUsersTable();
            }

            // Pre-fill checkout form jika user sudah login
            const chkName = document.getElementById('checkout-name');
            const chkEmail = document.getElementById('checkout-email');
            const chkPhone = document.getElementById('checkout-phone');
            if (chkName) chkName.value = profileData.nama || '';
            if (chkEmail) chkEmail.value = profileData.email || user.email || '';
            if (chkPhone) chkPhone.value = profileData.noHp || '';
        }, (err) => {
            console.error('Error listening to user profile:', err);
        });

    } else {
        state.userProfile = null;
        if (navName) navName.textContent = 'Tamu';

        const dropName = document.getElementById('dropdown-user-name');
        const dropEmail = document.getElementById('dropdown-user-email');
        if (dropName) dropName.textContent = 'Belum Login';
        if (dropEmail) dropEmail.textContent = 'Silakan masuk ke akun Anda';

        if (authLinksGuest) authLinksGuest.classList.remove('hidden');
        if (authLinksLogged) authLinksLogged.classList.add('hidden');
        if (adminMenuLink) adminMenuLink.classList.add('hidden');

        // --- DETEKSI SESI BERAKHIR TANPA SEBAB EKSPLISIT ---
        // Hanya tampil jika sebelumnya user memang sedang login (hadSession)
        // DAN transisi ini bukan karena user klik Logout, dan bukan karena
        // akun baru saja dipaksa keluar oleh guard status disabled (dialog
        // "Akun Dinonaktifkan" sudah menjelaskan sebabnya secara spesifik).
        if (hadSession && !isExplicitLogout && !isForcedDisableLogout) {
            window.showSessionExpiredModal();
        }
        isExplicitLogout = false;
        isForcedDisableLogout = false;
        currentLoginLogId = null;
    }
});

// ================= DIALOG "LOGIN DIPERLUKAN" (Intercept Checkout) =================
window.showLoginRequiredModal = function() {
    const modal = document.getElementById('login-required-modal');
    if (modal) {
        modal.classList.remove('hidden');
    } else {
        if (confirm("Untuk melanjutkan checkout, silakan login terlebih dahulu. Buka halaman login?")) {
            window.redirectToLoginFromCheckout();
        }
    }
};

window.closeLoginRequiredModal = function() {
    const modal = document.getElementById('login-required-modal');
    if (modal) modal.classList.add('hidden');
};

window.redirectToLoginFromCheckout = function() {
    if (state) state.pendingRedirect = 'checkout';
    window.pendingRedirect = 'checkout';
    window.closeLoginRequiredModal();
    window.openAuthModal('login');
};

window.redirectToRegisterFromCheckout = function() {
    if (state) state.pendingRedirect = 'checkout';
    window.pendingRedirect = 'checkout';
    window.closeLoginRequiredModal();
    window.openAuthModal('register');
};

// ================= SHELL MODAL AUTH (tab Login/Daftar) =================
window.openAuthModal = function(tab = 'login') {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('hidden');
    window.switchAuthTab(tab);
};

window.closeAuthModal = function() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
};

window.switchAuthTab = function(tab) {
    hideAuthError('login');
    hideAuthError('register');
    const loginForm = document.getElementById('modal-login-form');
    const regForm = document.getElementById('modal-register-form');
    const successScreen = document.getElementById('register-success-screen');
    const btnLogin = document.getElementById('auth-tab-btn-login');
    const btnReg = document.getElementById('auth-tab-btn-register');
    const tabsWrap = document.getElementById('auth-modal-tabs');

    // Membuka tab Login/Daftar selalu menutup layar sukses registrasi
    if (successScreen) successScreen.classList.add('hidden');
    if (tabsWrap) tabsWrap.classList.remove('hidden');

    if (tab === 'login') {
        if (loginForm) loginForm.classList.remove('hidden');
        if (regForm) regForm.classList.add('hidden');
        if (btnLogin) btnLogin.className = 'flex-1 pb-3 border-b-2 border-brand-600 text-brand-600 transition font-bold';
        if (btnReg) btnReg.className = 'flex-1 pb-3 border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition font-bold';
    } else {
        if (loginForm) loginForm.classList.add('hidden');
        if (regForm) regForm.classList.remove('hidden');
        if (btnReg) btnReg.className = 'flex-1 pb-3 border-b-2 border-brand-600 text-brand-600 transition font-bold';
        if (btnLogin) btnLogin.className = 'flex-1 pb-3 border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition font-bold';
    }
};

// ================= DIALOG "EMAIL BELUM DIVERIFIKASI" =================
window.showEmailUnverifiedModal = function(email) {
    const modal = document.getElementById('email-unverified-modal');
    const emailLabel = document.getElementById('email-unverified-address');
    if (emailLabel) emailLabel.textContent = email || '';
    if (modal) modal.classList.remove('hidden');
};

window.closeEmailUnverifiedModal = function() {
    const modal = document.getElementById('email-unverified-modal');
    if (modal) modal.classList.add('hidden');
};

// ================= DIALOG "AKUN DINONAKTIFKAN" =================
window.showAccountDisabledModal = function() {
    const modal = document.getElementById('account-disabled-modal');
    if (modal) modal.classList.remove('hidden');
};

window.closeAccountDisabledModal = function() {
    const modal = document.getElementById('account-disabled-modal');
    if (modal) modal.classList.add('hidden');
};

// ================= DIALOG "SESI BERAKHIR" =================
window.showSessionExpiredModal = function() {
    const modal = document.getElementById('session-expired-modal');
    if (modal) modal.classList.remove('hidden');
};

window.closeSessionExpiredModal = function() {
    const modal = document.getElementById('session-expired-modal');
    if (modal) modal.classList.add('hidden');
};

window.backToLoginFromSessionExpired = function() {
    window.closeSessionExpiredModal();
    window.openAuthModal('login');
};

// ================= KIRIM ULANG EMAIL VERIFIKASI (shared) =================
// Dipakai oleh 3 tempat: layar sukses registrasi, dialog "Email Belum
// Diverifikasi" saat login, dan tombol di halaman Profil. Menyimpan
// referensi user sementara (`pendingUnverifiedUser`) karena user yang
// baru saja register/login-tapi-belum-verifikasi akan langsung di-signOut
// supaya tidak dianggap sesi aktif, tapi objek user-nya masih dibutuhkan
// untuk memanggil sendEmailVerification().
let pendingUnverifiedUser = null;
let lastResendAt = 0;
const RESEND_COOLDOWN_MS = 60000; // 60 detik, cegah spam kirim ulang

export function setPendingUnverifiedUser(user) {
    pendingUnverifiedUser = user;
}

function startResendCooldownUI() {
    const buttons = document.querySelectorAll('.resend-verif-btn');
    let remaining = Math.ceil(RESEND_COOLDOWN_MS / 1000);
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalLabel = btn.dataset.originalLabel || btn.innerHTML;
    });

    const tick = () => {
        buttons.forEach(btn => {
            btn.innerHTML = `<i class="fa-solid fa-clock me-1"></i> Kirim ulang (${remaining}s)`;
        });
        remaining--;
        if (remaining < 0) {
            clearInterval(interval);
            buttons.forEach(btn => {
                btn.disabled = false;
                btn.innerHTML = btn.dataset.originalLabel;
            });
        }
    };
    tick();
    const interval = setInterval(tick, 1000);
}

window.resendVerificationEmail = async function() {
    const targetUser = pendingUnverifiedUser || auth.currentUser;
    if (!targetUser) {
        window.showToast('Tidak ada sesi untuk mengirim ulang verifikasi. Silakan login/daftar ulang.', 'error');
        return;
    }

    const now = Date.now();
    if (now - lastResendAt < RESEND_COOLDOWN_MS) {
        const remain = Math.ceil((RESEND_COOLDOWN_MS - (now - lastResendAt)) / 1000);
        window.showToast(`Mohon tunggu ${remain} detik sebelum mengirim ulang.`, 'error');
        return;
    }

    try {
        await sendEmailVerification(targetUser);
        lastResendAt = now;
        window.showToast('Email verifikasi telah dikirim ulang. Silakan cek inbox/folder spam Anda.', 'success');
        startResendCooldownUI();
    } catch (err) {
        window.showToast('Gagal mengirim ulang email verifikasi: ' + translateAuthError(err), 'error');
    }
};

// ================= LOGOUT =================
window.handleLogout = async function() {
    try {
        isExplicitLogout = true;

        // Catat Last Activity + Logout Time SEBELUM sesi ditutup
        // (setelah signOut, request.auth sudah null & tidak bisa menulis).
        if (state.user) {
            await touchLastActivity(state.user.uid);
        }
        if (currentLoginLogId) {
            await closeLoginLog(currentLoginLogId);
            currentLoginLogId = null;
        }

        await signOut(auth);
        if (typeof window.showToast === 'function') {
            window.showToast('Anda telah keluar.', 'success');
        }
        if (typeof window.switchToViewMode === 'function') {
            window.switchToViewMode('customer');
        }
    } catch(e) {
        isExplicitLogout = false;
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal logout.', 'error');
        }
    }
};
