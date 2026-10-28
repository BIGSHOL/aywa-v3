// queries.ts#getContributionSettingsPreview와 actions.ts#saveContributionSettings 본문을 원본 AST에서 꺼내 실행한다.
// 두 모듈의 전체 import는 queries.ts → vercel.json JSON import attribute 문제로 Node 러너에서 실패한다.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { runInCall, callStore } from './v2-server/context.mjs';
import { adminClient } from './v2-server/postgrest.mjs';
import { runV2Server } from './v2-server-runner.mjs';
import { loadContributionList } from './v2-students-contribution-list.mjs';

const QUERY = new URL('../../src/features/student-contribution/server/queries.ts', import.meta.url);
const ACTION = new URL('../../src/features/student-contribution/server/actions.ts', import.meta.url);
const MODULE = 'features/student-contribution/server/actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let readP, writeP;

async function originalFunction(path, name, dependencies) {
  const source = await readFile(path, 'utf8');
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!node?.body) throw new Error(`2.0 ${name} 함수가 없습니다`);
  const body = node.getText(file).replace(/^export\s+/, '');
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return { text: body, create: new Function(...dependencies, `${js}\nreturn ${name};`) };
}

export async function originalSettingsRead() {
  readP ??= originalFunction(QUERY, 'getContributionSettingsPreview',
    ['getContributionGate', 'getContributionList', 'hasApprovedParentEventImport', 'createAdminClient', 'sumRaws'])
    .catch((error) => { readP = null; throw error; });
  return readP;
}

export async function originalSettingsWrite() {
  writeP ??= originalFunction(ACTION, 'saveContributionSettings',
    ['requireContributionWrite', 'contributionConfigSchema', 'createAdminClient', 'contributionReady',
      'loadContributionSettings', 'getContributionList', 'hasApprovedParentEventImport', 'sumRaws', 'scoreRaws',
      'SETTINGS_TABLE', 'configForStorage', 'logAction', 'invalidate', 'message'])
    .catch((error) => { writeP = null; throw error; });
  return writeP;
}

async function originalGate(base, fn) {
  const { results: [r] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/access.ts', fn, args: [] }],
    actorId: base.viewer.id, tenantId: base.t, mode: 'read' });
  return r.value;
}

export async function loadContributionSettingsPreview(base) {
  const { create } = await originalSettingsRead();
  const { sumRaws } = await base.load('features/student-contribution/model/calc.ts');
  const fn = create(() => originalGate(base, 'getContributionGate'),
    (withEnrolledMonths) => loadContributionList(base, withEnrolledMonths),
    async (_db, tenant) => {
      try {
        const rows = await base.sql`select id from public.student_parent_event_imports
          where tenant_id=${tenant} and status='applied' and scoring_approved_at is not null limit 1`;
        return !!rows.length;
      } catch (error) {
        if (error?.code === '42P01') return false;
        throw new Error('설명회 자료의 승인 상태를 읽지 못했습니다');
      }
    }, () => null, sumRaws);
  return fn();
}

export const actions = {
  saveContributionSettings: {
    validate(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== MODULE || !Array.isArray(raw.args)
        || raw.args.length !== 2 || !UUID.test(raw.actor ?? '')) throw new Error('잘못된 배점 설정 요청');
      return { actor: raw.actor, args: raw.args };
    },
    async run({ sql, body, tenantId, importV2 }) {
      const { create } = await originalSettingsWrite();
      const [actor] = await sql`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role
        from public.users where tenant_id=${tenantId} and id=${body.actor} and status::text='active'`;
      const current = actor ? { id: actor.id, tenantId: actor.tenant_id, email: actor.email ?? '', displayName: actor.display_name,
        jobTitle: actor.job_title, systemRole: actor.system_role } : null;
      const base = { sql, t: tenantId, load: importV2, viewer: { id: body.actor } };
      const [config, store, parentEvents, calc] = await Promise.all([
        importV2('features/student-contribution/model/config.ts'),
        importV2('features/student-contribution/server/store.ts'),
        importV2('features/student-contribution/server/parent-events.ts'),
        importV2('features/student-contribution/model/calc.ts'),
      ]);
      const requireContributionWrite = () => originalGate(base, 'requireContributionWrite');
      const logAction = async ({ action, targetType, targetLabel, metadata }) => {
        if (!current) return;
        try { await sql.savepoint((s) => s`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${tenantId}, ${current.id}, ${current.displayName}, ${action}, ${targetType}, ${targetLabel},
            ${s.json({ ...metadata, via: '3.0 연습 복사본' })})`); }
        catch { /* 원본 logAction과 같이 감사 기록 실패는 본 저장을 막지 않는다. */ }
      };
      const fn = create(requireContributionWrite, config.contributionConfigSchema, adminClient, store.contributionReady,
        store.loadContributionSettings, () => loadContributionList(base), parentEvents.hasApprovedParentEventImport,
        calc.sumRaws, calc.scoreRaws, store.SETTINGS_TABLE, config.configForStorage, logAction, () => {},
        (error) => error instanceof Error ? error.message : '작업을 완료하지 못했습니다');
      return runInCall({ sql, metaSql: sql, actor: current, tenantId }, async () => {
        const value = await fn(...body.args);
        const unsupported = callStore.getStore()?.unsupported;
        if (unsupported) throw unsupported;
        return value;
      });
    },
  },
};
