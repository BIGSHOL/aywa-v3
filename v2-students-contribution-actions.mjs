// 기여도 기본 면의 원본 서버 함수. 조회는 Docker 읽기 트랜잭션에서 실행한다.
// changePositiveSignal은 2.0 actions.ts의 단일 함수만 이식한다. 그 모듈이 끌어오는 queries.ts의 vercel.json은
// Node의 JSON import attribute가 없어 러너로 적재할 수 없다. 판정·동시성 조건·감사 기록은 원본 순서 그대로 둔다.
import { studentsBase } from './v2-students-common.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SOURCE = /^[a-f0-9]{64}$/;
const MODULE = 'features/student-contribution/server/actions.ts';
const bad = () => new Error('잘못된 기여도 요청');

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
  return { result: { error: '조회할 기록을 확인해 주세요.' } };
}

export const actions = {
  changePositiveSignal: {
    validate(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== MODULE || !Array.isArray(raw.args)
        || raw.args.length !== 1 || !UUID.test(raw.actor ?? '')) throw bad();
      const input = raw.args[0];
      if (!input || typeof input !== 'object' || Array.isArray(input) || !UUID.test(input.id ?? '')
        || !['cancel', 'rejudge'].includes(input.operation) || typeof input.reason !== 'string'
        || input.reason.trim().length < 2 || input.reason.trim().length > 500) throw bad();
      return { actor: raw.actor, input: { id: input.id, operation: input.operation, reason: input.reason } };
    },
    async run({ sql, body, tenantId }) {
      try {
        const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/access.ts',
          fn: 'requireContributionWrite', args: [] }], actorId: body.actor, tenantId, mode: 'read' });
        if (r.value?.tenantId !== tenantId || r.value.userId !== body.actor) return { error: '기여도 설정을 변경할 권한이 없습니다' };
        const { id, operation, reason } = body.input;
        const [before] = await sql`select id::text id, student_id::text student_id, classification, evidence,
          to_json(cancelled_at)#>>'{}' cancelled_at, to_json(judged_at)#>>'{}' judged_at
          from public.student_positive_signals where tenant_id=${tenantId} and id=${id}`;
        if (!before) return { error: '판정 기록을 찾지 못했습니다' };
        if (operation === 'cancel' && before.cancelled_at) return { error: '이미 취소한 판정입니다' };
        const [actor] = await sql`select display_name from public.users where tenant_id=${tenantId} and id=${body.actor}`;
        const now = new Date().toISOString();
        const changed = operation === 'cancel'
          ? await sql`update public.student_positive_signals set cancelled_at=${now}, cancelled_by=${body.actor}, cancel_reason=${reason}
              where tenant_id=${tenantId} and id=${id} and judged_at=${before.judged_at}::timestamptz returning id`
          : await sql`update public.student_positive_signals set rejudge_requested_at=${now}
              where tenant_id=${tenantId} and id=${id} and judged_at=${before.judged_at}::timestamptz returning id`;
        if (!changed.length) return { error: '판정이 바뀌었습니다. 새로고침 후 다시 시도해 주세요' };
        // 2.0 logAction과 같이 감사 실패는 본 저장을 막지 않는다. 저장점으로 PG 오류도 분리한다.
        try { await sql.savepoint((s) => s`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${tenantId}, ${body.actor}, ${actor?.display_name ?? ''},
            ${operation === 'cancel' ? 'student_contribution_signal_cancel' : 'student_contribution_signal_rejudge'},
            'student_contribution', '긍정 신호', ${s.json({ id, studentId: before.student_id, before, reason, via: '3.0 연습 복사본' })})`); }
        catch { /* 원본 logAction도 best effort */ }
        return { ok: true, message: operation === 'cancel' ? '판정을 취소했습니다. 다음 집계에서 정정에 반영됩니다.'
          : '다음 밤 배치에서 다시 판정합니다. 기존 취소 이력은 유지됩니다.' };
      } catch (error) { return { error: error instanceof Error ? error.message : '작업을 완료하지 못했습니다' }; }
    },
  },
};
