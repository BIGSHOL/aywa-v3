// 서버 액션 export 추적표(operation-coverage.json) 검증기.
// 실행: node experiments/owner-concept/catalog/verify-operation-coverage.mjs  (실패하면 종료 코드 1)
// 확인: 재생성 일치 · 독립 AST 집계와 export 집합 일치(인라인 서버 액션 없음) · 모든 export에 묶음·종류·검토 수준·근거 ·
//       쓰기 export의 목적지 · 원장 표시 묶음이 실제 카탈로그 동작·화면 면에 닿음 · 근거 줄 · 알림 종류 · 수치 일관.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildOperationCoverage, renderCoverage, operationCoveragePath } from './build-operation-coverage.mjs';
import { buildWorkspaceCatalog } from './build-workspace-catalog.mjs';
import { families } from './families.mjs';
import { DISCOVERED, KIND_OVERRIDES, BODY_READ } from './operation-groups.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const ts = createRequire(join(repoRoot, 'package.json'))('typescript');
const rel = p => relative(repoRoot, p).split(sep).join('/');
const checks = [];
const check = (name, failures) => checks.push({ name, ok: failures.length === 0, failures });
const norm = s => s.replace(/\r\n/g, '\n');
const lineHas = (file, line, has) => (readFileSync(join(repoRoot, file), 'utf8').split(/\r?\n/)[line - 1] ?? '').includes(has);

const inventoryText = readFileSync(join(here, 'feature-inventory.json'), 'utf8');
const inventory = JSON.parse(inventoryText);
const { catalog } = buildWorkspaceCatalog({ inventoryText });
const { coverage: fresh, problems } = buildOperationCoverage({ inventoryText, catalog });

// 1) 재생성
check('추적표 재생성 문제 0건(묶음·목적지·근거)', problems);
check('operation-coverage.json이 재생성 결과와 같다', norm(readFileSync(operationCoveragePath, 'utf8')) === renderCoverage(fresh) ? [] : ['낡았다 — node experiments/owner-concept/catalog/build-operation-coverage.mjs']);
const C = JSON.parse(readFileSync(operationCoveragePath, 'utf8'));

// 2) 독립 집계 — 스캐너(정규식)와 다른 방법(TS AST)으로 'use server' 파일과 export를 다시 센다
const astExports = new Set(), inline = [], nonAsync = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(n) || /\.(test|spec)\./.test(n) || n.endsWith('.d.ts')) continue;
    const text = readFileSync(p, 'utf8');
    if (!text.includes('use server')) continue;
    const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, p.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const isDirective = st => st && ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) && st.expression.text === 'use server';
    if (isDirective(sf.statements[0])) {
      for (const st of sf.statements) {
        if (!st.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) { if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) astExports.add(`${rel(p)}#<${st.getText(sf).slice(0, 40)}>`); continue; }
        if (ts.isFunctionDeclaration(st) && st.name) {
          astExports.add(`${rel(p)}#${st.name.text}`);
          if (!st.modifiers.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) nonAsync.push(`${rel(p)}#${st.name.text}`);
        } else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) astExports.add(`${rel(p)}#${d.name.getText(sf)}`);
      }
    }
    // 함수 본문 첫머리의 'use server'(인라인 서버 액션)
    (function find(node) {
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body && ts.isBlock(node.body) && isDirective(node.body.statements[0])) inline.push(`${rel(p)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
      node.forEachChild(find);
    })(sf);
  }
})(join(repoRoot, 'src'));
const covered = new Set(C.exports.map(x => `${x.file}#${x.name}`));
const invSet = new Set(inventory.serverActions.flatMap(s => s.exports.map(e => `${s.file}#${e.name}`)));
check(`독립 AST 집계 ${astExports.size}개 = 추적표 ${covered.size}개 = 인벤토리 ${invSet.size}개, 인라인 서버 액션 0`, [
  ...[...astExports].filter(k => !covered.has(k)).map(k => `추적표에 없음 ${k}`),
  ...[...covered].filter(k => !astExports.has(k)).map(k => `소스에 없음 ${k}`),
  ...[...invSet].filter(k => !covered.has(k)).map(k => `인벤토리에만 있음 ${k}`),
  ...inline.map(k => `인라인 서버 액션(집계 밖) ${k}`), ...nonAsync.map(k => `async가 아닌 export ${k}`),
]);

// 3) export마다 빠진 칸이 없고 쓰기에는 목적지가 있다
const groupById = Object.fromEntries(C.groups.map(g => [g.id, g]));
const per = [];
for (const x of C.exports) {
  const w = `${x.family}|${x.name}`;
  if (!groupById[x.group]) per.push(`${w}: 없는 묶음 ${x.group}`);
  if (!['mutation', 'read', 'helper'].includes(x.kind)) per.push(`${w}: 종류 ${x.kind}`);
  if (!C.method.reviewLevels[x.review]) per.push(`${w}: 검토 수준 ${x.review}`);
  if (x.kind === 'mutation' && !groupById[x.group]?.destination?.type) per.push(`${w}: 쓰기인데 목적지 없음`);
  if (x.machineKind && !x.kindReason) per.push(`${w}: 판정을 고쳤는데 이유 없음`);
}
check(`export ${C.exports.length}개 모두 묶음·종류·검토 수준을 갖고 쓰기 ${C.counts.mutationExports}개는 목적지가 있다`, per);

// 4) 근거 줄 — 선언·게이트·첫 쓰기·판정 정정
const anchors = [];
for (const x of C.exports) for (const [k, ev] of Object.entries(x.evidence)) if (!lineHas(ev.file, ev.line, ev.has)) anchors.push(`${x.family}|${x.name}.${k}: ${ev.file}:${ev.line}에 "${ev.has}" 없음`);
for (const [k, o] of Object.entries(KIND_OVERRIDES)) if (!lineHas(o.evidence.file, o.evidence.line, o.evidence.has)) anchors.push(`정정 ${k}: ${o.evidence.file}:${o.evidence.line}`);
check(`근거 줄 ${C.exports.reduce((n, x) => n + Object.keys(x.evidence).length, 0) + Object.keys(KIND_OVERRIDES).length}개가 소스 그 줄에 있다`, anchors);

// 5) 원장 표시 묶음은 실제로 닿는 3.0 목적지가 있다
const famById = Object.fromEntries(families.map(f => [f.id, f]));
const actions = new Map(catalog.areas.flatMap(a => a.actions.map(x => [x.id, { ...x, area: a }])));
const reach = [];
for (const g of C.groups) {
  const d = g.destination, visible = famById[g.family]?.ownerVisible;
  if (!visible && d.type !== 'audit-only') reach.push(`${g.id}: 감사 전용 패밀리인데 목적지 ${d.type}`);
  if (visible && d.type === 'audit-only') reach.push(`${g.id}: 원장 표시 패밀리인데 감사 전용`);
  if (d.type === 'action') {
    if (!d.actions?.length) reach.push(`${g.id}: 동작 목적지가 비었음`);
    for (const id of d.actions || []) {
      const act = actions.get(id);
      if (!act) { reach.push(`${g.id}: 카탈로그에 없는 동작 ${id}`); continue; }
      if (!act.sourceOperationIds.includes(g.id)) reach.push(`${g.id}: 동작 ${id}의 sourceOperationIds에 없음`);
      if (act.mode === 'navigate' && act.target?.page?.startsWith('workspace-') && !catalog.areas.some(a => a.page === act.target.page)) reach.push(`${g.id}: ${id}의 이동 화면 ${act.target.page} 없음`);
    }
  } else if (d.type === 'facet') {
    const area = catalog.areas.find(a => a.page === d.page);
    if (!area || !area.facets.some(f => f.id === d.facet)) reach.push(`${g.id}: 화면 면 ${d.page}/${d.facet} 없음`);
    if (catalog.coverage.operationFacets?.[g.id]?.facet !== d.facet) reach.push(`${g.id}: 카탈로그 operationFacets와 다름`);
  } else if (d.type === 'ui') { if (!d.reason) reach.push(`${g.id}: 화면 상태 이유 없음`); }
  else if (d.type !== 'audit-only') reach.push(`${g.id}: 목적지 종류 ${d.type}`);
  if (g.productionLinked !== false) reach.push(`${g.id}: 운영 연결이 false가 아님`);
}
for (const g of DISCOVERED) if (!groupById[g.id]) reach.push(`새로 찾은 묶음에 export가 없음: ${g.id}`);
check(`원장 표시 묶음 ${C.counts.ownerFacingGroups}개가 카탈로그 동작·화면 면에 닿고, 감사 전용은 감사 전용으로만`, reach);

// 6) 알림 종류·검토 수준·수치
const misc = [];
const union = new Set(inventory.catalogs.notificationTypes.map(n => n.key));
for (const x of C.exports) for (const t of x.notificationTypes) if (!union.has(t)) misc.push(`${x.name}: 알림 종류 ${t}가 39종 목록에 없음`);
const bodyRead = C.exports.filter(x => x.review === 'body-read').map(x => `${x.family}|${x.name}`).sort();
if (JSON.stringify(bodyRead) !== JSON.stringify([...BODY_READ].sort())) misc.push('본문 직접 읽음 표시가 BODY_READ 목록과 다르다');
const k = C.counts;
if (k.exports !== inventory.counts.serverActionExports) misc.push('export 수가 인벤토리와 다르다');
if (k.mutationExportsWithDestination !== k.mutationExports) misc.push('목적지 없는 쓰기 export가 있다');
if (k.ownerFacingReachable !== k.ownerFacingGroups) misc.push('닿지 않는 원장 표시 묶음이 있다');
if (k.productionLinkedWrites !== 0) misc.push('실제 운영 쓰기 연결이 0이 아니다');
if (Object.values(k.byKind).reduce((a, b) => a + b, 0) !== k.exports) misc.push('종류 합 ≠ export 수');
if (Object.values(k.review).reduce((a, b) => a + b, 0) !== k.exports) misc.push('검토 수준 합 ≠ export 수');
if (!C.method.limits?.length) misc.push('방법의 한계가 적혀 있지 않다');
check('알림 종류는 2.0 목록 안 · 본문 직접 읽음은 적은 것만 · 수치가 서로 맞는다', misc);

const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` — ${c.failures.slice(0, 5).join(' | ')}${c.failures.length > 5 ? ` 외 ${c.failures.length - 5}건` : ''}`}`);
console.log(`${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} · export ${k.exports}(쓰기 ${k.byKind.mutation} · 읽기 ${k.byKind.read} · 도우미 ${k.byKind.helper ?? 0}) · 묶음 ${k.groups}(새로 찾은 ${k.discoveredGroups}) · 검토 ${Object.entries(k.review).map(([a, b]) => `${a} ${b}`).join(' · ')} · 운영 연결 ${k.productionLinkedWrites}`);
process.exit(failed.length ? 1 : 0);
