/* 見積: 一覧・編集（AI読み取り・掛率計算・セット・版管理）・見積分析 */
'use strict';

// ================= 一覧 =================
route('/quotes', async (el, p, q) => {
  const draw = async () => {
    const f = { status: q.status || '', customer_id: q.customer_id || '', q: q.q || '', stale: q.stale || '', scope: getScope() };
    const d = await api(`quotes${qs(f)}`);
    const rows = d.rows;
    el.innerHTML = `<div class="page-h"><h1>見積一覧</h1><span class="sub">全社の見積が1か所に集まります。動いていない見積を追いかけて受注につなげましょう。</span>
      <div class="acts"><a class="btn pri" href="#/quotes/new?ai=1">${icon('ai')} AI読み取りで作成</a><a class="btn" href="#/quotes/new">${icon('plus')} 手入力で作成</a></div></div>
      <div class="filters">${scopeSeg(draw)}
        <select id="f-status">${opts([{ id: 'draft', name: '下書き' }, { id: 'negotiating', name: '商談中' }, { id: 'won', name: '受注確定' }, { id: 'lost', name: '失注' }], f.status, { blank: 'すべての状態' })}</select>
        <select id="f-cust">${opts(App.lk.customers, f.customer_id, { blank: 'すべての得意先' })}</select>
        <input type="search" id="f-q" placeholder="番号・件名・現場・得意先で検索" value="${esc(f.q)}">
        ${f.stale ? `<span class="badge org">${f.stale}日以上動いていない見積 <a href="#/quotes" style="margin-left:4px">×</a></span>` : ''}
        <span class="muted small" style="margin-left:auto">${rows.length}件　合計 ${yen(rows.reduce((a, r) => a + r.amount, 0))}</span></div>
      <div class="card"><div class="cb p0">${table([
        { h: '見積番号', v: (r) => `<b>${esc(r.no)}</b>${r.versions > 1 ? ` <span class="badge">第${r.version}版</span>` : ''}${r.submitted ? ' <span class="badge teal">提出版</span>' : ''}` },
        { h: '件名・現場', v: (r) => `${esc(r.title || '（件名なし）')}<div class="sub">${esc(r.site_name || r.project_name || '')}</div>` },
        { h: '得意先', v: (r) => esc(r.customer_name || '') },
        { h: '担当', v: (r) => esc(r.staff_name || '') },
        { h: '発行日', v: (r) => jd(r.issue_date) },
        { h: '金額（税抜）', r: 1, v: (r) => n0(r.amount) },
        { h: '粗利率', r: 1, v: (r) => (r.amount ? pct((r.amount - r.cost) / r.amount) : '—') },
        { h: '状態', v: (r) => badge('quote', r.status) + (r.lost_reason ? `<div class="sub">${esc(r.lost_reason)}</div>` : '') },
        { h: '最終更新', v: (r) => `<span class="small">${dt(r.updated_at)}</span>` },
      ], rows, { onRow: true, empty: '見積はまだありません' })}</div></div>`;
    bindRows(el, rows, (r) => go(`#/quotes/${r.id}`));
    const upd = () => { Object.assign(q, { status: $('#f-status').value, customer_id: $('#f-cust').value, q: $('#f-q').value }); setQuery(q); draw(); };
    $('#f-status').onchange = upd; $('#f-cust').onchange = upd;
    let t; $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(upd, 350); };
  };
  await draw();
}, { nav: 'quotes' });

// ================= 編集 =================
const blankItem = () => ({ set_name: '', maker: '', code: '', name: '', spec: '', qty: 1, unit: '個', list_price: 0, cost_rate: null, cost_price: null, sell_rate: null, sell_price: null, supplier_id: null, uncertain: 0, note: '' });

function recalc(it, changed) {
  const lp = Number(it.list_price) || 0;
  if (changed === 'list_price') {
    if (it.cost_rate != null) it.cost_price = floor0(lp * it.cost_rate);
    if (it.sell_rate != null) it.sell_price = floor0(lp * it.sell_rate);
  } else if (changed === 'cost_rate') { it.cost_price = it.cost_rate == null ? it.cost_price : floor0(lp * it.cost_rate); }
  else if (changed === 'cost_price') { it.cost_rate = lp && it.cost_price != null ? Math.round((it.cost_price / lp) * 10000) / 10000 : it.cost_rate; }
  else if (changed === 'sell_rate') { it.sell_price = it.sell_rate == null ? it.sell_price : floor0(lp * it.sell_rate); }
  else if (changed === 'sell_price') { it.sell_rate = lp && it.sell_price != null ? Math.round((it.sell_price / lp) * 10000) / 10000 : it.sell_rate; }
}
// セットの行を連続させる（最初に現れた位置にまとめる）
function groupSets(items) {
  const out = []; const seen = new Set();
  items.forEach((it) => {
    if (!it.set_name) { out.push(it); return; }
    if (seen.has(it.set_name)) return;
    seen.add(it.set_name);
    out.push(...items.filter((x) => x.set_name === it.set_name));
  });
  return out;
}

async function rateLookup(customerId, items) {
  const res = await api('rates/lookup-bulk', { method: 'POST', body: { customer_id: customerId || null, items: items.map((i) => ({ maker: i.maker, code: i.code })) } });
  return res;
}

route('/quotes/:id', async (el, { id }, query) => {
  const isNew = id === 'new';
  const q = isNew ? { status: 'draft', items: [blankItem()], issue_date: today(), show_set_detail: 1, staff_id: App.me.user.id, versions: [] } : await api(`quotes/${id}`);
  const locked = !!q.order_id;
  const state = { items: q.items.length ? q.items.map((x) => ({ ...x })) : [blankItem()], aiReadIds: [], dirty: false };
  const projects = (await api('m/projects')).rows;
  const statusActs = isNew ? '' : `
    <a class="btn" href="/doc/quote/${q.id}" target="_blank" rel="noopener">${icon('print')} 御見積書PDF</a>
    ${locked ? `<a class="btn teal" href="#/orders/${q.order_id}">受注 ${esc(q.order_no)} を開く</a>` : `<button class="btn teal" id="to-order">${icon('inbox')} 受注にする</button>`}`;
  el.innerHTML = `<div class="crumb"><a href="#/quotes">見積一覧</a> ›</div>
    <div class="page-h"><h1>${isNew ? '見積の作成' : `見積 ${esc(q.no)}`}</h1>
      ${isNew ? '' : `${badge('quote', q.status)} <span class="badge">第${q.version}版</span>${q.submitted ? ' <span class="badge teal">提出版</span>' : ''}`}
      <div class="acts">${statusActs}${locked ? '' : `<button class="btn pri" id="save">保存</button>`}</div></div>
    ${locked ? `<div class="info mb">この見積は受注 ${esc(q.order_no)} になっています。内容を変える場合は「新しい版を作る」を使ってください。</div>` : ''}
    <div id="ai-area"></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px">
      <div class="card"><div class="ch"><h2>見積の内容</h2></div><div class="cb"><div class="form g3f" id="head">
        ${field('得意先', sel('customer_id', opts(App.lk.customers, q.customer_id, { label: (c) => `${c.code || ''} ${c.name}` })), { req: true })}
        ${field('案件', sel('project_id', opts(projects, q.project_id, { blank: '（なし）' })))}
        ${field('現場名', inp('site_name', q.site_name))}
        ${field('件名', inp('title', q.title), { full: false })}
        ${field('担当者', sel('staff_id', opts(App.lk.users, q.staff_id, { blank: false })))}
        ${field('発行日', inp('issue_date', q.issue_date, { type: 'date' }))}
        ${field('有効期限', inp('valid_until', q.valid_until, { type: 'date' }))}
        ${field('納期', inp('delivery_terms', q.delivery_terms, { ph: '例：別途打合せ' }))}
        ${field('お支払条件', inp('payment_terms', q.payment_terms, { ph: '例：月末締め翌月末払い' }))}
        ${field('備考（御見積書に印字）', ta('note', q.note, 'style="min-height:44px"'), { full: true })}
        <label class="chk full"><input type="checkbox" name="show_set_detail" ${q.show_set_detail ? 'checked' : ''}> 御見積書でセットの内訳（品番・数量）も表示する</label>
      </div></div></div>
      <div class="card"><div class="ch"><h2>合計</h2></div><div class="cb" id="totals"></div>
        ${isNew ? '' : `<div class="cb" style="border-top:1px solid var(--line2)"><div class="small b mb" style="margin-bottom:6px">状態</div><div class="row">
          <button class="btn sm" data-st="negotiating">商談中</button><button class="btn sm danger" data-st="lost">失注にする</button><button class="btn sm" data-st="draft">下書き</button>
          <button class="btn sm" id="submit">提出版にする</button></div>
          <div class="small b mt" style="margin-bottom:6px">版の管理</div>
          <div class="row"><button class="btn sm" id="newver">新しい版を作る</button><button class="btn sm" id="copy">複製</button>${locked ? '' : '<button class="btn sm danger" id="del">削除</button>'}</div>
          ${q.versions.length > 1 ? `<table class="tbl mt8">${q.versions.map((v) => `<tr><td><a href="#/quotes/${v.id}">第${v.version}版</a>${v.id === q.id ? ' ◀' : ''}</td><td>${v.submitted ? '<span class="badge teal">提出</span>' : ''}</td><td class="r">${n0(v.amount)}</td></tr>`).join('')}</table>` : ''}
        </div>`}</div>
    </div>
    <div class="card"><div class="ch"><h2>品目編集</h2><span class="small muted">掛率を入れると単価と利益率を自動計算します。チェックした行を「セット」にまとめると御見積書で1行になります。</span>
      <div class="acts">${locked ? '' : `<button class="btn sm" id="ai-open">${icon('ai')} AIで読み取り</button><button class="btn sm" id="auto-rate">${icon('percent')} 掛率を自動設定</button>
        <button class="btn sm" id="bulk-rate">チェック行の売掛率を一括</button><button class="btn sm" id="mkset">チェック行をセットに</button><button class="btn sm" id="unset">セット解除</button><button class="btn sm danger" id="delrows">チェック行を削除</button>`}</div></div>
      <div class="cb p0 tbl-wrap" id="items"></div>
      ${locked ? '' : `<div class="cb"><button class="btn sm" id="addrow">${icon('plus')} 行を追加</button></div>`}</div>`;

  const head = $('#head');
  if (locked) $$('input,select,textarea', head).forEach((x) => { x.disabled = true; });
  const sups = App.lk.suppliers;
  const drawTotals = () => {
    const sum = state.items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.sell_price) || 0), 0);
    const cost = state.items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.cost_price) || 0), 0);
    const tax = Math.floor(sum * 0.1);
    $('#totals').innerHTML = `<dl class="kv"><dt>小計（税抜）</dt><dd class="r b">${yen(sum)}</dd><dt>消費税</dt><dd class="r">${yen(tax)}</dd><dt>合計（税込）</dt><dd class="r b" style="font-size:18px">${yen(sum + tax)}</dd>
      <dt>原価</dt><dd class="r">${yen(cost)}</dd><dt>粗利</dt><dd class="r ${sum - cost < 0 ? 'neg' : ''}">${yen(sum - cost)}</dd><dt>粗利率</dt><dd class="r b">${sum ? pct((sum - cost) / sum) : '—'}</dd></dl>`;
  };
  const rowCalc = (it) => {
    const amt = (Number(it.qty) || 0) * (Number(it.sell_price) || 0);
    const gp = it.sell_price ? ((it.sell_price - (it.cost_price || 0)) / it.sell_price) : null;
    return { amt, gp };
  };
  const drawItems = () => {
    state.items = groupSets(state.items);
    const dis = locked ? 'disabled' : '';
    let lastSet = null;
    const rows = [];
    state.items.forEach((it, i) => {
      if (it.set_name && it.set_name !== lastSet) {
        const g = state.items.filter((x) => x.set_name === it.set_name);
        const tot = g.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.sell_price) || 0), 0);
        rows.push(`<tr class="set-h"><td></td><td colspan="10">セット：${esc(it.set_name)}（${g.length}品目）</td><td class="calc">${n0(tot)}</td><td colspan="2"></td></tr>`);
      }
      lastSet = it.set_name || null;
      const c = rowCalc(it);
      rows.push(`<tr data-i="${i}" class="${it.uncertain ? 'unc' : ''} ${it.set_name ? 'inset' : ''}">
        <td><input type="checkbox" data-chk ${it._chk ? 'checked' : ''} ${dis}></td>
        <td><input data-f="code" value="${esc(it.code)}" style="width:118px" placeholder="品番" ${dis}><input data-f="maker" value="${esc(it.maker)}" style="width:118px;margin-top:2px" placeholder="メーカー" list="makers" class="sub-in" ${dis}></td>
        <td><input data-f="name" value="${esc(it.name)}" style="width:190px" placeholder="品名" ${dis}><input data-f="spec" value="${esc(it.spec)}" style="width:190px;margin-top:2px" placeholder="仕様・色" class="sub-in" ${dis}>${it.uncertain ? `<div class="xs" style="color:#b45309">要確認${it.note ? '：' + esc(it.note) : ''}</div>` : ''}</td>
        <td><input data-f="qty" class="in-num" value="${esc(it.qty)}" style="width:46px" ${dis}></td>
        <td><input data-f="unit" value="${esc(it.unit)}" style="width:40px" ${dis}></td>
        <td><input data-f="list_price" class="in-num" value="${esc(it.list_price ?? '')}" style="width:80px" ${dis}></td>
        <td><input data-f="cost_rate" class="in-num" value="${rate(it.cost_rate)}" style="width:46px" title="仕入掛率（%）" ${dis}></td>
        <td><input data-f="cost_price" class="in-num" value="${esc(it.cost_price ?? '')}" style="width:76px" ${dis}></td>
        <td><input data-f="sell_rate" class="in-num" value="${rate(it.sell_rate)}" style="width:46px" title="売掛率（%）" ${dis}></td>
        <td><input data-f="sell_price" class="in-num" value="${esc(it.sell_price ?? '')}" style="width:76px" ${dis}></td>
        <td class="calc" data-gp>${c.gp == null ? '—' : pct(c.gp)}</td>
        <td class="calc b" data-amt>${n0(c.amt)}</td>
        <td><select data-f="supplier_id" style="width:120px" ${dis}>${opts(sups, it.supplier_id, { blank: '（仕入先）' })}</select></td>
        <td class="nowrap">${locked ? '' : `<button class="btn ghost sm" data-up title="上へ">↑</button><button class="btn ghost sm" data-del title="削除">${icon('x')}</button>`}</td></tr>`);
    });
    $('#items').innerHTML = `<datalist id="makers">${App.lk.makers.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <table class="ed"><thead><tr><th></th><th>品番／メーカー</th><th>品名／仕様・色</th><th>数量</th><th>単位</th><th>定価</th><th>仕入掛率%</th><th>仕入単価</th><th>売掛率%</th><th>売単価</th><th>利益率</th><th>金額</th><th>仕入先</th><th></th></tr></thead>
      <tbody>${rows.join('')}</tbody></table>`;
    $$('#items tr[data-i]').forEach((tr) => {
      const it = state.items[Number(tr.dataset.i)];
      $$('[data-f]', tr).forEach((inpEl) => {
        inpEl.addEventListener('change', () => {
          const f = inpEl.dataset.f;
          let v = inpEl.value;
          if (['qty', 'list_price', 'cost_price', 'sell_price'].includes(f)) v = num(v);
          if (['cost_rate', 'sell_rate'].includes(f)) { v = num(v); if (v != null) v = v > 1.5 ? v / 100 : v; }
          if (f === 'supplier_id') v = v ? Number(v) : null;
          it[f] = v; it.uncertain = f === 'name' ? it.uncertain : it.uncertain;
          recalc(it, f);
          state.dirty = true;
          if (['list_price', 'cost_rate', 'cost_price', 'sell_rate', 'sell_price'].includes(f)) {
            $('[data-f=cost_rate]', tr).value = rate(it.cost_rate); $('[data-f=cost_price]', tr).value = it.cost_price ?? '';
            $('[data-f=sell_rate]', tr).value = rate(it.sell_rate); $('[data-f=sell_price]', tr).value = it.sell_price ?? '';
          }
          const c = rowCalc(it);
          $('[data-amt]', tr).textContent = n0(c.amt); $('[data-gp]', tr).textContent = c.gp == null ? '—' : pct(c.gp);
          drawTotals();
        });
      });
      $('[data-chk]', tr).onchange = (e) => { it._chk = e.target.checked; };
      const del = $('[data-del]', tr); if (del) del.onclick = () => { state.items.splice(Number(tr.dataset.i), 1); if (!state.items.length) state.items.push(blankItem()); state.dirty = true; drawItems(); drawTotals(); };
      const up = $('[data-up]', tr); if (up) up.onclick = () => { const i = Number(tr.dataset.i); if (i > 0) { [state.items[i - 1], state.items[i]] = [state.items[i], state.items[i - 1]]; drawItems(); } };
      if (!locked) attachProductSearch($('[data-f=code]', tr), async (p) => {
        Object.assign(it, { maker: p.maker, code: p.code, name: p.name, spec: p.spec || '', unit: p.unit || '個', list_price: p.list_price, supplier_id: p.supplier_id });
        if (p.cost_rate != null) { it.cost_rate = p.cost_rate; recalc(it, 'cost_rate'); }
        const [r] = await rateLookup($('[name=customer_id]', head).value, [it]);
        if (r.sell_rate != null) { it.sell_rate = r.sell_rate; recalc(it, 'sell_rate'); }
        state.dirty = true; drawItems(); drawTotals();
      });
    });
  };
  drawItems(); drawTotals();

  if (!locked) {
    $('#addrow').onclick = () => { state.items.push(blankItem()); drawItems(); const last = $$('#items tr[data-i]').pop(); $('[data-f=code]', last)?.focus(); };
    $('#auto-rate').onclick = (e) => run(e.target, async () => {
      const res = await rateLookup($('[name=customer_id]', head).value, state.items);
      let n = 0;
      res.forEach((r, i) => {
        const it = state.items[i];
        if (r.product && !it.list_price) { it.list_price = r.product.list_price; }
        if (r.product && !it.supplier_id) it.supplier_id = r.product.supplier_id;
        if (r.cost_rate != null && it.cost_price == null) { it.cost_rate = r.cost_rate; recalc(it, 'cost_rate'); }
        if (r.sell_rate != null) { it.sell_rate = r.sell_rate; recalc(it, 'sell_rate'); n++; }
      });
      drawItems(); drawTotals();
      toast(n ? `${n}行に掛率を設定しました` : '該当する掛率が見つかりませんでした（掛率マスターを確認してください）', n ? 'ok' : 'err');
    });
    $('#bulk-rate').onclick = async () => {
      const chk = state.items.filter((x) => x._chk);
      if (!chk.length) return toast('行をチェックしてください', 'err');
      const v = await promptBox('売掛率を一括入力', { label: '売掛率（%）例：52', type: 'text' });
      const r = num(v); if (r == null) return;
      chk.forEach((it) => { it.sell_rate = r > 1.5 ? r / 100 : r; recalc(it, 'sell_rate'); });
      drawItems(); drawTotals();
    };
    $('#mkset').onclick = async () => {
      const chk = state.items.filter((x) => x._chk);
      if (!chk.length) return toast('セットにする行をチェックしてください', 'err');
      const name = await promptBox('セットにまとめる', { label: 'セット名（例：キッチンセット）', value: chk[0].set_name || '' });
      if (!name) return;
      chk.forEach((it) => { it.set_name = name; it._chk = false; });
      drawItems(); drawTotals();
    };
    $('#unset').onclick = () => { state.items.filter((x) => x._chk).forEach((it) => { it.set_name = ''; it._chk = false; }); drawItems(); };
    $('#delrows').onclick = () => { state.items = state.items.filter((x) => !x._chk); if (!state.items.length) state.items.push(blankItem()); drawItems(); drawTotals(); };
    $('#ai-open').onclick = () => aiPanel(true);
    $('#save').onclick = (e) => run(e.target, async () => {
      const h = formData(head);
      if (!h.customer_id) throw new Error('得意先を選んでください');
      const body = { ...h, items: state.items.filter((it) => it.code || it.name).map(({ _chk, supplier_name, ...rest }) => rest), ai_read_ids: state.aiReadIds };
      if (isNew) { const r = await api('quotes', { method: 'POST', body }); toast('保存しました'); go(`#/quotes/${r.id}`); }
      else { await api(`quotes/${q.id}`, { method: 'PUT', body }); toast('保存しました'); go(`#/quotes/${q.id}`); }
    });
  }
  if (!isNew) {
    $$('[data-st]').forEach((b) => { b.onclick = () => run(b, async () => {
      let lost_reason = null;
      if (b.dataset.st === 'lost') { lost_reason = await promptBox('失注の理由', { label: '理由（分析に使います）', value: '', textarea: true }); if (lost_reason === null) return; }
      await api(`quotes/${q.id}/status`, { method: 'POST', body: { status: b.dataset.st, lost_reason } }); go(`#/quotes/${q.id}`);
    }, '状態を変更しました'); });
    $('#submit').onclick = (e) => run(e.target, async () => { await api(`quotes/${q.id}/submit`, { method: 'POST', body: {} }); go(`#/quotes/${q.id}`); }, 'この版を提出版にしました');
    $('#newver').onclick = (e) => run(e.target, async () => { const r = await api(`quotes/${q.id}/version`, { method: 'POST', body: {} }); go(`#/quotes/${r.id}`); }, '新しい版を作りました');
    $('#copy').onclick = (e) => run(e.target, async () => { const r = await api(`quotes/${q.id}/copy`, { method: 'POST', body: {} }); go(`#/quotes/${r.id}`); }, '複製しました');
    const del = $('#del'); if (del) del.onclick = async () => { if (await confirmBox('この版の見積を削除します。よろしいですか？', { danger: true, ok: '削除' })) run(del, async () => { await api(`quotes/${q.id}`, { method: 'DELETE' }); go('#/quotes'); }, '削除しました'); };
    const to = $('#to-order'); if (to) to.onclick = async () => {
      if (state.dirty) return toast('先に保存してください', 'err');
      if (!(await confirmBox('この見積から受注を作成します。明細・単価・仕入先がそのまま受注になります。', { ok: '受注にする' }))) return;
      run(to, async () => { const r = await api(`quotes/${q.id}/order`, { method: 'POST', body: {} }); go(`#/orders/${r.id}`); }, '受注を作成しました');
    };
  }

  // ---------- AI 読み取り ----------
  function aiPanel(open) {
    const area = $('#ai-area');
    if (!open) { area.innerHTML = ''; return; }
    area.innerHTML = `<div class="card mb"><div class="ch"><h2>${icon('ai')} 仕入先の見積書をAIで読み取る</h2><div class="acts"><button class="btn sm ghost" id="ai-close">閉じる</button></div></div><div class="cb">
      ${App.me.ai_enabled ? '' : '<div class="warnbox mb">AI読み取りが設定されていません。サーバーの環境変数 <b>ANTHROPIC_API_KEY</b> を設定してください。</div>'}
      <div class="steps"><div><b>① 見積書を選ぶ</b>PDF・Excel・画像をそのまま。複数枚まとめても可</div><div><b>② AIが明細を起こす</b>品番・品名・数量・単価・掛率を読み取り</div><div><b>③ 確認して取り込む</b>合計金額を紙面と照合。自信のない箇所には印</div><div><b>④ 掛率→御見積書PDF</b>売単価・利益率を自動計算</div></div>
      <div class="drop" id="drop"><div class="big">ここにファイルをドラッグ、またはクリックして選択</div><div class="small muted">PDF・Excel（.xlsx/.xls）・スキャン画像や写真（JPEG/PNG）／ 1回に10ファイルまで</div>
      <input type="file" id="ai-file" multiple accept=".pdf,.xlsx,.xls,.xlsm,.png,.jpg,.jpeg,.webp,image/*,application/pdf" class="hidden"></div>
      <div id="ai-res"></div></div></div>`;
    $('#ai-close').onclick = () => aiPanel(false);
    const drop = $('#drop'); const fi = $('#ai-file');
    drop.onclick = () => fi.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); };
    fi.onchange = () => upload(fi.files);
    area.scrollIntoView({ behavior: 'smooth' });
  }
  async function upload(files) {
    if (!files || !files.length) return;
    const res = $('#ai-res');
    res.innerHTML = `<div class="loading"><span class="spinner"></span> AIが ${files.length} 件のファイルを読み取っています…（1枚あたり数十秒かかることがあります）</div>`;
    const fd = new FormData(); [...files].forEach((f) => fd.append('files', f));
    try {
      const d = await api('ai/read', { method: 'POST', form: fd });
      res.innerHTML = d.results.map((r, fi) => {
        if (!r.ok) return `<div class="match ng mt8">「${esc(r.file_name)}」を読み取れませんでした：${esc(r.error)}（失敗した読み取りは料金がかかりません）</div>`;
        const x = r.result;
        const doc = x.subtotal ?? (x.total != null && x.tax != null ? x.total - x.tax : null);
        const m = x.subtotal_matches == null ? `<div class="match na">紙面の合計が見つからないため照合できません。明細の合計は ${yen(x.computed_subtotal)} です。</div>`
          : x.subtotal_matches ? `<div class="match ok">✓ 明細の合計 ${yen(x.computed_subtotal)} が紙面の小計 ${yen(doc)} と一致しました</div>`
            : `<div class="match ng">✕ 明細の合計 ${yen(x.computed_subtotal)} と紙面の小計 ${yen(doc)} が一致しません。明細を確認してください</div>`;
        const sup = sups.find((s) => x.supplier_name && (s.name.includes(x.supplier_name) || x.supplier_name.includes(s.name)));
        return `<div class="card mt" data-f="${fi}"><div class="ch"><h2>${esc(r.file_name)}</h2><span class="small muted">${esc(x.supplier_name || '仕入先不明')}${x.document_no ? ` ／ No.${esc(x.document_no)}` : ''}${x.document_date ? ` ／ ${esc(x.document_date)}` : ''} ／ ${r.pages}枚</span>
          <div class="acts"><label class="small">仕入先 <select data-sup style="width:auto">${opts(sups, sup?.id, { blank: '（未設定）' })}</select></label><button class="btn teal sm" data-import>チェックした明細を取り込む</button></div></div>
          <div class="cb">${m}${x.notes ? `<div class="small muted">メモ：${esc(x.notes)}</div>` : ''}</div>
          <div class="cb p0 tbl-wrap"><table class="tbl"><thead><tr><th><input type="checkbox" data-all checked></th><th>セット</th><th>メーカー</th><th>品番</th><th>品名・仕様</th><th class="r">数量</th><th class="r">定価</th><th class="r">掛率</th><th class="r">値引後単価</th><th class="r">金額</th><th></th></tr></thead>
          <tbody>${x.items.map((it, i) => `<tr class="${it.uncertain ? 'warn' : ''}"><td><input type="checkbox" data-i="${i}" checked></td><td class="small">${esc(it.set_name || '')}</td><td>${esc(it.maker || '')}</td><td><b>${esc(it.code || '')}</b></td><td>${esc(it.name || '')}<div class="sub">${esc(it.spec || '')}</div></td>
            <td class="r">${qtyf(it.qty)} ${esc(it.unit || '')}</td><td class="r">${n0(it.list_price)}</td><td class="r">${it.rate != null ? pct(it.rate) : ''}</td><td class="r">${n0(it.net_price)}</td><td class="r">${n0(it.amount)}</td>
            <td>${it.uncertain ? `<span class="badge org" title="${esc(it.note || '')}">要確認</span>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
      }).join('');
      d.results.forEach((r, fi) => {
        if (!r.ok) return;
        const box = $(`[data-f="${fi}"]`, res);
        $('[data-all]', box).onchange = (e) => $$('tbody input[type=checkbox]', box).forEach((c) => { c.checked = e.target.checked; });
        $('[data-import]', box).onclick = async (e) => run(e.target, async () => {
          const supId = Number($('[data-sup]', box).value) || null;
          const picked = $$('tbody input[data-i]:checked', box).map((c) => r.result.items[Number(c.dataset.i)]);
          const newItems = picked.map((it) => {
            const x = { ...blankItem(), set_name: it.set_name || '', maker: it.maker || '', code: it.code || '', name: it.name || '', spec: it.spec || '', qty: it.qty ?? 1, unit: it.unit || '個',
              list_price: it.list_price ?? it.net_price ?? 0, cost_rate: it.rate, cost_price: it.net_price ?? it.list_price ?? null, supplier_id: supId, uncertain: it.uncertain ? 1 : 0, note: it.note || '' };
            return x;
          });
          const rates = await rateLookup($('[name=customer_id]', head).value, newItems);
          rates.forEach((rr, i) => { if (rr.sell_rate != null) { newItems[i].sell_rate = rr.sell_rate; recalc(newItems[i], 'sell_rate'); } if (!newItems[i].supplier_id && rr.product) newItems[i].supplier_id = rr.product.supplier_id; });
          state.items = state.items.filter((it) => it.code || it.name).concat(newItems);
          state.aiReadIds.push(r.id); state.dirty = true;
          drawItems(); drawTotals();
          toast(`${newItems.length}行を取り込みました。売掛率を確認して保存してください`);
          $('#items').scrollIntoView({ behavior: 'smooth' });
        });
      });
    } catch (e) { res.innerHTML = `<div class="match ng">${esc(e.message)}</div>`; }
  }
  if (query.ai && !locked) aiPanel(true);
}, { nav: 'quotes' });

// ================= 見積分析 =================
route('/analysis', async (el, p, q) => {
  const draw = async () => {
    const f = { group: q.group || 'staff', from: q.from || addDays(today(), -90), to: q.to || today(), scope: getScope() };
    const d = await api(`quotes-analysis${qs(f)}`);
    const tot = d.rows.reduce((a, r) => ({ cnt: a.cnt + r.cnt, amount: a.amount + (r.amount || 0), won: a.won + (r.won_cnt || 0), wonAmt: a.wonAmt + (r.won_amount || 0), lost: a.lost + (r.lost_cnt || 0), open: a.open + (r.open_amount || 0), gross: a.gross + (r.gross || 0) }), { cnt: 0, amount: 0, won: 0, wonAmt: 0, lost: 0, open: 0, gross: 0 });
    const decided = (r) => (r.won_cnt || 0) + (r.lost_cnt || 0);
    const maxAmt = Math.max(1, ...d.rows.map((r) => r.amount || 0));
    el.innerHTML = `<div class="page-h"><h1>見積分析</h1><span class="sub">誰が・どの得意先に・いくら出して・どうなったか。受注率と粗利率を確認できます。</span></div>
      <div class="filters">${scopeSeg(draw)}
        <div class="seg" id="grp">${[['staff', '担当者別'], ['customer', '得意先別'], ['branch', '営業所別'], ['day', '日別'], ['month', '月別']].map(([k, l]) => `<button data-v="${k}" class="${f.group === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input type="date" id="from" value="${f.from}"> 〜 <input type="date" id="to" value="${f.to}"></div>
      <div class="kpis mb">
        <div class="kpi"><div class="l">見積件数・金額</div><div class="v">${tot.cnt}件</div><div class="s">${yen(tot.amount)}</div></div>
        <div class="kpi"><div class="l">受注率（件数）</div><div class="v">${tot.won + tot.lost ? pct(tot.won / (tot.won + tot.lost)) : '—'}</div><div class="s">受注 ${tot.won}件 ／ 失注 ${tot.lost}件</div></div>
        <div class="kpi"><div class="l">受注金額</div><div class="v">${yen(tot.wonAmt)}</div><div class="s">受注率（金額） ${tot.amount ? pct(tot.wonAmt / tot.amount) : '—'}</div></div>
        <div class="kpi"><div class="l">商談中の見積金額</div><div class="v">${yen(tot.open)}</div><div class="s"><a href="#/quotes?status=negotiating">追いかける見積を見る</a></div></div>
        <div class="kpi"><div class="l">見積の粗利率</div><div class="v">${tot.amount ? pct(tot.gross / tot.amount) : '—'}</div><div class="s">粗利 ${yen(tot.gross)}</div></div>
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px">
      <div class="card"><div class="cb p0">${table([
        { h: { staff: '担当者', customer: '得意先', branch: '営業所', day: '日付', month: '月' }[f.group], v: (r) => esc(r.label || '（未設定）') },
        { h: '件数', r: 1, v: (r) => r.cnt }, { h: '見積金額', r: 1, v: (r) => `${n0(r.amount)}<div class="pbar" style="margin-top:3px"><i style="width:${Math.round((r.amount || 0) / maxAmt * 100)}%"></i></div>` },
        { h: '受注', r: 1, v: (r) => `${r.won_cnt || 0}件<div class="sub">${n0(r.won_amount)}</div>` }, { h: '失注', r: 1, v: (r) => `${r.lost_cnt || 0}件` },
        { h: '受注率', r: 1, v: (r) => (decided(r) ? `<span class="rate ${r.won_cnt / decided(r) >= 0.5 ? 'good' : r.won_cnt / decided(r) >= 0.3 ? 'mid' : 'bad'}">${pct(r.won_cnt / decided(r))}</span>` : '—') },
        { h: '商談中', r: 1, v: (r) => `${r.open_cnt || 0}件<div class="sub">${n0(r.open_amount)}</div>` },
        { h: '粗利率', r: 1, v: (r) => (r.amount ? pct(r.gross / r.amount) : '—') },
      ], d.rows, { empty: 'この期間の見積はありません' })}</div></div>
      <div class="card"><div class="ch"><h2>失注の理由</h2></div><div class="cb p0">${d.lostReasons.length ? `<table class="tbl">${d.lostReasons.map((x) => `<tr><td>${esc(x.reason)}</td><td class="r">${x.cnt}件</td></tr>`).join('')}</table>` : '<div class="empty">失注はありません</div>'}</div></div></div>`;
    $$('#grp button').forEach((b) => { b.onclick = () => { q.group = b.dataset.v; setQuery(q); draw(); }; });
    $('#from').onchange = (e) => { q.from = e.target.value; setQuery(q); draw(); };
    $('#to').onchange = (e) => { q.to = e.target.value; setQuery(q); draw(); };
  };
  await draw();
}, { nav: 'analysis' });
