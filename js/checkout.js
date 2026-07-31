// ============================================================
// CHECKOUT & PAYMENT MODULE - YN SHOP
// Mengelola form checkout, slot jam pengambilan toko (pick up),
// submit pesanan ke Firestore, serta pengunggahan bukti pembayaran QRIS.
// ============================================================
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state } from './state.js';

/**
 * Rendernya daftar slot jam pengambilan pesanan di toko
 */
export function renderTimeSlots() {
    const container = document.getElementById('time-slots-container');
    const slots = [
        '08.00 - 09.00', 
        '09.00 - 10.00', 
        '10.00 - 11.00', 
        '13.00 - 14.00', 
        '14.00 - 15.00', 
        '16.00 - 17.00', 
        '18.00 - 19.00'
    ];

    if (!container) return;

    container.innerHTML = slots.map(slot => `
        <button type="button" 
                onclick="window.selectTimeSlot('${slot}', this)" 
                class="slot-btn border border-slate-200 rounded-xl p-2.5 text-[11px] font-semibold text-slate-700 hover:border-brand-500 hover:bg-rose-50/60 transition active:scale-95 flex items-center justify-center gap-1">
            <i class="fa-regular fa-clock text-slate-400"></i>
            <span>${slot} WIB</span>
        </button>
    `).join('');
}

/**
 * Memilih slot jam pengambilan dan memperbarui tampilan tombol slot
 * @param {string} slot - Teks slot waktu yang dipilih
 * @param {HTMLElement} btn - Elemen tombol yang diklik
 */
export function selectTimeSlot(slot, btn) {
    // Reset status semua tombol slot
    document.querySelectorAll('.slot-btn').forEach(b => {
        b.classList.remove('border-brand-600', 'bg-rose-50', 'text-brand-700', 'font-bold', 'ring-2', 'ring-brand-500/20');
        b.classList.add('border-slate-200', 'text-slate-700');
    });

    // Aktifkan tombol slot yang dipilih
    if (btn) {
        btn.classList.remove('border-slate-200', 'text-slate-700');
        btn.classList.add('border-brand-600', 'bg-rose-50', 'text-brand-700', 'font-bold', 'ring-2', 'ring-brand-500/20');
    }

    // Simpan slot ke hidden input
    const slotInput = document.getElementById('checkout-selected-slot');
    if (slotInput) {
        slotInput.value = slot;
    }
}

/**
 * Menangani submit form checkout pesanan
 * @param {Event} e - Form Submit Event
 */
export async function handleCheckoutSubmit(e) {
    if (e) e.preventDefault();

    const slotInput = document.getElementById('checkout-selected-slot');
    const slot = slotInput ? slotInput.value : '';

    if (!slot) {
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan pilih jam pengambilan di toko!', 'error');
        } else {
            alert('Silakan pilih jam pengambilan di toko!');
        }
        return;
    }

    // Validasi keranjang belanja tidak boleh kosong
    if (!state.cart || state.cart.length === 0) {
        if (typeof window.showToast === 'function') {
            window.showToast('Keranjang belanja Anda masih kosong!', 'error');
        }
        return;
    }

    const nameEl = document.getElementById('checkout-name');
    const phoneEl = document.getElementById('checkout-phone');
    const emailEl = document.getElementById('checkout-email');
    const pickupDateEl = document.getElementById('checkout-pickup-date');
    const notesEl = document.getElementById('checkout-notes');

    const name = nameEl ? nameEl.value.trim() : '';
    const phone = phoneEl ? phoneEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    const pickupDate = pickupDateEl ? pickupDateEl.value : '';
    const notes = notesEl ? notesEl.value.trim() : '';

    const totalAmount = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const orderId = `YN-${dateStr}-${randomDigits}`;

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
        
        // Simpan data pesanan saat ini di memori state
        state.currentOrderPayment = orderData;

        // Kosongkan keranjang belanja setelah checkout berhasil
        state.cart = [];
        if (typeof window.updateCartUI === 'function') {
            window.updateCartUI();
        }

        // Tampilkan informasi pesanan pada halaman pembayaran
        const payOrderNumEl = document.getElementById('pay-order-number');
        const payTotalEl = document.getElementById('pay-total-amount');

        if (payOrderNumEl) payOrderNumEl.textContent = orderId;
        if (payTotalEl) payTotalEl.textContent = `Rp ${totalAmount.toLocaleString('id-ID')}`;

        // Beralih ke halaman pembayaran QRIS
        if (typeof window.navigateTo === 'function') {
            window.navigateTo('payment');
        } else if (typeof window.switchToViewMode === 'function') {
            window.switchToViewMode('payment');
        }

        if (typeof window.showToast === 'function') {
            window.showToast('Pesanan berhasil dibuat. Silakan bayar via QRIS DANA.', 'success');
        }
    } catch (err) {
        console.error("Error creating order:", err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal membuat pesanan: ' + err.message, 'error');
        }
    }
}

/**
 * Menangani perubahan input file bukti transfer / pembayaran
 * @param {HTMLInputElement} input - Element input type file
 */
export function handleProofFileChange(input) {
    if (!input || !input.files || !input.files[0]) return;

    const file = input.files[0];
    
    // Validasi tipe file gambar
    if (!file.type.startsWith('image/')) {
        if (typeof window.showToast === 'function') {
            window.showToast('File yang diunggah harus berupa gambar (JPG, PNG, WebP)!', 'error');
        }
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        state.proofBase64 = e.target.result;
        
        const preview = document.getElementById('upload-preview-img');
        const placeholder = document.getElementById('upload-placeholder');
        
        if (preview) {
            preview.src = e.target.result;
            preview.classList.remove('hidden');
        }
        if (placeholder) {
            placeholder.classList.add('hidden');
        }
    };
    reader.readAsDataURL(file);
}

/**
 * Mengirim bukti pembayaran QRIS ke Firestore dan mengupdate status pesanan
 */
export async function submitPaymentProof() {
    if (!state.proofBase64) {
        if (typeof window.showToast === 'function') {
            window.showToast('Harap pilih foto bukti pembayaran terlebih dahulu!', 'error');
        }
        return;
    }

    if (!state.currentOrderPayment || !state.currentOrderPayment.orderId) {
        if (typeof window.showToast === 'function') {
            window.showToast('Data pesanan tidak ditemukan.', 'error');
        }
        return;
    }

    const orderId = state.currentOrderPayment.orderId;
    
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'orders', orderId), {
            status: 'Menunggu Verifikasi Admin',
            proofImage: state.proofBase64,
            updatedAt: Date.now()
        });

        if (typeof window.showToast === 'function') {
            window.showToast('Bukti pembayaran terkirim! Admin akan memverifikasi.', 'success');
        }

        // Buka tracker status pesanan
        if (typeof window.openOrderTracker === 'function') {
            window.openOrderTracker(orderId);
        } else if (typeof window.navigateTo === 'function') {
            window.navigateTo('orders');
        }
    } catch (err) {
        console.error("Error uploading proof:", err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal mengunggah bukti: ' + err.message, 'error');
        }
    }
}

// Expose fungsi ke objek window global agar dapat dipanggil dari atribut onclick/onsubmit HTML
window.renderTimeSlots = renderTimeSlots;
window.selectTimeSlot = selectTimeSlot;
window.handleCheckoutSubmit = handleCheckoutSubmit;
window.handleProofFileChange = handleProofFileChange;
window.submitPaymentProof = submitPaymentProof;