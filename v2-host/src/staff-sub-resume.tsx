// 2.0 직원 이력서 두 화면(app/(shell)/staff/resumes/[id]/page.tsx · new/page.tsx)을 호스트로 옮긴 것 — 자료 받는 부분
// (requireAccess · getStaffResumeById · canViewResume · getStaffById · assignableRoles · 증명사진 서명 주소)만 /api/v2/staff가 준 값으로
// 바꾸고 나머지는 원문 그대로(verify가 글자를 대조한다). 서식은 2.0 ResumeSheet 그대로.
// 🔴 열람 자격이 없으면 서버가 이력서 내용(data)을 아예 보내지 않는다 — 2.0도 그 경우 서식을 그리지 않는다.
import { BackLink } from "@/components/back-link";
import type { SystemRole } from "@/lib/permissions";
import type { StaffResumeData } from "@/features/staff/resume/resume";
import { ResumeSheet } from "@/app/(shell)/staff/resumes/_components/resume-sheet";

export type ResumeViewData = {
  id: string; userId: string; name: string; createdAt: string; authorName: string | null; canView: boolean; canWrite: boolean;
  data?: StaffResumeData; staffUserId?: string | null; canWriteRole?: boolean; edit?: string | null; photoUrls?: (string | null)[];
};
export type ResumeNewData = { userId: string; data: StaffResumeData; staff: { id: string; displayName: string } | null; assignableRoles: SystemRole[] };

export function ResumeViewPage({ data }: { data: ResumeViewData }) {
  const resume = { data: data.data!, createdAt: data.createdAt, authorName: data.authorName, staffUserId: data.staffUserId ?? null };
  const { id, name, canView, canWrite } = data;
  const user = { id: data.userId };
  const edit = data.edit ?? undefined;
  const canWriteRole = data.canWriteRole ?? false;

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff" label="직원관리로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">직원 이력서 — {name}</h1>
        <p className="text-text-dim text-xs">
          {new Date(resume.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 작성
          {resume.authorName ? ` · ${resume.authorName}` : ""} · 데이터베이스(인사·직원)에 저장됨
        </p>
      </header>
      {canView ? (
        <ResumeSheet
          data={resume.data}
          id={id}
          userId={user.id}
          canWrite={canWrite}
          // 직원 상세 '수정' 버튼(?edit=1) — 편집 모드로 바로 연다(수정 권한이 있을 때만).
          startEditing={edit === "1" && canWrite}
          // 성명·E-mail 칸 안내 — **서버가 실제로 계정에 반영하는 조건과 같게** 맞춘다
          // (계정에 연결된 이력서 + 직원관리 쓰기). 본인 이력서만 있는 사람에겐 안 뜬다.
          syncsToAccount={Boolean(resume.staffUserId) && canWriteRole}
          // 증명사진 signed URL — **게이트 통과(canView) 시에만** 발급·전달(경로만으론 열람 불가).
          photoUrls={data.photoUrls}
        />
      ) : (
        <div className="border-line bg-card mx-auto w-full max-w-[780px] rounded-2xl border p-8 text-center shadow-card">
          <p className="text-foreground text-sm font-bold">이력서는 원장·관리자와 본인만 열람할 수 있습니다</p>
          <p className="text-text-dim mt-1 text-xs">개인 인사 정보(주민번호·급여·계좌)가 담겨 있어 열람 권한이 제한됩니다.</p>
        </div>
      )}
    </div>
  );
}

export function NewResumePage({ page }: { page: ResumeNewData }) {
  const { data, staff } = page;
  const user = { id: page.userId };

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff" label="직원관리로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">
          {staff ? `직원 이력서 작성 — ${staff.displayName}` : "직원 명부 작성"}
        </h1>
        <p className="text-text-dim mt-1 text-sm">
          {staff
            ? "직원 정보로 미리 채워진 서식입니다 — 저장하면 이 직원과 이력서가 연결됩니다."
            : "종이 서식의 각 칸에 바로 입력하세요 — 저장하면 직원 계정까지 함께 만들어지고(하단 옵션), 이후엔 그 직원의 이력서로 보관됩니다."}
        </p>
      </header>
      <ResumeSheet
        data={data}
        userId={user.id}
        canWrite
        startEditing
        staffUserId={staff?.id}
        // 원샷 직원 등록 옵션 — 기존 직원 연결 모드에선 계정이 이미 있으므로 미노출.
        assignableRoles={page.assignableRoles}
      />
    </div>
  );
}
