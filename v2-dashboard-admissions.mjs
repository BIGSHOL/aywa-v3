// 2.0 운영실 영역(2단계 · 상담·운영) — 콜&상담 전환 · 원생상담 · 신규생 관리 · 레벨테스트 및 첫수업 일정 · 상담 진행 · 직원 구성 · 운영 현황 · 공지.
// 2.0 server.ts의 영역(add/addSliced) admissions · consultations · newcomers · calendar · consultProgress · staff · operations · notices가 부르는 함수
// (getRecentEnrollmentStats · getStudentConsultationCounts · getNewcomers + buildCareSummary · getDateRangeEvents + 일정 연결(admissions-links-server ·
//  admissions-class-link · admissions-consultation-link) · consultProgressList + consultProgressData · staff · operations(getApprovalBoxes · getInventoryCounts) ·
//  getRecentAnnouncements)를 같은 표·같은 조건의 SQL(지점 조건 `tenant_id`)과 2.0 순수 함수(importV2)로. 영역 값 모양 = 2.0 `OverviewData[영역]`.
// 운영실 조립(v2-dashboard-overview.mjs)이 영역마다 저장점 하나 안에서 `(ctx, sp)`로 부른다.
// · 보는 사람 = 원장 — 강사 스코프 없음(effectiveTeacherId·effectiveTeacherScope = null) · 학원 전체 값(compute(null))만. 과목 관리자 값(slices)과
//   그 재료(일정의 과목 판정 subjectsNamedIn · 과목별 상담 건수 · getRecentConsultationRows)는 옮기지 않았다.
// · 2.0이 실패를 삼키는 자리는 같은 폴백(`gate.soft`): 일정 카드의 상담 후보(→ 빈 목록) · 첫 수업 후보(→ 둘 다 빈 목록) · 동명이인 가족(→ 상담 연결 끔) ·
//   상담 진행의 일정(→ 입테 모름) · 그 동명이인(→ 입테 모름) · 신규생 체크 기록(→ 항목 비움 · 과목 칸이 없으면 옛 모양으로 다시) · 일정 표의 세대별 칸
//   (→ 앞 세대 칸으로) · 운영 현황 칸마다(→ 건수 null). 그 밖의 실패는 영역 실패(throw).
// · 옮기며 다르게 한 것:
//   - 콜&상담 전환: DB 함수 `consultation_monthly_stats`는 지점을 로그인 신분(auth_tenant_id)에서 읽어 신분 없이 부르면 0행이다 — 같은 group-by를
//     `tenant_id` 조건으로 적었다(이 트랜잭션의 신분 request.jwt.claims는 건드리지 않는다 — 다른 영역과 같은 트랜잭션이다).
//   - 내 결재 대기: getApprovalBoxes 가운데 이 칸이 쓰는 `waiting.length`의 재료(관련 문서 id 세 조회 → 문서 · 결재선)만 읽는다. 참조자 이름·휴가·양식
//     본문(loadDocs의 나머지 조회)은 수에 들지 않아 읽지 않는다 — 그래서 그 조회의 실패로 칸이 비는 일도 없다.
//   - 재고: getInventoryCounts 다섯 칸 중 이 카드가 쓰는 자산·소모품 두 칸만 센다(업체 칸은 카드에 없다).
//   - 상담 후보(admissionsConsultationCandidates)는 성공한 값만 영역끼리 나눠 쓴다(2.0도 한 번 읽어 나눠 쓴다). 일정 카드에서 실패하면 그 카드는 빈 목록,
//     상담 진행은 자기 저장점에서 다시 읽고 또 실패하면 영역 실패(2.0: 일정 카드는 링크만 빼고, 상담 진행은 실패를 알린다).
//   - 일정↔상담 매처(consultationBasesInTitles · matchAdmissionsConsultation)에는 제목에 그 상담의 이름 글자가 든 상담만 넘긴다 — 매처의 낱말 일치가
//     걸리려면 그 글자가 있어야 하므로 답은 같다(운영실 흐름의 연별 창처럼 일정·상담이 많을 때 상담마다 정규식을 만들지 않게).
// · '지금' = ctx.clock.at(최근 7일 상담) · '오늘' = ctx.today. 읽기 전용 · 쓰기 없음 · 바깥 호출 없음(일정은 aywa 일정 표만 읽는다 — 구글 호출 없음).
import { queryGate, GateMisuseError } from './v2-onescreen-roster.mjs';

const MODULES = { kst: 'lib/date-kst.ts', bounds: 'features/enrollment/kst-bounds.ts', onboard: 'features/newcomers/onboarding-items.ts',
  srows: 'features/newcomers/subject-rows.ts', care: 'features/dashboard/overview/newcomer-care.ts', color: 'features/calendar/color.ts',
  cancelled: 'features/calendar/cancelled.ts', display: 'features/dashboard/overview/display.ts', classLink: 'features/dashboard/overview/admissions-class-link.ts',
  consultLink: 'features/dashboard/overview/admissions-consultation-link.ts', names: 'features/students/name-suffix.ts',
  window: 'features/dashboard/overview/upcoming-window.ts', prevDay: 'features/dashboard/overview/previous-day.ts',
  progress: 'features/dashboard/overview/consultation-progress.ts', consult: 'features/enrollment/consult-subject.ts',
  staff: 'features/dashboard/overview/staff-subjects.ts', subjects: 'features/owner/subjects.ts', preset: 'features/owner/preset.ts', audience: 'features/notices/audience.ts' };
let rulesP = null;
/** 이 파일이 쓰는 2.0 순수 함수 묶음 — 운영실 흐름(v2-dashboard-flow-admissions.mjs)도 같은 묶음을 쓴다. */
export async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/** 영역끼리 같은 재료는 한 번만 — 성공한 값만 기억한다(실패하면 다음 영역이 자기 저장점에서 다시 읽는다). */
async function shared(ctx, key, fn) {
  if (!ctx.memo.has(key)) ctx.memo.set(key, await fn());
  return ctx.memo.get(key);
}
/** 2.0 ymd(newcomers/server/queries.ts) — 10자 이상이면 앞 10자. */
const ymd = (value) => (value && String(value).length >= 10 ? String(value).slice(0, 10) : null);

// ── 콜&상담 전환 ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 toMonthStat(stats-queries.ts) — 분모 0이면 전환율 null. */
function toMonthStat(r) {
  const total = Number(r.total), enrolled = Number(r.enrolled);
  return { month: r.month, total, enrolled, declined: Number(r.declined), noShow: Number(r.no_show), open: Number(r.open_cnt), paidSum: Number(r.paid_sum),
    rate: total > 0 ? Math.round((enrolled / total) * 100) : null };
}
/** 2.0 fillMonths — 빈 달은 0으로(그 파일과 같은 로컬 달력 산술). */
function fillMonths(rows, startY, startM0, count) {
  const byKey = new Map(rows.map((r) => [r.month, r])), out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startY, startM0 + i, 1), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push(byKey.get(key) ?? { month: key, total: 0, enrolled: 0, declined: 0, noShow: 0, open: 0, paidSum: 0, rate: null });
  }
  return out;
}
/** 2.0 getRecentEnrollmentStats(오늘) — 지난달 1일 ~ 다음 달 1일(KST) 상담을 상담일 KST 달로(consultation_monthly_stats와 같은 group-by). */
async function admissions(ctx, sp) {
  const R = await rules(ctx.importV2), current = ctx.today.slice(0, 7), previous = R.kst.shiftMonth(current, -1);
  const rows = await sp`select to_char(date_trunc('month', consulted_at at time zone 'Asia/Seoul'), 'YYYY-MM') as month, count(*)::int total,
      (count(*) filter (where outcome::text = 'enrolled'))::int enrolled, (count(*) filter (where outcome::text = 'declined'))::int declined,
      (count(*) filter (where outcome::text = 'no_show'))::int no_show,
      (count(*) filter (where outcome::text in ('pending', 'scheduled', 'consulted', 'ai_done')))::int open_cnt,
      coalesce(sum(payment_amount) filter (where outcome::text = 'enrolled'), 0)::text paid_sum
    from public.enrollment_consultations where tenant_id=${ctx.t}
      and consulted_at >= ${R.kst.kstMonthStartIso(previous)} and consulted_at < ${R.kst.kstMonthStartIso(R.kst.shiftMonth(current, 1))} group by 1`;
  const months = fillMonths(rows.map(toMonthStat), Number(previous.slice(0, 4)), Number(previous.slice(5)) - 1, 2);
  const total = months.reduce((sum, row) => sum + row.total, 0), enrolled = months.reduce((sum, row) => sum + row.enrolled, 0);
  return { months, prevYearMonths: [], prevSamePeriod: null, paths: [], total, enrolled, rate: total > 0 ? Math.round(enrolled / total * 100) : null,
    paidSum: months.reduce((sum, row) => sum + row.paidSum, 0) };
}

// ── 원생상담 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getStudentConsultationCounts() — 원장은 강사 스코프가 없어 지점 전체 · 이번 달 = KST 1일부터 · 최근 7일 = 복사본을 뜬 순간에서 7×24시간. 2.0의 head count 넷을 한 번에. */
async function consultations(ctx, sp) {
  const weekAgo = new Date(ctx.clock.at.getTime() - 7 * 86400000);
  const [r] = await sp`select (count(*) filter (where consulted_at >= ${`${ctx.today.slice(0, 7)}-01T00:00:00+09:00`}))::int this_month, (count(*) filter (where consulted_at >= ${weekAgo}))::int last_week,
      (count(*) filter (where follow_up_done = false and follow_up_date is not null))::int pending,
      (count(*) filter (where follow_up_done = false and follow_up_date is not null and follow_up_date < ${ctx.today}))::int overdue
    from public.student_consultations where tenant_id=${ctx.t}`;
  return { thisMonth: r.this_month, lastWeek: r.last_week, pendingFollowUps: r.pending, overdueFollowUps: r.overdue };
}

// ── 신규생 관리 ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 isMissingSubjectColumn(newcomers/server/cohort.ts) — 오류 글에 과목 칸 + '칸 없음'. */
const isMissingSubjectColumn = (e) => { const s = `${e?.code ?? ''} ${e?.message ?? ''} ${e?.details ?? e?.detail ?? ''}`; return /subject/i.test(s) && /42703|PGRST204|does not exist|Could not find/i.test(s); };
/** 2.0 loadCheckRows — 과목 칸을 먼저 읽고, 그 칸이 없으면 옛 모양(전부 과목 무관 '')으로 다시. 다른 실패는 `ok:false`(삼키지 않고 올린다). */
async function checkRows(gate, t, ids) {
  const first = await gate.soft(async (s) => ({ ok: true, rows: (await s`select student_id::text student_id, item_key, done_on::text done_on, subject from public.student_onboarding_checks
    where tenant_id=${t} and student_id = any(${ids}::uuid[]) order by id`).map((r) => ({ studentId: r.student_id, itemKey: r.item_key, doneOn: r.done_on, subject: r.subject })) }),
  (error) => ({ ok: false, error }));
  if (first.ok || !isMissingSubjectColumn(first.error)) return first;
  return gate.soft(async (s) => ({ ok: true, rows: (await s`select student_id::text student_id, item_key, done_on::text done_on from public.student_onboarding_checks
    where tenant_id=${t} and student_id = any(${ids}::uuid[]) order by id`).map((r) => ({ studentId: r.student_id, itemKey: r.item_key, doneOn: r.done_on, subject: '' })) }),
  (error) => ({ ok: false, error }));
}
/**
 * 2.0 getNewcomers()의 학생 한 줄(`rows`) — 등록일이 창(오늘 − 90일) 안인 재원·휴원생 · 과목은 반에서(끝난 과목은 줄을 안 세운다) · 체크는 과목 칸 우선.
 * 체크 표를 못 읽으면 `checksOk` false(2.0 checksAvailable false — 표 부재와 실패 모두 항목을 비운다).
 */
async function newcomerRows(R, gate, t, today) {
  const students = await gate`select id::text id, name, school, grade, enrolled_at::text enrolled_at from public.students
    where tenant_id=${t} and status::text in ('enrolled', 'on_hold') and enrolled_at >= ${R.onboard.newcomerWindowStart(today)} order by enrolled_at desc, id`;
  if (!students.length) return { rows: [], checksOk: true };
  const ids = students.map((s) => s.id);
  const [enrollments, checks] = await Promise.all([
    gate`select e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, c.subject from public.enrollments e
      left join public.classes c on c.id = e.class_id and c.tenant_id = ${t} where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) order by e.id`,
    checkRows(gate, t, ids)]);
  const enr = enrollments.map((e) => ({ studentId: e.student_id, startDate: e.start_date, endDate: e.end_date, subject: e.subject ?? null }));
  const { bySubject, earliest } = R.srows.buildSubjectAnchors(enr, today);
  const active = new Set(enr.filter((e) => !ymd(e.endDate) || ymd(e.endDate) > today).map((e) => e.studentId));
  const index = R.srows.indexChecks(checks.ok ? checks.rows : []), items = R.onboard.ONBOARDING_ITEMS, itemKeys = items.map((item) => item.key), rows = [];
  for (const s of students) {
    const enrolledOn = ymd(s.enrolled_at);
    if (!enrolledOn) continue;
    const base = { studentId: s.id, hasCurrentEnrollment: active.has(s.id), name: s.name, school: s.school, grade: s.grade, enrolledOn,
      elapsedDays: R.onboard.daysBetween(enrolledOn, today), bucket: R.onboard.bucketOf(enrolledOn, today) };
    const subjMap = bySubject.get(s.id), subjects = subjMap ? [...subjMap.keys()].sort() : [];
    const perSubject = (subjects.length > 0 ? subjects : [null]).map((subject) => {
      const firstClassOn = subject ? (subjMap?.get(subject) ?? null) : (earliest.get(s.id) ?? null);
      const own = R.srows.effectiveChecks(index, s.id, subject);
      return { ...base, subject, rowKey: `${s.id}|${subject ?? ''}`, firstClassOn, checks: own, progress: R.onboard.progressOf({ enrolledOn, firstClassOn }, own, today, items) };
    });
    const firstClassOn = earliest.get(s.id) ?? null, folded = R.srows.collapseChecks(index, s.id, subjects, itemKeys);
    rows.push({ ...base, subject: null, rowKey: s.id, firstClassOn, checks: folded, progress: R.onboard.progressOf({ enrolledOn, firstClassOn }, folded, today, items),
      ...(subjects.length > 0 ? { subjects: perSubject } : {}) });
  }
  return { rows, checksOk: checks.ok };
}
/** 2.0 newcomers() — 단계별 인원 · 항목별 체크(`buildCareSummary` — 매일 기록과 같은 집계). 학원 전체 = 학생 줄 그대로. */
async function newcomers(ctx, sp) {
  const R = await rules(ctx.importV2), { rows, checksOk } = await newcomerRows(R, queryGate(sp), ctx.t, ctx.today);
  return R.care.buildCareSummary(rows, rows, ctx.settings.operations.subjects, checksOk, ctx.today);
}

// ── 레벨테스트 및 첫수업 일정 · 상담 진행 ─────────────────────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** 2.0 fetchManualEvents의 세대별 칸(ATTEMPTS) — 태그 + 시리즈 → 시리즈 → 옛 칸. 그 세대가 새로 짚는 칸이 없다는 오류일 때만 다음 세대로. */
const EVENT_ATTEMPTS = [{ tag: true, series: true, droppedBy: /tag_id|calendar_tags/i }, { tag: false, series: true, droppedBy: /series_id/i },
  { tag: false, series: false, droppedBy: /$^/ }];
/** 2.0 mapManual — 시각은 분까지 · 색은 색 단일 소스가 판정. */
function mapManual(R, r) {
  return { id: r.id, title: r.title, memo: r.memo ?? null, startDate: r.start_date, endDate: r.end_date, startTime: r.start_time ? r.start_time.slice(0, 5) : null,
    endTime: r.end_time ? r.end_time.slice(0, 5) : null, color: R.color.normalizeCalendarColor(r.color), createdByName: r.creator_name ?? null, source: 'manual',
    seriesId: r.series_id ?? null, tag: r.tag_id ? { id: r.tag_id, name: r.tag_name, color: R.color.normalizeCalendarColor(r.tag_color) } : null };
}
/**
 * 2.0 getDateRangeEvents(first, last) — 수기 일정만(휴가 오버레이 없음) · [first, last]와 겹치는 전부 · 시작일·id 순.
 * `ready` = 일정 표(calendar_events)가 있나 — 표가 없을 때만 false. 날짜가 아니거나 거꾸로면 빈 결과(ready true) · 그 밖의 실패는 throw.
 */
export async function dateRangeEvents(R, gate, t, first, last) {
  if (!DATE_RE.test(first) || !DATE_RE.test(last) || first > last) return { ready: true, events: [] };
  let lastError = '';
  for (const a of EVENT_ATTEMPTS) {
    const got = await gate.soft(async (s) => ({ rows: await s`select e.id::text id, e.title, e.memo, e.start_date::text start_date, e.end_date::text end_date,
        e.start_time::text start_time, e.end_time::text end_time, e.color, u.display_name creator_name
        ${a.series ? s`, e.series_id::text series_id` : s``} ${a.tag ? s`, tg.id::text tag_id, tg.name tag_name, tg.color tag_color` : s``}
      from public.calendar_events e ${a.tag ? s`left join public.calendar_tags tg on tg.id = e.tag_id and tg.tenant_id = ${t}` : s``}
        left join public.users u on u.id = e.created_by and u.tenant_id = ${t}
      where e.tenant_id = ${t} and e.start_date <= ${last} and e.end_date >= ${first} order by e.start_date, e.id` }), (error) => ({ error }));
    if (!got.error) return { ready: true, events: got.rows.map((r) => mapManual(R, r)) };
    lastError = got.error?.message ?? String(got.error);
    // PostgREST 'PGRST205/42P01' = 일정 표 자체가 없다 — postgres는 같은 일을 42P01 + 표 이름으로 말한다(태그 표가 없는 것은 칸 세대 문제다).
    if (got.error?.code === '42P01' && /calendar_events/.test(lastError)) return { ready: false, events: [] };
    if (a.droppedBy.test(lastError)) continue;
    throw new Error(`일정 조회 실패 — ${lastError}`);
  }
  throw new Error(`일정 조회 실패 — ${lastError}`);
}
/** 일정↔상담 연결 창의 첫날(오늘 − 60일) — 2.0 loadOverview `consultationSince`. */
const consultationSince = (R, today) => R.onboard.shiftDate(today, -R.consultLink.CONSULTATION_LINK_WINDOW_DAYS);
/**
 * 2.0 admissionsConsultationCandidates(since) — 상담일이 since(KST) 이후인 콜&상담 · 연결 원생 정식 이름 · 보호자 번호는 숫자만(9자리 이상).
 * `q` = 이 조회를 실행할 sql(저장점 안이면 그 `s`).
 */
export async function consultationCandidates(R, q, t, since) {
  const { startIso } = R.bounds.kstDayBounds(since);
  const rows = await q`select ec.id::text id, ec.prospect_name, ec.prospect_school, ec.prospect_grade, ec.parent_phone, ec.student_id::text student_id,
      to_json(ec.consulted_at)#>>'{}' consulted_at, ec.outcome::text outcome, ec.subject, s.name student_name
    from public.enrollment_consultations ec left join public.students s on s.id = ec.student_id and s.tenant_id = ${t}
    where ec.tenant_id = ${t} and ec.consulted_at >= ${startIso} order by ec.id`;
  return rows.flatMap((row) => {
    const name = row.prospect_name?.trim(), consultedOn = R.kst.kstDateOf(row.consulted_at);
    if (!name || !consultedOn) return [];
    const digits = (row.parent_phone ?? '').replace(/\D/g, '');
    return [{ id: row.id, name, school: row.prospect_school, grade: row.prospect_grade, phoneDigits: digits.length >= 9 ? digits : null, studentId: row.student_id,
      studentName: row.student_name ?? null, consultedOn, outcome: row.outcome, subject: row.subject || null }];
  });
}
/** 일정 카드와 상담 진행이 한 번 읽어 나눠 쓰는 상담 후보(`shared`) — 2.0 loadOverview의 `consultationRows`. */
function consultationRows(ctx, R, q, since) {
  return shared(ctx, 'admissions:consultationRows', () => consultationCandidates(R, q, ctx.t, since));
}
/**
 * 제목에 그 상담의 이름 글자(상담 이름 · 접미사 뗀 이름 · 연결 원생 이름)가 들어 있는 상담만 — 2.0 nameHits(낱말 일치, 대소문자 무시)가 걸리려면
 * 그 글자가 제목에 있어야 하므로 먼저 걸러도 매처의 답은 같다. 일정·상담이 많은 긴 창(흐름의 연별)에서 매처가 상담마다 정규식을 만들지 않게.
 */
const aliasMemo = new WeakMap();
function nearTitle(R, event, consultations) {
  // 상담마다 찾을 글자(소문자) — 상담 목록 하나에 한 번만 만든다.
  let aliases = aliasMemo.get(consultations);
  if (!aliases) {
    aliases = consultations.map((c) => {
      const name = c.name.replace(/\s+/g, '');
      return [name, R.names.baseNameOf(name), (c.studentName ?? '').replace(/\s+/g, '')].filter((a) => !!a).map((a) => a.toLowerCase());
    });
    aliasMemo.set(consultations, aliases);
  }
  const title = event.title.toLowerCase();
  return consultations.filter((_, i) => aliases[i].some((a) => title.includes(a)));
}
/** 2.0 consultationBasesInTitles — 일정마다 이름 글자가 든 상담만 넘겨 모은다(같은 이름 집합). */
export function consultationBases(R, events, consultations, notNames) {
  return [...new Set(events.flatMap((e) => R.consultLink.consultationBasesInTitles([e], nearTitle(R, e, consultations), notNames)))];
}
/** 2.0 matchAdmissionsConsultation — 이름 글자가 든 상담만 넘긴다(같은 답). */
export function matchConsultation(R, event, consultations, notNames, opts) {
  return R.consultLink.matchAdmissionsConsultation(event, nearTitle(R, event, consultations), notNames, opts);
}
/** 2.0 homonymFamilies(bases) — 접미사 뗀 이름마다 그 이름을 쓰는 퇴원 아닌 원생의 학교·학년 키(`like '이름%'` 뒤 접미사 뗀 이름이 정확히 같은 것만). */
export async function homonymFamilies(R, t, q, bases) {
  const safe = [...new Set(bases)].filter((base) => /^[가-힣]{2,4}$/.test(base));
  if (!safe.length) return new Map();
  const rows = await q`select id::text id, name, school, grade from public.students where tenant_id = ${t} and status::text <> 'withdrawn'
    and name like any(${safe.map((base) => `${base}%`)}::text[]) order by id`;
  const families = new Map();
  for (const row of rows) {
    const base = R.names.baseNameOf(row.name.trim());
    if (!safe.includes(base)) continue;
    families.set(base, [...(families.get(base) ?? []), { studentId: row.id, key: R.classLink.schoolGradeKey(row.school, row.grade) }]);
  }
  return families;
}
/** 2.0 firstClassCandidates(오늘, 창 끝) — 휴원 아닌 수강 · 학생·반 필수(반은 운영 중) · 창과 겹치는 수강. */
export async function firstClassCandidates(t, q, fromDate, toDate) {
  return (await q`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
      s.name, s.school, s.grade, c.class_name, c.subject, c.closed_at::text closed_at
    from public.enrollments e join public.students s on s.id = e.student_id and s.tenant_id = ${t}
      join public.classes c on c.id = e.class_id and c.tenant_id = ${t} and c.is_active = true
    where e.tenant_id = ${t} and e.on_hold = false and e.start_date <= ${toDate} and (e.end_date is null or e.end_date >= ${fromDate}) order by e.id`)
    .map((r) => ({ studentId: r.student_id, studentName: r.name, school: r.school, grade: r.grade, classId: r.class_id, className: r.class_name, subject: r.subject,
      startDate: r.start_date, endDate: r.end_date, onHold: r.on_hold, isTransferred: r.is_transferred, closedAt: r.closed_at }));
}
/** 2.0 firstClassScheduleCandidates(오늘, 창 끝) — 운영 중 반의 배치 중 창과 겹치는 것 · 강사 = 칸 강사 → 칸 글자 → 담임. */
export async function firstClassScheduleCandidates(t, q, fromDate, toDate) {
  return (await q`select cs.class_id::text class_id, cs.day_of_week::text day_of_week, cs.start_time::text start_time, cs.valid_from::text valid_from,
      cs.valid_to::text valid_to, cs.slot_teacher_label, st.display_name slot_teacher, c.class_name, c.subject, c.closed_at::text closed_at, ht.display_name homeroom
    from public.class_schedules cs join public.classes c on c.id = cs.class_id and c.tenant_id = ${t} and c.is_active = true
      left join public.users st on st.id = cs.teacher_id and st.tenant_id = ${t} left join public.users ht on ht.id = c.teacher_id and ht.tenant_id = ${t}
    where cs.tenant_id = ${t} and cs.valid_from <= ${toDate} and (cs.valid_to is null or cs.valid_to >= ${fromDate}) order by cs.id`)
    .map((r) => ({ classId: r.class_id, className: r.class_name, subject: r.subject, dayOfWeek: r.day_of_week, startTime: r.start_time,
      teacherName: r.slot_teacher ?? r.slot_teacher_label ?? r.homeroom ?? null, validFrom: r.valid_from, validTo: r.valid_to, closedAt: r.closed_at }));
}
/**
 * 2.0 calendar 영역 — 전일 첫날(어제 · 월요일엔 토요일) ~ 오늘부터 한 달의 입학 일정(취소 포함, 오늘 전 줄은 레벨테스트만) · 살아 있는 일정만 반·상담에 잇는다.
 * 일정 표가 없으면(ready false) 2.0처럼 영역 실패.
 */
async function calendar(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, t = ctx.t;
  const { end } = R.window.monthAheadWindow(today), since = consultationSince(R, today), prevFrom = R.prevDay.previousDayRange(today).from;
  const result = await dateRangeEvents(R, gate, t, prevFrom, end);
  if (!result.ready) throw new Error('학원 일정 연결 확인 필요');
  const upcoming = R.display.upcomingAdmissionsEvents(result.events, prevFrom, end)
    .filter((event) => event.endDate >= today || R.display.admissionsEventBaseKind(event) === 'levelTest');
  const live = upcoming.filter((e) => !R.cancelled.isCancelledEventTitle(e.title));
  // 반 연결(첫 수업) — 원생·수업 메뉴가 있고 '첫 수업' 일정이 있을 때만 · 둘 중 하나라도 실패하면 둘 다 빈 목록(2.0 구조 분해가 일어나지 않는다).
  let candidates = [], classSlots = [];
  if (ctx.allowed.includes('students') && ctx.allowed.includes('classes') && live.some((e) => /첫\s*수업/.test(`${e.title} ${e.tag?.name ?? ''}`))) {
    [candidates, classSlots] = await gate.soft((s) => Promise.all([firstClassCandidates(t, s, today, end), firstClassScheduleCandidates(t, s, today, end)]), [[], []]);
  }
  // 상담 연결 후보 — 콜&상담 메뉴가 있을 때만 · 실패하면 링크만 없다.
  const consultations = ctx.allowed.includes('enrollment') ? await gate.soft((s) => consultationRows(ctx, R, s, since), []) : [];
  const subjectLabels = R.subjects.subjectLabelRecord(ctx.settings.operations.subjects), notNames = Object.values(subjectLabels);
  // 동명이인 가족 — 조회가 실패하면 상담 연결을 통째로 끈다(null).
  const bases = consultationBases(R, live, consultations, notNames);
  const families = bases.length ? await gate.soft((s) => homonymFamilies(R, t, s, bases), null) : new Map();
  return admissionsRows(R, upcoming, { candidates, classSlots, consultations, families, subjectLabels, notNames, since });
}
/**
 * 2.0 calendar 영역의 일정 줄 — 취소된 일정은 목록에 남기되 잇지 않는다(kind null · 원래 종류는 cancelledKind) · 학생으로 확정된 반이 먼저, 없으면 시간표 슬롯 반 ·
 * 동명이인 가족을 못 읽었으면(null) 상담 연결 없음 · 제목의 이름은 연결된 원생의 정식 이름으로. `since` = 상담 후보를 읽은 첫날(매처 창의 하한).
 * 운영실 흐름(레벨테스트의 과목별)이 같은 줄로 과목을 정한다.
 */
export function admissionsRows(R, upcoming, { candidates, classSlots, consultations, families, subjectLabels, notNames, since }) {
  return upcoming.map((event) => {
    if (R.cancelled.isCancelledEventTitle(event.title)) {
      return { id: event.id, title: event.title, startDate: event.startDate, endDate: event.endDate, startTime: event.startTime, source: event.source,
        kind: null, cancelledKind: R.display.admissionsEventBaseKind(event), matchedClass: null, matchedConsultation: null };
    }
    const byStudent = R.classLink.matchFirstClass(event, candidates, subjectLabels);
    const matchedClass = byStudent ?? R.classLink.matchFirstClassSchedule(event, classSlots, subjectLabels);
    const matchedConsultation = families ? matchConsultation(R, event, consultations, notNames, { since, families }) : null;
    return { id: event.id, title: event.title, displayTitle: R.consultLink.canonicalEventTitle(event.title, byStudent?.studentName ?? matchedConsultation?.name),
      startDate: event.startDate, endDate: event.endDate, startTime: event.startTime, source: event.source, kind: R.display.admissionsEventKind(event),
      matchedClass, matchedConsultation };
  });
}
/** 2.0 levelTestDatesByConsultation — 레벨테스트 일정 → 그 상담(일정 카드와 같은 매처·창·동명이인 규칙) · 동명이인 조회 실패 = null(모름). */
async function levelTestDates(R, gate, t, events, consultations, notNames, since) {
  const levelTests = events.filter((event) => R.display.admissionsEventKind(event) === 'levelTest'), byConsultation = new Map();
  if (!levelTests.length) return byConsultation;
  const bases = consultationBases(R, levelTests, consultations, notNames);
  let families = new Map();
  if (bases.length) {
    families = await gate.soft((s) => homonymFamilies(R, t, s, bases), null);
    if (!families) return null;
  }
  for (const event of levelTests) {
    const hit = matchConsultation(R, event, consultations, notNames, { since, families });
    if (hit) byConsultation.set(hit.id, [...(byConsultation.get(hit.id) ?? []), event.startDate]);
  }
  return byConsultation;
}
/**
 * 2.0 consultProgress 영역 — 최근 60일 상담(일정 카드와 같은 조회) × 연결 원생의 미종료 수강 × 레벨테스트 일정.
 * 일정 메뉴가 없거나 일정을 못 읽으면 입테만 '모름'(levelTest null) · 상담 후보·수강 조회 실패는 영역 실패.
 */
async function consultProgress(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, t = ctx.t;
  const { end } = R.window.monthAheadWindow(today), since = consultationSince(R, today);
  const rows = await consultationRows(ctx, R, gate, since);
  let calendarRead = null;
  if (ctx.allowed.includes('calendar')) {
    try { calendarRead = await dateRangeEvents(R, gate, t, since, end); } catch (e) { if (e instanceof GateMisuseError) throw e; calendarRead = null; }
  }
  const events = calendarRead?.ready ? calendarRead.events : null;
  const notNames = Object.values(R.subjects.subjectLabelRecord(ctx.settings.operations.subjects));
  // 2.0 progressEnrollments — 연결 원생의 미종료 수강(종료일 없음 또는 오늘 이후 · 반 필수) · 시작일 · 반 과목.
  const studentIds = [...new Set(rows.flatMap((c) => (c.studentId ? [c.studentId] : [])))];
  const enrollments = studentIds.length ? (await gate`select e.student_id::text student_id, e.start_date::text start_date, c.subject from public.enrollments e
      join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
    where e.tenant_id = ${t} and e.student_id = any(${studentIds}::uuid[]) and (e.end_date is null or e.end_date >= ${today}) order by e.id`)
    .map((r) => ({ studentId: r.student_id, subject: r.subject ?? null, startDate: r.start_date })) : [];
  const levelTests = events ? await levelTestDates(R, gate, t, events, rows, notNames, since) : null;
  const classKeysOf = R.consult.consultClassKeysOf(ctx.settings.operations.subjects);
  const list = rows.map((c) => R.progress.progressOf({ id: c.id, name: c.name, outcome: c.outcome, consultedOn: c.consultedOn, subject: c.subject,
    classKeys: classKeysOf(c.subject), studentId: c.studentId }, enrollments, levelTests ? (levelTests.get(c.id) ?? []) : null, today));
  // 2.0 consultProgressData — 단계별 인원·멈춘 상담·칩.
  return { summary: R.progress.summarizeProgress(list, today, levelTests !== null), chips: Object.fromEntries(list.map((p) => [p.id, R.progress.chipOf(p, today)])) };
}

// ── 직원 구성 · 운영 현황 · 공지 ──────────────────────────────────────────────────────────────────────────────────────
/** 2.0 staff() — 재직 중 직원(학생 계정 제외)의 표시 역할별 인원 + 과목 묶음. */
async function staff(ctx, sp) {
  const R = await rules(ctx.importV2), chinsan = R.preset.isChinsanTenant(ctx.settings);
  const rows = await sp`select id::text id, system_role::text system_role, subjects from public.users
    where tenant_id=${ctx.t} and status::text = 'active' and system_role::text <> 'student' order by id`;
  return R.staff.staffComposition(rows.map((r) => ({ role: R.display.staffDisplayRole(r, chinsan), subjects: r.subjects })), ctx.settings.operations.subjects);
}
/** 2.0 getApprovalBoxes(보는 사람)의 `waiting.length` — 관련 문서(기안 200 · 결재선 300 · 참조 300) 중 내 차례이거나 내 후결 확인이 남은 것. */
async function approvalWaiting(s, t, me) {
  const [mine, asApprover, asRef] = await Promise.all([
    s`select id::text id from public.approval_documents where tenant_id=${t} and drafter_id=${me} order by submitted_at desc limit 200`,
    s`select document_id::text id from public.approval_steps where tenant_id=${t} and approver_id=${me} order by created_at desc limit 300`,
    s`select document_id::text id from public.approval_refs where tenant_id=${t} and user_id=${me} order by created_at desc limit 300`]);
  const ids = [...new Set([...mine, ...asApprover, ...asRef].map((r) => r.id))];
  if (!ids.length) return 0;
  const [docs, steps] = await Promise.all([
    s`select id::text id, status::text status, current_step from public.approval_documents where tenant_id=${t} and id = any(${ids}::uuid[])`,
    s`select document_id::text document_id, step_no, approver_id::text approver_id, decision::text decision from public.approval_steps
      where tenant_id=${t} and document_id = any(${ids}::uuid[]) order by step_no`]);
  const stepsBy = new Map();
  for (const st of steps) stepsBy.set(st.document_id, [...(stepsBy.get(st.document_id) ?? []), { stepNo: Number(st.step_no), approverId: st.approver_id, decision: st.decision }]);
  // 2.0 isMyTurn(진행 중 · 현재 단계 결재자가 나 · 아직 결재 전) · needsMyDeferredConfirm(부재로 건너뛴 내 칸).
  return docs.filter((d) => {
    const cells = stepsBy.get(d.id) ?? [], now = cells.find((c) => c.stepNo === Number(d.current_step));
    return (d.status === 'pending' && !!now && now.approverId === me && now.decision === 'pending') || cells.some((c) => c.approverId === me && c.decision === 'deferred');
  }).length;
}
/** 2.0 operations(allowed, 보는 사람) — 메뉴 권한이 있는 칸만 · 칸마다 조회 실패 = 건수 null(0으로 위장하지 않는다). 순서 = 2.0 jobs 순. */
async function operations(ctx, sp) {
  const gate = queryGate(sp), t = ctx.t, has = (menu) => ctx.allowed.includes(menu), jobs = [];
  const count = (query) => gate.soft(async (s) => (await query(s))[0].n, null);
  const one = (label, href, unit, n) => [{ label, href, count: n, unit }];
  if (has('meetings')) jobs.push(count((s) => s`select count(*)::int n from public.meeting_minutes where tenant_id=${t}`).then((n) => one('회의록', '/meetings', '건', n)));
  if (has('documents')) jobs.push(count((s) => s`select count(*)::int n from public.academy_documents where tenant_id=${t} and staff_user_id is null`)
    .then((n) => one('공용 문서', '/documents', '건', n)));
  if (has('shuttle')) jobs.push(count((s) => s`select count(*)::int n from public.shuttle_vehicles where tenant_id=${t} and archived = false`).then((n) => one('운행 차량', '/shuttle', '대', n)));
  if (has('approvals')) jobs.push(gate.soft((s) => approvalWaiting(s, t, ctx.user.id), null).then((n) => one('내 결재 대기', '/approvals', '건', n)));
  if (has('inventory')) jobs.push(Promise.all([count((s) => s`select count(*)::int n from public.inventory_assets where tenant_id=${t}`),
    count((s) => s`select count(*)::int n from public.inventory_supplies where tenant_id=${t}`)])
    .then(([assets, supplies]) => [{ label: '등록 자산', href: '/inventory', count: assets, unit: '개' }, { label: '소모품 품목', href: '/inventory?tab=supplies', count: supplies, unit: '종' }]));
  return (await Promise.all(jobs)).flat();
}
/** 2.0 getRecentAnnouncements(역할, 4) — 그 역할이 받는 대상의 공지 · 고정 먼저 · 최근 순. */
async function notices(ctx, sp) {
  const R = await rules(ctx.importV2);
  const rows = await sp`select a.id, a.title, a.content, a.audience::text audience, a.pinned, to_json(a.created_at)#>>'{}' created_at, u.display_name author_name
    from public.announcements a left join public.users u on u.id = a.author_id and u.tenant_id = ${ctx.t}
    where a.tenant_id=${ctx.t} and a.audience::text = any(${R.audience.audiencesForRole(ctx.user.role)}::text[]) order by a.pinned desc, a.created_at desc limit 4`;
  return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, audience: r.audience, pinned: r.pinned, createdAt: r.created_at, authorName: r.author_name ?? null }));
}

/** 이 단계에서 옮긴 영역(2.0 `Area` 키). */
export const ADMISSIONS_AREAS = { admissions, consultations, newcomers, calendar, consultProgress, staff, operations, notices };
