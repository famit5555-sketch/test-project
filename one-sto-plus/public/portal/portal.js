/* お客様ポータル */
'use strict';
const P = { me: null };
const STATUS_BADGE = { 受付済み: 'navy', 手配中: 'navy', 納期回答済み: 'teal', 出荷済み: 'teal', 納品済み: 'green', 取消: 'red' };

function shell(tab, html) {
  document.body.innerHTML = `<header class="bar"><div class="in">${LOGO}<div class="who"><b>${esc(P.me.customer.name)}</b><br>${esc(P.me.user.name)} 様</div><button class="btn sm" id="out">ログアウト</button></div>
    <nav class="tabs">${[['home', '#/', 'ホーム'], ['order', '#/order', '注文する'], ['orders', '#/orders', '注文履歴'], ['invoices', '#/invoices', '請求'], ['sites', '#/sites', '現場・倉庫']].map(([k, h, l]) => `<a href="${h}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav></header>
    <main id="main">${html}</main>`;
  $('#out').onclick = async () => { await xapi('/papi/logout', { method: 'POST', body: {} }); P.me = null; location.hash = '#/login'; render(); };
}

function loginView() {
  document.body.innerHTML = `<main class="center"><form class="card loginbox" id="lf">${LOGO}<h1 style="margin-top:18px">お客様ポータル</h1>
    <p class="small muted" style="margin-top:-6px">注文・納期・請求をいつでも確認できます。</p>
    <label class="f"><span>ログインID</span><input name="login" autocomplete="username" required></label>
    <label class="f"><span>パスワード</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn pri block" type="submit">ログイン</button>
    <p class="xs muted" style="margin-bottom:0">アカウントは担当営業にお問い合わせください。<a href="/manual/customer" target="_blank" rel="noopener">使い方</a></p></form></main><div class="stripe"><i></i><i></i><i></i></div>`;
  $('#lf').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => {
    await xapi('/papi/login', { method: 'POST', body: { login: e.target.login.value, password: e.target.password.value } });
    location.hash = '#/'; render();
  }); };
}

async function homeView() {
  const [orders, invs] = await Promise.all([xapi('/papi/orders'), xapi('/papi/invoices')]);
  const open = orders.filter((o) => !['納品済み', '取消'].includes(o.display_status));
  shell('home', `<h1>こんにちは、${esc(P.me.user.name)} 様</h1>
    <div class="kpis"><div class="kpi"><div class="l">進行中のご注文</div><div class="v">${open.length}件</div></div>
      <div class="kpi"><div class="l">次回の請求予定金額（税込）</div><div class="v">${yen(P.me.unbilled_with_tax)}</div><div class="xs muted">${esc(P.me.closing)}・未請求のお買上</div></div>
      <div class="kpi"><div class="l">最新の請求書</div><div class="v">${invs[0] ? yen(invs[0].total_amount) : '—'}</div><div class="xs muted">${invs[0] ? `${jd(invs[0].closing_date)}締め` : ''}</div></div></div>
    <a class="btn teal block" href="#/order" style="margin-bottom:14px">＋ 新しく注文する</a>
    <div class="card p0"><div style="padding:14px 16px 4px"><h2>進行中のご注文</h2></div>${open.length ? open.slice(0, 8).map(orderLine).join('') : '<p class="muted" style="padding:0 16px 10px">進行中のご注文はありません。</p>'}</div>
    <div class="card"><h2>担当者</h2><dl class="kv"><dt>担当</dt><dd>${esc(P.me.customer.staff_name || '')}</dd><dt>営業所</dt><dd>${esc(P.me.customer.branch_name || '')} ${esc(P.me.customer.branch_tel || '')}</dd>${P.me.customer.staff_email ? `<dt>メール</dt><dd><a href="mailto:${esc(P.me.customer.staff_email)}">${esc(P.me.customer.staff_email)}</a></dd>` : ''}</dl></div>`);
}
const orderLine = (o) => `<a class="list-item" href="#/orders/${o.id}"><div class="row"><b>${esc(o.no)}</b><span class="badge ${STATUS_BADGE[o.display_status] || ''}">${esc(o.display_status)}</span><span class="sp"></span><span class="small muted">${jd(o.created_at)}</span></div>
  <div class="small">${esc(o.site_name || o.customer_ref || '')}　${o.item_cnt}品目${o.eta ? `　<b>納期 ${jd(o.eta)}</b>` : ''}${o.amount != null ? `　${yen(o.amount)}（税抜）` : '　<span class="muted">価格確認中</span>'}</div></a>`;

async function orderView() {
  const sites = await xapi('/papi/sites');
  shell('order', `<h1>注文する</h1>
    <div class="info">品番と数量を入れて送信してください。価格は担当者が確認してご回答します。</div>
    <form id="of"><div class="card"><h2>お届け先</h2>
      <label class="f"><span>現場・倉庫</span><select name="site_id"><option value="">（住所を直接入力する）</option>${sites.map((s) => `<option value="${s.id}">${s.kind === 'warehouse' ? '［倉庫］' : ''}${esc(s.name)}</option>`).join('')}</select></label>
      <div class="grid2"><label class="f" style="grid-column:1/-1"><span>お届け先住所</span><input name="ship_address"></label>
        <label class="f"><span>受取人</span><input name="ship_name"></label><label class="f"><span>受取人の電話</span><input name="ship_tel" type="tel"></label>
        <label class="f"><span>郵便番号</span><input name="ship_zip"></label><label class="f"><span>希望納期</span><input name="desired_date" type="date" min="${todayStr()}"></label></div>
      <a href="#/sites" class="small">＋ 現場・倉庫を登録する</a></div>
    <div class="card"><h2>ご注文の品</h2><div id="items"></div></div>
    <div class="card"><div class="grid2"><label class="f"><span>ご注文者</span><input name="orderer_name" value="${esc(P.me.user.name)}"></label><label class="f"><span>御社の注文番号・件名（任意）</span><input name="customer_ref"></label></div>
      <label class="f"><span>連絡事項（任意）</span><textarea name="note" placeholder="例：午前中着でお願いします"></textarea></label></div>
    <button class="btn pri block" type="submit">注文を送信する</button></form>`);
  const ed = orderItems($('#items'), '/papi/products?q=');
  const f = $('#of');
  f.site_id.onchange = () => { const s = sites.find((x) => x.id === Number(f.site_id.value)); if (!s) return; f.ship_address.value = s.address || ''; f.ship_name.value = s.receiver || ''; f.ship_tel.value = s.tel || ''; f.ship_zip.value = s.zip || ''; };
  f.onsubmit = (e) => { e.preventDefault(); busy($('button[type=submit]', f), async () => {
    const items = ed.values();
    if (!items.length) throw new Error('品番と数量を入れてください');
    const body = Object.fromEntries(new FormData(f).entries());
    const r = await xapi('/papi/orders', { method: 'POST', body: { ...body, items } });
    toast(`ご注文を受け付けました（${r.no}）`);
    location.hash = `#/orders/${r.id}`;
  }); };
}

async function ordersView() {
  const orders = await xapi('/papi/orders');
  shell('orders', `<h1>注文履歴</h1><div class="card p0">${orders.length ? orders.map(orderLine).join('') : '<p class="muted" style="padding:16px">まだご注文はありません。</p>'}</div>`);
}

async function orderDetailView(id) {
  const o = await xapi(`/papi/orders/${id}`);
  const pending = o.requests.find((r) => r.status === 'pending');
  shell('orders', `<p class="small"><a href="#/orders">‹ 注文履歴</a></p><h1>ご注文 ${esc(o.no)} <span class="badge ${STATUS_BADGE[o.display_status] || ''}">${esc(o.display_status)}</span></h1>
    ${o.price_confirmed ? '' : '<div class="warn">価格は担当者が確認中です。確定するとメールでお知らせし、ここにも表示されます。</div>'}
    <div class="card"><dl class="kv"><dt>ご注文日</dt><dd>${dt(o.created_at)}</dd><dt>現場</dt><dd>${esc(o.site_name || '—')}</dd><dt>お届け先</dt><dd>${esc(o.ship_address || '—')} ${esc(o.ship_name || '')}</dd>
      <dt>希望納期</dt><dd>${jd(o.desired_date) || '—'}</dd><dt>ご注文者</dt><dd>${esc(o.orderer_name || '')}</dd>${o.customer_note ? `<dt>連絡事項</dt><dd>${esc(o.customer_note)}</dd>` : ''}<dt>担当</dt><dd>${esc(o.staff_name || '')}</dd></dl></div>
    <div class="card p0"><table class="t"><thead><tr><th>品番・品名</th><th class="r">数量</th><th>納期</th>${o.price_confirmed ? '<th class="r">単価</th><th class="r">金額</th>' : ''}</tr></thead><tbody>
      ${o.items.map((it) => `<tr style="${it.status === 'cancelled' ? 'text-decoration:line-through;color:#999' : ''}"><td><b>${esc(it.code || '')}</b><div class="small">${esc(it.maker || '')} ${esc(it.name || '')}</div></td><td class="r">${qtyf(it.qty)}${esc(it.unit || '')}</td>
        <td>${it.eta_date ? `<b>${jd(it.eta_date)}</b>` : '<span class="muted small">確認中</span>'}${it.status === 'shipped' ? '<div><span class="badge teal">出荷済み</span></div>' : it.status === 'delivered' ? '<div><span class="badge green">納品済み</span></div>' : ''}</td>
        ${o.price_confirmed ? `<td class="r">${n0(it.sell_price)}</td><td class="r">${n0((it.sell_price || 0) * it.qty)}</td>` : ''}</tr>`).join('')}</tbody>
      ${o.price_confirmed ? `<tfoot><tr><td colspan="4" class="r b">合計（税抜）</td><td class="r b">${n0(o.amount)}</td></tr></tfoot>` : ''}</table></div>
    ${o.requests.length ? `<div class="card"><h2>取消・変更のご依頼</h2>${o.requests.map((r) => `<div style="border-bottom:1px solid var(--line2);padding:8px 0"><span class="badge ${r.status === 'pending' ? 'org' : r.status === 'approved' ? 'green' : 'red'}">${r.kind === 'cancel' ? '取消' : '変更'}・${r.status === 'pending' ? '確認中' : r.status === 'approved' ? '承認' : 'お受けできませんでした'}</span> <span class="xs muted">${dt(r.created_at)}</span><div class="small">${esc(r.message || '')}</div>${r.reply ? `<div class="small">回答：${esc(r.reply)}</div>` : ''}</div>`).join('')}</div>` : ''}
    ${o.status === 'open' && !pending ? `<div class="card"><h2>取消・変更のご依頼</h2><p class="small muted" style="margin-top:0">担当者が確認して、承認・却下をご連絡します。</p>
      <label class="f"><span>内容</span><textarea id="rq" placeholder="例：数量を2台に変更したい／納期を1週間遅らせたい"></textarea></label>
      <div class="row"><button class="btn" id="chg">変更を依頼する</button><button class="btn danger" id="cxl">取消を依頼する</button></div></div>` : ''}`);
  const send = (kind) => (e) => busy(e.target, async () => {
    if (kind === 'cancel' && !confirm('このご注文の取消を依頼しますか？')) return;
    await xapi(`/papi/orders/${id}/request`, { method: 'POST', body: { kind, message: $('#rq').value } });
    toast('ご依頼を送信しました'); orderDetailView(id);
  });
  if ($('#chg')) { $('#chg').onclick = send('change'); $('#cxl').onclick = send('cancel'); }
}

async function invoicesView() {
  const [invs, unb] = await Promise.all([xapi('/papi/invoices'), xapi('/papi/unbilled')]);
  shell('invoices', `<h1>請求</h1>
    <div class="card"><h2>次回の請求予定（${esc(P.me.closing)}）</h2><div style="font-size:24px;font-weight:700">${yen(P.me.unbilled_with_tax)} <span class="small muted">税込・概算</span></div>
      ${unb.length ? `<table class="t" style="margin-top:8px"><tbody>${unb.map((s) => `<tr><td>${jd(s.sale_date)}</td><td>${esc(s.order_no || '')}<div class="xs muted">${esc(s.site_name || '')}</div></td><td class="r ${s.subtotal < 0 ? 'neg' : ''}">${s.kind === 'return' ? '返品 ' : ''}${n0(s.subtotal)}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">未請求のお買上はありません。</p>'}</div>
    <div class="card p0"><table class="t"><thead><tr><th>締め日</th><th class="r">御請求額</th><th>お支払期日</th><th></th></tr></thead><tbody>
      ${invs.map((i) => `<tr><td>${jd(i.closing_date)}<div class="xs muted">${esc(i.no)}</div></td><td class="r b">${n0(i.total_amount)}</td><td>${jd(i.due_date)} ${i.status === 'paid' ? '<span class="badge green">入金済</span>' : ''}</td><td class="r"><a class="btn sm" href="/doc/invoice/${esc(i.token)}" target="_blank" rel="noopener">請求書</a></td></tr>`).join('') || '<tr><td colspan="4" class="muted">請求書はまだありません</td></tr>'}</tbody></table></div>`);
}

async function sitesView() {
  const sites = await xapi('/papi/sites');
  shell('sites', `<h1>現場・倉庫</h1><p class="small muted">登録しておくと、注文のときにお届け先・受取人がまとめて入ります。</p>
    <div class="card p0">${sites.length ? sites.map((s) => `<div class="list-item">${s.kind === 'warehouse' ? '<span class="badge teal">倉庫</span> ' : ''}<b>${esc(s.name)}</b><div class="small muted">${esc(s.address || '')} ${esc(s.receiver || '')} ${esc(s.tel || '')}</div></div>`).join('') : '<p class="muted" style="padding:16px">登録はありません</p>'}</div>
    <form class="card" id="sf"><h2>現場・倉庫を登録</h2><div class="grid2"><label class="f"><span>名称<em>*</em></span><input name="name" required></label><label class="f"><span>種類</span><select name="kind"><option value="site">現場</option><option value="warehouse">倉庫</option></select></label>
      <label class="f" style="grid-column:1/-1"><span>住所</span><input name="address"></label><label class="f"><span>受取人</span><input name="receiver"></label><label class="f"><span>電話</span><input name="tel" type="tel"></label><label class="f"><span>郵便番号</span><input name="zip"></label></div>
      <button class="btn pri" type="submit">登録する</button></form>`);
  $('#sf').onsubmit = (e) => { e.preventDefault(); busy($('button', e.target), async () => { await xapi('/papi/sites', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) }); toast('登録しました'); sitesView(); }); };
}

async function render() {
  const h = location.hash.replace(/^#/, '') || '/';
  if (h === '/login') return loginView();
  if (!P.me) { try { P.me = await xapi('/papi/me'); } catch (e) { location.hash = '#/login'; return loginView(); } }
  try {
    if (h === '/') await homeView();
    else if (h === '/order') await orderView();
    else if (h === '/orders') await ordersView();
    else if (h.startsWith('/orders/')) await orderDetailView(Number(h.split('/')[2]));
    else if (h === '/invoices') await invoicesView();
    else if (h === '/sites') await sitesView();
    else await homeView();
    scrollTo(0, 0);
  } catch (e) { if (e.status === 401) { P.me = null; location.hash = '#/login'; } else toast(e.message, true); }
}
addEventListener('hashchange', async () => { if (P.me) P.me = await xapi('/papi/me').catch(() => null); render(); });
render();
