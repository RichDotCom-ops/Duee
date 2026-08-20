// duee. — anonymous page visit tracker
(function () {
  if (typeof _supabase === 'undefined') return;
  try {
    const page = location.pathname.replace(/\/index\.html$/, '/') || '/';
    const referrer = document.referrer ? new URL(document.referrer).hostname : null;
    _supabase.from('page_visits').insert({ page, referrer }).then(() => {});
  } catch (_) {}
})();
