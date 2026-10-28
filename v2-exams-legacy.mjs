// 2.0 /exams/input · /exams/view의 서버 호출. Docker 복사본에서 원본 함수 그대로.
import { runV2Server } from './v2-server-runner.mjs';

const SETTINGS = 'features/owner/server/queries.ts';
let pureP = null;
const pure = importV2 => (pureP ??= Promise.all([
  importV2('features/owner/subjects.ts'),
  importV2('features/grades/selection.ts'), importV2('features/grades/term.ts'), importV2('lib/date-kst.ts'),
  importV2('features/grades/list-prefs.ts'),
]).then(([subjects, selection, term, date, prefs]) => ({ subjects, selection, term, date, prefs })).catch(e => { pureP = null; throw e; }));

export async function readExamsInput({ tenantId, actorId, params, importV2 }) {
  const P = await pure(importV2);
  const { results: [settings] } = await runV2Server({ tenantId, actorId, mode: 'read',
    steps: [{ module: SETTINGS, fn: 'getTenantSettings', args: [] }] });
  const env = settings.value;
  const subjects = P.subjects.buildSubjectMaps(env.operations.subjects);
  const sel = P.selection.resolveGradeSelection({ year: params.year, term: params.term, subject: params.subject,
    class: params.class, slot: params.slot, date: params.date, max: params.max },
  { subjectOptions: subjects.options, todayIso: P.date.kstToday() });
  if (!sel) return { settings: env, sheet: null, sortPref: P.prefs.GRADE_SORT_DEFAULT, writeError: null, todaysMath: null };
  const { results: [writeError, sheet, sortPref] } = await runV2Server({ tenantId, actorId, mode: 'read', steps: [
    { module: 'features/grades/server/access.ts', fn: 'gradeWriteError', args: [] },
    { module: 'features/grades/server/queries.ts', fn: 'getGradeSheet', args: [sel] },
    { module: 'features/grades/server/list-prefs.ts', fn: 'loadGradeSortPref', args: [] },
  ] });
  const rows = sheet.value?.rows ?? [];
  const todaysMath = rows.length ? (await runV2Server({ tenantId, actorId, mode: 'read', steps: [
    { module: 'features/grades/server/todays-math-monthly.ts', fn: 'loadTodaysMathMonthly', args: [sel, rows.map(r => r.studentId)] },
  ] })).results[0].value : null;
  return { settings: env, sheet: sheet.value, sortPref: sortPref.value, writeError: writeError.value ?? null, todaysMath };
}

export async function readExamsView({ tenantId, actorId, params, importV2 }) {
  const P = await pure(importV2);
  const { results: [settings] } = await runV2Server({ tenantId, actorId, mode: 'read',
    steps: [{ module: SETTINGS, fn: 'getTenantSettings', args: [] }] });
  const env = settings.value, subjects = P.subjects.buildSubjectMaps(env.operations.subjects);
  const keys = subjects.options.map(o => o.value);
  if (!keys.length) return { settings: env, overview: { columns: [], rows: [], classes: [], schemaReady: false } };
  const today = P.term.defaultTermOf(P.date.kstToday());
  const year = P.term.normalizeYear(params.year ?? '', today.year);
  const term = P.term.normalizeTerm(params.term ?? '', today.term);
  const subject = keys.includes(params.subject) ? params.subject : keys[0];
  const classId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.class ?? '') ? params.class : null;
  const { results: [overview] } = await runV2Server({ tenantId, actorId, mode: 'read', steps: [
    { module: 'features/grades/server/overview-queries.ts', fn: 'getGradeOverview', args: [{ year, term, subject, classId }] },
  ] });
  return { settings: env, overview: overview.value };
}
