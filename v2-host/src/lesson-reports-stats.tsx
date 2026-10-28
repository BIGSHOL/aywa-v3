// 2.0 lesson-reports/stats/page.tsx — 서버 컴포넌트라 그대로 불러올 수 없어서, 게이트·조회는 /api/v2/lesson-reports?v2path=/lesson-reports/stats(Docker 복사본 ·
// v2-lesson-reports-stats.mjs)가 내고 여기서는 본문을 글자 그대로 옮겼다(lesson-reports-stats.swaps.json). 받아 오는 부품 = 위 LessonReportsStats.
import { useEffect, useMemo, useState } from "react";
import { OperationsProvider } from "@/features/owner/operations-context";
import { setCopyDay } from "./students-shared";
import { onHostRefresh } from "../shims/host-nav";
import { setHostEditors } from "../shims/server-action";
import { useSearchParams } from "../shims/next-navigation";
import { HostMessage } from "./host-frame";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { loadReportStats } from "@/features/lesson-reports/stats/load";
import type { TenantSettings } from "@/features/owner/settings-types";
import { PERIOD_KEYS } from "@/features/stats/period";
import { BackToListButton } from "@/app/(shell)/consultations/_components/back-to-list-button";
import { StatCard } from "@/app/(shell)/students/stats/_components/stat-card";
import { ReportTrendCard } from "@/app/(shell)/lesson-reports/stats/report-trend-card";
import { CardNow } from "@/app/(shell)/lesson-reports/stats/card-now";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** 통계 주소 열쇠 = 2.0 PERIOD_KEYS + subject(v2-lesson-reports-stats.mjs STATS_KEYS와 같다 — 시험이 대조). */
const STATS_KEYS = ["grain", "month", "from", "to", "span", "subject"] as const;
type StatsLoaded = { key?: string; data?: { page?: string; today: string; stats: Awaited<ReturnType<typeof loadReportStats>>; settings: { modules: { disabled?: unknown }; operations: TenantSettings["operations"] } }; noAccess?: boolean; error?: string };

/** /lesson-reports/stats — 복사본에서 받은 자료로 2.0 통계 화면을 그린다(새로고침 신호를 받으면 다시 받는다). */
export function LessonReportsStats() {
  const search = useSearchParams();
  const { sp, query } = useMemo(() => {
    const sp = Object.fromEntries(STATS_KEYS.flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? ""]] : []))) as Record<string, string>;
    return { sp, query: new URLSearchParams({ v2path: "/lesson-reports/stats", ...sp }).toString() };
  }, [search]);
  const [state, setState] = useState<StatsLoaded>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/lesson-reports?${query}`, { headers: { Accept: "application/json" } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || "보고서 통계를 불러오지 못했습니다."); return body; })
      .then((body) => { if (live && Array.isArray(body?.editors)) setHostEditors(body.editors); return body; })
      .then((body) => live && setState(body?.noAccess ? { key: query, noAccess: true } : body?.page === "stats" ? { key: query, data: body } : { key: query, error: "보고서 통계를 불러오지 못했습니다." }))
      .catch((e: Error) => live && setState({ key: query, error: e.message }));
    return () => { live = false; };
  }, [query, tick]);
  if (state.key !== query) return <HostMessage text="보고서 통계를 불러오는 중…" />;
  if (state.error) return <HostMessage text={state.error} error />;
  if (state.noAccess || !state.data) return <HostMessage text="고른 사람은 이 화면을 볼 수 없습니다." />;
  const data = state.data;
  setCopyDay(data.today);
  const ops = data.settings.operations as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.settings.modules.disabled as never}>
      <ReportStatsPage sp={sp} stats={data.stats} settings={data.settings} />
    </OperationsProvider>
  );
}

/**
 * 수업보고서 **통계 화면**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 운영실 '학습 · 학부모 보고'의 '상세'가 여기로 온다.
 * 숙제 60% 미만 기록 비율 · 발송 후 48시간 안 학부모 확인율을 월별 12·24개월 · 일별 · 구간으로(RPC 0388a — 카드와 같은 판정).
 * 권한 = 보고서 목록과 같은 `lesson_reports` 게이트 · 과목 관리자는 그 과목(`?subject=` 전환) · 강사 화면엔 없다.
 */
export function ReportStatsPage({ sp, stats, settings }: { sp: Record<string, string | string[] | undefined>; stats: Awaited<ReturnType<typeof loadReportStats>>; settings: Pick<TenantSettings, "operations"> }) {
  // 게이트 · 자료 = 서버가 2.0 requireAccess("lesson_reports") · loadReportStats(readPeriodParams(sp), sp.subject) · getTenantSettings를 복사본에서 낸 값.
  const scope = stats.scope;
  const labels = buildSubjectMaps(settings.operations.subjects);
  const subjectsLabel = scope ? `${scope.label} 보고서` : stats.tracked.length ? `${stats.tracked.map((k) => labels.labelOf(k)).join("·")} 보고서` : "모든 과목 보고서";
  const keepPeriod = Object.fromEntries(Object.values(PERIOD_KEYS).map((k) => [k, one(sp[k])]).filter((e): e is [string, string] => !!e[1]));
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader title="보고서 통계" description={`${stats.classnoteOn ? "숙제 수행 · 학부모 확인 추이" : "숙제 수행 추이"} — ${subjectsLabel}`} embedLabel="보고서 통계" />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/lesson-reports?tab=list" />
        {scope?.active && scope.choices.length > 1 ? (
          <div role="group" aria-label="볼 과목" className={TOOLBAR_SEG_BOX}>
            {scope.choices.map((c) => (
              <EmbedLink
                key={c.key}
                href={`/lesson-reports/stats?${new URLSearchParams({ subject: c.key, ...keepPeriod }).toString()}`}
                aria-current={c.key === scope.active ? "page" : undefined}
                className={`${TOOLBAR_SEG_ITEM} ${c.key === scope.active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {c.label}
              </EmbedLink>
            ))}
          </div>
        ) : null}
      </div>
      {stats.teacherScoped ? (
        <StatCard id="reports" title="학습 · 학부모 보고 추이" note="강사 화면">
          <p className="text-muted-foreground text-sm break-keep">강사 화면에서는 보고서 통계를 보이지 않습니다. 내 보고서는 보고서 목록에서 볼 수 있습니다.</p>
        </StatCard>
      ) : stats.scopeEmpty ? (
        <StatCard id="reports" title="학습 · 학부모 보고 추이" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        // `#reports`(운영실 '상세' · 기간 바꿈 뒤 자리) = '현재 확인할 항목'부터 — 추이 카드로 바로 가면 위 숫자 상자가 화면 밖으로 밀린다(리뷰 2026-10-21).
        <div id="reports" className="scroll-mt-4 space-y-4 compact-chrome:space-y-3">
          <CardNow homework={stats.card.homework} unread={stats.card.unread} classnoteOn={stats.classnoteOn} />
          <ReportTrendCard
            trend={stats.trend}
            period={stats.period}
            today={stats.today}
            keep={{ subject: one(sp.subject) }}
            subjectsLabel={subjectsLabel}
            classnoteOn={stats.classnoteOn}
          />
        </div>
      )}
    </div>
  );
}
