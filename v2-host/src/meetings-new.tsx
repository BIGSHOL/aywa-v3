// 2.0 새 회의록(app/(shell)/meetings/new/page.tsx)의 조립 — 서버가 하던 일(보는 사람)은 /api/v2/meetings?v2path=/meetings/new(Docker 복사본)가 하고
// 본문은 **글자 그대로**(meetings-new.swaps.json 짝만). 메모만으로 만들기 = 2.0 createTextMeeting → 3.0 actions. 녹음 업로드·전사는 진입점이 거절한다.
import { BackLink } from "@/components/back-link";
import { formInstanceKey } from "@/lib/recording-resume";
import { NewMeetingForm } from "@/app/(shell)/meetings/new/new-meeting-form";

/** /api/v2/meetings?v2path=/meetings/new — 2.0 page가 서버에서 받던 값(viewer = 저장하는 사람). */
export type MeetingNewData = { viewer: { id: string; tenantId: string } };

export function NewMeetingPage({
  data,
  sp: searchParams,
}: {
  data: MeetingNewData;
  sp: { form?: string };
}) {
  const viewer = data.viewer;
  // 작성 화면 한 벌 = `form` — 녹음이 걸린 회의록이 있을 때 연 새 작성 화면(recording-resume.ts). 같은 주소에서 쿼리만
  // 바뀌면 Next가 폼을 그대로 두므로 key로 갈라 새로 그린다.
  const { form } = searchParams;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <BackLink href="/meetings" label="회의록으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">새 회의록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">녹음 업로드 + 자동 분석</h1>
        <p className="text-muted-foreground text-sm">
          MP3/M4A/WAV 등 음성 파일을 올리면 한국어 전사 후 8개 섹션으로 자동 분석합니다.
          브라우저에서 바로 녹음할 수도 있습니다. 다른 화면으로 이동해도 녹음은 계속되며, 녹음 아이콘에서 진행 상황을 확인할 수 있습니다.
        </p>
      </header>

      <NewMeetingForm key={formInstanceKey(form)} recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
        instance={{ formId: typeof form === "string" ? form : undefined }} />
    </div>
  );
}
