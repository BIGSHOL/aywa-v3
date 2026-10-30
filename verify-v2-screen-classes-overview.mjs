import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-classes.mjs';
import { courseCandidate } from './v2-classes-overview.mjs';

assert.equal(courseCandidate('초등 4학년'), 'elem');
assert.equal(courseCandidate('초등 중등 혼합'), 'mixed');
assert.ok(screen.params.program.test('injaewon') && screen.params.course.test('unclassified'));
const action = screen.actions.saveOverviewSettings;
assert.deepEqual(action.validate({ type: 'class', actor: '00000000-0000-4000-8000-000000000001', classId: '00000000-0000-4000-8000-000000000002',
  course: 'elem', capacity: '12' }).capacity, 12);
for (const bad of [{ type: 'class', actor: 'x', classId: 'x', course: 'elem', capacity: 12 },
  { type: 'class', actor: '00000000-0000-4000-8000-000000000001', classId: '00000000-0000-4000-8000-000000000002', course: 'elem', capacity: 0 }])
  assert.throws(() => action.validate(bad));

const db = await openFullDatabase();
try {
  await db.begin('isolation level repeatable read read only', async sql => {
    const load = params => screen.load({ sql, params, tenantId, importV2 });
    const first = await load({});
    assert.equal(first.page, 'overview');
    const root = first.overview;
    const list = await load({ v2path: '/classes', status: 'operating' });
    assert.equal(root.total, list.total, '운영 반 수 = 2.0 목록');
    const all = await sql`select count(*)::int n from public.classes where tenant_id=${tenantId} and is_active and closed_at is null and not coalesce(is_makeup_pool,false)`;
    assert.equal(root.total, all[0].n, '2.0 운영 반 조건');
    for (const [program, name] of [['eie', 'EiE'], ['injaewon', '인재원 영어'], ['math', '수학']]) {
      const line = root.rows.find(r => r.cells.name === name);
      if (!line) continue;
      const count = Number.parseInt(line.cells.classes, 10);
      const overview = (await load({ program })).overview;
      assert.equal(overview.rows.reduce((n, r) => n + Number.parseInt(r.cells.classes, 10), 0), count, `${name} 과정별 반 수`);
      assert.equal((await load({ v2path: '/classes', status: 'operating', program })).total, count, `${name} 2.0 반 목록`);
      const course = overview.rows.find(r => Number.parseInt(r.cells.classes, 10) > 0);
      if (!course) continue;
      const selected = new URLSearchParams(course.href.split('?')[1]).get('course');
      const classes = (await load({ program, course: selected })).overview;
      assert.equal(classes.rows.length, Number.parseInt(course.cells.classes, 10), `${name}/${selected} 반 행 수`);
      assert.equal((await load({ v2path: '/classes', status: 'operating', program, course: selected })).total, classes.rows.length,
        `${name}/${selected} 2.0 필터 목록 행 수`);
      assert.equal(classes.rows.reduce((n, r) => n + r.studentCount, 0), classes.rows.reduce((n, r) => n + Number.parseInt(r.cells.seats, 10), 0),
        '명단 인원 = 2.0 studentCount 합');
    }
    console.log(`수업 현황 7/7 · 운영 반 ${root.total}개 · 명단 ${root.totalSeats}명분 · 2.0 목록/과정/반 대조`);
  });
} finally { await db.end(); }
