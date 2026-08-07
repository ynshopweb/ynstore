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
import './auth.js';
import { setupProductsSnapshot } from './products.js';
import './cart.js';
import './checkout.js';
import { setupOrdersSnapshot } from './orders.js';
import './admin.js';
import './product-import-export.js';
import { setupPaymentSettingsSnapshot } from './settings.js';
import './reports.js';

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

// --- BOOTSTRAP APLIKASI ---
async function bootstrapApp() {
    await loadAllPartials();

    // Aktifkan listener real-time Firestore (produk & pesanan)
    setupProductsSnapshot();
    setupOrdersSnapshot();
    setupPaymentSettingsSnapshot();

    // Set tanggal pick up default di form checkout ke hari ini
    const dateInput = document.getElementById('checkout-pickup-date');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
        dateInput.min = today;
    }
}

window.addEventListener('DOMContentLoaded', bootstrapApp);
