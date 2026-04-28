const cron = require('node-cron')
const db   = require('../database/db')

function initScheduler(sock) {
  // Cek tiap menit
  cron.schedule('* * * * *', async () => {
    const now  = new Date().toISOString()
    const list = db.table('reminders').all().filter(r => !r.done && r.remind_at <= now)

    for (const r of list) {
      try {
        await sock.sendMessage(r.jid, {
          text: `⏰ *REMINDER!*\n\n${r.message}\n\n_Disetel oleh @${r.sender.split('@')[0]}_`,
          mentions: [r.sender]
        })
        
        // Tandai selesai
        db.table('reminders').update(r.id, { done: 1 })
      } catch (e) {
        console.error('[Cron] Gagal kirim reminder:', e.message)
      }
    }
  })
}

module.exports = { initScheduler }
