'use strict';
// One-Sto Plus サーバー
const path = require('path');
const fs = require('fs');
const express = require('express');
const { db, DATA_DIR, all, get, getSettings, setSettings } = require('./src/db');
const U = require('./src/util');
const A = require('./src/auth');
const { smtpEnabled, baseUrl } = require('./src/mail');
const AI = require('./src/ai');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ---------- 社員向け API ----------
const api = express.Router();
api.use(A.requireJsonForWrites);
api.post('/login', (req, res) => { A.createSession(res, 'staff', A.loginStaff(req.body.login, req.body.password)); res.json({ ok: true }); });
api.post('/logout', (req, res) => { A.destroySession(req, res, 'staff'); res.json({ ok: true }); });
api.use(A.staffAuth);
api.get('/me', (req, res) => {
  const s = getSettings();
  res.json({ user: req.user, company_name: s.company_name, ai_enabled: AI.aiEnabled(), smtp_enabled: smtpEnabled(), base_url: baseUrl(),
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE (user_id=? OR user_id IS NULL) AND is_read=0', req.user.id).n });
});
api.post('/me/password', (req, res) => {
  const u = get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!U.verifyPassword(req.body.current, u.pw_hash)) throw U.httpError(400, '現在のパスワードが違います');
  if (!req.body.password || String(req.body.password).length < 8) throw U.httpError(400, '新しいパスワードは8文字以上にしてください');
  db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(U.hashPassword(req.body.password), u.id);
  res.json({ ok: true });
});
api.get('/settings', (req, res) => res.json(getSettings()));
api.put('/settings', A.adminOnly, (req, res) => { setSettings(req.body || {}); res.json({ ok: true }); });
api.get('/mails', (req, res) => res.json(all('SELECT * FROM mails ORDER BY id DESC LIMIT 200')));
api.get('/lookups', (req, res) => {
  res.json({
    branches: all('SELECT id, name FROM branches WHERE active=1 ORDER BY sort, id'),
    departments: all('SELECT id, name, branch_id FROM departments WHERE active=1 ORDER BY id'),
    users: all('SELECT id, name, branch_id, department_id FROM users WHERE active=1 ORDER BY id'),
    suppliers: all('SELECT id, name, email FROM suppliers WHERE active=1 ORDER BY code, id'),
    customers: all('SELECT id, code, name, staff_id, closing_day FROM customers WHERE active=1 ORDER BY code, id'),
    makers: all("SELECT DISTINCT maker FROM products WHERE maker IS NOT NULL AND maker<>'' ORDER BY maker").map((r) => r.maker),
  });
});
api.use(require('./src/routes/masters').router);
api.use(require('./src/routes/quotes'));
api.use(require('./src/routes/orders'));
api.use(require('./src/routes/billing'));
api.use(require('./src/routes/budget'));
app.use('/api', api);

// ---------- 社外向け API ----------
const ext = require('./src/routes/external');
const extGuard = express.Router(); extGuard.use(A.requireJsonForWrites);
app.use('/papi', extGuard, ext.portal);
app.use('/qapi', extGuard, ext.qr);
app.use('/sapi', extGuard, ext.sup);

// ---------- 帳票 ----------
app.use('/doc', require('./src/routes/docs'));

// ---------- 画面 ----------
const PUB = path.join(__dirname, 'public');
app.use(express.static(PUB, { index: false, maxAge: '1h' }));
const sendHtml = (file) => (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(PUB, file)); };
app.get('/', sendHtml('index.html'));
app.get('/portal', (req, res) => (req.originalUrl.split('?')[0].endsWith('/') ? sendHtml('portal/index.html')(req, res) : res.redirect('/portal/')));
app.get('/q/:token', sendHtml('portal/qr.html'));
app.get('/r/:token', sendHtml('portal/answer.html'));
app.get('/manual/:name', (req, res, next) => {
  if (!['staff', 'customer'].includes(req.params.name)) return next();
  sendHtml(`manual/${req.params.name}.html`)(req, res);
});
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 36"><circle cx="13" cy="21" r="10" fill="none" stroke="#25418f" stroke-width="5"/><circle cx="25" cy="21" r="10" fill="none" stroke="#2bb3a3" stroke-width="5"/><circle cx="36" cy="8" r="6.5" fill="#f59e0b"/></svg>');
});

// ---------- エラー ----------
app.use((req, res) => {
  if (/^\/(api|papi|qapi|sapi)\//.test(req.path)) return res.status(404).json({ error: '見つかりません' });
  res.status(404).send('<!doctype html><meta charset="utf-8"><title>見つかりません</title><p style="font-family:sans-serif;padding:40px">ページが見つかりません。</p>');
});
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  const msg = status >= 500 && !err.expose && !err.status ? 'サーバーでエラーが発生しました' : err.message;
  if (/^\/(api|papi|qapi|sapi)\//.test(req.path)) return res.status(status).json({ error: msg });
  if (status === 401 && req.path.startsWith('/doc/')) return res.redirect('/#/login');
  res.status(status).send(`<!doctype html><meta charset="utf-8"><title>エラー</title><p style="font-family:sans-serif;padding:40px">${String(msg).replace(/[<>&]/g, '')}</p>`);
});

// ---------- 毎日のバックアップ（直近14日分を保存） ----------
function backup() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `onesto-${U.ymd()}.db`);
  if (fs.existsSync(file)) return;
  db.backup(file).then(() => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(dir, f));
  }).catch((e) => console.error('backup failed', e));
}

// 初回起動時: データが空なら初期データを入れる
if (!get('SELECT 1 FROM users LIMIT 1')) {
  require('./src/seed').seed({ demo: process.env.SEED_DEMO !== '0' });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`One-Sto Plus を起動しました: ${baseUrl()}`);
    console.log(`  AI読み取り: ${AI.aiEnabled() ? '有効' : '無効（ANTHROPIC_API_KEY 未設定）'} ／ メール送信: ${smtpEnabled() ? 'SMTP' : '送信記録のみ（SMTP_HOST 未設定）'}`);
  });
  backup();
  setInterval(backup, 3600e3).unref();
}

module.exports = app;
