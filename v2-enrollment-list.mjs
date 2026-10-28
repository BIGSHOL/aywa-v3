// 2.0 신규 콜&상담 · 칸반·목록(app/(shell)/enrollment/page.tsx) — 페이지가 서버에서 하던 조회를 Docker 복사본에서 같은 결과로.
// · 조회 = features/enrollment/server/queries.ts getEnrollmentConsultations(칸반 전건 · fetchAllPaged) · getEnrollmentConsultationsPage(목록 한 쪽) ·
//   getConsultationFilteredCounts(머리 숫자 — 행을 안 받는 count) · getConsultantOptions · getConsultationMinYear와 poll-actions.ts
//   getConsultationTotalCount를 같은 표·같은 조건의 SQL로. 2.0은 사용자 클라이언트 RLS(지점 줄만)로 읽는다 — 여기선 tenant_id를 직접 건다.
// · 필터 = 2.0 applyConsultationFilter 그대로(접수일 > 달 > 기간 · 상담사 · 단계(board-stages 원값 묶음) · 이름·전화·학교 검색) ·
//   경계는 2.0 kst-bounds.ts · 기간 시작은 2.0 rangeStartIso(KST 달 1일) — 순수 함수는 importV2.
// · 카드 배지 = 2.0 loadRowBadges(AI 분석 유무 · '반 배정 완료' = 연결 학생의 상담 과목 미종료 수강 수(consult-subject.ts) · makeedu 원생) ·
//   'N건' = 2.0 samePersonGroups(same-person.ts) 그대로.
// · 읽기 전용 · 바깥 호출 없음.

const MODULES = { kst: 'lib/date-kst.ts', bounds: 'features/enrollment/kst-bounds.ts', range: 'features/enrollment/range.ts',
  board: 'features/enrollment/board-stages.ts', person: 'features/enrollment/same-person.ts', subj: 'features/enrollment/consult-subject.ts' };
let rulesP = null;
export function listRules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

/** page.tsx PAGE_SIZE. */
export const PAGE_SIZE = 50;
/** getConsultantOptions의 역할. */
const CONSULTANT_ROLES = ['counselor', 'manager', 'admin', 'master', 'teacher'];
const iso = (col) => `to_json(${col})#>>'{}'`;

/** LIST_COLS + 상담사 이름(임베드 consultant:consultant_id(display_name)) — PostgREST와 같은 JSON 글자(timestamptz = ISO+오프셋). */
const listCols = (sql) => sql`c.id::text id, c.prospect_name, c.prospect_grade, c.prospect_school, c.parent_phone, c.parent_request, c.outcome::text outcome,
  ${sql.unsafe(iso('c.consulted_at'))} consulted_at, c.subject, c.consultant_id::text consultant_id, c.counselor, c.processing_status::text processing_status,
  c.audio_path, c.from_public_intake, ${sql.unsafe(iso('c.sync_added_at'))} sync_added_at, c.student_id::text student_id, c.makeedu_id, u.display_name consultant_name`;

/** 2.0 rangeStartIso — 프리셋 시작 = 그 달 KST 1일 00:00. */
const rangeStartIso = (R, range) => R.kst.kstMonthStartIso(R.kst.shiftMonth(R.kst.kstMonth(), -(R.range.RANGE_MONTHS[range] - 1)));

/** 2.0 applyConsultationFilter — 조건 조각(별칭 c). */
export function filterSql(sql, R, f) {
  const parts = [sql`c.tenant_id = ${f.tenantId}`];
  if (f.received) {
    const { startIso, endIso } = R.bounds.kstDayBounds(f.received);
    parts.push(sql`c.created_at >= ${startIso} and c.created_at < ${endIso}`);
  } else if (f.month) {
    const { startIso, endIso } = R.bounds.kstMonthBounds(f.month);
    parts.push(sql`c.consulted_at >= ${startIso} and c.consulted_at < ${endIso}`);
  } else parts.push(sql`c.consulted_at >= ${rangeStartIso(R, f.range ?? R.range.DEFAULT_RANGE)}`);
  if (f.consultantId) parts.push(sql`c.consultant_id::text = ${f.consultantId}`);
  if (f.outcome) parts.push(sql`c.outcome::text = ${f.outcome}`);
  if (f.stage) parts.push(sql`c.outcome::text = any(${R.board.outcomesOfStage(f.stage)})`);
  if (f.q) {
    const safe = f.q.trim().replace(/[(),]/g, ' ');
    // PostgREST ilike 패턴은 `*`도 `%`로 읽는다 — 같은 패턴으로.
    if (safe) { const pat = `%${safe.replaceAll('*', '%')}%`; parts.push(sql`(c.prospect_name ilike ${pat} or c.parent_phone ilike ${pat} or c.prospect_school ilike ${pat})`); }
  }
  return parts.reduce((a, b) => sql`${a} and ${b}`);
}

/** 2.0 loadRowBadges — 로드된 행들만(AI 분석 · 상담 과목 미종료 수강 수 · makeedu 원생). */
async function loadRowBadges(sql, R, t, data, subjects, today) {
  const ids = data.map((c) => c.id), studentIds = [...new Set(data.map((c) => c.student_id).filter(Boolean))];
  const [ai, enr, mk] = await Promise.all([
    ids.length ? sql`select distinct consultation_id::text consultation_id from public.consultation_ai_analysis where consultation_id = any(${ids}::uuid[])` : [],
    studentIds.length ? sql`select e.student_id::text student_id, k.subject from public.enrollments e join public.classes k on k.id = e.class_id and k.tenant_id = ${t}
      where e.tenant_id = ${t} and e.student_id = any(${studentIds}::uuid[]) and (e.end_date is null or e.end_date >= ${today}::date)` : [],
    studentIds.length ? sql`select id::text id from public.students where tenant_id = ${t} and id = any(${studentIds}::uuid[]) and makeedu_id is not null` : [],
  ]);
  const classKeysOf = R.subj.consultClassKeysOf(subjects);
  const enrByStudent = new Map();
  for (const row of enr) {
    const rec = enrByStudent.get(row.student_id) ?? { total: 0, bySubject: new Map() };
    rec.total += 1;
    if (row.subject) rec.bySubject.set(row.subject, (rec.bySubject.get(row.subject) ?? 0) + 1);
    enrByStudent.set(row.student_id, rec);
  }
  return {
    hasAi: new Set(ai.map((a) => a.consultation_id)),
    inMakeedu: new Set(mk.map((r) => r.id)),
    assignedCountFor: (studentId, subject) => {
      if (!studentId) return 0;
      const rec = enrByStudent.get(studentId);
      if (!rec) return 0;
      const keys = classKeysOf(subject);
      if (keys === null) return rec.total;
      return keys.reduce((n, key) => n + (rec.bySubject.get(key) ?? 0), 0);
    },
  };
}

/** 행 하나 → 2.0 ConsultationListRow 공통 칸. */
const baseRow = (c, b) => ({
  id: c.id, prospectName: c.prospect_name, prospectGrade: c.prospect_grade, prospectSchool: c.prospect_school, parentPhone: c.parent_phone,
  parentRequest: c.parent_request, consultantName: c.consultant_name ?? null, counselorText: c.counselor?.trim() || null, outcome: c.outcome,
  consultedAt: c.consulted_at, hasAiAnalysis: b.hasAi.has(c.id), processingStatus: c.processing_status, hasAudio: !!c.audio_path,
  fromPublicIntake: !!c.from_public_intake, syncAddedAt: c.sync_added_at ?? null, makeeduId: c.makeedu_id ?? null,
  studentInMakeedu: !!c.student_id && b.inMakeedu.has(c.student_id), studentId: c.student_id ?? null,
  assignedClassCount: b.assignedCountFor(c.student_id, c.subject ?? null),
});

/** getEnrollmentConsultations — 칸반 전건(2.0 fetchAllPaged = 절단 없는 전건). */
export async function getEnrollmentConsultations(sql, R, f, subjects, today) {
  const data = await sql`select ${listCols(sql)} from public.enrollment_consultations c left join public.users u on u.id = c.consultant_id
    where ${filterSql(sql, R, f)} order by c.consulted_at desc, c.id`;
  if (!data.length) return [];
  const b = await loadRowBadges(sql, R, f.tenantId, data, subjects, today);
  const groupOf = R.person.samePersonGroups(data);
  const personKey = (c) => groupOf.get(c.id) ?? c.id;
  const personCount = new Map(), personGroups = new Map();
  for (const c of data) {
    const k = personKey(c);
    personCount.set(k, (personCount.get(k) ?? 0) + 1);
    const arr = personGroups.get(k) ?? [];
    arr.push({ id: c.id, prospectName: c.prospect_name, subject: c.subject ?? null, outcome: c.outcome, consultedAt: c.consulted_at });
    personGroups.set(k, arr);
  }
  return data.map((c) => {
    const n = personCount.get(personKey(c)) ?? 1;
    return { ...baseRow(c, b), personConsultCount: n, personConsults: n > 1 ? (personGroups.get(personKey(c)) ?? []) : [] };
  });
}

/** getEnrollmentConsultationsPage — 목록 한 쪽 + 총건수. */
export async function getEnrollmentConsultationsPage(sql, R, f, page, pageSize, subjects, today) {
  const from = Math.max(0, (page - 1) * pageSize);
  const where = filterSql(sql, R, f);
  const [rows, [{ n }]] = await Promise.all([
    sql`select ${listCols(sql)} from public.enrollment_consultations c left join public.users u on u.id = c.consultant_id
      where ${where} order by c.consulted_at desc, c.id offset ${from} limit ${pageSize}`,
    sql`select count(*)::int n from public.enrollment_consultations c where ${where}`,
  ]);
  if (!rows.length) return { rows: [], total: n };
  const b = await loadRowBadges(sql, R, f.tenantId, rows, subjects, today);
  return { total: n, rows: rows.map((c) => ({ ...baseRow(c, b), subject: c.subject ?? null, consultantId: c.consultant_id ?? null })) };
}

/** getConsultationFilteredCounts — 필터 전체 건수 + AI 완료 건수(행을 안 받는다). */
export async function getConsultationFilteredCounts(sql, R, f) {
  const [[all], [ai]] = await Promise.all([
    sql`select count(*)::int n from public.enrollment_consultations c where ${filterSql(sql, R, f)}`,
    sql`select count(*)::int n from public.enrollment_consultations c where ${filterSql(sql, R, { ...f, outcome: 'ai_done' })}`,
  ]);
  return { total: all.n, aiDone: ai.n };
}

/** getConsultantOptions — 상담사 선택지(재직 · 상담 가능한 역할 · 이름순). */
export async function getConsultantOptions(sql, t) {
  const rows = await sql`select id::text id, display_name from public.users where tenant_id = ${t} and system_role::text = any(${CONSULTANT_ROLES}) and status::text = 'active'
    order by display_name`;
  return rows.map((u) => ({ id: u.id, name: u.display_name }));
}

/** getConsultationMinYear — 가장 이른 상담의 KST 연도(없으면 올해). */
export async function getConsultationMinYear(sql, R, t) {
  const [row] = await sql`select ${sql.unsafe(iso('consulted_at'))} consulted_at from public.enrollment_consultations where tenant_id = ${t} order by consulted_at asc limit 1`;
  if (!row?.consulted_at) return R.kst.kstYear();
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date(row.consulted_at)));
}

/** poll-actions getConsultationTotalCount — 필터와 무관한 전체 건수(자동 갱신 기준선). */
export async function getConsultationTotalCount(sql, t) {
  const [{ n }] = await sql`select count(*)::int n from public.enrollment_consultations where tenant_id = ${t}`;
  return n;
}

/** page.tsx 126~147줄 — 주소 해석(달·접수일은 달력에 있는 값만 · 단계 · 검색 · 쪽 · 기간). */
export function resolveListFilter(R, sp, t) {
  const month = R.kst.isValidYm(sp.month) ? sp.month : null;
  const received = R.kst.isValidYmd(sp.received) ? sp.received : null;
  return { tenantId: t, month, range: R.range.parseRange(sp.range), consultantId: sp.consultant ?? null, stage: R.board.parseBoardStage(sp.outcome),
    q: sp.q?.trim() || null, received };
}

/** 칸반·목록 보기의 자료 — page.tsx가 받던 값. */
export async function buildList({ sql, R, t, sp, view, subjects }) {
  const today = R.kst.kstToday();
  const filter = resolveListFilter(R, sp, t);
  const page = Math.max(1, Number(sp.page) || 1);
  const [kanbanItems, tablePage, headerCounts, consultants, minYear, totalCount] = await Promise.all([
    view === 'kanban' ? getEnrollmentConsultations(sql, R, filter, subjects, today) : null,
    view === 'table' ? getEnrollmentConsultationsPage(sql, R, filter, page, PAGE_SIZE, subjects, today) : null,
    view === 'table' ? getConsultationFilteredCounts(sql, R, filter) : null,
    getConsultantOptions(sql, t),
    getConsultationMinYear(sql, R, t),
    getConsultationTotalCount(sql, t),
  ]);
  return { kanbanItems, tablePage, headerCounts, consultants, minYear, totalCount };
}
