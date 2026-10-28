// 운영실 출결·수업 영역 이식 시험 — node --test experiments/owner-concept/verify-v2-dashboard-attendance.mjs
// 영역(v2-dashboard-attendance.mjs)을 조립부와 같은 방식(읽기 전용 트랜잭션 하나 · 영역마다 저장점 · 같은 ctx)으로 돌리고, 카드에 보이는 숫자를
// 2.0 조건을 따로 적은 SQL(+ 짧은 집계)과 대조한다. 값 모양은 2.0 소스의 타입 정의(model.ts와 각 파일의 type)를 읽어 키를 맞춘다.
// 날짜·건수는 고정하지 않는다 — 복사본 기준일과 그 앞의 실제 기록에서 고른다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ATTENDANCE_AREAS } from './v2-dashboard-attendance.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
test.after(async () => { await db?.end(); });

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { rules: rosterRules, resolveSettings, copyClock, queryGate } = await import('./v2-onescreen-roster.mjs');
  var clock = await copyClock(), asOf = clock.day, RR = await rosterRules(importV2);
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var [{ data: stored }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
  var [{ name: tenantName }] = await db`select name from public.tenants where id=${t}`;
  var settings = resolveSettings(RR, stored, tenantName);
  /** 조립부(v2-dashboard-overview.mjs)와 같은 차례 — 날짜마다 새 ctx(같은 재료 기억은 날짜 안에서만) · 영역마다 저장점 하나. */
  var runMany = (dates, names) => ro(async (tx) => {
    const sql = queryGate(tx), out = {};
    for (const today of dates) {
      const ctx = { t, today, clock, settings, allowed: [], user: { id: null, name: '', role: 'master', super: false, subjects: [], ui_prefs: {} }, importV2, RR, memo: new Map() };
      out[today] = {};
      for (const name of names) {
        const t0 = Date.now();
        out[today][name] = await sql.soft(async (sp) => ({ data: await ATTENDANCE_AREAS[name](ctx, sp), ms: Date.now() - t0 }), (error) => ({ error, ms: Date.now() - t0 }));
      }
    }
    return out;
  });
  var main = (await runMany([asOf], Object.keys(ATTENDANCE_AREAS)))[asOf];
  var addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  var dowOf = (d) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${d}T00:00:00Z`).getUTCDay()];
  var toMin = (hms) => Number(hms.slice(0, 2)) * 60 + Number(hms.slice(3, 5));
  // 학원설정 휴일(저장된 원문) — 날짜 → 이름.
  var holidayOf = new Map((stored.operations?.holidays ?? []).map((h) => (typeof h === 'string' ? [h, ''] : [h?.date, typeof h?.name === 'string' ? h.name : ''])).filter(([d]) => typeof d === 'string'));
  // 과목 묶음 — 키가 영어·수학이거나 설정 이름에 '수학'·'영어'가 들어가면 그 묶음, 나머지는 과목 그대로.
  var labelOf = (k) => settings.operations.subjects.find((s) => s.key === k)?.label ?? '';
  var group = (k) => (!k?.trim() ? null : k === 'english' ? 'english' : k === 'math' ? 'math' : labelOf(k).includes('수학') ? 'math' : labelOf(k).includes('영어') ? 'english' : k);
  var byKey = (rows, keyOf) => { const m = new Map(); for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]); return m; };
  // 최근 기록이 충분한 평일(휴원일 아님)과 기록이 있는 휴원일 — 고정 날짜 대신 복사본에서 고른다.
  var [workday] = (await db`select session_date::text d from public.attendance_records where tenant_id=${t} and session_date < ${asOf} group by 1 having count(*) >= 100 order by 1 desc limit 20`)
    .map((r) => r.d).filter((d) => !holidayOf.has(d));
  var [holidayWithRecords] = (await db`select distinct session_date::text d from public.attendance_records where tenant_id=${t} and session_date <= ${asOf}
    and session_date::text = any(${[...holidayOf.keys()]}) order by 1 desc`).map((r) => r.d);
  // 같은 칸을 고친 줄(정정)이 있는 마지막 날 — 기준일 근처에 정정이 없으면 '칸마다 최신 정정' 판정이 시험되지 않으므로 그날 기준으로도 돌린다.
  var [{ d: correctionDay }] = await db`select max(session_date)::text d from (select max(session_date) session_date from public.attendance_records
    where tenant_id=${t} and session_date <= ${asOf} group by student_id, class_id, session_date, slot_start having count(*) > 1) x`;
  var withCorrection = [asOf, ...(correctionDay && correctionDay !== asOf ? [correctionDay] : [])];
}

// ── 2.0 타입 정의 읽기(값 모양 대조) ────────────────────────────────────────────────────────────────────────────────────
const SRC = new URL('../../src/', import.meta.url);
const files = new Map();
async function source(path) {
  if (!files.has(path)) files.set(path, readFile(new URL(path, SRC), 'utf8').then((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
  return files.get(path);
}
const CLOSE = { '{': '}', '(': ')', '[': ']', '<': '>' };
function closeAt(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) { if (s[j] === s[i]) d++; else if (s[j] === CLOSE[s[i]] && --d === 0) return j; }
  throw new Error(`괄호가 닫히지 않음: ${s.slice(i, i + 40)}`);
}
function splitTop(s, sep) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) { if ('{([<'.includes(ch)) d++; else if ('})]>'.includes(ch)) d--; if (ch === sep && d === 0) { out.push(cur); cur = ''; } else cur += ch; }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
}
function resolvePath(from, spec) {
  if (spec.startsWith('@/')) return `${spec.slice(2)}.ts`;
  const parts = from.split('/').slice(0, -1);
  for (const p of spec.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return `${parts.join('/')}.ts`;
}
/** 파일에서 `export type 이름 = …`의 본문, 없으면 그 이름을 가져온 import를 따라간다. */
async function typeDef(path, name) {
  const src = await source(path);
  const m = new RegExp(`export type ${name}\\b\\s*=\\s*`).exec(src);
  if (m) {
    let i = m.index + m[0].length, d = 0, j = i;
    for (; j < src.length; j++) { const ch = src[j]; if ('{([<'.includes(ch)) d++; else if ('})]>'.includes(ch)) d--; else if (ch === ';' && d === 0) break; }
    return { path, text: src.slice(i, j).trim() };
  }
  for (const im of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    const names = im[1].split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop());
    if (names.includes(name)) return typeDef(resolvePath(path, im[2]), name);
  }
  return null;
}
/** 타입 글자 → 모양 { kind: any | object(required·optional) | array(of) | nullable(of) }. 값 대조는 키만(원시 타입은 보지 않는다). */
async function shapeOf(path, text) {
  const all = splitTop(text.trim(), '|'), alts = all.filter((a) => a !== 'null' && a !== 'undefined');
  const wrap = (s) => (alts.length < all.length ? { kind: 'nullable', of: s } : s);
  if (alts.length !== 1) return wrap({ kind: 'any' });
  const inner = alts[0];
  if (inner.endsWith('[]')) return wrap({ kind: 'array', of: await shapeOf(path, inner.slice(0, -2)) });
  if (inner.startsWith('{') && closeAt(inner, 0) === inner.length - 1) {
    const required = new Map(), optional = new Map();
    for (const part of splitTop(inner.slice(1, -1), ';')) {
      const m = part.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/);
      if (m) (m[2] ? optional : required).set(m[1], await shapeOf(path, m[3]));
    }
    return wrap({ kind: 'object', required, optional });
  }
  if (/^Pick</.test(inner)) return wrap({ kind: 'object', required: new Map([...splitTop(inner.slice(5, -1), ',')[1].matchAll(/"([^"]+)"/g)].map((k) => [k[1], { kind: 'any' }])), optional: new Map() });
  const imp = inner.match(/^import\("([^"]+)"\)\.(\w+)$/);
  const def = imp ? await typeDef(resolvePath(path, imp[1]), imp[2]) : /^[A-Z]\w*$/.test(inner) ? await typeDef(path, inner) : null;
  return wrap(def ? await shapeOf(def.path, def.text) : { kind: 'any' });
}
/** 2.0 `OverviewData[영역]`의 모양(model.ts). */
async function areaShape(area) {
  const def = await typeDef('features/dashboard/overview/model.ts', 'OverviewData');
  const shape = await shapeOf(def.path, def.text);
  return shape.required.get(area) ?? shape.optional.get(area);
}
function checkShape(value, shape, at) {
  if (!shape || shape.kind === 'any' || value === undefined) return;
  if (shape.kind === 'nullable') { if (value !== null) checkShape(value, shape.of, at); return; }
  if (shape.kind === 'array') { assert.ok(Array.isArray(value), `${at}: 배열이 아님`); value.slice(0, 200).forEach((v, i) => checkShape(v, shape.of, `${at}[${i}]`)); return; }
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${at}: 객체가 아님`);
  for (const k of shape.required.keys()) assert.ok(k in value, `${at}: '${k}' 없음`);
  for (const k of Object.keys(value)) assert.ok(shape.required.has(k) || shape.optional.has(k), `${at}: 2.0 타입에 없는 '${k}'`);
  for (const [k, s] of [...shape.required, ...shape.optional]) checkShape(value[k], s, `${at}.${k}`);
}

test('영역 9개: 복사본 기준일에 오류 없이 값을 내고, 값 모양이 2.0 타입(OverviewData)의 키와 맞는다', { skip: SKIP }, async (tc) => {
  tc.diagnostic(`기준일 ${asOf} · ` + Object.entries(main).map(([k, v]) => `${k} ${v.ms}ms`).join(' · '));
  for (const [area, r] of Object.entries(main)) {
    assert.ok(!r.error, `${area}: ${r.error?.message}`);
    const shape = await areaShape(area);
    assert.ok(shape && shape.kind !== 'any', `${area}: 2.0 타입을 읽지 못함`);
    checkShape(r.data, shape, area);
  }
  // 휴원일 값(기준일이 휴원일이 아니면 null이라 모양을 못 본다) — 기록이 있는 휴원일로도.
  if (holidayWithRecords) {
    const h = (await runMany([holidayWithRecords], ['holidayAttendance']))[holidayWithRecords].holidayAttendance;
    assert.ok(!h.error, h.error?.message);
    checkShape(h.data, await areaShape('holidayAttendance'), 'holidayAttendance');
  }
});

test('오늘첫수업: 지난 60일 중 수강이 시작된 날마다 칸 = 독립 판정(오늘 전 수업 없음 = 첫 등원 · 처음 듣는 과목 묶음 = 새 과목)', { skip: SKIP }, async (tc) => {
  const dates = (await db`select distinct start_date::text d from public.enrollments where tenant_id=${t} and start_date between ${addDays(asOf, -60)} and ${asOf}
    and not coalesce(is_transferred_in, false) order by 1`).map((r) => r.d);
  if (!dates.includes(asOf)) dates.push(asOf);
  const runs = await runMany(dates, ['firstClass']);
  let seen = 0;
  for (const d of dates) {
    const got = runs[d].firstClass;
    assert.ok(!got.error, `${d}: ${got.error?.message}`);
    const rows = await db`select e.student_id::text sid, e.start_date::text s, e.end_date::text e, coalesce(e.is_transferred, false) tr, coalesce(e.is_transferred_in, false) tin, c.subject, st.name
      from public.enrollments e left join public.classes c on c.id = e.class_id left join public.students st on st.id = e.student_id
      where e.tenant_id=${t} and e.student_id in (select student_id from public.enrollments where tenant_id=${t} and start_date = ${d} and not coalesce(is_transferred_in, false))`;
    const subj = (xs) => [...new Set(xs.map((r) => r.subject?.trim()).filter(Boolean))];
    const want = [];
    for (const [sid, list] of byKey(rows, (r) => r.sid)) {
      const startsToday = list.filter((r) => r.s === d && !r.tin);
      if (!startsToday.length) continue;
      const name = list.find((r) => r.name)?.name ?? '(학생)';
      // 오늘 전에 다닌 수강 = 시작이 오늘 전(반이동으로 시작한 날 끝난 줄은 하루도 안 다녔다).
      const before = list.filter((r) => r.s < d && !(r.tr && r.e && r.e <= r.s));
      if (!before.length) { want.push(`${sid}|${name}|first|${subj(startsToday).sort()}`); continue; }
      const taken = new Set(subj(before).map(group));
      const fresh = subj(startsToday).filter((s) => !taken.has(group(s)));
      if (fresh.length) want.push(`${sid}|${name}|newSubject|${fresh.sort()}`);
    }
    assert.deepEqual(got.data.map((x) => `${x.studentId}|${x.name}|${x.kind}|${[...x.subjects].sort()}`).sort(), want.sort(), d);
    for (let i = 1; i < got.data.length; i++) assert.ok(got.data[i - 1].name.localeCompare(got.data[i].name, 'ko') <= 0, `${d}: 이름 순`);
    seen += got.data.length;
  }
  tc.diagnostic(`${dates.length}일 · 첫 수업 ${seen}명 · 기준일 ${main.firstClass.data.length}명`);
});

test('보강예정: 칸 = 독립 SQL(예약 상태 · 오늘−60일 ~ 다음 달 같은 날 전날 · 활성 반 · 학생 있음) · 지남 · 창 뒤 예약 수 · 예약한 직원', { skip: SKIP }, async (tc) => {
  const got = main.makeup.data;
  const [y, m, d] = asOf.split('-').map(Number), ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1, last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const end = d > last ? `${ny}-${String(nm).padStart(2, '0')}-${last}` : new Date(Date.UTC(ny, nm - 1, d - 1)).toISOString().slice(0, 10);
  assert.deepEqual(got.range, { start: asOf, end });
  const rows = await db`select r.id::text id, r.makeup_date::text md, u.display_name creator
    from public.makeup_reservations r join public.classes c on c.id = r.class_id and c.is_active join public.students s on s.id = r.student_id and s.tenant_id = ${t}
    left join public.users u on u.id = r.created_by and u.tenant_id = ${t}
    where r.tenant_id=${t} and r.status = 'reserved' and r.makeup_date between ${addDays(asOf, -60)} and ${end}`;
  assert.deepEqual(got.rows.map((r) => r.id).sort(), rows.map((r) => r.id).sort());
  assert.equal(got.rows.filter((r) => r.overdue).length, rows.filter((r) => r.md < asOf).length);
  const creator = new Map(rows.map((r) => [r.id, r.creator?.trim() || null]));
  for (const r of got.rows) assert.equal(r.createdByName, creator.get(r.id), r.id);
  const [{ n }] = await db`select count(*)::int n from public.makeup_reservations r join public.classes c on c.id = r.class_id and c.is_active
    where r.tenant_id=${t} and r.status = 'reserved' and r.makeup_date > ${end}`;
  assert.equal(got.later, n);
  for (let i = 1; i < got.rows.length; i++) assert.ok(`${got.rows[i - 1].makeupDate} ${got.rows[i - 1].slotStart}` <= `${got.rows[i].makeupDate} ${got.rows[i].slotStart}`, '보강일·시각 순');
  tc.diagnostic(`보강예정 ${got.rows.length}건(지남 ${got.rows.filter((r) => r.overdue).length}) · 창 뒤 ${got.later}건 · ${got.range.start}~${got.range.end}`);
});

test('최근 결석: 어제까지 7일 · 칸마다 최신 정정이 결석인 (학생·반·날) 수 · 연락 필요 = 미리 알리지 않은 결석 · 대신 보강·자리 칸의 담당 표시', { skip: SKIP }, async (tc) => {
  // 창(어제까지 7일)에 정정 줄이 들게 정정이 있던 날의 다음 날로도 돌린다.
  const days = [asOf, ...(correctionDay && correctionDay < addDays(asOf, -1) ? [addDays(correctionDay, 1)] : [])];
  const runs = await runMany(days, ['absent']);
  for (const d of days) {
    const r = runs[d].absent;
    assert.ok(!r.error, `${d}: ${r.error?.message}`);
    tc.diagnostic(await checkAbsent(d, r.data));
  }
});
async function checkAbsent(day, got) {
  const from = addDays(day, -7), to = addDays(day, -1);
  assert.deepEqual([got.from, got.to], [from, to]);
  const cells = await db`select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start) a.student_id::text sid, a.class_id::text cid, a.session_date::text d,
      a.status::text status, coalesce(a.note, '') like '%(데스크 접수)%' or (a.recorded_at at time zone 'Asia/Seoul')::date < a.session_date pre,
      tu.display_name taught_name, case when a.taught_by is null then nullif(btrim(a.seat_label), '') end seat, st.name student_name, c.class_name
    from public.attendance_records a left join public.users tu on tu.id = a.taught_by and tu.tenant_id = ${t}
      left join public.students st on st.id = a.student_id left join public.classes c on c.id = a.class_id
    where a.tenant_id=${t} and a.session_date between ${from} and ${to}
    order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc, a.id desc`;
  const pairs = byKey(cells.filter((c) => c.status === 'absent'), (c) => `${c.sid}|${c.cid}|${c.d}`);
  const want = new Map();
  for (const list of pairs.values()) {
    const w = want.get(list[0].sid) ?? { name: list[0].student_name?.trim() || '이름 없음', count: 0, unnotified: 0 };
    w.count += 1; if (!list.every((c) => c.pre)) w.unnotified += 1;
    want.set(list[0].sid, w);
  }
  assert.deepEqual(new Map(got.students.map((s) => [s.studentId, { name: s.name, count: s.count, unnotified: s.unnotified }])), want);
  let labels = 0;
  for (const s of got.students) {
    assert.equal(s.count, s.absences.length);
    for (const a of s.absences) {
      const list = pairs.get(`${s.studentId}|${a.classId}|${a.date}`);
      assert.ok(list, `${s.name} ${a.date}`);
      assert.equal(a.className, list[0].class_name?.trim() || null);
      // 대신 보강 칸은 그 강사 이름, 자리 표식 칸은 그 방 이름이 담당 표시에 선다.
      for (const c of list) for (const label of [c.taught_name?.trim(), c.seat].filter(Boolean)) { assert.ok(a.teachers.includes(label), `${s.name} ${a.date} ${label} ∉ ${a.teachers}`); labels += 1; }
    }
  }
  for (let i = 1; i < got.students.length; i++) assert.ok(got.students[i - 1].count >= got.students[i].count, '누적 많은 순');
  return `${from}~${to} · ${got.students.length}명 · 결석 ${got.students.reduce((n, s) => n + s.count, 0)}회 · 연락 필요 ${got.students.reduce((n, s) => n + s.unnotified, 0)} · 담당 표시 대조 ${labels}칸`;
}

test('출결 현황·출석률 추이: 칸마다 최신 정정(오늘 도넛 · 14일 추이) = 독립 SQL · 출석률 = (출석+지각) ÷ 기록 칸 · 오늘 점 = 도넛', { skip: SKIP }, async (tc) => {
  const runs = await runMany(withCorrection, ['attendance', 'attendanceTrend']);
  for (const d of withCorrection) {
    for (const area of ['attendance', 'attendanceTrend']) assert.ok(!runs[d][area].error, `${d} ${area}: ${runs[d][area].error?.message}`);
    tc.diagnostic(await checkAttendance(d, runs[d].attendance.data, runs[d].attendanceTrend.data));
  }
  // 기준일 값 = 조립 차례로 한 번에 돈 값(같은 재료를 두 영역이 나눠 쓴다).
  assert.deepEqual([main.attendance.data, main.attendanceTrend.data], [runs[asOf].attendance.data, runs[asOf].attendanceTrend.data]);
});
async function checkAttendance(asOf, snapshot, trend) {
  const start = addDays(asOf, -13);
  // 2.0은 기록 시각을 밀리초로 읽어(Date.parse) 비교한다 — 같은 밀리초 안에선 id가 큰 줄.
  const days = new Map((await db`with cells as (
      select distinct on (student_id, class_id, session_date, slot_start) session_date, status from public.attendance_records
      where tenant_id=${t} and session_date between ${start} and ${asOf}
      order by student_id, class_id, session_date, slot_start, date_trunc('milliseconds', recorded_at) desc, id desc)
    select session_date::text d, count(*)::int total, (count(*) filter (where status = 'present'))::int present, (count(*) filter (where status = 'absent'))::int absent,
      (count(*) filter (where status = 'late'))::int late, (count(*) filter (where status = 'excused'))::int excused from cells group by 1`).map((r) => [r.d, r]));
  const today = days.get(asOf);
  assert.deepEqual(snapshot, today ? { date: asOf, total: today.total, present: today.present, absent: today.absent, late: today.late, excused: today.excused,
    rate: ((today.present + today.late) / today.total) * 100 } : null, asOf);
  assert.deepEqual(trend.map((p) => p.date), Array.from({ length: 14 }, (_, i) => addDays(start, i)));
  for (const p of trend) {
    const r = days.get(p.date);
    assert.equal(p.total, r?.total ?? 0, p.date);
    assert.equal(p.rate, r ? ((r.present + r.late) / r.total) * 100 : null, p.date);
  }
  assert.equal(trend.at(-1).total, snapshot?.total ?? 0);
  const [{ n: raw }] = await db`select count(*)::int n from public.attendance_records where tenant_id=${t} and session_date between ${start} and ${asOf}`;
  const cellsTotal = trend.reduce((n, p) => n + p.total, 0);
  return `${asOf} · 오늘 ${today?.total ?? 0}칸 · 14일 ${cellsTotal}칸(원본 ${raw}줄 — 정정으로 접힌 줄 ${raw - cellsTotal})`;
}

test('출결 처리 현황: 그 요일 수업 반(활성·종강 전)의 예정(오늘 유효 수강 · 등원 요일 · 테스트 학생 제외)·기록 = 독립 SQL · 휴원일 = 빈 목록', { skip: SKIP }, async (tc) => {
  const dates = [asOf, workday, holidayWithRecords].filter(Boolean);
  const runs = await runMany(dates, ['processing']);
  const notes = [];
  for (const d of dates) {
    const got = runs[d].processing;
    assert.ok(!got.error, `${d}: ${got.error?.message}`);
    if (holidayOf.has(d)) { assert.deepEqual(got.data, [], `${d} 휴원일`); notes.push(`${d} 휴원일 0반`); continue; }
    const dow = dowOf(d);
    const classes = await db`select c.id::text cid, c.class_name from public.classes c where c.tenant_id=${t} and c.is_active and (c.closed_at is null or c.closed_at >= ${d})
      and exists (select 1 from public.class_schedules s where s.tenant_id=${t} and s.class_id = c.id and s.day_of_week::text = ${dow} and s.valid_from <= ${d} and (s.valid_to is null or s.valid_to >= ${d}))`;
    const enr = await db`select e.class_id::text cid, e.student_id::text sid, coalesce(st.is_test, false) test from public.enrollments e left join public.students st on st.id = e.student_id
      where e.tenant_id=${t} and e.start_date <= ${d} and not e.on_hold
        and (e.end_date is null or case when coalesce(e.is_transferred, false) then e.end_date > ${d} else e.end_date >= ${d} end)
        and (e.attendance_days is null or cardinality(e.attendance_days) = 0 or ${dow} = any(e.attendance_days))`;
    const rec = new Set((await db`select distinct class_id::text || '|' || student_id::text k from public.attendance_records where tenant_id=${t} and session_date = ${d}`).map((r) => r.k));
    const want = new Map();
    for (const c of classes) {
      const mine = enr.filter((e) => e.cid === c.cid), expected = new Set(mine.filter((e) => !e.test).map((e) => e.sid));
      if (mine.some((e) => e.test) && !expected.size) continue; // 테스트 학생뿐인 반은 줄째 뺀다
      const recorded = [...expected].filter((sid) => rec.has(`${c.cid}|${sid}`)).length;
      want.set(c.cid, { className: c.class_name, expected: expected.size, recorded, unprocessed: expected.size - recorded, rate: expected.size ? Math.round((recorded / expected.size) * 100) : 100 });
    }
    assert.deepEqual(new Map(got.data.map((r) => [r.classId, { className: r.className, expected: r.expected, recorded: r.recorded, unprocessed: r.unprocessed, rate: r.rate }])), want, d);
    for (let i = 1; i < got.data.length; i++) assert.ok(got.data[i - 1].unprocessed >= got.data[i].unprocessed, `${d}: 미처리 많은 순`);
    for (const r of got.data) for (const b of r.byTeacher ?? []) assert.ok(b.expected === r.expected && b.recorded <= b.expected, `${d} ${r.className}: 강사별 예정·기록`);
    notes.push(`${d} ${got.data.length}반 예정 ${got.data.reduce((n, r) => n + r.expected, 0)} 기록 ${got.data.reduce((n, r) => n + r.recorded, 0)}`);
  }
  tc.diagnostic(notes.join(' · '));
});

test('휴원일 입력: 휴원일이 아니면 null · 휴원일이면 이름 + 그날 입력 학생·반(칸마다 최신 정정 · 테스트 학생 제외)·예약 보강 수 = 독립 SQL', { skip: SKIP }, async (tc) => {
  if (!holidayOf.has(asOf)) assert.equal(main.holidayAttendance.data, null);
  const d = holidayWithRecords ?? asOf;
  if (!holidayOf.has(d)) { tc.diagnostic('기록이 있는 휴원일 없음 — 기준일만 확인'); return; }
  const got = (await runMany([d], ['holidayAttendance']))[d].holidayAttendance;
  assert.ok(!got.error, got.error?.message);
  const [cells] = await db`with cells as (
      select distinct on (student_id, class_id, session_date, slot_start) student_id, class_id from public.attendance_records where tenant_id=${t} and session_date = ${d}
      order by student_id, class_id, session_date, slot_start, date_trunc('milliseconds', recorded_at) desc, id desc)
    select count(distinct c.student_id)::int students, count(distinct c.class_id)::int classes from cells c left join public.students s on s.id = c.student_id where not coalesce(s.is_test, false)`;
  const [{ n }] = await db`select count(*)::int n from public.makeup_reservations r left join public.students s on s.id = r.student_id
    where r.tenant_id=${t} and r.makeup_date = ${d} and r.status = 'reserved' and not coalesce(s.is_test, false)`;
  assert.deepEqual(got.data, { name: holidayOf.get(d), counts: { students: cells.students, classes: cells.classes, reservations: n } });
  tc.diagnostic(`${d} ${got.data.name} · 입력 ${cells.students}명 · ${cells.classes}반 · 보강 예약 ${n}건`);
});

test('반복 결석: 기준일 = 오늘 이하 마지막 기록일 · 14일 (반·날) 결석 수 = 독립 집계 · 사전 통보로 설명 안 되는 결석 ≥ 3만', { skip: SKIP }, async (tc) => {
  const runs = await runMany(withCorrection, ['absences']);
  for (const d of withCorrection) {
    assert.ok(!runs[d].absences.error, `${d}: ${runs[d].absences.error?.message}`);
    tc.diagnostic(await checkAbsences(d, runs[d].absences.data));
  }
  assert.deepEqual(main.absences.data, runs[asOf].absences.data);
});
async function checkAbsences(asOf, got) {
  const [{ anchor }] = await db`select max(session_date)::text anchor from public.attendance_records where tenant_id=${t} and session_date <= ${asOf}`;
  assert.equal(got.anchor, anchor);
  if (!anchor) { assert.deepEqual(got.rows, []); return `${asOf} 기록 없음`; }
  const cells = await db`select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start) a.student_id::text sid, a.class_id::text cid, a.session_date::text d, a.status::text status,
      coalesce(a.note, '') like '%(데스크 접수)%' or (a.recorded_at at time zone 'Asia/Seoul')::date < a.session_date pre, st.name
    from public.attendance_records a join public.students st on st.id = a.student_id and st.tenant_id = ${t}
    where a.tenant_id=${t} and a.session_date between ${addDays(anchor, -13)} and ${anchor}
    order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc, a.id desc`;
  // 한 (반·날)의 결석 칸들이 사전 통보 여부에서 갈리면 2.0은 그중 한 칸으로 정한다 — 그런 날은 범위(모두/하나라도)로 본다.
  const per = new Map();
  let split = 0;
  for (const list of byKey(cells.filter((c) => c.status === 'absent'), (c) => `${c.sid}|${c.cid}|${c.d}`).values()) {
    const p = per.get(list[0].sid) ?? { name: list[0].name, absences: 0, preAll: 0, preAny: 0 };
    p.absences += 1; if (list.every((c) => c.pre)) p.preAll += 1; if (list.some((c) => c.pre)) p.preAny += 1; if (list.some((c) => c.pre) !== list.every((c) => c.pre)) split += 1;
    per.set(list[0].sid, p);
  }
  const shown = new Map(got.rows.map((r) => [r.studentId, r]));
  for (const [sid, p] of per) {
    const lo = Math.max(0, p.absences - p.preAny), hi = Math.max(0, p.absences - p.preAll), row = shown.get(sid);
    if (p.absences >= 3 && lo >= 3) assert.ok(row, `${p.name}: 빠짐`);
    if (p.absences < 3 || hi < 3) assert.ok(!row, `${p.name}: 들면 안 됨`);
    if (row) {
      assert.deepEqual([row.studentName, row.absences], [p.name, p.absences]);
      assert.ok(row.unexplained >= lo && row.unexplained <= hi && row.unexplained >= 3, `${p.name}: 설명 안 된 결석 ${row.unexplained} ∉ [${lo}, ${hi}]`);
    }
  }
  for (const sid of shown.keys()) assert.ok(per.has(sid), sid);
  return `${asOf}: 기준일 ${anchor} · 반복 결석 ${got.rows.length}명 · 사전 통보가 칸마다 갈린 (반·날) ${split}개`;
}

test('현재 수업 현황: 오늘 요일 유효 배치(활성·종강 전 반)를 빠짐없이 덮고 · 같은 반·강사·교실의 10분 이내 이어지는 교시는 한 줄 · 상태 = 복사본 시각', { skip: SKIP }, async (tc) => {
  const got = main.schedule.data;
  const slots = await db`select cs.id::text id, cs.class_id::text cid, cs.start_time::text s, cs.end_time::text e, cs.slot_teacher_label label, su.display_name slot_teacher,
      cu.display_name class_teacher, coalesce(sr.name, cs.slot_room_label, cr.name) room
    from public.class_schedules cs join public.classes c on c.id = cs.class_id and c.is_active and (c.closed_at is null or c.closed_at >= ${asOf})
      left join public.users su on su.id = cs.teacher_id left join public.users cu on cu.id = c.teacher_id
      left join public.classrooms sr on sr.id = cs.classroom_id left join public.classrooms cr on cr.id = c.classroom_id
    where cs.tenant_id=${t} and cs.day_of_week::text = ${dowOf(asOf)} and cs.valid_from <= ${asOf} and (cs.valid_to is null or cs.valid_to >= ${asOf})`;
  const { SPECIAL_SLOT_ALIAS_KEYS: aliases } = await importV2('features/timetable/lib/teacher-label.ts');
  // 강사 표시를 따로 셀 수 있는 칸만(교시 라벨 없음 · 교시 담당이 특수 방 이름이 아님): 교시 담당 → 반 담임.
  const teacherOf = (x) => (x.label != null || aliases.includes(x.slot_teacher?.trim().toLowerCase()) ? undefined : x.slot_teacher?.trim() || (x.class_teacher ?? null));
  assert.ok(got.length <= slots.length);
  for (const x of slots) {
    const home = got.filter((r) => r.classId === x.cid && toMin(r.startTime) <= toMin(x.s) && toMin(x.e) <= toMin(r.endTime) && r.classroomName === (x.room ?? null)
      && (teacherOf(x) === undefined || r.teacherName === teacherOf(x)));
    assert.ok(home.length >= 1, `배치 ${x.id} ${x.s}~${x.e}가 어느 줄에도 없음`);
  }
  const ids = new Set(slots.map((x) => x.id)), now = (clock.at.getUTCHours() * 60 + clock.at.getUTCMinutes() + 9 * 60) % (24 * 60);
  for (const r of got) {
    assert.ok(ids.has(r.id), `${r.id}: 오늘 배치가 아님`);
    assert.equal(r.status, now >= toMin(r.endTime) ? 'done' : now < toMin(r.startTime) ? 'upcoming' : 'ongoing', `${r.className} ${r.startTime}`);
  }
  for (const list of byKey(got, (r) => JSON.stringify([r.classId, r.teacherName, r.classroomName])).values()) {
    const sorted = [...list].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    for (let i = 1; i < sorted.length; i++) assert.ok(toMin(sorted[i].startTime) - toMin(sorted[i - 1].endTime) > 10, `${sorted[i].className}: 이어지는 교시가 갈려 있음`);
  }
  for (let i = 1; i < got.length; i++) assert.ok(toMin(got[i - 1].startTime) <= toMin(got[i].startTime), '시작 순');
  tc.diagnostic(`오늘 배치 ${slots.length}개 → ${got.length}줄 · 진행 중 ${got.filter((r) => r.status === 'ongoing').length} · 예정 ${got.filter((r) => r.status === 'upcoming').length} · 끝남 ${got.filter((r) => r.status === 'done').length}`);
});
