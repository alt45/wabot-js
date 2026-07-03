const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function getXrayIPs() {
  try {
    // Ambil 500 baris terakhir dari access.log, cari kata "accepted" dan "email:"
    const { stdout } = await execPromise('tail -n 500 /var/log/xray/access.log | grep "accepted" | grep "email:"');
    
    const lines = stdout.split('\\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return 'Belum ada data IP masuk di log terbaru.';

    const activeUsers = {};

    lines.forEach(line => {
      // Format log: 2026/05/30 16:22:12.712103 from 112.215.133.105:0 accepted tcp:www.gstatic.com:80 email: stbmove
      const parts = line.split(' ');
      const ipPort = parts[3]; // "112.215.133.105:0"
      if (!ipPort) return;
      
      const ip = ipPort.split(':')[0];
      
      const emailIndex = parts.indexOf('email:');
      if (emailIndex !== -1 && parts[emailIndex + 1]) {
        const username = parts[emailIndex + 1];
        if (!activeUsers[username]) activeUsers[username] = new Set();
        activeUsers[username].add(ip);
      }
    });

    let message = '🌐 *Live IP Address (Xray VPN)*\n\n';
    const userKeys = Object.keys(activeUsers);
    
    if (userKeys.length === 0) return 'Tidak ada IP yang terdeteksi konek.';

    userKeys.forEach(username => {
      message += `👤 *User:* ${username}\n`;
      const ips = Array.from(activeUsers[username]);
      ips.forEach(ip => {
        message += `   📡 IP: ${ip}\n`;
      });
      message += '\n';
    });

    return message.trim();
  } catch (err) {
    return `❌ Gagal membaca log IP Xray: ${err.message}`;
  }
}

module.exports = { getXrayIPs };