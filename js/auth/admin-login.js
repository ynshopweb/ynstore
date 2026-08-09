// ============================================================
// ADMIN LOGIN MODULE (khusus halaman /admin-login -> admin-login.html)
// ============================================================
// Menangani proses Login khusus Admin. TIDAK menduplikasi logika inti
// autentikasi — semua dipakai bersama dari js/auth/core.js:
//   - translateAuthError()      -> terjemahan pesan error Firebase
//   - finalizeSuccessfulLogin() -> sinkron profil, guard status
//     disabled, catat Login History & Last Activity (SAMA PERSIS
//     dengan yang dipakai alur Login Customer di js/auth/login.js)
//   - isValidAdminProfile()     -> validasi role === 'admin' &&
//     status === 'active' (dipakai juga oleh js/ui.js switchToViewMode)
//
// Perbedaan dari Login Customer (js/auth/login.js):
// 1. Tidak ada opsi Login Google maupun Registrasi di halaman ini.
// 2. WAJIB lolos validasi isValidAdminProfile() setelah Firebase Auth
//    berhasil -> jika tidak lolos, akun otomatis di-logout dan pesan
//    "Akun ini tidak memiliki hak akses sebagai Admin." ditampilkan.
// 3. Verifikasi email (emailVerified) TIDAK diperiksa untuk akun admin
//    -> kebijakan ini didokumentasikan di js/auth/core.js pada fungsi
//    isValidAdminProfile() (akun admin internal, dikelola manual).
// 4. Login sukses SELALU menuju Dashboard Admin, tidak pernah ke
//    halaman/alur customer.
// ============================================================
import {
    signInWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import { auth, db, appId } from '../config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    translateAuthError,
    finalizeSuccessfulLogin,
    isValidAdminProfile,
    setLoginAttemptInProgress
} from './core.js';

// Penanda sessionStorage yang dibaca oleh js/main.js saat index.html
// dimuat, supaya user langsung diarahkan ke Dashboard Admin begitu
// halaman toko selesai bootstrap (lihat js/main.js -> bootstrapApp()).
const ADMIN_DASHBOARD_FLAG = 'ynshop_open_admin_dashboard';

function goToAdminDashboard() {
    try { sessionStorage.setItem(ADMIN_DASHBOARD_FLAG, '1'); } catch (_) { /* ignore */ }
    window.location.href = 'index.html';
}

function showAdminLoginError(message) {
    const box = document.getElementById('admin-login-error-alert');
    const text = document.getElementById('admin-login-error-text');
    if (box && text) {
        text.textContent = message;
        box.classList.remove('hidden');
    }
}

function hideAdminLoginError() {
    const box = document.getElementById('admin-login-error-alert');
    if (box) box.classList.add('hidden');
}

function showForm() {
    const checking = document.getElementById('admin-login-checking');
    const formWrap = document.getElementById('admin-login-form-wrapper');
    if (checking) checking.classList.add('hidden');
    if (formWrap) formWrap.classList.remove('hidden');
}

// ================= AKAR MASALAH & PERBAIKANNYA =================
// syncUserProfileOnLogin() (dipanggil oleh finalizeSuccessfulLogin() di
// js/auth/core.js) SENGAJA auto-membuat dokumen profil baru dengan
// role default 'customer' & status 'active' kalau belum ada dokumen
// sama sekali -- ini BENAR untuk alur Login Customer (mis. Google
// Sign-In pertama kali), tapi SALAH kalau ikut terpicu lewat alur
// Login Admin: akun yang seharusnya admin (baru dibuat lewat Firebase
// Console, profil Firestore-nya belum pernah dibuat sama sekali) akan
// diam-diam "diturunkan" jadi profil customer begitu mencoba login
// admin pertama kali -- lalu ditolak dengan pesan generik "Akun ini
// tidak memiliki hak akses sebagai Admin.", padahal akar masalahnya
// adalah PROFIL ADMIN BELUM PERNAH DIBUAT, bukan "role salah".
//
// Perbaikan: cek dulu apakah dokumen profil SUDAH ADA di Firestore
// SEBELUM memanggil finalizeSuccessfulLogin() sama sekali. Kalau belum
// ada -> jangan biarkan auto-provisioning customer itu jalan lewat
// gerbang admin; langsung logout & tampilkan pesan yang menunjuk akar
// masalah sebenarnya (profil admin belum dibuat), bukan pesan generik
// "bukan admin" yang menyembunyikan penyebabnya.
async function fetchAdminProfileSnapshot(uid) {
    const ref = doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data');
    return getDoc(ref);
}

// ================= REQUIREMENT: SESI ADMIN AKTIF -> LANGSUNG DASHBOARD =================
// Jika admin sudah punya sesi Firebase Auth aktif (mis. baru saja login
// lewat tab lain, atau kembali membuka /admin-login), form TIDAK perlu
// diisi ulang -> langsung diarahkan ke Dashboard Admin. Sebaliknya jika
// sesi aktif ternyata BUKAN admin (mis. akun customer yang masih login
// di browser yang sama), sesi tsb otomatis di-logout supaya form
// admin-login siap dipakai dengan akun admin yang benar. Hanya
// diperiksa SEKALI saat halaman pertama kali dibuka (bukan tiap
// perubahan status auth), supaya tidak mengganggu proses submit form.
let initialSessionCheckDone = false;
onAuthStateChanged(auth, async (user) => {
    if (initialSessionCheckDone) return;
    initialSessionCheckDone = true;

    if (!user) {
        showForm();
        return;
    }

    try {
        const snap = await fetchAdminProfileSnapshot(user.uid);
        if (!snap.exists()) {
            // Profil belum pernah dibuat -> JANGAN panggil
            // finalizeSuccessfulLogin() (akan auto-membuat profil
            // customer). Logout diam-diam saja, biarkan form muncul
            // supaya admin bisa login ulang setelah profilnya dibuat.
            await signOut(auth);
            showForm();
            return;
        }

        const profileData = await finalizeSuccessfulLogin(user, { provider: 'password' });
        if (profileData && isValidAdminProfile(profileData)) {
            goToAdminDashboard();
            return;
        }
        // Sesi aktif tapi bukan admin (atau berstatus disabled) -> logout diam-diam.
        await signOut(auth);
    } catch (_) {
        try { await signOut(auth); } catch (__) { /* ignore */ }
    }
    showForm();
});

// ================= FORM LOGIN ADMIN =================
window.handleAdminLogin = async function (e) {
    e.preventDefault();
    hideAdminLoginError();

    const emailInput = document.getElementById('admin-login-email');
    const passInput = document.getElementById('admin-login-password');
    const rememberInput = document.getElementById('admin-login-remember');
    const btnSpinner = document.getElementById('btn-admin-login-spinner');

    if (!emailInput || !passInput) return;

    const email = emailInput.value.trim();
    const password = passInput.value;
    const rememberMe = rememberInput ? rememberInput.checked : true;

    if (btnSpinner) btnSpinner.classList.remove('hidden');
    setLoginAttemptInProgress(true);

    try {
        // "Ingat Saya" -> sesi tetap tersimpan walau browser ditutup (sama
        // seperti Login Customer di js/auth/login.js, memakai fungsi Firebase yang sama).
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

        const cred = await signInWithEmailAndPassword(auth, email, password);

        // ================= CEK AKAR MASALAH SEBELUM SYNC PROFIL =================
        // Lihat penjelasan lengkap di fetchAdminProfileSnapshot() di atas.
        // Kalau dokumen profil BELUM ADA sama sekali, hentikan di sini —
        // JANGAN panggil finalizeSuccessfulLogin(), supaya tidak diam-diam
        // membuat profil 'customer' untuk akun yang seharusnya admin.
        const profileSnap = await fetchAdminProfileSnapshot(cred.user.uid);
        if (!profileSnap.exists()) {
            await signOut(auth);
            showAdminLoginError(
                'Profil akun ini belum terdaftar sebagai Admin di sistem. ' +
                'Hubungi pemilik toko untuk membuatkan dokumen profil Admin ' +
                '(role: "admin", status: "active") di Firestore untuk akun ini.'
            );
            return;
        }

        // TIDAK ADA guard emailVerified di sini (lihat catatan kebijakan
        // admin di js/auth/core.js -> isValidAdminProfile()).
        const profileData = await finalizeSuccessfulLogin(cred.user, { provider: 'password' });

        if (!profileData) {
            // Akun berstatus disabled -> finalizeSuccessfulLogin sudah
            // otomatis signOut (lihat forceLogoutDisabledAccount di auth.js).
            showAdminLoginError('Akun ini telah dinonaktifkan. Silakan hubungi sesama Admin.');
            return;
        }

        // ================= VALIDASI ROLE & STATUS ADMIN =================
        // Sampai di sini, profil SUDAH ADA (dicek di atas) tapi role/status
        // tidak memenuhi syarat (mis. role masih 'customer', atau status
        // bukan 'active') -> pesan ini sekarang benar-benar berarti
        // "role/status salah", bukan lagi menutupi kasus "profil belum ada".
        if (!isValidAdminProfile(profileData)) {
            await signOut(auth);
            showAdminLoginError('Akun ini tidak memiliki hak akses sebagai Admin.');
            return;
        }

        if (typeof window.showToast === 'function') {
            window.showToast('Login Admin berhasil! Mengarahkan ke Dashboard...', 'success');
        }
        goToAdminDashboard();
    } catch (err) {
        console.error('Admin login error:', err.code, err.message);
        showAdminLoginError(translateAuthError(err));
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
        setLoginAttemptInProgress(false);
    }
};
