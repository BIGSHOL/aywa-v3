/* 2.0 화면 — 강사 시트 · 수학(MCS) (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/mcs.html?…`(v2-host/src/mcs.tsx · mcs-pages.tsx,
   데이터 = /api/v2/mcs, Docker 복사본). 3.0 쪽은 '연습 화면' 안내 한 줄과 '보는 사람' 고르기, 자리(slot)만 둔다 — 겹쳐 두기·주소 맞추기는
   수업목록 껍데기와 같다(모양은 v2-screen-timetable.css의 `.v2h-*`).
   MCS는 사람마다 화면이 다르다(강사는 담당 반만) — 3.0엔 로그인이 없어 이 띠에서 '보는 사람'을 고르고, 그 사람이 저장하는 사람도 된다
   (호스트가 v2-host-editors로 목록을 알려 주고, 고른 값은 같은 출처 저장소 `v2-host-actor:mcs` + v2-host-actor 알림으로 호스트에 간다 — ECS와 같은 규칙).
   iframe 안 이동(달 · 반별/선생님별 · 반 월간 같은 하위 주소는 v2path)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-mcs?…)를 맞춘다.
   학생 같은 다른 2.0 주소는 3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'mcs', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로 + v2path(2.0 하위 경로 /mcs/teachers · /mcs/<반>/month …).
  const KEEP = ['v2path', 'month', 'student', 'classId'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const ACTOR_KEY = `v2-host-actor:${ID}`, SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '강사 시트 · 수학'; frame.dataset.v2Host = ID; frame.hidden = true;
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
  // 이 화면이 그리는 2.0 하위 주소(반별 · 선생님별 · 반 월간) — 창 열기 알림이 와도 같은 화면에서 연다.
  const OWN = /^\/mcs(?:\/teachers|\/progress-map|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/month)?$/i;
  /** 2.0 주소 → 이 화면(하위 주소) · 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const path = String(href || '').split(/[?#]/)[0];
    if (OWN.test(path)) { location.hash = `#v2-${ID}?${new URLSearchParams(path === '/mcs' ? {} : { v2path: path })}`.replace(/\?$/, ''); return; }
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.');
  }
  /** 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts)와 같은 규칙. */
  function currentActor() {
    let stored = null;
    try { stored = localStorage.getItem(ACTOR_KEY); } catch { /* 저장소를 못 쓰면 이 창에서만 */ }
    for (const id of [actor, stored]) if (id && editors.some(e => e.id === id)) return id;
    return editors[0]?.id ?? null;
  }
  const actorPicker = () => (editors.length ? `<label class="v2h-actor"><span>보는 사람</span><select data-v2h-actor aria-label="보는 사람">${editors.map(e => `<option value="${esc(e.id)}"${e.id === currentActor() ? ' selected' : ''}>${esc(e.role ? `${e.name} · ${e.role}` : e.name)}</option>`).join('')}</select></label>` : '');
  const tellHost = () => { const id = currentActor(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
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
    id: ID, label: '강사 시트 · 수학',
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '강사 시트를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '강사 시트를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 고른 사람의 화면으로 보입니다(선생님은 담당 반만). 저장도 고른 사람으로 합니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
