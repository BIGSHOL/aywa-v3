// 기록 → 처리 화면 한 번에(원장 10-30 "근거를 도대체 몇단계나 봐야하는거야. 너무 돌아가는것 같음").
// 입구는 모두 RecordOpen.href(영역, 기록) 한 주소. 서버(v2-screen-record-open.mjs)가 처리 화면 주소를 정하고, 목록 화면이면
// 그 기록 줄을 찾아 화면 가운데로 옮기고 테두리로 강조한다(접힌 줄은 펼친다). 처리 화면이 없는 영역은 작업 공간 기록 서랍.
(() => {
  'use strict';
  const S = window.V2Screens; if (!S) return;
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, FAMILY = /^[a-z][a-z-]{1,39}$/;
  // 서버 해석기(v2-screen-record-open.mjs resolve)가 처리 화면을 아는 영역 — 여기에 없으면 입구는 종전대로(작업 공간 서랍).
  const FAMILIES = new Set(['approvals', 'enrollment', 'consultations', 'students', 'withdrawals', 'meetings', 'staff', 'classes', 'withdrawal-reports',
    'attendance', 'makeups', 'lesson-reports', 'billing', 'textbook-requests', 'expense-requests', 'video-homework', 'class-review', 'tasks-notifications']);
  // actor = 그 화면을 열 사람(업무의 결재·승인 차례) — 처리 화면 주소에 그대로 싣는다(화면이 주소의 actor를 고른 사람보다 먼저 쓴다).
  const href = (family, id, actor = '') => `#v2-record-open?family=${encodeURIComponent(family)}&id=${encodeURIComponent(id)}${UUID.test(actor) ? `&actor=${actor}` : ''}`;
  const supports = (family, id) => FAMILIES.has(family) && UUID.test(String(id || ''));
  let api = null, focusRun = 0;

  // 처리 화면이 iframe(2.0 부품)이면 그 안에서, 아니면 본문에서 대상 줄을 찾는다 — 글자가 모두 들어 있는 가장 작은 줄.
  const ROW = 'tr,li,article,[role=row],details,section';
  function findRow(doc, texts) {
    const all = [...doc.querySelectorAll(ROW)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && texts.every(t => el.textContent.includes(t)); });
    return all.find(el => !all.some(o => o !== el && el.contains(o))) || null;
  }
  function focusRow(texts, expand, screen) {
    const run = ++focusRun, started = Date.now(), here = () => location.hash.split('?')[0] === screen; // 화면이 주소에 조건을 덧붙여도 같은 화면
    const tick = () => {
      if (run !== focusRun || !here() || Date.now() - started > 20000) return;
      const frame = document.querySelector('iframe[src*="/v2-host/"]');
      let doc = null; try { doc = frame ? frame.contentDocument : document; } catch { doc = null; }
      const row = doc && (!frame || doc.readyState === 'complete') ? findRow(doc, texts) : null;
      if (!row) { setTimeout(tick, 400); return; }
      if (expand) row.querySelector('button[aria-expanded="false"]')?.click();
      row.scrollIntoView({ block: 'center', behavior: 'auto' });
      Object.assign(row.style, { outline: '3px solid #e0a23b', outlineOffset: '-3px', background: '#fff8e6' });
      row.setAttribute('data-record-focus', '');
    };
    setTimeout(tick, 300);
  }

  window.RecordOpen = { supports, href, open: (family, id) => { location.hash = href(family, id); } };
  S.register({ id: 'record-open', label: '처리 화면 열기', nav: false, render(ctx) {
    api = ctx.api;
    const family = ctx.query.get('family') || '', id = ctx.query.get('id') || '';
    if (!FAMILY.test(family) || !UUID.test(id)) return '<p class="v2s-note">열 기록을 찾지 못했습니다.</p>';
    const r = ctx.load({ family, id });
    if (r.status === 'error' || r.data?.error) return `<p class="v2s-note">처리 화면을 찾지 못했습니다. <a href="#workspace-${ctx.esc(family)}">작업 공간에서 보기</a></p>`;
    if (r.status !== 'ready') return '<p class="v2s-note">처리 화면을 여는 중…</p>';
    const { focus = [], expand = false } = r.data, actor = ctx.query.get('actor') || '';
    const target = r.data.target && UUID.test(actor) && !/[?&]actor=/.test(r.data.target) ? `${r.data.target}${r.data.target.includes('?') ? '&' : '?'}actor=${actor}` : r.data.target;
    requestAnimationFrame(() => {
      if (target && /^#v2-[a-z-]+(?:\?|$)/.test(target)) { location.replace(target); if (focus.length) focusRow(focus, expand, target.split('?')[0]); return; }
      // 처리 화면이 없는 기록 = 작업 공간 기록 서랍(뒤로 가기에 이 중간 주소가 남지 않게 replace).
      location.replace(`#workspace-${family}`);
      requestAnimationFrame(() => api?.showWorkspaceRecord?.(family, id));
    });
    return '<p class="v2s-note">처리 화면을 여는 중…</p>';
  } });
})();
