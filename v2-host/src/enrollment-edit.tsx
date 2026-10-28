// 2.0 신규 콜&상담 수정(app/(shell)/enrollment/[id]/edit/page.tsx)의 조립 — 서버가 하던 조회는 /api/v2/enrollment?v2path=/enrollment/<id>/edit
// (Docker 복사본, v2-enrollment-detail.mjs)가 하고 본문은 **글자 그대로**(enrollment-edit.swaps.json 짝만). 저장은 2.0 updateEnrollmentConsultation →
// 3.0 actions(v2-enrollment-save.mjs) — 바꾼 칸만 저장 · 후속 조치 · 상담자 계정 · 소개한 사람이 2.0과 같다.
import { BackLink } from "@/components/back-link";
import type { ConsultationDetail } from "@/features/enrollment/server/queries";
import type { ReferrerOption } from "@/features/enrollment/referrer";
import { ConsultationFullForm } from "@/app/(shell)/enrollment/_components/consultation-full-form";

/** /api/v2/enrollment?v2path=/enrollment/<id>/edit — 2.0 page가 서버에서 받던 값(viewer = 저장하는 사람). */
export type EnrollmentEditData = {
  id: string;
  viewer: { id: string; tenantId: string };
  consult: ConsultationDetail | null;
  referrer: { ready: boolean; referrer: ReferrerOption | null; referrerName: string | null };
  candidates: ReferrerOption[];
};

export function EditEnrollmentPage({
  data,
}: {
  data: EnrollmentEditData;
}) {
  const viewer = data.viewer;
  const id = data.id;
  const [c, ref] = [data.consult, data.referrer];
  if (!c) return null;
  const f = c.fields;
  // 아직 잇지 않은 소개 — 글에 이름이 그대로 나온 원생·직원을 후보로(소개 흔적이 있을 때만 목록을 읽는다).
  const candidates = data.candidates;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/enrollment/${id}`} label="상세로" />
      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">신규 콜&상담 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{c.prospectName}</h1>
      </header>

      <ConsultationFullForm
        key={c.id}
        recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
        mode="edit"
        confirmConsultedOnSave={c.fromPublicIntake && ["pending", "scheduled"].includes(c.outcome)}
        aiSuggestedParentRequest={c.aiFormSuggestions?.parentRequest ?? null}
        existingRecordings={c.recordings.map((r) => ({ createdAt: r.createdAt, status: r.status }))}
        initial={{
          id: c.id,
          prospectName: c.prospectName,
          prospectGrade: c.prospectGrade,
          prospectSchool: c.prospectSchool,
          parentName: c.parentName,
          parentPhone: c.parentPhone,
          parentRequest: c.parentRequest,
          englishName: f.englishName,
          gender: f.gender,
          bloodType: f.bloodType,
          birthDate: f.birthDate,
          studentPhone: f.studentPhone,
          homePhone: f.homePhone,
          parentRelation: f.parentRelation,
          address: f.address,
          zipCode: f.zipCode,
          addressDetail: f.addressDetail,
          consultationPath: f.consultationPath,
          subject: f.subject,
          careerGoal: f.careerGoal,
          siblings: f.siblings,
          safetyNotes: f.safetyNotes,
          assignedClassCount: c.assignedClassCount,
          followUpDate: f.followUpDate,
          outcome: c.outcome,
          followUpContent: f.followUpContent,
          nonRegistrationReason: f.nonRegistrationReason,
          shuttleBusRequest: f.shuttleBusRequest,
          privacyAgreement: f.privacyAgreement,
          installmentAgreement: f.installmentAgreement,
          subjectDetails: f.subjectDetails,
          intakeChecklist: f.intakeChecklist,
          counselor: f.counselor,
          receivedDate: f.receivedDate,
          studentType: f.studentType,
          siblingsDetails: f.siblingsDetails,
          consultationDate: f.consultationDate,
          prevAcademy: (c.learningHistory as { prevAcademy?: string | null } | null)?.prevAcademy ?? null,
          lastScore: (c.learningHistory as { lastScore?: string | null } | null)?.lastScore ?? null,
          referrerReady: ref.ready,
          referrer: ref.referrer,
          referrerName: ref.referrerName,
          referrerCandidates: candidates,
        }}
      />
    </div>
  );
}
