// ============================================================
// PROMO MODULE
// Promo BUKAN koleksi data terpisah — promo adalah bagian dari
// setiap dokumen produk (field `promo`). Modul ini menyediakan
// helper untuk menghitung status & harga promo, badge HTML, dan
// countdown real-time yang dipakai oleh products.js, cart.js,
// checkout.js, dan admin.js.
//
// Struktur field `promo` pada dokumen produk:
// promo: {
//     active: boolean,            // diaktifkan/dinonaktifkan admin
//     type: 'percentage'|'nominal',
//     value: number,              // persen (1-100) atau nominal Rp
//     startDate: 'YYYY-MM-DDTHH:mm', // datetime-local string
//     endDate: 'YYYY-MM-DDTHH:mm'
// }
// ============================================================

// --- STATUS PROMO ---
// Promo dianggap SEDANG BERLANGSUNG hanya jika admin mengaktifkannya
// DAN waktu saat ini berada di antara startDate & endDate.
// Setelah endDate lewat, promo otomatis dianggap tidak aktif lagi
// TANPA perlu mengubah data di Firestore (dihitung real-time di sisi klien).
export function isPromoRunning(product) {
    const promo = product && product.promo;
    if (!promo || !promo.active) return false;
    if (!promo.startDate || !promo.endDate) return false;

    const start = new Date(promo.startDate).getTime();
    const end = new Date(promo.endDate).getTime();
    if (isNaN(start) || isNaN(end)) return false;

    const now = Date.now();
    return now >= start && now <= end;
}

// Promo yang sudah diaktifkan admin tapi tanggal mulainya belum tiba.
export function isPromoScheduled(product) {
    const promo = product && product.promo;
    if (!promo || !promo.active || !promo.startDate) return false;
    const start = new Date(promo.startDate).getTime();
    if (isNaN(start)) return false;
    return Date.now() < start;
}

// --- HARGA PROMO ---
// Menghitung harga setelah diskon. TIDAK PERNAH di bawah 0.
export function getPromoPrice(product) {
    if (!isPromoRunning(product)) return product.price;
    const promo = product.promo;
    const base = Number(product.price) || 0;
    let discounted = base;
    if (promo.type === 'percentage') {
        const pct = Math.min(100, Math.max(0, Number(promo.value) || 0));
        discounted = base - Math.round(base * (pct / 100));
    } else if (promo.type === 'nominal') {
        discounted = base - (Number(promo.value) || 0);
    }
    return Math.max(0, Math.round(discounted));
}

// Harga final yang harus dipakai di mana pun produk "dibeli"
// (keranjang, checkout, ringkasan) — otomatis kembali ke harga
// normal begitu promo tidak lagi berlaku.
export function getEffectivePrice(product) {
    return isPromoRunning(product) ? getPromoPrice(product) : (Number(product.price) || 0);
}

// Ringkasan info promo untuk kebutuhan tampilan (badge, harga, countdown).
export function getPromoInfo(product) {
    const active = isPromoRunning(product);
    const originalPrice = Number(product.price) || 0;
    const promoPrice = active ? getPromoPrice(product) : originalPrice;
    const promo = product.promo || {};

    let discountLabel = null;
    if (active) {
        discountLabel = promo.type === 'percentage'
            ? `-${promo.value}%`
            : `-Rp ${Number(promo.value || 0).toLocaleString('id-ID')}`;
    }

    return {
        active,
        scheduled: isPromoScheduled(product),
        type: promo.type || null,
        value: promo.value || 0,
        originalPrice,
        promoPrice,
        discountLabel,
        endDate: active ? promo.endDate : null,
        startDate: promo.startDate || null
    };
}

// --- COUNTDOWN ---
// Format sisa waktu jadi teks "2 hari 05:12:33" atau "05:12:33".
export function formatCountdown(ms) {
    if (ms <= 0) return 'Promo berakhir';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (days > 0) return `${days} hari ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

// --- BADGE HTML (dipakai di kartu produk) ---
export function renderPromoBadgeHTML(product) {
    const info = getPromoInfo(product);
    if (!info.active) return '';
    return `<span class="promo-badge inline-flex items-center gap-1 bg-gradient-to-r from-amber-500 to-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase shadow pulse-badge">
        <i class="fa-solid fa-bolt"></i> PROMO ${info.discountLabel}
    </span>`;
}

// Blok harga (harga promo + harga coret + countdown) dipakai di kartu produk & modal.
export function renderPromoPriceBlockHTML(product, opts = {}) {
    const info = getPromoInfo(product);
    const priceSize = opts.priceSize || 'text-sm';
    const countdownVisible = opts.countdown !== false;

    if (!info.active) {
        return `<div class="flex items-center gap-1.5 mb-1 flex-wrap">
            <span class="font-black ${priceSize} text-slate-900">Rp ${info.originalPrice.toLocaleString('id-ID')}</span>
            ${product.originalPrice ? `<span class="text-[10px] text-slate-400 line-through">Rp ${Number(product.originalPrice).toLocaleString('id-ID')}</span>` : ''}
        </div>`;
    }

    return `
        <div class="flex items-center gap-1.5 mb-1 flex-wrap">
            <span class="font-black ${priceSize} text-rose-600">Rp ${info.promoPrice.toLocaleString('id-ID')}</span>
            <span class="text-[10px] text-slate-400 line-through">Rp ${info.originalPrice.toLocaleString('id-ID')}</span>
        </div>
        ${countdownVisible ? `<div class="flex items-center gap-1 text-[9px] text-rose-600 font-bold">
            <i class="fa-regular fa-clock"></i>
            <span data-promo-end="${info.endDate}">${formatCountdown(new Date(info.endDate).getTime() - Date.now())}</span>
        </div>` : ''}
    `;
}

// --- COUNTDOWN TICKER GLOBAL ---
// Berjalan tiap detik, memperbarui semua elemen [data-promo-end] di
// halaman manapun sedang tampil. Begitu ada promo yang baru saja
// berakhir, seluruh tampilan yang berkaitan (katalog, beranda,
// halaman promo, keranjang, admin) di-render ulang otomatis supaya
// badge & harga kembali normal tanpa perlu refresh halaman.
let tickerStarted = false;
export function startPromoCountdownTicker() {
    if (tickerStarted) return;
    tickerStarted = true;

    setInterval(() => {
        const els = document.querySelectorAll('[data-promo-end]');
        if (els.length === 0) return;

        let anyJustExpired = false;
        els.forEach((el) => {
            const endStr = el.getAttribute('data-promo-end');
            if (!endStr) return;
            const diff = new Date(endStr).getTime() - Date.now();
            if (diff <= 0) {
                anyJustExpired = true;
            } else {
                el.textContent = formatCountdown(diff);
            }
        });

        if (anyJustExpired) {
            if (typeof window.renderProductsCatalog === 'function') window.renderProductsCatalog();
            if (typeof window.renderLandingPage === 'function') window.renderLandingPage();
            if (typeof window.renderPromoPage === 'function') window.renderPromoPage();
            if (typeof window.updateCartUI === 'function') window.updateCartUI();
            if (window.state && window.state.viewMode === 'admin' && typeof window.renderAdminProductsTable === 'function') {
                window.renderAdminProductsTable();
            }
        }
    }, 1000);
}

// Expose ke window supaya bisa dipakai lintas modul non-import (mis. inline HTML)
window.getPromoInfo = getPromoInfo;
window.isPromoRunning = isPromoRunning;
window.getEffectivePrice = getEffectivePrice;
window.formatPromoCountdown = formatCountdown;

startPromoCountdownTicker();
