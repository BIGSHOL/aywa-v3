// 확장 추세 — 서버(원장 10-28 "추세를 눌렀을때 확장 추세로 이동 … 일별 월별 연별 추세를 자세하게 … 학생별, 선생님별, 반별, 과목별"
// · "완전한 확장 추세 툴을 하나 만들고 … 기준만 바꿔서 필터링"). 지표·기간 단위·기준·필터를 받아 창마다 합계와 기준별 줄을 낸다. 읽기 전용.
// 지표는 trend-metrics.mjs 한 곳에서 온다. 기록이 시작되기 전의 창은 앞에서 잘라 내고, 중간에 기록이 없는 창은 '기록 없음'(0이 아니다).
// 명단 계약(원장 10-28 "자세히보기를 눌러 들어왔을때 이걸 체크할 수 있는 리스트가 있으면 더 좋을듯. 아래쪽에"):
//   metric.series는 filter가 있을 때 선택적으로 records를 함께 돌려줄 수 있다 — windows와 같은 길이, 칸마다 null(기록 없음 창) 또는
//   [{ id(학생 id 또는 그 기록 id), name, sub?(학교·학년 — 경명여중1), date?(YYYY-MM-DD), dateLabel?(그 날짜의 이름 — 퇴원일), note?(한 줄 내용 — '등록 4/2 · 29일 만에') }].
//   load는 필터를 건 보기에서만 records를 windows·total과 같은 자리(start)로 잘라 넘긴다. 없는 지표는 명단을 그리지 않는다(안내 문구 없음). 기억 키는 그대로(필터가 이미 키에 있다).
import { addDays, weekWindows, yymm, rate } from './domain-snapshot-core.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { TREND_METRICS } from './trend-metrics.mjs';

const GRAINS = Object.freeze([{ id: 'day', label: '일별' }, { id: 'week', label: '주별' }, { id: 'month', label: '월별' }, { id: 'year', label: '연별' }]);
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const monthOf = (m, k) => { const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); };
const cap = (d, asOf) => (d < asOf ? d : asOf);

/** 창 = 오래된 → 최근. 일 31개 · 주 13개(카드와 같은 '최근 7일' 창) · 월 12개(이번 달은 오늘까지) · 연 3개(올해는 오늘까지). */
export function windowsFor(grain, asOf) {
  if (grain === 'day') return Array.from({ length: 31 }, (_, i) => { const d = addDays(asOf, i - 30); return { from: d, to: d, label: md(d) }; });
  if (grain === 'week') return weekWindows(asOf, 13);
  if (grain === 'month') return Array.from({ length: 12 }, (_, i) => { const m = monthOf(asOf.slice(0, 7), i - 11); return { from: `${m}-01`, to: cap(addDays(`${monthOf(m, 1)}-01`, -1), asOf), label: yymm(m) }; });
  return Array.from({ length: 3 }, (_, i) => { const y = Number(asOf.slice(0, 4)) - 2 + i; return { from: `${y}-01-01`, to: cap(`${y}-12-31`, asOf), label: `${y}년` }; });
}

// 쪼개 보기(원장 10-28 "이 항목을 눌렀을때 해당 기간에 대해 자세한 지표 확인" · "가능한 곳은 9/9~9/15를 일마다 분석해서 추이 확인") —
// 큰 그래프의 한 창을 한 단계 잘게: 주 → 일 · 월 → 일(지표가 일을 못 받으면 7일 묶음) · 연 → 월. 일은 더 쪼개지 않는다.
// 지표가 그 단위를 받지 않으면(청구액·수납률 = 월·연) 그 점은 누를 수 없다(drillOf = null).
const DRILL = Object.freeze({ week: ['day'], month: ['day', 'week'], year: ['month'] });
export const drillOf = (grain, allowed) => DRILL[grain]?.find((g) => allowed.includes(g)) ?? null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (d) => DAY.test(d ?? '') && addDays(d, 0) === d; // 2026-02-30 같은 없는 날은 받지 않는다
const daysIn = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
const lastDayOf = (m) => addDays(`${monthOf(m, 1)}-01`, -1);

/**
 * 범위(from~to) 안의 창 = 오래된 → 최근 — 일(31개까지) · 7일 묶음(from부터, 31일까지) · 월(그달 1일부터, 12개까지).
 * 끝은 `end`(그 지표의 마지막 날 — 오늘, 출결처럼 어제까지인 지표는 어제)로 자르고, 가장 넓은 보기(연별 3년)보다 앞선 날은 받지 않는다.
 * 맞지 않는 범위 = null(쪼개지 않은 보기로 돌아간다).
 */
export function rangeWindows(grain, from, to, end) {
  if (!isDay(from) || !isDay(to) || !isDay(end) || from > to) return null;
  const hi = cap(to, end);
  if (from > hi || from < `${Number(end.slice(0, 4)) - 2}-01-01`) return null;
  const n = daysIn(from, hi);
  if (grain === 'day') return n > 31 ? null : Array.from({ length: n }, (_, i) => { const d = addDays(from, i); return { from: d, to: d, label: md(d) }; });
  if (grain === 'week') {
    if (n > 31) return null;
    const out = Array.from({ length: Math.ceil(n / 7) }, (_, i) => { const a = addDays(from, 7 * i); return { from: a, to: cap(addDays(a, 6), hi) }; });
    // 끝에 남는 3일 이하는 앞 묶음에 붙인다 — 이틀짜리 창은 며칠이 지나야 세는 지표(열람률 = 보낸 지 48시간)에서 늘 비어 보였다(9/29~9/30 '—').
    if (out.length > 1 && daysIn(out.at(-1).from, out.at(-1).to) < 4) out.at(-2).to = out.pop().to;
    return out.map((w) => ({ ...w, label: `${md(w.from)}~${md(w.to)}` }));
  }
  if (grain !== 'month' || !from.endsWith('-01')) return null;
  const months = [];
  for (let m = from.slice(0, 7); m <= hi.slice(0, 7); m = monthOf(m, 1)) months.push({ from: `${m}-01`, to: cap(lastDayOf(m), hi), label: yymm(m) });
  return months.length > 12 ? null : months;
}

/** 쪼개 본 범위의 이름(칩) — 나눈 창의 단위(up)로 적는다: 주 = 9/9~9/15 · 월 = 26.09(연월은 늘 yy.mm) · 연 = 2025년. */
function rangeLabel(up, from, to) {
  if (up === 'year') return from.slice(0, 4) === to.slice(0, 4) ? `${from.slice(0, 4)}년` : `${from.slice(0, 4)}~${to.slice(0, 4)}년`;
  if (up === 'month' && from.slice(0, 7) === to.slice(0, 7)) return yymm(from);
  return `${md(from)}~${md(to)}`;
}
/** 나눈 창의 단위 — 주소에 실려 온 것이 이 단위로 쪼갤 수 있는 것이면 그대로, 아니면 범위 모양으로 짐작한다(× = 그 단위의 보기로). */
const upOf = (grain, asked, from, to) => (DRILL[asked]?.includes(grain) ? asked : grain === 'month' ? 'year' : grain === 'day' && daysIn(from, to) <= 7 ? 'week' : 'month');

// 같은 복사본·같은 조건이면 같은 답 — 서버가 켜져 있는 동안 기억한다(복사본을 바꾸면 서버를 다시 켠다 · copyClock과 같은 규칙).
const memo = new Map();
const remember = (key, make) => {
  if (!memo.has(key)) { if (memo.size > 200) memo.delete(memo.keys().next().value); memo.set(key, make().catch((e) => { memo.delete(key); throw e; })); }
  return memo.get(key);
};

/** 선생님·반 열쇠의 DB 이름 — 없으면 null(자리 출결 'seat:JJ'처럼 사람·반이 아닌 줄은 줄 이름에서 찾는다). */
async function nameOf(sql, tenantId, dim, key) {
  if (dim === 'teacher') return key === 'unassigned' ? '담당 미지정' : (await sql`select display_name from public.users where tenant_id=${tenantId} and id::text=${key}`)[0]?.display_name ?? null;
  if (dim === 'class') return (await sql`select class_name from public.classes where tenant_id=${tenantId} and id::text=${key}`)[0]?.class_name ?? null;
  return null;
}

// 기준별 줄의 정보 칸(원장 10-28 "각 선생님의 과목, 담당 반 수, 담당 학생 수 표시") — 지금 운영 중인 반과 오늘 재원 수강 기준.
// 선생님 = 담당 반의 과목 · 반 수 · 학생 수(겹치는 학생은 한 번) / 반 = 과목 · 담임 · 학생 수 / 과목 = 반 수 · 학생 수. 과목 열쇠는 영어 중 EiE를 가른다.
const META_DIMS = new Set(['teacher', 'class', 'subject']);
async function rowMeta(sql, tenantId, asOf, by, subjectName) {
  if (!META_DIMS.has(by)) return null;
  const classes = await sql`select c.id::text id, c.subject, c.english_track, c.teacher_id::text teacher_id, u.display_name teacher
    from public.classes c left join public.users u on u.id = c.teacher_id and u.tenant_id = c.tenant_id
    where c.tenant_id = ${tenantId} and c.is_active = true and (c.closed_at is null or c.closed_at > ${asOf})`;
  const seats = await sql`select e.class_id::text class_id, e.student_id::text student_id from public.enrollments e
    join public.students s on s.id = e.student_id and s.tenant_id = e.tenant_id and s.is_test = false and s.status = 'enrolled'
    where e.tenant_id = ${tenantId} and e.start_date <= ${asOf} and (e.end_date is null or e.end_date >= ${asOf})`;
  const studentsOf = new Map(); for (const x of seats) { if (!studentsOf.has(x.class_id)) studentsOf.set(x.class_id, new Set()); studentsOf.get(x.class_id).add(x.student_id); }
  const keyOf = (c) => (by === 'teacher' ? c.teacher_id ?? 'unassigned' : by === 'class' ? c.id : c.subject === 'english' && c.english_track === 'eie' ? 'eie' : c.subject);
  const groups = new Map(); for (const c of classes) { const k = keyOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const meta = new Map();
  for (const [k, list] of groups) {
    const students = new Set(list.flatMap((c) => [...(studentsOf.get(c.id) ?? [])]));
    const subjects = [...new Set(list.map((c) => (c.subject === 'english' && c.english_track === 'eie' ? 'EiE' : subjectName(c.subject))))].join(', ');
    meta.set(k, by === 'class' ? { subjects, teacher: list[0].teacher ?? '담당 미지정', students: students.size } : by === 'teacher' ? { subjects, classes: list.length, students: students.size } : { classes: list.length, students: students.size });
  }
  return meta;
}

export const screen = {
  id: 'trend', label: '확장 추세', order: 90,
  params: { metric: /^[a-z][a-z0-9-]{0,40}$/, grain: /^(day|week|month|year)$/, by: /^[a-z]{1,20}$/, f: /^[a-z]{1,20}:[A-Za-z0-9:._|-]{1,100}$/,
    from: DAY, to: DAY, up: /^(week|month|year)$/ },
  async load({ sql, params, tenantId, importV2 }) {
    const metric = TREND_METRICS.find((m) => m.id === params.metric) ?? TREND_METRICS[0];
    const grains = metric.grains ? GRAINS.filter((g) => metric.grains.includes(g.id)) : GRAINS;
    const grain = grains.some((g) => g.id === params.grain) ? params.grain : grains.some((g) => g.id === 'week') ? 'week' : grains[0].id;
    const dims = metric.dims, fdim = params.f?.slice(0, params.f.indexOf(':'));
    const filter = params.f && dims.some((d) => d.id === fdim) ? { dim: fdim, key: params.f.slice(fdim.length + 1) } : null;
    // 필터를 건 기준으로 다시 나눠 봐야 줄이 하나뿐이다 — 필터와 다른 기준이 기본(선생님을 골랐으면 반별).
    const by = dims.some((d) => d.id === params.by) && params.by !== filter?.dim ? params.by : (dims.find((d) => d.id !== filter?.dim) ?? dims[0]).id;
    const asOf = (await copyClock()).day, end = metric.endsYesterday ? addDays(asOf, -1) : asOf;
    // 쪼개 보기 = 주소의 범위 — 단위가 그 지표가 받는 그대로일 때만(받지 않아 기본 단위로 바뀌었으면 범위도 버린다).
    const ranged = params.from && params.to && grain === params.grain ? rangeWindows(grain, params.from, params.to, end) : null;
    const windows = ranged ?? windowsFor(grain, end);
    const range = ranged ? (({ from, to }) => { const up = upOf(grain, params.up, from, to); return { from, to, up, label: rangeLabel(up, from, to) }; })({ from: ranged[0].from, to: ranged.at(-1).to }) : null;
    const span = range ? `${grain}@${range.from}~${range.to}` : grain; // 기억 키 — 같은 단위라도 범위가 다르면 다른 답
    const raw = await remember(`${tenantId}|${asOf}|${metric.id}|${span}|${by}|${params.f ?? ''}`, () => metric.series({ sql, asOf, tenantId, importV2, windows, by, filter }));
    const pt = (p) => (p ? { num: p[0], den: p[1], value: metric.unit === '%' ? rate(p[0], p[1]) : p[0] } : null);
    const has = (p) => !!p && (metric.unit === '%' ? p.den > 0 : p.num != null);
    // 앞쪽의 '분자 0' 창 = 이 기록을 쓰기 시작하기 전(대상만 있고 기록이 없다) — 0%로 그리지 않고 잘라 낸다.
    // raw.since = 그 지표를 믿을 수 있는 첫날(지표가 알려 줄 때) — 그보다 앞서 끝난 창도 잘라 낸다.
    // 쪼개 본 범위는 since로만 자른다 — 기록이 있는 기간 안의 0건인 날은 진짜 0이다(9/9~9/15의 첫날이 0건이라고 9/10부터 그리면 칩과 어긋난다).
    const total = raw.total.map(pt), start = Math.max(0, raw.since ? windows.findIndex((w) => w.to >= raw.since) : range ? 0 : total.findIndex((p) => has(p) && p.num > 0));
    const subjects = by === 'subject' || filter?.dim === 'subject' || META_DIMS.has(by) ? new Map(((await sql`select data->'operations'->'subjects' s from public.tenant_settings where tenant_id=${tenantId}`)[0]?.s ?? []).map((s) => [s.key, s.label])) : new Map();
    const label = (dim, key, fallback) => (dim === 'subject' ? subjects.get(key) ?? fallback ?? key : fallback);
    // 필터 이름 = 학원 설정(과목) · DB(선생님·반)에 있으면 그 이름, 없으면 필터 없이 그 기준으로 나눈 줄의 이름
    // (과목 설정에 없는 열쇠 — 청구·레벨테스트의 '과목 모름'(unknown) · EiE — 가 열쇠 그대로 'unknown'으로 보였다).
    const filterName = async () => {
      const named = filter.dim === 'subject' ? subjects.get(filter.key) : await nameOf(sql, tenantId, filter.dim, filter.key);
      if (named) return named;
      const whole = await remember(`${tenantId}|${asOf}|${metric.id}|${span}|${filter.dim}|`, () => metric.series({ sql, asOf, tenantId, importV2, windows, by: filter.dim, filter: null }));
      return whole.rows.find((r) => r.key === filter.key)?.label ?? (filter.dim === 'class' ? '반 확인 필요' : '이름 확인 필요');
    };
    const meta = await remember(`meta|${tenantId}|${asOf}|${by}`, () => rowMeta(sql, tenantId, asOf, by, (k) => subjects.get(k) ?? k)).catch(() => null);
    return {
      asOf, grain, by,
      // range = 지금 쪼개 보는 범위(없으면 null) · drill = 점을 누르면 쪼갤 단위(쪼개 보는 중이거나 더 잘게 못 나누면 null — 그 점은 누를 수 없다).
      range, drill: range ? null : drillOf(grain, grains.map((g) => g.id)),
      metric: { id: metric.id, label: metric.label, unit: metric.unit, better: metric.better, dims },
      metrics: TREND_METRICS.map((m) => ({ id: m.id, label: m.label, group: m.group })),
      grains,
      filter: filter ? { ...filter, label: label(filter.dim, filter.key, await filterName()) } : null,
      windows: windows.slice(start),
      total: total.slice(start),
      // 지금 보이는 창 모두에서 0이거나 기록 없는 줄은 뺀다(원장 10-28 "구간 전체에 대해서 0이면 그냥 보여주지말것. 구간 내에 최소 1이라도 있어야 그래프든 리스트든") —
      // 비율은 분자가 아니라 값(0%)으로 보고, 분모 0은 기록 없음. 쪼개 보면 그 창들로 다시 본다. 전체(total)는 늘 남는다.
      rows: raw.rows.map((r) => ({ key: r.key, label: label(by, r.key, r.label), points: r.points.map(pt).slice(start), ...(meta?.has(r.key) ? { meta: meta.get(r.key) } : {}) })).filter((r) => r.points.some((p) => has(p) && p.value !== 0)),
      ...(filter && Array.isArray(raw.records) && raw.records.length === windows.length ? { records: raw.records.slice(start) } : {}),
    };
  },
};
