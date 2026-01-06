import 'dotenv/config'; // Muat .env di baris paling atas
import connectToWhatsApp from './core/baileys.js';
import logger from './core/logger.js';
import config from './core/config.js'; // Impor konfigurasi
import { logMessage } from './features/messageLogger.js';
import { forwardMessage } from './features/messageForwarder.js';
import { handleCallEvent } from './features/callHandler.js'; // Impor handler event panggilan baru
import { saveMedia } from './features/mediaSaver.js';
import { handleAutoResponse } from './features/autoResponder.js';
import startApi from './api.js';

async function main() {
  try {
    logger.info('Memulai bot...');
    const sock = await connectToWhatsApp();
    startApi(sock);

    // Listener untuk pesan masuk
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      logger.debug(`Pesan masuk diterima (RAW): ${JSON.stringify(msg, null, 2)}`); // Mengubah level log menjadi info
      if (!msg.message) return;

      // 1. Simpan media jika ada
      if (config.featureFlags.mediaSaver) {
        const isMediaSaved = await saveMedia(sock, msg);
        //if (isMediaSaved) return; // Jika media disimpan, hentikan proses lebih lanjut
      }

      // 2. Jalankan auto-responder untuk pesan pribadi
      if (config.featureFlags.autoResponder) {
        await handleAutoResponse(sock, msg);
      }

      // 3. Jalankan fitur pencatatan pesan
      if (config.featureFlags.messageLogger) {
        logMessage(msg);
      }

      // 4. Jalankan fitur penerusan pesan
      if (config.featureFlags.messageForwarder) {
        await forwardMessage(sock, msg);
      }
    });

    // Listener untuk event panggilan universal
    sock.ev.on('call', async (calls) => {
      logger.debug(`Event panggilan diterima: ${JSON.stringify(calls, null, 2)}`);
      if (config.featureFlags.callHandler) {
        await handleCallEvent(sock, calls);
      }
    });

    // Listener untuk event lainnya (opsional, bisa disesuaikan)
    // ... (event listener lainnya tetap di sini)

  } catch (error) {
    logger.fatal(`Gagal memulai bot: ${error.message}`);
    process.exit(1);
  }
}

main();
