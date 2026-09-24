/* 現場QR注文（ログイン不要） */
'use strict';
(async () => {
  const token = location.pathname.split('/').pop();
  let info;
  try { info = await xapi(`/qapi/${encodeURIComponent(token)}`); } catch (e) {
    document.body.innerHTML = `<main class="center"><div class="card loginbox">${LOGO}<div class="err" style="margin-top:16px">${esc(e.message)}</div></div></main>`; return;
  }
  const saved = (() => { try { return JSON.parse(localStorage.getItem('osp.qr.who') || '{}'); } catch (_) { return {}; } })();
  const form = () => {
    document.body.innerHTML = `<header class="bar"><div class="in">${LOGO}<div class="who">${esc(info.company_name)}</div></div></header>
    <main><h1 style="margin-bottom:2px">${esc(info.site.name)}</h1><p class="small muted" style="margin-top:0">${esc(info.customer_name)} 様　／　お届け先：${esc(info.site.address || 'この現場')}</p>
      <div class="info">品番と数量を入れて送信してください。ログインは不要です。価格・納期は担当者から連絡します。</div>
      <form id="f"><div class="card"><h2>ご注文の品</h2><div id="items"></div></div>
      <div class="card"><div class="grid2"><label class="f"><span>お名前<em>*</em></span><input name="orderer_name" required value="${esc(saved.name || '')}" autocomplete="name"></label>
        <label class="f"><span>電話番号</span><input name="tel" type="tel" value="${esc(saved.tel || '')}" autocomplete="tel"></label>
        <label class="f"><span>希望納期</span><input name="desired_date" type="date" min="${todayStr()}"></label></div>
        <label class="f"><span>連絡事項</span><textarea name="note" placeholder="例：至急／午前中着希望"></textarea></label></div>
      <button class="btn teal block" type="submit">注文を送信する</button></form>
      <p class="xs muted c" style="margin-top:18px">お問い合わせ：${esc(info.company_name)} ${esc(info.company_tel || '')}</p></main>`;
    const ed = orderItems($('#items'), `/qapi/${encodeURIComponent(token)}/products?q=`);
    $('#f').onsubmit = (e) => { e.preventDefault(); busy($('button[type=submit]', e.target), async () => {
      const items = ed.values();
      if (!items.length) throw new Error('品番と数量を入れてください');
      const body = Object.fromEntries(new FormData(e.target).entries());
      try { localStorage.setItem('osp.qr.who', JSON.stringify({ name: body.orderer_name, tel: body.tel })); } catch (_) { /* noop */ }
      const r = await xapi(`/qapi/${encodeURIComponent(token)}/order`, { method: 'POST', body: { ...body, items } });
      document.querySelector('main').innerHTML = `<div class="ok" style="margin-top:20px"><b>ご注文を受け付けました</b><br>受付番号：${esc(r.no)}<br>担当者から納期をご連絡します。</div>
        <button class="btn block" id="again">続けて注文する</button>`;
      $('#again').onclick = form;
    }); };
  };
  form();
})();
