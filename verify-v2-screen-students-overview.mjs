import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-students.mjs';
import { studentsBase } from './v2-students-common.mjs';

// 프로그램 → 과정 → 반 → 2.0 목록. 모든 조회는 같은 읽기 전용 스냅샷에서 대조한다.
const wrap = await readFile(new URL('./v2-screen-students.js', import.meta.url), 'utf8');
const host = await readFile(new URL('./v2-host/src/students.tsx', import.meta.url), 'utf8');
assert.match(wrap, /'classId'/);
assert.match(host, /pickQuery\(search, \[\.\.\.KEYS, 'classId'\]\)/);
assert.ok(screen.params.classId.test('00000000-0000-4000-8000-000000000001'));
assert.ok(!screen.params.classId.test('anything'));

const db = await openFullDatabase();
try {
  await db.begin('isolation level repeatable read read only', async sql => {
    const load = params => screen.load({ sql, params, tenantId, importV2 });
    const first = await load({});
    assert.equal(first.page, 'overview');
    const root = first.overview;
    assert.ok(root && root.rows.length >= 3);
    assert.equal(root.columns.find(c => c.key === 'classes')?.label, '재원생 있는 반');
    const withdrawalMentions = root.rows.reduce((n, row) => n + Number.parseInt(row.cells.withdrawn, 10), 0);
    assert.ok(withdrawalMentions >= root.monthly.withdrawn);
    assert.match(root.note, new RegExp(`프로그램별 퇴원 합 ${withdrawalMentions}명분.*퇴원 원생 ${root.monthly.withdrawn}명`));
    const base = await studentsBase({ sql, tenantId, importV2 });
    const C = await importV2('features/students/enrollment/enrolled-composition.ts');
    const rows = await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id,
      e.start_date::text start_date, c.subject, c.english_track from public.enrollments e
      join public.classes c on c.id=e.class_id and c.tenant_id=${tenantId}
      join public.students s on s.id=e.student_id and s.tenant_id=${tenantId} and s.status='enrolled'
      where e.tenant_id=${tenantId} and e.end_date is null and e.on_hold=false`;
    const students = await sql`select id::text id, grade, school from public.students where tenant_id=${tenantId} and status='enrolled'`;
    const active = rows.map(e => ({ ...e, class: { subject: e.subject, english_track: e.english_track } }));
    const composition = C.composeEnrolled({ students, rows: active, scope: null, subjects: base.settings.operations.subjects, today: base.today });
    const expected = C.summarizePrograms(composition.students.map(s => s.id), composition.programs, composition.active);
    assert.deepEqual(root.totals, expected, '프로그램 숫자 = 2.0 summarizePrograms');
    assert.equal(root.total, composition.students.length, '전체 재원 = 2.0 composeEnrolled');
    for (const [key, name] of [['eie', 'EiE'], ['injaewon', '인재원 영어'], ['math', '수학']]) {
      const p = root.rows.find(r => r.cells.name === name);
      assert.ok(p, `${name} 줄`);
      assert.equal(Number.parseInt(p.cells.enrolled, 10), expected[key]);
      const detail = (await load({ program: key })).overview;
      assert.equal(detail.rows.reduce((n, r) => n + Number.parseInt(r.cells.enrolled, 10), 0), expected[key], `${name} 과정 합`);
      for (const level of detail.rows.filter(r => Number.parseInt(r.cells.enrolled, 10) > 0).slice(0, 1)) {
        const course = new URLSearchParams(level.href.split('?')[1]).get('course');
        const classes = (await load({ program: key, course })).overview;
        const members = new Set();
        for (const cls of classes.rows.filter(r => Number.parseInt(r.cells.enrolled, 10) > 0).slice(0, 1)) {
          const params = Object.fromEntries(new URLSearchParams(cls.href.split('?')[1]));
          const list = await load(params);
          assert.equal(list.page.total, Number.parseInt(cls.cells.enrolled, 10), `${name}/${course}/${cls.cells.name} 마지막 목록 행 수`);
          for (const item of list.page.rows) members.add(item.id);
        }
        assert.ok(members.size <= Number.parseInt(level.cells.enrolled, 10), '한 원생이 여러 반에 있을 수 있다');
      }
    }
    const month = base.today.slice(0, 7);
    const M = await importV2('features/students/status/merged.ts');
    const B = await importV2('features/withdrawals/system-bulk.ts');
    const monthStudents = await sql`select id::text id, status::text status, enrolled_at::text enrolled_at,
      withdrawn_at::text withdrawn_at, notes, withdrawal_metadata from public.students
      where tenant_id=${tenantId} and (enrolled_at >= ${month + '-01'}::date or withdrawn_at >= ${month + '-01'}::date or status='on_hold')`;
    const ended = await sql`select distinct student_id::text id from public.enrollments where tenant_id=${tenantId} and end_date is not null`;
    const hadHistory = new Set(ended.map(r => r.id));
    const newCount = monthStudents.filter(s => s.status === 'enrolled' && s.enrolled_at?.slice(0, 7) === month && !M.isMergedStudent(s.notes)).length;
    const withdrawnCount = monthStudents.filter(s => s.status === 'withdrawn' && s.withdrawn_at?.slice(0, 7) === month && s.withdrawn_at.slice(0, 10) <= base.today
      && !M.isMergedStudent(s.notes) && !B.isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: hadHistory.has(s.id) })).length;
    const holdCount = monthStudents.filter(s => s.status === 'on_hold').length;
    assert.deepEqual(root.monthly, { newly: newCount, withdrawn: withdrawnCount, hold: holdCount }, '월간 분류 전 전체 수치와 일치');
    console.log(`원생 현황 8/8 · 재원 ${root.total}명 · 신규 ${newCount}명 · 퇴원 ${withdrawnCount}명 · 휴원 ${holdCount}명 · 반 목록 대조`);
  });
} finally { await db.end(); }
