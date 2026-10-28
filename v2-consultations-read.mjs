// 2.0 화면 원생상담(v2-screen-consultations.mjs)의 조회 — 2.0 서버 모듈이 하던 일을 Docker 복사본에서 같은 결과로.
//  · features/consultations/server/queries.ts(목록 한 쪽 · 건수 · 상담사 선택지 · 상세 · 학생 선택지) · class-support.ts·list-classes.ts·class-save.ts(반 후보 RPC ·
//    화면 판정) · stats.ts(통계 RPC · 상담 공백 RPC · 퇴사자) · homeroom.ts(담임별 상담 현황) · stats-prefs.ts(보기 설정) ·
//    newcomers/server/consult-link.ts getNewcomerLinkTargets(+ queries.ts loadNewcomers) · students/server/queries.ts getTeacherOptions ·
//    students/server/read-scope.ts canViewStudentDetail · lib/auth/teacher-scope.ts · teacher-read-scope.ts.
//  · 2.0은 이 조회들을 **세션 클라이언트 + RLS**로 한다 — 부르는 쪽(v2-screen-consultations.mjs)이 트랜잭션 안에서 고른 사람의 신분으로 바꾼 뒤 부른다.
//    2.0이 관리 키로 읽는 것(보기 설정 · 담임 변경 감사로그)은 신분을 바꾸기 전에 읽는다(readBeforeIdentity).
//  · 판정·모양은 2.0 순수 함수(importV2) 그대로 — 강사 범위(effectiveTeacherId)는 3.0에 강사뷰 쿠키가 없어 '강사 역할 = 본인' 하나다.
import { deepMerge } from './v2-proc-people.mjs';

let rulesPromise = null;
export function loadConsultRules(importV2) {
  rulesPromise ??= (async () => {
    const [urgency, link, mapping, subjects, kst, model, flow, duty, sortH, stats, kpi, scopeT, labels, listHref, onboarding, rows, consultLink,
      subject, paste, modules, week, delegation, asOf, dbError, pageSize] = await Promise.all([
      'features/consultations/follow-up-urgency.ts', 'features/consultations/internal-link.ts', 'features/consultations/class-mapping.ts',
      'features/owner/subjects.ts', 'lib/date-kst.ts', 'features/consultations/homeroom-model.ts', 'features/consultations/homeroom-flow.ts',
      'features/consultations/homeroom-duty.ts', 'features/consultations/homeroom-sort.ts', 'features/consultations/stats-model.ts',
      'features/consultations/stats-kpi.ts', 'features/consultations/stats-scope.ts', 'features/consultations/labels.ts', 'features/consultations/list-href.ts',
      'features/newcomers/onboarding-items.ts', 'features/newcomers/subject-rows.ts', 'features/newcomers/consult-link.ts',
      'features/consultations/subject.ts', 'features/consultations/paste-cleanup.ts', 'lib/modules.ts', 'features/timetable/lib/week.ts',
      'features/classes/delegation-window.ts', 'features/classes/teacher-as-of.ts', 'lib/supabase/db-error.ts', 'components/page-size.ts',
    ].map(p => importV2(p)));
    return { urgency, link, mapping, subjects, kst, model, flow, duty, sortH, stats, kpi, scopeT, labels, listHref, onboarding, rows, consultLink,
      subject, paste, modules, week, delegation, asOf, dbError, pageSize };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ymd = v => { if (!v) return null; const s = String(v); return s.length >= 10 ? s.slice(0, 10) : null; };
const isoDaysAgo = days => new Date(Date.now() - days * 86_400_000).toISOString();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOBODY = '00000000-0000-0000-0000-000000000000';

/** 학원 설정 전체(2.0 getTenantSettings의 resolveSettings) — readPeople이 읽은 저장 원문 + 기본값. */
export function resolvedSettings(people) {
  const { stored, base } = people.settings;
  return deepMerge(base, stored ?? {});
}

/** 2.0 신분 — 이 트랜잭션 안에서 고른 사람으로 RLS를 지난다(읽기 트랜잭션 전용 — 저장은 asUser). */
export async function actAsReader(sql, u) {
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: u.id, role: 'authenticated' })}, true)`;
  await sql`set local role authenticated`;
}

/** 3.0 사람 판정 — 2.0 effectiveTeacherId(강사 역할 = 본인 · 그 밖 = 학원 전체) · scopedConsultationUserId(원생상담 '담당 범위'). */
export const teacherIdOf = u => (u.role === 'teacher' ? u.id : null);
export const scopedIdOf = (people, u) => (people.level(u, 'consultations') === 'scoped' ? u.id : null);

// ── 강사 범위(lib/auth/teacher-scope.ts · teacher-read-scope.ts) ─────────────────────────────────────────────────────
/** getTeacherScope — 담임 반 + 그 반의 열린 수강 학생(상담 공백·담당 기준). */
export async function teacherScope(sql, teacherId) {
  const classes = await sql`select id::text id, subject from public.classes where teacher_id=${teacherId}`;
  const classIds = classes.map(c => c.id), subjects = [...new Set(classes.map(c => c.subject).filter(Boolean))];
  if (!classIds.length) return { classIds: [], studentIds: [], subjects };
  const rows = await sql`select distinct student_id::text student_id from public.enrollments where end_date is null and class_id = any(${classIds}::uuid[])`;
  return { classIds, studentIds: rows.map(r => r.student_id), subjects };
}
async function delegatedClassIds(sql, R, userId, from, to) {
  const rows = await sql`select class_id::text class_id, from_date::text from_date, to_date::text to_date, to_json(revoked_at)#>>'{}' revoked_at
    from public.class_delegations where delegate_user_id=${userId} and revoked_at is null and from_date <= ${to}::date and to_date >= ${from}::date limit 200`;
  return [...new Set(rows.filter(r => R.delegation.delegationOverlapsRange({ fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }, from, to)).map(r => r.class_id))];
}
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/** teacher-read-scope.ts liveTeachingClassIds(그 파일은 server-only라 불러올 수 없어 본문 그대로 — verify가 글자를 대조한다). */
export function liveTeachingClassIds(R, slots, monday) {
  return [...new Set(slots.filter((slot) => {
    const day = DAYS.indexOf(slot.day_of_week);
    if (day < 0) return false;
    const date = R.week.shiftDays(monday, day);
    return (!slot.valid_from || slot.valid_from <= date) && (!slot.valid_to || slot.valid_to >= date);
  }).map((slot) => slot.class_id))];
}
/** getTeacherReadScope — 이번 주 가르치는 반(담임·교시 담당·위임) + 오늘 다니는 학생(학생 선택지). */
export async function teacherReadScope(sql, R, teacherId) {
  const today = R.kst.kstToday(), monday = R.week.mondayOf(today);
  const [own, slots, delegated] = await Promise.all([
    sql`select id::text id from public.classes where teacher_id=${teacherId}`,
    sql`select class_id::text class_id, day_of_week::text day_of_week, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules where teacher_id=${teacherId}`,
    delegatedClassIds(sql, R, teacherId, monday, R.week.shiftDays(monday, 6)),
  ]);
  const ids = [...new Set([...own.map(c => c.id), ...liveTeachingClassIds(R, slots, monday), ...delegated])];
  if (!ids.length) return { classIds: [], studentIds: [], subjects: [] };
  const [classes, enr] = await Promise.all([
    sql`select id::text id, subject from public.classes where id = any(${ids}::uuid[])`,
    sql`select distinct student_id::text student_id from public.enrollments where class_id = any(${ids}::uuid[]) and start_date <= ${today}::date and (end_date is null or end_date >= ${today}::date)`,
  ]);
  return { classIds: classes.map(c => c.id), studentIds: enr.map(e => e.student_id), subjects: [...new Set(classes.map(c => c.subject).filter(Boolean))] };
}
/** canViewStudentDetail(= write-scope canConsultStudent) — 원생 '담당 범위'(강사)면 담당 반(담임·교시·위임 ±7일)에 열렸거나 60일 안에 끝난 수강이 있어야. */
export async function canConsultStudent(sql, R, people, u, studentId) {
  if (people.level(u, 'students') !== 'scoped') return true;
  const today = R.kst.kstToday();
  const [own, slots, delegated] = await Promise.all([
    sql`select id::text id from public.classes where teacher_id=${u.id}`,
    sql`select class_id::text class_id from public.class_schedules where teacher_id=${u.id}`,
    delegatedClassIds(sql, R, u.id, R.kst.addDays(today, -7), R.kst.addDays(today, 7)).catch(() => []),
  ]);
  const ids = [...new Set([...own.map(r => r.id), ...slots.map(r => r.class_id), ...delegated])];
  if (!ids.length) return false;
  const floor = R.kst.addDays(today, -60);
  const [{ n }] = await sql`select count(*)::int n from public.enrollments where student_id=${studentId} and class_id = any(${ids}::uuid[]) and (end_date is null or end_date >= ${floor}::date)`;
  return n > 0;
}

// ── 목록 · 상세(queries.ts) ────────────────────────────────────────────────────────────────────────────────────────────
const ROW_COLUMNS = sql => sql`c.id::text id, to_json(c.consulted_at)#>>'{}' consulted_at, c.summary, c.follow_up_action, c.follow_up_date::text follow_up_date,
  c.follow_up_done, c.category, c.subject, c.audience, c.counselor_id::text counselor_id, c.processing_status::text processing_status, c.audio_path, c.ai_summary,
  to_json(c.sync_added_at)#>>'{}' sync_added_at, s.id::text s_id, s.name s_name, s.grade s_grade, u.display_name u_name,
  c.class_id::text class_id, c.class_source::text class_source, k.class_name k_name`;
const ROW_FROM = sql => sql`from public.student_consultations c left join public.students s on s.id = c.student_id
  left join public.users u on u.id = c.counselor_id left join public.classes k on k.id = c.class_id`;

function mapRow(R, r) {
  const source = r.class_source === 'auto' || r.class_source === 'manual' ? r.class_source : null;
  return {
    id: r.id, studentId: r.s_id ?? '', studentName: r.s_name ?? '?', studentGrade: r.s_grade ?? null, counselorName: r.u_name ?? null,
    consultedAt: r.consulted_at, category: r.category, subject: r.subject, audience: r.audience,
    summary: R.link.visibleConsultationSummary(r.summary), followUpAction: r.follow_up_action, followUpDate: r.follow_up_date, followUpDone: r.follow_up_done,
    processingStatus: r.processing_status ?? 'idle', hasAudio: !!r.audio_path, hasAi: !!r.ai_summary, syncAddedAt: r.sync_added_at ?? null,
    counselorId: r.counselor_id ?? null, classId: r.class_id ?? null, className: r.class_id ? (r.k_name ?? null) : null, classSource: source, classAuto: false,
  };
}

/** loadClassCandidatesRpc — (학생, 상담일) 쌍마다 그날의 반 후보(0318a RPC). 120쌍씩 · 응답이 1,000행에 닿으면 반으로 쪼개 다시. */
export async function loadClassCandidates(sql, R, pairs) {
  const uniq = [...new Map(pairs.filter(p => p.studentId && /^\d{4}-\d{2}-\d{2}$/.test(p.date)).map(p => [R.mapping.candidateKey(p.studentId, p.date), p])).values()];
  const out = new Map();
  if (!uniq.length) return out;
  const fetchChunk = async chunk => {
    const rows = await sql`select student_id::text student_id, on_date::text on_date, class_id::text class_id, class_name, subject, teacher_ids::text[] teacher_ids
      from public.consultation_class_candidates(${chunk.map(p => p.studentId)}::uuid[], ${chunk.map(p => p.date)}::date[])`;
    if (rows.length < 1000 || chunk.length === 1) return rows;
    const mid = Math.ceil(chunk.length / 2);
    const [left, right] = await Promise.all([fetchChunk(chunk.slice(0, mid)), fetchChunk(chunk.slice(mid))]);
    return [...left, ...right];
  };
  const chunks = [];
  for (let i = 0; i < uniq.length; i += 120) chunks.push(uniq.slice(i, i + 120));
  for (const r of (await Promise.all(chunks.map(fetchChunk))).flat()) {
    const key = R.mapping.candidateKey(r.student_id, String(r.on_date).slice(0, 10));
    (out.get(key) ?? out.set(key, []).get(key)).push({ classId: r.class_id, className: r.class_name, subject: r.subject, teacherIds: r.teacher_ids ?? [] });
  }
  return out;
}
/** annotateAutoClasses — 아직 판정 안 한 옛 행(class_source 비어 있음)은 화면에서만 판정해 보여 준다(저장 안 함). 실패하면 그대로. */
export async function annotateAutoClasses(sql, R, settings, rows) {
  const todo = rows.filter(r => r.classSource === null && r.studentId);
  if (!todo.length) return rows;
  const pairs = todo.map(r => ({ studentId: r.studentId, date: R.kst.kstDateOf(r.consultedAt) ?? '' })).filter(p => p.date);
  let candidates;
  try { candidates = await sql.savepoint(sp => loadClassCandidates(sp, R, pairs)); } catch { return rows; }
  const labels = R.subjects.subjectLabelRecord(settings.operations.subjects);
  return rows.map(r => {
    if (r.classSource !== null) return r;
    const date = R.kst.kstDateOf(r.consultedAt);
    const list = date ? (candidates.get(R.mapping.candidateKey(r.studentId, date)) ?? []) : [];
    const judged = R.mapping.resolveConsultationClass({ counselorId: r.counselorId, subject: r.subject, labels, candidates: list });
    const picked = judged.classId ? list.find(c => c.classId === judged.classId) : undefined;
    return { ...r, classId: judged.classId, className: picked?.className ?? null, classAuto: true };
  });
}

/** consultationSubjectValues — 과목 필터의 저장값 후보(키·라벨). */
export const subjectValues = f => (!f.subject || f.subject === 'all' ? null : [...new Set([f.subject, f.subjectLabel].filter(Boolean))]);
/** filteredConsultations — 목록·통계가 같은 조건(강사 범위 · 기간 · 카테고리 · 상담사 · 과목 · 후속 긴급도). */
function filterSql(sql, R, f, teacherId) {
  const today = R.kst.kstToday(), in3 = R.urgency.addIsoDateDays(today, 3), wanted = subjectValues(f);
  const parts = [sql`true`];
  if (teacherId) parts.push(sql`c.counselor_id = ${teacherId}`);
  if (f.range === '7d') parts.push(sql`c.consulted_at >= ${isoDaysAgo(7)}`);
  else if (f.range === '30d') parts.push(sql`c.consulted_at >= ${isoDaysAgo(30)}`);
  if (f.cat && f.cat !== 'all') parts.push(sql`c.category = ${f.cat}`);
  // 상담사 — PostgREST는 uuid가 아닌 값이면 조회 오류(→ 목록 0건). 같은 0건으로.
  if (f.counselor && f.counselor !== 'all') parts.push(UUID_RE.test(f.counselor) ? sql`c.counselor_id = ${f.counselor}` : sql`false`);
  if (wanted) parts.push(sql`c.subject = any(${wanted})`);
  switch (f.urg) {
    case 'done': parts.push(sql`c.follow_up_done = true`); break;
    case 'overdue': parts.push(sql`c.follow_up_done = false and c.follow_up_date is not null and c.follow_up_date < ${today}::date`); break;
    case 'today': parts.push(sql`c.follow_up_done = false and c.follow_up_date = ${today}::date`); break;
    case 'soon': parts.push(sql`c.follow_up_done = false and c.follow_up_date > ${today}::date and c.follow_up_date <= ${in3}::date`); break;
    case 'later': parts.push(sql`c.follow_up_done = false and c.follow_up_date > ${in3}::date`); break;
    default: break;
  }
  return parts.reduce((a, b) => sql`${a} and ${b}`);
}

/** getStudentConsultationsPage — 필터 + 검색(요약 OR 학생명) + 서버 쪽 나누기. */
export async function consultationsPage(sql, R, settings, f, teacherId, page, size) {
  const term = f.q?.trim();
  let search = sql`true`;
  if (term) {
    const ids = (await sql`select id::text id from public.students where name ilike ${`%${term}%`}`).map(s => s.id);
    const safe = term.replace(/[(),]/g, ' ');
    search = ids.length ? sql`(c.summary ilike ${`%${safe}%`} or c.student_id = any(${ids}::uuid[]))` : sql`c.summary ilike ${`%${safe}%`}`;
  }
  const where = sql`${filterSql(sql, R, f, teacherId)} and ${search}`;
  const from = (page - 1) * size;
  const [rows, [{ n }]] = await Promise.all([
    sql`select ${ROW_COLUMNS(sql)} ${ROW_FROM(sql)} where ${where} order by c.consulted_at desc limit ${size} offset ${from}`,
    sql`select count(*)::int n from public.student_consultations c where ${where}`,
  ]);
  const mapped = rows.map(r => mapRow(R, r));
  return { rows: await annotateAutoClasses(sql, R, settings, mapped), total: n, classSupported: true };
}
/** getStudentConsultationCounts — 학원 전체 지표 넷(강사는 본인 상담만). */
export async function consultationCounts(sql, R, teacherId) {
  const today = R.kst.kstToday(), mine = teacherId ? sql`counselor_id = ${teacherId}` : sql`true`;
  const [r] = await sql`select count(*)::int total, count(*) filter (where consulted_at >= ${isoDaysAgo(7)})::int last_week,
    count(*) filter (where follow_up_done = false and follow_up_date is not null)::int pending,
    count(*) filter (where follow_up_done = false and follow_up_date is not null and follow_up_date < ${today}::date)::int overdue
    from public.student_consultations where ${mine}`;
  return { total: r.total, lastWeek: r.last_week, pendingFollowUps: r.pending, overdueFollowUps: r.overdue };
}
/** getConsultationCounselorOptions — 실제 상담 기록이 있는 사람만(이름 없는 계정 제외 · 퇴사 표시). 강사는 선택지 없음. */
export async function counselorOptions(sql, teacherId) {
  if (teacherId) return [];
  const users = await sql`select u.id::text id, u.display_name, u.status::text status from public.users u
    where u.id in (select distinct counselor_id from public.student_consultations where counselor_id is not null)`;
  return users.filter(u => !!u.display_name?.trim()).map(u => ({ id: u.id, name: u.display_name.trim(), retired: u.status === 'inactive' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
/** getStudentConsultationById — 강사는 본인이 등록한 상담만. 옛 행은 목록과 같은 판정을 표시만. */
export async function consultationById(sql, R, settings, id, teacherId) {
  const mine = teacherId ? sql`and c.counselor_id = ${teacherId}` : sql``;
  const [r] = await sql`select ${ROW_COLUMNS(sql)}, c.transcription, c.audio_duration_sec, c.processing_error, c.ai_report, c.ai_model_version,
    to_json(c.ai_generated_at)#>>'{}' ai_generated_at ${ROW_FROM(sql)} where c.id = ${id} ${mine}`;
  if (!r) return null;
  const row = mapRow(R, r);
  const [shown] = row.classSource === null ? await annotateAutoClasses(sql, R, settings, [row]) : [row];
  return { ...shown, classSupported: true, transcription: r.transcription ?? null, audioDurationSec: r.audio_duration_sec ?? null, processingError: r.processing_error ?? null,
    aiReport: r.ai_report ?? null, aiSummary: r.ai_summary ?? null, aiModelVersion: r.ai_model_version ?? null, aiGeneratedAt: r.ai_generated_at ?? null };
}
/** getStudentOptionsForConsultation — 강사는 담당 학생(이번 주 가르치는 반)만 · 퇴원 제외 · 학년 → 이름(2.0 비교 그대로). */
export async function studentOptions(sql, R, teacherId) {
  const ids = teacherId ? (await teacherReadScope(sql, R, teacherId)).studentIds : null;
  if (ids && !ids.length) return [];
  const rows = ids
    ? await sql`select id::text id, name, grade from public.students where status::text <> 'withdrawn' and id = any(${ids}::uuid[])`
    : await sql`select id::text id, name, grade from public.students where status::text <> 'withdrawn'`;
  return rows.map(r => ({ id: r.id, name: r.name, grade: r.grade })).sort((a, b) => {
    if (a.grade !== b.grade) { if (a.grade == null) return 1; if (b.grade == null) return -1; return a.grade < b.grade ? -1 : 1; }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
/** students getTeacherOptions — 상담사 선택지(재직 · 강사·상담·매니저·관리자·원장). */
export async function teacherOptions(sql) {
  const rows = await sql`select id::text id, display_name, system_role::text system_role, subjects from public.users
    where system_role::text in ('teacher', 'counselor', 'manager', 'admin', 'master') and status::text = 'active' order by display_name asc`;
  return rows.map(r => ({ id: r.id, displayName: r.display_name, systemRole: r.system_role, subjects: Array.isArray(r.subjects) ? r.subjects : [] }));
}

// ── 반 선택지(class-save.ts classOptionsFor · class-actions.ts getConsultationClassOptions) ─────────────────────────────
export async function classOptionsFor(sql, R, settings, input) {
  if (!input.studentId || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { supported: true, options: [], auto: { classId: null, reason: 'no_enrollment', reasonLabel: R.mapping.CLASS_REASON_LABEL.no_enrollment } };
  }
  const candidates = await loadClassCandidates(sql, R, [{ studentId: input.studentId, date: input.date }]);
  const list = candidates.get(R.mapping.candidateKey(input.studentId, input.date)) ?? [];
  const subjects = R.subjects.buildSubjectMaps(settings.operations.subjects);
  const judged = R.mapping.resolveConsultationClass({ counselorId: input.counselorId, subject: input.subject, labels: R.subjects.subjectLabelRecord(settings.operations.subjects), candidates: list });
  const seen = new Set(), options = [];
  for (const c of list) {
    if (seen.has(c.classId)) continue;
    seen.add(c.classId);
    const subjectLabel = c.subject ? subjects.labelOf(c.subject) : null, name = c.className ?? '이름 없는 반';
    options.push({ id: c.classId, name, label: subjectLabel ? `${name} (${subjectLabel})` : name });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return { supported: true, options, auto: { ...judged, reasonLabel: R.mapping.CLASS_REASON_LABEL[judged.reason] } };
}
/** getConsultationClassOptions — 원생상담을 볼 수 있는 사람 + 강사는 담당 학생만. 실패는 2.0 문구. */
export async function classOptionsRead(sql, R, people, settings, u, input) {
  if (!u) return { error: '로그인이 필요합니다' };
  if (people.level(u, 'consultations') === 'none') return { error: '원생상담 권한이 없습니다' };
  const studentId = String(input.studentId ?? '').trim();
  if (!studentId) return { supported: true, options: [], auto: { classId: null, reason: 'no_enrollment', reasonLabel: '' } };
  if (scopedIdOf(people, u) && !(await canConsultStudent(sql, R, people, u, studentId))) return { error: '담당 학생의 반만 볼 수 있습니다' };
  const date = R.kst.kstDateOf(R.kst.kstLocalToIso(String(input.consultedAt ?? ''))) ?? '';
  const counselorId = String(input.counselorId ?? '').trim() || u.id, subject = String(input.subject ?? '').trim() || null;
  try { return await sql.savepoint(sp => classOptionsFor(sp, R, settings, { studentId, date, counselorId, subject })); }
  catch { return { error: '반 목록을 불러오지 못했습니다' }; }
}

// ── 통계(stats.ts) ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** getConsultationStats — 0318a consultation_stats RPC(목록과 같은 조건 · 강사가 남의 id를 주면 0건). */
export async function consultationStats(sql, R, f, teacherId) {
  const today = R.kst.kstToday();
  const wanted = f.counselor && f.counselor !== 'all' ? f.counselor : null;
  const wantedId = wanted === null ? null : UUID_RE.test(wanted) ? wanted : NOBODY;
  const counselor = teacherId ? (wantedId && wantedId !== teacherId ? NOBODY : teacherId) : wantedId;
  const since = f.range === '7d' ? isoDaysAgo(7) : f.range === '30d' ? isoDaysAgo(30) : null;
  const [{ j }] = await sql`select public.consultation_stats(${since}::timestamptz, ${f.cat && f.cat !== 'all' ? f.cat : null}::text,
    ${f.urg && f.urg !== 'all' ? f.urg : null}::text, ${counselor}::uuid, ${subjectValues(f)}::text[], ${today}::date, 40) j`;
  return { full: true, today, ...j };
}
/** getConsultationGap — 담임 반 학생(강사) · 재원생 전체(사무실). 필터와 무관. */
export async function consultationGap(sql, R, teacherId) {
  const today = R.kst.kstToday();
  const scope = teacherId ? await teacherScope(sql, teacherId) : null;
  if (scope && !scope.studentIds.length) return { full: true, today, enrolled: 0, never: 0, d30: 0, d60: 0, d90: 0, top: [] };
  const [{ j }] = await sql`select public.consultation_gap_students(${scope ? scope.studentIds : null}::uuid[], ${today}::date, 10) j`;
  return { full: true, today, ...j };
}
export async function retiredStaffIds(sql) {
  return new Set((await sql`select id::text id from public.users where status::text = 'inactive'`).map(r => r.id));
}

// ── 담임별 상담 현황(homeroom.ts) ──────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getHomeroomHistoryIndex — 인계·담임 변경 감사로그(관리 키로 읽는다 · 신분 바꾸기 전) · 반 이름은 유일할 때만. 실패 = 빈 이력. */
export async function homeroomHistory(sql, R, t) {
  let logs = [], classRows = [];
  try {
    [logs, classRows] = await sql.savepoint(sp => Promise.all([
      sp`select metadata, target_label, to_json(created_at)#>>'{}' created_at from public.audit_logs
        where tenant_id=${t} and action in ('class_handover_apply', 'class_update') and metadata->>'newTeacherId' is not null order by created_at, id`,
      sp`select id::text id, class_name from public.classes where tenant_id=${t} order by id`]));
  } catch { /* 2.0도 실패하면 빈 이력으로 접는다 */ }
  const classIdByUniqueName = R.asOf.buildUniqueClassNameIndex(classRows.map(c => ({ id: c.id, name: c.class_name })));
  const transitions = logs.map(l => ({
    classId: R.asOf.resolveTransitionClassId({ metaClassId: l.metadata?.classId ?? null, targetLabel: l.target_label, classIdByUniqueName }) ?? '',
    date: R.kst.kstDateOf(l.metadata?.effectiveDate) ?? R.kst.kstDateOf(l.created_at) ?? '',
    teacherId: l.metadata?.newTeacherId ?? null,
    previousTeacherId: typeof l.metadata?.previousTeacherId === 'string' ? l.metadata.previousTeacherId : null,
    teacherName: null,
  })).filter(x => !!x.classId && !!x.teacherId && !!x.date);
  return R.asOf.buildHomeroomHistoryIndex(transitions);
}
export async function homeroomStats(sql, R, settings, teacherId, history) {
  const M = R.model, today = R.kst.kstToday(), months = M.homeroomMonths(today);
  const sinceIso = `${months[0]}-01T00:00:00+09:00`, prevMonth = M.recentMonths(today, 2)[0], prevFirst = `${prevMonth}-01`;
  const allClasses = await sql`select id::text id, class_name, subject, teacher_id::text teacher_id, is_special, math_learning_track, to_json(closed_at)#>>'{}' closed_at,
    english_track, report_optout, is_makeup_pool from public.classes where is_active = true`;
  const eligible = allClasses.filter(c => (!c.closed_at || c.closed_at.slice(0, 10) >= prevFirst)
    && M.isHomeroomConsultClass({ isSpecial: c.is_special, className: c.class_name, learningTrack: c.math_learning_track }));
  const rosterClasses = eligible.filter(c => !!c.teacher_id && (!c.closed_at || c.closed_at.slice(0, 10) >= today) && (!teacherId || c.teacher_id === teacherId));
  const eligibleIds = eligible.map(c => c.id);
  const [enrollRows, schedules] = eligibleIds.length ? await Promise.all([
    sql`select id::text id, student_id::text student_id, class_id::text class_id, start_date::text start_date, end_date::text end_date, on_hold,
      is_transferred, is_transferred_in, attendance_days from public.enrollments where class_id = any(${eligibleIds}::uuid[]) and (end_date is null or end_date >= ${prevFirst}::date) order by id`,
    sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, teacher_id::text teacher_id,
      slot_teacher_label, lab_separate, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
      where class_id = any(${eligibleIds}::uuid[]) and valid_from <= ${today}::date and (valid_to is null or valid_to >= ${prevFirst}::date) order by id`,
  ]) : [[], []];
  const isLive = e => !e.on_hold && (!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date > today || (e.end_date === today && !e.is_transferred));
  const rosterIds = new Set(rosterClasses.map(c => c.id));
  const live = enrollRows.filter(e => rosterIds.has(e.class_id) && isLive(e));
  const allHomerooms = new Set(settings.operations.subjects.filter(R.subjects.counselByClassTeacher).map(s => s.key));
  const isDuty = R.duty.buildCounselDuty({
    classes: eligible.map(c => ({ ...c, subject: c.subject ?? '', is_active: true })),
    schedules,
    enrollments: enrollRows.map(e => ({ ...e, start_date: e.start_date ?? '0000-01-01', on_hold: !!e.on_hold, is_transferred: !!e.is_transferred, is_transferred_in: !!e.is_transferred_in })),
    owner: (c, day) => (day >= today ? c.teacher_id : R.asOf.homeroomTeacherOnDate(history.get(c.id), c.teacher_id, day)),
    allHomerooms: subject => allHomerooms.has(subject),
    teacherIds: [...eligible.flatMap(c => (c.teacher_id ? [c.teacher_id] : [])), ...[...history.values()].flat().map(p => p.teacherId)],
    from: prevFirst, end: today,
  });
  const classTeacher = new Map(rosterClasses.map(c => [c.id, c.teacher_id]));
  const dutyLive = live.filter(e => isDuty(classTeacher.get(e.class_id), e.student_id, e.class_id, today));
  const studentIds = [...new Set(dutyLive.map(e => e.student_id))];
  const teacherIds = [...new Set(eligible.map(c => c.teacher_id).filter(Boolean))];
  const allStudentIds = [...new Set(enrollRows.map(e => e.student_id))];
  const [users, students, consults] = await Promise.all([
    teacherIds.length ? sql`select id::text id, display_name, status::text status from public.users where id = any(${teacherIds}::uuid[])` : [],
    allStudentIds.length ? sql`select id::text id, name, grade, status::text status, is_test, to_json(withdrawn_at)#>>'{}' withdrawn_at from public.students where id = any(${allStudentIds}::uuid[])` : [],
    studentIds.length ? sql`select id::text id, student_id::text student_id, counselor_id::text counselor_id, to_json(consulted_at)#>>'{}' consulted_at
      from public.student_consultations where student_id = any(${studentIds}::uuid[]) and consulted_at >= ${sinceIso}::timestamptz order by id` : [],
  ]);
  const known = new Set(users.map(u => u.id));
  const extraIds = [...new Set(consults.map(c => c.counselor_id).filter(id => !!id && !known.has(id)))];
  const counselors = extraIds.length ? await sql`select id::text id, display_name from public.users where id = any(${extraIds}::uuid[])` : [];
  const active = new Set(users.filter(u => u.status === 'active').map(u => u.id));
  const enrolled = new Map(students.filter(s => s.status === 'enrolled' && !s.is_test).map(s => [s.id, { name: s.name, grade: s.grade }]));
  const retiredClasses = rosterClasses.filter(c => !active.has(c.teacher_id)), retiredIds = new Set(retiredClasses.map(c => c.id));
  const retired = { teachers: new Set(retiredClasses.map(c => c.teacher_id)).size, classes: retiredClasses.length,
    students: new Set(live.filter(e => retiredIds.has(e.class_id) && enrolled.has(e.student_id)).map(e => e.student_id)).size };
  const flow = R.flow.buildPrevMonthFlow({
    prevMonth,
    classes: new Map(eligible.map(c => [c.id, { teacherId: c.teacher_id, subject: c.subject }])),
    homeroomHistory: history, isDuty,
    enrollments: enrollRows.map(e => ({ studentId: e.student_id, classId: e.class_id, startDate: e.start_date, endDate: e.end_date, isTransferred: !!e.is_transferred, live: isLive(e) })),
    students: new Map(students.filter(s => !s.is_test).map(s => [s.id, { name: s.name, withdrawn: s.status === 'withdrawn', withdrawnAt: s.withdrawn_at ? String(s.withdrawn_at).slice(0, 10) : null }])),
  });
  const teachers = M.buildHomeroomTeachers({
    today, months,
    classes: rosterClasses.filter(c => active.has(c.teacher_id)).map(c => ({ id: c.id, name: c.class_name, subject: c.subject, teacherId: c.teacher_id })),
    staffNames: new Map([...users, ...counselors].map(u => [u.id, u.display_name?.trim() || '이름 없는 직원'])),
    enrollments: dutyLive.map(e => ({ studentId: e.student_id, classId: e.class_id, startDate: e.start_date })),
    students: enrolled,
    consults: consults.flatMap(c => { const date = R.kst.kstDateOf(c.consulted_at); return date ? [{ studentId: c.student_id, counselorId: c.counselor_id, date }] : []; }),
  }).map(t => ({ ...t, prev: flow.get(t.id) ?? M.EMPTY_PREV_FLOW }));
  const shown = new Set(teachers.map(t => t.id)), nameOf = new Map(users.map(u => [u.id, u.display_name?.trim() || '이름 없는 직원']));
  for (const [id, prev] of flow) {
    if (shown.has(id) || !active.has(id) || (teacherId && id !== teacherId)) continue;
    if (prev.withdrawn.length === 0) continue;
    teachers.push({ id, name: nameOf.get(id) ?? '이름 없는 직원', subjects: [], classNames: [], students: [], months: months.map(() => ({ target: 0, self: 0, other: 0, none: 0 })), prev });
  }
  return { today, months, prevMonth, teachers, retired };
}

/** loadConsultationStatsPrefs — 본인 ui_prefs.consultations(관리 키 · 신분 바꾸기 전). */
export async function statsPrefs(sql, R, t, userId) {
  const [row] = await sql`select ui_prefs from public.users where id=${userId} and tenant_id=${t}`;
  const prefs = row?.ui_prefs && typeof row.ui_prefs === 'object' ? row.ui_prefs.consultations : undefined;
  return R.stats.parseConsultationStatsPrefs(prefs);
}

// ── 신규생 관리 칸(newcomers consult-link getNewcomerLinkTargets + queries loadNewcomers) ───────────────────────────────
export async function newcomerLinkTargets(sql, R, settings, consultationId) {
  if (!R.modules.isModuleEnabled(settings.modules?.disabled, 'newcomers')) return [];
  const today = R.kst.kstToday(), since = R.onboarding.newcomerWindowStart(today);
  const students = await sql`select id::text id, name, school, grade, enrolled_at::text enrolled_at from public.students
    where status::text in ('enrolled', 'on_hold') and enrolled_at >= ${since}::date order by enrolled_at desc, id`;
  const ids = students.map(s => s.id);
  if (!ids.length) return [];
  let checks;
  try {
    checks = await sql.savepoint(sp => sp`select student_id::text student_id, item_key, done_on::text done_on, subject from public.student_onboarding_checks where student_id = any(${ids}::uuid[]) order by id`);
  } catch { return []; } // 체크를 못 읽으면 2.0처럼 칸을 안 띄운다
  const [enr, classes] = await Promise.all([
    sql`select student_id::text student_id, start_date::text start_date, end_date::text end_date, class_id::text class_id from public.enrollments where student_id = any(${ids}::uuid[])`,
    sql`select id::text id, subject from public.classes order by id`,
  ]);
  const subjectOf = new Map(classes.map(c => [c.id, c.subject]));
  const enrollments = enr.map(e => ({ studentId: e.student_id, startDate: e.start_date, endDate: e.end_date, subject: e.class_id ? (subjectOf.get(e.class_id) ?? null) : null }));
  const { bySubject, earliest } = R.rows.buildSubjectAnchors(enrollments, today);
  const checkIndex = R.rows.indexChecks(checks.map(r => ({ studentId: r.student_id, itemKey: r.item_key, doneOn: r.done_on, subject: r.subject })));
  const linked = new Map();
  if (consultationId) {
    const rows = await sql`select student_id::text student_id, subject, item_key, done_on::text done_on from public.student_onboarding_checks where consultation_id=${consultationId}`;
    for (const r of rows) { if (!r.done_on) continue; const k = `${r.student_id}|${r.subject ?? ''}`; linked.set(k, [...(linked.get(k) ?? []), r.item_key]); }
  }
  const byStudent = new Map();
  for (const s of students) {
    const enrolledOn = ymd(s.enrolled_at);
    if (!enrolledOn) continue;
    const subjMap = bySubject.get(s.id), subjects = subjMap ? [...subjMap.keys()].sort() : [];
    for (const subject of (subjects.length ? subjects : [null])) {
      const firstClassOn = subject ? (subjMap?.get(subject) ?? null) : (earliest.get(s.id) ?? null);
      let tgt = byStudent.get(s.id);
      if (!tgt) byStudent.set(s.id, (tgt = { studentId: s.id, rows: [] }));
      const own = linked.get(`${s.id}|${subject ?? ''}`) ?? [];
      tgt.rows.push({ subject, enrolledOn, firstClassOn, checks: R.rows.effectiveChecks(checkIndex, s.id, subject), ...(own.length ? { linked: own } : {}) });
    }
  }
  return [...byStudent.values()];
}

/** 2.0 getMakeeduSyncState — makeedu가 꺼진 학원·행이 없으면 null. */
export async function makeeduSyncState(sql, R, settings, t, domain) {
  if (!R.modules.isModuleEnabled(settings.modules?.disabled, 'makeedu')) return null;
  const [row] = await sql`select to_json(synced_at)#>>'{}' synced_at, row_count, status, error from public.makeedu_sync_state where tenant_id=${t} and domain=${domain}`;
  if (!row) return null;
  return { syncedAt: row.synced_at, rowCount: row.row_count == null ? null : Number(row.row_count), status: row.status, issue: (row.error ?? null) || null };
}
export { num, ymd };
