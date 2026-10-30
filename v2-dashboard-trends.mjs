// 2.0 운영실 영역(1단계 · 추이) — 재원생 추이 · 강좌수 추이 · 등록·퇴원 추이(월별 증감).
// 2.0 loadEnrolledTrend(enrolled-trend-server.ts — 월별 12개월 · 연도별 · 강좌수) · computeRecordCoverage(record-coverage.ts) · loadMonthlyChanges(server.ts)를
// 같은 표·같은 조건의 SQL과 2.0 순수 함수로. 원생·수강 원본과 장부 정리 청구는 원생 현황 KPI(v2-student-kpis.mjs)와 같은 조회를 쓴다.
// 2.0은 이 셋을 5분 캐시에 담지만(B6) 복사본은 바뀌지 않으니 캐시 없이 한 번 센다. 재료 실패는 2.0처럼 경고 자리 — 청구·기록 범위를 못 읽으면 그 규칙 없이 센다.
import { queryGate } from './v2-onescreen-roster.mjs';
import { trendRaw, cleanupBilling, rules as kpiRules, consts } from './v2-student-kpis.mjs';
import { withdrawalRows } from './v2-dashboard-students.mjs';

const ATTENDED = ['present', 'late', 'early_leave', 'makeup']; // 2.0 record-coverage.ts ATTENDED_STATUSES
let extraP = null;
async function extra(importV2) {
  extraP ??= importV2('features/attendance/effective-records.ts').catch((e) => { extraP = null; throw e; });
  return extraP;
}
async function shared(ctx, key, fn) {
  if (!ctx.memo.has(key)) ctx.memo.set(key, await fn());
  return ctx.memo.get(key);
}

/** 2.0 computeRecordCoverage — 청구가 지점을 덮기 시작한 달 · 그 뒤 등록 중 수업을 시작한 학생 · 에이와 기록이 갖춰진 첫 달. 실패하면 null(2.0 warnCoverage). */
export function recordCoverage(ctx, gate) {
  return shared(ctx, 'coverage', () => gate.soft(async (sp) => {
    const [R, E, C0] = await Promise.all([kpiRules(ctx.importV2), extra(ctx.importV2), consts()]);
    const C = R.coverage, t = ctx.t, today = ctx.today, thisMonth = today.slice(0, 7), windowStart = C.shiftMonth(thisMonth, -(C0.coverage - 1));
    // 확정값(0386a)은 못 읽으면 '없음'으로 넘어간다(2.0 readCoverageMark) — 이 조회만 따로 가둔다.
    const mark = await queryGate(sp).soft(async (s) => (await s`select billing_from, trust_from from public.record_coverage_marks where tenant_id=${t}`)[0] ?? null, null);
    const [rawBills, registered, enrollments] = await Promise.all([
      sp`select student_id::text student_id, period from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded')
        and period >= ${C.shiftMonth(windowStart, -2)} and period <= ${thisMonth} order by id`,
      sp`select id::text id, enrolled_at::text enrolled_at from public.students where tenant_id=${t} and enrolled_at is not null and enrolled_at <= ${today} order by id`,
      sp`select student_id::text student_id, start_date::text start_date, end_date::text end_date, on_hold from public.enrollments where tenant_id=${t} and start_date is not null order by id`]);
    const bills = rawBills.filter((b) => !!b.period && /^\d{4}-\d{2}$/.test(b.period));
    const counts = new Map();
    for (const b of bills) if (b.period >= windowStart) counts.set(b.period, (counts.get(b.period) ?? 0) + 1);
    const billingFrom = C.coverageStartFromCounts(counts, thisMonth);
    if (!billingFrom) return { billingFrom: null, started: [], trustFrom: null, visible: false };
    const visible = !(mark && mark.billing_from < windowStart) && (billingFrom > windowStart || !bills.some((b) => b.period < windowStart));
    const firstStart = new Map();
    for (const e of enrollments) if (e.start_date && (!firstStart.has(e.student_id) || e.start_date < firstStart.get(e.student_id))) firstStart.set(e.student_id, e.start_date);
    const billMonths = C.groupBy(bills, (b) => b.student_id, (b) => b.period);
    const classSpans = C.groupBy(enrollments.filter((e) => !!e.start_date && !e.on_hold), (e) => e.student_id, (e) => ({ start: e.start_date, end: e.end_date }));
    const judged = registered.filter((s) => s.enrolled_at.slice(0, 7) >= billingFrom).map((s) => ({ id: s.id, enrolledAt: s.enrolled_at }));
    const none = new Map();
    const rest = judged.filter((r) => !C.billedBeforeRegistration(r, billMonths) && !C.startedRegistration(r, { billMonths, attendedOn: none, classSpans }, today));
    const since = rest.reduce((m, r) => (!m || r.enrolledAt < m ? r.enrolledAt : m), null);
    let attendedOn = none;
    if (since) {
      // 출석한 날 — 정정은 새 줄로 쌓이므로 칸마다 최신 기록만 남긴 뒤 상태를 본다(2.0 attendedDays).
      const rows = await sp`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status,
          to_json(recorded_at)#>>'{}' recorded_at
        from public.attendance_records where tenant_id=${t} and student_id = any(${rest.map((r) => r.id)}::uuid[]) and session_date >= ${since.slice(0, 10)} order by id`;
      attendedOn = C.groupBy(E.effectiveAttendanceRecords(rows).filter((r) => ATTENDED.includes(r.status)), (r) => r.student_id, (r) => r.session_date);
    }
    const ev = { billMonths, attendedOn, classSpans };
    return { billingFrom, started: judged.filter((r) => C.startedRegistration(r, ev, today)).map((r) => r.id),
      trustFrom: visible || !mark ? C.trustedFrom(bills, firstStart, billingFrom, thisMonth, windowStart) : mark.trust_from, visible };
  }, null));
}

/** 2.0 loadEnrolledTrend — 재원생·강좌수 추이. 강좌수의 앞쪽 달은 수납 권한이 있을 때 지난 기록으로 잇는다. */
function enrolledTrend(ctx, gate) {
  return shared(ctx, 'enrolledTrend', async () => {
    const [R, C0] = await Promise.all([kpiRules(ctx.importV2), consts()]), today = ctx.today, t = ctx.t;
    const subjects = ctx.settings.operations.subjects;
    const modules = await ctx.importV2('lib/modules.ts');
    const splitEnglish = modules.isModuleEnabled(ctx.settings.modules.disabled, 'eie');
    const billing = await gate.soft((sp) => cleanupBilling(sp, R, t, today, C0.search), null);
    const coverage = await recordCoverage(ctx, gate);
    const trustFrom = coverage?.trustFrom ?? null;
    const raw = await trendRaw(gate, R, t, today);
    const en = { firstStart: new Map(raw.firstStart), ended: new Set(raw.ended),
      billing: billing?.billingFrom ? { from: billing.billingFrom, today, months: new Map(billing.billed) } : undefined };
    const months = R.trend.monthlyPoints(today), years = R.trend.yearlyPoints(today, raw.fromYear);
    const clipped = R.points.clipTrend(R.trend.trendOf(raw.students, en, months), R.trend.trendOf(raw.students, en, years), trustFrom);
    // 강좌수 자르기 — 2.0 clipCourses(실제로 자른 경계가 무엇인지 `cutBy`).
    const breakdownFrom = raw.enrollments.reduce((m, e) => (e.end && e.end.slice(0, 10) <= today && (!m || e.end < m) ? e.end : m), null)?.slice(0, 7) ?? null;
    const from = !trustFrom ? breakdownFrom : !breakdownFrom ? trustFrom : trustFrom > breakdownFrom ? trustFrom : breakdownFrom;
    const c = R.points.clipTrend(R.courseTrend.courseTrendOf(raw.students, en, raw.enrollments, months, undefined, today, subjects, splitEnglish),
      R.courseTrend.courseTrendOf(raw.students, en, raw.enrollments, years, undefined, today, subjects, splitEnglish), from);
    const courses = { ...c, cutBy: !c.trustFrom ? null : from === trustFrom ? 'trust' : 'records' };
    return { ...clipped, recordsFrom: raw.recordsFrom, courses };
  });
}

/** '재원생 추이' 카드 — 강좌수는 싣지 않는다(2.0 withoutCourses · '강좌수 추이' 카드가 따로 읽는다). */
async function enrolledTrendArea(ctx, sp) {
  const t = await enrolledTrend(ctx, queryGate(sp));
  return { monthly: t.monthly, yearly: t.yearly, recordsFrom: t.recordsFrom, trustFrom: t.trustFrom, monthlyFrom: t.monthlyFrom };
}
async function courseTrendArea(ctx, sp) {
  const gate = queryGate(sp);
  const trend = (await enrolledTrend(ctx, gate)).courses ?? null;
  if (!trend || !ctx.allowed.includes('billing')) return trend;
  // 2.0은 수납 메뉴를 볼 수 있는 사람의 학원 전체 강좌 추이에만 지난 기록을 잇는다.
  const rows = await gate.soft(s => s`select month::text month, source::text source, data from public.student_history_monthly
    where tenant_id=${ctx.t} order by month limit 400`, null);
  if (!rows) return trend;
  const [history, courseHistory, program, modules] = await Promise.all([
    ctx.importV2('features/students/stats/history.ts'), ctx.importV2('features/dashboard/overview/course-history.ts'),
    ctx.importV2('features/students/enrollment/program.ts'), ctx.importV2('lib/modules.ts'),
  ]);
  const subjects = ctx.settings.operations.subjects;
  const splitEnglish = modules.isModuleEnabled(ctx.settings.modules.disabled, 'eie') && !subjects.some(s => program.isEnglishProgramKey(s.key));
  const groups = [...new Set(subjects.map(s => program.subjectGroupOf(s.key, subjects)).filter(Boolean))]
    .flatMap(g => g === 'english' && splitEnglish ? [...program.ENGLISH_PROGRAM_KEYS] : [g]);
  return courseHistory.withCourseHistory(trend, history.mergeHistory(rows.map(r => ({ ...r, month: r.month.slice(0, 7) }))), groups, ctx.today);
}

/**
 * 2.0 loadMonthlyChanges(today, scope null, withdrawalRows, withSubjects false, 6, true, coverage) — 최근 6개월 등록·퇴원.
 * 등록 = 상태를 보지 않고 그 기간 등록일(병합 · 수업 기록 없는 장부 정리 제외 · 청구가 덮은 달 이후 등록은 수업을 시작한 등록만) ·
 * 퇴원 = 퇴원 KPI와 같은 행에서 단체 장부 정리를 빼고 수업료를 낸 마지막 달로 센 것.
 */
async function changes(ctx, sp) {
  const gate = queryGate(sp), R = await kpiRules(ctx.importV2), t = ctx.t, today = ctx.today;
  const fromDate = `${R.model.monthKeys(today, 6)[0]}-01`;
  const counted = (await gate`select id::text id, enrolled_at::text enrolled_at, notes, withdrawal_metadata from public.students where tenant_id=${t} and enrolled_at >= ${fromDate} order by id`)
    .filter((r) => !R.merged.isMergedStudent(r.notes));
  // 2.0 bookkeepingOnlyIds — 장부 정리 메모가 붙은 행만 끝난 수강을 본다.
  const candidates = [...new Map(counted.filter((r) => R.bulk.isCleanupExit(r.withdrawal_metadata)).map((r) => [r.id, r])).values()];
  const withHistory = new Set(candidates.length ? (await gate`select distinct student_id::text student_id from public.enrollments where tenant_id=${t}
    and student_id = any(${candidates.map((r) => r.id)}::uuid[]) and end_date is not null`).map((r) => r.student_id) : []);
  const bookkeeping = new Set(candidates.filter((r) => R.bulk.isBookkeepingOnlyExit({ withdrawalMetadata: r.withdrawal_metadata, hasEnrollmentHistory: withHistory.has(r.id) })).map((r) => r.id));
  const [withdrawn, range] = [await withdrawalRows(ctx, gate), await recordCoverage(ctx, gate)];
  const started = range?.billingFrom ? new Set(range.started) : null;
  const isStarted = (id, enrolledAt) => !started || !enrolledAt || enrolledAt.slice(0, 7) < range.billingFrom || started.has(id);
  const joined = counted.filter((r) => !bookkeeping.has(r.id) && isStarted(r.id, r.enrolled_at));
  const startedFrom = started ? range.billingFrom : null;
  return R.model.monthlyChanges(today, joined.map((r) => r.enrolled_at), withdrawn.filter((r) => !r.cleanup).map((r) => r.exitDate), 6)
    .map((r) => (startedFrom && r.month >= startedFrom ? { ...r, startedOnly: true } : r));
}

export const TREND_AREAS = { changes, enrolledTrend: enrolledTrendArea, courseTrend: courseTrendArea };
