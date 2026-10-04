/* Dailies board. With team sync configured (config.js), people sign in, create or join a team with an invite
   link and share one live board. Without it, the board runs on one device and is saved in the browser. */
(function () {
  var P = window.DailiesParse, KEY = 'dailies.v2', TEAM_KEY = 'dailies.team';
  var PROMPT = "Write my end-of-day Dailies round-up.\n\nLook back over everything we worked on together today in this conversation and summarise it in the exact format below, so I can paste it straight into my Dailies dashboard.\n\nRULES\n- Keep the field names exactly as written, one per line, in this order.\n- Write one block for each task we worked on today. Start every block with the line DAILIES.\n- Status must be one of: Not started, In progress, In review, Blocked, Done.\n- Priority must be one of: High, Medium, Low.\n- Round is the number of this update for the task: 1 the first time I report on it, then 2, 3 and so on. If you don't know, leave it blank.\n- Next step is the single next action, with a day if we agreed one.\n- Keep each line under 25 words. Be specific: name the file, tool, number or person.\n- Only include what actually happened or was decided today. Don't invent progress.\n- If you don't know my name, sector or a value, leave the square brackets in so I can fill them in.\n- No introduction, no sign-off, no tables, no extra headings.\n\nFORMAT\n\nDAILIES\nName: [your name]\nDate: [today's date as YYYY-MM-DD]\nTask: [the piece of work this update covers]\nSector: [your team or area, e.g. UX/UI, Video, Marketing, Engineering]\nStatus: [Not started / In progress / In review / Blocked / Done]\nPriority: [High / Medium / Low]\nRound: [1, 2, 3…]\nNext step: [the single next action]\nUpdate: [one or two sentences on what happened today]\nBlocker: [what's stopping progress and who it's waiting on, or None]";
  var CFG = window.DAILIES_CONFIG || {};
  var CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  var today = function (d) { var x = new Date(Date.now() - (d || 0) * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  var slug = function (s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); };
  var STATUS_ORDER = { 'Blocked': 0, 'In review': 1, 'In progress': 2, 'Not started': 3, 'Done': 4 }, PRI = { 'High': 0, 'Medium': 1, 'Low': 2 };
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function show(id) { ['#loading', '#auth', '#teams', '#gate', '#dash'].forEach(function (s) { $(s).hidden = s !== id; }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  $('#sectorList').innerHTML = P.SECTORS.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('');

  // ---------- state ----------
  // S.user = { name, sector }, S.entries = [{ id, task, sector, status, priority, round, next, update, blocker, owner, user_id, date, created }]
  var S = { user: null, entries: [] }, mem = null;
  var me = null, team = null, myTeams = [], members = [], isOwner = false;   // team mode only
  function localLoad() { try { return JSON.parse(lsGet(KEY)) || {}; } catch (e) { return mem || {}; } }
  function localSave() { if (CLOUD) return; mem = S; lsSet(KEY, JSON.stringify(S)); }
  function localBoard() { var L = localLoad(); return (L.entries || []).filter(function (e) { return !e.sample; }); }

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

  // ======================================================================
  // Team mode (Supabase)
  // ======================================================================
  var sb = null, chan = null, pollT = 0, refetchT = 0, live = false, authMode = 'in';
  var joinCode = (function () { var m = /[?&]join=([a-z0-9]+)/i.exec(location.search); return m ? m[1].toLowerCase() : ''; })();
  function codeFrom(v) { var m = /join=([a-z0-9]+)/i.exec(v || ''); return (m ? m[1] : String(v || '').replace(/[^a-z0-9]/gi, '')).toLowerCase(); }
  function inviteLink(code) { return location.origin + location.pathname + '?join=' + code; }
  function friendly(err) {
    var m = (err && (err.message || err.error_description || err)) || 'Something went wrong';
    if (/invalid login credentials/i.test(m)) return 'That email and password don’t match.';
    if (/already registered|already been registered/i.test(m)) return 'There’s already an account with that email. Sign in instead.';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link.';
    if (/password should be at least|weak password/i.test(m)) return 'Choose a password with at least 8 characters.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
    if (/does not exist|schema cache|could not find the function/i.test(m)) return 'Dailies’ database isn’t set up yet. Run dailies-setup.sql in Supabase (SQL Editor), then reload.';
    if (/invalid api key|no api key/i.test(m)) return 'The Supabase key in config.js isn’t right. Copy it again from Supabase > Settings > API Keys.';
    if (/failed to fetch|network|load failed/i.test(m)) return 'Can’t reach Dailies. Check your connection and try again.';
    if (/not authorized|email address .* not authorized/i.test(m)) return 'Password reset emails aren’t switched on for Dailies yet.';
    return String(m).replace(/^.*exception:\s*/i, '');
  }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'One moment…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
  function err(id, m) { var e = $(id); e.textContent = m || ''; e.hidden = !m; }

  function cloudStart() {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
    $('#forgot').hidden = !CFG.passwordResetEmails;
    sb.auth.onAuthStateChange(function (ev, session) {
      if (ev === 'PASSWORD_RECOVERY') setTimeout(newPassword, 50);
      if (ev === 'SIGNED_OUT') { me = null; team = null; stopLive(); showAuth(); }
    });
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (s) { me = s.user; afterSignIn(); } else showAuth();
    }, function () { showAuth(); });
  }

  // ----- sign in / create account -----
  function setAuthMode(m) {
    authMode = m;
    $$('#authForm .tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === m); });
    $('#aNameF').hidden = m !== 'up';
    $('#authTitle').textContent = m === 'up' ? 'Create your account' : 'Welcome back';
    $('#authLede').textContent = joinCode ? (m === 'up' ? 'Create an account to join your team’s board.' : 'Sign in to join your team’s board.') : (m === 'up' ? 'Then create a team, or join one with an invite link.' : 'Sign in to see your team’s board.');
    $('#authBtn').textContent = m === 'up' ? 'Create account' : 'Sign in';
    $('#aPass').setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
    err('#authErr', '');
  }
  function showAuth() {
    $('#userMenu').hidden = true; $('#inviteBtn').hidden = true;
    setAuthMode(joinCode ? 'up' : 'in');
    show('#auth');
    setTimeout(function () { (authMode === 'up' ? $('#aName') : $('#aEmail')).focus(); }, 50);
  }
  $$('#authForm .tabs button').forEach(function (b) { b.addEventListener('click', function () { setAuthMode(b.dataset.mode); (authMode === 'up' ? $('#aName') : $('#aEmail')).focus(); }); });
  $('#authForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#aEmail').value.trim(), pass = $('#aPass').value, name = $('#aName').value.trim(), btn = $('#authBtn');
    if (authMode === 'up' && !name) { err('#authErr', 'Add your name so your team knows who posted what.'); $('#aName').focus(); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { err('#authErr', 'Enter your email address.'); $('#aEmail').focus(); return; }
    if (pass.length < 8) { err('#authErr', 'Your password needs at least 8 characters.'); $('#aPass').focus(); return; }
    err('#authErr', ''); busy(btn, true);
    var p = authMode === 'up'
      ? sb.auth.signUp({ email: email, password: pass, options: { data: { name: name }, emailRedirectTo: location.origin + location.pathname + (joinCode ? '?join=' + joinCode : '') } })
      : sb.auth.signInWithPassword({ email: email, password: pass });
    p.then(function (r) {
      busy(btn, false);
      if (r.error) {
        var m = friendly(r.error);
        if (authMode === 'up' && /already an account/.test(m)) { setAuthMode('in'); $('#aPass').focus(); }
        err('#authErr', m); return;
      }
      if (!r.data.session) { err('#authErr', 'Almost there: check your inbox and click the link to confirm your email, then sign in.'); setAuthMode('in'); return; }
      $('#aPass').value = ''; me = r.data.user; afterSignIn();
    }, function (x) { busy(btn, false); err('#authErr', friendly(x)); });
  });
  $('#forgot').addEventListener('click', function () {
    var email = $('#aEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { err('#authErr', 'Type your email above first, then press “Forgot your password?”.'); $('#aEmail').focus(); return; }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
      if (r.error) err('#authErr', friendly(r.error)); else toast('If there’s an account for that email, a reset link is on its way');
    });
  });
  function newPassword() {
    var p = prompt('Choose a new password (at least 8 characters):'); if (!p) return;
    if (p.length < 8) { alert('Your password needs at least 8 characters.'); return newPassword(); }
    sb.auth.updateUser({ password: p }).then(function (r) { toast(r.error ? friendly(r.error) : 'Password updated'); });
  }

  // ----- teams -----
  function loadTeams() {
    return sb.from('members').select('team_id, name, sector, role, teams(id, name, invite_code)').eq('user_id', me.id).then(function (r) {
      if (r.error) throw r.error;
      myTeams = (r.data || []).filter(function (m) { return m.teams; }).map(function (m) { return { id: m.teams.id, name: m.teams.name, invite: m.teams.invite_code, role: m.role, me: { name: m.name, sector: m.sector } }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      return myTeams;
    });
  }
  function afterSignIn() {
    show('#loading');
    loadTeams().then(function () {
      if (joinCode) return showTeams('join');
      if (!myTeams.length) return showTeams('new');
      var saved = lsGet(TEAM_KEY), t = myTeams.filter(function (x) { return x.id === saved; })[0] || myTeams[0];
      openTeam(t);
    }, function (x) { toast(friendly(x)); showAuth(); });
  }
  function showTeams(mode) {
    $('#userMenu').hidden = true; $('#inviteBtn').hidden = true; stopLive();
    var meta = (me.user_metadata || {}), prev = team ? team.me : (myTeams[0] && myTeams[0].me) || {};
    $('#tName').value = prev.name || meta.name || ''; $('#tSector').value = prev.sector || '';
    $('#tCode').value = joinCode || ''; $('#tTeam').value = '';
    var join = mode === 'join' && joinCode;
    $('#tKick').textContent = join ? 'You’re invited' : 'Your team';
    $('#tTitle').textContent = join ? 'Join your team’s board' : (myTeams.length ? 'Create or join another team' : 'Create or join a team');
    $('#tLede').textContent = join ? 'Check your name, then join. Everyone in the team sees one shared board.' : 'Everyone in a team sees one shared board. Join with the invite link a teammate sent you, or start a new team and invite them.';
    $('#tJoinBox .field').hidden = !!join;
    $('#tOr').hidden = !!join; $('#tMakeBox').hidden = !!join;
    $('#joinBtn').className = 'btn primary wide';
    $('#makeBtn').className = 'btn wide' + (myTeams.length || join ? '' : '');
    $('#tBack').hidden = !myTeams.length; err('#teamErr', '');
    show('#teams');
    setTimeout(function () { ($('#tName').value ? (join ? $('#joinBtn') : $('#tCode')) : $('#tName')).focus(); }, 50);
  }
  function clearJoin() { joinCode = ''; if (/[?&]join=/.test(location.search)) history.replaceState(null, '', location.pathname); }
  $('#joinBtn').addEventListener('click', function () {
    var name = $('#tName').value.trim(), code = codeFrom($('#tCode').value);
    if (!name) { err('#teamErr', 'Add your name so your team knows who posted what.'); $('#tName').focus(); return; }
    if (!code) { err('#teamErr', 'Paste the invite link a teammate sent you.'); $('#tCode').focus(); return; }
    busy($('#joinBtn'), true, 'Joining…');
    sb.rpc('join_team', { p_code: code, p_name: name, p_sector: $('#tSector').value.trim() }).then(function (r) {
      busy($('#joinBtn'), false);
      if (r.error) { err('#teamErr', friendly(r.error)); return; }
      clearJoin(); var id = r.data.id;
      loadTeams().then(function () { openTeam(myTeams.filter(function (t) { return t.id === id; })[0]); toast('You’re in. Welcome to ' + r.data.name); });
    }, function (x) { busy($('#joinBtn'), false); err('#teamErr', friendly(x)); });
  });
  $('#makeBtn').addEventListener('click', function () {
    var name = $('#tName').value.trim(), tn = $('#tTeam').value.trim();
    if (!name) { err('#teamErr', 'Add your name so your team knows who posted what.'); $('#tName').focus(); return; }
    if (!tn) { err('#teamErr', 'Give your new team a name.'); $('#tTeam').focus(); return; }
    busy($('#makeBtn'), true, 'Creating…');
    sb.rpc('create_team', { p_team: tn, p_name: name, p_sector: $('#tSector').value.trim() }).then(function (r) {
      busy($('#makeBtn'), false);
      if (r.error) { err('#teamErr', friendly(r.error)); return; }
      clearJoin(); var id = r.data.id;
      loadTeams().then(function () { openTeam(myTeams.filter(function (t) { return t.id === id; })[0], true); });
    }, function (x) { busy($('#makeBtn'), false); err('#teamErr', friendly(x)); });
  });
  $('#tBack').addEventListener('click', function () { clearJoin(); openTeam(team || myTeams[0]); });
  $('#tOut').addEventListener('click', function () { signOut(); });
  function signOut() { stopLive(); lsSet(TEAM_KEY, null); sb.auth.signOut().then(function () { me = null; team = null; S.entries = []; showAuth(); }); }

  function openTeam(t, fresh) {
    if (!t) return showTeams('new');
    team = t; isOwner = t.role === 'owner'; lsSet(TEAM_KEY, t.id);
    S.user = { name: t.me.name, sector: t.me.sector };
    S.entries = []; F.person = ''; F.sector = ''; F.status = ''; F.q = ''; $('#q').value = '';
    showDash();
    refetch().then(function () { if (fresh) openInvite(true); offerImport(); });
    startLive();
  }
  function rowToEntry(r) {
    return { id: r.id, task: r.task, sector: r.sector, status: r.status, priority: r.priority, round: r.round, next: r.next, update: r.summary, blocker: r.blocker, owner: r.owner, user_id: r.user_id, date: r.day, created: Date.parse(r.created_at) };
  }
  function refetch() {
    if (!team) return Promise.resolve();
    var id = team.id;
    return Promise.all([
      sb.from('entries').select('*').eq('team_id', id).order('created_at', { ascending: true }).limit(5000),
      sb.from('members').select('user_id, name, sector, role').eq('team_id', id).order('name')
    ]).then(function (rs) {
      if (!team || team.id !== id) return;
      if (rs[0].error) throw rs[0].error;
      if (!rs[1].error && !(rs[1].data || []).some(function (m) { return m.user_id === me.id; })) { toast('You’re no longer in ' + team.name); lsSet(TEAM_KEY, null); team = null; return afterSignIn(); }
      S.entries = (rs[0].data || []).map(rowToEntry);
      members = rs[1].data || [];
      if ($('.drawer')) return; // don't re-render under an open task
      render();
    }).catch(function (x) { if (!S.entries.length) $('#board').innerHTML = '<div class="card empty">' + esc(friendly(x)) + ' <button type="button" class="link" id="retry">Try again</button></div>'; else toast(friendly(x)); });
  }
  function refetchSoon() { clearTimeout(refetchT); refetchT = setTimeout(refetch, 250); }
  function startLive() {
    stopLive();
    try {
      chan = sb.channel('team-' + team.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: 'team_id=eq.' + team.id }, refetchSoon)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: 'team_id=eq.' + team.id }, refetchSoon)
        .subscribe(function (st) { live = st === 'SUBSCRIBED'; teamLine(); });
    } catch (e) { live = false; }
    pollT = setInterval(function () { if (!document.hidden) refetch(); }, 30000); // safety net if live updates drop
  }
  function stopLive() { clearInterval(pollT); if (chan && sb) { try { sb.removeChannel(chan); } catch (e) { } } chan = null; live = false; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && CLOUD && team) refetch(); });
  $('#board').addEventListener('click', function (e) { if (e.target.id === 'retry') refetch(); });

  function teamLine() {
    var el = $('#teamLine'); if (!CLOUD || !team) { el.hidden = true; return; }
    var n = members.length || 1;
    el.innerHTML = '<span class="dot' + (live ? ' on' : '') + '" title="' + (live ? 'Live: updates appear as your team posts' : 'Updates every 30 seconds') + '"></span><b>' + esc(team.name) + '</b> · ' + n + ' ' + (n === 1 ? 'person' : 'people') +
      (n === 1 ? ' · <button type="button" class="link" data-invite>Invite your team</button>' : '');
    el.hidden = false;
  }
  $('#teamLine').addEventListener('click', function (e) { if (e.target.closest('[data-invite]')) openInvite(); });

  // ----- invite + members -----
  function openInvite(fresh) {
    if (!team) return;
    var link = inviteLink(team.invite);
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="scrim" data-close></div><div class="modal card" role="dialog" aria-modal="true" aria-labelledby="invH">' +
      '<div class="mh"><h2 id="invH">' + (fresh ? 'Your team is ready' : 'Invite your team') + '</h2><button class="btn sm" type="button" data-close>Close</button></div>' +
      '<p>' + (fresh ? 'Send this link to your teammates. ' : '') + 'Anyone with this link can join <b>' + esc(team.name) + '</b> and see its board.</p>' +
      '<div class="linkrow"><input type="text" readonly value="' + esc(link) + '" aria-label="Invite link"><button class="btn primary" type="button" data-copy>Copy link</button></div>' +
      (isOwner ? '<p class="small" style="margin-top:8px">Link shared somewhere it shouldn’t be? <button type="button" class="link" data-reset>Make a new link</button> (the old one stops working).</p>' : '') +
      '<div class="mono" style="margin:18px 0 8px">People · ' + members.length + '</div><ul class="people">' +
      members.map(function (m) { return '<li><span class="av sm">' + esc(initials(m.name)) + '</span><span><b>' + esc(m.name) + (m.user_id === me.id ? ' (you)' : '') + '</b><small>' + esc([m.sector, m.role === 'owner' ? 'Owner' : ''].filter(Boolean).join(' · ')) + '</small></span>' +
        (isOwner && m.user_id !== me.id && m.role !== 'owner' ? '<button type="button" class="link" data-remove="' + esc(m.user_id) + '">Remove</button>' : '') + '</li>'; }).join('') + '</ul></div>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-close]')) close();
      if (ev.target.closest('[data-copy]')) copy($('input', wrap).value, 'Invite link copied');
      if (ev.target.closest('[data-reset]')) {
        if (!confirm('Make a new invite link? The current link will stop working.')) return;
        sb.rpc('new_invite', { p_team: team.id }).then(function (r) { if (r.error) return toast(friendly(r.error)); team.invite = r.data; $('input', wrap).value = inviteLink(r.data); toast('New invite link ready'); });
      }
      var rm = ev.target.closest('[data-remove]');
      if (rm) {
        var who = members.filter(function (m) { return m.user_id === rm.dataset.remove; })[0];
        if (!who || !confirm('Remove ' + who.name + ' from ' + team.name + '? Their tasks stay on the board.')) return;
        sb.from('members').delete().eq('team_id', team.id).eq('user_id', who.user_id).select().then(function (r) {
          if (r.error || !r.data.length) return toast(r.error ? friendly(r.error) : 'Couldn’t remove them');
          members = members.filter(function (m) { return m.user_id !== who.user_id; }); close(); openInvite(); teamLine(); toast(who.name + ' removed');
        });
      }
    });
    setTimeout(function () { var i = $('input', wrap); i.focus(); i.select(); }, 30);
  }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase(); }
  function copy(text, ok) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast(ok); }, function () { prompt('Copy this:', text); }); }

  // ----- move a single-device board into the team -----
  function offerImport() {
    var bar = $('#importBar'), list = localBoard();
    if (!team || !list.length || lsGet('dailies.imported') === me.id) { bar.hidden = true; return; }
    bar.innerHTML = '<span>You have <b>' + list.length + ' task update' + (list.length > 1 ? 's' : '') + '</b> saved in this browser from before. Add them to ' + esc(team.name) + '?</span><span class="acts"><button type="button" class="btn primary sm" data-imp="yes">Add them</button><button type="button" class="btn sm" data-imp="no">No thanks</button></span>';
    bar.hidden = false;
  }
  $('#importBar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-imp]'); if (!b) return;
    if (b.dataset.imp === 'no') { lsSet('dailies.imported', me.id); $('#importBar').hidden = true; return; }
    var rows = localBoard().sort(function (a, b) { return a.created - b.created; }).map(function (x) { return toRow(x); });
    busy(b, true, 'Adding…');
    sb.from('entries').insert(rows).then(function (r) {
      if (r.error) { busy(b, false); return toast(friendly(r.error)); }
      lsSet('dailies.imported', me.id); $('#importBar').hidden = true; toast('Added ' + rows.length + ' to ' + team.name); refetch();
    });
  });
  function clip(s, n) { return String(s || '').slice(0, n); }
  function toRow(it) {
    return { team_id: team.id, task: clip(it.task, 120) || 'Untitled', sector: clip(it.sector, 30), status: it.status, priority: it.priority, round: it.round || null, next: clip(it.next, 300), summary: clip(it.update, 600), blocker: clip(it.blocker, 300), day: it.date || today(), raw: clip(it.raw, 8000) };
  }

  // ======================================================================
  // Single-device mode
  // ======================================================================
  function localStart() {
    var L = localLoad(); S.user = L.user || null; S.entries = (L.entries || []).filter(function (e) { return !e.sample; }); S.view = L.view;
    if (S.user && 'email' in S.user) delete S.user.email;
    if (S.user && S.user.name) { localSave(); return showDash(); }
    showGate();
  }
  function showGate(edit) {
    $('#gateTitle').textContent = edit ? 'Your details' : 'Set up your board'; $('#gateBtn').textContent = edit ? 'Save' : 'Open my board';
    if (edit) { $('#gName').value = S.user.name; $('#gSector').value = S.user.sector || ''; }
    $('#userMenu').hidden = true; show('#gate'); setTimeout(function () { $('#gName').focus(); }, 50);
  }
  $('#gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#gName').value.trim(); if (!name) { $('#gName').focus(); return; }
    S.user = { name: name, sector: $('#gSector').value.trim() };
    localSave(); showDash();
  });

  // ======================================================================
  // Dashboard (both modes)
  // ======================================================================
  var F = { status: '', sector: '', person: '', q: '', view: lsGet('dailies.view') || 'table' }, lastAdded = [];
  function showDash() {
    show('#dash'); $('#userMenu').hidden = false; $('#inviteBtn').hidden = !CLOUD;
    $('#avatar').textContent = initials(S.user.name);
    $('#hi').textContent = 'Hi ' + S.user.name.split(' ')[0];
    $('#dateL').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    buildMenu(); render();
  }
  function buildMenu() {
    var h = '';
    if (CLOUD) {
      h += '<div class="who"><b>' + esc(S.user.name) + '</b><small>' + esc(me && me.email || '') + '</small></div>';
      h += '<button type="button" data-m="invite">Invite teammates</button>';
      if (myTeams.length > 1) h += '<div class="sep"></div><div class="lab">Switch team</div>' + myTeams.map(function (t) { return '<button type="button" data-team="' + esc(t.id) + '"' + (team && t.id === team.id ? ' aria-current="true"' : '') + '>' + esc(t.name) + '</button>'; }).join('');
      h += '<button type="button" data-m="teams">Create or join another team</button><div class="sep"></div>';
    }
    h += '<button type="button" data-m="me">Change my name or sector</button><button type="button" data-m="prompt">Copy the prompt text</button><button type="button" data-m="csv">Export board (.csv)</button>';
    h += CLOUD ? '<div class="sep"></div><button type="button" data-m="leave">Leave this team</button><button type="button" data-m="out">Sign out</button>' : '<div class="sep"></div><button type="button" data-m="reset">Delete all my data</button>';
    $('#menuPop').innerHTML = h;
  }
  $('#avatar').addEventListener('click', function (e) { e.stopPropagation(); $('#menuPop').hidden = !$('#menuPop').hidden; });
  document.addEventListener('click', function (e) { if (!e.target.closest('#menuPop')) $('#menuPop').hidden = true; });
  $('#inviteBtn').addEventListener('click', function () { openInvite(); });
  $('#menuPop').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; $('#menuPop').hidden = true;
    if (b.dataset.team) { var t = myTeams.filter(function (x) { return x.id === b.dataset.team; })[0]; if (t && t !== team) { stopLive(); openTeam(t); } return; }
    var m = b.dataset.m;
    if (m === 'invite') openInvite();
    if (m === 'teams') showTeams('new');
    if (m === 'prompt') copy(PROMPT, 'Prompt copied. Paste it into your AI chat at the end of the day');
    if (m === 'csv') exportCsv();
    if (m === 'out') signOut();
    if (m === 'me') { if (CLOUD) editMe(); else showGate(true); }
    if (m === 'leave') {
      if (!confirm('Leave ' + team.name + '? You’ll need a new invite link to come back. Your tasks stay on the board.')) return;
      sb.from('members').delete().eq('team_id', team.id).eq('user_id', me.id).select().then(function (r) {
        if (r.error) return toast(friendly(r.error));
        toast('You left ' + team.name); lsSet(TEAM_KEY, null); team = null; stopLive(); afterSignIn();
      });
    }
    if (m === 'reset') {
      if (!confirm('Delete your name and every task on this board? This can’t be undone.')) return;
      S = { user: null, entries: [] }; lsSet(KEY, null); mem = null; showGate(); toast('All data deleted');
    }
  });
  function editMe() {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="scrim" data-close></div><form class="modal card" role="dialog" aria-modal="true" aria-labelledby="meH"><div class="mh"><h2 id="meH">Your details in ' + esc(team.name) + '</h2><button class="btn sm" type="button" data-close>Close</button></div>' +
      '<label class="field"><span>Your name</span><input type="text" id="mName" maxlength="60" required value="' + esc(S.user.name) + '"></label>' +
      '<label class="field"><span>Your sector <em class="opt">optional</em></span><input type="text" id="mSector" list="sectorList" maxlength="30" value="' + esc(S.user.sector || '') + '"></label>' +
      '<button class="btn primary wide" type="submit">Save</button></form>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); };
    wrap.addEventListener('click', function (ev) { if (ev.target.closest('[data-close]')) close(); });
    $('form', wrap).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var n = $('#mName').value.trim(), s = $('#mSector').value.trim(); if (!n) return $('#mName').focus();
      sb.from('members').update({ name: n, sector: s }).eq('team_id', team.id).eq('user_id', me.id).then(function (r) {
        if (r.error) return toast(friendly(r.error));
        S.user = { name: n, sector: s }; team.me = S.user; close(); showDash(); refetch(); toast('Saved');
      });
    });
    setTimeout(function () { $('#mName').focus(); }, 30);
  }

  function ctx() { return { user: S.user.name, sector: S.user.sector || '', today: today(), sectors: uniq(S.entries.map(function (e) { return e.sector; })) }; }
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
    var added = items.map(function (it) {
      if (!it.round) it.round = nextRound(it.task);
      it.owner = S.user.name; it.user_id = me && me.id;
      return Object.assign({ id: 'tmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), raw: text.slice(0, 4000) }, it);
    });
    added.forEach(function (en) { S.entries.push(en); });
    lastAdded = added.map(function (x) { return x.task; });
    $('#rt').value = ''; $('#preview').innerHTML = ''; $('#addBtn').disabled = true;
    F.status = ''; F.q = ''; $('#q').value = '';
    render();
    var msg = 'Added ' + items.length + ' task' + (items.length > 1 ? 's' : '') + ' to the board';
    if (!CLOUD) { added.forEach(function (x) { x.id = 'e' + x.id.slice(3); }); localSave(); toast(msg); return; }
    $('#addBtn').disabled = true;
    sb.from('entries').insert(added.map(toRow)).then(function (r) {
      if (r.error) throw r.error;
      toast(msg + (members.length > 1 ? '. Your team can see it now' : '')); refetch();
    }).catch(function (x) {
      S.entries = S.entries.filter(function (y) { return added.indexOf(y) < 0; }); render();
      $('#rt').value = text; $('#rt').dispatchEvent(new Event('input'));
      toast('Couldn’t save: ' + friendly(x) + ' Your text is back in the box.');
    });
  });
  function filtered() {
    return groups().filter(function (g) {
      var e = g.latest;
      if (F.status && e.status !== F.status) return false;
      if (F.sector && e.sector !== F.sector) return false;
      if (F.person && !g.entries.some(function (x) { return x.owner === F.person; })) return false;
      if (F.q && (e.task + ' ' + e.sector + ' ' + e.next + ' ' + e.owner + ' ' + e.update).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false;
      return true;
    }).sort(function (a, b) { var x = a.latest, y = b.latest; return (STATUS_ORDER[x.status] - STATUS_ORDER[y.status]) || (PRI[x.priority] - PRI[y.priority]) || (y.created - x.created); });
  }
  function ago(t) { var s = (Date.now() - t) / 1000; return s < 90 ? 'Just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) === 1 ? 'Yesterday' : Math.round(s / 86400) + ' days ago'; }
  function render() {
    teamLine();
    var gs = groups();
    var counts = {}; P.STATUSES.forEach(function (s) { counts[s] = 0; }); gs.forEach(function (g) { counts[g.latest.status]++; });
    var high = gs.filter(function (g) { return g.latest.priority === 'High' && g.latest.status !== 'Done'; }).length;
    $('#stats').innerHTML = P.STATUSES.map(function (s) { return '<button type="button" class="stat" data-st="' + esc(s) + '" aria-pressed="' + (F.status === s) + '"><span class="st st-' + slug(s) + '">' + s + '</span><b>' + counts[s] + '</b></button>'; }).join('') +
      '<span class="stat"><span class="pr pr-high"><i></i>High priority open</span><b>' + high + '</b></span>';
    var secs = uniq(gs.map(function (g) { return g.latest.sector; })).sort();
    $('#fSector').innerHTML = '<option value="">All sectors</option>' + secs.map(function (s) { return '<option' + (F.sector === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    var people = uniq(S.entries.map(function (e) { return e.owner; })).sort();
    $('#fPerson').hidden = !CLOUD || people.length < 2;
    $('#fPerson').innerHTML = '<option value="">Everyone</option>' + people.map(function (s) { return '<option' + (F.person === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    $$('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === F.view); });
    $('.tools').hidden = !gs.length; $('#stats').hidden = !gs.length;
    if (!gs.length) {
      $('#board').innerHTML = '<div class="card start"><h2>' + (CLOUD ? 'Your team board is empty' : 'Your board is empty') + '</h2><ol>' +
        '<li><b>Copy the Dailies prompt</b> (or download it as a Word file).</li>' +
        '<li>At the end of the day, paste it into the AI chat you worked in, e.g. ChatGPT, Claude or Gemini.</li>' +
        '<li>Paste its reply into the box above and press <b>Add to board</b>. You can also just type what you did.</li>' +
        (CLOUD ? '<li><b>Invite your team</b> so their round-ups land on the same board.</li>' : '') + '</ol>' +
        '<div class="acts"><button type="button" class="btn primary" data-act="copy">Copy the prompt</button>' + (CLOUD ? '<button type="button" class="btn" data-act="invite">Invite your team</button>' : '<a class="btn" href="dailies-prompt.docx" download="Dailies-prompt.docx">Download .docx</a>') + '<button type="button" class="btn" data-act="example">Try an example</button></div></div>';
      return;
    }
    var rows = filtered();
    if (!rows.length) { $('#board').innerHTML = '<div class="card empty">Nothing matches these filters.</div>'; return; }
    if (F.view === 'board') {
      $('#board').innerHTML = '<div class="kanban">' + ['Not started', 'In progress', 'In review', 'Blocked', 'Done'].map(function (s) {
        var list = rows.filter(function (g) { return g.latest.status === s; });
        return '<div class="col"><h3><span class="st st-' + slug(s) + '">' + s + '</span><span class="mono">' + list.length + '</span></h3>' + list.map(function (g) { var e = g.latest; return '<div class="kc" data-k="' + esc(e.id) + '" tabindex="0"><b>' + esc(e.task) + '</b><div class="m"><span class="chip">' + esc(e.sector) + '</span><span class="pr pr-' + slug(e.priority) + '"><i></i>' + e.priority + '</span><span class="mono">R' + e._round + '</span></div>' + (e.next ? '<p>Next: ' + esc(e.next) + '</p>' : '') + (CLOUD ? '<small class="by">' + esc(e.owner) + '</small>' : '') + '</div>'; }).join('') + '</div>';
      }).join('') + '</div>';
      lastAdded = [];
      return;
    }
    $('#board').innerHTML = '<div class="card tablewrap"><table class="t"><thead><tr><th>Task</th><th class="hide-s">Sector</th><th>Status</th><th>Priority</th><th>Round</th><th class="hide-s">Next step</th><th class="hide-s">Updated</th></tr></thead><tbody>' +
      rows.map(function (g) { var e = g.latest; return '<tr data-k="' + esc(e.id) + '" tabindex="0" class="' + (lastAdded.indexOf(e.task) > -1 ? 'new' : '') + '"><td class="task"><b>' + esc(e.task) + '</b><small>' + esc(e.owner || '') + '</small></td><td class="hide-s">' + esc(e.sector) + '</td><td><span class="st st-' + slug(e.status) + '">' + e.status + '</span></td><td><span class="pr pr-' + slug(e.priority) + '"><i></i>' + e.priority + '</span></td><td class="rnd">R' + e._round + '</td><td class="next hide-s">' + esc(e.next || '—') + '</td><td class="hide-s small">' + ago(e.created) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    lastAdded = [];
  }
  $('#stats').addEventListener('click', function (e) { var b = e.target.closest('[data-st]'); if (!b) return; F.status = F.status === b.dataset.st ? '' : b.dataset.st; render(); });
  $('#fSector').addEventListener('change', function (e) { F.sector = e.target.value; render(); });
  $('#fPerson').addEventListener('change', function (e) { F.person = e.target.value; render(); });
  $('#q').addEventListener('input', function (e) { F.q = e.target.value; render(); });
  $$('.seg button').forEach(function (b) { b.addEventListener('click', function () { F.view = b.dataset.view; lsSet('dailies.view', F.view); render(); }); });
  $('#board').addEventListener('click', function (e) {
    var r = e.target.closest('[data-k]'); if (r) return openTask(r.dataset.k);
    var a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'copy') copy(PROMPT, 'Prompt copied. Paste it into your AI chat at the end of the day');
    if (a.dataset.act === 'invite') openInvite();
    if (a.dataset.act === 'example') { $('#rt').value = EXAMPLE; $('#rt').dispatchEvent(new Event('input')); $('#rt').focus(); toast('Example added to the box. Press Add to board to try it'); }
  });
  $('#board').addEventListener('keydown', function (e) { var r = e.target.closest('[data-k]'); if (r && e.key === 'Enter') openTask(r.dataset.k); });
  var EXAMPLE = 'DAILIES\nTask: Landing page redesign\nStatus: In progress\nPriority: High\nNext step: Send the hero section to the team for feedback on Tuesday\nUpdate: Rebuilt the hero and pricing sections in Figma.\nBlocker: None';

  // ---------- task drawer ----------
  function openTask(id) {
    var g = groups().filter(function (g) { return g.entries.some(function (x) { return x.id === id; }); })[0]; if (!g) return;
    var e = g.latest;
    var canDelete = !CLOUD || isOwner || g.entries.every(function (x) { return x.user_id === me.id; });
    var opt = function (list, v) { return list.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + x + '</option>'; }).join(''); };
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(e.task) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><span class="mono">' + esc(e.sector) + ' · Round ' + e._round + '</span><button class="btn sm" data-close>Close</button></div>' +
      '<h2>' + esc(e.task) + '</h2>' +
      '<div class="grid"><label class="field"><span>Status</span><select data-f="status">' + opt(P.STATUSES, e.status) + '</select></label><label class="field"><span>Priority</span><select data-f="priority">' + opt(P.PRIORITIES, e.priority) + '</select></label></div>' +
      '<label class="field"><span>Sector</span><input type="text" data-f="sector" maxlength="30" value="' + esc(e.sector) + '"></label>' +
      '<label class="field"><span>Next step</span><input type="text" data-f="next" maxlength="300" value="' + esc(e.next) + '"></label>' +
      (e.blocker ? '<p style="color:var(--red);margin:0 0 6px;font-size:.88rem">Blocker: ' + esc(e.blocker) + '</p>' : '') +
      '<div class="mono" style="margin-top:18px">Rounds</div><div class="hist">' + g.entries.slice().reverse().map(function (x) { return '<div class="h"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mono">R' + x._round + ' · ' + esc(x.date) + '</span><span class="st st-' + slug(x.status) + '">' + x.status + '</span><span class="small">' + esc(x.owner || '') + '</span></div>' + (x.update ? '<p>' + esc(x.update) + '</p>' : '') + (x.next ? '<p>Next: ' + esc(x.next) + '</p>' : '') + '</div>'; }).join('') + '</div>' +
      '<div style="margin-top:22px;display:flex;justify-content:space-between;gap:10px">' + (canDelete ? '<button class="btn sm" data-del>Delete task</button>' : '<span class="small">Only the person who added it, or the team owner, can delete it.</span>') + '<button class="btn solid sm" data-close>Done</button></div></aside>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); document.removeEventListener('keydown', onKey); render(); };
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-close]')) close();
      if (ev.target.closest('[data-del]')) {
        if (!confirm('Delete “' + e.task + '” and all its rounds?')) return;
        var ids = g.entries.map(function (x) { return x.id; });
        S.entries = S.entries.filter(function (x) { return g.entries.indexOf(x) < 0; }); close();
        if (!CLOUD) { localSave(); toast('Task deleted'); return; }
        sb.from('entries').delete().in('id', ids).select('id').then(function (r) {
          if (r.error || r.data.length < ids.length) toast(r.error ? friendly(r.error) : 'Only the person who added it, or the team owner, can delete it.'); else toast('Task deleted');
          refetch();
        });
      }
    });
    wrap.addEventListener('change', function (ev) {
      var f = ev.target.dataset.f; if (!f) return;
      var v = ev.target.value.trim(); if (f === 'sector' && !v) return;
      e[f] = v;
      if (!CLOUD) { localSave(); return; }
      var patch = {}; patch[f] = v;
      sb.from('entries').update(patch).eq('id', e.id).then(function (r) { if (r.error) { toast('Couldn’t save that change: ' + friendly(r.error)); refetch(); } });
    });
    $('select', wrap).focus();
  }

  function exportCsv() {
    if (!S.entries.length) { toast('Nothing to export yet'); return; }
    var cols = ['date', 'task', 'sector', 'status', 'priority', 'round', 'next', 'update', 'blocker', 'owner'], head = ['Date', 'Task', 'Sector', 'Status', 'Priority', 'Round', 'Next step', 'Update', 'Blocker', 'Owner'];
    var q = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var rowsCsv = groups().reduce(function (a, g) { return a.concat(g.entries.map(function (e) { return cols.map(function (c) { return q(c === 'round' ? e._round : e[c]); }).join(','); })); }, []);
    var blob = new Blob(['﻿' + head.join(',') + '\n' + rowsCsv.join('\n')], { type: 'text/csv;charset=utf-8' });
    var name = (CLOUD && team ? team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' : '') + 'dailies-' + today() + '.csv';
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  window.dailiesAdd = function (t) { $('#rt').value = t; $('#rt').dispatchEvent(new Event('input')); };
  if (CLOUD) cloudStart(); else localStart();
})();
