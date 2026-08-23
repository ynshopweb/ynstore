// ============================================================
// UI HELPERS
// Notifikasi toast, navigasi antar-view, switch mode customer/admin,
// dan toggle dropdown/menu mobile.
// ============================================================
import { state } from './state.js';
import { isValidAdminProfile } from './auth/core.js';

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

// Halaman yang WAJIB login (Firebase Authentication) sebelum bisa diakses.
// Guest User tetap boleh melihat Home, Produk, Cara Order, Tentang Kami,
// dan Keranjang (drawer) tanpa batasan.
const GUEST_RESTRICTED_VIEWS = ['checkout', 'payment', 'customer-profile', 'order-tracker'];

// ================= PERTAHANKAN HALAMAN TERAKHIR SETELAH REFRESH =================
// Hanya view yang "berdiri sendiri" (tidak butuh data sementara di memori)
// yang aman untuk dipulihkan langsung setelah refresh. 'checkout' butuh
// isi keranjang, dan 'payment'/'order-tracker' butuh konteks pesanan aktif
// (state.currentOrderPayment) — semua itu HANYA ada di memori JS dan ikut
// hilang setiap refresh, jadi kalau dipulihkan begitu saja user akan
// melihat halaman kosong/rusak. Ketiganya sengaja TIDAK dipulihkan;
// refresh dari halaman itu akan jatuh ke 'home' seperti biasa.
const RESTORABLE_CUSTOMER_VIEWS = ['home', 'about', 'how-to-order', 'products', 'promo', 'customer-profile'];
const NAV_STORAGE_KEYS = {
    viewMode: 'ynshop_last_view_mode',       // 'customer' | 'admin'
    customerView: 'ynshop_last_customer_view',
    adminTab: 'ynshop_last_admin_tab'
};
export { NAV_STORAGE_KEYS };

function persistNav(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* ignore (mis. private mode) */ }
}
function readNav(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
}
export { readNav, persistNav };
// Dipanggil saat logout (lihat js/auth/core.js) supaya sesi berikutnya
// (user lain / guest) tidak "mewarisi" posisi halaman & mode admin milik
// user sebelumnya.
window.clearPersistedNav = function() {
    try {
        Object.values(NAV_STORAGE_KEYS).forEach(k => sessionStorage.removeItem(k));
    } catch (_) { /* ignore */ }
};

window.navigateTo = function(viewId) {
    // --- GUARD: proteksi akses langsung ke halaman yang butuh login ---
    // Berlaku baik dipanggil lewat tombol/menu maupun langsung dari console/URL.
    // state.user diisi oleh listener onAuthStateChanged (js/auth/core.js) sebagai
    // satu-satunya sumber kebenaran status login (bukan Local Storage).
    if (GUEST_RESTRICTED_VIEWS.includes(viewId) && !state.user) {
        if (viewId === 'checkout' && state) {
            state.pendingRedirect = 'checkout';
            window.pendingRedirect = 'checkout';
        }
        if (typeof window.showLoginRequiredModal === 'function') {
            window.showLoginRequiredModal();
        }
        return;
    }

    state.activeView = viewId;
    const views = document.querySelectorAll('.view-page');
    views.forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Simpan halaman ini sebagai "halaman terakhir" supaya bisa dipulihkan
    // kalau browser di-refresh (lihat bootstrapApp() di js/main.js).
    if (RESTORABLE_CUSTOMER_VIEWS.includes(viewId)) {
        persistNav(NAV_STORAGE_KEYS.customerView, viewId);
    }
};

window.switchToViewMode = function(mode) {
    // --- GUARD AKSES PANEL ADMIN ---
    // Hanya user dengan role Firestore 'admin' yang boleh membuka Panel
    // Admin. Berlaku untuk semua jalur pemanggilan (klik menu, maupun
    // dipanggil langsung lewat console), bukan hanya menyembunyikan link.
    if (mode === 'admin') {
        const isAdmin = isValidAdminProfile(state.userProfile);
        if (!isAdmin) {
            if (typeof window.showToast === 'function') {
                window.showToast('Akses ditolak. Anda tidak memiliki izin sebagai Admin.', 'error');
            }
            return;
        }
    }

    state.viewMode = mode;
    const customerHeader = document.getElementById('customer-header');
    const customerMain = document.getElementById('customer-main-view');
    const adminMain = document.getElementById('admin-main-view');
    const customerFooter = document.getElementById('customer-footer');
    const roleIndicator = document.getElementById('current-role-indicator');

    // PERBAIKAN LIFECYCLE: pengaman tambahan terhadap race condition —
    // elemen-elemen ini berasal dari partials/*.html yang dimuat async
    // lewat fetch() (lihat js/main.js -> loadAllPartials()). Kalau fungsi
    // ini sampai terpanggil sebelum partials selesai dimuat, sebelumnya
    // baris di bawah akan melempar TypeError ("Cannot read properties of
    // null") karena tidak ada null-check, yang bisa membuat proses
    // switchToViewMode berhenti di tengah jalan (halaman terlihat "nyangkut"
    // separuh customer separuh admin). Sekarang aman: kalau partials
    // belum siap, cukup keluar dan tidak melakukan apa-apa.
    if (!customerMain || !adminMain) return;

    // Simpan mode ini sebagai "mode terakhir" supaya bisa dipulihkan kalau
    // browser di-refresh saat sedang berada di Panel Admin (lihat
    // wantsAdminDashboard() di js/main.js).
    persistNav(NAV_STORAGE_KEYS.viewMode, mode);

    if (mode === 'admin') {
        if (customerHeader) customerHeader.classList.add('hidden');
        customerMain.classList.add('hidden');
        if (customerFooter) customerFooter.classList.add('hidden');
        adminMain.classList.remove('hidden');
        if (roleIndicator) {
            roleIndicator.textContent = "Admin Panel";
            roleIndicator.className = "font-bold text-emerald-400 uppercase tracking-wider";
        }
        window.renderAdminDashboard();
    } else {
        if (customerHeader) customerHeader.classList.remove('hidden');
        customerMain.classList.remove('hidden');
        if (customerFooter) customerFooter.classList.remove('hidden');
        adminMain.classList.add('hidden');
        if (roleIndicator) {
            roleIndicator.textContent = "Customer View";
            roleIndicator.className = "font-bold text-rose-400 uppercase tracking-wider";
        }
        window.navigateTo(state.activeView || 'home');
    }
};

window.toggleUserDropdown = function() {
    document.getElementById('user-dropdown-menu').classList.toggle('hidden');
};

window.toggleMobileNav = function() {
    document.getElementById('mobile-nav-panel').classList.toggle('hidden');
};

// --- HEADER SHADOW ON SCROLL ---
// Header TIDAK lagi sticky/fixed (lihat header.html), jadi header akan
// ikut bergeser normal saat halaman discroll. Di sini kita hanya
// menambah/menghapus shadow lembut begitu halaman mulai discroll,
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
