// 2.0 billing/stats/page.tsx — 서버 컴포넌트라 그대로 불러올 수 없어서, 게이트·조회는 /api/v2/billing(Docker 복사본)이
// **2.0 서버 함수를 그대로** 돌려(v2-billing-stats.mjs · 공용 러너) 내고 여기서는 본문을 글자 그대로 옮겼다(billing-stats.swaps.json).
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import type { loadBillingStats } from "@/features/billing/stats/load";
import { parseStatsPeriod } from "@/features/stats/period";
import { BackToListButton } from "@/app/(shell)/consultations/_components/back-to-list-button";
import { StatCard } from "@/app/(shell)/students/stats/_components/stat-card";
import { BillingTrendCard } from "@/app/(shell)/billing/stats/billing-trend-card";
import { ExpenseTrendCard } from "@/app/(shell)/billing/stats/expense-trend-card";
import { TuitionHistoryCard } from "@/app/(shell)/billing/stats/tuition-history-card";
import { EXPENSE_TREND_KEYS } from "@/features/billing/stats/expense-trend";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * 수납 **통계 화면**(원장 2026-10-20 *"청구수납에 대해서도 상세 추이를 볼 수 있게. 지금 수납 상세 페이지로 이동하는데"*) — 운영실
 * '6개월 청구 · 수납'·'수납 현황'의 '상세'가 여기로 온다. 청구월별 실청구 · 수납 · 미수를 12·24개월로(이번 달 = 카드 값).
 * 일별은 없다 — 수납의 결제일은 청구서마다 대표 날짜 하나라 하루로 나누면 실제와 달라진다(코덱스 협의 2026-10-20).
 * 권한 = 수납관리와 같은 `billing` 게이트 · 과목 관리자는 운영실과 같은 청구 항목별 값(`?subject=` 전환).
 */
export function BillingStatsPage({ sp, stats }: { sp: Record<string, string | string[] | undefined>; stats: Awaited<ReturnType<typeof loadBillingStats>> }) {
  // 게이트 · 자료 = 서버가 2.0 requireAccess("billing") · loadBillingStats(같은 인자 — readPeriodParams · monthSpanOf · EXPENSE_TREND_KEYS)를 그대로 돌려 낸 값.
  // 두 카드의 기간은 서로 들고 다닌다 — 한쪽 기간을 바꿔도 다른 쪽이 기본값으로 돌아가지 않게.
  const expenseKeep = Object.fromEntries(Object.values(EXPENSE_TREND_KEYS).map((k) => [k, one(sp[k])]));
  const period = parseStatsPeriod({ span: String(stats.months.length) }, stats.today);
  const scope = stats.scope;
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader
        title="수납 통계"
        description={scope ? `청구월별 실청구 · 수납 · 미수(${scope.label} 청구 항목 기준) · 지출` : "청구월별 실청구 · 수납 · 미수 · 지출"}
        embedLabel="수납 통계"
      />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/billing" />
        {scope?.active && scope.choices.length > 1 ? (
          <div role="group" aria-label="볼 과목" className={TOOLBAR_SEG_BOX}>
            {scope.choices.map((c) => (
              <EmbedLink
                key={c.key}
                href={`/billing/stats?${new URLSearchParams(
                  Object.fromEntries(Object.entries({ subject: c.key, span: one(sp.span), ...expenseKeep }).filter((e): e is [string, string] => !!e[1])),
                ).toString()}`}
                aria-current={c.key === scope.active ? "page" : undefined}
                className={`${TOOLBAR_SEG_ITEM} ${c.key === scope.active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {c.label}
              </EmbedLink>
            ))}
          </div>
        ) : null}
      </div>
      {stats.scopeEmpty ? (
        <StatCard id="billing" title="청구 · 수납 추이" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        <BillingTrendCard
          rows={stats.rows}
          next={stats.next}
          period={period}
          today={stats.today}
          scoped={!!scope}
          keep={{ subject: one(sp.subject), ...expenseKeep }}
        />
      )}
      {/* 지난 기록 — 수업료 수납(원장 2026-10-21 *"청구 수납도 더 이전 데이터 못찾나?"*) — 학원 전체 값이라 과목 관리자에겐 세우지 않는다. */}
      {!scope && !stats.scopeEmpty && stats.tuition?.length ? <TuitionHistoryCard months={stats.tuition} initialView={stats.tuitionView} /> : null}
      {!scope && !stats.scopeEmpty && stats.tuition === null ? <StatCard id="tuition-history" title="지난 기록 — 수업료 수납" note="메이크에듀 + 에이와 청구" error /> : null}
      {/* 지출 추이(학원 전체 — 운영실 지출 카드처럼 과목으로 가르지 않는다) — 운영실 '이번 달 지출 내역' 상세가 `#expenses`로 온다. */}
      <ExpenseTrendCard
        trend={stats.expenses}
        period={stats.expensePeriod}
        today={stats.today}
        keep={{ subject: one(sp.subject), span: one(sp.span) }}
        academyWide={!!scope}
      />
    </div>
  );
}
