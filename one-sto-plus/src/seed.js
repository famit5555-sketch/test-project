'use strict';
// 初期データ。demo=true のときは画面を試せるサンプル（架空の会社・商品）を入れる。
const fs = require('fs');
const { db, DB_PATH, all, get, run, insert, update, setSettings, getSettings } = require('./db');
const U = require('./util');

function seed({ demo = true } = {}) {
  const adminPw = process.env.ADMIN_PASSWORD || 'onesto-admin';
  if (!demo) {
    const b = insert('branches', { name: '本社', sort: 1 });
    insert('users', { login: 'admin', name: '管理者', pw_hash: U.hashPassword(adminPw), role: 'admin', view_scope: 'all', branch_id: b });
    console.log(`初期ユーザーを作成しました（ログインID: admin ／ パスワード: ${adminPw}）`);
    return;
  }
  const S = require('./services');
  const today = U.ymd();
  const t0 = U.parseYmd(today);

  db.transaction(() => {
    setSettings({
      company_name: 'サンプル住設株式会社', company_zip: '460-0008', company_address: '愛知県名古屋市中区栄1-2-3 サンプルビル5F',
      company_tel: '052-000-1234', company_fax: '052-000-1235', invoice_reg_no: 'T1234567890123',
      bank_info: 'サンプル銀行 栄支店 普通 1234567 サンプルジュウセツ（カ', mail_from: 'order@example.com',
    });
    const b1 = insert('branches', { name: '名古屋営業所', zip: '460-0008', address: '名古屋市中区栄1-2-3', tel: '052-000-1234', fax: '052-000-1235', sort: 1 });
    const b2 = insert('branches', { name: '岐阜営業所', zip: '500-8000', address: '岐阜市金町4-5-6', tel: '058-000-5678', fax: '058-000-5679', sort: 2 });
    const d1 = insert('departments', { branch_id: b1, name: '営業1課' });
    const d2 = insert('departments', { branch_id: b1, name: '営業2課' });
    const d3 = insert('departments', { branch_id: b2, name: '営業課' });
    const pw = U.hashPassword('demo1234');
    const admin = insert('users', { login: 'admin', name: '山本 社長', pw_hash: U.hashPassword(adminPw), role: 'admin', view_scope: 'all', branch_id: b1, department_id: d1, email: 'yamamoto@example.com', tel: '052-000-1234' });
    const u1 = insert('users', { login: 'sato', name: '佐藤 健一', pw_hash: pw, role: 'manager', view_scope: 'branch', branch_id: b1, department_id: d1, email: 'sato@example.com', tel: '090-0000-1111' });
    const u2 = insert('users', { login: 'suzuki', name: '鈴木 美咲', pw_hash: pw, role: 'general', view_scope: 'self', branch_id: b1, department_id: d1, email: 'suzuki@example.com', tel: '090-0000-2222' });
    const u3 = insert('users', { login: 'tanaka', name: '田中 翔', pw_hash: pw, role: 'general', view_scope: 'self', branch_id: b1, department_id: d2, email: 'tanaka@example.com', tel: '090-0000-3333' });
    const u4 = insert('users', { login: 'ito', name: '伊藤 誠', pw_hash: pw, role: 'manager', view_scope: 'branch', branch_id: b2, department_id: d3, email: 'ito@example.com', tel: '090-0000-4444' });

    const sup = {};
    for (const [k, code, name, contact] of [
      ['toto', 'S01', 'サンプル衛陶販売株式会社', '中村'], ['lixil', 'S02', 'サンプル住宅建材株式会社', '小林'], ['pana', 'S03', 'サンプル電工住設株式会社', '加藤'],
      ['kitchen', 'S04', 'サンプルキッチン工業株式会社', '吉田'], ['gas', 'S05', 'サンプル給湯機器株式会社', '山田'], ['local', 'S06', '中部住設商事株式会社', '松本'],
    ]) sup[k] = insert('suppliers', { code, name, contact, email: `${k}@supplier.example.com`, tel: '052-111-0000', fax: '052-111-0001', address: '名古屋市' });

    const P = [
      ['TOTO', 'CS-230B', '便器（床排水）', 'ホワイト', '台', 41800, 'A', 0.40, 'toto'], ['TOTO', 'TCF-8GM', '温水洗浄便座 ウォシュレット', 'パステルアイボリー', '台', 88000, 'A', 0.40, 'toto'],
      ['TOTO', 'L-710C', '洗面器 壁掛', 'ホワイト', '台', 23500, 'B', 0.45, 'toto'], ['TOTO', 'TKS-05305', 'キッチン水栓 シングルレバー', '', '個', 45100, 'B', 0.45, 'toto'],
      ['TOTO', 'TBV-03401', '浴室水栓 サーモスタット', '', '個', 38600, 'B', 0.45, 'toto'], ['TOTO', 'LDSWB-075', '洗面化粧台 750幅', 'ホワイト', 'セット', 128000, 'C', 0.38, 'toto'],
      ['LIXIL', 'BC-Z30S', 'アメージュ便器', 'BW1', '台', 39000, 'A', 0.42, 'lixil'], ['LIXIL', 'CW-KA31', 'シャワートイレ', 'BW1', '台', 71000, 'A', 0.42, 'lixil'],
      ['LIXIL', 'SF-WM420', 'キッチン水栓 エコハンドル', '', '個', 52300, 'B', 0.45, 'lixil'], ['LIXIL', 'MAJX2-752', '洗面化粧台 ピアラ 750', '', 'セット', 142000, 'C', 0.40, 'lixil'],
      ['LIXIL', 'BKW-1616', 'ユニットバス リノビオ 1616', '', 'セット', 980000, 'D', 0.35, 'lixil'],
      ['パナソニック', 'XCH-1500', 'アラウーノS160', 'ホワイト', '台', 128000, 'A', 0.43, 'pana'], ['パナソニック', 'XLC-L255', 'IHクッキングヒーター', '', '台', 198000, 'B', 0.40, 'pana'],
      ['パナソニック', 'FY-6HZC', 'レンジフード', 'シルバー', '台', 86000, 'B', 0.42, 'pana'], ['パナソニック', 'GQ-L75', '食器洗い乾燥機 ビルトイン', '', '台', 165000, 'B', 0.40, 'pana'],
      ['クリナップ', 'SS-2550', 'システムキッチン ステディア I型2550', '', 'セット', 1150000, 'D', 0.38, 'kitchen'], ['クリナップ', 'RKT-2550', 'システムキッチン ラクエラ I型2550', '', 'セット', 780000, 'D', 0.40, 'kitchen'],
      ['タカラスタンダード', 'TKC-2550', 'システムキッチン トレーシア', '', 'セット', 1280000, 'D', 0.40, 'kitchen'], ['タカラスタンダード', 'TFS-750', '洗面化粧台 ファミーユ 750', '', 'セット', 158000, 'C', 0.42, 'kitchen'],
      ['リンナイ', 'RUF-E2406', 'ガスふろ給湯器 エコジョーズ 24号', 'オート', '台', 468000, 'E', 0.35, 'gas'], ['リンナイ', 'RS-31W35', 'ビルトインコンロ', '', '台', 185000, 'E', 0.38, 'gas'],
      ['ノーリツ', 'GT-C2462', 'ガスふろ給湯器 24号', 'フルオート', '台', 492000, 'E', 0.35, 'gas'], ['ノーリツ', 'RC-J101', '台所リモコン', '', '個', 18000, 'E', 0.40, 'gas'],
      ['汎用', 'PV-13', '塩ビ管 VP13 4m', '', '本', 1280, null, 0.60, 'local'], ['汎用', 'ST-100', '止水栓 ストレート', '', '個', 3800, null, 0.55, 'local'],
      ['汎用', 'FH-20', 'フレキ管 20A 1m', '', '本', 2400, null, 0.55, 'local'],
    ];
    const prod = {};
    for (const [maker, code, name, spec, unit, lp, dc, cr, sk] of P) {
      prod[code] = insert('products', { maker, code, name, spec: spec || null, unit, list_price: lp, discount_code: dc, cost_rate: cr, supplier_id: sup[sk], stock_qty: ['PV-13', 'ST-100', 'FH-20', 'RC-J101'].includes(code) ? 40 : 0 });
    }

    const C = [
      ['K001', '株式会社ミライ工務店', 'ミライコウムテン', u2, b1, 31], ['K002', '有限会社さくら設備', 'サクラセツビ', u2, b1, 20],
      ['K003', '株式会社東海ハウジング', 'トウカイハウジング', u3, b1, 31], ['K004', '丸山建設株式会社', 'マルヤマケンセツ', u3, b1, 25],
      ['K005', '株式会社ぎふリフォーム', 'ギフリフォーム', u4, b2, 31], ['K006', '長良住宅設備', 'ナガラジュウタクセツビ', u4, b2, 20],
    ];
    const cust = {};
    for (const [code, name, kana, staff, branch, cd] of C) {
      cust[code] = insert('customers', { code, name, kana, staff_id: staff, branch_id: branch, closing_day: cd, pay_month_offset: 1, pay_day: 31, email: `${code.toLowerCase()}@customer.example.com`, tel: '052-222-0000', address: '愛知県名古屋市', zip: '460-0000' });
    }
    insert('customer_users', { customer_id: cust.K001, name: '高橋 一郎', login: 'mirai', pw_hash: U.hashPassword('demo1234'), tel: '090-1111-0000' });
    insert('customer_users', { customer_id: cust.K002, name: '森 由美', login: 'sakura', pw_hash: U.hashPassword('demo1234'), tel: '090-2222-0000' });
    const sites = {};
    sites.a = insert('sites', { customer_id: cust.K001, name: '緑区 佐々木様邸 新築', zip: '458-0000', address: '名古屋市緑区○○町1-1', receiver: '現場監督 高橋', tel: '090-1111-0000', qr_token: 'demo-site-a' });
    sites.b = insert('sites', { customer_id: cust.K001, name: '天白区 浴室リフォーム', zip: '468-0000', address: '名古屋市天白区△△2-3', receiver: '高橋', tel: '090-1111-0000', qr_token: U.token(12) });
    sites.w = insert('sites', { customer_id: cust.K001, name: 'ミライ工務店 資材倉庫', kind: 'warehouse', zip: '454-0000', address: '名古屋市中川区□□5-5', receiver: '倉庫担当', tel: '052-333-0000', qr_token: U.token(12) });
    sites.c = insert('sites', { customer_id: cust.K002, name: '瑞穂区 マンション給湯器交換', address: '名古屋市瑞穂区◇◇3-3', receiver: '森', tel: '090-2222-0000', qr_token: U.token(12) });
    sites.d = insert('sites', { customer_id: cust.K003, name: '守山区 分譲住宅 3号棟', address: '名古屋市守山区☆☆7-7', receiver: '現場監督 岡田', tel: '090-3333-0000', qr_token: U.token(12) });
    sites.e = insert('sites', { customer_id: cust.K005, name: '岐阜市 キッチンリフォーム', address: '岐阜市▽▽1-2', receiver: '清水', tel: '090-5555-0000', qr_token: U.token(12) });

    for (const [cid, maker, dc, sr] of [
      [null, 'TOTO', null, 0.55], [null, 'LIXIL', null, 0.56], [null, 'パナソニック', null, 0.56], [null, 'クリナップ', null, 0.50], [null, 'タカラスタンダード', null, 0.52],
      [null, 'リンナイ', null, 0.48], [null, 'ノーリツ', null, 0.48], [null, '汎用', null, 0.80], [cust.K001, 'TOTO', null, 0.52], [cust.K001, 'TOTO', 'C', 0.50], [cust.K003, 'LIXIL', null, 0.53],
    ]) insert('rate_rules', { customer_id: cid, maker, discount_code: dc, sell_rate: sr });

    const pr = insert('projects', { code: 'A-001', name: '佐々木様邸 新築工事', customer_id: cust.K001, site_id: sites.a, staff_id: u2 });

    // ---- 過去の売上（前年度と今年度の今月まで） ----
    const fsm = 4;
    const fy = U.fiscalYearOf(today, fsm);
    const custList = Object.values(cust);
    const staffOf = Object.fromEntries(all('SELECT id, staff_id, branch_id FROM customers').map((c) => [c.id, c]));
    const sampleCodes = ['CS-230B', 'TCF-8GM', 'TKS-05305', 'LDSWB-075', 'RUF-E2406', 'XLC-L255', 'MAJX2-752', 'GT-C2462', 'FY-6HZC', 'PV-13'];
    let rnd = 7; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
    const startHist = new Date(fy - 1, fsm - 1, 1);
    const endHist = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - 1); // 昨日まで
    for (let d = new Date(startHist); d <= endHist; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || rand() > 0.55) continue;
      const cid = custList[Math.floor(rand() * custList.length)];
      const code = sampleCodes[Math.floor(rand() * sampleCodes.length)];
      const p = get('SELECT * FROM products WHERE code=?', code);
      const q = code === 'PV-13' ? 10 + Math.floor(rand() * 20) : 1 + Math.floor(rand() * 3);
      const price = U.priceByRate(p.list_price, 0.5 + rand() * 0.08);
      const date = U.ymd(d);
      const sub = price * q;
      const sid = insert('sales', { no: `U-${date.slice(2, 4)}${date.slice(5, 7)}-H${String(d.getDate()).padStart(2, '0')}${cid}`, customer_id: cid, staff_id: staffOf[cid].staff_id, branch_id: staffOf[cid].branch_id, sale_date: date, kind: 'sale', subtotal: sub, tax: U.taxOf(sub, 10), total: sub + U.taxOf(sub, 10), cost_total: U.priceByRate(p.list_price, p.cost_rate) * q, note: '過去データ' });
      insert('sale_items', { sale_id: sid, maker: p.maker, code: p.code, name: p.name, qty: q, unit: p.unit, price, amount: sub, cost_price: U.priceByRate(p.list_price, p.cost_rate) });
    }
    // 月ごとに締めて、翌月末に入金（今月・先月分は未入金を残す）
    const paidInv = new Set();
    const payDue = (upto) => {
      for (const inv of all('SELECT * FROM invoices WHERE due_date <= ? ORDER BY closing_date', upto)) {
        if (paidInv.has(inv.id) || inv.due_date >= U.addDays(today, -20) || inv.current_amount <= 0) continue;
        paidInv.add(inv.id);
        const method = rand() < 0.15 ? 'bill' : rand() < 0.1 ? 'densai' : 'transfer';
        const pay = { customer_id: inv.customer_id, pay_date: inv.due_date, method, amount: inv.current_amount - (method === 'transfer' ? 660 : 0), fee: method === 'transfer' ? 660 : 0, auto: true };
        if (method !== 'transfer') pay.due_date = U.addDays(inv.due_date, 90);
        S.addPayment(pay, { id: admin });
      }
    };
    for (let m = new Date(startHist); m <= t0; m.setMonth(m.getMonth() + 1)) {
      const y = m.getFullYear(), mo = m.getMonth() + 1;
      for (const cd of [20, 25, 31]) {
        const cdate = U.closingDateOf(y, mo, cd);
        if (cdate > today) continue;
        payDue(cdate);
        S.closeInvoices(cdate, cd);
      }
    }
    payDue(today);
    run("UPDATE payments SET bill_status='settled' WHERE method IN ('bill','densai') AND due_date < ?", today);
    run("UPDATE invoices SET sent_at = closing_date || ' 18:00:00' WHERE sent_at IS NULL");
    for (const inv of all('SELECT id FROM invoices')) S.refreshInvoiceStatus(inv.id);

    // ---- 見積 ----
    const mkQuote = (h, items, daysAgo, status, extra = {}) => {
      const d = U.addDays(today, -daysAgo);
      const no = `M-${d.slice(2, 4)}${d.slice(5, 7)}-${String(900 + get('SELECT COUNT(*) AS n FROM quotes').n + 1).padStart(4, '0')}`;
      const staff = get('SELECT * FROM users WHERE id=?', h.staff_id);
      const id = insert('quotes', { no, group_no: no, version: 1, status, issue_date: d, valid_until: U.addDays(d, 30), branch_id: staff.branch_id, created_at: `${d} 10:00:00`, updated_at: `${d} 10:00:00`, ...h, ...extra });
      items.forEach(([code, qty, sr, set], i) => {
        const p = get('SELECT * FROM products WHERE code=?', code);
        insert('quote_items', { quote_id: id, seq: i + 1, set_name: set || null, maker: p.maker, code, name: p.name, spec: p.spec, qty, unit: p.unit, list_price: p.list_price, cost_rate: p.cost_rate, cost_price: U.priceByRate(p.list_price, p.cost_rate), sell_rate: sr, sell_price: U.priceByRate(p.list_price, sr), supplier_id: p.supplier_id });
      });
      return id;
    };
    const q1 = mkQuote({ customer_id: cust.K001, project_id: pr, site_name: '緑区 佐々木様邸 新築', title: '佐々木様邸 住宅設備一式', staff_id: u2, delivery_terms: '別途打合せ', payment_terms: '月末締め翌月末払い' },
      [['SS-2550', 1, 0.5, 'キッチンセット'], ['XLC-L255', 1, 0.52, 'キッチンセット'], ['FY-6HZC', 1, 0.52, 'キッチンセット'], ['CS-230B', 2, 0.52], ['TCF-8GM', 2, 0.52], ['LDSWB-075', 1, 0.5], ['RUF-E2406', 1, 0.48]], 12, 'negotiating', { submitted: 1 });
    mkQuote({ customer_id: cust.K001, site_name: '天白区 浴室リフォーム', title: '浴室リフォーム', staff_id: u2 }, [['BKW-1616', 1, 0.5], ['TBV-03401', 1, 0.52]], 20, 'negotiating');
    mkQuote({ customer_id: cust.K002, site_name: '瑞穂区 マンション', title: '給湯器交換 3台', staff_id: u2 }, [['GT-C2462', 3, 0.46], ['RC-J101', 3, 0.5]], 5, 'negotiating');
    mkQuote({ customer_id: cust.K003, site_name: '守山区 分譲住宅', title: '分譲住宅 3号棟 水回り', staff_id: u3 }, [['BC-Z30S', 2, 0.53], ['CW-KA31', 2, 0.53], ['MAJX2-752', 1, 0.53], ['SF-WM420', 1, 0.53]], 30, 'lost', { lost_reason: '価格（他社が安かった）' });
    mkQuote({ customer_id: cust.K004, title: 'トイレ改修 5か所', staff_id: u3 }, [['XCH-1500', 5, 0.52]], 3, 'draft');
    mkQuote({ customer_id: cust.K005, site_name: '岐阜市 キッチンリフォーム', title: 'キッチン入替', staff_id: u4 }, [['TKC-2550', 1, 0.5], ['GQ-L75', 1, 0.5]], 25, 'negotiating');
    mkQuote({ customer_id: cust.K006, title: '洗面台交換', staff_id: u4 }, [['TFS-750', 2, 0.52]], 40, 'lost', { lost_reason: '施主都合で中止' });

    // ---- 受注〜発注の各段階 ----
    const actor = { kind: 'staff', id: u2 };
    // 1) 見積から受注 → 発注送信 → 仕入先回答済み → 納期未連絡
    const q2 = mkQuote({ customer_id: cust.K003, site_name: '守山区 分譲住宅 3号棟', title: '3号棟 給湯・コンロ', staff_id: u3 }, [['RUF-E2406', 1, 0.48], ['RS-31W35', 1, 0.5], ['TKS-05305', 1, 0.53]], 10, 'negotiating');
    const o1 = S.quoteToOrder(q2, { id: u3 });
    update('orders', o1, { site_id: sites.d, ship_address: '名古屋市守山区☆☆7-7', ship_name: '現場監督 岡田', ship_tel: '090-3333-0000', desired_date: U.addDays(today, 10) });
    for (const poId of S.generatePOs(o1, { id: u3 })) {
      update('purchase_orders', poId, { status: 'sent', sent_at: `${U.addDays(today, -6)} 11:00:00`, ship_address: '名古屋市守山区☆☆7-7', ship_name: '現場監督 岡田' });
      const po = get('SELECT * FROM purchase_orders WHERE id=?', poId);
      S.supplierAnswer(po.token, { items: all('SELECT * FROM po_items WHERE po_id=?', poId).map((it) => ({ id: it.id, answer_date: U.addDays(today, 5 + (poId % 3)), answer_price: it.cost_price })), comment: 'よろしくお願いいたします。', person: '担当 中村' });
    }
    // 2) ポータルからの注文（未確認・価格未入力）
    S.createOrder({ customer_id: cust.K001, site_id: sites.a, source: 'portal', orderer_name: '高橋 一郎', desired_date: U.addDays(today, 7), customer_note: '午前中着でお願いします' },
      [{ code: 'PV-13', qty: 20 }, { code: 'ST-100', qty: 6 }, { code: 'FH-20', qty: 6 }], { kind: 'customer', id: 1 });
    // 3) 現場QRからの注文
    S.createOrder({ customer_id: cust.K001, site_id: sites.a, source: 'qr', orderer_name: '設備職人 渡辺（090-9999-0000）', customer_note: '至急' }, [{ code: 'TKS-05305', qty: 1 }], { kind: 'qr' });
    // 4) 見積から受注（発注待ち）
    const q3 = mkQuote({ customer_id: cust.K002, site_name: '瑞穂区 マンション給湯器交換', title: '給湯器交換 1台', staff_id: u2 }, [['GT-C2462', 1, 0.47], ['RC-J101', 1, 0.5]], 4, 'negotiating');
    const o2 = S.quoteToOrder(q3, { id: u2 });
    update('orders', o2, { site_id: sites.c, ship_address: '名古屋市瑞穂区◇◇3-3', ship_name: '森', desired_date: U.addDays(today, 14) });
    // 5) 発注送信済み・回答待ち
    const o3 = S.createOrder({ customer_id: cust.K005, site_id: sites.e, staff_id: u4, customer_ref: 'キッチン部材' }, [{ code: 'FY-6HZC', qty: 1, sell_price: 46000 }, { code: 'GQ-L75', qty: 1, sell_price: 84000 }], actor);
    for (const poId of S.generatePOs(o3, { id: u4 })) update('purchase_orders', poId, { status: 'sent', sent_at: `${U.addDays(today, -2)} 15:00:00` });
    // 6) 出荷済み → 売上未計上
    const o4 = S.createOrder({ customer_id: cust.K001, site_id: sites.b, staff_id: u2 }, [{ code: 'TBV-03401', qty: 1, sell_price: 20000 }, { code: 'L-710C', qty: 1, sell_price: 12200 }], actor);
    for (const poId of S.generatePOs(o4, { id: u2 })) {
      update('purchase_orders', poId, { status: 'sent', sent_at: `${U.addDays(today, -9)} 09:00:00` });
      const po = get('SELECT * FROM purchase_orders WHERE id=?', poId);
      S.supplierAnswer(po.token, { items: all('SELECT * FROM po_items WHERE po_id=?', poId).map((it) => ({ id: it.id, answer_date: U.addDays(today, -2), answer_price: it.cost_price })) });
      update('purchase_orders', poId, { status: 'ship_requested', ship_requested_at: `${U.addDays(today, -4)} 10:00:00` });
      S.supplierShipped(po.token, { shipped_date: U.addDays(today, -3), tracking_no: '1234-5678-9012' });
    }
    update('orders', o4, { eta_notified_at: `${U.addDays(today, -7)} 10:00:00` });
    // 7) 今月の売上計上済み（未請求）
    const o5 = S.createOrder({ customer_id: cust.K004, staff_id: u3 }, [{ code: 'XCH-1500', qty: 2, sell_price: 66560 }], { kind: 'staff', id: u3 });
    for (const poId of S.generatePOs(o5, { id: u3 })) {
      update('purchase_orders', poId, { status: 'sent', sent_at: `${U.addDays(today, -15)} 09:00:00` });
      const po = get('SELECT * FROM purchase_orders WHERE id=?', poId);
      S.supplierAnswer(po.token, { items: all('SELECT * FROM po_items WHERE po_id=?', poId).map((it) => ({ id: it.id, answer_date: U.addDays(today, -8), answer_price: it.cost_price })) });
      S.supplierShipped(po.token, { shipped_date: U.addDays(today, -8) });
    }
    const it5 = all('SELECT * FROM order_items WHERE order_id=?', o5);
    S.recordSale(o5, { sale_date: U.addDays(today, -7), items: it5.map((i) => ({ order_item_id: i.id, qty: i.qty })) }, { id: u3 });
    // 8) 取消依頼
    const o6 = S.createOrder({ customer_id: cust.K001, site_id: sites.w, source: 'portal', orderer_name: '高橋 一郎' }, [{ code: 'RC-J101', qty: 2 }], { kind: 'customer', id: 1 });
    update('orders', o6, { price_confirmed: 1 });
    run("UPDATE order_items SET sell_price=9000 WHERE order_id=?", o6);
    insert('change_requests', { order_id: o6, customer_user_id: 1, kind: 'cancel', message: '施主さんの都合で不要になりました。取消をお願いします。' });

    // ---- 予算（今年度） ----
    // 上の階層の月額を、下の階層へ比率で配る（端数は最後の配分先へ。上下の合計が必ず一致する）
    const w = [8, 8, 9, 8, 7, 9, 9, 8, 10, 7, 8, 11];
    const setB = (level, id, months) => insert('budgets', { fy, level, node_id: id, months: JSON.stringify(months), updated_at: U.now(), updated_by: admin });
    const split = (parent, shares) => {
      const tot = shares.reduce((a, x) => a + x[1], 0);
      const out = shares.map(() => Array(12).fill(0));
      for (let i = 0; i < 12; i++) {
        let rest = parent[i];
        shares.forEach(([, sh], k) => { const v = k === shares.length - 1 ? rest : Math.round(parent[i] * sh / tot / 1000) * 1000; out[k][i] = v; rest -= v; });
      }
      return out;
    };
    const companyM = (() => { const tot = 36000000; const sw = w.reduce((a, b) => a + b, 0); const m = w.map((x) => Math.round(tot * x / sw / 1000) * 1000); m[11] += tot - m.reduce((a, b) => a + b, 0); return m; })();
    setB('company', 0, companyM);
    const [bm1, bm2] = split(companyM, [[b1, 24], [b2, 12]]); setB('branch', b1, bm1); setB('branch', b2, bm2);
    const [dm1, dm2] = split(bm1, [[d1, 15], [d2, 9]]); setB('department', d1, dm1); setB('department', d2, dm2); setB('department', d3, bm2);
    const [um1, um2, umA] = split(dm1, [[u1, 2], [u2, 8], [admin, 5]]); setB('user', u1, um1); setB('user', u2, um2); setB('user', admin, umA);
    setB('user', u3, dm2); setB('user', u4, bm2);
    const [c1, c2] = split(um2, [[cust.K001, 45], [cust.K002, 35]]); setB('customer', cust.K001, c1); setB('customer', cust.K002, c2);
    const [c3, c4] = split(dm2, [[cust.K003, 5], [cust.K004, 4]]); setB('customer', cust.K003, c3); setB('customer', cust.K004, c4);
    const [c5, c6] = split(bm2, [[cust.K005, 65], [cust.K006, 55]]); setB('customer', cust.K005, c5); setB('customer', cust.K006, c6);
    insert('budget_status', { fy, level: 'company', node_id: 0, status: 'approved', updated_at: U.now(), updated_by: admin });
    insert('budget_status', { fy, level: 'branch', node_id: b1, status: 'submitted', updated_at: U.now(), updated_by: u1 });

    run("DELETE FROM notifications");
    S.notify(u2, 'お客様から新しい注文が届きました（株式会社ミライ工務店／緑区 佐々木様邸 新築）', '#/orders?flag=unconfirmed');
    S.notify(u3, '仕入先「サンプル給湯機器株式会社」から回答が届きました', `#/orders/${o1}`);
    void q1;
  })();
  console.log('デモデータを作成しました。');
  console.log(`  社員ログイン: admin / ${adminPw}（管理者）, sato / demo1234（所長）, suzuki / demo1234（営業）`);
  console.log('  お客様ポータル: mirai / demo1234');
  void getSettings;
}

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    db.close();
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
    delete require.cache[require.resolve('./db')];
    delete require.cache[require.resolve('./services')];
    delete require.cache[require.resolve('./mail')];
    delete require.cache[require.resolve('./seed')];
    require('./seed').seed({ demo: !process.argv.includes('--empty') });
  } else seed({ demo: !process.argv.includes('--empty') });
}

module.exports = { seed };
