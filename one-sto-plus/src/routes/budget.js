'use strict';
// 予算管理: 全社 → 営業所 → 部署 → 担当者 → 得意先 へ目標を配り、達成率を見る
const express = require('express');
const XLSX = require('xlsx');
const { all, get, run, tx, getSettings } = require('../db');
const U = require('../util');

const r = express.Router();
const LEVELS = ['company', 'branch', 'department', 'user', 'customer'];
const LABEL = { company: '全社', branch: '営業所', department: '部署', user: '担当者', customer: '得意先' };
const childLevel = (lv) => LEVELS[LEVELS.indexOf(lv) + 1] || null;

function nodeName(level, id) {
  if (level === 'company') return getSettings().company_name || '全社';
  const t = { branch: 'branches', department: 'departments', user: 'users', customer: 'customers' }[level];
  return get(`SELECT name FROM ${t} WHERE id=?`, id)?.name || '（不明）';
}
function children(level, id) {
  switch (level) {
    case 'company': return all('SELECT id, name FROM branches WHERE active=1 ORDER BY sort, id').map((x) => ({ level: 'branch', ...x }));
    case 'branch': return all('SELECT id, name FROM departments WHERE active=1 AND branch_id=? ORDER BY id', id).map((x) => ({ level: 'department', ...x }));
    case 'department': return all('SELECT id, name FROM users WHERE active=1 AND department_id=? ORDER BY id', id).map((x) => ({ level: 'user', ...x }));
    case 'user': return all('SELECT id, name, code FROM customers WHERE active=1 AND staff_id=? ORDER BY code, id', id).map((x) => ({ level: 'customer', ...x }));
    default: return [];
  }
}
function parentOf(level, id) {
  switch (level) {
    case 'branch': return { level: 'company', id: 0 };
    case 'department': { const d = get('SELECT branch_id FROM departments WHERE id=?', id); return d ? { level: 'branch', id: d.branch_id } : null; }
    case 'user': { const u = get('SELECT department_id FROM users WHERE id=?', id); return u?.department_id ? { level: 'department', id: u.department_id } : null; }
    case 'customer': { const c = get('SELECT staff_id FROM customers WHERE id=?', id); return c?.staff_id ? { level: 'user', id: c.staff_id } : null; }
    default: return null;
  }
}
function path(level, id) {
  const res = [{ level, id, name: nodeName(level, id) }];
  let p = parentOf(level, id);
  while (p) { res.unshift({ ...p, name: nodeName(p.level, p.id) }); p = parentOf(p.level, p.id); }
  return res;
}
// 配下への配分を入力できるか
function canAllocate(user, level, id) {
  if (user.role === 'admin') return true;
  if (level === 'company') return false;
  if (user.role === 'manager') {
    if (level === 'branch') return id === user.branch_id;
    if (level === 'department') return get('SELECT branch_id FROM departments WHERE id=?', id)?.branch_id === user.branch_id;
    if (level === 'user') return get('SELECT branch_id FROM users WHERE id=?', id)?.branch_id === user.branch_id;
    return false;
  }
  return level === 'user' && id === user.id;
}
function canView(user, level, id) {
  if (user.role === 'admin' || user.view_scope === 'all') return true;
  const p = path(level, id);
  if (user.role === 'manager' || user.view_scope === 'branch') return p.some((n) => n.level === 'branch' && n.id === user.branch_id);
  return p.some((n) => n.level === 'user' && n.id === user.id);
}

function months(fy, level, id) {
  const b = get('SELECT months FROM budgets WHERE fy=? AND level=? AND node_id=?', fy, level, id);
  try { return b ? JSON.parse(b.months) : Array(12).fill(0); } catch (_) { return Array(12).fill(0); }
}
function statusOf(fy, level, id) { return get('SELECT * FROM budget_status WHERE fy=? AND level=? AND node_id=?', fy, level, id) || { status: 'draft' }; }

function custFilter(level, id) {
  switch (level) {
    case 'company': return { sql: '1=1', p: [] };
    case 'branch': return { sql: 'c.staff_id IN (SELECT id FROM users WHERE branch_id=?)', p: [id] };
    case 'department': return { sql: 'c.staff_id IN (SELECT id FROM users WHERE department_id=?)', p: [id] };
    case 'user': return { sql: 'c.staff_id=?', p: [id] };
    case 'customer': return { sql: 'c.id=?', p: [id] };
    default: throw U.httpError(400, '階層が不正です');
  }
}
function actualMonths(fy, level, id, basis) {
  const s = getSettings();
  const fm = U.fiscalMonths(fy, Number(s.fiscal_start_month) || 4);
  const f = custFilter(level, id);
  const from = fm[0].from, to = fm[11].to;
  const rows = basis === 'orders'
    ? all(`SELECT substr(o.created_at,1,7) AS ym, SUM(oi.qty*COALESCE(oi.sell_price,0)) AS amt FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN customers c ON c.id=o.customer_id
        WHERE ${f.sql} AND o.status<>'cancelled' AND oi.status<>'cancelled' AND substr(o.created_at,1,10) BETWEEN ? AND ? GROUP BY ym`, ...f.p, from, to)
    : all(`SELECT substr(s.sale_date,1,7) AS ym, SUM(s.subtotal) AS amt FROM sales s JOIN customers c ON c.id=s.customer_id
        WHERE ${f.sql} AND s.sale_date BETWEEN ? AND ? GROUP BY ym`, ...f.p, from, to);
  const map = new Map(rows.map((x) => [x.ym, x.amt || 0]));
  return fm.map((m) => Math.round(map.get(`${m.y}-${String(m.m).padStart(2, '0')}`) || 0));
}
function openQuotes(level, id) {
  const f = custFilter(level, id);
  return get(`SELECT COALESCE(SUM((SELECT SUM(qi.qty*qi.sell_price) FROM quote_items qi WHERE qi.quote_id=q.id)),0) AS amt, COUNT(*) AS cnt
    FROM quotes q JOIN customers c ON c.id=q.customer_id WHERE ${f.sql} AND q.status IN ('draft','negotiating')
    AND q.version=(SELECT MAX(version) FROM quotes q2 WHERE q2.group_no=q.group_no)`, ...f.p);
}
function toDateBudget(fy, mon) {
  const s = getSettings();
  const fm = U.fiscalMonths(fy, Number(s.fiscal_start_month) || 4);
  const today = U.ymd();
  let sum = 0;
  fm.forEach((m, i) => {
    if (m.to < today) sum += mon[i];
    else if (m.from <= today) { const d = Number(today.slice(8, 10)); sum += mon[i] * d / U.lastDayOfMonth(m.y, m.m); }
  });
  return Math.round(sum);
}
function summary(fy, level, id, basis) {
  const b = months(fy, level, id);
  const a = actualMonths(fy, level, id, basis);
  const budget = b.reduce((x, y) => x + y, 0), actual = a.reduce((x, y) => x + y, 0);
  const tdBudget = toDateBudget(fy, b);
  const oq = openQuotes(level, id);
  return { budget_months: b, actual_months: a, budget, actual, rate: budget ? actual / budget : null, todate_budget: tdBudget,
    todate_rate: tdBudget ? actual / tdBudget : null, open_quote_amount: oq.amt, open_quote_cnt: oq.cnt, remaining: Math.max(0, budget - actual) };
}

function parseNode(q) {
  const level = LEVELS.includes(q.level) ? q.level : 'company';
  const id = level === 'company' ? 0 : Number(q.node_id);
  const s = getSettings();
  const fy = Number(q.fy) || U.fiscalYearOf(U.ymd(), Number(s.fiscal_start_month) || 4);
  return { level, id, fy };
}
function defaultNode(user) {
  if (user.role === 'admin' || user.view_scope === 'all') return { level: 'company', id: 0 };
  if (user.role === 'manager' || user.view_scope === 'branch') return user.branch_id ? { level: 'branch', id: user.branch_id } : { level: 'user', id: user.id };
  return { level: 'user', id: user.id };
}

r.get('/budget/meta', (req, res) => {
  const s = getSettings();
  const fsm = Number(s.fiscal_start_month) || 4;
  const fy = U.fiscalYearOf(U.ymd(), fsm);
  res.json({ fy, fiscal_start_month: fsm, months: U.fiscalMonths(fy, fsm).map((m) => `${m.m}月`), basis: s.budget_basis, default: defaultNode(req.user), labels: LABEL });
});

// 予算入力: 上の行＝配られた目標、下の行＝一つ下の階層への配分
r.get('/budget/input', (req, res) => {
  const { level, id, fy } = parseNode(req.query);
  if (!canView(req.user, level, id)) throw U.httpError(403, 'この予算は表示できません');
  const s = getSettings();
  const kids = children(level, id);
  const target = months(fy, level, id);
  const kidRows = kids.map((k) => ({ ...k, months: months(fy, k.level, k.id), prev_actual: actualMonths(fy - 1, k.level, k.id, s.budget_basis), status: statusOf(fy, k.level, k.id).status, has_children: children(k.level, k.id).length > 0 }));
  const allocated = Array(12).fill(0).map((_, i) => kidRows.reduce((a, k) => a + (k.months[i] || 0), 0));
  res.json({
    fy, level, id, name: nodeName(level, id), path: path(level, id), child_level: childLevel(level), child_label: LABEL[childLevel(level)],
    target, prev_actual: actualMonths(fy - 1, level, id, s.budget_basis), children: kidRows, allocated,
    unallocated: target.map((t, i) => t - allocated[i]), status: statusOf(fy, level, id).status,
    can_edit_children: canAllocate(req.user, level, id) && (statusOf(fy, level, id).status !== 'approved' || req.user.role === 'admin'),
    can_edit_target: level === 'company' && req.user.role === 'admin',
    can_approve: req.user.role === 'admin',
  });
});
r.put('/budget', (req, res) => {
  const { level, id, fy } = parseNode(req.body);
  const mon = (req.body.months || []).slice(0, 12).map((v) => Math.round(U.toNum(v, 0)));
  while (mon.length < 12) mon.push(0);
  if (level === 'company') { if (req.user.role !== 'admin') throw U.httpError(403, '全社目標は管理者のみ入力できます'); }
  else {
    const p = parentOf(level, id);
    if (!p || !canAllocate(req.user, p.level, p.id)) throw U.httpError(403, 'この配分は入力できません（自分に配られた額は変えられません）');
    if (statusOf(fy, p.level, p.id).status === 'approved' && req.user.role !== 'admin') throw U.httpError(400, '確定済みのため変更できません');
  }
  run(`INSERT INTO budgets (fy, level, node_id, months, updated_at, updated_by) VALUES (?,?,?,?,?,?)
    ON CONFLICT(fy, level, node_id) DO UPDATE SET months=excluded.months, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
  fy, level, id, JSON.stringify(mon), U.now(), req.user.id);
  res.json({ ok: true });
});
// 締めて提出 / 確定 / 差し戻し
r.post('/budget/status', (req, res) => {
  const { level, id, fy } = parseNode(req.body);
  const st = req.body.status;
  if (!['draft', 'submitted', 'approved'].includes(st)) throw U.httpError(400, '状態が不正です');
  if (st === 'approved' && req.user.role !== 'admin') throw U.httpError(403, '確定は管理者のみ行えます');
  if (st === 'submitted' && !canAllocate(req.user, level, id)) throw U.httpError(403, '提出できません');
  if (st === 'draft' && req.user.role !== 'admin' && !canAllocate(req.user, level, id)) throw U.httpError(403, '差し戻せません');
  run(`INSERT INTO budget_status (fy, level, node_id, status, updated_at, updated_by) VALUES (?,?,?,?,?,?)
    ON CONFLICT(fy, level, node_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, updated_by=excluded.updated_by`, fy, level, id, st, U.now(), req.user.id);
  res.json({ ok: true });
});

// 予算進捗
function progress(req) {
  const { level, id, fy } = parseNode(req.query);
  if (!canView(req.user, level, id)) throw U.httpError(403, 'この予算は表示できません');
  const s = getSettings();
  const basis = req.query.basis || s.budget_basis;
  const self = summary(fy, level, id, basis);
  const kids = children(level, id).map((k) => ({ ...k, ...summary(fy, k.level, k.id, basis), has_children: children(k.level, k.id).length > 0 }));
  const fm = U.fiscalMonths(fy, Number(s.fiscal_start_month) || 4);
  return { fy, level, id, basis, name: nodeName(level, id), path: path(level, id), months: fm.map((m) => `${m.m}月`), self, children: kids, child_label: LABEL[childLevel(level)] };
}
r.get('/budget/progress', (req, res) => res.json(progress(req)));
r.get('/budget/export', (req, res) => {
  const p = progress(req);
  const head = ['区分', '名称', '年間予算', '年間実績', '達成率', '今日までの予算', '今日までの達成率', '未決の見積金額', ...p.months.flatMap((m) => [`${m}予算`, `${m}実績`])];
  const line = (lbl, n, x) => [lbl, n, x.budget, x.actual, x.rate == null ? '' : Math.round(x.rate * 1000) / 10 + '%', x.todate_budget,
    x.todate_rate == null ? '' : Math.round(x.todate_rate * 1000) / 10 + '%', x.open_quote_amount, ...x.budget_months.flatMap((b, i) => [b, x.actual_months[i]])];
  const rows = [head, line(LABEL[p.level], p.name, p.self), ...p.children.map((k) => line(LABEL[k.level], k.name, k))];
  const fname = `budget_${p.fy}_${p.level}_${p.id}`;
  if (req.query.format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '予算進捗');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
  res.send('﻿' + U.toCsv(rows));
});

module.exports = r;
