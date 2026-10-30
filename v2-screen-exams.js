// 2.0 성적관리 호스트를 3.0 화면의 자리로 연다. 필터 주소는 iframe과 해시에 같이 남긴다.
(() => {
  'use strict';
  const ID = 'exams', HOST = '/v2-host/exams.html', S = window.V2Screens; if (!S) return;
  const KEEP = ['v2path', 'from', 'to', 'subject', 'kind', 'missing', 'student', 'cohortClass', 'schoolGroup', 'gradeGroup',
    'page', 'tab', 'q', 'month', 'level', 'tlevel', 'sort', 'dir', 'fSchool', 'fClass', 'fTeacher', 'fKind', 'fInfo', 'fScore', 'fDelta', 'fConsult',
    'entry', 'entryYear', 'entryTerm', 'entrySubject', 'entrySlot', 'entryClass', 'entryDate', 'entryMax',
    'year', 'term', 'class', 'slot', 'date', 'max', 'view', 'type', 'jjClass'];
  const SEL = `[data-v2-screen="${ID}"]`;
  let api = null, frame = null, requested = null, hostOk = null, wired = false, editors = [], actor = null;
  const esc = s => S.esc(s);
  const currentActor = () => S.accountId();
  const actorPicker = () => ''; // 화면별 선택기는 셸 계정으로 대체했다.
  const tellHost = () => { const id = currentActor(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };
  const place = () => {
    if (!frame) return;
    const slot = document.querySelector(`${SEL} [data-v2-host-slot]`);
    if (!slot) { frame.hidden = true; return; }
    slot.style.height = `${Math.max(420, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  };
  const ensureFrame = query => {
    if (!frame) {
      frame = document.createElement('iframe'); frame.className = 'v2h-frame'; frame.title = '성적관리'; frame.dataset.v2Host = ID;
      frame.hidden = true; document.body.append(frame);
    }
    if (query !== requested) { requested = query; frame.src = `${HOST}${query ? `?${query}` : ''}`; }
  };
  const openFromHost = href => {
    const u = new URL(href || '/', location.origin), segs = u.pathname.split('/').filter(Boolean);
    const to = segs[0] ? S.target(segs[0]) : null;
    if (!to) { api?.toast?.('아직 3.0에 없는 화면입니다.'); return; }
    const q = new URLSearchParams(u.search);
    if (segs.length > 1) q.set('v2path', u.pathname);
    location.hash = `${to}${q.toString() ? `?${q}` : ''}`;
  };
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
        requested = query;
        const next = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== next) location.replace(next);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
      else if (d.type === 'v2-host-editors' && d.screen === ID && Array.isArray(d.editors)) {
        editors = d.editors.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string');
        const at = document.querySelector(`${SEL} [data-v2h-actor-slot]`); if (at) at.innerHTML = actorPicker();
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
  S.register({ id: ID, label: '성적관리', render(ctx) {
    api = ctx.api; wire();
    const query = queryOf(ctx.query);
    if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
    else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); });
    const wait = hostOk === false ? '성적관리를 열지 못했습니다. 잠시 후 새로고침해 주세요.' : hostOk === null ? '성적관리를 여는 중…' : '';
    return `<div class="v2h-note" role="note"><p><b>연습 화면</b> 여기서 저장한 내용은 이 PC의 연습 자료에만 남고, 실제 발송은 없습니다. 엑셀 내보내기·가져오기는 아직 지원하지 않습니다.</p><span data-v2h-actor-slot>${actorPicker()}</span></div>
      <div class="v2h-slot" data-v2-host-slot>${wait ? `<p class="v2h-wait">${wait}</p>` : ''}</div>`;
  } });
})();
