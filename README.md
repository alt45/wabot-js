# 🤖 WA-Bot Personal Assistant & Transaction Hub

Bot WhatsApp tangguh berbasis **Baileys** dan **JSON Database** yang dirancang untuk kebutuhan personal, utilitas kerja, otomasi absensi, dan transaksi pulsa/paket data. Dilengkapi dengan **Web Admin Dashboard** yang memiliki konsol interaktif modern layaknya WhatsApp Web.

---

## 🚀 Fitur Utama

*   **Self-Bot Mode**: Bot merespon perintah baik dari nomor sendiri (Owner) maupun chat publik secara aman.
*   **Yagami Cell Integration**: Dukungan penuh transaksi pengisian pulsa, kuota data, token listrik, dan cek tagihan dengan asinkron background polling status otomatis langsung dari obrolan WhatsApp.
*   **PLN Portal Shifting Absensi Parser**: Mengambil data laporan absensi shifting ULP secara langsung (scraping) dari Portal PLN ES Amanda secara dinamis.
*   **Premium Interactive Reply Console**: Dashboard Admin web modern dengan fitur *Chat History* interaktif bergaya WhatsApp, mempermudah pemantauan obrolan masuk dan membalas pesan langsung dari browser.
*   **Status WA Story Forwarder**: Otomatis meneruskan postingan Status/Story WhatsApp (baik teks, gambar, maupun video) ke grup target yang ditentukan.
*   **Utilities System**: Pengecekan kuota Sidompul XL/Axis secara terperinci (disertai visual progress bar), serta info cuaca real-time (OpenWeatherMap).
*   **Clean & Lightweight Architecture**: Menggunakan JSON database lokal murni tanpa ketergantungan SQL Server eksternal atau C++ compiler, sehingga sangat ringan dan portabel.

---

## 🛠️ Persyaratan & Instalasi

### 1. Persyaratan Sistem
*   **Node.js**: v18+ (Disarankan v20 LTS).
*   **PM2** (Opsional, untuk pengelolaan proses latar belakang).

### 2. Langkah Instalasi
1.  Unduh/clone repositori ini ke sistem Anda.
2.  Pasang seluruh dependensi proyek:
    ```bash
    npm install
    ```
3.  Salin `.env.example` ke berkas baru `.env` dan konfigurasikan variabel lingkungan Anda.

---

## ⚙️ Konfigurasi Variabel Lingkungan (.env)

Berikut adalah variabel-variabel wajib yang harus Anda konfigurasikan di dalam berkas `.env`:

```env
# ─── WhatsApp Bot Config ───────────────────────────────
BOT_PREFIX=!
OWNER_NUMBER=628xxxxxxxxxx
TARGET_GROUP_ID=120363xxxxxx@g.us

# ─── Dashboard & API Security ──────────────────────────
WEB_PORT=3000
ADMIN_PASSWORD=admin123
API_TOKEN=my-secret-token-123

# ─── Yagami Cell API ────────────────────────────────────
YAGAMI_USERNAME=username_reseller_yagami
YAGAMI_TOKEN=token_api_yagami

# ─── Integrasi API Eksternal ───────────────────────────
WEATHER_API_KEY=your_openweathermap_api_key
DEFAULT_CITY=Semarang
DEBUG=true
```

---

## 📱 Daftar Command WhatsApp (Prefix: `!`)

### ⚡ Transaksi (Yagami Cell)
*   `!yagami` : Menampilkan menu utama dan panduan transaksi Yagami Cell.
*   `!yagami saldo` : Memeriksa sisa saldo aktif pada akun Yagami Cell Anda (otomatis menyinkronkan data lokal).
*   `!yagami listproduk [filter]` : Mencari produk reseller dan melihat ID-nya (contoh: `!yagami listproduk axis 5k`).
*   `!yagami order [id_produk] [nohp] [pembayaran]` : Memesan produk dengan pilihan metode pembayaran (contoh: `!yagami order 71 083812345678 bank_bca`). Default pembayaran: `balance` (saldo). Bot akan merespons instan dan melakukan background polling otomatis hingga transaksi sukses/gagal.
*   `!yagami cek [idtrx]` : Melacak status detail suatu transaksi secara manual kapan saja.

### 🌤️ Utilitas & Kerja
*   `!erp [username_ulp]` : Menarik laporan absensi shifting ULP secara langsung dari Portal PLN ES Amanda berdasarkan tanggal berjalan (contoh: `!erp ULP.TEMANGGUNG`).
*   `!xl [nomor]` : Memeriksa detail sisa kuota dan masa aktif kartu XL / Axis melalui integrasi Sidompul API secara visual.
*   `!cuaca [kota]` : Memeriksa info cuaca terkini (contoh: `!cuaca Semarang`).
*   `!menu` / `!help` : Menampilkan daftar menu bantuan bot.

### 🚀 Sistem (Khusus Owner / Nomor Sendiri)
*   `!status` : Menampilkan uptime bot dan penggunaan RAM saat ini.
*   `!eval [javascript_code]` : Mengeksekusi skrip JavaScript secara langsung untuk keperluan debugging.
*   `!selfkill` : Menghentikan jalannya proses bot, melakukan logout sesi, dan menghapus kredensial sesi secara permanen.

---

## 🌐 Dashboard Admin Web

Akses dashboard web melalui browser di alamat: `http://localhost:3000` (atau port sesuai konfigurasi Anda).

*   **Username**: (Biarkan kosong)
*   **Password**: Isi sesuai dengan `ADMIN_PASSWORD` pada `.env`.

### **Fitur Dashboard:**
1.  **Status Live Panel**: Grafik penggunaan memori/RAM dan uptime proses bot.
2.  **WhatsApp Chat Room Console**: Membaca riwayat pesan masuk dan keluar lengkap dengan antarmuka dinamis, serta membalas pesan langsung ke WhatsApp melalui dashboard.
3.  **Real-time Process Logs**: Konsol logger warna-warni untuk memantau aktivitas proses sistem bot secara instan.
4.  **QR Code Viewer**: Menampilkan kode QR secara real-time jika bot terputus dari WhatsApp.

---

## 🗄️ Database & Keamanan

*   **Penyimpanan Lokal**: Bot ini menggunakan basis data JSON JavaScript murni di dalam `data/db.json` untuk mencatat riwayat obrolan masuk/keluar secara instan.
*   **Keamanan Ekstra**: Jangan pernah membagikan berkas `.env` atau folder `session/` kepada pihak asing karena berisi token otentikasi WhatsApp dan API transaksi Yagami Cell Anda.
