const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const config = require('../config')
const { db }     = require('../database/db')
const log    = require('../logger/debugLogger')

const QR_PATH = path.join(__dirname, '..', 'session', 'qr.png')
const SESSION_DIR = path.join(__dirname, '..', 'session')

let _isConnected = false
let _startTime   = Date.now()
let _sock        = null

function setConnected(val) { _isConnected = val }
function setSocket(sock)   { _sock = sock }

function createServer() {
  const server = http.createServer(async (req, res) => {
    const startRequestTime = Date.now()
    const url = req.url?.split('?')[0]
    const method = req.method
    const cookies = parseCookies(req)

    res.on('finish', () => {
      const duration = Date.now() - startRequestTime
      // Sembunyikan polling status statis agar log tidak penuh di terminal
      if (url === '/api/stats' || url === '/api/public-status') return
      log.web(method, url, res.statusCode, duration)
    })

    const sendJSON = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }

    // ── Auth Logic ──
    const authHeader = req.headers.authorization
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null
    const isApiAuthorized = bearerToken === config.API_TOKEN
    const isDashboardAuthorized = cookies.admin_token === config.ADMIN_PASSWORD
    const isAuthenticated = isDashboardAuthorized || isApiAuthorized

    // ── Public API (No Auth) ──
    if (url === '/api/public-status') {
      return sendJSON({
        connected: _isConnected,
        uptime: Math.floor((Date.now() - _startTime) / 1000),
        qr_ready: fs.existsSync(QR_PATH)
      })
    }

    // ── Public Routes (Login/Logout/Assets) ──
    if (url === '/login' && method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        const params = new URLSearchParams(body)
        if (params.get('password') === config.ADMIN_PASSWORD) {
          res.writeHead(302, { 'Set-Cookie': `admin_token=${config.ADMIN_PASSWORD}; Path=/; HttpOnly`, 'Location': '/' })
          res.end()
        } else {
          res.writeHead(302, { 'Location': '/?error=1' })
          res.end()
        }
      })
      return
    }

    if (url === '/logout') {
      res.writeHead(302, { 'Set-Cookie': 'admin_token=; Path=/; Max-Age=0', 'Location': '/' })
      res.end()
      return
    }

    if (url === '/qr.png') {
      // QR hanya boleh dilihat jika sudah auth ATAU bot sedang disconnected (untuk pairing)
      if (!fs.existsSync(QR_PATH)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'image/png' })
      fs.createReadStream(QR_PATH).pipe(res)
      return
    }

    // ── Route Logic ──
    if (!isAuthenticated) {
      if (url.startsWith('/api/')) return sendJSON({ error: 'Unauthorized' }, 401)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getPublicHTML())
      return
    }

    // ── Protected API Endpoints ──
    if (url.startsWith('/api/')) {
      if (url === '/api/stats') {
        const counts = {
          chats: db.table('chats').count(),
          blacklist: db.table('blacklist').count()
        }
        return sendJSON({ connected: _isConnected, uptime: Math.floor((Date.now() - _startTime)/1000), ram: (process.memoryUsage().heapUsed/1024/1024).toFixed(2), counts, qr_ready: fs.existsSync(QR_PATH) })
      }
      
      if (url === '/api/chat' && method === 'GET') {
        const queryJid = new URL(req.url, `http://${req.headers.host}`).searchParams.get('jid')
        const allChats = db.table('chats').all()
        if (queryJid) {
          return sendJSON(allChats.filter(c => c.jid === queryJid))
        }
        return sendJSON(allChats)
      }

      if (url.startsWith('/api/media')) {
        const queryPath = new URL(req.url, `http://${req.headers.host}`).searchParams.get('path')
        if (!queryPath) { res.writeHead(400); res.end('Missing path'); return }
        const resolvedPath = path.resolve(queryPath)
        const mediaBaseDir = path.resolve(path.join(__dirname, '..', 'data', 'media'))
        if (!resolvedPath.startsWith(mediaBaseDir)) {
          res.writeHead(403); res.end('Forbidden'); return
        }
        if (!fs.existsSync(resolvedPath)) { res.writeHead(404); res.end('Not found'); return }
        res.writeHead(200, { 'Content-Type': 'image/jpeg' })
        fs.createReadStream(resolvedPath).pipe(res)
        return
      }
      
      if (url === '/api/data' && method === 'GET') {
        let type = new URL(req.url, `http://${req.headers.host}`).searchParams.get('type')
        if (type === 'logs') type = 'activity_log'
        return sendJSON(db.table(type || 'chats').latest(100))
      }

      if (url === '/api/data/delete' && method === 'POST') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          const { type, id } = JSON.parse(body)
          db.table(type).delete(id)
          sendJSON({ success: true })
        })
        return
      }

      if (url.startsWith('/api/action/')) {
        const act = url.split('/').pop()
        sendJSON({ success: true })
        if (act === 'restart') setTimeout(() => process.exit(0), 1000)
        if (act === 'selfkill') setTimeout(() => { if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true }); process.exit(0) }, 1000)
        return
      }
      
      if (url === '/api/send' && method === 'POST') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
          try {
            const { number, message } = JSON.parse(body)
            const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`
            await _sock.sendMessage(jid, { text: message })
            db.table('chats').insert({ 
              jid, 
              groupName: jid.endsWith('@g.us') ? 'Group' : '', 
              sender: 'Me', 
              senderName: 'Admin', 
              message, 
              direction: 'out', 
              timestamp: new Date().toISOString() 
            })
            sendJSON({ success: true })
          } catch (e) { sendJSON({ error: e.message }, 500) }
        })
        return
      }
    }

    // ── Admin Dashboard ──
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getAdminHTML())
      return
    }

    res.writeHead(404); res.end('Not found')
  })

  server.listen(config.WEB_PORT, () => {
    log.system(`Web Server/Dashboard aktif di: http://localhost:${config.WEB_PORT}`)
  })
}

function parseCookies(req) {
  const list = {}
  const rc = req.headers.cookie
  rc && rc.split(';').forEach(cookie => {
    const parts = cookie.split('=')
    list[parts.shift().trim()] = decodeURI(parts.join('='))
  })
  return list
}

// ── UI: PUBLIC PAGE (Server Status + Hidden Login) ──
function getPublicHTML() {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>System Status</title>
  <style>
    :root { --bg: #0b0e14; --text: #c9d1d9; --accent: #238636; }
    body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }
    .monitor { text-align: center; }
    .pulse { width: 120px; height: 120px; background: rgba(35, 134, 54, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 30px; position: relative; cursor: pointer; }
    .pulse::after { content: ''; width: 100%; height: 100%; border: 2px solid var(--accent); border-radius: 50%; position: absolute; animation: wave 2s infinite; }
    .dot { width: 20px; height: 20px; background: var(--accent); border-radius: 50%; }
    h1 { font-size: 1.5rem; margin: 10px 0; letter-spacing: 1px; }
    .uptime { font-family: monospace; color: #8b949e; font-size: 14px; }
    #login-form { display: none; margin-top: 20px; animation: fadeIn 0.5s; }
    input { background: #0d1117; border: 1px solid #30363d; color: #fff; padding: 10px; border-radius: 6px; outline: none; text-align: center; }
    @keyframes wave { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .offline { --accent: #da3633; }
  </style></head>
  <body>
    <div class="monitor">
      <div class="pulse" id="status-pulse" onclick="showLogin()"><div class="dot"></div></div>
      <h1 id="status-text">SYSTEM ONLINE</h1>
      <p class="uptime" id="status-uptime">Uptime: 00:00:00</p>
      
      <div id="login-form">
        <form action="/login" method="POST">
          <input type="password" name="password" placeholder="Enter Token" autofocus>
        </form>
      </div>
    </div>
    <script>
      async function update() {
        try {
          const res = await fetch('/api/public-status');
          const data = await res.json();
          const pulse = document.getElementById('status-pulse');
          const text = document.getElementById('status-text');
          
          if (data.connected) {
            pulse.classList.remove('offline');
            text.innerText = 'SYSTEM OPERATIONAL';
          } else {
            pulse.classList.add('offline');
            text.innerText = data.qr_ready ? 'WAITING FOR PAIRING' : 'SYSTEM OFFLINE';
          }
          
          const s = data.uptime;
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const secs = s % 60;
          document.getElementById('status-uptime').innerText = \`Uptime: \${h}h \${m}m \${secs}s\`;
        } catch(e) {}
      }
      function showLogin() {
        const f = document.getElementById('login-form');
        f.style.display = f.style.display === 'block' ? 'none' : 'block';
        if(f.style.display === 'block') f.querySelector('input').focus();
      }
      setInterval(update, 2000);
      update();
    </script>
  </body></html>`
}

function getAdminHTML() {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>WA-Bot Admin Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { 
            --bg: #080c14; 
            --card: #111827; 
            --card-glass: rgba(17, 24, 39, 0.7);
            --border: rgba(255, 255, 255, 0.08); 
            --text: #f3f4f6; 
            --text-dim: #9ca3af; 
            --primary: #10b981; 
            --primary-glow: rgba(16, 185, 129, 0.3);
            --danger: #ef4444; 
            --accent: #3b82f6; 
            --sidebar-width: 280px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
        
        body { 
            background: radial-gradient(circle at 50% 50%, #0f172a 0%, var(--bg) 100%); 
            color: var(--text); 
            line-height: 1.6; 
            height: 100vh; 
            overflow: hidden; 
            display: flex;
        }

        /* ── Sidebar Navigation ── */
        .sidebar {
            width: var(--sidebar-width);
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(16px);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 30px 20px;
            z-index: 10;
        }
        .logo-area {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 40px;
            padding-left: 10px;
        }
        .logo-icon {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 20px var(--primary-glow);
        }
        .logo-title {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.5px;
            background: linear-gradient(to right, #fff, #9ca3af);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .nav-menu {
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex: 1;
        }
        .nav-item {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 12px 18px;
            border-radius: 12px;
            cursor: pointer;
            color: var(--text-dim);
            font-weight: 500;
            font-size: 15px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border: 1px solid transparent;
        }
        .nav-item:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.03);
        }
        .nav-item.active {
            color: #fff;
            background: rgba(16, 185, 129, 0.1);
            border-color: rgba(16, 185, 129, 0.25);
            box-shadow: inset 0 0 12px rgba(16, 185, 129, 0.05);
        }
        .nav-item svg {
            width: 20px;
            height: 20px;
            transition: transform 0.3s;
        }
        .nav-item.active svg {
            color: var(--primary);
            transform: scale(1.05);
        }
        .sidebar-footer {
            margin-top: auto;
            border-top: 1px solid var(--border);
            padding-top: 20px;
        }
        .logout-btn {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 12px 18px;
            border-radius: 12px;
            color: #fca5a5;
            text-decoration: none;
            font-size: 15px;
            font-weight: 500;
            transition: all 0.3s;
        }
        .logout-btn:hover {
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
        }

        /* ── Main Workspace ── */
        .workspace {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
            background: transparent;
        }
        .top-bar {
            height: 80px;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 40px;
            background: rgba(15, 23, 42, 0.3);
            backdrop-filter: blur(10px);
        }
        .top-title {
            font-size: 20px;
            font-weight: 600;
        }
        .bot-status-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border);
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }
        .status-dot.online {
            background: var(--primary);
            box-shadow: 0 0 10px var(--primary);
            animation: pulse 2s infinite;
        }
        .status-dot.offline {
            background: var(--danger);
            box-shadow: 0 0 10px var(--danger);
        }

        /* ── Tabs Content ── */
        .content {
            flex: 1;
            padding: 40px;
            overflow-y: auto;
            display: none;
            animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .content.active {
            display: block;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.5; }
        }

        /* ── Grid System (Dashboard) ── */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 25px;
            margin-bottom: 40px;
        }
        .card {
            background: var(--card-glass);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 24px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
            transition: transform 0.3s, border-color 0.3s;
        }
        .card:hover {
            transform: translateY(-2px);
            border-color: rgba(255, 255, 255, 0.15);
        }
        .card-header-flex {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .card-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .card-value {
            font-size: 32px;
            font-weight: 700;
            color: #fff;
        }
        .card-icon {
            opacity: 0.7;
            color: var(--primary);
        }

        /* ── Control Box ── */
        .control-box {
            background: var(--card-glass);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 30px;
            backdrop-filter: blur(10px);
            margin-bottom: 30px;
        }
        .section-header {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .qr-box {
            max-width: 240px;
            margin: 25px 0;
            background: #fff;
            padding: 12px;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            display: none;
            animation: pulseQR 2s infinite ease-in-out;
        }
        @keyframes pulseQR {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
        }
        .actions-flex {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        .btn {
            padding: 12px 24px;
            border-radius: 12px;
            border: 1px solid var(--border);
            background: rgba(255, 255, 255, 0.05);
            color: var(--text);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .btn:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
        }
        .btn-primary {
            background: var(--primary);
            color: #000;
            border: none;
        }
        .btn-primary:hover {
            background: #059669;
            box-shadow: 0 0 15px var(--primary-glow);
        }
        .btn-danger {
            color: #f87171;
            border-color: rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.05);
        }
        .btn-danger:hover {
            background: rgba(239, 68, 68, 0.15);
            border-color: #ef4444;
            color: #fff;
        }

        /* ── Logs View ── */
        .table-container {
            background: var(--card-glass);
            border: 1px solid var(--border);
            border-radius: 20px;
            overflow: hidden;
            backdrop-filter: blur(10px);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        th {
            text-align: left;
            padding: 16px 24px;
            background: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid var(--border);
            color: var(--text-dim);
            font-weight: 600;
        }
        td {
            padding: 16px 24px;
            border-bottom: 1px solid var(--border);
            color: var(--text);
        }
        tr:last-child td {
            border-bottom: none;
        }
        tr:hover td {
            background: rgba(255, 255, 255, 0.01);
        }

        /* ── CHAT SCREEN (WhatsApp Style) ── */
        .chat-container {
            display: flex;
            height: calc(100vh - 160px);
            border: 1px solid var(--border);
            background: rgba(11, 15, 24, 0.8);
            border-radius: 24px;
            overflow: hidden;
            backdrop-filter: blur(20px);
        }
        /* Left sidebar */
        .chat-sidebar {
            width: 320px;
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            background: rgba(17, 24, 39, 0.4);
        }
        .search-container {
            padding: 15px;
            border-bottom: 1px solid var(--border);
        }
        .search-input {
            width: 100%;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--border);
            padding: 10px 15px;
            border-radius: 12px;
            color: #fff;
            font-size: 14px;
            outline: none;
            transition: all 0.3s;
        }
        .search-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
            background: rgba(255, 255, 255, 0.08);
        }
        .room-list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .room-item {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 16px 20px;
            cursor: pointer;
            transition: all 0.25s;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }
        .room-item:hover {
            background: rgba(255, 255, 255, 0.03);
        }
        .room-item.active {
            background: rgba(16, 185, 129, 0.08);
            border-right: 3px solid var(--primary);
        }
        .avatar {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 16px;
            color: #fff;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        }
        .room-info {
            flex: 1;
            min-width: 0;
        }
        .room-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 4px;
        }
        .room-name {
            font-weight: 600;
            font-size: 14px;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .room-time {
            font-size: 11px;
            color: var(--text-dim);
            white-space: nowrap;
        }
        .room-preview {
            font-size: 13px;
            color: var(--text-dim);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .chat-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 600;
        }
        .badge-group { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
        .badge-private { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }

        /* Right window */
        .chat-window {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #090e17 url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png') repeat;
            background-blend-mode: overlay;
            background-color: rgba(9, 14, 23, 0.95);
        }
        .chat-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            flex: 1;
            text-align: center;
            padding: 40px;
            background: rgba(9, 14, 23, 0.8);
        }
        .empty-icon {
            font-size: 64px;
            margin-bottom: 20px;
            animation: bounce 3s infinite ease-in-out;
            color: var(--primary);
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        .chat-header {
            padding: 15px 25px;
            background: rgba(17, 24, 39, 0.85);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .chat-messages {
            flex: 1;
            padding: 30px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .msg-wrap {
            display: flex;
            width: 100%;
        }
        .msg-in { justify-content: flex-start; }
        .msg-out { justify-content: flex-end; }
        
        .msg-bubble {
            max-width: 65%;
            padding: 10px 16px;
            border-radius: 16px;
            font-size: 14.5px;
            position: relative;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
            display: flex;
            flex-direction: column;
        }
        .msg-in .msg-bubble {
            background: #202c33;
            color: #e9edef;
            border-bottom-left-radius: 4px;
        }
        .msg-out .msg-bubble {
            background: linear-gradient(135deg, #075e54, #128c7e);
            color: #fff;
            border-bottom-right-radius: 4px;
        }
        .msg-sender {
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .msg-time {
            align-self: flex-end;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.45);
            margin-top: 5px;
        }
        .msg-img {
            max-width: 100%;
            border-radius: 10px;
            margin-bottom: 6px;
            cursor: pointer;
            transition: opacity 0.3s;
        }
        .msg-img:hover {
            opacity: 0.9;
        }

        .chat-input-area {
            padding: 20px 25px;
            background: rgba(17, 24, 39, 0.85);
            backdrop-filter: blur(10px);
            border-top: 1px solid var(--border);
            display: flex;
            gap: 15px;
            align-items: center;
        }
        .chat-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px 20px;
            color: #fff;
            outline: none;
            font-size: 14px;
            transition: all 0.3s;
        }
        .chat-input:focus {
            border-color: var(--primary);
            background: rgba(255, 255, 255, 0.08);
        }
        .send-btn {
            width: 44px;
            height: 44px;
            border-radius: 12px;
            border: none;
            background: var(--primary);
            color: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.3s;
            box-shadow: 0 0 10px rgba(16, 185, 129, 0.2);
        }
        .send-btn:hover {
            background: #059669;
            transform: scale(1.05);
            box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
        }
        .send-btn svg {
            width: 18px;
            height: 18px;
        }

        /* Lightbox untuk melihat gambar penuh */
        .lightbox {
            display: none;
            position: fixed;
            z-index: 1000;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            align-items: center;
            justify-content: center;
            cursor: zoom-out;
        }
        .lightbox-img {
            max-width: 90%;
            max-height: 90%;
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            transition: transform 0.3s;
        }
    </style>
</head>
<body>
    <!-- Sidebar Navigation -->
    <div class="sidebar">
        <div class="logo-area">
            <div class="logo-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <div class="logo-title">WA-Bot Panel</div>
        </div>
        
        <div class="nav-menu">
            <div class="nav-item active" onclick="showTab('dashboard')">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>
                Dashboard
            </div>
            <div class="nav-item" onclick="showTab('chats')">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                Chats
            </div>
            <div class="nav-item" onclick="showTab('logs')">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                Activity Logs
            </div>
        </div>

        <div class="sidebar-footer">
            <a href="/logout" class="logout-btn">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Logout
            </a>
        </div>
    </div>

    <!-- Main Workspace -->
    <div class="workspace">
        <div class="top-bar">
            <div class="top-title" id="page-title">Dashboard Overview</div>
            <div class="bot-status-badge">
                <span id="main-status-dot" class="status-dot offline"></span>
                <span id="main-status-text">OFFLINE</span>
            </div>
        </div>

        <!-- Dashboard Tab -->
        <div id="tab-dashboard" class="content active">
            <div class="grid">
                <div class="card">
                    <div class="card-header-flex">
                        <span class="card-title">Uptime</span>
                        <svg class="card-icon" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <div id="stat-uptime" class="card-value">0s</div>
                </div>
                <div class="card">
                    <div class="card-header-flex">
                        <span class="card-title">Memory Usage</span>
                        <svg class="card-icon" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                    </div>
                    <div id="stat-ram" class="card-value">0 MB</div>
                </div>
                <div class="card">
                    <div class="card-header-flex">
                        <span class="card-title">Total Chats / Blacklist</span>
                        <svg class="card-icon" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <div id="stat-db" class="card-value">0 / 0</div>
                </div>
            </div>
            
            <div class="control-box">
                <div class="section-header">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="2" y="2" width="20" height="20" rx="2" ry="2"></rect><path d="M7 2v20"></path><path d="M17 2v20"></path><path d="M2 12h20"></path><path d="M2 7h5"></path><path d="M2 17h5"></path><path d="M17 17h5"></path><path d="M17 7h5"></path></svg>
                    System Control & Pairing
                </div>
                <p style="color: var(--text-dim); margin-bottom: 20px; font-size: 14px;">Hubungkan bot dengan memindai kode QR atau lakukan aksi kontrol server di bawah.</p>
                <div id="qr-container" class="qr-box"><img src="/qr.png" style="width:100%; display:block;"></div>
                <div class="actions-flex">
                    <button class="btn btn-primary" onclick="doAction('restart')">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
                        Restart Bot
                    </button>
                    <button class="btn btn-danger" onclick="doAction('selfkill')">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                        Reset Sesi & QR
                    </button>
                </div>
            </div>
        </div>

        <!-- Chats Tab -->
        <div id="tab-chats" class="content">
            <div class="chat-container">
                <!-- Sidebar room list -->
                <div class="chat-sidebar">
                    <div class="search-container">
                        <input type="text" class="search-input" id="chat-search" placeholder="Cari percakapan..." oninput="renderRooms()">
                    </div>
                    <div class="room-list" id="room-list-container">
                        <!-- Rooms loaded dynamically -->
                    </div>
                </div>

                <!-- Chat room window -->
                <div class="chat-window" id="chat-window-pane">
                    <div class="chat-empty">
                        <div class="empty-icon">🤖</div>
                        <h3>Portal Obrolan Interaktif</h3>
                        <p style="color: var(--text-dim); margin-top: 10px; font-size: 14px;">Pilih salah satu percakapan di sebelah kiri untuk melihat pesan dan mengirim balasan secara real-time.</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Logs Tab -->
        <div id="tab-logs" class="content">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 200px;">Waktu</th>
                            <th style="width: 120px;">Command</th>
                            <th>Detail Perintah</th>
                        </tr>
                    </thead>
                    <tbody id="list-logs">
                        <!-- Loaded dynamically -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Lightbox -->
    <div id="lightbox" class="lightbox" onclick="closeLightbox()">
        <img id="lightbox-img" class="lightbox-img" src="" alt="Full view">
    </div>

    <script>
        let currentTab = 'dashboard';
        let chatsData = [];
        let currentJid = null;
        let groupNamesCache = {};

        function showTab(name) {
            currentTab = name;
            document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
            
            // Set active class
            event.currentTarget.classList.add('active');
            document.getElementById('tab-' + name).classList.add('active');
            
            // Update Page Title
            const titles = {
                dashboard: 'Dashboard Overview',
                chats: 'Interactive Chat Console',
                logs: 'System Activity Logs'
            };
            document.getElementById('page-title').innerText = titles[name] || 'Admin Panel';

            if (name !== 'dashboard') {
                fetchData(name);
            }
        }

        async function updateStats() {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                document.getElementById('stat-uptime').innerText = formatUptime(data.uptime);
                document.getElementById('stat-ram').innerText = data.ram + ' MB';
                document.getElementById('stat-db').innerText = data.counts.chats + ' / ' + data.counts.blacklist;
                
                const dot = document.getElementById('main-status-dot');
                const text = document.getElementById('main-status-text');
                
                dot.className = 'status-dot ' + (data.connected ? 'online' : 'offline');
                text.innerText = data.connected ? 'ONLINE' : 'OFFLINE';
                
                document.getElementById('qr-container').style.display = (!data.connected && data.qr_ready) ? 'block' : 'none';
            } catch (e) {}
        }

        function formatUptime(s) {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const secs = s % 60;
            return (h > 0 ? h + 'j ' : '') + (m > 0 ? m + 'm ' : '') + secs + 's';
        }

        async function fetchData(type) {
            try {
                if (type === 'chats') {
                    const res = await fetch('/api/chat');
                    chatsData = await res.json();
                    renderRooms();
                    if (currentJid) {
                        renderMessages(currentJid);
                    }
                } else if (type === 'logs') {
                    const res = await fetch('/api/data?type=logs');
                    const data = await res.json();
                    const container = document.getElementById('list-logs');
                    container.innerHTML = data.map(l => {
                        const date = new Date(l.created_at || l.timestamp).toLocaleString('id-ID');
                        return \`<tr>
                            <td style="color: var(--text-dim);">\${date}</td>
                            <td><span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 4px 8px; border-radius: 6px; font-weight: 600; font-size: 12px;">!\${l.command}</span></td>
                            <td style="font-family: monospace; font-size: 13px;">\${escapeHtml(l.full_text)}</td>
                        </tr>\`;
                    }).join('');
                }
            } catch (e) {
                console.error('Error fetching data:', e);
            }
        }

        // Room lists rendering
        function renderRooms() {
            const search = document.getElementById('chat-search').value.toLowerCase();
            const roomsContainer = document.getElementById('room-list-container');
            
            // Group messages by room JID
            const grouped = {};
            chatsData.forEach(c => {
                if (!grouped[c.jid]) {
                    grouped[c.jid] = {
                        jid: c.jid,
                        name: c.groupName || c.senderName || c.sender?.split('@')[0] || c.jid,
                        isGroup: c.jid.endsWith('@g.us'),
                        messages: [],
                        lastMsg: '',
                        lastTime: null
                    };
                }
                grouped[c.jid].messages.push(c);
            });

            // Populate metadata
            Object.values(grouped).forEach(r => {
                // Sort messages within room by timestamp
                r.messages.sort((a,b) => new Date(a.timestamp || a.created_at) - new Date(b.timestamp || b.created_at));
                const last = r.messages[r.messages.length - 1];
                r.lastMsg = last.message || '';
                r.lastTime = new Date(last.timestamp || last.created_at);
            });

            // Convert to array and sort by last message timestamp desc
            let rooms = Object.values(grouped).sort((a,b) => b.lastTime - a.lastTime);

            // Filter search
            if (search) {
                rooms = rooms.filter(r => r.name.toLowerCase().includes(search) || r.jid.toLowerCase().includes(search) || r.lastMsg.toLowerCase().includes(search));
            }

            if (rooms.length === 0) {
                roomsContainer.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-dim); font-size: 14px;">Tidak ada obrolan</div>';
                return;
            }

            roomsContainer.innerHTML = rooms.map(r => {
                const isActive = r.jid === currentJid ? 'active' : '';
                const timeStr = formatChatTime(r.lastTime);
                const colorHash = stringToHslColor(r.name, 45, 60);
                const char = r.name.charAt(0).toUpperCase();
                const badge = r.isGroup ? '<span class="chat-badge badge-group">Group</span>' : '<span class="chat-badge badge-private">Private</span>';
                
                return \`<div class="room-item \${isActive}" onclick="selectRoom('\${r.jid}')">
                    <div class="avatar" style="background: \${colorHash};">\${char}</div>
                    <div class="room-info">
                        <div class="room-meta">
                            <span class="room-name">\${escapeHtml(r.name)}</span>
                            <span class="room-time">\${timeStr}</span>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                            <span class="room-preview">\${escapeHtml(r.lastMsg)}</span>
                            \${badge}
                        </div>
                    </div>
                </div>\`;
            }).join('');
        }

        function formatChatTime(date) {
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (86400000));
            
            if (diffDays === 0) {
                return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            } else if (diffDays === 1) {
                return 'Kemarin';
            } else if (diffDays < 7) {
                const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                return days[date.getDay()];
            } else {
                return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
            }
        }

        // Color generator for avatar
        function stringToHslColor(str, s, l) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = str.charCodeAt(i) + ((hash << 5) - hash);
            }
            const h = Math.abs(hash) % 360;
            return \`hsl(\${h}, \${s}%, \${l}%)\`;
        }

        function selectRoom(jid) {
            currentJid = jid;
            renderRooms();
            renderMessages(jid);
        }

        function renderMessages(jid) {
            const pane = document.getElementById('chat-window-pane');
            const messages = chatsData.filter(c => c.jid === jid).sort((a,b) => new Date(a.timestamp || a.created_at) - new Date(b.timestamp || b.created_at));
            
            if (messages.length === 0) return;
            
            const first = messages[0];
            const roomName = first.groupName || first.senderName || first.sender?.split('@')[0] || jid;
            const isGroup = jid.endsWith('@g.us');
            const colorHash = stringToHslColor(roomName, 45, 60);
            
            let html = \`
                <!-- Header -->
                <div class="chat-header">
                    <div class="avatar" style="background: \${colorHash};">\${roomName.charAt(0).toUpperCase()}</div>
                    <div style="flex: 1; min-width:0;">
                        <h4 style="color: #fff; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">\${escapeHtml(roomName)}</h4>
                        <span style="font-size: 11px; color: var(--text-dim);">\${jid}</span>
                    </div>
                    <button class="btn" style="padding: 8px 12px; border-radius: 8px; font-size: 12px;" onclick="fetchData('chats')">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
                    </button>
                </div>
                
                <!-- Messages container -->
                <div class="chat-messages" id="message-container">
            \`;

            html += messages.map(m => {
                const isOut = m.direction === 'out';
                const wrapClass = isOut ? 'msg-out' : 'msg-in';
                const time = new Date(m.timestamp || m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                let mediaHtml = '';
                if (m.mediaPath) {
                    const encodedPath = encodeURIComponent(m.mediaPath);
                    mediaHtml = \`<img class="msg-img" src="/api/media?path=\${encodedPath}" alt="Gambar" onclick="openLightbox(this.src)">\`;
                }

                // Group chats: show sender name
                let senderHtml = '';
                if (!isOut && isGroup) {
                    const senderColor = stringToHslColor(m.sender || m.senderName, 60, 65);
                    const displayName = m.senderName || m.sender?.split('@')[0] || 'Unknown';
                    senderHtml = \`<span class="msg-sender" style="color: \${senderColor}">\${escapeHtml(displayName)}</span>\`;
                }

                return \`<div class="msg-wrap \${wrapClass}">
                    <div class="msg-bubble">
                        \${senderHtml}
                        \${mediaHtml}
                        <span style="word-break: break-word;">\${escapeHtml(m.message)}</span>
                        <span class="msg-time">\${time}</span>
                    </div>
                </div>\`;
            }).join('');

            html += \`
                </div>
                
                <!-- Bottom input -->
                <div class="chat-input-area">
                    <input type="text" class="chat-input" id="message-input" placeholder="Ketik pesan..." onkeydown="handleInputKey(event)">
                    <button class="send-btn" onclick="sendMessage()">
                        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                </div>
            \`;

            pane.innerHTML = html;
            
            // Scroll to bottom
            const container = document.getElementById('message-container');
            container.scrollTop = container.scrollHeight;
        }

        function handleInputKey(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        }

        async function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            if (!message || !currentJid) return;
            
            input.value = '';
            input.focus();

            try {
                // Instantly append to local chats data to make the UI ultra snappy!
                const localMsg = {
                    jid: currentJid,
                    groupName: currentJid.endsWith('@g.us') ? groupNamesCache[currentJid] || 'Group' : '',
                    sender: 'Me',
                    senderName: 'Admin',
                    message: message,
                    direction: 'out',
                    timestamp: new Date().toISOString()
                };
                chatsData.push(localMsg);
                
                // Rerender messages and room preview
                renderMessages(currentJid);
                renderRooms();

                // Send request
                const res = await fetch('/api/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number: currentJid, message })
                });
                
                const result = await res.json();
                if (result.error) {
                    alert('Gagal mengirim: ' + result.error);
                } else {
                    // Refetch in background to sync database state
                    fetchData('chats');
                }
            } catch (e) {
                alert('Error sending message: ' + e.message);
            }
        }

        // Lightbox actions
        function openLightbox(src) {
            const box = document.getElementById('lightbox');
            const img = document.getElementById('lightbox-img');
            img.src = src;
            box.style.display = 'flex';
        }
        function closeLightbox() {
            document.getElementById('lightbox').style.display = 'none';
        }

        async function doAction(act) {
            if(!confirm('Apakah Anda yakin ingin melakukan aksi ini?')) return;
            await fetch('/api/action/' + act, { method: 'POST' });
            alert('Perintah dikirim. Mengalihkan kembali...');
            setTimeout(() => location.reload(), 2000);
        }

        function escapeHtml(text) {
            if (!text) return '';
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, function(m) { return map[m]; });
        }

        // Live polling stats and chats data
        setInterval(updateStats, 5000);
        setInterval(() => {
            if (currentTab === 'chats') {
                fetchData('chats');
            }
        }, 10000);

        // Initial load
        updateStats();
    </script>
</body></html>`
}

module.exports = { createServer, setConnected, setSocket }
