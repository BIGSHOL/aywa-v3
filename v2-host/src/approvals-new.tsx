// 2.0 기안하기(app/(shell)/approvals/new/page.tsx)를 호스트로 옮긴 것 — 자료 받는 부분만 /api/v2/approvals가 준 값으로(나머지 원문 그대로).
import Link from "next/link";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import type { ApprovalLineTemplate, ApprovalPerson, LeaveBalance } from "@/features/approvals/server/queries";
import { DraftComposer } from "@/app/(shell)/approvals/new/_composer";


/**
 * 기안(결재 문서 작성) — **하이웍스 '결재 문서 작성' 화면 흐름**(원장 스크린샷 대조 2026-08-14):
 * 기안하기를 누르면 양식이 박힌 폼이 아니라 **문서 작성 화면**으로 온다. 문서 종류(양식) 선택이
 * 화면 안에 있고(휴가신청서·품의서·지출결의서·업무연락, 2026-08-18 4종), 그 아래 결재선 표 →
 * 상세 입력 → 상신.
 *
 * ⚠️ 입사일 미등록(연차 계산 불가)은 **휴가신청서만** 막는다 — 품의서·지출결의서·업무연락은
 *    연차와 무관하므로 기안할 수 있어야 한다(composer가 leave 선택 시에만 안내·차단).
 */
/** /api/v2/approvals?v2path=/approvals/new — 2.0 page가 서버에서 받던 값. */
export type NewApprovalData = { user: { displayName: string; jobTitle: string | null }; balance: LeaveBalance; candidates: ApprovalPerson[]; templates: ApprovalLineTemplate[]; today: string };
export function NewApprovalPage({ data }: { data: NewApprovalData }) {
  const { user, balance, candidates, templates } = data;

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-sm font-medium transition"
      >
        <ArrowLeft className="size-4" /> 결재함으로
      </Link>

      {/* 설명 문장 없음(§4) — 양식 선택·결재선·상세가 화면 자체다. */}
      <PageHeader eyebrow="전자결재" title="결재 문서 작성" embedLabel="결재 문서 작성" />

      <DraftComposer
        drafterName={user.displayName}
        drafterJobTitle={user.jobTitle}
        candidates={candidates}
        templates={templates}
        // 기본 결재선은 없다 — 하이웍스처럼 기안자가 [+]로 매번 지정하거나 자주 쓰는 결재선을 불러온다.
        initialApproverIds={[]}
        periodEnd={balance.period?.end ?? null}
        remaining={balance.usageUnknown ? null : balance.remaining}
        today={data.today}
      />
    </div>
  );
}
