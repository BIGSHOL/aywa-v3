// 2.0 화면 — 퇴원보고서(목록 · 보고서 상세 · 스프레드시트 원본 상세) (V2-SCREENS.md `withdrawal-reports`, 처리 화면 세션 R).
// 원장 10-28 *"근거보기 들어가도 뭘 처리할 수가 없음"* — 첫 화면 '퇴원보고서 승인 대기'가 여기서 승인·반려·처리까지 끝나야 한다.
// 그리기는 2.0의 실제 React 부품(v2-host/src/withdrawal-reports.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 같은 결과로:
//  · 조회 = features/withdrawal-reports/server/queries.ts(reportViewer · listReports · getReport · reportStaff · requestStudents ·
//    directProcessingReady) · server/archives.ts · server/prefill.ts · server/consultations.ts · withdrawals/server/detail-href.ts —
//    표·칸·조건을 SQL로, 판정(snapshotMatches · isBookkeepingReport · canReadReport · 미리 채움 문장)은 2.0 순수 함수(importV2) 그대로.
//  · 보는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 2.0 reportViewer와 같은 판정(강사 역할이면 강사뷰 · 과목 범위 · 쓰기 권한).
//    겸직의 강사뷰 전환·'다른 강사 뷰'·실험실 배정은 3.0에 없어 관리자 보기로 본다.
//  · 저장 = 2.0 server/actions.ts · archive-actions.ts의 네 함수(같은 이름 · 같은 인자 · 같은 검증 · 같은 DB 함수 · 같은 감사로그).
//    2.0과 다른 점: 슬랙 깨우기(pokeSlack)와 수학 퇴원 시트 기록(recordMathWithdrawalToSheet — Google 시트)은 바깥 전송이라 하지 않는다.
//    DB 함수가 남기는 알림(notifications)·처리 이력(withdrawal_report_events)은 그대로 복사본에 남는다.
import { V2Error } from './v2-screens.mjs';
import { UUID, audit, readPeople, rpcSoft, serverCall } from './v2-proc-people.mjs';

const ID = 'withdrawal-reports', MENU = 'withdrawal_reports';
const MODULE = 'features/withdrawal-reports/server/actions.ts', ARCHIVE_MODULE = 'features/withdrawal-reports/server/archive-actions.ts';

let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [model, prefill, targets, auditMeta, reasonDetail, internalLink, dateKst, subjects] = await Promise.all([
      'features/withdrawal-reports/model.ts', 'features/withdrawal-reports/prefill.ts', 'features/withdrawal-reports/target-courses.ts',
      'features/withdrawal-reports/audit-meta.ts', 'features/withdrawals/reason-detail.ts', 'features/consultations/internal-link.ts',
      'lib/date-kst.ts', 'features/owner/subjects.ts',
    ].map(p => importV2(p)));
    return { ...model, ...prefill, ...targets, ...auditMeta, checkReasonInput: reasonDetail.checkReasonInput,
      visibleConsultationSummary: internalLink.visibleConsultationSummary, kstToday: dateKst.kstToday, subjectLabelRecord: subjects.subjectLabelRecord };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── 보는 사람(2.0 reportViewer) ────────────────────────────────────────────────────────────────────────────────────────
function viewerOf(people, u, R) {
  if (!u) return null;
  const level = people.level(u, MENU);
  if (level === 'none') return null;
  const teacherId = u.role === 'teacher' ? u.id : null; // 2.0 effectiveTeacherId — 강사 역할은 늘 강사뷰
  const writable = level === 'full' || level === 'scoped';
  const manage = !teacherId && R.canRequestReport(u.role);
  return { user: { id: u.id, name: u.display_name, systemRole: u.role }, writable, scope: people.staffScope(u), teacherId, manage, request: manage && writable };
}
const canReadReport = (R, r, viewer) => (viewer.teacherId ? r.teacher_id === viewer.teacherId : viewer.user.systemRole === 'master' || R.isParticipant(r, viewer.user.id));

// PostgREST와 같은 JSON(to_jsonb) — 목록 칸(REPORT_LIST_COLUMNS) = 본문 대신 사유·상세 세 칸.
const LIST_ROW = sql => sql`(to_jsonb(r) - 'body' - 'enrollment_ids' - 'direct') || jsonb_build_object('body_reason', r.body->>'reason', 'body_detail', r.body->>'detail', 'body_reason_detail', r.body->>'reasonDetail')`;
const REPORT_ROW = sql => sql`to_jsonb(r) - 'direct'`;
function viewerFilter(sql, viewer) {
  if (viewer.teacherId) return sql`and r.teacher_id = ${viewer.teacherId}`;
  if (viewer.user.systemRole === 'master') return sql``;
  const id = viewer.user.id;
  return sql`and (r.requested_by = ${id} or r.teacher_id = ${id} or r.manager_id = ${id} or r.director_id = ${id} or r.manager_ids @> array[${id}::uuid] or r.director_ids @> array[${id}::uuid])`;
}

/** listReports — 진행 중 전부 + 완료·취소 최근 200건(장부 정리 바로 처리는 빼고 최대 5쪽까지 채운다). */
async function listReports(sql, t, R, viewer) {
  const rows = (await sql`select ${LIST_ROW(sql)} j from public.withdrawal_reports r where r.tenant_id=${t} ${viewerFilter(sql, viewer)}
      and r.status not in ('completed','canceled') order by r.created_at desc, r.id`).map(x => x.j).filter(r => canReadReport(R, r, viewer));
  const done = (await sql`select ${LIST_ROW(sql)} j from public.withdrawal_reports r where r.tenant_id=${t} ${viewerFilter(sql, viewer)}
      and r.status in ('completed','canceled') order by r.created_at desc, r.id limit 1000`).map(x => x.j);
  const completed = [];
  let completedLimited = false;
  for (let offset = 0; ; offset += 200) {
    const page = done.slice(offset, offset + 200);
    completed.push(...page.filter(r => !R.isBookkeepingReport(r) && canReadReport(R, r, viewer)));
    if (page.length < 200) break;
    if (completed.length >= 200 || offset >= 800) { completedLimited = true; break; }
  }
  rows.push(...completed.slice(0, 200));
  return { rows, available: true, completedLimited: completedLimited || completed.length > 200 };
}

/** reportStaff — 재직 강사·매니저·관리자·원장(표시 역할 = 운영자 계정은 관리자). */
async function reportStaff(sql, t, people) {
  const rows = await sql`select id::text id, display_name, system_role::text role, subjects from public.users
    where tenant_id=${t} and status::text='active' and system_role::text in ('teacher','manager','admin','master') order by display_name`;
  const scopes = people.settings.permissions?.specialAccess?.staffSubjectScopes;
  return rows.map(u => ({ id: u.id, name: u.display_name, role: people.operators.has(u.id) && u.role === 'master' ? 'admin' : u.role, subjects: u.subjects ?? [],
    approvalSubjects: people.P.scope.staffSubjectScopeOf(u.id, scopes) ?? u.subjects ?? [] }));
}

/** 학생의 지금 수강(2.0 currentCourses — 끝났거나 반이동으로 닫힌 수강 제외). */
async function coursesOf(sql, t, R, studentIds, onlyLiveClass) {
  if (!studentIds.length) return new Map();
  const today = R.kstToday();
  const rows = await sql`select e.student_id::text student_id, e.id::text id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
      c.id::text class_id, c.class_name, c.subject, c.is_active, c.closed_at, c.teacher_id::text teacher_id, u.display_name teacher_name
    from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
      left join public.users u on u.id = c.teacher_id and u.tenant_id = ${t}
    where e.tenant_id = ${t} and e.student_id = any(${studentIds}::uuid[]) order by e.id`;
  const out = new Map();
  for (const e of rows) {
    if (e.end_date && (e.end_date < today || e.is_transferred)) continue;
    if (onlyLiveClass && (!e.is_active || e.closed_at)) continue;
    (out.get(e.student_id) ?? out.set(e.student_id, []).get(e.student_id)).push({ id: e.id, classId: e.class_id, className: e.class_name, subject: e.subject,
      teacherId: e.teacher_id, teacherName: e.teacher_name ?? null, startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold });
  }
  return out;
}
/** requestStudents — 재원·휴원 · 퇴원 예약 없음 · 시험 학생 제외 · 과목 범위. */
async function requestStudents(sql, t, R, viewer) {
  if (!viewer.request) return [];
  const students = await sql`select id::text id, name, school, grade from public.students
    where tenant_id=${t} and is_test = false and status::text in ('enrolled','on_hold') and withdrawn_at is null order by id`;
  const courses = await coursesOf(sql, t, R, students.map(s => s.id), true);
  return students.flatMap(s => {
    const list = courses.get(s.id) ?? [];
    return viewer.scope && !list.some(c => viewer.scope.includes(c.subject)) ? [] : [{ id: s.id, name: s.name, school: s.school, grade: s.grade, courses: list }];
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** listArchives — 기존 스프레드시트 기록(원문 사유 두 칸만). */
async function listArchives(sql, t, viewer) {
  if (!viewer.teacherId && !viewer.manage) return [];
  return (await sql`select (to_jsonb(a) - 'fields' - 'signatures' - 'raw_grid' - 'tenant_id' - 'created_at' - 'updated_at' - 'imported_at' - 'mapped_by' - 'mapped_at' - 'mapping_evidence' - 'source_key')
      || jsonb_build_object('reason_raw', a.fields->>'퇴원사유', 'detail_raw', a.fields->>'상세사유') j
    from public.withdrawal_report_archives a where a.tenant_id=${t}
      ${viewer.teacherId ? sql`and a.mapped_teacher_id = ${viewer.teacherId}` : viewer.scope ? sql`and (a.subject is null or a.subject = any(${[...viewer.scope]}))` : sql``}
    order by a.exit_date desc nulls last, a.id`).map(x => x.j);
}
const canReadArchive = (row, viewer) => (!viewer.teacherId && !viewer.manage) ? false
  : viewer.teacherId ? row.mapped_teacher_id === viewer.teacherId : (!viewer.scope || !row.subject || viewer.scope.includes(row.subject));

/** withdrawalDetailHref — 지금 퇴원 상태이고 퇴원관리를 열 수 있을 때만. */
async function withdrawalHref(sql, t, people, u, studentId) {
  if (!studentId || people.level(u, 'withdrawals') === 'none') return null;
  const [s] = await sql`select status::text status from public.students where tenant_id=${t} and id=${studentId}`;
  return s?.status === 'withdrawn' ? `/withdrawals/${studentId}` : null;
}

/** getReport — 보고서 · 처리 이력 · 배정 변경 여부 · 작성 중 미리 채움(출결·수납) · 연결할 상담기록. */
async function getReport(sql, t, R, people, viewer, u, id) {
  const [row] = await sql`select ${REPORT_ROW(sql)} j from public.withdrawal_reports r where r.tenant_id=${t} and r.id=${id}`;
  const report = row?.j;
  if (!report || !canReadReport(R, report, viewer)) return null;
  const live = !['completed', 'canceled'].includes(report.status);
  const [events, current] = await Promise.all([
    sql`select id::text id, actor_id::text actor_id, action, from_status, to_status, comment, to_json(created_at)#>>'{}' created_at
      from public.withdrawal_report_events where tenant_id=${t} and report_id=${id} order by created_at desc, id desc limit 300`,
    live ? currentSnapshot(sql, t, R, report.student_id) : null,
  ]);
  const assignmentChanged = live && (!current || !R.snapshotMatches(report.snapshot, current));
  const draft = ['requested', 'revision'].includes(report.status) && !assignmentChanged;
  const [prefill, consultations] = await Promise.all([draft ? loadPrefill(sql, t, R, people, u, report) : { prefill: undefined, prefillWarning: undefined },
    reportConsultations(sql, t, R, people, u, viewer, report)]);
  return { report, events: [...events].reverse(), assignmentChanged, consultations, ...prefill };
}
async function currentSnapshot(sql, t, R, studentId) {
  const [s] = await sql`select name, school, grade, enrolled_at::text enrolled_at, status::text status, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id=${studentId}`;
  if (!s) return null;
  const courses = (await coursesOf(sql, t, R, [studentId], false)).get(studentId) ?? [];
  return { name: s.name, school: s.school, grade: s.grade, enrolledAt: s.enrolled_at, status: s.status, withdrawnAt: s.withdrawn_at, courses };
}
async function loadBilling(sql, t, R, report) {
  const month = report.effective_date.slice(0, 7);
  const rows = await sql`select period, category::text category, status::text status, amount_total, amount_paid, amount_discount from public.invoices
    where tenant_id=${t} and student_id=${report.student_id} and period <= ${month} order by id`;
  return R.billingPrefill(rows.map(r => ({ period: r.period, category: r.category, status: r.status, amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid), amountDiscount: Number(r.amount_discount) })), month, R.kstToday());
}
async function loadPrefill(sql, t, R, people, u, report) {
  const today = R.kstToday(), until = report.effective_date < today ? report.effective_date : today;
  const courses = R.reportCourses(report), from = courses.map(c => c.startDate).sort()[0] ?? until, classIds = [...new Set(courses.map(c => c.classId))];
  const prefill = {}, warnings = [];
  if (people.level(u, 'attendance') !== 'none' && classIds.length) {
    const rows = await sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status,
        to_json(recorded_at)#>>'{}' recorded_at
      from public.attendance_records where tenant_id=${t} and student_id=${report.student_id} and class_id = any(${classIds}::uuid[])
        and session_date >= ${from}::date and session_date <= ${until}::date order by id`;
    prefill.attendance = R.attendancePrefill(rows, courses, from, until);
  }
  try { Object.assign(prefill, await sql.savepoint(sp => loadBilling(sp, t, R, report))); }
  catch { warnings.push('수납 정보를 자동으로 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'); }
  return { prefill, prefillWarning: warnings.join(' ') };
}
async function reportConsultations(sql, t, R, people, u, viewer, report) {
  if (people.level(u, 'consultations') === 'none') return [];
  const rows = await sql`select id::text id, to_json(consulted_at)#>>'{}' consulted_at, audience::text audience, summary from public.student_consultations
    where tenant_id=${t} and student_id=${report.student_id} ${viewer.teacherId ? sql`and counselor_id = ${viewer.teacherId}` : sql``}
    order by consulted_at desc, id`;
  return rows.map(r => ({ id: r.id, consultedAt: r.consulted_at, audience: r.audience, summary: R.visibleConsultationSummary(r.summary ?? '') }));
}

// ── 화면 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const UUID_BODY = UUID.source.slice(1, -1);
const SUB = new RegExp(`^/withdrawal-reports/(?:archive/(${UUID_BODY})|(${UUID_BODY}))$`, 'i');
async function build({ sql, params, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const u = people.pick(params.actor), viewer = viewerOf(people, u, R), editors = people.editorList;
  if (!viewer) return { notAllowed: true, editors };
  const labels = R.subjectLabelRecord(people.settings.operations.subjects);
  const base = { editors, viewer: { ...viewer, id: u.id, directorLevel: R.cancelsAsDirector(u.role, !!viewer.teacherId) }, labels, operations: people.settings.operations };
  const sub = SUB.exec(params.v2path ?? '');
  if (sub?.[1]) {
    const [row] = await sql`select (to_jsonb(a) - 'tenant_id') j from public.withdrawal_report_archives a where a.tenant_id=${t} and a.id=${sub[1]}`;
    if (!row || !canReadArchive(row.j, viewer)) return { ...base, notFound: true };
    const students = viewer.request ? await sql`select id::text id, name, school, grade, status::text status from public.students where tenant_id=${t} order by name, id` : [];
    return { ...base, archive: row.j, students, withdrawalHref: await withdrawalHref(sql, t, people, u, row.j.mapped_student_id) };
  }
  const staff = await reportStaff(sql, t, people);
  if (sub?.[2]) {
    const record = await getReport(sql, t, R, people, viewer, u, sub[2]);
    if (!record) return { ...base, notFound: true };
    return { ...base, record, staff, withdrawalHref: await withdrawalHref(sql, t, people, u, record.report.student_id) };
  }
  const [list, students, archives] = await Promise.all([listReports(sql, t, R, viewer), requestStudents(sql, t, R, viewer), listArchives(sql, t, viewer)]);
  // 관리자 바로 처리 — 0453a 칸(direct)이 있고, 원생 상태 변경 담당일 때만(2.0 directProcessingReady && canManageStudentStatusNow).
  const [{ ready }] = await sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='withdrawal_reports' and column_name='direct') ready`;
  return { ...base, list, staff, students, archives, shell: viewer.teacherId ? 'teacher' : 'admin', directReady: viewer.request && ready && people.canManageStatus(u) };
}

// ── 저장(2.0 server/actions.ts · archive-actions.ts) ───────────────────────────────────────────────────────────────────
async function writer({ sql, body, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const u = typeof body.actor === 'string' ? people.editors.find(e => e.id === body.actor) : null;
  return { R, people, u, viewer: viewerOf(people, u, R), P: people.P };
}
/** finish — 감사로그(처리 결과 칸 포함). 슬랙 깨우기 · 수학 퇴원 시트 기록은 바깥 전송이라 하지 않는다. */
async function finish(sql, t, R, u, r, action) {
  let endedIds = null;
  if (r.status === 'completed') {
    let subjects = r.subjects, enrollmentIds = r.enrollment_ids;
    if (r.group_id) {
      const [g] = await sql`select subjects, enrollment_ids::text[] enrollment_ids from public.withdrawal_report_groups where tenant_id=${t} and id=${r.group_id}`;
      if (!g) throw new Error('승인된 종료 반을 확인하지 못했습니다.');
      subjects = g.subjects; enrollmentIds = g.enrollment_ids;
    }
    endedIds = r.snapshot.courses.filter(c => (enrollmentIds != null ? enrollmentIds.includes(c.id) : subjects.includes(c.subject))).map(c => c.id);
  }
  await audit(sql, t, u, 'withdrawal_report_update', 'student', r.snapshot.name,
    { reportId: r.id, operation: R.REPORT_ACTION_LABEL[action], date: r.effective_date, ...R.appliedAuditMeta(r, endedIds) });
}
const readBack = async (sql, t, where) => (await sql`select ${REPORT_ROW(sql)} j from public.withdrawal_reports r where r.tenant_id=${t} and ${where}`)[0]?.j ?? null;
const firstIssue = (parsed, fallback) => parsed.error.issues[0]?.message ?? fallback;

const actions = {
  requestWithdrawalReport: {
    validate: raw => serverCall(raw, [MODULE], 1),
    async run(ctx) {
      const { R, P, u, viewer } = await writer(ctx), { sql, tenantId: t } = ctx;
      if (!viewer?.request) return { error: '보고서 작성 요청 권한이 없습니다.' };
      const parsed = R.batchRequestSchema.safeParse(ctx.body.args[0]);
      if (!parsed.success) return { error: firstIssue(parsed, '입력 내용을 확인해 주세요.') };
      if (viewer.scope && parsed.data.subjects.some(s => !viewer.scope.includes(s))) return { error: '담당 과목의 보고서만 요청할 수 있습니다.' };
      const res = await rpcSoft(sql, P, sp => sp`select public.request_withdrawal_report_group(${t}, ${u.id}, ${sp.json(parsed.data)})::text g`, '보고서 작성을 요청하지 못했습니다.');
      if (res.error) return { error: res.error.code === '23505' ? '이 학생의 진행 중인 보고서가 있습니다. 기존 요청을 먼저 확인해 주세요.' : res.message };
      const report = await readBack(sql, t, sql`r.group_id = ${res.data[0].g} and r.group_leader`);
      if (!report) return { error: '요청은 저장됐지만 화면을 불러오지 못했습니다. 목록에서 확인해 주세요.' };
      await finish(sql, t, R, u, report, 'request');
      return { ok: true, id: report.id };
    },
  },
  processWithdrawalDirectly: {
    validate: raw => serverCall(raw, [MODULE], 1),
    async run(ctx) {
      const { R, P, u, viewer, people } = await writer(ctx), { sql, tenantId: t } = ctx;
      if (!viewer?.request) return { error: '퇴원보고서를 바로 처리할 권한이 없습니다.' };
      if (!people.canManageStatus(u)) return { error: '원생 상태 변경을 맡은 사람만 바로 처리할 수 있습니다.' };
      const parsed = R.directSchema.safeParse(ctx.body.args[0]);
      if (!parsed.success) return { error: firstIssue(parsed, '입력 내용을 확인해 주세요.') };
      const reason = R.checkReasonInput({ reason: parsed.data.reason, detail: parsed.data.reasonDetail, memo: parsed.data.memo });
      if (reason.error !== undefined) return { error: reason.error };
      if (viewer.scope && parsed.data.enrollmentIds.length === 0) return { error: '담당 과목의 원생만 처리할 수 있습니다.' };
      const payload = { studentId: parsed.data.studentId, enrollmentIds: parsed.data.enrollmentIds, effectiveDate: parsed.data.effectiveDate,
        reason: parsed.data.reason, reasonDetail: reason.detail ?? '', memo: parsed.data.memo };
      const res = await rpcSoft(sql, P, sp => sp`select public.direct_withdrawal_report(${t}, ${u.id}, ${sp.json(payload)})::text id`, '바로 처리하지 못했습니다.');
      if (res.error) return { error: res.error.code === '23505' ? '이 학생의 진행 중인 보고서가 있습니다. 기존 보고서를 먼저 확인해 주세요.' : res.message };
      const report = await readBack(sql, t, sql`r.id = ${res.data[0].id}`);
      if (!report) return { error: '처리는 저장됐지만 화면을 불러오지 못했습니다. 목록에서 확인해 주세요.' };
      await finish(sql, t, R, u, report, 'direct');
      return { ok: true, id: report.id };
    },
  },
  changeWithdrawalReport: {
    validate: raw => serverCall(raw, [MODULE], 4),
    async run(ctx) {
      const { R, P, u, viewer, people } = await writer(ctx), { sql, tenantId: t } = ctx;
      const [id, action, revision, input] = ctx.body.args;
      if (!viewer?.writable) return { error: '이 화면에서는 보고서를 수정할 수 없습니다.' };
      if (typeof id !== 'string' || !UUID.test(id) || !['save', 'submit', 'approve', 'reject', 'cancel'].includes(action) || !Number.isSafeInteger(revision)) return { error: '요청 내용을 확인해 주세요.' };
      const record = await getReport(sql, t, R, people, viewer, u, id);
      if (!record) return { error: '보고서에 접근할 수 없습니다.' };
      if (action === 'cancel' && record.report.requested_by !== u.id && !R.cancelsAsDirector(u.role, !!viewer.teacherId))
        return { error: '작성 요청을 보낸 사람이나 원장만 취소할 수 있습니다.' };
      const payload = { revision };
      if (action === 'save' || action === 'submit') {
        const parsed = R.bodySchema.safeParse(input);
        if (!parsed.success) return { error: firstIssue(parsed, '보고서 내용을 확인해 주세요.') };
        if (action === 'submit') { const error = R.submissionError(parsed.data); if (error) return { error }; }
        const existing = record.report.body.consultationIds ?? [];
        if (parsed.data.consultationIds?.some(c => !existing.includes(c) && !record.consultations.some(x => x.id === c))) return { error: '연결할 수 없는 상담기록이 포함되어 있습니다.' };
        try { payload.body = { ...parsed.data, ...await sql.savepoint(sp => loadBilling(sp, t, R, record.report)) }; }
        catch { return { error: '수납 정보를 확인하지 못했습니다. 잠시 후 다시 저장해 주세요.' }; }
      }
      if (action === 'reject') {
        if (typeof input !== 'string' || !input.trim() || input.trim().length > 1000) return { error: '반려 사유를 1~1,000자로 작성해 주세요.' };
        payload.comment = input.trim();
      }
      const res = await rpcSoft(sql, P, sp => sp`select to_jsonb(x) - 'direct' j from public.transition_withdrawal_report(${t}, ${u.id}, ${id}, ${action}, ${sp.json(payload)}) x`, '보고서 처리를 완료하지 못했습니다.');
      if (res.error) return { error: res.message };
      await finish(sql, t, R, u, res.data[0].j, action);
      return { ok: true, id };
    },
  },
  mapArchive: {
    validate: raw => serverCall(raw, [ARCHIVE_MODULE], 1),
    async run(ctx) {
      const { P, u, viewer } = await writer(ctx), { sql, tenantId: t } = ctx, input = ctx.body.args[0];
      if (!viewer?.request) return { error: '기존 기록을 연결할 권한이 없습니다.' };
      const ok = input && typeof input === 'object' && typeof input.id === 'string' && UUID.test(input.id)
        && (input.studentId === null || (typeof input.studentId === 'string' && UUID.test(input.studentId))) && Number.isSafeInteger(input.revision) && input.revision > 0;
      if (!ok) return { error: '연결할 학생을 확인해 주세요.' };
      const [archive] = await sql`select id::text id, student_name, subject, mapped_teacher_id::text mapped_teacher_id, mapped_student_id::text mapped_student_id
        from public.withdrawal_report_archives where tenant_id=${t} and id=${input.id}`;
      if (!archive || !canReadArchive(archive, viewer)) return { error: '기록에 접근할 수 없습니다.' };
      const res = await rpcSoft(sql, P, sp => sp`select public.map_withdrawal_report_archive(${t}, ${u.id}, ${input.id}, ${input.studentId}, ${input.revision})`, '학생 연결을 저장하지 못했습니다.');
      if (res.error) return { error: res.message };
      await audit(sql, t, u, 'withdrawal_report_archive_map', 'withdrawal_report_archive', archive.student_name,
        { archiveId: archive.id, studentId: input.studentId, previousStudentId: archive.mapped_student_id, revision: input.revision });
      return { ok: true };
    },
  },
};

export const screen = {
  id: ID, label: '퇴원보고서', order: 40,
  params: {
    actor: UUID, v2path: new RegExp(`^/withdrawal-reports(?:/archive/${UUID_BODY}|/${UUID_BODY})?$`, 'i'),
    status: /^[a-z]{1,12}$/, range: /^[a-z0-9]{1,8}$/, from: /^\d{4}-\d{2}-\d{2}$/, to: /^\d{4}-\d{2}-\d{2}$/,
    subject: /^[a-z0-9_]{1,40}$/, teacher: /^[^\u0000-\u001f]{1,80}$/, link: /^[a-z]{1,10}$/, q: /^[^\u0000-\u001f]{0,100}$/, page: /^\d{1,4}$/, request: UUID,
  },
  actions,
  load: build,
};
export { loadRules };
