// ============================================================
// ADMIN MODULE
// Dashboard analitik, verifikasi pesanan, dan CRUD produk
// (Create, Read, Update, Delete) untuk panel admin.
//
// CATATAN PERBAIKAN dari file asli:
// - `openAddProductModal()` dipanggil di HTML tapi tidak pernah
//   didefinisikan -> sekarang diimplementasikan lengkap dengan
//   modal tambah/edit produk (saveProduct, editProduct, closeProductModal).
// - `viewProofModal()` dipanggil di tabel pesanan tapi tidak pernah
//   didefinisikan -> sekarang diimplementasikan sebagai modal
//   preview foto bukti transfer.
// ============================================================
import { doc, addDoc, updateDoc, deleteDoc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state } from './state.js';

window.switchAdminTab = function(tab) {
    document.getElementById('admin-subview-dashboard').classList.add('hidden');
    document.getElementById('admin-subview-orders').classList.add('hidden');
    document.getElementById('admin-subview-products').classList.add('hidden');

    document.getElementById(`admin-subview-${tab}`).classList.remove('hidden');

    if(tab === 'dashboard') window.renderAdminDashboard();
    if(tab === 'orders') window.renderAdminOrdersTable();
    if(tab === 'products') window.renderAdminProductsTable();
};

function renderAdminDashboard() {
    const orders = state.orders;
    const totalSales = orders.filter(o => o.status === 'Selesai' || o.status === 'Siap Diambil di Toko').reduce((sum, o) => sum + o.totalAmount, 0);
    const pendingVerif = orders.filter(o => o.status === 'Menunggu Verifikasi Admin').length;
    const readyPick = orders.filter(o => o.status === 'Siap Diambil di Toko').length;

    document.getElementById('adm-stat-sales').textContent = `Rp ${totalSales.toLocaleString('id-ID')}`;
    document.getElementById('adm-stat-pending').textContent = pendingVerif;
    document.getElementById('adm-stat-ready').textContent = readyPick;
    document.getElementById('adm-stat-products').textContent = state.products.length;

    // Render Chart
    const ctx = document.getElementById('adminSalesChart');
    if (ctx) {
        if(state.chartInstance) state.chartInstance.destroy();
        state.chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Ming'],
                datasets: [{
                    label: 'Penjualan (Rp)',
                    data: [1200000, 1900000, 1500000, 2200000, 2800000, 3500000, totalSales || 4100000],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }
}

function renderAdminOrdersTable() {
    const tbody = document.getElementById('admin-orders-tbody');
    if(!tbody) return;

    if (state.orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-500">Belum ada transaksi.</td></tr>`;
        return;
    }

    tbody.innerHTML = state.orders.map(o => `
        <tr>
            <td class="p-3.5"><p class="font-bold text-white">${o.orderId}</p><p class="text-[10px] text-slate-500">${new Date(o.createdAt).toLocaleDateString('id-ID')}</p></td>
            <td class="p-3.5"><p class="font-bold text-slate-200">${o.customerName}</p><p class="text-[10px] text-slate-400">${o.customerPhone}</p></td>
            <td class="p-3.5">${o.pickupDate}<br><span class="text-slate-400">${o.pickupSlot} WIB</span></td>
            <td class="p-3.5 font-bold text-emerald-400">Rp ${o.totalAmount.toLocaleString('id-ID')}</td>
            <td class="p-3.5">
                ${o.proofImage ? `<button onclick="window.viewProofModal('${o.proofImage}')" class="px-2 py-1 bg-slate-700 text-slate-200 rounded text-[10px]"><i class="fa-solid fa-image me-1"></i> Lihat Foto</button>` : '<span class="text-slate-500 italic">Belum upload</span>'}
            </td>
            <td class="p-3.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${window.getStatusBadgeColor(o.status)}">${o.status}</span></td>
            <td class="p-3.5 text-right space-x-1">
                <button onclick="window.updateOrderStatus('${o.orderId}', 'Diverifikasi & Dikemas')" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded">Verifikasi</button>
                <button onclick="window.updateOrderStatus('${o.orderId}', 'Siap Diambil di Toko')" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded">Siap Ambil</button>
                <button onclick="window.updateOrderStatus('${o.orderId}', 'Selesai')" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] rounded">Selesai</button>
            </td>
        </tr>
    `).join('');
}

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'orders', orderId), { status: newStatus });
        window.showToast(`Status order ${orderId} diubah ke '${newStatus}'`, 'success');
    } catch(e) {
        window.showToast('Gagal update status: ' + e.message, 'error');
    }
};

// --- PREVIEW BUKTI PEMBAYARAN (sebelumnya dipanggil di HTML tapi belum ada) ---
window.viewProofModal = function(imageSrc) {
    const modal = document.getElementById('proof-preview-modal');
    const img = document.getElementById('proof-preview-image');
    if (modal && img) {
        img.src = imageSrc;
        modal.classList.remove('hidden');
    }
};

window.closeProofModal = function() {
    document.getElementById('proof-preview-modal').classList.add('hidden');
};

// --- PRODUCTS CRUD (Read + Delete dari file asli, Create/Update baru) ---
function renderAdminProductsTable() {
    const tbody = document.getElementById('admin-products-tbody');
    if(!tbody) return;

    tbody.innerHTML = state.products.map(p => `
        <tr>
            <td class="p-3.5 flex items-center gap-2">
                <img src="${p.image}" class="w-8 h-8 rounded object-cover">
                <span class="font-bold text-white">${p.name}</span>
            </td>
            <td class="p-3.5">${p.brand} / ${p.category}</td>
            <td class="p-3.5 font-bold text-rose-400">Rp ${p.price.toLocaleString('id-ID')}</td>
            <td class="p-3.5"><span class="bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded text-[10px]">Tersedia</span></td>
            <td class="p-3.5 text-right space-x-1">
                <button onclick='window.editProduct(${JSON.stringify(p.id)})' class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded"><i class="fa-solid fa-pen"></i></button>
                <button onclick="window.deleteProduct('${p.id}')" class="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] rounded"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

window.deleteProduct = async function(productId) {
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'products', productId));
        window.showToast('Produk berhasil dihapus!', 'success');
    } catch(e) {
        window.showToast('Gagal menghapus produk: ' + e.message, 'error');
    }
};

// --- CREATE / UPDATE: modal form tambah & edit produk ---
window.openAddProductModal = function() {
    document.getElementById('product-form').reset();
    document.getElementById('product-form-id').value = '';
    document.getElementById('product-form-title').textContent = 'Tambah Produk Baru';
    document.getElementById('product-form-modal').classList.remove('hidden');
};

window.editProduct = function(productId) {
    const p = state.products.find(item => item.id === productId);
    if (!p) return;

    document.getElementById('product-form-id').value = p.id;
    document.getElementById('product-form-name').value = p.name || '';
    document.getElementById('product-form-brand').value = p.brand || '';
    document.getElementById('product-form-category').value = p.category || '';
    document.getElementById('product-form-price').value = p.price || 0;
    document.getElementById('product-form-original-price').value = p.originalPrice || '';
    document.getElementById('product-form-image').value = p.image || '';
    document.getElementById('product-form-description').value = p.description || '';

    document.getElementById('product-form-title').textContent = 'Edit Produk';
    document.getElementById('product-form-modal').classList.remove('hidden');
};

window.closeProductModal = function() {
    document.getElementById('product-form-modal').classList.add('hidden');
};

window.saveProduct = async function(e) {
    e.preventDefault();
    const id = document.getElementById('product-form-id').value;

    const productData = {
        name: document.getElementById('product-form-name').value,
        brand: document.getElementById('product-form-brand').value,
        category: document.getElementById('product-form-category').value,
        price: parseInt(document.getElementById('product-form-price').value) || 0,
        originalPrice: parseInt(document.getElementById('product-form-original-price').value) || null,
        image: document.getElementById('product-form-image').value,
        description: document.getElementById('product-form-description').value,
        rating: 5,
        sales: 0,
        isBestseller: false,
        isNew: true
    };

    try {
        if (id) {
            // UPDATE produk yang sudah ada
            await updateDoc(doc(db, 'artifacts', appId, 'products', id), productData);
            window.showToast('Produk berhasil diperbarui!', 'success');
        } else {
            // CREATE produk baru
            await addDoc(collection(db, 'artifacts', appId, 'products'), productData);
            window.showToast('Produk baru berhasil ditambahkan!', 'success');
        }
        window.closeProductModal();
    } catch (err) {
        window.showToast('Gagal menyimpan produk: ' + err.message, 'error');
    }
};

// Dipakai juga oleh ui.js (switchToViewMode), orders.js & products.js (snapshot real-time)
window.renderAdminDashboard = renderAdminDashboard;
window.renderAdminOrdersTable = renderAdminOrdersTable;
window.renderAdminProductsTable = renderAdminProductsTable;
