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

export const screen = {
  id: 'trend', label: '확장 추세', order: 90,
  params: { metric: /^[a-z][a-z0-9-]{0,40}$/, grain: /^(day|week|month|year)$/, by: /^[a-z]{1,20}$/, f: /^[a-z]{1,20}:[A-Za-z0-9:._|-]{1,100}$/ },
  async load({ sql, params, tenantId, importV2 }) {
    const metric = TREND_METRICS.find((m) => m.id === params.metric) ?? TREND_METRICS[0];
    const grain = GRAINS.some((g) => g.id === params.grain) ? params.grain : 'week';
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
    const total = raw.total.map(pt), start = Math.max(0, total.findIndex((p, i) => has(p) && p.num > 0 && (!raw.since || windows[i].to >= raw.since)));
    const subjects = by === 'subject' || filter?.dim === 'subject' ? new Map(((await sql`select data->'operations'->'subjects' s from public.tenant_settings where tenant_id=${tenantId}`)[0]?.s ?? []).map((s) => [s.key, s.label])) : new Map();
    const label = (dim, key, fallback) => (dim === 'subject' ? subjects.get(key) ?? fallback ?? key : fallback);
    return {
      asOf, grain, by,
      metric: { id: metric.id, label: metric.label, unit: metric.unit, better: metric.better, dims },
      metrics: TREND_METRICS.map((m) => ({ id: m.id, label: m.label, group: m.group })),
      grains: GRAINS,
      filter: filter ? { ...filter, label: label(filter.dim, filter.key, await nameOf(sql, tenantId, filter.dim, filter.key)) } : null,
      windows: windows.slice(start),
      total: total.slice(start),
      rows: raw.rows.map((r) => ({ key: r.key, label: label(by, r.key, r.label), points: r.points.map(pt).slice(start) })).filter((r) => r.points.some(has)),
    };
  },
};
