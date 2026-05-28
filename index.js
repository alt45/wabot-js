require('dotenv').config()

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys')

const { Boom }   = require('@hapi/boom')
const qrcode     = require('qrcode')
const pino       = require('pino')
const path       = require('path')
const fs         = require('fs')

const config     = require('./config')
const { db, JsonDB } = require('./database/db')
// Database groupLogDB telah disatukan ke db utama
const groupNameCache = new Map()

const { checkRateLimit }   = require('./middleware/rateLimit')
const { isBlacklisted }    = require('./middleware/blacklist')
const { logActivity }      = require('./logger/activityLog')
const { initScheduler }    = require('./scheduler/cronJobs')
const { createServer, setConnected, setSocket } = require('./web/server')

// Impor reminder dan notes telah dihapus
const { getWeather }     = require('./handlers/weather')
const { cekKuotaXL }     = require('./handlers/xlKuota')
const { handleStatus }   = require('./handlers/statusForwarder')
const { getHelp }        = require('./handlers/help')
const { getErpReport }   = require('./handlers/erpAmanda')
const { handleYagamiCommand } = require('./handlers/yagami')
const log                = require('./logger/debugLogger')

const SESSION_DIR = path.join(__dirname, 'session')
const QR_PATH     = path.join(SESSION_DIR, 'qr.png')

// Pastikan folder session ada
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true })

// Jalankan web server (Dashboard)
createServer()

// ── Main Bot ─────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds }    = await useMultiFileAuthState(SESSION_DIR)
  const { version }             = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth:               state,
    logger:             pino({ level: 'silent' }),
    printQRInTerminal:  false,
    browser:            ['WA-Bot', 'Chrome', '120.0.0'],
    syncFullHistory:    false
  })

  initScheduler(sock)
  setSocket(sock)

  // ── Connection update ───────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {

    if (qr) {
      await qrcode.toFile(QR_PATH, qr, {
        color: { dark: '#000000', light: '#ffffff' },
        width: 512,
        margin: 2
      })
      setConnected(false)
      log.socket(`QR Code baru dibuat. Pindai di: http://localhost:${config.WEB_PORT}`)
    }

    if (connection === 'open') {
      setConnected(true)
      if (fs.existsSync(QR_PATH)) fs.unlinkSync(QR_PATH)
      log.success('Bot berhasil terhubung dan aktif di WhatsApp!')
    }

    if (connection === 'close') {
      setConnected(false)
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null

      if (code === DisconnectReason.loggedOut) {
        log.error('SOCKET', 'Koneksi Logged Out! Silakan hapus folder session/ lalu restart bot.')
      } else {
        log.warn('Koneksi terputus. Menghubungkan kembali dalam 3 detik...')
        setTimeout(startBot, 3000)
      }
    }
  })

  // ── Simpan credentials ──────────────────────────────────
  sock.ev.on('creds.update', saveCreds)

  // ── Pesan masuk ─────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      const jid     = msg.key?.remoteJid
      const isGroup = jid?.endsWith('@g.us')
      const sender  = msg.key?.participant || msg.key?.remoteJid || ''
      const isMe    = msg.key?.fromMe

      if (!jid) continue

      // ── Debug: Print Group Name ────────────────────────
      if (config.DEBUG && isGroup) {
        let groupName = groupNameCache.get(jid)
        if (!groupName) {
          try {
            const metadata = await sock.groupMetadata(jid)
            groupName = metadata.subject
            groupNameCache.set(jid, groupName)
          } catch (e) {
            groupName = 'Unknown Group'
          }
        }
        log.debug('group', `Chat aktif di Grup: ${groupName} (${jid})`)
      }

      // ── Status WA (stories) → forward ke grup target
      if (jid === 'status@broadcast') {
        await handleStatus(sock, msg)
        continue
      }

      // Ambil teks pesan
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || ''

      // Ambil data pengirim & grup
      let groupName = ''
      if (isGroup) {
        groupName = groupNameCache.get(jid)
        if (!groupName) {
          try {
            const metadata = await sock.groupMetadata(jid)
            groupName = metadata.subject
            groupNameCache.set(jid, groupName)
          } catch (e) {
            groupName = 'Unknown Group'
          }
        }
      }

      const senderName = msg.pushName || ''

      // Simpan Teks/Caption ke database utama
      if (body) {
        db.table('chats').insert({ 
          jid, 
          groupName, 
          sender, 
          senderName, 
          message: body, 
          direction: 'in', 
          timestamp: new Date().toISOString() 
        })
        log.debug('chat', `Teks masuk dari ${senderName || sender}${isGroup ? ` @ ${groupName}` : ''}: "${body}"`)
      }

      // Tangani Gambar untuk semua chat
      const msgType = Object.keys(msg.message || {})[0]
      if (msgType === 'imageMessage') {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {})
          const mediaDir = path.join(__dirname, 'data', 'media')
          
          if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })
          
          const fileName = `${Date.now()}.jpg`
          const filePath = path.join(mediaDir, fileName)
          
          fs.writeFileSync(filePath, buffer)
          
          db.table('chats').insert({ 
            jid, 
            groupName, 
            sender, 
            senderName, 
            message: `[Image: ${fileName}]`, 
            mediaPath: filePath,
            direction: 'in', 
            timestamp: new Date().toISOString() 
          })
          
          log.debug('media', `Gambar grup/pribadi disimpan di: ${filePath}`)
        } catch (err) {
          log.error('media', `Gagal mengunduh/menyimpan gambar:`, err)
        }
      }

      if (!body.startsWith(config.PREFIX)) continue

      // Jika bukan pesan sendiri, cek blacklist dan rate limit
      if (!isMe) {
        if (isBlacklisted(sender)) continue
        if (!checkRateLimit(sender)) {
          await reply(sock, jid, msg, '⚠️ Terlalu cepat! Tunggu beberapa detik.')
          continue
        }
      }

      // Parse command
      const args    = body.slice(config.PREFIX.length).trim().split(/\s+/)
      const command = args.shift().toLowerCase()
      const isOwner = (config.OWNER_NUMBER && sender.startsWith(config.OWNER_NUMBER)) || isMe

      // Log aktivitas
      logActivity(jid, sender, command, body)
      log.command(command, sender, body)

      // ── Command router ──────────────────────────────────
      try {
        switch (command) {

          case 'ping':
          case 'status': {
            const uptime = process.uptime()
            const hours  = Math.floor(uptime / 3600)
            const mins   = Math.floor((uptime % 3600) / 60)
            const secs   = Math.floor(uptime % 60)
            const ram    = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
            
            let text = `🚀 *Bot Status*\n\n`
            text += `⏱️ *Uptime:* ${hours}j ${mins}m ${secs}s\n`
            text += `💾 *RAM:* ${ram} MB\n`
            text += `👤 *User:* ${isOwner ? 'Owner' : 'Public'}`
            await reply(sock, jid, msg, text)
            break
          }

          case 'eval': {
            if (!isOwner) return
            const code = args.join(' ')
            if (!code) return
            try {
              let evaled = await eval(code)
              if (typeof evaled !== 'string') evaled = require('util').inspect(evaled)
              await reply(sock, jid, msg, `✅ *Result:*\n\n\`\`\`${evaled}\`\`\``)
            } catch (err) {
              await reply(sock, jid, msg, `❌ *Error:*\n\n\`\`\`${err.message}\`\`\``)
            }
            break
          }

          case 'selfkill': {
            if (!isOwner) return
            await reply(sock, jid, msg, '💀 *Self-kill diaktifkan. Menghapus sesi dan mematikan bot...*')
            
            // Beri jeda sebentar agar pesan terkirim
            setTimeout(async () => {
              try {
                await sock.logout() // Logout dari server WA
              } catch (e) {
                // Jika gagal logout via socket, kita paksa hapus folder
              }
              
              if (fs.existsSync(SESSION_DIR)) {
                fs.rmSync(SESSION_DIR, { recursive: true, force: true })
              }
              
              console.log('🛑 Bot dimatikan oleh Owner. Sesi dihapus.')
              process.exit(0)
            }, 3000)
            break
          }

          // Layanan pengingat dan catatan telah dihapus

          // ── Cuaca
          case 'cuaca':
          case 'weather': {
            await reply(sock, jid, msg, '⏳ Mengambil data cuaca...')
            const text = await getWeather(args)
            await reply(sock, jid, msg, text)
            break
          }

          // ── Cek Kuota XL
          case 'xl':
          case 'kuota': {
            if (!args[0]) {
              await reply(sock, jid, msg, '⚠️ Format: *!xl 08xxxxxxxxxx*')
              break
            }
            await reply(sock, jid, msg, '⏳ Mengecek kuota...')
            const text = await cekKuotaXL(args[0])
            await reply(sock, jid, msg, text)
            break
          }

          // ── Cek Absensi ERP Amanda
          case 'erp': {
            if (!args[0]) {
              await reply(sock, jid, msg, '⚠️ Format: *!erp [username_ulp]*\nContoh: *!erp ULP.TEMANGGUNG*')
              break
            }
            await reply(sock, jid, msg, '⏳ Menghubungi Portal PLN ES, mohon tunggu...')
            try {
              const reports = await getErpReport(args[0])
              for (const r of reports) {
                await reply(sock, jid, msg, r)
              }
            } catch (e) {
              await reply(sock, jid, msg, `❌ Gagal mengambil data ERP: ${e.message}`)
            }
            break
          }

          // ── Yagami Cell
          case 'yagami': {
            await handleYagamiCommand(sock, jid, msg, args)
            break
          }

          // ── Help
          case 'help':
          case 'menu': {
            await reply(sock, jid, msg, getHelp())
            break
          }

          default:
            // Command tidak dikenal — diam saja
            break
        }
      } catch (e) {
        log.error('command:' + command, `Error saat memproses perintah: ${e.message}`, e)
        await reply(sock, jid, msg, `❌ Error: ${e.message}`)
      }
    }
  })

  return sock
}

// ── Helper: reply ke pesan ──────────────────────────────
async function reply(sock, jid, msg, text) {
  await sock.sendMessage(jid, {
    text,
    contextInfo: {
      stanzaId:     msg.key.id,
      participant:  msg.key.participant || msg.key.remoteJid,
      quotedMessage: msg.message
    }
  })

  // Simpan respon otomatis bot ke database agar riwayat room obrolan utuh
  try {
    let groupName = ''
    const isGroup = jid.endsWith('@g.us')
    if (isGroup) {
      groupName = groupNameCache.get(jid) || 'Group'
    }
    db.table('chats').insert({
      jid,
      groupName,
      sender: 'Me',
      senderName: 'Bot',
      message: text,
      direction: 'out',
      timestamp: new Date().toISOString()
    })
  } catch (e) {
    log.error('reply_log', 'Gagal menyimpan log respon bot:', e)
  }
}

startBot().catch(err => log.error('bot', 'Gagal menjalankan startBot:', err))
