// Gizmo app: chat + voice, 3D avatar, Study, Tasks & approvals, Routines, Decks, Projects and Tools.
import { loadState, saveState, idbGet, idbSet } from './store.js';
import { readFile, analyse, makeCards, makeQuiz, grade, understanding, dueCards, answerLocally, search, trim } from './study.js';
import * as C from './connectors.js';
import * as A from './agent.js';
import { deckFromSources, slideHTML, exportPptx, figmaJSON } from './deck.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const app = $('#app'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }

// ================= STATE =================
const SEED = {
  proj: [
    { id: 1, name: 'Gizmo AI helper', pct: 45, note: 'Connect the first live accounts' },
    { id: 2, name: 'Manchester Audio Tours', pct: 15, note: 'Record the first walking tour' },
    { id: 3, name: 'Hibana interactive book', pct: 70, note: 'Refine the remaining spreads' },
    { id: 4, name: 'Automotive UI/UX', pct: 90, note: 'Polish the AI dashboard' },
  ],
  chats: [], voice: true, autopilot: true, runs: [], approvals: [], decks: [],
  routines: [
    { id: 'r1', name: 'Morning briefing', skill: 'briefing', schedule: { freq: 'weekdays', time: '08:45', days: [] }, enabled: true },
    { id: 'r2', name: 'Inbox triage', skill: 'triage', schedule: { freq: 'weekdays', time: '09:00', days: [] }, enabled: true },
    { id: 'r3', name: 'Slack catch-up', skill: 'slack', schedule: { freq: 'weekdays', time: '16:30', days: [] }, enabled: true },
    { id: 'r4', name: 'Weekly update deck', skill: 'weekly', schedule: { freq: 'weekly', time: '15:00', days: [5] }, enabled: true },
  ],
  policy: {}, connect: { provider: 'demo', google: {}, microsoft: {}, slack: {}, figma: {}, claude: {}, hooks: [] }, profile: { name: '' }, contacts: [],
};
const S = loadState(SEED);
S.connect = S.connect || {}; for (const k of ['google', 'microsoft', 'slack', 'figma', 'claude']) S.connect[k] = S.connect[k] || {}; S.connect.hooks = S.connect.hooks || []; S.connect.provider = S.connect.provider || 'demo'; S.profile = S.profile || { name: '' };
// bring over projects and chats from the first version of Gizmo
try { const v1 = JSON.parse(localStorage.getItem('gizmo.v1') || 'null'); if (v1 && !S.migrated) { if (v1.proj && v1.proj.length) S.proj = v1.proj; if (v1.chats) S.chats = v1.chats; S._v1learn = v1.learn || []; S.migrated = true; } else S.migrated = true; } catch (e) { S.migrated = true; }
S.routines.forEach(r => { if (!r.created) r.created = Date.now(); });
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { if (!saveState(S)) toast('Browser storage is full or blocked. Changes last until you close the tab.'); }, 120); }

let SOURCES = [];
async function saveSources() { await idbSet('sources', SOURCES); }
const sources = () => SOURCES;

// ================= CONNECT THE ENGINE =================
C.bindState(S, save);
A.bindHost({
  state: S, save, sources,
  log: () => { renderCounts(); if (!$('[data-view="tasks"]').hidden) renderTasks(); if (!$('[data-view="routines"]').hidden) renderRoutines(); },
  notify,
  saveDeck: d => { d.id = d.id || 'd' + Date.now().toString(36); S.decks.unshift(d); S.decks = S.decks.slice(0, 30); save(); renderCounts(); if (!$('[data-view="decks"]').hidden) renderDecks(); },
  updateProject: (name, pct, next) => { let p = findProj(name); if (!p) p = addProj(name, next || ''); if (pct != null) p.pct = Math.max(0, Math.min(100, +pct)); if (next) p.note = next; save(); renderProj(); return p.name + ' is at ' + p.pct + '%.'; },
  remember: (title, text) => addSource({ title: title || text.split(/\s+/).slice(0, 6).join(' '), type: 'Note', text, subject: 'Notes' }, true),
});
function notify(title, body) {
  renderCounts();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') { try { new Notification(title, { body, tag: 'gizmo' }); } catch (e) { } }
}

// ================= VIEWS =================
const TITLES = { talk: 'Talk to Gizmo', tasks: 'Tasks', routines: 'Routines', study: 'Study', decks: 'Decks', proj: 'Projects underway', tools: 'Tools' };
function go(v) {
  $$('.view').forEach(s => s.hidden = s.getAttribute('data-view') !== v);
  $$('.nav button').forEach(b => b.getAttribute('data-go') === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('#title').textContent = TITLES[v]; app.classList.remove('open');
  ({ tasks: renderTasks, routines: renderRoutines, study: () => { closeSource(); renderStudy(); }, decks: () => { closeDeck(); renderDecks(); }, proj: renderProj, tools: renderTools })[v]?.();
}
$$('.nav button').forEach(b => b.addEventListener('click', () => go(b.getAttribute('data-go'))));
$('#menu').addEventListener('click', () => app.classList.toggle('open'));
document.addEventListener('click', e => { if (app.classList.contains('open') && !e.target.closest('.side') && !e.target.closest('#menu')) app.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { app.classList.remove('open'); closePresent(); } });

function renderCounts() {
  const pend = S.approvals.filter(a => a.status === 'pending').length;
  const b = $('#nAsk'); b.hidden = !pend; b.textContent = pend;
  $('#nRoutine').textContent = S.routines.filter(r => r.enabled).length || '';
  $('#nStudy').textContent = SOURCES.length || '';
  $('#nDecks').textContent = S.decks.length || '';
  $('#nProj').textContent = S.proj.filter(p => p.pct < 100).length || '';
  const live = [C.mode('mail') !== 'demo' && (C.mode('mail') === 'google' ? 'Google' : 'Microsoft 365'), C.mode('slack') === 'live' && 'Slack', C.mode('figma') === 'live' && 'Figma', C.mode('ai') === 'live' && 'Claude'].filter(Boolean);
  $('#nTools').textContent = live.length || '';
  const tag = $('#liveTag'); tag.classList.toggle('on', live.length > 0); tag.querySelector('span').textContent = live.length ? 'Live: ' + live.join(' · ') : 'Demo mode';
}

// ================= AVATAR =================
const botWrap = $('#botWrap'), bubble = $('#bubble');
let AV = null;
(async () => {
  try {
    const m = await import('./avatar3d.js');
    AV = m.createAvatar(botWrap, { onClick: tap, manual: !!window.__GIZMO_MANUAL });
    window.__gizmoAV = AV;
  } catch (e) { AV = null; }
  if (!AV) { const img = document.createElement('img'); img.className = 'still'; img.src = 'gizmo/gizmo-still.png'; img.alt = ''; botWrap.appendChild(img); botWrap.addEventListener('click', tap); }
  else if (!window.__GIZMO_MANUAL) setTimeout(() => move('wave'), 500);
})();
botWrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
document.addEventListener('pointermove', e => {
  lastAct = Date.now(); if (!AV || reduce) return;
  const r = botWrap.getBoundingClientRect(); if (!r.width) return;
  AV.look((e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), -(e.clientY - (r.top + r.height * .3)) / (innerHeight / 2));
});
function setS(s) { app.setAttribute('data-s', s); $('#stateL').textContent = { idle: 'Ready', listening: 'Listening…', thinking: 'Working…', speaking: 'Speaking' }[s]; if (AV) AV.setState(s); }

// little robot beeps, made in the browser
let AC = null; function ac() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { AC = null; } return AC; }
function tone(f1, f2, t0, d, type, vol) { const c = ac(); if (!c) return; const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0; o.type = type || 'square'; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + d); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol || .03, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + .03); }
const SFX = { talk: [[880, 1320, 0, .06], [1320, 990, .07, .07]], hop: [[300, 900, 0, .18, 'sine', .08]], dance: [[660, 660, 0, .08], [880, 880, .13, .08], [990, 990, .26, .08], [1320, 1320, .39, .14]], spin: [[400, 1600, 0, .5, 'sine', .06]], flip: [[300, 1400, 0, .38, 'sine', .07], [1400, 600, .9, .2, 'sine', .05]], wave: [[990, 1480, 0, .06], [1480, 1180, .08, .06], [1180, 1760, .16, .09]], skip: [[700, 950, 0, .06], [700, 950, .45, .06], [700, 950, .9, .06], [700, 950, 1.35, .06]], shimmy: [[500, 540, 0, .05], [620, 660, .09, .05], [500, 540, .18, .05], [620, 660, .27, .05]], moonwalk: [[523, 523, 0, .12, 'triangle', .05], [659, 659, .16, .12, 'triangle', .05], [784, 784, .32, .12, 'triangle', .05], [659, 659, .48, .2, 'triangle', .05]], done: [[880, 1175, 0, .08, 'sine', .05], [1175, 1568, .1, .12, 'sine', .05]] };
let gestured = false; ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => { gestured = true; }, { once: true, capture: true }));
function chirp(k) { if (S.voice === false || !gestured) return; (SFX[k] || SFX.talk).forEach(n => tone(n[0], n[1], n[2], n[3], n[4], n[5])); }
const WORDS = { hop: 'Boing!', skip: 'Skippity skip!', dance: 'Let’s boogie!', spin: 'Wheee!', flip: 'Ta-da!', wave: 'Hey there!', shimmy: 'Shake it!', moonwalk: 'Smooth moves!' };
function pop(t) { bubble.textContent = t; bubble.classList.add('on'); clearTimeout(pop.t); pop.t = setTimeout(() => bubble.classList.remove('on'), 1400); }
let lastAct = Date.now();
function move(n) { lastAct = Date.now(); if (WORDS[n]) { chirp(n); pop(WORDS[n]); } return AV ? AV.move(n) : Promise.resolve(); }
const SEQ = ['hop', 'dance', 'spin', 'flip', 'wave', 'skip', 'shimmy', 'moonwalk']; let si = 0;
function tap() { if (AV && AV.isBusy()) return; move(SEQ[si++ % SEQ.length]); }
setInterval(() => {
  if (!AV || reduce || window.__GIZMO_MANUAL || document.hidden || app.getAttribute('data-s') !== 'idle' || AV.isBusy() || Date.now() - lastAct < 10000) return;
  lastAct = Date.now(); AV.move(['glance', 'tilt', 'nod', 'glance', 'hop'][Math.floor(Math.random() * 5)]);
}, 1000);

// ================= VOICE OUT =================
const synth = window.speechSynthesis; let voice = null;
function pick() { if (!synth) return; const vs = synth.getVoices(); if (!vs.length) return; const pref = ['Google US English', 'Samantha', 'Microsoft Ana Online', 'Microsoft Aria Online', 'Microsoft Jenny Online', 'Microsoft Guy Online', 'Microsoft Zira', 'Alex', 'Aaron', 'Microsoft David'];
  for (const p of pref) { const v = vs.find(x => x.name.includes(p) && /en[-_]US/i.test(x.lang)); if (v) { voice = v; return; } } voice = vs.find(x => /en[-_]US/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang)) || null; }
if (synth) { pick(); synth.onvoiceschanged = pick; }
let talkT = 0;
function talkOn() { clearInterval(talkT); talkT = setInterval(() => AV && AV.setTalk(.25 + Math.random() * .75), reduce ? 250 : 95); }
function talkOff() { clearInterval(talkT); AV && AV.setTalk(0); }
function speak(t) {
  const spoken = trim(t.replace(/\n+/g, ' '), 320);
  let done = false; const fin = () => { if (done) return; done = true; talkOff(); setS('idle'); };
  const sim = () => { setS('speaking'); talkOn(); setTimeout(fin, Math.min(6000, Math.max(1200, spoken.split(' ').length * 260))); };
  if (S.voice !== false && synth && window.SpeechSynthesisUtterance) {
    try { synth.cancel(); const u = new SpeechSynthesisUtterance(spoken.replace(/’/g, "'")); if (voice) u.voice = voice; u.lang = voice ? voice.lang : 'en-US'; u.rate = 1.08; u.pitch = 1.5; chirp('talk');
      let st = false; u.onstart = () => { st = true; setS('speaking'); talkOn(); }; u.onend = fin; u.onerror = () => { if (!st) sim(); else fin(); }; synth.speak(u); setTimeout(() => { if (!st && !done) sim(); }, 1200); return; } catch (e) { }
  }
  sim();
}
const voiceSw = $('#voiceSw'); voiceSw.setAttribute('aria-checked', S.voice !== false);
voiceSw.addEventListener('click', () => { S.voice = voiceSw.getAttribute('aria-checked') !== 'true'; voiceSw.setAttribute('aria-checked', S.voice); save(); if (!S.voice && synth) synth.cancel(); });
const autoSw = $('#autoSw'); autoSw.setAttribute('aria-checked', !!S.autopilot);
autoSw.addEventListener('click', () => { S.autopilot = autoSw.getAttribute('aria-checked') !== 'true'; autoSw.setAttribute('aria-checked', S.autopilot); save(); toast(S.autopilot ? 'Autopilot on: routines will run on schedule' : 'Autopilot off: routines are paused'); askNotify(); });
function askNotify() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { }); }

// ================= CHAT =================
let chat = [];
function addMsg(who, t, actions) {
  const h = $('#hello'); if (h) h.remove(); app.classList.add('chatting');
  const d = document.createElement('div'); d.className = 'm ' + who;
  d.innerHTML = (who === 'g' ? '<b class="who">Gizmo</b>' : '') + esc(t);
  if (actions && actions.length) { const a = document.createElement('div'); a.className = 'act'; actions.forEach(x => { const b = document.createElement('button'); b.type = 'button'; b.textContent = x.label; b.onclick = () => x.fn(b, a); a.appendChild(b); }); d.appendChild(a); }
  $('#log').appendChild(d); $('#log').scrollTop = 1e6;
  chat.push({ w: who, t });
  if (who === 'u' && chat.filter(c => c.w === 'u').length === 1) { S.chats.unshift({ id: Date.now(), title: t.slice(0, 48), msgs: chat }); S.chats = S.chats.slice(0, 15); }
  if (S.chats[0] && S.chats[0].msgs === chat) save();
  renderRecent(); return d;
}
function say(t, actions) { addMsg('g', t, actions); speak(t); }
function renderRecent() { $('#recent').innerHTML = S.chats.length ? S.chats.map(c => '<button type="button" data-chat="' + c.id + '">' + esc(c.title) + '</button>').join('') : '<span class="none">Your chats will appear here</span>'; }
$('#recent').addEventListener('click', e => { const b = e.target.closest('[data-chat]'); if (!b) return; const c = S.chats.find(x => x.id === +b.dataset.chat); if (!c) return; go('talk');
  $('#log').innerHTML = ''; chat = c.msgs; S.chats = [c].concat(S.chats.filter(x => x !== c)); app.classList.add('chatting');
  c.msgs.forEach(m => { const d = document.createElement('div'); d.className = 'm ' + m.w; d.innerHTML = (m.w === 'g' ? '<b class="who">Gizmo</b>' : '') + esc(m.t); $('#log').appendChild(d); }); $('#log').scrollTop = 1e6; renderRecent(); });
$('#newChat').addEventListener('click', () => { chat = []; app.classList.remove('chatting'); $('#log').innerHTML = '<div class="hello" id="hello"><b>New chat</b>What would you like me to do?</div>'; go('talk'); if (synth) synth.cancel(); setS('idle'); $('#input').focus(); });

// ---------- timer ----------
let tEnd = 0, tInt = 0;
function startTimer(sec) { clearInterval(tInt); tEnd = Date.now() + sec * 1000; $('#timer').hidden = false; tick(); tInt = setInterval(tick, 250); }
function tick() { const s = Math.max(0, Math.round((tEnd - Date.now()) / 1000)); $('#timerL').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); if (s <= 0) { clearInterval(tInt); $('#timer').hidden = true; move('hop'); say('Ding! Your timer is done.'); } }
$('#timerX').addEventListener('click', () => { clearInterval(tInt); $('#timer').hidden = true; toast('Timer cancelled'); });

// ---------- quick brain (no AI needed) ----------
const NUM = { zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, half: .5 };
const num = w => w == null ? null : (isNaN(+w) ? (NUM[w] != null ? NUM[w] : null) : +w);
function maths(s) { const e = s.replace(/what('s| is)|calculate|equals|\?/g, '').replace(/plus/g, '+').replace(/minus/g, '-').replace(/(times|multiplied by|x)/g, '*').replace(/divided by|over/g, '/').trim();
  if (!/^[\d\s.+\-*/()]+$/.test(e) || !/\d\s*[+\-*/]\s*\d/.test(e)) return null; try { const v = Function('"use strict";return (' + e + ')')(); return isFinite(v) ? Math.round(v * 1000) / 1000 : null; } catch (x) { return null; } }
function listProj() { const open = S.proj.filter(p => p.pct < 100); if (!open.length) return 'Nothing is underway right now.'; return 'You have ' + open.length + ' project' + (open.length > 1 ? 's' : '') + ' underway. ' + open.map(p => p.name + ' is at ' + p.pct + ' percent').join(', ') + '.'; }
function quick(raw) {
  const s = raw.toLowerCase().replace(/[!?,]/g, ' ').replace(/\s+/g, ' ').trim(); let m;
  if ((m = s.match(/(?:set|start)?\s*(?:a\s)?timer for (\d+|\w+)\s*(second|sec|minute|min|hour)s?/))) { const n = num(m[1]); if (n == null) return 'How long should the timer be?'; startTimer(n * (/hour/.test(m[2]) ? 3600 : /min/.test(m[2]) ? 60 : 1)); return 'Timer set for ' + m[1] + ' ' + m[2].replace(/^sec$/, 'second').replace(/^min$/, 'minute') + (n === 1 ? '' : 's') + '.'; }
  if (/(cancel|stop) (the )?timer/.test(s)) { clearInterval(tInt); $('#timer').hidden = true; return 'Timer cancelled.'; }
  if (/what('s| is) the time|what time is it|^time$/.test(s)) return 'It’s ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '.';
  if (/what('s| is) the date|what day is it|today's date/.test(s)) return 'It’s ' + new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.';
  if (/^(?:please )?(?:remember|note|learn)(?: that)? (.+)/.test(s)) { const text = raw.replace(/^\s*(please\s+)?(remember|note|learn)(\s+that)?\s+/i, ''); addSource({ title: trim(text, 48), type: 'Note', text, subject: 'Notes' }, true); return 'Got it. I’ll remember that ' + text.replace(/^my /i, 'your ').replace(/\.$/, '') + '.'; }
  if ((m = s.match(/(?:add|start|create|new) (?:a )?(?:new )?project(?: called| named)? (.+)/))) { const p = addProj(raw.replace(/^.*?project(\s+called|\s+named)?\s+/i, '')); renderProj(); return 'Added ' + p.name + ' to your projects.'; }
  if ((m = s.match(/(?:set|update|move|put) (.+?) (?:to|at) (\d+)\s*(?:%|percent|per cent)/))) { const pj = findProj(m[1]); if (!pj) return 'I couldn’t find a project called ' + m[1] + '.'; pj.pct = Math.min(100, +m[2]); save(); renderProj(); return pj.name + ' is now at ' + pj.pct + ' percent.'; }
  if ((m = s.match(/(?:mark|set) (.+?) (?:as )?(?:done|complete|completed|finished)$/))) { const pd = findProj(m[1]); if (!pd) return 'I couldn’t find a project called ' + m[1] + '.'; pd.pct = 100; save(); renderProj(); return 'Nice work. ' + pd.name + ' is done.'; }
  if (/project/.test(s) && /(what|which|list|show|underway|progress|how many|status)/.test(s)) { if (/show|open/.test(s)) go('proj'); return listProj(); }
  const mv = maths(s); if (mv != null) return 'That’s ' + mv + '.';
  const dm = /\b(dance|boogie|groove)\b/.test(s) ? 'dance' : /\b(flip|somersault|backflip)\b/.test(s) ? 'flip' : /\bspin\b/.test(s) ? 'spin' : /\bskip\b/.test(s) ? 'skip' : /\b(jump|hop)\b/.test(s) ? 'hop' : /\bmoonwalk\b/.test(s) ? 'moonwalk' : /\b(shimmy|wiggle)\b/.test(s) ? 'shimmy' : /^wave\b|\bwave (at|to|hello)/.test(s) ? 'wave' : null;
  if (dm) { setTimeout(() => move(dm), 200); return { dance: 'Let’s boogie!', flip: 'Watch this!', spin: 'Wheee!', skip: 'Skippity skip!', hop: 'Boing boing!', moonwalk: 'Smooth moves, coming up.', shimmy: 'Shake it!', wave: 'Hey there!' }[dm]; }
  if (/^(hi|hello|hey|hiya|howdy|good (morning|afternoon|evening))\b/.test(s)) { setTimeout(() => move('wave'), 200); return 'Hey there! What can I do for you?'; }
  if (/what can you do|^help$|what do you do/.test(s)) return 'I can study your books, articles and essays and quiz you on them. I can also work for you: triage your inbox, book meetings, catch up on Slack and Teams, and build decks for Figma. Anything other people will see waits for your OK. Try “plan my day”.';
  if (/how are you/.test(s)) return 'All systems happy, thanks. How are you?';
  if (/^(thanks|thank you|cheers)/.test(s)) return 'Any time.';
  if (/\bjoke\b/.test(s)) return ['Why did the robot go on vacation? It needed to recharge.', 'I told my computer a joke about memory. It forgot to laugh.', 'What’s a robot’s favorite music? Heavy metal.'][Math.floor(Math.random() * 3)];
  if (/(what('s| is) your name|who are you)/.test(s)) return 'I’m Gizmo, your personal AI helper.';
  if (/who (made|built|designed|created) you/.test(s)) return 'Shaun Finch designed and built me.';
  if (/(bye|goodbye|see you)/.test(s)) return 'See you soon.';
  return null;
}

// ---------- study in chat ----------
function bestSource(q) { if (!SOURCES.length) return null; if (!q) return SOURCES.slice().sort((a, b) => dueCards(b).length - dueCards(a).length)[0]; const h = search(SOURCES, q, 3); return h.length ? h[0].src : SOURCES.find(s => s.title.toLowerCase().includes(q.toLowerCase())) || null; }
function quizInChat(src) {
  const qs = makeQuiz(src, 5); if (!qs.length) return say('There isn’t enough in “' + src.title + '” for a quiz yet. Add a longer piece.');
  let i = 0, score = 0;
  const ask = () => {
    const q = qs[i];
    const d = addMsg('g', 'Question ' + (i + 1) + ' of ' + qs.length + ': ' + q.q, q.options.map(o => ({ label: trim(o, 90), fn: (b, wrap) => {
      if (wrap.dataset.done) return; wrap.dataset.done = 1; const ok = o === q.answer; if (ok) score++;
      b.classList.add(ok ? 'right' : 'wrong'); if (!ok) [...wrap.children].find(x => x.textContent === trim(q.answer, 90))?.classList.add('right');
      chirp(ok ? 'done' : 'talk'); if (ok) move('hop');
      setTimeout(() => { i++; if (i < qs.length) ask(); else { const pct = score / qs.length; src.quizBest = Math.max(src.quizBest || 0, pct); saveSources(); renderStudyCountsOnly(); say('You got ' + score + ' out of ' + qs.length + '. Your understanding of “' + src.title + '” is now ' + understanding(src) + ' percent.' + (pct === 1 ? ' Perfect!' : '')); if (pct >= .8) setTimeout(() => move('dance'), 600); } }, 900);
    } })));
    speak(q.q.replace('_____', 'blank'));
    return d;
  };
  say('Quiz time on “' + src.title + '”. Five questions.'); setTimeout(ask, 900);
}
async function studyReply(raw) {
  const s = raw.toLowerCase().trim(); let m;
  if ((m = s.match(/^(?:quiz|test) me(?: on (.+))?|^(?:study|revise)(?: (.+))?$/))) {
    const src = bestSource((m[1] || m[2] || '').replace(/[?.!]/g, '')); if (!src) return { text: 'Your study library is empty. Add a book, article or essay with the paperclip, or in Study.' };
    quizInChat(src); return { handled: true };
  }
  if ((m = s.match(/^(?:summari[sz]e|sum up|give me a summary of|tldr)\s*(.*)$/))) {
    const src = bestSource(m[1].replace(/[?.!]/g, '')); if (!src) return { text: 'I couldn’t find that in your library.' };
    return { text: '“' + src.title + '” in brief: ' + src.analysis.summary.slice(0, 4).join(' '), actions: [{ label: 'Open in Study', fn: () => { go('study'); openSource(src.id); } }] };
  }
  if (!SOURCES.length) return null;
  const isQ = /\?$|^(what|who|why|how|when|where|which|explain|define|describe|does|is|are|can)\b/.test(s) || /\b(according to|in my notes|in the book|what does .+ say)\b/.test(s);
  if (!isQ) return null;
  if (C.mode('ai') === 'live') {
    const hits = search(SOURCES, raw, 6); if (!hits.length) return null;
    try {
      const j = await C.claude({ system: 'Answer using only the passages from the user’s study library. Be concise (under 120 words). Name the source title you used. If the passages don’t answer it, say so.', messages: [{ role: 'user', content: hits.map(h => '[' + h.src.title + '] ' + trim(h.c, 1200)).join('\n\n') + '\n\nQuestion: ' + raw }], max_tokens: 500 });
      return { text: C.textOf(j) };
    } catch (e) { /* fall back to local */ }
  }
  const a = answerLocally(SOURCES, raw);
  if (!a) return null;
  return { text: 'From “' + a.from[0] + '”: ' + a.text };
}

// ---------- routing ----------
let busyChat = false;
async function handle(t) {
  t = (t || '').trim(); if (!t || busyChat) return; busyChat = true;
  if (synth) synth.cancel(); addMsg('u', t); setS('thinking');
  try {
    await wait(reduce ? 0 : 300);
    const q = quick(t); if (q) return say(q);
    const st = await studyReply(t); if (st) { if (st.handled) return setS('idle'); return say(st.text, st.actions); }
    const it = A.intent(t);
    if (it && !(C.mode('ai') === 'live' && /\b(and|then)\b/.test(t))) {
      const r = await A.runSkill(it.skill, it.args || {}, 'chat');
      return say(r.text, followUps(r.run));
    }
    if (C.mode('ai') === 'live') {
      const hist = [];
      chat.slice(-9, -1).forEach(c => { const role = c.w === 'u' ? 'user' : 'assistant'; if (!hist.length && role === 'assistant') return; if (hist.length && hist[hist.length - 1].role === role) hist[hist.length - 1].content += '\n' + c.t; else hist.push({ role, content: c.t }); });
      if (hist.length && hist[hist.length - 1].role === 'user') hist.pop();
      const r = await A.runAgent(t, 'chat', {}, hist);
      return say(r.text, followUps(r.run));
    }
    const a = answerLocally(SOURCES, t);
    if (a) return say('Here’s what I found in “' + a.from[0] + '”: ' + a.text);
    say('I can do that kind of open-ended request once you connect the AI brain (a Claude key in Tools). Right now I can study your material, run my skills, and handle email, meetings, Slack, Teams and decks.', [{ label: 'Open Tools', fn: () => go('tools') }, { label: 'See skills', fn: () => go('tasks') }]);
  } catch (e) { say('Something went wrong: ' + e.message); }
  finally { busyChat = false; if (app.getAttribute('data-s') === 'thinking') setS('idle'); }
}
function followUps(run) {
  const acts = []; if (!run) return acts;
  const pend = S.approvals.filter(a => a.runId === run.id && a.status === 'pending').length;
  if (pend) acts.push({ label: 'Review ' + pend + ' for your OK', fn: () => go('tasks') });
  if (/deck/i.test(run.title + run.result) && S.decks[0]) acts.push({ label: 'Open the deck', fn: () => { go('decks'); openDeck(S.decks[0].id); } });
  return acts;
}
window.gizmo = handle; window.gizmoMove = move;
$('#composer').addEventListener('submit', e => { e.preventDefault(); const v = $('#input').value; $('#input').value = ''; handle(v); });
$('#chips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) handle(b.textContent); });
$('#attach').addEventListener('click', () => $('#chatFile').click());
$('#chatFile').addEventListener('change', async e => { const files = [...e.target.files]; e.target.value = ''; if (!files.length) return; addMsg('u', 'Added ' + files.map(f => f.name).join(', ')); setS('thinking'); const added = await importFiles(files); setS('idle'); if (added.length) say('I’ve read ' + added.map(s => '“' + s.title + '”').join(', ') + '. ' + added[0].analysis.lead, [{ label: 'Quiz me', fn: () => quizInChat(added[0]) }, { label: 'Make a deck', fn: () => runDeck(added[0].title, [added[0]]) }, { label: 'Open in Study', fn: () => { go('study'); openSource(added[0].id); } }]); });

// ================= TASKS =================
function renderTasks() {
  const pend = S.approvals.filter(a => a.status === 'pending');
  $('#askHead').innerHTML = 'Needs your OK' + (pend.length ? ' <span class="pill go">' + pend.length + '</span>' + (pend.length > 1 ? ' <button class="btn small ghost" type="button" id="okAll" style="margin-left:auto">Approve all</button>' : '') : '');
  $('#askList').innerHTML = pend.length ? pend.map(a => {
    const t = A.TOOLS.find(x => x.name === a.tool), pv = t && t.preview ? t.preview(a.args) : null;
    return '<div class="card ask" data-ap="' + a.id + '"><h4>' + esc(a.title) + '</h4><p class="why">' + esc(a.why || '') + (a.result ? ' <span class="pill bad">' + esc(a.result) + '</span>' : '') + '</p>' +
      (pv != null ? '<textarea data-edit="' + (a.tool === 'send_email' ? 'body' : a.tool === 'run_automation' ? 'details' : a.tool === 'figma_comment' ? 'message' : 'text') + '" aria-label="Edit before sending">' + esc(pv) + '</textarea>' : '') +
      '<div class="row" style="margin-top:8px"><button class="btn blue small" data-ok>Approve &amp; run</button><button class="btn ghost small" data-no>Decline</button><span class="meta" style="margin:0 0 0 auto">' + ago(a.created) + '</span></div></div>';
  }).join('') : '<p class="empty">Nothing waiting. Gizmo asks here before it sends, posts or invites anyone.</p>';
  $('#skillList').innerHTML = Object.entries(A.SKILLS).map(([k, s]) => '<div class="card skill"><h4>' + esc(s.label) + '</h4><p>' + esc(s.desc) + '</p><div><button class="btn small ghost" data-skill="' + k + '">Run now</button></div></div>').join('');
  $('#runList').innerHTML = S.runs.length ? S.runs.slice(0, 25).map(r => {
    const st = { running: ['go', 'Working'], done: ['done', 'Done'], 'needs-ok': ['warn', 'Needs your OK'], failed: ['bad', 'Failed'] }[r.status] || ['', r.status];
    return '<details class="card run"><summary><b>' + esc(r.title) + '</b><span class="pill">' + esc({ chat: 'Chat', routine: 'Routine', task: 'Task' }[r.origin] || r.origin) + '</span><span class="pill ' + st[0] + '">' + st[1] + '</span><span class="meta" style="margin:0 0 0 auto">' + ago(r.started) + '</span></summary>' +
      (r.result ? '<p class="res">' + esc(r.result) + '</p>' : '') + (r.steps.length ? '<div class="steps">' + r.steps.map(s => '<div class="' + s.kind + '">' + esc(s.text) + '</div>').join('') + '</div>' : '') + '</details>';
  }).join('') : '<p class="empty">No activity yet. Run a skill or ask Gizmo to do something.</p>';
}
$('#askList').addEventListener('click', async e => {
  const card = e.target.closest('[data-ap]'); if (!card) return; const id = card.dataset.ap;
  if (e.target.closest('[data-ok]')) {
    const ta = card.querySelector('textarea'); const edit = ta ? { [ta.dataset.edit]: ta.value } : null;
    e.target.disabled = true; e.target.textContent = 'Running…';
    try { const r = await A.approve(id, edit); toast(r || 'Done'); chirp('done'); }
    catch (err) { toast(err.message); if (err.needsUser) go('tools'); }
    renderTasks();
  }
  if (e.target.closest('[data-no]')) { A.reject(id); renderTasks(); }
});
$('#askHead').addEventListener('click', async e => { if (!e.target.closest('#okAll')) return; e.target.disabled = true; for (const a of S.approvals.filter(x => x.status === 'pending')) { try { await A.approve(a.id); } catch (err) { toast(err.message); break; } } chirp('done'); renderTasks(); });
$('#skillList').addEventListener('click', async e => { const b = e.target.closest('[data-skill]'); if (!b) return; const k = b.dataset.skill;
  let args = {};
  if (k === 'deck') { const t = prompt('What should the deck be about?', SOURCES[0] ? SOURCES[0].title : ''); if (t == null) return; args = { topic: t }; }
  if (k === 'meeting') { const t = prompt('Who and when? e.g. “Priya tomorrow at 3pm about onboarding”', ''); if (!t) return; args = { text: t }; }
  b.disabled = true; b.textContent = 'Working…'; const r = await A.runSkill(k, args, 'task'); toast(trim(r.text, 140)); renderTasks(); });
$('#taskForm').addEventListener('submit', async e => {
  e.preventDefault(); const t = $('#taskIn').value.trim(); if (!t) return; $('#taskMsg').textContent = 'Working on it…';
  const it = A.intent(t); let r;
  if (C.mode('ai') === 'live') r = await A.runAgent(t, 'task');
  else if (it) r = await A.runSkill(it.skill, it.args || {}, 'task');
  else { $('#taskMsg').textContent = 'I need the AI brain for that one. Add a Claude key in Tools, or pick a skill below.'; return; }
  $('#taskIn').value = ''; $('#taskMsg').textContent = trim(r.text, 200); renderTasks();
});

// ================= ROUTINES =================
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function renderRoutines() {
  $('#routineList').innerHTML = S.routines.length ? S.routines.map(r => {
    const sk = A.SKILLS[r.skill];
    return '<div class="card" data-rt="' + r.id + '"><div class="row"><h4 style="margin:0;font-size:1rem">' + esc(r.name) + '</h4><span class="pill">' + esc(sk ? sk.label : 'Custom') + '</span>' + (r.autoCritical ? '<span class="pill warn">Sends without asking</span>' : '') +
      '<button class="sw" role="switch" aria-checked="' + !!r.enabled + '" aria-label="Turn ' + esc(r.name) + ' on or off" data-rt-on style="margin-left:auto"><i></i></button></div>' +
      '<div class="meta">' + esc(A.describeSchedule(r)) + ' · ' + (r.enabled && S.autopilot ? 'next ' + (r.nextRun ? new Date(r.nextRun).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon') : 'paused') + (r.lastRun ? ' · last ran ' + ago(r.lastRun) : '') + '</div>' +
      (r.instruction ? '<p style="margin:6px 0 0;color:var(--body);font-size:.9rem">' + esc(r.instruction) + '</p>' : '') +
      (r.lastResult ? '<p style="margin:6px 0 0;color:var(--mute);font-size:.86rem">Last result: ' + esc(trim(r.lastResult, 200)) + '</p>' : '') +
      '<div class="row" style="margin-top:8px"><button class="btn small ghost" data-rt-run>Run now</button><button class="x" data-rt-del>Delete</button></div></div>';
  }).join('') : '<p class="empty">No routines yet.</p>';
  if (!S.autopilot) $('#routineList').insertAdjacentHTML('afterbegin', '<p class="card soft" style="margin:0">Autopilot is off, so routines are paused. Turn it on at the bottom of the sidebar.</p>');
}
$('#routineList').addEventListener('click', async e => {
  const c = e.target.closest('[data-rt]'); if (!c) return; const r = S.routines.find(x => x.id === c.dataset.rt);
  if (e.target.closest('[data-rt-on]')) { r.enabled = !r.enabled; r.nextRun = r.enabled ? A.nextRun(r) : null; save(); renderRoutines(); renderCounts(); }
  if (e.target.closest('[data-rt-del]')) { S.routines = S.routines.filter(x => x !== r); save(); renderRoutines(); renderCounts(); }
  if (e.target.closest('[data-rt-run]')) { e.target.disabled = true; e.target.textContent = 'Running…'; const res = await A.runRoutine(r, 'manual'); toast(trim(res.text, 140)); renderRoutines(); }
});
$('#rSkill').innerHTML = Object.entries(A.SKILLS).map(([k, s]) => '<option value="' + k + '">' + esc(s.label) + '</option>').join('') + '<option value="custom">Custom instructions…</option>';
$('#rDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(i => '<label><input type="checkbox" value="' + i + '"' + (i === 5 ? ' checked' : '') + '>' + DAYN[i] + '</label>').join('');
$('#rSkill').addEventListener('change', () => { $('#rInstrWrap').hidden = $('#rSkill').value !== 'custom'; });
$('#rFreq').addEventListener('change', () => { $('#rDaysWrap').hidden = $('#rFreq').value !== 'weekly'; });
$('#routineForm').addEventListener('submit', e => {
  e.preventDefault(); const skill = $('#rSkill').value, instr = $('#rInstr').value.trim();
  if (skill === 'custom' && !instr) { $('#rMsg').textContent = 'Write the instructions first.'; return; }
  const days = [...$$('#rDays input:checked')].map(x => +x.value);
  if ($('#rFreq').value === 'weekly' && !days.length) { $('#rMsg').textContent = 'Pick at least one day.'; return; }
  const r = { id: 'r' + Date.now().toString(36), name: $('#rName').value.trim() || (skill === 'custom' ? trim(instr, 40) : A.SKILLS[skill].label), skill, instruction: skill === 'custom' ? instr : '', schedule: { freq: $('#rFreq').value, time: $('#rTime').value || '09:00', days }, enabled: true, autoCritical: $('#rAuto').checked, created: Date.now() };
  r.nextRun = A.nextRun(r); S.routines.push(r); save(); $('#rName').value = ''; $('#rInstr').value = ''; $('#rAuto').checked = false; $('#rMsg').textContent = 'Added. Next run: ' + new Date(r.nextRun).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) + '.';
  renderRoutines(); renderCounts(); askNotify();
});

// ================= STUDY =================
async function addSource(o, quiet) {
  const analysis = analyse(o.text, o.title);
  const src = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: trim(o.title || 'Untitled', 120), type: o.type || 'Text', subject: (o.subject || 'General').trim() || 'General', text: o.text, analysis, stats: {}, quizBest: null, added: Date.now() };
  SOURCES.unshift(src); await saveSources(); renderCounts(); if (!quiet && !$('[data-view="study"]').hidden) renderStudy();
  return src;
}
async function importFiles(files) {
  const out = [], subject = $('#subjIn').value.trim() || 'General';
  for (const f of files) {
    if (f.size > 60 * 1024 * 1024) { toast(f.name + ' is over 60 MB'); continue; }
    try {
      $('#studyMsg').textContent = 'Reading ' + f.name + '…'; toast('Reading ' + f.name + '…');
      const r = await C_read(f);
      if (!r.text || r.text.trim().split(/\s+/).length < 30) { toast('Couldn’t find enough text in ' + f.name + (r.type === 'PDF' ? ' (scanned PDFs need OCR first)' : '')); continue; }
      out.push(await addSource({ ...r, subject }, true));
    } catch (e) { toast(f.name + ': ' + e.message); }
  }
  $('#studyMsg').textContent = out.length ? 'Added ' + out.map(s => '“' + s.title + '”').join(', ') + '.' : '';
  renderStudy(); return out;
}
const C_read = f => readFile(f, p => { $('#studyMsg').textContent = 'Reading ' + f.name + '… ' + Math.round(p * 100) + '%'; });
$('#fileIn').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; importFiles(f); });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => importFiles([...e.dataTransfer.files]));
$('#pasteBtn').addEventListener('click', () => { $('#pasteForm').hidden = !$('#pasteForm').hidden; if (!$('#pasteForm').hidden) $('#pTitle').focus(); });
$('#pasteForm').addEventListener('submit', async e => { e.preventDefault(); const text = $('#pText').value.trim(); if (text.split(/\s+/).length < 30) { $('#studyMsg').textContent = 'Paste at least a paragraph or two.'; return; } const src = await addSource({ title: $('#pTitle').value.trim() || trim(text, 50), type: 'Text', text, subject: $('#subjIn').value.trim() || 'General' }); $('#pTitle').value = ''; $('#pText').value = ''; $('#pasteForm').hidden = true; openSource(src.id); });
function renderStudyCountsOnly() { renderCounts(); }
function renderStudy() {
  const subj = {}; SOURCES.forEach(s => { (subj[s.subject] = subj[s.subject] || []).push(s); });
  $('#subjList').innerHTML = Object.keys(subj).length ? Object.entries(subj).map(([k, list]) => { const w = list.reduce((m, s) => m + s.analysis.words, 0) || 1; const u = Math.round(list.reduce((m, s) => m + understanding(s) * s.analysis.words, 0) / w); return '<span class="subj"><span class="ring" style="--p:' + u + '"><span>' + u + '</span></span>' + esc(k) + ' · ' + list.length + '</span>'; }).join('') : '<p class="empty" style="padding:0">Add something to start tracking.</p>';
  const due = SOURCES.reduce((m, s) => m + dueCards(s).length, 0);
  $('#dueMsg').textContent = SOURCES.length ? (due ? due + ' card' + (due > 1 ? 's' : '') + ' due' : 'Nothing due right now') : '';
  $('#reviewAll').disabled = !due;
  $('#srcList').innerHTML = SOURCES.length ? SOURCES.map(s => { const u = understanding(s); return '<div class="card src" data-src="' + s.id + '" tabindex="0" role="button"><div class="ico">' + esc(s.type.toUpperCase().slice(0, 5)) + '</div><div><h4>' + esc(s.title) + '</h4><p>' + esc(s.subject) + ' · ' + s.analysis.words.toLocaleString() + ' words · ' + s.analysis.minutes + ' min read</p></div><div style="min-width:120px"><div class="meta" style="margin:0 0 4px;justify-content:flex-end">' + u + '% understood</div><div class="bar"><i style="width:' + u + '%"></i></div></div></div>'; }).join('') : '<p class="empty">Your library is empty.</p>';
  renderCounts();
}
$('#srcList').addEventListener('click', e => { const c = e.target.closest('[data-src]'); if (c) openSource(c.dataset.src); });
$('#srcList').addEventListener('keydown', e => { const c = e.target.closest('[data-src]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSource(c.dataset.src); } });
let openSrc = null, srcTab = 'summary';
function closeSource() { openSrc = null; $('#studyHome').hidden = false; $('#studyDetail').hidden = true; }
function openSource(id, tab) {
  const s = SOURCES.find(x => x.id === id); if (!s) return; openSrc = s; srcTab = tab || 'summary';
  $('#studyHome').hidden = true; const D = $('#studyDetail'); D.hidden = false;
  const u = understanding(s);
  D.innerHTML = '<button class="btn small ghost" data-back>&larr; Library</button><div class="row" style="margin-top:12px;align-items:flex-start"><div class="grow"><h2 style="margin:0">' + esc(s.title) + '</h2><p class="sub" style="margin:4px 0 0">' + esc(s.type) + ' · ' + s.analysis.words.toLocaleString() + ' words · ' + s.analysis.minutes + ' min read · <label>Subject <input type="text" data-subj value="' + esc(s.subject) + '" style="width:150px;padding:3px 8px;display:inline-block"></label></p></div>' +
    '<span class="subj" style="border:0"><span class="ring" style="--p:' + u + ';width:46px;height:46px"><span style="font-size:.8rem">' + u + '%</span></span>understood</span></div>' +
    '<div class="row" style="margin-top:10px"><button class="btn small blue" data-deck>Make a deck from this</button><button class="btn small ghost" data-talkquiz>Quiz me out loud</button><button class="x" data-del>Remove</button></div>' +
    '<div class="tabs" role="tablist">' + [['summary', 'Summary'], ['terms', 'Key terms'], ['ask', 'Ask'], ['quiz', 'Quiz'], ['cards', 'Flashcards'], ['read', 'Read']].map(([k, l]) => '<button role="tab" data-tab="' + k + '" aria-selected="' + (k === srcTab) + '">' + l + '</button>').join('') + '</div><div id="tabBody"></div>';
  renderTab();
}
function renderTab() {
  const s = openSrc, A2 = s.analysis, B = $('#tabBody');
  $$('#studyDetail [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === srcTab));
  if (srcTab === 'summary') B.innerHTML = '<h3 class="sec" style="margin-top:4px">Key points</h3><ol class="points">' + A2.summary.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' + (A2.outline.length ? '<h3 class="sec">Outline</h3><ol class="points">' + A2.outline.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '');
  if (srcTab === 'terms') B.innerHTML = '<div class="terms">' + A2.keyTerms.map(t => '<span>' + esc(t) + '</span>').join('') + '</div><div class="defs">' + A2.defs.map(d => '<div><b>' + esc(d.term) + '</b>' + esc(d.def) + '</div>').join('') + '</div>';
  if (srcTab === 'ask') { B.innerHTML = '<form class="row" id="askForm"><input type="text" class="grow" id="askIn" placeholder="Ask a question about this source" style="flex:1"><button class="btn blue">Ask</button></form><div id="askOut" style="margin-top:12px"></div>'; $('#askIn').focus(); }
  if (srcTab === 'quiz') renderQuiz(B, s);
  if (srcTab === 'cards') renderCards(B, dueCards(s).length ? dueCards(s) : makeCards(s), s);
  if (srcTab === 'read') B.innerHTML = '<div class="card reader">' + esc(s.text.slice(0, 200000)) + (s.text.length > 200000 ? '\n\n… (showing the first 200,000 characters)' : '') + '</div>';
}
$('#studyDetail').addEventListener('click', async e => {
  const s = openSrc; if (!s) return;
  if (e.target.closest('[data-back]')) { closeSource(); renderStudy(); }
  const t = e.target.closest('[data-tab]'); if (t) { srcTab = t.dataset.tab; renderTab(); }
  if (e.target.closest('[data-del]')) { if (!confirm('Remove “' + s.title + '” from your library?')) return; SOURCES = SOURCES.filter(x => x !== s); await saveSources(); closeSource(); renderStudy(); }
  if (e.target.closest('[data-deck]')) runDeck(s.title, [s]);
  if (e.target.closest('[data-talkquiz]')) { go('talk'); quizInChat(s); }
});
$('#studyDetail').addEventListener('change', async e => { if (e.target.matches('[data-subj]') && openSrc) { openSrc.subject = e.target.value.trim() || 'General'; await saveSources(); } });
$('#studyDetail').addEventListener('submit', async e => {
  if (e.target.id !== 'askForm') return; e.preventDefault(); const q = $('#askIn').value.trim(); if (!q) return; const out = $('#askOut'); out.innerHTML = '<p class="empty">Looking…</p>';
  let txt = null;
  if (C.mode('ai') === 'live') { const hits = search([openSrc], q, 6); try { const j = await C.claude({ system: 'Answer from the passages only, in under 120 words. If they don’t cover it, say so.', messages: [{ role: 'user', content: hits.map(h => trim(h.c, 1200)).join('\n\n') + '\n\nQuestion: ' + q }], max_tokens: 500 }); txt = C.textOf(j); } catch (err) { txt = null; } }
  if (!txt) { const a = answerLocally([openSrc], q); txt = a ? a.text : 'I couldn’t find that in this source.'; }
  out.innerHTML = '<div class="card"><b style="display:block;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--acc)">Gizmo</b>' + esc(txt) + '</div>';
});
function renderQuiz(B, s) {
  const qs = makeQuiz(s, 5); if (!qs.length) { B.innerHTML = '<p class="empty">Not enough material for a quiz yet.</p>'; return; }
  let answered = 0, score = 0;
  B.innerHTML = qs.map((q, i) => '<div class="q card" data-q="' + i + '"><p>' + (i + 1) + '. ' + esc(q.q) + '</p><div class="opts">' + q.options.map(o => '<button type="button">' + esc(o) + '</button>').join('') + '</div><div class="why" hidden>' + esc(q.why) + '</div></div>').join('') + '<p id="qScore" class="sub"></p><button class="btn ghost small" id="qAgain">New quiz</button>';
  B.onclick = async e => {
    if (e.target.id === 'qAgain') return renderQuiz(B, s);
    const btn = e.target.closest('.opts button'); if (!btn) return; const card = btn.closest('[data-q]'); if (card.dataset.done) return; card.dataset.done = 1;
    const q = qs[+card.dataset.q], ok = btn.textContent === q.answer; if (ok) score++; answered++;
    btn.classList.add(ok ? 'right' : 'wrong'); if (!ok) [...card.querySelectorAll('.opts button')].find(b => b.textContent === q.answer)?.classList.add('right');
    card.querySelector('.why').hidden = false;
    if (answered === qs.length) { s.quizBest = Math.max(s.quizBest || 0, score / qs.length); await saveSources(); $('#qScore').textContent = 'Score: ' + score + ' / ' + qs.length + '. Understanding is now ' + understanding(s) + '%.'; chirp('done'); }
  };
}
function renderCards(B, cards, s) {
  if (!cards.length) { B.innerHTML = '<p class="empty">No flashcards yet.</p>'; return; }
  let i = 0, flipped = false;
  const draw = () => {
    if (i >= cards.length) { B.innerHTML = '<div class="card flash"><div><span class="k">All done</span>Nice work. Cards come back when they’re due.</div></div>'; renderCounts(); return; }
    const c = cards[i];
    B.innerHTML = '<p class="sub">Card ' + (i + 1) + ' of ' + cards.length + (c._src ? ' · ' + esc(c._src.title) : '') + '</p><div class="card flash" id="flash" role="button" tabindex="0"><div><span class="k">' + (flipped ? 'Answer' : 'Question · tap to flip') + '</span>' + esc(flipped ? c.back : c.front) + '</div></div>' +
      '<div class="row" style="margin-top:10px;justify-content:center"' + (flipped ? '' : ' hidden') + '><button class="btn ghost" data-g="0">Again</button><button class="btn blue" data-g="1">Got it</button></div>';
  };
  draw();
  B.onclick = async e => {
    if (e.target.closest('#flash')) { flipped = !flipped; draw(); return; }
    const g = e.target.closest('[data-g]'); if (!g) return; const c = cards[i], src = c._src || s;
    src.stats[c.id] = grade(src.stats[c.id], g.dataset.g === '1'); await saveSources(); i++; flipped = false; draw();
  };
}
$('#reviewAll').addEventListener('click', () => {
  const cards = SOURCES.flatMap(s => dueCards(s).map(c => ({ ...c, _src: s }))).slice(0, 40); if (!cards.length) return;
  $('#studyHome').hidden = true; const D = $('#studyDetail'); D.hidden = false; openSrc = null;
  D.innerHTML = '<button class="btn small ghost" id="revBack">&larr; Library</button><h2>Review</h2><div id="revBody"></div>';
  $('#revBack').onclick = () => { closeSource(); renderStudy(); };
  renderCards($('#revBody'), cards, null);
});

// ================= DECKS =================
async function runDeck(topic, srcs) {
  toast('Building the deck…');
  let r;
  if (srcs && C.mode('ai') !== 'live') { const d = deckFromSources(topic, srcs); d.id = 'd' + Date.now().toString(36); S.decks.unshift(d); save(); renderCounts(); r = { text: 'Deck ready' }; }
  else r = await A.runSkill('deck', { topic }, 'task');
  go('decks'); if (S.decks[0]) openDeck(S.decks[0].id);
  return r;
}
function renderDecks() {
  $('#deckList').innerHTML = S.decks.length ? S.decks.map(d => '<div class="card deckcard" data-deck="' + d.id + '" tabindex="0" role="button">' + slideHTML(d.slides[0], 0, d.slides.length) + '<h4>' + esc(d.title) + '</h4><p>' + d.slides.length + ' slides · ' + ago(d.created) + '</p></div>').join('') : '<p class="empty">No decks yet. Try “Build a deck about memory in Figma”.</p>';
  renderCounts();
}
$('#deckList').addEventListener('click', e => { const c = e.target.closest('[data-deck]'); if (c) openDeck(c.dataset.deck); });
$('#deckList').addEventListener('keydown', e => { const c = e.target.closest('[data-deck]'); if (c && e.key === 'Enter') openDeck(c.dataset.deck); });
$('#deckForm').addEventListener('submit', e => { e.preventDefault(); const t = $('#deckTopic').value.trim(); if (!t) return; $('#deckTopic').value = ''; runDeck(t); });
let curDeck = null;
function closeDeck() { curDeck = null; $('#decksHome').hidden = false; $('#deckDetail').hidden = true; }
function openDeck(id) {
  const d = S.decks.find(x => x.id === id); if (!d) return; curDeck = d;
  $('#decksHome').hidden = true; const D = $('#deckDetail'); D.hidden = false;
  D.innerHTML = '<button class="btn small ghost" data-dback>&larr; Decks</button><h2 style="margin-top:12px">' + esc(d.title) + '</h2><p class="sub">' + d.slides.length + ' slides · built ' + ago(d.created) + '</p>' +
    '<div class="row"><button class="btn blue" data-present>Present</button><button class="btn" data-pptx>Download PowerPoint</button><button class="btn ghost" data-figma>Copy for Figma</button><a class="btn ghost" href="gizmo/gizmo-figma-plugin.zip" download>Get the Figma plugin</a><button class="x" data-ddel>Delete</button></div>' +
    '<details class="card soft how" style="margin-top:12px"><summary>Put this deck in Figma</summary><ol class="steps-list"><li>Download the Gizmo plugin above and unzip it.</li><li>In the Figma desktop app, open a design file, then go to Plugins → Development → Import plugin from manifest, and choose <code>manifest.json</code>.</li><li>Press <b>Copy for Figma</b> here.</li><li>Run <b>Gizmo Deck Builder</b> in Figma, paste, and press Build. Each slide lands as a 1920×1080 frame.</li></ol></details>' +
    '<div class="slides" style="margin-top:14px">' + d.slides.map((s, i) => slideHTML(s, i, d.slides.length)).join('') + '</div>';
}
$('#deckDetail').addEventListener('click', async e => {
  const d = curDeck; if (!d) return;
  if (e.target.closest('[data-dback]')) { closeDeck(); renderDecks(); }
  if (e.target.closest('[data-present]')) present(d, 0);
  if (e.target.closest('[data-pptx]')) { try { const n = await exportPptx(d); toast('Downloaded ' + n); } catch (err) { toast('Couldn’t make the PowerPoint: ' + err.message); } }
  if (e.target.closest('[data-figma]')) { const j = figmaJSON(d); try { await navigator.clipboard.writeText(j); toast('Copied. Paste it into the Gizmo plugin in Figma.'); } catch (err) { prompt('Copy this into the Gizmo plugin in Figma:', j); } }
  if (e.target.closest('[data-ddel]')) { if (!confirm('Delete this deck?')) return; S.decks = S.decks.filter(x => x !== d); save(); closeDeck(); renderDecks(); }
});
let pres = null;
function present(d, i) {
  closePresent(); pres = document.createElement('div'); pres.className = 'present'; pres.tabIndex = 0;
  const draw = () => { pres.innerHTML = slideHTML(d.slides[i], i, d.slides.length) + '<button class="btn ghost small pclose">Close</button><div class="pnav"><button class="btn ghost small" data-p="-1">&larr;</button>' + (i + 1) + ' / ' + d.slides.length + '<button class="btn ghost small" data-p="1">&rarr;</button></div>'; };
  draw(); document.body.appendChild(pres); pres.focus();
  pres.onclick = e => { if (e.target.closest('.pclose')) return closePresent(); const p = e.target.closest('[data-p]'); if (p) { i = Math.max(0, Math.min(d.slides.length - 1, i + +p.dataset.p)); draw(); } };
  pres.onkeydown = e => { if (/Arrow(Right|Down)|PageDown| /.test(e.key)) { i = Math.min(d.slides.length - 1, i + 1); draw(); } if (/Arrow(Left|Up)|PageUp/.test(e.key)) { i = Math.max(0, i - 1); draw(); } };
}
function closePresent() { if (pres) { pres.remove(); pres = null; } }

// ================= PROJECTS =================
const nid = a => a.reduce((m, x) => Math.max(m, x.id), 0) + 1;
function pstatus(p) { return p.pct >= 100 ? '<span class="pill done">Done</span>' : p.pct >= 1 ? '<span class="pill go">In progress</span>' : '<span class="pill">Planned</span>'; }
function renderProj() {
  $('#projList').innerHTML = S.proj.length ? S.proj.map(p => '<div class="card proj" data-p="' + p.id + '"><div class="row"><h4 style="margin:0;font-size:1rem">' + esc(p.name) + '</h4>' + pstatus(p) + '<span style="margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums" data-pct-l>' + p.pct + '%</span></div>' + (p.note ? '<p style="margin:4px 0 0;color:var(--body)">Next: ' + esc(p.note) + '</p>' : '') + '<input type="range" min="0" max="100" step="5" value="' + p.pct + '" aria-label="Progress for ' + esc(p.name) + '" style="width:100%;accent-color:var(--acc);margin-top:8px"><div class="meta"><span>Drag to update progress</span><button class="x" data-pdel>Remove</button></div></div>').join('') : '<p class="empty">No projects yet.</p>';
  renderCounts();
}
$('#projList').addEventListener('input', e => { const c = e.target.closest('[data-p]'); if (!c || e.target.type !== 'range') return; const p = S.proj.find(x => x.id === +c.dataset.p); p.pct = +e.target.value; save(); c.querySelector('[data-pct-l]').textContent = p.pct + '%'; c.querySelector('.pill').outerHTML = pstatus(p); renderCounts(); });
$('#projList').addEventListener('click', e => { const c = e.target.closest('[data-p]'); if (c && e.target.closest('[data-pdel]')) { S.proj = S.proj.filter(x => x.id !== +c.dataset.p); save(); renderProj(); } });
function addProj(name, note) { const p = { id: nid(S.proj), name: String(name).trim().slice(0, 60), pct: 0, note: (note || '').trim() }; S.proj.push(p); save(); return p; }
$('#projForm').addEventListener('submit', e => { e.preventDefault(); const n = $('#pName').value.trim(); if (!n) return; addProj(n, $('#pNote').value); $('#pName').value = ''; $('#pNote').value = ''; renderProj(); toast('Project added'); });
function findProj(q) { q = String(q).toLowerCase().trim(); return S.proj.find(p => { const n = p.name.toLowerCase(); return n === q || n.includes(q) || q.includes(n); }) || S.proj.find(p => p.name.toLowerCase().split(/\s+/).some(w => w.length > 3 && q.includes(w))); }

// ================= TOOLS =================
function renderTools() {
  const c = S.connect, prov = c.provider || 'demo', origin = location.origin;
  const st = (on, label) => '<span class="pill ' + (on ? 'done' : '') + '">' + (on ? label || 'Connected' : 'Demo') + '</span>';
  const tokOk = k => (k === 'google' ? c.google.token && c.google.exp > Date.now() : k === 'microsoft' ? !!c.microsoft.signedIn : false);
  $('#toolsInner').innerHTML =
    '<h2>Tools</h2><p class="sub">Connect the apps Gizmo works in. Until you do, Gizmo uses a built-in demo workspace so you can see exactly what it would do. Keys and sign-ins are stored only in this browser.</p>' +
    // profile
    '<div class="card tool"><div class="th"><h4>About you</h4></div><label class="field"><span>Your name (used to sign emails)</span><input type="text" data-k="profile.name" value="' + esc(S.profile.name || '') + '" placeholder="e.g. Shaun"></label></div>' +
    // AI brain
    '<h3 class="sec">AI brain</h3><div class="card tool"><div class="th"><h4>Claude</h4>' + (C.mode('ai') === 'live' ? '<span class="pill done">Connected</span>' : '<span class="pill">Off</span>') + '</div>' +
    '<p>With a Claude key, Gizmo plans and carries out open-ended tasks on its own, writes replies and decks, and answers questions from your study library. Without one, it uses its built-in skills.</p>' +
    '<div class="row"><label class="field grow"><span>Anthropic API key</span><input type="password" data-k="connect.claude.key" value="' + esc(c.claude.key || '') + '" placeholder="sk-ant-…" autocomplete="off"></label><label class="field"><span>Model</span><select data-k="connect.claude.model">' + C.MODELS.map(m => '<option value="' + m.id + '"' + ((c.claude.model || C.MODELS[0].id) === m.id ? ' selected' : '') + '>' + m.label + '</option>').join('') + '</select></label></div>' +
    '<div class="row"><button class="btn small ghost" data-test="claude">Test</button><span class="meta" style="margin:0" data-out="claude"></span></div>' +
    '<details class="how"><summary>Where do I get a key?</summary><ol><li>Sign in at <code>console.anthropic.com</code> and open API keys.</li><li>Create a key and set a monthly spend limit.</li><li>Paste it here. It stays in this browser and is only sent to Anthropic.</li></ol></details></div>' +
    // email + calendar
    '<h3 class="sec">Email, calendar and Teams</h3><div class="card tool"><div class="th"><h4>Account</h4>' + st(prov !== 'demo', prov === 'google' ? 'Google' : 'Microsoft 365') + '</div>' +
    '<div class="seg" role="group" aria-label="Email and calendar account">' + [['demo', 'Demo'], ['google', 'Google'], ['microsoft', 'Microsoft 365']].map(([k, l]) => '<button type="button" data-prov="' + k + '" aria-pressed="' + (prov === k) + '">' + l + '</button>').join('') + '</div>' +
    (prov === 'google' ? '<label class="field"><span>Google OAuth client ID</span><input type="text" data-k="connect.google.clientId" value="' + esc(c.google.clientId || '') + '" placeholder="…apps.googleusercontent.com"></label><div class="row"><button class="btn small blue" data-connect="google">Connect Gmail &amp; Calendar</button><span class="meta" style="margin:0" data-out="google">' + (tokOk('google') ? 'Signed in' : '') + '</span></div>' +
      '<details class="how"><summary>Set up Google (5 minutes)</summary><ol><li>In <code>console.cloud.google.com</code>, create a project and enable the Gmail API and Google Calendar API.</li><li>Set up the OAuth consent screen (External) and add yourself as a test user.</li><li>Create credentials → OAuth client ID → Web application.</li><li>Under Authorized JavaScript origins add <code>' + esc(origin) + '</code>.</li><li>Paste the client ID above and press Connect.</li></ol></details>' : '') +
    (prov === 'microsoft' ? '<div class="row"><label class="field grow"><span>Application (client) ID</span><input type="text" data-k="connect.microsoft.clientId" value="' + esc(c.microsoft.clientId || '') + '" placeholder="00000000-0000-0000-0000-000000000000"></label><label class="field"><span>Tenant</span><input type="text" data-k="connect.microsoft.tenant" value="' + esc(c.microsoft.tenant || 'common') + '"></label></div><div class="row"><button class="btn small blue" data-connect="microsoft">Connect Outlook, Calendar &amp; Teams</button><span class="meta" style="margin:0" data-out="microsoft">' + (c.microsoft.signedIn ? 'Signed in as ' + esc(c.microsoft.signedIn) : '') + '</span></div>' +
      '<details class="how"><summary>Set up Microsoft 365 (5 minutes)</summary><ol><li>In <code>entra.microsoft.com</code>, go to App registrations → New registration.</li><li>Add a redirect URI of type Single-page application: <code>' + esc(C.AUTH_REDIRECT) + '</code>.</li><li>Under API permissions add Microsoft Graph delegated permissions: User.Read, Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, Chat.ReadWrite, ChannelMessage.Send, Team.ReadBasic.All, Channel.ReadBasic.All.</li><li>Copy the Application (client) ID here and press Connect.</li></ol></details>' : '') +
    (prov === 'demo' ? '<p>Demo inbox, calendar and Teams chats with sample colleagues. Nothing is really sent. <button class="btn small ghost" data-reset>Reset demo data</button></p>' : '') + '</div>' +
    // slack
    '<h3 class="sec">Slack</h3><div class="card tool"><div class="th"><h4>Slack</h4>' + st(C.mode('slack') === 'live') + '</div>' +
    '<div class="row"><label class="field grow"><span>Bot token (reads and posts)</span><input type="password" data-k="connect.slack.token" value="' + esc(c.slack.token || '') + '" placeholder="xoxb-…" autocomplete="off"></label><label class="field grow"><span>Incoming webhook (posts only)</span><input type="url" data-k="connect.slack.webhook" value="' + esc(c.slack.webhook || '') + '" placeholder="https://hooks.slack.com/services/…"></label></div>' +
    '<details class="how"><summary>Set up Slack</summary><ol><li>At <code>api.slack.com/apps</code>, create an app for your workspace.</li><li>Add bot scopes: channels:read, channels:history, groups:read, groups:history, chat:write. Install it and copy the bot token.</li><li>Invite the bot to the channels Gizmo should read: <code>/invite @YourApp</code>.</li><li>Only want Gizmo to post? Turn on Incoming Webhooks and paste the webhook URL instead.</li></ol></details></div>' +
    // figma
    '<h3 class="sec">Figma</h3><div class="card tool"><div class="th"><h4>Figma</h4>' + st(C.mode('figma') === 'live') + '</div>' +
    '<p>Gizmo builds decks and places them in Figma with its plugin. With a token it can also read your file and leave comments.</p>' +
    '<div class="row"><label class="field grow"><span>Personal access token</span><input type="password" data-k="connect.figma.token" value="' + esc(c.figma.token || '') + '" placeholder="figd_…" autocomplete="off"></label><label class="field grow"><span>File link</span><input type="url" data-k="connect.figma.file" value="' + esc(c.figma.file || '') + '" placeholder="https://www.figma.com/design/…"></label></div>' +
    '<div class="row"><a class="btn small" href="gizmo/gizmo-figma-plugin.zip" download>Download the Gizmo Figma plugin</a><button class="btn small ghost" data-test="figma">Test</button><span class="meta" style="margin:0" data-out="figma"></span></div></div>' +
    // automations
    '<h3 class="sec">Other software</h3><div class="card tool"><div class="th"><h4>Automations</h4><span class="pill">' + (c.hooks.length || 'None') + '</span></div>' +
    '<p>To log in to and operate other software, give Gizmo a webhook from Zapier, Make or n8n. That service holds your sign-in and does the clicking; Gizmo triggers it with the details.</p>' +
    (c.hooks.length ? '<div class="list">' + c.hooks.map((h, i) => '<div class="row"><b>' + esc(h.name) + '</b><span class="meta" style="margin:0">' + esc(trim(h.url, 48)) + '</span><button class="x" data-hdel="' + i + '">Remove</button></div>').join('') + '</div>' : '') +
    '<div class="row"><input type="text" id="hName" placeholder="Name, e.g. Log hours in Harvest" style="flex:1;min-width:180px"><input type="url" id="hUrl" placeholder="Webhook URL" style="flex:2;min-width:200px"><button class="btn small ghost" data-hadd>Add</button></div></div>' +
    // permissions
    '<h3 class="sec">Permissions</h3><div class="card tool"><p>Reading and drafting run on their own. Anything other people will see asks first, unless you change it here.</p><div class="perm">' +
    A.TOOLS.filter(t => t.risk === 'critical').map(t => '<span>' + esc(t.label) + '</span><select data-pol="' + t.name + '"><option value="ask"' + (A.policyFor(t.name) === 'ask' ? ' selected' : '') + '>Ask me first</option><option value="auto"' + (A.policyFor(t.name) === 'auto' ? ' selected' : '') + '>Do it automatically</option></select>').join('') + '</div></div>';
}
function setPath(path, v) { const ks = path.split('.'); let o = S; while (ks.length > 1) { const k = ks.shift(); o = o[k] = o[k] || {}; } o[ks[0]] = v; save(); renderCounts(); }
$('#toolsInner').addEventListener('change', e => {
  const k = e.target.dataset.k; if (k) { setPath(k, e.target.value.trim()); if (k === 'connect.microsoft.clientId' || k === 'connect.microsoft.tenant') S.connect.microsoft.signedIn = ''; }
  const pol = e.target.dataset.pol; if (pol) { S.policy[pol] = e.target.value; save(); toast(e.target.value === 'auto' ? 'Gizmo will do this without asking' : 'Gizmo will ask first'); }
});
$('#toolsInner').addEventListener('click', async e => {
  const t = e.target;
  const pv = t.closest('[data-prov]'); if (pv) { S.connect.provider = pv.dataset.prov; save(); renderTools(); renderCounts(); return; }
  if (t.closest('[data-reset]')) { C.resetDemo(); toast('Demo data reset'); return; }
  const out = k => $('#toolsInner [data-out="' + k + '"]');
  const cn = t.closest('[data-connect]');
  if (cn) {
    const k = cn.dataset.connect; out(k).textContent = 'Opening sign-in…';
    try {
      if (k === 'google') { await C.googleToken(true); out(k).textContent = 'Signed in. Reading inbox…'; const l = await C.mail.listUnread(3); out(k).textContent = 'Connected: ' + l.length + ' unread shown.'; }
      else { await C.msToken(true); S.connect.microsoft.signedIn = 'your Microsoft account'; save(); const l = await C.mail.listUnread(3); out(k).textContent = 'Connected: ' + l.length + ' unread shown.'; }
      renderCounts();
    } catch (err) { out(k).textContent = err.message; }
  }
  const ts = t.closest('[data-test]');
  if (ts) {
    const k = ts.dataset.test; out(k).textContent = 'Testing…';
    try {
      if (k === 'claude') { const j = await C.claude({ system: 'Reply with exactly: Gizmo is connected.', messages: [{ role: 'user', content: 'Test' }], max_tokens: 20 }); out(k).textContent = C.textOf(j) || 'Connected.'; }
      if (k === 'figma') { const f = await C.figma.file(); out(k).textContent = 'Read “' + f.name + '”, ' + f.pages.length + ' page' + (f.pages.length === 1 ? '' : 's') + '.'; }
    } catch (err) { out(k).textContent = err.message; }
  }
  if (t.closest('[data-hadd]')) { const n = $('#hName').value.trim(), u = $('#hUrl').value.trim(); if (!n || !/^https:\/\//.test(u)) { toast('Add a name and an https webhook URL'); return; } S.connect.hooks.push({ name: n, url: u }); save(); renderTools(); }
  const hd = t.closest('[data-hdel]'); if (hd) { S.connect.hooks.splice(+hd.dataset.hdel, 1); save(); renderTools(); }
});

// ================= VOICE IN =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null, listening = false;
if (!SR) $('#hint').textContent = 'Voice input isn’t available in this browser, so type instead. Gizmo still talks back.';
$('#mic').addEventListener('click', () => {
  if (synth) synth.cancel();
  if (!SR) { $('#input').focus(); toast('Type your message instead'); return; }
  if (listening) { rec && rec.stop(); return; }
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false; let fin = '';
  rec.onstart = () => { listening = true; setS('listening'); $('#input').placeholder = 'Listening…'; };
  rec.onresult = e => { let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = e.results[i][0].transcript; } $('#input').value = t; };
  rec.onerror = e => { listening = false; setS('idle'); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone blocked. Allow it in the address bar, or type instead.'); else if (e.error === 'no-speech') toast('I didn’t hear anything. Try again.'); };
  rec.onend = () => { listening = false; $('#input').placeholder = 'Ask Gizmo, or give it a task'; if (app.getAttribute('data-s') === 'listening') setS('idle'); if (fin) { $('#input').value = ''; handle(fin); } };
  try { rec.start(); } catch (err) { listening = false; setS('idle'); }
});

// ================= START =================
const SAMPLE = `# How memory works: a short guide to studying

Most people study by rereading their notes. It feels productive, but it is one of the weakest ways to learn. Decades of research in cognitive psychology point to a handful of techniques that make knowledge stick.

# Working memory and long-term memory

Working memory is the small mental workspace where you hold information while you think about it. It can only juggle around four chunks at once, so it fills up quickly. Long-term memory is the vast store where knowledge is kept for later. Learning is the process of moving information from working memory into long-term memory, and building the cues that let you find it again.

# The forgetting curve

The forgetting curve describes how quickly we lose new information when we do nothing to keep it. Hermann Ebbinghaus measured it in the 1880s: much of a new list is forgotten within a day. Every time you successfully recall something, the curve flattens and the memory lasts longer.

# Retrieval practice

Retrieval practice means pulling information out of your memory instead of putting it in again. Answering questions, using flashcards and explaining an idea from scratch are all forms of retrieval practice. Each successful retrieval strengthens the memory far more than rereading does. Getting an answer wrong is useful too, as long as you check the correct answer straight away.

# Spaced repetition

Spaced repetition means reviewing material at growing intervals: after a day, then a few days, then a week, then a month. Spacing your reviews works because recalling something that is starting to fade takes effort, and that effort is what strengthens memory. A Leitner system is a simple way to schedule spaced repetition with boxes of flashcards.

# Interleaving

Interleaving means mixing different topics or problem types in one session, rather than practising one type at a time. It feels harder than blocked practice, but it teaches you to choose the right method, which is what exams and real work demand.

# Elaboration

Elaboration means connecting new ideas to what you already know by asking how and why. When you explain how a new concept relates to an old one, you create more routes back to the memory.

# Putting it together

A strong study session is short and active: retrieve what you learned last time, space your reviews, mix topics, and explain ideas in your own words. Gizmo builds these habits in by quizzing you, scheduling flashcards and tracking how well you understand each subject.`;

(async () => {
  try { SOURCES = (await idbGet('sources')) || null; } catch (e) { SOURCES = null; }
  if (!SOURCES) {
    SOURCES = [];
    await addSource({ title: 'How memory works (sample)', type: 'Article', subject: 'Learning science', text: SAMPLE }, true);
    await addSource({ title: 'About Gizmo', type: 'Note', subject: 'Notes', text: 'Gizmo is a personal AI helper designed and built by Shaun Finch. Gizmo studies the books, articles and essays you give it, quizzes you on them and tracks your understanding. Gizmo also completes tasks for you: it triages your inbox, books meetings, catches up on Slack and Teams, and builds presentation decks for Figma and PowerPoint. Anything other people will see waits for your approval first.' }, true);
    for (const l of (S._v1learn || [])) if (l && l.text && l.id > 3) await addSource({ title: l.title, type: 'Note', subject: 'Notes', text: l.text }, true);
    delete S._v1learn; save();
  }
  renderRecent(); renderCounts();
  A.startScheduler();
})();
window.addEventListener('beforeunload', () => saveState(S));
