// 2.0 refunds/new/page.tsx(app/(shell)/billing/) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회·게이트는 /api/v2/billing(Docker 복사본, v2-billing-refunds.mjs — 보는 사람 신분 + RLS)이 하고
// 여기서는 본문을 **글자 그대로** 옮겼다(billing-refunds.swaps.json — 조회 자리 · 상대 경로 import만).
import { BackLink } from "@/components/back-link";
import { emptyRefund } from "@/features/billing/refund-request";
import { RefundSheet } from "@/app/(shell)/billing/refunds/_components/refund-sheet";

export const metadata = { title: "환불 요청서 작성 — 에이와" };

/** 게이트(requireAccess · 수납 쓰기가 아니면 목록으로)는 서버가 먼저 본다 — 여기 오면 쓸 수 있는 사람이다. */
export function NewRefundPage({ user }: { user: { id: string } }) {

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/billing?tab=refunds" label="환불 요청서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">환불 요청서 작성</h1>
        <p className="text-text-dim mt-1 text-sm">
          종이 서식의 각 칸에 바로 입력하세요 — 저장하면 데이터베이스(수납·결제)에 보관되고 언제든 다시 수정·A4 인쇄할 수 있습니다.
        </p>
      </header>
      <RefundSheet data={emptyRefund()} userId={user.id} canWrite startEditing />
    </div>
  );
}
