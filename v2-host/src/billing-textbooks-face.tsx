// 2.0 textbooks-face.tsx(app/(shell)/billing/_components/textbooks-face.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본,
// v2-billing-textbooks.mjs)이 2.0 함수와 같은 모양으로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-textbooks.swaps.json — 조회 자리 · 상대 경로 import만).
import { FaceTabs, type Face } from "@/components/face-tabs";
import { TextbooksPanel } from "./billing-textbooks-panel";
import { CatalogPanel } from "./billing-catalog-panel";
import type { TextbooksFaceData } from "./billing-types";

type Sp = Record<string, string | undefined>;

// 교재 면 — 내부탭 2개: 목록(교재신청 textbook_orders) / 교재 단가표(catalog).
// 교재 단가표는 수강료 계산기 면과 같은 CatalogPanel을 재사용(두 곳에서 동일 탭). base로 위치 보존.
const SUB_FACES: Face[] = [
  { key: "list", label: "목록", href: "/billing?tab=textbooks" },
  { key: "catalog", label: "교재 단가표", href: "/billing?tab=textbooks&tsub=catalog" },
];

export function TextbooksFace({ sp, data }: { sp: Sp; data: TextbooksFaceData }) {
  const sub = sp.tsub === "catalog" ? "catalog" : "list";
  return (
    <div className="space-y-4">
      <FaceTabs faces={SUB_FACES} active={sub} level="secondary" ariaLabel="교재 면 전환" />
      {sub === "catalog" ? (
        <CatalogPanel sp={sp} base={{ tab: "textbooks", tsub: "catalog" }} data={data.catalog!} />
      ) : (
        <TextbooksPanel sp={sp} data={data.list!} />
      )}
    </div>
  );
}
