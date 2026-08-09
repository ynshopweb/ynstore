// ============================================================
// REGISTER MODULE
// ============================================================
// Menangani proses Registrasi Email & Password:
// 1. Buat akun via Firebase Authentication.
// 2. Simpan data user ke Firestore (role default 'customer').
// 3. Kirim Email Verification otomatis.
// 4. User TIDAK langsung masuk ke dashboard — ditampilkan layar
//    "Registrasi Berhasil" yang meminta mereka memverifikasi email
//    dulu sebelum bisa login (lihat js/auth/login.js untuk guard-nya).
// ============================================================
import {
    createUserWithEmailAndPassword,
    sendEmailVerification,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { auth, db, appId } from '../config.js';
import {
    translateAuthError,
    showAuthError,
    hideAuthError,
    setPendingUnverifiedUser,
    setLoginAttemptInProgress
} from './core.js';
import { isPhoneAvailable, reservePhoneNumber } from '../phone-registry.js';

window.handleAuthRegister = async function(e) {
    e.preventDefault();
    hideAuthError('register');

    const nameInput = document.getElementById('auth-reg-name');
    const phoneInput = document.getElementById('auth-reg-phone');
    const emailInput = document.getElementById('auth-reg-email');
    const passInput = document.getElementById('auth-reg-password');
    const confirmPassInput = document.getElementById('auth-reg-password-confirm');
    const agreeInput = document.getElementById('auth-reg-agree');
    const btnSpinner = document.getElementById('btn-auth-reg-spinner');

    if (!nameInput || !emailInput || !passInput) return;

    const name = nameInput.value.trim();
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const email = emailInput.value.trim();
    const password = passInput.value;
    const confirmPassword = confirmPassInput ? confirmPassInput.value : password;

    // --- VALIDASI FORM ---
    if (password !== confirmPassword) {
        showAuthError('register', 'Konfirmasi password tidak sama dengan password.');
        return;
    }
    if (agreeInput && !agreeInput.checked) {
        showAuthError('register', 'Anda harus menyetujui Syarat & Ketentuan terlebih dahulu.');
        return;
    }

    if (btnSpinner) btnSpinner.classList.remove('hidden');
    setLoginAttemptInProgress(true);

    try {
        // --- VALIDASI NOMOR WHATSAPP UNIK (sebelum akun dibuat) ---
        const phoneAvailable = await isPhoneAvailable(phone);
        if (!phoneAvailable) {
            showAuthError('register', 'Nomor WhatsApp sudah terdaftar.');
            if (btnSpinner) btnSpinner.classList.add('hidden');
            return;
        }

        const cred = await createUserWithEmailAndPassword(auth, email, password);

        // Simpan profil ke Firestore — role selalu default 'customer',
        // status selalu default 'active'. Kenaikan role menjadi admin
        // atau menonaktifkan akun hanya boleh dilakukan admin lewat
        // Dashboard Manajemen Pengguna, bukan lewat form publik ini,
        // supaya sistem role & status tetap aman.
        await setDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'), {
            uid: cred.user.uid,
            nama: name,
            noHp: phone,
            email: email,
            provider: 'password',
            role: 'customer',
            status: 'active',
            emailVerified: false,
            createdAt: Date.now(),
            lastLogin: Date.now()
        });

        // Daftarkan nomor WhatsApp ke registry keunikan (lihat js/phone-registry.js)
        await reservePhoneNumber(phone, cred.user.uid);

        // Kirim email verifikasi otomatis
        await sendEmailVerification(cred.user);

        // Simpan referensi user untuk tombol "Kirim Ulang Email" di layar
        // sukses, lalu signOut supaya user TIDAK dianggap langsung login
        // (harus verifikasi email dulu sebelum login, sesuai alur di atas).
        setPendingUnverifiedUser(cred.user);
        await signOut(auth);

        window.showRegisterSuccessScreen(email);
    } catch (err) {
        console.error('Register error:', err.code, err.message);
        showAuthError('register', translateAuthError(err));
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
        setLoginAttemptInProgress(false);
    }
};

// --- LAYAR "REGISTRASI BERHASIL" (pengganti tampilan form setelah daftar) ---
window.showRegisterSuccessScreen = function(email) {
    const loginForm = document.getElementById('modal-login-form');
    const regForm = document.getElementById('modal-register-form');
    const successScreen = document.getElementById('register-success-screen');
    const tabsWrap = document.getElementById('auth-modal-tabs');
    const emailLabel = document.getElementById('register-success-email');
    const modal = document.getElementById('auth-modal');

    if (loginForm) loginForm.classList.add('hidden');
    if (regForm) regForm.classList.add('hidden');
    if (tabsWrap) tabsWrap.classList.add('hidden');
    if (emailLabel) emailLabel.textContent = email || '';
    if (successScreen) successScreen.classList.remove('hidden');
    if (modal) modal.classList.remove('hidden');
};

window.backToLoginFromSuccess = function() {
    window.switchAuthTab('login');
};
