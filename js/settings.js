// ============================================================
// PAYMENT SETTINGS MODULE (Pengaturan > Metode Pembayaran)
//
// Mengelola QRIS pembayaran toko lewat URL gambar (bukan upload
// file). Admin cukup memasukkan URL gambar QRIS yang sudah
// dihosting di layanan eksternal (Firebase Storage, Cloudinary,
// Imgur, dll), lalu URL tersebut disimpan di Firestore:
// settings/payment { qrisImageUrl, updatedAt, updatedBy }.
//
// Semua halaman (admin & customer) mendengarkan perubahan lewat
// onSnapshot, sehingga QRIS baru langsung tampil real-time tanpa
// perlu reload halaman ataupun deploy ulang website — admin cukup
// mengganti URL di halaman Pengaturan.
//
// CATATAN KEAMANAN: pembatasan "hanya admin yang boleh mengubah"
// di sini baru dijalankan di sisi UI (tombol/menu admin tidak
// muncul untuk customer). Supaya benar-benar aman, pastikan
// Firestore Security Rules (lihat firestore.rules.txt) mengizinkan
// write ke settings/payment hanya untuk user yang terdaftar admin,
// sementara read tetap terbuka untuk semua orang (termasuk customer).
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

    // "QRIS Saat Ini" — nilai yang sudah tersimpan di Firestore
    const currentImg = document.getElementById('settings-current-qris-img');
    const currentEmpty = document.getElementById('settings-current-qris-empty');
    if (currentImg && currentEmpty) {
        if (s.qrisImageUrl) {
            currentImg.src = s.qrisImageUrl;
            currentImg.classList.remove('hidden');
            currentEmpty.classList.add('hidden');
        } else {
            currentImg.classList.add('hidden');
            currentEmpty.classList.remove('hidden');
        }
    }

    // Input URL — jangan timpa input yang sedang aktif diketik admin
    const urlInput = document.getElementById('settings-qris-url');
    if (urlInput && document.activeElement !== urlInput) {
        urlInput.value = s.qrisImageUrl || '';
        updateQrisPreview(urlInput.value.trim());
    }

    const metaInfo = document.getElementById('settings-qris-meta');
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
        if (s.qrisImageUrl) {
            img.onerror = function () {
                img.classList.add('hidden');
                placeholder.classList.remove('hidden');
                placeholder.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i><p>Gagal memuat gambar QRIS. Periksa kembali URL yang dimasukkan.</p>';
            };
            img.src = s.qrisImageUrl;
            img.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            img.classList.add('hidden');
            placeholder.classList.remove('hidden');
            placeholder.innerHTML = '<i class="fa-solid fa-qrcode text-3xl mb-2"></i><p>QRIS belum diatur oleh admin.</p>';
        }
    }
    if (ownerEl) ownerEl.textContent = s.qrisOwner || 'YN SHOP';
    if (providerEl) providerEl.textContent = s.paymentProvider || 'DANA';
}

// --- PREVIEW: perbarui area "Preview QRIS" di bawah input URL ---
function updateQrisPreview(url) {
    const preview = document.getElementById('settings-new-qris-preview');
    const placeholder = document.getElementById('settings-new-qris-placeholder');
    const errorMsg = document.getElementById('settings-qris-preview-error');
    if (!preview || !placeholder) return;

    if (errorMsg) errorMsg.classList.add('hidden');

    if (!url) {
        preview.classList.add('hidden');
        preview.removeAttribute('src');
        placeholder.classList.remove('hidden');
        return;
    }

    placeholder.classList.add('hidden');
    preview.src = url;
    preview.classList.remove('hidden');
}

// --- INPUT: URL QRIS diketik/ditempel -> preview langsung berubah ---
window.handleQrisUrlInput = function (input) {
    updateQrisPreview(input.value.trim());
};

// --- PREVIEW: gambar berhasil dimuat ---
window.handleQrisPreviewLoad = function () {
    const placeholder = document.getElementById('settings-new-qris-placeholder');
    const errorMsg = document.getElementById('settings-qris-preview-error');
    if (placeholder) placeholder.classList.add('hidden');
    if (errorMsg) errorMsg.classList.add('hidden');
};

// --- PREVIEW: gambar gagal dimuat (URL salah / tidak bisa diakses) ---
window.handleQrisPreviewError = function () {
    const preview = document.getElementById('settings-new-qris-preview');
    const placeholder = document.getElementById('settings-new-qris-placeholder');
    const errorMsg = document.getElementById('settings-qris-preview-error');
    if (preview) {
        preview.classList.add('hidden');
        preview.removeAttribute('src');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (errorMsg) errorMsg.classList.remove('hidden');
};

// --- SIMPAN PERUBAHAN: simpan URL QRIS ke Firestore (tanpa upload file) ---
window.savePaymentSettings = async function (e) {
    e.preventDefault();

    if (!state.user) {
        window.showToast('Sesi Anda telah berakhir. Silakan login ulang sebagai admin.', 'error');
        return;
    }

    const urlInput = document.getElementById('settings-qris-url');
    const qrisImageUrl = urlInput ? urlInput.value.trim() : '';

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
            qrisImageUrl: qrisImageUrl,
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
