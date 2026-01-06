import logger from './logger.js';

const config = {
  sourceGroupId: process.env.SOURCE_GROUP_ID,
  targetGroupId: process.env.TARGET_GROUP_ID,
  logLevel: process.env.LOG_LEVEL || 'info',

  // Fitur flags
  featureFlags: {
    messageLogger: process.env.FEATURE_MESSAGELOGGER_ENABLED?.toLowerCase() !== 'false',
    messageForwarder: process.env.FEATURE_MESSAGEFORWARDER_ENABLED?.toLowerCase() !== 'false',
    callHandler: process.env.FEATURE_CALLHANDLER_ENABLED?.toLowerCase() !== 'false',
    mediaSaver: process.env.FEATURE_MEDIASAVER_ENABLED?.toLowerCase() !== 'false',
    autoResponder: process.env.FEATURE_AUTORESPONDER_ENABLED?.toLowerCase() !== 'false',
    gempa: process.env.FEATURE_GEMPA_ENABLED?.toLowerCase() !== 'false',
    cuaca: process.env.FEATURE_CUACA_ENABLED?.toLowerCase() !== 'false',
    bmkgimg: process.env.FEATURE_BMKGIMG_ENABLED?.toLowerCase() !== 'false',
    actionHandler: process.env.FEATURE_ACTIONHANDLER_ENABLED?.toLowerCase() !== 'false',
  },
};

// Validasi konfigurasi
if (!config.sourceGroupId || !config.targetGroupId) {
  logger.error('SOURCE_GROUP_ID dan TARGET_GROUP_ID harus diisi di file .env');
  process.exit(1);
}

export default config;
