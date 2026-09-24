'use strict';
// マスター（営業所・部署・ユーザー・得意先・現場・仕入先・商品・掛率・案件）
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const { all, get, run, tx, insert, update } = require('../db');
const U = require('../util');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const T = {
  branches: { cols: ['name', 'zip', 'address', 'tel', 'fax', 'sort', 'active'], admin: true, search: ['name'], order: 'sort, id',
    list: 'SELECT t.* FROM branches t WHERE 1=1' },
  departments: { cols: ['branch_id', 'name', 'active'], admin: true, search: ['t.name'], order: 't.branch_id, t.id',
    list: 'SELECT t.*, b.name AS branch_name FROM departments t LEFT JOIN branches b ON b.id=t.branch_id WHERE 1=1' },
  users: { cols: ['login', 'name', 'role', 'view_scope', 'branch_id', 'department_id', 'email', 'tel', 'active'], admin: true, password: true,
    search: ['t.name', 't.login'], order: 't.id',
    list: `SELECT t.id, t.login, t.name, t.role, t.view_scope, t.branch_id, t.department_id, t.email, t.tel, t.active,
      b.name AS branch_name, d.name AS department_name FROM users t LEFT JOIN branches b ON b.id=t.branch_id LEFT JOIN departments d ON d.id=t.department_id WHERE 1=1` },
  customers: { cols: ['code', 'name', 'kana', 'zip', 'address', 'tel', 'fax', 'email', 'closing_day', 'pay_month_offset', 'pay_day', 'staff_id', 'branch_id', 'note', 'active'],
    search: ['t.code', 't.name', 't.kana'], order: 't.code, t.id', filters: ['staff_id', 'branch_id', 'closing_day'],
    list: `SELECT t.*, u.name AS staff_name, b.name AS branch_name FROM customers t LEFT JOIN users u ON u.id=t.staff_id LEFT JOIN branches b ON b.id=t.branch_id WHERE 1=1` },
  customer_users: { cols: ['customer_id', 'name', 'login', 'tel', 'active'], password: true, search: ['t.name', 't.login'], order: 't.id', filters: ['customer_id'],
    list: `SELECT t.id, t.customer_id, t.name, t.login, t.tel, t.active, c.name AS customer_name FROM customer_users t JOIN customers c ON c.id=t.customer_id WHERE 1=1` },
  sites: { cols: ['customer_id', 'name', 'kind', 'zip', 'address', 'receiver', 'tel', 'active'], search: ['t.name', 't.address'], order: 't.customer_id, t.id', filters: ['customer_id'],
    list: `SELECT t.*, c.name AS customer_name FROM sites t JOIN customers c ON c.id=t.customer_id WHERE 1=1` },
  suppliers: { cols: ['code', 'name', 'zip', 'address', 'tel', 'fax', 'email', 'contact', 'note', 'active'], search: ['t.code', 't.name'], order: 't.code, t.id',
    list: 'SELECT t.* FROM suppliers t WHERE 1=1' },
  products: { cols: ['maker', 'code', 'name', 'spec', 'unit', 'list_price', 'discount_code', 'cost_rate', 'supplier_id', 'stock_qty', 'active'],
    search: ['t.code', 't.name', 't.maker'], order: 't.maker, t.code', filters: ['maker', 'supplier_id'],
    list: `SELECT t.*, s.name AS supplier_name FROM products t LEFT JOIN suppliers s ON s.id=t.supplier_id WHERE 1=1` },
  rate_rules: { cols: ['customer_id', 'maker', 'discount_code', 'sell_rate', 'cost_rate', 'note'], search: ['t.maker', 't.discount_code'], order: 't.customer_id IS NOT NULL, t.customer_id, t.maker', filters: ['customer_id'], hardDelete: true,
    list: `SELECT t.*, c.name AS customer_name FROM rate_rules t LEFT JOIN customers c ON c.id=t.customer_id WHERE 1=1` },
  projects: { cols: ['code', 'name', 'customer_id', 'site_id', 'staff_id', 'note', 'active'], search: ['t.code', 't.name'], order: 't.id DESC', filters: ['customer_id', 'staff_id'],
    list: `SELECT t.*, c.name AS customer_name, s.name AS site_name, u.name AS staff_name FROM projects t LEFT JOIN customers c ON c.id=t.customer_id
      LEFT JOIN sites s ON s.id=t.site_id LEFT JOIN users u ON u.id=t.staff_id WHERE 1=1` },
};
const NUMERIC = new Set(['sort', 'active', 'branch_id', 'department_id', 'closing_day', 'pay_month_offset', 'pay_day', 'staff_id', 'customer_id', 'site_id', 'supplier_id', 'list_price', 'cost_rate', 'sell_rate', 'stock_qty']);

function clean(def, body) {
  const o = {};
  for (const c of def.cols) {
    if (!(c in body)) continue;
    let v = body[c];
    if (NUMERIC.has(c)) v = v === '' || v == null ? null : U.toNum(v, null);
    else v = v == null ? null : String(v).trim();
    o[c] = v;
  }
  return o;
}
function tableDef(req) {
  const def = T[req.params.table];
  if (!def) throw U.httpError(404, '不明なマスターです');
  if (def.admin && req.method !== 'GET' && req.user.role !== 'admin') throw U.httpError(403, '管理者のみ編集できます');
  if (req.params.table === 'users' && req.method === 'GET' && req.user.role !== 'admin' && req.params.id) throw U.httpError(403, '管理者のみ参照できます');
  return def;
}

r.get('/m/:table', (req, res) => {
  const def = tableDef(req);
  let sql = def.list; const p = [];
  if (req.query.active !== 'all' && def.cols.includes('active')) sql += ' AND t.active=1';
  if (req.query.q && def.search) {
    sql += ` AND (${def.search.map((c) => `${c} LIKE ?`).join(' OR ')})`;
    for (const _ of def.search) p.push(`%${req.query.q}%`);
  }
  for (const f of def.filters || []) if (req.query[f] !== undefined && req.query[f] !== '') { sql += ` AND t.${f}=?`; p.push(req.query[f]); }
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const offset = Number(req.query.offset) || 0;
  const total = get(`SELECT COUNT(*) AS n FROM (${sql})`, ...p).n;
  const rows = all(`${sql} ORDER BY ${def.order} LIMIT ${limit} OFFSET ${offset}`, ...p);
  res.json({ rows, total });
});
r.get('/m/:table/:id', (req, res) => {
  const def = tableDef(req);
  const row = get(`${def.list} AND t.id=?`, req.params.id);
  if (!row) throw U.httpError(404, '見つかりません');
  res.json(row);
});
r.post('/m/:table', (req, res) => {
  const def = tableDef(req);
  const o = clean(def, req.body);
  if (def.cols.includes('name') && !o.name) throw U.httpError(400, '名称を入れてください');
  if (def.password) {
    if (!o.login) throw U.httpError(400, 'ログインIDを入れてください');
    if (!req.body.password || String(req.body.password).length < 8) throw U.httpError(400, 'パスワードは8文字以上にしてください');
    if (get(`SELECT 1 FROM ${req.params.table} WHERE login=?`, o.login)) throw U.httpError(400, 'このログインIDはすでに使われています');
    o.pw_hash = U.hashPassword(req.body.password);
  }
  if (req.params.table === 'sites') o.qr_token = U.token(12);
  if (req.params.table === 'products' && !o.code) throw U.httpError(400, '品番を入れてください');
  const id = insert(req.params.table, o);
  res.json({ id });
});
r.put('/m/:table/:id', (req, res) => {
  const def = tableDef(req);
  const o = clean(def, req.body);
  if (def.password && req.body.password) {
    if (String(req.body.password).length < 8) throw U.httpError(400, 'パスワードは8文字以上にしてください');
    o.pw_hash = U.hashPassword(req.body.password);
  }
  if (def.password && o.login && get(`SELECT 1 FROM ${req.params.table} WHERE login=? AND id<>?`, o.login, req.params.id)) throw U.httpError(400, 'このログインIDはすでに使われています');
  if (req.params.table === 'users' && Number(req.params.id) === req.user.id && (o.active === 0 || (o.role && o.role !== 'admin'))) throw U.httpError(400, '自分自身の管理者権限は外せません');
  update(req.params.table, req.params.id, o);
  res.json({ ok: true });
});
r.delete('/m/:table/:id', (req, res) => {
  const def = tableDef(req);
  if (def.hardDelete) run(`DELETE FROM ${req.params.table} WHERE id=?`, req.params.id);
  else {
    if (req.params.table === 'users' && Number(req.params.id) === req.user.id) throw U.httpError(400, '自分自身は停止できません');
    run(`UPDATE ${req.params.table} SET active=0 WHERE id=?`, req.params.id);
    if (req.params.table === 'users') run("DELETE FROM sessions WHERE kind='staff' AND subject_id=?", req.params.id);
  }
  res.json({ ok: true });
});

// 現場QRの再発行
r.post('/sites/:id/qr-reset', (req, res) => {
  update('sites', req.params.id, { qr_token: U.token(12) });
  res.json({ ok: true });
});

// 商品検索（見積・受注の明細入力用）
r.get('/products/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = all(`SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.active=1 AND (p.code LIKE ? OR p.name LIKE ? OR p.maker LIKE ?) ORDER BY (p.code = ?) DESC, (p.code LIKE ?) DESC, p.code LIMIT 30`,
  `%${q}%`, `%${q}%`, `${q}%`, q, `${q}%`);
  res.json(rows);
});

// 掛率の自動判定: 得意先×メーカー×値引きコード → 得意先×メーカー → 共通×メーカー×値引きコード → 共通×メーカー
function lookupRate(customerId, maker, discountCode) {
  const cands = [
    [customerId, maker, discountCode], [customerId, maker, null], [null, maker, discountCode], [null, maker, null],
  ];
  for (const [c, m, d] of cands) {
    if (!m) continue;
    const row = get(`SELECT * FROM rate_rules WHERE ${c == null ? 'customer_id IS NULL' : 'customer_id=?'} AND maker=? AND ${d == null ? "(discount_code IS NULL OR discount_code='')" : 'discount_code=?'} LIMIT 1`,
      ...[c, m, d].filter((x) => x != null));
    if (row) return row;
  }
  return null;
}
r.get('/rates/lookup', (req, res) => {
  const { customer_id: cid, maker, code } = req.query;
  const p = code ? get('SELECT * FROM products WHERE code=? AND active=1 ORDER BY (maker=?) DESC LIMIT 1', code, maker || '') : null;
  const rule = lookupRate(cid ? Number(cid) : null, maker || p?.maker, req.query.discount_code || p?.discount_code || null);
  res.json({ sell_rate: rule?.sell_rate ?? null, cost_rate: rule?.cost_rate ?? p?.cost_rate ?? null, product: p || null });
});
r.post('/rates/lookup-bulk', (req, res) => {
  const cid = req.body.customer_id ? Number(req.body.customer_id) : null;
  res.json((req.body.items || []).map((it) => {
    const p = it.code ? get('SELECT * FROM products WHERE code=? AND active=1 ORDER BY (maker=?) DESC LIMIT 1', it.code, it.maker || '') : null;
    const rule = lookupRate(cid, it.maker || p?.maker, p?.discount_code || null);
    return { sell_rate: rule?.sell_rate ?? null, cost_rate: rule?.cost_rate ?? p?.cost_rate ?? null, product: p ? { id: p.id, list_price: p.list_price, supplier_id: p.supplier_id, name: p.name, unit: p.unit, maker: p.maker } : null };
  }));
});

// 商品マスターの取り込み（CSV / Excel）。見出し行の名前で列を判定
const HEAD = {
  maker: ['メーカー', 'メーカー名', 'maker'], code: ['品番', '型番', '商品コード', 'code'], name: ['品名', '商品名', 'name'],
  spec: ['仕様', '規格', '色', 'spec'], unit: ['単位', 'unit'], list_price: ['定価', '希望小売価格', '上代', 'list_price'],
  discount_code: ['値引きコード', '値引コード', '掛率コード', 'discount_code'], cost_rate: ['仕入掛率', '仕入率', 'cost_rate'],
  supplier: ['仕入先', '仕入先名', 'supplier'], supplier_code: ['仕入先コード', 'supplier_code'], stock_qty: ['在庫', '在庫数', 'stock_qty'],
};
r.post('/products/import', upload.single('file'), (req, res) => {
  if (!req.file) throw U.httpError(400, 'ファイルを選んでください');
  const name = (req.file.originalname || '').toLowerCase();
  let rows;
  if (/\.(xlsx|xls|xlsm)$/.test(name)) {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  } else {
    let text = req.file.buffer.toString('utf8');
    if (text.includes('�')) text = iconv.decode(req.file.buffer, 'Shift_JIS');
    rows = U.parseCsv(text);
  }
  if (rows.length < 2) throw U.httpError(400, 'データがありません');
  const header = rows[0].map((h) => String(h).trim());
  const idx = {};
  for (const [k, names] of Object.entries(HEAD)) idx[k] = header.findIndex((h) => names.includes(h));
  if (idx.code < 0) throw U.httpError(400, '「品番」の列が見つかりません');
  const suppliers = all('SELECT id, name, code FROM suppliers');
  let created = 0, updated = 0;
  tx(() => {
    for (const row of rows.slice(1)) {
      const v = (k) => (idx[k] >= 0 ? String(row[idx[k]] ?? '').trim() : undefined);
      const code = v('code');
      if (!code) continue;
      const o = {};
      for (const k of ['maker', 'name', 'spec', 'unit', 'discount_code']) if (v(k) !== undefined) o[k] = v(k) || null;
      if (v('list_price') !== undefined) o.list_price = U.toNum(v('list_price'));
      if (v('cost_rate') !== undefined && v('cost_rate') !== '') { let cr = U.toNum(v('cost_rate')); if (cr > 1.5) cr /= 100; o.cost_rate = cr; }
      if (v('stock_qty') !== undefined && v('stock_qty') !== '') o.stock_qty = U.toNum(v('stock_qty'));
      const sup = (v('supplier_code') && suppliers.find((s) => s.code === v('supplier_code'))) || (v('supplier') && suppliers.find((s) => s.name === v('supplier')));
      if (sup) o.supplier_id = sup.id;
      const ex = get('SELECT id FROM products WHERE code=? AND COALESCE(maker,\'\')=COALESCE(?,\'\')', code, o.maker ?? null);
      if (ex) { update('products', ex.id, { ...o, active: 1 }); updated++; } else { insert('products', { code, ...o }); created++; }
    }
  })();
  res.json({ created, updated });
});

r.get('/products/export', (req, res) => {
  const rows = all('SELECT p.*, s.code AS supplier_code, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 ORDER BY p.maker, p.code');
  const csv = U.toCsv([['メーカー', '品番', '品名', '仕様', '単位', '定価', '値引きコード', '仕入掛率', '仕入先コード', '仕入先', '在庫数'],
    ...rows.map((p) => [p.maker, p.code, p.name, p.spec, p.unit, p.list_price, p.discount_code, p.cost_rate, p.supplier_code, p.supplier_name, p.stock_qty])]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
  res.send('﻿' + csv);
});

module.exports = { router: r, lookupRate };
