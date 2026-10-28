// 2.0 학생 수정(app/(shell)/students/[id]/edit/page.tsx) · 새 학생(new/page.tsx)의 조립 — 서버 컴포넌트라 서버가 하던 조회·권한 판정은
// /api/v2/students?v2path=/students/<id>/edit · /students/new(Docker 복사본, v2-students-form.mjs)가 하고 여기서는 두 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(students-form.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-students.mjs가 글자를 대조한다.
// 저장(StudentForm의 createStudent · updateStudent)은 이번 단계에서 열지 않았다 — 공용 저장 자리가 '아직 지원하지 않는 저장'으로 거절한다.
import { redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { StudentForm } from "@/app/(shell)/students/_components/student-form";
import { isModuleEnabled } from "@/lib/modules";
import { siblingHint } from "@/features/students/siblings";
import type { StudentDetail } from "@/features/students/server/queries";
import type { SiblingView } from "@/features/students/server/siblings";

type FormSettings = { operations: { gradeLevels: string[] } & Record<string, unknown>; modules: { disabled: Parameters<typeof isModuleEnabled>[0] } };
/** /api/v2/students?v2path=/students/<id>/edit 응답 — page.tsx가 서버에서 받던 값 + 권한 칸. */
export type StudentEditData = {
  student: StudentDetail;
  settings: FormSettings;
  siblings: { ready: boolean; siblings: SiblingView[]; review: SiblingView[]; autoIds: string[] };
  canManageStatus: boolean;
  studentsLevel: string;
};
/** /api/v2/students?v2path=/students/new 응답. */
export type StudentNewData = { settings: FormSettings; canManageStatus: boolean; studentsLevel: string };

export function EditStudentPage({
  data,
  params,
}: {
  data: StudentEditData;
  params: { id: string };
}) {
  const { id } = params;
  // 강사(scoped)는 학생 열람 전용(원장 지시 2026-08-18) — 강제 URL도 상세로 되돌린다(#77).
  // 서버 액션(updateStudent)도 같은 full 판정으로 막혀 있어 이 리다이렉트는 UX용 이중 방어다.
  if (data.studentsLevel !== "full") redirect(`/students/${id}`);
  const [student, { operations, modules }] = [data.student, data.settings];
  if (!student) notFound();
  // 형제 칸(0376a) — 짝 표가 아직 없으면(SQL 적용 전) 칸을 안 띄운다. 자동 판정은 미리 넣는다('자동 추천').
  const sib = data.siblings;
  const option = (s: (typeof sib.siblings)[number]) => ({ value: s.id, label: s.name, hint: siblingHint(s), auto: s.basis !== "manual" });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/students/${id}`} label="학생 상세로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{student.name}</h1>
      </header>

      <StudentForm
        canManageStatus={data.canManageStatus}
        mode="edit"
        scope={`student:${id}`}
        gradeLevels={operations.gradeLevels}
        showClassnoteName={isModuleEnabled(modules.disabled, "classnote")}
        siblings={sib.ready ? { initial: sib.siblings.map(option), review: sib.review.map(option), suggested: sib.autoIds } : undefined}
        initialValue={{
          id: student.id,
          name: student.name,
          englishName: student.englishName,
          classnoteName: student.classnoteName,
          grade: student.grade,
          school: student.school,
          studentCode: student.studentCode,
          attendanceCode: student.attendanceCode,
          gender: student.gender,
          birthDate: student.birthDate,
          nickname: student.nickname,
          graduationYear: student.graduationYear,
          address: student.address,
          zipCode: student.zipCode,
          addressDetail: student.addressDetail,
          email: student.email,
          studentPhone: student.studentPhone,
          homePhone: student.homePhone,
          otherPhone: student.otherPhone,
          parentName: student.parentName,
          parentPhone: student.parentPhone,
          parentRelation: student.parentRelation,
          status: student.status,
          enrolledAt: student.enrolledAt,
          withdrawnAt: student.withdrawnAt,
          notes: student.notes,
        }}
      />
    </div>
  );
}

export function NewStudentPage({ data }: { data: StudentNewData }) {
  // 강사(scoped)는 학생 열람 전용(원장 지시 2026-08-18) — 등록 폼도 강제 URL 차단(#77).
  if (data.studentsLevel !== "full") redirect("/students");
  const { operations, modules } = data.settings;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/students" label="원생목록으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 등록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">새 원생 추가</h1>
        <p className="text-muted-foreground text-sm">
          기본 정보. 등록 후 수강 반을 배정하면 과목별 담당 강사·출결이 자동으로 따라옵니다.
        </p>
      </header>

      <StudentForm
        canManageStatus={data.canManageStatus}
        mode="create"
        gradeLevels={operations.gradeLevels}
        showClassnoteName={isModuleEnabled(modules.disabled, "classnote")}
      />
    </div>
  );
}
