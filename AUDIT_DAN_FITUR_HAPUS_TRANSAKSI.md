# Audit & Perbaikan — YNShop Website Utama (ynstore)

Arsitektur Firebase Auth (Email/Password + Google, terpisah untuk Customer
`/login` dan Admin `/admin-login`, `onAuthStateChanged` sebagai sumber
kebenaran status login) **dipertahankan sepenuhnya**. Tidak ada sistem login
baru. Semua perbaikan di bawah ini murni memperbaiki *lifecycle* & *race
condition* di atas arsitektur yang sudah ada.

## Akar masalah yang ditemukan

### 1. RACE CONDITION UTAMA — Dashboard Admin menolak admin yang valid secara acak
**Lokasi:** `js/main.js` → `resumePendingAdminDashboard()`

Ini alur yang berjalan setiap kali admin berhasil login (baik dari form
`/admin-login` maupun saat admin membuka `/admin-login` dengan sesi yang
sudah aktif) dan diarahkan balik ke `index.html`.

Fungsi ini melakukan `getDoc()` **sendiri** untuk memvalidasi profil admin,
lalu memanggil `window.switchToViewMode('admin')`. Tapi `switchToViewMode()`
(di `js/ui.js`) memvalidasi ulang admin dengan **membaca `state.userProfile`**
— yang diisi oleh proses **async lain yang sepenuhnya terpisah**: listener
`onSnapshot()` di `js/auth/core.js`.

Dua pembacaan Firestore yang berjalan independen ini **tidak ada jaminan
urutan selesainya**. Kalau `onSnapshot()` di `core.js` belum sempat mengisi
`state.userProfile` pada saat `switchToViewMode('admin')` dipanggil (sangat
mungkin terjadi, apalagi tepat setelah reload penuh dari halaman
`/admin-login`), maka admin yang **sebenarnya valid** ditolak dengan pesan
"Akses ditolak" — murni soal siapa yang menang balapan jaringan. Ini
menjelaskan **semua** gejala berikut sekaligus, karena sifatnya memang acak:
- "Login sering bug"
- "Kadang setelah login berhasil malah kembali ke halaman login"
- "Dashboard dapat melakukan inisialisasi berulang" (admin coba lagi berkali-kali)

Menariknya, bug yang **persis sama** sudah pernah diperbaiki di
`finalizeSuccessfulLogin()` (`js/auth/core.js`, sudah ada komentar "BUG FIX"
di sana) — tapi jalur `resumePendingAdminDashboard()` ini terlewat.

**Perbaikan:** mengisi `state.user` & `state.userProfile` secara *synchronous*
dari profil yang **baru saja divalidasi** di fungsi ini sendiri, sebelum
memanggil `switchToViewMode('admin')` — persis pola yang sudah dipakai
`finalizeSuccessfulLogin()`.

### 2. Header/nav bisa "tersangkut" menampilkan status Tamu walau sudah login
**Lokasi:** `js/auth/core.js` (listener profil) + `js/main.js` (bootstrap)

Update UI header (nama user, tombol Masuk/Daftar vs Profil, link menu Admin,
prefill form checkout) hanya dilakukan di dalam callback `onSnapshot()` pada
listener status login, yang didaftarkan **sebelum** `DOMContentLoaded` —
sedangkan elemen-elemen DOM yang disentuhnya berasal dari `partials/*.html`
yang baru disuntikkan secara **async lewat `fetch()`** setelah
`DOMContentLoaded`.

Firebase Auth memulihkan sesi tersimpan juga secara async, tanpa jaminan
urutan terhadap proses `fetch()` partials. Kalau pemulihan sesi selesai
lebih dulu, panggilan pertama update UI ini berjalan sebelum elemen header
ada di DOM — karena ada null-check di tiap elemen, update ini **senyap** dan
**tidak pernah dicoba ulang** sampai ada perubahan lain pada dokumen profil
(bisa jadi tidak pernah terjadi sepanjang sesi). Efeknya: user sebenarnya
sudah login, tapi header masih menampilkan "Tamu" — persis gejala "session
login kadang seperti hilang sendiri".

**Perbaikan:** logika update UI dipisah jadi fungsi tersendiri
`syncAuthHeaderUI()` (exported dari `core.js`), dan dipanggil **sekali lagi**
dari `bootstrapApp()` di `js/main.js` setelah semua partial selesai dimuat —
sebagai "catch-up" memakai `state.user`/`state.userProfile` yang sudah ada
saat itu.

### 3. `switchToViewMode()` tidak punya pengaman null (bisa crash di tengah proses)
**Lokasi:** `js/ui.js`

Kalau `switchToViewMode()` sampai terpanggil sebelum partials selesai
dimuat, kode lama akan melempar `TypeError` (tidak ada null-check pada
`customerHeader`/`customerFooter`) dan proses berhenti di tengah jalan —
halaman bisa "nyangkut" separuh customer separuh admin.

**Perbaikan:** ditambahkan null-check di semua elemen terkait + early-return
kalau elemen inti (`customerMain`/`adminMain`) belum ada di DOM.

### 4. Listener Firestore tidak dijaga dari subscribe dobel (kecuali `users-admin.js`)
**Lokasi:** `js/products.js`, `js/orders.js`, `js/settings.js`

`setupUsersSnapshot()` sudah punya pengaman `if (usersUnsubscribe) return;`,
tapi tiga fungsi setup lain (`setupProductsSnapshot`, `setupOrdersSnapshot`,
`setupPaymentSettingsSnapshot`) belum. Dalam kondisi normal fungsi ini hanya
dipanggil sekali (saat `bootstrapApp()`), tapi ini pengaman defensif yang
konsisten dengan pola yang sudah ada di `users-admin.js`, langsung menjawab
poin "dashboard dapat melakukan inisialisasi berulang".

**Perbaikan:** ditambahkan pengaman yang sama di ketiga fungsi tersebut.

## Berkas yang diubah (audit login)
- `js/main.js` — fix race condition utama (#1), panggil `syncAuthHeaderUI()` setelah partials dimuat (#2).
- `js/auth/core.js` — ekstrak `syncAuthHeaderUI()` sebagai fungsi terpisah & exported (#2).
- `js/ui.js` — null-guard di `switchToViewMode()` (#3).
- `js/products.js`, `js/orders.js`, `js/settings.js` — pengaman anti-subscribe-dobel (#4).

## Yang TIDAK diubah (sesuai instruksi)
- Provider/metode auth (Email/Password + Google) — tetap sama persis.
- Pemisahan Login Customer (`/login`) vs Login Admin (`/admin-login`) — tetap.
- Struktur Firestore, path dokumen, aturan role admin/customer — tidak disentuh.
- Semua dialog (Sesi Berakhir, Akun Dinonaktifkan, Email Belum Diverifikasi) — tetap.

---

# Fitur Baru: Hapus Transaksi di "Kelola Transaksi & Verifikasi Bukti QRIS"

Sesuai permintaan, ditambahkan opsi hapus transaksi di tab Admin > Kelola
Transaksi:

1. **Hapus satu transaksi** — tombol 🗑️ merah di tiap baris tabel (kolom Aksi),
   dengan dialog konfirmasi sebelum menghapus.
2. **Hapus transaksi lama sekaligus** — tombol "Hapus Transaksi Lama" di atas
   tabel, dengan pilihan **lebih dari 30 hari** atau **lebih dari 90 hari**.
   - Hanya menghapus transaksi yang **sudah tuntas** (status "Selesai" atau
     "Siap Diambil di Toko") — transaksi yang masih berjalan (Menunggu
     Pembayaran / Menunggu Verifikasi / Diverifikasi & Dikemas) **tidak
     pernah** ikut terhapus otomatis meski sudah lama, supaya pesanan yang
     terlantar tetap terlihat admin untuk ditindaklanjuti.
   - Menampilkan jumlah transaksi yang akan terhapus di dialog konfirmasi
     sebelum benar-benar menghapus.
3. Karena bukti QRIS disimpan langsung sebagai base64 di dalam dokumen order
   (bukan file terpisah di Firebase Storage), menghapus dokumen order sudah
   otomatis membersihkan bukti transfernya juga — tidak ada file "yatim"
   yang tertinggal.

## Berkas yang diubah (fitur hapus transaksi)
- `js/admin.js` — `window.deleteOrder()`, `window.deleteOldTransactions()`.
- `partials/admin.html` — tombol "Hapus" per baris + tombol "Hapus Transaksi Lama" + dropdown 30/90 hari.

## Disarankan diperiksa selanjutnya (di luar kode ini)
- **Firestore Security Rules**: pastikan rules produksi mengizinkan
  `delete` pada koleksi `orders` **hanya** untuk user dengan role admin
  (`request.auth.uid` yang profilnya `role == 'admin' && status == 'active'`),
  supaya tombol hapus ini benar-benar aman di sisi server, bukan cuma
  disembunyikan di sisi UI.
- Pertimbangkan menambahkan log/audit trail (mis. koleksi `deleted_orders_log`)
  kalau ke depannya butuh jejak siapa & kapan suatu transaksi dihapus, karena
  saat ini penghapusan bersifat permanen tanpa riwayat.
