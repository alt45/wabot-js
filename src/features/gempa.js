import logger from '../core/logger.js';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';

const BMKG_GEMPA_URL = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.xml';
const BMKG_IMAGE_URL_PREFIX = 'https://static.bmkg.go.id/';

/**
 * Fetches the latest earthquake data from BMKG.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - The socket instance.
 * @param {import('@whiskeysockets/baileys').WAMessage} msg - The message object.
 */
export async function fetchGempa(sock, msg) {
  const sender = msg.key.remoteJid;
  logger.info(`Fetching earthquake data for ${sender}`);

  try {
    // 1. Fetch XML data
    const response = await axios.get(BMKG_GEMPA_URL);
    const xmlData = response.data;

    // 2. Parse XML to JSON
    const parsedData = await parseStringPromise(xmlData, { explicitArray: false });
    const gempa = parsedData.Infogempa.gempa;

    // 3. Extract information
    const tanggal = gempa.Tanggal;
    const jam = gempa.Jam;
    const magnitude = gempa.Magnitude;
    const kedalaman = gempa.Kedalaman;
    const lintang = gempa.Lintang;
    const bujur = gempa.Bujur;
    const wilayah = gempa.Wilayah;
    const potensi = gempa.Potensi;
    const shakemap = gempa.Shakemap;

    // 4. Format the message
    const caption = `
*INFO GEMPA TERKINI*

🗓️ *Tanggal:* ${tanggal}
⏰ *Waktu:* ${jam}

Magnitude: ${magnitude}
Kedalaman: ${kedalaman}
Lokasi: ${lintang} | ${bujur}
Wilayah: ${wilayah}
Potensi: *${potensi}*
    `.trim();

    // 5. Send the image with caption
    const imageUrl = `${BMKG_IMAGE_URL_PREFIX}${shakemap}`;
    logger.debug(`Sending shakemap from: ${imageUrl}`);

    await sock.sendMessage(
      sender,
      {
        image: { url: imageUrl },
        caption: caption,
      },
      { quoted: msg }
    );

    logger.info(`Earthquake info sent successfully to ${sender}`);

  } catch (error) {
    logger.error(`Failed to fetch or process earthquake data: ${error.message}`);
    await sock.sendMessage(
      sender,
      { text: 'Maaf, terjadi kesalahan saat mengambil data gempa terkini.' },
      { quoted: msg }
    );
  }
}
