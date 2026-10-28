// 2.0 session-terms-face.tsx(app/(shell)/billing/_components/session-terms-face.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본)이
// **2.0 서버 함수를 그대로** 돌려(v2-billing-sessions.mjs · 공용 러너 v2-server-runner.mjs) 내고 여기서는 본문을 글자 그대로 옮겼다(billing-sessions.swaps.json).
import type { SessionsFaceData } from "./billing-types";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { currentPeriod } from "@/features/billing/calc";
import { FilterSelect } from "@/components/filter-select";
import { SearchToggle } from "@/components/search-toggle";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { Pagination } from "@/components/pagination";
import { SessionTermGroups, RefreshPlanButton, type ClassGroup } from "@/app/(shell)/billing/_components/session-term-table";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";
import { FaceNote } from "@/app/(shell)/billing/_components/face-note";
import Link from "next/link";
import { SessionTermsState, SessionTermsConfirmedCount } from "@/app/(shell)/billing/_components/session-terms-state";
import { NO_LESSON_LABEL } from "@/features/billing/session-terms/month-roster";
import { confirmableTermRow, filterSessionTermRows, shareClassIdsOf, type TermOnlyKey } from "@/features/billing/session-terms/term-filter";
import { SessionVerificationFace } from "./billing-session-verification-face";
import { SessionPanels } from "@/app/(shell)/billing/_components/session-panels";

const PAGE_SIZE = 25; // 반(그룹) 단위 페이지

const confirmableRow = confirmableTermRow;
/** 보기 필터의 이름 — 드롭다운 항목과 '맞는 줄 없음' 안내가 같은 말을 쓴다. */
const ONLY_LABEL: Record<TermOnlyKey, string> = { open: "미확정", pending: "미배분", share: "몫 조정한 반" };

/**
 * 회차 확정 면 — 청구=N회 키스톤(docs/per-session-billing-plan.md).
 * 계획 N(자동 산출)은 프리필일 뿐, **확정된 값만 청구값**(N1). invoices.amount_total과 자동 일치화 금지(N2)
 * — 참고 열로만 나란히 보여주고 diff 판단은 사람이 한다(시수 검증 read-only 탭이 2단계).
 */
export function SessionTermsFace({
  data,
  period,
  subject,
  q,
  page,
  only,
  allocation,
  confirmation,
  panel,
  status,
  params = {},
}: {
  period?: string;
  subject?: string;
  q?: string;
  page?: string;
  /**
   * 보기 필터 — `open,pending,share`(쉼표 · 여럿을 고르면 모두에 해당하는 줄만). 원장 2026-10-07 *"확정 / 배분 / 몫 3개를
   * 하나의 드랍다운으로 묶고 중복 체크가능하게"*. 미확정 보기는 2026-09-17 *"검색 필터에 '미확정' 보기 추가"*에서 왔다.
   */
  only?: string;
  /** 옛 주소 호환(`allocation=pending` · `confirmation=open`) — 드롭다운이 둘이던 때의 주소도 그대로 읽는다. */
  allocation?: string;
  confirmation?: string;
  panel?: string;
  status?: string;
  params?: Record<string, string | undefined>;
  /** 서버(복사본)가 2.0 서버 함수를 그대로 돌려 낸 값 — 확정·배분 패널 또는 청구 시수 대조 패널. */
  data: SessionsFaceData;
}) {
  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  if (panel === "verify") return <div className="space-y-4">
    <SessionPanels period={p} params={params} active="verify" />
    <SessionVerificationFace period={p} subject={subject} page={page} query={q} status={status} params={params} data={data} />
  </div>;
  // JJ실 줄 재료는 표 조회와 독립이라 나란히 읽는다(B4) — 권한이 없거나 못 읽으면 null(줄만 안 선다).
  const [view, settings, seatShare] = [data.confirm!.view, data.settings, data.confirm!.seatShare];
  const subjects = buildSubjectMaps(settings.operations.subjects);

  const allRows = view.rows.map((r) => ({ ...r, subjectLabel: subjects.labelOf(r.subject) }));
  // 과목·검색·보기 필터(미확정·미배분·몫 조정한 반) = 엑셀과 같은 한 벌(filterSessionTermRows, 감사 N2). 페이저는 검색 결과 기준.
  // '몫' 필터의 재료는 자리 몫 줄과 같은 조회다 — 줄이 안 서는 화면(권한 없음)에는 그 항목도 안 선다.
  const { presentSubjects, activeSubject, query, pendingOnly, openOnly, pendingCount, openCount, shareCount, only: onlyKeys, filtered } =
    filterSessionTermRows(allRows, { subject, q, only, allocation, confirmation, shareClassIds: shareClassIdsOf(seatShare) });
  // 머리 줄 카운트(원장 2026-09-18) — 확정 분모는 확정 가능한 줄, 그 뒤에 줄 상태별 수(0이면 생략).
  const confirmableCount = filtered.filter(confirmableRow).length;
  const missingCount = filtered.filter((r) => r.termState === "missing").length;
  const noInvoiceCount = filtered.filter((r) => r.termState === "no_invoice").length;
  const voidInvoiceCount = filtered.filter((r) => r.termState === "void_invoice").length;
  const noLessonCount = filtered.filter((r) => r.noLesson).length;
  // 같은 학생·반이 이 달 살아 있는 청구서 여러 장에 있어 줄이 여럿인 행(`duplicateInvoice`) — 출석부(1줄)와 줄 수가 다른 이유를 밝힌다.
  const duplicateCount = filtered.filter((r) => r.duplicateInvoice).length;

  // 반 단위 그룹핑 — 반별 일괄 확정(원장 지시). 학생명 정렬 유지된 채 반으로 묶고, 반 안은 학년·이름 순.
  const groupMap = new Map<string, ClassGroup>();
  for (const r of filtered) {
    const key = r.classId ?? `noclass:${r.className ?? "?"}`;
    const g =
      groupMap.get(key) ??
      groupMap
        .set(key, { classId: r.classId ?? key, className: r.className ?? "(반 미지정)", subjectLabel: r.subjectLabel, students: [] })
        .get(key)!;
    g.students.push(r);
  }
  const allGroups = [...groupMap.values()];
  for (const g of allGroups)
    g.students.sort(
      (a, b) =>
        (a.studentGrade ?? "").localeCompare(b.studentGrade ?? "", "ko") ||
        a.studentName.localeCompare(b.studentName, "ko"),
    );
  allGroups.sort((a, b) => a.subjectLabel.localeCompare(b.subjectLabel) || a.className.localeCompare(b.className, "ko"));

  const totalPages = Math.max(1, Math.ceil(allGroups.length / PAGE_SIZE));
  const curPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const groups = allGroups.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const monthlyCount = filtered.filter((r) => r.monthlyPrice !== null).length;

  // 필터(과목·검색)를 보존한 채 월·page만 바꾸는 href.
  const hrefFor = (per: string, n = 1) => {
    const qs = new URLSearchParams({ tab: "sessions", period: per });
    if (activeSubject) qs.set("subject", activeSubject);
    if (query) qs.set("q", query);
    if (onlyKeys.length > 0) qs.set("only", onlyKeys.join(","));
    if (n > 1) qs.set("page", String(n));
    return `/billing?${qs.toString()}`;
  };
  const pageHref = (n: number) => hrefFor(p, n);

  return (
    <div className="space-y-4">
    <SessionPanels period={p} params={params} active="confirm" />
    <SessionTermsState rows={filtered.map(({ id, confirmedSessions, invoiceId, invoiceHasAllocations }) => ({ id, confirmedSessions, invoiceId, invoiceHasAllocations }))}>
    <section className="space-y-4">
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav(옛 h-8 text-xs 화살표 링크 대체) · 과목 칩 줄 → `과목: 전체` 라벨 ·
          상시 검색창 → 검색 토글 · Primary = '계획 갱신'(이 면의 본 동작) 하나. 🔴 툴바 카드 껍데기 없음. */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={p} hrefFor={(per) => hrefFor(per)} ariaLabel="회차 월 선택" />
        {presentSubjects.length > 1 ? (
          <FilterSelect
            paramName="subject"
            value={activeSubject ?? ""}
            options={presentSubjects.map((sk) => ({ value: sk, label: subjects.labelOf(sk) }))}
            axisLabel="과목"
            ariaLabel="과목 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
        ) : null}
        <SearchToggle placeholder="이름·반·학교·담임·메모" defaultValue={query} />
        {/* 엑셀 내보내기(감사 N2 · 원장 2026-09-29 검색 줄 통일) — 이 표와 같은 줄 집합(과목·검색·보기 필터). 가져오기는 없다. */}
        <ExcelMenu
          exportHref={`/api/exports/session-terms?${new URLSearchParams({
            period: p,
            ...(activeSubject ? { subject: activeSubject } : {}),
            ...(query ? { q: query } : {}),
            ...(onlyKeys.length > 0 ? { only: onlyKeys.join(",") } : {}),
          }).toString()}`}
        />
        {/* 보기 필터 — 확정 · 배분 · 몫을 드롭다운 하나에서 여러 개 고른다(원장 2026-10-07). 고른 것 모두에 해당하는 줄만 남는다.
            괄호 속 수는 서로를 거르지 않은 수 · '몫 조정한 반'은 반 수다. 옛 주소의 두 파라미터는 고르는 순간 지운다. */}
        <FilterSelect
          paramName="only"
          multiple
          value={onlyKeys.join(",")}
          options={[
            { value: "open", label: `${ONLY_LABEL.open} (${openCount})` },
            { value: "pending", label: `${ONLY_LABEL.pending} (${pendingCount})` },
            ...(seatShare ? [{ value: "share", label: `${ONLY_LABEL.share} (${shareCount})` }] : []),
          ]}
          clearParams={["confirmation", "allocation"]}
          axisLabel="보기"
          ariaLabel="확정·배분·몫 보기 필터"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        <span className="text-text-dim text-sm whitespace-nowrap">
          반 <span className="num">{allGroups.length}</span>개 · 확정{" "}
          <SessionTermsConfirmedCount />/<span className="num">{confirmableCount}</span>건
          {monthlyCount > 0 ? ` · 월 정액 ${monthlyCount}건` : null}
          {missingCount > 0 ? ` · 회차 없음 ${missingCount}` : null}
          {noInvoiceCount > 0 ? ` · 청구서 없음 ${noInvoiceCount}` : null}
          {voidInvoiceCount > 0 ? ` · 청구서 취소 ${voidInvoiceCount}` : null}
          {noLessonCount > 0 ? ` · ${NO_LESSON_LABEL.label} ${noLessonCount}` : null}
          {duplicateCount > 0 ? ` · 청구서 중복 ${duplicateCount}` : null}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <RefreshPlanButton period={p} />
        </div>
        <Link href="/owner?tab=billing" className="text-primary text-sm underline-offset-2 hover:underline">
          단가 설정
        </Link>
      </div>

      {/* 규칙 설명(N1/N2)은 지워선 안 되는 사실이라 접힌 2차로(§4). */}
      <FaceNote>
        줄은 <b>월별 출석부와 같은 학생·반</b>입니다. 출석부엔 있는데 회차 행이 없는 줄(보강 방문 등)은 <b>회차 없음</b>으로 서고 시수를 확정하거나
        수납을 배분하는 순간 행이 생깁니다. 그 달 청구서가 없거나 취소된 줄은 <b>청구서 없음·청구서 취소</b>로 잠기고(출석부엔 —), 회차 행은 있는데
        이 달 출석부(세션 기간)엔 없는 줄은 <b>{NO_LESSON_LABEL.label}</b>으로 표시합니다(예정·실 소비는 달력월로 셉니다).{" "}
        수학은 출석부와 같이 <b>2시간=1 · 3시간=1.5시수</b>, 일반 영어는 교시별 시수 합계로 계산합니다.
        기존 일수 기준 확정값(확정 시수가 <b>붉은 숫자</b> — 마우스를 올리면 사유)은 해제 후 시수를 확인해 재확정하세요.
        예정 시수는 수강 기간·시간표·휴일로 볼 때마다 다시 계산하지만 확정 시수는 그대로라, 둘이 다르면 확정 시수가{" "}
        <b>주황 숫자</b>로 표시됩니다(수강·시간표가 바뀌었다면 해제 후 재확정). 왼쪽 체크박스로 학생을 고른 뒤 <b>선택 일괄 확정</b>을
        누르면 각 행에 보이는 시수 × 단가로 한꺼번에 확정합니다. 반 학생이 모두 확정되면 그 자리에 <b>전체 확정 해제</b>가 섭니다(한 명만 해제해도 입력칸으로 돌아옵니다). 지난 달에 확정한 학생은 미확정 칸이 <b>지난 달 기준</b>으로 미리 채워집니다 — 옮긴 단가는 옅은 파랑, 지난 달 비율로 예정보다 줄인 시수는 옅은 주황(선택 일괄 확정 전에 한 번 묻습니다). 저장은 확인 후 확정할 때만. 학생 줄의 <b>배분</b> 버튼에서는 학생의 여러 반을 수납 항목에 연결하고
        <b> 할인 전 청구액</b>을 배분합니다. 학부모 할인은 급여 기준에서 차감하지 않습니다.{" "}
        회차를 비우고 <b>단가 일괄 입력</b>을 누르면 미확정 학생의 단가 입력칸만 채웁니다(저장 전).
        회차와 단가를 모두 입력한 뒤 <b>이 반 일괄 확정</b>을 누르면 입력한 회차 × 단가로 확정됩니다.
        개별 행에서는 예상금액을 확인한 뒤 <b>확정</b>하세요. 확정한 값만 청구
        기준으로 인정되며, 청구액과의 차이는 자동으로 맞추지 않습니다(차이가 곧 점검 신호). 단가 후보는{" "}
        <Link
          href="/owner?tab=billing"
          className="text-primary underline-offset-2 hover:underline"
        >
          학원 설정 → 수납·청구
        </Link>
        에서 등록·수정할 수 있습니다. 수학·영어는 같은 목록을 쓰며, 같은 금액은 한 번만 표시됩니다.
        {" "}EiE는 <b>월 금액</b>으로 확정합니다(회차를 곱하지 않음).
        출석 회차가 달라도 월 기준액은 같으며, 설정 변경 전 확정 내역은 해제·재확정 전까지 유지됩니다.
      </FaceNote>

      {filtered.length === 0 ? (
        <div className="border-border text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
          {/* 이 달 회차 자체가 없으면 필터 문구보다 '계획 갱신' 안내가 먼저 — "미확정 항목이 없습니다"는 전부 확정된 것처럼 읽힌다(리뷰 2026-09-17). */}
          {allRows.length === 0 ? (
            <>
              이 달의 회차 데이터가 없습니다. 위의 <b>계획 갱신</b>을 누르면 청구서 기준으로 반별 계획 회차가
              생성됩니다.
            </>
          ) : onlyKeys.length > 0 ? (
            <>보기 필터({onlyKeys.map((key) => ONLY_LABEL[key]).join(" · ")})에 맞는 항목이 없습니다.</>
          ) : query ? (
            <>“{query}” 검색 결과가 없습니다. 검색어를 조정해 보세요.</>
          ) : (
            <>
              이 달의 회차 데이터가 없습니다. 위의 <b>계획 갱신</b>을 누르면 청구서 기준으로 반별 계획 회차가
              생성됩니다.
            </>
          )}
        </div>
      ) : (
        <>
          {/* 검색·과목·미배분·미확정 필터로 한 반의 일부만 보일 때도 반 일괄 확정은 보이는 학생에게만(안 보이는 확정값을 덮지 않게 — 리뷰 2026-09-17). */}
          <SessionTermGroups key={p} groups={groups} catalog={view.catalog} period={p} seatShare={seatShare} visibleOnly={pendingOnly || openOnly || query !== "" || activeSubject !== null} />
          <Pagination page={curPage} totalPages={totalPages} total={allGroups.length} hrefForPage={pageHref} />
        </>
      )}
    </section>
    </SessionTermsState>
    </div>
  );
}
