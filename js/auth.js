// ============================================================
// AUTH MODULE
// Login, Register, Logout, listener status login, dan kontrol
// modal auth (tab login/daftar + dialog Login Diperlukan).
// ============================================================
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { auth, db, appId } from './config.js';
import { state } from './state.js';

// Menerjemahkan kode error Firebase Auth ke pesan yang lebih mudah dipahami.
function translateAuthError(err) {
    switch (err.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'Password salah, atau akun dengan email ini belum terdaftar.';
        case 'auth/invalid-email':
            return 'Format email tidak valid.';
        case 'auth/user-disabled':
            return 'Akun ini telah dinonaktifkan oleh admin.';
        case 'auth/email-already-in-use':
            return 'Email ini sudah terdaftar. Silakan masuk lewat tab Login.';
        case 'auth/weak-password':
            return 'Password minimal 6 karakter.';
        case 'auth/too-many-requests':
            return 'Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.';
        case 'auth/network-request-failed':
            return 'Gagal terhubung ke server. Periksa koneksi internet Anda.';
        default:
            return err.message || 'Terjadi kesalahan saat autentikasi.';
    }
}

// Tampilkan/sembunyikan alert box error di dalam form login/register
function showAuthError(formType, message) {
    const box = document.getElementById(`${formType}-error-alert`);
    const text = document.getElementById(`${formType}-error-text`);
    if (box && text) {
        text.textContent = message;
        box.classList.remove('hidden');
    }
}

function hideAuthError(formType) {
    const box = document.getElementById(`${formType}-error-alert`);
    if (box) box.classList.add('hidden');
}

// --- LISTENER STATUS LOGIN (dipanggil otomatis oleh Firebase) ---
onAuthStateChanged(auth, async (user) => {
    state.user = user;
    const navName = document.getElementById('user-nav-name');
    const authLinksGuest = document.getElementById('auth-links-guest');
    const authLinksLogged = document.getElementById('auth-links-logged');
    const adminMenuLink = document.getElementById('admin-menu-link');

    if (user) {
        try {
            const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
            const snap = await getDoc(userDocRef);
            let profileData = { nama: user.email.split('@')[0], email: user.email, role: 'customer' };
            if (snap.exists()) {
                profileData = snap.data();
            } else if (user.email.includes('admin')) {
                profileData.role = 'admin';
            }
            state.userProfile = profileData;

            if (navName) navName.textContent = profileData.nama || 'Pelanggan';
            
            const dropName = document.getElementById('dropdown-user-name');
            const dropEmail = document.getElementById('dropdown-user-email');
            if (dropName) dropName.textContent = profileData.nama || 'Pelanggan';
            if (dropEmail) dropEmail.textContent = profileData.email || user.email;

            if (authLinksGuest) authLinksGuest.classList.add('hidden');
            if (authLinksLogged) authLinksLogged.classList.remove('hidden');

            if (adminMenuLink) {
                if (profileData.role === 'admin' || user.email.includes('admin')) {
                    adminMenuLink.classList.remove('hidden');
                } else {
                    adminMenuLink.classList.add('hidden');
                }
            }

            // Auto populate profile page UI jika elemen tersedia
            const profName = document.getElementById('profile-page-name');
            const profEmail = document.getElementById('profile-page-email');
            if (profName) profName.textContent = profileData.nama || '';
            if (profEmail) profEmail.textContent = profileData.email + (profileData.noHp ? ` | ${profileData.noHp}` : '');

            // Pre-fill checkout form jika user sudah login
            const chkName = document.getElementById('checkout-name');
            const chkEmail = document.getElementById('checkout-email');
            const chkPhone = document.getElementById('checkout-phone');
            if (chkName) chkName.value = profileData.nama || '';
            if (chkEmail) chkEmail.value = profileData.email || user.email || '';
            if (chkPhone) chkPhone.value = profileData.noHp || '';

        } catch (e) {
            console.error("Error fetching user profile:", e);
        }
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
    }
});

// --- DIALOG LOGIN DIPERLUKAN (Interception Checkout) ---
window.showLoginRequiredModal = function() {
    const modal = document.getElementById('login-required-modal');
    if (modal) {
        modal.classList.remove('hidden');
    } else {
        // Fallback jika modal kustom belum ada
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
    // Simpan intent pengalihan ke Checkout
    if (state) state.pendingRedirect = 'checkout';
    window.pendingRedirect = 'checkout';
    
    // Tutup modal warning
    window.closeLoginRequiredModal();
    
    // Buka modal Auth pada tab Login
    window.openAuthModal('login');
};

// --- AUTH MODAL CONTROL ---
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
    const btnLogin = document.getElementById('auth-tab-btn-login');
    const btnReg = document.getElementById('auth-tab-btn-register');

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

// --- LOGIN FORM HANDLER ---
window.handleAuthLogin = async function(e) {
    e.preventDefault();
    hideAuthError('login');
    
    const emailInput = document.getElementById('auth-login-email');
    const passInput = document.getElementById('auth-login-password');
    const btnSpinner = document.getElementById('btn-auth-login-spinner');
    
    if (!emailInput || !passInput) return;

    const email = emailInput.value.trim();
    const password = passInput.value;

    if (btnSpinner) btnSpinner.classList.remove('hidden');

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        
        if (typeof window.showToast === 'function') {
            window.showToast('Login berhasil! Selamat datang kembali.', 'success');
        }
        
        window.closeAuthModal();

        // Tentukan role user
        let role = 'customer';
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'));
            if (snap.exists() && snap.data().role) {
                role = snap.data().role;
            } else if (email.includes('admin')) {
                role = 'admin';
            }
        } catch (_) {
            if (email.includes('admin')) role = 'admin';
        }

        // PERIKSA INTEGRASI PENDING REDIRECT (CHECKOUT)
        const redirectTarget = (state && state.pendingRedirect) || window.pendingRedirect;
        if (state) state.pendingRedirect = null;
        window.pendingRedirect = null;

        if (redirectTarget === 'checkout') {
            // Pengguna diarahkan langsung ke checkout
            if (typeof window.navigateTo === 'function') {
                window.navigateTo('checkout');
            } else if (typeof window.switchToViewMode === 'function') {
                window.switchToViewMode('checkout');
            } else if (typeof window.openCheckoutPage === 'function') {
                window.openCheckoutPage();
            }
        } else if (role === 'admin') {
            if (typeof window.switchToViewMode === 'function') {
                window.switchToViewMode('admin');
            }
        }
    } catch(err) {
        console.error('Login error:', err.code, err.message);
        showAuthError('login', translateAuthError(err));
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
    }
};

// --- REGISTER FORM HANDLER ---
window.handleAuthRegister = async function(e) {
    e.preventDefault();
    hideAuthError('register');

    const nameInput = document.getElementById('auth-reg-name');
    const phoneInput = document.getElementById('auth-reg-phone');
    const emailInput = document.getElementById('auth-reg-email');
    const passInput = document.getElementById('auth-reg-password');
    const btnSpinner = document.getElementById('btn-auth-reg-spinner');

    if (!nameInput || !emailInput || !passInput) return;

    const name = nameInput.value.trim();
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const email = emailInput.value.trim();
    const password = passInput.value;

    if (btnSpinner) btnSpinner.classList.remove('hidden');

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const role = email.includes('admin') ? 'admin' : 'customer';

        await setDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'), {
            uid: cred.user.uid,
            nama: name,
            noHp: phone,
            email: email,
            role: role,
            createdAt: Date.now()
        });

        if (typeof window.showToast === 'function') {
            window.showToast('Registrasi berhasil! Akun Anda aktif.', 'success');
        }
        
        window.closeAuthModal();

        // Check if registration was triggered during checkout flow
        const redirectTarget = (state && state.pendingRedirect) || window.pendingRedirect;
        if (state) state.pendingRedirect = null;
        window.pendingRedirect = null;

        if (redirectTarget === 'checkout') {
            if (typeof window.navigateTo === 'function') {
                window.navigateTo('checkout');
            } else if (typeof window.switchToViewMode === 'function') {
                window.switchToViewMode('checkout');
            }
        }
    } catch(err) {
        console.error('Register error:', err.code, err.message);
        showAuthError('register', translateAuthError(err));
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
    }
};

// --- LOGOUT HANDLER ---
window.handleLogout = async function() {
    try {
        await signOut(auth);
        if (typeof window.showToast === 'function') {
            window.showToast('Anda telah keluar.', 'success');
        }
        if (typeof window.switchToViewMode === 'function') {
            window.switchToViewMode('customer');
        }
    } catch(e) {
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal logout.', 'error');
        }
    }
};