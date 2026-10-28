// 2.0 화면 — 수납관리 · 회차 확정 면(session-terms-face.tsx · 청구 시수 대조 = session-verification-face.tsx).
// 조립·산식이 커서(조회 · 출석부 줄 집합 · 예정 · 지난 달 기준 · 금액 이월 · 배분 상태 · 자리 몫) SQL로 손 이식하지 않고
// **2.0 서버 함수를 그대로** 돌린다(공용 러너 v2-server-runner.mjs — 작업 스레드 · Supabase 흉내 · 보는 사람 신분 + RLS · 메인 결정 10-28 안 A).
//  · 확정·배분 = features/billing/session-terms/server/queries.ts getSessionTermsView(p, undefined, { lastMonth: true }) ·
//    features/attendance/server/seat-share-summary.ts loadSeatShareSummary(p)
//  · 청구 시수 대조 = verification-queries.ts getSessionVerificationView(p) · splits-queries.ts getTeacherSplitsStatus(p)
// 두 함수는 2.0 page처럼 한 요청(= 복사본 읽기 트랜잭션 하나)에서 부른다.
import { runV2Server } from './v2-server-runner.mjs';

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
