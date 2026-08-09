// ============================================================
// CUSTOMER LOGIN PAGE BOOTSTRAP (khusus halaman /login -> login.html)
// ============================================================
// Entry point tunggal untuk login.html — meng-import seluruh modul
// yang dibutuhkan halaman ini (config, state, ui, dan modul auth inti
// customer: core/login/register/login-logs), lalu menjalankan 2 hal
// yang spesifik untuk halaman ini saja (bukan bagian dari logika
// autentikasi bersama, jadi TIDAK ditaruh di core.js):
//   1. Baca parameter URL (?tab=register, ?redirect=checkout) supaya
//      tab & penanda checkout langsung sesuai saat halaman tampil.
//   2. Jika user yang membuka /login TERNYATA sudah punya sesi aktif,
//      langsung redirect ke toko (index.html) tanpa perlu isi form lagi.
// ============================================================
import '../config.js';
import { state } from '../state.js';
import '../ui.js';
import './core.js';
import './login.js';
import './register.js';
import './login-logs.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth } from '../config.js';

const params = new URLSearchParams(window.location.search);

// Requirement: checkout yang tertunda tetap dilanjutkan otomatis
// setelah login sukses (lihat handlePostLoginRedirect di js/auth/core.js).
if (params.get('redirect') === 'checkout') {
    state.pendingRedirect = 'checkout';
    window.pendingRedirect = 'checkout';
}

window.addEventListener('DOMContentLoaded', () => {
    if (params.get('tab') === 'register') {
        window.switchAuthTab('register');
    }
});

// Requirement: jika user yang membuka /login TERNYATA sudah login
// (sesi aktif), langsung arahkan ke toko (index.html) — baik customer
// maupun admin, karena halaman ini murni gerbang autentikasi, bukan
// tujuan akhir. Selama status sesi belum diketahui, form disembunyikan
// dulu (loader) supaya tidak ada kedipan form login sesaat sebelum
// redirect. Hanya diperiksa SEKALI saat halaman pertama kali dibuka.
let initialCheckDone = false;
onAuthStateChanged(auth, (user) => {
    if (initialCheckDone) return;
    initialCheckDone = true;

    if (user) {
        window.location.href = 'index.html';
        return;
    }

    const checking = document.getElementById('customer-login-checking');
    const content = document.getElementById('customer-login-content');
    if (checking) checking.classList.add('hidden');
    if (content) content.classList.remove('hidden');
});
