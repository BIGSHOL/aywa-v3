/* 2.0 화면 (V2-SCREENS.md): screens that keep 2.0's form (시간표 격자·원스크린·출석부 …) as new 3.0 pages over the local
   Docker copy. 3.0 is built to replace 2.0 entirely, so nothing here sends people to the 2.0 site. Each screen is one script
   `v2-screen-<id>.js` (loaded from GET /api/v2) that calls V2Screens.register({ id, label, render }). Pages live at
   #v2-<id>[?query]; render(ctx) returns HTML synchronously from cached data (ctx.load) and the page re-renders when data lands. */
window.V2Screens = (() => {
  'use strict';
  const screens = new Map(), cache = new Map();
  let api = null, index = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = page => { const m = /^v2-([a-z][a-z0-9-]{0,30})(?:\?(.*))?$/.exec(page || ''); return m ? { id: m[1], query: new URLSearchParams(m[2] || '') } : null; };
  const current = () => parse(location.hash.slice(1));

  /** Read-only data for this screen and these params: cached; the first call fetches and re-renders the page on arrival. */
  function load(id, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(), key = `${id}?${qs}`;
    const hit = cache.get(key); if (hit) return hit;
    const entry = { status: 'loading', data: null, error: null }; cache.set(key, entry);
    fetch(`/api/v2/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async r => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '불러오지 못했습니다.'); entry.status = 'ready'; entry.data = body; })
      .catch(error => { entry.status = 'error'; entry.error = error.message; }) // kept: a failed load is retried only by ctx.refresh(), never by a re-render
      .finally(() => { if (current()?.id === id) api?.render(); });
    return entry;
  }
  const go = (id, params = {}) => { const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(); api?.navigate(`v2-${id}${qs ? `?${qs}` : ''}`); };

  function register(def) {
    if (!def?.id || typeof def.render !== 'function') return;
    screens.set(def.id, def);
    if (current()?.id === def.id) api?.navigate(location.hash.slice(1)); // a deep link that arrived before its script
    else api?.render();
  }
  /** live.js viewFor hook: the view function for #v2-<id>[?query], or null. */
  function view(page) {
    const p = parse(page), def = p && screens.get(p.id); if (!def) return null;
    return () => {
      const ctx = { api, query: p.query, esc, load: params => load(def.id, params), go: params => go(def.id, params), refresh: () => { for (const k of [...cache.keys()]) if (k.startsWith(`${def.id}?`)) cache.delete(k); api?.render(); } };
      try { return `<div class="v2s" data-v2-screen="${esc(def.id)}">${def.render(ctx)}</div>`; }
      catch (error) { console.error(error); return `<div class="v2s"><p class="v2s-note">이 화면을 그리지 못했습니다.</p></div>`; }
    };
  }
  /** live.js sidebar hook: the '2.0 화면' group, in the order the server lists. */
  function sidebar(page) {
    const list = (index || []).filter(s => screens.has(s.id)); if (!list.length) return '';
    const active = parse(page)?.id;
    return `<div class="nav-group">2.0 화면</div>${list.map(s => `<a class="nav-item ${active === s.id ? 'active' : ''}" href="#v2-${esc(s.id)}" ${active === s.id ? 'aria-current="page"' : ''}><span>${esc(s.label)}</span></a>`).join('')}`;
  }
  function bind(a) {
    api = a;
    fetch('/api/v2', { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : { screens: [] })).catch(() => ({ screens: [] })).then(({ screens: list }) => {
      index = list || [];
      for (const s of index) {
        if (s.style) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = s.style; document.head.append(l); }
        const sc = document.createElement('script'); sc.src = s.script; sc.defer = true; document.head.append(sc);
      }
      api.render();
    });
  }
  return { register, view, sidebar, bind, esc };
})();
