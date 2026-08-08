// ============================================================
// FORMAT UTILS (shared helper, no duplicate code)
// ============================================================
// Dipakai oleh js/users-admin.js, js/login-logs.js, dan js/profile.js
// untuk menampilkan tanggal/waktu secara konsisten. Firestore
// menyimpan sebagian field sebagai angka (Date.now()) dan sebagian
// lain sebagai Firestore Timestamp (serverTimestamp()) — helper ini
// menangani kedua bentuk itu secara seragam.
// ============================================================

// Menerima: number (ms epoch), Firestore Timestamp ({ toDate }), atau
// null/undefined -> selalu mengembalikan string yang aman ditampilkan.
export function formatFlexibleDateTime(val) {
    if (!val) return '-';
    let d;
    if (typeof val === 'number') {
        d = new Date(val);
    } else if (typeof val.toDate === 'function') {
        d = val.toDate();
    } else {
        return '-';
    }
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatFlexibleDateOnly(val) {
    if (!val) return '-';
    let d;
    if (typeof val === 'number') {
        d = new Date(val);
    } else if (typeof val.toDate === 'function') {
        d = val.toDate();
    } else {
        return '-';
    }
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

// Untuk pengurutan client-side (mis. daftar login logs) — selalu
// mengembalikan angka epoch ms, apapun bentuk input aslinya.
export function toEpochMs(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val.toDate === 'function') return val.toDate().getTime();
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    return 0;
}
