/**
 * Memeriksa status login saat user menekan tombol 'Lanjut ke Checkout' di Keranjang
 * @returns {boolean} true jika boleh lanjut ke checkout, false jika tercegat
 */
export function checkAuthForCheckout() {
    // 1. Cek apakah keranjang kosong
    if (!state.cart || state.cart.length === 0) {
        if (typeof window.showToast === 'function') {
            window.showToast('Keranjang belanja Anda masih kosong!', 'error');
        } else {
            alert('Keranjang belanja Anda masih kosong!');
        }
        return false;
    }

    // 2. Cek apakah user belum login
    if (!state.user) {
        // Tampilkan pesan peringatan/toast
        if (typeof window.showToast === 'function') {
            window.showToast('Silakan login atau daftar akun terlebih dahulu untuk melakukan checkout!', 'warning');
        } else {
            alert('Silakan login atau daftar akun terlebih dahulu untuk melakukan checkout!');
        }

        // Buka modal login/registrasi
        if (typeof window.showLoginRequiredModal === 'function') {
            window.showLoginRequiredModal();
        } else if (typeof window.openAuthModal === 'function') {
            window.openAuthModal('login');
        }

        return false; // Cegat perpindahan halaman
    }

    // 3. Jika sudah login dan keranjang ada isinya
    return true; 
}

// Pastikan fungsi ini di-expose ke window
window.checkAuthForCheckout = checkAuthForCheckout;