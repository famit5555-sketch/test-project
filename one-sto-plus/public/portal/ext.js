/* 社外向け画面の共通部品 */
'use strict';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v == null || v === '' ? '' : Math.round(Number(v)).toLocaleString('ja-JP'));
const yen = (v) => (v == null ? '—' : `¥${n0(v)}`);
const qtyf = (v) => (v == null ? '' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 }));
const jd = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${y}/${Number(m)}/${Number(d)}`; };
const dt = (s) => (s ? `${jd(s)} ${String(s).slice(11, 16)}` : '');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const LOGO = `<span class="logo"><svg width="34" height="28" viewBox="0 0 44 36" aria-hidden="true"><circle cx="13" cy="21" r="10" fill="none" stroke="#25418f" stroke-width="5"/><circle cx="25" cy="21" r="10" fill="none" stroke="#2bb3a3" stroke-width="5"/><circle cx="36" cy="8" r="6.5" fill="#f59e0b"/><path d="M36 4.5v7M32.5 8h7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg><span><span class="t">One-Sto <b>Plus</b></span><span class="k">ワンスト プラス</span></span></span>`;

async function xapi(path, { method = 'GET', body } = {}) {
  const opt = { method, headers: { 'X-Requested-With': 'fetch' } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : {};
  if (!res.ok) { const e = new Error(data.error || `エラー（${res.status}）`); e.status = res.status; throw e; }
  return data;
}
function toast(msg, err) { const t = document.createElement('div'); t.className = `toast ${err ? 'e' : ''}`; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5000 : 3000); }
async function busy(btn, fn) { btn.disabled = true; try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; } }

// 注文の明細入力（品番を入れると候補を表示）
function orderItems(container, searchUrl) {
  const items = [{ code: '', qty: 1 }];
  const draw = () => {
    container.innerHTML = items.map((it, i) => `<div class="item-row" data-i="${i}">
      <div><input data-f="code" placeholder="品番または品名" value="${esc(it.code)}" autocomplete="off"><div class="pinfo">${it.p ? `${esc(it.p.maker || '')} ${esc(it.p.name || '')} ${esc(it.p.spec || '')}` : it.code ? '商品マスターに無い品番です（そのまま注文できます）' : ''}</div></div>
      <div><input data-f="qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(it.qty)}" aria-label="数量"><div class="pinfo">${esc(it.p?.unit || '')}</div></div>
      <button class="btn sm" data-del aria-label="削除" ${items.length === 1 ? 'disabled' : ''}>×</button></div>`).join('') + '<button class="btn sm" data-add style="margin-top:10px">＋ 明細を追加</button>';
    $$('.item-row', container).forEach((row) => {
      const it = items[Number(row.dataset.i)];
      const ci = $('[data-f=code]', row);
      ci.oninput = () => { it.code = ci.value; it.p = null; it.product_id = null; };
      $('[data-f=qty]', row).oninput = (e) => { it.qty = e.target.value; };
      $('[data-del]', row).onclick = () => { items.splice(Number(row.dataset.i), 1); draw(); };
      let box = null, timer = null;
      const close = () => { if (box) { box.remove(); box = null; } };
      ci.addEventListener('input', () => {
        clearTimeout(timer); const q = ci.value.trim(); if (q.length < 2) return close();
        timer = setTimeout(async () => {
          const list = await xapi(searchUrl + encodeURIComponent(q)).catch(() => []);
          close(); if (!list.length || document.activeElement !== ci) return;
          box = document.createElement('div'); box.className = 'ac';
          const r = ci.getBoundingClientRect(); box.style.left = `${r.left + scrollX}px`; box.style.top = `${r.bottom + scrollY + 2}px`; box.style.width = `${Math.max(r.width, 280)}px`;
          box.innerHTML = list.map((p, k) => `<div data-k="${k}"><b>${esc(p.code)}</b> <span class="muted">${esc(p.maker || '')}</span><br><span class="small">${esc(p.name || '')} ${esc(p.spec || '')}</span></div>`).join('');
          document.body.appendChild(box);
          $$('div[data-k]', box).forEach((d) => { d.onmousedown = (e) => { e.preventDefault(); const p = list[Number(d.dataset.k)]; it.code = p.code; it.p = p; it.product_id = p.id; close(); draw(); $$('.item-row [data-f=qty]', container)[Number(row.dataset.i)]?.focus(); }; });
        }, 220);
      });
      ci.addEventListener('blur', () => setTimeout(close, 150));
    });
    $('[data-add]', container).onclick = () => { items.push({ code: '', qty: 1 }); draw(); $$('.item-row [data-f=code]', container).pop()?.focus(); };
  };
  draw();
  return {
    values: () => items.filter((x) => String(x.code).trim() && Number(x.qty) > 0).map((x) => ({ code: String(x.code).trim(), product_id: x.product_id || null, maker: x.p?.maker || null, name: x.p?.name || null, qty: Number(x.qty) })),
    reset: () => { items.splice(0, items.length, { code: '', qty: 1 }); draw(); },
  };
}
