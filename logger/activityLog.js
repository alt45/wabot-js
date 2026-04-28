const db = require('../database/db')

function logActivity(jid, sender, command, fullText) {
  db.table('activity_log').insert({
    jid,
    sender,
    command,
    full_text: fullText
  })
}

module.exports = { logActivity }
