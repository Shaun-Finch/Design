// Gizmo's agent: tools it can use, skills (step-by-step playbooks), approvals for critical actions,
// and routines that run on a daily or weekly pattern.
import { mail, calendar, slack, teams, figma, automations, claude, textOf, mode, contacts, ymd, pad, NeedsUser } from './connectors.js';
import { answerLocally, search, trim, dueCards } from './study.js';
import { deckFromSources, deckFromWeek } from './deck.js';

let G = null; // host: { state, save, log, notify, sources(), saveDeck(deck), addProject, updateProject, remember }
export function bindHost(h) { G = h; }

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtTime = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDay = d => new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const first = n => String(n || '').split(/[\s@]/)[0];
const me = () => (G.state.profile && G.state.profile.name) || '';
const sign = () => me() ? '\n\nBest,\n' + me() : '\n\nBest wishes';

// ================= TOOLS =================
// risk: read = runs on its own · write = changes only your own stuff, runs on its own · critical = visible to other people, asks first
export const TOOLS = [
  { name: 'list_unread_email', label: 'Read your inbox', service: 'mail', risk: 'read', desc: 'List unread emails in the inbox.', schema: { type: 'object', properties: { limit: { type: 'integer' } } },
    run: a => mail.listUnread(a.limit || 10).then(l => l.map(m => ({ id: m.id, from: m.from, email: m.email, subject: m.subject, preview: trim(m.body, 300), date: m.date }))) },
  { name: 'mark_email_read', label: 'Mark email as read', service: 'mail', risk: 'write', desc: 'Mark an email as read.', schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: a => mail.markRead(a.id).then(() => 'Marked as read.'), say: a => 'Mark an email as read' },
  { name: 'draft_email', label: 'Draft an email', service: 'mail', risk: 'write', desc: 'Save an email as a draft (not sent).', schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
    run: a => mail.draft(a).then(() => 'Draft saved.'), say: a => 'Save a draft to ' + a.to + ': “' + a.subject + '”' },
  { name: 'send_email', label: 'Send email', service: 'mail', risk: 'critical', desc: 'Send an email, or reply to one when reply_to_id is given.', schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, reply_to_id: { type: 'string' } }, required: ['to', 'subject', 'body'] },
    run: async a => { let replyTo = null; if (a.reply_to_id) { const l = await mail.listUnread(25).catch(() => []); replyTo = l.find(m => m.id === a.reply_to_id) || { id: a.reply_to_id }; } await mail.send({ to: a.to, subject: a.subject, body: a.body, replyTo }); if (a.reply_to_id) await mail.markRead(a.reply_to_id).catch(() => {}); return 'Sent to ' + a.to + '.'; },
    say: a => 'Email ' + a.to + ': “' + a.subject + '”', preview: a => a.body },
  { name: 'list_events', label: 'Read your calendar', service: 'calendar', risk: 'read', desc: 'List calendar events between two ISO dates.', schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    run: a => calendar.list(new Date(a.from), new Date(a.to)).then(l => l.map(e => ({ title: e.title, start: e.start, end: e.end, attendees: e.attendees }))) },
  { name: 'create_event', label: 'Book meetings', service: 'calendar', risk: 'critical', critical: a => (a.attendees || []).length > 0, desc: 'Create a calendar event. Invites go to attendees.', schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string', description: 'ISO date-time' }, end: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, online: { type: 'boolean' } }, required: ['title', 'start', 'end'] },
    run: a => calendar.create(a).then(() => 'Booked “' + a.title + '” for ' + fmtDay(a.start) + ', ' + fmtTime(a.start) + '.'), say: a => 'Book “' + a.title + '”, ' + fmtDay(a.start) + ' ' + fmtTime(a.start) + '–' + fmtTime(a.end) + ((a.attendees || []).length ? ', inviting ' + a.attendees.join(', ') : '') },
  { name: 'read_slack', label: 'Read Slack', service: 'slack', risk: 'read', desc: 'Read recent messages in a Slack channel (or list channels when no channel is given).', schema: { type: 'object', properties: { channel: { type: 'string' } } },
    run: a => a.channel ? slack.recent(a.channel) : slack.channels() },
  { name: 'post_slack', label: 'Post in Slack', service: 'slack', risk: 'critical', desc: 'Post a message in a Slack channel.', schema: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] },
    run: a => slack.post(a.channel, a.text).then(r => (r && r.note) || 'Posted in #' + a.channel.replace(/^#/, '') + '.'), say: a => 'Post in #' + a.channel.replace(/^#/, ''), preview: a => a.text },
  { name: 'read_teams', label: 'Read Teams chats', service: 'teams', risk: 'read', desc: 'Read recent Microsoft Teams chats.', schema: { type: 'object', properties: {} },
    run: () => teams.chats(8) },
  { name: 'post_teams', label: 'Reply in Teams', service: 'teams', risk: 'critical', desc: 'Send a message in a Teams chat (use the chat id or name).', schema: { type: 'object', properties: { chat: { type: 'string' }, text: { type: 'string' } }, required: ['chat', 'text'] },
    run: a => teams.post(a.chat, a.text).then(() => 'Sent in Teams.'), say: a => 'Reply in Teams (' + (a.chatName || a.chat) + ')', preview: a => a.text },
  { name: 'figma_file', label: 'Read Figma files', service: 'figma', risk: 'read', desc: 'Read the pages and frames of the connected Figma file.', schema: { type: 'object', properties: { url: { type: 'string' } } },
    run: a => figma.file(a.url) },
  { name: 'figma_comment', label: 'Comment in Figma', service: 'figma', risk: 'critical', desc: 'Post a comment on the connected Figma file.', schema: { type: 'object', properties: { message: { type: 'string' }, url: { type: 'string' } }, required: ['message'] },
    run: a => figma.comment(a.url, a.message).then(() => 'Comment posted in Figma.'), say: a => 'Comment in Figma', preview: a => a.message },
  { name: 'run_automation', label: 'Run automations', service: 'automations', risk: 'critical', desc: 'Trigger one of the user’s automations (Zapier, Make, n8n webhooks) to operate other software.', schema: { type: 'object', properties: { name: { type: 'string' }, details: { type: 'string' } }, required: ['name'] },
    run: a => automations.run(a.name, a.details || '').then(r => r.note || 'Done.'), say: a => 'Run automation “' + a.name + '”', preview: a => a.details || '' },
  { name: 'search_study', label: 'Search your study library', service: 'study', risk: 'read', desc: 'Search the user’s study library (books, articles, essays) and return relevant passages.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: a => search(G.sources(), a.query, 5).map(h => ({ source: h.src.title, passage: trim(h.c, 900) })) },
  { name: 'create_deck', label: 'Build decks', service: 'decks', risk: 'write', desc: 'Create a presentation deck. Give slides when you have written them, or a topic to build from the study library.', schema: { type: 'object', properties: { topic: { type: 'string' }, slides: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, layout: { type: 'string', enum: ['title', 'agenda', 'bullets', 'end'] } }, required: ['title'] } } }, required: ['topic'] },
    run: a => { const d = a.slides && a.slides.length ? { title: a.topic, slides: a.slides.map(s => ({ layout: s.layout || 'bullets', title: s.title, bullets: s.bullets || [], notes: s.notes || '' })), created: Date.now(), from: [] } : deckFromSources(a.topic, pickSources(a.topic)); G.saveDeck(d); return 'Deck “' + d.title + '” created with ' + d.slides.length + ' slides. Open Decks to export it or send it to Figma.'; },
    say: a => 'Build a deck: ' + a.topic },
  { name: 'update_project', label: 'Update projects', service: 'projects', risk: 'write', desc: 'Add a project or set its progress.', schema: { type: 'object', properties: { name: { type: 'string' }, percent: { type: 'integer' }, next_step: { type: 'string' } }, required: ['name'] },
    run: a => G.updateProject(a.name, a.percent, a.next_step) },
  { name: 'remember', label: 'Remember notes', service: 'study', risk: 'write', desc: 'Save a note to the user’s study library so Gizmo remembers it.', schema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
    run: a => G.remember(a.title || '', a.text).then(() => 'Saved.') },
];
const TOOL = Object.fromEntries(TOOLS.map(t => [t.name, t]));
function pickSources(topic) {
  const all = G.sources(); if (!topic) return all.slice(0, 3);
  const hits = search(all, topic, 8); const ids = [...new Set(hits.map(h => h.src.id))];
  return ids.length ? all.filter(s => ids.includes(s.id)) : [];
}
export function policyFor(name) { const t = TOOL[name]; if (!t || t.risk !== 'critical') return 'auto'; return (G.state.policy && G.state.policy[name]) || 'ask'; }
export function isCritical(name, args) { const t = TOOL[name]; if (!t || t.risk !== 'critical') return false; return t.critical ? t.critical(args || {}) : true; }
export const describe = (name, args) => (TOOL[name] && TOOL[name].say ? TOOL[name].say(args || {}) : (TOOL[name] ? TOOL[name].label : name));

// ================= RUNS + APPROVALS =================
function newRun(title, origin) {
  const r = { id: uid(), title, origin, started: Date.now(), status: 'running', steps: [], result: '' };
  G.state.runs.unshift(r); G.state.runs = G.state.runs.slice(0, 60); G.save(); G.log();
  return r;
}
function step(run, text, kind = 'info') { run.steps.push({ t: Date.now(), text, kind }); G.save(); G.log(); }
function finish(run, result, status) {
  run.result = result; run.finished = Date.now();
  run.status = status || (G.state.approvals.some(a => a.runId === run.id && a.status === 'pending') ? 'needs-ok' : 'done');
  G.save(); G.log();
}
// call a tool on behalf of a run, respecting the approval policy
async function call(run, name, args, why, opts = {}) {
  const t = TOOL[name]; if (!t) throw new Error('Unknown tool ' + name);
  if (isCritical(name, args) && !(opts.autoCritical || policyFor(name) === 'auto')) {
    const ap = { id: uid(), runId: run.id, tool: name, args, why: why || '', created: Date.now(), status: 'pending', title: describe(name, args) };
    G.state.approvals.unshift(ap); G.state.approvals = G.state.approvals.slice(0, 80);
    step(run, 'Waiting for your OK: ' + ap.title, 'ask'); G.notify('Gizmo needs your OK', ap.title);
    return { queued: true, approval: ap.id, message: 'Queued for the user’s approval. It will run when they approve it. Do not try again.' };
  }
  const out = await t.run(args || {});
  if (t.risk !== 'read') step(run, (typeof out === 'string' ? out : describe(name, args)), 'done');
  return out;
}
export async function approve(id, editedArgs) {
  const ap = G.state.approvals.find(a => a.id === id); if (!ap || ap.status !== 'pending') return;
  if (editedArgs) ap.args = { ...ap.args, ...editedArgs };
  ap.status = 'running'; G.save(); G.log();
  const run = G.state.runs.find(r => r.id === ap.runId);
  try {
    const out = await TOOL[ap.tool].run(ap.args);
    ap.status = 'done'; ap.result = typeof out === 'string' ? out : 'Done.';
    if (run) step(run, 'Approved and done: ' + ap.title, 'done');
  } catch (e) {
    ap.status = e.needsUser ? 'pending' : 'failed'; ap.result = e.message;
    if (run) step(run, 'Couldn’t ' + ap.title.toLowerCase() + ': ' + e.message, 'error');
    G.save(); G.log(); throw e;
  }
  if (run && !G.state.approvals.some(a => a.runId === run.id && a.status === 'pending') && run.status === 'needs-ok') run.status = 'done';
  G.save(); G.log();
  return ap.result;
}
export function reject(id) {
  const ap = G.state.approvals.find(a => a.id === id); if (!ap) return;
  ap.status = 'rejected'; const run = G.state.runs.find(r => r.id === ap.runId);
  if (run) { step(run, 'You declined: ' + ap.title, 'info'); if (!G.state.approvals.some(a => a.runId === run.id && a.status === 'pending') && run.status === 'needs-ok') run.status = 'done'; }
  G.save(); G.log();
}

// ================= TIME PARSING =================
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function parseWhen(text, now = new Date()) {
  const s = text.toLowerCase();
  let d = new Date(now), dateSet = false;
  if (/\btomorrow\b/.test(s)) { d.setDate(d.getDate() + 1); dateSet = true; }
  else if (/\btoday\b|\bthis (morning|afternoon|evening)\b/.test(s)) dateSet = true;
  else { const m = s.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/); if (m) { const target = DAYS.indexOf(m[2]); let diff = (target - d.getDay() + 7) % 7; if (diff === 0 || m[1]) diff = diff || 7; d.setDate(d.getDate() + diff); dateSet = true; } }
  const md = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (md) { const mo = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(md[2]) / 3; d = new Date(now.getFullYear(), mo, +md[1]); if (d < now) d.setFullYear(d.getFullYear() + 1); dateSet = true; }
  let h = null, mi = 0;
  const tm = s.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || s.match(/\b(?:at\s+)(\d{1,2})(?::(\d{2}))\b/) || s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (tm) { h = +tm[1]; mi = +(tm[2] || 0); if (tm[3] === 'pm' && h < 12) h += 12; if (tm[3] === 'am' && h === 12) h = 0; if (!tm[3] && h < 8) h += 12; }
  else if (/\bnoon\b|\blunch\b/.test(s)) h = 12;
  else if (/\bmorning\b/.test(s)) h = 10;
  else if (/\bafternoon\b/.test(s)) h = 14;
  else if (/\bevening\b/.test(s)) h = 17;
  if (h == null && !dateSet) return null;
  d.setHours(h == null ? 10 : h, mi, 0, 0);
  const dur = (s.match(/\bfor\s+(\d+)\s*(min|minute|hour|hr|h)\w*/) || []);
  const minutes = dur[1] ? (+dur[1]) * (/^h/.test(dur[2]) ? 60 : 1) : (/\bhalf an hour\b/.test(s) ? 30 : /\ban hour\b/.test(s) ? 60 : 30);
  return { start: d, minutes, timeGiven: h != null };
}
async function freeSlot(from, minutes) {
  const day0 = new Date(from); const end = new Date(day0); end.setDate(end.getDate() + 5);
  const evs = await calendar.list(new Date(day0.getTime() - 864e5 / 2), end).catch(() => []);
  let t = new Date(from);
  for (let i = 0; i < 200; i++) {
    if (t.getHours() < 9) t.setHours(9, 0, 0, 0);
    if (t.getHours() * 60 + t.getMinutes() + minutes > 17 * 60 + 30 || t.getDay() === 0 || t.getDay() === 6) { t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); continue; }
    const e = new Date(t.getTime() + minutes * 6e4);
    const clash = evs.find(x => new Date(x.start) < e && new Date(x.end) > t);
    if (!clash) return t;
    t = new Date(Math.max(new Date(clash.end).getTime(), t.getTime() + 15 * 6e4));
    t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
  }
  return new Date(from);
}
function resolvePeople(text) {
  const out = [], cs = contacts();
  for (const em of (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])) out.push(em);
  for (const c of cs) { const fn = c.name.split(' ')[0]; if (new RegExp('\\b(' + c.name + '|' + fn + ')\\b', 'i').test(text) && !out.includes(c.email)) out.push(c.email); }
  return out;
}

// ================= WRITING HELP (Claude when connected, templates otherwise) =================
async function write(prompt, fallback) {
  if (mode('ai') !== 'live') return fallback;
  try {
    const j = await claude({ system: 'You write short, warm, professional messages on behalf of the user' + (me() ? ' (' + me() + ')' : '') + '. Plain text only. No subject line. No placeholders in brackets.', messages: [{ role: 'user', content: prompt }], max_tokens: 500 });
    return textOf(j) || fallback;
  } catch (e) { return fallback; }
}

// ================= SKILLS =================
function classify(m) {
  const t = ((m.subject || '') + ' ' + (m.body || m.preview || '')).toLowerCase(), from = (m.email || '').toLowerCase();
  if (/no-?reply|newsletter|digest|marketing@|news@/.test(from) || /unsubscribe/.test(t)) return 'fyi-auto';
  if (/\b(urgent|asap|immediately|end of (the )?day|eod|deadline|today)\b/.test(t)) return 'urgent';
  if (/\b(meet|meeting|call|catch[ -]?up|sync|free for|available|availability|slot|calendar)\b/.test(t)) return 'meeting';
  if (/\?/.test(t)) return 'question';
  return 'fyi';
}
export const SKILLS = {
  triage: {
    label: 'Triage my inbox', icon: 'mail', desc: 'Reads new email, books requested meetings, drafts replies, and files newsletters.',
    async run(run, args, opt) {
      const list = await call(run, 'list_unread_email', { limit: 12 });
      step(run, 'Read ' + list.length + ' unread email' + (list.length === 1 ? '' : 's') + '.');
      if (!list.length) return 'Your inbox is clear. Nothing new.';
      let booked = 0, replies = 0, filed = 0, urgent = [];
      for (const m of list) {
        const kind = classify(m);
        if (kind === 'fyi-auto') { await call(run, 'mark_email_read', { id: m.id }); filed++; continue; }
        if (kind === 'meeting') {
          const w = parseWhen(m.subject + ' ' + m.preview) || { start: new Date(Date.now() + 864e5), minutes: 30 };
          if (!w.timeGiven) w.start.setHours(/afternoon|after\s*2|after 2pm/i.test(m.preview) ? 14 : 10, 0, 0, 0);
          const slot = await freeSlot(w.start, w.minutes);
          const end = new Date(slot.getTime() + w.minutes * 6e4);
          await call(run, 'create_event', { title: (m.subject.replace(/^(re:|fwd?:)\s*/i, '').replace(/\?$/, '') || 'Meeting') , start: slot.toISOString(), end: end.toISOString(), attendees: [m.email], description: 'Booked by Gizmo from your email with ' + m.from + '.' }, m.from + ' asked to meet. ' + fmtDay(slot) + ' at ' + fmtTime(slot) + ' is free in your calendar.', opt);
          const body = await write('Write a reply to ' + m.from + ' accepting their meeting request and confirming ' + fmtDay(slot) + ' at ' + fmtTime(slot) + '. Their email: "' + m.preview + '"',
            'Hi ' + first(m.from) + ',\n\nThanks for reaching out. ' + fmtDay(slot) + ' at ' + fmtTime(slot) + ' works for me, and I’ve sent you a calendar invite.' + sign());
          await call(run, 'send_email', { to: m.email, subject: 'Re: ' + m.subject, body, reply_to_id: m.id }, 'Confirms the time with ' + m.from + '.', opt);
          booked++; replies++; continue;
        }
        if (kind === 'urgent') {
          urgent.push(m);
          const by = new Date(); by.setHours(Math.min(17, by.getHours() + 3), 0, 0, 0);
          const body = await write('Write a brief holding reply to this urgent email, saying I’ve seen it and will update them by ' + fmtTime(by) + ' today. Email from ' + m.from + ': "' + m.preview + '"',
            'Hi ' + first(m.from) + ',\n\nI’ve seen this and I’m on it. I’ll update you by ' + fmtTime(by) + ' today.' + sign());
          await call(run, 'send_email', { to: m.email, subject: 'Re: ' + m.subject, body, reply_to_id: m.id }, 'Urgent: a quick holding reply so ' + first(m.from) + ' knows you’re on it.', opt);
          replies++; continue;
        }
        if (kind === 'question') {
          const found = answerLocally(G.sources(), m.subject + ' ' + m.preview);
          const fb = 'Hi ' + first(m.from) + ',\n\nThanks for the question. ' + (found ? 'From my notes: ' + trim(found.text, 280) + '\n\nI’ll double-check and confirm.' : 'I’ll look into it and come back to you by tomorrow.') + sign();
          const body = await write('Write a reply to this question. Only answer if these notes clearly answer it, otherwise say I’ll find out and reply by tomorrow. Notes: "' + (found ? found.text : 'none') + '". Email from ' + m.from + ': "' + m.preview + '"', fb);
          await call(run, 'send_email', { to: m.email, subject: 'Re: ' + m.subject, body, reply_to_id: m.id }, first(m.from) + ' asked a question.', opt);
          replies++; continue;
        }
        await call(run, 'mark_email_read', { id: m.id }); filed++;
      }
      const parts = [];
      if (booked) parts.push(booked + ' meeting' + (booked > 1 ? 's' : '') + ' to book');
      if (replies) parts.push(replies + ' repl' + (replies > 1 ? 'ies' : 'y') + ' drafted');
      if (filed) parts.push(filed + ' filed');
      return 'Inbox done: ' + parts.join(', ') + '.' + (urgent.length ? ' Urgent: ' + urgent.map(u => u.from + ' (“' + u.subject + '”)').join('; ') + '.' : '');
    },
  },
  briefing: {
    label: 'Plan my day', icon: 'sun', desc: 'Today’s meetings, what needs a reply, projects to move and study cards due.',
    async run(run) {
      const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s.getTime() + 864e5);
      const evs = await call(run, 'list_events', { from: s.toISOString(), to: e.toISOString() });
      const unread = await call(run, 'list_unread_email', { limit: 20 }).catch(() => []);
      const urgent = unread.filter(m => classify({ subject: m.subject, body: m.preview, email: m.email }) === 'urgent');
      const open = G.state.proj.filter(p => p.pct < 100).sort((a, b) => b.pct - a.pct);
      const due = G.sources().reduce((n, src) => n + dueCards(src).length, 0);
      const lines = [];
      lines.push(evs.length ? 'You have ' + evs.length + ' meeting' + (evs.length > 1 ? 's' : '') + ': ' + evs.map(x => x.title + ' at ' + fmtTime(x.start)).join(', ') + '.' : 'No meetings today.');
      lines.push(unread.length ? unread.length + ' unread email' + (unread.length > 1 ? 's' : '') + (urgent.length ? ', ' + urgent.length + ' urgent (' + urgent.map(u => u.from).join(', ') + ')' : '') + '.' : 'Inbox is clear.');
      if (open.length) lines.push('Closest to done: ' + open.slice(0, 2).map(p => p.name + ' at ' + p.pct + '%' + (p.note ? ', next: ' + p.note.charAt(0).toLowerCase() + p.note.slice(1) : '')).join('; ') + '.');
      if (due) lines.push(due + ' study card' + (due > 1 ? 's are' : ' is') + ' due for review.');
      return lines.join(' ');
    },
  },
  slack: {
    label: 'Catch up on Slack', icon: 'hash', desc: 'Finds messages that mention you and drafts replies for your OK.',
    async run(run, args, opt) {
      const chans = await call(run, 'read_slack', {});
      let mentions = [];
      for (const c of chans.slice(0, 8)) { const msgs = await call(run, 'read_slack', { channel: c }).catch(() => []); msgs.filter(m => m.mention && !m.mine).slice(-3).forEach(m => mentions.push({ ...m, channel: c })); }
      step(run, 'Checked ' + chans.length + ' channel' + (chans.length === 1 ? '' : 's') + ', found ' + mentions.length + ' mention' + (mentions.length === 1 ? '' : 's') + '.');
      for (const m of mentions) {
        const text = await write('Write a short Slack reply (one or two sentences, friendly) to ' + m.user + ' who wrote: "' + m.text + '". Say I’ll get it done today, and be specific.', 'On it, ' + first(m.user) + '. I’ll get back to you on this today.');
        await call(run, 'post_slack', { channel: m.channel, text }, m.user + ' mentioned you in #' + m.channel + ': “' + trim(m.text, 120) + '”', opt);
      }
      return mentions.length ? mentions.length + ' Slack repl' + (mentions.length > 1 ? 'ies' : 'y') + ' ready for your OK.' : 'No Slack mentions waiting.';
    },
  },
  teams: {
    label: 'Catch up on Teams', icon: 'chat', desc: 'Reads Teams chats waiting on you and drafts replies for your OK.',
    async run(run, args, opt) {
      const chats = await call(run, 'read_teams', {});
      const waiting = chats.filter(c => c.messages.length && !c.messages[c.messages.length - 1].mine && !/^You/.test(c.messages[c.messages.length - 1].from));
      step(run, waiting.length + ' Teams chat' + (waiting.length === 1 ? '' : 's') + ' waiting on you.');
      for (const c of waiting.slice(0, 5)) {
        const last = c.messages[c.messages.length - 1];
        const decks = G.state.decks || [];
        const wantsDeck = /\bdeck|slides|presentation\b/i.test(last.text) && decks.length;
        const text = await write('Write a short Teams reply to ' + last.from + ' who wrote: "' + last.text + '".' + (wantsDeck ? ' Mention the deck "' + decks[0].title + '" is ready and attached in Figma/PowerPoint.' : ''),
          wantsDeck ? 'Hi ' + first(last.from) + ', the deck “' + decks[0].title + '” is ready. I’ll send the file over now.' : 'Hi ' + first(last.from) + ', thanks. I’ll come back to you on this shortly.');
        await call(run, 'post_teams', { chat: c.id, chatName: c.chat, text }, last.from + ' wrote: “' + trim(last.text, 120) + '”', opt);
      }
      return waiting.length ? waiting.length + ' Teams repl' + (waiting.length > 1 ? 'ies' : 'y') + ' ready for your OK.' : 'Nothing waiting in Teams.';
    },
  },
  meeting: {
    label: 'Set up a meeting', icon: 'cal', desc: 'Finds a free slot and books it. Invites need your OK.',
    async run(run, args, opt) {
      const text = args.text || '';
      const w = parseWhen(text) || { start: new Date(Date.now() + 864e5), minutes: 30, timeGiven: false };
      if (!w.timeGiven) w.start.setHours(10, 0, 0, 0);
      const people = args.attendees || resolvePeople(text);
      const topic = (text.match(/\b(?:about|to discuss|re|on the subject of|regarding)\s+(.+?)(?:\s+(?:on|at|tomorrow|today|next|for)\b|[.?!]|$)/i) || [])[1];
      const slot = w.timeGiven ? w.start : await freeSlot(w.start, w.minutes);
      const end = new Date(slot.getTime() + w.minutes * 6e4);
      const title = args.title || (topic ? titleCase(topic) : 'Catch-up') + (people.length ? ' with ' + people.map(p => first(contacts().find(c => c.email === p)?.name || p)).join(' & ') : '');
      const r = await call(run, 'create_event', { title, start: slot.toISOString(), end: end.toISOString(), attendees: people, description: topic ? 'Topic: ' + topic : '', online: true }, w.timeGiven ? 'At the time you asked for.' : 'First free slot in your calendar.', opt);
      return (r && r.queued ? 'Ready to book “' + title + '” for ' + fmtDay(slot) + ' at ' + fmtTime(slot) + '. It needs your OK because it sends invites.' : 'Booked “' + title + '” for ' + fmtDay(slot) + ' at ' + fmtTime(slot) + '.');
    },
  },
  deck: {
    label: 'Build a deck in Figma', icon: 'deck', desc: 'Writes a presentation from your sources, ready for Figma and PowerPoint.',
    async run(run, args, opt) {
      const topic = args.topic || 'Presentation';
      let deck = null;
      if (mode('ai') === 'live') {
        const passages = search(G.sources(), topic, 8).map(h => '[' + h.src.title + '] ' + trim(h.c, 700)).join('\n\n');
        try {
          const j = await claude({ system: 'You write clear, concise presentation decks. Respond only with JSON.', max_tokens: 2500,
            messages: [{ role: 'user', content: 'Write a 7 to 9 slide deck about "' + topic + '". Use these source passages where relevant:\n\n' + (passages || '(no sources)') + '\n\nReturn JSON: {"title": string, "slides": [{"layout": "title"|"agenda"|"bullets"|"end", "title": string, "bullets": [string, up to 4, each under 14 words], "notes": string}]}. Start with a title slide and end with an end slide.' }] });
          const raw = textOf(j).replace(/^```(json)?|```$/g, '').trim();
          const d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
          if (d && Array.isArray(d.slides) && d.slides.length) deck = { title: d.title || topic, slides: d.slides.map(s => ({ layout: s.layout || 'bullets', title: s.title || '', bullets: (s.bullets || []).slice(0, 5), notes: s.notes || '' })), created: Date.now(), from: [] };
        } catch (e) { step(run, 'Claude couldn’t write it (' + e.message + '), so I built it from your sources.', 'info'); }
      }
      if (!deck) deck = /weekly|week/i.test(topic) ? deckFromWeek({ projects: G.state.proj, runs: G.state.runs, decks: G.state.decks, sources: G.sources() }) : deckFromSources(topic, pickSources(topic));
      G.saveDeck(deck);
      step(run, 'Built “' + deck.title + '”, ' + deck.slides.length + ' slides.', 'done');
      if (mode('figma') === 'live') await call(run, 'figma_comment', { message: 'Gizmo: the deck “' + deck.title + '” (' + deck.slides.length + ' slides) is ready. Run the Gizmo Deck Builder plugin and paste it from Gizmo to place the slides.' }, 'Lets your Figma collaborators know the deck is coming.', opt);
      return 'Deck “' + deck.title + '” is ready with ' + deck.slides.length + ' slides. Open Decks to send it to Figma or download it as PowerPoint.';
    },
  },
  study: {
    label: 'Study session', icon: 'book', desc: 'Lines up the cards due today across your library.',
    async run(run) {
      const srcs = G.sources(); const due = srcs.map(s => ({ s, n: dueCards(s).length })).filter(x => x.n);
      const total = due.reduce((m, x) => m + x.n, 0);
      if (!srcs.length) return 'Your study library is empty. Add a book, article or essay in Study.';
      return total ? total + ' card' + (total > 1 ? 's' : '') + ' due: ' + due.map(x => x.s.title + ' (' + x.n + ')').join(', ') + '. Open Study and press Review.' : 'Nothing due. Your library is up to date.';
    },
  },
  weekly: {
    label: 'Weekly wrap-up', icon: 'chart', desc: 'Builds a weekly update deck from your projects and posts a summary to Slack.',
    async run(run, args, opt) {
      const deck = deckFromWeek({ projects: G.state.proj, runs: G.state.runs, decks: G.state.decks, sources: G.sources() });
      G.saveDeck(deck); step(run, 'Built “' + deck.title + '”.', 'done');
      const open = G.state.proj.filter(p => p.pct < 100);
      const text = 'Weekly update from Gizmo: ' + open.length + ' projects in progress. ' + open.slice(0, 3).map(p => p.name + ' ' + p.pct + '%').join(', ') + '. Deck: “' + deck.title + '”.';
      await call(run, 'post_slack', { channel: args.channel || 'general', text }, 'Shares your weekly update with the team.', opt);
      return 'Weekly update deck built, and a Slack summary is ready.';
    },
  },
};
const titleCase = s => s.replace(/\b([a-z])/g, (m, c) => c.toUpperCase());

// ================= RUN A TASK =================
export async function runSkill(key, args = {}, origin = 'task', opt = {}) {
  const sk = SKILLS[key]; if (!sk) throw new Error('No skill ' + key);
  const run = newRun(args.title || sk.label + (args.topic ? ': ' + args.topic : ''), origin);
  try {
    const res = await sk.run(run, args, opt);
    finish(run, res);
    return { run, text: res };
  } catch (e) {
    finish(run, e.message, e.needsUser ? 'needs-ok' : 'failed');
    step(run, e.message, 'error');
    return { run, text: e.needsUser ? e.message : 'That didn’t work: ' + e.message, error: e };
  }
}

// Claude-powered: plan and act with tools until the goal is done
export async function runAgent(goal, origin = 'task', opt = {}, history = []) {
  const run = newRun(trim(goal, 80), origin);
  const now = new Date();
  const system = 'You are Gizmo, a personal AI helper that completes tasks for the user autonomously using tools. ' +
    'Today is ' + now.toLocaleString() + ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + '). ' + (me() ? 'The user is ' + me() + '. ' : '') +
    'Work step by step: gather what you need with read tools, then act. Do not ask the user questions you can answer with tools. ' +
    'Actions that other people will see (sending email, posting messages, inviting people) may be queued for the user’s approval: when a tool says it was queued, treat it as handled and move on. ' +
    'Finish with a short plain-English summary of what you did and anything waiting for approval. No markdown headings.';
  const tools = TOOLS.map(t => ({ name: t.name, description: t.desc, input_schema: t.schema }));
  const messages = history.concat([{ role: 'user', content: goal }]);
  try {
    for (let i = 0; i < 10; i++) {
      const j = await claude({ system, messages, tools, max_tokens: 1800 });
      messages.push({ role: 'assistant', content: j.content });
      const uses = (j.content || []).filter(b => b.type === 'tool_use');
      const said = textOf(j);
      if (!uses.length || j.stop_reason !== 'tool_use') { finish(run, said || 'Done.'); return { run, text: said || 'Done.' }; }
      if (said) step(run, trim(said, 200));
      const results = [];
      for (const u of uses) {
        let out;
        try { out = await call(run, u.name, u.input || {}, said ? trim(said, 160) : '', opt); }
        catch (e) { out = { error: e.message }; step(run, (TOOL[u.name] ? TOOL[u.name].label : u.name) + ': ' + e.message, 'error'); }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: trim(typeof out === 'string' ? out : JSON.stringify(out), 6000) });
      }
      messages.push({ role: 'user', content: results });
    }
    finish(run, 'Stopped after 10 steps.'); return { run, text: 'I stopped after 10 steps. Check Tasks for what I did.' };
  } catch (e) { finish(run, e.message, 'failed'); step(run, e.message, 'error'); return { run, text: 'That didn’t work: ' + e.message, error: e }; }
}

// map plain-English requests to skills (works without Claude)
export function intent(text) {
  const s = text.toLowerCase();
  if (/\b(check|triage|go through|sort( out)?|clear|handle|deal with|reply to|answer)\b.*\b(e-?mails?|inbox|mail)\b|\b(e-?mails?|inbox)\b.*\b(check|triage|sort|clear|handle)\b/.test(s)) return { skill: 'triage' };
  if (/\b(plan|brief(ing)?)\b.*\b(day|today|morning)\b|what('s| is) on (today|my calendar)|\bmy day\b|daily briefing/.test(s)) return { skill: 'briefing' };
  if (/\b(set up|schedule|book|arrange|organi[sz]e|put in)\b.*\b(meeting|call|catch[ -]?up|sync|1:1|one to one|chat)\b/.test(s)) return { skill: 'meeting', args: { text } };
  if (/\b(make|build|create|design|put together|prepare|draft)\b.*\b(deck|presentation|slides|slide deck)\b/.test(s)) {
    const t = (text.match(/\b(?:about|on|for|covering|from)\s+(.+?)(?:\s+in figma)?[.?!]*$/i) || [])[1];
    return { skill: /weekly/.test(s) ? 'weekly' : 'deck', args: { topic: t ? t.replace(/\s+in figma$/i, '') : (/weekly/.test(s) ? 'Weekly update' : '') } };
  }
  if (/\bslack\b/.test(s) && /\b(catch up|check|messages|mentions|reply|replies|what did i miss)\b/.test(s)) return { skill: 'slack' };
  if (/\bteams\b/.test(s) && /\b(catch up|check|messages|chats|reply|replies)\b/.test(s)) return { skill: 'teams' };
  if (/\b(weekly (wrap|update|summary|report))\b/.test(s)) return { skill: 'weekly' };
  if (/\b(study session|what('s| is) due|review my cards)\b/.test(s)) return { skill: 'study' };
  return null;
}

// ================= ROUTINES =================
export function describeSchedule(r) {
  const d = r.schedule, t = d.time;
  const tm = new Date(2000, 0, 1, +t.slice(0, 2), +t.slice(3, 5)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.freq === 'daily') return 'Every day at ' + tm;
  if (d.freq === 'weekdays') return 'Weekdays at ' + tm;
  const names = (d.days || []).map(i => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]);
  return 'Every ' + (names.join(', ') || 'week') + ' at ' + tm;
}
export function nextRun(r, after = new Date()) {
  const d = r.schedule, [h, m] = d.time.split(':').map(Number);
  for (let i = 0; i < 15; i++) {
    const c = new Date(after); c.setDate(c.getDate() + i); c.setHours(h, m, 0, 0);
    if (c <= after) continue;
    const dow = c.getDay();
    if (d.freq === 'weekdays' && (dow === 0 || dow === 6)) continue;
    if (d.freq === 'weekly' && !(d.days || []).includes(dow)) continue;
    return c.getTime();
  }
  return null;
}
export async function runRoutine(r, why = 'scheduled') {
  r.lastRun = Date.now(); r.nextRun = nextRun(r, new Date()); G.save();
  const opt = { autoCritical: !!r.autoCritical };
  let res;
  if (r.skill && r.skill !== 'custom') res = await runSkill(r.skill, { ...(r.args || {}), title: r.name }, 'routine', opt);
  else if (mode('ai') === 'live') res = await runAgent(r.instruction, 'routine', opt);
  else {
    const it = intent(r.instruction || '');
    res = it ? await runSkill(it.skill, { ...(it.args || {}), title: r.name }, 'routine', opt) : (() => { const run = newRun(r.name, 'routine'); finish(run, 'This routine needs the AI brain. Add a Claude key in Tools.', 'failed'); return { run, text: run.result }; })();
  }
  r.lastResult = res.text; G.save(); G.log();
  G.notify(r.name, trim(res.text, 140));
  return res;
}
let ticking = false;
export function startScheduler() {
  const tick = async () => {
    if (ticking || !G.state.autopilot) return; ticking = true;
    try {
      const now = Date.now();
      for (const r of G.state.routines) {
        if (!r.enabled) continue;
        if (!r.nextRun) { r.nextRun = nextRun(r, new Date(r.created || now)); G.save(); }
        if (r.nextRun && r.nextRun <= now) {
          const late = now - r.nextRun > 15 * 6e4;
          await runRoutine(r, late ? 'catch-up' : 'scheduled');
        }
      }
    } finally { ticking = false; }
  };
  setTimeout(tick, 2500);
  setInterval(tick, 30000);
}
