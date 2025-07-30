import logger from '../core/logger.js';

export async function handleMissedCall(sock, msg) {
  // Periksa apakah pesan ini adalah notifikasi panggilan
  if (msg.message && msg.message.call) {
    const from = msg.key.remoteJid;
    const callData = msg.message.call;

    // callData.isGroupCall akan bernilai true jika ini panggilan grup
    const callType = callData.isGroupCall ? 'grup' : 'pribadi';

    logger.info(`Menerima notifikasi panggilan tak terjawab dari ${from} (tipe: ${callType})`);

    // Kirim balasan otomatis
    const replyText = 'Halo, maaf saya tidak bisa menerima panggilan saat ini. Silakan tinggalkan pesan teks dan saya akan segera meresponsnya. Terima kasih!';
    
    try {
      await sock.sendMessage(from, { text: replyText });
      logger.info(`Berhasil mengirim balasan otomatis panggilan ke ${from}`);
    } catch (error) {
      logger.error(`Gagal mengirim balasan otomatis panggilan ke ${from}: ${error.message}`);
    }

    // Anda juga bisa menandai pesan notifikasi ini sebagai sudah dibaca
    await sock.readMessages([msg.key]);

    return true; // Mengindikasikan bahwa pesan ini sudah ditangani
  }
  return false; // Bukan pesan panggilan
}
