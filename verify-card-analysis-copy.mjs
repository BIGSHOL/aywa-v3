// 카드 분석 문구는 데이터베이스 없이 작은 추세 자료로 확인한다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCardAnalysis } from './card-analysis.mjs';

const trend = {
  metric: { id: 'makeups', unit: '%', dims: [{ id: 'subject', label: '과목' }] },
  total: [{ value: 10 }, { value: null }, { value: 20 }],
  windows: [{ label: '8월' }, { label: '9월' }, { label: '10월' }],
  since: '2026-08-01', endsYesterday: true, asOf: '2026-10-29', grain: 'month',
};
const rows = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, name: `학생${i}`, className: '별빛반', date: '2026-10-28' }));
const analysis = buildCardAnalysis({ trend, byDimension: { subject: { rows: [{ key: 'math', label: '수학', points: [{ value: 5 }, { value: 10 }, { value: 20 }] }] } },
  card: { value: 25, period: 'month' }, flowCases: [], records: rows });
const fact = kind => analysis.facts.find(f => f.kind === kind)?.text;
assert.match(fact('increase'), /10% → 20% \(\+10%p\) · 중복 포함$/);
assert.equal(fact('roster-count'), '이번 기간 명단 3건');
assert.equal(fact('cluster'), '반 별빛반 3건 · 명단의 100% 집중');
assert(analysis.facts.some(f => f.kind === 'cluster-empty' && f.text.endsWith('집중 없음')));
assert.equal(fact('basis'), '집계 기준 · 확장 추세의 같은 기간과 같은 조건으로 집계');
assert.equal(fact('coverage'), '기록 시작 2026-08-01 · 기록 없는 기간 1개 · 어제까지 집계');
assert.equal(fact('difference'), '카드 수치 25% · 추세선 20% · 집계 기준을 확인해 주세요.');
const ui = await readFile(new URL('./v2-screen-trend.js', import.meta.url), 'utf8');
assert.match(ui, /'이어진 업무', '집계 기준과 빠진 기록'/);
console.log('카드 분석 화면 문구 8/8');
