/* 2.0 화면 — 교재 요청 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/textbook-requests.html?…`(v2-host/src/textbook-requests.tsx · textbook-requests-page.tsx,
   데이터 = /api/v2/textbook-requests, Docker 복사본). 3.0 쪽은 '연습 화면' 안내 한 줄과 '보는 사람' 고르기, 자리(slot)만 둔다(교재목록 껍데기와 같다).
   교재 요청은 사람마다 다르다(선생님 = 담당 학생 + 본인 요청) — 이 띠에서 '보는 사람'을 고르고, 그 사람이 요청서를 쓰는 사람도 된다.
   학생 같은 다른 2.0 주소는 3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'textbook-requests', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 학생 선택칸 초기값 + 업무 흐름에서 연 주문 한 건을 호스트 주소까지 보존한다.
  const KEEP = ['studentId', 'orderId'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '교재 요청'; frame.dataset.v2Host = ID; frame.hidden = true;
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
  // 이 화면이 그리는 2.0 주소 — 창 열기 알림이 와도 같은 화면에서 연다(하위 주소는 없다).
  const OWN = /^\/textbook-requests$/;
  /** 2.0 주소 → 이 화면(하위 주소) · 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const path = String(href || '').split(/[?#]/)[0];
    if (OWN.test(path)) { const q = queryOf(new URLSearchParams(String(href).split('?')[1] ?? '')); location.hash = `#v2-${ID}${q ? `?${q}` : ''}`; return; }
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('아직 3.0에 없는 화면입니다.');
  }
  /** 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts)와 같은 규칙. */
  const currentActor = () => S.accountId();
  const actorPicker = () => ''; // 화면별 선택기는 셸 계정으로 대체했다.
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
      tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '교재 요청',
    render(ctx) {
      api = ctx.api; wire();
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '교재 요청을 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '교재 요청을 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> ${S.practiceCopy.selectedPerson}의 화면으로 보입니다(선생님은 담당 원생과 본인 요청만). 요청서도 ${S.practiceCopy.selectedPerson}으로 씁니다. 학원 로고는 보이지 않고, 학부모 발송은 아직 지원하지 않습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
