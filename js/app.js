// duee. — Shared App Utilities

// ── Theme (apply before render to avoid flash) ──
(function() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('duee_theme') || 'light');
})();

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'light');
  localStorage.setItem('duee_theme', theme || 'light');
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof feather !== 'undefined') feather.replace({ width: 16, height: 16 });
  initAvatar();
  highlightNav();
  initMobileSidebar();
});

// ── Mobile sidebar toggle ──
function initMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const topbarLeft = document.querySelector('.topbar-left');
  if (!sidebar || !topbarLeft) return;

  // Inject overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.onclick = closeMobileSidebar;
  document.body.appendChild(overlay);

  // Inject hamburger button before page title
  const btn = document.createElement('button');
  btn.className = 'topbar-hamburger';
  btn.setAttribute('aria-label', 'Menu');
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  btn.onclick = toggleMobileSidebar;
  topbarLeft.insertBefore(btn, topbarLeft.firstChild);
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) { closeMobileSidebar(); } else {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('visible');
  }
}

function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.querySelector('.sidebar-overlay')?.classList.remove('visible');
}

// ── Avatar initial ──
function initAvatar() {
  // Avatar is populated per-page after auth; nothing to do here
}

// ── Highlight current nav item ──
function highlightNav() {
  const page = window.location.pathname.replace(/\/$/, '').split('/').pop().replace('.html', '');
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// ── Toast ──
function showToast(msg, type = '') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Date / Time Helpers ──
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtDateFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime24to12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ap}`;
}
function getDaysUntil(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const due = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((due - now) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, cls: 'overdue' };
  if (diff === 0) return { label: 'Due today', cls: 'today' };
  if (diff === 1) return { label: 'Due tomorrow', cls: '' };
  return { label: `${diff} days left`, cls: '' };
}
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function isToday(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  return d.getTime() === now.getTime();
}

// ── Priority helpers ──
function priorityClass(p) { return { high:'p-high', medium:'p-medium', low:'p-low' }[p] || ''; }
function priorityBadge(p) {
  const map = { high:['badge-red','High'], medium:['badge-yellow','Medium'], low:['badge-green','Low'] };
  const [cls, label] = map[p] || ['', p];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ── Modal helpers ──
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeOnOverlay(id) {
  const el = document.getElementById(id);
  el?.addEventListener('click', e => { if (e.target === el) closeModal(id); });
}

// ── Confirm dialog ──
function confirmAction(msg, onConfirm) {
  let box = document.getElementById('confirm-overlay');
  if (!box) {
    box = document.createElement('div');
    box.id = 'confirm-overlay';
    box.className = 'confirm-overlay';
    box.innerHTML = `
      <div class="confirm-box">
        <h3>Are you sure?</h3>
        <p id="confirm-msg"></p>
        <div class="confirm-actions">
          <button class="btn btn-outline btn-sm" id="confirm-cancel">Cancel</button>
          <button class="btn btn-danger btn-sm" id="confirm-ok">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    document.getElementById('confirm-cancel').addEventListener('click', () => box.classList.remove('open'));
    box.addEventListener('click', e => { if (e.target === box) box.classList.remove('open'); });
  }
  document.getElementById('confirm-msg').textContent = msg;
  box.classList.add('open');
  const okBtn = document.getElementById('confirm-ok');
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  newOk.addEventListener('click', () => { box.classList.remove('open'); onConfirm(); });
}

// ── Build class select options ──
// Pass classes array directly (since DB methods are now async)
function buildClassOptions(selectEl, selectedId = '', classes = []) {
  selectEl.innerHTML = '<option value="">Select class</option>' +
    classes.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>`).join('');
}

// ── Color swatches ──
const CLASS_COLORS = ['#16a34a','#2563eb','#7c3aed','#0891b2','#dc2626','#b45309','#0d9488','#9333ea','#db2777','#64748b'];
const CLASS_ICONS = ['book-open','code','feather','globe','divide-square','star','zap','cpu','layers','award'];
