const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const config = require('../config')
const { db }     = require('../database/db')

const QR_PATH = path.join(__dirname, '..', 'session', 'qr.png')
const SESSION_DIR = path.join(__dirname, '..', 'session')

let _isConnected = false
let _startTime   = Date.now()
let _sock        = null

function setConnected(val) { _isConnected = val }
function setSocket(sock)   { _sock = sock }

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url?.split('?')[0]
    const method = req.method
    const cookies = parseCookies(req)

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
          notes: db.table('notes').count(),
          reminders: db.table('reminders').all().filter(r => !r.done).length,
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

      // ... API Data Management (tetap sama) ...
      if (url === '/api/data' && method === 'GET') {
        const type = new URL(req.url, `http://${req.headers.host}`).searchParams.get('type')
        return sendJSON(db.table(type || 'notes').latest(100))
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
            db.table('chats').insert({ jid, message, direction: 'out' })
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

  server.listen(config.WEB_PORT)
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
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>WA-Bot Admin</title>
    <style>
        :root { --bg: #0b0e14; --card: #161b22; --border: #30363d; --text: #c9d1d9; --text-dim: #8b949e; --primary: #238636; --danger: #da3633; --accent: #1f6feb; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
        .nav-bar { background: var(--card); border-bottom: 1px solid var(--border); padding: 0 20px; display: flex; align-items: center; height: 60px; justify-content: space-between; position: sticky; top:0; z-index: 100; }
        .tabs { display: flex; height: 100%; }
        .tab { padding: 0 20px; display: flex; align-items: center; cursor: pointer; color: var(--text-dim); border-bottom: 2px solid transparent; transition: 0.2s; font-size: 14px; }
        .tab:hover { color: #fff; }
        .tab.active { color: #fff; border-bottom-color: var(--accent); background: rgba(255,255,255,0.03); }
        .content { padding: 25px; max-width: 1200px; margin: 0 auto; display: none; }
        .content.active { display: block; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
        .card-title { font-size: 12px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 10px; }
        .card-value { font-size: 28px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
        th { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); color: var(--text-dim); }
        td { padding: 12px; border-bottom: 1px solid var(--border); }
        .btn-sm { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border); background: #21262d; color: var(--text); cursor: pointer; }
        .btn-danger-sm { color: var(--danger); }
        .status-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; }
        .online { background: #14532d; color: #4ade80; }
        .offline { background: #451a1a; color: #f87171; }
        .actions-card { display: flex; gap: 10px; margin-top: 20px; }
        .qr-box { max-width: 250px; margin: 20px auto; background: #fff; padding: 10px; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="nav-bar">
        <div style="font-weight: bold;">🤖 ADMIN PANEL <span id="main-status" class="status-pill offline">OFFLINE</span></div>
        <div class="tabs">
            <div class="tab active" onclick="showTab('dashboard')">Dashboard</div>
            <div class="tab" onclick="showTab('notes')">Notes</div>
            <div class="tab" onclick="showTab('reminders')">Reminders</div>
            <div class="tab" onclick="showTab('logs')">Logs</div>
        </div>
        <a href="/logout" style="color: var(--text-dim); text-decoration: none; font-size: 13px;">Logout</a>
    </div>

    <div id="tab-dashboard" class="content active">
        <div class="grid">
            <div class="card"><div class="card-title">Uptime</div><div id="stat-uptime" class="card-value">0s</div></div>
            <div class="card"><div class="card-title">Memory</div><div id="stat-ram" class="card-value">0 MB</div></div>
            <div class="card"><div class="card-title">Database Items</div><div id="stat-db" class="card-value">0 / 0</div></div>
        </div>
        <div class="card">
            <h3>System Control</h3>
            <div id="qr-container" style="display:none" class="qr-box"><img src="/qr.png" style="width:100%"></div>
            <div class="actions-card">
                <button class="btn-sm" style="padding:10px 20px" onclick="doAction('restart')">Restart Bot</button>
                <button class="btn-sm btn-danger-sm" style="padding:10px 20px" onclick="doAction('selfkill')">Reset Session</button>
            </div>
        </div>
    </div>

    <div id="tab-notes" class="content"><div class="card"><h3>Notes</h3><table id="list-notes"></table></div></div>
    <div id="tab-reminders" class="content"><div class="card"><h3>Reminders</h3><table id="list-reminders"></table></div></div>
    <div id="tab-logs" class="content"><div class="card"><h3>Activity Logs</h3><table id="list-logs"></table></div></div>

    <script>
        function showTab(name) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('tab-' + name).classList.add('active');
            if (name !== 'dashboard') fetchData(name);
        }
        async function updateStats() {
            const res = await fetch('/api/stats');
            const data = await res.json();
            document.getElementById('stat-uptime').innerText = data.uptime + 's';
            document.getElementById('stat-ram').innerText = data.ram + ' MB';
            document.getElementById('stat-db').innerText = data.counts.notes + ' / ' + data.counts.reminders;
            const pill = document.getElementById('main-status');
            pill.innerText = data.connected ? 'ONLINE' : 'OFFLINE';
            pill.className = 'status-pill ' + (data.connected ? 'online' : 'offline');
            document.getElementById('qr-container').style.display = (!data.connected && data.qr_ready) ? 'block' : 'none';
        }
        async function fetchData(type) {
            const res = await fetch('/api/data?type=' + type);
            const data = await res.json();
            const container = document.getElementById('list-' + type);
            if(type === 'logs') {
              container.innerHTML = data.map(l => \`<tr><td>\${l.created_at}</td><td>\${l.command}</td><td>\${l.full_text}</td></tr>\`).join('');
            } else {
              container.innerHTML = data.map(item => \`<tr><td>\${item.title || item.message}</td><td><button class="btn-sm btn-danger-sm" onclick="deleteData('\${type}', \${item.id})">Delete</button></td></tr>\`).join('');
            }
        }
        async function deleteData(type, id) {
            if(!confirm('Hapus?')) return;
            await fetch('/api/data/delete', { method: 'POST', body: JSON.stringify({type, id}) });
            fetchData(type);
        }
        async function doAction(act) {
            if(!confirm('Lanjutkan?')) return;
            await fetch('/api/action/' + act, { method: 'POST' });
        }
        setInterval(updateStats, 5000);
        updateStats();
    </script>
</body></html>`
}

module.exports = { createServer, setConnected, setSocket }
