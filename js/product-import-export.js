// ============================================================
// PRODUCT IMPORT & EXPORT MODULE (Excel)
// ============================================================
// Modul BARU yang menjadi pengembangan dari sistem produk yang
// sudah ada (state produk di state.js, render tabel & CRUD di
// admin.js, data live di products.js). Modul ini TIDAK mengubah
// fungsi CRUD produk manual yang sudah ada — hanya menambah cara
// baru untuk membuat/memperbarui produk secara massal lewat Excel,
// memakai fungsi Firestore (setDoc/updateDoc) yang sama dengan
// admin.js supaya hasilnya konsisten dan langsung tersinkron oleh
// snapshot real-time di products.js.
//
// Library Excel: SheetJS (window.XLSX), dimuat via CDN di index.html
// (lihat <script src=".../xlsx.full.min.js">), sama seperti Chart.js
// yang sudah lebih dulu dipakai di project ini.
//
// Alur:
//  1. Admin unduh template / export data -> downloadProductTemplate() / exportProductsToExcel()
//  2. Admin pilih mode (Tambah / Update / Tambah+Update) & upload file
//  3. File diparsing + divalidasi baris-per-baris -> preview & ringkasan validasi
//  4. Admin klik "Mulai Import" -> proses upload bertahap dengan progress bar real-time
//  5. Ringkasan hasil (berhasil ditambah/diupdate/dilewati/gagal) ditampilkan
// ============================================================
import { doc, setDoc, updateDoc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from './config.js';
import { state } from './state.js';

// --- DEFINISI KOLOM TEMPLATE ---
// Urutan & label kolom ini dipakai konsisten di: template unduhan,
// hasil export, dan proses pembacaan file saat import.
const FIELD_DEFS = [
    { key: 'id', header: 'ID (kosongkan jika produk baru)' },
    { key: 'name', header: 'Nama Produk' },
    { key: 'brand', header: 'Brand' },
    { key: 'category', header: 'Kategori' },
    { key: 'price', header: 'Harga Jual' },
    { key: 'originalPrice', header: 'Harga Coret' },
    { key: 'stock', header: 'Stok' },
    { key: 'image', header: 'URL Gambar' },
    { key: 'description', header: 'Deskripsi' },
    { key: 'rating', header: 'Rating (0-5)' },
    { key: 'isBestseller', header: 'Bestseller (YA/TIDAK)' },
    { key: 'isNew', header: 'Produk Baru (YA/TIDAK)' },
    { key: 'promoActive', header: 'Promo Aktif (YA/TIDAK)' },
    { key: 'promoType', header: 'Jenis Promo (percentage/nominal)' },
    { key: 'promoValue', header: 'Nilai Diskon Promo' },
    { key: 'promoStart', header: 'Promo Mulai (YYYY-MM-DDTHH:mm)' },
    { key: 'promoEnd', header: 'Promo Berakhir (YYYY-MM-DDTHH:mm)' },
];

const TEMPLATE_EXAMPLE_ROWS = [
    ['', 'Skintific 5X Ceramide Barrier Moisturizer', 'Skintific', 'Moisturizer', 139000, 169000, 25, 'https://contoh.com/gambar1.jpg', 'Moisturizer dengan Ceramide & Hyaluronic Acid.', 4.9, 'YA', 'TIDAK', 'YA', 'percentage', 20, '2026-01-01T00:00', '2026-12-31T23:59'],
    ['', 'Wardah UV Shield Sunscreen SPF50', 'Wardah', 'Sunscreen', 38000, 45000, 40, 'https://contoh.com/gambar2.jpg', 'Sunscreen ringan dengan SPF50.', 4.8, 'TIDAK', 'TIDAK', 'TIDAK', '', '', '', ''],
];

const INSTRUCTION_ROWS = [
    ['PETUNJUK PENGISIAN TEMPLATE IMPORT PRODUK — YN SHOP'],
    [''],
    ['1. Jangan mengubah urutan atau nama kolom pada sheet "Produk".'],
    ['2. Kolom "ID" hanya diisi jika ingin MEMPERBARUI (update) produk yang sudah ada. Kosongkan untuk produk baru.'],
    ['3. Kolom wajib diisi: Nama Produk, Brand, Kategori, Harga Jual, Stok, URL Gambar.'],
    ['4. Kolom Bestseller / Produk Baru / Promo Aktif diisi dengan kata "YA" atau "TIDAK".'],
    ['5. Jika Promo Aktif diisi YA, kolom Jenis Promo, Nilai Diskon, Promo Mulai, dan Promo Berakhir wajib diisi juga.'],
    ['6. Format tanggal promo: YYYY-MM-DDTHH:mm — contoh: 2026-01-01T00:00'],
    ['7. Jenis Promo hanya boleh diisi "percentage" (persen) atau "nominal" (potongan Rp).'],
    ['8. Simpan file dalam format .xlsx sebelum diunggah kembali ke halaman Import Produk.'],
    ['9. Saat memilih mode "Tambah Saja", kolom ID pada file akan diabaikan (semua baris dianggap produk baru).'],
    ['10. Saat memilih mode "Update Saja", setiap baris WAJIB memiliki ID produk yang valid & sudah ada di sistem.'],
    ['11. Saat memilih mode "Tambah + Update", baris tanpa ID akan ditambah sebagai produk baru, baris dengan ID yang cocok akan diperbarui.'],
];

// ================= STATE LOKAL MODUL =================
let lastRawRows = [];      // hasil parsing mentah dari file (belum divalidasi)
let parsedRows = [];       // hasil parsing + validasi sesuai mode aktif
let currentImportMode = 'add';

// ================= HELPER UMUM =================
function normalizeBool(val) {
    if (typeof val === 'boolean') return val;
    const s = String(val ?? '').trim().toLowerCase();
    return ['ya', 'yes', 'true', '1', 'benar'].includes(s);
}

function toNumberOrNull(val) {
    if (val === '' || val === undefined || val === null) return null;
    const n = Number(val);
    return isNaN(n) ? null : n;
}

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase();
}

function getXLSX() {
    if (typeof window.XLSX === 'undefined') {
        window.showToast('Library Excel belum termuat. Cek koneksi internet lalu muat ulang halaman.', 'error');
        return null;
    }
    return window.XLSX;
}

// ================= EXPORT: UNDUH TEMPLATE KOSONG =================
window.downloadProductTemplate = function() {
    const XLSX = getXLSX();
    if (!XLSX) return;

    const headers = FIELD_DEFS.map(f => f.header);
    const wsProduk = XLSX.utils.aoa_to_sheet([headers, ...TEMPLATE_EXAMPLE_ROWS]);
    wsProduk['!cols'] = headers.map(() => ({ wch: 24 }));

    const wsPetunjuk = XLSX.utils.aoa_to_sheet(INSTRUCTION_ROWS);
    wsPetunjuk['!cols'] = [{ wch: 95 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsProduk, 'Produk');
    XLSX.utils.book_append_sheet(wb, wsPetunjuk, 'Petunjuk');

    XLSX.writeFile(wb, 'Template_Import_Produk_YNStore.xlsx');
};

// ================= EXPORT: SEMUA DATA PRODUK SAAT INI =================
window.exportProductsToExcel = function() {
    const XLSX = getXLSX();
    if (!XLSX) return;

    if (!state.products || state.products.length === 0) {
        window.showToast('Belum ada produk untuk diexport.', 'error');
        return;
    }

    const headers = FIELD_DEFS.map(f => f.header);
    const rows = state.products.map(p => {
        const promo = p.promo || {};
        return [
            p.id,
            p.name || '',
            p.brand || '',
            p.category || '',
            p.price ?? 0,
            p.originalPrice ?? '',
            (typeof p.stock === 'number') ? p.stock : '',
            p.image || '',
            p.description || '',
            p.rating ?? '',
            p.isBestseller ? 'YA' : 'TIDAK',
            p.isNew ? 'YA' : 'TIDAK',
            promo.active ? 'YA' : 'TIDAK',
            promo.type || '',
            promo.value ?? '',
            promo.startDate || '',
            promo.endDate || ''
        ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 24 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produk');

    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Export_Produk_YNStore_${timestamp}.xlsx`);
    window.showToast(`Berhasil export ${state.products.length} produk ke Excel.`, 'success');
};

// ================= IMPORT: BACA FILE =================
function parseSheetRows(sheet, XLSX) {
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (raw.length === 0) return [];

    const headerRow = raw[0].map(normalizeHeader);
    const colIndex = {};
    FIELD_DEFS.forEach(f => {
        colIndex[f.key] = headerRow.indexOf(normalizeHeader(f.header));
    });

    return raw.slice(1)
        .filter(r => r.some(cell => String(cell).trim() !== ''))
        .map((r, i) => {
            const get = (key) => {
                const idx = colIndex[key];
                return (idx >= 0 && idx < r.length) ? r[idx] : '';
            };
            return {
                rowNumber: i + 2, // baris 1 = header, data Excel mulai baris ke-2
                id: String(get('id') || '').trim(),
                name: String(get('name') || '').trim(),
                brand: String(get('brand') || '').trim(),
                category: String(get('category') || '').trim(),
                price: toNumberOrNull(get('price')),
                originalPrice: toNumberOrNull(get('originalPrice')),
                stock: toNumberOrNull(get('stock')),
                image: String(get('image') || '').trim(),
                description: String(get('description') || '').trim(),
                rating: toNumberOrNull(get('rating')),
                isBestseller: normalizeBool(get('isBestseller')),
                isNew: normalizeBool(get('isNew')),
                promoActive: normalizeBool(get('promoActive')),
                promoType: String(get('promoType') || '').trim().toLowerCase(),
                promoValue: toNumberOrNull(get('promoValue')),
                promoStart: String(get('promoStart') || '').trim(),
                promoEnd: String(get('promoEnd') || '').trim(),
            };
        });
}

// --- VALIDASI 1 BARIS sesuai mode import yang sedang aktif ---
function validateRow(row, mode, seenIdsInFile) {
    const errors = [];

    if (!row.name) errors.push('Nama produk wajib diisi');
    if (!row.brand) errors.push('Brand wajib diisi');
    if (!row.category) errors.push('Kategori wajib diisi');
    if (row.price === null || row.price < 0) errors.push('Harga jual tidak valid');
    if (row.stock === null || row.stock < 0) errors.push('Stok tidak valid');
    if (!row.image) errors.push('URL gambar wajib diisi');

    if (row.promoActive) {
        if (!['percentage', 'nominal'].includes(row.promoType)) errors.push('Jenis promo harus "percentage" atau "nominal"');
        if (row.promoValue === null || row.promoValue <= 0) errors.push('Nilai diskon promo tidak valid');
        if (!row.promoStart || !row.promoEnd) errors.push('Tanggal mulai/berakhir promo wajib diisi');
        if (row.promoStart && row.promoEnd && new Date(row.promoEnd).getTime() <= new Date(row.promoStart).getTime()) {
            errors.push('Tanggal berakhir promo harus setelah tanggal mulai');
        }
        if (row.promoType === 'percentage' && row.promoValue !== null && (row.promoValue <= 0 || row.promoValue > 100)) {
            errors.push('Nilai diskon persentase harus di antara 1-100');
        }
    }

    // --- TENTUKAN AKSI (tambah / update) berdasarkan mode & kolom ID ---
    let action = 'add';
    let matchedProduct = null;

    if (mode === 'update' || mode === 'add_update') {
        if (row.id) {
            matchedProduct = state.products.find(p => p.id === row.id) || null;
            if (matchedProduct) {
                action = 'update';
            } else if (mode === 'update') {
                errors.push(`ID "${row.id}" tidak ditemukan pada produk yang ada`);
            } else {
                errors.push(`ID "${row.id}" tidak ditemukan — kosongkan kolom ID untuk menambah produk baru`);
            }
            if (seenIdsInFile.has(row.id)) errors.push('ID duplikat di dalam file');
            else seenIdsInFile.add(row.id);
        } else if (mode === 'update') {
            errors.push('Kolom ID wajib diisi pada mode "Update Saja"');
        }
    }
    // mode 'add': kolom ID pada file selalu diabaikan, aksi selalu 'add'

    return { ...row, errors, isValid: errors.length === 0, action, matchedProduct };
}

function runValidationAndRenderPreview() {
    const seenIds = new Set();
    parsedRows = lastRawRows.map(r => validateRow(r, currentImportMode, seenIds));
    renderImportPreview();
}

// --- DIPANGGIL DARI HTML saat radio mode import diganti ---
window.onImportModeChange = function() {
    currentImportMode = document.querySelector('input[name="import-mode"]:checked')?.value || 'add';
    if (lastRawRows.length > 0) runValidationAndRenderPreview();
};

// --- DIPANGGIL DARI HTML saat admin memilih file Excel ---
window.handleImportFileSelect = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const XLSX = getXLSX();
    if (!XLSX) return;

    try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheetName = wb.SheetNames.find(n => n.toLowerCase() === 'produk') || wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rawRows = parseSheetRows(sheet, XLSX);

        if (rawRows.length === 0) {
            window.showToast('File Excel tidak berisi data produk yang bisa dibaca.', 'error');
            lastRawRows = [];
            parsedRows = [];
            hideImportResultSections();
            return;
        }

        lastRawRows = rawRows;
        currentImportMode = document.querySelector('input[name="import-mode"]:checked')?.value || 'add';
        runValidationAndRenderPreview();
        window.showToast(`Berhasil membaca ${rawRows.length} baris dari file.`, 'success');
    } catch (err) {
        console.error(err);
        window.showToast('Gagal membaca file Excel: ' + err.message, 'error');
        lastRawRows = [];
        parsedRows = [];
        hideImportResultSections();
    }
};

// ================= RENDER: PREVIEW & VALIDASI =================
function renderImportPreview() {
    const section = document.getElementById('import-preview-section');
    if (!section) return;
    section.classList.remove('hidden');
    document.getElementById('import-progress-section').classList.add('hidden');
    document.getElementById('import-result-section').classList.add('hidden');

    const total = parsedRows.length;
    const validRows = parsedRows.filter(r => r.isValid);
    const errorRows = parsedRows.filter(r => !r.isValid);
    const updateRows = validRows.filter(r => r.action === 'update');

    document.getElementById('import-stat-total').textContent = total;
    document.getElementById('import-stat-valid').textContent = validRows.length;
    document.getElementById('import-stat-error').textContent = errorRows.length;
    document.getElementById('import-stat-update').textContent = updateRows.length;

    const PREVIEW_LIMIT = 200;
    const tbody = document.getElementById('import-preview-tbody');
    if (tbody) {
        tbody.innerHTML = parsedRows.slice(0, PREVIEW_LIMIT).map(r => {
            let statusBadge;
            if (!r.isValid) {
                statusBadge = '<span class="text-rose-600 font-bold"><i class="fa-solid fa-triangle-exclamation"></i> Error</span>';
            } else if (r.action === 'update') {
                statusBadge = '<span class="text-blue-600 font-bold"><i class="fa-solid fa-rotate"></i> Update</span>';
            } else {
                statusBadge = '<span class="text-emerald-600 font-bold"><i class="fa-solid fa-plus"></i> Tambah</span>';
            }
            return `
                <tr class="border-t border-slate-100 ${r.isValid ? '' : 'bg-rose-50/60'}">
                    <td class="p-2 text-slate-400">${r.rowNumber}</td>
                    <td class="p-2 whitespace-nowrap">${statusBadge}</td>
                    <td class="p-2 text-slate-700 max-w-[160px] truncate" title="${r.name}">${r.name || '-'}</td>
                    <td class="p-2 text-slate-500 whitespace-nowrap">${r.brand || '-'}</td>
                    <td class="p-2 text-slate-500 whitespace-nowrap">${r.price !== null ? 'Rp ' + r.price.toLocaleString('id-ID') : '-'}</td>
                    <td class="p-2 text-slate-500">${r.stock !== null ? r.stock : '-'}</td>
                    <td class="p-2 text-rose-500">${r.errors.join('; ')}</td>
                </tr>
            `;
        }).join('');
    }

    const noteEl = document.getElementById('import-preview-note');
    if (noteEl) {
        noteEl.textContent = total > PREVIEW_LIMIT
            ? `Menampilkan ${PREVIEW_LIMIT} dari ${total} baris pada preview. Seluruh ${validRows.length} baris valid tetap akan diproses saat import dijalankan.`
            : `Menampilkan seluruh ${total} baris.`;
    }

    const startBtn = document.getElementById('import-start-btn');
    if (startBtn) startBtn.disabled = validRows.length === 0;
}

function hideImportResultSections() {
    ['import-preview-section', 'import-progress-section', 'import-result-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

// ================= PROSES IMPORT (dengan progress real-time) =================
window.startProductImport = async function() {
    const validRows = parsedRows.filter(r => r.isValid);
    if (validRows.length === 0) return;

    document.getElementById('import-preview-section').classList.add('hidden');
    const progressSection = document.getElementById('import-progress-section');
    const resultSection = document.getElementById('import-result-section');
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');

    const total = validRows.length;
    let completed = 0;
    const result = { added: 0, updated: 0, failed: 0, errors: [] };

    updateImportProgressUI(completed, total);

    // Proses paralel terbatas (worker pool) supaya ribuan produk tetap
    // responsif dan progress bar bergerak real-time per produk selesai,
    // tanpa membanjiri Firestore dengan ribuan request bersamaan.
    const CONCURRENCY = 8;
    let cursor = 0;

    async function worker() {
        while (cursor < validRows.length) {
            const row = validRows[cursor++];
            try {
                await persistImportedRow(row);
                if (row.action === 'update') result.updated++; else result.added++;
            } catch (err) {
                result.failed++;
                result.errors.push(`Baris ${row.rowNumber} (${row.name || '-'}): ${err.message}`);
            }
            completed++;
            updateImportProgressUI(completed, total);
        }
    }

    const workerCount = Math.min(CONCURRENCY, validRows.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    const skipped = parsedRows.length - validRows.length;
    renderImportResult(result, skipped);
};

function updateImportProgressUI(completed, total) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const bar = document.getElementById('import-progress-bar');
    const label = document.getElementById('import-progress-label');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = `${completed} / ${total}`;
}

async function persistImportedRow(row) {
    const promo = row.promoActive
        ? { active: true, type: row.promoType, value: row.promoValue, startDate: row.promoStart, endDate: row.promoEnd }
        : { active: false, type: 'percentage', value: 0, startDate: '', endDate: '' };

    const productData = {
        name: row.name,
        brand: row.brand,
        category: row.category,
        price: row.price,
        originalPrice: row.originalPrice ?? null,
        image: row.image,
        description: row.description || '',
        stock: row.stock,
        promo,
        rating: row.rating ?? 5,
        // Pertahankan jumlah terjual (sales) produk lama saat diupdate,
        // supaya statistik bestseller tidak ikut ter-reset oleh import.
        sales: (row.action === 'update' && row.matchedProduct) ? (row.matchedProduct.sales || 0) : 0,
        isBestseller: row.isBestseller,
        isNew: row.isNew
    };

    if (row.action === 'update' && row.matchedProduct) {
        await updateDoc(doc(db, 'artifacts', appId, 'products', row.matchedProduct.id), productData);
    } else {
        const newRef = doc(collection(db, 'artifacts', appId, 'products'));
        await setDoc(newRef, productData);
    }
}

// ================= RINGKASAN HASIL IMPORT =================
function renderImportResult(result, skipped) {
    document.getElementById('import-progress-section').classList.add('hidden');
    const resultSection = document.getElementById('import-result-section');
    resultSection.classList.remove('hidden');

    document.getElementById('import-result-added').textContent = result.added;
    document.getElementById('import-result-updated').textContent = result.updated;
    document.getElementById('import-result-skipped').textContent = skipped;
    document.getElementById('import-result-failed').textContent = result.failed;

    const errBox = document.getElementById('import-result-errors');
    if (errBox) {
        if (result.errors.length > 0) {
            errBox.classList.remove('hidden');
            errBox.innerHTML = result.errors.map(e => `<p>• ${e}</p>`).join('');
        } else {
            errBox.classList.add('hidden');
            errBox.innerHTML = '';
        }
    }

    const totalProcessed = result.added + result.updated;
    window.showToast(
        `Import selesai: ${totalProcessed} berhasil, ${result.failed} gagal, ${skipped} dilewati.`,
        result.failed > 0 ? 'error' : 'success'
    );
}

// ================= BUKA / TUTUP / RESET MODAL =================
window.openImportExportModal = function() {
    window.resetImportExportModal();
    const modal = document.getElementById('import-export-modal');
    if (modal) modal.classList.remove('hidden');
};

window.closeImportExportModal = function() {
    const modal = document.getElementById('import-export-modal');
    if (modal) modal.classList.add('hidden');
};

window.resetImportExportModal = function() {
    lastRawRows = [];
    parsedRows = [];
    currentImportMode = 'add';

    const modeAdd = document.querySelector('input[name="import-mode"][value="add"]');
    if (modeAdd) modeAdd.checked = true;

    const fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.value = '';

    hideImportResultSections();
};
