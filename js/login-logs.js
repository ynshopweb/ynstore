// ============================================================
// LOGIN LOGS MODULE
// ============================================================
// Menulis riwayat login ke koleksi artifacts/{appId}/login_logs
// setiap kali login BERHASIL (dipanggil dari js/auth.js), dan
// merender tab admin "Riwayat Login" (dipanggil dari js/admin.js
// saat tab dibuka).
// ============================================================
import {
    collection, addDoc, doc, updateDoc,
    query, orderBy, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { getDeviceInfo, getPublicIp } from './device-info.js';
import { formatFlexibleDateTime } from './format-utils.js';

const LOGS_COLLECTION = () => collection(db, 'artifacts', appId, 'login_logs');
const MAX_LOGS_FETCHED = 200; // batas wajar supaya query tetap ringan

// --- MENULIS 1 ENTRI LOGIN HISTORY (dipanggil dari auth.js) ---
// Mengembalikan ID dokumen log yang baru dibuat, supaya bisa diisi
// `logoutTime`-nya nanti saat user logout (lihat closeLoginLog).
export async function writeLoginLog(user, profileData, provider) {
    const { browser, os, device } = getDeviceInfo();
    const ip = await getPublicIp(); // best-effort, bisa null jika offline/diblokir

    const logRef = await addDoc(LOGS_COLLECTION(), {
        uid: user.uid,
        nama: (profileData && profileData.nama) || user.displayName || '',
        email: (profileData && profileData.email) || user.email || '',
        provider: provider || 'password',
        browser,
        os,
        device,
        ip: ip || null,
        loginTime: serverTimestamp(),
        logoutTime: null
    });
    return logRef.id;
}

// --- MENUTUP SESI LOGIN (isi logoutTime) — dipanggil saat logout ---
export async function closeLoginLog(logId) {
    if (!logId) return;
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'login_logs', logId), {
            logoutTime: serverTimestamp()
        });
    } catch (_) {
        // Non-fatal: gagal menutup log tidak boleh menghalangi proses logout
    }
}

// ================= TAB ADMIN: RIWAYAT LOGIN =================
let cachedLogs = [];

export async function loadLoginLogsTab() {
    const tbody = document.getElementById('admin-login-logs-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin me-2"></i>Memuat riwayat login...</td></tr>`;

    try {
        const q = query(LOGS_COLLECTION(), orderBy('loginTime', 'desc'), limit(MAX_LOGS_FETCHED));
        const snap = await getDocs(q);
        cachedLogs = [];
        snap.forEach(d => cachedLogs.push({ id: d.id, ...d.data() }));
        renderLoginLogsTable(cachedLogs);
    } catch (err) {
        console.error('Gagal memuat login_logs:', err);
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-400">Gagal memuat riwayat login. ${err.code === 'failed-precondition' ? 'Index Firestore untuk koleksi login_logs mungkin belum dibuat.' : ''}</td></tr>`;
    }
}

function renderLoginLogsTable(logs) {
    const tbody = document.getElementById('admin-login-logs-tbody');
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500">Belum ada riwayat login.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(l => {
        const statusBadge = l.logoutTime
            ? `<span class="bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[10px]">Selesai</span>`
            : `<span class="bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded text-[10px]">Aktif</span>`;
        return `
            <tr>
                <td class="p-3 whitespace-nowrap">${formatFlexibleDateTime(l.loginTime)}</td>
                <td class="p-3 font-bold text-white">${l.nama || '-'}</td>
                <td class="p-3 text-slate-300">${l.email || '-'}</td>
                <td class="p-3">${l.provider === 'google' ? '<i class="fa-brands fa-google me-1"></i>Google' : '<i class="fa-solid fa-key me-1"></i>Email'}</td>
                <td class="p-3 text-slate-400">${l.browser || '-'}</td>
                <td class="p-3 text-slate-400">${l.os || '-'} / ${l.device || '-'}</td>
                <td class="p-3">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

// --- PENCARIAN (client-side, karena data sudah dibatasi 200 log terbaru) ---
window.filterLoginLogs = function() {
    const input = document.getElementById('login-logs-search');
    const kw = (input ? input.value : '').trim().toLowerCase();
    if (!kw) {
        renderLoginLogsTable(cachedLogs);
        return;
    }
    const filtered = cachedLogs.filter(l =>
        (l.nama || '').toLowerCase().includes(kw) ||
        (l.email || '').toLowerCase().includes(kw)
    );
    renderLoginLogsTable(filtered);
};

window.loadLoginLogsTab = loadLoginLogsTab;
