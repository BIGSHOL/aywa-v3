// 2.0 수학 학습 진도맵 시안(app/(shell)/mcs/progress-map/page.tsx) — 샘플 데이터(buildSampleProgress)만 그리는 화면이라 서버 조회가 없다.
// 게이트(관리자 이상 · 반·학생을 주면 반 월간 집중 보기로 넘김)는 /api/v2/mcs?v2path=/mcs/progress-map이 보고, 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
import { PageHeader } from "@/components/page-header";
import { MathProgressDashboard } from "@/features/math-progress-map/components/math-progress-dashboard";
import { buildSampleProgress } from "@/features/math-progress-map/sample";

/** page.tsx `ProgressMapPage`의 시안 갈래 그리기. */
export function McsProgressMapPreview() {
  const progress = buildSampleProgress();
  return (
    <div className="flex flex-col gap-4">
      <div className="compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title="수학 학습 진도맵"
          description="학생 한 명의 연간 커리큘럼 위치 — 시안(샘플 데이터)"
        />
      </div>
      <MathProgressDashboard progress={progress} />
    </div>
  );
}
