const { db } = require('../database/db');
const log = require('../logger/debugLogger');
const {
  pendingOrders,
  normalizeYagamiPhone,
  mapPaymentMethod,
  getExternalPaymentLink,
  getYagamiSaldo,
  getYagamiProducts,
  orderYagamiProduct,
  getTransactionDetails,
  isQrisPayment
} = require('./yagamiApi');

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
 * Melakukan polling status transaksi asinkron di latar belakang.
 */
function startOrderPolling(sock, jid, msg, trxId, voucherName) {
  let pollCount = 0;
  const maxPolls = 18; // 18 * 20 detik = 360 detik (6 menit)
  const interval = 20000; // 20 detik
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
        let paymentText = formatPembayaranDetails(results);
        if (paymentText) {
          if (isQrisPayment(results)) {
            const externalLink = await getExternalPaymentLink(trxId);
            if (externalLink) {
              paymentText += `\n🔗 *Link Pembayaran:* \n${externalLink}\n`;
            }
          }
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
        replyText += `Transaksi ID *#${trxId}* masih berstatus *Pending* setelah 6 menit.\n`;
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
    helpText += `   _Membuat draf pesanan (memerlukan konfirmasi)_\n`;
    helpText += `   _Contoh: !yagami order 71 083812345678 bank_bca_\n\n`;
    helpText += `🔹 *!yagami confirm*\n`;
    helpText += `   _Mengonfirmasi pesanan yang sedang pending_\n\n`;
    helpText += `🔹 *!yagami batal*\n`;
    helpText += `   _Membatalkan pesanan yang sedang pending_\n\n`;
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
      const phoneInput = args[2];
      const rawPayment = args.slice(3).join(' ') || 'balance';
      const paymentMethod = mapPaymentMethod(rawPayment);

      if (!voucherId || !phoneInput) {
        await reply(sock, jid, msg, '⚠️ *Format Salah!*\nGunakan: *!yagami order [id_produk] [nohp] [pembayaran]*\nContoh: *!yagami order 71 083812345678 qris_payment*');
        return;
      }

      const phone = normalizeYagamiPhone(phoneInput);
      if (phone.length < 9) {
        await reply(sock, jid, msg, '❌ *Nomor HP Tidak Valid!*\nNomor HP minimal terdiri dari 9 digit.');
        return;
      }

      await reply(sock, jid, msg, `⏳ Memverifikasi produk ID *${voucherId}*...`);
      try {
        const products = await getYagamiProducts();
        const product = products.find(p => String(p.id) === String(voucherId));

        if (!product) {
          await reply(sock, jid, msg, `❌ *Produk Tidak Ditemukan!*\nProduk dengan ID *${voucherId}* tidak ditemukan di daftar Yagami Cell.`);
          return;
        }

        const senderKey = msg.key.participant || msg.key.remoteJid || '';
        const priceStr = product.harga_str || ('Rp ' + product.harga);
        const providerName = product.provider?.nama || '-';

        pendingOrders.set(senderKey, {
          voucherId,
          phone,
          paymentMethod,
          productName: product.nominal,
          priceStr,
          providerName,
          timestamp: Date.now()
        });

        const paymentMethodFriendly = paymentMethod === 'balance' ? 'Reseller Balance (Saldo)' : (paymentMethod === 'qris_payment' ? 'QRIS' : (paymentMethod === 'qris_payment2' ? 'QRIS 2' : paymentMethod));

        let text = `╔══════════════════════╗\n`;
        text += `   ⚠️ *KONFIRMASI PESANAN*   \n`;
        text += `╚══════════════════════╝\n\n`;
        text += `Apakah Anda yakin ingin melakukan pembelian berikut?\n\n`;
        text += `📦 *Produk:* ${product.nominal}\n`;
        text += `🆔 *ID Produk:* ${product.id}\n`;
        text += `🌐 *Provider:* ${providerName}\n`;
        text += `📱 *No HP:* ${phone}\n`;
        text += `💸 *Harga:* *${priceStr}*\n`;
        text += `💳 *Metode:* ${paymentMethodFriendly}\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `👉 Ketik *!yagami confirm* untuk memproses pesanan.\n`;
        text += `👉 Ketik *!yagami batal* untuk membatalkan pesanan.\n\n`;
        text += `⏳ _Batas waktu konfirmasi adalah 60 detik._`;

        await reply(sock, jid, msg, text);
      } catch (err) {
        await reply(sock, jid, msg, `❌ *Gagal memverifikasi produk:* ${err.message}`);
      }
      break;
    }

    case 'confirm':
    case 'konfirmasi': {
      const senderKey = msg.key.participant || msg.key.remoteJid || '';
      const pending = pendingOrders.get(senderKey);

      if (!pending) {
        await reply(sock, jid, msg, '⚠️ *Tidak Ada Pesanan Pending!*\nSilakan buat pesanan baru terlebih dahulu dengan perintah *!yagami order*.');
        return;
      }

      if (Date.now() - pending.timestamp > 60000) {
        pendingOrders.delete(senderKey);
        await reply(sock, jid, msg, '⏳ *Pesanan Kedaluwarsa!*\nBatas waktu konfirmasi 60 detik telah habis. Silakan buat pesanan baru.');
        return;
      }

      pendingOrders.delete(senderKey);

      await reply(sock, jid, msg, `⏳ Memproses pesanan produk *${pending.productName}* ke *${pending.phone}* via *${pending.paymentMethod}*...`);
      try {
        const orderInfo = await orderYagamiProduct(pending.voucherId, pending.phone, pending.paymentMethod);
        const trxId = orderInfo.id;
        const productName = orderInfo.voucher?.nominal || pending.productName;

        let text = `⏳ *PESANAN DIPROSES*\n\n`;
        text += `🆔 *ID Transaksi:* ${trxId}\n`;
        text += `📦 *Produk:* ${productName || '-'}\n`;
        text += `📱 *No HP:* ${orderInfo.no_hp || pending.phone}\n`;
        text += `💸 *Harga:* ${orderInfo.harga_str || ('Rp ' + orderInfo.harga)}\n`;
        text += `💳 *Metode Pembayaran:* ${orderInfo.pembayaran || pending.paymentMethod}\n\n`;
        text += `🕒 Status transaksi sedang dilacak secara otomatis di latar belakang. Bot akan mengirimkan update dalam beberapa detik...`;

        await reply(sock, jid, msg, text);

        // Mulai polling asinkron di latar belakang
        startOrderPolling(sock, jid, msg, trxId, productName);

      } catch (err) {
        await reply(sock, jid, msg, `❌ *Gagal memproses pesanan:* ${err.message}`);
      }
      break;
    }

    case 'batal':
    case 'cancel': {
      const senderKey = msg.key.participant || msg.key.remoteJid || '';
      const pending = pendingOrders.get(senderKey);

      if (!pending) {
        await reply(sock, jid, msg, '⚠️ *Tidak Ada Pesanan Pending* untuk dibatalkan.');
        return;
      }

      pendingOrders.delete(senderKey);
      await reply(sock, jid, msg, `✅ *Pesanan Dibatalkan!*\nPembelian produk *${pending.productName}* ke *${pending.phone}* telah dibatalkan secara manual.`);
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

        let paymentText = formatPembayaranDetails(info);
        if (info.status?.pembayaran !== 'Sukses' && paymentText) {
          if (isQrisPayment(info)) {
            const externalLink = await getExternalPaymentLink(info.id || trxId);
            if (externalLink) {
              paymentText += `\n🔗 *Link Pembayaran:* \n${externalLink}\n`;
            }
          }
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
