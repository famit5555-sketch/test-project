/* マスター（得意先・現場・仕入先・商品・掛率・案件・営業所・部署・ユーザー）と設定 */
'use strict';

const CLOSING = [5, 10, 15, 20, 25, 31].map((d) => ({ id: d, name: closingLabel(d) }));
const MASTERS = {
  customers: { title: '得意先', nav: 'customers', desc: '得意先ごとに締め日・回収条件・担当者を設定します。行を押すと現場・ポータルのアカウントを管理できます。',
    cols: [['code', 'コード'], ['name', '得意先名'], ['staff_name', '担当'], ['branch_name', '営業所'], ['closing_day', '締め', (r) => closingLabel(r.closing_day)], ['email', 'メール'], ['tel', '電話']],
    fields: () => [['code', 'コード'], ['name', '得意先名', 'req'], ['kana', 'フリガナ'], ['zip', '郵便番号'], ['address', '住所', 'full'], ['tel', '電話'], ['fax', 'FAX'], ['email', 'メール（請求書・納期連絡の送付先）'],
      ['staff_id', '担当者', 'sel', App.lk.users], ['branch_id', '営業所', 'sel', App.lk.branches], ['closing_day', '締め日', 'sel', CLOSING],
      ['pay_month_offset', '回収（締め日から何か月後）', 'sel', [0, 1, 2, 3].map((x) => ({ id: x, name: x === 0 ? '当月' : x === 1 ? '翌月' : `${x}か月後` }))], ['pay_day', '回収日', 'sel', [5, 10, 15, 20, 25, 31].map((d) => ({ id: d, name: d >= 31 ? '末日' : `${d}日` }))], ['note', 'メモ', 'full']],
    detail: true },
  suppliers: { title: '仕入先', nav: 'suppliers', desc: '発注書メールの送付先です。仕入先はアカウント不要で、メールのリンクから納期・単価を回答します。',
    cols: [['code', 'コード'], ['name', '仕入先名'], ['contact', '担当者'], ['email', 'メール'], ['tel', '電話'], ['fax', 'FAX']],
    fields: () => [['code', 'コード'], ['name', '仕入先名', 'req'], ['contact', '担当者名'], ['email', 'メール（発注書の送付先）'], ['tel', '電話'], ['fax', 'FAX'], ['zip', '郵便番号'], ['address', '住所', 'full'], ['note', 'メモ', 'full']] },
  products: { title: '商品マスター', nav: 'products', desc: '品番・定価・値引きコード・仕入掛率・仕入先。CSV / Excel でまとめて取り込めます。',
    cols: [['maker', 'メーカー'], ['code', '品番'], ['name', '品名'], ['spec', '仕様'], ['list_price', '定価', (r) => n0(r.list_price), 1], ['discount_code', '値引きコード'], ['cost_rate', '仕入掛率', (r) => (r.cost_rate != null ? pct(r.cost_rate) : ''), 1], ['supplier_name', '仕入先'], ['stock_qty', '在庫', (r) => (r.stock_qty ? qtyf(r.stock_qty) : ''), 1]],
    fields: () => [['maker', 'メーカー'], ['code', '品番', 'req'], ['name', '品名', 'full'], ['spec', '仕様・色'], ['unit', '単位'], ['list_price', '定価', 'num'], ['discount_code', '値引きコード'], ['cost_rate', '仕入掛率（0.45 または 45）', 'rate'], ['supplier_id', '仕入先', 'sel', App.lk.suppliers], ['stock_qty', '自社在庫数', 'num']],
    tools: true },
  rate_rules: { title: '掛率', nav: 'rates', desc: '見積・受注で売掛率を自動で入れるためのルールです。得意先×メーカー×値引きコード → 得意先×メーカー → 共通×メーカー×値引きコード → 共通×メーカー の順に探します。',
    cols: [['customer_name', '得意先', (r) => esc(r.customer_name || '（共通）')], ['maker', 'メーカー'], ['discount_code', '値引きコード', (r) => esc(r.discount_code || '（すべて）')], ['sell_rate', '売掛率', (r) => pct(r.sell_rate), 1], ['cost_rate', '仕入掛率', (r) => (r.cost_rate != null ? pct(r.cost_rate) : ''), 1], ['note', 'メモ']],
    fields: () => [['customer_id', '得意先（空欄＝全得意先共通）', 'sel', App.lk.customers], ['maker', 'メーカー', 'req'], ['discount_code', '値引きコード（空欄＝すべて）'], ['sell_rate', '売掛率（0.52 または 52）', 'rate'], ['cost_rate', '仕入掛率（任意）', 'rate'], ['note', 'メモ', 'full']] },
  projects: { title: '案件', nav: 'projects', desc: '現場ごとの案件マスタ。見積に紐づけて管理できます。',
    cols: [['code', 'コード'], ['name', '案件名'], ['customer_name', '得意先'], ['site_name', '現場'], ['staff_name', '担当']],
    fields: () => [['code', 'コード'], ['name', '案件名', 'req'], ['customer_id', '得意先', 'sel', App.lk.customers], ['staff_id', '担当者', 'sel', App.lk.users], ['note', 'メモ', 'full']] },
  branches: { title: '営業所', nav: 'settings', admin: true, cols: [['name', '営業所名'], ['address', '住所'], ['tel', '電話'], ['fax', 'FAX']],
    fields: () => [['name', '営業所名', 'req'], ['sort', '並び順', 'num'], ['zip', '郵便番号'], ['address', '住所', 'full'], ['tel', '電話'], ['fax', 'FAX']] },
  departments: { title: '部署', nav: 'settings', admin: true, cols: [['branch_name', '営業所'], ['name', '部署名']], fields: () => [['branch_id', '営業所', 'sel', App.lk.branches], ['name', '部署名', 'req']] },
  users: { title: 'ユーザー（社員）', nav: 'settings', admin: true, desc: '権限（管理者・所長・一般）と、初期表示の範囲（全社・自営業所・自分の担当）を設定します。停止したユーザーのデータは会社に残ります。',
    cols: [['login', 'ログインID'], ['name', '氏名'], ['role', '権限', (r) => LABELS.role[r.role]], ['view_scope', '表示範囲', (r) => LABELS.scope[r.view_scope]], ['branch_name', '営業所'], ['department_name', '部署'], ['email', 'メール']],
    fields: () => [['login', 'ログインID', 'req'], ['name', '氏名', 'req'], ['password', 'パスワード（8文字以上・変更時のみ）', 'pw'], ['role', '権限', 'sel', Object.entries(LABELS.role).map(([id, name]) => ({ id, name }))],
      ['view_scope', '初期表示の範囲', 'sel', Object.entries(LABELS.scope).map(([id, name]) => ({ id, name }))], ['branch_id', '営業所', 'sel', App.lk.branches], ['department_id', '部署（予算の配分に使います）', 'sel', App.lk.departments], ['email', 'メール'], ['tel', '電話']] },
};

function masterForm(def, row = {}) {
  return `<div class="form" id="mf">${def.fields().map(([k, l, t, list]) => {
    const full = t === 'full' ? { full: true } : {}; const req = t === 'req' ? { req: true } : {};
    let input;
    if (t === 'sel') input = sel(k, opts(list, row[k], { blank: '（未設定）', label: (x) => x.code ? `${x.code} ${x.name}` : x.name }));
    else if (t === 'rate') input = inp(k, row[k] != null ? rate(row[k]) : '', { attrs: 'class="in-num"' });
    else if (t === 'num') input = inp(k, row[k] ?? '', { attrs: 'class="in-num"' });
    else if (t === 'pw') input = inp(k, '', { type: 'password', attrs: 'autocomplete="new-password"' });
    else if (k === 'note') input = ta(k, row[k]);
    else input = inp(k, row[k]);
    return field(l, input, { ...full, ...req });
  }).join('')}</div>`;
}
function readMasterForm(def, root) {
  const o = formData(root);
  for (const [k, , t] of def.fields()) { if (t === 'rate' && o[k] !== '') { const v = num(o[k]); o[k] = v == null ? null : v > 1.5 ? v / 100 : v; } }
  if ('password' in o && !o.password) delete o.password;
  return o;
}
async function editMaster(table, row, after) {
  const def = MASTERS[table];
  modal({ title: `${def.title}${row ? 'の編集' : 'の追加'}`, size: 'wide', body: masterForm(def, row || {}),
    actions: [
      ...(row ? [{ label: row.active === 0 ? '有効に戻す' : table === 'rate_rules' ? '削除' : '停止（非表示）', cls: 'danger', onClick: async () => {
        if (row.active === 0) await api(`m/${table}/${row.id}`, { method: 'PUT', body: { active: 1 } });
        else { if (!(await confirmBox(table === 'rate_rules' ? '削除しますか？' : '停止すると一覧や選択肢に表示されなくなります（過去のデータは残ります）。', { danger: true }))) return false; await api(`m/${table}/${row.id}`, { method: 'DELETE' }); }
        await loadLookups(true); after();
      } }] : []),
      { label: 'キャンセル' },
      { label: '保存', cls: 'pri', onClick: async (m) => {
        const body = readMasterForm(def, $('#mf', m.el));
        if (row) await api(`m/${table}/${row.id}`, { method: 'PUT', body }); else await api(`m/${table}`, { method: 'POST', body });
        toast('保存しました'); await loadLookups(true); after();
      } }] });
}

route('/m/:table', async (el, { table }, q) => {
  const def = MASTERS[table];
  if (!def) throw new Error('不明なマスターです');
  App.cur.nav = def.nav; $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === def.nav));
  const canEdit = !def.admin || App.me.user.role === 'admin';
  const draw = async () => {
    const d = await api(`m/${table}${qs({ q: q.q, active: q.inactive ? 'all' : '' , limit: 1000 })}`);
    el.innerHTML = `${def.admin ? '<div class="crumb"><a href="#/settings">設定</a> ›</div>' : ''}<div class="page-h"><h1>${esc(def.title)}</h1>${def.desc ? `<span class="sub">${esc(def.desc)}</span>` : ''}
      <div class="acts">${def.tools ? `<a class="btn" href="/api/products/export">${icon('dl')} CSV出力</a><button class="btn" id="imp">CSV・Excelを取り込む</button>` : ''}${canEdit ? `<button class="btn pri" id="add">${icon('plus')} 追加</button>` : ''}</div></div>
      <div class="filters"><input type="search" id="q" placeholder="検索" value="${esc(q.q || '')}"><label class="chk"><input type="checkbox" id="ina" ${q.inactive ? 'checked' : ''}> 停止中も表示</label><span class="muted small" style="margin-left:auto">${d.total}件${d.total > d.rows.length ? `（先頭 ${d.rows.length}件を表示）` : ''}</span></div>
      <div class="card"><div class="cb p0">${window.table(def.cols.map(([k, h, f, r]) => ({ h, r, v: (row) => (f ? f(row) : esc(row[k] ?? '')) + (k === def.cols[1][0] && row.active === 0 ? ' <span class="badge red">停止中</span>' : '') })), d.rows, { onRow: true })}</div></div>`;
    bindRows(el, d.rows, (r) => { if (def.detail) go(`#/customers/${r.id}`); else if (canEdit) editMaster(table, r, draw); });
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q.q = e.target.value; setQuery(q); draw(); }, 300); };
    $('#ina').onchange = (e) => { q.inactive = e.target.checked ? '1' : ''; setQuery(q); draw(); };
    const add = $('#add'); if (add) add.onclick = () => editMaster(table, null, draw);
    const imp = $('#imp'); if (imp) imp.onclick = () => modal({ title: '商品マスターの取り込み', body: `<p class="small">1行目に見出しがあるCSV・Excelを取り込みます。認識する見出し：<br><b>メーカー・品番（必須）・品名・仕様・単位・定価・値引きコード・仕入掛率・仕入先（名前）または仕入先コード・在庫数</b><br>同じメーカー＋品番は上書きします。Shift_JIS の CSV も読み込めます。</p><input type="file" id="pf" accept=".csv,.xlsx,.xls,text/csv">`,
      actions: [{ label: 'キャンセル' }, { label: '取り込む', cls: 'pri', onClick: async (m) => {
        const f = $('#pf', m.el).files[0]; if (!f) throw new Error('ファイルを選んでください');
        const fd = new FormData(); fd.append('file', f);
        const r = await api('products/import', { method: 'POST', form: fd });
        toast(`追加 ${r.created}件・更新 ${r.updated}件`); await loadLookups(true); draw();
      } }] });
  };
  await draw();
}, { nav: 'customers' });

// ---------- 得意先の詳細（現場・ポータルアカウント・QR） ----------
route('/customers/:id', async (el, { id }) => {
  const [c, sites, users] = await Promise.all([api(`m/customers/${id}`), api(`m/sites?customer_id=${id}&active=all`), api(`m/customer_users?customer_id=${id}&active=all`)]);
  el.innerHTML = `<div class="crumb"><a href="#/m/customers">得意先</a> ›</div><div class="page-h"><h1>${esc(c.name)}</h1><span class="badge">${esc(c.code || '')}</span>
      <div class="acts"><a class="btn" href="#/quotes?customer_id=${c.id}">見積</a><a class="btn" href="#/orders?customer_id=${c.id}&status=">受注</a><a class="btn" href="#/invoices?customer_id=${c.id}">請求</a><button class="btn pri" id="edit">編集</button></div></div>
    <div class="grid g2"><div class="card"><div class="cb"><dl class="kv"><dt>担当</dt><dd>${esc(c.staff_name || '—')}（${esc(c.branch_name || '')}）</dd><dt>締め・回収</dt><dd>${closingLabel(c.closing_day)} ${c.pay_month_offset === 0 ? '当月' : c.pay_month_offset === 1 ? '翌月' : `${c.pay_month_offset}か月後`}${c.pay_day >= 31 ? '末' : `${c.pay_day}日`}回収</dd>
      <dt>住所</dt><dd>${c.zip ? `〒${esc(c.zip)} ` : ''}${esc(c.address || '')}</dd><dt>電話・FAX</dt><dd>${esc(c.tel || '')} ${c.fax ? `／ FAX ${esc(c.fax)}` : ''}</dd><dt>メール</dt><dd>${esc(c.email || '—')}</dd><dt>メモ</dt><dd>${esc(c.note || '')}</dd></dl></div></div>
    <div class="card" id="cu-card"><div class="ch"><h2>お客様ポータルのアカウント</h2><div class="acts"><button class="btn sm" id="add-u">${icon('plus')} 追加</button></div></div><div class="cb p0">${table([
      { h: '氏名', v: (r) => esc(r.name) + (r.active ? '' : ' <span class="badge red">停止中</span>') }, { h: 'ログインID', v: (r) => esc(r.login) }, { h: '電話', v: (r) => esc(r.tel || '') },
    ], users.rows, { onRow: true, empty: 'アカウントはありません。追加するとお客様がポータルから注文できます。' })}</div>
      <div class="cb small muted">ポータルのURL：<a href="/portal/" target="_blank" rel="noopener">${esc(App.me.base_url)}/portal/</a>　<a href="/manual/customer" target="_blank" rel="noopener">お客様向けマニュアル</a></div></div></div>
    <div class="card mt"><div class="ch"><h2>現場・倉庫</h2><span class="small muted">現場ごとのQRを印刷して貼ると、職人さんがログインなしで注文できます。</span><div class="acts"><button class="btn sm" id="add-s">${icon('plus')} 追加</button></div></div><div class="cb p0" id="sites">${table([
      { h: '現場名', v: (r) => `${r.kind === 'warehouse' ? '<span class="badge teal">倉庫</span> ' : ''}<b>${esc(r.name)}</b>${r.active ? '' : ' <span class="badge red">停止中</span>'}` }, { h: '住所', v: (r) => esc(r.address || '') }, { h: '受取人', v: (r) => `${esc(r.receiver || '')} ${esc(r.tel || '')}` },
      { h: '', v: (r) => `<a class="btn sm" href="/doc/qr/${r.id}" target="_blank" rel="noopener">${icon('qr')} QRを印刷</a> <a class="btn sm ghost" href="/q/${r.qr_token}" target="_blank" rel="noopener">注文画面</a> <button class="btn sm ghost" data-es="${r.id}">編集</button>` },
    ], sites.rows, { empty: '現場は登録されていません' })}</div></div>`;
  const reload = () => go(`#/customers/${id}`);
  $('#edit').onclick = () => editMaster('customers', c, reload);
  bindRows($('#cu-card'), users.rows, (u) => editCU(u));
  const editCU = (u) => modal({ title: u ? 'アカウントの編集' : 'ポータルのアカウントを追加', body: `<div class="form" id="cu">${field('氏名', inp('name', u?.name), { req: true })}${field('ログインID（メールアドレス推奨）', inp('login', u?.login), { req: true })}${field('電話', inp('tel', u?.tel))}${field(u ? 'パスワード（変更時のみ・8文字以上）' : 'パスワード（8文字以上）', inp('password', '', { type: 'password', attrs: 'autocomplete="new-password"' }), { req: !u })}</div>`,
    actions: [...(u ? [{ label: u.active ? '停止' : '有効に戻す', cls: 'danger', onClick: async () => { if (u.active) await api(`m/customer_users/${u.id}`, { method: 'DELETE' }); else await api(`m/customer_users/${u.id}`, { method: 'PUT', body: { active: 1 } }); reload(); } }] : []),
      { label: 'キャンセル' }, { label: '保存', cls: 'pri', onClick: async (m) => {
        const b = formData($('#cu', m.el)); if (!b.password) delete b.password;
        if (u) await api(`m/customer_users/${u.id}`, { method: 'PUT', body: b }); else await api('m/customer_users', { method: 'POST', body: { ...b, customer_id: c.id } });
        toast('保存しました'); reload();
      } }] });
  $('#add-u').onclick = () => editCU(null);
  const editSite = (s) => modal({ title: s ? '現場の編集' : '現場・倉庫の追加', size: 'wide', body: `<div class="form" id="sf">${field('名称', inp('name', s?.name), { req: true })}${field('種類', sel('kind', `<option value="site">現場</option><option value="warehouse" ${s?.kind === 'warehouse' ? 'selected' : ''}>倉庫</option>`))}
      ${field('郵便番号', inp('zip', s?.zip))}${field('住所', inp('address', s?.address), { full: true })}${field('受取人', inp('receiver', s?.receiver))}${field('電話', inp('tel', s?.tel))}</div>`,
    actions: [...(s ? [{ label: 'QRを再発行', onClick: async () => { if (!(await confirmBox('古いQRコードは使えなくなります。再発行しますか？'))) return false; await api(`sites/${s.id}/qr-reset`, { method: 'POST', body: {} }); toast('再発行しました'); reload(); } },
      { label: s.active ? '停止' : '有効に戻す', cls: 'danger', onClick: async () => { if (s.active) await api(`m/sites/${s.id}`, { method: 'DELETE' }); else await api(`m/sites/${s.id}`, { method: 'PUT', body: { active: 1 } }); reload(); } }] : []),
    { label: 'キャンセル' }, { label: '保存', cls: 'pri', onClick: async (m) => {
      const b = formData($('#sf', m.el));
      if (s) await api(`m/sites/${s.id}`, { method: 'PUT', body: b }); else await api('m/sites', { method: 'POST', body: { ...b, customer_id: c.id } });
      toast('保存しました'); reload();
    } }] });
  $('#add-s').onclick = () => editSite(null);
  $$('[data-es]').forEach((b) => { b.onclick = () => editSite(sites.rows.find((x) => x.id === Number(b.dataset.es))); });
}, { nav: 'customers' });

// ================= 設定 =================
route('/settings', async (el) => {
  const isAdmin = App.me.user.role === 'admin';
  const [s, usage, mails] = await Promise.all([api('settings'), api('ai/usage'), api('mails')]);
  const S = (k, l, o = {}) => field(l, inp(k, s[k], o), o.full ? { full: true } : {});
  el.innerHTML = `<div class="page-h"><h1>設定</h1></div>
    <div class="grid g2">
      <div class="card"><div class="ch"><h2>会社情報（帳票に印字）</h2></div><div class="cb"><div class="form" id="co">
        ${S('company_name', '会社名')}${S('invoice_reg_no', '登録番号（インボイス・T+13桁）')}${S('company_zip', '郵便番号')}${S('company_tel', '電話')}${S('company_address', '住所', { full: true })}${S('company_fax', 'FAX')}${S('mail_from', '送信元メールアドレス')}
        ${S('bank_info', '振込先（請求書に印字）', { full: true })}</div></div></div>
      <div class="card"><div class="ch"><h2>運用</h2></div><div class="cb"><div class="form" id="op">
        ${field('消費税率（%）', inp('tax_rate', s.tax_rate, { attrs: 'class="in-num"' }))}${field('期首月（年度の始まり）', sel('fiscal_start_month', Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${Number(s.fiscal_start_month) === i + 1 ? 'selected' : ''}>${i + 1}月</option>`).join('')))}
        ${field('見積の有効日数', inp('quote_valid_days', s.quote_valid_days, { attrs: 'class="in-num"' }))}${field('予算の実績', sel('budget_basis', `<option value="sales" ${s.budget_basis === 'sales' ? 'selected' : ''}>売上計上ベース</option><option value="orders" ${s.budget_basis === 'orders' ? 'selected' : ''}>受注ベース</option>`))}
        ${field('AI読み取りの単価（円／枚・表示用）', inp('ai_price_per_page', s.ai_price_per_page, { attrs: 'class="in-num"' }))}</div></div></div>
    </div>
    ${isAdmin ? '<div class="row mt"><div class="sp"></div><button class="btn pri" id="save">設定を保存</button></div>' : '<p class="small muted mt">設定の変更は管理者のみ行えます。</p>'}
    <div class="grid g3 mt">
      <a class="card" href="#/m/branches" style="text-decoration:none;color:inherit"><div class="cb"><b>営業所</b><div class="small muted">営業所の追加・住所・電話</div></div></a>
      <a class="card" href="#/m/departments" style="text-decoration:none;color:inherit;margin-top:0"><div class="cb"><b>部署</b><div class="small muted">予算を配る単位</div></div></a>
      <a class="card" href="#/m/users" style="text-decoration:none;color:inherit;margin-top:0"><div class="cb"><b>ユーザー（社員）</b><div class="small muted">権限・表示範囲・停止</div></div></a>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="ch"><h2>システムの状態</h2></div><div class="cb"><dl class="kv">
        <dt>AI読み取り</dt><dd>${App.me.ai_enabled ? '<span class="badge green">有効</span>' : '<span class="badge red">無効</span> 環境変数 ANTHROPIC_API_KEY を設定してください'}</dd>
        <dt>メール送信</dt><dd>${App.me.smtp_enabled ? '<span class="badge green">SMTPで送信</span>' : '<span class="badge org">送信記録のみ</span> 環境変数 SMTP_HOST などを設定すると実際に送信します'}</dd>
        <dt>公開URL</dt><dd>${esc(App.me.base_url)}<div class="small muted">メール内のリンクに使われます（環境変数 BASE_URL）</div></dd></dl></div></div>
      <div class="card"><div class="ch"><h2>パスワードの変更</h2></div><div class="cb"><div class="form" id="pw">${field('現在のパスワード', inp('current', '', { type: 'password' }))}${field('新しいパスワード（8文字以上）', inp('password', '', { type: 'password', attrs: 'autocomplete="new-password"' }))}</div><button class="btn mt" id="pwb">変更する</button></div></div>
    </div>
    <div class="card mt"><div class="ch"><h2>AI読み取りの利用状況</h2><span class="small muted">成功した読み取り1枚ごとの従量です。失敗・読み直しは数えません。</span></div><div class="cb p0">${table([
      { h: '月', v: (r) => esc(r.month) }, { h: '成功（枚）', r: 1, v: (r) => r.pages }, { h: '成功（ファイル）', r: 1, v: (r) => r.ok_cnt }, { h: '失敗', r: 1, v: (r) => r.failed_cnt }, { h: '目安（税抜）', r: 1, v: (r) => yen(r.pages * usage.price_per_page) },
    ], usage.rows, { empty: 'まだ利用がありません' })}</div></div>
    <div class="card mt" id="mail-card"><div class="ch"><h2>送信したメール（最新200件）</h2></div><div class="cb p0">${table([
      { h: '日時', v: (r) => `<span class="small">${dt(r.created_at)}</span>` }, { h: '宛先', v: (r) => `<span class="small">${esc(r.to_addr)}</span>` }, { h: '件名', v: (r) => esc(r.subject) },
      { h: '状態', v: (r) => (r.status === 'failed' ? `<span class="badge red" title="${esc(r.error || '')}">失敗</span>` : r.status === 'sent' ? '<span class="badge green">送信</span>' : '<span class="badge">記録のみ</span>') },
    ], mails, { onRow: true, empty: 'まだ送信していません' })}</div></div>`;
  bindRows($('#mail-card'), mails, (m) => { modal({ title: m.subject, size: 'wide', body: `<div class="small muted">宛先：${esc(m.to_addr)}　${dt(m.created_at)}</div><pre style="white-space:pre-wrap;font-family:inherit;background:#fafbfd;padding:12px;border-radius:8px">${esc(m.body)}</pre>` }); });
  if (isAdmin) $('#save').onclick = (e) => run(e.target, async () => { await api('settings', { method: 'PUT', body: { ...formData($('#co')), ...formData($('#op')) } }); }, '保存しました');
  else $$('#co input, #op input, #op select').forEach((x) => { x.disabled = true; });
  $('#pwb').onclick = (e) => run(e.target, async () => { await api('me/password', { method: 'POST', body: formData($('#pw')) }); $$('#pw input').forEach((x) => { x.value = ''; }); }, 'パスワードを変更しました');
}, { nav: 'settings' });
