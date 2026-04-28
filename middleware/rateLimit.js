const { db } = require('../database/db')

// Gunakan in-memory saja untuk rate limit agar cepat
const limits = new Map()

function checkRateLimit(sender) {
  const now = Date.now()
  const lastHit = limits.get(sender) || 0
  
  if (now - lastHit < 3000) { // 3 detik limit
    return false
  }
  
  limits.set(sender, now)
  return true
}

module.exports = { checkRateLimit }
