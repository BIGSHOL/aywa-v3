// 2.0 운영실 상단 KPI 다섯 칸(재원생 · 강좌수 · 퇴원&수업종료 · 신규문의 · 이달 신규)을 로컬 Docker 복사본에서 2.0 판정 그대로 — 3.0 원장 첫 화면 '원생 현황' 줄.
// 원장 10-28 *"기존 2.0 대시보드의 상단 kpi 항목을 보고 어떤 항목이 필요한지 판단해서 넣을것"* · *"원하는건 추세. 최근 kpi 변화"*.
// · 오늘 값 = 2.0 `src/features/dashboard/overview/server.ts`의 students·courses·withdrawals·intake·enrolledToday 칸. 조회는 같은 표·같은 조건을 SQL로
//   (사용자 클라이언트 RLS = 지점 격리 → `tenant_id`), 판정은 2.0 순수 함수(importV2). `server-only` 파일의 조립부(조회 사이의 몇 줄)만 같은 식으로 옮겼다.
// · 추세 = 재원생·강좌수는 2.0 '재원생 추이'·'강좌수 추이'(`loadEnrolledTrend` — 달마다 말일, 이번 달은 오늘 · 에이와 기록이 갖춰진 달부터).
//   퇴원&수업종료는 2.0 칸 판정을 달마다 1일~같은 날로, 신규 등록('이달 신규')은 2.0 칸 판정을 최근 7일 창 8개로. 신규문의는 2.0 '신규 문의 추이'처럼
//   상담일로 최근 7일 창 8개(2.0 칸 '오늘 접수'는 입력 시각이지만, 옮겨 넣은 옛 상담이 입력한 날로 몰려 추세로는 쓸 수 없다 · 앱에서 넣은 상담은 둘이 같다).
// · 큰 숫자 = 2.0 칸 값. 재원생·강좌수는 오늘 점도 칸 값(2.0 규약 '오늘 점 = 칸'). 퇴원&수업종료는 칸에 단체 장부 정리 퇴원이 들고
//   추세 점·전월 대비에는 안 든다(원장 10-20 "카드엔 들고 추이엔 안 든다" — 큰 숫자와 마지막 점이 다를 수 있다). 전월 대비는 선의 점 팝오버와
//   같은 추세 점끼리다(한 카드 안의 두 '전월 대비'가 다른 모집단이면 안 된다 · 장부 날짜 몰림이 '좋아짐'으로 칠해지지 않게).
// · 지난 기간은 지금 기록으로 그 날짜를 다시 센다(상태 이력이 없다 — 그 사이 다시 등록한 퇴원생은 그 달에서 빠지고, 늦게 적힌 퇴원은 그 달에 든다).
//   수업종료는 그날 뒤에 퇴원한 학생도 그날 재원생으로 보고, 그날 뒤에 만든 수강은 뺀다(그날의 2.0 칸이 보던 사람·수강).
//   접수·등록 전환·수강 생성처럼 시각이 있는 것은 그날 복사본을 뜬 시각과 같은 시각까지 센다(같은 조건끼리 견준다 — v2-teacher-work.mjs와 같은 규칙).
//   기준일은 복사본 날짜 이하만 받는다(그 뒤는 기록이 없다). 지난 기준일의 재원생·강좌수 칸 = 추이의 그날 점(칸 조회는 지금 상태로만 센다).
// · 기록이 시작되기 전 창은 '기록 없음'(null) — 0이 아니다(상담 상태 변경 기록은 2026-09-10부터 남는다).
// · 읽기 전용 트랜잭션 · 쓰기 없음 · 바깥 호출 없음.
import { readFile } from 'node:fs/promises';
import { queryGate, rules as rosterRules, resolveSettings, copyClock } from './v2-onescreen-roster.mjs';
import { tenantId as COPY_TENANT } from './full-db.mjs';

const MODULES = { kst: 'lib/date-kst.ts', comp: 'features/students/enrollment/enrolled-composition.ts', course: 'features/students/enrollment/course-count.ts',
  trend: 'features/dashboard/overview/enrolled-trend.ts', courseTrend: 'features/dashboard/overview/course-trend.ts', points: 'features/dashboard/overview/trend-points.ts',
  billing: 'features/dashboard/overview/trend-billing.ts', coverage: 'features/dashboard/overview/coverage-rules.ts', win: 'features/withdrawals/window.ts',
  bulk: 'features/withdrawals/system-bulk.ts', merged: 'features/students/status/merged.ts', ended: 'features/withdrawals/subject-ended.ts',
  special: 'features/classes/special-lecture.ts', exits: 'features/dashboard/overview/monthly-exits.ts', model: 'features/dashboard/overview/model.ts',
  bounds: 'features/enrollment/kst-bounds.ts', outcome: 'features/dashboard/overview/enrolled-outcome.ts', recent: 'features/dashboard/overview/enrolled-recent.ts',
  consult: 'features/enrollment/consult-subject.ts' };
const OUTCOME_ACTION = 'enrollment_consultation_outcome';
let rulesP = null, constsP = null;
export async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/** 서버 전용 파일의 창 길이 — 불러올 수 없어 그 파일의 값을 읽는다(기록 범위 record-coverage.ts · 청구 시작 달 trend-billing-server.ts). */
export async function consts() {
  const read = async (file, re) => {
    const n = Number((await readFile(new URL(`../../src/features/dashboard/overview/${file}`, import.meta.url), 'utf8')).match(re)?.[1]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`2.0 ${file}의 창 길이를 읽지 못했습니다`);
    return n;
  };
  constsP ??= Promise.all([read('record-coverage.ts', /export const COVERAGE_WINDOW_MONTHS = (\d+);/), read('trend-billing-server.ts', /const SEARCH_MONTHS = (\d+);/)])
    .then(([coverage, search]) => ({ coverage, search })).catch((e) => { constsP = null; throw e; });
  return constsP;
}
/** 2.0 getTenantSettings — 설정 행을 못 읽으면 침산 기본값 + 지점 이름(v2-teacher-work.mjs와 같은 식). */
export async function tenantSettings(sql, t, importV2) {
  const [row, name, RR] = await Promise.all([
    sql.soft(async (sp) => ({ data: (await sp`select data from public.tenant_settings where tenant_id=${t}`)[0]?.data ?? null }), { failed: true }),
    sql.soft(async (sp) => (await sp`select name from public.tenants where id=${t}`)[0]?.name ?? '', ''),
    rosterRules(importV2)]);
  return resolveSettings(RR, row.failed ? {} : row.data, name);
}

// ── 재원생 · 강좌수 오늘 칸 ─────────────────────────────────────────────────────────────────────────────────────────────
/** PostgREST 줄 모양(`class` 객체) — 2.0 ActiveEnrollmentRow. */
const activeRow = (r) => ({ id: r.id, student_id: r.student_id, class_id: r.class_id, start_date: r.start_date, end_date: r.end_date ?? null, is_transferred: r.is_transferred ?? null,
  class: { subject: r.subject, english_track: r.english_track } });
/** 2.0 students()·courses() — fetchActiveEnrolledEnrollments(종료일 없음 · 휴원 아님 · 반 필수 · 학생 재원) · fetchEndingEnrolledEnrollments(종료일 ≥ 오늘) · countEnrolledStudents. */
async function enrolledCards(sql, R, t, today, subjects) {
  const [open, ending] = await Promise.all([
    sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, c.subject, c.english_track
      from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t} join public.students s on s.id = e.student_id and s.tenant_id = ${t}
      where e.tenant_id=${t} and e.end_date is null and e.on_hold = false and s.status = 'enrolled' order by e.id`,
    sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, c.subject, c.english_track
      from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t} join public.students s on s.id = e.student_id and s.tenant_id = ${t}
      where e.tenant_id=${t} and e.end_date >= ${today} and e.on_hold = false and s.status = 'enrolled' order by e.id`]);
  const rows = open.map(activeRow);
  // '실시간 재원생' — 아직 한 과목도 시작 안 한 학생은 총원에서 뺀다(같은 rows에서 집합을 만든다).
  const notStarted = [...R.comp.notYetStartedStudentIds(rows, today)];
  const [{ n }] = await sql`select count(*)::int n from public.students where tenant_id=${t} and status = 'enrolled' and id <> all(${notStarted}::uuid[])`;
  const courses = R.course.summarizeCourses({ rows: [...rows, ...ending.map(activeRow)], scope: null, subjects, today });
  return { students: n, courses: courses.total };
}

// ── 재원생 추이 · 강좌수 추이 ───────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 loadTrendRaw(trend-inputs-server.ts) — 원생·수강 전건(반은 왼쪽 조인). 운영실 추이 영역(v2-dashboard-trends.mjs)도 쓴다. */
export async function trendRaw(sql, R, t, today) {
  const [students, enrollments] = await Promise.all([
    sql`select id::text id, status::text status, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, notes, withdrawal_metadata from public.students where tenant_id=${t} order by id`,
    sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.on_hold, c.subject, c.english_track
      from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${t} where e.tenant_id=${t} order by e.id`]);
  const firstStart = new Map(), ended = new Set();
  for (const e of enrollments) {
    if (e.end_date) ended.add(e.student_id);
    if (!e.start_date) continue;
    const cur = firstStart.get(e.student_id);
    if (!cur || e.start_date < cur) firstStart.set(e.student_id, e.start_date);
  }
  const firstOut = students.reduce((m, s) => (s.withdrawn_at && s.withdrawn_at.slice(0, 10) <= today && (!m || s.withdrawn_at < m) ? s.withdrawn_at : m), null);
  return {
    students: students.map((s) => ({ id: s.id, status: s.status, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at, merged: R.merged.isMergedStudent(s.notes), cleanup: R.bulk.isCleanupExit(s.withdrawal_metadata) })),
    enrollments: enrollments.map((e) => ({ studentId: e.student_id, subject: e.subject ?? null, start: e.start_date, end: e.end_date, transferred: !!e.is_transferred, classId: e.class_id,
      ...(e.on_hold ? { onHold: true } : {}), ...(e.english_track ? { englishTrack: e.english_track } : {}) })),
    firstStart: [...firstStart], ended: [...ended], recordsFrom: firstOut ? firstOut.slice(0, 7) : null,
    fromYear: firstOut ? Number(firstOut.slice(0, 4)) : Number(today.slice(0, 4)),
  };
}
/** 2.0 loadCleanupBilling(trend-billing-server.ts) — 장부 정리 학생의 청구가 살아 있는 달 + 청구가 지점을 덮기 시작한 달. 저장점 안(`sp`)에서만. */
export async function cleanupBilling(sp, R, t, today, searchMonths) {
  const C = R.coverage, thisMonth = today.slice(0, 7);
  const ids = (await sp`select id::text id, withdrawal_metadata from public.students where tenant_id=${t} and status = 'withdrawn' order by id`)
    .filter((s) => R.bulk.isCleanupExit(s.withdrawal_metadata)).map((s) => s.id);
  if (!ids.length) return { billingFrom: null, billed: [] };
  const [[first], rows] = await Promise.all([
    sp`select period from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded') and period like '____-__'
      and period >= ${C.shiftMonth(thisMonth, -(searchMonths - 1))} and period <= ${thisMonth} order by period limit 1`,
    sp`select student_id::text student_id, period, status::text status, category from public.invoices where tenant_id=${t} and student_id = any(${ids}::uuid[]) order by id`]);
  let billingFrom = null;
  if (first?.period && /^\d{4}-\d{2}$/.test(first.period)) {
    const months = [];
    for (let m = first.period; m <= thisMonth && months.length < searchMonths; m = C.shiftMonth(m, 1)) months.push(m);
    // 2.0은 달마다 건수만(head) — 같은 조건으로 한 번에 묶어 센다.
    const counted = new Map((await sp`select period, count(*)::int n from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded')
      and period = any(${months}) group by period`).map((r) => [r.period, r.n]));
    billingFrom = C.coverageStartFromCounts(new Map(months.map((m) => [m, counted.get(m) ?? 0])), thisMonth);
  }
  const byStudent = new Map();
  for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r]);
  return { billingFrom, billed: ids.map((id) => [id, R.billing.billedTuitionMonths(byStudent.get(id) ?? [])]) };
}
/**
 * 2.0 computeRecordCoverage(record-coverage.ts)의 `trustFrom`(에이와 수강 기록이 갖춰진 첫 달) — 추이가 그 달부터 그린다. 저장점 안(`sp`)에서만.
 * '수업을 시작한 등록'(`started` — 등록·퇴원 추이의 등록 칸)은 이 다섯 칸이 쓰지 않아 읽지 않는다. `mark` = 확정값(0386a, 못 읽으면 null).
 */
export async function recordTrustFrom(sp, R, t, today, windowMonths, mark) {
  const C = R.coverage, thisMonth = today.slice(0, 7), windowStart = C.shiftMonth(thisMonth, -(windowMonths - 1));
  const [rawBills, enrollments] = await Promise.all([
    sp`select student_id::text student_id, period from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded')
      and period >= ${C.shiftMonth(windowStart, -2)} and period <= ${thisMonth} order by id`,
    sp`select student_id::text student_id, start_date::text start_date from public.enrollments where tenant_id=${t} and start_date is not null order by id`]);
  const bills = rawBills.filter((b) => !!b.period && /^\d{4}-\d{2}$/.test(b.period));
  const counts = new Map();
  for (const b of bills) if (b.period >= windowStart) counts.set(b.period, (counts.get(b.period) ?? 0) + 1);
  const billingFrom = C.coverageStartFromCounts(counts, thisMonth);
  if (!billingFrom) return null;
  const visible = !(mark && mark.billing_from < windowStart) && (billingFrom > windowStart || !bills.some((b) => b.period < windowStart));
  const firstStart = new Map();
  for (const e of enrollments) if (!firstStart.has(e.student_id) || e.start_date < firstStart.get(e.student_id)) firstStart.set(e.student_id, e.start_date);
  return visible || !mark ? C.trustedFrom(bills, firstStart, billingFrom, thisMonth, windowStart) : mark.trust_from;
}
/**
 * 2.0 loadEnrolledTrend의 계산부 — 월별 점(말일 · 이번 달은 기준일)을 기록이 갖춰진 달부터. 강좌수는 수강 종료가 처음 기록된 달과 둘 중 늦은 쪽부터.
 * `refDay` = 2.0의 '오늘'(장부 정리 청구 판정의 끝 · 강좌수 오늘 점의 휴원 제외) — 늘 복사본 날짜다. 지난 기준일도 같은 선의 그 날짜 점과 같은 규칙으로 센다
 * (기준일을 '오늘'로 넘기면 지난 날짜에 오늘 점 규칙이 걸려 같은 선의 다른 점과 증감 방향이 뒤집힌다).
 */
function enrolledTrends(R, raw, billing, trustFrom, asOf, refDay, subjects) {
  const en = { firstStart: new Map(raw.firstStart), ended: new Set(raw.ended),
    billing: billing?.billingFrom ? { from: billing.billingFrom, today: refDay, months: new Map(billing.billed) } : undefined };
  const months = R.trend.monthlyPoints(asOf);
  const breakdownFrom = raw.enrollments.reduce((m, e) => (e.end && e.end.slice(0, 10) <= refDay && (!m || e.end < m) ? e.end : m), null)?.slice(0, 7) ?? null;
  const courseFrom = !trustFrom ? breakdownFrom : !breakdownFrom ? trustFrom : trustFrom > breakdownFrom ? trustFrom : breakdownFrom;
  return {
    students: R.points.clipTrend(R.trend.trendOf(raw.students, en, months), [], trustFrom).monthly,
    courses: R.points.clipTrend(R.courseTrend.courseTrendOf(raw.students, en, raw.enrollments, months, undefined, refDay, subjects), [], courseFrom).monthly,
  };
}

// ── 퇴원&수업종료 ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 lastClassOf(withdrawals/server/window.ts). */
const lastClassOf = (row) => ({ className: row?.class?.class_name ?? null, subject: row?.class?.subject ?? null, englishTrack: row?.class?.english_track ?? null, reason: row?.withdrawal_reason ?? null });
/** 2.0 getWithdrawalsInWindow(from, to) — 병합 학생은 모집단에서 · 수업 기록 없는 장부 정리 · 시스템 정리는 뺀다. 과목 칸 재료(exitClasses)까지. */
export async function windowWithdrawals(sql, R, t, from, to) {
  const students = (await sql`select id::text id, name, school, grade, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, notes, withdrawal_metadata from public.students
    where tenant_id=${t} and status = 'withdrawn' and withdrawn_at >= ${from} and withdrawn_at <= ${to} order by withdrawn_at desc, id`).filter((s) => !R.merged.isMergedStudent(s.notes));
  if (!students.length) return [];
  const ended = (await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred,
      e.withdrawal_reason, c.class_name, c.subject, c.english_track
    from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
    where e.tenant_id=${t} and e.student_id = any(${students.map((s) => s.id)}::uuid[]) and e.end_date is not null order by e.id`)
    .map((e) => ({ ...e, class: { class_name: e.class_name, subject: e.subject, english_track: e.english_track } }));
  const last = R.win.lastEndedByStudent(ended), byStudent = new Map();
  for (const row of ended) byStudent.set(row.student_id, [...(byStudent.get(row.student_id) ?? []), row]);
  return students.flatMap((s) => {
    const row = last.get(s.id);
    if (R.bulk.isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: !!row })) return [];
    const klass = lastClassOf(row), history = byStudent.get(s.id) ?? [];
    const exitClasses = R.win.withdrawalSubjects(history.map((e) => ({ endDate: e.end_date, subject: lastClassOf(e).subject }))).map((subject) => {
      const lastSubject = lastClassOf(R.win.pickLastEnded(history.filter((e) => lastClassOf(e).subject === subject)) ?? undefined);
      return { subject, englishTrack: lastSubject.englishTrack, className: lastSubject.className };
    });
    const systemBulk = R.bulk.isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory: !!row });
    if (!R.win.inWithdrawalWindow({ withdrawnAt: s.withdrawn_at, systemBulk }, from, to)) return [];
    return [{ id: s.id, name: s.name, enrolledAt: s.enrolled_at ? s.enrolled_at.slice(0, 10) : null, withdrawnAt: (s.withdrawn_at ?? '').slice(0, 10), lastClassName: klass.className, lastClassSubject: klass.subject,
      lastClassEnglishTrack: klass.englishTrack, exitClasses, cleanup: R.bulk.isCleanupExit(s.withdrawal_metadata) }];
  });
}
/**
 * 2.0 getSubjectEndedStudents()의 재료 — 재원·휴원 학생과 그 수강 전부(반 과목이 없는 수강은 뺀다). 판정은 기준일마다 `subjectEnded`.
 * 지난 날짜용으로 `from` 뒤에 퇴원한 학생(병합 제외)도 싣는다 — 그 날짜엔 재원이었다. `firstCreatedMs` = 지점의 첫 수강이 만들어진 때
 * (그 전 날짜엔 생성 시각 컷을 걸지 않는다 — 첫 묶음은 옛 기록을 한꺼번에 옮긴 것이라 생성 시각이 그 수강이 생긴 때가 아니다).
 */
export async function subjectEndedInputs(sql, R, t, from) {
  const [students, enrollments, [{ first }]] = await Promise.all([
    sql`select id::text id, name, school, grade, status::text status, withdrawn_at::text withdrawn_at, notes, withdrawal_metadata from public.students
      where tenant_id=${t} and (status in ('enrolled', 'on_hold') or (status = 'withdrawn' and withdrawn_at > ${from})) order by id`,
    sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.withdrawal_reason,
        to_json(e.created_at)#>>'{}' created_at, c.subject, c.class_name, c.english_track, c.is_special
      from public.enrollments e join public.students s on s.id = e.student_id and s.tenant_id = ${t}
        and (s.status in ('enrolled', 'on_hold') or (s.status = 'withdrawn' and s.withdrawn_at > ${from}))
      left join public.classes c on c.id = e.class_id and c.tenant_id = ${t} where e.tenant_id=${t} order by e.id`,
    sql`select to_json(min(created_at))#>>'{}' first from public.enrollments where tenant_id=${t}`]);
  const bySt = new Map();
  for (const e of enrollments) {
    if (!e.subject) continue;
    bySt.set(e.student_id, [...(bySt.get(e.student_id) ?? []), { id: e.id, classId: e.class_id, subject: e.subject, startDate: e.start_date, endDate: e.end_date,
      isTransferred: e.is_transferred ?? undefined, isSpecial: R.special.isSpecialLecture({ isSpecial: e.is_special, className: e.class_name }),
      className: e.class_name ?? null, englishTrack: e.english_track ?? null, reason: e.withdrawal_reason ?? null, createdMs: Date.parse(e.created_at) }]);
  }
  return { students: students.filter((s) => s.status !== 'withdrawn' || !R.merged.isMergedStudent(s.notes)).map((s) => ({ ...s, cleanup: R.bulk.isCleanupExit(s.withdrawal_metadata) })),
    bySt, firstCreatedMs: first ? Date.parse(first) : null };
}
/**
 * 2.0 getSubjectEndedStudents()의 판정부(kstToday 자리 = `today`) — 운영실 칸이 쓰는 값(과목마다 끝난 날·마지막 반·반이동 여부)만.
 * `past`(복사본 날짜 전) = 그날 뒤에 퇴원한 학생도 그날 재원생으로 넣는다(`trend`면 단체 장부 정리 퇴원생은 빼고 — 추세선 규칙).
 * `cutMs` = 그 시각 뒤에 만든 수강은 뺀다(null이면 컷 없음). 둘 다 없으면(복사본 날짜) 2.0 칸 그대로 재원·휴원만.
 */
export function subjectEnded(R, { students, bySt }, today, { past = false, cutMs = null, trend = false } = {}) {
  const rows = [];
  for (const s of students) {
    if (s.status === 'withdrawn' && !(past && s.withdrawn_at?.slice(0, 10) > today && !(trend && s.cleanup))) continue;
    const all = (bySt.get(s.id) ?? []).filter((e) => cutMs === null || e.createdMs <= cutMs), enr = all.filter((e) => R.ended.countsForSubjectExit(e, today));
    const lastEndOf = (subject) => all.reduce((m, e) => (e.subject === subject && e.endDate && (!m || e.endDate > m) ? e.endDate : m), null);
    const { ended } = R.ended.getEndedSubjects(enr, today);
    if (!ended.length) continue;
    rows.push({ id: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status, endedDetail: ended.map((subject) => {
      const best = R.win.pickLastEnded(enr.filter((e) => e.subject === subject).map((e) => ({ ...e, end_date: e.endDate, start_date: e.startDate, is_transferred: e.isTransferred })));
      return { subject, endedAt: lastEndOf(subject) ?? best?.endDate ?? null, className: best?.className ?? null, englishTrack: best?.englishTrack ?? null, isTransferred: best?.isTransferred === true };
    }) });
  }
  return rows;
}
/**
 * 2.0 monthWithdrawals — 그 달 1일 ~ min(말일, 기준일)의 퇴원(과목마다 한 줄) + 과목 전체 종료. 칸 숫자 = 줄 수(countWithdrawalPrograms().total).
 * `win`({ from, to })을 주면 그 창으로 — 운영실 흐름(확장 추세)이 같은 판정을 아무 창에나 돌린다(v2-dashboard-flow-students.mjs).
 */
export function monthWithdrawalRows(R, withdrawn, ended, today, subjects, win = R.win.withdrawalMonthWindow(today.slice(0, 7), today)) {
  return R.exits.includeSubjectEnds(withdrawn.filter((row) => R.win.inWithdrawalWindow({ withdrawnAt: row.withdrawnAt, systemBulk: false }, win.from, win.to))
    .flatMap((row) => (row.exitClasses.length ? row.exitClasses : [{ subject: row.lastClassSubject, englishTrack: row.lastClassEnglishTrack, className: row.lastClassName }]).map((klass) => ({
      id: row.id, eventKey: `${row.id}|${klass.subject ?? 'unknown'}`, name: row.name, schoolGrade: null, withdrawnAt: row.withdrawnAt, className: klass.className ?? undefined,
      subject: klass.subject, program: R.win.withdrawalProgram({ lastClassSubject: klass.subject, lastClassEnglishTrack: klass.englishTrack }, subjects) }))),
  ended, win, subjects, () => null);
}

// ── 이달 신규(콜&상담 '등록 완료') ──────────────────────────────────────────────────────────────────────────────────────
/**
 * 2.0 getEnrolledRecent의 재료를 가장 넓은 창 [lo, hi)로 한 번에 — 상태 변경 기록(등록 완료로 옮김) + 반 배정으로 '등록 완료' 칸에 선 상담의 후보와 그 학생의 수강.
 * 창마다 `enrolledIn`이 2.0 판정으로 다시 센다(넓은 창의 후보는 좁은 창 후보를 다 품는다 — 창 안에 선 때는 창 안 접수이거나 창 안 반 배정이다).
 */
export async function enrolledInputs(sql, R, t, lo, hi, subjects) {
  const [logs, [{ first }], assignedInWindow, consultsInWindow] = await Promise.all([
    sql`select metadata, to_json(created_at)#>>'{}' created_at from public.audit_logs where tenant_id=${t} and action = ${OUTCOME_ACTION} and metadata->>'to' = 'enrolled'
      and created_at >= ${lo} and created_at < ${hi} order by created_at, id`,
    sql`select to_json(min(created_at))#>>'{}' first from public.audit_logs where tenant_id=${t} and action = ${OUTCOME_ACTION}`,
    sql`select distinct student_id::text student_id from public.enrollments where tenant_id=${t} and created_at >= ${lo} and created_at < ${hi} order by 1`,
    sql`select id::text id, subject, student_id::text student_id, outcome::text outcome, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations
      where tenant_id=${t} and outcome::text <> 'enrolled' and student_id is not null and created_at >= ${lo} and created_at < ${hi} order by id`]);
  const moved = [...R.outcome.enrollmentEventTimes(logs).keys()];
  const [outcomes, ofStudents] = await Promise.all([
    moved.length ? sql`select id::text id, outcome::text outcome, subject from public.enrollment_consultations where tenant_id=${t} and id = any(${moved}::uuid[]) order by id` : [],
    assignedInWindow.length ? sql`select id::text id, subject, student_id::text student_id, outcome::text outcome, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations
      where tenant_id=${t} and outcome::text <> 'enrolled' and student_id = any(${assignedInWindow.map((r) => r.student_id)}::uuid[]) order by id` : []]);
  const consults = new Map([...consultsInWindow, ...ofStudents].map((c) => [c.id, c]));
  const studentIds = [...new Set([...consults.values()].map((c) => c.student_id))];
  const enrollments = studentIds.length ? await sql`select e.student_id::text student_id, to_json(e.created_at)#>>'{}' created_at, e.end_date::text end_date, c.subject
    from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t} where e.tenant_id=${t} and e.student_id = any(${studentIds}::uuid[]) order by e.id` : [];
  const byStudent = new Map();
  for (const e of enrollments) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), { subject: e.subject ?? null, createdAt: e.created_at, endDate: e.end_date }]);
  return { logs, firstLog: first, enrolledNow: new Set(outcomes.filter((c) => c.outcome === 'enrolled').map((c) => c.id)),
    movedSubject: new Map(outcomes.map((c) => [c.id, c.subject ?? null])), consults: [...consults.values()], byStudent,
    classKeysOf: R.consult.consultClassKeysOf(subjects) };
}
/**
 * [lo, hi) 안에 '등록 완료'가 된 상담 — 2.0 getEnrolledRecent(상태 로그 쪽 · 지금도 등록 완료) + assignedEntries(반 배정 쪽 · kstToday 자리 = `day`).
 * 돌려줌 = `[{ id, subject }]`(상담 id · 상담 과목 글자 — 확장 추세의 과목별 줄). 상태 로그 쪽 과목은 `enrolledInputs`가 읽은 상담에서 찾는다.
 */
export function enrolledItemsIn(R, d, lo, hi, day) {
  const loMs = Date.parse(lo), hiMs = Date.parse(hi), inside = (iso) => { const x = Date.parse(iso); return x >= loMs && x < hiMs; };
  const viaLog = [...R.outcome.enrollmentEventTimes(d.logs.filter((l) => inside(l.created_at))).keys()].filter((id) => d.enrolledNow.has(id))
    .map((id) => ({ id, subject: d.movedSubject.get(id) ?? null }));
  const viaAssignment = d.consults.filter((c) => {
    const at = R.recent.assignedEntryAt({ consultCreatedAt: c.created_at, classKeys: d.classKeysOf(c.subject), enrollments: d.byStudent.get(c.student_id) ?? [], today: day });
    return !!at && inside(at);
  }).map((c) => ({ id: c.id, subject: c.subject ?? null }));
  return [...viaLog, ...viaAssignment];
}
const enrolledIn = (R, d, lo, hi, day) => enrolledItemsIn(R, d, lo, hi, day).length;

// ── 묶기 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const yymm = (m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;
const lastDayOf = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function compute({ sql: tx, asOf, tenantId: t, importV2 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error(`기준일 형식이 아닙니다: ${asOf}`);
  const sql = queryGate(tx);
  const load = importV2 ?? (await import('./v2-bridge.mjs')).importV2;
  const [R, clock, C, { kpi, weekWindows }] = await Promise.all([rules(load), copyClock(), consts(), import('./domain-snapshot-core.mjs')]);
  if (asOf > clock.day) throw new Error(`기준일이 복사본 날짜(${clock.day}) 뒤입니다: ${asOf}`);
  const settings = await tenantSettings(sql, t, load);
  const subjects = settings.operations.subjects, sliceSubjects = subjects.map((s) => ({ key: s.key, label: s.label }));
  // 창의 끝 = 그날 복사본을 뜬 시각(같은 시각끼리 견준다 · 복사본 날짜는 복사본을 뜬 순간). 기준일이 지난 날짜여도 복사본 날짜에서 거꾸로 센다.
  const at = (d) => new Date(clock.at.getTime() - (Date.parse(`${clock.day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`))).toISOString();
  const dayStart = (d) => R.bounds.kstDayBounds(d).startIso, today = R.bounds.kstDayBounds(asOf);
  // 달 창 = 1일 ~ 같은 날(그 달에 없는 날이면 말일) — 2.0 등록·퇴원 추이와 같은 6개월.
  const months = R.model.monthKeys(asOf).map((m) => { const same = `${m}-${asOf.slice(8, 10)}`, end = lastDayOf(m); return { month: m, day: same > end ? end : same, label: yymm(m) }; });
  const weeks = weekWindows(asOf, 8);

  // 저장점 조회(2.0이 삼키는 것)는 하나씩 — 확정값 → 기록 범위 → 장부 정리 청구(실패하면 2.0처럼 자르지 않음 · 퇴원일 규칙).
  // 기록 범위·장부 정리 청구는 복사본 날짜로 판정한다(복사본이 아는 사실 · 지난 기준일도 같은 선의 점과 같은 값).
  const mark = await sql.soft(async (sp) => (await sp`select billing_from, trust_from from public.record_coverage_marks where tenant_id=${t}`)[0] ?? null, null);
  const trustFrom = await sql.soft((sp) => recordTrustFrom(sp, R, t, clock.day, C.coverage, mark), null);
  const billing = await sql.soft((sp) => cleanupBilling(sp, R, t, clock.day, C.search), null);
  const pastDay = asOf < clock.day;
  const [cards, raw, withdrawn, endedIn, enrolled, intake] = await Promise.all([
    // 지난 기준일엔 칸 조회(지금 '재원' 상태로 센다)가 그날을 되감지 못한다 — 아래에서 추이의 그날 점(칸 뜻을 그날로 되감은 값)을 쓴다.
    pastDay ? null : enrolledCards(sql, R, t, asOf, subjects),
    trendRaw(sql, R, t, clock.day),
    windowWithdrawals(sql, R, t, `${months[0].month}-01`, asOf),
    subjectEndedInputs(sql, R, t, `${months[0].month}-01`),
    // 재료 = 첫 주 창과 이번 달 1일 중 이른 날 ~ 기준일 끝(2.0 칸은 그날 하루 전체 · 창은 아래에서 같은 시각까지 자른다).
    enrolledInputs(sql, R, t, dayStart(weeks[0].from < `${asOf.slice(0, 7)}-01` ? weeks[0].from : `${asOf.slice(0, 7)}-01`), today.endIso, subjects),
    // 신규문의 점 = 상담일(2.0 '신규 문의 추이'와 같은 축 — 7월·8월에 옮겨 넣은 옛 상담 2천여 건이 입력한 날로 몰리지 않게 · 앱에서 넣은 상담은
    // 상담일 = 입력 시각) · 2.0 칸 '오늘 접수'만 입력 시각(그날 들어온 것)으로 따로 센다.
    Promise.all([sql`select to_json(min(consulted_at))#>>'{}' first from public.enrollment_consultations where tenant_id=${t}`,
      sql`select to_json(consulted_at)#>>'{}' consulted_at from public.enrollment_consultations where tenant_id=${t}
        and consulted_at >= ${dayStart(weeks[0].from)} and consulted_at < ${today.endIso} order by consulted_at, id`,
      sql`select count(*)::int n from public.enrollment_consultations where tenant_id=${t} and created_at >= ${today.startIso} and created_at < ${today.endIso}`]),
  ]);
  const trends = enrolledTrends(R, raw, billing, trustFrom, asOf, clock.day, sliceSubjects);
  // 칸 숫자 = 2.0 칸 그대로 · 추세 점 = 사유 없는 단체 장부 정리 퇴원을 뺀다(2.0 추세선 규칙, 원장 2026-10-20 *"단체로 장부 정리한 건에 대해서는 추세선에서
  // 배제시킬것"* — 퇴원일이 장부 날짜라 그 달에 몰려 보인다). 장부 정리 퇴원이 없으면 마지막 점 = 칸 숫자(지난 기준일엔 그 뒤 퇴원한 장부 정리 학생의
  // 수업종료도 칸에만 든다).
  // 지난 날짜의 수업종료: 그날 뒤 퇴원생 포함 · 수강 생성 시각 컷은 지점의 첫 수강 생성 뒤 날짜에만(그 전은 옮겨 온 옛 기록뿐이다).
  const exitsOf = (day, trend = false) => {
    const past = day < clock.day, cut = Date.parse(at(day));
    const ended = subjectEnded(R, endedIn, day, { past, trend, cutMs: past && endedIn.firstCreatedMs !== null && cut >= endedIn.firstCreatedMs ? cut : null });
    return monthWithdrawalRows(R, trend ? withdrawn.filter((row) => !row.cleanup) : withdrawn, ended, day, subjects);
  };
  const exitRows = exitsOf(asOf);
  const [[{ first: intakeFirst }], intakeRows, [{ n: intakeToday }]] = intake;
  const intakeMs = intakeRows.map((r) => Date.parse(r.consulted_at));
  const countIn = (lo, hi) => intakeMs.filter((x) => x >= Date.parse(lo) && x < Date.parse(hi)).length;
  // 2.0 칸 값: 신규문의 '오늘 접수'(위 — 그날 입력된 상담) · 이달 신규(이번 달 1일 ~ 오늘).
  const enrolledMonth = enrolledIn(R, enrolled, dayStart(`${asOf.slice(0, 7)}-01`), today.endIso, asOf);

  const point = (label, value) => ({ label, value });
  // 재원생·강좌수 오늘 점 = 칸 값(2.0 규약 '오늘 점 = 칸' — 미래 시작 새 수강만 남은 학생처럼 둘이 갈리는 드문 경우도 칸을 따른다).
  const thisMonth = asOf.slice(0, 7);
  const withToday = (pts, card) => [...pts.filter((p) => p.key < thisMonth).map((p) => point(yymm(p.key), p.count)), point(yymm(thisMonth), card)];
  const todayOf = (pts) => pts.find((p) => p.key === thisMonth)?.count ?? null;
  const studentsCard = pastDay ? todayOf(trends.students) : cards.students, coursesCard = pastDay ? todayOf(trends.courses) : cards.courses;
  const withdrawalsCard = R.win.countWithdrawalPrograms(exitRows).total;
  const exitsKpi = kpi('퇴원·수업종료', '명', months.map((w) => point(w.label, R.win.countWithdrawalPrograms(exitsOf(w.day, true)).total)),
    { id: 'exits', better: 'down', period: 'month', span: '이번 달',
      basis: '그 달 퇴원한 학생과 한 과목을 모두 끝낸 학생(과목마다 한 번) · 큰 숫자는 단체 장부 정리 퇴원도 셈 · 추세선과 전월 대비는 빼고 셈 · 달마다 1일부터 같은 날까지' });
  const kpis = [
    kpi('재원생', '명', withToday(trends.students, studentsCard),
      { id: 'enrolled-students', better: 'up', period: 'month', span: '오늘 기준', basis: '재원 학생(반 수업이 모두 아직 시작 전인 학생은 뺌) · 지난달까지는 그 달 말일 기준' }),
    kpi('강좌수', '개', withToday(trends.courses, coursesCard),
      { id: 'courses', better: 'up', period: 'month', span: '오늘 기준', basis: '재원생이 듣는 과목 수(한 학생이 같은 과목 반을 여럿 들어도 하나) · 지난달까지는 그 달 말일 기준' }),
    // 큰 숫자만 칸 값 — 전월 대비(previous·delta)는 kpi()가 센 추세 점끼리 그대로(선의 점 팝오버와 같은 비교).
    { ...exitsKpi, value: withdrawalsCard },
    kpi('신규문의', '건', weeks.map((w) => {
      const lo = dayStart(w.from);
      // 콜&상담 기록이 시작되기 전에 시작한 창은 '기록 없음'.
      return point(w.label, !intakeFirst || Date.parse(lo) < Date.parse(intakeFirst) ? null : countIn(lo, at(w.to)));
    }), { id: 'intake', better: 'up', period: 'week', span: '최근 7일', basis: '상담일이 그 7일 안인 신규 콜&상담 · 날마다 같은 시각까지 셈' }),
    kpi('신규 등록', '명', weeks.map((w) => {
      const lo = dayStart(w.from);
      // 상태 변경 기록이 남기 전에 시작한 창은 '기록 없음'.
      return point(w.label, !enrolled.firstLog || Date.parse(lo) < Date.parse(enrolled.firstLog) ? null : enrolledIn(R, enrolled, lo, at(w.to), w.to));
    }), { id: 'new-enrollments', better: 'up', period: 'week', span: '최근 7일', basis: '그 7일 동안 등록 완료가 된 신규 콜&상담(반 배정으로 등록된 것 포함) · 날마다 같은 시각까지 셈' }),
  ];
  return { asOf, kpis, months, weeks, trustFrom,
    // 추이가 스스로 센 기준일 점(시험·대조용) — 2.0 규약은 '오늘 점 = 칸'이고, 둘이 갈리면 2.0이 아는 드문 경우다.
    trendToday: { students: todayOf(trends.students), courses: todayOf(trends.courses) },
    // 2.0 운영실 칸 값 그대로(시험·대조용) — 재원생 · 강좌수 · 퇴원&수업종료 · 신규문의(오늘) · 이달 신규.
    cards: { students: studentsCard, courses: coursesCard, withdrawals: withdrawalsCard, intakeToday, enrolledMonth } };
}

const memo = new WeakMap();
/**
 * 원생 현황 KPI 다섯 개(kpi() 카드 모양) + 2.0 칸 값(`cards`)·창. `asOf` = 복사본 기준일(2.0 kstToday 자리). `sql` = 읽기 전용 트랜잭션.
 * 같은 트랜잭션에서 두 번 부르면 한 번만 계산한다(실패는 기억하지 않는다).
 * ⚠️ 같은 트랜잭션의 다른 조회와 `Promise.all`로 나란히 부르지 말 것 — 안의 저장점 조회가 실패하면 나란히 돌던 조회까지 25P02로 깨진다(따로 await).
 */
export function studentStatusKpis({ sql, asOf, tenantId = COPY_TENANT, importV2 }) {
  const key = `${tenantId}|${asOf}`, m = memo.get(sql) ?? new Map();
  if (!memo.has(sql)) memo.set(sql, m);
  if (!m.has(key)) m.set(key, compute({ sql, asOf, tenantId, importV2 }).catch((e) => { m.delete(key); throw e; }));
  return m.get(key);
}
