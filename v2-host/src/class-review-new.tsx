// 2.0 새 직원 평가(app/(shell)/class-review/new/page.tsx)의 조립 — 조회(getStaffOptions · getChecklistTemplates)는 /api/v2/class-review?v2path=/class-review/new가
// 2.0 함수로 하고 본문은 **글자 그대로**(class-review-new.swaps.json 짝만). 자기 평가 전용(강사)이면 서버가 목록으로 돌려보낸다(2.0 redirect).
import { PageHeader } from "@/components/page-header";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { StaffOption } from "@/features/meetings/server/queries";
import type { ChecklistTemplate } from "@/features/class-review/server/queries";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { NewReviewForm } from "@/app/(shell)/class-review/_components/new-review-form";

/** /api/v2/class-review?v2path=/class-review/new — 2.0 page가 서버에서 받던 값. */
export type ClassReviewNewData = { staff: StaffOption[]; templates: ChecklistTemplate[]; settings: { operations: { subjects: SubjectSetting[] } } };

/**
 * 새 평가 건 — 강사·과목·문항 세트 + 평가자 지정. 날짜는 생성 당일 자동(원장 지시 2026-08-05).
 * 강사 직급은 자기 평가 전용(원장 2026-08-19)이라 개설은 사무실 몫 — 서버 액션이 거절하므로
 * 폼(직원 명단이 다 보이는 화면)을 아예 열지 않는다.
 */
export function NewClassReviewPage({ data }: { data: ClassReviewNewData }) {
  const [staff, settings, templates] = [data.staff, data.settings, data.templates];
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <PageHeader eyebrow="직원 평가" title="새 평가" description="평가 대상과 평가자 방식을 정합니다." embedLabel="새 평가" />
      <NewReviewForm
        staff={staff.map((s) => ({ value: s.id, label: s.jobTitle ? `${s.name} · ${s.jobTitle}` : s.name }))}
        subjects={subjects.options}
        templates={templates.map((t) => ({ value: t.id, label: t.name }))}
      />
    </div>
  );
}
