// ============================================================
// UI HELPERS
// Notifikasi toast, navigasi antar-view, switch mode customer/admin,
// dan toggle dropdown/menu mobile.
// ============================================================
import { state } from './state.js';

window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-circle-check text-emerald-500' : (type === 'error' ? 'fa-circle-exclamation text-rose-500' : 'fa-circle-info text-blue-500');
    toast.innerHTML = `
        <i class="fa-solid ${icon} text-lg"></i>
        <div class="flex-1">
            <p class="font-bold text-xs">${type === 'success' ? 'Berhasil' : (type === 'error' ? 'Gagal' : 'Info')}</p>
            <p class="text-xs text-slate-600">${message}</p>
        </div>
        <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

window.navigateTo = function(viewId) {
    state.activeView = viewId;
    const views = document.querySelectorAll('.view-page');
    views.forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.switchToViewMode = function(mode) {
    state.viewMode = mode;
    const customerHeader = document.getElementById('customer-header');
    const customerMain = document.getElementById('customer-main-view');
    const adminMain = document.getElementById('admin-main-view');
    const customerFooter = document.getElementById('customer-footer');
    const roleIndicator = document.getElementById('current-role-indicator');

    if (mode === 'admin') {
        customerHeader.classList.add('hidden');
        customerMain.classList.add('hidden');
        customerFooter.classList.add('hidden');
        adminMain.classList.remove('hidden');
        roleIndicator.textContent = "Admin Panel";
        roleIndicator.className = "font-bold text-emerald-400 uppercase tracking-wider";
        window.renderAdminDashboard();
    } else {
        customerHeader.classList.remove('hidden');
        customerMain.classList.remove('hidden');
        customerFooter.classList.remove('hidden');
        adminMain.classList.add('hidden');
        roleIndicator.textContent = "Customer View";
        roleIndicator.className = "font-bold text-rose-400 uppercase tracking-wider";
        window.navigateTo(state.activeView || 'home');
    }
};

window.toggleUserDropdown = function() {
    document.getElementById('user-dropdown-menu').classList.toggle('hidden');
};

window.toggleMobileNav = function() {
    document.getElementById('mobile-nav-panel').classList.toggle('hidden');
};

// --- STICKY HEADER SHADOW ON SCROLL ---
// Header sudah sticky secara default (lihat header.html). Di sini kita
// hanya menambah/menghapus shadow lembut begitu halaman mulai discroll,
// dengan transisi halus (class transition-shadow sudah ada di header.html).
window.addEventListener('scroll', () => {
    const header = document.getElementById('customer-header');
    if (!header) return;
    if (window.scrollY > 8) {
        header.classList.add('shadow-md');
    } else {
        header.classList.remove('shadow-md');
    }
}, { passive: true });
