const db = require('../database/db')

function addNote(jid, sender, args) {
  const text = args.join(' ')
  if (!text.includes('|')) return '⚠️ Format: *!catat Judul | Isi catatan*'
  
  const [title, ...contentParts] = text.split('|')
  const content = contentParts.join('|').trim()
  
  const item = db.table('notes').insert({
    jid,
    sender,
    title: title.trim(),
    content
  })
  
  return `✅ Catatan disimpan!\n🆔 ID: *${item.id}*`
}

function listNotes(jid, sender) {
  const notes = db.table('notes').all()
  if (notes.length === 0) return '📭 Belum ada catatan.'
  
  let text = '📝 *DAFTAR CATATAN*\n\n'
  notes.forEach((n, i) => {
    text += `${i + 1}. [${n.id}] *${n.title}*\n`
  })
  text += '\n_Ketik !lihat <id> untuk membaca_'
  return text
}

function getNote(jid, sender, args) {
  const id = parseInt(args[0])
  if (!id) return '⚠️ Masukkan ID catatan.'
  
  const note = db.table('notes').get(id)
  if (!note) return '❌ Catatan tidak ditemukan.'
  
  return `📝 *${note.title}*\n\n${note.content}\n\n_Dibuat: ${note.created_at}_`
}

function deleteNote(jid, sender, args) {
  const id = parseInt(args[0])
  if (!id) return '⚠️ Masukkan ID catatan.'
  
  const note = db.table('notes').get(id)
  if (!note) return '❌ Catatan tidak ditemukan.'
  
  db.table('notes').delete(id)
  return `✅ Catatan *${note.title}* telah dihapus.`
}

module.exports = { addNote, listNotes, getNote, deleteNote }
