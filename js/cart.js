// ============================================================
// CART MODULE
// Tambah/ubah item keranjang, drawer keranjang, dan ringkasan
// checkout.
// ============================================================
import { state } from './state.js';

        window.addToCart = function(productId) {
            const p = state.products.find(item => item.id === productId);
            if (!p) return;

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

            if (currentQtyInCart + 1 > stock) {
                window.showToast(`Stok ${p.name} hanya tersisa ${stock}. Jumlah di keranjang sudah maksimal.`, 'error');
                return;
            }

            if (existing) {
                existing.qty++;
            } else {
                state.cart.push({ ...p, qty: 1 });
            }
            window.updateCartUI();
            window.showToast(`${p.name} ditambahkan ke keranjang!`, 'success');
        };

        function updateCartUI() {
            const badge = document.getElementById('cart-badge-count');
            const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
            if(badge) badge.textContent = totalQty;

            const cartContainer = document.getElementById('cart-items-container');
            const cartTotal = document.getElementById('cart-drawer-total');

            const totalAmount = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            if(cartTotal) cartTotal.textContent = `Rp ${totalAmount.toLocaleString('id-ID')}`;

            if (cartContainer) {
                if(state.cart.length === 0) {
                    cartContainer.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs"><i class="fa-solid fa-basket-shopping text-3xl mb-2"></i><p>Keranjang belanja kosong.</p></div>`;
                } else {
                    cartContainer.innerHTML = state.cart.map(item => {
                        const liveProduct = state.products.find(p => p.id === item.id);
                        const stock = liveProduct ? window.getProductStock(liveProduct) : Infinity;
                        const atMaxStock = item.qty >= stock;
                        return `
                        <div class="flex items-center gap-3 pt-3">
                            <img src="${item.image}" class="w-12 h-12 rounded-lg object-cover bg-slate-100">
                            <div class="flex-1">
                                <h5 class="font-bold text-xs text-slate-800 line-clamp-1">${item.name}</h5>
                                <p class="text-xs text-brand-600 font-bold">Rp ${item.price.toLocaleString('id-ID')}</p>
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

            const total = state.cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
            if(subtotalEl) subtotalEl.textContent = `Rp ${total.toLocaleString('id-ID')}`;
            if(totalEl) totalEl.textContent = `Rp ${total.toLocaleString('id-ID')}`;

            if (container) {
                container.innerHTML = state.cart.map(i => {
                    const liveProduct = state.products.find(p => p.id === i.id);
                    const stock = liveProduct ? window.getProductStock(liveProduct) : Infinity;
                    const overStock = i.qty > stock;
                    return `
                    <div class="text-xs">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-brand-600">${i.qty}x</span>
                                <span class="text-slate-700 line-clamp-1 max-w-[150px]">${i.name}</span>
                            </div>
                            <span class="font-bold text-slate-900">Rp ${(i.price * i.qty).toLocaleString('id-ID')}</span>
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

