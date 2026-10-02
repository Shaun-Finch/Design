/* Dailies dashboard: type or paste the round-up, Dailies sorts it into status, sector, task, round, priority and next step. */
(function () {
  var P = window.DailiesParse, KEY = 'dailies.v2';
  var PROMPT = "Write my end-of-day Dailies round-up.\n\nLook back over everything we worked on together today in this conversation and summarise it in the exact format below, so I can paste it straight into my Dailies dashboard.\n\nRULES\n- Keep the field names exactly as written, one per line, in this order.\n- Write one block for each task we worked on today. Start every block with the line DAILIES.\n- Status must be one of: Not started, In progress, In review, Blocked, Done.\n- Priority must be one of: High, Medium, Low.\n- Round is the number of this update for the task: 1 the first time I report on it, then 2, 3 and so on. If you don't know, leave it blank.\n- Next step is the single next action, with a day if we agreed one.\n- Keep each line under 25 words. Be specific: name the file, tool, number or person.\n- Only include what actually happened or was decided today. Don't invent progress.\n- If you don't know my name, sector or a value, leave the square brackets in so I can fill them in.\n- No introduction, no sign-off, no tables, no extra headings.\n\nFORMAT\n\nDAILIES\nName: [your name]\nDate: [today's date as YYYY-MM-DD]\nTask: [the piece of work this update covers]\nSector: [your team or area, e.g. UX/UI, Video, Marketing, Engineering]\nStatus: [Not started / In progress / In review / Blocked / Done]\nPriority: [High / Medium / Low]\nRound: [1, 2, 3…]\nNext step: [the single next action]\nUpdate: [one or two sentences on what happened today]\nBlocker: [what's stopping progress and who it's waiting on, or None]";
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, 2200); }
  var mem = null;
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return mem || {}; } }
  var S = load(); S.entries = S.entries || [];
  function save() { mem = S; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }
  var today = function (d) { var x = new Date(Date.now() - (d || 0) * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  var slug = function (s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); };
  var STATUS_ORDER = { 'Blocked': 0, 'In review': 1, 'In progress': 2, 'Not started': 3, 'Done': 4 }, PRI = { 'High': 0, 'Medium': 1, 'Low': 2 };

  function sample() {
    var mk = function (o, d, h) { return Object.assign({ id: 'x' + Math.random().toString(36).slice(2, 9), sample: true, date: today(d), created: Date.now() - d * 864e5 - (h || 0) * 36e5, blocker: '', raw: '' }, o); };
    return [
      mk({ task: 'Checkout redesign', sector: 'UX/UI', status: 'In progress', priority: 'High', round: 1, next: 'Design the payment step', update: 'Mapped the new checkout flow.', owner: 'Ama Kessie' }, 4),
      mk({ task: 'Checkout redesign', sector: 'UX/UI', status: 'In progress', priority: 'High', round: 2, next: 'Send the prototype for review', update: 'Payment step designed and prototyped.', owner: 'Ama Kessie' }, 2),
      mk({ task: 'Checkout redesign', sector: 'UX/UI', status: 'In review', priority: 'High', round: 3, next: 'Apply Priya’s review notes by Monday', update: 'Prototype sent to Priya for review.', owner: 'Ama Kessie' }, 0, 3),
      mk({ task: 'Design system tokens', sector: 'UX/UI', status: 'Blocked', priority: 'Medium', round: 2, next: 'Ship colour tokens once naming is agreed', update: 'Mapped 40 colour tokens.', blocker: 'Waiting on engineering to agree the naming scheme', owner: 'Leo Martins' }, 0, 5),
      mk({ task: 'Subtitle automation', sector: 'Video', status: 'In progress', priority: 'High', round: 4, next: 'Test on the autumn campaign cut-downs', update: 'Script now handles three languages.', owner: 'Mei Tanaka' }, 1),
      mk({ task: 'Autumn campaign hero film', sector: 'Video', status: 'Done', priority: 'Medium', round: 5, next: 'Archive project files', update: 'Final film signed off and delivered.', owner: 'Mei Tanaka' }, 1, 2),
      mk({ task: 'Onboarding email sequence', sector: 'Marketing', status: 'In progress', priority: 'Medium', round: 2, next: 'Draft the last two emails tomorrow', update: 'Three of five emails written.', owner: 'Sam Patel' }, 0, 2),
      mk({ task: 'Data export batch job', sector: 'Engineering', status: 'Not started', priority: 'Low', round: 1, next: 'Confirm the API rate limit with Tom', update: 'Scoped the job.', owner: 'Tom Reid' }, 0, 6),
    ];
  }

  // ---------- grouping ----------
  function groups() {
    var gs = [];
    S.entries.slice().sort(function (a, b) { return a.created - b.created; }).forEach(function (e) {
      var g = null;
      for (var i = 0; i < gs.length; i++) if (P.sameTask(gs[i].latest.task, e.task)) { g = gs[i]; break; }
      if (!g) { g = { entries: [] }; gs.push(g); }
      g.entries.push(e); g.latest = e;
    });
    gs.forEach(function (g) { g.entries.forEach(function (e, i) { e._round = e.round || i + 1; }); });
    return gs;
  }
  function nextRound(task) { var g = groups().filter(function (g) { return P.sameTask(g.latest.task, task); })[0]; return g ? g.latest._round + 1 : 1; }

  // ---------- gate ----------
  function boot() {
    if (S.user && S.user.name) return showDash();
    $('#gate').hidden = false; $('#dash').hidden = true; $('#userMenu').hidden = true;
    var dl = $('#sectorList'); dl.innerHTML = P.SECTORS.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('');
    setTimeout(function () { $('#gName').focus(); }, 50);
  }
  $('#gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#gName').value.trim(); if (!name) { $('#gName').focus(); return; }
    S.user = { name: name, email: $('#gEmail').value.trim(), sector: $('#gSector').value.trim() };
    if ($('#gSample').checked && !S.entries.length) S.entries = sample();
    save(); showDash();
  });

  // ---------- dashboard ----------
  var F = { status: '', sector: '', q: '', view: S.view || 'table' }, lastAdded = [];
  function showDash() {
    $('#gate').hidden = true; $('#dash').hidden = false; $('#userMenu').hidden = false;
    $('#avatar').textContent = S.user.name.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    $('#hi').textContent = 'Hi ' + S.user.name.split(' ')[0];
    $('#dateL').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    render();
  }
  function ctx() { return { user: S.user.name, sector: S.user.sector || '', today: today(), sectors: uniq(S.entries.map(function (e) { return e.sector; })) }; }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function chipsFor(it) {
    return '<span class="chip pop"><b>' + esc(it.task) + '</b></span><span class="chip pop">' + esc(it.sector) + '</span><span class="st st-' + slug(it.status) + ' pop">' + esc(it.status) + '</span>' +
      '<span class="chip pop"><span class="pr pr-' + slug(it.priority) + '"><i></i>' + esc(it.priority) + '</span></span><span class="chip pop">Round ' + (it.round || nextRound(it.task)) + '</span>' +
      (it.next ? '<span class="chip pop">Next: <b>' + esc(it.next) + '</b></span>' : '');
  }
  var pv = 0;
  $('#rt').addEventListener('input', function () {
    clearTimeout(pv); pv = setTimeout(function () {
      var items = P.parse($('#rt').value, ctx());
      $('#preview').innerHTML = items.length ? items.map(chipsFor).join('<span style="flex-basis:100%;height:0"></span>') : ($('#rt').value.trim() ? '<span class="small">Add what you worked on, e.g. “Finished the checkout payment step”.</span>' : '');
      $('#addBtn').disabled = !items.length;
    }, 120);
  });
  $('#composer').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('#rt').value, items = P.parse(text, ctx());
    if (!items.length) { toast('Add a task, e.g. “Task: Checkout redesign”'); return; }
    lastAdded = [];
    items.forEach(function (it) {
      if (!it.round) it.round = nextRound(it.task);
      var en = Object.assign({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), raw: text.slice(0, 4000) }, it);
      S.entries.push(en); lastAdded.push(en.task);
    });
    save(); $('#rt').value = ''; $('#preview').innerHTML = ''; $('#addBtn').disabled = true;
    F.status = ''; F.q = ''; $('#q').value = '';
    render(); toast('Added ' + items.length + ' task' + (items.length > 1 ? 's' : '') + ' to the board');
  });
  function filtered() {
    return groups().filter(function (g) {
      var e = g.latest;
      if (F.status && e.status !== F.status) return false;
      if (F.sector && e.sector !== F.sector) return false;
      if (F.q && (e.task + ' ' + e.sector + ' ' + e.next + ' ' + e.owner + ' ' + e.update).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false;
      return true;
    }).sort(function (a, b) { var x = a.latest, y = b.latest; return (STATUS_ORDER[x.status] - STATUS_ORDER[y.status]) || (PRI[x.priority] - PRI[y.priority]) || (y.created - x.created); });
  }
  function ago(t) { var s = (Date.now() - t) / 1000; return s < 90 ? 'Just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) === 1 ? 'Yesterday' : Math.round(s / 86400) + ' days ago'; }
  function render() {
    var gs = groups();
    var counts = {}; P.STATUSES.forEach(function (s) { counts[s] = 0; }); gs.forEach(function (g) { counts[g.latest.status]++; });
    var high = gs.filter(function (g) { return g.latest.priority === 'High' && g.latest.status !== 'Done'; }).length;
    $('#stats').innerHTML = P.STATUSES.map(function (s) { return '<button type="button" class="stat" data-st="' + esc(s) + '" aria-pressed="' + (F.status === s) + '"><span class="st st-' + slug(s) + '">' + s + '</span><b>' + counts[s] + '</b></button>'; }).join('') +
      '<span class="stat"><span class="pr pr-high"><i></i>High priority open</span><b>' + high + '</b></span>';
    var secs = uniq(gs.map(function (g) { return g.latest.sector; })).sort();
    $('#fSector').innerHTML = '<option value="">All sectors</option>' + secs.map(function (s) { return '<option' + (F.sector === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    $$('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === F.view); });
    var rows = filtered();
    $('#clearSample').hidden = !S.entries.some(function (e) { return e.sample; });
    if (!rows.length) { $('#board').innerHTML = '<div class="card empty">' + (gs.length ? 'Nothing matches these filters.' : 'No tasks yet. Paste today’s round-up above.') + '</div>'; return; }
    if (F.view === 'board') {
      $('#board').innerHTML = '<div class="kanban">' + ['Not started', 'In progress', 'In review', 'Blocked', 'Done'].map(function (s) {
        var list = rows.filter(function (g) { return g.latest.status === s; });
        return '<div class="col"><h3><span class="st st-' + slug(s) + '">' + s + '</span><span class="mono">' + list.length + '</span></h3>' + list.map(function (g) { var e = g.latest; return '<div class="kc" data-k="' + esc(e.id) + '" tabindex="0"><b>' + esc(e.task) + '</b><div class="m"><span class="chip">' + esc(e.sector) + '</span><span class="pr pr-' + slug(e.priority) + '"><i></i>' + e.priority + '</span><span class="mono">R' + e._round + '</span></div>' + (e.next ? '<p>Next: ' + esc(e.next) + '</p>' : '') + '</div>'; }).join('') + '</div>';
      }).join('') + '</div>';
      return;
    }
    $('#board').innerHTML = '<div class="card tablewrap"><table class="t"><thead><tr><th>Task</th><th class="hide-s">Sector</th><th>Status</th><th>Priority</th><th>Round</th><th class="hide-s">Next step</th><th class="hide-s">Updated</th></tr></thead><tbody>' +
      rows.map(function (g) { var e = g.latest; return '<tr data-k="' + esc(e.id) + '" tabindex="0" class="' + (lastAdded.indexOf(e.task) > -1 ? 'new' : '') + '"><td class="task"><b>' + esc(e.task) + '</b><small>' + esc(e.owner || '') + '</small></td><td class="hide-s">' + esc(e.sector) + '</td><td><span class="st st-' + slug(e.status) + '">' + e.status + '</span></td><td><span class="pr pr-' + slug(e.priority) + '"><i></i>' + e.priority + '</span></td><td class="rnd">R' + e._round + '</td><td class="next hide-s">' + esc(e.next || '—') + '</td><td class="hide-s small">' + ago(e.created) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    lastAdded = [];
  }
  $('#stats').addEventListener('click', function (e) { var b = e.target.closest('[data-st]'); if (!b) return; F.status = F.status === b.dataset.st ? '' : b.dataset.st; render(); });
  $('#fSector').addEventListener('change', function (e) { F.sector = e.target.value; render(); });
  $('#q').addEventListener('input', function (e) { F.q = e.target.value; render(); });
  $$('.seg button').forEach(function (b) { b.addEventListener('click', function () { F.view = b.dataset.view; S.view = F.view; save(); render(); }); });
  $('#board').addEventListener('click', function (e) { var r = e.target.closest('[data-k]'); if (r) openTask(r.dataset.k); });
  $('#board').addEventListener('keydown', function (e) { var r = e.target.closest('[data-k]'); if (r && e.key === 'Enter') openTask(r.dataset.k); });

  // ---------- task drawer ----------
  function openTask(id) {
    var g = groups().filter(function (g) { return g.entries.some(function (x) { return x.id === id; }); })[0]; if (!g) return;
    var e = g.latest;
    var opt = function (list, v) { return list.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + x + '</option>'; }).join(''); };
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(e.task) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mono">' + esc(e.sector) + ' · Round ' + e._round + '</span><button class="btn sm" data-close>Close</button></div>' +
      '<h2>' + esc(e.task) + '</h2>' +
      '<div class="grid"><label class="field"><span>Status</span><select data-f="status">' + opt(P.STATUSES, e.status) + '</select></label><label class="field"><span>Priority</span><select data-f="priority">' + opt(P.PRIORITIES, e.priority) + '</select></label></div>' +
      '<label class="field"><span>Sector</span><input type="text" data-f="sector" value="' + esc(e.sector) + '"></label>' +
      '<label class="field"><span>Next step</span><input type="text" data-f="next" value="' + esc(e.next) + '"></label>' +
      (e.blocker ? '<p style="color:var(--red);margin:0 0 6px;font-size:.88rem">Blocker: ' + esc(e.blocker) + '</p>' : '') +
      '<div class="mono" style="margin-top:18px">Rounds</div><div class="hist">' + g.entries.slice().reverse().map(function (x) { return '<div class="h"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mono">R' + x._round + ' · ' + esc(x.date) + '</span><span class="st st-' + slug(x.status) + '">' + x.status + '</span><span class="small">' + esc(x.owner || '') + '</span></div>' + (x.update ? '<p>' + esc(x.update) + '</p>' : '') + (x.next ? '<p>Next: ' + esc(x.next) + '</p>' : '') + '</div>'; }).join('') + '</div>' +
      '<div style="margin-top:22px;display:flex;justify-content:space-between"><button class="btn sm" data-del>Delete task</button><button class="btn solid sm" data-close>Done</button></div></aside>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); document.removeEventListener('keydown', onKey); render(); };
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-close]')) close();
      if (ev.target.closest('[data-del]')) { if (!confirm('Delete “' + e.task + '” and all its rounds?')) return; S.entries = S.entries.filter(function (x) { return g.entries.indexOf(x) < 0; }); save(); close(); toast('Task deleted'); }
    });
    wrap.addEventListener('change', function (ev) { var f = ev.target.dataset.f; if (!f) return; e[f] = ev.target.value.trim(); save(); });
    $('select', wrap).focus();
  }

  // ---------- menu ----------
  $('#avatar').addEventListener('click', function (e) { e.stopPropagation(); $('#menuPop').hidden = !$('#menuPop').hidden; });
  document.addEventListener('click', function () { $('#menuPop').hidden = true; });
  $('#copyPrompt').addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(PROMPT) : Promise.reject()).then(function () { toast('Prompt copied'); }, function () { prompt('Copy the Dailies prompt:', PROMPT); }); });
  $('#clearSample').addEventListener('click', function () { S.entries = S.entries.filter(function (e) { return !e.sample; }); save(); render(); toast('Sample data cleared'); });
  $('#signOut').addEventListener('click', function () { S.user = null; save(); boot(); });
  window.dailiesAdd = function (t) { $('#rt').value = t; $('#rt').dispatchEvent(new Event('input')); };
  boot();
})();
