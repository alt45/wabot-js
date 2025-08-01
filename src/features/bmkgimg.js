import logger from '../core/logger.js';
import axios from 'axios';
import os from 'os';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';

// Muat data URL BMKG sekali saat modul dimuat
const bmkgUrlData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'bmkgurl.json')));

/**
 * Mengambil gambar dari URL yang ditentukan di bmkgurl.json berdasarkan kata kunci.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instans soket.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg - Objek pesan.
 */
export async function fetchBmkgImage(sock, msg) {
  const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
  const parts = messageText.split(' ');
  const keyword = parts.length > 1 ? parts[1] : null;
  const sender = msg.key.remoteJid;

  if (!keyword) {
    await sock.sendMessage(sender, { text: 'Silakan berikan kata kunci gambar yang ingin dicari (contoh: arahangin, awan, uapair).' }, { quoted: msg });
    return;
  }

  const rule = bmkgUrlData.find(r => r.keywords.includes(keyword));

  if (!rule) {
    await sock.sendMessage(sender, { text: `Maaf, kata kunci '${keyword}' tidak ditemukan.` }, { quoted: msg });
    return;
  }

  logger.info(`Mengambil gambar BMKG untuk kata kunci: ${keyword}`);
  let tempFilePath; // Didefinisikan di sini agar dapat diakses di blok finally

  try {
    logger.debug(`Mencoba mengunduh gambar dari: ${rule.urlapi.trim()}`);
    const response = await axios.get(rule.urlapi.trim(), { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);
    
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `${keyword}_${Date.now()}.jpg`);

    await fsp.writeFile(tempFilePath, imageBuffer);
    logger.debug(`Gambar berhasil diunduh ke: ${tempFilePath}`);

    const caption = `Ini datanya gambar: ${keyword}`;
    await sock.sendMessage(sender, { image: { url: tempFilePath }, caption: caption });
    logger.info(`Gambar BMKG berhasil dikirim ke ${sender} dari file sementara.`);
    
  } catch (error) {
    logger.error(`Gagal mengambil gambar BMKG untuk ${keyword}: ${error.message}`);
    await sock.sendMessage(sender, { text: `Maaf, gagal mendapatkan gambar untuk '${keyword}'.` }, { quoted: msg });
  } finally {
    // Hapus file sementara jika sudah dibuat
    if (tempFilePath) {
      try {
        await fsp.unlink(tempFilePath);
        logger.debug(`File sementara ${tempFilePath} berhasil dihapus.`);
      } catch (cleanupError) {
        logger.error(`Gagal menghapus file sementara ${tempFilePath}: ${cleanupError.message}`);
      }
    }
  }
}

