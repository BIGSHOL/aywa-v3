// 2.0 actions.ts의 changePositiveSignal 함수 선언을 AST로 꺼내 원문 그대로 실행한다.
// actions.ts 전체 import는 queries.ts → vercel.json의 JSON import attribute 부재로 Node 러너에서 실패한다.
// 함수의 의존성만 Docker 트랜잭션에 연결하며, 판정·열·동시성 조건·반환 문구는 추출한 원문이 결정한다.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { z } from 'zod';
import { runInCall, callStore } from './v2-server/context.mjs';
import { adminClient } from './v2-server/postgrest.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODULE = 'features/student-contribution/server/actions.ts';
const sourcePath = new URL('../../src/features/student-contribution/server/actions.ts', import.meta.url);
const bad = () => new Error('잘못된 기여도 요청');
let originalP;

export async function originalSignalFunction() {
  originalP ??= (async () => {
    const source = await readFile(sourcePath, 'utf8');
    const file = ts.createSourceFile(sourcePath.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const node = file.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'changePositiveSignal');
    if (!node?.body) throw new Error('2.0 긍정 신호 판정 함수가 없습니다');
    const declaration = node.getText(file).replace(/^export\s+/, '');
    const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const create = new Function('z', 'requireContributionWrite', 'createAdminClient', 'SIGNALS_TABLE', 'logAction', 'invalidate', 'message',
      `${js}\nreturn changePositiveSignal;`);
    return { text: node.getText(file), create };
  })().catch((error) => { originalP = null; throw error; });
  return originalP;
}

export const actions = {
  changePositiveSignal: {
    validate(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== MODULE || !Array.isArray(raw.args)
        || raw.args.length !== 1 || !UUID.test(raw.actor ?? '')) throw bad();
      return { actor: raw.actor, input: raw.args[0] };
    },
    async run({ sql, body, tenantId }) {
      const { create } = await originalSignalFunction();
      const [actor] = await sql`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role
        from public.users where tenant_id=${tenantId} and id=${body.actor} and status::text='active'`;
      const current = actor ? { id: actor.id, tenantId: actor.tenant_id, email: actor.email ?? '', displayName: actor.display_name,
        jobTitle: actor.job_title, systemRole: actor.system_role } : null;
      const requireContributionWrite = async () => {
        const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/access.ts',
          fn: 'requireContributionWrite', args: [] }], actorId: body.actor, tenantId, mode: 'read' });
        if (r.value?.tenantId !== tenantId || r.value.userId !== body.actor) throw new Error('기여도 설정을 변경할 권한이 없습니다');
        return r.value;
      };
      const logAction = async ({ action, targetType, targetLabel, metadata }) => {
        if (!current) return;
        try { await sql.savepoint((s) => s`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${tenantId}, ${current.id}, ${current.displayName}, ${action}, ${targetType}, ${targetLabel},
            ${s.json({ ...metadata, via: '3.0 연습 복사본' })})`); }
        catch { /* 원본 logAction과 동일하게 감사 기록 실패는 본 저장을 막지 않는다. */ }
      };
      const fn = create(z, requireContributionWrite, adminClient, 'student_positive_signals', logAction, () => {},
        (error) => error instanceof Error ? error.message : '작업을 완료하지 못했습니다');
      return runInCall({ sql, metaSql: sql, actor: current, tenantId }, async () => {
        const value = await fn(body.input);
        const unsupported = callStore.getStore()?.unsupported;
        if (unsupported) throw unsupported;
        return value;
      });
    },
  },
};
