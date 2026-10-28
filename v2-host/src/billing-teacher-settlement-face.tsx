// 2.0 teacher-settlement-face.tsx(app/(shell)/billing/_components/) — 서버 컴포넌트라 그대로 불러올 수 없어서, 게이트·조회는 /api/v2/billing(Docker 복사본)이
// **2.0 서버 함수를 그대로** 돌려(v2-billing-payroll.mjs · 공용 러너) 내고 여기서는 본문을 글자 그대로 옮겼다(billing-payroll.swaps.json).
import { currentPeriod } from "@/features/billing/calc";
import { ClassSalaryRowForm } from "@/app/(shell)/billing/_components/class-salary-row";
import type { PayrollFaceData } from "./billing-types";
import { NET_MULTIPLIER, PLATFORM_FEE_RATE } from "@/features/payroll/settlement";
import { Pill } from "@/components/atoms/pill";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { TeacherCompEditor } from "@/app/(shell)/billing/_components/teacher-comp-editor";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";
import { FaceNote } from "@/app/(shell)/billing/_components/face-note";

const fmtWon = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const fmtUnits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * 강사 정산 면 — **원장 전용, 읽기전용**. 🔴 금액 = **급여명세서의 수업료와 같은 함수**(`computeTeacherTuition`)
 * (원장 2026-09-28 *"급여는 출석부에서 맞춰놓은것을 기준으로"* — 예전 면은 청구 분배 스냅샷(splits) × 수수료 × 비율이라
 * 명세서와 다른 금액을 말했다). 출석부 하단 정산액과 같은 조립(시수 × 회차 확정 단가 ?? 티어 단가 × 0.911 × 배분율).
 * 발행된 명세서는 발행 금액 그대로 · 블로그 패널티는 그 달 명세서 값.
 * 🔑 **프리랜서 줄은 2026-10-06부터 그 강사 출석부의 실급여 합계**다(명세서와 같은 `computeSheetTuition` — 조립은 `getTeacherTuitionView`).
 *    위 티어 산식은 그 밖의 강사에게만 해당한다. 줄마다 '출석부 실급여 기준'과 발행 전 확인 사항이 비고에 선다.
 */
export function TeacherSettlementFace({ period, data }: { period?: string; data: PayrollFaceData }) {
  // 급여 = 원장·총괄 전용 PII(감사 D6). 그 밖에는 화면 자체를 막는다.
  if (!data.canRead) {
    return (
      <div className="border-line text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
        강사 정산(급여) 열람 권한이 없습니다.
      </div>
    );
  }

  const canEdit = data.canEdit;
  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  // 서버가 2.0 getTeacherTuitionView(p) · getClassSalaryRows() · canViewPayslipNow(user)를 그대로 돌려 낸 값(급여 열람 게이트를 지난 사람만).
  const [view, classRows, canPayslip] = [data.view!, data.classRows!, data.canPayslip];
  const hrefFor = (per: string) => `/billing?tab=payroll&period=${per}`;

  return (
    <fieldset disabled={!canEdit} className="min-w-0 space-y-4 border-0 p-0">
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav · 집계는 값으로 오른쪽에. */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={p} hrefFor={hrefFor} ariaLabel="정산 월 선택" />
        {view.rows.length > 0 ? (
          <div className="text-text-dim ml-auto flex flex-wrap items-center gap-2 text-sm">
            <span>
              산정 <b className="num text-foreground">{view.computedCount}</b>명 · 수업료 합{" "}
              <b className="num text-foreground">{fmtWon(view.total)}</b>
            </span>
            {view.pendingCount > 0 ? <Pill color="amber">산정 불가 {view.pendingCount}</Pill> : null}
          </div>
        ) : null}
      </div>

      <FaceNote>
        <b>급여명세서의 수업료와 같은 계산</b>입니다(출석부 하단 정산액과 같은 조립). 담임인 활성 반의 그 달 출결 시수 ×
        단가(수학 반은 회차 확정 단가, 없으면 수강 티어) × {NET_MULTIPLIER}(결제 수수료 {(PLATFORM_FEE_RATE * 100).toFixed(1)}% 차감)
        × 배분율로 학생마다 계산해 더합니다. 블로그 패널티는 그 달 명세서에 적힌 값을 반영하고, <b>발행된 명세서는 발행 금액 그대로</b>
        보여 줍니다. 인센티브·기타공제는 명세서에서 더하고 뺍니다.
      </FaceNote>
      {/* ⚠️ 배분율은 users에 **현재 값 한 벌**만 있다 — 지난 달을 열면 그때 비율이 아니라 지금 비율로 계산된다(발행된 명세서는 제외). */}
      <p className="text-amber px-1 text-sm leading-relaxed">
        배분율은 <b>현재 설정값</b>으로 계산합니다. 명세서를 발행하지 않은 지난 달을 열면 그때 비율이 아니라 지금 비율이 쓰이고,
        반 담임도 지금 기준이라 실제 지급액과 다를 수 있습니다.
      </p>

      {view.rows.length === 0 ? (
        <section className="rounded-lg border border-line p-4">
          <h2 className="text-base font-bold">정산할 강사가 없습니다</h2>
          <p className="mt-1 text-sm">담임으로 배정된 활성 반이 있는 강사가 여기에 나옵니다.</p>
        </section>
      ) : (
        <DragScrollArea className="border-line rounded-2xl border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-line text-text-dim border-b text-sm [&_th]:font-bold">
                <th className="px-3 py-2 text-left">강사</th>
                <th className="px-3 py-2 text-right">담임 반</th>
                <th className="px-3 py-2 text-right">시수</th>
                <th className="px-3 py-2 text-right">수업료</th>
                <th className="px-3 py-2 text-left">확인할 것</th>
                <th className="px-3 py-2 text-left">급여 방식</th>
                <th className="px-3 py-2 text-left">명세서</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.teacherId} className="border-line/60 border-b last:border-0">
                  <td className="text-foreground px-3 py-2">{r.teacherName}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">{r.classCount}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">{fmtUnits(r.unitsTotal)}</td>
                  <td className="num px-3 py-2 text-right font-bold">
                    {r.tuition === null ? (
                      <span className="text-amber-700 text-xs font-normal">산정 불가</span>
                    ) : (
                      <span className="text-foreground">{fmtWon(r.tuition)}</span>
                    )}
                  </td>
                  <td className="text-text-dim px-3 py-2 text-xs">{r.notes.length ? r.notes.join(" · ") : "—"}</td>
                  <td className="px-3 py-2">
                    <TeacherCompEditor
                      userId={r.teacherId}
                      salaryType={r.salaryType}
                      commissionRate={r.commissionRate}
                      groupRates={r.groupRates}
                      monthlyBase={r.monthlyBase}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {canPayslip ? (
                      <PrintWindowButton
                        id={`print/payslip/${r.teacherId}/${p}`}
                        href={`/payroll/${r.teacherId}/payslip?period=${p}`}
                        title={`${r.teacherName} 급여명세서 ${p}`}
                        variant="ghost"
                      >
                        {r.issued ? "발행본 보기" : "명세서 보기"}
                      </PrintWindowButton>
                    ) : (
                      <span className="text-text-faint text-xs">{r.issued ? "발행됨" : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-line bg-bg-soft/50 border-t text-xs">
                <td className="text-text-dim px-3 py-2" colSpan={3}>
                  수업료 합계 (산정 불가 제외)
                </td>
                <td className="num px-3 py-2 text-right font-bold">{fmtWon(view.total)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </DragScrollArea>
      )}

      {/* 반별 과정·배분율 — 원장 전용 설정. splits가 없어도 미리 지정할 수 있게 활성 반 전체를 보여준다.
          정렬은 '지정이 필요한 것부터'(미분류 → 반 이름). */}
      <details className="border-line rounded-2xl border">
        <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-bold">
          반별 과정·배분율 설정
          <span className="text-text-faint ml-2 text-xs font-normal">
            {classRows.filter((c) => !c.manualGroup && !c.autoGroup).length}개 반이 미분류 · 총 {classRows.length}개 반
          </span>
        </summary>
        <p className="text-text-dim px-4 pb-2 text-xs leading-relaxed">
          비율은 <b>과정별 → 강사 기본</b> 순으로 정합니다(명세서와 같은 규칙). 과정은 대부분 학생의 <b>단가(티어)</b>가 정하고,
          여기서 지정한 반 과정은 회차 확정 단가가 티어와 다른 줄에만 쓰입니다. 반 과정은 반 이름으로 자동 판정하며
          (<code className="text-xs">초등M…</code>·<code className="text-xs">수능</code>·
          <code className="text-xs">특강</code>), 이름에 근거가 없는 반(<code className="text-xs">JP1</code> 등)은
          <b> 추정하지 않고 미분류</b>로 두니 직접 지정해 주세요. 적용 요일을 고르면 그 요일 수업분만 정산에 넣습니다.
        </p>
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-bg-soft/60 sticky top-0">
              <tr className="border-line text-text-dim border-b text-sm [&_th]:font-bold">
                <th className="px-3 py-2 text-left">반</th>
                <th className="px-3 py-2 text-left">담당</th>
                <th className="px-3 py-2 text-left">적용 과정</th>
                <th className="px-3 py-2 text-left">설정</th>
              </tr>
            </thead>
            <tbody>
              {classRows.map((c) => (
                <ClassSalaryRowForm key={c.classId} row={c} />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </fieldset>
  );
}
