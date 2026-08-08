// ============================================================
// LOGIN MODULE
// ============================================================
// Menangani proses Login: Email & Password (dengan guard verifikasi
// email), Login Google (popup, otomatis terverifikasi), opsi "Ingat
// Saya" (session persistence), dan alur "Lupa Password".
// ============================================================
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    sendPasswordResetEmail,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import { auth } from './config.js';
import {
    translateAuthError,
    showAuthError,
    hideAuthError,
    finalizeSuccessfulLogin,
    handlePostLoginRedirect,
    setPendingUnverifiedUser,
    setLoginAttemptInProgress
} from './auth.js';

const googleProvider = new GoogleAuthProvider();

// --- LOGIN EMAIL & PASSWORD ---
window.handleAuthLogin = async function(e) {
    e.preventDefault();
    hideAuthError('login');

    const emailInput = document.getElementById('auth-login-email');
    const passInput = document.getElementById('auth-login-password');
    const rememberInput = document.getElementById('auth-login-remember');
    const btnSpinner = document.getElementById('btn-auth-login-spinner');

    if (!emailInput || !passInput) return;

    const email = emailInput.value.trim();
    const password = passInput.value;
    const rememberMe = rememberInput ? rememberInput.checked : true;

    if (btnSpinner) btnSpinner.classList.remove('hidden');

    // Tandai proses login sedang berlangsung, supaya transisi status auth
    // sesaat (mis. dipicu setPersistence di bawah) tidak salah dianggap
    // "sesi habis" oleh listener global di auth.js (lihat penjelasan
    // lengkap di komentar auth.js bagian FLAGS INTERNAL SESI).
    setLoginAttemptInProgress(true);

    try {
        // "Ingat Saya" dicentang -> sesi tetap tersimpan walau browser ditutup.
        // Tidak dicentang -> sesi hanya berlaku selama tab browser terbuka.
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

        const cred = await signInWithEmailAndPassword(auth, email, password);

        // --- GUARD VERIFIKASI EMAIL ---
        // Akun Email/Password WAJIB terverifikasi sebelum bisa login.
        // User tetap di-signOut supaya tidak dianggap sesi aktif, tapi
        // referensinya disimpan sementara untuk tombol "Kirim Ulang Verifikasi".
        if (!cred.user.emailVerified) {
            setPendingUnverifiedUser(cred.user);
            await signOut(auth);
            window.closeAuthModal();
            window.showEmailUnverifiedModal(email);
            return;
        }

        // finalizeSuccessfulLogin juga menjalankan guard status akun
        // (disabled -> otomatis signOut + tampil dialog) dan mencatat
        // Login History + Last Activity dalam satu titik terpusat.
        const profileData = await finalizeSuccessfulLogin(cred.user, { provider: 'password' });
        if (!profileData) return; // akun dinonaktifkan, dialog sudah ditampilkan

        if (typeof window.showToast === 'function') {
            window.showToast('Login berhasil! Selamat datang kembali.', 'success');
        }

        window.closeAuthModal();
        handlePostLoginRedirect(profileData.role || 'customer');
    } catch (err) {
        console.error('Login error:', err.code, err.message);
        showAuthError('login', translateAuthError(err));
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
        setLoginAttemptInProgress(false);
    }
};

// --- LOGIN GOOGLE (popup) ---
// Akun Google selalu dianggap sudah terverifikasi oleh Google, sehingga
// TIDAK perlu mengirim email verifikasi tambahan dan bisa langsung login.
window.handleGoogleLogin = async function() {
    const btnSpinner = document.getElementById('btn-auth-google-spinner');
    if (btnSpinner) btnSpinner.classList.remove('hidden');
    setLoginAttemptInProgress(true);

    try {
        const cred = await signInWithPopup(auth, googleProvider);
        const profileData = await finalizeSuccessfulLogin(cred.user, {
            provider: 'google',
            name: cred.user.displayName || ''
        });
        if (!profileData) return; // akun dinonaktifkan, dialog sudah ditampilkan

        if (typeof window.showToast === 'function') {
            window.showToast('Login dengan Google berhasil!', 'success');
        }

        window.closeAuthModal();
        handlePostLoginRedirect(profileData.role || 'customer');
    } catch (err) {
        // Popup ditutup manual oleh user bukan error yang perlu ditampilkan
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            console.error('Google login error:', err.code, err.message);
            if (typeof window.showToast === 'function') {
                window.showToast('Login Google gagal: ' + translateAuthError(err), 'error');
            }
        }
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
        setLoginAttemptInProgress(false);
    }
};

// ================= LUPA PASSWORD =================
window.openForgotPasswordModal = function() {
    const modal = document.getElementById('forgot-password-modal');
    const form = document.getElementById('forgot-password-form');
    const successBox = document.getElementById('forgot-password-success');
    const emailInput = document.getElementById('forgot-password-email');
    const loginEmailVal = document.getElementById('auth-login-email')?.value.trim();

    if (form) form.classList.remove('hidden');
    if (successBox) successBox.classList.add('hidden');
    if (emailInput && loginEmailVal) emailInput.value = loginEmailVal;

    if (modal) modal.classList.remove('hidden');
};

window.closeForgotPasswordModal = function() {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) modal.classList.add('hidden');
};

window.handleForgotPasswordSubmit = async function(e) {
    e.preventDefault();
    const emailInput = document.getElementById('forgot-password-email');
    const errorBox = document.getElementById('forgot-password-error');
    const btnSpinner = document.getElementById('btn-forgot-password-spinner');
    if (!emailInput) return;

    const email = emailInput.value.trim();
    if (errorBox) errorBox.classList.add('hidden');
    if (btnSpinner) btnSpinner.classList.remove('hidden');

    try {
        await sendPasswordResetEmail(auth, email);

        const form = document.getElementById('forgot-password-form');
        const successBox = document.getElementById('forgot-password-success');
        const successEmailLabel = document.getElementById('forgot-password-success-email');
        if (form) form.classList.add('hidden');
        if (successEmailLabel) successEmailLabel.textContent = email;
        if (successBox) successBox.classList.remove('hidden');
    } catch (err) {
        console.error('Forgot password error:', err.code, err.message);
        if (errorBox) {
            errorBox.textContent = translateAuthError(err);
            errorBox.classList.remove('hidden');
        }
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
    }
};
