import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import logger from '../core/logger.js';

const BASE_DATA_DIR = './data';
const MEDIA_DIRS = {
  image: path.join(BASE_DATA_DIR, 'img'),
  video: path.join(BASE_DATA_DIR, 'video'),
  audio: path.join(BASE_DATA_DIR, 'voice'),
  document: path.join(BASE_DATA_DIR, 'doc'),
};

// Pastikan semua direktori media ada
Object.values(MEDIA_DIRS).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

export async function saveMedia(sock, msg) {
  // Jangan proses pesan yang dikirim oleh bot itu sendiri
  if (msg.key.fromMe) {
    logger.debug('Melewatkan penyimpanan media karena pesan berasal dari bot sendiri.');
    return false;
  }

  const senderJid = msg.key.participant || msg.key.remoteJid;
  try {
    const messageType = getContentType(msg.message);

    // Fungsi bantuan untuk menghasilkan nama file yang konsisten
    const generateFilename = (extension) => {
      const jidNumber = senderJid.split('@')[0];
      // Sanitize pushName: convert to lowercase, replace spaces with hyphens,
      // and remove any character that is not alphanumeric or hyphen.
      const sanitizedPushName = msg.pushName
        ? msg.pushName
            .toLowerCase() // Convert to lowercase
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/[^a-z0-9-]/g, '') // Remove non-alphanumeric, non-hyphen characters
        : 'unknown';
      const timestamp = new Date().getTime();
      return `${sanitizedPushName}_${jidNumber}_${timestamp}${extension}`;
    };

    let mediaMessage, mediaType, stream;
    let filename = '';

    switch (messageType) {
      case 'imageMessage':
        mediaMessage = msg.message.imageMessage;
        if (!mediaMessage?.mediaKey) {
          logger.warn('Skipping image download due to empty mediaKey.');
          return false;
        }
        mediaType = 'image';
        stream = await downloadContentFromMessage(mediaMessage, 'image');
        filename = path.join(MEDIA_DIRS.image, generateFilename('.jpeg'));
        break;
      case 'videoMessage':
        mediaMessage = msg.message.videoMessage;
        if (!mediaMessage?.mediaKey) {
          logger.warn('Skipping video download due to empty mediaKey.');
          return false;
        }
        mediaType = 'video';
        stream = await downloadContentFromMessage(mediaMessage, 'video');
        filename = path.join(MEDIA_DIRS.video, generateFilename('.mp4'));
        break;
      case 'audioMessage':
        mediaMessage = msg.message.audioMessage;
        if (!mediaMessage?.mediaKey) {
          logger.warn('Skipping audio download due to empty mediaKey.');
          return false;
        }
        mediaType = 'audio';
        stream = await downloadContentFromMessage(mediaMessage, 'audio');
        filename = path.join(MEDIA_DIRS.audio, generateFilename('.ogg'));
        break;
      case 'documentMessage':
        mediaMessage = msg.message.documentMessage;
        if (!mediaMessage?.mediaKey) {
          logger.warn('Skipping document download due to empty mediaKey.');
          return false;
        }
        mediaType = 'document';
        stream = await downloadContentFromMessage(mediaMessage, 'document');
        const originalFilename = mediaMessage.fileName || '';
        const extension = path.extname(originalFilename);
        filename = path.join(MEDIA_DIRS.document, generateFilename(extension));
        break;
      default:
        return false; // Bukan tipe media yang didukung untuk disimpan
    }

    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    fs.writeFileSync(filename, buffer);
    logger.info(`Media (${mediaType}) berhasil disimpan ke: ${filename}`);
    return true;

  } catch (error) {
    logger.error(`Gagal mengunduh atau menyimpan media dari ${senderJid}: ${error.message}`);
    if (error.message.includes('ETIMEDOUT')) {
      logger.warn('Kesalahan timeout koneksi terdeteksi. Mengabaikan media.');
    }
    return false; // Mencegah crash
  }
}
