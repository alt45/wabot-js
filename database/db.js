const fs   = require('fs')
const path = require('path')

const DB_DIR  = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DB_DIR, 'db.json')

// Pastikan folder data ada
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

// Struktur Database Awal
const initialData = {
  reminders: [],
  notes: [],
  activity_log: [],
  blacklist: [],
  status_log: [],
  chats: []
}

// Inisialisasi file jika belum ada
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2))
}

class JsonDB {
  constructor() {
    this.path = DB_PATH
  }

  // Baca semua data
  read() {
    try {
      const content = fs.readFileSync(this.path, 'utf8')
      return JSON.parse(content)
    } catch (e) {
      return initialData
    }
  }

  // Simpan data
  write(data) {
    fs.writeFileSync(this.path, JSON.stringify(data, null, 2))
  }

  // Helper untuk mendapatkan tabel tertentu (dengan fungsi chainable sederhana)
  table(name) {
    const data = this.read()
    const list = data[name] || []
    
    return {
      all: () => list,
      get: (id) => list.find(item => item.id === id),
      insert: (item) => {
        item.id = Date.now() + Math.floor(Math.random() * 1000)
        item.created_at = new Date().toISOString()
        list.push(item)
        data[name] = list
        this.write(data)
        return item
      },
      update: (id, newFields) => {
        const idx = list.findIndex(i => i.id === id)
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...newFields }
          data[name] = list
          this.write(data)
        }
      },
      delete: (id) => {
        data[name] = list.filter(i => i.id !== id)
        this.write(data)
      },
      count: () => list.length,
      // Simulasi query order by & limit
      latest: (limit = 10) => {
        return [...list].sort((a,b) => b.id - a.id).slice(0, limit)
      }
    }
  }

  // Khusus untuk kompatibilitas API lama (better-sqlite3 style)
  prepare(query) {
    const db = this
    // Analisa query SQL sederhana untuk menyesuaikan logic
    const q = query.toLowerCase()
    
    return {
      get: () => {
        if (q.includes('from notes')) return { count: db.table('notes').count() }
        if (q.includes('from reminders')) return { count: db.table('reminders').all().filter(r => !r.done).length }
        if (q.includes('from blacklist')) return { count: db.table('blacklist').count() }
        return { count: 0 }
      },
      all: () => {
        if (q.includes('activity_log')) return db.table('activity_log').latest(50)
        if (q.includes('notes')) return db.table('notes').latest(100)
        if (q.includes('reminders')) return db.table('reminders').latest(100)
        if (q.includes('blacklist')) return db.table('blacklist').all()
        return []
      },
      run: (...args) => {
        if (q.includes('insert into activity_log')) {
          db.table('activity_log').insert({ jid: args[0], sender: args[1], command: args[2], full_text: args[3] })
        }
        if (q.includes('insert into status_log')) {
          db.table('status_log').insert({ sender: args[0], type: args[1], caption: args[2] })
        }
        if (q.includes('delete from notes')) db.table('notes').delete(args[0])
        if (q.includes('delete from reminders')) db.table('reminders').delete(args[0])
        if (q.includes('delete from blacklist')) db.table('blacklist').delete(args[0])
      }
    }
  }
}

const db = new JsonDB()
console.log('✅ JSON Database siap:', DB_PATH)

module.exports = db
