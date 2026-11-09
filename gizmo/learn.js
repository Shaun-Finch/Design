// Gizmo learning helper: papers + subject in, a learning guide with module quizzes, a final test and a pass mark out.
// Everything runs in the browser. Papers are read with pdf.js / JSZip and analysed by study.js.
import { readFile, analyse, sentences, terms, answerLocally, trim } from './study.js';
import { idbGet, idbSet, idbDel } from './store.js';
import { SAMPLES, SAMPLE_SUBJECT } from './samples.js';

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main'), sayEl = $('#say'), fileIn = $('#fileIn');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wc = s => (String(s).match(/\S+/g) || []).length;
const uid = () => Math.random().toString(36).slice(2, 9);
const KEY = 'learn.guide.v1', DRAFT = 'learn.draft.v1';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

let draft = { subject: '', pass: 80, papers: [] };
let G = null;         // the built guide
let Q = null;         // the running quiz

// ================= Gizmo (avatar, bubble, voice) =================
const bot = $('#bot'), bubble = $('#bubble');
let AV = null, voiceOn = true, gestured = false;
try { voiceOn = localStorage.getItem('learn.voice') !== 'off'; } catch (e) { }
const vsw = $('#voiceSw'); vsw.setAttribute('aria-checked', voiceOn);
vsw.addEventListener('click', () => { voiceOn = !voiceOn; vsw.setAttribute('aria-checked', voiceOn); try { localStorage.setItem('learn.voice', voiceOn ? 'on' : 'off'); } catch (e) { } if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel(); });
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => { gestured = true; }, { once: true, capture: true }));
(async () => {
  try { const m = await import('./avatar3d.js'); AV = m.createAvatar(bot, { onClick: tap, manual: !!window.__GIZMO_MANUAL }); window.__gizmoAV = AV; } catch (e) { AV = null; }
  if (!AV) { const img = document.createElement('img'); img.className = 'still'; img.src = 'gizmo/gizmo-still.png'; img.alt = ''; bot.appendChild(img); bot.addEventListener('click', tap); }
  else if (!window.__GIZMO_MANUAL) setTimeout(() => move('wave'), 500);
})();
bot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
document.addEventListener('pointermove', e => {
  if (!AV || reduce) return; const r = bot.getBoundingClientRect(); if (!r.width) return;
  AV.look((e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), -(e.clientY - (r.top + r.height * .3)) / (innerHeight / 2));
});
const WORDS = { hop: 'Boing!', dance: 'Nailed it!', spin: 'Wheee!', flip: 'Ta-da!', wave: 'Hey there!', shimmy: 'Shake it!', nod: 'Yes!', tilt: 'Hmm…' };
function pop(t) { bubble.textContent = t; bubble.classList.add('on'); clearTimeout(pop.t); pop.t = setTimeout(() => bubble.classList.remove('on'), 1400); }
function move(n, word = true) { if (word && WORDS[n]) pop(WORDS[n]); return AV && !reduce ? AV.move(n) : Promise.resolve(); }
const SEQ = ['hop', 'dance', 'spin', 'flip', 'wave', 'shimmy']; let si = 0;
function tap() { if (AV && AV.isBusy()) return; move(SEQ[si++ % SEQ.length]); }
let voice = null;
function pickVoice() { if (!window.speechSynthesis) return; const vs = speechSynthesis.getVoices(); voice = vs.find(v => /Google UK English Female|Google US English|Samantha|Microsoft (Libby|Sonia|Aria|Jenny)/.test(v.name)) || vs.find(v => /^en[-_]GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null; }
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
let talkT = 0;
function say(html, speakIt = true) {
  sayEl.innerHTML = html;
  if (!speakIt || !voiceOn || !gestured || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(sayEl.textContent.slice(0, 260));
  if (voice) u.voice = voice; u.rate = 1.04; u.pitch = 1.15;
  u.onstart = () => { clearInterval(talkT); if (AV) { AV.setState('speaking'); talkT = setInterval(() => AV.setTalk(.25 + Math.random() * .75), 95); } };
  u.onend = u.onerror = () => { clearInterval(talkT); if (AV) { AV.setTalk(0); AV.setState('idle'); } };
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); }

// ================= building the guide =================
function sections(text) {
  const out = []; let cur = { h: null, lines: [] };
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^#{1,3}\s+(.+)/);
    if (m) { if (wc(cur.lines.join(' '))) out.push(cur); cur = { h: m[1].trim(), lines: [line] }; } else cur.lines.push(line);
  }
  if (wc(cur.lines.join(' '))) out.push(cur);
  return out;
}
// Split one paper into modules: by headings for long papers, by length for long unstructured ones, or keep it whole.
function splitPaper(p) {
  const words = wc(p.text), secs = sections(p.text);
  const swc = s => wc(s.lines.join(' '));
  if (words > 1800 && secs.filter(s => s.h).length >= 3) {
    const target = Math.max(900, words / 6), groups = []; let g = [], gw = 0;
    for (const s of secs) { g.push(s); gw += swc(s); if (gw >= target) { groups.push(g); g = []; gw = 0; } }
    if (g.length) { if (groups.length && gw < target * .4) groups[groups.length - 1].push(...g); else groups.push(g); }
    return groups.map((gr, i) => {
      const hs = gr.map(s => s.h).filter(Boolean);
      return { title: hs.length ? hs.slice(0, 2).join(' · ') + (hs.length > 2 ? ' and more' : '') : p.title + ' · part ' + (i + 1), text: gr.map(s => s.lines.join('\n')).join('\n\n') };
    });
  }
  if (words > 3500) {
    const n = Math.min(6, Math.ceil(words / 2000)), per = words / n, parts = []; let buf = [], bw = 0;
    for (const pa of p.text.split(/\n\s*\n/)) { buf.push(pa); bw += wc(pa); if (bw >= per && parts.length < n - 1) { parts.push(buf.join('\n\n')); buf = []; bw = 0; } }
    if (buf.length) parts.push(buf.join('\n\n'));
    return parts.map((t, i) => ({ title: p.title + ' · part ' + (i + 1), text: t }));
  }
  return [{ title: p.title, text: p.text }];
}
function relevance(mod, subject) {
  if (!subject) return null;
  const st = new Set(terms(subject)); if (!st.size) return null;
  let best = null, bs = 0;
  for (const s of mod.analysis.summary.concat(sentences(mod.text).slice(0, 200))) {
    if (s.startsWith('#') || wc(s) < 7) continue;
    const ov = terms(s).filter(w => st.has(w)).length; if (ov > bs) { bs = ov; best = s; }
  }
  return best ? trim(best, 220) : null;
}
function buildGuide(d) {
  const modules = [];
  for (const p of d.papers) for (const part of splitPaper(p)) {
    const m = { id: uid(), paper: p.title, title: part.title, text: part.text, best: null, attempts: 0 };
    m.analysis = analyse(part.text, part.title);
    m.why = relevance(m, d.subject);
    modules.push(m);
  }
  caseCache.clear();
  return { subject: d.subject.trim() || 'My subject', pass: d.pass, papers: d.papers.map(p => ({ title: p.title, type: p.type, words: p.words })), modules, final: { best: null, attempts: 0 }, created: Date.now() };
}
const passed = m => m.best != null && m.best >= G.pass;
const allPassed = () => G.modules.every(passed);
function progress() { const n = G.modules.length + 1; return Math.round(100 * (G.modules.filter(passed).length + (G.final.best != null && G.final.best >= G.pass ? 1 : 0)) / n); }
function studyPlan() {
  const days = []; let cur = null;
  G.modules.forEach((m, i) => {
    const mins = m.analysis.minutes + 5;
    if (!cur || cur.mins + mins > 35) { cur = { mods: [], mins: 0 }; days.push(cur); }
    cur.mods.push(i + 1); cur.mins += mins;
  });
  days.push({ final: true, mins: 10 });
  return days;
}

// ================= quiz generation =================
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const rx = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Wrong-answer pool: named terms first (they make believable options), then other key terms.
function guidePool() {
  const named = new Set(), rest = new Set();
  G.modules.forEach(m => { m.analysis.defs.filter(d => d.strong).forEach(d => named.add(d.term.toLowerCase())); m.analysis.keyTerms.slice(0, 16).forEach(t => { t = t.toLowerCase(); if (t.includes(' ') || t.length > 5) rest.add(t); }); });
  return { named: [...named], rest: [...rest].filter(t => !named.has(t)) };
}
// "Sleep spindles are short bursts…" -> "Short bursts…": take the term out of a definition so the option doesn't give it away
function bareDef(def, term) {
  let d = def.replace(/…$/, '');
  const re = term ? new RegExp('^(?:the |a |an )?' + rx(term) + '\\w*\\s+(?:is|are|means|refers to|describes|is defined as|is also called)\\s+', 'i') : null;
  if (re && re.test(d)) d = d.replace(re, '');
  else { const m = d.match(/^((?:\S+\s+){0,5}?)(?:is|are|means|refers to)\s+/i); if (m) d = d.slice(m[0].length); else return null; }
  d = d.trim().replace(/^(the|a|an)\s+/i, x => x);
  return d ? d[0].toUpperCase() + d.slice(1) : null;
}
const hasWord = (t, s) => new RegExp('(^|[^\\w-])' + rx(t) + '(?![\\w-])', 'i').test(s);
function pickWrong(answer, avoidText, n = 3) {
  const P = guidePool(), aw = new Set(terms(answer)), len = answer.split(' ').length;
  const ok = t => t !== answer.toLowerCase() && !terms(t).some(w => aw.has(w)) && !hasWord(t, avoidText);
  const named = shuffle(P.named.filter(ok)), rest = shuffle(P.rest.filter(ok));
  const sameLen = a => a.sort((x, y) => Math.abs(x.split(' ').length - len) - Math.abs(y.split(' ').length - len));
  return [...sameLen(named), ...sameLen(rest)].slice(0, n);
}
// Show a term the way the papers write it ("REM sleep", not "rem sleep")
const caseCache = new Map();
function cased(t) {
  if (caseCache.has(t)) return caseCache.get(t);
  let best = t;
  const re = new RegExp('(^|[^\\w-])(' + rx(t) + ')(?![\\w-])', 'gi');
  outer: for (const m of G.modules) {
    let x; re.lastIndex = 0;
    while ((x = re.exec(m.text))) {
      const f = x[2], prefix = m.text.slice(0, x.index + x[1].length);
      const startOfSentence = /(^|[.!?]["”’)]?\s+|\n\s*|#\s+)$/.test(prefix);
      if (!startOfSentence) { best = f; break outer; }
      if (best === t) best = /^[A-Z][a-z]/.test(f) && !/^[A-Z][a-z]*[A-Z]/.test(f.split(' ')[0]) ? f[0].toLowerCase() + f.slice(1) : f;
    }
  }
  caseCache.set(t, best); return best;
}
function questionsFor(m, n) {
  const qs = [], seen = new Set(), add = q => { if (q && !seen.has(q.q) && qs.length < n * 3) { seen.add(q.q); qs.push({ ...q, mod: m.id }); } };
  const allDefs = []; G.modules.forEach(x => x.analysis.defs.filter(d => d.strong).forEach(d => { const b = bareDef(d.def, d.term); if (b) allDefs.push({ term: d.term.toLowerCase(), bare: b }); }));
  // 1. definitions, both ways round
  for (const d of m.analysis.defs.filter(d => d.strong)) {
    const term = d.term.toLowerCase(), bare = bareDef(d.def, d.term); if (!bare || hasWord(term, bare)) continue;
    const others = shuffle(allDefs.filter(o => o.term !== term && !hasWord(term, o.bare) && o.bare !== bare)).slice(0, 3).map(o => o.bare);
    if (others.length === 3) add({ key: term, q: 'Which of these best describes “' + term + '”?', options: shuffle([bare, ...others]), answer: bare, why: d.def });
    const wrong = pickWrong(term, bare); if (wrong.length === 3) add({ key: term, q: 'Which term matches this description? “' + trim(bare, 200) + '”', options: shuffle([term, ...wrong]), answer: term, why: d.def });
  }
  // 2. fill in the blank, from sentences that use a key term as a whole word
  const keys = m.analysis.keyTerms.map(t => t.toLowerCase()).sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
  for (const s of shuffle(sentences(m.text))) {
    if (s.startsWith('#') || wc(s) < 8 || wc(s) > 40) continue;
    const k = keys.find(t => hasWord(t, s)); if (!k) continue;
    const blanked = s.replace(new RegExp('(^|[^\\w-])' + rx(k) + '(?![\\w-])', 'gi'), '$1_____');
    if (!blanked.includes('_____')) continue;
    const wrong = pickWrong(k, s); if (wrong.length < 3) continue;
    add({ key: k, q: trim(blanked, 300), options: shuffle([k, ...wrong]), answer: k, why: 'From ' + m.paper + ': “' + trim(s, 240) + '”' });
  }
  // mix kinds; show terms in the papers' own casing
  const used = new Set(), picked = [];
  for (const q of shuffle(qs)) { if (picked.length >= n) break; if (used.has(q.key)) continue; used.add(q.key); picked.push(q); }
  return picked.map(q => {
    if (q.q.startsWith('Which of these best describes')) return { ...q, q: q.q.replace(/“(.+)”/, (m0, t) => '“' + cased(t) + '”') };
    const opts = q.options.map(cased), ans = cased(q.answer);
    return { ...q, options: opts, answer: ans, q: /^_____/.test(q.q) ? q.q : q.q };
  });
}
function startQuiz(kind, modIndex) {
  let qs;
  if (kind === 'final') { qs = []; const per = Math.max(2, Math.ceil(10 / G.modules.length)); G.modules.forEach(m => qs.push(...questionsFor(m, per))); qs = shuffle(qs).slice(0, 10); }
  else qs = questionsFor(G.modules[modIndex], 5);
  if (qs.length < 2) { toast('Not enough material for a quiz here yet. Add a longer paper.'); return; }
  Q = { kind, modIndex, qs, i: 0, right: 0, missed: [], answered: false };
  renderQuiz();
  say(kind === 'final' ? `<b>Final test.</b> ${qs.length} questions from the whole guide. You need ${G.pass}% to pass.` : `<b>Quiz time.</b> ${qs.length} questions. You need ${G.pass}% to pass this module.`);
}

// ================= persistence =================
async function save() { try { await idbSet(KEY, G); } catch (e) { } }
async function saveDraft() { try { await idbSet(DRAFT, draft); } catch (e) { } }

// ================= views =================
function go(view, arg) { location.hash = view + (arg != null ? '/' + arg : ''); }
addEventListener('hashchange', route);
function route() {
  const [v, a] = location.hash.slice(1).split('/');
  if (v === 'guide' && G) return renderGuide();
  if (v === 'module' && G && G.modules[+a]) return renderModule(+a);
  if (G && v !== 'setup') return renderGuide();
  renderSetup();
}
function top0() { scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }

// ---------- setup ----------
function renderSetup() {
  main.innerHTML = `
    <h1>Create your quiz</h1>
    <div class="step"><b>1</b><h2>What are you studying?</h2></div>
    <label class="field"><span class="sr">Subject or area of study</span><input id="subj" type="text" maxlength="80" placeholder="e.g. Sleep and memory, Cardiac physiology, UX research methods" value="${esc(draft.subject)}"></label>
    <div class="step"><b>2</b><h2>Add your papers</h2></div>
    <label class="drop" id="drop" for="fileIn"><b>Drop papers here or browse</b><br>PDF, Word, EPUB, HTML, Markdown or text</label>
    <div class="row" style="margin-top:10px"><button class="link" type="button" id="pasteBtn">Paste text instead</button><span style="color:var(--mute)">&middot;</span><button class="link" type="button" id="sampleBtn">Try it with sample notes</button></div>
    <form class="card" id="pasteForm" hidden style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
      <label class="field"><span>Title</span><input id="pTitle" type="text" maxlength="100" placeholder="e.g. Lecture 3 notes"></label>
      <label class="field"><span>Text</span><textarea id="pText" rows="7" placeholder="Paste an article, a chapter or your notes"></textarea></label>
      <div class="row"><button class="btn blue" type="submit">Add paper</button></div>
    </form>
    <div class="papers" id="papers"></div>
    <p class="msg" id="msg" aria-live="polite"></p>
    <div class="step"><b>3</b><h2>Set your pass mark</h2></div>
    <label class="field" style="max-width:240px"><span class="sr">Pass mark</span><select id="pass">${[60, 70, 80, 90].map(v => `<option value="${v}"${v === draft.pass ? ' selected' : ''}>${v}% to pass</option>`).join('')}</select></label>
    <div class="row" style="margin-top:1.6rem"><button class="btn blue big" type="button" id="build">Build my learning guide</button>${G ? '<button class="btn" type="button" id="backGuide">Back to my guide</button>' : ''}</div>
    <p class="note">Gizmo builds the guide from your papers only, with simple, visible rules. Check anything important against the original.</p>`;
  const subj = $('#subj'), msg = $('#msg');
  subj.addEventListener('input', () => { draft.subject = subj.value; saveDraft(); });
  $('#pass').addEventListener('change', e => { draft.pass = +e.target.value; saveDraft(); });
  $('#pasteBtn').addEventListener('click', () => { const f = $('#pasteForm'); f.hidden = !f.hidden; if (!f.hidden) $('#pTitle').focus(); });
  $('#pasteForm').addEventListener('submit', e => {
    e.preventDefault(); const t = $('#pText').value.trim();
    if (wc(t) < 60) { msg.className = 'msg err'; msg.textContent = 'Paste at least a few paragraphs so there is enough to learn from.'; return; }
    addPaper({ title: $('#pTitle').value.trim() || 'Pasted notes', type: 'Text', text: t }); $('#pText').value = ''; $('#pTitle').value = ''; $('#pasteForm').hidden = true;
  });
  $('#sampleBtn').addEventListener('click', () => {
    draft.subject = SAMPLE_SUBJECT; subj.value = SAMPLE_SUBJECT;
    draft.papers = draft.papers.filter(p => p.type !== 'Sample notes');
    SAMPLES.forEach(s => addPaper({ ...s }, true));
    renderPapers(); saveDraft();
    msg.className = 'msg'; msg.textContent = 'Added three sample notes on sleep and memory, written for this demo.';
    say('<b>Sample notes added.</b> Press “Build my learning guide” and I&rsquo;ll get to work.');
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => readFiles(e.dataTransfer.files));
  $('#build').addEventListener('click', build);
  if ($('#backGuide')) $('#backGuide').addEventListener('click', () => go('guide'));
  renderPapers();
}
function renderPapers() {
  const el = $('#papers'); if (!el) return;
  el.innerHTML = draft.papers.map((p, i) => `<div class="paper"><span class="ic" aria-hidden="true">${esc((p.type || 'TXT').slice(0, 4).toUpperCase())}</span><span class="t"><b>${esc(p.title)}</b><small>${p.words.toLocaleString()} words &middot; about ${Math.max(1, Math.round(p.words / 230))} min read${p.type === 'Sample notes' ? ' &middot; sample notes written for this demo' : ''}</small></span><button type="button" data-rm="${i}" aria-label="Remove ${esc(p.title)}">&times;</button></div>`).join('');
  el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { draft.papers.splice(+b.dataset.rm, 1); renderPapers(); saveDraft(); }));
  const btn = $('#build'); if (btn) btn.disabled = !draft.papers.length;
}
function addPaper(p, quiet) {
  p.words = wc(p.text);
  if (draft.papers.some(x => x.title === p.title && x.words === p.words)) return;
  draft.papers.push(p);
  if (!quiet) { renderPapers(); saveDraft(); }
}
fileIn.addEventListener('change', () => { readFiles(fileIn.files); fileIn.value = ''; });
async function readFiles(list) {
  const msg = $('#msg'); if (!list || !list.length) return;
  for (const f of list) {
    msg.className = 'msg'; msg.textContent = 'Reading ' + f.name + '…';
    try {
      const r = await readFile(f, p => { msg.textContent = 'Reading ' + f.name + '… ' + Math.round(p * 100) + '%'; });
      if (wc(r.text) < 60) throw new Error('I couldn’t find enough text in ' + f.name + '. If it’s a scanned PDF, try a version with selectable text.');
      addPaper({ title: r.title, type: r.type, text: r.text });
      msg.textContent = 'Added ' + r.title + '.';
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message || 'Couldn’t read ' + f.name + '.'; }
  }
  if (draft.papers.length) say(`<b>${draft.papers.length} paper${draft.papers.length > 1 ? 's' : ''} ready.</b> Add more, or build your guide.`, false);
}
async function build() {
  if (!draft.papers.length) return;
  draft.subject = $('#subj').value.trim();
  const btn = $('#build'); btn.disabled = true; btn.textContent = 'Building…';
  if (AV) AV.setState('thinking');
  say('<b>Reading your papers…</b> pulling out key points and terms, then writing your quizzes.', false);
  await new Promise(r => setTimeout(r, 60));
  G = buildGuide(draft);
  if (AV) AV.setState('idle');
  await save();
  move('dance');
  say(`<b>Your guide is ready.</b> ${G.modules.length} module${G.modules.length > 1 ? 's' : ''} for ${esc(G.subject)}. Start with module 1, pass each quiz, then take the final test.`);
  go('guide');
}

// ---------- guide ----------
function statusChip(m) {
  if (m.best == null) return '<span class="chip">Not started</span>';
  return passed(m) ? `<span class="chip ok">Passed &middot; ${m.best}%</span>` : `<span class="chip bad">Best ${m.best}% &middot; need ${G.pass}%</span>`;
}
function renderGuide() {
  const p = progress(), plan = studyPlan(), fin = G.final, unlocked = allPassed();
  const words = G.papers.reduce((s, x) => s + x.words, 0);
  main.innerHTML = `
    <div class="ghead">
      <div class="t"><p class="eyebrow">Your learning guide</p><h1>${esc(G.subject)}</h1>
        <div class="stats"><span class="chip">${G.papers.length} paper${G.papers.length > 1 ? 's' : ''}</span><span class="chip">${G.modules.length} module${G.modules.length > 1 ? 's' : ''}</span><span class="chip">About ${Math.max(1, Math.round(words / 230))} min reading</span><span class="chip">Pass mark ${G.pass}%</span></div></div>
      <div class="ring" style="--p:${p}" role="img" aria-label="${p}% complete"><span><span>${p}%<small>DONE</small></span></span></div>
    </div>
    <h2 style="font-size:1.05rem">Study plan</h2>
    <div class="plan">${plan.map((d, i) => `<div><b>Day ${i + 1}</b>${d.final ? 'Final test' : 'Module' + (d.mods.length > 1 ? 's ' : ' ') + d.mods.join(', ')} &middot; ${d.mins} min</div>`).join('')}</div>
    <h2 style="font-size:1.05rem">Modules</h2>
    <div class="mods">
      ${G.modules.map((m, i) => `<button type="button" class="mod${passed(m) ? ' done' : ''}" data-mod="${i}"><span class="n">${passed(m) ? '&#10003;' : i + 1}</span><span class="t"><b>${esc(m.title)}</b><small>${esc(m.paper)} &middot; ${m.analysis.minutes} min read &middot; ${m.analysis.keyTerms.length ? m.analysis.keyTerms.slice(0, 3).map(esc).join(', ') : 'key points'}</small>${m.why ? `<p class="why"><b>For ${esc(G.subject)}:</b> ${esc(m.why)}</p>` : ''}</span>${statusChip(m)}</button>`).join('')}
      <button type="button" class="mod final" id="finalBtn" aria-disabled="${!unlocked}"><span class="n">&#9733;</span><span class="t"><b>Final test</b><small>${unlocked ? '10 questions from every module. Pass it to finish the guide.' : 'Unlocks when you pass every module quiz.'}</small></span>${fin.best == null ? (unlocked ? '<span class="chip">Ready</span>' : '<span class="chip lock">Locked</span>') : fin.best >= G.pass ? `<span class="chip ok">Passed &middot; ${fin.best}%</span>` : `<span class="chip bad">Best ${fin.best}%</span>`}</button>
    </div>
    <div class="row" style="margin-top:1.4rem"><button class="btn" type="button" id="newGuide">Start a new guide</button><button class="btn" type="button" id="printGuide">Print the guide</button></div>`;
  main.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => go('module', b.dataset.mod)));
  $('#finalBtn').addEventListener('click', () => { if (!allPassed()) { toast('Pass every module quiz to unlock the final test.'); move('tilt'); return; } startQuiz('final'); });
  $('#newGuide').addEventListener('click', async () => { if (!confirm('Start a new guide? Your current guide and scores will be cleared.')) return; G = null; await idbDel(KEY); go('setup'); });
  $('#printGuide').addEventListener('click', printGuide);
  top0();
}
function printGuide() {
  const w = open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(G.subject)} — learning guide</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 16px;line-height:1.55;color:#16161a}h1{margin-bottom:.2rem}h2{margin-top:2rem;border-top:1px solid #ddd;padding-top:1rem}li{margin:.3rem 0}.m{color:#666;font-size:.9rem}</style><h1>${esc(G.subject)}</h1><p class="m">Learning guide made by Gizmo from ${G.papers.length} paper(s). Pass mark ${G.pass}%.</p>` +
    G.modules.map((m, i) => `<h2>Module ${i + 1}: ${esc(m.title)}</h2><p class="m">${esc(m.paper)} · ${m.analysis.minutes} min read</p><h3>Key points</h3><ul>${m.analysis.summary.map(s => '<li>' + esc(s) + '</li>').join('')}</ul>${m.analysis.defs.length ? '<h3>Key terms</h3><ul>' + m.analysis.defs.map(d => '<li><b>' + esc(d.term) + '</b>: ' + esc(d.def) + '</li>').join('') + '</ul>' : ''}`).join(''));
  w.document.close(); w.focus(); w.print();
}

// ---------- module ----------
function renderModule(i) {
  const m = G.modules[i], A = m.analysis;
  main.innerHTML = `
    <div class="crumb"><button class="link" type="button" id="back">&larr; All modules</button></div>
    <p class="eyebrow">Module ${i + 1} of ${G.modules.length} &middot; ${A.minutes} min read</p>
    <h1>${esc(m.title)}</h1>
    <div class="stats" style="margin-bottom:1.2rem"><span class="chip">From ${esc(m.paper)}</span>${statusChip(m)}</div>
    ${m.why ? `<div class="card" style="background:var(--side);margin-bottom:1.4rem"><h3>Why it matters for ${esc(G.subject)}</h3><p style="margin:0;color:var(--body)">${esc(m.why)}</p></div>` : ''}
    <h2>Key points</h2>
    <ol class="points">${A.summary.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    ${A.defs.length ? `<h2>Key terms</h2><div class="terms">${A.defs.slice(0, 10).map(d => `<div class="term"><b>${esc(d.term)}</b><p>${esc(d.def)}</p></div>`).join('')}</div>` : ''}
    <h2>Ask Gizmo about this module</h2>
    <form class="ask" id="askF"><label class="sr" for="askIn">Your question</label><input id="askIn" type="text" placeholder="e.g. What happens during ${esc((A.keyTerms[0] || 'this stage'))}?" autocomplete="off"><button class="btn blue" type="submit">Ask</button></form>
    <div id="ans"></div>
    <div class="sticky-cta"><button class="btn blue big" type="button" id="quizBtn">${m.best == null ? 'Take the quiz' : 'Retake the quiz'} &rarr;</button></div>`;
  $('#back').addEventListener('click', () => go('guide'));
  $('#quizBtn').addEventListener('click', () => startQuiz('module', i));
  $('#askF').addEventListener('submit', e => {
    e.preventDefault(); const q = $('#askIn').value.trim(); if (!q) return;
    let r = answerLocally([{ title: m.title, analysis: m.analysis }], q);
    if (!r) r = answerLocally(G.modules.map(x => ({ title: x.title, analysis: x.analysis })), q);
    $('#ans').innerHTML = r ? `<div class="answer">${esc(r.text)}<small>From: ${r.from.map(esc).join(', ')}</small></div>` : `<div class="answer">I couldn&rsquo;t find that in your papers. Try different words.</div>`;
    if (r) say('<b>Here&rsquo;s what your papers say.</b>', false);
  });
  say(`<b>Module ${i + 1}.</b> Read the key points and terms, then take the quiz. ${A.minutes} minute read.`, false);
  top0();
}

// ---------- quiz ----------
function renderQuiz() {
  const q = Q.qs[Q.i], title = Q.kind === 'final' ? 'Final test' : 'Module ' + (Q.modIndex + 1) + ' quiz';
  main.innerHTML = `
    <div class="crumb"><button class="link" type="button" id="quit">&larr; Leave the quiz</button></div>
    <p class="eyebrow">${title} &middot; Question ${Q.i + 1} of ${Q.qs.length}</p>
    <div class="qbar" role="progressbar" aria-valuemin="0" aria-valuemax="${Q.qs.length}" aria-valuenow="${Q.i}" aria-label="Quiz progress"><i style="width:${100 * Q.i / Q.qs.length}%"></i></div>
    <p class="q">${esc(q.q)}</p>
    <div class="opts" role="group" aria-label="Answers">${q.options.map((o, k) => `<button class="opt" type="button" data-k="${k}">${esc(o)}</button>`).join('')}</div>
    <div id="fb" aria-live="polite"></div>`;
  $('#quit').onclick = () => { if (confirm('Leave the quiz? This attempt won’t be scored.')) { const k = Q.kind, mi = Q.modIndex; Q = null; k === 'final' ? go('guide') : (location.hash === '#module/' + mi ? renderModule(mi) : go('module', mi)); } };
  main.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => answer(+b.dataset.k)));
  main.querySelector('.opt').focus({ preventScroll: true });
  top0();
}
function answer(k) {
  if (Q.answered) return; Q.answered = true;
  const q = Q.qs[Q.i], ok = q.options[k] === q.answer;
  main.querySelectorAll('.opt').forEach((b, j) => { b.disabled = true; if (q.options[j] === q.answer) b.classList.add('right'); else if (j === k) b.classList.add('wrong'); });
  if (ok) { Q.right++; move('nod', false); } else { Q.missed.push(q); move('tilt', false); }
  const last = Q.i === Q.qs.length - 1;
  $('#fb').innerHTML = `<div class="fb ${ok ? 'ok' : 'no'}"><b>${ok ? 'Correct.' : 'Not quite. The answer is “' + esc(q.answer) + '”.'}</b> ${esc(q.why || '')}</div><div class="row" style="margin-top:12px"><button class="btn blue" type="button" id="next">${last ? 'See my score' : 'Next question'} &rarr;</button></div>`;
  $('#next').addEventListener('click', () => { if (last) finish(); else { Q.i++; Q.answered = false; renderQuiz(); } });
  $('#next').focus({ preventScroll: true });
}
async function finish() {
  const score = Math.round(100 * Q.right / Q.qs.length), ok = score >= G.pass;
  const target = Q.kind === 'final' ? G.final : G.modules[Q.modIndex];
  target.attempts++; target.best = Math.max(target.best == null ? 0 : target.best, score);
  await save();
  const nextMod = G.modules.findIndex(m => !passed(m));
  const done = Q.kind === 'final' && ok;
  main.innerHTML = `
    <div class="card result ${ok ? 'pass' : 'fail'}">
      <p class="eyebrow">${Q.kind === 'final' ? 'Final test' : 'Module ' + (Q.modIndex + 1) + ' quiz'}</p>
      <div class="big">${score}%</div>
      <p style="font-size:1.1rem;font-weight:700;margin:.6rem 0 .2rem">${done ? 'You passed the final test. Guide complete!' : ok ? 'Passed!' : 'Not passed yet'}</p>
      <p style="color:var(--body);margin:0">${Q.right} of ${Q.qs.length} correct &middot; pass mark ${G.pass}%${target.attempts > 1 ? ' &middot; best ' + target.best + '%' : ''}</p>
      <div class="row" style="justify-content:center;margin-top:1.2rem">
        ${ok ? '' : `<button class="btn blue" type="button" id="retry">Try again with new questions</button>`}
        ${!ok && Q.kind === 'module' ? `<button class="btn" type="button" id="review">Review the module</button>` : ''}
        ${ok && Q.kind === 'module' && nextMod >= 0 ? `<button class="btn blue" type="button" id="nextMod">Next: module ${nextMod + 1} &rarr;</button>` : ''}
        ${ok && Q.kind === 'module' && nextMod < 0 ? `<button class="btn blue" type="button" id="toFinal">Take the final test &rarr;</button>` : ''}
        <button class="btn" type="button" id="toGuide">Back to my guide</button>
      </div>
      ${Q.missed.length ? `<div class="missed"><h3>Worth another look</h3><ul>${Q.missed.map(q => `<li><b>${esc(q.answer)}</b> &mdash; ${esc(q.why || q.q)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  const kind = Q.kind, mi = Q.modIndex; Q = null;
  const on = (id, fn) => { const b = $('#' + id); if (b) b.addEventListener('click', fn); };
  on('retry', () => startQuiz(kind, mi)); on('review', () => go('module', mi)); on('nextMod', () => go('module', nextMod)); on('toFinal', () => startQuiz('final')); on('toGuide', () => go('guide'));
  if (ok) { move(done ? 'flip' : 'dance'); say(done ? `<b>Brilliant, you passed!</b> ${score}% on the final test. That&rsquo;s the whole guide done.` : `<b>Nice one, ${score}%!</b> That&rsquo;s a pass.`); }
  else { move('tilt'); say(`<b>${score}% this time.</b> You need ${G.pass}%. Have another look at the points you missed, then try again.`); }
  top0();
}

if (window.__GIZMO_TEST) window.__learnAnswer = () => Q && Q.qs[Q.i] && Q.qs[Q.i].answer;

// ================= start =================
(async () => {
  try { const d = await idbGet(DRAFT); if (d && Array.isArray(d.papers)) draft = { subject: d.subject || '', pass: d.pass || 80, papers: d.papers }; } catch (e) { }
  try { const g = await idbGet(KEY); if (g && Array.isArray(g.modules)) G = g; } catch (e) { }
  if (G) say(`<b>Welcome back.</b> Your guide for ${esc(G.subject)} is ${progress()}% done.`, false);
  route();
})();
