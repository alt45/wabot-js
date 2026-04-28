const db = require('../database/db')

function addReminder(jid, sender, args) {
  if (args.length < 2) return '⚠️ Format: *!remind 30m Makan siang*'
  
  const timeStr = args.shift().toLowerCase()
  const message = args.join(' ')
  
  let ms = 0
  const match = timeStr.match(/(\d+)([smj])/)
  if (!match) return '⚠️ Waktu tidak valid. Contoh: 10m, 1j, 30s'
  
  const val = parseInt(match[1])
  const unit = match[2]
  
  if (unit === 's') ms = val * 1000
  if (unit === 'm') ms = val * 60 * 1000
  if (unit === 'j') ms = val * 3600 * 1000
  
  const remindAt = new Date(Date.now() + ms).toISOString()
  
  const item = db.table('reminders').insert({
    jid,
    sender,
    message,
    remind_at: remindAt,
    done: 0
  })
  
  return `✅ Reminder disetel untuk *${timeStr}* lagi.\n🆔 ID: *${item.id}*`
}

function listReminders(jid, sender) {
  const list = db.table('reminders').all().filter(r => !r.done)
  if (list.length === 0) return '📭 Tidak ada reminder aktif.'
  
  let text = '⏰ *REMINDER AKTIF*\n\n'
  list.forEach((r, i) => {
    const t = new Date(r.remind_at).toLocaleString('id-ID')
    text += `${i + 1}. [${r.id}] ${r.message}\n   🕒 ${t}\n`
  })
  return text
}

module.exports = { addReminder, listReminders }
