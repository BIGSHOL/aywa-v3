/* 2.0 화면 · 선생님 원스크린 — 1단계 보기 동등 (V2-SCREENS.md, v2-screen-onescreen.mjs). The 2.0 top bar, the card view
   (student list · report card · parent preview), the grid, 발송 현황 and 월간 발송 with 2.0's labels, over the local copy.
   Every input, save and send stays in its 2.0 place but disabled — this copy is view-only; nothing is sent. The owner
   picks the teacher and the day (the 2.0 screen is the teacher's own). State lives in the address (#v2-onescreen?…). */
(() => {
  'use strict';
  const S = window.V2Screens; if (!S) return;
  const h = S.esc, VIEWS = [['card', '카드'], ['grid', '표'], ['status', '발송 현황'], ['history', '월간 발송'], ['notice', '공지']];
  const TONE = { 출석: 'ok', 지각: 'warn', 조퇴: 'warn', 결석: 'bad', 보강: 'info' }, SEND = { sent: '발송완료', draft: '작성중', todo: '미작성', excluded: '미발송 반' };
  const READONLY = '복사본 보기 전용 — 이 화면에서는 입력·저장·발송이 되지 않습니다.';
  let last = null;
  const off = (label, extra = '') => `<button type="button" class="os-btn ${extra}" disabled title="${h(READONLY)}">${h(label)}</button>`;
  const field = (label, value, cls = '') => `<label class="os-field ${cls}"><span>${h(label)}</span><output class="os-input${value ? '' : ' empty'}">${value ? h(value) : '—'}</output></label>`;
  const att = su => (su.attendanceLabel ? `<span class="os-att ${TONE[su.attendanceLabel] || ''}">${h(su.attendanceLabel)}</span>` : su.classId ? '<span class="os-att none">출결 미입력</span>' : '');
  const score = t => (t.score == null ? '' : `${t.score}/${t.max}`);
  const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  function topBar(d, q) {
    const view = q.get('view') || 'card', cls = q.get('class') || '', write = q.get('write') || '';
    const rows = d.students.flatMap(s => s.subjects), done = d.students.filter(s => s.subjects.every(su => su.saved || su.reportOptout)).length;
    const own = d.todayClasses.filter(c => !c.delegated), dlg = d.todayClasses.filter(c => c.delegated);
    const chip = c => `<button type="button" class="os-chip" data-os="set" data-k="class" data-v="${h(c.name)}" aria-pressed="${cls === c.name}">${h(c.name)}${c.reportOptout ? ' <small>출결만</small>' : ''}${c.delegatedAwayTo ? ' <small>위임중</small>' : ''}${c.delegated && c.ownerName ? ` <small>${h(c.ownerName)} 선생님 반</small>` : ''}</button>`;
    return `<div class="os-top">
      <div class="os-row"><label class="os-pick"><span>보는 선생님</span><select data-os="teacher">${d.teachers.map(t => `<option value="${h(t.id)}" ${t.id === d.teacher.id ? 'selected' : ''}>${h(t.name)}${t.active ? '' : ' (재직 아님)'} · 반 ${t.classes}</option>`).join('')}</select></label>
        <div class="os-date" role="group" aria-label="날짜"><button type="button" class="os-btn" data-os="day" data-v="-1" aria-label="이전 날짜">‹</button><strong>${h(d.dateLabel)}</strong><button type="button" class="os-btn" data-os="day" data-v="1" aria-label="다음 날짜" ${d.date >= d.asOf ? 'disabled' : ''}>›</button>
        <button type="button" class="os-link" data-os="set" data-k="date" data-v="${h(d.asOf)}">눌러서 오늘로</button><input type="date" data-os="date" value="${h(d.date)}" max="${h(d.asOf)}" aria-label="날짜 고르기"></div></div>
      <div class="os-row os-chips" role="group" aria-label="반"><button type="button" class="os-chip" data-os="set" data-k="class" data-v="" aria-pressed="${!cls}">전체</button>${own.map(chip).join('')}${dlg.length ? `<span class="os-sep">위임</span>${dlg.map(chip).join('')}` : ''}</div>
      <div class="os-row"><span class="os-group" role="group" aria-label="작성"><span>작성</span>${[['', '전체'], ['done', `작성 ${done}`], ['todo', `미작성 ${d.students.length - done}`]].map(([v, l]) => `<button type="button" class="os-chip" data-os="set" data-k="write" data-v="${v}" aria-pressed="${write === v}">${l}</button>`).join('')}</span>
        ${off('출결 모드')}<span class="os-group" role="group" aria-label="보기"><span>보기</span>${VIEWS.map(([v, l]) => `<button type="button" class="os-chip" data-os="set" data-k="view" data-v="${v}" aria-pressed="${view === v}">${l}</button>`).join('')}</span>${off('설정')}
        <span class="os-count">학생 ${d.students.length}명 · 보고서 ${rows.filter(r => r.saved).length}건</span></div></div>`;
  }
  function notes(d) {
    const out = [`<p class="os-banner" role="status">${h(d.teacher.name)} 강사의 화면을 열람 중입니다 — ${READONLY}</p>`];
    if (d.dateNote) out.push(`<p class="v2s-note">${h(d.dateNote)}</p>`);
    if (d.holiday) out.push(`<p class="os-strip">${h(d.holiday)} · 학원 휴원일 — 시간표는 평소 요일대로 보입니다. 수업하지 않은 날이면 출결을 찍지 마세요(수업한 날이면 그대로 입력하면 됩니다).</p>`);
    if (d.noClassesToday && !d.showingAll) out.push(`<p class="os-strip"><strong>이 날짜에는 담당 수업이 없습니다</strong> — 다른 날짜를 고르거나, 필요하면 담당 반 전체를 볼 수 있습니다. <button type="button" class="os-link" data-os="set" data-k="all" data-v="1">담당 반 전체 보기</button></p>`);
    if (d.showingAll) out.push(`<p class="os-strip warn"><strong>담당 반 전체 보기 — 이 날짜에 수업이 있는 학생이 아닙니다</strong> 안 오는 날 입력·발송이 되지 않도록 주의하세요. <button type="button" class="os-link" data-os="set" data-k="all" data-v="">오늘 수업만 보기</button></p>`);
    return out.join('');
  }
  const visible = (d, q) => {
    const cls = q.get('class') || '', write = q.get('write') || '';
    return d.students.map(s => ({ ...s, subjects: s.subjects.filter(su => !cls || su.className === cls) })).filter(s => s.subjects.length)
      .filter(s => { const done = s.subjects.every(su => su.saved || su.reportOptout); return !write || (write === 'done' ? done : !done); });
  };
  const groups = list => { const m = new Map(); for (const s of list) { const k = s.subjects[0]?.className || '반 미배정'; (m.get(k) ?? m.set(k, []).get(k)).push(s); } return [...m]; };

  // ── 카드 보기: 학생 목록 · 보고서 카드 · 학부모 화면 미리보기 ──
  function card(d, q, list) {
    const sel = list.find(s => s.id === q.get('student')) || list[0];
    const left = groups(list).map(([g, ss]) => `<li class="os-group-head">${h(g)} <small>${ss.length}명</small></li>${ss.map(s => {
      const r = s.subjects, chipOk = (ok, l) => `<span class="os-mini ${ok ? 'ok' : ''}">${l}</span>`;
      return `<li><button type="button" class="os-student ${s.id === sel?.id ? 'on' : ''}" data-os="set" data-k="student" data-v="${h(s.id)}"><strong>${h(s.name)}</strong><small>${h(s.schoolGrade)}</small><span>${chipOk(r.every(x => x.today), '진도')}${chipOk(r.every(x => x.tests.daily.score != null || x.tests.check.score != null), '테스트')}${chipOk(r.every(x => x.saved || x.reportOptout), '보고서')}</span></button></li>`;
    }).join('')}`).join('');
    if (!sel) return `<div class="os-card-view"><ul class="os-list">${left}</ul><p class="v2s-note">이 조건의 학생이 없습니다.</p></div>`;
    const blocks = sel.subjects.map(su => reportBlock(d, sel, su)).join('');
    const preview = sel.subjects.map(su => parentPreview(d, sel, su)).join('');
    return `<div class="os-card-view"><ul class="os-list" aria-label="학생 목록">${left}</ul>
      <section class="os-report"><header><small>${sel.subjects.length > 1 ? 'today 보고서 · 과목별' : 'today 보고서'}</small><h2>${h(sel.name)} · 학부모 보고</h2>
        <div class="os-badges">${sel.subjects.some(su => su.saved) ? '<span class="os-pill">기록 저장</span>' : ''}<span class="os-att ${TONE[sel.mark] || ''}">${h(sel.mark)}</span>${sel.subjects.map(su => `<span class="os-pill">${h(su.name)}${su.report?.status === 'success' ? ' ✓' : ''}</span>`).join('')}</div></header>${blocks}</section>
      <aside class="os-preview" aria-label="학부모 화면 미리보기"><h3>학부모 화면 미리보기</h3>${preview}</aside></div>`;
  }
  function reportBlock(d, st, su) {
    const p = su.prev, set = d.settings;
    return `<article class="os-block"><h3>${h(su.name)} <small>${h(su.className || '보강')}</small> ${att(su)}${su.attendanceUnits != null ? ` <small>수업타임 ${su.attendanceUnits}</small>` : ''}${su.fromSession && !su.saved ? ' <span class="os-pill">작성 중(저장 전)</span>' : ''}</h3>
      <div class="os-prev">${p ? `<strong>이전 ${md(p.date)}</strong> ${off('가져오기', 'small')}<p>${[p.progress, p.examInfo, p.attitude, p.homeworkScore && `수행률 ${p.homeworkScore}`, p.textbook, p.homeworkToday && `과제 ${p.homeworkToday}`, p.note].filter(Boolean).map(h).join(' · ') || '—'}</p>` : '<strong>이전 기록 없음</strong>'}</div>
      <div class="os-grid2">
        <div>${field('오늘 진도', su.today)}<p class="os-sub">${p?.progress ? `이전 · ${h(p.progress.split('\n').at(-1))}` : '기록 없음'}</p>
          <div class="os-tests"><span>테스트 점수</span>${set.showDailyTest ? field('일일테스트', score(su.tests.daily)) : ''}${set.showCheckTest ? field('확인테스트', score(su.tests.check)) : ''}</div>
          ${field('교재명', su.textbook)}${field('수업 태도', su.attitude)}${field('과제 수행률', su.homework)}${field('오늘 과제', su.homeworkToday)}</div>
        <div>${field('특이사항 (메모)', su.note, 'tall')}${field(`${su.subjectLabel} 보고서`, su.draft, 'tall pre')}${field('학습 추세 (종합분석)', su.trendDraft, 'pre')}
          <div class="os-actions">${off(su.saved ? '발송됨 — 수정 불가' : '저장')}${off('자동작성')}${off('ClassNote 발송', 'primary')}</div>
          ${su.gate ? `<p class="os-gate">${h(su.gate)}</p>` : ''}${su.report?.badge ? `<p class="os-cn">${h(su.report.badge.label)}${su.report.readAt ? ' · 학부모 읽음' : ''}${su.report.views ? ` · ${su.report.views}회 열람` : ''}</p>` : ''}</div></div></article>`;
  }
  function parentPreview(d, st, su) {
    const f = su.preview.fields, show = d.settings.show, row = (l, v, on = true) => (on && v ? `<div><dt>${h(l)}</dt><dd>${h(v)}</dd></div>` : '');
    return `<article class="os-parent"><h4>${h(su.preview.title)}</h4>
      <section><h5>학생 정보</h5><dl>${row('이름', st.name)}${row('학교 · 학년', st.schoolGrade)}${row('담임', d.teacher.name)}</dl></section>
      <section><h5>오늘 수업</h5><dl>${row('교재', f.textbook, show.showTextbook)}${row('진도', f.progress, show.showProgress)}${row('오늘 과제', f.homeworkToday, show.showHomeworkToday)}</dl></section>
      <section><h5>평가</h5><dl>${row('일일테스트', f.dailyTest, show.showDailyTest)}${row('확인테스트', f.checkTest, show.showCheckTest)}${row('지난 과제 수행률', f.homeworkScore, show.showHomework)}${row('수업 태도', f.attitude, show.showAttitude)}</dl></section>
      ${show.showParentNote && f.notes ? `<section><h5>학부모 전달 내용</h5><p class="pre">${h(f.notes)}</p></section>` : ''}${show.showTrendNote && f.trendNote ? `<section><h5>학습 추세</h5><p class="pre">${h(f.trendNote)}</p></section>` : ''}
      ${show.showAcademyName && d.settings.academyName ? `<footer>${h(d.settings.academyName)}${d.settings.footerNote ? ` · ${h(d.settings.footerNote)}` : ''}</footer>` : ''}</article>`;
  }

  // ── 표 보기 ──
  function grid(d, q, list) {
    const set = d.settings, cols = ['☐', '학생 · 반', '타임', '진도(오늘)', ...(set.showDailyTest ? ['일일'] : []), ...(set.showCheckTest ? ['확인'] : []), '태도', '과제 수행률', '교재명 · 보강 · 과제', '학부모 문구', '발송 · 편집'];
    const body = groups(list).map(([g, ss]) => `<tr class="os-ghead"><th colspan="${cols.length}">${h(g)} <small>${ss.length}명</small></th></tr>${ss.flatMap(st => st.subjects.map(su => {
      const p = su.prev, prev = p ? `<tr class="os-prevrow"><td>↓</td><td>이전 ${md(p.date)}</td><td>·</td><td class="pre">${h(p.progress || '—')}</td>${set.showDailyTest || set.showCheckTest ? `<td colspan="${(set.showDailyTest ? 1 : 0) + (set.showCheckTest ? 1 : 0)}">${h(p.examInfo || '—')}</td>` : ''}<td>${h(p.attitude || '—')}</td><td>${h(p.homeworkScore || '—')}</td><td>${h([p.textbook, p.homeworkToday && `과제 ${p.homeworkToday}`].filter(Boolean).join('\n') || '—')}</td><td>${h(p.note || '—')}</td><td>${off('가져오기', 'small')}</td></tr>` : '';
      return `${prev}<tr><td><input type="checkbox" disabled aria-label="선택"></td><td><strong>${h(st.name)}</strong> <span class="os-pill">${h(su.subjectLabel)}</span><br><small>${h(st.schoolGrade)}</small> ${att(su)}</td><td>${su.attendanceUnits ?? '—'}</td><td class="pre">${h(su.today || '')}</td>${set.showDailyTest ? `<td>${h(score(su.tests.daily))}</td>` : ''}${set.showCheckTest ? `<td>${h(score(su.tests.check))}</td>` : ''}<td>${h(su.attitude || '')}</td><td>${h(su.homework || '')}</td><td class="pre">${h([su.textbook, su.homeworkToday].filter(Boolean).join('\n'))}</td><td class="os-ment"><div class="pre">${h([su.note, su.draft].filter(Boolean).join('\n\n'))}</div></td>
        <td>${off(su.saved ? '발송 완료' : '발송', 'small')}${su.gate ? `<small class="os-gate">${h(su.gate)}</small>` : ''}${su.report?.badge && su.report.status !== 'success' ? `<small>${h(su.report.badge.short || su.report.badge.label)}</small>` : ''}${su.report?.readAt ? '<small>학부모 읽음</small>' : ''}</td></tr>`;
    })).join('')}`).join('');
    const rows = list.flatMap(s => s.subjects), sendable = rows.filter(r => !r.saved && !r.gate).length;
    return `<div class="os-toolbar"><span>학생 ${list.length}명 · 보고서 ${rows.filter(r => r.saved).length}건</span><span>발송가능 ${sendable}</span>${['일괄 입력', '반 서술', '순서', '이전값 일괄 가져오기', '전체 자동작성', '일괄 저장', 'ClassNote 일괄 발송', '반 전체 공지'].map(l => off(l, 'small')).join('')}</div>
      <div class="v2s-scroll live-scroll os-scroll" data-scroll-key="os-grid"><table class="os-table"><thead><tr>${cols.map(c => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}">이 조건의 학생이 없습니다.</td></tr>`}</tbody></table></div>`;
  }
  // ── 발송 현황 ──
  function status(d, q, list) {
    const rows = list.flatMap(s => s.subjects.map(su => ({ s, su }))), n = k => rows.filter(r => r.su.sendStatus === k).length, read = rows.filter(r => r.su.report?.readAt).length;
    const excluded = n('excluded'), total = rows.length - excluded;
    const byClass = [...groups(list)].sort(([a], [b]) => (a === '반 미배정') - (b === '반 미배정') || a.localeCompare(b, 'ko'));
    return `<div class="os-toolbar">${[['todo', '미작성'], ['draft', '작성중'], ['sent', '발송완료']].map(([k, l]) => `<span class="os-mini">${l} ${n(k)}</span>`).join('')}<span class="os-mini">학부모 열람 ${read}</span><span>아직 안 보낸 ${total - n('sent')} / 전체 ${total}${excluded ? ` · 미발송 반 ${excluded} 제외` : ''}</span></div>
      <div class="v2s-scroll live-scroll os-scroll"><table class="os-table"><thead><tr><th>학생 · 반</th><th>오늘 진도</th><th>보고서</th><th>ClassNote</th><th>열람</th></tr></thead><tbody>${byClass.map(([g, ss]) => {
        const rs = ss.flatMap(s => s.subjects), todo = rs.filter(r => r.sendStatus === 'todo').length;
        return `<tr class="os-ghead"><th colspan="5">${h(g)} <small>${rs.every(r => r.reportOptout) ? '수업보고서 미발송 반 — 출결만 기록' : todo ? `미작성 ${todo}` : '전원 작성'}</small></th></tr>${ss.flatMap(s => s.subjects.map(su => `<tr><td><strong>${h(s.name)}</strong> <small>${h(su.name)}</small></td><td class="pre">${h(su.today || '—')}</td><td>${h(SEND[su.sendStatus])}</td><td>${h(su.report?.badge?.label || '—')}</td><td>${su.report?.views ? `${su.report.views}회` : '—'}</td></tr>`)).join('')}`;
      }).join('')}</tbody></table></div>`;
  }
  // ── 월간 발송 ──
  function history(d) {
    const days = d.history.days, list = Object.values(days), sum = k => list.reduce((n, x) => n + (x[k] || 0), 0);
    const cell = day => { if (!day) return '<td></td>'; const x = days[day]; return `<td class="${x ? (x.problem ? 'bad' : x.actionable ? 'warn' : x.sent >= x.target ? 'ok' : '') : 'none'}"><button type="button" data-os="go-day" data-v="${h(day)}" ${day > d.asOf ? 'disabled' : ''}><strong>${Number(day.slice(8))}</strong>${x ? `<small>학부모 발송 ${x.sent} / 작성 ${x.target}건</small>${x.problem ? `<small>실패 ${x.problem}</small>` : ''}${x.actionable ? `<small>보낼 수 있음 ${x.actionable}</small>` : ''}${x.pending ? `<small>대기 ${x.pending}</small>` : ''}` : ''}</button></td>`; };
    return `<div class="os-toolbar"><strong>${Number(d.history.month.slice(5))}월</strong><span>작성 ${sum('total')}건 · 학부모 발송 ${sum('sent')}/${sum('target')}</span><span class="os-legend"><i class="ok"></i>전부 발송 <i class="warn"></i>보낼 수 있음 <i class="bad"></i>실패 있음</span></div>
      <p class="v2s-note">${h(d.teacher.name)} 선생님 이름으로 적힌 보고서를 날짜별로 셉니다(2.0 월간 발송과 같은 기준). 날짜를 누르면 그날 카드 보기로 갑니다.</p>
      <div class="v2s-scroll live-scroll os-scroll"><table class="os-cal"><thead><tr>${'일월화수목금토'.split('').map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${d.history.weeks.map(w => `<tr>${w.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  S.register({ id: 'onescreen', label: '선생님 원스크린', render(ctx) {
    last = ctx;
    const q = ctx.query, e = ctx.load({ teacher: q.get('teacher') || '', date: q.get('date') || '', all: q.get('all') || '' });
    const head = '<div class="v2s-head"><h1>선생님 원스크린</h1><span class="v2s-badge">2.0 화면 · 복사본 보기 전용</span></div>';
    if (e.status === 'loading') return `${head}<p class="v2s-note">불러오는 중입니다…</p>`;
    if (e.status === 'error') return `${head}<p class="v2s-note">${h(e.error)}</p><button type="button" class="os-btn" data-os="retry">다시 불러오기</button>`;
    const d = e.data; if (!d.teacher) return `${head}<p class="v2s-note">담당 반이 있는 선생님이 없습니다.</p>`;
    const view = q.get('view') || 'card', list = visible(d, q);
    const body = view === 'grid' ? grid(d, q, list) : view === 'status' ? status(d, q, list) : view === 'history' ? history(d)
      : view === 'notice' ? '<p class="os-strip">학부모 공지(반 전체·개별) 작성과 발송은 복사본 보기 전용이라 열지 않습니다. 실제 발송은 하지 않습니다.</p>' : card(d, q, list);
    return `${head}${notes(d)}${topBar(d, q)}<div class="os os-${h(view)}">${body}</div>`;
  } });

  // One listener for the page: every change is a new address (back/forward and reload keep the same view).
  const go = patch => { if (!last) return; const p = Object.fromEntries(last.query); Object.assign(p, patch); for (const k of Object.keys(p)) if (p[k] === '' || p[k] == null) delete p[k]; last.go(p); };
  document.addEventListener('click', ev => {
    const t = ev.target.closest?.('[data-v2-screen="onescreen"] [data-os]'); if (!t || t.disabled) return;
    const k = t.dataset.os;
    if (k === 'set') go({ [t.dataset.k]: t.dataset.v, ...(t.dataset.k === 'date' ? { student: '' } : {}) });
    else if (k === 'day') { const d = last.query.get('date') || document.querySelector('[data-v2-screen="onescreen"] [data-os="date"]')?.value; if (d) go({ date: new Date(Date.parse(`${d}T00:00:00Z`) + Number(t.dataset.v) * 86400000).toISOString().slice(0, 10), student: '' }); }
    else if (k === 'go-day') go({ date: t.dataset.v, view: 'card', student: '' });
    else if (k === 'retry') last.refresh();
  });
  document.addEventListener('change', ev => {
    const t = ev.target.closest?.('[data-v2-screen="onescreen"] [data-os]'); if (!t) return;
    if (t.dataset.os === 'teacher') go({ teacher: t.value, date: '', student: '', class: '', all: '' });
    else if (t.dataset.os === 'date' && t.value) go({ date: t.value, student: '' });
  });
})();
