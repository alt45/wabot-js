import logger from '../core/logger.js';

/**
 * Fetches weather from wttr.in and sends it to the user.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - The socket instance.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg - The message object.
 */
export async function fetchWeather(sock, msg) {
  const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
  const parts = messageText.split(' ');
  let location = parts.length > 1 ? parts.slice(1).join(' ') : 'Jakarta'; // Default to Jakarta if no location is provided

  logger.info(`Fetching weather for location: ${location}`);

  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=4`);
    if (!response.ok) {
      throw new Error(`Failed to fetch weather, status: ${response.status}`);
    }
    const weatherText = await response.text();
    await sock.sendMessage(msg.key.remoteJid, { text: weatherText }, { quoted: msg });
  } catch (error) {
    logger.error(`Failed to fetch weather for ${location}: ${error.message}`);
    await sock.sendMessage(msg.key.remoteJid, { text: `Maaf, gagal mendapatkan data cuaca untuk ${location}.` }, { quoted: msg });
  }
}
