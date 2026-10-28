// 2.0 직원 평가 채점(app/(shell)/class-review/[id]/score/page.tsx)의 조립 — 조회(getClassReview · myScoreSlot)는 /api/v2/class-review?v2path=/class-review/<id>/score가
// 2.0 함수로 하고 본문은 **글자 그대로**(class-review-score.swaps.json 짝만). 채점 자격이 없으면 서버가 상세로 돌려보낸다(2.0 redirect).
import Link from "next/link";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import type { ReviewHeader } from "@/features/class-review/server/queries";
import type { ChecklistArea, ScoreSheet } from "@/features/class-review/checklist";
import { ScorePanel } from "@/app/(shell)/class-review/_components/score-panel";

/** /api/v2/class-review?v2path=/class-review/<id>/score — 2.0 page가 서버에서 받던 값(자기 채점 한 장). */
export type ClassReviewScoreData = { doc: { id: string; header: ReviewHeader }; areas: ChecklistArea[]; mine: { slot: string; submitted: boolean }; mySheet: ScoreSheet | null };

/**
 * 채점 전용 페이지(원장 지시 2026-08-04) — 상세(보기)와 분리. 자격자만 진입(아니면 상세로 돌려보냄).
 * 저장하면 상세로 복귀한다.
 */
export function ClassReviewScorePage({ data }: { data: ClassReviewScoreData }) {
  const id = data.doc.id;
  const { doc, areas } = data;
  const mine = data.mine;
  const mySheet = data.mySheet;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <div>
        <Link
          href={`/class-review/${id}`}
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 상세로 돌아가기
        </Link>
        <PageHeader
          eyebrow="직원 평가"
          title={`${mine.slot === "self" ? "본인 평가" : "채점"} — ${doc.header.teacherName} · ${doc.header.date}`}
          description="문항마다 1~4점을 누르고 마지막에 저장하세요. 저장하면 상세 화면으로 돌아갑니다."
          embedLabel={`채점 — ${doc.header.teacherName}`}
        />
      </div>
      <ScorePanel
        docId={doc.id}
        areas={areas}
        initialScores={mySheet?.scores ?? []}
        initialComment={mySheet?.comment ?? ""}
        backHref={`/class-review/${id}`}
      />
    </div>
  );
}
