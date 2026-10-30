/* 2.0 화면 — 신규 콜&상담 (V2-SCREENS.md, 팀장 세션 L · 작업자 v2-enrollment).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/enrollment.html?…`(v2-host/src/enrollment.tsx, 데이터 = /api/v2/enrollment,
   Docker 복사본). 3.0 쪽은 안내 한 줄 · '저장하는 사람' 고르기 · 자리(slot)만 — 전자결재 껍데기와 같은 틀이다.
   주소: `#v2-enrollment?view=kanban|table|stats&…`(2.0 page.tsx가 읽는 열쇠 그대로) · 상세·새 상담·수정 = `v2path=/enrollment/<id>[/edit]` · `/enrollment/new`. */
(() => {
  'use strict';
  const ID = 'enrollment', LABEL = '신규 콜&상담', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로 + v2path(2.0 하위 경로).
  const KEEP = ['v2path', 'form', 'view', 'month', 'consultant', 'q', 'outcome', 'page', 'range', 'year', 'received', 'from',
    'trend', 'trendMonth', 'trendFrom', 'trendTo', 'trendSpan', 'pg', 'pgMonth', 'pgFrom', 'pgTo', 'pgSpan'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null, urlActor = null;
  const SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
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
  // 이 화면이 그리는 2.0 주소(목록 · 상세 · 수정 · 새 상담) — 창 열기 알림이 와도 같은 화면에서 연다.
  const OWN = /^\/enrollment(?:\/new|\/[0-9a-f-]{36}(?:\/edit)?)?$/i;
  function openFromHost(href) {
    const raw = String(href || ''), path = raw.split(/[?#]/)[0];
    if (OWN.test(path)) {
      const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#')[0] : '');
      if (path !== '/enrollment') q.set('v2path', path); else q.delete('v2path');
      const query = queryOf(q);
      location.hash = `#v2-${ID}${query ? `?${query}` : ''}`;
      return;
    }
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(raw);
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('아직 3.0에 없는 화면입니다.');
  }
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
        requested = query;
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
      if (!(t instanceof HTMLSelectElement) || !t.matches(`${SEL} [data-v2h-actor]`)) return;
      actor = t.value;
      tellHost();
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: LABEL,
    render(ctx) {
      api = ctx.api; wire();
      // 주소의 actor=<직원 id>가 가장 먼저 이긴다(업무 흐름 '처리 화면' — 후속 조치 업무가 `v2path=/enrollment/<상담 id>&actor=<담당>`으로 연다, 메인 10-28).
      // 고를 수 있는 사람이 아니면 currentActor가 무시하고, 기억은 명단에 있는 사람일 때만 쓴다(출석부 화면과 같은 규칙).
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f-]{36}$/i.test(asked) && location.hash !== urlActor) {
        urlActor = location.hash; actor = asked;
        if (editors.length) { const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`); if (at) at.innerHTML = actorPicker(); }
        tellHost();
      }
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '신규 콜&상담을 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '신규 콜&상담을 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 칸반 끌기·칸 수정·상담 저장은 ${S.practiceCopy.selectedPerson}의 권한과 이름으로 저장됩니다. 녹음·AI 분석·공개 접수 QR은 연습 화면에서 쓰지 않습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
