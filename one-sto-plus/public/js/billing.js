/* 売上・請求・入金・会計CSV */
'use strict';

const billingTabs = (on) => `<div class="tabs">${[['sales', '#/sales', '売上一覧'], ['close', '#/invoices/close', '締めて請求書を作る'], ['invoices', '#/invoices', '請求書一覧'], ['payments', '#/payments', '入金・消込'], ['bills', '#/bills', '手形・でんさい'], ['recv', '#/receivables', '売掛残高'], ['csv', '#/export', '会計CSV']]
  .map(([k, h, l]) => `<a href="${h}" class="${on === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
const monthStart = () => `${today().slice(0, 7)}-01`;

// ================= 売上一覧 =================
route('/sales', async (el, p, q) => {
  const draw = async () => {
    const f = { from: q.from || monthStart(), to: q.to || today(), customer_id: q.customer_id || '', kind: q.kind || '', unbilled: q.unbilled || '', scope: getScope() };
    const d = await api(`sales${qs(f)}`);
    const cost = d.rows.reduce((a, r) => a + (r.cost_total || 0), 0);
    el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('sales')}
      <div class="filters">${scopeSeg(draw)}<input type="date" id="from" value="${f.from}"> 〜 <input type="date" id="to" value="${f.to}">
        <select id="f-cust">${opts(App.lk.customers, f.customer_id, { blank: 'すべての得意先' })}</select>
        <select id="f-kind">${opts([{ id: 'sale', name: '売上' }, { id: 'return', name: '返品' }], f.kind, { blank: '売上・返品' })}</select>
        <label class="chk"><input type="checkbox" id="f-unb" ${f.unbilled ? 'checked' : ''}> 未請求のみ</label>
        <span class="muted small" style="margin-left:auto">${d.rows.length}件　売上 ${yen(d.total)}　粗利 ${yen(d.total - cost)}（${d.total ? pct((d.total - cost) / d.total) : '—'}）</span></div>
      <div class="card"><div class="cb p0">${table([
        { h: '伝票番号', v: (r) => `${esc(r.no)} ${r.kind === 'return' ? '<span class="badge red">返品</span>' : ''}` }, { h: '売上日', v: (r) => jd(r.sale_date) },
        { h: '得意先', v: (r) => esc(r.customer_name) }, { h: '受注', v: (r) => (r.order_id ? `<a href="#/orders/${r.order_id}">${esc(r.order_no)}</a>` : `<span class="sub">${esc(r.note || '')}</span>`) },
        { h: '担当', v: (r) => esc(r.staff_name || '') }, { h: '金額（税抜）', r: 1, v: (r) => `<span class="${r.subtotal < 0 ? 'neg' : ''}">${n0(r.subtotal)}</span>` },
        { h: '粗利', r: 1, v: (r) => n0(r.subtotal - (r.cost_total || 0)) }, { h: '請求', v: (r) => (r.invoice_no ? `<a href="#/invoices/${r.invoice_id}">${esc(r.invoice_no)}</a>` : '<span class="badge org">未請求</span>') },
        { h: '', v: (r) => `<a class="btn sm" href="/doc/delivery/${r.id}" target="_blank" rel="noopener">${r.kind === 'return' ? '返品伝票' : '納品書'}</a>` },
      ], d.rows, { empty: '該当する売上はありません' })}</div></div>`;
    const upd = () => { Object.assign(q, { from: $('#from').value, to: $('#to').value, customer_id: $('#f-cust').value, kind: $('#f-kind').value, unbilled: $('#f-unb').checked ? '1' : '' }); setQuery(q); draw(); };
    ['#from', '#to', '#f-cust', '#f-kind', '#f-unb'].forEach((s) => { $(s).onchange = upd; });
  };
  await draw();
}, { nav: 'sales' });

// ================= 締めて請求書を作る =================
route('/invoices/close', async (el, p, q) => {
  const lastMonthEnd = (() => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), 0); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; })();
  const draw = async () => {
    const day = Number(q.day || 31);
    const defDate = (() => { if (day >= 31) return lastMonthEnd; const d = new Date(); let x = new Date(d.getFullYear(), d.getMonth(), day); if (x > d) x = new Date(d.getFullYear(), d.getMonth() - 1, day); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; })();
    const date = q.date || defDate;
    const d = await api(`invoices/closing-preview${qs({ closing_day: day, closing_date: date })}`);
    const targets = d.rows.filter((r) => !r.done && r.sale_cnt);
    el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('close')}
      <div class="card"><div class="ch"><h2>締めて請求書を作る</h2><span class="small muted">締め日ごとに、お客様別の請求書を一括で作ります。請求済みの売上は二重に請求されません。</span></div>
      <div class="cb"><div class="row"><label class="f"><span>締め日の区分</span><select id="day">${[5, 10, 15, 20, 25, 31].map((x) => `<option value="${x}" ${x === day ? 'selected' : ''}>${closingLabel(x)}</option>`).join('')}</select></label>
        <label class="f"><span>締め日</span><input type="date" id="date" value="${date}"></label>
        <div class="sp"></div><button class="btn pri" id="close" ${targets.length ? '' : 'disabled'}>${icon('bill')} チェックしたお客様の請求書を作成（${targets.length}件）</button></div>
        ${d.leftovers.length ? `<div class="warnbox mt">締め日の区分が違うお客様に、1か月以上前の未請求売上があります：${d.leftovers.map((x) => `${esc(x.name)}（${closingLabel(x.closing_day)}・${x.cnt}件 ${yen(x.amount)}）`).join('、')}</div>` : ''}</div>
      <div class="cb p0"><table class="tbl"><thead><tr><th><input type="checkbox" id="all" checked></th><th>コード</th><th>得意先</th><th class="r">未請求の売上</th><th class="r">金額（税抜）</th><th>状態</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td>${!r.done && r.sale_cnt ? `<input type="checkbox" data-c="${r.id}" checked>` : ''}</td><td>${esc(r.code || '')}</td><td>${esc(r.name)}</td><td class="r">${r.sale_cnt}件</td><td class="r">${n0(r.sale_amount)}</td>
          <td>${r.done ? '<span class="badge green">作成済み</span>' : r.sale_cnt ? '<span class="badge org">未作成</span>' : '<span class="muted small">売上なし（繰越のみの場合は作成されます）</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">この締め日区分のお客様はいません</td></tr>'}</tbody></table></div></div>
      <div id="result"></div>`;
    $('#day').onchange = (e) => { q.day = e.target.value; delete q.date; setQuery(q); draw(); };
    $('#date').onchange = (e) => { q.date = e.target.value; setQuery(q); draw(); };
    const all = $('#all'); if (all) all.onchange = (e) => $$('[data-c]').forEach((c) => { c.checked = e.target.checked; });
    $('#close').onclick = async (e) => {
      const ids = $$('[data-c]:checked').map((c) => Number(c.dataset.c));
      if (!ids.length) return toast('お客様をチェックしてください', 'err');
      if (!(await confirmBox(`${jd(date)}締めで ${ids.length}件の請求書を作成します。`, { ok: '作成する' }))) return;
      run(e.target, async () => {
        const r = await api('invoices/close', { method: 'POST', body: { closing_date: date, closing_day: day, customer_ids: ids } });
        toast(`${r.created.length}件の請求書を作成しました`);
        q.month = date.slice(0, 7); go(`#/invoices?closing_date=${date}`);
      });
    };
  };
  await draw();
}, { nav: 'invoices' });

// ================= 請求書一覧 =================
route('/invoices', async (el, p, q) => {
  const draw = async () => {
    const f = { closing_date: q.closing_date || '', month: q.closing_date ? '' : (q.month ?? ''), customer_id: q.customer_id || '', status: q.status || '', overdue: q.overdue || '' };
    const d = await api(`invoices${qs(f)}`);
    const unsent = d.rows.filter((r) => !r.sent_at);
    el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('invoices')}
      <div class="filters"><input type="month" id="month" value="${f.month}" title="締め月"><input type="date" id="cd" value="${f.closing_date}" title="締め日">
        <select id="f-cust">${opts(App.lk.customers, f.customer_id, { blank: 'すべての得意先' })}</select>
        <select id="f-st">${opts(Object.entries(LABELS.invoice).map(([id, v]) => ({ id, name: v[0] })), f.status, { blank: 'すべての状態' })}</select>
        <label class="chk"><input type="checkbox" id="f-od" ${f.overdue ? 'checked' : ''}> 期日超過のみ</label>
        <div class="sp"></div>${unsent.length ? `<button class="btn pri" id="bulk">${icon('mail')} 未送付 ${unsent.length}件をメール送付</button>` : ''}</div>
      <div class="card"><div class="cb p0">${table([
        { h: '請求番号', v: (r) => `<b>${esc(r.no)}</b>` }, { h: '締め日', v: (r) => jd(r.closing_date) }, { h: '得意先', v: (r) => `${esc(r.customer_name)}<div class="sub">${esc(r.customer_code || '')}</div>` },
        { h: '繰越', r: 1, v: (r) => n0(r.carry_amount) }, { h: '今回お買上（税込）', r: 1, v: (r) => n0(r.current_amount) }, { h: '今回御請求額', r: 1, v: (r) => `<b>${n0(r.total_amount)}</b>` },
        { h: '入金消込', r: 1, v: (r) => n0(r.allocated) }, { h: '支払期日', v: (r) => `<span class="${r.due_date < today() && r.status !== 'paid' && r.current_amount > 0 ? 'neg b' : ''}">${jd(r.due_date)}</span>` },
        { h: '状態', v: (r) => badge('invoice', r.status) }, { h: '', v: (r) => `<a class="btn sm" href="/doc/invoice/${r.token}" target="_blank" rel="noopener">${icon('print')} PDF</a>` },
      ], d.rows, { onRow: true, empty: '請求書はありません' })}</div></div>`;
    bindRows(el, d.rows, (r) => go(`#/invoices/${r.id}`));
    $('#month').onchange = (e) => { q.month = e.target.value; delete q.closing_date; setQuery(q); draw(); };
    $('#cd').onchange = (e) => { q.closing_date = e.target.value; setQuery(q); draw(); };
    const upd = () => { Object.assign(q, { customer_id: $('#f-cust').value, status: $('#f-st').value, overdue: $('#f-od').checked ? '1' : '' }); setQuery(q); draw(); };
    ['#f-cust', '#f-st', '#f-od'].forEach((s) => { $(s).onchange = upd; });
    const bulk = $('#bulk'); if (bulk) bulk.onclick = async () => {
      if (!(await confirmBox(`未送付の請求書 ${unsent.length}件を、お客様へメールで送付します（PDFのリンク付き）。`, { ok: '送付する' }))) return;
      run(bulk, async () => { const r = await api('invoices/send-bulk', { method: 'POST', body: { ids: unsent.map((x) => x.id) } }); const ng = r.results.filter((x) => !x.ok); toast(ng.length ? `${ng.length}件送れませんでした：${ng[0].error}` : '送付しました', ng.length ? 'err' : 'ok'); draw(); });
    };
  };
  await draw();
}, { nav: 'invoices' });

route('/invoices/:id', async (el, { id }) => {
  const inv = await api(`invoices/${id}`);
  el.innerHTML = `<div class="crumb"><a href="#/invoices">請求書一覧</a> ›</div>
    <div class="page-h"><h1>請求書 ${esc(inv.no)}</h1>${badge('invoice', inv.status)}
      <div class="acts"><a class="btn" href="/doc/invoice/${inv.token}" target="_blank" rel="noopener">${icon('print')} 請求書PDF</a><button class="btn pri" id="send">${icon('mail')} ${inv.sent_at ? '再送付' : 'メールで送付'}</button><button class="btn danger" id="del">取消</button></div></div>
    <div class="grid g2"><div class="card"><div class="cb"><dl class="kv"><dt>得意先</dt><dd><b>${esc(inv.customer_name)}</b></dd><dt>締め日</dt><dd>${jd(inv.closing_date)}（${jd(inv.period_from)}〜${jd(inv.period_to)}）</dd>
      <dt>支払期日</dt><dd>${jd(inv.due_date)}</dd><dt>送付</dt><dd>${inv.sent_at ? dt(inv.sent_at) : '未送付'}（${esc(inv.customer_email || 'メール未登録')}）</dd></dl></div></div>
      <div class="card"><div class="cb"><dl class="kv"><dt>前回御請求額</dt><dd class="r">${yen(inv.prev_amount)}</dd><dt>御入金額</dt><dd class="r">${yen(inv.paid_amount)}</dd><dt>繰越金額</dt><dd class="r">${yen(inv.carry_amount)}</dd>
        <dt>今回お買上（税抜）</dt><dd class="r">${yen(inv.sales_amount)}</dd><dt>消費税</dt><dd class="r">${yen(inv.tax_amount)}</dd><dt>今回御請求額</dt><dd class="r b" style="font-size:17px">${yen(inv.total_amount)}</dd>
        <dt>今回分の入金残</dt><dd class="r ${inv.balance > 0 ? 'neg' : 'pos'} b">${yen(inv.balance)}</dd></dl></div></div></div>
    <div class="card mt"><div class="ch"><h2>今回の売上・返品</h2></div><div class="cb p0">${table([
      { h: '伝票', v: (r) => `${esc(r.no)} ${r.kind === 'return' ? '<span class="badge red">返品</span>' : ''}` }, { h: '日付', v: (r) => jd(r.sale_date) },
      { h: '受注', v: (r) => (r.order_id ? `<a href="#/orders/${r.order_id}">${esc(r.order_no)}</a>` : '') }, { h: '金額（税抜）', r: 1, v: (r) => `<span class="${r.subtotal < 0 ? 'neg' : ''}">${n0(r.subtotal)}</span>` },
    ], inv.sales, { empty: '今回の売上はありません（繰越のみ）' })}</div></div>
    <div class="card mt"><div class="ch"><h2>入金の消込</h2><div class="acts"><a class="btn sm" href="#/payments/new?customer_id=${inv.customer_id}">入金を登録</a></div></div><div class="cb p0">${table([
      { h: '入金日', v: (r) => jd(r.pay_date) }, { h: '方法', v: (r) => esc(LABELS.method[r.method] || r.method) }, { h: '消込額', r: 1, v: (r) => n0(r.amount) },
      { h: '', v: (r) => `<button class="btn sm ghost danger" data-unalloc="${r.id}">消込を外す</button>` },
    ], inv.allocations, { empty: 'まだ入金が消し込まれていません' })}</div></div>`;
  const reload = () => go(`#/invoices/${id}`);
  $('#send').onclick = (e) => run(e.target, async () => { await api(`invoices/${id}/send`, { method: 'POST', body: {} }); reload(); }, '送付しました');
  $('#del').onclick = async (e) => { if (await confirmBox('この請求書を取り消します。含まれる売上は未請求に戻ります（最新の請求書のみ取り消せます）。', { danger: true, ok: '取り消す' })) run(e.target, async () => { await api(`invoices/${id}`, { method: 'DELETE' }); go('#/invoices'); }, '取り消しました'); };
  $$('[data-unalloc]').forEach((b) => { b.onclick = () => run(b, async () => { await api(`allocations/${b.dataset.unalloc}`, { method: 'DELETE' }); reload(); }, '消込を外しました'); });
}, { nav: 'invoices' });

// ================= 入金 =================
route('/payments', async (el, p, q) => {
  const draw = async () => {
    const f = { from: q.from || addDays(today(), -60), to: q.to || today(), customer_id: q.customer_id || '', method: q.method || '', unallocated: q.unallocated || '' };
    const d = await api(`payments${qs(f)}`);
    el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('payments')}
      <div class="filters"><input type="date" id="from" value="${f.from}"> 〜 <input type="date" id="to" value="${f.to}">
        <select id="f-cust">${opts(App.lk.customers, f.customer_id, { blank: 'すべての得意先' })}</select>
        <select id="f-m">${opts(Object.entries(LABELS.method).map(([id, name]) => ({ id, name })), f.method, { blank: 'すべての方法' })}</select>
        <label class="chk"><input type="checkbox" id="f-un" ${f.unallocated ? 'checked' : ''}> 未消込・過入金のみ</label>
        <div class="sp"></div><a class="btn pri" href="#/payments/new">${icon('plus')} 入金を登録</a></div>
      <div class="card"><div class="cb p0">${table([
        { h: '入金日', v: (r) => jd(r.pay_date) }, { h: '得意先', v: (r) => esc(r.customer_name) }, { h: '方法', v: (r) => esc(LABELS.method[r.method] || r.method) + (r.due_date ? `<div class="sub">期日 ${jd(r.due_date)}</div>` : '') },
        { h: '入金額', r: 1, v: (r) => n0(r.amount) }, { h: '手数料等', r: 1, v: (r) => n0(r.fee) }, { h: '消込済', r: 1, v: (r) => n0(r.allocated) },
        { h: '未消込（過入金）', r: 1, v: (r) => { const u = r.amount + r.fee - r.allocated; return u > 0 ? `<span class="badge org">${n0(u)}</span>` : '—'; } }, { h: 'メモ', v: (r) => `<span class="small">${esc(r.note || '')}</span>` },
      ], d.rows, { onRow: true, empty: '入金はありません' })}</div></div>`;
    bindRows(el, d.rows, (r) => go(`#/payments/${r.id}`));
    const upd = () => { Object.assign(q, { from: $('#from').value, to: $('#to').value, customer_id: $('#f-cust').value, method: $('#f-m').value, unallocated: $('#f-un').checked ? '1' : '' }); setQuery(q); draw(); };
    ['#from', '#to', '#f-cust', '#f-m', '#f-un'].forEach((s) => { $(s).onchange = upd; });
  };
  await draw();
}, { nav: 'payments' });

route('/payments/new', async (el, p, q) => {
  el.innerHTML = `<div class="crumb"><a href="#/payments">入金・消込</a> ›</div><div class="page-h"><h1>入金を登録</h1><span class="sub">請求書単位で消し込みます。多すぎる分は過入金として残り、次の請求に充当できます。</span></div>
    <div class="card"><div class="cb"><div class="form g3f" id="h">
      ${field('得意先', sel('customer_id', opts(App.lk.customers, q.customer_id, { label: (c) => `${c.code || ''} ${c.name}` })), { req: true })}
      ${field('入金日', inp('pay_date', today(), { type: 'date' }))}
      ${field('方法', sel('method', opts(Object.entries(LABELS.method).map(([id, name]) => ({ id, name })), 'transfer', { blank: false })))}
      ${field('入金額', inp('amount', '', { attrs: 'class="in-num"' }), { req: true })}${field('振込手数料・値引など（消込に含める）', inp('fee', '0', { attrs: 'class="in-num"' }))}
      <div id="bill-f" class="hidden" style="display:contents">${field('手形・でんさいの期日', inp('due_date', '', { type: 'date' }))}${field('手形番号', inp('bill_no'))}</div>
      ${field('メモ', inp('note'), { full: true })}</div></div></div>
    <div class="card"><div class="ch"><h2>消込する請求書</h2><div class="acts"><button class="btn sm" id="auto">古い請求書から自動で割り当て</button></div></div><div class="cb p0" id="invs"><div class="empty">得意先を選んでください</div></div></div>
    <div class="row mt"><div class="sp"></div><span id="rest" class="muted"></span><button class="btn pri" id="save">入金を登録</button></div>`;
  let invs = [];
  const loadInv = async () => {
    const cid = $('[name=customer_id]').value;
    if (!cid) { $('#invs').innerHTML = '<div class="empty">得意先を選んでください</div>'; return; }
    const d = await api(`invoices?customer_id=${cid}`);
    invs = d.rows.map((r) => ({ ...r, balance: r.current_amount - r.allocated })).filter((r) => r.balance > 0).sort((a, b) => a.closing_date.localeCompare(b.closing_date));
    $('#invs').innerHTML = invs.length ? `<table class="tbl"><thead><tr><th>請求番号</th><th>締め日</th><th>期日</th><th class="r">今回請求（税込）</th><th class="r">残高</th><th class="r">今回消込</th></tr></thead><tbody>
      ${invs.map((r) => `<tr><td>${esc(r.no)}</td><td>${jd(r.closing_date)}</td><td>${jd(r.due_date)}</td><td class="r">${n0(r.current_amount)}</td><td class="r b">${n0(r.balance)}</td><td class="r"><input class="in-num" data-inv="${r.id}" style="width:120px"></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">残高のある請求書はありません（入金はすべて過入金として残ります）</div>';
    $$('[data-inv]').forEach((x) => { x.oninput = rest; });
    rest();
  };
  const total = () => (num($('[name=amount]').value) || 0) + (num($('[name=fee]').value) || 0);
  const rest = () => { const used = $$('[data-inv]').reduce((a, x) => a + (num(x.value) || 0), 0); const r = total() - used; $('#rest').innerHTML = `消込合計 ${yen(used)} ／ 残り ${r < 0 ? `<b class="neg">${yen(r)}</b>` : yen(r)}${r > 0 ? '（過入金として残ります）' : ''}`; };
  $('[name=customer_id]').onchange = loadInv;
  $('[name=amount]').oninput = rest; $('[name=fee]').oninput = rest;
  $('[name=method]').onchange = (e) => $('#bill-f').classList.toggle('hidden', !['bill', 'densai'].includes(e.target.value));
  $('#auto').onclick = () => { let r = total(); $$('[data-inv]').forEach((x) => { const inv = invs.find((i) => i.id === Number(x.dataset.inv)); const a = Math.max(0, Math.min(inv.balance, r)); x.value = a || ''; r -= a; }); rest(); };
  $('#save').onclick = (e) => run(e.target, async () => {
    const h = formData($('#h'));
    if (!h.customer_id) throw new Error('得意先を選んでください');
    const allocations = $$('[data-inv]').map((x) => ({ invoice_id: Number(x.dataset.inv), amount: num(x.value) || 0 })).filter((a) => a.amount > 0);
    const used = allocations.reduce((a, x) => a + x.amount, 0);
    if (used > total()) throw new Error('消込合計が入金額を超えています');
    const r = await api('payments', { method: 'POST', body: { ...h, allocations, auto: false } });
    go(`#/payments/${r.id}`);
  }, '入金を登録しました');
  if (q.customer_id) loadInv();
}, { nav: 'payments' });

route('/payments/:id', async (el, { id }) => {
  const pmt = await api(`payments/${id}`);
  el.innerHTML = `<div class="crumb"><a href="#/payments">入金・消込</a> ›</div><div class="page-h"><h1>入金 ${jd(pmt.pay_date)} ${esc(pmt.customer_name)}</h1><div class="acts"><button class="btn danger" id="del">入金を削除</button></div></div>
    <div class="grid g2"><div class="card"><div class="cb"><dl class="kv"><dt>方法</dt><dd>${esc(LABELS.method[pmt.method])}</dd><dt>入金額</dt><dd>${yen(pmt.amount)}</dd><dt>手数料等</dt><dd>${yen(pmt.fee)}</dd>
      ${pmt.due_date ? `<dt>期日</dt><dd>${jd(pmt.due_date)}（${pmt.bill_status === 'settled' ? '決済済' : '保有中'}）</dd>` : ''}<dt>メモ</dt><dd>${esc(pmt.note || '')}</dd><dt>未消込（過入金）</dt><dd class="b ${pmt.unallocated > 0 ? 'neg' : ''}">${yen(pmt.unallocated)}</dd></dl></div></div>
    <div class="card"><div class="ch"><h2>消込先</h2></div><div class="cb p0">${table([{ h: '請求番号', v: (r) => `<a href="#/invoices/${r.invoice_id}">${esc(r.invoice_no)}</a>` }, { h: '締め日', v: (r) => jd(r.closing_date) }, { h: '消込額', r: 1, v: (r) => n0(r.amount) }, { h: '', v: (r) => `<button class="btn sm ghost danger" data-un="${r.id}">外す</button>` }], pmt.allocations, { empty: '消込先はありません' })}</div></div></div>
    ${pmt.unallocated > 0 && pmt.open_invoices.length ? `<div class="card mt"><div class="ch"><h2>残りを消し込む</h2><div class="acts"><button class="btn sm" id="auto">古い順に自動で消込</button></div></div><div class="cb p0">${table([
      { h: '請求番号', v: (r) => esc(r.no) }, { h: '締め日', v: (r) => jd(r.closing_date) }, { h: '残高', r: 1, v: (r) => n0(r.balance) },
      { h: '', v: (r) => `<input class="in-num" data-amt="${r.id}" value="${Math.min(r.balance, pmt.unallocated)}" style="width:120px"> <button class="btn sm pri" data-al="${r.id}">消込</button>` },
    ], pmt.open_invoices)}</div></div>` : ''}`;
  const reload = () => go(`#/payments/${id}`);
  $('#del').onclick = async (e) => { if (await confirmBox('この入金を削除します（消込も外れます）。', { danger: true, ok: '削除' })) run(e.target, async () => { await api(`payments/${id}`, { method: 'DELETE' }); go('#/payments'); }, '削除しました'); };
  $$('[data-un]').forEach((b) => { b.onclick = () => run(b, async () => { await api(`allocations/${b.dataset.un}`, { method: 'DELETE' }); reload(); }); });
  $$('[data-al]').forEach((b) => { b.onclick = () => run(b, async () => { await api(`payments/${id}/allocate`, { method: 'POST', body: { invoice_id: Number(b.dataset.al), amount: $(`[data-amt="${b.dataset.al}"]`).value } }); reload(); }, '消し込みました'); });
  const a = $('#auto'); if (a) a.onclick = () => run(a, async () => { await api(`payments/${id}/auto-allocate`, { method: 'POST', body: {} }); reload(); }, '消し込みました');
}, { nav: 'payments' });

// ================= 手形・でんさい =================
route('/bills', async (el, p, q) => {
  const draw = async () => {
    const d = await api(`bills${qs({ all: q.all })}`);
    el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('bills')}
      <div class="filters"><label class="chk"><input type="checkbox" id="all" ${q.all ? 'checked' : ''}> 決済済みも表示</label><span class="muted small" style="margin-left:auto">保有中の合計 ${yen(d.rows.filter((r) => r.bill_status !== 'settled').reduce((a, r) => a + r.amount, 0))}</span></div>
      <div class="card"><div class="cb p0">${table([
        { h: '期日', v: (r) => `<b class="${r.due_date && r.due_date <= addDays(today(), 7) && r.bill_status !== 'settled' ? 'neg' : ''}">${jd(r.due_date)}</b>` }, { h: '種類', v: (r) => esc(LABELS.method[r.method]) },
        { h: '得意先', v: (r) => esc(r.customer_name) }, { h: '受取日', v: (r) => jd(r.pay_date) }, { h: '番号', v: (r) => esc(r.bill_no || '') }, { h: '金額', r: 1, v: (r) => n0(r.amount) },
        { h: '状態', v: (r) => (r.bill_status === 'settled' ? '<span class="badge green">決済済</span>' : '<span class="badge org">保有中</span>') },
        { h: '', v: (r) => `<button class="btn sm" data-settle="${r.id}" data-undo="${r.bill_status === 'settled' ? 1 : ''}">${r.bill_status === 'settled' ? '保有中に戻す' : '決済済みにする'}</button>` },
      ], d.rows, { empty: '手形・でんさいはありません' })}</div></div>`;
    $('#all').onchange = (e) => { q.all = e.target.checked ? '1' : ''; setQuery(q); draw(); };
    $$('[data-settle]').forEach((b) => { b.onclick = () => run(b, async () => { await api(`payments/${b.dataset.settle}/settle`, { method: 'POST', body: { undo: !!b.dataset.undo } }); draw(); }); });
  };
  await draw();
}, { nav: 'payments' });

// ================= 売掛残高 =================
route('/receivables', async (el) => {
  const d = await api('receivables');
  const sum = (k) => d.rows.reduce((a, r) => a + (r[k] || 0), 0);
  el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('recv')}
    <div class="card"><div class="cb p0">${table([
      { h: 'コード', v: (r) => esc(r.code || '') }, { h: '得意先', v: (r) => `<a href="#/invoices?customer_id=${r.id}">${esc(r.name)}</a>` }, { h: '締め', v: (r) => closingLabel(r.closing_day) },
      { h: '請求累計', r: 1, v: (r) => n0(r.invoiced) }, { h: '入金累計', r: 1, v: (r) => n0(r.paid) }, { h: '売掛残高', r: 1, v: (r) => `<b>${n0(r.balance)}</b>` },
      { h: 'うち期日超過', r: 1, v: (r) => (r.overdue > 0 ? `<span class="neg b">${n0(r.overdue)}</span>` : '—') }, { h: '未請求の売上（税込）', r: 1, v: (r) => n0(r.unbilled) },
      { h: '過入金', r: 1, v: (r) => (r.unallocated > 0 ? `<span class="badge org">${n0(r.unallocated)}</span>` : '—') },
    ], d.rows, { empty: '売掛金はありません', foot: `<td colspan="3">合計</td><td class="r">${n0(sum('invoiced'))}</td><td class="r">${n0(sum('paid'))}</td><td class="r">${n0(sum('balance'))}</td><td class="r">${n0(sum('overdue'))}</td><td class="r">${n0(sum('unbilled'))}</td><td class="r">${n0(sum('unallocated'))}</td>` })}</div></div>`;
}, { nav: 'payments' });

// ================= 会計CSV =================
route('/export', async (el) => {
  const s = await api('settings');
  const cols = await api('export/columns');
  const chosen = (() => { try { return JSON.parse(s.csv_columns); } catch (_) { return []; } })();
  const lastM = (() => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const b = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; return [f(a), f(b)]; })();
  el.innerHTML = `<div class="page-h"><h1>売上・請求・入金</h1></div>${billingTabs('csv')}
    <div class="grid g2"><div class="card"><div class="ch"><h2>会計ソフト向けCSVを出力</h2></div><div class="cb"><div class="form" id="f">
      ${field('データ', sel('type', '<option value="invoices">請求（締め日ごと）</option><option value="sales">売上伝票（1件ずつ）</option><option value="payments">入金</option>'))}<div></div>
      ${field('開始日', inp('from', lastM[0], { type: 'date' }))}${field('終了日', inp('to', lastM[1], { type: 'date' }))}</div>
      <p class="small muted">文字コード：${s.csv_encoding === 'sjis' ? 'Shift_JIS（弥生会計・勘定奉行など）' : 'UTF-8'}　借方 ${esc(s.csv_debit)} ／ 貸方 ${esc(s.csv_credit)}</p>
      <button class="btn pri" id="dl">${icon('dl')} CSVをダウンロード</button></div></div>
    <div class="card"><div class="ch"><h2>出力する項目（会社ごとに選択）</h2></div><div class="cb">
      ${App.me.user.role === 'admin' ? '' : '<p class="small muted">項目の変更は管理者のみ行えます。</p>'}
      <div id="cols" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${[...chosen.map((k) => cols.find((c) => c.key === k)).filter(Boolean), ...cols.filter((c) => !chosen.includes(c.key))].map((c) => `<label class="chk"><input type="checkbox" value="${c.key}" ${chosen.includes(c.key) ? 'checked' : ''} ${App.me.user.role === 'admin' ? '' : 'disabled'}> ${esc(c.label)}</label>`).join('')}</div>
      <div class="form mt">${field('文字コード', `<select id="enc" ${App.me.user.role === 'admin' ? '' : 'disabled'}><option value="sjis" ${s.csv_encoding === 'sjis' ? 'selected' : ''}>Shift_JIS</option><option value="utf8" ${s.csv_encoding !== 'sjis' ? 'selected' : ''}>UTF-8（BOM付き）</option></select>`)}<div></div>
        ${field('売上の借方科目', `<input id="deb" value="${esc(s.csv_debit)}">`)}${field('売上の貸方科目', `<input id="cre" value="${esc(s.csv_credit)}">`)}</div>
      ${App.me.user.role === 'admin' ? '<button class="btn mt" id="savecols">項目を保存</button>' : ''}</div></div></div>`;
  $('#dl').onclick = () => { const f = formData($('#f')); location.href = `/api/export/accounting${qs(f)}`; };
  const sc = $('#savecols'); if (sc) sc.onclick = () => run(sc, async () => {
    await api('settings', { method: 'PUT', body: { csv_columns: JSON.stringify($$('#cols input:checked').map((x) => x.value)), csv_encoding: $('#enc').value, csv_debit: $('#deb').value, csv_credit: $('#cre').value } });
  }, '保存しました');
}, { nav: 'invoices' });
