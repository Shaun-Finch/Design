/* Dailies parser: turns a typed or pasted round-up into tasks with
   status, sector, task, round, priority and next step. Works with the Dailies prompt format and with plain sentences. */
(function (g) {
  var STATUSES = ['Not started', 'In progress', 'In review', 'Blocked', 'Done'];
  var PRIORITIES = ['High', 'Medium', 'Low'];
  var SECTORS = ['UX/UI', 'Design', 'Product', 'Engineering', 'Video', 'Motion', 'Social', 'Marketing', 'Content', 'Brand', 'Sales', 'Operations', 'Finance', 'People', 'Legal', 'Data', 'Research', 'Support', 'Growth', 'Comms'];
  var SECTOR_ALIASES = { 'ux': 'UX/UI', 'ui': 'UX/UI', 'ux/ui': 'UX/UI', 'ui/ux': 'UX/UI', 'dev': 'Engineering', 'development': 'Engineering', 'engineering': 'Engineering', 'eng': 'Engineering', 'ops': 'Operations', 'hr': 'People', 'cs': 'Support', 'customer success': 'Support', 'pr': 'Comms', 'communications': 'Comms', 'socials': 'Social', 'social media': 'Social', 'motion graphics': 'Motion', 'analytics': 'Data', 'insights': 'Data' };

  function clean(s) { return String(s || '').replace(/\[[^\]]*\]/g, '').replace(/^[\s\-–•*]+/, '').replace(/\s+/g, ' ').trim(); }
  function cap(s) { s = clean(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  function normStatus(v, text) {
    var s = (v || '').toLowerCase();
    if (s) {
      if (/block|stuck|hold|waiting/.test(s)) return 'Blocked';
      if (/review|approval|feedback|sign.?off/.test(s)) return 'In review';
      if (/not started|to ?do|planned|backlog|queued/.test(s)) return 'Not started';
      if (/done|complete|finished|shipped|launched|delivered|closed/.test(s)) return 'Done';
      if (/progress|ongoing|wip|working|started|active/.test(s)) return 'In progress';
    }
    var t = (text || '').toLowerCase();
    if (/\b(blocked|stuck|on hold|can'?t (proceed|continue|move)|waiting (on|for)|held up)\b/.test(t)) return 'Blocked';
    if (/\b(in review|for review|sent (it )?(to|for) (review|approval|sign.?off)|awaiting (feedback|approval|sign.?off)|with the client for)\b/.test(t)) return 'In review';
    if (/\b(not started|haven'?t started|yet to start|will start|starting tomorrow)\b/.test(t)) return 'Not started';
    if (/\b(finished|completed|shipped|launched|delivered|signed off|wrapped up|all done)\b/.test(t) || /\b(is|are|got it|it'?s) done\b/.test(t)) return 'Done';
    return 'In progress';
  }
  function normPriority(v, text) {
    var s = (v || '').toLowerCase();
    if (s) {
      if (/high|urgent|p0|p1|critical|top/.test(s)) return 'High';
      if (/low|p3|p4|minor|nice/.test(s)) return 'Low';
      if (/med|normal|p2|mid/.test(s)) return 'Medium';
    }
    var t = (text || '').toLowerCase();
    if (/\b(urgent|asap|high priority|top priority|critical|p0|p1|due today|deadline (is )?(today|tomorrow)|by end of (the )?day|eod)\b/.test(t)) return 'High';
    if (/\b(low priority|p3|nice to have|no rush|when (i|we) have time|whenever)\b/.test(t)) return 'Low';
    return 'Medium';
  }
  function normSector(v, text, known) {
    var list = (known || []).concat(SECTORS);
    var s = clean(v);
    if (s) {
      var a = SECTOR_ALIASES[s.toLowerCase()];
      if (a) return a;
      for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === s.toLowerCase()) return list[i];
      return cap(s).slice(0, 30);
    }
    var t = ' ' + (text || '').toLowerCase() + ' ';
    for (var k in SECTOR_ALIASES) if (new RegExp('[^a-z]' + k.replace('/', '\\/') + '[^a-z]').test(t) && k.length > 2) return SECTOR_ALIASES[k];
    for (var j = 0; j < list.length; j++) if (new RegExp('[^a-z]' + list[j].toLowerCase().replace('/', '\\/') + '[^a-z]').test(t)) return list[j];
    for (var h in HINTS) if (HINTS[h].test(t)) return h;
    return '';
  }
  var HINTS = { 'Video': /\b(subtitles?|captions?|footage|film|edit(ing)?|cut-?downs?|render|b-?roll)\b/, 'Engineering': /\b(api|bug|deploy|backend|frontend|code|repo|pull request|pr review|batch job|database|server)\b/,
    'Marketing': /\b(email sequence|newsletter|campaign|seo|ads?|landing page copy|launch plan)\b/, 'Social': /\b(tiktok|instagram|linkedin post|reels?|social posts?)\b/,
    'UX/UI': /\b(prototype|wireframes?|figma|user flow|checkout|onboarding flow|usability|ui kit|design system)\b/, 'Data': /\b(dashboard|analytics|metrics|sql|report)\b/, 'Sales': /\b(pipeline|deal|prospect|crm|proposal)\b/ };
  function sentences(t) { return (String(t).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g) || []).map(function (x) { return x.trim(); }).filter(Boolean); }

  var FIELD = /^\s*[-*•]?\s*(name|owner|date|task|deliverable|project|sector|team|department|area|status|stage|priority|round|update number|next step|next action|next|update|summary|today|blocker|blockers|ai tool)\s*[:\-–]\s*(.*)$/i;
  var HEAD = /^\s*(summary|done|in progress|blockers|key targets|notes)\s*:?\s*$/i;

  function parseBlock(block, ctx) {
    var f = {}, sec = {}, cur = null, curSec = null;
    block.split(/\r?\n/).forEach(function (line) {
      if (/^\s*dailies(\s+round-?up)?\s*$/i.test(line)) return;
      var m = line.match(FIELD);
      if (m) { cur = m[1].toLowerCase(); curSec = null; f[cur] = clean(m[2]); return; }
      var h = line.match(HEAD);
      if (h) { curSec = h[1].toLowerCase(); cur = null; sec[curSec] = []; return; }
      var v = clean(line);
      if (!v) return;
      if (curSec) sec[curSec].push(v);
      else if (cur && /^(update|summary|next step|next action|next|blocker|blockers)$/.test(cur)) f[cur] = (f[cur] ? f[cur] + ' ' : '') + v;
      else (sec._free = sec._free || []).push(v);
    });
    var free = (sec._free || []).join(' ');
    var all = block.replace(/\s+/g, ' ');
    var structured = Object.keys(f).length >= 2 || Object.keys(sec).filter(function (k) { return k !== '_free'; }).length >= 2;

    // task
    var task = f.task || f.deliverable || '';
    if (!task && !structured) {
      var m1 = free.match(/\b(?:stuck on|blocked on|worked on|working on|work on|finished|finishing|started|starting|shipped|reviewed|reviewing|built|building|designed|designing|wrote|writing|drafted|drafting|fixed|fixing|updated|updating|prepared|preparing|sent|polished|polishing|tested|testing)\s+(?:the\s+|a\s+|an\s+|our\s+|my\s+)?(.+?)(?:[,.;!?]|\s[—–-]\s|\s+(?:and|but|which|so|then|today|this morning|this afternoon|with)\b|$)/i);
      task = m1 ? m1[1] : (sentences(free)[0] || '').split(/[,;:]/)[0].split(/\s+(?:is|are|was|were|has|have|had|got|went|needs|need)\b/i)[0];
    }
    task = cap(task).replace(/[.]+$/, '').slice(0, 80);
    if (!task && f.project) task = cap(f.project);

    // next step
    var next = f['next step'] || f['next action'] || f.next || (sec['key targets'] && sec['key targets'][0]) || '';
    var freeS = sentences(free);
    if (!next) {
      var ns = freeS.filter(function (s) { return /\b(next|tomorrow|will|plan to|planning to|going to|to do|need to|needs to|aim to|by (mon|tues|wednes|thurs|fri|satur|sun)day|by (end of )?(the )?week)\b/i.test(s); })[0];
      if (ns) next = ns;
    }
    next = String(next).replace(/^(next( step)?|then|so)[:,]?\s*/i, '').replace(/^(i'?ll|i will|we'?ll|we will|i need to|we need to|need to|i plan to|i'?m going to|going to|i aim to)\s+/i, '');
    next = cap(next).replace(/[.]+$/, '').slice(0, 140);

    // update and blocker
    var update = f.update || f.summary || f.today || (sec.summary && sec.summary.join(' ')) || freeS.filter(function (s) { return s.replace(/[.]$/, '') !== next && !/^next\b/i.test(s); }).slice(0, 2).join(' ');
    var blocker = f.blocker || f.blockers || (sec.blockers && sec.blockers.filter(function (b) { return !/^none\.?$/i.test(b); }).join(' ')) || '';
    if (/^(none|n\/a|no|-)\.?$/i.test(blocker)) blocker = '';
    if (!blocker) { var bs = freeS.filter(function (s) { return /\b(blocked|waiting (on|for)|stuck|held up|on hold)\b/i.test(s); })[0]; if (bs) blocker = bs; }

    var status;
    if (f.status || f.stage) status = normStatus(f.status || f.stage, all);
    else if (blocker) status = 'Blocked';
    else if (sec.summary && normStatus('', sec.summary.join(' ')) !== 'In progress') status = normStatus('', sec.summary.join(' '));
    else if (sec['in progress'] && sec['in progress'].length) status = 'In progress';
    else status = normStatus('', all);
    var priority = normPriority(f.priority, all);
    var sector = normSector(f.sector || f.team || f.department || f.area, all, ctx.sectors);
    if (sector && !structured) task = task.replace(new RegExp('\\s+for (the )?' + sector.replace('/', '\\/') + '( team)?$', 'i'), '');
    var round = parseInt(f.round || f['update number'] || ((all.match(/\bround\s*(\d+)\b/i) || [])[1]) || '', 10);
    var date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : ctx.today;
    var owner = clean(f.name || f.owner) || ctx.user || '';
    return { task: task, sector: sector || ctx.sector || 'General', status: status, priority: priority, round: isNaN(round) ? null : round, next: next, update: cap(update).slice(0, 400), blocker: cap(blocker).slice(0, 240), owner: owner, date: date };
  }

  function parse(text, ctx) {
    ctx = ctx || {};
    ctx.today = ctx.today || new Date().toISOString().slice(0, 10);
    var t = String(text || '').replace(/\r/g, '').trim();
    if (!t) return [];
    var blocks;
    if (/^\s*dailies(\s+round-?up)?\s*$/im.test(t)) blocks = t.split(/^\s*dailies(?:\s+round-?up)?\s*$/im).map(function (b) { return b.trim(); }).filter(Boolean);
    else if ((t.match(/^\s*[-*•]?\s*(task|deliverable)\s*:/gim) || []).length > 1) blocks = t.split(/\n(?=\s*[-*•]?\s*(?:name|task|deliverable)\s*:)/i).reduce(function (acc, b) { if (acc.length && !/(task|deliverable)\s*:/i.test(acc[acc.length - 1])) acc[acc.length - 1] += '\n' + b; else acc.push(b); return acc; }, []);
    else blocks = [t];
    return blocks.map(function (b) { return parseBlock(b, ctx); }).filter(function (e) { return e.task; });
  }

  function taskKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|a|an|for|of|and|to|on|v\d+)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  function sameTask(a, b) {
    var x = taskKey(a), y = taskKey(b); if (!x || !y) return false; if (x === y) return true;
    var xs = x.split(' '), ys = y.split(' '), common = xs.filter(function (w) { return ys.indexOf(w) > -1; }).length;
    return common / Math.max(xs.length, ys.length) >= .7;
  }

  g.DailiesParse = { parse: parse, sameTask: sameTask, STATUSES: STATUSES, PRIORITIES: PRIORITIES, SECTORS: SECTORS };
  if (typeof module !== 'undefined') module.exports = g.DailiesParse;
})(typeof window !== 'undefined' ? window : globalThis);
