// 원스크린 2단계 저장 더하기 시험 — node --test experiments/owner-concept/verify-v2-onescreen-save-extra.mjs
// 보강 넷 · 영상 검사 칸 둘을 복사본에 실제로 쓰고 트랜잭션째 되돌린다(테스트 학생 '학원이' · 테스트 반 '학원이(테스트)' · '학원삼(테스트)'만).
// 함수마다: 정상 저장 = 표·감사로그가 2.0 기대값 · 대표 거절 문구 · 바깥 큐(pg_net) 증가 0 · 저장하는 사람 신분(request.jwt.claims)은 들어올 때 값으로.
// 이동: 감싸개(v2-screen-onescreen.js)의 /onescreen/video-homework → #v2-video-homework?view=mine 변환을 코드에서 꺼내 시험한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { screen } from './v2-screen-onescreen.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }

const STUDENT = '6219e442-aa57-455f-a5bc-834b222d9e1c', CLASS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3', CLASS2 = '50d2ece7-6514-4474-8cfc-dd8983d15c18',
  ENGLISH = 'e175fd4d-a655-409a-905e-71850ab1b848', TEACHER = '94007db7-12d3-4b5d-97f2-39071446536b';
const ATT = 'features/attendance/server/actions.ts', RES = 'features/attendance/server/makeup-reservation-actions.ts', VID = 'features/video-homework/server/actions.ts';
const shift = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ROLLBACK = Symbol('rollback');

test('입력 모양: 모듈·actor·args 하나가 아니면 거절(2.0 입력 판정은 저장 안에서)', () => {
  const v = (name, raw) => () => screen.actions[name].validate(raw);
  assert.throws(v('linkMakeupToAbsence', { module: RES, actor: TEACHER, args: [{}] }), /입력 값/, '다른 모듈');
  assert.throws(v('checkMakeupReservation', { module: RES, actor: 'x', args: [{}] }), /입력 값/, 'actor uuid');
  assert.throws(v('setVideoHomeworkMark', { module: VID, actor: TEACHER, args: [] }), /입력 값/, 'args 비었음');
  assert.throws(v('setVideoHomeworkMarksBulk', { module: VID, actor: TEACHER, args: [[]] }), /입력 값/, '입력이 객체가 아님');
  for (const [name, module] of [['linkMakeupToAbsence', ATT], ['setReservationReportMode', RES], ['moveReservationToRegular', RES], ['checkMakeupReservation', RES],
    ['setVideoHomeworkMark', VID], ['setVideoHomeworkMarksBulk', VID]]) assert.equal(screen.actions[name].validate({ module, actor: TEACHER, args: [{ a: 1 }] }).input.a, 1, name);
});

test('복사본: 보강 넷 · 영상 검사 칸 둘 — 2.0과 같은 표·감사로그, 거절 문구, 바깥 큐 0', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs'), { importV2 } = await import('./v2-bridge.mjs');
  const run = (sql, name, module, input, actor = TEACHER) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module, actor, args: [input] }), tenantId: t, importV2 });
  await db.begin(async (sql) => {
    const { asOf: day } = await screen.load({ sql, params: { teacher: TEACHER }, tenantId: t, importV2 });
    const [{ n: net0 }] = await sql`select count(*)::int n from net.http_request_queue`;
    const [{ c: claims0 }] = await sql`select coalesce(current_setting('request.jwt.claims', true), '') c`; // 비어 있음(null) = '' — auth.uid()는 둘을 같게 본다
    const [{ m: audit0 }] = await sql`select coalesce(max(created_at), 'epoch') m from public.audit_logs where tenant_id=${t}`;
    const audits = (action) => sql`select actor_id::text actor_id, target_label, metadata from public.audit_logs where tenant_id=${t} and action=${action} and created_at >= ${audit0} and metadata->>'via' = '3.0 연습 복사본' order by created_at`;
    const reserve = async (classId, makeupDate, absenceDate, slot = '16:20') => (await sql`insert into public.makeup_reservations
      (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, created_by) values (${t}, ${STUDENT}, ${classId}, ${absenceDate}, ${makeupDate}, ${slot}, '17:15', ${TEACHER}) returning id::text id`)[0].id;
    await sql`delete from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and session_date between ${shift(day, -10)} and ${day}`;
    await sql`delete from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT}`;

    // ── setReservationReportMode ──
    const r1 = await reserve(CLASS, day, shift(day, -3));
    assert.deepEqual(await run(sql, 'setReservationReportMode', RES, { studentId: STUDENT, classId: CLASS, date: day, mode: 'x' }), { error: '잘못된 요청입니다' });
    assert.deepEqual(await run(sql, 'setReservationReportMode', RES, { studentId: STUDENT, classId: CLASS, date: day, mode: 'separate' }), { ok: true, updated: 1 });
    assert.equal((await sql`select report_mode from public.makeup_reservations where id=${r1}`)[0].report_mode, 'separate');
    const [modeLog] = await audits('makeup_reserve_report_mode');
    assert.deepEqual([modeLog.actor_id, modeLog.metadata.mode, modeLog.metadata.reservationIds], [TEACHER, 'separate', [r1]]);
    assert.equal((await sql`select coalesce(current_setting('request.jwt.claims', true), '') c`)[0].c, claims0, '저장하는 사람 신분은 끝나면 되돌린다');

    // ── moveReservationToRegular ── 학원이를 그날 학원삼(같은 과목)에도 다니게 하고 학원이(테스트) 예약을 그쪽 정규 수업으로 옮긴다.
    await sql`insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (${t}, ${STUDENT}, ${CLASS2}, ${shift(day, -30)})`;
    assert.deepEqual(await run(sql, 'moveReservationToRegular', RES, { studentId: STUDENT, date: day, fromClassId: CLASS, toClassId: ENGLISH }),
      { error: '합칠 반을 다시 확인해 주세요 — 그날 이 학생이 다니는 같은 과목 반만 됩니다' });
    const moved = await run(sql, 'moveReservationToRegular', RES, { studentId: STUDENT, date: day, fromClassId: CLASS, toClassId: CLASS2 });
    assert.equal(moved.ok, true); assert.equal(moved.moved, 1);
    const [mv] = await sql`select class_id::text class_id, absence_class_id::text absence_class_id, report_mode, status from public.makeup_reservations where id=${r1}`;
    assert.deepEqual(mv, { class_id: CLASS2, absence_class_id: CLASS, report_mode: 'merge', status: 'reserved' });
    const [moveLog] = await audits('makeup_reserve_host_move');
    assert.deepEqual([moveLog.metadata.fromClassId, moveLog.metadata.classId, moveLog.metadata.reportMode], [CLASS, CLASS2, 'merge']);
    assert.match(moveLog.target_label, /^학원이 · 학원삼\(테스트\)$/);
    assert.deepEqual(await run(sql, 'moveReservationToRegular', RES, { studentId: STUDENT, date: day, fromClassId: CLASS, toClassId: CLASS2 }),
      { error: '옮길 보강 예약을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요' });
    await sql`delete from public.makeup_reservations where id=${r1}`;

    // ── checkMakeupReservation ── 출결이 없는 날 '했음' → 원스크린 칸 저장(출석) + 이행 → 예약 done · 다시 '못 했음' → 예약 지움
    assert.deepEqual(await run(sql, 'checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS, date: day, outcome: 'done' }),
      { error: '확인할 보강 예약을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요' });
    const r2 = await reserve(CLASS, day, shift(day, -3));
    const done = await run(sql, 'checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS, date: day, outcome: 'done' });
    assert.equal(done.ok, true); assert.equal(done.outcome, 'done'); assert.equal(done.marked, 'present'); assert.equal(done.checkUnsaved, true, '복사본엔 checked_at 칸이 없다');
    const [rv] = await sql`select status, attendance_record_id::text rec from public.makeup_reservations where id=${r2}`;
    assert.equal(rv.status, 'done');
    const [cell] = await sql`select id::text id, status::text status, recorded_by::text recorded_by from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and session_date=${day}`;
    assert.deepEqual([cell.status, cell.recorded_by, rv.rec], ['present', TEACHER, cell.id]);
    const [checkLog] = await audits('makeup_reserve_check');
    assert.deepEqual([checkLog.metadata.outcome, checkLog.metadata.checkUnsaved, checkLog.metadata.marked], ['done', true, 'present']);
    // 2.0 setAttendanceCell(units: "") — 칸 감사로그에 units: null · 응답 units는 그 칸의 자동값(없으면 키 없음, null이면 null).
    const [cellLog] = await audits('attendance_cell');
    assert.equal(Object.hasOwn(cellLog.metadata, 'units') && cellLog.metadata.units, null, 'attendance_cell에 units: null');
    const autoKey = Object.hasOwn(cellLog.metadata, 'autoUnits');
    assert.equal(Object.hasOwn(done, 'units'), Object.hasOwn(checkLog.metadata, 'units'), '응답과 감사로그의 units 키가 같다');
    if (autoKey) assert(Object.hasOwn(done, 'units'), '자동 시수가 들어간 새 칸이면 units가 실린다');
    const missed = await run(sql, 'checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS, date: day, outcome: 'missed' });
    assert.equal(missed.ok, true);
    assert.equal((await sql`select count(*)::int n from public.makeup_reservations where id=${r2}`)[0].n, 0, '못 했음 = 예약을 지운다');
    // 결석이 찍힌 날은 '했음'을 막는다(2.0 문구).
    await sql`delete from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and session_date=${day}`;
    await reserve(CLASS, day, shift(day, -3));
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${day}, 'absent', ${TEACHER})`;
    assert.deepEqual(await run(sql, 'checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS, date: day, outcome: 'done' }),
      { error: '그날 출결이 결석이라 보강을 했다고 기록할 수 없습니다 — 출결을 먼저 고쳐 주세요' });
    await sql`delete from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT}`;
    await sql`delete from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and session_date=${day}`;

    // ── linkMakeupToAbsence ── 이틀 전 결석 칸에 '보강 완료' 메모 · 오늘 보강 칸(새로) 출석 + 시수 + 메모
    const absent = shift(day, -2);
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${absent}, 'absent', ${TEACHER})`;
    assert.deepEqual(await run(sql, 'linkMakeupToAbsence', ATT, { studentId: STUDENT, classId: CLASS, absentDate: day, makeupDate: day, addUnits: 1 }),
      { error: "결석한 날과 보강한 날이 같습니다 — 그때는 '합침'을 쓰세요" });
    assert.deepEqual(await run(sql, 'linkMakeupToAbsence', ATT, { studentId: STUDENT, classId: CLASS, absentDate: absent, makeupDate: day, addUnits: 0 }), { error: '보강 시수가 올바르지 않습니다' });
    const link = await run(sql, 'linkMakeupToAbsence', ATT, { studentId: STUDENT, classId: CLASS, absentDate: absent, makeupDate: day, addUnits: 1 });
    assert.equal(link.ok, true); assert.equal(link.absenceNoted, true); assert.equal(link.alreadyLinked, false);
    const [ab] = await sql`select note from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and session_date=${absent}`;
    const [mk] = await sql`select status::text status, note, session_units::float8 units from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and session_date=${day}`;
    assert.match(ab.note, /보강/); assert.match(mk.note, /보강/);
    assert.deepEqual([mk.status, mk.units], ['present', link.units]);
    const [linkLog] = await audits('attendance_makeup_link');
    assert.deepEqual([linkLog.metadata.absentDate, linkLog.metadata.makeupDate, linkLog.metadata.addUnits, linkLog.metadata.units, linkLog.metadata.absenceNoted], [absent, day, 1, link.units, true]);
    const again = await run(sql, 'linkMakeupToAbsence', ATT, { studentId: STUDENT, classId: CLASS, absentDate: absent, makeupDate: day, addUnits: 1 });
    assert.deepEqual(again, { ok: true, units: link.units, absenceNoted: true, alreadyLinked: true }, '두 번 눌러도 시수를 다시 더하지 않는다');
    assert.equal((await audits('attendance_makeup_link')).length, 1, '바뀐 것이 없으면 감사로그도 없다');

    // ── setVideoHomeworkMark · setVideoHomeworkMarksBulk ──
    await sql`delete from public.video_homework_marks where tenant_id=${t} and student_id=${STUDENT}`;
    assert.deepEqual(await run(sql, 'setVideoHomeworkMark', VID, { classId: CLASS, studentId: STUDENT, checkDate: shift(day, 1), homeworkDate: null, status: 'submitted' }),
      { ok: false, error: '미래 수업의 숙제는 검사할 수 없습니다.' });
    assert.deepEqual(await run(sql, 'setVideoHomeworkMark', VID, { classId: CLASS, studentId: STUDENT, checkDate: day, homeworkDate: null, status: 'done' }),
      { ok: false, error: '유효하지 않은 상태입니다.' });
    assert.deepEqual(await run(sql, 'setVideoHomeworkMark', VID, { classId: ENGLISH, studentId: STUDENT, checkDate: day, homeworkDate: null, status: 'submitted' }),
      { ok: false, error: '영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요.' }, '영어 = 학원 설정에서 꺼진 과목');
    const hw = shift(day, -1);
    assert.deepEqual(await run(sql, 'setVideoHomeworkMark', VID, { classId: CLASS, studentId: STUDENT, checkDate: day, homeworkDate: hw, submittedDate: day, status: 'submitted' }), { ok: true });
    const [mark] = await sql`select check_date::text check_date, homework_date::text homework_date, submitted_date::text submitted_date, status, updated_by::text updated_by
      from public.video_homework_marks where tenant_id=${t} and student_id=${STUDENT}`;
    assert.deepEqual(mark, { check_date: day, homework_date: hw, submitted_date: day, status: 'submitted', updated_by: TEACHER });
    assert.deepEqual(await run(sql, 'setVideoHomeworkMark', VID, { classId: CLASS, studentId: STUDENT, checkDate: day, homeworkDate: hw, status: null }), { ok: true });
    assert.equal((await sql`select count(*)::int n from public.video_homework_marks where tenant_id=${t} and student_id=${STUDENT}`)[0].n, 0, '미확인 = 지운다');
    assert.deepEqual(await run(sql, 'setVideoHomeworkMarksBulk', VID, { checkDate: day, status: 'x', cells: [] }), { ok: false, error: '유효하지 않은 상태입니다.', applied: [], failed: 0 });
    const bulk = await run(sql, 'setVideoHomeworkMarksBulk', VID, { checkDate: day, status: 'missing', cells: [{ classId: CLASS, studentId: STUDENT, homeworkDate: null },
      { classId: ENGLISH, studentId: STUDENT, homeworkDate: null }, { classId: 'x', studentId: STUDENT }] });
    assert.deepEqual(bulk, { ok: true, applied: [{ classId: CLASS, studentId: STUDENT }], failed: 2 });
    const [bm] = await sql`select status, submitted_date from public.video_homework_marks where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and check_date=${day}`;
    assert.deepEqual([bm.status, bm.submitted_date], ['missing', null]);
    const [bulkLog] = await audits('lesson_report_video_homework_mark');
    assert.deepEqual([bulkLog.target_label, bulkLog.metadata.bulk, bulkLog.metadata.count, bulkLog.metadata.failed, bulkLog.metadata.status], ['원스크린 일괄 1건', true, 1, 2, 'missing']);

    const [{ n: net1 }] = await sql`select count(*)::int n from net.http_request_queue`;
    assert.equal(net1, net0, '바깥 호출 큐 증가 0');
    assert.equal((await sql`select coalesce(current_setting('request.jwt.claims', true), '') c`)[0].c, claims0);
    throw ROLLBACK;
  }).catch((e) => { if (e !== ROLLBACK) throw e; });
});

test('복사본(강사 권한): 담당 반 · 7일 잠금 · 수강생 확인 — 보강 예약된 학생은 수강행 없이도 연다(2.0 hasReservedMakeup)', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs'), { importV2 } = await import('./v2-bridge.mjs');
  await db.begin(async (sql) => {
    const { asOf: day } = await screen.load({ sql, params: { teacher: TEACHER }, tenantId: t, importV2 });
    // 학원이 반을 맡지 않은 강사 한 명 — 그날 학원삼(테스트)만 위임받는다.
    const [tch] = await sql`select u.id::text id from public.users u where u.tenant_id=${t} and u.status::text='active' and u.system_role::text='teacher'
      and not exists (select 1 from public.classes c where c.tenant_id=${t} and c.teacher_id=u.id and c.id in (${CLASS}, ${CLASS2})) order by u.display_name limit 1`;
    const run = (name, module, input) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module, actor: tch.id, args: [input] }), tenantId: t, importV2 });
    await sql`insert into public.class_delegations (tenant_id, class_id, delegate_user_id, from_date, to_date, created_by) values (${t}, ${CLASS2}, ${tch.id}, ${day}, ${day}, ${TEACHER})`;
    await sql`delete from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and session_date between ${shift(day, -12)} and ${day}`;
    await sql`delete from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT}`;
    await sql`delete from public.enrollments where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS2}`;
    const [{ m: audit0 }] = await sql`select coalesce(max(created_at), 'epoch') m from public.audit_logs where tenant_id=${t}`;

    // 담당 반: 학원이(테스트)는 이 강사의 반이 아니다.
    assert.deepEqual(await run('setReservationReportMode', RES, { studentId: STUDENT, classId: CLASS, date: day, mode: 'merge' }), { error: '담당 반이 아닙니다' });
    // 7일 잠금: 열흘 전 칸은 강사가 못 고친다(원스크린 칸 저장과 같은 문구).
    const old = shift(day, -10);
    const lock = await run('checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS2, date: old, outcome: 'done' });
    await assert.rejects(run('setAttendanceCell', ATT, { studentId: STUDENT, classId: CLASS2, sessionDate: old, status: 'present' }), (e) => e.message === lock.error);
    // 수강생 확인: 학원삼에 수강행도 기록도 예약도 없으면 거절 · 보강 연결도 수강생만.
    await assert.rejects(run('setAttendanceCell', ATT, { studentId: STUDENT, classId: CLASS2, sessionDate: day, status: 'present' }), /이 반 수강생이 아닙니다/);
    assert.deepEqual(await run('linkMakeupToAbsence', ATT, { studentId: STUDENT, classId: CLASS2, absentDate: shift(day, -2), makeupDate: day, addUnits: 1 }), { error: '이 반 수강생이 아닙니다' });
    // 영상 검사 칸: 담당이 아닌 반.
    const vh = await run('setVideoHomeworkMark', VID, { classId: CLASS, studentId: STUDENT, checkDate: day, homeworkDate: null, status: 'submitted' });
    assert.equal(vh.ok, false); assert.match(vh.error, /^(담당 반만 수정할 수 있습니다\.|수정 권한이 없습니다\.)$/);

    // 보강 예약(학원이(테스트) 결석분을 학원삼으로) — 수강행이 없어도 '했음'이 칸을 연다.
    const [{ id: rid }] = await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_class_id, absence_date, makeup_date, slot_start, slot_end, created_by)
      values (${t}, ${STUDENT}, ${CLASS2}, ${CLASS}, ${shift(day, -3)}, ${day}, '16:20', '17:15', ${TEACHER}) returning id::text id`;
    const done = await run('checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS2, date: day, outcome: 'done' });
    assert.equal(done.ok, true, JSON.stringify(done)); assert.equal(done.outcome, 'done');
    assert.equal((await sql`select status from public.makeup_reservations where id=${rid}`)[0].status, 'done');
    const [cell] = await sql`select status::text status, recorded_by::text recorded_by, recorded_via::text via from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS2} and session_date=${day}`;
    assert.deepEqual([cell.recorded_by, cell.via], [tch.id, 'teacher']);
    const [checkLog] = await sql`select actor_id::text actor_id from public.audit_logs where tenant_id=${t} and action='makeup_reserve_check' and created_at >= ${audit0}`;
    assert.equal(checkLog.actor_id, tch.id);
    // 이행은 칸 저장 안에서 한 번 — '했음'이 따로 또 부르지 않는다. 두 번째 '했음'은 칸·시수·이행 로그를 다시 남기지 않는다.
    const count = async (action) => (await sql`select count(*)::int n from public.audit_logs where tenant_id=${t} and action=${action} and created_at >= ${audit0}`)[0].n;
    const unitsNow = async () => (await sql`select session_units::float8 u, note from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS2} and session_date=${day}`)[0];
    assert.deepEqual([await count('attendance_cell'), await count('makeup_reserve_done')], [1, 1]);
    const before = await unitsNow();
    const again = await run('checkMakeupReservation', RES, { studentId: STUDENT, classId: CLASS2, date: day, outcome: 'done' });
    assert.equal(again.ok, true);
    assert.deepEqual([await count('attendance_cell'), await count('makeup_reserve_done'), await unitsNow()], [1, 1, before]);

    // 강사가 예약 학생 칸을 '했음' 없이 일반 출결로 찍어도 2.0처럼 예약이 이행된다(done · 칸 연결 · 이행 로그 · 응답 시수 = 이행 값).
    await sql`delete from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT}`;
    await sql`delete from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS2} and session_date=${day}`;
    const [{ id: r3 }] = await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_class_id, absence_date, makeup_date, slot_start, slot_end, created_by)
      values (${t}, ${STUDENT}, ${CLASS2}, ${CLASS}, ${shift(day, -4)}, ${day}, '16:20', '17:15', ${TEACHER}) returning id::text id`;
    const doneBefore = await count('makeup_reserve_done');
    const saved = await run('setAttendanceCell', ATT, { studentId: STUDENT, classId: CLASS2, sessionDate: day, status: 'present' });
    assert.equal(saved.ok, true);
    const [r3row] = await sql`select status, attendance_record_id::text rec from public.makeup_reservations where id=${r3}`;
    const [c3] = await sql`select id::text id, session_units::float8 u from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS2} and session_date=${day}`;
    assert.deepEqual([r3row.status, r3row.rec], ['done', c3.id]);
    assert.equal(await count('makeup_reserve_done'), doneBefore + 1);
    const [doneLog] = await sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${t} and action='makeup_reserve_done' and metadata->>'reservationId'=${r3}`;
    assert.equal(doneLog.actor_id, tch.id);
    assert.equal(saved.autoUnits, c3.u, '응답 시수 = 칸에 저장된 값(이행 값)');
    throw ROLLBACK;
  }).catch((e) => { if (e !== ROLLBACK) throw e; });
});

test('이동: /onescreen/video-homework만 #v2-video-homework?view=mine으로(2.0 page 열쇠 그대로 + 지금 선생님 actor)', async () => {
  const src = await readFile(new URL('./v2-screen-onescreen.js', import.meta.url), 'utf8');
  const m = /function videoHomeworkTarget\(href, actorId\) \{[\s\S]*?\n  \}/.exec(src);
  assert(m, '감싸개에 변환 함수가 있다');
  const fn = vm.runInNewContext(`(${m[0]})`, { URL, URLSearchParams, location: { origin: 'http://x' } });
  assert.equal(fn('/onescreen/video-homework'), '#v2-video-homework?view=mine');
  assert.equal(fn('/onescreen/video-homework?from=2026-10-01&to=2026-10-27&q=%ED%95%99&status=missing&embed=1', TEACHER),
    `#v2-video-homework?view=mine&from=2026-10-01&to=2026-10-27&q=%ED%95%99&status=missing&actor=${TEACHER}`);
  assert.equal(fn(`/onescreen/video-homework?date=2026-10-27&class=${CLASS}&subject=math&grade=%EC%A4%912&school=x&sort=name&v2path=/a`),
    `#v2-video-homework?view=mine&date=2026-10-27&class=${CLASS}&subject=math&grade=%EC%A4%912&school=x&sort=name`, '2.0 page가 읽는 열쇠만');
  assert.equal(fn('/onescreen/video-homework', 'not-a-uuid'), '#v2-video-homework?view=mine', '형식이 아닌 actor는 싣지 않는다');
  assert.equal(fn('/lesson-reports/video-homework?from=2026-10-01'), null, '관리자 화면 주소는 건드리지 않는다');
  assert.equal(fn('/onescreen'), null);
  assert.equal(fn('/onescreen/video-homework-x'), null);
  // 창 열기 알림(v2-host-open · eywa-open-window)만 넘긴다 — 지금 선생님(3.0이 고른 teacher → 호스트가 알려 준 사람)과 함께.
  assert.match(src, /function openFromHost\(href\) \{\s*const vh = videoHomeworkTarget\(href, screenTeacher\(\)\);/);
  assert.match(src, /const screenTeacher = \(\) => new URLSearchParams\(requested \|\| ''\)\.get\('teacher'\) \|\| hostTeacher;/);
  assert.match(src, /d\.type === 'v2-host-editors' && d\.screen === ID[\s\S]*?hostTeacher = /);
  // 호스트 안 이동(v2path) 갈래는 받지 않는다 — iframe 주소가 먼저 바뀌어 날짜·all을 잃는다.
  assert.doesNotMatch(src, /nq\.get\('v2path'\)/);
});
