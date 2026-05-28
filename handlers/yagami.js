const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { db } = require('../database/db');
const log = require('../logger/debugLogger');

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
 * Helper untuk mengirimkan balasan pesan WhatsApp dan mencatat ke database obrolan.
 */
async function reply(sock, jid, msg, text) {
  await sock.sendMessage(jid, {
    text,
    contextInfo: {
      stanzaId: msg.key.id,
      participant: msg.key.participant || msg.key.remoteJid,
      quotedMessage: msg.message
    }
  });

  try {
    let groupName = '';
    const isGroup = jid.endsWith('@g.us');
    if (isGroup) {
      groupName = 'Group';
    }
    db.table('chats').insert({
      jid,
      groupName,
      sender: 'Me',
      senderName: 'Bot',
      message: text,
      direction: 'out',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    log.error('reply_log', 'Gagal menyimpan log respon bot Yagami:', e);
  }
}

/**
 * Helper untuk memformat rincian instruksi pembayaran dari Yagami Cell.
 */
function formatPembayaranDetails(results) {
  const p = results.pembayaran;
  if (!p) return '';

  let text = `💳 *DETAIL PEMBAYARAN*\n`;
  text += `• *Metode:* ${p.nama || '-'}\n`;
  text += `• *Invoice ID:* ${p.invoice_id || '-'}\n`;

  if (p.rekening) {
    let rekStr = '';
    if (typeof p.rekening === 'object' && p.rekening !== null) {
      rekStr = Object.keys(p.rekening).map(key => {
        const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const val = p.rekening[key];
        return `${readableKey}: ${val}`;
      }).join('\n    ');
    } else {
      rekStr = String(p.rekening).replace(/<br\s*\/?>/gi, '\n    ');
    }
    text += `• *Tujuan/Rekening:* \n    ${rekStr}\n`;
  }

  if (p.qr_code || p.qrcode || p.qr_link) {
    text += `• *QR Code Link:* ${p.qr_code || p.qrcode || p.qr_link}\n`;
  }

  const harga = results.harga || '';
  const kodeUnik = results.kode_unik || '';
  text += `• *Total Tagihan:* *${harga}*\n`;
  if (kodeUnik && kodeUnik !== 'Rp 0') {
    text += `• *Kode Unik:* ${kodeUnik} (Transfer nominal presisi)\n`;
  }

  if (p.expired_date) {
    text += `• *Batas Waktu:* ${p.expired_date}\n`;
  }

  return text;
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
 * Mengambil daftar produk (vouchers) dan memfilternya berdasarkan query string.
 */
async function getYagamiProducts(filterStr = '') {
  const credentials = getCredentials();
  const params = new URLSearchParams();
  params.append('auth_username', credentials.auth_username);
  params.append('auth_token', credentials.auth_token);

  log.debug('yagami', `Mengambil daftar voucher/produk Yagami Cell`);

  const res = await axios.post('https://yagami-cell.com/api/main/get-vouchers', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });

  log.debug('yagami_raw', `Raw Vouchers Response (Sliced):\n${JSON.stringify(res.data, null, 2).slice(0, 500)}...`);

  if (!res.data?.success) {
    throw new Error(res.data?.message || res.data?.results || 'Gagal mengambil daftar produk');
  }

  let list = res.data.results || [];

  if (filterStr) {
    const query = filterStr.toLowerCase();
    list = list.filter(item => {
      const nominal = (item.nominal || '').toLowerCase();
      const provider = (item.provider?.nama || '').toLowerCase();
      const produkNama = (item.produk?.nama || '').toLowerCase();
      return nominal.includes(query) || provider.includes(query) || produkNama.includes(query);
    });
  }

  return list;
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
 * Melakukan polling status transaksi asinkron di latar belakang.
 */
function startOrderPolling(sock, jid, msg, trxId, voucherName) {
  let pollCount = 0;
  const maxPolls = 18; // 18 * 10 detik = 180 detik (3 menit)
  const interval = 10000; // 10 detik
  let sentPaymentInstructions = false;

  log.debug('yagami', `Memulai background polling status untuk Transaksi ID: ${trxId}`);

  const poll = async () => {
    pollCount++;
    try {
      const results = await getTransactionDetails(trxId);
      const statusPengisian = results.status?.pengisian; // "Pending", "Sukses", "Gagal"
      const statusPembayaran = results.status?.pembayaran; // "Sukses", "Pending", dll
      const sn = results.sn || '';
      const price = results.harga || '';

      log.debug('yagami', `Polling ${pollCount}/${maxPolls} untuk ID ${trxId}: Status Pengisian = ${statusPengisian}, Pembayaran = ${JSON.stringify(results.pembayaran)}`);

      // Kirim instruksi transfer hanya sekali jika pembayaran diperlukan
      if (statusPembayaran && statusPembayaran !== 'Sukses' && !sentPaymentInstructions) {
        sentPaymentInstructions = true;
        const paymentText = formatPembayaranDetails(results);
        if (paymentText) {
          let replyText = `⚠️ *PEMBAYARAN DIPERLUKAN*\n\n`;
          replyText += `Transaksi ID *#${trxId}* memerlukan pembayaran sebelum dapat diproses.\n\n`;
          replyText += paymentText;
          await reply(sock, jid, msg, replyText);
        }
      }

      if (statusPengisian === 'Sukses') {
        let replyText = `✅ *TRANSAKSI SUKSES!*\n\n`;
        replyText += `🆔 *ID Transaksi:* ${trxId}\n`;
        replyText += `📦 *Produk:* ${results.voucher?.nominal || voucherName || '-'}\n`;
        replyText += `📱 *No HP:* ${results.phone || '-'}\n`;
        replyText += `💸 *Harga:* ${price}\n`;
        replyText += `🔑 *SN / Token:* \`\`\`${sn}\`\`\`\n\n`;
        replyText += `_Terima kasih telah bertransaksi!_`;

        await reply(sock, jid, msg, replyText);
        return; // Hentikan polling
      }

      if (statusPengisian === 'Gagal') {
        let replyText = `❌ *TRANSAKSI GAGAL!*\n\n`;
        replyText += `🆔 *ID Transaksi:* ${trxId}\n`;
        replyText += `📦 *Produk:* ${results.voucher?.nominal || voucherName || '-'}\n`;
        replyText += `📱 *No HP:* ${results.phone || '-'}\n`;
        replyText += `⚠️ *Keterangan:* Transaksi ditolak atau dibatalkan oleh provider.\n`;

        await reply(sock, jid, msg, replyText);
        return; // Hentikan polling
      }

      // Jika status masih pending dan batas polling belum tercapai, lanjutkan
      if (pollCount < maxPolls) {
        setTimeout(poll, interval);
      } else {
        // Timeout polling
        let replyText = `⏳ *PEMBERITAHUAN (TIMEOUT)*\n\n`;
        replyText += `Transaksi ID *#${trxId}* masih berstatus *Pending* setelah 3 menit.\n`;
        replyText += `Silakan cek status transaksi secara manual nanti dengan mengetik:\n`;
        replyText += `*!yagami cek ${trxId}*`;

        await reply(sock, jid, msg, replyText);
      }
    } catch (err) {
      log.error('yagami_poll', `Error saat polling Transaksi ID ${trxId}: ${err.message}`);

      // Lanjutkan polling jika batas maksimal belum tercapai
      if (pollCount < maxPolls) {
        setTimeout(poll, interval);
      } else {
        await reply(sock, jid, msg, `❌ *ERROR POLLING TRANSAKSI #${trxId}*\nGagal menghubungi server Yagami Cell setelah beberapa kali mencoba.`);
      }
    }
  };

  // Jalankan polling pertama setelah interval delay
  setTimeout(poll, interval);
}

/**
 * Handler utama untuk command !yagami
 */
async function handleYagamiCommand(sock, jid, msg, args) {
  const subCommand = (args[0] || '').toLowerCase();

  if (!subCommand) {
    let helpText = `╔══════════════════════╗\n`;
    helpText += `   🤖 *MENU YAGAMI CELL*   \n`;
    helpText += `╚══════════════════════╝\n\n`;
    helpText += `Gunakan format berikut:\n\n`;
    helpText += `🔹 *!yagami saldo*\n`;
    helpText += `   _Mengecek sisa saldo Yagami Cell_\n\n`;
    helpText += `🔹 *!yagami listproduk [filter]*\n`;
    helpText += `   _Melihat daftar produk (contoh: !yagami listproduk axis)_\n\n`;
    helpText += `🔹 *!yagami order [id_produk] [nohp] [pembayaran]*\n`;
    helpText += `   _Melakukan pembelian produk (contoh: !yagami order 71 083812345678 bank_bca)_\n`;
    helpText += `   _Default pembayaran: balance (saldo reseller)_\n\n`;
    helpText += `🔹 *!yagami cek [id_transaksi]*\n`;
    helpText += `   _Cek status transaksi secara manual_\n\n`;
    helpText += `━━━━━━━━━━━━━━━━━━━━━━`;
    await reply(sock, jid, msg, helpText);
    return;
  }

  switch (subCommand) {
    case 'saldo': {
      await reply(sock, jid, msg, '⏳ Sedang mengecek saldo Yagami Cell...');
      try {
        const info = await getYagamiSaldo();
        let text = `╔══════════════════════╗\n`;
        text += `   💰 *SALDO YAGAMI CELL*   \n`;
        text += `╚══════════════════════╝\n\n`;
        text += `👤 *Nama Akun:* ${info.name || '-'}\n`;
        text += `🏷️ *Username:* ${info.username || '-'}\n`;
        text += `💳 *Saldo:* ${info.balance_str || ('Rp ' + info.balance)}\n`;
        text += `🚦 *Status:* ${info.status || '-'}\n`;
        text += `🏅 *Level:* ${info.type || '-'}\n\n`;
        text += `_Terakhir diperbarui: ${new Date().toLocaleString('id-ID')}_`;
        await reply(sock, jid, msg, text);
      } catch (err) {
        await reply(sock, jid, msg, `❌ *Gagal mengecek saldo:* ${err.message}`);
      }
      break;
    }

    case 'list':
    case 'produk':
    case 'listproduk': {
      const filter = args.slice(1).join(' ');
      await reply(sock, jid, msg, `⏳ Mengambil daftar produk${filter ? ` dengan filter "${filter}"` : ''}...`);
      try {
        const products = await getYagamiProducts(filter);
        if (products.length === 0) {
          await reply(sock, jid, msg, `⚠️ Produk${filter ? ` dengan filter "${filter}"` : ''} tidak ditemukan.`);
          return;
        }

        // Batasi jumlah produk agar tidak melebihi limit panjang chat
        const limit = 40;
        const total = products.length;
        const listToDisplay = products.slice(0, limit);

        let text = `╔══════════════════════╗\n`;
        text += `   📦 *DAFTAR PRODUK YAGAMI*  \n`;
        text += `╚══════════════════════╝\n\n`;
        if (filter) text += `🔍 *Filter:* "${filter}"\n\n`;

        listToDisplay.forEach(item => {
          text += `🆔 *ID:* ${item.id}\n`;
          text += `🏷️ *Nama:* ${item.nominal}\n`;
          text += `💸 *Harga:* ${item.harga_str || ('Rp ' + item.harga)}\n`;
          text += `🌐 *Provider:* ${item.provider?.nama || '-'}\n`;
          text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        });

        if (total > limit) {
          text += `\n⚠️ _Menampilkan ${limit} dari total ${total} produk. Saring lebih spesifik (contoh: !yagami listproduk axis 5k)._`;
        } else {
          text += `\n_Total: ${total} produk._`;
        }

        await reply(sock, jid, msg, text);
      } catch (err) {
        await reply(sock, jid, msg, `❌ *Gagal mengambil daftar produk:* ${err.message}`);
      }
      break;
    }

    case 'order':
    case 'beli': {
      const voucherId = args[1];
      const phone = args[2];
      const paymentMethod = args[3] || 'balance';

      if (!voucherId || !phone) {
        await reply(sock, jid, msg, '⚠️ *Format Salah!*\nGunakan: *!yagami order [id_produk] [nohp] [pembayaran]*\nContoh: *!yagami order 71 083812345678 bank_bca*');
        return;
      }

      await reply(sock, jid, msg, `⏳ Membuat pesanan produk ID *${voucherId}* ke *${phone}* via *${paymentMethod}*...`);
      try {
        const orderInfo = await orderYagamiProduct(voucherId, phone, paymentMethod);
        const trxId = orderInfo.id;
        const productName = orderInfo.voucher?.nominal || '';

        let text = `⏳ *PESANAN DIPROSES*\n\n`;
        text += `🆔 *ID Transaksi:* ${trxId}\n`;
        text += `📦 *Produk:* ${productName || '-'}\n`;
        text += `📱 *No HP:* ${orderInfo.no_hp || phone}\n`;
        text += `💸 *Harga:* ${orderInfo.harga_str || ('Rp ' + orderInfo.harga)}\n`;
        text += `💳 *Metode Pembayaran:* ${orderInfo.pembayaran || paymentMethod}\n\n`;
        text += `🕒 Status transaksi sedang dilacak secara otomatis di latar belakang. Bot akan mengirimkan update dalam beberapa detik...`;

        await reply(sock, jid, msg, text);

        // Mulai polling asinkron di latar belakang
        startOrderPolling(sock, jid, msg, trxId, productName);

      } catch (err) {
        await reply(sock, jid, msg, `❌ *Gagal memproses pesanan:* ${err.message}`);
      }
      break;
    }

    case 'cek':
    case 'status': {
      const trxId = args[1];
      if (!trxId) {
        await reply(sock, jid, msg, '⚠️ *Format Salah!*\nGunakan: *!yagami cek [id_transaksi]*\nContoh: *!yagami cek 240*');
        return;
      }

      await reply(sock, jid, msg, `⏳ Mengecek status transaksi ID *#${trxId}*...`);
      try {
        const info = await getTransactionDetails(trxId);
        const statusPengisian = info.status?.pengisian;
        const sn = info.sn || '-';

        let statusEmoji = '⏳';
        if (statusPengisian === 'Sukses') statusEmoji = '✅';
        if (statusPengisian === 'Gagal') statusEmoji = '❌';

        let text = `╔══════════════════════╗\n`;
        text += `   🔍 *STATUS TRANSAKSI YAGAMI*  \n`;
        text += `╚══════════════════════╝\n\n`;
        text += `🆔 *ID Transaksi:* ${info.id}\n`;
        text += `📦 *Produk:* ${info.voucher?.nominal || '-'}\n`;
        text += `📱 *No HP:* ${info.phone || '-'}\n`;
        text += `💸 *Harga:* ${info.harga || '-'}\n`;
        text += `🚦 *Status Pembayaran:* ${info.status?.pembayaran || '-'}\n`;
        text += `${statusEmoji} *Status Pengisian:* *${statusPengisian || '-'}*\n`;
        text += `🔑 *SN / Token:* \`\`\`${sn}\`\`\`\n\n`;
        text += `_Waktu Transaksi: ${info.tanggal || '-'}_`;

        const paymentText = formatPembayaranDetails(info);
        if (info.status?.pembayaran !== 'Sukses' && paymentText) {
          text += `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
          text += paymentText;
        }

        await reply(sock, jid, msg, text);
      } catch (err) {
        await reply(sock, jid, msg, `❌ *Gagal mengecek status transaksi:* ${err.message}`);
      }
      break;
    }

    default: {
      await reply(sock, jid, msg, `⚠️ Subcommand *"${subCommand}"* tidak dikenal.\nKetik *!yagami* saja untuk melihat menu panduan.`);
      break;
    }
  }
}

module.exports = { handleYagamiCommand };
