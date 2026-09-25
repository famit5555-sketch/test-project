'use strict';
// 受注・発注・出荷指示・納期カレンダー・ダッシュボード
const express = require('express');
const { all, get, run, tx, insert, update, nextNo } = require('../db');
const U = require('../util');
const { scopeFilter } = require('../auth');
const S = require('../services');

const r = express.Router();

// ---------- 受注 ----------
const ORDER_FLAGS = {
  unconfirmed: " AND o.source IN ('portal','qr') AND o.price_confirmed=0 AND o.status='open'",
  price_unset: " AND o.status='open' AND EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.status<>'cancelled' AND x.sell_price IS NULL)",
  to_order: " AND o.status='open' AND EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.status='open' AND x.source='po')",
  eta_unnotified: " AND o.status='open' AND o.eta_notified_at IS NULL AND NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.status NOT IN ('cancelled','delivered') AND x.eta_date IS NULL) AND EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.eta_date IS NOT NULL AND x.status NOT IN ('cancelled','delivered'))",
  to_sell: " AND o.status='open' AND EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.sold_qty < x.qty AND (x.status='shipped' OR (x.source='stock' AND x.status='answered')))",
  change_request: " AND EXISTS (SELECT 1 FROM change_requests cr WHERE cr.order_id=o.id AND cr.status='pending')",
};
r.get('/orders', (req, res) => {
  const f = scopeFilter(req.user, req.query.scope, 'o');
  let sql = `SELECT o.*, c.name AS customer_name, s.name AS site_name, u.name AS staff_name,
      (SELECT COALESCE(SUM(x.qty*COALESCE(x.sell_price,0)),0) FROM order_items x WHERE x.order_id=o.id AND x.status<>'cancelled') AS amount,
      (SELECT COUNT(*) FROM order_items x WHERE x.order_id=o.id AND x.status<>'cancelled') AS item_cnt,
      (SELECT MAX(x.eta_date) FROM order_items x WHERE x.order_id=o.id AND x.status<>'cancelled') AS eta_max,
      (SELECT COUNT(*) FROM change_requests cr WHERE cr.order_id=o.id AND cr.status='pending') AS pending_requests
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN sites s ON s.id=o.site_id LEFT JOIN users u ON u.id=o.staff_id WHERE 1=1 ${f.sql}`;
  const p = [];
  if (req.query.status) { sql += ' AND o.status=?'; p.push(req.query.status); }
  if (req.query.source) { sql += ' AND o.source=?'; p.push(req.query.source); }
  if (req.query.customer_id) { sql += ' AND o.customer_id=?'; p.push(req.query.customer_id); }
  if (req.query.flag && ORDER_FLAGS[req.query.flag]) sql += ORDER_FLAGS[req.query.flag];
  if (req.query.from) { sql += ' AND o.created_at>=?'; p.push(req.query.from); }
  if (req.query.to) { sql += ' AND o.created_at<=?'; p.push(req.query.to + ' 23:59:59'); }
  if (req.query.q) { sql += ' AND (o.no LIKE ? OR c.name LIKE ? OR s.name LIKE ? OR o.customer_ref LIKE ?)'; p.push(...Array(4).fill(`%${req.query.q}%`)); }
  sql += ' ORDER BY o.id DESC LIMIT 500';
  res.json({ rows: all(sql, ...p), scope: f.scope });
});

function fullOrder(id) {
  const o = S.orderDetail(id);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  o.pos = all(`SELECT p.*, s.name AS supplier_name FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.order_id=? ORDER BY p.id`, id);
  o.requests = all(`SELECT cr.*, cu.name AS requester FROM change_requests cr LEFT JOIN customer_users cu ON cu.id=cr.customer_user_id WHERE cr.order_id=? ORDER BY cr.id DESC`, id);
  o.sales = all('SELECT s.*, i.no AS invoice_no FROM sales s LEFT JOIN invoices i ON i.id=s.invoice_id WHERE s.order_id=? ORDER BY s.id', id);
  o.mails = all("SELECT id, to_addr, subject, status, created_at FROM mails WHERE related=? ORDER BY id DESC", `order:${id}`);
  return o;
}
r.get('/orders/:id', (req, res) => res.json(fullOrder(req.params.id)));

r.post('/orders', (req, res) => {
  const id = S.createOrder({ ...req.body, source: 'manual' }, req.body.items, { kind: 'staff', id: req.user.id });
  res.json({ id });
});

const HEAD = ['site_id', 'staff_id', 'orderer_name', 'customer_ref', 'ship_zip', 'ship_address', 'ship_name', 'ship_tel', 'desired_date', 'customer_note', 'internal_note'];
r.put('/orders/:id', (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  tx(() => {
    const h = U.pick(req.body, HEAD);
    if ('site_id' in h) h.site_id = h.site_id ? Number(h.site_id) : null;
    if ('staff_id' in h) {
      h.staff_id = h.staff_id ? Number(h.staff_id) : null;
      const st = h.staff_id && get('SELECT branch_id FROM users WHERE id=?', h.staff_id);
      if (st) h.branch_id = st.branch_id;
    }
    update('orders', o.id, { ...h, updated_at: U.now() });
    if (Array.isArray(req.body.items)) {
      const existing = all('SELECT * FROM order_items WHERE order_id=?', o.id);
      const keep = new Set();
      req.body.items.forEach((it, i) => {
        const ex = it.id && existing.find((e) => e.id === Number(it.id));
        if (ex) {
          keep.add(ex.id);
          const patch = { seq: i + 1, sell_price: U.toNumOrNull(it.sell_price) };
          if (ex.status === 'open') Object.assign(patch, {
            maker: it.maker || null, code: it.code || null, name: it.name || '', spec: it.spec || null, qty: U.toNum(it.qty, 1), unit: it.unit || null,
            list_price: U.toNum(it.list_price, 0), cost_price: U.toNumOrNull(it.cost_price), supplier_id: it.supplier_id ? Number(it.supplier_id) : null,
          });
          else if (it.cost_price !== undefined) patch.cost_price = U.toNumOrNull(it.cost_price);
          update('order_items', ex.id, patch);
        } else {
          const p = S.productFor(it.maker, it.code);
          insert('order_items', {
            order_id: o.id, seq: i + 1, product_id: p?.id || null, maker: it.maker || p?.maker || null, code: it.code || null, name: it.name || p?.name || '',
            spec: it.spec || null, qty: U.toNum(it.qty, 1), unit: it.unit || p?.unit || '個', list_price: U.toNum(it.list_price, p?.list_price || 0),
            sell_price: U.toNumOrNull(it.sell_price), cost_price: U.toNumOrNull(it.cost_price), supplier_id: it.supplier_id ? Number(it.supplier_id) : (p?.supplier_id || null),
          });
        }
      });
      for (const e of existing) {
        if (keep.has(e.id)) continue;
        if (e.status !== 'open' || e.sold_qty > 0) throw U.httpError(400, `「${e.code || e.name}」は発注・引当済みのため削除できません。取消を使ってください`);
        run('DELETE FROM order_items WHERE id=?', e.id);
      }
    }
    const unset = get("SELECT COUNT(*) AS n FROM order_items WHERE order_id=? AND status<>'cancelled' AND sell_price IS NULL", o.id).n;
    if (!unset && (o.source === 'manual' || o.source === 'quote')) update('orders', o.id, { price_confirmed: 1 });
  })();
  res.json({ ok: true });
});
// 売単価の一括登録
r.post('/orders/:id/prices', (req, res) => {
  tx(() => {
    for (const it of req.body.items || []) run('UPDATE order_items SET sell_price=? WHERE id=? AND order_id=?', U.toNumOrNull(it.sell_price), it.id, req.params.id);
    if (req.body.rate != null && req.body.rate !== '') {
      const rate = U.toNum(req.body.rate); const rr = rate > 1.5 ? rate / 100 : rate;
      for (const it of all("SELECT * FROM order_items WHERE order_id=? AND sell_price IS NULL AND status<>'cancelled'", req.params.id)) {
        update('order_items', it.id, { sell_price: U.priceByRate(it.list_price, rr) });
      }
    }
  })();
  res.json({ ok: true });
});
r.post('/orders/:id/notify-price', async (req, res) => res.json(await S.notifyPrice(Number(req.params.id))));
r.post('/orders/:id/confirm', (req, res) => { update('orders', req.params.id, { price_confirmed: 1 }); res.json({ ok: true }); });
r.post('/orders/:id/generate-po', (req, res) => res.json({ ids: S.generatePOs(Number(req.params.id), req.user, req.body.item_ids) }));
r.post('/orders/:id/order-and-send', async (req, res) => {
  const ids = S.generatePOs(Number(req.params.id), req.user, req.body.item_ids);
  const errors = [];
  for (const id of ids) { try { await S.sendPO(id, req.user); } catch (e) { errors.push(e.message); } }
  res.json({ ids, errors });
});
r.post('/orders/:id/notify-eta', async (req, res) => res.json(await S.notifyEta(Number(req.params.id))));
r.post('/orders/:id/sale', (req, res) => res.json({ id: S.recordSale(Number(req.params.id), req.body, req.user) }));
r.post('/orders/:id/return', (req, res) => res.json({ id: S.recordReturn(Number(req.params.id), req.body) }));
r.post('/orders/:id/cancel', async (req, res) => { await S.cancelOrder(Number(req.params.id)); res.json({ ok: true }); });

r.post('/order-items/:id/split', (req, res) => res.json({ id: S.splitOrderItem(Number(req.params.id), req.body.qty) }));
r.post('/order-items/:id/stock', (req, res) => { S.allocateFromStock(Number(req.params.id)); res.json({ ok: true }); });
r.post('/order-items/:id/unstock', (req, res) => { S.releaseStock(Number(req.params.id)); res.json({ ok: true }); });
r.post('/order-items/:id/cancel', (req, res) => {
  const it = get('SELECT * FROM order_items WHERE id=?', req.params.id);
  if (!it) throw U.httpError(404, '明細が見つかりません');
  if (it.status !== 'open' || it.sold_qty > 0) throw U.httpError(400, '発注・引当済みの明細は、先に発注を取り消してください');
  update('order_items', it.id, { status: 'cancelled' });
  S.refreshOrderStatus(it.order_id);
  res.json({ ok: true });
});

// 取消・変更依頼への承認・却下
r.post('/change-requests/:id/decide', async (req, res) => {
  const cr = get('SELECT * FROM change_requests WHERE id=?', req.params.id);
  if (!cr) throw U.httpError(404, '依頼が見つかりません');
  if (cr.status !== 'pending') throw U.httpError(400, 'すでに対応済みです');
  const approve = !!req.body.approve;
  if (approve && cr.kind === 'cancel') await S.cancelOrder(cr.order_id);
  update('change_requests', cr.id, { status: approve ? 'approved' : 'rejected', reply: req.body.reply || null, decided_at: U.now(), decided_by: req.user.id });
  const o = S.orderDetail(cr.order_id);
  const cu = cr.customer_user_id && get('SELECT * FROM customer_users WHERE id=?', cr.customer_user_id);
  const { sendMail } = require('../mail');
  const to = [cu && /@/.test(cu.login) ? cu.login : null, o.customer_email].filter(Boolean)[0];
  await sendMail({ to, subject: `【${cr.kind === 'cancel' ? '取消' : '変更'}のご依頼について】ご注文 ${o.no}`, related: `order:${o.id}`,
    body: `${o.customer_name} 御中\n\nご注文 ${o.no} の${cr.kind === 'cancel' ? '取消' : '変更'}のご依頼を${approve ? '承りました' : 'お受けできませんでした'}。\n${req.body.reply ? `\n${req.body.reply}\n` : ''}` });
  res.json({ ok: true });
});

// ---------- 発注 ----------
r.get('/purchases', (req, res) => {
  const f = scopeFilter(req.user, req.query.scope, 'p');
  let sql = `SELECT p.*, s.name AS supplier_name, o.no AS order_no, c.name AS customer_name, u.name AS staff_name,
      (SELECT COALESCE(SUM(pi.qty*COALESCE(pi.answer_price,pi.cost_price,0)),0) FROM po_items pi WHERE pi.po_id=p.id) AS amount,
      (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id=p.id) AS item_cnt,
      (SELECT MAX(pi.answer_date) FROM po_items pi WHERE pi.po_id=p.id) AS eta_max
    FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN orders o ON o.id=p.order_id
    LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=p.staff_id WHERE 1=1 ${f.sql}`;
  const p = [];
  if (req.query.status) { sql += ` AND p.status IN (${String(req.query.status).split(',').map(() => '?').join(',')})`; p.push(...String(req.query.status).split(',')); }
  if (req.query.supplier_id) { sql += ' AND p.supplier_id=?'; p.push(req.query.supplier_id); }
  if (req.query.purpose) { sql += ' AND p.purpose=?'; p.push(req.query.purpose); }
  if (req.query.q) { sql += ' AND (p.no LIKE ? OR s.name LIKE ? OR o.no LIKE ? OR c.name LIKE ?)'; p.push(...Array(4).fill(`%${req.query.q}%`)); }
  sql += ' ORDER BY p.id DESC LIMIT 500';
  res.json({ rows: all(sql, ...p), scope: f.scope });
});
r.get('/purchases/:id', (req, res) => {
  const po = S.poDetail(req.params.id);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  po.mails = all('SELECT id, to_addr, subject, status, created_at FROM mails WHERE related=? ORDER BY id DESC', `po:${po.id}`);
  res.json(po);
});
// 在庫補充・枠取りの発注
r.post('/purchases', (req, res) => {
  const sup = get('SELECT * FROM suppliers WHERE id=?', req.body.supplier_id);
  if (!sup) throw U.httpError(400, '仕入先を選んでください');
  const items = (req.body.items || []).filter((it) => it.code || it.name);
  if (!items.length) throw U.httpError(400, '明細がありません');
  const id = tx(() => {
    const pid = insert('purchase_orders', {
      no: nextNo('H'), supplier_id: sup.id, staff_id: req.user.id, branch_id: req.user.branch_id, purpose: 'stock', status: 'draft', token: U.token(24),
      ship_address: req.body.ship_address || null, ship_name: req.body.ship_name || null, desired_date: req.body.desired_date || null, note: req.body.note || null,
    });
    for (const it of items) {
      const p = S.productFor(it.maker, it.code);
      insert('po_items', { po_id: pid, product_id: p?.id || null, maker: it.maker || p?.maker || null, code: it.code || null, name: it.name || p?.name || '', qty: U.toNum(it.qty, 1), unit: it.unit || p?.unit || '個', list_price: U.toNum(it.list_price, p?.list_price || 0), cost_price: U.toNumOrNull(it.cost_price) ?? (p?.cost_rate ? U.priceByRate(p.list_price, p.cost_rate) : null) });
    }
    return pid;
  })();
  res.json({ id });
});
r.put('/purchases/:id', (req, res) => {
  const po = get('SELECT * FROM purchase_orders WHERE id=?', req.params.id);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (!['draft'].includes(po.status)) throw U.httpError(400, '送信済みの発注は編集できません');
  tx(() => {
    update('purchase_orders', po.id, U.pick(req.body, ['ship_zip', 'ship_address', 'ship_name', 'ship_tel', 'desired_date', 'note']));
    for (const it of req.body.items || []) run('UPDATE po_items SET cost_price=? WHERE id=? AND po_id=?', U.toNumOrNull(it.cost_price), it.id, po.id);
  })();
  res.json({ ok: true });
});
r.post('/purchases/:id/send', async (req, res) => res.json(await S.sendPO(Number(req.params.id), req.user)));
r.post('/purchases/send-bulk', async (req, res) => {
  const results = [];
  for (const id of req.body.ids || []) {
    try { await S.sendPO(Number(id), req.user); results.push({ id, ok: true }); } catch (e) { results.push({ id, ok: false, error: e.message }); }
  }
  res.json({ results });
});
r.post('/purchases/:id/ship-request', async (req, res) => res.json(await S.requestShip(Number(req.params.id), req.body.note)));
r.post('/purchases/:id/receive', (req, res) => { S.receivePO(Number(req.params.id)); res.json({ ok: true }); });
r.post('/purchases/:id/cancel', async (req, res) => { await S.cancelPO(Number(req.params.id)); res.json({ ok: true }); });
// 電話・FAXで聞いた回答を社内で代理入力
r.post('/purchases/:id/answer', (req, res) => {
  const po = get('SELECT token FROM purchase_orders WHERE id=?', req.params.id);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  S.supplierAnswer(po.token, { ...req.body, person: req.body.person || `${req.user.name}（代理入力）` });
  res.json({ ok: true });
});
r.post('/purchases/:id/shipped', (req, res) => {
  const po = get('SELECT token FROM purchase_orders WHERE id=?', req.params.id);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  S.supplierShipped(po.token, req.body);
  res.json({ ok: true });
});

// ---------- 納期カレンダー ----------
r.get('/calendar', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : U.ymd().slice(0, 7);
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const to = `${month}-${String(U.lastDayOfMonth(y, m)).padStart(2, '0')}`;
  let sql = `SELECT oi.id, oi.eta_date, oi.maker, oi.code, oi.name, oi.qty, oi.unit, oi.status, oi.source, o.id AS order_id, o.no AS order_no,
      c.name AS customer_name, s.name AS site_name, sp.name AS supplier_name, u.name AS staff_name
    FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN sites s ON s.id=o.site_id
    LEFT JOIN suppliers sp ON sp.id=oi.supplier_id LEFT JOIN users u ON u.id=o.staff_id
    WHERE oi.eta_date BETWEEN ? AND ? AND oi.status<>'cancelled' AND o.status<>'cancelled'`;
  const p = [from, to];
  if (req.query.staff_id) { sql += ' AND o.staff_id=?'; p.push(req.query.staff_id); }
  if (req.query.branch_id) { sql += ' AND o.branch_id=?'; p.push(req.query.branch_id); }
  if (req.query.customer_id) { sql += ' AND o.customer_id=?'; p.push(req.query.customer_id); }
  sql += ' ORDER BY oi.eta_date, o.id';
  res.json({ month, events: all(sql, ...p) });
});

// ---------- ダッシュボード ----------
r.get('/dashboard', (req, res) => {
  const scope = req.query.scope || req.user.view_scope;
  const fo = scopeFilter(req.user, scope, 'o').sql;
  const fp = scopeFilter(req.user, scope, 'p').sql;
  const fq = scopeFilter(req.user, scope, 'q').sql;
  const cnt = (sql, ...p) => get(sql, ...p).n;
  const orderCnt = (flag) => cnt(`SELECT COUNT(*) AS n FROM orders o WHERE 1=1 ${fo} ${ORDER_FLAGS[flag]}`);
  const today = U.ymd();
  const todo = [
    { key: 'unconfirmed', label: 'お客様からの注文（未確認）', hint: 'ポータル・現場QRから届いた注文。価格を確認して回答', count: orderCnt('unconfirmed'), link: '#/orders?flag=unconfirmed', icon: 'inbox' },
    { key: 'to_order', label: '発注待ちの受注', hint: '仕入先へまだ発注していない明細がある受注', count: orderCnt('to_order'), link: '#/orders?flag=to_order', icon: 'cart' },
    { key: 'draft_po', label: '下書きのままの発注', hint: '作成したがまだ送信していない発注書', count: cnt(`SELECT COUNT(*) AS n FROM purchase_orders p WHERE p.status='draft' ${fp}`), link: '#/purchases?status=draft', icon: 'draft' },
    { key: 'eta_unnotified', label: '納期未連絡', hint: '仕入先の回答がそろい、お客様へ納期を送る受注', count: orderCnt('eta_unnotified'), link: '#/orders?flag=eta_unnotified', icon: 'mail' },
    { key: 'ship_pending', label: '出荷指示待ち', hint: '回答済みで、まだ出荷指示を出していない発注', count: cnt(`SELECT COUNT(*) AS n FROM purchase_orders p WHERE p.status='answered' AND p.purpose='order' ${fp}`), link: '#/shipments', icon: 'truck' },
    { key: 'to_sell', label: '売上未計上', hint: '出荷済み・在庫引当済みで、売上に計上していない受注', count: orderCnt('to_sell'), link: '#/orders?flag=to_sell', icon: 'yen' },
    { key: 'change_request', label: '取消・変更の依頼', hint: 'お客様からの依頼に承認・却下で回答', count: orderCnt('change_request'), link: '#/orders?flag=change_request', icon: 'alert' },
    { key: 'stale_quotes', label: '動いていない見積', hint: '商談中のまま14日以上更新のない見積', count: cnt(`SELECT COUNT(*) AS n FROM quotes q WHERE q.status IN ('negotiating') AND q.updated_at < ? AND q.version=(SELECT MAX(version) FROM quotes q2 WHERE q2.group_no=q.group_no) ${fq}`, U.addDays(today, -14)), link: '#/quotes?stale=14', icon: 'doc' },
  ];
  const waiting = [
    { key: 'answer_wait', label: '仕入先の回答待ち', hint: '発注書を送り、納期・単価の回答を待っている', count: cnt(`SELECT COUNT(*) AS n FROM purchase_orders p WHERE p.status='sent' ${fp}`), link: '#/purchases?status=sent', icon: 'clock' },
    { key: 'ship_wait', label: '出荷待ち', hint: '出荷指示を出し、出荷の連絡を待っている', count: cnt(`SELECT COUNT(*) AS n FROM purchase_orders p WHERE p.status='ship_requested' ${fp}`), link: '#/purchases?status=ship_requested', icon: 'truck' },
    { key: 'overdue', label: '入金期日を過ぎた請求', hint: '支払期日を過ぎても入金が消し込まれていない請求書', count: cnt(`SELECT COUNT(*) AS n FROM invoices i WHERE i.due_date < ? AND i.status IN ('issued','sent','partial') AND i.current_amount > 0`, today), link: '#/invoices?overdue=1', icon: 'yen' },
  ];
  const month = today.slice(0, 7);
  const kpi = {
    quotes_month: get(`SELECT COUNT(*) AS n, COALESCE(SUM((SELECT SUM(qi.qty*qi.sell_price) FROM quote_items qi WHERE qi.quote_id=q.id)),0) AS amt FROM quotes q WHERE substr(q.issue_date,1,7)=? AND q.version=(SELECT MAX(version) FROM quotes q2 WHERE q2.group_no=q.group_no) ${fq}`, month),
    orders_month: get(`SELECT COUNT(*) AS n, COALESCE(SUM((SELECT SUM(x.qty*COALESCE(x.sell_price,0)) FROM order_items x WHERE x.order_id=o.id AND x.status<>'cancelled')),0) AS amt FROM orders o WHERE substr(o.created_at,1,7)=? AND o.status<>'cancelled' ${fo}`, month),
    sales_month: get(`SELECT COUNT(*) AS n, COALESCE(SUM(o.subtotal),0) AS amt FROM sales o WHERE substr(o.sale_date,1,7)=? ${fo}`, month),
    eta_week: get(`SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.eta_date BETWEEN ? AND ? AND oi.status NOT IN ('cancelled','delivered') ${fo}`, today, U.addDays(today, 6)),
  };
  const notifications = all('SELECT * FROM notifications WHERE (user_id=? OR user_id IS NULL) ORDER BY id DESC LIMIT 15', req.user.id);
  res.json({ todo, waiting, kpi, notifications, scope: scopeFilter(req.user, scope, 'o').scope });
});

r.get('/shipments', (req, res) => {
  const f = scopeFilter(req.user, req.query.scope, 'p');
  const rows = all(`SELECT p.*, s.name AS supplier_name, o.no AS order_no, c.name AS customer_name, st.name AS site_name,
      (SELECT MAX(pi.answer_date) FROM po_items pi WHERE pi.po_id=p.id) AS eta_max,
      (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id=p.id) AS item_cnt
    FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN orders o ON o.id=p.order_id
    LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN sites st ON st.id=o.site_id
    WHERE p.purpose='order' AND p.status IN ('answered','ship_requested','shipped') ${f.sql} ORDER BY eta_max, p.id LIMIT 500`);
  res.json({ rows, scope: f.scope });
});

r.get('/notifications', (req, res) => res.json(all('SELECT * FROM notifications WHERE (user_id=? OR user_id IS NULL) ORDER BY id DESC LIMIT 50', req.user.id)));
r.post('/notifications/read', (req, res) => { run('UPDATE notifications SET is_read=1 WHERE user_id=? OR user_id IS NULL', req.user.id); res.json({ ok: true }); });

module.exports = r;
