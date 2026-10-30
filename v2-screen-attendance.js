/* 2.0 화면 — 출석부 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품(월별 출석부 page.tsx의 MatrixTable·GridProvider·AttendanceHub …)이 한다 — 같은 출처 iframe
   `/v2-host/attendance.html?…`(v2-host/src/attendance.tsx · attendance-page.tsx, 데이터 = /api/v2/attendance, Docker 복사본).
   3.0 쪽은 '연습 복사본' 안내 한 줄, '저장하는 사람' 고르기(3.0엔 로그인이 없다), 자리(slot)만 둔다. live.js는 그릴 때마다 #main을
   통째로 바꾸므로 iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다(다른 화면으로 가면 숨기고, 돌아오면 그대로).
   iframe 안 이동(달·과목·강사·반·보기)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-attendance?…)를 맞춘다. 학생·반 같은 2.0 주소는
   3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다.
   저장하는 사람 목록은 호스트가 알려 주고(v2-host-editors — 출결 전체 권한 직원), 고른 값은 같은 출처 저장소
   `v2-host-actor:attendance` + v2-host-actor 알림으로 호스트에 간다. 보기 설정(정렬·날짜축·퇴직 숨김·접은 반)도 그 사람의 것.
   모양은 시간표 껍데기와 같은 `.v2h-*`(v2-screen-timetable.css — 화면 CSS는 모두 함께 실린다). 겹치는 자리 계산만 여기 인라인. */
(() => {
  'use strict';
  const ID = 'attendance', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로(class·month·teacher·subject·mode·q).
  // 하위 주소는 v2path(2.0 `/attendance/seat/<자리>` — 날짜 date · 교시 start · `/attendance/live` — 탭 tab · 요약 기간 from)로 iframe에 간다(shims/host-nav.ts 규칙).
  const KEEP = ['v2path', 'month', 'subject', 'teacher', 'class', 'mode', 'q', 'date', 'start', 'tab', 'from'];
  const SEL = `[data-v2-screen="${ID}"]`;
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null, urlActor = null;
  const esc = s => S.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '출석부'; frame.dataset.v2Host = ID; frame.hidden = true;
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
    // 높이 = 화면 높이 − 자리의 문서 위치(스크롤과 무관 — 스크롤할 때마다 자리가 늘어나지 않게). 2.0 출석부는 격자 하나만 스크롤한다.
    slot.style.height = `${Math.max(420, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  }
  /** 2.0 주소 → 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('아직 3.0에 없는 화면입니다.');
  }
  /** 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts)와 같은 규칙. */
  const currentActor = () => S.accountId();
  const actorPicker = () => ''; // 화면별 선택기는 셸 계정으로 대체했다.
  // 호스트(shims/server-action.ts hostActor)는 같은 출처 기억을 알림보다 먼저 본다 — 명단이 늦게 와도(주소 actor가 먼저 온 경우) 정해진 사람을 기억에도 적어야
  // 저장이 그 사람으로 나간다(회의록 작업자 발견 10-28). currentActor는 명단 안의 사람만 돌려주므로 명단 밖 id가 기억을 지우지는 않는다.
  const tellHost = () => {
    const id = currentActor(); if (!id) return;
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin);
  };
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
      if (!(t instanceof HTMLSelectElement) || !t.matches("[data-att-actor]")) return;
      actor = t.value;
      tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '출석부',
    render(ctx) {
      api = ctx.api; wire();
      // 주소의 actor=<직원 id>가 가장 먼저 이긴다(업무 흐름 '처리 화면' 단추가 그 단계 담당을 싣는다 — 메인 10-28, 전자결재 화면과 같은 규칙).
      // 고를 수 있는 사람이 아니면 currentActor가 무시한다. 같은 주소로 다시 오면(그 사이 사람을 바꿨어도) 다시 이긴다.
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f-]{36}$/i.test(asked) && location.hash !== urlActor) {
        urlActor = location.hash; actor = asked;
        // 기억은 명단에 있는 사람일 때만 — 명단 밖 id가 앞서 고른 사람을 지우지 않게(명단이 아직 안 왔으면 이 창 안에서만 이긴다).
        if (editors.length) { const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`); if (at) at.innerHTML = actorPicker(); }
        tellHost();
      }
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '출석부를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '출석부를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 칸 출결·메모·일괄 출결·범위 채우기·자리 출결·보강 예약·결석 통보 접수와 보기 설정을 저장할 수 있습니다. 금액 열(청구액·실급여)은 아직 없습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot style="position:relative;min-height:420px">${wait ? `<p class="v2h-wait">${esc(wait)}</p>` : ''}</div>`;
    },
  });
})();
