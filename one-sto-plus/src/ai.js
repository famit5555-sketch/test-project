'use strict';
// 仕入先見積書の AI 読み取り（Claude API）。PDF・画像・Excel を明細データに起こす。
const Anthropic = require('@anthropic-ai/sdk');
const XLSX = require('xlsx');

const MODEL = process.env.AI_MODEL || 'claude-opus-5';
let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  if (!client) client = new Anthropic();
  return client;
}
const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier_name', 'document_no', 'document_date', 'addressee', 'site_name', 'price_basis', 'items', 'subtotal', 'tax', 'total', 'notes'],
  properties: {
    supplier_name: str, document_no: str, document_date: str, addressee: str, site_name: str,
    price_basis: { type: 'string', enum: ['rate', 'list', 'net', 'mixed'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['set_name', 'maker', 'code', 'name', 'spec', 'qty', 'unit', 'list_price', 'rate', 'net_price', 'amount', 'uncertain', 'note'],
        properties: {
          set_name: str, maker: str, code: str, name: str, spec: str, qty: num, unit: str,
          list_price: num, rate: num, net_price: num, amount: num,
          uncertain: { type: 'boolean' }, note: str,
        },
      },
    },
    subtotal: num, tax: num, total: num, notes: str,
  },
};

const PROMPT = `あなたは住宅設備商社の事務担当です。添付は仕入先（メーカー・商社）から届いた見積書です。
書式はメーカーや商社ごとに違います。すべての明細行を、上から順に漏れなく読み取ってください。

ルール:
- maker: メーカー名（TOTO、LIXIL、パナソニック、クリナップ、タカラスタンダード、リンナイ、ノーリツなど）。見出しや品番から判断できなければ null。
- code: 品番（型番）。記号・ハイフンも紙面どおりに。name: 品名。spec: 色・サイズ・仕様など。
- qty: 数量、unit: 単位（個・台・本・式・セット など）。
- list_price: 定価（希望小売価格・上代）の単価。
- rate: 掛率を 0〜1 の小数で（「45%」「0.45」「4.5掛」はすべて 0.45）。
- net_price: 値引後（仕切り・納め）の単価。
- 紙面に掛率しかなければ net_price = list_price × rate、値引後単価しかなければ rate = net_price ÷ list_price を計算して入れてください。
  定価しか書かれていない場合は rate と net_price を null にします。
- amount: その行の金額（紙面の値）。
- set_name: 「〇〇セット」「〇〇一式」など、見出しでまとめられている明細はその見出し名。なければ null。
- 小計・消費税・値引行・送料などの合計行は items に入れず、subtotal / tax / total に入れてください（送料・値引が明細扱いなら items に入れて構いません）。
- 読み取りに自信がない値（かすれ・手書き・計算が合わない等）がある行は uncertain = true、note に理由を短く。
- price_basis: 紙面の価格の出し方。掛率中心なら rate、定価のみなら list、値引後単価のみなら net、混在なら mixed。
- 数値はカンマや円記号を除いた数値で。読めない値は null。`;

function mediaTypeOf(file) {
  const n = (file.originalname || '').toLowerCase();
  if (file.mimetype === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx|xls|xlsm)$/.test(n) || /spreadsheet|excel/.test(file.mimetype)) return 'excel';
  if (/\.(png)$/.test(n) || file.mimetype === 'image/png') return 'image/png';
  if (/\.(jpe?g)$/.test(n) || file.mimetype === 'image/jpeg') return 'image/jpeg';
  if (/\.(webp)$/.test(n) || file.mimetype === 'image/webp') return 'image/webp';
  if (/\.(gif)$/.test(n) || file.mimetype === 'image/gif') return 'image/gif';
  return null;
}
function pdfPageCount(buf) {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return Math.max(1, m ? m.length : 1);
}

function contentBlockFor(file) {
  const t = mediaTypeOf(file);
  if (!t) throw new Error('対応していない形式です（PDF・Excel・JPEG/PNG に対応）');
  if (t === 'pdf') {
    return { pages: pdfPageCount(file.buffer), block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } } };
  }
  if (t === 'excel') {
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const text = wb.SheetNames.map((n) => `### シート: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n');
    return { pages: wb.SheetNames.length, block: { type: 'text', text: `以下は Excel 見積書の内容（CSV 形式）です。\n${text.slice(0, 400000)}` } };
  }
  return { pages: 1, block: { type: 'image', source: { type: 'base64', media_type: t, data: file.buffer.toString('base64') } } };
}

function normalize(r) {
  const items = (r.items || []).map((it) => {
    let { list_price: lp, rate, net_price: np, qty } = it;
    if (rate != null && rate > 1.5) rate = rate / 100; // 45 → 0.45
    if (np == null && lp != null && rate != null) np = Math.floor(lp * rate);
    if (rate == null && lp && np != null) rate = Math.round((np / lp) * 10000) / 10000;
    return { ...it, list_price: lp, rate, net_price: np, qty: qty == null ? 1 : qty };
  });
  const sum = items.reduce((s, it) => s + (it.amount != null ? it.amount : (it.net_price ?? it.list_price ?? 0) * (it.qty || 0)), 0);
  const docSubtotal = r.subtotal ?? (r.total != null && r.tax != null ? r.total - r.tax : null);
  return { ...r, items, computed_subtotal: Math.round(sum), subtotal_matches: docSubtotal == null ? null : Math.abs(docSubtotal - sum) < 1.5 };
}

async function readQuoteFile(file) {
  const c = getClient();
  if (!c) throw Object.assign(new Error('AI 読み取りの設定がされていません（環境変数 ANTHROPIC_API_KEY を設定してください）'), { status: 400 });
  const { pages, block } = contentBlockFor(file);
  // 明細が多い見積書は出力が長くなるため、ストリーミングで受け取る
  const stream = c.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('AI がこのファイルの読み取りを行えませんでした');
  if (response.stop_reason === 'max_tokens') throw new Error('明細が多すぎて読み取りが途中で終わりました。ページを分けてお試しください');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error('読み取り結果を解析できませんでした'); }
  return { pages, result: normalize(parsed) };
}

module.exports = { readQuoteFile, aiEnabled, mediaTypeOf, MODEL };
