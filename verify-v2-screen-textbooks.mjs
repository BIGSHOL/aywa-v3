// 2.0 화면 — 교재목록 시험 (Docker 복사본 읽기 · 저장은 되돌림 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-textbooks.mjs
// ① 주소 열쇠 = 2.0 page.tsx searchParams + 보는 사람 ② 그리기 = 2.0 page.tsx 조회 뒤 본문 그대로(글자 대조)
// ③ 보는 사람·쓰기 자격 = 2.0 권한 표 ④ 목록 숫자 = 독립 SQL ⑤ 교재 마스터 저장(되돌림) ⑥ 호스트 묶음 · 3.0 쪽 안내.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as M from './v2-screen-textbooks.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');

await check('주소 열쇠 = 2.0 page.tsx가 읽는 칸(tab · subject · area · q · page) + 보는 사람(viewer) + 다이얼로그 상세 읽기(detail)', async () => {
  const page = lf(await src('app/(shell)/textbooks/page.tsx'));
  assert.deepEqual([...new Set([...page.matchAll(/sp\.(\w+)/g)].map(m => m[1]))].sort(), ['area', 'page', 'q', 'subject', 'tab']);
  assert.deepEqual(Object.keys(M.screen.params).sort(), ['area', 'detail', 'page', 'q', 'subject', 'tab', 'viewer']);
});

await check('그리기 = 2.0 textbooks/page.tsx 조회 뒤 본문 그대로(면 상태 판정 · 쓰기 잠금 · 구분 목록 · 면 탭 · 세 면)', async () => {
  const page = lf(await src('app/(shell)/textbooks/page.tsx')), mine = lf(await here('./v2-host/src/textbooks-page.tsx'));
  const body = page.slice(page.indexOf('  // 표 없음(missing-table)이 그냥 실패보다 먼저'), page.lastIndexOf('\n}'));
  assert.ok(mine.includes(`  const { canWrite, canImport, list, plans, mathPlans } = d;\n\n${body}\n}`), '본문이 글자 그대로');
  // 조회 앞부분은 2.0과 같은 함수로 주소에서 읽는다
  for (const line of ['  const tab = resolveTextbookTab(sp.tab);', '  const subject = resolveTextbookSubject(sp.subject);']) { assert.ok(page.includes(line)); assert.ok(mine.includes(line)); }
  const code = mine.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\bawait\b|requireAccess|getCurrentUser/, '서버 호출이 남지 않는다');
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => M.screen.load({ sql, params, tenantId, importV2 }));
try {
  const base = await load({});
  const teacher = base.editors.find(e => e.role === '강사');

  await check('보는 사람 = 교재목록 권한이 있는 재직 직원(운영자 계정 제외 · 원장 먼저) · 쓰기 = full|scoped · 엑셀로 넣기 = full · 강사는 읽기만', async () => {
    const supers = (await db`select id::text id from public.super_admins`).map(r => r.id);
    assert.ok(base.editors.length > 0 && !base.editors.some(e => supers.includes(e.id)));
    assert.equal(base.viewer.id, base.editors[0].id); assert.equal(base.editors[0].role, '원장');
    assert.deepEqual([base.canWrite, base.canImport], [true, true]);
    const t = await load({ viewer: teacher.id });
    assert.deepEqual([t.canWrite, t.canImport], [false, false], '강사 = readonly(2.0 기본 권한 표)');
  });

  await check('교재 면 = 과목별 · 한 쪽 50권 · 정렬(구분 → 이름) · 건수·배정 수 = 독립 SQL · 검색 글자는 와일드카드가 아니다', async () => {
    for (const subject of ['english', 'math']) {
      const d = subject === 'english' ? base : await load({ subject });
      const [{ n }] = await db`select count(*)::int n from public.textbooks where tenant_id=${tenantId} and subject=${subject}`;
      assert.equal(d.list.total, n, subject); assert.equal(d.list.rows.length, Math.min(50, n));
      const ids = d.list.rows.map(r => r.id);
      const plans = subject === 'math'
        ? await db`select textbook_id::text id, count(*)::int n from public.math_textbook_assignments where tenant_id=${tenantId} and textbook_id = any(${ids}::uuid[]) group by 1`
        : await db`select textbook_id::text id, count(*)::int n from public.class_textbook_plans where tenant_id=${tenantId} and is_active and textbook_id = any(${ids}::uuid[]) group by 1`;
      const byId = new Map(plans.map(p => [p.id, p.n]));
      for (const r of d.list.rows) assert.equal(r.planCount, byId.get(r.id) ?? 0, r.title);
      const order = await db`select id::text id from public.textbooks where tenant_id=${tenantId} and subject=${subject} order by skill_area asc nulls last, title asc limit 50`;
      assert.deepEqual(ids, order.map(o => o.id));
    }
    assert.equal((await load({ q: '100%' })).list.total, (await db`select count(*)::int n from public.textbooks where tenant_id=${tenantId} and subject='english' and strpos(title, '100%') > 0`)[0].n);
    const p2 = await load({ page: '2' }); assert.equal(p2.list.page, 2); assert.ok(p2.list.rows.every(r => !base.list.rows.some(x => x.id === r.id)));
  });

  await check('반 배정 면 = 영어는 살아 있는 배정 전부(원장) · 강사는 강사 시트 담당 범위 · 수학은 반·학생 교재 배정 전부', async () => {
    const plans = await load({ tab: 'plans' });
    const [{ n }] = await db`select count(*)::int n from public.class_textbook_plans where tenant_id=${tenantId} and is_active`;
    assert.equal(plans.plans.status, 'ok'); assert.equal(plans.plans.rows.length, n);
    assert.equal(plans.mathPlans, null);
    for (const tch of base.editors.filter(e => e.role === '강사')) {
      const tp = await load({ tab: 'plans', viewer: tch.id });
      const own = new Set((await db`select id::text id from public.classes where tenant_id=${tenantId} and teacher_id=${tch.id}
        union select class_id::text from public.class_schedules where tenant_id=${tenantId} and teacher_id=${tch.id}
        union select class_id::text from public.class_delegations where tenant_id=${tenantId} and delegate_user_id=${tch.id}`).map(r => r.id));
      assert.ok(tp.plans.rows.every(r => own.has(r.classId)), `${tch.name}: 담당 밖 반 배정이 없다`);
    }
    const math = await load({ tab: 'plans', subject: 'math' });
    const [{ m }] = await db`select count(*)::int m from public.math_textbook_assignments where tenant_id=${tenantId}`;
    assert.equal(math.mathPlans.status, 'ok'); assert.equal(math.mathPlans.rows.length, m);
  });

  await check('교재 마스터 저장(되돌림) — 등록 · 같은 이름 거절 · 강사 거절 · 학년 값 거절 · 수정 · 차수 표(빈 차수는 지움) · 상세(강사도 읽기) · 삭제 — 문구·감사로그 2.0 그대로', async () => {
    const actions = lf(await src('features/textbooks/server/actions.ts')), mine = lf(await here('./v2-textbooks-save.mjs'));
    for (const m of actions.matchAll(/error: "([^"]+)"/g)) assert.ok(mine.includes(m[1]), m[1]);
    for (const m of actions.matchAll(/action: "([a-z_]+)"/g)) assert.ok(mine.includes(`'${m[1]}'`), m[1]);
    const ROLL = new Error('rollback');
    try {
      await db.begin(async sql => {
        const act = (name, args, actor = base.viewer.id) => { const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module: 'features/textbooks/server/actions.ts', actor, args }), tenantId, importV2 }); };
        const made = await act('saveTextbook', [{ subject: 'english', skillArea: 'grammar', title: '연습 시험 교재', pageTime: '30분', sessionCount: 3 }]);
        assert.equal(made.ok, true);
        assert.deepEqual(await act('saveTextbook', [{ subject: 'english', skillArea: null, title: ' 연습 시험 교재 ', pageTime: null, sessionCount: 1 }]), { ok: false, error: '이미 같은 이름의 교재가 있습니다' });
        assert.deepEqual(await act('saveTextbook', [{ subject: 'english', skillArea: null, title: 'x', pageTime: null, sessionCount: 1 }], teacher.id), { ok: false, error: '교재목록을 수정할 권한이 없습니다' });
        assert.deepEqual(await act('saveTextbook', [{ subject: 'math', skillArea: null, title: 'y', pageTime: null, sessionCount: 1, gradeTerm: '고9-1' }]), { ok: false, error: '학년·학기 값이 올바르지 않습니다' });
        assert.deepEqual(await act('saveTextbook', [{ id: made.id, subject: 'english', skillArea: 'grammar', title: '연습 시험 교재2', pageTime: '30분', sessionCount: 4 }]), { ok: true, id: made.id });
        assert.deepEqual(await act('saveTextbookLessons', [made.id, [{ lessonNo: 1, progress: ' p1 ', homework: null }, { lessonNo: 2, progress: 'p2', homework: 'h2' }]]), { ok: true });
        assert.deepEqual(await act('saveTextbookLessons', [made.id, [{ lessonNo: 2, progress: '', homework: ' ' }]]), { ok: true });
        const d = await M.screen.load({ sql, params: { detail: made.id, viewer: teacher.id }, tenantId, importV2 });
        assert.equal(d.ok, true); assert.equal(d.detail.lessons.length, 4);
        assert.deepEqual(d.detail.lessons.slice(0, 2), [{ lessonNo: 1, progress: 'p1', homework: null }, { lessonNo: 2, progress: null, homework: null }]);
        assert.deepEqual(await act('deleteTextbook', [made.id]), { ok: true });
        assert.deepEqual(await act('deleteTextbook', [made.id]), { ok: false, error: '교재를 찾을 수 없습니다' });
        assert.equal((await sql`select count(*)::int n from public.textbook_lessons where tenant_id=${tenantId} and textbook_id=${made.id}`)[0].n, 0, '차수 표도 함께 지워진다(FK cascade)');
        const logs = await sql`select action, metadata->>'via' via from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.deepEqual([...new Set(logs.map(l => l.action))].sort(), ['textbook_create', 'textbook_delete', 'textbook_lessons_save', 'textbook_update']);
        assert.ok(logs.every(l => l.via === '3.0 연습 복사본'));
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0 · 표지 올리기는 보내지 않는다', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-textbooks-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('textbooks.js', dist), 'utf8'), html = await readFile(new URL('textbooks.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  assert.ok(!('issueTextbookCoverTicket' in M.screen.actions) && !('registerTextbookCover' in M.screen.actions), '표지(파일 저장소)는 받지 않는다');
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리 · 보는 사람 고르기 · 안내 한 줄 — 운영 2.0 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-textbooks.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  assert.match(js, /const ID = 'textbooks'/); assert.match(js, /\[data-v2h-actor\]`\)/);
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /frame\.title = '([^']*)'/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
});

console.log(`v2 textbooks: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
