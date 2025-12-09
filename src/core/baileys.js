import baileys, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import logger from './logger.js';

const makeWASocket = baileys.default;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    browser: ['Safari', 'MacOS', '10.15.7'],
    logger: pino({ level: process.env.LOG_LEVEL || 'info' }),
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n\n------------------------------------------------');
      console.log('            SCAN THE QR CODE BELOW            ');
      console.log('------------------------------------------------\n');
      qrcode.generate(qr, { small: true });
      console.log('\n------------------------------------------------');
      console.log('1. Buka WhatsApp di ponsel Anda.');
      console.log('2. Buka Pengaturan > Perangkat Tertaut > Tautkan Perangkat.');
      console.log('3. Pindai kode QR di atas.');
      console.log('------------------------------------------------\n');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
      logger.warn(`Koneksi ditutup karena: ${lastDisconnect.error}, menyambungkan kembali: ${shouldReconnect}`);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      logger.info('Koneksi WhatsApp berhasil dibuka.');
    }
  });

  return sock;
}

export default connectToWhatsApp;
