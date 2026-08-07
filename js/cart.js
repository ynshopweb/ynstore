// ============================================================
// CART MODULE
// Tambah/ubah item keranjang, drawer keranjang, dan ringkasan
// checkout.
// ============================================================
import { state } from './state.js';
import { getEffectivePrice, getPromoInfo } from './promo.js';

        window.addToCart = function(productId, qty = 1) {
            const p = state.products.find(item => item.id === productId);
            if (!p) return;

            qty = Math.max(1, parseInt(qty) || 1);

            // --- VALIDASI STOK ---
            // Selalu ambil stok TERBARU dari state.products (bukan dari item
            // keranjang yang sudah ada), karena state.products diperbarui
            // realtime lewat Firestore onSnapshot.
            const stock = window.getProductStock(p);
            if (stock <= 0) {
                window.showToast(`${p.name} sedang habis stok.`, 'error');
                return;
            }

            const existing = state.cart.find(item => item.id === productId);
            const currentQtyInCart = existing ? existing.qty : 0;

            if (currentQtyInCart + qty > stock) {
                window.showToast(`Stok ${p.name} hanya tersisa ${stock}. Jumlah di keranjang sudah maksimal.`, 'error');
                return;
            }

            if (existing) {
                existing.qty += qty;
            } else {
                state.cart.push({ ...p, qty });
            }
            window.updateCartUI();
            window.showToast(`${p.name} ditambahkan ke keranjang!`, 'success');
        };

        // --- HARGA ITEM KERANJANG (SELALU HARGA TERKINI) ---
        // Keranjang tidak pernah memakai harga yang "dibekukan" saat item
        // ditambahkan. Setiap render selalu mengambil produk TERBARU dari
        // state.products (realtime Firestore) supaya harga promo yang
        // sedang berlangsung otomatis terpakai, dan begitu promo berakhir
        // harga otomatis kembali normal — tanpa perlu refresh halaman.
        function getCartItemUnitPrice(item) {
            const liveProduct = state.products.find(p => p.id === item.id);
            return liveProduct ? getEffectivePrice(liveProduct) : item.price;
        }

        function updateCartUI() {
            const badge = document.getElementById('cart-badge-count');
            const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
            if(badge) badge.textContent = totalQty;

            const cartContainer = document.getElementById('cart-items-container');
            const cartTotal = document.getElementById('cart-drawer-total');

            const totalAmount = state.cart.reduce((sum, item) => sum + (getCartItemUnitPrice(item) * item.qty), 0);
            if(cartTotal) cartTotal.textContent = `Rp ${totalAmount.toLocaleString('id-ID')}`;

            if (cartContainer) {
                if(state.cart.length === 0) {
                    cartContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs"><i class="fa-solid fa-basket-shopping text-3xl mb-2"></i><p>Keranjang belanja kosong.</p></div>`;
                } else {
                    cartContainer.innerHTML = state.cart.map(item => {
                        const liveProduct = state.products.find(p => p.id === item.id);
                        const stock = liveProduct ? window.getProductStock(liveProduct) : Infinity;
                        const atMaxStock = item.qty >= stock;
                        const promoInfo = liveProduct ? getPromoInfo(liveProduct) : { active: false, promoPrice: item.price, originalPrice: item.price };
                        return `
                        <div class="flex items-center gap-3 pt-3">
                            <img src="${item.image}" class="w-12 h-12 rounded-lg object-cover bg-slate-100">
                            <div class="flex-1">
                                <h5 class="font-bold text-xs text-slate-800 line-clamp-1">${item.name}</h5>
                                <div class="flex items-center gap-1.5">
                                    <p class="text-xs text-brand-600 font-bold">Rp ${promoInfo.promoPrice.toLocaleString('id-ID')}</p>
                                    ${promoInfo.active ? `<p class="text-[10px] text-slate-400 line-through">Rp ${promoInfo.originalPrice.toLocaleString('id-ID')}</p><span class="text-[9px] font-black text-white bg-rose-600 px-1.5 py-0.5 rounded-full uppercase">Promo</span>` : ''}
                                </div>
                                <div class="flex items-center gap-2 mt-1">
                                    <button onclick="window.changeCartQty('${item.id}', -1)" class="w-5 h-5 bg-slate-200 text-slate-700 rounded flex items-center justify-center font-bold text-xs">-</button>
                                    <span class="text-xs font-bold">${item.qty}</span>
                                    <button onclick="window.changeCartQty('${item.id}', 1)" ${atMaxStock ? 'disabled title="Stok maksimal tercapai"' : ''} class="w-5 h-5 ${atMaxStock ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-slate-200 text-slate-700'} rounded flex items-center justify-center font-bold text-xs">+</button>
                                    ${isFinite(stock) ? `<span class="text-[10px] text-slate-400">Stok: ${stock}</span>` : ''}
                                </div>
                            </div>
                        </div>
                    `;}).join('');
                }
            }
        }

        window.changeCartQty = function(id, delta) {
            const item = state.cart.find(i => i.id === id);
            if (item) {
                // --- VALIDASI STOK saat menambah jumlah (+) ---
                if (delta > 0) {
                    const liveProduct = state.products.find(p => p.id === id);
                    const stock = liveProduct ? window.getProductStock(liveProduct) : Infinity;
                    if (item.qty + delta > stock) {
                        window.showToast(`Stok ${item.name} hanya tersisa ${stock}.`, 'error');
                        return;
                    }
                }

                item.qty += delta;
                if (item.qty <= 0) {
                    state.cart = state.cart.filter(i => i.id !== id);
                }
                window.updateCartUI();
            }
        };

        window.toggleCartDrawer = function(open) {
            const drawer = document.getElementById('cart-drawer');
            const backdrop = document.getElementById('cart-drawer-backdrop');
            if (open) {
                drawer.classList.remove('translate-x-full');
                backdrop.classList.remove('hidden');
            } else {
                drawer.classList.add('translate-x-full');
                backdrop.classList.add('hidden');
            }
        };

        window.proceedToCheckout = function() {
            if (state.cart.length === 0) {
                window.showToast('Keranjang Anda kosong!', 'error');
                return;
            }

            // --- VALIDASI LOGIN SAAT TOMBOL CHECKOUT DITEKAN ---
            // Sumber kebenaran status login: Firebase Authentication (state.user
            // diisi oleh onAuthStateChanged di js/auth.js), bukan Local Storage.
            // Guest User dibatalkan prosesnya & diminta login/daftar terlebih
            // dahulu. Isi keranjang TIDAK dihapus/direfresh.
            if (!state.user) {
                state.pendingRedirect = 'checkout';
                window.pendingRedirect = 'checkout';
                if (typeof window.showLoginRequiredModal === 'function') {
                    window.showLoginRequiredModal();
                } else if (typeof window.openAuthModal === 'function') {
                    window.openAuthModal('login');
                }
                return;
            }

            window.toggleCartDrawer(false);
            window.renderCheckoutSummary();
            window.navigateTo('checkout');
        };

        function renderCheckoutSummary() {
            const container = document.getElementById('checkout-summary-items');
            const subtotalEl = document.getElementById('checkout-subtotal');
            const totalEl = document.getElementById('checkout-total-price');

            // Total checkout SELALU dihitung dari harga terkini (promo yang
            // masih berlaku), bukan harga yang tersimpan saat item ditambahkan.
            const total = state.cart.reduce((sum, i) => sum + (getCartItemUnitPrice(i) * i.qty), 0);
            if(subtotalEl) subtotalEl.textContent = `Rp ${total.toLocaleString('id-ID')}`;
            if(totalEl) totalEl.textContent = `Rp ${total.toLocaleString('id-ID')}`;

            if (container) {
                container.innerHTML = state.cart.map(i => {
                    const liveProduct = state.products.find(p => p.id === i.id);
                    const stock = liveProduct ? window.getProductStock(liveProduct) : Infinity;
                    const overStock = i.qty > stock;
                    const promoInfo = liveProduct ? getPromoInfo(liveProduct) : { active: false, promoPrice: i.price };
                    const lineTotal = promoInfo.promoPrice * i.qty;
                    return `
                    <div class="text-xs">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-brand-600">${i.qty}x</span>
                                <span class="text-slate-700 line-clamp-1 max-w-[150px]">${i.name}</span>
                                ${promoInfo.active ? '<span class="text-[9px] font-black text-white bg-rose-600 px-1.5 py-0.5 rounded-full uppercase">Promo</span>' : ''}
                            </div>
                            <span class="font-bold text-slate-900">Rp ${lineTotal.toLocaleString('id-ID')}</span>
                        </div>
                        ${overStock ? `<p class="text-rose-500 font-semibold mt-0.5">Stok tersisa hanya ${stock}, kurangi jumlah di keranjang.</p>` : ''}
                    </div>
                `;}).join('');
            }
            window.renderTimeSlots();
        }

// Dipakai juga oleh checkout.js (submit pesanan) & modul lain
window.updateCartUI = updateCartUI;
window.renderCheckoutSummary = renderCheckoutSummary;
window.getCartItemUnitPrice = getCartItemUnitPrice;

