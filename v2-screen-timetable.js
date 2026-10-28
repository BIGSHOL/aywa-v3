/* 2.0 화면 — 시간표 (V2-SCREENS.md). 서버(v2-screen-timetable.mjs)가 2.0 함수로 만든 모델을 2.0 배치·라벨·서식 그대로 그린다.
   기본뷰 = 요일 묶음 × 강사 열 × 교시 행 격자(반 칸 병합·합반·재원/대기/퇴원 명단), 통합뷰 = 시작 교시 줄마다 반=열 카드.
   저장 자리(반 배치·명단 이동·가져오기·시트로 보내기·그룹 설정)는 같은 자리에 두고 '복사본 보기 전용'으로 막는다.
   운영 2.0 사이트로 가는 링크는 없다 — 학생·반을 누르면 3.0 기록 창이 열린다(live.js data-student·data-class). */
(() => {
  'use strict';
  const ID = 'timetable', KEEP = ['subject', 'view', 'kind', 'week', 'etrack', 'students', 'emptyperiods'];
  const BLOCKED = '복사본 보기 전용 — 저장 기능은 다음 단계에서 엽니다';
  let cards = [], api = null, lastCtx = null, wired = false;
  const esc = s => V2Screens.esc(s);
  const queryOf = q => { const o = {}; for (const k of KEEP) { const v = q.get(k); if (v) o[k] = v; } return o; };

  /** 같은 화면 안 이동 주소 — 2.0 buildHref처럼 그 과목의 기본 뷰와 같으면 뷰를 싣지 않는다. */
  function pageOf(d, change) {
    const p = { subject: d.subject, view: d.view, kind: d.kind, week: d.week, etrack: d.trackApplies ? d.etrack : undefined,
      students: d.hideStudents ? 'hide' : undefined, emptyperiods: d.collapseEmpty ? 'collapse' : undefined, ...change };
    const target = d.subjects.find(s => s.value === p.subject);
    if (p.view === (target?.defaultView ?? d.defaultView)) delete p.view;
    if (p.week === d.thisWeek) delete p.week;
    if (p.kind === 'regular') delete p.kind;
    if (p.etrack === 'all' || p.subject !== 'english') delete p.etrack;
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return `v2-${ID}${qs ? `?${qs}` : ''}`;
  }

  // ── 툴바 ──
  const select = (axis, aria, value, options) => `<label class="tt-select"><span>${esc(axis)}</span><select data-tt-nav aria-label="${esc(aria)}">${options.map(o => `<option value="${esc(o.page)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  const blocked = (label, extra = '') => `<button type="button" class="tt-chip" disabled title="${esc(BLOCKED)}"${extra}>${esc(label)}</button>`;
  function toolbar(d) {
    const rel = d.relation === 'past' ? '<span class="tt-rel past">과거 조회</span>' : d.relation === 'future' ? '<span class="tt-rel future">미래 조회</span>' : '';
    const subjectSwitch = s => { const carried = d.view === d.defaultView ? s.defaultView : d.view; return carried === 'teacher' && !s.teacherView ? 'basic' : carried; };
    const views = d.views.map(v => ({ value: v.value, label: v.ready ? v.label : `${v.label} (준비 중)`, page: pageOf(d, { view: v.value }) }));
    const menu = `<details class="tt-menu"><summary class="tt-chip">뷰 설정</summary><div class="tt-menu-pop" role="group" aria-label="뷰 설정">
      <p class="tt-menu-h">표시 <small>이 화면에서만 바뀝니다 · 계정 저장 없음</small></p>
      ${d.view === 'basic' || d.view === 'integrated' ? `<button type="button" class="tt-toggle${d.hideStudents ? '' : ' on'}" data-go="${esc(pageOf(d, { students: d.hideStudents ? undefined : 'hide' }))}">학생 명단 <b>${d.hideStudents ? '숨김' : '표시'}</b></button>` : ''}
      ${d.view === 'basic' ? `<button type="button" class="tt-toggle${d.collapseEmpty ? ' on' : ''}" data-go="${esc(pageOf(d, { emptyperiods: d.collapseEmpty ? undefined : 'collapse' }))}">빈 교시 접기 <b>${d.collapseEmpty ? '켜짐' : '꺼짐'}</b></button>` : ''}
      <p class="tt-menu-note">보이는 학년 고르기·색 강도는 다음 단계에서 엽니다.</p></div></details>`;
    return `<div class="tt-toolbar">
      <div class="tt-row"><div class="tt-weeknav" role="group" aria-label="주 이동">
        <button type="button" class="tt-arrow${d.relation === 'past' ? ' lit' : ''}" data-go="${esc(pageOf(d, { week: d.prevWeek }))}" aria-label="이전 주">‹</button>
        <button type="button" class="tt-weeklabel" data-go="${esc(pageOf(d, { week: d.thisWeek }))}" title="눌러서 이번 주로">${esc(d.weekLabel)}</button>
        <button type="button" class="tt-arrow${d.relation === 'future' ? ' lit' : ''}" data-go="${esc(pageOf(d, { week: d.nextWeek }))}" aria-label="다음 주">›</button></div>${rel}</div>
      <div class="tt-row"><div class="tt-group">
        ${d.subjects.length ? select('과목', '과목 선택', d.subject, d.subjects.map(s => ({ value: s.value, label: s.label, page: pageOf(d, { subject: s.value, view: subjectSwitch(s), etrack: s.value === 'english' ? d.etrack : undefined }) }))) : ''}
        ${select('구분', '정규·특강 구분', d.kind, d.kinds.map(k => ({ ...k, page: pageOf(d, { kind: k.value }) })))}
        ${d.trackApplies ? select('프로그램', '영어 프로그램 필터', d.etrack, d.tracks.map(t => ({ ...t, page: pageOf(d, { etrack: t.value }) }))) : ''}
        ${d.kind === 'makeup' ? '' : select('뷰', '시간표 보기 방식', d.view, views)}
        ${d.classCount ? `<span class="tt-count">${d.classCount}개 수업</span>` : ''}
        ${d.view === 'integrated' ? `<span class="tt-sep" aria-hidden="true"></span>${blocked('그룹 설정')}` : ''}
        <span class="tt-sep" aria-hidden="true"></span>${menu}
        <span class="tt-sep" aria-hidden="true"></span>${blocked('엑셀 내보내기/가져오기')}
      </div><div class="tt-group tt-end">
        ${blocked('시간표 편집기')}${d.memoSheet ? blocked('메모 시트') : ''}
      </div></div></div>`;
  }

  // ── 학생 줄 · 정보 카드 ──
  const card = data => { cards.push(data); return cards.length - 1; };
  function stuRow(s) {
    const tone = s.move ? 'moving' : s.tone, mark = s.lab ? ' lab' : '';
    // 2.0 NameInner: [합반 번호] 이름 + `/학교학년`(예약 이동 줄은 꼬리 대신 오른쪽 `→11/3`).
    const meta = !s.move && s.sg ? `<span class="tt-meta${mark}">/${esc(s.sg)}</span>` : '';
    const badge = s.badge ? `<span class="tt-idx num">${esc(s.badge)}</span>` : '';
    const attr = s.id && api?.canOpenRecord?.(s.id) ? `data-student="${esc(s.id)}"` : '';
    return `<button type="button" class="tt-stu${tone ? ` t-${tone}` : ''}" ${attr} data-tt-card="${card({ type: 'student', s })}" aria-label="${esc(s.n)} 학생 정보"${s.move ? ` title="${esc(s.move.title)}"` : ''}><span class="tt-nm">${badge}<span class="tt-name${mark}">${esc(s.n)}</span>${meta}</span>${s.move ? `<span class="tt-move">${esc(s.move.arrow)}${esc(s.move.on)}</span>` : ''}</button>`;
  }
  const section = (label, list, tone, max) => (list.length ? `<div class="tt-sec t-${tone}" style="max-height:${max}px"><div class="tt-seclabel"><span>${label}</span><span class="num">${list.length}</span></div>${list.map(stuRow).join('')}</div>` : '');
  function roster(c, hideStudents) {
    const total = c.common.length + c.partial.reduce((n, p) => n + p.students.length, 0) + c.hold.length + c.withdrawn.length;
    if (hideStudents || !total) return '';
    return `<div class="tt-roster${c.handover ? ' is-handover' : ''}"><div class="tt-rscroll" data-tt-fade="y">
      <div class="tt-rows">${c.common.map(stuRow).join('')}</div>
      ${c.partial.length ? `<div class="tt-days">${c.partial.map(p => `<div class="tt-daycol"><div class="tt-dayhd">${esc(p.day)}</div>${p.students.map(stuRow).join('')}</div>`).join('')}</div>` : ''}
    </div>${section('대기', c.hold, 'hold', 63)}${section('퇴원', c.withdrawn, 'withdrawn', 86)}</div>`;
  }
  const headStyle = h => (h.bg ? ` style="background:${esc(h.bg)};color:${esc(h.fg)}"` : '');
  /** 3.0 기록에 있는 반만 눌러서 연다(없으면 정보 카드만). */
  const classAttr = id => (api?.canOpenRecord?.(id) ? ` data-class="${esc(id)}"` : '');
  const headClass = h => (h.bg ? '' : h.color ? ` sub-${h.color}` : h.soft ? ` soft-${h.soft}` : '');

  // ── 기본뷰 ──
  function classCell(c, hideStudents) {
    const k = c.cls, full = c.subSlot === 'full', band = '<div class="tt-band" aria-hidden="true"></div>';
    const head = `<button type="button" class="tt-chead${headClass(k.head)}"${classAttr(k.classId)} data-tt-card="${card({ type: 'class', k })}" aria-label="${esc(k.className)} 반 정보" style="height:${full ? 60 : 30}px;${k.head.bg ? `background:${esc(k.head.bg)};color:${esc(k.head.fg)}` : ''}">
      <span class="tt-cline"><span class="tt-cname">${esc(k.className)}</span>${!full && k.room ? `<span class="tt-croomi">${esc(k.room)}</span>` : ''}<span class="tt-ccount num">${k.count}</span></span>
      ${full ? `<span class="tt-croom">${esc(k.room || ' ')}</span>` : ''}</button>`;
    return `<div class="tt-hzone">${c.subSlot === 'bottom' ? band : ''}${head}${c.subSlot === 'top' ? band : ''}</div>${roster(c, hideStudents)}`;
  }
  function hapbanCell(c, hideStudents) {
    const full = c.subSlot === 'full', band = '<div class="tt-band" aria-hidden="true"></div>';
    const segs = c.segments.map(k => `<button type="button" class="tt-seg${headClass(k.head)}"${headStyle(k.head)}${classAttr(k.classId)} data-tt-card="${card({ type: 'class', k })}" aria-label="${esc(k.className)} 반 정보">
      <span class="tt-idx">${k.index}</span><span class="tt-cname">${esc(k.className)}</span><span class="tt-ccount num">${k.count}</span></button>`).join('');
    return `<div class="tt-hapban"><span class="tt-hapbadge num">합반 ${c.segments.length}반</span><div class="tt-hzone">${c.subSlot === 'bottom' ? band : ''}<div class="tt-segs" style="height:${full ? 60 : 30}px">${segs}</div>${c.subSlot === 'top' ? band : ''}</div>${roster(c, hideStudents)}</div>`;
  }
  function basicTable(tb, d) {
    const width = tb.cols.reduce((a, b) => a + b, 0), stickyL = tb.sticky ? ' sticky-l' : '';
    const head = `<tr><th rowspan="2" class="tt-corner${stickyL}" aria-hidden="true"></th>${tb.head.map(h => `<th colspan="${h.span}" class="tt-thead${h.edge ? ' edge' : ''}"><span>${esc(h.name)}</span></th>`).join('')}</tr>
      <tr>${tb.dayHead.map(x => `<th class="tt-dhead${x.edge ? ' edge' : ''}"><div class="tint-${x.tint}">${esc(x.day)}${x.date ? `<span>${esc(x.date)}</span>` : ''}</div></th>`).join('')}</tr>`;
    const body = tb.rows.map(r => {
      const label = r.label ? `<td rowspan="${r.label.span}" class="tt-plabel${stickyL}${r.label.collapsed ? ' collapsed' : ''}" style="height:${r.label.height}px">${r.label.collapsed
        ? `${esc(r.label.text)}<span class="tt-pstart num">${esc(r.label.start)}</span>`
        : r.label.text ? `${esc(r.label.text)}<div class="tt-ptime num"><div>${esc(r.label.start)}</div>${r.label.end ? `<div>~ ${esc(r.label.end)}</div>` : ''}</div>`
          : `<span class="num"><span class="tt-block">${esc(r.label.start)}</span>${r.label.end ? `<span class="tt-block">~ ${esc(r.label.end)}</span>` : ''}</span>`}</td>` : '';
      const cells = r.cells.map(c => {
        const span = `${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''}${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ''}`;
        if (c.empty) return `<td${span} class="tt-td empty${c.edge ? ' edge' : ''}"><div style="height:${c.height}px" aria-hidden="true"></div></td>`;
        const inner = c.content.kind === 'hapban' ? hapbanCell(c.content, d.hideStudents) : classCell(c.content, d.hideStudents);
        return `<td${span} class="tt-td${c.edge ? ' edge' : ''}"><div class="tt-cell" style="height:${c.height}px">${inner}</div></td>`;
      }).join('');
      return `<tr style="height:${r.height}px">${label}${cells}</tr>`;
    }).join('');
    return `<table class="tt-grid" style="width:${width}px"><colgroup>${tb.cols.map(w => `<col style="width:${w}px">`).join('')}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // ── 통합뷰 ──
  function richCell(c) {
    if (!c) return '<div class="tt-rc"></div>';
    if (c.blank) return `<div class="tt-rc"${c.tip ? ` title="${esc(c.tip)}"` : ''}></div>`;
    const off = c.offAxis ? `<span class="tt-off" aria-hidden="true"></span>` : '';
    if (c.lab) return `<div class="tt-rc paint ${c.lab}${c.separate ? ' separate' : ''}" title="${esc(c.tip)}">${esc(c.text)}${off}</div>`;
    const style = c.bg ? ` style="background:${esc(c.bg)};color:${esc(c.fg)}"` : '';
    return `<div class="tt-rc paint${c.bg ? '' : ` solid-${c.color}`}"${style} title="${esc(c.tip)}">${esc(c.text)}${off}</div>`;
  }
  function richCard(k, g, d) {
    const cols = `grid-template-columns:repeat(${Math.max(1, k.days.length)},1fr)`;
    const list = (rows, h, cls, items) => (rows > 0 ? `<div class="tt-rsec ${cls}" style="height:${h}px" data-tt-fade="y">${items.length ? items.map(stuRow).join('') : '<div class="tt-dash">-</div>'}</div>` : '');
    return `<div class="tt-card" style="width:${k.width}px">
      <button type="button" class="tt-cardhead${headClass(k.head)}"${headStyle(k.head)}${classAttr(k.classId)} data-tt-card="${card({ type: 'class', k: { ...k, schedule: null } })}" aria-label="${esc(k.className)} 반 정보">
        <span class="tt-cardname">${esc(k.className)}</span><span class="tt-cardroom">${esc(k.room)}${d.hideStudents ? `<span class="num"> · ${k.count}</span>` : ''}</span></button>
      <div class="tt-cardteacher">${k.teacher ? `<b>${esc(k.teacher)}</b>${k.nick ? `<small>(${esc(k.nick)})</small>` : ''}` : '<span>-</span>'}</div>
      <div class="tt-carddays" style="${cols}">${k.days.map(x => `<div class="${x.weekend ? 'we' : ''}">${esc(x.label)}</div>`).join('')}</div>
      ${k.grid.map(row => `<div class="tt-cardrow" style="${cols}">${row.map((x, i) => `<div class="tt-slot${i === row.length - 1 ? ' last' : ''}">${richCell(x.cell)}${x.moved.map(m => `<div class="tt-moved${m.paints ? ' paints' : ''}${m.line ? ' line' : ''}" style="top:${m.box.top}px;height:${m.box.height}px">${richCell(m.cell)}</div>`).join('')}</div>`).join('')}</div>`).join('')}
      ${list(g.rosterRows.active, g.activeH, 'active', k.active)}${list(g.rosterRows.hold, g.holdH, 'hold', k.hold)}${list(g.rosterRows.withdrawn, g.wdH, 'withdrawn', k.withdrawn)}
    </div>`;
  }
  function richGroup(g, d) {
    const labels = `<div class="tt-labels"><div style="height:60px">수업명</div><div style="height:24px">담임</div><div style="height:22px">시간</div>
      ${g.rows.map(r => `<div class="tt-ltime num" style="height:32px">${esc(r.text)}</div>`).join('')}
      ${g.activeH ? `<div class="tt-lact" style="height:${g.activeH}px">재원</div>` : ''}${g.holdH ? `<div style="height:${g.holdH}px">대기</div>` : ''}${g.wdH ? `<div class="last" style="height:${g.wdH}px">퇴원</div>` : ''}</div>`;
    return `<section class="tt-rgroup" aria-label="${esc(g.label)}"><div class="tt-hscroll" data-tt-fade="x"><div class="tt-rtrack">${labels}${g.cards.map(k => richCard(k, g, d)).join('')}</div></div></section>`;
  }

  // ── 정보 카드(2.0 hover 카드) ──
  function cardHtml(x) {
    if (x.type === 'class') {
      const k = x.k, n = k.counts;
      return `<div class="tt-hc-title"><b>${esc(k.className)}</b></div>${k.handover ? `<div class="tt-hc-hand">강사 인수인계 예정${k.handover.teacherName ? ` → ${esc(k.handover.teacherName)}` : ''}${k.handover.date ? ` (${esc(k.handover.date)})` : ''}</div>` : ''}
        <dl><dt>담임</dt><dd>${esc(k.teacher ?? '—')}</dd><dt>강의실</dt><dd>${esc(k.room || '—')}</dd>${k.schedule ? `<dt>시간</dt><dd class="num">${esc(k.schedule)}</dd>` : ''}</dl>
        ${k.rename ? `<p class="tt-hc-note">${esc(k.rename)}</p>` : ''}
        <div class="tt-hc-counts num"><span class="a">재원 ${n.active}</span>${n.hold ? `<span class="h">대기 ${n.hold}</span>` : ''}${n.withdrawn ? `<span class="w">퇴원 ${n.withdrawn}</span>` : ''}</div>`;
    }
    const s = x.s, c = s.card, pill = s.st === 'withdrawn' ? '<span class="tt-pill neutral">퇴원</span>' : s.st === 'hold' ? '<span class="tt-pill amber">대기</span>' : '';
    const detail = [c.isTransferredIn ? `<div><span class="tt-pill primary">반이동</span>${c.enrollmentDate ? ` <span class="num">${esc(c.enrollmentDate)}</span>` : ''}</div>`
      : c.isNew ? `<div><span class="tt-pill danger">신입</span>${c.enrollmentDate ? ` <span class="num">${esc(c.enrollmentDate)}</span>` : ''}</div>` : '',
      c.partial ? `<dl><dt>등원</dt><dd>${esc(c.partial)}</dd></dl>` : '', s.lab ? '<dl><dt>LAB</dt><dd>따로 수업(*LAB) 배정</dd></dl>' : '',
      s.st === 'withdrawn' && c.endDate ? `<dl><dt>퇴원일</dt><dd class="num">${esc(c.endDate)}</dd></dl>` : ''].filter(Boolean).join('');
    const r = c.report;
    const rep = r && (r.progress || c.textbook) ? `<div class="tt-hc-sec"><div class="tt-hc-dim"><b class="p">진도</b> <span class="num">${esc(r.date)}</span>${r.teacherName ? ` · ${esc(r.teacherName)}` : ''}</div>
      ${c.textbook ? `<p><span class="tt-hc-dim">교재</span> ${esc(c.textbook)}</p>` : ''}${r.progress ? `<p class="tt-hc-prog">${esc(r.progress)}</p>` : ''}
      ${r.examInfo || r.homeworkScore ? `<div class="tt-hc-dim num">${r.examInfo ? `시험 ${esc(r.examInfo)} ` : ''}${r.homeworkScore ? `숙제 ${esc(r.homeworkScore)}` : ''}</div>` : ''}</div>` : '';
    return `<div class="tt-hc-title"><span><b>${esc(s.n)}</b>${c.englishName ? ` <span class="tt-hc-dim">(${esc(c.englishName)})</span>` : ''} ${pill}</span>${c.sg && c.sg !== '-' ? `<span class="tt-hc-dim">${esc(c.sg)}</span>` : ''}</div>
      ${detail ? `<div class="tt-hc-sec">${detail}</div>` : ''}${s.move ? `<p class="tt-hc-note">${esc(s.move.title)}</p>` : ''}${rep}`;
  }
  function showCard(el) {
    const x = cards[Number(el.dataset.ttCard)]; if (!x) return;
    let pop = document.getElementById('tt-hovercard');
    if (!pop) { pop = document.createElement('div'); pop.id = 'tt-hovercard'; pop.setAttribute('role', 'tooltip'); document.body.append(pop); }
    pop.innerHTML = cardHtml(x); pop.style.width = `${x.type === 'class' ? 230 : 240}px`; pop.hidden = false;
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, m = 8;
    let left = r.right + m, top = r.top;
    if (left + w > innerWidth - m) left = Math.max(m, r.left - w - m);
    if (top + h > innerHeight - m) top = Math.max(m, innerHeight - h - m);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }
  const hideCard = () => { const pop = document.getElementById('tt-hovercard'); if (pop) pop.hidden = true; };

  // ── 스크롤 페이드(스크롤바 숨김 + 더 볼 쪽 가장자리만) ──
  function fade(node) {
    const x = node.dataset.ttFade, s = node;
    const set = (k, on) => s.style.setProperty(k, on ? '22px' : '0px');
    if (x !== 'y') { set('--tt-fl', s.scrollLeft > 1); set('--tt-fr', s.scrollLeft + s.clientWidth < s.scrollWidth - 1); }
    if (x !== 'x') { set('--tt-ft', s.scrollTop > 1); set('--tt-fb', s.scrollTop + s.clientHeight < s.scrollHeight - 1); }
  }
  function wireView() {
    const root = document.querySelector('[data-v2-screen="timetable"]'); if (!root) return;
    const board = root.querySelector('.tt-board');
    if (board) {
      board.style.maxHeight = `${Math.max(360, innerHeight - board.getBoundingClientRect().top - 16)}px`;
      // 페이드는 고정 머리(강사·요일 줄)와 고정 교시 열 바깥에서 시작한다 — 실제 크기를 잰다.
      const top = board.getBoundingClientRect().top, left = board.getBoundingClientRect().left;
      const head = board.querySelector('.tt-grid thead'), col = board.querySelector('.tt-plabel.sticky-l');
      if (head) board.style.setProperty('--tt-hd', `${Math.round(head.getBoundingClientRect().bottom - top)}px`);
      if (col) board.style.setProperty('--tt-pc', `${Math.round(col.getBoundingClientRect().right - left)}px`);
    }
    root.querySelectorAll('[data-tt-fade]').forEach(n => { if (!n.dataset.ttWired) { n.dataset.ttWired = '1'; n.addEventListener('scroll', () => fade(n), { passive: true }); } fade(n); });
  }
  function wire() {
    if (wired) return; wired = true;
    document.addEventListener('change', e => { const s = e.target.closest?.('[data-v2-screen="timetable"] select[data-tt-nav]'); if (s && api) api.navigate(s.value); });
    const over = e => { const el = e.target.closest?.('[data-v2-screen="timetable"] [data-tt-card]'); if (el) showCard(el); };
    const out = e => { const el = e.target.closest?.('[data-tt-card]'); if (el && !el.contains(e.relatedTarget)) hideCard(); };
    document.addEventListener('mouseover', over); document.addEventListener('focusin', over);
    document.addEventListener('mouseout', out); document.addEventListener('focusout', hideCard);
    document.addEventListener('scroll', hideCard, true);
    document.addEventListener('click', e => { if (e.target.closest?.('[data-v2-screen="timetable"] [data-tt-retry]')) lastCtx?.refresh(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(); });
    addEventListener('resize', () => requestAnimationFrame(wireView));
  }

  function body(d) {
    if (d.pending) {
      const what = d.pending === 'makeup' ? '보강 구분(그 주 보강 예약 격자)' : d.pending === 'teacher' ? '강사뷰' : '교실뷰';
      return `<div class="tt-empty"><strong>${esc(what)}는 다음 단계에서 같은 형태로 엽니다</strong><p>지금은 기본뷰·통합뷰를 볼 수 있습니다.</p></div>`;
    }
    if (d.empty) return `<div class="tt-empty"><strong>${esc(d.empty.caption)}</strong><p>${esc(d.empty.sub)}</p></div>`;
    if (d.basic) return `<div class="tt-board" data-tt-fade="xy"><div class="tt-tables">${d.basic.tables.map(tb => basicTable(tb, d)).join('')}</div></div>`;
    if (d.integrated) return `<div class="tt-rich">${d.integrated.groups.map(g => richGroup(g, d)).join('')}</div>`;
    return '';
  }

  V2Screens.register({
    id: ID, label: '시간표',
    render(ctx) {
      api = ctx.api; lastCtx = ctx; wire(); cards = [];
      const entry = ctx.load(queryOf(ctx.query)), d = entry.data;
      const head = sub => `<header class="tt-pagehead"><span class="tt-eyebrow">수업 운영</span><h1>시간표</h1>${sub ? `<span class="tt-desc">${esc(sub)}</span>` : ''}</header>
        <p class="tt-copy" role="note"><b>Docker 복사본 · 보기 전용</b> 반·학생 끌어 옮기기, 가져오기·시트로 보내기, 그룹 설정 같은 저장은 2.0과 같은 자리에 두고 막아 두었습니다. 3.0에 있는 학생·반은 누르면 기록 창이 열립니다.</p>`;
      if (!d) return entry.status === 'error'
        ? `${head('')}<div class="tt-empty"><strong>시간표를 불러오지 못했습니다</strong><p>${esc(entry.error || '')}</p><button type="button" class="tt-chip" data-tt-retry>다시 시도</button></div>`
        : `${head('')}<div class="tt-loading" aria-busy="true"><span></span><span></span><span></span><p>시간표를 불러오는 중…</p></div>`;
      requestAnimationFrame(wireView);
      return `${head(`${d.subjectLabel} 주간표`)}${toolbar(d)}${entry.refreshing ? '<p class="tt-refresh">새로 불러오는 중…</p>' : ''}${body(d)}`;
    },
  });
})();
