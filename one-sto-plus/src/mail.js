'use strict';
// メール送信。SMTP_HOST が設定されていれば実際に送信し、なければ「送信記録」にだけ残す（画面で確認可能）。
const nodemailer = require('nodemailer');
const { insert, getSettings } = require('./db');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

function baseUrl() { return (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''); }

async function sendMail({ to, subject, body, related }) {
  const s = getSettings();
  const from = process.env.MAIL_FROM || s.mail_from || 'no-reply@example.com';
  const footer = `\n\n──────────\n${s.company_name}\n${[s.company_address, s.company_tel && `TEL ${s.company_tel}`, s.company_fax && `FAX ${s.company_fax}`].filter(Boolean).join('　')}\n※ このメールは One-Sto Plus から送信しています。`;
  const text = body + footer;
  const rec = { to_addr: to || '', subject, body: text, related: related || '', status: 'logged', error: null };
  if (!to) { rec.status = 'failed'; rec.error = '宛先メールアドレスが未登録です'; insert('mails', rec); return rec; }
  if (transport) {
    try {
      await transport.sendMail({ from: `${s.company_name} <${from}>`, to, subject, text });
      rec.status = 'sent';
    } catch (e) { rec.status = 'failed'; rec.error = String(e.message || e); }
  }
  insert('mails', rec);
  return rec;
}

module.exports = { sendMail, baseUrl, smtpEnabled: () => !!transport };
