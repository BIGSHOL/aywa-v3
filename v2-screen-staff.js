/* 2.0 화면 — 직원관리 (V2-SCREENS.md, 처리 화면 세션 R · 작업자 A — 하위 화면(연차 관리 · 급여명세서 · 이력서)은 작업자 B).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/staff.html?…`(v2-host/src/staff.tsx, 데이터 = /api/v2/staff,
   Docker 복사본). 셸의 현재 계정으로 조회·저장하고 호스트 자리만 둔다.
   기록 바로 열기: `#v2-staff?v2path=/staff/<직원 id>` · 탭 = `&tab=info|monthly|classes|salary|activity`. */
(() => {
  'use strict';
  const ID = 'staff', LABEL = '직원관리', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx들이 읽는 주소 열쇠 그대로(목록 · 상세 · 하위 화면의 staff · edit) + v2path(2.0 하위 경로).
  const KEEP = ['v2path', 'invited', 'tab', 'role', 'status', 'subject', 'emp', 'q', 'sort', 'size', 'page', 'period', 'staff', 'edit'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false;
  const SEL = `[data-v2-screen="${ID}"]`;
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = LABEL; frame.dataset.v2Host = ID; frame.hidden = true;
      document.body.append(frame);
    }
    if (query !== requested) { requested = query; frame.src = `${HOST}${query ? `?${query}` : ''}`; }
  }
  function place() {
    if (!frame) return;
    const slot = document.querySelector(`${SEL} [data-v2-host-slot]`);
    if (!slot) { frame.hidden = true; return; }
    slot.style.height = `${Math.max(420, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  }
  // 이 화면이 그리는 2.0 주소(목록 · 상세 · 근무 설정 · 등록 · 연차 관리 · 급여명세서 · 이력서) — 창 열기 알림이 와도 같은 화면에서 연다.
  const OWN = /^\/staff(?:\/new|\/annual-leave|\/payroll|\/resumes(?:\/new|\/[0-9a-f-]{36})?|\/[0-9a-f-]{36}(?:\/edit|\/payroll)?)?$/i;
  function openFromHost(href) {
    const raw = String(href || ''), path = raw.split(/[?#]/)[0];
    if (OWN.test(path)) {
      const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#')[0] : '');
      if (path !== '/staff') q.set('v2path', path);
      const query = queryOf(q);
      location.hash = `#v2-${ID}${query ? `?${query}` : ''}`;
      return;
    }
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(raw);
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.');
  }
  const tellHost = () => { const id = S.accountId(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-nav' && d.screen === ID) {
        const query = queryOf(new URLSearchParams(String(d.query || '')));
        requested = query;
        const page = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
      else if (d.type === 'v2-host-editors' && d.screen === ID) tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: LABEL,
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '직원관리를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '직원관리를 여는 중…' : '';
      return `<div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
