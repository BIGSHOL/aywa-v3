// 인벤토리 조립 핵심 — build-inventory.mjs(생성)와 verify-catalog.mjs(검증)가 같은 판정을 쓴다.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { families, routeClassRules, verifiedGates } from './families.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const catalogDir = here;
export const conceptDir = join(here, '..');

/** url이 접두사 p에 속하는가(정확 일치 또는 하위 경로). */
export const under = (url, p) => url === p || (p !== '/' && url.startsWith(p + '/'));

/** 가장 긴 접두사로 패밀리를 고른다. 없으면 null. */
export function familyByPrefix(url, field) {
  let best = null, len = -1;
  for (const f of families) for (const p of f[field] || []) if (under(url, p) && p.length > len) { best = f.id; len = p.length; }
  return best;
}

/** Next 동적 세그먼트를 포함한 페이지 패턴이 경로와 맞는가. */
export function patternMatches(pattern, path) {
  const a = pattern.split('/').filter(Boolean), b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((s, i) => /^\[.+\]$/.test(s) || s === b[i]);
}

/** 시안 13개 화면·AX 4개 화면·AX 이슈 7종·스냅샷 입력 테이블을 시안 소스에서 그대로 읽는다. */
export async function readPrototype() {
  const live = readFileSync(join(conceptDir, 'live.js'), 'utf8');
  const ax = readFileSync(join(conceptDir, 'ax.js'), 'utf8');
  const lines = live.split('\n');
  const pagesLine = lines.findIndex(l => l.includes('const pages=['));
  const legacyViews = [...lines[pagesLine].matchAll(/\['([a-z]+)','([^']+)','([a-z]+)'(?:,'([^']+)')?\]/g)].map(m => ({ id: m[1], label: m[2], icon: m[3], group: m[4] || null, source: `experiments/owner-concept/live.js:${pagesLine + 1}` }));
  const axLines = ax.split('\n');
  const labelsLine = axLines.findIndex(l => l.includes('const labels={'));
  const axLabels = Object.fromEntries([...axLines[labelsLine].matchAll(/([a-z]+):'([^']+)'/g)].map(m => [m[1], m[2]]));
  // AX 화면 = createOwnerWorkspace가 돌려주는 뷰 함수(decorate* 제외), 라벨 = 사이드바 link('id','라벨').
  const retLine = axLines.findIndex(l => /^\s*return \{[a-zA-Z,]+\};\s*$/.test(l) && l.includes('decorateShell'));
  const viewIds = axLines[retLine].match(/\{([^}]+)\}/)[1].split(',').map(s => s.trim()).filter(s => s && !s.startsWith('decorate'));
  const navLine = axLines.findIndex(l => l.includes("link('home',"));
  const navLabels = Object.fromEntries([...axLines[navLine].matchAll(/link\('([a-z]+)','([^']+)'/g)].map(m => [m[1], m[2]]));
  const axViews = viewIds.map(id => ({ id, label: navLabels[id] || axLabels[id] || id, source: `experiments/owner-concept/ax.js:${retLine + 1}` }));
  const axIssues = [];
  axLines.forEach((l, i) => { const m = l.match(/\{id:'([a-z]+)',category:'([^']+)',title:`([^`$]*)/); if (m) axIssues.push({ id: m[1], category: m[2], titlePrefix: m[3].trim(), source: `experiments/owner-concept/ax.js:${i + 1}` }); });
  // 시안의 동작 맵: `'new-lead':()=>`(하이픈 키)와 `approve:()=>`(한 단어 키) 둘 다.
  const liveActions = [...new Set([...live.matchAll(/'([a-z]+(?:-[a-z]+)+)':\(\)=>|[{,]\s*([a-z]+):\(\)=>/g)].map(m => m[1] || m[2]))].sort();
  const { snapshotTables } = await import(pathToFileURL(join(conceptDir, 'snapshot-tables.mjs')).href);
  // ax.js의 클릭 동작(action==='…')과 폼(data-ax-form="…") — 'ax:' 접두사로 구분한다.
  const axActions = [...new Set([...ax.matchAll(/action==='([a-z-]+)'/g)].map(m => `ax:${m[1]}`)), ...new Set([...ax.matchAll(/data-ax-form="([a-z-]+)"/g)].map(m => `ax:form:${m[1]}`))].sort();
  // 로컬 dev 비서(/api/assistant) — 허용 이슈 id 목록을 그대로 읽는다(claude-bridge-context.mjs).
  const bridgePath = join(conceptDir, 'claude-bridge-context.mjs');
  const assistantIssueIds = existsSync(bridgePath) ? ((readFileSync(bridgePath, 'utf8').match(/ASSISTANT_ISSUE_IDS = Object\.freeze\(\[([^\]]+)\]/) || [])[1] || '').split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [];
  return {
    legacyViews: legacyViews.map(v => ({ ...v, axLabel: axLabels[v.id] || null })),
    axViews, axIssues,
    sessionOnlyActions: liveActions,
    axActions,
    assistantIssueIds,
    snapshotTables: Object.keys(snapshotTables).sort(),
  };
}

export function readDbAvailability() {
  const p = join(here, 'generated', 'db-availability.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** 소스 파일 경로 → 패밀리(기능 모듈 또는 라우트 기준). 공용 lib·components는 null. */
export function familyOfFile(file, featureOwner) {
  if (file.startsWith('src/features/')) return featureOwner[file.split('/')[2]] || null;
  if (file.startsWith('src/app/')) {
    const segs = file.replace(/^src\/app\//, '').split('/');
    segs.pop();
    const url = '/' + segs.filter(s => !/^\(.*\)$/.test(s) && !s.startsWith('_') && !s.startsWith('@')).join('/');
    return familyByPrefix(url, 'routes') || familyByPrefix(url, 'api');
  }
  return null;
}

/** 내비 항목 href의 상수 이름 → 실제 경로(근거: 각 모듈의 상수 선언). */
export const NAV_CONSTANTS = {
  CLASS_REVIEW_PATH: { value: '/class-review', source: 'src/features/class-review/faces.ts' },
  INVENTORY_PATH: { value: '/inventory', source: 'src/features/inventory/faces.ts' },
  SUPPORT_PATH: { value: '/support', source: 'src/features/support/faces.ts' },
  TEXTBOOKS_PATH: { value: '/textbooks', source: 'src/features/textbooks/faces.ts' },
  SHUTTLE_PARENTS_PATH: { value: '/shuttle/parents', source: 'src/features/shuttle/parent-accounts/parent-access.ts' },
};
/** 다른 목록을 그대로 비추는(파생) 항목 — 원본 목록이 따로 인벤토리에 잡힌다. */
export const DERIVED_NAV = [
  { match: '{t.href}', why: 'SUBTABS_BY_MENU.owner = OWNER_TABS.map(...) — 원본은 src/features/owner/tabs.ts' },
  { match: '{item.href}', why: 'fromMenu()가 NAV_GROUPS 항목을 그대로 복사 — 원본은 src/lib/navigation.ts' },
  { match: '{tab.href}', why: 'billingFace()가 SUBTABS_BY_MENU.billing을 찾아 쓴다 — 원본은 src/lib/navigation.ts' },
  { match: '{f.href}', why: '면 정의 배열을 건수 라벨로 다시 매핑 — 원본은 같은 파일의 *_FACE_DEFS' },
  { match: '${tab.href}?season=${season}', why: 'shuttleFaces = SUBTABS_BY_MENU.shuttle × 시즌 — 원본은 src/lib/navigation.ts' },
  { match: '/owner?tab=sheets&sub=${key}', why: '연동 하위 면 6개(LABEL: slack·makeedu·sheets·video·agent·todaysMath) — integrations-face.tsx:28' },
];
/** 연동 하위 면(파생 항목을 펼친 값) — integrations-face.tsx:28의 LABEL 그대로. */
export const OWNER_SHEETS_SUBS = [
  ['slack', '슬랙'], ['makeedu', 'makeedu 동기화'], ['sheets', '구글 시트'], ['video', '숙제영상 드라이브'], ['agent', '연동 PC'], ['todaysMath', '오늘 수학'],
];

export { families, routeClassRules, verifiedGates };
