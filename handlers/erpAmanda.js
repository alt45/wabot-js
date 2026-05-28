const axios = require('axios')
const fs = require('fs')
const path = require('path')
const https = require('https')
const log = require('../logger/debugLogger')

// Buat agent HTTPS untuk mengabaikan peringatan SSL (Insecure)
const agent = new https.Agent({  
  rejectUnauthorized: false
})

const CONFIG = {
  USER_ID: '8425214MGG',
  PASSWORD: 'Plnes@2025',
  TARGET_PAGE: 'ops',
  SESSION_FILE: path.join(__dirname, '..', 'data', 'session_cookies_erp.json'),
  USERS_FILE: path.join(__dirname, '..', 'database', 'users.json')
}

// ── Cookie Manager Helpers ──────────────────────────────
function parseSetCookies(setCookieHeader) {
  if (!setCookieHeader) return {}
  const cookies = {}
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  headers.forEach(h => {
    const parts = h.split(';')[0].split('=')
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim()
    }
  })
  return cookies
}

function serializeCookies(cookiesObj) {
  return Object.entries(cookiesObj).map(([k, v]) => `${k}=${v}`).join('; ')
}

function loadSession() {
  if (fs.existsSync(CONFIG.SESSION_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG.SESSION_FILE, 'utf8')
      log.debug('erp', 'Cookie sesi berhasil dimuat dari data/session_cookies_erp.json')
      return JSON.parse(data)
    } catch (e) {
      return {}
    }
  }
  return {}
}

function saveSession(cookies) {
  try {
    const dataDir = path.dirname(CONFIG.SESSION_FILE)
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(CONFIG.SESSION_FILE, JSON.stringify(cookies, null, 2))
    log.debug('erp', 'Cookie sesi berhasil disimpan ke data/session_cookies_erp.json')
  } catch (e) {
    log.error('erp', 'Gagal menyimpan cookie sesi:', e)
  }
}

// Cek apakah sesi valid dengan melakukan test request
async function isSessionValid(cookies, unitId) {
  try {
    const ts = Date.now()
    const testUrl = `https://portal.plnes.co.id/home/work/data/lov.php?job=unit_by_unit&I_ID_UNIT=${unitId}&_=${ts}`
    const resp = await axios.get(testUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': serializeCookies(cookies)
      },
      httpsAgent: agent,
      timeout: 8000
    })
    return resp.status_code === 200 || (typeof resp.data === 'string' && resp.data.trim().startsWith('[')) || Array.isArray(resp.data)
  } catch (e) {
    return false
  }
}

// Proses login lengkap untuk mendapatkan sesi baru
async function performLogin() {
  const loginPageUrl = 'https://portal.plnes.co.id/home/login_new'
  const authUrl = 'https://portal.plnes.co.id/home/auth.php'
  
  log.debug('erp', 'Mengakses halaman login portal untuk ekstraksi token CSRF...')
  
  const respGet = await axios.get(loginPageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    httpsAgent: agent,
    timeout: 10000
  })

  const html = respGet.data
  const cookies = parseSetCookies(respGet.headers['set-cookie'])

  // Ekstrak I_HEX & I_IP menggunakan Regex robust
  const hexMatch = html.match(/id=["']I_HEX["'][^>]*value=["']([^"']*)["']/) || html.match(/name=["']I_HEX["'][^>]*value=["']([^"']*)["']/) || html.match(/value=["']([^"']*)["'][^>]*id=["']I_HEX["']/);
  const ipMatch = html.match(/id=["']I_IP["'][^>]*value=["']([^"']*)["']/) || html.match(/name=["']I_IP["'][^>]*value=["']([^"']*)["']/) || html.match(/value=["']([^"']*)["'][^>]*id=["']I_IP["']/);
  
  const i_hex = hexMatch ? hexMatch[1] : ''
  const i_ip = ipMatch ? ipMatch[1] : ''
  
  log.debug('erp', `Token CSRF terekstrak: I_HEX="${i_hex}", I_IP="${i_ip}"`)

  const payload = new URLSearchParams({
    I_ID_USER: CONFIG.USER_ID,
    I_PASSOWRD: CONFIG.PASSWORD,
    I_HEX: i_hex,
    I_IP: i_ip,
    I_PAGE: CONFIG.TARGET_PAGE
  }).toString()

  log.debug('erp', 'Mengirimkan request POST autentikasi login...')
  const respPost = await axios.post(authUrl, payload, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': loginPageUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': serializeCookies(cookies)
    },
    httpsAgent: agent,
    timeout: 15000
  })

  if (typeof respPost.data === 'string' && respPost.data.includes('SUCCESS')) {
    log.success('Login Portal PLN ES Berhasil!')
    const postCookies = parseSetCookies(respPost.headers['set-cookie'])
    const mergedCookies = { ...cookies, ...postCookies }
    saveSession(mergedCookies)
    return mergedCookies
  } else {
    throw new Error(`Gagal Login! Respons Portal: ${respPost.data}`)
  }
}

// Fungsi utama penarikan laporan shifting absen ULP
async function getErpReport(usernameInput) {
  log.debug('erp', `Memulai pencarian data ERP untuk ULP username: ${usernameInput}`)

  // 1. Muat data users
  if (!fs.existsSync(CONFIG.USERS_FILE)) {
    throw new Error('Daftar data ULP (users.json) tidak ditemukan di folder TMP_UPDATE.')
  }
  const users = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf8'))
  const user = users.find(u => u.username.toLowerCase() === usernameInput.toLowerCase())
  
  if (!user) {
    throw new Error(`Unit ULP dengan username *${usernameInput}* tidak ditemukan di daftar users.json.`)
  }

  const { id_unit, nama_unit } = user
  log.debug('erp', `Cocok dengan unit: ${nama_unit} (${id_unit})`)

  // 2. Muat sesi atau login ulang
  let cookies = loadSession()
  const valid = Object.keys(cookies).length > 0 && await isSessionValid(cookies, id_unit)

  if (valid) {
    log.debug('erp', 'Sesi login lama masih aktif. Menggunakan cookie terdaftar.')
  } else {
    log.warn('Sesi login tidak ditemukan atau kedaluwarsa. Mencoba login ulang...')
    cookies = await performLogin()
  }

  // 3. Tentukan tanggal dinamis berdasarkan waktu saat ini
  const now = new Date()
  const tahun = now.getFullYear().toString()
  const bulan = (now.getMonth() + 1).toString().padStart(2, '0') // 01, 02, etc.

  log.debug('erp', `Menarik data absensi ULP periode Bulan: ${bulan}, Tahun: ${tahun}...`)

  // 4. Kirim request penarikan shifting absen
  const shiftingUrl = 'https://portal.plnes.co.id/home/work/layout/shifting_absen_per%20area/data.sql.php?job=load'
  const shiftingPayload = new URLSearchParams({
    I_ID_UNIT: id_unit,
    I_TAHUN: tahun,
    I_BULAN: bulan,
    pageIndex: '0',
    pageSize: '50',
    sortField: '',
    sortOrder: ''
  }).toString()

  const respShifting = await axios.post(shiftingUrl, shiftingPayload, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://portal.plnes.co.id/home/work/layout/shifting_absen_per%20area/view.php?VIEW=Y&home=new',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': serializeCookies(cookies)
    },
    httpsAgent: agent,
    timeout: 20000
  })

  const shiftingJson = respShifting.data
  log.debug('erp_raw', `Raw API Response Shifting Absen:\n${JSON.stringify(shiftingJson, null, 2)}`)
  
  if (!shiftingJson || !shiftingJson.data) {
    throw new Error('Gagal menarik data absensi. Data kosong atau format tidak sesuai.')
  }

  const dataList = shiftingJson.data
  log.success(`Berhasil menarik ${dataList.length} data karyawan untuk ${nama_unit}.`)

  if (dataList.length === 0) {
    return [`📊 *LAPORAN SHIFTING KARYAWAN*\n\nUnit: *${nama_unit}*\nPeriode: *${bulan}-${tahun}*\n\n📭 Tidak ada data karyawan aktif untuk periode ini.`]
  }

  // 5. Build dan Split Pesan WhatsApp secara rapi
  const messagesToSend = []
  let tgMessage = `📊 *LAPORAN SHIFTING KARYAWAN*\n`
  tgMessage += `🏫 *Unit*: ${nama_unit} (${id_unit})\n`
  tgMessage += `📅 *Periode*: ${bulan}-${tahun}\n`
  tgMessage += `👥 *Total*: ${dataList.length} Karyawan\n`
  tgMessage += `-----------------------------------\n\n`

  dataList.forEach((emp, i) => {
    const nama = String(emp.NAMA_TK || 'N/A').trim()
    const nip = String(emp.NIP_TK || '-').trim()
    const hari = String(emp.JML_HARI_MASUK || '0')
    const jam = String(emp.JML_JAM_MASUK || '0')
    const p5lms = String(emp.POIN_5LMS || '0')
    const p4s = String(emp.POIN_4S || '0')
    const papd = String(emp.POIN_APD || '0')
    const siq = String(emp.KEPATUHAN_SIQ || '0')
    const proper = String(emp.PROPER || '0')

    const empStr = `*${i + 1}. ${nama} (${nip})*\n` +
                   `├ Masuk: ${hari} Hari (${jam} Jam)\n` +
                   `├ Poin: 5LMS=${p5lms} | 4S=${p4s} | APD=${papd}\n` +
                   `└ SIQ: ${siq} | PROPER: ${proper}\n\n`

    // WhatsApp mendukung hingga 65.536 karakter, jadi kita naikkan limit agar terkirim dalam 1 bubble utuh.
    if (tgMessage.length + empStr.length > 60000) {
      messagesToSend.push(tgMessage)
      tgMessage = empStr
    } else {
      tgMessage += empStr
    }
  })

  if (tgMessage) {
    messagesToSend.push(tgMessage)
  }

  return messagesToSend
}

module.exports = { getErpReport }
