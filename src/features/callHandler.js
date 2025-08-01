import logger from '../core/logger.js';

// Peta untuk melacak status terakhir dari setiap panggilan berdasarkan ID-nya
const callState = new Map();

/**
 * Handles universal call events with stateful logic.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - The socket instance.
 * @param {Array<import('@whiskeysockets/baileys').Call>} calls - The call events.
 */
export async function handleCallEvent(sock, calls) {
  for (const call of calls) {
    const callId = call.id;
    const from = call.from;
    const currentStatus = call.status;
    const previousStatus = callState.get(callId);

    // Log setiap event untuk debugging
    logger.debug(
      `Event Panggilan: ID=${callId}, Dari=${from}, Status Saat Ini=${currentStatus}, Status Sebelumnya=${previousStatus || 'N/A'}`
    );

    // Kondisi: Kirim pesan jika panggilan berubah dari 'offer' (berdering) ke 'terminated' (berakhir/tak terjawab)
    if (previousStatus === 'ringing' && currentStatus === 'terminate') {
      logger.info(`Panggilan dari ${from} tidak terjawab (offer -> terminated). Mengirim pesan balasan.`);
      try {
        const replyText = 'Halo, maaf panggilan Anda tidak terjawab. Silakan tinggalkan pesan teks jika ada yang penting. Terima kasih!';
        await sock.sendMessage(from, { text: replyText });
        logger.info(`Berhasil mengirim balasan panggilan tak terjawab ke ${from}`);
      } catch (error) {
        logger.error(`Gagal mengirim balasan panggilan tak terjawab ke ${from}: ${error.message}`);
      }
    }

    if (previousStatus === 'reject' && currentStatus === 'terminate') {
      logger.info(`Panggilan dari ${from} tidak terjawab (offer -> terminated). Mengirim pesan balasan.`);
      try {
        const replyText = 'Halo, maaf panggilan Tidak menerima Panggilan. Silakan tinggalkan pesan teks jika ada yang penting. Terima kasih!';
        await sock.sendMessage(from, { text: replyText });
        logger.info(`Berhasil mengirim balasan panggilan tak terjawab ke ${from}`);
      } catch (error) {
        logger.error(`Gagal mengirim balasan panggilan tak terjawab ke ${from}: ${error.message}`);
      }
    }

    // Perbarui status panggilan saat ini ke dalam peta
    callState.set(callId, currentStatus);

    // Hapus state panggilan jika sudah dalam status akhir untuk menghemat memori
    if (['terminated', 'reject', 'timeout'].includes(currentStatus)) {
      //callState.delete(callId);
      logger.debug(`State untuk panggilan ${callId} telah dihapus dari memori.`);
    }
  }
}
