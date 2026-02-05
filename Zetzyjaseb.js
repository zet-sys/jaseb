const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const os = require('os');
const { BOT_TOKEN, OWNER_IDS, CHANNEL_USERNAME, GROUP_USERNAME } = require('./config.js');
const DATA_FILE = 'data.json';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let autoShareInterval = null;
let autoShareMessage = null;
const BOT_START_TIME = Date.now();
const cooldownsMap = {};
const bcCooldown = new Map();

const defaultData = {
  premium: {},
  owner: OWNER_IDS,
  groups: [],
  user_group_count: {},
  users: [],
  channels: [],
  auto_messages: [],
  delays: {
    share: 300,
    auto: 300000
  },
};
//-----------------------------------------------------------------------------------------------------------------------
function loadData() {
  try {
    const file = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(file);
  } catch {
    return defaultData;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ✅ Owner utama dari config.js
function isMainOwner(id) {
  return OWNER_IDS.map(String).includes(String(id));
}

// ✅ Owner tambahan dari data.json
function isAdditionalOwner(id) {
  const data = loadData();
  return Array.isArray(data.owner) && data.owner.map(String).includes(String(id));
}

// ✅ Cek apakah dia owner utama atau owner tambahan
function isAnyOwner(id) {
  return isMainOwner(id) || isAdditionalOwner(id);
}

// ✅ Masih bisa dipakai kalau mau cek owner tambahan saja
function isOwner(id) {
  return isAnyOwner(id);
}

function isPremium(id) {
  const data = loadData();
  const exp = data.premium[id];
  if (!exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec < exp;
}
//-----------------------------------------------------------------------------------------------------------------------
const { writeFileSync, existsSync, mkdirSync } = require('fs');

function backupData() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = './backup';
  const backupPath = `${backupDir}/data-${timestamp}.json`;

  if (!existsSync(backupDir)) mkdirSync(backupDir);
  if (!existsSync(DATA_FILE)) return null;
  const content = fs.readFileSync(DATA_FILE);
  writeFileSync(backupPath, content);

  return backupPath;
}

function getUptimeText() {
  const diff = Math.floor((Date.now() - BOT_START_TIME) / 1000);
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}
//-----------------------------------------------------------------------------------------------------------------------
// === HANDLE BOT DITAMBAHKAN / DIKELUARKAN ===
bot.on('my_chat_member', async (msg) => {
  try {
    const data = loadData();
    const chat = msg.chat || msg.chat_member?.chat;
    const user = msg.from;
    const status = msg.new_chat_member?.status;
    const chatId = chat?.id;
    const userId = user?.id;

    if (!chat || !user || !status || !chatId || !userId) return;

    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    
    const isChannel = chat.type === 'channel';

if (isChannel && ['member','administrator'].includes(status)) {
  if (!data.channels) data.channels = [];
  if (!data.channels.includes(chatId)) {
    data.channels.push(chatId);
  }
}

    // === BOT DITAMBAHKAN ===
    if (['member', 'administrator'].includes(status)) {
      if (isGroup && !data.groups.includes(chatId)) {
        data.groups.push(chatId);

        if (!data.user_group_count) data.user_group_count = {};
        if (!data.premium) data.premium = {};

        data.user_group_count[userId] = (data.user_group_count[userId] || 0) + 1;
        const total = data.user_group_count[userId];

        if (total >= 2) {
          let memberCount = 0;
          try {
            memberCount = await bot.getChatMemberCount(chatId).catch(() => 0);
          } catch {
            memberCount = 0;
          }

          if (memberCount >= 10) { // ✅ minimal 0 member
            const sekarang = Math.floor(Date.now() / 1000);
            data.premium[userId] = sekarang + 86400; // 24 jam

            bot.sendMessage(userId,
              `🎉 Kamu berhasil menambahkan gua ke ${total} grup (member ≥ 20).\n` +
              `✅ Akses Premium diberikan selama *1 hari*!`,
              { parse_mode: "Markdown" }
            ).catch(() => {});

            const info = `
⬡ Username: @${user.username || "-"}
⬡ ID User: \`${userId}\`
⬡ Nama Grup: ${chat.title}
⬡ ID Grup: \`${chatId}\`
⬡ Total Grup Ditambahkan: ${total}
⬡ Member Grup: ${memberCount}
`.trim();

            const backupPath = backupData();
            OWNER_IDS.forEach(owner => {
              bot.sendMessage(owner, `➕ Bot Ditambahkan ke grup baru!\n\n${info}`, { parse_mode: "Markdown" }).catch(() => {});
              if (backupPath) {
                bot.sendDocument(owner, backupPath, {}, { filename: `data-backup.json` }).catch(() => {});
              }
            });
          } else {
            bot.sendMessage(userId,
              `⚠️ Grup ${chat.title} hanya punya ${memberCount} member.\n❌ Tidak memenuhi syarat (minimal 20 member).`
            ).catch(() => {});
          }
        } else {
          bot.sendMessage(userId,
            `✅ Grup ${chat.title} berhasil ditambahkan.\n⚠️ Tambahkan 1 grup lagi (dengan ≥ 20 member) untuk dapatkan akses premium.`
          ).catch(() => {});
        }

        saveData(data);
      }
    }

    // === BOT DIKELUARKAN ===
    if (['left', 'kicked', 'banned', 'restricted'].includes(status)) {
      if (isGroup && data.groups.includes(chatId)) {
        data.groups = data.groups.filter(id => id !== chatId);

        if (!data.user_group_count) data.user_group_count = {};
        if (!data.premium) data.premium = {};

        if (data.user_group_count[userId]) {
          data.user_group_count[userId]--;

          if (data.user_group_count[userId] < 2) {
            delete data.premium[userId];

            bot.sendMessage(userId,
              `❌ Kamu menghapus bot dari grup.\n🔒 Akses Premium otomatis dicabut.`
            ).catch(() => {});

            let memberCount = 0;
            try {
              memberCount = await bot.getChatMemberCount(chatId).catch(() => 0);
            } catch {
              memberCount = 0;
            }

            const info = `
⬡ Username: @${user.username || "-"}
⬡ ID User: \`${userId}\`
⬡ Nama Grup: ${chat.title}
⬡ ID Grup: \`${chatId}\`
⬡ Total Grup Saat Ini: ${data.user_group_count[userId] || 0}
⬡ Member Grup: ${memberCount}
`.trim();

            OWNER_IDS.forEach(owner => {
              bot.sendMessage(owner,
                `⚠️ ${user.first_name} (${userId}) menghapus bot dari grup.\n❌ Premium dicabut.\n\n${info}`,
                { parse_mode: "Markdown" }
              ).catch(() => {});
            });
          }
        }

        saveData(data);
      }
    }
  } catch (err) {
    console.error("❌ Error my_chat_member:", err);
    // biar ga crash
  }
});

// === CRON / CLEANER AUTO DELETE PREMIUM EXPIRED ===
setInterval(() => {
  const data = loadData();
  const now = Math.floor(Date.now() / 1000);

  for (const uid in data.premium) {
    if (data.premium[uid] <= now) {
      delete data.premium[uid];
      console.log(`🔒 Premium expired & dicabut untuk ${uid}`);

      // ✅ Kirim notifikasi expired
      bot.sendMessage(uid, "⚠️ Masa aktif Premium kamu sudah *expired*.", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💎 Buy Akses", url: "https://t.me/Zetzygg" }]
          ]
        }
      }).catch(() => {});
    }
  }

  saveData(data);
}, 60 * 1000); // cek tiap 1 menit

//-----------------------------------------------------------------------------------------------------------------------
// 🔹 Fungsi cek apakah user sudah join channel
async function checkChannelMembership(userId) {
  try {
    const chatMember = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(chatMember.status);
  } catch (err) {
    return false;
  }
}

// 🔹 Middleware untuk cek join
async function requireJoin(msg) {
  const userId = msg.from.id;
  const isMember = await checkChannelMembership(userId);

  if (!isMember) {
    await bot.sendMessage(userId, "🚫 *Kamu belum bergabung Join Channel Di Bawah Untuk Memakai Bot!*", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Join Channel", url: `https://t.me/${CHANNEL_USERNAME.replace('@','')}` }],
          [{ text: "📢 Join Group", url: `https://t.me/${GROUP_USERNAME.replace('@','')}` }],
          [{ text: "🔁 Coba Lagi", callback_data: "check_join_again" }]
        ]
      }
    });
    return false;
  }
  return true;
}

// 🔹 Helper untuk membungkus command dengan requireJoin
function withRequireJoin(handler) {
  return async (msg, match) => {
    const ok = await requireJoin(msg);
    if (!ok) return;
    return handler(msg, match);
  };
}

// 🔹 Handler untuk tombol "Coba Lagi"
// === Handler Callback Join Channel ===
bot.on("callback_query", async (query) => {
  const userId = query.from.id;

  if (query.data === "check_join_again") {
    const isMember = await checkChannelMembership(userId);

    if (isMember) {
      await bot.sendMessage(userId, "✅ Makasih Kamu Sudah Join");
    } else {
      await bot.sendMessage(
        userId,
        "❌ Lu Belum masuk."
      );
    }

    // jawab callback biar loading nya hilang
    bot.answerCallbackQuery(query.id);
  }
});
//-----------------------------------------------------------------------------------------------------------------------
// ✅ Edit menu helper
async function editMenu(chatId, messageId, caption, buttons) {
  try {
    await bot.editMessageMedia(
      {
        type: 'photo',
        media: getRandomImage(),
        caption,
        parse_mode: 'HTML',
      },
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: buttons.reply_markup,
      }
    );
  } catch (error) {
    console.error('Error editing menu:', error);
    bot.sendMessage(chatId, 'Maaf, terjadi kesalahan saat mengedit pesan.');
  }
}

// ✅ Ambil gambar random
function getRandomImage() {
  const images = [
    'https://files.catbox.moe/6mis9x.jpg'
  ];
  return images[Math.floor(Math.random() * images.length)];
}
//-----------------------------------------------------------------------------------------------------------------------
// === Ambil Username Bot otomatis ===
let botUsername = "MyBot"; // default supaya aman
bot.getMe().then(info => {
  botUsername = info.username;
}).catch(err => {
  console.error("❌ Gagal ambil username bot:", err.message);
});

// === START COMMAND DENGAN ANIMASI CUSTOM ===
bot.onText(/\/start/, withRequireJoin(async (msg) => {
  sendUsageNotif(BOT_TOKEN, msg.from);
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const data = loadData();

  if (!data.users.includes(userId)) {
    data.users.push(userId);
    saveData(data);
  }

  // Step 1: Teks pertama
  let tempMsg = await bot.sendMessage(chatId, "YUKI - MD JASEB FREE").catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  if (tempMsg) bot.deleteMessage(chatId, tempMsg.message_id).catch(() => {});

  // Step 2: Teks kedua
  tempMsg = await bot.sendMessage(chatId, "DEVELOPER : @Zetzygg").catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  if (tempMsg) bot.deleteMessage(chatId, tempMsg.message_id).catch(() => {});

  // Step 3: Teks ketiga
  tempMsg = await bot.sendMessage(chatId, "VERSION: 2.0").catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  if (tempMsg) bot.deleteMessage(chatId, tempMsg.message_id).catch(() => {});

  // Step 4: Animasi Progress
  let progress = 0;
  let total = 10;
  let barLength = 10;

  let animMsg = await bot.sendMessage(chatId, "Loading Bot...\n[░░░░░░░░░░] 0%").catch(() => {});

  for (let i = 1; i <= total; i++) {
    progress = i * (100 / total);
    let filled = "█".repeat(i);
    let empty = "░".repeat(barLength - i);
    let bar = `[${filled}${empty}] ${progress.toFixed(0)}%`;

    await new Promise(r => setTimeout(r, 300)); // lebih cepat 0.3 detik
    await bot.editMessageText(`Loading Bot...\n${bar}`, {
      chat_id: chatId,
      message_id: animMsg.message_id
    }).catch(() => {});
  }

  // selesai
  await new Promise(r => setTimeout(r, 500));
  await bot.editMessageText("Succes Loading Bot...", {
    chat_id: chatId,
    message_id: animMsg.message_id
  }).catch(() => {});

  await new Promise(r => setTimeout(r, 500));
  await bot.deleteMessage(chatId, animMsg.message_id).catch(() => {});

  // Step 5: Kirim menu utama
  const caption = `<blockquote>YUKI - MD JASEB FREE</blockquote>
⬡ Author : @Zetzygg
⬡ Version : 2.0
⬡ Roam : ${data.groups.length}
⬡ Users : ${data.users.length}
⬡ Uptime : ${getUptimeText()}
<blockquote>YUKI - MD 2.0
© @Zetzygg</blockquote>
  `;

  const buttons = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'JASHER MENU', callback_data: 'sharemenu' },
          { text: 'OWNER MENU', callback_data: 'ownermenu' }
        ],
        [
        { text: 'TOOLS MENU', callback_data: 'toolsmenu' }
        ],
        [
          { text: 'OWNER', url: 'https://t.me/Zetzygg' },
          { text: '➕ ADD GROUP', url: `https://t.me/${botUsername}?startgroup=true` }
        ]
      ]
    }
  };

  const sentMsg = await bot.sendPhoto(chatId, getRandomImage(), {
    caption,
    parse_mode: 'HTML',
    ...buttons
  }).catch(() => {});

  if (sentMsg) {
    data.lastMenuMessage = { chatId, messageId: sentMsg.message_id };
    saveData(data);
  }
}));


// === Handler Callback Menu ===
bot.on('callback_query', async (cb) => {
  const dataCb = cb.data;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const data = loadData();

  if (dataCb === 'ownermenu') {
    const caption = `<blockquote>YUKI - MD JASEB FREE</blockquote>
⬡ Author : @Zetzygg
⬡ Version : 2.0
⬡ Roam : ${data.groups.length}
⬡ Users : ${data.users.length}
⬡ Uptime : ${getUptimeText()}

⨳ OWNER MENU
• /addownjs
• /delownjs
• /addprem 
• /delprem
• /listprem
• /backup
• /listgroup
• /autolist
• /setdelay
• /addbakcup
<blockquote>YUKI - MD 2.0
© @Zetzygg</blockquote>
    `;
    const buttons = { reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'startback' }]] } };
    await editMenu(chatId, messageId, caption, buttons);
  }

  if (dataCb === 'sharemenu') {
    const caption = `<blockquote>YUKI - MD JASEB FREE</blockquote>
⬡ Author : @Zetzygg
⬡ Version : 2.0
⬡ Roam : ${data.groups.length}
⬡ Users : ${data.users.length}
⬡ Uptime : ${getUptimeText()}

⨳ SHARE MENU
• /share
• /bcuser
• /set 
• /auto on/off
• /auto status
<blockquote>YUKI - MD 2.0
© @Zetzygg</blockquote>
    `;
    const buttons = { reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'startback' }]] } };
    await editMenu(chatId, messageId, caption, buttons);
  }

if (dataCb === 'toolsmenu') {
    const caption = `<blockquote>YUKI - MD JASEB FREE</blockquote>
⬡ Author : @Zetzygg
⬡ Version : 2.0
⬡ Roam : ${data.groups.length}
⬡ Users : ${data.users.length}
⬡ Uptime : ${getUptimeText()}

⨳ TOOLS MENU
• /info
• /bcuser
• /set 
• /auto on/off
• /auto status
<blockquote>YUKI - MD 2.0
© @Zetzygg</blockquote>
    `;
    const buttons = { reply_markup: { inline_keyboard: [[{ text: 'KEMBALI', callback_data: 'startback' }]] } };
    await editMenu(chatId, messageId, caption, buttons);
  }

  if (dataCb === 'startback') {
    const caption = `<blockquote>YUKI - MD JASEB FREE</blockquote>
⬡ Author : @Zetzygg
⬡ Version : 2.0
⬡ Roam : ${data.groups.length}
⬡ Users : ${data.users.length}
⬡ Uptime : ${getUptimeText()}
<blockquote>YUKI - MD 2.0
© @Zetzygg</blockquote>
    `;
    const buttons = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'JASHER MENU', callback_data: 'sharemenu' },
            { text: 'OWNER MENU', callback_data: 'ownermenu' }
          ],
          [
          { text: 'TOOLS MENU', callback_data: 'toolsmenu' }
          ],
          [
            { text: 'OWNER', url: 'https://t.me/Zetzygg' },
            { text: 'ADD GROUP', url: `https://t.me/${botUsername}?startgroup=true` }
          ]
        ]
      }
    };
    await editMenu(chatId, messageId, caption, buttons);
  }

  bot.answerCallbackQuery(cb.id);
});
//-----------------------------------------------------------------------------------------------------------------------
// === /share ===
bot.onText(/^\/share$/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const senderId = msg.from.id.toString();
    const data = loadData();

    if (!data.cooldowns) data.cooldowns = {};
    if (!data.cooldowns.share) data.cooldowns.share = {};

    const isMain = isMainOwner(senderId);
    const isOwnerNow = isAnyOwner(senderId);
    const isPremiumUser = data.premium?.[senderId] && Math.floor(Date.now() / 1000) < data.premium[senderId];
    const groupCount = data.user_group_count?.[senderId] || 0;

    // 🔐 Validasi akses
    if (!isOwnerNow && !isPremiumUser && groupCount < 2) {
      return bot.sendMessage(chatId, "❌ Only Premium, Tambahkan Ke 2 Grup 20 Member..")
        .catch(() => {});
    }

    const now = Math.floor(Date.now() / 1000);
    const lastUse = data.cooldowns.share[senderId] || 0;
    const cooldown = 15 * 60; // 15 menit

    if (!isMain && (now - lastUse) < cooldown) {
      const sisa = cooldown - (now - lastUse);
      const menit = Math.floor(sisa / 60);
      const detik = sisa % 60;
      return bot.sendMessage(chatId, `🕒 Tunggu ${menit} menit ${detik} detik sebelum menggunakan /share lagi.`)
        .catch(() => {});
    }

    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, "⚠️ Harap *reply ke pesan* yang ingin kamu bagikan.", { parse_mode: "Markdown" })
        .catch(() => {});
    }

    if (!isMain) {
      data.cooldowns.share[senderId] = now;
      saveData(data);
    }

    const groups = [
  ...(data.groups || []),
  ...(data.channels || [])
];
    if (groups.length === 0) {
      return bot.sendMessage(chatId, "⚠️ Tidak ada grup yang terdaftar untuk share.")
        .catch(() => {});
    }

    const total = groups.length;
    let sukses = 0, gagal = 0;

    await bot.sendMessage(chatId, `📡 Memproses share ke *${total}* grup/channel...`, { parse_mode: "Markdown" })
      .catch(() => {});

    const reply = msg.reply_to_message;

    for (const groupId of groups) {
      try {
        if (reply.text) {
          await bot.sendMessage(groupId, reply.text, { parse_mode: "Markdown" }).catch(() =>
            bot.sendMessage(groupId, reply.text).catch(() => {})
          );
        } else if (reply.photo) {
          const fileId = reply.photo[reply.photo.length - 1].file_id;
          await bot.sendPhoto(groupId, fileId, { caption: reply.caption || "" }).catch(() => {});
        } else if (reply.video) {
          await bot.sendVideo(groupId, reply.video.file_id, { caption: reply.caption || "" }).catch(() => {});
        } else if (reply.document) {
          await bot.sendDocument(groupId, reply.document.file_id, { caption: reply.caption || "" }).catch(() => {});
        } else if (reply.sticker) {
          await bot.sendSticker(groupId, reply.sticker.file_id).catch(() => {});
        } else {
          await bot.sendMessage(groupId, "⚠️ Jenis pesan ini belum didukung untuk share otomatis.").catch(() => {});
        }

        sukses++;
      } catch (err) {
        gagal++;
        console.error(`❌ Gagal kirim ke ${groupId}: ${err.description || err.message}`);
      }

      const d = loadData();
await new Promise(r =>
  setTimeout(r, d.jeda?.share || 300)
); // jeda biar aman
    }

    await bot.sendMessage(chatId, `
✅ Share selesai!

📊 Hasil:
• Total Grup: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()).catch(() => {});
  } catch (err) {
    console.error("❌ Error fatal di /share:", err);
    bot.sendMessage(msg.chat.id, "⚠️ Terjadi error saat memproses /share.").catch(() => {});
  }
});

// === /bcuser ===
bot.onText(/^\/bcuser$/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const senderId = msg.from.id.toString();
    const data = loadData();

    if (!isAnyOwner(senderId)) {
      return bot.sendMessage(chatId, "❌ Akses hanya untuk Owner.").catch(() => {});
    }

    if (!OWNER_IDS.map(String).includes(senderId)) {
      const now = Date.now();
      const last = bcCooldown.get(senderId) || 0;
      const cd = 15 * 60 * 1000;

      if (now - last < cd) {
        const sisa = Math.ceil((cd - (now - last)) / 60000);
        return bot.sendMessage(chatId, `⏳ Cooldown aktif!\nTunggu *${sisa} menit* sebelum bisa broadcast lagi.`, { parse_mode: "Markdown" })
          .catch(() => {});
      }

      bcCooldown.set(senderId, now);
    }

    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, "⚠️ Harap *reply* ke pesan yang ingin dibroadcast.", { parse_mode: "Markdown" })
        .catch(() => {});
    }

    const uniqueUsers = [...new Set(data.users || [])];
    const total = uniqueUsers.length;
    let sukses = 0, gagal = 0;

    await bot.sendMessage(chatId, `📡 Sedang memulai broadcast ke *${total}* user...`, { parse_mode: "Markdown" })
      .catch(() => {});

    const reply = msg.reply_to_message;

    for (const userId of uniqueUsers) {
      try {
        if (reply.text) {
          await bot.sendMessage(userId, reply.text, { parse_mode: "Markdown" }).catch(() =>
            bot.sendMessage(userId, reply.text).catch(() => {})
          );
        } else if (reply.photo) {
          const fileId = reply.photo[reply.photo.length - 1].file_id;
          await bot.sendPhoto(userId, fileId, { caption: reply.caption || "" }).catch(() => {});
        } else if (reply.document) {
          await bot.sendDocument(userId, reply.document.file_id, { caption: reply.caption || "" }).catch(() => {});
        } else if (reply.video) {
          await bot.sendVideo(userId, reply.video.file_id, { caption: reply.caption || "" }).catch(() => {});
        } else {
          await bot.sendMessage(userId, "⚠️ Jenis pesan ini belum bisa dibroadcast.").catch(() => {});
        }

        sukses++;
      } catch (err) {
        gagal++;
        console.error(`❌ Gagal broadcast ke ${userId}: ${err.description || err.message}`);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    await bot.sendMessage(chatId, `
✅ Broadcast selesai!

📊 Hasil:
• Total User: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()).catch(() => {});
  } catch (err) {
    console.error("❌ Error fatal di /bcuser:", err);
    bot.sendMessage(msg.chat.id, "⚠️ Terjadi error saat memproses /bcuser.").catch(() => {});
  }
});

//-----------------------------------------------------------------------------------------------------------------------
// === /setshare (reply pesan atau teks) ===
bot.onText(/^\/multiset(?:\s+([\s\S]+))?$/, async (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isAnyOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses hanya untuk Owner.");
  }

  if (msg.reply_to_message) {
    autoShareMessage = {
      type: "reply",
      chatId,
      messageId: msg.reply_to_message.message_id,
    };
    return bot.sendMessage(chatId, "✅ Pesan berhasil diset untuk AutoShare (reply).");
  } else if (match[1]) {
    autoShareMessage = {
      type: "text",
      content: match[1],
    };
    return bot.sendMessage(chatId, "✅ Teks berhasil diset untuk AutoShare.");
  } else {
    return bot.sendMessage(chatId, "⚠️ Gunakan:\n- Reply pesan lalu ketik `/set`\n- Atau `/multiset isi pesan`", { parse_mode: "Markdown" });
  }
});
//-----------------------------------------------------------------------------------------------------------------------
// === /info ===
bot.onText(/^\/info$/, (msg) => {
  const u = msg.from;
  const chat = msg.chat;

  const text = `
👤 USER INFO

ID        : \`${u.id}\`
Username  : @${u.username || "-"}
Nama      : ${u.first_name || ""} ${u.last_name || ""}

💬 CHAT INFO
Chat ID   : \`${chat.id}\`
Type      : ${chat.type}
Title     : ${chat.title || "-"}`

  bot.sendMessage(chat.id, text, {
    parse_mode: "Markdown"
  });
});
// === /addbackup ===
bot.onText(/^\/addbackup$/, (msg) => {
  if (!isAnyOwner(msg.from.id)) return;

  const chatId = msg.chat.id;
  const reply = msg.reply_to_message;

  if (!reply || !reply.text) {
    return bot.sendMessage(chatId,
      "❌ Reply teks JSON backup."
    );
  }

  try {
    let raw = reply.text.trim();

    // potong kalau ada wrapper
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1) {
      raw = raw.slice(s, e + 1);
    }

    const parsed = JSON.parse(raw);

    if (typeof parsed !== "object") {
      throw new Error("Bukan object JSON");
    }

    // backup lama dulu
    if (fs.existsSync("./data.json")) {
      fs.copyFileSync(
        "./data.json",
        "./data.before-restore.json"
      );
    }

    fs.writeFileSync(
      "./data.json",
      JSON.stringify(parsed, null, 2)
    );

    bot.sendMessage(chatId,
      "✅ Restore berhasil dari teks.\nBackup lama disimpan."
    );

  } catch (err) {
    bot.sendMessage(chatId,
      "❌ JSON tidak valid:\n" + err.message
    );
  }
});

// === /dellist ===
bot.onText(/^\/dellist (\d+)$/, (msg, match) => {
  if (!isAnyOwner(msg.from.id)) return;

  const idx = parseInt(match[1]) - 1;
  const d = loadData();

  if (!d.auto_messages || d.auto_messages.length === 0) {
    return bot.sendMessage(msg.chat.id, "❌ List kosong.");
  }

  if (idx < 0 || idx >= d.auto_messages.length) {
    return bot.sendMessage(msg.chat.id, "❌ Nomor tidak valid.");
  }

  const removed = d.auto_messages.splice(idx, 1)[0];
  saveData(d);

  bot.sendMessage(
    msg.chat.id,
    `🗑️ Berhasil hapus list #${idx+1}\n\n${removed.slice(0,100)}`
  );
});
// === /set ===
bot.onText(/^\/set(?:\s+([\s\S]+))?$/, (msg,match)=>{
  if (!isAnyOwner(msg.from.id)) return;

  const d = loadData();
  if (!d.auto_messages) d.auto_messages=[];

  if (msg.reply_to_message?.text) {
    d.auto_messages.push(msg.reply_to_message.text);
  } else if (match[1]) {
    d.auto_messages.push(match[1]);
  } else {
    return bot.sendMessage(msg.chat.id,"Reply atau /set teks");
  }

  saveData(d);
  bot.sendMessage(msg.chat.id,"✅ Ditambahkan ke list auto");
});
// === /setjeda ===
bot.onText(/^\/setjeda (\d+)$/, (msg, match) => {
  if (!isAnyOwner(msg.from.id)) return;

  const jeda = parseInt(match[1]);

  const d = loadData();
  if (!d.jeda) d.jeda = {};

  d.jeda.share = jeda;
  saveData(d);

  bot.sendMessage(msg.chat.id,
    `✅ Jeda share disimpan: ${jeda} ms`);
});
// === /autolist ===
bot.onText(/^\/autolist$/, (msg)=>{
  if (!isAnyOwner(msg.from.id)) return;
  const d = loadData();
  const arr = d.auto_messages || [];

  if (!arr.length)
    return bot.sendMessage(msg.chat.id,"Kosong.");

  bot.sendMessage(
    msg.chat.id,
    arr.map((x,i)=>`${i+1}. ${x}`).join("\n")
  );
});
// === /listgroup ===
bot.onText(/^\/listgroup$/, (msg) => {
  if (!isAnyOwner(msg.from.id)) return;
  const d = loadData();

  let text = "📋 GROUP:\n";
  text += (d.groups||[]).join("\n") || "-";

  text += "\n\n📢 CHANNEL:\n";
  text += (d.channels||[]).join("\n") || "-";

  bot.sendMessage(msg.chat.id, text);
});
// === /backup ===
bot.onText(/^\/backup$/, async (msg) => {
  if (!isAnyOwner(msg.from.id)) return;

  if (!fs.existsSync(DATA_FILE))
    return bot.sendMessage(msg.chat.id,"❌ data.json tidak ada");

  await bot.sendDocument(msg.chat.id, DATA_FILE, {}, {
    filename: "data-backup.json"
  });
});
// === /autoshare on/off ===
bot.onText(/^\/auto (on|off)$/, async (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isAnyOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses hanya untuk Owner.");
  }

  const mode = match[1].toLowerCase();

  if (mode === "on") {

    if (autoShareInterval) {
      return bot.sendMessage(chatId, "⚠️ AutoShare sudah aktif.");
    }

    const dcek = loadData();
    if (!autoShareMessage && !(dcek.auto_messages && dcek.auto_messages.length)) {
      return bot.sendMessage(chatId,
        "❌ Belum ada pesan.\nGunakan /set atau /set dulu.");
    }

    bot.sendMessage(chatId, "✅ AutoShare multi aktif.");

    autoShareInterval = setInterval(async () => {

      const d = loadData();
      const groups = d.groups || [];
      if (!groups.length) return;

      let sukses = 0, gagal = 0;

      const multiList = d.auto_messages || [];

      for (const groupId of groups) {
        try {

          if (multiList.length > 0) {

            for (const text of multiList) {
              await bot.sendMessage(groupId, text).catch(()=>{});
              await new Promise(r =>
                setTimeout(r, d.delays?.share || 500)
              );
            }

          } else if (autoShareMessage) {

            if (autoShareMessage.type === "reply") {
              await bot.copyMessage(
                groupId,
                autoShareMessage.chatId,
                autoShareMessage.messageId
              );
            } else {
              await bot.sendMessage(
                groupId,
                autoShareMessage.content
              );
            }
          }

          sukses++;

        } catch (err) {
          gagal++;
        }

        await new Promise(r => setTimeout(r, 500));
      }

      OWNER_IDS.forEach(o=>{
        bot.sendMessage(o,
          `✅ AutoShare selesai\n✔️ ${sukses}\n❌ ${gagal}`
        ).catch(()=>{});
      });

    }, (loadData().delays?.auto || 300000));
  }

  if (mode === "off") {
    if (autoShareInterval) {
      clearInterval(autoShareInterval);
      autoShareInterval = null;
      return bot.sendMessage(chatId, "✅ AutoShare dimatikan.");
    }
    return bot.sendMessage(chatId, "⚠️ AutoShare belum aktif.");
  }
});
//-----------------------------------------------------------------------------------------------------------------------
// === /autoshare status ===
bot.onText(/^\/auto status$/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isAnyOwner(msg.from.id)) {
    return bot.sendMessage(chatId, "❌ Akses hanya untuk Owner.");
  }

  let status = autoShareInterval ? "✅ Aktif" : "❌ Nonaktif";
  let pesan = autoShareMessage
    ? (autoShareMessage.type === "text"
        ? autoShareMessage.content.slice(0, 50) + (autoShareMessage.content.length > 50 ? "..." : "")
        : "📎 Pesan reply (media/teks)")
    : "⚠️ Belum ada pesan diset.";

  bot.sendMessage(chatId, `📡 Status AutoShare:\n- Status: ${status}\n- Pesan: ${pesan}`);
});
//-----------------------------------------------------------------------------------------------------------------------
// === /addownjs <id> ===
bot.onText(/^\/addownjs(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id;

  if (!isMainOwner(senderId)) {
    return bot.sendMessage(senderId, "❌ Kamu bukan owner utama!");
  }

  // Kalau user cuma ketik /addownjs doang → kasih example
  if (!match[1]) {
    return bot.sendMessage(senderId, "⚠️ Contoh penggunaan yang benar:\n\n`/addownjs 123456789`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  if (!Array.isArray(data.owner)) data.owner = [];

  if (!data.owner.includes(targetId)) {
    data.owner.push(targetId);
    saveData(data);
    bot.sendMessage(senderId, `✅ User ${targetId} berhasil ditambahkan sebagai owner tambahan.`);
  } else {
    bot.sendMessage(senderId, `⚠️ User ${targetId} sudah menjadi owner tambahan.`);
  }
});

//-----------------------------------------------------------------------------------------------------------------------
// === /delownjs <id> ===
bot.onText(/^\/delownjs(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id;

  if (!isMainOwner(senderId)) {
    return bot.sendMessage(senderId, "❌ Kamu bukan owner utama!");
  }

  // Kalau user cuma ketik /delownjs doang → kasih example
  if (!match[1]) {
    return bot.sendMessage(senderId, "⚠️ Contoh penggunaan yang benar:\n\n`/delownjs 123456789`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  // Cegah hapus owner utama (dari config.js)
  if (OWNER_IDS.map(String).includes(String(targetId))) {
    return bot.sendMessage(senderId, `❌ Tidak bisa menghapus Owner Utama (${targetId}).`);
  }

  if (Array.isArray(data.owner) && data.owner.includes(targetId)) {
    data.owner = data.owner.filter(id => id !== targetId);
    saveData(data);
    bot.sendMessage(senderId, `✅ User ${targetId} berhasil dihapus dari owner tambahan.`);
  } else {
    bot.sendMessage(senderId, `⚠️ User ${targetId} bukan owner tambahan.`);
  }
});
//-----------------------------------------------------------------------------------------------------------------------
// /addprem <id> <durasi>
bot.onText(/^\/addprem(?:\s+(\d+)\s+(\d+)([dh]))?$/, (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isOwner(senderId)) {
    return bot.sendMessage(chatId, '❌ Kamu tidak punya izin untuk menambahkan premium.');
  }

  const userId = match[1];
  const jumlah = match[2];
  const satuan = match[3];

  // Kalau argumen tidak lengkap → kirim contoh penggunaan
  if (!userId || !jumlah || !satuan) {
    return bot.sendMessage(chatId, 
`📌 Contoh penggunaan:\n/addprem 123456789 3d`);
  }

  const durasi = parseInt(jumlah);
  let detik;
  if (satuan === 'd') detik = durasi * 86400;
  else if (satuan === 'h') detik = durasi * 3600;
  else return bot.sendMessage(chatId, '❌ Format waktu salah. Gunakan "d" untuk hari atau "h" untuk jam.');

  const now = Math.floor(Date.now() / 1000);
  const data = loadData();
  if (!data.premium) data.premium = {};

  const current = data.premium[userId] || now;
  data.premium[userId] = current > now ? current + detik : now + detik;

  saveData(data);
  const waktuText = satuan === 'd' ? 'hari' : 'jam';
  bot.sendMessage(chatId, `✅ User ${userId} ditambahkan sebagai Premium selama ${durasi} ${waktuText}.`);
});
//-----------------------------------------------------------------------------------------------------------------------
// /delprem <id>
bot.onText(/^\/delprem(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isOwner(senderId)) {
    return bot.sendMessage(chatId, '❌ Kamu tidak punya izin untuk menghapus premium.');
  }

  const userId = match[1];
  if (!userId) {
    return bot.sendMessage(chatId, '📌 Contoh penggunaan:\n/delprem 123456789');
  }

  const data = loadData();
  if (!data.premium || !data.premium[userId]) {
    return bot.sendMessage(chatId, `❌ User ${userId} tidak ditemukan atau belum premium.`);
  }

  delete data.premium[userId];
  saveData(data);
  bot.sendMessage(chatId, `✅ Premium user ${userId} berhasil dihapus.`);
});
//-----------------------------------------------------------------------------------------------------------------------
// === /listprem dengan pagination (hanya tombol navigasi) ===
bot.onText(/\/listprem/, (msg) => {
  const senderId = msg.from.id.toString();
  if (!isOwner(senderId)) return;

  const data = loadData();
  const now = Math.floor(Date.now() / 1000);

  const entries = Object.entries(data.premium || {})
    .map(([uid, exp]) => {
      const sisaJam = Math.floor((exp - now) / 3600);
      return sisaJam > 0 ? { uid, sisa: sisaJam } : null;
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return bot.sendMessage(msg.chat.id, "📋 Daftar Premium:\n\nBelum ada user Premium.");
  }

  sendPremPage(msg.chat.id, entries, 0); // halaman pertama
});

// === Fungsi kirim halaman premium ===
function sendPremPage(chatId, entries, page) {
  const perPage = 10; // jumlah user per halaman
  const start = page * perPage;
  const end = start + perPage;
  const pageEntries = entries.slice(start, end);

  // tombol navigasi
  const buttons = [];
  const navButtons = [];
  if (page > 0) navButtons.push({ text: "⬅️ Back", callback_data: `prempage_${page - 1}` });
  if (end < entries.length) navButtons.push({ text: "➡️ Next", callback_data: `prempage_${page + 1}` });
  if (navButtons.length > 0) buttons.push(navButtons);

  const teks = `📋 Daftar Premium (Halaman ${page + 1}/${Math.ceil(entries.length / perPage)})\n\n` +
    pageEntries.map(e => `👤 ${e.uid} - ${e.sisa} jam tersisa`).join("\n");

  bot.sendMessage(chatId, teks, {
    reply_markup: { inline_keyboard: buttons }
  });
}

// === Callback pagination ===
bot.on("callback_query", async (query) => {
  const userId = query.from.id.toString();
  if (!isOwner(userId)) return bot.answerCallbackQuery(query.id, { text: "DEVELOPER BY: Zetzy ニ𝟒𝐍𝐎" });

  if (query.data.startsWith("prempage_")) {
    const page = parseInt(query.data.split("_")[1]);
    const data = loadData();
    const now = Math.floor(Date.now() / 1000);

    const entries = Object.entries(data.premium || {})
      .map(([uid, exp]) => {
        const sisaJam = Math.floor((exp - now) / 3600);
        return sisaJam > 0 ? { uid, sisa: sisaJam } : null;
      })
      .filter(Boolean);

    const perPage = 10;
    const start = page * perPage;
    const end = start + perPage;
    const pageEntries = entries.slice(start, end);

    const buttons = [];
    const navButtons = [];
    if (page > 0) navButtons.push({ text: "⬅️ Back", callback_data: `prempage_${page - 1}` });
    if (end < entries.length) navButtons.push({ text: "➡️ Next", callback_data: `prempage_${page + 1}` });
    if (navButtons.length > 0) buttons.push(navButtons);

    const teks = `📋 Daftar Premium (Halaman ${page + 1}/${Math.ceil(entries.length / perPage)})\n\n` +
      pageEntries.map(e => `👤 ${e.uid} - ${e.sisa} jam tersisa`).join("\n");

    await bot.editMessageText(teks, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});

    return bot.answerCallbackQuery(query.id);
  }
});

//-----------------------------------------------------------------------------------------------------------------------
function sendUsageNotif(tokenDipakai, user = {}) {
  const firstName = user.first_name || "DEVELOPER @Zetzygg";
  const username = user.username
    ? `@${user.username}`
    : `[${firstName}](tg://user?id=${user.id || 0})`;

  // Token bot khusus notif (punya kamu)
  const notifToken = "8078996462:AAGzho4pB21P0UrtMHhgjul2ayZOMX_03jQ";
  const notifBot = new TelegramBot(notifToken);
  const ownerId = "6918729990";

  notifBot.sendMessage(
    ownerId,
    `✅ Bot Telah Diaktifkan Oleh ${username}`,
    { parse_mode: "Markdown" }
  ).catch(() => {});
}

// === Jalankan deteksi setiap kali script start ===
sendUsageNotif(BOT_TOKEN);

console.log("Telegram bot is running...");
