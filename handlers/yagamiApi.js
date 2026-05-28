const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('../logger/debugLogger');

// Cache daftar produk Yagami Cell
let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 menit

// State pesanan yang menunggu konfirmasi (key: sender JID, value: order info)
const pendingOrders = new Map();

/**
 * Normalisasi format nomor telepon untuk Yagami Cell API.
 * Menghapus karakter non-digit dan menstandarkan format ke 08...
 */
function normalizeYagamiPhone(num) {
  let cleaned = String(num).replace(/\D/g, '');
  if (cleaned.startsWith('62')) {
    cleaned = '0' + cleaned.slice(2);
  }
  return cleaned;
}

/**
 * Memetakan input metode pembayaran dari pengguna ke nilai parameter Yagami API.
 */
function mapPaymentMethod(input) {
  if (!input) return 'balance';
  const clean = input.toLowerCase().trim();
  if (clean === 'balance' || clean === 'saldo') {
    return 'balance';
  }
  if (clean === 'qr' || clean === 'qris' || clean === 'qris_payment' || clean === 'qrispayment') {
    return 'qris_payment';
  }
  if (clean === 'qris2' || clean === 'qris 2' || clean === 'qris_payment 2' || clean === 'qris_payment2') {
    return 'qris_payment2';
  }
  return input; // fallback ke input asli
}

/**
 * Mengambil link pembayaran eksternal dari riwayat transaksi Yagami Cell menggunakan session cookie dari berkas .env.
 */
async function getExternalPaymentLink(trxId) {
  try {
    const cookieHeader = config.YAGAMI_COOKIES;
    if (!cookieHeader) {
      log.debug('yagami_scrape', 'YAGAMI_COOKIES belum diatur di berkas .env!');
      return null;
    }

    const url = `https://yagami-cell.com/akun/riwayat-transaksi/view/${trxId}`;
    log.debug('yagami_scrape', `Melakukan scraping link bayar eksternal untuk TRX #${trxId} menggunakan YAGAMI_COOKIES dari .env`);

    const res = await axios.get(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const html = res.data;
    const regex = /href="(https:\/\/passport\.duitku\.com\/topup\/topupdirectv2\.aspx[^"]+)"/i;
    const match = html.match(regex);
    if (match) {
      log.debug('yagami_scrape', `Berhasil menemukan link bayar eksternal: ${match[1]}`);
      return match[1];
    } else {
      log.debug('yagami_scrape', `Link bayar eksternal tidak ditemukan di HTML transaksi #${trxId}`);
    }
  } catch (err) {
    log.error('yagami_scrape', `Gagal mengambil link pembayaran eksternal untuk TRX #${trxId}: ${err.message}`);
  }
  return null;
}

/**
 * Membaca kredensial Yagami Cell dari berkas konfigurasi lingkungan (.env).
 */
function getCredentials() {
  const username = config.YAGAMI_USERNAME;
  const token = config.YAGAMI_TOKEN;

  if (!username || !token) {
    throw new Error('Kredensial YAGAMI_USERNAME atau YAGAMI_TOKEN belum diatur di berkas .env!');
  }

  return {
    auth_username: username,
    auth_token: token
  };
}

/**
 * Mengambil data rincian akun dan saldo Yagami Cell.
 */
async function getYagamiSaldo() {
  const credentials = getCredentials();
  const params = new URLSearchParams();
  params.append('auth_username', credentials.auth_username);
  params.append('auth_token', credentials.auth_token);

  log.debug('yagami', `Mengecek saldo Yagami Cell untuk user: ${credentials.auth_username}`);

  const res = await axios.post('https://yagami-cell.com/api/main/account', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000
  });

  log.debug('yagami_raw', `Raw Saldo Response:\n${JSON.stringify(res.data, null, 2)}`);

  if (!res.data?.success) {
    throw new Error(res.data?.message || res.data?.results || 'Gagal mengambil data saldo');
  }

  return res.data.results;
}

/**
 * Memfilter daftar produk secara lokal.
 */
function filterProducts(list, filterStr) {
  if (!filterStr) return list;
  const query = filterStr.toLowerCase();
  return list.filter(item => {
    const nominal = (item.nominal || '').toLowerCase();
    const provider = (item.provider?.nama || '').toLowerCase();
    const produkNama = (item.produk?.nama || '').toLowerCase();
    return nominal.includes(query) || provider.includes(query) || produkNama.includes(query);
  });
}

/**
 * Mengambil daftar produk (vouchers) dan memfilternya berdasarkan query string.
 * Menggunakan in-memory caching selama 5 menit.
 */
async function getYagamiProducts(filterStr = '', forceRefresh = false) {
  if (cachedProducts && (Date.now() - cacheTimestamp < CACHE_TTL) && !forceRefresh) {
    log.debug('yagami', 'Mengambil daftar produk dari cache');
    return filterProducts(cachedProducts, filterStr);
  }

  const credentials = getCredentials();
  const params = new URLSearchParams();
  params.append('auth_username', credentials.auth_username);
  params.append('auth_token', credentials.auth_token);

  log.debug('yagami', `Mengambil daftar voucher/produk Yagami Cell dari API`);

  const res = await axios.post('https://yagami-cell.com/api/main/get-vouchers', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });

  log.debug('yagami_raw', `Raw Vouchers Response (Sliced):\n${JSON.stringify(res.data, null, 2).slice(0, 500)}...`);

  if (!res.data?.success) {
    throw new Error(res.data?.message || res.data?.results || 'Gagal mengambil daftar produk');
  }

  cachedProducts = res.data.results || [];
  cacheTimestamp = Date.now();

  return filterProducts(cachedProducts, filterStr);
}

/**
 * Melakukan order produk Yagami Cell.
 */
async function orderYagamiProduct(voucherId, phone, paymentMethod = 'balance') {
  const credentials = getCredentials();
  const params = new URLSearchParams();
  params.append('auth_username', credentials.auth_username);
  params.append('auth_token', credentials.auth_token);
  params.append('voucher_id', voucherId);
  params.append('phone', phone);
  params.append('payment', paymentMethod);

  log.debug('yagami', `Membuat pesanan Yagami Cell: Voucher ID ${voucherId} ke ${phone} via ${paymentMethod}`);

  const res = await axios.post('https://yagami-cell.com/api/main/order', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });

  log.debug('yagami_raw', `Raw Order Response:\n${JSON.stringify(res.data, null, 2)}`);

  if (!res.data?.success) {
    throw new Error(res.data?.message || res.data?.results || 'Gagal membuat pesanan');
  }

  return res.data.results;
}

/**
 * Mengambil detail status transaksi berdasarkan ID Transaksi.
 */
async function getTransactionDetails(trxId) {
  const credentials = getCredentials();
  const params = new URLSearchParams();
  params.append('auth_username', credentials.auth_username);
  params.append('auth_token', credentials.auth_token);
  params.append('id', trxId);

  log.debug('yagami', `Mengecek status transaksi ID: ${trxId}`);

  const res = await axios.post('https://yagami-cell.com/api/main/transaction-details', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000
  });

  log.debug('yagami_raw', `Raw Trx Details Response:\n${JSON.stringify(res.data, null, 2)}`);

  if (!res.data?.success) {
    throw new Error(res.data?.message || res.data?.results || 'Gagal mengambil detail transaksi');
  }

  return res.data.results;
}

/**
 * Memeriksa apakah transaksi menggunakan metode pembayaran QRIS / QR.
 */
function isQrisPayment(results) {
  const p = results?.pembayaran;
  if (!p) return false;
  const name = typeof p === 'object' ? (p.nama || '') : String(p);
  const nameLower = name.toLowerCase();
  return nameLower.includes('qris') || nameLower.includes('qr');
}

module.exports = {
  pendingOrders,
  normalizeYagamiPhone,
  mapPaymentMethod,
  getExternalPaymentLink,
  getYagamiSaldo,
  getYagamiProducts,
  orderYagamiProduct,
  getTransactionDetails,
  isQrisPayment
};
