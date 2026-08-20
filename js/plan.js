// duee. — Plan & Token Management

const DueePlan = (() => {
  const FREE_AI_LIMIT = 20;           // messages per window
  const FREE_RESET_MS = 24 * 3600000; // 24 hours

  function uid() { return window._currentUser?.id || 'guest'; }
  function lsKey(k) { return `duee_${k}_${uid()}`; }

  // ── Plan tier ──
  function getTier() {
    const raw = localStorage.getItem(lsKey('plan'));
    if (!raw) return { tier: 'free', expiresAt: null };
    try {
      const p = JSON.parse(raw);
      // Check expiry
      if (p.expiresAt && Date.now() > p.expiresAt) {
        localStorage.removeItem(lsKey('plan'));
        return { tier: 'free', expiresAt: null };
      }
      return p;
    } catch (_) { return { tier: 'free', expiresAt: null }; }
  }

  function setTier(tier, expiresAt = null) {
    localStorage.setItem(lsKey('plan'), JSON.stringify({ tier, expiresAt }));
  }

  function isPro() { const { tier } = getTier(); return tier === 'pro' || tier === 'weekly' || tier === 'annual' || tier === 'god'; }
  function isGod() { return getTier().tier === 'god'; }

  // ── AI usage ──
  function getUsage() {
    try {
      const raw = JSON.parse(localStorage.getItem(lsKey('ai_usage')) || '{}');
      if (!raw.resetAt || Date.now() > raw.resetAt) {
        return { count: 0, resetAt: Date.now() + FREE_RESET_MS };
      }
      return raw;
    } catch (_) { return { count: 0, resetAt: Date.now() + FREE_RESET_MS }; }
  }

  function saveUsage(u) { localStorage.setItem(lsKey('ai_usage'), JSON.stringify(u)); }

  function canUseAI() {
    if (isPro()) return { allowed: true, remaining: Infinity, resetIn: 0 };
    const u = getUsage();
    const remaining = Math.max(0, FREE_AI_LIMIT - u.count);
    return { allowed: remaining > 0, remaining, resetIn: Math.max(0, u.resetAt - Date.now()) };
  }

  function incrementAI() {
    if (isPro()) return;
    const u = getUsage();
    u.count = (u.count || 0) + 1;
    if (!u.resetAt || Date.now() > u.resetAt) u.resetAt = Date.now() + FREE_RESET_MS;
    saveUsage(u);
  }

  function fmtCountdown(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ── Sidebar "Upgrade" / plan badge injection ──
  function injectSidebarBadge() {
    const bottom = document.querySelector('.sidebar-bottom');
    if (!bottom || document.getElementById('sidebar-plan-badge')) return;

    const { tier } = getTier();
    const { remaining } = canUseAI();

    const el = document.createElement('a');
    el.id   = 'sidebar-plan-badge';
    el.href = '/pricing';
    el.style.cssText = `
      display:flex;align-items:center;gap:8px;
      margin:8px 10px 0;padding:9px 12px;border-radius:var(--radius);
      font-size:13px;font-weight:600;text-decoration:none;
      transition:background 0.15s;cursor:pointer;
    `;

    if (tier === 'god') {
      el.style.background = 'linear-gradient(135deg,#7c3aed18,#2563eb18)';
      el.style.color = '#7c3aed';
      el.style.border = '1px solid #7c3aed30';
      el.innerHTML = `<span style="font-size:15px;">✦</span><span style="flex:1;">duee. Pro</span><span style="font-size:10px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;border-radius:99px;padding:1px 6px;">UNLIMITED</span>`;
    } else if (tier === 'free') {
      el.style.background = 'linear-gradient(135deg,#7c3aed18,#2563eb18)';
      el.style.color = '#7c3aed';
      el.style.border = '1px solid #7c3aed30';
      el.innerHTML = `
        <span style="font-size:15px;">⚡</span>
        <span style="flex:1;">Upgrade · from $2.99/wk</span>
        ${remaining <= 3 ? `<span style="font-size:10px;background:#7c3aed;color:white;border-radius:99px;padding:1px 6px;">${remaining} AI left</span>` : ''}
      `;
    } else {
      const labels = { weekly: 'Pro Weekly', pro: 'Pro Monthly', annual: 'Pro Annual' };
      const label = labels[tier] || 'Pro';
      el.style.background = 'linear-gradient(135deg,#7c3aed18,#2563eb18)';
      el.style.color = '#7c3aed';
      el.style.border = '1px solid #7c3aed30';
      el.innerHTML = `<span style="font-size:15px;">✦</span><span style="flex:1;">duee. ${label}</span><span style="font-size:10px;background:#7c3aed;color:white;border-radius:99px;padding:1px 6px;">ACTIVE</span>`;
    }

    el.addEventListener('mouseenter', () => { el.style.background = 'linear-gradient(135deg,#7c3aed25,#2563eb25)'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'linear-gradient(135deg,#7c3aed18,#2563eb18)'; });

    bottom.insertBefore(el, bottom.firstChild);
  }

  // ── Sync plan from DB (called after auth) ──
  async function syncFromDB() {
    try {
      const { data, error } = await _supabase.rpc('get_my_plan');
      if (!error && data) {
        setTier(data, null);
        // Re-render any UI that already painted before sync completed
        document.getElementById('sidebar-plan-badge')?.remove();
        injectSidebarBadge();
        // Refresh AI counter if it exists
        if (typeof updateTokenUI === 'function') updateTokenUI();
      }
    } catch (_) {}
  }

  // ── Boot ──
  async function boot() {
    await syncFromDB();
    if (!document.querySelector('.sidebar-bottom')) return;
    injectSidebarBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { getTier, setTier, isPro, isGod, canUseAI, incrementAI, fmtCountdown, syncFromDB };
})();
