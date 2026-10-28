// 2.0 화면 · 수업보고서 관리 — 하위 화면 '보고서 통계'(/lesson-reports/stats · app/(shell)/lesson-reports/stats/page.tsx) 자료 모듈.
// 2.0 page.tsx: requireAccess('lesson_reports') → loadReportStats(readPeriodParams(sp), sp.subject)(features/lesson-reports/stats/load.ts) + getTenantSettings.
// Docker 복사본에서 그대로:
//  · 보는 사람 = 원장(v2-students-common studentsBase) — 강사 화면 아님(effectiveTeacherId 없음) · 과목 관리자 아님(subjectScopeOf → null).
//  · 기간 = 2.0 parseStatsPeriod — 주소에 기간이 없으면 보는 사람의 저장 보기(users.ui_prefs.reportStats.mode · 2.0 readMyUiPrefs) → paramsForMode.
//  · 추이 = RPC lesson_report_buckets(p_from, p_to, p_grain) 본문을 이 지점으로(auth_tenant_id → tenant_id · now() → 복사본을 뜬 시각) → 2.0 reportTrend.
//  · 위 숫자 상자 = 운영실과 같은 조회(v2-dashboard-billing.mjs BILLING_AREAS.homework · unread = 2.0 loadHomeworkRisk()(null) · getUnreadReports(null)).
//  · 2.0이 삼키는 조회(추이 · 숙제 · 미확인 — catch → null)는 sql.soft로 null.
// · 읽기 전용 · 바깥 호출 없음.
import { studentsBase } from './v2-students-common.mjs';
import { BILLING_AREAS } from './v2-dashboard-billing.mjs';

/** 2.0 PERIOD_KEYS + subject — 통계 화면이 읽는 주소 열쇠(page.tsx sp). */
export const STATS_KEYS = Object.freeze(['grain', 'month', 'from', 'to', 'span', 'subject']);
const REPORT_STATS_PREFS_NS = 'reportStats'; // 2.0 load.ts 상수

let rulesP = null;
const rules = (load) => (rulesP ??= Promise.all([load('features/stats/period.ts'), load('features/lesson-reports/stats/report-trend.ts')])
  .then(([period, trend]) => ({ period, trend })).catch((e) => { rulesP = null; throw e; }));

/** RPC lesson_report_buckets 본문 — 같은 판정(ok_sent · 48시간 · 성숙분) · now() = 복사본 시각. */
async function buckets(sp, t, from, to, grain, now) {
  const rows = await sp`with r as (
      select report_date, subject, homework_score,
        (classnote_status = 'success' and (edutrix_share_token is not null or source is null or source <> 'edutrix_import')) as ok_sent,
        classnote_sent_at, classnote_read_at
      from public.lesson_reports where tenant_id = ${t} and report_date between ${from} and ${to})
    select case when ${grain} = 'day' then to_char(report_date, 'YYYY-MM-DD') else to_char(report_date, 'YYYY-MM') end as bucket,
      subject, homework_score, count(*)::int reports,
      count(*) filter (where ok_sent)::int sent,
      count(*) filter (where ok_sent and classnote_read_at is not null and classnote_read_at <= classnote_sent_at + interval '48 hours')::int read48,
      count(*) filter (where ok_sent and classnote_read_at is null and classnote_sent_at < ${now}::timestamptz - interval '48 hours')::int unread,
      count(*) filter (where ok_sent and classnote_sent_at < ${now}::timestamptz - interval '48 hours')::int sent_mature,
      count(*) filter (where ok_sent and classnote_sent_at < ${now}::timestamptz - interval '48 hours'
        and classnote_read_at is not null and classnote_read_at <= classnote_sent_at + interval '48 hours')::int read48_mature
    from r group by 1, 2, 3 order by 1, 2, 3`;
  return rows.map((r) => ({ ...r }));
}

/** 2.0 loadReportStats(params, requestedSubject) — 원장 기준. */
export async function loadReportStats(base, sp) {
  const X = await rules(base.load), today = base.today, settings = base.settings;
  const params = X.period.readPeriodParams(sp);
  const [prefRow] = await base.sql`select ui_prefs->${REPORT_STATS_PREFS_NS}->'mode' mode from public.users where id=${base.viewer.id} and tenant_id=${base.t}`;
  const mode = X.period.parsePeriodMode(prefRow?.mode ?? undefined);
  const period = X.period.parseStatsPeriod(X.period.hasPeriodParams(params) || !mode ? params : X.period.paramsForMode(mode, today), today);
  const tracked = (settings.report.classnoteSubjects ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
  const classnoteOn = base.RR.isModuleEnabled(settings.modules.disabled, 'classnote');
  const out = { today, period, teacherScoped: false, scope: null, scopeEmpty: false, tracked, trend: null, classnoteOn, card: { homework: null, unread: null } };
  const from = period.grain === 'month' ? `${period.months[0]}-01` : period.from;
  const to = period.grain === 'month' ? today : period.to;
  const area = { importV2: base.load, settings, today, t: base.t, RR: base.RR, clock: base.clock };
  const [rows, homework, unread] = await Promise.all([
    base.sql.soft((sp) => buckets(sp, base.t, from, to, period.grain, base.clock.at), null),
    base.sql.soft((sp) => BILLING_AREAS.homework(area, sp), null),
    classnoteOn ? base.sql.soft((sp) => BILLING_AREAS.unread(area, sp), null) : Promise.resolve(null),
  ]);
  return { ...out, trend: rows ? X.trend.reportTrend({ rows, period, tracked, inScope: undefined }) : null, card: { homework, unread } };
}

/** 화면 GET(v2path=/lesson-reports/stats) — 2.0 requireAccess('lesson_reports') → 통계 + 부품이 읽는 학원 설정 칸. */
export async function buildReportStats({ sql: tx, tenantId: t, importV2, params = {}, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer) return { notFound: true };
  if (base.level('lesson_reports') === 'none') return { noAccess: true };
  const sp = Object.fromEntries(STATS_KEYS.flatMap((k) => (typeof params[k] === 'string' ? [[k, params[k]]] : [])));
  return {
    page: 'stats', today: base.today, stats: await loadReportStats(base, sp),
    settings: { modules: base.settings.modules, operations: base.settings.operations },
  };
}
