/* 2.0 화면 — 선생님 원스크린 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 *"2.0으로 표현해야함 … 수업보고서 발송이나"*).
   그리기는 2.0의 실제 React 부품(OneScreenClient · VideoHomeworkProvider)이 한다 — 같은 출처 iframe `/v2-host/onescreen.html?…`
   (v2-host/src/onescreen.tsx, 데이터 = /api/v2/onescreen?props=1, Docker 복사본). 셸의 현재 계정으로 조회하고 호스트 자리(slot)만 둔다.
   live.js는 그릴 때마다 #main을 통째로 바꾸므로
   iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다(다른 화면으로 가면 숨기고, 사이드바로 돌아와도 보던 선생님·날짜 그대로 — 입력 중인 글이 남는다).
   iframe 안 이동(날짜·보기·반·학생)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-onescreen?…)를 맞춘다. 학생·반 같은 2.0 주소는
   3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'onescreen', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  const KEEP = ['date', 'all', 'view', 'class', 'student'];
  let api = null, frame = null, requested = null, hostOk = null, checking = false, wired = false;
  const queryOf = q => { const o = new URLSearchParams(); const account = S.accountId(); if (account) o.set('teacher', account); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'osh-frame'; frame.title = '선생님 수업보고서'; frame.dataset.v2Host = ID; frame.hidden = true;
      document.body.append(frame);
    }
    if (query === requested) return;
    const url = `${HOST}${query ? `?${query}` : ''}`;
    // A loaded iframe given a new src adds a history entry (Back would turn only the frame back) — replace its address instead.
    if (requested === null) frame.src = url; else frame.contentWindow?.location.replace(url);
    requested = query;
  }
  /** 자리(slot) 위에 겹친다 — 문서 좌표라 스크롤을 따라간다. 자리가 없으면(다른 화면) 숨긴다. */
  function place() {
    if (!frame) return;
    const slot = document.querySelector(`[data-v2-screen="${ID}"] [data-v2-host-slot]`);
    if (!slot) { frame.hidden = true; return; }
    slot.style.height = `${Math.max(480, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  }
  /** 2.0 강사뷰 '영상 제출 현황'(/onescreen/video-homework) → 3.0 영상 제출 현황 화면의 '내가 낸 숙제' 보기 + 보는 사람(actor = 지금 원스크린의 선생님).
   *  2.0 page가 읽는 주소 열쇠는 그대로 싣는다. 다른 주소(/lesson-reports/video-homework 등)는 null — 이 함수는 그 한 주소만 넘긴다.
   *  ⚠️ 호스트 안 이동(hostNavigate)은 이 주소를 /onescreen의 하위 주소로 보고 iframe 주소를 먼저 바꾼다(날짜·all을 잃는다) — 그 갈래(v2-host-nav의 v2path)는
   *  받지 않는다. 2.0 원스크린 부품엔 이 주소로 가는 링크가 없고(강사 셸 메뉴·알림에만), 창 열기 알림(v2-host-open · eywa-open-window)만 여기로 온다. */
  function videoHomeworkTarget(href, actorId) {
    const u = new URL(href || '/', location.origin);
    if (!/^\/onescreen\/video-homework\/?$/.test(u.pathname)) return null;
    const q = new URLSearchParams([['view', 'mine']]);
    for (const k of ['date', 'class', 'subject', 'grade', 'school', 'sort', 'from', 'to', 'q', 'status']) { const v = u.searchParams.get(k); if (v) q.set(k, v); }
    if (actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) q.set('actor', actorId);
    return `#v2-video-homework?${q}`;
  }
  /** 원스크린의 선생님은 셸의 현재 계정이다. */
  const screenTeacher = () => S.accountId();
  /** 2.0 주소 → 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const vh = videoHomeworkTarget(href, screenTeacher());
    if (vh) { location.hash = vh; return; }
    const m =/^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('아직 3.0에 없는 화면입니다.');
  }
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-nav' && d.screen === ID) {
        const nq = new URLSearchParams(String(d.query || ''));
        const query = queryOf(nq);
        requested = query; // iframe은 이미 그 주소다 — 3.0이 다시 그려도 다시 읽지 않게 먼저 맞춘다
        const current = new URLSearchParams(location.hash.split('?')[1] || '');
        const out = new URLSearchParams(query);
        if (current.get('teacherHome') === '1') out.set('teacherHome', '1');
        const page = `#v2-${ID}${out.size ? `?${out}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '선생님 수업보고서',
    render(ctx) {
      api = ctx.api; wire();
      const q = ctx.query, teacherMode = q.get('teacherHome') === '1';
      const teacherStrip = teacherMode ? window.TeacherHome?.strip(ctx, S.accountId(), 'onescreen') || '' : '';
      // One check of the host page — renders before its answer do not ask again.
      if (hostOk === null) { if (!checking) { checking = true; fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } }); } }
      else if (hostOk) { const query = queryOf(q); requestAnimationFrame(() => { ensureFrame(query); place(); }); }
      const wait = hostOk === false ? '이 화면이 이 서버에 아직 연결되지 않았습니다.' : hostOk === null ? '선생님 수업보고서를 여는 중…' : '';
      return `${teacherStrip}<div class="osh-slot" data-v2-host-slot>${wait ? `<p class="osh-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
