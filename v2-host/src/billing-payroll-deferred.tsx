// 강사 정산은 강사마다 출석부를 조립해 오래 걸린다 — 첫 화면을 막지 않게 면 탭·달 이동을 먼저 그리고 금액은 뒤에 받아 채운다.
// 계산은 서버의 2.0 함수 그대로(v2-billing-payroll.mjs). 저장 뒤 다시 읽는 동안에는 보던 표를 그대로 둔다.
import { useEffect, useState } from "react";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { hostActor } from "../shims/server-action";
import { TeacherSettlementFace } from "./billing-teacher-settlement-face";
import type { PayrollFaceData } from "./billing-types";

export function PayrollFaceDeferred({ period, data }: { period?: string; data: PayrollFaceData }) {
  const [full, setFull] = useState<{ actor: string | null; data: PayrollFaceData } | null>(null);
  const [failed, setFailed] = useState<PayrollFaceData | null>(null);
  useEffect(() => {
    if (!data.pending) return;
    let live = true;
    const q = new URLSearchParams({ tab: "payroll", period: data.period, payrollFull: "1" });
    const asked = hostActor();
    if (asked) q.set("viewer", asked);
    fetch(`/api/v2/billing?${q}`, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body?.payroll?.view) throw new Error("load");
        return body.payroll as PayrollFaceData;
      })
      .then((next) => { if (live) setFull({ actor: asked, data: next }); })
      .catch(() => { if (live) setFailed(data); });
    return () => { live = false; };
  }, [data]);

  const shown = !data.pending ? data : full?.data.period === data.period && full.actor === hostActor() ? full.data : null;
  if (shown) return <TeacherSettlementFace period={period} data={shown} />;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={data.period} hrefFor={(per) => `/billing?tab=payroll&period=${per}`} ariaLabel="정산 월 선택" />
      </div>
      {failed === data ? (
        <div role="alert" className="border-line text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
          강사 정산을 불러오지 못했습니다. 달을 다시 골라 주세요.
        </div>
      ) : (
        <div role="status" className="space-y-3">
          <p className="text-text-dim px-1 text-sm">강사별 수업료를 계산하는 중입니다.</p>
          <Skeleton className="h-11 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}
