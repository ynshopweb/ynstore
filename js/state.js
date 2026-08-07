// ============================================================
// GLOBAL APP STATE
// State bersama dipakai oleh semua modul lain via:
//   import { state, INITIAL_PRODUCTS } from './state.js'
// ============================================================

export const state = {
    user: null,
    userProfile: null,
    viewMode: 'customer', // 'customer' | 'admin'
    activeView: 'home',
    cart: [],
    products: [],
    orders: [],
    activeFilters: { brand: 'all', category: 'all', maxPrice: 500000, search: '', sortBy: 'latest' },
    currentOrderPayment: null,
    proofBase64: null,
    chartInstance: null,
    // Pengaturan pembayaran (QRIS) — diisi realtime dari Firestore settings/payment
    paymentSettings: { qrisImageUrl: null, qrisOwner: '', paymentProvider: '', updatedAt: null, updatedBy: '' }
};

// Alias ke window supaya atribut inline di HTML (mis. onchange="window.state...")
// tetap berfungsi tanpa perlu diubah.
window.state = state;

// --- INITIAL MOCK DATA SEED (dipakai saat koleksi Firestore masih kosong) ---
// Catatan field `promo` (fitur Promo Produk):
// promo BUKAN koleksi terpisah — hanya field tambahan di tiap produk.
// { active, type: 'percentage'|'nominal', value, startDate, endDate }
// startDate/endDate memakai rentang lebar (tahun jauh) khusus untuk 2
// produk contoh di bawah supaya promo langsung terlihat aktif saat
// koleksi Firestore masih kosong (demo data), admin bebas mengubahnya.
export const INITIAL_PRODUCTS = [
    { id: 'p1', name: 'Skintific 5X Ceramide Barrier Moisturizer', brand: 'Skintific', category: 'Moisturizer', price: 139000, originalPrice: 169000, rating: 4.9, sales: 340, isBestseller: true, isNew: false, image: 'https://images.unsplash.com/photo-1608248597261-8332570543a8?w=500&auto=format&fit=crop&q=80', description: 'Moisturizer yang menggabungkan 3 kandungan aktif Ceramide, Hyaluronic Acid, dan Centella Asiatica.', stock: 25, promo: { active: true, type: 'percentage', value: 20, startDate: '2024-01-01T00:00', endDate: '2030-12-31T23:59' } },
    { id: 'p2', name: 'Wardah UV Shield Essential Sunscreen SPF 50', brand: 'Wardah', category: 'Sunscreen', price: 38000, originalPrice: 45000, rating: 4.8, sales: 520, isBestseller: true, isNew: false, image: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=500&auto=format&fit=crop&q=80', description: 'Sunscreen dengan SkinBoost DNA yang melindungi kulit hingga tingkat selular.', stock: 40, promo: { active: false, type: 'percentage', value: 0, startDate: '', endDate: '' } },
    { id: 'p3', name: 'Somethinc Niacinamide + Moisture Sabi Beet Serum', brand: 'Somethinc', category: 'Serum', price: 115000, originalPrice: 130000, rating: 4.9, sales: 210, isBestseller: true, isNew: true, image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=500&auto=format&fit=crop&q=80', description: 'Membantu mencerahkan, menyamarkan noda hitam, & merawat kekencangan kulit.', stock: 15, promo: { active: true, type: 'nominal', value: 15000, startDate: '2024-01-01T00:00', endDate: '2030-12-31T23:59' } },
    { id: 'p4', name: 'Azarine Hydrasoothe Sunscreen Gel SPF45', brand: 'Azarine', category: 'Sunscreen', price: 65000, originalPrice: 75000, rating: 4.7, sales: 410, isBestseller: true, isNew: false, image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&auto=format&fit=crop&q=80', description: 'Sunscreen dalam bentuk gel dingin berbasis air yang sangat ringan.', stock: 30, promo: { active: false, type: 'percentage', value: 0, startDate: '', endDate: '' } },
    { id: 'p5', name: 'Make Over Hydrastay Lite Glow Cushion', brand: 'Make Over', category: 'Cushion', price: 185000, originalPrice: 215000, rating: 4.8, sales: 180, isBestseller: false, isNew: true, image: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=500&auto=format&fit=crop&q=80', description: 'Cushion dengan daya tutup medium to full dengan efek hydrated glow.', stock: 0, promo: { active: false, type: 'percentage', value: 0, startDate: '', endDate: '' } }
];
