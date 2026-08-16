// duee. — Browser Notifications

(function () {

  // ── Permission helpers ──
  function supported() { return 'Notification' in window; }
  function granted()   { return supported() && Notification.permission === 'granted'; }

  // Must be called from a user gesture (button click)
  async function requestPermission() {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return await Notification.requestPermission();
  }

  // ── Fire a single browser notification ──
  function fire(title, body, key) {
    if (!granted()) return;
    try {
      const n = new Notification('duee. · ' + title, {
        body,
        icon:   '../Logo2.png',
        badge:  '../Logo2.png',
        tag:    key,            // OS deduplication
        silent: false
      });
      n.onclick = () => {
        window.focus();
        // Navigate to assignments — works from any html/ page
        window.location.href = '/assignments';
        n.close();
      };
      localStorage.setItem(key, '1');
    } catch (_) {}
  }

  // ── Build notification list from assignments ──
  async function buildNotifications() {
    if (!granted() || !window._currentUser) return [];

    const settings = DB.getReminders();
    if (!settings.enabled) return [];

    let assignments = [], classes = [];
    try {
      [assignments, classes] = await Promise.all([DB.getAssignments(), DB.getClasses()]);
    } catch (_) { return []; }

    const now      = new Date(); now.setHours(0, 0, 0, 0);
    const todayStr = now.toISOString().slice(0, 10);
    const uid      = window._currentUser?.id || 'guest';
    const notifs   = [];

    assignments.filter(a => !a.completed).forEach(a => {
      const due   = new Date(a.dueDate + 'T00:00:00');
      const diff  = Math.round((due - now) / 86400000);
      const cls   = classes.find(c => c.id === a.classId);
      const info  = cls ? ` · ${cls.name}` : '';

      const queue = (type, title, body) => {
        const key = `duee_notif_${uid}_${todayStr}_${type}_${a.id}`;
        if (!localStorage.getItem(key)) notifs.push({ title, body, key });
      };

      if (settings.types.overdue    && diff < 0)           queue('overdue',   '🔴 Overdue!',           `"${a.name}"${info} — ${Math.abs(diff)}d ago`);
      if (settings.types.dueToday   && diff === 0)          queue('today',     '📚 Due today',           `"${a.name}"${info}`);
      if (settings.types.dueTomorrow && diff === 1)          queue('tomorrow',  '⏰ Due tomorrow',        `"${a.name}"${info}`);
      if (settings.types.dueThisWeek && diff > 1 && diff <= 7) queue('week_'+diff, `📅 Due in ${diff} days`, `"${a.name}"${info}`);
    });

    return notifs;
  }

  // ── Update the topbar bell badge ──
  function updateBellBadge(count) {
    document.querySelectorAll('.topbar-icon-btn').forEach(btn => {
      btn.querySelector('.notif-badge')?.remove();
      if (count > 0) {
        btn.style.position = 'relative';
        const b = document.createElement('span');
        b.className = 'notif-badge';
        b.textContent = count > 9 ? '9+' : count;
        btn.appendChild(b);
        // Clicking bell goes to reminders page
        btn.onclick = () => {
          window.location.href = '/reminders';
        };
      }
    });
  }

  // ── Compute badge count (due today + overdue, pending) ──
  async function refreshBadge() {
    if (!window._currentUser) return;
    try {
      const assignments = await DB.getAssignments();
      const now = new Date(); now.setHours(0,0,0,0);
      const urgent = assignments.filter(a => {
        if (a.completed) return false;
        const diff = Math.round((new Date(a.dueDate+'T00:00:00') - now) / 86400000);
        return diff <= 0; // overdue or due today
      }).length;
      updateBellBadge(urgent);
    } catch (_) {}
  }

  // ── Main: fire notifications + refresh badge ──
  async function run() {
    const notifs = await buildNotifications();

    // Stagger so OS doesn't swallow them
    notifs.forEach(({ title, body, key }, i) => {
      setTimeout(() => fire(title, body, key), i * 1200);
    });

    await refreshBadge();
  }

  // ── Poll until auth is ready, then run ──
  let _ran = false;
  function boot() {
    if (_ran) return;
    if (!window._currentUser) { setTimeout(boot, 600); return; }
    _ran = true;
    run();
  }

  // ── Inject badge CSS ──
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      .notif-badge {
        position: absolute; top: -4px; right: -4px;
        min-width: 16px; height: 16px; border-radius: 99px;
        background: var(--red, #ef4444); color: white;
        font-size: 10px; font-weight: 700; line-height: 16px;
        text-align: center; padding: 0 3px; pointer-events: none;
        border: 2px solid var(--bg-white, #fff);
      }
    `;
    document.head.appendChild(s);
  }

  // ── Public API (used by reminders.html) ──
  window.DueeNotif = {
    supported,
    granted,
    requestPermission,
    refreshBadge,
    run,

    // Returns a status string for the UI
    permissionStatus() {
      if (!supported()) return 'unsupported';
      return Notification.permission; // 'granted' | 'denied' | 'default'
    },

    // Test notification — fires immediately
    async test() {
      if (!granted()) return false;
      fire('🔔 Notifications are working!', 'You\'ll get alerts like this for upcoming assignments.', 'duee_test_' + Date.now());
      return true;
    }
  };

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectStyles(); setTimeout(boot, 800); });
  } else {
    injectStyles();
    setTimeout(boot, 800);
  }
})();
