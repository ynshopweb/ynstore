// ============================================================
// MAIN / ENTRY POINT
// 1. Memuat semua potongan HTML (partials) ke dalam index.html
// 2. Mengimpor seluruh modul fitur (masing-masing menempel fungsi
//    ke `window` supaya atribut onclick/onchange di HTML tetap jalan)
// 3. Menjalankan inisialisasi awal aplikasi (snapshot Firestore, dll)
//
// PENTING: karena pakai fetch() untuk memuat partials/*.html,
// file ini HARUS dijalankan lewat web server lokal, bukan dibuka
// langsung lewat file:// (browser akan memblokir fetch file lokal).
// Lihat README.md untuk cara menjalankannya.
// ============================================================

// Modul-modul fitur (side-effect: menempelkan fungsi ke window)
import './config.js';
import './state.js';
import './ui.js';
import './promo.js';
import './profile.js';
import './auth.js';
import './login.js';
import './register.js';
import { setupProductsSnapshot } from './products.js';
import './cart.js';
import './checkout.js';
import { setupOrdersSnapshot } from './orders.js';
import './admin.js';
import './product-import-export.js';
import { setupPaymentSettingsSnapshot } from './settings.js';
import './reports.js';
import './login-logs.js';
import { setupUsersSnapshot } from './users-admin.js';
import { isValidAdminProfile } from './auth.js';
import { auth, db, appId } from './config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- PARTIAL LOADER ---
async function loadPartial(el) {
    const url = el.getAttribute('data-slot');
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        el.outerHTML = await res.text();
    } catch (err) {
        console.error(`Gagal memuat partial "${url}":`, err);
        el.outerHTML = `<div class="p-4 text-xs text-rose-600 bg-rose-50">Gagal memuat komponen: ${url}</div>`;
    }
}

async function loadAllPartials() {
    const slots = Array.from(document.querySelectorAll('[data-slot]'));
    await Promise.all(slots.map(loadPartial));
}

// ================= LANJUTAN SETELAH LOGIN DI HALAMAN TERPISAH =================
// Halaman Login Customer (/login) dan Login Admin (/admin-login) BUKAN
// bagian dari SPA index.html — setelah login sukses, keduanya melakukan
// redirect sungguhan (reload) balik ke index.html. Fungsi di bawah ini
// membaca "penanda" yang mereka tinggalkan (sessionStorage / URL hash)
// supaya pengalaman tetap mulus (checkout lanjut otomatis, Dashboard
// Admin langsung terbuka) tanpa perlu login.html/admin-login.html tahu
// apa pun tentang struktur internal SPA ini.

// --- Checkout tertunda (dari checkout guard yang mengarahkan ke /login) ---
function resumePendingCheckoutRedirect() {
    let pending = null;
    try { pending = sessionStorage.getItem('ynshop_pending_redirect'); } catch (_) { /* ignore */ }
    if (pending !== 'checkout') return;
    try { sessionStorage.removeItem('ynshop_pending_redirect'); } catch (_) { /* ignore */ }

    if (typeof window.toggleCartDrawer === 'function') window.toggleCartDrawer(true);
    if (typeof window.showToast === 'function') {
        window.showToast('Silakan lanjutkan checkout dari Keranjang Anda.', 'success');
    }
}

// --- Dashboard Admin tertunda (dari /admin-login ATAU akses langsung
// lewat index.html#admin) — requirement #8: jika admin belum login,
// arahkan ke /admin-login (BUKAN ke halaman login customer). Validasi
// role/status TETAP dilakukan ulang di sini lewat Firestore (bukan
// hanya percaya penanda sessionStorage/hash), supaya Dashboard Admin
// tidak bisa dibuka hanya dengan mengubah URL/flag dari console. ---
function wantsAdminDashboard() {
    let flagged = false;
    try { flagged = sessionStorage.getItem('ynshop_open_admin_dashboard') === '1'; } catch (_) { /* ignore */ }
    try { sessionStorage.removeItem('ynshop_open_admin_dashboard'); } catch (_) { /* ignore */ }

    const hashWantsAdmin = window.location.hash === '#admin';
    if (hashWantsAdmin) {
        // Bersihkan hash supaya tidak terpicu berulang saat reload/back.
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return flagged || hashWantsAdmin;
}

function resumePendingAdminDashboard() {
    if (!wantsAdminDashboard()) return;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        unsubscribe();

        if (!user) {
            // Belum login sama sekali -> ke /admin-login, BUKAN /login.
            window.location.href = 'admin-login.html';
            return;
        }

        try {
            const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
            const snap = await getDoc(ref);
            const profileData = snap.exists() ? snap.data() : null;

            if (isValidAdminProfile(profileData)) {
                window.switchToViewMode('admin');
            } else if (typeof window.showToast === 'function') {
                window.showToast('Akses ditolak. Anda tidak memiliki izin sebagai Admin.', 'error');
            }
        } catch (_) {
            if (typeof window.showToast === 'function') {
                window.showToast('Gagal memuat Dashboard Admin. Silakan coba lagi.', 'error');
            }
        }
    });
}

// --- BOOTSTRAP APLIKASI ---
async function bootstrapApp() {
    await loadAllPartials();

    // Aktifkan listener real-time Firestore (produk & pesanan)
    setupProductsSnapshot();
    setupOrdersSnapshot();
    setupPaymentSettingsSnapshot();
    setupUsersSnapshot();

    // Set tanggal pick up default di form checkout ke hari ini
    const dateInput = document.getElementById('checkout-pickup-date');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
        dateInput.min = today;
    }

    resumePendingCheckoutRedirect();
    resumePendingAdminDashboard();
}

window.addEventListener('DOMContentLoaded', bootstrapApp);
