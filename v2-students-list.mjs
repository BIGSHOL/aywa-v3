// 2.0 화면 · 원생목록(app/(shell)/students/page.tsx) — 페이지가 서버에서 하던 일을 Docker 복사본에서 같은 결과로.
// · 필터 해석 = page.tsx 그대로(검색 중이면 상태 기본값 '전체' · 계정 보기 설정은 기본값 — 3.0엔 로그인이 없어 주소로만 · 강사 범위 없음).
// · 조회 = features/students/server/queries.ts getStudentsPage · getEnrolledStatCounts · getTeacherOptions와 enrolled-programs.ts ·
//   restrict-ids.ts(운영실 ↗ program/first/level/mix) · parent-search.ts · lib/auth/teacher-scope.ts getTeacherScope · memoMatchStudentIds를
//   같은 표·같은 조건의 SQL로(2.0은 사용자 클라이언트 RLS로 이 지점 줄만 읽는다 — 여기선 tenant_id를 직접 건다). 판정은 2.0 순수 함수(importV2).
// · 재원 총원·과목별 카드는 운영실 '재원생' 영역(v2-dashboard-students.mjs)과 같은 함수 · 첫 수업(first=)은 운영실 '오늘첫수업' 영역과 같은 함수.
// · 읽기 전용 · 바깥 호출 없음.
import { studentsBase } from './v2-students-common.mjs';
import { STUDENT_AREAS } from './v2-dashboard-students.mjs';
import { ATTENDANCE_AREAS } from './v2-dashboard-attendance.mjs';

const MODULES = { prefs: 'features/students/list/list-prefs.ts', axis: 'features/students/scope-axis.ts', vals: 'features/students/list-filter-values.ts',
  program: 'features/students/enrollment/program.ts', kst: 'lib/date-kst.ts', comp: 'features/students/enrollment/enrolled-composition.ts',
  gsort: 'features/students/grade-sort.ts', multi: 'lib/multi-value.ts' };
let rulesP = null;
function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

/** page.tsx PAGE_SIZE. */
export const PAGE_SIZE = 50;
/** queries.ts MEMO_MATCH_CAP — 메모·학부모 이름으로 함께 태울 학생 id 상한. */
const MEMO_MATCH_CAP = 200;
/** queries.ts SEARCH_FIELD_COLS. */
const SEARCH_FIELD_COLS = { all: ['name', 'english_name', 'school', 'student_phone', 'parent_phone', 'parent_name'], name: ['name', 'english_name'], school: ['school'],
  phone: ['student_phone', 'parent_phone'], address: ['address'], email: ['email'], memo: ['notes'], parent: ['parent_name'] };
/** getTeacherOptions의 역할. */
const TEACHER_ROLES = ['teacher', 'counselor', 'manager', 'admin', 'master'];

/** page.tsx 136~201줄 — 필터 해석(계정 보기 설정 = 기본값 · 강사 범위 없음 → 과목 축 없음). */
export function resolveFilters(R, sp, settings, teachers) {
  const searching = (sp.q ?? '').trim() !== '';
  const statusDefault = searching ? 'all' : 'enrolled';
  const status = sp.status ?? statusDefault;
  const prefs = R.prefs.DEFAULT_STUDENT_LIST_PREFS;
  const axis = R.axis.subjectAxisOf(null);
  const subjectRaw = R.axis.coerceSubjectFilter(axis, sp.subject ?? prefs.subject);
  const q = sp.q ?? '';
  const gradeRaw = sp.grade ?? prefs.grade;
  const teacherRaw = sp.teacher ?? prefs.teacher;
  const field = R.prefs.parseSearchField(sp.field ?? prefs.field);
  const sort = R.prefs.parseStudentSort(sp.sort ?? prefs.sort);
  const excludeNoEnrollment = (sp.noenr ?? (prefs.noenr ? '1' : '0')) === '1';
  const page = Math.max(1, Number(sp.page) || 1);
  const program = R.program.parseProgram(sp.program);
  const firstDay = R.kst.isValidYmd(sp.first) ? sp.first : null;
  const levels = R.vals.parseLevels(sp.level);
  const mixes = R.vals.parseMixes(sp.mix);
  const fromDashboard = sp.from === 'dashboard';
  let teacherId = teacherRaw, grade = gradeRaw, subject = subjectRaw;
  const fromPrefs = (key) => sp[key] === undefined;
  if ((fromPrefs('teacher') && teacherRaw !== 'all') || (fromPrefs('grade') && gradeRaw !== 'all') || (fromPrefs('subject') && subjectRaw !== 'all')) {
    const keepKnown = (raw, known) => R.vals.joinMulti(R.vals.parseMulti(raw).filter(known));
    if (fromPrefs('teacher')) teacherId = keepKnown(teacherRaw, (v) => teachers.some((t) => t.id === v));
    if (fromPrefs('grade')) grade = keepKnown(gradeRaw, (v) => settings.operations.gradeLevels.includes(v));
    if (fromPrefs('subject')) subject = keepKnown(subjectRaw, (v) => v === R.vals.NO_SUBJECT || settings.operations.subjects.some((s) => s.key === v));
  }
  const wantsNoSubject = status !== 'withdrawn' && R.vals.parseMulti(subject).includes(R.vals.NO_SUBJECT);
  return { searching, statusDefault, status, subject, q, grade, teacherId, field, sort, excludeNoEnrollment, page, program, firstDay, levels, mixes, fromDashboard, wantsNoSubject };
}

// ── 활성 수강 · 재원생 명단(enrolled-programs.ts) ──────────────────────────────────────────────────────────────────────
/** 2.0 ActiveEnrollmentRow 모양. */
const activeRow = (r) => ({ id: r.id, student_id: r.student_id, class_id: r.class_id, start_date: r.start_date, end_date: null, is_transferred: null,
  class: { subject: r.subject, english_track: r.english_track }, student: { status: r.status } });
/** fetchActiveEnrolledEnrollments(enrolledOnly) — 종료 안 됨 · 휴원 아님 · 반 필수 · 학생 필수(재원만이면 상태 재원). */
async function activeEnrollments(base, enrolledOnly) {
  const t = base.t, F = base.sql.frag;
  const rows = await base.sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, c.subject, c.english_track, s.status::text status
    from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t} join public.students s on s.id = e.student_id and s.tenant_id = ${t}
    where e.tenant_id=${t} and e.end_date is null and e.on_hold = false ${enrolledOnly ? F`and s.status = 'enrolled'` : F``} order by e.id`;
  return rows.map(activeRow);
}
const memoOf = (base) => (base.listMemo ??= new Map());
function once(base, key, fn) {
  const m = memoOf(base);
  if (!m.has(key)) m.set(key, fn().catch((e) => { m.delete(key); throw e; }));
  return m.get(key);
}
const loadActiveEnrolled = (base) => once(base, 'active:enrolled', () => activeEnrollments(base, true));
const loadActiveAny = (base) => once(base, 'active:any', () => activeEnrollments(base, false));
/** getNotStartedStudentIds — 아직 한 과목도 시작 안 한 재원생. */
const notStartedIds = (base, R) => once(base, 'notStarted', async () => R.comp.notYetStartedStudentIds(await loadActiveEnrolled(base), base.today));
/** getEnrolledComposition(강사 범위 없음). */
const composition = (base, R) => once(base, 'composition', async () => {
  const students = await base.sql`select id::text id, grade, school from public.students where tenant_id=${base.t} and status = 'enrolled' order by id`;
  return R.comp.composeEnrolled({ students: students.map((s) => ({ ...s })), rows: await loadActiveEnrolled(base), scope: null, subjects: base.settings.operations.subjects, today: base.today });
});

/** getEnrolledStatCounts(강사 범위 없음) = 운영실 '재원생' 영역과 같은 함수 — 재원 총원(아직 시작 안 한 학생 뺌) + 과목별 재원생 + 수강 조합. */
async function statCounts(base) {
  const area = await STUDENT_AREAS.students({ t: base.t, today: base.today, settings: base.settings, importV2: base.load, memo: new Map() }, base.tx);
  return { enrolled: area.enrolled, bySubject: Object.fromEntries(area.subjects.map((s) => [s.label, s.value])), combinations: area.subjectCombinations };
}

/** getTeacherOptions — 재직 중인 강사·상담·매니저·관리자·원장, 이름순. */
async function teacherOptions(base) {
  const rows = await base.sql`select id::text id, display_name, system_role::text system_role, subjects from public.users
    where tenant_id=${base.t} and system_role::text = any(${TEACHER_ROLES}) and status::text = 'active' order by display_name, id`;
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, systemRole: r.system_role, subjects: Array.isArray(r.subjects) ? r.subjects : [] }));
}

/** restrictIdsFor — 운영실이 넘긴 학생 집합(프로그램 · 그날 첫 수업 · 재원생 구성 조각), 여럿이면 교집합. 없으면 null. */
async function restrictIdsFor(base, R, program, first, { levels, mixes }) {
  const byComposition = levels.length > 0 || mixes.length > 0;
  if (!program && !first && !byComposition) return null;
  const sets = [];
  if (program) { const { programs } = await composition(base, R); sets.push(new Set([...programs].flatMap(([id, set]) => (set.has(program) ? [id] : [])))); }
  if (first) {
    const list = await ATTENDANCE_AREAS.firstClass({ t: base.t, today: first, settings: base.settings, importV2: base.load, memo: new Map() }, base.tx);
    sets.push(new Set(list.map((s) => s.studentId)));
  }
  if (byComposition) sets.push(R.comp.compositionStudentIds(await composition(base, R), { levels, mixes }));
  return sets.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))));
}

/** getTeacherScope(teacherId).studentIds — 그 강사 반(담당 = classes.teacher_id)의 종료 안 된 수강 학생. */
async function teacherStudentIds(base, teacherId) {
  const rows = await base.sql`select distinct e.student_id::text id from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${base.t}
    where e.tenant_id=${base.t} and c.teacher_id = ${teacherId} and e.end_date is null`;
  return rows.map((r) => r.id);
}

/** getSubjectFilterKeep — 과목 필터에 '미수강'이 섞였을 때(고른 과목 중 하나라도 듣거나 지금 수강 중인 과목이 없는 학생). 없으면 null. */
async function subjectFilterKeep(base, R, subjects, enrolledOnly) {
  if (!subjects.includes(R.vals.NO_SUBJECT)) return null;
  const real = new Set(subjects.filter((s) => s !== R.vals.NO_SUBJECT));
  const rows = enrolledOnly ? await loadActiveEnrolled(base) : await loadActiveAny(base);
  const active = R.comp.activeStudentIds(rows, null, base.today);
  const takes = new Set();
  if (real.size > 0) for (const row of rows) if (row.class?.subject && real.has(row.class.subject)) takes.add(row.student_id);
  return (id) => takes.has(id) || !active.has(id);
}

/** 검색어 정리(searchTerm) · PostgREST 패턴(ilike `*` = `%`). */
const searchTerm = (q) => (q ?? '').trim().replace(/[,()]/g, ' ');
const likeOf = (term) => `%${term}%`.replace(/\*/g, '%');
/** extraSearchIds — 검색 허용 메모(기본 검색만) + 연결된 신규 콜&상담의 학부모 이름(기본·학부모명), 합쳐 상한 안. */
async function extraSearchIds(base, q, field) {
  const term = searchTerm(q), f = field ?? 'all';
  if (!term || (f !== 'all' && f !== 'parent')) return [];
  const like = likeOf(term);
  const memo = f === 'all' ? await base.sql.soft((sp) => sp`select student_id::text id from public.student_memos where tenant_id=${base.t} and searchable = true and content ilike ${like}
      order by id limit ${MEMO_MATCH_CAP}`, []) : [];
  const parent = await base.sql.soft((sp) => sp`select student_id::text id from public.enrollment_consultations where tenant_id=${base.t} and student_id is not null
      and parent_name ilike ${like} order by id limit ${MEMO_MATCH_CAP}`, []);
  return [...new Set([...memo.map((r) => r.id), ...parent.map((r) => r.id)])].slice(0, MEMO_MATCH_CAP);
}

/** getStudentsPage(강사 범위 없음) — 한 쪽 줄 + 걸린 줄 수 + 감춘 '아직 시작 안 한 학생' 수. */
export async function studentsPage(base, R, options, page = 1, pageSize = PAGE_SIZE) {
  const t = base.t, F = base.sql.frag;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;
  const isWithdrawn = options.status === 'withdrawn';
  const hideNotStarted = options.status === 'enrolled' ? await notStartedIds(base, R) : null;
  const hiddenCount = hideNotStarted?.size ?? 0;
  const teacherIds = R.vals.parseMulti(options.teacherId);
  let teacherFilterIds = null, teacherKeep = null;
  if (teacherIds.length > 0 && !isWithdrawn) {
    const union = [...new Set((await Promise.all(teacherIds.map((id) => teacherStudentIds(base, id)))).flat())];
    if (union.length === 0) return { rows: [], total: 0, hiddenNotStarted: 0 };
    if (teacherIds.length === 1) teacherFilterIds = union; else teacherKeep = new Set(union);
  }
  // subjectFilterOf · enrollmentEmbed.
  const all = R.vals.parseMulti(options.subject);
  const none = all.includes(R.vals.NO_SUBJECT) && !isWithdrawn;
  const real = all.filter((s) => s !== R.vals.NO_SUBJECT);
  const subjectFilter = { real, none, all: none ? all : real };
  const excludeNoEnrollment = !!options.excludeNoEnrollment && !isWithdrawn && !subjectFilter.none;
  const bySubject = real.length > 0 && !none, byTeacher = isWithdrawn && teacherIds.length > 0;
  const grades = R.vals.parseMulti(options.grade);
  const subjectKeep = subjectFilter.none ? await subjectFilterKeep(base, R, subjectFilter.all, options.status === 'enrolled') : null;
  const needEnrollmentJoin = excludeNoEnrollment || bySubject || byTeacher;
  const memoIds = await extraSearchIds(base, options.q, options.searchField);
  const idWhitelist = teacherFilterIds;

  // 목록 필터(buildQuery) — enrollments!inner 임베드 = 그 조건을 모두 만족하는 수강이 하나라도 있는 학생(반 열이 필요할 때만 반 필수).
  const conds = [F`s.tenant_id = ${t}`];
  if (options.status && options.status !== 'all') conds.push(F`s.status::text = ${options.status}`);
  if (hideNotStarted && hideNotStarted.size > 0) conds.push(F`s.id <> all(${[...hideNotStarted]}::uuid[])`);
  if (grades.length > 0) conds.push(F`s.grade = any(${grades})`);
  const term = searchTerm(options.q);
  if (term) {
    const like = likeOf(term), cols = SEARCH_FIELD_COLS[options.searchField ?? 'all'] ?? SEARCH_FIELD_COLS.all;
    const parts = cols.map((c) => F`${F('s.' + c)} ilike ${like}`);
    if (memoIds.length > 0) parts.push(F`s.id = any(${memoIds}::uuid[])`);
    conds.push(F`(${parts.reduce((a, p) => F`${a} or ${p}`)})`);
  }
  if (needEnrollmentJoin) {
    const ec = [F`e.student_id = s.id`, F`e.tenant_id = ${t}`];
    if (!isWithdrawn) ec.push(F`e.end_date is null`);
    if (bySubject) { if (!isWithdrawn) ec.push(F`e.on_hold = false`); ec.push(F`c.subject = any(${real})`); }
    if (byTeacher) ec.push(F`c.teacher_id = any(${teacherIds}::uuid[])`);
    const join = bySubject || byTeacher ? F`join public.classes c on c.id = e.class_id and c.tenant_id = ${t}` : F``;
    conds.push(F`exists (select 1 from public.enrollments e ${join} where ${ec.reduce((a, p) => F`${a} and ${p}`)})`);
  }
  if (idWhitelist) conds.push(F`s.id = any(${idWhitelist}::uuid[])`);
  const where = conds.reduce((a, p) => F`${a} and ${p}`);
  const order = options.sort === 'name' ? F`s.name asc, s.id asc` : options.sort === 'name_desc' ? F`s.name desc, s.id asc` : F`s.grade asc, s.name asc, s.id asc`;
  const cols = F`s.id::text id, s.name, s.english_name, s.school, s.grade, s.status::text status, s.enrolled_at::text enrolled_at, s.parent_phone`;

  let pageData, total;
  const restrictIds = options.restrictIds ?? null;
  const restrictBy = restrictIds || subjectKeep || teacherKeep
    ? { has: (id) => (!restrictIds || restrictIds.has(id)) && (!subjectKeep || subjectKeep(id)) && (!teacherKeep || teacherKeep.has(id)), empty: restrictIds?.size === 0 }
    : null;
  const gradeSort = R.gsort.isGradeSort(options.sort);
  const restrict = restrictBy ?? (gradeSort ? { has: () => true, empty: false } : null);
  if (restrict) {
    const fetched = restrict.empty ? [] : await base.sql`select ${cols} from public.students s where ${where} order by ${order}`;
    const matched = [], seen = new Set();
    for (const row of gradeSort ? R.gsort.sortByGrade(fetched, options.sort === 'grade_desc') : fetched) {
      if (seen.has(row.id) || !restrict.has(row.id)) continue;
      seen.add(row.id); matched.push(row);
    }
    total = matched.length;
    pageData = matched.slice(from, to + 1);
  } else {
    const [rows, [{ n }]] = await Promise.all([
      base.sql`select ${cols} from public.students s where ${where} order by ${order} offset ${from} limit ${pageSize}`,
      base.sql`select count(*)::int n from public.students s where ${where}`]);
    pageData = rows; total = n;
  }

  const ids = pageData.map((r) => r.id);
  const subjectsByStudent = new Map(), teacherPairsByStudent = new Map();
  if (ids.length > 0) {
    // 퇴원 목록의 과목·담당 열은 이력 기준(활성 조건 없음).
    const ens = await base.sql`select e.student_id::text student_id, e.on_hold, c.subject, c.teacher_id::text teacher_id, u.display_name
      from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${t} left join public.users u on u.id = c.teacher_id and u.tenant_id = ${t}
      where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) ${isWithdrawn ? F`` : F`and e.end_date is null`} order by e.id`;
    for (const e of ens) {
      if (!isWithdrawn && e.on_hold) continue;
      if (e.subject) { const set = subjectsByStudent.get(e.student_id) ?? new Set(); set.add(e.subject); subjectsByStudent.set(e.student_id, set); }
      if (e.teacher_id && e.display_name) { const pairs = teacherPairsByStudent.get(e.student_id) ?? []; pairs.push({ subject: e.subject ?? null, name: e.display_name }); teacherPairsByStudent.set(e.student_id, pairs); }
    }
  }
  const rows = pageData.map((r) => ({
    id: r.id, name: r.name, englishName: r.english_name ?? null, school: r.school, grade: r.grade, status: r.status,
    teacherNames: R.axis.narrowTeacherNames(null, teacherPairsByStudent.get(r.id) ?? []), enrolledAt: r.enrolled_at, parentPhone: r.parent_phone,
    subjects: R.axis.narrowSubjects(null, Array.from(subjectsByStudent.get(r.id) ?? []).sort()),
  }));
  return { rows, total, hiddenNotStarted: hiddenCount };
}

/**
 * 원생목록 한 벌 — page.tsx가 서버에서 받던 값(지역 변수 이름 그대로) + 해석한 필터(시험·대조용 `resolved`).
 * `sp` = 2.0 searchParams(검사를 지난 값만) · `sql` = 읽기 전용 트랜잭션.
 */
export async function buildStudentList({ sql: tx, tenantId: t, importV2, sp = {}, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer || base.level('students') === 'none') return { notFound: true };
  const R = await rules(base.load);
  // 차례대로(한 관문) — 2.0 Promise.all과 같은 값.
  const teachers = await teacherOptions(base);
  const resolved = resolveFilters(R, sp, base.settings, teachers);
  const restrictIds = await restrictIdsFor(base, R, resolved.program, resolved.firstDay, { levels: resolved.levels, mixes: resolved.mixes });
  const page = await studentsPage(base, R, { status: resolved.status, subject: resolved.subject, q: resolved.q, grade: resolved.grade, teacherId: resolved.teacherId,
    searchField: resolved.field, sort: resolved.sort, excludeNoEnrollment: resolved.excludeNoEnrollment, restrictIds }, resolved.page, PAGE_SIZE);
  const counts = await statCounts(base);
  return {
    viewer: { id: base.viewer.id, name: base.viewer.name, systemRole: base.viewer.systemRole, tenantId: t },
    canManageStudent: base.level('students') === 'full',
    scope: null, prefsLoaded: null,
    teachers: teachers.map((x) => ({ id: x.id, displayName: x.displayName })),
    settings: { operations: base.settings.operations, modules: base.settings.modules },
    counts, page, lang: base.lang, teacherNames: {},
    resolved: { ...resolved, restricted: restrictIds ? restrictIds.size : null },
  };
}
