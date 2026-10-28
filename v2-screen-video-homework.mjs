// 2.0 화면 — 영상 제출 현황(관리자 장부 /lesson-reports/video-homework · 강사 '내가 낸' /onescreen/video-homework) (V2-SCREENS.md `video-homework`, 처리 화면 세션 R).
// 그리기는 2.0의 실제 React 부품(v2-host/src/video-homework.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 같은 결과로:
//  · 조회 = features/video-homework/server/ledger-queries.ts(getVideoHomeworkLedger · loadClassVideos) · assignments.ts(getAssignedVideoHomework) ·
//    extra-issues.ts · rejections.ts · blank-facts.ts · blank-lessons.ts · assignment-availability.ts · own-homework.ts · manual-drive-review.ts ·
//    video-review/server/points.ts — 표·칸·조건을 SQL로, 판정(명단·회차·숙제 0건 반·빈 칸 사유·마감)은 2.0 순수 함수(importV2) 그대로.
//  · 보는 사람 = 3.0 띠에서 고른 직원(GET ?actor=). 관리자 장부 = 수업보고서를 열 수 있는 사람 · 강사 '내가 낸'(?view=mine) = 강사 역할(2.0 강사뷰).
//    관리자 계열이 강사 주소로 오면 2.0처럼 같은 기간·필터의 관리자 장부로 보낸다. 겸직 강사뷰·'다른 강사 뷰'는 3.0에 없다.
//  · 🔴 영상은 재생하지 않는다 — Drive 주소(미리보기·썸네일)를 화면으로 보내지 않는다. 회차 판정은 2.0처럼 '재생 가능한 영상'으로 하고
//    (rounds.ts가 playback !== null을 본다), 화면에는 그 칸을 빼서 보낸다(빠진 칸 = 판정은 같고 재생 단추 대신 '아직 재생할 수 없는 영상').
//  · 저장 = 2.0 서버 함수 다섯(같은 이름 · 같은 인자 · 같은 검증 · 같은 DB 함수 · 같은 감사로그 action) + 배정 창 읽기 하나(GET ?read=assign).
//    반려의 Drive 휴지통은 부르지 않는다 — DB 반려는 2.0 순서 그대로, 휴지통 단계는 2.0이 못 옮겼을 때의 모양(trashFailed)으로 센다.
//    원스크린 검사 칸 저장(setVideoHomeworkMark · …Bulk)은 이 화면 부품이 부르지 않는다(원스크린 화면 몫).
import { V2Error } from './v2-screens.mjs';
import { UUID, audit, deepMerge, readPeople, serverCall } from './v2-proc-people.mjs';

const ID = 'video-homework', ADMIN_PATH = '/lesson-reports/video-homework', VH = 'features/video-homework';
const MODULES = { actions: `${VH}/server/actions.ts`, cancel: `${VH}/server/cancel-homework.ts`, issue: `${VH}/server/issue-actions.ts`,
  reject: `${VH}/server/reject-videos.ts`, assign: `${VH}/server/video-assignment.ts` };
const J = async q => (await q).map(r => r.j);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const mods = await Promise.all([
      'rounds', 'ledger-roster', 'idle-rows', 'no-homework', 'issue-window', 'video-assignment', 'ledger', 'ledger-period', 'policy', 'due',
      'auto-outcomes', 'reject-targets', 'types',
    ].map(n => importV2(`${VH}/${n}.ts`)).concat([
      'features/attendance/effective-records.ts', 'features/attendance/calendar.ts', 'features/students/homework-videos.ts', 'features/video-submit/site.ts',
      'features/enrollments/eligibility.ts', 'features/classes/delegation-window.ts', 'features/attendance/teacher-axis.ts', 'features/timetable/lib/teacher-label.ts',
      'lib/license/rule.ts', 'features/video-review/score.ts', 'features/video-review/view.ts', 'lib/ai/model-label.ts', 'lib/date-kst.ts',
    ].map(p => importV2(p))));
    return Object.assign({}, ...mods);
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** 학원 설정의 수업보고서(영상 제출 검사 정책 · ClassNote 답글) · 기능 스위치 칸 — 2.0 resolveSettings와 같은 병합. */
const settingsOf = people => ({ operations: people.settings.operations, report: deepMerge(people.settings.base.report, people.settings.stored?.report),
  modules: deepMerge(people.settings.base.modules ?? {}, people.settings.stored?.modules) });
const license = async (sql, t, feature) => (await J(sql`select to_jsonb(x) j from (select is_active, expires_at from public.tenant_licenses where tenant_id=${t} and feature=${feature}) x`))[0] ?? null;

// ── 숙제 · 기록 · 영상 읽기(2.0 assignments.ts · extra-issues.ts · rejections.ts · ledger-queries.ts) ───────────────────────────────
const toIssue = r => ({ classId: r.class_id, studentId: r.student_id, date: r.homework_date, teacherId: r.teacher_id, kept: r.kept === true });
const listExtraIssues = (sql, t, from, to) => J(sql`select to_jsonb(x) j from (select class_id, student_id, homework_date, teacher_id, kept
  from public.video_homework_extra_issues where tenant_id=${t} and homework_date >= ${from}::date and homework_date <= ${to}::date
  order by homework_date, class_id, student_id) x`).then(rows => rows.map(toIssue));
async function findExtraIssue(sql, t, key) {
  const [row] = await J(sql`select to_jsonb(x) j from (select class_id, student_id, homework_date, teacher_id, kept from public.video_homework_extra_issues
    where tenant_id=${t} and class_id=${key.classId} and student_id=${key.studentId} and homework_date=${key.date}::date limit 1) x`);
  return row ? toIssue(row) : null;
}
const listRejections = (sql, t, from, to, studentIds) => J(sql`select to_jsonb(x) j from (select class_id, student_id, homework_date, rejected_at
  from public.video_homework_rejections where tenant_id=${t} and homework_date >= ${from}::date and homework_date <= ${to}::date
  ${studentIds ? sql`and student_id = any(${[...new Set(studentIds)]}::uuid[])` : sql``} order by student_id, class_id, homework_date) x`)
  .then(rows => rows.map(r => ({ classId: r.class_id, studentId: r.student_id, date: r.homework_date, rejectedAt: r.rejected_at })));

/** getAssignedVideoHomework — '영상 과제 있음' 보고서 ∪ 따로 낸 숙제(옮겨 남긴 숙제는 kept) + 반려 시각 · 고른 마감. */
async function getAssigned(sql, t, R, from, to, studentId) {
  const reports = await J(sql`select to_jsonb(x) j from (select student_id, class_id, report_date, video_homework_due from public.lesson_reports
    where tenant_id=${t} and video_homework = true and class_id is not null and report_date >= ${from}::date and report_date <= ${to}::date
    ${studentId ? sql`and student_id=${studentId}` : sql``} order by id) x`);
  const extra = await listExtraIssues(sql, t, from, to);
  const rejections = await listRejections(sql, t, from, to, studentId ? [studentId] : null);
  const out = new Map();
  for (const r of reports) if (r.class_id && (!studentId || r.student_id === studentId)) out.set(`${r.class_id}:${r.student_id}:${r.report_date}`, {
    classId: r.class_id, studentId: r.student_id, date: r.report_date, ...(R.isCustomDue(r.report_date, r.video_homework_due) ? { due: r.video_homework_due } : {}) });
  for (const x of extra) {
    if (studentId && x.studentId !== studentId) continue;
    const key = `${x.classId}:${x.studentId}:${x.date}`;
    if (!x.kept) { const due = out.get(key)?.due; out.set(key, { classId: x.classId, studentId: x.studentId, date: x.date, extra: true, ...(due ? { due } : {}) }); }
    else if (!out.has(key)) out.set(key, { classId: x.classId, studentId: x.studentId, date: x.date, kept: true });
  }
  for (const r of rejections) { const hit = out.get(`${r.classId}:${r.studentId}:${r.date}`); if (hit) hit.rejectedAt = r.rejectedAt; }
  return [...out.values()];
}

const kst = d => `${d}T00:00:00+09:00`;
/** loadClassVideos — 영상 원장 뷰(반이 확인된 것 · includeUnclassified면 반 모름도) · 업로드 완료 파일은 재생 가능(판정용 — 화면엔 안 보낸다). */
async function loadClassVideos(sql, t, R, studentIds, from, to, includeUnclassified = false) {
  if (!studentIds.length) return [];
  const rows = await J(sql`select to_jsonb(x) j from (select id, student_id, post_id, posted_at, created_at, uploaded_at, md5, bytes, status, drive_file_id, subject,
      route->>'classId' class_id, route->>'homeworkDate' homework_date, route->>'manualAssignment' manual_assignment, route->>'excluded' excluded, route->>'free' free
    from public.homework_video_ledger_videos where tenant_id=${t} and student_id = any(${studentIds}::uuid[])
      and ((posted_at >= ${kst(from)}::timestamptz and posted_at < ${kst(R.addDays(to, 1))}::timestamptz)
        or (route->>'manualAssignment' = 'true' and route->>'homeworkDate' >= ${from} and route->>'homeworkDate' <= ${to}))
      ${includeUnclassified ? sql`` : sql`and route->>'classId' is not null`} order by id) x`);
  return rows.filter(row => row.excluded !== 'true').map(row => {
    const homeworkDate = row.homework_date || null, links = row.status === 'uploaded' ? R.homeworkVideoLinks(row.drive_file_id) : null;
    return { id: row.id, studentId: row.student_id, classId: row.class_id, postedAt: row.posted_at, homeworkDate, fingerprint: R.videoFingerprint(row.md5, row.bytes),
      manuallyAssigned: row.manual_assignment === 'true', free: row.free === 'true', subject: row.subject ?? null,
      playback: links ? { ...links, uploadedAt: row.uploaded_at } : null, createdAt: row.created_at,
      arrivedAt: R.videoArrivedAt({ createdAt: row.created_at, postedAt: row.posted_at, uploadedAt: row.uploaded_at, fromClassnote: row.post_id != null, picked: !!homeworkDate }) };
  });
}

const ATTENDANCE = sql => sql`id, student_id, class_id, session_date, slot_start, status, recorded_at`;
/** loadBlankFacts — 반 × (숙제가 나간 날) 출결로 빈 칸 사유(결석·숙제없음). */
async function loadBlankFacts(sql, t, R, input) {
  const targets = [...input.ownDates].flatMap(([pair, own]) => {
    const [classId, studentId] = pair.split(':');
    const dates = [...input.classDates.get(classId) ?? []].filter(date => !own.has(date)).sort();
    return dates.length ? [{ classId, studentId, dates }] : [];
  });
  if (!targets.length) return {};
  const classIds = [...new Set(targets.map(x => x.classId))], days = [...new Set(targets.flatMap(x => x.dates))].sort();
  const records = await J(sql`select to_jsonb(x) j from (select ${ATTENDANCE(sql)} from public.attendance_records
    where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and session_date = any(${days}::date[]) order by id) x`);
  return R.buildBlankFacts({ targets, enrollments: input.enrollments, records });
}
/** loadBlankLessonRecords — 숙제 0건 반 줄(①) 학생의 기간 출결. */
async function loadBlankLessonRecords(sql, t, pairs, from, to) {
  if (!pairs.length) return [];
  const wanted = new Set(pairs.map(p => `${p.classId}:${p.studentId}`));
  const rows = await J(sql`select to_jsonb(x) j from (select ${ATTENDANCE(sql)} from public.attendance_records where tenant_id=${t}
    and student_id = any(${[...new Set(pairs.map(p => p.studentId))]}::uuid[]) and class_id = any(${[...new Set(pairs.map(p => p.classId))]}::uuid[])
    and session_date >= ${from}::date and session_date <= ${to}::date order by id) x`);
  return rows.filter(r => wanted.has(`${r.class_id}:${r.student_id}`));
}
/** loadVideoAssignmentCandidates — 배정일이 정해지지 않았고 집계 제외도 아닌 업로드 완료 영상. */
async function loadAssignmentCandidates(sql, t, R, rows) {
  const candidates = rows.filter(row => row.assignedDates.length), range = R.videoAssignmentRange(candidates.flatMap(row => row.assignedDates));
  if (!range) return [];
  const videos = await J(sql`select to_jsonb(x) j from (select id, student_id, posted_at, route, subject from public.homework_video_ledger_videos
    where tenant_id=${t} and student_id = any(${[...new Set(candidates.map(row => row.studentId))]}::uuid[]) and status = 'uploaded' and drive_file_id is not null
      and posted_at >= ${kst(range.from)}::timestamptz and posted_at < ${kst(R.addDays(range.to, 1))}::timestamptz order by id) x`);
  return videos.flatMap(video => {
    const route = video.route && typeof video.route === 'object' ? video.route : {};
    if (route.excluded === true || (typeof route.classId === 'string' && route.classId && typeof route.homeworkDate === 'string' && R.isVideoHomeworkDate(route.homeworkDate))) return [];
    return [{ id: video.id, studentId: video.student_id, postedAt: video.posted_at, classId: typeof route.classId === 'string' ? route.classId : null, subject: video.subject ?? null }];
  });
}
/** unassignedVideoPairs(2.0 assignment-availability.ts — 서버 전용 파일이라 같은 본문). */
function unassignedVideoPairs(R, rows, videos, assignedVideoIds, subjectOf) {
  const byStudent = new Map();
  for (const video of videos) if (!assignedVideoIds.has(video.id)) byStudent.set(video.studentId, [...(byStudent.get(video.studentId) ?? []), video]);
  return new Set(rows.filter(row => (byStudent.get(row.studentId) ?? []).some(video =>
    !(subjectOf && R.isOtherSubjectVideo({ classSubject: video.classId ? subjectOf(video.classId) : null, subject: video.subject }, subjectOf(row.classId)))
    && row.assignedDates.some(date => R.isVideoAssignableToDate(video.postedAt, date)))).map(R.ledgerPairKey));
}
async function loadReviewPoints(sql, t, R, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await J(sql`select to_jsonb(x) j from (select video_id, result->'scores' scores from public.homework_video_reviews
    where tenant_id=${t} and stage='done' and video_id = any(${[...new Set(ids)]}::uuid[])) x`);
  for (const row of rows) { const points = R.reviewPoints(row.scores ?? null); if (points !== null) out.set(row.video_id, points); }
  return out;
}

/** getVideoHomeworkLedger — 2.0과 같은 순서·같은 판정(주석은 2.0 원문 참고). */
async function getLedger(sql, t, R, fromDate, toDate, scope, options) {
  const today = R.kstToday(), { from: wideFrom, to: wideTo } = R.videoMatchRange(fromDate, toDate, today);
  const classes = await J(sql`select to_jsonb(x) j from (select c.id, c.class_name, c.subject, c.is_active, c.closed_at,
      case when u.id is null then null else jsonb_build_object('display_name', u.display_name, 'tenant_id', u.tenant_id) end teacher
    from public.classes c left join public.users u on u.id = c.teacher_id where c.tenant_id=${t} order by c.id) x`);
  const enrollments = await J(sql`select to_jsonb(x) j from (select class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days
    from public.enrollments where tenant_id=${t} and (start_date is null or start_date <= ${toDate}::date) and (end_date is null or end_date >= ${fromDate}::date) order by id) x`);
  const schedules = await J(sql`select to_jsonb(x) j from (select class_id, day_of_week, valid_from, valid_to from public.class_schedules
    where tenant_id=${t} and (valid_from is null or valid_from <= ${toDate}::date) and (valid_to is null or valid_to >= ${fromDate}::date) order by id) x`);
  const markRows = await J(sql`select to_jsonb(x) j from (select class_id, student_id, check_date, homework_date, submitted_date, status, updated_at
    from public.video_homework_marks where tenant_id=${t} and check_date >= ${wideFrom}::date
      and ((homework_date >= ${wideFrom}::date and homework_date <= ${wideTo}::date) or (homework_date is null and check_date <= ${wideTo}::date)) order by id) x`);
  const assigned = await getAssigned(sql, t, R, wideFrom, wideTo);
  const marks = markRows.map(row => ({ classId: row.class_id, studentId: row.student_id, checkDate: row.check_date, homeworkDate: row.homework_date,
    submittedDate: row.submitted_date ?? null, status: row.status, updatedAt: row.updated_at }));
  const occurrences = [...assigned.map(row => ({ class_id: row.classId, student_id: row.studentId, date: row.date })),
    ...marks.map(mark => ({ class_id: mark.classId, student_id: mark.studentId, date: mark.homeworkDate ?? mark.checkDate }))];
  const activeClasses = new Set(occurrences.filter(row => row.date >= fromDate && row.date <= toDate).map(row => row.class_id));
  const lessonPairs = R.buildVideoHomeworkLessonPairs({ classes, enrollments, schedules, fromDate, toDate, today, occurrences });
  const pairs = lessonPairs.filter(pair => activeClasses.has(pair.classId) && (!scope || scope.pairs.has(`${pair.classId}:${pair.studentId}`)));
  const subjectOfIdle = new Map(classes.map(row => [row.id, row.subject]));
  const idlePairs = lessonPairs.filter(pair => !activeClasses.has(pair.classId) && (!scope || !!scope.classes?.has(pair.classId))
    && (!options.classTracked || options.classTracked(pair.classId, subjectOfIdle.get(pair.classId) ?? '')));
  const idleStudents = idlePairs.map(pair => pair.studentId);
  const ownedRoster = scope?.classes ? lessonPairs.filter(pair => activeClasses.has(pair.classId) && scope.classes.has(pair.classId)
    && !scope.pairs.has(`${pair.classId}:${pair.studentId}`)) : [];
  const assignedByPair = new Map(), extraByPair = new Map(), rejectedByPair = new Map(), keptByPair = new Map(), duesByPair = new Map();
  for (const row of assigned) {
    const key = `${row.classId}:${row.studentId}`;
    assignedByPair.set(key, [...(assignedByPair.get(key) ?? []), row.date]);
    if (row.kept) keptByPair.set(key, [...(keptByPair.get(key) ?? []), row.date]);
    if (row.extra && row.date >= fromDate && row.date <= toDate) extraByPair.set(key, [...(extraByPair.get(key) ?? []), row.date]);
    if (row.rejectedAt) rejectedByPair.set(key, { ...(rejectedByPair.get(key) ?? {}), [row.date]: row.rejectedAt });
    if (row.due) duesByPair.set(key, { ...(duesByPair.get(key) ?? {}), [row.date]: row.due });
  }
  const shownPairs = new Set(pairs.map(pair => `${pair.classId}:${pair.studentId}`));
  const studentIds = [...new Set(pairs.map(row => row.studentId))];
  const videoStudents = [...new Set([...studentIds, ...idleStudents, ...ownedRoster.map(pair => pair.studentId)])];
  const classDates = new Map(), ownDates = new Map();
  const addDate = (classId, studentId, date) => {
    if (date < fromDate || date > toDate) return;
    (classDates.get(classId) ?? classDates.set(classId, new Set()).get(classId)).add(date);
    (ownDates.get(`${classId}:${studentId}`) ?? ownDates.set(`${classId}:${studentId}`, new Set()).get(`${classId}:${studentId}`)).add(date);
  };
  for (const row of assigned) addDate(row.classId, row.studentId, row.date);
  for (const mark of marks) if (mark.homeworkDate) addDate(mark.classId, mark.studentId, mark.homeworkDate);
  for (const pair of pairs) ownDates.set(`${pair.classId}:${pair.studentId}`, ownDates.get(`${pair.classId}:${pair.studentId}`) ?? new Set());
  const inRange = date => !!date && date >= fromDate && date <= toDate;
  const markDates = new Map();
  for (const { classId, studentId, homeworkDate } of marks) if (inRange(homeworkDate)) markDates.set(`${classId}:${studentId}`, [...(markDates.get(`${classId}:${studentId}`) ?? []), homeworkDate]);
  const assignmentRows = pairs.map(pair => ({ ...pair, assignedDates: [...new Set([
    ...(assignedByPair.get(`${pair.classId}:${pair.studentId}`) ?? []).filter(inRange), ...(markDates.get(`${pair.classId}:${pair.studentId}`) ?? [])])] }));
  const students = videoStudents.length ? await J(sql`select to_jsonb(x) j from (select id, name, school, grade from public.students
    where tenant_id=${t} and id = any(${videoStudents}::uuid[]) order by id) x`) : [];
  const videos = await loadClassVideos(sql, t, R, videoStudents, wideFrom, R.addDays(wideTo, R.VIDEO_MATCH_WINDOW_DAYS), true);
  const blankFacts = await loadBlankFacts(sql, t, R, { classDates, ownDates: new Map([...ownDates].filter(([pair]) => shownPairs.has(pair))), enrollments });
  const assignmentCandidates = await loadAssignmentCandidates(sql, t, R, assignmentRows);
  const reviewOn = R.licenseExplicitlyOn(await license(sql, t, 'video_review'));
  const videoPairs = new Map(videos.flatMap(video => video.classId ? [[`${video.classId}:${video.studentId}`,
    { classId: video.classId, studentId: video.studentId, tracked: true, assignedDates: assignedByPair.get(`${video.classId}:${video.studentId}`) ?? [],
      rejected: rejectedByPair.get(`${video.classId}:${video.studentId}`), kept: keptByPair.get(`${video.classId}:${video.studentId}`) }]] : []));
  const roundRows = new Map(videoPairs);
  for (const row of assignmentRows) {
    const key = `${row.classId}:${row.studentId}`;
    if (!roundRows.has(key)) roundRows.set(key, { classId: row.classId, studentId: row.studentId, tracked: true, assignedDates: assignedByPair.get(key) ?? [],
      rejected: rejectedByPair.get(key), kept: keptByPair.get(key) });
  }
  const owners = new Map();
  const assignmentRounds = R.buildLedgerRounds({ rows: [...roundRows.values()], marks, videos, fromDate: wideFrom, toDate: wideTo, owners });
  const representative = new Set([...assignmentRounds.values()].flatMap(rounds => rounds.flatMap(round => round.videoId ? [round.videoId] : [])));
  const ownedVideos = new Set([...representative, ...owners.keys()]);
  const openRows = manual => assignmentRows.map(row => ({ ...row, assignedDates: (assignmentRounds.get(`${row.classId}:${row.studentId}`) ?? [])
    .filter(round => !round.videoId && (round.status === 'submitted') === manual && inRange(round.homeworkDate)).map(round => round.homeworkDate) }));
  const subjectOfClass = new Map(classes.map(row => [row.id, row.subject])), subjectOf = classId => subjectOfClass.get(classId);
  const assignablePairs = new Set([...unassignedVideoPairs(R, openRows(false), assignmentCandidates, representative, subjectOf),
    ...unassignedVideoPairs(R, openRows(true), assignmentCandidates, ownedVideos, subjectOf)]);
  const byClass = new Map(classes.map(row => [row.id, row])), byStudent = new Map(students.map(row => [row.id, row]));
  const pending = freeOnly => R.pendingVideoPairs({ videos, rounds: assignmentRounds, fromDate, toDate, freeOnly });
  const idle = R.splitIdlePairs(idlePairs, pending(false));
  const freeKeys = new Set(idle.free.map(pair => `${pair.classId}:${pair.studentId}`));
  const freePending = pending(true);
  const needs = R.fillablePairs({ videos, rounds: assignmentRounds, fromDate, toDate, subjectOf });
  const ownedFree = ownedRoster.filter(pair => freePending.has(`${pair.classId}:${pair.studentId}`));
  const rows = [...pairs, ...ownedFree, ...idle.free].flatMap(pair => {
    const cls = byClass.get(pair.classId), student = byStudent.get(pair.studentId), key = `${pair.classId}:${pair.studentId}`;
    const hasAssignableVideos = freeKeys.has(key) || freePending.has(key) || assignablePairs.has(key);
    return cls && student ? [{ classId: pair.classId, studentId: pair.studentId, className: cls.class_name, subject: cls.subject,
      ...(reviewOn && cls.subject === 'math' ? { aiReview: true } : {}),
      teacherName: cls.teacher?.tenant_id === t ? cls.teacher.display_name.trim() || null : null,
      studentName: student.name, school: student.school, grade: student.grade,
      hasAssignableVideos, needsVideoAssignment: hasAssignableVideos && needs.has(key),
      extraDates: [...(extraByPair.get(key) ?? [])].sort(),
      ...(rejectedByPair.has(key) ? { rejected: rejectedByPair.get(key) } : {}),
      ...(keptByPair.has(key) ? { kept: [...keptByPair.get(key)].sort() } : {}),
      ...(duesByPair.has(key) ? { dues: duesByPair.get(key) } : {}),
      assignedDates: [...new Set(assignedByPair.get(key) ?? [])].sort() }] : [];
  });
  const shown = new Set(rows.map(row => `${row.classId}:${row.studentId}`));
  const shownVideos = videos.filter(video => video.classId && shown.has(`${video.classId}:${video.studentId}`));
  const lastDay = toDate < today ? toDate : today;
  const points = reviewOn ? await loadReviewPoints(sql, t, R, shownVideos.map(video => video.id)) : new Map();
  const lessonRecords = await loadBlankLessonRecords(sql, t, idle.free, fromDate, lastDay);
  const ownedFreeFacts = ownedFree.length ? await loadBlankFacts(sql, t, R, { classDates, enrollments,
    ownDates: new Map(ownedFree.map(pair => [`${pair.classId}:${pair.studentId}`, ownDates.get(`${pair.classId}:${pair.studentId}`) ?? new Set()])) }) : null;
  let lessons = null;
  try {
    lessons = R.idleLessonDates({ pairs: idle.free, schedules, enrollments, records: lessonRecords, fromDate, toDate: lastDay,
      isHoliday: options.isHoliday, closedOn: classId => byClass.get(classId)?.closed_at });
  } catch { lessons = null; }
  for (const row of rows) if (freeKeys.has(`${row.classId}:${row.studentId}`)) row.lessonDates = lessons?.dates.get(`${row.classId}:${row.studentId}`) ?? [];
  const idleRoster = idle.rest.flatMap(pair => {
    const cls = byClass.get(pair.classId), student = byStudent.get(pair.studentId);
    return cls && student ? [{ classId: pair.classId, className: cls.class_name, subject: cls.subject, studentId: pair.studentId,
      studentName: student.name, school: student.school, grade: student.grade }] : [];
  });
  return { rows, marks: marks.filter(mark => shown.has(`${mark.classId}:${mark.studentId}`)), idleRoster,
    videos: shownVideos.map(video => points.has(video.id) ? { ...video, reviewPoints: points.get(video.id) } : video),
    blankFacts: { ...blankFacts, ...ownedFreeFacts, ...lessons?.facts }, assignedKnown: true, videosKnown: true, assignmentVideosKnown: true };
}
/** 🔴 화면으로는 Drive 주소를 보내지 않는다 — 재생 가능한 영상은 playback 칸을 빼고(판정 = 그대로), 못 하는 영상은 null 그대로. */
const forScreen = videos => videos.map(({ playback, ...video }) => (playback ? video : { ...video, playback: null }));

// ── 낸 사람(2.0 own-homework.ts) ────────────────────────────────────────────────────────────────────────────────────────
const reportRowsOf = (sql, t, narrow, from, to, userId) => J(sql`select to_jsonb(x) j from (select class_id, student_id, report_date, created_by, video_homework
  from public.lesson_reports where tenant_id=${t}
  ${narrow ? sql`and student_id = any(${narrow.students}::uuid[]) and report_date >= ${narrow.first}::date and report_date <= ${narrow.last}::date`
    : sql`and video_homework = true and report_date >= ${from}::date and report_date <= ${to}::date`}
  ${userId !== undefined ? sql`and created_by = ${userId}` : sql``} order by id) x`);
async function listVideoHomeworkIssues(sql, t, fromDate, toDate, userId) {
  if (userId !== undefined && !userId) throw new Error('숙제를 낸 사람을 확인하지 못했습니다.');
  const flagged = await reportRowsOf(sql, t, null, fromDate, toDate, userId);
  const extra = await listExtraIssues(sql, t, fromDate, toDate);
  const marks = await J(sql`select to_jsonb(x) j from (select class_id, student_id, homework_date from public.video_homework_marks
    where tenant_id=${t} and homework_date >= ${fromDate}::date and homework_date <= ${toDate}::date order by id) x`);
  const keyOf = (c, s, d) => `${c}:${s}:${d}`, out = new Map();
  const add = (classId, studentId, date, teacherId) => {
    const key = keyOf(classId, studentId, date), hit = out.get(key) ?? { classId, studentId, date, teacherIds: [] };
    if (!hit.teacherIds.includes(teacherId)) hit.teacherIds.push(teacherId);
    out.set(key, hit);
  };
  for (const row of flagged) if (row.class_id && row.created_by) add(row.class_id, row.student_id, row.report_date, row.created_by);
  const issued = new Set();
  for (const issue of extra) if (!issue.kept) {
    issued.add(keyOf(issue.classId, issue.studentId, issue.date));
    if (issue.teacherId && (userId === undefined || issue.teacherId === userId)) add(issue.classId, issue.studentId, issue.date, issue.teacherId);
  }
  const standing = new Set();
  for (const mark of marks) standing.add(keyOf(mark.class_id, mark.student_id, mark.homework_date));
  for (const issue of extra) if (issue.kept) standing.add(keyOf(issue.classId, issue.studentId, issue.date));
  for (const key of [...issued, ...out.keys()]) standing.delete(key);
  if (!standing.size) return [...out.values()];
  const students = [...new Set([...standing].map(key => key.split(':')[1]))], dates = [...standing].map(key => key.split(':')[2]).sort();
  const reports = await reportRowsOf(sql, t, { students, first: dates[0], last: dates[dates.length - 1] }, null, null, userId);
  for (const row of reports) if (row.class_id && row.created_by && row.video_homework !== true && standing.has(keyOf(row.class_id, row.student_id, row.report_date)))
    add(row.class_id, row.student_id, row.report_date, row.created_by);
  return [...out.values()];
}
async function isOwnVideoHomework(sql, t, input) {
  const report = await sql`select video_homework from public.lesson_reports where tenant_id=${t} and created_by=${input.userId} and class_id=${input.classId}
    and student_id=${input.studentId} and report_date=${input.date}::date limit 5`;
  const extra = await findExtraIssue(sql, t, input);
  const mark = await sql`select id from public.video_homework_marks where tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId}
    and homework_date=${input.date}::date limit 1`;
  if (report.some(row => row.video_homework === true)) return true;
  if (extra && !extra.kept) return extra.teacherId === input.userId;
  return report.length > 0 && (mark.length > 0 || !!extra?.kept);
}

/** getManualDriveReview — 담임 폴더에 직접 올렸지만 세지 못한 영상(건수 + 최근 30개). Drive 번호는 화면에 안 쓰여 비운다. */
async function manualDriveReview(sql, t) {
  const base = sql`tenant_id=${t} and status='review' and route->>'source' = 'drive'`;
  const items = await J(sql`select to_jsonb(x) j from (select id, route->>'fileName' file_name, route->>'reason' reason, route->>'folderName' folder_name,
    route->>'duplicateOf' duplicate_of from public.student_homework_videos where ${base} order by updated_at desc, id limit 30) x`);
  const [{ fixable, duplicates }] = await sql`select count(*) filter (where route->>'duplicateOf' is null)::int fixable,
    count(*) filter (where route->>'duplicateOf' is not null)::int duplicates from public.student_homework_videos where ${base}`;
  return { fixable, duplicates, items: items.map(r => ({ id: r.id, driveFileId: null, fileName: r.file_name, reason: r.reason, folderName: r.folder_name, duplicate: !!r.duplicate_of })) };
}

// ── 보는 사람 · 화면 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const writable = level => level === 'full' || level === 'scoped';
/** 강사 '내가 낸' 화면을 볼 사람 = 강사 역할(2.0 getShellView — 강사 역할은 늘 강사뷰). */
const teacherEditors = people => people.users.filter(u => u.role === 'teacher' && !people.operators.has(u.id))
  .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko')).map(u => ({ ...u, label: people.P.ROLE_LABEL[u.role] ?? '' }));
const listOf = list => list.map(e => ({ id: e.id, name: e.display_name, role: e.label }));

async function build({ sql, params, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, 'lesson_reports')]);
  const mine = params.view === 'mine', S = settingsOf(people), policy = S.report.videoHomeworkPolicy;
  // 강사 주소에 관리자 계열이 오면(알림 링크) 2.0처럼 같은 기간·필터의 관리자 장부로.
  if (mine && params.actor && people.editors.some(e => e.id === params.actor && e.role !== 'teacher')) return { redirectAdmin: true };
  const pool = mine ? teacherEditors(people) : people.editors, u = pool.find(e => e.id === params.actor) ?? pool[0] ?? null;
  const editors = listOf(pool);
  if (!u) return { notAllowed: true, editors };
  if (params.read) return { editors, read: await readOnServer(sql, t, R, people, u, params) };
  const today = R.kstToday(), { fromDate, toDate, rangeTooLong } = R.ledgerPeriod(n => params[n] ?? '', today);
  const holidays = R.buildHolidayMap(S.operations.holidays);
  const options = { isHoliday: date => date in holidays, classTracked: (classId, subjectKey) => R.isVideoHomeworkClassEnabled(policy, { classId, subjectKey }) };
  const level = m => people.level(u, m), lessonReportsLevel = level('lesson_reports');
  const base = { editors, viewer: { id: u.id, name: u.display_name, role: u.role }, view: mine ? 'mine' : 'admin', today, fromDate, toDate, rangeTooLong,
    operations: S.operations, policy, lessonReportsLevel };
  if (mine) {
    let own = null;
    try { own = await sql.savepoint(sp => listVideoHomeworkIssues(sp, t, fromDate, toDate, u.id)).then(list => list.map(({ classId, studentId, date }) => ({ classId, studentId, date }))); }
    catch { own = null; }
    const owned = (await sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${u.id}`).map(r => r.id);
    const ownPairs = new Set((own ?? []).map(row => R.ledgerPairKey(row)));
    const ledger = await getLedger(sql, t, R, fromDate, toDate, { pairs: ownPairs, classes: new Set(owned) }, options);
    return { ...base, own, owned, ledger: { ...ledger, videos: forScreen(ledger.videos) }, canTeacherWrite: writable(level('teacher_onescreen')) };
  }
  const ledger = await getLedger(sql, t, R, fromDate, toDate, undefined, options);
  let issuers = null;
  try {
    issuers = await sql.savepoint(async sp => {
      const issues = await listVideoHomeworkIssues(sp, t, fromDate, toDate);
      const ids = [...new Set(issues.flatMap(issue => issue.teacherIds))];
      const users = ids.length ? await sp`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : [];
      return { issues, names: users.flatMap(x => (x.display_name?.trim() ? [[x.id, x.display_name.trim()]] : [])) };
    });
  } catch { issuers = null; }
  const classnoteOn = !(S.modules.disabled ?? []).includes('classnote');
  const replyMode = S.report.classnoteParentReplyMode;
  return { ...base, ledger: { ...ledger, videos: forScreen(ledger.videos) }, issuers, classnoteOn,
    manualReview: classnoteOn ? await manualDriveReview(sql, t) : null,
    faces: { canReportSettings: level('report_settings') !== 'none', canAiMent: level('ai_ment') !== 'none',
      aiOn: R.licenseAllows(await license(sql, t, 'ai_analysis')), canSend: writable(lessonReportsLevel), classnoteOn,
      replyOn: classnoteOn && (replyMode === 'test' || replyMode === 'on') } };
}

/** GET ?read= — 2.0이 서버 함수로 읽던 것(배정 창 영상 목록 · AI 참고 메모). 둘 다 저장 없음. */
async function readOnServer(sql, t, R, people, u, params) {
  if (params.read === 'assign') return getVideoAssignmentOptions(sql, t, R, people, u, { classId: params.class, studentId: params.student, fromDate: params.from, toDate: params.to });
  // AI 참고 메모(2.0 /api/homework-videos/<id>/review) — 저장된 결과만. 다시 분석(AI 호출)은 연습 화면에서 하지 않는다(canRerun 꺼짐).
  if (!R.licenseExplicitlyOn(await license(sql, t, 'video_review'))) return { status: 404 };
  const [row] = await J(sql`select to_jsonb(x) j from (select r.stage, r.result from public.homework_video_reviews r join public.homework_video_ledger_videos v
    on v.id = r.video_id and v.tenant_id = ${t} where r.tenant_id=${t} and r.video_id=${params.video}) x`);
  if (!row) return { status: 200, view: null };
  const { state, message } = R.stageView(row.stage, !!row.result);
  return { status: 200, view: { state, message, result: row.result ? R.toResultView(row.result) : null, judgeModelLabel: R.modelDisplayLabel(row.result?.judgeModel ?? null), canRerun: false } };
}

// ── 저장(2.0 server/*.ts) ─────────────────────────────────────────────────────────────────────────────────────────────────
async function writer(ctx) {
  const { sql, tenantId: t, importV2, body } = ctx;
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, 'lesson_reports')]);
  const u = typeof body.actor === 'string' ? people.users.find(x => x.id === body.actor && !people.operators.has(x.id)) ?? null : null;
  const level = m => (u ? people.level(u, m) : 'none');
  return { R, people, u, S: settingsOf(people), level, full: level('lesson_reports') === 'full', sql, t };
}
const NO_ACTOR = '저장하는 사람을 골라 주세요.';
const shapeOk = input => !!input && typeof input === 'object' && !Array.isArray(input);
const label = target => [target.studentName, target.className].filter(Boolean).join(' · ') || null;
const logAction = (w, action, targetLabel, metadata) => audit(w.sql, w.t, w.u, action, 'video_homework', targetLabel, metadata);

/** ledgerRoundWriteError — 수업보고서 전체 권한이면 모든 칸, 아니면 강사 쓰기 + 자기가 낸 숙제 칸만. */
async function ledgerRoundWriteError(w, input) {
  if (w.full) return null;
  if (!writable(w.level('teacher_onescreen'))) return '수정 권한이 없습니다.';
  if (!input.homeworkDate) return '숙제일이 없는 옛 기록이라 여기서는 고칠 수 없습니다. 사무실에 알려 주세요.';
  try { return (await w.sql.savepoint(sp => isOwnVideoHomework(sp, w.t, { userId: w.u.id, classId: input.classId, studentId: input.studentId, date: input.homeworkDate }))) ? null : '내가 낸 숙제만 기록할 수 있습니다.'; }
  catch { return '숙제를 낸 사람을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
}
/** videoHomeworkWriteError — 수업보고서 전체 권한이거나, 그날 그 반을 맡은 강사(담임 · 위임 · JJ 보고서 담당). */
async function videoHomeworkWriteError(w, classId, date) {
  if (w.full) return null;
  if (!writable(w.level('teacher_onescreen'))) return '수정 권한이 없습니다.';
  const { sql, t, R, u } = w;
  const own = (await sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${u.id}`).map(r => r.id);
  const delegations = await J(sql`select to_jsonb(x) j from (select class_id, delegate_user_id, from_date, to_date, revoked_at from public.class_delegations
    where tenant_id=${t} and revoked_at is null and from_date <= ${date}::date and to_date >= ${date}::date limit 500) x`);
  const delegated = delegations.filter(r => r.delegate_user_id === u.id && R.isDelegationActiveOn({ fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }, date)).map(r => r.class_id);
  let jj = [];
  if ((w.people.settings.permissions?.specialAccess?.jjReportManagerIds ?? []).includes(u.id)) {
    const rows = await J(sql`select to_jsonb(x) j from (select class_id, teacher_id, slot_teacher_label, valid_from, valid_to from public.class_schedules
      where tenant_id=${t} and teacher_id is null and slot_teacher_label is not null order by id) x`);
    jj = rows.filter(r => { const slot = { teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: String(r.valid_from).slice(0, 10), validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null };
      return R.isSeatSlot(slot) && R.specialSlotLabel(r.slot_teacher_label) === R.SELF_STUDY_ROOM_LABEL && R.slotLiveOn(slot, date); }).map(r => r.class_id);
  }
  return [...own, ...delegated, ...jj].includes(classId) ? null : '담당 반만 수정할 수 있습니다.';
}
/** loadVideoHomeworkTarget — 반·학생이 있고 지금 설정으로 검사 대상인가(감사로그 이름). */
async function loadTarget(w, classId, studentId) {
  const [cls] = await w.sql`select subject, class_name from public.classes where tenant_id=${w.t} and id=${classId}`;
  const [student] = await w.sql`select grade, name from public.students where tenant_id=${w.t} and id=${studentId}`;
  if (!cls || !student) return { error: '해당 반이나 학생을 찾을 수 없습니다.' };
  return { error: null, className: cls.class_name ?? '', studentName: student.name ?? '',
    enabled: w.R.isVideoHomeworkEnabled(w.S.report.videoHomeworkPolicy, { classId, subjectKey: cls.subject, grade: student.grade }) };
}
/** writeVideoHomeworkMark — 같은 숙제 = 한 줄(있으면 그 줄을 고치고, 없을 때만 자리에 새로). */
async function writeMark(w, input) {
  const { sql, t } = w;
  const scoped = sql`tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId}`;
  const sameIds = input.homeworkDate ? (await sql`select id::text id from public.video_homework_marks where ${scoped} and homework_date=${input.homeworkDate}::date`).map(r => r.id) : [];
  if (input.status === null) {
    const slot = input.homeworkDate && !input.slotIsMine
      ? await sql`select id::text id from public.video_homework_marks where ${scoped} and check_date=${input.slotDate}::date and (homework_date is null or homework_date=${input.homeworkDate}::date)`
      : await sql`select id::text id from public.video_homework_marks where ${scoped} and check_date=${input.slotDate}::date`;
    const ids = [...new Set([...sameIds, ...slot.map(r => r.id)])];
    if (ids.length) await sql`delete from public.video_homework_marks where tenant_id=${t} and id = any(${ids}::uuid[])`;
    return { ok: true };
  }
  const submitted = input.status === 'missing' ? { set: true, value: null } : input.submittedDate !== undefined ? { set: true, value: input.submittedDate } : { set: false };
  const now = new Date().toISOString();
  if (sameIds.length) {
    await sql`update public.video_homework_marks set status=${input.status}, updated_by=${w.u.id}, updated_at=${now}::timestamptz
      ${submitted.set ? sql`, submitted_date=${submitted.value}::date` : sql``} where tenant_id=${t} and id = any(${sameIds}::uuid[])`;
    return { ok: true };
  }
  await sql`insert into public.video_homework_marks (tenant_id, class_id, student_id, check_date, homework_date, status, updated_by, updated_at ${submitted.set ? sql`, submitted_date` : sql``})
    values (${t}, ${input.classId}, ${input.studentId}, ${input.slotDate}::date, ${input.homeworkDate}::date, ${input.status}, ${w.u.id}, ${now}::timestamptz ${submitted.set ? sql`, ${submitted.value}::date` : sql``})
    on conflict (tenant_id, class_id, student_id, check_date) do update set homework_date=excluded.homework_date, status=excluded.status, updated_by=excluded.updated_by,
      updated_at=excluded.updated_at ${submitted.set ? sql`, submitted_date=excluded.submitted_date` : sql``}`;
  return { ok: true };
}
/** keepMarkOnlyRound — 검사 기록만으로 선 숙제 칸을 옮겨 남긴 숙제(kept)로. */
async function keepMarkOnlyRound(w, key, meta) {
  const { sql, t } = w;
  try {
    return await sql.savepoint(async sp => {
      const reports = await sp`select video_homework, created_by::text created_by from public.lesson_reports where tenant_id=${t} and class_id=${key.classId}
        and student_id=${key.studentId} and report_date=${key.date}::date`;
      const extra = await findExtraIssue(sp, t, key);
      const [cls] = await sp`select teacher_id::text teacher_id from public.classes where tenant_id=${t} and id=${key.classId}`;
      if (extra || reports.some(row => row.video_homework === true)) return 'assigned';
      const teacherId = reports.find(row => row.created_by)?.created_by ?? cls?.teacher_id ?? w.u.id;
      try {
        await sp.savepoint(s2 => s2`insert into public.video_homework_extra_issues (tenant_id, class_id, student_id, homework_date, teacher_id, issued_by, kept)
          values (${t}, ${key.classId}, ${key.studentId}, ${key.date}::date, ${teacherId}, ${w.u.id}, true)`);
      } catch (e) { if (e?.code === '23505') return 'assigned'; throw e; }
      await audit(sp, t, w.u, 'lesson_report_video_homework_issue', 'video_homework', null,
        { ...meta, classId: key.classId, studentId: key.studentId, homeworkDate: key.date, teacherId, kept: true });
      return 'kept';
    });
  } catch { return 'failed'; }
}
async function releaseBlankRound(w, key) {
  const { sql, t } = w;
  try {
    await sql.savepoint(async sp => {
      const marks = await sp`select 1 from public.video_homework_marks where tenant_id=${t} and class_id=${key.classId} and student_id=${key.studentId} and homework_date=${key.date}::date limit 1`;
      const videos = await sp`select 1 from public.homework_video_ledger_videos where tenant_id=${t} and student_id=${key.studentId}
        and route->>'classId' = ${key.classId} and route->>'homeworkDate' = ${key.date} limit 1`;
      if (marks.length || videos.length) return;
      await sp`delete from public.video_homework_extra_issues where tenant_id=${t} and class_id=${key.classId} and student_id=${key.studentId} and homework_date=${key.date}::date and kept = true`;
      await audit(sp, t, w.u, 'lesson_report_video_homework_issue_cancel', 'video_homework', null,
        { classId: key.classId, studentId: key.studentId, homeworkDate: key.date, kept: true, source: 'blank_lesson', reason: 'assignment_failed' });
    });
  } catch { /* 남으면 칸이 '미확인'으로 보일 뿐(2.0과 같다) */ }
}

/** loadPairRoundMaterials + pairRounds(2.0 video-submit/server/site-homework.ts) — 취소·반려가 장부와 같은 칸 판정을 쓰게. */
async function pairMaterials(w, pair, today, from) {
  const { sql, t, R } = w, LIMIT = 500, wide = R.videoMatchRange(from, today, today), key = R.roundPairKey(pair);
  const reports = await J(sql`select to_jsonb(x) j from (select student_id, class_id, report_date, video_homework_due from public.lesson_reports where tenant_id=${t}
    and video_homework = true and student_id=${pair.studentId} and class_id=${pair.classId} and report_date >= ${wide.from}::date and report_date <= ${today}::date order by id limit ${LIMIT + 1}) x`);
  const extra = (await J(sql`select to_jsonb(x) j from (select class_id, student_id, homework_date, teacher_id, kept from public.video_homework_extra_issues where tenant_id=${t}
    and student_id=${pair.studentId} and class_id=${pair.classId} and homework_date >= ${wide.from}::date and homework_date <= ${today}::date order by homework_date desc limit ${LIMIT + 1}) x`)).map(toIssue);
  const marks = await J(sql`select to_jsonb(x) j from (select class_id, student_id, check_date, homework_date, submitted_date, status, updated_at from public.video_homework_marks
    where tenant_id=${t} and student_id=${pair.studentId} and class_id=${pair.classId} and check_date >= ${wide.from}::date order by id limit ${LIMIT + 1}) x`);
  const videos = await J(sql`select to_jsonb(x) j from (select id, student_id, post_id, posted_at, created_at, uploaded_at, md5, bytes, route, drive_file_id from public.homework_video_ledger_videos
    where tenant_id=${t} and student_id=${pair.studentId} and route->>'classId' = ${pair.classId} and status='uploaded' and drive_file_id is not null
      and (posted_at >= ${kst(wide.from)}::timestamptz or route->>'manualAssignment' = 'true') order by id limit ${LIMIT + 1}) x`);
  const rejections = await listRejections(sql, t, wide.from, today, [pair.studentId]);
  if ([reports, extra, marks, videos].some(list => list.length > LIMIT)) throw new Error('영상 숙제 조회 범위 초과');
  const assigned = new Set(), kept = new Set(), dues = {};
  for (const r of reports) if (r.class_id && R.isCustomDue(r.report_date, r.video_homework_due)) dues[r.report_date] = r.video_homework_due;
  for (const r of [...reports.map(r => ({ classId: r.class_id, date: r.report_date })), ...extra.filter(x => !x.kept)]) if (r.classId) assigned.add(r.date);
  for (const x of extra.filter(issue => issue.kept)) if (!assigned.has(x.date)) { assigned.add(x.date); kept.add(x.date); }
  const arrivals = videos.flatMap(row => {
    const route = row.route && typeof row.route === 'object' && !Array.isArray(row.route) ? row.route : {};
    const links = R.homeworkVideoLinks(row.drive_file_id);
    if (!links || route.excluded === true) return [];
    const classId = typeof route.classId === 'string' ? route.classId : null, picked = typeof route.homeworkDate === 'string' && route.homeworkDate ? route.homeworkDate : null;
    return classId ? [{ id: row.id, studentId: row.student_id, classId, postedAt: row.posted_at, createdAt: row.created_at ?? null, homeworkDate: picked,
      arrivedAt: R.videoArrivedAt({ createdAt: row.created_at, postedAt: row.posted_at, uploadedAt: row.uploaded_at, fromClassnote: row.post_id != null, picked: !!picked }),
      playback: { ...links, uploadedAt: row.uploaded_at ?? null }, manuallyAssigned: route.manualAssignment === true, free: route.free === true,
      fingerprint: R.videoFingerprint(row.md5, row.bytes), note: typeof route.note === 'string' && route.note.trim() ? route.note : null }] : [];
  });
  const rejected = {};
  for (const r of rejections) if (R.roundPairKey(r) === key) rejected[r.date] = r.rejectedAt;
  const ownersMap = new Map();
  const rounds = R.buildLedgerRounds({ rows: [{ classId: pair.classId, studentId: pair.studentId, assignedDates: [...assigned].sort(), tracked: true,
      rejected: Object.keys(rejected).length ? rejected : undefined, kept: [...kept], dues: Object.keys(dues).length ? dues : undefined }],
    marks: marks.map(row => ({ classId: row.class_id, studentId: row.student_id, checkDate: row.check_date, homeworkDate: row.homework_date,
      submittedDate: row.submitted_date ?? null, status: row.status, updatedAt: row.updated_at })),
    videos: arrivals, fromDate: from, toDate: today, owners: ownersMap }).get(key) ?? [];
  return { rounds, owners: ownersMap, videos: arrivals };
}

/** reconcileVideoHomework(studentId) — 응답 전에 자동 판정(2.0과 같다). 실패해도 저장은 그대로(2.0은 보고만 한다). */
async function reconcile(w, studentId) {
  const { sql, t, R, S } = w;
  try {
    await sql.savepoint(async sp => {
      const policy = S.report.videoHomeworkPolicy;
      if (!policy.enabled) return;
      const today = R.kstToday(), range = R.videoMatchRange(R.addDays(today, -30), today, today), observedAt = new Date().toISOString();
      const assigned = await getAssigned(sp, t, R, range.from, today, studentId);
      const students = await sp`select id::text id, grade, is_test from public.students where tenant_id=${t} and id=${studentId}`;
      const classes = await sp`select id::text id, subject from public.classes where tenant_id=${t}`;
      const markRows = await J(sp`select to_jsonb(x) j from (select class_id, student_id, check_date, homework_date, status from public.video_homework_marks
        where tenant_id=${t} and homework_date >= ${range.from}::date and homework_date <= ${today}::date and student_id=${studentId} order by id) x`);
      const byStudent = new Map(students.filter(s => !s.is_test).map(s => [s.id, s])), byClass = new Map(classes.map(c => [c.id, c]));
      const targets = assigned.filter(h => { const s = byStudent.get(h.studentId), c = byClass.get(h.classId);
        return s && c && R.isVideoHomeworkEnabled(policy, { classId: c.id, subjectKey: c.subject, grade: s.grade }); });
      const videos = await loadClassVideos(sp, t, R, [...new Set(targets.map(h => h.studentId))], range.from, R.addDays(range.to, R.VIDEO_MATCH_WINDOW_DAYS), true);
      const marks = markRows.map(row => ({ classId: row.class_id, studentId: row.student_id, checkDate: row.check_date, homeworkDate: row.homework_date, status: row.status }));
      const { outcomes } = R.videoHomeworkOutcomes(targets, videos, today, range.from, marks, classId => byClass.get(classId)?.subject);
      for (let start = 0; start < outcomes.length; start += 100)
        await sp`select public.reconcile_video_homework_outcomes(${t}, ${sp.json(outcomes.slice(start, start + 100))}, ${observedAt}::timestamptz)`;
    });
  } catch (e) { console.error(`2.0 video-homework reconcile skipped: ${e?.code || ''} ${e?.message || ''}`); }
}

const ROUND_STATUSES = ['submitted', 'missing', null];
const badSubmittedDate = (R, value) => value != null && (!R.isVideoHomeworkDate(value) || value > R.kstToday());

async function setVideoHomeworkRound(ctx) {
  const w = await writer(ctx), { R } = w, input = ctx.body.args[0];
  if (!w.u) return { ok: false, error: NO_ACTOR };
  if (!shapeOk(input) || typeof input.roundKey !== 'string' || !UUID.test(String(input.classId)) || !UUID.test(String(input.studentId))) return { ok: false, error: '회차를 확인할 수 없습니다.' };
  const [kind, date] = [input.roundKey.slice(0, 2), input.roundKey.slice(2)];
  if ((kind !== 'h:' && kind !== 'c:') || !R.isVideoHomeworkDate(date)) return { ok: false, error: '회차를 확인할 수 없습니다.' };
  if (date > R.kstToday()) return { ok: false, error: '아직 나가지 않은 숙제는 기록할 수 없습니다.' };
  if (!ROUND_STATUSES.includes(input.status)) return { ok: false, error: '유효하지 않은 상태입니다.' };
  if (badSubmittedDate(R, input.submittedDate)) return { ok: false, error: '제출일은 오늘까지의 올바른 날짜로 입력해 주세요.' };
  const homeworkDate = kind === 'h:' ? date : null;
  if (homeworkDate && input.submittedDate && input.submittedDate < homeworkDate) return { ok: false, error: '제출일은 숙제가 나간 날보다 빠를 수 없습니다.' };
  const denied = await ledgerRoundWriteError(w, { classId: input.classId, studentId: input.studentId, homeworkDate });
  if (denied) return { ok: false, error: denied };
  const target = await loadTarget(w, input.classId, input.studentId);
  if (target.error !== null) return { ok: false, error: target.error };
  if (input.status !== null && !target.enabled) return { ok: false, error: '영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요.' };
  const { sql, t } = w;
  const recorded = homeworkDate
    ? await sql`select id from public.video_homework_marks where tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId} and homework_date=${homeworkDate}::date limit 1`
    : await sql`select id from public.video_homework_marks where tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId} and check_date=${date}::date and homework_date is null limit 1`;
  if (!recorded.length) {
    const assigned = homeworkDate ? await sql`select id from public.lesson_reports where tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId}
      and report_date=${homeworkDate}::date and video_homework = true limit 1` : null;
    const extra = homeworkDate && !assigned?.length ? await findExtraIssue(sql, t, { classId: input.classId, studentId: input.studentId, date: homeworkDate }) : null;
    if (!assigned?.length && !extra) return { ok: false, error: '그날 이 학생에게 나간 영상 과제를 찾을 수 없습니다.' };
  }
  let kept = false, stays = input.status === null && !recorded.length;
  if (input.status === null && homeworkDate && recorded.length) {
    const keep = await keepMarkOnlyRound(w, { classId: input.classId, studentId: input.studentId, date: homeworkDate });
    if (keep === 'failed') return { ok: false, error: '숙제 칸을 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
    kept = keep === 'kept'; stays = kept || keep === 'assigned';
  }
  const submittedDate = 'submittedDate' in input ? input.submittedDate : undefined;
  const result = await writeMark(w, { classId: input.classId, studentId: input.studentId, slotDate: homeworkDate ? R.addDays(homeworkDate, 1) : date, homeworkDate,
    submittedDate, status: input.status });
  if (result.ok) await logAction(w, 'lesson_report_video_homework_mark', label(target), { classId: input.classId, studentId: input.studentId, homeworkDate,
    checkDate: homeworkDate ? null : date, status: input.status ?? 'cleared', submittedDate: input.status === 'submitted' ? input.submittedDate ?? null : null,
    ...(kept ? { keptAsIssue: true } : {}) });
  return result.ok && stays ? { ...result, kept: true } : result;
}

const REFUSED = {
  submitted: '완료로 기록된 숙제는 취소할 수 없습니다. 기록을 미확인으로 되돌린 뒤 취소해 주세요.',
  has_video: '영상이 붙은 숙제는 취소할 수 없습니다. 영상을 반려하거나 다른 숙제로 옮긴 뒤 취소해 주세요.',
  uploading: '학생이 이 숙제에 올린 영상을 아직 받는 중입니다. 잠시 뒤 다시 확인해 주세요.',
  changed: '그사이 영상이나 기록이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  missing: '취소할 숙제를 찾지 못했습니다. 화면을 새로고침해 주세요.',
};
const pairInput = input => shapeOk(input) && UUID.test(String(input.classId)) && UUID.test(String(input.studentId));

async function cancelVideoHomework(ctx) {
  const w = await writer(ctx), { R } = w, input = ctx.body.args[0];
  if (!w.u) return { ok: false, error: NO_ACTOR };
  if (!pairInput(input) || !R.isVideoHomeworkDate(input.homeworkDate)) return { ok: false, error: '반·학생·숙제일을 확인해 주세요.' };
  const { classId, studentId, homeworkDate } = input, today = R.kstToday();
  if (homeworkDate > today) return { ok: false, error: '아직 나가지 않은 숙제입니다.' };
  const FAILED = { ok: false, error: '숙제를 취소하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
  try {
    const denied = await ledgerRoundWriteError(w, { classId, studentId, homeworkDate });
    if (denied) return { ok: false, error: denied.startsWith('내가 낸 숙제만') ? '내가 낸 숙제만 취소할 수 있습니다.' : denied };
    const target = await loadTarget(w, classId, studentId);
    if (target.error !== null) return { ok: false, error: target.error };
    const [report] = await w.sql`select created_by::text created_by from public.lesson_reports where tenant_id=${w.t} and class_id=${classId} and student_id=${studentId}
      and report_date=${homeworkDate}::date and video_homework = true limit 1`;
    const author = report?.created_by ?? null, touchReport = w.full || !author || author === w.u.id;
    const observedAt = new Date().toISOString();
    const { rounds } = await pairMaterials(w, { classId, studentId }, today, homeworkDate);
    const round = rounds.find(r => r.homeworkDate === homeworkDate);
    if (!round) return { ok: false, error: REFUSED.missing };
    if (touchReport && round.status === 'submitted') return { ok: false, error: round.videoId ? REFUSED.has_video : REFUSED.submitted };
    if (touchReport && round.videoId) return { ok: false, error: REFUSED.has_video };
    const legacyCheck = round.mark && !round.mark.homeworkDate ? round.mark.checkDate : null;
    const [{ r: result }] = await w.sql.savepoint(sp => sp`select public.cancel_video_homework(${w.t}, ${classId}, ${studentId}, ${homeworkDate}::date,
      ${observedAt}::timestamptz, ${legacyCheck}::date, ${touchReport}) r`);
    if (result === 'missing' && !touchReport) return { ok: false, error: '다른 선생님이 쓴 보고서의 영상 숙제는 그 선생님이나 관리자만 취소할 수 있습니다.' };
    if (!['cancelled', 'cancelled_report', 'kept'].includes(result)) return { ok: false, error: REFUSED[result] ?? '숙제를 취소하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
    await logAction(w, 'lesson_report_video_homework_cancel', label(target), { classId, studentId, homeworkDate, status: round.status, ...(round.due ? { due: round.due } : {}),
      ...(result === 'cancelled_report' ? { fromReport: true } : {}), ...(result === 'kept' ? { keptReport: true } : {}) });
    await reconcile(w, studentId);
    return result === 'kept' ? { ok: true, kept: true } : { ok: true };
  } catch (e) { console.error(`2.0 video-homework cancel failed: ${e?.code || ''} ${e?.message || ''}`); return FAILED; }
}

async function issueExtraVideoHomework(ctx) {
  const w = await writer(ctx), { R } = w, input = ctx.body.args[0];
  if (!w.u) return { ok: false, error: NO_ACTOR };
  if (!pairInput(input) || typeof input.date !== 'string' || !R.isVideoHomeworkDate(input.date)) return { ok: false, error: '반·학생·날짜를 확인해 주세요.' };
  const { classId, studentId, date } = input, today = R.kstToday();
  if (date > today) return { ok: false, error: '아직 수업하지 않은 날에는 영상 숙제를 낼 수 없습니다.' };
  if (date < R.addDays(today, -R.EXTRA_ISSUE_LOOKBACK_DAYS)) return { ok: false, error: `${R.EXTRA_ISSUE_LOOKBACK_DAYS}일이 지난 수업에는 영상 숙제를 낼 수 없습니다.` };
  const denied = await videoHomeworkWriteError(w, classId, date);
  if (denied) return { ok: false, error: denied };
  const { sql, t } = w, FAILED = { ok: false, error: '영상 숙제를 내지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
  try {
    const target = await loadTarget(w, classId, studentId);
    const [cls] = await sql`select teacher_id::text teacher_id from public.classes where tenant_id=${t} and id=${classId}`;
    const schedules = await J(sql`select to_jsonb(x) j from (select day_of_week, valid_from, valid_to from public.class_schedules where tenant_id=${t} and class_id=${classId}) x`);
    const enrollments = await J(sql`select to_jsonb(x) j from (select class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days
      from public.enrollments where tenant_id=${t} and class_id=${classId} and student_id=${studentId}) x`);
    const attendance = await J(sql`select to_jsonb(x) j from (select ${ATTENDANCE(sql)} from public.attendance_records where tenant_id=${t} and class_id=${classId}
      and student_id=${studentId} and session_date >= ${date}::date and session_date <= ${today}::date order by id) x`);
    const reports = await J(sql`select to_jsonb(x) j from (select report_date, video_homework, created_by from public.lesson_reports where tenant_id=${t}
      and class_id=${classId} and student_id=${studentId} and report_date >= ${date}::date and report_date <= ${today}::date) x`);
    const existing = await findExtraIssue(sql, t, { classId, studentId, date });
    if (target.error !== null) return { ok: false, error: target.error };
    if (!target.enabled) return { ok: false, error: '영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요.' };
    if (!cls) return { ok: false, error: '수업 정보를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
    if (existing || reports.some(row => row.report_date === date && row.video_homework === true)) return { ok: false, error: '이미 영상 숙제가 나간 날입니다. 화면을 새로고침해 주세요.' };
    const records = R.effectiveAttendanceRecords(attendance);
    const lessonError = R.extraIssueLessonError({ date, schedules, enrollments, slots: records.filter(row => row.session_date === date).map(row => ({ status: row.status })) });
    if (lessonError) return { ok: false, error: lessonError };
    const holidays = R.buildHolidayMap(w.S.operations.holidays);
    const window = R.extraIssueWindow({ homeworkDate: date, today, schedules, enrollments, isHoliday: day => day in holidays,
      lessonDates: [...records.map(row => row.session_date), ...reports.map(row => row.report_date)] });
    if (!window.open) return { ok: false, error: `다음 수업(${window.nextLesson.slice(5).replace('-', '.')})이 지나 낼 수 없습니다. 따로 내는 숙제는 다음 수업 전까지만 됩니다.` };
    // 누구의 숙제인가 — 강사 화면(강사 역할 = 2.0 강사뷰)이면 그 강사, 관리자 화면이면 그날 보고서를 쓴 사람 → 반 담임 → 누른 사람.
    const reportAuthor = reports.find(row => row.report_date === date && row.created_by)?.created_by ?? null;
    const teacherId = w.u.role === 'teacher' ? w.u.id : reportAuthor ?? cls.teacher_id ?? w.u.id;
    try {
      await sql.savepoint(sp => sp`insert into public.video_homework_extra_issues (tenant_id, class_id, student_id, homework_date, teacher_id, issued_by)
        values (${t}, ${classId}, ${studentId}, ${date}::date, ${teacherId}, ${w.u.id})`);
    } catch (e) { return e?.code === '23505' ? { ok: false, error: '이미 영상 숙제가 나간 날입니다. 화면을 새로고침해 주세요.' } : FAILED; }
    const deadline = R.addDays(date, R.SITE_HOMEWORK_DAYS);
    await logAction(w, 'lesson_report_video_homework_issue', label(target), { classId, studentId, homeworkDate: date, deadline, teacherId });
    await reconcile(w, studentId);
    return { ok: true, deadline };
  } catch (e) { console.error(`2.0 video-homework issue failed: ${e?.code || ''} ${e?.message || ''}`); return FAILED; }
}

async function rejectHomeworkVideos(ctx) {
  const w = await writer(ctx), { R } = w, input = ctx.body.args[0];
  if (!w.u) return { ok: false, error: NO_ACTOR };
  if (!pairInput(input) || !R.isVideoHomeworkDate(input.homeworkDate)) return { ok: false, error: '반·학생·숙제일을 확인해 주세요.' };
  const { classId, studentId, homeworkDate } = input, today = R.kstToday(), { sql, t } = w;
  if (homeworkDate > today) return { ok: false, error: '아직 나가지 않은 숙제입니다.' };
  try {
    const denied = await ledgerRoundWriteError(w, { classId, studentId, homeworkDate });
    if (denied) return { ok: false, error: denied };
    const target = await loadTarget(w, classId, studentId);
    if (target.error !== null) return { ok: false, error: target.error };
    const observedAt = new Date().toISOString();
    const { rounds, owners, videos } = await pairMaterials(w, { classId, studentId }, today, homeworkDate);
    const targets = R.rejectTargets(rounds, owners, videos, classId, homeworkDate);
    if (!targets.length) return { ok: false, error: '이 숙제에 붙은 영상이 없습니다. 화면을 새로고침해 주세요.' };
    if (targets.length > 50) return { ok: false, error: `이 숙제에 붙은 영상이 ${targets.length}개라 한 번에 반려할 수 없습니다(최대 50개). 영상을 먼저 다른 숙제로 옮겨 주세요.` };
    const round = rounds.find(r => r.homeworkDate === homeworkDate), mark = round?.mark;
    const keep = round && !round.assigned && !round.kept ? await keepMarkOnlyRound(w, { classId, studentId, date: homeworkDate }) : null;
    if (keep === 'failed') return { ok: false, error: '숙제 칸을 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
    const legacyCheck = mark && !mark.homeworkDate ? mark.checkDate : null;
    const files = await sql`select id::text id, drive_file_id from public.homework_video_ledger_videos where tenant_id=${t} and student_id=${studentId} and id = any(${targets}::uuid[])`;
    const [{ r: data }] = await sql.savepoint(sp => sp`select public.reject_homework_videos(${t}, ${w.u.id}, ${studentId}, ${classId}, ${homeworkDate}::date, ${targets}::uuid[],
      ${'미확인으로 되돌림 — 영상 반려(Drive 휴지통)'}, ${observedAt}::timestamptz, ${legacyCheck}::date) r`);
    if (data === 'changed') return { ok: false, error: '그사이 영상 연결이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
    if (data !== 'rejected') return { ok: false, error: '영상을 반려하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
    // 휴지통 — 연습 화면은 Drive를 부르지 않는다. 2.0 trashFiles의 셈 그대로: 다른 영상 줄이 같은 파일을 쓰면 남겨 둠(trashShared),
    // 나머지는 2.0이 자격을 못 읽었을 때처럼 '못 옮김'(trashFailed). 반려 자체는 그대로다(2.0도 못 옮겨도 반려는 남는다).
    let trashed = 0, trashFailed = 0, trashShared = 0;
    const ids = new Set(files.map(f => f.id));
    for (const file of files) {
      if (!file.drive_file_id) continue;
      const shared = await sql`select id::text id from public.student_homework_videos where tenant_id=${t} and drive_file_id=${file.drive_file_id} limit 20`;
      if (shared.some(row => !ids.has(row.id))) trashShared++; else trashFailed++;
    }
    const reopened = R.homeworkOpen(homeworkDate, today, round?.due);
    await logAction(w, 'lesson_report_video_homework_reject', label(target), { classId, studentId, homeworkDate, videos: targets.length, trashed, trashFailed, trashShared,
      reopened, ...(keep === 'kept' ? { keptAsIssue: true } : {}) });
    await reconcile(w, studentId);
    return { ok: true, rejected: targets.length, trashed, trashFailed, trashShared, reopened };
  } catch (e) { console.error(`2.0 video-homework reject failed: ${e?.code || ''} ${e?.message || ''}`); return { ok: false, error: '영상을 반려하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }; }
}

// ── 영상 배정(2.0 video-assignment.ts) ─────────────────────────────────────────────────────────────────────────────────────
class AssignmentError extends Error {}
async function assignmentContext(w, classId, studentId, period) {
  const { sql, t, u } = w;
  if (!u) throw new AssignmentError('로그인 후 다시 시도해 주세요.');
  if (!UUID.test(String(classId)) || !UUID.test(String(studentId))) throw new AssignmentError('반과 학생을 확인해 주세요.');
  if (!w.full && !writable(w.level('teacher_onescreen'))) throw new AssignmentError('영상 배정 권한이 없습니다.');
  const [cls] = await sql`select teacher_id::text teacher_id from public.classes where tenant_id=${t} and id=${classId}`;
  if (!cls || (!w.full && cls.teacher_id !== u.id)) throw new AssignmentError('본인 담임 반의 영상만 배정할 수 있습니다.');
  const range = period ? sql`and report_date >= ${period.fromDate}::date and report_date <= ${period.toDate}::date` : sql``;
  const reports = await sql`select report_date::text d from public.lesson_reports where tenant_id=${t} and class_id=${classId} and student_id=${studentId}
    and video_homework = true ${range} order by report_date desc limit ${period ? 366 : 1}`;
  const extra = await J(sql`select to_jsonb(x) j from (select homework_date from public.video_homework_extra_issues where tenant_id=${t} and student_id=${studentId}
    and class_id=${classId} ${period ? sql`and homework_date >= ${period.fromDate}::date and homework_date <= ${period.toDate}::date` : sql``} order by homework_date desc limit ${period ? 366 : 1}) x`);
  const marks = await sql`select homework_date::text d from public.video_homework_marks where tenant_id=${t} and class_id=${classId} and student_id=${studentId}
    and homework_date is not null ${period ? sql`and homework_date >= ${period.fromDate}::date and homework_date <= ${period.toDate}::date` : sql``} order by homework_date desc limit ${period ? 366 : 1}`;
  const issued = new Set([...reports.map(r => r.d), ...extra.map(x => x.homework_date)]);
  const markOnly = new Set(marks.map(r => r.d).filter(d => !issued.has(d)));
  return { dates: [...new Set([...issued, ...markOnly])].sort().reverse(), markOnly };
}
const holidayCheck = w => { const holidays = w.R.buildHolidayMap(w.S.operations.holidays); return date => date in holidays; };
/** loadPairLessons(2.0 blank-lessons.ts) — 한 반 × 학생의 배치·수강·기간 출결. */
async function pairLessons(w, key, fromDate, toDate) {
  const { sql, t } = w;
  const [cls] = await sql`select closed_at::text closed_at from public.classes where tenant_id=${t} and id=${key.classId}`;
  const schedules = await J(sql`select to_jsonb(x) j from (select day_of_week, valid_from, valid_to from public.class_schedules where tenant_id=${t} and class_id=${key.classId}) x`);
  const enrollments = await J(sql`select to_jsonb(x) j from (select class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days from public.enrollments
    where tenant_id=${t} and class_id=${key.classId} and student_id=${key.studentId}) x`);
  const records = await J(sql`select to_jsonb(x) j from (select ${ATTENDANCE(sql)} from public.attendance_records where tenant_id=${t} and class_id=${key.classId}
    and student_id=${key.studentId} and session_date >= ${fromDate}::date and session_date <= ${toDate}::date order by id) x`);
  return { schedules, enrollments, records, closedOn: cls?.closed_at ?? null };
}

async function getVideoAssignmentOptions(sql, t, R, people, u, input) {
  if (!input || !R.isVideoHomeworkDate(input.fromDate) || !R.isVideoHomeworkDate(input.toDate) || input.fromDate > input.toDate
    || input.toDate > R.addDays(input.fromDate, 365)) return { ok: false, error: '조회 기간을 확인해 주세요.' };
  const level = m => people.level(u, m);
  const w = { sql, t, R, u, people, S: settingsOf(people), level, full: level('lesson_reports') === 'full' };
  try {
    const blankFrom = R.addDays(input.fromDate, -R.VIDEO_ASSIGNMENT_WINDOW_DAYS);
    const { dates: allDates } = await assignmentContext(w, input.classId, input.studentId, { fromDate: blankFrom, toDate: input.toDate });
    const dates = allDates.filter(date => date >= input.fromDate && date <= input.toDate);
    const range = R.videoAssignmentRange([...dates, blankFrom, input.toDate]);
    const today = R.kstToday(), until = input.toDate < today ? input.toDate : today;
    const blankDates = blankFrom > until ? [] : R.blankLessonDates({ ...(await pairLessons(w, input, blankFrom, until)), fromDate: blankFrom, toDate: until,
      isHoliday: holidayCheck(w), exclude: new Set(allDates) });
    const videos = await J(sql`select to_jsonb(x) j from (select id, posted_at, post_id, source, drive_file_id, uploaded_at, route, assignment_revision, subject
      from public.homework_video_ledger_videos where tenant_id=${t} and student_id=${input.studentId} and status='uploaded' and drive_file_id is not null
        and posted_at >= ${kst(range.from)}::timestamptz and posted_at < ${kst(R.addDays(range.to, 1))}::timestamptz order by posted_at desc, id) x`);
    const classes = await J(sql`select to_jsonb(x) j from (select id, class_name, subject from public.classes where tenant_id=${t} order by id) x`);
    const byClass = new Map(classes.map(c => [c.id, c])), targetSubject = byClass.get(input.classId)?.subject ?? null;
    const routeOf = v => (v.route && typeof v.route === 'object' ? v.route : {});
    const same = videos.filter(v => !R.isOtherSubjectVideo({ classSubject: byClass.get(String(routeOf(v).classId))?.subject, subject: v.subject }, targetSubject));
    const targets = [...dates, ...blankDates];
    return { ok: true, dates, blankDates, videos: same.filter(v => targets.some(date => R.isVideoAssignableToDate(v.posted_at, date))).map(v => {
      const route = routeOf(v);
      // 🔴 재생 주소(Drive)는 보내지 않는다 — 창은 '이 영상은 아직 재생할 수 없습니다'를 보인다.
      return { id: String(v.id), postedAt: String(v.posted_at), className: byClass.get(String(route.classId))?.class_name ?? null,
        classId: typeof route.classId === 'string' ? route.classId : null, homeworkDate: typeof route.homeworkDate === 'string' ? route.homeworkDate : null,
        source: v.source === 'link' ? '제출 링크' : 'ClassNote / Drive', note: typeof route.note === 'string' && route.note.trim() ? route.note.trim().slice(0, 100) : null,
        free: route.free === true, postId: typeof v.post_id === 'number' ? v.post_id : null, revision: Number(v.assignment_revision), excluded: route.excluded === true, playback: null };
    }) };
  } catch (e) { return { ok: false, error: e instanceof AssignmentError ? e.message : '영상 목록을 읽지 못했습니다.' }; }
}

async function assignHomeworkVideo(ctx) {
  const w = await writer(ctx), { R, sql, t } = w, input = ctx.body.args[0];
  if (!shapeOk(input) || !UUID.test(String(input.videoId)) || typeof input.excluded !== 'boolean' || !Number.isInteger(input.revision) || input.revision < 0
    || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 300
    || (!input.excluded && (!input.homeworkDate || !R.isVideoHomeworkDate(input.homeworkDate)))) return { ok: false, error: '영상·숙제 날짜와 변경 사유를 확인해 주세요.' };
  let release = async () => {};
  try {
    const { dates, markOnly } = await assignmentContext(w, input.classId, input.studentId, input.excluded ? undefined : { fromDate: input.homeworkDate, toDate: input.homeworkDate });
    if (input.excluded && !dates.length) return { ok: false, error: '이 학생에게 낸 이 반 영상 숙제가 없어 집계 제외를 저장할 수 없습니다. 숙제없음 수업일에 붙여 주세요.' };
    const blank = !input.excluded && !dates.includes(input.homeworkDate);
    if (blank) {
      const problem = input.homeworkDate > R.kstToday() ? '아직 수업하지 않은 날에는 영상을 붙일 수 없습니다.'
        : R.blankLessonDayError({ ...(await pairLessons(w, input, input.homeworkDate, input.homeworkDate)), date: input.homeworkDate, isHoliday: holidayCheck(w) });
      if (problem) return { ok: false, error: problem };
    }
    if (!input.excluded) {
      const [video] = await J(sql`select to_jsonb(x) j from (select posted_at, subject, route, assignment_revision from public.homework_video_ledger_videos
        where tenant_id=${t} and student_id=${input.studentId} and id=${input.videoId} and status='uploaded' and drive_file_id is not null) x`);
      if (!video) return { ok: false, error: '업로드가 완료된 학생 영상만 배정할 수 있습니다.' };
      if (!R.isVideoAssignableToDate(video.posted_at, input.homeworkDate)) return { ok: false, error: blank
        ? '그 수업일부터 14일 뒤까지 게시된 영상만 붙일 수 있습니다.' : '숙제를 낸 날부터 14일 뒤까지 게시된 영상만 배정할 수 있습니다.' };
      const videoClass = video.route?.classId;
      const subjects = await sql`select id::text id, subject from public.classes where tenant_id=${t}
        and id = any(${[input.classId, ...(typeof videoClass === 'string' && /^[0-9a-f-]{36}$/i.test(videoClass) ? [videoClass] : [])]}::uuid[])`;
      const subjectOf = new Map(subjects.map(c => [c.id, c.subject]));
      if (R.isOtherSubjectVideo({ classSubject: typeof videoClass === 'string' ? subjectOf.get(videoClass) : null, subject: video.subject }, subjectOf.get(input.classId)))
        return { ok: false, error: '다른 과목 영상은 이 반 숙제에 배정할 수 없습니다.' };
      if (markOnly.has(input.homeworkDate)) {
        const keep = await keepMarkOnlyRound(w, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate });
        if (keep !== 'kept' && keep !== 'assigned') return { ok: false, error: '이 숙제 칸을 영상을 붙일 수 있게 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
      }
      if (blank) {
        if (Number(video.assignment_revision ?? 0) !== input.revision) return { ok: false, error: '다른 곳에서 영상 배정이 변경됐습니다. 창을 닫고 다시 열어 확인해 주세요.' };
        const keep = await keepMarkOnlyRound(w, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate }, { source: 'blank_lesson' });
        if (keep !== 'kept' && keep !== 'assigned') return { ok: false, error: '이 수업을 영상 숙제 칸으로 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
        if (keep === 'kept') release = () => releaseBlankRound(w, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate });
      }
    }
    let data;
    try {
      [{ r: data }] = await sql.savepoint(sp => sp`select public.set_homework_video_assignment(${t}, ${w.u.id}, ${w.full}, ${input.studentId}, ${input.classId},
        ${input.videoId}, ${input.excluded ? null : input.homeworkDate}::date, ${input.excluded}, ${input.revision}, ${input.reason.trim()}) r`);
    } catch { await release(); return { ok: false, error: '영상 배정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }; }
    const errors = { conflict: '다른 곳에서 영상 배정이 변경됐습니다. 창을 닫고 다시 열어 확인해 주세요.', denied: '이 영상의 배정을 변경할 권한이 없습니다.',
      unavailable: '업로드가 완료된 학생 영상만 배정할 수 있습니다.', invalid_homework: '해당 학생에게 실제로 낸 영상 숙제를 골라 주세요.' };
    if (data !== 'saved') { await release(); return { ok: false, error: errors[String(data)] ?? '영상 배정 정보를 확인해 주세요.' }; }
    await reconcile(w, input.studentId);
    return { ok: true };
  } catch (e) {
    await release();
    return { ok: false, error: e instanceof AssignmentError ? e.message : '영상 배정을 저장하지 못했습니다.' };
  }
}

const action = (module, run) => ({ validate: raw => serverCall(raw, [module], 1), run });
export const screen = {
  id: ID, label: '영상 제출 현황', order: 42,
  params: {
    actor: UUID, view: /^mine$/, from: DAY, to: DAY, date: DAY, q: /^[^\u0000-\u001f]{0,100}$/, subject: /^[^\u0000-\u001f]{1,40}$/, grade: /^[^\u0000-\u001f]{1,40}$/,
    status: /^(submitted|missing|unchecked|assign|all)$/, sort: /^(name|missing|completion)$/, class: /^[0-9a-f,-]{36,1200}$/i, school: /^[^\u0000-\u001f]{1,60}$/, teacher: /^[^\u0000-\u001f]{1,80}$/,
    read: /^(assign|review)$/, student: UUID, video: UUID,
  },
  paramMax: { class: 1200 },
  actions: {
    setVideoHomeworkRound: action(MODULES.actions, setVideoHomeworkRound),
    cancelVideoHomework: action(MODULES.cancel, cancelVideoHomework),
    issueExtraVideoHomework: action(MODULES.issue, issueExtraVideoHomework),
    rejectHomeworkVideos: action(MODULES.reject, rejectHomeworkVideos),
    assignHomeworkVideo: action(MODULES.assign, assignHomeworkVideo),
  },
  load: build,
};
export { loadRules, ADMIN_PATH, videoHomeworkWriteError, loadTarget, writeMark };
