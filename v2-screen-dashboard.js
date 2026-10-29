/* 2.0 화면 — 운영실(대시보드) (V2-SCREENS.md '그리는 방식 전환'). 그리기는 2.0의 실제 React 부품(Overview)이 한다 — 같은 출처 iframe
   `/v2-host/dashboard.html?…`(v2-host/src/dashboard.tsx, 데이터 = /api/v2/dashboard?props=1, Docker 복사본). 3.0 쪽은 '연습 화면' 안내 한 줄,
   '보는 원장' 고르기(2.0 화면은 로그인한 사람의 것이라 고르는 칸이 없다), 자리(slot)만 둔다. iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다
   (live.js가 그릴 때마다 #main을 바꾸므로 — v2-screen-onescreen.js와 같은 방식). 카드·팝업의 2.0 주소는 iframe이 모두 넘긴다(v2-host-open):
   3.0에 있는 2.0 화면(원생 상세 · 반 상세 · 시간표 · 출석부 …)은 그 화면, 그 화면이 없는 학생·반은 3.0 기록 창, 나머지는 안내만. 운영실 자리는 늘 운영실이다. */
(() => {
  'use strict';
  const ID = 'dashboard', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  const h = S.esc, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // requested = iframe에 실린 조건 · sticky = 다른 화면에서 사이드바로 돌아올 때 되살릴 조건(기본 원장을 고르면 비운다) ·
  // away = 운영실 자리가 사라진 적이 있다(다른 화면으로 갔다) — 운영실 안에서 뒤로 가기로 빈 주소가 된 것은 되살리지 않는다.
  let api = null, frame = null, requested = null, sticky = null, away = false, hostOk = null, checking = false, wired = false, last = null;
  // 서버와 같은 규칙(UUID)인 viewer만 싣는다 — 손으로 친 잘못된 값이 오류 화면이 되거나 되살아나지 않게.
  const queryOf = q => { const v = q.get('viewer'); return v && UUID.test(v) ? new URLSearchParams({ viewer: v }).toString() : ''; };

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
    if (!slot) { frame.hidden = true; away = true; return; }
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
    if (!to) { api?.toast?.('이 화면은 연습 화면에 아직 없습니다.'); return; }
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
    document.addEventListener('change', ev => {
      const t = ev.target.closest?.(`[data-v2-screen="${ID}"] [data-dsh="viewer"]`); if (!t || !last) return;
      if (!t.value) sticky = null; // 기본 원장 = 조건 없음 — 되살리지 않는다
      last.go({ viewer: t.value });
    });
  }

  S.register({
    id: ID, label: '운영실',
    render(ctx) {
      api = ctx.api; last = ctx; wire();
      // 다른 화면에서 사이드바로 돌아오면(#v2-dashboard, 조건 없음) 보던 원장 그대로.
      if (!ctx.query.toString() && sticky && away) { away = false; location.replace(`#v2-${ID}?${sticky}`); return ''; }
      away = false;
      sticky = queryOf(ctx.query) || null;
      const q = ctx.query, list = ctx.load({ list: 'viewers' }), viewers = list.status === 'ready' ? list.data.viewers : [];
      const pick = q.get('viewer') || '';
      // 호스트 화면은 한 번만 확인한다 — 그 답이 오기 전의 그리기는 다시 묻지 않는다.
      if (hostOk === null) { if (!checking) { checking = true; fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } }); } }
      else if (hostOk) { const query = queryOf(q); requestAnimationFrame(() => { ensureFrame(query); place(); }); }
      const wait = hostOk === false ? '이 화면이 이 서버에 아직 연결되지 않았습니다.' : hostOk === null ? '운영실을 여는 중…' : '';
      // 기본(최근 활동이 가장 많은 원장)은 늘 고를 수 있다 · 목록에 없는 id면 서버도 기본 원장으로 그린다 — 칸도 기본을 가리킨다.
      const listed = viewers.some(v => v.id === pick);
      const picker = `<label class="dsh-pick"><span>보는 원장</span><select data-dsh="viewer" aria-label="보는 원장"><option value="" ${listed ? '' : 'selected'}>최근 활동이 가장 많은 원장</option>${viewers.map(v => `<option value="${h(v.id)}" ${v.id === pick ? 'selected' : ''}>${h(v.name)}</option>`).join('')}</select></label>`;
      return `<div class="dsh-bar"><p class="dsh-note" role="note"><b>연습 화면</b> 선택한 원장의 운영실 화면입니다. 숫자는 연습 데이터를 만든 때 기준이고, 저절로 새로 고쳐지지 않습니다. 카드는 그 원장의 운영실 배치대로 보입니다.</p>${picker}</div>
        <div class="dsh-slot" data-v2-host-slot>${wait ? `<p class="dsh-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
