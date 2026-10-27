// 카탈로그 검증기 — 새로 스캔한 2.0 소스와 커밋된 feature-inventory.json을 대조한다.
// 실행: node experiments/owner-concept/catalog/verify-catalog.mjs  (실패하면 종료 코드 1)
// 결과: catalog/coverage-report.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { scan } from './scan-source.mjs';
import { readPrototype, readDbAvailability, catalogDir, families } from './inventory-core.mjs';
import { assemble } from './assemble.mjs';

const checks = [];
const check = (name, failures, detail = {}) => checks.push({ name, ok: failures.length === 0, failures, ...detail });
const diff = (expected, actual) => ({ missing: [...expected].filter(x => !actual.has(x)), stale: [...actual].filter(x => !expected.has(x)) });
const setOf = (rows, key) => new Set(rows.map(key));

const invPath = join(catalogDir, 'feature-inventory.json');
if (!existsSync(invPath)) { console.error('feature-inventory.json 없음 — build-inventory.mjs를 먼저 실행'); process.exit(1); }
const invText = readFileSync(invPath, 'utf8');
const inv = JSON.parse(invText);
const proto = await readPrototype();
const db = readDbAvailability();

// 1) 소스 ↔ 인벤토리 집합 대조(누락 = 소스에만 · 낡음 = 인벤토리에만)
const pageDiff = diff(setOf(scan.pages, p => `${p.url} ${p.file}`), setOf(inv.routes, r => `${r.url} ${r.file}`));
check('모든 페이지 라우트가 인벤토리에 있다', [...pageDiff.missing.map(x => `누락 ${x}`), ...pageDiff.stale.map(x => `낡음 ${x}`)], { total: scan.pages.length });
check('모든 페이지 라우트에 패밀리·클래스가 있다', inv.routes.filter(r => !r.family || !r.class).map(r => r.url));
check('게이트를 찾지 못한 사용자 화면이 없다(공개 설계 제외)', inv.routes.filter(r => r.gateStatus === 'none-detected').map(r => r.url), { gateStatus: inv.counts.gateStatus });
const apiDiff = diff(setOf(scan.apiRoutes, a => `${a.url} ${a.file}`), setOf(inv.apiRoutes, a => `${a.url} ${a.file}`));
check('모든 API 라우트가 인벤토리에 있다', [...apiDiff.missing.map(x => `누락 ${x}`), ...apiDiff.stale.map(x => `낡음 ${x}`)], { total: scan.apiRoutes.length });
check('모든 API 라우트에 패밀리·클래스가 있다', inv.apiRoutes.filter(a => !a.family || !a.class).map(a => a.url));
const cronDiff = diff(setOf(scan.crons, c => `${c.path} ${c.schedule}`), setOf(inv.crons.filter(c => c.scheduled), c => `${c.path} ${c.schedule}`));
check('vercel.json 크론이 모두 인벤토리에 있다', [...cronDiff.missing.map(x => `누락 ${x}`), ...cronDiff.stale.map(x => `낡음 ${x}`)], { total: scan.crons.length });
const modDiff = diff(setOf(scan.features, m => `src/features/${m.dir}`), setOf(inv.featureModules, m => m.dir));
check('모든 기능 모듈이 패밀리에 배정됐다', [...modDiff.missing.map(x => `누락 ${x}`), ...modDiff.stale.map(x => `낡음 ${x}`), ...inv.featureModules.filter(m => !m.family).map(m => `미배정 ${m.dir}`)], { total: scan.features.length });
const actDiff = diff(setOf(scan.actions.flatMap(a => a.exports.map(e => `${a.file}#${e}`)), x => x), setOf(inv.serverActions.flatMap(a => a.exports.map(e => `${a.file}#${e.name}`)), x => x));
check('모든 서버 액션 export가 인벤토리에 있다', [...actDiff.missing.map(x => `누락 ${x}`), ...actDiff.stale.map(x => `낡음 ${x}`), ...inv.serverActions.filter(a => !a.family).map(a => `미배정 ${a.file}`)], { files: scan.actions.length });
const keyDiff = diff(new Set(scan.menuKeys), setOf(inv.menuKeys, k => k.key));
check('모든 권한 메뉴 키가 패밀리에 배정됐다', [...keyDiff.missing.map(x => `누락 ${x}`), ...keyDiff.stale.map(x => `낡음 ${x}`), ...inv.menuKeys.filter(k => !k.families.length).map(k => `미배정 ${k.key}`)], { total: scan.menuKeys.length });
const navKey = (file, href, label, key) => `${file} ${href ?? ''} ${label ?? ''} ${key ?? ''}`;
const navDiff = diff(
  setOf(scan.navSources.flatMap(s => s.entries.map(e => ({ s, e }))), ({ s, e }) => navKey(s.file, e.kind === 'fromMenu' ? `fromMenu:${e.menuKey}` : e.href, e.label, e.key || e.menuKey)),
  setOf(inv.navigation.filter(n => n.kind !== 'expanded'), n => navKey(n.source.replace(/:\d+$/, ''), n.rawHref, n.label, n.key)),
);
check('모든 내비·탭 소스 항목이 인벤토리에 있다', [...navDiff.missing.map(x => `누락 ${x}`), ...navDiff.stale.map(x => `낡음 ${x}`)], { sources: scan.navSources.length });
check('모든 내비·탭 항목이 화면·면·파생 원본으로 풀린다', inv.navigation.filter(n => !(n.route || ['in-page', 'derived'].includes(n.resolution))).map(n => `${n.source} ${n.href}`));

// 2) 재조립 — 큐레이션·소스·DB·시안을 다시 합쳐 설명되지 않은 문제가 0건인지
const { inventory: fresh, problems } = assemble(scan, proto, db);
check('재조립 문제(미배정·없는 함수·없는 테이블·풀리지 않는 주소) 0건', problems);

// 3) 커밋된 인벤토리가 지금 소스·큐레이션에서 다시 만든 것과 같다(sourceCommit 제외)
const strip = o => JSON.stringify({ ...o, sourceCommit: null });
check('커밋된 인벤토리가 재생성 결과와 같다(낡은 생성본 아님)', strip(fresh) === strip(inv) ? [] : ['feature-inventory.json이 현재 소스·families.mjs와 다르다 — build-inventory.mjs를 다시 실행']);

// 4) AUDIT.md가 같은 인벤토리에서 만들어졌다
const sha = createHash('sha256').update(invText).digest('hex');
const audit = existsSync(join(catalogDir, 'AUDIT.md')) ? readFileSync(join(catalogDir, 'AUDIT.md'), 'utf8') : '';
check('AUDIT.md가 커밋된 인벤토리 해시를 들고 있다', audit.includes(`inventory-sha256: ${sha}`) ? [] : ['AUDIT.md 해시 불일치 — build-inventory.mjs를 다시 실행']);

// 5) 시안 13 + AX 4 + AX 이슈 7이 모두 2.0 패밀리와 이어진다(갭 매트릭스 역방향)
check('시안 13개 화면이 모두 2.0 패밀리와 연결된다', proto.legacyViews.filter(v => !families.some(f => f.ax.legacyViews.includes(v.id))).map(v => v.id), { total: proto.legacyViews.length });
check('AX 4개 화면이 모두 2.0 패밀리와 연결된다', proto.axViews.filter(v => !families.some(f => f.ax.axViews.includes(v.id))).map(v => v.id), { total: proto.axViews.length });
check('AX 이슈 7종이 모두 2.0 패밀리와 연결된다', proto.axIssues.filter(v => !families.some(f => f.ax.axIssues.includes(v.id))).map(v => v.id), { total: proto.axIssues.length });

// 6) 패밀리 구조 — 입구·동작·제안·범위가 비지 않았다
check('모든 패밀리가 입구·핵심 동작·AX 제안·범위를 가진다', inv.families.filter(f =>
  !(f.routes.length || f.apiRoutes.length || f.crons.length) || !f.operations.key.length || !f.ax.proposed?.kind || !f.ax.priority || !f.ownerScope || !f.ax.writePath || !['reviewed', 'source-read', 'auto'].includes(f.verification),
).map(f => f.id), { families: inv.families.length });

const failed = checks.filter(c => !c.ok);
const report = {
  verifiedAt: new Date().toISOString(),
  inventorySourceCommit: inv.sourceCommit,
  currentHead: scan.gitHead,
  inventorySha256: sha,
  result: failed.length ? 'FAIL' : 'PASS',
  summary: {
    pages: `${inv.counts.pagesAssigned}/${scan.pages.length}`, apiRoutes: `${inv.counts.apiAssigned}/${scan.apiRoutes.length}`,
    crons: `${inv.counts.cronsScheduled} scheduled + ${inv.counts.crons - inv.counts.cronsScheduled} unscheduled handler`,
    featureModules: `${inv.counts.modulesAssigned}/${scan.features.length}`, serverActionExports: inv.counts.serverActionExports,
    menuKeys: `${inv.counts.menuKeysAssigned}/${scan.menuKeys.length}`, navEntries: `${inv.counts.navResolved}/${inv.counts.navEntries}`,
    families: inv.counts.families, keyOperations: inv.counts.keyOperations,
    routeClasses: inv.counts.routeClasses, gateStatus: inv.counts.gateStatus, verification: inv.counts.verification,
    remainingUncertainties: { family: inv.counts.familyUncertainties, autoDetected: inv.counts.autoDetectedUncertainties, notes: inv.uncertainties.notes.length },
    resolvedBySourceRead: inv.counts.resolvedUncertainties,
  },
  checks,
};
writeFileSync(join(catalogDir, 'coverage-report.json'), JSON.stringify(report, null, 1) + '\n');
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` — ${c.failures.slice(0, 5).join(' | ')}${c.failures.length > 5 ? ` 외 ${c.failures.length - 5}건` : ''}`}`);
console.log(`${report.result}: ${checks.length - failed.length}/${checks.length} 검사 통과 · 미해결 불확실성 ${inv.counts.familyUncertainties + inv.counts.autoDetectedUncertainties}건(숨기지 않음)`);
process.exit(failed.length ? 1 : 0);
