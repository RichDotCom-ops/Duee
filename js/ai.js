// duee. — AI Study Assistant (powered by LiquidAI via OpenRouter)

(function () {
  const OR_KEY    = atob('c2stb3ItdjEtMGIwZjA5ZWI1NmRhOGYyMzc1M2M4ZmQzNDExZTE3MTQwMjc4ZWFmYjYxMjc2NjBhMWJmZTgxZjU1NjRkMDAxOQ==');
  const OR_MODELS = [
    'nvidia/nemotron-nano-9b-v2:free',
    'mistralai/mistral-7b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen3-8b:free',
  ];
  const OR_URL    = 'https://openrouter.ai/api/v1/chat/completions';

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
    const { classes, pending, now } = ctx;
    const upcoming = pending.slice(0,8).map(a => {
      const cls = classes.find(c => c.id === a.classId);
      const diff = Math.round((new Date(a.dueDate+'T00:00:00') - now) / 86400000);
      const when = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff}d`;
      return `${a.name}${cls ? ` (${cls.name})` : ''} — ${when}`;
    }).join(', ') || 'none';

    return `You are duee.'s friendly AI study assistant. Today: ${todayStr()}.
Student's pending assignments: ${upcoming}.
Reply in 1-2 warm, casual sentences. Be encouraging and helpful. No lists unless asked.`;
  }

  // ── Call OpenRouter — tries each model until one works ──
  async function callAI(apiMessages, systemPrompt) {
    for (const model of OR_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(OR_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${OR_KEY}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'https://duee.online',
            'X-Title':       'duee.'
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: systemPrompt }, ...apiMessages],
            temperature: 0.6,
            max_tokens: 250
          })
        });
        clearTimeout(timer);
        if (!res.ok) continue; // try next model
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) return content;
      } catch (_) {
        clearTimeout(timer);
        // try next model
      }
    }
    return null; // all models failed
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

      // ── Rule-based FIRST — instant, reliable, no API needed ──
      const ruled = await ruleBasedFallback(normalizedText, ctx);
      if (ruled !== null) {
        _history.push({ role: 'bot', text: ruled });
        if (typeof DueePlan !== 'undefined') DueePlan.incrementAI();
        _thinking = false;
        renderMessages();
        updateTokenUI();
        return;
      }

      // ── Conversational fallback — call LLM only for open-ended messages ──
      try {
        const systemPrompt = buildSystemPrompt(ctx);
        const apiMessages = _history
          .filter(m => !m._actionOnly)
          .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.role === 'user' ? normalize(m.text) : m.text }));
        const raw = await callAI(apiMessages, systemPrompt);
        const { text: replyText, actionResult } = await parseAndExecute(raw, ctx);
        if (replyText) _history.push({ role: 'bot', text: replyText });
        if (actionResult) _history.push({ role: 'bot', text: actionResult, _actionOnly: true });
        if (!replyText && !actionResult) _history.push({ role: 'bot', text: `Got it! Tell me what you need — like "I finished my essay", "what's due this week", or "add a quiz due Friday".` });
      } catch (_) {
        _history.push({ role: 'bot', text: `Got it! Tell me what you need — like "I finished my essay", "what's due this week", or "add a quiz due Friday".` });
      }
      if (typeof DueePlan !== 'undefined') DueePlan.incrementAI();

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
    if (/\b(how\s+many|count|total|number\s+of)\b/.test(l)) {
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
