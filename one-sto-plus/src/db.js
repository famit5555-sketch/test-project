'use strict';
// データベース（SQLite）。スキーマ定義と共通ヘルパー。
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'onesto.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, zip TEXT, address TEXT, tel TEXT, fax TEXT, sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY, branch_id INTEGER REFERENCES branches(id), name TEXT NOT NULL, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw_hash TEXT,
  role TEXT NOT NULL DEFAULT 'general',            -- admin / manager / general
  view_scope TEXT NOT NULL DEFAULT 'self',         -- all / branch / self（初期表示の範囲）
  branch_id INTEGER REFERENCES branches(id), department_id INTEGER REFERENCES departments(id),
  email TEXT, tel TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id INTEGER NOT NULL, expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, code TEXT, name TEXT NOT NULL, kana TEXT, zip TEXT, address TEXT, tel TEXT, fax TEXT, email TEXT,
  closing_day INTEGER DEFAULT 31,                  -- 締め日（31=末日）
  pay_month_offset INTEGER DEFAULT 1, pay_day INTEGER DEFAULT 31, -- 回収条件（翌月末など）
  staff_id INTEGER REFERENCES users(id), branch_id INTEGER REFERENCES branches(id),
  note TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customer_users (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), name TEXT NOT NULL,
  login TEXT UNIQUE NOT NULL, pw_hash TEXT, tel TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), name TEXT NOT NULL,
  kind TEXT DEFAULT 'site',                        -- site（現場）/ warehouse（倉庫）
  zip TEXT, address TEXT, receiver TEXT, tel TEXT, qr_token TEXT UNIQUE, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, code TEXT, name TEXT NOT NULL, zip TEXT, address TEXT, tel TEXT, fax TEXT, email TEXT,
  contact TEXT, note TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, maker TEXT, code TEXT NOT NULL, name TEXT, spec TEXT, unit TEXT DEFAULT '個',
  list_price REAL DEFAULT 0, discount_code TEXT, cost_rate REAL, supplier_id INTEGER REFERENCES suppliers(id),
  stock_qty REAL DEFAULT 0, active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE TABLE IF NOT EXISTS rate_rules (
  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), maker TEXT, discount_code TEXT,
  sell_rate REAL, cost_rate REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, code TEXT, name TEXT NOT NULL, customer_id INTEGER REFERENCES customers(id),
  site_id INTEGER REFERENCES sites(id), staff_id INTEGER REFERENCES users(id), note TEXT, active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY, no TEXT, group_no TEXT, version INTEGER DEFAULT 1,
  customer_id INTEGER REFERENCES customers(id), project_id INTEGER REFERENCES projects(id), site_name TEXT, title TEXT,
  staff_id INTEGER REFERENCES users(id), branch_id INTEGER REFERENCES branches(id),
  status TEXT DEFAULT 'draft',                     -- draft / negotiating / won / lost
  lost_reason TEXT, issue_date TEXT, valid_until TEXT, delivery_terms TEXT, payment_terms TEXT, note TEXT,
  submitted INTEGER DEFAULT 0, show_set_detail INTEGER DEFAULT 1, order_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE, seq INTEGER,
  set_name TEXT, maker TEXT, code TEXT, name TEXT, spec TEXT, qty REAL DEFAULT 1, unit TEXT,
  list_price REAL DEFAULT 0, cost_rate REAL, cost_price REAL DEFAULT 0, sell_rate REAL, sell_price REAL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id), uncertain INTEGER DEFAULT 0, note TEXT
);
CREATE TABLE IF NOT EXISTS ai_reads (
  id INTEGER PRIMARY KEY, user_id INTEGER, file_name TEXT, pages INTEGER DEFAULT 1, status TEXT, error TEXT,
  result_json TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), quote_id INTEGER
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, no TEXT, customer_id INTEGER REFERENCES customers(id), site_id INTEGER REFERENCES sites(id),
  quote_id INTEGER, project_id INTEGER, staff_id INTEGER REFERENCES users(id), branch_id INTEGER REFERENCES branches(id),
  source TEXT DEFAULT 'manual',                    -- manual / quote / portal / qr
  status TEXT DEFAULT 'open',                      -- open / completed / cancelled
  orderer_name TEXT, customer_ref TEXT, ship_zip TEXT, ship_address TEXT, ship_name TEXT, ship_tel TEXT,
  desired_date TEXT, customer_note TEXT, internal_note TEXT,
  price_confirmed INTEGER DEFAULT 1, price_notified_at TEXT, eta_notified_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, seq INTEGER,
  product_id INTEGER, maker TEXT, code TEXT, name TEXT, spec TEXT, qty REAL DEFAULT 1, unit TEXT,
  list_price REAL DEFAULT 0, sell_price REAL, cost_price REAL, supplier_id INTEGER REFERENCES suppliers(id),
  source TEXT DEFAULT 'po',                        -- po（仕入先へ発注）/ stock（自社在庫から引当）
  eta_date TEXT, status TEXT DEFAULT 'open',       -- open / ordered / answered / shipped / delivered / cancelled
  sold_qty REAL DEFAULT 0, returned_qty REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY, no TEXT, order_id INTEGER REFERENCES orders(id), supplier_id INTEGER REFERENCES suppliers(id),
  staff_id INTEGER REFERENCES users(id), branch_id INTEGER REFERENCES branches(id),
  purpose TEXT DEFAULT 'order',                    -- order（受注分）/ stock（在庫・枠取り）
  status TEXT DEFAULT 'draft',                     -- draft / sent / answered / ship_requested / shipped / received / cancelled
  token TEXT UNIQUE, ship_zip TEXT, ship_address TEXT, ship_name TEXT, ship_tel TEXT, desired_date TEXT, note TEXT,
  sent_at TEXT, answered_at TEXT, shipping_fee REAL, answer_comment TEXT, answer_person TEXT,
  ship_requested_at TEXT, ship_request_note TEXT, shipped_at TEXT, ship_note TEXT, tracking_no TEXT, received_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS po_items (
  id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id), product_id INTEGER, maker TEXT, code TEXT, name TEXT, spec TEXT,
  qty REAL, unit TEXT, list_price REAL, cost_price REAL,
  answer_date TEXT, answer_price REAL, answer_qty REAL, alt_code TEXT, alt_name TEXT, answer_note TEXT
);
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), customer_user_id INTEGER,
  kind TEXT NOT NULL, message TEXT, status TEXT DEFAULT 'pending', reply TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), decided_at TEXT, decided_by INTEGER
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY, no TEXT, order_id INTEGER REFERENCES orders(id), customer_id INTEGER REFERENCES customers(id),
  staff_id INTEGER, branch_id INTEGER, sale_date TEXT NOT NULL, kind TEXT DEFAULT 'sale', -- sale / return（赤伝）
  subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0, cost_total REAL DEFAULT 0,
  invoice_id INTEGER REFERENCES invoices(id), note TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE, order_item_id INTEGER,
  maker TEXT, code TEXT, name TEXT, qty REAL, unit TEXT, price REAL, amount REAL, cost_price REAL
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, no TEXT, customer_id INTEGER NOT NULL REFERENCES customers(id), closing_date TEXT NOT NULL,
  period_from TEXT, period_to TEXT, prev_amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0, carry_amount REAL DEFAULT 0,
  sales_amount REAL DEFAULT 0, tax_amount REAL DEFAULT 0, current_amount REAL DEFAULT 0, total_amount REAL DEFAULT 0,
  due_date TEXT, status TEXT DEFAULT 'issued', sent_at TEXT, token TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), pay_date TEXT NOT NULL,
  method TEXT DEFAULT 'transfer',                  -- transfer / cash / bill（手形）/ densai（でんさい）/ offset（相殺）/ other
  amount REAL NOT NULL, fee REAL DEFAULT 0, due_date TEXT, bill_no TEXT, bill_status TEXT, note TEXT,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id), amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY, fy INTEGER NOT NULL, level TEXT NOT NULL, node_id INTEGER NOT NULL,
  months TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]', updated_at TEXT, updated_by INTEGER,
  UNIQUE (fy, level, node_id)
);
CREATE TABLE IF NOT EXISTS budget_status (
  fy INTEGER NOT NULL, level TEXT NOT NULL, node_id INTEGER NOT NULL,
  status TEXT DEFAULT 'draft',                     -- draft / submitted / approved（配下への配分の状態）
  updated_at TEXT, updated_by INTEGER, PRIMARY KEY (fy, level, node_id)
);

CREATE TABLE IF NOT EXISTS mails (
  id INTEGER PRIMARY KEY, to_addr TEXT, subject TEXT, body TEXT, related TEXT, status TEXT, error TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER, message TEXT, link TEXT, is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;
db.exec(SCHEMA);

// ---- ヘルパー ----
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const tx = (fn) => db.transaction(fn);

function insert(table, obj) {
  const keys = Object.keys(obj);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
  return Number(r.lastInsertRowid);
}
function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id);
}

const DEFAULT_SETTINGS = {
  company_name: '株式会社サンプル住設',
  company_zip: '', company_address: '', company_tel: '', company_fax: '',
  invoice_reg_no: '',                              // 適格請求書発行事業者の登録番号（T+13桁）
  bank_info: '',
  tax_rate: '10',
  fiscal_start_month: '4',
  quote_valid_days: '30',
  budget_basis: 'sales',                           // sales（売上計上）/ orders（受注）
  csv_columns: JSON.stringify(['date', 'slip_no', 'customer_code', 'customer_name', 'debit', 'credit', 'amount', 'tax', 'memo']),
  csv_encoding: 'sjis',
  csv_debit: '売掛金', csv_credit: '売上高',
  mail_from: '',
  ai_price_per_page: '30',
};
function getSettings() {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM settings')) s[r.key] = r.value;
  return s;
}
function setSettings(obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => { for (const [k, v] of Object.entries(obj)) if (k in DEFAULT_SETTINGS) st.run(k, v == null ? '' : String(v)); })();
}

// 伝票番号: 接頭辞-YYMM-連番
function nextNo(prefix, date = new Date()) {
  const ym = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const name = `${prefix}-${ym}`;
  run('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1', name);
  const v = get('SELECT value FROM counters WHERE name=?', name).value;
  return `${name}-${String(v).padStart(4, '0')}`;
}

module.exports = { db, DB_PATH, DATA_DIR, all, get, run, tx, insert, update, getSettings, setSettings, nextNo };
