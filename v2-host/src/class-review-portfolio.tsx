// 2.0 직원 포트폴리오 면(app/(shell)/class-review/_components/portfolio/portfolio-face.tsx — 서버 컴포넌트)의 조립 — 조회(getPortfolioView ·
// canWriteTenant)는 /api/v2/class-review?tab=portfolio가 2.0 함수로 하고 본문은 **글자 그대로**(class-review-portfolio.swaps.json 짝만).
// 🔴 서버는 2.0 게이트(원장 역할 · 자기 눈)를 지난 사람에게만 이 면의 조회를 한다. 계정 보기 설정은 3.0엔 없다(prefs = {} — 2.0 기본값).
import { EmptyState } from "@/components/empty-state";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import type { PortfolioView } from "@/features/teacher-portfolio/server/queries";
import { dayLabel } from "@/features/teacher-portfolio/view";
import { PortfolioBoard, RefreshButton } from "@/app/(shell)/class-review/_components/portfolio/portfolio-board";

/** /api/v2/class-review?tab=portfolio — 2.0 PortfolioFace가 서버에서 받던 값. */
export type PortfolioFaceData = { view: PortfolioView | null; canRefresh: boolean; prefs: Record<string, unknown> };

/**
 * 직원 평가 > 직원 포트폴리오 면. 저장된 달만 읽는다 — 무거운 집계는 매일 cron과 [지금 집계]가 한다.
 * 저장 표가 아직 없거나(SQL 적용 전) 첫 집계 전이면 빈 상태로 안내한다(화면이 죽지 않는다 — #95).
 */
export function PortfolioFace({ data }: { data: PortfolioFaceData }) {
  const [view, canRefresh, prefs] = [data.view, data.canRefresh, data.prefs];
  // 항목별 내역 '점수 기준' 상자 접힘 — 계정 귀속(원장 2026-10-14 *"접고 펼치기해서 컴팩트 가능하게"*).
  const ruleCollapsed = (prefs.portfolio as { ruleCollapsed?: unknown } | undefined)?.ruleCollapsed === true;
  // 직원 비교 표의 정렬 — 계정 귀속(모든 뷰 세팅). 모양이 틀리면 기본(총점 높은 순).
  const saved = (prefs.portfolio as { compareSort?: { key?: unknown; dir?: unknown } } | undefined)?.compareSort;
  const compareSort = typeof saved?.key === "string" && (saved.dir === "asc" || saved.dir === "desc")
    ? { key: saved.key, dir: saved.dir as "asc" | "desc" } : undefined;
  if (!view) return <EmptyState compact title="직원 포트폴리오를 볼 권한이 없습니다" />;
  if (view.state !== "ready") {
    return view.state === "tableMissing"
      ? <EmptyState compact title="직원 포트폴리오를 준비하고 있습니다" description="저장 준비가 끝나면 강사별 월간 점수가 표시됩니다." />
      : (
        <EmptyState compact title="아직 집계한 점수가 없습니다" description="매일 새벽에 자동으로 집계합니다. 지금 바로 보려면 집계를 시작하세요."
          action={canRefresh ? <RefreshButton label="지금 집계 시작" /> : undefined} />
      );
  }
  const computedAt = view.selected.periods[0]?.closing.computedAt ?? null;
  const day = kstDateOf(computedAt);
  return (
    <PortfolioBoard teachers={view.teachers} selected={view.selected} studentNames={view.studentNames} studentSchools={view.studentSchools} canRefresh={canRefresh} ruleCollapsed={ruleCollapsed} compareSort={compareSort}
      computedLabel={day ? `${dayLabel(day)} ${kstTimeOf(computedAt) ?? ""}`.trim() : "—"} />
  );
}
