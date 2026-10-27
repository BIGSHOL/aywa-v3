// 서버 액션 export 추적표 생성기 — catalog/operation-coverage.json.
// 실행: node experiments/owner-concept/catalog/build-operation-coverage.mjs  (문제가 하나라도 있으면 쓰지 않고 실패)
// export마다: 패밀리 · 묶음(핵심 동작 / 새로 찾은 묶음 / 보기 설정) · 종류(mutation·read·helper) · 2.0 효과 · 게이트 · 표·RPC · 외부 연동 ·
// 알림 종류 · 검토 수준 · 3.0 목적지(카탈로그 동작·화면 면·화면 상태·감사 전용) · 줄 근거. 실제 운영 연결은 0이다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { families } from './families.mjs';
import { analyzeExport, kindOf, effectsOf } from './operation-analysis.mjs';
import { ATTACH, DISCOVERED, VIEW_PREFS, KIND_OVERRIDES, BODY_READ } from './operation-groups.mjs';
import { buildWorkspaceCatalog } from './build-workspace-catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const operationCoveragePath = join(here, 'operation-coverage.json');

/** 3.0에서 그 묶음이 어떻게 다뤄지는가 — 카탈로그 동작의 mode에서 나온다. */
const RUNTIME = { navigate: 'read-preview', preview: 'local-preview', request: 'manual-request' };
export const REVIEW_LEVELS = {
  'body-read': '이번 검토에서 함수 본문을 처음부터 끝까지 직접 읽음',
  'key-action': '패밀리 핵심 동작으로 묶인 함수 — 패밀리 원문 검토(대표 줄)와 기계 추적',
  'digest-reviewed': '기계 추적 요약(문서 주석·게이트·쓰는 표·외부 연동·사용자 사유 문구)을 사람이 읽고 묶음',
};

export function buildOperationCoverage({ inventoryText = readFileSync(join(here, 'feature-inventory.json'), 'utf8'), catalog = buildWorkspaceCatalog({ inventoryText }).catalog } = {}) {
  const problems = [];
  const inventory = JSON.parse(inventoryText);
  const famById = Object.fromEntries(families.map(f => [f.id, f]));
  const invFam = Object.fromEntries(inventory.families.map(f => [f.id, f]));
  const keyOpById = new Map(families.flatMap(f => f.keyOps.map(o => [o.id, { ...o, family: f.id }])));
  const sameFamily = new Map(), byName = new Map();
  for (const f of families) for (const o of f.keyOps) for (const fn of o.fns) {
    sameFamily.set(`${f.id}|${fn}`, o.id);
    (byName.get(fn) || byName.set(fn, []).get(fn)).push(o.id);
  }
  const attach = new Map();
  for (const [opId, names] of Object.entries(ATTACH)) {
    if (!keyOpById.has(opId)) problems.push(`ATTACH: 없는 핵심 동작 ${opId}`);
    for (const n of names) {
      if (attach.has(n)) problems.push(`ATTACH: ${n}이 두 번 붙음`);
      attach.set(n, opId);
    }
  }
  const discoveredBy = new Map();
  for (const g of DISCOVERED) for (const n of g.fns) {
    const k = `${g.family}|${n}`;
    if (discoveredBy.has(k)) problems.push(`DISCOVERED: ${k}이 두 묶음에 있음`);
    discoveredBy.set(k, g);
  }
  const viewBy = new Map();
  for (const [fam, names] of Object.entries(VIEW_PREFS)) {
    if (!famById[fam]) problems.push(`VIEW_PREFS: 없는 패밀리 ${fam}`);
    for (const n of names) viewBy.set(`${fam}|${n}`, `${fam}.view-prefs`);
  }
  const bodyRead = new Set(BODY_READ);
  const catalogActions = new Map(catalog.areas.flatMap(a => a.actions.map(x => [x.id, { ...x, area: a.id }])));
  const destinations = catalog.coverage.operationDestinations;
  const facets = catalog.coverage.operationFacets || {};

  // ── export 하나하나 ──
  const exportsOut = [];
  const seenKeys = new Set();
  for (const s of inventory.serverActions) for (const e of s.exports) {
    const key = `${s.family}|${e.name}`;
    if (seenKeys.has(key)) problems.push(`같은 패밀리에 같은 이름의 export가 둘: ${key}`);
    seenKeys.add(key);
    const a = analyzeExport(s.file, e.name);
    if (!a.found) { problems.push(`본문을 찾지 못함: ${s.file}#${e.name}`); continue; }
    let groupId, groupSource;
    if (sameFamily.has(key)) [groupId, groupSource] = [sameFamily.get(key), 'key-op'];
    else if (byName.get(e.name)?.length === 1) [groupId, groupSource] = [byName.get(e.name)[0], 'key-op-cross-family'];
    else if (attach.has(e.name)) [groupId, groupSource] = [attach.get(e.name), 'key-op-attached'];
    else if (discoveredBy.has(key)) [groupId, groupSource] = [discoveredBy.get(key).id, 'discovered'];
    else if (viewBy.has(key)) [groupId, groupSource] = [viewBy.get(key), 'view-prefs'];
    else { problems.push(`묶음이 없는 export: ${key} (${s.file}:${a.line})`); continue; }
    if (byName.get(e.name)?.length > 1 && !sameFamily.has(key)) problems.push(`이름이 여러 핵심 동작에 걸림: ${key}`);
    const machineKind = kindOf(a);
    const override = KIND_OVERRIDES[key];
    const kind = override ? override.kind : machineKind;
    const review = bodyRead.has(key) ? 'body-read' : groupSource.startsWith('key-op') && groupSource !== 'key-op-attached' ? 'key-action' : 'digest-reviewed';
    exportsOut.push({
      family: s.family, file: s.file, line: a.line, name: e.name, group: groupId, groupSource,
      kind, ...(override ? { machineKind, kindReason: override.reason } : {}),
      effects: effectsOf(a), gates: a.gates, tablesWrite: a.tablesWrite, tablesRead: a.tablesRead, rpcsWrite: a.rpcsWrite, rpcsRead: a.rpcsRead,
      storage: a.storage, external: a.external, audit: a.audit, notificationTypes: a.notificationTypes,
      bodyLines: a.bodyLines, helpersTraced: a.helpers.length, review,
      evidence: { decl: a.evidence.decl, ...(a.evidence.gate ? { gate: a.evidence.gate } : {}), ...(a.evidence.write ? { write: a.evidence.write } : {}) },
    });
  }
  for (const k of Object.keys(KIND_OVERRIDES)) if (!seenKeys.has(k)) problems.push(`KIND_OVERRIDES: 없는 export ${k}`);
  for (const k of bodyRead) if (!seenKeys.has(k)) problems.push(`BODY_READ: 없는 export ${k}`);
  for (const [k] of discoveredBy) if (!seenKeys.has(k)) problems.push(`DISCOVERED: 없는 export ${k}`);
  for (const [k] of viewBy) if (!seenKeys.has(k)) problems.push(`VIEW_PREFS: 없는 export ${k}`);
  for (const [n, op] of attach) if (!exportsOut.some(x => x.name === n && x.group === op)) problems.push(`ATTACH: ${n}이 ${op}에 붙지 않았다(다른 규칙이 먼저 잡았거나 없는 export)`);
  // 보기 설정 묶음은 users(ui_prefs) 말고는 쓰지 않아야 한다 — 다른 표를 쓰면 보기 설정이 아니다
  for (const x of exportsOut) if (x.groupSource === 'view-prefs' && (x.tablesWrite.some(t => t !== 'users') || x.rpcsWrite.length || x.external.length || x.effects.includes('notify')))
    problems.push(`보기 설정으로 묶었는데 다른 것을 쓴다: ${x.family}|${x.name} (${x.tablesWrite.join(',')})`);

  // ── 묶음 ──
  const groupIds = [...new Set(exportsOut.map(x => x.group))];
  const groups = groupIds.map(id => {
    const members = exportsOut.filter(x => x.group === id);
    const fam = id.slice(0, id.indexOf('.'));
    const disc = DISCOVERED.find(g => g.id === id);
    const source = keyOpById.has(id) ? 'key-op' : disc ? 'discovered' : 'view-prefs';
    const label = keyOpById.get(id)?.op || disc?.label || `${invFam[fam]?.label ?? fam} — 개인 보기 설정(정렬·필터·접힘·보기 방식)`;
    let destination;
    if (!famById[fam]?.ownerVisible) destination = { type: 'audit-only', runtime: 'audit-only', reason: famById[fam]?.auditOnlyReason ?? '' };
    else if (source === 'view-prefs') destination = { type: 'ui', runtime: 'ui-state', reason: '개인 보기 설정 — 3.0 화면이 스스로 상태를 들고 있어 2.0 계정 설정 쓰기가 필요 없다' };
    else if (disc?.dest.ui) destination = { type: 'ui', runtime: 'ui-state', reason: disc.dest.ui };
    else if (disc?.dest.facet) destination = { type: 'facet', runtime: 'read-preview', ...facets[id] };
    else {
      const acts = destinations[id] || [];
      if (!acts.length) problems.push(`목적지 없는 원장 표시 묶음: ${id}`);
      const modes = [...new Set(acts.map(a => catalogActions.get(a)?.mode).filter(Boolean))];
      destination = { type: 'action', actions: acts, runtime: modes.map(m => RUNTIME[m]).sort().join('+') || 'none', pages: [...new Set(acts.map(a => `workspace-${catalogActions.get(a)?.area}`))] };
    }
    if (destination.type === 'facet' && !destination.page) problems.push(`화면 면 목적지를 카탈로그에서 찾지 못함: ${id}`);
    const kinds = members.reduce((o, x) => (o[x.kind] = (o[x.kind] || 0) + 1, o), {});
    const effects = [...new Set(members.flatMap(x => x.effects))].sort();
    if (disc && destination.type === 'facet' && kinds.mutation && !disc.note) problems.push(`쓰기가 있는데 읽기 화면 면만 목적지인 묶음은 이유(note)가 필요: ${id}`);
    return { id, family: fam, label, source, exports: members.length, kinds, effects, destination, productionLinked: false, ...(disc?.note ? { note: disc.note } : {}) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  // 원장 표시 패밀리의 핵심 동작은 export가 없어도(페이지·API·크론 동작) 카탈로그 목적지가 있어야 한다 — 여기서는 export 묶음만 본다.

  const count = (arr, f) => arr.reduce((o, x) => { for (const k of [].concat(f(x))) o[k] = (o[k] || 0) + 1; return o; }, {});
  const ownerFacing = groups.filter(g => famById[g.family]?.ownerVisible && g.destination.type !== 'ui');
  const counts = {
    exports: exportsOut.length, files: inventory.serverActions.length, families: new Set(exportsOut.map(x => x.family)).size,
    inventoryServerActionExports: inventory.counts.serverActionExports,
    byKind: count(exportsOut, x => x.kind), byMachineKind: count(exportsOut, x => x.machineKind || x.kind), kindOverrides: Object.keys(KIND_OVERRIDES).length,
    effects: count(exportsOut, x => x.effects), review: count(exportsOut, x => x.review), groupSource: count(exportsOut, x => x.groupSource),
    groups: groups.length, groupsBySource: count(groups, g => g.source), discoveredGroups: DISCOVERED.length,
    destinations: count(groups, g => g.destination.type), runtime: count(groups, g => g.destination.runtime),
    ownerFacingGroups: ownerFacing.length, ownerFacingReachable: ownerFacing.filter(g => g.destination.type === 'facet' ? !!g.destination.page : (g.destination.actions || []).length > 0).length,
    mutationExports: exportsOut.filter(x => x.kind === 'mutation').length,
    mutationExportsWithDestination: exportsOut.filter(x => x.kind === 'mutation' && groups.find(g => g.id === x.group)?.destination.type).length,
    productionLinkedWrites: 0,
  };
  if (counts.exports !== counts.inventoryServerActionExports) problems.push(`export 수가 인벤토리와 다르다: ${counts.exports} ≠ ${counts.inventoryServerActionExports}`);
  return {
    coverage: {
      schemaVersion: 1,
      source: { inventorySha256: createHash('sha256').update(inventoryText.replace(/\r\n/g, '\n')).digest('hex'), sourceCommit: inventory.sourceCommit },
      method: {
        machine: 'TS AST — export 본문과 거기서 부르는 저장소 안 도우미(같은 파일·import 모듈, 깊이 4, 인증·감사·알림·AI·Supabase 기반 모듈에서는 멈춤)를 따라가며 게이트·표 읽기/쓰기(.from 사슬, 문자열 상수 해석)·RPC(마이그레이션 정의 본문으로 쓰기 판정)·스토리지·쿠키·fetch(메서드)·외부 SDK·감사로그·알림 종류를 줄 근거와 함께 모은다.',
        limits: ['경로를 가리지 않는다 — 플래그로 꺼진 갈래의 쓰기도 잡혀 과대 추정될 수 있다(사람 검토로 고친 것은 kindOverrides).', '동적 표 이름·함수 인자로 넘긴 콜백·깊이 4 밖은 놓칠 수 있다.', '실행 시험이 아니다 — 외부 연동·DB 쓰기는 하나도 실행하지 않았다.'],
        reviewLevels: REVIEW_LEVELS,
        runtime: { 'read-preview': '3.0에서 화면 이동·근거 보기로만', 'local-preview': '3.0 로컬 양식·계산 미리보기(저장 없음)', 'manual-request': '사람에게 보내는 요청 초안 — 실제 처리는 2.0에서 사람이', 'ui-state': '3.0 화면 상태', 'audit-only': '감사 전용 패밀리' },
      },
      counts, groups, exports: exportsOut,
    },
    problems,
  };
}

/** 사람이 diff로 읽기 좋게 — 묶음·export는 한 줄에 하나. */
export function renderCoverage(coverage) {
  const { groups, exports, ...rest } = coverage;
  const lines = arr => '[\n' + arr.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n ]';
  return JSON.stringify({ ...rest, groups: '@@GROUPS@@', exports: '@@EXPORTS@@' }, null, 1)
    .replace('"@@GROUPS@@"', () => lines(groups)).replace('"@@EXPORTS@@"', () => lines(exports)) + '\n';
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { coverage, problems } = buildOperationCoverage();
  if (problems.length) {
    console.error(`추적표 문제 ${problems.length}건 — 쓰지 않는다.`);
    for (const p of problems) console.error(' -', p);
    process.exit(1);
  }
  writeFileSync(operationCoveragePath, renderCoverage(coverage));
  console.log(JSON.stringify({ wrote: 'catalog/operation-coverage.json', counts: coverage.counts }));
}
