// 상담 후속조치 카드: 상담 기록을 고른 뒤 2.0 toggleConsultationFollowUp을 같은 쓰기 거래에서 실행한다.
import { openFullDatabase, tenantId } from './full-db.mjs';
import { sourceCardCase, sourceSignalCase } from './flow-card-guard.mjs';
import { V2Error } from './v2-screens.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const STEP_ID = /^[A-Za-z0-9_-]{1,140}$/;
const SIGNAL = 'consultation-followup-overdue';
const MODULE = 'features/consultations/server/actions.ts';
const bad = (status, code, message) => new V2Error(status, code, message);

function cardCase(service, caseId, revision = null, stepId = null, actorId = null) {
  const c = service?.store.state.cases[caseId];
  if (c?.taskKind === 'followup_due') return { ...sourceCardCase(service, caseId, 'followup_due', revision, stepId, actorId), signal: false };
  return { case: sourceSignalCase(service, caseId, SIGNAL, revision, stepId, actorId), taskId: null, signal: true };
}

async function taskRow(sql, taskId, lock = false) {
  if (!taskId) return null;
  const [row] = lock
    ? await sql`select kind,status::text status,subject_id::text consultation_id from public.staff_tasks where tenant_id=${tenantId} and id=${taskId} for update`
    : await sql`select kind,status::text status,subject_id::text consultation_id from public.staff_tasks where tenant_id=${tenantId} and id=${taskId}`;
  if (!row || row.kind !== 'followup_due' || row.status !== 'open' || !UUID.test(row.consultation_id || '')) throw bad(409, 'source_changed', '상담 후속조치 업무가 달라졌습니다. 새로 불러와 주세요.');
  return row;
}

async function consultationRow(sql, id, lock = false) {
  const [row] = lock
    ? await sql`select id::text id,student_id::text student_id,follow_up_date::text due,coalesce(follow_up_done,false) done
      from public.student_consultations where tenant_id=${tenantId} and id=${id} for update`
    : await sql`select id::text id,student_id::text student_id,follow_up_date::text due,coalesce(follow_up_done,false) done
      from public.student_consultations where tenant_id=${tenantId} and id=${id}`;
  return row;
}

function eligible(row, signal, asOf) {
  return !!row && UUID.test(row.student_id || '') && row.due && !row.done && (!signal || row.due <= asOf);
}

export function createFlowCardConsultation({ flow, v2ScreenRoute, open = openFullDatabase }) {
  return {
    async records(caseId) {
      if (!CASE_ID.test(caseId || '')) throw bad(400, 'invalid_request', '업무 번호를 확인해 주세요.');
      const source = cardCase(flow.service, caseId);
      const db = await open();
      try {
        return await db.begin('isolation level repeatable read read only', async sql => {
          const task = await taskRow(sql, source.taskId);
          const ids = source.signal ? (source.case.entityRefs || []).filter(r => r.type === 'consultation' && UUID.test(r.id)).map(r => r.id) : [task.consultation_id];
          const asOf = flow.service.source.identity.asOf;
          const found = ids.length ? await sql`select id::text id,student_id::text student_id,follow_up_date::text due,coalesce(follow_up_done,false) done
            from public.student_consultations where tenant_id=${tenantId} and id::text=any(${ids.slice(0, 50)})` : [];
          const byId = new Map(found.map(row => [row.id, row]));
          const rows = [];
          for (const id of ids.slice(0, 50)) {
            const row = byId.get(id);
            if (eligible(row, source.signal, asOf)) rows.push({ recordRef: `consultation:${id}`, label: source.case.entityRefs?.find(r => r.type === 'consultation' && r.id === id)?.label || '상담 기록', due: row.due });
          }
          return { caseId, records: rows };
        });
      } finally { await db.end(); }
    },
    async save(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['caseId', 'stepId', 'recordRef', 'expectedRevision', 'actorId'].includes(k))
        || !CASE_ID.test(raw.caseId || '') || !STEP_ID.test(raw.stepId || '') || !/^consultation:[0-9a-f-]{36}$/i.test(raw.recordRef || '')
        || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0 || !UUID.test(raw.actorId || '')) throw bad(400, 'invalid_request', '상담 후속조치 내용을 확인해 주세요.');
      const source = cardCase(flow.service, raw.caseId, raw.expectedRevision, raw.stepId, raw.actorId);
      const id = raw.recordRef.slice('consultation:'.length);
      if (source.signal && !(source.case.entityRefs || []).some(r => r.type === 'consultation' && r.id === id)) throw bad(409, 'record_ref_not_allowed', '이 업무와 연결된 상담 기록이 아닙니다.');
      const db = await open();
      try {
        await db.begin('isolation level repeatable read read only', async sql => {
          const task = await taskRow(sql, source.taskId);
          if (task && task.consultation_id !== id) throw bad(409, 'record_ref_not_allowed', '이 업무와 연결된 상담 기록이 아닙니다.');
          if (!eligible(await consultationRow(sql, id), source.signal, flow.service.source.identity.asOf)) throw bad(409, 'source_changed', '상담 후속조치 상태가 달라졌습니다. 새로 불러와 주세요.');
        });
      } finally { await db.end(); }
      await v2ScreenRoute.performWrite({
        id: 'consultations', name: 'toggleConsultationFollowUp',
        raw: { module: MODULE, actor: raw.actorId, args: [null, { $formData: [['id', id], ['done', 'true']] }] },
        beforeRun: async ({ sql }) => {
          cardCase(flow.service, raw.caseId, raw.expectedRevision, raw.stepId, raw.actorId);
          const task = await taskRow(sql, source.taskId, true);
          if (task && task.consultation_id !== id) throw bad(409, 'record_ref_not_allowed', '이 업무와 연결된 상담 기록이 아닙니다.');
          if (!eligible(await consultationRow(sql, id, true), source.signal, flow.service.source.identity.asOf)) throw bad(409, 'source_changed', '상담 후속조치 상태가 달라졌습니다. 새로 불러와 주세요.');
        },
        afterRun: async ({ sql, result }) => {
          if (result?.error) throw bad(409, 'save_refused', '상담 후속조치를 저장하지 못했습니다. 상담 관리 권한과 기록을 확인해 주세요.');
          if (!(await consultationRow(sql, id))?.done) throw bad(409, 'save_refused', '상담 후속조치 완료를 확인하지 못했습니다.');
        },
      });
      return { saved: true, recordRef: raw.recordRef, message: '상담 기록 저장 상태 확인 중' };
    },
  };
}
