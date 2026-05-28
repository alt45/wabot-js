const axios = require('axios')
const log   = require('../logger/debugLogger')

function normalizeNumber(num) {
  num = num.replace(/\D/g, '')
  if (num.startsWith('0'))  num = '62' + num.slice(1)
  if (num.startsWith('+'))  num = num.slice(1)
  return num
}

function dateOnly(v) {
  if (!v) return '-'
  const s   = String(v).trim()
  const iso  = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`
  const dmy  = s.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})/)
  if (dmy) return `${dmy[1]}-${dmy[2]}-${dmy[3]}`
  return s
}

function toNumber(x) {
  if (x == null) return 0
  const s = String(x).replace(/\s/g,'').replace(/,/g,'.').replace(/[^\d.]/g,'')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function buildBar(pct) {
  const filled = Math.round(pct / 10)
  const empty  = 10 - filled
  return '▓'.repeat(filled) + '░'.repeat(empty)
}

async function cekKuotaXL(nomor) {
  const msisdn = normalizeNumber(nomor)

  if (msisdn.length < 9) throw new Error('Nomor tidak valid')

  log.debug('xl', `Memulai pengecekan kuota XL/Axis untuk nomor: ${msisdn}`)

  try {
    const res = await axios.get('https://apigw.kmsp-store.com/sidompul/v4/cek_kuota', {
      params: { msisdn, isJSON: true, _: Date.now() },
      headers: {
        'Accept':        'application/json',
        'Authorization': 'Basic c2lkb21wdWxhcGk6YXBpZ3drbXNw',
        'x-api-key':     '60ef29aa-a648-4668-90ae-20951ef90c55',
        'x-app-version': '4.0.0'
      },
      timeout: 12000
    })

    const json = res.data
    log.debug('xl_raw', `Raw API Response:\n${JSON.stringify(json, null, 2)}`)
    if (!json?.status || !json?.data?.data_sp) {
      throw new Error(json?.message || 'Gagal ambil data dari Sidompul')
    }

    log.debug('xl', `API Sidompul merespons sukses untuk nomor: ${msisdn}`)

    const d  = json.data.data_sp
    const ms = json.data?.msisdn ?? msisdn

    const tipeKartu = d?.prefix?.value        ?? '-'
    const jaringan  = d?.status_4g?.value     ?? '-'
    const masaAktif = dateOnly(d?.active_period?.value ?? '')
    const masaTengg = dateOnly(d?.grace_period?.value ?? d?.masa_tenggang?.value ?? '')

    // Kumpulkan semua paket
    const groups   = d?.quotas?.value || []
    const flatPkgs = []
    if (Array.isArray(groups)) {
      groups.forEach(g => (g || []).forEach(p => flatPkgs.push(p)))
    }

    log.debug('xl', `Berhasil mengurai ${flatPkgs.length} paket aktif untuk nomor ${ms}`)

    let kuotaText = ''
    flatPkgs.forEach(pkg => {
      const pname    = pkg?.packages?.name    ?? 'Paket'
      const exp      = dateOnly(pkg?.packages?.expDate ?? '')
      const benefits = pkg?.benefits || []

      kuotaText += `\n📦 *${pname}*`
      if (exp) kuotaText += ` (exp: ${exp})`
      kuotaText += '\n'

      if (!benefits.length) {
        kuotaText += '  Tidak ada detail\n'
      } else {
        benefits.forEach(b => {
          const name   = b?.bname    ?? 'Kuota'
          const remain = b?.remaining ?? '0'
          const total  = b?.quota     ?? '0'
          const pct    = toNumber(total) > 0
            ? Math.round((toNumber(remain) / toNumber(total)) * 100)
            : 0
          kuotaText += `  • ${name}\n    ${remain} / ${total}  ${buildBar(pct)} ${pct}%\n`
        })
      }
    })

    if (!kuotaText) kuotaText = '\nTidak ada data paket aktif.'

    log.success(`Berhasil memproses cek kuota nomor: ${ms}`)

    return `╔══════════════════════╗
  📊 *CEK KUOTA XL/AXIS*
╚══════════════════════╝

📱 *Nomor*       : ${ms}
🃏 *Tipe Kartu*  : ${tipeKartu}
📶 *Jaringan*    : ${jaringan}
✅ *Masa Aktif*  : ${masaAktif}
⏳ *Masa Tenggang*: ${masaTengg}

━━━━━━━━━━━━━━━━━━━━━━
*DETAIL KUOTA:*
${kuotaText}
━━━━━━━━━━━━━━━━━━━━━━
_Powered by Sidompul API_`
  } catch (e) {
    log.error('xl', `Gagal saat melakukan pengecekan kuota nomor ${msisdn}: ${e.message}`, e)
    throw e
  }
}

module.exports = { cekKuotaXL }
