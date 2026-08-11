/* =========================
   GLOBAL VARIABEL & FETCH INTERCEPTOR
========================= */
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    
    const token = localStorage.getItem('token');
    if (token && typeof resource === 'string' && resource.startsWith('/')) {
        if (!config) config = {};
        if (!config.headers) {
            config.headers = { 'Authorization': 'Bearer ' + token };
        } else if (config.headers instanceof Headers) {
            config.headers.append('Authorization', 'Bearer ' + token);
        } else {
            config.headers['Authorization'] = 'Bearer ' + token;
        }
    }
    
    const response = await originalFetch(resource, config);
    if (response.status === 401 || response.status === 403) {
        if (window.location.pathname !== '/index.html' && window.location.pathname !== '/') {
            alert("Sesi anda telah berakhir atau akses ditolak. Silakan login kembali.");
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = '/index.html';
        }
    }
    return response;
};

let currentPage = 1;
const rowsPerPage = 10;

// Menyimpan instance chart agar bisa di-reset saat data diperbarui
let salesChartInstance = null;
let profitChartInstance = null;

/* =========================
   SETTING HARGA (Default fallback)
========================= */
let settingHarga = {
    modalWarung: 16000, jualWarung: 18000,
    modalEcer: 16000, jualEcer: 19000,
    modalAquaWarung: 14000, jualAquaWarung: 16000,
    modalAquaEcer: 15000, jualAquaEcer: 18000
};

// Fungsi helper format Rupiah
const formatRupiah = (number) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(number || 0);
};

let cachedLogs = []; // Cache data log aktivitas untuk filtering client-side

/* =========================
   TOAST NOTIFICATION SYSTEM
========================= */
function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        alert(message); // Fallback jika toast container tidak ada
        return;
    }

    const icons = {
        success: 'ri-check-line',
        error: 'ri-error-warning-line',
        info: 'ri-information-line',
        warning: 'ri-alert-line'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${icons[type] || icons.info}"></i> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/* =========================
   INIT ON LOAD (SINKRON)
========================= */
document.addEventListener("DOMContentLoaded", async () => {
    jalankanProteksiAkses();
    initFilterDates(); // 🔥 Tambahan: Set default tanggal filter hari ini agar download PDF langsung siap
    // 🔥 Ambil setting harga dulu sampai selesai, baru muat data stok biar profit gak ngaco!
    await loadSettingHarga();
    loadData();
    initPushNotifications();
});

/* =========================
   PUSH NOTIFICATION SYSTEM
========================= */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
        const registration = await navigator.serviceWorker.ready;
        const existingSubscription = await registration.pushManager.getSubscription();
        
        if (existingSubscription) {
            // Sudah subscribe, kirim lagi untuk memastikan backend punya data terbaru
            await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(existingSubscription)
            });
            return;
        }

        // Jika belum subscribe, minta izin
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Push notification permission denied.');
            return;
        }

        // Ambil VAPID key dari server
        const response = await fetch('/api/vapidPublicKey');
        const vapidPublicKey = await response.text();
        if (!vapidPublicKey) return;

        const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
        
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedVapidKey
        });

        await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });
        console.log('Successfully subscribed to push notifications!');
    } catch (error) {
        console.error('Failed to subscribe the user: ', error);
    }
}

/* =========================
   FUNGSI SET DEFAULT TANGGAL (BARU)
========================= */
function initFilterDates() {
    const today = new Date().toISOString().split('T')[0];
    
    // Set auto tanggal di form input stock jika ada
    if (document.getElementById("tanggal") && !document.getElementById("tanggal").value) {
        document.getElementById("tanggal").value = today;
    }
    // Set auto tanggal di filter laporan jika ada
    if (document.getElementById("startDate") && !document.getElementById("startDate").value) {
        document.getElementById("startDate").value = today;
    }
    if (document.getElementById("endDate") && !document.getElementById("endDate").value) {
        document.getElementById("endDate").value = today;
    }
}

/* =========================
   FUNGSI AMBIL HARGA DARI SERVER
========================= */
async function loadSettingHarga() {
    try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/setting-harga", {
            headers: {
                "Authorization": "Bearer " + token
            }
        });
        if (res.ok) {
            const data = await res.json();
            // Update variabel global dengan data asli dari database
            settingHarga = {
                modalWarung: Number(data.modalWarung) || 16000,
                jualWarung: Number(data.jualWarung) || 18000,
                modalEcer: Number(data.modalEcer) || 16000,
                jualEcer: Number(data.jualEcer) || 19000,
                modalAquaWarung: Number(data.modalAquaWarung) || 14000,
                jualAquaWarung: Number(data.jualAquaWarung) || 16000,
                modalAquaEcer: Number(data.modalAquaEcer) || 15000,
                jualAquaEcer: Number(data.jualAquaEcer) || 18000
            };
            
            // Masukkan ke elemen input jika halaman setting terbuka
            if (document.getElementById("modalWarung")) document.getElementById("modalWarung").value = settingHarga.modalWarung;
            if (document.getElementById("jualWarung")) document.getElementById("jualWarung").value = settingHarga.jualWarung;
            if (document.getElementById("modalEcer")) document.getElementById("modalEcer").value = settingHarga.modalEcer;
            if (document.getElementById("jualEcer")) document.getElementById("jualEcer").value = settingHarga.jualEcer;
            if (document.getElementById("modalAquaWarung")) document.getElementById("modalAquaWarung").value = settingHarga.modalAquaWarung;
            if (document.getElementById("jualAquaWarung")) document.getElementById("jualAquaWarung").value = settingHarga.jualAquaWarung;
            if (document.getElementById("modalAquaEcer")) document.getElementById("modalAquaEcer").value = settingHarga.modalAquaEcer;
            if (document.getElementById("jualAquaEcer")) document.getElementById("jualAquaEcer").value = settingHarga.jualAquaEcer;
            
            // Update POS Prices
            if (document.getElementById("posHarga-LPGWarung")) document.getElementById("posHarga-LPGWarung").textContent = formatRupiah(settingHarga.jualWarung);
            if (document.getElementById("posHarga-LPGEcer")) document.getElementById("posHarga-LPGEcer").textContent = formatRupiah(settingHarga.jualEcer);
            if (document.getElementById("posHarga-AquaWarung")) document.getElementById("posHarga-AquaWarung").textContent = formatRupiah(settingHarga.jualAquaWarung);
            if (document.getElementById("posHarga-AquaEcer")) document.getElementById("posHarga-AquaEcer").textContent = formatRupiah(settingHarga.jualAquaEcer);
        }
    } catch (err) {
        console.error("Gagal mengambil data setting harga dari server:", err);
    }
}

/* =========================
   MENU PAGE (ANTI BOCOR)
========================= */
function showPage(pageId){
    const role = localStorage.getItem("role") || "user";

    // 🛑 BARIKADE UTAMA
    if (role === "user" && pageId !== "dashboardPage" && pageId !== "inputPage") {
        alert("Waduh, lu ga punya akses ke halaman ini! ⛔");
        showPage("dashboardPage"); 
        return;
    }

    const pages = ["dashboardPage", "inputPage", "settingPage", "logsPage", "posPage", "expensePage"];
    pages.forEach(page => {
        const el = document.getElementById(page);
        if (el) {
            el.style.display = "none";
            el.classList.remove("active");
        }
    });

    const targetPage = document.getElementById(pageId);
    if(targetPage) {
        targetPage.style.display = "block";
        targetPage.classList.add("active");
    }

    const menus = document.querySelectorAll(".menu-item");
    menus.forEach(menu => {
        menu.classList.remove("active");
        const onClickAttr = menu.getAttribute("onclick") || "";
        if (onClickAttr.includes(`showPage('${pageId}')`) || onClickAttr.includes(`showPage("${pageId}")`)) {
            menu.classList.add("active");
        }
    });

    if(pageId === "settingPage"){
        loadRegisteredUsers();
        loadSettingHarga(); 
        const themeSelect = document.getElementById('configThemeSelect');
        const fontSelect = document.getElementById('configFontSelect');
        if (themeSelect) themeSelect.value = localStorage.getItem('app_theme') || 'light';
        if (fontSelect) fontSelect.value = localStorage.getItem('app_font') || 'Inter';
    }

    if(pageId === "logsPage"){
        loadLogs();
    }
    
    if(pageId === "dashboardPage"){
        loadData();
    }

    if(pageId === "inputPage"){
        initFilterDates(); // Pastikan tanggal terisi saat pindah ke halaman input
    }
    
    if(pageId === "expensePage"){
        initFilterDates();
        if (document.getElementById("expenseTanggal")) {
            document.getElementById("expenseTanggal").value = new Date().toISOString().split('T')[0];
        }
        loadExpenses();
    }
    
    // Auto-close sidebar after clicking a menu item (all screen sizes)
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("mobileOverlay");
    if (sidebar && overlay) {
        sidebar.classList.remove("show-sidebar");
        overlay.classList.remove("show-overlay");
    }
}

/* =========================
   MOBILE MENU TOGGLE
========================= */
function toggleMobileMenu() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("mobileOverlay");
    
    if (sidebar && overlay) {
        sidebar.classList.toggle("show-sidebar");
        overlay.classList.toggle("show-overlay");
    }
}

/* =========================
   SIMPAN DATA STOCK
========================= */
async function simpan(){
    const tanggal = document.getElementById("tanggal").value;
    const kategori = document.getElementById("kategori").value;
    const masuk = parseInt(document.getElementById("masuk").value) || 0;
    const keluar = parseInt(document.getElementById("keluar").value) || 0;
    const namaPenginput = localStorage.getItem("username") || "admin";

    if (!tanggal) {
        showToast("Pilih tanggal dulu bro! 📅", "warning");
        return;
    }

    if (masuk < 0 || keluar < 0) {
        showToast("Jumlah masuk/keluar tidak boleh negatif! ❌", "warning");
        return;
    }

    if (masuk === 0 && keluar === 0) {
        showToast("Masukkan jumlah masuk atau keluar dulu bro! ❌", "warning");
        return;
    }

    try {
        const res = await fetch("/add",{
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tanggal, kategori, masuk, keluar, username: namaPenginput })
        });

        if (res.ok) {
            showToast("Data Stock berhasil disimpan! 📝", "success");
            document.getElementById("masuk").value = "";
            document.getElementById("keluar").value = "";
            initFilterDates(); // Reset tanggal ke hari ini
            loadData();
        } else {
            showToast("Gagal menyimpan data ke server.", "error");
        }
    } catch (err) {
        console.error("Gagal menyimpan stok:", err);
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

/* =========================
   CRUD PENGELUARAN (EXPENSES)
========================= */
async function loadExpenses() {
    try {
        const res = await fetch("/api/expenses");
        if (res.ok) {
            const data = await res.json();
            const tbody = document.getElementById("expenseTableBody");
            if (!tbody) return;
            
            let html = "";
            if (data.length === 0) {
                html = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">Belum ada pengeluaran tercatat.</td></tr>';
            } else {
                data.forEach(item => {
                    html += `
                        <tr>
                            <td>${item.tanggal}</td>
                            <td><span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2);">${item.kategori}</span></td>
                            <td>${item.keterangan || '-'}</td>
                            <td style="color: #ef4444; font-weight: bold;">Rp ${item.jumlah.toLocaleString('id-ID')}</td>
                            <td><span class="badge-user">${item.oleh || 'admin'}</span></td>
                            <td>
                                <button class="delete-btn" onclick="hapusExpense(${item.id})" style="background: #ef4444; border:none; color:#fff; padding:4px 8px; border-radius:4px; cursor:pointer;" title="Hapus">
                                    <i class="ri-delete-bin-line"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
            }
            tbody.innerHTML = html;
        }
    } catch (err) {
        console.error("Gagal load expenses:", err);
    }
}

async function simpanExpense() {
    const tanggal = document.getElementById("expenseTanggal").value;
    const kategori = document.getElementById("expenseKategori").value;
    const jumlah = parseInt(document.getElementById("expenseJumlah").value) || 0;
    const keterangan = document.getElementById("expenseKeterangan").value;

    if (!tanggal || !kategori || jumlah <= 0) {
        showToast("Data pengeluaran tidak lengkap atau jumlah 0! ❌", "warning");
        return;
    }

    try {
        const res = await fetch("/api/expenses/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tanggal, kategori, jumlah, keterangan })
        });

        if (res.ok) {
            showToast("Pengeluaran berhasil dicatat! 💸", "success");
            document.getElementById("expenseJumlah").value = "";
            document.getElementById("expenseKeterangan").value = "";
            loadExpenses();
            if (document.getElementById("dashboardPage").style.display === "block") {
                loadData();
            }
        } else {
            showToast("Gagal menyimpan pengeluaran.", "error");
        }
    } catch (err) {
        showToast("Terjadi kesalahan jaringan.", "error");
    }
}

async function hapusExpense(id) {
    if (confirm("Yakin ingin menghapus data pengeluaran ini? 🗑️")) {
        try {
            const res = await fetch(`/api/expenses/delete/${id}`, { method: "POST" });
            if (res.ok) {
                showToast("Pengeluaran berhasil dihapus! 🗑️", "success");
                loadExpenses();
            } else {
                showToast("Gagal hapus pengeluaran", "error");
            }
        } catch (err) {
            showToast("Error koneksi saat menghapus data.", "error");
        }
    }
}

/* =========================
   LOAD DATA UTAMA & DASHBOARD
========================= */
function muatDataDanGrafik() {
    loadData();
}

async function loadData(){
    try {
        const [resData, resExpenses] = await Promise.all([
            fetch("/data"),
            fetch("/api/expenses")
        ]);
        
        loadHutangs(); // Refresh hutang data silently

        let allData = await resData.json();
        let allExpenses = [];
        if (resExpenses.ok) {
            allExpenses = await resExpenses.json();
        }

        // 1. Dapatkan Nilai Filter
        const filterSelect = document.getElementById("dashboardTimeFilter");
        const filterValue = filterSelect ? filterSelect.value : "all";
        
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // 2. Filter Data Stock
        let data = allData.filter(item => {
            if (filterValue === "all") return true;
            const itemDate = new Date(item.tanggal);
            const dateOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());
            
            if (filterValue === "today") {
                return dateOnly.getTime() === today.getTime();
            } else if (filterValue === "this_week") {
                const dayOfWeek = today.getDay();
                const startOfWeek = new Date(today);
                startOfWeek.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); 
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                return dateOnly >= startOfWeek && dateOnly <= endOfWeek;
            } else if (filterValue === "this_month") {
                return dateOnly.getMonth() === today.getMonth() && dateOnly.getFullYear() === today.getFullYear();
            }
            return true;
        });

        // 3. Filter Data Pengeluaran
        let filteredExpenses = allExpenses.filter(item => {
            if (filterValue === "all") return true;
            const itemDate = new Date(item.tanggal);
            const dateOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());
            
            if (filterValue === "today") {
                return dateOnly.getTime() === today.getTime();
            } else if (filterValue === "this_week") {
                const dayOfWeek = today.getDay();
                const startOfWeek = new Date(today);
                startOfWeek.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); 
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(startOfWeek.getDate() + 6);
                return dateOnly >= startOfWeek && dateOnly <= endOfWeek;
            } else if (filterValue === "this_month") {
                return dateOnly.getMonth() === today.getMonth() && dateOnly.getFullYear() === today.getFullYear();
            }
            return true;
        });

        // Urutkan data berdasarkan tanggal secara menaik (oldest to newest) 
        // agar perhitungan saldo akumulatif stok di pangkalan gas berjalan akurat
        data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

        let html = "";
        let totalMasukGas = 0; let totalKeluarGas = 0;
        let totalMasukAqua = 0; let totalKeluarAqua = 0;
        let profitGas = 0; let profitAqua = 0;
        let runningGas = 0; let runningAqua = 0;
        
        let totalOmsetGlobal = 0; let totalModalGlobal = 0;

        const chartDataMap = {};
        
        // Rekapitulasi untuk tabel rincian
        const rincian = {
            "LPG Warung": { qty: 0, omset: 0, modal: 0, profit: 0 },
            "LPG Ecer": { qty: 0, omset: 0, modal: 0, profit: 0 },
            "Aqua Warung": { qty: 0, omset: 0, modal: 0, profit: 0 },
            "Aqua Ecer": { qty: 0, omset: 0, modal: 0, profit: 0 }
        };

        data.forEach(item => {
            const masuk = Number(item.masuk) || 0;
            const keluar = Number(item.keluar) || 0;
            
            // Hitung sisa riil berjalan (Saldo Awal + Masuk - Keluar) secara terpisah
            if (item.kategori === "Aqua Warung" || item.kategori === "Aqua Ecer") {
                runningAqua += (masuk - keluar);
                item.sisaBerjalan = runningAqua;
            } else {
                runningGas += (masuk - keluar);
                item.sisaBerjalan = runningGas;
            }

            let itemProfit = 0;
            let itemOmset = 0;
            let itemModal = 0;
            
            // Standarisasi nama kategori untuk rincian
            let rincianKey = item.kategori;
            if (rincianKey === "Warung") rincianKey = "LPG Warung";
            if (rincianKey === "Ecer") rincianKey = "LPG Ecer";

            if (rincianKey === "LPG Warung") {
                itemOmset = keluar * settingHarga.jualWarung;
                itemModal = keluar * settingHarga.modalWarung;
                itemProfit = itemOmset - itemModal;
                profitGas += itemProfit;
            } else if (rincianKey === "LPG Ecer") {
                itemOmset = keluar * settingHarga.jualEcer;
                itemModal = keluar * settingHarga.modalEcer;
                itemProfit = itemOmset - itemModal;
                profitGas += itemProfit;
            } else if (rincianKey === "Aqua Warung") {
                itemOmset = keluar * settingHarga.jualAquaWarung;
                itemModal = keluar * settingHarga.modalAquaWarung;
                itemProfit = itemOmset - itemModal;
                profitAqua += itemProfit;
            } else if (rincianKey === "Aqua Ecer") {
                itemOmset = keluar * settingHarga.jualAquaEcer;
                itemModal = keluar * settingHarga.modalAquaEcer;
                itemProfit = itemOmset - itemModal;
                profitAqua += itemProfit;
            }
            
            totalOmsetGlobal += itemOmset;
            totalModalGlobal += itemModal;
            
            // Tambahkan ke rincian
            if (rincian[rincianKey]) {
                rincian[rincianKey].qty += keluar;
                rincian[rincianKey].omset += itemOmset;
                rincian[rincianKey].modal += itemModal;
                rincian[rincianKey].profit += itemProfit;
            }

            if (!chartDataMap[item.tanggal]) {
                chartDataMap[item.tanggal] = { penjualanGas: 0, penjualanAqua: 0, keuntunganGas: 0, keuntunganAqua: 0 };
            }
            if (item.kategori === "Aqua Warung" || item.kategori === "Aqua Ecer") {
                totalMasukAqua += masuk;
                totalKeluarAqua += keluar;
                chartDataMap[item.tanggal].penjualanAqua += keluar;
                chartDataMap[item.tanggal].keuntunganAqua += itemProfit;
            } else {
                totalMasukGas += masuk;
                totalKeluarGas += keluar;
                chartDataMap[item.tanggal].penjualanGas += keluar;
                chartDataMap[item.tanggal].keuntunganGas += itemProfit;
            }
        });

        /* PAGINATION (Berdasarkan data yang dibalik agar baris terbaru tampil paling atas di tabel) */
        const displayData = [...data].reverse(); 
        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        const paginatedData = displayData.slice(start, end);

        /* RENDER TABLE */
        paginatedData.forEach(item => {
            let labelKategori = item.kategori;
            if (labelKategori === "Warung") labelKategori = "LPG Warung";
            if (labelKategori === "Ecer") labelKategori = "LPG Ecer";

            html += `
                <tr>
                    <td>${item.tanggal}</td>
                    <td><span class="badge ${item.kategori.toLowerCase().replace(/\s+/g, '-')}">${labelKategori}</span></td>
                    <td style="color: #34d399; font-weight: bold;">+${item.masuk}</td>
                    <td style="color: #ef4444; font-weight: bold;">-${item.keluar}</td>
                    <td style="font-weight: bold; color: #cbd5e1;">${item.sisaBerjalan}</td>
                    <td><span class="badge-user">${item.oleh || item.username || 'admin'}</span></td> 
                    <td>
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button onclick="bukaModalEditStock(${item.id}, '${item.tanggal}', '${item.kategori}', ${item.masuk}, ${item.keluar})" style="background: #f59e0b; border:none; color:#fff; padding:4px 8px; border-radius:4px; cursor:pointer;" title="Edit">
                                <i class="ri-edit-2-line"></i>
                            </button>
                            <button class="delete-btn" onclick="hapusData(${item.id})" style="background: #ef4444; border:none; color:#fff; padding:4px 8px; border-radius:4px; cursor:pointer;" title="Hapus">
                                <i class="ri-delete-bin-line"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        const totalStockGas = totalMasukGas - totalKeluarGas;
        const totalStockAqua = totalMasukAqua - totalKeluarAqua;
        
        let totalPengeluaran = 0;
        filteredExpenses.forEach(e => totalPengeluaran += e.jumlah);

        const grossProfit = profitGas + profitAqua;
        const netProfit = grossProfit - totalPengeluaran;

        const dataTableEl = document.getElementById("dataTable");
        if(dataTableEl) dataTableEl.innerHTML = html;

        if(document.getElementById("totalStockGas")) animateValue(document.getElementById("totalStockGas"), 0, totalStockGas, 1200);
        if(document.getElementById("totalStockAqua")) animateValue(document.getElementById("totalStockAqua"), 0, totalStockAqua, 1200);
        if(document.getElementById("profitGas")) animateValue(document.getElementById("profitGas"), 0, profitGas, 1200, "Rp ");
        if(document.getElementById("profitAqua")) animateValue(document.getElementById("profitAqua"), 0, profitAqua, 1200, "Rp ");
        if(document.getElementById("totalPengeluaran")) animateValue(document.getElementById("totalPengeluaran"), 0, totalPengeluaran, 1200, "Rp ");
        if(document.getElementById("totalProfit")) animateValue(document.getElementById("totalProfit"), 0, netProfit, 1200, "Rp ");
        
        if(document.getElementById("totalOmset")) animateValue(document.getElementById("totalOmset"), 0, totalOmsetGlobal, 1200, "Rp ");
        if(document.getElementById("totalModal")) animateValue(document.getElementById("totalModal"), 0, totalModalGlobal, 1200, "Rp ");

        // RENDER TABEL RINCIAN
        const tbodyRincian = document.getElementById("rincianTableBody");
        if (tbodyRincian) {
            let htmlRincian = "";
            let totalQty = 0;
            for (const [kat, dataObj] of Object.entries(rincian)) {
                totalQty += dataObj.qty;
                htmlRincian += `
                    <tr>
                        <td><span class="badge ${kat.toLowerCase().replace(/\s+/g, '-')}">${kat}</span></td>
                        <td style="font-weight: bold;">${dataObj.qty}</td>
                        <td style="color: #6366f1;">Rp ${dataObj.omset.toLocaleString("id-ID")}</td>
                        <td style="color: #f43f5e;">Rp ${dataObj.modal.toLocaleString("id-ID")}</td>
                        <td style="color: #22c55e; font-weight: bold;">Rp ${dataObj.profit.toLocaleString("id-ID")}</td>
                    </tr>
                `;
            }
            tbodyRincian.innerHTML = htmlRincian;
            document.getElementById("rincianTotalQty").innerText = totalQty;
            document.getElementById("rincianTotalOmset").innerText = "Rp " + totalOmsetGlobal.toLocaleString("id-ID");
            document.getElementById("rincianTotalModal").innerText = "Rp " + totalModalGlobal.toLocaleString("id-ID");
            document.getElementById("rincianTotalProfit").innerText = "Rp " + grossProfit.toLocaleString("id-ID");
            if(document.getElementById("rincianTotalPengeluaran")) document.getElementById("rincianTotalPengeluaran").innerText = "- Rp " + totalPengeluaran.toLocaleString("id-ID");
            if(document.getElementById("rincianNetProfit")) document.getElementById("rincianNetProfit").innerText = "Rp " + netProfit.toLocaleString("id-ID");
        }

        renderPagination(data.length);
        
        /* ==========================================
            🔥 PROSES RENDER GRAFIK (KRONOLOGIS DARI LAMA KE BARU)
        ========================================== */
        const sortedDates = Object.keys(chartDataMap).sort();
        const salesGasValues = sortedDates.map(date => chartDataMap[date].penjualanGas);
        const salesAquaValues = sortedDates.map(date => chartDataMap[date].penjualanAqua);
        const profitGasValues = sortedDates.map(date => chartDataMap[date].keuntunganGas);
        const profitAquaValues = sortedDates.map(date => chartDataMap[date].keuntunganAqua);

        const ctxSales = document.getElementById("salesChart");
        const ctxProfit = document.getElementById("profitChart");

        if (ctxSales && ctxProfit) {
            if (salesChartInstance) salesChartInstance.destroy();
            if (profitChartInstance) profitChartInstance.destroy();

            // 1. Grafik Penjualan
            salesChartInstance = new Chart(ctxSales, {
                type: 'bar',
                data: {
                    labels: sortedDates,
                    datasets: [
                        {
                            label: 'Gas Keluar (Tabung)',
                            data: salesGasValues,
                            backgroundColor: '#38bdf8',
                            borderRadius: 6,
                            maxBarThickness: 40
                        },
                        {
                            label: 'Aqua Keluar (Galon)',
                            data: salesAquaValues,
                            backgroundColor: '#34d399',
                            borderRadius: 6,
                            maxBarThickness: 40
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#64748b' } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#64748b' } },
                        y: { 
                            beginAtZero: true,
                            grace: '5%',
                            grid: { color: '#e2e8f0' }, 
                            ticks: { color: '#64748b', precision: 0 } 
                        }
                    }
                }
            });

            // 2. Grafik Keuntungan
            profitChartInstance = new Chart(ctxProfit, {
                type: 'line',
                data: {
                    labels: sortedDates,
                    datasets: [
                        {
                            label: 'Profit Gas (Rp)',
                            data: profitGasValues,
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                            fill: true,
                            tension: 0.3,
                            borderWidth: 3,
                            pointRadius: 4,
                            pointBackgroundColor: '#38bdf8'
                        },
                        {
                            label: 'Profit Aqua (Rp)',
                            data: profitAquaValues,
                            borderColor: '#34d399',
                            backgroundColor: 'rgba(52, 211, 153, 0.1)',
                            fill: true,
                            tension: 0.3,
                            borderWidth: 3,
                            pointRadius: 4,
                            pointBackgroundColor: '#34d399'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#64748b' } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#64748b' } },
                        y: { 
                            beginAtZero: true,
                            grace: '5%',
                            grid: { color: '#e2e8f0' }, 
                            ticks: { 
                                color: '#64748b',
                                callback: function(value) { return 'Rp ' + value.toLocaleString('id-ID'); }
                            } 
                        }
                    }
                }
            });
        }

        // Sembunyikan Splash Screen jika ada
        const splash = document.getElementById("splashScreen");
        if (splash && !splash.classList.contains("hidden")) {
            setTimeout(() => {
                splash.classList.add("hidden");
            }, 800); // Tahan dikit biar animasinya keliatan
        }
        
    } catch (err) {
        console.error("Gagal memuat data utama:", err);
    }
}

/* =========================
   PAGINATION
========================= */
function renderPagination(totalData){
    const totalPages = Math.ceil(totalData / rowsPerPage);
    let buttons = "";

    for(let i = 1; i <= totalPages; i++){
        buttons += `
            <button class="page-btn ${currentPage === i ? "active-page" : ""}" onclick="changePage(${i})">
                ${i}
            </button>
        `;
    }
    const paginationEl = document.getElementById("pagination");
    if(paginationEl) paginationEl.innerHTML = buttons;
}

function changePage(page){
    currentPage = page;
    loadData();
}

/* =========================
   DELETE DATA STOCK
========================= */
async function hapusData(id) {
    if (typeof bukaUniversalConfirmModal === "function") {
        bukaUniversalConfirmModal(
            "Konfirmasi Hapus Data",
            "Yakin hapus data transaksi stock ini, bro? 🗑️",
            "ri-delete-bin-fill",
            "rgba(239, 68, 68, 0.1)",
            "#ef4444",
            "Ya, Hapus!",
            "var(--accent-red)",
            async function() {
                prosesHapusData(id);
            }
        );
    } else {
        const konfirmasi = confirm("Yakin hapus data transaksi stock ini, bro? 🗑️");
        if (konfirmasi) {
            prosesHapusData(id);
        }
    }
}

async function prosesHapusData(id) {
    const olehUser = localStorage.getItem("username") || "admin";
    try {
        const res = await fetch(`/delete/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: olehUser })
        });
        
        if (res.ok) {
            showToast("Data berhasil dihapus! 🗑️", "success");
            loadData();
        } else {
            showToast("Gagal hapus data bro 😭", "error");
        }
    } catch (err) {
        console.error("Gagal hapus data:", err);
        showToast("Error koneksi saat menghapus data.", "error");
    }
}

/* =========================
   EDIT DATA STOCK
========================= */
function bukaModalEditStock(id, tanggal, kategori, masuk, keluar) {
    document.getElementById("editStockId").value = id;
    document.getElementById("editStockTanggal").value = tanggal;
    document.getElementById("editStockKategori").value = kategori;
    document.getElementById("editStockMasuk").value = masuk;
    document.getElementById("editStockKeluar").value = keluar;
    
    const modal = document.getElementById("editStockModal");
    if (modal) modal.style.display = "flex";
}

function tutupModalEditStock() {
    const modal = document.getElementById("editStockModal");
    if (modal) modal.style.display = "none";
}

async function simpanEditStock() {
    const id = document.getElementById("editStockId").value;
    const tanggal = document.getElementById("editStockTanggal").value;
    const kategori = document.getElementById("editStockKategori").value;
    const masuk = document.getElementById("editStockMasuk").value;
    const keluar = document.getElementById("editStockKeluar").value;
    const username = localStorage.getItem("username") || "admin";

    if (!tanggal || !kategori) {
        showToast("Tanggal dan Kategori wajib diisi!", "warning");
        return;
    }

    try {
        const res = await fetch(`/edit/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tanggal, kategori, masuk, keluar, username })
        });
        
        const result = await res.json();
        if (res.ok && result.success) {
            showToast("Data stock berhasil diperbarui! 📝", "success");
            tutupModalEditStock();
            loadData();
        } else {
            showToast("Gagal update stock: " + (result.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error("Gagal update data:", err);
        showToast("Error koneksi saat mengupdate data.", "error");
    }
}

/* =========================
   LOAD LOG AKTIVITAS 
========================= */
async function loadLogs() {
    const tableBody = document.getElementById("logTableBody");
    if (!tableBody) return;

    try {
        const res = await fetch("/api/logs");
        if (!res.ok) throw new Error("Gagal menarik data log server");
        
        cachedLogs = await res.json();
        renderLogs(cachedLogs);
    } catch (err) {
        console.error(err);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444; padding:20px;">Gagal mengambil riwayat log 😭</td></tr>`;
    }
}

function renderLogs(logs) {
    const tableBody = document.getElementById("logTableBody");
    if (!tableBody) return;

    let html = "";

    if (logs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:20px;">Belum ada aktivitas tercatat.</td></tr>`;
        return;
    }

    logs.forEach(log => {
        let badgeColor = "background: #38bdf8; color: #000;"; 
        const aksiSistem = (log.tipe_aksi || log.tipe || "").toUpperCase();

        if (aksiSistem === "INPUT" || aksiSistem === "CREATE") {
            badgeColor = "background: #10b981; color: #fff;"; 
        } else if (aksiSistem === "HAPUS" || aksiSistem === "DELETE") {
            badgeColor = "background: #ef4444; color: #fff;"; 
        } else if (aksiSistem === "EDIT HARGA" || aksiSistem === "UPDATE HARGA") {
            badgeColor = "background: #eab308; color: #000;"; 
        }

        html += `
            <tr style="border-bottom: 1px solid var(--border-subtle);">
                <td style="padding: 12px; color: #475569;">${log.waktu || "-"}</td>
                <td style="padding: 12px; color: #0f172a; font-weight: bold;">${log.eksekutor || 'admin'}</td>
                <td style="padding: 12px;">
                    <span style="${badgeColor} padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">
                        ${aksiSistem}
                    </span>
                </td>
                <td style="padding: 12px; color: #475569; text-align: left;">${log.deskripsi || '-'}</td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

function filterLogs() {
    const startDate = document.getElementById("logStartDate").value;
    const endDate = document.getElementById("logEndDate").value;
    const actionType = document.getElementById("logActionType").value;

    let filtered = [...cachedLogs];

    if (startDate) {
        filtered = filtered.filter(log => {
            if (!log.waktu) return false;
            const logDate = log.waktu.split(" ")[0];
            return logDate >= startDate;
        });
    }

    if (endDate) {
        filtered = filtered.filter(log => {
            if (!log.waktu) return false;
            const logDate = log.waktu.split(" ")[0];
            return logDate <= endDate;
        });
    }

    if (actionType && actionType !== "ALL") {
        filtered = filtered.filter(log => {
            const logAction = (log.tipe_aksi || "").toUpperCase();
            return logAction === actionType.toUpperCase();
        });
    }

    renderLogs(filtered);
}

function resetLogFilters() {
    if (document.getElementById("logStartDate")) document.getElementById("logStartDate").value = "";
    if (document.getElementById("logEndDate")) document.getElementById("logEndDate").value = "";
    if (document.getElementById("logActionType")) document.getElementById("logActionType").value = "ALL";
    renderLogs(cachedLogs);
}

/* =========================
   SIMPAN SETTING HARGA
========================= */
async function simpanSetting(){
    const modalWarung = Number(document.getElementById("modalWarung").value) || 16000;
    const jualWarung = Number(document.getElementById("jualWarung").value) || 18000;
    const modalEcer = Number(document.getElementById("modalEcer").value) || 16000;
    const jualEcer = Number(document.getElementById("jualEcer").value) || 19000;
    const modalAquaWarung = Number(document.getElementById("modalAquaWarung").value) || 14000;
    const jualAquaWarung = Number(document.getElementById("jualAquaWarung").value) || 16000;
    const modalAquaEcer = Number(document.getElementById("modalAquaEcer").value) || 15000;
    const jualAquaEcer = Number(document.getElementById("jualAquaEcer").value) || 18000;
    const namaAdmin = localStorage.getItem("username") || "admin";

    const formatK = (num) => (num / 1000) + "k";
    const deskripsiLog = `Mengubah harga -> LPG Warung [M:${formatK(settingHarga.modalWarung)}->${formatK(modalWarung)}, J:${formatK(settingHarga.jualWarung)}->${formatK(jualWarung)}] | LPG Ecer [M:${formatK(settingHarga.modalEcer)}->${formatK(modalEcer)}, J:${formatK(settingHarga.jualEcer)}->${formatK(jualEcer)}] | Aqua Warung [M:${formatK(settingHarga.modalAquaWarung)}->${formatK(modalAquaWarung)}, J:${formatK(settingHarga.jualAquaWarung)}->${formatK(jualAquaWarung)}] | Aqua Ecer [M:${formatK(settingHarga.modalAquaEcer)}->${formatK(modalAquaEcer)}, J:${formatK(settingHarga.jualAquaEcer)}->${formatK(jualAquaEcer)}]`;

    try {
        const res = await fetch("/api/setting-harga", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                modalWarung, jualWarung, modalEcer, jualEcer, 
                modalAquaWarung, jualAquaWarung, modalAquaEcer, jualAquaEcer, 
                oleh: namaAdmin, deskripsi: deskripsiLog 
            })
        });

        const result = await res.json();

        if (res.ok && result.success) {
            settingHarga = { 
                modalWarung, jualWarung, modalEcer, jualEcer,
                modalAquaWarung, jualAquaWarung, modalAquaEcer, jualAquaEcer
            };
            showToast("Harga berhasil diubah dan disimpan permanen! 💰", "success");
            loadData(); 
        } else {
            showToast("Gagal menyimpan harga: " + (result.message || "Terjadi kesalahan."), "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Error koneksi ke server saat menyimpan harga 😭", "error");
    }
}

/* =========================
   DOWNLOAD EXCEL (SECURED)
========================= */
async function downloadExcel(){
    const role = localStorage.getItem("role");
    if(role !== "admin" && role !== "superadmin") {
        showToast("Akses ditolak! Fitur ini cuma buat admin.", "error");
        return;
    }

    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    if(!startDate || !endDate){
        showToast("PILIH TANGGAL PERIODE DULU 😎", "warning");
        return;
    }

    const res = await fetch("/data");
    const data = await res.json();
    data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

    let csv = `Tanggal,Kategori,Masuk,Keluar,Sisa Stok,Omset,Modal,Profit,Oleh\n`;
    let runningGas = 0;
    let runningAqua = 0;
    
    data.forEach(item => {
        const masuk = Number(item.masuk) || 0;
        const keluar = Number(item.keluar) || 0;
        let currentRunning = 0;
        if (item.kategori === "Aqua Warung" || item.kategori === "Aqua Ecer") {
            runningAqua += (masuk - keluar);
            currentRunning = runningAqua;
        } else {
            runningGas += (masuk - keluar);
            currentRunning = runningGas;
        }
        
        if (item.tanggal >= startDate && item.tanggal <= endDate) {
            let itemOmset = 0;
            let itemModal = 0;
            let itemProfit = 0;
            let rincianKey = item.kategori;
            if (rincianKey === "Warung") rincianKey = "LPG Warung";
            if (rincianKey === "Ecer") rincianKey = "LPG Ecer";

            if (rincianKey === "LPG Warung") {
                itemOmset = keluar * settingHarga.jualWarung;
                itemModal = keluar * settingHarga.modalWarung;
                itemProfit = itemOmset - itemModal;
            } else if (rincianKey === "LPG Ecer") {
                itemOmset = keluar * settingHarga.jualEcer;
                itemModal = keluar * settingHarga.modalEcer;
                itemProfit = itemOmset - itemModal;
            } else if (rincianKey === "Aqua Warung") {
                itemOmset = keluar * settingHarga.jualAquaWarung;
                itemModal = keluar * settingHarga.modalAquaWarung;
                itemProfit = itemOmset - itemModal;
            } else if (rincianKey === "Aqua Ecer") {
                itemOmset = keluar * settingHarga.jualAquaEcer;
                itemModal = keluar * settingHarga.modalAquaEcer;
                itemProfit = itemOmset - itemModal;
            }

            csv += `${item.tanggal},${rincianKey},${masuk},${keluar},${currentRunning},${itemOmset},${itemModal},${itemProfit},${item.oleh || item.username || 'admin'}\n`;
        }
    });

    if (csv === `Tanggal,Kategori,Masuk,Keluar,Sisa Stok,Omset,Modal,Profit,Oleh\n`) {
        showToast("Tidak ada data transaksi di periode tanggal tersebut 😭", "error");
        return;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rekap-adequa-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

/* ==========================================
   UTILITAS IMAGE TO BASE64 (UNTUK LOGO PDF)
========================================== */
function getBase64Image(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = src;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = (err) => reject(err);
    });
}

/* =========================
   DOWNLOAD PDF (SECURED)
========================= */
async function downloadPDF(){
    const role = localStorage.getItem("role");
    if(role !== "admin" && role !== "superadmin") {
        showToast("Akses ditolak! Fitur ini cuma buat admin. ⛔", "error");
        return;
    }

    try {
        const startDate = document.getElementById("startDate").value;
        const endDate = document.getElementById("endDate").value;

        if(!startDate || !endDate){
            showToast("PILIH TANGGAL PERIODE DULU 😎", "warning");
            return;
        }

        const res = await fetch("/data");
        let data = await res.json();
        
        // Urutkan kronologis dahulu sebelum difilter untuk hitungan akumulasi stock yang valid
        data.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));

        let totalMasuk = 0;
        let totalKeluar = 0;
        let masukGas = 0;
        let keluarGas = 0;
        let masukAqua = 0;
        let keluarAqua = 0;
        let profitGas = 0;
        let profitAqua = 0;
        let runningGas = 0;
        let runningAqua = 0;
        
        let totalOmsetPDF = 0;
        let totalModalPDF = 0;

        const tableData = [];

        data.forEach(item => {
            const masuk = Number(item.masuk) || 0;
            const keluar = Number(item.keluar) || 0;
            
            let currentRunning = 0;
            if (item.kategori === "Aqua Warung" || item.kategori === "Aqua Ecer") {
                runningAqua += (masuk - keluar);
                currentRunning = runningAqua;
            } else {
                runningGas += (masuk - keluar);
                currentRunning = runningGas;
            }

            // Filter data yang masuk ke range tanggal pilihan user
            if (item.tanggal >= startDate && item.tanggal <= endDate) {
                totalMasuk += masuk;
                totalKeluar += keluar;

                if (item.kategori === "Aqua Warung" || item.kategori === "Aqua Ecer") {
                    masukAqua += masuk;
                    keluarAqua += keluar;
                } else {
                    masukGas += masuk;
                    keluarGas += keluar;
                }

                let itemProfit = 0;
                let itemOmset = 0;
                let itemModal = 0;
                let rincianKey = item.kategori;
                if (rincianKey === "Warung") rincianKey = "LPG Warung";
                if (rincianKey === "Ecer") rincianKey = "LPG Ecer";

                if (rincianKey === "LPG Warung") {
                    itemOmset = keluar * settingHarga.jualWarung;
                    itemModal = keluar * settingHarga.modalWarung;
                    itemProfit = itemOmset - itemModal;
                    profitGas += itemProfit;
                } else if (rincianKey === "LPG Ecer") {
                    itemOmset = keluar * settingHarga.jualEcer;
                    itemModal = keluar * settingHarga.modalEcer;
                    itemProfit = itemOmset - itemModal;
                    profitGas += itemProfit;
                } else if (rincianKey === "Aqua Warung") {
                    itemOmset = keluar * settingHarga.jualAquaWarung;
                    itemModal = keluar * settingHarga.modalAquaWarung;
                    itemProfit = itemOmset - itemModal;
                    profitAqua += itemProfit;
                } else if (rincianKey === "Aqua Ecer") {
                    itemOmset = keluar * settingHarga.jualAquaEcer;
                    itemModal = keluar * settingHarga.modalAquaEcer;
                    itemProfit = itemOmset - itemModal;
                    profitAqua += itemProfit;
                }
                
                totalOmsetPDF += itemOmset;
                totalModalPDF += itemModal;

                tableData.push([
                    item.tanggal, 
                    rincianKey, 
                    masuk, 
                    keluar, 
                    item.oleh || item.username || 'admin', 
                    `Rp ${itemOmset.toLocaleString("id-ID")}`,
                    `Rp ${itemModal.toLocaleString("id-ID")}`,
                    `Rp ${itemProfit.toLocaleString("id-ID")}`
                ]);
            }
        });

        if(tableData.length === 0){
            showToast("Tidak ada data transaksi di periode tanggal tersebut 😭", "error");
            return;
        }

        const totalStock = totalMasuk - totalKeluar;
        const totalProfit = profitGas + profitAqua;

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

        let logo = "";
        try { logo = await getBase64Image("ADEQUA.png"); } catch(e) { console.error(e); }

        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, 210, 297, "F");
        
        if(logo) doc.addImage(logo, "PNG", 15, 10, 180, 38);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(30, 41, 59);
        doc.text("LAPORAN REKAPITULASI STOCK & PROFIT", 105, 58, { align: "center" });

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.text(`Periode : ${startDate} s/d ${endDate}`, 105, 64, { align: "center" });

        // Kotak Ringkasan Laporan
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(14, 72, 182, 30, 3, 3, "FD");

        // Kolom 1 (Stock)
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(71, 85, 105);
        doc.text("Stock Gas", 18, 81);
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(16, 185, 129);
        doc.text(`Masuk : +${masukGas}`, 18, 88);
        doc.setTextColor(239, 68, 68);
        doc.text(`Keluar : -${keluarGas}`, 18, 95);

        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(71, 85, 105);
        doc.text("Stock Aqua", 50, 81);
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(16, 185, 129);
        doc.text(`Masuk : +${masukAqua}`, 50, 88);
        doc.setTextColor(239, 68, 68);
        doc.text(`Keluar : -${keluarAqua}`, 50, 95);

        // Kolom 2 (Total Profit)
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(71, 85, 105);
        doc.text("Total Profit Bersih", 88, 81);
        
        doc.setFontSize(18);
        doc.setTextColor(16, 185, 129);
        doc.text(`Rp ${totalProfit.toLocaleString("id-ID")}`, 88, 92);

        // Kolom 3 (Rincian Profit)
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(100, 116, 139);
        doc.text("Profit Gas", 145, 84);
        
        doc.setTextColor(56, 189, 248);
        doc.text(`: Rp ${profitGas.toLocaleString("id-ID")}`, 165, 84);

        doc.setTextColor(100, 116, 139);
        doc.text("Profit Aqua", 145, 92);
        
        doc.setTextColor(16, 185, 129);
        doc.text(`: Rp ${profitAqua.toLocaleString("id-ID")}`, 165, 92);

        // Tambah baris total di paling bawah tabel PDF
        tableData.push(["TOTAL GAS", "-", `+${masukGas}`, `-${keluarGas}`, "-", `Rp ${totalOmsetPDF.toLocaleString("id-ID")}`, `Rp ${totalModalPDF.toLocaleString("id-ID")}`, `Rp ${profitGas.toLocaleString("id-ID")}`]);
        tableData.push(["TOTAL AQUA", "-", `+${masukAqua}`, `-${keluarAqua}`, "-", "-", "-", `Rp ${profitAqua.toLocaleString("id-ID")}`]);
        tableData.push(["GRAND TOTAL", "-", `+${totalMasuk}`, `-${totalKeluar}`, "-", `Rp ${totalOmsetPDF.toLocaleString("id-ID")}`, `Rp ${totalModalPDF.toLocaleString("id-ID")}`, `Rp ${totalProfit.toLocaleString("id-ID")}`]);

        doc.autoTable({
            startY: 112,
            head: [["Tanggal", "Kategori", "Masuk", "Keluar", "Oleh", "Omset", "Modal", "Profit"]],
            body: tableData,
            theme: "striped",
            styles: {
                font: "helvetica",
                fontSize: 9,
                cellPadding: 4,
                textColor: [51, 65, 85],
                halign: 'center',
                valign: 'middle'
            },
            headStyles: { 
                fillColor: [30, 41, 59], 
                textColor: [255, 255, 255], 
                fontStyle: 'bold',
                halign: "center" 
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            didParseCell: function(data) {
                const isGasRow = data.row.index === tableData.length - 3;
                const isAquaRow = data.row.index === tableData.length - 2;
                const isGrandTotalRow = data.row.index === tableData.length - 1;

                if (isGasRow || isAquaRow || isGrandTotalRow) {
                    data.cell.styles.fontStyle = "bold";
                    data.cell.styles.fillColor = isGrandTotalRow ? [203, 213, 225] : [226, 232, 240];
                    data.cell.styles.textColor = [15, 23, 42];
                } else if (data.section === 'body') {
                    if (data.column.index === 2) { // Masuk
                        data.cell.styles.textColor = [16, 185, 129];
                        data.cell.styles.fontStyle = "bold";
                    }
                    if (data.column.index === 3) { // Keluar
                        data.cell.styles.textColor = [239, 68, 68];
                        data.cell.styles.fontStyle = "bold";
                    }
                    if (data.column.index === 7) { // Profit
                        data.cell.styles.textColor = [5, 150, 105];
                        data.cell.styles.fontStyle = "bold";
                    }
                }
            }
        });

        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text("Generated by ADEQUA Management System", 14, 285);

        doc.save(`rekap-${startDate}-${endDate}.pdf`);
        showToast("Laporan PDF berhasil didownload! 📄", "success");
    } catch(err){
        console.error(err);
        showToast("PDF Error 😭", "error");
    }
}

/* ==========================================
   LOGOUT FUNCTION
========================================== */
function logout() {
    if (typeof bukaModalLogout === "function") {
        bukaModalLogout();
    } else {
        const konfirmasi = confirm("Yakin mau logout dari sistem, bro? 🔓");
        if (konfirmasi) {
            localStorage.clear(); 
            sessionStorage.clear();
            window.location.href = window.location.origin;
        }
    }
}

/* ==========================================
   BUAT AKUN BARU
========================================== */
async function createAccount() {
    const username = document.getElementById("regUsername").value.trim();
    const password = document.getElementById("regPassword").value.trim();
    const role = document.getElementById("regRole").value;

    if (!username || !password) {
        showToast("Username dan Password gak boleh kosong bro! ❌", "warning");
        return;
    }

    try {
        const res = await fetch("/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, role, requesterRole: localStorage.getItem("role") })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`Akun dengan Akses [${role.toUpperCase()}] berhasil dibuat! 🎉`, "success");
            document.getElementById("regUsername").value = "";
            document.getElementById("regPassword").value = "";
            loadRegisteredUsers();
        } else {
            showToast("Gagal buat akun: " + (data.message || "Terjadi kesalahan"), "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Error koneksi ke server 😭", "error");
    }
}

/* ==========================================
   LOAD DAFTAR USER
========================================== */
async function loadRegisteredUsers() {
    const tableBody = document.getElementById("userTableBody");
    if (!tableBody) return;
    if (localStorage.getItem("role") === "user") return;

    try {
        const res = await fetch("/api/users");
        const users = await res.json();

        const currentRole = localStorage.getItem("role") || "user";
        let html = "";
        users.forEach((user) => {
            const safeUsername = user.username.replace(/['"]/g, "");
            const safeRole = user.role.toLowerCase();
            
            // Default styling untuk role user/admin
            let roleBadgeBg = user.role === 'admin' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)';
            let roleBadgeColor = user.role === 'admin' ? '#f87171' : '#34d399';
            let roleBadgeBorder = user.role === 'admin' ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)';

            // Styling spesial untuk superadmin
            if (user.role === 'superadmin') {
                roleBadgeBg = 'rgba(139,92,246,0.15)';
                roleBadgeColor = '#c084fc';
                roleBadgeBorder = 'rgba(139,92,246,0.3)';
            }

            let actionButtons = "";
            // Hanya Super Admin yang bisa edit superadmin/admin. Admin biasa hanya bisa edit user biasa.
            if (currentRole === "superadmin" || (currentRole === "admin" && user.role === "user")) {
                actionButtons = `
                    <button onclick="openEditModal('${user.id}', '${safeUsername}', '${safeRole}')" style="background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); padding: 6px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; font-family: 'Inter', sans-serif;">
                        <i class='ri-edit-line'></i> Edit
                    </button>
                    <button onclick="resetUserPin('${user.id}', '${safeUsername}')" style="background: rgba(139,92,246,0.12); color: #a78bfa; border: 1px solid rgba(139,92,246,0.2); padding: 6px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; font-family: 'Inter', sans-serif;">
                        <i class='ri-key-2-line'></i> Reset PIN
                    </button>
                    <button onclick="deleteUser('${user.id}', '${safeUsername}')" style="background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.15); padding: 6px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; font-family: 'Inter', sans-serif;">
                        <i class='ri-delete-bin-line'></i> Hapus
                    </button>
                `;
            } else {
                actionButtons = `<span style="color: var(--text-muted); font-size: 11px; font-style: italic; padding: 6px 0;">Akses Terbatas</span>`;
            }

            html += `
                <tr>
                    <td>${user.id}</td>
                    <td style="font-weight: 600;">${user.username}</td>
                    <td>
                        <span style="background: ${roleBadgeBg}; color: ${roleBadgeColor}; border: 1px solid ${roleBadgeBorder}; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px;">
                            ${user.role.toUpperCase()}
                        </span>
                    </td>
                    <td style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${actionButtons}
                    </td>
                </tr>
            `;
        });
        tableBody.innerHTML = html;
    } catch (err) {
        console.error("Gagal memuat list user:", err);
    }
}

/* ==========================================
   MODAL EDIT USER SINKRONISASI
========================================== */
function openEditModal(id, username, role) {
    const modal = document.getElementById("editUserModal");
    if (modal) {
        document.getElementById("editUserId").value = id;
        document.getElementById("editUsername").value = username;
        
        const roleSelect = document.getElementById("editRole");
        if (roleSelect) {
            // Check if superadmin option exists
            let hasSuperadminOption = false;
            for (let i = 0; i < roleSelect.options.length; i++) {
                if (roleSelect.options[i].value === "superadmin") {
                    hasSuperadminOption = true;
                    break;
                }
            }
            
            if (role === "superadmin") {
                if (!hasSuperadminOption) {
                    const opt = document.createElement("option");
                    opt.value = "superadmin";
                    opt.text = "superadmin";
                    roleSelect.add(opt);
                }
                roleSelect.value = "superadmin";
                roleSelect.disabled = true; // disable changing role for superadmin
            } else {
                // Remove superadmin option if it exists
                for (let i = 0; i < roleSelect.options.length; i++) {
                    if (roleSelect.options[i].value === "superadmin") {
                        roleSelect.remove(i);
                        break;
                    }
                }
                roleSelect.value = role;
                roleSelect.disabled = false;
            }
        }

        document.getElementById("editPassword").value = ""; 
        modal.style.display = "flex";
    }
}

function closeEditModal() {
    const modal = document.getElementById("editUserModal");
    if (modal) modal.style.display = "none";
    
    // Re-enable role dropdown just in case
    const roleSelect = document.getElementById("editRole");
    if (roleSelect) roleSelect.disabled = false;
}

async function simpanPerubahanUser() {
    const id = document.getElementById("editUserId").value;
    const username = document.getElementById("editUsername").value.trim();
    const password = document.getElementById("editPassword").value.trim();
    const role = document.getElementById("editRole").value;

    if (!username) {
        showToast("Username tidak boleh kosong!", "warning");
        return;
    }

    try {
        const res = await fetch(`/api/users/update/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, role, requesterRole: localStorage.getItem("role") })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast("Data user berhasil diperbarui! 📝", "success");
            closeEditModal();
            loadRegisteredUsers();
        } else {
            showToast("Gagal update user: " + (data.message || "Terjadi kesalahan"), "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Error koneksi server saat menyimpan perubahan user", "error");
    }
}

/* ==========================================
   RESET PIN USER
========================================== */
async function resetUserPin(id, username) {
    if (typeof bukaUniversalConfirmModal === "function") {
        bukaUniversalConfirmModal(
            "Konfirmasi Reset PIN",
            `Reset PIN authenticator user <b>[ ${username} ]</b>?<br><br><span style='font-size:12px; color:var(--text-muted);'>User harus set PIN baru saat login berikutnya.</span>`,
            "ri-key-fill",
            "rgba(245,158,11,0.1)",
            "#f59e0b",
            "Ya, Reset PIN",
            "var(--accent-blue)",
            async function() {
                prosesResetUserPin(id, username);
            }
        );
    } else {
        const konfirmasi = confirm(`Reset PIN authenticator user [ ${username} ]? User harus set PIN baru saat login berikutnya.`);
        if (konfirmasi) {
            prosesResetUserPin(id, username);
        }
    }
}

async function prosesResetUserPin(id, username) {
    try {
        const adminUser = localStorage.getItem("username") || "admin";
        const res = await fetch(`/api/reset-pin/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: adminUser, requesterRole: localStorage.getItem("role") })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`PIN user ${username} berhasil direset! 🔑`, "success");
            loadRegisteredUsers(); 
        } else {
            showToast("Gagal reset PIN: " + (data.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Error koneksi ke server", "error");
    }
}

/* ==========================================
   HAPUS AKUN PROFILE USER
========================================== */
async function deleteUser(id, username) {
    if (typeof bukaUniversalConfirmModal === "function") {
        bukaUniversalConfirmModal(
            "Hapus Akun Permanen",
            `Lu yakin mau menghapus akun <b>[ ${username} ]</b> secara permanen?<br><br><span style='font-size:12px; color:var(--accent-red); font-weight:600;'>Aksi ini tidak bisa dibatalkan!</span>`,
            "ri-user-unfollow-fill",
            "rgba(239, 68, 68, 0.1)",
            "#ef4444",
            "Ya, Hapus Akun!",
            "var(--accent-red)",
            async function() {
                prosesDeleteUser(id, username);
            }
        );
    } else {
        const konfirmasi = confirm(`Lu yakin mau menghapus akun [ ${username} ] secara permanen? 🤔`);
        if (konfirmasi) {
            prosesDeleteUser(id, username);
        }
    }
}

async function prosesDeleteUser(id, username) {
    try {
        const res = await fetch(`/api/users/delete/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requesterRole: localStorage.getItem("role") })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`Akun ${username} berhasil dihapus permanen! 🗑️`, "success");
            loadRegisteredUsers();
        } else {
            showToast("Gagal hapus akun: " + (data.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Error koneksi ke server", "error");
    }
}

/* ==========================================
   FITUR OTO-PROTEKSI AKSES & PROFILE DISPLAY
========================================== */
function jalankanProteksiAkses() {
    const currentUsername = localStorage.getItem("username");
    const role = localStorage.getItem("role") || "user"; 
    const token = localStorage.getItem("token");

    if (!currentUsername || !token) {
        showToast("Login dulu bro! Lu gak bisa main masuk aja ⛔", "error");
        window.location.href = window.location.origin; 
        return;
    }

    const userDisplayEl = document.getElementById("userLoginDisplay");
    const roleDisplayEl = document.getElementById("roleLoginDisplay");
    
    if (userDisplayEl) userDisplayEl.innerText = currentUsername;
    if (roleDisplayEl) {
        roleDisplayEl.innerText = role.toUpperCase();
        roleDisplayEl.className = `role-badge ${role}`;
    }

    const menus = document.querySelectorAll(".menu-item");
    const btnExcel = document.querySelector("button[onclick*='downloadExcel']");
    const btnPDF = document.querySelector("button[onclick*='downloadPDF']");

    const logoutBtn = document.querySelector(".logout-item");
    if (logoutBtn) {
        logoutBtn.style.setProperty('display', 'flex', 'important');
        logoutBtn.style.setProperty('pointer-events', 'auto', 'important');
    }

    if (role === "user") {
        console.log("⚠️ Akses Terbatas Aktif: User Mode");
        menus.forEach(menu => {
            const attr = menu.getAttribute("onclick") || "";
            if (attr.includes("settingPage") || attr.includes("logsPage")) {
                menu.style.setProperty('display', 'none', 'important');
            } else if (!attr.includes("logout")) {
                menu.style.setProperty('display', 'flex', 'important');
            }
        });
        
        if (btnExcel) btnExcel.style.setProperty('display', 'none', 'important');
        if (btnPDF) btnPDF.style.setProperty('display', 'none', 'important');
    } else {
        if (role === "superadmin") {
            console.log("🚀 Akses Penuh: Super Admin Mode");
        } else {
            console.log("👑 Akses Menengah: Admin Mode");
            // Sembunyikan opsi role 'admin' di form register jika bukan superadmin
            const regRoleSelect = document.getElementById("regRole");
            if (regRoleSelect) {
                const adminOption = regRoleSelect.querySelector('option[value="admin"]');
                if (adminOption) adminOption.style.display = 'none';
                regRoleSelect.value = "user"; // paksa user
            }
        }

        menus.forEach(menu => {
            menu.style.setProperty('display', 'flex', 'important');
        });
        if (btnExcel) btnExcel.style.setProperty('display', 'block', 'important');
        if (btnPDF) btnPDF.style.setProperty('display', 'block', 'important');
    }
}

/* =========================================================
   LOGO UPLOAD LOGIC
========================================================= */
document.addEventListener("DOMContentLoaded", () => {
    const logoInput = document.getElementById("logoUploadInput");
    const logoPreview = document.getElementById("logoPreview");

    if (logoInput && logoPreview) {
        logoInput.addEventListener("change", function(e) {
            const file = e.target.files[0];
            if (!file) {
                logoPreview.src = "ADEQUA-LOGO.png"; // Reset to current logo
                return;
            }

            // Validasi ukuran (Maks 5MB)
            if (file.size > 5 * 1024 * 1024) {
                showToast("Ukuran file terlalu besar! Maksimal 5MB.", "error");
                logoInput.value = ""; // Reset
                return;
            }

            const reader = new FileReader();
            reader.onload = function(event) {
                logoPreview.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
});

async function uploadNewLogo() {
    const logoInput = document.getElementById("logoUploadInput");
    const btn = document.getElementById("btnSaveLogo");
    
    if (!logoInput || !logoInput.files || logoInput.files.length === 0) {
        showToast("Pilih file gambar logo terlebih dahulu!", "error");
        return;
    }

    const file = logoInput.files[0];
    const reader = new FileReader();

    // Disable button to prevent double submit
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ri-loader-4-line spin"></i> <span>Mengunggah...</span>`;
    }

    reader.onload = async function(event) {
        const base64String = event.target.result;

        try {
            const response = await fetch("/api/upload-logo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ logoBase64: base64String })
            });

            const data = await response.json();
            
            if (response.ok && data.success) {
                showToast("Logo berhasil diperbarui! Memuat ulang...", "success");
                
                // Refresh page after short delay to apply new logo
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                showToast(data.error || "Gagal mengunggah logo.", "error");
                resetUploadButton(btn);
            }
        } catch (error) {
            console.error("Error uploading logo:", error);
            showToast("Terjadi kesalahan jaringan saat mengunggah logo.", "error");
            resetUploadButton(btn);
        }
    };

    reader.onerror = function() {
        showToast("Gagal membaca file gambar.", "error");
        resetUploadButton(btn);
    };

    reader.readAsDataURL(file);
}

function resetUploadButton(btn) {
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-upload-cloud-2-line"></i> <span>Unggah & Simpan Logo</span>`;
    }
}

/* ==========================================
   GANTI PASSWORD SENDIRI (PROFIL SAYA)
========================================== */
function bukaModalGantiPassword() {
    const modal = document.getElementById("gantiPasswordModal");
    if (modal) {
        document.getElementById("oldPasswordInput").value = "";
        document.getElementById("newPasswordInput").value = "";
        modal.style.display = "flex";
    }
}

function tutupModalGantiPassword() {
    const modal = document.getElementById("gantiPasswordModal");
    if (modal) modal.style.display = "none";
}

async function simpanPasswordBaru() {
    const oldPassword = document.getElementById("oldPasswordInput").value;
    const newPassword = document.getElementById("newPasswordInput").value;
    const username = localStorage.getItem("username");

    if (!oldPassword || !newPassword) {
        showToast("Password lama dan baru wajib diisi!", "warning");
        return;
    }

    try {
        const res = await fetch("/api/users/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, oldPassword, newPassword })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast("Password berhasil diubah! 🔐", "success");
            tutupModalGantiPassword();
        } else {
            showToast("Gagal ubah password: " + (data.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showToast("Error koneksi ke server", "error");
    }
}

/* ==========================================
   ANIMASI ROLLING NUMBERS
========================================== */
function animateValue(obj, start, end, duration, prefix = "") {
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 4); // easeOutQuart
        const currentVal = Math.floor(easeProgress * (end - start) + start);
        obj.innerText = prefix + currentVal.toLocaleString("id-ID");
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerText = prefix + end.toLocaleString("id-ID");
        }
    };
    window.requestAnimationFrame(step);
}

/* ==========================================
   KASIR POS SYSTEM
========================================== */
let posCart = [];

function addToCart(kategori) {
    let harga = 0;
    if (kategori === 'LPG Warung') harga = settingHarga.jualWarung;
    if (kategori === 'LPG Ecer') harga = settingHarga.jualEcer;
    if (kategori === 'Aqua Warung') harga = settingHarga.jualAquaWarung;
    if (kategori === 'Aqua Ecer') harga = settingHarga.jualAquaEcer;

    const existing = posCart.find(item => item.kategori === kategori);
    if (existing) {
        existing.qty += 1;
    } else {
        posCart.push({ kategori, harga, qty: 1 });
    }
    renderCart();
    
    // Add micro-interaction feedback
    showToast(`${kategori} ditambahkan!`, "success");
}

function updateCartQty(index, delta) {
    if (posCart[index]) {
        posCart[index].qty += delta;
        if (posCart[index].qty <= 0) {
            posCart.splice(index, 1);
        }
    }
    renderCart();
}

function renderCart() {
    const cartList = document.getElementById('posCartList');
    if (!cartList) return;
    
    if (posCart.length === 0) {
        cartList.innerHTML = `<div class="empty-cart-state"><i class="ri-shopping-basket-line"></i><p>Keranjang masih kosong</p></div>`;
        document.getElementById('posSubtotal').textContent = "Rp 0";
        document.getElementById('posTotalTagihan').textContent = "Rp 0";
        calculateChange();
        document.getElementById('btnCheckout').disabled = true;
        return;
    }

    let html = '';
    let total = 0;
    posCart.forEach((item, index) => {
        const itemTotal = item.harga * item.qty;
        total += itemTotal;
        html += `
        <div class="cart-item">
            <div class="cart-item-info">
                <h4>${item.kategori}</h4>
                <p>${formatRupiah(item.harga)} x ${item.qty} = <strong>${formatRupiah(itemTotal)}</strong></p>
            </div>
            <div class="cart-item-actions">
                <button class="qty-btn" onclick="updateCartQty(${index}, -1)"><i class="ri-subtract-line"></i></button>
                <span class="cart-item-qty">${item.qty}</span>
                <button class="qty-btn" onclick="updateCartQty(${index}, 1)"><i class="ri-add-line"></i></button>
            </div>
        </div>
        `;
    });

    cartList.innerHTML = html;
    document.getElementById('posSubtotal').textContent = formatRupiah(total);
    document.getElementById('posTotalTagihan').textContent = formatRupiah(total);
    calculateChange();
    document.getElementById('btnCheckout').disabled = false;
}

function formatCashInput(input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') {
        input.value = '';
    } else {
        input.value = parseInt(value, 10).toLocaleString('id-ID');
    }
    calculateChange();
}

function calculateChange() {
    let total = posCart.reduce((sum, item) => sum + (item.harga * item.qty), 0);
    const cashInput = document.getElementById('posCash') ? document.getElementById('posCash').value.replace(/\D/g, '') : 0;
    const cash = Number(cashInput) || 0;
    const change = cash - total;
    const kembalianEl = document.getElementById('posKembalian');
    if (!kembalianEl) return;
    
    if (cash === 0) {
        kembalianEl.textContent = "Rp 0";
        kembalianEl.style.color = "var(--text-secondary)";
    } else if (change < 0) {
        kembalianEl.textContent = "Kurang " + formatRupiah(Math.abs(change));
        kembalianEl.style.color = "var(--accent-red)";
    } else {
        kembalianEl.textContent = formatRupiah(change);
        kembalianEl.style.color = "var(--accent-green)";
    }
}

async function checkoutPOS() {
    if (posCart.length === 0) return;
    
    let total = posCart.reduce((sum, item) => sum + (item.harga * item.qty), 0);
    const cashInput = document.getElementById('posCash') ? document.getElementById('posCash').value.replace(/\D/g, '') : '0';
    const cash = Number(cashInput) || 0;
    const isKasbon = document.getElementById('posIsKasbon') ? document.getElementById('posIsKasbon').checked : false;
    const namaPelanggan = document.getElementById('posNamaPelanggan') ? document.getElementById('posNamaPelanggan').value.trim() : "";
    
    if (isKasbon) {
        if (!namaPelanggan) {
            showToast("Nama Pelanggan Kasbon wajib diisi!", "warning");
            return;
        }
    } else if (cash > 0 && cash < total) {
        showToast("Uang tunai kurang dari total tagihan!", "warning");
        return;
    }

    const btn = document.getElementById('btnCheckout');
    btn.disabled = true;
    btn.innerHTML = `<i class="ri-loader-4-line spin"></i> Memproses...`;

    try {
        const d = new Date();
        const today = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split("T")[0];
        const token = localStorage.getItem("token");

        // Jika mode Kasbon aktif, buat request hutang dulu
        if (isKasbon) {
            const resHutang = await fetch("/api/hutangs", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify({
                    tanggal: today,
                    nama_pelanggan: namaPelanggan,
                    items: posCart,
                    total_hutang: total
                })
            });
            
            if (!resHutang.ok) {
                showToast("Gagal mencatat kasbon!", "error");
                btn.disabled = false;
                btn.innerHTML = `<i class="ri-check-double-line"></i> Bayar Sekarang`;
                return;
            }
        }

        // Submit each item sequentially to /add to reduce stock & count omset
        for (const item of posCart) {
            const payload = {
                tanggal: today,
                kategori: item.kategori,
                masuk: 0,
                keluar: item.qty
            };

            await fetch("/add", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify(payload)
            });
        }

        showToast(isKasbon ? "Kasbon berhasil dicatat!" : "Transaksi POS berhasil!", "success");
        
        // Cetak struk
        const kembalian = (!isKasbon && cash > 0) ? (cash - total) : 0;
        cetakStrukPOS([...posCart], cash, kembalian, total, isKasbon, namaPelanggan);

        // Reset
        posCart = [];
        document.getElementById('posCash').value = '';
        if (document.getElementById('posIsKasbon')) {
            document.getElementById('posIsKasbon').checked = false;
            toggleKasbonPOS(); // Reset view
        }
        renderCart();
        loadData(); 

    } catch (err) {
        console.error(err);
        showToast("Error saat checkout POS", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-check-double-line"></i> Bayar Sekarang`;
    }
}

function toggleKasbonPOS() {
    const cb = document.getElementById("posIsKasbon");
    if (!cb) return;
    // Toggle manual karena label dibungkus div clickable
    cb.checked = !cb.checked;
    
    const namaContainer = document.getElementById("posNamaPelangganContainer");
    const paymentSection = document.getElementById("posPaymentSection");
    
    if (cb.checked) {
        namaContainer.style.display = "block";
        paymentSection.style.display = "none";
        document.getElementById("posCash").value = ""; // Reset cash
        calculateChange();
    } else {
        namaContainer.style.display = "none";
        paymentSection.style.display = "block";
        document.getElementById("posNamaPelanggan").value = "";
    }
}

/* =========================
   HUTANG / KASBON LOGIC
========================= */
async function loadHutangs() {
    try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/hutangs", {
            headers: { "Authorization": "Bearer " + token }
        });
        if (res.ok) {
            const data = await res.json();
            const tbody = document.getElementById("hutangTableBody");
            if (!tbody) return;
            
            let html = "";
            if (data.length === 0) {
                html = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Belum ada kasbon tercatat.</td></tr>';
            } else {
                data.forEach(item => {
                    const statusClass = item.status === "LUNAS" ? "lunas" : "belum-lunas";
                    let itemsHtml = "";
                    try {
                        const parsedItems = JSON.parse(item.items);
                        parsedItems.forEach(pi => {
                            itemsHtml += `<div>${pi.kategori} (${pi.qty}x)</div>`;
                        });
                    } catch(e) { itemsHtml = item.items; }

                    html += `
                        <tr>
                            <td>${item.tanggal}</td>
                            <td style="font-weight:bold; color:var(--text-primary);">${item.nama_pelanggan}</td>
                            <td style="font-size:12px; color:var(--text-secondary);">${itemsHtml}</td>
                            <td style="color:var(--accent-red); font-weight:bold;">Rp ${item.total_hutang.toLocaleString('id-ID')}</td>
                            <td style="color:var(--accent-green); font-weight:bold;">Rp ${item.jumlah_dibayar.toLocaleString('id-ID')}</td>
                            <td><span class="status-badge ${statusClass}">${item.status}</span></td>
                            <td>
                                ${item.status === 'BELUM LUNAS' ? 
                                `<button onclick="bayarHutang(${item.id}, '${item.nama_pelanggan}', ${item.total_hutang - item.jumlah_dibayar})" style="background: var(--accent-blue); border:none; color:#fff; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600; font-size:12px;">
                                    Bayar
                                </button>` : '-'}
                            </td>
                        </tr>
                    `;
                });
            }
            tbody.innerHTML = html;
        }
    } catch (err) {
        console.error("Gagal load kasbon:", err);
    }
}

function bayarHutang(id, nama, sisa) {
    const nominal = prompt(`Masukkan nominal pembayaran dari ${nama}\n(Sisa hutang: Rp ${sisa.toLocaleString('id-ID')})`);
    if (nominal === null || nominal.trim() === "") return;
    
    const numNominal = parseInt(nominal.replace(/\D/g, ''));
    if (isNaN(numNominal) || numNominal <= 0) {
        showToast("Nominal tidak valid!", "error");
        return;
    }

    const token = localStorage.getItem("token");
    fetch(`/api/hutangs/bayar/${id}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ nominal_bayar: numNominal })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, "success");
            loadHutangs();
        } else {
            showToast(data.message, "error");
        }
    })
    .catch(err => {
        console.error(err);
        showToast("Gagal memproses pembayaran", "error");
    });
}

/* ==========================================
   CETAK STRUK POS (PDF)
========================================== */
function cetakStrukPOS(cart, cash, kembalian, total, isKasbon = false, namaPelanggan = "") {
    if (typeof window.jspdf === 'undefined') {
        showToast("Gagal memuat sistem PDF", "error");
        return;
    }

    const { jsPDF } = window.jspdf;
    
    // Asumsi ukuran kertas kasir thermal (lebar 80mm). Panjang dinamis sesuai isi.
    const pageHeight = 80 + (cart.length * 10);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [80, pageHeight] });

    let y = 10;
    
    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PANGKALAN ADEQUA", 40, y, { align: "center" });
    
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Distributor Gas & Aqua Galon", 40, y, { align: "center" });
    
    y += 8;
    // Garis putus-putus
    doc.setLineDashPattern([1, 1], 0);
    doc.line(5, y, 75, y);
    doc.setLineDashPattern([], 0); // reset
    
    y += 5;
    const now = new Date();
    doc.text(`Tgl : ${now.toLocaleDateString("id-ID")} ${now.toLocaleTimeString("id-ID")}`, 5, y);
    doc.text(`Kasir: Admin`, 75, y, { align: "right" });
    
    y += 4;
    doc.setLineDashPattern([1, 1], 0);
    doc.line(5, y, 75, y);
    doc.setLineDashPattern([], 0); // reset
    
    y += 6;
    
    // Item List
    cart.forEach(item => {
        doc.setFont("helvetica", "bold");
        doc.text(item.kategori, 5, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        const priceText = `${item.qty} x ${item.harga.toLocaleString("id-ID")}`;
        const totalItemText = (item.qty * item.harga).toLocaleString("id-ID");
        doc.text(priceText, 5, y);
        doc.text(totalItemText, 75, y, { align: "right" });
        y += 6;
    });
    
    doc.setLineDashPattern([1, 1], 0);
    doc.line(5, y, 75, y);
    doc.setLineDashPattern([], 0); // reset
    
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Total Tagihan", 5, y);
    doc.setFont("helvetica", "bold");
    doc.text(`Rp ${total.toLocaleString("id-ID")}`, 75, y, { align: "right" });
    
    y += 5;
    if (isKasbon) {
        doc.setFont("helvetica", "bold");
        doc.text("STATUS: KASBON", 5, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.text(`Pelanggan: ${namaPelanggan}`, 5, y);
    } else {
        doc.setFont("helvetica", "normal");
        doc.text("Tunai (Cash)", 5, y);
        doc.text(`Rp ${cash.toLocaleString("id-ID")}`, 75, y, { align: "right" });
        
        y += 5;
        doc.text("Kembalian", 5, y);
        doc.text(`Rp ${kembalian.toLocaleString("id-ID")}`, 75, y, { align: "right" });
    }
    
    y += 8;
    doc.setLineDashPattern([1, 1], 0);
    doc.line(5, y, 75, y);
    doc.setLineDashPattern([], 0); // reset
    
    y += 6;
    doc.setFont("helvetica", "italic");
    doc.text("Terima Kasih!", 40, y, { align: "center" });
    
    // Save PDF
    const filename = `Struk_ADEQUA_${now.getTime()}.pdf`;
    doc.save(filename);
}