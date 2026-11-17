// Outgoing email (same SMTP_* / MAIL_FROM settings as RecruitFlow).
// Without SMTP_HOST, outside production the message is printed to the console so links can be used locally.
const nodemailer = require('nodemailer');

let transport = null;
function getTransport() {
  if (transport || !process.env.SMTP_HOST) return transport;
  const user = process.env.SMTP_USER;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: user ? { user, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

const isConfigured = () => !!process.env.SMTP_HOST;
const canSend = () => isConfigured() || process.env.NODE_ENV !== 'production';

async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured');
    console.log(`[MAIL] (SMTP not configured; printing instead)\nTo: ${to}\nSubject: ${subject}\n\n${text}\n[MAIL] ----`);
    return;
  }
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

module.exports = { sendMail, canSend, isConfigured };
