require('dotenv').config()

module.exports = {
  PREFIX:          process.env.BOT_PREFIX     || '!',
  TARGET_GROUP_ID: (process.env.TARGET_GROUP_ID || '').split(',').map(id => id.trim()).filter(id => id),
  WEB_PORT:        parseInt(process.env.WEB_PORT) || 3000,
  TZ:              process.env.TZ             || 'Asia/Jakarta',
  WEATHER_API_KEY: process.env.WEATHER_API_KEY || '',
  DEFAULT_CITY:    process.env.DEFAULT_CITY   || 'Semarang',
  OWNER_NUMBER:    process.env.OWNER_NUMBER   || '', // Contoh: 628123456789
  ADMIN_PASSWORD:  process.env.ADMIN_PASSWORD || 'admin123',
  API_TOKEN:       process.env.API_TOKEN      || 'my-secret-token-123',
  YAGAMI_USERNAME: process.env.YAGAMI_USERNAME || '',
  YAGAMI_TOKEN:    process.env.YAGAMI_TOKEN    || '',
  DEBUG:           process.env.DEBUG === 'true',
}
