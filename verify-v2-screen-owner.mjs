// 2.0 화면 — 학원 설정 시험 (Docker 복사본 읽기 · 저장은 되돌림 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-owner.mjs
// ① 주소 열쇠 ② 그리기 = 2.0 page.tsx(facesFor · SELF_GATED_TABS · fmt · return 본문) 글자 그대로 ③ 면 권한 · 옛 주소 이동
// ④ 브라우저로 가는 값에 설정 원본(자리 PIN · 권한 원본)이 새지 않는다 ⑤ saveOwnerSection(되돌림) ⑥ 호스트 · 3.0 쪽.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as M from './v2-screen-owner.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');
const fd = obj => ({ $formData: Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]) });

await check('주소 열쇠 = 2.0 page.tsx가 서버에서 읽는 칸(tab · year · sub) + 보는 사람(viewer)', async () => {
  const page = lf(await src('app/(shell)/owner/page.tsx'));
  for (const k of ['tab', 'year', 'sub']) assert.match(page, new RegExp(`sp\\.${k}\\b`));
  assert.deepEqual(Object.keys(M.screen.params).sort(), ['page', 'sub', 'tab', 'viewer', 'year']);
});

await check('그리기 = 2.0 owner/page.tsx 글자 그대로 — 바꾼 곳은 서버에서만 나오는 값 셋과 서버 컴포넌트 면(owner-page.swaps.json)', async () => {
  const page = lf(await src('app/(shell)/owner/page.tsx')), mine = lf(await here('./v2-host/src/owner-page.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/owner-page.swaps.json'));
  let body = page.slice(page.indexOf('  return (\n    <div data-maximize-toolbar-page'), page.lastIndexOf('\n}'));
  for (const [from, to] of swaps) { assert.equal(body.split(from).length, 2, from.slice(0, 40)); body = body.replace(from, to); }
  assert.ok(mine.includes(body), 'return 본문');
  for (const [a, b] of [['function facesFor(', '\n}\n'], ['const SELF_GATED_TABS', ';\n'], ['function fmt(', '\n}\n']]) {
    const i = page.indexOf(a); assert.ok(mine.includes(page.slice(i, page.indexOf(b, i) + b.length)), a);
  }
  // 바꾼 자리 = 서버 값 셋(자리 PIN 상태 · 휴일 · 권한 token) + 서버 컴포넌트 면 — 2.0 클라 부품(섹션 폼)은 손대지 않았다
  assert.equal(swaps.filter(([, to]) => /OwnerServerFace|OwnerIntegrationsFace/.test(to)).length, swaps.length - 3);
  // 연동 면 = integrations-face.tsx · sheets-face.tsx 본문 그대로(서버 카드만 '아직' — owner-integrations.swaps.json)
  const integ = lf(await here('./v2-host/src/owner-integrations.tsx')), iswaps = JSON.parse(await here('./v2-host/src/owner-integrations.swaps.json'));
  const face = lf(await src('app/(shell)/owner/_components/integrations-face.tsx')), sheets = lf(await src('app/(shell)/owner/_components/sheets-face.tsx'));
  let fbody = face.slice(face.indexOf('  if (available.length === 0) {'), face.indexOf('\n}\n', face.indexOf('  return (\n    <div className="space-y-4">')) + 1);
  for (const [from, to] of iswaps['integrations-face.tsx']) fbody = fbody.replace(from, to);
  assert.ok(integ.includes(fbody), 'integrations-face 본문');
  let sret = sheets.slice(sheets.indexOf('  return (\n    <div className="w-full space-y-8">'), sheets.lastIndexOf('\n}'));
  for (const [from, to] of iswaps['sheets-face.tsx']) { assert.equal(sret.split(from).length, 2); sret = sret.replace(from, to); }
  assert.ok(integ.includes(sret), 'sheets-face 본문(구글 시트 절은 그대로)');
  assert.ok(sret.includes('<SubjectSheetCard key={s} subject={s} label={subjectMaps.labelOf(s)} status={sheetStatuses[i]} />'));
  for (const [from] of swaps) assert.doesNotMatch(from, /<(Profile|Operations|Subjects|Billing|Notifications|Consultations|Permissions|Navigation|Modules|Makeups)Section/);
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => M.screen.load({ sql, params, tenantId, importV2 }));
try {
  const base = await load({});
  const admin = base.editors.find(e => e.role === '관리자');

  await check('보는 사람 = 학원 설정의 어느 면이든 열 수 있는 재직 직원(운영자 계정 제외 · 원장 먼저) · 면 탭 = 그 사람이 열 수 있는 면 · 옛 탭은 2.0 주소로', async () => {
    const supers = (await db`select id::text id from public.super_admins`).map(r => r.id);
    assert.ok(base.editors.length > 0 && !base.editors.some(e => supers.includes(e.id)));
    assert.equal(base.editors[0].role, '원장'); assert.equal(base.route, 'page'); assert.equal(base.page.tab, 'profile');
    assert.ok(base.page.allowedTabEntries.some(([k, ok]) => k === 'permissions' && ok));
    for (const [tab, to] of [['report', '/lesson-reports?tab=report'], ['report_mgmt', '/lesson-reports'], ['ai_ment', '/lesson-reports?tab=ai_ment'], ['sessions', '/owner?tab=subjects']])
      assert.deepEqual([(await load({ tab })).redirect], [to], tab);
    if (admin) {
      const a = await load({ viewer: admin.id, tab: 'permissions' });
      assert.ok(a.route === 'page' || a.route === 'redirect');
      if (a.route === 'page') assert.equal(a.page.permissionsSource, undefined, '원장이 아니면 권한 원본을 싣지 않는다');
    }
  });

  await check('🔴 브라우저로 가는 값에 설정 원본이 새지 않는다 — 운영 섹션은 운영 체계·과목 운영 면에만 · 권한 원본은 원장의 역할·권한 면에만 · 운영 전달 칸은 넷', async () => {
    for (const tab of ['profile', 'billing', 'notifications', 'navigation', 'audit', 'popups']) {
      const d = await load({ tab }), json = JSON.stringify(d);
      assert.doesNotMatch(json, /"seatPins"/, `${tab}: 자리 PIN`);
      assert.equal(d.page.operationsForClient, null, tab); assert.equal(d.page.permissionsSource, undefined, tab);
      assert.deepEqual(Object.keys(d.host.operations).sort(), ['gradeLevels', 'jobTitles', 'jobTitlesByDepartment', 'subjects']);
      assert.ok(!('permissions' in d.page.settings) && !('operations' in d.page.settings), `${tab}: 설정 원본 섹션`);
    }
    const ops = (await load({ tab: 'operations' })).page;
    assert.ok(ops.operationsForClient && ops.operationsTokens, '편집자에게 운영 원본 + 기준 token');
    assert.equal(typeof ops.seatPin.lab, 'boolean');
    const perm = (await load({ tab: 'permissions' })).page;
    assert.ok(perm.permissionsSource && perm.permissionsTok && perm.permissionStaff.length > 0);
  });

  await check('면별 조회 = 강의실 사용 현황 · 세션 기간(그 해) · 과목별 강사 라벨 — 독립 SQL', async () => {
    const ops = (await load({ tab: 'operations' })).page;
    const [{ n }] = await db`select count(*)::int n from public.classrooms where tenant_id=${tenantId}`;
    assert.equal(ops.classrooms.length, n);
    const sub = (await load({ tab: 'subjects', year: '2026' })).page;
    const [{ p }] = await db`select count(*)::int p from public.operating_periods where tenant_id=${tenantId} and label_year=2026`;
    assert.equal(sub.periodDefs.length, p); assert.equal(sub.sessionYear, 2026);
    assert.ok(Object.values(sub.teacherLabelsBySubject).every(list => list.every((x, i) => i === 0 || list[i - 1].localeCompare(x, 'ko') <= 0)));
  });

  await check('저장(되돌림) = 2.0 saveOwnerSection — 섹션 머지(다른 섹션 그대로) · 최상위 새 키 없음 · 운영·권한은 섹션 안 순번 · 기준 token 거절 · 권한은 원장만 · 신분 정리 · 감사로그', async () => {
    const actions = lf(await src('features/owner/server/actions.ts')), mine = lf(await here('./v2-owner-save.mjs'));
    const body = actions.slice(actions.indexOf('export async function saveOwnerSection('));
    // 대시보드 배치 저장 갈래(기준선 · 고친 부분 · 겹침)는 아직 받지 않는다 — 그 문구만 빼고 대조한다.
    const DASHBOARD_ONLY = /대시보드 설정이 변경|저장 요청을 읽지 못했습니다|다른 저장과 겹쳐/;
    for (const m of body.matchAll(/error: "([^"]+)"/g)) if (!DASHBOARD_ONLY.test(m[1])) assert.ok(mine.includes(m[1]), m[1]);
    const ROLL = new Error('rollback');
    try {
      await db.begin(async sql => {
        const L = p => M.screen.load({ sql, params: p, tenantId, importV2 });
        const save = (form, actor = base.viewer.id) => { const a = M.screen.actions.saveOwnerSection; return a.run({ sql, body: a.validate({ module: 'features/owner/server/actions.ts', actor, args: [null, fd(form)] }), tenantId, importV2 }); };
        const [{ data: before }] = await sql`select data from public.tenant_settings where tenant_id=${tenantId}`;
        const prof = (await L({ tab: 'profile' })).page.settings.profile;
        assert.equal((await save({ section: 'profile', data: { ...prof, name: `${prof.name}(연습)` } })).ok, true);
        const [{ data: mid }] = await sql`select data from public.tenant_settings where tenant_id=${tenantId}`;
        assert.equal(mid.profile.name, `${prof.name}(연습)`);
        assert.deepEqual(Object.keys(mid).sort(), Object.keys(before).sort(), '최상위 새 키 없음');
        for (const k of Object.keys(before).filter(k => !['profile', 'version'].includes(k))) assert.deepEqual(mid[k], before[k], `${k} 그대로`);
        const ops = (await L({ tab: 'operations' })).page;
        const o = await save({ section: 'operations', data: ops.operationsForClient, operationsFace: 'operations', operationsBaseline: ops.operationsTokens.operations });
        assert.equal(o.ok, true); assert.equal(o.version, (before.operations?.rev ?? 0) + 1); assert.ok(o.operations?.tokens);
        assert.deepEqual(await save({ section: 'operations', data: ops.operationsForClient, operationsFace: 'operations', operationsBaseline: 'old' }),
          { error: '다른 창에서 이 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.' });
        const perm = (await L({ tab: 'permissions' })).page;
        const p = await save({ section: 'permissions', data: perm.permissionsSource, permissionsBaseline: perm.permissionsTok });
        assert.equal(p.ok, true); assert.equal(p.version, (before.permissions?.rev ?? 0) + 1);
        assert.deepEqual(await save({ section: 'permissions', data: perm.permissionsSource, permissionsBaseline: 'old' }),
          { error: '다른 창에서 이 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.' });
        if (admin) assert.deepEqual(await save({ section: 'permissions', data: perm.permissionsSource, permissionsBaseline: perm.permissionsTok }, admin.id), { error: '역할·권한은 원장만 변경할 수 있습니다' });
        assert.deepEqual(await save({ section: 'zzz', data: {} }), { error: '알 수 없는 설정 섹션입니다' });
        assert.deepEqual(await save({ section: 'makeups', data: {} }), { error: '연습 화면에서는 아직 지원하지 않는 저장입니다' });
        assert.deepEqual([...await sql`select coalesce(current_setting('request.jwt.claims', true), '') c, coalesce(current_setting('v2.actor_claims', true), '') h`], [{ c: '', h: '' }]);
        const logs = await sql`select target_label, metadata->>'via' via, metadata->>'section' section from public.audit_logs where tenant_id=${tenantId} and created_at = now() and action='owner_settings_update'`;
        assert.deepEqual([...new Set(logs.map(l => l.section))].sort(), ['operations', 'permissions', 'profile']); assert.ok(logs.every(l => l.via === '3.0 연습 복사본'));
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
  });

  await check('연동 면 = 켜진 연동만 탭(지점 스위치 · 모듈 · 라이선스) · 과목별 구글 시트 상태(수학은 옛 설정 시트도) — 독립 SQL', async () => {
    const d = (await load({ tab: 'sheets' })).page.integrations;
    const SUBJECTS = (await src('features/integrations/sheets-provider.ts')).match(/SHEET_EXPORT_SUBJECTS = \[([^\]]+)\]/)[1].replace(/"/g, '').split(',').map(s => s.trim());
    assert.deepEqual(SUBJECTS, ['math', 'english']);
    assert.ok(d.available.includes('sheets'), '시트 연동 모듈 · 라이선스가 켜진 지점');
    const rows = await db`select provider, sync_enabled, last_error from public.user_integrations where tenant_id=${tenantId} and provider in ('google_sheets', 'google_sheets:english')`;
    for (const [i, subject] of SUBJECTS.entries()) {
      const row = rows.find(r => r.provider === (subject === 'math' ? 'google_sheets' : `google_sheets:${subject}`));
      assert.equal(d.sheetStatuses[i].enabled, row?.sync_enabled === true, subject); assert.equal(d.sheetStatuses[i].lastError, row?.last_error ?? null, subject);
    }
    assert.equal(d.saEmail, null, '서비스계정 키는 복사본에 없다');
    assert.equal((await load({ tab: 'profile' })).page.integrations, null, '다른 면에선 읽지 않는다');
  });

  await check('연동 저장(되돌림) = 2.0 setSheetsExportEnabled · setSubjectSheetTarget — 연동 설정 쓰기만 · 과목 검사 · 감사로그(시트 ID 값은 남기지 않음) · 끄면 업무 흐름 신호 sheet-sync-error의 근거가 없어진다', async () => {
    const actions = lf(await src('features/integrations/server/actions.ts'));
    for (const fn of ['setSheetsExportEnabled', 'setSubjectSheetTarget']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`), actions.indexOf('\nexport async function', actions.indexOf(`export async function ${fn}(`) + 10));
      for (const m of body.matchAll(/error: "([^"]+)"/g)) assert.ok(lf(await here('./v2-owner-integrations.mjs')).includes(m[1]), `${fn}: ${m[1]}`);
      for (const m of body.matchAll(/action: "([a-z_]+)"/g)) assert.ok(lf(await here('./v2-owner-integrations.mjs')).includes(`'${m[1]}'`), m[1]);
    }
    assert.match(lf(await src('lib/permissions.ts')), /integration_settings: "연동 설정"/);
    const ROLL = new Error('rollback');
    try {
      await db.begin(async sql => {
        const act = (name, args, actor = base.viewer.id) => { const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module: 'features/integrations/server/actions.ts', actor, args }), tenantId, importV2 }); };
        const failing = async () => (await sql`select count(*)::int n from public.user_integrations where tenant_id=${tenantId} and coalesce(sync_enabled, false) and last_error is not null`)[0].n;
        const before = await failing();
        const failingRows = await sql`select provider from public.user_integrations where tenant_id=${tenantId} and coalesce(sync_enabled, false) and last_error is not null and provider like 'google_sheets%'`;
        for (const r of failingRows) {
          const subject = r.provider === 'google_sheets' ? 'math' : r.provider.split(':')[1];
          assert.deepEqual(await act('setSheetsExportEnabled', [subject, false]), { enabled: false });
        }
        assert.equal(await failing(), before - failingRows.length, '꺼진 연결은 신호 근거에서 빠진다');
        assert.deepEqual(await act('setSubjectSheetTarget', ['english', ' sheet-id ']), { ok: true });
        assert.equal((await sql`select spreadsheet_id from public.user_integrations where tenant_id=${tenantId} and provider='google_sheets:english'`)[0].spreadsheet_id, 'sheet-id');
        assert.deepEqual(await act('setSheetsExportEnabled', ['korean', true]), { error: '지원하지 않는 과목입니다' });
        if (admin) assert.deepEqual(await act('setSheetsExportEnabled', ['math', false], admin.id), { error: '연동 설정 변경 권한이 없습니다' });
        const logs = await sql`select action, target_label, metadata from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.ok(logs.some(l => l.action === 'integration_sheet_target' && l.metadata.cleared === false && !JSON.stringify(l.metadata).includes('sheet-id')), '시트 ID 값은 남기지 않는다');
        assert.ok(logs.every(l => l.metadata.via === '3.0 연습 복사본'));
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-owner-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('owner.js', dist), 'utf8'), html = await readFile(new URL('owner.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리 · 보는 사람 고르기 · 안내 한 줄 — 운영 2.0 주소·외부 주소·저장 요청 없음 · 운영자 설정 면 없음', async () => {
  const js = await here('./v2-screen-owner.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/, /super[-_]?admin|슈퍼관리자|운영 콘솔/i]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /const ID = 'owner'/); assert.match(js, /\[data-v2h-actor\]`\)/);
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /frame\.title = '([^']*)'/].map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
});

console.log(`v2 owner: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
