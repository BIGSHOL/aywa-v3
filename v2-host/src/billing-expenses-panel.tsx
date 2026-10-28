// 2.0 expenses-panel.tsx(app/(shell)/billing/_components/expenses-panel.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회와 집계(summarizeExpenses)는
// /api/v2/billing(Docker 복사본, v2-billing-expenses.mjs)이 2.0 함수 그대로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-expenses.swaps.json).
import { Wallet, PieChart, Tags } from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { ExpensesPanelData } from "./billing-types";
import { currencyMeta, formatMoney } from "@/features/billing/currencies";
import { EXPENSE_FILTER_CATEGORIES, filterExpensesForView, normalizeExpenseCategoryFilter } from "@/features/billing/expense-search";
import { SearchToggle } from "@/components/search-toggle";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { kstMonth, monthLabel } from "@/lib/date-kst";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";
import { ExpensesTable } from "@/app/(shell)/billing/_components/expenses-table";

const CATS: readonly string[] = EXPENSE_FILTER_CATEGORIES;

function currentPeriod(): string {
  return kstMonth();
}

type Sp = { period?: string; cat?: string; q?: string };

/** `canImport` = 엑셀 가져오기(지출) 권한 — 페이지가 billing full로 정한 값. */
export function ExpensesPanel({ sp, canImport = false, data }: { sp: Sp; canImport?: boolean; data: ExpensesPanelData }) {
  const period = sp.period ?? currentPeriod();
  // ⚠️ 아는 분류만 받는다 — 손으로 친 `?cat=zzz`면 드롭다운은 "분류"(전체)로 보이는데 표만 비어
  //    화면이 스스로 모순됐고, 아래 빈 화면 문구가 그 쓰레기 값을 그대로 읊었다.
  const cat = normalizeExpenseCategoryFilter(sp.cat);
  // ⚠️ `?q=a&q=b`면 Next가 **배열**을 준다(타입은 string이라 조용하다) → `.trim()`이 터져 면이 500.
  //    문자열일 때만 받는다.
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  // ⚠️ B2 — 이 조회는 **월로 좁힌** 셀렉트라 PostgREST 1000행 절단과 무관하다(실측 2026-09-10:
  //    전체 220행 · 한 달 최대 55행 = 2026-07, 상한의 5.5%). 검색을 DB `ilike`로 내리지 않고 이 달 행 위에서
  //    거르는 이유도 그것 — 같은 배열로 KPI·분류별 바를 내는데, 검색만 따로 조회하면 화면 안에서
  //    **모집단이 둘**이 된다(수납 면이 2026-07-30 적대 리뷰로 정리한 바로 그 함정).
  const [allRows, months] = [data.rows, data.months];
  // 🔴 집계는 **언제나 이 달 전체(allRows)** 기준 — 검색·분류 필터가 닿지 않는다(돈 산식 불변).
  const summary = data.summary; // 이 달 전체 집계 = 서버가 2.0 summarizeExpenses 원문으로(server-only 파일 안의 순수 함수)
  const rows = filterExpensesForView(allRows, cat, q);
  const filterOn = cat !== "all" || q !== "";

  const maxCat = Math.max(1, ...summary.byCategory.map((c) => c.amount));
  // 통화별 합계 — primary(건수 최다)는 KPI 대표값, 나머지는 분리 표기. 분류별 바는 primary 통화 기준.
  const primaryCurrency = summary.primaryCurrency;
  const primaryTotal = summary.byCurrency[0];
  const otherCurrencies = summary.byCurrency.slice(1);
  const multiCurrency = summary.byCurrency.length > 1;

  // ⚠️ 검색어를 함께 실어야 **달을 옮겨도 검색이 유지된다** — 안 실으면 화살표 한 번에 검색이 조용히
  //    풀리고 입력창만 비어(수납 면 `buildHref`가 같은 이유로 q를 나른다). 빈 문자열은 안 싣는다.
  const hrefFor = (opts: { period?: string; cat?: string; q?: string }) => {
    const p = new URLSearchParams({ tab: "expenses" });
    const per = opts.period ?? period;
    const c = opts.cat ?? cat;
    const query = opts.q ?? q;
    if (per !== currentPeriod()) p.set("period", per);
    if (c !== "all") p.set("cat", c);
    if (query) p.set("q", query);
    return `/billing?${p.toString()}`;
  };
  /** 필터를 전부 풀어 이 달 전체로 — 걸러서 빈 화면이 됐을 때 되돌아갈 길. */
  const clearHref = hrefFor({ cat: "all", q: "" });

  return (
    <div className="space-y-4">
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav(PeriodNav + `월:` 드롭다운, 옛 size-8 화살표 링크 대체) ·
          분류 칩 6개 → `분류: 전체` 라벨 하나 · 검색(원장 2026-09-10 *"지출에서 검색할 수 있도록"*).
          🔴 툴바 카드 껍데기 없음(원장 2026-09-01). 치수는 부품(SearchToggle·FilterSelect)이 control-scale에서
          읽는다 — 여기서 h-*·rounded-*를 손으로 적지 않는다(toolbar-canon). */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={period} hrefFor={(per) => hrefFor({ period: per })} months={months} ariaLabel="지출 월 선택" />
        <FilterSelect
          paramName="cat"
          value={cat === "all" ? "" : cat}
          options={CATS.map((c) => ({ value: c, label: c }))}
          axisLabel="분류"
          ariaLabel="지출 분류 필터"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        {/* 수납·교재 면과 같은 공용 검색(눌러야 나온다). 대상 칸은 `expense-search.ts` 머리주석 —
            제목·거래처·성명·부서명·메모 + 라인 항목의 용도·거래처·사용내역. 금액·분류는 일부러 뺐다. */}
        <SearchToggle placeholder="제목·거래처·성명" defaultValue={q} />
        {/* 엑셀 내보내기/가져오기(감사 N2 · 원장 2026-09-29 통일) — 내보내기 = 표와 같은 집합(월·분류·검색어). */}
        <ExcelMenu
          exportHref={`/api/exports/expenses?${new URLSearchParams({
            period,
            ...(cat !== "all" ? { cat } : {}),
            ...(q ? { q } : {}),
          }).toString()}`}
          importKind={canImport ? "expenses" : null}
        />
        {months.length > 0 ? (
          <span className="text-text-faint num ml-auto text-sm whitespace-nowrap">지출 기록 {months.length}개월</span>
        ) : null}
      </div>

      {summary.count === 0 ? (
        <ExpensesTable rows={rows} />
      ) : (
        <>
          {/* KPI — 공용 BigStat(옛 로컬 Kpi 카드는 링 위에 border를 겹쳐 선이 이중이었다, v5 ④). */}
          <StatStrip>
            <BigStat
              label="월 지출 합계"
              value={primaryTotal ? formatMoney(primaryTotal.total, primaryTotal.currency) : "—"}
              tone="danger"
              icon={<Wallet size={16} strokeWidth={1.8} />}
              sub={
                `${summary.count}건` +
                (otherCurrencies.length > 0
                  ? ` · ${otherCurrencies.map((o) => formatMoney(o.total, o.currency)).join(" · ")}`
                  : "")
              }
            />
            <BigStat
              label="최대 분류"
              value={summary.byCategory[0]?.category ?? "—"}
              tone="purple"
              icon={<PieChart size={16} strokeWidth={1.8} />}
              sub={summary.byCategory[0] ? formatMoney(summary.byCategory[0].amount, primaryCurrency) : undefined}
            />
            <BigStat label="분류 수" value={summary.categoryCount} unit="개" tone="blue" icon={<Tags size={16} strokeWidth={1.8} />} />
          </StatStrip>

          {/* 카테고리 분포 — primary 통화 기준(통화별 합계는 위 KPI 참조). 카드 = 링 하나(v5 ④). */}
          <section className="border-line rounded-lg border px-3 py-3">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-foreground text-base font-bold">분류별 지출</h2>
              {/* 🔴 걸러 보는 중이면 **이 막대가 무엇의 합인지** 말한다 — 위 KPI·이 막대는 이 달 전체고
                  아래 표만 좁아진다. 안 적으면 같은 화면에서 "9건"과 55건짜리 막대가 나란히 서서
                  막대가 검색 결과의 합인 것처럼 읽힌다(수납 면이 겪은 '모집단 둘' 함정). */}
              {filterOn || multiCurrency ? (
                <span className="text-text-faint text-sm">
                  {/* ⚠️ 짧게 — 통화 안내와 한 줄에 서므로(실데이터에 USD 12행이 있어 실제로 겹친다). */}
                  {filterOn ? "이 달 전체 기준(분류·검색 무관)" : null}
                  {filterOn && multiCurrency ? " · " : null}
                  {multiCurrency ? `통화 ${currencyMeta(primaryCurrency).symbol} 기준 · 다른 통화는 상단 합계 참조` : null}
                </span>
              ) : null}
            </div>
            <div className="grid gap-x-6 gap-y-2 min-[960px]:grid-cols-2">
              {summary.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-text-dim w-20 shrink-0 text-sm whitespace-nowrap">{c.category}</span>
                  <div className="bg-bg-soft rounded-pill h-2.5 flex-1 overflow-hidden">
                    <span className="bg-primary block h-full" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <span className="num text-foreground shrink-0 text-right text-sm font-medium whitespace-nowrap">{formatMoney(c.amount, primaryCurrency)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 결과 줄 — 🔴 걸렀으면 **`전체 N건 중 M건`**으로 적는다. 예전엔 필터가 켜져도 `지출 9건`이라
              해서, 위 KPI가 말하는 55건과 같은 화면에 서면 어느 쪽이 이 달의 사실인지 알 수 없었다.
              두 숫자를 한 문장에 넣어 서로를 설명하게 한다(집계는 그대로 이 달 전체다). */}
          <ExpensesTable
            toolbar={<p className="text-text-dim px-1 text-sm">
            {monthLabel(period)} 지출{" "}
            {filterOn ? (
              <>
                <span className="num">{summary.count}</span>건 중{" "}
                <span className="num text-foreground font-bold">{rows.length}</span>건 표시
              </>
            ) : (
              <>
                <span className="num text-foreground font-bold">{rows.length}</span>건
              </>
            )}
            {cat !== "all" ? <span className="ml-1">· 분류 {cat}</span> : null}
            {q ? <span className="ml-1">· &ldquo;{q}&rdquo; 검색</span> : null}
          </p>}
            rows={rows}
            // 이 달엔 지출이 있는데 걸러서 0건이면 "이 달 지출 내역이 없습니다"는 **거짓말**이다.
            // ⚠️ 검색이 **분류를 안 본다**(옆에 전용 드롭다운이 있으니까) → `인건비`를 쳐서 0건이 나오면
            //    고장으로 읽힌다. 그래서 어디를 찾는지·분류는 어디서 고르는지 한 줄로 알린다.
            empty={
              filterOn
                ? {
                    title: q ? `“${q}” 검색 결과가 없습니다.` : `${cat} 분류의 지출이 없습니다.`,
                    hint: q
                      ? "제목·거래처·성명·부서명·메모와 항목 내역에서 찾습니다. 분류는 위 ‘분류’에서 고르세요."
                      : undefined,
                    clearHref,
                  }
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}
