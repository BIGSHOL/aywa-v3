// 2.0 수납 면(app/(shell)/billing/_components/billing-content.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 다섯 조회
// (getInvoicesForPeriod · getAvailablePeriods · getStudentOptions · getMakeeduSyncState · canWriteTenant)는 /api/v2/billing이 내고
// 여기서는 본문을 **글자 그대로** 옮겼다(billing-page.swaps.json "content" 짝 — 조회 자리 · 상대 경로 import만).
import Link from "next/link";
import { Receipt, BadgePercent, CircleDollarSign, Percent, ReceiptText } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { InvoiceRow, SortKey } from "@/features/billing/server/queries";
import { invoiceOutstanding, paymentRateDisplay, summarizeInvoices } from "@/features/billing/calc";
import {
  isOverdue,
  isOutsideSyncWindow,
  isMissingFromMakeedu,
  lastTouchedAt,
} from "@/features/billing/sync-window";
import type { StudentOption } from "@/features/billing/server/textbook-queries";
import type { MakeeduSyncState } from "@/features/integrations/server/makeedu-sync";
import { SearchToggle } from "@/components/search-toggle";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { BillingTable } from "@/app/(shell)/billing/_components/billing-table";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";
import { CreateInvoiceTrigger } from "@/app/(shell)/billing/_components/create-invoice-dialog";
import { Pagination } from "@/components/pagination";

/** /api/v2/billing의 수납 면 자료 — billing-content가 서버에서 받던 다섯 값(이름 그대로). */
export type BillingFaceData = {
  monthRows: InvoiceRow[];
  periods: string[];
  students: StudentOption[];
  syncState: MakeeduSyncState | null;
  canWriteBilling: boolean;
};

const KRW = new Intl.NumberFormat("ko-KR");
function won(n: number) {
  return `${KRW.format(n)}원`;
}
function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y}년 ${Number(m)}월`;
}
function todayIso(): string {
  return kstToday();
}
/** KST 표시 규칙 — 화면에 뜨는 시각은 항상 Asia/Seoul(feedback_kst-timezone-display-rule). */
function kstDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function currentPeriod(): string {
  return kstMonth();
}

type Sp = {
  period?: string;
  /** 업무 흐름의 청구 1건 — 기존 표와 저장 동작을 그대로 쓴다. */
  invoice?: string;
  q?: string;
  sort?: SortKey;
  desc?: string;
  page?: string;
  /** "1"이면 기한 경과(미완납 + 납부기한 지남) 행만 — 배너 '목록 보기'가 켠다. */
  overdue?: string;
  /** "1"이면 마지막 동기화에 없던(= makeedu에서 사라진) 행만 — 경고의 '목록 보기'가 켠다. */
  missing?: string;
};

/** `canImport` = 엑셀 가져오기(청구서) 권한 — 페이지가 billing full(`canManageTenant`)로 정한 값. */
export function BillingContent({ sp, canImport = false, data }: { sp: Sp; canImport?: boolean; data: BillingFaceData }) {
  const period = sp.period ?? currentPeriod();
  const q = sp.invoice ? "" : sp.q ?? "";
  const sort: SortKey = (sp.sort as SortKey) ?? "status";
  const desc = sp.desc === "1";
  const overdueOnly = !sp.invoice && sp.overdue === "1";
  const missingOnly = !sp.invoice && sp.missing === "1";
  const PAGE_SIZE = 50;
  const page = sp.invoice ? 1 : Math.max(1, Number(sp.page) || 1);

  // 수동 청구서 '완납'·'취소'(감사 N15)를 세울지 — 서버 액션이 같은 게이트를 다시 본다.
  const { monthRows, periods, students, syncState, canWriteBilling } = data;

  const summary = summarizeInvoices(monthRows, period);
  const today = todayIso();

  // ── 이 달이 makeedu 동기화 창(스크랩 범위) 안에 있는가 ────────────────────────
  // makeedu 상세수납 목록은 **현재 청구월 한 달만** 보여주고 스크랩에 월 파라미터가 없어(scrape.cjs),
  // 청구월이 다음 달로 넘어가면 직전 달은 그 뒤로 단 한 번도 갱신되지 않는다(2026-07은 07-16에 동결).
  // 임포터 upsert는 값이 같아도 updated_at=now()를 쓰므로 "이 달 최신 updated_at"이 커버리지 프록시다.
  // 도메인 배지는 synced_at만 보고 "동기화 N시간 전"이라 말하므로, 그 위에서 이 달이 화석인지 따로 알린다.
  const lastTouched = lastTouchedAt(monthRows);
  const outsideSyncWindow = isOutsideSyncWindow({ rows: monthRows, syncedAt: syncState?.syncedAt });

  // ── 마지막 동기화에 없던 청구(= makeedu에서 사라진 행) ──────────────────────
  // 같은 프록시를 행 단위로 쓴다. 이 신호는 지금까지 makeedu_sync_state.error의 "재원생 청구 부재 N건"
  // 한 줄로만 존재해 **누구인지 알 수 없었다**(DB를 뒤져야 했다). 돈이 걸린 신호는 화면까지 와야 한다.
  // ⚠️ 동결된 달은 전 행이 미갱신이라 이 표시가 무의미하다 → **창 안인 달에서만** 켠다.
  const missingFromMakeedu = (r: { updatedAt: string | null }): boolean =>
    isMissingFromMakeedu({ row: r, syncedAt: syncState?.syncedAt, outsideSyncWindow });
  const missingRows = monthRows.filter(missingFromMakeedu);
  const missingAmount = missingRows.reduce((s, r) => s + invoiceOutstanding(r), 0);

  // ⚠️ 배너·KPI는 **항상 이 달 전체(monthRows)** 기준이다 — 검색은 표만 좁힌다.
  // (예전엔 배너만 검색 결과 기준이라 같은 화면에 모집단이 다른 '미수' 숫자 2개가 떴다. 2026-07-30 적대 리뷰.)
  const overdue = monthRows.filter((r) => isOverdue(r, today));
  // 미수금은 실청구(청구−할인) 기준 — calc.ts 행 레벨 단일 공식(음수는 0).
  const overdueAmount = overdue.reduce((s, r) => s + invoiceOutstanding(r), 0);

  const term = q.trim().toLowerCase();
  const searched = term
    ? monthRows.filter(
        (r) =>
          r.studentName.toLowerCase().includes(term) ||
          r.lineItems.some((li) => li.description.toLowerCase().includes(term)),
      )
    : monthRows;
  // '목록 보기'(overdue=1) = **진짜 필터**. 예전엔 sort=due_date만 바꿔서, 401건 중 396건의 납부기한이
  // 같은 달(2026-07)에선 기본 정렬로 1페이지에 모여 있던 연체 38건을 9페이지에 흩뿌렸다(정반대 효과).
  const afterOverdue = overdueOnly ? searched.filter((r) => isOverdue(r, today)) : searched;
  const filtered = sp.invoice ? monthRows.filter((r) => r.id === sp.invoice) : missingOnly ? afterOverdue.filter(missingFromMakeedu) : afterOverdue;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 진행률 바도 실청구(청구−할인) 기준 — 완납 학생이 할인폭만큼 미수 밴드로 새지 않게.
  const netBase = summary.totalBilled - summary.totalDiscount || 1;
  const paidPct = Math.min((summary.totalCollected / netBase) * 100, 100);
  const partialPct = Math.max(
    0,
    (monthRows
      .filter((r) => r.status === "partial")
      .reduce((s, r) => s + invoiceOutstanding(r), 0) /
      netBase) *
      100,
  );
  // 🔴 '미납' 조각 = 전액 미납 청구의 남은 금액 — 예전엔 100 − 완납 − 부분납의 **나머지**로 그려 포인트 결제 잔차가
  //    빨간 '미납'으로 보였다(옆 타일은 미수 0건, 점검 2026-09-28). 어디에도 안 속하는 나머지는 빈 트랙으로 둔다.
  const unpaidPct = Math.min(
    Math.max(0, 100 - paidPct - partialPct),
    (monthRows.filter((r) => r.status === "unpaid").reduce((s, r) => s + invoiceOutstanding(r), 0) / netBase) * 100,
  );

  // 모든 링크가 현재 필터 상태(기한 경과만 포함)를 보존한다 — 한쪽을 바꿔도 다른 쪽이 조용히 리셋되지 않게.
  const buildHref = (opts: {
    period: string;
    q: string;
    sort: SortKey;
    desc: boolean;
    overdue?: boolean;
    missing?: boolean;
  }): string => {
    const params = new URLSearchParams();
    if (opts.period !== currentPeriod()) params.set("period", opts.period);
    if (opts.q) params.set("q", opts.q);
    if (opts.sort !== "status") params.set("sort", opts.sort);
    if (opts.desc) params.set("desc", "1");
    if (opts.overdue ?? overdueOnly) params.set("overdue", "1");
    if (opts.missing ?? missingOnly) params.set("missing", "1");
    const s = params.toString();
    return s ? `/billing?${s}` : "/billing";
  };
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (period !== currentPeriod()) params.set("period", period);
    if (q) params.set("q", q);
    if (sort !== "status") params.set("sort", sort);
    if (desc) params.set("desc", "1");
    if (overdueOnly) params.set("overdue", "1");
    if (missingOnly) params.set("missing", "1");
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/billing?${s}` : "/billing";
  };

  // 헤더 서브 라인(풀·컴팩트 공용) — 검색·페이지 상태까지 포함(헤더가 총 필터 결과 수의 유일한 표시처).
  // 수납률 글자는 정본 `paymentRateDisplay`(운영실과 같은 글자 — 미수가 남으면 100이라 적지 않고, 없으면 100).
  const periodSummary = `청구 ${summary.totalCount}건 · 수납률 ${paymentRateDisplay(summary.paymentRate, summary.outstanding)}%${
    overdueOnly ? ` · 기한 경과만 ${total}건` : ""
  }${missingOnly ? ` · 동기화 누락만 ${total}건` : ""}${q ? ` · “${q}” 검색 결과 ${total}건` : ""}${
    totalPages > 1 ? ` · ${page}/${totalPages} 페이지` : ""
  }`;

  return (
    <div className="space-y-3">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브(청구·수납률 승격). 상시 버튼 = Primary '청구서 만들기' 하나 — 엑셀 내보내기/가져오기는 검색 줄로(원장 2026-09-29 통일).
          (디자인 v5 §10 — 종전엔 툴바 오른쪽에 outline 둘이었다). */}
      <PageHeader
        eyebrow="수납 관리"
        title="수납 현황"
        description={periodSummary}
        // 창 컴팩트 행에선 title이 접히므로 월을 라벨에 명시(월 네비는 아래 툴바). 검색 결과 건수·페이지 접미사도
        // 동일하게(창이 기본 경로라 빠지면 검색 피드백이 사라짐, 적대 리뷰).
        embedLabel={`${formatPeriod(period)} · ${periodSummary}`}
        actions={
          <>
            <CreateInvoiceTrigger students={students} defaultPeriod={period} />
          </>
        }
      />

      {/* 툴바 — 월 이동은 수납 면 공용 BillingMonthNav(앱 전역 PeriodNav + 월 직접 선택 라벨; 옛 '최근 6개월 알약 칩 줄'은
          §10 칩 줄 금지로 걷었다 — 화살표만으론 옛 달까지 여러 번 눌러야 한다) + 검색(눌러야 나온다).
          항목 = 청구가 있는 달(최근 순). 신규 청구는 머리, 엑셀은 검색 옆(같은 동작 두 곳 금지). 🔴 툴바 카드 껍데기 없음(원장 2026-09-01). */}
      <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">
        <BillingMonthNav
          period={period}
          hrefFor={(per) => buildHref({ period: per, q, sort, desc })}
          months={periods}
          ariaLabel="청구월 선택"
        />
        <div className="ml-auto flex items-center gap-2">
          <SearchToggle placeholder="학생명·항목" defaultValue={q} />
          {/* 엑셀 내보내기/가져오기 — 검색과 같은 줄(원장 2026-09-29 통일). 내보내기 = 화면과 같은 집합(기한 경과 필터 포함). */}
          <ExcelMenu
            exportHref={`/api/exports/billing?${new URLSearchParams({
              period,
              ...(q ? { q } : {}),
              ...(overdueOnly ? { overdue: "1" } : {}),
              ...(missingOnly ? { missing: "1" } : {}),
            }).toString()}`}
            importKind={canImport ? "invoices" : null}
          />
        </div>
      </div>

      {outsideSyncWindow && lastTouched ? (
        /* ⚠️ 이 달 숫자가 '최신'이 아님을 화면이 스스로 말한다 — 상단 동기화 배지는 도메인 시각만 보므로
           동결된 달 위에서도 "동기화 N시간 전"이라고 말한다(그게 이 경고가 필요한 이유). */
        <section className="border-amber/40 bg-amber-soft flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
          <span className="text-amber shrink-0">
            <EyIcon name="alert" size={16} />
          </span>
          <p className="text-foreground min-w-0 flex-1 text-xs leading-relaxed">
            <b>
              {formatPeriod(period)} 숫자는 <span className="num">{kstDateTime(lastTouched)}</span> 이후
              갱신되지 않았습니다.
            </b>{" "}
            makeedu 상세수납은 가장 최근 청구월 한 달만 보여줍니다 — 달이 바뀌어서가 아니라{" "}
            <b>다음 달 청구가 시작되는 순간</b> 이 달 화면이 닫힙니다. 그 뒤 들어온 납부·삭제가 반영되지
            않으므로 <b>아래 미수는 실제보다 많습니다.</b>
          </p>
        </section>
      ) : null}

      {missingRows.length > 0 && syncState ? (
        /* 지금까지 이 신호는 makeedu_sync_state.error의 "재원생 청구 부재 N건" 한 줄로만 존재해
           **누구인지 알 수 없었다**(DB를 뒤져야 했다). 돈이 걸린 신호는 화면까지 와야 한다. */
        <section className="border-amber/40 bg-amber-soft flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
          <span className="text-amber shrink-0">
            <EyIcon name="alert" size={16} />
          </span>
          <p className="text-foreground min-w-0 flex-1 text-xs leading-relaxed">
            <b>
              마지막 동기화에 없던 청구 <span className="num">{missingRows.length}</span>건
            </b>{" "}
            {" "}(미수 <span className="num">{won(missingAmount)}</span>) · 기준 <span className="num">{kstDateTime(syncState.syncedAt)}</span>.
            <span className="block">삭제·청구월 이동 여부 확인이 필요합니다. 퇴원 확인 전까지 금액에 포함됩니다.</span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            render={<Link href={buildHref({ period, q, sort, desc, missing: !missingOnly })} />}
          >
            {missingOnly ? "필터 해제" : "목록 보기"}
          </Button>
        </section>
      ) : null}

      {total === 0 ? (
        /* 빈 이유를 구분해 말한다 — 필터 때문에 비었는데 "청구 내역이 없습니다"라고 하면 거짓말. */
        <EmptyState
          image={q || overdueOnly || missingOnly ? "search" : "billing"}
          icon={() => <ReceiptText size={32} strokeWidth={1.8} />}
          title={
            missingOnly
              ? "현재 조건에 맞는 청구가 없습니다"
              : overdueOnly
                ? "기한 경과 건이 없습니다"
                : q
                  ? "검색 결과 없음"
                  : "이 달 청구 내역이 없습니다"
          }
          description={missingOnly ? "이미 저장된 청구 중 마지막 동기화에 없던 건만 표시합니다. 학생 미매칭으로 가져오지 못한 수납은 우상단 ‘확인 필요’에서 확인하세요." : undefined}
          action={
            overdueOnly || missingOnly ? (
              <Button
                variant="outline"
                render={<Link href={buildHref({ period, q, sort, desc, overdue: false, missing: false })} />}
              >
                전체 보기
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* KPI 5종 — Editorial 문법 ②(BigStat). 금액은 num tabular + "원" 단위 분리, 미수금만 danger 강조. */}

          <StatStrip>
            <BigStat
              label="총 청구액"
              value={KRW.format(summary.totalBilled)}
              unit="원"
              tone="primary"
              icon={<Receipt size={16} strokeWidth={1.8} />}
              sub={`${summary.totalCount}건`}
            />
            <BigStat
              label="할인 합계"
              value={KRW.format(summary.totalDiscount)}
              unit="원"
              tone="amber"
              icon={<BadgePercent size={16} strokeWidth={1.8} />}
            />
            <BigStat
              label="수납 완료"
              value={KRW.format(summary.totalCollected)}
              unit="원"
              tone="green"
              icon={<MenuGlyph name="check" size={22} />}
              sub={`${summary.paidCount}건`}
            />
            <BigStat
              label="미수금"
              value={KRW.format(summary.outstanding)}
              unit="원"
              tone="danger"
              valueClass="text-danger"
              icon={<CircleDollarSign size={16} strokeWidth={1.8} />}
              sub={`부분 ${summary.partialCount} · 미수 ${summary.unpaidCount}건`}
            />
            <BigStat
              label="수납률"
              value={paymentRateDisplay(summary.paymentRate, summary.outstanding)}
              unit="%"
              tone="gold"
              icon={<Percent size={16} strokeWidth={1.8} />}
            />
          </StatStrip>

          {/* 수납 진행률 — 카드 껍데기 없이 스탯 줄 아래 한 줄(§4 카드 안의 카드 금지 · 시선 앵커 셋 = 머리·스탯·표).
              의미색 캐논 — 완납=positive(green) · 부분=caution(amber) · 미수=critical(danger). */}
          <div className="px-1">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-foreground text-sm font-bold">수납 진행률</span>
              <span className="text-text-dim num text-sm">
                수납 {paymentRateDisplay(summary.paymentRate, summary.outstanding)}% · 부분납부 잔액 {partialPct.toFixed(1)}% · 미납 {unpaidPct.toFixed(1)}%
              </span>
            </div>
            <div className="bg-bg-soft flex h-2.5 overflow-hidden rounded-pill">
              <span className="bg-green block h-full" style={{ width: `${paidPct}%` }} />
              <span className="bg-amber block h-full" style={{ width: `${partialPct}%` }} />
              <span className="bg-danger block h-full" style={{ width: `${unpaidPct}%` }} />
            </div>
          </div>

          {overdue.length > 0 ? (
            /* 기한 경과 배너 — 굵은 건수+금액 위계 + 우측 '목록 보기'(그 건들만 남기는 진짜 필터) */
            <section className="bg-danger-soft flex flex-wrap items-center gap-3 rounded-lg px-3 py-2">
              <span className="text-danger flex shrink-0 items-center justify-center">
                <CircleDollarSign size={18} strokeWidth={1.8} />
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-foreground text-sm font-bold">기한 경과 미수금</p>
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="num text-danger text-base font-bold leading-none">
                    {overdue.length}
                  </span>
                  <span className="text-text-dim text-xs">건</span>
                  <span className="num text-foreground text-lg font-bold">{won(overdueAmount)}</span>
                </p>
              </div>
              <Link
                href={buildHref({ period, q, sort, desc, overdue: !overdueOnly })}
                className={`inline-flex h-(--control-h) shrink-0 items-center rounded-md border px-2 text-sm font-bold transition ${
                  overdueOnly
                    ? "border-danger bg-danger text-white hover:bg-danger/90"
                    : "border-danger/40 text-danger hover:bg-danger/10"
                }`}
              >
                {overdueOnly ? "필터 해제" : "목록 보기"}
              </Link>
            </section>
          ) : null}

          {/* 필터가 걸려 있으면 표 위에 상태를 명시(어떤 집합을 보고 있는지 화면이 스스로 말한다). */}
          {overdueOnly || missingOnly ? (
            <p className="text-text-dim flex flex-wrap items-center gap-2 text-xs">
              {overdueOnly ? (
                <span className="bg-danger-soft text-danger rounded-full px-2.5 py-0.5 font-medium">
                  기한 경과만 {total}건
                </span>
              ) : null}
              {missingOnly ? (
                <span className="bg-amber-soft text-amber rounded-full px-2.5 py-0.5 font-medium">
                  마지막 동기화에 없던 청구만 {total}건
                </span>
              ) : null}
              <Link
                href={buildHref({ period, q, sort, desc, overdue: false, missing: false })}
                className="hover:text-foreground underline"
              >
                전체 보기
              </Link>
            </p>
          ) : null}

          <BillingTable
            rows={rows}
            sort={sort}
            desc={desc}
            period={period}
            q={q}
            overdueOnly={overdueOnly}
            missingOnly={missingOnly}
            canWrite={canWriteBilling}
          />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
