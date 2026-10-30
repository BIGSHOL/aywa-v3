import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-trend.mjs';
import { dashboardKpiCards } from './v2-dashboard-flow.mjs';
import { teacherWorkWeekly } from './v2-teacher-work.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { CARD_FLOW_LINKS } from './card-analysis.mjs';
import { loadCardAnalysis, flowCasesFromLocal } from './card-analysis-load.mjs';
import { flowCaseFlags } from './flow-case-flags.mjs';
import { exitCleanupPolicy } from './v2-student-kpis.mjs';

const db = await openFullDatabase();
try {
  const flow = await flowCasesFromLocal();
  assert(Array.isArray(flow), '업무 흐름 GET을 읽을 수 있어야 합니다.');
  await db.begin('isolation level repeatable read read only', async sql => {
    const asOf = (await copyClock()).day;
    const dashboard = await dashboardKpiCards({ sql, asOf, tenantId, importV2 });
    const teacher = (await teacherWorkWeekly({ sql, asOf, tenantId, importV2 })).kpis;
    const cards = [...dashboard, ...teacher];
    assert.equal(cards.length, 14);
    const loadTrend = params => screen.load({ sql, params, tenantId, importV2 });
    let checked = 0;
    for (const card of cards) {
      const run = () => loadCardAnalysis({ sql, tenantId, importV2, metricId: card.id, loadTrend, flowCases: async () => flow });
      const a = await run(), b = await run();
      assert(a, `${card.id}: 카드 분석`);
      assert.deepEqual(a.facts, b.facts, `${card.id}: 같은 요청의 사실 순서·숫자`);
      assert.deepEqual(a.facts.map(f => f.id), a.facts.map((_, i) => `F${i + 1}`));
      const trend = await loadTrend({ metric: card.id, grain: card.period });
      if (card.detail) {
        assert.equal(trend.metric.detail, card.detail, `${card.id}: 카드·추세 설명 일치`);
        assert.equal(a.facts.find(f => f.kind === 'basis')?.values.basis, card.detail, `${card.id}: 분석 설명 일치`);
      }
      const one = a.facts.find(f => f.item === 1);
      assert.equal(one.values.current, trend.total.at(-1)?.value ?? null, `${card.id}: 추세 마지막 점`);
      if (card.id === 'exits') {
        const policy = exitCleanupPolicy(one.values.current, card.cleanupCount);
        assert.equal(card.value, policy.cardValue, '퇴원·수업종료 카드 수치');
        assert.equal(card.cleanupNote, policy.note, '카드의 장부 정리 안내');
        assert.equal(trend.cleanupNotes?.at(-1), policy.note, '추세의 장부 정리 안내');
        const difference = a.facts.find(f => f.kind === 'difference');
        assert.equal(difference.values.note, policy.note, '분석의 장부 정리 안내');
        assert.match(difference.text, new RegExp(`카드 수치 .* · 추세선 .*${policy.note ? ' · 장부 정리 ' : ''}`));
      } else assert.equal(one.values.current, card.value, `${card.id}: 카드 수치`);
      for (const f of a.facts.filter(f => f.item === 2 && f.values.dimension && f.values.key)) {
        const d = await loadTrend({ metric: card.id, grain: card.period, by: f.values.dimension });
        const row = d.rows.find(r => r.key === f.values.key);
        assert(row, `${card.id}: ${f.text}의 기준 줄`);
        assert.equal(f.values.current, row.points.at(-1)?.value ?? null);
        assert.equal(f.values.previous, row.points.at(-2)?.value ?? null);
      }
      const roster = a.facts.find(f => f.kind === 'roster-count');
      if (roster) {
        assert.equal(roster.values.count, a.records.length, `${card.id}: 추세 명단 건수`);
        assert.equal(a.facts.filter(f => f.item === 3 && f.kind === 'record').length, 0, `${card.id}: 사실에 명단 이름을 싣지 않음`);
        for (const field of ['className', 'teacher', 'school', 'grade']) assert(a.facts.some(f => f.item === 3 && f.values.field === field), `${card.id}: ${field} 집중 판정`);
      }
      const actualFlow = a.facts.find(f => f.item === 4), link = CARD_FLOW_LINKS[card.id];
      const selected = link ? flow.filter(c => c.state !== 'done' && (link.tasks.includes(c.taskKind) || link.signals.includes(c.signalId))) : [];
      assert.equal(actualFlow.values.count, selected.length, `${card.id}: 업무 흐름 같은 조건`);
      if (actualFlow.kind === 'flow') {
        const flags = selected.map(c => flowCaseFlags(c, asOf));
        assert.equal(actualFlow.values.open, selected.filter(c => c.state === 'open').length);
        assert.equal(actualFlow.values.working, selected.filter(c => c.state === 'working').length);
        assert.equal(actualFlow.values.review, selected.filter(c => c.state === 'review').length);
        assert.equal(actualFlow.values.overdue, flags.filter(f => f.late).length);
        assert.equal(actualFlow.values.unassigned, flags.filter(f => f.unassigned).length);
        assert.match(actualFlow.text, /^현재 처리할 학원 전체 업무 · 이어진 업무 .*\(처리 전 .* · 진행 중 .* · 검토 대기 .*\) · 그중 지난 업무 .* · 담당 미지정 .*$/);
      }
      assert.equal(a.metric, card.id);
      assert.equal(a.period, card.period);
      assert(CARD_FLOW_LINKS[card.id] || actualFlow.kind === 'flow-empty');
      checked++;
      console.log(`${checked}/14 ${card.label} · 카드·추세·분석 일치`);
    }
    const keys = new Set();
    for (const grain of ['day', 'week', 'month', 'year']) for (const by of ['mix', 'subject']) {
      const a = await loadCardAnalysis({ sql, tenantId, importV2, metricId: 'enrolled-students', selection: { grain, by }, loadTrend, flowCases: async () => flow });
      const trend = await loadTrend({ metric: 'enrolled-students', grain, by });
      assert.equal(a.period, grain); assert.equal(a.by.id, by);
      assert.equal(a.facts.find(f => f.item === 1).values.current, trend.total.at(-1)?.value ?? null);
      assert(a.facts.filter(f => f.item === 2 && f.values.dimension).every(f => f.values.dimension === by));
      keys.add(a.selectionKey);
    }
    assert.equal(keys.size, 8, '기간 4 × 구분 2 AI 저장 열쇠');
  });
  const port = Number(process.env.OWNER_CONCEPT_PORT || 4310);
  const asOf = String((await (await fetch(`http://127.0.0.1:${port}/api/flow`)).json()).asOf).slice(0, 10);
  const open = flow.filter(c => c.state !== 'done');
  const screenLate = open.filter(c => c.caseFlags?.late).length, screenUnassigned = open.filter(c => c.caseFlags?.unassigned).length;
  if (open.every(c => c.caseFlags)) {
    assert.equal(open.filter(c => flowCaseFlags(c, asOf).late).length, screenLate, '업무 흐름 화면의 지난 업무 칸 수');
    assert.equal(open.filter(c => flowCaseFlags(c, asOf).unassigned).length, screenUnassigned, '업무 흐름 화면의 담당 미지정 칸 수');
    console.log(`업무 흐름 화면 칸 수 일치 · 지난 업무 ${screenLate}건 · 담당 미지정 ${screenUnassigned}건`);
  } else console.log('업무 흐름 화면 칸 수 대조는 서버 재시작 뒤 확인');
  console.log('카드 분석 14/14 · 반복·기준별·명단·업무 흐름 확인');
} finally { await db.end(); }
