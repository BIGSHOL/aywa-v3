/* 2.0 화면 · 강사 시트 · 영어(ECS) (V2-SCREENS.md, v2-screen-ecs.mjs). 2.0 `/ecs`의 반 목록(담임별) · 반 주간 시트 ·
   월간(달력 ↔ 진도표, EiE는 계획(MP)) · 오늘 면을 2.0 배치·라벨·글씨 서식 그대로, 로컬 Docker 복사본 위에 그린다.
   문구는 서버가 내려준 2.0 사전 값(`t`)만 쓴다. 2단계(원장 2026-10-28 "연습용이므로 모두 docker"): 서버가 저장 가능하다고 알리면
   2.0이 그 자리에서 저장하는 것(계획 칸·줄 추가/삭제·내용 복사·학생 기록·출결·목표·메모·Shouting·계획(MP) 칸)을 같은 자리에서
   고른 사람 이름으로 Docker 복사본에 저장한다(칸을 떠날 때 한 번). 저장 전 입력은 칸마다 기억해 다시 그려도 사라지지 않는다.
   보기 상태(면·반·주·요일·필터·JJ 표시)는 주소(#v2-ecs?…)에, 접기·계획 패널·글씨 크기는 이 탭 안에만 둔다. */
(() => {
  'use strict';
  const S = window.V2Screens; if (!S) return;
  const h = S.esc, READONLY = '복사본 보기 전용 — 이 화면에서는 입력·저장이 되지 않습니다.', NOT_HERE = '이 연습 화면에는 아직 없는 기능입니다.';
  let last = null, T = {}, W = false, D = null, saving = false;
  const drafts = new Map(); // 칸 id → { v: 입력값, saved } — 다시 그려도 유지, 저장된 것은 새 자료가 도착하면 지운다
  const t = k => T[k] ?? k;
  const tf = (k, p) => Object.entries(p).reduce((s, [a, b]) => s.split(`{${a}}`).join(String(b)), t(k));
  const ui = { collapsed: new Set(), panel: true, font: 'sm', role: 'homeroom', folded: false, display: null };
  const KEEP = ['jj', 'as'];
  const href = p => { const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(); return `#v2-ecs${qs ? `?${qs}` : ''}`; };
  const keep = q => Object.fromEntries(KEEP.map(k => [k, q.get(k) || '']));
  const off = (label, cls = '', title = W ? NOT_HERE : READONLY) => `<button type="button" class="ec-chip ${cls}" disabled title="${h(title)}">${h(label)}</button>`;
  const enc = o => h(JSON.stringify(o));
  /** 저장 칸 — W(저장 가능)면 입력, 아니면 읽기 전용. 값은 저장 전 입력이 있으면 그것. data-ec-act = 저장 동작, data-p = 그 칸의 저장 재료. */
  const box = (act, payload, value, { cls = 'ec-input', aria = '', title = '', area = false, ro = false, rows = 3, placeholder = '' } = {}) => {
    const id = `${act}|${JSON.stringify(payload)}`, d = drafts.get(id), v = d ? d.v : (value ?? '');
    const live = W && !ro, attrs = `class="${cls}" ${live ? `data-ec-act="${act}" data-p="${enc(payload)}" data-fid="${h(id)}"` : 'readonly'} aria-label="${h(aria)}"${title ? ` title="${h(title)}"` : ''}${placeholder ? ` placeholder="${h(placeholder)}"` : ''}`;
    return area ? `<textarea ${attrs} rows="${rows}">${h(v)}</textarea>` : `<input ${attrs} value="${h(v)}">`;
  };
  const btn = (act, payload, label, { cls = 'ec-chip small', title = '', confirm = '' } = {}) => `<button type="button" class="${cls}" data-ec-btn="${act}" data-p="${enc(payload)}"${confirm ? ` data-confirm="${h(confirm)}"` : ''}${title ? ` title="${h(title)}"` : ''} ${saving ? 'disabled' : ''}>${label}</button>`;
  const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const slash = d => d.slice(5).replace('-', '/');

  // ── 공통 머리 — 2.0 PageHeader 한 줄(eyebrow - 제목 - 설명) + 사이드바 하부탭(영어 · 수학) ──
  const head = (eyebrow, title, desc) => `<nav class="ec-subtabs" aria-label="강사 시트"><a class="on" aria-current="page" href="${href({})}">영어</a><span class="ec-subtab-off" title="수학 강사 시트(MCS)는 이 연습 화면에 아직 없습니다.">수학</span></nav>
    <div class="ec-pagehead"><span class="ec-eyebrow">${h(eyebrow)}</span><h1>${h(title)}</h1>${desc ? `<span class="ec-desc">${h(desc)}</span>` : ''}<span class="v2s-badge">${W ? '2.0 화면 · 연습 복사본' : '2.0 화면 · 복사본 보기 전용'}</span></div>
    ${W ? `<p class="v2s-note ec-copynote">${h(last?.copyNote || '')}</p><div class="ec-bar ec-actorbar"><label class="ec-pick"><span class="micro">저장하는 사람</span><select data-ec="actor" aria-label="저장하는 사람">${(D?.actors || []).map(a => `<option value="${h(a.id)}" ${a.id === actorId() ? 'selected' : ''}>${h(a.name)}${a.role === 'teacher' ? '' : ` · ${h(ROLE[a.role] || '')}`}</option>`).join('')}</select></label><span class="ec-dim small">고른 사람 이름으로 저장하고 감사로그에 남깁니다 — 실제 발송은 없습니다.</span></div>` : ''}`;
  const ROLE = { master: '원장', admin: '관리자', manager: '매니저' };
  /** 저장하는 사람 — 주소의 as, 없으면 그 반 담임(재직 중), 없으면 첫 원장. */
  function actorId() {
    const as = last?.query?.get('as'), list = D?.actors || [];
    if (as && list.some(a => a.id === as)) return as;
    const homeroom = D?.sheet?.teacherId || D?.month?.teacherId || D?.today?.teacher?.id;
    return (list.find(a => a.id === homeroom) || list.find(a => a.role === 'master' && !a.platform) || list.find(a => !a.platform) || list[0])?.id || '';
  }
  /** 2.0 PeriodNav — `‹ 라벨 ›` 한 덩어리, 라벨을 누르면 이번 기간, 과거·미래면 배지와 칠한 화살표. */
  function periodNav({ label, prev, next, current, relation, prevAria, nextAria, currentTitle }) {
    const badge = relation === 'past' ? ['과거 조회', 'past'] : relation === 'future' ? ['미래 조회', 'future'] : null;
    return `<span class="ec-period"><span class="ec-period-box"><a class="ec-arrow ${relation === 'past' ? 'lit' : ''}" href="${h(prev)}" aria-label="${h(prevAria)}">‹</a>
      <a class="ec-period-label num" href="${h(current)}" ${relation === 'current' ? 'aria-current="true"' : `title="${h(currentTitle)}"`}>${h(label)}</a>
      <a class="ec-arrow ${relation === 'future' ? 'lit' : ''}" href="${h(next)}" aria-label="${h(nextAria)}">›</a></span>${badge ? `<span class="ec-rel ${badge[1]}">${badge[0]}</span>` : ''}</span>`;
  }
  const shiftDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const mondayOf = d => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return shiftDay(d, w === 0 ? -6 : 1 - w); };
  const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number), x = new Date(Date.UTC(y, mo - 1 + n, 1)); return x.toISOString().slice(0, 7); };
  /** 2.0 EcsFaceTabs — 보기: 오늘 | 담임별 | JJ실. 3.0은 선생님을 골라 '오늘'을 본다. JJ실(자리 하루)은 아직 없다. */
  const faceTabs = (face, q) => `<span class="ec-seg" role="group" aria-label="${h(t('nav.face'))}"><span class="ec-seg-label">${h(t('nav.face'))}</span>
    <a class="ec-seg-item ${face === 'today' ? 'on' : ''}" href="${href({ view: 'today', ...keep(q) })}" ${face === 'today' ? 'aria-current="page"' : ''}>${h(t('nav.face.today'))}</a>
    <a class="ec-seg-item ${face === 'week' ? 'on' : ''}" href="${href({ view: 'list', ...keep(q) })}" ${face === 'week' ? 'aria-current="page"' : ''}>${h(t('nav.face.week'))}</a>
    <button type="button" class="ec-seg-item" disabled title="${h(`${t('nav.face.room.title')} — ${NOT_HERE}`)}">${h(t('nav.face.room'))}</button></span>`;

  // ── 반 목록(담임별) — 2.0 ecs/page.tsx 주간 면 + landing-list.tsx ──
  function listView(d, q) {
    const L = d.list, nav = p => ({ view: 'list', track: q.get('track'), teacher: q.get('teacher'), ...keep(q), ...p });
    const trackChips = L.eieOn ? `<span class="ec-seg" title="${h(t('filter.program.title'))}"><span class="ec-seg-label">${h(t('filter.program'))}</span>${['all', 'eie', 'injaewon'].map(f => `<a class="ec-seg-item ${L.trackFilter === f ? 'on' : ''}" href="${href(nav({ track: f === 'all' ? '' : f, teacher: '' }))}" aria-pressed="${L.trackFilter === f}">${h(f === 'all' ? t('filter.all') : d.tracks[f])}<span class="num ec-count">${L.trackCounts[f]}</span></a>`).join('')}</span>` : '';
    const teacherPick = L.teacherOptions.length >= 2 ? `<label class="ec-pick" title="${h(t('filter.homeroom.title'))}"><span class="micro">${h(t('filter.homeroom'))}</span><select data-ec="nav" aria-label="${h(t('filter.homeroom.aria'))}">${[{ value: 'all', label: t('filter.all'), count: L.trackCounts[L.trackFilter] }, ...L.teacherOptions].map(o => `<option value="${h(href(nav({ teacher: o.value === 'all' ? '' : o.value })))}" ${L.teacherFilter === o.value ? 'selected' : ''}>${h(o.label)} (${o.count})</option>`).join('')}</select></label>` : '';
    const bar = `<div class="ec-bar">${faceTabs('week', q)}${periodNav({ label: L.weekLabel, prev: href(nav({ week: shiftDay(L.weekMonday, -7) })), next: href(nav({ week: shiftDay(L.weekMonday, 7) })), current: href(nav({ week: '' })), relation: L.weekRelation, prevAria: t('toolbar.prevWeek'), nextAria: t('toolbar.nextWeek'), currentTitle: t('toolbar.thisWeek') })}
      ${trackChips}${teacherPick}<span class="ec-end">${L.trackCounts.injaewon > 0 ? off(t('goals.title'), '', NOT_HERE) : ''}${L.textbooksOn ? off(t('gap.title'), '', NOT_HERE) : ''}</span></div>`;
    let body;
    if (!L.cardCount) {
      const why = L.emptyReason === 'filtered' ? `${t('landing.empty.filtered.prefix')} '${L.trackFilter === 'all' ? t('filter.all') : d.tracks[L.trackFilter]}'${t('landing.empty.filtered.suffix')}${L.trackCounts.all}${t('landing.empty.filtered.tail')}`
        : L.emptyReason === 'no-week-classes' ? t('landing.empty.noWeekClasses') : L.emptyReason === 'not-configured' ? t('landing.empty.notConfigured') : t('landing.empty.none');
      body = `<p class="ec-empty">${h(why)}</p>`;
    } else if (L.panels) {
      body = `<section class="ec-landing"><div class="ec-panels">${L.panels.map(p => `<section class="ec-panel ${p.key}"><div class="ec-panel-head"><h3 class="ec-program">${h(p.label)}</h3></div>${groupFlow(p.groups, L, q, 'panel')}</section>`).join('')}</div></section>`;
    } else body = `<section class="ec-landing">${groupFlow(L.groups, L, q, 'full')}</section>`;
    return `${head(t('landing.eyebrow'), t('landing.title'), `${t('landing.desc')} · ${L.weekLabel}`)}${W ? '' : `<p class="v2s-note">${h(READONLY)}</p>`}${bar}${body}`;
  }
  function groupFlow(groups, L, q, kind) {
    return `<div class="ec-flow ${kind}">${groups.map(g => `<section class="ec-group"><div class="ec-group-head"><h4 class="${g.unassigned ? 'unassigned' : ''}">${h(g.label)}</h4>
      <span class="num ec-dim">${h(tf('landing.group.nClasses', { n: g.classes }))}</span><span class="ec-coltitles">${g.showShouting ? `<span class="w52">${h(t('landing.col.shouting'))}</span>` : ''}<span class="w92">${h(t('landing.col.rate'))}</span><span class="ec-ghost" aria-hidden="true">${h(t('face.cal'))}</span></span></div>
      <ul class="ec-rows">${g.cards.map(c => cardRow(c, g, L, q)).join('')}</ul></section>`).join('')}</div>`;
  }
  function cardRow(c, g, L, q) {
    const idle = c.totalSlots === 0, holidayOnly = idle && c.holidaySlots > 0, idleTitle = t(holidayOnly ? 'landing.idle.holiday' : 'landing.idle.none');
    const note = c.upcoming ? tf('landing.rename.note', { date: c.upcoming.date, from: c.className, to: c.upcoming.name }) : null;
    const shout = g.showShouting ? `<span class="w52">${c.shout !== null && !idle ? `<span class="ec-pill num ${c.shout === c.totalSlots ? 'pos' : c.shout > 0 ? '' : 'faint'}" title="${h(tf('landing.shouting.title', { n: c.shout, total: c.totalSlots }))}">${c.shout}/${c.totalSlots}</span>` : ''}</span>` : '';
    return `<li class="ec-row"><a class="ec-row-link" href="${href({ view: 'sheet', class: c.classId, week: L.weekMonday, ...keep(q) })}">
      <span class="ec-row-name">${h(c.className)}</span>${c.upcoming ? `<span class="ec-amber" title="${h(note)}">${h(c.upcoming.date)}→${h(c.upcoming.name)}</span>` : ''}${shout}
      ${idle ? `<span class="ec-rate dim" title="${h(idleTitle)}">${holidayOnly ? h(t('landing.holidayMark')) : '—'}</span>` : `<span class="ec-rate num">${c.filledSlots}/${c.totalSlots}</span>`}
      <span class="ec-bar-track"><i style="width:${Number(c.pct) || 0}%"></i></span></a>
      <a class="ec-cal-link" href="${href({ view: 'month', class: c.classId, month: monthOfWeek(L.weekMonday), week: L.weekMonday, mv: c.calFace, ...keep(q) })}" title="${h(tf('landing.calendarLink', { name: c.className }))}">${h(t(c.calFace === 'mp' ? 'face.mp' : 'face.cal'))}</a></li>`;
  }
  /** 2.0 face-nav monthOfWeek — 그 주 목요일(주의 과반)이 속한 달. */
  const monthOfWeek = mon => shiftDay(mon, 3).slice(0, 7);

  // ── 시트 머리줄 — 2.0 SheetClassPicker(목록 · 반 선택 · 담임) + 기간 + 면 전환 ──
  function classPicker(d, cls, q, hrefFor) {
    return `<span class="ec-classpick"><a class="ec-chip" href="${href({ view: 'list', week: q.get('week'), ...keep(q) })}" aria-label="${h(t('chrome.list.aria'))}">${h(t('chrome.list'))}</a>
      <label class="ec-class"><select data-ec="nav" aria-label="${h(t('chrome.classAria'))}">${d.classOptions.map(o => `<option value="${h(hrefFor(o.id))}" ${o.id === cls.classId ? 'selected' : ''}>${h(o.name)}</option>`).join('')}</select>
      ${cls.teacherName ? `<span class="ec-class-teacher">${h(t('chrome.homeroom'))} ${h(cls.teacherName)}</span>` : ''}</label>${off(t('chrome.classInfo'), 'ghost', NOT_HERE)}</span>`;
  }
  const faceSwitch = (current, isEie, hrefOf) => `<span class="ec-seg" role="group">${(isEie ? ['week', 'mp'] : ['week', 'cal', 'rail']).map(f => `<a class="ec-seg-item ${current === f ? 'on' : ''}" href="${h(hrefOf(f))}" title="${h(last?.faceTitle?.[f] || '')}" ${current === f ? 'aria-current="page"' : ''}>${h(t(`face.${f}`))}</a>`).join('')}</span>`;
  const divider = '<span class="ec-divider" aria-hidden="true"></span>';
  const fontPick = d => `<label class="ec-pick"><span class="micro">${h(t('toolbar.font'))}</span><select data-ec="font" aria-label="${h(t('toolbar.font.title'))}">${d.fonts.map(f => `<option value="${h(f.key)}" ${ui.font === f.key ? 'selected' : ''}>${h(t(f.labelKey))}</option>`).join('')}</select></label>`;
  const zoomStyle = d => { const z = d.fonts.find(f => f.key === ui.font)?.zoom ?? 1; return z === 1 ? '' : ` style="zoom:${z}"`; };

  /** 2.0 SheetWidthGate — 하루 한 칸도 안 들어가는 폭(480px 미만, 마우스 기기)에선 시트 대신 넓혀 달라는 안내. 터치는 그대로. */
  const widthGate = (inner, q) => `<div class="ec-widthgate">${inner}</div><div class="ec-toonarrow"><div class="ec-card ec-narrowcard"><p class="ec-narrowtitle">창이 너무 좁습니다</p>
    <p>영어 강사 시트는 하루치 수업 한 칸이 다 들어와야 쓸 수 있습니다. 창을 넓히거나, 화면 배율을 크게 해 둔 상태라면 배율을 낮춰 주세요.</p><p class="ec-faint small">최소 <span class="num">480px</span></p>
    <a class="ec-link" href="${href({ view: 'list', ...keep(q) })}">반 목록으로</a></div></div>`;

  // ── 반 주간 시트 — 2.0 sheet-client.tsx(full) · sheet-toolbar · plan-panel · sheet-grid · period-block · plan-table · roster-table ──
  function sheetView(d, q) {
    const s = d.sheet, dayFilter = q.get('day') && s.grid.days.some(x => x.date === q.get('day')) ? q.get('day') : null;
    const nav = p => ({ view: 'sheet', class: s.classId, week: s.weekMonday, ...keep(q), ...p });
    const desc = [s.weekLabel, `계획 ${s.fill.filledSlots}/${s.fill.totalSlots}교시`, s.classNameUpcoming ? `${s.classNameUpcoming.date}부터 ${s.className} → ${s.classNameUpcoming.name}` : null].filter(Boolean).join(' · ');
    const bar = `<div class="ec-bar">${classPicker(d, { classId: s.classId, teacherName: s.classTeacherName }, q, id => href({ view: 'sheet', class: id, week: s.weekMonday, ...keep(q) }))}${divider}
      ${periodNav({ label: s.weekLabel, prev: href(nav({ week: shiftDay(s.weekMonday, -7), day: '' })), next: href(nav({ week: shiftDay(s.weekMonday, 7), day: '' })), current: href(nav({ week: mondayOf(s.today), day: '' })), relation: s.weekRelation, prevAria: t('toolbar.prevWeek'), nextAria: t('toolbar.nextWeek'), currentTitle: t('toolbar.thisWeek') })}
      ${faceSwitch('week', s.isEie, f => (f === 'week' ? href(nav({})) : href({ view: 'month', class: s.classId, month: monthOfWeek(s.weekMonday), week: s.weekMonday, mv: f, ...keep(q) })))}${divider}
      <label class="ec-pick"><span class="micro">${h(t('toolbar.dow'))}</span><select data-ec="nav" aria-label="${h(t('toolbar.dow.aria'))}"><option value="${h(href(nav({ day: '' })))}">${h(t('toolbar.all'))}</option>${s.grid.days.map(x => `<option value="${h(href(nav({ day: x.date })))}" ${dayFilter === x.date ? 'selected' : ''}>${h(`${x.dowLabel} ${md(x.date)}`)}${x.holiday || x.isToday ? ` · ${h([x.holiday, x.isToday ? t('toolbar.today') : null].filter(Boolean).join(' · '))}` : ''}</option>`).join('')}</select></label>
      <span class="ec-end">${off(t('toolbar.attendance'), '', `${t('toolbar.attendance.title')} — 출석부는 '2.0 화면'의 출석부에서 봅니다.`)}
        <span class="ec-seg" title="${h(t('toolbar.jj.title'))}"><span class="ec-seg-label">${h(t('toolbar.jj'))}</span>${[['1', 'toolbar.show'], ['0', 'toolbar.hide']].map(([v, k]) => `<a class="ec-seg-item ${(q.get('jj') || '1') === v ? 'on' : ''}" href="${href({ ...nav({}), jj: v === '1' ? '' : '0' })}" aria-pressed="${(q.get('jj') || '1') === v}">${h(t(k))}</a>`).join('')}</span>
        ${fontPick(d)}<span class="ec-status">${h(W ? (saving ? t('toolbar.saving') : t('toolbar.saved')) : READONLY.split(' — ')[0])}</span><button type="button" class="ec-chip ${ui.panel ? 'on' : ''}" data-ec="panel" aria-pressed="${ui.panel}">${h(t('toolbar.planPanel'))}</button></span></div>`;
    const days = dayFilter ? s.grid.days.filter(x => x.date === dayFilter) : s.grid.days;
    const grid = sheetGrid(s, days, dayFilter ? s.grid.days.findIndex(x => x.date === dayFilter) : null);
    const notes = `${s.attendanceOnly.length ? `<div class="ec-card ec-foot"><p>수업 시간표가 없는 날짜의 출석 기록: ${h(s.attendanceOnly.map(a => `${a.date} (${a.names.join(', ')})`).join(' · '))}</p></div>` : ''}
      ${s.hiddenSpecial.map(x => `<p class="ec-footnote">${h(x.seat)} 교시 ${x.slots}개는 이 시트에 표시하지 않습니다(이번 주 기준) — 그 시간에 남아 있는 기록 ${x.records}건은 지워지지 않았습니다${x.seat === 'JJ' ? '(상단 ‘JJ 표시’로 다시 볼 수 있습니다).' : '(LAB 전용 출석부가 열리면 그쪽에서 볼 수 있습니다).'}</p>`).join('')}
      ${s.splitRows ? `<p class="ec-footnote">이 주에 이 반이 걸린 수업 나누기가 ${s.splitRows}건 있습니다 — 2.0이 그 기능을 꺼 둬서 이 화면에도 표식을 그리지 않습니다.</p>` : ''}`;
    return `${head('수업 운영', `영어 강사 시트 — ${s.className}`, desc)}${bar}
      ${widthGate(`<div class="ec-body"${zoomStyle(d)}>${ui.panel ? planPanel(s) : ''}<div class="ec-gridscroll live-scroll" data-scroll-key="ecs-grid">${grid}</div></div>${notes}`, q)}`;
  }
  /** 2.0 plan-panel.tsx — 담임/부담임 × 월간/주간 목표(영역 × 교재명·목표 진도) + 주간 메모. */
  function planPanel(s) {
    const SECTIONS = [['homeroom', 'month', 'plan.panel.homeroom.month'], ['homeroom', 'week', 'plan.panel.homeroom.week'], ['assistant', 'month', 'plan.panel.assistant.month'], ['assistant', 'week', 'plan.panel.assistant.week']];
    const goalOf = (scope, role, area) => s.goals.find(g => g.scope === scope && g.role === role && g.skillArea === area && g.periodStart === (scope === 'month' ? s.monthStart : s.weekMonday));
    return `<aside class="ec-panelbox live-scroll">${SECTIONS.map(([role, scope, title], i) => `<details class="ec-goals" ${i === 0 ? 'open' : ''}><summary><span class="ec-chev" aria-hidden="true">›</span><span class="ec-goal-title">${h(t(title))}</span><span class="num ec-goal-when">${scope === 'month' ? h(s.monthStart.slice(0, 7)) : h(t('plan.panel.thisWeek'))}</span></summary>
      <div class="ec-goal-grid"><div class="ec-goal-headrow"><span></span><span>${h(t('month.goal.book'))}</span><span>${h(t('plan.panel.progress'))}</span></div>${s.goalAreas.map(a => { const g = goalOf(scope, role, a.key);
        return `<div class="ec-goal-row"><span class="ec-area tone-${h(a.tone)}" title="${h(a.label)}">${h(a.label)}</span>${goalBox(s.classId, scope, scope === 'month' ? s.monthStart : s.weekMonday, role, a.key, 'textbook', g?.textbook, `${t(title)} ${a.label} ${t('month.goal.book')}`)}${goalBox(s.classId, scope, scope === 'month' ? s.monthStart : s.weekMonday, role, a.key, 'targetProgress', g?.targetProgress, `${t(title)} ${a.label} ${t('plan.panel.progress')}`)}</div>`; }).join('')}</div></details>`).join('')}
      <div class="ec-memo"><span>${h(t('plan.panel.memo'))}</span>${box('memo', { classId: s.classId, weekStart: s.weekMonday, memoKey: 'panel' }, s.memos.panel ?? '', { area: true, aria: t('plan.panel.memo'), ro: s.memoMasked?.panel, title: s.memoMasked?.panel ? MASKED : '' })}</div></aside>`;
  }
  const MASKED = '연락처가 가려진 글이라 이 화면에서는 고치지 않습니다 — 2.0에서 고쳐 주세요.';
  const goalBox = (classId, scope, periodStart, role, skillArea, field, value, aria, placeholder = '') => box('goal', { classId, scope, periodStart, role, skillArea, field }, value ?? '', { aria, placeholder });
  /** 2.0 sheet-grid.tsx — 요일 열 하나의 CSS grid, 머리는 sticky 밴드, 행 = 각 요일 N번째 수업(서수 배치), 카드 속살은 subgrid로 줄맞춤. */
  function sheetGrid(s, days, onlyIndex) {
    if (!days.length) return '<p class="ec-empty">이 주에는 수업이 없습니다.</p>';
    const cols = days.length, rows = onlyIndex === null ? s.grid.rows : s.grid.rows.map(r => [r[onlyIndex]]).filter(r => r[0] >= 0);
    const band = days.map(day => `<header class="ec-dayhead ${day.holiday ? 'holiday' : ''}"><span class="ec-dow ${day.isToday ? 'today' : ''}">${h(day.dowLabel)}</span><span class="num ec-daydate">${h(slash(day.date))}</span>
      ${day.isToday ? `<span class="ec-todaybadge">${h(t('toolbar.today'))}</span>` : ''}${day.holiday ? `<span class="ec-holiname" title="${h(tf('plan.holidayHint', { holiday: day.holiday }))}">${h(day.holiday)}</span>` : ''}</header>`).join('');
    const body = rows.map((row, ri) => row.map((si, ci) => (si >= 0 ? `<div class="ec-cell" style="grid-column:${ci + 1};grid-row:${ri * 4 + 1} / span 3">${periodBlock(s, days[ci], days[ci].slots[si])}</div>` : '')).join('')).join('');
    return `<div class="ec-week" style="--cols:${cols}"><div class="ec-band">${band}</div><div class="ec-rows-grid" style="grid-template-rows:repeat(${rows.length}, auto auto auto 8px)">${body}</div></div>`;
  }
  /** 2.0 period-block.tsx — 머리(교시·시각·강사·강의실·Shouting) / 수업계획 표 / 학생 로스터. */
  function periodBlock(s, day, slot, opt = {}) {
    const teacher = slot.teacherLabel ?? (slot.teacherId ? s.teacherNames[slot.teacherId] ?? null : null) ?? s.classTeacherName;
    const shouted = !!s.shouting[`${day.date}|${slot.slotStart}`];
    const shout = s.isEie ? `<label class="ec-shout ${shouted ? 'on' : ''}" title="${h(t('plan.shouting.title'))}"><input type="checkbox" ${W && slot.scheduled && !saving ? `data-ec-check="shouting" data-p="${enc({ classId: s.classId, date: day.date, slotStart: slot.slotStart })}"` : 'disabled'} ${shouted ? 'checked' : ''}><span>${h(t('landing.col.shouting'))}</span></label>` : '';
    return `<article class="ec-block${opt.flat ? ' flat' : ''}"><header class="ec-blockhead">${slot.periodLabel ? `<span class="ec-periodchip">${h(slot.periodLabel)}</span>` : ''}<span class="num ec-time">${h(slot.slotStart)}${slot.slotEnd ? ` ~ ${h(slot.slotEnd)}` : ''}</span>
      ${teacher ? `<span class="ec-teacher">${h(teacher)}</span>` : ''}${slot.roomLabel ? `<span class="ec-room">${h(slot.roomLabel)}</span>` : ''}${shout ? `<span class="ec-headend">${shout}</span>` : ''}</header>
      ${planTable(s, slot, day.date)}${opt.roster === false ? '' : slot.rosterCount ? rosterTable(s, day, slot) : '<div></div>'}</article>`;
  }
  /** 2.0 plan-table.tsx — 평시 / 내신(EiE는 내신 없음 — 저장된 줄이 있으면 보인다) 구획, 구분·교재·페이지/시간·진도·과제. 저장 가능하면 줄 추가 · 내용 복사 · 줄 삭제. */
  function planTable(s, slot, date) {
    const area = k => s.skillAreas.find(a => a.key === k), terms = [['regular', 'plan.term.regular', 'reg'], ['exam', 'plan.term.exam', 'exam']], edit = W && slot.scheduled;
    const FIELD = { textbook: ['textbook', 'fill.book'], pageRange: ['page_range', 'plan.col.pageTime'], progress: ['progress', 'plan.col.progress'], homework: ['homework', 'plan.col.homework'] };
    return `<div class="ec-plan">${terms.map(([key, label, tone]) => {
      const rows = slot.lines.filter(l => l.termMode === key), termLabel = t(label);
      if (!rows.length && key === 'exam' && (s.isEie || !edit)) return ''; // 2.0: EiE는 내신 구획 없음 · 편집 권한이 없으면 빈 내신 구획을 안 그린다
      const tools = edit ? `${btn('planAdd', { classId: s.classId, planDate: date, slotStart: slot.slotStart, termMode: key, skillArea: s.skillAreas[0]?.key ?? 'vocab' }, h(t('plan.addRow')))}${btn('planCopy', { classId: s.classId, planDate: date, slotStart: slot.slotStart, termMode: key }, h(t('plan.copy')), { title: tf('plan.copy.title', { term: termLabel }) })}` : '';
      return `<div class="ec-term"><div class="ec-termhead"><span class="ec-termchip ${tone}">${h(termLabel)}</span>${tools}</div>${rows.length ? `<table class="ec-plantable"><colgroup><col style="width:100px"><col style="width:106px"><col style="width:64px"><col><col><col style="width:22px"></colgroup>
        <thead><tr><th>${h(t('plan.col.kind'))}</th><th>${h(t('plan.col.book'))}</th><th title="${h(t('plan.col.pageTime.title'))}">${h(t('plan.col.pageTime'))}</th><th>${h(t('plan.col.progress'))}</th><th>${h(t('plan.col.homework'))}</th><th aria-hidden="true"></th></tr></thead>
        <tbody>${rows.map(l => { const a = area(l.skillArea), base = { classId: s.classId, lineId: l.id };
          const kind = edit ? `<select class="ec-area tone-${h(a?.tone ?? 'neutral')}" data-ec-act="planCell" data-p="${enc({ ...base, field: 'skill_area', expected: l.skillArea })}" aria-label="${h(t('plan.areaAria'))}">${a ? '' : `<option value="">${h(l.skillArea)} (${h(t('plan.unknownArea'))})</option>`}${s.skillAreas.map(x => `<option value="${h(x.key)}" ${x.key === l.skillArea ? 'selected' : ''}>${h(x.label)}</option>`).join('')}</select>`
            : `<span class="ec-area tone-${h(a?.tone ?? 'neutral')}">${h(a?.label ?? l.skillArea)}</span>`;
          const has = [l.textbook, l.pageRange, l.progress, l.homework].some(v => (v ?? '').trim() !== '');
          return `<tr data-skill-area="${h(l.skillArea)}"><td>${kind}</td>${Object.entries(FIELD).map(([f, [col, aria]]) => `<td>${edit ? box('planCell', { ...base, field: col, expected: l[f] ?? null }, l[f] ?? '', { aria: t(aria) }) : `<input class="ec-input" readonly value="${h(l[f] ?? '')}" aria-label="${h(t(aria))}">`}</td>`).join('')}
            <td>${edit ? btn('planDelete', base, '×', { cls: 'ec-x', title: t('plan.deleteRow'), confirm: has ? t('plan.deleteConfirm') : '' }) : ''}</td></tr>`; }).join('')}</tbody></table>`
        : key === 'regular' ? `<p class="ec-planempty">${h(t('plan.empty'))}</p>` : ''}</div>`;
    }).join('')}</div>`;
  }
  /** 2.0 roster-table.tsx + roster-slot-cells.tsx(읽기 모양) — 재원 · 보강 · 종강 · 퇴원 · 기록 묶음, 출결·유닛·태도·자유 입력·특이사항. */
  function rosterTable(s, day, slot) {
    const cols = slot.textCols, span = 5 + cols.length, nameW = slot.form === 'selfStudy' ? '15%' : '116px';
    const count = Object.fromEntries(slot.groups.map(g => [g.key, g.rows.length]));
    const toggle = groupToggle;
    const body = slot.groups.map(g => {
      const label = g.label ? `<tr class="ec-glabel"><td colspan="${span}" title="${h(t(`roster.group.${g.key}.hint`))}">${toggle(g.key, g.rows.length)}</td></tr>` : '';
      if (ui.collapsed.has(g.key)) return label;
      return label + g.rows.map(r => (g.key === 'withdrawn' || g.key === 'classEnded' ? withdrawnRow(r, span) : `<tr class="${r.historical ? 'ec-hist' : ''}">${nameCell(r)}${slotCells(r, cols, false, { classId: s.classId, date: day.date, slotStart: slot.slotStart })}</tr>`)).join('');
    }).join('');
    return `<div class="ec-roster"><table class="ec-rostertable"><colgroup><col style="width:${nameW}"><col style="width:60px"><col style="width:40px"><col style="width:83px">${cols.map(c => `<col style="width:${c.width}px">`).join('')}<col></colgroup>
      <thead><tr><th>${toggle('active', count.active ?? 0)}</th><th class="c">${h(t('roster.col.attendance'))}</th><th class="c" title="${h(t('roster.col.unit.title'))}">${h(t('roster.col.unit'))}</th><th class="c">${h(t('roster.col.attitude'))}</th>${cols.map(c => `<th class="c" title="${h(t(c.titleKey))}">${h(t(c.labelKey))}</th>`).join('')}<th class="c"><span class="clamp2">${h(t('roster.col.note'))}</span></th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }
  const groupToggle = (key, n) => `<button type="button" class="ec-gtoggle" data-ec="group" data-k="${h(key)}" aria-expanded="${!ui.collapsed.has(key)}" title="${h(`${tf('roster.group.listAria', { name: t(`roster.group.${key}`) })} ${t(ui.collapsed.has(key) ? 'common.expand' : 'common.collapse')}`)}"><span class="ec-chev ${ui.collapsed.has(key) ? '' : 'open'}" aria-hidden="true">›</span><span>${h(t(`roster.group.${key}`))}</span><span class="num">${n}</span></button>`;
  const withdrawnRow = (r, span) => `<tr class="ec-hist"><td colspan="${span}"><span class="ec-wname" title="${h(`${r.name} · ${tf('roster.endedTitle', { date: r.endedOn ?? '' })}${r.reason ? ` · ${r.reason}` : ''}`)}">${h(r.name)}</span>${r.summary ? `<span class="ec-dim">${h(r.summary)}</span>` : ''}${r.kept ? `<span class="ec-dim ec-kept" title="${h(r.kept)}">· ${h(r.kept)}</span>` : ''}</td></tr>`;
  /** 한 교시분 칸 — 출결 · 유닛 · 태도 · 폼별 자유 입력 · 특이사항(2.0 RosterSlotCells 읽기 모양). edge = 오늘 면 교시 경계선. */
  const slotCells = (r, cols, edge, ctx) => {
    const editable = W && ctx && (r.eligible || r.isMakeup), base = ctx ? { classId: ctx.classId, studentId: r.studentId, date: ctx.date, slotStart: ctx.slotStart } : null;
    const attitude = editable ? btn('mark', { ...base, field: 'status', value: nextCycle(r.attitude, D.attitudes) }, h(r.attitudeLabel ?? r.attitude ?? t('select.choose')), { cls: `ec-box ec-cycle ${r.attitude === null ? 'faint' : r.attitudeKnown ? '' : 'dim'}`, title: r.attitude === null || r.attitudeKnown ? tf('roster.attitude.cycle', { scale: D.attitudes.join(' → ') }) : tf('roster.attitude.legacy', { value: r.attitude, first: D.attitudes[0] }) })
      : `<span class="ec-box ${r.attitude === null ? 'faint' : r.attitudeKnown ? '' : 'dim'}">${h(r.attitudeLabel ?? r.attitude ?? '—')}</span>`;
    const att = editable ? attButton(r, base) : attCell(r);
    return `${edge ? att.replace('<td>', '<td class="edge">') : att}${unitCell(r)}<td>${attitude}</td>${cols.map(c => `<td>${editable ? box('mark', { ...base, field: c.field }, r.texts[c.field] ?? '', { cls: 'ec-input center', aria: tf('roster.cellAria', { name: r.name, field: t(c.labelKey) }), title: t(c.titleKey) }) : `<input class="ec-input center" readonly value="${h(r.texts[c.field] ?? '')}" title="${h(t(c.titleKey))}" aria-label="${h(tf('roster.cellAria', { name: r.name, field: t(c.labelKey) }))}">`}</td>`).join('')}<td>${editable && !r.noteMasked ? box('mark', { ...base, field: 'progressNote' }, r.note, { aria: `${r.name} 특이사항` }) : `<span class="ec-note" title="${h(r.noteMasked ? MASKED : r.note)}">${h(r.note)}</span>`}</td>`;
  };
  /** 2.0 mark-cycle nextCycleValue — 매우 좋음 → … → 매우 안좋음 → 선택 안 함, 옛 표기는 첫 값으로. */
  const nextCycle = (cur, options) => { const cycle = [...options, null], i = cycle.indexOf(cur); return cycle[(i + 1) % cycle.length]; };
  /** 2.0 attendance-check — 누를 때마다 출석 → 결석 → 지각 → 선택 안 함(사유가 적힌 칸은 지우기를 건너뛰고 출석). 조퇴·공결·보강은 바꾸지 않는다. */
  function attButton(r, base) {
    const a = r.att, cur = a?.status ?? null;
    if (cur && !['present', 'late', 'absent'].includes(cur)) return attCell(r);
    let next = nextCycle(cur, D.attCycle.filter(Boolean)); if (next === null && a?.note) next = 'present';
    const tone = ATT_TONE[cur] || '', label = a ? a.label : t('select.choose');
    return `<td>${btn('attendance', { ...base, slot: a && a.status !== 'makeup' ? a.slot : base.slotStart, status: next }, `${tone ? `<i aria-hidden="true">${ATT_ICON[cur]}</i>` : ''}<span>${h(label)}</span>${a?.note ? '<b class="ec-dot" aria-hidden="true">●</b>' : ''}`, { cls: `ec-box att ec-cycle ${tone} ${a ? '' : 'faint'}`, title: a?.note ? `${a.note}` : '' })}</td>`;
  }
  const nameCell = r => `<td><div class="ec-namecell"><button type="button" class="ec-name ${r.historical ? 'dim' : ''}" data-ec="student" data-id="${h(r.studentId)}" title="${h(`${r.name}${r.schoolGrade ? ` · ${r.schoolGrade}` : ''} — ${t('studentEnglishName.detailsHint')}`)}">${h(r.name)}</button>${r.schoolGrade ? `<span class="ec-sg" title="${h(`${r.name}/${r.schoolGrade}`)}">/${h(r.schoolGrade)}</span>` : ''}${r.endedOn ? `<span class="num ec-dim">${h(r.endedOn.slice(5))}</span>` : ''}</div>${r.secondary ? `<span class="ec-secondary">${h(r.secondary)}</span>` : ''}</td>`;
  const ATT_TONE = { present: 'ok', late: 'warn', absent: 'bad' }, ATT_ICON = { present: '✓', late: '◷', absent: '×' };
  function attCell(r) {
    const a = r.att;
    if (!a) return `<td><span class="ec-box faint">—</span></td>`;
    if (a.status === 'makeup') return `<td><span class="ec-box makeup">${h(a.label)}</span></td>`;
    const tone = ATT_TONE[a.status];
    return `<td><span class="ec-box att ${tone || ''}" ${a.note ? `title="${h(a.note)}"` : ''}>${tone ? `<i aria-hidden="true">${ATT_ICON[a.status]}</i>` : ''}<span>${h(a.label)}</span>${a.note ? '<b class="ec-dot" aria-hidden="true">●</b>' : ''}</span></td>`;
  }
  const unitCell = r => `<td class="c">${r.att?.status === 'absent' ? `<span class="ec-faint" title="${h(t('roster.unitsOnAbsent'))}">—</span>` : r.att && r.att.status !== 'makeup' ? `<span class="ec-box num">${h(r.att.units ?? 1)}</span>` : '<span class="ec-faint">—</span>'}</td>`;

  // ── 월간 — 2.0 month-client.tsx · month-goal-strip · month-memo · month-calendar · month-rail · month-plan-view ──
  function monthView(d, q) {
    const m = d.month, view = m.view, nav = p => ({ view: 'month', class: m.classId, month: m.month, mv: view, period: m.isEie ? m.period.mode : '', week: q.get('week'), ...keep(q), ...p });
    const cur = (ui.display ??= JSON.parse(JSON.stringify(m.display)))[view]; ui.monthView = view;
    const bySession = m.period.mode === 'session' && m.period.kind === 'session';
    const rel = m.month === m.currentMonth ? 'current' : m.month < m.currentMonth ? 'past' : 'future';
    const toggle = (key, label, title) => `<button type="button" class="ec-chip ${cur[key] ? 'on' : ''}" data-ec="display" data-k="${h(key)}" aria-pressed="${cur[key]}" title="${h(title)}">${cur[key] ? '✓ ' : ''}${h(label)}</button>`;
    const fill = view === 'mp' ? mpBar(m) : `<span class="ec-dim small" title="${h(t('month.fill.title'))}">${h(t('bulk.plan'))} <b class="num">${m.fill.filled}/${m.fill.total}</b>${h(t('month.fill.unit'))} <span class="num">(${m.fill.pct}%)</span></span>${m.offDays ? `<span class="ec-offgoal"><i class="ec-dotbox" aria-hidden="true"></i>${h(t('month.offGoal'))} <span class="num">${h(tf('month.days', { n: m.offDays }))}</span></span>` : ''}`;
    const periodSwitch = m.isEie ? `<span class="ec-seg" role="group" aria-label="${h(t('month.period.aria'))}">${[['month', 'month.period.month'], ['session', 'month.period.session']].map(([v, k]) => `<a class="ec-seg-item ${m.period.mode === v ? 'on' : ''}" href="${href(nav({ period: v }))}">${h(t(k))}</a>`).join('')}</span>${m.sessionNote ? `<span class="ec-amber" title="${h(t('month.period.noSession.title'))}">${h(t('month.period.noSession'))}</span>` : ''}` : '';
    const bar = `<div class="ec-bar">${classPicker(d, { classId: m.classId, teacherName: m.teacherName }, q, id => href({ view: 'month', class: id, month: m.month, mv: view, period: m.isEie ? m.period.mode : '', ...keep(q) }))}${divider}
      ${periodNav({ label: m.monthLabel, prev: href(nav({ month: shiftMonth(m.month, -1), week: '' })), next: href(nav({ month: shiftMonth(m.month, 1), week: '' })), current: href(nav({ month: m.currentMonth, week: '' })), relation: rel, prevAria: t(bySession ? 'month.prevSession' : 'month.prev'), nextAria: t(bySession ? 'month.nextSession' : 'month.next'), currentTitle: t(bySession ? 'month.currentSession' : 'month.current') })}
      ${periodSwitch}${faceSwitch(view, m.isEie, f => (f === 'week' ? href({ view: 'sheet', class: m.classId, week: m.weekHref, ...keep(q) }) : href(nav({ mv: f }))))}${divider}${fill}
      <span class="ec-end">${m.textbooksOn ? off(t('fill.open'), '', `${t('fill.open.title')} — ${READONLY}`) : ''}${view === 'mp' ? `${toggle('actual', t('month.toggle.actual'), t('month.toggle.actual.title'))}${off(t('month.print'), '', NOT_HERE)}` : `${toggle('homework', t('plan.col.homework'), t('month.toggle.homework.title'))}${toggle('seat', t('month.toggle.seat'), t('month.toggle.seat.title'))}`}</span></div>`;
    const body = view === 'mp' ? mpDoc(m, cur) : view === 'cal' ? `${goalStrip(m)}${monthMemo(m)}${calendar(m, cur)}` : rail(m, cur);
    const desc = view === 'mp' ? m.monthLabel : `${m.monthLabel} · 계획 ${m.fill.filled}/${m.fill.total}교시`;
    return `${head('수업 운영', `영어 강사 시트 · 월간 — ${m.className}`, desc)}${W ? '' : `<p class="v2s-note">${h(READONLY)}</p>`}${widthGate(`${bar}<div class="ec-month"${zoomStyle(d)}>${body}</div>`, q)}`;
  }
  function goalStrip(m) {
    const role = ui.role, map = m.goals[role], strip = m.strip[role];
    const chip = (k, l) => `<button type="button" class="ec-rolechip ${role === k ? 'on' : ''}" data-ec="role" data-k="${k}" aria-pressed="${role === k}">${h(l)}</button>`;
    return `<div class="ec-strip"><div class="ec-striphead"><span>${h(tf('month.goal.title', { role: t(role === 'homeroom' ? 'chrome.homeroom' : 'month.goal.assistant') }))}</span><span class="num ec-faint">${h(m.month)}</span>
      <span class="ec-rolechips">${chip('homeroom', t('chrome.homeroom'))}${chip('assistant', t('month.goal.assistant'))}</span><span class="ec-strip-note">${h(t('month.goal.sameAsWeekFull'))}</span>
      <button type="button" class="ec-chip small" data-ec="fold">${h(t(ui.folded ? 'common.expand' : 'common.collapse'))}</button></div>
      ${ui.folded ? '' : `<div class="ec-stripgrid">${m.skillAreas.map(a => { const g = map[a.key] ?? {}, x = strip[a.key] ?? { actual: [], off: [] };
        const line = !x.actual.length ? h(t('month.goal.none')) : x.off.length ? `${h(t('month.goal.actual'))} <b class="ec-amber-ink">${h(x.off[0])}</b>${x.off.length > 1 ? `<span class="num">${h(tf('month.goal.more', { n: x.off.length - 1 }))}</span>` : ''}`
          : g.textbook ? `${h(t('month.goal.actual'))} <b class="ec-green-ink">${h(t('month.goal.onTarget'))}</b>` : `${h(t('month.goal.actual'))} ${h(x.actual[0])}${x.actual.length > 1 ? `<span class="num">${h(tf('month.goal.more', { n: x.actual.length - 1 }))}</span>` : ''}`;
        return `<div class="ec-stripcell"><div class="ec-stripinputs"><span class="ec-area tone-${h(a.tone)}" title="${h(a.label)}">${h(a.label)}</span>${goalBox(m.classId, 'month', `${m.month}-01`, role, a.key, 'textbook', g.textbook, tf('month.goal.bookAria', { area: a.label }), t('month.goal.book'))}${goalBox(m.classId, 'month', `${m.month}-01`, role, a.key, 'targetProgress', g.targetProgress, tf('month.goal.targetAria', { area: a.label }), t('month.goal.target'))}</div><p class="ec-stripline">${line}</p></div>`; }).join('')}</div>`}</div>`;
  }
  const monthMemo = m => `<div class="ec-strip"><div class="ec-striphead"><span>${h(t('roster.col.note'))}</span><span class="num ec-faint">${h(m.monthLabel)}</span></div>${box('monthMemo', { classId: m.classId, month: m.month }, m.memo, { cls: 'ec-monthmemo', area: true, aria: t('month.memo.aria'), placeholder: W ? t('month.memo.placeholder') : '', ro: m.memoMasked, title: m.memoMasked ? MASKED : '' })}</div>`;
  function calendar(m, cur) {
    if (!m.dows.length) return `<p class="ec-empty">${h(t('month.noClasses'))}</p>`;
    const cols = `44px repeat(${m.dows.length}, minmax(0, 1fr))`;
    return `<div class="ec-calwrap live-scroll" data-scroll-key="ecs-cal"><div class="ec-cal" style="--n:${m.dows.length}"><div class="ec-calrow" style="grid-template-columns:${cols}"><div></div>${m.dows.map(dow => `<div class="ec-caldow">${h(tf('month.dowFull', { dow: m.dowLabels[dow] }))}</div>`).join('')}</div>
      ${m.weeks.filter(w => w.hasClass).map(w => `<div class="ec-calrow" style="grid-template-columns:${cols}"><div class="ec-calweek" title="${h(tf('month.weekTitle', { m: Number(m.month.slice(5)), w: w.index, date: w.monday }))}"><span class="num">${w.index}</span>${h(t('month.weekUnit'))}</div>
        ${m.dows.map(dow => { const date = cellDate(w, dow); return !date ? '<div class="ec-calnone dashed"></div>' : dayCell(m, date, cur); }).join('')}</div>`).join('')}</div></div>`;
  }
  const DOWS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  /** 2.0 lib/month cellDateOf — 그 주에서 그 요일 날짜(창 밖이면 없음). */
  const cellDate = (w, dow) => w.dates.find(dt => DOWS[(new Date(`${dt}T00:00:00Z`).getUTCDay() + 6) % 7] === dow) ?? null;
  function dayCell(m, date, cur) {
    const c = m.cells[date]; if (!c || !c.slots.length) return '<div class="ec-calnone"></div>';
    const holiday = m.holidays[date] ?? null, isToday = date === m.today;
    const badge = `${isToday ? `<span class="ec-calbadge today">${h(t('nav.face.today'))}</span>` : ''}${c.unwritten > 0 ? `<span class="ec-calbadge amber num">${h(tf('month.unwrittenN', { n: c.unwritten }))}</span>` : c.missing === 0 && c.offGoal === 0 && !isToday ? `<span class="ec-calbadge ok" title="${h(t('month.allWritten.title'))}">✓</span>` : ''}${c.offGoal > 0 ? `<span class="ec-calbadge amberfill num">${h(tf('month.offGoalN', { n: c.offGoal }))}</span>` : ''}`;
    const slots = c.slots.filter(s => cur.seat || s.seat === null).map(slot => {
      const seat = slot.seat !== null, verdict = slot.verdict ? `<span class="ec-verdict v-${h(slot.verdict.status ?? '')}" title="${h(slot.verdict.label ?? '')}">${h(slot.verdict.label ?? slot.verdict.status ?? '')}</span>` : '';
      const lines = !slot.lines.length ? `<span class="ec-unwritten ${holiday ? 'holi' : ''}">${h(t(holiday ? 'month.noPlan' : 'month.unwritten'))} · ${h(slot.teacherLabel ?? t('month.noTeacher'))}</span>${slot.planned.map(p => `<div class="ec-planned"><span class="ec-plannedtag">${h(t('month.plannedTag'))}</span><span><b>${h(p.title)}</b><span class="num"> ${h(tf('month.plannedNo', { n: p.lessonNo }))}</span>${p.progress ? ` · ${h(p.progress)}` : ''}</span></div>`).join('')}`
        : slot.lines.map(l => { const a = m.skillAreas.find(x => x.key === l.skillArea); return `<div class="ec-calline ${l.off ? 'off' : ''}"><span class="ec-area small tone-${h(a?.tone ?? 'neutral')}">${h(a?.label ?? l.skillArea)}</span><div class="ec-callinetext"><b class="${l.off ? 'ec-amber-ink' : ''}">${h(l.textbook ?? '')}</b>${l.pageRange ? `<span class="ec-faint num"> ${h(l.pageRange)}</span>` : ''}${l.progress ? `<div class="ec-dim">${h(l.progress)}</div>` : ''}${cur.homework && l.homework ? `<div class="ec-faint">${h(tf('month.homeworkLine', { v: l.homework }))}</div>` : ''}${l.off ? `<div class="ec-amber-ink">${h(tf('month.goalLine', { book: m.goals.homeroom[l.skillArea]?.textbook ?? '' }))}</div>` : ''}</div></div>`; }).join('');
      const bookOnly = slot.lines.length && !slot.lines.some(l => l.progress) ? `<span class="ec-bookonly">${h(t('month.bookOnly'))}</span>` : '';
      return `<div class="ec-calslot"><span class="ec-calslottime num" title="${h(slot.periodLabel ?? '')}">${h(slot.slotStart)}${seat ? `<span class="ec-block-l">${h(slot.seat)}</span>` : ''}</span><div class="ec-calslotbody">${verdict}${lines}${bookOnly}</div></div>`;
    }).join('');
    const tip = holiday ? tf('month.cell.holiday.view', { holiday }) : t('month.cell.view');
    return `<a class="ec-calday ${holiday ? 'holiday' : ''} ${c.offGoal > 0 ? 'offgoal' : isToday ? 'today' : ''}" href="${href({ view: 'sheet', class: m.classId, week: mondayOf(date), day: date, ...keep(last.query) })}" title="${h(`${tip} — 이 연습 화면에서는 그 날 주간 시트로 갑니다.`)}">
      <div class="ec-caldayhead"><span class="num ${holiday ? 'holi' : ''}">${h(slash(date))}</span>${holiday ? `<span class="ec-holiname">${h(holiday)}</span>` : ''}<span class="ec-calbadges">${badge}</span></div>${slots}</a>`;
  }
  function rail(m, cur) {
    const days = [...new Set(m.lines.filter(l => cur.seat || !l.seat).map(l => l.planDate))].sort();
    if (!days.length) return `<p class="ec-empty">${h(t('month.rail.empty.a'))} <b>${h(t('face.cal'))}</b> ${h(t('month.rail.empty.b'))}</p>`;
    const offDays = new Set(m.lines.filter(l => l.off).map(l => l.planDate));
    const DOWK = ['일', '월', '화', '수', '목', '금', '토'];
    const cellsOf = (date, area) => (m.cells[date]?.slots ?? []).filter(s => cur.seat || s.seat === null).flatMap(s => s.lines.filter(l => l.skillArea === area).map(l => ({ l, seat: s.seat !== null })));
    return `<div class="ec-railwrap live-scroll" data-scroll-key="ecs-rail"><table class="ec-rail"><thead><tr><th class="ec-railgoal">${h(t('month.rail.goalHead'))} <span class="ec-faint">${h(t('month.goal.sameAsWeek'))}</span></th>${days.map(dt => { const holi = m.holidays[dt];
      return `<th class="${offDays.has(dt) ? 'offgoal' : holi ? 'holiday' : ''}"><a href="${href({ view: 'sheet', class: m.classId, week: mondayOf(dt), day: dt, ...keep(last.query) })}" title="${h(holi ? tf('month.cell.holiday.view', { holiday: holi }) : t('month.cell.view'))}"><span class="num">${h(slash(dt))}</span><br><span class="ec-faint">${h(holi ?? DOWK[new Date(`${dt}T00:00:00Z`).getUTCDay()])}</span></a></th>`; }).join('')}</tr></thead>
      <tbody>${m.skillAreas.map(a => { const g = m.goals.homeroom[a.key] ?? {};
        return `<tr><th class="ec-railgoal"><span class="ec-area w74 tone-${h(a.tone)}">${h(a.label)}</span><div class="ec-railinputs">${goalBox(m.classId, 'month', `${m.month}-01`, 'homeroom', a.key, 'textbook', g.textbook, tf('month.goal.bookAria', { area: a.label }), t('month.goal.book'))}${goalBox(m.classId, 'month', `${m.month}-01`, 'homeroom', a.key, 'targetProgress', g.targetProgress, tf('month.goal.targetAria', { area: a.label }), t('month.goal.target'))}</div></th>
          ${days.map(dt => { const cs = cellsOf(dt, a.key); return `<td class="${!cs.length ? 'empty' : offDays.has(dt) ? 'offday' : ''}">${cs.map(({ l, seat }) => `<div class="ec-railitem ${seat ? 'seat' : ''}">${l.pageRange ? `<span class="num ec-bold">${seat ? '<span class="ec-jj">JJ</span>' : ''}${h(l.pageRange)}</span>` : ''}${l.progress ? `<span class="ec-dim">${h(l.progress)}</span>` : ''}<span class="${l.off ? 'ec-amber-ink ec-bold' : 'ec-faint'}" title="${h(l.textbook ?? '')}">${h(l.textbook ?? '')}</span>${cur.homework && l.homework ? `<span class="ec-faint"><b>${h(t('plan.col.homework'))}</b> ${h(l.homework)}</span>` : ''}</div>`).join('')}</td>`; }).join('')}</tr>`; }).join('')}</tbody>
      <tfoot><tr><th class="ec-railgoal">${h(t('month.rail.footer'))}</th>${days.map(dt => { const f = m.fillByDate[dt] ?? { filled: 0, total: 0, short: false }; return `<td><span class="num ${f.short ? 'ec-amber-ink ec-bold' : 'ec-faint'}">${f.filled}/${f.total}</span></td>`; }).join('')}</tr></tfoot></table></div>`;
  }
  /** 2.0 month-plan-bar.tsx — 계획(MP)은 축이 날짜라 숫자 줄을 바꾼다(미작성·교재 다름·계획 없음). */
  function mpBar(m) {
    const sm = m.mp?.summary; if (!sm) return '';
    const pct = sm.scheduled === 0 ? 0 : Math.round((sm.planned / sm.scheduled) * 100), dot = '<i class="ec-dotbox" aria-hidden="true"></i>';
    return `<span class="ec-dim small" title="${h(t('mp.title'))}">${h(t('bulk.plan'))} <b class="num">${sm.planned}/${sm.scheduled}</b>${h(t('mp.dayUnit'))} <span class="num">(${pct}%)</span></span>`
      + (sm.unwritten ? `<span class="ec-offgoal" title="${h(t('mp.unwritten.title'))}">${dot}${h(t('mp.unwritten'))} <span class="num">${h(tf('month.days', { n: sm.unwritten }))}</span></span>` : '')
      + (sm.offBook ? `<span class="ec-offgoal" title="${h(t('mp.offBook.title'))}">${dot}${h(t('mp.offBook'))} <span class="num">${h(tf('month.days', { n: sm.offBook }))}</span></span>` : '')
      + (sm.noPlan ? `<span class="ec-faint small" title="${h(t('mp.noPlan.title'))}">${h(t('mp.noPlan'))} <span class="num">${h(tf('month.days', { n: sm.noPlan }))}</span></span>` : '');
  }
  /** 2.0 month-plan-view.tsx — 학부모에게 나가는 종이 서식 그대로(서식 값은 서버가 2.0 month-plan-sheet-style에서). */
  function mpDoc(m, cur) {
    const p = m.mp; if (!p) return '';
    if (!p.dows.length) return `<p class="ec-empty">${h(t('mp.noSchedule'))}</p>`;
    const st = p.style;
    const headBlock = `<div class="ec-mphead" style="${h(st.head)}"><div class="ec-mplogo" style="${h(st.logo)}" title="EiE 로고 그림은 이 연습 화면에 싣지 않았습니다(2.0 public 파일).">EiE</div>
      <div class="ec-mptitlebox"><h2 class="ec-mptitle" style="${h(st.title)}" title="${h(p.titleTip)}"><span style="${h(st.titleName)}">${h(p.title.name)}</span>${p.title.period ? `<span style="${h(st.titlePeriod)}">${h(p.title.period)}</span>` : ''}</h2>
        <div class="ec-mpnotices" style="${h(st.notices)}">${p.notices.map((n, i) => `<p style="${h(i === p.notices.length - 1 ? st.noticeLast : st.notice)}">${h(n)}</p>`).join('')}</div></div>
      <div class="ec-mpside" style="${h(st.side)}"><div class="ec-mpteacher" style="${h(st.teacher)}">${h(p.teacherLabel ?? '')}</div>${p.legend.map(l => `<p class="ec-mplegend" style="${h(st.legend)}">${h(l)}</p>`).join('')}</div></div>`;
    const colsOf = dow => p.weeks.find(w => w.days.find(x => x.dow === dow && x.cols?.length))?.days.find(x => x.dow === dow)?.cols ?? [];
    const width = dow => Math.max(1, colsOf(dow).length);
    const ebook = dow => { if (!W) return ''; const has = colsOf(dow).some(c => c.col === 'ebook'), dates = p.classDatesByDow[dow] || [], written = p.weeks.flatMap(w => w.days.filter(x => x.dow === dow)).filter(x => x.cols.some(c => c.col === 'ebook' && c.body.trim())).length;
      return btn('mpCell', { classId: m.classId, dates, colKind: 'ebook', body: has ? null : '', intent: { kind: 'ebookColumn', show: !has } }, h(t(has ? 'mp.ebook.drop' : 'mp.ebook.add')), { cls: 'ec-mpbtn', title: t(has ? 'mp.ebook.drop.title' : 'mp.ebook.add.title'), confirm: has && written ? tf('mp.ebook.dropConfirm', { dow: p.dowLabels[dow], n: written }) : '' }); };
    const thead = `<thead><tr><th class="ec-mpsticky" style="${h(st.dayCorner)}">Day</th>${p.dows.map(dow => `<th colspan="${width(dow)}" style="${h(st.day)}"><span class="ec-mpdow">${h(p.dowLabels[dow])}${ebook(dow)}</span></th>`).join('')}</tr></thead>`;
    const weeks = p.weeks.map(w => {
      const dateRow = `<tr><th class="ec-mpsticky" style="${h(st.dateCorner)}">Date</th>${w.days.map(x => `<td colspan="${x.cols.length || width(x.dow)}" style="${h(x.kind === 'off' ? st.offBand : st.date)}"><span class="ec-mpdate"><span class="num">${h(x.md ?? '—')}</span>${x.date && !x.teaches ? `<span>${h(t('mp.noClassDay'))}</span>` : ''}${x.holiday && x.kind !== 'off' ? `<span class="ec-tone inert">${h(x.holiday)}</span>` : ''}${x.verdict && x.verdict.tone ? `<span class="ec-tone ${h(x.verdict.tone)}" title="${h(x.verdict.hint)}">${h(x.verdict.label)}</span>` : ''}${W && x.date && x.teaches ? btn('mpCell', { classId: m.classId, dates: [x.date], colKind: 'off', body: null, intent: { kind: 'dayOff', off: !x.off } }, h(t(x.off ? 'mp.off.undo' : 'mp.off')), { cls: 'ec-mpbtn', title: t(x.off ? 'mp.off.undo.title' : 'mp.off.title') }) : ''}</span></td>`).join('')}</tr>`;
      const labelRow = `<tr><th class="ec-mpsticky" rowspan="${cur.actual ? 3 : 2}" style="${h(st.week)}">Week <span class="num">${w.index}</span></th>${w.days.map(x => (x.kind === 'off' ? `<td colspan="${x.cols.length || width(x.dow)}" style="${h(st.offBand)}">${h(x.offLabel)}</td>` : x.kind === 'none' ? `<td colspan="${width(x.dow)}" style="${h(st.blank)}"></td>` : x.cols.map(c => `<th title="${h(c.hint)}" style="${h(st.colHead[c.col])}">${h(c.label)}</th>`).join(''))).join('')}</tr>`;
      const valueRow = `<tr>${w.days.map(x => (x.kind === 'none' ? (colsOf(x.dow).length ? colsOf(x.dow) : [{ col: 'in_class' }]).map(c => `<td style="${h(st.valueNone[c.col])}"></td>`).join('') : x.cols.map(c => `<td style="${h(x.kind === 'off' ? st.valueOff : st.value[c.col])}${x.warnBook && c.col === 'in_class' ? ';box-shadow:inset 0 0 0 2px var(--e-amber)' : ''}">${W && x.kind === 'live' ? box('mpCell', { classId: m.classId, dates: [x.date], colKind: c.col }, c.body, { cls: 'ec-mpvalue ec-mpedit', area: true, aria: `${x.md} ${c.label}`, title: c.hint }).replace('<textarea ', `<textarea style="${h(st.input[c.col])}" `) : `<div class="ec-mpvalue" style="${h(x.kind === 'off' ? st.inputMuted[c.col] : st.input[c.col])}" title="${h(c.hint)}" aria-label="${h(`${x.md} ${c.label}`)}">${h(c.body)}</div>`}</td>`).join(''))).join('')}</tr>`;
      const actualRow = cur.actual ? `<tr>${w.days.map(x => `<td colspan="${x.cols.length || width(x.dow)}" style="${h(st.actual)}">${x.actual.length ? `<span class="ec-mpactual">${h(x.actual.join(' / '))}</span>` : `<span class="ec-mpnone">${x.date && x.teaches ? h(t('mp.noRecord')) : ''}</span>`}</td>`).join('')}</tr>` : '';
      return `<tbody>${dateRow}${labelRow}${valueRow}${actualRow}</tbody>`;
    }).join('');
    return `<div class="ec-mpwrap live-scroll" data-scroll-key="ecs-mp"><div class="ec-mpdoc" style="${h(st.outer)}">${headBlock}<table class="ec-mptable" style="${h(st.table)}">${thead}${weeks}</table>
      <div class="ec-mpfooter" style="${h(st.footer)}">${p.sessionLine ? `<p>${h(p.sessionLine)}</p>` : ''}${W ? box('mpCell', { classId: m.classId, dates: [p.footerDate], colKind: 'footer' }, p.footer, { cls: 'ec-mpfootertext ec-mpedit', area: true, rows: Math.max(4, p.footer.split('\n').length), aria: t('mp.footerAria'), title: t('mp.footerTitle') }) : `<div class="ec-mpfootertext">${h(p.footer)}</div>`}</div></div></div>`;
  }

  // ── 오늘 — 2.0 EcsTodayFace(시트 모드): 고른 선생님의 그날 반, 반마다 그날 열 · 본인 교시만 ──
  function todayView(d, q) {
    const T0 = d.today, nav = p => ({ view: 'today', teacher: T0.teacher?.id, date: T0.date, ...keep(q), ...p }), isToday = T0.date === T0.today;
    const pick = `<label class="ec-pick"><span class="micro">보는 선생님</span><select data-ec="nav" aria-label="보는 선생님">${T0.teachers.map(x => `<option value="${h(href(nav({ teacher: x.id })))}" ${x.id === T0.teacher?.id ? 'selected' : ''}>${h(x.name)}</option>`).join('')}</select></label>`;
    const bar = `<div class="ec-bar">${faceTabs('today', q)}${pick}${periodNav({ label: T0.dateLabel, prev: href(nav({ date: shiftDay(T0.date, -1) })), next: T0.date >= T0.today ? href(nav({})) : href(nav({ date: shiftDay(T0.date, 1) })), current: href(nav({ date: '' })), relation: T0.date < T0.today ? 'past' : 'current', prevAria: t('nav.prevDay'), nextAria: t('nav.nextDay'), currentTitle: t('nav.today') })}
      <span class="ec-end">${off(t('nav.quickAttendance'), '', NOT_HERE)}${off(t('goals.title'), '', NOT_HERE)}</span></div>`;
    const holiday = T0.holiday ? `<p class="ec-holistrip"><b>${h(isToday ? t('today.holiday.today') : `${Number(T0.date.slice(5, 7))}월 ${Number(T0.date.slice(8, 10))}일은`)} ${h(T0.holiday)}</b> ${h(t('today.holiday.tail'))} <b>${h(t('today.holiday.asUsual'))}</b>${h(t('today.holiday.tail2'))}</p>` : '';
    const list = !T0.classes.length ? `<p class="ec-empty">${h(!T0.hasAnyClass ? t('today.empty.noClassScoped') : `${t(isToday ? 'today.empty.noLesson.today' : 'today.empty.noLesson.day')}${t('today.empty.noLesson.tail')}`)}</p>`
      : `<p class="ec-weekhint">${h(t('today.weekHint.before'))} <b>${h(t('today.weekHint.link'))}</b>${h(t('today.weekHint.after'))}</p>${T0.classes.map(c => todayCard(c, q)).join('')}`;
    return `${head(t('landing.eyebrow'), t('landing.title'), tf(isToday ? 'today.desc.today' : 'today.desc.day', { n: T0.classes.length }))}<p class="os-banner v2s-note">${h(T0.teacher?.name ?? '')} 선생님의 오늘 면을 보는 중입니다 — ${h(READONLY)}</p>${bar}${holiday}<div class="ec-today"${zoomStyle(d)}>${list}</div>`;
  }
  /** 2.0 today-class-sheet + today-roster-table — 교시 카드(머리·계획, 카드 껍데기 없이 세로선으로 가름)를 가로로, 명단은 교시를 합친 표 하나. */
  function todayCard(c, q) {
    const link = `<a class="ec-todaytitle" href="${href({ view: 'sheet', class: c.classId, week: c.weekMonday, ...keep(q) })}">${h(c.className)}</a>`;
    const day = c.todayDay, ts = c.todaySheet;
    if (!day || !day.slots.length || !ts) return `<section class="ec-card ec-todayempty">${c.hiddenOwn ? link : `<span class="ec-todaytitle">${h(c.className)}</span>`}<p class="ec-dim">${h(c.hiddenOwn ? t('today.card.noOwnSlots') : t('today.card.noClass'))}</p></section>`;
    const data = { ...c, shouting: c.shouting || {} };
    const top = `<div class="ec-todaytop"><div style="width:${ts.nameW}px;flex-shrink:0" aria-hidden="true"></div>${day.slots.map(slot => `<div class="ec-todayslot" style="width:${ts.slotW}px">${periodBlock(data, day, slot, { flat: true, roster: false })}</div>`).join('')}</div>`;
    return `<section class="ec-todaycard live-scroll" data-scroll-key="ecs-today-${h(c.classId)}"><div class="ec-todayinner" style="width:${ts.width + 16}px">
      <div class="ec-todayhead" style="width:${ts.width}px">${link}${c.classTeacherName ? `<span class="ec-dim">${h(t('chrome.homeroom'))} ${h(c.classTeacherName)}</span>` : ''}</div>${top}
      ${ts.hasRoster ? `<div class="ec-todaysep"></div>${todayRoster(day, { ...ts, classId: c.classId })}` : ''}</div></section>`;
  }
  function todayRoster(day, ts) {
    const slots = day.slots, span = 1 + slots.reduce((n, s) => n + 4 + s.textCols.length, 0), count = Object.fromEntries(ts.groups.map(g => [g.key, g.rows.length]));
    const head = `<tr><th>${groupToggle('active', count.active ?? 0)}</th>${slots.map(s => `<th class="c edge">${h(t('roster.col.attendance'))}</th><th class="c" title="${h(t('roster.col.unit.title'))}">${h(t('roster.col.unit'))}</th><th class="c">${h(t('roster.col.attitude'))}</th>${s.textCols.map(c => `<th class="c" title="${h(t(c.titleKey))}">${h(t(c.labelKey))}</th>`).join('')}<th class="c"><span class="clamp2">${h(t('roster.col.note'))}</span></th>`).join('')}</tr>`;
    const offCells = s => { const off = t('roster.notEnrolled'), dash = cls => `<td class="c${cls}" title="${h(off)}"><span class="ec-faint">—</span></td>`;
      return `${dash(' edge')}${dash('')}${dash('')}${s.textCols.map(() => `<td title="${h(off)}"><input class="ec-input center" readonly disabled placeholder="—" aria-label="${h(off)}"></td>`).join('')}<td title="${h(off)}"><input class="ec-input" readonly disabled placeholder="—" aria-label="${h(off)}"></td>`; };
    const body = ts.groups.map(g => {
      const label = g.label ? `<tr class="ec-glabel"><td colspan="${span}" title="${h(t(`roster.group.${g.key}.hint`))}">${groupToggle(g.key, g.rows.length)}</td></tr>` : '';
      if (ui.collapsed.has(g.key)) return label;
      return label + g.rows.map(r => (g.key === 'withdrawn' || g.key === 'classEnded' ? withdrawnRow(r, span)
        : `<tr class="${r.historical ? 'ec-hist' : ''}">${nameCell(r)}${slots.map((s, i) => (r.cells[i] ? slotCells({ ...r, ...r.cells[i] }, s.textCols, true, { classId: ts.classId, date: day.date, slotStart: s.slotStart }) : offCells(s))).join('')}</tr>`)).join('');
    }).join('');
    return `<table class="ec-rostertable ec-todayroster" style="width:${ts.width}px"><colgroup><col style="width:${ts.nameW}px">${ts.slotCols.map(ws => ws.map(w => `<col style="width:${w}px">`).join('')).join('')}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  S.register({ id: 'ecs', label: '강사 시트', render(ctx) {
    last = ctx; W = !!ctx.writable;
    const q = ctx.query, view = q.get('view') || (q.get('class') ? 'sheet' : 'list');
    const params = Object.fromEntries(['view', 'class', 'week', 'month', 'mv', 'period', 'track', 'teacher', 'date', 'jj'].map(k => [k, q.get(k) || '']));
    if (view === 'month' && params.mv === '') delete params.mv;
    const e = ctx.load(params);
    if (e.status === 'loading') return `${head('수업 운영', '영어 강사 시트', '')}<p class="v2s-note">불러오는 중입니다…</p>`;
    if (e.status === 'error') return `${head('수업 운영', '영어 강사 시트', '')}<p class="v2s-note">${h(e.error)}</p><button type="button" class="ec-chip" data-ec="retry">다시 불러오기</button>`;
    const d = e.data; T = d.t || {}; last.faceTitle = d.faceTitle; D = d;
    if (!e.refreshing) for (const [k, x] of drafts) if (x.saved) drafts.delete(k);
    if (d.error) return `${head('수업 운영', '영어 강사 시트', '반별 주간 수업계획서/출석부')}<div class="ec-card ec-foot"><p>${h(d.error)}</p><a class="ec-link" href="${href({ view: 'list', ...keep(q) })}">반 목록으로</a></div>`;
    const html = d.view === 'list' ? listView(d, q) : d.view === 'today' ? todayView(d, q) : d.view === 'month' ? monthView(d, q) : sheetView(d, q);
    return `<div class="ec">${html}</div>`;
  } });

  /** 저장 한 번 — 끝나면 공통 틀이 같은 화면 자료를 다시 받아 그린다. 거절은 2.0 문구 그대로 알림. */
  async function save(act, body, fid) {
    if (!last?.act || saving) return;
    const actor = actorId(); if (!actor) { last.api?.toast?.('저장하는 사람을 골라 주세요.'); return; }
    saving = true; rerender();
    try {
      const res = await last.act(act, { ...body, actor });
      if (act === 'planCell' && res?.status === 'conflict') last.api?.toast?.(`${t('cell.conflict.server')} ${res.serverValue ?? t('cell.conflict.empty')} — 다른 사람이 먼저 고쳤습니다. 새 값으로 다시 그립니다.`);
      else if (act === 'planCopy') last.api?.toast?.(res?.copied ? `지난 수업(${res.sourceDate ?? ''})에서 ${res.copied}칸을 채웠습니다.` : '채울 빈 칸이나 가져올 지난 수업이 없습니다.');
      if (fid) drafts.set(fid, { v: body.value ?? body.body ?? '', saved: true });
    } catch (error) { last.api?.toast?.(error.message || '저장하지 못했습니다.'); }
    finally { saving = false; rerender(); }
  }
  // 한 리스너: 선택 = 주소 이동(뒤로·새로고침이 같은 화면), 접기·패널·글씨·역할은 이 탭 안의 보기 상태.
  const rerender = () => last?.api?.render?.();
  document.addEventListener('change', ev => {
    const el = ev.target.closest?.('[data-v2-screen="ecs"] [data-ec]'); if (!el) return;
    if (el.dataset.ec === 'nav' && el.value.startsWith('#v2-ecs')) location.hash = el.value.slice(1);
    else if (el.dataset.ec === 'actor') { const p = Object.fromEntries(last.query); p.as = el.value; last.go(p); }
    else if (el.dataset.ec === 'font') { ui.font = el.value; rerender(); }
  });
  // 칸 저장 — 입력을 떠날 때(change) 한 번. 타이핑은 기억만 한다(다시 그려도 유지).
  document.addEventListener('input', ev => { const el = ev.target.closest?.('[data-v2-screen="ecs"] [data-fid]'); if (el) drafts.set(el.dataset.fid, { v: el.value, saved: false }); });
  document.addEventListener('change', ev => {
    const el = ev.target.closest?.('[data-v2-screen="ecs"] [data-ec-act], [data-v2-screen="ecs"] [data-ec-check]'); if (!el) return;
    const p = JSON.parse(el.dataset.p);
    if (el.dataset.ecCheck === 'shouting') return void save('shouting', { ...p, value: el.checked });
    const act = el.dataset.ecAct, v = el.value;
    if (act === 'planCell') save(act, { ...p, value: v }, el.dataset.fid);
    else if (act === 'mark' || act === 'goal') save(act, { ...p, value: v }, el.dataset.fid);
    else if (act === 'memo' || act === 'monthMemo') save(act, { ...p, body: v }, el.dataset.fid);
    else if (act === 'mpCell') save(act, { ...p, body: v }, el.dataset.fid);
  });
  document.addEventListener('click', ev => {
    const b = ev.target.closest?.('[data-v2-screen="ecs"] [data-ec-btn]');
    if (b && !b.disabled) { if (b.dataset.confirm && !window.confirm(b.dataset.confirm)) return; return void save(b.dataset.ecBtn, JSON.parse(b.dataset.p)); }
    const el = ev.target.closest?.('[data-v2-screen="ecs"] [data-ec]'); if (!el || el.disabled) return;
    const k = el.dataset.ec;
    if (k === 'panel') { ui.panel = !ui.panel; rerender(); }
    else if (k === 'group') { const g = el.dataset.k; if (ui.collapsed.has(g)) ui.collapsed.delete(g); else ui.collapsed.add(g); rerender(); }
    else if (k === 'role') { ui.role = el.dataset.k; rerender(); }
    else if (k === 'fold') { ui.folded = !ui.folded; rerender(); }
    else if (k === 'display') { const cur = ui.display?.[ui.monthView]; if (cur) { cur[el.dataset.k] = !cur[el.dataset.k]; rerender(); } }
    else if (k === 'student') last?.api?.showStudent?.(el.dataset.id);
    else if (k === 'retry') last?.refresh?.();
  });
})();
