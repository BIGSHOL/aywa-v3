// 2.0 직원 상세(app/(shell)/staff/[id]/page.tsx)의 조립 — 서버 컴포넌트라 그대로 못 불러와서, 서버가 하던 조회·판정은
// /api/v2/staff?v2path=/staff/<id>(Docker 복사본, v2-screen-staff.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐(staff-detail.swaps.json) — verify-v2-screen-staff.mjs가 글자를 대조한다. 탭(서버 컴포넌트)은 staff-tabs.tsx.
//  · 🔴 급여 두 칸은 서버가 2.0 canSeeSalary(원장 · 본인)일 때만 싣는다 · 이력서는 canViewResume + RLS가 연 것만 · 증명사진 주소는 만들지 않는다.
import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { CalendarDays, Pencil, Wallet } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { BackLink } from "@/components/back-link";
import { assignableRoles } from "@/lib/auth/role-hierarchy";
import { roleMeta, staffStatusMeta } from "@/features/staff/status-labels";
import { StaffTabsNav, isStaffTabKey, accessibleStaffTab } from "@/app/(shell)/staff/[id]/_components/tabs-nav";
import { BasicInfoTab, MonthlyScheduleTab, ClassesTab, ActivityLogTab, PersonalSalaryScope } from "./staff-tabs";
import { isPayrollEnabled, isStaffLeavesEnabled } from "@/features/payroll/config";
import { kstMonth } from "@/lib/date-kst";
import { displayRoleFor, type StaffDetailData } from "./staff-host-parts";

// ── app/(shell)/staff/[id]/page.tsx ──────────
export function StaffDetailPage({
  data,
  params,
  searchParams,
}: {
  data: StaffDetailData;
  params: { id: string };
  searchParams: { tab?: string; page?: string; period?: string };
}) {
  const { id } = params;
  const { tab: tabParam, page: pageParam, period } = searchParams;
  const tabRaw = isStaffTabKey(tabParam) ? tabParam : "info";
  const activityPage = Math.max(1, Number(pageParam) || 1);

  const [staff, viewer, superAdminIds, settings] = [data.staff, data.user, new Set<string>(), data.settings];
  void id;
  if (!staff) notFound();

  // 표시 위장(fake admin) — 배지·버튼 노출 등 '보이는 것'에만. 위계/권한 판정엔 실제 staff.systemRole 사용.
  const displayRole = displayRoleFor(staff.id, staff.systemRole, superAdminIds);

  const canManage = data.canManage;
  // 활동 로그 탭은 사무실 전용 — 비-사무실이 ?tab=activity로 직접 와도 기본정보로 폴백(RLS도 별도 방어).
  // 개인별 급여 설정은 출석부 급여 권한을 따른다. 침산의 휴면 급여 정산 스위치와 별개다.
  const showSalarySettings = data.showSalarySettings;
  const tab = accessibleStaffTab(tabRaw, { showActivity: canManage, showSalarySettings });
  // 계정 관리 카드 = **메뉴 쓰기 권한(개인 예외 포함) AND 대상 보호선** 둘 다(2026-08-11).
  // canManageStaffMember는 이제 대상만 본다(원장 계정만 차단) — canManage를 빼면 staff=readonly인
  // 사람에게도 카드가 떠서 "버튼은 보이는데 누르면 거부"가 된다(서버 loadTarget이 막긴 하지만 거짓 UI).
  const canManageThis = data.canManageThis; // 판정은 서버가 실제 역할로(화면의 역할은 표시 역할)
  // 역할 변경 옵션 — actor가 부여할 수 있는(본인보다 약한) 역할만. 패널 자체가 canManageThis로 게이트됨.
  const roleOptions = canManageThis && viewer ? assignableRoles(viewer.systemRole) : [];
  // 급여 노출은 원장(master) + 본인만 (schema.ts 주석). admin/manager에게도 보이면 안 됨.
  const canSeeSalary = !!viewer && (viewer.systemRole === "master" || viewer.id === staff.id);
  // 기본정보 탭의 이력서 섹션 — 열람은 이력서 공용 게이트(원장·관리자)와 동일([[#77]] 우회 방지).
  // 이 상세가 곧 그 직원의 이력서이므로 소유자 = staff.id(본인이 자기 상세를 보면 통과).
  const resumeAccess = data.resumeAccess;
  const resume = data.resume;
  const resumeCanWrite = data.resumeCanWrite;
  // 증명사진 signed URL(슬라이드) — 게이트 통과 시에만 발급.
  const resumePhotoUrls = data.resumePhotoUrls;
  // 역할·상태 배지 = 직원목록과 같은 단일 소스(features/staff/status-labels) — 화면마다 색이 갈리지 않게.
  const role = roleMeta(displayRole);
  const status = staffStatusMeta(staff.status) ?? staffStatusMeta("active")!;
  // 급여·휴가 버튼 노출은 표시 역할 기준(위장된 admin은 일반 관리자처럼 미노출) — 순수 표시.
  const isTeacherLike = displayRole === "teacher" || displayRole === "master";

  return (
    // print-portrait — 기본정보(종이 서식)·이력서만 세로 A4로 인쇄. 헤더·탭·계정관리 등 화면 크롬은 print:hidden.
    <div className="print-portrait space-y-6">
      <div className="print:hidden">
        <BackLink href="/staff" label="직원관리로" />
      </div>

      <header className="border-border print:hidden flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <p className="eyebrow">직원</p>
            <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
            <p className="text-text-dim num text-xs">{staff.email}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Pill color={role.color}>{role.label}</Pill>
            <Pill color={status.color} soft>
              {status.label}
            </Pill>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* ⚠️ 라벨을 그냥 "수정"으로 두지 말 것 — 이 화면엔 여는 대상이 다른 편집 진입점이 **셋**이고
                (원장 지적 2026-08-07, 모바일에서 특히 붙어 보인다) **셋의 내용이 안 겹친다**
                (원장 지시 2026-08-25 — 겹치는 칸은 이력서로 몰았다):
                  · 여기 = **근무 설정**(담당 과목·강의실·시간표 색·알림 수신·자리/셔틀 담당·표시 이름·메모)
                  · 인적사항 카드 = **이력서**(인적·계약·학력·경력 — 연락처·직급·입사일·근무부서가 여기 산다)
                  · 아래 '계정 관리' 패널 = 이메일 변경·비밀번호 재설정·역할 변경·직원 삭제
                🔴 "직원 정보 수정"으로 되돌리지 말 것 — 인적사항·계약이 빠진 폼에 '정보'라는 이름을 붙이면
                연락처를 고치러 들어왔다가 빈손으로 되돌아 나간다(이름은 실제로 여는 것과 맞아야 한다). */}
            {canManage ? (
              <Button
                variant="outline"
                render={<WindowLink href={`/staff/${staff.id}/edit`} title={`${staff.displayName} 근무 설정`} />}
              >
                <Pencil className="size-4" />
                근무 설정
              </Button>
            ) : null}
            {isTeacherLike ? (
              <>
                {isPayrollEnabled(settings) ? (
                  <Button
                    variant="outline"
                    render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}
                  >
                    <Wallet className="size-4" />
                    급여
                  </Button>
                ) : null}
                {isStaffLeavesEnabled(settings) ? (
                  <Button
                    variant="outline"
                    render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}
                  >
                    <CalendarDays className="size-4" />
                    휴가
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="print:hidden">
        <StaffTabsNav staffId={staff.id} active={tab} showActivity={canManage} showSalarySettings={showSalarySettings} />
      </div>

      <section>
        {tab === "info" ? (
          <BasicInfoTab
            data={{ ...data.info!, settings: data.settings }}
            staff={staff}
            displayRole={displayRole}
            canManageThis={canManageThis}
            // 계약 갱신은 **직원관리 쓰기(사무실)** 기준 — canManageThis(나보다 낮은 직급만)를 쓰면
            // 원장이 원장 계약을, 관리자가 관리자 계약을 갱신하지 못해 버튼이 사라진다(서버·RLS는 통과하는데).
            canManageContracts={canManage}
            showSalary={canSeeSalary}
            roleOptions={roleOptions}
            resume={resume}
            resumeAccess={resumeAccess}
            resumeCanWrite={resumeCanWrite}
            resumePhotoUrls={resumePhotoUrls}
          />
        ) : tab === "monthly" ? (
          <MonthlyScheduleTab initialData={data.monthly!} staffId={staff.id} staffName={staff.displayName} canManage={canManage} />
        ) : tab === "classes" ? (
          <ClassesTab classes={data.classes!} settings={data.settings} staffId={staff.id} />
        ) : tab === "salary" ? (
          <PersonalSalaryScope data={data.salary ?? null} teacherId={staff.id} teacherName={staff.displayName} period={period ?? kstMonth()} />
        ) : tab === "activity" ? (
          <ActivityLogTab data={data.activity!} userId={staff.id} page={activityPage} />
        ) : null}
      </section>
    </div>
  );
}
