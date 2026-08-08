// ============================================================
// PHONE REGISTRY MODULE
// ============================================================
// Menjaga keunikan Nomor WhatsApp antar akun memakai koleksi lookup
// terpisah: artifacts/{appId}/phone_index/{nomorTernormalisasi}.
// Pendekatan ini dipilih (bukan query collectionGroup ke seluruh
// profil user) supaya pengecekan "apakah nomor ini sudah dipakai?"
// hanya perlu SATU pembacaan dokumen by-ID — cepat, tidak butuh
// index Firestore tambahan, dan aman dipanggil SEBELUM user login
// (saat proses registrasi, request.auth masih null).
// ============================================================
import { doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';

// Normalisasi nomor WhatsApp jadi kunci dokumen yang konsisten:
// hanya digit, awalan "0" diganti "62" supaya "081..." & "+62 81..."
// dianggap nomor yang sama.
export function normalizePhone(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    return digits;
}

function phoneIndexRef(normalizedPhone) {
    return doc(db, 'artifacts', appId, 'phone_index', normalizedPhone);
}

// Mengembalikan true jika nomor BELUM dipakai akun manapun.
export async function isPhoneAvailable(phone) {
    const key = normalizePhone(phone);
    if (!key) return true; // nomor kosong tidak divalidasi di sini (field required di form)
    const snap = await getDoc(phoneIndexRef(key));
    return !snap.exists();
}

// Daftarkan nomor sebagai milik uid tertentu (dipanggil tepat setelah
// akun berhasil dibuat, supaya request.auth sudah terisi untuk rules).
export async function reservePhoneNumber(phone, uid) {
    const key = normalizePhone(phone);
    if (!key) return;
    await setDoc(phoneIndexRef(key), { uid, phone, reservedAt: Date.now() });
}

// Dipakai saat admin mengedit nomor WhatsApp seorang user: lepas
// reservasi nomor lama, lalu daftarkan nomor baru (jika berubah).
export async function updatePhoneReservation(oldPhone, newPhone, uid) {
    const oldKey = normalizePhone(oldPhone);
    const newKey = normalizePhone(newPhone);
    if (oldKey === newKey) return;
    if (oldKey) {
        await deleteDoc(phoneIndexRef(oldKey)).catch(() => {});
    }
    if (newKey) {
        await setDoc(phoneIndexRef(newKey), { uid, phone: newPhone, reservedAt: Date.now() });
    }
}
