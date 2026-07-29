// ============================================================
// ORDERS MODULE
// Riwayat pesanan customer, pelacakan status pesanan, dan
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

        renderCustomerOrdersHistory();
        if(state.viewMode === 'admin') renderAdminDashboard();
    });
}

        window.openOrderTracker = function(orderId) {
            const order = state.orders.find(o => o.orderId === orderId) || state.currentOrderPayment;
            if(!order) return;

            document.getElementById('tracker-order-id').textContent = order.orderId;
            document.getElementById('tracker-status-badge').textContent = order.status;
            document.getElementById('tracker-pickup-date-val').textContent = order.pickupDate;
            document.getElementById('tracker-pickup-time-val').textContent = order.pickupSlot + ' WIB';
            document.getElementById('tracker-total-amount').textContent = `Rp ${order.totalAmount.toLocaleString('id-ID')}`;

            navigateTo('order-tracker');
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
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${getStatusBadgeColor(o.status)}">${o.status}</span>
                    </div>
                    <div class="text-xs text-slate-600 space-y-1">
                        <p><strong>Jadwal Pick Up:</strong> ${o.pickupDate} (${o.pickupSlot} WIB)</p>
                        <p><strong>Total:</strong> <span class="text-brand-600 font-bold">Rp ${o.totalAmount.toLocaleString('id-ID')}</span></p>
                    </div>
                    <button onclick="openOrderTracker('${o.orderId}')" class="px-3 py-1.5 bg-brand-600 text-white font-bold text-[11px] rounded-lg shadow hover:bg-brand-700 transition">
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


// getStatusBadgeColor dipakai juga oleh admin.js
window.getStatusBadgeColor = getStatusBadgeColor;
