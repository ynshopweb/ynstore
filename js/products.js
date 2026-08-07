// ============================================================
// PRODUCTS MODULE
// Render landing page, katalog produk, filter, pencarian, dan
// modal detail produk (sisi customer). CRUD produk ada di admin.js
// ============================================================
import { collection, onSnapshot, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state, INITIAL_PRODUCTS } from './state.js';

// --- HELPER STOK ---
// Produk lama (dibuat sebelum fitur stok ada) mungkin belum punya field
// `stock`. Supaya tidak merusak tampilan/fungsi yang sudah berjalan,
// produk tanpa field stok dianggap TIDAK dibatasi (Infinity) sampai admin
// mengisi stoknya lewat form Tambah/Edit Produk.
function getProductStock(product) {
    return (typeof product?.stock === 'number' && !isNaN(product.stock)) ? product.stock : Infinity;
}
window.getProductStock = getProductStock;

// --- HELPER PROMO PRODUK ---
// Promo BUKAN data terpisah — ia melekat pada setiap produk lewat field
// `promo` di dokumen produk itu sendiri:
//   promo: { active: true, type: 'percentage'|'nominal', value: number,
//             startDate: <ms epoch>, endDate: <ms epoch> }
// Produk tanpa field `promo` (semua produk lama) diperlakukan persis
// seperti sebelumnya (tidak ada perubahan tampilan/harga sama sekali).
//
// Fungsi ini adalah SATU-SATUNYA sumber kebenaran untuk menghitung harga
// final sebuah produk saat ini juga, dipakai bersama oleh: kartu produk,
// modal detail, halaman Promo, beranda, keranjang, DAN transaksi checkout
// (checkout membaca ulang dokumen produk & memanggil fungsi ini lagi
// dengan data TERBARU, supaya harga promo yang dipakai selalu yang masih
// berlaku persis pada detik checkout dilakukan).
function getPromoInfo(product) {
    const originalPrice = product?.price || 0;
    const promo = product?.promo;

    const result = {
        active: false,
        type: promo?.type === 'nominal' ? 'nominal' : 'percentage',
        value: promo?.value || 0,
        originalPrice,
        finalPrice: originalPrice,
        discountAmount: 0,
        startDate: promo?.startDate || null,
        endDate: promo?.endDate || null,
        msRemaining: null
    };

    if (!promo || !promo.active) return result;

    const now = Date.now();
    if (promo.startDate && now < promo.startDate) return result; // promo belum mulai
    if (promo.endDate && now > promo.endDate) return result; // promo sudah berakhir -> harga kembali normal

    let finalPrice = originalPrice;
    if (result.type === 'nominal') {
        finalPrice = Math.max(0, originalPrice - (promo.value || 0));
    } else {
        const pct = Math.min(Math.max(promo.value || 0, 0), 100);
        finalPrice = Math.round(originalPrice - (originalPrice * pct / 100));
    }

    result.active = true;
    result.finalPrice = finalPrice;
    result.discountAmount = originalPrice - finalPrice;
    result.msRemaining = promo.endDate ? (promo.endDate - now) : null;
    return result;
}
window.getPromoInfo = getPromoInfo;

// --- FORMAT SISA WAKTU COUNTDOWN PROMO ("2h 05:23:11" / "05:23:11") ---
function formatPromoCountdown(ms) {
    if (ms === null || ms === undefined || ms <= 0) return 'Promo berakhir';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad2 = n => String(n).padStart(2, '0');
    return days > 0 ? `${days}h ${pad2(hours)}:${pad2(mins)}:${pad2(secs)}` : `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`;
}
window.formatPromoCountdown = formatPromoCountdown;

// --- TICKER GLOBAL UNTUK COUNTDOWN PROMO ---
// Satu interval global (1x per detik) yang meng-update SEMUA elemen
// countdown promo yang sedang tampil di layar (kartu produk, modal detail,
// halaman Promo) lewat atribut `data-promo-end`, tanpa perlu render ulang
// seluruh grid setiap detik. Kalau ada promo yang baru saja berakhir saat
// ticker jalan, grid terkait di-refresh sekali supaya harga & badge-nya
// otomatis kembali normal.
let promoTickerStarted = false;
function startPromoCountdownTicker() {
    if (promoTickerStarted) return;
    promoTickerStarted = true;
    setInterval(() => {
        let anyExpired = false;
        document.querySelectorAll('[data-promo-end]').forEach(el => {
            const end = parseInt(el.getAttribute('data-promo-end'), 10);
            if (!end) return;
            const remaining = end - Date.now();
            if (remaining <= 0) {
                anyExpired = true;
                return;
            }
            el.textContent = formatPromoCountdown(remaining);
        });
        if (anyExpired) {
            if (typeof window.renderProductsCatalog === 'function') window.renderProductsCatalog();
            if (typeof window.renderLandingPage === 'function') window.renderLandingPage();
            if (typeof window.renderPromoPage === 'function') window.renderPromoPage();
        }
    }, 1000);
}
startPromoCountdownTicker();

// --- FIRESTORE SNAPSHOT PRODUK (real-time) ---
export function setupProductsSnapshot() {
    const productsCol = collection(db, 'artifacts', appId, 'products');
    onSnapshot(productsCol, (snapshot) => {
        if (snapshot.empty) {
            // Seed initial products jika koleksi masih kosong
            INITIAL_PRODUCTS.forEach(p => {
                setDoc(doc(db, 'artifacts', appId, 'products', p.id), p);
            });
        } else {
            const list = [];
            snapshot.forEach(d => list.push({ id: d.id, ...d.data() }));
            state.products = list;
            window.renderProductsCatalog();
            window.renderLandingPage();
            window.renderPromoPage();
            if(state.viewMode === 'admin') window.renderAdminProductsTable();
        }
    }, (err) => {
        console.warn("Firestore snapshot products, falling back to local list:", err);
        state.products = INITIAL_PRODUCTS;
        window.renderProductsCatalog();
        window.renderLandingPage();
        window.renderPromoPage();
    });
}

function renderLandingPage() {
    const categoriesGrid = document.getElementById('landing-categories-grid');
    const bestsellerGrid = document.getElementById('bestseller-products-grid');
    const promoSection = document.getElementById('landing-promo-section');
    const promoGrid = document.getElementById('landing-promo-grid');

    const categories = [
        { name: 'Moisturizer', icon: 'fa-droplet', color: 'bg-blue-50 text-blue-600' },
        { name: 'Sunscreen', icon: 'fa-sun', color: 'bg-amber-50 text-amber-600' },
        { name: 'Serum', icon: 'fa-flask', color: 'bg-purple-50 text-purple-600' },
        { name: 'Cushion', icon: 'fa-compact-disc', color: 'bg-rose-50 text-rose-600' },
        { name: 'Cleanser', icon: 'fa-soap', color: 'bg-emerald-50 text-emerald-600' },
        { name: 'Lip Care', icon: 'fa-heart', color: 'bg-pink-50 text-pink-600' }
    ];

    if(categoriesGrid) {
        categoriesGrid.innerHTML = categories.map(c => `
            <div onclick="window.filterByCategory('${c.name}')" class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition text-center cursor-pointer group">
                <div class="w-12 h-12 rounded-xl ${c.color} flex items-center justify-center text-xl mx-auto mb-2 group-hover:scale-110 transition-transform">
                    <i class="fa-solid ${c.icon}"></i>
                </div>
                <p class="font-bold text-xs text-slate-800">${c.name}</p>
            </div>
        `).join('');
    }

    if(bestsellerGrid) {
        const bests = state.products.filter(p => p.isBestseller).slice(0, 5);
        bestsellerGrid.innerHTML = bests.map(p => window.createProductCardHTML(p)).join('');
    }

    // --- PRODUK LAGI PROMO (Beranda) — otomatis dari produk yang promonya aktif ---
    if (promoGrid && promoSection) {
        const promoProducts = state.products.filter(p => getPromoInfo(p).active).slice(0, 5);
        if (promoProducts.length > 0) {
            promoSection.classList.remove('hidden');
            promoGrid.innerHTML = promoProducts.map(p => window.createProductCardHTML(p)).join('');
        } else {
            promoSection.classList.add('hidden');
            promoGrid.innerHTML = '';
        }
    }
}

// --- HALAMAN PROMO — otomatis menampilkan SEMUA produk dengan promo aktif ---
function renderPromoPage() {
    const grid = document.getElementById('promo-products-grid');
    const emptyState = document.getElementById('promo-empty-state');
    const countLabel = document.getElementById('promo-count-label');
    if (!grid) return;

    const promoProducts = state.products.filter(p => getPromoInfo(p).active);

    if (countLabel) countLabel.textContent = `${promoProducts.length} produk`;

    if (promoProducts.length === 0) {
        grid.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    grid.innerHTML = promoProducts.map(p => window.createProductCardHTML(p)).join('');
}
window.renderPromoPage = renderPromoPage;

function createProductCardHTML(product) {
    const stock = getProductStock(product);
    const isOutOfStock = stock <= 0;
    const isLowStock = stock > 0 && stock <= 5;
    const promoInfo = getPromoInfo(product);

    let stockBadge = '';
    if (isOutOfStock) {
        stockBadge = `<span class="absolute top-2 right-2 bg-slate-800/90 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">Stok Habis</span>`;
    } else if (isLowStock) {
        stockBadge = `<span class="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">Sisa ${stock}</span>`;
    }

    // --- BADGE PROMO (pojok kiri, menggantikan badge HOT saat promo aktif) ---
    let cornerBadge = '';
    if (promoInfo.active) {
        const promoLabel = promoInfo.type === 'nominal'
            ? `-Rp${promoInfo.value.toLocaleString('id-ID')}`
            : `-${promoInfo.value}%`;
        cornerBadge = `<span class="absolute top-2 left-2 bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase flex items-center gap-1"><i class="fa-solid fa-tag"></i> PROMO ${promoLabel}</span>`;
    } else if (product.isBestseller) {
        cornerBadge = '<span class="absolute top-2 left-2 bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">HOT</span>';
    }

    // --- BLOK HARGA (harga promo vs harga normal) ---
    let priceBlock;
    if (promoInfo.active) {
        priceBlock = `
            <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <span class="font-black text-sm text-rose-600">Rp ${promoInfo.finalPrice.toLocaleString('id-ID')}</span>
                <span class="text-[10px] text-slate-400 line-through">Rp ${promoInfo.originalPrice.toLocaleString('id-ID')}</span>
            </div>
            ${promoInfo.endDate ? `<p class="text-[9px] font-bold text-rose-500 mb-1"><i class="fa-regular fa-clock me-0.5"></i>Berakhir: <span data-promo-end="${promoInfo.endDate}">${formatPromoCountdown(promoInfo.msRemaining)}</span></p>` : ''}
        `;
    } else {
        priceBlock = `
            <div class="flex items-center gap-1.5 mb-1">
                <span class="font-black text-sm text-slate-900">Rp ${product.price.toLocaleString('id-ID')}</span>
                ${product.originalPrice ? `<span class="text-[10px] text-slate-400 line-through">Rp ${product.originalPrice.toLocaleString('id-ID')}</span>` : ''}
            </div>
        `;
    }

    return `
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col group ${isOutOfStock ? 'opacity-75' : ''}">
            <div class="relative overflow-hidden aspect-square bg-slate-100 cursor-pointer" onclick="window.openProductDetail('${product.id}')">
                <img src="${product.image}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                ${cornerBadge}
                ${stockBadge}
            </div>
            <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                <div>
                    <span class="text-[10px] font-bold text-brand-600 uppercase tracking-wider">${product.brand}</span>
                    <h4 onclick="window.openProductDetail('${product.id}')" class="font-bold text-xs text-slate-800 line-clamp-2 hover:text-brand-600 cursor-pointer transition">${product.name}</h4>
                    ${isFinite(stock) ? `<p class="text-[10px] ${isOutOfStock ? 'text-rose-500 font-bold' : 'text-slate-400'} mt-0.5">${isOutOfStock ? 'Stok habis' : `Stok tersedia: ${stock}`}</p>` : ''}
                </div>
                <div>
                    ${priceBlock}
                    <button onclick="window.addToCart('${product.id}')" ${isOutOfStock ? 'disabled' : ''} class="w-full py-2 ${isOutOfStock ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-brand-50 hover:bg-brand-600 text-brand-700 hover:text-white'} font-bold text-xs rounded-xl transition flex items-center justify-center gap-1">
                        <i class="fa-solid ${isOutOfStock ? 'fa-ban' : 'fa-cart-plus'}"></i> ${isOutOfStock ? 'Stok Habis' : 'Tambah'}
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderProductsCatalog() {
    const grid = document.getElementById('catalog-products-grid');
    const countLabel = document.getElementById('catalog-count-label');
    if(!grid) return;

    let list = [...state.products];
    const f = state.activeFilters;

    if (f.brand !== 'all') list = list.filter(p => p.brand === f.brand);
    if (f.category !== 'all') list = list.filter(p => p.category === f.category);
    if (f.maxPrice) list = list.filter(p => p.price <= f.maxPrice);
    if (f.search) list = list.filter(p => p.name.toLowerCase().includes(f.search.toLowerCase()));

    if (f.sortBy === 'price-low') list.sort((a,b) => a.price - b.price);
    else if (f.sortBy === 'price-high') list.sort((a,b) => b.price - a.price);

    if(countLabel) countLabel.textContent = `${list.length} Produk`;

    if(list.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-400"><i class="fa-solid fa-boxes-packing text-4xl mb-2"></i><p class="text-xs">Produk tidak ditemukan.</p></div>`;
        return;
    }

    grid.innerHTML = list.map(p => window.createProductCardHTML(p)).join('');
    window.renderFilterOptions();
}

function renderFilterOptions() {
    const brands = ['all', ...new Set(state.products.map(p => p.brand))];
    const categories = ['all', ...new Set(state.products.map(p => p.category))];

    const brandContainer = document.getElementById('filter-brand-options');
    if (brandContainer) {
        brandContainer.innerHTML = brands.map(b => `
            <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="radio" name="filter-brand" value="${b}" ${state.activeFilters.brand === b ? 'checked' : ''} onchange="window.state.activeFilters.brand='${b}'; window.applyProductFilters();" class="accent-brand-600">
                <span>${b === 'all' ? 'Semua Brand' : b}</span>
            </label>
        `).join('');
    }

    const categoryContainer = document.getElementById('filter-category-options');
    if (categoryContainer) {
        categoryContainer.innerHTML = categories.map(c => `
            <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="radio" name="filter-category" value="${c}" ${state.activeFilters.category === c ? 'checked' : ''} onchange="window.state.activeFilters.category='${c}'; window.applyProductFilters();" class="accent-brand-600">
                <span>${c === 'all' ? 'Semua Kategori' : c}</span>
            </label>
        `).join('');
    }
}

window.filterByCategory = function(cat) {
    state.activeFilters.category = cat;
    window.navigateTo('products');
    window.renderProductsCatalog();
};

window.resetFilters = function() {
    state.activeFilters = { brand: 'all', category: 'all', maxPrice: 500000, search: '', sortBy: 'latest' };
    document.getElementById('catalog-search-input').value = '';
    window.renderProductsCatalog();
};

window.updatePriceLabel = function(val) {
    document.getElementById('filter-price-val').textContent = `Rp ${parseInt(val).toLocaleString('id-ID')}`;
    state.activeFilters.maxPrice = parseInt(val);
    window.applyProductFilters();
};

window.applyProductFilters = function() {
    window.renderProductsCatalog();
};

window.executeGlobalSearch = function(isMobile = false) {
    const input = document.getElementById(isMobile ? 'mobile-search-input' : 'global-search-input');
    if (input && input.value.trim()) {
        state.activeFilters.search = input.value.trim();
        window.navigateTo('products');
        window.renderProductsCatalog();
    }
};

// Menyimpan produk yang sedang ditampilkan di modal detail (dipakai oleh
// adjustModalQty & addToCartFromModal). Direset saat modal ditutup.
let currentModalProduct = null;

window.openProductDetail = function(id) {
    const p = state.products.find(item => item.id === id);
    if(!p) return;

    currentModalProduct = p;

    const modal = document.getElementById('product-detail-modal');
    const card = document.getElementById('product-modal-card');
    if (!modal || !card) return;

    const stock = getProductStock(p);
    const isOutOfStock = stock <= 0;
    const promoInfo = getPromoInfo(p);

    // Gambar, judul, kategori, harga, deskripsi
    const imgEl = document.getElementById('modal-product-image');
    if (imgEl) imgEl.src = p.image;
    const titleEl = document.getElementById('modal-product-title');
    if (titleEl) titleEl.textContent = p.name;
    const stickyTitleEl = document.getElementById('modal-sticky-title-text');
    if (stickyTitleEl) stickyTitleEl.textContent = p.name;
    const categoryEl = document.getElementById('modal-product-category');
    if (categoryEl) categoryEl.textContent = p.category || p.brand || '-';
    const descEl = document.getElementById('modal-product-description');
    if (descEl) descEl.textContent = p.description || 'Produk skincare original ber BPOM.';
    const ratingEl = document.getElementById('modal-product-rating');
    if (ratingEl) ratingEl.textContent = p.rating || '5.0';
    const salesEl = document.getElementById('modal-product-sales');
    if (salesEl) salesEl.textContent = `(${p.sales || 0} terjual)`;

    // --- HARGA & PROMO ---
    const priceEl = document.getElementById('modal-product-price');
    const origPriceEl = document.getElementById('modal-product-original-price');
    const promoBadgeEl = document.getElementById('modal-promo-badge');
    const promoCountdownWrap = document.getElementById('modal-promo-countdown-wrap');
    if (promoInfo.active) {
        if (priceEl) { priceEl.textContent = `Rp ${promoInfo.finalPrice.toLocaleString('id-ID')}`; priceEl.className = 'text-2xl sm:text-3xl font-extrabold text-rose-600'; }
        if (origPriceEl) { origPriceEl.textContent = `Rp ${promoInfo.originalPrice.toLocaleString('id-ID')}`; origPriceEl.classList.remove('hidden'); }
        if (promoBadgeEl) {
            const label = promoInfo.type === 'nominal' ? `-Rp${promoInfo.value.toLocaleString('id-ID')}` : `-${promoInfo.value}%`;
            promoBadgeEl.innerHTML = `<i class="fa-solid fa-tag me-1"></i>PROMO ${label}`;
            promoBadgeEl.classList.remove('hidden');
        }
        if (promoCountdownWrap) {
            if (promoInfo.endDate) {
                const span = promoCountdownWrap.querySelector('[data-promo-end]');
                if (span) {
                    span.setAttribute('data-promo-end', promoInfo.endDate);
                    span.textContent = formatPromoCountdown(promoInfo.msRemaining);
                }
                promoCountdownWrap.classList.remove('hidden');
            } else {
                promoCountdownWrap.classList.add('hidden');
            }
        }
    } else {
        if (priceEl) { priceEl.textContent = `Rp ${p.price.toLocaleString('id-ID')}`; priceEl.className = 'text-2xl sm:text-3xl font-extrabold text-brand-600'; }
        if (origPriceEl) origPriceEl.classList.add('hidden');
        if (promoBadgeEl) promoBadgeEl.classList.add('hidden');
        if (promoCountdownWrap) promoCountdownWrap.classList.add('hidden');
    }

    // --- BADGE STOK (real-time dari state.products) ---
    const stockBadge = document.getElementById('modal-product-stock-badge');
    if (stockBadge) {
        if (isOutOfStock) {
            stockBadge.className = 'text-xs text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200/60';
            stockBadge.innerHTML = '<i class="fa-solid fa-circle-xmark me-1"></i> Stok Habis';
        } else if (isFinite(stock)) {
            stockBadge.className = 'text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60';
            stockBadge.innerHTML = `<i class="fa-solid fa-check me-1"></i> Stok: ${stock}`;
        } else {
            stockBadge.className = 'text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60';
            stockBadge.innerHTML = '<i class="fa-solid fa-check me-1"></i> Stok Tersedia';
        }
    }

    // --- SELEKTOR JUMLAH ---
    const qtyInput = document.getElementById('modal-product-qty');
    const qtySelector = document.getElementById('modal-qty-selector');
    if (qtyInput) {
        qtyInput.value = 1;
        qtyInput.max = isFinite(stock) ? Math.max(stock, 1) : 99;
    }
    if (qtySelector) {
        qtySelector.classList.toggle('hidden', isOutOfStock);
    }

    // --- TOMBOL TAMBAH KE KERANJANG ---
    const addBtn = document.getElementById('modal-add-to-cart-btn');
    if (addBtn) {
        if (isOutOfStock) {
            addBtn.disabled = true;
            addBtn.className = 'w-full py-3.5 px-5 rounded-2xl bg-slate-200 text-slate-400 cursor-not-allowed font-bold text-xs sm:text-sm flex items-center justify-center gap-2';
            addBtn.innerHTML = '<i class="fa-solid fa-ban"></i><span>Stock Habis</span>';
        } else {
            addBtn.disabled = false;
            addBtn.className = 'w-full py-3.5 px-5 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs sm:text-sm shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40 transition-all active:scale-95 flex items-center justify-center gap-2';
            addBtn.innerHTML = '<i class="fa-solid fa-bag-shopping"></i><span>+ Keranjang</span>';
        }
        addBtn.onclick = function() { window.addToCartFromModal(); };
    }

    // --- BUKA MODAL (animasi fade + slide) ---
    modal.classList.remove('opacity-0', 'pointer-events-none');
    card.classList.remove('translate-y-8', 'sm:scale-95');
    document.body.classList.add('overflow-hidden');
};

// --- TUTUP MODAL (tombol X, klik di luar modal, atau tombol ESC) ---
window.closeProductDetailModal = function() {
    const modal = document.getElementById('product-detail-modal');
    const card = document.getElementById('product-modal-card');
    if (modal) modal.classList.add('opacity-0', 'pointer-events-none');
    if (card) card.classList.add('translate-y-8', 'sm:scale-95');
    document.body.classList.remove('overflow-hidden');
    currentModalProduct = null;
};

// --- TUTUP MODAL DENGAN TOMBOL ESC ---
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && currentModalProduct) {
        window.closeProductDetailModal();
    }
});

// --- ATUR JUMLAH DI DALAM MODAL (tombol - / +) ---
window.adjustModalQty = function(delta) {
    if (!currentModalProduct) return;
    const qtyInput = document.getElementById('modal-product-qty');
    if (!qtyInput) return;
    const max = parseInt(qtyInput.max) || 99;
    let val = (parseInt(qtyInput.value) || 1) + delta;
    val = Math.max(1, Math.min(max, val));
    qtyInput.value = val;
};

// --- TAMBAH KE KERANJANG DARI DALAM MODAL (memakai jumlah yang dipilih) ---
window.addToCartFromModal = function() {
    if (!currentModalProduct) return;
    const stock = getProductStock(currentModalProduct);
    if (stock <= 0) return;

    const qtyInput = document.getElementById('modal-product-qty');
    const qty = qtyInput ? (parseInt(qtyInput.value) || 1) : 1;

    window.addToCart(currentModalProduct.id, qty);
    window.closeProductDetailModal();
};

// Beberapa fungsi dipakai lintas modul (mis. admin.js) lewat window
window.renderProductsCatalog = renderProductsCatalog;
window.renderLandingPage = renderLandingPage;
window.createProductCardHTML = createProductCardHTML;
window.renderFilterOptions = renderFilterOptions;
