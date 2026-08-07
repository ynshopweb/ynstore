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
            if(state.viewMode === 'admin') window.renderAdminProductsTable();
        }
    }, (err) => {
        console.warn("Firestore snapshot products, falling back to local list:", err);
        state.products = INITIAL_PRODUCTS;
        window.renderProductsCatalog();
        window.renderLandingPage();
    });
}

function renderLandingPage() {
    const categoriesGrid = document.getElementById('landing-categories-grid');
    const bestsellerGrid = document.getElementById('bestseller-products-grid');

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
}

function createProductCardHTML(product) {
    const stock = getProductStock(product);
    const isOutOfStock = stock <= 0;
    const isLowStock = stock > 0 && stock <= 5;

    let stockBadge = '';
    if (isOutOfStock) {
        stockBadge = `<span class="absolute top-2 right-2 bg-slate-800/90 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">Stok Habis</span>`;
    } else if (isLowStock) {
        stockBadge = `<span class="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">Sisa ${stock}</span>`;
    }

    return `
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col group ${isOutOfStock ? 'opacity-75' : ''}">
            <div class="relative overflow-hidden aspect-square bg-slate-100 cursor-pointer" onclick="window.openProductDetail('${product.id}')">
                <img src="${product.image}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                ${product.isBestseller ? '<span class="absolute top-2 left-2 bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">HOT</span>' : ''}
                ${stockBadge}
            </div>
            <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                <div>
                    <span class="text-[10px] font-bold text-brand-600 uppercase tracking-wider">${product.brand}</span>
                    <h4 onclick="window.openProductDetail('${product.id}')" class="font-bold text-xs text-slate-800 line-clamp-2 hover:text-brand-600 cursor-pointer transition">${product.name}</h4>
                    ${isFinite(stock) ? `<p class="text-[10px] ${isOutOfStock ? 'text-rose-500 font-bold' : 'text-slate-400'} mt-0.5">${isOutOfStock ? 'Stok habis' : `Stok tersedia: ${stock}`}</p>` : ''}
                </div>
                <div>
                    <div class="flex items-center gap-1.5 mb-1">
                        <span class="font-black text-sm text-slate-900">Rp ${product.price.toLocaleString('id-ID')}</span>
                        ${product.originalPrice ? `<span class="text-[10px] text-slate-400 line-through">Rp ${product.originalPrice.toLocaleString('id-ID')}</span>` : ''}
                    </div>
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

window.openProductDetail = function(id) {
    const p = state.products.find(item => item.id === id);
    if(!p) return;

    const modal = document.getElementById('product-detail-modal');
    const card = document.getElementById('product-detail-card');
    if (!modal || !card) return;

    const stock = getProductStock(p);
    const isOutOfStock = stock <= 0;
    const stockInfo = isFinite(stock)
        ? `<span class="text-xs font-bold ${isOutOfStock ? 'text-rose-600' : 'text-emerald-600'} bg-${isOutOfStock ? 'rose' : 'emerald'}-50 px-2.5 py-1 rounded-full border border-${isOutOfStock ? 'rose' : 'emerald'}-200/60"><i class="fa-solid ${isOutOfStock ? 'fa-circle-xmark' : 'fa-check'} me-1"></i> ${isOutOfStock ? 'Stok Habis' : `Stok: ${stock}`}</span>`
        : '';

    card.innerHTML = `
        <button onclick="document.getElementById('product-detail-modal').classList.add('hidden')" class="absolute top-3 right-3 text-slate-400 hover:text-slate-600 z-10 p-1"><i class="fa-solid fa-xmark text-lg"></i></button>
        <div class="aspect-square bg-slate-100">
            <img src="${p.image}" class="w-full h-full object-cover">
        </div>
        <div class="p-6 flex flex-col justify-between space-y-4">
            <div>
                <span class="text-xs font-bold text-brand-600 uppercase tracking-wider">${p.brand}</span>
                <h3 class="text-lg font-bold text-slate-900 mt-1">${p.name}</h3>
                <p class="text-xs text-slate-500 mt-2 leading-relaxed">${p.description || 'Produk skincare original ber BPOM.'}</p>
            </div>
            <div>
                <div class="flex items-center gap-2 mb-4">
                    <p class="text-xl font-black text-brand-600">Rp ${p.price.toLocaleString('id-ID')}</p>
                    ${stockInfo}
                </div>
                <button onclick="window.addToCart('${p.id}'); document.getElementById('product-detail-modal').classList.add('hidden')" ${isOutOfStock ? 'disabled' : ''} class="w-full py-3 ${isOutOfStock ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-700 text-white'} font-bold text-xs rounded-xl shadow transition flex items-center justify-center gap-2">
                    <i class="fa-solid ${isOutOfStock ? 'fa-ban' : 'fa-cart-plus'}"></i> ${isOutOfStock ? 'Stok Habis' : 'Tambah Ke Keranjang'}
                </button>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');
};

// Beberapa fungsi dipakai lintas modul (mis. admin.js) lewat window
window.renderProductsCatalog = renderProductsCatalog;
window.renderLandingPage = renderLandingPage;
window.createProductCardHTML = createProductCardHTML;
window.renderFilterOptions = renderFilterOptions;
