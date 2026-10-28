// ContributionSettingsFace: 침산 시범 지점·실험실·원장 게이트를 지난 설정과 전체 실적 미리보기.
import { UUID } from './v2-mcs-core.mjs';
import { audit } from './v2-timetable-save.mjs';

const PILOT = 'becaa316-e636-42e9-9d09-08b133e0b094'; // model/access.ts CONTRIBUTION_PILOT_TENANT
const MODULE = 'features/student-contribution/server/actions.ts';
let modelPromise;
const model = importV2 => modelPromise ??= Promise.all([
  importV2('features/student-contribution/model/config.ts'),
  importV2('features/student-contribution/model/calc.ts'),
  importV2('features/student-contribution/model/normalize-raws.ts'),
  importV2('features/student-contribution/model/roster.ts'),
]).then(([config, calc, normalize, roster]) => ({ config, calc, normalize, roster })).catch(e => { modelPromise = null; throw e; });

export async function contributionGate(t, viewer, labAvailable) {
  if (t !== PILOT || !viewer || viewer.level('student_contribution') === 'none' || viewer.level('billing') === 'none' || !(await labAvailable())) return null;
  const owner = viewer.systemRole === 'master'; // 연습 호스트는 운영자 계정을 보는 사람에 넣지 않는다.
  return { tenantId: t, userId: viewer.id, canConfigure: owner, canWrite: owner && ['full', 'scoped'].includes(viewer.level('student_contribution')) };
}

const priorMonth = today => {
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 - 11, 1)).toISOString().slice(0, 7);
};

export async function loadOwnerContribution(sql, t, gate, importV2, today) {
  if (!gate?.canConfigure) return null;
  const M = await model(importV2);
  const [{ settingsTable, monthsTable, totalsFunction, parentTable }] = await sql`select
    to_regclass('public.student_contribution_settings') is not null "settingsTable",
    to_regclass('public.student_contribution_months') is not null "monthsTable",
    to_regprocedure('public.student_contribution_totals(uuid,uuid[],text)') is not null "totalsFunction",
    to_regclass('public.student_parent_event_imports') is not null "parentTable"`;
  const [setting] = settingsTable ? await sql`select config, revision, history_ready from public.student_contribution_settings where tenant_id=${t}` : [];
  const students = await sql`select id::text id, name, school, grade, status::text status, is_test, notes, withdrawal_metadata
    from public.students where tenant_id=${t} order by id`;
  const enrollments = await sql`select distinct student_id::text id from public.enrollments where tenant_id=${t}`;
  const roster = M.roster.contributionRoster(students, new Set(enrollments.map(e => e.id)));
  const ids = roster.map(s => s.id);
  const ready = monthsTable && totalsFunction;
  const totalRows = [];
  if (ready) for (let i = 0; i < ids.length; i += 200) {
    totalRows.push(...await sql`select student_id::text id, raws from public.student_contribution_totals(${t}::uuid, ${ids.slice(i, i + 200)}::uuid[], ${priorMonth(today)})`);
  }
  const raws = M.calc.sumRaws(totalRows.map(r => M.normalize.normalizeStoredRaws(r.raws)));
  const [approved] = parentTable ? await sql`select id from public.student_parent_event_imports where tenant_id=${t} and status='applied' and scoring_approved_at is not null limit 1` : [];
  return { gate, ready, config: M.config.resolveConfig(setting?.config), revision: Number(setting?.revision ?? 0),
    historyReady: setting?.history_ready === true, parentEventsApproved: !!approved, studentCount: roster.length, raws };
}

const validate = raw => {
  if (!raw || raw.module !== MODULE || !Array.isArray(raw.args) || raw.args.length !== 2 ||
    (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) || JSON.stringify(raw.args).length > 150_000) throw new Error('잘못된 기여도 요청입니다');
  return { actor: raw.actor ?? null, args: raw.args };
};

export function contributionActions(makeIo) {
  return { saveContributionSettings: { validate, run: async ({ sql, body, tenantId: t, importV2 }) => {
    const io = await makeIo(sql, t, importV2);
    const actor = io.viewers.find(v => v.id === body.actor);
    const gate = await contributionGate(t, actor, () => io.laboratoryAvailable('student_contribution'));
    if (!gate?.canWrite) return { error: '기여도 설정을 바꿀 권한이 없습니다' };
    const M = await model(importV2);
    const parsed = M.config.contributionConfigSchema.safeParse(body.args[0]);
    if (!parsed.success) return { error: parsed.error.message };
    const revision = body.args[1];
    if (!Number.isSafeInteger(revision) || revision < 0) return { error: '설정 순번을 확인해 주세요' };
    const data = await loadOwnerContribution(sql, t, gate, importV2, io.R.dk.kstToday());
    if (!data.ready) return { error: '기여도 저장 준비가 필요합니다' };
    if (!data.config.rates.parentSeminarEvents.enabled && parsed.data.rates.parentSeminarEvents.enabled && !data.parentEventsApproved)
      return { error: '설명회 자료와 배점의 반영 범위를 확인한 뒤 사용할 수 있습니다' };
    if (data.revision !== revision) return { error: '설정이 바뀌었습니다. 새로고침 후 다시 저장해 주세요' };
    const beforeTotal = M.calc.scoreRaws(data.raws, data.config).total;
    const afterTotal = M.calc.scoreRaws(data.raws, parsed.data).total;
    const config = M.config.configForStorage(parsed.data);
    try {
      await sql.savepoint(s => s`insert into public.student_contribution_settings (tenant_id) values (${t}) on conflict (tenant_id) do nothing`);
      const rows = await sql.savepoint(s => s`update public.student_contribution_settings
        set config=${s.json(config)}, revision=${revision + 1}, updated_by=${actor.id}, updated_at=now()
        where tenant_id=${t} and revision=${revision} and refresh_token is null returning revision`);
      if (!rows.length) return { error: '집계 중이거나 설정이 바뀌었습니다. 집계가 끝난 뒤 다시 저장해 주세요' };
    } catch { return { error: '설정을 저장하지 못했습니다' }; }
    await audit(sql, t, actor, 'student_contribution_settings_save', 'student_contribution',
      { before: data.config, after: parsed.data, beforeTotal, afterTotal, students: data.studentCount }, '원생 기여도');
    return { ok: true, message: '배점이 지난 실적 전체에 반영되었습니다. 인정 기준을 바꿨다면 지금 집계를 눌러 주세요.' };
  } } };
}
