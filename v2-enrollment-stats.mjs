// 2.0 신규 콜&상담 · 통계 보기(app/(shell)/enrollment/page.tsx `view=stats`) — 페이지가 서버에서 받던 값을 Docker 복사본에서 같은 결과로.
// · getStatsYears · getEnrollmentStats(DB 함수 consultation_monthly_stats · consultation_path_stats — 2.0과 같은 함수를 그대로 부른다) ·
//   getConsultationDistribution(학년·지역·학교 · 관리현황 · 등록 뒤 원생) · loadAttendingCounter(관리현황 '지금 재원' = 원생목록 재원 판정) ·
//   loadIntakeTrend(신규 문의 추이) · loadOpsHistory(상담 진행 기록 — 매일 기록 표) · getWithdrawalsInWindow(관리현황 '등록 후 퇴원' — 운영실 퇴원과 같은 함수,
//   v2-student-kpis.mjs windowWithdrawals). 집계·판정은 2.0 순수 함수(importV2) 그대로.
// · 기간 = page.tsx와 같은 해석(연도 칩 · 신규 문의 추이 trend… · 진행 기록 pg…) — 계정 보기 설정이 없어 저장된 보기 방식은 기본값(진행 기록 = 최근 구간).
// · DB 함수는 지점을 로그인한 사람으로 가린다(auth_tenant_id) — 읽기 트랜잭션 안에서만 고른 사람의 신분(request.jwt.claims)을 싣고 부른다.
// · 읽기 전용 · 바깥 호출 없음.
import { rules as kpiRules, windowWithdrawals } from './v2-student-kpis.mjs';

const MODULES = { kst: 'lib/date-kst.ts', bounds: 'features/enrollment/kst-bounds.ts', range: 'features/enrollment/range.ts', path: 'features/enrollment/path-bucket.ts',
  sheet: 'features/enrollment/management-sheet.ts', groups: 'features/enrollment/intake-groups.ts', dist: 'features/enrollment/consultation-dist.ts',
  school: 'features/schools/school-name.ts', subj: 'features/enrollment/consult-subject.ts', comp: 'features/students/enrollment/enrolled-composition.ts',
  itrend: 'features/enrollment/intake-trend.ts', period: 'features/stats/period.ts', opsKeys: 'features/students/stats/ops-keys.ts', view: 'features/enrollment/view-pref.ts',
  prefs: 'features/enrollment/school-view-prefs.ts' };
let rulesP = null;
export function statsRules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

const yearOfIso = (iso) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date(iso)));
const kstMonthOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7);
/** 2.0 stats-queries kstMonthStartIso(year, month0). */
const monthStartIso = (year, month0) => new Date(Date.UTC(year, month0, 1, -9, 0, 0)).toISOString();
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** getStatsYears — 데이터가 있는 연도(최신부터). */
export async function getStatsYears(sql, R, t) {
  const [row] = await sql`select to_json(min(consulted_at))#>>'{}' first, to_json(max(consulted_at))#>>'{}' last from public.enrollment_consultations where tenant_id = ${t}`;
  const from = row?.first ? yearOfIso(row.first) : R.kst.kstYear(), to = row?.last ? yearOfIso(row.last) : R.kst.kstYear();
  const out = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

function toMonthStat(r) {
  const total = Number(r.total), enrolled = Number(r.enrolled);
  return { month: r.month, total, enrolled, declined: Number(r.declined), noShow: Number(r.no_show), open: Number(r.open_cnt), paidSum: Number(r.paid_sum),
    rate: total > 0 ? Math.round((enrolled / total) * 100) : null };
}
function fillMonths(rows, startY, startM0, count) {
  const byKey = new Map(rows.map((r) => [r.month, r]));
  const out = [];
  for (let i = 0; i < count; i++) {
    const key = monthKey(new Date(startY, startM0 + i, 1));
    out.push(byKey.get(key) ?? { month: key, total: 0, enrolled: 0, declined: 0, noShow: 0, open: 0, paidSum: 0, rate: null });
  }
  return out;
}

/** getEnrollmentStats(year, span) — 2.0 DB 함수를 같은 경계로. */
export async function getEnrollmentStats(sql, R, year, span) {
  const isAll = year === null;
  const fromY = isAll ? (span?.from ?? R.kst.kstYear()) : year;
  const months = isAll ? ((span?.to ?? fromY) - fromY + 1) * 12 : 12;
  const start = monthStartIso(fromY, 0), end = monthStartIso(fromY, months);
  const prevStart = monthStartIso(fromY - 1, 0), prevEnd = monthStartIso(fromY - 1, months);
  const today = R.kst.kstToday(), thisMonth = today.slice(0, 7);
  const sameDayLastYear = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  })();
  const ytd = !isAll && year === Number(today.slice(0, 4));
  const monthly = (a, b) => sql`select * from public.consultation_monthly_stats(${a}::timestamptz, ${b}::timestamptz)`;
  const [cur, prev, paths, prevYtd] = await Promise.all([
    monthly(start, end),
    isAll ? [] : monthly(prevStart, prevEnd),
    sql`select * from public.consultation_path_stats(${start}::timestamptz, ${end}::timestamptz)`,
    ytd ? monthly(prevStart, R.bounds.kstDayBounds(sameDayLastYear).endIso) : null,
  ]);
  const curMonths = fillMonths(cur.map(toMonthStat), fromY, 0, months).filter((m) => m.month <= thisMonth || m.total > 0);
  const prevYearMonths = isAll ? [] : fillMonths(prev.map(toMonthStat), fromY - 1, 0, months);
  const prevYtdRows = ytd && prevYtd ? prevYtd.map(toMonthStat) : null;
  const prevSamePeriod = prevYtdRows ? { total: prevYtdRows.reduce((a, m) => a + m.total, 0), enrolled: prevYtdRows.reduce((a, m) => a + m.enrolled, 0), to: sameDayLastYear } : null;
  const total = curMonths.reduce((a, m) => a + m.total, 0), enrolled = curMonths.reduce((a, m) => a + m.enrolled, 0);
  return {
    months: curMonths, prevYearMonths, prevSamePeriod,
    paths: R.path.bucketizePathStats(paths.map((r) => ({ path: r.path, total: Number(r.total), enrolled: Number(r.enrolled), paidSum: Number(r.paid_sum),
      paidCount: r.paid_cnt === undefined || r.paid_cnt === null ? null : Number(r.paid_cnt) }))),
    total, enrolled, rate: total > 0 ? Math.round((enrolled / total) * 100) : null, paidSum: curMonths.reduce((a, m) => a + m.paidSum, 0),
  };
}

/** loadActiveEnrolledEnrollments(재원 학생의 활성 수강 — 휴원 제외 · 종료 없음) → 2.0 ActiveEnrollmentRow 모양. */
async function activeEnrolled(sql, t) {
  const rows = await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, c.subject, c.english_track, s.status::text status
    from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t} join public.students s on s.id = e.student_id and s.tenant_id = ${t}
    where e.tenant_id = ${t} and e.end_date is null and e.on_hold = false and s.status = 'enrolled' order by e.id`;
  return rows.map((r) => ({ id: r.id, student_id: r.student_id, class_id: r.class_id, start_date: r.start_date, end_date: null, is_transferred: null,
    class: { subject: r.subject, english_track: r.english_track }, student: { status: r.status } }));
}
/** loadAttendingCounter — 관리현황 '지금 재원'(원생목록 재원 판정 · 사람 단위). */
async function loadAttendingCounter(sql, R, t, subjects, today) {
  const rows = await activeEnrolled(sql, t);
  const keysOf = new Map();
  return (studentIds, group) => {
    if (studentIds.length === 0) return 0;
    let axis = [];
    if (group) { axis = keysOf.get(group) ?? R.subj.classKeysOfGroups([group], subjects); keysOf.set(group, axis); }
    return R.comp.enrolledSubjectCounts(rows, { studentIds: [...studentIds], subjects: axis }, today).students;
  };
}

/** getConsultationDistribution(year, span) — 학년·지역·학교 · 관리현황 · 등록 뒤 원생. */
export async function getConsultationDistribution(sql, R, t, year, span, subjects) {
  const isAll = year === null;
  const fromY = isAll ? (span?.from ?? R.kst.kstYear()) : year;
  const toY = isAll ? (span?.to ?? fromY) : year;
  const start = monthStartIso(fromY, 0), end = monthStartIso(toY + 1, 0), today = R.kst.kstToday();
  const [rows, schoolStats, attending] = await Promise.all([
    sql`select prospect_school, prospect_grade, outcome::text outcome, to_json(consulted_at)#>>'{}' consulted_at, subject, student_id::text student_id, follow_up_date::text follow_up_date
      from public.enrollment_consultations where tenant_id = ${t} and consulted_at >= ${start} and consulted_at < ${end} order by id`,
    sql`select name, name_key, kind, total_students, region, year from public.school_enrollment_stats where tenant_id = ${t} and year = ${isAll ? -1 : year} order by name_key`,
    loadAttendingCounter(sql, R, t, subjects, today),
  ]);
  const hasTotals = schoolStats.length > 0, totalsYear = hasTotals ? year : null;
  const byKey = new Map(schoolStats.map((s) => [s.name_key, s]));
  const consults = rows.map((r) => ({ school: r.prospect_school, grade: r.prospect_grade, enrolled: r.outcome === 'enrolled' }));
  const gradeAcc = new Map(), regionAcc = new Map();
  for (const c of consults) {
    const g = R.dist.gradeLabel(c.grade, c.school), gv = gradeAcc.get(g) ?? { n: 0, e: 0 };
    gv.n += 1; if (c.enrolled) gv.e += 1; gradeAcc.set(g, gv);
    const region = byKey.get(R.school.normalizeSchoolName(c.school))?.region?.replace(/^대구광역시\s*/, '').trim() || '미상';
    const rv = regionAcc.get(region) ?? { n: 0, e: 0 };
    rv.n += 1; if (c.enrolled) rv.e += 1; regionAcc.set(region, rv);
  }
  const toBars = (m) => [...m].map(([label, v]) => ({ label, n: v.n, enrolled: v.e }));
  return {
    grades: R.dist.sortGradeBars(toBars(gradeAcc)),
    regions: toBars(regionAcc).sort((a, b) => (a.label === '미상' ? 1 : b.label === '미상' ? -1 : b.n - a.n)),
    schools: R.dist.buildSchoolBars(consults, hasTotals ? new Map([...byKey].map(([k, v]) => [k, { name: v.name, kind: v.kind, total: v.total_students }])) : null),
    total: consults.length, hasTotals, totalsYear,
    sheet: R.sheet.buildManagementSheet(rows.map((r) => ({ month: kstMonthOf(r.consulted_at), subject: r.subject, outcome: r.outcome,
      consultedOn: R.kst.kstDateOf(r.consulted_at) ?? `${kstMonthOf(r.consulted_at)}-01`, followUpDate: r.follow_up_date, studentId: r.student_id })),
    R.groups.intakeGroupsOf(subjects), { today, attending }),
    sheetGroups: R.groups.intakeGroupMeta(subjects),
    cohorts: rows.flatMap((r) => {
      const consultedOn = R.kst.kstDateOf(r.consulted_at);
      return r.outcome === 'enrolled' && r.student_id && consultedOn ? [{ month: kstMonthOf(r.consulted_at), studentId: r.student_id, consultedOn }] : [];
    }),
  };
}

/** loadIntakeTrend(period, subjects, today) — 신규 문의 추이(상담일·과목 두 칸). */
async function loadIntakeTrend(sql, R, t, period, subjects, today) {
  const from = period.grain === 'month' ? `${period.months[0]}-01` : period.from;
  const monthEnd = period.grain === 'month' ? R.kst.monthRange(period.months.at(-1)).to : period.to;
  const to = monthEnd > today ? today : monthEnd;
  const rows = await sql`select to_json(consulted_at)#>>'{}' consulted_at, subject from public.enrollment_consultations where tenant_id = ${t}
    and consulted_at >= ${R.bounds.kstDayBounds(from).startIso} and consulted_at < ${R.bounds.kstDayBounds(to).endIso} order by id`;
  return R.itrend.bucketIntake(rows.flatMap((r) => { const date = R.kst.kstDateOf(r.consulted_at); return date ? [{ date, subject: r.subject }] : []; }), period, R.groups.intakeGroupsOf(subjects));
}

/** loadOpsHistory(tenantId, period, today) — 매일 기록 표(student_daily_stats)의 운영실 칸. */
async function loadOpsHistory(sql, t, period, today) {
  const from = period.grain === 'month' ? `${period.months[0]}-01` : period.from;
  const to = period.grain === 'month' ? today : period.to;
  const rows = await sql`select stat_date::text stat_date, data->'ops' ops from public.student_daily_stats where tenant_id = ${t} and stat_date >= ${from} and stat_date <= ${to} order by stat_date`;
  return rows.map((r) => ({ date: String(r.stat_date).slice(0, 10), ops: r.ops && typeof r.ops === 'object' && !Array.isArray(r.ops) ? r.ops : null }));
}

/** 통계 보기 자료 — page.tsx 170~254줄의 해석·조회를 같은 순서로. actorId = DB 함수가 지점을 가릴 신분. */
export async function buildStats({ sql, importV2, t, sp, subjects, actorId, canSeeExits }) {
  const R = await statsRules(importV2);
  const uiPrefs = {}, today = R.kst.kstToday();
  const savedSpan = R.view.savedStatsSpan(uiPrefs);
  const statsPeriod = R.range.parseStatsPeriod(sp.year ?? savedSpan ?? undefined, Number(today.slice(0, 4)));
  const statsYear = statsPeriod.kind === 'year' ? statsPeriod.year : null;
  const intakeParams = R.period.readPeriodParams(sp, R.itrend.INTAKE_TREND_KEYS);
  const savedIntakeMode = R.view.savedIntakeTrendMode(uiPrefs);
  const intakePeriod = R.period.parseStatsPeriod(R.period.hasPeriodParams(intakeParams) || !savedIntakeMode ? intakeParams : R.period.paramsForMode(savedIntakeMode, today), today);
  const progressParams = R.period.readPeriodParams(sp, R.opsKeys.PROGRESS_KEYS);
  const savedProgressMode = R.view.savedProgressTrendMode(uiPrefs) ?? 'range';
  const progressPeriod = R.period.parseStatsPeriod(R.period.hasPeriodParams(progressParams) ? progressParams : R.period.paramsForMode(savedProgressMode, today), today);
  const statsYears = await getStatsYears(sql, R, t);
  const available = statsYears.length > 0 ? { from: Math.min(...statsYears), to: Math.max(...statsYears) } : { from: Number(today.slice(0, 4)), to: Number(today.slice(0, 4)) };
  const span = R.range.periodRange(statsPeriod, available);
  // DB 함수(consultation_*_stats)가 auth_tenant_id()로 지점을 가린다 — 이 읽기 트랜잭션 안에서만 고른 사람의 신분을 싣는다.
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId, role: 'authenticated' })}, true)`;
  const [stats, dist, trend, progressRows, withdrawals] = await Promise.all([
    getEnrollmentStats(sql, R, statsYear, span),
    getConsultationDistribution(sql, R, t, statsYear, span, subjects),
    loadIntakeTrend(sql, R, t, intakePeriod, subjects, today),
    loadOpsHistory(sql, t, progressPeriod, today),
    canSeeExits ? kpiRules(importV2).then((K) => windowWithdrawals(sql, K, t, `${span.from}-01-01`, today)) : null,
  ]);
  return { statsYears, schoolPrefs: R.prefs.parseSchoolStatsPrefs(undefined), stats, dist, intake: { groups: R.groups.intakeGroupMeta(subjects), trend }, progressRows, withdrawals };
}
