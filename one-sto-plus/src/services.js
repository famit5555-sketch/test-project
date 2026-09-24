'use strict';
// 業務ロジック（受注・発注・仕入先回答・売上・請求・入金）
const { all, get, run, tx, insert, update, getSettings, nextNo } = require('./db');
const U = require('./util');
const { sendMail, baseUrl } = require('./mail');

const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}円`;
const fmtQty = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : String(Number(n)));

function notify(userId, message, link) { insert('notifications', { user_id: userId || null, message, link: link || '' }); }

// ---------- 受注 ----------
function orderAmount(orderId) {
  const r = get(`SELECT COALESCE(SUM(qty * COALESCE(sell_price,0)),0) AS amt, COALESCE(SUM(qty * COALESCE(cost_price,0)),0) AS cost
    FROM order_items WHERE order_id=? AND status<>'cancelled'`, orderId);
  return r;
}

function productFor(maker, code) {
  if (!code) return null;
  return (maker && get('SELECT * FROM products WHERE code=? AND maker=? AND active=1 LIMIT 1', code, maker))
    || get('SELECT * FROM products WHERE code=? AND active=1 LIMIT 1', code);
}

function normItem(it, i) {
  const p = it.product_id ? get('SELECT * FROM products WHERE id=?', it.product_id) : productFor(it.maker, it.code);
  return {
    seq: i + 1,
    product_id: p ? p.id : null,
    maker: it.maker ?? p?.maker ?? null,
    code: it.code ?? p?.code ?? null,
    name: it.name || p?.name || '',
    spec: it.spec ?? p?.spec ?? null,
    qty: U.toNum(it.qty, 1),
    unit: it.unit || p?.unit || '個',
    list_price: U.toNum(it.list_price, p?.list_price || 0),
    sell_price: U.toNumOrNull(it.sell_price),
    cost_price: U.toNumOrNull(it.cost_price) ?? (p && p.cost_rate ? U.priceByRate(p.list_price, p.cost_rate) : null),
    supplier_id: it.supplier_id || p?.supplier_id || null,
  };
}

const createOrder = (h, items, actor) => tx(() => {
  const c = get('SELECT * FROM customers WHERE id=?', h.customer_id);
  if (!c) throw U.httpError(400, 'お客様を選んでください');
  if (!items || !items.length) throw U.httpError(400, '明細がありません');
  const site = h.site_id ? get('SELECT * FROM sites WHERE id=? AND customer_id=?', h.site_id, c.id) : null;
  const staffId = h.staff_id || c.staff_id || (actor && actor.kind === 'staff' ? actor.id : null);
  const staff = staffId ? get('SELECT * FROM users WHERE id=?', staffId) : null;
  const normalized = items.map(normItem);
  const priceConfirmed = normalized.every((it) => it.sell_price != null) ? 1 : 0;
  const id = insert('orders', {
    no: nextNo('J'), customer_id: c.id, site_id: site ? site.id : null, quote_id: h.quote_id || null, project_id: h.project_id || null,
    staff_id: staffId, branch_id: h.branch_id || staff?.branch_id || c.branch_id || null,
    source: h.source || 'manual', status: 'open',
    orderer_name: h.orderer_name || null, customer_ref: h.customer_ref || null,
    ship_zip: h.ship_zip ?? site?.zip ?? null, ship_address: h.ship_address ?? site?.address ?? null,
    ship_name: h.ship_name ?? site?.receiver ?? null, ship_tel: h.ship_tel ?? site?.tel ?? null,
    desired_date: h.desired_date || null, customer_note: h.customer_note || null, internal_note: h.internal_note || null,
    price_confirmed: priceConfirmed,
  });
  for (const it of normalized) insert('order_items', { ...it, order_id: id });
  if (h.source === 'portal' || h.source === 'qr') {
    notify(staffId, `お客様から新しい注文が届きました（${c.name}${site ? '／' + site.name : ''}）`, `#/orders/${id}`);
  }
  return id;
})();

const quoteToOrder = (quoteId, user) => tx(() => {
  const q = get('SELECT * FROM quotes WHERE id=?', quoteId);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  if (q.order_id) throw U.httpError(400, 'この見積はすでに受注になっています');
  if (!q.customer_id) throw U.httpError(400, '見積にお客様が設定されていません');
  const items = all('SELECT * FROM quote_items WHERE quote_id=? ORDER BY seq', quoteId).filter((it) => it.code || it.name);
  const project = q.project_id ? get('SELECT * FROM projects WHERE id=?', q.project_id) : null;
  const orderId = createOrder({
    customer_id: q.customer_id, site_id: project?.site_id || null, quote_id: q.id, project_id: q.project_id,
    staff_id: q.staff_id, branch_id: q.branch_id, source: 'quote', customer_ref: q.title,
    internal_note: `見積 ${q.no} 第${q.version}版より`,
  }, items.map((it) => ({
    maker: it.maker, code: it.code, name: it.name, spec: it.spec, qty: it.qty, unit: it.unit, list_price: it.list_price,
    sell_price: it.sell_price, cost_price: it.cost_price, supplier_id: it.supplier_id,
  })), { kind: 'staff', id: user.id });
  update('quotes', q.id, { status: 'won', order_id: orderId, updated_at: U.now() });
  return orderId;
})();

// ---------- 発注 ----------
// 受注の未発注明細を仕入先ごとに分けて、発注書（下書き）を作る
const generatePOs = (orderId, user, itemIds) => tx(() => {
  const o = get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  if (o.status === 'cancelled') throw U.httpError(400, '取消済みの受注です');
  let items = all(`SELECT oi.* FROM order_items oi WHERE oi.order_id=? AND oi.source='po' AND oi.status='open'
    AND NOT EXISTS (SELECT 1 FROM po_items pi JOIN purchase_orders p ON p.id=pi.po_id WHERE pi.order_item_id=oi.id AND p.status<>'cancelled')`, orderId);
  if (itemIds && itemIds.length) items = items.filter((it) => itemIds.includes(it.id));
  const missing = items.filter((it) => !it.supplier_id);
  if (missing.length) throw U.httpError(400, `仕入先が決まっていない明細があります: ${missing.map((m) => m.code || m.name).join('、')}`);
  if (!items.length) throw U.httpError(400, '発注できる明細がありません');
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.supplier_id)) groups.set(it.supplier_id, []); groups.get(it.supplier_id).push(it); }
  const ids = [];
  for (const [supplierId, list] of groups) {
    const poId = insert('purchase_orders', {
      no: nextNo('H'), order_id: orderId, supplier_id: supplierId, staff_id: o.staff_id || user.id, branch_id: o.branch_id,
      purpose: 'order', status: 'draft', token: U.token(24),
      ship_zip: o.ship_zip, ship_address: o.ship_address, ship_name: o.ship_name, ship_tel: o.ship_tel, desired_date: o.desired_date,
    });
    for (const it of list) {
      insert('po_items', {
        po_id: poId, order_item_id: it.id, product_id: it.product_id, maker: it.maker, code: it.code, name: it.name, spec: it.spec,
        qty: it.qty, unit: it.unit, list_price: it.list_price, cost_price: it.cost_price,
      });
      update('order_items', it.id, { status: 'ordered' });
    }
    ids.push(poId);
  }
  return ids;
})();

// 数量の分割（一部を別の仕入先へ、または在庫から）
const splitOrderItem = (itemId, qty) => tx(() => {
  const it = get('SELECT * FROM order_items WHERE id=?', itemId);
  if (!it) throw U.httpError(404, '明細が見つかりません');
  if (it.status !== 'open') throw U.httpError(400, '発注済みの明細は分割できません');
  const q = U.toNum(qty);
  if (!(q > 0 && q < it.qty)) throw U.httpError(400, `分割する数量は 0 より大きく ${it.qty} より小さくしてください`);
  update('order_items', it.id, { qty: it.qty - q });
  const { id, ...rest } = it;
  run('UPDATE order_items SET seq = seq + 1 WHERE order_id=? AND seq > ?', it.order_id, it.seq);
  return insert('order_items', { ...rest, seq: it.seq + 1, qty: q });
})();

// 自社在庫から引当
const allocateFromStock = (itemId) => tx(() => {
  const it = get('SELECT * FROM order_items WHERE id=?', itemId);
  if (!it) throw U.httpError(404, '明細が見つかりません');
  if (it.status !== 'open') throw U.httpError(400, '発注済みの明細は引当できません');
  const p = it.product_id ? get('SELECT * FROM products WHERE id=?', it.product_id) : productFor(it.maker, it.code);
  if (!p) throw U.httpError(400, '商品マスターに無い品番は在庫引当できません');
  if ((p.stock_qty || 0) < it.qty) throw U.httpError(400, `在庫が足りません（在庫 ${p.stock_qty} ／ 必要 ${it.qty}）`);
  run('UPDATE products SET stock_qty = stock_qty - ? WHERE id=?', it.qty, p.id);
  update('order_items', it.id, { source: 'stock', product_id: p.id, status: 'answered', eta_date: U.ymd() });
})();
const releaseStock = (itemId) => tx(() => {
  const it = get('SELECT * FROM order_items WHERE id=?', itemId);
  if (!it || it.source !== 'stock') throw U.httpError(400, '在庫引当の明細ではありません');
  if (it.sold_qty > 0) throw U.httpError(400, '売上計上済みのため戻せません');
  if (it.product_id) run('UPDATE products SET stock_qty = stock_qty + ? WHERE id=?', it.qty, it.product_id);
  update('order_items', it.id, { source: 'po', status: 'open', eta_date: null });
})();

function poDetail(poId) {
  const po = get(`SELECT p.*, s.name AS supplier_name, s.email AS supplier_email, s.contact AS supplier_contact, o.no AS order_no,
      c.name AS customer_name, u.name AS staff_name, u.email AS staff_email, u.tel AS staff_tel
    FROM purchase_orders p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN orders o ON o.id=p.order_id
    LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=p.staff_id WHERE p.id=?`, poId);
  if (!po) return null;
  po.items = all('SELECT * FROM po_items WHERE po_id=? ORDER BY id', poId);
  po.amount = po.items.reduce((s, it) => s + (Number(it.answer_price ?? it.cost_price) || 0) * (Number(it.qty) || 0), 0);
  return po;
}

async function sendPO(poId, user) {
  const po = poDetail(poId);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (!['draft', 'sent'].includes(po.status)) throw U.httpError(400, 'この発注はすでに回答済みです');
  if (!po.supplier_email) throw U.httpError(400, `仕入先「${po.supplier_name}」のメールアドレスが未登録です`);
  const s = getSettings();
  const lines = po.items.map((it) => `・${[it.maker, it.code].filter(Boolean).join(' ')} ${it.name || ''}　${fmtQty(it.qty)}${it.unit || ''}`).join('\n');
  const url = `${baseUrl()}/r/${po.token}`;
  const body = `${po.supplier_name}\n${po.supplier_contact ? po.supplier_contact + ' 様' : 'ご担当者様'}\n\nいつもお世話になっております。${s.company_name}の${po.staff_name || ''}です。\n下記のとおり発注いたします。納期と仕入単価のご回答をお願いいたします。\n\n発注番号：${po.no}\n${po.desired_date ? `希望納期：${po.desired_date}\n` : ''}${po.ship_address ? `納品先：${po.ship_address} ${po.ship_name || ''}\n` : ''}\n${lines}\n\n▼ 回答ページ（ログイン不要）\n${url}\n\n発注書（印刷用）：${baseUrl()}/doc/po/${po.token}`;
  const r = await sendMail({ to: po.supplier_email, subject: `【発注】${po.no} ${s.company_name}`, body, related: `po:${po.id}` });
  if (r.status === 'failed') throw U.httpError(500, `メール送信に失敗しました: ${r.error}`);
  update('purchase_orders', po.id, { status: 'sent', sent_at: U.now() });
  return r;
}

const supplierAnswer = (tokenStr, data) => tx(() => {
  const po = get('SELECT * FROM purchase_orders WHERE token=?', tokenStr);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (po.status === 'cancelled') throw U.httpError(400, 'この発注は取り消されました');
  if (['shipped', 'received'].includes(po.status)) throw U.httpError(400, '出荷済みのため回答を変更できません');
  const items = all('SELECT * FROM po_items WHERE po_id=?', po.id);
  const answers = new Map((data.items || []).map((a) => [Number(a.id), a]));
  for (const it of items) {
    const a = answers.get(it.id) || {};
    const answerDate = a.answer_date || null;
    if (answerDate && !/^\d{4}-\d{2}-\d{2}$/.test(answerDate)) throw U.httpError(400, '納期の日付が正しくありません');
    const price = U.toNumOrNull(a.answer_price);
    update('po_items', it.id, {
      answer_date: answerDate, answer_price: price, answer_qty: U.toNumOrNull(a.answer_qty),
      alt_code: a.alt_code || null, alt_name: a.alt_name || null, answer_note: a.answer_note || null,
    });
    if (it.order_item_id) {
      const patch = { status: 'answered' };
      if (answerDate) patch.eta_date = answerDate;
      if (price != null) patch.cost_price = price;
      update('order_items', it.order_item_id, patch);
    }
  }
  update('purchase_orders', po.id, {
    status: po.status === 'ship_requested' ? 'ship_requested' : 'answered', answered_at: U.now(),
    shipping_fee: U.toNumOrNull(data.shipping_fee), answer_comment: data.comment || null, answer_person: data.person || null,
  });
  const sup = get('SELECT name FROM suppliers WHERE id=?', po.supplier_id);
  notify(po.staff_id, `仕入先「${sup?.name || ''}」から発注 ${po.no} の回答が届きました`, po.order_id ? `#/orders/${po.order_id}` : `#/purchases/${po.id}`);
  return po.id;
})();

async function requestShip(poId, note) {
  const po = poDetail(poId);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (!['answered', 'sent', 'ship_requested'].includes(po.status)) throw U.httpError(400, '出荷指示できない状態です');
  const s = getSettings();
  const body = `${po.supplier_name} ご担当者様\n\n${s.company_name}の${po.staff_name || ''}です。発注 ${po.no} の出荷をお願いいたします。\n\n納品先：${po.ship_zip ? '〒' + po.ship_zip + ' ' : ''}${po.ship_address || '（弊社）'}\n受取人：${po.ship_name || ''} ${po.ship_tel || ''}\n${po.desired_date ? `納品希望日：${po.desired_date}\n` : ''}${note ? `\n${note}\n` : ''}\n出荷後は下記ページから出荷日・送り状番号をご入力ください。\n${baseUrl()}/r/${po.token}`;
  const r = await sendMail({ to: po.supplier_email, subject: `【出荷指示】${po.no} ${s.company_name}`, body, related: `po:${po.id}` });
  update('purchase_orders', po.id, { status: 'ship_requested', ship_requested_at: U.now(), ship_request_note: note || null });
  return r;
}

const supplierShipped = (tokenStr, data) => tx(() => {
  const po = get('SELECT * FROM purchase_orders WHERE token=?', tokenStr);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (po.status === 'cancelled') throw U.httpError(400, 'この発注は取り消されました');
  update('purchase_orders', po.id, { status: 'shipped', shipped_at: data.shipped_date || U.ymd(), tracking_no: data.tracking_no || null, ship_note: data.note || null });
  for (const it of all('SELECT * FROM po_items WHERE po_id=?', po.id)) {
    if (it.order_item_id) run("UPDATE order_items SET status='shipped' WHERE id=? AND status IN ('ordered','answered')", it.order_item_id);
  }
  notify(po.staff_id, `発注 ${po.no} が出荷されました`, po.order_id ? `#/orders/${po.order_id}` : `#/purchases/${po.id}`);
})();

// 在庫・枠取り発注の入荷
const receivePO = (poId) => tx(() => {
  const po = get('SELECT * FROM purchase_orders WHERE id=?', poId);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (po.purpose !== 'stock') throw U.httpError(400, '在庫補充の発注ではありません');
  if (po.status === 'received') throw U.httpError(400, '入荷済みです');
  for (const it of all('SELECT * FROM po_items WHERE po_id=?', po.id)) {
    const p = it.product_id ? get('SELECT id FROM products WHERE id=?', it.product_id) : productFor(it.maker, it.code);
    if (p) run('UPDATE products SET stock_qty = stock_qty + ? WHERE id=?', it.answer_qty ?? it.qty, p.id);
  }
  update('purchase_orders', po.id, { status: 'received', received_at: U.now() });
})();

async function cancelPO(poId) {
  const po = poDetail(poId);
  if (!po) throw U.httpError(404, '発注が見つかりません');
  if (['shipped', 'received'].includes(po.status)) throw U.httpError(400, '出荷済みの発注は取り消せません');
  tx(() => {
    update('purchase_orders', po.id, { status: 'cancelled' });
    for (const it of po.items) if (it.order_item_id) run("UPDATE order_items SET status='open' WHERE id=? AND status IN ('ordered','answered')", it.order_item_id);
  })();
  if (po.status !== 'draft' && po.supplier_email) {
    await sendMail({ to: po.supplier_email, subject: `【発注取消】${po.no}`, body: `${po.supplier_name} ご担当者様\n\n誠に恐れ入りますが、発注 ${po.no} を取り消させていただきます。\nお手数をおかけし申し訳ございません。`, related: `po:${po.id}` });
  }
}

// ---------- お客様への連絡 ----------
function orderDetail(orderId) {
  const o = get(`SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.code AS customer_code, s.name AS site_name,
      u.name AS staff_name, b.name AS branch_name, q.no AS quote_no
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN sites s ON s.id=o.site_id
    LEFT JOIN users u ON u.id=o.staff_id LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN quotes q ON q.id=o.quote_id WHERE o.id=?`, orderId);
  if (!o) return null;
  o.items = all(`SELECT oi.*, sp.name AS supplier_name,
      (SELECT p.no FROM po_items pi JOIN purchase_orders p ON p.id=pi.po_id WHERE pi.order_item_id=oi.id AND p.status<>'cancelled' ORDER BY p.id DESC LIMIT 1) AS po_no,
      (SELECT p.id FROM po_items pi JOIN purchase_orders p ON p.id=pi.po_id WHERE pi.order_item_id=oi.id AND p.status<>'cancelled' ORDER BY p.id DESC LIMIT 1) AS po_id
    FROM order_items oi LEFT JOIN suppliers sp ON sp.id=oi.supplier_id WHERE oi.order_id=? ORDER BY oi.seq, oi.id`, orderId);
  const a = orderAmount(orderId);
  o.amount = a.amt; o.cost = a.cost;
  return o;
}
function customerMailTargets(o) {
  const users = all('SELECT login FROM customer_users WHERE customer_id=? AND active=1', o.customer_id).map((u) => u.login).filter((x) => /@/.test(x));
  return [...new Set([o.customer_email, ...users].filter(Boolean))].join(',');
}

async function notifyEta(orderId) {
  const o = orderDetail(orderId);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  const s = getSettings();
  const lines = o.items.filter((it) => it.status !== 'cancelled').map((it) => `・${[it.maker, it.code].filter(Boolean).join(' ')} ${it.name || ''}　${fmtQty(it.qty)}${it.unit || ''}　納期：${it.eta_date || '確認中'}`).join('\n');
  const to = customerMailTargets(o);
  const body = `${o.customer_name} 御中\n\nいつもお世話になっております。${s.company_name}の${o.staff_name || ''}です。\nご注文 ${o.no}${o.site_name ? `（${o.site_name}）` : ''}の納期をご連絡いたします。\n\n${lines}\n\n${o.ship_address ? `お届け先：${o.ship_address} ${o.ship_name || ''}\n` : ''}ご注文の状況はお客様ポータルでもご確認いただけます。\n${baseUrl()}/portal/`;
  const r = await sendMail({ to, subject: `【納期のご連絡】ご注文 ${o.no}`, body, related: `order:${o.id}` });
  if (r.status === 'failed') throw U.httpError(400, `メールを送れませんでした: ${r.error}`);
  update('orders', o.id, { eta_notified_at: U.now() });
  return r;
}

async function notifyPrice(orderId) {
  const o = orderDetail(orderId);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  if (o.items.some((it) => it.status !== 'cancelled' && it.sell_price == null)) throw U.httpError(400, '売単価が入っていない明細があります');
  const s = getSettings();
  const lines = o.items.filter((it) => it.status !== 'cancelled').map((it) => `・${[it.maker, it.code].filter(Boolean).join(' ')} ${it.name || ''}　${fmtQty(it.qty)}${it.unit || ''} × ${yen(it.sell_price)} ＝ ${yen(it.qty * it.sell_price)}`).join('\n');
  const body = `${o.customer_name} 御中\n\nご注文ありがとうございます。${s.company_name}です。\nご注文 ${o.no} の価格をご案内いたします。\n\n${lines}\n\n合計（税抜）：${yen(o.amount)}\n\n詳細はお客様ポータルでご確認いただけます。\n${baseUrl()}/portal/`;
  const r = await sendMail({ to: customerMailTargets(o), subject: `【ご注文確認】${o.no} 価格のご案内`, body, related: `order:${o.id}` });
  update('orders', o.id, { price_confirmed: 1, price_notified_at: U.now() });
  return r;
}

// ---------- 売上・返品 ----------
const recordSale = (orderId, data, user) => tx(() => {
  const o = get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  if (o.status === 'cancelled') throw U.httpError(400, '取消済みの受注です');
  const date = data.sale_date || U.ymd();
  const rows = [];
  for (const r of data.items || []) {
    const it = get('SELECT * FROM order_items WHERE id=? AND order_id=?', r.order_item_id, orderId);
    if (!it) continue;
    const qty = U.toNum(r.qty, 0);
    if (qty <= 0) continue;
    if (it.sold_qty + qty > it.qty + 1e-9) throw U.httpError(400, `「${it.code || it.name}」の計上数量が受注数を超えています`);
    const price = r.price != null && r.price !== '' ? U.toNum(r.price) : it.sell_price;
    if (price == null) throw U.httpError(400, `「${it.code || it.name}」の売単価が入っていません`);
    rows.push({ it, qty, price });
  }
  if (!rows.length) throw U.httpError(400, '計上する明細がありません');
  const s = getSettings();
  const subtotal = rows.reduce((a, r) => a + U.round0(r.qty * r.price), 0);
  const cost = rows.reduce((a, r) => a + U.round0(r.qty * (r.it.cost_price || 0)), 0);
  const saleId = insert('sales', {
    no: nextNo('U', U.parseYmd(date)), order_id: o.id, customer_id: o.customer_id, staff_id: o.staff_id, branch_id: o.branch_id,
    sale_date: date, kind: 'sale', subtotal, tax: U.taxOf(subtotal, s.tax_rate), total: subtotal + U.taxOf(subtotal, s.tax_rate), cost_total: cost, note: data.note || null,
  });
  for (const r of rows) {
    insert('sale_items', { sale_id: saleId, order_item_id: r.it.id, maker: r.it.maker, code: r.it.code, name: r.it.name, qty: r.qty, unit: r.it.unit, price: r.price, amount: U.round0(r.qty * r.price), cost_price: r.it.cost_price });
    const sold = r.it.sold_qty + r.qty;
    update('order_items', r.it.id, { sold_qty: sold, sell_price: r.price, status: sold >= r.it.qty - 1e-9 ? 'delivered' : r.it.status });
  }
  refreshOrderStatus(o.id);
  return saleId;
})();

const recordReturn = (orderId, data) => tx(() => {
  const o = get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  const date = data.sale_date || U.ymd();
  const rows = [];
  for (const r of data.items || []) {
    const it = get('SELECT * FROM order_items WHERE id=? AND order_id=?', r.order_item_id, orderId);
    const qty = U.toNum(r.qty, 0);
    if (!it || qty <= 0) continue;
    if (it.returned_qty + qty > it.sold_qty + 1e-9) throw U.httpError(400, `「${it.code || it.name}」の返品数量が売上数量を超えています`);
    rows.push({ it, qty, price: r.price != null && r.price !== '' ? U.toNum(r.price) : it.sell_price || 0 });
  }
  if (!rows.length) throw U.httpError(400, '返品する明細がありません');
  const s = getSettings();
  const subtotal = -rows.reduce((a, r) => a + U.round0(r.qty * r.price), 0);
  const saleId = insert('sales', {
    no: nextNo('R', U.parseYmd(date)), order_id: o.id, customer_id: o.customer_id, staff_id: o.staff_id, branch_id: o.branch_id,
    sale_date: date, kind: 'return', subtotal, tax: U.taxOf(subtotal, s.tax_rate), total: subtotal + U.taxOf(subtotal, s.tax_rate),
    cost_total: -rows.reduce((a, r) => a + U.round0(r.qty * (r.it.cost_price || 0)), 0), note: data.note || '返品',
  });
  for (const r of rows) {
    insert('sale_items', { sale_id: saleId, order_item_id: r.it.id, maker: r.it.maker, code: r.it.code, name: r.it.name, qty: -r.qty, unit: r.it.unit, price: r.price, amount: -U.round0(r.qty * r.price), cost_price: r.it.cost_price });
    update('order_items', r.it.id, { returned_qty: r.it.returned_qty + r.qty });
    if (data.restock && r.it.product_id) run('UPDATE products SET stock_qty = stock_qty + ? WHERE id=?', r.qty, r.it.product_id);
  }
  return saleId;
})();

function refreshOrderStatus(orderId) {
  const items = all('SELECT status FROM order_items WHERE order_id=?', orderId);
  const live = items.filter((i) => i.status !== 'cancelled');
  if (!live.length) update('orders', orderId, { status: 'cancelled', updated_at: U.now() });
  else if (live.every((i) => i.status === 'delivered')) update('orders', orderId, { status: 'completed', updated_at: U.now() });
  else update('orders', orderId, { status: 'open', updated_at: U.now() });
}

const cancelOrder = async (orderId) => {
  const o = get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) throw U.httpError(404, '受注が見つかりません');
  if (get('SELECT 1 FROM sales WHERE order_id=? LIMIT 1', orderId)) throw U.httpError(400, '売上計上済みの受注は取り消せません。返品で処理してください');
  const pos = all("SELECT id FROM purchase_orders WHERE order_id=? AND status NOT IN ('cancelled')", orderId);
  for (const p of pos) await cancelPO(p.id);
  tx(() => {
    for (const it of all("SELECT * FROM order_items WHERE order_id=? AND source='stock'", orderId)) {
      if (it.product_id) run('UPDATE products SET stock_qty = stock_qty + ? WHERE id=?', it.qty, it.product_id);
    }
    run("UPDATE order_items SET status='cancelled' WHERE order_id=?", orderId);
    update('orders', orderId, { status: 'cancelled', updated_at: U.now() });
    if (o.quote_id) run("UPDATE quotes SET status='negotiating', order_id=NULL WHERE id=?", o.quote_id);
  })();
};

// ---------- 請求 ----------
function invoiceBalance(invId) {
  const inv = get('SELECT * FROM invoices WHERE id=?', invId);
  const alloc = get('SELECT COALESCE(SUM(amount),0) AS a FROM payment_allocations WHERE invoice_id=?', invId).a;
  return { inv, allocated: alloc, balance: (inv?.current_amount || 0) - alloc };
}
function refreshInvoiceStatus(invId) {
  const { inv, allocated, balance } = invoiceBalance(invId);
  if (!inv) return;
  let status = inv.sent_at ? 'sent' : 'issued';
  if (inv.current_amount > 0 && balance <= 0) status = 'paid';
  else if (inv.current_amount <= 0 && allocated === 0) status = inv.sent_at ? 'sent' : 'issued';
  else if (allocated > 0) status = 'partial';
  update('invoices', invId, { status });
}

// 締めて請求書を作る。closing_day（5/10/15/20/25/31）に該当するお客様を、指定の締め日で締める
const closeInvoices = (closingDate, closingDay, customerIds) => tx(() => {
  const s = getSettings();
  let customers = all('SELECT * FROM customers WHERE active=1 AND closing_day=?', closingDay);
  if (customerIds && customerIds.length) customers = customers.filter((c) => customerIds.includes(c.id));
  const created = []; const skipped = [];
  for (const c of customers) {
    if (get('SELECT 1 FROM invoices WHERE customer_id=? AND closing_date=?', c.id, closingDate)) { skipped.push({ customer: c.name, reason: 'この締め日の請求書は作成済み' }); continue; }
    const last = get('SELECT * FROM invoices WHERE customer_id=? ORDER BY closing_date DESC, id DESC LIMIT 1', c.id);
    if (last && last.closing_date > closingDate) { skipped.push({ customer: c.name, reason: 'より新しい締め日の請求書があります' }); continue; }
    const sales = all('SELECT * FROM sales WHERE customer_id=? AND invoice_id IS NULL AND sale_date<=? ORDER BY sale_date, id', c.id, closingDate);
    const prev = last ? last.total_amount : 0;
    const paid = get('SELECT COALESCE(SUM(amount + fee),0) AS a FROM payments WHERE customer_id=? AND pay_date>? AND pay_date<=?',
      c.id, last ? last.closing_date : '0000-00-00', closingDate).a;
    const carry = prev - paid;
    if (!sales.length && Math.abs(carry) < 1) { skipped.push({ customer: c.name, reason: '請求する売上がありません' }); continue; }
    const salesAmount = sales.reduce((a, x) => a + x.subtotal, 0);
    const tax = U.taxOf(salesAmount, s.tax_rate);
    const current = salesAmount + tax;
    const periodFrom = last ? U.addDays(last.closing_date, 1) : (sales[0] ? sales[0].sale_date : closingDate);
    const invId = insert('invoices', {
      no: nextNo('S', U.parseYmd(closingDate)), customer_id: c.id, closing_date: closingDate, period_from: periodFrom, period_to: closingDate,
      prev_amount: prev, paid_amount: paid, carry_amount: carry, sales_amount: salesAmount, tax_amount: tax, current_amount: current,
      total_amount: carry + current, due_date: U.dueDateOf(closingDate, c.pay_month_offset, c.pay_day), status: 'issued', token: U.token(24),
    });
    for (const x of sales) update('sales', x.id, { invoice_id: invId });
    created.push({ id: invId, customer: c.name, total: carry + current });
    autoAllocateCustomer(c.id);
  }
  return { created, skipped };
})();

// 取り消し（最新の請求書で、入金の消込が無いもののみ）
const deleteInvoice = (invId) => tx(() => {
  const inv = get('SELECT * FROM invoices WHERE id=?', invId);
  if (!inv) throw U.httpError(404, '請求書が見つかりません');
  const latest = get('SELECT id FROM invoices WHERE customer_id=? ORDER BY closing_date DESC, id DESC LIMIT 1', inv.customer_id);
  if (latest.id !== inv.id) throw U.httpError(400, '最新の請求書から順に取り消してください');
  run('DELETE FROM payment_allocations WHERE invoice_id=?', invId);
  run('UPDATE sales SET invoice_id=NULL WHERE invoice_id=?', invId);
  run('DELETE FROM invoices WHERE id=?', invId);
})();

async function sendInvoiceMail(invId) {
  const inv = get('SELECT i.*, c.name AS customer_name, c.email AS customer_email FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?', invId);
  if (!inv) throw U.httpError(404, '請求書が見つかりません');
  const s = getSettings();
  const to = customerMailTargets({ customer_email: inv.customer_email, customer_id: inv.customer_id });
  const body = `${inv.customer_name} 御中\n\nいつもお世話になっております。${s.company_name}です。\n${inv.closing_date} 締めの請求書をお送りいたします。\n\n請求番号：${inv.no}\n今回御請求額：${yen(inv.total_amount)}\nお支払期日：${inv.due_date || ''}\n\n▼ 請求書（PDF で保存・印刷できます）\n${baseUrl()}/doc/invoice/${inv.token}\n${s.bank_info ? `\nお振込先：${s.bank_info}\n` : ''}`;
  const r = await sendMail({ to, subject: `【請求書】${inv.closing_date} 締め ${s.company_name}`, body, related: `invoice:${inv.id}` });
  if (r.status === 'failed') throw U.httpError(400, `メールを送れませんでした: ${r.error}`);
  update('invoices', inv.id, { sent_at: U.now() });
  refreshInvoiceStatus(inv.id);
  return r;
}

// ---------- 入金 ----------
function paymentUnallocated(paymentId) {
  const p = get('SELECT * FROM payments WHERE id=?', paymentId);
  const a = get('SELECT COALESCE(SUM(amount),0) AS a FROM payment_allocations WHERE payment_id=?', paymentId).a;
  return (p.amount + (p.fee || 0)) - a;
}
// 未消込の入金を、古い請求書から順に充当
function autoAllocateCustomer(customerId) {
  const pays = all('SELECT id FROM payments WHERE customer_id=? ORDER BY pay_date, id', customerId);
  for (const p of pays) {
    let rest = paymentUnallocated(p.id);
    if (rest <= 0) continue;
    const invs = all('SELECT id FROM invoices WHERE customer_id=? ORDER BY closing_date, id', customerId);
    for (const i of invs) {
      if (rest <= 0) break;
      const { balance } = invoiceBalance(i.id);
      if (balance <= 0) continue;
      const amt = Math.min(balance, rest);
      insert('payment_allocations', { payment_id: p.id, invoice_id: i.id, amount: amt });
      rest -= amt;
      refreshInvoiceStatus(i.id);
    }
  }
}
const addPayment = (data, user) => tx(() => {
  const c = get('SELECT * FROM customers WHERE id=?', data.customer_id);
  if (!c) throw U.httpError(400, 'お客様を選んでください');
  const amount = U.toNum(data.amount);
  if (!amount) throw U.httpError(400, '入金額を入れてください');
  const id = insert('payments', {
    customer_id: c.id, pay_date: data.pay_date || U.ymd(), method: data.method || 'transfer', amount, fee: U.toNum(data.fee, 0),
    due_date: data.due_date || null, bill_no: data.bill_no || null, bill_status: ['bill', 'densai'].includes(data.method) ? 'holding' : null,
    note: data.note || null, created_by: user.id,
  });
  if (data.allocations && data.allocations.length) {
    let rest = amount + U.toNum(data.fee, 0);
    for (const a of data.allocations) {
      const amt = Math.min(U.toNum(a.amount), rest);
      if (amt <= 0) continue;
      const inv = get('SELECT * FROM invoices WHERE id=? AND customer_id=?', a.invoice_id, c.id);
      if (!inv) continue;
      insert('payment_allocations', { payment_id: id, invoice_id: inv.id, amount: amt });
      rest -= amt;
      refreshInvoiceStatus(inv.id);
    }
  } else if (data.auto !== false) {
    autoAllocateCustomer(c.id);
  }
  return id;
})();
const deletePayment = (id) => tx(() => {
  const invs = all('SELECT DISTINCT invoice_id FROM payment_allocations WHERE payment_id=?', id);
  run('DELETE FROM payments WHERE id=?', id);
  for (const i of invs) refreshInvoiceStatus(i.invoice_id);
})();

module.exports = {
  notify, orderDetail, orderAmount, createOrder, quoteToOrder, generatePOs, splitOrderItem, allocateFromStock, releaseStock,
  poDetail, sendPO, supplierAnswer, requestShip, supplierShipped, receivePO, cancelPO, notifyEta, notifyPrice,
  recordSale, recordReturn, refreshOrderStatus, cancelOrder, closeInvoices, deleteInvoice, sendInvoiceMail, invoiceBalance,
  refreshInvoiceStatus, addPayment, deletePayment, paymentUnallocated, autoAllocateCustomer, productFor, yen,
};
