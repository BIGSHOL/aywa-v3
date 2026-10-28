// 수동 집계의 2.0 actions.ts#refreshContribution → refresh.ts#refreshStudentContribution → activity-sources.ts#loadActivities 본문을 AST로 실행한다.
// 야간 AI 판정 의존성은 호출되면 실패하도록 둔다. 수동 집계는 원본의 options.nightly=false 경로다.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { runInCall, callStore } from './v2-server/context.mjs';
import { adminClient } from './v2-server/postgrest.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const SRC = new URL('../../src/features/student-contribution/server/', import.meta.url);
const ACTION = 'features/student-contribution/server/actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let originalP;

async function extract(fileName, name, dependencies) {
  const path = new URL(fileName, SRC), source = await readFile(path, 'utf8');
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!node?.body) throw new Error(`2.0 ${name} 함수가 없습니다`);
  const body = node.getText(file).replace(/^export\s+/, '');
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return { text: body, create: new Function(...dependencies, `${js}\nreturn ${name};`) };
}

export async function originalRefreshFunctions() {
  originalP ??= Promise.all([
    extract('actions.ts', 'refreshContribution', ['requireContributionWrite', 'refreshStudentContribution', 'createAdminClient',
      'updateTag', 'contributionSnapshotTag', 'logAction', 'invalidate', 'message']),
    extract('refresh.ts', 'refreshStudentContribution', ['CONTRIBUTION_PILOT_TENANT', 'isLaboratoryMenuAvailable',
      'contributionReady', 'kstToday', 'judgeStudentPositiveSignals', 'loadContributionSettings', 'getTenantSettingsByTenantId',
      'loadCoreSources', 'loadContributionMonths', 'loadActivities', 'loadHistoricalBills', 'loadParentEvents',
      'loadContributionLessonTeachers', 'assembleContribution', 'saveContributionMonths', 'SETTINGS_TABLE']),
    extract('activity-sources.ts', 'loadActivities', ['fetchAllPaged', 'getAssignedVideoHomework', 'loadClassVideos',
      'loadSignalRows', 'loadSignalSources', 'isFeatureLicensed', 'normalizeEvaluationGrades', 'currentSignals', 'signalKey']),
  ]).then(([action, refresh, activities]) => ({ action, refresh, activities }))
    .catch((error) => { originalP = null; throw error; });
  return originalP;
}

export const actions = {
  refreshContribution: {
    validate(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== ACTION || !Array.isArray(raw.args)
        || raw.args.length || !UUID.test(raw.actor ?? '')) throw new Error('잘못된 기여도 집계 요청');
      return { actor: raw.actor };
    },
    async run({ sql, body, tenantId, importV2 }) {
      const original = await originalRefreshFunctions();
      const [actor] = await sql`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role
        from public.users where tenant_id=${tenantId} and id=${body.actor} and status::text='active'`;
      const current = actor ? { id: actor.id, tenantId: actor.tenant_id, email: actor.email ?? '', displayName: actor.display_name,
        jobTitle: actor.job_title, systemRole: actor.system_role } : null;
      const [store, core, signals, batch, grade, subject, parent, model, access, date] = await Promise.all([
        importV2('features/student-contribution/server/store.ts'),
        importV2('features/student-contribution/server/core-sources.ts'),
        importV2('features/student-contribution/server/signals.ts'),
        importV2('lib/supabase/batch.ts'),
        importV2('features/teacher-portfolio/server/evaluation-sources.ts'),
        importV2('features/student-contribution/server/subject-evidence.ts'),
        importV2('features/student-contribution/server/parent-events.ts'),
        importV2('features/student-contribution/model/assemble.ts'),
        importV2('features/student-contribution/model/access.ts'),
        importV2('lib/date-kst.ts'),
      ]);
      const readOriginal = async (module, fn, args = []) => {
        const { results: [r] } = await runV2Server({ steps: [{ module, fn, args }], actorId: body.actor, tenantId, mode: 'read' });
        return r.value;
      };
      const activities = original.activities.create(batch.fetchAllPaged,
        (...args) => readOriginal('features/video-homework/server/assignments.ts', 'getAssignedVideoHomework', args),
        (...args) => readOriginal('features/video-homework/server/ledger-queries.ts', 'loadClassVideos', args),
        signals.loadSignalRows, signals.loadSignalSources,
        (...args) => readOriginal('lib/license/server.ts', 'isFeatureLicensed', args),
        grade.normalizeEvaluationGrades, signals.currentSignals, signals.signalKey);
      const refresh = original.refresh.create(access.CONTRIBUTION_PILOT_TENANT,
        (...args) => readOriginal('lib/laboratory/server.ts', 'isLaboratoryMenuAvailable', args),
        store.contributionReady, date.kstToday,
        () => { throw new Error('연습 복사본에서 AI 판정을 실행할 수 없습니다'); },
        store.loadContributionSettings,
        (...args) => readOriginal('features/owner/server/queries.ts', 'getTenantSettingsByTenantId', args),
        core.loadCoreSources, store.loadContributionMonths, activities, core.loadHistoricalBills, parent.loadParentEvents,
        subject.loadContributionLessonTeachers, model.assembleContribution, store.saveContributionMonths, store.SETTINGS_TABLE);
      const requireContributionWrite = () => readOriginal('features/student-contribution/server/access.ts', 'requireContributionWrite');
      const logAction = async ({ action, targetType, targetLabel, metadata }) => {
        if (!current) return;
        try { await sql.savepoint((s) => s`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${tenantId}, ${current.id}, ${current.displayName}, ${action}, ${targetType}, ${targetLabel},
            ${s.json({ ...metadata, via: '3.0 연습 복사본' })})`); }
        catch { /* 원본 logAction처럼 감사 기록 실패는 집계 저장을 막지 않는다. */ }
      };
      const action = original.action.create(requireContributionWrite, refresh, adminClient, () => {}, () => '',
        logAction, () => {}, (error) => error instanceof Error ? error.message : '작업을 완료하지 못했습니다');
      return runInCall({ sql, metaSql: sql, actor: current, tenantId }, async () => {
        const value = await action();
        const unsupported = callStore.getStore()?.unsupported;
        if (unsupported) throw unsupported;
        return value;
      });
    },
  },
};
