// 2.0 운영실 영역(수납·보고서·시트 묶음) — 6개월 청구·수납 · 이번 달 지출 · 숙제 수행률 · 학부모 미확인 · 영어 시트 · 수학 시트.
// 2.0 server.ts의 `add`/`addSliced`가 부르는 함수를 같은 표·같은 조건의 SQL(지점 조건 `tenant_id`)과 2.0 순수 함수(importV2)로 옮겼다.
// 영역 값 모양 = 2.0 `OverviewData[영역]`. 운영실 조립(v2-dashboard-overview.mjs)이 영역마다 저장점 하나 안에서 `(ctx, sp)`로 부른다.
// · billing      ← loadBillingMonths(dashboard/overview/billing-months-server.ts) — 최근 6개월(`monthKeys(today)`) 청구서 머리(무효 제외) → summarizeInvoices.
//                  2.0은 지난 달을 5분 캐시(admin + 지점 조건)로, 이번 달을 요청마다 따로 읽는다 — 복사본은 바뀌지 않아 같은 조건을 한 조회로 읽는다.
//                  같은 함수(`loadBillingMonths` — 과목 판정 classifiedInvoices 포함)를 내보내 확장 추세(v2-dashboard-flow-billing.mjs)가 같이 쓴다.
// · expenses     ← getExpensesForMonth + summarizeExpenses(billing/server/expense-queries.ts · 이번 달). 그 파일이 server-only라
//                  요약 함수와 월 범위만 원문 그대로 옮겼다(아래 PORTED — verify가 원문과 비교). 통화 기본값은 2.0 currencies.ts의 값.
// · homework     ← loadHomeworkRisk(dashboard/onescreen/server/queries.ts) — 최근 7일 수업보고서 → buildHomeworkRisk.
// · unread       ← getUnreadReports(같은 파일) — 발송 성공 · 매칭 가능 · 미읽음 · 발송 후 48시간 지남 · 최근 30일(건수만 — 행을 받지 않는다).
//                  ClassNote 기능이 꺼진 지점은 2.0처럼 조회 없이 null(조립부가 영역째 뺀다). 매칭 가능 절은 2.0 상수(PostgREST `.or`)를 SQL로 바꿔 읽는다.
//                  그 파일은 Supabase 클라이언트를 물고 있어 불러올 수 없다 — 창 길이(7일·30일)만 원문 값을 적었다(verify가 원문과 비교).
//                  과목 = 학원 설정 `report.classnoteSubjects`(비면 좁히지 않는다 — 2.0 fail-open).
// · englishSheet ← getSheetLanding(null) — ECS 화면 이식의 같은 함수(v2-ecs-props.mjs `landingData`)를 그대로 부른다(두 벌이면 카드와 시트 목록이 갈린다).
//                  보는 사람의 영어 시트 보기 설정(프로그램·담임·JJ 표시 — users.ui_prefs.ecs)을 탄다(2.0 카드 주석 '보기 필터 기준'과 같다).
//                  2.0과 다른 점: 2.0은 Shouting 체크 조회 실패를 삼키는데 ECS 이식은 삼키지 않는다(운영실 값엔 Shouting이 실리지 않는다).
// · mathSheet    ← getMathSheetLanding(이번 달)(math-sheets/server/landing.ts) — 반·수업일·명단·칸 판정은 2.0 순수 함수 그대로.
//                  운영실이 받는 반 수 · 작성 칸 · 온 칸만 만든다 — 카드의 담임 이름·인원·꼬리표·정규/특강·담임 묶음은 운영실 값에 실리지 않아
//                  만들지 않았다(담임 이름 조회 하나를 덜 한다).
// 옮기지 않은 것: 운영실의 과목 관리자 값(과목으로 좁힌 청구·숙제·미확인 수) — 보는 사람이 원장이라 운영실은 학원 전체 값만 만든다
// (청구 줄의 과목 판정 자체는 loadBillingMonths에 옮겨 두었다 — 확장 추세의 과목별 줄이 쓴다).
// 강사 스코프 없음(원장 — 2.0 mcsVisibleClassFilter·ecsVisibleClassFilter 모두 null). '지금' = 복사본을 뜬 순간(ctx.clock.at), '오늘' = ctx.today.
// 읽기 전용 · 쓰기 없음 · 바깥 호출 없음.
import { queryGate } from './v2-onescreen-roster.mjs';
import { loadRules as ecsRules, resolveSkillAreas } from './v2-ecs-core.mjs';
import { landingData } from './v2-ecs-props.mjs';

const MODULES = { model: 'features/dashboard/overview/model.ts', calc: 'features/billing/calc.ts', subject: 'features/dashboard/overview/billing-subject.ts',
  risk: 'features/dashboard/onescreen/homework-risk.ts', unreadFilter: 'features/report-admin/unread-filter.ts', kst: 'lib/date-kst.ts',
  days: 'features/math-sheets/lib/class-days.ts', roster: 'features/math-sheets/lib/roster.ts', cell: 'features/math-sheets/lib/cell-state.ts',
  cal: 'features/attendance/calendar.ts', holiday: 'features/class-sheets/lib/holiday.ts' };
let rulesP = null;
async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

/** 2.0 dashboard/onescreen/server/queries.ts의 창 길이(일) — 숙제 신호 · 학부모 미확인. */
export const HOMEWORK_WINDOW_DAYS = 7;
export const UNREAD_WINDOW_DAYS = 30;
/** 2.0 billing/currencies.ts `DEFAULT_CURRENCY` — 아래 옮긴 요약 함수가 모듈 상수로 읽는다(verify가 원문 값과 비교). */
export const DEFAULT_CURRENCY = 'KRW';

// ── PORTED: 2.0 원문 그대로(billing/server/expense-queries.ts — server-only라 불러올 수 없다). verify가 원문과 비교한다. ──
// "YYYY-MM" → [start, endExclusive) 날짜 (Date 미사용 — RSC 순수성).
function monthRange(period) {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}
function summarizeExpenses(rows, period) {
  // 1) 통화별 총액(₩와 $를 한 숫자로 더하지 않는다 — 사용자 요구 핵심).
  const byCur = new Map();
  for (const r of rows) {
    const c = byCur.get(r.currency) ?? { total: 0, count: 0 };
    c.total += r.amount;
    c.count += 1;
    byCur.set(r.currency, c);
  }
  const byCurrency = [...byCur.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    // 코드 알파벳을 3차 키로 — count·total 동률 시 primaryCurrency가 DB 순서에 흔들리지 않게 결정적 정렬.
    .sort((a, b) => b.count - a.count || b.total - a.total || a.currency.localeCompare(b.currency));
  const primaryCurrency = byCurrency[0]?.currency ?? DEFAULT_CURRENCY;

  // 2) 분류별 지출은 단일 통화(바 길이가 의미 있으려면 동일 통화여야) → 주 통화 한정 집계.
  const byCat = new Map();
  for (const r of rows) {
    if (r.currency !== primaryCurrency) continue;
    const c = byCat.get(r.category) ?? { amount: 0, count: 0 };
    c.amount += r.amount;
    c.count += 1;
    byCat.set(r.category, c);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);

  return { period, count: rows.length, byCurrency, primaryCurrency, byCategory, categoryCount: byCategory.length };
}
// ── PORTED 끝 ──

// ── 6개월 청구·수납 · 이번 달 지출 ─────────────────────────────────────────────────────────────────────────────────────
/**
 * 2.0 classifiedInvoices(billing-months-server.ts) — 그 달들의 청구서(무효 제외) 줄마다 과목을 정한다(classifyInvoice). 학생의 반 = 그 달에
 * 수강이 걸린 반(종료된 수강 포함 · enrollmentInMonth). 반이 없는 수강은 이름·과목 없이 남는다(2.0 임베드가 null).
 */
async function classifiedInvoices(sql, t, R, months) {
  if (!months.length) return [];
  const invoices = await sql`select student_id::text student_id, period, status::text status, amount_total, amount_paid, amount_discount, line_items
    from public.invoices where tenant_id=${t} and period = any(${months}) and status <> 'void' order by id`;
  const ids = [...new Set(invoices.map((i) => i.student_id).filter(Boolean))];
  const enrollments = ids.length ? await sql`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date,
      c.class_name, c.subject from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
    where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) order by e.id` : [];
  const byStudent = new Map();
  for (const e of enrollments) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), e]);
  return invoices.map((inv) => R.subject.classifyInvoice(inv, (inv.student_id ? byStudent.get(inv.student_id) ?? [] : [])
    .filter((e) => R.subject.enrollmentInMonth({ start: e.start_date, end: e.end_date }, inv.period))
    .map((e) => ({ classId: e.class_id, className: e.class_name ?? null, subject: e.subject ?? null }))));
}
/**
 * 2.0 loadBillingMonths(tenantId, months, withSubjects) — 운영실 '6개월 청구 · 수납'과 수납 통계가 같이 부르는 한 벌. 달(오름차순)마다
 * `academy` = 청구서 머리(무효 제외)의 summarizeInvoices · `classified` = 과목 판정한 청구서(withSubjects일 때만) ·
 * `compute(pred)` = 2.0 반환 함수(pred가 있으면 summarizeSubjectBilling — 청구 항목별 과목 값). 확장 추세(v2-dashboard-flow-billing.mjs)도 이 함수를 쓴다.
 * 2.0은 지난 달을 5분 캐시로, 이번 달을 따로 읽는다 — 복사본은 바뀌지 않아 같은 조건을 한 조회로 읽는다. `sql` = 저장점 sql 또는 queryGate.
 */
export async function loadBillingMonths({ sql, tenantId: t, importV2, months, withSubjects = false }) {
  const R = await rules(importV2);
  const [rows, classified] = await Promise.all([
    sql`select period, amount_total, amount_paid, amount_discount, status::text status from public.invoices
      where tenant_id=${t} and period = any(${months}) and status <> 'void' order by id`,
    withSubjects ? classifiedInvoices(sql, t, R, months) : []]);
  const academy = months.map((month) => R.calc.summarizeInvoices(rows.filter((r) => r.period === month).map((r) => ({
    amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid), amountDiscount: Number(r.amount_discount ?? 0), status: r.status })), month));
  return { academy, classified, compute: (pred) => (pred ? R.subject.summarizeSubjectBilling(classified, months, (subject) => pred(subject)) : academy) };
}
/** 2.0 billing 영역 — loadBillingMonths(tenantId, monthKeys(today), false)의 학원 전체 값(최근 6개월). */
async function billing(ctx, sp) {
  const R = await rules(ctx.importV2);
  return (await loadBillingMonths({ sql: sp, tenantId: ctx.t, importV2: ctx.importV2, months: R.model.monthKeys(ctx.today) })).academy;
}
/** 2.0 summarizeExpenses(getExpensesForMonth(이번 달)) — 지출일이 그 달인 결의서(지출일 최신순 · id). 요약은 통화·분류·금액만 읽는다(2.0 mapExpenseRow와 같은 값). */
async function expenses(ctx, sp) {
  const period = ctx.today.slice(0, 7), { start, end } = monthRange(period);
  const rows = await sp`select category, amount, currency from public.expenses where tenant_id=${ctx.t} and expense_date >= ${start} and expense_date < ${end}
    order by expense_date desc, id`;
  return summarizeExpenses(rows.map((r) => ({ category: r.category, amount: Number(r.amount),
    currency: typeof r.currency === 'string' && r.currency ? r.currency : DEFAULT_CURRENCY })), period);
}

// ── 숙제 수행률 · 학부모 미확인 ─────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 trackedSubjects — `report.classnoteSubjects`(빈 값은 뺀다 · 비면 좁히지 않는다). */
const trackedSubjects = (ctx) => (ctx.settings.report?.classnoteSubjects ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
/** 2.0 loadHomeworkRisk()(null) — 오늘 포함 최근 7일 수업보고서(설정 과목만) · 학생이 안 붙은 행은 뺀다. */
async function homework(ctx, sp) {
  const R = await rules(ctx.importV2), tracked = trackedSubjects(ctx), since = R.kst.addDays(ctx.today, -(HOMEWORK_WINDOW_DAYS - 1));
  const rows = await sp`select student_id::text student_id, homework_score, subject from public.lesson_reports
    where tenant_id=${ctx.t} and report_date >= ${since} and report_date <= ${ctx.today} ${tracked.length ? sp`and subject = any(${tracked})` : sp``} order by id`;
  return { ...R.risk.buildHomeworkRisk(rows.filter((r) => !!r.student_id).map((r) => ({ studentId: r.student_id, homeworkScore: r.homework_score }))),
    windowDays: HOMEWORK_WINDOW_DAYS, subjects: tracked };
}
/** 2.0 PostgREST `.or("a.not.is.null,b.is.null,b.neq.x")` → SQL. 모르는 모양이면 멈춘다(2.0 절이 바뀌면 조용히 다른 집합을 세지 않게). */
function postgrestOr(sp, clause) {
  const terms = clause.split(',').map((term) => {
    let m;
    if ((m = /^(\w+)\.not\.is\.null$/.exec(term))) return sp`${sp(m[1])} is not null`;
    if ((m = /^(\w+)\.is\.null$/.exec(term))) return sp`${sp(m[1])} is null`;
    if ((m = /^(\w+)\.neq\.([\w-]+)$/.exec(term))) return sp`${sp(m[1])} <> ${m[2]}`;
    throw new Error(`옮기지 않은 조건 모양입니다: ${term}`);
  });
  return terms.reduce((all, term) => sp`${all} or ${term}`);
}
/** 2.0 getUnreadReports()(null) — ClassNote 꺼짐이면 조회 없이 null(2.0 addSliced가 같은 판정 뒤 영역째 뺀다). 유예 기준 = 복사본을 뜬 순간. */
async function unread(ctx, sp) {
  if (!ctx.RR.isModuleEnabled(ctx.settings.modules.disabled, 'classnote')) return null;
  const R = await rules(ctx.importV2), U = R.unreadFilter, tracked = trackedSubjects(ctx);
  const since = R.kst.addDays(ctx.today, -(UNREAD_WINDOW_DAYS - 1)), cutoff = new Date(ctx.clock.at.getTime() - U.UNREAD_GRACE_HOURS * 3_600_000);
  const [{ n }] = await sp`select count(*)::int n from public.lesson_reports where tenant_id=${ctx.t} and classnote_status = ${U.SENT_STATUS_SUCCESS}
    and classnote_read_at is null and (${postgrestOr(sp, U.UNREAD_MATCHABLE_OR)}) and classnote_sent_at < ${cutoff} and report_date >= ${since}
    ${tracked.length ? sp`and subject = any(${tracked})` : sp``}`;
  return { reports: n, windowDays: UNREAD_WINDOW_DAYS, graceHours: U.UNREAD_GRACE_HOURS, subjects: tracked };
}

// ── 강사 시트 작성 현황 ───────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 englishSheet 영역 — getSheetLanding(null)(이번 주 · 보는 사람의 보기 설정)의 카드 합. 메뉴 접근은 조립부의 권한표(`allowed`)로 이미 걸렀다. */
async function englishSheet(ctx, sp) {
  const R = await ecsRules(ctx.importV2), ops = ctx.settings.operations;
  const env = { skillAreas: resolveSkillAreas(ops.subjects.find((s) => s.key === 'english')), disabled: ctx.settings.modules.disabled, holidays: R.buildHolidayMap(ops.holidays) };
  const viewer = { id: ctx.user.id, systemRole: ctx.user.role, uiPrefs: ctx.user.ui_prefs ?? null, levels: { ecs: ctx.allowed.includes('ecs') ? 'full' : 'none' } };
  const result = await landingData(sp, ctx.t, R, env, viewer, null, ctx.today);
  if (!result.ok) throw new Error('영어 시트 조회 실패');
  return { period: result.weekLabel, classes: result.cards.length,
    filled: result.cards.reduce((sum, c) => sum + c.filledSlots, 0), total: result.cards.reduce((sum, c) => sum + c.totalSlots, 0) };
}
/**
 * 2.0 mathSheet 영역 — getMathSheetLanding(이번 달)의 카드 합. 그 달 수업일이 있는 수학 반(활성 · 그 달 시작 전에 닫히지 않은 반) ×
 * 그 달 수업일 중 하루라도 명단인 학생 × 수업일 칸 → 칸 판정(cellStateOf) → tallyCells. 작성 = 기록 있는 칸, 온 칸 = 기록 있음 + 왔는데 안 적힘.
 */
async function mathSheet(ctx, sp) {
  if (!ctx.allowed.includes('mcs')) throw new Error('수학 시트 조회 실패'); // 2.0: 접근 권한 없음 → ok:false → 영역 실패
  const R = await rules(ctx.importV2), gate = queryGate(sp), t = ctx.t, today = ctx.today;
  const month = R.days.normalizeMonth(today.slice(0, 7), today.slice(0, 7));
  const { from: monthStart, to: monthEnd } = R.kst.monthRange(month), period = R.kst.monthLabel(month);
  const holidays = R.cal.buildHolidayMap(ctx.settings.operations.holidays);
  const classes = await gate`select id::text id from public.classes where tenant_id=${t} and subject = 'math' and is_active
    and (closed_at is null or closed_at >= ${monthStart}) order by class_name`;
  if (!classes.length) return { period, classes: 0, filled: 0, total: 0 };
  const ids = classes.map((c) => c.id);
  const [schedules, enrollments, reports, attendance] = await Promise.all([
    gate`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and class_id = any(${ids}::uuid[]) order by id`,
    gate`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date, is_transferred
      from public.enrollments where tenant_id=${t} and class_id = any(${ids}::uuid[]) order by id`,
    gate`select class_id::text class_id, student_id::text student_id, report_date::text report_date from public.lesson_reports
      where tenant_id=${t} and class_id = any(${ids}::uuid[]) and report_date >= ${monthStart} and report_date <= ${monthEnd} order by id`,
    gate`select class_id::text class_id, student_id::text student_id, session_date::text session_date, status::text status from public.attendance_records
      where tenant_id=${t} and class_id = any(${ids}::uuid[]) and session_date >= ${monthStart} and session_date <= ${monthEnd} order by id`]);
  const schedByClass = new Map(), enrByClass = new Map();
  for (const r of schedules) schedByClass.set(r.class_id, [...(schedByClass.get(r.class_id) ?? []), { dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time,
    validFrom: r.valid_from, validTo: r.valid_to }]);
  for (const e of enrollments) {
    const byStudent = enrByClass.get(e.class_id) ?? new Map();
    byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), { startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true }]);
    enrByClass.set(e.class_id, byStudent);
  }
  const rosterIds = [...new Set(enrollments.map((e) => e.student_id))];
  const students = rosterIds.length ? await gate`select id::text id, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id = any(${rosterIds}::uuid[])` : [];
  const withdrawnById = new Map(students.map((s) => [s.id, s.withdrawn_at ?? null]));
  const reportKeys = new Set(reports.map((r) => `${r.class_id}|${r.report_date}|${r.student_id}`)), attByKey = new Map();
  for (const a of attendance) { const key = `${a.class_id}|${a.session_date}|${a.student_id}`; attByKey.set(key, [...(attByKey.get(key) ?? []), a.status]); }
  let cards = 0, filled = 0, total = 0;
  for (const { id: cid } of classes) {
    const days = R.days.classDaysOf(month, schedByClass.get(cid) ?? []);
    if (days.length === 0) continue; // 그 달에 안 도는 반은 카드를 만들지 않는다
    const dayDates = days.map((d) => d.date), states = [];
    for (const [sid, list] of enrByClass.get(cid) ?? new Map()) {
      const withdrawnAt = withdrawnById.get(sid) ?? null;
      if (!R.roster.isOnMathRosterAnyDay(list, withdrawnAt, dayDates)) continue;
      for (const day of days) states.push(R.cell.cellStateOf({ enrollments: list, withdrawnAt, date: day.date,
        attendance: R.cell.foldDayAttendance(attByKey.get(`${cid}|${day.date}|${sid}`) ?? []), hasReport: reportKeys.has(`${cid}|${day.date}|${sid}`),
        today, holiday: R.holiday.isHolidayOn(holidays, day.date) }));
    }
    const fill = R.cell.tallyCells(states);
    cards += 1; filled += fill.written; total += fill.written + fill.unwritten;
  }
  return { period, classes: cards, filled, total };
}

/** 이 단계에서 옮긴 영역(2.0 `Area` 키). */
export const BILLING_AREAS = { billing, expenses, homework, unread, englishSheet, mathSheet };
