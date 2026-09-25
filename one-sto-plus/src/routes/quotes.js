'use strict';
// 見積（AI読み取り・品目編集・掛率・版管理・見積分析）
const express = require('express');
const multer = require('multer');
const { all, get, run, tx, insert, update, getSettings, nextNo } = require('../db');
const U = require('../util');
const { scopeFilter } = require('../auth');
const S = require('../services');
const AI = require('../ai');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

const AMOUNT_SQL = `(SELECT COALESCE(SUM(qi.qty*qi.sell_price),0) FROM quote_items qi WHERE qi.quote_id=q.id)`;
const COST_SQL = `(SELECT COALESCE(SUM(qi.qty*qi.cost_price),0) FROM quote_items qi WHERE qi.quote_id=q.id)`;
const LATEST = ' AND q.version = (SELECT MAX(q2.version) FROM quotes q2 WHERE q2.group_no=q.group_no)';

r.get('/quotes', (req, res) => {
  const f = scopeFilter(req.user, req.query.scope, 'q');
  let sql = `SELECT q.*, c.name AS customer_name, u.name AS staff_name, b.name AS branch_name, p.name AS project_name,
    ${AMOUNT_SQL} AS amount, ${COST_SQL} AS cost, (SELECT COUNT(*) FROM quotes q3 WHERE q3.group_no=q.group_no) AS versions
    FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN users u ON u.id=q.staff_id LEFT JOIN branches b ON b.id=q.branch_id
    LEFT JOIN projects p ON p.id=q.project_id WHERE 1=1 ${f.sql}`;
  const p = [];
  if (req.query.all_versions !== '1') sql += LATEST;
  if (req.query.status) { sql += ' AND q.status=?'; p.push(req.query.status); }
  if (req.query.customer_id) { sql += ' AND q.customer_id=?'; p.push(req.query.customer_id); }
  if (req.query.staff_id) { sql += ' AND q.staff_id=?'; p.push(req.query.staff_id); }
  if (req.query.from) { sql += ' AND q.issue_date>=?'; p.push(req.query.from); }
  if (req.query.to) { sql += ' AND q.issue_date<=?'; p.push(req.query.to); }
  if (req.query.stale) { sql += " AND q.status IN ('draft','negotiating') AND q.updated_at < ?"; p.push(U.addDays(U.ymd(), -Number(req.query.stale)) + ' 23:59:59'); }
  if (req.query.q) { sql += ' AND (q.no LIKE ? OR q.title LIKE ? OR c.name LIKE ? OR q.site_name LIKE ?)'; p.push(...Array(4).fill(`%${req.query.q}%`)); }
  sql += ' ORDER BY q.updated_at DESC, q.id DESC LIMIT 500';
  res.json({ rows: all(sql, ...p), scope: f.scope });
});

function quoteDetail(id) {
  const q = get(`SELECT q.*, c.name AS customer_name, u.name AS staff_name, p.name AS project_name, o.no AS order_no
    FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN users u ON u.id=q.staff_id LEFT JOIN projects p ON p.id=q.project_id
    LEFT JOIN orders o ON o.id=q.order_id WHERE q.id=?`, id);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  q.items = all('SELECT qi.*, s.name AS supplier_name FROM quote_items qi LEFT JOIN suppliers s ON s.id=qi.supplier_id WHERE qi.quote_id=? ORDER BY qi.seq, qi.id', id);
  q.versions = all(`SELECT q.id, q.version, q.status, q.submitted, q.updated_at, ${AMOUNT_SQL} AS amount FROM quotes q WHERE q.group_no=? ORDER BY q.version`, q.group_no);
  return q;
}
r.get('/quotes/:id', (req, res) => res.json(quoteDetail(req.params.id)));

const HEAD = ['customer_id', 'project_id', 'site_name', 'title', 'staff_id', 'issue_date', 'valid_until', 'delivery_terms', 'payment_terms', 'note', 'show_set_detail'];
function cleanHead(b) {
  const o = U.pick(b, HEAD);
  for (const k of ['customer_id', 'project_id', 'staff_id']) if (k in o) o[k] = o[k] ? Number(o[k]) : null;
  if ('show_set_detail' in o) o.show_set_detail = o.show_set_detail ? 1 : 0;
  return o;
}
function saveItems(quoteId, items) {
  run('DELETE FROM quote_items WHERE quote_id=?', quoteId);
  (items || []).forEach((it, i) => {
    const list = U.toNum(it.list_price, 0);
    const sellRate = U.toNumOrNull(it.sell_rate);
    const costRate = U.toNumOrNull(it.cost_rate);
    let sell = U.toNumOrNull(it.sell_price);
    let cost = U.toNumOrNull(it.cost_price);
    if (sell == null && sellRate != null) sell = U.priceByRate(list, sellRate);
    if (cost == null && costRate != null) cost = U.priceByRate(list, costRate);
    insert('quote_items', {
      quote_id: quoteId, seq: i + 1, set_name: it.set_name || null, maker: it.maker || null, code: it.code || null, name: it.name || null,
      spec: it.spec || null, qty: U.toNum(it.qty, 1), unit: it.unit || null, list_price: list, cost_rate: costRate, cost_price: cost ?? 0,
      sell_rate: sellRate, sell_price: sell ?? 0, supplier_id: it.supplier_id ? Number(it.supplier_id) : null, uncertain: it.uncertain ? 1 : 0, note: it.note || null,
    });
  });
}

r.post('/quotes', (req, res) => {
  const s = getSettings();
  const id = tx(() => {
    const h = cleanHead(req.body);
    const no = nextNo('M');
    const staff = get('SELECT * FROM users WHERE id=?', h.staff_id || req.user.id);
    const today = U.ymd();
    const qid = insert('quotes', {
      issue_date: today, valid_until: U.addDays(today, Number(s.quote_valid_days) || 30), ...h,
      no, group_no: no, version: 1, staff_id: staff.id, branch_id: staff.branch_id, status: 'draft',
    });
    saveItems(qid, req.body.items);
    if (req.body.ai_read_ids) for (const aid of req.body.ai_read_ids) run('UPDATE ai_reads SET quote_id=? WHERE id=? AND quote_id IS NULL', qid, aid);
    return qid;
  })();
  res.json({ id });
});
r.put('/quotes/:id', (req, res) => {
  const q = get('SELECT * FROM quotes WHERE id=?', req.params.id);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  if (q.order_id) throw U.httpError(400, '受注済みの見積は編集できません。新しい版を作ってください');
  tx(() => {
    const h = cleanHead(req.body);
    if (h.staff_id) { const st = get('SELECT branch_id FROM users WHERE id=?', h.staff_id); h.branch_id = st?.branch_id ?? q.branch_id; }
    update('quotes', q.id, { ...h, updated_at: U.now() });
    if (req.body.items) saveItems(q.id, req.body.items);
    if (req.body.ai_read_ids) for (const aid of req.body.ai_read_ids) run('UPDATE ai_reads SET quote_id=? WHERE id=? AND quote_id IS NULL', q.id, aid);
  })();
  res.json({ ok: true });
});
// 新しい版を作る（元の版はそのまま残る）
r.post('/quotes/:id/version', (req, res) => {
  const q = quoteDetail(req.params.id);
  const id = tx(() => {
    const max = get('SELECT MAX(version) AS v FROM quotes WHERE group_no=?', q.group_no).v;
    const { id: _i, items, versions, customer_name, staff_name, project_name, order_no, ...rest } = q;
    const nid = insert('quotes', { ...rest, version: max + 1, status: q.status === 'won' ? 'negotiating' : q.status, submitted: 0, order_id: null, issue_date: U.ymd(), created_at: U.now(), updated_at: U.now() });
    saveItems(nid, items);
    return nid;
  })();
  res.json({ id });
});
// 複製（別の見積として）
r.post('/quotes/:id/copy', (req, res) => {
  const q = quoteDetail(req.params.id);
  const s = getSettings();
  const id = tx(() => {
    const no = nextNo('M');
    const nid = insert('quotes', {
      no, group_no: no, version: 1, customer_id: q.customer_id, project_id: q.project_id, site_name: q.site_name, title: `${q.title || ''}（複製）`,
      staff_id: req.user.id, branch_id: req.user.branch_id, status: 'draft', issue_date: U.ymd(), valid_until: U.addDays(U.ymd(), Number(s.quote_valid_days) || 30),
      delivery_terms: q.delivery_terms, payment_terms: q.payment_terms, note: q.note, show_set_detail: q.show_set_detail,
    });
    saveItems(nid, q.items);
    return nid;
  })();
  res.json({ id });
});
r.post('/quotes/:id/status', (req, res) => {
  const q = get('SELECT * FROM quotes WHERE id=?', req.params.id);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  const st = req.body.status;
  if (!['draft', 'negotiating', 'lost', 'won'].includes(st)) throw U.httpError(400, '状態が不正です');
  if (q.order_id && st !== 'won') throw U.httpError(400, '受注済みの見積です。受注を取り消してから変更してください');
  update('quotes', q.id, { status: st, lost_reason: st === 'lost' ? (req.body.lost_reason || null) : null, updated_at: U.now() });
  res.json({ ok: true });
});
r.post('/quotes/:id/submit', (req, res) => {
  const q = get('SELECT * FROM quotes WHERE id=?', req.params.id);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  tx(() => {
    run('UPDATE quotes SET submitted=0 WHERE group_no=?', q.group_no);
    update('quotes', q.id, { submitted: 1, status: q.status === 'draft' ? 'negotiating' : q.status, updated_at: U.now() });
  })();
  res.json({ ok: true });
});
r.post('/quotes/:id/order', (req, res) => res.json({ id: S.quoteToOrder(Number(req.params.id), req.user) }));
r.delete('/quotes/:id', (req, res) => {
  const q = get('SELECT * FROM quotes WHERE id=?', req.params.id);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  if (q.order_id) throw U.httpError(400, '受注済みの見積は削除できません');
  run('UPDATE ai_reads SET quote_id=NULL WHERE quote_id=?', q.id);
  run('DELETE FROM quotes WHERE id=?', q.id);
  res.json({ ok: true });
});

// 見積分析: 担当者別・得意先別・営業所別・日別
r.get('/quotes-analysis', (req, res) => {
  const group = req.query.group || 'staff';
  const from = req.query.from || U.addDays(U.ymd(), -90);
  const to = req.query.to || U.ymd();
  const f = scopeFilter(req.user, req.query.scope, 'q');
  const key = { staff: 'q.staff_id', customer: 'q.customer_id', branch: 'q.branch_id', day: 'q.issue_date', month: "substr(q.issue_date,1,7)" }[group];
  const label = { staff: 'u.name', customer: 'c.name', branch: 'b.name', day: 'q.issue_date', month: "substr(q.issue_date,1,7)" }[group];
  if (!key) throw U.httpError(400, '集計単位が不正です');
  const rows = all(`SELECT ${key} AS k, ${label} AS label, COUNT(*) AS cnt, SUM(${AMOUNT_SQL}) AS amount,
      SUM(q.status='won') AS won_cnt, SUM(CASE WHEN q.status='won' THEN ${AMOUNT_SQL} ELSE 0 END) AS won_amount,
      SUM(q.status='lost') AS lost_cnt, SUM(q.status IN ('draft','negotiating')) AS open_cnt,
      SUM(CASE WHEN q.status IN ('draft','negotiating') THEN ${AMOUNT_SQL} ELSE 0 END) AS open_amount,
      SUM(${AMOUNT_SQL} - ${COST_SQL}) AS gross
    FROM quotes q LEFT JOIN users u ON u.id=q.staff_id LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN branches b ON b.id=q.branch_id
    WHERE q.issue_date BETWEEN ? AND ? ${LATEST} ${f.sql} GROUP BY ${key} ORDER BY ${group === 'day' || group === 'month' ? 'k' : 'amount DESC'}`, from, to);
  const lostReasons = all(`SELECT COALESCE(NULLIF(q.lost_reason,''),'（理由未入力）') AS reason, COUNT(*) AS cnt FROM quotes q WHERE q.status='lost' AND q.issue_date BETWEEN ? AND ? ${LATEST} ${f.sql} GROUP BY reason ORDER BY cnt DESC`, from, to);
  res.json({ rows, lostReasons, from, to, group, scope: f.scope });
});

// ---- AI 読み取り ----
r.get('/ai/status', (req, res) => res.json({ enabled: AI.aiEnabled(), model: AI.MODEL }));
r.post('/ai/read', upload.array('files', 10), async (req, res) => {
  if (!req.files || !req.files.length) throw U.httpError(400, 'ファイルを選んでください');
  const results = [];
  for (const file of req.files) {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    try {
      const { pages, result } = await AI.readQuoteFile(file);
      const id = insert('ai_reads', { user_id: req.user.id, file_name: name, pages, status: 'ok', result_json: JSON.stringify(result) });
      results.push({ id, file_name: name, ok: true, pages, result });
    } catch (e) {
      if (e.status === 400 && /ANTHROPIC_API_KEY/.test(e.message)) throw e;
      insert('ai_reads', { user_id: req.user.id, file_name: name, pages: 0, status: 'failed', error: String(e.message || e) });
      results.push({ file_name: name, ok: false, error: String(e.message || e) });
    }
  }
  res.json({ results });
});
r.get('/ai/usage', (req, res) => {
  const s = getSettings();
  const rows = all(`SELECT substr(a.created_at,1,7) AS month, SUM(CASE WHEN a.status='ok' THEN a.pages ELSE 0 END) AS pages,
      SUM(a.status='ok') AS ok_cnt, SUM(a.status='failed') AS failed_cnt FROM ai_reads a GROUP BY month ORDER BY month DESC LIMIT 24`);
  const recent = all(`SELECT a.id, a.file_name, a.pages, a.status, a.error, a.created_at, a.quote_id, u.name AS user_name FROM ai_reads a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 50`);
  res.json({ rows, recent, price_per_page: Number(s.ai_price_per_page) || 0 });
});

module.exports = r;
