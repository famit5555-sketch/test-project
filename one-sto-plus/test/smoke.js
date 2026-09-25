'use strict';
// 通しテスト: 見積 → 受注 → 発注 → 仕入先回答 → 納期連絡 → 出荷 → 売上 → 請求 → 入金、
// お客様ポータル・現場QR・取消依頼・予算・帳票・会計CSV を一時データベースで確認する。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osp-test-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'test-admin-pw';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SMTP_HOST;

const app = require('../server');
const { get, all } = require('../src/db');

let base;
const jar = {};
async function call(who, method, url, body) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (jar[who]) headers.Cookie = jar[who];
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) jar[who] = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (res.status >= 400) { const e = new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`); e.status = res.status; e.data = data; throw e; }
  return data;
}
const S = (m, u, b) => call('staff', m, u, b);
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }

(async () => {
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    await step('ログインできない（誤パスワード）', async () => {
      await assert.rejects(S('POST', '/api/login', { login: 'admin', password: 'x' }), (e) => e.status === 401);
    });
    await step('管理者でログイン', async () => { await S('POST', '/api/login', { login: 'admin', password: 'test-admin-pw' }); const me = await S('GET', '/api/me'); assert.equal(me.user.role, 'admin'); });
    await step('フォーム送信（JSON以外）は拒否', async () => {
      const r = await fetch(base + '/api/m/customers', { method: 'POST', headers: { Cookie: jar.staff, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x' });
      assert.equal(r.status, 415);
    });
    const lk = await S('GET', '/api/lookups');
    const cust = lk.customers.find((c) => c.code === 'K001');

    let quoteId, orderId;
    await step('見積を作成（掛率から単価を計算）', async () => {
      const rate = await S('POST', '/api/rates/lookup-bulk', { customer_id: cust.id, items: [{ code: 'CS-230B' }, { code: 'LDSWB-075' }] });
      assert.equal(rate[0].sell_rate, 0.52); // 得意先×メーカー
      assert.equal(rate[1].sell_rate, 0.50); // 得意先×メーカー×値引きコードC
      const p = rate[0].product;
      const r = await S('POST', '/api/quotes', { customer_id: cust.id, title: 'テスト見積', items: [
        { maker: 'TOTO', code: 'CS-230B', name: '便器', qty: 2, unit: '台', list_price: p.list_price, sell_rate: 0.52, cost_rate: 0.4, supplier_id: p.supplier_id, set_name: 'トイレセット' },
        { maker: 'TOTO', code: 'TCF-8GM', name: '便座', qty: 2, unit: '台', list_price: 88000, sell_rate: 0.52, cost_rate: 0.4, supplier_id: p.supplier_id, set_name: 'トイレセット' },
        { maker: '汎用', code: 'ST-100', name: '止水栓', qty: 4, list_price: 3800, sell_price: 3000, cost_price: 2090 },
        { code: 'X-999', name: '特注品（マスター外）', qty: 1, sell_price: 1000 } ] });
      quoteId = r.id;
      const q = await S('GET', `/api/quotes/${quoteId}`);
      assert.equal(q.items[0].sell_price, Math.floor(41800 * 0.52));
      assert.equal(q.items[1].cost_price, Math.floor(88000 * 0.4));
    });
    await step('御見積書（セットは1行）', async () => {
      const html = await S('GET', `/doc/quote/${quoteId}`);
      assert.match(html, /御見積書/); assert.match(html, /トイレセット/);
    });
    await step('版管理（新しい版・提出版）', async () => {
      const v = await S('POST', `/api/quotes/${quoteId}/version`, {});
      await S('POST', `/api/quotes/${v.id}/submit`, {});
      const q = await S('GET', `/api/quotes/${v.id}`);
      assert.equal(q.version, 2); assert.equal(q.versions.length, 2); assert.equal(q.submitted, 1);
      quoteId = v.id;
    });
    await step('見積から受注（1操作）', async () => {
      orderId = (await S('POST', `/api/quotes/${quoteId}/order`, {})).id;
      const o = await S('GET', `/api/orders/${orderId}`);
      assert.equal(o.items.length, 4); assert.equal(o.source, 'quote');
      assert.equal((await S('GET', `/api/quotes/${quoteId}`)).status, 'won');
    });
    await step('受注済みの見積は二重に受注できない', async () => { await assert.rejects(S('POST', `/api/quotes/${quoteId}/order`, {}), (e) => e.status === 400); });
    await step('仕入先の無い明細があると発注できない → その明細を取消', async () => {
      await assert.rejects(S('POST', `/api/orders/${orderId}/generate-po`, {}), /仕入先が決まっていない/);
      const o = await S('GET', `/api/orders/${orderId}`);
      await S('POST', `/api/order-items/${o.items.find((i) => i.code === 'X-999').id}/cancel`, {});
    });
    let stockItem;
    await step('自社在庫から引当', async () => {
      const o = await S('GET', `/api/orders/${orderId}`);
      stockItem = o.items.find((i) => i.code === 'ST-100');
      const before = get('SELECT stock_qty FROM products WHERE code=?', 'ST-100').stock_qty;
      await S('POST', `/api/order-items/${stockItem.id}/stock`, {});
      assert.equal(get('SELECT stock_qty FROM products WHERE code=?', 'ST-100').stock_qty, before - 4);
    });
    let poId, token;
    await step('数量の分割と、仕入先ごとの発注・送信', async () => {
      const o = await S('GET', `/api/orders/${orderId}`);
      const it = o.items.find((i) => i.code === 'CS-230B');
      await S('POST', `/api/order-items/${it.id}/split`, { qty: 1 });
      const o2 = await S('GET', `/api/orders/${orderId}`);
      const split = o2.items.filter((i) => i.code === 'CS-230B');
      assert.equal(split.length, 2);
      const other = lk.suppliers.find((s) => s.name.includes('中部'));
      await S('PUT', `/api/orders/${orderId}`, { items: o2.items.map((x) => (x.id === split[1].id ? { ...x, supplier_id: other.id } : x)) });
      const r = await S('POST', `/api/orders/${orderId}/order-and-send`, {});
      assert.equal(r.ids.length, 2); assert.deepEqual(r.errors, []);
      poId = r.ids[0];
      const po = await S('GET', `/api/purchases/${poId}`);
      assert.equal(po.status, 'sent'); token = po.token;
      assert.ok(get("SELECT 1 FROM mails WHERE related=? AND subject LIKE '【発注】%'", `po:${poId}`));
    });
    await step('仕入先がログインなしで回答 → 受注に反映・担当者へ通知', async () => {
      const page = await call('sup', 'GET', `/sapi/${token}`);
      assert.ok(page.items.length > 0);
      const eta = '2026-12-01';
      await call('sup', 'POST', `/sapi/${token}/answer`, { items: page.items.map((i) => ({ id: i.id, answer_date: eta, answer_price: 15000 })), comment: '了解です', shipping_fee: 1200 });
      const o = await S('GET', `/api/orders/${orderId}`);
      const ans = o.items.filter((i) => i.po_id === poId);
      assert.ok(ans.every((i) => i.eta_date === eta && i.status === 'answered' && i.cost_price === 15000));
      assert.ok(get("SELECT 1 FROM notifications WHERE message LIKE '%回答が届きました%'"));
      await assert.rejects(call('sup', 'GET', '/sapi/wrong-token'), (e) => e.status === 404);
    });
    await step('もう一方の発注は社内で代理入力', async () => {
      const o = await S('GET', `/api/orders/${orderId}`);
      const other = o.pos.find((p) => p.id !== poId);
      const po = await S('GET', `/api/purchases/${other.id}`);
      await S('POST', `/api/purchases/${other.id}/answer`, { items: po.items.map((i) => ({ id: i.id, answer_date: '2026-12-03', answer_price: i.cost_price })) });
    });
    await step('お客様へ納期をメール', async () => {
      await S('POST', `/api/orders/${orderId}/notify-eta`, {});
      assert.ok((await S('GET', `/api/orders/${orderId}`)).eta_notified_at);
    });
    await step('出荷指示 → 仕入先が出荷連絡', async () => {
      await S('POST', `/api/purchases/${poId}/ship-request`, { note: '現場直送でお願いします' });
      await call('sup', 'POST', `/sapi/${token}/shipped`, { shipped_date: '2026-11-30', tracking_no: 'T-1' });
      const o = await S('GET', `/api/orders/${orderId}`);
      assert.ok(o.pos.find((p) => p.id === poId).status === 'shipped');
    });
    let saleId;
    await step('売上計上（一部）と納品書', async () => {
      const o = await S('GET', `/api/orders/${orderId}`);
      const items = o.items.filter((i) => i.status === 'shipped' || i.source === 'stock').map((i) => ({ order_item_id: i.id, qty: i.qty }));
      await assert.rejects(S('POST', `/api/orders/${orderId}/sale`, { items: [{ order_item_id: items[0].order_item_id, qty: 999 }] }), /超えています/);
      saleId = (await S('POST', `/api/orders/${orderId}/sale`, { sale_date: '2026-12-05', items })).id;
      assert.match(await S('GET', `/doc/delivery/${saleId}`), /納品書/);
    });
    await step('残りを計上して受注が完了', async () => {
      const o = await S('GET', `/api/orders/${orderId}`);
      const rest = o.items.filter((i) => i.sold_qty < i.qty && i.status !== 'cancelled');
      await S('POST', `/api/purchases/${o.pos.find((p) => p.id !== poId).id}/shipped`, { shipped_date: '2026-12-03' });
      await S('POST', `/api/orders/${orderId}/sale`, { sale_date: '2026-12-06', items: rest.map((i) => ({ order_item_id: i.id, qty: i.qty })) });
      assert.equal((await S('GET', `/api/orders/${orderId}`)).status, 'completed');
    });
    await step('返品（赤伝）', async () => {
      const o = await S('GET', `/api/orders/${orderId}`);
      const it = o.items.find((i) => i.code === 'ST-100');
      const r = await S('POST', `/api/orders/${orderId}/return`, { sale_date: '2026-12-10', items: [{ order_item_id: it.id, qty: 1 }], restock: true });
      const s = await S('GET', `/api/sales/${r.id}`);
      assert.equal(s.kind, 'return'); assert.ok(s.subtotal < 0);
    });
    let invId;
    await step('締めて請求書を作る（二重請求しない）', async () => {
      const unbilled = all('SELECT SUM(subtotal) AS s FROM sales WHERE customer_id=? AND invoice_id IS NULL AND sale_date<=?', cust.id, '2026-12-31')[0].s;
      const r = await S('POST', '/api/invoices/close', { closing_date: '2026-12-31', closing_day: 31, customer_ids: [cust.id] });
      assert.equal(r.created.length, 1); invId = r.created[0].id;
      const inv = await S('GET', `/api/invoices/${invId}`);
      assert.equal(inv.sales_amount, unbilled);
      assert.equal(inv.tax_amount, Math.floor(unbilled * 0.1));
      assert.ok(inv.sales.some((s) => s.kind === 'return'));
      const again = await S('POST', '/api/invoices/close', { closing_date: '2026-12-31', closing_day: 31, customer_ids: [cust.id] });
      assert.equal(again.created.length, 0);
      const html = await call('anon', 'GET', `/doc/invoice/${inv.token}`);
      assert.match(html, /請求書/); assert.match(html, /T1234567890123/);
      await S('POST', `/api/invoices/${invId}/send`, {});
    });
    await step('入金を請求書に消込、過入金が残る', async () => {
      const inv = await S('GET', `/api/invoices/${invId}`);
      const p = await S('POST', '/api/payments', { customer_id: cust.id, pay_date: '2027-01-31', method: 'transfer', amount: inv.balance + 5000, fee: 0, allocations: [{ invoice_id: invId, amount: inv.balance }] });
      const inv2 = await S('GET', `/api/invoices/${invId}`);
      assert.equal(inv2.status, 'paid'); assert.equal(inv2.balance, 0);
      const pay = await S('GET', `/api/payments/${p.id}`);
      assert.equal(pay.unallocated, 5000);
    });
    await step('手形の期日管理', async () => {
      const p = await S('POST', '/api/payments', { customer_id: cust.id, pay_date: '2027-02-01', method: 'bill', amount: 10000, due_date: '2027-05-01' });
      const bills = await S('GET', '/api/bills');
      assert.ok(bills.rows.some((b) => b.id === p.id));
      await S('POST', `/api/payments/${p.id}/settle`, {});
    });
    await step('会計CSV（Shift_JIS）', async () => {
      const r = await fetch(`${base}/api/export/accounting?type=invoices&from=2026-12-01&to=2026-12-31`, { headers: { Cookie: jar.staff } });
      assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /Shift_JIS/);
      const text = require('iconv-lite').decode(Buffer.from(await r.arrayBuffer()), 'Shift_JIS');
      assert.match(text, /伝票日付/); assert.match(text, /株式会社ミライ工務店/);
    });

    // ---- お客様ポータル ----
    const C = (m, u, b) => call('cust', m, u, b);
    let portalOrder;
    await step('ポータル: ログインして注文（価格は未定）', async () => {
      await assert.rejects(C('GET', '/papi/me'), (e) => e.status === 401);
      await C('POST', '/papi/login', { login: 'mirai', password: 'demo1234' });
      const me = await C('GET', '/papi/me');
      assert.equal(me.customer.name, '株式会社ミライ工務店');
      const sites = await C('GET', '/papi/sites');
      const r = await C('POST', '/papi/orders', { site_id: sites[0].id, items: [{ code: 'PV-13', qty: 10 }, { code: 'NOT-IN-MASTER', qty: 1 }], note: 'テスト' });
      portalOrder = r.id;
      const o = await C('GET', `/papi/orders/${r.id}`);
      assert.equal(o.price_confirmed, 0); assert.equal(o.amount, null);
      assert.ok(o.items.every((i) => i.sell_price === null));
    });
    await step('ポータル: 他社の注文は見えない', async () => {
      const other = get('SELECT id FROM orders WHERE customer_id<>? LIMIT 1', cust.id);
      await assert.rejects(C('GET', `/papi/orders/${other.id}`), (e) => e.status === 404);
    });
    await step('社内: 売単価を一括登録して価格を回答 → ポータルに表示', async () => {
      await S('POST', `/api/orders/${portalOrder}/prices`, { rate: 80, items: [] });
      const o = await S('GET', `/api/orders/${portalOrder}`);
      const un = o.items.find((i) => i.code === 'NOT-IN-MASTER');
      await S('POST', `/api/orders/${portalOrder}/prices`, { items: [{ id: un.id, sell_price: 500 }] });
      await S('POST', `/api/orders/${portalOrder}/notify-price`, {});
      const po = await C('GET', `/papi/orders/${portalOrder}`);
      assert.equal(po.price_confirmed, 1); assert.ok(po.amount > 0);
    });
    await step('ポータル: 取消を依頼 → 社内で承認 → 受注取消', async () => {
      await C('POST', `/papi/orders/${portalOrder}/request`, { kind: 'cancel', message: '不要になりました' });
      const o = await S('GET', `/api/orders/${portalOrder}`);
      const cr = o.requests.find((x) => x.status === 'pending');
      await S('POST', `/api/change-requests/${cr.id}/decide`, { approve: true, reply: '承知しました' });
      assert.equal((await S('GET', `/api/orders/${portalOrder}`)).status, 'cancelled');
    });
    await step('現場QR: ログインなしで注文', async () => {
      const site = get("SELECT qr_token FROM sites WHERE qr_token='demo-site-a'");
      const info = await call('qr', 'GET', `/qapi/${site.qr_token}`);
      assert.ok(info.site.name);
      const r = await call('qr', 'POST', `/qapi/${site.qr_token}/order`, { orderer_name: '職人 山田', items: [{ code: 'FH-20', qty: 3 }] });
      assert.match(r.no, /^J-/);
      assert.ok(get("SELECT 1 FROM orders WHERE source='qr' AND orderer_name LIKE '職人 山田%'"));
      await assert.rejects(call('qr', 'GET', '/qapi/bad-token'), (e) => e.status === 404);
    });

    // ---- 予算 ----
    await step('予算: 配分入力と達成率', async () => {
      const meta = await S('GET', '/api/budget/meta');
      const inp = await S('GET', `/api/budget/input?level=company&fy=${meta.fy}`);
      assert.ok(inp.can_edit_children);
      const b = inp.children[0];
      await S('PUT', '/api/budget', { fy: meta.fy, level: b.level, node_id: b.id, months: Array(12).fill(1000000) });
      const again = await S('GET', `/api/budget/input?level=company&fy=${meta.fy}`);
      assert.equal(again.children[0].months[0], 1000000);
      const pr = await S('GET', `/api/budget/progress?level=company&fy=${meta.fy}`);
      assert.ok(pr.self.budget > 0); assert.equal(pr.self.actual_months.length, 12);
    });
    await step('予算: 一般社員は自分に配られた額を変えられない', async () => {
      await call('gen', 'POST', '/api/login', { login: 'suzuki', password: 'demo1234' });
      const meta = await call('gen', 'GET', '/api/budget/meta');
      const me = await call('gen', 'GET', '/api/me');
      await assert.rejects(call('gen', 'PUT', '/api/budget', { fy: meta.fy, level: 'user', node_id: me.user.id, months: Array(12).fill(1) }), (e) => e.status === 403);
      const custOfMe = get('SELECT id FROM customers WHERE staff_id=? LIMIT 1', me.user.id);
      await call('gen', 'PUT', '/api/budget', { fy: meta.fy, level: 'customer', node_id: custOfMe.id, months: Array(12).fill(100000) });
      await assert.rejects(call('gen', 'PUT', '/api/settings', { company_name: 'x' }), (e) => e.status === 403);
      const xl = await fetch(`${base}/api/budget/export?level=user&node_id=${me.user.id}&fy=${meta.fy}&format=xlsx`, { headers: { Cookie: jar.gen } });
      assert.equal(xl.status, 200);
    });
    await step('ダッシュボード・見積分析・カレンダー', async () => {
      const d = await S('GET', '/api/dashboard?scope=all');
      assert.ok(d.todo.length >= 6);
      const a = await S('GET', '/api/quotes-analysis?group=staff&from=2000-01-01&to=2099-12-31&scope=all');
      assert.ok(a.rows.length > 0);
      const c = await S('GET', '/api/calendar?month=2026-12');
      assert.ok(c.events.length > 0);
    });
    await step('AI読み取り: キー未設定なら分かるエラー', async () => {
      const fd = new FormData(); fd.append('files', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'a.pdf');
      const r = await fetch(`${base}/api/ai/read`, { method: 'POST', headers: { Cookie: jar.staff, 'X-Requested-With': 'fetch' }, body: fd });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);
    });
    console.log(`\nすべて成功しました（${passed}項目）`);
  } catch (e) {
    console.error('\n失敗:', e.stack || e);
    process.exitCode = 1;
  } finally {
    server.close();
    try { require('../src/db').db.close(); } catch (_) { /* noop */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
