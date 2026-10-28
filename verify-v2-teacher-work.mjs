// 2.0 운영실 '강사별 업무 현황' 이식 시험 — node --test experiments/owner-concept/verify-v2-teacher-work.mjs
// 복사본 기준일 창을 독립 SQL(+ 2.0 순수 판정)과 대조하고, 8개 주 창 묶음 = 창마다 단독 호출인지 확인한다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadTeacherWork, loadTeacherWorkWindows, teacherWorkWeekly } from './v2-teacher-work.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var { weekWindows } = await import('./domain-snapshot-core.mjs');
  var W = Object.assign({}, await importV2('features/dashboard/overview/work-targets.ts'), await importV2('features/dashboard/unrecorded-attendance.ts'));
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var clock = await copyClock(), asOf = clock.day;
  // 복사본을 뜬 순간을 manifest에서 직접(로더의 copyClock과 독립).
  var { activeBackup } = await import('./full-db-paths.mjs');
  var manifestAt = new Date(JSON.parse(await readFile(new URL('manifest.json', (await activeBackup()).directory), 'utf8')).capturedAt);
  var load = (args) => ro((sql) => loadTeacherWork({ sql, tenantId: t, importV2, ...args }));
  var base = await load({ today: asOf });
  var [{ data: stored }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
  var holidays = new Set((stored.operations?.holidays ?? []).map((h) => (typeof h === 'string' ? h : h.date)));
  var days = (from, to) => { const out = []; for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86400000) { const s = new Date(d).toISOString().slice(0, 10); if (!holidays.has(s)) out.push(s); } return out; };
  var DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], dowOf = (d) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
  var columnOf = (rows) => { const byClass = new Map(), byColumn = new Map(); for (const r of rows) { byColumn.set(`${r.teacherId ?? 'unassigned'}:${r.subject}`, r); for (const id of r.classIds) byClass.set(id, r); } return { byClass, byColumn }; };
}

test('기준일 창: 2.0 모양 · 창 경계 · 줄(강사 × 과목)이 반의 담임·과목과 맞다', { skip: SKIP }, async () => {
  assert.equal(base.to, asOf);
  assert.equal(base.reportFrom, new Date(Date.parse(`${asOf}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10));
  assert.equal(base.attendanceTo, new Date(Date.parse(`${asOf}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
  assert.equal(base.unreadFrom, new Date(Date.parse(`${asOf}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10));
  assert(base.rows.length > 0);
  const ids = base.rows.flatMap((r) => r.classIds);
  assert.equal(new Set(ids).size, ids.length, '한 반이 두 줄에 섰다');
  const cls = await db`select id::text id, teacher_id::text teacher_id, subject from public.classes where tenant_id=${t} and id = any(${ids}) order by id`;
  for (const r of base.rows) for (const id of r.classIds) {
    const c = cls.find((x) => x.id === id);
    assert.equal(c.teacher_id, r.teacherId, `${r.teacherName} 줄의 반 담임`);
    assert.equal(c.subject, r.subject);
  }
  for (let i = 1; i < base.rows.length; i += 1) assert(base.rows[i - 1].teacherName.localeCompare(base.rows[i].teacherName, 'ko') <= 0, '줄은 이름순');
});

test('기준일 창: 학부모 미확인 = 독립 SQL(30일 · 발송 성공 · 매칭 가능 · 48시간 유예 · 읽음 없음)', { skip: SKIP }, async () => {
  assert.equal(base.deliveryShown, true);
  const ids = base.rows.flatMap((r) => r.classIds), cutoff = new Date(clock.at.getTime() - 48 * 3600000);
  const per = await db`select r.class_id::text c, count(*)::int judged, count(*) filter (where r.classnote_read_at is null)::int unread
    from public.lesson_reports r join public.students s on s.id=r.student_id and not s.is_test
    where r.tenant_id=${t} and r.class_id = any(${ids}) and r.report_date between ${base.unreadFrom} and ${asOf} and r.classnote_status='success'
      and (r.edutrix_share_token is not null or r.source is null or r.source <> 'edutrix_import') and r.classnote_sent_at < ${cutoff} group by 1`;
  let judged = 0;
  for (const r of base.rows) {
    const mine = per.filter((p) => r.classIds.includes(p.c));
    assert.equal(r.unreadJudged, mine.reduce((a, p) => a + p.judged, 0), `${r.teacherName}·${r.subject} 판정 가능`);
    assert.equal(r.unread, mine.reduce((a, p) => a + p.unread, 0), `${r.teacherName}·${r.subject} 미확인`);
    judged += r.unreadJudged;
  }
  assert(judged > 0);
});

test('기준일 창: 출결 미입력 반×날 = 독립 SQL 명단 + 2.0 판정(어제까지 7일 · 휴원일 제외 · 명단 빈 날 제외)', { skip: SKIP }, async () => {
  const from = base.attendanceFrom, to = base.attendanceTo;
  const classes = (await db`select id::text id, class_name, subject, teacher_id::text teacher_id, closed_at::text closed_at from public.classes
    where tenant_id=${t} and is_active and (closed_at is null or closed_at >= ${from}) order by id`).filter((c) => !W.isTestClass(c.class_name));
  const ids = classes.map((c) => c.id);
  const [sched, enr, att] = await Promise.all([
    db`select class_id::text class_id, day_of_week::text dow, valid_from::text vf, valid_to::text vt from public.class_schedules where tenant_id=${t} and class_id = any(${ids})`,
    db`select e.class_id::text class_id, e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days
      from public.enrollments e join public.students s on s.id=e.student_id and not s.is_test where e.tenant_id=${t} and e.class_id = any(${ids})`,
    db`select class_id::text class_id, student_id::text student_id, session_date::text d from public.attendance_records where tenant_id=${t} and class_id = any(${ids}) and session_date between ${from} and ${to}`]);
  const { byClass, byColumn } = columnOf(base.rows), expected = new Map();
  for (const d of days(from, to)) for (const c of classes) {
    if (c.closed_at && c.closed_at < d) continue;
    if (!sched.some((s) => s.class_id === c.id && s.dow === dowOf(d) && s.vf && s.vf <= d && (!s.vt || s.vt >= d))) continue;
    const j = W.judgeClassAttendanceDay({ enrollments: enr.filter((e) => e.class_id === c.id), recorded: new Set(att.filter((a) => a.class_id === c.id && a.d === d).map((a) => a.student_id)), date: d, dayKey: dowOf(d) });
    if (!j.expected) continue;
    const row = byClass.get(c.id) ?? byColumn.get(`${c.teacher_id ?? 'unassigned'}:${c.subject}`);
    if (!row) continue;
    const cur = expected.get(row) ?? { days: 0, unrecorded: 0 };
    expected.set(row, { days: cur.days + 1, unrecorded: cur.unrecorded + (j.unrecorded ? 1 : 0) });
  }
  let total = 0, missing = 0;
  for (const r of base.rows) {
    const e = expected.get(r) ?? { days: 0, unrecorded: 0 };
    assert.deepEqual({ days: r.attendanceDays, unrecorded: r.attendanceUnrecorded }, e, `${r.teacherName}·${r.subject}`);
    total += e.days; missing += e.unrecorded;
  }
  assert(total > 0 && missing > 0, `대조한 반×날 ${total} · 미입력 ${missing} — 0이면 시험이 의미가 없다`);
});

test('기준일 창: 보고서 작성(수업보고서 줄) = 독립 SQL의 (학생 × 수업일) 수 ~ 반 없는 보고서만큼 더', { skip: SKIP }, async () => {
  const lesson = base.rows.filter((r) => r.reportSource === 'lesson');
  assert(lesson.length > 0);
  const [{ n: unclassified }] = await db`select count(*)::int n from public.lesson_reports r join public.students s on s.id=r.student_id and not s.is_test
    where r.tenant_id=${t} and r.class_id is null and r.report_date between ${base.reportFrom} and ${asOf}`;
  const sessions = days(base.reportFrom, asOf);
  let written = 0;
  for (const r of lesson) {
    const [{ n }] = await db`select count(distinct (r.student_id, r.report_date))::int n from public.lesson_reports r join public.students s on s.id=r.student_id and not s.is_test
      where r.tenant_id=${t} and r.class_id = any(${r.classIds}) and r.report_date = any(${sessions})`;
    assert(r.reportsWritten >= n && r.reportsWritten <= n + unclassified, `${r.teacherName}: 쓴 보고서 ${r.reportsWritten}, SQL ${n} (+반 없는 ${unclassified})`);
    assert.equal(r.reports, r.reportsWritten);
    assert(r.reportTarget >= r.reportsWritten);
    written += r.reportsWritten;
  }
  assert(written > 0);
});

test('지금(now): 기준일이면 복사본을 뜬 순간, 지난 날이면 그날의 끝 — 오늘 미작성은 그 시각까지 시작한 수업만', { skip: SKIP }, async () => {
  assert.equal(clock.at.getTime(), manifestAt.getTime(), '로더의 지금 = manifest의 capturedAt');
  assert.equal(new Date(manifestAt.getTime() + 9 * 3600000).toISOString().slice(0, 10), asOf, '기준일 = 그 순간의 KST 날짜');
  assert.deepEqual(await load({ today: asOf, now: manifestAt }), base);
  const sum = (w) => w.rows.reduce((a, r) => a + r.todayUnwritten, 0);
  const early = await load({ today: asOf, now: new Date(`${asOf}T00:00:00+09:00`) }), late = await load({ today: asOf, now: new Date(`${asOf}T23:59:00+09:00`) });
  assert.equal(sum(early), 0, '자정에는 시작한 수업이 없다');
  assert(sum(late) >= sum(base) && sum(late) > 0, `늦을수록 오늘 할 일이 늘어난다(자정 0 · 기본 ${sum(base)} · 밤 ${sum(late)})`);
  const past = new Date(Date.parse(`${asOf}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(await load({ today: past }), await load({ today: past, now: new Date(`${past}T23:59:59+09:00`) }));
});

test('8개 주 창 묶음 = 창마다 단독 호출(한 번 읽고 창마다 2.0 판정)', { skip: SKIP }, async (tc) => {
  const todays = weekWindows(asOf, 8).map((w) => w.to);
  assert.equal(todays.length, 8);
  assert.equal(todays.at(-1), asOf);
  let start = Date.now();
  const batch = await ro((sql) => loadTeacherWorkWindows({ sql, tenantId: t, todays, importV2 }));
  const batchMs = Date.now() - start;
  start = Date.now();
  const singles = [];
  for (const today of todays) singles.push(await load({ today }));
  const singleMs = Date.now() - start;
  tc.diagnostic(`8창 묶음 ${batchMs}ms · 단독 8번 ${singleMs}ms`);
  assert.equal(batch.length, 8);
  for (let i = 0; i < 8; i += 1) assert.deepEqual(batch[i], singles[i], `${todays[i]} 창`);
  // 창마다 다른 값이어야 비교가 의미 있다(같은 숫자 8개면 창을 못 가른 것).
  assert(new Set(batch.map((w) => JSON.stringify(w.rows.map((r) => [r.reports, r.attendanceDays, r.unreadJudged])))).size > 1);
  assert(batch.every((w, i) => w.to === todays[i]));
});

test('다른 영역과 같은 읽기 전용 트랜잭션: 신분(request.jwt.claims)을 건드리지 않고, 뒤 조회가 그대로 돌고, 반환은 평범한 값뿐', { skip: SKIP }, async () => {
  const todays = weekWindows(asOf, 8).map((w) => w.to);
  const out = await ro(async (sql) => {
    const [before] = await sql`select current_setting('request.jwt.claims', true) c, count(*)::int n from public.classes where tenant_id=${t}`;
    const [windows, other] = await Promise.all([loadTeacherWorkWindows({ sql, tenantId: t, todays, importV2 }),
      sql`select count(*)::int n from public.students where tenant_id=${t}`]);
    const [after] = await sql`select current_setting('request.jwt.claims', true) c, count(*)::int n from public.classes where tenant_id=${t}`;
    return { before, after, windows, other };
  });
  assert.equal(out.after.c, out.before.c, '신분 설정이 바뀌었다');
  assert(!out.after.c, '이 트랜잭션엔 신분이 없어야 한다');
  assert.equal(out.after.n, out.before.n);
  assert(out.other[0].n > 0);
  const walk = (v, path) => {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return;
    assert(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, `${path}: 평범한 객체·배열이 아니다(${Object.prototype.toString.call(v)})`);
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(out.windows, 'windows');
});

test('teacherWorkWeekly: six KPIs over 8 weekly windows — 2.0 card scope (lesson rows), real windows, no video before it existed; one computation per transaction', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const first = teacherWorkWeekly({ sql, asOf, tenantId: t, importV2 });
    assert.equal(teacherWorkWeekly({ sql, asOf, importV2 }), first, 'same transaction, tenant by default = same computation');
    const { windows, kpis } = await first;
    assert.equal(windows.length, 8); assert.equal(windows.at(-1).to, asOf);
    assert.deepEqual(kpis.map((k) => k.label), ['수업보고서 작성률', '수업보고서 발송률', '학부모 열람률', '출결 입력률', '영상 숙제 출제율', '영상 제출률']);
    assert(kpis.every((k) => k.kind === 'kpi' && k.unit === '%' && k.better === 'up' && k.points.length === 8));
    assert.equal(kpis[3].span, '어제까지 7일'); assert.match(kpis[2].span, /^최근 \d+일$/); assert.match(kpis[2].basis, /\d+시간이 안 된 것/);
    for (const k of kpis) assert.doesNotMatch(`${k.label} ${k.span} ${k.basis}`, /2\.0/,'화면 문구에 2.0을 적지 않는다(원장 10-28)');
    // Every window is cut at the same time of day as the copy (the last window ends at the capture).
    const at = (d) => clock.at.getTime() - (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`));
    assert(windows.every((w) => new Date(at(w.to) + 9 * 3600000).toISOString().slice(11, 19) === new Date(clock.at.getTime() + 9 * 3600000).toISOString().slice(11, 19)));
    const works = await loadTeacherWorkWindows({ sql, tenantId: t, todays: windows.map((w) => w.to), importV2, now: at });
    const sum = (rows, k) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0), pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const [{ first: videoFrom }] = await sql`select min(report_date)::text first from public.lesson_reports where tenant_id=${t} and video_homework is not null`;
    let differs = false;
    for (let i = 0; i < 8; i += 1) {
      const all = works[i].rows, lesson = all.filter((r) => r.reportSource === 'lesson'), video = videoFrom && windows[i].to >= videoFrom;
      const expect = [pct(sum(all, 'reports'), sum(all, 'reportTarget')), pct(sum(lesson, 'sent'), sum(lesson, 'reports') - sum(lesson, 'recalled')),
        pct(sum(lesson, 'unreadJudged') - sum(lesson, 'unread'), sum(lesson, 'unreadJudged')), pct(sum(all, 'attendanceDays') - sum(all, 'attendanceUnrecorded'), sum(all, 'attendanceDays')),
        video ? pct(sum(lesson, 'videoIssuedReports'), sum(lesson, 'reportsWritten')) : null, video ? pct(sum(all, 'videoSubmitted'), sum(all, 'videoAssigned')) : null];
      assert.deepEqual(kpis.map((k) => k.points[i].value), expect, `window ${windows[i].label}`);
      if (video && pct(sum(all, 'videoIssuedReports'), sum(all, 'reportsWritten')) !== expect[4]) differs = true;
      if (!video) assert.equal(kpis[4].points[i].value, null, 'no video homework yet → 기록 없음, not 0%');
    }
    assert(differs, 'some window has non-lesson rows that would change 출제율 — the lesson scope is doing something');
  });
});

test('as-of: a past window counts only what existed when it ended (late sends, reads and video submissions are not in it; attendance is not cut)', { skip: SKIP }, async () => {
  const today = weekWindows(asOf, 8).at(-2).to, cut = new Date(`${today}T23:59:59+09:00`);
  const [cutRes, noCut] = await Promise.all([load({ today }), load({ today, asOfCut: false })]);
  const ids = cutRes.rows.flatMap((r) => r.classIds), from = cutRes.reportFrom;
  const [{ n: lateSent }] = await db`select count(*)::int n from public.lesson_reports r join public.students s on s.id=r.student_id and not s.is_test
    where r.tenant_id=${t} and r.class_id = any(${ids}) and r.report_date between ${from} and ${today} and r.created_at <= ${cut} and r.classnote_sent_at > ${cut}`;
  // Late reads that the window would have judged (sent ≥ 48h before its end, inside its 30 days) and late video submissions of its homework.
  const [{ n: lateRead }] = await db`select count(*)::int n from public.lesson_reports r join public.students s on s.id=r.student_id and not s.is_test
    where r.tenant_id=${t} and r.class_id = any(${ids}) and r.report_date between ${cutRes.unreadFrom} and ${today} and r.classnote_status='success'
    and r.classnote_sent_at <= ${new Date(cut.getTime() - 48 * 3600000)} and r.classnote_read_at > ${cut}`;
  const [{ n: lateVideo }] = await db`select count(*)::int n from public.video_homework_auto_outcomes o join public.student_homework_videos v on v.id=o.video_id and v.tenant_id=o.tenant_id
    where o.tenant_id=${t} and o.class_id = any(${ids}) and o.homework_date between ${cutRes.videoFrom} and ${today} and o.status='submitted' and coalesce(v.posted_at, v.uploaded_at) > ${cut}`;
  const total = (w, k) => w.rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  assert(lateSent + lateRead + lateVideo > 0, 'the copy has events after this window ended (else this test proves nothing)');
  if (lateSent > 0) assert(total(noCut, 'sent') > total(cutRes, 'sent'), `late sends ${lateSent}: counted without the cut, not with it`);
  if (lateRead > 0) assert(total(cutRes, 'unread') > total(noCut, 'unread'), `late reads ${lateRead}: unread at the window's end`);
  if (lateVideo > 0) assert(total(noCut, 'videoSubmitted') > total(cutRes, 'videoSubmitted'), `late video submissions ${lateVideo}`);
  // Attendance is not cut: 2.0 re-stamps recorded_at when a cell is corrected, so cutting would drop corrected cells as if never taken.
  for (const k of ['attendanceDays', 'attendanceUnrecorded']) assert.equal(total(cutRes, k), total(noCut, k), k);
  // The copy's own day: nothing is after the capture, so the cut changes nothing.
  assert.deepEqual(await load({ today: asOf }), await load({ today: asOf, asOfCut: false }));
});

test.after(() => db?.end());
