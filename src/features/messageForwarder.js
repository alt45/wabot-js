import baileys from '@whiskeysockets/baileys';
import config from '../core/config.js';
import logger from '../core/logger.js';

const { getContentType, jidNormalizedUser } = baileys;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function forwardMessage(sock, msg) {
  try {
    const from = jidNormalizedUser(msg.key.remoteJid);
    if (from !== config.sourceGroupId) {
      return;
    }
    if (msg.key.fromMe) {
        return;
    }
    const type = getContentType(msg.message);
    const supportedTypes = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage'];
    if (supportedTypes.includes(type)) {
      const senderName = msg.pushName || from;
      const forwardMessage = `Pesan diteruskan dari: ${senderName}`;

      await delay(Math.random() * (1500 - 500) + 500);
      await sock.sendMessage(config.targetGroupId, { text: forwardMessage });

      await delay(Math.random() * (1500 - 500) + 500);
      await sock.sendMessage(config.targetGroupId, {
        forward: msg
      });
      logger.info(`Pesan dari ${senderName} berhasil diteruskan ke ${config.targetGroupId}`);
    }
  } catch (error) {
    logger.error(`Gagal meneruskan pesan: ${error.message}`);
  }
}