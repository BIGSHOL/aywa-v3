// 2.0 화면 · 선생님 원스크린 시험 — node --test experiments/owner-concept/verify-v2-screen-onescreen.mjs
// Server: the copy (read-only) checked against independent SQL; Client: the page drawn from a fixture (escaping, 2.0 labels,
// every input/save/send disabled). The copy part is skipped when the local database is not running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { screen } from './v2-screen-onescreen.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const RAW = /\b(?:queued|processing|success|failed|too_old|present|absent|late|early_leave|makeup|null|undefined)\b/;

test('params: only teacher (uuid), date (YYYY-MM-DD) and all=1', () => {
  assert.equal(screen.params.teacher.test('cd2c6232-d874-43d6-ae0e-11fc062634c0'), true);
  assert.equal(screen.params.teacher.test('x'), false);
  assert.equal(screen.params.date.test('2026-10-26'), true);
  assert.equal(screen.params.date.test('2026-10-26T00'), false);
  assert.equal(screen.params.all.test('1'), true);
  assert.equal(screen.params.all.test('0'), false);
});

test('copy: a teacher day — classes, rows, saved reports and labels follow 2.0', { skip: !db && 'local database not running' }, async () => {
  const { tenantId } = await import('./full-db.mjs'), { importV2 } = await import('./v2-bridge.mjs');
  const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
  const first = await load({});
  assert(first.teacher && first.date <= first.asOf, 'default teacher and a day not after the copy');
  const d = await load({ teacher: first.teacher.id, date: first.date });
  const rows = d.students.flatMap(s => s.subjects);
  assert(d.todayClasses.length > 0 && rows.length > 0);
  for (let i = 1; i < d.todayClasses.length; i += 1) assert((d.todayClasses[i - 1].startTime || '99') <= (d.todayClasses[i].startTime || '99'), 'classes in start-time order');
  // Independent SQL: that day's reports of those students in those classes — each one sits on exactly one row.
  const ids = d.todayClasses.map(c => c.id), sids = d.students.map(s => s.id);
  const [{ n }] = await db`select count(*)::int n from public.lesson_reports where tenant_id=${tenantId} and report_date=${d.date} and student_id = any(${sids}) and class_id = any(${ids})`;
  assert.equal(rows.filter(r => r.saved && r.classId).length, n, 'saved rows = reports of that day in those classes');
  const sched = await db`select distinct class_id from public.class_schedules where tenant_id=${tenantId} and class_id = any(${ids}) and day_of_week::text=${d.dow} and (valid_from is null or valid_from<=${d.date}) and (valid_to is null or valid_to>=${d.date})`;
  assert.equal(sched.length, ids.length, 'every class shown meets on that weekday');
  for (const r of rows) {
    assert(['sent', 'draft', 'todo', 'excluded'].includes(r.sendStatus));
    if (r.saved) assert.equal(r.sendStatus, 'sent');
    for (const label of [r.gate, r.report?.badge?.label, r.attendanceLabel].filter(Boolean)) assert(!RAW.test(label), `raw code in label: ${label}`);
    assert.match(r.preview.title, /^\d{4}년 \d{2}월 \d{2}일 /);
  }
  assert(Object.keys(d.history.days).every(k => k.startsWith(d.history.month)), 'month calendar stays in the month');
});

// The 3.0 side of the screen: a note, the '보는 선생님' picker and the slot the v2-host iframe sits over (2.0's own components draw the rest).
async function page(query = '', teachers = { status: 'ready', data: { teachers: [{ id: 't1', name: '김<b>선생', active: true, classes: 2 }, { id: 't2', name: '이선생', active: true, classes: 1 }] } }) {
  const src = await readFile(new URL('./v2-screen-onescreen.js', import.meta.url), 'utf8');
  let def = null; const fetched = [], loads = [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const V2Screens = { register: x => { def = x; }, esc };
  vm.runInNewContext(src, { window: { V2Screens }, document: { addEventListener() {}, querySelector: () => null, body: { append() {} }, createElement: () => ({ dataset: {}, style: {} }) },
    addEventListener() {}, requestAnimationFrame() {}, MutationObserver: class { observe() {} }, location: { origin: 'http://x', hash: '' }, URLSearchParams,
    fetch: (url, opt) => { fetched.push([url, opt?.method]); return new Promise(() => {}); } });
  const html = def.render({ query: new URLSearchParams(query), load: p => { loads.push(p); return teachers; }, go() {}, api: {} });
  return { html, fetched, loads };
}

test('page: note, teacher picker (escaped, the chosen one selected) and the host slot', async () => {
  const { html, fetched, loads } = await page('teacher=t2&date=2026-10-27');
  assert(html.includes('연습 복사본(Docker)') && html.includes('data-v2-host-slot'), 'note and slot');
  assert(!html.includes('김<b>선생') && html.includes('김&lt;b&gt;선생'), 'teacher names escaped');
  assert(/<option value="t2" selected>이선생 · 반 1<\/option>/.test(html), 'the chosen teacher is selected');
  assert(!html.includes('최근 보고서가 가장 많은 선생님'), 'no default option when a teacher is chosen');
  assert.equal(JSON.stringify(loads), JSON.stringify([{ list: 'teachers' }]), 'only the light teacher list is loaded on the 3.0 side');
  assert.equal(JSON.stringify(fetched), JSON.stringify([['/v2-host/onescreen.html', 'HEAD']]), 'checks the host page once; nothing else');
  const none = await page('');
  assert(none.html.includes('<option value="" selected>최근 보고서가 가장 많은 선생님</option>'), 'default pick when no teacher is chosen');
});

// 2단계: the actions write what 2.0 writes. Test student 학원이 · test class (원장's test fixtures), inside one transaction that
// is always rolled back — the copy keeps its original values whatever happens (the shared route commits only real saves).
const STUDENT = '6219e442-aa57-455f-a5bc-834b222d9e1c', CLASS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3', TEACHER = '94007db7-12d3-4b5d-97f2-39071446536b';
const ROLLBACK = Symbol('rollback');
async function inRollback(fn) {
  const { tenantId } = await import('./full-db.mjs'), { importV2 } = await import('./v2-bridge.mjs');
  const run = (sql, name, raw) => screen.actions[name].run({ sql, body: screen.actions[name].validate(raw), tenantId, importV2 });
  await db.begin(async sql => { await fn({ sql, run, tenantId }); throw ROLLBACK; }).catch(e => { if (e !== ROLLBACK) throw e; });
}

test('actions: 2.0 inputs (+ actor) — validation refuses bad input before touching the copy', () => {
  const ok = { actor: TEACHER, reportDate: '2026-10-27', studentId: STUDENT, classId: CLASS, progress: '수학 일차방정식', examInfo: '', homeworkScore: '', notes: '' };
  assert.throws(() => screen.actions.save.validate({ ...ok, actor: 'x' }), /입력 값/);
  assert.throws(() => screen.actions.save.validate({ ...ok, reportDate: '2026-10-27T00' }), /입력 값/);
  assert.throws(() => screen.actions.save.validate({ ...ok, notes: 5 }), /입력 값/);
  assert.throws(() => screen.actions.save.validate({ ...ok, makeup: true }), /보강/);
  assert.throws(() => screen.actions.save.validate({ ...ok, mentSource: 'robot' }), /입력 값/);
  assert.throws(() => screen.actions.save.validate({ ...ok, pilotCheck: { factsCurrent: 'yes' } }), /입력 값/);
  assert.throws(() => screen.actions.save.validate({ ...ok, form: { tests: { daily: { score: 1.5 } } } }), /입력 값/);
  assert.deepEqual(screen.actions.save.validate({ ...ok, videoHomework: true }).ignored, ['videoHomework'], 'inputs not saved here are named back');
  assert.deepEqual(screen.actions.save.validate({ ...ok, pilotOneLine: '화이팅', pilotCheck: { factsCurrent: true, reasonsOk: true } }).ignored, [], 'send-gate inputs are used, not ignored');
  assert.equal(screen.actions.save.validate({ ...ok, form: { draft: null } }).form.draft, null, 'untouched text stays null (kept on the server)');
  const att = { actor: TEACHER, studentId: STUDENT, classId: CLASS, sessionDate: '2026-10-27' };
  assert.throws(() => screen.actions.attendance.validate({ ...att, status: 'makeup' }), /잘못된 상태/);
  assert.throws(() => screen.actions.attendance.validate({ ...att, status: 'present', units: '2' }), /시수/);
  assert.throws(() => screen.actions.attendance.validate({ ...att, status: 'present', slotStart: '16:00' }), /교시/);
  assert.throws(() => screen.actions.attendance.validate({ ...att, status: 'present', noteOnly: true, note: 'x' }), /메모만/);
  assert.throws(() => screen.actions.attendance.validate({ ...att, status: 'present', allowMakeup: true }), /보강/);
  assert.equal(screen.actions.attendance.validate({ ...att, status: null }).status, null);
  assert.equal(screen.actions.attendance.validate({ ...att, status: 'present', onlyIfEmpty: true }).onlyIfEmpty, true);
  // The v2-host boundary: 2.0's own call { module, actor, args:[input] } under 2.0's function names.
  const call = (module, input) => ({ module, actor: TEACHER, args: [input] });
  assert.equal(screen.actions.saveLessonReport.validate(call('features/onescreen/server/actions.ts', ok)).fields.progress, '수학 일차방정식');
  assert.equal(screen.actions.saveAndQueueClassnote.validate(call('features/onescreen/server/actions.ts', ok)).actor, TEACHER);
  assert.equal(screen.actions.setAttendanceCell.validate(call('features/attendance/server/actions.ts', { ...att, actor: undefined, status: 'late' })).status, 'late');
  assert.throws(() => screen.actions.saveLessonReport.validate(call('features/attendance/server/actions.ts', ok)), /입력 값/, 'another module under the same name is refused');
  assert.throws(() => screen.actions.setAttendanceCell.validate({ module: 'features/attendance/server/actions.ts', actor: TEACHER, args: [] }), /입력 값/);
});

test('actions on the copy (rolled back): attendance, save, send and their audit lines follow 2.0', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  await inRollback(async ({ sql, run, tenantId: t }) => {
    const R = { ...(await (await import('./v2-bridge.mjs')).importV2('features/onescreen/math-report-pilot.ts')) };
    const { asOf } = await screen.load({ sql, params: { teacher: TEACHER }, tenantId: t, importV2: (await import('./v2-bridge.mjs')).importV2 });
    const day = asOf, who = { actor: TEACHER, studentId: STUDENT, classId: CLASS }, att = { ...who, sessionDate: day };
    // Only this run's lines: the copy may already hold practice saves for this student and day.
    const old = (await sql`select id from public.audit_logs where tenant_id=${t} and metadata->>'studentId'=${STUDENT}`).map(r => r.id);
    const auditsWhere = (action, key, value) => sql`select actor_id, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'studentId'=${STUDENT}
      and metadata->>'date'=${day} and metadata->>${key} = ${value} and not (id = any(${old}))`;
    // Guards: another teacher's class, an unknown actor; a teacher-level account is held to the classes it teaches (2.0 scoped attendance).
    const [other] = await sql`select id from public.classes where tenant_id=${t} and is_active and teacher_id <> ${TEACHER} limit 1`;
    await assert.rejects(run(sql, 'save', { ...who, classId: other.id, reportDate: day, form: {} }), /담당 반이 아닙니다/);
    await assert.rejects(run(sql, 'save', { ...who, actor: '00000000-0000-0000-0000-000000000000', reportDate: day, form: {} }), /저장할 사람/);
    const [teacherRole] = await sql`select u.id from public.users u where u.tenant_id=${t} and u.status::text='active' and u.system_role::text='teacher'
      and not exists (select 1 from public.classes c where c.id=${CLASS} and c.teacher_id=u.id)
      and not exists (select 1 from public.class_schedules s where s.class_id=${CLASS} and s.teacher_id=u.id)
      and not exists (select 1 from public.class_delegations d where d.class_id=${CLASS} and d.delegate_user_id=u.id and d.revoked_at is null) limit 1`;
    if (teacherRole) await assert.rejects(run(sql, 'attendance', { ...att, actor: teacherRole.id, status: 'present' }), /담당 반이 아닙니다|권한/);
    // Attendance: clear first (the copy may hold a mark that day; 2.0 logs the clear either way), then present → one row, 2.0's audit line.
    await run(sql, 'attendance', { ...att, status: null });
    assert.equal((await auditsWhere('attendance_clear', 'via', '3.0 연습 복사본')).length > 0, true);
    const a = await run(sql, 'attendance', { ...att, status: 'present' });
    const [rec] = await sql`select id, status::text status, recorded_by, recorded_via, slot_start, session_units::float8 units from public.attendance_records where tenant_id=${t} and student_id=${STUDENT} and class_id=${CLASS} and session_date=${day}`;
    assert.deepEqual([rec.status, rec.recorded_by, rec.recorded_via, rec.slot_start], ['present', TEACHER, 'teacher', null]);
    assert.equal(rec.units, a.autoUnits, 'the response reports the units stored in the new row');
    const [cell] = await auditsWhere('attendance_cell', 'created', 'true');
    assert.deepEqual([cell.actor_id, cell.metadata.via, cell.metadata.status], [TEACHER, '3.0 연습 복사본', 'present']);
    // A non-destructive first mark (2.0 onlyIfEmpty) does not overwrite: it returns what is there.
    const c = await run(sql, 'attendance', { ...att, status: 'absent', onlyIfEmpty: true });
    assert.equal(c.conflict?.status, 'present');
    // 2.0's triggers see the actor as the DB identity (activity log), as they would see the logged-in teacher.
    const [act] = await sql`select actor_id from public.activity_log where tenant_id=${t} and row_id=${rec.id} and op='INSERT'`;
    assert.equal(act?.actor_id, TEACHER);
    // Hand-drawn page stands in for 2.0's send button: no report text, or a math row (no autowrite on that page) — refused, nothing written.
    await assert.rejects(run(sql, 'send', { ...who, reportDate: day, subject: 'math', form: { today: '일차방정식', draft: '' } }), e => e?.code === 'send_gate');
    await assert.rejects(run(sql, 'send', { ...who, reportDate: day, subject: 'math', form: { today: '일차방정식', draft: '멘트' } }), e => e?.code === 'send_gate');
    // A working session for this class (made here if the copy has none) is what the page reads first.
    await sql`insert into public.onescreen_daily_sessions (tenant_id, student_id, session_date, updated_by, subject_progress) values (${t}, ${STUDENT}, ${day}, ${TEACHER}, ${sql.json({ [CLASS]: { today: '', draft: '' } })})
      on conflict do nothing`;
    await sql`update public.onescreen_daily_sessions set subject_progress = coalesce(subject_progress, '{}'::jsonb) || jsonb_build_object(${CLASS}::text, coalesce(subject_progress->${CLASS}, '{}'::jsonb))
      where tenant_id=${t} and student_id=${STUDENT} and session_date=${day} and updated_by=${TEACHER}`;
    // Save from the page's form: one row on (student, day, class) as that teacher, fields built by 2.0's buildReportFields.
    const form = { today: '일차방정식 활용', textbook: '개념원리', homeworkToday: '-', attitude: '좋음', homework: '90%', draft: '오늘 집중해서 잘 했습니다.', trendDraft: '', tests: { daily: { score: 4, max: 5 }, check: { score: null, max: 5 } } };
    const page = { ...who, reportDate: day, subject: 'math', form };
    const saved = await run(sql, 'save', page);
    const [r] = await sql`select subject, progress, textbook, homework_today, attitude, homework_score, exam_info, daily_test, notes, trend_note, source, teacher_name, created_by, share_token::text share_token
      from public.lesson_reports where id=${saved.id}`;
    const [u] = await sql`select display_name from public.users where id=${TEACHER}`;
    assert.deepEqual({ ...r }, { subject: 'math', progress: '수학 일차방정식 활용', textbook: '개념원리', homework_today: '없음', attitude: '좋음', homework_score: '90%', exam_info: '일일 4/5',
      daily_test: '5문제 중 4개 맞음', notes: '오늘 집중해서 잘 했습니다.', trend_note: null, source: 'onescreen', teacher_name: u.display_name, created_by: TEACHER, share_token: saved.shareToken });
    assert.equal(saved.saved, true);
    assert.deepEqual({ homeworkToday: saved.stored.homeworkToday, today: saved.stored.today }, { homeworkToday: '없음', today: form.today }, 'stored values come back as 2.0 saved them');
    assert.equal((await auditsWhere('lesson_report_save', 'reportId', saved.id))[0].metadata.via, '3.0 연습 복사본');
    const [sess] = await sql`select subject_progress->${CLASS} p from public.onescreen_daily_sessions where tenant_id=${t} and student_id=${STUDENT} and session_date=${day} and updated_by=${TEACHER}`;
    assert.equal(sess.p.today, form.today, "the teacher's working session for that class takes the saved values (2.0 autosave)");
    // Untouched text (null) keeps the stored words; masked text is refused (the original would be lost).
    await run(sql, 'save', { ...page, form: { ...form, draft: null, today: '일차방정식 활용 2' } });
    assert.equal((await sql`select notes from public.lesson_reports where id=${saved.id}`)[0].notes, '오늘 집중해서 잘 했습니다.');
    await assert.rejects(run(sql, 'save', { ...page, form: { ...form, draft: '전화 연락처 가림 주세요' } }), e => e?.code === 'masked_text');
    // 2.0 input as the 2.0 page sends it (the host): fields saved as given; a hand-typed math report is refused at 2.0's autowrite gate, kept saved.
    const v2 = { ...who, reportDate: day, subject: 'math', progress: '수학 연립방정식', examInfo: '일일 5/5', homeworkScore: '100%', notes: '2.0 입력 멘트 화이팅', dailyTest: '5문제 중 5개 맞음', attitude: '매우 좋음' };
    const manual = await run(sql, 'send', { ...v2, mentSource: 'manual', pilotCheck: { factsCurrent: true, reasonsOk: true }, pilotOneLine: '화이팅' });
    assert.deepEqual([manual.ok, manual.saved, manual.error], [false, true, R.PILOT_AUTOWRITE_REQUIRED_ERROR]);
    const [r2] = await sql`select progress, exam_info, notes, daily_test, classnote_status from public.lesson_reports where id=${saved.id}`;
    assert.deepEqual({ ...r2 }, { progress: '수학 연립방정식', exam_info: '일일 5/5', notes: '2.0 입력 멘트 화이팅', daily_test: '5문제 중 5개 맞음', classnote_status: null });
    // Autowritten + one-line: the test student has no ClassNote class board member → 2.0 refuses with the board reason (class route).
    // (a new autowritten text — re-sending the same words keeps their earlier label, as 2.0's resolveMentSource does)
    const send = { ...v2, notes: '자동작성 글입니다 화이팅', mentSource: 'auto', pilotCheck: { factsCurrent: true, reasonsOk: true }, pilotOneLine: '화이팅' };
    const noBoard = await run(sql, 'send', send);
    assert.equal(noBoard.ok, false, JSON.stringify(noBoard)); assert(noBoard.status && noBoard.error, JSON.stringify(noBoard));
    // With a live board member (inside this rolled-back test only) → the queue row; 2.0's audit line. No ClassNote call.
    await sql`insert into public.classnote_class_board_members (tenant_id, class_id, board_id, student_id, status)
      select ${t}, ${CLASS}, b.board_id, ${STUDENT}, 'ok' from public.classnote_class_boards b where b.tenant_id=${t} and b.class_id=${CLASS} limit 1`;
    const sent = await run(sql, 'send', send);
    assert.equal(sent.status, 'queued'); assert.match(sent.message, /실제 발송은 없습니다/);
    const [q] = await sql`select classnote_status, classnote_queued_at is not null queued_at, classnote_retry_count from public.lesson_reports where id=${saved.id}`;
    assert.deepEqual({ ...q }, { classnote_status: 'queued', queued_at: true, classnote_retry_count: 0 });
    assert.equal((await auditsWhere('classnote_send', 'status', 'queued')).length, 1);
    // Absent → the next send is stopped and pulls the waiting report back out of the queue (2.0).
    await run(sql, 'attendance', { ...att, status: 'absent' });
    const stopped = await run(sql, 'send', send);
    assert.equal(stopped.status, 'absent');
    assert.equal((await sql`select classnote_status from public.lesson_reports where id=${saved.id}`)[0].classnote_status, null);
    // Sent (worker success) → saving is refused with 2.0's words.
    await sql`update public.lesson_reports set classnote_status='success' where id=${saved.id}`;
    await assert.rejects(run(sql, 'save', page), /이미 학부모에게 발송된 보고서/);
    // Clear attendance → rows gone.
    await run(sql, 'attendance', { ...att, status: null });
    assert.equal((await sql`select count(*)::int n from public.attendance_records where student_id=${STUDENT} and class_id=${CLASS} and session_date=${day}`)[0].n, 0);
    // Nothing asked to leave this PC.
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits`;
  assert.equal(after[0].audits, before[0].audits, 'rolled back — the copy is unchanged');
});

test('saveOnescreenSession on the copy (rolled back): insert, update from the read revision, a stale thinner save does not overwrite', { skip: !db && 'local database not running' }, async () => {
  await inRollback(async ({ sql, run, tenantId: t }) => {
    const { asOf: day } = await screen.load({ sql, params: { list: 'teachers' }, tenantId: t, importV2: (await import('./v2-bridge.mjs')).importV2 }).then(async () => ({ asOf: (await screen.load({ sql, params: { teacher: TEACHER }, tenantId: t, importV2: (await import('./v2-bridge.mjs')).importV2 })).asOf }));
    const M = 'features/onescreen/server/actions.ts', call = input => ({ module: M, actor: TEACHER, args: [input] });
    const save = input => run(sql, 'saveOnescreenSession', call({ studentId: STUDENT, sessionDate: day, classId: CLASS, ...input }));
    const today = async () => (await sql`select subject_progress->${CLASS}->>'today' v from public.onescreen_daily_sessions where tenant_id=${t} and student_id=${STUDENT} and session_date=${day} and updated_by=${TEACHER}`)[0]?.v;
    await sql`delete from public.onescreen_daily_sessions where tenant_id=${t} and student_id=${STUDENT} and session_date=${day} and updated_by=${TEACHER}`;
    const first = await save({ subjectProgress: { [CLASS]: { today: '가', draft: '첫 글' } }, attitude: '좋음' });
    assert.equal(first.ok, true); assert.match(first.updatedAt, /^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/, 'PostgREST-style timestamp');
    assert.equal(await today(), '가');
    const second = await save({ baseUpdatedAt: first.updatedAt, subjectProgress: { [CLASS]: { today: '나', draft: '첫 글' } }, attitude: '좋음' });
    assert.equal(await today(), '나'); assert.notEqual(second.updatedAt, first.updatedAt);
    const stale = await save({ baseUpdatedAt: first.updatedAt, subjectProgress: { [CLASS]: { today: '', draft: '' } } });
    assert.equal(stale.skipped, true);
    assert.equal(await today(), '나', 'a window that read an older revision and has less written does not wipe the newer session (2.0 sessionSaveDecision)');
    const [other] = await sql`select s.id from public.students s where s.tenant_id=${t} and not exists (select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and c.teacher_id=${TEACHER}) limit 1`;
    await assert.rejects(run(sql, 'saveOnescreenSession', call({ studentId: other.id, sessionDate: day, subjectProgress: {} })), /담당 학생이 아닙니다/);
  });
});

test('props=1 (the host path): 2.0 props plus the host context; the picker lists only active teachers', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs'), { importV2 } = await import('./v2-bridge.mjs');
  const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId: t, importV2 }));
  const { teachers } = await load({ list: 'teachers' });
  const [{ n }] = await db`select count(distinct u.id)::int n from public.users u join public.classes c on c.teacher_id=u.id and c.tenant_id=${t} and c.is_active where u.tenant_id=${t} and u.status::text='active'`;
  assert.equal(teachers.length, n); assert(teachers.every(x => x.active), 'no one who is not employed — their screen would silently be someone else\'s');
  const d = await load({ props: '1', teacher: TEACHER, date: '2026-10-27' });
  assert.equal(d.actor.id, TEACHER, 'the chosen teacher is the screen\'s teacher');
  assert(d.oneScreen && d.videoHomework && Array.isArray(d.oneScreen.initial), '2.0 props for OneScreenClient and VideoHomeworkProvider');
  assert(['ko', 'en'].includes(d.host.lang));
  assert(Object.keys(d.host.licenses).every(k => ['ai_analysis', 'google_sheets', 'meeting_recording', 'window_mode'].includes(k)));
  assert(d.host.operations.subjects.length > 0 && d.host.operations.gradeLevels.length > 0);
  // Screen language follows 2.0 resolveSheetLang: the teacher's own ui_prefs choice first.
  const [en] = await db`select id from public.users u where tenant_id=${t} and status::text='active' and ui_prefs->'teacherView'->>'lang'='en'
    and exists (select 1 from public.classes c where c.teacher_id=u.id and c.is_active) order by id limit 1`;
  if (en) assert.equal((await load({ props: '1', teacher: en.id })).host.lang, 'en');
});

test.after(async () => { await db?.end(); });
