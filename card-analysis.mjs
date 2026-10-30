// 확장 추세 응답만으로 카드 숫자를 설명한다. 업무 대응은 이 한 표에서만 정한다.
import { flowCaseFlags } from './flow-case-flags.mjs';
import { exitCleanupPolicy } from './v2-student-kpis.mjs';
export const CARD_FLOW_LINKS = Object.freeze({
  exits: { tasks: ['withdrawal_step'], signals: ['withdrawal-report-pending'] },
  withdrawn: { tasks: ['withdrawal_step'], signals: ['withdrawal-report-pending'] },
  'early-exits': { tasks: ['withdrawal_step'], signals: ['withdrawal-report-pending'] },
  'recent-absent': { tasks: ['attendance_absent_desk'], signals: ['attendance-repeat-absence'] },
  makeups: { tasks: [], signals: ['makeup-overdue'] },
  intake: { tasks: ['enrollment_followup'], signals: ['enrollment-followup'] },
  'report-written': { tasks: ['unsent_report'], signals: [] },
  'parent-read': { tasks: [], signals: [] },
  'video-issued': { tasks: ['video_upload_check'], signals: [] },
  'video-submitted': { tasks: ['video_upload_check', 'video_unassigned'], signals: ['video-upload-failed'] },
});

const fmt = n => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const shown = (n, unit) => n == null ? '기록 없음' : `${fmt(n)}${unit}`;
const fact = (item, kind, text, values = {}, refs = []) => ({ item, kind, text, values, refs });
const value = p => p?.value ?? null;
const last = a => a?.at(-1) ?? null;
const REF_DIM = { student: 'student', class: 'class', teacher: 'teacher' };
const OVERLAP = new Set(['subject', 'tenure']);

export function flowFacts(metric, cases, asOf) {
  const link = CARD_FLOW_LINKS[metric];
  if (!link || !(link.tasks.length || link.signals.length)) return [fact(4, 'flow-empty', '이어진 업무 없음', { count: 0 })];
  if (!Array.isArray(cases)) return [fact(4, 'flow-unavailable', '업무 흐름을 확인하지 못했습니다.', {})];
  const selected = cases.filter(c => c && c.state !== 'done' && (link.tasks.includes(c.taskKind) || link.signals.includes(c.signalId)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const count = { open: 0, working: 0, review: 0, overdue: 0, unassigned: 0 };
  for (const c of selected) {
    if (c.state in count) count[c.state]++;
    const flags = flowCaseFlags(c, asOf);
    if (flags.late) count.overdue++;
    if (flags.unassigned) count.unassigned++;
  }
  return [fact(4, 'flow', `이어진 업무 ${fmt(selected.length)}건(처리 전 ${fmt(count.open)}건 · 진행 중 ${fmt(count.working)}건 · 검토 대기 ${fmt(count.review)}건) · 그중 지난 업무 ${fmt(count.overdue)}건 · 담당 미지정 ${fmt(count.unassigned)}건`,
    { count: selected.length, ...count }, selected.map(c => ({ type: 'flow', id: c.id })))];
}

export function buildCardAnalysis({ trend, byDimension = {}, card, flowCases = null, records = null }) {
  const metric = trend.metric.id, unit = trend.metric.unit, points = trend.total, now = last(points), prev = points.at(-2) ?? null;
  const facts = [], current = value(now), previous = value(prev), roster = [];
  const prior = points.slice(0, -2).filter(p => value(p) != null).slice(-8).map(value).sort((a, b) => a - b);
  const middle = prior.length ? (prior[Math.floor((prior.length - 1) / 2)] + prior[Math.floor(prior.length / 2)]) / 2 : null;
  const min = prior[0] ?? null, max = last(prior);
  const band = current == null || min == null ? '비교할 기록 없음' : current > max ? '평소보다 높음' : current < min ? '평소보다 낮음' : '평소 범위';
  const den = unit === '%' && now ? now.den : null;
  facts.push(fact(1, 'current', `${last(trend.windows)?.label || '현재'} ${shown(current, unit)} · 직전 ${shown(previous, unit)} · 평소 ${min == null ? '기록 없음' : `${shown(min, unit)}~${shown(max, unit)} (가운데값 ${shown(middle, unit)})`} · ${band}${den == null ? '' : ` · 대상 ${fmt(den)}건`}`,
    { current, previous, min, max, median: middle, changeFromPrevious: current != null && previous != null ? current - previous : null,
      changeFromMedian: current != null && middle != null ? current - middle : null,
      changeFromFloor: current != null && min != null ? current - min : null,
      denominator: den, historyCount: prior.length, cardValue: card?.value ?? null, band }));

  for (const dim of trend.metric.dims) {
    if (dim.needsFilter) continue;
    const d = byDimension[dim.id];
    if (!d) continue;
    const changed = d.rows.map(r => ({ ...r, current: value(last(r.points)), previous: value(r.points.at(-2)) }))
      .filter(r => r.current != null && r.previous != null).map(r => ({ ...r, delta: r.current - r.previous }))
      .filter(r => r.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label, 'ko') || a.key.localeCompare(b.key));
    const displayed = changed.slice(0, 5).map(r => ({ ...r, kind: r.delta > 0 ? 'increase' : 'decrease' }));
    if (changed.length > 5) {
      const rest = changed.slice(5);
      displayed.push({ kind: 'other-change', label: '그 밖의 변화', count: rest.length, delta: rest.reduce((sum, r) => sum + r.delta, 0) });
    }
    displayed.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label, 'ko'));
    for (const r of displayed) {
      if (r.kind === 'other-change') {
        facts.push(fact(2, r.kind, `${dim.label} 그 밖의 변화 ${fmt(r.count)}항목 합계 ${r.delta < 0 ? '−' : '+'}${shown(Math.abs(r.delta), unit === '%' ? '%p' : unit)}`,
          { dimension: dim.id, count: r.count, delta: r.delta, overlapping: OVERLAP.has(dim.id) }));
        continue;
      }
      const kind = r.kind;
      const type = REF_DIM[dim.id];
      facts.push(fact(2, kind, `${dim.label} ${r.label} · ${shown(r.previous, unit)} → ${shown(r.current, unit)} (${kind === 'increase' ? '+' : '−'}${shown(Math.abs(r.delta), unit === '%' ? '%p' : unit)})${OVERLAP.has(dim.id) ? ' · 중복 포함' : ''}`,
        { dimension: dim.id, key: r.key, label: r.label, current: r.current, previous: r.previous, delta: r.delta, overlapping: OVERLAP.has(dim.id) }, type ? [{ type, id: r.key }] : []));
    }
    if (!changed.length) facts.push(fact(2, 'dimension-empty', `${dim.label} · 비교할 변화 없음`, { dimension: dim.id, count: 0 }));
  }

  if (Array.isArray(records)) {
    const rows = [...records].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'ko') || String(a.key || a.id).localeCompare(String(b.key || b.id)));
    facts.push(fact(3, 'roster-count', `이번 기간 명단 ${fmt(rows.length)}건`, { count: rows.length }));
    const schoolGrade = r => { const m = /^(.*?)(초|중|고)(\d{1,2})$/.exec(r.sub || ''); return m ? { school: m[1], grade: `${m[2]}${m[3]}` } : { school: r.sub || '', grade: '' }; };
    for (const [field, label] of [['className', '반'], ['teacher', '담당 선생님'], ['school', '학교'], ['grade', '학년']]) {
      const counts = new Map();
      for (const r of rows) { const name = field === 'school' || field === 'grade' ? schoolGrade(r)[field] : r[field]; if (name && name !== '—') counts.set(name, (counts.get(name) || 0) + 1); }
      const clustered = [...counts].filter(([, n]) => n >= 3 && n / rows.length >= 0.4).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
      for (const [name, count] of clustered) {
        facts.push(fact(3, 'cluster', `${label} ${name} ${fmt(count)}건 · 명단의 ${fmt(count / rows.length * 100)}% 집중`, { field, name, count, share: count / rows.length }));
      }
      if (!clustered.length) facts.push(fact(3, 'cluster-empty', `${label} · 집중 없음`, { field, count: 0 }));
    }
    for (const r of rows) {
      const type = r.reportId ? 'record' : r.student === false ? 'record' : 'student', id = r.reportId || r.id || r.studentId;
      roster.push({ key: r.key ?? [r.date, r.classId, r.studentId, id].join('|'), text: `${r.name || '이름 없음'}${r.sub ? ` · ${r.sub}` : ''}${r.className ? ` · ${r.className}` : ''}${r.date ? ` · ${r.date}` : ''}${typeof r.written === 'boolean' ? ` · ${r.written ? '작성' : '미작성'}` : ''}${r.note ? ` · ${r.note}` : ''}`,
        refs: id ? [{ type, id: String(id) }] : [] });
    }
  } else facts.push(fact(3, 'roster-empty', '이 조건에는 추세 명단이 없습니다.', { count: 0 }));

  // 업무 흐름은 현재 열린 건의 상태다. 과거 기간·구분의 추세 건수와 혼동하지 않게 범위를 적는다.
  facts.push(...flowFacts(metric, flowCases, trend.asOf).map(f => ({ ...f, text: `현재 처리할 학원 전체 업무 · ${f.text}` })));
  const missing = points.filter(p => value(p) == null).length;
  facts.push(fact(5, 'basis', `집계 기준 · ${card?.detail || card?.basis || '확장 추세의 같은 기간과 같은 조건으로 집계'}`, { basis: card?.detail ?? card?.basis ?? null }));
  facts.push(fact(5, 'coverage', `기록 시작 ${trend.since || '확인할 기록 없음'} · 기록 없는 기간 ${fmt(missing)}개${trend.endsYesterday ? ' · 어제까지 집계' : ''}`,
    { since: trend.since ?? null, missingWindows: missing, endsYesterday: !!trend.endsYesterday }));
  const sameCardWindow = card?.period === trend.grain && !trend.filter && !trend.range;
  if (metric === 'exits' && sameCardWindow) {
    const policy = exitCleanupPolicy(current, card.cleanupCount ?? 0);
    facts.push(fact(5, 'difference', `카드 수치 ${shown(card.value, unit)} · 추세선 ${shown(current, unit)}${policy.note ? ` · ${policy.note}` : ''}`,
      { cardValue: card.value, trendValue: current, cleanupCount: card.cleanupCount ?? 0, note: policy.note }));
  } else if (sameCardWindow && current != null && card.value != null && card.value !== current) facts.push(fact(5, 'difference', `카드 수치 ${shown(card.value, unit)} · 추세선 ${shown(current, unit)} · 집계 기준을 확인해 주세요.`, { cardValue: card.value, trendValue: current }));
  return { metric, period: trend.grain, by: { id: trend.by, label: trend.metric.dims.find(d => d.id === trend.by)?.label || '전체' },
    filter: trend.filter ?? null, range: trend.range ?? null, asOf: trend.asOf,
    facts: facts.map((f, i) => ({ id: `F${i + 1}`, ...f })), records: roster };
}
