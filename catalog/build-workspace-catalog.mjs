// 브라우저용 원장 작업 공간 카탈로그(window.AxCatalog) 생성기.
// 입력 = workspace-areas.mjs(큐레이션) + families.mjs(패밀리·핵심 동작 ID) + option-sources.mjs(2.0 열거값) + 소스 스캔(라우트).
// 출력 = ../workspace-catalog.js(브라우저) + workspace-catalog.json(같은 데이터, node 소비자용). 문제가 1건이라도 있으면 쓰지 않는다.
// 브라우저로 나가는 데이터에는 파일 경로·원문 근거·내부 역할 이름을 싣지 않는다(근거는 이 생성기와 검증기만 본다).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AREAS, AREA_GROUPS } from './workspace-areas.mjs';
import { families } from './families.mjs';
import { extractOptions, OPTION_SOURCES } from './option-sources.mjs';
import { repoRoot } from './scan-source.mjs';
import { DISCOVERED } from './operation-groups.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const catalogJsPath = join(here, '..', 'workspace-catalog.js');
export const catalogJsonPath = join(here, 'workspace-catalog.json');

export const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'month', 'time', 'select', 'multiselect', 'checkbox', 'student', 'staff', 'class', 'subject'];
export const VIEW_KINDS = ['flow', 'sheet', 'records', 'report', 'settings', 'timeline'];
export const MODES = ['request', 'preview', 'navigate'];
// 기존 시안 화면(live.js 13 + ax.js 4) — navigate가 이 화면으로 갈 수 있다.
const LEGACY_PAGES = ['home', 'students', 'admissions', 'classes', 'learning', 'finance', 'staff', 'parents', 'shuttle', 'approvals', 'resources', 'calendar', 'settings', 'inbox', 'requests', 'automation'];

/** 화면에 보이는 문구에 넣지 않는 말 — 플랫폼 내부 역할·원시 역할 키·내부 구현 용어. */
export const BANNED_VISIBLE = [/super[_ ]?admin/i, /슈퍼관리자/, /슈퍼어드민/, /총괄/, /\bsystemRole\b/, /\b(master|admin|manager|teacher|counselor|accountant|viewer)\b/, /\bsrc\//, /\.(tsx?|mjs)\b/, /server action/i, /requireAccess|canWriteTenant/];
/** 카탈로그 파일 전체(메타 포함)에 들어가면 안 되는 것 — 비밀·식별자. */
export const BANNED_ANYWHERE = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /Bearer\s/i, /\b(CRON_SECRET|SERVICE_ROLE|API_KEY|_SECRET|_TOKEN)\b/, /postgres(ql)?:\/\//i, /sk-[A-Za-z0-9]{8,}/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, /\b01[016789]-?\d{3,4}-?\d{4}\b/, /\bsrc\//, /\bC:\\|\bD:\\|\bF:\\/];

// 2.0 열거값은 읽기만 하고, 3.0 카탈로그의 화면 표기만 바로잡는다.
export const displayOptions = (id, options) => options.map(option => ({
  ...option,
  label: id === 'assetStatus' ? ({ in_use: '사용 중', on_loan: '대여 중', repair: '수리 중' }[option.value] || option.label)
    : id === 'staffTaskFilter' ? ({ open: '미처리', late: '기한 초과', closed: '처리 완료' }[option.value] || option.label)
    : id === 'withdrawalReason' && option.value === 'motivation' ? '원생 상태'
    : id === 'consultationAudience' ? ({ student: '원생', both: '학부모+원생' }[option.value] || option.label)
    : id === 'slackCategory' && option.value === 'consult' ? '신규 콜&상담·원생상담'
    : id === 'integrationSub' && option.value === 'makeedu' ? '메이크에듀 동기화' : option.label,
}));

function fileHas(file, has) {
  const p = join(repoRoot, file);
  return existsSync(p) && readFileSync(p, 'utf8').includes(has);
}
const scanPages = () => JSON.parse(readFileSync(join(here, 'generated', 'source-scan.json'), 'utf8')).pages.map(p => p.url);

export function buildWorkspaceCatalog({ pages = scanPages(), inventoryText = readFileSync(join(here, 'feature-inventory.json'), 'utf8') } = {}) {
  const problems = [];
  const inventory = JSON.parse(inventoryText);
  const famById = Object.fromEntries(families.map(f => [f.id, f]));
  const visible = families.filter(f => f.ownerVisible);
  const groupLabel = Object.fromEntries(AREA_GROUPS.map(g => [g.id, g.label]));
  const optionCache = {};
  const optionsOf = id => (optionCache[id] ||= displayOptions(id, extractOptions(id)));

  // 영역 ↔ 원장 표시 패밀리 일대일
  for (const f of visible) if (!AREAS.some(a => a.id === f.id)) problems.push(`원장 표시 패밀리에 영역이 없음: ${f.id}`);
  for (const a of AREAS) {
    if (!famById[a.id]) problems.push(`영역 id가 패밀리가 아님: ${a.id}`);
    else if (!famById[a.id].ownerVisible) problems.push(`감사 전용 패밀리를 영역으로 만들었음: ${a.id}`);
  }
  const areaIds = new Set(AREAS.map(a => a.id));
  if (areaIds.size !== AREAS.length) problems.push('영역 id 중복');

  // 새로 찾은 동작 묶음(operation-groups.mjs) — 핵심 동작과 같은 id 공간. 동작 목적지는 그 동작의 sourceOperationIds에 더한다.
  const discoveredById = Object.fromEntries(DISCOVERED.map(g => [g.id, g]));
  const knownOp = id => famById[id.slice(0, id.indexOf('.'))]?.keyOps.some(o => o.id === id) || !!discoveredById[id];
  const extraOps = new Map();
  for (const g of DISCOVERED) if (g.dest.action) (extraOps.get(g.dest.action) || extraOps.set(g.dest.action, []).get(g.dest.action)).push(g.id);
  const covered = new Map();
  const actionIds = new Set();
  const drafts = new Set();
  const outAreas = AREAS.map(a => {
    const fam = famById[a.id];
    if (!groupLabel[a.group]) problems.push(`${a.id}: 없는 그룹 ${a.group}`);
    if (!VIEW_KINDS.includes(a.viewKind)) problems.push(`${a.id}: viewKind 오류 ${a.viewKind}`);
    if (!a.summary) problems.push(`${a.id}: 요약 없음`);
    if (!a.label) problems.push(`${a.id}: 영역 이름 없음`);
    const facetIds = new Set();
    for (const fc of a.facets) {
      if (facetIds.has(fc.id)) problems.push(`${a.id}: facet id 중복 ${fc.id}`);
      facetIds.add(fc.id);
      if (fc.ref.route && !pages.includes(fc.ref.route)) problems.push(`${a.id}.${fc.id}: 없는 라우트 ${fc.ref.route}`);
      if (fc.ref.file && !fileHas(fc.ref.file, fc.ref.has)) problems.push(`${a.id}.${fc.id}: ${fc.ref.file}에 "${fc.ref.has}" 없음`);
      if (!fc.ref.route && !fc.ref.file) problems.push(`${a.id}.${fc.id}: 원문 근거 없음`);
    }
    const actions = a.actions.map(act => {
      if (!act.id.startsWith(`${a.id}.`)) problems.push(`${act.id}: 영역 접두사가 아님`);
      if (actionIds.has(act.id)) problems.push(`action id 중복 ${act.id}`);
      actionIds.add(act.id);
      if (!MODES.includes(act.mode)) problems.push(`${act.id}: mode 오류`);
      if (!act.draft?.title || !act.draft?.body) problems.push(`${act.id}: 초안 제목·본문 없음`);
      const key = `${act.draft.title}|${act.draft.body}`;
      if (drafts.has(key)) problems.push(`${act.id}: 다른 동작과 같은 초안`);
      drafts.add(key);
      const listed = act.ops.map(op => (op.includes('.') ? op : `${a.id}.${op}`));
      const sourceOperationIds = [...listed, ...(extraOps.get(act.id) || []).filter(id => !listed.includes(id))];
      for (const id of sourceOperationIds) {
        if (!knownOp(id)) problems.push(`${act.id}: 없는 핵심 동작·동작 묶음 ${id}`);
        (covered.get(id) || covered.set(id, []).get(id)).push(act.id);
      }
      let target;
      if (act.mode === 'navigate') {
        const page = act.target.page ?? `workspace-${a.id}`;
        const facet = act.target.facet ?? null;
        if (page.startsWith('workspace-')) {
          const ta = AREAS.find(x => `workspace-${x.id}` === page);
          if (!ta) problems.push(`${act.id}: 없는 영역 ${page}`);
          else if (facet && !ta.facets.some(x => x.id === facet)) problems.push(`${act.id}: ${page}에 없는 facet ${facet}`);
        } else if (!LEGACY_PAGES.includes(page)) problems.push(`${act.id}: 없는 시안 화면 ${page}`);
        target = facet ? { page, facet } : { page };
      }
      const fields = act.fields.map(fd => {
        if (!FIELD_TYPES.includes(fd.type)) problems.push(`${act.id}.${fd.id}: 필드 type 오류 ${fd.type}`);
        const out = { id: fd.id, label: fd.label, type: fd.type };
        if (fd.required) out.required = true;
        if (fd.min !== undefined) out.min = fd.min;
        if (fd.max !== undefined) out.max = fd.max;
        if (fd.optionsFrom) {
          if (!OPTION_SOURCES[fd.optionsFrom]) problems.push(`${act.id}.${fd.id}: 없는 선택지 출처 ${fd.optionsFrom}`);
          else {
            let opts = optionsOf(fd.optionsFrom);
            if (fd.only) {
              for (const v of fd.only) if (!opts.some(o => o.value === v)) problems.push(`${act.id}.${fd.id}: ${fd.optionsFrom}에 없는 값 ${v}`);
              opts = opts.filter(o => fd.only.includes(o.value));
            }
            out.options = opts;
            out.optionSource = fd.optionsFrom;
          }
        } else if (fd.options) {
          if (!fd.evidence) problems.push(`${act.id}.${fd.id}: 직접 적은 선택지에 원문 근거가 없음`);
          else for (const ev of [].concat(fd.evidence)) for (const h of ev.has) if (!fileHas(ev.file, h)) problems.push(`${act.id}.${fd.id}: ${ev.file}에 "${h}" 없음`);
          out.options = fd.options;
          out.optionSource = 'inline-verified';
        }
        if ((fd.type === 'select' || fd.type === 'multiselect') && !out.options?.length) problems.push(`${act.id}.${fd.id}: 선택 필드에 선택지가 없음`);
        return out;
      });
      if (act.mode !== 'navigate' && !fields.length && act.mode === 'request') problems.push(`${act.id}: 요청 초안에 맥락 필드가 없음`);
      return {
        id: act.id, label: act.label, mode: act.mode, ...(target ? { target } : {}),
        draft: { title: act.draft.title, body: act.draft.body }, fields,
        result: { label: act.result, liveWrite: false }, sourceOperationIds,
      };
    });
    return {
      id: a.id, label: a.label, group: groupLabel[a.group], groupId: a.group,
      page: `workspace-${a.id}`, summary: a.summary, viewKind: a.viewKind,
      facets: a.facets.map(fc => ({ id: fc.id, label: fc.label, kind: fc.kind })),
      actions, relations: [a.id, ...new Set(actions.flatMap(x => x.sourceOperationIds.map(id => id.slice(0, id.indexOf('.')))).filter(id => id !== a.id))],
      meta: { ownerScope: fam?.ownerScope, priority: fam?.ax.priority, sourceRoutes: inventory.families.find(x => x.id === a.id)?.routes.length ?? 0, operations: fam?.keyOps.length ?? 0, operationIds: fam?.keyOps.map(o => o.id) ?? [] },
    };
  });

  // 원장 표시 패밀리의 모든 핵심 동작이 어느 동작엔가 이어졌는가
  for (const f of visible) for (const op of f.keyOps) if (!covered.has(op.id)) problems.push(`목적지 없는 핵심 동작: ${op.id} (${op.op})`);
  // 새로 찾은 동작 묶음의 목적지 — 동작은 실제로 있어야 하고, 화면 면은 그 영역에 있어야 한다
  const operationFacets = {};
  for (const g of DISCOVERED) {
    if (!famById[g.family]) problems.push(`${g.id}: 없는 패밀리 ${g.family}`);
    if (!g.id.startsWith(`${g.family}.`)) problems.push(`${g.id}: 패밀리 접두사가 아님`);
    if (famById[g.family]?.keyOps.some(o => o.id === g.id)) problems.push(`${g.id}: 핵심 동작 id와 겹침`);
    const kinds = ['action', 'facet', 'ui'].filter(k => g.dest[k]);
    if (kinds.length !== 1) problems.push(`${g.id}: 목적지는 action·facet·ui 중 하나`);
    if (g.dest.action && !actionIds.has(g.dest.action)) problems.push(`${g.id}: 없는 카탈로그 동작 ${g.dest.action}`);
    if (g.dest.facet) {
      const [areaId, facetId] = g.dest.facet.split('/');
      const area = AREAS.find(x => x.id === areaId);
      if (!area || !area.facets.some(x => x.id === facetId)) problems.push(`${g.id}: 없는 화면 면 ${g.dest.facet}`);
      else operationFacets[g.id] = { page: `workspace-${areaId}`, facet: facetId };
    }
  }

  // 화면 문구 검사
  const visibleStrings = [];
  for (const a of outAreas) {
    visibleStrings.push([a.id, a.label], [a.id, a.group], [a.id, a.summary]);
    for (const fc of a.facets) visibleStrings.push([`${a.id}.${fc.id}`, fc.label]);
    for (const act of a.actions) {
      visibleStrings.push([act.id, act.label], [act.id, act.draft.title], [act.id, act.draft.body], [act.id, act.result.label]);
      for (const fd of act.fields) { visibleStrings.push([`${act.id}.${fd.id}`, fd.label]); for (const o of fd.options || []) visibleStrings.push([`${act.id}.${fd.id}`, o.label]); }
    }
  }
  for (const g of AREA_GROUPS) visibleStrings.push([g.id, g.label]);
  for (const [where, s] of visibleStrings) for (const re of BANNED_VISIBLE) if (re.test(s)) problems.push(`화면 문구에 금지어(${re}): ${where} "${s}"`);

  // 감사 전용 패밀리는 브라우저에 중립 id와 개수만 싣는다(라벨·이유는 감사 산출물에만 — 내부 역할 이름이 섞이지 않게).
  const auditOnly = { count: families.filter(f => !f.ownerVisible).length, ids: families.filter(f => !f.ownerVisible).map(f => f.id) };
  const modes = outAreas.flatMap(a => a.actions).reduce((o, x) => (o[x.mode] = (o[x.mode] || 0) + 1, o), {});
  const catalog = {
    schemaVersion: 1,
    source: { inventorySha256: createHash('sha256').update(inventoryText.replace(/\r\n/g, '\n')).digest('hex'), sourceCommit: inventory.sourceCommit },
    liveWrites: false,
    fieldTypes: FIELD_TYPES,
    groups: AREA_GROUPS.map(g => ({ id: g.id, label: g.label })),
    areas: outAreas,
    auditOnly,
    coverage: {
      ownerVisibleFamilies: visible.length, auditOnlyFamilies: auditOnly.count, areas: outAreas.length,
      facets: outAreas.reduce((n, a) => n + a.facets.length, 0), actions: outAreas.reduce((n, a) => n + a.actions.length, 0), actionsByMode: modes,
      ownerVisibleOperations: visible.reduce((n, f) => n + f.keyOps.length, 0), operationsWithDestination: [...covered.keys()].filter(id => visible.some(f => f.keyOps.some(o => o.id === id))).length,
      productionLinkedWrites: 0,
      discoveredGroups: DISCOVERED.length,
      operationDestinations: Object.fromEntries([...covered.entries()].sort()),
      operationFacets: Object.fromEntries(Object.entries(operationFacets).sort()),
    },
  };
  for (const re of BANNED_ANYWHERE) { const m = JSON.stringify(catalog).match(re); if (m) problems.push(`카탈로그에 비밀·식별자 모양(${re}): "${m[0]}"`); }
  return { catalog, problems };
}

export function renderCatalogJs(catalog) {
  const json = JSON.stringify(catalog, null, 1).replaceAll('<', '\\u003c');
  return `/* 생성 파일 — experiments/owner-concept/catalog/build-workspace-catalog.mjs가 만든다. 손으로 고치지 말 것.
   2.0 감사 인벤토리에서 파생한 원장 작업 공간 카탈로그. 모든 동작은 로컬 미리보기·요청 초안이며 실제 쓰기·발송은 없다(liveWrites: false). */
window.AxCatalog = ${json};
window.dispatchEvent(new Event('ax-catalog'));
`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { catalog, problems } = buildWorkspaceCatalog();
  if (problems.length) {
    console.error(`카탈로그 문제 ${problems.length}건 — 쓰지 않는다.`);
    for (const p of problems) console.error(' -', p);
    process.exit(1);
  }
  writeFileSync(catalogJsPath, renderCatalogJs(catalog));
  writeFileSync(catalogJsonPath, JSON.stringify(catalog, null, 1) + '\n');
  console.log(JSON.stringify({ wrote: ['workspace-catalog.js', 'catalog/workspace-catalog.json'], coverage: { ...catalog.coverage, operationDestinations: undefined } }));
}
