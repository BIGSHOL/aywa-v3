// 2.0 신규 콜&상담 작성(app/(shell)/enrollment/new/page.tsx)의 조립 — 서버가 하던 일(보는 사람 · 소개 칸 확인)은 /api/v2/enrollment?v2path=/enrollment/new
// (Docker 복사본)가 하고 본문은 **글자 그대로**(enrollment-new.swaps.json 짝만). 저장은 2.0 createEnrollmentConsultation → 3.0 actions(v2-enrollment-save.mjs).
import { BackLink } from "@/components/back-link";
import { formInstanceKey } from "@/lib/recording-resume";
import { NewConsultationForm } from "@/app/(shell)/enrollment/new/form";

/** /api/v2/enrollment?v2path=/enrollment/new — 2.0 page가 서버에서 받던 값(viewer = 저장하는 사람). */
export type EnrollmentNewData = { viewer: { id: string; tenantId: string; displayName: string }; referrerReady: boolean };

export function NewEnrollmentPage({
  data,
  sp: searchParams,
}: {
  data: EnrollmentNewData;
  sp: { form?: string };
}) {
  const viewer = data.viewer;
  const { form } = searchParams;
  const referrerReady = data.referrerReady;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/enrollment" label="신규 콜&상담으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">신규 콜&상담</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">신규 콜&상담 작성</h1>
        <p className="text-muted-foreground text-sm">
          학생·학부모 정보를 입력하세요. 상담을 <strong>입력하면서 바로 녹음</strong>하거나 음성 파일을 올리면, 저장 시
          자동으로 한국어 전사 + 13섹션 AI 분석까지 실행합니다(입력하신 내용은 보존).
        </p>
      </header>

      <NewConsultationForm key={formInstanceKey(form)} recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }} referrerReady={referrerReady}
        counselor={viewer.displayName} instance={{ formId: typeof form === "string" ? form : undefined }} />
    </div>
  );
}
