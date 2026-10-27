// 2.0 소스 전수 스캐너 — 라우트·API·서버 액션·내비게이션·탭·크론·기능 모듈·DB 테이블 참조를
// 소스 파일에서 그대로 읽는다(추측 없음). 결과는 catalog/generated/source-scan.json.
// 읽기 전용: 소스만 읽고 DB·네트워크에는 접근하지 않는다.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');
const require = createRequire(join(repoRoot, 'package.json'));
const ts = require('typescript');

const SRC = join(repoRoot, 'src');
const APP = join(SRC, 'app');
const rel = p => relative(repoRoot, p).split(sep).join('/');
const read = p => readFileSync(p, 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isCode = p => /\.(tsx?|mjs|js)$/.test(p) && !/\.(test|spec)\.(tsx?|mjs|js)$/.test(p) && !p.endsWith('.d.ts');

/** src/app 기준 파일 → URL 패턴. 라우트 그룹 `(x)`는 URL에서 빠진다(Next route-groups 규약). */
export function urlOf(fileRel) {
  const parts = fileRel.replace(/^src\/app\//, '').split('/');
  parts.pop();
  const segs = parts.filter(s => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return '/' + segs.join('/');
}
const groupsOf = fileRel => fileRel.replace(/^src\/app\//, '').split('/').filter(s => /^\(.*\)$/.test(s));

const useServerRe = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*["']use server["']/;
const tablesIn = text => [...new Set([...text.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)].map(m => m[1]))].sort();
const rpcsIn = text => [...new Set([...text.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)].map(m => m[1]))].sort();
const exportedFns = text => [...new Set([
  ...[...text.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map(m => m[1]),
  ...[...text.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*async/g)].map(m => m[1]),
])].sort();

// ── import 해석(@/ → src/) ─────────────────────────────────────────────
const exts = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const e of exts) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}
function importsOf(file, text) {
  const out = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of text.matchAll(re)) {
    const spec = m[2] || m[3];
    if (!spec) continue;
    if (/^import\s+type|^export\s+type/.test(m[0])) continue;
    const target = resolveImport(file, spec);
    if (!target) continue;
    const names = [];
    const clause = m[1] || '';
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) for (const part of braces[1].split(',')) {
      const nm = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (nm) names.push(nm);
    }
    out.push({ target, names, spec });
  }
  return out;
}

// ── 파일 캐시 ───────────────────────────────────────────────────────
const textCache = new Map();
const textOf = p => { if (!textCache.has(p)) textCache.set(p, read(p)); return textCache.get(p); };

const allSrc = walk(SRC).filter(isCode);
const serverActionFiles = allSrc.filter(p => useServerRe.test(textOf(p)));
const serverActionSet = new Set(serverActionFiles);

/** 라우트의 경계 디렉터리 — src/app 아래 첫 번째 비(非)그룹 세그먼트(형제 _components까지 같은 기능으로 본다). */
function routeBoundary(file) {
  const parts = relative(APP, file).split(sep);
  const out = [];
  for (const s of parts.slice(0, -1)) { out.push(s); if (!/^\(.*\)$/.test(s)) break; }
  return join(APP, ...out);
}

/** 도달 가능한 파일 — 라우트 경계 안 + src/features + src/components(공용 ui·셸 제외)만 따라간다.
 *  direct = 라우트 경계 안 파일이 직접 import한 기능 모듈(전이 의존과 구분). */
function reachable(entry, routeDir) {
  const seen = new Set();
  const stack = [entry];
  const actionUses = new Map();
  const direct = new Set();
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let text;
    try { text = textOf(f); } catch { continue; }
    for (const imp of importsOf(f, text)) {
      const t = imp.target;
      if (serverActionSet.has(t)) {
        const cur = actionUses.get(t) || new Set();
        imp.names.forEach(n => cur.add(n));
        actionUses.set(t, cur);
      }
      const r = rel(t);
      if ((f === entry || f.startsWith(routeDir + sep)) && r.startsWith('src/features/')) direct.add(r.split('/')[2]);
      const inRoute = routeDir && t.startsWith(routeDir + sep) && !/[\\/](page|layout|route)\.tsx?$/.test(t);
      const inFeature = r.startsWith('src/features/');
      const inComp = r.startsWith('src/components/') && !r.startsWith('src/components/ui/') && !r.startsWith('src/components/workspace/') && !r.startsWith('src/components/shell/');
      if ((inRoute || inFeature || inComp) && !seen.has(t)) stack.push(t);
    }
  }
  return { files: [...seen], actionUses, direct: [...direct].sort() };
}

// ── 게이트 판정 재료 ────────────────────────────────────────────────
const gateRe = /\b(require[A-Z][A-Za-z]+|requireSuperAdmin)\(\s*(?:["'`]([a-z_]+)["'`])?/g;
const gatesIn = text => [...new Set([...text.matchAll(gateRe)].map(m => m[2] ? `${m[1]}:${m[2]}` : m[1]))].sort();
/** 메뉴 게이트가 아닌 권한 판정 단서 — 세션 확인·can*()·*Gate()·notFound(). */
const gateHintsIn = text => [...new Set([
  ...(/\bgetCurrentUser\(\)/.test(text) && /redirect\(\s*["'`]\/login/.test(text) ? ['session'] : []),
  ...[...text.matchAll(/\b(can[A-Z][A-Za-z]+|is[A-Z][A-Za-z]*(?:Admin|Master|Allowed|Enabled|Licensed|Available))\(/g)].map(m => m[1]),
  ...[...text.matchAll(/\b(get[A-Z][A-Za-z]*Gate|[a-z][A-Za-z]*Access)\(/g)].map(m => m[1]),
  ...(/\bnotFound\(\)/.test(text) ? ['notFound'] : []),
])].sort();
const layoutGates = walk(APP).filter(p => /[\\/]layout\.tsx$/.test(p)).map(p => ({ dir: dirname(p), file: rel(p), gates: gatesIn(textOf(p)), hints: gateHintsIn(textOf(p)) })).filter(l => l.gates.length || l.hints.length);

// ── 페이지 ─────────────────────────────────────────────────────────
const pageFiles = walk(APP).filter(p => /[\\/]page\.(tsx|ts|jsx|js)$/.test(p));
const pages = pageFiles.map(p => {
  const r = rel(p);
  const text = textOf(p);
  const title = (text.match(/title:\s*(["'`])((?:(?!\1).){1,120})\1/) || [])[2] || null;
  const redirects = [...text.matchAll(/(?:permanentRedirect|redirect)\(\s*(["'`])((?:(?!\1).)*)\1/g)].map(m => m[2]);
  const hasJsx = /<[A-Za-z][A-Za-z0-9.]*[\s/>]/.test(text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''));
  // `export { View as default } from "…"`인 페이지는 그 뷰 파일까지 게이트 판정 재료로 읽는다.
  const reexport = (text.match(/export\s*\{\s*[A-Za-z0-9_]+\s+as\s+default\s*\}\s*from\s*["']([^"']+)["']/) || [])[1];
  const reexportFile = reexport ? resolveImport(p, reexport) : null;
  const gateText = text + (reexportFile ? '\n' + textOf(reexportFile) : '');
  const gates = gatesIn(gateText);
  // 루트 셸 레이아웃((shell)/layout.tsx)의 can*()은 사이드바·메뉴 계산이라 화면 게이트로 치지 않는다.
  const inherited = layoutGates.filter(l => p.startsWith(l.dir + sep) && rel(l.dir) !== 'src/app/(shell)');
  const layoutGateList = [...new Set(inherited.flatMap(l => [...l.gates, ...l.hints].map(g => `${g}@${l.file}`)))].sort();
  const gateHints = [...gateHintsIn(gateText), ...(/if\s*\(\s*!\s*[A-Za-z0-9_.]+\s*\)\s*(?:return\s+)?(?:redirect|notFound)\(/.test(gateText) ? ['redirect-when-no-data'] : [])].sort();
  const routeDir = routeBoundary(p);
  const { files, actionUses, direct } = reachable(p, routeDir);
  const featureImports = direct;
  const featureClosure = [...new Set(files.map(rel).filter(f => f.startsWith('src/features/')).map(f => f.split('/')[2]))].sort();
  const queryKeys = [...new Set([...text.matchAll(/\b(?:sp|searchParams|params|query|q|search)\??\.(tab|view|mode|section|csub|tsub|face|season|sub|kind|status|subject)\b/g)].map(m => m[1]))].sort();
  return {
    url: urlOf(r),
    file: r,
    routeGroups: groupsOf(r),
    title,
    redirects,
    redirectOnly: redirects.length > 0 && !hasJsx,
    gates,
    layoutGates: layoutGateList,
    reexportFile: reexportFile ? rel(reexportFile) : null,
    gateHints,
    featureImports,
    featureClosureCount: featureClosure.length,
    localComponentFiles: files.filter(f => f.startsWith(routeDir + sep) && f !== p).length,
    serverActions: [...actionUses.entries()].map(([f, names]) => ({ file: rel(f), names: [...names].sort() })).sort((a, b) => a.file.localeCompare(b.file)),
    queryKeys,
  };
}).sort((a, b) => a.url.localeCompare(b.url));

// ── API 라우트 ──────────────────────────────────────────────────────
const vercel = JSON.parse(read(join(repoRoot, 'vercel.json')));
const crons = (vercel.crons || []).map(c => ({ path: c.path, schedule: c.schedule }));
const routeFiles = walk(APP).filter(p => /[\\/]route\.(ts|js)$/.test(p));
const apiRoutes = routeFiles.map(p => {
  const r = rel(p);
  const text = textOf(p);
  const methods = [...new Set([...text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1]))].sort();
  const url = urlOf(r);
  const cron = crons.find(c => c.path === url) || null;
  const { direct } = reachable(p, dirname(p));
  const featureImports = direct;
  return {
    url, file: r, methods,
    cronSchedule: cron ? cron.schedule : null,
    authHints: [...new Set([...text.matchAll(/\b(CRON_SECRET|SYNC_AGENT_[A-Z_]+|INTERNAL_[A-Z_]+|getCurrentUser|getCurrentSuperAdmin|requireAccess|verifyCron[A-Za-z]*|authorizeCron[A-Za-z]*|isCronAuthorized|webhook)\b/g)].map(m => m[1]))].sort(),
    tables: tablesIn(text), rpcs: rpcsIn(text), featureImports,
  };
}).sort((a, b) => a.url.localeCompare(b.url));

// ── 서버 액션 파일 ──────────────────────────────────────────────────
const actions = serverActionFiles.map(p => {
  const r = rel(p);
  const text = textOf(p);
  const feature = r.startsWith('src/features/') ? r.split('/')[2] : r.startsWith('src/app/') ? `app:${urlOf(r.replace(/[^/]+$/, 'page.tsx'))}` : r.split('/').slice(0, 3).join('/');
  return {
    file: r, owner: feature, exports: exportedFns(text),
    tables: tablesIn(text), rpcs: rpcsIn(text),
    writes: /\.(insert|update|upsert|delete)\(/.test(text) || rpcsIn(text).length > 0,
    audit: /\blogAction\(/.test(text), ai: /\bgenerateJSON\(/.test(text),
    notifies: /\b(notifyUsers|sendPushToUsers)\(/.test(text),
  };
}).sort((a, b) => a.file.localeCompare(b.file));

// ── 내비게이션·탭 소스(TS AST) ───────────────────────────────────────
function strVal(node, sf) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(sf).slice(1, -1);
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return `{${node.getText(sf)}}`;
  return null;
}
function navEntries(file) {
  const text = textOf(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = {};
      for (const pr of node.properties) if (ts.isPropertyAssignment(pr) && pr.name && (ts.isIdentifier(pr.name) || ts.isStringLiteral(pr.name))) props[pr.name.text] = pr.initializer;
      const href = strVal(props.href, sf);
      const label = strVal(props.label, sf) ?? strVal(props.labelKey, sf);
      const key = strVal(props.key, sf) ?? strVal(props.menuKey, sf) ?? strVal(props.menu, sf);
      if (href || (label && key)) out.push({ kind: 'object', href, label, key, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['face', 'billingFace', 'fromMenu'].includes(node.expression.text)) {
      const args = node.arguments.map(a => strVal(a, sf));
      const fn = node.expression.text;
      const entry = fn === 'fromMenu' ? { menuKey: args[0], desc: args[1] } : fn === 'face' ? { menuKey: args[0], href: args[1], label: args[2] } : { href: args[0] };
      out.push({ kind: fn, ...entry, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
const faceTabUsers = allSrc.filter(p => /<FaceTabs\b/.test(textOf(p)));
const navSourceFiles = [
  'src/lib/navigation.ts', 'src/lib/menu-hub.ts', 'src/features/owner/tabs.ts', 'src/lib/teacher-menu-links.ts',
  'src/components/super-admin/nav.ts',
  ...allSrc.map(rel).filter(f => /\/faces?\.ts$|-faces\.ts$/.test(f)),
  ...faceTabUsers.map(rel),
  'src/app/(shell)/students/[id]/_components/tabs-nav.tsx',
  'src/features/retention/components/retention-tabs.tsx',
].filter((v, i, a) => a.indexOf(v) === i && existsSync(join(repoRoot, v)));
const navSources = navSourceFiles.map(f => ({ file: f, entries: navEntries(join(repoRoot, f)) }));

// ── 화면 안 카탈로그(위젯·알림 유형·할 일 종류·설정 카드·상세 탭) ─────────
/** `key: { label: "…" }` 모양의 맵에서 키·라벨을 읽는다. */
function labeledMap(file) {
  const text = textOf(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && ts.isObjectLiteralExpression(node.initializer)) {
      const lab = node.initializer.properties.find(p => ts.isPropertyAssignment(p) && p.name && p.name.getText(sf) === 'label');
      const v = lab && strVal(lab.initializer, sf);
      if (v) out.push({ key: node.name.text, label: v, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
/** `{ type|id|key: "…", label: "…" }` 배열 원소를 읽는다. */
function labeledObjects(file, keyProp) {
  const text = textOf(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = {};
      for (const pr of node.properties) if (ts.isPropertyAssignment(pr) && pr.name) props[pr.name.getText(sf)] = pr.initializer;
      const k = strVal(props[keyProp], sf); const l = strVal(props.label, sf);
      if (k && l) out.push({ key: k, label: l, group: strVal(props.group, sf), line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
/** 설정 카드 제목(`title="…"`) — 학원 설정 면 안의 하위 패널. */
function settingsCardTitles(dir) {
  const out = [];
  for (const f of walk(dir).filter(isCode)) {
    for (const m of textOf(f).matchAll(/<(SettingsCard|SectionCard|Card|section)\b[^>]*?\btitle=["{]["`]?([^"`}]{2,60})["`]?/g)) out.push({ file: rel(f), component: m[1], title: m[2] });
  }
  return out;
}
/** `export type X = "a" | "b" | …` 유니언의 문자열 멤버. */
function unionMembers(file, typeName) {
  const text = textOf(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      const walkType = t => {
        if (ts.isUnionTypeNode(t)) t.types.forEach(walkType);
        else if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.push({ key: t.literal.text, line: sf.getLineAndCharacterOfPosition(t.getStart()).line + 1 });
      };
      walkType(node.type);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
const catalogs = {
  notificationTypes: unionMembers(join(SRC, 'features/notifications/types.ts'), 'NotificationType'),
  dashboardWidgets: labeledMap(join(SRC, 'features/dashboard/layout/registry.ts')).filter(e => !/^(summary|one|tall|wide|big|full)$/.test(e.key)),
  notificationForwardEvents: labeledObjects(join(SRC, 'features/slack/events.ts'), 'type'),
  slackActivityCategories: labeledObjects(join(SRC, 'features/slack/activity-catalog.ts'), 'id'),
  slackRulePresets: labeledObjects(join(SRC, 'features/slack/rules.ts'), 'id'),
  staffTaskKinds: labeledMap(join(SRC, 'features/staff-tasks/kinds.ts')),
  studentDetailTabs: labeledObjects(join(APP, '(shell)/students/[id]/_components/tabs-nav.tsx'), 'key'),
  parentTabs: labeledObjects(join(APP, '(parent)/parent/_components/parent-tabs.tsx'), 'key'),
  ownerSettingsCards: settingsCardTitles(join(APP, '(shell)/owner/_components')),
};

// 권한 메뉴 키·라벨·역할
const permText = read(join(SRC, 'lib', 'permissions.ts'));
const block = (name) => { const i = permText.indexOf(`export const ${name}`); const j = permText.indexOf('];', i); return permText.slice(i, j); };
const menuKeysListed = [...block("MENU_KEYS").matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
const roles = [...block('SYSTEM_ROLES').matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
const labelBlock = permText.slice(permText.indexOf('export const MENU_LABEL'), permText.indexOf('};', permText.indexOf('export const MENU_LABEL')));
const menuLabels = Object.fromEntries([...labelBlock.matchAll(/^\s*([a-z_]+):\s*"([^"]+)"/gm)].map(m => [m[1], m[2]]));
// MENU_KEYS는 `...NEW_SETTINGS_ROLE_KEYS` 펼침을 포함하므로, 모든 키를 요구하는 Record인 MENU_LABEL의 키를 단일 소스로 쓴다.
const menuKeys = Object.keys(menuLabels);
const menuKeysMissingFromListed = menuKeys.filter(k => !menuKeysListed.includes(k));

// ── 기능 모듈 ───────────────────────────────────────────────────────
const featureDirs = readdirSync(join(SRC, 'features')).filter(n => statSync(join(SRC, 'features', n)).isDirectory()).sort();
// 기능 모듈 역참조 — src 전체에서 모듈 밖 파일이 직접 import하는지(테스트 파일 제외).
const importersOf = new Map();
for (const f of allSrc) for (const imp of importsOf(f, textOf(f))) {
  const r = rel(imp.target);
  if (!r.startsWith('src/features/')) continue;
  const dir = r.split('/')[2];
  if (rel(f).startsWith(`src/features/${dir}/`)) continue;
  const cur = importersOf.get(dir) || new Set();
  cur.add(rel(f));
  importersOf.set(dir, cur);
}
const features = featureDirs.map(dir => {
  const files = walk(join(SRC, 'features', dir)).filter(isCode);
  const importers = [...(importersOf.get(dir) || [])].sort();
  return {
    dir,
    files: files.length,
    serverActionFiles: files.filter(f => serverActionSet.has(f)).length,
    usedByPages: pages.filter(p => p.featureImports.includes(dir)).map(p => p.url),
    usedByApi: apiRoutes.filter(a => a.featureImports.includes(dir)).map(a => a.url),
    importerCount: importers.length,
    importersSample: importers.slice(0, 5),
  };
});

// ── 레이아웃(역할 셸) ───────────────────────────────────────────────
const layouts = walk(APP).filter(p => /[\\/]layout\.tsx$/.test(p)).map(p => ({ file: rel(p), url: urlOf(rel(p)), routeGroups: groupsOf(rel(p)) }));

// ── DB 테이블 참조(전체 src) ────────────────────────────────────────
const tableRefs = {};
for (const p of allSrc) for (const t of tablesIn(textOf(p))) (tableRefs[t] ||= []).push(rel(p));

// ── 마이그레이션의 알림·할 일 트리거(DB 쪽 알림 경로) ────────────────
const migDir = join(repoRoot, 'supabase', 'migrations');
const dbTriggerNotifiers = existsSync(migDir) ? readdirSync(migDir).filter(f => f.endsWith('.sql')).filter(f => {
  const t = read(join(migDir, f)).toLowerCase();
  return /insert\s+into\s+(public\.)?(notifications|staff_tasks)\b/.test(t) && /create\s+(or\s+replace\s+)?trigger|returns\s+trigger/.test(t);
}).sort() : [];

let gitHead = null;
try { gitHead = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim(); } catch { /* git 없음 */ }

export const scan = {
  scannedAt: new Date().toISOString(),
  gitHead,
  counts: {
    pages: pages.length, apiRoutes: apiRoutes.length, serverActionFiles: actions.length,
    serverActionExports: actions.reduce((n, a) => n + a.exports.length, 0),
    featureDirs: features.length, crons: crons.length, menuKeys: menuKeys.length,
    navSourceFiles: navSources.length, navEntries: navSources.reduce((n, s) => n + s.entries.length, 0),
    tablesReferencedInCode: Object.keys(tableRefs).length, layouts: layouts.length,
  },
  catalogs,
  roles, menuKeys, menuKeysViaSpread: menuKeysMissingFromListed, menuLabels, crons, pages, apiRoutes, actions, navSources, features, layouts,
  tableRefs: Object.fromEntries(Object.entries(tableRefs).sort()),
  dbTriggerNotifiers,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outDir = join(here, 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'source-scan.json'), JSON.stringify(scan, null, 1) + '\n');
  console.log(JSON.stringify(scan.counts));
}
