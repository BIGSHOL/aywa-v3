/* 2.0 화면 — 선생님 원스크린 (V2-SCREENS.md '그리는 방식 전환', 원장 10-28 *"2.0으로 표현해야함 … 수업보고서 발송이나"*).
   그리기는 2.0의 실제 React 부품(OneScreenClient · VideoHomeworkProvider)이 한다 — 같은 출처 iframe `/v2-host/onescreen.html?…`
   (v2-host/src/onescreen.tsx, 데이터 = /api/v2/onescreen?props=1, Docker 복사본). 3.0 쪽은 '연습 복사본' 안내 한 줄, '보는 선생님'
   고르기(2.0 화면은 로그인한 선생님의 것이라 고르는 칸이 없다), 자리(slot)만 둔다. live.js는 그릴 때마다 #main을 통째로 바꾸므로
   iframe은 문서에 한 번만 만들어 자리 위에 겹쳐 둔다(다른 화면으로 가면 숨기고, 사이드바로 돌아와도 보던 선생님·날짜 그대로 — 입력 중인 글이 남는다).
   iframe 안 이동(날짜·보기·반·학생)은 iframe이 알려 주고(v2-host-nav) 3.0 주소(#v2-onescreen?…)를 맞춘다. 학생·반 같은 2.0 주소는
   3.0 기록 창으로 연다(v2-host-open). 운영 2.0 사이트 주소는 어디에도 없다. */
(() => {
  'use strict';
  const ID = 'onescreen', HOST = `/v2-host/${ID}.html`, S = window.V2Screens; if (!S) return;
  const h = S.esc, KEEP = ['teacher', 'date', 'all', 'view', 'class', 'student'];
  let api = null, frame = null, requested = null, hostOk = null, wired = false, last = null;
  const queryOf = q => { const o = new URLSearchParams(); for (const k of KEEP) { const v = q.get(k); if (v) o.set(k, v); } return o.toString(); };

  function ensureFrame(query) {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'osh-frame'; frame.title = '선생님 원스크린(2.0 화면)'; frame.dataset.v2Host = ID; frame.hidden = true;
      document.body.append(frame);
    }
    if (query === requested) return;
    const url = `${HOST}${query ? `?${query}` : ''}`;
    // A loaded iframe given a new src adds a history entry (Back would turn only the frame back) — replace its address instead.
    if (requested === null) frame.src = url; else frame.contentWindow?.location.replace(url);
    requested = query;
  }
  /** 자리(slot) 위에 겹친다 — 문서 좌표라 스크롤을 따라간다. 자리가 없으면(다른 화면) 숨긴다. */
  function place() {
    if (!frame) return;
    const slot = document.querySelector(`[data-v2-screen="${ID}"] [data-v2-host-slot]`);
    if (!slot) { frame.hidden = true; return; }
    slot.style.height = `${Math.max(480, Math.round(innerHeight - (slot.getBoundingClientRect().top + scrollY) - 12))}px`;
    const r = slot.getBoundingClientRect();
    Object.assign(frame.style, { top: `${r.top + scrollY}px`, left: `${r.left + scrollX}px`, width: `${r.width}px`, height: `${r.height}px` });
    frame.hidden = false;
  }
  /** 2.0 주소 → 3.0 기록 창(있으면). 없으면 3.0에 아직 없는 화면이라고만 알린다(주소를 보이지 않는다). */
  function openFromHost(href) {
    const m = /^\/(students|classes)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(href || '');
    if (m && api?.canOpenRecord?.(m[2])) return m[1] === 'students' ? api.showStudent(m[2]) : api.openRecord(m[2]);
    api?.toast?.('이 화면은 3.0 연습본에 아직 없습니다.');
  }
  function wire() {
    if (wired) return; wired = true;
    addEventListener('message', e => {
      if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'v2-host-nav' && d.screen === ID) {
        const nq = new URLSearchParams(String(d.query || '')), cur = new URLSearchParams(requested || '').get('teacher');
        if (!nq.get('teacher') && cur) nq.set('teacher', cur); // 2.0의 날짜 이동은 teacher를 빼고 주소를 다시 쓴다 — 고른 선생님은 그대로
        const query = queryOf(nq);
        requested = query; // iframe은 이미 그 주소다 — 3.0이 다시 그려도 다시 읽지 않게 먼저 맞춘다
        const page = `#v2-${ID}${query ? `?${query}` : ''}`;
        if (location.hash !== page) location.replace(page);
      } else if (d.type === 'v2-host-open' || d.type === 'eywa-open-window') openFromHost(String(d.href || ''));
    });
    const later = () => requestAnimationFrame(place);
    addEventListener('resize', later); addEventListener('scroll', place, { passive: true }); addEventListener('hashchange', later);
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', ev => {
      const t = ev.target.closest?.(`[data-v2-screen="${ID}"] [data-osh="teacher"]`); if (!t || !last) return;
      last.go({ teacher: t.value }); // 다른 선생님 = 다른 화면 — 날짜·보기·반·학생은 그 선생님의 기본으로
    });
  }

  S.register({
    id: ID, label: '선생님 원스크린',
    render(ctx) {
      api = ctx.api; last = ctx; wire();
      // Coming back by the sidebar link (#v2-onescreen, no query) keeps the teacher and day that were showing.
      if (!ctx.query.toString() && requested) { location.replace(`#v2-${ID}?${requested}`); return ''; }
      const q = ctx.query, list = ctx.load({ list: 'teachers' }), teachers = list.status === 'ready' ? list.data.teachers : [];
      const pick = q.get('teacher') || '';
      if (hostOk === null) fetch(HOST, { method: 'HEAD' }).then(r => r.ok, () => false).then(ok => { if (hostOk === null) { hostOk = ok; api?.render?.(); } });
      else if (hostOk) { const query = queryOf(q); requestAnimationFrame(() => { ensureFrame(query); place(); }); }
      const wait = hostOk === false ? '2.0 부품 화면이 이 서버에 아직 연결되지 않았습니다.' : hostOk === null ? '선생님 원스크린을 여는 중…' : '';
      const picker = `<label class="osh-pick"><span>보는 선생님</span><select data-osh="teacher" aria-label="보는 선생님">${pick ? '' : '<option value="" selected>최근 보고서가 가장 많은 선생님</option>'}${teachers.map(t => `<option value="${h(t.id)}" ${t.id === pick ? 'selected' : ''}>${h(t.name)} · 반 ${h(t.classes)}</option>`).join('')}</select></label>`;
      return `<div class="osh-bar"><p class="osh-note" role="note"><b>연습 복사본(Docker)</b> 2.0 선생님 원스크린 부품 그대로, 고른 선생님의 화면입니다. 보고서 저장·ClassNote 발송·출결은 그 선생님 이름으로 연습 복사본에만 저장되고 실제 발송은 없습니다. 아직 잇지 않은 기능은 같은 자리에서 '복사본 보기 전용'으로 거절됩니다.</p>${picker}</div>
        <div class="osh-slot" data-v2-host-slot>${wait ? `<p class="osh-wait">${wait}</p>` : ''}</div>`;
    },
  });
})();
