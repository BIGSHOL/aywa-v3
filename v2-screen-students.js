/* 2.0 화면 — 원생목록 · 원생 상세 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/students.html?…`(v2-host/src/students.tsx · students-list.tsx · students-detail.tsx,
   데이터 = /api/v2/students, Docker 복사본). 3.0 쪽은 '연습 화면' 안내 한 줄과 자리(slot)만 둔다 — 겹쳐 두기·주소 맞추기는 수업목록 껍데기와 같다
   (live.js가 #main을 통째로 바꾸므로 iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다 · 모양은 v2-screen-timetable.css의 `.v2h-*`).
   iframe 안 이동(필터·정렬·쪽 · 학생 상세·탭 같은 하위 주소는 v2path)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-students?…)를 맞춘다.
   반 같은 다른 2.0 주소는 3.0에 그 화면이 있으면 그 화면으로(하위 경로는 v2path), 없으면 안내만 한다. 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'students', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 목록·상세 page.tsx가 읽는 주소 열쇠 그대로(이름이 같은 열쇠는 한 칸) + v2path(2.0 하위 경로 /students/<학생> …).
  const KEEP = ['v2path', 'status', 'subject', 'q', 'page', 'grade', 'teacher', 'field', 'sort', 'noenr', 'program', 'first', 'level', 'mix', 'from',
    'contribution', 'month', 'view', 'entity', 'tab', 'video', 'back', 'jjFrom', 'jjTo', 'to', 'kind', 'dir', 'fScore', 'fDelta'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false;
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '원생목록'; frame.dataset.v2Host = ID; frame.hidden = true;
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
  // 이 화면이 그리는 2.0 하위 주소(새 학생 · 원생 상세 · 학생 수정) — 창 열기 알림이 와도 같은 화면에서 연다(조건 그대로).
  const OWN = /^\/students(?:\/new|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/edit)?)?$/i;
  /** 2.0 주소 → 이 화면(하위 주소) · 3.0에 있는 같은 2.0 화면(하위 경로는 v2path, 조건 그대로). 없으면 안내만(주소를 보이지 않는다). */
  function openFromHost(href) {
    const u = new URL(href || '/', location.origin), path = u.pathname;
    const q = new URLSearchParams(u.search);
    if (OWN.test(path)) {
      if (path !== '/students') q.set('v2path', path);
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
      if (d.type === 'v2-host-nav' && d.screen === ID) {
        const query = queryOf(new URLSearchParams(String(d.query || '')));
        requested = query; // iframe은 이미 그 주소다 — 3.0이 다시 그려도 다시 읽지 않게 먼저 맞춘다
        const page = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '원생목록',
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '원생목록을 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '원생목록을 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 이 PC의 연습 자료로 보는 원생목록입니다. 학생 정보 저장과 엑셀 내보내기·가져오기는 아직 지원하지 않습니다.</p></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
