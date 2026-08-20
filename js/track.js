// duee. — anonymous page visit tracker
(function () {
  if (typeof _supabase === 'undefined') return;
  try {
    // Persistent visitor ID — same browser = same ID forever
    let vid = localStorage.getItem('duee_vid');
    if (!vid) {
      vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('duee_vid', vid);
    }
    const page = location.pathname.replace(/\/index\.html$/, '/') || '/';
    const referrer = document.referrer ? new URL(document.referrer).hostname : null;
    _supabase.from('page_visits').insert({ page, referrer, visitor_id: vid }).then(() => {});
  } catch (_) {}
})();
