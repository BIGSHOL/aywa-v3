/* 2.0 화면 — 수업보고서 관리 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/lesson-reports.html?…`(v2-host/src/lesson-reports.tsx · lesson-reports-page.tsx,
   데이터 = /api/v2/lesson-reports, Docker 복사본). 3.0 쪽은 '연습 화면' 안내 한 줄 · 저장하는 사람 고르기 · 자리(slot)만 둔다 — 겹쳐 두기·주소 맞추기는
   원생목록 껍데기와 같다. 면 이동(?tab= · ?tab=classnote&section=)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-lesson-reports?…)를 맞춘다.
   /lesson-reports/video-homework(영상 제출 현황)는 다른 3.0 화면(#v2-video-homework — 2.0 열쇠 그대로) · 학생 /students/<id>는 원생 화면 ·
   그 밖은 3.0에 같은 2.0 화면이 있으면 그 화면(하위 경로는 v2path). 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'lesson-reports', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로 + v2path(2.0 하위 경로 /lesson-reports/stats) + 통계 기간 열쇠(2.0 PERIOD_KEYS + subject).
  const KEEP = ['v2path', 'tab', 'section', 'status', 'rmonth', 'page', 'grain', 'month', 'from', 'to', 'span', 'subject'];
  // 영상 제출 현황 화면(#v2-video-homework)이 받는 2.0 열쇠(그 화면의 KEEP과 같다).
  const VIDEO_KEYS = ['date', 'class', 'subject', 'grade', 'school', 'sort', 'from', 'to', 'q', 'status'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const ACTOR_KEY = `v2-host-actor:${ID}`, SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
  /** 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts)와 같은 규칙(수업목록과 같다). */
  function currentActor() {
    let stored = null;
    try { stored = localStorage.getItem(ACTOR_KEY); } catch { /* 저장소를 못 쓰면 이 창에서만 */ }
    for (const id of [actor, stored]) if (id && editors.some(e => e.id === id)) return id;
    return editors[0]?.id ?? null;
  }
  const actorPicker = () => (editors.length ? `<label class="v2h-actor"><span>저장하는 사람</span><select data-v2h-actor aria-label="저장하는 사람">${editors.map(e => `<option value="${esc(e.id)}"${e.id === currentActor() ? ' selected' : ''}>${esc(e.role ? `${e.name} · ${e.role}` : e.name)}</option>`).join('')}</select></label>` : '');
  const tellHost = () => { const id = currentActor(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '수업보고서'; frame.dataset.v2Host = ID; frame.hidden = true;
      document.body.append(frame);
    }
    if (query !== requested) { requested = query; frame.src = `${HOST}${query ? `?${query}` : ''}`; }
  }
  /** 자리(slot) 위에 겹친다 — 문서 좌표라 스크롤을 따라간다. 자리가 없으면(다른 화면) 숨긴다. */
  function place() {
    if (!frame) return;
    const slot = document.querySelector(`[data-v2-screen="${ID}"] [data-v2-host-slot]`);
    if (!slot) { frame.hidden = true; return; }
    slot.style.height = `${Math.max(420, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  }
  // 이 화면이 그리는 2.0 하위 주소(통계) — 창 열기 알림이 와도 같은 화면에서 연다(조건 그대로).
  const OWN = /^\/lesson-reports(?:\/stats)?$/;
  /** 2.0 주소 → 이 화면(하위 주소) · 3.0에 있는 같은 2.0 화면(하위 경로는 v2path, 조건 그대로). 없으면 안내만(주소를 보이지 않는다). */
  function openFromHost(href) {
    const u = new URL(href || '/', location.origin), path = u.pathname;
    const q = new URLSearchParams(u.search);
    if (path === '/lesson-reports/video-homework') {
      const v = new URLSearchParams(); for (const k of VIDEO_KEYS) { const x = q.get(k); if (x) v.set(k, x); }
      const to = S.target('video-homework');
      if (!to) { api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.'); return; }
      const next = `${to}${v.toString() ? `?${v}` : ''}`;
      // ?tab=video_homework로 들어와 옮겨진 것이면 그 주소를 기록에서 바꿔 친다(2.0 redirect와 같다 — 뒤로 가기가 '옮기는 중'에 갇히지 않게).
      if (new URLSearchParams(location.hash.split('?')[1] || '').get('tab') === 'video_homework') { requested = null; location.replace(next); }
      else location.hash = next;
      return;
    }
    if (OWN.test(path)) {
      if (path !== '/lesson-reports') q.set('v2path', path);
      location.hash = `#v2-${ID}${q.toString() ? `?${queryOf(q)}` : ''}`;
      return;
    }
    const segs = path.split('/').filter(Boolean), to = segs[0] ? S.target(segs[0]) : null;
    if (!to) { api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.'); return; }
    if (segs.length > 1) q.set('v2path', path);
    location.hash = `${to}${q.toString() ? `?${q}` : ''}`;
  }
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      // iframe 문서가 다른 호스트 화면으로 바뀌었다(2.0 주소가 그 화면의 것) — 3.0도 그 화면으로 옮기고, 이 화면의 iframe은
      // 다음에 열 때 다시 읽게 되돌린다(같은 조건으로 다시 열어도 갇히지 않게).
      if ((d.type === 'v2-host-nav' || d.type === 'v2-host-ready') && typeof d.screen === 'string' && d.screen && d.screen !== ID) {
        let query = typeof d.query === 'string' ? d.query : '';
        if (d.type === 'v2-host-ready') { try { query = frame.contentWindow.location.search.slice(1); } catch { query = ''; } }
        requested = null;
        const to = S.target(d.screen);
        if (!to) { api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.'); return; }
        location.hash = `${to}${query ? `?${query}` : ''}`;
        return;
      }
      if (d.type === 'v2-host-nav' && d.screen === ID) {
        const query = queryOf(new URLSearchParams(String(d.query || '')));
        requested = query; // iframe은 이미 그 주소다 — 3.0이 다시 그려도 다시 읽지 않게 먼저 맞춘다
        const page = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
      else if (d.type === 'v2-host-editors' && d.screen === ID && Array.isArray(d.editors)) {
        editors = d.editors.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').map(x => ({ id: x.id, name: x.name, role: typeof x.role === 'string' ? x.role : '' }));
        const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`);
        if (at) at.innerHTML = actorPicker();
        tellHost();
      }
    });
    addEventListener('change', e => {
      const t = e.target;
      // 이 화면 안의 선택만 — 다른 화면의 '저장하는 사람'과 섞이지 않게.
      if (!(t instanceof HTMLSelectElement) || !t.matches(`${SEL} [data-v2h-actor]`)) return;
      actor = t.value;
      try { localStorage.setItem(ACTOR_KEY, t.value); } catch { /* 이 창에서만 기억 */ }
      tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '수업보고서',
    render(ctx) {
      api = ctx.api; wire();
      // 업무 흐름이 '이 직원으로' 열 때(&actor=<직원 id>) — 저장하는 사람으로 미리 고른다(목록에 없는 사람이면 저장 때 첫 사람). 주소에는 남기지 않는다.
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(asked) && asked !== actor) {
        actor = asked;
        try { localStorage.setItem(ACTOR_KEY, asked); } catch { /* 이 창에서만 기억 */ }
        tellHost();
      }
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '수업보고서를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '수업보고서를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 이 PC의 연습 자료로 보는 수업보고서 관리입니다. 실제 발송은 없고, 저장은 아직 지원하지 않습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
