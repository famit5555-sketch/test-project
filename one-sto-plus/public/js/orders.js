/* 受注・発注・出荷指示・納期カレンダー */
'use strict';

const ORDER_FLAG_LABEL = { unconfirmed: 'お客様からの注文（未確認）', price_unset: '売単価未入力', to_order: '発注待ち', eta_unnotified: '納期未連絡', to_sell: '売上未計上', change_request: '取消・変更の依頼あり' };

// ================= 受注一覧 =================
route('/orders', async (el, p, q) => {
  const draw = async () => {
    const f = { status: q.status ?? 'open', source: q.source || '', customer_id: q.customer_id || '', flag: q.flag || '', q: q.q || '', scope: getScope() };
    const d = await api(`orders${qs(f)}`);
    el.innerHTML = `<div class="page-h"><h1>受注</h1><span class="sub">見積からの受注、お客様ポータル・現場QRからの注文がここに集まります。</span>
      <div class="acts"><a class="btn pri" href="#/orders/new">${icon('plus')} 受注を入力</a></div></div>
      <div class="filters">${scopeSeg(draw)}
        <select id="f-status">${opts([{ id: 'open', name: '進行中' }, { id: 'completed', name: '完了' }, { id: 'cancelled', name: '取消' }], f.status, { blank: 'すべて' })}</select>
        <select id="f-flag">${opts(Object.entries(ORDER_FLAG_LABEL).map(([id, name]) => ({ id, name })), f.flag, { blank: '絞り込みなし' })}</select>
        <select id="f-source">${opts(Object.entries(LABELS.source).map(([id, v]) => ({ id, name: v[0] })), f.source, { blank: 'すべての入口' })}</select>
        <select id="f-cust">${opts(App.lk.customers, f.customer_id, { blank: 'すべての得意先' })}</select>
        <input type="search" id="f-q" placeholder="番号・得意先・現場で検索" value="${esc(f.q)}"></div>
      <div class="card"><div class="cb p0">${table([
        { h: '受注番号', v: (r) => `<b>${esc(r.no)}</b> ${badge('source', r.source)}${r.pending_requests ? ' <span class="badge red">依頼あり</span>' : ''}` },
        { h: '得意先・現場', v: (r) => `${esc(r.customer_name)}<div class="sub">${esc(r.site_name || r.customer_ref || '')}</div>` },
        { h: '担当', v: (r) => esc(r.staff_name || '') },
        { h: '受注日', v: (r) => jd(r.created_at) },
        { h: '希望納期', v: (r) => jd(r.desired_date) },
        { h: '回答納期', v: (r) => jd(r.eta_max) },
        { h: '明細', r: 1, v: (r) => r.item_cnt },
        { h: '金額（税抜）', r: 1, v: (r) => (r.price_confirmed || r.amount ? n0(r.amount) : '<span class="badge org">価格未回答</span>') },
        { h: '状態', v: (r) => badge('order', r.status) + (r.eta_notified_at ? ' <span class="badge teal">納期連絡済</span>' : '') },
      ], d.rows, { onRow: true, empty: '該当する受注はありません' })}</div></div>`;
    bindRows(el, d.rows, (r) => go(`#/orders/${r.id}`));
    const upd = () => { Object.assign(q, { status: $('#f-status').value, flag: $('#f-flag').value, source: $('#f-source').value, customer_id: $('#f-cust').value, q: $('#f-q').value }); setQuery(q); draw(); };
    ['#f-status', '#f-flag', '#f-source', '#f-cust'].forEach((s) => { $(s).onchange = upd; });
    let t; $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(upd, 350); };
  };
  await draw();
}, { nav: 'orders' });

// ================= 受注入力（電話・FAX） =================
function orderItemEditor(container, items, { locked = () => false } = {}) {
  const drawE = () => {
    container.innerHTML = `<table class="ed" style="min-width:980px"><thead><tr><th>メーカー</th><th>品番</th><th>品名</th><th>数量</th><th>単位</th><th>定価</th><th>売単価</th><th>仕入単価</th><th>仕入先</th><th>金額</th><th></th></tr></thead><tbody>
      ${items.map((it, i) => { const lk = locked(it); const dis = lk ? 'disabled' : ''; return `<tr data-i="${i}">
        <td><input data-f="maker" value="${esc(it.maker || '')}" style="width:96px" ${dis}></td><td><input data-f="code" value="${esc(it.code || '')}" style="width:120px" ${dis}></td>
        <td><input data-f="name" value="${esc(it.name || '')}" style="width:200px" ${dis}></td><td><input data-f="qty" class="in-num" value="${esc(it.qty ?? 1)}" style="width:56px" ${dis}></td>
        <td><input data-f="unit" value="${esc(it.unit || '')}" style="width:48px" ${dis}></td><td><input data-f="list_price" class="in-num" value="${esc(it.list_price ?? '')}" style="width:88px" ${dis}></td>
        <td><input data-f="sell_price" class="in-num" value="${esc(it.sell_price ?? '')}" style="width:88px"></td><td><input data-f="cost_price" class="in-num" value="${esc(it.cost_price ?? '')}" style="width:88px"></td>
        <td><select data-f="supplier_id" style="width:140px" ${dis}>${opts(App.lk.suppliers, it.supplier_id, { blank: '（仕入先）' })}</select></td>
        <td class="calc" data-amt>${n0((Number(it.qty) || 0) * (Number(it.sell_price) || 0))}</td>
        <td>${lk ? `<span class="xs muted">${esc(LABELS.item[it.status]?.[0] || '')}</span>` : `<button class="btn ghost sm" data-del>${icon('x')}</button>`}</td></tr>`; }).join('')}</tbody></table>
      <div style="padding:8px"><button class="btn sm" data-add>${icon('plus')} 行を追加</button></div>`;
    $$('tr[data-i]', container).forEach((tr) => {
      const it = items[Number(tr.dataset.i)];
      $$('[data-f]', tr).forEach((x) => { x.onchange = () => {
        const f = x.dataset.f; let v = x.value;
        if (['qty', 'list_price', 'sell_price', 'cost_price'].includes(f)) v = num(v);
        if (f === 'supplier_id') v = v ? Number(v) : null;
        it[f] = v; $('[data-amt]', tr).textContent = n0((Number(it.qty) || 0) * (Number(it.sell_price) || 0));
      }; });
      const del = $('[data-del]', tr); if (del) del.onclick = () => { items.splice(Number(tr.dataset.i), 1); drawE(); };
      if (!locked(it)) attachProductSearch($('[data-f=code]', tr), (pr) => {
        Object.assign(it, { maker: pr.maker, code: pr.code, name: pr.name, unit: pr.unit, list_price: pr.list_price, supplier_id: pr.supplier_id, cost_price: pr.cost_rate ? floor0(pr.list_price * pr.cost_rate) : it.cost_price });
        drawE();
      });
    });
    $('[data-add]', container).onclick = () => { items.push({ qty: 1, unit: '個' }); drawE(); };
  };
  drawE();
}

route('/orders/new', async (el) => {
  const items = [{ qty: 1, unit: '個' }];
  el.innerHTML = `<div class="crumb"><a href="#/orders">受注</a> ›</div><div class="page-h"><h1>受注を入力</h1><span class="sub">電話・FAX・メールで受けた注文を入力します。見積からの受注は見積画面の「受注にする」を使ってください。</span>
    <div class="acts"><button class="btn pri" id="save">保存</button></div></div>
    <div class="card"><div class="cb"><div class="form g3f" id="h">
      ${field('得意先', sel('customer_id', opts(App.lk.customers, '', { label: (c) => `${c.code || ''} ${c.name}` })), { req: true })}
      ${field('現場・お届け先', sel('site_id', '<option value="">（得意先を選ぶと表示）</option>'))}
      ${field('担当者', sel('staff_id', opts(App.lk.users, '', { blank: '（得意先の担当者）' })))}
      ${field('注文者', inp('orderer_name'))}${field('お客様の注文番号・件名', inp('customer_ref'))}${field('希望納期', inp('desired_date', '', { type: 'date' }))}
      ${field('納品先住所', inp('ship_address'), { full: true })}${field('受取人', inp('ship_name'))}${field('受取人電話', inp('ship_tel'))}${field('郵便番号', inp('ship_zip'))}
      ${field('お客様からの連絡事項', ta('customer_note'), { full: true })}${field('社内メモ', ta('internal_note'), { full: true })}
    </div></div></div>
    <div class="card"><div class="ch"><h2>明細</h2><span class="small muted">売単価が未定の明細は空欄のままで保存できます（あとで一括登録）。</span></div><div class="cb p0 tbl-wrap" id="ed"></div></div>`;
  orderItemEditor($('#ed'), items);
  let sites = [];
  $('[name=customer_id]').onchange = async (e) => {
    sites = e.target.value ? (await api(`m/sites?customer_id=${e.target.value}`)).rows : [];
    $('[name=site_id]').innerHTML = opts(sites, '', { blank: '（なし・住所を直接入力）', label: (s) => `${s.kind === 'warehouse' ? '［倉庫］' : ''}${s.name}` });
  };
  $('[name=site_id]').onchange = (e) => {
    const s = sites.find((x) => x.id === Number(e.target.value)); if (!s) return;
    $('[name=ship_address]').value = s.address || ''; $('[name=ship_name]').value = s.receiver || ''; $('[name=ship_tel]').value = s.tel || ''; $('[name=ship_zip]').value = s.zip || '';
  };
  $('#save').onclick = (e) => run(e.target, async () => {
    const h = formData($('#h'));
    if (!h.customer_id) throw new Error('得意先を選んでください');
    const r = await api('orders', { method: 'POST', body: { ...h, items: items.filter((x) => x.code || x.name) } });
    go(`#/orders/${r.id}`);
  }, '受注を登録しました');
}, { nav: 'orders' });

// ================= 受注詳細 =================
function orderFlow(o) {
  const live = o.items.filter((i) => i.status !== 'cancelled');
  const all = (fn) => live.length > 0 && live.every(fn);
  const steps = [
    ['受注', true],
    ['価格確定', live.every((i) => i.sell_price != null)],
    ['発注', all((i) => i.status !== 'open')],
    ['仕入先回答', all((i) => ['answered', 'shipped', 'delivered'].includes(i.status))],
    ['納期連絡', !!o.eta_notified_at],
    ['出荷', all((i) => ['shipped', 'delivered'].includes(i.status) || (i.source === 'stock'))],
    ['売上計上', all((i) => i.status === 'delivered')],
    ['請求', o.sales.length > 0 && o.sales.every((s) => s.invoice_id)],
  ];
  const curIdx = steps.findIndex((s) => !s[1]);
  return `<div class="flow">${steps.map(([l, done], i) => `<div class="st ${done ? 'done' : ''} ${i === curIdx ? 'cur' : ''}"><i></i>${l}</div>`).join('')}</div>`;
}

route('/orders/:id', async (el, { id }) => {
  const o = await api(`orders/${id}`);
  const live = o.items.filter((i) => i.status !== 'cancelled');
  const openItems = o.items.filter((i) => i.status === 'open' && i.source === 'po');
  const unsetPrice = live.some((i) => i.sell_price == null);
  const sellable = o.items.filter((i) => i.sold_qty < i.qty && i.status !== 'cancelled');
  const cancelled = o.status === 'cancelled';
  el.innerHTML = `<div class="crumb"><a href="#/orders">受注</a> ›</div>
    <div class="page-h"><h1>受注 ${esc(o.no)}</h1>${badge('order', o.status)} ${badge('source', o.source)}${o.quote_no ? ` <a class="badge navy" href="#/quotes/${o.quote_id}">見積 ${esc(o.quote_no)}</a>` : ''}
      <div class="acts">${cancelled ? '' : `<button class="btn" id="edit">内容を編集</button><button class="btn danger" id="cancel">受注を取消</button>`}</div></div>
    ${cancelled ? '' : orderFlow(o)}
    ${o.requests.filter((r) => r.status === 'pending').map((r) => `<div class="warnbox mb"><b>お客様から${r.kind === 'cancel' ? '取消' : '変更'}の依頼があります</b>（${esc(r.requester || '')}・${dt(r.created_at)}）<div style="white-space:pre-wrap;margin:6px 0">${esc(r.message || '')}</div>
      <div class="row"><button class="btn sm pri" data-cr="${r.id}" data-ok="1">承認する${r.kind === 'cancel' ? '（受注を取消）' : ''}</button><button class="btn sm" data-cr="${r.id}" data-ok="0">却下する</button></div></div>`).join('')}
    ${o.source !== 'manual' && o.source !== 'quote' && !o.price_confirmed && !cancelled ? `<div class="info mb">お客様からの注文です。売単価を入れて「お客様へ価格を回答」を押すと、お客様にメールで回答し、ポータルにも金額が表示されます。</div>` : ''}
    <div class="grid g3">
      <div class="card"><div class="ch"><h2>お客様</h2></div><div class="cb"><dl class="kv">
        <dt>得意先</dt><dd><b>${esc(o.customer_name)}</b></dd><dt>現場</dt><dd>${esc(o.site_name || '—')}</dd><dt>注文者</dt><dd>${esc(o.orderer_name || '—')}</dd>
        <dt>注文番号・件名</dt><dd>${esc(o.customer_ref || '—')}</dd><dt>連絡事項</dt><dd style="white-space:pre-wrap">${esc(o.customer_note || '—')}</dd></dl></div></div>
      <div class="card"><div class="ch"><h2>お届け先</h2></div><div class="cb"><dl class="kv">
        <dt>住所</dt><dd>${o.ship_zip ? `〒${esc(o.ship_zip)} ` : ''}${esc(o.ship_address || '—')}</dd><dt>受取人</dt><dd>${esc(o.ship_name || '—')} ${esc(o.ship_tel || '')}</dd>
        <dt>希望納期</dt><dd>${jd(o.desired_date) || '—'}</dd><dt>納期連絡</dt><dd>${o.eta_notified_at ? `送信済（${dt(o.eta_notified_at)}）` : '<span class="badge org">未連絡</span>'}</dd></dl></div></div>
      <div class="card"><div class="ch"><h2>社内</h2></div><div class="cb"><dl class="kv">
        <dt>担当</dt><dd>${esc(o.staff_name || '—')}（${esc(o.branch_name || '')}）</dd><dt>受注日</dt><dd>${dt(o.created_at)}</dd>
        <dt>金額（税抜）</dt><dd class="b">${yen(o.amount)}</dd><dt>粗利</dt><dd>${yen(o.amount - o.cost)}（${o.amount ? pct((o.amount - o.cost) / o.amount) : '—'}）</dd>
        <dt>社内メモ</dt><dd style="white-space:pre-wrap">${esc(o.internal_note || '—')}</dd></dl></div></div>
    </div>
    <div class="card mt"><div class="ch"><h2>明細</h2>
      <div class="acts">${cancelled ? '' : `
        ${unsetPrice || !o.price_confirmed ? `<button class="btn sm" id="prices">${icon('yen')} 売単価の一括登録</button>` : ''}
        ${o.source === 'portal' || o.source === 'qr' ? `<button class="btn sm ${o.price_confirmed ? '' : 'org'}" id="notify-price">${icon('mail')} お客様へ価格を回答</button>` : ''}
        ${openItems.length ? `<button class="btn sm" id="gen-po">発注書を作成（下書き）</button><button class="btn sm pri" id="send-po">${icon('send')} 仕入先ごとに発注して送信</button>` : ''}
        <button class="btn sm ${live.every((i) => i.eta_date) && !o.eta_notified_at ? 'teal' : ''}" id="notify-eta">${icon('mail')} お客様へ納期を送る</button>
        ${sellable.length ? `<button class="btn sm pri" id="sale">${icon('yen')} 売上計上</button>` : ''}
        ${o.items.some((i) => i.sold_qty > i.returned_qty) ? '<button class="btn sm" id="ret">返品</button>' : ''}`}</div></div>
      <div class="cb p0 tbl-wrap"><table class="tbl"><thead><tr><th>メーカー・品番</th><th>品名</th><th class="r">数量</th><th class="r">売単価</th><th class="r">金額</th><th class="r">仕入単価</th><th>仕入先・手配</th><th>回答納期</th><th>状態</th><th class="r">計上</th><th></th></tr></thead><tbody>
      ${o.items.map((it) => `<tr class="${it.status === 'cancelled' ? 'dim' : ''}"><td><span class="sub">${esc(it.maker || '')}</span><div><b>${esc(it.code || '')}</b></div></td><td>${esc(it.name || '')}<div class="sub">${esc(it.spec || '')}</div></td>
        <td class="r">${qtyf(it.qty)} ${esc(it.unit || '')}</td><td class="r">${it.sell_price == null ? '<span class="badge org">未入力</span>' : n0(it.sell_price)}</td><td class="r">${n0(it.qty * (it.sell_price || 0))}</td><td class="r">${n0(it.cost_price)}</td>
        <td>${it.source === 'stock' ? '<span class="badge teal">自社在庫から引当</span>' : `${esc(it.supplier_name || '<未設定>')}${it.po_no ? `<div class="sub"><a href="#/purchases/${it.po_id}">${esc(it.po_no)}</a></div>` : ''}`}</td>
        <td>${it.eta_date ? `<b>${jd(it.eta_date)}</b>` : '—'}</td><td>${badge('item', it.status)}</td><td class="r small">${it.sold_qty ? `${qtyf(it.sold_qty)}${it.returned_qty ? `<div class="neg">返品${qtyf(it.returned_qty)}</div>` : ''}` : ''}</td>
        <td class="nowrap">${it.status === 'open' && !cancelled ? `<button class="btn ghost sm" data-split="${it.id}" title="数量を分けて別手配">分割</button><button class="btn ghost sm" data-stock="${it.id}">在庫引当</button><button class="btn ghost sm" data-icancel="${it.id}">取消</button>` : ''}
          ${it.source === 'stock' && !it.sold_qty && !cancelled ? `<button class="btn ghost sm" data-unstock="${it.id}">引当解除</button>` : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">合計（税抜）</td><td class="r">${n0(o.amount)}</td><td class="r">${n0(o.cost)}</td><td colspan="5"></td></tr></tfoot></table></div></div>
    <div class="grid g2 mt">
      <div class="card"><div class="ch"><h2>発注</h2></div><div class="cb p0">${table([
        { h: '発注番号', v: (r) => `<a href="#/purchases/${r.id}">${esc(r.no)}</a>` }, { h: '仕入先', v: (r) => esc(r.supplier_name) }, { h: '状態', v: (r) => badge('po', r.status) },
        { h: '送信', v: (r) => `<span class="small">${dt(r.sent_at)}</span>` }, { h: '回答', v: (r) => `<span class="small">${dt(r.answered_at)}</span>` },
      ], o.pos, { empty: 'まだ発注していません' })}</div></div>
      <div class="card"><div class="ch"><h2>売上・返品</h2></div><div class="cb p0">${table([
        { h: '伝票', v: (r) => `${esc(r.no)} ${r.kind === 'return' ? '<span class="badge red">返品</span>' : ''}` }, { h: '日付', v: (r) => jd(r.sale_date) },
        { h: '金額（税抜）', r: 1, v: (r) => `<span class="${r.subtotal < 0 ? 'neg' : ''}">${n0(r.subtotal)}</span>` }, { h: '請求', v: (r) => (r.invoice_no ? esc(r.invoice_no) : '<span class="badge">未請求</span>') },
        { h: '', v: (r) => `<a class="btn sm" href="/doc/delivery/${r.id}" target="_blank" rel="noopener">${r.kind === 'return' ? '返品伝票' : '納品書'}</a>${r.invoice_id ? '' : ` <button class="btn sm ghost danger" data-delsale="${r.id}">取消</button>`}` },
      ], o.sales, { empty: 'まだ売上計上していません' })}</div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="ch"><h2>お客様とのやりとり</h2></div><div class="cb p0">${o.requests.length ? `<table class="tbl">${o.requests.map((r) => `<tr><td>${r.kind === 'cancel' ? '取消依頼' : '変更依頼'}</td><td style="white-space:pre-wrap">${esc(r.message || '')}${r.reply ? `<div class="sub">回答：${esc(r.reply)}</div>` : ''}</td><td>${r.status === 'pending' ? '<span class="badge org">未対応</span>' : r.status === 'approved' ? '<span class="badge green">承認</span>' : '<span class="badge red">却下</span>'}</td><td class="small">${dt(r.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty">依頼はありません</div>'}</div></div>
      <div class="card"><div class="ch"><h2>送信したメール</h2></div><div class="cb p0">${o.mails.length ? `<table class="tbl">${o.mails.map((m) => `<tr><td>${esc(m.subject)}<div class="sub">${esc(m.to_addr)}</div></td><td>${m.status === 'failed' ? '<span class="badge red">失敗</span>' : m.status === 'sent' ? '<span class="badge green">送信</span>' : '<span class="badge">記録</span>'}</td><td class="small">${dt(m.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty">まだ送信していません</div>'}</div></div>
    </div>`;

  const reload = () => go(`#/orders/${id}`);
  const B = (sel, fn) => { const b = $(sel); if (b) b.onclick = () => fn(b); };
  $$('[data-cr]').forEach((b) => { b.onclick = async () => {
    const ok = b.dataset.ok === '1';
    const reply = await promptBox(ok ? '依頼を承認' : '依頼を却下', { label: 'お客様への回答（メールで送信されます）', textarea: true, value: ok ? '承知いたしました。' : '' });
    if (reply === null) return;
    run(b, async () => { await api(`change-requests/${b.dataset.cr}/decide`, { method: 'POST', body: { approve: ok, reply } }); reload(); }, '回答しました');
  }; });
  B('#cancel', async (b) => { if (await confirmBox('この受注を取り消します。発注済みの仕入先には取消メールを送ります。', { danger: true, ok: '取り消す' })) run(b, async () => { await api(`orders/${id}/cancel`, { method: 'POST', body: {} }); reload(); }, '取り消しました'); });
  B('#gen-po', (b) => run(b, async () => { const r = await api(`orders/${id}/generate-po`, { method: 'POST', body: {} }); toast(`発注書を${r.ids.length}件作成しました（下書き）`); reload(); }));
  B('#send-po', async (b) => {
    const sups = [...new Set(openItems.map((i) => i.supplier_name || '（未設定）'))];
    if (!(await confirmBox(`未発注の明細を仕入先ごとに分けて発注書を作り、メールで送信します。\n\n送信先：${sups.join('、')}`, { ok: '発注して送信' }))) return;
    run(b, async () => { const r = await api(`orders/${id}/order-and-send`, { method: 'POST', body: {} }); if (r.errors.length) toast(r.errors.join('\n'), 'err'); else toast(`${r.ids.length}社へ発注書を送信しました`); reload(); });
  });
  B('#notify-eta', async (b) => {
    const missing = live.filter((i) => !i.eta_date).length;
    if (!(await confirmBox(`${o.customer_name} へ納期をメールで送ります。${missing ? `\n※ 納期が未回答の明細が ${missing} 件あります（「確認中」と記載されます）。` : ''}`, { ok: '送信' }))) return;
    run(b, async () => { await api(`orders/${id}/notify-eta`, { method: 'POST', body: {} }); reload(); }, '納期を送りました');
  });
  B('#notify-price', async (b) => { if (await confirmBox(`${o.customer_name} へ価格を回答します（メール送信とポータルへの表示）。`, { ok: '回答する' })) run(b, async () => { await api(`orders/${id}/notify-price`, { method: 'POST', body: {} }); reload(); }, '価格を回答しました'); });
  B('#prices', () => {
    modal({ title: '売単価の一括登録', size: 'wide', body: `<div class="row mb"><label class="f" style="width:220px"><span>空欄の明細に掛率でまとめて入れる（%）</span><input id="bulk-r" placeholder="例：55"></label></div>
      <table class="tbl"><thead><tr><th>品番・品名</th><th class="r">数量</th><th class="r">定価</th><th class="r">仕入単価</th><th class="r">売単価</th></tr></thead><tbody>
      ${live.map((it) => `<tr><td><b>${esc(it.code || '')}</b> ${esc(it.name || '')}</td><td class="r">${qtyf(it.qty)}</td><td class="r">${n0(it.list_price)}</td><td class="r">${n0(it.cost_price)}</td><td class="r"><input class="in-num" data-pid="${it.id}" value="${esc(it.sell_price ?? '')}" data-lp="${it.list_price || 0}" style="width:110px"></td></tr>`).join('')}</tbody></table>`,
    actions: [{ label: 'キャンセル' }, { label: '保存', cls: 'pri', onClick: async (m) => {
      const r = num($('#bulk-r', m.el).value);
      const items = $$('[data-pid]', m.el).map((x) => { let v = num(x.value); if (v == null && r != null) v = floor0(Number(x.dataset.lp) * (r > 1.5 ? r / 100 : r)); return { id: Number(x.dataset.pid), sell_price: v }; });
      await api(`orders/${id}/prices`, { method: 'POST', body: { items } }); toast('売単価を保存しました'); reload();
    } }] });
  });
  B('#sale', () => {
    modal({ title: '売上計上', size: 'wide', body: `<div class="form mb" style="grid-template-columns:200px 1fr">${field('売上日（納品日）', `<input type="date" id="s-date" value="${today()}">`)}${field('メモ', '<input id="s-note">')}</div>
      <p class="small muted" style="margin-top:0">計上する数量を確認してください。出荷済み・在庫引当済みの明細にはあらかじめ数量が入っています。</p>
      <table class="tbl"><thead><tr><th>品番・品名</th><th>状態</th><th class="r">受注数</th><th class="r">計上済</th><th class="r">今回計上</th><th class="r">売単価</th></tr></thead><tbody>
      ${sellable.map((it) => `<tr><td><b>${esc(it.code || '')}</b> ${esc(it.name || '')}</td><td>${badge('item', it.status)}</td><td class="r">${qtyf(it.qty)}</td><td class="r">${qtyf(it.sold_qty)}</td>
        <td class="r"><input class="in-num" data-sid="${it.id}" value="${['shipped'].includes(it.status) || (it.source === 'stock') ? it.qty - it.sold_qty : ''}" style="width:80px"></td>
        <td class="r"><input class="in-num" data-sp="${it.id}" value="${esc(it.sell_price ?? '')}" style="width:100px"></td></tr>`).join('')}</tbody></table>`,
    actions: [{ label: 'キャンセル' }, { label: '計上する', cls: 'pri', onClick: async (m) => {
      const items = $$('[data-sid]', m.el).map((x) => ({ order_item_id: Number(x.dataset.sid), qty: num(x.value) || 0, price: $(`[data-sp="${x.dataset.sid}"]`, m.el).value })).filter((x) => x.qty > 0);
      if (!items.length) throw new Error('計上する数量を入れてください');
      await api(`orders/${id}/sale`, { method: 'POST', body: { sale_date: $('#s-date', m.el).value, note: $('#s-note', m.el).value, items } });
      toast('売上を計上しました'); reload();
    } }] });
  });
  B('#ret', () => {
    const rs = o.items.filter((i) => i.sold_qty > i.returned_qty);
    modal({ title: '返品（赤伝）', size: 'wide', body: `<div class="form mb" style="grid-template-columns:200px 1fr">${field('返品日', `<input type="date" id="r-date" value="${today()}">`)}${field('理由・メモ', '<input id="r-note" value="返品">')}</div>
      <label class="chk mb"><input type="checkbox" id="r-stock"> 自社在庫に戻す</label>
      <table class="tbl mt8"><thead><tr><th>品番・品名</th><th class="r">売上数</th><th class="r">返品済</th><th class="r">今回返品</th><th class="r">単価</th></tr></thead><tbody>
      ${rs.map((it) => `<tr><td><b>${esc(it.code || '')}</b> ${esc(it.name || '')}</td><td class="r">${qtyf(it.sold_qty)}</td><td class="r">${qtyf(it.returned_qty)}</td><td class="r"><input class="in-num" data-rid="${it.id}" style="width:80px"></td><td class="r"><input class="in-num" data-rp="${it.id}" value="${esc(it.sell_price ?? '')}" style="width:100px"></td></tr>`).join('')}</tbody></table>
      <p class="small muted">返品は次の請求書にマイナス行として載ります。</p>`,
    actions: [{ label: 'キャンセル' }, { label: '返品を登録', cls: 'danger', onClick: async (m) => {
      const items = $$('[data-rid]', m.el).map((x) => ({ order_item_id: Number(x.dataset.rid), qty: num(x.value) || 0, price: $(`[data-rp="${x.dataset.rid}"]`, m.el).value })).filter((x) => x.qty > 0);
      if (!items.length) throw new Error('返品数量を入れてください');
      await api(`orders/${id}/return`, { method: 'POST', body: { sale_date: $('#r-date', m.el).value, note: $('#r-note', m.el).value, restock: $('#r-stock', m.el).checked, items } });
      toast('返品を登録しました'); reload();
    } }] });
  });
  $$('[data-split]').forEach((b) => { b.onclick = async () => { const v = await promptBox('数量の分割', { label: '別に手配する数量（例：残りを別の仕入先へ）' }); if (v) run(b, async () => { await api(`order-items/${b.dataset.split}/split`, { method: 'POST', body: { qty: v } }); reload(); }, '分割しました。分けた行の仕入先を「内容を編集」で変更できます'); }; });
  $$('[data-stock]').forEach((b) => { b.onclick = () => run(b, async () => { await api(`order-items/${b.dataset.stock}/stock`, { method: 'POST', body: {} }); reload(); }, '自社在庫から引き当てました'); });
  $$('[data-unstock]').forEach((b) => { b.onclick = () => run(b, async () => { await api(`order-items/${b.dataset.unstock}/unstock`, { method: 'POST', body: {} }); reload(); }, '引当を解除しました'); });
  $$('[data-icancel]').forEach((b) => { b.onclick = async () => { if (await confirmBox('この明細を取り消します。', { danger: true })) run(b, async () => { await api(`order-items/${b.dataset.icancel}/cancel`, { method: 'POST', body: {} }); reload(); }); }; });
  $$('[data-delsale]').forEach((b) => { b.onclick = async () => { if (await confirmBox('この売上伝票を取り消します（請求前のみ）。', { danger: true })) run(b, async () => { await api(`sales/${b.dataset.delsale}`, { method: 'DELETE' }); reload(); }, '売上を取り消しました'); }; });
  B('#edit', async () => {
    const sites = (await api(`m/sites?customer_id=${o.customer_id}`)).rows;
    const items = o.items.filter((i) => i.status !== 'cancelled').map((i) => ({ ...i }));
    modal({ title: '受注の編集', size: 'xwide', body: `<div class="form g3f mb" id="eh">
      ${field('現場', sel('site_id', opts(sites, o.site_id, { blank: '（なし）' })))}${field('担当者', sel('staff_id', opts(App.lk.users, o.staff_id, { blank: false })))}${field('希望納期', inp('desired_date', o.desired_date, { type: 'date' }))}
      ${field('納品先住所', inp('ship_address', o.ship_address), { full: true })}${field('受取人', inp('ship_name', o.ship_name))}${field('電話', inp('ship_tel', o.ship_tel))}${field('郵便番号', inp('ship_zip', o.ship_zip))}
      ${field('注文者', inp('orderer_name', o.orderer_name))}${field('注文番号・件名', inp('customer_ref', o.customer_ref))}${field('社内メモ', inp('internal_note', o.internal_note))}</div>
      <p class="small muted">発注済み・引当済みの明細は、品番・数量・仕入先を変更できません（単価のみ変更可）。</p><div class="tbl-wrap" id="eed"></div>`,
    onOpen: (m) => orderItemEditor($('#eed', m.el), items, { locked: (it) => it.id && it.status !== 'open' }),
    actions: [{ label: 'キャンセル' }, { label: '保存', cls: 'pri', onClick: async (m) => {
      await api(`orders/${id}`, { method: 'PUT', body: { ...formData($('#eh', m.el)), items: items.filter((x) => x.code || x.name) } });
      toast('保存しました'); reload();
    } }] });
  });
}, { nav: 'orders' });

// ================= 発注 =================
route('/purchases', async (el, p, q) => {
  const draw = async () => {
    const f = { status: q.status || '', supplier_id: q.supplier_id || '', purpose: q.purpose || '', q: q.q || '', scope: getScope() };
    const d = await api(`purchases${qs(f)}`);
    const drafts = d.rows.filter((r) => r.status === 'draft');
    el.innerHTML = `<div class="page-h"><h1>発注</h1><span class="sub">仕入先には発注書メールで回答ページのリンクが届きます。回答は自動で受注に反映されます。</span>
      <div class="acts">${drafts.length ? `<button class="btn pri" id="bulk">${icon('send')} 下書き ${drafts.length}件をまとめて送信</button>` : ''}<a class="btn" href="#/purchases/new">${icon('plus')} 在庫補充・枠取りの発注</a></div></div>
      <div class="filters">${scopeSeg(draw)}
        <select id="f-status">${opts(Object.entries(LABELS.po).map(([id, v]) => ({ id, name: v[0] })), f.status, { blank: 'すべての状態' })}</select>
        <select id="f-sup">${opts(App.lk.suppliers, f.supplier_id, { blank: 'すべての仕入先' })}</select>
        <select id="f-pur">${opts([{ id: 'order', name: '受注分' }, { id: 'stock', name: '在庫補充・枠取り' }], f.purpose, { blank: '発注の種類' })}</select>
        <input type="search" id="f-q" placeholder="番号・仕入先・得意先で検索" value="${esc(f.q)}"></div>
      <div class="card"><div class="cb p0">${table([
        { h: '発注番号', v: (r) => `<b>${esc(r.no)}</b>${r.purpose === 'stock' ? ' <span class="badge teal">在庫</span>' : ''}` },
        { h: '仕入先', v: (r) => esc(r.supplier_name) }, { h: '受注・得意先', v: (r) => (r.order_no ? `${esc(r.order_no)}<div class="sub">${esc(r.customer_name || '')}</div>` : '—') },
        { h: '担当', v: (r) => esc(r.staff_name || '') }, { h: '明細', r: 1, v: (r) => r.item_cnt }, { h: '金額', r: 1, v: (r) => n0(r.amount) },
        { h: '送信', v: (r) => `<span class="small">${dt(r.sent_at)}</span>` }, { h: '回答納期', v: (r) => jd(r.eta_max) }, { h: '状態', v: (r) => badge('po', r.status) },
      ], d.rows, { onRow: true, empty: '該当する発注はありません' })}</div></div>`;
    bindRows(el, d.rows, (r) => go(`#/purchases/${r.id}`));
    const upd = () => { Object.assign(q, { status: $('#f-status').value, supplier_id: $('#f-sup').value, purpose: $('#f-pur').value, q: $('#f-q').value }); setQuery(q); draw(); };
    ['#f-status', '#f-sup', '#f-pur'].forEach((s) => { $(s).onchange = upd; });
    let t; $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(upd, 350); };
    const bulk = $('#bulk'); if (bulk) bulk.onclick = async () => {
      if (!(await confirmBox(`下書きの発注書 ${drafts.length}件を仕入先へメール送信します。`, { ok: '送信' }))) return;
      run(bulk, async () => { const r = await api('purchases/send-bulk', { method: 'POST', body: { ids: drafts.map((x) => x.id) } }); const ng = r.results.filter((x) => !x.ok); if (ng.length) toast(ng.map((x) => x.error).join('\n'), 'err'); else toast('送信しました'); draw(); });
    };
  };
  await draw();
}, { nav: 'purchases' });

route('/purchases/new', async (el) => {
  const items = [{ qty: 1, unit: '個' }];
  el.innerHTML = `<div class="crumb"><a href="#/purchases">発注</a> ›</div><div class="page-h"><h1>在庫補充・枠取りの発注</h1><span class="sub">受注に紐づかない発注です。入荷したら「入荷処理」で自社在庫に加わります。</span>
    <div class="acts"><button class="btn pri" id="save">下書きを作成</button></div></div>
    <div class="card"><div class="cb"><div class="form g3f" id="h">
      ${field('仕入先', sel('supplier_id', opts(App.lk.suppliers, '')), { req: true })}${field('希望納期', inp('desired_date', '', { type: 'date' }))}${field('納品先', inp('ship_address', '', { ph: '空欄なら弊社' }))}
      ${field('備考', ta('note'), { full: true })}</div></div></div>
    <div class="card"><div class="ch"><h2>明細</h2></div><div class="cb p0 tbl-wrap" id="ed"></div></div>`;
  orderItemEditor($('#ed'), items);
  $('#save').onclick = (e) => run(e.target, async () => {
    const r = await api('purchases', { method: 'POST', body: { ...formData($('#h')), items: items.filter((x) => x.code || x.name) } });
    go(`#/purchases/${r.id}`);
  }, '発注書を作成しました');
}, { nav: 'purchases' });

route('/purchases/:id', async (el, { id }) => {
  const po = await api(`purchases/${id}`);
  const link = `${App.me.base_url}/r/${po.token}`;
  const st = po.status;
  el.innerHTML = `<div class="crumb"><a href="#/purchases">発注</a> ›</div>
    <div class="page-h"><h1>発注 ${esc(po.no)}</h1>${badge('po', st)}${po.purpose === 'stock' ? ' <span class="badge teal">在庫補充</span>' : ''}${po.order_id ? ` <a class="badge navy" href="#/orders/${po.order_id}">受注 ${esc(po.order_no)}</a>` : ''}
      <div class="acts"><a class="btn" href="/doc/po/${po.token}" target="_blank" rel="noopener">${icon('print')} 発注書</a>
        ${st === 'draft' ? `<button class="btn pri" id="send">${icon('send')} 仕入先へ送信</button>` : ''}
        ${st === 'sent' ? `<button class="btn" id="resend">${icon('mail')} 再送信</button>` : ''}
        ${['sent', 'answered', 'ship_requested'].includes(st) ? '<button class="btn" id="manual">回答を代理入力</button>' : ''}
        ${po.purpose === 'order' && ['answered', 'sent'].includes(st) ? `<button class="btn teal" id="ship">${icon('truck')} 出荷指示</button>` : ''}
        ${['ship_requested', 'answered'].includes(st) ? '<button class="btn" id="shipped">出荷済みにする</button>' : ''}
        ${po.purpose === 'stock' && ['answered', 'shipped', 'sent', 'ship_requested'].includes(st) ? '<button class="btn teal" id="receive">入荷処理（在庫に加える）</button>' : ''}
        ${!['shipped', 'received', 'cancelled'].includes(st) ? '<button class="btn danger" id="cancel">取消</button>' : ''}</div></div>
    <div class="grid g3">
      <div class="card"><div class="ch"><h2>仕入先</h2></div><div class="cb"><dl class="kv"><dt>仕入先</dt><dd><b>${esc(po.supplier_name)}</b></dd><dt>メール</dt><dd>${esc(po.supplier_email || '未登録')}</dd>
        <dt>回答ページ</dt><dd>${st === 'draft' ? '<span class="muted">送信後に有効</span>' : `<a href="${esc(link)}" target="_blank" rel="noopener">開く</a> <button class="btn sm ghost" id="copy">リンクをコピー</button>`}</dd></dl></div></div>
      <div class="card"><div class="ch"><h2>納品先</h2></div><div class="cb"><dl class="kv"><dt>住所</dt><dd>${esc(po.ship_address || '弊社')}</dd><dt>受取人</dt><dd>${esc(po.ship_name || '')} ${esc(po.ship_tel || '')}</dd><dt>希望納期</dt><dd>${jd(po.desired_date) || '—'}</dd><dt>備考</dt><dd>${esc(po.note || '')}</dd></dl></div></div>
      <div class="card"><div class="ch"><h2>経過</h2></div><div class="cb"><dl class="kv"><dt>送信</dt><dd>${dt(po.sent_at) || '—'}</dd><dt>回答</dt><dd>${dt(po.answered_at) || '—'} ${esc(po.answer_person || '')}</dd>
        <dt>出荷指示</dt><dd>${dt(po.ship_requested_at) || '—'}</dd><dt>出荷</dt><dd>${jd(po.shipped_at) || '—'} ${po.tracking_no ? `送り状 ${esc(po.tracking_no)}` : ''}</dd>${po.received_at ? `<dt>入荷</dt><dd>${dt(po.received_at)}</dd>` : ''}</dl></div></div></div>
    ${po.answer_comment || po.shipping_fee ? `<div class="info mt">仕入先コメント：${esc(po.answer_comment || '')}${po.shipping_fee ? `　送料：${yen(po.shipping_fee)}` : ''}</div>` : ''}
    <div class="card mt"><div class="ch"><h2>明細と回答</h2></div><div class="cb p0 tbl-wrap"><table class="tbl"><thead><tr><th>メーカー・品番</th><th>品名</th><th class="r">数量</th><th class="r">定価</th><th class="r">発注単価</th><th class="r">回答単価</th><th>回答納期</th><th>代替品・備考</th></tr></thead><tbody>
      ${po.items.map((it) => `<tr><td><span class="sub">${esc(it.maker || '')}</span><div><b>${esc(it.code || '')}</b></div></td><td>${esc(it.name || '')}</td><td class="r">${qtyf(it.qty)} ${esc(it.unit || '')}${it.answer_qty != null && it.answer_qty !== it.qty ? `<div class="neg small">回答 ${qtyf(it.answer_qty)}</div>` : ''}</td>
        <td class="r">${n0(it.list_price)}</td><td class="r">${st === 'draft' ? `<input class="in-num" data-cp="${it.id}" value="${esc(it.cost_price ?? '')}" style="width:100px">` : n0(it.cost_price)}</td>
        <td class="r ${it.answer_price != null && it.answer_price !== it.cost_price ? 'b' : ''}">${n0(it.answer_price)}</td><td>${it.answer_date ? `<b>${jd(it.answer_date)}</b>` : '<span class="muted">未回答</span>'}</td>
        <td class="small">${it.alt_code ? `代替：${esc(it.alt_code)} ${esc(it.alt_name || '')}<br>` : ''}${esc(it.answer_note || '')}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="5">合計</td><td class="r">${n0(po.amount)}</td><td colspan="2"></td></tr></tfoot></table></div>
      ${st === 'draft' ? '<div class="cb"><button class="btn sm" id="save-cp">発注単価を保存</button></div>' : ''}</div>
    <div class="card mt"><div class="ch"><h2>送信したメール</h2></div><div class="cb p0">${po.mails.length ? `<table class="tbl">${po.mails.map((m) => `<tr><td>${esc(m.subject)}<div class="sub">${esc(m.to_addr)}</div></td><td>${m.status === 'failed' ? '<span class="badge red">失敗</span>' : m.status === 'sent' ? '<span class="badge green">送信</span>' : '<span class="badge">記録</span>'}</td><td class="small">${dt(m.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty">まだ送信していません</div>'}</div></div>`;
  const reload = () => go(`#/purchases/${id}`);
  const B = (s, fn) => { const b = $(s); if (b) b.onclick = () => fn(b); };
  B('#copy', () => { navigator.clipboard?.writeText(link); toast('回答ページのリンクをコピーしました'); });
  B('#send', (b) => run(b, async () => { await api(`purchases/${id}/send`, { method: 'POST', body: {} }); reload(); }, '仕入先へ送信しました'));
  B('#resend', (b) => run(b, async () => { await api(`purchases/${id}/send`, { method: 'POST', body: {} }); reload(); }, '再送信しました'));
  B('#save-cp', (b) => run(b, async () => { await api(`purchases/${id}`, { method: 'PUT', body: { items: $$('[data-cp]').map((x) => ({ id: Number(x.dataset.cp), cost_price: x.value })) } }); reload(); }, '保存しました'));
  B('#cancel', async (b) => { if (await confirmBox('この発注を取り消します。送信済みの場合は仕入先へ取消メールを送ります。', { danger: true, ok: '取り消す' })) run(b, async () => { await api(`purchases/${id}/cancel`, { method: 'POST', body: {} }); reload(); }, '取り消しました'); });
  B('#receive', async (b) => { if (await confirmBox('入荷処理をして、数量を自社在庫に加えます。', { ok: '入荷処理' })) run(b, async () => { await api(`purchases/${id}/receive`, { method: 'POST', body: {} }); reload(); }, '在庫に加えました'); });
  B('#ship', async (b) => { const note = await promptBox('出荷指示', { label: '仕入先への連絡事項（任意）', textarea: true }); if (note !== null) run(b, async () => { await api(`purchases/${id}/ship-request`, { method: 'POST', body: { note } }); reload(); }, '出荷指示を送りました'); });
  B('#shipped', () => modal({ title: '出荷済みにする', body: `<div class="form">${field('出荷日', `<input type="date" id="sd" value="${today()}">`)}${field('送り状番号', '<input id="tn">')}</div>`,
    actions: [{ label: 'キャンセル' }, { label: '登録', cls: 'pri', onClick: async (m) => { await api(`purchases/${id}/shipped`, { method: 'POST', body: { shipped_date: $('#sd', m.el).value, tracking_no: $('#tn', m.el).value } }); toast('出荷済みにしました'); reload(); } }] }));
  B('#manual', () => modal({ title: '回答を代理入力（電話・FAXで聞いた回答）', size: 'wide', body: `<table class="tbl"><thead><tr><th>品番</th><th class="r">数量</th><th>納期</th><th class="r">仕入単価</th><th>備考</th></tr></thead><tbody>
    ${po.items.map((it) => `<tr><td><b>${esc(it.code || '')}</b> ${esc(it.name || '')}</td><td class="r">${qtyf(it.qty)}</td><td><input type="date" data-ad="${it.id}" value="${esc(it.answer_date || '')}"></td><td><input class="in-num" data-ap="${it.id}" value="${esc(it.answer_price ?? it.cost_price ?? '')}" style="width:110px"></td><td><input data-an="${it.id}" value="${esc(it.answer_note || '')}"></td></tr>`).join('')}</tbody></table>
    <div class="form mt">${field('送料', `<input class="in-num" id="fee" value="${esc(po.shipping_fee ?? '')}">`)}${field('コメント', `<input id="cm" value="${esc(po.answer_comment || '')}">`)}</div>`,
  actions: [{ label: 'キャンセル' }, { label: '回答を登録', cls: 'pri', onClick: async (m) => {
    await api(`purchases/${id}/answer`, { method: 'POST', body: { items: po.items.map((it) => ({ id: it.id, answer_date: $(`[data-ad="${it.id}"]`, m.el).value, answer_price: $(`[data-ap="${it.id}"]`, m.el).value, answer_note: $(`[data-an="${it.id}"]`, m.el).value })), shipping_fee: $('#fee', m.el).value, comment: $('#cm', m.el).value } });
    toast('回答を登録しました'); reload();
  } }] }));
}, { nav: 'purchases' });

// ================= 出荷指示 =================
route('/shipments', async (el) => {
  const draw = async () => {
    const d = await api(`shipments${qs({ scope: getScope() })}`);
    const groups = [['answered', '出荷指示待ち（仕入先の回答済み）'], ['ship_requested', '出荷待ち（出荷指示済み）'], ['shipped', '出荷済み']];
    el.innerHTML = `<div class="page-h"><h1>出荷指示</h1><span class="sub">仕入先から回答が届いた発注に、現場への直送などの出荷指示を出します。</span><div class="acts">${scopeSeg(draw)}</div></div>
      ${groups.map(([st, label]) => { const rows = d.rows.filter((r) => r.status === st); return `<div class="card"><div class="ch"><h2>${label}</h2><span class="badge">${rows.length}件</span></div><div class="cb p0">${table([
        { h: '発注番号', v: (r) => `<a href="#/purchases/${r.id}">${esc(r.no)}</a>` }, { h: '仕入先', v: (r) => esc(r.supplier_name) },
        { h: '受注・現場', v: (r) => `<a href="#/orders/${r.order_id}">${esc(r.order_no || '')}</a><div class="sub">${esc(r.customer_name || '')} ${esc(r.site_name || '')}</div>` },
        { h: '納品先', v: (r) => `<span class="small">${esc(r.ship_address || '弊社')}</span>` }, { h: '回答納期', v: (r) => `<b>${jd(r.eta_max)}</b>` },
        { h: '', v: (r) => (st === 'answered' ? `<button class="btn sm teal" data-ship="${r.id}">${icon('truck')} 出荷指示</button>` : st === 'shipped' ? `<span class="small">${jd(r.shipped_at)} ${esc(r.tracking_no || '')}</span>` : `<span class="small">${dt(r.ship_requested_at)}</span>`) },
      ], rows, { empty: 'ありません' })}</div></div>`; }).join('')}`;
    $$('[data-ship]').forEach((b) => { b.onclick = async () => { const note = await promptBox('出荷指示', { label: '仕入先への連絡事項（任意）', textarea: true }); if (note !== null) run(b, async () => { await api(`purchases/${b.dataset.ship}/ship-request`, { method: 'POST', body: { note } }); draw(); }, '出荷指示を送りました'); }; });
  };
  await draw();
}, { nav: 'shipments' });

// ================= 納期カレンダー =================
route('/calendar', async (el, p, q) => {
  const draw = async () => {
    const month = q.month || today().slice(0, 7);
    const d = await api(`calendar${qs({ month, staff_id: q.staff_id, branch_id: q.branch_id, customer_id: q.customer_id })}`);
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1); const start = new Date(y, m - 1, 1 - first.getDay());
    const byDate = {}; d.events.forEach((ev) => { (byDate[ev.eta_date] = byDate[ev.eta_date] || []).push(ev); });
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const x = new Date(start); x.setDate(start.getDate() + i);
      const ds = `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
      if (i >= 35 && x.getMonth() !== m - 1) break;
      const evs = byDate[ds] || [];
      cells.push(`<div class="d ${x.getMonth() !== m - 1 ? 'out' : ''} ${ds === today() ? 'today' : ''} ${x.getDay() === 0 ? 'sun' : x.getDay() === 6 ? 'sat' : ''}"><div class="dn">${x.getDate()}</div>
        ${evs.slice(0, 6).map((ev) => `<a class="ev ${ev.status}" href="#/orders/${ev.order_id}" title="${esc(`${ev.customer_name} ${ev.site_name || ''}\n${ev.maker || ''} ${ev.code} ${ev.name} ×${ev.qty}\n${ev.supplier_name || ''}`)}">${esc(ev.site_name || ev.customer_name)}：${esc(ev.code || ev.name)}</a>`).join('')}
        ${evs.length > 6 ? `<div class="xs muted">他 ${evs.length - 6}件</div>` : ''}</div>`);
    }
    const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
    const ym = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}`;
    el.innerHTML = `<div class="page-h"><h1>納期カレンダー</h1><span class="sub">仕入先が回答した納期を月表示で共有します。</span></div>
      <div class="filters"><button class="btn sm" data-m="${ym(prev)}">‹ 前月</button><b style="font-size:16px;margin:0 6px">${y}年${m}月</b><button class="btn sm" data-m="${ym(next)}">翌月 ›</button><button class="btn sm ghost" data-m="${today().slice(0, 7)}">今月</button>
        <select id="f-staff">${opts(App.lk.users, q.staff_id, { blank: 'すべての担当者' })}</select><select id="f-branch">${opts(App.lk.branches, q.branch_id, { blank: 'すべての営業所' })}</select>
        <select id="f-cust">${opts(App.lk.customers, q.customer_id, { blank: 'すべてのお客様' })}</select>
        <span class="legend" style="margin-left:auto"><span><i style="background:var(--teal-l)"></i>回答済</span><span><i style="background:var(--navy-l)"></i>出荷済</span><span><i style="background:var(--line2)"></i>納品済</span></span></div>
      <div class="card" style="overflow:hidden"><div class="cal">${['日', '月', '火', '水', '木', '金', '土'].map((w) => `<div class="dh">${w}</div>`).join('')}${cells.join('')}</div></div>
      <div class="card mt"><div class="ch"><h2>${m}月の納品予定一覧</h2><span class="badge">${d.events.length}明細</span></div><div class="cb p0">${table([
        { h: '納期', v: (r) => `<b>${jd(r.eta_date)}</b>` }, { h: 'お客様・現場', v: (r) => `${esc(r.customer_name)}<div class="sub">${esc(r.site_name || '')}</div>` },
        { h: '品番・品名', v: (r) => `<b>${esc(r.code || '')}</b> ${esc(r.name || '')}` }, { h: '数量', r: 1, v: (r) => `${qtyf(r.qty)} ${esc(r.unit || '')}` },
        { h: '仕入先', v: (r) => esc(r.source === 'stock' ? '自社在庫' : r.supplier_name || '') }, { h: '担当', v: (r) => esc(r.staff_name || '') }, { h: '状態', v: (r) => badge('item', r.status) },
        { h: '受注', v: (r) => `<a href="#/orders/${r.order_id}">${esc(r.order_no)}</a>` },
      ], d.events, { empty: 'この月の納品予定はありません' })}</div></div>`;
    $$('[data-m]').forEach((b) => { b.onclick = () => { q.month = b.dataset.m; setQuery(q); draw(); }; });
    const upd = () => { Object.assign(q, { staff_id: $('#f-staff').value, branch_id: $('#f-branch').value, customer_id: $('#f-cust').value }); setQuery(q); draw(); };
    ['#f-staff', '#f-branch', '#f-cust'].forEach((s) => { $(s).onchange = upd; });
  };
  await draw();
}, { nav: 'calendar' });
