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
const groupLogDB     = new JsonDB(path.join(__dirname, 'data', 'group_messages.json'))
const groupNameCache = new Map()

const { checkRateLimit }   = require('./middleware/rateLimit')
const { isBlacklisted }    = require('./middleware/blacklist')
const { logActivity }      = require('./logger/activityLog')
const { initScheduler }    = require('./scheduler/cronJobs')
const { createServer, setConnected, setSocket } = require('./web/server')

const { addReminder, listReminders } = require('./handlers/reminder')
const { addNote, listNotes, getNote, deleteNote } = require('./handlers/notes')
const { getWeather }     = require('./handlers/weather')
const { cekKuotaXL }     = require('./handlers/xlKuota')
const { handleStatus }   = require('./handlers/statusForwarder')
const { getHelp }        = require('./handlers/help')

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
      console.log(`📱 QR tersimpan. Buka: http://localhost:${config.WEB_PORT}`)
    }

    if (connection === 'open') {
      setConnected(true)
      if (fs.existsSync(QR_PATH)) fs.unlinkSync(QR_PATH)
      console.log('✅ Bot terhubung ke WhatsApp!')
    }

    if (connection === 'close') {
      setConnected(false)
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : null

      if (code === DisconnectReason.loggedOut) {
        console.log('🚪 Logged out. Hapus folder session/ lalu restart.')
      } else {
        console.log('🔄 Koneksi terputus, reconnect dalam 3 detik...')
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
        console.log(`[DEBUG] Chat aktif di Grup: ${groupName} (${jid})`)
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

      // Simpan ke history chat grup jika terdaftar di config
      if (isGroup && config.TARGET_GROUP_ID.includes(jid)) {
        // Ambil nama grup
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

        // Simpan Teks/Caption
        if (body) {
          groupLogDB.table('chats').insert({ jid, groupName, message: body, sender, timestamp: new Date().toISOString() })
        }

        // Tangani Gambar
        const msgType = Object.keys(msg.message || {})[0]
        if (msgType === 'imageMessage') {
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {})
            const safeGroupName = groupName.replace(/[\\/:*?"<>|]/g, '_')
            const mediaDir = path.join(__dirname, 'data', 'media', safeGroupName)
            
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })
            
            const fileName = `${Date.now()}.jpg`
            const filePath = path.join(mediaDir, fileName)
            
            fs.writeFileSync(filePath, buffer)
            
            groupLogDB.table('chats').insert({ 
              jid, 
              groupName, 
              message: `[Image: ${fileName}]`, 
              sender, 
              mediaPath: filePath,
              timestamp: new Date().toISOString() 
            })
            
            if (config.DEBUG) console.log(`[DEBUG] Gambar grup ${groupName} disimpan: ${filePath}`)
          } catch (err) {
            console.error(`[Error] Gagal simpan gambar grup ${groupName}:`, err.message)
          }
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

          // ── Reminder
          case 'remind':
          case 'reminder': {
            const text = addReminder(jid, sender, args)
            await reply(sock, jid, msg, text)
            break
          }
          case 'reminders': {
            const text = listReminders(jid, sender)
            await reply(sock, jid, msg, text)
            break
          }

          // ── Notes
          case 'catat': {
            const text = addNote(jid, sender, args)
            await reply(sock, jid, msg, text)
            break
          }
          case 'catatan': {
            const text = listNotes(jid, sender)
            await reply(sock, jid, msg, text)
            break
          }
          case 'lihat': {
            const text = getNote(jid, sender, args)
            await reply(sock, jid, msg, text)
            break
          }
          case 'hapusnote': {
            const text = deleteNote(jid, sender, args)
            await reply(sock, jid, msg, text)
            break
          }

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
        console.error(`[Command:${command}] Error:`, e.message)
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
}

startBot().catch(console.error)
