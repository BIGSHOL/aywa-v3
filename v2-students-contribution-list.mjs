// queries.ts#getContributionList의 async 본문을 AST로 꺼내 원본 그대로 실행한다.
// queries.ts 전체 import는 vercel.json의 JSON import attribute가 없어 Node 러너에서 적재할 수 없다.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { z } from 'zod';
import { runV2Server } from './v2-server-runner.mjs';

const sourcePath = new URL('../../src/features/student-contribution/server/queries.ts', import.meta.url);
let originalP;
let recentP;
async function originalListFunction() {
  originalP ??= (async () => {
    const source = await readFile(sourcePath, 'utf8');
    const file = ts.createSourceFile(sourcePath.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = file.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations])
      .find((item) => item.name.getText(file) === 'getContributionList');
    const arrow = declaration?.initializer?.arguments?.[0];
    if (!arrow || !ts.isArrowFunction(arrow)) throw new Error('2.0 기여도 목록 함수가 없습니다');
    const js = ts.transpileModule(`const getContributionList = ${arrow.getText(file)};`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return { text: arrow.getText(file), create: new Function('getContributionDirectory', 'getContributionSnapshot',
      'cachedContributionTotals', 'cachedEnrolledMonths', 'kstToday', 'shiftMonth', 'kstDateOf', 'deployment',
      `${js}\nreturn getContributionList;`) };
  })().catch((error) => { originalP = null; throw error; });
  return originalP;
}

async function contributionTotals(base, tenant, ids, since) {
  if (!ids.length) return [];
  const { normalizeStoredRaws } = await base.load('features/student-contribution/model/normalize-raws.ts');
  const { isMetric } = await base.load('features/student-contribution/model/config.ts');
  // 원본 loadContributionTotals와 같은 DB 함수. PostgREST의 {get:true} 옵션은 현재 러너가 받지 않는다.
  const rows = await base.sql`select student_id::text student_id, raws, recent,
    to_json(computed_at)#>>'{}' computed_at, unavailable from public.student_contribution_totals(${tenant}, ${ids}::uuid[], ${since})`;
  return rows.map((row) => ({ studentId: row.student_id, raws: normalizeStoredRaws(row.raws),
    recent: normalizeStoredRaws(row.recent), computedAt: row.computed_at, unavailable: (row.unavailable ?? []).filter(isMetric) }));
}

const callOriginal = async (base, module, fn, args = []) => {
  const { results: [r] } = await runV2Server({ steps: [{ module: `features/student-contribution/server/${module}`, fn, args }],
    actorId: base.viewer.id, tenantId: base.t, mode: 'read' });
  return r.value;
};

export async function loadContributionList(base, withEnrolledMonths = true) {
  const { create } = await originalListFunction();
  const { kstToday, shiftMonth, kstDateOf } = await base.load('lib/date-kst.ts');
  const deployment = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const fn = create(() => callOriginal(base, 'directory.ts', 'getContributionDirectory'),
    () => callOriginal(base, 'directory.ts', 'getContributionSnapshot'),
    (...args) => contributionTotals(base, ...args),
    (...args) => callOriginal(base, 'snapshot-cache.ts', 'cachedEnrolledMonths', args), kstToday, shiftMonth, kstDateOf, deployment);
  return fn(withEnrolledMonths);
}

export { originalListFunction };

export async function originalRecentFunction() {
  recentP ??= (async () => {
    const path = new URL('../../src/features/student-contribution/server/recent-action.ts', import.meta.url);
    const source = await readFile(path, 'utf8');
    const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const schema = file.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations])
      .find((item) => item.name.getText(file) === 'schema');
    const fn = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'readContributionRecent');
    if (!schema?.initializer || !fn) throw new Error('2.0 기여도 기간 조회 함수가 없습니다');
    const body = fn.getText(file).replace(/^export\s+/, '');
    const js = ts.transpileModule(`const schema = ${schema.initializer.getText(file)};\n${body}`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return { text: body, create: new Function('z', 'getContributionScoreRoster', 'getContributionSnapshot',
      'cachedContributionTotals', 'kstMonth', 'shiftMonth', `${js}\nreturn readContributionRecent;`) };
  })().catch((error) => { recentP = null; throw error; });
  return recentP;
}

export async function loadContributionRecent(base, input) {
  const { create } = await originalRecentFunction();
  const { kstMonth, shiftMonth } = await base.load('lib/date-kst.ts');
  const fn = create(z, () => callOriginal(base, 'score-roster.ts', 'getContributionScoreRoster'),
    () => callOriginal(base, 'directory.ts', 'getContributionSnapshot'),
    (...args) => contributionTotals(base, ...args), kstMonth, shiftMonth);
  return fn(input);
}
