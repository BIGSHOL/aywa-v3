// 퇴원 상세 — 2.0 `src/app/(shell)/withdrawals/[studentId]/page.tsx`의 그리기를 그대로 옮겼다. 서버가 하던 조회·권한 판정
// (getWithdrawalDetail · loadStudentReportRecords · loadLinkedConsultations · 날짜 정정 자격 · 쓰기 · 재원 복구 · 원생 열기)은 load가 준다.
// 사유 저장 · 상담 추적 · 재원 복구 · 수강 날짜 칸은 2.0 부품이 2.0 서버 함수 이름으로 부른다(Docker 복사본에 저장).
import { BookOpen, MessagesSquare, ScrollText } from "@/components/icons/aywa-icon-compat";
import { canEditEnrollmentDateClass, type EnrollmentDateAccess } from "@/features/enrollments/date-access";
import { WindowLink } from "@/components/workspace/window-link";
import { BackLink } from "@/components/back-link";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import { REASON_LABEL, reasonDisplay, type WithdrawalMetadata } from "@/features/withdrawals/types";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import type { SubjectSetting } from "@/features/owner/settings-types";
import type { StudentReportRecords } from "@/features/withdrawal-reports/server/student-records";
import type { LinkedConsultations } from "@/features/withdrawals/server/linked-consultations";
import { ConsultationTracker } from "@/app/(shell)/withdrawals/_components/consultation-tracker";
import { DetailCard as Card } from "@/app/(shell)/withdrawals/_components/detail-card";
import { LinkedConsultationsCard } from "@/app/(shell)/withdrawals/_components/linked-consultations-card";
import { LinkedReportsCard } from "@/app/(shell)/withdrawals/_components/linked-reports-card";
import { ReactivateButton } from "@/app/(shell)/withdrawals/_components/reactivate-button";
import { WithdrawalReasonCard } from "@/app/(shell)/withdrawals/_components/reason-card";
import { ReportDateBadge } from "@/app/(shell)/withdrawals/_components/report-date-badge";
import { kstDateOf } from "@/lib/date-kst";

export type DetailData = {
  settings: { operations: { subjects: SubjectSetting[] } };
  detail: {
    id: string; name: string; school: string | null; grade: string | null; enrolledAt: string | null; withdrawnAt: string | null;
    metadata: WithdrawalMetadata | null; studentStatus: string | null; studentPhone: string | null; parentPhone: string | null; parentName: string | null;
    enrollmentHistory: { id: string; classId: string | null; className: string; subject: string; teacherName: string | null; startDate: string; endDate: string | null; reason: string | null }[];
  };
  reportRecords: StudentReportRecords;
  consults: LinkedConsultations;
  dateAccess: EnrollmentDateAccess;
  canWrite: boolean;
  canReactivate: boolean;
  canOpenStudent: boolean;
};

/** enrollmentDuration(queries.ts — 서버 전용 파일이라 본문을 옮겼다) — 연·월은 KST 달력으로. */
function enrollmentDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  const [sy, sm] = (kstDateOf(start) ?? "1970-01-01").split("-").map(Number);
  const [ey, em] = (kstDateOf(end) ?? "1970-01-01").split("-").map(Number);
  let years = (ey ?? 0) - (sy ?? 0);
  let months = (em ?? 1) - (sm ?? 1);
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (parts.length === 0) {
    const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
    return `${days}일`;
  }
  return parts.join(" ");
}

export function WithdrawalDetail({ data }: { data: DetailData }) {
  const { detail, settings, reportRecords, consults, dateAccess, canWrite, canReactivate, canOpenStudent } = data;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const reportLabels = subjectLabelRecord(settings.operations.subjects);
  const md = detail.metadata;
  const duration = enrollmentDuration(detail.enrolledAt, detail.withdrawnAt);

  return (
    <div className="space-y-6">
      <BackLink href="/withdrawals" label="퇴원관리로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">퇴원 학생</p>
          <h1 className="font-bold tracking-tight text-foreground text-3xl">{detail.name}</h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {detail.grade ? <span>{detail.grade}</span> : null}
            {detail.school ? <span>· {detail.school}</span> : null}
          </p>
          {detail.studentPhone || detail.parentPhone ? (
            <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              {detail.studentPhone ? (
                <span>
                  학생{" "}
                  <a href={`tel:${detail.studentPhone}`} className="text-foreground num hover:underline">
                    {detail.studentPhone}
                  </a>
                </span>
              ) : null}
              {detail.parentPhone ? (
                <span>
                  · 학부모{detail.parentName ? `(${detail.parentName})` : ""}{" "}
                  <a href={`tel:${detail.parentPhone}`} className="text-foreground num hover:underline">
                    {detail.parentPhone}
                  </a>
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span className="num">{detail.enrolledAt ?? "—"}</span>
            <span>~</span>
            <span className="num">{detail.withdrawnAt ?? "—"}</span>
            <ReportDateBadge
              withdrawnAt={detail.studentStatus === "withdrawn" ? detail.withdrawnAt : null}
              enrollments={detail.enrollmentHistory.map((e) => ({ subject: e.subject === "?" ? null : e.subject, startDate: e.startDate, endDate: e.endDate }))}
              records={reportRecords}
              labels={reportLabels}
            />
            <span>·</span>
            <span>총 등록 기간 {duration}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canOpenStudent ? (
            <WindowLink href={`/students/${detail.id}`} title={detail.name}>
              <span className="text-primary text-sm font-semibold hover:underline">원생 상세 보기</span>
            </WindowLink>
          ) : null}
          {canReactivate ? <ReactivateButton studentId={detail.id} /> : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="퇴원 사유" icon={<ScrollText className="size-3.5" />}>
          <WithdrawalReasonCard studentId={detail.id} initialReason={md?.reason ?? null} initialDetail={md?.detail ?? null} initialMemo={md?.memo ?? null} />
        </Card>

        <Card title="상담 추적" icon={<MessagesSquare className="size-3.5" />}>
          <ConsultationTracker
            studentId={detail.id}
            readOnly={!canWrite}
            initial={md?.consultation ?? { adminCalledParent: false, teacherCalledParent: false, talkedWithStudent: false }}
          />
          <p className="text-muted-foreground mt-3 text-xs">체크하면 즉시 저장됩니다. 재등록 가능성 평가용 기록.</p>
        </Card>

        {reportRecords.status !== "hidden" ? <LinkedReportsCard records={reportRecords} studentName={detail.name} labels={reportLabels} /> : null}
        {consults.status !== "hidden" ? <LinkedConsultationsCard consults={consults} labelOf={subjects.labelOf} /> : null}
      </div>

      <div className="space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="text-primary size-4" />
            <h2 className="text-foreground text-sm font-bold">수강 이력</h2>
          </div>
          <p className="text-muted-foreground num text-xs">{detail.enrollmentHistory.length}건</p>
        </header>
        <section className="bg-card border-border rounded-2xl border">
          {detail.enrollmentHistory.length === 0 ? (
            <div className="text-muted-foreground px-5 py-8 text-center text-sm">수강 기록이 없습니다</div>
          ) : (
            <ul className="divide-border divide-y">
              {detail.enrollmentHistory.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{e.className}</p>
                    {canEditEnrollmentDateClass(dateAccess, e.classId) ? (
                      <div className="text-muted-foreground inline-flex flex-wrap items-center gap-1 text-xs">
                        <span>
                          {subjects.labelOf(e.subject)} · 담임 {e.teacherName ?? "미배정"} ·
                        </span>
                        <EditableDateCell enrollmentId={e.id} field="start" value={e.startDate} />
                        <EditableDateCell enrollmentId={e.id} field="end" value={e.endDate} />
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        {subjects.labelOf(e.subject)} · 담임 {e.teacherName ?? "미배정"} · <span className="num">{e.startDate}</span>
                        {e.endDate ? <> ~ <span className="num">{e.endDate}</span></> : <> ~ 현재</>}
                      </p>
                    )}
                  </div>
                  {e.reason ? <span className="text-muted-foreground text-xs italic">{reasonDisplay(e.reason)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-muted-foreground text-xs">카테고리: {Object.values(REASON_LABEL).join(" · ")}</p>
    </div>
  );
}
