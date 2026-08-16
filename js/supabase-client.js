// duee. — Supabase Client & Auth
const SUPABASE_URL = 'https://plbhhmhgkbqvdbaatabv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uFG9QWwS-UkHq-0GAr32bw_SP28c71r';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const Auth = {
  async getSession() {
    const { data: { session } } = await _supabase.auth.getSession();
    return session;
  },

  async getUser() {
    const { data: { user } } = await _supabase.auth.getUser();
    return user;
  },

  async signUp(email, password, name) {
    return await _supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
  },

  async signIn(email, password) {
    return await _supabase.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    await _supabase.auth.signOut();
    window.location.href = '/login';
  },

  async updatePassword(newPassword) {
    return await _supabase.auth.updateUser({ password: newPassword });
  },

  async updateProfile(name) {
    return await _supabase.auth.updateUser({ data: { name } });
  },

  // Call on every protected page — redirects to login if no session
  async requireAuth() {
    try {
      const session = await Promise.race([
        this.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connection_timeout')), 8000))
      ]);
      if (!session) { window.location.href = '/login'; return null; }
      return session;
    } catch(err) {
      if (err.message === 'connection_timeout') {
        _showConnectionError('Can\'t connect to the server. Check your internet and try again.');
      } else {
        window.location.href = '/login';
      }
      return null;
    }
  },

  getUserName(user) {
    return user?.user_metadata?.name
      || user?.email?.split('@')[0]
      || 'Student';
  },

  getUserInitial(user) {
    return this.getUserName(user).charAt(0).toUpperCase();
  }
};

// Global logout helper called from sidebar links
async function signOutUser() {
  await Auth.signOut();
}

// ── Connection error overlay ──
function _showConnectionError(msg) {
  // Remove any existing overlay first
  document.getElementById('_conn-err')?.remove();
  const el = document.createElement('div');
  el.id = '_conn-err';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg-main,#f8fafc);padding:24px;';
  el.innerHTML = `
    <div style="max-width:400px;text-align:center;background:var(--bg-white,#fff);border:1px solid var(--border,#e2e8f0);border-radius:16px;padding:36px 28px;box-shadow:0 8px 32px rgba(0,0,0,0.08);">
      <div style="font-size:40px;margin-bottom:16px;">📡</div>
      <div style="font-size:18px;font-weight:700;color:var(--text-primary,#0f172a);margin-bottom:8px;">Connection Problem</div>
      <div style="font-size:14px;color:var(--text-secondary,#64748b);line-height:1.6;margin-bottom:24px;">${msg || 'Can\'t reach the server. Check your internet connection and try again.'}</div>
      <button onclick="location.reload()" style="background:#16a34a;color:white;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-right:8px;">Retry</button>
      <button onclick="document.getElementById('_conn-err').remove()" style="background:var(--bg-hover,#f1f5f9);color:var(--text-secondary,#64748b);border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Dismiss</button>
    </div>`;
  // Wait for DOM if needed
  if (document.body) { document.body.appendChild(el); }
  else { document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el)); }
}
