// 2.0 운영실 '강사별 업무 현황' — 2.0 `src/features/dashboard/overview/teacher-work-server.ts`의 `loadTeacherWork`를 로컬 Docker 복사본에서 그대로.
// 원장 10-28 *"원하는건 추세. kpi로 표현하고 싶은건 최근 kpi 변화"* — 기준일(`today`)을 바꿔 돌릴 수 있게 하고, 8개 주 창은 한 번 읽어 창마다 2.0 판정을 돌린다.
// · 조회 = 2.0과 같은 표·같은 조건(사용자 클라이언트 RLS = 지점 격리 → `tenant_id` 조건). 2.0이 삼키는 조회는 저장점(`sql.soft`)으로 같은 폴백.
// · 판정 = 2.0 순수 함수 그대로(teacher-work · work-targets · unread-filter · unrecorded-attendance · counsel-period · english-writing ·
//   report-subjects · video-homework/policy · enrollment/program · classnote-gate · modules · laboratory/license rule). 서버 전용 상수(`UNREAD_WINDOW_DAYS`)는 2.0 파일에서 읽는다.
// · 2.0 안의 '지금'(`kstMinutesOfDay()` 오늘 수업 끝 판정 · `Date.now()` 미확인 48시간 유예)은 기준일에 맞춘다 — 기준일이 복사본 기준일 이후면
//   복사본을 뜬 순간, 그보다 앞선 날이면 그날의 끝(23:59:59 KST). `now`로 덮을 수 있다.
// · 창은 그 창이 끝난 시각 기준(as-of, 기본): 창의 '지금'보다 뒤에 생긴 보고서·발송·읽음·출결 기록·영상 판정·따로 낸 숙제는 그 창에 없던 것으로 본다
//   (지금 기록으로 지난 날짜를 다시 세면 늦게 들어온 기록이 지난 창에만 붙어 마지막 창이 늘 덜 익어 보인다). `asOfCut:false` = 지금 기록으로 다시 세기.
//   출결은 자르지 않는다 — 2.0은 칸을 고칠 때도 recorded_at을 새로 찍어(check-time.ts), 자르면 나중에 고친 칸이 '그때 없던 기록'이 되어
//   입력률이 가짜로 오르는 추세가 생긴다(9월 일괄 정정). 그래서 출결은 지금 기록으로 센다(늦은 첫 입력은 지난 창에 들어간다). 회수 시각은 보지 않는다 ·
//   영상 없는 자동 판정(미수행 등)은 다시 판정한 시각밖에 없어 지난 창에서 빠진다(영상 제출률 = 제출 ÷ 출제라 분자·분모에는 영향 없음).
// · 읽기 전용 트랜잭션 · 쓰기 없음 · 바깥 호출 없음. copyClock(복사본을 뜬 순간)은 프로세스 동안 고정 — 백업을 바꾸면 서버를 다시 켤 것.
import { readFile } from 'node:fs/promises';
import { queryGate, rules as rosterRules, resolveSettings, copyClock } from './v2-onescreen-roster.mjs';
import { tenantId as COPY_TENANT } from './full-db.mjs';

const MODULES = ['lib/date-kst.ts', 'features/dashboard/overview/teacher-work.ts', 'features/dashboard/overview/work-targets.ts', 'features/report-admin/unread-filter.ts',
  'features/dashboard/unrecorded-attendance.ts', 'features/dashboard/overview/counsel-period.ts', 'features/report-admin/english-writing.ts', 'features/dashboard/report-subjects.ts',
  'features/video-homework/policy.ts', 'features/students/enrollment/program.ts', 'features/owner/classnote-gate.ts', 'lib/modules.ts', 'lib/laboratory/rule.ts', 'lib/license/rule.ts'];
/** 2.0 fetchAllPagedInChunks의 덩어리 크기(lib/supabase/batch.ts DEFAULT_CHUNK) — 보고서 순서를 2.0과 같게 만드는 데 쓴다. */
const CHUNK = 100;
let rulesP = null, unreadWindowP = null;
async function rules(importV2) {
  // 이름이 겹치면 앞 모듈이 이긴다. 실패는 기억하지 않는다.
  rulesP ??= Promise.all(MODULES.map((m) => importV2(m))).then((mods) => Object.assign({}, ...mods.reverse())).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/** 2.0 `UNREAD_WINDOW_DAYS`(dashboard/onescreen/server/queries.ts — 서버 전용이라 불러올 수 없어 그 파일의 값을 읽는다). */
async function unreadWindowDays() {
  unreadWindowP ??= readFile(new URL('../../src/features/dashboard/onescreen/server/queries.ts', import.meta.url), 'utf8').then((src) => {
    const n = Number(src.match(/export const UNREAD_WINDOW_DAYS = (\d+);/)?.[1]);
    if (!Number.isInteger(n) || n <= 0) throw new Error('2.0 UNREAD_WINDOW_DAYS를 읽지 못했습니다');
    return n;
  }).catch((e) => { unreadWindowP = null; throw e; });
  return unreadWindowP;
}

/** 2.0 loadTeacherWork 머리의 창 계산(같은 식). `days` = 창 길이(2.0은 7) — 확장 추세가 하루·한 달·한 해 창에 같은 식을 쓴다. */
function windowOf(R, today, unreadDays, days = 7) {
  const range = { reportFrom: R.addDays(today, -(days - 1)), videoFrom: R.addDays(today, -(days - 1)), to: today };
  const unreadFrom = R.addDays(today, -(unreadDays - 1));
  return { today, range, attendanceFrom: R.addDays(today, -days), attendanceTo: R.addDays(today, -1), unreadFrom,
    reportFetchFrom: unreadFrom < range.videoFrom ? unreadFrom : range.videoFrom, months: [today.slice(0, 7), R.shiftMonth(today.slice(0, 7), -1)] };
}
/** 기준일의 '지금' — `now`(Date · ms · 날짜를 받는 함수)가 있으면 그것, 없으면 복사본을 뜬 순간 또는 그날의 끝. */
function nowOf(today, clock, now) {
  const v = typeof now === 'function' ? now(today) : now;
  if (v != null) return v instanceof Date ? v.getTime() : Number(v);
  return today < clock.day ? Date.parse(`${today}T23:59:59+09:00`) : clock.at.getTime();
}
const minOf = (xs) => xs.reduce((a, b) => (b < a ? b : a)), maxOf = (xs) => xs.reduce((a, b) => (b > a ? b : a));

/** 2.0 getTenantSettings(loadTenantSettingsRaw + resolveSettings) — 설정 행과 지점 이름을 따로 읽는다(설정을 못 읽으면 침산 기본값 + 지점 이름). */
async function tenantSettings(sql, t, importV2) {
  const [row, name, RR] = await Promise.all([
    sql.soft(async (sp) => ({ data: (await sp`select data from public.tenant_settings where tenant_id=${t}`)[0]?.data ?? null }), { failed: true }),
    sql.soft(async (sp) => (await sp`select name from public.tenants where id=${t}`)[0]?.name ?? '', ''),
    rosterRules(importV2)]);
  return resolveSettings(RR, row.failed ? {} : row.data, name);
}
/** 2.0 isLaboratoryMenuAvailable(lib/laboratory/server.ts) — 배정 못 읽음 = 대상 메뉴 전부 · 실험실 라이선스 못 읽음 = 꺼짐. 라이선스 기준 시각 = 복사본의 지금. */
async function laboratoryMenuAvailable(sql, R, t, menu, at) {
  const assigned = await sql.soft(async (sp) => [...new Set((await sp`select menu_key from public.lab_menu_assignments`).map((r) => r.menu_key))].filter((k) => R.LAB_ELIGIBLE_KEYS.has(k)),
    () => R.LAB_ELIGIBLE_MENUS.map((m) => m.key));
  if (!assigned.includes(menu)) return true;
  const row = await sql.soft(async (sp) => (await sp`select is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses where tenant_id=${t} and feature='laboratory'`)[0] ?? null, null);
  return R.licenseExplicitlyOn(row, at);
}

/**
 * 창들이 쓰는 원자료를 **한 번에** — 가장 넓은 범위(창 경계의 최솟값·최댓값)로 읽는다. 조건은 2.0 조회와 같고, 창마다 `sliceWindow`가 2.0 조건 그대로 다시 거른다.
 * 2.0이 `fetchInChunks`·`fetchAllPaged`로 던지는 조회는 그대로 실패, `.catch`로 삼키는 조회는 저장점 + 같은 폴백.
 */
async function fetchRaw(sql, R, t, settings, wins, scope, counselShown) {
  const attendanceFrom = minOf(wins.map((w) => w.attendanceFrom)), maxToday = maxOf(wins.map((w) => w.today)), minToday = minOf(wins.map((w) => w.today));
  const reportFetchFrom = minOf(wins.map((w) => w.reportFetchFrom)), reportFrom = minOf(wins.map((w) => w.range.reportFrom)), videoFrom = minOf(wins.map((w) => w.range.videoFrom));
  const months = [...new Set(wins.flatMap((w) => w.months))];
  const classes = await sql`select id, class_name, subject, english_track, teacher_id, report_optout, closed_at::text closed_at from public.classes
    where tenant_id=${t} and is_active = true and (closed_at is null or closed_at >= ${attendanceFrom}) order by id`;
  const inScope = classes.filter((c) => !R.isTestClass(c.class_name) && (!scope || scope.classIds.includes(c.id)));
  const visible = inScope.filter((c) => c.report_optout !== true && (!c.closed_at || c.closed_at >= minToday));
  const classIds = visible.map((c) => c.id), scopedIds = inScope.map((c) => c.id);
  if (!classIds.length) return { classes };
  const teacherIds = [...new Set(visible.flatMap((c) => (c.teacher_id ? [c.teacher_id] : [])))];
  const [teachers, reports, outcomes, schedules, enrollments, attendance, posts, unclassified, extraIssues, counselRows] = await Promise.all([
    teacherIds.length ? sql`select id, display_name, status::text status from public.users where tenant_id=${t} and id = any(${teacherIds})` : [],
    // 학생 = students!inner(is_test, grade) + is_test=false. 순서 = 2.0(created_at 최신 → id) — 덩어리 순서는 창마다 `sliceWindow`가 맞춘다.
    sql`select r.id, r.class_id, r.student_id, r.report_date::text report_date, r.covers_date::text covers_date, r.classnote_status, r.video_homework,
        to_json(r.classnote_read_at)#>>'{}' classnote_read_at, to_json(r.classnote_sent_at)#>>'{}' classnote_sent_at, r.edutrix_share_token, r.source, s.grade,
        to_json(r.created_at)#>>'{}' created_at
      from public.lesson_reports r join public.students s on s.id = r.student_id and s.is_test = false
      where r.tenant_id=${t} and r.class_id = any(${classIds}) and r.report_date <= ${maxToday} and (r.report_date >= ${reportFetchFrom} or r.covers_date >= ${reportFrom})
      order by r.created_at desc, r.id`,
    // event_at = as-of 시각 — 영상이 붙은 판정은 그 영상이 올라온 때(observed_at은 마지막으로 다시 판정한 시각이라 지난 창을 비운다), 영상 없는 판정은 판정 시각.
    sql`select o.class_id, o.student_id, o.homework_date::text homework_date, o.status, to_json(o.observed_at)#>>'{}' observed_at,
        to_json(coalesce(v.posted_at, v.uploaded_at, o.observed_at))#>>'{}' event_at
      from public.video_homework_auto_outcomes o left join public.student_homework_videos v on v.id = o.video_id and v.tenant_id = o.tenant_id
      where o.tenant_id=${t} and o.class_id = any(${classIds}) and o.homework_date >= ${videoFrom} and o.homework_date <= ${maxToday} order by o.class_id, o.student_id, o.homework_date`,
    sql`select class_id, day_of_week::text day_of_week, start_time::text start_time, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
      where tenant_id=${t} and class_id = any(${scopedIds}) and (valid_from is null or valid_from <= ${maxToday}) and (valid_to is null or valid_to >= ${attendanceFrom}) order by id`,
    sql`select e.class_id, e.student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days
      from public.enrollments e join public.students s on s.id = e.student_id and s.is_test = false
      where e.tenant_id=${t} and e.class_id = any(${scopedIds}) and (e.start_date is null or e.start_date <= ${maxToday}) and (e.end_date is null or e.end_date >= ${attendanceFrom}) order by e.id`,
    sql`select id, student_id, class_id, session_date::text session_date, slot_start::text slot_start, status::text status, to_json(recorded_at)#>>'{}' recorded_at
      from public.attendance_records where tenant_id=${t} and class_id = any(${scopedIds}) and session_date >= ${attendanceFrom} and session_date <= ${maxToday} order by id`,
    R.classnoteModuleOn(settings) ? sql`select board_name, posted_on::text posted_on from public.classnote_class_posts
      where tenant_id=${t} and posted_on >= ${reportFrom} and posted_on <= ${maxToday} order by board_name, posted_on` : [],
    sql`select r.id, r.student_id, r.report_date::text report_date, r.covers_date::text covers_date, r.subject, r.teacher_name, r.classnote_status,
        to_json(r.created_at)#>>'{}' created_at, to_json(r.classnote_sent_at)#>>'{}' classnote_sent_at
      from public.lesson_reports r join public.students s on s.id = r.student_id and s.is_test = false
      where r.tenant_id=${t} and r.class_id is null and r.report_date <= ${maxToday} and (r.report_date >= ${reportFrom} or r.covers_date >= ${reportFrom})
      order by r.created_at desc, r.id`,
    // 2.0 listExtraIssues(…).catch(() => []) — 표가 없으면 없는 것으로, 그 밖의 실패도 빈 목록(보고서 쪽 숫자만).
    sql.soft(async (sp) => (await sp`select class_id, student_id, homework_date::text homework_date, teacher_id, kept, to_json(issued_at)#>>'{}' issued_at from public.video_homework_extra_issues
        where tenant_id=${t} and homework_date >= ${videoFrom} and homework_date < ${R.addDays(maxToday, 1)} order by homework_date, class_id, student_id`)
      .map((r) => ({ classId: r.class_id, studentId: r.student_id, date: r.homework_date, teacherId: r.teacher_id, kept: r.kept === true, issuedAt: r.issued_at })), []),
    // 원생상담 = 직원 포트폴리오 저장값(raws.counsel) — 못 읽으면 칸만 '—'.
    counselShown ? sql.soft((sp) => sp`select teacher_id, month, to_json(period_end)#>>'{}' period_end, raws->'counsel' counsel from public.teacher_portfolio_months
      where tenant_id=${t} and month = any(${months})`, []) : []]);
  // 따로 낸 숙제의 학생(학년·테스트 여부) — 못 읽으면 null(따로 낸 숙제를 뺀다).
  const extraIds = [...new Set(extraIssues.map((x) => x.studentId))];
  const extraStudents = extraIds.length ? await sql.soft((sp) => sp`select id, grade, is_test from public.students where tenant_id=${t} and id = any(${extraIds})`, null) : [];
  return { classes, teachers, reports, outcomes, schedules, enrollments, attendance, posts, unclassified, extraIssues, counselRows, extraStudents };
}

/** as-of: 창의 '지금'(cutMs)보다 뒤의 일은 그 창에 없던 것 — 그때 아직 안 보낸 글은 미발송(상태 없음), 그때 아직 안 읽은 글은 미읽음. */
const after = (iso, cut) => cut != null && iso != null && Date.parse(iso) > cut;
function asOfReport(r, cut) {
  const sentLate = after(r.classnote_sent_at, cut), readLate = sentLate || after(r.classnote_read_at, cut);
  return sentLate ? { ...r, classnote_status: null, classnote_sent_at: null, classnote_read_at: null } : readLate ? { ...r, classnote_read_at: null } : r;
}
/** 한 창의 원자료 — 2.0 조회 조건을 그대로 걸고, 보고서는 2.0의 덩어리 순서(그 창의 반 목록 100개씩)로 다시 늘어놓는다. `cutMs` = as-of 시각(null이면 자르지 않음). */
function sliceWindow(R, raw, w, scope, cutMs = null) {
  const classes = raw.classes.filter((c) => !c.closed_at || c.closed_at >= w.attendanceFrom);
  const inScope = classes.filter((c) => !R.isTestClass(c.class_name) && (!scope || scope.classIds.includes(c.id)));
  const visible = inScope.filter((c) => c.report_optout !== true && (!c.closed_at || c.closed_at >= w.today));
  const classIds = visible.map((c) => c.id), scoped = new Set(inScope.map((c) => c.id));
  const base = { inScope, visible, classIds };
  if (!classIds.length) return base;
  const chunkOf = new Map(classIds.map((id, i) => [id, Math.floor(i / CHUNK)]));
  const { today, range, attendanceFrom } = w;
  const teacherIds = new Set(visible.flatMap((c) => (c.teacher_id ? [c.teacher_id] : [])));
  const reports = raw.reports.filter((r) => chunkOf.has(r.class_id) && r.report_date <= today && (r.report_date >= w.reportFetchFrom || (r.covers_date != null && r.covers_date >= range.reportFrom))
      && !after(r.created_at, cutMs))
    .map((r, i) => [r, i]).sort((a, b) => chunkOf.get(a[0].class_id) - chunkOf.get(b[0].class_id) || a[1] - b[1]).map(([r]) => asOfReport(r, cutMs));
  const extraIssues = raw.extraIssues.filter((x) => x.date >= range.videoFrom && x.date < R.addDays(today, 1) && !after(x.issuedAt, cutMs));
  const extraIds = new Set(extraIssues.map((x) => x.studentId));
  return { ...base,
    teachers: raw.teachers.filter((u) => teacherIds.has(u.id)),
    reports,
    outcomes: raw.outcomes.filter((o) => chunkOf.has(o.class_id) && o.homework_date >= range.videoFrom && o.homework_date <= today && !after(o.event_at, cutMs)),
    schedules: raw.schedules.filter((s) => scoped.has(s.class_id) && (s.valid_from == null || s.valid_from <= today) && (s.valid_to == null || s.valid_to >= attendanceFrom)),
    enrollments: raw.enrollments.filter((e) => scoped.has(e.class_id) && (e.start_date == null || e.start_date <= today) && (e.end_date == null || e.end_date >= attendanceFrom)),
    attendance: raw.attendance.filter((a) => scoped.has(a.class_id) && a.session_date >= attendanceFrom && a.session_date <= today), // 자르지 않음(머리 주석)
    posts: raw.posts.filter((p) => p.posted_on >= range.reportFrom && p.posted_on <= today),
    unclassified: raw.unclassified.filter((r) => r.report_date <= today && (r.report_date >= range.reportFrom || (r.covers_date != null && r.covers_date >= range.reportFrom)) && !after(r.created_at, cutMs))
      .map((r) => (after(r.classnote_sent_at, cutMs) ? { ...r, classnote_status: null } : r)),
    extraIssues,
    extraStudents: raw.extraStudents === null ? null : raw.extraStudents.filter((s) => extraIds.has(s.id)),
    counselRows: raw.counselRows.filter((r) => w.months.includes(r.month)) };
}

/** 확장 추세의 묶음 — 2.0 teacherWork는 '선생님:과목' 줄로 묶고 열람·출결은 반→줄 대응으로 붙인다. 반·과목으로 묶을 땐 그 키를 선생님 자리에 넣어
 * 같은 판정을 반·과목 줄로 받는다(보고서 담당 판정·미분류 보고서 연결은 진짜 선생님으로 끝낸 뒤에만 바꾼다). */
// 과목 묶음에서 영어는 EiE(classes.english_track = 'eie')와 나머지 영어로 가른다(원장 10-28 "영어와 EiE 분리") — 열쇠 'eie' · 이름 'EiE'.
export const subjectKeyOf = (c) => (c.subject === 'english' && c.track === 'eie' ? 'eie' : c.subject);
const GROUP = { teacher: null, class: (c) => ({ teacherId: `class:${c.id}`, teacherName: c.name }), subject: (c) => ({ teacherId: `subject:${subjectKeyOf(c)}`, teacherName: subjectKeyOf(c) === 'eie' ? 'EiE' : c.subject }) };

/** 2.0 loadTeacherWork의 판정부(조회 다음) — 같은 순서·같은 순수 함수. `groupBy` = 'teacher'(2.0) | 'class' | 'subject'. */
function judge(R, settings, d, w, nowMs, counselShown, unreadGraceHours, groupBy = 'teacher') {
  if (!(groupBy in GROUP)) throw new Error(`묶음 기준이 아닙니다: ${groupBy}`);
  const { today, range, attendanceFrom, attendanceTo, unreadFrom } = w;
  const deliveryShown = R.classnoteModuleOn(settings);
  if (!d.classIds.length) return R.withTeacherWorkExtras(R.teacherWork([], [], [], range, []), { unread: [], attendance: [], counsel: new Map(),
    attendanceFrom, attendanceTo, unreadFrom, counselAsOf: null, counselMonth: null, deliveryShown, counselShown });
  const { reports, outcomes, schedules, enrollments, attendance, posts, unclassified, extraIssues, counselRows } = d;
  const extraStudentOf = new Map((d.extraStudents ?? []).map((s) => [s.id, s]));
  const names = new Map(d.teachers.map((u) => [u.id, u.display_name]));
  const subjects = new Map(d.visible.map((c) => [c.id, c.subject]));
  const programs = R.programSubjectsOf(Object.fromEntries(settings.operations.subjects.map((s) => [s.key, s.label])));
  const retired = new Set(d.teachers.filter((u) => u.status === 'inactive').map((u) => u.id));
  const workClasses = d.visible.filter((c) => !c.teacher_id || !retired.has(c.teacher_id)).map((c) => {
    const teacherName = c.teacher_id ? names.get(c.teacher_id) ?? '이름 확인 필요' : '담당 미지정';
    const english = R.subjectGroupOf(c.subject, programs) === 'english';
    return { id: c.id, name: c.class_name, teacherId: c.teacher_id, teacherName, subject: c.subject, track: c.english_track,
      reportSource: settings.report.writingExemptTeachers.includes(teacherName) ? 'none' : english && R.classnoteModuleOn(settings) ? 'classnote'
        : !english && R.isReportTrackedSubject(c.subject, settings.report.classnoteSubjects) ? 'lesson' : 'none' };
  });
  const workReports = reports.map((r) => ({ id: r.id, classId: r.class_id, studentId: r.student_id, date: r.report_date, coversDate: r.covers_date, status: r.classnote_status,
    videoHomework: r.video_homework === true && R.isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, { classId: r.class_id, subjectKey: subjects.get(r.class_id) ?? '', grade: r.grade ?? null }) }));
  workReports.push(...R.resolveUnclassifiedReports(unclassified.map((r) => ({ id: r.id, studentId: r.student_id, date: r.report_date, coversDate: r.covers_date, subject: r.subject,
    teacherName: r.teacher_name, status: r.classnote_status, videoHomework: false })), workClasses, enrollments, schedules));
  const obligations = R.reportWorkObligations({ classes: workClasses, reports: workReports, schedules, enrollments, attendance,
    posts: posts.map((p) => ({ boardName: p.board_name, postedOn: p.posted_on })), from: range.reportFrom, to: today,
    nowMinutes: R.kstMinutesOfDay(new Date(nowMs)), holidays: settings.operations.holidays.map((h) => h.date) });
  const regroup = GROUP[groupBy], groupClasses = regroup ? workClasses.map((c) => ({ ...c, ...regroup(c) })) : workClasses;
  const work = R.teacherWork(groupClasses, workReports, outcomes.map((r) => ({ classId: r.class_id, studentId: r.student_id, date: r.homework_date, status: r.status, observedAt: r.observed_at })),
    range, obligations, extraIssues.filter((x) => { const student = extraStudentOf.get(x.studentId); return !x.kept && !!student && !student.is_test
      && R.isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, { classId: x.classId, subjectKey: subjects.get(x.classId) ?? '', grade: student.grade }); }));
  const cutoffMs = nowMs - unreadGraceHours * 3_600_000;
  const unread = reports.filter((r) => r.report_date >= unreadFrom).map((r) => ({ classId: r.class_id, ...R.judgeUnreadReport(r, cutoffMs) }));
  const enrollmentsOf = new Map();
  for (const e of enrollments) enrollmentsOf.set(e.class_id, [...(enrollmentsOf.get(e.class_id) ?? []), e]);
  const recordedOf = new Map();
  for (const a of attendance) { const key = `${a.class_id}|${a.session_date}`; recordedOf.set(key, (recordedOf.get(key) ?? new Set()).add(a.student_id)); }
  const attendanceDays = R.sessionDates(attendanceFrom, attendanceTo, new Set(settings.operations.holidays.map((h) => h.date))).flatMap((date) =>
    d.inScope.flatMap((c) => {
      if (c.closed_at && c.closed_at < date) return [];
      const meets = schedules.some((s) => s.class_id === c.id && s.day_of_week === R.dowOf(date) && !!s.valid_from && s.valid_from <= date && (!s.valid_to || s.valid_to >= date));
      if (!meets) return [];
      const judged = R.judgeClassAttendanceDay({ enrollments: enrollmentsOf.get(c.id) ?? [], recorded: recordedOf.get(`${c.id}|${date}`) ?? new Set(), date, dayKey: R.dowOf(date) });
      return judged.expected > 0 ? [{ classId: c.id, teacherId: regroup ? regroup({ id: c.id, name: c.class_name, subject: c.subject, track: c.english_track }).teacherId : c.teacher_id, subject: c.subject, unrecorded: judged.unrecorded }] : [];
    }));
  const counselPick = R.pickCounselMonth(counselRows, today.slice(0, 7));
  const counsel = new Map(counselPick.rows.map((r) => [r.teacher_id, typeof r.counsel === 'number' ? r.counsel : null]));
  const counselAsOf = counselPick.rows.map((r) => r.period_end?.slice(0, 10) ?? '').filter(Boolean).sort().at(-1) ?? null;
  return R.withTeacherWorkExtras(work, { unread: deliveryShown ? unread : [], attendance: attendanceDays, counsel, attendanceFrom, attendanceTo, unreadFrom, counselAsOf,
    counselMonth: counselPick.month, deliveryShown, counselShown });
}

async function prepare(tx, tenantId, todays, settings, importV2, spans = null) {
  const sql = queryGate(tx);
  const [R, clock, unreadDays] = await Promise.all([rules(importV2), copyClock(), unreadWindowDays()]);
  const s = settings ?? (await tenantSettings(sql, tenantId, importV2));
  // 원생상담 줄 = 직원 평가 모듈 ∧ 실험실 판정(2.0 counselShownP — 실패는 꺼짐).
  const counselShown = R.isModuleEnabled(s.modules.disabled, 'class_review')
    ? await laboratoryMenuAvailable(sql, R, tenantId, 'class_review', clock.at).catch(() => false) : false;
  for (const d of todays) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`기준일 형식이 아닙니다: ${d}`);
  // spans가 있으면(확장 추세) 창마다 그 길이 — 학부모 열람도 같은 창의 보고서로 센다.
  if (spans && (spans.length !== todays.length || spans.some((n) => !Number.isInteger(n) || n < 1 || n > 366))) throw new Error('창 길이가 올바르지 않습니다');
  return { sql, R, clock, settings: s, counselShown, wins: todays.map((d, i) => (spans ? windowOf(R, d, spans[i], spans[i]) : windowOf(R, d, unreadDays))) };
}

/**
 * 2.0 `loadTeacherWork(tenantId, today, scope, settings)` — 반환 모양 = 2.0(`withTeacherWorkExtras(teacherWork(…), …)`).
 * `sql` = 읽기 전용 트랜잭션. `scope` = 2.0 TeacherScope(`{ classIds }`, 전체면 null). `settings` 없으면 2.0 getTenantSettings와 같은 값으로 만든다.
 * 2.0의 `withStaffTasks`(열린 할 일 줄 — 운영실 server.ts가 붙인다)는 여기 없다.
 */
export async function loadTeacherWork({ sql, tenantId, today, scope = null, settings, importV2, now, asOfCut = true }) {
  return (await loadTeacherWorkWindows({ sql, tenantId, todays: [today], scope, settings, importV2, now, asOfCut }))[0];
}

/**
 * 여러 기준일(예: 8개 주 창의 끝 날)을 한 번에 — 가장 넓은 범위를 한 번 읽고 창마다 2.0 조건으로 걸러 2.0 판정을 돌린다(B4 · 창마다 따로 읽지 않는다).
 * 돌려줌 = `todays` 순서의 결과 배열. 창마다 결과 = 그 날짜로 `loadTeacherWork`를 따로 부른 결과(시험이 잠근다).
 */
export async function loadTeacherWorkWindows({ sql: tx, tenantId, todays, scope = null, settings, importV2, now, asOfCut = true, spans = null, groupBy = 'teacher' }) {
  if (!todays?.length) return [];
  const { sql, R, clock, settings: s, counselShown, wins } = await prepare(tx, tenantId, todays, settings, importV2, spans);
  const raw = await fetchRaw(sql, R, tenantId, s, wins, scope, counselShown);
  return wins.map((w) => { const nowMs = nowOf(w.today, clock, now);
    return judge(R, s, sliceWindow(R, raw, w, scope, asOfCut ? nowMs : null), w, nowMs, counselShown, R.UNREAD_GRACE_HOURS, groupBy); });
}

// ── 3.0 KPI: 최근 7일 창 8개(원장 10-28 "원하는건 추세") ─────────────────────────────────────────────────────────────
// 원장 첫 화면 '운영 상태'와 선생님 수업보고서 영역이 같은 값을 쓴다 — 같은 트랜잭션 안에서는 한 번만 계산한다.
// 지난 창은 그 창이 끝난 상태(그날 수업은 모두 마감 대상 · 늦게 쓴 보고서도 셈), 지금 창은 복사본을 뜬 순간 — 확장 추세(teacherWorkTrend)의 주별과
// 같은 판정이라 카드의 '7일 전 대비'와 확장 추세의 '직전 대비'가 같은 숫자다(원장 10-28 카드 ▲7.4%p ↔ 확장 추세 ▼1.7%p가 갈렸던 것).
const SUMS = ['reports', 'reportTarget', 'sent', 'recalled', 'unread', 'unreadJudged', 'attendanceUnrecorded', 'attendanceDays', 'videoIssuedReports', 'reportsWritten', 'videoSubmitted', 'videoAssigned'];
const weeklyMemo = new WeakMap();
/**
 * 학원 전체 합으로 낸 KPI 여섯 개(kpi() 카드 모양) + 창·합계. `asOf` = 마지막 창의 끝(복사본 기준일). `sql` = 읽기 전용 트랜잭션.
 * ⚠️ 같은 트랜잭션의 다른 조회와 `Promise.all`로 나란히 부르지 말 것 — 안의 저장점 조회가 실패하면 나란히 돌던 조회까지 25P02로 깨진다(따로 await).
 */
export function teacherWorkWeekly({ sql, asOf, tenantId = COPY_TENANT, importV2, n = 8 }) {
  const key = `${tenantId}|${asOf}|${n}`, memo = weeklyMemo.get(sql) ?? new Map();
  if (!weeklyMemo.has(sql)) weeklyMemo.set(sql, memo);
  if (!memo.has(key)) memo.set(key, weekly({ sql, asOf, tenantId, importV2, n }).catch((e) => { memo.delete(key); throw e; })); // 실패는 기억하지 않는다
  return memo.get(key);
}
async function weekly({ sql, asOf, tenantId: t, importV2, n }) {
  const [{ kpi, rate, weekWindows }, load] = await Promise.all([import('./domain-snapshot-core.mjs'), importV2 ?? import('./v2-bridge.mjs').then((m) => m.importV2)]);
  const windows = weekWindows(asOf, n), works = await loadTeacherWorkWindows({ sql, tenantId: t, todays: windows.map((w) => w.to), importV2: load, asOfCut: false });
  // 영상 숙제 값이 처음 생긴 날 — 그 전에 끝난 창은 영상 지표가 '기록 없음'(0%가 아니다).
  const [{ first: videoFrom }] = await sql`select min(report_date)::text first from public.lesson_reports where tenant_id=${t} and video_homework is not null`;
  const sum = (rows) => Object.fromEntries(SUMS.map((k) => [k, rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)]));
  // 발송·학부모 확인·영상 출제는 2.0 카드처럼 수업보고서 줄(reportSource 'lesson')만 — 알림장(영어)·작성 제외 줄은 그 칸이 '—'(teacher-work-card.tsx).
  const totals = works.map((w) => sum(w.rows)), lessonTotals = works.map((w) => sum(w.rows.filter((r) => r.reportSource === 'lesson')));
  // 학부모 열람률의 기간·유예 = 판정이 쓰는 그 값(UNREAD_WINDOW_DAYS · UNREAD_GRACE_HOURS) — 문구가 계산과 어긋나지 않게.
  const [{ UNREAD_GRACE_HOURS: graceHours }, unreadDays] = await Promise.all([rules(load), unreadWindowDays()]);
  // 화면 문구에 '2.0'을 적지 않는다(원장 10-28 "2.0과 관련된 멘트는 일단 제거") — 판정이 2.0 함수라는 것은 이 파일의 주석이 말한다.
  const SPAN = { 'parent-read': `최근 ${unreadDays}일`, 'attendance-input': '어제까지 7일' };
  const kpis = TEACHER_WORK_METRICS.map((m) => kpi(m.label, '%', windows.map((w, i) => ({ label: w.label,
    value: m.video && (!videoFrom || w.to < videoFrom) ? null : rate(...m.part(totals[i], lessonTotals[i])) })), { id: m.id, better: 'up', span: SPAN[m.id] ?? '최근 7일', basis: m.basis(graceHours) }));
  return { windows, totals, lessonTotals, kpis, basis: '변화 = 7일 전 값과 비교 · 날마다 같은 시각까지 셈' };
}

/**
 * 지표 정의 한 벌 — 카드(weekly)와 확장 추세(teacherWorkTrend)가 같이 쓴다. part(a, l) = [분자, 분모](a = 줄 합 · l = 수업보고서 줄 합).
 * 이름은 무엇을 세는지 그대로(원장 10-28 "무엇을 발송했다는것의 확인율인지 명확하지 않음").
 * 발송·학부모 확인·영상 출제는 2.0 카드처럼 수업보고서 줄(reportSource 'lesson')만 — 알림장(영어)·작성 제외 줄은 그 칸이 '—'(teacher-work-card.tsx).
 */
export const TEACHER_WORK_METRICS = Object.freeze([
  { id: 'report-written', label: '수업보고서 작성률', part: (a) => [a.reports, a.reportTarget], basis: () => '써야 할 수업보고서 중 쓴 것' },
  { id: 'report-sent', label: '수업보고서 발송률', part: (a, l) => [l.sent, l.reports - l.recalled], basis: () => '쓴 수업보고서 중 학부모에게 보낸 것(회수한 보고서 제외)' },
  { id: 'parent-read', label: '학부모 보고서 열람률', part: (a, l) => [l.unreadJudged - l.unread, l.unreadJudged], basis: (g) => `보낸 수업보고서 중 학부모가 읽은 것 · 보낸 지 ${g}시간이 안 된 것은 빼고 셈` },
  { id: 'attendance-input', label: '출결 입력률', part: (a) => [a.attendanceDays - a.attendanceUnrecorded, a.attendanceDays], basis: () => '수업한 날 출결 칸 중 입력된 것', attendance: true },
  { id: 'video-issued', label: '영상 숙제 출제율', part: (a, l) => [l.videoIssuedReports, l.reportsWritten], basis: () => '쓴 수업보고서 중 영상 숙제를 낸 것', video: true },
  // 원장 10-28: '영상 업로드가 숙제 출제에 비해 잘되고 있냐 안되고 있냐'
  { id: 'video-submitted', label: '영상 숙제 제출률', part: (a) => [a.videoSubmitted, a.videoAssigned], basis: () => '낸 영상 숙제 중 학생이 영상을 올린 것', video: true },
]);

/**
 * 확장 추세(원장 10-28 "일별 월별 연별 추세를 자세하게 … 학생별, 선생님별, 반별, 과목별") — 아무 창(`windows` = [{from, to}])과 묶음(`by`)으로
 * 같은 2.0 판정을 돌려 합계와 줄별 [분자, 분모]를 낸다. 지난 창은 그 창 마지막 날이 끝난 때로 판정하고(그날 수업은 모두 마감 대상) 늦게 쓴 보고서도 센다 —
 * 카드가 7일 창 안의 지난 날을 세는 방식과 같다. 지금 창(마지막 날 = 복사본 기준일)은 복사본을 뜬 순간이라 카드 값과 같다.
 * (카드의 추세선은 비교를 공정하게 하려고 지난 창도 오늘과 같은 시각에 자른다 — 하루 창에선 오후 수업이 빠져 쓸 수 없다.) 학부모 열람은 같은 창의 보고서로 센다.
 * 출결은 2.0처럼 '기준일 전날까지'다 — 출결 창은 어제까지로 끝나게 받고(trend-metrics의 endsYesterday) 기준일은 창 끝 다음 날로 잡아
 * 창 안의 날을 그대로 센다(주별 = 카드의 '어제까지 7일' 창 그대로 · 창끼리 겹치지 않는다).
 * `scope` = 2.0 TeacherScope({ classIds }) — 필터(선생님·반·과목)를 반 목록으로 좁힌다. 학생 묶음은 아직 없다.
 */
export async function teacherWorkTrend({ sql, asOf, tenantId: t = COPY_TENANT, importV2, metric, windows, by = 'teacher', scope = null }) {
  const m = TEACHER_WORK_METRICS.find((x) => x.id === metric);
  if (!m) throw new Error(`지표가 아닙니다: ${metric}`);
  const load = importV2 ?? (await import('./v2-bridge.mjs')).importV2, R = await rules(load);
  const day = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const todays = windows.map((w) => (m.attendance ? R.addDays(w.to, 1) : w.to));
  const spans = windows.map((w) => day(w.to) - day(w.from) + 1);
  const works = await loadTeacherWorkWindows({ sql, tenantId: t, todays, spans, groupBy: by, scope, importV2: load, asOfCut: false });
  const [{ first: videoFrom }] = await sql`select min(report_date)::text first from public.lesson_reports where tenant_id=${t} and video_homework is not null`;
  // 써야 할 보고서·출결 대상은 시간표 배치에서 나온다 — 배치가 처음 생기기 전의 창은 들어온 보고서만 대상이 되어 100%로 보인다(옮겨 온 옛 보고서). 그 날을 알린다.
  const [{ first: since }] = await sql`select min(valid_from)::text first from public.class_schedules where tenant_id=${t}`;
  const sum = (rows) => Object.fromEntries(SUMS.map((k) => [k, rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)]));
  const point = (rows, w) => (m.video && (!videoFrom || w.to < videoFrom) ? null : m.part(sum(rows), sum(rows.filter((r) => r.reportSource === 'lesson'))));
  const keyOf = (r) => r.teacherId ?? 'unassigned', groups = new Map();
  works.forEach((wk, i) => { for (const r of wk.rows) { const k = keyOf(r), g = groups.get(k) ?? groups.set(k, { key: k, label: r.teacherName, perWindow: windows.map(() => []) }).get(k); g.perWindow[i].push(r); } });
  return {
    since: m.video ? videoFrom ?? since : since,
    total: works.map((wk, i) => point(wk.rows, windows[i])),
    rows: [...groups.values()].map((g) => ({ key: by === 'teacher' ? g.key : g.key.slice(g.key.indexOf(':') + 1), label: g.label, points: g.perWindow.map((rows, i) => (rows.length ? point(rows, windows[i]) : null)) })),
  };
}
