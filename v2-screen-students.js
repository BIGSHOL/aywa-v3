/* 2.0 화면 — 원생목록 · 원생 상세 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 — 2.0 화면을 손으로 다시 그리지 않는다).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/students.html?…`(v2-host/src/students.tsx · students-list.tsx · students-detail.tsx,
   데이터 = /api/v2/students, Docker 복사본). 3.0 쪽은 '연습 화면' 안내 한 줄과 자리(slot)만 둔다 — 겹쳐 두기·주소 맞추기는 수업목록 껍데기와 같다
   (live.js가 #main을 통째로 바꾸므로 iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다 · 모양은 v2-screen-timetable.css의 `.v2h-*`).
   iframe 안 이동(필터·정렬·쪽 · 학생 상세·탭 같은 하위 주소는 v2path)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-students?…)를 맞춘다.
   반 같은 다른 2.0 주소는 3.0에 그 화면이 있으면 그 화면으로(하위 경로는 v2path), 없으면 안내만 한다. 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'students', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 목록·상세 page.tsx가 읽는 주소 열쇠 그대로(이름이 같은 열쇠는 한 칸) + v2path(2.0 하위 경로 /students/<학생> …).
  const KEEP = ['v2path', 'status', 'subject', 'q', 'page', 'grade', 'teacher', 'field', 'sort', 'noenr', 'program', 'first', 'level', 'mix', 'from',
    'contribution', 'month', 'view', 'entity', 'tab', 'video', 'back', 'jjFrom', 'jjTo', 'to', 'kind', 'dir', 'fScore', 'fDelta',
    'fc', 'fcMonth', 'fcFrom', 'fcTo', 'fcSpan', 'tr', 'trMonth', 'trFrom', 'trTo', 'trSpan', 'classId'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const ACTOR_KEY = `v2-host-actor:${ID}`, SEL = `[data-v2-screen="${ID}"]`;
  const esc = s => S.esc(s);
  /** 저장하는 사람 — 고른 값이 목록에 없으면 첫 사람(원장 먼저). 호스트(shims/server-action.ts)와 같은 규칙(수업목록과 같다). */
  function currentActor() {
    let stored = null;
    try { stored = localStorage.getItem(ACTOR_KEY); } catch { /* 저장소를 못 쓰면 이 창에서만 */ }
    for (const id of [actor, stored]) if (id && editors.some(e => e.id === id)) return id;
    return editors[0]?.id ?? null;
  }
  const actorPicker = () => (editors.length ? `<label class="v2h-actor"><span>저장하는 사람</span><select data-v2h-actor aria-label="저장하는 사람">${editors.map(e => `<option value="${esc(e.id)}"${e.id === currentActor() ? ' selected' : ''}>${esc(e.role ? `${e.name} · ${e.role}` : e.name)}</option>`).join('')}</select></label>` : '');
  const tellHost = () => { const id = currentActor(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function renderStudentOverview(model) {
    const template = document.createElement('template');
    template.innerHTML = S.renderOverview(model);
    const section = template.content.querySelector('.v2o');
    if (!section) return template.innerHTML;
    section.classList.add('v2o-students');
    const cols = document.createElement('colgroup');
    for (const column of model.columns) { const col = document.createElement('col'); col.dataset.col = column.key; cols.append(col); }
    section.querySelector('table')?.prepend(cols);
    section.querySelectorAll('tbody tr:not(.v2o-group)').forEach((tr, i) => {
      if (model.rows[i]?.href) tr.dataset.v2OverviewHref = model.rows[i].href;
    });
    return template.innerHTML;
  }

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'v2h-frame'; frame.title = '원생목록'; frame.dataset.v2Host = ID; frame.hidden = true;
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
  // 이 화면이 그리는 2.0 하위 주소(새 학생 · 원생 상세 · 학생 수정) — 창 열기 알림이 와도 같은 화면에서 연다(조건 그대로).
  const OWN = /^\/students(?:\/(?:new|stats)|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/edit)?)?$/i;
  /** 2.0 주소 → 이 화면(하위 주소) · 3.0에 있는 같은 2.0 화면(하위 경로는 v2path, 조건 그대로). 없으면 안내만(주소를 보이지 않는다). */
  function openFromHost(href) {
    const u = new URL(href || '/', location.origin), path = u.pathname;
    const q = new URLSearchParams(u.search);
    if (OWN.test(path)) {
      if (path !== '/students') q.set('v2path', path);
      location.hash = `#v2-${ID}${q.toString() ? `?${queryOf(q)}` : ''}`;
      return;
    }
    const segs = path.split('/').filter(Boolean), to = segs[0] ? S.target(segs[0]) : null;
    if (!to) { api?.toast?.('이 화면은 연습 화면에서 아직 열 수 없습니다.'); return; }
    if (segs.length > 1) q.set('v2path', path);
    location.hash = `${to}${q.toString() ? `?${q}` : ''}`;
  }
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-ready' && d.screen !== ID) {
        const to = S.target(d.screen);
        if (to) {
          const q = new URLSearchParams(frame.contentWindow.location.search);
          location.hash = `${to}${q.toString() ? `?${q}` : ''}`;
        }
      } else if (d.type === 'v2-host-nav' && d.screen === ID) {
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
      try { localStorage.setItem(ACTOR_KEY, t.value); } catch { /* 이 창에서만 기억 */ }
      tellHost();
    });
    document.addEventListener('click', e => {
      const row = e.target.closest?.(`${SEL} .v2o-students tr[data-v2-overview-href]`);
      if (row && !e.target.closest('a, button, input, select, textarea')) location.hash = row.dataset.v2OverviewHref;
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }

  S.register({
    id: ID, label: '원생목록',
    render(ctx) {
      api = ctx.api; wire();
      // 업무 흐름이 '이 직원으로' 열 때(&actor=<직원 id>) — 저장하는 사람으로 미리 고른다(목록에 없는 사람이면 저장 때 첫 사람). 주소에는 남기지 않는다.
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(asked) && asked !== actor) {
        actor = asked;
        try { localStorage.setItem(ACTOR_KEY, asked); } catch { /* 이 창에서만 기억 */ }
        tellHost();
      }
      if (!ctx.query.has('v2path')) {
        const entry = ctx.load({ program: ctx.query.get('program'), course: ctx.query.get('course') });
        if (entry.data?.editors && !editors.length) editors = entry.data.editors;
        const model = entry.data?.overview;
        requestAnimationFrame(place);
        return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 오늘의 재원생을 프로그램·과정·반 순서로 볼 수 있습니다. 원생 목록은 마지막 층에서 열립니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>`
          + (model ? renderStudentOverview(model) : `<p class="v2s-note">${entry.status === 'error' ? esc(entry.error || '원생 현황을 불러오지 못했습니다.') : '원생 현황을 불러오는 중…'}</p>`);
      }
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '원생목록을 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '원생목록을 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 엑셀 내보내기·가져오기는 아직 지원하지 않습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
