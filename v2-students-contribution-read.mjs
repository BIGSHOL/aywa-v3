// 기여도 기본 면의 확장 근거를 2.0 원본 함수로 Docker 읽기 전용 트랜잭션에서 조회한다.
import { studentsBase } from './v2-students-common.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SOURCE = /^[a-f0-9]{64}$/;

export async function read({ sql, tenantId, importV2, viewerId, studentId, kind, month, sourceId }) {
  const base = await studentsBase({ sql, tenantId, importV2, viewerId });
  if (!base.viewer) return { result: { error: '기여도 기록을 열람할 수 없습니다.' } };
  if (kind === 'video' && MONTH.test(month ?? '')) {
    const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/video-check-action.ts',
      fn: 'readContributionVideoCheck', args: [{ studentId, month }] }], actorId: base.viewer.id, tenantId, mode: 'read' });
    return { result: r.value };
  }
  if (kind === 'parent' && SOURCE.test(sourceId ?? '')) {
    const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/parent-event-evidence.ts',
      fn: 'getParentEventEvidence', args: [sourceId, studentId] }], actorId: base.viewer.id, tenantId, mode: 'read' });
    return { result: r.value };
  }
  if (kind === 'learning' || kind === 'communication') {
    const { results: [r] } = await runV2Server({ steps: [{ module: `features/student-contribution/server/${kind}-actions.ts`,
      fn: kind === 'learning' ? 'getStudentLearningConnections' : 'getStudentCommunicationConnections', args: [studentId] }],
      actorId: base.viewer.id, tenantId, mode: 'read' });
    return { result: r.value };
  }
  return { result: { error: '조회할 기록을 확인해 주세요.' } };
}
