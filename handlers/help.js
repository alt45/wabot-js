const config = require('../config')
const p = config.PREFIX

function getHelp() {
  return `╔══════════════════════╗
🤖 *WA-BOT ASSISTANT*
╚══════════════════════╝

🌤️ *UTILITIES*
  ${p}erp <username> → cek absen shifting ULP
  ${p}cuaca <kota> → info cuaca
  ${p}xl <nomor> → cek kuota XL/Axis
  ${p}yagami → menu transaksi Yagami Cell
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
