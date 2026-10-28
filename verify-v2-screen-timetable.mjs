// 2.0 화면 — 시간표 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-timetable.mjs
// ① 원자료가 2.0 서버 함수의 모양 그대로인가(ScheduleSlot·StudentLine 칸) ② 이력 행(#88)·퇴원 줄 판정을 독립 SQL로 대조
// ③ 옮긴 설정 병합(resolve.ts)이 2.0 원문과 같은가 ④ 호스트가 2.0 부품을 고치지 않고 묶이는가(서버 전용 유입 0 · 운영 주소 0)
// ⑤ 3.0 쪽은 같은 출처 iframe 자리뿐(운영 2.0 주소·끼워 넣기·저장 요청 없음) ⑥ 저장(2단계) — 2.0 함수 이름·반환 모양 그대로,
// 학원이로 트랜잭션 안에서 돌리고 되돌린다(복사본에 흔적 0). 브라우저 확인 스크립트는 work/owner-concept/v2-timetable/.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as T from './v2-screen-timetable.mjs';
import { build } from './v2-host/build.mjs';
import { readEditors, loadExtra, moveClassSlots } from './v2-timetable-save.mjs';
import { V2Error } from './v2-screens.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const R = await T.loadRules(importV2);

await check('옮긴 설정 병합(deepMerge·normalizeSubjects)이 2.0 resolve.ts 본문과 같다', async () => {
  const ts = (await import('typescript')).default;
  const resolve = await src('features/owner/resolve.ts'), mine = await here('./v2-screen-timetable.mjs');
  const fn = (raw, name) => { const text = raw.replace(/\r\n/g, '\n'), i = text.indexOf(`function ${name}`), end = text.indexOf('\n}\n', i); assert.ok(i >= 0 && end > i, `${name} 본문을 찾지 못함`); return text.slice(i, end + 2); };
  // 2.0 본문은 TypeScript로 타입만 걷어 내고, 둘 다 주석·공백·세미콜론을 뺀 글자로 비교한다(로직이 한 글자라도 다르면 실패).
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '');
  for (const name of ['deepMerge', 'normalizeSubjects']) assert.equal(norm(fn(mine, name)), norm(fn(resolve, name)), name);
  assert.deepEqual(T.deepMerge({ a: [1], b: { c: 1, d: 2 }, e: 1 }, { a: [2, 3], b: { c: null, x: 9 }, e: null, z: 1 }), { a: [2, 3], b: { c: 1, d: 2 }, e: 1 });
});

await check('호스트가 옮긴 보강 줄 조립(attachReservedLines)이 2.0 reserved-lines.ts 본문과 같다(조회 두 줄만 받은 자료로)', async () => {
  const ts = (await import('typescript')).default;
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '');
  const tail = raw => { const text = raw.replace(/\r\n/g, '\n'), i = text.indexOf('  const studentById = new Map('); assert.ok(i > 0, '본문 시작을 찾지 못함'); return text.slice(i); };
  const orig = await src('features/timetable/server/reserved-lines.ts'), port = await here('./v2-host/src/timetable-ports.ts');
  assert.equal(norm(`function f(){${tail(port)}`), norm(`function f(){${tail(orig)}`));
  assert.match(port, /data\.reservations\.filter\(\(r\) => wanted\.has\(r\.classId\)\)/, '2.0이 반 목록으로 묻던 조회를 같은 반 목록으로 좁힌다');
});

await check('매개변수는 주(week) + 시간표 X(exit·anchor)뿐 — 나머지(과목·보기·구분…)는 호스트가 2.0처럼 같은 자료에서 다시 조립한다', () => {
  assert.deepEqual(Object.keys(T.screen.params), ['week', 'exit', 'anchor']);
  assert.ok(T.screen.params.anchor.test('2026-09') && !T.screen.params.anchor.test('2026-9') && !T.screen.params.exit.test('Math;'));
  assert.ok(T.screen.params.week.test('2026-10-26') && !T.screen.params.week.test('2026-1-1'));
});

await check('저장 동작 = 2.0 서버 함수 이름 그대로(그 2.0 파일이 실제로 내보내는 함수) · 아직 잇지 않은 함수는 없다(→ 호스트가 보기 전용으로 거절)', async () => {
  const MODULES = { moveEnrollmentsBatch: 'features/enrollments/server/actions.ts', updateEnrollmentsAttendanceBatch: 'features/enrollments/server/actions.ts',
    moveClassSlots: 'features/timetable/server/move-actions.ts', holdSingleEnrollment: 'features/students/server/actions.ts', endSingleEnrollment: 'features/students/server/actions.ts',
    saveMemoSheet: 'features/timetable-memo/server/actions.ts' };
  assert.deepEqual(Object.keys(T.screen.actions).sort(), Object.keys(MODULES).sort());
  for (const [n, file] of Object.entries(MODULES)) {
    const text = await src(file);
    assert.match(text, /^["']use server["']/, file); assert.match(text, new RegExp(`export async function ${n}\\(`), `${file} → ${n}`);
    assert.throws(() => T.screen.actions[n].validate({ module: 'features/other/server/actions.ts', args: [] }), e => e instanceof V2Error && e.status === 400, `${n}: 다른 파일 이름으로는 못 부른다`);
  }
  const shim = await here('./v2-host/shims/server-action.ts');
  assert.match(shim, /fetch\(`\/api\/v2\/\$\{encodeURIComponent\(screen\)\}\/\$\{encodeURIComponent\(name\)\}`/, '같은 출처 공통 틀로만 보낸다');
  assert.doesNotMatch(shim, /https?:\/\//);
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => T.screen.load({ sql, params, tenantId, importV2 }));
try {
  const now = await load({}), past = await load({ week: '2026-09-07' }), bad = await load({ week: '2026-02-31' });
  const queries = await src('features/timetable/server/queries.ts');
  const slotKeys = [...queries.slice(queries.indexOf('export type ScheduleSlot = {'), queries.indexOf('};', queries.indexOf('export type ScheduleSlot = {'))).matchAll(/^\s{2}(\w+)(\?)?:/gm)].map(m => [m[1], !!m[2]]);

  await check('원자료 모양 = 2.0 getWeeklyScheduleWithStudents(배치 칸 전부 · 명단은 반별로 한 번)', () => {
    assert.equal(now.week, R.thisMonday(R.kstToday())); assert.equal(now.referenceDate, R.getWeekReferenceDate(now.week, R.kstToday()));
    assert.equal(bad.week, now.week, '없는 날짜는 이번 주'); assert.equal(past.week, '2026-09-07');
    for (const s of now.allSlots) for (const [k, optional] of slotKeys) if (!optional) assert.ok(k in s, `배치 칸 ${k}`);
    for (const s of now.allSlots) assert.equal(s.studentCount, (now.rosters[s.classId] ?? []).filter(l => l.status === 'active').length);
    const lines = Object.values(now.rosters).flat();
    for (const l of lines) for (const k of ['name', 'grade', 'school', 'enrollmentId', 'studentId', 'status', 'enrollmentDate', 'attendanceDays']) assert.ok(k in l, `명단 칸 ${k}`);
    assert.ok(lines.some(l => l.latestReport), '최근 보고서(같은 RPC)');
    assert.ok(now.settings.operations.subjects.length > 0 && Array.isArray(now.settings.modules.disabled));
    assert.equal(now.viewer.canEdit, true); assert.equal(past.viewer.canEdit, false, '지난 주는 2.0처럼 편집 문이 닫힌다');
    assert.ok(now.viewer.editors.length > 0 && now.viewer.editors[0].role === '원장', '저장할 수 있는 사람 — 원장 먼저');
    for (const c of Object.values(now.teacherColors)) assert.match(c.bg, /^#[0-9a-f]{3,8}$/i);
  });

  await check('조각 원자료 = 2.0 조회 모양(보강 예약 toReservation · 자리 이동·배치 · 예약된 가져오기 · 메모 시트 loadMemoSheet)', async () => {
    const shown = new Set(now.allSlots.map(s => s.classId)), wk = R.weekBoundsOf(now.referenceDate);
    for (const r of now.makeup.reservations) {
      assert.ok(shown.has(r.classId) && r.makeupDate >= wk.start && r.makeupDate <= wk.end && r.status === 'reserved', r.id);
      assert.match(r.slotStart, /^\d{2}:\d{2}$/); assert.match(r.slotEnd, /^\d{2}:\d{2}$/);
    }
    const [{ c }] = await db.begin('isolation level repeatable read read only', sql => sql`select count(*)::int c from public.makeup_reservations where tenant_id=${tenantId} and status='reserved'
      and makeup_date between ${wk.start} and ${wk.end} and class_id = any(${[...shown]}::uuid[])`);
    assert.equal(now.makeup.reservations.length, c, '그 주 · 화면 반 · 예약 상태 예약 전부');
    assert.ok(now.seatWeek.moves === null || Array.isArray(now.seatWeek.moves)); assert.ok(Array.isArray(now.seatWeek.live));
    for (const s of now.scheduledImports) assert.ok(s.effectiveDate > now.today && ['structure', 'enrollment'].includes(s.kind));
    for (const [subject, m] of Object.entries(now.memoSheets)) {
      assert.ok(R.memo.MEMO_SHEET_SUBJECTS.includes(subject));
      if (m.status === 'ok') assert.ok(R.memo.packedSheetSchema.safeParse(m.packed).success, `${subject} 메모 시트 모양`);
    }
  });

  await check('이력 행(#88): 그 주 배치는 요일 칸 날짜에 살아 있는 행만 — 독립 SQL과 배치 행이 같다', async () => {
    for (const d of [now, past]) {
      const start = d.week;
      const rows = await db.begin('isolation level repeatable read read only', sql => sql`
        with days(dow, n) as (values ('mon',0),('tue',1),('wed',2),('thu',3),('fri',4),('sat',5),('sun',6))
        select s.id::text id from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active join days on days.dow = s.day_of_week::text
        where s.tenant_id=${tenantId} and (c.closed_at is null or c.closed_at >= ${d.referenceDate})
          and s.valid_from <= ${start}::date + days.n and (s.valid_to is null or s.valid_to >= ${start}::date + days.n)`);
      assert.deepEqual(d.allSlots.map(s => s.id).sort(), rows.map(r => r.id).sort(), `${d.week} 배치 목록`);
    }
  });

  await check('퇴원 줄은 같은 과목 수강이 남지 않은 학생만 · 한 반에 한 학생은 한 줄', async () => {
    const subjectOf = new Map(now.allSlots.map(s => [s.classId, s.subject]));
    for (const [classId, list] of Object.entries(now.rosters)) assert.equal(new Set(list.map(l => l.studentId)).size, list.length, classId);
    const wd = Object.entries(now.rosters).flatMap(([classId, list]) => list.filter(l => l.status === 'withdrawn').map(l => ({ id: l.studentId, subject: subjectOf.get(classId) })));
    if (!wd.length) return;
    const alive = await db.begin('isolation level repeatable read read only', sql => sql`select distinct e.student_id::text id, c.subject from public.enrollments e join public.classes c on c.id=e.class_id
      join public.students s on s.id=e.student_id where e.tenant_id=${tenantId} and e.student_id = any(${wd.map(w => w.id)}::uuid[]) and e.start_date <= ${now.referenceDate}
      and (e.end_date is null or e.end_date > ${now.referenceDate}) and not (s.status::text='withdrawn' and s.withdrawn_at <= ${now.referenceDate})`);
    const aliveKey = new Set(alive.map(a => `${a.subject}:${a.id}`));
    assert.equal(wd.filter(w => aliveKey.has(`${w.subject}:${w.id}`)).length, 0);
  });

  await check('저장(2단계): 학원이 반 이동·요일 편집·반 블록 옮기기·대기/퇴원 보내기·메모 시트 — 같은 DB 함수·판정 · 2.0 문구·반환 모양 · 알림 줄 · 감사로그 via · 바깥 요청 0 (되돌림)', async () => {
    const STU = '6219e442-aa57-455f-a5bc-834b222d9e1c', ENR = '7d419d88-5a2d-4e32-b29d-c8c19e399e7a', TO = '50d2ece7-6514-4474-8cfc-dd8983d15c18';
    const MOD = 'features/enrollments/server/actions.ts', A = T.screen.actions, ROLL = new Error('rollback'), X = await loadExtra(importV2);
    const tx = async fn => { let out; try { await db.begin(async sql => { out = await fn(sql); throw ROLL; }); } catch (e) { if (e !== ROLL) throw e; } return out; };
    const call = (sql, name, body) => A[name].run({ sql, body: A[name].validate(body), tenantId, importV2 });
    const editors = await tx(sql => readEditors(sql, tenantId, R, X)), supers = (await db`select id::text id from public.super_admins`).map(r => r.id);
    assert.ok(!editors.some(e => supers.includes(e.id)), '운영자 계정은 고를 수 없다');
    const actor = editors[0].id;
    const [teacher] = await db`select id::text id from public.users where tenant_id=${tenantId} and status::text='active' and system_role::text='teacher' limit 1`;
    assert.throws(() => A.moveEnrollmentsBatch.validate({ module: 'x.ts', actor, args: [[]] }), e => e instanceof V2Error && e.status === 400, '다른 파일의 함수 이름으로는 못 부른다');
    assert.throws(() => A.moveEnrollmentsBatch.validate({ module: MOD, actor, args: [[], null, TO] }), e => e.code === 'unsupported', '단체 이동은 아직');
    assert.deepEqual(await tx(sql => call(sql, 'moveEnrollmentsBatch', { module: MOD, actor: teacher.id, args: [[{ enrollmentId: ENR, newClassId: TO }], null] })), { error: '반 이동은 관리자만 할 수 있습니다' });
    assert.deepEqual(await tx(sql => call(sql, 'moveEnrollmentsBatch', { module: MOD, actor, args: [[{ enrollmentId: ENR, newClassId: TO }], '2020-01-01'] })), { error: '적용일은 오늘 이후여야 합니다' });
    assert.deepEqual(await tx(sql => call(sql, 'updateEnrollmentsAttendanceBatch', { module: MOD, actor: teacher.id, args: [[{ enrollmentId: ENR, days: ['mon'] }]] })), { error: '등원 요일 편집은 관리자만 할 수 있습니다' });
    const moved = await tx(async sql => {
      const queued = async () => (await sql`select count(*)::int c from net.http_request_queue`)[0].c, before = await queued();
      const res = await call(sql, 'moveEnrollmentsBatch', { module: MOD, actor, args: [[{ enrollmentId: ENR, newClassId: TO, attendanceDays: [] }], null] });
      const rows = await sql`select class_id::text class_id, start_date::text s, end_date::text e, is_transferred, is_transferred_in from public.enrollments where tenant_id=${tenantId} and student_id=${STU}`;
      const notes = await sql`select title, body, link from public.notifications where tenant_id=${tenantId} and created_at >= now() and link=${`/classes/${TO}`}`;
      const [log] = await sql`select actor_id::text actor_id, target_type, metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_move_batch'`;
      const [cls] = await sql`select teacher_id::text t from public.classes where id=${TO}`;
      return { res, rows, notes, log, cls, extra: (await queued()) - before };
    });
    assert.equal(moved.res.results.length, 1); assert.equal(moved.res.results[0].ok, true, moved.res.results[0].error);
    assert.ok(moved.rows.some(r => r.class_id === TO && r.s === R.kstToday() && !r.e && r.is_transferred_in), '새 반 수강이 오늘부터');
    assert.ok(moved.rows.some(r => r.class_id !== TO && r.is_transferred), '옛 수강이 반 이동으로 닫힌다');
    assert.deepEqual([moved.log.actor_id, moved.log.target_type, moved.log.metadata.via, moved.log.metadata.count, moved.log.metadata.studentIds], [actor, 'student', '3.0 연습 복사본', 1, [STU]]);
    if (moved.cls.t && moved.cls.t !== actor) assert.deepEqual(moved.notes.map(n => [n.title, n.body]), [['반 이동 전입', '학원이 학생이 학원삼(테스트) 반에 전입되었습니다.']]);
    assert.equal(moved.extra, 0, '바깥 요청 대기열이 늘지 않는다');
    const days = await tx(async sql => {
      const res = await call(sql, 'updateEnrollmentsAttendanceBatch', { module: MOD, actor, args: [[{ enrollmentId: ENR, days: ['wed', 'mon', 'xx'] }]] });
      const [row] = await sql`select attendance_days from public.enrollments where id=${ENR}`;
      const [log] = await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_days_update'`;
      return { res, row, log, role: (await sql`select current_user r`)[0].r };
    });
    assert.deepEqual(days.res, { count: 1 }); assert.deepEqual(days.row.attendance_days, ['mon', 'wed'], '요일순 · 유효 요일만(2.0 DAY_ORDER)');
    assert.equal(days.log.metadata.via, '3.0 연습 복사본'); assert.equal(days.role, 'clone_admin', '사용자 역할로 쓴 뒤 원래 역할로');
    const [after] = await db`select class_id::text c, attendance_days, end_date from public.enrollments where id=${ENR}`;
    assert.deepEqual([after.c, after.attendance_days, after.end_date], ['e4a2c026-8992-4211-a5fe-b9e93be8a0f3', [], null], '시험 뒤 복사본은 그대로');

    // 반 블록 옮기기 — 2.0은 출결 확인에서 없는 칸(attendance_records.date)을 읽어 늘 멈춘다: 같은 자리·같은 문구로.
    const SM = 'features/timetable/server/move-actions.ts', CLS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3';
    const [slot] = await db`select id::text id from public.class_schedules where class_id=${CLS} and day_of_week='sat' and start_time='11:00' and valid_to is null`;
    const input = { moves: [{ slotId: slot.id, toDay: 'sat', toStart: '09:00' }] };
    assert.deepEqual(await tx(sql => call(sql, 'moveClassSlots', { module: SM, actor: teacher.id, args: [input] })), { ok: false, error: '시간표를 편집할 권한이 없습니다' });
    assert.deepEqual(await tx(sql => call(sql, 'moveClassSlots', { module: SM, actor, args: [{ moves: [{ slotId: slot.id, toDay: 'sat', toStart: '11:00' }] }] })), { ok: false, error: '같은 자리입니다' });
    assert.deepEqual(await tx(sql => call(sql, 'moveClassSlots', { module: SM, actor, args: [input] })), { ok: false, error: '출결 기록을 확인하지 못해 중단했습니다' });
    const cols = (await db`select column_name c from information_schema.columns where table_schema='public' and table_name='attendance_records'`).map(r => r.c);
    assert.ok(!cols.includes('date') && cols.includes('session_date'), '2.0이 읽는 date 칸이 아직 없다(있으면 위 단언과 이 주석을 고칠 것)');
    // 저장 갈래(2.0이 고쳐졌을 때) — session_date로 판정하면 새 배치는 적용일부터, 옛 배치는 그 전날로 마감, 감사로그 class_schedule_move.
    const fixed = await tx(async sql => ({
      res: await moveClassSlots(sql, tenantId, R, X, actor, [input], { weekSlots: T.weekSlots }, { dateColumn: 'session_date' }),
      rows: await sql`select start_time::text s, valid_from::text vf, valid_to::text vt from public.class_schedules where class_id=${CLS} and day_of_week='sat' and start_time in ('09:00','11:00') and (valid_to is null or valid_to >= current_date - 1)`,
      log: (await sql`select target_label, metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='class_schedule_move'`)[0],
    }));
    assert.deepEqual(fixed.res, { ok: true, moved: 1 });
    const today = R.kstToday();
    assert.ok(fixed.rows.some(r => r.s === '09:00:00' && r.vf === today && r.vt === null), '새 배치 = 적용일부터');
    assert.ok(fixed.rows.some(r => r.s === '11:00:00' && r.vt === R.shiftDays(today, -1)), '옛 배치 = 전날 마감');
    assert.equal(fixed.log.metadata.via, '3.0 연습 복사본'); assert.equal(fixed.log.metadata.moves[0].to.start, '09:00:00');
    const [kept] = await db`select valid_to from public.class_schedules where id=${slot.id}`;
    assert.equal(kept.valid_to, null, '시험 뒤 배치는 그대로');

    // 명단에서 대기·퇴원으로 보내기 — 2.0 form action(FormData)을 { $formData } 줄로 받는다. 권한 = 원생 상태 변경.
    const SA = 'features/students/server/actions.ts', form = o => ({ $formData: Object.entries(o) });
    const reason = (await importV2('features/withdrawals/types.ts')).WITHDRAWAL_REASONS.find(r => r !== '기타');
    const roster = (sql, name, who, fields) => call(sql, name, { module: SA, actor: who, args: [null, form(fields)] });
    assert.deepEqual(await tx(sql => roster(sql, 'holdSingleEnrollment', teacher.id, { enrollmentId: ENR, studentId: STU, date: today })), { error: X.STUDENT_STATUS_DENIED });
    const held = await tx(async sql => ({
      first: await roster(sql, 'holdSingleEnrollment', actor, { enrollmentId: ENR, studentId: STU, date: today }),
      again: await roster(sql, 'holdSingleEnrollment', actor, { enrollmentId: ENR, studentId: STU, date: today }),
      row: (await sql`select on_hold from public.enrollments where id=${ENR}`)[0],
      logs: await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_hold'`,
    }));
    assert.deepEqual([held.first, held.again, held.row.on_hold, held.logs.length, held.logs[0].metadata.via], [undefined, undefined, true, 1, '3.0 연습 복사본'], '대기 · 이미 대기면 기록 없이 통과');
    assert.deepEqual(await tx(sql => roster(sql, 'endSingleEnrollment', actor, { enrollmentId: ENR, studentId: STU, date: today })), { error: '종료 사유를 골라 주세요.' });
    const last = await tx(sql => roster(sql, 'endSingleEnrollment', actor, { enrollmentId: ENR, studentId: STU, date: today, reason }));
    assert.match(last?.error ?? '', /퇴원보고서/, '마지막 반은 퇴원보고서로(2.0 viaReportMessage)');
    const ended = await tx(async sql => {
      await sql`insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (${tenantId}, ${STU}, ${TO}, ${today}::date - 3)`;
      return { res: await roster(sql, 'endSingleEnrollment', actor, { enrollmentId: ENR, studentId: STU, date: today, reason, memo: '시험' }),
        row: (await sql`select end_date::text e, withdrawal_reason r, withdrawal_memo m from public.enrollments where id=${ENR}`)[0],
        log: (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_end'`)[0] };
    });
    assert.deepEqual([ended.res, ended.row.e, ended.row.r, ended.row.m, ended.log.metadata.via], [undefined, today, reason, '시험', '3.0 연습 복사본'], '같은 과목 다른 반이 있으면 종료');
    const [back] = await db`select end_date, on_hold, withdrawal_reason from public.enrollments where id=${ENR}`;
    assert.deepEqual([back.end_date, back.on_hold, back.withdrawal_reason], [null, false, null], '시험 뒤 수강은 그대로');

    // 메모 시트(영어) — version 비교 · 낡은 판은 덮지 않고 최신 판을 돌려준다 · 감사로그 10분 묶음. 학원 공용 판이라 되돌림으로만.
    const MM = 'features/timetable-memo/server/actions.ts', memo = (sql, who, input) => call(sql, 'saveMemoSheet', { module: MM, actor: who, args: [input] });
    const [sheet] = await db`select doc, version from public.timetable_memo_sheets where tenant_id=${tenantId} and subject='english'`;
    if (sheet) {
      const v = Number(sheet.version), packed = sheet.doc;
      assert.deepEqual(await tx(sql => memo(sql, teacher.id, { subject: 'english', packed, baseVersion: v })), { ok: false, error: '시트를 고칠 권한이 없습니다' });
      assert.deepEqual(await tx(sql => memo(sql, actor, { subject: 'math', packed, baseVersion: v })), { ok: false, error: '이 과목에는 시트가 없습니다' });
      assert.equal((await tx(sql => memo(sql, actor, { subject: 'english', packed: { nope: 1 }, baseVersion: v }))).error, '저장할 수 없는 값이 있습니다. 마지막으로 고친 칸을 확인해 주세요.');
      const saved = await tx(async sql => ({ res: await memo(sql, actor, { subject: 'english', packed, baseVersion: v }),
        row: (await sql`select version from public.timetable_memo_sheets where tenant_id=${tenantId} and subject='english'`)[0],
        logs: await sql`select target_label, metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='timetable_memo_sheet_save'` }));
      assert.equal(saved.res.ok, true); assert.equal(saved.res.version, v + 1); assert.equal(Number(saved.row.version), v + 1);
      assert.ok(saved.logs.length <= 1 && (saved.logs.length === 0 || saved.logs[0].metadata.via === '3.0 연습 복사본'), '감사로그는 많아야 한 줄(10분 묶음)');
      for (const stale of [v - 1, 0]) {
        const c = await tx(sql => memo(sql, actor, { subject: 'english', packed, baseVersion: stale }));
        assert.deepEqual([c.ok, c.conflict, c.version], [false, true, v], `낡은 판(${stale})은 최신 판을 돌려준다`);
        assert.ok(R.memo.packedSheetSchema.safeParse(c.packed).success);
      }
      const [still] = await db`select version from public.timetable_memo_sheets where tenant_id=${tenantId} and subject='english'`;
      assert.equal(Number(still.version), v, '시험 뒤 판은 그대로');
    }
  });

  await check('시간표 X = 2.0 loadExitOverlay 모양 · 줄의 학생은 그 달 창에 실제로 퇴원(퇴원)·그 과목 수강을 끝낸(수강종료) 사람 — 독립 SQL', async () => {
    const read = params => db.begin('isolation level repeatable read read only', sql => T.screen.load({ sql, params, tenantId, importV2 }));
    assert.deepEqual(await read({ exit: 'nope' }), { ok: false, error: '과목을 찾을 수 없습니다' });
    assert.deepEqual(await read({ exit: 'math', anchor: '2020-01' }), { ok: false, error: '볼 수 없는 달입니다' });
    const r = await read({ exit: 'math', anchor: '2026-09' });
    assert.equal(r.ok, true, r.error);
    const d = r.data;
    assert.deepEqual(d.months.map(m => m.month), ['2026-09', '2026-08', '2026-07']);
    assert.equal(d.subjectLabel, '수학'); assert.equal(d.canNewer, true); assert.match(d.withdrawalsHref, /^\/withdrawals\?range=custom&from=2026-07-01&to=2026-09-30&subject=math$/);
    assert.ok(d.months.every(m => m.holds === null), '지난 묶음엔 지금 휴원을 싣지 않는다');
    for (const m of d.months) {
      const from = `${m.month}-01`;
      const rows = m.groups.flatMap(g => g.rows);
      const wd = [...new Set(rows.filter(x => x.kind === 'withdrawn').map(x => x.key))], se = [...new Set(rows.filter(x => x.kind === 'subject-ended').map(x => x.key.split('|')[0]))];
      if (wd.length) {
        const ok = await db`select s.id::text id from public.students s where s.tenant_id=${tenantId} and s.id = any(${wd}::uuid[]) and s.status::text='withdrawn'
          and s.withdrawn_at between ${from}::date and (${from}::date + interval '1 month' - interval '1 day')::date
          and exists (select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and c.subject='math' and e.end_date is not null)`;
        assert.deepEqual(ok.map(x => x.id).sort(), [...wd].sort(), `${m.month} 퇴원 줄`);
      }
      if (se.length) {
        const ok = await db`select s.id::text id from public.students s where s.tenant_id=${tenantId} and s.id = any(${se}::uuid[]) and s.status::text in ('enrolled','on_hold')
          and exists (select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and c.subject='math'
            and e.end_date between ${from}::date and (${from}::date + interval '1 month' - interval '1 day')::date)`;
        assert.deepEqual(ok.map(x => x.id).sort(), [...se].sort(), `${m.month} 수강종료 줄`);
      }
    }
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 서버 액션은 자리표시 · 운영 주소·외부 호출 0', async () => {
  // 4310이 내주는 dist/는 건드리지 않는다 — 시험용 폴더에 따로 짓는다.
  const outdir = path.join(os.tmpdir(), `v2-host-verify-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  assert.ok(info.actions.some(a => a.includes('enrollments')), '2.0 서버 액션이 자리표시로 바뀐다');
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('timetable.js', dist), 'utf8'), html = await readFile(new URL('timetable.html', dist), 'utf8');
  assert.ok(!existsSync(new URL('meta.json', dist)), '파일 경로가 담긴 meta.json은 기본으로 쓰지 않는다');
  // 묶음 안의 http(s) 주소는 이름공간·문서 링크뿐이어야 한다 — 서비스 주소(운영 2.0·DB·발송처)는 하나도 없다.
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  assert.match(html, /<script type="module" src="timetable\.js">/); assert.ok(info.cssBytes > 100_000, '2.0 globals.css가 Tailwind로 컴파일된다');
  const css = await readFile(new URL('host.css', dist), 'utf8');
  for (const cls of ['.embed-main', '.border-collapse', '.compact-chrome\\:hidden']) assert.ok(css.includes(cls), `2.0 클래스 ${cls}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 2.0 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-timetable.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  const nav = await here('./v2-host/shims/host-nav.ts');
  assert.match(nav, /window\.location\.origin\)/, '부모에게는 같은 출처로만 알린다');
});

console.log(`v2 timetable: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
