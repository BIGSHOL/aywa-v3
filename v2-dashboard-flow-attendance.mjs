// 운영실 '흐름'(확장 추세) — 출결·수업 쪽 지표(원장 10-28 *"기존 2.0 kpi들을 전부 흐름으로"*). 상단 칸 셋(오늘첫수업 · 최근 결석 · 보강예정)과
// 위젯 하나(최근 14일 등원율). 판정은 운영실 영역(v2-dashboard-attendance.mjs)과 2.0 통계 화면이 쓰는 것과 같다(같은 데이터는 같은 원본) —
// 여기는 그 판정을 화면이 고른 창(일 31 · 주 13 · 월 12 · 연 3)마다 돌릴 뿐이다.
//   first-classes   2.0 firstClassTrend(students/stats/first-class-trend.ts — 원생 통계 '첫 수업 추이')를 날마다 → 창 안 날의 합. 재료 = 2.0
//                   loadRangeEnrollmentRows(그 기간에 시작한 수강이 있는 학생의 수강 전건). 에이와 수강 기록이 갖춰진 달(trustFrom) 전 날은 세지 않는다.
//   recent-absent   운영실 '최근 결석'(getScopedRecentAbsences → foldRecentAbsences)을 창 범위로 — 창 안에 결석한 학생 수(한 학생은 한 번). 오늘은 세지 않는다.
//   makeups         운영실 '보강예정'(loadUpcomingMakeup — 그날부터 한 달 + 지난 60일 미이행)을 창 끝 날 기준으로. 지난 날짜는 그날 복사본을 뜬 시각과
//                   같은 시각의 예약 상태로 되감는다: 예약 표(생성 시각 · 이행 시각) + 감사로그(예약 · 취소 · 이행 · 되돌림 — 취소하면 표에서 줄이 지워진다).
//   attendance-rate 2.0 등원율((출석 + 지각) ÷ 유효 출결 칸 — 운영실 '최근 14일 등원율' · 출결 통계 '등원율 추이')을 창마다. 날마다 묶는 것은 2.0 DB 함수
//                   attendance_rate_buckets 본문 그대로(지점 조건만 바꿈) — 창 = 그 날들의 합. 오늘도 센다(2.0 카드의 마지막 점이 오늘이다 · 분모가 기록 칸이라
//                   수업 전이면 그날은 '기록 없음'이지 0%가 아니다).
// · 기준(dims)은 2.0이 가르는 것만 — 과목별 = 과목 묶음(2.0 sliceGroupOf: 영어·수학·설정의 과목 · 빈 과목·설정에 없는 과목은 '과목 모름').
//   합 = 전체: 첫 수업 종류별 · 보강 과목별·반별 · 등원율 과목별. 겹침(합 ≥ 전체): 첫 수업 과목별(두 과목을 함께 처음 들으면 양쪽) ·
//   결석 과목별·반별·담당별(두 반·두 과목·두 선생님 수업을 빠지면 양쪽).
// · 필터를 걸면 전체가 그 기준 값이 되고, 다른 기준의 줄은 같은 판정으로 그 안에서 다시 가른다(첫 수업 종류 × 과목 · 결석은 결석 한 번마다 · 보강은 예약마다).
// · 지난 기간: 첫 수업·결석·등원율은 지금 기록으로 그 날짜를 다시 센다(2.0 통계 화면과 같다 — 늦게 들어온·고친 기록이 그 날짜에 든다).
//   보강예정만 그날 알던 예약으로 되감는다. 반 활성 여부·학생 존재는 지금 값이다(2.0 카드도 지금 활성 반만 본다).
// · 기록 범위: 첫 수업·결석(흐름)은 창이 기록 시작 전에 시작하면 '기록 없음' · 보강예정(그날의 예약 상태)·등원율(비율)은 창 끝 날이 기록 시작 전이면.
// · 새 보강 체계(makeups.mode)가 켜진 학원이면 보강예정은 실패로 알린다(운영실 영역과 같다 — 그 참여 조회를 옮기지 않았다).
// · 읽기 전용 · 쓰기 없음 · 바깥 호출 없음.
import { queryGate, copyClock } from './v2-onescreen-roster.mjs';
import { rules as kpiRules, consts, tenantSettings, recordTrustFrom } from './v2-student-kpis.mjs';
import { rules as attendanceRules, byChunks, OVERDUE_LOOKBACK_DAYS, recentAbsenceRows, cellAxes } from './v2-dashboard-attendance.mjs';
import { kpi, weekWindows, addDays } from './domain-snapshot-core.mjs';
import { tenantId as COPY_TENANT } from './full-db.mjs';
import { isolated } from './v2-dashboard-isolate.mjs';
import { namedRecords } from './v2-dashboard-flow-students.mjs';

const EXTRA = { fct: 'features/students/stats/first-class-trend.ts', slices: 'features/dashboard/layout/slices.ts', program: 'features/students/enrollment/program.ts',
  subjects: 'features/owner/subjects.ts', groups: 'features/enrollment/intake-groups.ts', modules: 'lib/modules.ts' };
const min = (a, b) => (a < b ? a : b), max = (a, b) => (a > b ? a : b);
const one = (v) => (v == null ? null : [v, 1]);
/** 재고·비율 지표: 창 끝 날이 기록 시작 전이면 기록 없음. */
const before = (w, since) => !!since && w.to < since;
/** 흐름 지표(첫 수업 · 결석): 창이 기록 시작 전에 시작하면 기록 없음 — 앞쪽이 비어 덜 센 값을 그리지 않는다(원생 쪽 흐름과 같은 규칙). */
const flowBefore = (w, since) => !!since && w.from < since;
const UNKNOWN = 'unknown';

/** 한 트랜잭션 안의 공통 재료 — 화면이 지표·기준을 바꿔도 같은 트랜잭션이면 한 번만 읽는다(관문도 하나). */
const prepared = new WeakMap();
function prep(sql, t, importV2) {
  const m = prepared.get(sql) ?? new Map();
  if (!prepared.has(sql)) prepared.set(sql, m);
  if (!m.has(t)) m.set(t, (async () => {
    const gate = queryGate(sql), load = importV2 ?? (await import('./v2-bridge.mjs')).importV2;
    const [R, K, C0, clock, X] = await Promise.all([attendanceRules(load), kpiRules(load), consts(), copyClock(),
      Promise.all(Object.entries(EXTRA).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries)]);
    const settings = await tenantSettings(gate, t, load), subjects = settings.operations.subjects;
    // 과목 묶음 — 2.0 운영실 과목별 값과 같은 판정(sliceGroupOf · 설정 과목만). 이름 = 2.0 intakeGroupMeta(묶음 키 과목의 이름).
    const programSubjects = X.program.programSubjectsOf(X.subjects.subjectLabelRecord(subjects));
    const sliceGroup = X.slices.sliceGroupOf(subjects.map((s) => ({ key: s.key, label: s.label })), (k) => X.program.subjectGroupOf(k, programSubjects));
    const meta = X.groups.intakeGroupMeta(subjects);
    const groupKey = (subject) => sliceGroup(subject) ?? UNKNOWN;
    // 영어 = EiE · 인재원 영어로 가른다(원장 10-28 "영어와 EiE 분리") — 반의 프로그램 판정은 2.0 programOf(과목 + english_track) 그대로.
    // EiE 모듈이 꺼진 학원은 종전 그대로(영어 한 묶음). 이름 = 2.0 programLabel.
    const eieOn = X.modules.isModuleEnabled(settings.modules.disabled, 'eie');
    const own = subjects.map((s) => ({ key: s.key, label: s.label }));
    const tracks = eieOn ? new Map((await gate`select id::text id, english_track from public.classes where tenant_id=${t}`).map((r) => [r.id, r.english_track])) : new Map();
    const classGroupKey = (subject, classId) => {
      const g = groupKey(subject);
      return eieOn && g === 'english' && X.program.programOf({ subject, englishTrack: tracks.get(classId) ?? null }, own) === 'eie' ? 'eie' : g;
    };
    // 첫 수업은 영어를 가르지 못한다(2.0 firstClassTrend가 과목 이름만 받는다) — 그 지표의 영어 줄은 종전 이름('영어').
    const plainGroupLabel = (k) => meta[k]?.label ?? (k === UNKNOWN ? '과목 모름' : k);
    const groupLabel = (k) => (eieOn && k === 'eie' ? X.program.programLabel('eie', own, eieOn)
      : eieOn && k === 'english' ? X.program.programLabel('injaewon', own, eieOn)
        : meta[k]?.label ?? (k === UNKNOWN ? '과목 모름' : k));
    // 창 끝 = 그날 복사본을 뜬 시각(같은 시각끼리 견준다 · 복사본 날짜는 복사본을 뜬 순간).
    const at = (d) => new Date(clock.at.getTime() - (Date.parse(`${clock.day}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)));
    return { t, gate, R, K, C0, X, clock, settings, subjects, groupKey, classGroupKey, groupLabel, plainGroupLabel, eieOn, at, load, memo: new Map() };
  })().catch((e) => { m.delete(t); throw e; }));
  return m.get(t);
}
async function once(b, key, fn) {
  if (!b.memo.has(key)) b.memo.set(key, fn().catch((e) => { b.memo.delete(key); throw e; }));
  return b.memo.get(key);
}
/** 출결 기록의 첫날 — 결석·등원율을 믿을 수 있는 첫날(그 전은 기록이 없다). */
const attendanceSince = (b) => once(b, 'attendanceSince', async () => (await b.gate`select min(session_date)::text d from public.attendance_records where tenant_id=${b.t}`)[0].d);
/** 기준별 줄 — 창마다 항목 목록(null = 기록 없음)과 항목이 드는 기준 키들(겹칠 수 있다). 한 번도 0보다 크지 않은 줄은 싣지 않는다. */
function tally(lists, keysOf, labelOf) {
  // 창마다 한 번 훑어 키별로 센다(한 항목은 한 키에 한 번).
  const counts = lists.map((list) => {
    if (list === null) return null;
    const m = new Map();
    for (const x of list) for (const k of new Set(keysOf(x))) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  });
  const sums = new Map();
  for (const m of counts) for (const [k, n] of m ?? []) sums.set(k, (sums.get(k) ?? 0) + n);
  return [...sums.keys()].filter((k) => sums.get(k) > 0)
    .map((k) => ({ key: k, label: labelOf(k), points: counts.map((m) => (m === null ? null : [m.get(k) ?? 0, 1])) }))
    .sort((a, b) => sums.get(b.key) - sums.get(a.key) || a.label.localeCompare(b.label, 'ko'));
}

// ── 첫 수업 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const KINDS = [['first', '첫 등원'], ['newSubject', '처음 듣는 과목']];
/** 2.0 computeRecordCoverage의 trustFrom — 원생 현황 KPI·흐름과 같은 함수(복사본 날짜 · 확정값 먼저). 못 읽으면 null(자르지 않는다). */
const trustFromOf = (b) => once(b, 'trustFrom', async () => {
  const mark = await b.gate.soft(async (sp) => (await sp`select billing_from, trust_from from public.record_coverage_marks where tenant_id=${b.t}`)[0] ?? null, null);
  return b.gate.soft((sp) => recordTrustFrom(sp, b.K, b.t, b.clock.day, b.C0.coverage, mark), null);
});
/** 2.0 loadRangeEnrollmentRows — 기간에 시작하는 수강이 있는 학생 → 그 학생들의 수강 전건(반 과목 · 2.0 덩어리 차례). */
async function rangeEnrollmentRows(b, from, to) {
  const candidates = await b.gate`select student_id::text student_id from public.enrollments where tenant_id=${b.t} and start_date >= ${from} and start_date <= ${to} order by id`;
  const ids = [...new Set(candidates.map((r) => r.student_id))];
  if (!ids.length) return [];
  const rows = await b.gate`select e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.is_transferred_in, c.subject
    from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${b.t} where e.tenant_id=${b.t} and e.student_id = any(${ids}::uuid[]) order by e.id`;
  return byChunks(rows, (r) => r.student_id, ids).map((r) => ({ studentId: r.student_id, studentName: '', startDate: r.start_date, endDate: r.end_date,
    isTransferred: !!r.is_transferred, isTransferredIn: !!r.is_transferred_in, onHold: !!r.on_hold, subject: r.subject ?? null }));
}
async function firstClassSeries({ sql, asOf, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), today = asOf ?? b.clock.day;
  const trustFrom = await trustFromOf(b), since = trustFrom ? `${trustFrom}-01` : null;
  const lo = since ? max(windows[0].from, since) : windows[0].from, hi = min(windows.at(-1).to, today);
  const days = [];
  for (let d = lo; d <= hi; d = addDays(d, 1)) days.push(d);
  const rows = days.length ? await once(b, `firstRows|${lo}|${hi}`, () => rangeEnrollmentRows(b, lo, hi)) : [];
  const programSubjects = b.subjects.map((s) => ({ key: s.key, label: s.label }));
  const period = { grain: 'day', days, from: lo, to: hi, month: null, clipped: false };
  // 날마다 2.0 판정(첫 등원 · 처음 듣는 과목) — inScope = 과목 관리자처럼 그 과목 묶음의 첫 수업만.
  const trendOf = (group) => b.X.fct.firstClassTrend({ rows, period, today, subjects: programSubjects, trustFrom,
    ...(group ? { inScope: (s) => b.groupKey(s) === group } : {}) });
  const at = new Map(days.map((d, i) => [d, i]));
  const sumIn = (arr, w) => {
    let n = null;
    for (let d = max(w.from, lo); d <= min(w.to, hi); d = addDays(d, 1)) { const v = arr[at.get(d)]; if (v != null) n = (n ?? 0) + v; }
    return n;
  };
  const pick = (tr, kind) => (kind === 'first' || kind === 'newSubject' ? tr[kind] : tr.first.map((v, i) => (v == null ? null : v + tr.newSubject[i])));
  const series = (tr, kind) => windows.map((w) => (days.length && !flowBefore(w, since) ? one(sumIn(pick(tr, kind), w)) : null));
  const fGroup = filter?.dim === 'subject' ? filter.key : null, fKind = filter?.dim === 'kind' ? filter.key : null;
  const base = days.length ? trendOf(fGroup) : null;
  const total = base ? series(base, fKind) : windows.map(() => null);
  let rows_ = [];
  if (base && by === 'kind') rows_ = KINDS.filter(([k]) => !fKind || k === fKind).map(([k, label]) => ({ key: k, label, points: series(base, k) }));
  if (base && by === 'subject') {
    const groups = [...new Set(rows.filter((r) => r.startDate >= lo && r.startDate <= hi && r.subject?.trim()).map((r) => b.groupKey(r.subject.trim())))];
    rows_ = groups.map((g) => ({ key: g, label: b.plainGroupLabel(g), points: series(trendOf(g), fKind) }));
  }
  return { since, total, rows: rows_.filter((r) => r.points.some((p) => p && p[0] > 0)) };
}

// ── 결석한 학생 ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** 결석 칸의 담당 → 기준 키(이름이 없으면 2.0처럼 '담당 모름'). */
const axisKey = (a) => (!a?.label ? 'unassigned' : a.teacherId ? a.teacherId : a.source === 'seat' ? `seat:${a.seatLabel ?? ''}` : a.source);
async function absentSeries({ sql, asOf, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), R = b.R, today = asOf ?? b.clock.day, since = await attendanceSince(b);
  const lo = windows[0].from, hi = min(windows.at(-1).to, today);
  // 결석 줄이 있는 칸만(같은 접기 결과 · 긴 범위에서 줄 수가 1/10).
  const data = await once(b, `absent|${lo}|${hi}`, () => recentAbsenceRows(R, b.gate, b.t, { from: lo, to: hi }, { absentCellsOnly: true }));
  const needAxes = by === 'teacher' || filter?.dim === 'teacher';
  // 담당 = 운영실 칸과 같은 칸별 판정(대신 보강 → 자리 → 교시 담당·그날 담임) — 결석마다 그 키를 2.0 접기(foldRecentAbsences)의 teachers에 싣는다.
  const axes = needAxes && data.rows.length ? await once(b, `absentAxes|${lo}|${hi}`, () => cellAxes(R, b.gate, b.t, R.asubj.effectiveAbsentCells(data.rows), data.history)) : new Map();
  const labels = new Map([['unassigned', '담당 모름']]);
  // 자리(JJ·랩실) 담당 = 'JJ실'·'LAB실'처럼 방 이름으로(원장 10-28 — 줄 이름이 'JJ'·'LAB'만이면 무엇인지 모른다).
  const seatName = (s) => (s.endsWith('실') ? s : `${s}실`);
  for (const a of axes.values()) if (a.label) labels.set(axisKey(a), a.source === 'seat' && !a.teacherId && a.seatLabel?.trim() ? seatName(a.seatLabel.trim()) : a.label);
  const teacherOf = needAxes ? (cell) => ({ label: axisKey(axes.get(cell.id)) }) : () => null;
  const folds = windows.map((w) => (flowBefore(w, since) || w.from > hi ? null
    : R.recent.foldRecentAbsences(data.rows.filter((r) => r.session_date >= w.from && r.session_date <= w.to), { from: w.from, to: min(w.to, hi) }, teacherOf)));
  const classNames = new Map();
  for (const f of folds) for (const s of f?.students ?? []) for (const a of s.absences) classNames.set(a.classId, a.className ?? '반 이름 없음');
  const keysOf = { subject: (a) => [b.classGroupKey(a.subject, a.classId)], class: (a) => [a.classId], teacher: (a) => (a.teachers.length ? a.teachers : ['unassigned']) };
  const labelOf = { subject: b.groupLabel, class: (k) => classNames.get(k) ?? '반 이름 없음', teacher: (k) => labels.get(k) ?? '이름 확인 필요' };
  // 필터 = 과목 관리자 화면처럼 그 기준의 결석만 남기고 다시 센다(narrow.ts — 학생은 그 결석이 하나라도 있으면).
  const keep = filter && keysOf[filter.dim] ? (a) => keysOf[filter.dim](a).includes(filter.key) : () => true;
  const lists = folds.map((f) => (f ? f.students.map((s) => ({ s, abs: s.absences.filter(keep) })).filter((x) => x.abs.length) : null));
  const total = lists.map((l) => one(l?.length));
  const rows = keysOf[by] ? tally(lists, (x) => [...new Set(x.abs.flatMap(keysOf[by]))], labelOf[by]) : [];
  // '자세히 보기' 아래 목록(원장 10-28) — 필터를 걸었을 때만 · 창마다 결석한 학생(그 기준에 든 결석만).
  const records = filter ? lists.map((l) => l && l.map((x) => ({ id: x.s.studentId, key: x.s.studentId, name: x.s.name, date: x.abs.at(-1).date, dateLabel: '최종 결석일',
    note: [`결석 ${x.abs.length}회`, ...new Set(x.abs.map((a) => a.className).filter(Boolean))].join(' · ') }))) : null;
  return { since, ...await namedRecords(b.gate, t, b.load, { total, rows, ...(records ? { records } : {}) }) };
}

// ── 보강예정 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const LIFE_STATUS = { makeup_reserve: 'reserved', makeup_reserve_cancel: 'gone', makeup_reserve_done: 'done', makeup_reserve_revert: 'reserved' };
/**
 * 보강 예약마다 생애(생성 → 이행·되돌림·취소) — 표(지금 상태 · 생성 시각 · 이행 시각)와 감사로그(예약 · 취소 · 이행 · 되돌림, 예약 id가 실린 것).
 * 취소된 예약은 표에서 지워져 감사로그의 예약 기록(보강일 · 반 · 학생)으로만 남는다. 지금(복사본을 뜬 순간) 상태는 늘 표가 정한다.
 * 운영실 칸과 같이 지금 활성인 반 · 있는 학생의 예약만.
 */
async function makeupLives(b) {
  const t = b.t;
  const [rows, logs, classes] = await Promise.all([
    b.gate`select id::text id, student_id::text student_id, class_id::text class_id, makeup_date::text makeup_date, status,
        to_json(created_at)#>>'{}' created_at, to_json(done_at)#>>'{}' done_at from public.makeup_reservations where tenant_id=${t} order by id`,
    b.gate`select action, metadata, to_json(created_at)#>>'{}' created_at from public.audit_logs where tenant_id=${t}
      and action in ('makeup_reserve', 'makeup_reserve_cancel', 'makeup_reserve_done', 'makeup_reserve_revert') and metadata->>'reservationId' is not null order by created_at, id`,
    b.gate`select id::text id, class_name, subject from public.classes where tenant_id=${t} and is_active = true order by id`]);
  const lives = new Map();
  const life = (id) => lives.get(id) ?? lives.set(id, { id, info: null, events: [], final: 'gone' }).get(id);
  for (const l of logs) {
    const x = life(l.metadata.reservationId);
    x.events.push({ ms: Date.parse(l.created_at), status: LIFE_STATUS[l.action] });
    if (l.action === 'makeup_reserve' && !x.info) x.info = { studentId: l.metadata.studentId, classId: l.metadata.classId, makeupDate: l.metadata.makeupDate };
  }
  for (const r of rows) {
    const x = life(r.id);
    x.info = { studentId: r.student_id, classId: r.class_id, makeupDate: r.makeup_date };
    x.final = r.status === 'done' ? 'done' : 'reserved';
    x.events.push({ ms: Date.parse(r.created_at), status: 'reserved' });
    if (x.final === 'done' && r.done_at && !x.events.some((e) => e.status === 'done')) x.events.push({ ms: Date.parse(r.done_at), status: 'done' });
  }
  for (const x of lives.values()) x.events.sort((a, b2) => a.ms - b2.ms);
  const firstMs = Math.min(...[...lives.values()].flatMap((x) => x.events.map((e) => e.ms)));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const known = [...lives.values()].filter((x) => x.info && classById.has(x.info.classId));
  const studentIds = [...new Set(known.map((x) => x.info.studentId).filter(Boolean))];
  const students = new Set(studentIds.length ? (await b.gate`select id::text id from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])`).map((s) => s.id) : []);
  return {
    since: Number.isFinite(firstMs) ? b.R.kst.kstDateOf(new Date(firstMs)) : null,
    items: known.filter((x) => students.has(x.info.studentId)).map((x) => ({ ...x, makeupDate: String(x.info.makeupDate).slice(0, 10), classId: x.info.classId,
      className: classById.get(x.info.classId).class_name, subject: classById.get(x.info.classId).subject })),
  };
}
/** 그 순간의 상태 — 지금(복사본을 뜬 순간) 이후는 표, 그 전은 그때까지의 마지막 기록(생기기 전이면 없음). */
function stateAt(x, ms, nowMs) {
  if (ms >= nowMs) return x.final;
  let s = null;
  for (const e of x.events) { if (e.ms > ms) break; s = e.status; }
  return s;
}
async function makeupSeries({ sql, asOf, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), R = b.R, today = asOf ?? b.clock.day;
  if (R.mtypes.featureLive(b.settings.makeups?.mode)) throw new Error('새 보강 체계의 보강 참여는 아직 옮기지 않았습니다');
  const { since, items } = await once(b, 'makeupLives', () => makeupLives(b));
  const nowMs = b.clock.at.getTime();
  const keysOf = { subject: (x) => [b.classGroupKey(x.subject, x.classId)], class: (x) => [x.classId] };
  const labelOf = { subject: b.groupLabel, class: (k) => items.find((x) => x.classId === k)?.className ?? '반 이름 없음' };
  const keep = filter && keysOf[filter.dim] ? (x) => keysOf[filter.dim](x).includes(filter.key) : () => true;
  // 창 끝 날의 운영실 칸 — 그날부터 한 달(monthAheadWindow) + 지난 60일, 그 순간 예약 상태인 것.
  const lists = windows.map((w) => {
    const day = min(w.to, today);
    if (before(w, since) || w.from > today) return null;
    const range = R.upcoming.monthAheadWindow(day), from = R.week.shiftDays(day, -OVERDUE_LOOKBACK_DAYS), ms = b.at(day).getTime();
    return items.filter((x) => keep(x) && x.makeupDate >= from && x.makeupDate <= range.end && stateAt(x, ms, nowMs) === 'reserved');
  });
  const records = filter ? lists.map((l) => l && l.map((x) => ({ id: x.info.studentId, key: x.id, date: x.makeupDate, dateLabel: '보강일', ...(x.className ? { note: x.className } : {}) }))) : null;
  return { since, ...await namedRecords(b.gate, t, b.load, { total: lists.map((l) => one(l?.length)), rows: keysOf[by] ? tally(lists, keysOf[by], labelOf[by]) : [],
    ...(records ? { records } : {}) }) };
}

// ── 등원율 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 DB 함수 attendance_rate_buckets(날 단위) 본문 — auth_tenant_id() 자리에 지점. 칸마다 최신 정정(시각은 밀리초까지) · (출석 + 지각) ÷ 기록 칸. */
const rateBuckets = (b, from, to) => once(b, `rate|${from}|${to}`, () => b.gate`with eff as (
    select distinct on (student_id, class_id, session_date, coalesce(slot_start::text, '')) class_id, session_date, status::text as status
    from public.attendance_records where tenant_id = ${b.t} and session_date between ${from} and ${to}
    order by student_id, class_id, session_date, coalesce(slot_start::text, ''), date_trunc('milliseconds', recorded_at) desc, id desc
  )
  select to_char(e.session_date, 'YYYY-MM-DD') bucket, c.subject, c.id::text class_id, count(*)::int total, (count(*) filter (where e.status in ('present', 'late')))::int attended
  from eff e left join public.classes c on c.id = e.class_id and c.tenant_id = ${b.t} group by 1, 2, 3`);
async function attendanceRateSeries({ sql, asOf, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), today = asOf ?? b.clock.day, since = await attendanceSince(b);
  const lo = windows[0].from, hi = min(windows.at(-1).to, today);
  const buckets = (await rateBuckets(b, lo, hi)).map((r) => ({ ...r, group: b.classGroupKey(r.subject, r.class_id) }));
  const keep = filter?.dim === 'subject' ? (r) => r.group === filter.key : () => true;
  const point = (w, pred) => {
    if (before(w, since) || w.from > hi) return null;
    let num = 0, den = 0;
    for (const r of buckets) if (r.bucket >= w.from && r.bucket <= w.to && keep(r) && pred(r)) { num += r.attended; den += r.total; }
    return den > 0 ? [num, den] : null;
  };
  const total = windows.map((w) => point(w, () => true));
  const rows = by === 'subject'
    ? [...new Set(buckets.filter(keep).map((r) => r.group))].map((g) => ({ key: g, label: b.groupLabel(g), points: windows.map((w) => point(w, (r) => r.group === g)) }))
      .filter((r) => r.points.some(Boolean)).sort((a, c) => c.points.reduce((n, p) => n + (p?.[1] ?? 0), 0) - a.points.reduce((n, p) => n + (p?.[1] ?? 0), 0))
    : [];
  return { since, total, rows };
}

const SUBJECT_DIM = { id: 'subject', label: '과목별' };
/** 확장 추세 지표(trend-metrics.mjs가 싣는다) — id는 운영 상태 카드의 id와 같다. */
export const ATTENDANCE_TREND_METRICS = Object.freeze([
  { id: 'first-classes', label: '첫 수업', group: '운영실', unit: '명', better: 'up', dims: [{ id: 'kind', label: '종류별' }, SUBJECT_DIM], series: firstClassSeries },
  { id: 'recent-absent', label: '최근 결석', group: '운영실', unit: '명', better: 'down', endsYesterday: true,
    dims: [SUBJECT_DIM, { id: 'teacher', label: '담당 선생님별' }, { id: 'class', label: '반별' }], series: absentSeries },
  { id: 'makeups', label: '보강예정', group: '운영실', unit: '건', better: 'down', dims: [SUBJECT_DIM, { id: 'class', label: '반별' }], series: makeupSeries },
  { id: 'attendance-rate', label: '등원율', group: '운영실', unit: '%', better: 'up', dims: [SUBJECT_DIM], series: attendanceRateSeries },
].map((m) => Object.freeze(m)));

/**
 * 운영실 KPI 카드 셋 [오늘첫수업, 최근 결석, 보강예정](kpi() 모양) — 점 = 위 지표에 최근 7일 창 8개(최근 결석은 어제까지)를 넣은 전체 값.
 * 큰 숫자 = 마지막 점: 최근 결석·보강예정의 마지막 창은 2.0 칸과 같은 기간이라 2.0 칸 값과 같다. `sql` = 읽기 전용 트랜잭션.
 * ⚠️ 같은 트랜잭션의 다른 조회와 `Promise.all`로 나란히 부르지 말 것 — 안의 저장점 조회가 실패하면 나란히 돌던 조회까지 깨진다(따로 await).
 */
export async function attendanceKpiCards({ sql, asOf, tenantId = COPY_TENANT, importV2 }) {
  const weeks = weekWindows(asOf, 8), untilYesterday = weekWindows(addDays(asOf, -1), 8);
  const args = { asOf, tenantId, importV2, by: null, filter: null };
  // 차례대로 · 카드마다 저장점 — 한 카드가 실패해도(보강예정의 새 보강 체계 · DB 오류) 다른 카드는 선다(실패는 로그로).
  const card = async (what, fn) => { try { return await isolated(sql, fn); } catch (e) { console.error(`운영실 KPI(${what}): ${e?.message ?? e}`); return null; } };
  const first = await card('첫 수업', (sp) => firstClassSeries({ ...args, sql: sp, windows: weeks }));
  const absent = await card('최근 결석', (sp) => absentSeries({ ...args, sql: sp, windows: untilYesterday }));
  const makeups = await card('보강예정', (sp) => makeupSeries({ ...args, sql: sp, windows: weeks }));
  const points = (ws, s) => ws.map((w, i) => ({ label: w.label, value: s.total[i]?.[0] ?? null }));
  return [
    first && kpi(ATTENDANCE_TREND_METRICS.find(m => m.id === 'first-classes').label, '명', points(weeks, first), { id: 'first-classes', better: 'up', period: 'week', span: '최근 7일',
      basis: '그 7일 동안 날마다 집계한 첫 수업 원생의 합 · 첫 등원과 처음 듣는 과목의 첫 수업 · 반 이동과 듣던 과목의 반 추가는 제외' }),
    absent && kpi(ATTENDANCE_TREND_METRICS.find(m => m.id === 'recent-absent').label, '명', points(untilYesterday, absent), { id: 'recent-absent', better: 'down', period: 'week', span: '어제까지 7일',
      basis: '그 7일 동안 한 번이라도 결석한 원생(한 원생은 한 번) · 같은 칸을 고쳐 찍었으면 최종 기록' }),
    makeups && kpi(ATTENDANCE_TREND_METRICS.find(m => m.id === 'makeups').label, '건', points(weeks, makeups), { id: 'makeups', better: 'down', period: 'week', span: '오늘부터 한 달',
      basis: '그날 예약 상태인 보강(그날부터 한 달 안 + 지난 60일 안 아직 안 한 것) · 지난 주 점은 그 주의 끝 날 같은 시각의 예약 상태' }),
  ].filter(Boolean);
}
