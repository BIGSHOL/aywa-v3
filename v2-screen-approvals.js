/* 2.0 화면 — 전자결재 (V2-SCREENS.md, 처리 화면 세션 R · 원장 10-28 *"근거보기 들어가도 뭘 처리할 수가 없음"*).
   그리기는 2.0의 실제 React 부품이 한다 — 같은 출처 iframe `/v2-host/approvals.html?…`(v2-host/src/approvals.tsx, 데이터 = /api/v2/approvals,
   Docker 복사본). 3.0 쪽은 안내 한 줄 · '보는 사람' 고르기 · 자리(slot)만 — 퇴원보고서 껍데기와 같은 틀이다.
   보는 사람 = 저장하는 사람: 결재함과 결재 단추는 그 사람의 것이다(결재 차례 · 원장 대결 · 기안자 회수).
   기록 바로 열기: `#v2-approvals?v2path=/approvals/<문서 id>[&actor=<직원 id>]` · 결재함 = `tab=waiting|upcoming|progress|done|rejected|refs|all|academy`. */
(() => {
  'use strict';
  const ID = 'approvals', LABEL = '전자결재', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  // 2.0 page.tsx가 읽는 주소 열쇠 그대로(tab) + v2path(2.0 하위 경로 — 결재 문서 · 기안하기).
  const KEEP = ['v2path', 'tab'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null, urlActor = null;
  const ACTOR_KEY = `v2-host-actor:${ID}`, SEL = `[data-v2-screen="${ID}"]`;
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
  // 이 화면이 그리는 2.0 주소(결재함 · 결재 문서 · 기안하기) — 창 열기 알림이 와도 같은 화면에서 연다.
  const OWN = /^\/approvals(?:\/new|\/[0-9a-f-]{36})?$/i;
  function openFromHost(href) {
    const raw = String(href || ''), path = raw.split(/[?#]/)[0];
    if (OWN.test(path)) {
      const q = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#')[0] : '');
      if (path !== '/approvals') q.set('v2path', path);
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
  const actorPicker = () => (editors.length ? `<label class="v2h-actor"><span>보는 사람</span><select data-v2h-actor aria-label="보는 사람">${editors.map(e => `<option value="${esc(e.id)}"${e.id === currentActor() ? ' selected' : ''}>${esc(e.role ? `${e.name} · ${e.role}` : e.name)}</option>`).join('')}</select></label>` : '');
  const tellHost = () => { const id = currentActor(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  /** 주소의 actor — 고를 수 있는 사람(명단 안)일 때만 이기고 저장한다. 명단 밖이면 앞서 고른 값(저장소)을 건드리지 않는다(팀장 10-28). */
  let pendingActor = null;
  function applyPendingActor() {
    if (!pendingActor || !editors.length) return;
    const id = pendingActor; pendingActor = null;
    if (!editors.some(e => e.id === id)) return;
    actor = id;
    try { localStorage.setItem(ACTOR_KEY, id); } catch { /* 이 창에서만 */ }
    const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`); if (at) at.innerHTML = actorPicker();
    tellHost();
  }
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
      try { localStorage.setItem(ACTOR_KEY, t.value); } catch { /* 이 창에서만 기억 */ }
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
      // 주소의 actor=<직원 id>가 가장 먼저 이긴다(업무 흐름 '처리 화면' 단추가 그 단계 담당을 싣는다 — 메인 10-28).
      // 이미 떠 있는 화면에서 고른 값보다 앞서고, 고를 수 있는 사람이 아니면 무시한다(저장값도 그대로).
      const asked = ctx.query.get('actor');
      if (asked && /^[0-9a-f-]{36}$/i.test(asked) && location.hash !== urlActor) {
        urlActor = location.hash; pendingActor = asked; // 같은 주소로 다시 와도(그 사이 사람을 바꿨어도) 다시 이긴다
        applyPendingActor(); // 명단이 아직 없으면 명단이 올 때 판정한다
      }
      const query = queryOf(ctx.query);
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
      const wait = hostOk === false ? '전자결재를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '전자결재를 여는 중…' : '';
      return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 보는 사람을 바꾸면 그 사람의 결재함과 결재 차례로 다시 열립니다. 기안·결재(승인·반려·전결·후결·대결)·회수·댓글·결재선 저장을 모두 할 수 있습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
        <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
