// 2.0 calculator-panel.tsx(app/(shell)/billing/_components/calculator-panel.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본, v2-billing-calculator.mjs)이
// 2.0 함수와 같은 모양으로 내고 여기서는 본문을 **글자 그대로** 옮겼다(billing-calculator.swaps.json — 조회 자리 · 상대 경로 import만).
import Link from "next/link";
import { CalendarOff, Settings2 } from "@/components/icons/aywa-icon-compat";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { FilterSelect } from "@/components/filter-select";
import { PeriodNav } from "@/components/period-nav";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { withEieMonthlyTuition } from "@/features/billing/session-pricing";
import { currentPeriod } from "@/features/billing/calc";
import { koreanHolidaysForYear } from "@/features/billing/holidays-data";
import { isGenericTenant } from "@/features/owner/preset";
import { isModuleEnabled } from "@/lib/modules";
import { accountForTarget } from "@/features/owner/settings-types";
import { TuitionCalculator } from "@/app/(shell)/billing/_components/tuition-calculator";
import { TuitionPricesPanel } from "./billing-tuition-prices-panel";
import { CatalogPanel } from "./billing-catalog-panel";
import { SavedQuotesPanel } from "./billing-saved-quotes-panel";
import type { CalculatorFaceData } from "./billing-types";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";

type Sp = Record<string, string | undefined>;
type CalcSub = "calculator" | "prices" | "catalog" | "holidays" | "quotes";

function resolveSub(sp: Sp): CalcSub {
  return sp.csub === "prices"
    ? "prices"
    : sp.csub === "catalog"
      ? "catalog"
      : sp.csub === "holidays"
        ? "holidays"
        : sp.csub === "quotes"
          ? "quotes"
          : "calculator";
}

const SUB_FACES: Face[] = [
  { key: "calculator", label: "계산기", href: "/billing?tab=calculator" },
  { key: "prices", label: "수강료 단가", href: "/billing?tab=calculator&csub=prices" },
  { key: "catalog", label: "교재 단가표", href: "/billing?tab=calculator&csub=catalog" },
  { key: "holidays", label: "공휴일", href: "/billing?tab=calculator&csub=holidays" },
  { key: "quotes", label: "저장된 청구서", href: "/billing?tab=calculator&csub=quotes" },
];

// 수강료 계산기 면 — ijw "계산기 모드 ↔ 설정"을 서브탭으로 이식. 계산기는 신입생 상담 견적 도구(다과목·
// 교재/할인·환불규정 안내문). 교재 단가표는 교재 면과 같은 CatalogPanel 재사용. 저장은 tuition_quotes(견적).
export function CalculatorPanel({ sp, data }: { sp: Sp; data: CalculatorFaceData }) {
  const sub = resolveSub(sp);

  return (
    <div className="space-y-4 print:space-y-0">
      <div className="print:hidden">
        <FaceTabs faces={SUB_FACES} active={sub} level="secondary" ariaLabel="수강료 계산기 면 전환" />
      </div>
      {sub === "prices" ? (
        <TuitionPricesPanel sp={sp} data={data.prices!} />
      ) : sub === "catalog" ? (
        <CatalogPanel sp={sp} base={{ tab: "calculator", csub: "catalog" }} data={data.catalog!} />
      ) : sub === "holidays" ? (
        <HolidayPanel sp={sp} settings={data.settings} />
      ) : sub === "quotes" ? (
        <SavedQuotesPanel sp={sp} data={data.quotes!} />
      ) : (
        <CalculatorTab settings={data.settings} data={data.calculator!} />
      )}
    </div>
  );
}

function CalculatorTab({ settings, data }: { settings: CalculatorFaceData["settings"]; data: NonNullable<CalculatorFaceData["calculator"]> }) {
  const { catalog, textbooks, initial } = data; // 서버가 2.0 조회 셋(사용 중 단가 · 교재 단가표 · 고른 견적)과 같은 모양으로
  const logoSrc = settings.profile.logoUrl; // 학원 로고 = 파일 저장소(복사본 밖) — 비워서 온다
  return (
    <TuitionCalculator
      academyName={settings.profile.name || NEUTRAL_ACADEMY_NAME}
      logoSrc={logoSrc}
      defaultPeriod={currentPeriod()}
      defaultAccount={accountForTarget(settings.billing, "quote")}
      holidays={settings.operations.holidays.map((h) => h.date)}
      // EiE 월정액 항목은 EiE 구분을 쓰는 학원만(새 학원 기본은 꺼짐). 침산은 종전과 같다.
      catalog={
        isModuleEnabled(settings.modules.disabled, "eie")
          ? withEieMonthlyTuition(catalog, settings.billing.eieMonthlyPrice)
          : catalog
      }
      textbooks={textbooks}
      initial={initial ?? undefined}
      showHouseRules={!isGenericTenant(settings)}
    />
  );
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function dowOf(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? "" : DOW[new Date(t).getUTCDay()];
}
const HOLIDAY_MIN_YEAR = 2024;
const HOLIDAY_MAX_YEAR = 2030;
const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // 0 = 전체

// 공휴일 면 — 학원 휴원일은 학원설정(/owner)에서 편집(테넌트 설정=master 전용). 여기선 계산에 반영되는
// 휴원일 + 대한민국 공휴일(ijw 이식, 음력·대체 포함)을 읽기 전용으로 보여준다(소비처는 계산기의 countSessions).
// 연도 ◀▶ 이동 + 월 선택(URL ?hy=연도&hm=월).
function HolidayPanel({ sp, settings }: { sp: Sp; settings: CalculatorFaceData["settings"] }) {
  const thisYear = Number(currentPeriod().slice(0, 4)) || 2026;
  const yearRaw = Number(sp.hy) || thisYear;
  const year = Math.min(HOLIDAY_MAX_YEAR, Math.max(HOLIDAY_MIN_YEAR, yearRaw));
  const month = Math.min(12, Math.max(0, Number(sp.hm) || 0));
  const tenantHolidays = [...settings.operations.holidays].sort((a, b) => a.date.localeCompare(b.date));
  const all = koreanHolidaysForYear(year);
  const national = month >= 1 ? all.filter((h) => Number(h.date.slice(5, 7)) === month) : all;

  const hrefFor = (y: number, m: number) => {
    const p = new URLSearchParams({ tab: "calculator", csub: "holidays" });
    if (y !== thisYear) p.set("hy", String(y));
    if (m >= 1) p.set("hm", String(m));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="bg-card shadow-card space-y-3 rounded-2xl p-5">
        <header className="flex items-center justify-between">
          <h2 className="text-foreground inline-flex items-center gap-1.5 text-base font-bold">
            <CalendarOff className="text-primary size-4" />
            학원 지정 휴원일
          </h2>
          {/* 텍스트 Secondary(control-scale 치수) — 옛 py-1 text-xs 테두리 버튼. */}
          <Link
            href="/owner?tab=operations"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft inline-flex items-center gap-1 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
          >
            <Settings2 className="size-[1em]" />
            학원설정에서 편집
          </Link>
        </header>
        <p className="text-text-faint text-xs">
          계산기에서 차시를 셀 때 <b>항상 제외</b>됩니다. 학원 휴무·시험기간 등 학원 단위 휴원일은
          학원설정 › 운영에서 관리합니다.
        </p>
        {tenantHolidays.length === 0 ? (
          <p className="text-text-dim border-line rounded-md border border-dashed px-3 py-6 text-center text-xs">
            지정된 휴원일이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tenantHolidays.map((h) => (
              <li key={h.date} className="border-line bg-bg-soft rounded-full border px-2 py-1 text-xs">
                {h.name ? <span className="text-foreground font-medium">{h.name} </span> : null}
                <span className="num text-text-dim">{h.date} ({dowOf(h.date)})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card shadow-card space-y-3 rounded-2xl p-5">
        {/* 연도 이동 = 앱 전역 PeriodNav(옛 size-7 알약 화살표) · 월 = `월: 전체` 라벨(옛 알약 칩 13개 — §10 칩 줄 금지).
            경계 연도(2024·2030)에선 그쪽 화살표를 잠근다(데이터가 그 밖엔 없다 — 옛 비활성 화살표 그대로). */}
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-foreground text-base font-bold">대한민국 공휴일</h2>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodNav
              label={`${year}년`}
              prevHref={hrefFor(Math.max(HOLIDAY_MIN_YEAR, year - 1), month)}
              nextHref={hrefFor(Math.min(HOLIDAY_MAX_YEAR, year + 1), month)}
              currentHref={hrefFor(thisYear, month)}
              relation={year === thisYear ? "current" : year < thisYear ? "past" : "future"}
              prevAriaLabel="이전 연도"
              nextAriaLabel="다음 연도"
              currentTitle="눌러서 올해로"
              prevDisabled={year <= HOLIDAY_MIN_YEAR}
              nextDisabled={year >= HOLIDAY_MAX_YEAR}
              labelWidth={72}
            />
            <FilterSelect
              paramName="hm"
              value={month >= 1 ? String(month) : ""}
              options={MONTHS.filter((m) => m >= 1).map((m) => ({ value: String(m), label: `${m}월` }))}
              axisLabel="월"
              ariaLabel="공휴일 월 선택"
              className="w-auto"
              triggerClassName={TOOLBAR_SELECT}
            />
          </div>
        </header>

        <p className="text-text-faint text-xs">
          계산기의 <b>“대한민국 공휴일 제외”</b> 체크 시 차시에서 빠집니다. 음력(설·추석)·대체공휴일·
          부처님오신날 포함(ijw 공휴일 데이터 이식, 2024–2030). {month >= 1 ? `${month}월` : "연간"} {national.length}일.
        </p>

        {national.length === 0 ? (
          <p className="text-text-dim border-line rounded-md border border-dashed px-3 py-6 text-center text-xs">
            {month >= 1 ? `${month}월 공휴일이 없습니다.` : "공휴일 데이터가 없습니다."}
          </p>
        ) : (
          <ul className="divide-line divide-y">
            {national.map((h) => (
              <li key={h.date} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-foreground">{h.name}</span>
                <span className="text-text-dim num text-xs">
                  {h.date} ({dowOf(h.date)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
