'use strict';
// 売上・請求・入金・会計CSV
const express = require('express');
const iconv = require('iconv-lite');
const { all, get, run, tx, update, getSettings } = require('../db');
const U = require('../util');
const { scopeFilter } = require('../auth');
const S = require('../services');

const r = express.Router();

// ---------- 売上 ----------
r.get('/sales', (req, res) => {
  const f = scopeFilter(req.user, req.query.scope, 's');
  let sql = `SELECT s.*, c.name AS customer_name, c.code AS customer_code, o.no AS order_no, i.no AS invoice_no, u.name AS staff_name
    FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN invoices i ON i.id=s.invoice_id
    LEFT JOIN users u ON u.id=s.staff_id WHERE 1=1 ${f.sql}`;
  const p = [];
  if (req.query.from) { sql += ' AND s.sale_date>=?'; p.push(req.query.from); }
  if (req.query.to) { sql += ' AND s.sale_date<=?'; p.push(req.query.to); }
  if (req.query.customer_id) { sql += ' AND s.customer_id=?'; p.push(req.query.customer_id); }
  if (req.query.kind) { sql += ' AND s.kind=?'; p.push(req.query.kind); }
  if (req.query.unbilled === '1') sql += ' AND s.invoice_id IS NULL';
  sql += ' ORDER BY s.sale_date DESC, s.id DESC LIMIT 1000';
  const rows = all(sql, ...p);
  res.json({ rows, total: rows.reduce((a, x) => a + x.subtotal, 0), scope: f.scope });
});
r.get('/sales/:id', (req, res) => {
  const s = get('SELECT s.*, c.name AS customer_name, o.no AS order_no FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN orders o ON o.id=s.order_id WHERE s.id=?', req.params.id);
  if (!s) throw U.httpError(404, '売上が見つかりません');
  s.items = all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', s.id);
  res.json(s);
});
r.delete('/sales/:id', (req, res) => {
  const s = get('SELECT * FROM sales WHERE id=?', req.params.id);
  if (!s) throw U.httpError(404, '売上が見つかりません');
  if (s.invoice_id) throw U.httpError(400, '請求済みの売上は取り消せません。請求書を取り消すか、返品で処理してください');
  tx(() => {
    for (const it of all('SELECT * FROM sale_items WHERE sale_id=?', s.id)) {
      if (!it.order_item_id) continue;
      const oi = get('SELECT * FROM order_items WHERE id=?', it.order_item_id);
      if (s.kind === 'return') update('order_items', oi.id, { returned_qty: Math.max(0, oi.returned_qty + it.qty) });
      else {
        const sold = Math.max(0, oi.sold_qty - it.qty);
        const st = oi.status === 'delivered' ? (oi.source === 'stock' ? 'answered' : (get("SELECT 1 FROM po_items pi JOIN purchase_orders p ON p.id=pi.po_id WHERE pi.order_item_id=? AND p.status='shipped'", oi.id) ? 'shipped' : 'answered')) : oi.status;
        update('order_items', oi.id, { sold_qty: sold, status: st });
      }
    }
    run('DELETE FROM sales WHERE id=?', s.id);
    if (s.order_id) S.refreshOrderStatus(s.order_id);
  })();
  res.json({ ok: true });
});

// ---------- 請求 ----------
r.get('/invoices', (req, res) => {
  let sql = `SELECT i.*, c.name AS customer_name, c.code AS customer_code, c.closing_day,
      (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.invoice_id=i.id) AS allocated
    FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE 1=1`;
  const p = [];
  if (req.query.closing_date) { sql += ' AND i.closing_date=?'; p.push(req.query.closing_date); }
  if (req.query.month) { sql += ' AND substr(i.closing_date,1,7)=?'; p.push(req.query.month); }
  if (req.query.customer_id) { sql += ' AND i.customer_id=?'; p.push(req.query.customer_id); }
  if (req.query.status) { sql += ' AND i.status=?'; p.push(req.query.status); }
  if (req.query.overdue === '1') { sql += " AND i.due_date < ? AND i.status IN ('issued','sent','partial') AND i.current_amount > 0"; p.push(U.ymd()); }
  if (req.query.q) { sql += ' AND (i.no LIKE ? OR c.name LIKE ?)'; p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  sql += ' ORDER BY i.closing_date DESC, c.code, i.id DESC LIMIT 1000';
  res.json({ rows: all(sql, ...p) });
});
r.get('/invoices/closing-preview', (req, res) => {
  const day = Number(req.query.closing_day || 31);
  const date = req.query.closing_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw U.httpError(400, '締め日を入れてください');
  const rows = all(`SELECT c.id, c.code, c.name, c.email,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id AND s.invoice_id IS NULL AND s.sale_date<=?) AS sale_cnt,
      (SELECT COALESCE(SUM(s.subtotal),0) FROM sales s WHERE s.customer_id=c.id AND s.invoice_id IS NULL AND s.sale_date<=?) AS sale_amount,
      (SELECT COUNT(*) FROM invoices i WHERE i.customer_id=c.id AND i.closing_date=?) AS done
    FROM customers c WHERE c.active=1 AND c.closing_day=? ORDER BY c.code`, date, date, date, day);
  // 締め日以前で、どの締めにも入っていない売上（締め日設定の違い等で取り残されたもの）
  const leftovers = all(`SELECT c.name, c.closing_day, COUNT(*) AS cnt, SUM(s.subtotal) AS amount FROM sales s JOIN customers c ON c.id=s.customer_id
    WHERE s.invoice_id IS NULL AND s.sale_date < ? GROUP BY c.id HAVING c.closing_day<>?`, U.addDays(date, -31), day);
  res.json({ rows, leftovers });
});
r.post('/invoices/close', (req, res) => {
  const { closing_date: date, closing_day: day, customer_ids: ids } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw U.httpError(400, '締め日を入れてください');
  res.json(S.closeInvoices(date, Number(day || 31), ids));
});
r.get('/invoices/:id', (req, res) => {
  const inv = get('SELECT i.*, c.name AS customer_name, c.code AS customer_code, c.email AS customer_email FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?', req.params.id);
  if (!inv) throw U.httpError(404, '請求書が見つかりません');
  inv.sales = all('SELECT s.*, o.no AS order_no FROM sales s LEFT JOIN orders o ON o.id=s.order_id WHERE s.invoice_id=? ORDER BY s.sale_date, s.id', inv.id);
  inv.allocations = all('SELECT a.*, p.pay_date, p.method FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.invoice_id=? ORDER BY p.pay_date', inv.id);
  inv.balance = S.invoiceBalance(inv.id).balance;
  inv.mails = all('SELECT id, to_addr, subject, status, created_at FROM mails WHERE related=? ORDER BY id DESC', `invoice:${inv.id}`);
  res.json(inv);
});
r.post('/invoices/:id/send', async (req, res) => res.json(await S.sendInvoiceMail(Number(req.params.id))));
r.post('/invoices/send-bulk', async (req, res) => {
  const results = [];
  for (const id of req.body.ids || []) { try { await S.sendInvoiceMail(Number(id)); results.push({ id, ok: true }); } catch (e) { results.push({ id, ok: false, error: e.message }); } }
  res.json({ results });
});
r.delete('/invoices/:id', (req, res) => { S.deleteInvoice(Number(req.params.id)); res.json({ ok: true }); });

// ---------- 入金 ----------
r.get('/payments', (req, res) => {
  let sql = `SELECT p.*, c.name AS customer_name, c.code AS customer_code,
      (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.payment_id=p.id) AS allocated
    FROM payments p JOIN customers c ON c.id=p.customer_id WHERE 1=1`;
  const q = [];
  if (req.query.from) { sql += ' AND p.pay_date>=?'; q.push(req.query.from); }
  if (req.query.to) { sql += ' AND p.pay_date<=?'; q.push(req.query.to); }
  if (req.query.customer_id) { sql += ' AND p.customer_id=?'; q.push(req.query.customer_id); }
  if (req.query.method) { sql += ' AND p.method=?'; q.push(req.query.method); }
  if (req.query.unallocated === '1') sql += ' AND (p.amount + p.fee) > (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.payment_id=p.id)';
  sql += ' ORDER BY p.pay_date DESC, p.id DESC LIMIT 1000';
  res.json({ rows: all(sql, ...q) });
});
r.post('/payments', (req, res) => res.json({ id: S.addPayment(req.body, req.user) }));
r.delete('/payments/:id', (req, res) => { S.deletePayment(Number(req.params.id)); res.json({ ok: true }); });
r.get('/payments/:id', (req, res) => {
  const p = get('SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=?', req.params.id);
  if (!p) throw U.httpError(404, '入金が見つかりません');
  p.allocations = all('SELECT a.*, i.no AS invoice_no, i.closing_date FROM payment_allocations a JOIN invoices i ON i.id=a.invoice_id WHERE a.payment_id=?', p.id);
  p.unallocated = S.paymentUnallocated(p.id);
  p.open_invoices = all(`SELECT i.id, i.no, i.closing_date, i.current_amount, i.current_amount - (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.invoice_id=i.id) AS balance
    FROM invoices i WHERE i.customer_id=? ORDER BY i.closing_date`, p.customer_id).filter((i) => i.balance > 0);
  res.json(p);
});
r.post('/payments/:id/allocate', (req, res) => {
  const p = get('SELECT * FROM payments WHERE id=?', req.params.id);
  const inv = get('SELECT * FROM invoices WHERE id=? AND customer_id=?', req.body.invoice_id, p?.customer_id);
  if (!p || !inv) throw U.httpError(404, '入金または請求書が見つかりません');
  const amt = Math.min(U.toNum(req.body.amount), S.paymentUnallocated(p.id), S.invoiceBalance(inv.id).balance);
  if (amt <= 0) throw U.httpError(400, '消し込める金額がありません');
  tx(() => { run('INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?,?,?)', p.id, inv.id, amt); S.refreshInvoiceStatus(inv.id); })();
  res.json({ ok: true, amount: amt });
});
r.post('/payments/:id/auto-allocate', (req, res) => {
  const p = get('SELECT * FROM payments WHERE id=?', req.params.id);
  if (!p) throw U.httpError(404, '入金が見つかりません');
  tx(() => S.autoAllocateCustomer(p.customer_id))();
  res.json({ ok: true });
});
r.delete('/allocations/:id', (req, res) => {
  const a = get('SELECT * FROM payment_allocations WHERE id=?', req.params.id);
  if (!a) throw U.httpError(404, '消込が見つかりません');
  tx(() => { run('DELETE FROM payment_allocations WHERE id=?', a.id); S.refreshInvoiceStatus(a.invoice_id); })();
  res.json({ ok: true });
});
// 手形・でんさいの期日管理
r.get('/bills', (req, res) => {
  res.json({ rows: all(`SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id=p.customer_id
    WHERE p.method IN ('bill','densai') ${req.query.all === '1' ? '' : "AND COALESCE(p.bill_status,'holding')='holding'"} ORDER BY p.due_date, p.id`) });
});
r.post('/payments/:id/settle', (req, res) => { update('payments', req.params.id, { bill_status: req.body.undo ? 'holding' : 'settled' }); res.json({ ok: true }); });

// 売掛残高（得意先別）
r.get('/receivables', (req, res) => {
  const rows = all(`SELECT c.id, c.code, c.name, c.closing_day,
      (SELECT COALESCE(SUM(i.current_amount),0) FROM invoices i WHERE i.customer_id=c.id) AS invoiced,
      (SELECT COALESCE(SUM(p.amount + p.fee),0) FROM payments p WHERE p.customer_id=c.id) AS paid,
      (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id=c.id AND s.invoice_id IS NULL) AS unbilled,
      (SELECT COALESCE(SUM(p.amount + p.fee),0) - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p2 ON p2.id=a.payment_id WHERE p2.customer_id=c.id),0) FROM payments p WHERE p.customer_id=c.id) AS unallocated,
      (SELECT COALESCE(SUM(i.current_amount - (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.invoice_id=i.id)),0) FROM invoices i WHERE i.customer_id=c.id AND i.due_date < ? ) AS overdue
    FROM customers c WHERE c.active=1 ORDER BY c.code`, U.ymd());
  res.json({ rows: rows.filter((x) => x.invoiced || x.paid || x.unbilled).map((x) => ({ ...x, balance: x.invoiced - x.paid })) });
});

// ---------- 会計ソフト向けCSV ----------
const CSV_COLUMNS = {
  date: { label: '伝票日付' }, slip_no: { label: '伝票番号' }, customer_code: { label: '得意先コード' }, customer_name: { label: '得意先名' },
  debit: { label: '借方勘定科目' }, credit: { label: '貸方勘定科目' }, amount: { label: '金額（税抜）' }, tax: { label: '消費税額' },
  total: { label: '金額（税込）' }, tax_rate: { label: '税率' }, memo: { label: '摘要' }, invoice_no: { label: '請求書番号' },
  staff_name: { label: '担当者' }, kind: { label: '区分' }, order_no: { label: '受注番号' },
};
r.get('/export/columns', (req, res) => res.json(Object.entries(CSV_COLUMNS).map(([key, v]) => ({ key, label: v.label }))));
r.get('/export/accounting', (req, res) => {
  const s = getSettings();
  const cols = (() => { try { return JSON.parse(s.csv_columns); } catch (_) { return Object.keys(CSV_COLUMNS); } })().filter((c) => CSV_COLUMNS[c]);
  const type = req.query.type || 'invoices';
  const from = req.query.from || '0000-00-00'; const to = req.query.to || '9999-12-31';
  let rows = [];
  if (type === 'sales') {
    rows = all(`SELECT s.*, c.code AS customer_code, c.name AS customer_name, u.name AS staff_name, i.no AS invoice_no, o.no AS order_no FROM sales s
      JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.staff_id LEFT JOIN invoices i ON i.id=s.invoice_id LEFT JOIN orders o ON o.id=s.order_id
      WHERE s.sale_date BETWEEN ? AND ? ORDER BY s.sale_date, s.id`, from, to).map((x) => ({
      date: x.sale_date, slip_no: x.no, customer_code: x.customer_code, customer_name: x.customer_name, debit: s.csv_debit, credit: s.csv_credit,
      amount: x.subtotal, tax: x.tax, total: x.total, tax_rate: `${s.tax_rate}%`, memo: x.kind === 'return' ? `返品 ${x.order_no || ''}` : `売上 ${x.order_no || ''}`,
      invoice_no: x.invoice_no, staff_name: x.staff_name, kind: x.kind === 'return' ? '返品' : '売上', order_no: x.order_no,
    }));
  } else if (type === 'payments') {
    rows = all(`SELECT p.*, c.code AS customer_code, c.name AS customer_name FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.pay_date BETWEEN ? AND ? ORDER BY p.pay_date, p.id`, from, to).map((x) => ({
      date: x.pay_date, slip_no: `P${x.id}`, customer_code: x.customer_code, customer_name: x.customer_name,
      debit: { transfer: '普通預金', cash: '現金', bill: '受取手形', densai: '電子記録債権', offset: '買掛金', other: '雑収入' }[x.method] || '普通預金',
      credit: s.csv_debit, amount: x.amount, tax: 0, total: x.amount, tax_rate: '', memo: `入金 ${x.note || ''}`.trim(), invoice_no: '', staff_name: '', kind: '入金', order_no: '',
    }));
  } else {
    rows = all(`SELECT i.*, c.code AS customer_code, c.name AS customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.closing_date BETWEEN ? AND ? ORDER BY i.closing_date, c.code`, from, to).map((x) => ({
      date: x.closing_date, slip_no: x.no, customer_code: x.customer_code, customer_name: x.customer_name, debit: s.csv_debit, credit: s.csv_credit,
      amount: x.sales_amount, tax: x.tax_amount, total: x.current_amount, tax_rate: `${s.tax_rate}%`, memo: `${x.period_from}〜${x.period_to} 請求`, invoice_no: x.no, staff_name: '', kind: '請求', order_no: '',
    }));
  }
  const csv = U.toCsv([cols.map((c) => CSV_COLUMNS[c].label), ...rows.map((x) => cols.map((c) => x[c]))]);
  const fname = `accounting_${type}_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}.csv`;
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  if (s.csv_encoding === 'sjis') { res.setHeader('Content-Type', 'text/csv; charset=Shift_JIS'); res.send(iconv.encode(csv, 'Shift_JIS')); }
  else { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.send('﻿' + csv); }
});

module.exports = r;
