// 미발송 보고서 업무 카드: 2.0 sendClassnoteForUnsent를 Docker 복사본의 queued까지만 실행한다.
import { openFullDatabase, tenantId } from './full-db.mjs';
import { sourceCardCase } from './flow-card-guard.mjs';
import { V2Error } from './v2-screens.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const STEP_ID = /^[A-Za-z0-9_-]{1,140}$/;
const MODULE = 'features/report-admin/server/actions.ts';
const bad = (status, code, message) => new V2Error(status, code, message);

async function sourceRow(sql, taskId) {
  const [row] = await sql`select k.kind, k.status::text task_status, k.subject_id::text report_id,
      r.classnote_status, r.revoked_at, r.source
    from public.staff_tasks k left join public.lesson_reports r on r.tenant_id=k.tenant_id and r.id=k.subject_id
    where k.tenant_id=${tenantId} and k.id=${taskId}`;
  return row;
}
const eligible = (row, reportId) => row?.kind === 'unsent_report' && row.task_status === 'open' && row.report_id === reportId
  && row.classnote_status == null && row.revoked_at == null && row.source !== 'edutrix_import';
const notQueuedMessage = result => {
  if (result?.ok === false) return ['보고서 관리 권한이 없습니다', '로그인이 필요합니다'].includes(result.error)
    ? result.error : '발송 요청을 저장하지 못했습니다. 다시 확인해 주세요.';
  if (result?.noClass) return '보낼 반과 원생의 ClassNote 연결을 확인해 주세요. 연결 전에는 발송 요청을 저장할 수 없습니다.';
  if (result?.emptyMent) return '보고서 본문이 비어 있습니다. 내용을 작성한 뒤 다시 요청해 주세요.';
  if (result?.absentSkipped) return '결석 기록이 있어 발송 요청을 저장하지 않았습니다. 출결을 확인해 주세요.';
  if (result?.makeupUnchecked) return '보강 진행 여부를 확인한 뒤 다시 요청해 주세요.';
  if (result?.conflicts) return '이름이 같은 원생이 있어 자동 발송 요청을 막았습니다. 원생 이름을 확인해 주세요.';
  if (result?.dryRun) return '발송 설정이 꺼져 있어 요청을 저장하지 않았습니다.';
  return '발송 요청이 대기에 오르지 않았습니다. 보고서 상태와 발송 조건을 확인해 주세요.';
};

export function createFlowCardReport({ flow, v2ScreenRoute, open = openFullDatabase }) {
  return {
    async save(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['caseId', 'stepId', 'recordRef', 'expectedRevision', 'actorId'].includes(k))
        || !CASE_ID.test(raw.caseId || '') || !STEP_ID.test(raw.stepId || '') || !/^report:[0-9a-f-]{36}$/i.test(raw.recordRef || '')
        || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0 || !UUID.test(raw.actorId || '')) throw bad(400, 'invalid_request', '발송 요청 내용을 확인해 주세요.');
      const { taskId, case: c } = sourceCardCase(flow.service, raw.caseId, 'unsent_report', raw.expectedRevision, raw.stepId, raw.actorId);
      const reportId = raw.recordRef.slice('report:'.length);
      if (!(c.entityRefs || []).some(r => r.type === 'report' && r.id === reportId)) throw bad(409, 'record_ref_not_allowed', '이 업무와 연결된 보고서가 아닙니다.');
      const pre = await open();
      try {
        const row = await pre.begin('isolation level repeatable read read only', sql => sourceRow(sql, taskId));
        if (!eligible(row, reportId)) throw bad(409, 'source_changed', '미발송 보고서 상태가 달라졌습니다. 새로 불러와 주세요.');
      } finally { await pre.end(); }
      const result = await v2ScreenRoute.performWrite({
        id: 'lesson-reports', name: 'sendClassnoteForUnsent',
        raw: { module: MODULE, actor: raw.actorId, args: [[reportId]] },
        beforeRun: async ({ sql }) => {
          sourceCardCase(flow.service, raw.caseId, 'unsent_report', raw.expectedRevision, raw.stepId, raw.actorId);
          if (!eligible(await sourceRow(sql, taskId), reportId)) throw bad(409, 'source_changed', '미발송 보고서 상태가 달라졌습니다. 새로 불러와 주세요.');
        },
      });
      if (result?.ok !== true || !(Number(result.queued) > 0)) return { saved: false, queued: 0, message: notQueuedMessage(result) };
      const post = await open();
      try {
        const row = await post.begin('isolation level repeatable read read only', sql => sourceRow(sql, taskId));
        if (row?.report_id !== reportId || row.classnote_status !== 'queued') throw bad(409, 'source_changed', '발송 요청의 대기 상태를 확인하지 못했습니다. 보고서를 새로 불러와 주세요.');
        return { saved: true, queued: Number(result.queued), sourceClosed: row.task_status === 'done', message: '발송 요청 대기 상태 확인 중' };
      } finally { await post.end(); }
    },
  };
}
