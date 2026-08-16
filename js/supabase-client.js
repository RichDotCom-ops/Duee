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
    const session = await this.getSession();
    if (!session) {
      window.location.href = '/login';
      return null;
    }
    return session;
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
