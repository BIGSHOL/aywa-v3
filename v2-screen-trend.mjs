// 확장 추세 — 서버(원장 10-28 "추세를 눌렀을때 확장 추세로 이동 … 일별 월별 연별 추세를 자세하게 … 학생별, 선생님별, 반별, 과목별"
// · "완전한 확장 추세 툴을 하나 만들고 … 기준만 바꿔서 필터링"). 지표·기간 단위·기준·필터를 받아 창마다 합계와 기준별 줄을 낸다. 읽기 전용.
// 지표는 trend-metrics.mjs 한 곳에서 온다. 기록이 시작되기 전의 창은 앞에서 잘라 내고, 중간에 기록이 없는 창은 '기록 없음'(0이 아니다).
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

// 같은 복사본·같은 조건이면 같은 답 — 서버가 켜져 있는 동안 기억한다(복사본을 바꾸면 서버를 다시 켠다 · copyClock과 같은 규칙).
const memo = new Map();
const remember = (key, make) => {
  if (!memo.has(key)) { if (memo.size > 200) memo.delete(memo.keys().next().value); memo.set(key, make().catch((e) => { memo.delete(key); throw e; })); }
  return memo.get(key);
};

async function nameOf(sql, tenantId, dim, key) {
  if (dim === 'teacher') return key === 'unassigned' ? '담당 미지정' : (await sql`select display_name from public.users where tenant_id=${tenantId} and id::text=${key}`)[0]?.display_name ?? '이름 확인 필요';
  if (dim === 'class') return (await sql`select class_name from public.classes where tenant_id=${tenantId} and id::text=${key}`)[0]?.class_name ?? '반 확인 필요';
  return key;
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
  params: { metric: /^[a-z][a-z0-9-]{0,40}$/, grain: /^(day|week|month|year)$/, by: /^[a-z]{1,20}$/, f: /^[a-z]{1,20}:[A-Za-z0-9:._|-]{1,100}$/ },
  async load({ sql, params, tenantId, importV2 }) {
    const metric = TREND_METRICS.find((m) => m.id === params.metric) ?? TREND_METRICS[0];
    const grains = metric.grains ? GRAINS.filter((g) => metric.grains.includes(g.id)) : GRAINS;
    const grain = grains.some((g) => g.id === params.grain) ? params.grain : grains.some((g) => g.id === 'week') ? 'week' : grains[0].id;
    const dims = metric.dims, fdim = params.f?.slice(0, params.f.indexOf(':'));
    const filter = params.f && dims.some((d) => d.id === fdim) ? { dim: fdim, key: params.f.slice(fdim.length + 1) } : null;
    // 필터를 건 기준으로 다시 나눠 봐야 줄이 하나뿐이다 — 필터와 다른 기준이 기본(선생님을 골랐으면 반별).
    const by = dims.some((d) => d.id === params.by) && params.by !== filter?.dim ? params.by : (dims.find((d) => d.id !== filter?.dim) ?? dims[0]).id;
    const asOf = (await copyClock()).day, windows = windowsFor(grain, metric.endsYesterday ? addDays(asOf, -1) : asOf);
    const raw = await remember(`${tenantId}|${asOf}|${metric.id}|${grain}|${by}|${params.f ?? ''}`, () => metric.series({ sql, asOf, tenantId, importV2, windows, by, filter }));
    const pt = (p) => (p ? { num: p[0], den: p[1], value: metric.unit === '%' ? rate(p[0], p[1]) : p[0] } : null);
    const has = (p) => !!p && (metric.unit === '%' ? p.den > 0 : p.num != null);
    // 앞쪽의 '분자 0' 창 = 이 기록을 쓰기 시작하기 전(대상만 있고 기록이 없다) — 0%로 그리지 않고 잘라 낸다.
    // raw.since = 그 지표를 믿을 수 있는 첫날(지표가 알려 줄 때) — 그보다 앞서 끝난 창도 잘라 낸다.
    const total = raw.total.map(pt), start = Math.max(0, raw.since ? windows.findIndex((w) => w.to >= raw.since) : total.findIndex((p) => has(p) && p.num > 0));
    const subjects = by === 'subject' || filter?.dim === 'subject' || META_DIMS.has(by) ? new Map(((await sql`select data->'operations'->'subjects' s from public.tenant_settings where tenant_id=${tenantId}`)[0]?.s ?? []).map((s) => [s.key, s.label])) : new Map();
    const label = (dim, key, fallback) => (dim === 'subject' ? subjects.get(key) ?? fallback ?? key : fallback);
    const filterName = async () => {
      const named = await nameOf(sql, tenantId, filter.dim, filter.key);
      if (named !== filter.key || filter.dim === 'subject') return named;
      const whole = await remember(`${tenantId}|${asOf}|${metric.id}|${grain}|${filter.dim}|`, () => metric.series({ sql, asOf, tenantId, importV2, windows, by: filter.dim, filter: null }));
      return whole.rows.find((r) => r.key === filter.key)?.label ?? '이름 확인 필요';
    };
    const meta = await remember(`meta|${tenantId}|${asOf}|${by}`, () => rowMeta(sql, tenantId, asOf, by, (k) => subjects.get(k) ?? k)).catch(() => null);
    return {
      asOf, grain, by,
      metric: { id: metric.id, label: metric.label, unit: metric.unit, better: metric.better, dims },
      metrics: TREND_METRICS.map((m) => ({ id: m.id, label: m.label, group: m.group })),
      grains,
      filter: filter ? { ...filter, label: label(filter.dim, filter.key, await filterName()) } : null,
      windows: windows.slice(start),
      total: total.slice(start),
      rows: raw.rows.map((r) => ({ key: r.key, label: label(by, r.key, r.label), points: r.points.map(pt).slice(start), ...(meta?.has(r.key) ? { meta: meta.get(r.key) } : {}) })).filter((r) => r.points.some(has)),
    };
  },
};
