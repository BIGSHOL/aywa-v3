// 스캔(소스) + 큐레이션(families.mjs) + DB 집계 + 시안 파싱 → 인벤토리 문서와 문제 목록.
// problems = 설명되지 않은 누락·불일치. 0이어야 생성·검증이 통과한다.
import {
  families, routeClassRules, verifiedGates, familyByPrefix, patternMatches, familyOfFile,
  NAV_CONSTANTS, DERIVED_NAV, OWNER_SHEETS_SUBS,
} from './inventory-core.mjs';

const byId = Object.fromEntries(families.map(f => [f.id, f]));
const EXEMPT_CLASSES = ['redirect', 'public-share', 'device', 'auth', 'dev', 'portal', 'platform'];

/** 화면 게이트 상태 — 메뉴 게이트 > 레이아웃 게이트 > 원문 확인 게이트 > 화면 안 판정 > 세션만 > 공개 설계 > 감지 안 됨. */
function gateStatus(p, cls) {
  if (p.gates.length) return 'menu-gate';
  if ((p.layoutGates || []).some(g => /^require/.test(g))) return 'layout-gate';
  if (verifiedGates.some(v => v.route === p.url)) return 'verified-in-loader';
  const hints = (p.gateHints || []).filter(h => h !== 'session');
  if (hints.length) return 'custom-gate';
  if ((p.gateHints || []).includes('session')) return 'session-only';
  if (EXEMPT_CLASSES.includes(cls)) return 'public-by-design';
  return 'none-detected';
}

function routeClass(p) {
  const g = p.routeGroups;
  if (p.redirectOnly) return 'redirect';
  if (g.includes('(print)') || /\/print$/.test(p.url)) return 'print';
  if (p.url.startsWith('/dev/')) return 'dev';
  if (g.includes('(super-admin)')) return 'platform';
  if (g.includes('(kiosk)') || g.includes('(seat)')) return 'device';
  if (g.includes('(share)') || g.includes('(intake)') || g.includes('(asset)') || g.includes('(academy)') || g.includes('(marketing)')) return 'public-share';
  if (g.includes('(auth)') || p.url.startsWith('/tenant-view')) return 'auth';
  if (g.includes('(parent)') || p.url.startsWith('/my-learning')) return 'portal';
  if (/\/(new|edit)$/.test(p.url)) return 'form';
  if (/\/stats$/.test(p.url)) return 'stats';
  if (/\[[^\]]+\]/.test(p.url)) return 'detail';
  return 'screen';
}

function apiClass(a) {
  if (a.url.startsWith('/api/cron/')) return 'cron';
  if (a.url.startsWith('/api/webhooks/') || a.url === '/api/calendar/google-push') return 'webhook';
  if (a.url.startsWith('/api/internal/') || a.url.startsWith('/api/sync-agent/')) return 'worker-internal';
  if (a.url.startsWith('/api/integrations/') || a.url.startsWith('/api/connected-apps/')) return 'integration';
  if (a.url.startsWith('/api/exports/') || /excel|export/.test(a.url)) return 'export';
  if (a.url.startsWith('/api/video-submit/') || a.url === '/api/attendance/checkin') return 'public-submit';
  if (!a.url.startsWith('/api/')) return 'auth-redirect';
  return 'client-fetch';
}

/** 서버 액션 export 이름 → 한국어 동작 갈래(접두사 규칙, 결정적). */
const VERB_RULES = [
  [/^(create|add|register|issue|insert|submit|request|start|ensure|reserve|assign|queue|enqueue|link|duplicate)/, '생성·등록'],
  [/^(update|save|set|change|patch|move|reorder|rename|reparent|resize|upsert|edit|extend|reschedule|apply|confirm|commit|flush|copy|fill|absorb|map|merge|mark|toggle|convert|switch|record|note|decide|answer|approve|ack|replace|revise|reset|reopen|undo|rollback|end|close|archive|hold|cancel|withdraw|void|revoke|unlink|unissue|unconfirm|unarchive|reactivate|dismiss|undismiss|skip|absent|process|clear)/, '수정·처리'],
  [/^(delete|remove)/, '삭제'],
  [/^(send|push|resend|sendBulk|retry|refresh|rebuild|regenerate|generate|run|trigger|pull|sync|extract|import|preview|test|rerun|campaign|log)/, '실행·발송·생성(AI 포함)'],
  [/^(load|get|list|read|search|fetch|check|sign|download|build)/, '조회'],
];
const verbOf = name => (VERB_RULES.find(([re]) => re.test(name)) || [null, '기타'])[1];

export function assemble(scan, proto, db) {
  const problems = [];
  const notes = [];
  const featureOwner = {};
  for (const f of families) for (const d of f.featureDirs) {
    if (featureOwner[d]) problems.push(`기능 모듈 ${d}가 두 패밀리(${featureOwner[d]}, ${f.id})에 배정됨`);
    featureOwner[d] = f.id;
  }

  // ── 페이지 라우트 ──
  const routes = scan.pages.map(p => {
    const family = familyByPrefix(p.url, 'routes');
    if (!family) problems.push(`페이지 라우트 미배정: ${p.url} (${p.file})`);
    const cls = routeClass(p);
    const exports = p.serverActions.flatMap(a => {
      const af = scan.actions.find(x => x.file === a.file);
      return a.names.filter(n => af && af.exports.includes(n)).map(n => `${a.file.replace('src/features/', '')}#${n}`);
    });
    return {
      url: p.url, file: p.file, family, class: cls, title: p.title,
      gates: p.gates, layoutGates: p.layoutGates || [], gateHints: p.gateHints || [], gateStatus: gateStatus(p, cls), gateEvidence: verifiedGates.find(v => v.route === p.url)?.evidence || null,
      redirects: p.redirects, featureImports: p.featureImports,
      queryKeys: p.queryKeys, serverActions: exports,
      verification: byId[family]?.verification === 'auto' ? 'auto' : 'reviewed',
    };
  });

  // ── API 라우트 ──
  const apis = scan.apiRoutes.map(a => {
    const family = a.url.startsWith('/api/cron/')
      ? (families.find(f => f.crons.includes(a.url))?.id || null)
      : familyByPrefix(a.url, 'api');
    if (!family) problems.push(`API 라우트 미배정: ${a.url} (${a.file})`);
    return { url: a.url, file: a.file, family, class: apiClass(a), methods: a.methods, cronSchedule: a.cronSchedule, authHints: a.authHints, tables: a.tables, featureImports: a.featureImports, verification: 'auto' };
  });

  for (const v of verifiedGates) if (!scan.pages.some(p => p.url === v.route)) problems.push(`verifiedGates에 없는 라우트: ${v.route}`);

  // ── 크론 ──
  for (const c of scan.crons) if (!apis.some(a => a.url === c.path)) problems.push(`vercel.json 크론에 핸들러가 없음: ${c.path}`);
  for (const f of families) for (const c of f.crons) if (!scan.apiRoutes.some(a => a.url === c)) problems.push(`${f.id}.crons에 없는 경로: ${c}`);
  const crons = apis.filter(a => a.class === 'cron').map(a => ({ path: a.url, schedule: a.cronSchedule, scheduled: !!a.cronSchedule, family: a.family, file: a.file }));
  for (const c of crons) if (!c.scheduled) notes.push(`크론 핸들러 ${c.path}는 vercel.json 일정이 없다(수동/중지)`);

  // ── 기능 모듈 ──
  const modules = scan.features.map(m => {
    const family = featureOwner[m.dir] || null;
    if (!family) problems.push(`기능 모듈 미배정: src/features/${m.dir}`);
    return { dir: `src/features/${m.dir}`, family, files: m.files, serverActionFiles: m.serverActionFiles, usedByPages: m.usedByPages.length, usedByApi: m.usedByApi.length, importerCount: m.importerCount, importersSample: m.importersSample, orphan: m.importerCount === 0 };
  });
  for (const d of Object.keys(featureOwner)) if (!scan.features.some(m => m.dir === d)) problems.push(`families.mjs가 없는 모듈을 가리킴: ${d}`);

  // ── 서버 액션 파일 ──
  const actionIndex = new Map();
  const actions = scan.actions.map(a => {
    const dir = a.file.startsWith('src/features/') ? a.file.split('/')[2] : null;
    const family = dir ? featureOwner[dir] : familyOfFile(a.file, featureOwner) || (a.file.startsWith('src/app/(auth)/') ? 'auth-session' : null);
    if (!family) problems.push(`서버 액션 파일 미배정: ${a.file}`);
    for (const e of a.exports) { const cur = actionIndex.get(e) || []; cur.push({ file: a.file, family }); actionIndex.set(e, cur); }
    return { file: a.file, family, exports: a.exports.map(n => ({ name: n, verb: verbOf(n) })), tables: a.tables, rpcs: a.rpcs, writes: a.writes, audit: a.audit, ai: a.ai, notifies: a.notifies };
  });

  // ── keyOps 근거 확인 ──
  for (const f of families) for (const op of f.keyOps) {
    for (const fn of op.fns) {
      const hits = actionIndex.get(fn);
      if (!hits) problems.push(`${f.id} keyOps "${op.op}": 서버 액션 ${fn} 이(가) 존재하지 않음`);
    }
    for (const u of op.api || []) if (!scan.apiRoutes.some(a => a.url === u)) problems.push(`${f.id} keyOps "${op.op}": API ${u} 없음`);
    for (const u of op.pages || []) if (!scan.pages.some(p => p.url === u)) problems.push(`${f.id} keyOps "${op.op}": 페이지 ${u} 없음`);
    if (!op.fns.length && !(op.api || []).length && !(op.pages || []).length) problems.push(`${f.id} keyOps "${op.op}": 근거 없음`);
  }

  // ── 권한 메뉴 키 ──
  const menuKeys = scan.menuKeys.map(k => {
    const fams = families.filter(f => f.menuKeys.includes(k)).map(f => f.id);
    if (!fams.length) problems.push(`메뉴 키 미배정: ${k} (${scan.menuLabels[k]})`);
    const gatedRoutes = routes.filter(r => r.gates.includes(`requireAccess:${k}`)).map(r => r.url);
    return { key: k, label: scan.menuLabels[k], families: fams, gatedRoutes, viaSpread: scan.menuKeysViaSpread.includes(k) };
  });
  for (const f of families) for (const k of f.menuKeys) if (!scan.menuKeys.includes(k)) problems.push(`${f.id}.menuKeys에 없는 키: ${k}`);

  // ── 내비·탭 항목 ──
  const navHref = {};
  for (const s of scan.navSources) for (const e of s.entries) if (s.file === 'src/lib/navigation.ts' && e.kind === 'object' && e.key && e.href && !e.href.includes('{') && !e.href.includes('?') && !navHref[e.key]) navHref[e.key] = e.href;
  const navigation = [];
  for (const s of scan.navSources) for (const e of s.entries) {
    let href = e.href;
    let resolution = 'literal';
    let why = null;
    if (e.kind === 'fromMenu' && /^{/.test(e.menuKey || '')) { resolution = 'derived'; why = '자주 방문한 메뉴(frequentFor) — 방문 기록의 메뉴 키를 NAV_GROUPS로 되돌린다(원본은 src/lib/navigation.ts)'; }
    else if (e.kind === 'fromMenu') { href = navHref[e.menuKey] || null; resolution = 'menuKey'; if (!href) problems.push(`fromMenu(${e.menuKey})의 NAV 정의를 찾을 수 없음 (${s.file}:${e.line})`); }
    if (href) {
      const m = href.match(/^\{([A-Z_]+)\}$|^\$\{([A-Z_]+)\}(.*)$/);
      if (m) { const c = NAV_CONSTANTS[m[1] || m[2]]; if (c) { href = c.value + (m[3] || ''); resolution = 'constant'; } }
    }
    const derived = href && DERIVED_NAV.find(d => href === d.match || href.includes(d.match));
    if (derived) { resolution = 'derived'; why = derived.why; }
    let route = null, family = null;
    if (resolution === 'derived') { /* 원본 목록이 따로 잡힌다 */ }
    else if (href) {
      const path = href.split(/[?#]/)[0];
      const page = scan.pages.find(p => patternMatches(p.url, path));
      if (!page) problems.push(`내비 항목이 없는 화면을 가리킴: ${href} (${s.file}:${e.line})`);
      else { route = page.url; family = familyByPrefix(page.url, 'routes'); }
    } else if (!href) {
      // href 없는 항목 = 화면 안 탭·필터(키+라벨). 그 파일의 라우트 패밀리에 속한다.
      resolution = 'in-page'; family = familyOfFile(s.file, featureOwner);
      if (!family) problems.push(`화면 안 탭의 패밀리를 정할 수 없음: ${s.file}:${e.line}`);
    }
    navigation.push({ source: `${s.file}:${e.line}`, kind: e.kind, rawHref: e.kind === 'fromMenu' ? `fromMenu:${e.menuKey}` : (e.href ?? null), href, label: e.label || null, key: e.key || e.menuKey || null, resolution, why, route, family });
  }
  // 파생 항목 펼치기(연동 하위 면)
  for (const [k, l] of OWNER_SHEETS_SUBS) navigation.push({ source: 'src/app/(shell)/owner/_components/integrations-face.tsx:28', kind: 'expanded', href: `/owner?tab=sheets&sub=${k}`, label: l, key: k, resolution: 'expanded', why: 'DERIVED_NAV 펼침', route: '/owner', family: 'owner-settings' });

  // ── 화면 안 카탈로그 ──
  const catalogs = scan.catalogs;

  // ── DB 엔티티 ──
  const dbTables = db ? db.tables : [];
  const dbIndex = new Map(dbTables.map(t => [t.table, t]));
  const famTables = Object.fromEntries(families.map(f => [f.id, new Set()]));
  for (const [t, files] of Object.entries(scan.tableRefs)) for (const file of files) {
    const fam = familyOfFile(file, featureOwner);
    if (fam && famTables[fam]) famTables[fam].add(t);
  }
  for (const a of apis) for (const t of a.tables) if (a.family) famTables[a.family].add(t);
  const entities = dbTables.filter(t => t.schema === 'public').map(t => {
    const fams = families.filter(f => famTables[f.id].has(t.table)).map(f => f.id);
    return { table: t.table, rows: t.rows, csRows: t.csRows, tenantScoped: t.tenantScoped, families: fams, referencedInCode: !!scan.tableRefs[t.table], inPrototypeSnapshot: proto.snapshotTables.includes(t.table) };
  });
  const nonPublic = dbTables.filter(t => t.schema !== 'public').map(t => ({ schema: t.schema, table: t.table, rows: t.rows }));
  const codeTablesMissingInDb = db ? Object.keys(scan.tableRefs).filter(t => !dbTables.some(d => d.table === t)) : [];
  for (const t of codeTablesMissingInDb) notes.push(`코드가 .from("${t}")로 읽지만 복사본 public 스키마에 없는 이름(뷰·다른 스키마·오래된 코드 가능)`);
  if (!db) problems.push('generated/db-availability.json 없음 — db-availability.mjs를 먼저 실행');

  // ── 패밀리 ──
  const legacyIds = new Set(proto.legacyViews.map(v => v.id));
  const axViewIds = new Set(proto.axViews.map(v => v.id));
  const axIssueIds = new Set(proto.axIssues.map(v => v.id));
  const familyDocs = families.map(f => {
    if (!['owner', 'owner-linked', 'audit-only'].includes(f.ownerScope)) problems.push(`${f.id}.ownerScope 없음·잘못됨: ${f.ownerScope}`);
    if (!['reuse-2.0-actions', 'reuse+new-storage', 'read-only', 'n/a'].includes(f.ax.writePath)) problems.push(`${f.id}.ax.writePath 없음·잘못됨: ${f.ax.writePath}`);
    for (const v of f.ax.legacyViews) if (!legacyIds.has(v)) problems.push(`${f.id}.ax.legacyViews에 없는 시안 화면: ${v}`);
    for (const v of f.ax.axViews) if (!axViewIds.has(v)) problems.push(`${f.id}.ax.axViews에 없는 AX 화면: ${v}`);
    for (const v of f.ax.axIssues) if (!axIssueIds.has(v)) problems.push(`${f.id}.ax.axIssues에 없는 AX 이슈: ${v}`);
    for (const op of f.ax.sessionOps) if (!(op.startsWith('ax:') ? proto.axActions : proto.sessionOnlyActions).includes(op)) problems.push(`${f.id}.ax.sessionOps에 시안에 없는 동작: ${op}`);
    if (f.ax.sessionOps.length && f.ax.level !== 'simulated') problems.push(`${f.id}: 시안 동작이 있는데 ax.level이 ${f.ax.level}`);
    if (!f.ax.sessionOps.length && f.ax.level === 'simulated') problems.push(`${f.id}: ax.level이 simulated인데 근거 동작이 없음`);
    const entityAvailability = f.primaryEntities.map(t => {
      const row = dbIndex.get(t);
      if (db && !row) problems.push(`${f.id}.primaryEntities의 테이블이 DB에 없음: ${t}`);
      return { table: t, rows: row ? row.rows : null, csRows: row ? row.csRows : null, inPrototypeSnapshot: proto.snapshotTables.includes(t) };
    });
    const fRoutes = routes.filter(r => r.family === f.id);
    const fApis = apis.filter(a => a.family === f.id);
    const fActions = actions.filter(a => a.family === f.id);
    const verbs = {};
    for (const a of fActions) for (const e of a.exports) (verbs[e.verb] ||= []).push(e.name);
    const surfaces = navigation.filter(n => n.family === f.id && n.resolution !== 'derived').map(n => ({ label: n.label, href: n.href, key: n.key, source: n.source, resolution: n.resolution }));
    return {
      id: f.id, label: f.label, domain: f.domain, ownerScope: f.ownerScope, audience: f.audience, menuKeys: f.menuKeys,
      implementation: f.implementation,
      routes: fRoutes.map(r => ({ url: r.url, class: r.class, title: r.title, file: r.file })),
      apiRoutes: fApis.map(a => ({ url: a.url, class: a.class, methods: a.methods, cronSchedule: a.cronSchedule })),
      crons: f.crons, featureDirs: f.featureDirs.map(d => `src/features/${d}`),
      surfaces,
      operations: {
        key: f.keyOps,
        allExports: Object.fromEntries(Object.entries(verbs).map(([k, v]) => [k, [...new Set(v)].sort()])),
        actionFiles: fActions.map(a => a.file),
        writesAuditLog: fActions.some(a => a.audit), usesAI: fActions.some(a => a.ai), sendsNotifications: fActions.some(a => a.notifies),
      },
      entities: { primary: entityAvailability, referencedInCode: [...famTables[f.id]].sort(), prototypeReads: [...famTables[f.id]].filter(t => proto.snapshotTables.includes(t)).sort() },
      catalogs: (f.catalogs || []).map(c => ({ name: c, count: (catalogs[c] || []).length })),
      ax: f.ax,
      verification: f.verification, sourceRead: f.sourceRead || [], uncertainties: f.uncertainties || [], resolved: f.resolved || [],
    };
  });

  // ── 갭 매트릭스 ──
  const gapMatrix = familyDocs.map(f => {
    const prim = f.entities.primary;
    const withData = prim.filter(p => (p.csRows ?? p.rows ?? 0) > 0).length;
    const inSnap = prim.filter(p => p.inPrototypeSnapshot).length;
    return {
      family: f.id, label: f.label, domain: f.domain, ownerScope: f.ownerScope, writePath: f.ax.writePath, priority: f.ax.priority,
      v2Status: f.implementation.status, axLevel: f.ax.level,
      legacyViews: f.ax.legacyViews, axViews: f.ax.axViews, axIssues: f.ax.axIssues,
      primaryEntitiesWithCsData: `${withData}/${prim.length}`, primaryEntitiesInPrototypeSnapshot: `${inSnap}/${prim.length}`,
      dataVsUi: prim.length && withData > 0 && f.ax.level === 'absent' ? 'data-available-ui-absent' : f.ax.level === 'absent' ? 'ui-absent' : 'ui-partial',
      routeCount: f.routes.length, keyOpCount: f.operations.key.length,
      proposed: f.ax.proposed,
    };
  });

  // ── 자동 감지 불확실성 ──
  const autoUncertain = [];
  for (const r of routes) {
    if (EXEMPT_CLASSES.includes(r.class)) continue;
    if (r.gateStatus === 'none-detected') autoUncertain.push({ route: r.url, issue: '게이트를 찾지 못함(페이지·재-export 뷰·레이아웃·원문 확인 목록 어디에도 없음)', family: r.family });
    if (r.gateStatus === 'session-only') autoUncertain.push({ route: r.url, issue: '세션 확인만 보임 — 역할·권한 판정이 조회 함수 안에 있는지 원문 확인 필요', family: r.family });
  }
  for (const m of modules) if (m.orphan) autoUncertain.push({ module: m.dir, issue: 'src 전체에서 모듈 밖 import가 0건(테스트 제외) — 사용처 없는 모듈일 수 있다', family: m.family });

  const counts = {
    pages: routes.length, pagesAssigned: routes.filter(r => r.family).length,
    apiRoutes: apis.length, apiAssigned: apis.filter(a => a.family).length,
    crons: crons.length, cronsScheduled: crons.filter(c => c.scheduled).length,
    featureModules: modules.length, modulesAssigned: modules.filter(m => m.family).length,
    serverActionFiles: actions.length, serverActionExports: actions.reduce((n, a) => n + a.exports.length, 0),
    menuKeys: menuKeys.length, menuKeysAssigned: menuKeys.filter(m => m.families.length).length,
    navEntries: navigation.length, navResolved: navigation.filter(n => n.route || n.resolution === 'in-page' || n.resolution === 'derived').length,
    families: familyDocs.length, keyOperations: familyDocs.reduce((n, f) => n + f.operations.key.length, 0),
    dbTables: dbTables.length, dbPublicTables: entities.length, dbTablesLinkedToFamilies: entities.filter(e => e.families.length).length,
    dbTablesNotReferencedInCode: entities.filter(e => !e.referencedInCode).length,
    routeClasses: Object.fromEntries(Object.entries(routes.reduce((o, r) => (o[r.class] = (o[r.class] || 0) + 1, o), {})).sort()),
    familyUncertainties: familyDocs.reduce((n, f) => n + f.uncertainties.length, 0),
    autoDetectedUncertainties: autoUncertain.length,
    verification: Object.fromEntries(Object.entries(familyDocs.reduce((o, f) => (o[f.verification] = (o[f.verification] || 0) + 1, o), {})).sort()),
    gateStatus: Object.fromEntries(Object.entries(routes.reduce((o, r) => (o[r.gateStatus] = (o[r.gateStatus] || 0) + 1, o), {})).sort()),
    resolvedUncertainties: familyDocs.reduce((n, f) => n + f.resolved.length, 0),
  };

  return {
    inventory: {
      schemaVersion: 1,
      sourceCommit: scan.gitHead,
      scope: '2.0 Next 앱(src/) 전체 — 페이지·API·크론·서버 액션·기능 모듈·내비·탭·권한 키·DB 엔티티',
      method: {
        scan: 'experiments/owner-concept/catalog/scan-source.mjs (TS AST + 정규식, 읽기 전용)',
        curation: 'experiments/owner-concept/catalog/families.mjs (감사자 큐레이션 — 패밀리·핵심 동작·AX 갭)',
        db: 'experiments/owner-concept/catalog/db-availability.mjs (로컬 복사본 읽기 전용 트랜잭션 행 수)',
        verifier: 'experiments/owner-concept/catalog/verify-catalog.mjs',
      },
      legend: {
        implementation: { implemented: '2.0에서 동작', partial: '일부 꺼짐·시안·자리만·데모 데이터', absent: '2.0에 없음' },
        axLevel: { absent: '시안 어디에도 없음', 'read-only': '복사본 데이터 조회만', simulated: '세션 메모리 흉내 동작까지(실제 쓰기 없음)' },
        verification: { 'source-read': '감사자가 파일 본문을 직접 읽음', reviewed: '감사자가 머리 주석·제목·게이트·액션 export 다이제스트를 확인', auto: '기계 추출만' },
        routeClass: routeClassRules,
      },
      counts,
      prototype: proto,
      roles: scan.roles,
      families: familyDocs,
      gapMatrix,
      routes, apiRoutes: apis, crons, featureModules: modules, serverActions: actions, menuKeys, navigation, catalogs,
      dbEntities: { public: entities, nonPublic, codeTablesMissingInDb, database: db ? { readAt: db.readAt, totals: db.totals, tenant: db.tenant } : null },
      uncertainties: {
        family: familyDocs.flatMap(f => f.uncertainties.map(u => ({ family: f.id, issue: u }))),
        resolvedBySourceRead: familyDocs.flatMap(f => f.resolved.map(u => ({ family: f.id, issue: u }))),
        autoDetected: autoUncertain,
        notes,
      },
    },
    problems,
  };
}
