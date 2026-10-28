// 2.0 화면 — 월별 출석부의 금액 열(청구액 · 등록 차수 · 차이확인 · 단가 · 실수업액 · 실급여)과 원장 전용 합계 — 2.0 서버 함수를 그대로(공용 러너).
// 2.0 `app/(shell)/attendance/page.tsx`가 표 옆에서 부르던 것과 같은 함수 · 같은 인자 · 같은 게이트:
//  · getAttendanceClassBilledAmounts(담당 반 명단 · 강사 축) + 보강 반 명단(allowClassIds = 서버가 스스로 푼 보강 반 id 하나) → mergeAttendanceClassBilling
//  · canShowAttendanceActualAmount(그 표의 강사) · getAttendanceSalaryRates(강사 전체 보기의 강사 · 선생님 × 달 '합계 및 실급여 보여주기' 스위치)
//  · getTeacherMoney — 원장 역할 + 강사 전체 보기 + 급여 기능 켜짐일 때만(2.0 `user.systemRole === "master"`)
// 🔴 급여성 값(비율 · 실급여 · 정산액)은 2.0 함수가 돌려준 것만 싣는다 — 게이트를 못 지나면 2.0 함수가 null·false를 낸다(값을 화면에서 감추는 게 아니다).
// 🔴 '실급여는 청구액을 넘지 않는다'는 2.0 표 부품(matrix-row → salaryBilledCap · actualLessonSalary)이 그린다 — 호스트가 그 부품을 그대로 쓴다.
// 저장 = 2.0 salary-rates-actions.ts(saveAttendanceSalaryRates · saveAttendanceSalaryVisible) 그대로 — 러너 write(동작 하나 = 트랜잭션 하나).
import { runV2Server, V2ServerError } from './v2-server-runner.mjs';
import { pureFrom } from './v2-billing-pure.mjs';
import { V2Error } from './v2-screens.mjs';

const CB = 'features/attendance/server/class-billing.ts';
const SALARY_ACTIONS = 'features/attendance/server/salary-rates-actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let rulesPromise = null;
const loadMoneyRules = importV2 => (rulesPromise ??= Promise.all([
  importV2('features/attendance/class-billing.ts'), importV2('features/attendance/enrollment-span.ts'), importV2('features/attendance/session-units.ts'),
  pureFrom(CB, ['mergeAttendanceClassBilling', 'empty', 'STATE_RANK']),
]).then(([pure, span, units, merge]) => ({ pure, span, units, merge })).catch(e => { rulesPromise = null; throw e; }));

/** 금액 열이 없는 화면(허브 · 빈 표)의 모양 — 2.0이 넘기는 기본값과 같다. */
export const NO_MONEY = Object.freeze({
  classBilledAmounts: { billed: {}, carryMarks: {}, confirmedSessions: {}, confirmedPrices: {}, priceConfirmed: [] },
  noInvoiceRows: [], showActualAmount: false, salaryConfig: null, salaryAxisNotice: false, money: null, moneyNote: null, settlementNote: null, salaryClasses: [],
});

/**
 * 2.0 page.tsx 금액 조각을 같은 순서 · 같은 조건으로. 입력은 3.0 출석부 서버가 이미 고른 값(보기 · 강사 · 반 · 명단 · 창).
 * 보는 사람(viewer)의 신분으로 러너가 2.0 함수를 돌린다 — 2.0의 getCurrentUser = 그 사람.
 */
export async function readAttendanceMoney(x) {
  const { t, importV2, R, viewer, month, mode, effectiveTeacher, effectiveClassId, classesForSubject, teacherClasses, teacherMatrices, laterClasses, laterMatrices,
    matrix, sinceByClass, pool, poolMatrix, payrollOn, operations } = x;
  if (!viewer) return NO_MONEY;
  const M = await loadMoneyRules(importV2);
  const homeBillingRoster = mode === 'teacher'
    ? teacherClasses.map((c, i) => ({ classId: c.id, studentIds: teacherMatrices[i].students.map(s => s.id) }))
    : effectiveClassId ? [{ classId: effectiveClassId, studentIds: matrix.students.map(s => s.id) }] : [];
  // 강사 축 — 관리자 보기의 반별 보기는 classScopeTeacher = null(2.0 그대로 · 강사 계정만 렌즈가 있다).
  const teacherScope = mode === 'teacher' && effectiveTeacher ? {
    teacherId: effectiveTeacher,
    classIds: classesForSubject.filter(c => R.suffix.attendanceUnitSuffix(c.subject, operations.subjects) === 'U').map(c => c.id),
    holidays: Object.keys(R.cal.buildHolidayMap(operations.holidays)),
    homeroomSinceByClass: Object.fromEntries(sinceByClass),
  } : undefined;
  const poolRoster = pool && poolMatrix && poolMatrix.students.length > 0 ? { classId: pool.id, studentIds: poolMatrix.students.map(s => s.id) } : null;
  const actualTeacher = mode === 'teacher' ? effectiveTeacher : classesForSubject.find(c => c.id === effectiveClassId)?.teacherId ?? null;
  // 티어 정산 — 원장 + 강사 전체 보기 + 급여 켜짐(2.0 그대로). 반 범위 = 지금 담임인 반 전부(표에서 뺀 '그 달 뒤에 담임이 된 반' 포함 · 원래 순서).
  const moneyOn = mode === 'teacher' && viewer.role === 'master' && !!effectiveTeacher && payrollOn;
  const matrixByClass = new Map([...teacherClasses.map((c, i) => [c.id, teacherMatrices[i]]), ...laterClasses.flatMap((c, i) => (laterMatrices[i] ? [[c.id, laterMatrices[i]]] : []))]);
  const moneyClasses = effectiveTeacher ? x.taughtClasses.filter(c => c.teacherId === effectiveTeacher && matrixByClass.has(c.id)) : [];
  const steps = [
    { module: CB, fn: 'getAttendanceClassBilledAmounts', args: [month, homeBillingRoster, teacherScope ? { teacherScope } : {}] },
    { module: 'features/attendance/server/actual-amount-access.ts', fn: 'canShowAttendanceActualAmount', args: [actualTeacher] },
    { module: 'features/attendance/server/salary-rates.ts', fn: 'getAttendanceSalaryRates', args: [mode === 'teacher' ? effectiveTeacher : null, month] },
    ...(poolRoster ? [{ module: CB, fn: 'getAttendanceClassBilledAmounts', args: [month, [poolRoster], { allowClassIds: [pool.id] }] }] : []),
    ...(moneyOn ? [{ module: 'features/attendance/server/teacher-money.ts', fn: 'getTeacherMoney', args: [month, effectiveTeacher,
      [...new Set(moneyClasses.flatMap(c => matrixByClass.get(c.id).students.map(s => s.id)))], moneyClasses.map(c => c.id)] }] : []),
  ];
  const { results } = await runV2Server({ steps, actorId: viewer.id, tenantId: t, mode: 'read' });
  const [homeBilling, showActualAmountRaw, salaryConfigRaw] = results.map(r => r.value);
  const poolBilling = poolRoster ? results[3].value : null, money = moneyOn ? results.at(-1).value : null;

  const showActualAmount = payrollOn && !!showActualAmountRaw;
  const salaryConfigAny = payrollOn ? salaryConfigRaw ?? null : null;
  // 반별 보기 + 세션 축 = 실급여를 싣지 않는다(2.0 classAxisIsMonth — 세션 창의 시수면 명세서와 다른 숫자가 선다).
  const span = M.span.monthBounds(month);
  const classAxisIsMonth = matrix.window.start === span.first && matrix.window.end === span.last;
  const salaryAxisOff = mode === 'class' && !classAxisIsMonth;
  const salaryConfig = salaryAxisOff ? null : salaryConfigAny;
  const billingRoster = poolRoster ? [...homeBillingRoster, poolRoster] : homeBillingRoster;
  const classBilledAmounts = poolBilling ? M.merge.mergeAttendanceClassBilling(homeBilling, poolBilling) : homeBilling;
  const noInvoiceRows = M.pure.attendanceNoInvoiceRows(billingRoster, classBilledAmounts.invoiceStateByStudent);
  // 합계 줄 안내(2.0 moneyNote · settlementNote 그대로).
  const Tf = (k, v) => R.i18n.sheetTf('ko', k, v);
  const homeroomCount = effectiveTeacher ? teacherClasses.filter(c => c.teacherId === effectiveTeacher).length : 0;
  const slotOnlyCount = teacherClasses.length - homeroomCount;
  const shownIds = new Set(teacherClasses.map(c => c.id)), laterIds = new Set(laterClasses.map(c => c.id));
  const unitsByMoneyClass = money?.tierSettlement?.status === 'ready' ? Object.entries(money.tierSettlement.unitsByClass ?? {}) : [];
  const outsideUnits = unitsByMoneyClass.reduce((s, [cid, u]) => (shownIds.has(cid) || laterIds.has(cid) ? s : s + u), 0);
  const laterUnits = unitsByMoneyClass.reduce((s, [cid, u]) => (laterIds.has(cid) ? s + u : s), 0);
  const moneyNote = money && slotOnlyCount > 0 ? Tf('att.moneyNote', { n: moneyClasses.length, m: slotOnlyCount }) : null;
  const settlementNote = [
    money && outsideUnits > 0 ? Tf('att.moneyNote.substitute', { units: M.units.formatSessionUnits(outsideUnits) }) : null,
    money && laterUnits > 0 ? Tf('att.moneyNote.later', { n: laterClasses.length, units: M.units.formatSessionUnits(laterUnits) }) : null,
  ].filter(Boolean).join(' · ') || null;
  return {
    // 표 부품이 읽는 칸만(invoiceStateByStudent · degraded는 위 판정 재료 — 2.0도 표에 넘기지 않는다).
    classBilledAmounts: { billed: classBilledAmounts.billed, carryMarks: classBilledAmounts.carryMarks, confirmedSessions: classBilledAmounts.confirmedSessions,
      confirmedPrices: classBilledAmounts.confirmedPrices, priceConfirmed: classBilledAmounts.priceConfirmed },
    // Map(줄 → 'none'|'void')은 JSON으로 못 가서 항목 배열로 — 호스트가 Map으로 되돌린다.
    noInvoiceRows: [...noInvoiceRows], showActualAmount, salaryConfig, salaryAxisNotice: salaryAxisOff && !!salaryConfigAny?.visible && showActualAmount, money, moneyNote, settlementNote,
    // 비율 설정 창의 반 목록(2.0 teacherClasses.map(c => ({ id, name: c.className })) — 원래 반 이름).
    salaryClasses: salaryConfig?.manage ? teacherClasses.map(c => ({ id: c.id, name: c.className })) : [],
  };
}

const refused = e => (e instanceof V2ServerError
  ? e.code === 'outbound_blocked' ? new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.')
    : e.code === 'unsupported' ? new V2Error(409, 'not_supported', '연습 화면에서는 아직 지원하지 않는 저장입니다.')
      : new V2Error(500, 'write_failed', '저장하지 못했습니다. 바뀐 것은 없습니다.')
  : e);
/**
 * 실급여 저장 둘 = 2.0 함수 그대로(러너 write). actorOk(sql, t, importV2, actor) = 출석부의 저장하는 사람인지(아니면 2.0 '로그인 없음' 자리 = null).
 * 권한(원장 역할 + 출석부 급여 설정 권한)은 2.0 함수 안의 게이트가 본다.
 */
export const attendanceMoneyActions = actorOk => Object.fromEntries(['saveAttendanceSalaryRates', 'saveAttendanceSalaryVisible'].map(name => [name, {
  validate: raw => {
    if (!raw || typeof raw !== 'object' || raw.module !== SALARY_ACTIONS || !Array.isArray(raw.args) || raw.args.length !== 1) throw new V2Error(400, 'bad_request', '요청 형식이 맞지 않습니다.');
    const [input] = raw.args;
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 20000) throw new V2Error(400, 'bad_request', '요청 형식이 맞지 않습니다.');
    if (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) throw new V2Error(400, 'bad_request', '요청 형식이 맞지 않습니다.');
    return { actor: raw.actor ?? null, args: [input] };
  },
  run: async ({ sql, body, tenantId: t, importV2 }) => {
    try {
      const actorId = (await actorOk(sql, t, importV2, body.actor)) ? body.actor : null;
      const { results: [r] } = await runV2Server({ steps: [{ module: SALARY_ACTIONS, fn: name, args: body.args }], actorId, tenantId: t, mode: 'write' });
      return r.value ?? null;
    } catch (e) { throw refused(e); }
  },
}]));
