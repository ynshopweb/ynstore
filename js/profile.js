// ============================================================
// PROFILE MODULE
// ============================================================
// Merender info akun di halaman "Profil & Pesanan Saya": nama, email,
// nomor WhatsApp, metode login, role, status akun (badge merah jika
// dinonaktifkan), status verifikasi email, tanggal bergabung, last
// login, dan last activity.
//
// Dipanggil otomatis oleh js/auth.js (listener real-time profil)
// setiap kali status login/profil berubah — lihat
// window.renderProfilePageInfo di bawah. Riwayat pesanan customer
// TETAP dirender oleh js/orders.js (tidak diubah).
// ============================================================
import { formatFlexibleDateTime } from './format-utils.js';

window.renderProfilePageInfo = function(profileData, user) {
    const nameEl = document.getElementById('profile-page-name');
    const emailEl = document.getElementById('profile-page-email');
    const phoneEl = document.getElementById('profile-page-phone-value');
    const roleBadge = document.getElementById('profile-role-badge');
    const methodBadge = document.getElementById('profile-method-badge');
    const verifiedBadge = document.getElementById('profile-verified-badge');
    const statusBadge = document.getElementById('profile-status-badge');
    const resendBtn = document.getElementById('profile-resend-verif-btn');
    const joinedEl = document.getElementById('profile-page-joined');
    const lastLoginEl = document.getElementById('profile-page-lastlogin');
    const lastActivityEl = document.getElementById('profile-page-lastactivity');

    if (nameEl) nameEl.textContent = (profileData && profileData.nama) || 'Pelanggan';
    if (emailEl) emailEl.textContent = (profileData && profileData.email) || (user && user.email) || '';
    if (phoneEl) phoneEl.textContent = (profileData && profileData.noHp) || '-';

    const isAdminRole = !!(profileData && profileData.role === 'admin');
    if (roleBadge) roleBadge.textContent = isAdminRole ? 'Admin YN Shop' : 'Customer YN Shop';

    const isGoogle = !!(profileData && profileData.provider === 'google');
    if (methodBadge) {
        methodBadge.innerHTML = isGoogle
            ? '<i class="fa-brands fa-google me-1"></i> Google'
            : '<i class="fa-solid fa-key me-1"></i> Email &amp; Password';
    }

    // Akun Google selalu dianggap terverifikasi oleh Google. Akun
    // Email/Password memakai status emailVerified dari objek user Firebase
    // (satu-satunya sumber kebenaran real-time, bukan field Firestore).
    const isVerified = isGoogle || !!(user && user.emailVerified);
    if (verifiedBadge) {
        if (isVerified) {
            verifiedBadge.className = 'inline-block bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full';
            verifiedBadge.innerHTML = '🟢 Terverifikasi';
        } else {
            verifiedBadge.className = 'inline-block bg-rose-50 text-rose-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full';
            verifiedBadge.innerHTML = '🔴 Belum Terverifikasi';
        }
    }
    if (resendBtn) resendBtn.classList.toggle('hidden', isVerified);

    const isDisabled = !!(profileData && profileData.status === 'disabled');
    if (statusBadge) {
        if (isDisabled) {
            statusBadge.className = 'inline-block bg-rose-50 text-rose-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full';
            statusBadge.innerHTML = '🔴 Dinonaktifkan';
        } else {
            statusBadge.className = 'inline-block bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full';
            statusBadge.innerHTML = '🟢 Aktif';
        }
    }

    if (joinedEl) joinedEl.textContent = formatFlexibleDateTime(profileData && profileData.createdAt);
    if (lastLoginEl) lastLoginEl.textContent = formatFlexibleDateTime(profileData && profileData.lastLogin);
    if (lastActivityEl) lastActivityEl.textContent = formatFlexibleDateTime(profileData && profileData.lastActivity);
};
