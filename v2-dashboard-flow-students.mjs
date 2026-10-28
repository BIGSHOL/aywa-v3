// 운영실 '흐름'(확장 추세) — 원생 쪽 지표(원장 10-28 *"기존 2.0 kpi들을 전부 흐름으로"*). 상단 칸 다섯(재원생 · 강좌수 · 퇴원·수업종료 · 신규문의 ·
// 신규 등록)과 위젯 셋(등록·퇴원 추이의 등록 · 퇴원 · 등록 후 3개월 내 퇴원). 계산은 원생 현황 KPI(v2-student-kpis.mjs)·운영실 영역과 같은 2.0 판정이다
// (같은 데이터는 같은 원본) — 여기는 그 판정을 화면이 고른 창(일 31 · 주 13 · 월 12 · 연 3)마다 돌릴 뿐이다.
// · 재고 지표(재원생 · 강좌수) = 창 끝 날의 값(오늘을 넘으면 오늘). 흐름 지표 = 창 안에 생긴 것의 수.
// · 시각이 있는 기록(상담일 · 등록 전환 · 수업종료의 수강 생성)은 지난 창이면 그 창 마지막 날이 끝날 때까지, 지금 창(마지막 날 = 오늘)이면 복사본을 뜬
//   순간까지 센다 — 선생님 수업보고서 확장 추세와 같은 규칙. 지금 창은 카드의 큰 숫자와 같다. (카드의 추세선은 비교를 공정하게 하려고 지난 창도
//   오늘과 같은 시각에 자르고, 퇴원·수업종료는 달마다 1일~같은 날로 센다 — 지난 점은 카드가 확장 추세보다 작거나 같다.)
// · 기록 범위: 흐름 지표는 창이 기록 시작 전에 시작하면 '기록 없음'(앞쪽이 비어 덜 센 값을 그리지 않는다) · 재고 지표는 창 끝 날이 기록 시작 전이면.
//   등록·퇴원 계열의 기록 시작 = 2.0 원생 통계 flowBounds(퇴원 기록이 시작된 달과 에이와 수강 기록이 갖춰진 달 중 늦은 달 · 과목으로 좁히거나
//   수업종료를 세면 수강 종료가 처음 기록된 달도 — 그 전 달은 실제보다 낮게 나온다).
// · 기준(dims)은 2.0이 가르는 것만. 합 = 전체(나뉨): 수강 구성별 · 강좌 과목별 · 퇴원 프로그램별 · 상담 과목 조합별.
//   겹침(합 ≥ 전체): 과목별 재원생 · 상담 과목별 · 등록·퇴원 과목별(과목 묶음 · 두 과목이면 양쪽 — 2.0 과목 관리자 값 · 신규 문의 추이 '선 보기'와 같은 뜻) ·
//   3개월 내 퇴원 기간별(2.0 30·60·90일 누적 — '3개월 이내' 줄 = 전체).
// · 필터를 걸면 전체가 그 기준에 드는 것의 수가 되고, 줄은 고른 기준으로 그 안에서 다시 가른다(항목이 있는 흐름 지표). 재원생·강좌수는 2.0에 두 기준을
//   함께 가르는 판정이 없어 필터의 줄 하나만 낸다.
// · 읽기 전용 · 쓰기 없음 · 바깥 호출 없음.
import { queryGate, copyClock } from './v2-onescreen-roster.mjs';
import { rules as kpiRules, consts, tenantSettings, trendRaw, cleanupBilling, recordTrustFrom, windowWithdrawals, subjectEndedInputs, subjectEnded,
  enrolledInputs, enrolledItemsIn, monthWithdrawalRows } from './v2-student-kpis.mjs';
import { recordCoverage } from './v2-dashboard-trends.mjs';
import { tenantId as COPY_TENANT } from './full-db.mjs';

const EXTRA = { program: 'features/students/enrollment/program.ts', intake: 'features/enrollment/intake-groups.ts', early: 'features/withdrawals/early-exit.ts',
  modules: 'lib/modules.ts' };
const UNKNOWN = 'unknown';
const min = (a, b) => (a < b ? a : b);
/** 두 달(YYYY-MM · null = 모름) 중 늦은 달. */
const later = (...months) => months.filter(Boolean).reduce((a, m) => (!a || m > a ? m : a), null);
const monthStart = (m) => (m ? `${m}-01` : null);
const one = (v) => (v == null ? null : [v, 1]);

/** 한 트랜잭션 안의 공통 재료 — 화면이 지표·기준을 바꿔도 같은 트랜잭션이면 한 번만 읽는다. */
const prepared = new WeakMap();
function prep(sql, t, importV2) {
  const m = prepared.get(sql) ?? new Map();
  if (!prepared.has(sql)) prepared.set(sql, m);
  if (!m.has(t)) m.set(t, (async () => {
    const gate = queryGate(sql), load = importV2 ?? (await import('./v2-bridge.mjs')).importV2;
    const [R, C0, clock, X] = await Promise.all([kpiRules(load), consts(), copyClock(),
      Promise.all(Object.entries(EXTRA).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries)]);
    const settings = await tenantSettings(gate, t, load), subjects = settings.operations.subjects;
    // 기록 범위·장부 정리 청구는 복사본 날짜로 판정(카드와 같다) — 못 읽으면 2.0처럼 그 규칙 없이.
    const mark = await gate.soft(async (sp) => (await sp`select billing_from, trust_from from public.record_coverage_marks where tenant_id=${t}`)[0] ?? null, null);
    const trustFrom = await gate.soft((sp) => recordTrustFrom(sp, R, t, clock.day, C0.coverage, mark), null);
    const billing = await gate.soft((sp) => cleanupBilling(sp, R, t, clock.day, C0.search), null);
    const raw = await trendRaw(gate, R, t, clock.day);
    const en = { firstStart: new Map(raw.firstStart), ended: new Set(raw.ended),
      billing: billing?.billingFrom ? { from: billing.billingFrom, today: clock.day, months: new Map(billing.billed) } : undefined };
    const bounds = (d) => R.bounds.kstDayBounds(d);
    // 창 끝 시각 — 지난 날이면 그날이 끝날 때, 오늘이면 복사본을 뜬 순간(위 머리말 규칙).
    const endOf = (d) => (d < clock.day ? bounds(d).endIso : clock.at.toISOString());
    const eieOn = X.modules.isModuleEnabled(settings.modules.disabled, 'eie');
    const programSubjects = subjects.map((s) => ({ key: s.key, label: s.label }));
    const groupOf = (subject) => X.program.subjectGroupOf(subject, programSubjects);
    const labelOf = (key) => subjects.find((s) => s.key === key)?.label ?? null;
    // 상담 과목 글자 → 과목 묶음(2.0 신규 문의 추이 intakeGroupsOf — 'EIE' = 영어 · '영어 수학' = 둘 다 · 못 읽으면 없음) · 묶음 이름 = intakeGroupMeta.
    const consultGroupsOf = X.intake.intakeGroupsOf(subjects), groupMeta = X.intake.intakeGroupMeta(subjects);
    const groupLabel = (g) => (g === UNKNOWN ? '과목 모름' : groupMeta[g]?.label ?? labelOf(g) ?? '그 밖의 과목');
    // 수강 종료가 처음 기록된 달(2.0 breakdownFrom) · 등록·퇴원 기록 시작(2.0 flowBounds — 퇴원 기록 시작과 기록 범위 중 늦은 달).
    const breakdownFrom = raw.enrollments.reduce((m, e) => (e.end && e.end.slice(0, 10) <= clock.day && (!m || e.end < m) ? e.end : m), null)?.slice(0, 7) ?? null;
    const flowFrom = later(raw.recordsFrom, trustFrom);
    return { t, gate, R, X, clock, today: clock.day, settings, subjects, trustFrom, raw, en, bounds, endOf, eieOn, programSubjects, groupOf, labelOf,
      consultGroupsOf, groupMeta, groupLabel, breakdownFrom, flowFrom, load, memo: new Map() };
  })().catch((e) => { m.delete(t); throw e; }));
  return m.get(t);
}
async function once(b, key, fn) {
  if (!b.memo.has(key)) b.memo.set(key, fn().catch((e) => { b.memo.delete(key); throw e; }));
  return b.memo.get(key);
}
/** 창 → 2.0 추이 점(날짜 = 창 끝 날, 오늘을 넘으면 오늘). */
const pointsOf = (b, windows) => windows.map((w) => ({ key: w.to, label: w.label, date: min(w.to, b.today) }));
/** 재고 지표: 창 끝 날이 기록 시작 전이면 기록 없음. */
const stockBefore = (w, since) => !!since && w.to < since;
/** 흐름 지표: 창이 기록 시작 전에 시작했거나 오늘 뒤면 기록 없음. */
const flowOff = (b, w, since) => (!!since && w.from < since) || w.from > b.today;

/**
 * 창마다 항목 목록(null = 기록 없음) → { total, rows }. `keysOf[dim](x)` = 그 항목이 드는 키들(겹칠 수 있다) · `labelOf[dim](key)` = 줄 이름 ·
 * `fixed[dim]` = 0이어도 세울 키(차례 그대로 앞에). 필터 = 그 기준 키에 드는 항목만 → 전체 · 줄은 `by`로 그 안에서 다시 가른다(같은 기준이면 그 줄 하나).
 */
function tallyItems(lists, { by, filter, keysOf, labelOf, fixed = {} }) {
  const kept = filter && keysOf[filter.dim] ? lists.map((l) => l && l.filter((x) => keysOf[filter.dim](x).includes(filter.key))) : lists;
  const dim = keysOf[by] ? by : Object.keys(keysOf)[0];
  const seen = new Set();
  for (const l of kept) for (const x of l ?? []) for (const k of keysOf[dim](x)) seen.add(k);
  const keys = filter && filter.dim === dim ? [filter.key] : [...new Set([...(fixed[dim] ?? []), ...[...seen].sort()])];
  return {
    total: kept.map((l) => (l === null ? null : [l.length, 1])),
    rows: keys.map((k) => ({ key: k, label: labelOf[dim](k), points: kept.map((l) => (l === null ? null : [l.filter((x) => keysOf[dim](x).includes(k)).length, 1])) })),
  };
}
/** 필터를 건 재고 지표 — 그 줄이 곧 전체(줄도 그 하나). 없는 키면 기록 없음. */
const filtered = (rows, filter, windows) => {
  const row = rows.find((r) => r.key === filter.key);
  return { total: row ? row.points : windows.map(() => null), rows: row ? [row] : [] };
};

// ── 재원생(재고) ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function enrolledSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), R = b.R, pts = pointsOf(b, windows), since = b.trustFrom ? `${b.trustFrom}-01` : null;
  const keys = b.subjects.map((s) => s.key);
  const split = R.trend.breakdownTrendOf(b.raw.students, b.en, b.raw.enrollments, pts, keys, b.groupOf, b.today);
  const series = (arr) => arr.map((p, i) => (stockBefore(windows[i], since) ? null : one(p.count)));
  // 수강 구성 이름 = 영어·수학 묶음의 학원 설정 이름(2.0 programLabel과 같은 출처).
  const E = b.labelOf('english') ?? '영어', M = b.labelOf('math') ?? '수학';
  const mix = [['englishOnly', `${E}만`], ['both', `${E}+${M}`], ['mathOnly', `${M}만`], ['otherOnly', '그 밖의 과목만'], [UNKNOWN, '미수강']]
    .map(([k, label]) => ({ key: k, label, points: series(k === UNKNOWN ? split.unknown : split.mix[k]) }));
  const subjectRows = keys.map((k) => ({ key: k, label: b.labelOf(k), points: series(split.bySubject[k]) }));
  if (filter) return { since, ...filtered(filter.dim === 'mix' ? mix : subjectRows, filter, windows) };
  return { since, total: series(R.trend.trendOf(b.raw.students, b.en, pts)), rows: by === 'subject' ? subjectRows : mix };
}

// ── 강좌수(재고) ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function coursesSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, filter }) {
  const b = await prep(sql, t, importV2), R = b.R, pts = pointsOf(b, windows);
  // 강좌수는 수강 종료가 처음 기록된 달과 기록 범위 중 늦은 달부터(2.0 clipCourses).
  const since = monthStart(later(b.breakdownFrom, b.trustFrom));
  const groups = [...new Set(b.subjects.map((s) => b.groupOf(s.key)).filter(Boolean))];
  const rowGroup = (e) => b.groupOf(e.subject);
  const series = (arr) => arr.map((p, i) => (stockBefore(windows[i], since) ? null : one(p.count)));
  const total = series(R.courseTrend.courseTrendOf(b.raw.students, b.en, b.raw.enrollments, pts, undefined, b.today, b.subjects));
  const split = R.courseTrend.courseBreakdownOf(b.raw.students, b.en, b.raw.enrollments, pts, groups, rowGroup, b.today, undefined, b.subjects);
  const rows = groups.map((g) => ({ key: g, label: b.groupLabel(g), points: series(split.groups[g]) }));
  // 과목이 비었거나 설정에 없는 과목의 강좌 = 어느 묶음에도 안 든다 — 남는 수를 '과목 모름' 줄로(합 = 전체).
  const rest = total.map((p, i) => (p === null ? null : [p[0] - rows.reduce((n, r) => n + (r.points[i]?.[0] ?? 0), 0), 1]));
  if (rest.some((p) => p && p[0] > 0)) rows.push({ key: UNKNOWN, label: '과목 모름', points: rest });
  if (filter) return { since, ...filtered(rows, filter, windows) };
  return { since, total, rows };
}

// ── 퇴원·수업종료 · 퇴원 · 등록 후 3개월 내 퇴원(흐름) ─────────────────────────────────────────────────────────────────
/** 창 전체를 덮는 퇴원 행·수업종료 재료(가장 이른 창 첫날부터). */
async function exitInputs(b, windows) {
  const from = windows[0].from;
  return once(b, `exits|${from}`, async () => ({ withdrawn: await windowWithdrawals(b.gate, b.R, b.t, from, b.today), endedIn: await subjectEndedInputs(b.gate, b.R, b.t, from) }));
}
/** 2.0 monthWithdrawals를 창 [from, to]로(카드와 같은 함수) — 추세선 규칙(단체 장부 정리 퇴원 제외 · 지난 날짜 수업종료 = 그날 뒤 퇴원생 포함 · 수강 생성 시각 컷). */
function exitRowsIn(b, inputs, from, to) {
  const past = to < b.today, cut = Date.parse(b.endOf(to)), firstMs = inputs.endedIn.firstCreatedMs;
  const ended = subjectEnded(b.R, inputs.endedIn, to, { past, trend: true, cutMs: past && firstMs !== null && cut >= firstMs ? cut : null });
  return monthWithdrawalRows(b.R, inputs.withdrawn.filter((row) => !row.cleanup), ended, to, b.subjects, { from, to });
}
/** 등록·퇴원 계열의 기록 시작(위 머리말) — `subjectScoped` = 과목으로 좁히거나 수업종료를 센다. */
const flowSince = (b, subjectScoped = false) => monthStart(later(b.flowFrom, subjectScoped ? b.breakdownFrom : null));
/** 퇴원·수업종료 — 2.0 칸 판정(퇴원은 과목마다 한 줄 + 과목 전체 종료) · 프로그램별 = 2.0 countWithdrawalPrograms(EiE를 안 쓰는 학원은 그 줄 없음). */
async function exitsSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), P = b.X.program;
  const inputs = await exitInputs(b, windows), since = flowSince(b, true);
  const lists = windows.map((w) => (flowOff(b, w, since) ? null : exitRowsIn(b, inputs, w.from, min(w.to, b.today))));
  const programs = [...P.visiblePrograms(b.eieOn), 'other'];
  return { since, ...tallyItems(lists, { by, filter, keysOf: { program: (x) => [x.program ?? 'other'] },
    labelOf: { program: (k) => (k === 'other' ? '그 밖·모름' : P.programLabel(k, b.programSubjects, b.eieOn)) }, fixed: { program: programs } }) };
}
/** 반 과목 키들 → 과목 묶음(2.0 subjectGroupOf · 학원 설정 과목의 묶음만) — 하나도 없으면 '과목 모름'. */
const subjectGroups = (b) => {
  const known = new Set(Object.keys(b.groupMeta));
  return (subjects) => { const g = [...new Set(subjects.map((k) => (k ? b.groupOf(k) : null)))].filter((x) => x && known.has(x)); return g.length ? g : [UNKNOWN]; };
};
const groupDim = (b, keysOf) => ({ keysOf: { subject: keysOf }, labelOf: { subject: b.groupLabel }, fixed: { subject: Object.keys(b.groupMeta) } });
/** 퇴원(학생마다 한 번 · 단체 장부 정리 제외) — 2.0 등록·퇴원 추이의 퇴원 칸과 같은 행. 과목별은 퇴원 무렵 끝난 반의 과목 묶음(두 과목이면 양쪽). */
async function withdrawnSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2);
  const inputs = await exitInputs(b, windows), since = flowSince(b, !!filter), groupsOf = subjectGroups(b);
  const lists = windows.map((w) => (flowOff(b, w, since) ? null : inputs.withdrawn.filter((r) => !r.cleanup && r.withdrawnAt >= w.from && r.withdrawnAt <= min(w.to, b.today))));
  return { since, ...tallyItems(lists, { by, filter,
    ...groupDim(b, (r) => groupsOf(r.exitClasses.length ? r.exitClasses.map((c) => c.subject) : [r.lastClassSubject])) }) };
}
/** 등록 후 3개월 내 퇴원 — 2.0 early-exit.ts(등록일부터 30·60·90일 누적 · 판정 못 하는 퇴원 제외) · 추세선과 같이 단체 장부 정리 제외. */
async function earlyExitsSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), E = b.X.early;
  const inputs = await exitInputs(b, windows), since = flowSince(b);
  const spansOf = (r) => { const days = E.tenureDays(r.enrolledAt, r.withdrawnAt); return E.EARLY_SPANS.filter((s) => E.isEarlyWithin(days, s.key)).map((s) => s.key); };
  const lists = windows.map((w) => (flowOff(b, w, since) ? null
    : inputs.withdrawn.filter((r) => !r.cleanup && r.withdrawnAt >= w.from && r.withdrawnAt <= min(w.to, b.today) && spansOf(r).length > 0)));
  return { since, ...tallyItems(lists, { by, filter, keysOf: { tenure: spansOf }, labelOf: { tenure: (k) => E.earlySpan(k).label }, fixed: { tenure: E.EARLY_SPANS.map((s) => s.key) } }) };
}

// ── 신규문의 · 신규 등록 · 등록(흐름) ────────────────────────────────────────────────────────────────────────────────
/** 상담 과목 글자로 가르는 두 기준 — 과목 조합별(나뉨 · 2.0 막대 보기) · 과목별(겹침 · 2.0 선 보기). 못 읽는 글자·빈칸 = 과목 모름. */
function consultDims(b, textOf) {
  const groupsOf = (x) => [...new Set(b.consultGroupsOf(textOf(x)))].sort();
  const fixed = Object.keys(b.groupMeta);
  return {
    keysOf: { combo: (x) => { const g = groupsOf(x); return [g.length ? g.join('.') : UNKNOWN]; }, subject: (x) => { const g = groupsOf(x); return g.length ? g : [UNKNOWN]; } },
    // 한 과목 조합은 '영어만'(과목별의 '영어' 줄은 두 과목 문의도 더한 값이라 이름을 가른다 — 2.0 신규 문의 추이와 같은 이름).
    labelOf: { combo: (k) => (k === UNKNOWN ? '과목 모름' : k.includes('.') ? k.split('.').map(b.groupLabel).join('+') : `${b.groupLabel(k)}만`), subject: b.groupLabel },
    fixed: { combo: fixed, subject: fixed },
  };
}
/** 신규문의 — 상담일이 창 안인 신규 콜&상담(2.0 신규 문의 추이와 같은 축 · 옮겨 넣은 옛 상담은 원래 상담일에 든다). */
async function intakeSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2);
  const lo = b.bounds(windows[0].from).startIso, hi = b.endOf(min(windows.at(-1).to, b.today));
  const [rows, [{ first }]] = await Promise.all([
    b.gate`select to_json(consulted_at)#>>'{}' consulted, subject from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${lo} and consulted_at < ${hi} order by consulted_at, id`,
    b.gate`select to_json(min(consulted_at))#>>'{}' first from public.enrollment_consultations where tenant_id=${t}`]);
  const since = first ? b.R.kst.kstDateOf(first) : null;
  const ms = rows.map((r) => ({ ms: Date.parse(r.consulted), subject: r.subject }));
  const lists = windows.map((w) => {
    if (!since || flowOff(b, w, since)) return null;
    const from = Date.parse(b.bounds(w.from).startIso), to = Date.parse(b.endOf(min(w.to, b.today)));
    return ms.filter((r) => r.ms >= from && r.ms < to);
  });
  return { since, ...tallyItems(lists, { by, filter, ...consultDims(b, (x) => x.subject) }) };
}
/** 신규 등록 — 창 안에 '등록 완료'가 된 신규 콜&상담(상태 변경 · 반 배정) · 원생 현황 KPI '신규 등록' 칸과 같은 판정. 과목 = 상담 과목. */
async function newEnrollmentSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2);
  const d = await once(b, `enrolled|${windows[0].from}`, () => enrolledInputs(b.gate, b.R, t, b.bounds(windows[0].from).startIso, b.bounds(b.today).endIso, b.subjects));
  const since = d.firstLog ? b.R.kst.kstDateOf(d.firstLog) : null;
  const lists = windows.map((w) => {
    const from = b.bounds(w.from).startIso;
    // 상태 변경 기록이 남기 전에 시작한 창은 기록 없음(카드와 같은 규칙).
    if (!d.firstLog || Date.parse(from) < Date.parse(d.firstLog) || w.from > b.today) return null;
    return enrolledItemsIn(b.R, d, from, b.endOf(min(w.to, b.today)), min(w.to, b.today));
  });
  return { since, ...tallyItems(lists, { by, filter, ...consultDims(b, (x) => x.subject) }) };
}
/**
 * 등록 — 2.0 등록·퇴원 추이의 등록 칸(loadMonthlyChanges): 그 기간 등록일 · 상태는 보지 않는다 · 병합 · 수업 기록 없는 장부 정리 제외 ·
 * 청구가 지점을 덮은 달 이후 등록은 수업을 시작한 등록만(computeRecordCoverage). 과목별 = 그 학생이 들은(듣는) 반의 과목 묶음(두 과목이면 양쪽 · 없거나 설정에 없으면 모름).
 */
async function joinsSeries({ sql, tenantId: t = COPY_TENANT, importV2, windows, by, filter }) {
  const b = await prep(sql, t, importV2), R = b.R, gate = b.gate;
  const from = windows[0].from;
  const data = await once(b, `joins|${from}`, async () => {
    const counted = (await gate`select id::text id, enrolled_at::text enrolled_at, notes, withdrawal_metadata from public.students where tenant_id=${t} and enrolled_at >= ${from} order by id`)
      .filter((r) => !R.merged.isMergedStudent(r.notes));
    const candidates = counted.filter((r) => R.bulk.isCleanupExit(r.withdrawal_metadata));
    const withHistory = new Set(candidates.length ? (await gate`select distinct student_id::text s from public.enrollments where tenant_id=${t}
      and student_id = any(${candidates.map((r) => r.id)}::uuid[]) and end_date is not null`).map((r) => r.s) : []);
    const bookkeeping = new Set(candidates.filter((r) => R.bulk.isBookkeepingOnlyExit({ withdrawalMetadata: r.withdrawal_metadata, hasEnrollmentHistory: withHistory.has(r.id) })).map((r) => r.id));
    const range = await recordCoverage({ t, today: b.today, importV2: b.load, memo: b.memo }, gate);
    const started = range?.billingFrom ? new Set(range.started) : null;
    const joined = counted.filter((r) => !bookkeeping.has(r.id) && (!started || !r.enrolled_at || r.enrolled_at.slice(0, 7) < range.billingFrom || started.has(r.id)));
    const subj = joined.length ? await gate`select e.student_id::text s, c.subject from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
      where e.tenant_id=${t} and e.student_id = any(${joined.map((r) => r.id)}::uuid[]) and c.subject is not null` : [];
    const subjectsOf = new Map();
    for (const r of subj) subjectsOf.set(r.s, [...new Set([...(subjectsOf.get(r.s) ?? []), r.subject])]);
    return joined.map((r) => ({ day: r.enrolled_at.slice(0, 10), subjects: subjectsOf.get(r.id) ?? [] }));
  });
  const since = flowSince(b, !!filter), groupsOf = subjectGroups(b);
  const lists = windows.map((w) => (flowOff(b, w, since) ? null : data.filter((r) => r.day >= w.from && r.day <= min(w.to, b.today))));
  return { since, ...tallyItems(lists, { by, filter, ...groupDim(b, (r) => groupsOf(r.subjects)) }) };
}

const SUBJECT_DIM = { id: 'subject', label: '과목별' };
const CONSULT_DIMS = [{ id: 'combo', label: '과목 조합별' }, SUBJECT_DIM];
/** 확장 추세 지표(trend-metrics.mjs가 싣는다) — id는 운영실 KPI 카드의 id와 같다. */
export const STUDENT_TREND_METRICS = Object.freeze([
  { id: 'enrolled-students', label: '재원생', group: '운영실', unit: '명', better: 'up', dims: [{ id: 'mix', label: '수강 구성별' }, SUBJECT_DIM], series: enrolledSeries },
  { id: 'courses', label: '강좌수', group: '운영실', unit: '개', better: 'up', dims: [SUBJECT_DIM], series: coursesSeries },
  { id: 'exits', label: '퇴원·수업종료', group: '운영실', unit: '명', better: 'down', dims: [{ id: 'program', label: '프로그램별' }], series: exitsSeries },
  { id: 'intake', label: '신규문의', group: '운영실', unit: '건', better: 'up', dims: CONSULT_DIMS, series: intakeSeries },
  { id: 'new-enrollments', label: '신규 등록', group: '운영실', unit: '명', better: 'up', dims: CONSULT_DIMS, series: newEnrollmentSeries },
  { id: 'joins', label: '등록(수업 시작)', group: '운영실', unit: '명', better: 'up', dims: [SUBJECT_DIM], series: joinsSeries },
  { id: 'withdrawn', label: '퇴원', group: '운영실', unit: '명', better: 'down', dims: [SUBJECT_DIM], series: withdrawnSeries },
  { id: 'early-exits', label: '등록 후 3개월 내 퇴원', group: '운영실', unit: '명', better: 'down', dims: [{ id: 'tenure', label: '기간별' }], series: earlyExitsSeries },
].map((m) => Object.freeze(m)));
