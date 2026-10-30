/* 2.0 화면 — 운영실(대시보드) (V2-SCREENS.md '그리는 방식 전환'). 그리기는 2.0의 실제 React 부품(Overview)이 한다 — 같은 출처 iframe
   `/v2-host/dashboard.html?…`(v2-host/src/dashboard.tsx, 데이터 = /api/v2/dashboard?props=1, Docker 복사본). 셸의 현재 계정으로 조회한다.
   3.0 쪽은 호스트 자리(slot)만 두고, iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다
   (live.js가 그릴 때마다 #main을 바꾸므로 — v2-screen-onescreen.js와 같은 방식). 카드·팝업의 2.0 주소는 iframe이 모두 넘긴다(v2-host-open):
   3.0에 있는 2.0 화면(원생 상세 · 반 상세 · 시간표 · 출석부 …)은 그 화면, 그 화면이 없는 학생·반은 3.0 기록 창, 나머지는 안내만. 운영실 자리는 늘 운영실이다. */
(() => {
  'use strict';
  const ID = 'dashboard', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  let api = null, frame = null, requested = null, hostOk = null, checking = false, wired = false;
  const queryOf = () => { const id = S.accountId(); return id ? new URLSearchParams({ viewer: id }).toString() : ''; };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'dsh-frame'; frame.title = '운영실'; frame.dataset.v2Host = ID; frame.hidden = true;
      document.body.append(frame);
    }
    if (query === requested) return;
    const url = `${HOST}${query ? `?${query}` : ''}`;
    // 이미 읽은 iframe에 새 src를 주면 기록이 하나 쌓인다(뒤로 가기가 iframe만 되돌린다) — 주소를 바꿔 끼운다.
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
  /**
   * 2.0 주소 → 3.0 기록 창(학생·반) 또는 3.0의 같은 2.0 화면(S.target) — 하위 경로는 `v2path`로, 조건은 그대로 싣는다(받는 화면이 자기 규칙으로 고른다:
   * `/attendance/live` → 오늘 출결 · `/timetable?kind=makeup` → 보강). 둘 다 없으면 안내만(주소를 보이지 않는다).
   */
  function openFromHost(href) {
    const u = new URL(href || '/', location.origin), segs = u.pathname.split('/').filter(Boolean);
    const to = segs[0] && segs[0] !== ID ? S.target(segs[0]) : null;
    // 2.0 화면이 곧 3.0의 새 페이지 — 학생·반도 그 화면(원생 상세 · 반 상세)이 있으면 그리로. 없을 때만 3.0 기록 창(메인 10-28).
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (!to && m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    if (!to) { api?.toast?.('아직 3.0에 없는 화면입니다.'); return; }
    const q = new URLSearchParams(u.search);
    if (segs.length > 1) q.set('v2path', u.pathname);
    location.hash = `${to}${q.toString() ? `?${q}` : ''}`;
  }
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '운영실',
    render(ctx) {
      api = ctx.api; wire();
      // 호스트 화면은 한 번만 확인한다 — 그 답이 오기 전의 그리기는 다시 묻지 않는다.
      if (hostOk === null) { if (!checking) { checking = true; fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } }); } }
      else if (hostOk) { const query = queryOf(); requestAnimationFrame(() => { ensureFrame(query); place(); }); }
      const wait = hostOk === false ? '이 화면이 이 서버에 아직 연결되지 않았습니다.' : hostOk === null ? '운영실을 여는 중…' : '';
      return `<div class="dsh-slot" data-v2-host-slot>${wait ? `<p class="dsh-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
