'use strict';
const crypto = require('crypto');

// ---- 日付 ----
const pad = (n) => String(n).padStart(2, '0');
function ymd(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); } // m は 1-12
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function now() { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

// 締め日（31=末日）に対する、ある年月の締め日の日付
function closingDateOf(y, m, closingDay) {
  const last = lastDayOfMonth(y, m);
  return ymd(new Date(y, m - 1, Math.min(closingDay >= 31 ? last : closingDay, last)));
}
// 締め日の前回締め日（翌日が期間開始）
function prevClosingDate(closingDate, closingDay) {
  const d = parseYmd(closingDate);
  let y = d.getFullYear(), m = d.getMonth(); // 前月（1-12 に直すと m）
  if (m === 0) { y -= 1; m = 12; }
  return closingDateOf(y, m, closingDay);
}
// 入金予定日（締め日から n か月後の pay_day 日）
function dueDateOf(closingDate, monthOffset, payDay) {
  const d = parseYmd(closingDate);
  let y = d.getFullYear(), m = d.getMonth() + 1 + Number(monthOffset || 0);
  while (m > 12) { m -= 12; y += 1; }
  return closingDateOf(y, m, Number(payDay || 31));
}
function closingLabel(day) { return Number(day) >= 31 ? '末日締め' : `${day}日締め`; }

// 年度（fiscal_start_month 始まり）と、年度内の月インデックス（0-11）
function fiscalYearOf(dateStr, startMonth) {
  const d = parseYmd(dateStr); const m = d.getMonth() + 1;
  return m >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
}
function fiscalMonths(fy, startMonth) {
  const res = [];
  for (let i = 0; i < 12; i++) {
    let m = startMonth + i, y = fy;
    if (m > 12) { m -= 12; y += 1; }
    res.push({ y, m, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` });
  }
  return res;
}

// ---- 金額 ----
const round0 = (n) => Math.round(Number(n) || 0);
const floor0 = (n) => Math.floor((Number(n) || 0) + 1e-9);
// 掛率（0.45 など）から単価。1円未満切り捨て
function priceByRate(listPrice, rate) { return floor0((Number(listPrice) || 0) * (Number(rate) || 0)); }
// 請求書単位の消費税（インボイス: 税率ごとに1回の端数処理＝切り捨て）
function taxOf(amount, ratePct) {
  const a = Number(amount) || 0;
  const t = Math.abs(a) * Number(ratePct) / 100;
  return (a < 0 ? -1 : 1) * Math.floor(t + 1e-9);
}

// ---- 認証 ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}
const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

// ---- その他 ----
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function toNum(v, def = 0) { if (v === '' || v == null) return def; const n = Number(String(v).replace(/[,，円¥\s]/g, '')); return Number.isFinite(n) ? n : def; }
function toNumOrNull(v) { if (v === '' || v == null) return null; const n = toNum(v, NaN); return Number.isFinite(n) ? n : null; }
function pick(obj, keys) { const o = {}; for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) o[k] = obj[k]; return o; }
function csvEscape(v) { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function toCsv(rows) { return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'; }
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

module.exports = {
  ymd, parseYmd, addDays, now, lastDayOfMonth, closingDateOf, prevClosingDate, dueDateOf, closingLabel,
  fiscalYearOf, fiscalMonths, round0, floor0, priceByRate, taxOf,
  hashPassword, verifyPassword, token, httpError, toNum, toNumOrNull, pick, toCsv, parseCsv,
};
