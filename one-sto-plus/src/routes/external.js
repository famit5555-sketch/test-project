'use strict';
// 社外の人が触れる API: お客様ポータル（/papi）・現場QR注文（/qapi）・仕入先回答ページ（/sapi）
const express = require('express');
const { all, get, insert, getSettings } = require('../db');
const U = require('../util');
const A = require('../auth');
const S = require('../services');

const ORDER_STATUS_FOR_CUSTOMER = (o, items) => {
  if (o.status === 'cancelled') return '取消';
  if (o.status === 'completed') return '納品済み';
  const live = items.filter((i) => i.status !== 'cancelled');
  if (live.some((i) => i.status === 'shipped')) return '出荷済み';
  if (live.length && live.every((i) => i.eta_date)) return '納期回答済み';
  if (live.some((i) => i.status !== 'open')) return '手配中';
  return '受付済み';
};
const productSearch = (q) => {
  q = String(q || '').trim();
  if (!q) return [];
  return all(`SELECT id, maker, code, name, spec, unit FROM products WHERE active=1 AND (code LIKE ? OR name LIKE ?) ORDER BY (code=?) DESC, code LIMIT 20`, `%${q}%`, `%${q}%`, q);
};
function cleanItems(items) {
  const res = (items || []).filter((it) => (it.code || it.name) && U.toNum(it.qty, 0) > 0).slice(0, 100).map((it) => {
    const p = it.product_id ? get('SELECT * FROM products WHERE id=? AND active=1', it.product_id) : S.productFor(it.maker, it.code);
    return { product_id: p?.id || null, maker: p?.maker || it.maker || null, code: p?.code || String(it.code || '').slice(0, 60), name: p?.name || String(it.name || '').slice(0, 120), spec: p?.spec || null, qty: U.toNum(it.qty, 1), unit: p?.unit || it.unit || '個', list_price: p?.list_price || 0, sell_price: null };
  });
  if (!res.length) throw U.httpError(400, '品番と数量を入れてください');
  return res;
}

// ================= お客様ポータル =================
const portal = express.Router();
portal.post('/login', (req, res) => { A.createSession(res, 'customer', A.loginCustomer(req.body.login, req.body.password)); res.json({ ok: true }); });
portal.post('/logout', (req, res) => { A.destroySession(req, res, 'customer'); res.json({ ok: true }); });
portal.use(A.customerAuth);
portal.get('/me', (req, res) => {
  const c = get(`SELECT c.name, c.code, c.closing_day, u.name AS staff_name, u.email AS staff_email, u.tel AS staff_tel, b.name AS branch_name, b.tel AS branch_tel
    FROM customers c LEFT JOIN users u ON u.id=c.staff_id LEFT JOIN branches b ON b.id=c.branch_id WHERE c.id=?`, req.cuser.customer_id);
  const s = getSettings();
  const unbilled = get('SELECT COALESCE(SUM(subtotal),0) AS a FROM sales WHERE customer_id=? AND invoice_id IS NULL', req.cuser.customer_id).a;
  const openOrders = get("SELECT COUNT(*) AS n FROM orders WHERE customer_id=? AND status='open'", req.cuser.customer_id).n;
  res.json({ user: req.cuser, customer: c, company: { name: s.company_name, tel: s.company_tel }, unbilled, unbilled_with_tax: unbilled + U.taxOf(unbilled, s.tax_rate), closing: U.closingLabel(c.closing_day), open_orders: openOrders });
});
portal.get('/products', (req, res) => res.json(productSearch(req.query.q)));
portal.get('/sites', (req, res) => res.json(all('SELECT id, name, kind, zip, address, receiver, tel FROM sites WHERE customer_id=? AND active=1 ORDER BY kind, name', req.cuser.customer_id)));
portal.post('/sites', (req, res) => {
  if (!req.body.name) throw U.httpError(400, '現場名を入れてください');
  const id = insert('sites', { customer_id: req.cuser.customer_id, name: String(req.body.name).slice(0, 100), kind: req.body.kind === 'warehouse' ? 'warehouse' : 'site', zip: req.body.zip || null, address: req.body.address || null, receiver: req.body.receiver || null, tel: req.body.tel || null, qr_token: U.token(12) });
  res.json({ id });
});
portal.get('/orders', (req, res) => {
  const rows = all(`SELECT o.id, o.no, o.status, o.source, o.created_at, o.desired_date, o.customer_ref, o.price_confirmed, s.name AS site_name,
      (SELECT COUNT(*) FROM order_items x WHERE x.order_id=o.id AND x.status<>'cancelled') AS item_cnt
    FROM orders o LEFT JOIN sites s ON s.id=o.site_id WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 300`, req.cuser.customer_id);
  for (const o of rows) {
    const items = all('SELECT status, eta_date, qty, sell_price FROM order_items WHERE order_id=?', o.id);
    o.display_status = ORDER_STATUS_FOR_CUSTOMER(o, items);
    o.eta = items.filter((i) => i.status !== 'cancelled').map((i) => i.eta_date).filter(Boolean).sort().pop() || null;
    o.amount = o.price_confirmed ? items.filter((i) => i.status !== 'cancelled').reduce((a, i) => a + i.qty * (i.sell_price || 0), 0) : null;
  }
  res.json(rows);
});
portal.get('/orders/:id', (req, res) => {
  const o = S.orderDetail(req.params.id);
  if (!o || o.customer_id !== req.cuser.customer_id) throw U.httpError(404, 'ご注文が見つかりません');
  const items = o.items.map((i) => ({ id: i.id, maker: i.maker, code: i.code, name: i.name, spec: i.spec, qty: i.qty, unit: i.unit, eta_date: i.eta_date, status: i.status, sell_price: o.price_confirmed ? i.sell_price : null }));
  res.json({
    id: o.id, no: o.no, status: o.status, display_status: ORDER_STATUS_FOR_CUSTOMER(o, o.items), created_at: o.created_at, site_name: o.site_name, orderer_name: o.orderer_name,
    customer_ref: o.customer_ref, ship_zip: o.ship_zip, ship_address: o.ship_address, ship_name: o.ship_name, ship_tel: o.ship_tel, desired_date: o.desired_date,
    customer_note: o.customer_note, price_confirmed: o.price_confirmed, amount: o.price_confirmed ? o.amount : null, staff_name: o.staff_name, items,
    requests: all('SELECT id, kind, message, status, reply, created_at, decided_at FROM change_requests WHERE order_id=? ORDER BY id DESC', o.id),
  });
});
portal.post('/orders', (req, res) => {
  const b = req.body;
  const site = b.site_id ? get('SELECT * FROM sites WHERE id=? AND customer_id=?', b.site_id, req.cuser.customer_id) : null;
  const id = S.createOrder({
    customer_id: req.cuser.customer_id, site_id: site?.id || null, source: 'portal', orderer_name: b.orderer_name || req.cuser.name,
    customer_ref: b.customer_ref || null, ship_zip: b.ship_zip ?? site?.zip, ship_address: b.ship_address ?? site?.address, ship_name: b.ship_name ?? site?.receiver,
    ship_tel: b.ship_tel ?? site?.tel, desired_date: b.desired_date || null, customer_note: b.note || null,
  }, cleanItems(b.items), { kind: 'customer', id: req.cuser.id });
  const o = S.orderDetail(id);
  res.json({ id, no: o.no });
});
portal.post('/orders/:id/request', (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=? AND customer_id=?', req.params.id, req.cuser.customer_id);
  if (!o) throw U.httpError(404, 'ご注文が見つかりません');
  if (o.status !== 'open') throw U.httpError(400, 'このご注文は変更・取消できません。担当者へご連絡ください');
  const kind = req.body.kind === 'cancel' ? 'cancel' : 'change';
  if (kind === 'change' && !req.body.message) throw U.httpError(400, '変更内容を入れてください');
  insert('change_requests', { order_id: o.id, customer_user_id: req.cuser.id, kind, message: req.body.message || null });
  S.notify(o.staff_id, `ご注文 ${o.no} に${kind === 'cancel' ? '取消' : '変更'}の依頼が届きました`, `#/orders/${o.id}`);
  res.json({ ok: true });
});
portal.get('/invoices', (req, res) => {
  res.json(all(`SELECT i.id, i.no, i.closing_date, i.total_amount, i.current_amount, i.due_date, i.status, i.token,
      i.current_amount - (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.invoice_id=i.id) AS balance
    FROM invoices i WHERE i.customer_id=? ORDER BY i.closing_date DESC LIMIT 60`, req.cuser.customer_id));
});
portal.get('/unbilled', (req, res) => {
  res.json(all(`SELECT s.sale_date, s.no, s.kind, s.subtotal, o.no AS order_no, st.name AS site_name FROM sales s LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN sites st ON st.id=o.site_id
    WHERE s.customer_id=? AND s.invoice_id IS NULL ORDER BY s.sale_date`, req.cuser.customer_id));
});

// ================= 現場QR注文（ログイン不要） =================
const qr = express.Router();
function siteByToken(t) {
  const s = get(`SELECT s.*, c.name AS customer_name, c.active AS c_active FROM sites s JOIN customers c ON c.id=s.customer_id WHERE s.qr_token=? AND s.active=1`, t);
  if (!s || !s.c_active) throw U.httpError(404, 'このQRコードは使えません。担当者へご連絡ください');
  return s;
}
qr.get('/:token', (req, res) => {
  const s = siteByToken(req.params.token);
  const st = getSettings();
  res.json({ site: { name: s.name, address: s.address, receiver: s.receiver }, customer_name: s.customer_name, company_name: st.company_name, company_tel: st.company_tel });
});
qr.get('/:token/products', (req, res) => { siteByToken(req.params.token); res.json(productSearch(req.query.q)); });
const qrRate = new Map();
qr.post('/:token/order', (req, res) => {
  const s = siteByToken(req.params.token);
  const t = Date.now();
  const list = (qrRate.get(s.id) || []).filter((x) => t - x < 3600e3);
  if (list.length >= 20) throw U.httpError(429, '短時間に多くの注文が送られました。担当者へご連絡ください');
  list.push(t); qrRate.set(s.id, list);
  if (!req.body.orderer_name) throw U.httpError(400, 'お名前を入れてください');
  const id = S.createOrder({
    customer_id: s.customer_id, site_id: s.id, source: 'qr', orderer_name: `${String(req.body.orderer_name).slice(0, 50)}${req.body.tel ? `（${String(req.body.tel).slice(0, 20)}）` : ''}`,
    desired_date: req.body.desired_date || null, customer_note: req.body.note ? String(req.body.note).slice(0, 1000) : null,
  }, cleanItems(req.body.items), { kind: 'qr' });
  res.json({ ok: true, no: S.orderDetail(id).no });
});

// ================= 仕入先回答ページ（ログイン不要） =================
const sup = express.Router();
sup.get('/:token', (req, res) => {
  const po = get('SELECT id FROM purchase_orders WHERE token=?', req.params.token);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  const d = S.poDetail(po.id);
  if (d.status === 'draft') throw U.httpError(404, '発注が見つかりません');
  const s = getSettings();
  res.json({
    no: d.no, status: d.status, supplier_name: d.supplier_name, sent_at: d.sent_at, answered_at: d.answered_at, desired_date: d.desired_date,
    ship_zip: d.ship_zip, ship_address: d.ship_address, ship_name: d.ship_name, ship_tel: d.ship_tel, note: d.note,
    shipping_fee: d.shipping_fee, answer_comment: d.answer_comment, answer_person: d.answer_person, ship_request_note: d.ship_request_note,
    shipped_at: d.shipped_at, tracking_no: d.tracking_no, purpose: d.purpose, order_no: d.order_no, customer_name: d.purpose === 'order' ? d.customer_name : null,
    staff_name: d.staff_name, staff_tel: d.staff_tel, staff_email: d.staff_email,
    company: { name: s.company_name, address: s.company_address, tel: s.company_tel, fax: s.company_fax },
    items: d.items.map((i) => ({ id: i.id, maker: i.maker, code: i.code, name: i.name, spec: i.spec, qty: i.qty, unit: i.unit, list_price: i.list_price, cost_price: i.cost_price, answer_date: i.answer_date, answer_price: i.answer_price, answer_qty: i.answer_qty, alt_code: i.alt_code, alt_name: i.alt_name, answer_note: i.answer_note })),
  });
});
sup.post('/:token/answer', (req, res) => { S.supplierAnswer(req.params.token, req.body); res.json({ ok: true }); });
sup.post('/:token/shipped', (req, res) => {
  const po = get('SELECT status FROM purchase_orders WHERE token=?', req.params.token);
  if (!po || po.status === 'draft') throw U.httpError(404, '発注が見つかりません');
  S.supplierShipped(req.params.token, req.body); res.json({ ok: true });
});

module.exports = { portal, qr, sup };
