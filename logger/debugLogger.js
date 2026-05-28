const config = require('../config')

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  boldGreen: '\x1b[1;32m',
  boldRed: '\x1b[1;31m',
  boldBlue: '\x1b[1;34m',
  boldCyan: '\x1b[1;36m'
}

function getTimestamp() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const log = {
  system: (msg) => {
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.boldBlue}[SYSTEM]${colors.reset} ${msg}`)
  },
  socket: (msg) => {
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.magenta}[SOCKET]${colors.reset} ${msg}`)
  },
  command: (cmd, sender, msg) => {
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.green}[COMMAND:${cmd.toUpperCase()}]${colors.reset} dari ${colors.cyan}${sender}${colors.reset}: ${msg}`)
  },
  web: (method, url, status, time = '') => {
    const statusColor = status >= 400 ? colors.red : status >= 300 ? colors.yellow : colors.green
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.yellow}[WEB:${method}]${colors.reset} ${url} - ${statusColor}${status}${colors.reset} ${time ? `(${time}ms)` : ''}`)
  },
  debug: (tag, msg) => {
    if (config.DEBUG) {
      console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.cyan}[DEBUG:${tag.toUpperCase()}]${colors.reset} ${msg}`)
    }
  },
  success: (msg) => {
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.boldGreen}[SUCCESS]${colors.reset} ${msg}`)
  },
  warn: (msg) => {
    console.log(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${msg}`)
  },
  error: (tag, msg, err = '') => {
    console.error(`${colors.gray}[${getTimestamp()}]${colors.reset} ${colors.boldRed}[ERROR:${tag.toUpperCase()}]${colors.reset} ${msg} ${err ? `\n${colors.red}${err.stack || err}${colors.reset}` : ''}`)
  }
}

module.exports = log
