// ============================================================
// CART MODULE
// Tambah/ubah item keranjang, drawer keranjang, dan ringkasan
// checkout.
// ============================================================
import { state } from './state.js';

        window.addToCart = function(productId) {
            const p = state.products.find(item => item.id === productId);
            if (!p) return;
            const existing = state.cart.find(item => item.id === productId);
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
                    cartContainer.innerHTML = state.cart.map(item => `
                        <div class="flex items-center gap-3 pt-3">
                            <img src="${item.image}" class="w-12 h-12 rounded-lg object-cover bg-slate-100">
                            <div class="flex-1">
                                <h5 class="font-bold text-xs text-slate-800 line-clamp-1">${item.name}</h5>
                                <p class="text-xs text-brand-600 font-bold">Rp ${item.price.toLocaleString('id-ID')}</p>
                                <div class="flex items-center gap-2 mt-1">
                                    <button onclick="window.changeCartQty('${item.id}', -1)" class="w-5 h-5 bg-slate-200 text-slate-700 rounded flex items-center justify-center font-bold text-xs">-</button>
                                    <span class="text-xs font-bold">${item.qty}</span>
                                    <button onclick="window.changeCartQty('${item.id}', 1)" class="w-5 h-5 bg-slate-200 text-slate-700 rounded flex items-center justify-center font-bold text-xs">+</button>
                                </div>
                            </div>
                        </div>
                    `).join('');
                }
            }
        }

        window.changeCartQty = function(id, delta) {
            const item = state.cart.find(i => i.id === id);
            if (item) {
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
                container.innerHTML = state.cart.map(i => `
                    <div class="flex justify-between items-center text-xs">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-brand-600">${i.qty}x</span>
                            <span class="text-slate-700 line-clamp-1 max-w-[150px]">${i.name}</span>
                        </div>
                        <span class="font-bold text-slate-900">Rp ${(i.price * i.qty).toLocaleString('id-ID')}</span>
                    </div>
                `).join('');
            }
            window.renderTimeSlots();
        }

// Dipakai juga oleh checkout.js (submit pesanan) & modul lain
window.updateCartUI = updateCartUI;
window.renderCheckoutSummary = renderCheckoutSummary;

