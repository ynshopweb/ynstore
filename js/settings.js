// ============================================================
// PAYMENT SETTINGS MODULE (Pengaturan > Metode Pembayaran)
//
// Mengelola QRIS pembayaran toko:
// - Admin cukup MEMASUKKAN URL gambar QRIS (sama seperti field
//   gambar produk di admin.js) — TIDAK ada upload file ke Firebase
//   Storage lagi, jadi tidak butuh bucket Storage / paket Blaze.
// - Metadata (URL gambar, nama pemilik, provider, no. referensi,
//   waktu update, siapa yang update) disimpan di Firestore:
//   settings/payment
// - Semua halaman (admin & customer) mendengarkan perubahan lewat
//   onSnapshot, sehingga QRIS baru langsung tampil real-time tanpa
//   perlu reload halaman.
// ============================================================
import { doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './config.js';
import { state } from './state.js';

// --- FIRESTORE SNAPSHOT PENGATURAN PEMBAYARAN (real-time) ---
export function setupPaymentSettingsSnapshot() {
    const settingsRef = doc(db, 'settings', 'payment');
    onSnapshot(settingsRef, (snap) => {
        if (snap.exists()) {
            state.paymentSettings = { ...state.paymentSettings, ...snap.data() };
        }
        renderAdminPaymentSettings();
        renderCustomerQRIS();
    }, (err) => {
        console.warn('Gagal memuat pengaturan pembayaran:', err);
    });
}

// --- RENDER: TAMPILAN ADMIN (form Pengaturan > Metode Pembayaran) ---
function renderAdminPaymentSettings() {
    const s = state.paymentSettings;
    const currentImg = document.getElementById('settings-current-qris-img');
    const currentEmpty = document.getElementById('settings-current-qris-empty');

    if (currentImg && currentEmpty) {
        if (s.qrisImage) {
            currentImg.src = s.qrisImage;
            currentImg.classList.remove('hidden');
            currentEmpty.classList.add('hidden');
        } else {
            currentImg.classList.add('hidden');
            currentEmpty.classList.remove('hidden');
        }
    }

    const ownerInput = document.getElementById('settings-qris-owner');
    const providerInput = document.getElementById('settings-qris-provider');
    const refInput = document.getElementById('settings-qris-reference');
    const urlInput = document.getElementById('settings-qris-image-url');
    const metaInfo = document.getElementById('settings-qris-meta');

    // Jangan timpa input yang sedang aktif diketik admin
    if (ownerInput && document.activeElement !== ownerInput) ownerInput.value = s.qrisOwner || '';
    if (providerInput && document.activeElement !== providerInput) providerInput.value = s.paymentProvider || 'DANA';
    if (refInput && document.activeElement !== refInput) refInput.value = s.referenceNumber || '';
    if (urlInput && document.activeElement !== urlInput) urlInput.value = s.qrisImage || '';

    if (metaInfo) {
        if (s.updatedAt) {
            const d = s.updatedAt.toDate ? s.updatedAt.toDate() : new Date(s.updatedAt);
            metaInfo.textContent = `Terakhir diperbarui ${d.toLocaleString('id-ID')} oleh ${s.updatedBy || '-'}`;
        } else {
            metaInfo.textContent = 'Belum pernah diperbarui.';
        }
    }
}

// --- RENDER: TAMPILAN CUSTOMER (halaman pembayaran / checkout) ---
function renderCustomerQRIS() {
    const s = state.paymentSettings;
    const img = document.getElementById('payment-qris-image');
    const placeholder = document.getElementById('payment-qris-placeholder');
    const ownerEl = document.getElementById('payment-qris-owner');
    const providerEl = document.getElementById('payment-qris-provider');

    if (img && placeholder) {
        if (s.qrisImage) {
            img.src = s.qrisImage;
            img.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            img.classList.add('hidden');
            placeholder.classList.remove('hidden');
        }
    }
    if (ownerEl) ownerEl.textContent = s.qrisOwner || 'YN SHOP';
    if (providerEl) providerEl.textContent = s.paymentProvider || 'DANA';
}

// --- PREVIEW LIVE: dipanggil tiap admin mengetik/paste URL gambar QRIS ---
window.previewQrisUrl = function(url) {
    const preview = document.getElementById('settings-new-qris-preview');
    const placeholder = document.getElementById('settings-new-qris-placeholder');
    if (!preview || !placeholder) return;

    if (url && url.trim()) {
        preview.src = url.trim();
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
};

// --- SIMPAN PERUBAHAN: langsung simpan URL + metadata ke Firestore (tanpa upload file) ---
window.savePaymentSettings = async function(e) {
    e.preventDefault();

    if (!state.user) {
        window.showToast('Sesi Anda telah berakhir. Silakan login ulang sebagai admin.', 'error');
        return;
    }

    const owner = document.getElementById('settings-qris-owner').value.trim();
    const provider = document.getElementById('settings-qris-provider').value;
    const referenceNumber = document.getElementById('settings-qris-reference').value.trim();
    const qrisImageUrl = document.getElementById('settings-qris-image-url').value.trim();

    if (!owner || !provider) {
        window.showToast('Nama pemilik QRIS dan provider wajib diisi.', 'error');
        return;
    }
    if (!qrisImageUrl) {
        window.showToast('URL gambar QRIS wajib diisi.', 'error');
        return;
    }

    const btn = document.getElementById('btn-save-payment-settings');
    const btnText = document.getElementById('btn-save-payment-settings-text');
    const spinner = document.getElementById('btn-save-payment-settings-spinner');

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Menyimpan...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        await setDoc(doc(db, 'settings', 'payment'), {
            qrisImage: qrisImageUrl,
            qrisOwner: owner,
            paymentProvider: provider,
            referenceNumber: referenceNumber || null,
            updatedAt: serverTimestamp(),
            updatedBy: state.user.email
        }, { merge: true });

        window.showToast('Pengaturan QRIS berhasil disimpan!', 'success');

    } catch (err) {
        console.error('Gagal menyimpan pengaturan QRIS:', err);
        window.showToast('Gagal menyimpan: ' + err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Simpan Perubahan';
        if (spinner) spinner.classList.add('hidden');
    }
};
