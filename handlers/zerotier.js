const axios = require('axios');
const config = require('../config');
const { db } = require('../database/db');
const log = require('../logger/debugLogger');

/**
 * Helper untuk mengirimkan balasan pesan WhatsApp dan mencatat ke database obrolan.
 */
async function reply(sock, jid, msg, text) {
  await sock.sendMessage(jid, {
    text,
    contextInfo: {
      stanzaId: msg.key.id,
      participant: msg.key.participant || msg.key.remoteJid,
      quotedMessage: msg.message
    }
  });

  try {
    let groupName = '';
    const isGroup = jid.endsWith('@g.us');
    if (isGroup) {
      groupName = 'Group';
    }
    db.table('chats').insert({
      jid,
      groupName,
      sender: 'Me',
      senderName: 'Bot',
      message: text,
      direction: 'out',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    log.error('reply_log', 'Gagal menyimpan log respon bot ZeroTier:', e);
  }
}

/**
 * Mengambil nama network dari ZeroTier Central.
 */
async function getNetworkName(netid) {
  try {
    const res = await axios.get(`https://my.zerotier.com/api/v1/network/${netid}`, {
      headers: { 'Authorization': `token ${config.ZEROTIER_TOKEN}` },
      timeout: 8000
    });
    return res.data?.config?.name || res.data?.name || 'Unnamed Network';
  } catch (e) {
    return 'Network ' + netid.slice(0, 8);
  }
}

/**
 * Mengambil daftar member dari sebuah network.
 */
async function getNetworkMembers(netid) {
  const res = await axios.get(`https://my.zerotier.com/api/v1/network/${netid}/member`, {
    headers: { 'Authorization': `token ${config.ZEROTIER_TOKEN}` },
    timeout: 12000
  });
  return res.data || [];
}

/**
 * Memetakan selisih waktu ke status keaktifan bermotif emoji warna.
 * - < 10 menit: aktif (hijau 🟢)
 * - 10 menit sampai 3 jam: idle (kuning 🟡)
 * - 3 jam sampai 24 jam: dead (merah 🔴)
 * - > 24 jam / 1 hari: gone (hitam ⚫)
 */
function getHostStatus(clock, lastOnline) {
  if (!lastOnline) return { emoji: '⚫', label: 'Gone', priority: 4 };
  const diff = clock - lastOnline;

  const TEN_MIN = 10 * 60 * 1000;
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (diff < TEN_MIN) {
    return { emoji: '🟢', label: 'Aktif', priority: 1 };
  } else if (diff < THREE_HOURS) {
    return { emoji: '🟡', label: 'Idle', priority: 2 };
  } else if (diff < ONE_DAY) {
    return { emoji: '🔴', label: 'Dead', priority: 3 };
  } else {
    return { emoji: '⚫', label: 'Gone', priority: 4 };
  }
}

/**
 * Memformat cap waktu terakhir terlihat secara cantik dan premium.
 */
function formatLastSeen(lastOnline) {
  if (!lastOnline) return 'Belum pernah online';
  
  const now = new Date();
  const date = new Date(lastOnline);
  
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfNow - startOfDate) / (24 * 60 * 60 * 1000));

  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');

  if (diffDays === 0) {
    return `Hari ini ${hours}.${mins}.${secs}`;
  } else if (diffDays === 1) {
    return `Kemarin ${hours}.${mins}`;
  } else {
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const month = monthNames[date.getMonth()];
    return `${day} ${month} ${hours}.${mins}`;
  }
}

/**
 * Handler utama untuk command !zt / !zerotier
 */
async function handleZeroTierCommand(sock, jid, msg, args) {
  const token = config.ZEROTIER_TOKEN;
  const netids = config.ZEROTIER_NETIDS;

  if (!token || netids.length === 0) {
    await reply(sock, jid, msg, '❌ *Error:* Konfigurasi ZEROTIER_TOKEN atau netid belum diatur di berkas .env!');
    return;
  }

  // Parse argumen: default ke PLN (e5cd7a9e1c967f34)
  const query = (args[0] || '').toLowerCase().trim();
  let targetNetIds = [];

  if (query === 'lokal') {
    targetNetIds = ['632ea29085de193c'];
  } else if (query === 'all' || query === 'semua') {
    targetNetIds = netids;
  } else {
    // Default / fallback ke PLN
    targetNetIds = ['e5cd7a9e1c967f34'];
  }

  const queryLabel = query === 'lokal' ? 'Lokal' : (query === 'all' || query === 'semua' ? 'Semua Jaringan' : 'PLN');
  await reply(sock, jid, msg, `⏳ Sedang mengontak ZeroTier Central API untuk Jaringan *${queryLabel}*...`);

  try {
    let text = `╔══════════════════════╗\n`;
    text += `   🌐 *ZEROTIER HOST STATUS*   \n`;
    text += `╚══════════════════════╝\n\n`;

    for (let i = 0; i < targetNetIds.length; i++) {
      const netid = targetNetIds[i];
      const netName = await getNetworkName(netid);
      const members = await getNetworkMembers(netid);

      // Hanya tampilkan host yang ter-otorisasi (authorized) agar informatif
      const authorizedMembers = members.filter(m => m.config?.authorized === true);

      // Map host dengan status keaktifannya
      const mappedMembers = authorizedMembers.map(m => {
        const status = getHostStatus(m.clock, m.lastOnline);
        return {
          name: m.name || 'Unnamed',
          nodeId: m.nodeId || '-',
          ips: m.config?.ipAssignments?.join(', ') || '-',
          lastOnline: m.lastOnline,
          status
        };
      });

      // Urutkan: Aktif (1) -> Idle (2) -> Dead (3) -> Gone (4)
      mappedMembers.sort((a, b) => a.status.priority - b.status.priority);

      const countActive = mappedMembers.filter(m => m.status.priority === 1).length;
      const countIdle = mappedMembers.filter(m => m.status.priority === 2).length;

      text += `📌 *Network:* ${netName} (\`${netid}\`)\n`;
      text += `📊 *Host:* *${mappedMembers.length}* Total (🟢 ${countActive} | 🟡 ${countIdle})\n\n`;

      if (mappedMembers.length === 0) {
        text += `  _Tidak ada host terdaftar pada jaringan ini._\n`;
      } else {
        mappedMembers.forEach(m => {
          const lastSeenStr = formatLastSeen(m.lastOnline);
          text += `${m.status.emoji} *${m.name}* (\`${m.nodeId}\`)\n`;
          text += `   🔌 IP: \`${m.ips}\`\n`;
          text += `   🕒 Status: ${m.status.label} (${lastSeenStr})\n\n`;
        });
      }

      if (i < targetNetIds.length - 1) {
        text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      }
    }

    text += `_Terakhir diperbarui: ${new Date().toLocaleTimeString('id-ID')}_`;
    await reply(sock, jid, msg, text.trim());

  } catch (err) {
    log.error('zerotier', 'Gagal memproses status ZeroTier:', err);
    await reply(sock, jid, msg, `❌ *Gagal mengambil data ZeroTier:* ${err.message}`);
  }
}

module.exports = { handleZeroTierCommand };
