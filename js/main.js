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
import './auth/core.js';
import './auth/login.js';
import './auth/register.js';
import { setupProductsSnapshot } from './products.js';
import './cart.js';
import './checkout.js';
import { setupOrdersSnapshot } from './orders.js';
import './admin.js';
import './product-import-export.js';
import { setupPaymentSettingsSnapshot } from './settings.js';
import './reports.js';
import './auth/login-logs.js';
import { setupUsersSnapshot } from './users-admin.js';
import { isValidAdminProfile, syncAuthHeaderUI } from './auth/core.js';
import { NAV_STORAGE_KEYS, readNav } from './ui.js';
import { state } from './state.js';
import { auth, db, appId } from './config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- PENANDA KONTEKS SPA (dipakai js/auth/core.js -> handlePostLoginRedirect) ---
// BUG FIX: sebelumnya handlePostLoginRedirect() memakai
// `typeof window.switchToViewMode === 'function'` untuk mendeteksi
// apakah sedang berjalan di dalam SPA index.html. Deteksi itu SALAH
// karena login.html JUGA meng-import js/ui.js (untuk showToast, dll),
// dan js/ui.js selalu mendefinisikan window.switchToViewMode — jadi
// login.html ikut dianggap sebagai SPA, redirect ke index.html tidak
// pernah terpicu setelah Login Customer sukses (user tertahan di
// login.html walau Firebase Auth & toast "Login berhasil" sudah OK).
// Sekarang SPA index.html menandai dirinya secara eksplisit lewat flag
// ini SEBELUM interaksi apa pun mungkin terjadi, dan js/auth/core.js
// memeriksa flag ini alih-alih menebak dari fungsi yang ada.
window.__ynshopSpaContext = true;

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
//
// ================= PERTAHANKAN HALAMAN TERAKHIR SETELAH REFRESH =================
// Sebelumnya fungsi ini HANYA aktif lewat penanda SEKALI PAKAI
// ('ynshop_open_admin_dashboard', dibuat oleh admin-login.html, langsung
// dihapus setelah dibaca) atau hash '#admin'. Akibatnya: begitu admin
// sudah masuk ke Dashboard dan lalu me-refresh browser (F5/Cmd+R/Ctrl+R)
// TANPA hash '#admin' di URL, penanda sekali-pakai itu sudah terpakai
// sebelumnya, wantsAdminDashboard() langsung `return false`, dan admin
// terlempar balik ke tampilan customer ('home') — padahal sesi login
// & role admin-nya masih sah sepenuhnya. Sekarang ditambahkan penanda
// KEDUA yang TIDAK sekali-pakai: NAV_STORAGE_KEYS.viewMode, diisi setiap
// kali switchToViewMode() dipanggil (lihat js/ui.js) dan HANYA dihapus
// saat logout (lihat js/auth/core.js). Refresh browser sekarang akan
// tetap mendeteksi "terakhir kali berada di Panel Admin" dan mencoba
// membuka kembali Dashboard Admin di tab/subview yang sama.
function wantsAdminDashboard() {
    let flagged = false;
    try { flagged = sessionStorage.getItem('ynshop_open_admin_dashboard') === '1'; } catch (_) { /* ignore */ }
    try { sessionStorage.removeItem('ynshop_open_admin_dashboard'); } catch (_) { /* ignore */ }

    const hashWantsAdmin = window.location.hash === '#admin';
    if (hashWantsAdmin) {
        // Bersihkan hash supaya tidak terpicu berulang saat reload/back.
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const wasInAdminMode = readNav(NAV_STORAGE_KEYS.viewMode) === 'admin';

    return flagged || hashWantsAdmin || wasInAdminMode;
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
                // ================= BUG FIX (RACE CONDITION UTAMA) =================
                // window.switchToViewMode('admin') (js/ui.js) memvalidasi admin
                // dengan MEMBACA state.userProfile — tapi state.userProfile diisi
                // oleh proses ASYNC LAIN yang sepenuhnya terpisah: listener
                // onSnapshot() di js/auth/core.js (module-level onAuthStateChanged
                // + onSnapshot profil). getDoc() di atas dan onSnapshot() itu
                // adalah DUA pembacaan Firestore yang berjalan independen —
                // tidak ada jaminan urutan mana yang selesai lebih dulu.
                //
                // Kalau onSnapshot() di core.js BELUM sempat mengisi
                // state.userProfile pada saat baris ini dijalankan (sangat
                // mungkin terjadi, apalagi tepat setelah reload penuh dari
                // admin-login.html -> index.html), switchToViewMode('admin')
                // akan salah menyimpulkan "bukan admin" dan MENOLAK admin yang
                // sebenarnya valid — persis pola bug "kadang setelah login
                // berhasil malah gagal masuk dashboard / balik lagi", karena
                // hasilnya tergantung kecepatan jaringan (murni soal timing).
                //
                // Perbaikan: isi state.userProfile (dan state.user) SEKARANG
                // JUGA secara synchronous dari profil yang BARU SAJA divalidasi
                // di atas, sebelum memanggil switchToViewMode — sama persis
                // seperti pola yang sudah dipakai finalizeSuccessfulLogin() di
                // js/auth/core.js untuk mengatasi race condition yang identik.
                state.user = user;
                state.userProfile = profileData;
                window.switchToViewMode('admin');

                // Pulihkan tab admin terakhir (Dashboard/Transaksi/Produk/dst),
                // bukan selalu jatuh ke tab "Dashboard" — bagian dari
                // "pertahankan halaman terakhir setelah refresh".
                const savedTab = readNav(NAV_STORAGE_KEYS.adminTab);
                if (savedTab && typeof window.switchAdminTab === 'function') {
                    window.switchAdminTab(savedTab);
                }
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

    // ================= PERBAIKAN RACE CONDITION =================
    // Panggil ulang sinkronisasi UI header/nav SEKARANG, memakai
    // state.user/state.userProfile yang sudah ada saat ini (kalau ada).
    // Ini "jaring pengaman" untuk kasus listener profil di js/auth/core.js
    // sempat menyala LEBIH DULU daripada partials selesai di-fetch (race
    // condition antara pemulihan sesi Firebase Auth vs fetch() partials
    // -- lihat penjelasan lengkap di syncAuthHeaderUI(), js/auth/core.js).
    // Tanpa ini, header bisa "tersangkut" menampilkan status Tamu walau
    // user sebenarnya sudah login, sampai ada perubahan lain pada profil.
    syncAuthHeaderUI();

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

    // ================= PERTAHANKAN HALAMAN TERAKHIR SETELAH REFRESH =================
    // Kalau sebelumnya sedang di Panel Admin, resumePendingAdminDashboard()
    // di atas sudah menanganinya (termasuk memulihkan tab admin terakhir).
    // Selain itu, pulihkan halaman CUSTOMER terakhir (Produk, Tentang Kami,
    // Profil Saya, dst) supaya refresh browser tidak selalu melempar balik
    // ke Beranda. Sengaja TIDAK memulihkan 'checkout'/'payment'/
    // 'order-tracker' — lihat penjelasan RESTORABLE_CUSTOMER_VIEWS di
    // js/ui.js. navigateTo() sendiri sudah menangani guard login kalau
    // halaman yang tersimpan ternyata butuh login (mis. 'customer-profile'
    // setelah sesi berakhir) dengan menampilkan modal "Login Diperlukan".
    const wasInAdminMode = readNav(NAV_STORAGE_KEYS.viewMode) === 'admin';
    if (!wasInAdminMode) {
        const savedView = readNav(NAV_STORAGE_KEYS.customerView);
        if (savedView && savedView !== 'home' && typeof window.navigateTo === 'function') {
            window.navigateTo(savedView);
        }
    }
}

window.addEventListener('DOMContentLoaded', bootstrapApp);
