// 2.0 체크리스트 부품을 같은 출처 호스트에 띄우고 반·달·날짜 주소를 3.0 해시에 맞춘다.
(() => {
  'use strict';
  const ID = 'before-class', HOST = '/v2-host/before-class.html', S = window.V2Screens;
  if (!S) return;
  const SEL = `[data-v2-screen="${ID}"]`, KEEP = ['class', 'month', 'date'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false;
  const queryOf = q => { const out = new URLSearchParams(); for (const k of KEEP) if (q.get(k)) out.set(k, q.get(k)); return out.toString(); };
  const tellActor = () => { const id = S.accountId(); if (id && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'v2-host-actor', id }, location.origin); };
  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe'); frame.className = 'v2h-frame'; frame.title = '비포클래스체크리스트'; frame.dataset.v2Host = ID;
      Object.assign(frame.style, { position: 'absolute', zIndex: '5', border: '0', borderRadius: '12px', background: '#fff' });
      frame.addEventListener('load', tellActor);
      frame.hidden = true; document.body.append(frame);
    }
    if (requested !== query) { requested = query; frame.src = `${HOST}${query ? `?${query}` : ''}`; }
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
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-ready' && d.screen === ID) tellActor();
      else if (d.type === 'v2-host-nav' && d.screen === ID) {
        const query = queryOf(new URLSearchParams(String(d.query || '')));
        requested = query;
        const next = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== next) location.replace(next);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') api?.toast?.('아직 3.0에 없는 화면입니다.');
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }
  S.register({ id: ID, label: '비포클래스체크리스트', render(ctx) {
    api = ctx.api; wire();
    const query = queryOf(ctx.query);
    if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { hostOk = ok; api?.render?.(); });
    else if (hostOk) requestAnimationFrame(() => { ensureFrame(query); place(); tellActor(); });
    const wait = hostOk === false ? '비포클래스체크리스트를 열지 못했습니다.' : hostOk === null ? '비포클래스체크리스트를 여는 중…' : '';
    return `<div class="v2h-slot" data-v2-host-slot style="position:relative;min-height:420px">${wait ? `<p class="v2h-wait">${S.esc(wait)}</p>` : ''}</div>`;
  } });
})();
