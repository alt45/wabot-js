# Wabot-JS

Wabot-JS adalah bot WhatsApp berbasis Node.js yang dibangun menggunakan library Baileys. Bot ini dirancang untuk mengotomatisasi beberapa tugas WhatsApp, termasuk pencatatan pesan, penerusan pesan, penanganan panggilan tak terjawab, dan penyimpanan media.

## Fitur

*   **Pencatatan Pesan:** Mencatat semua pesan masuk (teks, media, lokasi) ke dalam file log (`logs/conversations.log`).
*   **Penerusan Pesan:** Meneruskan pesan dari grup sumber ke grup target, dengan menyertakan informasi pengirim asli (nama atau JID).
*   **Penanganan Panggilan Tak Terjawab:** Secara otomatis merespons panggilan tak terjawab dengan pesan teks yang telah ditentukan.
*   **Penyimpanan Media Otomatis:** Menyimpan gambar, audio, dan dokumen yang diterima ke dalam struktur folder yang terorganisir (`data/img`, `data/voice`, `data/doc`).
*   **Manajemen Proses dengan PM2:** Menggunakan PM2 untuk manajemen proses yang efisien di lingkungan development dan production, termasuk fitur auto-restart dan startup otomatis.

## Prasyarat

Pastikan Anda telah menginstal yang berikut ini di sistem Anda:

*   **Node.js** (versi 16 atau lebih baru direkomendasikan)
*   **npm** (biasanya terinstal bersama Node.js)

## Instalasi

1.  **Clone repositori ini:**
    ```bash
    git clone <URL_REPOSITORI_ANDA>
    cd wabot-js
    ```
    *(Ganti `<URL_REPOSITORI_ANDA>` dengan URL repositori Git Anda.)*

2.  **Instal dependensi proyek:**
    ```bash
    npm install
    ```

3.  **Instal PM2 secara global:**
    ```bash
    npm install pm2 -g
    ```

## Konfigurasi

1.  **Variabel Lingkungan (`.env`)**:
    Buat file `.env` di root proyek Anda (Anda bisa menyalin dari `.env.example`). Isi variabel lingkungan yang diperlukan:
    ```env
    # Contoh isi .env
    LOG_LEVEL=info
    SOURCE_GROUP_ID=1234567890@g.us # Ganti dengan ID grup sumber Anda
    TARGET_GROUP_ID=0987654321@g.us # Ganti dengan ID grup target Anda
    ```
    *   `LOG_LEVEL`: Atur ke `info` untuk log normal, atau `debug` untuk log yang lebih detail (berguna untuk debugging).
    *   `SOURCE_GROUP_ID`: JID (ID WhatsApp) dari grup tempat bot akan mendengarkan pesan untuk diteruskan.
    *   `TARGET_GROUP_ID`: JID (ID WhatsApp) dari grup tempat bot akan meneruskan pesan.

2.  **Konfigurasi PM2 (`ecosystem.config.cjs`)**:
    Pastikan file `ecosystem.config.cjs` Anda sudah ada dan dikonfigurasi dengan benar. Contoh sederhana:
    ```javascript
    module.exports = {
      apps : [{
        name: 'wabot-js',
        script: 'src/app.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
          NODE_ENV: 'development'
        },
        env_production: {
          NODE_ENV: 'production',
        }
      }]
    };
    ```
    *Catatan: File ini sudah diubah ekstensinya menjadi `.cjs` untuk kompatibilitas dengan PM2 dan ES Modules.*

## Penggunaan

### Menjalankan Bot

*   **Mode Development (dengan PM2):**
    ```bash
    npm run dev
    ```
    Ini akan memulai bot menggunakan PM2 dalam mode development.

*   **Mode Production (dengan PM2):**
    ```bash
    npm run prod
    ```
    Ini akan memulai bot menggunakan PM2 dalam mode production.

*   **Langsung (tanpa PM2):**
    ```bash
    npm start
    ```
    Ini akan menjalankan bot secara langsung. Bot akan berhenti jika Anda menutup terminal.

### Mengelola Bot dengan PM2

Setelah bot berjalan dengan `npm run dev` atau `npm run prod`:

*   **Melihat daftar proses PM2:**
    ```bash
    pm2 list
    ```

*   **Melihat log bot secara real-time:**
    ```bash
    pm2 logs wabot-js
    ```

*   **Menghentikan bot:**
    ```bash
    npm run stop
    # Atau secara langsung:
    pm2 stop wabot-js
    ```

*   **Menghapus bot dari PM2:**
    ```bash
    pm2 delete wabot-js
    ```

### Startup Otomatis (Auto-on saat Server Restart)

Untuk membuat bot berjalan otomatis setiap kali server Anda di-restart:

1.  **Buat skrip startup PM2:**
    ```bash
    pm2 startup
    ```
    *Ikuti instruksi yang muncul di terminal. Anda akan diminta untuk menyalin dan menjalankan perintah `sudo` yang dihasilkan.*

2.  **Simpan daftar proses PM2 saat ini:**
    ```bash
    pm2 save
    ```
    Ini akan menyimpan semua proses yang sedang berjalan (termasuk `wabot-js`) sehingga PM2 dapat memulainya kembali secara otomatis saat sistem boot.

## Struktur Proyek

```
.
├── .env                  # Variabel lingkungan
├── .env.example          # Contoh variabel lingkungan
├── .gitignore            # File yang diabaikan oleh Git
├── ecosystem.config.cjs  # Konfigurasi PM2
├── package.json          # Metadata proyek & dependensi
├── auth_info/            # Data otentikasi Baileys (dibuat otomatis)
├── data/                 # Folder untuk menyimpan media
│   ├── img/              # Gambar yang disimpan
│   ├── voice/            # Pesan suara yang disimpan
│   └── doc/              # Dokumen yang disimpan
├── logs/                 # File log bot
│   └── conversations.log # Log percakapan
└── src/                  # Kode sumber aplikasi
    ├── app.js            # Titik masuk utama bot
    ├── core/             # Modul inti (koneksi Baileys, logger, config)
    │   ├── baileys.js
    │   ├── config.js
    │   └── logger.js
    └── features/         # Modul fitur bot
        ├── callHandler.js        # Penanganan panggilan tak terjawab
        ├── messageForwarder.js   # Penerusan pesan
        ├── messageLogger.js      # Pencatatan pesan
        └── mediaSaver.js         # Penyimpanan media
```