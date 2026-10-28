// 수업 영역 패밀리 — 원스크린·영상 숙제·시간표·강사 시트(+ 두 번째 묶음).
import { PRIORITY, addDays, countOf, family, field, md, metric, monthlyTrend, record, signal, sumOf } from './domain-snapshot-core.mjs';
import { attendanceFamilies } from './domain-snapshot-academic2.mjs';
import { teacherWorkWeekly } from './v2-teacher-work.mjs';
import { importV2 } from './v2-bridge.mjs';

const DAY = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const NOTICE = { success: '발송 완료', partial: '일부 실패', failed: '발송 실패', revoked: '회수' };
const prefixed = (prefix, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${prefix}:${k}`, v]));

export async function academicFamilies(ctx) {
  const { sql, t, asOf, month, monthStart, capturedAt, notTest, subjectLabel, subjectFacets } = ctx;
  const out = {};
  const week = addDays(asOf, -6);

  // 선생님 수업보고서(2.0 원스크린, 원장 10-28 이름 변경) — 학생 칸 기록과 그 화면에서 쓴 보고서·ClassNote 공지.
  const [os] = await sql`select count(*)::int total, count(*) filter (where session_date >= ${monthStart})::int rows_m, count(distinct student_id) filter (where session_date >= ${monthStart})::int students, count(distinct class_id) filter (where session_date >= ${monthStart})::int classes, max(session_date)::text last from public.onescreen_daily_sessions where tenant_id=${t} and session_date <= ${asOf} ${notTest}`;
  // KPI = 최근 변화(원장 10-28 "원하는건 추세"): 2.0 운영실 '강사별 업무 현황'의 판정을 최근 7일 창 8개로 — 원장 첫 화면 '운영 상태'와 같은 함수(teacherWorkWeekly).
  // 2.0 판정을 불러오지 못하면(모듈·원본 파일) 이 KPI만 비우고 나머지 영역은 그대로 뜬다.
  let windows = null, osKpis = [];
  try { ({ windows, kpis: osKpis } = await teacherWorkWeekly({ sql, asOf, tenantId: t, importV2 })); } catch (e) { console.error(`workspaces.onescreen KPI: ${e.message}`); }
  const shownPct = v => (v === null ? '기록 없음' : `${v.toFixed(1)}%`);
  // 공지마다 누가·어느 반·누구에게 보냈는지로 이름을 붙인다(원장 10-28 "전부 이름이 일치하는데 뭘 말하고 싶은건지 알 수가 없음"). 본문은 싣지 않는다.
  const notices = await sql`select n.id, n.status, to_char(n.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, case when jsonb_typeof(n.targets)='array' then jsonb_array_length(n.targets) end targets,
    u.display_name sender, case when jsonb_typeof(n.targets)='array' then (select array_agg(distinct e->>'className') from jsonb_array_elements(n.targets) e where e->>'className' is not null) end class_names,
    case when jsonb_typeof(n.targets)='array' then (select e->>'studentName' from jsonb_array_elements(n.targets) e where e->>'studentName' is not null limit 1) end first_student
    from public.classnote_notices n left join public.users u on u.id=n.created_by and u.tenant_id=n.tenant_id where n.tenant_id=${t} order by n.created_at desc`;
  const noticeLabel = n => { const cls = n.class_names || [], who = n.first_student ? `${n.first_student}${n.targets > 1 ? ` 외 ${n.targets - 1}명` : ''}` : n.targets ? `${n.targets}명` : '대상 없음';
    return `${n.sender || '보낸 사람 모름'} → ${cls.length ? `${cls[0]}${cls.length > 1 ? ` 외 ${cls.length - 1}개 반` : ''} · ` : ''}${who}`; };
  const failedNotices = notices.filter(n => ['failed', 'partial'].includes(n.status) && n.d >= week);
  out.onescreen = family('onescreen', '선생님 수업보고서', {
    summary: windows ? `최근 7일(${windows.at(-1).label}) ${osKpis.map(k => `${k.label} ${shownPct(k.value)}`).join(' · ')}.` : '수업보고서 KPI 추세를 계산하지 못했습니다.',
    metrics: osKpis,
    trend: monthlyTrend('월별 원스크린 학생 칸 기록', '건', await sql`select to_char(session_date,'YYYY-MM') as month, count(*)::int as value from public.onescreen_daily_sessions where tenant_id=${t} and session_date <= ${asOf} ${notTest} group by 1`, asOf),
    evidence: notices.map(n => record({ id: n.id, label: noticeLabel(n), date: n.d, status: NOTICE[n.status] || '기타', fields: [field('대상', n.targets === null ? null : `${n.targets}명`), field('반', (n.class_names || []).join(', ') || null)], facets: [`status:${n.status}`] })),
    facetLabels: prefixed('status', NOTICE), recordSource: 'classnote_notices',
    signals: failedNotices.length ? [signal({ id: 'onescreen-notice-failed', title: `공지 발송 실패 ${failedNotices.length}건`, summary: '최근 7일 공지 중 일부 또는 전체 발송에 실패한 기록입니다.', priority: PRIORITY.check, source: 'ClassNote 공지 발송 결과', recordIds: failedNotices.map(n => n.id), draft: { title: '공지 발송 실패 확인', body: '최근 7일 안에 발송에 실패한 공지가 있습니다. 대상과 결과를 확인하고 필요한 경우 다시 보내 주세요.' } })] : [],
    sourceLabel: '원스크린 학생 칸 기록 · ClassNote 공지', coverageNote: `${os.last ? `원스크린 기록은 ${os.last}까지 있습니다.` : '원스크린 기록이 없습니다.'} 근거 목록은 ClassNote 공지 전체이며 공지 본문은 보여 주지 않습니다.`,
    sources: [{ table: 'onescreen_daily_sessions', rows: os.total }, { table: 'classnote_notices', rows: notices.length }],
  });

  // 영상 숙제 — 저장된 영상(근거)·검사 장부·AI 참고 메모·제출 링크.
  const videos = await sql`select h.id, s.name, h.subject, h.source, h.status, to_char(h.posted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, to_char(h.uploaded_at at time zone 'Asia/Seoul','YYYY-MM-DD') up from public.student_homework_videos h join public.students s on s.id=h.student_id and s.tenant_id=${t} where h.tenant_id=${t} and not coalesce(s.is_test,false) order by h.posted_at desc nulls last`;
  const marks = await sql`select status as key, count(*)::int count from public.video_homework_marks where tenant_id=${t} and homework_date between ${monthStart} and ${asOf} ${notTest} group by 1`;
  const reviews = await sql`select stage as key, count(*)::int count from public.homework_video_reviews where tenant_id=${t} group by 1`;
  const [links] = await sql`select count(*) filter (where revoked_at is null and expires_at > ${capturedAt}::timestamptz)::int active, count(*)::int total from public.homework_video_links where tenant_id=${t} ${notTest}`;
  const failedVideos = videos.filter(v => v.status === 'failed');
  out['video-homework'] = family('video-homework', '영상 숙제(제출 사이트·장부·AI 검토)', {
    summary: `저장된 숙제 영상 ${videos.length - failedVideos.length}건(학생 ${new Set(videos.map(v => v.name)).size}명), ${month} 저장 ${videos.filter(v => v.up >= monthStart).length}건. 업로드 실패 ${failedVideos.length}건.`,
    metrics: [metric('저장된 영상', videos.length - failedVideos.length, '건'), metric('이번 달 저장', videos.filter(v => v.up >= monthStart).length, '건', 'Drive 저장일 기준'), metric('업로드 실패', failedVideos.length, '건'), metric('이번 달 장부 완료', countOf(marks, 'submitted'), '칸', '선생님 검사 장부 · 숙제일 기준'), metric('이번 달 장부 미수행', countOf(marks, 'missing'), '칸'), metric('AI 참고 메모 완료', countOf(reviews, 'done'), '건', `실패 ${countOf(reviews, 'failed')}건`), metric('유효한 제출 링크', links.active, '개', `만료·해지 전 · 전체 발급 ${links.total}개`)],
    trend: monthlyTrend('월별 영상 저장', '건', await sql`select to_char(uploaded_at at time zone 'Asia/Seoul','YYYY-MM') as month, count(*)::int as value from public.student_homework_videos where tenant_id=${t} and uploaded_at is not null ${notTest} group by 1`, asOf),
    evidence: videos.map(r => record({ id: r.id, label: r.name, date: r.d, status: r.status === 'uploaded' ? '저장됨' : '업로드 실패', fields: [field('과목', subjectLabel(r.subject)), field('경로', r.source === 'link' ? '올리기 사이트' : 'ClassNote'), field('저장일', r.up)], facets: [`source:${r.source === 'link' ? 'link' : 'classnote'}`, `subject:${r.subject || 'none'}`, r.status === 'failed' && 'status:failed'] })),
    facetLabels: { 'source:link': '올리기 사이트', 'source:classnote': 'ClassNote', 'status:failed': '업로드 실패', ...subjectFacets }, recordSource: 'student_homework_videos',
    signals: failedVideos.length ? [signal({ id: 'video-upload-failed', title: `영상 업로드 실패 ${failedVideos.length}건`, summary: '저장에 실패한 숙제 영상입니다.', priority: PRIORITY.check, source: '숙제 영상 저장 상태', recordIds: failedVideos.map(r => r.id), draft: { title: '숙제 영상 업로드 실패 확인', body: '저장에 실패한 숙제 영상이 있습니다. 연동 PC 상태와 원본 영상을 확인해 주세요.' } })] : [],
    sourceLabel: '숙제 영상 · 검사 장부 · AI 참고 메모', coverageNote: '근거 목록은 학생이 올린 숙제 영상 전체입니다. 영상 파일과 AI 메모 본문은 보여 주지 않습니다.',
    sources: [{ table: 'student_homework_videos', rows: videos.length }, { table: 'video_homework_marks', rows: sumOf(marks) }, { table: 'homework_video_reviews', rows: sumOf(reviews) }, { table: 'homework_video_links', rows: links.total }],
  });

  // 시간표 — 기준일에 유효한 배치만(지난 이력 행 제외, gotcha #88).
  const slots = await sql`select s.id, c.class_name, c.subject, s.day_of_week::text dow, to_char(s.start_time,'HH24:MI') st, to_char(s.end_time,'HH24:MI') et, extract(epoch from (s.end_time - s.start_time))/60 minutes, coalesce(su.display_name, cu.display_name, s.slot_teacher_label) teacher, coalesce(sr.name, cr.name, s.slot_room_label) room from public.class_schedules s join public.classes c on c.id=s.class_id and c.tenant_id=${t} left join public.users su on su.id=s.teacher_id and su.tenant_id=${t} left join public.users cu on cu.id=c.teacher_id and cu.tenant_id=${t} left join public.classrooms sr on sr.id=s.classroom_id and sr.tenant_id=${t} left join public.classrooms cr on cr.id=c.classroom_id and cr.tenant_id=${t} where s.tenant_id=${t} and c.is_active and not coalesce(c.is_makeup_pool,false) and (s.valid_from is null or s.valid_from <= ${asOf}) and (s.valid_to is null or s.valid_to >= ${asOf}) order by array_position(array['mon','tue','wed','thu','fri','sat','sun'], s.day_of_week::text), s.start_time, c.class_name`;
  const [tt] = await sql`select (select count(*)::int from public.class_schedules where tenant_id=${t}) rows_all, (select count(*)::int from public.timetable_import_logs where tenant_id=${t}) imports, (select max(to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD')) from public.timetable_import_logs where tenant_id=${t}) last_import, (select count(*)::int from public.timetable_lab_drafts where tenant_id=${t}) drafts, (select count(*)::int from public.timetable_lab_apply_jobs where tenant_id=${t} and status='applied') applied`;
  const hours = Math.round(slots.reduce((n, r) => n + Number(r.minutes || 0), 0) / 60);
  out.timetable = family('timetable', '시간표(배치·가져오기·편집기·메모)', {
    summary: `${asOf} 기준 수업 배치 ${slots.length}칸(반 ${new Set(slots.map(s => s.class_name)).size}개), 주간 수업 ${hours}시간. 시트 가져오기 ${tt.imports}회.`,
    metrics: [metric('기준일 수업 배치', slots.length, '칸', '운영 중인 반 · 기준일에 유효한 배치'), metric('배치된 반', new Set(slots.map(s => s.class_name)).size, '개'), metric('주간 수업 시간', hours, '시간'), metric('시트 가져오기', tt.imports, '회', `마지막 ${tt.last_import || '기록 없음'}`), metric('연습실 초안', tt.drafts, '개'), metric('연습본 운영 반영', tt.applied, '회')],
    evidence: slots.map(r => record({ id: r.id, label: `${r.class_name} · ${DAY[r.dow] || ''} ${r.st}`, detail: `${DAY[r.dow] || ''}요일 ${r.st}~${r.et}`, status: subjectLabel(r.subject), fields: [field('선생님', r.teacher), field('강의실', r.room)], facets: [`day:${r.dow}`, `subject:${r.subject || 'none'}`] })),
    facetOrder: [...Object.keys(DAY).map(d => `day:${d}`), ...Object.keys(subjectFacets)], facetLabels: { ...Object.fromEntries(Object.entries(DAY).map(([k, v]) => [`day:${k}`, `${v}요일`])), ...subjectFacets }, recordSource: 'class_schedules',
    sourceLabel: '반 배치 · 시트 가져오기 · 연습실', coverageNote: '근거 목록은 기준일에 유효한 수업 배치 전체입니다. 이미 끝난 배치 이력과 예약된 미래 배치는 세지 않습니다.',
    sources: [{ table: 'class_schedules', rows: tt.rows_all }, { table: 'timetable_import_logs', rows: tt.imports }, { table: 'timetable_lab_drafts', rows: tt.drafts }],
  });

  // 강사 시트 — 영어 시트 계획(근거)·학생 기록, 수학 학습 목표, 회차 미룸·당김.
  const lines = await sql`select p.id, c.class_name, p.plan_date::text d, p.textbook, p.page_range, p.term_mode from public.class_sheet_plan_lines p join public.classes c on c.id=p.class_id and c.tenant_id=${t} where p.tenant_id=${t} order by p.plan_date desc, c.class_name, p.line_no`;
  const [cs] = await sql`select (select count(*)::int from public.class_sheet_student_marks where tenant_id=${t}) marks, (select count(*)::int from public.class_sheet_student_marks where tenant_id=${t} and mark_date between ${monthStart} and ${asOf}) month_marks, (select count(*)::int from public.class_sheet_goals where tenant_id=${t}) goals, (select count(*)::int from public.math_learning_track_goals where tenant_id=${t}) track_goals, (select count(*)::int from public.math_month_goals where tenant_id=${t}) month_goals, (select count(*)::int from public.class_lesson_shifts where tenant_id=${t}) shifts`;
  const evidence = lines.map(r => record({ id: r.id, label: `${r.class_name} · ${md(r.d)}${r.textbook ? ` · ${r.textbook}` : ''}`, date: r.d, status: r.term_mode === 'exam' ? '시험 기간' : '정규', fields: [field('교재', r.textbook), field('범위', r.page_range)], facets: [`term:${r.term_mode === 'exam' ? 'exam' : 'regular'}`, `when:${r.d > asOf ? 'planned' : 'done'}`] }));
  out['class-sheets'] = family('class-sheets', '강사 시트(영어 ECS·수학 MCS)', {
    summary: `${month} 영어 시트 계획 ${lines.filter(l => l.d >= monthStart && l.d <= asOf).length}줄·학생 기록 ${cs.month_marks}칸. 수학 전체 목표 ${cs.track_goals}건·월 목표 ${cs.month_goals}건.`,
    metrics: [metric('이번 달 계획 줄', lines.filter(l => l.d >= monthStart && l.d <= asOf).length, '줄', '영어 시트 · 수업일 기준'), metric('미리 쓴 계획 줄', lines.filter(l => l.d > asOf).length, '줄', '기준일 이후 수업일'), metric('이번 달 학생 기록', cs.month_marks, '칸'), metric('수학 전체 목표', cs.track_goals, '건'), metric('수학 월 목표', cs.month_goals, '건'), metric('회차 미룸·당김', cs.shifts, '건')],
    trend: monthlyTrend('월별 영어 시트 학생 기록', '칸', await sql`select to_char(mark_date,'YYYY-MM') as month, count(*)::int as value from public.class_sheet_student_marks where tenant_id=${t} and mark_date <= ${asOf} group by 1`, asOf),
    evidence, summaryRecords: evidence.filter(r => r.date <= asOf), facetLabels: { 'term:regular': '정규', 'term:exam': '시험 기간', 'when:done': '지난 수업', 'when:planned': '앞으로의 계획' }, recordSource: 'class_sheet_plan_lines',
    sourceLabel: '영어 시트 계획·학생 기록 · 수학 목표', coverageNote: '근거 목록은 영어 시트 계획 줄 전체이며 앞으로의 계획도 들어 있습니다. 전체 목록을 불러오기 전에는 기준일까지의 계획만 보여 줍니다.',
    sources: [{ table: 'class_sheet_plan_lines', rows: lines.length }, { table: 'class_sheet_student_marks', rows: cs.marks }, { table: 'class_sheet_goals', rows: cs.goals }, { table: 'math_learning_track_goals', rows: cs.track_goals }, { table: 'math_month_goals', rows: cs.month_goals }, { table: 'class_lesson_shifts', rows: cs.shifts }],
  });

  Object.assign(out, await attendanceFamilies(ctx));
  return out;
}
