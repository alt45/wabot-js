const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const { db }     = require('../database/db')
const config = require('../config')

const logStatus = db.prepare(`
  INSERT INTO status_log (sender, type, caption)
  VALUES (?, ?, ?)
`)

async function handleStatus(sock, msg) {
  if (!config.TARGET_GROUP_ID) return

  try {
    const sender  = msg.key?.participant || msg.key?.remoteJid || 'unknown'
    const msgType = Object.keys(msg.message || {})[0]

    // Tipe yang didukung
    const supported = ['imageMessage', 'videoMessage', 'extendedTextMessage', 'conversation']
    if (!supported.includes(msgType)) return

    const targetJid = config.TARGET_GROUP_ID

    // ── Teks / caption saja
    if (msgType === 'conversation' || msgType === 'extendedTextMessage') {
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || ''

      if (!text) return

      const caption = `📢 *Status dari* @${sender.split('@')[0]}\n\n${text}`

      await sock.sendMessage(targetJid, {
        text:             caption,
        mentions:         [sender],
        contextInfo: {
          mentionedJid: [sender]
        }
      })

      logStatus.run(sender, 'text', text)
      return
    }

    // ── Gambar / Video — download dulu lalu kirim
    const buffer  = await downloadMediaMessage(msg, 'buffer', {})
    const caption = msg.message?.[msgType]?.caption || ''
    const label   = `📢 *Status dari* @${sender.split('@')[0]}${caption ? '\n\n' + caption : ''}`

    if (msgType === 'imageMessage') {
      await sock.sendMessage(targetJid, {
        image:    buffer,
        caption:  label,
        mentions: [sender]
      })
      logStatus.run(sender, 'image', caption)
    }

    if (msgType === 'videoMessage') {
      await sock.sendMessage(targetJid, {
        video:    buffer,
        caption:  label,
        mentions: [sender]
      })
      logStatus.run(sender, 'video', caption)
    }

  } catch (e) {
    console.error('[StatusForwarder] Error:', e.message)
  }
}

module.exports = { handleStatus }
