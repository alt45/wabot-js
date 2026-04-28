const config = require('../config')
const p = config.PREFIX

function getHelp() {
  return `╔══════════════════════╗
  🤖 *WA-BOT ASSISTANT*
╚══════════════════════╝

⏰ *REMINDER (PENGINGAT)*
  ${p}remind <waktu> <pesan>
  Contoh: ${p}remind 1j Beli kopi
  Waktu: s (detik), m (menit), j (jam)
  ${p}reminders → lihat daftar aktif

📝 *NOTES (CATATAN)*
  ${p}catat Judul | Isi → simpan
  ${p}catatan → daftar semua judul
  ${p}lihat <id> → baca detail isi
  ${p}hapusnote <id> → hapus catatan

🌤️ *UTILITIES*
  ${p}cuaca <kota> → info cuaca
  ${p}xl <nomor> → cek kuota XL/Axis
  ${p}menu / ${p}help → daftar perintah

🚀 *SYSTEM (OWNER ONLY)*
  ${p}status → cek uptime & ram bot
  ${p}eval <code> → eksekusi javascript
  ${p}selfkill → logout & hapus sesi

━━━━━━━━━━━━━━━━━━━━━━
🌐 *DASHBOARD ADMIN*
http://localhost:${config.WEB_PORT}
━━━━━━━━━━━━━━━━━━━━━━
_Bot aktif & siap membantu!_ 🚀`
}

module.exports = { getHelp }
