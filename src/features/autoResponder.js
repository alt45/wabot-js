import fs from 'fs';
import path from 'path';
import logger from '../core/logger.js';
import { handleActions } from './actionHandler.js'; // Impor handler aksi

const responseRules = JSON.parse(fs.readFileSync(path.join('./data/actionresponse.json')));

/**
 * Handles automatic responses based on keywords in private messages.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - The socket instance.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg - The message object.
 */
export async function handleAutoResponse(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  logger.debug(`{Proses auto respon} "${JSON.stringify(msg, null, 2)}" `);
  // Abaikan jika tidak ada pesan, pesan dari diri sendiri, grup, atau channel
  if (!msg.message || msg.key.fromMe || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter')) {
    return;
  }

  const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
  logger.debug(`{Proses auto respon} "${messageText}" `);
  if (!messageText) {
    return;
  }

  for (const rule of responseRules) {
    const keywords = rule.keywords.map(k => k.toLowerCase());
    let isMatch = false;

    if (rule.matchType === 'includes') {
      if (keywords.some(keyword => messageText.includes(keyword))) {
        isMatch = true;
      }
    } else if (rule.matchType === 'matches') {
      if (keywords.some(keyword => messageText === keyword)) {
        isMatch = true;
      }
    }

    if (isMatch) {
      logger.info(`Matched keyword in "${messageText}". Responding to ${msg.key.remoteJid}.`);
      
      // Kirim respons teks jika ada
      if (rule.response) {
        await sock.sendMessage(msg.key.remoteJid, { text: rule.response }, { quoted: msg });
      }

      // Jalankan aksi jika ada
      if (rule.actions && rule.actions.length > 0) {
        logger.info(`Triggering actions: ${rule.actions.join(', ')} for ${msg.key.remoteJid}`);
        await handleActions(sock, msg, rule.actions);
      }
      
      // Hentikan pengecekan aturan lain setelah menemukan yang cocok
      break; 
    }
    else {
      logger.debug(`No match for "${messageText}" with rule: ${rule.keywords.join(', ')}`);
    }
  }
}
