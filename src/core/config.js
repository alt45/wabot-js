import logger from './logger.js';

const config = {
  sourceGroupId: process.env.SOURCE_GROUP_ID,
  targetGroupId: process.env.TARGET_GROUP_ID,
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validasi konfigurasi
if (!config.sourceGroupId || !config.targetGroupId) {
  logger.error('SOURCE_GROUP_ID dan TARGET_GROUP_ID harus diisi di file .env');
  process.exit(1);
}

export default config;
