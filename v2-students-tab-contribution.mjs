// 원생 상세 기여도 기본 면 — 2.0 getContributionStudent를 Docker 읽기 전용 러너에서 그대로 실행한다.
// 다른 기여도 하위 면은 다음 단위에서 각각의 원본 읽기·저장을 붙인다.
import { runV2Server } from './v2-server-runner.mjs';

export async function loadTab({ base, id, sp }) {
  const { results: [result] } = await runV2Server({
    steps: [{ module: 'features/student-contribution/server/student-query.ts', fn: 'getContributionStudent', args: [id, sp.month] }],
    actorId: base.viewer.id, tenantId: base.t, mode: 'read',
  });
  return { contribution: result.value ?? null };
}
