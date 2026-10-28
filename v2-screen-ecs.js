/* 2.0 화면 — 강사 시트 · 영어(ECS) (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품(반 목록 EcsLandingList · 주간 시트 SheetClient · 월간 MonthClient …)이 한다 — 같은 출처 iframe
   `/v2-host/ecs.html?…`(v2-host/src/ecs.tsx · ecs-page.tsx, 데이터 = /api/v2/ecs, Docker 복사본).
   3.0 쪽은 '연습 복사본' 안내 한 줄, '보고 저장하는 사람' 고르기(3.0엔 로그인이 없다 — ECS는 사람마다 화면이 다르다: 강사는 담당 반만),
   자리(slot)만 둔다. live.js는 그릴 때마다 #main을 통째로 바꾸므로 iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다.
   iframe 안 이동(반 · 주 · 월간 · 면)은 iframe이 알려 주고(v2-host-nav — 하위 주소는 v2path) 3.0 주소(#v2-ecs?…)를 맞춘다.
   학생·반 같은 2.0 주소는 3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다.
   모양은 시간표 껍데기와 같은 `.v2h-*`(v2-screen-timetable.css — 화면 CSS는 모두 함께 실린다). 고르기 칸 표식은 이 화면 것
   (`data-ecs-actor`) — 다른 화면의 고르기와 섞이지 않게. */
(() => {
  'use strict';
  const ID = 'ecs', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로(v2path = 2.0 하위 경로 /ecs/<반>·/ecs/<반>/month).
  const KEEP = ['v2path', 'week', 'view', 'date', 'mode', 'month', 'period', 'day', 'readonly'];
  const ACTOR_KEY = `v2-host-actor:${ID}`, SEL = `[data-v2-screen="${ID}"]`;
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const esc = s => S.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '강사 시트(2.0 화면)'; frame.dataset.v2Host = ID; frame.hidden = true;
      Object.assign(frame.style, { position: 'absolute', zIndex: '5', border: '0', borderRadius: '12px', background: '#fff' });
      document.body.append(frame);
    }
    if (query !== requested) { requested = query; frame.src = `${HOST}${query ? `?${query}` : ''}`; }
  }
  /** 자리(slot) 위에 겹친다 — 문서 좌표라 스크롤을 따라간다. 자리가 없으면(다른 화면) 숨긴다. */
  function place() {
    if (!frame) return;
    const slot = document.querySelector(`${SEL} [data-v2-host-slot]`);
    if (!slot) { frame.hidden = true; return; }
    // 높이 = 화면 높이 − 자리의 문서 위치(스크롤과 무관 — 스크롤할 때마다 자리가 늘어나지 않게). 2.0 시트는 제 안에서 스크롤한다.
    slot.style.height = `${Math.max(420, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  }
  /** 2.0 주소 → 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('이 화면은 3.0 연습본에 아직 없습니다.');
  }
  /** 보고 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts · ecs.tsx)와 같은 규칙. */
  function currentActor() {
    let stored = null;
    try { stored = localStorage.getItem(ACTOR_KEY); } catch { /* 저장소를 못 쓰면 이 창에서만 */ }
    for (const id of [actor, stored]) if (id && editors.some(e => e.id === id)) return id;
    return editors[0]?.id ?? null;
  }
  const actorPicker = () => (editors.length ? `<label class="v2h-actor"><span>보고 저장하는 사람</span><select data-ecs-actor aria-label="보고 저장하는 사람">${editors.map(e => `<option value="${esc(e.id)}"${e.id === currentActor() ? ' selected' : ''}>${esc(e.role ? `${e.name} · ${e.role}` : e.name)}</option>`).join('')}</select></label>` : '');
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
      if (!(t instanceof HTMLSelectElement) || !t.matches('[data-ecs-actor]')) return;
      actor = t.value;
      try { localStorage.setItem(ACTOR_KEY, t.value); } catch { /* 이 창에서만 기억 */ }
      tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '강사 시트',
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '2.0 부품 화면이 이 서버에 아직 연결되지 않았습니다.' : hostOk === null ? '강사 시트를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 복사본(Docker)</b> 2.0 강사 시트(영어) 부품 그대로입니다. 고른 사람의 화면(권한·담당 반·보기 설정)으로 열리고, 저장은 이 PC의 복사본에만 됩니다(실제 발송 없음). 계획 칸·학생 기록·출결·목표·메모·Shouting·월간 계획서·학생 영어 이름·보강 추가는 저장되고, 아직 잇지 않은 것(교재 배정·되돌리기·미룸/당김·단어 수 가져오기·오늘 면)은 같은 자리에서 '복사본 보기 전용'으로 알립니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot style="position:relative;min-height:420px">${wait ? `<p class="v2h-wait">${esc(wait)}</p>` : ''}</div>`;
    },
  });
})();
