// 2.0 전자결재 결재함(app/(shell)/approvals/page.tsx)을 호스트로 옮긴 것 — 자료 받는 부분(requireAccess · getApprovalBoxes ·
// getMyLeaveBalance)만 /api/v2/approvals가 준 값으로 바꾸고 나머지는 원문 그대로(verify가 글자를 대조한다).
import Link from "next/link";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { leavePeriodLabel } from "@/features/leave/accrual";
import { formatLeaveDays } from "@/features/leave/request-days";
import { formatSignedDays } from "@/features/leave/balance";
import type { ApprovalBoxes, ApprovalDocRow, LeaveBalance } from "@/features/approvals/server/queries";
// queries.ts는 서버 전용이라 판정 하나(needsMyDeferredConfirm)만 원문 그대로 옮겼다.
function needsMyDeferredConfirm(doc: ApprovalDocRow, userId: string): boolean {
  return doc.steps.some((s) => s.approverId === userId && s.decision === "deferred");
}
import { DocList } from "@/app/(shell)/approvals/_components/doc-list";


/**
 * 전자결재 결재함 — 원장 지시 2026-08-14: *"하이웍스 기준으로 디자인 및 기능 따서 우리 디자인에 맞게."*
 * 하이웍스 문서함 구성을 그대로 옮겼다: **결재 대기(내 차례) / 결재 예정 / 진행 / 완료 / 반려·회수 / 참조**.
 *
 * 양식은 늘어날 자리다(지금은 휴가신청서 하나) — 문서 껍데기(`approval_documents`)와 양식 상세
 * (`leave_forms`)가 분리돼 있어 새 양식은 상세 표 + 폼만 더하면 된다.
 *
 * 접근은 `approvals` 메뉴 게이트 — 기본값이 전 역할 `none`이고, 역할·권한 표나 '개인별 메뉴 권한'으로 연 계정만
 * 들어온다(코드 명단 없음). 상세는 [`access.ts`](../../../features/approvals/access.ts).
 */

/** 탭(하이웍스 문서함) 정의 — 빈 상태 문구까지 여기 한 곳(함 설명 문단은 §4로 걷었다 — 라벨이 곧 뜻이다). */
const BOX_TABS = [
  {
    key: "all",
    label: "전체",
    empty: "관련 문서가 없습니다 — 위 ‘기안하기’로 시작하세요.",
  },
  {
    key: "waiting",
    label: "결재 대기",
    empty: "결재할 문서가 없습니다.",
  },
  {
    key: "upcoming",
    label: "결재 예정",
    empty: "차례를 기다리는 문서가 없습니다.",
  },
  {
    key: "progress",
    label: "진행",
    empty: "진행 중인 문서가 없습니다 — 위 ‘기안하기’로 시작하세요.",
  },
  {
    key: "done",
    label: "완료",
    empty: "완료된 문서가 없습니다.",
  },
  {
    key: "rejected",
    label: "반려·회수",
    empty: "반려되거나 회수된 문서가 없습니다.",
  },
  {
    key: "refs",
    label: "참조",
    empty: "참조로 지정된 문서가 없습니다.",
  },
  // 원장 전용(N13) — 결재선에 없어도 대결할 문서를 찾는 자리. 원장이 아니면 탭 자체가 없다.
  {
    key: "academy",
    label: "학원 전체 진행",
    empty: "학원에 진행 중인 결재 문서가 없습니다.",
  },
] as const;

type BoxTabKey = (typeof BOX_TABS)[number]["key"];

/** /api/v2/approvals — 2.0 page가 서버에서 받던 값(보는 사람 · 결재함 · 내 연차). sp = 주소의 쿼리. */
export type ApprovalsListData = { user: { id: string; systemRole: string }; boxes: ApprovalBoxes; balance: LeaveBalance };
export function ApprovalsPage({ data, sp }: { data: ApprovalsListData; sp: { tab?: string } }) {
  const { user } = data;

  // 대결은 원장만 한다(decideDocument) — '학원 전체 진행' 함도 원장에게만(같은 판정).
  const isMaster = user.systemRole === "master";
  // 두 조회는 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const { boxes, balance } = data; // load가 academyWide = 원장으로 같은 판정을 했다
  void isMaster;

  const tabs = BOX_TABS.filter((t) => t.key !== "academy" || boxes.academyPending !== null);
  const face: BoxTabKey = tabs.some((t) => t.key === sp.tab)
    ? (sp.tab as BoxTabKey)
    : "waiting";
  const faces: Face[] = tabs.map((t) => ({
    key: t.key,
    label:
      t.key === "waiting" && boxes.waiting.length > 0
        ? `결재 대기 ${boxes.waiting.length}`
        : t.key === "academy" && Array.isArray(boxes.academyPending)
          ? `학원 전체 진행 ${boxes.academyPending.length}`
          : t.label,
    href: t.key === "waiting" ? "/approvals" : `/approvals?tab=${t.key}`,
  }));

  // 탭 키 → 그 함의 문서 목록. 기안자 열은 "전부 내 문서"일 수 있는 진행 탭에서도 유지한다 —
  // 진행엔 내가 결재한 남의 문서도 섞여 있어 기안자가 정보다.
  const docsByTab: Record<BoxTabKey, typeof boxes.waiting> = {
    all: boxes.all,
    waiting: boxes.waiting,
    upcoming: boxes.upcoming,
    progress: boxes.inProgress,
    done: boxes.completed,
    rejected: boxes.rejected,
    refs: boxes.refDocs,
    academy: boxes.academyPending ?? [],
  };
  const activeTab = tabs.find((t) => t.key === face)!;
  // 🔴 조회 실패(loadError)·표 미적용(ready=false)이면 값을 **안 적는다** — 빈 배열 길이 0을 "0건"이라 찍으면 거짓
  //    숫자다(`getApprovalBoxes`는 실패해도 `ready=true`인 빈 함을 돌려준다, 적대 리뷰 2026-09-04). 머리는 제목만 남는다.
  const boxSummary =
    boxes.ready && !boxes.loadError
      ? `내 결재함 · 결재 대기 ${boxes.waiting.length}건 · 진행 ${boxes.inProgress.length}건 · 완료 ${boxes.completed.length}건`
      : undefined;
  // '결재 대기'엔 내 차례 문서와 **부재중 후결로 넘어가 확인이 필요한 문서**가 섞인다 — 후자는 진행 열이 "남의 차례"·
  // "승인"으로 읽혀 왜 여기 있는지 안 보인다(옛 설명 문단이 그걸 말했다). 문장 대신 그 행의 진행 열에 값으로 적는다.
  const deferredConfirmIds = docsByTab[face].filter((d) => needsMyDeferredConfirm(d, user.id)).map((d) => d.id);

  const period = balance.period;

  return (
    <div className="w-full min-w-0 space-y-5 p-4 md:p-6">
      {/* 설명 문장 대신 값(§4) — 결재함 건수. 상시 버튼 = Primary '기안하기' 하나(§10). */}
      <PageHeader
        eyebrow="운영"
        title="전자결재"
        description={boxSummary}
        embedLabel={boxSummary ? `전자결재 · ${boxSummary}` : undefined}
        actions={
          <Button render={<Link href="/approvals/new" />}>
            <EyIcon name="plus" size={16} />
            기안하기
          </Button>
        }
      />

      {boxes.loadError ? (
        <p
          className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-4 py-2.5 text-sm"
          title={boxes.loadError.raw}
        >
          {boxes.loadError.summary}
        </p>
      ) : null}

      {!boxes.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          전자결재 표가 아직 준비되지 않았습니다 — 마이그레이션{" "}
          <span className="num">0213a</span>를 적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <>
          {/* 내 연차 현황 — 휴가가 첫 양식이라 결재함 위에 요약으로 둔다(기안 전에 잔여를 먼저 본다). */}
          {period ? (
            <StatStrip>
              <BigStat
                label="연차 부여"
                value={formatLeaveDays(balance.granted)}
                tone="primary"
                icon={<MenuGlyph name="calendarCheck" size={22} />}
                // 조정(이월·특별휴가)이 있으면 어디서 온 일수인지 밝힌다 — 법정 계산과 다른 숫자가
                // 아무 설명 없이 떠 있으면 본인도 사무실도 근거를 못 찾는다.
                sub={
                  balance.adjustment === 0
                    ? period.label
                    : `${period.label} · 법정 ${formatLeaveDays(period.granted)} · 조정 ${formatSignedDays(balance.adjustment)}`
                }
              />
              {/* ⚠️ BigStat의 tone은 **아이콘 칩에만** 칠해진다 — 아이콘이 없으면 톤을 줘도 화면엔
                  아무 색도 안 나온다(v4 이전 이 세 칸이 그래서 통째로 무채색이었다).
                  뜻은 의미색 캐논: 사용=info(지나간 정보) · 결재중=caution(내 차례로 돌고 있음) ·
                  잔여=positive(여유 있음) / critical(0일=더 못 씀). */}
              <BigStat
                label="사용"
                value={balance.usageUnknown ? "확인 불가" : formatLeaveDays(balance.used)}
                tone="blue"
                icon={<MenuGlyph name="history" size={22} />}
              />
              <BigStat
                label="결재중"
                value={balance.usageUnknown ? "확인 불가" : formatLeaveDays(balance.pending)}
                tone="amber"
                icon={<MenuGlyph name="clock" size={22} />}
              />
              <BigStat
                label="잔여"
                // 사용 조회가 실패하면 잔여를 셀 수 없다(E10) — '부여 전체'로 보이지 않게 '확인 불가'.
                value={balance.usageUnknown ? "확인 불가" : formatLeaveDays(balance.remaining)}
                tone={balance.usageUnknown ? "amber" : balance.remaining > 0 ? "green" : "danger"}
                icon={<MenuGlyph name="wallet" size={22} />}
                sub={leavePeriodLabel(period)}
              />
            </StatStrip>
          ) : (
            <p className="border-line bg-bg-soft/50 text-text-dim rounded-xl border px-4 py-2.5 text-sm">
              입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 등록을 요청하세요.
            </p>
          )}

          <FaceTabs faces={faces} active={face} ariaLabel="결재함 전환" />

          <DocList docs={docsByTab[face]} emptyText={activeTab.empty} deferredConfirmIds={deferredConfirmIds} />
        </>
      )}
    </div>
  );
}
