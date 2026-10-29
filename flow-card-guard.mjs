// 카드 안 2.0 저장의 공통 업무·단계 확인. 실제 인증 세션을 붙이기 전까지 연습 신원은
// 기존 case.report처럼 현재 단계 담당자와 대조하고, 2.0 저장 액션에서도 권한을 다시 검사한다.
import { actorMap } from './flow-engine.mjs';
import { V2Error } from './v2-screens.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (status, code, message) => new V2Error(status, code, message);

export function sourceCardCase(service, caseId, taskKind, expectedRevision = null, stepId = null, actorId = null) {
  if (!service) throw bad(503, 'flow_starting', '업무 흐름을 준비하는 중입니다.');
  const state = service.store.state;
  if (expectedRevision !== null && state.revision !== expectedRevision) throw bad(409, 'revision_conflict', '다른 변경이 먼저 반영되었습니다. 업무를 새로 불러와 주세요.');
  const c = state.cases[caseId];
  if (!c || c.taskKind !== taskKind || c.closure !== 'fact' || c.factClosed || c.state === 'done' || !/^task:[0-9a-f-]{36}$/i.test(c.sourceKey || '')) throw bad(409, 'case_not_ready', '이 업무는 지금 처리할 수 없습니다.');
  if (stepId !== null) {
    const step = c.steps.find(s => s.id === stepId && !s.review && !s.retired && ['ready', 'working'].includes(s.status));
    if (!step) throw bad(409, 'step_not_ready', '지금 처리할 단계가 없습니다.');
    const actor = actorMap(service.source).get(actorId);
    if (!actor || actor.preview || !UUID.test(actorId)) throw bad(403, 'actor_not_allowed', '처리할 직원을 확인해 주세요.');
    if (!step.assigneeIds.includes(actorId) && !(step.queue === 'manager' && !step.assigneeIds.length && ['manager', 'owner'].includes(actor.role))) throw bad(403, 'not_assignee', '이 단계의 담당자가 아닙니다.');
  }
  return { case: c, taskId: c.sourceKey.slice(5) };
}

