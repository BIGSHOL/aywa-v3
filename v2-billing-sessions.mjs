// 2.0 화면 — 수납관리 · 회차 확정 면(session-terms-face.tsx · 청구 시수 대조 = session-verification-face.tsx).
// 조립·산식이 커서(조회 · 출석부 줄 집합 · 예정 · 지난 달 기준 · 금액 이월 · 배분 상태 · 자리 몫) SQL로 손 이식하지 않고
// **2.0 서버 함수를 그대로** 돌린다(공용 러너 v2-server-runner.mjs — 작업 스레드 · Supabase 흉내 · 보는 사람 신분 + RLS · 메인 결정 10-28 안 A).
//  · 확정·배분 = features/billing/session-terms/server/queries.ts getSessionTermsView(p, undefined, { lastMonth: true }) ·
//    features/attendance/server/seat-share-summary.ts loadSeatShareSummary(p)
//  · 청구 시수 대조 = verification-queries.ts getSessionVerificationView(p) · splits-queries.ts getTeacherSplitsStatus(p)
// 두 함수는 2.0 page처럼 한 요청(= 복사본 읽기 트랜잭션 하나)에서 부른다.
import { runV2Server, V2ServerError } from './v2-server-runner.mjs';
import { V2Error } from './v2-screens.mjs';
import { badRequest, loadBillingRules, readSettings, readBillingViewers } from './v2-billing-common.mjs';
import { UUID } from './v2-mcs-core.mjs';

// ── 저장 = 2.0 서버 함수 그대로(러너 write — 동작 하나 = 복사본 트랜잭션 하나 · 바깥 요청이 남으면 되돌림) ──────────────────────
// 2.0 함수 이름 = actions 이름(호스트 shim이 그 이름으로 POST). 인자 · 반환 · 표 · 칸 · 감사로그는 2.0 그대로(같은 함수라서).
const S = 'features/billing/session-terms/server/';
export const SESSION_WRITES = {
  [`${S}actions.ts`]: ['refreshPlannedTerms', 'confirmClassTerms', 'confirmSessionTerm', 'unconfirmSessionTerm', 'setSessionTermCarryover'],
  [`${S}class-unconfirm-actions.ts`]: ['unconfirmClassTerms'],
  [`${S}money-carryover-actions.ts`]: ['saveMoneyCarryover'],
  [`${S}monthly-sessions.ts`]: ['updateMonthlyTermSessions'],
  [`${S}receipt-allocation-actions.ts`]: ['mergeReceiptItems', 'saveReceiptAllocation', 'saveFreeReceiptAllocation'],
  [`${S}selected-confirm-actions.ts`]: ['confirmSelectedTerms'],
  [`${S}splits-actions.ts`]: ['saveTeacherSplits'],
  [`${S}delete-actions.ts`]: ['deleteSessionTerm'],
  [`${S}note-actions.ts`]: ['updateSessionTermNote'],
};
/** 배분 창 · 이월 선택지 · 지우기 미리보기 — 2.0은 서버 액션이지만 읽기라 화면 GET으로(보기 중 쓰기 0). */
export const SESSION_READS = {
  getReceiptAllocation: `${S}receipt-allocation-actions.ts`, getMoneyCarryoverOptions: `${S}money-carryover-actions.ts`, getSessionTermDeletePreview: `${S}delete-actions.ts`,
};
const ARG_LIMIT = 200 * 1024;
const refused = e => (e instanceof V2ServerError
  ? e.code === 'outbound_blocked' ? new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.')
    : e.code === 'unsupported' ? new V2Error(409, 'not_supported', '연습 화면에서는 아직 지원하지 않는 저장입니다.')
      : new V2Error(500, 'write_failed', '저장하지 못했습니다. 바뀐 것은 없습니다.')
  : e);
/** 보는 사람 = 수납관리를 볼 수 있는 재직 직원만(운영자 계정 제외) — 그 밖이면 2.0 '로그인 없음' 자리(getCurrentUser = null). */
async function viewerId(sql, t, importV2, actor) {
  if (!actor) return null;
  const R = await loadBillingRules(importV2), env = await readSettings(sql, t, R);
  return (await readBillingViewers(sql, t, R, env)).some(v => v.id === actor) ? actor : null;
}
/** 2.0 서버 함수 이름 = actions 이름 · 쓰기는 러너 write(동작 하나 = 트랜잭션 하나). writes = { 모듈: [함수…] } — 강사 정산(v2-billing-payroll.mjs)도 같은 통로. */
export const v2ServerActions = writes => Object.fromEntries(Object.entries(writes).flatMap(([module, names]) => names.map(name => [name, {
  validate: raw => {
    if (!raw || typeof raw !== 'object' || raw.module !== module || !Array.isArray(raw.args) || raw.args.length > 6) throw badRequest();
    if (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) throw badRequest();
    if (JSON.stringify(raw.args).length > ARG_LIMIT) throw badRequest();
    return { actor: raw.actor ?? null, args: raw.args };
  },
  run: async ({ sql, body, tenantId: t, importV2 }) => {
    try {
      const { results: [r] } = await runV2Server({ steps: [{ module, fn: name, args: body.args }], actorId: await viewerId(sql, t, importV2, body.actor), tenantId: t, mode: 'write' });
      return r.value ?? null;
    } catch (e) { throw refused(e); }
  },
}])));
export const sessionActions = v2ServerActions(SESSION_WRITES);
/** GET 읽기(call=함수 · args=JSON 배열). */
export async function readSessionCall(sql, t, importV2, viewer, call, argsText) {
  const module = SESSION_READS[call];
  let args;
  try { args = JSON.parse(argsText ?? '[]'); } catch { throw badRequest(); }
  if (!module || !Array.isArray(args) || args.length > 3 || !args.every(a => typeof a === 'string' && a.length <= 64)) throw badRequest();
  const { results: [r] } = await runV2Server({ steps: [{ module, fn: call, args }], actorId: await viewerId(sql, t, importV2, viewer?.id ?? null), tenantId: t, mode: 'read' });
  return r.value ?? null;
}

const Q = 'features/billing/session-terms/server/';
/** 회차 확정 면 자료 — p = 2.0과 같은 판정(YYYY-MM이 아니면 이번 달). */
export async function readSessionsFace(t, R, env, viewer, sp) {
  const p = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : R.calc.currentPeriod();
  const call = steps => runV2Server({ steps, actorId: viewer.id, tenantId: t, mode: 'read' });
  const settings = { operations: env.operations };
  if (sp.panel === 'verify') {
    const { results: [view, splits] } = await call([
      { module: `${Q}verification-queries.ts`, fn: 'getSessionVerificationView', args: [p] },
      { module: `${Q}splits-queries.ts`, fn: 'getTeacherSplitsStatus', args: [p] },
    ]);
    return { panel: 'verify', period: p, settings, verification: { view: view.value, savedSplits: splits.value }, confirm: null };
  }
  const { results: [view, seat] } = await call([
    { module: `${Q}queries.ts`, fn: 'getSessionTermsView', args: [p, undefined, { lastMonth: true }] },
    { module: 'features/attendance/server/seat-share-summary.ts', fn: 'loadSeatShareSummary', args: [p] },
  ]);
  return { panel: 'confirm', period: p, settings, confirm: { view: view.value, seatShare: seat.value }, verification: null };
}
