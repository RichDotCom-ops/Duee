// duee. — AI Study Assistant (powered by LiquidAI via OpenRouter)

(function () {
  const OR_KEY   = atob('c2stb3ItdjEtMGIwZjA5ZWI1NmRhOGYyMzc1M2M4ZmQzNDExZTE3MTQwMjc4ZWFmYjYxMjc2NjBhMWJmZTgxZjU1NjRkMDAxOQ==');
  const OR_MODEL = 'openai/gpt-oss-20b:free';
  const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';

  // ── State ──
  let _open     = false;
  let _thinking = false;
  let _history  = []; // { role, text } for display + { role, content } for API

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

  function buildSystemPrompt(ctx) {
    const { classes, assignments, pending, now } = ctx;
    const clsLines = classes.length
      ? classes.map(c => `  • ${c.name} [id:${c.id}]`).join('\n')
      : '  (none)';
    const allLines = assignments.slice(0,30).map(a => {
      const cls  = classes.find(c => c.id === a.classId);
      const diff = Math.round((new Date(a.dueDate+'T00:00:00') - now) / 86400000);
      const when = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'TODAY' : diff === 1 ? 'tomorrow' : `in ${diff}d`;
      return `  • [id:${a.id}] "${a.name}" | ${cls?.name||'No class'} | ${a.dueDate} (${when}) | ${a.priority} | ${a.completed ? 'DONE' : 'pending'}`;
    }).join('\n') || '  (none)';

    return `You are a smart, friendly AI study assistant inside duee., a student planner app.
Today is ${todayStr()} (${new Date().toLocaleDateString('en-US',{weekday:'long'})}).

Student's classes:
${clsLines}

All assignments:
${allLines}

ACTIONS — output ONE action block at the very end of your reply when the user wants something done.

━━ MARK COMPLETE ━━
User might say: "done", "finished", "turned in", "submitted", "checked off", "i did it", "completed", "knocked it out", "wrapped up", "got it done", "just did", "handed in"
\`\`\`action
{"type":"mark_complete","id":"<id>","name":"<name>"}
\`\`\`

━━ MARK INCOMPLETE / UNDO ━━
User might say: "undo", "uncomplete", "not done", "reopen", "uncheck", "actually didn't", "i lied", "mark as pending", "take it back", "haven't done it yet"
\`\`\`action
{"type":"mark_incomplete","id":"<id>","name":"<name>"}
\`\`\`

━━ DELETE / REMOVE ━━
User might say: "delete", "remove", "get rid of", "trash", "erase", "drop", "cancel", "take off", "nuke", "kill", "i don't need", "remove it"
\`\`\`action
{"type":"delete_assignment","id":"<id>","name":"<name>"}
\`\`\`

━━ ADD NEW ━━
User might say: "add", "create", "new", "schedule", "remind me", "set", "put", "i have a", "there's a", "need to add", "make a"
\`\`\`action
{"type":"add_assignment","name":"<clean title>","due_date":"<YYYY-MM-DD>","priority":"<high|medium|low>","class_id":"<matching class id or empty>","notes":""}
\`\`\`

━━ SHOW UPCOMING ━━
User might say: "what's due", "what do i have", "upcoming", "this week", "show me", "what's on my list", "my schedule", "what's next"
\`\`\`action
{"type":"get_upcoming","days":<7 or 14 or 30>}
\`\`\`

RULES:
- People speak casually — "essay done", "did the bio hw", "yoo remove calc quiz", "bro add chemistry tmrw" all mean something. Figure out the intent.
- Match assignments by name similarity. Pick the CLOSEST match from the list.
- Dates: compute exact YYYY-MM-DD. "tomorrow"=${addDays(1)}, "next week"=${addDays(7)}, "in 3 days"=${addDays(3)}, "Friday"=next Friday, "Monday"=next Monday, etc.
- Priority: exam/midterm/final/project = high. quiz/reading/reflection = low. else medium.
- Be warm and brief — 1 sentence reply + action block.
- Never show the action JSON to the user.
- If truly ambiguous which assignment, ask ONE short question.`;
  }

  // ── Call OpenRouter ──
  async function callAI(apiMessages, systemPrompt) {
    const res = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OR_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://duee.app',
        'X-Title':       'duee.'
      },
      body: JSON.stringify({
        model: OR_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...apiMessages],
        temperature: 0.7,
        max_tokens: 600
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `API error ${res.status}`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // ── Fuzzy assignment finder: match by id first, then name keywords ──
  function fuzzyFind(list, id, name) {
    if (id) {
      const byId = list.find(a => a.id === id);
      if (byId) return byId;
    }
    if (!name) return null;
    const words = name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return list
      .map(a => ({ a, score: words.filter(w => a.name.toLowerCase().includes(w)).length }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.a || null;
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
      counter.innerHTML = `${remaining} free AI message${remaining===1?'':'s'} left today · <a href="/pricing" style="color:#7c3aed;font-weight:600;">Go Pro</a>`;
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
        _history.push({ role: 'bot', text: `⏱ You've used your **10 free AI messages** for today.\n\nResets in **${DueePlan.fmtCountdown(resetIn)}**.\n\n[✦ Upgrade to Pro](/pricing) for unlimited messages.` });
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

    try {
      const ctx = await buildContext();
      const systemPrompt = buildSystemPrompt(ctx);

      // Build API message list from history (exclude bot-injected action results)
      const apiMessages = _history
        .filter(m => !m._actionOnly)
        .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.role === 'user' ? normalize(m.text) : m.text }));

      const raw = await callAI(apiMessages, systemPrompt);
      const { text: replyText, actionResult } = await parseAndExecute(raw, ctx);

      if (replyText) _history.push({ role: 'bot', text: replyText });
      if (actionResult) _history.push({ role: 'bot', text: actionResult, _actionOnly: true });
      if (typeof DueePlan !== 'undefined') DueePlan.incrementAI();

    } catch (err) {
      if (err.status === 429) {
        // Rate limited — try rule-based first, then friendly message
        try {
          const fallback = await ruleBasedFallback(normalizedText);
          _history.push({ role: 'bot', text: fallback });
          if (typeof DueePlan !== 'undefined') DueePlan.incrementAI();
        } catch (_) {
          _history.push({ role: 'bot', text: `I'm getting a lot of requests right now — try again in a second!` });
        }
      } else {
        // Other API error — still try rule-based
        try {
          const fallback = await ruleBasedFallback(normalizedText);
          _history.push({ role: 'bot', text: fallback });
          if (typeof DueePlan !== 'undefined') DueePlan.incrementAI();
        } catch (_) {
          _history.push({ role: 'bot', text: `Something went wrong — try again!` });
        }
      }
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

  async function ruleBasedFallback(text) {
    const l = text.toLowerCase();
    const list = await DB.getAssignments();
    const classes = await DB.getClasses();

    // ── Complete ──
    if (/\b(done|finished|complete[d]?|turned?\s*in|submitted?|checked?\s*off|mark.*done|did\s+my|i\s+did)\b/.test(l)) {
      const asgn = fuzzyFind(list.filter(a => !a.completed), null, text);
      if (asgn) { await DB.toggleComplete(asgn.id, false); refreshPage(); return `✓ Marked **"${asgn.name}"** complete!`; }
      return `Which assignment did you finish? I couldn't find a match.`;
    }

    // ── Uncomplete ──
    if (/\b(uncomplete|undo|uncheck|unmark|not\s+done|reopen|incomplete|mark.*incomplete|didn.t|haven.t)\b/.test(l)) {
      const asgn = fuzzyFind(list.filter(a => a.completed), null, text);
      if (asgn) { await DB.toggleComplete(asgn.id, true); refreshPage(); return `↩️ Reopened **"${asgn.name}"** — marked as pending again.`; }
      return `Which assignment do you want to reopen?`;
    }

    // ── Delete ──
    if (/\b(delete|remove|get\s*rid\s*of|trash|erase|drop|cancel)\b/.test(l)) {
      const asgn = fuzzyFind(list, null, text);
      if (asgn) { await DB.deleteAssignment(asgn.id); refreshPage(); return `🗑️ Deleted **"${asgn.name}"**.`; }
      return `Which assignment do you want to delete?`;
    }

    // ── Add ──
    if (/\b(add|create|new|schedule|remind|set|put)\b/.test(l)) {
      const due  = parseDate(text);
      const pri  = /\b(urgent|important|critical|exam|final|midterm)\b/.test(l) ? 'high' : /\b(reading|quiz|small)\b/.test(l) ? 'low' : 'medium';
      const cls  = classes.find(c => l.includes(c.name.toLowerCase().slice(0,4)));
      const name = text
        .replace(/\b(add|create|new|schedule|remind\s*me|set|put|an?|the|assignment|task|for|due|on|by|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|week|month)\b/gi, '')
        .replace(/[^a-zA-Z0-9\s]/g, '').trim();
      if (name.length > 1) {
        await DB.addAssignment({ name, classId: cls?.id || null, dueDate: due, dueTime:'23:59', priority: pri, estimatedTime:'1.5', notes:'' });
        refreshPage();
        return `📅 Added **"${name}"**${cls ? ` for ${cls.name}` : ''} — due ${due}.`;
      }
      return `What should I call the assignment?`;
    }

    // ── Upcoming ──
    if (/\b(upcoming|what.*due|what.*have|this\s*week|today|schedule|show|list)\b/.test(l)) {
      const now = new Date(); now.setHours(0,0,0,0);
      const days = /\b(month|30\s*day)\b/.test(l) ? 30 : /\b(two|2)\s*week\b/.test(l) ? 14 : 8;
      const cut  = new Date(now); cut.setDate(cut.getDate() + days);
      const up   = list.filter(a => !a.completed && new Date(a.dueDate+'T00:00:00') <= cut).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
      if (!up.length) return `Nothing due in the next ${days === 8 ? 'week' : days + ' days'} 🎉`;
      return `Coming up:\n` + up.map(a => {
        const cls  = classes.find(c => c.id === a.classId);
        const diff = Math.round((new Date(a.dueDate+'T00:00:00') - now) / 86400000);
        return `• ${a.name}${cls ? ` (${cls.name})` : ''} — ${diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`}`;
      }).join('\n');
    }

    // ── Study tips ──
    if (/\b(study|tips?|how\s+do\s+i|help\s+me|advice|prepare)\b/.test(l)) {
      return `Study tips:\n• **Pomodoro**: 25 min focus, 5 min break — repeat.\n• **Active recall**: test yourself instead of re-reading.\n• **Teach it**: explain the topic out loud to find gaps.`;
    }

    // ── Stress / motivation ──
    if (/\b(stress|overwhelm|anxious|behind|so much|panic|can.t|too many|worried)\b/.test(l)) {
      const count = list.filter(a => !a.completed).length;
      return count > 0
        ? `You've got ${count} thing${count !== 1 ? 's' : ''} pending — start with the nearest deadline and knock them out one at a time. You got this!`
        : `Looks like your list is actually clear! Take a breath — you're more on top of it than you think.`;
    }

    // ── Greetings ──
    if (/^(hey|hi|hello|sup|yo|what.?s up|heyy+|hiii+)\b/.test(l.trim())) {
      const count = list.filter(a => !a.completed).length;
      return count > 0
        ? `Hey! You've got **${count} pending assignment${count !== 1 ? 's' : ''}**. Want to see what's due soon?`
        : `Hey! Your assignment list is looking clear 🎉 Anything you need to add?`;
    }

    return `Got it! Just tell me what you need — like "I finished my essay", "delete my math quiz", "what's due this week", or "add a quiz due Friday".`;
  }

  // ─────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
  }
  function mdToHtml(s) {
    return escHtml(s)
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" style="color:#7c3aed;font-weight:600;">$1</a>');
  }

  function renderMessages() {
    const c = document.getElementById('ai-messages');
    if (!c) return;
    c.innerHTML = _history.map(m =>
      m.role === 'user'
        ? `<div class="ai-msg ai-msg-user"><div class="ai-bubble ai-bubble-user">${escHtml(m.text)}</div></div>`
        : `<div class="ai-msg ai-msg-bot"><div class="ai-bubble ai-bubble-bot">${mdToHtml(m.text)}</div></div>`
    ).join('') + (_thinking ? `<div class="ai-msg ai-msg-bot"><div class="ai-bubble ai-bubble-bot ai-typing"><span></span><span></span><span></span></div></div>` : '');
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
        _history.push({ role: 'bot', text: "Hey! I'm your AI study assistant ✦\n\nJust talk to me naturally:\n• **\"I finished my essay\"** — mark it done\n• **\"Undo my bio quiz\"** — mark incomplete\n• **\"Remove my math hw\"** — delete it\n• **\"Add a quiz due Friday\"** — add to list\n• **\"What's due this week?\"** — see upcoming\n\nWhat do you need?" });
        renderMessages();
      }
      updateTokenUI();
      setTimeout(() => document.getElementById('ai-input')?.focus(), 80);
    }
  };

  window._aiClear = function () { _history = []; renderMessages(); };

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
      [data-theme="dark"] #ai-panel{background:#1e293b;border-color:var(--border);}
      [data-theme="dark"] .ai-bubble-bot{background:#2d3f55;}
      [data-theme="dark"] #ai-input{background:#0f172a;border-color:var(--border);}
      [data-theme="dark"] #ai-panel-header{background:#1e293b;}
      [data-theme="dark"] .ai-hbtn:hover{background:#2d3f55;}
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
        <button class="ai-hbtn" title="Clear chat" onclick="window._aiClear()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.49"/></svg>
        </button>
        <button class="ai-hbtn" onclick="window.toggleAIChat()" title="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div id="ai-messages"></div>
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
})();
