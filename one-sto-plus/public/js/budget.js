/* 予算管理: 予算進捗・予算入力 */
'use strict';

const rateCls = (r) => (r == null ? '' : r >= 1 ? 'good' : r >= 0.8 ? 'mid' : 'bad');
const man = (v) => (v == null ? '' : `${(Math.round(Number(v) / 1000) / 10).toLocaleString('ja-JP')}万`);

function budgetChart(months, budget, actual) {
  const W = 760, H = 260, L = 56, R = 56, T = 16, B = 30;
  const cumB = []; const cumA = []; budget.reduce((a, v, i) => (cumB[i] = a + v), 0); actual.reduce((a, v, i) => (cumA[i] = a + v), 0);
  const maxM = Math.max(1, ...budget, ...actual); const maxC = Math.max(1, cumB[11], cumA[11]);
  const bw = (W - L - R) / 12;
  const y1 = (v) => T + (H - T - B) * (1 - v / maxM); const y2 = (v) => T + (H - T - B) * (1 - v / maxC);
  const cur = new Date(); const nowIdx = actual.findLastIndex ? actual.findLastIndex((v) => v > 0) : 11;
  const lineB = cumB.map((v, i) => `${L + bw * i + bw / 2},${y2(v)}`).join(' ');
  const lineA = cumA.slice(0, Math.max(0, nowIdx) + 1).map((v, i) => `${L + bw * i + bw / 2},${y2(v)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  void cur;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="月別の予算と実績">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y1(maxM * t)}" y2="${y1(maxM * t)}" stroke="#eef1f6"/><text x="${L - 6}" y="${y1(maxM * t) + 4}" font-size="10" text-anchor="end" fill="#6b7280">${man(maxM * t)}</text><text x="${W - R + 6}" y="${y2(maxC * t) + 4}" font-size="10" fill="#6b7280">${man(maxC * t)}</text>`).join('')}
    ${months.map((m, i) => `<rect x="${L + bw * i + bw * 0.14}" y="${y1(budget[i])}" width="${bw * 0.34}" height="${H - B - y1(budget[i])}" fill="#c9d4ef" rx="2"><title>${m} 予算 ${n0(budget[i])}</title></rect>
      <rect x="${L + bw * i + bw * 0.5}" y="${y1(actual[i])}" width="${bw * 0.34}" height="${H - B - y1(actual[i])}" fill="#25418f" rx="2"><title>${m} 実績 ${n0(actual[i])}</title></rect>
      <text x="${L + bw * i + bw / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#4b5563">${m}</text>`).join('')}
    <polyline points="${lineB}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5 4"/>
    <polyline points="${lineA}" fill="none" stroke="#2bb3a3" stroke-width="2.5"/>
    ${cumA.slice(0, Math.max(0, nowIdx) + 1).map((v, i) => `<circle cx="${L + bw * i + bw / 2}" cy="${y2(v)}" r="3" fill="#2bb3a3"><title>累計実績 ${n0(v)}</title></circle>`).join('')}
  </svg>`;
}

const budgetTabs = (on, q) => `<div class="tabs"><a href="#/budget${qs({ level: q.level, node_id: q.node_id, fy: q.fy })}" class="${on === 'p' ? 'on' : ''}">予算進捗</a><a href="#/budget/input${qs({ level: q.level, node_id: q.node_id, fy: q.fy })}" class="${on === 'i' ? 'on' : ''}">予算入力</a></div>`;
const crumbPath = (path, base) => path.map((n, i) => (i === path.length - 1 ? `<b>${esc(n.name)}</b>` : `<a href="${base}${qs({ level: n.level, node_id: n.id })}">${esc(n.name)}</a>`)).join(' › ');

// ================= 予算進捗 =================
route('/budget', async (el, p, q) => {
  const meta = await api('budget/meta');
  if (!q.level) { q.level = meta.default.level; q.node_id = meta.default.id; }
  const fy = Number(q.fy || meta.fy);
  const d = await api(`budget/progress${qs({ level: q.level, node_id: q.node_id, fy, basis: q.basis })}`);
  const s = d.self;
  el.innerHTML = `<div class="page-h"><h1>予算管理</h1><span class="sub">全社目標を営業所 → 部署 → 担当者 → 得意先へ配り、いま何％まで来ているかを全員が同じ画面で見られます。</span></div>
    ${budgetTabs('p', q)}
    <div class="filters"><select id="fy">${[fy - 1, fy, fy + 1].map((y) => `<option value="${y}" ${y === fy ? 'selected' : ''}>${y}年度</option>`).join('')}</select>
      <div class="seg" id="basis"><button data-v="sales" class="${d.basis === 'sales' ? 'on' : ''}">売上ベース</button><button data-v="orders" class="${d.basis === 'orders' ? 'on' : ''}">受注ベース</button></div>
      <span class="small">${crumbPath(d.path, '#/budget')}</span>
      <div class="sp"></div><a class="btn sm" href="/api/budget/export${qs({ level: d.level, node_id: d.id, fy, basis: d.basis })}">${icon('dl')} CSV</a><a class="btn sm" href="/api/budget/export${qs({ level: d.level, node_id: d.id, fy, basis: d.basis, format: 'xlsx' })}">${icon('dl')} Excel</a></div>
    <div class="kpis">
      <div class="kpi"><div class="l">年間予算</div><div class="v">${yen(s.budget)}</div><div class="s">${esc(d.name)}</div></div>
      <div class="kpi"><div class="l">年間実績（${d.basis === 'sales' ? '売上' : '受注'}）</div><div class="v">${yen(s.actual)}</div><div class="s">達成率 <span class="rate ${rateCls(s.rate)}">${pct(s.rate)}</span></div><div class="bar"><i style="width:${Math.min(100, (s.rate || 0) * 100)}%"></i></div></div>
      <div class="kpi"><div class="l">今日までの達成率</div><div class="v"><span class="rate ${rateCls(s.todate_rate)}">${pct(s.todate_rate)}</span></div><div class="s">今日までの予算 ${yen(s.todate_budget)}</div></div>
      <div class="kpi"><div class="l">目標まであと</div><div class="v">${yen(s.remaining)}</div><div class="s">未決の見積 <b>${yen(s.open_quote_amount)}</b>（${s.open_quote_cnt}件）</div></div>
    </div>
    ${s.remaining > 0 && s.open_quote_amount ? `<div class="info mt">目標まであと ${yen(s.remaining)}。商談中の見積が ${yen(s.open_quote_amount)} あります。<a href="#/quotes?status=negotiating">追いかける見積を見る ›</a></div>` : ''}
    <div class="card mt"><div class="ch"><h2>月別の予算と実績</h2><div class="legend" style="margin-left:auto"><span><i style="background:#c9d4ef"></i>予算</span><span><i style="background:#25418f"></i>実績</span><span><i style="background:#f59e0b"></i>累計予算</span><span><i style="background:#2bb3a3"></i>累計実績</span></div></div>
      <div class="cb chart">${budgetChart(d.months, s.budget_months, s.actual_months)}</div>
      <div class="cb p0 tbl-wrap"><table class="tbl"><thead><tr><th></th>${d.months.map((m) => `<th class="r">${m}</th>`).join('')}<th class="r">合計</th></tr></thead><tbody>
        <tr><td>予算</td>${s.budget_months.map((v) => `<td class="r">${man(v)}</td>`).join('')}<td class="r b">${man(s.budget)}</td></tr>
        <tr><td>実績</td>${s.actual_months.map((v) => `<td class="r">${man(v)}</td>`).join('')}<td class="r b">${man(s.actual)}</td></tr>
        <tr><td>達成率</td>${s.budget_months.map((v, i) => `<td class="r"><span class="rate ${rateCls(v ? s.actual_months[i] / v : null)}">${v ? pct(s.actual_months[i] / v, 0) : '—'}</span></td>`).join('')}<td class="r"><span class="rate ${rateCls(s.rate)}">${pct(s.rate)}</span></td></tr></tbody></table></div></div>
    ${d.children.length ? `<div class="card mt"><div class="ch"><h2>${esc(d.child_label)}別</h2><span class="small muted">行を押すと、さらに下の階層を表示します。</span></div><div class="cb p0">${table([
      { h: d.child_label, v: (r) => `<b>${esc(r.name)}</b>${r.has_children || r.level === 'customer' ? '' : ''}` },
      { h: '年間予算', r: 1, v: (r) => n0(r.budget) }, { h: '実績', r: 1, v: (r) => n0(r.actual) },
      { h: '達成率', r: 1, v: (r) => `<span class="rate ${rateCls(r.rate)}">${pct(r.rate)}</span><div class="pbar" style="margin-top:3px"><i style="width:${Math.min(100, (r.rate || 0) * 100)}%"></i></div>` },
      { h: '今日までの達成率', r: 1, v: (r) => `<span class="rate ${rateCls(r.todate_rate)}">${pct(r.todate_rate)}</span>` },
      { h: '目標まであと', r: 1, v: (r) => n0(r.remaining) }, { h: '未決の見積金額', r: 1, v: (r) => `${n0(r.open_quote_amount)}<div class="sub">${r.open_quote_cnt}件</div>` },
    ], d.children, { onRow: true })}</div></div>` : ''}`;
  bindRows(el, d.children, (r) => { if (r.level === 'customer' && !r.has_children) { go(`#/budget${qs({ level: r.level, node_id: r.id, fy })}`); return; } go(`#/budget${qs({ level: r.level, node_id: r.id, fy })}`); });
  $('#fy').onchange = (e) => { q.fy = e.target.value; go(`#/budget${qs(q)}`); };
  $$('#basis button').forEach((b) => { b.onclick = () => { q.basis = b.dataset.v; go(`#/budget${qs(q)}`); }; });
}, { nav: 'budget' });

// ================= 予算入力 =================
route('/budget/input', async (el, p, q) => {
  const meta = await api('budget/meta');
  if (!q.level) { q.level = meta.default.level; q.node_id = meta.default.id; }
  const fy = Number(q.fy || meta.fy);
  const d = await api(`budget/input${qs({ level: q.level, node_id: q.node_id, fy })}`);
  const months = meta.months;
  const canEdit = d.can_edit_children;
  const sumArr = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
  el.innerHTML = `<div class="page-h"><h1>予算管理</h1><span class="sub">上の行が配られた目標、下の行が一つ下の階層への配分です。マス目を直接編集すると自動で保存されます。</span></div>
    ${budgetTabs('i', q)}
    <div class="filters"><select id="fy">${[fy - 1, fy, fy + 1].map((y) => `<option value="${y}" ${y === fy ? 'selected' : ''}>${y}年度</option>`).join('')}</select>
      <span class="small">${crumbPath(d.path, '#/budget/input')}</span> ${badge('budget', d.status)}
      <div class="sp"></div><span class="small muted" id="saved"></span>
      ${canEdit && d.status === 'draft' && d.level !== 'company' ? '<button class="btn sm teal" id="submit">締めて提出</button>' : ''}
      ${d.can_approve && d.status !== 'approved' ? '<button class="btn sm pri" id="approve">確定する</button>' : ''}
      ${d.can_approve && d.status !== 'draft' ? '<button class="btn sm" id="reopen">差し戻す</button>' : ''}</div>
    ${!canEdit ? `<div class="info mb">${d.status === 'approved' ? 'この配分は確定済みです。' : 'この階層の配分は、あなたの権限では入力できません（表示のみ）。'}自分に配られた額は変えられず、一つ下への配分だけを入力できます。</div>` : ''}
    <div class="card"><div class="ch"><h2>${esc(d.name)} → ${esc(d.child_label || '')}への配分</h2>
      ${canEdit ? '<div class="acts"><span class="small muted">年間額の欄に入れると：</span><div class="seg" id="split"><button data-v="even" class="on">12等分</button><button data-v="prev">前期実績の比率</button></div></div>' : ''}</div>
      <div class="cb p0 tbl-wrap"><table class="bgrid"><thead><tr><th>区分</th><th>年間</th>${months.map((m) => `<th>${m}</th>`).join('')}<th>状態</th></tr></thead><tbody>
        <tr class="target"><td class="nm">配られた目標（${esc(d.name)}）</td><td class="num">${d.can_edit_target ? `<input data-annual="target" value="${n0(sumArr(d.target)) || ''}">` : n0(sumArr(d.target))}</td>
          ${d.target.map((v, i) => `<td class="num">${d.can_edit_target ? `<input data-t="${i}" value="${n0(v) || ''}">` : n0(v)}</td>`).join('')}<td></td></tr>
        ${d.children.map((c, ci) => `<tr data-c="${ci}"><td class="nm">${c.has_children ? `<a href="#/budget/input${qs({ level: c.level, node_id: c.id, fy })}">${esc(c.name)} ›</a>` : esc(c.name)}</td>
          <td class="num">${canEdit ? `<input data-annual="${ci}" value="${n0(sumArr(c.months)) || ''}">` : n0(sumArr(c.months))}</td>
          ${c.months.map((v, i) => `<td class="num">${canEdit ? `<input data-m="${i}" value="${n0(v) || ''}">` : n0(v)}</td>`).join('')}<td>${c.has_children ? badge('budget', c.status) : ''}</td></tr>`).join('')}
        <tr class="unalloc"><td class="nm">未配分（目標 − 配分合計）</td><td class="num" data-ua="all"></td>${months.map((_, i) => `<td class="num" data-ua="${i}"></td>`).join('')}<td></td></tr>
      </tbody></table></div>
      ${d.children.length ? '' : `<div class="empty">${esc(d.child_label || '下の階層')}がありません。${d.level === 'user' ? '得意先の担当者を設定してください。' : 'マスターを確認してください。'}</div>`}</div>
    <p class="small muted mt">・担当者が代わっても、得意先の予算と期初からの実績はそのまま後任に引き継がれます。 ・年間額を入れると12等分、または前期実績の比率で各月へ按分します。</p>`;

  const state = { target: [...d.target], kids: d.children.map((c) => [...c.months]) };
  const drawUA = () => {
    const ua = state.target.map((t, i) => t - state.kids.reduce((a, k) => a + (Number(k[i]) || 0), 0));
    ua.forEach((v, i) => { const td = $(`[data-ua="${i}"]`); td.textContent = n0(v); td.classList.toggle('bad', v < 0); });
    const tot = sumArr(ua); const td = $('[data-ua="all"]'); td.textContent = n0(tot); td.classList.toggle('bad', tot < 0);
  };
  drawUA();
  let splitMode = 'even';
  $$('#split button').forEach((b) => { b.onclick = () => { splitMode = b.dataset.v; $$('#split button').forEach((x) => x.classList.toggle('on', x === b)); }; });
  const timers = {};
  const save = (level, nodeId, monthsArr) => {
    clearTimeout(timers[`${level}:${nodeId}`]);
    $('#saved').textContent = '保存中…';
    timers[`${level}:${nodeId}`] = setTimeout(async () => {
      try { await api('budget', { method: 'PUT', body: { fy, level, node_id: nodeId, months: monthsArr } }); $('#saved').textContent = `保存しました ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`; }
      catch (e) { $('#saved').textContent = ''; toast(e.message, 'err'); }
    }, 500);
  };
  const distribute = (total, prev) => {
    const psum = sumArr(prev || []);
    const w = splitMode === 'prev' && psum > 0 ? prev.map((v) => v / psum) : Array(12).fill(1 / 12);
    const arr = w.map((x) => Math.floor(total * x / 1000) * 1000);
    arr[11] += total - sumArr(arr);
    return arr;
  };
  // 目標（全社のみ）
  $$('[data-t]').forEach((x) => { x.onchange = () => { state.target[Number(x.dataset.t)] = num(x.value) || 0; $('[data-annual=target]').value = n0(sumArr(state.target)); x.value = n0(state.target[Number(x.dataset.t)]) || ''; drawUA(); save('company', 0, state.target); }; });
  const at = $('[data-annual=target]'); if (at) at.onchange = () => { state.target = distribute(num(at.value) || 0, d.prev_actual); $$('[data-t]').forEach((x, i) => { x.value = n0(state.target[i]) || ''; }); at.value = n0(sumArr(state.target)); drawUA(); save('company', 0, state.target); };
  // 配分
  $$('tr[data-c]').forEach((tr) => {
    const ci = Number(tr.dataset.c); const c = d.children[ci];
    $$('[data-m]', tr).forEach((x) => { x.onchange = () => { state.kids[ci][Number(x.dataset.m)] = num(x.value) || 0; $(`[data-annual="${ci}"]`, tr).value = n0(sumArr(state.kids[ci])); x.value = n0(state.kids[ci][Number(x.dataset.m)]) || ''; drawUA(); save(c.level, c.id, state.kids[ci]); }; });
    const an = $(`[data-annual="${ci}"]`, tr); if (an) an.onchange = () => { state.kids[ci] = distribute(num(an.value) || 0, c.prev_actual); $$('[data-m]', tr).forEach((x, i) => { x.value = n0(state.kids[ci][i]) || ''; }); an.value = n0(sumArr(state.kids[ci])); drawUA(); save(c.level, c.id, state.kids[ci]); };
  });
  $('#fy').onchange = (e) => { q.fy = e.target.value; go(`#/budget/input${qs(q)}`); };
  const st = (status, msg) => async (e) => run(e.target, async () => { await api('budget/status', { method: 'POST', body: { fy, level: d.level, node_id: d.id, status } }); go(`#/budget/input${qs(q)}`); }, msg);
  const sb = $('#submit'); if (sb) sb.onclick = async (e) => { if (await confirmBox('配分を締めて提出します。提出後は管理者が確定します。', { ok: '提出する' })) st('submitted', '提出しました')(e); };
  const ap = $('#approve'); if (ap) ap.onclick = st('approved', '確定しました');
  const ro = $('#reopen'); if (ro) ro.onclick = st('draft', '差し戻しました');
}, { nav: 'budget' });
