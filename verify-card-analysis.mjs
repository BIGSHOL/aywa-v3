import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-trend.mjs';
import { dashboardKpiCards } from './v2-dashboard-flow.mjs';
import { teacherWorkWeekly } from './v2-teacher-work.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { CARD_FLOW_LINKS, flowFacts } from './card-analysis.mjs';
import { loadCardAnalysis, flowCasesFromLocal } from './card-analysis-load.mjs';

const db = await openFullDatabase();
try {
  const flow = await flowCasesFromLocal();
  assert(Array.isArray(flow), '업무 흐름 GET을 읽을 수 있어야 합니다.');
  await db.begin('isolation level repeatable read read only', async sql => {
    const asOf = (await copyClock()).day;
    const dashboard = await dashboardKpiCards({ sql, asOf, tenantId, importV2 });
    const teacher = (await teacherWorkWeekly({ sql, asOf, tenantId, importV2 })).kpis;
    const cards = [...dashboard, ...teacher];
    assert.equal(cards.length, 15);
    const loadTrend = params => screen.load({ sql, params, tenantId, importV2 });
    let checked = 0;
    for (const card of cards) {
      const run = () => loadCardAnalysis({ sql, tenantId, importV2, metricId: card.id, loadTrend, flowCases: async () => flow });
      const a = await run(), b = await run();
      assert(a, `${card.id}: 카드 분석`);
      assert.deepEqual(a.facts, b.facts, `${card.id}: 같은 요청의 사실 순서·숫자`);
      assert.deepEqual(a.facts.map(f => f.id), a.facts.map((_, i) => `F${i + 1}`));
      const trend = await loadTrend({ metric: card.id, grain: card.period });
      const one = a.facts.find(f => f.item === 1);
      assert.equal(one.values.current, card.value, `${card.id}: 카드 큰 숫자`);
      assert.equal(one.values.current, trend.total.at(-1)?.value ?? null, `${card.id}: 추세 마지막 점`);
      for (const f of a.facts.filter(f => f.item === 2 && f.values.dimension && f.values.key)) {
        const d = await loadTrend({ metric: card.id, grain: card.period, by: f.values.dimension });
        const row = d.rows.find(r => r.key === f.values.key);
        assert(row, `${card.id}: ${f.text}의 기준 줄`);
        assert.equal(f.values.current, row.points.at(-1)?.value ?? null);
        assert.equal(f.values.previous, row.points.at(-2)?.value ?? null);
      }
      const roster = a.facts.find(f => f.kind === 'roster-count');
      if (roster) assert.equal(roster.values.count, a.facts.filter(f => f.kind === 'record').length, `${card.id}: 명단 건수`);
      const expectedFlow = flowFacts(card.id, flow)[0], actualFlow = a.facts.find(f => f.item === 4);
      assert.equal(actualFlow.values.count, expectedFlow.values.count, `${card.id}: 업무 흐름 같은 조건`);
      assert.equal(a.metric, card.id);
      assert.equal(a.period, card.period);
      assert(CARD_FLOW_LINKS[card.id] || actualFlow.kind === 'flow-empty');
      checked++;
      console.log(`${checked}/15 ${card.label} · 카드·추세·분석 일치`);
    }
  });
  console.log('카드 분석 15/15 · 반복·기준별·명단·업무 흐름 확인');
} finally { await db.end(); }
