// 2.0 화면 — 교재 요청 시험 (Docker 복사본 읽기 · 저장은 되돌림 · 네트워크·AI·발송 없음).
//   node experiments/owner-concept/verify-v2-screen-textbook-requests.mjs
// ① 주소 열쇠 ② 그리기 = 2.0 page.tsx return 본문 그대로 ③ 강사 범위 = 독립 SQL ④ 사무실 목록 정렬 ⑤ 요청서 저장(되돌림 · RLS 소유 게이트) ⑥ 호스트 · 3.0 쪽.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as M from './v2-screen-textbook-requests.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');
const fd = obj => ({ $formData: Object.entries(obj).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => [k, String(x)])) });

await check('주소 열쇠 = 2.0 page.tsx searchParams(studentId) + 보는 사람(viewer) + 작성 폼 멘트 읽기(ment) + 업무 흐름 한 주문(orderId)', async () => {
  const page = lf(await src('app/(shell)/textbook-requests/page.tsx'));
  assert.match(page, /searchParams: Promise<\{ studentId\?: string \| string\[\] \}>/);
  assert.deepEqual(Object.keys(M.screen.params).sort(), ['ment', 'orderId', 'studentId', 'viewer']);
  assert.match(lf(await here('./v2-host/src/textbook-requests.tsx')), /q\.set\('orderId', orderId\)/);
});

await check('그리기 = 2.0 textbook-requests/page.tsx return 본문 그대로(학원 이름 기본값 · 요청서 계좌 · ClassNote 모듈 · 소유 판정 id)', async () => {
  const page = lf(await src('app/(shell)/textbook-requests/page.tsx')), mine = lf(await here('./v2-host/src/textbook-requests-page.tsx'));
  const body = page.slice(page.indexOf('  return (\n    <TextbookRequestClient'), page.lastIndexOf('\n}'));
  assert.ok(mine.includes(`  const { rows, students, catalog, isTeacher, settings, logoUrl, user } = d;\n${body}\n}`));
  assert.match(page, /\.map\(\(v\) => \(v \?\? ""\)\.trim\(\)\)\s*\.filter\(Boolean\)/, '초기 학생 = 주소의 studentId(여러 개 · 빈 값 제외)');
  assert.match(lf(await here('./v2-host/src/textbook-requests.tsx')), /search\.getAll\('studentId'\)\.map\(\(v\) => v\.trim\(\)\)\.filter\(Boolean\)/);
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => M.screen.load({ sql, params, tenantId, importV2 }));
try {
  const base = await load({});
  const teachers = base.editors.filter(e => e.role === '강사');

  await check('업무 흐름 주문 id = 최근 100건 밖도 한 건만 더 읽어 맨 앞에 놓고, 강사 범위 밖은 노출하지 않는다', async () => {
    const all = await db`select id::text id from public.textbook_orders where tenant_id=${tenantId}`;
    const current = new Set(base.rows.map(r => r.id));
    const id = all.find(r => !current.has(r.id))?.id ?? base.rows.at(-1)?.id;
    assert.ok(id, '확인할 주문');
    const direct = await load({ orderId: id });
    assert.equal(direct.focusOrderId, id);
    assert.equal(direct.rows[0].id, id);
    assert.equal(direct.rows.filter(r => r.id === id).length, 1);
    const notFound = await load({ orderId: '00000000-0000-4000-8000-000000000001' });
    assert.equal(notFound.focusOrderId, null);
    for (const teacher of teachers.slice(0, 6)) {
      const own = await load({ viewer: teacher.id });
      const foreign = base.rows.find(r => !own.rows.some(x => x.id === r.id));
      if (!foreign) continue;
      const denied = await load({ viewer: teacher.id, orderId: foreign.id });
      assert.equal(denied.focusOrderId, null);
      assert.ok(!denied.rows.some(r => r.id === foreign.id));
      break;
    }
    const host = lf(await here('./v2-host/src/textbook-requests-page.tsx'));
    assert.match(host, /scrollIntoView\(\{ behavior: 'instant', block: 'center' \}\)/);
    assert.match(host, /classList\.add\('ring-2', 'ring-primary'\)/);
  });

  await check('사무실 보기 = 전체 요청 앞 100건(체크 적은 것 → 신청일 최신) · 학생 = 퇴원 제외 전부 · 카탈로그 = 사용 중 단가표', async () => {
    assert.equal(base.isTeacher, false); assert.equal(base.viewer.role, '원장');
    const [{ n }] = await db`select count(*)::int n from public.textbook_orders where tenant_id=${tenantId}`;
    assert.equal(base.rows.length, Math.min(100, n));
    const cc = r => (r.registered ? 1 : 0) + (r.paid ? 1 : 0) + (r.ordered ? 1 : 0);
    for (let i = 1; i < base.rows.length; i++) {
      const a = base.rows[i - 1], b = base.rows[i];
      assert.ok(cc(a) < cc(b) || (cc(a) === cc(b) && (a.requestDate ?? '') >= (b.requestDate ?? '')), `${i}번째 순서`);
    }
    const [{ s }] = await db`select count(*)::int s from public.students where tenant_id=${tenantId} and status::text <> 'withdrawn'`;
    assert.equal(base.students.length, s);
    const [{ c }] = await db`select count(*)::int c from public.textbook_catalog where tenant_id=${tenantId} and is_active`;
    assert.equal(base.catalog.length, c);
    assert.equal(base.logoUrl, null, '로고(파일 저장소)는 싣지 않는다');
  });

  await check('강사 보기 = 담임 ∪ 교시 담당 ∪ 위임 반의 열린 수강 학생 요청 + 본인 작성 요청 · 학생 고르기도 같은 범위(독립 SQL)', async () => {
    let compared = 0;
    for (const tch of teachers.slice(0, 6)) {
      const v = await load({ viewer: tch.id });
      assert.equal(v.isTeacher, true);
      const ids = new Set((await db`select distinct e.student_id::text id from public.enrollments e where e.tenant_id=${tenantId} and e.end_date is null and e.class_id in (
          select id from public.classes where tenant_id=${tenantId} and teacher_id=${tch.id}
          union select class_id from public.class_schedules where tenant_id=${tenantId} and teacher_id=${tch.id}
          union select class_id from public.class_delegations where tenant_id=${tenantId} and delegate_user_id=${tch.id} and revoked_at is null
            and from_date <= (current_date + 7) and to_date >= (current_date - 7))`).map(r => r.id));
      assert.ok(v.rows.every(r => (r.studentId && ids.has(r.studentId)) || r.createdBy === tch.id), `${tch.name}: 범위 밖 요청이 없다`);
      assert.ok(v.students.every(s => ids.has(s.id)), `${tch.name}: 범위 밖 학생이 없다`);
      compared += v.rows.length;
    }
    assert.ok(compared > 0);
  });

  await check('요청서 저장(되돌림) — 요청(여러 학생) · 빈 교재명 · 담당 밖 학생 거절 · 수정 · 남의 요청 거절 · 강사 본인 요청은 강사가 지운다(RLS 소유 게이트) · 멘트', async () => {
    const actionsSrc = lf(await src('features/billing/server/textbook-actions.ts')), mine = lf(await here('./v2-screen-textbook-requests.mjs'));
    for (const fn of ['requestTextbook', 'loadEditableRequest', 'updateTextbookRequest', 'deleteTextbookRequest']) {
      const start = actionsSrc.indexOf(`function ${fn}(`), end = actionsSrc.indexOf('\nexport async function', start + 10);
      for (const m of actionsSrc.slice(start, end < 0 ? undefined : end).matchAll(/error: "([^"]+)"/g)) assert.ok(mine.includes(m[1]), `${fn}: ${m[1]}`);
    }
    const ROLL = new Error('rollback');
    try {
      await db.begin(async sql => {
        const act = (name, args, actor = base.viewer.id) => { const a = M.screen.actions[name];
          const module = name === 'saveMyTextbookMent' ? 'features/billing/server/textbook-notice-actions.ts' : 'features/billing/server/textbook-actions.ts';
          return a.run({ sql, body: a.validate({ module, actor, args }), tenantId, importV2 }); };
        const [s1, s2] = base.students;
        const made = await act('requestTextbook', [null, fd({ bookName: '연습 교재', studentId: [s1.id, s2.id], price: '12,000', notes: '메모' })]);
        assert.equal(made.ok, true); assert.equal(made.created.length, 2);
        const rows = await sql`select price, status, teacher_name, created_by::text created_by, request_date::text d from public.textbook_orders where id = any(${made.created.map(c => c.id)}::uuid[])`;
        assert.ok(rows.every(r => Number(r.price) === 12000 && r.status === 'requested' && r.teacher_name === base.viewer.name && r.created_by === base.viewer.id));
        assert.deepEqual(await act('requestTextbook', [null, fd({ bookName: ' ', studentId: [s1.id] })]), { fieldErrors: { bookName: '교재명을 입력해주세요' } });
        const tch = teachers.find(x => true), tv = await M.screen.load({ sql, params: { viewer: tch.id }, tenantId, importV2 });
        const outside = base.students.find(s => !tv.students.some(x => x.id === s.id));
        assert.deepEqual(await act('requestTextbook', [null, fd({ bookName: 'x', studentId: [outside.id] })], tch.id), { error: '담당 학생만 교재를 요청할 수 있습니다' });
        const id = made.created[0].id;
        assert.deepEqual(await act('updateTextbookRequest', [null, fd({ id, bookName: '연습 교재2', price: '15000' })]), { ok: true });
        assert.deepEqual(await act('deleteTextbookRequest', [null, fd({ id })], tch.id), { error: '담당 학생의 요청만 수정·삭제할 수 있습니다' });
        assert.deepEqual(await act('deleteTextbookRequest', [null, fd({ id })]), { ok: true });
        // 강사가 자기 담당 학생에게 낸 요청 → 강사가 지운다(사용자 역할 + RLS 소유 게이트 통과)
        const mineStudent = tv.students[0];
        const own = await act('requestTextbook', [null, fd({ bookName: '강사 연습 교재', studentId: [mineStudent.id] })], tch.id);
        assert.equal(own.ok, true, own.error);
        assert.deepEqual(await act('deleteTextbookRequest', [null, fd({ id: own.created[0].id })], tch.id), { ok: true });
        // 사용자 역할 쓰기가 끝나면 신분·역할이 들어올 때 값으로(뒤의 서비스 키 자리 쓰기가 이 강사로 판정되지 않게)
        assert.deepEqual([...await sql`select coalesce(current_setting('request.jwt.claims', true), '') c, current_user <> 'authenticated' back`], [{ c: '', back: true }]);
        assert.equal((await sql`select count(*)::int n from public.textbook_orders where id = any(${[id, own.created[0].id]}::uuid[])`)[0].n, 0);
        assert.deepEqual(await act('saveMyTextbookMent', ['  안녕하세요 {학생}  ']), { ok: true });
        assert.equal((await M.screen.load({ sql, params: { ment: '1' }, tenantId, importV2 })).ment, '안녕하세요 {학생}');
        const logs = await sql`select action, metadata->>'via' via from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.deepEqual([...new Set(logs.map(l => l.action))].sort(), ['textbook_order_create', 'textbook_order_delete', 'textbook_order_update']);
        assert.ok(logs.every(l => l.via === '3.0 연습 복사본'));
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    const [{ n }] = await db`select count(*)::int n from public.textbook_orders where tenant_id=${tenantId} and book_name like '%연습 교재%'`;
    assert.equal(n, 0, '되돌린 뒤 남은 연습 요청 0');
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0 · 학부모 발송·첨부는 받지 않는다', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-textbook-requests-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('textbook-requests.js', dist), 'utf8'), html = await readFile(new URL('textbook-requests.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  for (const name of ['sendTextbookNotice', 'prepareTextbookNotice', 'issueTextbookAttachmentTicket', 'registerTextbookAttachment']) assert.ok(!(name in M.screen.actions), name);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리 · 보는 사람 고르기 · 안내 한 줄 — 운영 2.0 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-textbook-requests.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /const ID = 'textbook-requests'/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /\[data-v2h-actor\]`\)/);
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /frame\.title = '([^']*)'/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트|ClassNote/i]) assert.doesNotMatch(shown, bad, String(bad));
});

await check('업무 흐름 orderId가 3.0 해시에서 호스트 iframe 주소로 보존됨', async () => {
  const bridge = await here('./v2-screen-textbook-requests.js');
  assert.match(bridge, /const KEEP = \['studentId', 'orderId'\]/);
  assert.match(bridge, /const query = queryOf\(ctx\.query\)/);
  assert.match(bridge, /frame\.src = `\$\{HOST\}\$\{query \? `\?\$\{query\}` : ''\}`/);
  const host = await here('./v2-host/src/textbook-requests.tsx');
  assert.match(host, /search\.get\('orderId'\)/);
  assert.match(host, /q\.set\('orderId', orderId\)/);
});

console.log(`v2 textbook-requests: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
