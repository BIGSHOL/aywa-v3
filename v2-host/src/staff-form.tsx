// 2.0 근무 설정(app/(shell)/staff/[id]/edit/page.tsx) · 직원 등록(app/(shell)/staff/new/page.tsx)의 조립 — 서버 컴포넌트라 그대로 못 불러와서,
// 서버가 하던 게이트·조회는 /api/v2/staff?v2path=…(Docker 복사본, v2-screen-staff.mjs)가 하고 여기서는 본문을 **글자 그대로** 옮겼다
// (바꾼 곳 = staff-form.swaps.json). 쓰기 권한이 없으면 서버가 { redirect: '/staff' }를 돌려준다(2.0 redirect("/staff")).
//  · 직원 등록은 Supabase 로그인 계정을 만드는 일이라 연습 화면에서는 저장 단계에서 거절된다(v2-staff-save.mjs createStaff).
import { WindowLink } from "@/components/workspace/window-link";
import { CalendarDays, Wallet } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/back-link";
import { StaffForm } from "@/app/(shell)/staff/_components/staff-form";
import { isPayrollEnabled, isStaffLeavesEnabled } from "@/features/payroll/config";
import { DashboardAssignmentForm } from "@/app/(shell)/staff/_components/dashboard-assignment-form";
import type { StaffEditData, StaffNewData } from "./staff-host-parts";

// ── app/(shell)/staff/[id]/edit/page.tsx ──────────
export function EditStaffPage({
  data,
  params,
}: {
  data: StaffEditData;
  params: { id: string };
}) {
  const { id } = params;
  const staff = data.staff;
  const settings = data.settings;
  const canAssignTarget = data.canAssignTarget;
  const canGrantTeacherView = data.canGrantTeacherView;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          {/* 들어온 버튼('근무 설정')과 같은 말로 — 열고 나서 "여기가 거기 맞나" 하지 않게. */}
          <p className="eyebrow">근무 설정</p>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
          {/* 무엇이 여기 있고 무엇이 없는지 적는다 — 없는 걸 찾다가 되돌아 나가는 게 가장 큰 낭비다. */}
          <p className="text-muted-foreground text-sm">
            담당 과목·강의실·시간표 색·알림 수신·담당 토글·메모 (인적사항·계약은 이력서, 계정은 직원 상세에서)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 급여 정산은 강사·원장 한정 유지 — 시급/월급 산식이 그 둘 전제다. */}
          {isPayrollEnabled(settings) && (staff.systemRole === "teacher" || staff.systemRole === "master") ? (
            <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}>
              <Wallet className="size-4" />
              급여 정산
            </Button>
          ) : null}
          {/* 휴가는 **전 직원** 기능이라 대상의 역할로 가리지 않는다(2026-08-03 원장 지시).
              예전엔 급여와 한 조건에 묶여 teacher|master만 보였고, 그 결과 반을 맡은 부원장(admin)·
              행정 직원의 휴가를 아예 열 수 없었다. ⚠️ 이 버튼은 게이트가 아니다 — 실제 권한은
              /staff/[id]/leaves가 requireAccess("staff") + canManageStaff·canWriteTenant로 잡는다
              (버튼을 숨겨도 URL로 열렸다 = 숨김은 잠금이 아니다, gotcha #77).
              침산은 기존 결정대로 숨기고 일반 지점은 기능 설정을 따른다. */}
          {isStaffLeavesEnabled(settings) ? (
            <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}>
              <CalendarDays className="size-4" />
              휴가 관리
            </Button>
          ) : null}
        </div>
      </header>

      {canAssignTarget ? <DashboardAssignmentForm
        key={staff.id}
        user={{ id: staff.id, systemRole: staff.systemRole, subjects: staff.subjects, isSuperAdmin: false }}
        initial={settings.dashboard.assignments?.find((a) => a.userId === staff.id)}
        subjects={settings.operations.subjects}
      /> : null}
      <StaffForm
        mode="edit"
        scope={`staff:${id}`}
        assignableRoleOptions={[]}
        canGrantTeacherView={canGrantTeacherView}
        initialValue={{
          id: staff.id,
          displayName: staff.displayName,
          email: staff.email,
          phone: staff.phone,
          systemRole: staff.systemRole,
          hireDate: staff.hireDate,
          jobTitle: staff.jobTitle,
          englishName: staff.englishName,
          subjects: staff.subjects,
          defaultClassroom: staff.defaultClassroom,
          memo: staff.memo,
          bgColor: staff.bgColor,
          attendanceAlertOptin: staff.attendanceAlertOptin,
          seatLabDuty: staff.seatLabDuty,
          seatJjDuty: staff.seatJjDuty,
          deskAttendanceOptin: staff.deskAttendanceOptin,
          shuttleDuty: staff.shuttleDuty,
          teacherViewAccess: staff.teacherViewAccess,
          teacherViewLang: staff.teacherViewLang,
        }}
      />
    </div>
  );
}

// ── app/(shell)/staff/new/page.tsx ──────────
export function NewStaffPage({ data }: { data: StaffNewData }) {
  const user = data.user;
  const roleOptions = data.roleOptions;
  const operations = { jobTitles: data.jobTitles };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">직원 등록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">새 직원 추가</h1>
        <p className="text-muted-foreground text-sm">
          로그인 계정이 함께 만들어집니다. 임시 비밀번호는 직원에게 직접 안내하고 첫 로그인 후 변경하도록 요청하세요.
        </p>
      </header>

      <StaffForm
        mode="create"
        assignableRoleOptions={roleOptions}
        jobTitleOptions={operations.jobTitles}
        canGrantTeacherView={data.canGrantTeacherView && !!user}
      />
    </div>
  );
}
