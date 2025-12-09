import fs from 'fs';
import { format } from 'date-fns';
import baileys from '@whiskeysockets/baileys';
import logger from '../core/logger.js';

const { getContentType, jidNormalizedUser } = baileys;
const LOG_FILE = './logs/conversations.log';

if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

function getMessageContent(message) {
  const type = getContentType(message);
  if (type === 'conversation') return message.conversation;
  if (type === 'extendedTextMessage') return message.extendedTextMessage.text;
  if (type === 'imageMessage') return message.imageMessage.caption || '[Image]';
  if (type === 'videoMessage') return message.videoMessage.caption || '[Video]';
  if (type === 'audioMessage') return '[Voice Message]';
  if (type === 'documentMessage') return '[Document]';
  if (type === 'locationMessage') {
    const { degreesLatitude, degreesLongitude } = message.locationMessage;
    return `[Location] Lat: ${degreesLatitude}, Lon: ${degreesLongitude}`;
  }
  return `[${type}]`;
}

export function logMessage(msg) {
  try {
    if (msg.key.fromMe) {
      return;
    }
    let from = jidNormalizedUser(msg.key.remoteJid);
    if (from === 'status@broadcast' && msg.participant) {
      from = `status@${jidNormalizedUser(msg.participant)}`;
    }
    const type = getContentType(msg.message);
    const content = getMessageContent(msg.message);
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
    const logEntry = `${timestamp} : ${from} : ${type} : ${content}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (error) {
    logger.error(`Gagal mencatat pesan: ${error.message}`);
  }
}