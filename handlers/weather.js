const axios  = require('axios')
const config = require('../config')

const EMOJI_MAP = {
  Thunderstorm: '⛈️', Drizzle: '🌦️', Rain: '🌧️',
  Snow: '❄️', Clear: '☀️', Clouds: '☁️',
  Mist: '🌫️', Fog: '🌫️', Haze: '🌫️',
}

async function getWeather(args) {
  const city = args.join(' ') || config.DEFAULT_CITY

  if (!config.WEATHER_API_KEY) {
    return '⚠️ WEATHER_API_KEY belum diset di .env'
  }

  try {
    const res = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        q:     city,
        appid: config.WEATHER_API_KEY,
        units: 'metric',
        lang:  'id'
      },
      timeout: 8000
    })

    const d        = res.data
    const name     = d.name
    const country  = d.sys?.country
    const temp     = Math.round(d.main?.temp)
    const feels    = Math.round(d.main?.feels_like)
    const humidity = d.main?.humidity
    const wind     = d.wind?.speed
    const desc     = d.weather?.[0]?.description ?? '-'
    const main     = d.weather?.[0]?.main ?? ''
    const icon     = EMOJI_MAP[main] || '🌡️'

    return `${icon} *Cuaca ${name}, ${country}*

🌡️ Suhu       : ${temp}°C (terasa ${feels}°C)
💧 Kelembapan : ${humidity}%
💨 Angin      : ${wind} m/s
📋 Kondisi    : ${desc}

_Data dari OpenWeatherMap_`

  } catch (e) {
    if (e.response?.status === 404) {
      return `❌ Kota *${city}* tidak ditemukan.`
    }
    return `❌ Gagal ambil data cuaca: ${e.message}`
  }
}

module.exports = { getWeather }
