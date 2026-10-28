// EvaluationFace의 원장 게이트와 설정·구성·미리보기 조회. 모든 표는 tenant_id로 좁힌 Docker 복사본만 읽고 쓴다.
import { UUID } from './v2-mcs-core.mjs';
import { audit } from './v2-timetable-save.mjs';

const BAD = () => new Error('잘못된 강사평가 요청입니다');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const MODULE_SETTINGS = 'features/teacher-portfolio/server/evaluation-actions.ts';
const MODULE_PRESETS = 'features/teacher-portfolio/server/preset-actions.ts';
let configPromise;
const configRules = importV2 => configPromise ??= importV2('features/teacher-portfolio/evaluation/config.ts').catch(e => { configPromise = null; throw e; });

export function portfolioGate(viewer) {
  // getPortfolioGate = class_review 접근 + canSeePortfolio(자기 눈의 원장, 다른 강사 뷰/자기 평가 전용 아님).
  return viewer?.systemRole === 'master' && viewer.level('class_review') !== 'none';
}

const monthKeys = today => {
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000);
  const current = yesterday.toISOString().slice(0, 7);
  const previous = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return [current, previous];
};
const rowsFor = (sql, t, month) => sql`select teacher_id::text "teacherId", raws from public.teacher_portfolio_months where tenant_id=${t} and month=${month} and raws is not null order by teacher_id limit 500`;

export async function loadOwnerEvaluation(sql, t, viewer, importV2, today) {
  if (!portfolioGate(viewer)) return null;
  const C = await configRules(importV2);
  const [{ settingsTable, presetsTable, monthsTable, rawsColumn }] = await sql`select
    to_regclass('public.teacher_evaluation_settings') is not null "settingsTable",
    to_regclass('public.teacher_evaluation_presets') is not null "presetsTable",
    to_regclass('public.teacher_portfolio_months') is not null "monthsTable",
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='teacher_portfolio_months' and column_name='raws') "rawsColumn"`;
  const [setting] = settingsTable ? await sql`select config from public.teacher_evaluation_settings where tenant_id=${t}` : [];
  const presets = presetsTable ? await sql`select id::text id, name, config from public.teacher_evaluation_presets where tenant_id=${t} order by created_at desc limit 20` : [];
  const [current, previous] = monthKeys(today);
  let month = current, rows = monthsTable && rawsColumn ? await rowsFor(sql, t, current) : [];
  if (!rows.length) { month = previous; rows = monthsTable && rawsColumn ? await rowsFor(sql, t, previous) : []; }
  const ids = [...new Set(rows.map(r => r.teacherId))];
  const users = ids.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : [];
  const nameOf = new Map(users.map(u => [u.id, u.display_name || '강사']));
  return {
    initial: setting ? C.resolveEvaluationConfig(setting.config) : C.DEFAULT_EVALUATION_CONFIG,
    tableMissing: !settingsTable, readOnly: !['full', 'scoped'].includes(viewer.level('class_review')),
    presets: presets.map(p => ({ id: p.id, name: p.name, config: C.resolveEvaluationConfig(p.config) })), presetsMissing: !presetsTable,
    preview: { month, rows: rows.map(r => ({ teacherId: r.teacherId, name: nameOf.get(r.teacherId) ?? '강사', raws: r.raws })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) },
  };
}

function validate(module, length) {
  return raw => {
    if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length !== length ||
      (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) || JSON.stringify(raw.args).length > 300_000) throw BAD();
    return { actor: raw.actor ?? null, args: raw.args };
  };
}
async function actionGate(io, actor) {
  if (!portfolioGate(actor) || !['full', 'scoped'].includes(actor.level('class_review'))) return { error: '강사평가 설정을 바꿀 권한이 없습니다' };
  return null;
}
const parseConfig = (C, input) => {
  const parsed = C.evaluationConfigSchema.safeParse(input);
  return parsed.success ? { config: C.resolveEvaluationConfig(parsed.data) } : { error: C.issueMessage(parsed.error) };
};

export function evaluationActions(makeIo) {
  const run = (name, fn) => async ({ sql, body, tenantId, importV2 }) => {
    const io = await makeIo(sql, tenantId, importV2);
    const actor = io.viewers.find(v => v.id === body.actor);
    const denied = await actionGate(io, actor);
    if (denied) return { ok: false, ...denied };
    return fn({ sql, body, t: tenantId, actor, C: await configRules(importV2) });
  };
  return {
    saveEvaluationSettings: { validate: validate(MODULE_SETTINGS, 1), run: run('saveEvaluationSettings', async ({ sql, body, t, actor, C }) => {
      const parsed = parseConfig(C, body.args[0]);
      if (parsed.error) return { ok: false, error: parsed.error };
      try {
        await sql.savepoint(s => s`insert into public.teacher_evaluation_settings (tenant_id, config, updated_by, updated_at)
          values (${t}, ${s.json(parsed.config)}, ${actor.id}, now())
          on conflict (tenant_id) do update set config=excluded.config, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
      } catch (e) { return { ok: false, error: e?.code === '42P01' ? '강사평가 설정 표가 아직 준비되지 않았습니다' : '설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요' }; }
      const on = [...Object.values(parsed.config.metrics), ...parsed.config.manual].filter(m => m.enabled);
      await audit(sql, t, actor, 'teacher_evaluation_settings_save', 'teacher_portfolio', {
        enabled: on.length, maxTotal: on.reduce((n, m) => n + m.max, 0), manual: parsed.config.manual.length,
        churnExclude: parsed.config.metrics.churn.churn?.excludeReasons ?? null, churnCountEnded: parsed.config.metrics.churn.churn?.countEnded ?? null,
      }, '강사평가 설정');
      return { ok: true, notice: '저장했습니다. 연습 화면에서는 월간 점수 다시 매기기는 아직 지원하지 않습니다' };
    }) },
    saveEvaluationPreset: { validate: validate(MODULE_PRESETS, 2), run: run('saveEvaluationPreset', async ({ sql, body, t, actor, C }) => {
      const name = typeof body.args[0] === 'string' ? body.args[0].trim() : '';
      if (!name) return { ok: false, error: '구성 이름을 적어 주세요' };
      if (name.length > 30) return { ok: false, error: '구성 이름은 30자까지입니다' };
      const parsed = parseConfig(C, body.args[1]);
      if (parsed.error) return { ok: false, error: parsed.error };
      try {
        const [{ n }] = await sql.savepoint(s => s`select count(*)::int n from public.teacher_evaluation_presets where tenant_id=${t} and name<>${name}`);
        if (n >= 20) return { ok: false, error: '구성은 20개까지 저장합니다. 안 쓰는 구성을 지우고 다시 저장해 주세요' };
        await sql.savepoint(s => s`insert into public.teacher_evaluation_presets (tenant_id, name, config, created_by, created_at)
          values (${t}, ${name}, ${s.json(parsed.config)}, ${actor.id}, now())
          on conflict (tenant_id, name) do update set config=excluded.config, created_by=excluded.created_by, created_at=excluded.created_at`);
      } catch (e) { return { ok: false, error: e?.code === '42P01' ? '강사평가 구성 표가 아직 준비되지 않았습니다' : '구성을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요' }; }
      await audit(sql, t, actor, 'teacher_evaluation_preset_save', 'teacher_portfolio', { name }, name);
      return { ok: true, notice: `‘${name}’ 구성으로 저장했습니다` };
    }) },
    deleteEvaluationPreset: { validate: validate(MODULE_PRESETS, 1), run: run('deleteEvaluationPreset', async ({ sql, body, t, actor }) => {
      const id = body.args[0];
      if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: '지울 구성을 찾지 못했습니다' };
      let rows;
      try { rows = await sql.savepoint(s => s`delete from public.teacher_evaluation_presets where tenant_id=${t} and id=${id} returning name`); }
      catch (e) { return { ok: false, error: e?.code === '42P01' ? '강사평가 구성 표가 아직 준비되지 않았습니다' : '구성을 지우지 못했습니다. 잠시 후 다시 시도해 주세요' }; }
      const name = rows[0]?.name;
      if (!name) return { ok: false, error: '이미 지워진 구성입니다' };
      await audit(sql, t, actor, 'teacher_evaluation_preset_delete', 'teacher_portfolio', { name }, name);
      return { ok: true, notice: `‘${name}’ 구성을 지웠습니다` };
    }) },
  };
}
