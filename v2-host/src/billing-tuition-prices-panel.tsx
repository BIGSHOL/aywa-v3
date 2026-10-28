// 2.0 tuition-prices-panel.tsx(app/(shell)/billing/_components/tuition-prices-panel.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본, v2-billing-calculator.mjs)이
// 2.0 함수와 같은 모양으로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-calculator.swaps.json — 조회 자리 · 상대 경로 import만).
import Link from "next/link";
import { Coins, CheckCircle2 } from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { TuitionPricesData } from "./billing-types";
import { PMODE_UNSET, PRICING_MODES } from "@/features/billing/tuition-catalog";
import { TuitionPricesTable } from "@/app/(shell)/billing/_components/tuition-prices-table";

// 🔴 '미지정'이 필터에 없으면 **아직 안 고른 항목을 화면에서 골라낼 방법이 아예 없다**(전체·회당·월·할인
//    어디에도 안 잡힌다). 남은 것을 세고 고르는 게 이 화면의 실제 용무라 마지막 칸으로 넣는다.
const PMODE_OPTIONS = [
  ...PRICING_MODES.map((m) => ({ value: m.value, label: m.label })),
  { value: PMODE_UNSET, label: "미지정" },
];
const ACTIVE_OPTIONS = [
  { value: "active", label: "사용" },
  { value: "inactive", label: "중지" },
];
// 이 면의 페이지 파라미터는 `cpage`(상위 면 파라미터와 충돌 방지) — FilterSelect는 `page`만 지우므로 함께 지운다.
const RESET_PAGE = ["cpage"];

type Sp = { q?: string; cat?: string; cpmode?: string; cactive?: string; cpage?: string };
const PAGE_SIZE = 50;

// 수강료 단가표 면(계산기 서브탭). 교재 단가표(catalog-panel) 패턴 미러 — 단, billing 면이 tab=calculator라
// 필터/페이지 파라미터를 cat/cactive/cpage로 네임스페이스(상위 face/하위 sub 파라미터 충돌 방지).
export function TuitionPricesPanel({ sp, data }: { sp: Sp; data: TuitionPricesData }) {
  const q = sp.q ?? "";
  const category = sp.cat ?? "all";
  const pmode = sp.cpmode ?? "all";
  const active = sp.cactive ?? "all";
  const page = Math.max(1, Number(sp.cpage) || 1);

  const [{ rows, total }, stats, categories] = [data.page, data.stats, data.categories];
  // 분류 = 학원설정 과목 ∪ 이미 쓰인 분류 ∪ 기타·할인(감사 D7). 필터와 편집 창이 같은 목록을 쓴다.
  const CATEGORY_OPTIONS = categories.map((c) => ({ value: c, label: c }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const build = (patch: Partial<Sp>) => {
    const next = { q, cat: category, cpmode: pmode, cactive: active, ...patch };
    const p = new URLSearchParams({ tab: "calculator", csub: "prices" });
    if (next.cat && next.cat !== "all") p.set("cat", next.cat);
    if (next.cpmode && next.cpmode !== "all") p.set("cpmode", next.cpmode);
    if (next.cactive && next.cactive !== "all") p.set("cactive", next.cactive);
    if (next.q) p.set("q", next.q);
    if (patch.cpage && patch.cpage !== "1") p.set("cpage", String(patch.cpage));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* KPI — 공용 BigStat(옛 로컬 Kpi 카드는 링 위에 border를 겹쳤다, v5 ④). */}
      <section className="grid grid-cols-2 gap-3.5">
        <BigStat label="등록 단가" value={stats.total} unit="개" tone="primary" icon={<Coins size={16} strokeWidth={1.8} />} />
        <BigStat label="사용 중" value={stats.active} unit="개" tone="primary" icon={<CheckCircle2 size={16} strokeWidth={1.8} />} />
      </section>

      {/* 🔴 아직 단가 종류를 안 고른 항목 — **숫자가 보여야 이 일이 끝난다.** 종류가 없으면 계산기가
          안전하게 월 고정으로 넣는데, 회당 수업이 그렇게 들어가면 한 달치가 한 회차 금액으로 줄고,
          반대로 월정액을 회당으로 바꾸면 EiE 27만원 × N회가 된다(원장 2026-08-07). 바로 걸러 볼 수 있게
          링크를 건다. 남은 게 0이면 배너 자체가 사라진다(끝난 일을 계속 재촉하지 않는다). */}
      {stats.unset > 0 ? (
        <Link
          href={build({ cpmode: PMODE_UNSET, cactive: "active", cpage: "1" })}
          className="border-amber/40 bg-amber-soft text-amber flex flex-wrap items-center gap-x-1.5 rounded-2xl border px-4 py-2.5 text-sm transition hover:brightness-95"
        >
          <span className="font-bold">
            단가 종류를 안 고른 항목이 <span className="num">{stats.unset}</span>개 있습니다
          </span>
          <span className="text-amber/80">
            — 계산기가 이 항목을 <b>월 고정</b>으로 넣습니다. 회당 수업이면 금액이 한 회차분으로 줄어드니
            눌러서 골라 주세요.
          </span>
        </Link>
      ) : null}

      {/* 건수 줄과 '항목 추가' 버튼이 각자 한 행씩 쓰고 있었다(원장 2026-08-07) → 표 툴바 한 행으로 합친다.
          필터(지시서 §10 — 라벨 셋 + 검색 토글)도 같은 행으로(원장 2026-09-22 *"넓은 화면까지 2행일 필요가 없어보임"*). */}
      <TuitionPricesTable
        rows={rows}
        categories={categories}
        summary={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              paramName="cat"
              value={category === "all" ? "" : category}
              options={CATEGORY_OPTIONS}
              axisLabel="분류"
              ariaLabel="분류 필터"
              clearParams={RESET_PAGE}
              className="w-auto"
              triggerClassName={TOOLBAR_SELECT}
            />
            <FilterSelect
              paramName="cpmode"
              value={pmode === "all" ? "" : pmode}
              options={PMODE_OPTIONS}
              axisLabel="단가 종류"
              ariaLabel="단가 종류 필터"
              clearParams={RESET_PAGE}
              className="w-auto"
              triggerClassName={TOOLBAR_SELECT}
            />
            <FilterSelect
              paramName="cactive"
              value={active === "all" ? "" : active}
              options={ACTIVE_OPTIONS}
              axisLabel="상태"
              ariaLabel="사용 상태 필터"
              clearParams={RESET_PAGE}
              className="w-auto"
              triggerClassName={TOOLBAR_SELECT}
            />
            <SearchToggle placeholder="항목명·분류" defaultValue={q} resetParams={RESET_PAGE} />
            <p className="text-text-dim ml-1 text-sm whitespace-nowrap">
              단가 <span className="num text-foreground font-bold">{total}</span>개
              {totalPages > 1 ? (
                <span className="num ml-1.5">
                  · {page}/{totalPages}
                </span>
              ) : null}
            </p>
          </div>
        }
      />
      {totalPages > 1 ? (
        <Pagination page={page} totalPages={totalPages} hrefForPage={(n) => build({ cpage: String(n) })} />
      ) : null}
    </div>
  );
}
