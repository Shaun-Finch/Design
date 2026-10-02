// Decks: Gizmo writes a presentation from your study sources, projects and activity, previews it,
// exports a real PowerPoint file, and hands it to Figma through the Gizmo plugin.
import { search, sentences, trim, titleCase, terms } from './study.js';

const base = new URL('.', import.meta.url).href;
function loadScript(src, g) { return new Promise((res, rej) => { if (window[g]) return res(window[g]); const s = document.createElement('script'); s.src = src; s.onload = () => res(window[g]); s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }

// shorten a sentence into a slide bullet
const sentenceCase = s => { s = s.replace(/^#+\s*/, '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
export function bullet(s, maxWords = 18) {
  let t = s.replace(/^#\s*/, '').replace(/\s*\([^)]{0,80}\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(however|moreover|furthermore|in addition|additionally|also|therefore|thus|so|and|but|in fact|for example|for instance|finally|first|second|third|overall)[,:]?\s+/i, '');
  const w = t.split(' ');
  if (w.length > maxWords + 2) {
    // cut at a clause boundary if there is one in a sensible place, otherwise trim with an ellipsis
    const m = t.split(/(?<=[,;:])\s|\s[—–]\s/); let acc = '';
    for (const part of m) { const nxt = acc ? acc + ' ' + part : part; if (nxt.split(' ').length > maxWords) break; acc = nxt; }
    t = acc && acc.split(' ').length >= 8 ? acc : w.slice(0, maxWords - 2).join(' ').replace(/\s+(and|or|of|to|the|a|an|in|for|with|that|which|on|by|from|as)$/i, '') + '…';
  }
  t = t.replace(/[.,;:!?]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function deckFromSources(topic, sources, opts = {}) {
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const title = sentenceCase(topic || (sources[0] && sources[0].title) || 'Presentation');
  const slides = [{ layout: 'title', title, bullets: [opts.subtitle || ('Prepared by Gizmo · ' + today)], notes: '' }];
  if (!sources.length) {
    slides.push({ layout: 'bullets', title: 'What this deck needs', bullets: ['Add a source in Study, or connect Claude in Tools', 'Gizmo then writes the slides from it', 'Every point stays traceable to your material'], notes: '' });
    return { title, slides, created: Date.now(), from: [] };
  }
  // pick the passages most relevant to the topic, else use the sources' own summaries
  const hits = topic ? search(sources, topic, 10) : [];
  const pool = [];
  const seen = new Set();
  const add = (s, src) => { const k = s.toLowerCase().slice(0, 80); if (seen.has(k) || s.split(' ').length < 7) return; seen.add(k); pool.push({ s, src }); };
  hits.forEach(h => sentences(h.c).forEach(s => add(s, h.src)));
  sources.forEach(src => src.analysis.summary.forEach(s => add(s, src)));
  const used = new Set();
  const sectionSlides = [], maxSec = opts.sections || 5;
  const tset = new Set(terms(topic || ''));
  // 1) sources with headings: one slide per heading, built from the text under it
  for (const src of sources) {
    const parts = src.text.split(/\n(?=#{1,4}\s)/).map(p => p.trim()).filter(Boolean);
    if (parts.filter(p => /^#{1,4}\s/.test(p)).length < 3) continue;
    const secs = parts.filter(p => /^#{1,4}\s/.test(p)).map(p => { const nl = p.indexOf('\n'); return { h: p.slice(0, nl < 0 ? p.length : nl).replace(/^#+\s+/, '').trim(), body: nl < 0 ? '' : p.slice(nl + 1) }; })
      .filter((x, i) => x.body.split(/\s+/).length > 25 && !(i === 0 && src.text.trim().startsWith('#') && x.body.split(/\s+/).length < 80 && /guide|introduction|overview|how |what /i.test(x.h)));
    // rank sections by relevance to the topic (keeps document order among equals)
    const ranked = tset.size ? secs.map((x, i) => ({ x, i, r: terms(x.h + ' ' + x.body).filter(w => tset.has(w)).length })).sort((a, b) => (b.r > 0) - (a.r > 0) || a.i - b.i).map(o => o.x) : secs;
    for (const sec of ranked) {
      if (sectionSlides.length >= maxSec) break;
      const pts = sentences(sec.body).filter(x => x.split(' ').length >= 7 && !used.has(x)).slice(0, 3);
      if (pts.length < 2) continue;
      pts.forEach(p => used.add(p));
      sectionSlides.push({ layout: 'bullets', title: sentenceCase(sec.h), bullets: pts.map(p => bullet(p)), notes: pts.join(' ') });
    }
  }
  // 2) otherwise, group the strongest passages by key term
  if (sectionSlides.length < 3) {
    const keys = [...new Set(sources.flatMap(s => s.analysis.keyTerms))].sort((a, b) => b.split(' ').length - a.split(' ').length).slice(0, 12);
    for (const sec of keys) {
      if (sectionSlides.length >= maxSec) break;
      if (sectionSlides.some(x => x.title.toLowerCase().includes(sec.toLowerCase()))) continue;
      const st = new Set(terms(sec));
      const pts = pool.filter(p => !used.has(p.s) && terms(p.s).filter(w => st.has(w)).length >= Math.min(st.size, 2)).slice(0, 3);
      if (pts.length < 2) continue;
      pts.forEach(p => used.add(p.s));
      sectionSlides.push({ layout: 'bullets', title: sentenceCase(sec), bullets: pts.map(p => bullet(p.s)), notes: pts.map(p => p.s).join(' ') });
    }
  }
  if (sectionSlides.length) slides.push({ layout: 'agenda', title: 'What we’ll cover', bullets: sectionSlides.map(s => s.title), notes: '' });
  slides.push(...sectionSlides);
  const norm = x => x.replace(/\s+/g, ' ').trim().toLowerCase();
  const usedN = new Set([...used].map(norm));
  const summ = sources.flatMap(src => src.analysis.summary.map(x => ({ s: x, src })));
  const take = summ.filter(p => !usedN.has(norm(p.s)) && p.s.split(' ').length >= 7).slice(0, 4);
  const sum = take.length >= 2 ? take : sectionSlides.slice(0, 4).map(x => ({ s: x.notes.split(/(?<=[.!?])\s/)[0] }));
  slides.push({ layout: 'bullets', title: 'Key takeaways', bullets: sum.map(p => bullet(p.s)), notes: sum.map(p => p.s).join(' ') });
  slides.push({ layout: 'end', title: 'Questions?', bullets: ['Sources: ' + [...new Set(sources.map(s => s.title))].slice(0, 3).join(', ')], notes: '' });
  return { title, slides, created: Date.now(), from: sources.map(s => s.id) };
}

// weekly update deck from real Gizmo data
export function deckFromWeek({ projects, runs, decks, sources }) {
  const wk = new Date(); const mon = new Date(wk); mon.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
  const label = 'Week of ' + mon.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const open = projects.filter(p => p.pct < 100), done = projects.filter(p => p.pct >= 100);
  const since = mon.setHours(0, 0, 0, 0);
  const weekRuns = runs.filter(r => r.started >= since && r.status === 'done');
  const slides = [
    { layout: 'title', title: 'Weekly update', bullets: [label + ' · prepared by Gizmo'], notes: '' },
    { layout: 'bullets', title: 'Projects in progress', bullets: open.slice(0, 6).map(p => p.name + ' — ' + p.pct + '%' + (p.note ? ', next: ' + p.note : '')), notes: '' },
  ];
  if (done.length) slides.push({ layout: 'bullets', title: 'Finished', bullets: done.slice(0, 6).map(p => p.name), notes: '' });
  slides.push({ layout: 'bullets', title: 'What Gizmo handled', bullets: weekRuns.length ? weekRuns.slice(0, 6).map(r => r.title + (r.result ? ' — ' + trim(r.result, 70) : '')) : ['No automated runs yet this week'], notes: '' });
  if (sources.length) slides.push({ layout: 'bullets', title: 'Learning', bullets: sources.slice(0, 5).map(s => s.title + ' — ' + (s.understanding || 0) + '% understood'), notes: '' });
  slides.push({ layout: 'bullets', title: 'Next week', bullets: open.slice(0, 5).map(p => p.note || ('Move ' + p.name + ' forward')), notes: '' });
  return { title: 'Weekly update — ' + label, slides, created: Date.now(), from: [] };
}

// ---------- preview (HTML) ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function slideHTML(s, i, n) {
  const b = (s.bullets || []).map(x => '<li>' + esc(x) + '</li>').join('');
  if (s.layout === 'title') return '<div class="sl sl-title"><div class="sl-kick">Gizmo deck</div><h3>' + esc(s.title) + '</h3><p>' + esc((s.bullets || [])[0] || '') + '</p></div>';
  if (s.layout === 'end') return '<div class="sl sl-end"><h3>' + esc(s.title) + '</h3><p>' + esc((s.bullets || [])[0] || '') + '</p></div>';
  return '<div class="sl"><div class="sl-num">' + String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0') + '</div><h3>' + esc(s.title) + '</h3><ul class="' + (s.layout === 'agenda' ? 'ag' : '') + '">' + b + '</ul></div>';
}

// ---------- PowerPoint ----------
export async function exportPptx(deck) {
  const P = await loadScript(base + 'lib/pptxgen.bundle.js', 'PptxGenJS');
  const pptx = new P();
  pptx.layout = 'LAYOUT_WIDE'; pptx.title = deck.title; pptx.author = 'Gizmo';
  const BLUE = '1A66E8', INK = '16161A', MUTE = '6B6B74';
  deck.slides.forEach((s, i) => {
    const sl = pptx.addSlide();
    if (s.layout === 'title' || s.layout === 'end') {
      sl.background = { color: BLUE };
      sl.addText(s.title, { x: .8, y: s.layout === 'title' ? 2.4 : 2.9, w: 11.7, h: 1.4, fontFace: 'Arial', fontSize: s.layout === 'title' ? 44 : 40, bold: true, color: 'FFFFFF' });
      if (s.bullets && s.bullets[0]) sl.addText(s.bullets[0], { x: .8, y: s.layout === 'title' ? 3.8 : 4.2, w: 11.7, h: .6, fontFace: 'Arial', fontSize: 18, color: 'DCE8FF' });
    } else {
      sl.background = { color: 'FFFFFF' };
      sl.addShape(pptx.ShapeType ? pptx.ShapeType.rect : 'rect', { x: .8, y: .7, w: .5, h: .08, fill: { color: BLUE }, line: { color: BLUE } });
      sl.addText(s.title, { x: .8, y: .85, w: 11.7, h: 1.0, fontFace: 'Arial', fontSize: 32, bold: true, color: INK });
      sl.addText((s.bullets || []).map(t => ({ text: t, options: s.layout === 'agenda' ? { bullet: { type: 'number' } } : { bullet: true } })), { x: .8, y: 2.0, w: 11.7, h: 4.6, fontFace: 'Arial', fontSize: 22, color: '3A3A42', valign: 'top', paraSpaceAfter: 14 });
      sl.addText((i + 1) + ' / ' + deck.slides.length, { x: 11.3, y: 6.9, w: 1.4, h: .4, fontFace: 'Arial', fontSize: 11, color: MUTE, align: 'right' });
    }
    if (s.notes) sl.addNotes(s.notes);
  });
  const name = deck.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'Gizmo deck';
  await pptx.writeFile({ fileName: name + '.pptx' });
  return name + '.pptx';
}

// ---------- Figma (plugin hand-off) ----------
export function figmaJSON(deck) {
  return JSON.stringify({ gizmoDeck: 1, title: deck.title, slides: deck.slides.map(s => ({ layout: s.layout, title: s.title, bullets: s.bullets || [], notes: s.notes || '' })) });
}
