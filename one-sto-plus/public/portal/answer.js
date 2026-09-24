/* 仕入先回答ページ（ログイン不要。発注書メールのリンクから開く） */
'use strict';
(async () => {
  const token = location.pathname.split('/').pop();
  const load = async () => {
    let po;
    try { po = await xapi(`/sapi/${encodeURIComponent(token)}`); } catch (e) {
      document.body.innerHTML = `<main class="center"><div class="card loginbox">${LOGO}<div class="err" style="margin-top:16px">${esc(e.message)}</div></div></main>`; return;
    }
    const answered = !!po.answered_at;
    const cancelled = po.status === 'cancelled';
    const shippedDone = ['shipped', 'received'].includes(po.status);
    document.body.innerHTML = `<header class="bar"><div class="in">${LOGO}<div class="who">${esc(po.company.name)}</div></div></header>
    <main><h1 style="margin-bottom:0">御発注書への回答</h1><p class="small muted" style="margin-top:2px">${esc(po.supplier_name)} 御中　／　発注番号 ${esc(po.no)}（${jd(po.sent_at)}）</p>
      ${cancelled ? '<div class="err">この発注は取り消されました。お手数をおかけし申し訳ございません。</div>' : ''}
      ${po.status === 'ship_requested' ? `<div class="warn"><b>出荷のお願い</b>が届いています。${po.ship_request_note ? `<br>${esc(po.ship_request_note)}` : ''}<br>出荷されたら、ページ下の「出荷のご連絡」から出荷日を入力してください。</div>` : ''}
      ${shippedDone ? `<div class="ok">出荷のご連絡をいただきました（${jd(po.shipped_at)}${po.tracking_no ? `・送り状 ${esc(po.tracking_no)}` : ''}）。ありがとうございました。</div>` : answered && !cancelled ? `<div class="ok">ご回答ありがとうございます（${dt(po.answered_at)}）。内容を変更する場合は、修正して再度送信してください。</div>` : !cancelled ? '<div class="info">納期・仕入単価をご入力のうえ「回答を送信」を押してください。アカウント登録は不要です。</div>' : ''}
      <div class="card"><dl class="kv"><dt>納品先</dt><dd>${po.ship_zip ? `〒${esc(po.ship_zip)} ` : ''}${esc(po.ship_address || po.company.name)}</dd><dt>受取人</dt><dd>${esc(po.ship_name || '')} ${esc(po.ship_tel || '')}</dd>
        <dt>希望納期</dt><dd>${jd(po.desired_date) || '—'}</dd>${po.note ? `<dt>備考</dt><dd>${esc(po.note)}</dd>` : ''}<dt>担当</dt><dd>${esc(po.staff_name || '')}　${esc(po.company.tel || '')}</dd></dl>
        <p class="small" style="margin-bottom:0"><a href="/doc/po/${encodeURIComponent(token)}" target="_blank" rel="noopener">発注書を表示・印刷する</a></p></div>
      <form id="af">${po.items.map((it) => `<div class="ans-item" data-id="${it.id}"><div class="hd"><b>${esc(it.code || '')}</b><span class="small muted">${esc(it.maker || '')}</span><span class="sp"></span><b>${qtyf(it.qty)}${esc(it.unit || '')}</b></div>
          <div class="small" style="margin:-4px 0 8px">${esc(it.name || '')} ${esc(it.spec || '')}　<span class="muted">定価 ${n0(it.list_price)}${it.cost_price != null ? `／発注単価 ${n0(it.cost_price)}` : ''}</span></div>
          <div class="ans-grid"><label class="f"><span>納期<em>*</em></span><input type="date" name="answer_date" value="${esc(it.answer_date || '')}" ${cancelled || shippedDone ? 'disabled' : ''}></label>
            <label class="f"><span>仕入単価</span><input name="answer_price" inputmode="numeric" value="${esc(it.answer_price ?? it.cost_price ?? '')}" ${cancelled || shippedDone ? 'disabled' : ''}></label>
            <label class="f"><span>代替品番（ある場合）</span><input name="alt_code" value="${esc(it.alt_code || '')}" ${cancelled || shippedDone ? 'disabled' : ''}></label>
            <label class="f"><span>備考</span><input name="answer_note" value="${esc(it.answer_note || '')}" placeholder="例：メーカー欠品のため分納" ${cancelled || shippedDone ? 'disabled' : ''}></label></div></div>`).join('')}
        ${cancelled || shippedDone ? '' : `<div class="card"><div class="grid2"><label class="f"><span>送料（かかる場合）</span><input name="shipping_fee" inputmode="numeric" value="${esc(po.shipping_fee ?? '')}"></label><label class="f"><span>ご回答者名</span><input name="person" value="${esc(po.answer_person || '')}"></label></div>
          <label class="f"><span>コメント</span><textarea name="comment">${esc(po.answer_comment || '')}</textarea></label>
          <label class="f" style="margin-bottom:0"><input type="checkbox" id="sameall" style="width:auto"> すべての明細の納期を1行目と同じにする</label></div>
          <button class="btn pri block" type="submit">${answered ? '回答を更新する' : '回答を送信'}</button>`}</form>
      ${['answered', 'ship_requested', 'sent'].includes(po.status) && answered ? `<form class="card" id="sf" style="margin-top:14px"><h2>出荷のご連絡</h2><div class="grid2"><label class="f"><span>出荷日</span><input type="date" name="shipped_date" value="${todayStr()}"></label><label class="f"><span>送り状番号</span><input name="tracking_no"></label></div>
        <label class="f"><span>備考</span><input name="note"></label><button class="btn teal block" type="submit">出荷したことを連絡する</button></form>` : ''}
      <p class="xs muted c" style="margin-top:20px">${esc(po.company.name)}　${esc(po.company.address || '')}　TEL ${esc(po.company.tel || '')}${po.company.fax ? `　FAX ${esc(po.company.fax)}` : ''}</p></main>`;
    const af = $('#af');
    const same = $('#sameall'); if (same) same.onchange = () => { if (!same.checked) return; const v = $('[name=answer_date]', af).value; $$('[name=answer_date]', af).forEach((x) => { x.value = v; }); };
    af.onsubmit = (e) => { e.preventDefault(); busy($('button[type=submit]', af), async () => {
      const items = $$('.ans-item', af).map((box) => ({ id: Number(box.dataset.id), answer_date: $('[name=answer_date]', box).value, answer_price: $('[name=answer_price]', box).value, alt_code: $('[name=alt_code]', box).value, answer_note: $('[name=answer_note]', box).value }));
      if (items.some((x) => !x.answer_date)) throw new Error('すべての明細の納期を入れてください（未定の場合は備考にご記入ください）');
      await xapi(`/sapi/${encodeURIComponent(token)}/answer`, { method: 'POST', body: { items, shipping_fee: af.shipping_fee.value, person: af.person.value, comment: af.comment.value } });
      toast('回答を送信しました。ありがとうございます'); load();
    }); };
    const sf = $('#sf'); if (sf) sf.onsubmit = (e) => { e.preventDefault(); busy($('button', sf), async () => {
      await xapi(`/sapi/${encodeURIComponent(token)}/shipped`, { method: 'POST', body: Object.fromEntries(new FormData(sf).entries()) });
      toast('出荷のご連絡を受け付けました'); load();
    }); };
  };
  load();
})();
