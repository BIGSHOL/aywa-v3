// GENERATED from the 2.0 sections.tsx by v2-students-stats-sections-generate.mjs.
import type { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { isEnglishProgramKey, programLabel, subjectGroupOf } from "@/features/students/enrollment/program";
import { distinctSubjectTokens, tokenColor, type TrendView } from "@/features/students/stats/model";
import type { MixKey } from "@/features/dashboard/overview/enrolled-trend";
import { courseBounds, flowBounds, trendBounds } from "@/features/students/stats/bounds";
import { firstFlowMonth, firstNonZeroMonth } from "@/features/students/stats/model";
import { bridgedText, courseJoinNote, historyCoursePoints, historyFlowRows, historyGroupPoints, historyTrendPoints, joinFlowRows, joinNote } from "@/features/students/stats/joined";
import type { HistoryMonth } from "@/features/students/stats/history";
import type { StudentStats, StudentStatsParts } from "@/features/students/stats/server/load";
import { StatCard } from "@/app/(shell)/students/stats/_components/stat-card";
import { TrendBoard } from "@/app/(shell)/students/stats/_components/trend-board";
import { CourseBoard } from "@/app/(shell)/students/stats/_components/course-board";
import { CourseRevenueCard } from "@/app/(shell)/students/stats/_components/course-revenue-card";
import { courseRevenueMonths, courseRevenueSummary } from "@/features/students/stats/course-revenue";
import { FlowBoard } from "@/app/(shell)/students/stats/_components/flow-board";
import { FirstClassBoard } from "@/app/(shell)/students/stats/_components/first-class-board";

/**
 * 3.0 호스트의 원생 통계 구역. 서버에서 카드별 조회를 끝낸 값을 받는다.
 * 강좌수·등록·퇴원 추이는 재원생 추이의 경계(`bounds.ts`)를 함께 쓴다.
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
 * 선 이름·색 — 영어 프로그램 키(인재원 영어 · EiE — 원장 2026-10-29 *"영어를 인재원영어 및 eie. eie는 주황색"*)는 프로그램 이름 ·
 * 인재원 영어 = 영어 빨강 · EiE = 주황. 그 밖은 학원설정 과목 이름·색(`fallback`).
 */
function lineMeta(key: string, split: boolean, settings: Ctx["settings"], eieOn: boolean, fallback: () => { label: string; color: string }) {
  if (!split || !isEnglishProgramKey(key)) return fallback();
  return { label: programLabel(key, settings.operations.subjects, eieOn), color: key === "eie" ? DASHBOARD_SUBJECT_COLORS.eie : DASHBOARD_SUBJECT_COLORS.english };
}

/**
 * 과목 선에 이을 지난 기록 — 설정 과목 키 → 그 과목 묶음의 청구 기준 추정 점(원장 2026-10-29 *"지난기록 말고 그냥 재원생과 강좌수 퇴원생에 반영"*).
 * 한 묶음에 설정 과목이 둘 이상이면(수학 · 수학(심화)) 지난 기록이 묶음 값만 있어 가를 수 없다 — 잇지 않는다. 점이 없으면 null.
 */
function groupHistory(months: readonly HistoryMonth[], before: string | null, settings: Ctx["settings"], split = false) {
  const subjects = settings.operations.subjects.map((s) => ({ key: s.key, label: s.label }));
  const groupOf = (key: string) => subjectGroupOf(key, subjects);
  const owners = new Map<string, number>();
  for (const s of subjects) {
    const g = groupOf(s.key);
    if (g) owners.set(g, (owners.get(g) ?? 0) + 1);
  }
  return {
    groupOf,
    /** `key` = 설정 과목 키(재원생 추이 — 재원생 과목 선은 설정 과목마다라 묶음을 둘 이상이 나누면 못 가른다). */
    of: (key: string) => {
      // 프로그램 키는 서버가 영어를 갈랐을 때만 프로그램이다(아니면 그 이름의 설정 과목 — 지난 기록 과목 묶음으로 본다).
      const g = split && isEnglishProgramKey(key) ? key : groupOf(key);
      if (!months.length || !g || (owners.get(g) ?? 0) > 1) return null;
      const h = historyGroupPoints(months, before, g);
      return h.monthly.length ? h : null;
    },
  };
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
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const tokens = distinctSubjectTokens(settings.operations.subjects.map((s) => ({ key: s.key, color: subjectMaps.colorOf(s.key) })));
  const data = trend.data;
  const split = !!data.englishSplit;
  const groups = groupHistory(months, aywaFirst, settings, split);
  const subjectHistory = new Map(data.bySubject.map((s) => [s.key, groups.of(s.key)]));
  // 이은 달(2025-04) 안내는 과목 선이 실제로 지난 기록을 이었을 때만(학원 전체 선은 그달 메이크에듀 재원생 기록 — 리뷰 2026-10-29).
  const subjectPoints = [...subjectHistory.values()].flatMap((h) => h?.monthly ?? []);
  const historyNote = `${joinNote(history.monthly, months, aywaFirst) ?? ""}${bridgedText(subjectPoints, months, "과목 선의 ")}`.trim() || null;
  return (
    <TrendBoard
      key={`trend|${boardKey}`}
      total={data.total}
      subjects={data.bySubject.map((s) => ({
        key: `subject:${s.key}`,
        ...lineMeta(s.key, split, settings, stats.eieOn, () => ({ label: subjectMaps.labelOf(s.key), color: tokenColor(tokens.get(s.key) ?? subjectMaps.colorOf(s.key)) })),
        set: s,
        history: subjectHistory.get(s.key) ?? null,
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
  const courses = parts.courses, ctx = trendContext(props), months = historyMonths(props), tuition = parts.tuition ?? null;
  if (!courses.data) return courses.error ? <StatCard id="courses" title="강좌수 추이" note="학생마다 같은 과목은 1개" error /> : null;
  const { courseFrom, courseClipNote } = courseBounds(ctx.bounds, ctx);
  // 셀 수 있는 첫 달 앞을 지난 기록으로(재원생 추이와 같은 규칙 — 원장 2026-10-29) — 전체 = 과목 묶음마다 청구된 학생의 합.
  const aywaFirst = courseFrom ?? firstNonZeroMonth(courses.data.total.monthly) ?? courses.data.total.monthly[0]?.key ?? null;
  // 전체 = 선마다 한 번 — 영어를 프로그램으로 갈랐으면 인재원 영어 · EiE를 따로 더한다(원장 2026-10-30 '사업자·금액이 달라 분리' —
  // 에이와 쪽 전체 선과 같은 판정 · 지난 기록 칸 payingInjaewon · payingEie).
  const split = !!courses.data.englishSplit;
  const courseGroups = [...new Set(courses.data.bySubject.map((p) => p.key))];
  const history = months.length ? historyCoursePoints(months, aywaFirst, courseGroups) : null;
  // 강좌수 과목 키는 이미 묶음이다(수학 · 수학(심화)가 한 선 — 리뷰 2026-10-29: 재원생 규칙을 쓰면 수학 몫이 '그 밖의 과목'으로 쌓였다).
  // 과목 선은 전체 선이 선 달만으로 센다 — 연도별 점(그해 마지막 달)이 전체와 같은 달이라 쌓은 합이 전체와 맞는다(같은 리뷰).
  const counted = new Set(history?.monthly.map((p) => p.key) ?? []);
  const courseMonths = months.filter((m) => counted.has(m.month));
  const lineHistory = (group: string) => {
    // 프로그램 키 이름의 설정 과목(영어를 가르지 않은 지점)은 지난 기록 프로그램 칸이 아니다 — 잇지 않는다.
    if (!split && isEnglishProgramKey(group)) return null;
    const h = courseMonths.length ? historyGroupPoints(courseMonths, aywaFirst, group) : null;
    return h?.monthly.length ? h : null;
  };
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const tokens = distinctSubjectTokens(courses.data.bySubject.map((s) => ({ key: s.key, color: subjectMaps.colorOf(s.key) })));
  // 과목 수와 매출(원장 2026-10-30) — 학원 전체 값이라 과목 관리자 화면엔 세우지 않는다 · 수납 권한이 있을 때만(tuition null이면 없음).
  // 영어를 가르지 않은 지점의 injaewon·eie 설정 키는 지난 기록 영어 칸과 겹친다 — 빼고 센다(lineHistory와 같은 규칙) · 이번 달은 뺀다.
  const revenueGroups = courseGroups.filter((g) => split || !isEnglishProgramKey(g));
  const revenue =
    !scopeLabel && tuition?.data ? courseRevenueSummary(courseRevenueMonths(months, tuition.data, revenueGroups, stats.today.slice(0, 7))) : null;
  return (
    <>
    <CourseBoard
      key={`courses|${boardKey}`}
      total={courses.data.total}
      subjects={courses.data.bySubject.map((p) => ({
        key: `subject:${p.key}`,
        ...lineMeta(p.key, split, settings, stats.eieOn, () => ({ label: subjectMaps.labelOf(p.key), color: tokenColor(tokens.get(p.key) ?? subjectMaps.colorOf(p.key)) })),
        set: p,
        history: lineHistory(p.key),
      }))}
      countFrom={courseFrom}
      clipNote={courseClipNote}
      history={history?.monthly.length ? history : null}
      historyNote={history ? courseJoinNote(history.monthly, aywaFirst, months) : null}
      today={stats.today}
      scopeLabel={scopeLabel}
      initial={{ range: stats.prefs.courseRange, kind: stats.prefs.courseKind, off: stats.prefs.courseOff }}
    />
    {revenue ? <CourseRevenueCard summary={revenue} /> : null}
    </>
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
