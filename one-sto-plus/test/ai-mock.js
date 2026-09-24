'use strict';
// AI 読み取りの流れを、偽の Claude API サーバーで確認する（実際の API は呼ばない）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const XLSX = require('xlsx');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osp-ai-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'pw-for-test';
process.env.ANTHROPIC_API_KEY = 'test-key';

const requests = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body);
    requests.push({ url: req.url, headers: req.headers, body: j });
    const result = {
      supplier_name: 'サンプル衛陶販売株式会社', document_no: 'Q-100', document_date: '2026-09-01', addressee: 'サンプル住設', site_name: null, price_basis: 'rate',
      items: [
        { set_name: null, maker: 'TOTO', code: 'CS-230B', name: '便器', spec: null, qty: 2, unit: '台', list_price: 41800, rate: 40, net_price: null, amount: 33440, uncertain: false, note: null },
        { set_name: null, maker: 'TOTO', code: 'TCF-8GM', name: '便座', spec: null, qty: 1, unit: '台', list_price: 88000, rate: null, net_price: 35200, amount: 35200, uncertain: true, note: 'かすれ' },
      ],
      subtotal: 68640, tax: 6864, total: 75504, notes: null,
    };
    const text = JSON.stringify(result);
    res.setHeader('Content-Type', 'text/event-stream');
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(0, 50) } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(50) } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
    ev('message_stop', {});
    res.end();
  });
});

(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  const app = require('../server');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'pw-for-test' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const fd = new FormData();
    fd.append('files', new Blob(['%PDF-1.4\n1 0 obj << /Type /Page >>\n2 0 obj << /Type /Page >>'], { type: 'application/pdf' }), 'mitsumori.pdf');
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['品番', '数量'], ['CS-230B', 2]]), '見積');
    fd.append('files', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'mitsumori.xlsx');
    const r = await fetch(`${base}/api/ai/read`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'fetch' }, body: fd });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(d.results.length, 2);
    const pdf = d.results[0];
    assert.ok(pdf.ok, JSON.stringify(pdf)); assert.equal(pdf.pages, 2);
    assert.equal(pdf.result.items[0].rate, 0.4, '45 → 0.45 のような百分率を小数に直す');
    assert.equal(pdf.result.items[0].net_price, 16720, '掛率から値引後単価を計算');
    assert.equal(pdf.result.items[1].rate, 0.4, '値引後単価から掛率を逆算');
    assert.equal(pdf.result.subtotal_matches, true, '紙面の小計と一致');
    // API へのリクエスト内容
    const q = requests[0];
    assert.equal(q.url, '/v1/messages?beta=true');
    assert.equal(q.body.model, 'claude-opus-5');
    assert.equal(q.body.output_config.format.type, 'json_schema');
    assert.equal(q.body.stream, true);
    assert.equal(q.body.messages[0].content[0].type, 'document');
    assert.equal(q.body.messages[0].content[0].source.media_type, 'application/pdf');
    assert.equal(q.body.fallbacks, 'default');
    assert.match(q.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(requests[1].body.messages[0].content[0].type, 'text', 'Excel は CSV テキストとして送る');
    assert.match(requests[1].body.messages[0].content[0].text, /CS-230B/);
    const usage = await (await fetch(`${base}/api/ai/usage`, { headers: { Cookie: cookie } })).json();
    assert.equal(usage.rows[0].pages, 3);
    console.log('AI読み取りの流れ: すべて成功しました');
  } catch (e) { console.error('失敗:', e); process.exitCode = 1; } finally {
    server.close(); fake.close();
    try { require('../src/db').db.close(); } catch (_) { /* noop */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
