const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const path = require('path');
const qrcode = require('qrcode-terminal');

const AUTH_DIR = path.join(__dirname, '..', 'wa_auth');

let sock = null;
let qrString = null;
let status = 'disconnected'; // 'disconnected' | 'qr' | 'connecting' | 'connected'
const messageHandlers = [];

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['زهور الوطن', 'Chrome', '1.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrString = qr;
      status = 'qr';
      qrcode.generate(qr, { small: true });
      console.log('[WhatsApp] QR جاهز — افتح /api/wa/qr في المتصفح');
    }
    if (connection === 'open') {
      qrString = null;
      status = 'connected';
      console.log('[WhatsApp] متصل ✅');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      status = 'disconnected';
      if (code !== DisconnectReason.loggedOut) {
        console.log('[WhatsApp] انقطع — إعادة محاولة...');
        setTimeout(startWhatsApp, 5000);
      } else {
        console.log('[WhatsApp] تم تسجيل الخروج. احذف wa_auth وأعد التشغيل.');
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';
      if (text) messageHandlers.forEach((fn) => fn({ from, text, msg }));
    }
  });
}

async function sendMessage(jid, text) {
  if (!sock || status !== 'connected') throw new Error('واتساب غير متصل');
  await sock.sendMessage(jid, { text });
}

function onMessage(fn) {
  messageHandlers.push(fn);
}

function getStatus() { return status; }
function getQR() { return qrString; }

module.exports = { startWhatsApp, sendMessage, onMessage, getStatus, getQR };
