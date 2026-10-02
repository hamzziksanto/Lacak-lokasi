// ═══════════════════════════════════════════════
// LACAK BACKEND - SEMUA DALAM 1 FILE
// API Server + Bot #1 (Jual) + Bot #2 (Admin + QRIS Upload)
// ═══════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ═══════════════════════════════════════════════
// ⚙️ KONFIGURASI — GANTI SEMUA INI!
// ═══════════════════════════════════════════════
const CONFIG = {
  // Token Bot #1 (Jual Akses) - dari @BotFather
  BOT1_TOKEN: '8836981360:AAEGqlsNO62-i_JFIkEWtxJcwRaD3g1xrkk',

  // Token Bot #2 (Admin + QRIS Upload) - dari @BotFather
  BOT2_TOKEN: '8893172230:AAHudSlB8bjyNC0bJtT1xK97pwiPHlyTGLo',

  // Chat ID Admin - dari @userinfobot
  ADMIN_CHAT_ID: '7680843980',

  // Secret untuk JWT (minimal 32 karakter)
  JWT_SECRET: 'lacakku2026secretkeyrandom987654321xyz',

  // Port server (biarkan default)
  PORT: process.env.PORT || 3000,

  // URL frontend kamu (GitHub Pages atau Netlify)
  FRONTEND_URL: 'https://username.github.io/lacak-frontend',

  // Daftar harga paket
  PRICES: {
    '1day':      { label: '1 Hari',    duration: 1 * 24 * 60 * 60 * 1000,   price: 2000 },
    '1week':     { label: '1 Minggu',  duration: 7 * 24 * 60 * 60 * 1000,   price: 10000 },
    '1month':    { label: '1 Bulan',   duration: 30 * 24 * 60 * 60 * 1000,  price: 25000 },
    '3month':    { label: '3 Bulan',   duration: 90 * 24 * 60 * 60 * 1000,  price: 60000 },
    '6month':    { label: '6 Bulan',   duration: 180 * 24 * 60 * 60 * 1000, price: 100000 },
    '1year':     { label: '1 Tahun',   duration: 365 * 24 * 60 * 60 * 1000, price: 180000 },
    'permanent': { label: 'PERMANEN',  duration: null,                      price: 500000 }
  }
};

// ═══════════════════════════════════════════════
// QRIS MANAGEMENT
// ═══════════════════════════════════════════════
const QRIS_FILE = path.join(__dirname, 'qris.png');
const adminStates = {};

function hasQris() {
  return fs.existsSync(QRIS_FILE);
}

function downloadQris(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════════
// DATABASE (JSON FILE)
// ═══════════════════════════════════════════════
const USERS_FILE = path.join(__dirname, 'users.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

function loadJSON(file, def = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : def;
  } catch (e) {
    return def;
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const db = {
  getUsers: () => loadJSON(USERS_FILE, {}),
  saveUsers: (u) => saveJSON(USERS_FILE, u),

  createUser: (username, password, expiresAt) => {
    const users = db.getUsers();
    if (users[username]) return { ok: false, msg: 'Username sudah ada' };
    users[username] = {
      username,
      password,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    db.saveUsers(users);
    return { ok: true, user: users[username] };
  },

  findUser: (username) => db.getUsers()[username] || null,

  updateUser: (username, patch) => {
    const users = db.getUsers();
    if (!users[username]) return null;
    users[username] = { ...users[username], ...patch };
    db.saveUsers(users);
    return users[username];
  },

  deleteUser: (username) => {
    const users = db.getUsers();
    delete users[username];
    db.saveUsers(users);
  },

  getOrders: () => loadJSON(ORDERS_FILE, {}),
  saveOrders: (o) => saveJSON(ORDERS_FILE, o),

  createOrder: (orderId, data) => {
    const orders = db.getOrders();
    orders[orderId] = {
      ...data,
      orderId,
      status: 'PENDING',
      createdAt: new Date().toISOString()
    };
    db.saveOrders(orders);
    return orders[orderId];
  },

  updateOrder: (orderId, patch) => {
    const orders = db.getOrders();
    if (!orders[orderId]) return null;
    orders[orderId] = { ...orders[orderId], ...patch };
    db.saveOrders(orders);
    return orders[orderId];
  },

  findOrder: (orderId) => db.getOrders()[orderId] || null
};

// ═══════════════════════════════════════════════
// API SERVER
// ═══════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lacak-backend',
    time: new Date().toISOString(),
    qris: hasQris() ? 'available' : 'missing'
  });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib' });
  }

  const user = db.findUser(username);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Username tidak ditemukan' });
  }

  if (user.password !== password) {
    return res.status(401).json({ success: false, message: 'Password salah' });
  }

  if (user.expiresAt !== 'PERMANENT' && Date.now() >= new Date(user.expiresAt).getTime()) {
    db.deleteUser(username);
    return res.status(403).json({ success: false, message: 'Akses sudah berakhir' });
  }

  const token = jwt.sign({ username: user.username }, CONFIG.JWT_SECRET, { expiresIn: '30d' });

  res.json({
    success: true,
    token,
    username: user.username,
    expiresAt: user.expiresAt
  });
});

// VERIFY TOKEN
app.post('/api/verify', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }

  try {
    const decoded = jwt.verify(auth.slice(7), CONFIG.JWT_SECRET);
    const user = db.findUser(decoded.username);
    if (!user) return res.json({ valid: false });

    if (user.expiresAt !== 'PERMANENT' && Date.now() >= new Date(user.expiresAt).getTime()) {
      db.deleteUser(decoded.username);
      return res.json({ valid: false, reason: 'EXPIRED' });
    }

    res.json({ valid: true, username: user.username });
  } catch (e) {
    res.json({ valid: false });
  }
});

// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 API Server berjalan di port ${CONFIG.PORT}`);
});

// ═══════════════════════════════════════════════
// BOT #1: JUAL AKSES
// ═══════════════════════════════════════════════
const bot1 = new TelegramBot(CONFIG.BOT1_TOKEN, { polling: true });
const bot2 = new TelegramBot(CONFIG.BOT2_TOKEN, { polling: true });
const userStates = {};

function formatRupiah(n) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

bot1.onText(/\/start/, (msg) => {
  bot1.sendMessage(msg.chat.id,
    `🤖 *Bot Jual Akses Lacak Lokasi*\n\n` +
    `Untuk membeli akses, ketik:\n` +
    `👉 \`/Buylacak-lokasi\`\n\n` +
    `_Ketik command di atas untuk melihat pilihan paket._`,
    { parse_mode: 'Markdown' }
  );
});

bot1.onText(/\/Buylacak-lokasi/i, (msg) => {
  const chatId = msg.chat.id;

  if (!hasQris()) {
    return bot1.sendMessage(chatId,
      `⚠️ *QRIS belum tersedia*\n\n` +
      `Mohon tunggu, admin sedang menyiapkan metode pembayaran.\n` +
      `Coba lagi nanti.`,
      { parse_mode: 'Markdown' }
    );
  }

  userStates[chatId] = { step: 'choosing_package' };

  const keyboard = Object.keys(CONFIG.PRICES).map(key => ([{
    text: `${CONFIG.PRICES[key].label} — ${formatRupiah(CONFIG.PRICES[key].price)}`,
    callback_data: `pkg_${key}`
  }]));

  bot1.sendMessage(chatId,
    `📦 *Ingin mengakses berapa lama?*\n\nPilih paket di bawah:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
  );
});

bot1.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const msgId = query.message.message_id;

  // === PILIH PAKET ===
  if (data.startsWith('pkg_')) {
    const pkgKey = data.slice(4);
    const pkg = CONFIG.PRICES[pkgKey];
    if (!pkg) return bot1.answerCallbackQuery(query.id, { text: 'Paket tidak valid' });

    userStates[chatId] = {
      step: 'awaiting_payment',
      pkgKey,
      pkgLabel: pkg.label,
      pkgPrice: pkg.price,
      pkgDuration: pkg.duration
    };

    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() +
                    Math.random().toString(36).substring(2, 5).toUpperCase();

    db.createOrder(orderId, {
      chatId,
      username: query.from.username || query.from.first_name,
      pkgKey,
      pkgLabel: pkg.label,
      pkgPrice: pkg.price,
      pkgDuration: pkg.duration
    });

    userStates[chatId].orderId = orderId;

    const caption =
      `💳 *PEMBAYARAN*\n\n` +
      `📦 Paket: *${pkg.label}*\n` +
      `💰 Harga: *${formatRupiah(pkg.price)}*\n` +
      `🆔 Order ID: \`${orderId}\`\n\n` +
      `Silakan scan QRIS di atas dan bayar sesuai nominal.\n` +
      `Setelah bayar, klik tombol ✅ *Sudah Bayar* di bawah.\n\n` +
      `_Bukti pembayaran akan diverifikasi admin._`;

    try {
      await bot1.sendPhoto(chatId, QRIS_FILE, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Sudah Bayar', callback_data: `paid_${orderId}` }],
            [{ text: '❌ Batal', callback_data: 'cancel' }]
          ]
        }
      });
    } catch (err) {
      bot1.sendMessage(chatId, caption + '\n\n_QRIS tidak dapat dimuat, hubungi admin._', {
        parse_mode: 'Markdown'
      });
    }
    bot1.answerCallbackQuery(query.id);
  }

  // === USER KLIK SUDAH BAYAR ===
  if (data.startsWith('paid_')) {
    const orderId = data.slice(5);
    const order = db.findOrder(orderId);
    if (!order) return bot1.answerCallbackQuery(query.id, { text: 'Order tidak ditemukan!' });

    db.updateOrder(orderId, {
      status: 'WAITING_APPROVAL',
      paidAt: new Date().toISOString()
    });

    const text =
      `🔔 *PEMBAYARAN BARU*\n\n` +
      `🆔 Order: \`${order.orderId}\`\n` +
      `👤 User: @${order.username}\n` +
      `📦 Paket: *${order.pkgLabel}*\n` +
      `💰 Nominal: *${formatRupiah(order.pkgPrice)}*\n` +
      `🕒 Waktu: ${new Date().toLocaleString('id-ID')}\n\n` +
      `Konfirmasi pembayaran:`;

    try {
      await bot2.sendMessage(CONFIG.ADMIN_CHAT_ID, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ SETUJUI', callback_data: `approve_${order.orderId}` },
            { text: '❌ TOLAK', callback_data: `reject_${order.orderId}` }
          ]]
        }
      });
    } catch (e) {
      console.error('Gagal kirim ke admin:', e.message);
    }

    bot1.answerCallbackQuery(query.id, { text: 'Notifikasi dikirim ke admin!' });
    bot1.sendMessage(chatId,
      `⏳ *Pembayaran sedang diverifikasi*\n\n` +
      `Order ID: \`${orderId}\`\n` +
      `Mohon tunggu, admin akan memverifikasi pembayaran Anda.\n` +
      `Setelah disetujui, kredensial login akan dikirim ke chat ini.`,
      { parse_mode: 'Markdown' }
    );
  }

  // === BATAL ===
  if (data === 'cancel') {
    delete userStates[chatId];
    bot1.answerCallbackQuery(query.id, { text: 'Dibatalkan' });
    bot1.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    bot1.sendMessage(chatId, '❌ Pembelian dibatalkan. Ketik /Buylacak-lokasi untuk mulai lagi.');
  }
});

// ═══════════════════════════════════════════════
// BOT #2: ADMIN APPROVER + UPLOAD QRIS
// ═══════════════════════════════════════════════
function genUsername() {
  return `user_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function genPassword() {
  return crypto.randomBytes(4).toString('hex') + '@' +
         crypto.randomBytes(2).toString('hex').toUpperCase();
}

// === HANDLE CALLBACK APPROVE/REJECT ===
bot2.on('callback_query', async (query) => {
  const data = query.data;
  const msgId = query.message.message_id;
  const chatId = query.message.chat.id;

  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) {
    return bot2.answerCallbackQuery(query.id, { text: 'Anda bukan admin!' });
  }

  // APPROVE
  if (data.startsWith('approve_')) {
    const orderId = data.slice(8);
    const order = db.findOrder(orderId);
    if (!order) return bot2.answerCallbackQuery(query.id, { text: 'Order tidak ditemukan!' });
    if (order.status === 'APPROVED') return bot2.answerCallbackQuery(query.id, { text: 'Sudah disetujui' });

    let username, password, result;
    do {
      username = genUsername();
      password = genPassword();
      result = db.createUser(username, password, 'TEMP');
    } while (!result.ok);

    let expiresAt;
    if (order.pkgDuration === null || order.pkgKey === 'permanent') {
      expiresAt = 'PERMANENT';
    } else {
      expiresAt = new Date(Date.now() + order.pkgDuration).toISOString();
    }

    db.updateUser(username, { expiresAt });
    db.updateOrder(orderId, {
      status: 'APPROVED',
      approvedAt: new Date().toISOString(),
      credentials: { username, password, expiresAt }
    });

    const expText = expiresAt === 'PERMANENT'
      ? '♾️ PERMANEN (tidak akan expired)'
      : new Date(expiresAt).toLocaleString('id-ID');

    const userMsg =
      `🎉 *PEMBAYARAN DISETUJUI!*\n\n` +
      `Terima kasih sudah membeli akses.\n\n` +
      `🔐 *Kredensial Login Anda:*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Username: \`${username}\`\n` +
      `🔑 Password: \`${password}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 Paket: ${order.pkgLabel}\n` +
      `⏰ Berlaku sampai: *${expText}*\n\n` +
      `🌐 *Login di sini:*\n` +
      `${CONFIG.FRONTEND_URL}\n\n` +
      `⚠️ _Jangan bagikan kredensial ini ke siapa pun!_`;

    try {
      await bot1.sendMessage(order.chatId, userMsg, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Gagal kirim ke user:', e.message);
    }

    bot2.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    bot2.sendMessage(chatId, `✅ *Order ${orderId} DISETUJUI*\n\nKredensial sudah dikirim ke user.`, {
      parse_mode: 'Markdown'
    });
    bot2.answerCallbackQuery(query.id, { text: 'Disetujui!' });
  }

  // REJECT
  if (data.startsWith('reject_')) {
    const orderId = data.slice(7);
    const order = db.findOrder(orderId);
    if (!order) return bot2.answerCallbackQuery(query.id, { text: 'Order tidak ditemukan!' });

    db.updateOrder(orderId, {
      status: 'REJECTED',
      rejectedAt: new Date().toISOString()
    });

    try {
      await bot1.sendMessage(order.chatId,
        `❌ *PEMBAYARAN DITOLAK*\n\n` +
        `Order ID: \`${orderId}\`\n\n` +
        `Silakan hubungi admin untuk klarifikasi.\n` +
        `Atau ketik /Buylacak-lokasi untuk coba lagi.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error(e.message);
    }

    bot2.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
    bot2.sendMessage(chatId, `❌ Order ${orderId} ditolak.`, { parse_mode: 'Markdown' });
    bot2.answerCallbackQuery(query.id, { text: 'Ditolak' });
  }
});

// === COMMAND /start ===
bot2.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) {
    return bot2.sendMessage(chatId, '❌ Anda bukan admin.');
  }

  const qrisStatus = hasQris() ? '✅ Sudah ada' : '❌ Belum ada';

  bot2.sendMessage(chatId,
    `👋 *Bot Admin Panel*\n\n` +
    `Status QRIS: *${qrisStatus}*\n\n` +
    `*Commands:*\n` +
    `/upQris - Upload/ganti foto QRIS\n` +
    `/cekQris - Lihat QRIS aktif\n` +
    `/hapusQris - Hapus QRIS\n` +
    `/listusers - Lihat user aktif\n` +
    `/deluser <username> - Hapus user\n` +
    `/stats - Statistik\n` +
    `/help - Bantuan`,
    { parse_mode: 'Markdown' }
  );
});

// === COMMAND /upQris ===
bot2.onText(/\/upQris/i, (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) {
    return bot2.sendMessage(chatId, '❌ Anda bukan admin.');
  }

  adminStates[chatId] = { step: 'awaiting_qris' };

  bot2.sendMessage(chatId,
    `📤 *UPLOAD QRIS*\n\n` +
    `Silakan kirimkan foto QRIS Anda sekarang.\n\n` +
    `*Cara kirim:*\n` +
    `1. Klik ikon 📎 (attachment)\n` +
    `2. Pilih "Gallery" atau "Camera"\n` +
    `3. Pilih/screenshot QRIS\n` +
    `4. Kirim sebagai *Photo* (bukan file)\n\n` +
    `⚠️ Pastikan QRIS terlihat jelas & tidak terpotong.\n\n` +
    `_Ketik /cancel untuk membatalkan._`,
    { parse_mode: 'Markdown' }
  );
});

// === HANDLE FOTO QRIS ===
bot2.on('photo', async (msg) => {
  const chatId = msg.chat.id;

  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) return;
  if (!adminStates[chatId] || adminStates[chatId].step !== 'awaiting_qris') return;

  try {
    const photos = msg.photo;
    const highestRes = photos[photos.length - 1];
    const fileId = highestRes.file_id;

    const fileLink = await bot2.getFileLink(fileId);

    const waitMsg = await bot2.sendMessage(chatId, '⏳ Menyimpan QRIS...');

    await downloadQris(fileLink.href, QRIS_FILE);

    const stats = fs.statSync(QRIS_FILE);
    const sizeKB = (stats.size / 1024).toFixed(1);

    delete adminStates[chatId];

    bot2.editMessageText(
      `✅ *QRIS BERHASIL DISIMPAN!*\n\n` +
      `📁 File: qris.png\n` +
      `📊 Ukuran: ${sizeKB} KB\n` +
      `🕒 Waktu: ${new Date().toLocaleString('id-ID')}\n\n` +
      `Bot #1 sekarang otomatis menggunakan QRIS ini\n` +
      `saat user membeli akses.\n\n` +
      `_Ketik /cekQris untuk memverifikasi._`,
      {
        chat_id: chatId,
        message_id: waitMsg.message_id,
        parse_mode: 'Markdown'
      }
    );

    console.log(`[QRIS] Updated by admin at ${new Date().toISOString()}`);

  } catch (err) {
    console.error('Gagal simpan QRIS:', err);
    delete adminStates[chatId];
    bot2.sendMessage(chatId,
      `❌ *GAGAL MENYIMPAN QRIS*\n\n` +
      `Error: ${err.message}\n\n` +
      `Coba lagi dengan /upQris`,
      { parse_mode: 'Markdown' }
    );
  }
});

// === COMMAND /cekQris ===
bot2.onText(/\/cekQris/i, (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) return;

  if (!hasQris()) {
    return bot2.sendMessage(chatId,
      `📭 *QRIS belum diupload*\n\nKetik /upQris untuk upload.`,
      { parse_mode: 'Markdown' }
    );
  }

  const stats = fs.statSync(QRIS_FILE);
  const sizeKB = (stats.size / 1024).toFixed(1);
  const modTime = stats.mtime.toLocaleString('id-ID');

  bot2.sendPhoto(chatId, QRIS_FILE, {
    caption:
      `📸 *QRIS AKTIF SAAT INI*\n\n` +
      `📊 Ukuran: ${sizeKB} KB\n` +
      `🕒 Terakhir update: ${modTime}\n\n` +
      `_Ketik /upQris untuk mengganti._`,
    parse_mode: 'Markdown'
  });
});

// === COMMAND /hapusQris ===
bot2.onText(/\/hapusQris/i, (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) return;

  if (!hasQris()) {
    return bot2.sendMessage(chatId, '📭 QRIS memang belum ada.');
  }

  try {
    fs.unlinkSync(QRIS_FILE);
    bot2.sendMessage(chatId,
      `🗑️ *QRIS DIHAPUS*\n\n` +
      `User tidak akan bisa membeli sampai Anda upload QRIS baru.\n\n` +
      `Ketik /upQris untuk upload ulang.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot2.sendMessage(chatId, `❌ Gagal hapus: ${err.message}`);
  }
});

// === COMMAND /cancel ===
bot2.onText(/\/cancel/i, (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(CONFIG.ADMIN_CHAT_ID)) return;

  if (adminStates[chatId]) {
    delete adminStates[chatId];
    bot2.sendMessage(chatId, '❌ Dibatalkan.');
  } else {
    bot2.sendMessage(chatId, 'Tidak ada proses yang berjalan.');
  }
});

// === COMMAND ADMIN LAINNYA ===
bot2.onText(/\/listusers/, (msg) => {
  if (String(msg.chat.id) !== String(CONFIG.ADMIN_CHAT_ID)) return;
  const users = Object.values(db.getUsers());
  if (users.length === 0) return bot2.sendMessage(msg.chat.id, '📭 Belum ada user.');

  let text = `👥 *DAFTAR USER AKTIF* (${users.length})\n\n`;
  users.forEach((u, i) => {
    const exp = u.expiresAt === 'PERMANENT'
      ? '♾️ Permanent'
      : new Date(u.expiresAt).toLocaleDateString('id-ID');
    text += `${i + 1}. \`${u.username}\`\n   Exp: ${exp}\n\n`;
  });
  bot2.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot2.onText(/\/deluser (.+)/, (msg, match) => {
  if (String(msg.chat.id) !== String(CONFIG.ADMIN_CHAT_ID)) return;
  const username = match[1].trim();
  if (!db.findUser(username)) {
    return bot2.sendMessage(msg.chat.id, `❌ User \`${username}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
  }
  db.deleteUser(username);
  bot2.sendMessage(msg.chat.id, `✅ User \`${username}\` dihapus.`, { parse_mode: 'Markdown' });
});

bot2.onText(/\/stats/, (msg) => {
  if (String(msg.chat.id) !== String(CONFIG.ADMIN_CHAT_ID)) return;
  const users = Object.values(db.getUsers());
  const orders = Object.values(db.getOrders());
  const approved = orders.filter(o => o.status === 'APPROVED');
  const pending = orders.filter(o => o.status === 'WAITING_APPROVAL');
  const revenue = approved.reduce((s, o) => s + (o.pkgPrice || 0), 0);

  bot2.sendMessage(msg.chat.id,
    `📊 *STATISTIK*\n\n` +
    `👥 User aktif: ${users.length}\n` +
    `📦 Total order: ${orders.length}\n` +
    `⏳ Pending: ${pending.length}\n` +
    `✅ Approved: ${approved.length}\n` +
    `💰 Revenue: ${formatRupiah(revenue)}\n` +
    `📸 QRIS: ${hasQris() ? '✅ Aktif' : '❌ Belum diupload'}`,
    { parse_mode: 'Markdown' }
  );
});

bot2.onText(/\/help/, (msg) => {
  if (String(msg.chat.id) !== String(CONFIG.ADMIN_CHAT_ID)) return;
  bot2.sendMessage(msg.chat.id,
    `📖 *BANTUAN ADMIN*\n\n` +
    `*QRIS:*\n` +
    `/upQris - Upload/ganti QRIS\n` +
    `/cekQris - Lihat QRIS aktif\n` +
    `/hapusQris - Hapus QRIS\n\n` +
    `*User:*\n` +
    `/listusers - Daftar user\n` +
    `/deluser <username> - Hapus user\n\n` +
    `*Info:*\n` +
    `/stats - Statistik lengkap`,
    { parse_mode: 'Markdown' }
  );
});

// ═══════════════════════════════════════════════
// AUTO-CLEANUP EXPIRED USERS (tiap 1 jam)
// ═══════════════════════════════════════════════
setInterval(() => {
  const users = db.getUsers();
  let deleted = 0;

  for (const u in users) {
    if (users[u].expiresAt !== 'PERMANENT' &&
        Date.now() >= new Date(users[u].expiresAt).getTime()) {
      db.deleteUser(u);
      deleted++;
      console.log(`[CLEANUP] User expired dihapus: ${u}`);
    }
  }

  if (deleted > 0) console.log(`[CLEANUP] Total ${deleted} user dihapus`);
}, 60 * 60 * 1000);

console.log('🤖 Bot #1 (Jual Akses) sudah berjalan...');
console.log('🤖 Bot #2 (Admin + QRIS Upload) sudah berjalan...');