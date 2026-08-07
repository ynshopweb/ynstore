// ============================================================
// LAPORAN PENJUALAN MODULE (Admin Only)
//
// Fitur laporan penjualan Harian / Mingguan / Bulanan untuk admin,
// dengan cetak (window.print) dan download Excel (CSV).
//
// PENTING soal performa:
// Modul lain (js/orders.js) memakai onSnapshot() TANPA filter untuk
// menampilkan tabel pesanan & dashboard admin secara realtime — itu
// perilaku LAMA yang sengaja TIDAK diubah di sini.
// Untuk laporan, kita SENGAJA TIDAK memakai data yang sudah di-cache
// di state.orders, melainkan melakukan query terpisah & tersaring ke
// Firestore setiap kali admin menekan "Tampilkan Laporan", memakai:
//   - where('createdAt', '>=', startMs)
//   - where('createdAt', '<=', endMs)
//   - orderBy('createdAt', 'asc')
// sehingga hanya transaksi pada rentang tanggal yang dipilih saja yang
// diambil dari server (bukan seluruh koleksi orders), supaya tetap
// ringan walau jumlah transaksi toko sudah sangat banyak.
//
// PENTING soal keamanan:
// Hanya user dengan state.userProfile.role === 'admin' yang boleh
// memicu query & melihat/mencetak/mengunduh laporan. Pemeriksaan role
// dilakukan di SETIAP fungsi publik modul ini (defense-in-depth),
// bukan cuma saat tab dibuka, supaya tombol tidak bisa "dipaksa" jalan
// lewat console oleh user non-admin yang kebetulan berhasil membuka
// panel admin.
// ============================================================
import { collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state } from './state.js';

// Status pesanan yang dihitung sebagai "penjualan berhasil" — selaras
// dengan definisi yang sudah dipakai di dashboard admin (js/admin.js).
const SUCCESS_STATUSES = ['Selesai', 'Siap Diambil di Toko'];
const PENDING_STATUSES = ['Menunggu Pembayaran', 'Menunggu Verifikasi Admin'];

// Menyimpan hasil laporan yang sedang ditampilkan (dipakai saat cetak/download)
let currentReport = null;

function isAdminUser() {
    return !!(state.userProfile && state.userProfile.role === 'admin');
}

function denyAccess() {
    if (typeof window.showToast === 'function') {
        window.showToast('Akses ditolak. Fitur ini hanya untuk admin.', 'error');
    }
}

// --- HITUNG RENTANG TANGGAL BERDASARKAN PERIODE YANG DIPILIH ---
function pad(n) { return String(n).padStart(2, '0'); }

function formatTanggalPanjang(d) {
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getDailyRange(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    return { start, end, label: `Laporan Harian — ${formatTanggalPanjang(start)}` };
}

function getWeeklyRange(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const ref = new Date(y, m - 1, d);
    const day = ref.getDay(); // 0 = Minggu ... 6 = Sabtu
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(ref);
    monday.setDate(ref.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday, label: `Laporan Mingguan — ${formatTanggalPanjang(monday)} s/d ${formatTanggalPanjang(sunday)}` };
}

function getMonthlyRange(monthStr) {
    if (!monthStr) return null;
    const [y, m] = monthStr.split('-').map(Number);
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, m, 0, 23, 59, 59, 999); // hari terakhir bulan tsb
    const label = start.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return { start, end, label: `Laporan Bulanan — ${label}` };
}

// --- TOGGLE INPUT TANGGAL SESUAI JENIS PERIODE YANG DIPILIH ---
window.onLaporanPeriodChange = function() {
    const period = document.getElementById('laporan-period-select')?.value || 'harian';
    document.getElementById('laporan-input-harian')?.classList.toggle('hidden', period !== 'harian');
    document.getElementById('laporan-input-mingguan')?.classList.toggle('hidden', period !== 'mingguan');
    document.getElementById('laporan-input-bulanan')?.classList.toggle('hidden', period !== 'bulanan');
};

// --- INISIALISASI TAB LAPORAN (dipanggil dari switchAdminTab di admin.js) ---
window.initSalesReportTab = function() {
    if (!isAdminUser()) { denyAccess(); return; }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const monthStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;

    const dailyInput = document.getElementById('laporan-date-harian');
    const weeklyInput = document.getElementById('laporan-date-mingguan');
    const monthlyInput = document.getElementById('laporan-date-bulanan');
    if (dailyInput && !dailyInput.value) dailyInput.value = todayStr;
    if (weeklyInput && !weeklyInput.value) weeklyInput.value = todayStr;
    if (monthlyInput && !monthlyInput.value) monthlyInput.value = monthStr;

    window.onLaporanPeriodChange();

    // Tampilkan laporan hari ini secara default saat tab pertama dibuka
    window.generateSalesReport();
};

// --- QUERY TERSARING KE FIRESTORE (where + orderBy + rentang waktu) ---
async function fetchOrdersInRange(startMs, endMs) {
    const ordersCol = collection(db, 'artifacts', appId, 'orders');
    const q = query(
        ordersCol,
        where('createdAt', '>=', startMs),
        where('createdAt', '<=', endMs),
        orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return list;
}

// --- GENERATE LAPORAN (dipicu tombol "Tampilkan Laporan") ---
window.generateSalesReport = async function() {
    if (!isAdminUser()) { denyAccess(); return; }

    const period = document.getElementById('laporan-period-select')?.value || 'harian';
    let range = null;
    if (period === 'harian') {
        range = getDailyRange(document.getElementById('laporan-date-harian')?.value);
    } else if (period === 'mingguan') {
        range = getWeeklyRange(document.getElementById('laporan-date-mingguan')?.value);
    } else if (period === 'bulanan') {
        range = getMonthlyRange(document.getElementById('laporan-date-bulanan')?.value);
    }

    if (!range) {
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan pilih tanggal/bulan terlebih dahulu.', 'error');
        }
        return;
    }

    const btn = document.getElementById('btn-laporan-tampilkan');
    const btnText = document.getElementById('btn-laporan-tampilkan-text');
    const spinner = document.getElementById('btn-laporan-spinner');
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Memuat...';

    try {
        const orders = await fetchOrdersInRange(range.start.getTime(), range.end.getTime());
        currentReport = { label: range.label, orders, generatedAt: new Date() };
        renderSalesReport(currentReport);

        const printBtn = document.getElementById('btn-laporan-cetak');
        const downloadBtn = document.getElementById('btn-laporan-download');
        [printBtn, downloadBtn].forEach(b => {
            if (!b) return;
            b.disabled = false;
            b.className = 'px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-lg transition flex items-center gap-2';
        });
    } catch (err) {
        console.error('Gagal memuat laporan penjualan:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Gagal memuat laporan: ' + err.message, 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (btnText) btnText.textContent = 'Tampilkan Laporan';
    }
};

// --- RENDER HASIL LAPORAN (ringkasan + tabel transaksi) ---
function renderSalesReport(report) {
    const labelEl = document.getElementById('laporan-period-label');
    if (labelEl) labelEl.textContent = `${report.label} • ${report.orders.length} transaksi ditemukan`;

    const successOrders = report.orders.filter(o => SUCCESS_STATUSES.includes(o.status));
    const pendingOrders = report.orders.filter(o => PENDING_STATUSES.includes(o.status));
    const totalRevenue = successOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const avgPerTrx = successOrders.length > 0 ? totalRevenue / successOrders.length : 0;

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('laporan-stat-total-trx', report.orders.length);
    setText('laporan-stat-revenue', `Rp ${totalRevenue.toLocaleString('id-ID')}`);
    setText('laporan-stat-pending', pendingOrders.length);
    setText('laporan-stat-avg', `Rp ${Math.round(avgPerTrx).toLocaleString('id-ID')}`);

    const tbody = document.getElementById('laporan-table-body');
    if (!tbody) return;

    if (report.orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Tidak ada transaksi pada periode ini.</td></tr>`;
        return;
    }

    tbody.innerHTML = report.orders.map(o => `
        <tr>
            <td class="p-2.5 font-mono font-bold">${o.orderId || o.id}</td>
            <td class="p-2.5">${new Date(o.createdAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
            <td class="p-2.5">${o.customerName || '-'}</td>
            <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${window.getStatusBadgeColor ? window.getStatusBadgeColor(o.status) : 'bg-slate-100 text-slate-700'}">${o.status || '-'}</span></td>
            <td class="p-2.5 text-right font-bold">Rp ${(o.totalAmount || 0).toLocaleString('id-ID')}</td>
        </tr>
    `).join('');
}

// --- CETAK LAPORAN (window.print, hanya area #laporan-print-area yang tampil) ---
window.printSalesReport = function() {
    if (!isAdminUser()) { denyAccess(); return; }
    if (!currentReport) {
        if (typeof window.showToast === 'function') {
            window.showToast('Tampilkan laporan terlebih dahulu sebelum mencetak.', 'error');
        }
        return;
    }
    const printedAtEl = document.getElementById('laporan-printed-at');
    if (printedAtEl) {
        printedAtEl.textContent = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
    }
    window.print();
};

// --- DOWNLOAD LAPORAN SEBAGAI EXCEL (CSV, otomatis terbuka rapi di Excel) ---
window.downloadSalesReportCSV = function() {
    if (!isAdminUser()) { denyAccess(); return; }
    if (!currentReport || currentReport.orders.length === 0) {
        if (typeof window.showToast === 'function') {
            window.showToast('Tidak ada data laporan untuk diunduh.', 'error');
        }
        return;
    }

    const escapeCsv = (val) => {
        const str = String(val ?? '');
        if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
        return str;
    };

    const header = ['ID Pesanan', 'Tanggal', 'Pelanggan', 'No WA', 'Status', 'Total (Rp)'];
    const rows = currentReport.orders.map(o => [
        o.orderId || o.id,
        new Date(o.createdAt).toLocaleString('id-ID'),
        o.customerName || '-',
        o.customerPhone || '-',
        o.status || '-',
        o.totalAmount || 0
    ]);

    const successOrders = currentReport.orders.filter(o => SUCCESS_STATUSES.includes(o.status));
    const totalRevenue = successOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    let csv = `${currentReport.label}\r\n`;
    csv += `Total Transaksi,${currentReport.orders.length}\r\n`;
    csv += `Total Pendapatan (Rp),${totalRevenue}\r\n\r\n`;
    csv += header.map(escapeCsv).join(',') + '\r\n';
    csv += rows.map(r => r.map(escapeCsv).join(',')).join('\r\n');

    // BOM (\uFEFF) supaya karakter & format angka tampil benar saat dibuka di Excel
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const periodSlug = document.getElementById('laporan-period-select')?.value || 'laporan';
    const dateSlug = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `laporan-penjualan-${periodSlug}-${dateSlug}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof window.showToast === 'function') {
        window.showToast('Laporan berhasil diunduh (CSV/Excel).', 'success');
    }
};
