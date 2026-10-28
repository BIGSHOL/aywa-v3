// 2.0 새 원생상담(app/(shell)/consultations/new/page.tsx)과 상담 수정([id]/edit/page.tsx)을 호스트로 옮긴 것 — 자료 받는 머리(requireAccess ·
// getStudentOptionsForConsultation · getTeacherOptions · getTenantSettings · getNewcomerLinkTargets · hasClassSupport · searchParams)만
// /api/v2/consultations가 준 값으로 바꾸고 화면(return 아래)은 원문 그대로(verify가 글자를 대조한다). 저장하는 사람 = 3.0 띠에서 고른 직원(viewer).
// 녹음 상담(AudioConsultationForm)은 2.0 그대로 서지만 녹음 파일을 올리거나 전사하지 않는다 — 서버가 2.0 실패 모양으로 거절한다.
import { BackLink } from "@/components/back-link";
import type { StudentConsultationDetail, StudentOption } from "@/features/consultations/server/queries";
import type { TeacherOption } from "@/features/students/server/queries";
import type { ConsultationTemplate, SubjectSetting } from "@/features/owner/settings-types";
import type { NewcomerLinkTarget } from "@/features/newcomers/consult-link";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { ConsultationForm } from "@/app/(shell)/consultations/_components/consultation-form";
import { ConsultationDeleteButton } from "@/app/(shell)/consultations/_components/consultation-delete-button";
import { AudioConsultationForm } from "@/app/(shell)/consultations/_components/audio-consultation-form";
import { formInstanceKey } from "@/lib/recording-resume";

type Viewer = { id: string; displayName: string; systemRole: string; tenantId: string };
/** /api/v2/consultations?v2path=/consultations/<id>/edit — 2.0 page가 서버에서 받던 값. */
export type EditConsultationData = { user: Viewer; operations: { subjects: SubjectSetting[] }; item: StudentConsultationDetail; students: StudentOption[];
  counselors: TeacherOption[]; newcomerTargets: NewcomerLinkTarget[] };
/** /api/v2/consultations?v2path=/consultations/new — 2.0 page가 서버에서 받던 값. */
export type NewConsultationData = { user: Viewer; operations: { subjects: SubjectSetting[] }; students: StudentOption[]; counselors: TeacherOption[];
  templates: ConsultationTemplate[]; newcomerTargets: NewcomerLinkTarget[]; classSupported: boolean };

export function EditConsultationPage({ data }: { data: EditConsultationData }) {
  const viewer = data.user;
  const [item, students, counselors, settings, newcomerTargets] = [data.item, data.students, data.counselors, { operations: data.operations }, data.newcomerTargets];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 상세(읽기) 페이지가 생겨(2026-07-03) 뒤로가기는 상세로 — 녹음/전사/AI 패널(읽기 콘텐츠)도 상세로 이동. */}
      <BackLink href={`/consultations/${item.id}`} label="상담 상세로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          <p className="eyebrow">상담 수정</p>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">{item.studentName}</h1>
        </div>
        <ConsultationDeleteButton
          id={item.id}
          studentId={item.studentId}
          redirectTo="/consultations"
        />
      </header>

      <ConsultationForm
        mode="edit"
        students={students}
        counselors={counselors}
        subjectLabels={subjectLabelRecord(settings.operations.subjects)}
        currentUserId={viewer.id}
        // 🔴 고를 수 있는 학생(담당 범위로 좁힌 목록)의 것만 내려보낸다 — 강사에게 전사 신입 명단이 새지 않게.
        newcomerTargets={newcomerTargets.filter((t) => students.some((s) => s.id === t.studentId))}
        classSupported={item.classSupported}
        initialValue={{
          id: item.id,
          studentId: item.studentId,
          counselorId: item.counselorId,
          consultedAt: item.consultedAt,
          category: item.category,
          subject: item.subject,
          audience: item.audience,
          summary: item.summary,
          followUpAction: item.followUpAction,
          followUpDate: item.followUpDate,
          followUpDone: item.followUpDone,
          classId: item.classId,
          className: item.className,
          classSource: item.classSource,
        }}
      />
    </div>
  );
}

export function NewConsultationPage({ data, sp }: { data: NewConsultationData; sp: { studentId?: string; form?: string; recordStudent?: string } }) {
  const viewer = data.user;
  const { studentId, form, recordStudent } = sp;
  const instanceKey = `${formInstanceKey(form)}:${typeof recordStudent === "string" ? recordStudent : ""}`;
  const [students, counselors, settings, newcomerTargets, classSupported] = [
    data.students, data.counselors, { operations: data.operations, consultations: { templates: data.templates } }, data.newcomerTargets, data.classSupported,
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <BackLink href="/consultations" label="원생상담으로" />

      <header className="border-border space-y-1 border-b pb-3">
        <p className="eyebrow">새 원생상담</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">상담 기록 추가</h1>
        <p className="text-muted-foreground text-sm">
          학생/학부모 면담을 기록합니다. 후속 조치 날짜를 지정하면 기한이 다가올수록 색상으로 알려드립니다.
        </p>
      </header>

      <div key={instanceKey} className="space-y-4">
        <AudioConsultationForm students={students} recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
          initialStudentId={typeof recordStudent === "string" ? recordStudent : undefined} />

        <ConsultationForm
          mode="create"
          students={students}
          counselors={counselors}
          subjectLabels={subjectLabelRecord(settings.operations.subjects)}
          currentUserId={viewer.id}
          templates={settings.consultations.templates}
          currentUserName={viewer.displayName}
          // 🔴 고를 수 있는 학생(담당 범위로 좁힌 목록)의 것만 내려보낸다 — 강사에게 전사 신입 명단이 새지 않게.
          newcomerTargets={newcomerTargets.filter((t) => students.some((s) => s.id === t.studentId))}
          classSupported={classSupported}
          initialValue={
            studentId
              ? {
                  studentId,
                  counselorId: null,
                  consultedAt: new Date().toISOString(),
                  category: "general",
                  subject: null,
                  audience: "parent",
                  summary: "",
                  followUpAction: null,
                  followUpDate: null,
                  followUpDone: false,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
