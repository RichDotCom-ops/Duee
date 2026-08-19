// duee. — Share & Referral

(function () {
  const SHARE_URL = 'https://duee.online';
  const SHARE_TEXT = 'I use duee. to track my assignments with AI study help — it\'s actually great for college';

  function getRefCode() {
    // Use first 8 chars of user ID as referral code
    const uid = window._currentUser?.id || '';
    return uid ? uid.replace(/-/g, '').slice(0, 8).toUpperCase() : null;
  }

  function getShareLink() {
    const ref = getRefCode();
    return ref ? `${SHARE_URL}?ref=${ref}` : SHARE_URL;
  }

  window.openShareModal = function () {
    const existing = document.getElementById('duee-share-modal');
    if (existing) { existing.classList.add('open'); return; }

    const link = getShareLink();

    const overlay = document.createElement('div');
    overlay.id = 'duee-share-modal';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1100';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <span class="modal-title">Share duee. 🎉</span>
          <button class="modal-close" onclick="document.getElementById('duee-share-modal').classList.remove('open')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <p style="font-size:14px;color:var(--text-secondary);margin-bottom:18px;line-height:1.6;">
          Know a classmate who's always stressed about assignments? Send them duee. — it's free to start!
        </p>

        <!-- Your referral link -->
        <div style="background:var(--bg-hover);border-radius:var(--radius-md);padding:14px;margin-bottom:16px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Your invite link</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <div id="share-link-text" style="flex:1;font-size:13px;color:var(--text-primary);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:white;border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;">${link}</div>
            <button onclick="window._copyShareLink()" style="background:var(--green);color:white;border:none;border-radius:var(--radius);padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;font-family:inherit;" id="share-copy-btn">Copy</button>
          </div>
        </div>

        <!-- Share buttons -->
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Share via</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button onclick="window._shareVia('twitter')" class="share-via-btn">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.26 5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            Twitter / X
          </button>
          <button onclick="window._shareVia('whatsapp')" class="share-via-btn">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.554 4.112 1.523 5.836L.051 23.5l5.83-1.52A11.95 11.95 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.9a9.868 9.868 0 0 1-5.031-1.376l-.361-.214-3.741.975.998-3.648-.235-.374A9.867 9.867 0 0 1 2.1 12C2.1 6.525 6.525 2.1 12 2.1S21.9 6.525 21.9 12 17.475 21.9 12 21.9z"/></svg>
            WhatsApp
          </button>
          <button onclick="window._shareVia('instagram')" class="share-via-btn">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
            Instagram
          </button>
          <button onclick="window._shareVia('native')" class="share-via-btn" id="share-native-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            More options
          </button>
        </div>
      </div>
    `;

    // Add styles if not already added
    if (!document.getElementById('share-styles')) {
      const s = document.createElement('style');
      s.id = 'share-styles';
      s.textContent = `.share-via-btn{display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-white);color:var(--text-primary);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:all 0.15s;} .share-via-btn:hover{border-color:var(--green);background:var(--green-100);}`;
      document.head.appendChild(s);
    }

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    // Close on overlay click
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

    // Hide native share if not supported
    if (!navigator.share) document.getElementById('share-native-btn').style.display = 'none';
  };

  window._copyShareLink = function () {
    const link = getShareLink();
    navigator.clipboard.writeText(link).then(() => {
      const btn = document.getElementById('share-copy-btn');
      if (!btn) return;
      btn.textContent = 'Copied!';
      btn.style.background = '#166534';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; }, 2000);
    }).catch(() => {
      // Fallback: select text
      const el = document.getElementById('share-link-text');
      if (el) { const range = document.createRange(); range.selectNode(el); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); }
    });
  };

  window._shareVia = function (platform) {
    const link = getShareLink();
    const text = encodeURIComponent(SHARE_TEXT);
    const url = encodeURIComponent(link);
    const urls = {
      twitter:   `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      whatsapp:  `https://wa.me/?text=${text}%20${url}`,
      instagram: null, // Instagram doesn't support direct share links — just copy
    };
    if (platform === 'native' && navigator.share) {
      navigator.share({ title: 'duee.', text: SHARE_TEXT, url: link }).catch(() => {});
      return;
    }
    if (platform === 'instagram') {
      window._copyShareLink();
      if (typeof showToast === 'function') showToast('Link copied — paste it in your Instagram story!', 'success');
      return;
    }
    if (urls[platform]) window.open(urls[platform], '_blank', 'noopener,width=600,height=400');
  };
})();
