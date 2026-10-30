// 2.0 화면 — 수납관리 · 강사 정산 면(teacher-settlement-face.tsx) — 2.0 서버 함수를 그대로(공용 러너).
//  · 게이트 = 2.0 canReadSalary()(급여 열람 — 원장 역할 · 학원 설정에서 지정한 사람 · 급여 기능 켜짐) · 편집 = canManageSalary()
//  · 첫 응답 = 게이트만(pending) → 화면이 payrollFull=1로 금액을 뒤에 받는다(billing-payroll-deferred.tsx)
//  · 자료 = payroll/server/tuition-view.ts getTeacherTuitionView(p)(급여명세서 수업료와 같은 함수) · class-salary-queries.ts getClassSalaryRows() ·
//    payslip-gate.ts canViewPayslipNow(user)
//  · 저장 = comp-actions.ts saveTeacherComp · class-salary-actions.ts saveClassSalary(2.0 함수 그대로 — 게이트도 2.0 코드가 다시 본다)
// 🔴 급여(PII): 2.0 canReadSalary가 거짓이면 **조회 자체를 하지 않는다**(view · 반별 급여를 싣지 않는다). 화면 문구는 2.0 그대로('열람 권한이 없습니다').
//    시험 출력에 금액·비율을 찍지 않는다.
import { runV2Server } from './v2-server-runner.mjs';
import { v2ServerActions } from './v2-billing-sessions.mjs';

const P = 'features/payroll/server/';
export async function readPayrollFace(t, R, viewer, sp) {
  const p = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : R.calc.currentPeriod();
  const call = steps => runV2Server({ steps, actorId: viewer.id, tenantId: t, mode: 'read' });
  const { results: [read, manage] } = await call([
    { module: `${P}salary-access.ts`, fn: 'canReadSalary', args: [] }, { module: `${P}salary-access.ts`, fn: 'canManageSalary', args: [] },
  ]);
  if (read.value !== true) return { period: p, canRead: false, canEdit: false, view: null, classRows: null, canPayslip: false };
  // 강사마다 출석부를 조립해 오래 걸린다 — 첫 응답은 게이트만 내려 화면을 먼저 그리고, 금액은 화면이 payrollFull=1로 뒤에 받는다(첫 화면을 막지 않는다).
  if (sp.payrollFull !== '1') return { period: p, canRead: true, canEdit: manage.value === true, view: null, classRows: null, canPayslip: false, pending: true };
  const { results: [view, classRows, payslip] } = await call([
    { module: `${P}tuition-view.ts`, fn: 'getTeacherTuitionView', args: [p] },
    { module: `${P}class-salary-queries.ts`, fn: 'getClassSalaryRows', args: [] },
    { module: `${P}payslip-gate.ts`, fn: 'canViewPayslipNow', args: [{ $currentUser: true }] },
  ]);
  return { period: p, canRead: true, canEdit: manage.value === true, view: view.value, classRows: classRows.value, canPayslip: payslip.value === true };
}

export const payrollActions = v2ServerActions({ [`${P}comp-actions.ts`]: ['saveTeacherComp'], [`${P}class-salary-actions.ts`]: ['saveClassSalary'] });
