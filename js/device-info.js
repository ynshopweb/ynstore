// ============================================================
// DEVICE INFO MODULE
// ============================================================
// Parser ringan (tanpa library eksternal) untuk mendeteksi
// Browser / Sistem Operasi / Device dari navigator.userAgent, plus
// pencarian alamat IP publik (best-effort, tidak memblokir login jika
// gagal/offline — sesuai instruksi "IP (jika tersedia)").
// Dipakai oleh js/login-logs.js saat mencatat Login History.
// ============================================================

export function getBrowserName() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'Microsoft Edge';
    if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Google Chrome';
    if (/Firefox\//.test(ua)) return 'Mozilla Firefox';
    if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
    return 'Browser Tidak Dikenal';
}

export function getOSName() {
    const ua = navigator.userAgent;
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows NT/.test(ua)) return 'Windows';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Sistem Operasi Tidak Dikenal';
}

export function getDeviceType() {
    const ua = navigator.userAgent;
    if (/iPad|Tablet/.test(ua)) return 'Tablet';
    if (/Mobile|Android|iPhone/.test(ua)) return 'Mobile';
    return 'Desktop';
}

export function getDeviceInfo() {
    return {
        browser: getBrowserName(),
        os: getOSName(),
        device: getDeviceType()
    };
}

// Best-effort — dipanggil dengan timeout pendek supaya tidak
// memperlambat proses login jika layanan IP lambat/tidak tersedia
// (mis. jaringan admin memblokir domain eksternal).
export async function getPublicIp() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const data = await res.json();
        return data.ip || null;
    } catch (_) {
        return null; // Offline / diblokir jaringan -> field IP cukup dikosongkan
    }
}
