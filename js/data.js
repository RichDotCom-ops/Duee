// duee. — Supabase Data Layer (all methods async)

const DB = {
  _uid() { return window._currentUser?.id; },

  // ── snake_case DB → camelCase JS ──
  _cls(r) {
    if (!r) return null;
    return { id: r.id, name: r.name, professor: r.professor || '', color: r.color || '#16a34a', icon: r.icon || 'book-open' };
  },
  _asgn(r) {
    if (!r) return null;
    return {
      id: r.id, name: r.name, classId: r.class_id,
      dueDate: r.due_date, dueTime: r.due_time || '23:59',
      priority: r.priority || 'medium', estimatedTime: r.estimated_time || '1.5',
      notes: r.notes || '', completed: r.completed || false,
    };
  },

  // ── Classes ──
  async getClasses() {
    const { data, error } = await _supabase.from('classes').select('*').order('created_at');
    if (error) { console.error(error); return []; }
    return (data || []).map(r => this._cls(r));
  },

  async addClass(obj) {
    const { data, error } = await _supabase.from('classes')
      .insert({ user_id: this._uid(), name: obj.name, professor: obj.professor || '', color: obj.color || '#16a34a', icon: obj.icon || 'book-open' })
      .select().single();
    if (error) throw error;
    return this._cls(data);
  },

  async updateClass(id, obj) {
    const { data, error } = await _supabase.from('classes')
      .update({ name: obj.name, professor: obj.professor || '', color: obj.color, icon: obj.icon })
      .eq('id', id).select().single();
    if (error) throw error;
    return this._cls(data);
  },

  async deleteClass(id) {
    // Assignments with this class_id will have class_id set to null (on delete set null)
    const { error } = await _supabase.from('classes').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Assignments ──
  async getAssignments() {
    const { data, error } = await _supabase.from('assignments').select('*').order('due_date');
    if (error) { console.error(error); return []; }
    return (data || []).map(r => this._asgn(r));
  },

  async addAssignment(obj) {
    const { data, error } = await _supabase.from('assignments')
      .insert({
        user_id:        this._uid(),
        class_id:       obj.classId || null,
        name:           obj.name,
        due_date:       obj.dueDate,
        due_time:       obj.dueTime  || '23:59',
        priority:       obj.priority || 'medium',
        estimated_time: obj.estimatedTime || '1.5',
        notes:          obj.notes || '',
        completed:      false,
      }).select().single();
    if (error) throw error;
    return this._asgn(data);
  },

  async updateAssignment(id, obj) {
    const patch = {};
    if (obj.name          !== undefined) patch.name           = obj.name;
    if (obj.classId       !== undefined) patch.class_id       = obj.classId;
    if (obj.dueDate       !== undefined) patch.due_date       = obj.dueDate;
    if (obj.dueTime       !== undefined) patch.due_time       = obj.dueTime;
    if (obj.priority      !== undefined) patch.priority       = obj.priority;
    if (obj.estimatedTime !== undefined) patch.estimated_time = obj.estimatedTime;
    if (obj.notes         !== undefined) patch.notes          = obj.notes;
    if (obj.completed     !== undefined) patch.completed      = obj.completed;
    const { data, error } = await _supabase.from('assignments').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return this._asgn(data);
  },

  async deleteAssignment(id) {
    const { error } = await _supabase.from('assignments').delete().eq('id', id);
    if (error) throw error;
  },

  async toggleComplete(id, currentState) {
    return this.updateAssignment(id, { completed: !currentState });
  },

  // ── Stats (computed, no extra DB call needed) ──
  computeStats(assignments) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const toD = s => { const d = new Date(s + 'T00:00:00'); d.setHours(0,0,0,0); return d; };
    const wk  = new Date(now); wk.setDate(wk.getDate() + 7);
    return {
      dueToday:    assignments.filter(a => !a.completed && toD(a.dueDate).getTime() === now.getTime()).length,
      dueThisWeek: assignments.filter(a => { const d = toD(a.dueDate); return !a.completed && d >= now && d < wk; }).length,
      upcoming:    assignments.filter(a => !a.completed).length,
      completed:   assignments.filter(a => a.completed).length,
    };
  },

  // ── Reminders & Preferences (per-user localStorage — no sensitive data) ──
  _lsKey(k) { return `duee_${k}_${this._uid() || 'guest'}`; },
  _lsGet(k, fallback) { try { return JSON.parse(localStorage.getItem(this._lsKey(k))) || fallback; } catch { return fallback; } },
  _lsSet(k, v) { localStorage.setItem(this._lsKey(k), JSON.stringify(v)); },

  getReminders() {
    return this._lsGet('rem', { enabled: true, reminderTime: '1 day before', types: { dueToday: true, dueTomorrow: true, dueThisWeek: true, overdue: true } });
  },
  saveReminders(v) { this._lsSet('rem', v); },

  getPreferences() {
    return this._lsGet('prefs', { theme: 'light', weekStartDay: 'Monday', timeFormat: '12 Hour' });
  },
  savePreferences(v) { this._lsSet('prefs', v); },

  // ── Util ──
  todayStr() { return new Date().toISOString().split('T')[0]; },
};
