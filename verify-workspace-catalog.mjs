// 원장 작업 공간 카탈로그(workspace-catalog.js) 검증기.
// 실행: node experiments/owner-concept/verify-workspace-catalog.mjs  (실패하면 종료 코드 1)
// 확인: 재생성 일치 · 브라우저 실행 · 스키마 · 원장 표시 패밀리/핵심 동작 커버리지 · 선택지가 2.0 열거값과 같은지 ·
//       화면 문구 금지어·비밀 · 정적 서빙 허용 목록과 루프백 바인딩.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildWorkspaceCatalog, renderCatalogJs, catalogJsPath, catalogJsonPath, FIELD_TYPES, VIEW_KINDS, MODES, BANNED_VISIBLE, BANNED_ANYWHERE, displayOptions } from './catalog/build-workspace-catalog.mjs';
import { extractOptions } from './catalog/option-sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const checks = [];
const check = (name, failures) => checks.push({ name, ok: failures.length === 0, failures });
const norm = s => s.replace(/\r\n/g, '\n');

// 1) 재생성 — 큐레이션·2.0 소스·인벤토리로 다시 만들어 문제가 없고 커밋된 파일과 같아야 한다.
const { catalog: fresh, problems } = buildWorkspaceCatalog();
check('카탈로그 재생성 문제 0건(목적지·근거·선택지·문구)', problems);
const jsText = readFileSync(catalogJsPath, 'utf8');
check('workspace-catalog.js가 재생성 결과와 같다', norm(jsText) === norm(renderCatalogJs(fresh)) ? [] : ['생성 파일이 낡았다 — node experiments/owner-concept/catalog/build-workspace-catalog.mjs']);
check('catalog/workspace-catalog.json이 같은 데이터다', norm(readFileSync(catalogJsonPath, 'utf8')) === JSON.stringify(fresh, null, 1) + '\n' ? [] : ['JSON 사본이 낡았다']);

// 2) 브라우저 실행 — CSP(script-src self)에서 그대로 도는 순수 스크립트인지
const events = [];
const sandbox = { window: { dispatchEvent: e => events.push(e.type) }, Event: class { constructor(type) { this.type = type; } } };
vm.runInNewContext(jsText, sandbox, { filename: 'workspace-catalog.js' });
const C = sandbox.window.AxCatalog;
check('스크립트가 window.AxCatalog를 만들고 ax-catalog 이벤트를 보낸다', [...(C ? [] : ['AxCatalog 없음']), ...(events.includes('ax-catalog') ? [] : ['이벤트 없음'])]);

// 3) 스키마 — 코디네이터 계약 그대로
const schema = [];
if (C.schemaVersion !== 1) schema.push('schemaVersion');
if (C.liveWrites !== false) schema.push('liveWrites는 false여야 한다');
if (!Array.isArray(C.areas) || !C.areas.length) schema.push('areas 없음');
const pages = new Set(C.areas.map(a => a.page));
const legacy = new Set(['home', 'students', 'admissions', 'classes', 'learning', 'finance', 'staff', 'parents', 'shuttle', 'approvals', 'resources', 'calendar', 'settings', 'inbox', 'requests', 'automation', 'flow']);
for (const a of C.areas) {
  const where = `area ${a.id}`;
  for (const k of ['id', 'label', 'group', 'page', 'summary', 'viewKind']) if (typeof a[k] !== 'string' || !a[k]) schema.push(`${where}.${k}`);
  if (a.page !== `workspace-${a.id}`) schema.push(`${where}.page 규칙`);
  if (!VIEW_KINDS.includes(a.viewKind)) schema.push(`${where}.viewKind`);
  if (!Array.isArray(a.facets) || !a.facets.length) schema.push(`${where}.facets 비어 있음`);
  for (const fc of a.facets || []) if (!fc.id || !fc.label) schema.push(`${where}.facet`);
  if (!Array.isArray(a.relations) || a.relations[0] !== a.id) schema.push(`${where}.relations`);
  if (!Array.isArray(a.actions) || !a.actions.length) schema.push(`${where}.actions 비어 있음`);
  for (const act of a.actions || []) {
    const w = `action ${act.id}`;
    if (!MODES.includes(act.mode)) schema.push(`${w}.mode`);
    if (!act.draft?.title || !act.draft?.body) schema.push(`${w}.draft`);
    if (!Array.isArray(act.fields)) schema.push(`${w}.fields`);
    if (!Array.isArray(act.sourceOperationIds) || !act.sourceOperationIds.length && act.mode !== 'navigate') schema.push(`${w}.sourceOperationIds`);
    if (act.result?.liveWrite !== false) schema.push(`${w}.result.liveWrite`);
    if (act.mode === 'navigate') {
      if (!act.target?.page) schema.push(`${w}.target`);
      else if (!pages.has(act.target.page) && !legacy.has(act.target.page) && !/^v2-[a-z][a-z0-9-]*$/.test(act.target.page)) schema.push(`${w}.target.page ${act.target.page}`);
    } else if (act.target) schema.push(`${w}: navigate가 아닌데 target이 있음`);
    for (const fd of act.fields || []) {
      if (!fd.id || !fd.label || !FIELD_TYPES.includes(fd.type)) schema.push(`${w}.${fd.id} 필드`);
      if ((fd.type === 'select' || fd.type === 'multiselect') && !(fd.options || []).length) schema.push(`${w}.${fd.id} 선택지 없음`);
      for (const o of fd.options || []) if (typeof o.value !== 'string' || typeof o.label !== 'string') schema.push(`${w}.${fd.id} 선택지 모양`);
    }
  }
}
for (const id of ['teacher-workspace', 'parent-portal', 'student-portal', 'public-sites']) {
  if (!C.areas.find(a => a.id === id)?.menuHidden) schema.push(`${id}.menuHidden`);
}
if (C.areas.some(a => a.actions.some(act => act.mode === 'preview'))) schema.push('미리보기 동작이 남음');
check('스키마가 계약과 맞다', schema);

// 4) 커버리지 — 인벤토리의 원장 표시 패밀리·핵심 동작 전부
const inv = JSON.parse(readFileSync(join(here, 'catalog', 'feature-inventory.json'), 'utf8'));
const visible = inv.families.filter(f => f.ownerVisible);
const cov = [];
for (const f of visible) {
  if (!C.areas.some(a => a.id === f.id)) cov.push(`영역 없음 ${f.id}`);
  for (const op of f.operations.key) if (!C.coverage.operationDestinations[op.id]?.length) cov.push(`목적지 없음 ${op.id}`);
}
const auditIds = inv.families.filter(f => !f.ownerVisible).map(f => f.id).sort();
if (JSON.stringify([...C.auditOnly.ids].sort()) !== JSON.stringify(auditIds)) cov.push('auditOnly id가 인벤토리와 다르다');
if (C.areas.length + C.auditOnly.count !== inv.families.length) cov.push('영역 + 감사 전용 ≠ 전체 패밀리');
if (C.coverage.productionLinkedWrites !== 0) cov.push('실제 쓰기 연결이 0이 아니다');
check(`원장 표시 패밀리 ${visible.length}개·핵심 동작 ${visible.reduce((n, f) => n + f.operations.key.length, 0)}개가 모두 목적지를 가진다`, cov);

// 5) 선택지 = 2.0 열거값(다시 추출해 비교)
const opts = [];
for (const a of C.areas) for (const act of a.actions) for (const fd of act.fields) {
  if (!fd.optionSource || fd.optionSource === 'inline-verified') continue;
  const src = displayOptions(fd.optionSource, extractOptions(fd.optionSource));
  for (const o of fd.options) if (!src.some(s => s.value === o.value && s.label === o.label)) opts.push(`${act.id}.${fd.id}: ${o.value}=${o.label}가 ${fd.optionSource}에 없다`);
  if (fd.options.length > src.length) opts.push(`${act.id}.${fd.id}: 선택지가 원본보다 많다`);
}
check('필드 선택지의 값은 2.0 코드와 같고 화면 라벨은 3.0 표기와 같다', opts);

// 6) 문구·비밀 — 금지어 검사 자체도 시험한다(가드가 실제로 걸리는지)
const guard = [];
for (const bad of ['super_admin 전용', '슈퍼관리자만', '총괄 계정', 'master만 가능', 'src/features/x.ts']) if (!BANNED_VISIBLE.some(re => re.test(bad))) guard.push(`금지어 가드가 "${bad}"를 놓친다`);
for (const ok of ['원장', '관리자', '선생님', '학원 설정', '발송 큐']) if (BANNED_VISIBLE.some(re => re.test(ok))) guard.push(`금지어 가드가 정상 문구 "${ok}"를 막는다`);
for (const bad of ['becaa316-e636-42e9-9d09-08b133e0b094', 'Bearer abc', 'someone@example.com', '010-1234-5678']) if (!BANNED_ANYWHERE.some(re => re.test(bad))) guard.push(`비밀 가드가 "${bad}"를 놓친다`);
for (const re of BANNED_ANYWHERE) { const m = jsText.match(re); if (m) guard.push(`파일에 금지 패턴 ${re}: ${m[0]}`); }
check('화면 문구에 내부 역할 이름·원시 역할 키가 없고 파일에 비밀·경로가 없다(가드 자기 시험 포함)', guard);

// 7) 정적 서빙 — 정확한 허용 목록 + 루프백
const serve = readFileSync(join(here, 'serve-live.mjs'), 'utf8');
const routes = [...serve.matchAll(/\['(\/[^']*)',\s*\['([^']+)','([^']+)'\]\]/g)].map(m => `${m[1]}=>${m[2]}|${m[3]}`);
const expected = [
  '/=>live.html|text/html; charset=utf-8', '/index.html=>live.html|text/html; charset=utf-8', '/styles.css=>styles.css|text/css; charset=utf-8',
  '/live.css=>live.css|text/css; charset=utf-8', '/live.js=>live.js|text/javascript; charset=utf-8', '/ai-result-meta.js=>ai-result-meta.js|text/javascript; charset=utf-8', '/ax.js=>ax.js|text/javascript; charset=utf-8',
  '/ax.css=>ax.css|text/css; charset=utf-8', '/workspace-catalog.js=>workspace-catalog.js|text/javascript; charset=utf-8',
  '/workspaces.js=>workspaces.js|text/javascript; charset=utf-8', '/workspaces.css=>workspaces.css|text/css; charset=utf-8',
  '/flow-ui.js=>flow-ui.js|text/javascript; charset=utf-8', '/flow-ui.css=>flow-ui.css|text/css; charset=utf-8',
  '/ax-chat.js=>ax-chat.js|text/javascript; charset=utf-8', '/ax-chat.css=>ax-chat.css|text/css; charset=utf-8',
  '/context-picker.js=>context-picker.js|text/javascript; charset=utf-8', '/context-picker.css=>context-picker.css|text/css; charset=utf-8',
  '/exit-insight.js=>exit-insight.js|text/javascript; charset=utf-8', '/exit-insight.css=>exit-insight.css|text/css; charset=utf-8',
  '/v2-screens.js=>v2-screens.js|text/javascript; charset=utf-8', '/v2-screens.css=>v2-screens.css|text/css; charset=utf-8',
  '/controls.css=>controls.css|text/css; charset=utf-8',
  '/fonts/PretendardVariable.woff2=>../../public/fonts/PretendardVariable.woff2|font/woff2',
];
const serving = [];
for (const e of expected) if (!routes.includes(e)) serving.push(`허용 목록에 없음: ${e}`);
for (const r of routes) if (!expected.includes(r)) serving.push(`허용 목록 밖 정적 경로: ${r}`);
if (!/server\.listen\(port,'127\.0\.0\.1'/.test(serve)) serving.push('127.0.0.1 바인딩이 아니다');
if (!/const hosts=new Set\(\[`127\.0\.0\.1:\$\{port\}`,`localhost:\$\{port\}`\]\)/.test(serve)) serving.push('호스트 허용이 루프백 둘이 아니다');
check('정적 서빙이 정확한 허용 목록과 루프백 바인딩을 유지한다', serving);

const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` — ${c.failures.slice(0, 5).join(' | ')}${c.failures.length > 5 ? ` 외 ${c.failures.length - 5}건` : ''}`}`);
const cv = C.coverage;
console.log(`${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} · 영역 ${cv.areas} · facet ${cv.facets} · 동작 ${cv.actions}(${Object.entries(cv.actionsByMode).map(([k, v]) => `${k} ${v}`).join(', ')}) · 핵심 동작 ${cv.operationsWithDestination}/${cv.ownerVisibleOperations} · 실제 쓰기 ${cv.productionLinkedWrites}`);
process.exit(failed.length ? 1 : 0);
