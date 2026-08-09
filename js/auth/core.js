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
// SEMUA modul yang berhubungan dengan LOGIN dikumpulkan dalam satu
// folder js/auth/ supaya rapi dan tidak berserakan di js/:
//   js/auth/core.js         <- file ini (inti/shared, dipakai bersama)
//   js/auth/login.js        <- form handler LOGIN CUSTOMER (login.html)
//   js/auth/register.js     <- form handler REGISTER CUSTOMER (login.html)
//   js/auth/admin-login.js  <- form handler LOGIN ADMIN (admin-login.html)
//   js/auth/login-logs.js   <- Login History (dibaca tab Admin > Riwayat Login)
//
// Rendering halaman Profil ada di js/profile.js. Manajemen Pengguna
// (admin) ada di js/users-admin.js — keduanya di luar folder auth/
// karena bukan bagian dari proses LOGIN itu sendiri.
//
// Semua modul di folder auth/ berbagi fungsi inti di file ini
// (translateAuthError, syncUserProfileOnLogin, finalizeSuccessfulLogin,
// isValidAdminProfile, dll) — TIDAK ADA logika autentikasi yang
// ditulis ulang/diduplikasi di modul lain.
// ============================================================
import {
    signOut,
    onAuthStateChanged,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { auth, db, appId } from '../config.js';
import { state } from '../state.js';
import { writeLoginLog, closeLoginLog } from './login-logs.js';

// --- VALIDASI HAK AKSES ADMIN (dipakai bersama: ui.js & js/auth/admin-login.js) ---
// Dipusatkan di sini (bukan diduplikasi di tiap pemanggil) supaya syarat
// "role === 'admin' DAN status === 'active'" konsisten di seluruh app.
//
// CATATAN KEBIJAKAN EMAIL VERIFICATION UNTUK ADMIN:
// Akun Customer (js/auth/login.js) WAJIB emailVerified sebelum bisa login.
// Akun ADMIN internal SENGAJA TIDAK diwajibkan emailVerified di sini —
// akun admin dibuat & dikelola langsung oleh pemilik toko (lewat
// Firebase Console atau Dashboard Manajemen Pengguna), bukan lewat
// formulir pendaftaran publik, sehingga status verifikasi email tidak
// relevan untuk memutuskan hak akses admin. Validasi admin murni
// berdasarkan `role` & `status` dokumen profil Firestore di bawah ini.
export function isValidAdminProfile(profileData) {
    return !!(profileData && profileData.role === 'admin' && profileData.status === 'active');
}

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

    // FIX: isi state.userProfile SEKARANG JUGA (synchronous di titik ini),
    // bukan menunggu listener onSnapshot di bawah yang berjalan async
    // terpisah. Tanpa ini, handlePostLoginRedirect() bisa terpanggil
    // sebelum state.userProfile terisi, sehingga guard admin di
    // switchToViewMode('admin') salah menganggap user bukan admin.
    state.userProfile = profileData;

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
// Dipanggil dari 2 konteks berbeda:
// 1. SPA index.html (quick re-login lewat modal Auth lama, mis. dialog
//    "Sesi Berakhir") -> window.__ynshopSpaContext ditandai oleh
//    js/main.js, jadi perilaku ASLI dipertahankan apa adanya (tidak
//    diubah) supaya fitur yang sudah berjalan tidak berubah.
// 2. Halaman Login Customer terpisah /login (login.html) -> BUKAN SPA,
//    window.__ynshopSpaContext TIDAK ditandai di halaman ini (meskipun
//    login.html tetap meng-import js/ui.js untuk showToast, sehingga
//    window.switchToViewMode ikut terdefinisi di sana juga — INI SEBABNYA
//    kita tidak boleh lagi memakai "typeof window.switchToViewMode"
//    sebagai deteksi SPA, lihat BUG FIX di js/main.js). Login Customer
//    TIDAK PERNAH otomatis membuka Dashboard Admin (lihat instruksi
//    pemisahan: Dashboard Admin hanya boleh diakses lewat /admin-login),
//    jadi di sini kita selalu redirect balik ke toko (index.html), dan
//    jika ada checkout yang tertunda, tandai lewat sessionStorage supaya
//    index.html bisa melanjutkannya setelah reload (lihat js/main.js).
export function handlePostLoginRedirect(role) {
    const redirectTarget = (state && state.pendingRedirect) || window.pendingRedirect;
    if (state) state.pendingRedirect = null;
    window.pendingRedirect = null;

    if (window.__ynshopSpaContext === true) {
        // --- Konteks SPA index.html (perilaku lama, tidak diubah) ---
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
        return;
    }

    // --- Konteks halaman Login Customer terpisah (/login) ---
    if (redirectTarget === 'checkout') {
        try { sessionStorage.setItem('ynshop_pending_redirect', 'checkout'); } catch (_) { /* ignore */ }
    }
    window.location.href = 'index.html';
}

// ================= FLAGS INTERNAL SESI =================
// Membedakan penyebab user menjadi "logged out" di listener
// onAuthStateChanged: logout manual, dipaksa karena akun dinonaktifkan,
// sedang di tengah proses login (lihat penjelasan di bawah), atau sesi
// benar-benar berakhir tanpa sebab eksplisit (token invalid/logout dari
// perangkat lain) -> masing-masing menampilkan dialog yang berbeda
// (atau tidak menampilkan dialog sama sekali).
let isExplicitLogout = false;
let isForcedDisableLogout = false;
let currentLoginLogId = null;
let profileUnsubscribe = null;

// --- BUG FIX: "Sesi Anda sudah habis" muncul saat login admin BERHASIL ---
// Root cause: Firebase Auth bisa mengirim event transisi user -> null
// SESAAT SEBELUM sesi baru benar-benar aktif saat login sedang berjalan
// (mis. dipicu oleh setPersistence() yang dipanggil di awal proses login
// untuk fitur "Ingat Saya"). Event null transien ini BUKAN sesi yang
// benar-benar berakhir, tapi bagian normal dari proses login yang sedang
// berlangsung. Kode lama langsung menampilkan dialog "Sesi Anda sudah
// habis" begitu melihat transisi ke null, tanpa membedakan kasus ini.
//
// Perbaikan (2 lapis):
// 1. `isLoginAttemptInProgress` — flag eksplisit yang di-set true selama
//    login.js/auth/register.js sedang menjalankan proses login/registrasi.
//    Selama flag ini true, transisi null TIDAK PERNAH dianggap sesi habis.
// 2. Debounce — sebagai jaring pengaman tambahan untuk skenario lain di
//    luar proses login manual (mis. refresh token flicker saat browsing),
//    dialog "Sesi Anda sudah habis" tidak langsung ditampilkan begitu ada
//    transisi ke null, melainkan ditunda sebentar; jika user login
//    kembali sebelum jeda itu selesai, dialog dibatalkan (dianggap blip
//    sementara, bukan sesi berakhir sungguhan).
let isLoginAttemptInProgress = false;
let sessionExpiredTimer = null;

export function setLoginAttemptInProgress(value) {
    isLoginAttemptInProgress = value;
}

function scheduleSessionExpiredCheck() {
    cancelPendingSessionExpiredCheck();
    sessionExpiredTimer = setTimeout(() => {
        sessionExpiredTimer = null;
        window.showSessionExpiredModal();
    }, 700);
}

function cancelPendingSessionExpiredCheck() {
    if (sessionExpiredTimer) {
        clearTimeout(sessionExpiredTimer);
        sessionExpiredTimer = null;
    }
}

async function forceLogoutDisabledAccount() {
    isForcedDisableLogout = true;
    cancelPendingSessionExpiredCheck();
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
        // User berhasil (kembali) ter-autentikasi -> batalkan dialog
        // "Sesi Anda sudah habis" yang mungkin sedang tertunda dari
        // transisi null transien sebelumnya (lihat penjelasan di atas).
        cancelPendingSessionExpiredCheck();

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
        // Hanya dipertimbangkan jika sebelumnya user memang sedang login
        // (hadSession), DAN bukan karena klik Logout, DAN bukan karena
        // akun baru saja dipaksa keluar oleh guard status disabled
        // (dialog "Akun Dinonaktifkan" sudah menjelaskan sebabnya secara
        // spesifik), DAN bukan sedang di tengah proses login (lihat
        // penjelasan `isLoginAttemptInProgress` di atas). Dialog ditunda
        // sebentar (debounce) supaya transisi null yang transien/sesaat
        // tidak langsung dianggap sesi benar-benar berakhir.
        if (hadSession && !isExplicitLogout && !isForcedDisableLogout && !isLoginAttemptInProgress) {
            scheduleSessionExpiredCheck();
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

// --- Requirement pemisahan login: entry point checkout guard sekarang
// mengarahkan ke halaman Login Customer terpisah (/login) alih-alih
// membuka modal Auth lama di tempat. Penanda "checkout" disimpan lewat
// sessionStorage (bukan hanya state di memori) karena berpindah halaman
// akan me-reset state JS index.html; login.html & main.js membaca
// penanda ini untuk melanjutkan checkout otomatis setelah login sukses
// (lihat handlePostLoginRedirect() di atas & bootstrapApp() di main.js).
window.redirectToLoginFromCheckout = function() {
    try { sessionStorage.setItem('ynshop_pending_redirect', 'checkout'); } catch (_) { /* ignore */ }
    window.closeLoginRequiredModal();
    window.location.href = 'login.html?redirect=checkout';
};

window.redirectToRegisterFromCheckout = function() {
    try { sessionStorage.setItem('ynshop_pending_redirect', 'checkout'); } catch (_) { /* ignore */ }
    window.closeLoginRequiredModal();
    window.location.href = 'login.html?redirect=checkout&tab=register';
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
