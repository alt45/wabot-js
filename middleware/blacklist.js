const db = require('../database/db')

function isBlacklisted(jid) {
  const list = db.table('blacklist').all()
  return list.some(b => b.jid === jid)
}

module.exports = { isBlacklisted }
