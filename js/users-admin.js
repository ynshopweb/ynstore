// ============================================================
// USERS ADMIN MODULE (Dashboard Admin > Manajemen Pengguna)
// ============================================================
// Menampilkan tabel semua user (real-time) via collectionGroup query
// pada subcollection 'profile' (setiap user punya path
// artifacts/{appId}/users/{uid}/profile/data). Admin dapat: melihat
// detail, mengedit nama/noHp, mengubah role, mengaktifkan/menonaktifkan
// akun (semuanya lewat satu modal Detail/Edit), dan mengirim email
// reset password (aksi langsung di baris tabel).
//
// CATATAN PENTING (keterbatasan platform, bukan bug):
// Status "Email Verified" TIDAK bisa diambil live dari Firebase Auth
// untuk user lain (butuh Admin SDK di server, tidak tersedia di app
// statis ini). Sebagai gantinya field `emailVerified` di Firestore
// di-mirror otomatis oleh js/auth.js setiap kali user itu berhasil
// login (di titik itu status verifikasi sudah pasti benar).
// ============================================================
import { collectionGroup, doc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { db, appId, auth } from './config.js';
import { state } from './state.js';
import { updatePhoneReservation, isPhoneAvailable } from './phone-registry.js';
import { formatFlexibleDateTime } from './format-utils.js';

let allUsers = [];
let usersUnsubscribe = null;

// --- REAL-TIME SNAPSHOT (dipanggil sekali dari main.js saat bootstrap) ---
export function setupUsersSnapshot() {
    if (usersUnsubscribe) return; // hindari subscribe dobel
    try {
        const q = collectionGroup(db, 'profile');
        usersUnsubscribe = onSnapshot(q, (snap) => {
            const list = [];
            snap.forEach(d => {
                // Path: artifacts/{appId}/users/{uid}/profile/data
                // -> d.ref.parent adalah collection 'profile', .parent adalah dokumen {uid}
                const uid = d.ref.parent.parent ? d.ref.parent.parent.id : d.id;
                list.push({ uid, ...d.data() });
            });
            list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            allUsers = list;
            if (state.viewMode === 'admin') window.renderAdminUsersTable();
        }, (err) => {
            console.error('Gagal memuat daftar user (collectionGroup profile):', err);
        });
    } catch (err) {
        console.error('setupUsersSnapshot error:', err);
    }
}

function statusBadgeHtml(status) {
    return status === 'disabled'
        ? '<span class="bg-rose-900 text-rose-300 px-2 py-0.5 rounded text-[10px] font-bold">🔴 Dinonaktifkan</span>'
        : '<span class="bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold">🟢 Aktif</span>';
}

function verifiedBadgeHtml(verified) {
    return verified
        ? '<span class="bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold">🟢 Terverifikasi</span>'
        : '<span class="bg-rose-900 text-rose-300 px-2 py-0.5 rounded text-[10px] font-bold">🔴 Belum</span>';
}

window.renderAdminUsersTable = function() {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    if (allUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-500">Belum ada user terdaftar.</td></tr>`;
        return;
    }

    tbody.innerHTML = allUsers.map(u => `
        <tr>
            <td class="p-3"><p class="font-bold text-white">${u.nama || '-'}</p></td>
            <td class="p-3 text-slate-300">${u.email || '-'}</td>
            <td class="p-3 text-slate-300">${u.noHp || '-'}</td>
            <td class="p-3">${u.role === 'admin' ? '<span class="bg-blue-900 text-blue-300 px-2 py-0.5 rounded text-[10px] font-bold">Admin</span>' : '<span class="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold">Customer</span>'}</td>
            <td class="p-3">${statusBadgeHtml(u.status)}</td>
            <td class="p-3 text-slate-400">${u.provider === 'google' ? 'Google' : 'Email'}</td>
            <td class="p-3">${verifiedBadgeHtml(!!u.emailVerified)}</td>
            <td class="p-3 text-slate-400 whitespace-nowrap">${formatFlexibleDateTime(u.createdAt)}</td>
            <td class="p-3 text-right space-x-1 whitespace-nowrap">
                <button onclick="window.openUserDetailModal('${u.uid}')" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded" title="Detail / Edit"><i class="fa-solid fa-pen"></i></button>
                <button onclick="window.sendAdminPasswordReset('${u.email}')" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] rounded" title="Reset Password"><i class="fa-solid fa-key"></i></button>
            </td>
        </tr>
    `).join('');
};

// ================= MODAL DETAIL / EDIT USER =================
window.openUserDetailModal = function(uid) {
    const u = allUsers.find(x => x.uid === uid);
    if (!u) return;

    document.getElementById('user-detail-uid').value = u.uid;
    document.getElementById('user-detail-old-phone').value = u.noHp || '';
    document.getElementById('user-detail-name').value = u.nama || '';
    document.getElementById('user-detail-phone').value = u.noHp || '';
    document.getElementById('user-detail-role').value = u.role || 'customer';
    document.getElementById('user-detail-status').value = u.status || 'active';

    document.getElementById('user-detail-email').textContent = u.email || '-';
    document.getElementById('user-detail-provider').textContent = u.provider === 'google' ? 'Google' : 'Email & Password';
    document.getElementById('user-detail-verified').innerHTML = verifiedBadgeHtml(!!u.emailVerified);
    document.getElementById('user-detail-created').textContent = formatFlexibleDateTime(u.createdAt);
    document.getElementById('user-detail-lastlogin').textContent = formatFlexibleDateTime(u.lastLogin);
    document.getElementById('user-detail-lastactivity').textContent = formatFlexibleDateTime(u.lastActivity);

    document.getElementById('user-detail-modal').classList.remove('hidden');
};

window.closeUserDetailModal = function() {
    document.getElementById('user-detail-modal').classList.add('hidden');
};

window.saveUserDetail = async function(e) {
    e.preventDefault();
    const uid = document.getElementById('user-detail-uid').value;
    const oldPhone = document.getElementById('user-detail-old-phone').value;
    const nama = document.getElementById('user-detail-name').value.trim();
    const noHp = document.getElementById('user-detail-phone').value.trim();
    const role = document.getElementById('user-detail-role').value;
    const status = document.getElementById('user-detail-status').value;
    const btnSpinner = document.getElementById('btn-user-detail-save-spinner');

    if (btnSpinner) btnSpinner.classList.remove('hidden');

    try {
        // Jaga keunikan nomor WhatsApp jika admin mengubahnya
        if (noHp !== oldPhone) {
            const available = await isPhoneAvailable(noHp);
            if (!available) {
                window.showToast('Nomor WhatsApp sudah dipakai akun lain.', 'error');
                if (btnSpinner) btnSpinner.classList.add('hidden');
                return;
            }
        }

        await updateDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data'), {
            nama, noHp, role, status
        });

        if (noHp !== oldPhone) {
            await updatePhoneReservation(oldPhone, noHp, uid);
        }

        window.showToast('Perubahan data user berhasil disimpan.', 'success');
        window.closeUserDetailModal();
    } catch (err) {
        console.error('Gagal menyimpan user:', err);
        window.showToast('Gagal menyimpan perubahan: ' + err.message, 'error');
    } finally {
        if (btnSpinner) btnSpinner.classList.add('hidden');
    }
};

// --- RESET PASSWORD (dipicu admin dari baris tabel) ---
window.sendAdminPasswordReset = async function(email) {
    if (!email) {
        window.showToast('User ini tidak memiliki email yang valid.', 'error');
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        window.showToast(`Link reset password telah dikirim ke ${email}.`, 'success');
    } catch (err) {
        console.error('Gagal mengirim reset password:', err);
        window.showToast('Gagal mengirim email reset password: ' + err.message, 'error');
    }
};
