import logger from '../core/logger.js';
import config from '../core/config.js'; // Impor konfigurasi
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

const actionToFlagMap = {
  fetchWeather: 'cuaca',
  fetchBmkgImage: 'bmkgimg',
  fetchGempa: 'gempa',
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
    const flagName = actionToFlagMap[actionName];

    if (action) {
      // Periksa apakah fitur diaktifkan di konfigurasi
      if (flagName && config.featureFlags[flagName]) {
        try {
          logger.info(`Executing action: ${actionName}`);
          await action(sock, msg);
        } catch (error) {
          logger.error(`Error executing action ${actionName}: ${error.message}`);
        }
      } else {
        logger.warn(`Action '${actionName}' is disabled or has no flag defined. Skipping.`);
      }
    } else {
      logger.warn(`Unknown action: ${actionName}`);
    }
  }
}
