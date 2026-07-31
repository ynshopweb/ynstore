// ============================================================
// CHECKOUT MODULE
// Form checkout, slot pick up, submit pesanan, dan upload bukti
// pembayaran QRIS.
// ============================================================
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state } from './state.js';

        window.renderTimeSlots = function() {
            const container = document.getElementById('time-slots-container');
            const slots = ['08.00 - 09.00', '09.00 - 10.00', '10.00 - 11.00', '13.00 - 14.00', '14.00 - 15.00', '16.00 - 17.00', '18.00 - 19.00'];
            if (container) {
                container.innerHTML = slots.map(s => `
                    <button type="button" onclick="window.selectTimeSlot('${s}', this)" class="slot-btn border border-slate-200 rounded-lg p-2 text-[11px] font-semibold text-slate-700 hover:border-brand-500 hover:bg-rose-50 transition">
                        ${s} WIB
                    </button>
                `).join('');
            }
        };

        window.selectTimeSlot = function(slot, btn) {
            document.querySelectorAll('.slot-btn').forEach(b => {
                b.classList.remove('border-brand-600', 'bg-rose-50', 'text-brand-700', 'font-bold');
            });
            btn.classList.add('border-brand-600', 'bg-rose-50', 'text-brand-700', 'font-bold');
            document.getElementById('checkout-selected-slot').value = slot;
        };

        window.handleCheckoutSubmit = async function(e) {
            e.preventDefault();
            const slot = document.getElementById('checkout-selected-slot').value;
            if (!slot) {
                window.showToast('Silakan pilih jam pengambilan di toko!', 'error');
                return;
            }

            const name = document.getElementById('checkout-name').value;
            const phone = document.getElementById('checkout-phone').value;
            const email = document.getElementById('checkout-email').value;
            const pickupDate = document.getElementById('checkout-pickup-date').value;
            const notes = document.getElementById('checkout-notes').value;

            const totalAmount = state.cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
            const orderId = 'YN-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(1000 + Math.random() * 9000);

            const orderData = {
                orderId,
                customerName: name,
                customerPhone: phone,
                customerEmail: email,
                userId: state.user ? state.user.uid : 'guest',
                pickupDate,
                pickupSlot: slot,
                notes,
                items: state.cart,
                totalAmount,
                status: 'Menunggu Pembayaran',
                proofImage: null,
                createdAt: Date.now()
            };

            try {
                await setDoc(doc(db, 'artifacts', appId, 'orders', orderId), orderData);
                state.currentOrderPayment = orderData;
                state.cart = [];
                window.updateCartUI();

                document.getElementById('pay-order-number').textContent = orderId;
                document.getElementById('pay-total-amount').textContent = `Rp ${totalAmount.toLocaleString('id-ID')}`;
                
                window.navigateTo('payment');
                window.showToast('Pesanan berhasil dibuat. Silakan bayar via QRIS DANA.', 'success');
            } catch (err) {
                console.error("Error creating order:", err);
                window.showToast('Gagal membuat pesanan: ' + err.message, 'error');
            }
        };

        window.handleProofFileChange = function(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    state.proofBase64 = e.target.result;
                    const preview = document.getElementById('upload-preview-img');
                    const placeholder = document.getElementById('upload-placeholder');
                    preview.src = e.target.result;
                    preview.classList.remove('hidden');
                    placeholder.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            }
        };

        window.submitPaymentProof = async function() {
            if (!state.proofBase64) {
                window.showToast('Harap pilih foto bukti pembayaran terlebih dahulu!', 'error');
                return;
            }
            if (!state.currentOrderPayment) {
                window.showToast('Pesanan tidak ditemukan.', 'error');
                return;
            }

            const orderId = state.currentOrderPayment.orderId;
            try {
                await updateDoc(doc(db, 'artifacts', appId, 'orders', orderId), {
                    status: 'Menunggu Verifikasi Admin',
                    proofImage: state.proofBase64
                });

                window.showToast('Bukti pembayaran terkirim! Admin akan memverifikasi.', 'success');
                window.openOrderTracker(orderId);
            } catch (err) {
                console.error("Error uploading proof:", err);
                window.showToast('Gagal mengunggah bukti: ' + err.message, 'error');
            }
        };

