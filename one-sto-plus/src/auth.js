'use strict';
// ログインとセッション。商社の社員（staff）とお客様（customer）でクッキーを分ける。
const { get, run } = require('./db');
const { token, verifyPassword, httpError, now } = require('./util');

const COOKIE = { staff: 'osp_staff', customer: 'osp_portal' };
const SESSION_DAYS = 14;

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' || (process.env.BASE_URL || '').startsWith('https://');
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

function createSession(res, kind, subjectId) {
  const t = token(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 86400e3);
  run('INSERT INTO sessions (token, kind, subject_id, expires_at) VALUES (?,?,?,?)', t, kind, subjectId, exp.toISOString());
  setCookie(res, COOKIE[kind], t, SESSION_DAYS * 86400);
}
function destroySession(req, res, kind) {
  const t = parseCookies(req)[COOKIE[kind]];
  if (t) run('DELETE FROM sessions WHERE token=?', t);
  setCookie(res, COOKIE[kind], '', 0);
}
function sessionSubject(req, kind) {
  const t = parseCookies(req)[COOKIE[kind]];
  if (!t) return null;
  const s = get('SELECT * FROM sessions WHERE token=? AND kind=?', t, kind);
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) { run('DELETE FROM sessions WHERE token=?', t); return null; }
  return s.subject_id;
}

function loadStaff(id) {
  return get(`SELECT u.id, u.login, u.name, u.role, u.view_scope, u.branch_id, u.department_id, u.email,
      b.name AS branch_name, d.name AS department_name
    FROM users u LEFT JOIN branches b ON b.id=u.branch_id LEFT JOIN departments d ON d.id=u.department_id
    WHERE u.id=? AND u.active=1`, id);
}
function loadCustomerUser(id) {
  return get(`SELECT cu.id, cu.name, cu.login, cu.customer_id, c.name AS customer_name
    FROM customer_users cu JOIN customers c ON c.id=cu.customer_id WHERE cu.id=? AND cu.active=1 AND c.active=1`, id);
}

// API は JSON のみ受け付ける（フォーム送信による CSRF を防ぐ）
function requireJsonForWrites(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/json') && !ct.startsWith('multipart/form-data') && req.headers['x-requested-with'] !== 'fetch') {
      return next(httpError(415, 'JSON で送信してください'));
    }
    if (ct.startsWith('multipart/form-data') && req.headers['x-requested-with'] !== 'fetch') {
      return next(httpError(403, '不正なリクエストです'));
    }
  }
  next();
}

function staffAuth(req, res, next) {
  const id = sessionSubject(req, 'staff');
  const u = id && loadStaff(id);
  if (!u) return next(httpError(401, 'ログインしてください'));
  req.user = u;
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return next(httpError(403, '管理者のみ操作できます'));
  next();
}
function customerAuth(req, res, next) {
  const id = sessionSubject(req, 'customer');
  const u = id && loadCustomerUser(id);
  if (!u) return next(httpError(401, 'ログインしてください'));
  req.cuser = u;
  next();
}

// 簡易ログイン試行制限（同一ログインIDで10分に10回まで）
const attempts = new Map();
function checkLoginRate(key) {
  const t = Date.now();
  const list = (attempts.get(key) || []).filter((x) => t - x < 600e3);
  if (list.length >= 10) throw httpError(429, 'ログイン試行が多すぎます。しばらくしてからお試しください');
  list.push(t); attempts.set(key, list);
}
function loginStaff(login, password) {
  checkLoginRate('s:' + login);
  const u = get('SELECT * FROM users WHERE login=? AND active=1', String(login || '').trim());
  if (!u || !verifyPassword(password, u.pw_hash)) throw httpError(401, 'ログインIDまたはパスワードが違います');
  return u.id;
}
function loginCustomer(login, password) {
  checkLoginRate('c:' + login);
  const u = get('SELECT * FROM customer_users WHERE login=? AND active=1', String(login || '').trim());
  if (!u || !verifyPassword(password, u.pw_hash)) throw httpError(401, 'ログインIDまたはパスワードが違います');
  return u.id;
}

// 表示範囲: all（全社）/ branch（自営業所）/ self（自分の担当）。一般社員は全社を見られない設定も可能
function scopeFilter(user, scope, alias, staffCol = 'staff_id', branchCol = 'branch_id') {
  const s = scope || user.view_scope || 'self';
  if (s === 'self') return { sql: ` AND ${alias}.${staffCol} = ${Number(user.id)}`, scope: 'self' };
  if (s === 'branch' && user.branch_id) return { sql: ` AND ${alias}.${branchCol} = ${Number(user.branch_id)}`, scope: 'branch' };
  return { sql: '', scope: 'all' };
}

setInterval(() => { try { run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString()); } catch (_) { /* noop */ } }, 3600e3).unref();

module.exports = {
  createSession, destroySession, staffAuth, adminOnly, customerAuth, requireJsonForWrites,
  loginStaff, loginCustomer, loadStaff, loadCustomerUser, scopeFilter, now,
};
