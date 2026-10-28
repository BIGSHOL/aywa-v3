// 원생 상세 기여도 기본 면과 현재 연결·저장된 요약 — 원본 세 함수를 Docker 읽기 전용 러너에서 실행한다.
import { runV2Server } from './v2-server-runner.mjs';

export async function loadTab({ base, id, sp }) {
  if (sp.contribution === 'list') {
    const { loadContributionList } = await import('./v2-students-contribution-list.mjs');
    return { list: await loadContributionList(base) };
  }
  if (sp.contribution === 'ontology') {
    if (sp.view === 'current') {
      const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/live-scope-query.ts',
        fn: 'getCurrentOntologyScope', args: [sp] }], actorId: base.viewer.id, tenantId: base.t, mode: 'read' });
      return { ontologyMode: 'current', currentScope: r.value ?? null };
    }
    const { isMonth } = await base.load('features/student-contribution/model/dates.ts');
    const month = isMonth(sp.month) ? sp.month : base.today.slice(0, 7);
    const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/ontology-query.ts',
      fn: 'getContributionOntology', args: [month, sp] }], actorId: base.viewer.id, tenantId: base.t, mode: 'read' });
    return { ontologyMode: 'monthly', ontology: r.value ?? null };
  }
  if (sp.contribution && sp.contribution !== 'student') return { missing: true };
  const { results: [result, live, summary] } = await runV2Server({
    steps: [
      { module: 'features/student-contribution/server/student-query.ts', fn: 'getContributionStudent', args: [id, sp.month] },
      { module: 'features/student-contribution/server/live-query.ts', fn: 'getLiveConnections', args: [id] },
      { module: 'features/student-contribution/server/summary-query.ts', fn: 'getStudentRecordSummary', args: [id] },
    ],
    actorId: base.viewer.id, tenantId: base.t, mode: 'read',
  });
  return { contribution: result.value ?? null, live: live.value ?? null, summary: summary.value ?? null };
}
