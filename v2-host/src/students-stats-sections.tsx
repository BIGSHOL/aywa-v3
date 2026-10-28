// GENERATED from the 2.0 sections.tsx by v2-students-stats-sections-generate.mjs.
import type { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { programLabel, type Program } from "@/features/students/enrollment/program";
import { distinctSubjectTokens, tokenColor, type TrendView } from "@/features/students/stats/model";
import type { MixKey } from "@/features/dashboard/overview/enrolled-trend";
import { courseBounds, flowBounds, trendBounds } from "@/features/students/stats/bounds";
import { firstFlowMonth, firstNonZeroMonth } from "@/features/students/stats/model";
import { historyFlowRows, historyTrendPoints, joinFlowRows, joinNote } from "@/features/students/stats/joined";
import type { HistoryMonth } from "@/features/students/stats/history";
import type { StudentStats, StudentStatsParts } from "@/features/students/stats/server/load";
import { StatCard } from "@/app/(shell)/students/stats/_components/stat-card";
import { TrendBoard } from "@/app/(shell)/students/stats/_components/trend-board";
import { CourseBoard } from "@/app/(shell)/students/stats/_components/course-board";
import { FlowBoard } from "@/app/(shell)/students/stats/_components/flow-board";
import { HistoryBoard } from "@/app/(shell)/students/stats/_components/history-board";
import { FirstClassBoard } from "@/app/(shell)/students/stats/_components/first-class-board";

/**
 * 원생 통계 **카드별 구역**(리뷰 2026-10-21 속도 — 화면이 카드마다 `<Suspense>`로 감싼다). 구역마다 제 조회만 기다린다 — 강좌수·월별 기록은
 * 재원생 추이의 경계(`bounds.ts`)를 쓰므로 그 조회도 함께 기다린다(같은 promise라 한 번만 돈다).
 */
type ReadyParts = { [K in keyof StudentStatsParts]: Awaited<StudentStatsParts[K]> };
export type ReadyStats = Omit<StudentStats, "trustFrom" | "parts"> & { trustFrom: string | null; parts: ReadyParts | null };
type Ctx = { stats: ReadyStats; parts: ReadyParts; settings: Awaited<ReturnType<typeof getTenantSettings>>; scopeLabel: string | null };

/** 수강 구성 선 — 운영실 '재원생 구성'·'학년별 재원생' 범례와 같은 이름·색(영어 빨강 · 동시수강 보라 · 수학 파랑). */
const MIX_META: Record<MixKey, { label: string; color: string }> = {
  englishOnly: { label: "영어만", color: DASHBOARD_SUBJECT_COLORS.english },
  both: { label: "동시수강", color: DASHBOARD_SUBJECT_COLORS.both },
  mathOnly: { label: "수학만", color: DASHBOARD_SUBJECT_COLORS.math },
  otherOnly: { label: "그 밖의 과목만", color: DASHBOARD_SUBJECT_COLORS.other },
};
/** 강좌수 프로그램 선 — 수학 파랑 · 인재원 영어 빨강(운영실 프로그램 색) · EiE는 영어와 갈리게 금색. */
export const PROGRAM_COLOR: Record<Program, string> = { math: DASHBOARD_SUBJECT_COLORS.math, injaewon: DASHBOARD_SUBJECT_COLORS.english, eie: tokenColor("gold") };

/** 카드가 오기 전 자리 — **같은 id**라 운영실 '상세'(`#first` 등)가 먼저 그 자리로 스크롤된다(내용이 오면 그 자리에 선다). */
export function SectionSkeleton({ id, title, height = "h-96" }: { id: string; title: string; height?: string }) {
  return (
    <section id={id} aria-label={title} aria-busy="true" className={`border-line bg-bg-soft/40 scroll-mt-4 animate-pulse rounded-2xl border ${height}`}>
      <span className="sr-only">{title} 불러오는 중</span>
    </section>
  );
}

function trendContext({ stats, parts, scopeLabel }: Ctx) {
  const trend = parts.trend, trustFrom = stats.trustFrom;
  const bounds = { ...stats.bounds, trustFrom };
  return { trend, bounds, ...trendBounds(bounds, trend.data?.total.monthly ?? null, scopeLabel) };
}

/**
 * 전체 추이에 이을 '지난 기록'(원장 2026-10-21 *"이어질 수 있는 데이터는 다 이어서"*) — 학원 전체 값이라 **과목 관리자 화면엔 잇지 않는다**
 * (담당 과목 전체 선에 학원 전체 수를 붙이면 거짓이다). 지난 기록을 못 읽으면 종전대로(이은 점 없음 · 카드는 그대로 선다).
 */
function historyMonths({ parts, scopeLabel }: Ctx): HistoryMonth[] {
  if (scopeLabel) return [];
  const history = parts.history;
  return history.data?.months ?? [];
}

export function TrendSection(props: Ctx & { view: TrendView; boardKey: string; keep: Record<string, string | undefined> }) {
  const { stats, settings, scopeLabel, view, boardKey, keep } = props;
  const { trend, bounds, countFrom, clipNote } = trendContext(props), months = historyMonths(props);
  if (!trend.data) return <StatCard id="trend" title="재원생 추이" note="달마다 말일 기준" error />;
  // 에이와로 셀 수 있는 첫 달 앞을 지난 기록으로(경계가 없으면 에이와 월별 첫 점 앞을) — 겹치는 달은 에이와(joinPoints).
  // 경계가 없으면(퇴원 기록이 처음부터 다 있는 지점) 에이와 첫 학생이 있는 달 — 창 앞쪽의 0인 달이 지난 기록을 덮지 않게(리뷰 2026-10-21).
  const aywaFirst = countFrom ?? firstNonZeroMonth(trend.data.total.monthly) ?? trend.data.total.monthly[0]?.key ?? null;
  const history = historyTrendPoints(months, aywaFirst);
  const historyNote = joinNote(history.monthly, months, aywaFirst);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const tokens = distinctSubjectTokens(settings.operations.subjects.map((s) => ({ key: s.key, color: subjectMaps.colorOf(s.key) })));
  const data = trend.data;
  return (
    <TrendBoard
      key={`trend|${boardKey}`}
      total={data.total}
      subjects={data.bySubject.map((s) => ({
        key: `subject:${s.key}`,
        label: subjectMaps.labelOf(s.key),
        color: tokenColor(tokens.get(s.key) ?? subjectMaps.colorOf(s.key)),
        set: s,
      }))}
      mixes={[
        ...data.byMix.map((m) => ({ key: `mix:${m.key}`, label: MIX_META[m.key].label, color: MIX_META[m.key].color, set: m })),
        // 미수강(그날 걸린 수강이 없는 재원생 — 운영실 '재원생 구성'의 미수강) — 구성을 쌓았을 때 합이 학원 전체와 같게.
        ...(data.byMix.length ? [{ key: "mix:unknown", label: "미수강", color: DASHBOARD_SUBJECT_COLORS.unenrolled, set: data.unknown }] : []),
      ]}
      countFrom={countFrom}
      breakdownFrom={bounds.breakdownFrom}
      clipNote={clipNote}
      history={history.monthly.length ? history : null}
      historyNote={historyNote}
      period={stats.trendPeriod}
      keep={keep}
      today={stats.today}
      scopeLabel={scopeLabel}
      initial={{ range: stats.prefs.range, view, off: stats.prefs.off, kind: stats.prefs.trendKind }}
    />
  );
}

/** 강좌수 추이(원장 2026-10-20 '카드 따로') — 재원생 추이와 같은 아래 경계(countFrom)·같은 경계 문장. */
export function CourseSection(props: Ctx & { boardKey: string }) {
  const { stats, parts, settings, scopeLabel, boardKey } = props;
  const courses = parts.courses, ctx = trendContext(props);
  if (!courses.data) return courses.error ? <StatCard id="courses" title="강좌수 추이" note="학생마다 같은 과목은 1개" error /> : null;
  const { courseFrom, courseClipNote } = courseBounds(ctx.bounds, ctx);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const tokens = distinctSubjectTokens(courses.data.bySubject.map((s) => ({ key: s.key, color: subjectMaps.colorOf(s.key) })));
  return (
    <CourseBoard
      key={`courses|${boardKey}`}
      total={courses.data.total}
      subjects={courses.data.bySubject.map((p) => ({ key: `subject:${p.key}`, label: subjectMaps.labelOf(p.key), color: tokenColor(tokens.get(p.key) ?? subjectMaps.colorOf(p.key)), set: p }))}
      countFrom={courseFrom}
      clipNote={courseClipNote}
      today={stats.today}
      scopeLabel={scopeLabel}
      initial={{ range: stats.prefs.courseRange, kind: stats.prefs.courseKind, off: stats.prefs.courseOff }}
    />
  );
}

/** 첫 수업 추이(원장 2026-10-20 *"오늘 첫수업도 마찬가지"*) — 운영실 '오늘첫수업' ↗가 연다(월별 · 일별 · 구간). */
export function FirstClassSection({ stats, parts, scopeLabel, keep }: Ctx & { keep: Record<string, string | undefined> }) {
  const firstClass = parts.firstClass;
  return <FirstClassBoard trend={firstClass.data} period={stats.firstPeriod} today={stats.today} keep={keep} scopeLabel={scopeLabel} initialKind={stats.prefs.firstKind} />;
}

export function FlowSection(props: Ctx & { boardKey: string }) {
  const { stats, parts, scopeLabel, boardKey } = props;
  const flow = parts.flow, ctx = trendContext(props), months = historyMonths(props);
  if (!flow.data) return <StatCard id="flow" title="등록 · 퇴원 추이" note="달마다 등록·퇴원" error />;
  const { flowFrom, monthEnd } = flowBounds(ctx.bounds, flow.data, ctx.trend.data?.total.monthly ?? null, scopeLabel);
  // 셀 수 있는 첫 달 앞을 지난 기록으로 잇는다(등록 = 수업을 시작한 등록 · 퇴원 칸 = 청구가 끊긴 학생) — 말일 재원생도 같은 지난 기록 값으로.
  const aywaRows = flowFrom ? flow.data.filter((r) => r.month >= flowFrom) : flow.data;
  const aywaFirst = flowFrom ?? firstFlowMonth(aywaRows) ?? aywaRows[0]?.month ?? null;
  const rows = joinFlowRows(historyFlowRows(months, aywaFirst), aywaRows);
  const historyEnd = Object.fromEntries(historyTrendPoints(months, aywaFirst).monthly.map((p) => [p.key, p.count]));
  return (
    <FlowBoard
      key={`flow|${boardKey}`}
      rows={rows}
      from={null}
      monthEnd={monthEnd ? { ...historyEnd, ...monthEnd } : Object.keys(historyEnd).length ? historyEnd : null}
      initialRange={stats.prefs.flowRange}
      initialKind={stats.prefs.flowKind}
      scopeLabel={scopeLabel}
    />
  );
}

/** 지난 기록(메이크에듀 + 에이와 청구) — 값이 없는 지점은 카드를 세우지 않는다 · 학원 전체 값이라 과목 관리자에겐 그렇게 적는다. */
export function HistorySection({ stats, parts, settings, scopeLabel }: Ctx) {
  const history = parts.history;
  if (history.error) return <StatCard id="history" title="지난 기록" note="수업료가 청구된 학생 · 실제 신규" error />;
  if (!history.data?.months.length) return null;
  const label = (p: Program) => ({ label: programLabel(p, settings.operations.subjects, stats.eieOn), color: PROGRAM_COLOR[p] });
  // 그 밖의 과목(국어·과학…) 이름·색 — 재원생 추이 과목별 선과 같은 값(원장 2026-10-28 *"과목별로 분리가능한 수준까지"*).
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const tokens = distinctSubjectTokens(settings.operations.subjects.map((s) => ({ key: s.key, color: subjectMaps.colorOf(s.key) })));
  const subjects = Object.fromEntries(
    settings.operations.subjects.map((s) => [s.key, { label: subjectMaps.labelOf(s.key), color: tokenColor(tokens.get(s.key) ?? subjectMaps.colorOf(s.key)) }]),
  );
  return (
    <HistoryBoard
      months={history.data.months}
      aywaFrom={history.data.aywaFrom}
      aywaAt={history.data.aywaAt}
      payingHidden={history.data.payingHidden}
      initialView={stats.prefs.historyView}
      wide={!!scopeLabel}
      programs={{ math: label("math"), injaewon: label("injaewon"), eie: label("eie"), subjects }}
    />
  );
}
