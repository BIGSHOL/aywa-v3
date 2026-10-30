/* 2.0 화면 — 원생상담 (V2-SCREENS.md, 처리 화면 세션 R · 원장 10-28 *"근거보기 들어가도 뭘 처리할 수가 없음"*).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/consultations.html?…`(v2-host/src/consultations.tsx, 데이터 = /api/v2/consultations,
   Docker 복사본). 3.0 쪽은 안내 한 줄 · '보는 사람' 고르기 · 자리(slot)만 — 전자결재 껍데기와 같은 틀이다.
   보는 사람 = 저장하는 사람: 강사면 2.0처럼 본인이 쓴 상담만 보이고 고칠 수 있다.
   업무 흐름 신호 followup_due(상담 후속조치)는 상담 상세의 '완료 표시'로 끝난다.
   기록 바로 열기: `#v2-consultations?v2path=/consultations/<상담 id>[&actor=<직원 id>]` · 후속 목록 = `urg=overdue|today|soon|later|done` ·
   수정 = `v2path=/consultations/<id>/edit` · 새 상담 = `v2path=/consultations/new[&studentId=<원생 id>]` · 통계 = `v2path=/consultations/stats`. */
(() => {
  'use strict';
  const ID = 'consultations', LABEL = '원생상담', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로(목록·통계 필터 · 새 상담의 학생) + v2path(2.0 하위 경로 — 상세 · 수정 · 작성 · 통계).
  const KEEP = ['v2path', 'range', 'cat', 'urg', 'who', 'subject', 'q', 'page', 'size', 'studentId', 'form', 'recordStudent'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null, urlActor = null, lastOverview = null;
  const SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };
  const RATE_LIMITS = Object.freeze({ danger: 50, caution: 90 });
  let classTip = null;

  function renderConsultOverview(model) {
    if (!model.columns?.some(column => column.key === 'rate')) return S.renderOverview(model);
    const rows = model.rows.map(row => {
      const percent = Number.parseFloat(row.cells.rate?.text || '');
      return { ...row, cells: { ...row.cells,
        rate: { ...row.cells.rate, tone: !Number.isFinite(percent) ? '' : percent < RATE_LIMITS.danger ? 'low' : percent < RATE_LIMITS.caution ? 'muted' : 'high' },
      } };
    });
    const template = document.createElement('template');
    template.innerHTML = S.renderOverview({ ...model, rows });
    const section = template.content.querySelector('.v2o');
    section.classList.add('v2o-consultations');
    for (const line of [`이행률 색: ${RATE_LIMITS.danger}% 미만 빨강 · ${RATE_LIMITS.caution}% 미만 주황`]) {
      const note = document.createElement('p'); note.className = 'v2s-note'; note.textContent = line; section.append(note);
    }
    const table = section.querySelector('table');
    const colgroup = document.createElement('colgroup');
    for (const column of model.columns) {
      const col = document.createElement('col'); col.dataset.col = column.key; colgroup.append(col);
    }
    if (model.rows.some(row => row.action)) { const col = document.createElement('col'); col.dataset.col = 'action'; colgroup.append(col); }
    table.prepend(colgroup);
    const renderedRows = table.querySelectorAll('tbody tr:not(.v2o-group)');
    renderedRows.forEach((tr, i) => {
      const row = model.rows[i], link = tr.querySelector('th a');
      if (link) {
        tr.dataset.v2OverviewHref = link.getAttribute('href');
        const name = link.firstChild, label = document.createElement('span');
        label.className = 'v2o-name'; label.textContent = name.textContent; link.replaceChild(label, name);
        const enter = link.querySelector('.v2o-enter'); if (enter) enter.textContent = '›';
      }
      const classes = tr.querySelector('[data-col="classes"]');
      if (classes && row.cells.classes) {
        const names = String(row.cells.classes).split(', ').filter(Boolean);
        classes.dataset.tip = String(row.cells.classes);
        const summary = document.createElement('div'), leading = document.createElement('span');
        summary.className = 'v2o-class-summary'; leading.className = 'v2o-class-leading';
        leading.textContent = names.slice(0, 3).join(', '); summary.append(leading);
        if (names.length > 3) {
          const extra = document.createElement('span'); extra.className = 'v2o-class-extra';
          extra.textContent = `외 ${names.length - 3}개`; summary.append(extra);
        }
        classes.replaceChildren(summary);
      }
    });
    return template.innerHTML;
  }

  function hideClassTip() { if (classTip) classTip.hidden = true; }
  function showClassTip(cell) {
    classTip ??= Object.assign(document.createElement('div'), { className: 'v2o-class-tip', role: 'tooltip' });
    if (!classTip.isConnected) document.body.append(classTip);
    classTip.textContent = cell.dataset.tip;
    classTip.hidden = false;
    const r = cell.getBoundingClientRect(), width = classTip.offsetWidth, height = classTip.offsetHeight;
    classTip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
    classTip.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - height - 8))}px`;
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
  // 이 화면이 그리는 2.0 주소(목록 · 상세 · 수정 · 작성 · 통계) — 창 열기 알림이 와도 같은 화면에서 연다.
  const OWN = /^\/consultations(?:\/new|\/stats|\/[0-9a-f-]{36}(?:\/edit)?)?$/i;
  function openFromHost(href) {
    const raw = String(href || ''), path = raw.split(/[?#]/)[0];
    if (OWN.test(path)) {
      const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#')[0] : '');
      q.set('v2path', path);
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
  const tellHost = () => { const id = currentActor(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  /** 주소의 actor — 고를 수 있는 사람(명단 안)일 때만 이기고 저장한다. 명단 밖이면 앞서 고른 값(저장소)을 건드리지 않는다(팀장 10-28). */
  let pendingActor = null;
  function applyPendingActor() {
    if (!pendingActor || !editors.length) return;
    const id = pendingActor; pendingActor = null;
    if (!editors.some(e => e.id === id)) return;
    actor = id;
    const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`); if (at) at.innerHTML = actorPicker();
    tellHost();
  }
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-nav' && d.screen === ID) {
        const hostQuery = new URLSearchParams(String(d.query || ''));
        if (!hostQuery.has('v2path')) hostQuery.set('v2path', '/consultations');
        const query = queryOf(hostQuery);
        requested = query;
        const page = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
      else if (d.type === 'v2-host-editors' && d.screen === ID && Array.isArray(d.editors)) {
        editors = d.editors.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').map(x => ({ id: x.id, name: x.name, role: typeof x.role === 'string' ? x.role : '' }));
        applyPendingActor();
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
      api?.render?.();
    });
    document.addEventListener('click', e => {
      const button = e.target.closest?.(`${SEL} [data-v2-overview-action]`);
      if (!button || !lastOverview) return;
      const row = lastOverview.rows.find(r => r.action?.key === button.dataset.key);
      if (!row) return;
      const factIds = [lastOverview.period, row.program, row.teacherId];
      const linked = api?.cardRequestFor?.('consultations-homeroom', factIds);
      if (linked) { api?.openFlowCase?.(linked.id); return; }
      const names = row.missingNames || [], records = names.map((label, i) => ({ id: row.missingIds[i], label }));
      api?.showCardRequest?.({ title: `${lastOverview.period} ${row.cells.name} 담임 상담 지도 요청`.slice(0, 80),
        body: [`${lastOverview.period} ${row.group} · ${row.cells.name} 담임 상담 이행을 확인해 주세요.`,
          `대상 ${row.cells.target}명 · 본인 상담 ${row.cells.self}명 · 다른 사람 상담 ${row.cells.other}명 · 미완료 ${row.cells.missing}명`,
          '', '이번 달 본인 상담이 없는 원생', ...names.map(name => `- ${name}`)].join('\n').slice(0, 2000),
        source: 'direct', draftKey: `consultation-guide:${factIds.join(':')}`, context: { family: 'consultations', familyLabel: '담임 상담 이행 현황',
          records, card: { metric: 'consultations-homeroom', factIds, refs: (row.missingIds || []).map(id => ({ type: 'student', id })) } } });
    });
    document.addEventListener('click', e => {
      const row = e.target.closest?.(`${SEL} .v2o-consultations tr[data-v2-overview-href]`);
      if (row && !e.target.closest('a, button, input, select, textarea')) location.hash = row.dataset.v2OverviewHref;
    });
    document.addEventListener('pointerover', e => {
      const cell = e.target.closest?.(`${SEL} .v2o-consultations [data-col="classes"][data-tip]`);
      if (cell && !(e.relatedTarget instanceof Node && cell.contains(e.relatedTarget))) showClassTip(cell);
    });
    document.addEventListener('pointerout', e => {
      const cell = e.target.closest?.(`${SEL} .v2o-consultations [data-col="classes"][data-tip]`);
      if (cell && !(e.relatedTarget instanceof Node && cell.contains(e.relatedTarget))) hideClassTip();
    });
    document.addEventListener('scroll', hideClassTip, true);
    addEventListener('resize', hideClassTip);
    addEventListener('hashchange', hideClassTip);
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: LABEL,
    render(ctx) {
      api = ctx.api; wire();
      // 주소의 actor=<직원 id>가 가장 먼저 이긴다(업무 흐름 '처리 화면' 단추가 그 단계 담당을 싣는다 — 메인 10-28).
      // 이미 떠 있는 화면에서 고른 값보다 앞서고, 고를 수 있는 사람이 아니면 무시한다(저장값도 그대로).
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f-]{36}$/i.test(asked) && location.hash !== urlActor) {
        urlActor = location.hash; pendingActor = asked; // 같은 주소로 다시 와도(그 사이 사람을 바꿨어도) 다시 이긴다
        applyPendingActor(); // 명단이 아직 없으면 명단이 올 때 판정한다
      }
      if (!ctx.query.has('v2path')) {
        const params = { program: ctx.query.get('program'), teacher: ctx.query.get('teacher'), actor: asked || currentActor() };
        const entry = ctx.load(params);
        if (entry.data?.editors && !editors.length) editors = entry.data.editors.map(e => ({ id: e.id, name: e.name, role: e.role || '' }));
        const model = entry.data?.overview;
        lastOverview = model || null;
        const shown = model ? { ...model, rows: model.rows.map(row => {
          if (!row.action) return row;
          const linked = api?.cardRequestFor?.('consultations-homeroom', [model.period, row.program, row.teacherId]);
          return linked ? { ...row, action: { ...row.action, label: '업무 열기' } } : row;
        }) } : null;
        requestAnimationFrame(place);
        return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 상담 기록은 이 PC의 연습 자료입니다. 담임 상담 대상·완료 수는 통계 보기와 같습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span><a class="button" href="#v2-consultations?v2path=%2Fconsultations%2Fstats">통계 보기</a></div>`
          + (shown ? renderConsultOverview(shown) : `<p class="v2s-note">${entry.status === 'error' ? S.errorHtml(entry.error, '담임 현황을 불러오지 못했습니다. 다시 시도해 주세요.') : '담임 현황을 불러오는 중…'}</p>`);
      }
      lastOverview = null;
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '원생상담을 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '원생상담을 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 보는 사람을 바꾸면 그 사람이 볼 수 있는 상담으로 다시 열립니다(강사는 본인이 쓴 상담만). 상담 기록 추가·수정·삭제·후속 조치 완료를 할 수 있고, AI 분석과 녹음은 저장된 결과만 볼 수 있습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
