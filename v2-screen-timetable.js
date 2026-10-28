/* 2.0 화면 — 시간표 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 *"시간표가 기존 2.0 뷰와 너무 다른데"*).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/timetable.html?…`(v2-host/, 데이터 = Docker 복사본).
   3.0 쪽은 '연습 복사본' 한 줄과 자리(slot)만 둔다. live.js는 그릴 때마다 #main을 통째로 바꾸므로 iframe을 본문 안에 두면
   매번 다시 읽힌다 → iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다(다른 화면으로 가면 숨기고, 돌아오면 그대로).
   iframe 안 이동은 iframe이 주소만 바꾸고 알려 준다(v2-host-nav) → 3.0 주소(#v2-timetable?…)를 맞춘다. 학생·반 상세 같은 2.0 주소는
   3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다.
   저장(2단계)은 Docker 복사본에만 — 3.0엔 로그인이 없어 '저장하는 사람'을 이 띠에서 고른다(호스트가 v2-host-editors로 목록을
   알려 주고, 고른 값은 같은 출처 저장소 `v2-host-actor:timetable` + v2-host-actor 알림으로 호스트에 간다). */
(() => {
  'use strict';
  const ID = 'timetable', HOST = `/v2-host/${ID}.html`;
  const KEEP = ['subject', 'view', 'kind', 'week', 'etrack', 'students', 'emptyperiods', 'emptydays', 'compact1h', 'gedit'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const ACTOR_KEY = `v2-host-actor:${ID}`;
  const esc = s => V2Screens.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '시간표(2.0 화면)'; frame.dataset.v2Host = ID; frame.hidden = true;
      document.body.append(frame);
    }
    if (query !== requested) { requested = query; frame.src = `${HOST}${query ? `?${query}` : ''}`; }
  }
  /** 자리(slot) 위에 겹친다 — 문서 좌표라 스크롤을 따라간다. 자리가 없으면(다른 화면) 숨긴다. */
  function place() {
    if (!frame) return;
    const slot = document.querySelector('[data-v2-screen="timetable"] [data-v2-host-slot]');
    if (!slot) { frame.hidden = true; return; }
    // 높이 = 화면 높이 − 자리의 문서 위치(스크롤과 무관 — 스크롤할 때마다 자리가 늘어나지 않게).
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
  /** 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts)와 같은 규칙. */
  function currentActor() {
    let stored = null;
    try { stored = localStorage.getItem(ACTOR_KEY); } catch { /* 저장소를 못 쓰면 이 창에서만 */ }
    for (const id of [actor, stored]) if (id && editors.some(e => e.id === id)) return id;
    return editors[0]?.id ?? null;
  }
  const actorPicker = () => (editors.length ? `<label class="v2h-actor"><span>저장하는 사람</span><select data-v2h-actor aria-label="저장하는 사람">${editors.map(e => `<option value="${esc(e.id)}"${e.id === currentActor() ? ' selected' : ''}>${esc(e.role ? `${e.name} · ${e.role}` : e.name)}</option>`).join('')}</select></label>` : '');
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
        const at = document.querySelector('[data-v2-screen="timetable"] [data-v2h-actor-slot]');
        if (at) at.innerHTML = actorPicker();
        tellHost();
      }
    });
    addEventListener('change', e => {
      const t = e.target;
      // 시간표 화면 안의 선택만 — 다른 화면이 같은 표식을 써도 시간표의 '저장하는 사람'이 바뀌지 않게.
      if (!(t instanceof HTMLSelectElement) || !t.matches('[data-v2-screen="timetable"] [data-v2h-actor]')) return;
      actor = t.value;
      try { localStorage.setItem(ACTOR_KEY, t.value); } catch { /* 이 창에서만 기억 */ }
      tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  V2Screens.register({
    id: ID, label: '시간표',
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '2.0 부품 화면이 이 서버에 아직 연결되지 않았습니다.' : hostOk === null ? '시간표를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 복사본(Docker)</b> 2.0 시간표 부품 그대로입니다. 저장은 이 PC의 복사본에만 됩니다(복사본 — 실제 발송 없음). 학생 반 이동·등원 요일·대기와 퇴원(수강 종료)으로 보내기·메모 시트는 저장되고, 아직 잇지 않은 저장은 같은 자리에서 '복사본 보기 전용'으로 거절됩니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
