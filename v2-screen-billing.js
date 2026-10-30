/* 2.0 화면 — 수납관리 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/billing.html?…`(v2-host/src/billing*.tsx,
   데이터 = /api/v2/billing, Docker 복사본). 3.0 쪽은 수납 합계 기준 안내와 호스트 자리만 둔다.
   셸의 현재 계정으로 수납 권한 · 급여 열람 · 쓰기 수준을 조회하고 저장한다.
   iframe 안 이동(면 · 달 · 검색 · 정렬 · 쪽 · 하위 주소)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-billing?…)를 맞춘다.
   학생 같은 다른 2.0 주소는 3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'billing', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx · 각 면이 읽는 주소 열쇠 그대로(+ 하위 주소 v2path — 환불 요청서·지출 상세·수납 통계).
  const KEEP = ['v2path', 'tab', 'period', 'q', 'sort', 'desc', 'page', 'overdue', 'missing', 'invoice', 'subject', 'only', 'allocation', 'confirmation', 'panel', 'status',
    'active', 'cactive', 'cat', 'cpage', 'cpmode', 'csub', 'grade', 'hm', 'hy', 'qid', 'qpage', 'tsub',
    'grain', 'month', 'from', 'to', 'span', 'ex', 'exMonth', 'exFrom', 'exTo', 'exSpan'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false;
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '수납관리'; frame.dataset.v2Host = ID; frame.hidden = true;
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
  // 이 화면이 그리는 2.0 주소 — 창 열기 알림이 와도 같은 화면에서 연다(하위 주소는 v2path로).
  const OWN = /^\/billing(\/[a-z0-9-]+){0,2}$/;
  /** 2.0 주소 → 이 화면(하위 주소) · 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const [path, rest = ''] = String(href || '').split('#')[0].split('?');
    if (OWN.test(path)) {
      const p = new URLSearchParams(rest); if (path !== '/billing') p.set('v2path', path); else p.delete('v2path');
      const q = queryOf(p); location.hash = `#v2-${ID}${q ? `?${q}` : ''}`; return;
    }
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
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
        requested = query; // iframe은 이미 그 주소다 — 3.0이 다시 그려도 다시 읽지 않게 먼저 맞춘다
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
    id: ID, label: '수납관리',
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '수납관리를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '수납관리를 여는 중…' : '';
      return `${(!ctx.query.get('v2path') || ctx.query.get('v2path') === '/billing') && (!ctx.query.get('tab') || ctx.query.get('tab') === 'billing') ? '<p class="v2s-note" role="note">‘총 청구액’ 기준: 선택한 청구월의 할인 전 금액 · 현재 복사본 조회 시점 · 과목 전체 · 무효 제외, 환불 청구 포함. 검색·목록 필터와 관계없이 해당 월 전체입니다.</p>' : ''}
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
