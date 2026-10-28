// 2.0 원생상담 상세(app/(shell)/consultations/[id]/page.tsx)를 호스트로 옮긴 것 — 자료 받는 머리(requireAccess · getStudentConsultationById ·
// getTenantSettings · notFound)만 /api/v2/consultations가 준 값으로 바꾸고 나머지는 원문 그대로(verify가 글자를 대조한다).
// 후속 조치 '완료 표시'(FollowUpToggle) = 업무 흐름 신호 followup_due를 끝내는 자리. AI 분석 단추는 2.0 그대로 서지만 새 분석은 하지 않는다(저장된 결과만).
import { MessageSquare, Mic, Pencil, Pin, Sparkles } from "@/components/icons/aywa-icon-compat";
import { BackLink } from "@/components/back-link";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import type { StudentConsultationDetail } from "@/features/consultations/server/queries";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { RecordingPanel } from "@/app/(shell)/consultations/_components/recording-panel";
import { ConsultationDeleteButton } from "@/app/(shell)/consultations/_components/consultation-delete-button";
import { FollowUpToggle } from "@/app/(shell)/consultations/_components/follow-up-toggle";
import { AUDIENCE_LABEL, CATEGORY_META, URGENCY_META } from "@/app/(shell)/consultations/_components/consultation-meta";

/** /api/v2/consultations?v2path=/consultations/<id> — 2.0 page가 서버에서 받던 값. */
export type ConsultationDetailData = { operations: { subjects: SubjectSetting[] }; item: StudentConsultationDetail };

export function ConsultationDetailPage({ data }: { data: ConsultationDetailData }) {
  const [item, settings] = [data.item, { operations: data.operations }];
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const cat = item.category ? CATEGORY_META[item.category] : null;
  const urgency = URGENCY_META[followUpUrgency(item.followUpDate, item.followUpDone)];
  const consultedDate = new Date(item.consultedAt).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const hasFollowUp = !!(item.followUpAction || item.followUpDate);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/consultations" label="원생상담으로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="min-w-0 space-y-1.5">
          <p className="eyebrow">원생상담 상세</p>
          <h1 className="font-bold tracking-tight text-foreground flex flex-wrap items-center gap-2 text-2xl">
            <WindowLink
              href={`/students/${item.studentId}`}
              title="학생 상세"
              className="hover:text-primary transition-colors"
            >
              {item.studentName}
            </WindowLink>
            {item.studentGrade ? (
              <span className="text-text-dim text-base font-normal">{item.studentGrade}</span>
            ) : null}
            <EditingBadge scope={`student-consultation:${item.id}`} />
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {cat ? <Pill color={cat.color}>{cat.label}</Pill> : null}
            {item.subject ? <Pill color="neutral">{subjects.labelOf(item.subject)}</Pill> : null}
            {item.audience ? (
              <Pill color="neutral">{AUDIENCE_LABEL[item.audience] ?? item.audience}</Pill>
            ) : null}
            {urgency ? <Pill color={urgency.color}>후속 {urgency.label}</Pill> : null}
            {item.hasAudio ? (
              <Pill color="blue">
                <Mic className="mr-0.5 size-3" /> 녹음
              </Pill>
            ) : null}
            {item.hasAi ? (
              <Pill color="gold">
                <Sparkles className="mr-0.5 size-3" /> AI
              </Pill>
            ) : null}
            {item.syncAddedAt ? <MakeeduOriginTag /> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            render={
              <WindowLink href={`/consultations/${item.id}/edit`} title="상담 수정" />
            }
          >
            <Pencil className="size-4" />
            {/* 상세 화면 헤더의 편집 버튼은 여는 대상을 적는다(반 수정·학생 수정·이력서 수정과 같은 규칙). */}
            상담 수정
          </Button>
          <ConsultationDeleteButton
            id={item.id}
            studentId={item.studentId}
            redirectTo="/consultations"
          />
        </div>
      </header>

      {/* 메타 — 상담일·상담사 */}
      <div className="text-text-dim flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="whitespace-nowrap">상담일 {consultedDate}</span>
        {item.counselorName ? (
          <span className="whitespace-nowrap">상담사 {item.counselorName}</span>
        ) : null}
        {/* 반(0318a) — 저장된 반. 아직 판정 안 한 옛 기록은 목록과 같은 판정을 **표시만** 한다(getStudentConsultationById — 목록엔 반이
            보이는데 상세는 '—'면 두 화면이 다른 말을 한다). 칸이 없던 때(적용 전)는 줄 자체를 안 그린다. */}
        {item.classSupported ? (
          <span className="whitespace-nowrap">
            반 {item.className ?? "—"}
            {item.classSource === "manual" ? " (직접 고름)" : null}
          </span>
        ) : null}
      </div>

      {/* 상담 내용 */}
      <section className="bg-card border-line rounded-2xl border p-4">
        <h2 className="text-primary mb-3 flex items-center gap-1.5 text-sm font-bold">
          <MessageSquare className="size-4" />
          상담 내용
        </h2>
        <p className="text-foreground max-h-96 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
          {item.summary}
        </p>
      </section>

      {/* 후속 조치 — 내용 있을 때만 */}
      {hasFollowUp ? (
        <section className="bg-card border-line rounded-2xl border p-4">
          <h2 className="text-primary mb-3 flex items-center gap-2 text-sm font-bold">
            <Pin className="size-4" />
            후속 조치
            <FollowUpToggle id={item.id} done={item.followUpDone} />
          </h2>
          {item.followUpAction ? (
            <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
              {item.followUpAction}
            </p>
          ) : null}
          {item.followUpDate ? (
            <p className="text-text-dim mt-2 text-xs">예정일 {item.followUpDate}</p>
          ) : null}
        </section>
      ) : null}

      {/* 녹음·전사·AI 분석(읽기 콘텐츠 + 명시적 'AI 분석' 버튼) */}
      <RecordingPanel
        id={item.id}
        processingStatus={item.processingStatus}
        transcription={item.transcription}
        audioDurationSec={item.audioDurationSec}
        processingError={item.processingError}
        aiReport={item.aiReport}
        aiGeneratedAt={item.aiGeneratedAt}
        aiModelVersion={item.aiModelVersion}
      />
    </div>
  );
}
