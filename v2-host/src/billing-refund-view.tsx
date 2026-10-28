// 2.0 refunds/[id]/page.tsx(app/(shell)/billing/) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회·게이트는 /api/v2/billing(Docker 복사본, v2-billing-refunds.mjs — 보는 사람 신분 + RLS)이 하고
// 여기서는 본문을 **글자 그대로** 옮겼다(billing-refunds.swaps.json — 조회 자리 · 상대 경로 import만).
import { BackLink } from "@/components/back-link";
import type { RefundDetail } from "@/features/billing/server/refund-queries";
import { RefundSheet } from "@/app/(shell)/billing/refunds/_components/refund-sheet";

export const metadata = { title: "환불 요청서 — 에이와" };

/** 게이트(requireAccess) · 없는 문서(notFound)는 서버가 먼저 본다. */
export function RefundViewPage({ user, refund, canWrite }: { user: { id: string }; refund: RefundDetail; canWrite: boolean }) {
  const id = refund.id;
  const name = refund.data.student.name || "(이름 미입력)";

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/billing?tab=refunds" label="환불 요청서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">환불 요청서 — {name}</h1>
        <p className="text-text-dim text-xs">
          {new Date(refund.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 작성
          {refund.authorName ? ` · ${refund.authorName}` : ""} · 데이터베이스(수납·결제)에 저장됨
        </p>
      </header>
      <RefundSheet data={refund.data} id={id} userId={user.id} canWrite={canWrite} />
    </div>
  );
}
