// ============================================================
// AUTH MODULE
// Login, Register, Logout, listener status login, dan kontrol
// modal auth (tab login/daftar).
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
// Catatan: demi keamanan, Firebase sengaja TIDAK membedakan antara
// "password salah" dan "akun belum terdaftar" (supaya orang tidak bisa
// menebak-nebak email mana saja yang sudah punya akun). Jadi pesannya
// menggabungkan kedua kemungkinan tersebut.
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
            return err.message;
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
    const navAvatar = document.getElementById('user-nav-avatar');
    const navName = document.getElementById('user-nav-name');
    const dropdownUserInfo = document.getElementById('dropdown-user-info');
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

            if(navName) navName.textContent = profileData.nama || 'Pelanggan';
            document.getElementById('dropdown-user-name').textContent = profileData.nama;
            document.getElementById('dropdown-user-email').textContent = profileData.email;

            authLinksGuest.classList.add('hidden');
            authLinksLogged.classList.remove('hidden');

            if (profileData.role === 'admin' || user.email.includes('admin')) {
                adminMenuLink.classList.remove('hidden');
            } else {
                adminMenuLink.classList.add('hidden');
            }

            // Auto populate profile page UI
            document.getElementById('profile-page-name').textContent = profileData.nama;
            document.getElementById('profile-page-email').textContent = profileData.email + (profileData.noHp ? ` | ${profileData.noHp}` : '');

            // Pre-fill checkout form jika user sudah login
            document.getElementById('checkout-name').value = profileData.nama || '';
            document.getElementById('checkout-email').value = profileData.email || '';
            document.getElementById('checkout-phone').value = profileData.noHp || '';

        } catch (e) {
            console.error("Error fetching user profile:", e);
        }
    } else {
        state.userProfile = null;
        if(navName) navName.textContent = 'Tamu';
        document.getElementById('dropdown-user-name').textContent = 'Belum Login';
        document.getElementById('dropdown-user-email').textContent = 'Silakan masuk ke akun Anda';
        authLinksGuest.classList.remove('hidden');
        authLinksLogged.classList.add('hidden');
        adminMenuLink.classList.add('hidden');
    }
});

// --- AUTH MODAL CONTROL ---
window.openAuthModal = function(tab = 'login') {
    document.getElementById('auth-modal').classList.remove('hidden');
    window.switchAuthTab(tab);
};

window.closeAuthModal = function() {
    document.getElementById('auth-modal').classList.add('hidden');
};

window.switchAuthTab = function(tab) {
    hideAuthError('login');
    hideAuthError('register');
    const loginForm = document.getElementById('modal-login-form');
    const regForm = document.getElementById('modal-register-form');
    const btnLogin = document.getElementById('auth-tab-btn-login');
    const btnReg = document.getElementById('auth-tab-btn-register');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
        btnLogin.className = 'flex-1 pb-2 border-b-2 border-brand-600 text-brand-600';
        btnReg.className = 'flex-1 pb-2 border-b-2 border-transparent text-slate-400 hover:text-slate-600';
    } else {
        loginForm.classList.add('hidden');
        regForm.classList.remove('hidden');
        btnReg.className = 'flex-1 pb-2 border-b-2 border-brand-600 text-brand-600';
        btnLogin.className = 'flex-1 pb-2 border-b-2 border-transparent text-slate-400 hover:text-slate-600';
    }
};

// --- LOGIN FORM ---
window.handleAuthLogin = async function(e) {
    e.preventDefault();
    hideAuthError('login');
    const email = document.getElementById('auth-login-email').value.trim();
    const password = document.getElementById('auth-login-password').value;

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        window.showToast('Login berhasil!', 'success');
        window.closeAuthModal();

        // Tentukan role user supaya bisa langsung diarahkan ke panel yang tepat
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

        if (role === 'admin') {
            window.switchToViewMode('admin');
        }
    } catch(err) {
        console.error('Login error:', err.code, err.message);
        showAuthError('login', translateAuthError(err));
    }
};

// --- REGISTER FORM ---
window.handleAuthRegister = async function(e) {
    e.preventDefault();
    hideAuthError('register');
    const name = document.getElementById('auth-reg-name').value;
    const phone = document.getElementById('auth-reg-phone').value;
    const email = document.getElementById('auth-reg-email').value.trim();
    const password = document.getElementById('auth-reg-password').value;

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

        window.showToast('Registrasi berhasil! Akun Anda aktif.', 'success');
        window.closeAuthModal();
    } catch(err) {
        console.error('Register error:', err.code, err.message);
        showAuthError('register', translateAuthError(err));
    }
};

// --- LOGOUT ---
window.handleLogout = async function() {
    try {
        await signOut(auth);
        window.showToast('Anda telah keluar.', 'success');
        window.switchToViewMode('customer');
    } catch(e) {
        window.showToast('Gagal logout.', 'error');
    }
};
