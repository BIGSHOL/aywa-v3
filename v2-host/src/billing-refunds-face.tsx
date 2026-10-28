// 2.0 refunds-face.tsx(app/(shell)/billing/_components/) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회·게이트는 /api/v2/billing(Docker 복사본, v2-billing-refunds.mjs — 보는 사람 신분 + RLS)이 하고
// 여기서는 본문을 **글자 그대로** 옮겼다(billing-refunds.swaps.json — 조회 자리 · 상대 경로 import만).
import { Plus, ReceiptText } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import type { RefundListRow } from "@/features/billing/server/refund-queries";
import type { RefundsFaceData } from "./billing-types";
import { kstMonth, monthLabel } from "@/lib/date-kst";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";

const PAGE_SIZE = 50;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" });

// 수강반: 서식 textarea에 여러 반을 줄바꿈으로 입력 → 줄 단위로 분해(목록은 쉼표, 전체는 hover).
const classLinesOf = (cn: string) =>
  (cn ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// 환불의 '월' = 환불처리일자(YYYY-MM-DD) 우선, 미입력이면 작성일 기준(월 필터에서 숨김 방지).
function monthOf(r: RefundListRow): string {
  return /^\d{4}-\d{2}-\d{2}/.test(r.requestDate) ? r.requestDate.slice(0, 7) : r.createdAt.slice(0, 7);
}

/**
 * 환불 요청서 면(/billing?tab=refunds) — 웹에서 작성한 환불처리요청서 목록. 작성본은 데이터베이스
 * (수납·결제, 사무실 전용 열람)에 저장되고, 여기와 /documents 양쪽에서 같은 행이 보인다. (직원 이력서 패턴)
 *
 * 월별 필터 — 환불처리일자 기준(미입력이면 작성월). 기본 표시월은 가장 최근 데이터 월(첫 로드에 빈 달 방지). 데이터 없으면 이번 달.
 * 월 이동은 공용 BillingMonthNav(PeriodNav + `월:` 드롭다운 — 기록이 있는 달만, 디자인 v5 14단계).
 */
export function RefundsFace({ sp, data }: { sp: { page?: string; period?: string }; data: RefundsFaceData }) {
  const { canWrite, all } = data;

  const monthsWithData = [...new Set(all.map(monthOf))].sort().reverse();
  const defaultPeriod = monthsWithData[0] ?? kstMonth();
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : defaultPeriod;

  const monthRows = all.filter((r) => monthOf(r) === period);
  const totalPages = Math.max(1, Math.ceil(monthRows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), totalPages);
  const rows = monthRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const monthHref = (per: string) =>
    `/billing?${new URLSearchParams({ tab: "refunds", period: per }).toString()}`;
  const pageHref = (p: number) => {
    const q = new URLSearchParams({ tab: "refunds", period });
    if (p > 1) q.set("page", String(p));
    return `/billing?${q.toString()}`;
  };

  return (
    <section className="space-y-3">
      {/* 기간·결과·등록을 한 줄에서 확인한다. */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {all.length > 0 ? (
          <BillingMonthNav period={period} hrefFor={monthHref} months={monthsWithData} defaultPeriod={defaultPeriod} ariaLabel="환불 월 선택" />
        ) : null}
        <p className="text-text-dim text-sm">
          환불 요청서{" "}
          <span className="num text-foreground font-bold">{monthRows.length}</span>건
          <span className="text-text-faint ml-2">· 전체 {all.length}건 · 환불처리일자 기준(미입력 시 작성월)</span>
        </p>
        {canWrite ? (
          <Button className="ml-auto shrink-0" render={<WindowLink href="/billing/refunds/new" title="환불 요청서 작성" />}>
            <Plus className="size-4" />새 환불 요청서
          </Button>
        ) : null}
      </div>

      {all.length === 0 ? (
        <EmptyState
          image="billing"
          icon={() => <ReceiptText size={32} strokeWidth={1.8} />}
          title="작성된 환불 요청서가 없습니다"
          description="'새 환불 요청서'로 종이 서식과 같은 항목을 웹에서 입력하세요 — 인쇄·작성·보관이 한 번에 됩니다."
        />
      ) : (
        <>
          {monthRows.length === 0 ? (
            <div className="bg-card border-line text-text-dim rounded-2xl border px-4 py-10 text-center text-sm">
              {monthLabel(period)}에 작성된 환불 요청서가 없습니다.
            </div>
          ) : (
            <>
              <DragScrollArea className="bg-card border-line rounded-2xl border">
                <table className="w-full text-sm">
                  {/* 표 머리 = 16px 굵게(수납 면 v5 규약 — 옛 text-xs font-medium). */}
                  <thead>
                    <tr className="text-text-dim border-line border-b text-left text-sm [&_th]:font-bold [&_th]:whitespace-nowrap">
                      <th className="px-4 py-2.5">학생</th>
                      <th className="px-3 py-2.5">수강반</th>
                      <th className="px-3 py-2.5">환불처리일자</th>
                      <th className="px-3 py-2.5">환불완료일자</th>
                      <th className="px-3 py-2.5">총 환불금액</th>
                      <th className="px-3 py-2.5">작성일</th>
                      <th className="px-3 py-2.5">담당자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-line hover:bg-bg-soft/50 border-t transition-colors">
                        <td className="px-4 py-2">
                          <WindowLink
                            href={`/billing/refunds/${r.id}`}
                            title={`환불 요청서 — ${r.name}`}
                            className="text-foreground hover:text-primary inline-flex items-center gap-2 font-medium hover:underline"
                          >
                            <ReceiptText className="text-danger size-4 shrink-0" />
                            {r.name}
                          </WindowLink>
                        </td>
                        {/* 수강반 여러 개(줄바꿈 입력) → 쉼표로 축약 표시 + 마우스 올리면 전체(title, 줄 단위). */}
                        <td
                          className="text-text-dim max-w-40 truncate px-3 py-2"
                          title={classLinesOf(r.className).join("\n") || undefined}
                        >
                          {classLinesOf(r.className).join(", ") || "—"}
                        </td>
                        {/* '환불처리일자'·'담당자'는 헤더만 리네임 — 데이터는 기존 그대로(서식 환불요청일자·작성자). 사용자 지시. */}
                        <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.requestDate || "—"}</td>
                        <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.completedDate || "—"}</td>
                        <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.totalAmount || "—"}</td>
                        <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(r.createdAt)}</td>
                        <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.authorName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DragScrollArea>
              <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={monthRows.length} />
            </>
          )}
        </>
      )}
    </section>
  );
}
