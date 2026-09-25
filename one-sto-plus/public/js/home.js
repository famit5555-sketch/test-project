/* ログイン・ダッシュボード */
'use strict';

App.pages.login = () => {
  document.body.innerHTML = `<div class="login"><form class="box" id="lf">
    ${logo('#/login')}
    <h1>住宅設備商社のための 見積・受発注・請求クラウド</h1>
    <div class="form" style="grid-template-columns:1fr">
      ${field('ログインID', inp('login', '', { attrs: 'autocomplete="username" required' }))}
      ${field('パスワード', inp('password', '', { type: 'password', attrs: 'autocomplete="current-password" required' }))}
      <button class="btn pri" type="submit" style="padding:10px">ログイン</button>
      <p class="small muted" style="margin:0">お客様は <a href="/portal/">お客様ポータル</a> からログインしてください。</p>
    </div></form><div class="stripe"><i></i><i></i><i></i></div></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('button', e.target);
    await run(b, async () => {
      await api('login', { method: 'POST', body: formData(e.target) });
      App.me = null; document.body.innerHTML = '';
      location.hash = '#/';
    });
  };
};

const DASH_ICON = { inbox: 'inbox', cart: 'cart', draft: 'draft', mail: 'mail', truck: 'truck', yen: 'yen', alert: 'alert', doc: 'doc', clock: 'clock' };
route('/', async (el) => {
  const draw = async () => {
    const d = await api(`dashboard${qs({ scope: getScope() })}`);
    const card = (c, wait) => `<a class="dcard ${wait ? 'wait' : ''} ${c.count ? 'hot' : 'zero'}" href="${c.link}">
      <span class="ico">${icon(DASH_ICON[c.icon] || 'doc')}</span><span><span class="n">${c.count}<small>件</small></span><span class="l">${esc(c.label)}</span><span class="h">${esc(c.hint)}</span></span></a>`;
    const k = d.kpi;
    el.innerHTML = `<div class="page-h"><h1>ダッシュボード</h1><span class="sub">今日やることと、相手の返事待ちを一覧で確認できます。カードを押すと該当の一覧へ移動します。</span>
      <div class="acts">${scopeSeg(draw)}</div></div>
      <div class="kpis">
        <div class="kpi"><div class="l">今月の見積</div><div class="v">${yen(k.quotes_month.amt)}</div><div class="s">${k.quotes_month.n}件</div></div>
        <div class="kpi"><div class="l">今月の受注</div><div class="v">${yen(k.orders_month.amt)}</div><div class="s">${k.orders_month.n}件</div></div>
        <div class="kpi"><div class="l">今月の売上（税抜）</div><div class="v">${yen(k.sales_month.amt)}</div><div class="s">${k.sales_month.n}伝票</div></div>
        <div class="kpi"><div class="l">今週の納品予定</div><div class="v">${k.eta_week.n}<small style="font-size:14px">明細</small></div><div class="s"><a href="#/calendar">納期カレンダーを見る</a></div></div>
      </div>
      <div class="sec-t"><span class="dot"></span>要対応</div>
      <div class="dash-cards">${d.todo.map((c) => card(c)).join('')}</div>
      <div class="sec-t"><span class="dot t"></span>相手の返事待ち</div>
      <div class="dash-cards">${d.waiting.map((c) => card(c, true)).join('')}</div>
      <div class="grid g2 mt">
        <div class="card"><div class="ch"><h2>お知らせ</h2><div class="acts"><button class="btn sm ghost" id="readall">すべて既読にする</button></div></div>
          <div class="cb p0">${d.notifications.length ? `<ul class="notice-list">${d.notifications.map((n) => `<li class="${n.is_read ? '' : 'unread'}"><a href="${esc(n.link || '#/')}">${esc(n.message)}</a><span class="t">${dt(n.created_at)}</span></li>`).join('')}</ul>` : '<div class="empty">お知らせはありません</div>'}</div></div>
        <div class="card"><div class="ch"><h2>すぐに始める</h2></div><div class="cb" style="display:grid;gap:8px">
          <a class="btn pri" href="#/quotes/new?ai=1">${icon('ai')} 仕入先の見積書をAIで読み取って見積を作る</a>
          <a class="btn" href="#/quotes/new">${icon('doc')} 見積を手入力で作る</a>
          <a class="btn" href="#/orders/new">${icon('inbox')} 受注を入力する（電話・FAXの注文）</a>
          <a class="btn" href="#/invoices/close">${icon('bill')} 締めて請求書を作る</a>
          <a class="btn" href="#/budget">${icon('target')} 予算の達成率を見る</a>
        </div></div></div>`;
    $('#readall').onclick = async () => { await api('notifications/read', { method: 'POST', body: {} }); App.me.unread = 0; layout(); draw(); };
  };
  await draw();
}, { nav: 'home' });
