import logger from '../core/logger.js';
import { fetchWeather } from './cuaca.js';
import { fetchBmkgImage } from './bmkgimg.js';
import { fetchGempa } from './gempa.js'; // Impor fungsi gempa
// Impor fungsi aksi lainnya di sini di masa depan
// import { captureCCTV } from './cctv.js';

const actionMap = {
  fetchWeather,
  fetchBmkgImage,
  fetchGempa, // Tambahkan aksi gempa ke peta
  // captureCCTV,
};

/**
 * Handles actions triggered by the auto-responder.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - The socket instance.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg - The message object.
 * @param {string[]} actions - The array of actions to execute.
 */
export async function handleActions(sock, msg, actions) {
  for (const actionName of actions) {
    const action = actionMap[actionName];
    if (action) {
      try {
        logger.info(`Executing action: ${actionName}`);
        await action(sock, msg);
      } catch (error) {
        logger.error(`Error executing action ${actionName}: ${error.message}`);
      }
    } else {
      logger.warn(`Unknown action: ${actionName}`);
    }
  }
}
