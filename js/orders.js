// ============================================================
// ORDERS MODULE
// Riwayat pesanan customer, pelacakan status pesanan (status
// banner + timeline vertikal + rincian pick up & produk), dan
// snapshot real-time koleksi orders dari Firestore.
// ============================================================
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state } from './state.js';

// --- FIRESTORE SNAPSHOT ORDERS (real-time) ---
export function setupOrdersSnapshot() {
    const ordersCol = collection(db, 'artifacts', appId, 'orders');
    onSnapshot(ordersCol, (snapshot) => {
        const list = [];
        snapshot.forEach(d => list.push({ id: d.id, ...d.data() }));
        // urutkan descending berdasarkan createdAt
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        state.orders = list;

        window.renderCustomerOrdersHistory();
        if(state.viewMode === 'admin') window.renderAdminDashboard();
    });
}

// --- URUTAN STATUS PESANAN (dipakai untuk timeline & banner) ---
const TIMELINE_STEPS = [
    { key: 'Menunggu Pembayaran',       title: 'Pesanan Dibuat',                     subtitle: 'Pilihan jadwal Store Pick Up dikonfirmasi' },
    { key: 'Menunggu Verifikasi Admin', title: 'Menunggu Verifikasi Admin',          subtitle: 'Bukti transfer QRIS DANA telah diupload' },
    { key: 'Diverifikasi & Dikemas',    title: 'Pembayaran Diterima & Diproses',     subtitle: 'Admin mengonfirmasi pembayaran & produk dipacking' },
    { key: 'Siap Diambil di Toko',      title: 'Siap Diambil di Toko',               subtitle: 'Pesanan siap di kasir YN Shop' },
    { key: 'Selesai',                   title: 'Sudah Diambil',                      subtitle: 'Customer mengambil barang di store' }
];

// Konten banner status (warna gradasi, badge, judul, deskripsi) per status
const STATUS_BANNER = {
    'Menunggu Pembayaran': {
        gradient: 'from-[#F59E0B] to-[#f97316]',
        title: 'Menunggu Pembayaran QRIS',
        desc: 'Segera selesaikan pembayaran QRIS DANA agar pesanan Anda dapat diproses oleh admin.'
    },
    'Menunggu Verifikasi Admin': {
        gradient: 'from-[#F59E0B] to-[#f97316]',
        title: 'Bukti Pembayaran Sedang Diverifikasi',
        desc: 'Admin YN Shop sedang memverifikasi bukti transfer QRIS Anda. Pesanan akan segera dikemas setelah pembayaran disetujui.'
    },
    'Diverifikasi & Dikemas': {
        gradient: 'from-blue-500 to-blue-600',
        title: 'Pesanan Anda Sedang Dikemas',
        desc: 'Pembayaran telah dikonfirmasi. Tim kami sedang menyiapkan pesanan Anda untuk diambil.'
    },
    'Siap Diambil di Toko': {
        gradient: 'from-[#22C55E] to-emerald-600',
        title: 'Pesanan Siap Diambil!',
        desc: 'Silakan datang ke outlet YN Shop sesuai jadwal pick up yang telah Anda pilih.'
    },
    'Selesai': {
        gradient: 'from-slate-500 to-slate-600',
        title: 'Pesanan Telah Selesai',
        desc: 'Terima kasih telah berbelanja di YN Shop. Sampai jumpa di pesanan berikutnya!'
    }
};

function renderTrackerTimeline(currentStatus) {
    const container = document.getElementById('tracker-timeline');
    if (!container) return;

    let currentIndex = TIMELINE_STEPS.findIndex(s => s.key === currentStatus);
    if (currentIndex === -1) currentIndex = 0;
    const currentStep = currentIndex + 1; // 1-based

    container.innerHTML = TIMELINE_STEPS.map((step, i) => {
        const stepNum = i + 1;
        const isLast = stepNum === TIMELINE_STEPS.length;
        const isDoneOrCurrent = stepNum <= currentStep;
        const isCurrent = stepNum === currentStep;

        const circleClass = isDoneOrCurrent
            ? 'bg-[#FF3B6B] text-white'
            : 'bg-slate-200 text-slate-400';
        const lineClass = stepNum < currentStep ? 'bg-[#FF3B6B]' : 'bg-slate-200';
        const titleClass = isCurrent
            ? 'text-[#FF3B6B] font-bold'
            : (isDoneOrCurrent ? 'text-[#111827] font-bold' : 'text-slate-400 font-bold');
        const subtitleClass = isDoneOrCurrent ? 'text-[#6B7280]' : 'text-slate-300';

        return `
            <div class="flex gap-4">
                <div class="flex flex-col items-center">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${circleClass}">
                        ${isDoneOrCurrent ? '<i class="fa-solid fa-check text-xs"></i>' : `<span class="text-xs font-bold">${stepNum}</span>`}
                    </div>
                    ${!isLast ? `<div class="w-0.5 flex-1 ${lineClass} my-1"></div>` : ''}
                </div>
                <div class="${isLast ? 'pb-0' : 'pb-7'}">
                    <h4 class="text-sm ${titleClass}">${step.title}</h4>
                    <p class="text-xs ${subtitleClass} mt-0.5">${step.subtitle}</p>
                </div>
            </div>
        `;
    }).join('');
}

window.openOrderTracker = function(orderId) {
    const order = state.orders.find(o => o.orderId === orderId) || state.currentOrderPayment;
    if(!order) return;

    const banner = STATUS_BANNER[order.status] || STATUS_BANNER['Menunggu Pembayaran'];

    // Header & status banner
    document.getElementById('tracker-order-id').textContent = order.orderId;
    document.getElementById('tracker-status-badge').textContent = order.status.toUpperCase();
    document.getElementById('tracker-status-title').textContent = banner.title;
    document.getElementById('tracker-status-desc').textContent = banner.desc;

    const dateObj = new Date(order.createdAt || Date.now());
    const formattedDate = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('tracker-order-date').textContent = `${formattedDate}, ${order.pickupSlot ? order.pickupSlot.split(' - ')[0] : ''} WIB`;

    const statusCard = document.getElementById('tracker-status-card');
    statusCard.className = `bg-gradient-to-r ${banner.gradient} text-white p-6 sm:p-7 rounded-[20px] shadow-md space-y-3`;

    // Timeline
    renderTrackerTimeline(order.status);

    // Informasi Pick Up
    document.getElementById('tracker-pickup-date-val').textContent = order.pickupDate || '-';
    document.getElementById('tracker-pickup-time-val').textContent = order.pickupSlot ? `${order.pickupSlot} WIB` : '-';
    document.getElementById('tracker-notes-val').textContent = order.notes && order.notes.trim() ? order.notes : '-';

    // Rincian Produk
    const productsList = document.getElementById('tracker-products-list');
    if (productsList && order.items) {
        productsList.innerHTML = order.items.map(item => `
            <div class="flex justify-between items-start gap-3">
                <span class="text-slate-700 flex-1"><span class="font-bold text-[#FF3B6B]">${item.qty}x</span> ${item.name}</span>
                <span class="font-semibold text-[#111827] whitespace-nowrap">Rp ${(item.price * item.qty).toLocaleString('id-ID')}</span>
            </div>
        `).join('');
    }
    document.getElementById('tracker-total-amount').textContent = `Rp ${order.totalAmount.toLocaleString('id-ID')}`;

    window.navigateTo('order-tracker');
};

function renderCustomerOrdersHistory() {
    const container = document.getElementById('customer-orders-history-list');
    if(!container) return;

    const uid = state.user ? state.user.uid : 'guest';
    const userOrders = state.orders.filter(o => o.userId === uid || o.customerEmail === (state.userProfile ? state.userProfile.email : ''));

    if (userOrders.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs"><i class="fa-solid fa-receipt text-3xl mb-2"></i><p>Belum ada riwayat pesanan.</p></div>`;
        return;
    }

    container.innerHTML = userOrders.map(o => `
        <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3">
            <div class="flex justify-between items-center text-xs">
                <span class="font-bold text-slate-900 font-mono">${o.orderId}</span>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${window.getStatusBadgeColor(o.status)}">${o.status}</span>
            </div>
            <div class="text-xs text-slate-600 space-y-1">
                <p><strong>Jadwal Pick Up:</strong> ${o.pickupDate} (${o.pickupSlot} WIB)</p>
                <p><strong>Total:</strong> <span class="text-brand-600 font-bold">Rp ${o.totalAmount.toLocaleString('id-ID')}</span></p>
            </div>
            <button onclick="window.openOrderTracker('${o.orderId}')" class="px-3 py-1.5 bg-brand-600 text-white font-bold text-[11px] rounded-lg shadow hover:bg-brand-700 transition">
                Lacak Status Pesanan
            </button>
        </div>
    `).join('');
}

function getStatusBadgeColor(status) {
    switch(status) {
        case 'Menunggu Pembayaran': return 'bg-amber-100 text-amber-800';
        case 'Menunggu Verifikasi Admin': return 'bg-purple-100 text-purple-800';
        case 'Diverifikasi & Dikemas': return 'bg-blue-100 text-blue-800';
        case 'Siap Diambil di Toko': return 'bg-emerald-100 text-emerald-800';
        case 'Selesai': return 'bg-slate-200 text-slate-800';
        default: return 'bg-slate-100 text-slate-700';
    }
}

// Dipakai juga oleh admin.js, checkout.js
window.getStatusBadgeColor = getStatusBadgeColor;
window.renderCustomerOrdersHistory = renderCustomerOrdersHistory;
