'use strict';
// 帳票（御見積書・発注書・請求書・納品書・現場QR）。ブラウザの「印刷 → PDFに保存」で PDF になります。
const express = require('express');
const QRCode = require('qrcode');
const { all, get, getSettings } = require('../db');
const U = require('../util');
const A = require('../auth');
const S = require('../services');
const { baseUrl } = require('../mail');

const r = express.Router();
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v == null || v === '' ? '' : Math.round(Number(v)).toLocaleString('ja-JP'));
const qty = (v) => (v == null ? '' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
const jdate = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${y}年${Number(m)}月${Number(d)}日`; };
const pct = (v) => (v == null || v === '' ? '' : `${Math.round(Number(v) * 1000) / 10}%`);

function page(title, body, opts = {}) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
@page { size: A4 ${opts.landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif; color: #1f2937; margin: 0; background: #e5e7eb; font-size: 12px; }
.sheet { background: #fff; width: 210mm; min-height: 297mm; margin: 16px auto; padding: 14mm 12mm; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
.toolbar { position: sticky; top: 0; background: #243f8f; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; justify-content: center; z-index: 5; }
.toolbar button { background: #f59e0b; color: #1f2937; border: 0; border-radius: 6px; padding: 8px 18px; font-weight: 700; font-size: 14px; cursor: pointer; }
.toolbar span { font-size: 13px; opacity: .9; }
h1 { text-align: center; font-size: 24px; letter-spacing: .5em; margin: 0 0 14px; border-bottom: 3px double #243f8f; padding-bottom: 6px; color: #243f8f; }
.row { display: flex; justify-content: space-between; gap: 16px; }
.to { font-size: 17px; font-weight: 700; border-bottom: 1px solid #1f2937; padding-bottom: 3px; min-width: 60%; }
.meta { text-align: right; line-height: 1.7; }
.from { text-align: left; line-height: 1.6; font-size: 11.5px; min-width: 38%; }
.from .cn { font-size: 15px; font-weight: 700; }
.big { margin: 14px 0 10px; display: flex; align-items: center; gap: 16px; border: 2px solid #243f8f; padding: 8px 14px; width: fit-content; min-width: 62%; white-space: nowrap; }
.big .l { font-weight: 700; color: #243f8f; } .big .v { font-size: 22px; font-weight: 700; margin-left: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { border: 1px solid #9ca3af; padding: 4px 6px; vertical-align: top; }
th { background: #e8edf8; font-weight: 500; font-size: 11px; }
td.r, th.r { text-align: right; white-space: nowrap; } td.c { text-align: center; white-space: nowrap; }
.small { font-size: 10.5px; color: #4b5563; }
tr.set td { background: #f3f6fb; font-weight: 700; }
tr.setitem td:first-child { padding-left: 16px; }
.totals { margin-left: auto; width: 45%; margin-top: 8px; }
.totals td { padding: 4px 8px; } .totals tr:last-child td { font-weight: 700; font-size: 14px; background: #e8edf8; }
.note { border: 1px solid #9ca3af; padding: 6px 8px; margin-top: 10px; min-height: 40px; white-space: pre-wrap; }
.summary th, .summary td { text-align: center; } .summary td { font-size: 14px; }
.stamp { display: inline-block; width: 22mm; height: 22mm; border: 1px solid #9ca3af; text-align: center; font-size: 10px; color: #6b7280; padding-top: 2px; }
.neg { color: #b91c1c; }
@media print { body { background: #fff; } .toolbar { display: none; } .sheet { margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; } }
@media (max-width: 800px) { .sheet { width: auto; margin: 0; padding: 16px; } .big { width: 100%; } .row { flex-direction: column; } }
</style></head><body>
<div class="toolbar"><span>${e(title)}</span><button onclick="window.print()">印刷 / PDFで保存</button></div>
<div class="sheet">${body}</div></body></html>`;
}
function companyBlock(s, extra = '') {
  return `<div class="from"><div class="cn">${e(s.company_name)}</div>
  ${s.company_zip ? `〒${e(s.company_zip)}<br>` : ''}${e(s.company_address)}<br>
  ${s.company_tel ? `TEL ${e(s.company_tel)}` : ''}${s.company_fax ? `　FAX ${e(s.company_fax)}` : ''}
  ${s.invoice_reg_no ? `<br>登録番号 ${e(s.invoice_reg_no)}` : ''}${extra}</div>`;
}

// ---- 御見積書（社員のみ） ----
r.get('/quote/:id', (req, res, next) => A.staffAuth(req, res, next), (req, res) => {
  const s = getSettings();
  const q = get(`SELECT q.*, c.name AS customer_name, u.name AS staff_name, u.tel AS staff_tel, u.email AS staff_email, p.name AS project_name, b.name AS branch_name, b.tel AS branch_tel, b.fax AS branch_fax, b.address AS branch_address
    FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id LEFT JOIN users u ON u.id=q.staff_id LEFT JOIN projects p ON p.id=q.project_id LEFT JOIN branches b ON b.id=q.branch_id WHERE q.id=?`, req.params.id);
  if (!q) throw U.httpError(404, '見積が見つかりません');
  const items = all('SELECT * FROM quote_items WHERE quote_id=? ORDER BY seq, id', q.id);
  const subtotal = items.reduce((a, it) => a + U.round0(it.qty * it.sell_price), 0);
  const tax = U.taxOf(subtotal, s.tax_rate);
  // セットごとにまとめる
  const rows = []; let lineNo = 0;
  const groups = [];
  for (const it of items) {
    const key = it.set_name || null;
    const last = groups[groups.length - 1];
    if (key && last && last.set === key) last.items.push(it); else groups.push({ set: key, items: [it] });
  }
  for (const g of groups) {
    if (!g.set) {
      for (const it of g.items) {
        lineNo++;
        rows.push(`<tr><td class="c">${lineNo}</td><td>${e([it.maker, it.code].filter(Boolean).join(' '))}<div>${e(it.name)}${it.spec ? ` <span class="small">${e(it.spec)}</span>` : ''}</div></td>
          <td class="r">${qty(it.qty)}</td><td class="c">${e(it.unit)}</td><td class="r">${n0(it.list_price)}</td><td class="r">${pct(it.sell_rate)}</td><td class="r">${n0(it.sell_price)}</td><td class="r">${n0(it.qty * it.sell_price)}</td></tr>`);
      }
    } else {
      lineNo++;
      const tot = g.items.reduce((a, it) => a + U.round0(it.qty * it.sell_price), 0);
      const listTot = g.items.reduce((a, it) => a + U.round0(it.qty * it.list_price), 0);
      rows.push(`<tr class="set"><td class="c">${lineNo}</td><td>${e(g.set)}</td><td class="r">1</td><td class="c">式</td><td class="r">${n0(listTot)}</td><td class="r">${listTot ? pct(tot / listTot) : ''}</td><td class="r">${n0(tot)}</td><td class="r">${n0(tot)}</td></tr>`);
      if (q.show_set_detail) for (const it of g.items) {
        rows.push(`<tr class="setitem small"><td></td><td>${e([it.maker, it.code].filter(Boolean).join(' '))} ${e(it.name)}${it.spec ? ` ${e(it.spec)}` : ''}</td><td class="r">${qty(it.qty)}</td><td class="c">${e(it.unit)}</td><td class="r">${n0(it.list_price)}</td><td class="r"></td><td class="r"></td><td class="r"></td></tr>`);
      }
    }
  }
  const body = `<h1>御見積書</h1>
  <div class="row"><div class="to">${e(q.customer_name || '')} 御中</div>
    <div class="meta">見積番号　${e(q.no)}${q.version > 1 ? `-${q.version}` : ''}<br>発行日　${jdate(q.issue_date)}</div></div>
  <div class="row" style="margin-top:12px"><div style="flex:1;line-height:1.8">
    <div>下記のとおりお見積り申し上げます。</div>
    ${q.title ? `<div>件名：${e(q.title)}</div>` : ''}${q.site_name || q.project_name ? `<div>現場：${e(q.site_name || q.project_name)}</div>` : ''}
    ${q.delivery_terms ? `<div>納期：${e(q.delivery_terms)}</div>` : ''}${q.payment_terms ? `<div>お支払条件：${e(q.payment_terms)}</div>` : ''}
    <div>有効期限：${jdate(q.valid_until)}</div>
    <div class="big"><span class="l">御見積金額</span><span class="v">¥${n0(subtotal + tax)}-</span><span class="small">（税込）</span></div>
  </div>${companyBlock(s, `<br>担当：${e(q.staff_name || '')}${q.staff_tel ? `　${e(q.staff_tel)}` : ''}`)}</div>
  <table><thead><tr><th style="width:5%">No</th><th>品番・品名</th><th class="r" style="width:7%">数量</th><th style="width:6%">単位</th><th class="r" style="width:11%">定価</th><th class="r" style="width:7%">掛率</th><th class="r" style="width:11%">単価</th><th class="r" style="width:13%">金額</th></tr></thead>
  <tbody>${rows.join('')}</tbody></table>
  <table class="totals"><tr><td>小計</td><td class="r">${n0(subtotal)}</td></tr><tr><td>消費税（${e(s.tax_rate)}%）</td><td class="r">${n0(tax)}</td></tr><tr><td>合計</td><td class="r">¥${n0(subtotal + tax)}</td></tr></table>
  ${q.note ? `<div class="note"><b>備考</b>\n${e(q.note)}</div>` : ''}`;
  res.send(page(`御見積書 ${q.no}`, body));
});

// ---- 発注書（トークン） ----
r.get('/po/:token', (req, res) => {
  const po0 = get('SELECT id FROM purchase_orders WHERE token=?', req.params.token);
  if (!po0) throw U.httpError(404, '発注が見つかりません');
  const po = S.poDetail(po0.id);
  const s = getSettings();
  const total = po.items.reduce((a, it) => a + U.round0(it.qty * (it.cost_price || 0)), 0);
  const body = `<h1>発注書</h1>
  <div class="row"><div class="to">${e(po.supplier_name)} 御中</div><div class="meta">発注番号　${e(po.no)}<br>発注日　${jdate(po.sent_at || po.created_at)}</div></div>
  <div class="row" style="margin-top:12px"><div style="flex:1;line-height:1.8">
    <div>下記のとおり発注いたします。</div>
    ${po.desired_date ? `<div>希望納期：${jdate(po.desired_date)}</div>` : ''}
    <div>納品先：${po.ship_zip ? `〒${e(po.ship_zip)} ` : ''}${e(po.ship_address || '弊社')}</div>
    ${po.ship_name ? `<div>受取人：${e(po.ship_name)}${po.ship_tel ? `（${e(po.ship_tel)}）` : ''}</div>` : ''}
    <div>回答ページ：<span class="small">${e(baseUrl())}/r/${e(po.token)}</span></div>
  </div>${companyBlock(s, `<br>担当：${e(po.staff_name || '')}`)}</div>
  <table><thead><tr><th style="width:5%">No</th><th>メーカー・品番・品名</th><th class="r" style="width:8%">数量</th><th style="width:6%">単位</th><th class="r" style="width:12%">定価</th><th class="r" style="width:12%">仕入単価</th><th class="r" style="width:13%">金額</th><th style="width:12%">回答納期</th></tr></thead>
  <tbody>${po.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${e([it.maker, it.code].filter(Boolean).join(' '))}<div>${e(it.name)} <span class="small">${e(it.spec || '')}</span></div></td>
    <td class="r">${qty(it.qty)}</td><td class="c">${e(it.unit)}</td><td class="r">${n0(it.list_price)}</td><td class="r">${n0(it.cost_price)}</td><td class="r">${n0(it.qty * (it.cost_price || 0))}</td><td class="c">${e(it.answer_date || '')}</td></tr>`).join('')}</tbody></table>
  <table class="totals"><tr><td>合計（税抜）</td><td class="r">¥${n0(total)}</td></tr></table>
  ${po.note ? `<div class="note"><b>備考</b>\n${e(po.note)}</div>` : ''}`;
  res.send(page(`発注書 ${po.no}`, body));
});

// ---- 請求書（トークン） ----
r.get('/invoice/:token', (req, res) => {
  const inv = get(`SELECT i.*, c.name AS customer_name, c.code AS customer_code, c.zip, c.address FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.token=?`, req.params.token);
  if (!inv) throw U.httpError(404, '請求書が見つかりません');
  const s = getSettings();
  const sales = all('SELECT s.*, o.no AS order_no, st.name AS site_name FROM sales s LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN sites st ON st.id=o.site_id WHERE s.invoice_id=? ORDER BY s.sale_date, s.id', inv.id);
  const lines = [];
  for (const sa of sales) {
    const items = all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', sa.id);
    lines.push(`<tr class="set"><td>${e(sa.sale_date.slice(5).replace('-', '/'))}</td><td colspan="4">${sa.kind === 'return' ? '【返品】' : ''}伝票 ${e(sa.no)}${sa.order_no ? `（ご注文 ${e(sa.order_no)}）` : ''}${sa.site_name ? `　${e(sa.site_name)}` : ''}</td><td class="r ${sa.subtotal < 0 ? 'neg' : ''}">${n0(sa.subtotal)}</td></tr>`);
    for (const it of items) lines.push(`<tr class="setitem"><td></td><td>${e([it.maker, it.code].filter(Boolean).join(' '))} ${e(it.name)}</td><td class="r">${qty(it.qty)}</td><td class="c">${e(it.unit)}</td><td class="r">${n0(it.price)}</td><td class="r ${it.amount < 0 ? 'neg' : ''}">${n0(it.amount)}</td></tr>`);
  }
  const body = `<h1>請求書</h1>
  <div class="row"><div><div class="to">${e(inv.customer_name)} 御中</div><div class="small" style="margin-top:4px">${inv.zip ? `〒${e(inv.zip)} ` : ''}${e(inv.address || '')}</div></div>
    <div class="meta">請求番号　${e(inv.no)}<br>締切日　${jdate(inv.closing_date)}<br>対象期間　${jdate(inv.period_from)}〜${jdate(inv.period_to)}</div></div>
  <div class="row" style="margin-top:10px"><div style="flex:1;line-height:1.8">
    <div>毎度ありがとうございます。下記のとおりご請求申し上げます。</div>
    <div class="big"><span class="l">今回御請求額</span><span class="v">¥${n0(inv.total_amount)}-</span></div>
    ${inv.due_date ? `<div>お支払期日：${jdate(inv.due_date)}</div>` : ''}${s.bank_info ? `<div>お振込先：${e(s.bank_info)}</div>` : ''}
  </div>${companyBlock(s)}</div>
  <table class="summary"><thead><tr><th>前回御請求額</th><th>御入金額</th><th>繰越金額</th><th>今回御買上額（税抜）</th><th>消費税額</th><th>今回御請求額</th></tr></thead>
  <tbody><tr><td>${n0(inv.prev_amount)}</td><td>${n0(inv.paid_amount)}</td><td>${n0(inv.carry_amount)}</td><td>${n0(inv.sales_amount)}</td><td>${n0(inv.tax_amount)}</td><td><b>${n0(inv.total_amount)}</b></td></tr></tbody></table>
  <table><thead><tr><th style="width:8%">日付</th><th>品番・品名</th><th class="r" style="width:8%">数量</th><th style="width:6%">単位</th><th class="r" style="width:12%">単価</th><th class="r" style="width:14%">金額（税抜）</th></tr></thead><tbody>${lines.join('') || '<tr><td colspan="6" class="c small">今回のお買上はありません</td></tr>'}</tbody></table>
  <table class="totals"><tr><td>${e(s.tax_rate)}%対象 合計（税抜）</td><td class="r">${n0(inv.sales_amount)}</td></tr><tr><td>消費税（${e(s.tax_rate)}%）</td><td class="r">${n0(inv.tax_amount)}</td></tr><tr><td>今回お買上額（税込）</td><td class="r">¥${n0(inv.current_amount)}</td></tr></table>
  <p class="small">※ 返品は赤字（マイナス）で表示しています。${s.invoice_reg_no ? `この請求書は適格請求書です（登録番号 ${e(s.invoice_reg_no)}）。` : ''}</p>`;
  res.send(page(`請求書 ${inv.no}`, body));
});

// ---- 納品書（社員のみ） ----
r.get('/delivery/:id', (req, res, next) => A.staffAuth(req, res, next), (req, res) => {
  const s = getSettings();
  const sa = get(`SELECT s.*, c.name AS customer_name, o.no AS order_no, o.ship_address, o.ship_name, st.name AS site_name FROM sales s JOIN customers c ON c.id=s.customer_id
    LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN sites st ON st.id=o.site_id WHERE s.id=?`, req.params.id);
  if (!sa) throw U.httpError(404, '売上が見つかりません');
  const items = all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', sa.id);
  const title = sa.kind === 'return' ? '返品伝票' : '納品書';
  const body = `<h1>${title}</h1>
  <div class="row"><div class="to">${e(sa.customer_name)} 御中</div><div class="meta">伝票番号　${e(sa.no)}<br>${sa.kind === 'return' ? '返品日' : '納品日'}　${jdate(sa.sale_date)}${sa.order_no ? `<br>ご注文番号　${e(sa.order_no)}` : ''}</div></div>
  <div class="row" style="margin-top:12px"><div style="flex:1;line-height:1.8">${sa.site_name ? `<div>現場：${e(sa.site_name)}</div>` : ''}${sa.ship_address ? `<div>納品先：${e(sa.ship_address)} ${e(sa.ship_name || '')}</div>` : ''}
    <div>${sa.kind === 'return' ? '下記のとおり返品を承りました。' : '下記のとおり納品いたしました。'}</div></div>${companyBlock(s)}</div>
  <table><thead><tr><th style="width:5%">No</th><th>品番・品名</th><th class="r" style="width:9%">数量</th><th style="width:7%">単位</th><th class="r" style="width:13%">単価</th><th class="r" style="width:15%">金額</th></tr></thead>
  <tbody>${items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${e([it.maker, it.code].filter(Boolean).join(' '))} ${e(it.name)}</td><td class="r">${qty(it.qty)}</td><td class="c">${e(it.unit)}</td><td class="r">${n0(it.price)}</td><td class="r ${it.amount < 0 ? 'neg' : ''}">${n0(it.amount)}</td></tr>`).join('')}</tbody></table>
  <table class="totals"><tr><td>小計（税抜）</td><td class="r">${n0(sa.subtotal)}</td></tr><tr><td>消費税（${e(s.tax_rate)}%）</td><td class="r">${n0(sa.tax)}</td></tr><tr><td>合計</td><td class="r">¥${n0(sa.total)}</td></tr></table>
  <p class="small">※ 消費税は請求書でまとめて計算します（上記は参考額です）。</p>
  <div style="text-align:right;margin-top:20px"><span class="stamp">受領印</span></div>`;
  res.send(page(`${title} ${sa.no}`, body));
});

// ---- 現場QR（社員のみ・印刷して現場に貼る） ----
r.get('/qr/:siteId', (req, res, next) => A.staffAuth(req, res, next), async (req, res) => {
  const st = get('SELECT s.*, c.name AS customer_name FROM sites s JOIN customers c ON c.id=s.customer_id WHERE s.id=?', req.params.siteId);
  if (!st) throw U.httpError(404, '現場が見つかりません');
  const s = getSettings();
  const url = `${baseUrl()}/q/${st.qr_token}`;
  const img = await QRCode.toDataURL(url, { width: 520, margin: 1 });
  const body = `<div style="text-align:center;padding-top:10mm">
    <div style="font-size:16px;color:#243f8f;font-weight:700">${e(s.company_name)} 現場注文QR</div>
    <div style="font-size:30px;font-weight:700;margin:14px 0 4px">${e(st.name)}</div>
    <div style="font-size:15px">${e(st.customer_name)} 様</div>
    <img src="${img}" alt="QRコード" style="width:110mm;height:110mm;margin:14px auto;display:block">
    <div style="font-size:18px;font-weight:700;margin:8px 0">スマートフォンで読み取って、そのまま注文できます</div>
    <div style="font-size:14px;line-height:1.9">ログインは不要です。品番と数量を入れて送信してください。<br>お届け先はこの現場になります。<br>お問い合わせ：${e(s.company_name)} ${e(s.company_tel)}</div>
    <div class="small" style="margin-top:12px">${e(url)}</div></div>`;
  res.send(page(`現場QR ${st.name}`, body));
});

module.exports = r;
