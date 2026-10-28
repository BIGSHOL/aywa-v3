// 수업 영역 두 번째 묶음 — 출석부·수업목록·보강·교재·수업보고서·직원 평가.
import { PRIORITY, addDays, countOf, family, field, md, metric, monthlyTrend, record, signal, sumOf, yymm } from './domain-snapshot-core.mjs';

const ATT = { present: '출석', late: '지각', absent: '결석', early_leave: '조퇴', makeup: '보강' };
const SEND = { success: '발송 완료', failed: '발송 실패', recalled: '회수', too_old: '기한 지남', none: '미발송' };
const status = (prefix, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${prefix}:${k}`, v]));

export async function attendanceFamilies(ctx) {
  const { sql, t, asOf, month, monthStart, subjectLabel, subjectFacets } = ctx;
  const out = {};
  // 정정된 출결은 최신 줄만(supersedes_id), 기준일까지, 테스트 학생 제외 — snapshot.mjs와 같은 규칙.
  const valid = sql`(select a.* from public.attendance_records a where a.tenant_id=${t} and a.session_date <= ${asOf} and not exists (select 1 from public.attendance_records b where b.tenant_id=${t} and b.supersedes_id=a.id) and a.student_id not in (select id from public.students where tenant_id=${t} and coalesce(is_test,false)))`;
  const rows = await sql`select v.id, v.student_id, s.name, s.status student_status, c.class_name, v.session_date::text d, v.status::text st from ${valid} v join public.students s on s.id=v.student_id and s.tenant_id=${t} left join public.classes c on c.id=v.class_id and c.tenant_id=${t} where v.session_date >= ${monthStart} order by (v.status='absent') desc, v.session_date desc, s.name`;
  const monthly = await sql`select to_char(session_date,'YYYY-MM') as month, round(100.0 * count(*) filter (where status in ('present','late')) / nullif(count(*),0), 1)::float8 as value from ${valid} v group by 1`;
  const [aux] = await sql`select (select count(*)::int from public.attendance_followups where tenant_id=${t}) followups, (select count(*)::int from public.attendance_followups where tenant_id=${t} and session_date >= ${monthStart}) month_followups, (select count(*)::int from public.kiosk_devices where tenant_id=${t}) kiosks, (select count(*)::int from public.kiosk_devices where tenant_id=${t} and is_active) active_kiosks, (select count(*)::int from public.attendance_checkins where tenant_id=${t}) checkins, (select count(*)::int from public.attendance_records where tenant_id=${t}) raw`;
  const absentBy = new Map();
  for (const r of rows) if (r.st === 'absent' && r.student_status === 'enrolled') absentBy.set(r.student_id, (absentBy.get(r.student_id) || 0) + 1);
  const repeat = new Set([...absentBy].filter(([, n]) => n >= 3).map(([id]) => id));
  const attended = rows.filter(r => ['present', 'late'].includes(r.st)).length;
  const rate = rows.length ? Math.round(attended / rows.length * 1000) / 10 : null;
  const evidence = rows.map(r => record({ id: r.id, label: `${r.name} · ${r.class_name || '반 없음'} · ${md(r.d)}`, date: r.d, status: ATT[r.st] || '기타', fields: [field('수업', r.class_name)], facets: [`status:${r.st}`, repeat.has(r.student_id) && 'repeat-absence'] }));
  out.attendance = family('attendance', '출석부(월별·오늘·출결 모드·자리·키오스크)', {
    summary: `${month} 출결 ${rows.length}칸, 출석률 ${rate === null ? '—' : `${rate}%`}. 최근 결석 3회 이상 ${repeat.size}명.`,
    metrics: [metric('이번 달 출결 칸', rows.length, '칸', '정정 반영 · 기준일까지'), metric('출석률', rate, '%', '(출석+지각) ÷ 기록 칸 전부 · 보강은 출석이 아님'), metric('결석', rows.filter(r => r.st === 'absent').length, '칸'), metric('최근 결석 3회 이상', repeat.size, '명', '이번 달 · 수업 칸마다 셈'), metric('이번 달 결석 후속 처리', aux.month_followups, '건', `전체 ${aux.followups}건`), metric('키오스크 기기', aux.kiosks, '대', `사용 중 ${aux.active_kiosks}대 · 체크인 ${aux.checkins}건`)],
    trend: monthlyTrend('월별 출석률', '%', monthly, asOf), evidence,
    facetOrder: [...Object.keys(ATT).map(k => `status:${k}`), 'repeat-absence'], facetLabels: { ...status('status', ATT), 'repeat-absence': '최근 결석 3회 이상 원생의 출결' }, recordSource: 'attendance_records',
    signals: repeat.size ? [signal({ id: 'attendance-repeat-absence', title: `최근 결석 3회 이상 ${repeat.size}명`, summary: `${month} 결석이 3회 이상 기록된 재원생입니다. 결석은 수업 칸마다 따로 셉니다.`, priority: PRIORITY.check, source: '출석부 · 정정 반영 출결', recordIds: rows.filter(r => r.st === 'absent' && repeat.has(r.student_id)).map(r => r.id), draft: { title: '결석 사유 및 보강 계획 확인', body: '이번 달 결석이 3회 이상인 원생의 결석 사유와 보호자 연락 여부, 보강 계획을 확인해 주세요.' } })] : [],
    sourceLabel: '출석부 · 결석 후속 · 키오스크', coverageNote: `근거 목록은 ${monthStart}부터 기준일까지의 출결 칸 전체이며 결석을 먼저 보여 줍니다. 정정 전 기록·미래 수업일·테스트 학생은 빼고, 메모는 보여 주지 않습니다.`,
    sources: [{ table: 'attendance_records', rows: aux.raw }, { table: 'attendance_followups', rows: aux.followups }, { table: 'kiosk_devices', rows: aux.kiosks }],
  });

  // 수업목록 — 운영 반(근거)·현재 수강(시작 전·종료·휴원 제외)·담임 변경 예약·오늘 위임.
  const live = sql`(select e.* from public.enrollments e where e.tenant_id=${t} and (e.start_date is null or e.start_date <= ${asOf}) and (e.end_date is null or e.end_date >= ${asOf}) and not coalesce(e.on_hold,false) and e.student_id not in (select id from public.students where tenant_id=${t} and coalesce(is_test,false)))`;
  const classes = await sql`select c.id, c.class_name, c.subject, coalesce(c.is_special,false) special, c.pending_teacher_id is not null pending, u.display_name teacher, r.name room, count(l.id)::int students from public.classes c left join ${live} l on l.class_id=c.id left join public.users u on u.id=c.teacher_id and u.tenant_id=${t} left join public.classrooms r on r.id=c.classroom_id and r.tenant_id=${t} where c.tenant_id=${t} and c.is_active and not coalesce(c.is_makeup_pool,false) group by c.id, c.class_name, c.subject, c.is_special, c.pending_teacher_id, u.display_name, r.name order by students desc, c.class_name`;
  const [cl] = await sql`select (select count(*)::int from public.classes where tenant_id=${t}) rows_all, (select count(*)::int from public.enrollments where tenant_id=${t}) enrollments_all, (select count(*)::int from public.classes where tenant_id=${t} and closed_at between ${`${asOf.slice(0, 4)}-01-01`} and ${asOf}) closed, (select count(*)::int from ${live} l) enrollments, (select count(distinct student_id)::int from ${live} l) students, (select count(*)::int from public.classrooms where tenant_id=${t}) rooms, (select count(*)::int from public.class_delegations where tenant_id=${t} and revoked_at is null and from_date <= ${asOf} and to_date >= ${asOf}) delegations`;
  out.classes = family('classes', '수업목록(반·수강·인수인계)', {
    summary: `운영 중인 반 ${classes.length}개, 현재 수강 ${cl.enrollments}건(원생 ${cl.students}명). 담임 변경 예약 ${classes.filter(c => c.pending).length}개 반.`,
    metrics: [metric('운영 중인 반', classes.length, '개', '보강용 반 제외'), metric('특강 반', classes.filter(c => c.special).length, '개'), metric('현재 수강', cl.enrollments, '건', '시작 전·종료·휴원 제외'), metric('수강 중인 원생', cl.students, '명'), metric('담임 변경 예약', classes.filter(c => c.pending).length, '개 반'), metric('올해 종강한 반', cl.closed, '개'), metric('오늘 수업 위임', cl.delegations, '건'), metric('강의실', cl.rooms, '개')],
    evidence: classes.map(r => record({ id: r.id, label: r.class_name, status: subjectLabel(r.subject), fields: [field('담임', r.teacher), field('수강', `${r.students}명`), field('강의실', r.room)], facets: [`subject:${r.subject || 'none'}`, r.special && 'special', r.pending && 'pending-teacher'] })),
    facetOrder: [...Object.keys(subjectFacets), 'special', 'pending-teacher'], facetLabels: { ...subjectFacets, special: '특강', 'pending-teacher': '담임 변경 예약' }, recordSource: 'classes',
    sourceLabel: '반 · 수강 · 강의실 · 수업 위임', coverageNote: '근거 목록은 운영 중인 반 전체(수강 인원 많은 순)입니다. 종강한 반과 보강용 반은 빼고 셉니다.',
    sources: [{ table: 'classes', rows: cl.rows_all }, { table: 'enrollments', rows: cl.enrollments_all }, { table: 'classrooms', rows: cl.rooms }],
  });

  // 보강 — 보강 예약(근거)과 이번 달 보강 출결.
  const res = await sql`select m.id, s.name, c.class_name, m.absence_date::text absence, m.makeup_date::text makeup, m.status from public.makeup_reservations m join public.students s on s.id=m.student_id and s.tenant_id=${t} left join public.classes c on c.id=m.class_id and c.tenant_id=${t} where m.tenant_id=${t} and not coalesce(s.is_test,false) order by m.makeup_date desc`;
  const [mk] = await sql`select (select count(*)::int from public.makeup_cases where tenant_id=${t}) cases, (select count(*)::int from ${valid} v where status='makeup' and session_date >= ${monthStart}) month_makeup`;
  const overdue = res.filter(r => r.status === 'reserved' && r.makeup < asOf), upcoming = res.filter(r => r.status === 'reserved' && r.makeup >= asOf);
  out.makeups = family('makeups', '보강관리', {
    summary: `보강 예약 ${res.length}건(예정 ${upcoming.length}·완료 ${res.filter(r => r.status === 'done').length}). ${month} 보강 출결 ${mk.month_makeup}칸.`,
    metrics: [metric('보강 예약', res.length, '건'), metric('다가오는 보강', upcoming.length, '건'), metric('보강일이 지난 예약', overdue.length, '건', '보강일 출결이 저장되지 않은 예약'), metric('이번 달 보강 출결', mk.month_makeup, '칸'), metric('보강 처리 기록', mk.cases, '건', mk.cases ? '' : '기록 없음')],
    evidence: res.map(r => record({ id: r.id, label: `${r.name} · ${r.class_name || '반 없음'} · ${md(r.makeup)} 보강`, date: r.makeup, status: r.status === 'done' ? '완료' : '예약', detail: `결석 ${r.absence}`, fields: [field('수업', r.class_name)], facets: [`status:${r.status}`, overdue.includes(r) && 'overdue'] })),
    facetLabels: { 'status:reserved': '예약', 'status:done': '완료', overdue: '보강일 지남' }, recordSource: 'makeup_reservations',
    signals: overdue.length ? [signal({ id: 'makeup-overdue', title: `보강일이 지난 예약 ${overdue.length}건`, summary: '보강일이 지났는데 보강 출결이 저장되지 않은 예약입니다.', priority: PRIORITY.check, source: '보강 예약', recordIds: overdue.map(r => r.id), draft: { title: '지난 보강 예약 확인', body: '보강일이 지난 예약의 실제 보강 여부를 확인하고 출결을 정리해 주세요.' } })] : [],
    sourceLabel: '보강 예약 · 보강 출결', coverageNote: '근거 목록은 보강 예약 전체입니다. 예약 없이 바로 기록한 보강은 이번 달 보강 출결 수에만 들어갑니다.',
    sources: [{ table: 'makeup_reservations', rows: res.length }, { table: 'makeup_cases', rows: mk.cases }],
  });

  Object.assign(out, await reportFamilies(ctx));
  return out;
}

async function reportFamilies({ sql, t, asOf, month, monthStart, notTest, subjectLabel, subjectFacets }) {
  const out = {};
  // 교재목록 — 사용 중인 교재(근거)·차수·반 배정 계획.
  const books = await sql`select b.id, b.title, b.subject, b.skill_area, b.session_count, (select count(*)::int from public.textbook_lessons l where l.tenant_id=${t} and l.textbook_id=b.id) lessons, (select count(*)::int from public.class_textbook_plans p where p.tenant_id=${t} and p.textbook_id=b.id and p.is_active) plans from public.textbooks b where b.tenant_id=${t} and b.is_active order by plans desc, b.subject, b.title`;
  const [tb] = await sql`select (select count(*)::int from public.textbooks where tenant_id=${t}) rows_all, (select count(*)::int from public.class_textbook_plans where tenant_id=${t} and is_active) plans, (select count(*)::int from public.class_textbook_plans where tenant_id=${t} and is_active and last_applied_at is not null) applied`;
  out.textbooks = family('textbooks', '교재목록(커리큘럼·반 배정)', {
    summary: `사용 중인 교재 ${books.length}권·차수 ${books.reduce((n, b) => n + b.lessons, 0)}개, 반 배정 계획 ${tb.plans}건(시트 반영 ${tb.applied}건).`,
    metrics: [metric('사용 중인 교재', books.length, '권'), metric('교재 차수', books.reduce((n, b) => n + b.lessons, 0), '차'), metric('반 배정 계획', tb.plans, '건'), metric('시트에 반영된 배정', tb.applied, '건'), metric('반에 배정된 교재', books.filter(b => b.plans).length, '권')],
    evidence: books.map(r => record({ id: r.id, label: r.title, status: subjectLabel(r.subject), detail: r.skill_area || '', fields: [field('차수', r.lessons), field('배정된 반', r.plans)], facets: [`subject:${r.subject || 'none'}`, r.plans ? 'assigned' : 'unassigned'] })),
    facetOrder: [...Object.keys(subjectFacets), 'assigned', 'unassigned'], facetLabels: { ...subjectFacets, assigned: '반 배정 있음', unassigned: '반 배정 없음' }, recordSource: 'textbooks',
    sourceLabel: '교재 마스터 · 차수 · 반 배정', coverageNote: '근거 목록은 사용 중인 교재 전체입니다. 쓰지 않는 교재는 뺍니다.',
    sources: [{ table: 'textbooks', rows: tb.rows_all }, { table: 'class_textbook_plans', rows: tb.plans }],
  });

  // 수업보고서·ClassNote — 수업일 기준. 발송 기한 = 오늘 포함 7일.
  const window7 = addDays(asOf, -6);
  const reports = await sql`select r.id, s.name, r.subject, r.report_date::text d, r.teacher_name, coalesce(r.classnote_status,'none') st, r.classnote_read_at is not null rd, r.ment_source from public.lesson_reports r join public.students s on s.id=r.student_id and s.tenant_id=${t} where r.tenant_id=${t} and r.report_date <= ${asOf} and not coalesce(s.is_test,false) order by r.report_date desc, r.created_at desc`;
  const parents = await sql`select coalesce(category,'none') as key, count(*)::int count from public.classnote_parent_messages where tenant_id=${t} and (posted_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf} group by 1`;
  const [rating] = await sql`select rubric, count(*)::int c, round(avg(points)::numeric,2)::float8 avg from public.lesson_report_ratings where tenant_id=${t} and rubric = (select rubric from public.lesson_report_ratings where tenant_id=${t} order by created_at desc limit 1) group by 1`;
  const [aux] = await sql`select (select count(*)::int from public.share_link_views where tenant_id=${t} and (viewed_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf}) views, (select count(*)::int from public.classnote_parent_messages where tenant_id=${t}) messages, (select count(*)::int from public.lesson_report_ratings where tenant_id=${t}) ratings`;
  const monthRows = reports.filter(r => r.d >= monthStart), failed = reports.filter(r => r.st === 'failed' && r.d >= window7);
  const evidence = reports.map(r => record({ id: r.id, label: r.name, date: r.d, status: SEND[r.st] || '기타', fields: [field('과목', subjectLabel(r.subject)), field('작성', r.teacher_name), field('읽음', r.st === 'success' ? (r.rd ? '예' : '아니요') : null)], facets: [`send:${r.st}`, `subject:${r.subject || 'none'}`, r.d >= monthStart && 'this-month', failed.includes(r) && 'failed-in-window'] }));
  out['lesson-reports'] = family('lesson-reports', '수업보고서·ClassNote 발송', {
    summary: `${month} 보고서 ${monthRows.length}건 중 발송 완료 ${monthRows.filter(r => r.st === 'success').length}건·학부모 읽음 ${monthRows.filter(r => r.rd).length}건. 발송 기한이 남은 발송 실패 ${failed.length}건.`,
    metrics: [metric('이번 달 보고서', monthRows.length, '건', '수업일 기준'), metric('발송 완료', monthRows.filter(r => r.st === 'success').length, '건'), metric('학부모 읽음', monthRows.filter(r => r.st === 'success' && r.rd).length, '건'), metric('자동작성 사용', monthRows.filter(r => ['auto', 'auto_edited'].includes(r.ment_source)).length, '건', '자동작성 · 자동작성 후 수정'), metric('발송 기한이 남은 발송 실패', failed.length, '건', `발송 기한 ${window7}~${asOf}`), metric('이번 달 학부모 글', sumOf(parents), '건', `결석 ${countOf(parents, 'absence')} · 지각 ${countOf(parents, 'late')} · 조퇴 ${countOf(parents, 'early_leave')}`), metric('공유 링크 열람', aux.views, '회', '이번 달'), metric('평점 평균', rating?.avg ?? null, '점', rating ? `지금 채점 기준 ${rating.c}건 · 참고용` : '평점 없음')],
    trend: monthlyTrend('월별 보고서', '건', await sql`select to_char(report_date,'YYYY-MM') as month, count(*)::int as value from public.lesson_reports where tenant_id=${t} and report_date <= ${asOf} ${notTest} group by 1`, asOf),
    evidence, summaryRecords: [...evidence.filter(r => r.facetIds.includes('failed-in-window')), ...evidence.filter(r => !r.facetIds.includes('failed-in-window'))],
    facetOrder: ['this-month', 'failed-in-window', ...Object.keys(SEND).map(k => `send:${k}`), ...Object.keys(subjectFacets)], facetLabels: { 'this-month': '이번 달', 'failed-in-window': '발송 기한이 남은 발송 실패', ...status('send', SEND), ...subjectFacets }, recordSource: 'lesson_reports',
    signals: failed.length ? [signal({ id: 'report-send-failed', title: `발송 기한이 남은 발송 실패 ${failed.length}건`, summary: '오늘 포함 7일 발송 기한 안에서 ClassNote 발송에 실패한 보고서입니다.', priority: PRIORITY.check, source: '수업보고서 발송 상태', recordIds: failed.map(r => r.id), draft: { title: '보고서 발송 실패 확인', body: '발송 기한 안에서 실패한 수업보고서가 있습니다. 반 보드 연결과 실패 사유를 확인하고 다시 보내 주세요.' } })] : [],
    sourceLabel: '수업보고서 · 발송 상태 · 학부모 글 · 평점', coverageNote: '근거 목록은 기준일까지의 보고서 전체(최근 수업일 순)입니다. 이전 시스템에서 옮긴 보고서가 포함되며, 보고서와 학부모 글 본문은 보여 주지 않습니다.',
    sources: [{ table: 'lesson_reports', rows: reports.length }, { table: 'classnote_parent_messages', rows: aux.messages }, { table: 'lesson_report_ratings', rows: aux.ratings }],
  });

  // 직원 평가·포트폴리오 — 원장만 보는 화면. 점수 값은 싣지 않고 기록 상태만.
  const portfolio = await sql`select p.teacher_id||':'||p.month id, u.display_name, p.month, p.class_count, p.known_count, p.closed_at is not null closed from public.teacher_portfolio_months p join public.users u on u.id=p.teacher_id and u.tenant_id=${t} where p.tenant_id=${t} order by p.month desc, u.display_name`;
  const judgments = await sql`select state as key, count(*)::int count from public.teacher_satisfaction_judgments where tenant_id=${t} group by 1`;
  const [cr] = await sql`select count(*)::int reviews, max(to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD')) last_review from public.academy_documents where tenant_id=${t} and form_type='class_review'`;
  const pending = countOf(judgments, 'pending');
  // 만족도 확인 대기 글 = 신호의 근거(원장 10-28 "만족도를 확인하러 가고 싶은데 어디로 가야하는지 배선 같은게 없음"). 학생·반·담임·날짜로 이름을 붙인다.
  const satisfaction = pending ? await sql`select j.id, s.name student, c.class_name, u.display_name teacher, j.posted_on::text d, j.verdict, j.method, j.reason, j.phrase from public.teacher_satisfaction_judgments j left join public.students s on s.id=j.student_id and s.tenant_id=${t} left join public.classes c on c.id=j.class_id and c.tenant_id=${t} left join public.users u on u.id=c.teacher_id and u.tenant_id=${t} where j.tenant_id=${t} and j.state='pending' order by j.posted_on desc, j.id` : [];
  const VERDICT = { plus: '만족 쪽', minus: '불만 쪽' };
  const satisfactionRecords = satisfaction.map(r => record({ id: r.id, label: `${r.student || '학생 모름'} · ${r.class_name || '반 모름'} · ${md(r.d)} 학부모 글`, date: r.d, status: '확인 대기', detail: r.reason || r.phrase || '', fields: [field('담임', r.teacher), field('판정 방식', r.method === 'ai' ? 'AI 판정' : '문구 규칙'), field('잠정 판정', VERDICT[r.verdict] || '판정 못 함')], facets: ['satisfaction:pending'] }));
  out['class-review'] = family('class-review', '직원 평가·직원 포트폴리오', {
    summary: `수업 평가 문서 ${cr.reviews}건, 직원 포트폴리오 ${new Set(portfolio.map(p => p.display_name)).size}명·월 기록 ${portfolio.length}건(마감 ${portfolio.filter(p => p.closed).length}건). 만족도 확인 대기 ${pending}건.`,
    metrics: [metric('수업 평가 문서', cr.reviews, '건', `최근 ${cr.last_review || '기록 없음'}`), metric('포트폴리오 대상 직원', new Set(portfolio.map(p => p.display_name)).size, '명'), metric('포트폴리오 월 기록', portfolio.length, '건', `마감 ${portfolio.filter(p => p.closed).length}건`), metric('만족도 확인 대기', pending, '건', `반영 ${countOf(judgments, 'applied')} · 제외 ${countOf(judgments, 'dismissed')}`)],
    evidence: [...satisfactionRecords, ...portfolio.map(r => record({ id: r.id, label: `${r.display_name} · ${yymm(r.month)}`, detail: '', status: r.closed ? '마감' : '집계 중', fields: [field('담당 반', r.class_count), field('계산된 항목', r.known_count)], facets: [r.closed ? 'closed' : 'open', `month:${r.month}`] }))],
    facetOrder: ['satisfaction:pending', 'open', 'closed', ...[...new Set(portfolio.map(p => p.month))].map(m => `month:${m}`)], facetLabels: { 'satisfaction:pending': '만족도 확인 대기', closed: '마감', open: '집계 중', ...Object.fromEntries([...new Set(portfolio.map(p => p.month))].map(m => [`month:${m}`, yymm(m)])) }, recordSource: 'teacher_portfolio_months',
    signals: pending ? [signal({ id: 'satisfaction-pending', title: `만족도 확인 대기 ${pending}건`, summary: '문구만으로 판정하지 못해 사람이 확인할 학부모 글입니다.', priority: PRIORITY.check, source: '강사평가 만족도 판정', recordIds: satisfaction.map(r => r.id), facet: 'satisfaction:pending', draft: { title: '만족도 확인 대기 글 검토', body: '강사평가 만족도 판정에서 확인 대기로 남은 학부모 글을 검토해 주세요.' } })] : [],
    sourceLabel: '수업 평가 문서 · 직원 포트폴리오 · 만족도 판정', coverageNote: '근거 목록은 만족도 확인 대기 학부모 글과 직원 포트폴리오 월 기록 전체이며 점수 값은 보여 주지 않습니다. 평가 구성은 기본값을 따릅니다.',
    sources: [{ table: 'teacher_portfolio_months', rows: portfolio.length }, { table: 'teacher_satisfaction_judgments', rows: sumOf(judgments) }, { table: 'academy_documents', rows: cr.reviews }],
  });
  return out;
}
