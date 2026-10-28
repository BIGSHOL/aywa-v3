/* 2.0 화면 (V2-SCREENS.md): screens that keep 2.0's form (시간표 격자·원스크린·출석부 …) as new 3.0 pages over the local
   Docker copy. 3.0 is built to replace 2.0 entirely, so nothing here sends people to the 2.0 site. Each screen is one script
   `v2-screen-<id>.js` (loaded from GET /api/v2) that calls V2Screens.register({ id, label, render }). Pages live at
   #v2-<id>[?query]; render(ctx) returns HTML synchronously from cached data (ctx.load) and the page re-renders when data lands.
   ctx.act(action, body) saves to the Docker copy (원장 2026-10-28 "연습용이므로 모두 docker"), then refreshes that screen's data in
   place. Screens that save show ctx.copyNote so nobody mistakes the practice copy for 2.0. */
window.V2Screens = (() => {
  'use strict';
  const screens = new Map(), cache = new Map();
  let api = null, index = null;
  const COPY_NOTE = '연습용 복사본에 저장됩니다. 운영 데이터와 실제 발송(ClassNote·알림톡·슬랙)에는 닿지 않습니다.';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = page => { const m = /^v2-([a-z][a-z0-9-]{0,30})(?:\?(.*))?$/.exec(page || ''); return m ? { id: m[1], query: new URLSearchParams(m[2] || '') } : null; };
  const current = () => parse(location.hash.slice(1));

  const fetchInto = (id, qs, entry) => fetch(`/api/v2/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { headers: { Accept: 'application/json' } })
    .then(async r => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '불러오지 못했습니다.'); entry.status = 'ready'; entry.data = body; entry.error = null; })
    .catch(error => { entry.error = error.message; if (entry.status !== 'ready') entry.status = 'error'; }) // kept: retried only by ctx.refresh(), never by a re-render; a failed refresh after a save keeps the shown data
    .finally(() => { entry.refreshing = false; if (current()?.id === id) api?.render(); });
  /** Read-only data for this screen and these params: cached; the first call fetches and re-renders the page on arrival. */
  function load(id, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(), key = `${id}?${qs}`;
    const hit = cache.get(key);
    if (hit) { if (hit.stale && !hit.refreshing) { hit.stale = false; hit.refreshing = true; fetchInto(id, qs, hit); } return hit; } // 다른 곳의 저장 뒤: 옛 값을 보이며 다시 읽는다
    const entry = { status: 'loading', data: null, error: null, refreshing: false }; cache.set(key, entry);
    fetchInto(id, qs, entry);
    return entry;
  }
  /** After a save: every cached view of the screen refetches in place (the old data stays on screen until the new arrives). */
  const revalidate = id => { for (const [key, entry] of cache) if (key.startsWith(`${id}?`) && !entry.refreshing) { entry.stale = false; entry.refreshing = true; fetchInto(id, key.slice(id.length + 1), entry); } };
  /** 한 화면의 저장이 다른 화면 값도 바꿀 수 있다 — 나머지 화면의 자료는 다음에 열 때 다시 읽는다(그때까지 옛 값을 보인다). */
  const staleExcept = id => { for (const [key, entry] of cache) if (!id || !key.startsWith(`${id}?`)) entry.stale = true; };
  /** live.js: 서버 자료 개정 번호가 바뀌었을 때(다른 창·다른 화면의 저장) — 보이는 화면은 지금 제자리에서, 나머지는 다음에 열 때. */
  const dataChanged = () => { const id = current()?.id; staleExcept(id); if (id && screens.has(id)) revalidate(id); };
  /** Save through the screen's action on the Docker copy. Resolves with the action's result; rejects with a Korean message. */
  async function act(id, action, body = {}) {
    const r = await fetch(`/api/v2/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.message || '저장하지 못했습니다.');
    revalidate(id); staleExcept(id);
    return data.result;
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
      const writable = !!(index || []).find(s => s.id === def.id)?.writable;
      const ctx = { api, query: p.query, esc, writable, copyNote: COPY_NOTE, load: params => load(def.id, params), act: (action, body) => act(def.id, action, body), go: params => go(def.id, params), refresh: () => { for (const k of [...cache.keys()]) if (k.startsWith(`${def.id}?`)) cache.delete(k); api?.render(); } };
      // native = 3.0 고유 화면(확장 추세 등) — 2.0 모양을 지키는 .v2s 예외 없이 3.0 컨트롤 규칙을 그대로 받는다.
      try { return `<div class="${def.native ? 'v3s' : 'v2s'}" data-v2-screen="${esc(def.id)}">${def.render(ctx)}</div>`; }
      catch (error) { console.error(error); return `<div class="v2s"><p class="v2s-note">이 화면을 그리지 못했습니다.</p></div>`; }
    };
  }
  /** live.js sidebar hook: the '2.0 화면' group, in the order the server lists. */
  function sidebar(page) {
    const list = (index || []).filter(s => screens.has(s.id) && screens.get(s.id).nav !== false); if (!list.length) return ''; // nav:false = 카드·링크로만 들어오는 화면(확장 추세)
    const active = parse(page)?.id;
    return `<div class="nav-group">업무 화면</div>${list.map(s => `<a class="nav-item ${active === s.id ? 'active' : ''}" href="#v2-${esc(s.id)}" ${active === s.id ? 'aria-current="page"' : ''}><span>${esc(s.label)}</span></a>`).join('')}`;
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
  /** A 3.0 workspace id → its 2.0 screen address when that screen is registered (workspace links open the 2.0 form first). */
  const WORKSPACE_ALIAS = { 'class-sheets': 'ecs' }; // the only workspace whose id differs from its 2.0 screen
  const target = wsId => { const id = WORKSPACE_ALIAS[wsId] || wsId; return screens.has(id) ? `#v2-${id}` : null; };
  return { register, view, sidebar, bind, esc, target, dataChanged };
})();
