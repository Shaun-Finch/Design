// Study engine: read files, summarise, pull out key terms, build quizzes and flashcards, answer questions from your sources.
// Runs entirely in the browser. With a Claude key connected, answers can also be written by Claude from the same passages.

const STOP = new Set(('a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let like made make many may me might more most much must my myself no nor not now of off often on once one only or other our ours ourselves out over own per same she should so some such than that the their theirs them themselves then there these they this those through thus to too under until up upon us use used using very via was we were what when where which while who whom whose why will with within without would yet you your yours yourself yourselves however therefore although though also either neither whether rather quite still even ever every first second third new old another around across along among always never sometimes usually often well back way ways thing things something anything everything nothing get gets got getting go goes going went come comes came take takes took give gives gave say says said see seen show shows shown know known want need needs part parts lot lots kind kinds sort type types fact facts case cases example examples point points number numbers time times year years day days people person place places work works chapter section page pages figure table et al ie eg etc'
).split(/\s+/));

export function words(s) { return (s.toLowerCase().match(/[a-z][a-z'’-]*[a-z]|[a-z]/g) || []).map(w => w.replace(/[’']s$/, '')); }
function stem(w) {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}
export function terms(s) { return words(s).filter(w => w.length > 2 && !STOP.has(w)).map(stem); }

export function sentences(text) {
  const out = [];
  for (const para of text.split(/\n\s*\n|\n(?=[-•*]\s)/)) {
    const p = para.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    const m = p.match(/[^.!?]+(?:[.!?]+["”’)\]]*|$)/g) || [p];
    let buf = '';
    for (const s of m) {
      buf += s;
      // keep abbreviations and initials together (e.g., Dr. / U.S. / Fig.)
      if (/\b(?:[A-Z]|Dr|Mr|Mrs|Ms|Prof|St|Fig|vs|etc|e\.g|i\.e|No|Vol|pp|cf)\.\s*$/.test(buf.trim()) && buf.length < 400) continue;
      const t = buf.trim(); buf = '';
      if (t) out.push(t);
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

// ---------- file reading ----------
const base = new URL('.', import.meta.url).href;
let pdfjs = null;
async function loadPdf() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(base + 'lib/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = base + 'lib/pdf.worker.min.mjs';
  return pdfjs;
}
function loadScript(src, globalName) {
  return new Promise((res, rej) => {
    if (globalName && window[globalName]) return res(window[globalName]);
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(globalName ? window[globalName] : true); s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
export const loadJSZip = () => loadScript(base + 'lib/jszip.min.js', 'JSZip');

function blocksToText(root) {
  const out = [];
  const walk = el => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, ' '); if (t.trim()) out.push(t); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (/^(script|style|nav|svg|noscript|head)$/.test(tag)) continue;
      const block = /^(p|div|section|article|li|h[1-6]|blockquote|tr|br|pre|figcaption|dd|dt)$/.test(tag);
      if (/^h[1-6]$/.test(tag)) { out.push('\n\n# '); walk(n); out.push('\n\n'); continue; }
      if (block) out.push('\n\n');
      walk(n);
      if (block) out.push('\n\n');
    }
  };
  walk(root);
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/# \s+/g, '# ').trim();
}

export async function readFile(file, onProgress = () => {}) {
  const name = file.name, ext = (name.split('.').pop() || '').toLowerCase();
  const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  if (ext === 'pdf') {
    const lib = await loadPdf();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, 1500), parts = [];
    for (let i = 1; i <= pages; i++) {
      const pg = await doc.getPage(i), tc = await pg.getTextContent();
      let line = '', lines = [];
      for (const it of tc.items) { line += it.str; if (it.hasEOL) { lines.push(line); line = ''; } }
      if (line) lines.push(line);
      // re-join lines into paragraphs: a short line or a line ending in . ends a paragraph
      let para = '', paras = [];
      for (const l of lines.map(x => x.trim())) {
        if (!l) { if (para) { paras.push(para); para = ''; } continue; }
        para = para ? (para.endsWith('-') ? para.slice(0, -1) + l : para + ' ' + l) : l;
        if (/[.!?:]["”’)]?$/.test(l) && l.length < 70) { paras.push(para); para = ''; }
      }
      if (para) paras.push(para);
      parts.push(paras.join('\n\n'));
      if (i % 5 === 0) onProgress(i / pages);
    }
    let meta = null; try { meta = await doc.getMetadata(); } catch (e) { }
    const t = meta && meta.info && meta.info.Title && meta.info.Title.trim();
    return { title: t && t.length > 3 ? t : title, type: 'PDF', text: parts.join('\n\n') };
  }
  if (ext === 'docx') {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paras = [];
    for (const p of d.getElementsByTagNameNS(W, 'p')) {
      let t = '';
      for (const n of p.getElementsByTagNameNS(W, '*')) {
        if (n.localName === 't') t += n.textContent;
        else if (n.localName === 'tab') t += ' ';
        else if (n.localName === 'br') t += '\n';
      }
      const st = p.getElementsByTagNameNS(W, 'pStyle')[0];
      const heading = st && /heading|title/i.test(st.getAttributeNS(W, 'val') || st.getAttribute('w:val') || '');
      if (t.trim()) paras.push((heading ? '# ' : '') + t.trim());
    }
    return { title, type: 'Word', text: paras.join('\n\n') };
  }
  if (ext === 'epub') {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const cont = new DOMParser().parseFromString(await zip.file('META-INF/container.xml').async('string'), 'application/xml');
    const opfPath = cont.getElementsByTagName('rootfile')[0].getAttribute('full-path');
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
    const man = {};
    for (const it of opf.getElementsByTagName('item')) man[it.getAttribute('id')] = it.getAttribute('href');
    const bookTitle = (opf.getElementsByTagName('dc:title')[0] || {}).textContent;
    const refs = [...opf.getElementsByTagName('itemref')].map(r => man[r.getAttribute('idref')]).filter(Boolean);
    const parts = [];
    for (let i = 0; i < refs.length; i++) {
      const path = decodeURIComponent(dir + refs[i].split('#')[0]);
      const f = zip.file(path); if (!f) continue;
      const html = await f.async('string');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      parts.push(blocksToText(doc.body || doc.documentElement));
      onProgress((i + 1) / refs.length);
    }
    return { title: (bookTitle || title).trim(), type: 'Book', text: parts.join('\n\n') };
  }
  if (ext === 'html' || ext === 'htm') {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    const art = doc.querySelector('article,main') || doc.body;
    return { title: (doc.title || title).trim(), type: 'Article', text: blocksToText(art) };
  }
  if (/^(txt|md|markdown|text|csv|rtf)$/.test(ext) || file.type.startsWith('text/')) {
    let t = await file.text();
    if (ext === 'rtf') t = t.replace(/\\par[d]?/g, '\n').replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, '');
    return { title, type: ext === 'md' || ext === 'markdown' ? 'Notes' : 'Text', text: t };
  }
  throw new Error('Gizmo can read PDF, Word (.docx), EPUB, HTML, Markdown and text files.');
}

// ---------- analysis ----------
const GENERIC = new Set(('important different large small high low good great best better main major key general common able possible certain particular various several significant include includes including based according within become becomes became following called known help helps result results level levels form forms area areas process term terms way important ' +
  'mean means meant feel feels felt last lasts lasted quick idea ideas answer answers effort information thing find finds found keep keeps kept hold holds think thinks thought look looks looked try tries tried call calls start starts started end ends ended set sets put puts turn turns move moves moved run runs ran seem seems seemed tell tells told ask asks asked lead leads led leave leaves left mind matter matters reason reasons question questions problem problems sense rest whole half little long short real true false right wrong easy hard simple strong weak large lot much more less least most enough next last early late able likely unlikely use uses').split(' '));

export function analyse(text, title = '') {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const sents = sentences(clean).filter(s => s.replace(/^#\s*/, '').length > 2);
  const body = sents.filter(s => !s.startsWith('#') && s.split(' ').length >= 6 && s.length < 420);
  const wordCount = (clean.match(/\S+/g) || []).length;

  // term frequencies (unigrams + bigrams), document frequency over sentences
  const tf = new Map(), df = new Map(), surface = new Map();
  const bump = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
  for (const s of body) {
    const ws = words(s), seen = new Set();
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]; if (w.length < 3 || STOP.has(w)) continue;
      const k = stem(w); bump(tf, k); seen.add(k);
      if (!surface.has(k) || /^[A-Z]/.test(surface.get(k))) surface.set(k, w);
      const n = ws[i + 1];
      if (n && n.length > 2 && !STOP.has(n)) { const b = k + ' ' + stem(n); bump(tf, b, 1.4); seen.add(b); if (!surface.has(b)) surface.set(b, w + ' ' + n); }
    }
    seen.forEach(k => bump(df, k));
  }
  const N = Math.max(1, body.length);
  const headStems = new Set(), heads = clean.split('\n').filter(l => /^#{1,4}\s+/.test(l.trim())).map(l => terms(l.replace(/^#+\s+/, '')));
  heads.forEach(ts => { ts.forEach((w, i) => { headStems.add(w); if (ts[i + 1]) headStems.add(w + ' ' + ts[i + 1]); }); });
  const defStems = new Set();
  for (const s of body) { const m = s.match(/^(?:the |a |an )?([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,2}?)\s+(?:is|are|means|refers to|describes|is defined as)\b/i); if (m) { const ts = terms(m[1]); if (ts.length) defStems.add(ts.join(' ')); } }
  const scored = [...tf.entries()].filter(([k, v]) => {
      const bi = k.includes(' '), parts = k.split(' ');
      if (/^\d/.test(k) || parts.some(p => GENERIC.has(p) || /ly$/.test(p))) return false;
      const boosted = headStems.has(k) || defStems.has(k);
      return boosted ? v >= 1.4 : v >= (bi ? 2.8 : 3);
    })
    .map(([k, v]) => [k, v * Math.log(1 + N / (df.get(k) || 1)) * (k.includes(' ') ? 1.35 : .75) * (headStems.has(k) ? 2.4 : 1) * (defStems.has(k) ? 2.2 : 1)])
    .sort((a, b) => b[1] - a[1]);
  // keep bigrams that beat their parts; drop unigrams swallowed by a chosen bigram
  const key = [];
  for (const [k, s] of scored) {
    if (key.length >= 18) break;
    if (!k.includes(' ') && key.some(x => x.k.includes(' ') && x.k.split(' ').includes(k) && x.s > s * .6)) continue;
    if (k.includes(' ') && key.some(x => x.k === k)) continue;
    key.push({ k, s, label: surface.get(k) || k });
  }
  const weight = new Map(key.map(x => [x.k, x.s]));

  // sentence scores: key-term weight, early position, sensible length
  const max = key.length ? key[0].s : 1;
  const ss = body.map((s, i) => {
    const ts = terms(s); let w = 0;
    for (let j = 0; j < ts.length; j++) { w += (weight.get(ts[j]) || 0); if (ts[j + 1]) w += (weight.get(ts[j] + ' ' + ts[j + 1]) || 0); }
    const len = s.split(' ').length;
    const lenPen = len < 8 ? .6 : len > 45 ? .7 : 1;
    const pos = i < 3 ? 1.25 : i < body.length * .1 ? 1.1 : 1;
    return { s, i, score: (w / max) / Math.pow(Math.max(ts.length, 4), .35) * lenPen * pos };
  });
  const nSum = Math.max(3, Math.min(8, Math.round(Math.sqrt(body.length) * .9)));
  const summary = ss.slice().sort((a, b) => b.score - a.score).slice(0, nSum).sort((a, b) => a.i - b.i).map(x => x.s);

  // outline: markdown headings, or short title-like lines
  const outline = [];
  for (const line of clean.split('\n')) {
    const l = line.trim();
    if (/^#{1,4}\s+/.test(l)) outline.push(l.replace(/^#+\s+/, ''));
    else if (/^(chapter|part|section)\s+[\divxlc]+/i.test(l) && l.length < 90) outline.push(l);
    if (outline.length >= 24) break;
  }

  // definitions for key terms
  const defs = [], usedDef = new Set(), rx = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scoreOf = s => (ss.find(x => x.s === s) || { score: 0 }).score;
  for (const t of key.slice(0, 16)) {
    if (!t.k.includes(' ') && key.some(x => x.k.includes(' ') && x.k.split(' ').includes(t.k))) continue;
    const lab = t.label, re = new RegExp('\\b' + rx(lab) + '\\w*\\b', 'i');
    const cands = body.filter(s => re.test(s) && !usedDef.has(s));
    const strongRe = new RegExp('^(?:the |a |an )?' + rx(lab) + '\\w*\\s+(?:is|are|means|refers to|describes|is defined as)\\b', 'i');
    let def = cands.find(s => strongRe.test(s)), strong = !!def;
    if (!def) def = cands.sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    if (def) { usedDef.add(def); defs.push({ term: lab, def: trim(def, 260), strong }); }
  }
  defs.sort((a, b) => (b.strong ? 1 : 0) - (a.strong ? 1 : 0));

  // chunks for question answering (~150 words, paragraph-aligned)
  const chunks = []; let cur = [];
  for (const s of sents) { if (s.startsWith('#')) continue; cur.push(s); if (cur.join(' ').split(' ').length > 150) { chunks.push(cur.join(' ')); cur = []; } }
  if (cur.length) chunks.push(cur.join(' '));

  return {
    words: wordCount, minutes: Math.max(1, Math.round(wordCount / 230)),
    summary, outline, keyTerms: key.map(x => x.label), defs, chunks: chunks.slice(0, 4000),
    lead: summary[0] ? trim(summary[0], 220) : trim(clean, 220),
  };
}

export function trim(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1) > n * .6 ? s.lastIndexOf(' ', n - 1) : n - 1) + '…'; }
export const titleCase = s => s.replace(/\b([a-z])/g, (m, c) => c.toUpperCase());

// ---------- quizzes + flashcards ----------
function shuffle(a, seed = Math.random) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seed() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function makeCards(src) {
  const A = src.analysis, cards = [], titleW = new Set(terms(src.title || ''));
  A.defs.forEach((d, i) => { if (!d.strong && terms(d.term).every(w => titleW.has(w))) return; cards.push({ id: src.id + ':d' + i, kind: 'term', front: 'What is “' + d.term + '”?', back: d.def, term: d.term, strong: d.strong }); });
  A.summary.forEach((s, i) => {
    const t = A.keyTerms.slice().sort((a, b) => b.split(' ').length - a.split(' ').length).find(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(s));
    if (t) cards.push({ id: src.id + ':s' + i, kind: 'cloze', front: s.replace(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '_____'), back: t, term: t });
  });
  return cards;
}

export function makeQuiz(src, n = 5) {
  const A = src.analysis, qs = [];
  const pool = A.keyTerms.slice(0, 16);
  const cand = shuffle(makeCards(src).filter(c => c.kind === 'cloze' || c.kind === 'term'));
  for (const c of cand) {
    if (qs.length >= n) break;
    if (c.kind === 'cloze') {
      const aw = new Set(terms(c.back));
      const wrong = shuffle(pool.filter(t => t.toLowerCase() !== c.back.toLowerCase() && !terms(t).some(w => aw.has(w)))).slice(0, 3);
      if (wrong.length < 2) continue;
      qs.push({ q: trim(c.front, 300), options: shuffle([c.back, ...wrong]), answer: c.back, why: 'From your source: “' + trim(c.front.replace('_____', c.back), 240) + '”' });
    } else {
      if (!c.strong) continue;
      const right = trim(c.back, 120);
      const others = shuffle([...new Set(A.defs.filter(d => d.term !== c.term).map(d => trim(d.def, 120)))].filter(o => o !== right)).slice(0, 3);
      if (others.length < 2) continue;
      qs.push({ q: 'Which of these best describes “' + c.term + '”?', options: shuffle([right, ...others]), answer: right, why: c.back });
    }
  }
  return qs;
}

// Leitner boxes: box 0..5. Due after 0,1,2,4,8,16 days.
const GAP = [0, 1, 2, 4, 8, 16];
export function grade(stat, ok) {
  const s = stat || { box: 0, due: 0, seen: 0, right: 0 };
  s.seen++; if (ok) s.right++;
  s.box = ok ? Math.min(5, s.box + 1) : Math.max(0, s.box - 2);
  s.due = Date.now() + GAP[s.box] * 864e5;
  return s;
}
export function understanding(src) {
  const cards = makeCards(src); if (!cards.length) return 0;
  const st = src.stats || {};
  const mastery = cards.reduce((m, c) => m + ((st[c.id] && st[c.id].box) || 0), 0) / (cards.length * 5);
  const quiz = src.quizBest != null ? src.quizBest : 0;
  return Math.round((mastery * .7 + quiz * .3) * 100);
}
export function dueCards(src) { const st = src.stats || {}, now = Date.now(); return makeCards(src).filter(c => !st[c.id] || st[c.id].due <= now); }

// ---------- question answering (BM25 over chunks) ----------
export function search(sources, query, k = 4) {
  const q = [...new Set(terms(query))]; if (!q.length) return [];
  const docs = [];
  for (const s of sources) s.analysis.chunks.forEach((c, i) => docs.push({ src: s, i, c, t: terms(c) }));
  if (!docs.length) return [];
  const avg = docs.reduce((m, d) => m + d.t.length, 0) / docs.length, N = docs.length;
  const df = {}; for (const w of q) df[w] = docs.filter(d => d.t.includes(w)).length;
  const k1 = 1.4, b = .75;
  const scored = docs.map(d => {
    let sc = 0; const len = d.t.length;
    for (const w of q) { const f = d.t.filter(x => x === w).length; if (!f) continue; const idf = Math.log(1 + (N - df[w] + .5) / (df[w] + .5)); sc += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len / avg)); }
    return { ...d, score: sc };
  }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
export function answerLocally(sources, query) {
  const hits = search(sources, query, 4);
  if (!hits.length) return null;
  const q = new Set(terms(query));
  const best = [];
  for (const h of hits.slice(0, 3)) for (const s of sentences(h.c)) {
    const ov = terms(s).filter(w => q.has(w)).length;
    if (ov) best.push({ s, ov: ov / Math.pow(s.split(' ').length, .3) + h.score * .05, src: h.src });
  }
  best.sort((a, b) => b.ov - a.ov);
  const picked = []; for (const b of best) { if (picked.length >= 3) break; if (!picked.some(p => p.s === b.s)) picked.push(b); }
  if (!picked.length) return null;
  const from = [...new Set(picked.map(p => p.src.title))];
  return { text: picked.map(p => p.s).join(' '), from, hits };
}
