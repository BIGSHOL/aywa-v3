// feature-inventory.json + AUDIT.md 생성기. 실행: node experiments/owner-concept/catalog/build-inventory.mjs
// 전제: generated/db-availability.json(로컬 복사본 읽기 전용 집계)이 있어야 한다. 문제(problems)가 1건이라도 있으면 쓰지 않고 실패한다.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { scan } from './scan-source.mjs';
import { readPrototype, readDbAvailability, catalogDir } from './inventory-core.mjs';
import { assemble } from './assemble.mjs';

const proto = await readPrototype();
const db = readDbAvailability();
const { inventory, problems } = assemble(scan, proto, db);
if (problems.length) {
  console.error(`설명되지 않은 문제 ${problems.length}건 — 인벤토리를 쓰지 않는다.`);
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}

const json = JSON.stringify(inventory, null, 1) + '\n';
writeFileSync(join(catalogDir, 'feature-inventory.json'), json);
// 같은 인벤토리로 3.0 카탈로그를 계산만 해서 AUDIT에 요약을 싣는다(파일은 build-workspace-catalog.mjs가 쓴다).
const { buildWorkspaceCatalog } = await import('./build-workspace-catalog.mjs');
const wsBuilt = buildWorkspaceCatalog({ inventoryText: json });
const wsCatalog = wsBuilt.problems.length ? null : wsBuilt.catalog;
// 서버 액션 export 추적표도 같은 인벤토리·카탈로그로 계산만 한다(파일은 build-operation-coverage.mjs가 쓴다).
const { buildOperationCoverage } = await import('./build-operation-coverage.mjs');
const opBuilt = wsCatalog ? buildOperationCoverage({ inventoryText: json, catalog: wsCatalog }) : null;
const opCov = opBuilt && !opBuilt.problems.length ? opBuilt.coverage : null;
// 해시는 줄바꿈을 LF로 맞춘 뒤 계산한다(Windows 체크아웃의 CRLF 변환에도 같은 값).
const digest = createHash('sha256').update(json.replace(/\r\n/g, '\n')).digest('hex');

// ── AUDIT.md ──
const esc = v => String(v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const c = inventory.counts;
const fams = inventory.families;
const famLabel = Object.fromEntries(fams.map(f => [f.id, f.label]));
const L = [];
L.push('# 2.0 전체 기능 감사 · 3.0 AX 갭');
L.push('');
L.push(`> 기준 커밋 \`${inventory.sourceCommit}\` · 로컬 복사본 DB 읽기 \`${db.readAt}\` · 기계 판독본 [\`feature-inventory.json\`](feature-inventory.json) · 검증기 [\`verify-catalog.mjs\`](verify-catalog.mjs)`);
L.push(`> <!-- inventory-sha256: ${digest} -->`);
L.push('');
L.push('## 1. 결론');
L.push('');
L.push(`- **라우트 회계 완료**: 페이지 ${c.pages}개·API ${c.apiRoutes}개(크론 핸들러 ${c.crons}개, vercel 일정 ${c.cronsScheduled}개)·기능 모듈 ${c.featureModules}개·서버 액션 파일 ${c.serverActionFiles}개(export ${c.serverActionExports}개)·권한 메뉴 키 ${c.menuKeys}개·내비/탭 항목 ${c.navEntries}개가 전부 ${c.families}개 패밀리에 배정됐다. 검증기의 설명되지 않은 누락은 0건이다.`);
L.push(`- 사용자 화면이 아닌 라우트는 클래스로 명시했다: ${Object.entries(c.routeClasses).map(([k, v]) => `${k} ${v}`).join(' · ')}.`);
L.push(`- 화면 게이트: ${Object.entries(c.gateStatus).map(([k, v]) => `${k} ${v}`).join(' · ')} — 메뉴 게이트가 없는 화면은 레이아웃·재-export 뷰·원문 확인(verifiedGates)으로 판정했고 \`none-detected\`는 ${c.gateStatus['none-detected'] || 0}건이다.`);
L.push(`- 핵심 동작 ${c.keyOperations}개는 실제 서버 액션 export 이름(또는 API·페이지)으로 근거를 달았고 검증기가 존재를 확인한다.`);
L.push(`- 현재 AX(시안 13 + AX 4)는 **실제 쓰기를 하나도 하지 않는다**. 세션 메모리 흉내 동작 ${proto.sessionOnlyActions.length}종(${proto.sessionOnlyActions.join(', ')})과 AX 이슈 ${proto.axIssues.length}종(${proto.axIssues.map(i => i.category).join('·')})이 전부다.`);
const absent = fams.filter(f => f.ax.level === 'absent');
L.push(`- AX에 전혀 없는 패밀리 ${absent.length}개: ${absent.map(f => f.label).join(', ')}.`);
L.push(`- 불확실성은 0으로 꾸미지 않았다: 남은 패밀리 기록 ${c.familyUncertainties}건 + 자동 감지 ${c.autoDetectedUncertainties}건 + 메모 ${inventory.uncertainties.notes.length}건(§11). 원문을 읽어 해소한 것 ${c.resolvedUncertainties}건은 따로 적었다.`);
L.push(`- 검증 수준(원문 검토이며 실행 시험이 아니다): 패밀리 ${Object.entries(c.verification).map(([k, v]) => `${k} ${v}`).join(' · ')} — 패밀리마다 핵심 동작 대표 서버 액션의 본문 머리와 권한·쓰기·감사·외부 호출 줄을 줄 번호로 읽고 근거 앵커를 남겼다(본문 전체 정독이 아닌 곳은 readScope에 적음). API ${c.apiRoutes}개: ${Object.entries(c.apiVerification).map(([k, v]) => `${k} ${v}`).join(' · ')}(핸들러 본문 전체를 읽음, 부분 읽기 ${c.apiPartialReads}건은 §11).`);
L.push(`- 근거 앵커는 검증기가 줄 단위로 확인한다(파일·줄·포함 문자열). 실제 실행·외부 연동·원본 DB 접근은 하지 않았다 — 실행이 필요한 질문은 '실행 확인 필요'로 남겼다.`);
L.push(`- 원장 표시: ${c.ownerVisibleFamilies}개 패밀리(핵심 동작 ${c.ownerVisibleKeyOperations}개) · 감사 전용 ${c.auditOnlyFamilies}개(인증·운영 콘솔·개발·데모·공용 기반·녹음 파이프라인). 원장 표시 패밀리는 3.0 카탈로그(§13)에서 모든 핵심 동작에 목적지를 가진다.`);
if (opCov) {
  const k = opCov.counts;
  L.push(`- **export 단위 회계(§13.2)**: 서버 액션 export ${k.exports}개 전부가 동작 묶음 ${k.groups}개(핵심 동작 ${k.groupsBySource['key-op']} · 새로 찾은 묶음 ${k.groupsBySource.discovered} · 개인 보기 설정 ${k.groupsBySource['view-prefs']})에 들어갔다 — 묶음 없는 export 0. 본문 추적 종류: 쓰기 ${k.byKind.mutation} · 읽기 ${k.byKind.read} · 도우미 ${k.byKind.helper ?? 0}(사람이 고친 판정 ${k.kindOverrides}건). 쓰기 ${k.mutationExports}개 모두 3.0 목적지가 있고 원장 표시 묶음 ${k.ownerFacingGroups}개가 모두 카탈로그 동작·화면 면에 닿는다.`);
  L.push(`- **검토 수준을 섞지 않는다**: 730개 전부 기계 추적(TS AST — 본문과 부르는 도우미의 게이트·표·RPC·외부 연동을 줄 근거로) · 사람의 검토는 ${Object.entries(k.review).map(([a, b]) => `${{ 'body-read': '본문 직접 읽음', 'key-action': '핵심 동작 검토', 'digest-reviewed': '요약 검토' }[a] || a} ${b}`).join(' · ')}. "730개 본문 전체를 읽었다"가 아니다.`);
}
L.push('');
L.push('## 2. 방법');
L.push('');
L.push('1. `scan-source.mjs` — `src/app`의 모든 `page`/`route` 파일, `"use server"` 파일의 export, `src/features/*`, `vercel.json` 크론, 권한 키(`MENU_LABEL`), 내비·탭 소스 34개 파일(TS AST), 화면 안 카탈로그(위젯·알림 유형·할 일 종류·설정 카드·상세 탭)를 읽는다. 라우트 그룹 `(x)`는 Next 규약대로 URL에서 뺀다.');
L.push('2. `families.mjs` — 감사자가 페이지 머리 주석·제목·게이트·서버 액션 export 다이제스트를 읽고 47개 패밀리로 묶었다. 배정은 접두사 최장 일치·모듈 단일 소유라 사람 판단이 끼지 않는다. 핵심 동작·AX 갭·제안 진입점은 큐레이션이다.');
L.push('3. `db-availability.mjs` — 로컬 Docker 복사본(127.0.0.1:5444)을 `read only` 트랜잭션으로 열어 337개 테이블의 전체 행 수와 침산(cs) 지점 행 수를 센다. 원본 DB·원본 env는 쓰지 않았다.');
L.push('4. `assemble.mjs` — 위 셋을 합쳐 배정 누락·없는 함수 이름·없는 테이블·풀리지 않는 내비 주소를 문제로 낸다. 문제가 있으면 `build-inventory.mjs`가 파일을 쓰지 않는다.');
L.push('5. `verify-catalog.mjs` — 새로 스캔한 소스와 커밋된 인벤토리를 집합 비교하고 assemble을 다시 돌려 0건인지 확인한다(§12).');
L.push('');
L.push('## 3. 역할별 작업 공간');
L.push('');
L.push(table(['역할(시스템)', '셸·입구', '근거'], [
  ['master·admin·manager·accountant·counselor·viewer', '관리자 풀셸(사이드바 업무군 8 + 지원 2, 창 모드) — 홈 = /dashboard', 'src/lib/menu-hub.ts HUB_GROUPS·SUPPORT_GROUPS, src/app/(shell)/layout.tsx'],
  ['teacher', '강사 미니셸 "내 메뉴" 19개 링크 — 홈 = /onescreen(영어 전담 = /ecs), 언어 한국어/English', 'src/lib/teacher-menu-links.ts, src/app/home/route.ts'],
  ['겸직(관리자 계열 + 담당 반)', '강사뷰 ↔ 관리자뷰 전환, 다른 강사 뷰(열람 전용)', 'src/features/shell/view-actions.ts'],
  ['student', '/my-learning (데모 데이터, DB 미연동)', 'src/app/(shell)/my-learning/page.tsx 머리 주석'],
  ['parent', '/parent — 탭 5칸 중 기능 3(실시간 차량·등하원 변경·수업 시간표)', 'src/app/(parent)/parent/_components/parent-tabs.tsx'],
  ['super_admin(플랫폼)', '/super-admin 운영 콘솔 6메뉴 — 지점 화면과 분리', 'src/components/super-admin/nav.ts'],
  ['device', '/kiosk(출석 키오스크), /seat/[seat](자리 PIN)', 'src/app/(kiosk), src/app/(seat)'],
  ['public', '/, /academy, /intake/[token], /staff-intake/[token], /r/[token], /v, /v/[token], /expired, /inventory/asset/[code]', '(marketing)·(academy)·(intake)·(share)·(asset) 그룹'],
]));
L.push('');
L.push(`시스템 역할 원본: \`src/lib/permissions.ts\` SYSTEM_ROLES = ${inventory.roles.join(', ')}.`);
L.push('');
L.push('## 4. 패밀리 목록');
L.push('');
L.push('원장 범위(ownerScope): `owner` = 원장 AX에 표시 · `owner-linked` = 다른 역할의 화면이지만 원장 업무와 연결(관리·미리보기·요청 목적지) · `audit-only` = 감사 기록용(숨긴 것이 아니라 원장 화면 대상이 아님). 쓰기 경로(writePath): `reuse-2.0-actions` · `reuse+new-storage`(2.0에 없는 저장소 필요) · `read-only`(근거·미리보기) · `n/a`. 시안 동작은 모두 세션 전용이므로 운영 백엔드 이관은 별도 작업이다.');
L.push('');
L.push(table(['패밀리', '영역', '원장 표시', '원장 범위', '2.0 상태', '페이지', 'API', '핵심 동작', 'AX', '쓰기 경로', '우선', '검증'], fams.map(f => [
  `\`${f.id}\` ${f.label}`, f.domain, f.ownerVisible ? '표시' : `감사 전용 — ${f.auditOnlyReason}`, f.ownerScope, f.implementation.status, f.routes.length, f.apiRoutes.length, f.operations.key.length, f.ax.level, f.ax.writePath, f.ax.priority, f.verification,
])));
L.push('');
L.push(`범위별 수: ${Object.entries(fams.reduce((o, f) => (o[f.ownerScope] = (o[f.ownerScope] || 0) + 1, o), {})).map(([k, v]) => `${k} ${v}`).join(' · ')}.`);
L.push('');
L.push('## 5. 갭 매트릭스 — 시안 13 + AX 4 대비');
L.push('');
L.push(`시안 화면(시안 라벨 → AX 라벨): ${proto.legacyViews.map(v => `\`${v.id}\` ${v.label}→${v.axLabel}`).join(' · ')}. AX 화면: ${proto.axViews.map(v => `\`${v.id}\` ${v.label}`).join(' · ')}.`);
L.push('');
L.push(table(['우선', '패밀리', '원장 범위', '2.0', 'AX', '쓰기 경로', '시안 화면', 'AX 화면·이슈', 'cs 데이터 있는 핵심 표', '시안 스냅샷 포함', '판정', '제안 진입점'], [...inventory.gapMatrix].sort((a, b) => a.priority.localeCompare(b.priority) || a.family.localeCompare(b.family)).map(g => [
  g.priority, famLabel[g.family], g.ownerScope, g.v2Status, g.axLevel, g.writePath, g.legacyViews.join(', ') || '—', [...g.axViews, ...g.axIssues.map(i => `issue:${i}`)].join(', ') || '—',
  g.primaryEntitiesWithCsData, g.primaryEntitiesInPrototypeSnapshot, g.dataVsUi, `${g.proposed.kind} — ${g.proposed.text}`,
])));
L.push('');
L.push('역방향(시안 화면 → 2.0 패밀리):');
L.push('');
L.push(table(['시안 화면', 'AX 라벨', '대응 2.0 패밀리'], proto.legacyViews.map(v => [`${v.id} ${v.label}`, v.axLabel, fams.filter(f => f.ax.legacyViews.includes(v.id)).map(f => f.id).join(', ')])));
L.push('');
L.push(table(['AX 이슈', '근거 위치', '대응 2.0 패밀리'], proto.axIssues.map(i => [`${i.id} ${i.category}`, i.source, fams.filter(f => f.ax.axIssues.includes(i.id)).map(f => f.id).join(', ')])));
L.push('');
L.push('## 6. 패밀리 상세');
for (const f of fams) {
  L.push('');
  L.push(`### \`${f.id}\` ${f.label}`);
  L.push('');
  L.push(`- 2.0: **${f.implementation.status}** — ${f.implementation.note}`);
  L.push(`- 원장 범위: **${f.ownerScope}** · 쓰기 경로: ${f.ax.writePath} · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: ${f.entities.prototypeReads.map(t => `\`${t}\``).join(', ') || '없음'}`);
  L.push(`- 대상: ${f.audience.join(', ')} · 권한 키: ${f.menuKeys.map(k => `\`${k}\``).join(' ') || '—'} · 검증: ${f.verification}${f.sourceRead.length ? ` (${f.sourceRead.map(s => `\`${s}\``).join(', ')})` : ''}`);
  if (f.routes.length) L.push(`- 페이지 ${f.routes.length}: ${f.routes.map(r => `\`${r.url}\`(${r.class})`).join(' ')}`);
  if (f.apiRoutes.length) L.push(`- API ${f.apiRoutes.length}: ${f.apiRoutes.map(a => `\`${a.url}\`${a.cronSchedule ? `@${a.cronSchedule}` : ''}`).join(' ')}`);
  const surf = f.surfaces.filter(s => s.label);
  if (surf.length) L.push(`- 메뉴·탭 입구 ${surf.length}: ${[...new Set(surf.map(s => `${s.label}${s.href ? `(${s.href})` : ''}`))].join(' · ')}`);
  for (const cat of f.catalogs) L.push(`- 화면 안 카탈로그 \`${cat.name}\`: ${cat.count}개 (§10)`);
  L.push('- 핵심 동작:');
  for (const op of f.operations.key) L.push(`  - ${op.op} — ${[...op.fns.map(n => `\`${n}\``), ...(op.api || []).map(a => `API \`${a}\``), ...(op.pages || []).map(p => `페이지 \`${p}\``)].join(', ')}`);
  const verbs = Object.entries(f.operations.allExports).map(([k, v]) => `${k} ${v.length}`).join(' · ');
  if (verbs) L.push(`- 서버 액션 전체(동사 갈래): ${verbs} · 감사로그 ${f.operations.writesAuditLog ? '있음' : '없음'} · AI ${f.operations.usesAI ? '있음' : '없음'} · 알림 발송 ${f.operations.sendsNotifications ? '있음' : '없음'}`);
  if (f.entities.primary.length) L.push(`- 핵심 표(전체/cs 행): ${f.entities.primary.map(e => `\`${e.table}\` ${e.rows}/${e.csRows ?? '—'}${e.inPrototypeSnapshot ? '★' : ''}`).join(', ')} (★ = 시안 스냅샷 입력)`);
  L.push(`- AX: **${f.ax.level}** · 시안 ${f.ax.legacyViews.join(', ') || '—'} · AX ${[...f.ax.axViews, ...f.ax.axIssues.map(i => `issue:${i}`)].join(', ') || '—'} · 우선 ${f.ax.priority}`);
  if (f.ax.shows) L.push(`  - 보이는 것: ${f.ax.shows}`);
  if (f.ax.sessionOps.length) L.push(`  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): ${f.ax.sessionOps.map(o => `\`${o}\``).join(' ')}`);
  L.push(`  - 빠진 것: ${f.ax.missing}`);
  L.push(`  - 제안(${f.ax.proposed.kind}): ${f.ax.proposed.text}`);
  if (f.semantics) {
    L.push(`- 원문 검토(읽은 범위: ${f.readScope.join(', ')}):`);
    L.push(`  - 동작: ${f.semantics.behavior}`);
    L.push(`  - 권한: ${f.semantics.authorization}`);
    L.push(`  - 연동: ${f.semantics.integration}`);
    L.push(`  - 근거: ${f.semantics.evidence.map(ev => `\`${ev.file}:${ev.line}\``).join(' · ')}`);
    for (const x of f.semantics.findings) L.push(`  - 발견: ${x}`);
  }
  for (const u of f.uncertainties) L.push(`- ⚠️ 불확실: ${u}`);
  for (const u of f.resolved) L.push(`- ✅ 원문으로 해소: ${u}`);
}
L.push('');
L.push('## 7. 페이지 라우트 전수표');
L.push('');
L.push(table(['URL', '클래스', '패밀리', '제목(metadata)', '게이트 상태', '게이트·단서', '파일'], inventory.routes.map(r => [r.url, r.class, r.family, r.title || '—', r.gateStatus, [...r.gates, ...r.layoutGates.filter(g => /^require/.test(g)), ...r.gateHints, ...(r.gateEvidence ? [r.gateEvidence] : [])].join(' ') || '—', r.file])));
L.push('');
L.push('## 8. API·크론 전수표');
L.push('');
L.push('각 핸들러 본문을 읽고 인증 방식·동작·쓰는 곳·외부 연동을 적었다(근거 줄은 feature-inventory.json의 apiRoutes[].semantics.evidence). 실행 시험은 하지 않았다.');
L.push('');
L.push(table(['URL', '클래스', '패밀리', '메서드', 'vercel 일정', '인증', '동작', '외부', '읽은 범위'], inventory.apiRoutes.map(a => [
  a.url, a.class, a.family, a.methods.join(','), a.cronSchedule || '—',
  a.semantics ? `${a.semantics.auth} — ${a.semantics.authDetail}` : '—', a.semantics?.behavior || '—', (a.semantics?.external || []).join(', ') || '—',
  a.semantics ? (a.semantics.readDepth === 'partial' ? `부분: ${a.semantics.note}` : '핸들러 전체') : 'auto',
])));
L.push('');
L.push(`일정 없는 크론 핸들러: ${inventory.crons.filter(x => !x.scheduled).map(x => `\`${x.path}\``).join(', ') || '없음'}.`);
L.push('');
L.push('## 9. 내비·탭 소스 추적');
L.push('');
const bySource = {};
for (const n of inventory.navigation) { const file = n.source.replace(/:\d+$/, ''); (bySource[file] ||= []).push(n); }
L.push(table(['소스 파일', '항목', '해석', '패밀리'], Object.entries(bySource).map(([file, ns]) => [
  file, ns.length,
  Object.entries(ns.reduce((o, n) => (o[n.resolution] = (o[n.resolution] || 0) + 1, o), {})).map(([k, v]) => `${k} ${v}`).join(' · '),
  [...new Set(ns.map(n => n.family).filter(Boolean))].join(', ') || '(파생)',
])));
L.push('');
L.push(`해석: literal = 문자열 주소 · constant = 경로 상수(${Object.keys((await import('./inventory-core.mjs')).NAV_CONSTANTS).join(', ')}) · menuKey = fromMenu()가 NAV_GROUPS 정의를 끌어옴 · in-page = 주소 없는 화면 안 탭/필터 · derived = 다른 목록을 그대로 비추는 항목(원본이 따로 잡힘) · expanded = 파생 항목을 펼친 값.`);
L.push('');
L.push('파생 항목의 원본:');
for (const n of inventory.navigation.filter(x => x.resolution === 'derived')) L.push(`- \`${n.source}\` \`${n.href ?? n.key}\` — ${n.why}`);
L.push('');
L.push('## 10. 화면 안 카탈로그(설정 하위 패널·위젯·알림·할 일)');
const cats = inventory.catalogs;
L.push('');
L.push(`- 학원 설정 면 18개(OWNER_FACES, 기능 면은 일반판 전용) + 연동 하위 6개 + 설정 카드 ${cats.ownerSettingsCards.length}개:`);
const cardsByFile = {};
for (const x of cats.ownerSettingsCards) (cardsByFile[x.file.split('/').pop()] ||= []).push(x.title);
for (const [file, ts] of Object.entries(cardsByFile)) L.push(`  - \`${file}\`: ${ts.join(' · ')}`);
L.push(`- 대시보드 위젯 ${cats.dashboardWidgets.length}종: ${cats.dashboardWidgets.map(w => w.label).join(' · ')}`);
L.push(`- 할 일 종류 ${cats.staffTaskKinds.length}종: ${cats.staffTaskKinds.map(k => `${k.label}(\`${k.key}\`)`).join(' · ')}`);
L.push(`- 알림 유형 전체(NotificationType 유니언, src/features/notifications/types.ts) ${cats.notificationTypes.length}종 — 슬랙 전달 목록에 없는 것: ${cats.notificationTypes.filter(t => !cats.notificationForwardEvents.some(e => e.key === t.key)).map(t => `\`${t.key}\``).join(', ') || '없음'}`);
L.push(`- 알림 유형(슬랙 전달 가능) ${cats.notificationForwardEvents.length}종: ${cats.notificationForwardEvents.map(k => `${k.label}(\`${k.key}\`)`).join(' · ')}`);
L.push(`- 슬랙 활동 범주 ${cats.slackActivityCategories.length} · 프리셋 ${cats.slackRulePresets.length}: ${cats.slackActivityCategories.map(k => k.label).join(' · ')} / ${cats.slackRulePresets.map(k => k.label).join(' · ')}`);
L.push(`- 원생 상세 탭 ${cats.studentDetailTabs.filter(t => !t.key.startsWith('{')).length}개: ${cats.studentDetailTabs.filter(t => !t.key.startsWith('{')).map(t => t.label).join(' · ')}`);
L.push(`- 학부모 탭: ${cats.parentTabs.map(t => t.label).join(' · ')} (+ 빈 슬롯 2)`);
L.push(`- DB 트리거로 알림·할 일을 넣는 마이그레이션 ${scan.dbTriggerNotifiers.length}개: ${scan.dbTriggerNotifiers.join(', ')}`);
L.push('');
L.push('## 11. DB 엔티티 연결과 불확실성');
L.push('');
const ents = inventory.dbEntities.public;
L.push(`- 복사본 ${c.dbTables}개 테이블(public ${c.dbPublicTables}) 중 패밀리 코드가 읽거나 쓰는 public 테이블 ${c.dbTablesLinkedToFamilies}개, 앱 코드에서 \`.from()\`으로 참조하지 않는 public 테이블 ${c.dbTablesNotReferencedInCode}개(RPC·트리거·뷰 전용이거나 미사용 — 판정은 하지 않았다).`);
L.push(`- 시안 스냅샷 입력 ${proto.snapshotTables.length}개 테이블: ${proto.snapshotTables.join(', ')}.`);
L.push(`- 코드가 참조하는 이름 중 복사본 테이블에 없는 것 ${inventory.dbEntities.codeTablesMissingInDb.length}개: ${inventory.dbEntities.codeTablesMissingInDb.join(', ') || '없음'}.`);
L.push(`- 앱 코드 미참조 public 테이블: ${ents.filter(e => !e.referencedInCode).map(e => `${e.table}(${e.csRows ?? e.rows})`).join(', ')}`);
L.push('');
L.push('불확실성 — 패밀리 기록:');
for (const u of inventory.uncertainties.family) L.push(`- \`${u.family}\` ${u.issue}`);
L.push('');
L.push('원문을 읽어 해소한 것:');
for (const u of inventory.uncertainties.resolvedBySourceRead) L.push(`- \`${u.family}\` ${u.issue}`);
L.push('');
L.push('불확실성 — 자동 감지(원문 확인 전):');
for (const u of inventory.uncertainties.autoDetected) L.push(`- ${u.route ? `\`${u.route}\`` : `\`${u.module}\``} (${u.family}) — ${u.issue}`);
L.push('');
L.push('불확실성 — 일부만 읽은 API 본문:');
for (const u of inventory.uncertainties.apiPartialReads) L.push(`- \`${u.api}\` (${u.family}) — ${u.issue}`);
if (!inventory.uncertainties.apiPartialReads.length) L.push('- 없음 — API 92개 모두 핸들러 본문 전체를 읽었다(`/api/webhooks/assemblyai`는 route 본문 1,012줄과 직접 부르는 상태 도우미까지; 분석 프롬프트 본문은 해당 패밀리 검토 범위).');
L.push('');
L.push('메모:');
for (const n of inventory.uncertainties.notes) L.push(`- ${n}`);
L.push('');
L.push('## 12. 검증');
L.push('');
L.push('```');
L.push('node experiments/owner-concept/catalog/scan-source.mjs        # 소스 스캔(읽기 전용)');
L.push('node experiments/owner-concept/catalog/db-availability.mjs    # 로컬 복사본 행 수(읽기 전용 트랜잭션)');
L.push('node experiments/owner-concept/catalog/build-inventory.mjs    # 인벤토리·이 문서 생성(문제 1건이라도 있으면 실패)');
L.push('node experiments/owner-concept/catalog/verify-catalog.mjs     # 소스 ↔ 인벤토리 집합 대조 + 근거 앵커 + 문서 해시');
L.push('node experiments/owner-concept/catalog/build-workspace-catalog.mjs   # 3.0 카탈로그 생성(문제 1건이라도 있으면 실패)');
L.push('node experiments/owner-concept/verify-workspace-catalog.mjs          # 카탈로그 재생성 일치·스키마·커버리지·선택지·문구·정적 서빙');
L.push('node experiments/owner-concept/catalog/build-operation-coverage.mjs  # 서버 액션 export 추적표 생성(묶음 없는 export가 있으면 실패)');
L.push('node experiments/owner-concept/catalog/verify-operation-coverage.mjs # 독립 AST 집계 대조·묶음·목적지·근거 줄·수치');
L.push('```');
L.push('');
L.push('검증기가 실패하는 조건: 새 페이지·API·크론·모듈·액션 파일·메뉴 키·내비 항목이 인벤토리에 없거나, 인벤토리에만 있는 낡은 항목이 있거나, 핵심 동작의 함수가 사라졌거나, 시안 화면·AX 화면이 어느 패밀리와도 이어지지 않았거나, 이 문서가 인벤토리와 다른 해시를 들고 있을 때. 결과는 `coverage-report.json`.');
L.push('');
L.push('## 13. 3.0 원장 작업 공간 카탈로그(window.AxCatalog)');
L.push('');
if (wsCatalog) {
  const cv = wsCatalog.coverage;
  L.push('생성물 `experiments/owner-concept/workspace-catalog.js`(같은 데이터 `catalog/workspace-catalog.json`) · 생성기 `catalog/build-workspace-catalog.mjs` · 검증기 `verify-workspace-catalog.mjs`.');
  L.push('');
  L.push(`- 영역 ${cv.areas}(= 원장 표시 패밀리) · facet ${cv.facets} · 동작 ${cv.actions}(${Object.entries(cv.actionsByMode).map(([k, v]) => `${k} ${v}`).join(' · ')}) · 원장 표시 핵심 동작 ${cv.operationsWithDestination}/${cv.ownerVisibleOperations}에 목적지 · 실제 쓰기 연결 ${cv.productionLinkedWrites}.`);
  L.push(`- 수치 구분: 원문 검토(source-audited) = 패밀리 ${c.families}·API ${c.apiRoutes}${opCov ? ` · 서버 액션 export ${opCov.counts.exports} 회계(본문 직접 ${opCov.counts.review['body-read'] || 0} / 핵심 동작 검토 ${opCov.counts.review['key-action'] || 0} / 요약 검토 ${opCov.counts.review['digest-reviewed'] || 0})` : ''} / 런타임 미리보기(runtime-previews) = 동작 ${cv.actions}(전부 로컬, liveWrite:false) / 실제 운영 연결(production-linked) = ${cv.productionLinkedWrites}.`);
  L.push('- facet은 2.0 화면의 실제 탭·면·결재함·단계를 원문 근거(라우트 또는 파일 안 문자열)로 확인했고, 필드 선택지는 2.0 열거값을 TS AST로 그대로 읽는다(catalog/option-sources.mjs).');
  L.push('');
  L.push(table(['영역', '그룹', '보기', 'facet', '동작(이동/미리보기/요청)'], wsCatalog.areas.map(a => [`${a.id} ${a.label}`, a.group, a.viewKind, a.facets.map(x => x.label).join(' · '), ['navigate', 'preview', 'request'].map(m => a.actions.filter(x => x.mode === m).length).join('/')])));
} else L.push('카탈로그를 계산하지 못했다 — build-workspace-catalog.mjs의 문제를 먼저 해결할 것.');
L.push('');
L.push('### 13.1 워크플로·쓰기 공백 — 목적지가 있다고 완성이 아니다');
L.push('');
{
  const levelLabel = { simulated: '세션 흉내(저장 안 됨)', 'read-only': '읽기 전용', absent: '없음' };
  // 쓰기 수 = export 본문 추적(§13.2)의 mutation. 옛 파일 단위 추정(쓰기 파일 안의 조회 아닌 이름)은 비교용으로만 적는다.
  const heuristic = inventory.serverActions.filter(s => s.writes).reduce((n, s) => n + s.exports.filter(e => e.verb !== '조회').length, 0);
  const writeExports = id => (opCov ? opCov.exports.filter(x => x.family === id && x.kind === 'mutation') : []);
  const writeFiles = id => new Set(writeExports(id).map(x => x.file)).size;
  const visibleFams = inventory.families.filter(f => f.ownerVisible);
  const totalWrites = visibleFams.reduce((n, f) => n + writeExports(f.id).length, 0);
  const allWrites = opCov ? opCov.counts.mutationExports : 0;
  const lv = {};
  for (const f of visibleFams) lv[f.ax.level] = (lv[f.ax.level] || 0) + 1;
  L.push(`- 카탈로그 ${wsCatalog ? wsCatalog.coverage.operationsWithDestination : '?'}/${wsCatalog ? wsCatalog.coverage.ownerVisibleOperations : '?'}은 "원장이 그 일로 갈 곳이 있다"는 뜻이지 "3.0에서 그 일을 할 수 있다"는 뜻이 아니다. 미리보기(preview)는 입력 모양·2.0 선택지·근거를 보여 주는 로컬 화면이고, 요청(request)은 사람에게 보내는 원장 요청 초안이다. 둘 다 2.0의 상태 전이(결재 순서, 퇴원 처리 트랜잭션, 청구·배분 재확정, 발송 큐, 사실 기반 할 일 종료)를 실행하지 않는다.`);
  L.push(`- 2.0 쓰기 export(본문 추적 — DB·감사로그·스토리지·쿠키·알림·외부 발신 중 하나라도): 전체 ${allWrites}개 · 원장 표시 패밀리 ${totalWrites}개(1차 감사의 파일 단위 추정은 ${heuristic}개였다). 이 중 3.0 시안에서 2.0 기록(원본·복사본 DB)까지 가는 것 **0개**(로컬 오버레이 저장은 별개이며 2.0 쓰기를 대신하지 않는다).`);
  L.push(`- 원장 표시 패밀리 ${visibleFams.length}개의 지금 시안 수준: ${Object.entries(lv).map(([k, v]) => `${levelLabel[k] || k} ${v}`).join(' · ')}. 카탈로그는 이 수준을 올리지 않는다(화면 목적지를 줄 뿐).`);
  L.push('- 3.0의 다음 층(이벤트 → 규칙 → 케이스·단계 → 역할 수신함 → 근거 보고 → 다음 이벤트)이 메워야 할 것은 아래 "남은 워크플로" 열이다. 사실 기반으로 닫히는 2.0 할 일은 3.0이 대신 닫지 않는다.');
  L.push('');
  L.push(table(['패밀리', '2.0 쓰기 export(파일)', '알림·AI·감사', '지금 시안', '3.0 목적지(이동/미리보기/요청)', '3.0 실제 쓰기', '남은 워크플로'], visibleFams.map(f => {
    const area = wsCatalog?.areas.find(a => a.id === f.id);
    const flags = [f.operations.sendsNotifications && '알림', f.operations.usesAI && 'AI', f.operations.writesAuditLog && '감사'].filter(Boolean).join('·') || '—';
    return [`${f.id} ${f.label}`, `${writeExports(f.id).length}(${writeFiles(f.id)})`, flags, levelLabel[f.ax.level] || f.ax.level, area ? ['navigate', 'preview', 'request'].map(m => area.actions.filter(x => x.mode === m).length).join('/') : '—', '0', f.ax.missing || '—'];
  })));
}
L.push('');
L.push('### 13.2 서버 액션 export 추적 — 730개 하나도 빼지 않고');
L.push('');
if (opCov) {
  const k = opCov.counts;
  const RL = { 'body-read': '본문 직접 읽음', 'key-action': '핵심 동작 검토', 'digest-reviewed': '요약 검토' };
  const RT = { 'read-preview': '읽기·이동', 'local-preview': '로컬 미리보기', 'manual-request': '사람에게 요청', 'ui-state': '화면 상태', 'audit-only': '감사 전용' };
  L.push('기계 판독본 `catalog/operation-coverage.json` · 생성기 `catalog/build-operation-coverage.mjs` · 묶음 판단 `catalog/operation-groups.mjs` · 본문 분석기 `catalog/operation-analysis.mjs` · 검증기 `catalog/verify-operation-coverage.mjs`.');
  L.push('');
  L.push(`- 집계: export ${k.exports}개(파일 ${k.files}개) — 스캐너(정규식)와 따로 TS AST로 'use server' 파일을 다시 세어 같은 집합임을 검증기가 확인한다(함수 안 인라인 서버 액션 0).`);
  L.push(`- 종류(본문 추적): 쓰기 ${k.byKind.mutation} · 읽기 ${k.byKind.read} · 도우미 ${k.byKind.helper ?? 0}. 2.0 효과: ${Object.entries(k.effects).map(([a, b]) => `${a} ${b}`).join(' · ')}.`);
  L.push(`- 묶음 배정: ${Object.entries(k.groupSource).map(([a, b]) => `${{ 'key-op': '같은 패밀리 핵심 동작', 'key-op-cross-family': '다른 패밀리 핵심 동작', 'key-op-attached': '핵심 동작에 붙임(변형·짝·입력 보조)', discovered: '새로 찾은 묶음', 'view-prefs': '개인 보기 설정' }[a] || a} ${b}`).join(' · ')}.`);
  L.push(`- 3.0 목적지(묶음 ${k.groups}개): ${Object.entries(k.runtime).map(([a, b]) => `${a.split('+').map(x => RT[x] || x).join('+')} ${b}`).join(' · ')}. 실제 운영 연결 ${k.productionLinkedWrites}.`);
  L.push(`- 검토 수준: ${Object.entries(k.review).map(([a, b]) => `${RL[a] || a} ${b}`).join(' · ')} — ${Object.entries(opCov.method.reviewLevels).map(([a, b]) => `${RL[a] || a} = ${b}`).join('; ')}.`);
  L.push(`- 방법의 한계: ${opCov.method.limits.join(' ')}`);
  L.push('');
  L.push(table(['패밀리', 'export', '쓰기/읽기/도우미', '묶음(핵심/새로/보기)', '검토(본문/핵심/요약)', '외부·알림·AI'], [...new Set(opCov.exports.map(x => x.family))].sort().map(fid => {
    const xs = opCov.exports.filter(x => x.family === fid);
    const n = (f) => xs.filter(f).length;
    const gs = [...new Set(xs.map(x => x.group))].map(id => opCov.groups.find(g => g.id === id));
    const fx = [...new Set(xs.flatMap(x => x.effects.filter(e => ['external-send', 'external-read', 'notify', 'push', 'ai'].includes(e))))].join('·') || '—';
    return [fid, xs.length, `${n(x => x.kind === 'mutation')}/${n(x => x.kind === 'read')}/${n(x => x.kind === 'helper')}`,
      `${gs.filter(g => g.source === 'key-op').length}/${gs.filter(g => g.source === 'discovered').length}/${gs.filter(g => g.source === 'view-prefs').length}`,
      `${n(x => x.review === 'body-read')}/${n(x => x.review === 'key-action')}/${n(x => x.review === 'digest-reviewed')}`, fx];
  })));
  L.push('');
  L.push(`새로 찾은 동작 묶음 ${k.discoveredGroups}개 — 핵심 동작 목록에 없던 독립 동작(빠진 기능이 아니라 목록이 덜 세던 것). 원장 기능인 셋(강의실 자동배정·반 레벨 변경·근무 설정)은 카탈로그 동작을 새로 만들었다:`);
  L.push('');
  L.push(table(['묶음', '동작', 'export', '쓰기', '3.0 목적지', '원문에서 확인한 것'], opCov.groups.filter(g => g.source === 'discovered').map(g => [g.id, g.label, g.exports, g.kinds.mutation || 0,
    g.destination.type === 'action' ? g.destination.actions.join(', ') : g.destination.type === 'facet' ? `${g.destination.page}/${g.destination.facet}` : `화면 상태 — ${g.destination.reason}`, g.note || '—'])));
  L.push('');
  L.push('사람이 본문을 보고 고친 기계 판정(경로를 가리지 않는 추적의 과대 추정):');
  for (const x of opCov.exports.filter(x => x.machineKind)) L.push(`- \`${x.family}|${x.name}\` ${x.machineKind} → ${x.kind} — ${x.kindReason}`);
  const notifTypes = [...new Set(opCov.exports.flatMap(x => x.notificationTypes))].sort();
  L.push('');
  L.push(`알림 종류: 서버 액션 본문 추적에서 \`notifyUsers\`의 type이 잡힌 것은 ${notifTypes.length}종(${notifTypes.join(', ')})이다. 39종 목록의 나머지는 API·크론·DB 트리거·워커에서 만들거나 type이 동적이다 — 이 표만으로 출처를 단정하지 않는다.`);
} else L.push('추적표를 계산하지 못했다 — build-operation-coverage.mjs의 문제를 먼저 해결할 것.');
L.push('');
L.push('## 14. 다음 구현 권고');
L.push('');
L.push('1. **요청 저장소부터** — AX "요청한 업무"(원장 → 담당자, 기한·우선순위·알림 채널, 확인·완료 보고)를 저장할 테이블이 2.0에 없다. `staff_tasks`는 기록의 사실로 자동 생성·자동 종료되는 할 일이라 사람이 보낸 요청과 섞으면 종료 규칙이 깨진다. 새 테이블(tenant_id + RLS) + 감사로그 + 강사 미니셸 수신함(teacher-workspace)이 한 묶음이다.');
L.push('2. **P0 이슈 원천을 실제 판정으로 교체** — 시안 이슈 7종은 복사본 집계다. 2.0이 이미 판정하는 원천을 그대로 읽는다: 할 일 11종(`staff_tasks.kind`), 알림 39종(`notifications.type`), 대시보드 위젯 36종의 판정 함수(`src/features/dashboard/*`). 같은 숫자를 두 번 계산하지 않는다(같은 데이터는 같은 원본).');
L.push('3. **근거 패널 = 2.0 상세 화면 딥링크** — 원생 상세(탭 13), 반 상세, 청구 상세, 상담 상세, 결재 문서, 보고서 발송 큐. 3.0 메뉴를 186개로 늘리지 않고 이슈 → 근거 → 2.0 화면(창)으로 들어간다.');
L.push('4. **결정 이슈는 실제 경로로** — 결재(`decideDocument`), 퇴원보고서(`changeWithdrawalReport`), 학부모 답글(`requestParentReply`)처럼 원장이 결정하는 동작은 시안의 세션 흉내를 걷고 2.0 서버 액션을 그대로 부른다.');
L.push('5. **자동화 = 2.0 슬랙 규칙 구조** — 범주 12·프리셋 4·전달 이벤트 38·요약 일정·방해금지. AX 자동화 토글은 새 저장소를 만들지 말고 `slack_rules`/`tenant_settings` 위에 얹는다.');
L.push('6. **데이터는 있으나 화면이 없는 것부터 채운다** — 신규생 체크(`student_onboarding_checks`), 영상 숙제 장부, 강사 시트 작성 현황, 연동 실패 이력.');
L.push('7. **감사 전용은 6개뿐** — 인증·운영 콘솔·개발·데모·공용 기반·녹음 파이프라인. 학부모·학생·강사·공개 페이지는 원장이 관리·미리보기하는 영역으로 카탈로그에 있다(지점 화면에 운영자 설정 노출 금지 규칙은 유지).');
L.push('8. **이벤트·케이스 층의 입력** — 할 일 11종(사실 기반 자동 종료)·알림 39종·DB 트리거 9개가 이미 있는 이벤트 원천이다. 원장 요청(사람이 확인·보고)과 사실 기반 자동 종료를 같은 상태 기계로 합치지 말 것. AI가 고르는 다음 행동은 핵심 동작 ID 공간(AxCatalog.coverage.operationDestinations)에서만 고르게 하면 없는 동작을 지어낼 수 없다.');
L.push('');
writeFileSync(join(catalogDir, 'AUDIT.md'), L.join('\n'));
console.log(JSON.stringify({ wrote: ['feature-inventory.json', 'AUDIT.md'], sha256: digest, counts: c }));
