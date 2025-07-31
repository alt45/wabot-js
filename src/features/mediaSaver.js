import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import logger from '../core/logger.js';

const BASE_DATA_DIR = './data';
const MEDIA_DIRS = {
  image: path.join(BASE_DATA_DIR, 'img'),
  video: path.join(BASE_DATA_DIR, 'video'), // Tambahkan direktori video jika diperlukan
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
  const messageType = getContentType(msg.message);
  const senderJid = msg.key.participant || msg.key.remoteJid;
  let mediaType, stream;
  let filename = '';

  switch (messageType) {
    case 'imageMessage':
      mediaType = 'image';
      stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
      filename = path.join(MEDIA_DIRS.image, `${senderJid}_${new Date().getTime()}.jpeg`);
      break;
    case 'videoMessage':
      mediaType = 'video';
      stream = await downloadContentFromMessage(msg.message.videoMessage, 'video');
      filename = path.join(MEDIA_DIRS.video, `${senderJid}_${new Date().getTime()}.mp4`);
      break;
    case 'audioMessage':
      mediaType = 'audio';
      stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
      filename = path.join(MEDIA_DIRS.audio, `${senderJid}_${new Date().getTime()}.ogg`); // Atau .mp3, .opus
      break;
    case 'documentMessage':
      mediaType = 'document';
      stream = await downloadContentFromMessage(msg.message.documentMessage, 'document');
      const originalFilename = msg.message.documentMessage.fileName || `${new Date().getTime()}`;
      filename = path.join(MEDIA_DIRS.document, `${senderJid}_${originalFilename}`);
      break;
    default:
      return false; // Bukan tipe media yang didukung untuk disimpan
  }

  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }

  try {
    fs.writeFileSync(filename, buffer);
    logger.info(`Media (${mediaType}) berhasil disimpan ke: ${filename}`);
    // Opsional: Kirim konfirmasi ke pengirim
    // await sock.sendMessage(msg.key.remoteJid, { text: `Media Anda telah disimpan di ${mediaType}.` });
    return true;
  } catch (error) {
    logger.error(`Gagal menyimpan media (${mediaType}) ke ${filename}: ${error.message}`);
    return false;
  }
}
