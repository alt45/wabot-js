const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function getXrayStats() {
  try {
    const { stdout } = await execPromise('/usr/local/bin/xray api statsquery -server=127.0.0.1:10085');
    
    // Kadang JSON dari xray CLI punya spasi ekstra atau format tertentu, pastikan di-parse aman
    const data = JSON.parse(stdout);
    if (!data.stat || data.stat.length === 0) {
      return '📊 *Xray VPN Status*\n\nBelum ada data trafik yang tercatat.';
    }

    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Kelompokkan data per user
    const users = {};
    let systemInbound = { up: 0, down: 0 };

    data.stat.forEach(item => {
      const parts = item.name.split('>>>');
      if (parts.length === 4 && parts[0] === 'user') {
        const username = parts[1];
        const direction = parts[3]; // 'uplink' or 'downlink'
        
        if (!users[username]) {
          users[username] = { up: 0, down: 0 };
        }
        
        if (direction === 'uplink') users[username].up = item.value || 0;
        if (direction === 'downlink') users[username].down = item.value || 0;
      } else if (parts[0] === 'inbound' || parts[0] === 'outbound') {
         // Cuma buat rekap jika dibutuhkan
      }
    });

    let message = '📊 *Xray VPN Traffic (Per User)*\n\n';
    
    const userKeys = Object.keys(users);
    if (userKeys.length === 0) {
      return message + 'Belum ada trafik user yang tercatat hari ini.';
    }

    userKeys.forEach(username => {
      const up = formatBytes(users[username].up);
      const down = formatBytes(users[username].down);
      message += `👤 *User:* ${username}\n`;
      message += `   ⬇️ Download: ${down}\n`;
      message += `   ⬆️ Upload: ${up}\n\n`;
    });

    return message.trim();
  } catch (err) {
    return `❌ Gagal mengambil data Xray: ${err.message}`;
  }
}

module.exports = { getXrayStats };