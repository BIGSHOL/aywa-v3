// 운영실 '흐름' 출결·수업 지표 시험 — node --test experiments/owner-concept/verify-v2-dashboard-flow-attendance.mjs
// 카드: 최근 결석은 운영실 칸 수, 보강 진행률은 운영실 영역의 어제까지 30일 done/예약 · 첫 수업 마지막 점은 칸 7일의 합.
// 지표: 일·주·월 창을 2.0 조건을 따로 적은 계산(원본 줄을 직접 읽어 칸마다 최신 정정 · 첫 수업 판정 · 예약 생애)과 대조하고, 기준별 줄의 합과
// 전체의 관계(같음 · 겹침)와 '필터를 건 전체 = 그 키의 줄'을 확인한다. 날짜·건수는 고정하지 않는다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTENDANCE_TREND_METRICS, attendanceKpiCards } from './v2-dashboard-flow-attendance.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
test.after(async () => { await db?.end(); });

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { rules: rosterRules, resolveSettings, copyClock, queryGate } = await import('./v2-onescreen-roster.mjs');
  var { ATTENDANCE_AREAS } = await import('./v2-dashboard-attendance.mjs');
  var { windowsFor } = await import('./v2-screen-trend.mjs');
  var { addDays, weekWindows } = await import('./domain-snapshot-core.mjs');
  var clock = await copyClock(), asOf = clock.day, RR = await rosterRules(importV2);
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var [{ data: stored }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
  var [{ name: tenantName }] = await db`select name from public.tenants where id=${t}`;
  var settings = resolveSettings(RR, stored, tenantName);
  var M = Object.fromEntries(ATTENDANCE_TREND_METRICS.map((m) => [m.id, m]));
  /** 지표 하나를 화면처럼(새 읽기 전용 트랜잭션) — 걸린 시간도. */
  var run = async (id, windows, by = null, filter = null) => {
    const t0 = Date.now();
    const out = await ro((sql) => M[id].series({ sql, asOf, tenantId: t, importV2, windows, by, filter }));
    return { ...out, ms: Date.now() - t0 };
  };
  var winOf = (id, grain) => windowsFor(grain, M[id].endsYesterday ? addDays(asOf, -1) : asOf);
  /** 운영실 영역(조립부와 같은 차례 · 날짜마다 새 ctx). */
  var areaAt = (days, name) => ro(async (tx) => {
    const sql = queryGate(tx), out = {};
    for (const today of days) {
      const ctx = { t, today, clock, settings, allowed: [], user: { id: null, name: '', role: 'master', super: false, subjects: [], ui_prefs: {} }, importV2, RR, memo: new Map() };
      out[today] = await sql.soft((sp) => ATTENDANCE_AREAS[name](ctx, sp), (e) => { throw e; });
    }
    return out;
  });
  // 과목 묶음(따로 적음) — 영어·수학 키이거나 설정 이름에 '수학'·'영어'가 들면 그 묶음, 설정의 그 밖 과목은 그 키, 빈 과목·설정에 없는 과목은 '과목 모름'.
  var labelOf = (k) => settings.operations.subjects.find((s) => s.key === k)?.label ?? null;
  var group = (k) => { k = k?.trim(); if (!k || labelOf(k) === null) return 'unknown'; return k === 'english' || labelOf(k).includes('영어') ? 'english' : k === 'math' || labelOf(k).includes('수학') ? 'math' : k; };
  // 영어는 반의 영어 갈래로 EiE · 인재원 영어를 가른다(원장 10-28 "영어와 EiE 분리") — 따로 적은 판정.
  var cgroup = (k, track) => { const g = group(k); return g === 'english' && track === 'eie' ? 'eie' : g; };
  var byKey = (rows, keyOf) => { const m = new Map(); for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]); return m; };
  var daysIn = (w, lo, hi) => { const out = []; for (let d = w.from > lo ? w.from : lo; d <= w.to && d <= hi; d = addDays(d, 1)) out.push(d); return out; };
  var sumPts = (rows, i, k = 0) => rows.reduce((n, r) => n + (r.points[i]?.[k] ?? 0), 0);
  var cards = await ro((sql) => attendanceKpiCards({ sql, asOf, tenantId: t, importV2 }));
}

/** 기준별 줄과 전체 — 'same' = 창마다 줄의 합 = 전체 · 'overlap' = 줄 하나 ≤ 전체 ≤ 줄의 합(전체에 든 항목은 어느 줄엔가 든다). */
function relation(out, kind, k = 0) {
  out.total.forEach((p, i) => {
    const sum = sumPts(out.rows, i, k), v = p?.[k] ?? 0;
    if (kind === 'same') assert.equal(sum, v, `창 ${i}: 줄의 합 ${sum} ≠ 전체 ${v}`);
    else { assert.ok(sum >= v, `창 ${i}: 줄의 합 ${sum} < 전체 ${v}`); for (const r of out.rows) assert.ok((r.points[i]?.[k] ?? 0) <= v, `창 ${i} ${r.label}: 줄 > 전체`); }
  });
}
/** 필터를 건 전체 = 필터 없이 센 그 키의 줄(가장 큰 줄 둘). */
async function filterMatches(id, windows, dim, rows) {
  for (const r of rows.slice(0, 2)) {
    const f = await run(id, windows, null, { dim, key: r.key });
    assert.deepEqual(f.total, r.points, `${id} ${dim}=${r.label}`);
  }
}

test('카드 셋: [첫 수업 · 최근 결석 · 보강 진행률] · 지표 id · 8개 추세점 · 운영실 칸과 일치', { skip: SKIP }, async (tc) => {
  assert.deepEqual(cards.map((c) => c.id), ['first-classes', 'recent-absent', 'makeups']);
  for (const c of cards) {
    assert.ok(M[c.id], c.id);
    assert.equal(c.points.length, 8);
    assert.ok(c.span && c.basis && !/2\.0|[A-Za-z]/.test(c.basis + c.label + c.span), `${c.id}: 문구`);
    assert.equal(c.value, c.points.at(-1).value);
  }
  assert.deepEqual(cards[1].points.map((p) => p.label), weekWindows(addDays(asOf, -1), 8).map((w) => w.label));
  assert.deepEqual(cards[0].points.map((p) => p.label), weekWindows(asOf, 8).map((w) => w.label));
  const [absent, makeup] = [await areaAt([asOf], 'absent'), await areaAt([asOf], 'makeup')];
  assert.equal(cards[1].value, absent[asOf].students.length, '최근 결석 = 운영실 칸');
  assert.equal(cards[2].value, makeup[asOf].progress.rate, '보강 진행률 = 운영실 칸');
  // 운영실 '오늘첫수업'(그날 판정 — 그날 시작·종료하는 수강의 학생)을 7일 더한 값 = 기간 판정(그 기간에 시작한 수강의 학생)의 마지막 주.
  const days = Array.from({ length: 7 }, (_, i) => addDays(asOf, i - 6));
  const firsts = await areaAt(days, 'firstClass');
  assert.equal(cards[0].value, days.reduce((n, d) => n + firsts[d].length, 0), '첫 수업 마지막 점 = 칸 7일의 합');
  tc.diagnostic(cards.map((c) => `${c.label} ${c.value}(${c.span}) ← ${c.points.map((p) => p.value ?? '·').join(' ')}`).join(' · '));
});

test('첫 수업: 일·주·월 창 = 날마다 따로 센 첫 등원·처음 듣는 과목의 합 · 종류별 줄의 합 = 전체 · 과목별 줄 = 따로 센 값 · 믿을 첫날 전은 없음', { skip: SKIP }, async (tc) => {
  // 전 수강을 한 번 읽어 날마다 따로 판정한다(그날 시작한 수강(반이동으로 들어온 것 제외)이 있는 학생 · 오늘 전에 다닌 수강이 없으면 첫 등원 ·
  // 있으면 오늘 시작한 과목 중 묶음이 처음인 것).
  const all = await db`select e.student_id::text sid, e.start_date::text s, e.end_date::text e, coalesce(e.is_transferred, false) tr, coalesce(e.is_transferred_in, false) tin, c.subject
    from public.enrollments e left join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.start_date is not null`;
  const byStudent = byKey(all, (r) => r.sid), startsOn = byKey(all.filter((r) => !r.tin), (r) => r.s);
  const judge = (d) => {
    const out = [];
    for (const sid of new Set((startsOn.get(d) ?? []).map((r) => r.sid))) {
      const list = byStudent.get(sid), today = list.filter((r) => r.s === d && !r.tin), before = list.filter((r) => r.s < d && !(r.tr && r.e && r.e <= r.s));
      const subj = (xs) => [...new Set(xs.map((r) => r.subject?.trim()).filter(Boolean))];
      if (!before.length) { out.push({ kind: 'first', subjects: subj(today) }); continue; }
      const taken = new Set(subj(before).map(group)), fresh = subj(today).filter((s) => !taken.has(group(s)));
      if (fresh.length) out.push({ kind: 'newSubject', subjects: fresh });
    }
    return out;
  };
  const notes = [];
  for (const grain of ['day', 'week', 'month']) {
    const windows = winOf('first-classes', grain), out = await run('first-classes', windows, 'kind'), bySubject = await run('first-classes', windows, 'subject');
    assert.match(out.since ?? '', /^\d{4}-\d{2}-01$/);
    const lo = out.since, hi = asOf;
    windows.forEach((w, i) => {
      const days = daysIn(w, lo, hi);
      if (!days.length || w.from < lo) { assert.equal(out.total[i], null, `${grain} ${w.label}: 믿을 첫날 전에 시작한 창`); return; }
      const judged = days.flatMap(judge);
      assert.deepEqual(out.total[i], [judged.length, 1], `${grain} ${w.label}`);
      for (const r of out.rows) assert.deepEqual(r.points[i], [judged.filter((x) => x.kind === r.key).length, 1], `${grain} ${w.label} ${r.label}`);
      for (const r of bySubject.rows) assert.deepEqual(r.points[i], [judged.filter((x) => x.subjects.some((s) => group(s) === r.key)).length, 1], `${grain} ${w.label} ${r.label}`);
    });
    relation(out, 'same');
    notes.push(`${grain} ${out.ms}ms 합 ${out.total.reduce((n, p) => n + (p?.[0] ?? 0), 0)}`);
    if (grain === 'week') { await filterMatches('first-classes', windows, 'kind', out.rows); await filterMatches('first-classes', windows, 'subject', bySubject.rows); }
  }
  tc.diagnostic(`믿을 첫날 ${(await run('first-classes', winOf('first-classes', 'day'))).since} · ${notes.join(' · ')}`);
});

test('결석한 학생: 일·주·월 창(어제까지) = 칸마다 최신 정정이 결석인 학생 수 · 과목·반별 줄 = 따로 센 값(겹침) · 담당별은 겹침 · 필터 = 그 줄', { skip: SKIP }, async (tc) => {
  const notes = [];
  for (const grain of ['day', 'week', 'month']) {
    const windows = winOf('recent-absent', grain), lo = windows[0].from, hi = windows.at(-1).to;
    const raw = await db`select a.id::text id, a.student_id::text sid, a.class_id::text cid, a.session_date::text d, coalesce(a.slot_start::text, '') slot, a.status::text status,
        to_json(a.recorded_at)#>>'{}' rec, c.subject, c.english_track track from public.attendance_records a left join public.classes c on c.id = a.class_id
      where a.tenant_id=${t} and a.session_date between ${lo} and ${hi}`;
    // 칸(학생·반·날·교시)마다 기록 시각이 가장 늦은 줄(같으면 id가 큰 줄) — 그 줄이 결석인 칸.
    const latest = new Map();
    for (const r of raw) { const k = `${r.sid}|${r.cid}|${r.d}|${r.slot}`, p = latest.get(k); if (!p || r.rec > p.rec || (r.rec === p.rec && r.id > p.id)) latest.set(k, r); }
    const absentCells = [...latest.values()].filter((r) => r.status === 'absent');
    const [out, byClass, byTeacher] = [await run('recent-absent', windows, 'subject'), await run('recent-absent', windows, 'class'), await run('recent-absent', windows, 'teacher')];
    const [{ first }] = await db`select min(session_date)::text first from public.attendance_records where tenant_id=${t}`;
    assert.equal(out.since, first);
    windows.forEach((w, i) => {
      if (w.from < first) { assert.equal(out.total[i], null, `${grain} ${w.label}: 기록 시작 전에 시작한 창`); return; }
      const cells = absentCells.filter((c) => c.d >= w.from && c.d <= w.to), students = (pred) => new Set(cells.filter(pred).map((c) => c.sid)).size;
      assert.deepEqual(out.total[i], [students(() => true), 1], `${grain} ${w.label}`);
      for (const r of out.rows) assert.deepEqual(r.points[i], [students((c) => cgroup(c.subject, c.track) === r.key), 1], `${grain} ${w.label} ${r.label}`);
      for (const r of byClass.rows) assert.deepEqual(r.points[i], [students((c) => c.cid === r.key), 1], `${grain} ${w.label} ${r.label}`);
    });
    for (const o of [out, byClass, byTeacher]) relation(o, 'overlap');
    for (const o of [out, byClass, byTeacher]) assert.deepEqual(o.total, out.total);
    if (grain === 'week') {
      await filterMatches('recent-absent', windows, 'subject', out.rows);
      await filterMatches('recent-absent', windows, 'teacher', byTeacher.rows);
      await filterMatches('recent-absent', windows, 'class', byClass.rows);
      notes.push(`주 13창 ${out.ms}ms(과목) · ${byTeacher.ms}ms(담당 ${byTeacher.rows.length}줄) · ${byClass.ms}ms(반 ${byClass.rows.length}줄)`);
    }
  }
  tc.diagnostic(notes.join(' · '));
});

test('보강 진행률: 어제까지 30일 done/예약 · 미진행 목록 · 과목·반별 분자와 분모 합 · 필터', { skip: SKIP }, async (tc) => {
  const base = await db`select m.id::text id, m.makeup_date::text d, m.status::text status, m.class_id::text cid, c.subject, c.english_track track
    from public.makeup_reservations m join public.classes c on c.id=m.class_id and c.tenant_id=${t} and c.is_active
    join public.students s on s.id=m.student_id and s.tenant_id=${t} and not coalesce(s.is_test,false)
    where m.tenant_id=${t} and m.makeup_date between ${addDays(asOf,-30)} and ${addDays(asOf,-1)}
      and m.status::text in ('reserved','done')`;
  const done = base.filter((r) => r.status === 'done').length;
  const day = await run('makeups', winOf('makeups', 'day'), 'class');
  assert.deepEqual(day.total.at(-1), base.length ? [done, base.length] : null);
  const area = (await areaAt([asOf], 'makeup'))[asOf].progress;
  assert.deepEqual([area.done, area.total, area.rate], [done, base.length, base.length ? Math.round(done / base.length * 1000) / 10 : null]);
  assert.deepEqual(area.pending.map((r) => r.id).sort(), base.filter((r) => r.status === 'reserved').map((r) => r.id).sort());
  const card = cards.find((c) => c.id === 'makeups');
  assert.deepEqual([card.label, card.unit, card.better, card.value], ['보강 진행률', '%', 'up', area.rate]);
  for (const grain of ['day', 'week', 'month']) {
    const windows = winOf('makeups', grain), byClass = await run('makeups', windows, 'class'), bySubject = await run('makeups', windows, 'subject');
    for (const out of [byClass, bySubject]) { relation(out, 'same', 0); relation(out, 'same', 1); assert.deepEqual(out.total, byClass.total); }
    if (grain === 'week') { await filterMatches('makeups', windows, 'class', byClass.rows); await filterMatches('makeups', windows, 'subject', bySubject.rows); }
  }
  for (const row of day.rows) {
    const filtered = await run('makeups', [winOf('makeups','day').at(-1)], null, { dim:'class', key:row.key });
    assert.deepEqual(filtered.total[0], row.points.at(-1));
    assert.deepEqual((filtered.records?.[0] || []).map((x) => x.id).sort(), base.filter((x) => x.cid===row.key && x.status==='reserved').map((x) => x.id).sort());
  }
  tc.diagnostic('보강 진행률 '+(area.rate ?? '기록 없음')+'% · '+done+'/'+base.length+'건 · 미진행 '+area.pending.length+'건');
});
test('등원율: 일·주·월 창 = 칸마다 최신 정정의 (출석 + 지각) ÷ 기록 칸 · 최근 14일 일 창 = 운영실 출석률 추이 · 과목별 줄의 합 = 전체', { skip: SKIP }, async (tc) => {
  const notes = [];
  for (const grain of ['day', 'week', 'month']) {
    const windows = winOf('attendance-rate', grain), lo = windows[0].from, hi = windows.at(-1).to;
    const raw = await db`select a.id::text id, a.student_id::text sid, a.class_id::text cid, a.session_date::text d, coalesce(a.slot_start::text, '') slot, a.status::text status,
        to_json(a.recorded_at)#>>'{}' rec, c.subject, c.english_track track from public.attendance_records a left join public.classes c on c.id = a.class_id
      where a.tenant_id=${t} and a.session_date between ${lo} and ${hi}`;
    // 칸마다 마지막 기록 — 시각은 밀리초까지(같은 밀리초면 id가 큰 줄).
    const latest = new Map();
    for (const r of raw) {
      const k = `${r.sid}|${r.cid}|${r.d}|${r.slot}`, p = latest.get(k), ms = Date.parse(r.rec);
      if (!p || ms > p.ms || (ms === p.ms && r.id > p.id)) latest.set(k, { ...r, ms });
    }
    const cells = [...latest.values()];
    const out = await run('attendance-rate', windows, 'subject');
    windows.forEach((w, i) => {
      const inW = cells.filter((c) => c.d >= w.from && c.d <= w.to), pt = (pred) => { const xs = inW.filter(pred); return xs.length ? [xs.filter((c) => c.status === 'present' || c.status === 'late').length, xs.length] : null; };
      assert.deepEqual(out.total[i], w.to < out.since ? null : pt(() => true), `${grain} ${w.label}`);
      for (const r of out.rows) assert.deepEqual(r.points[i], w.to < out.since ? null : pt((c) => cgroup(c.subject, c.track) === r.key), `${grain} ${w.label} ${r.label}`);
    });
    relation(out, 'same', 0); relation(out, 'same', 1);
    if (grain === 'week') notes.push(`주 13창 ${out.ms}ms`);
  }
  const trend = (await areaAt([asOf], 'attendanceTrend'))[asOf], day = await run('attendance-rate', winOf('attendance-rate', 'day'));
  trend.forEach((p, i) => {
    const s = day.total[day.total.length - trend.length + i];
    assert.equal(s?.[1] ?? 0, p.total, p.date);
    assert.equal(s ? (s[0] / s[1]) * 100 : null, p.rate, p.date);
  });
  tc.diagnostic(notes.join(' · '));
});

test('영어 = EiE · 인재원 영어로 가른다(원장 10-28) · 다시 합치면 종전 영어 줄 · 자리 담당 이름 = ○○실 · 줄 이름에 영문 키 없음', { skip: SKIP }, async () => {
  const windows = winOf('attendance-rate', 'month');
  const rate = await run('attendance-rate', windows, 'subject'), by = Object.fromEntries(rate.rows.map((r) => [r.key, r]));
  assert.ok(by.eie && by.english, 'EiE 줄과 인재원 영어 줄');
  assert.equal(by.eie.label, 'EiE'); assert.equal(by.english.label, '인재원 영어');
  // 칸 수(분모)·출석 수(분자)는 합 — 다시 합친 영어 = EiE 반 + 나머지 영어 반(따로 센 값과 같다는 것은 위 등원율 시험이 칸마다 본다).
  const [{ n }] = await db`select count(*)::int n from public.classes where tenant_id=${t} and subject='english' and english_track='eie'`;
  assert.ok(n > 0, 'EiE 반이 있다');
  const absent = await run('recent-absent', winOf('recent-absent', 'month'), 'teacher');
  for (const r of absent.rows) {
    // 자리 이름이 있으면 '○○실' · 비었으면 2.0 담당 이름 그대로('자리 수업실' 같은 말을 만들지 않는다).
    if (/^seat:.+/.test(r.key)) assert.match(r.label, /실$/, r.key);
    else if (r.key === 'seat:') assert.ok(!/수업실$/.test(r.label), r.label);
    assert.ok(!/^[a-z_:]+$/i.test(r.label) || /[가-힣]/.test(r.label), `${r.key} → ${r.label}`);
  }
  for (const id of ['recent-absent', 'makeups', 'first-classes']) {
    const out = await run(id, winOf(id, 'month'), 'subject');
    for (const r of out.rows) assert.ok(/[가-힣]|EiE/.test(r.label), `${id} ${r.key} → ${r.label}`);
  }
});
