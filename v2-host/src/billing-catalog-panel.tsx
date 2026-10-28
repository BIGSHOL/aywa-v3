// 2.0 catalog-panel.tsx(app/(shell)/billing/_components/catalog-panel.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본,
// v2-billing-textbooks.mjs)이 2.0 함수와 같은 모양으로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-textbooks.swaps.json — 조회 자리 · 상대 경로 import만).
import { BookText, CheckCircle2 } from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { CatalogTable } from "@/app/(shell)/billing/_components/catalog-table";
import type { CatalogPanelData } from "./billing-types";

// 학년은 교재의 coarse 버킷(초/중/고)이라 학원설정 학년 enum이 아니다(catalog-table과 같은 예외, CLAUDE.md).
const GRADE_OPTIONS = [
  { value: "초", label: "초등" },
  { value: "중", label: "중등" },
  { value: "고", label: "고등" },
];
const ACTIVE_OPTIONS = [
  { value: "active", label: "사용" },
  { value: "inactive", label: "중지" },
];

type Sp = { q?: string; grade?: string; active?: string; page?: string };
const PAGE_SIZE = 50;

// 교재 단가표 — 교재 면(목록/교재단가표)과 수강료 계산기 면(…/교재 단가표) 두 곳에서 같은 컴포넌트로 쓴다.
// base = 현재 마운트 위치 파라미터(예: {tab:"textbooks",tsub:"catalog"} 또는 {tab:"calculator",csub:"catalog"}).
// 필터(FilterSelect)·검색(SearchToggle)은 URL의 base를 그대로 두고 제 파라미터만 갈아 끼우므로 해당 면 안에 머문다.
export function CatalogPanel({ sp, base, data }: { sp: Sp; base: Record<string, string>; data: CatalogPanelData }) {
  const q = sp.q ?? "";
  const grade = sp.grade ?? "all";
  const active = sp.active ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, stats] = [data.page, data.stats];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const p = new URLSearchParams(base);
    if (grade !== "all") p.set("grade", grade);
    if (active !== "all") p.set("active", active);
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* KPI — 공용 BigStat(옛 로컬 Kpi 카드는 링 위에 border를 겹쳤다, v5 ④). */}
      <section className="grid grid-cols-2 gap-3.5">
        <BigStat label="등록 교재" value={stats.total} unit="종" tone="rose" icon={<BookText size={16} strokeWidth={1.8} />} />
        <BigStat label="사용 중" value={stats.active} unit="종" tone="primary" icon={<CheckCircle2 size={16} strokeWidth={1.8} />} />
      </section>

      {/* 결과 줄 + 필터(지시서 §10): 옛 `micro` 소라벨 + 칩 두 묶음(학년 4·상태 3) + 상시 검색창 → `학년: 전체`·`상태: 전체` 라벨 + 검색 토글. */}
      {/* ↳ 그 줄이 '교재 추가' 버튼과 한 행을 나눠 쓴다(원장 2026-09-22 — 종전엔 버튼 하나만 선 둘째 줄이 있었다). */}
      <CatalogTable
        rows={rows}
        toolbar={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-text-dim text-sm whitespace-nowrap">
              교재 <span className="num text-foreground font-bold">{total}</span>종
              {totalPages > 1 ? (
                <span className="num ml-1.5">
                  · {page}/{totalPages}
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                paramName="grade"
                value={grade === "all" ? "" : grade}
                options={GRADE_OPTIONS}
                axisLabel="학년"
                ariaLabel="학년 필터"
                className="w-auto"
                triggerClassName={TOOLBAR_SELECT}
              />
              <FilterSelect
                paramName="active"
                value={active === "all" ? "" : active}
                options={ACTIVE_OPTIONS}
                axisLabel="상태"
                ariaLabel="사용 상태 필터"
                className="w-auto"
                triggerClassName={TOOLBAR_SELECT}
              />
              <SearchToggle placeholder="교재명·출판사" defaultValue={q} />
            </div>
          </div>
        }
      />
      {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
    </div>
  );
}
