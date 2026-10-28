// 2.0 직원관리 연차 관리(app/(shell)/staff/annual-leave/page.tsx)를 호스트로 옮긴 것 — 자료 받는 부분(requireAccess · canAdjustLeave ·
// getLeaveOverview)만 /api/v2/staff가 준 값으로 바꾸고 나머지는 원문 그대로(verify가 글자를 대조한다). 표는 2.0 _adjust-table 그대로.
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import type { LeaveOverview } from "@/features/leave/server/admin";
import { AdjustTable } from "@/app/(shell)/staff/annual-leave/_adjust-table";

export type AnnualLeaveData = { overview: LeaveOverview };

export function AnnualLeavePage({ data }: { data: AnnualLeaveData }) {
  const overview = data.overview;
  const adjusted = overview.rows.filter((r) => r.adjustment !== 0).length;
  // 🔴 조회가 실패했으면 건수를 **안 적는다** — 빈 배열의 길이 0을 "0명"이라 찍으면 거짓 숫자다
  //    (결재함 머리(`page.tsx`)와 같은 규약).
  const summary = overview.loadError
    ? undefined
    : `직원 ${overview.rows.length}명 · 조정 있음 ${adjusted}명`;

  return (
    <div className="w-full min-w-0 space-y-5 p-4 md:p-6">
      {/* 뒤로 링크는 형제 라우트(급여·휴가)와 **같은 부품**으로 — 창(iframe) 안에서는 크롬이 ←·제목을
          주므로 스스로 사라진다. 맨 `<Link>`를 헤더에 두면 창 안에서 뒤로가 둘이 되고, 눌렀을 때 그 창이
          "제목은 연차 관리인데 내용은 직원 목록"으로 바뀐다(back-link.tsx 주석). */}
      <BackLink href="/staff" label="직원관리로" />

      <PageHeader
        eyebrow="운영"
        title="연차 관리"
        description={summary}
        embedLabel={summary ? `연차 관리 · ${summary}` : undefined}
      />

      {overview.loadError ? (
        <p
          className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-4 py-2.5 text-sm"
          title={overview.loadError.raw}
        >
          {overview.loadError.summary}
        </p>
      ) : null}

      {/* 0252a 미적용 — 표는 그대로 읽히고 편집만 잠긴다([[#95]] expand/contract). */}
      {!overview.loadError && !overview.tableReady ? (
        <p className="border-line bg-bg-soft/50 text-text-dim rounded-xl border border-dashed px-4 py-2.5 text-sm break-keep">
          연차 조정 표가 아직 준비되지 않았습니다 — 마이그레이션{" "}
          <span className="num">0252a</span>를 적용하면 바로 쓸 수 있습니다. 그전까지 아래 숫자는
          법정 부여(입사일 계산) 기준입니다.
        </p>
      ) : null}

      {/* 0270b 미적용 — 조정은 그대로 되고 **사용 기간 칸만** 잠긴다([[#95]]). 표 배너와 따로 두는 이유는
          둘이 다른 사실이기 때문이다(표가 없으면 조정 자체가 안 되고, 칸이 없으면 날짜만 못 적는다). */}
      {!overview.loadError && overview.tableReady && !overview.usedRangeReady ? (
        <p className="border-line bg-bg-soft/50 text-text-dim rounded-xl border border-dashed px-4 py-2.5 text-sm break-keep">
          조정에 <b className="text-foreground">휴가 사용 기간</b>을 적는 칸은 마이그레이션{" "}
          <span className="num">0270b</span>를 적용한 뒤부터 쓸 수 있습니다 — 그전까지 조정은 일수와
          사유만 기록됩니다.
        </p>
      ) : null}

      <p className="text-text-dim text-xs break-keep">
        부여 일수는 입사일에서 법으로 계산되고(1년 미만 = 개근 1개월당 1일 최대 11일 · 1~2년차 15일 ·
        3년차부터 2년마다 +1일 최대 25일), 여기 <b className="text-foreground">조정</b>은 그 위에
        더해지는 이월·특별휴가·정산 몫입니다. 조정은 기록으로 남고, 직원이 전자결재에서 휴가를 낼 때
        쓰는 잔여 연차에 바로 반영됩니다.
      </p>

      <AdjustTable
        rows={overview.rows}
        tableReady={overview.tableReady}
        usedRangeReady={overview.usedRangeReady}
      />
    </div>
  );
}
