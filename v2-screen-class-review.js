/* 2.0 화면 — 직원 평가 (V2-SCREENS.md, 팀장 세션 L · 작업자 v2-meetings).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/class-review.html?…`(v2-host/src/class-review.tsx, 데이터 = /api/v2/class-review,
   Docker 복사본). 3.0 쪽은 안내 한 줄 · '저장하는 사람' 고르기 · 자리(slot)만 — 신규 콜&상담 껍데기와 같은 틀이다.
   주소: `#v2-class-review?tab=review|portfolio&teacher=…`(2.0 page.tsx가 읽는 열쇠 그대로) · 상세·채점·새 평가·문항 세트·종합 = `v2path=/class-review/<id>[/score]` · `/class-review/new|template|board`(+ `set`·`new`).
   주소의 actor=<직원 id>는 고른 사람보다 먼저 이긴다(신규 콜&상담과 같은 규칙) — 명단이 늦게 와도 그 사람이 저장하는 사람으로 기억된다. */
(() => {
  'use strict';
  const ID = 'class-review', LABEL = '직원 평가', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로 + v2path(2.0 하위 경로).
  const KEEP = ['v2path', 'tab', 'teacher', 'set', 'new', 'judgment'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null, urlActor = null;
  const ACTOR_KEY = `v2-host-actor:${ID}`, SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function renderReviewOverview(model) {
    const template = document.createElement('template');
    template.innerHTML = S.renderOverview(model);
    const section = template.content.querySelector('.v2o');
    if (!section) return template.innerHTML;
    section.classList.add('v2o-review');
    const table = section.querySelector('table'), cols = document.createElement('colgroup');
    for (const column of model.columns) { const col = document.createElement('col'); col.dataset.col = column.key; cols.append(col); }
    if (model.rows.some(row => row.action)) { const col = document.createElement('col'); col.dataset.col = 'action'; cols.append(col); }
    table?.prepend(cols);
    table?.querySelectorAll('tbody tr:not(.v2o-group)').forEach((tr, i) => {
      const row = model.rows[i];
      if (row?.href) tr.dataset.v2OverviewHref = row.href;
      const button = tr.querySelector('[data-v2-overview-action]');
      if (button && row?.action?.kind !== 'none') {
        button.dataset.v2ReviewTask = row.action.kind;
        button.dataset.teacher = row.teacherId;
        button.dataset.teacherName = row.cells.name;
        button.dataset.month = row.month;
        button.dataset.evidence = row.lowItems?.join(', ') || '';
      }
    });
    return template.innerHTML;
  }

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
  // 이 화면이 그리는 2.0 주소(목록 · 상세 · 채점 · 새 평가 · 문항 세트 · 종합) — 창 열기 알림이 와도 같은 화면에서 연다.
  const OWN = /^\/class-review(?:\/new|\/template|\/board|\/[0-9a-f-]{36}(?:\/score)?)?$/i;
  function openFromHost(href) {
    const raw = String(href || ''), path = raw.split(/[?#]/)[0];
    if (OWN.test(path)) {
      const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#')[0] : '');
      if (path !== '/class-review') q.set('v2path', path); else q.delete('v2path');
      const query = queryOf(q);
      location.hash = `#v2-${ID}${query ? `?${query}` : ''}`;
      return;
    }
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(raw);
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.');
  }
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
        requested = query;
        const page = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
      else if (d.type === 'v2-host-editors' && d.screen === ID && Array.isArray(d.editors)) {
        editors = d.editors.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').map(x => ({ id: x.id, name: x.name, role: typeof x.role === 'string' ? x.role : '' }));
        // 주소 actor가 명단보다 먼저 왔으면 명단을 받은 지금 기억한다 — 호스트의 저장(hostActor)은 기억을 먼저 보므로, 안 하면 화면은 주소의 사람인데
        // 저장은 예전에 고른 사람으로 나간다.
        if (actor && editors.some(x => x.id === actor)) try { localStorage.setItem(ACTOR_KEY, actor); } catch { /* 이 창에서만 */ }
        const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`);
        if (at) at.innerHTML = actorPicker();
        tellHost();
      }
    });
    addEventListener('change', e => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement) || !t.matches(`${SEL} [data-v2h-actor]`)) return;
      actor = t.value;
      try { localStorage.setItem(ACTOR_KEY, t.value); } catch { /* 이 창에서만 기억 */ }
      tellHost();
      api?.render?.();
    });
    document.addEventListener('click', e => {
      const button = e.target.closest?.(`${SEL} [data-v2-review-task]`);
      if (!button) return;
      const closing = button.dataset.v2ReviewTask === 'closing', name = button.dataset.teacherName, month = button.dataset.month;
      api?.showCardRequest?.({ title: `${month} ${name} ${closing ? '평가 마감 확인' : '지도 요청'}`.slice(0, 80),
        body: closing ? `${name} 강사의 ${month} 직원 포트폴리오 평가가 아직 마감되지 않았습니다. 마감 상태를 확인해 주세요.`
          : `${name} 강사의 ${month} 마감 평가가 총점/만점 70% 미만입니다. 낮은 항목: ${button.dataset.evidence || '항목별 근거 확인 필요'}. 포트폴리오에서 근거를 확인하고 지도해 주세요.`,
        source: 'direct', draftKey: `portfolio-overview:${button.dataset.v2ReviewTask}:${month}:${button.dataset.teacher}`,
        context: { family: 'class-review', familyLabel: '강사평가', records: [{ id: button.dataset.teacher, label: name }] } });
    });
    document.addEventListener('click', e => {
      const row = e.target.closest?.(`${SEL} .v2o-review tr[data-v2-overview-href]`);
      if (row && !e.target.closest('a, button, input, select, textarea')) location.hash = row.dataset.v2OverviewHref;
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: LABEL,
    render(ctx) {
      api = ctx.api; wire();
      // 주소의 actor=<직원 id>가 가장 먼저 이긴다(업무 흐름 '처리 화면'이 `v2path=/class-review/<평가 id>&actor=<담당>`으로 열 수 있게 — 신규 콜&상담과 같은 규칙).
      // 고를 수 있는 사람이 아니면 currentActor가 무시하고, 기억은 명단에 있는 사람일 때만 쓴다(출석부 화면과 같은 규칙).
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f-]{36}$/i.test(asked) && location.hash !== urlActor) {
        urlActor = location.hash; actor = asked;
        if (editors.some(e => e.id === asked)) try { localStorage.setItem(ACTOR_KEY, asked); } catch { /* 이 창에서만 */ }
        if (editors.length) { const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`); if (at) at.innerHTML = actorPicker(); }
        tellHost();
      }
      if (!ctx.query.has('v2path') && !ctx.query.has('tab') && !ctx.query.has('judgment')) {
        let remembered = null;
        try { remembered = localStorage.getItem(ACTOR_KEY); } catch { /* 이 창에서만 선택 */ }
        const entry = ctx.load({ actor: currentActor() || actor || remembered, subject: ctx.query.get('subject'), teacher: ctx.query.get('teacher') });
        if (entry.data?.editors && !editors.length) editors = entry.data.editors;
        if (entry.data?.page === 'overview') {
          requestAnimationFrame(place);
          return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 마감된 직원 포트폴리오 점수를 과목·강사·항목 순서로 볼 수 있습니다. 항목의 월별 근거는 마지막 층에서 열립니다. <a href="#v2-class-review?tab=review">기존 직원 평가 목록 열기</a></p><span data-v2h-actor-slot>${actorPicker()}</span></div>`
            + renderReviewOverview(entry.data.overview);
        }
        if (entry.data?.page === 'moduleOff' || entry.data?.page === 'noMenu') return '<p class="v2s-note">이 화면을 열 수 없습니다.</p>';
        if (!entry.data && entry.status !== 'ready') return `<p class="v2s-note">${entry.status === 'error' ? esc(entry.error || '강사평가 현황을 불러오지 못했습니다.') : '강사평가 현황을 불러오는 중…'}</p>`;
      }
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '직원 평가를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '직원 평가를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 새 평가·채점·문항 세트·최종 총평·직원 포트폴리오 입력은 ${S.practiceCopy.selectedPerson}의 권한과 이름으로 저장됩니다. 직원 포트폴리오는 원장 역할만 볼 수 있습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
