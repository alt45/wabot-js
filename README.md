# 🤖 WA-Bot Personal Assistant

Bot WhatsApp berbasis **Baileys** dan **JSON Database** yang dirancang untuk kebutuhan personal, hobi, dan otomasi. Dilengkapi dengan Dashboard Admin modern untuk pengelolaan sistem.

## 🚀 Fitur Utama
- **Self-Bot Mode**: Bot merespon pesan dari nomor sendiri.
- **Admin Dashboard**: UI modern untuk monitoring RAM, Uptime, dan Logs.
- **Data Manager**: Kelola Catatan (Notes) dan Pengingat (Reminders) via Web.
- **API Access**: Kirim dan ambil pesan menggunakan Bearer Token.
- **Status Forwarder**: Otomatis meneruskan Status/Story WA ke grup target.
- **Utilities**: Cek Cuaca, Cek Kuota XL/Axis, dan fitur pengingat waktu.

---

## 🛠️ Instalasi

1. **Persyaratan**: Node.js v18+ (Disarankan v20 LTS).
2. **Clone & Install**:
   ```bash
   npm install
   ```
3. **Konfigurasi**:
   Salin `.env.example` ke `.env` dan isi variabel berikut:
   - `OWNER_NUMBER`: Nomor Anda (contoh: 628123456789).
   - `ADMIN_PASSWORD`: Password login dashboard.
   - `API_TOKEN`: Token untuk akses API eksternal.
   - `WEATHER_API_KEY`: API Key dari OpenWeatherMap.

4. **Jalankan Bot**:
   ```bash
   npm start
   ```

---

## 📱 Command WhatsApp (Prefix: `!`)

### 🌤️ Utilities
- `!menu` / `!help` : Menampilkan daftar menu perintah aktif.
- `!erp <username>` : Tarik data laporan absensi shifting ULP PLN ES secara dinamis berdasarkan tanggal berjalan (contoh: `!erp ULP.TEMANGGUNG`).
- `!cuaca <kota>` : Info cuaca saat ini (contoh: `!cuaca Semarang`).
- `!xl <nomor>` : Cek kuota XL / Axis (contoh: `!xl 08xxxxxxxxx`).

### 🚀 System (Owner Only)
- `!status` : Cek uptime dan penggunaan RAM.
- `!eval <code>` : Menjalankan kode JavaScript langsung.
- `!selfkill` : Logout dan hapus sesi secara permanen.

---

## 🌐 Dashboard Admin
Akses dashboard melalui browser di: `http://localhost:3000`
- **Username**: (Kosongkan)
- **Password**: Sesuai `ADMIN_PASSWORD` di .env

**Fitur Dashboard:**
- Grafik statistik sistem.
- Riwayat log aktifitas real-time.
- Tabel manajemen data (Hapus Notes/Reminders).
- QR Code viewer (jika koneksi terputus).

---

## 🔑 Dokumentasi API (Bearer Token)

Semua endpoint API memerlukan header:
`Authorization: Bearer <YOUR_API_TOKEN>`

### 1. Kirim Pesan
- **Endpoint**: `POST /api/send`
- **Body**:
  ```json
  {
    "number": "628xxxxxx",
    "message": "Halo dari API!"
  }
  ```

### 2. Ambil Riwayat Chat
- **Endpoint**: `GET /api/chat?jid=628xxxx@s.whatsapp.net`

### 3. Cek Statistik
- **Endpoint**: `GET /api/stats`

---

## 🗄️ Database
Bot ini menggunakan **JSON Database** (Pure JavaScript) yang disimpan di `data/db.json`. Tidak memerlukan SQL server atau compiler C++, sehingga sangat ringan dan portabel.

## ⚠️ Keamanan
- Jangan bagikan folder `session/` atau file `.env` kepada siapapun.
- Fitur `!eval` sangat kuat, gunakan hanya untuk kebutuhan debugging Anda sendiri.

---
_Dibuat untuk keperluan Hobi & Personal_ 🚀
