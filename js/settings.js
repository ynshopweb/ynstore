// ============================================================
// PAYMENT SETTINGS MODULE (Pengaturan > Metode Pembayaran)
//
// Mengelola QRIS pembayaran toko secara dinamis:
// - Admin upload gambar QRIS baru -> disimpan ke Firebase Storage
//   di folder payment/qris/{timestamp}.{ext}
// - Metadata (nama pemilik, provider, no. referensi, waktu update,
//   siapa yang update) disimpan di Firestore: settings/payment
// - Semua halaman (admin & customer) mendengarkan perubahan lewat
//   onSnapshot, sehingga QRIS baru langsung tampil real-time tanpa
//   perlu reload halaman.
//
// CATATAN KEAMANAN: pembatasan "hanya admin yang boleh mengubah"
// di sini baru dijalankan di sisi UI (tombol/menu admin tidak
// muncul untuk customer). Supaya benar-benar aman, tambahkan juga
// Firestore Security Rules & Storage Rules di Firebase Console,
// mis. izinkan write ke settings/payment dan payment/qris/**
// hanya untuk user yang emailnya terdaftar sebagai admin.
// ============================================================
import { doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, storage } from './config.js';
import { state } from './state.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

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
    const metaInfo = document.getElementById('settings-qris-meta');

    // Jangan timpa input yang sedang aktif diketik admin
    if (ownerInput && document.activeElement !== ownerInput) ownerInput.value = s.qrisOwner || '';
    if (providerInput && document.activeElement !== providerInput) providerInput.value = s.paymentProvider || 'DANA';
    if (refInput && document.activeElement !== refInput) refInput.value = s.referenceNumber || '';

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

// --- UPLOAD: PILIH FILE QRIS BARU (preview + validasi) ---
window.handleQrisFileChange = function(input) {
    const file = input.files[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
        window.showToast('Format file harus JPG, PNG, atau WEBP.', 'error');
        input.value = '';
        return;
    }
    if (file.size > MAX_FILE_SIZE) {
        window.showToast('Ukuran file maksimal 5MB.', 'error');
        input.value = '';
        return;
    }

    state.qrisFileToUpload = file;

    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('settings-new-qris-preview');
        const placeholder = document.getElementById('settings-new-qris-placeholder');
        if (preview && placeholder) {
            preview.src = e.target.result;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }
    };
    reader.readAsDataURL(file);
};

// --- SIMPAN PERUBAHAN: upload ke Storage (jika ada file baru) + simpan metadata ke Firestore ---
window.savePaymentSettings = async function(e) {
    e.preventDefault();

    if (!state.user) {
        window.showToast('Sesi Anda telah berakhir. Silakan login ulang sebagai admin.', 'error');
        return;
    }

    const owner = document.getElementById('settings-qris-owner').value.trim();
    const provider = document.getElementById('settings-qris-provider').value;
    const referenceNumber = document.getElementById('settings-qris-reference').value.trim();

    if (!owner || !provider) {
        window.showToast('Nama pemilik QRIS dan provider wajib diisi.', 'error');
        return;
    }

    const btn = document.getElementById('btn-save-payment-settings');
    const btnText = document.getElementById('btn-save-payment-settings-text');
    const spinner = document.getElementById('btn-save-payment-settings-spinner');
    const progressWrap = document.getElementById('settings-upload-progress-wrap');
    const progressBar = document.getElementById('settings-upload-progress-bar');
    const progressLabel = document.getElementById('settings-upload-progress-label');

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Menyimpan...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        let qrisImageUrl = state.paymentSettings.qrisImage || null;

        // Kalau admin memilih file baru, upload dulu ke Firebase Storage
        if (state.qrisFileToUpload) {
            const file = state.qrisFileToUpload;
            const ext = file.name.split('.').pop();
            const fileName = `${Date.now()}.${ext}`;
            const storageRef = ref(storage, `payment/qris/${fileName}`);

            if (progressWrap) progressWrap.classList.remove('hidden');

            qrisImageUrl = await new Promise((resolve, reject) => {
                const uploadTask = uploadBytesResumable(storageRef, file);
                uploadTask.on('state_changed',
                    (snapshot) => {
                        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                        if (progressBar) progressBar.style.width = pct + '%';
                        if (progressLabel) progressLabel.textContent = pct + '%';
                    },
                    (err) => reject(err),
                    async () => {
                        const url = await getDownloadURL(uploadTask.snapshot.ref);
                        resolve(url);
                    }
                );
            });
        }

        await setDoc(doc(db, 'settings', 'payment'), {
            qrisImage: qrisImageUrl,
            qrisOwner: owner,
            paymentProvider: provider,
            referenceNumber: referenceNumber || null,
            updatedAt: serverTimestamp(),
            updatedBy: state.user.email
        }, { merge: true });

        window.showToast('Pengaturan QRIS berhasil disimpan!', 'success');
        state.qrisFileToUpload = null;

        // Reset preview area file baru (gambar aktif akan ter-update otomatis lewat onSnapshot)
        const preview = document.getElementById('settings-new-qris-preview');
        const placeholder = document.getElementById('settings-new-qris-placeholder');
        const fileInput = document.getElementById('settings-qris-file-input');
        if (preview) preview.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (fileInput) fileInput.value = '';
        if (progressWrap) progressWrap.classList.add('hidden');
        if (progressBar) progressBar.style.width = '0%';

    } catch (err) {
        console.error('Gagal menyimpan pengaturan QRIS:', err);
        window.showToast('Gagal menyimpan: ' + err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Simpan Perubahan';
        if (spinner) spinner.classList.add('hidden');
    }
};
