const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getTraffic() {
  try {
    const rxFile = '/sys/class/net/eth0/statistics/rx_bytes';
    const txFile = '/sys/class/net/eth0/statistics/tx_bytes';
    
    // Fungsi untuk membaca bytes dari file
    const readBytes = () => {
      let rx = 0, tx = 0;
      if (fs.existsSync(rxFile)) {
        rx = parseInt(fs.readFileSync(rxFile, 'utf8').trim()) || 0;
      }
      if (fs.existsSync(txFile)) {
        tx = parseInt(fs.readFileSync(txFile, 'utf8').trim()) || 0;
      }
      return { rx, tx };
    };

    // Bacaan pertama
    const t1 = readBytes();
    
    // Tunggu 1 detik
    await sleep(1000);
    
    // Bacaan kedua
    const t2 = readBytes();

    // Hitung kecepatan (bytes per detik)
    const rxSpeed = t2.rx - t1.rx;
    const txSpeed = t2.tx - t1.tx;

    // Fungsi format untuk total (GB/MB dll)
    const formatTotal = (bytes) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Fungsi format untuk kecepatan (Mbps = Megabits per second)
    const formatSpeed = (bytesPerSec) => {
      // Ubah bytes per detik ke Megabits per detik (Mbps)
      // 1 Byte = 8 bits
      const mbps = (bytesPerSec * 8) / 1000000;
      return mbps.toFixed(2) + ' Mbps';
    };

    const totalRx = formatTotal(t2.rx);
    const totalTx = formatTotal(t2.tx);
    const speedRx = formatSpeed(rxSpeed);
    const speedTx = formatSpeed(txSpeed);

    return `📊 *Server Traffic (eth0)*\n\n` +
           `⚡ *Live Speed:*\n` +
           `⬇️ Download: ${speedRx}\n` +
           `⬆️ Upload: ${speedTx}\n\n` +
           `📦 *Total Usage:*\n` +
           `⬇️ Total DL: ${totalRx}\n` +
           `⬆️ Total UL: ${totalTx}`;
  } catch (err) {
    return `❌ Gagal mengambil data traffic: ${err.message}`;
  }
}

module.exports = { getTraffic };
