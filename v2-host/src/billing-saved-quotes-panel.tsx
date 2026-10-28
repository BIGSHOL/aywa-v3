// 2.0 saved-quotes-panel.tsx(app/(shell)/billing/_components/saved-quotes-panel.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본, v2-billing-calculator.mjs)이
// 2.0 함수와 같은 모양으로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-calculator.swaps.json — 조회 자리 · 상대 경로 import만).
import { FileText } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { SearchToggle } from "@/components/search-toggle";
import { Pagination } from "@/components/pagination";
import type { SavedQuotesData } from "./billing-types";
import { currentPeriod } from "@/features/billing/calc";
import { SavedQuotesList } from "@/app/(shell)/billing/_components/saved-quotes-list";

type Sp = { q?: string; qpage?: string };
const PAGE_SIZE = 50;

// 저장된 청구서(견적) 목록 — 신입생 상담 견적(tuition_quotes). 클릭 시 계산기로 다시 열기(?qid=).
export function SavedQuotesPanel({ sp, data }: { sp: Sp; data: SavedQuotesData }) {
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.qpage) || 1);
  const [{ rows, total }, students] = [data.page, data.students];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "calculator", csub: "quotes" });
    if (q) p.set("q", q);
    if (n > 1) p.set("qpage", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 표·카드가 자기 테두리를 가져 선이 겹쳤다. */}
      {/* 검색은 눌러야 나온다(§10). 페이지 파라미터는 `qpage`라 함께 지운다. */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <FileText className="text-primary size-4" />
          저장된 청구서 <span className="num text-text-dim font-normal">{total}건</span>
        </p>
        <SearchToggle placeholder="학생 이름·학교" defaultValue={q} resetParams={["qpage"]} />
      </div>

      {total === 0 ? (
        <EmptyState
          image={q ? "search" : "billing"}
          icon={() => <FileText size={32} strokeWidth={1.8} />}
          title={q ? "검색 결과 없음" : "저장된 견적이 없습니다"}
          description={q ? "검색어를 조정해보세요." : "계산기 탭에서 신입생 상담 견적을 만들어 저장하세요."}
        />
      ) : (
        <>
          <SavedQuotesList rows={rows} students={students} defaultPeriod={currentPeriod()} />
          {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
        </>
      )}
    </div>
  );
}
