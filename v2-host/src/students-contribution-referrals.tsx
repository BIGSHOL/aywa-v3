import { ReferralReview } from "./students-contribution-referral-review";
import type { ReviewDisplayReport } from "@/features/student-contribution/model/review-display";
import { ContributionHeader } from "./students-contribution-header";

type Data = { gate: { canWrite: boolean; canConfigure: boolean }; report: ReviewDisplayReport | null;
  students: { id: string; name: string; school: string | null; grade: string | null }[] };

export function ContributionReferrals({ studentId, data }: { studentId: string; data: Data }) {
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader studentId={studentId} title="지난 소개 확인"
      description="과거 상담에 남은 소개자 정보를 확인합니다. 후보와 상담 원본을 대조한 뒤 학생에게 연결할 수 있습니다."
      active="referrals" canConfigure />
    {data.report ? <ReferralReview report={data.report} students={data.students} canWrite={data.gate.canWrite} />
      : <div className="rounded-xl border border-line p-10 text-center"><p className="font-semibold">아직 소개 확인 목록이 없습니다.</p>
        <p className="mt-2 text-sm">첫 집계 후 표시됩니다. 과거 소개의 자동 연결은 승인 후 별도로 실행합니다.</p></div>}
  </div>;
}
