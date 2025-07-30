import 'dotenv/config'; // Muat .env di baris paling atas
import connectToWhatsApp from './core/baileys.js';
import logger from './core/logger.js';
import { logMessage } from './features/messageLogger.js';
import { forwardMessage } from './features/messageForwarder.js';
import { handleMissedCall } from './features/callHandler.js';
import { saveMedia } from './features/mediaSaver.js';

async function main() {
  try {
    logger.info('Memulai bot...');
    const sock = await connectToWhatsApp();

    // Listener untuk pesan masuk
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      logger.debug(`Pesan masuk diterima (RAW): ${JSON.stringify(msg, null, 2)}`);
      if (!msg.message) return;

      // 1. Tangani panggilan tak terjawab terlebih dahulu
      const isCallHandled = await handleMissedCall(sock, msg);
      if (isCallHandled) return; // Jika sudah ditangani, hentikan proses lebih lanjut

      // 2. Simpan media jika ada
      const isMediaSaved = await saveMedia(sock, msg);
      if (isMediaSaved) return; // Jika media disimpan, hentikan proses lebih lanjut

      // 3. Jalankan fitur pencatatan pesan
      logMessage(msg);

      // 4. Jalankan fitur penerusan pesan
      await forwardMessage(sock, msg);
    });

    // Listener untuk event lainnya
    sock.ev.on('connection.update', (update) => {
      logger.debug(`Event connection.update: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('creds.update', (update) => {
      logger.debug(`Event creds.update: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('messages.update', (update) => {
      logger.debug(`Event messages.update: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('group-participants.update', (update) => {
      logger.debug(`Event group-participants.update: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('presence.update', (update) => {
      logger.debug(`Event presence.update: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('chats.upsert', (update) => {
      logger.debug(`Event chats.upsert: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('chats.update', (update) => {
      logger.debug(`Event chats.update: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('chats.delete', (update) => {
      logger.debug(`Event chats.delete: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('contacts.upsert', (update) => {
      logger.debug(`Event contacts.upsert: ${JSON.stringify(update, null, 2)}`);
    });

    sock.ev.on('contacts.update', (update) => {
      logger.debug(`Event contacts.update: ${JSON.stringify(update, null, 2)}`);
    });

  } catch (error) {
    logger.fatal(`Gagal memulai bot: ${error.message}`);
    process.exit(1);
  }
}

main();
