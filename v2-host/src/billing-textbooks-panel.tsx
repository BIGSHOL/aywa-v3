// 2.0 textbooks-panel.tsx(app/(shell)/billing/_components/textbooks-panel.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본,
// v2-billing-textbooks.mjs)이 2.0 함수와 같은 모양으로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-textbooks.swaps.json — 조회 자리 · 상대 경로 import만).
import {
  BookText,
  Clock,
  CircleDollarSign,
  Receipt,
} from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { TextbookStats } from "@/features/billing/server/textbook-queries";
import type { TextbooksPanelData } from "./billing-types";
import { accountForTarget } from "@/features/owner/settings-types";
import { kstToday } from "@/lib/date-kst";
import { TextbooksTable } from "@/app/(shell)/billing/_components/textbooks-table";
import styles from "@/app/(shell)/billing/_components/textbooks-panel.module.css";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";

const KRW = new Intl.NumberFormat("ko-KR");

// 하단 체크 버튼(등록·납부·주문)과 라벨·순서 일치. 각 항목 = "그 단계가 아직 안 된 것", 완료 = 3체크 전부.
const FILTERS: {
  key: string;
  label: string;
  title: string;
  count: (s: TextbookStats) => number;
}[] = [
  {
    key: "reg",
    label: "등록 안 됨",
    title: "아직 등록 안 된 건",
    count: (s) => s.needReg,
  },
  {
    key: "pay",
    label: "납부 안 됨",
    title: "아직 납부 안 된 건",
    count: (s) => s.needPay,
  },
  {
    key: "order",
    label: "주문 안 됨",
    title: "아직 주문 안 된 건",
    count: (s) => s.needOrder,
  },
  {
    key: "done",
    label: "완료",
    title: "등록·납부·주문 모두 완료",
    count: (s) => s.done,
  },
];

type Sp = { status?: string; q?: string; page?: string };

export function TextbooksPanel({ sp, data }: { sp: Sp; data: TextbooksPanelData }) {
  const status = sp.status ?? "all";
  const q = sp.q ?? "";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  // settings·user는 다이얼로그 실시간 미리보기(요청서 카드: 학원명·로고·계좌)용. 둘 다 React 캐시라 저비용.
  const [{ rows, total }, stats, students, catalog, settings] = [data.page, data.stats, data.students, data.catalog, data.settings];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const academyName = settings.profile.name || NEUTRAL_ACADEMY_NAME;
  const logoUrl = settings.profile.logoUrl; // 학원 로고 = 파일 저장소(복사본 밖) — 자료가 비워서 보낸다
  const account = accountForTarget(settings.billing, "textbook");
  const todayKst = kstToday(); // 신청일 경과 라벨 계산 기준(서버 KST) — 클라에 주입.

  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "textbooks" });
    if (status !== "all") p.set("status", status);
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* KPI — 공용 BigStat(옛 로컬 Kpi 카드는 링 위에 border를 겹쳐 선이 이중이었다, v5 ④). */}
      <StatStrip label="전체 교재 신청 현황" className={styles.summary}>
        <BigStat
          label="전체 신청"
          value={stats.total}
          unit="건"
          tone="blue"
          icon={<BookText size={16} strokeWidth={1.8} />}
        />
        <BigStat
          label="등록 대기"
          value={stats.needReg}
          unit="건"
          tone="amber"
          icon={<Clock size={16} strokeWidth={1.8} />}
        />
        <BigStat
          label="납부 대기"
          value={stats.needPay}
          unit="건"
          tone="amber"
          icon={<Clock size={16} strokeWidth={1.8} />}
        />
        <BigStat
          label="주문 대기"
          value={stats.needOrder}
          unit="건"
          tone="amber"
          icon={<Clock size={16} strokeWidth={1.8} />}
        />
        <BigStat
          label="미납 합계"
          value={KRW.format(stats.unpaidAmount)}
          unit="원"
          tone="danger"
          icon={<CircleDollarSign size={16} strokeWidth={1.8} />}
        />
        <BigStat
          label="총 신청액"
          value={KRW.format(stats.totalAmount)}
          unit="원"
          tone="primary"
          icon={<Receipt size={16} strokeWidth={1.8} />}
        />
      </StatStrip>

      {/* 결과 줄 + 필터(지시서 §10): 옛 칩 5개(전체 N·등록 N·납부 N·주문 N·완료 N) + 상시 검색창 → `상태: 전체` 라벨 하나
          (항목 옆에 건수) + 검색 토글. 🔴 툴바 카드 껍데기 없음(원장 2026-09-01). */}
      <TextbooksTable
        toolbar={
          <>
            <p className="text-text-dim text-sm whitespace-nowrap">
              교재신청{" "}
              <span className="num text-foreground font-bold">{total}</span>건
              {q ? (
                <span className="ml-1.5">· &ldquo;{q}&rdquo; 검색</span>
              ) : null}
              {totalPages > 1 ? (
                <span className="num ml-1.5">
                  · {page}/{totalPages}
                </span>
              ) : null}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <FilterSelect
                paramName="status"
                value={status === "all" ? "" : status}
                options={FILTERS.map((f) => ({
                  value: f.key,
                  label: f.label,
                  hint: `${f.count(stats)}건`,
                }))}
                axisLabel="상태"
                ariaLabel="진행 상태 필터"
                className="w-auto"
                triggerClassName={TOOLBAR_SELECT}
              />
              <SearchToggle placeholder="교재명·학생" defaultValue={q} />
            </div>
          </>
        }
        rows={rows}
        students={students}
        catalog={catalog}
        academyName={academyName}
        logoUrl={logoUrl}
        account={account}
        todayKst={todayKst}
        emptyTitle={
          q || status !== "all"
            ? "조건에 맞는 교재신청이 없습니다. 위에서 검색·상태 필터를 바꿀 수 있습니다."
            : undefined
        }
      />
      <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
    </div>
  );
}
