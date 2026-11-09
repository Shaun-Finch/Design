// Health club 3D tour: loads the 3D scene when the browser supports it, otherwise shows every item as a list.
import { ZONES, ITEMS } from './data.js';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const has3D = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
if (has3D) import('./scene.js').catch(e => { console.warn(e); noGL(); }); else noGL();

function noGL() {
  // No 3D: show every item and its specs as a plain list instead
  $('#load').classList.add('off');
  ['#stops', '.map', '#help', '#hint', '#dpad', '#listBtn'].forEach(q => { const el = $(q); if (el) el.hidden = true; });
  const lv = $('#listv'); lv.hidden = false; $('#lvClose').hidden = true;
  lv.querySelector('p').textContent = '3D isn’t available in this browser, so here is everything in the club as a list. A fictional club: specs, nutrition and prices are illustrative.';
  $('#lvBody').innerHTML = Object.keys(ZONES).map(z => `<h3 style="color:${ZONES[z].color}">${ZONES[z].name}</h3><div class="grid">${Object.values(ITEMS).filter(it => it.zone === z).map(it => `<details class="glass" style="padding:12px 14px;border-radius:14px"><summary style="cursor:pointer"><b>${esc(it.title)}</b></summary><p style="color:#3b4a45;font-size:.9rem">${esc(it.desc)}</p>${it.specs ? `<dl class="specs">${it.specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}${it.products ? `<dl class="specs">${it.products.map(p => `<dt>${esc(p.name)} (${esc(p.size)})</dt><dd>${p.kcal} kcal · ${p.protein} g protein · ${esc(p.price)}</dd>`).join('')}</dl>` : ''}</details>`).join('')}</div>`).join('');
}
