// ============================================================
// CHECKOUT & PAYMENT MODULE - YN SHOP
// Mengelola form checkout, slot jam pengambilan toko (pick up),
// submit pesanan ke Firestore, serta pengunggahan bukti pembayaran QRIS.
// ============================================================
import { doc, setDoc, updateDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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
 * ALERT LOGIN AKTIF DI SINI
 */
export function selectTimeSlot(slot, btn) {
    // 1. Alert Login di Slot Pick Up
    if (!state.user) {
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan login terlebih dahulu untuk memilih slot jam pengambilan!', 'warning');
        }
        if (typeof window.showLoginRequiredModal === 'function') {
            window.showLoginRequiredModal();
        } else if (typeof window.openAuthModal === 'function') {
            window.openAuthModal('login');
        }
        return;
    }

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
 * Pengecekan status login saat mengklik tombol 'Lanjut Ke Checkout'
 * ALERT LOGIN AKTIF DI SINI
 */
export function checkAuthForCheckout() {
    // 2. Alert Login di Tombol Lanjut Ke Checkout
    if (!state.user) {
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan login atau daftar akun terlebih dahulu untuk melanjutkan ke checkout!', 'warning');
        }
        if (typeof window.showLoginRequiredModal === 'function') {
            window.showLoginRequiredModal();
        } else if (typeof window.openAuthModal === 'function') {
            window.openAuthModal('login');
        }
        return false;
    }
    return true;
}

/**
 * Menangani submit form pesanan (Tombol Lanjut Pembayaran QRIS)
 * ALERT LOGIN DIHAPUS DARI SINI
 */
export async function handleCheckoutSubmit(e) {
    if (e) e.preventDefault();

    // Proteksi login diam-diam (silent guard) tanpa memunculkan alert/toast login di sini
    if (!state.user) return;

    const slotInput = document.getElementById('checkout-selected-slot');
    const slot = slotInput ? slotInput.value : '';

    if (!slot) {
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan pilih jam pengambilan di toko terlebih dahulu!', 'error');
        } else {
            alert('Silakan pilih jam pengambilan di toko terlebih dahulu!');
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
        userId: state.user.uid,
        pickupDate,
        pickupSlot: slot,
        notes,
        items: state.cart,
        totalAmount,
        status: 'Menunggu Pembayaran',
        proofImage: null,
        createdAt: Date.now()
    };

    // Tombol submit dinonaktifkan sementara supaya tidak diklik dobel
    // (mengurangi risiko duplikat submit dari sisi UI).
    const submitBtn = document.getElementById('btn-submit-checkout');
    if (submitBtn) submitBtn.disabled = true;

    try {
        // --- TRANSAKSI ATOMIK: VALIDASI STOK TERBARU + BUAT PESANAN + KURANGI STOK ---
        // Semua dilakukan dalam SATU Firestore transaction supaya:
        // 1) Stok yang divalidasi selalu yang PALING BARU (dibaca ulang di
        //    dalam transaksi, bukan dari cache state.cart/state.products).
        // 2) Pesanan hanya dibuat & stok hanya berkurang jika SEMUA item
        //    di keranjang benar-benar cukup stoknya (all-or-nothing).
        // 3) Jika ada 2+ pengguna checkout bersamaan untuk produk yang sama,
        //    Firestore otomatis mendeteksi konflik baca/tulis dan me-retry
        //    transaksi ini, sehingga stok TIDAK PERNAH menjadi minus.
        await runTransaction(db, async (transaction) => {
            const productRefs = state.cart.map(item => doc(db, 'artifacts', appId, 'products', item.id));

            // 1. BACA seluruh dokumen produk yang relevan (harus dilakukan
            //    sebelum ada operasi tulis apa pun di transaksi Firestore).
            const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            // 2. VALIDASI stok terbaru untuk setiap item di keranjang.
            const insufficient = [];
            productSnaps.forEach((snap, idx) => {
                const cartItem = state.cart[idx];
                if (!snap.exists()) {
                    insufficient.push(`${cartItem.name} (produk tidak ditemukan)`);
                    return;
                }
                const data = snap.data();
                const currentStock = (typeof data.stock === 'number') ? data.stock : Infinity;
                if (currentStock < cartItem.qty) {
                    insufficient.push(`${cartItem.name} (sisa stok: ${isFinite(currentStock) ? currentStock : '-'})`);
                }
            });

            if (insufficient.length > 0) {
                throw new Error(`Stok tidak mencukupi untuk: ${insufficient.join(', ')}. Silakan sesuaikan jumlah di keranjang.`);
            }

            // 3. TULIS: kurangi stok tiap produk (hanya jika field stock ada
            //    & berupa angka — produk lama tanpa field stok tidak diubah)
            //    lalu buat dokumen pesanan.
            productSnaps.forEach((snap, idx) => {
                const cartItem = state.cart[idx];
                const data = snap.data();
                if (typeof data.stock === 'number') {
                    const newStock = data.stock - cartItem.qty;
                    transaction.update(productRefs[idx], { stock: Math.max(0, newStock) });
                }
            });

            const orderRef = doc(db, 'artifacts', appId, 'orders', orderId);
            transaction.set(orderRef, orderData);
        });

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
        } else {
            alert('Gagal membuat pesanan: ' + err.message);
        }
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

/**
 * Menangani perubahan input file bukti transfer / pembayaran
 */
export function handleProofFileChange(input) {
    if (!input || !input.files || !input.files[0]) return;

    const file = input.files[0];
    
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

// Expose fungsi ke objek window global
window.renderTimeSlots = renderTimeSlots;
window.selectTimeSlot = selectTimeSlot;
window.checkAuthForCheckout = checkAuthForCheckout;
window.handleCheckoutSubmit = handleCheckoutSubmit;
window.handleProofFileChange = handleProofFileChange;
window.submitPaymentProof = submitPaymentProof;