/* 2.0 화면 · 출석부 — 월별 출석부(2.0 `/attendance` 기본 착지)를 2.0 형태 그대로(V2-SCREENS.md, v2-screen-attendance.mjs).
   툴바 한 줄(과목·강사·반 · 달 이동 · 기간 · 보기 · 정렬 · 검색 · 살아 있는 합계 · 안내) + 표 위 한 줄(칸 안내·범례·보기 옵션) +
   학생 × 날짜 격자(31칸 고정 · 이름/학교 고정 열 · 반 머리행 · 합계 행). 강사를 고르기 전엔 2.0 '출석부 요약' 허브.
   칸 표기·색·카드 줄은 서버가 2.0 `cellDisplay`·`rollupDay`·사전으로 만든 것을 그대로 그린다(여기서 판정하지 않는다).
   상태는 주소(#v2-attendance?…)에 — 2.0의 계정 보기 설정(정렬·기간·퇴직 숨김)도 여기에 둔다. 검색어·접기는 이 창에서만.
   2단계: 칸 하나 입력(숫자 타이핑 · 우클릭/더블클릭 팝오버의 상태·시수·메모·지우기)을 ctx.act('cell')로 복사본에 — 해석·판정은
   서버가 2.0 함수로 한다. 범위 선택·복사/붙여넣기·채우기(2.0 setAttendanceRange)는 아직 없다. */
(() => {
  'use strict';
  const S = window.V2Screens; if (!S) return;
  const h = S.esc, ID = 'attendance', SEL = `[data-v2-screen="${ID}"]`;
  const READONLY = '복사본 보기 전용 — 이 화면에서는 아직 출결을 입력하지 않습니다.';
  let last = null, model = null, query = '', searchOpen = false;
  // 2단계 입력 — 2.0 격자와 같은 조작: 칸 선택 · 숫자 타이핑(0 결석 / 1·1.5·2 출석+시수) · Enter·Tab·방향키 이동 · Delete 지우기 ·
  // 우클릭(더블클릭)·Space = 칸 팝오버. 고른 칸·입력 중 글자·저장 중 칸은 다시 그려도 이어진다(주소가 아니라 이 창 안 상태).
  let active = null, buffer = null, popover = null, actorId = null, scrollPos = null;
  const saving = new Set();
  const collapsed = new Set(), hiddenCols = new Set();
  const tf = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

  // ── PORTED: 2.0 원문 그대로 — 검색(student-search.ts)·차수 표기(unit-suffix.ts·session-units.ts)·출석률(grid/totals.ts). verify가 2.0과 같은 답인지 잡는다. ──
  const normalizeSearchText = v => v.replace(/\s+/g, '').toLowerCase();
  const matchesStudentSearch = (q, fields) => { const n = normalizeSearchText(q); if (!n) return true; for (const f of fields) { if (!f) continue; if (normalizeSearchText(f).includes(n)) return true; } return false; };
  const formatUnitsWithSuffix = (units, suffix) => { const n = (Math.round(units * 10) / 10).toFixed(1); return suffix ? `${n} ${suffix}` : n; };
  const formatSessionUnits = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const rateDecimal = c => (c.recorded > 0 ? Math.round(((c.present + c.late) / c.recorded) * 1000) / 10 : 0);
  // ── PORTED 끝 ──

  const opt = (value, label, selected, extra = '') => `<option value="${h(value)}" ${selected ? 'selected' : ''} ${extra}>${h(label)}</option>`;
  const chip = (label, attrs = '', on = false) => `<button type="button" class="at-chip ${on ? 'on' : ''}" ${attrs}>${label}</button>`;

  function toolbar(d) {
    const f = d.filters, L = d.L, gridShown = !!d.grid;
    const teachers = f.teacherOptions.filter(o => !o.seat && !o.retired), seats = f.teacherOptions.filter(o => o.seat), retired = f.teacherOptions.filter(o => o.retired);
    const teacherSel = `<label class="at-sel"><span>${h(L['att.filter.teacher'])}</span><select data-at="set" data-k="teacher" aria-label="${h(L['att.filter.teacherAria'] || L['att.filter.teacher'])}">${opt('', L['att.filter.teacherAll'], !f.teacherValue && !d.seatPick)}
      ${teachers.map(o => opt(o.value, o.label, o.value === f.teacherValue)).join('')}${seats.length ? `<optgroup label="${h(L['att.hub.seats'])}">${seats.map(o => opt(o.value, o.label, o.value === `seat:${d.seatPick}`)).join('')}</optgroup>` : ''}
      ${retired.length ? `<optgroup label="${h(L['att.retired'])}">${retired.map(o => opt(o.value, o.label, o.value === f.teacherValue)).join('')}</optgroup>` : ''}</select></label>`;
    const retiredChip = f.retiredCount > 0 || !f.hideRetired ? chip(`${h(L['att.hideRetired'])}${f.retiredCount ? ` <small>${f.retiredCount}</small>` : ''}`, `data-at="set" data-k="retired" data-v="${f.hideRetired ? 'show' : ''}" aria-pressed="${f.hideRetired}" title="${h(f.hideRetired ? L['att.hideRetired.on'] : L['att.hideRetired.off'])}"`, f.hideRetired) : '';
    const view = d.filters.teacher ? `<label class="at-sel"><span>${h(L['att.view'])}</span><select data-at="view" aria-label="${h(L['att.view'])}">${opt('class', L['att.view.class'], d.mode === 'class')}${opt('teacher', L['att.view.teacher'], d.mode === 'teacher')}</select></label>`
      : `<span class="at-faint">${h(L['att.view.pickTeacher'])}</span>`;
    const period = `<span class="at-seg" role="group" aria-label="${h(L['att.period.aria'])}" ${d.period.disabledReason ? `title="${h(d.period.disabledReason)}"` : ''}><span>${h(L['att.period'])}</span>${[['session', L['att.period.session']], ['month', L['att.period.month']]].map(([v, l]) => `<button type="button" data-at="set" data-k="period" data-v="${v === 'session' ? '' : v}" aria-pressed="${d.period.mode === v}" ${d.period.disabledReason ? 'disabled' : ''}>${h(l)}</button>`).join('')}<small>${h(d.period.label)}</small></span>`;
    const grouped = d.grid?.showGroups, ids = grouped ? d.grid.groups.map(g => g.classId) : [], folded = ids.filter(x => collapsed.has(x)).length;
    const sort = gridShown ? `<label class="at-sel"><span>${h(L['att.sort'])}</span><select data-at="set" data-k="sort" aria-label="${h(L['att.sort.aria'])}">${d.sortOptions.map(o => opt(o.value === 'class' ? '' : o.value, o.label, o.value === d.sort)).join('')}</select></label>
      ${grouped && !query ? chip(`${h(folded ? L['att.expandAll'] : L['att.collapseAll'])}${folded ? ` <small>${folded}</small>` : ''}`, `data-at="fold-all" data-v="${folded ? 'open' : 'close'}"`) : ''}
      <span class="at-search">${searchOpen || query ? `<input type="search" data-at="search" value="${h(query)}" placeholder="${h(L['att.search.ph'])}" aria-label="${h(L['att.search.ph'])}" autocomplete="off"><span data-at-search-chip>${searchChip(d)}</span>` : '<button type="button" class="at-chip primary" data-at="search-open">검색</button>'}</span>` : '';
    const notices = d.notices.length ? `<details class="at-notices"><summary class="at-chip">${h(tf(L['att.notices'], { n: d.notices.length }))}</summary><div class="at-notice-panel">${d.notices.map(n => `<p>${n.map(([w, v]) => (w === 'b' ? `<strong>${h(v)}</strong>` : h(v))).join('')}</p>`).join('')}</div></details>` : '';
    return `<div class="at-toolbar">
      <label class="at-sel"><span>${h(L['att.filter.subject'])}</span><select data-at="set" data-k="subject" aria-label="${h(L['att.filter.subject'])}">${opt('', L['att.filter.subjectAll'], !f.subjectValue)}${f.subjectOptions.map(o => opt(o.value, o.label, o.value === f.subjectValue)).join('')}</select></label>
      ${teacherSel}${retiredChip}
      <label class="at-sel at-marker ${f.classValue ? 'on' : ''}"><span>${h(L['att.filter.class'])}</span><select data-at="set" data-k="class" aria-label="${h(L['att.filter.class'])}">${opt('', L['att.filter.classAll'], !f.classValue)}${f.classOptions.map(o => opt(o.value, o.hint ? `${o.label} · ${o.hint}` : o.label, o.value === f.classValue)).join('')}</select></label>
      <span class="at-period-nav" role="group" aria-label="달 이동"><button type="button" data-at="month" data-v="${h(d.prevMonth)}" aria-label="${h(L['att.nav.prev'])}">‹</button><button type="button" class="at-month" data-at="month" data-v="${h(d.currentMonth)}" title="${h(L['att.nav.current'])}">${h(d.monthLabel)}</button><button type="button" data-at="month" data-v="${h(d.nextMonth)}" aria-label="${h(L['att.nav.next'])}">›</button>${d.relation !== 'current' ? `<small class="at-rel">${d.relation === 'past' ? '과거 조회' : '미래 조회'}</small>` : ''}</span>
      ${period}${view}${sort}${actorSelect(d)}
      ${d.selectedClassLabel ? `<span class="at-target">${h(d.selectedClassLabel)}</span>` : ''}
      <div class="at-right">${!gridShown && d.scopeChip ? scopeChip(d) : ''}${gridShown ? `<span data-at-stats>${stats(d)}</span>` : ''}${notices}</div></div>`;
  }
  /** 검색이 걸렸을 때 — 2.0 `SearchScopeChip`(걸린 학생 / 전체 · 숫자도 검색 기준) + 지우기. */
  const searchChip = d => (query && d.grid ? `<span class="at-scope" title="${h(d.L['att.search.totalsNote'])}">${h(tf(d.L['att.search.count'], { n: new Set(matched(d.grid).map(r => r.studentId)).size }))} / ${d.stats.totalStudents}</span><button type="button" class="at-link" data-at="search-clear">${h(d.L['att.search.clear'])}</button>` : '');
 /** 저장하는 사람 — 출결 '전체' 권한 직원(2.0 권한 표). 3.0엔 로그인이 없어 화면에서 고른다(감사로그 actor). */
  const actorSelect = d => (last?.writable && d.grid && d.actors?.length ? `<label class="at-sel at-actor"><span>입력하는 사람</span><select data-at="actor" aria-label="입력하는 사람">${d.actors.map(a => opt(a.id, a.roleLabel ? `${a.name} · ${a.roleLabel}` : a.name, a.id === currentActor(d))).join('')}</select></label>` : '');
  function currentActor(d) {
    if (actorId && d.actors.some(a => a.id === actorId)) return actorId;
    try { const saved = localStorage.getItem('v2-attendance-actor'); if (saved && d.actors.some(a => a.id === saved)) return (actorId = saved); } catch { /* 저장소를 못 쓰면 기본값 */ }
    return (actorId = (d.actors.find(a => a.roleLabel === '원장') ?? d.actors[0]).id);
  }
  const scopeChip = d => `<span class="at-scope" title="${h(d.L['att.scopeChip.title'])}">${h(d.L['att.scopeChip'])}</span>`;
  const metric = (label, value, unit, of, cls = '') => `<span class="at-metric"><span>${h(label)}</span><strong class="${cls}">${h(value)}</strong>${of != null ? `<small>/ ${h(of)}</small>` : ''}${unit ? `<small>${h(unit)}</small>` : ''}</span>`;
  const rateColor = r => (r === null ? '' : r >= 90 ? 'ok' : r >= 80 ? 'warn' : 'bad');

  /** 지금 보이는 행(검색에 걸린 행) — 2.0 `SearchedRow`와 같이 안 걸린 행은 그리지 않는다. */
  const allRows = g => (g.showGroups ? g.groups.flatMap(x => x.rows) : g.rows);
  const matched = g => (query ? allRows(g).filter(r => matchesStudentSearch(query, r.find)) : allRows(g));
  const countOf = rows => rows.reduce((a, r) => ({ recorded: a.recorded + r.c[0], present: a.present + r.c[1], absent: a.absent + r.c[2], late: a.late + r.c[3], makeup: a.makeup + r.c[4], units: Math.round((a.units + r.c[5]) * 10) / 10 }),
    { recorded: 0, present: 0, absent: 0, late: 0, makeup: 0, units: 0 });
  function stats(d) {
    const L = d.L, all = d.stats, searching = !!query && !!d.grid, c = searching ? countOf(matched(d.grid)) : all, students = searching ? new Set(matched(d.grid).map(r => r.studentId)).size : all.totalStudents;
    const rate = rateDecimal(c), allRate = rateDecimal(all);
    return `<span class="at-stats">${metric(L['att.stat.enrolled'], students, L['att.stat.people'], searching ? all.totalStudents : null)}
      ${metric(L['att.stat.rate'], c.recorded > 0 ? rate : '—', c.recorded > 0 || (searching && all.recorded > 0) ? '%' : L['att.stat.noRecord'], searching ? (all.recorded > 0 ? allRate : '—') : null, rateColor(c.recorded > 0 ? rate : null))}
      ${metric(L['att.stat.absent'], c.absent, L['att.stat.times'], searching ? all.absent : null, 'bad')}${metric(L['att.stat.late'], c.late, L['att.stat.times'], searching ? all.late : null, 'warn')}</span>`;
  }

  // ── 요약 허브(강사 미선택) — 2.0 AttendanceHub ──
  function hub(d) {
    const L = d.L, x = d.hub, active = x.teachers.filter(t => !t.retired), retired = x.teachers.filter(t => t.retired);
    const tot = x.teachers.reduce((a, t) => ({ classes: a.classes + (t.today?.classes ?? 0), done: a.done + (t.today?.doneClasses ?? 0), expected: a.expected + (t.today?.expected ?? 0), recorded: a.recorded + (t.today?.recorded ?? 0) }), { classes: 0, done: 0, expected: 0, recorded: 0 });
    const row = t => `<li><button type="button" class="at-hub-row ${t.retired ? 'retired' : ''}" data-at="hub-teacher" data-v="${h(t.id)}"><span class="at-hub-main"><span class="at-hub-name"><strong>${h(t.name)}</strong>${t.retired ? `<small>${h(L['att.hub.retired'])}</small>` : ''}${t.subjects.map(s => `<span class="at-pill pill-${h(s.color)}">${h(s.label)}</span>`).join('')}</span>
      <small>${t.classCount}${h(L['att.hub.classesSuffix'])}${t.today && !x.holiday ? `${h(L['att.hub.todayPre'])}<b class="${t.today.recorded >= t.today.expected ? 'ok' : 'warn'}">${t.today.recorded}/${t.today.expected}</b>${h(L['att.hub.todayPost'])}` : ''}</small></span><span class="at-hub-open">${h(L['att.hub.open'])}</span></button></li>`;
    const line = x.holiday ? `<p class="at-dim">${h(x.holidayLine)}</p>` : tot.classes > 0 ? `<p class="at-dim">${h(x.todayPre)}<b>${tot.classes}</b>${h(L['att.hub.today.b'])}<b>${tot.recorded}</b>/${tot.expected}${h(L['att.hub.today.c'])}<b>${tot.done}</b>${h(L['att.hub.today.d'])}</p>` : `<p class="at-dim">${h(x.noClassesLine)}</p>`;
    return `<section class="at-hub"><div class="at-hub-head"><p class="at-hub-title">${h(L['att.hub.title'])}</p>${line}</div><p class="at-dim">${h(L['att.hub.hint'])}</p>
      ${x.seats.length ? `<p class="at-micro">${h(L['att.hub.seats'])}</p><ul class="at-hub-grid">${x.seats.map(s => `<li><div class="at-seat ${s.open ? '' : 'closed'}"><span><strong>${h(s.name)}</strong> <small>${h(s.room)}</small><br><small>${h(s.open ? L['att.hub.seatOpen'] : L['att.hub.seatClosed'])}</small></span>
        <button type="button" class="at-pillbtn" disabled title="자리 출석부는 이 연습 화면에 아직 없습니다">${h(L['att.hub.monthly'])}</button><button type="button" class="at-pillbtn primary" disabled title="자리 출석부는 이 연습 화면에 아직 없습니다">${h(s.open ? L['att.hub.day'] : L['att.hub.prep'])}</button></div></li>`).join('')}</ul>` : ''}
      ${x.teachers.length ? `<ul class="at-hub-grid at-hub-teachers">${active.map(row).join('')}</ul>${retired.length ? `<p class="at-micro">${h(L['att.retired'])}</p><ul class="at-hub-grid">${retired.map(row).join('')}</ul>` : ''}` : `<p class="at-dim">${h(L['att.hub.noHomeroom'])}</p>`}</section>`;
  }

  // ── 격자 ──
  const K = cls => model.grid.K[cls] ?? '';
  function legendLine(d) {
    const g = d.grid, lg = g.legend, L = d.L, item = (sw, label) => `<span class="at-lg-item">${sw}${h(label)}</span>`;
    return `<div class="at-optline">${d.scopeChip ? scopeChip(d) : ''}
      <div class="at-legend">${lg.units.length ? `<span class="at-units"><strong>${h(L['att.units.guide'])}</strong>${lg.units.map(u => `<span>${h(u)}</span>`).join('')}</span>` : ''}
        <span class="at-lg"><span class="at-micro">${h(L['att.legend'])}</span>${lg.statuses.map(s => item(`<span class="at-sw chip ${K(s.k)}">${h(s.text)}</span>`, s.label)).join('')}
        ${item(`<span class="at-sw chip ${K(lg.mixed.k)}" ${lg.mixed.bg ? `style="background:${h(lg.mixed.bg)}"` : ''}>${h(lg.mixed.text)}</span>`, L['att.legend.mixed'])}${item(`<span class="at-sw ${K(lg.reserved)}"></span>`, L['att.cell.reserved'])}
        ${lg.swatches.map(s => item(`<span class="at-sw box ${K(s.k)}"></span>`, s.label)).join('')}</span></div>
      <div class="at-cols"><button type="button" class="at-chip small" data-at="cols" aria-expanded="false">${h(L['att.columns.toggle'])}</button><div class="at-cols-menu" hidden role="dialog" aria-label="${h(L['att.columns.toggle'])}">
        ${[['school', L['att.col.schoolGrade']], ['units', L['att.col.lessonCount']]].map(([key, label]) => `<label><input type="checkbox" data-at="col" data-v="${key}" ${hiddenCols.has(key) ? '' : 'checked'}> ${h(label)}</label>`).join('')}
        <button type="button" class="at-link" data-at="cols-all">${h(L['att.columns.all'])}</button></div></div></div>`;
  }
  function cellHtml(row, ri, cell, ci) {
    if (!cell) return '<td class="pad" aria-hidden="true"></td>';
    const reserved = cell.rv ? `<span class="at-rv" aria-hidden="true">${model.grid.reservedChars.map(ch => `<span>${h(ch)}</span>`).join('')}</span>` : h(cell.x);
    const badges = cell.b ? `<span class="at-badges ${cell.b.align === 'end' ? 'end' : 'start'}">${cell.b.list.map(b => `<span class="at-badge ${K(b.k)}">${h(b.label)}</span>`).join('')}</span>` : '';
    const date = model.grid.head[ci].date, ck = `${row.key}|${date}`, isActive = active === ck, editing = isActive && buffer !== null;
    const label = `${date} ${cell.s ? (cell.tip?.r?.[0]?.[1] ?? '') : cell.rv ? model.L['att.cell.reserved'] : model.L['att.cell.unmarked']}${cell.n > 1 ? tf(model.L['att.cell.andNPeriods'], { n: cell.n - 1 }) : ''}`;
    const writable = !!last?.writable && model.actors?.length;
    return `<td class="at-td"><div class="at-cell ${K(cell.k)}${isActive ? ' is-active' : ''}${saving.has(ck) ? ' is-saving' : ''}" role="gridcell" aria-label="${h(label)}" aria-selected="${isActive}" ${saving.has(ck) ? 'aria-busy="true"' : ''} data-r="${ri}" data-c="${ci}" data-ck="${h(ck)}" ${writable ? `tabindex="${isActive ? 0 : -1}"` : ''} ${cell.bg ? `style="background:${h(cell.bg)}"` : ''}>${editing ? `<span class="at-buf">${h(buffer)}</span>` : reserved}${cell.m ? '<span class="at-memo" aria-hidden="true"></span>' : ''}</div>
      ${cell.sp ? `<span class="at-split ${cell.sp}" aria-hidden="true"></span>` : ''}${badges}</td>`;
  }
  function rowHtml(row, ri) {
    const showSchool = !hiddenCols.has('school'), showUnits = !hiddenCols.has('units');
    return `<tr data-row="${h(row.key)}"><td class="at-name ${K(row.tone)}"><span class="at-name1"><span class="at-trunc" title="${h(row.name)}">${h(row.name)}</span>${row.split ? `<span class="at-badge split" data-tip-row="${ri}">${h(model.L['att.row.split.mark'])}</span>` : ''}</span>
      ${row.attend ? `<span class="at-name2"><span class="at-trunc" title="${h(row.attendTitle)}">${h(row.attend)}</span></span>` : ''}</td>
      ${showSchool ? `<td class="at-school"><span class="at-trunc" ${row.schoolTitle ? `title="${h(row.schoolTitle)}"` : ''}>${h(row.school)}</span></td>` : ''}
      ${showUnits ? `<td class="at-units-cell">${h(row.units)}</td>` : ''}${row.cells.map((c, ci) => cellHtml(row, ri, c, ci)).join('')}</tr>`;
  }
  function grid(d) {
    const g = d.grid, L = d.L, showSchool = !hiddenCols.has('school'), showUnits = !hiddenCols.has('units');
    const cols = g.head.length + 1 + (showSchool ? 1 : 0) + (showUnits ? 1 : 0), rows = matched(g), keep = new Set(rows.map(r => r.key));
    const index = []; // 칸 카드가 행을 찾는 표(그린 순서)
    const head = `<tr><th class="at-corner">${g.showGroups && !query ? `<button type="button" class="at-fold-all" data-at="fold-all" data-v="${g.groups.some(x => collapsed.has(x.classId)) ? 'open' : 'close'}" aria-label="${h(g.groups.some(x => collapsed.has(x.classId)) ? L['att.expandAll'] : L['att.collapseAll'])}">▸</button>` : ''}<span class="at-micro">${h(L['att.col.name'])}</span></th>
      ${showSchool ? `<th class="at-th" title="${h(L['att.col.schoolGradeTitle'])}"><span class="at-micro b">${h(L['att.col.schoolGrade'])}</span></th>` : ''}${showUnits ? `<th class="at-th" title="${h(L['att.col.lessonCountTitle'])}"><span class="at-micro b">${h(L['att.col.lessonCount'])}</span></th>` : ''}
      ${g.head.map(x => (x.placeholder ? '<th class="at-day pad" aria-hidden="true"></th>' : `<th class="at-day ${K(x.k)}" ${x.holiday ? `title="${h(x.holiday)}"` : ''}><div>${x.day}</div><div class="dow">${h(x.label)}</div></th>`)).join('')}</tr>`;
    let body = '';
    if (g.showGroups) {
      for (const grp of g.groups) {
        const shown = grp.rows.filter(r => keep.has(r.key)); if (query && !shown.length) continue;
        const folded = !query && collapsed.has(grp.classId);
        body += `<tbody><tr class="at-group"><td colspan="${cols}"><button type="button" class="at-group-btn" data-at="fold" data-v="${h(grp.classId)}" aria-expanded="${!folded}"><span class="at-chev ${folded ? '' : 'open'}" aria-hidden="true">▸</span>
          <strong>${h(grp.className)}</strong><span class="at-faint">${h(grp.subjectLabel)}</span>${grp.roleLabel ? `<span class="at-tag" title="${h(L['att.group.slotTitle'])}">${h(grp.roleLabel)}</span>` : ''}${grp.workerLabel ? `<span class="at-dim" title="${h(grp.workerTitle)}">${h(grp.workerLabel)}</span>` : ''}
          ${grp.sinceLabel ? `<span class="at-tag" title="${h(L['att.group.sinceTitle'])}">${h(grp.sinceLabel)}</span>` : ''}<span class="at-dim">${h(grp.count)}</span>${query ? `<span class="at-dim">${h(tf(L['att.search.count'], { n: shown.length }))}</span>` : ''}</button></td></tr>
          ${folded ? '' : shown.map(r => { index.push(r); return rowHtml(r, index.length - 1); }).join('')}</tbody>`;
      }
    } else body = `<tbody>${rows.map(r => { index.push(r); return rowHtml(r, index.length - 1); }).join('')}</tbody>`;
    model.index = index;
    const empty = query && !rows.length ? `<tbody><tr><td colspan="${cols}" class="at-empty">${h(tf(L['att.search.none'], { query: query.trim(), where: L['att.searchEmpty.where'] }))}</td></tr></tbody>` : '';
    // 합계 행 — 2.0 `columnTotals`(검색 중이면 걸린 행만, 같은 규약: 소비 상태 칸의 시수 합).
    const scope = rows, totalUnits = query ? formatUnitsWithSuffix(countOf(scope).units, g.totals.suffix) : g.totals.units;
    const dayTotals = query ? Object.fromEntries(g.head.map((x, ci) => [x.date, scope.reduce((n, r) => { const c = r.cells[ci]; return c?.s && c.s !== 'absent' && c.s !== 'excused' ? n + Number(c.x) : n; }, 0)]).filter(([, u]) => u > 0).map(([dt, u]) => [dt, formatUnitsWithSuffix(u, null)])) : g.totals.days;
    const all = countOf(allRows(g)), shownCount = countOf(scope), classes = query ? new Set(scope.map(r => r.classId)).size : g.classCount;
    const guide = `<span class="at-guide" title="${h(L['att.help.full'])}">${h(L['att.help.briefPre'])}${shownCount.recorded}${query ? ` / ${all.recorded}` : ''}${h(L['att.help.brief'])}</span>`;
    const summary = g.classCount > 1 ? `<span class="at-sum"><strong>${h(query ? L['att.totals.search'] : L['att.totals.all'])}</strong>${query ? `<span class="at-dim">‘${h(query.trim())}’</span><span class="at-searching">${h(L['att.totals.searching'])}</span>` : ''}
      <span class="at-dim">${classes}${query ? ` / ${g.classCount}` : ''}${h(L['att.totals.classes'])}</span><strong>${h(L['att.totals.units'])}${formatSessionUnits(shownCount.units)}${query ? ` / ${formatSessionUnits(all.units)}` : ''}</strong>${guide}</span>` : guide;
    const foot = `<tfoot><tr class="at-totals"><td class="at-tot-label" colspan="${showSchool ? 2 : 1}">${h(query ? L['att.totals.search'] : L['att.totals.all'])}</td>${showUnits ? `<td class="at-units-cell">${h(totalUnits)}</td>` : ''}
      ${g.head.map(x => `<td class="at-tot-day">${x.placeholder ? '' : h(dayTotals[x.date] ?? '')}</td>`).join('')}</tr><tr class="at-summary"><td colspan="${cols}"><div class="at-sum-wrap">${summary}</div></td></tr></tfoot>`;
    const minW = 88 + (showSchool ? 72 : 0) + (showUnits ? 76 : 0) + g.head.length * 22;
    return `${legendLine(d)}<div class="at-scroll" data-at-scroll tabindex="0" aria-label="${h(L['att.title'])} 표"><table class="at-table" role="grid" style="min-width:${minW}px">
      <colgroup><col class="c-name">${showSchool ? '<col class="c-school">' : ''}${showUnits ? '<col class="c-units">' : ''}${g.head.map(() => '<col class="c-day">').join('')}</colgroup>
      <thead>${head}</thead>${body}${empty}${foot}</table></div>
      ${substituteHtml(d)}`;
  }
  /** 다른 반 대신 보강(읽기 전용 목록) — 2.0 `SubstituteCellsNote`. 표가 비어도 선다. */
  const substituteHtml = d => (d.substitute ? `<section class="at-sub"><strong>${h(d.substitute.title)}</strong> <span class="at-tag">${h(d.L['att.sub.readonly'])}</span> <span class="at-dim">${h(d.L['att.sub.desc'])}</span><ul>${d.substitute.items.map(x => `<li>${h(x)}</li>`).join('')}${d.substitute.more ? `<li class="at-dim">${h(d.substitute.more)}</li>` : ''}</ul></section>` : '');

  function region(d) {
    if (d.seatPick) return `<p class="at-strip">자리 출석부(랩실·JJ실)는 이 연습 화면에 아직 없습니다 — 강사 목록에서 선생님을 고르면 월별 출석부가 열립니다.</p>`;
    if (d.hub) return hub(d);
    if (d.empty) return `<div class="at-emptystate"><strong>${h(d.empty.title)}</strong><p>${h(d.empty.desc)}</p></div>${substituteHtml(d)}`;
    return grid(d);
  }

  S.register({ id: ID, label: '출석부', render(ctx) {
    last = ctx;
    const q = ctx.query, params = Object.fromEntries(['month', 'subject', 'teacher', 'class', 'mode', 'sort', 'period', 'retired'].map(k => [k, q.get(k) || '']));
    const e = ctx.load(params);
    const head = `<div class="v2s-head"><h1>출석부</h1><span class="v2s-badge">${ctx.writable ? '2.0 화면 · 연습 복사본' : '2.0 화면 · 복사본 보기 전용'}</span></div>${ctx.writable ? `<p class="v2s-note">${h(ctx.copyNote)}</p>` : ''}`;
    if (e.status === 'loading') return `${head}<p class="v2s-note">불러오는 중입니다…</p>`;
    if (e.status === 'error') return `${head}<p class="v2s-note">${h(e.error)}</p><button type="button" class="at-chip" data-at="retry">다시 불러오기</button>`;
    model = e.data;
    queueMicrotask(after);
    const foot = ctx.writable ? `칸을 고르고 숫자를 치거나 우클릭해 입력합니다 — 고른 사람 이름으로 연습용 복사본에 저장합니다(2.0 감사로그와 같은 줄 · 알림은 보내지 않습니다).` : READONLY;
    return `${head}<div class="att">${toolbar(model)}<div class="at-region" data-at-region>${region(model)}</div><p class="at-foot">${h(foot)}</p></div>`;
  } });

  // ── 그린 뒤: 열 숨김 적용 · 스크롤 가장자리 페이드 ──
  function after() {
    const root = document.querySelector(SEL); if (!root) return;
    const sc = root.querySelector('[data-at-scroll]');
    if (sc && !sc.dataset.fade) {
      sc.dataset.fade = '1';
      // 다시 그려도(저장 뒤 새 값) 보던 자리 그대로 — 스크롤 위치를 쥐고 있다가 되돌린다(AGENTS.md 스크롤 원칙).
      if (scrollPos?.view === viewKey()) { sc.scrollLeft = scrollPos.left; sc.scrollTop = scrollPos.top; }
      sc.addEventListener('scroll', () => { scrollPos = { view: viewKey(), left: sc.scrollLeft, top: sc.scrollTop }; fade(sc); }, { passive: true });
    }
    if (sc) fade(sc);
    if (popover) drawPopover();
    else if (active) root.querySelector(`[data-ck="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }
  const viewKey = () => (last ? ['month', 'subject', 'teacher', 'class', 'mode', 'sort', 'period'].map(k => last.query.get(k) || '').join('|') : '');
  /** 더 볼 내용이 남은 방향의 가장자리에만 페이드(AGENTS.md 스크롤 원칙) — 고정 머리줄·이름 열 바깥에서 시작한다. */
  function fade(el) {
    const x = el.scrollLeft, y = el.scrollTop, maxX = el.scrollWidth - el.clientWidth - 1, maxY = el.scrollHeight - el.clientHeight - 1;
    const name = el.querySelector('.at-corner')?.offsetWidth ?? 0, headH = el.querySelector('thead')?.offsetHeight ?? 0;
    el.style.setProperty('--fl', x > 1 ? '24px' : '0px'); el.style.setProperty('--fr', x < maxX ? '24px' : '0px');
    el.style.setProperty('--ft', y > 1 ? '20px' : '0px'); el.style.setProperty('--fb', y < maxY ? '24px' : '0px');
    el.style.setProperty('--fx0', `${name}px`); el.style.setProperty('--fy0', `${headH}px`);
  }

  // ── 칸 카드(2.0 HoverTipLayer — 문서마다 한 장) ──
  let card = null, cardFor = null;
  const cardEl = () => card ?? (card = Object.assign(document.createElement('div'), { className: 'at-tipcard', hidden: true, role: 'tooltip' }), document.body.append(card), card);
  function showCard(anchor, html) {
    const c = cardEl(); c.innerHTML = html; c.hidden = false;
    const r = anchor.getBoundingClientRect(), w = c.offsetWidth, hh = c.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8), top = r.bottom + 6; if (top + hh > vh - 8) top = Math.max(8, r.top - hh - 6);
    c.style.left = `${left}px`; c.style.top = `${top}px`;
  }
  const hideCard = () => { if (card) card.hidden = true; cardFor = null; };
  const md = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  function cardHtml(title, meta, rows = [], lines = []) {
    return `<div class="at-tip-head"><strong>${h(title)}</strong>${meta ? `<small>${h(meta)}</small>` : ''}</div>${rows.length ? `<dl>${rows.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>` : ''}${lines.map(l => `<p>${h(l)}</p>`).join('')}`;
  }
  document.addEventListener('mouseover', ev => {
    const el = ev.target.closest?.(`${SEL} [data-r][data-c], ${SEL} [data-tip-row]`);
    if (!el) { if (cardFor) hideCard(); return; }
    if (el === cardFor || !model?.index) return;
    if (el.dataset.tipRow !== undefined) { const row = model.index[Number(el.dataset.tipRow)]; if (row?.split) { cardFor = el; showCard(el, cardHtml(model.L['att.row.split.title'], null, [], row.split)); } return; }
    const row = model.index[Number(el.dataset.r)], ci = Number(el.dataset.c), cell = row?.cells[ci];
    if (!cell?.tip) { hideCard(); return; }
    cardFor = el; showCard(el, cardHtml(row.name, md(model.grid.head[ci].date), cell.tip.r || [], cell.tip.l || []));
  });
  document.addEventListener('scroll', hideCard, true);

  // ── 2단계: 입력 ────────────────────────────────────────────────────────────────
  /** 칸 → 저장 재료. 칸 키 = `${rowKey}|${date}`(rowKey = `${classId}|${studentId}`, 2.0 grid/model). */
  function cellOf(ck) {
    if (!model?.index || !ck) return null;
    const i = ck.lastIndexOf('|'), key = ck.slice(0, i), date = ck.slice(i + 1), ri = model.index.findIndex(r => r.key === key), ci = model.grid.head.findIndex(x => x.date === date);
    if (ri < 0 || ci < 0) return null;
    const row = model.index[ri];
    return { ck, ri, ci, row, date, cell: row.cells[ci] };
  }
  /** 2.0 `scopeFieldsFor` — 강사 전체 보기의 그 강사 반 칸만 몫을 싣는다(보강 묶음은 싣지 않는다). */
  const scopeFor = classId => (model.scope && model.scope.classIds.includes(classId) ? { scopeTeacherId: model.scope.teacherId } : {});
  async function save(ck, body) {
    const c = cellOf(ck); if (!c || saving.has(ck)) return;
    saving.add(ck); paint(ck);
    try { await last.act('cell', { actor: currentActor(model), studentId: c.row.studentId, classId: c.row.classId, date: c.date, ...body, ...scopeFor(c.row.classId) }); }
    catch (error) { const msg = error?.message || '저장하지 못했습니다.'; if (last.api?.toast) last.api.toast(msg); else window.alert(msg); }
    finally { saving.delete(ck); paint(ck); }
  }
  /** 칸 하나만 다시 칠한다(선택·입력 중 글자·저장 중) — 표 전체를 다시 그리지 않는다. */
  function paint(ck) {
    const el = document.querySelector(`${SEL} [data-ck="${CSS.escape(ck)}"]`), c = cellOf(ck); if (!el || !c) return;
    const tmp = document.createElement('tbody'); tmp.innerHTML = `<tr>${cellHtml(c.row, c.ri, c.cell, c.ci)}</tr>`;
    const fresh = tmp.querySelector('.at-cell'); el.replaceWith(fresh);
    if (active === ck && !popover) fresh.focus({ preventScroll: true });
  }
  function select(ck) {
    const prev = active; active = ck; buffer = null;
    if (prev && prev !== ck) paint(prev);
    paint(ck); document.querySelector(`${SEL} [data-ck="${CSS.escape(ck)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function move(dc, dr) {
    const c = cellOf(active); if (!c) return;
    const cols = model.grid.head.map((x, i) => (x.placeholder ? -1 : i)).filter(i => i >= 0), at = cols.indexOf(c.ci);
    const ri = Math.min(model.index.length - 1, Math.max(0, c.ri + dr)), nc = cols[Math.min(cols.length - 1, Math.max(0, at + dc))];
    select(`${model.index[ri].key}|${model.grid.head[nc].date}`);
  }
  /** 친 글자 확정 — 해석은 서버가 2.0 `commitBuffer`로 한다(0 = 결석 · 1·1.5·2 = 출석 + 시수). */
  function commit() { if (buffer === null || !active) return; const typed = buffer, ck = active; buffer = null; paint(ck); if (typed.trim()) save(ck, { typed }); }

  function popoverHtml() {
    const c = cellOf(popover?.ck); if (!c) return '';
    const P = model.popover, L = P.L, cell = c.cell || {}, recorded = !!cell.s && !cell.d, masked = !!cell.nm, locked = !!cell.rs;
    // 2.0 `unitsDraft` 초기값 — 기록이 있으면 그 시수(기본 1), 없으면 빈 칸(서버가 자동 시수를 넣는다 · 자리표시로 그 값을 보인다).
    const units = recorded ? String(cell.u ?? 1) : cell.u != null ? String(cell.u) : '';
    const r = popover.anchor, left = Math.max(8, Math.min(r.x, window.innerWidth - 230)), pos = r.top != null ? `top:${r.top}px` : `bottom:${r.bottom}px`;
    const ph = !recorded && cell.au != null ? tf(L['att.pop.unitsPhAuto'], { n: formatSessionUnits(cell.au) }) : L['att.pop.unitsPh'];
    return `<div class="at-pop-back" data-at="pop-close" aria-hidden="true"></div><div class="at-pop" role="dialog" aria-label="${h(L['att.pop.aria'])}" style="left:${left}px;${pos}">
      <p class="at-pop-head"><strong>${h(c.row.name)}</strong> <small>${h(md(c.date))}</small></p>
      ${locked ? `<div class="at-pop-resv"><strong>${h(L['att.pop.reserved'])}</strong><p>${h(cell.rs.span)}</p><p>2.0은 이 칸을 저장할 때 보강 예약 이행(결석 칸 메모·시수)까지 함께 바꿉니다 — 이 연습 화면에서는 저장하지 않습니다.</p></div>` : ''}
      ${P.statuses.map(o => `<button type="button" class="at-pop-item ${cell.s === o.value ? 'on' : ''}" data-at="pop-status" data-v="${o.value}" ${locked ? 'disabled' : ''}>${h(o.label)}<span class="at-sw ${h(o.tone)}" aria-hidden="true"></span></button>`).join('')}
      <button type="button" class="at-pop-item" disabled title="보강 예약 창은 이 연습 화면에 아직 없습니다">${h(L['att.pop.reserve'])}<span class="at-sw at-sw-resv" aria-hidden="true"></span></button>
      <div class="at-pop-form"><input type="text" inputmode="decimal" data-at="pop-units" value="${h(units)}" placeholder="${h(ph)}" aria-label="${h(L['att.pop.unitsAria'])}" title="${h(L['att.pop.unitsTitle'])}" ${locked ? 'disabled' : ''}>
        <input type="text" data-at="pop-note" value="${h(masked ? '' : cell.nt ?? '')}" placeholder="${h(masked ? '연락처가 적힌 메모 — 여기서는 고치지 않습니다' : L['att.pop.notePh'])}" aria-label="${h(L['att.pop.notePh'])}" ${masked || locked ? 'disabled' : ''}>
        <button type="button" class="at-pop-save" data-at="pop-save" ${cell.s && !locked ? '' : 'disabled'} ${cell.s ? '' : `title="${h(L['att.pop.pickFirst'])}"`}>${h(L['att.pop.save'])}</button></div>
      ${cell.s && !locked ? `<button type="button" class="at-pop-item clear" data-at="pop-clear">${h(L['att.pop.clear'])}</button>` : ''}</div>`;
  }
  function openPopover(ck, el) {
    const r = el.getBoundingClientRect(), vh = window.innerHeight, up = vh - r.bottom < 320 && r.top > vh - r.bottom;
    hideCard(); if (active !== ck) select(ck);
    buffer = null; popover = { ck, anchor: up ? { x: r.left, bottom: vh - r.top + 4 } : { x: r.left, top: r.bottom + 4 } };
    drawPopover(); document.querySelector(`${SEL} .at-pop [data-at="pop-units"]`)?.focus();
  }
  function drawPopover() {
    document.querySelectorAll(`${SEL} .at-pop, ${SEL} .at-pop-back`).forEach(n => n.remove());
    if (!popover) return;
    const box = document.createElement("div"); box.innerHTML = popoverHtml(); document.querySelector(`${SEL} .att`)?.append(...box.childNodes);
  }
  const closePopover = () => { const ck = popover?.ck; popover = null; drawPopover(); if (ck) paint(ck); };
  /** 2.0 `CellPopover.apply` — 상태 버튼 = 그 상태 + 시수 칸 원문(메모는 안 보낸다) · '저장' = 메모까지 · '지우기' = 상태 없음. */
  function applyPopover(status, withNote) {
    const c = cellOf(popover?.ck); if (!c) return;
    const units = document.querySelector(`${SEL} .at-pop [data-at="pop-units"]`)?.value ?? '', noteEl = document.querySelector(`${SEL} .at-pop [data-at="pop-note"]`);
    const body = status === null ? { status: null } : { status, units, ...(withNote && noteEl && !noteEl.disabled ? { note: noteEl.value } : {}) };
    const ck = c.ck; closePopover(); save(ck, body);
  }

  // ── 조작 — 바뀌는 것은 모두 주소(뒤로·새로고침에도 같은 화면). 검색·접기·열 숨김만 이 창 안에서. ──
  const go = patch => { if (!last) return; const p = Object.fromEntries(last.query); Object.assign(p, patch); for (const k of Object.keys(p)) if (p[k] === '' || p[k] == null) delete p[k]; hideCard(); last.go(p); };
  const redrawRegion = () => { const root = document.querySelector(SEL); if (!root || !model) return; const r = root.querySelector('[data-at-region]'); if (r) r.innerHTML = region(model); const st = root.querySelector('[data-at-stats]'); if (st) st.innerHTML = stats(model); after(); };
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.(`${SEL} [data-at]`); if (!t || t.disabled) return;
    const k = t.dataset.at, d = model;
    if (k === 'set') go({ [t.dataset.k]: t.dataset.v });
    else if (k === 'month') go({ month: t.dataset.v });
    else if (k === 'hub-teacher') go({ teacher: t.dataset.v, class: '', mode: 'teacher' });
    else if (k === 'fold') { const id = t.dataset.v; if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); redrawRegion(); rerenderToolbar(); }
    else if (k === 'fold-all') { const ids = d.grid?.groups?.map(g => g.classId) ?? []; if (t.dataset.v === 'open') ids.forEach(id => collapsed.delete(id)); else ids.forEach(id => collapsed.add(id)); redrawRegion(); rerenderToolbar(); }
    else if (k === 'search-open') { searchOpen = true; rerenderToolbar(); document.querySelector(`${SEL} [data-at="search"]`)?.focus(); }
    else if (k === 'search-clear') { query = ''; searchOpen = false; rerenderToolbar(); redrawRegion(); }
    else if (k === 'cols') { const m = t.nextElementSibling; m.hidden = !m.hidden; t.setAttribute('aria-expanded', String(!m.hidden)); }
    else if (k === 'cols-all') { hiddenCols.clear(); redrawRegion(); }
    else if (k === 'retry') last.refresh();
    else if (k === 'pop-close') closePopover();
    else if (k === 'pop-status') applyPopover(t.dataset.v, false);
    else if (k === 'pop-save') { const c = cellOf(popover?.ck); if (c?.cell?.s) applyPopover(c.cell.s, true); }
    else if (k === 'pop-clear') applyPopover(null, false);
  });
  // 칸 고르기 · 우클릭/더블클릭 = 팝오버(2.0 AttendanceCell). 저장할 수 있는 화면에서만.
  const editable = () => !!last?.writable && !!model?.grid && !!model.actors?.length;
  document.addEventListener('mousedown', ev => {
    const el = ev.target.closest?.(`${SEL} .at-cell[data-ck]`); if (!el || !editable() || ev.button !== 0) return;
    ev.preventDefault(); if (active !== el.dataset.ck) { commit(); select(el.dataset.ck); }
  });
  const pop = ev => { const el = ev.target.closest?.(`${SEL} .at-cell[data-ck]`); if (!el || !editable()) return; ev.preventDefault(); commit(); openPopover(el.dataset.ck, el); };
  document.addEventListener('dblclick', pop);
  document.addEventListener('contextmenu', pop);
  document.addEventListener('keydown', ev => {
    if (!editable() || !active) return;
    if (popover) {
      if (ev.key === 'Escape') { ev.preventDefault(); closePopover(); }
      else if (ev.key === 'Enter' && ev.target.matches?.('.at-pop input')) { ev.preventDefault(); document.querySelector(`${SEL} .at-pop [data-at="pop-save"]:not([disabled])`)?.click(); }
      return;
    }
    if (!ev.target.closest?.(`${SEL} .at-cell`)) return;
    const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Enter: [0, ev.shiftKey ? -1 : 1], Tab: [ev.shiftKey ? -1 : 1, 0] };
    if (moves[ev.key]) { ev.preventDefault(); commit(); move(...moves[ev.key]); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); buffer = null; paint(active); return; }
    if (ev.key === ' ') { ev.preventDefault(); const el = document.querySelector(`${SEL} [data-ck="${CSS.escape(active)}"]`); if (el) openPopover(active, el); return; }
    if (ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^[0-9.,]$/.test(ev.key)) { ev.preventDefault(); const next = `${buffer ?? ''}${ev.key === ',' ? '.' : ev.key}`; if (next.length <= 4) { buffer = next; paint(active); } return; }
    if (ev.key === 'Backspace' && buffer !== null) { ev.preventDefault(); buffer = buffer.slice(0, -1); paint(active); return; }
    // 2.0 격자: 글자가 없을 때 Delete·Backspace = 그 칸 지우기 저장(빈 칸이어도 서버가 지우기 줄을 남긴다).
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && buffer === null) { ev.preventDefault(); if (cellOf(active)?.cell) save(active, { status: null }); }
  });
  function rerenderToolbar() {
    const root = document.querySelector(SEL); const tb = root?.querySelector('.at-toolbar'); if (!tb || !model) return;
    const tmp = document.createElement('div'); tmp.innerHTML = toolbar(model); tb.replaceWith(tmp.firstElementChild);
  }
  document.addEventListener('change', ev => {
    const t = ev.target.closest?.(`${SEL} [data-at]`); if (!t) return;
    const k = t.dataset.at;
    if (k === 'set') go({ [t.dataset.k]: t.value });
    else if (k === 'view') go(t.value === 'teacher' ? { mode: 'teacher', class: '' } : { mode: 'class' });
    else if (k === 'col') { if (t.checked) hiddenCols.delete(t.dataset.v); else hiddenCols.add(t.dataset.v); redrawRegion(); }
    else if (k === 'actor') { actorId = t.value; try { localStorage.setItem('v2-attendance-actor', t.value); } catch { /* 이 창에서만 기억 */ } }
  });
  document.addEventListener('input', ev => {
    const t = ev.target.closest?.(`${SEL} [data-at="search"]`); if (!t) return;
    query = t.value; const root = document.querySelector(SEL), r = root?.querySelector('[data-at-region]'); if (!r) return;
    r.innerHTML = region(model); const st = root.querySelector('[data-at-stats]'); if (st) st.innerHTML = stats(model);
    const sc = root.querySelector('[data-at-search-chip]'); if (sc) sc.innerHTML = searchChip(model); after();
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { hideCard(); document.querySelectorAll(`${SEL} .at-cols-menu`).forEach(m => { m.hidden = true; }); } });
})();
