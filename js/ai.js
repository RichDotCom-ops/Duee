// duee. — AI Study Assistant (powered by LiquidAI via OpenRouter)

(function () {
  const AI_KEY     = atob(['Z3NrXzRRNkZm','ODhDZk5VR0lq','VERDUmI2V0dk','eWIzRlloTk1L','bURnZFF4ZWFIOWl6clQ5bWM1SHM='].join(''));
  const AI_URL     = 'https://api.groq.com/openai/v1/chat/completions';
  const AI_MODEL   = 'openai/gpt-oss-120b';
  const AI_BACKUPS = ['qwen/qwen3.6-27b', 'openai/gpt-oss-20b'];

  // ── State ──
  let _open          = false;
  let _thinking      = false;
  let _history       = []; // { role, text } for display + { role, content } for API
  let _convId        = null; // current conversation ID
  let _histOpen      = false; // history panel visible

  // ── Persistent memory ──
  const _MEM_KEY = 'duee_ai_mem';
  function _memLoad() { try { return JSON.parse(localStorage.getItem(_MEM_KEY) || '{}'); } catch { return {}; } }
  function _memSave(m) { try { localStorage.setItem(_MEM_KEY, JSON.stringify(m)); } catch {} }

  function _memExtractUser(raw) {
    // Always run on the raw original text (not normalized) so nothing gets stripped
    const mem = _memLoad(); let changed = false; const changed_keys = [];

    // Name — case-insensitive, flexible patterns
    const nm =
      raw.match(/(?:my name is|i go by|call me|they call me|name'?s?)\s+([a-z]{2,20})/i) ||
      raw.match(/\bi(?:'m| am)\s+([a-z]{2,20})(?=[\s,!?.]|$)/i);
    if (nm && !/^(a|an|the|good|fine|okay|ok|great|bad|tired|bored|studying|majoring)$/i.test(nm[1])) {
      const name = nm[1].charAt(0).toUpperCase() + nm[1].slice(1).toLowerCase();
      if (mem.name !== name) { mem.name = name; changed = true; changed_keys.push('name'); }
    }

    // Major / subject
    const mj = raw.match(/(?:i(?:'m| am) (?:studying|majoring in|a)|my major is|i study)\s+([\w\s]{2,35}?)(?:[.,!?]|$)/i);
    if (mj) { const v = mj[1].trim(); if (v && mem.major !== v) { mem.major = v; changed = true; } }

    // School
    const sc = raw.match(/(?:i (?:go to|attend|study at)|i(?:'m| am) at|my (?:school|university|college) is)\s+([\w\s]{2,50})/i);
    if (sc) { const v = sc[1].replace(/[.,!?].*$/, '').trim(); if (v && mem.school !== v) { mem.school = v; changed = true; } }

    // Year / grade
    const yr = raw.match(/\bi(?:'m| am) a\s+(freshman|sophomore|junior|senior|grad student|graduate student|phd student)\b/i);
    if (yr) { const v = yr[1].toLowerCase(); if (mem.year !== v) { mem.year = v; changed = true; } }

    // Explicit remember command
    const rm = raw.match(/(?:remember|don'?t forget|keep in mind|note that|save that)[:\s]+(.{3,150})/i);
    if (rm) {
      if (!mem.notes) mem.notes = [];
      const note = rm[1].replace(/[.!?]*$/, '').trim();
      if (!mem.notes.some(n => n.toLowerCase() === note.toLowerCase())) { mem.notes.push(note); changed = true; }
    }

    if (changed) _memSave(mem);
    return changed_keys; // return what changed so we can acknowledge it
  }

  function _memExtractAI(text) {
    const mem = _memLoad(); let changed = false;
    for (const m of [...(text.matchAll(/\[REMEMBER:\s*([^=\]]+?)=([^\]]+)\]/gi))]) {
      const k = m[1].trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      const v = m[2].trim();
      if (k && v) { mem[k] = v; changed = true; }
    }
    if (changed) _memSave(mem);
  }

  function _memContext() {
    const mem = _memLoad(); const lines = [];
    if (mem.name)          lines.push(`• Name: ${mem.name} (use their name in replies!)`);
    if (mem.year)          lines.push(`• Year: ${mem.year}`);
    if (mem.major)         lines.push(`• Major/Studying: ${mem.major}`);
    if (mem.school)        lines.push(`• School: ${mem.school}`);
    if (mem.notes?.length) mem.notes.forEach(n => lines.push(`• They told me: "${n}"`));
    const skip = new Set(['name','major','school','notes','year']);
    Object.entries(mem).forEach(([k,v]) => { if (!skip.has(k) && typeof v === 'string') lines.push(`• ${k.replace(/_/g,' ')}: ${v}`); });
    return lines.length ? `\n⚠️ IMPORTANT — I already know this student:\n${lines.join('\n')}\nUse this info to personalize every response.\n` : '';
  }

  // ── Conversation history ──
  const _CONV_KEY = 'duee_ai_convs';
  function _convsLoad() { try { return JSON.parse(localStorage.getItem(_CONV_KEY) || '[]'); } catch { return []; } }
  function _convsSave(c) { try { localStorage.setItem(_CONV_KEY, JSON.stringify(c.slice(0, 30))); } catch {} }

  function _convAutoSave() {
    const userMsgs = _history.filter(m => m.role === 'user');
    if (!userMsgs.length || _history.length < 2) return;
    if (!_convId) _convId = 'c' + Date.now();
    const convs = _convsLoad();
    const idx = convs.findIndex(c => c.id === _convId);
    const entry = { id: _convId, title: userMsgs[0].text.slice(0, 60), ts: Date.now(), messages: _history.filter(m => !m._actionOnly) };
    if (idx >= 0) convs[idx] = entry; else convs.unshift(entry);
    _convsSave(convs);
  }

  function _fmtTs(ts) {
    const diff = Math.floor((Date.now() - ts) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return new Date(ts).toLocaleDateString('en', { weekday: 'long' });
    return new Date(ts).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  function renderHistoryPanel() {
    const list = document.getElementById('ai-hist-list');
    if (!list) return;
    const convs = _convsLoad();
    if (!convs.length) {
      list.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--text-muted,#94a3b8);font-size:13px;line-height:1.6;">No saved conversations yet.<br>Start chatting to build history!</div>`;
      return;
    }
    list.innerHTML = convs.map(c => `
      <div class="ai-hist-item" onclick="window._aiLoadConv('${c.id}')">
        <div class="ai-hist-title">${escHtml(c.title)}</div>
        <div class="ai-hist-meta">${_fmtTs(c.ts)}</div>
        <button class="ai-hist-del" onclick="event.stopPropagation();window._aiDelConv('${c.id}')" title="Delete">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  }

  function _showHistPanel(show) {
    _histOpen = show;
    document.getElementById('ai-messages').style.display       = show ? 'none' : '';
    document.getElementById('ai-input-area').style.display     = show ? 'none' : '';
    document.getElementById('ai-token-counter').style.display  = show ? 'none' : '';
    document.getElementById('ai-hist-panel').style.display     = show ? 'flex' : 'none';
    if (show) renderHistoryPanel();
  }

  // ── Page refresh after data changes ──
  function refreshPage() {
    if (typeof loadData !== 'function') return;
    loadData().then(() => {
      if (typeof renderAssignments === 'function') renderAssignments();
      if (typeof renderClasses    === 'function') renderClasses();
      if (typeof render           === 'function') render();
      if (typeof loadDashboard    === 'function' && window._currentUser) loadDashboard(window._currentUser);
    }).catch(() => {});
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

  // ── Normalize abbreviations/slang before sending to AI ──
  function normalize(text) {
    return text
      .replace(/\bhw\b/gi, 'homework')
      .replace(/\basgn\b/gi, 'assignment')
      .replace(/\bcls\b/gi, 'class')
      .replace(/\btmrw\b|\btmr\b|\btomoro\b|\btomorrow\b/gi, 'tomorrow')
      .replace(/\bwk\b/gi, 'week')
      .replace(/\bsub(mitted)?\b/gi, 'submitted')
      .replace(/\bprof\b/gi, 'professor')
      .replace(/\bsoon\b/gi, 'in 3 days')
      .replace(/\bfinished\b|\bdid it\b|\bgot it done\b|\bwrapped up\b/gi, 'completed')
      .replace(/\bkill\b|\bget rid of\b|\bnuke\b|\bdump\b/gi, 'delete')
      .replace(/\buncheck\b|\bundo done\b|\bnot done yet\b|\bactually not done\b/gi, 'mark incomplete')
      .replace(/\byoo+\b|\byooo+\b/gi, '')
      .replace(/\bbro+\b|\bbruh\b|\bfr\b|\bngl\b|\bfr fr\b/gi, '')
      .replace(/\bcan u\b|\bcan you\b|\bcould u\b|\bplz\b|\bpls\b|\bplease\b/gi, '')
      .replace(/\bwanna\b/gi, 'want to')
      .replace(/\bgonna\b/gi, 'going to')
      .replace(/\blemme\b/gi, 'let me')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ── Build context for system prompt ──
  async function buildContext() {
    let classes = [], assignments = [];
    try { [classes, assignments] = await Promise.all([DB.getClasses(), DB.getAssignments()]); } catch (_) {}
    const now     = new Date(); now.setHours(0,0,0,0);
    const pending = assignments.filter(a => !a.completed).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    return { classes, assignments, pending, now };
  }

  // ── Web search via Wikipedia (free, no key, CORS-enabled) ──
  async function _webSearch(query) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`,
        { signal: ctrl.signal }
      );
      clearTimeout(t);
      const data = await res.json();
      const title = data.query?.search?.[0]?.title;
      if (!title) return null;
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 6000);
      const res2 = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal: ctrl2.signal }
      );
      clearTimeout(t2);
      const summary = await res2.json();
      if (!summary.extract) return null;
      return { title: summary.title, content: summary.extract.slice(0, 700) };
    } catch (_) { return null; }
  }

  function _isStudyQuestion(text) {
    const l = text.toLowerCase();
    return /\b(what\s+is|what\s+are|how\s+does|how\s+do|explain|define|solve|calculate|why\s+(is|does|did|are|do)|who\s+(is|was|were)|when\s+(did|was|were|is)|help\s+me\s+(with|understand|solve|on)|what\s+caused|history\s+of|tell\s+me\s+about|describe|summarize|meaning\s+of|difference\s+between|compare|formula\s+for|theorem|equation|proof|derive|essay|photosynthesis|biology|chemistry|physics|math|algebra|calculus|economics|psychology|philosophy)\b/.test(l);
  }

  const _CLASS_COLORS = ['#16a34a','#2563eb','#7c3aed','#0891b2','#dc2626','#b45309','#0d9488','#9333ea','#db2777','#64748b'];

  function buildSystemPrompt(ctx, webContext) {
    const { classes, pending, now } = ctx;
    const upcoming = pending.slice(0, 10).map(a => {
      const cls = classes.find(c => c.id === a.classId);
      const diff = Math.round((new Date(a.dueDate + 'T00:00:00') - now) / 86400000);
      const when = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`;
      return `• ${a.name}${cls ? ` [${cls.name}]` : ''} — ${when} (${a.priority} priority)`;
    }).join('\n') || '• none';

    const classesList = classes.length
      ? classes.map(c => `• ${c.name}${c.professor ? ` (${c.professor})` : ''} [id:${c.id}]`).join('\n')
      : '• none yet';

    const webBlock = webContext
      ? `\n📖 WEB SEARCH RESULT (Wikipedia) — use this to give a more accurate answer:\n**${webContext.title}**: ${webContext.content}\n`
      : '';

    return `You are a smart, friendly AI study assistant built into duee. — a student planner app.
${_memContext()}${webBlock}
You have TWO jobs:
1. ANSWER any homework or study question the student asks — math, science, history, english, coding, anything. Give clear, step-by-step answers. Never refuse a homework question.
2. MANAGE their planner — add/delete assignments, mark done, add new classes, show upcoming.

Today's date: ${todayStr()}

Student's classes:
${classesList}

Student's upcoming assignments:
${upcoming}

ACTIONS — when the student wants to manage their data, include an action block in your reply:
\`\`\`action
{"type":"add_assignment","name":"Essay","due_date":"2026-08-25","priority":"medium","class_id":"<id or omit>"}
\`\`\`
\`\`\`action
{"type":"mark_complete","name":"Essay"}
\`\`\`
\`\`\`action
{"type":"mark_incomplete","name":"Essay"}
\`\`\`
\`\`\`action
{"type":"delete_assignment","name":"Essay"}
\`\`\`
\`\`\`action
{"type":"add_class","name":"Biology","teacher":"Mr. Smith"}
\`\`\`
\`\`\`action
{"type":"get_upcoming","days":7}
\`\`\`
For add_class: use "teacher" field only if they mentioned a teacher/professor. For add_assignment: match class_id to one of the student's class IDs above; omit if no match.

HOW TO RESPOND:
- For homework/study questions: answer directly and fully. Show all steps for math. Explain concepts clearly. Be like a knowledgeable tutor.
- For assignment/class management: say what you did and include the action block.
- Tone: friendly, encouraging, casual — like a smart friend helping out.
- Format: plain text only — NO asterisks, NO bold (**), NO markdown symbols. Use numbered steps for math, plain bullet points (•) for lists.
- Length: answer only what was asked. Be direct. Don't add extra info, tips, or preamble they didn't ask for.
- NEVER say "I can't help with that" or redirect to other tools. Just answer.
- Memory: USE the student's name naturally in responses when you know it. When they share personal info (name, major, school, year, preferences), append [REMEMBER: key=value] at the end — e.g. [REMEMBER: favorite_subject=Chemistry]. If they say "remember X", confirm it: "Got it, I'll remember that!". Always personalize — never respond like you don't know them if memory exists.`;
  }

  // ── Strip model thinking preambles ──
  function cleanResponse(text) {
    if (!text) return null;
    // Remove <think>...</think> blocks (DeepSeek, reasoning models)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Remove "Okay/Alright/Sure, the user asked/said/wants..."
    text = text.replace(/^(okay|alright|sure|right|so)[,.]?\s*(the\s+user\s+(asked|said|wants?|is asking)[^.]*\.\s*)/i, '');
    // Remove "Here's a thinking process: ..."
    text = text.replace(/^here'?s?\s+a\s+(thinking\s+process|plan|approach)[:\-][^\n]*\n/i, '');
    // Remove "Let me think/work/solve/analyze..."
    text = text.replace(/^(let me|i('ll| will))\s+(think|work|solve|calculate|analyze|break|figure)[^.\n]*[.\n]\s*/i, '');
    // Remove lines that are just meta-commentary about the request
    text = text.replace(/^(the\s+user\s+(wants?|is asking|asked|said)[^.\n]*\.\s*\n?)/im, '');
    // Remove "I need to respond with..." type lines
    text = text.replace(/^(i need to|i should|i will now|my response)[^.\n]*\.\s*\n?/im, '');
    return text.trim() || null;
  }

  // ── Call Groq ──
  async function callAI(apiMessages, systemPrompt) {
    const headers = {
      'Authorization': `Bearer ${AI_KEY}`,
      'Content-Type':  'application/json',
    };

    const call = (model, temperature) => new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); resolve(null); }, 25000);
      fetch(AI_URL, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, ...apiMessages],
          temperature,
          max_tokens: 1500,
        }),
      })
        .then(r => r.json())
        .then(d => {
          clearTimeout(timer);
          if (d.error) console.warn('[AI]', model, d.error);
          resolve(cleanResponse(d.choices?.[0]?.message?.content?.trim()));
        })
        .catch(e => { clearTimeout(timer); console.warn('[AI]', e.message); resolve(null); });
    });

    // Try primary, then backups
    const result = await call(AI_MODEL, 0.2);
    if (result) return result;
    for (const model of AI_BACKUPS) {
      const r = await call(model, 0.3);
      if (r) return r;
    }
    return null;
  }

  // ── Fuzzy assignment finder ──
  function fuzzyFind(list, id, name) {
    if (id) { const byId = list.find(a => a.id === id); if (byId) return byId; }
    if (!name) return null;
    const n = name.toLowerCase();
    // 1. Direct substring
    const direct = list.find(a => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()));
    if (direct) return direct;
    // 2. Word overlap (short words included — "bio", "hw" etc.)
    const words = n.split(/\s+/).filter(w => w.length > 1);
    const scored = list.map(a => {
      const an = a.name.toLowerCase();
      let score = 0;
      words.forEach(w => {
        if (an.includes(w)) score += 2;
        else if (an.split(/\s+/).some(aw => aw.startsWith(w) || w.startsWith(aw))) score += 1;
      });
      return { a, score };
    }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);
    return scored[0]?.a || null;
  }

  // ── Smart priority score (urgency × priority weight) ──
  function urgencyScore(a, now) {
    const diff = Math.round((new Date(a.dueDate + 'T00:00:00') - now) / 86400000);
    const pw = { high: 3, medium: 2, low: 1 }[a.priority] || 2;
    return (diff < 0 ? 100 + Math.abs(diff) : Math.max(0, 30 - diff)) * pw;
  }

  // ── Parse & execute action block ──
  async function parseAndExecute(rawText, ctx) {
    const match = rawText.match(/```action\s*([\s\S]*?)```/);
    if (!match) return { text: rawText.trim(), actionResult: null };

    const visibleText = rawText.replace(/```action[\s\S]*?```/, '').trim();
    let action;
    try { action = JSON.parse(match[1].trim()); } catch (_) { return { text: visibleText, actionResult: null }; }

    let actionResult = null;

    if (action.type === 'mark_complete') {
      try {
        const list = await DB.getAssignments();
        const asgn = fuzzyFind(list, action.id, action.name);
        if (!asgn)               { actionResult = `⚠️ Couldn't find "${action.name}". Can you give me the exact name?`; }
        else if (asgn.completed) { actionResult = `"${asgn.name}" was already marked done!`; }
        else {
          await DB.toggleComplete(asgn.id, false);
          refreshPage();
          actionResult = `✓ Marked **"${asgn.name}"** complete!`;
        }
      } catch (e) { actionResult = `Failed to mark complete: ${e.message}`; }
    }

    else if (action.type === 'mark_incomplete') {
      try {
        const list = await DB.getAssignments();
        const asgn = fuzzyFind(list, action.id, action.name);
        if (!asgn)                { actionResult = `⚠️ Couldn't find "${action.name}".`; }
        else if (!asgn.completed) { actionResult = `"${asgn.name}" is already marked as pending.`; }
        else {
          await DB.toggleComplete(asgn.id, true);
          refreshPage();
          actionResult = `↩️ Reopened **"${asgn.name}"** — marked as pending again.`;
        }
      } catch (e) { actionResult = `Failed to uncomplete: ${e.message}`; }
    }

    else if (action.type === 'delete_assignment') {
      try {
        const list = await DB.getAssignments();
        const asgn = fuzzyFind(list, action.id, action.name);
        if (!asgn) { actionResult = `⚠️ Couldn't find "${action.name}".`; }
        else {
          await DB.deleteAssignment(asgn.id);
          refreshPage();
          actionResult = `🗑️ Deleted **"${asgn.name}"**.`;
        }
      } catch (e) { actionResult = `Failed to delete: ${e.message}`; }
    }

    else if (action.type === 'add_assignment') {
      try {
        await DB.addAssignment({
          name: action.name, classId: action.class_id || null,
          dueDate: action.due_date, dueTime: '23:59',
          priority: action.priority || 'medium',
          estimatedTime: '1.5', notes: action.notes || ''
        });
        refreshPage();
        const cls = ctx.classes.find(c => c.id === action.class_id);
        actionResult = `📅 Added **"${action.name}"**${cls ? ` for ${cls.name}` : ''} — due ${action.due_date}.`;
      } catch (e) { actionResult = `Failed to add: ${e.message}`; }
    }

    else if (action.type === 'add_class') {
      try {
        const color = _CLASS_COLORS[ctx.classes.length % _CLASS_COLORS.length];
        await DB.addClass({ name: action.name, professor: action.teacher || '', color, icon: 'book-open' });
        refreshPage();
        actionResult = `📚 Added class **"${action.name}"**${action.teacher ? ` with ${action.teacher}` : ''}!`;
      } catch (e) { actionResult = `Failed to add class: ${e.message}`; }
    }

    else if (action.type === 'get_upcoming') {
      const days = action.days || 7;
      const cutoff = new Date(ctx.now); cutoff.setDate(cutoff.getDate() + days);
      const up = ctx.assignments
        .filter(a => !a.completed && new Date(a.dueDate+'T00:00:00') <= cutoff)
        .sort((a,b) => a.dueDate.localeCompare(b.dueDate));
      if (!up.length) { actionResult = `Nothing due in the next ${days} days 🎉`; }
      else {
        actionResult = up.map(a => {
          const cls  = ctx.classes.find(c => c.id === a.classId);
          const diff = Math.round((new Date(a.dueDate+'T00:00:00') - ctx.now) / 86400000);
          return `• ${a.name}${cls ? ` (${cls.name})` : ''} — ${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`}`;
        }).join('\n');
      }
    }

    return { text: visibleText, actionResult };
  }

  // ── Token counter display ──
  function updateTokenUI() {
    const counter = document.getElementById('ai-token-counter');
    if (!counter) return;
    if (typeof DueePlan === 'undefined') { counter.style.display = 'none'; return; }
    const { allowed, remaining, resetIn } = DueePlan.canUseAI();
    if (DueePlan.isPro()) { counter.style.display = 'none'; return; }
    counter.style.display = 'block';
    if (!allowed) {
      counter.innerHTML = `⏱ Resets in <strong>${DueePlan.fmtCountdown(resetIn)}</strong> · <a href="/pricing" style="color:#7c3aed;font-weight:600;">Upgrade</a>`;
      counter.style.color = 'var(--red,#ef4444)';
    } else {
      counter.innerHTML = `${remaining} free AI message${remaining===1?'':'s'} left today · <a href="/pricing" style="color:#7c3aed;font-weight:600;">Upgrade from $2.99/wk</a>`;
      counter.style.color = remaining <= 3 ? 'var(--red,#ef4444)' : 'var(--text-muted,#9ca3af)';
    }
  }

  // ── Main send ──
  async function sendMessage() {
    const input = document.getElementById('ai-input');
    const text  = input?.value.trim();
    if (!text || _thinking) return;

    // ── Check token limit ──
    if (typeof DueePlan !== 'undefined' && !DueePlan.isPro()) {
      const { allowed, remaining, resetIn } = DueePlan.canUseAI();
      if (!allowed) {
        _history.push({ role: 'user', text });
        _history.push({ role: 'bot', text: `⏱ You've used your **20 free AI messages** for today.\n\nResets in **${DueePlan.fmtCountdown(resetIn)}**.\n\n[⚡ Upgrade from $2.99/week](/pricing) for unlimited messages.` });
        input.value = '';
        input.style.height = 'auto';
        renderMessages();
        updateTokenUI();
        return;
      }
    }

    input.value = '';
    input.style.height = 'auto';
    _history.push({ role: 'user', text });
    _thinking = true;
    renderMessages();

    const normalizedText = normalize(text);
    const memChanged = _memExtractUser(text); // use raw text for memory, not normalized

    try {
      const ctx = await buildContext();

      // ── Rule-based FIRST — instant, reliable, no API needed ──
      const ruled = await ruleBasedFallback(normalizedText, ctx);
      if (ruled !== null) {
        _history.push({ role: 'bot', text: ruled });
        _convAutoSave();
        if (typeof DueePlan !== 'undefined') DueePlan.incrementAI();
        _thinking = false;
        renderMessages();
        updateTokenUI();
        return;
      }

      // ── Conversational fallback — call LLM ──
      let llmSucceeded = false;
      try {
        // Run web search in parallel if it looks like a study question
        const webContext = _isStudyQuestion(normalizedText) ? await _webSearch(normalizedText) : null;
        const systemPrompt = buildSystemPrompt(ctx, webContext);
        const apiMessages = _history
          .filter(m => !m._actionOnly)
          .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.role === 'user' ? normalize(m.text) : m.text }));
        const raw = await callAI(apiMessages, systemPrompt);
        if (!raw) {
          _history.push({ role: 'bot', text: `⚡ AI is busy right now — try again in a moment!` });
        } else {
          llmSucceeded = true;
          _memExtractAI(raw);
          const cleanRaw = raw.replace(/\[REMEMBER:[^\]]*\]/gi, '').trim();
          const { text: replyText, actionResult } = await parseAndExecute(cleanRaw, ctx);
          if (replyText) _history.push({ role: 'bot', text: replyText });
          if (actionResult) _history.push({ role: 'bot', text: actionResult, _actionOnly: true });
          _convAutoSave();
        }
      } catch (e) {
        _history.push({ role: 'bot', text: `⚡ AI is busy right now — try again in a moment!` });
      }
      // Only charge a token when AI actually responded
      if (llmSucceeded && typeof DueePlan !== 'undefined') DueePlan.incrementAI();

    } catch (err) {
      _history.push({ role: 'bot', text: `Something went wrong — try again!` });
    }

    _thinking = false;
    renderMessages();
    updateTokenUI();
  }

  // ─────────────────────────────────────────────
  //  RULE-BASED FALLBACK (if API is down)
  // ─────────────────────────────────────────────

  function parseDate(text) {
    const l = text.toLowerCase();
    const today = todayStr();
    if (/\btoday\b/.test(l))     return today;
    if (/\btomorrow\b/.test(l))  return addDays(1);
    if (/\bnext week\b/.test(l)) return addDays(7);
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    for (let i = 0; i < days.length; i++) {
      if (l.includes(days[i])) { const d = (i - new Date().getDay() + 7) % 7 || 7; return addDays(d); }
    }
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    for (let m = 0; m < months.length; m++) {
      const rx = new RegExp(months[m]+'\\w*\\s+(\\d{1,2})'); const match = l.match(rx);
      if (match) { const d = new Date(new Date().getFullYear(), m, parseInt(match[1])); if (d < new Date()) d.setFullYear(d.getFullYear()+1); return d.toISOString().slice(0,10); }
    }
    const inD = l.match(/in\s+(\d+)\s+days?/); if (inD) return addDays(parseInt(inD[1]));
    return addDays(7);
  }

  // Returns a string if handled, null if not matched (LLM handles it)
  async function ruleBasedFallback(text, ctx) {
    const l = text.toLowerCase();
    let list, classes;
    try {
      if (ctx) { list = ctx.assignments; classes = ctx.classes; }
      else { [list, classes] = await Promise.all([DB.getAssignments(), DB.getClasses()]); }
    } catch (_) { list = []; classes = []; }
    const now = new Date(); now.setHours(0,0,0,0);
    const pending = list.filter(a => !a.completed);

    // ── Memory recall ──
    if (/\b(what'?s?\s+my\s+name|do\s+you\s+(know|remember)\s+my\s+name|who\s+am\s+i)\b/.test(l)) {
      const mem = _memLoad();
      return mem.name ? `Your name is **${mem.name}**! 😊` : `I don't know your name yet — what should I call you?`;
    }
    if (/\b(what\s+do\s+you\s+(know|remember)\s+about\s+me|do\s+you\s+remember\s+me|what\s+(have\s+you\s+saved|do\s+you\s+have\s+on\s+me)|my\s+info)\b/.test(l)) {
      const mem = _memLoad();
      const facts = [];
      if (mem.name)          facts.push(`Your name is **${mem.name}**`);
      if (mem.major)         facts.push(`You're studying **${mem.major}**`);
      if (mem.school)        facts.push(`You go to **${mem.school}**`);
      if (mem.notes?.length) mem.notes.forEach(n => facts.push(`You told me: *"${n}"*`));
      const skip = new Set(['name','major','school','notes']);
      Object.entries(mem).forEach(([k,v]) => { if (!skip.has(k) && typeof v === 'string') facts.push(`**${k.replace(/_/g,' ')}**: ${v}`); });
      return facts.length
        ? `Here's what I remember about you:\n${facts.map(f => `• ${f}`).join('\n')}`
        : `I don't have anything saved about you yet. Tell me your name or anything you'd like me to remember!`;
    }
    if (/\b(forget\s+(everything|me|what\s+you\s+know)|clear\s+my\s+(memory|info|data|profile))\b/.test(l)) {
      _memSave({});
      return `Done — I've cleared everything I had saved about you. Fresh start! 🧹`;
    }

    const fmtDiff = (a) => {
      const diff = Math.round((new Date(a.dueDate+'T00:00:00') - now) / 86400000);
      return diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'due TODAY' : diff === 1 ? 'due tomorrow' : `due in ${diff}d`;
    };
    const fmtItem = (a) => {
      const cls = classes.find(c => c.id === a.classId);
      return `• **${a.name}**${cls ? ` (${cls.name})` : ''} — ${fmtDiff(a)}`;
    };

    // ── Complete ──
    if (/\b(done|finished|complete[d]?|turned?\s*in|submitted?|checked?\s*off|mark.*done|did\s+(the|my|it)|i\s+did|just\s+(did|finished)|handed?\s*in|got\s+it\s+done|wrapped\s+up|knocked\s+out|submitted|turned\s+it\s+in)\b/.test(l)) {
      const asgn = fuzzyFind(pending, null, text);
      if (asgn) { await DB.toggleComplete(asgn.id, false); refreshPage(); return `✅ Done! Marked **"${asgn.name}"** as complete.`; }
      if (!pending.length) return `You have no pending assignments — you're all caught up! 🎉`;
      return `Which one did you finish?\n${pending.slice(0,4).map(a => `• ${a.name}`).join('\n')}`;
    }

    // ── Uncomplete ──
    if (/\b(uncomplete|undo|uncheck|unmark|not\s+done|reopen|mark.*incomplete|actually\s+didn.t|haven.t\s+(done|finished)|take\s+it\s+back|i\s+lied|wait\s+no|oops|mistake)\b/.test(l)) {
      const done = list.filter(a => a.completed);
      const asgn = fuzzyFind(done, null, text);
      if (asgn) { await DB.toggleComplete(asgn.id, true); refreshPage(); return `↩️ Got it — **"${asgn.name}"** is back to pending.`; }
      return `Which completed assignment do you want to reopen?`;
    }

    // ── Delete ──
    if (/\b(delete|remove|get\s*rid\s*of|trash|erase|drop|cancel|nuke|kill|take\s+off|i\s+don.t\s+need|dont\s+need)\b/.test(l)) {
      const asgn = fuzzyFind(list, null, text);
      if (asgn) { await DB.deleteAssignment(asgn.id); refreshPage(); return `🗑️ Deleted **"${asgn.name}"**.`; }
      if (!list.length) return `You have no assignments to delete.`;
      return `Which one do you want to delete?\n${list.slice(0,4).map(a => `• ${a.name}`).join('\n')}`;
    }

    // ── Add class ──
    if (/\b(add|create|new|make)\b[\w\s]*(class|course|subject)\b|\b(class|course|subject)\b[\w\s]*(add|create|new)\b/i.test(l)) {
      const color = _CLASS_COLORS[classes.length % _CLASS_COLORS.length];
      // Extract teacher name if mentioned
      const teacherM = text.match(/(?:with|taught\s+by|teacher|professor|prof\.?|mr\.?|ms\.?|mrs\.?|dr\.?)\s+([\w\s.]+?)(?:\s*,|\s*$|\s+and\b)/i);
      const teacher = teacherM ? teacherM[1].trim() : '';
      // Extract class name — strip command words and teacher name
      let name = text
        .replace(/\b(add|create|new|make|a|an|the|class|course|subject|to\s+my\s+(classes|schedule)|please|with|taught\s+by|teacher|professor|prof|mr|ms|mrs|dr)\b/gi, ' ')
        .replace(teacher ? new RegExp(teacher.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi') : /^$/, '')
        .replace(/\s{2,}/g, ' ').trim();
      if (name.length > 1) {
        await DB.addClass({ name, professor: teacher, color, icon: 'book-open' });
        refreshPage();
        return `📚 Added **"${name}"**${teacher ? ` with ${teacher}` : ''} to your classes!`;
      }
      return `What's the class called?`;
    }

    // ── Add ──
    if (/\b(add|create|new\s+(assignment|task|hw|homework)|schedule|remind\s*me|i\s+have\s+(a|an)\s+\w|there.s\s+(a|an)|need\s+to\s+add|make\s+(a|an))\b/.test(l)) {
      const due = parseDate(text);
      const pri = /\b(exam|final|midterm|project|presentation|test)\b/.test(l) ? 'high' : /\b(reading|reflection|quiz|discussion)\b/.test(l) ? 'low' : 'medium';
      const cls = classes.find(c => {
        const cn = c.name.toLowerCase();
        return l.includes(cn) || l.includes(cn.slice(0,4));
      });
      const name = text
        .replace(/\b(add|create|new|schedule|remind\s*me|set|put|i\s+have\s+an?\s*|there.?s\s+an?\s*|need\s+to\s+add|make\s+an?\s*|an?|the|assignment|task|homework|hw|for|due|on|by|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|week|month|in\s+\d+\s+days?|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/gi, ' ')
        .replace(/\d{1,2}(st|nd|rd|th)?/g, '').replace(/\s{2,}/g, ' ').trim();
      if (name.length > 1) {
        await DB.addAssignment({ name, classId: cls?.id || null, dueDate: due, dueTime: '23:59', priority: pri, estimatedTime: '1.5', notes: '' });
        refreshPage();
        return `📅 Added **"${name}"**${cls ? ` for ${cls.name}` : ''} — due ${due}.`;
      }
      return `What should I call the assignment?`;
    }

    // ── What's due / upcoming ──
    if (/\b(upcoming|what.?s?\s*(due|on\s*my\s*list)|what\s+do\s+i\s+have|this\s+week|show\s*(me)?(\s+my)?(\s+assignments)?|list(\s+my)?|my\s+schedule|what.?s\s+next|assignments?(\s+due)?|due\s+soon|overdue)\b/.test(l)) {
      const days = /\b(month|30)\b/.test(l) ? 30 : /\b(two|2)\s*week\b/.test(l) ? 14 : 8;
      const isOverdue = /\boverdue\b/.test(l);
      const cut = new Date(now); cut.setDate(cut.getDate() + days);
      let up = pending.slice();
      up = isOverdue ? up.filter(a => new Date(a.dueDate+'T00:00:00') < now) : up.filter(a => new Date(a.dueDate+'T00:00:00') <= cut);
      up.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
      if (!up.length) return isOverdue ? `Nothing overdue — you're on top of it! 🎉` : `Nothing due in the next ${days === 8 ? 'week' : days + ' days'} 🎉`;
      return (isOverdue ? `Overdue:\n` : `Coming up:\n`) + up.map(fmtItem).join('\n');
    }

    // ── Prioritize / what to do first ──
    if (/\b(priorit|what\s+(should|do)\s+i\s+(do|work|focus|start)|where\s+do\s+i\s+start|most\s+(urgent|important)|first|focus\s+on|what.?s\s+most)\b/.test(l)) {
      if (!pending.length) return `Nothing pending — you're all caught up! 🎉`;
      const ranked = [...pending].sort((a,b) => urgencyScore(b,now) - urgencyScore(a,now)).slice(0,5);
      return `Here's what to tackle first:\n` + ranked.map((a,i) => {
        const num = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'][i];
        return `${num} ${fmtItem(a)}`;
      }).join('\n');
    }

    // ── How much time / time estimate ──
    if (/\b(how\s+(long|much\s+time)|time\s+(estimate|left|needed?)|hours?|estimate)\b/.test(l)) {
      const total = pending.reduce((s,a) => s + parseFloat(a.estimatedTime || 1.5), 0);
      const urgent = pending.filter(a => Math.round((new Date(a.dueDate+'T00:00:00')-now)/86400000) <= 3);
      const urgentHrs = urgent.reduce((s,a) => s + parseFloat(a.estimatedTime || 1.5), 0);
      return `You have ~**${total.toFixed(1)} hours** of work across ${pending.length} assignment${pending.length!==1?'s':''}.\n${urgent.length ? `⚠️ **${urgentHrs.toFixed(1)}h** is due within 3 days — prioritize those first!` : `Nothing super urgent in the next 3 days 👍`}`;
    }

    // ── Plan my week ──
    if (/\b(plan|schedule|organize|help\s+me\s+plan|study\s+plan|week\s+plan|break\s+(it\s+)?down)\b/.test(l)) {
      if (!pending.length) return `Your slate is clean — nothing to plan right now! 🎉`;
      const days7 = pending.filter(a => Math.round((new Date(a.dueDate+'T00:00:00')-now)/86400000) <= 7);
      if (!days7.length) return `Nothing due this week. Here are your upcoming:\n` + pending.slice(0,4).map(fmtItem).join('\n');
      const ranked = [...days7].sort((a,b) => urgencyScore(b,now) - urgencyScore(a,now));
      return `This week's game plan:\n` + ranked.map(fmtItem).join('\n') + `\n\nStart from the top and work down 💪`;
    }

    // ── Stats / progress ──
    if (/\b(how\s+am\s+i\s+(doing|going)|progress|stats?|completion|percent|track)\b/.test(l)) {
      const total = list.length, done = list.filter(a=>a.completed).length;
      const pct = total ? Math.round(done/total*100) : 0;
      const overdue = pending.filter(a => new Date(a.dueDate+'T00:00:00') < now).length;
      return `You've completed **${done}/${total}** assignments (${pct}%).\n${overdue > 0 ? `⚠️ ${overdue} overdue` : `No overdue assignments`} · ${pending.length} still pending.`;
    }

    // ── Stress / overwhelmed ──
    if (/\b(stress|overwhelm|anxious|so\s+much|panic|too\s+many|worried|freaking?\s+out|behind|can.?t\s+do|screwed|dying|dead)\b/.test(l)) {
      if (!pending.length) return `Your list is actually empty right now — you're more on top of it than you think! Take a breath 💪`;
      const ranked = [...pending].sort((a,b) => urgencyScore(b,now) - urgencyScore(a,now));
      const top = ranked[0];
      const cls = classes.find(c => c.id === top.classId);
      return `You've got ${pending.length} pending, but let's focus on one thing at a time.\n\nMost urgent right now:\n**"${top.name}"**${cls ? ` (${cls.name})` : ''} — ${fmtDiff(top)}\n\nStart there. You've got this 💪`;
    }

    // ── Greetings ──
    if (/^(hey+|hi+|hello|sup|yo+|what.?s\s*up|heyy+|hiii+|wassup|wsp)\b/.test(l.trim())) {
      const overdue = pending.filter(a => new Date(a.dueDate+'T00:00:00') < now).length;
      if (overdue > 0) return `Hey! 👋 You've got **${overdue} overdue assignment${overdue!==1?'s':''}** — want to see them?`;
      if (pending.length) return `Hey! You've got **${pending.length} pending assignment${pending.length!==1?'s':''}**. Want to see what's coming up?`;
      return `Hey! Your list is all clear 🎉 Need to add anything?`;
    }

    // ── Count ──
    if (/\b(how\s+many|count|total)\b/.test(l) && /\b(assignment|task|homework|hw|class|pending|due)\b/.test(l)) {
      return `You have **${pending.length} pending assignment${pending.length!==1?'s':''}** right now.`;
    }

    // ── Study tips ──
    if (/\b(study\s*tips?|how\s+(to|do\s+i)\s+study|advice|tips\s+for)\b/.test(l)) {
      return `Top study tips:\n• **Pomodoro**: 25 min focus, 5 min break — repeat\n• **Active recall**: close your notes and test yourself\n• **Start hardest first**: tackle the tough stuff when energy is high\n• **One task at a time**: multitasking tanks productivity`;
    }

    return null; // no match — let LLM try
  }

  // ─────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function mdToHtml(s) {
    // Strip LaTeX $$ wrappers, keep the expression
    s = s.replace(/\$\$([^$]+)\$\$/g, '$1');
    // Strip inline $ math
    s = s.replace(/\$([^$\n]+)\$/g, '$1');
    // Remove <think>...</think> blocks
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    const lines = s.split('\n');
    const out = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      let l = escHtml(lines[i]);

      // Apply inline markdown (bold, italic, code, links)
      l = l.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
      l = l.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      l = l.replace(/\*(.+?)\*/g, '<em>$1</em>');
      l = l.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px;font-family:monospace;">$1</code>');
      l = l.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#7c3aed;font-weight:600;">$1</a>');

      // Block-level
      if (/^#{3}\s+(.+)/.test(l)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<div style="font-size:13px;font-weight:700;margin:8px 0 4px;">${l.replace(/^#{3}\s+/,'')}</div>`);
      } else if (/^#{2}\s+(.+)/.test(l)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<div style="font-size:14px;font-weight:700;margin:8px 0 4px;">${l.replace(/^#{2}\s+/,'')}</div>`);
      } else if (/^#{1}\s+(.+)/.test(l)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<div style="font-size:15px;font-weight:800;margin:8px 0 4px;">${l.replace(/^#\s+/,'')}</div>`);
      } else if (/^(-{3,}|\*{3,})$/.test(lines[i].trim())) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0;">');
      } else if (/^[-*•]\s+/.test(l)) {
        if (!inList) { out.push('<ul style="margin:4px 0;padding-left:18px;">'); inList = true; }
        out.push(`<li style="margin:2px 0;">${l.replace(/^[-*•]\s+/,'')}</li>`);
      } else if (/^\d+\.\s+/.test(l)) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<div style="margin:2px 0;">${l}</div>`);
      } else if (l.trim() === '') {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<br>');
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(l + '<br>');
      }
    }
    if (inList) out.push('</ul>');
    return out.join('').replace(/(<br>){3,}/g,'<br><br>').replace(/^<br>|<br>$/g,'');
  }

  const _COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  function renderMessages() {
    const c = document.getElementById('ai-messages');
    if (!c) return;
    const nowMs = new Date().setHours(0,0,0,0);
    c.innerHTML = _history.map((m, i) => {
      if (m._isSuggestions) {
        const cards = (m.suggestions || []).map(s => {
          const diff = Math.round((new Date(s.dueDate + 'T00:00:00') - nowMs) / 86400000);
          const when = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`;
          const safe = s.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
          return `<button class="ai-suggest-btn" onclick="window._aiAskHelp('${s.id}','${safe}')">
            <span class="ai-suggest-name">${escHtml(s.name)}</span>
            <span class="ai-suggest-due">due ${when} →</span>
          </button>`;
        }).join('');
        return `<div class="ai-msg ai-msg-bot" style="flex-direction:column;gap:6px;max-width:100%;">
          <div style="font-size:12px;font-weight:600;color:var(--text-secondary,#64748b);padding-left:2px;">📚 Need help with an assignment?</div>
          <div class="ai-suggest-cards">${cards}</div>
        </div>`;
      }
      if (m.role === 'user') return `<div class="ai-msg ai-msg-user"><div class="ai-bubble ai-bubble-user">${escHtml(m.text)}</div></div>`;
      return `<div class="ai-msg ai-msg-bot"><div class="ai-bubble-wrap"><div class="ai-bubble ai-bubble-bot">${mdToHtml(m.text)}</div><button class="ai-copy-btn" data-copy-idx="${i}" onclick="window._aiCopy(${i})" title="Copy answer">${_COPY_SVG} Copy</button></div></div>`;
    }).join('') + (_thinking ? `<div class="ai-msg ai-msg-bot"><div class="ai-bubble ai-bubble-bot ai-typing"><span></span><span></span><span></span></div></div>` : '');
    c.scrollTop = c.scrollHeight;
  }

  // ─────────────────────────────────────────────
  //  TOGGLE + CLEAR
  // ─────────────────────────────────────────────

  window.toggleAIChat = function () {
    _open = !_open;
    const panel = document.getElementById('ai-panel');
    const fab   = document.getElementById('ai-fab');
    if (!panel || !fab) return;
    panel.style.display = _open ? 'flex' : 'none';
    fab.innerHTML = _open
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      : `<span style="font-size:22px;line-height:1;">✦</span>`;
    if (_open) {
      if (_history.length === 0) {
        _convId = 'c' + Date.now();
        _history.push({ role: 'bot', text: "Hey! I'm your AI study assistant ✦\n\nI can help you with:\n\n**📚 Homework & Study Questions**\n• \"Solve 3x + 5 = 20\"\n• \"Explain photosynthesis\"\n• \"Help me outline my essay\"\n\n**✅ Assignment Management**\n• \"I finished my bio lab\" — mark done\n• \"Add a quiz due Friday\"\n• \"What's due this week?\"\n\n**🏫 Class Management**\n• \"Add a Biology class\"\n• \"Add English with Mr. Smith\"\n• \"Create a new Math course\"\n\nAsk me anything!" });
        renderMessages();
        // Load pending assignments and show suggestion cards
        buildContext().then(ctx => {
          if (_history.length !== 1) return; // user already typed something
          const upcoming = ctx.pending.filter(a => {
            const diff = Math.round((new Date(a.dueDate + 'T00:00:00') - ctx.now) / 86400000);
            return diff <= 14;
          });
          if (!upcoming.length) return;
          _history.push({
            role: 'bot', _isSuggestions: true,
            suggestions: upcoming.slice(0, 3).map(a => ({ id: a.id, name: a.name, dueDate: a.dueDate }))
          });
          renderMessages();
        }).catch(() => {});
      }
      updateTokenUI();
      setTimeout(() => document.getElementById('ai-input')?.focus(), 80);
    }
  };

  window._aiAskHelp = function(id, name) {
    // Remove suggestion cards, keep welcome message
    _history = _history.filter(m => !m._isSuggestions);
    const input = document.getElementById('ai-input');
    if (!input) return;
    input.value = `Help me with my assignment: "${name}"`;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    renderMessages();
    document.getElementById('ai-send')?.click();
  };

  window._aiClear = function () { _history = []; _convId = 'c' + Date.now(); _showHistPanel(false); renderMessages(); };
  window._aiToggleHistory = function () { _showHistPanel(!_histOpen); };
  window._aiNewChat = function () { _history = []; _convId = 'c' + Date.now(); _showHistPanel(false); renderMessages(); };
  window._aiLoadConv = function (id) {
    const conv = _convsLoad().find(c => c.id === id);
    if (!conv) return;
    _history = [...conv.messages]; _convId = id;
    _showHistPanel(false); renderMessages();
    if (typeof updateTokenUI === 'function') updateTokenUI();
  };
  window._aiDelConv = function (id) { _convsSave(_convsLoad().filter(c => c.id !== id)); renderHistoryPanel(); };

  window._aiCopy = function(i) {
    const msg = _history[i];
    if (!msg) return;
    const plain = msg.text
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#{1,3}\s+/gm, '').trim();
    navigator.clipboard.writeText(plain).then(() => {
      const btn = document.querySelector(`[data-copy-idx="${i}"]`);
      if (!btn) return;
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
      btn.style.color = '#22c55e'; btn.style.opacity = '1';
      setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.style.opacity = ''; }, 1800);
    }).catch(() => {});
  };

  // ─────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────

  function initAIWidget() {
    const style = document.createElement('style');
    style.textContent = `
      #ai-fab{position:fixed;bottom:24px;right:24px;z-index:9999;width:52px;height:52px;border-radius:50%;border:none;background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(124,58,237,0.4);transition:transform 0.15s,box-shadow 0.15s;}
      #ai-fab:hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(124,58,237,0.5);}
      #ai-panel{position:fixed;bottom:88px;right:24px;z-index:9998;width:340px;height:480px;background:var(--bg-white,#fff);border:1px solid var(--border,#e2e8f0);border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,0.15);display:none;flex-direction:column;overflow:hidden;animation:aiSlideIn 0.2s ease;}
      @keyframes aiSlideIn{from{opacity:0;transform:translateY(12px) scale(0.97);}to{opacity:1;transform:none;}}
      #ai-panel-header{padding:14px 16px;border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#7c3aed0a,#2563eb0a);flex-shrink:0;}
      .ai-header-icon{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#2563eb);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}
      .ai-header-info{flex:1;min-width:0;}
      .ai-header-name{font-size:14px;font-weight:700;color:var(--text-primary,#0f172a);}
      .ai-header-sub{font-size:11px;color:var(--text-secondary,#64748b);}
      .ai-hbtn{background:none;border:none;cursor:pointer;padding:4px;color:var(--text-secondary,#64748b);border-radius:6px;display:flex;align-items:center;}
      .ai-hbtn:hover{background:var(--bg-hover,#f1f5f9);}
      #ai-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}
      #ai-messages::-webkit-scrollbar{width:4px;}
      #ai-messages::-webkit-scrollbar-thumb{background:var(--border,#e2e8f0);border-radius:4px;}
      .ai-msg{display:flex;max-width:100%;}
      .ai-msg-user{justify-content:flex-end;}
      .ai-msg-bot{justify-content:flex-start;}
      .ai-bubble{max-width:82%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.55;word-break:break-word;}
      .ai-bubble-user{background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;border-bottom-right-radius:4px;}
      .ai-bubble-bot{background:var(--bg-hover,#f1f5f9);color:var(--text-primary,#0f172a);border-bottom-left-radius:4px;}
      .ai-bubble-wrap{display:flex;flex-direction:column;align-items:flex-start;max-width:82%;}
      .ai-bubble-wrap .ai-bubble{max-width:100%;}
      .ai-copy-btn{background:none;border:none;cursor:pointer;padding:2px 7px;color:var(--text-muted,#94a3b8);border-radius:5px;display:flex;align-items:center;gap:3px;margin-top:4px;opacity:0.55;transition:opacity 0.15s,color 0.15s;font-size:11px;font-family:inherit;line-height:1;}
      .ai-copy-btn:hover{opacity:1;color:var(--text-secondary,#64748b);background:var(--bg-hover,#f1f5f9);}
      #ai-hist-panel{display:none;flex-direction:column;flex:1;overflow:hidden;}
      #ai-hist-panel-header{padding:10px 14px;border-bottom:1px solid var(--border,#e2e8f0);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
      #ai-hist-list{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;}
      .ai-hist-item{position:relative;padding:10px 12px;border-radius:10px;cursor:pointer;border:1px solid var(--border,#e2e8f0);background:var(--bg-white,#fff);transition:background 0.15s;}
      .ai-hist-item:hover{background:var(--bg-hover,#f1f5f9);}
      .ai-hist-title{font-size:13px;font-weight:500;color:var(--text-primary,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:22px;}
      .ai-hist-meta{font-size:11px;color:var(--text-muted,#94a3b8);margin-top:3px;}
      .ai-hist-del{position:absolute;top:50%;right:8px;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:3px;color:var(--text-muted,#94a3b8);border-radius:4px;opacity:0;transition:opacity 0.15s;display:flex;align-items:center;}
      .ai-hist-item:hover .ai-hist-del{opacity:1;}
      .ai-hist-del:hover{color:var(--red,#ef4444);}
      .ai-typing{display:flex;align-items:center;gap:4px;min-width:48px;}
      .ai-typing span{width:6px;height:6px;border-radius:50%;background:var(--text-secondary,#94a3b8);animation:aiDot 1.2s infinite ease-in-out;display:inline-block;}
      .ai-typing span:nth-child(2){animation-delay:0.2s;}
      .ai-typing span:nth-child(3){animation-delay:0.4s;}
      @keyframes aiDot{0%,60%,100%{transform:scale(0.7);opacity:0.5;}30%{transform:scale(1);opacity:1;}}
      #ai-input-area{padding:10px 12px;border-top:1px solid var(--border,#e2e8f0);display:flex;gap:8px;align-items:flex-end;flex-shrink:0;}
      #ai-input{flex:1;border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:8px 12px;font-size:13px;resize:none;outline:none;background:var(--bg-main,#f8fafc);color:var(--text-primary,#0f172a);font-family:inherit;line-height:1.4;max-height:80px;transition:border-color 0.15s;}
      #ai-input:focus{border-color:#7c3aed;}
      #ai-send{width:34px;height:34px;border-radius:50%;border:none;flex-shrink:0;background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.1s,opacity 0.1s;}
      #ai-send:hover{transform:scale(1.08);}
      #ai-send:disabled{opacity:0.4;cursor:default;transform:none;}
      .ai-suggest-cards{display:flex;flex-direction:column;gap:6px;width:100%;}
      .ai-suggest-btn{width:100%;text-align:left;background:var(--bg-white,#fff);border:1px solid var(--border,#e2e8f0);border-radius:10px;padding:9px 12px;cursor:pointer;font-family:inherit;transition:all 0.15s;display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .ai-suggest-btn:hover{border-color:#7c3aed;background:#faf5ff;transform:translateX(2px);}
      .ai-suggest-name{font-size:13px;font-weight:600;color:var(--text-primary,#0f172a);text-align:left;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ai-suggest-due{font-size:11px;color:#7c3aed;font-weight:600;white-space:nowrap;flex-shrink:0;}
      [data-theme="dark"] #ai-panel{background:#1e293b;border-color:var(--border);}
      [data-theme="dark"] .ai-bubble-bot{background:#2d3f55;}
      [data-theme="dark"] #ai-input{background:#0f172a;border-color:var(--border);}
      [data-theme="dark"] #ai-panel-header{background:#1e293b;}
      [data-theme="dark"] .ai-hbtn:hover{background:#2d3f55;}
      [data-theme="dark"] .ai-suggest-btn{background:#2d3f55;border-color:var(--border);}
      [data-theme="dark"] .ai-suggest-btn:hover{border-color:#7c3aed;background:#3d2065;}
    `;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'ai-fab'; fab.title = 'Study Assistant';
    fab.onclick = window.toggleAIChat;
    fab.innerHTML = `<span style="font-size:22px;line-height:1;">✦</span>`;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'ai-panel';
    panel.innerHTML = `
      <div id="ai-panel-header">
        <div class="ai-header-icon">✦</div>
        <div class="ai-header-info">
          <div class="ai-header-name">Study Assistant</div>
          <div class="ai-header-sub">Powered by LiquidAI ✦</div>
        </div>
        <button class="ai-hbtn" title="Chat history" onclick="window._aiToggleHistory()">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
        <button class="ai-hbtn" title="Clear chat" onclick="window._aiClear()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.49"/></svg>
        </button>
        <button class="ai-hbtn" onclick="window.toggleAIChat()" title="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div id="ai-messages"></div>
      <div id="ai-hist-panel">
        <div id="ai-hist-panel-header">
          <span style="font-size:13px;font-weight:700;color:var(--text-primary,#0f172a);">Chat History</span>
          <button onclick="window._aiNewChat()" style="background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;border:none;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;">+ New Chat</button>
        </div>
        <div id="ai-hist-list"></div>
      </div>
      <div id="ai-token-counter" style="display:none;font-size:11px;text-align:center;padding:4px 12px 0;"></div>
      <div id="ai-input-area">
        <textarea id="ai-input" rows="1" placeholder="Ask me anything…" maxlength="600"></textarea>
        <button id="ai-send" title="Send">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>`;
    document.body.appendChild(panel);

    const inputEl = document.getElementById('ai-input');
    const sendBtn = document.getElementById('ai-send');
    inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px'; });
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
    sendBtn.addEventListener('click', doSend);
    function doSend() {
      if (_thinking) return;
      sendBtn.disabled = true;
      sendMessage().finally(() => { sendBtn.disabled = false; });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAIWidget);
  } else {
    initAIWidget();
  }

  // Expose so plan.js can refresh counter after async DB sync
  window.updateTokenUI = updateTokenUI;
})();
