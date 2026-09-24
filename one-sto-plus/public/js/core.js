/* One-Sto Plus — 共通部品（API・画面遷移・モーダル・書式） */
'use strict';
const App = window.App = { pages: {}, me: null, lk: null, cur: null };

// ---------- 書式 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Math.round(Number(v)).toLocaleString('ja-JP'));
const yen = (v) => (v == null || v === '' ? '—' : `¥${n0(v)}`);
const qtyf = (v) => (v == null ? '' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
const pct = (v, d = 1) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(d)}%`);
const rate = (v) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 10000) / 100));
const pad2 = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
const jd = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${y}/${Number(m)}/${Number(d)}`; };
const md = (s) => { if (!s) return ''; const [, m, d] = String(s).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}`; };
const dt = (s) => (s ? `${jd(s)} ${String(s).slice(11, 16)}` : '');
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,，円¥\s]/g, '')); return Number.isFinite(n) ? n : null; };
const floor0 = (v) => Math.floor((Number(v) || 0) + 1e-9);
const closingLabel = (d) => (Number(d) >= 31 ? '末日締め' : `${d}日締め`);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const LABELS = {
  quote: { draft: ['下書き', ''], negotiating: ['商談中', 'navy'], won: ['受注確定', 'green'], lost: ['失注', 'red'] },
  order: { open: ['進行中', 'navy'], completed: ['完了', 'green'], cancelled: ['取消', 'red'] },
  item: { open: ['未手配', 'org'], ordered: ['発注済', 'navy'], answered: ['回答済', 'teal'], shipped: ['出荷済', 'navy'], delivered: ['納品済', 'green'], cancelled: ['取消', 'red'] },
  po: { draft: ['下書き', 'org'], sent: ['回答待ち', 'navy'], answered: ['回答済', 'teal'], ship_requested: ['出荷指示済', 'navy'], shipped: ['出荷済', 'green'], received: ['入荷済', 'green'], cancelled: ['取消', 'red'] },
  invoice: { issued: ['発行済', ''], sent: ['送付済', 'navy'], partial: ['一部入金', 'org'], paid: ['入金済', 'green'] },
  source: { manual: ['社内入力', ''], quote: ['見積から', 'navy'], portal: ['ポータル', 'teal'], qr: ['現場QR', 'org'] },
  method: { transfer: '振込', cash: '現金', bill: '手形', densai: 'でんさい', offset: '相殺', other: 'その他' },
  role: { admin: '管理者', manager: '所長・責任者', general: '一般' },
  scope: { all: '全社', branch: '自営業所', self: '自分の担当' },
  budget: { draft: ['入力中', ''], submitted: ['提出済', 'navy'], approved: ['確定', 'green'] },
};
const badge = (kind, v) => { const x = LABELS[kind]?.[v]; return x ? `<span class="badge ${x[1]}">${esc(x[0])}</span>` : `<span class="badge">${esc(v ?? '')}</span>`; };

// ---------- アイコン ----------
const ICON_PATHS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', doc: 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h8M9 17h6',
  ai: 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  cart: 'M3 4h2l2.5 11h11L21 7H6.2M9 20a1 1 0 1 0 0-.1M18 20a1 1 0 1 0 0-.1', truck: 'M2 6h12v10H2zM14 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1',
  cal: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4', yen: 'M6 4l6 8 6-8M12 12v9M7 13h10M7 17h10', bill: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7l12-4v4M16 14h2', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8', factory: 'M3 21V10l6 4V10l6 4V6h6v15z', percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  book: 'M4 4h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h7z', mail: 'M3 5h18v14H3zM3 5l9 8 9-8',
  draft: 'M4 20h4l11-11-4-4L4 16zM13 7l4 4', alert: 'M12 3l10 18H2zM12 10v5M12 18v.1', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4', menu: 'M3 6h18M3 12h18M3 18h18', out: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3', x: 'M6 6l12 12M18 6L6 18',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z', dl: 'M12 3v12M7 10l5 5 5-5M4 21h16', send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3',
};
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[name] || ''}"/></svg>`;
const LOGO_SVG = (size = 34) => `<svg width="${size}" height="${Math.round(size * 0.82)}" viewBox="0 0 44 36" aria-hidden="true"><circle cx="13" cy="21" r="10" fill="none" stroke="#25418f" stroke-width="5"/><circle cx="25" cy="21" r="10" fill="none" stroke="#2bb3a3" stroke-width="5"/><circle cx="36" cy="8" r="6.5" fill="#f59e0b"/><path d="M36 4.5v7M32.5 8h7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const logo = (href = '#/') => `<a class="logo" href="${href}">${LOGO_SVG()}<span><span class="t">One-Sto <b>Plus</b></span><span class="k">ワンスト プラス</span></span></a>`;

// ---------- API ----------
async function api(path, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: { 'X-Requested-With': 'fetch' } };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path.startsWith('/') ? path : `/api/${path}`, opt);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && !path.includes('login')) { App.me = null; location.hash = '#/login'; throw new Error('ログインしてください'); }
  if (!res.ok) throw new Error((data && data.error) || `エラー（${res.status}）`);
  return data;
}
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
async function loadLookups(force) { if (!App.lk || force) App.lk = await api('lookups'); return App.lk; }
const nameOf = (list, id) => (App.lk?.[list] || []).find((x) => x.id === Number(id))?.name || '';
const opts = (list, sel, { blank = '選択してください', label = (x) => x.name, value = (x) => x.id } = {}) =>
  `${blank !== false ? `<option value="">${esc(blank)}</option>` : ''}${list.map((x) => `<option value="${esc(value(x))}" ${String(value(x)) === String(sel ?? '') ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}`;

// ---------- トースト・モーダル ----------
function toast(msg, type = 'ok') {
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}
function modal({ title, body, size = '', actions = [], onOpen }) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="mh"><h3>${esc(title)}</h3><button class="btn ghost sm x" data-x aria-label="閉じる">${icon('x')}</button></div>
    <div class="mb">${body}</div>${actions.length ? `<div class="mf">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  const m = { el: $('.modal', bg), close };
  $$('[data-a]', bg).forEach((b) => { b.onclick = async () => {
    const a = actions[Number(b.dataset.a)];
    if (!a.onClick) return close();
    b.disabled = true;
    try { const r = await a.onClick(m); if (r !== false) close(); } catch (e) { toast(e.message, 'err'); } finally { b.disabled = false; }
  }; });
  if (onOpen) onOpen(m);
  const f = $('input:not([type=hidden]), select, textarea', m.el); if (f) setTimeout(() => f.focus(), 30);
  return m;
}
function confirmBox(message, { ok = 'OK', danger = false, title = '確認' } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<p style="margin:0;white-space:pre-wrap">${esc(message)}</p>`, actions: [
      { label: 'キャンセル', onClick: () => { resolve(false); } }, { label: ok, cls: danger ? 'danger' : 'pri', onClick: () => { resolve(true); } }] });
    const x = $('[data-x]', m.el.parentElement); const orig = x.onclick; x.onclick = () => { resolve(false); orig(); };
  });
}
function promptBox(title, { label = '', value = '', type = 'text', ok = 'OK', textarea = false } = {}) {
  return new Promise((resolve) => {
    modal({ title, body: `<label class="f"><span>${esc(label)}</span>${textarea ? `<textarea id="pb-v">${esc(value)}</textarea>` : `<input id="pb-v" type="${type}" value="${esc(value)}">`}</label>`,
      actions: [{ label: 'キャンセル', onClick: () => resolve(null) }, { label: ok, cls: 'pri', onClick: (m) => resolve($('#pb-v', m.el).value) }] });
  });
}
// ボタン処理の共通ラッパー（二重押し防止・エラー表示）
async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, 'err'); } finally { if (btn) btn.disabled = false; }
}
// フォームの値を取り出す
function formData(root) {
  const o = {};
  $$('[name]', root).forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked ? 1 : 0;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  });
  return o;
}
const field = (label, input, { full = false, req = false } = {}) => `<label class="f ${full ? 'full' : ''}"><span>${esc(label)}${req ? '<em>*</em>' : ''}</span>${input}</label>`;
const inp = (name, v = '', { type = 'text', ph = '', attrs = '' } = {}) => `<input type="${type}" name="${name}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" ${attrs}>`;
const sel = (name, html, attrs = '') => `<select name="${name}" ${attrs}>${html}</select>`;
const ta = (name, v = '', attrs = '') => `<textarea name="${name}" ${attrs}>${esc(v ?? '')}</textarea>`;

// 表示範囲の選択（自分・営業所・全社）
const scopeKey = 'osp.scope';
function getScope() { try { return localStorage.getItem(scopeKey) || App.me?.user.view_scope || 'self'; } catch (_) { return App.me?.user.view_scope || 'self'; } }
function setScope(s) { try { localStorage.setItem(scopeKey, s); } catch (_) { /* noop */ } }
function scopeSeg(onChange) {
  const s = getScope();
  const html = `<div class="seg" data-scope>${['self', 'branch', 'all'].map((k) => `<button data-v="${k}" class="${s === k ? 'on' : ''}">${LABELS.scope[k]}</button>`).join('')}</div>`;
  setTimeout(() => $$('[data-scope] button').forEach((b) => { b.onclick = () => { setScope(b.dataset.v); onChange(); }; }), 0);
  return html;
}

// ---------- 商品検索（品番の入力補完） ----------
function attachProductSearch(input, onPick, { url = '/api/products/search?q=' } = {}) {
  let box = null, timer = null, items = [], idx = -1;
  const close = () => { if (box) { box.remove(); box = null; } idx = -1; };
  const show = () => {
    close();
    if (!items.length) return;
    box = document.createElement('div'); box.className = 'ac';
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left + window.scrollX}px`; box.style.top = `${r.bottom + window.scrollY + 2}px`;
    box.innerHTML = items.map((p, i) => `<div data-i="${i}"><b>${esc(p.code)}</b> <span class="muted">${esc(p.maker || '')}</span><br>${esc(p.name || '')} ${p.list_price != null ? `<span class="muted">定価 ${n0(p.list_price)}</span>` : ''}${p.stock_qty ? ` <span class="badge teal">在庫 ${qtyf(p.stock_qty)}</span>` : ''}</div>`).join('');
    document.body.appendChild(box);
    $$('div[data-i]', box).forEach((d) => { d.onmousedown = (e) => { e.preventDefault(); onPick(items[Number(d.dataset.i)]); close(); }; });
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => { try { items = await api(url + encodeURIComponent(q)); if (document.activeElement === input) show(); } catch (_) { /* noop */ } }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (!box) return;
    const ds = $$('div[data-i]', box);
    if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, ds.length - 1); } else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); onPick(items[idx]); close(); return; } else if (e.key === 'Escape') { close(); return; } else return;
    e.preventDefault(); ds.forEach((d, i) => d.classList.toggle('on', i === idx));
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

// ---------- 画面遷移 ----------
const ROUTES = [];
function route(pattern, handler, opts = {}) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  ROUTES.push({ re, keys, handler, ...opts });
}
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [p, q] = h.split('?');
  return { path: p, query: Object.fromEntries(new URLSearchParams(q || '')) };
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
async function render() {
  const { path, query } = parseHash();
  if (path === '/login') return App.pages.login();
  if (!App.me) {
    try { App.me = await api('me'); await loadLookups(); } catch (_) { return; }
  }
  layout();
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    App.cur = { path, params, query, nav: r.nav };
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === r.nav));
    const el = $('#content');
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    $('.side')?.classList.remove('open');
    window.scrollTo(0, 0);
    try { await r.handler(el, params, query); } catch (e) { el.innerHTML = `<div class="card"><div class="cb"><p class="neg">${esc(e.message)}</p></div></div>`; }
    return;
  }
  $('#content').innerHTML = '<div class="empty">ページが見つかりません</div>';
}
window.addEventListener('hashchange', render);

const NAV = [
  ['', [['home', '#/', 'ダッシュボード', 'home']]],
  ['見積', [['quotes', '#/quotes', '見積一覧', 'doc'], ['ai', '#/quotes/new?ai=1', 'AI読み取りで見積', 'ai'], ['analysis', '#/analysis', '見積分析', 'chart']]],
  ['受発注', [['orders', '#/orders', '受注', 'inbox'], ['purchases', '#/purchases', '発注', 'cart'], ['shipments', '#/shipments', '出荷指示', 'truck'], ['calendar', '#/calendar', '納期カレンダー', 'cal']]],
  ['売上・請求', [['sales', '#/sales', '売上', 'yen'], ['invoices', '#/invoices', '請求', 'bill'], ['payments', '#/payments', '入金・消込', 'wallet']]],
  ['管理', [['budget', '#/budget', '予算管理', 'target'], ['customers', '#/m/customers', '得意先・現場', 'users'], ['suppliers', '#/m/suppliers', '仕入先', 'factory'], ['products', '#/m/products', '商品マスター', 'box'], ['rates', '#/m/rate_rules', '掛率', 'percent'], ['projects', '#/m/projects', '案件', 'doc'], ['settings', '#/settings', '設定', 'gear']]],
];
function layout() {
  if ($('.app')) { $('#unread').textContent = App.me.unread || ''; $('#unread').classList.toggle('hidden', !App.me.unread); return; }
  const u = App.me.user;
  document.body.innerHTML = `<div class="app">
    <aside class="side"><div class="brand">${logo()}</div><nav class="nav">${NAV.map(([g, items]) => `${g ? `<div class="grp">${esc(g)}</div>` : ''}${items.map(([k, h, l, ic]) => `<a href="${h}" data-nav="${k}">${icon(ic)}<span>${esc(l)}</span></a>`).join('')}`).join('')}
      <div class="grp">ヘルプ</div><a href="/manual/staff" target="_blank" rel="noopener">${icon('book')}<span>操作マニュアル</span></a><a href="/manual/customer" target="_blank" rel="noopener">${icon('book')}<span>お客様向けマニュアル</span></a></nav></aside>
    <div class="main"><header class="top"><button class="btn ghost sm menu-btn" id="menu">${icon('menu')}</button>
      <div class="sp"></div>
      <a class="btn ghost sm" href="#/" title="通知">${icon('bell')}<span class="badge num ${App.me.unread ? '' : 'hidden'}" id="unread">${App.me.unread || ''}</span></a>
      <div class="who"><b>${esc(u.name)}</b>${esc(u.branch_name || '')} ・ ${esc(LABELS.role[u.role])}</div>
      <button class="btn ghost sm" id="logout" title="ログアウト">${icon('out')}</button></header>
      <main class="content" id="content"></main></div></div>`;
  $('#menu').onclick = () => $('.side').classList.toggle('open');
  $('#logout').onclick = async () => { await api('logout', { method: 'POST', body: {} }); App.me = null; location.hash = '#/login'; };
}

// ---------- 共通の表 ----------
function table(cols, rows, { onRow, empty = 'データがありません', foot } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th class="${c.r ? 'r' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${onRow ? 'click' : ''} ${r._cls || ''}" data-i="${i}">${cols.map((c) => `<td class="${c.r ? 'r' : ''} ${c.cls || ''}">${c.v(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}</table></div>`;
}
function bindRows(el, rows, onRow) { $$('tbody tr[data-i]', el).forEach((tr) => { tr.onclick = (e) => { if (e.target.closest('a,button,input,select,label')) return; onRow(rows[Number(tr.dataset.i)], e); }; }); }
function setQuery(q) { const { path } = parseHash(); const s = qs(q); history.replaceState(null, '', `#${path}${s}`); }

// ---------- 起動 ----------
document.addEventListener('DOMContentLoaded', () => { render(); });
