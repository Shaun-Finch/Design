// Connectors: the apps Gizmo can use. Each one works in Demo mode (a built-in sandbox, so anyone can try Gizmo)
// or Live mode (your real account, signed in from this browser). Keys and tokens are stored only in this browser.

const base = new URL('.', import.meta.url).href;
export const AUTH_REDIRECT = new URL('auth.html', base).href;

function loadScript(src, globalName) {
  return new Promise((res, rej) => {
    if (globalName && window[globalName]) return res(window[globalName]);
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(globalName ? window[globalName] : true);
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
export class NeedsUser extends Error { constructor(m, service) { super(m); this.needsUser = true; this.service = service; } }

let ST = null, SAVE = () => {};
export function bindState(state, save) { ST = state; SAVE = save; }

// ---------- dates ----------
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const at = (d, h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- demo sandbox ----------
const PEOPLE = [
  { name: 'Priya Shah', email: 'priya@brightwater.example', role: 'Product lead' },
  { name: 'Tom Reid', email: 'tom@brightwater.example', role: 'Engineer' },
  { name: 'Maya Okafor', email: 'maya@harbourlight.example', role: 'Client, Harbourlight' },
  { name: 'Leo Martins', email: 'leo@brightwater.example', role: 'Designer' },
  { name: 'Sam Patel', email: 'sam@brightwater.example', role: 'Marketing' },
];
export function demoSeed() {
  return {
    inbox: [], sent: [], drafts: [], events: {}, slack: { general: [], design: [], 'client-harbourlight': [] }, teams: [], figmaComments: [], automations: [], seededDays: {},
    contacts: PEOPLE.slice(),
  };
}
function sandbox() {
  if (!ST.sandbox) ST.sandbox = demoSeed();
  const sb = ST.sandbox, today = ymd(new Date());
  if (!sb.seededDays[today]) { sb.seededDays[today] = true; seedDay(sb, new Date()); SAVE(); }
  return sb;
}
function seedDay(sb, d) {
  const day = ymd(d), r = hash(day), t = Date.now();
  const mails = [
    { from: PEOPLE[0], subject: 'Can we meet about the onboarding redesign?', body: 'Hi! Are you free for 30 minutes tomorrow afternoon to go through the onboarding redesign? Any time after 2pm works for me. Thanks, Priya' },
    { from: PEOPLE[2], subject: 'Urgent: launch assets needed today', body: 'Hello, we need the final launch assets by end of day today, otherwise we miss the print deadline. Can you confirm? Many thanks, Maya' },
    { from: PEOPLE[1], subject: 'Quick question on the API limits', body: 'Hey, quick one: do we know if the export endpoint has a rate limit? I want to plan the batch job. Cheers, Tom' },
    { from: { name: 'Design Weekly', email: 'newsletter@designweekly.example' }, subject: 'This week: 12 type pairings we love', body: 'Our favourite font pairings this week, plus a new grid tool. Unsubscribe any time.' },
    { from: PEOPLE[4], subject: 'Campaign figures for the weekly update', body: 'FYI: sign-ups are up 18% week on week and the email open rate is 41%. Could be useful for the weekly deck. Sam' },
  ];
  const pick = (r % 2) ? [0, 1, 2, 3, 4] : [1, 0, 3, 2, 4];
  pick.forEach((i, k) => sb.inbox.unshift({ id: 'm' + day + i, from: mails[i].from.name, email: mails[i].from.email, subject: mails[i].subject, body: mails[i].body, date: new Date(t - (k + 1) * 47 * 60000).toISOString(), unread: true, day }));
  const dow = d.getDay();
  if (dow > 0 && dow < 6) {
    sb.events[day] = [
      { id: 'e' + day + 'a', title: 'Team stand-up', start: at(d, 9, 30).toISOString(), end: at(d, 9, 45).toISOString(), attendees: ['priya@brightwater.example', 'tom@brightwater.example', 'leo@brightwater.example'] },
      { id: 'e' + day + 'b', title: 'Design review: checkout flow', start: at(d, 11, 0).toISOString(), end: at(d, 12, 0).toISOString(), attendees: ['leo@brightwater.example'] },
      { id: 'e' + day + 'c', title: 'Client call: Harbourlight', start: at(d, 15, 0).toISOString(), end: at(d, 15, 30).toISOString(), attendees: ['maya@harbourlight.example'] },
    ];
  }
  const ts = t - 3600e3;
  sb.slack.design.push({ id: 's' + day + '1', user: 'Leo Martins', text: '@you can you take a look at the new icon set before 4pm? Link is in the brief.', ts: new Date(ts).toISOString(), mention: true });
  sb.slack.general.push({ id: 's' + day + '2', user: 'Sam Patel', text: 'Reminder: weekly update deck is due Friday. Drop your numbers in the thread.', ts: new Date(ts + 6e5).toISOString() });
  sb.slack['client-harbourlight'].push({ id: 's' + day + '3', user: 'Maya Okafor', text: '@you any update on the launch assets?', ts: new Date(ts + 9e5).toISOString(), mention: true });
  sb.teams.unshift({ id: 't' + day, chat: 'Priya Shah', messages: [{ from: 'Priya Shah', text: 'Morning! Could you send me the latest deck when it’s ready?', ts: new Date(ts + 12e5).toISOString() }] });
  for (const k of Object.keys(sb.slack)) sb.slack[k] = sb.slack[k].slice(-30);
  sb.inbox = sb.inbox.slice(0, 40); sb.teams = sb.teams.slice(0, 10);
}
export function resetDemo() { ST.sandbox = demoSeed(); sandbox(); SAVE(); }
export function contacts() { const sb = sandbox(); return (ST.contacts && ST.contacts.length ? ST.contacts : []).concat(sb.contacts); }

// ---------- config helpers ----------
const cfg = k => (ST.connect && ST.connect[k]) || {};
export function mode(service) {
  const c = ST.connect || {};
  if (service === 'mail' || service === 'calendar') { const p = c.provider || 'demo'; return p === 'google' && c.google && c.google.clientId ? 'google' : p === 'microsoft' && c.microsoft && c.microsoft.clientId ? 'microsoft' : 'demo'; }
  if (service === 'slack') return c.slack && (c.slack.token || c.slack.webhook) ? 'live' : 'demo';
  if (service === 'teams') return (c.provider === 'microsoft' && c.microsoft && c.microsoft.clientId) ? 'microsoft' : 'demo';
  if (service === 'figma') return c.figma && c.figma.token ? 'live' : 'demo';
  if (service === 'ai') return c.claude && c.claude.key ? 'live' : 'off';
  return 'demo';
}

// ---------- Google (Gmail + Calendar), via Google Identity Services ----------
const G_SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events openid email';
export async function googleToken(interactive) {
  const c = cfg('google');
  if (!c.clientId) throw new NeedsUser('Add your Google client ID in Tools first.', 'google');
  if (c.token && c.exp > Date.now() + 60e3) return c.token;
  if (!interactive) throw new NeedsUser('Google sign-in has expired. Open Tools and press Connect.', 'google');
  await loadScript('https://accounts.google.com/gsi/client', null);
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: c.clientId, scope: G_SCOPES,
      callback: r => { if (r.error) return rej(new Error('Google: ' + r.error)); c.token = r.access_token; c.exp = Date.now() + (r.expires_in || 3600) * 1000; SAVE(); res(c.token); },
      error_callback: e => rej(new Error('Google sign-in was closed (' + (e && e.type || 'popup') + ').')),
    });
    client.requestAccessToken({ prompt: c.token ? '' : 'consent' });
  });
}
async function gfetch(url, opt = {}) {
  const tok = await googleToken(opt.interactive);
  const r = await fetch(url, { method: opt.method || 'GET', headers: { Authorization: 'Bearer ' + tok, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  if (r.status === 401) { cfg('google').exp = 0; SAVE(); throw new NeedsUser('Google sign-in has expired. Open Tools and press Connect.', 'google'); }
  const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google: ' + ((j.error && j.error.message) || r.status));
  return j;
}
function b64url(str) { const b = new TextEncoder().encode(str); let s = ''; b.forEach(x => s += String.fromCharCode(x)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function encHeader(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?='; }
function mime({ to, subject, body, inReplyTo }) {
  return ['To: ' + to, 'Subject: ' + encHeader(subject), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit',
    ...(inReplyTo ? ['In-Reply-To: ' + inReplyTo, 'References: ' + inReplyTo] : []), '', body].join('\r\n');
}
const hdr = (m, n) => ((m.payload && m.payload.headers) || []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';

// ---------- Microsoft 365 (Outlook, Calendar, Teams), via MSAL ----------
const MS_SCOPES = ['User.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite', 'Chat.ReadWrite', 'ChannelMessage.Send', 'Team.ReadBasic.All', 'Channel.ReadBasic.All'];
let pca = null;
async function msal() {
  const c = cfg('microsoft');
  if (!c.clientId) throw new NeedsUser('Add your Microsoft app (client) ID in Tools first.', 'microsoft');
  if (pca) return pca;
  const M = await loadScript(base + 'lib/msal-browser.min.js', 'msal');
  pca = new M.PublicClientApplication({ auth: { clientId: c.clientId, authority: 'https://login.microsoftonline.com/' + (c.tenant || 'common'), redirectUri: AUTH_REDIRECT }, cache: { cacheLocation: 'localStorage' } });
  await pca.initialize();
  return pca;
}
export async function msToken(interactive) {
  const p = await msal();
  let acc = p.getActiveAccount() || p.getAllAccounts()[0];
  if (!acc) {
    if (!interactive) throw new NeedsUser('Sign in to Microsoft 365 in Tools.', 'microsoft');
    const r = await p.loginPopup({ scopes: MS_SCOPES }); acc = r.account;
  }
  p.setActiveAccount(acc);
  try { return (await p.acquireTokenSilent({ scopes: MS_SCOPES, account: acc })).accessToken; }
  catch (e) {
    if (!interactive) throw new NeedsUser('Microsoft sign-in needs refreshing. Open Tools and press Connect.', 'microsoft');
    return (await p.acquireTokenPopup({ scopes: MS_SCOPES })).accessToken;
  }
}
async function graph(path, opt = {}) {
  const tok = await msToken(opt.interactive);
  const r = await fetch('https://graph.microsoft.com/v1.0' + path, { method: opt.method || 'GET', headers: { Authorization: 'Bearer ' + tok, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = r.status === 202 || r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Microsoft: ' + ((j.error && j.error.message) || r.status));
  return j;
}
const htmlToText = h => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };

// ================= MAIL =================
export const mail = {
  async listUnread(n = 10) {
    const m = mode('mail');
    if (m === 'google') {
      const l = await gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + n + '&q=' + encodeURIComponent('is:unread in:inbox'));
      const out = [];
      for (const x of (l.messages || [])) {
        const g = await gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + x.id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID');
        const from = hdr(g, 'From'), em = (from.match(/<([^>]+)>/) || [, from])[1];
        out.push({ id: g.id, threadId: g.threadId, from: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || em, email: em, subject: hdr(g, 'Subject'), body: g.snippet || '', date: new Date(+g.internalDate).toISOString(), msgId: hdr(g, 'Message-ID') });
      }
      return out;
    }
    if (m === 'microsoft') {
      const j = await graph('/me/mailFolders/inbox/messages?$top=' + n + '&$filter=isRead%20eq%20false&$select=id,subject,from,bodyPreview,receivedDateTime');
      return (j.value || []).map(x => ({ id: x.id, from: x.from?.emailAddress?.name || '', email: x.from?.emailAddress?.address || '', subject: x.subject || '', body: x.bodyPreview || '', date: x.receivedDateTime }));
    }
    return sandbox().inbox.filter(x => x.unread).slice(0, n);
  },
  async markRead(id) {
    const m = mode('mail');
    if (m === 'google') return gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '/modify', { method: 'POST', body: { removeLabelIds: ['UNREAD'] } });
    if (m === 'microsoft') return graph('/me/messages/' + id, { method: 'PATCH', body: { isRead: true } });
    const x = sandbox().inbox.find(x => x.id === id); if (x) { x.unread = false; SAVE(); }
  },
  async send({ to, subject, body, replyTo }) {
    const m = mode('mail');
    if (m === 'google') {
      const raw = b64url(mime({ to, subject, body, inReplyTo: replyTo && replyTo.msgId }));
      return gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw, ...(replyTo && replyTo.threadId ? { threadId: replyTo.threadId } : {}) } });
    }
    if (m === 'microsoft') {
      if (replyTo && replyTo.id) return graph('/me/messages/' + replyTo.id + '/reply', { method: 'POST', body: { comment: body } });
      return graph('/me/sendMail', { method: 'POST', body: { message: { subject, body: { contentType: 'Text', content: body }, toRecipients: to.split(/[,;]\s*/).map(a => ({ emailAddress: { address: a } })) }, saveToSentItems: true } });
    }
    const sb = sandbox(); sb.sent.unshift({ to, subject, body, date: new Date().toISOString() }); sb.sent = sb.sent.slice(0, 50); SAVE(); return { ok: true };
  },
  async draft({ to, subject, body }) {
    const m = mode('mail');
    if (m === 'google') return gfetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: { message: { raw: b64url(mime({ to, subject, body })) } } });
    if (m === 'microsoft') return graph('/me/messages', { method: 'POST', body: { subject, body: { contentType: 'Text', content: body }, toRecipients: to.split(/[,;]\s*/).map(a => ({ emailAddress: { address: a } })) } });
    const sb = sandbox(); sb.drafts.unshift({ to, subject, body, date: new Date().toISOString() }); sb.drafts = sb.drafts.slice(0, 50); SAVE(); return { ok: true };
  },
};

// ================= CALENDAR =================
export const calendar = {
  async list(from, to) {
    const m = mode('calendar');
    if (m === 'google') {
      const j = await gfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=' + encodeURIComponent(from.toISOString()) + '&timeMax=' + encodeURIComponent(to.toISOString()));
      return (j.items || []).map(e => ({ id: e.id, title: e.summary || '(no title)', start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date, attendees: (e.attendees || []).map(a => a.email) }));
    }
    if (m === 'microsoft') {
      const j = await graph('/me/calendarView?$top=50&$orderby=start/dateTime&startDateTime=' + encodeURIComponent(from.toISOString()) + '&endDateTime=' + encodeURIComponent(to.toISOString()));
      return (j.value || []).map(e => ({ id: e.id, title: e.subject, start: e.start.dateTime + 'Z', end: e.end.dateTime + 'Z', attendees: (e.attendees || []).map(a => a.emailAddress.address) }));
    }
    const sb = sandbox(), out = [];
    for (let d = new Date(from); d < to; d = new Date(d.getTime() + 864e5)) {
      const k = ymd(d);
      if (!sb.events[k] && d.getDay() > 0 && d.getDay() < 6 && d > new Date(Date.now() - 864e5)) { seedEventsOnly(sb, d); }
      (sb.events[k] || []).forEach(e => { if (new Date(e.end) > from && new Date(e.start) < to) out.push(e); });
    }
    return out.sort((a, b) => new Date(a.start) - new Date(b.start));
  },
  async create({ title, start, end, attendees = [], description = '', online = false }) {
    const m = mode('calendar'), tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (m === 'google') {
      return gfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all' + (online ? '&conferenceDataVersion=1' : ''), { method: 'POST', body: {
        summary: title, description, start: { dateTime: new Date(start).toISOString(), timeZone: tz }, end: { dateTime: new Date(end).toISOString(), timeZone: tz },
        attendees: attendees.map(email => ({ email })), ...(online ? { conferenceData: { createRequest: { requestId: 'gz' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}) } });
    }
    if (m === 'microsoft') {
      return graph('/me/events', { method: 'POST', body: { subject: title, body: { contentType: 'Text', content: description },
        start: { dateTime: new Date(start).toISOString().replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: new Date(end).toISOString().replace('Z', ''), timeZone: 'UTC' },
        attendees: attendees.map(a => ({ emailAddress: { address: a }, type: 'required' })), ...(online ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}) } });
    }
    const sb = sandbox(), k = ymd(new Date(start));
    (sb.events[k] = sb.events[k] || []).push({ id: 'e' + Date.now(), title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), attendees, description, created: true });
    SAVE(); return { ok: true };
  },
};
function seedEventsOnly(sb, d) {
  const k = ymd(d);
  sb.events[k] = [
    { id: 'e' + k + 'a', title: 'Team stand-up', start: at(d, 9, 30).toISOString(), end: at(d, 9, 45).toISOString(), attendees: [] },
    { id: 'e' + k + 'b', title: (hash(k) % 2 ? 'Roadmap planning' : 'Sprint review'), start: at(d, 13, 0).toISOString(), end: at(d, 14, 0).toISOString(), attendees: [] },
  ];
}

// ================= SLACK =================
async function slackApi(method, params) {
  const c = cfg('slack');
  if (!c.token) throw new Error('Slack reading needs a token. A webhook can only post.');
  let r;
  try { r = await fetch('https://slack.com/api/' + method, { method: 'POST', body: new URLSearchParams({ token: c.token, ...params }) }); }
  catch (e) { throw new Error('Slack blocked the request from this browser. Posting still works through an incoming webhook.'); }
  const j = await r.json();
  if (!j.ok) throw new Error('Slack: ' + j.error);
  return j;
}
export const slack = {
  async channels() {
    if (mode('slack') === 'demo') return Object.keys(sandbox().slack);
    const j = await slackApi('conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '100' });
    return j.channels.filter(c => c.is_member).map(c => c.name);
  },
  async recent(channel, n = 15) {
    if (mode('slack') === 'demo') return (sandbox().slack[channel] || []).slice(-n);
    const list = await slackApi('conversations.list', { types: 'public_channel,private_channel', limit: '200' });
    const ch = list.channels.find(c => c.name === channel.replace(/^#/, '')); if (!ch) throw new Error('No Slack channel called #' + channel);
    const h = await slackApi('conversations.history', { channel: ch.id, limit: String(n) });
    const me = cfg('slack').userId;
    return h.messages.reverse().map(m => ({ id: m.ts, user: m.user, text: m.text, ts: new Date(+m.ts * 1000).toISOString(), mention: me ? m.text.includes('<@' + me + '>') : /<@/.test(m.text) }));
  },
  async post(channel, text) {
    const c = cfg('slack');
    if (mode('slack') === 'demo') { const sb = sandbox(); (sb.slack[channel.replace(/^#/, '')] = sb.slack[channel.replace(/^#/, '')] || []).push({ id: 's' + Date.now(), user: 'You (sent by Gizmo)', text, ts: new Date().toISOString(), mine: true }); SAVE(); return { ok: true }; }
    if (c.token) {
      try {
        const list = await slackApi('conversations.list', { types: 'public_channel,private_channel', limit: '200' });
        const ch = list.channels.find(x => x.name === channel.replace(/^#/, ''));
        return await slackApi('chat.postMessage', { channel: ch ? ch.id : channel, text });
      } catch (e) { if (!c.webhook) throw e; }
    }
    // incoming webhook: the browser can send but cannot read Slack's reply
    await fetch(c.webhook, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ text: (channel ? '[#' + channel.replace(/^#/, '') + '] ' : '') + text }) });
    return { ok: true, note: 'Sent through your Slack webhook.' };
  },
};

// ================= TEAMS =================
export const teams = {
  async chats(n = 10) {
    if (mode('teams') === 'demo') return sandbox().teams.slice(0, n);
    const j = await graph('/me/chats?$top=' + n + '&$expand=members');
    const out = [];
    for (const c of (j.value || [])) {
      const msgs = await graph('/chats/' + c.id + '/messages?$top=5');
      out.push({ id: c.id, chat: c.topic || (c.members || []).map(m => m.displayName).filter(Boolean).join(', '), messages: (msgs.value || []).filter(m => m.messageType === 'message').reverse().map(m => ({ from: m.from?.user?.displayName || '', text: htmlToText(m.body?.content), ts: m.createdDateTime })) });
    }
    return out;
  },
  async post(chatId, text) {
    if (mode('teams') === 'demo') { const c = sandbox().teams.find(x => x.id === chatId || x.chat === chatId); if (!c) throw new Error('No Teams chat called ' + chatId); c.messages.push({ from: 'You (sent by Gizmo)', text, ts: new Date().toISOString(), mine: true }); SAVE(); return { ok: true }; }
    return graph('/chats/' + chatId + '/messages', { method: 'POST', body: { body: { contentType: 'text', content: text } } });
  },
};

// ================= FIGMA =================
export function figmaKey(url) { const m = String(url || '').match(/figma\.com\/(?:file|design|slides|board|proto)\/([A-Za-z0-9]+)/); return m ? m[1] : String(url || '').trim(); }
async function figmaApi(path, opt = {}) {
  const c = cfg('figma');
  let r;
  try { r = await fetch('https://api.figma.com/v1' + path, { method: opt.method || 'GET', headers: { 'X-Figma-Token': c.token, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined }); }
  catch (e) { throw new Error('Figma could not be reached from this browser.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Figma: ' + (j.err || j.message || r.status));
  return j;
}
export const figma = {
  async file(url) {
    if (mode('figma') === 'demo') return { name: 'Q4 Review (demo file)', pages: [{ name: 'Slides', frames: ['Cover', 'Highlights', 'Numbers', 'Next steps'] }] };
    const j = await figmaApi('/files/' + figmaKey(url || cfg('figma').file) + '?depth=2');
    return { name: j.name, pages: (j.document.children || []).map(p => ({ name: p.name, frames: (p.children || []).map(f => f.name).slice(0, 40) })) };
  },
  async comment(url, message) {
    if (mode('figma') === 'demo') { const sb = sandbox(); sb.figmaComments.unshift({ message, date: new Date().toISOString() }); SAVE(); return { ok: true }; }
    return figmaApi('/files/' + figmaKey(url || cfg('figma').file) + '/comments', { method: 'POST', body: { message } });
  },
};

// ================= AUTOMATIONS (Zapier, Make, n8n…) =================
export const automations = {
  list() { return (ST.connect && ST.connect.hooks) || []; },
  async run(name, details) {
    const h = this.list().find(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (!h) { const sb = sandbox(); sb.automations.unshift({ name, details, date: new Date().toISOString() }); SAVE(); return { ok: true, note: 'Demo: no webhook called “' + name + '”, so this was logged in the sandbox.' }; }
    await fetch(h.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ from: 'Gizmo', automation: h.name, details, sentAt: new Date().toISOString() }) });
    return { ok: true, note: 'Sent to ' + h.name + '.' };
  },
};

// ================= CLAUDE (the AI brain) =================
export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
];
export async function claude({ system, messages, tools, max_tokens = 1600 }) {
  const c = cfg('claude');
  if (!c.key) throw new Error('No Claude key yet. Add one in Tools.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: c.model || MODELS[0].id, max_tokens, system, messages, ...(tools && tools.length ? { tools } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Claude: ' + ((j.error && j.error.message) || r.status));
  return j;
}
export const textOf = j => (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
