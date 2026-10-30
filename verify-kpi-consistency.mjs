// 첫 화면·작업 공간 KPI 14개 = 연결된 확장 추세의 같은 기간 이름·값(읽기 전용, 브라우저·빌드 없음).
import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { addDays, rate } from './domain-snapshot-core.mjs';
import { dashboardKpiCards, DASHBOARD_KPI_ORDER } from './v2-dashboard-flow.mjs';
import { teacherWorkWeekly, TEACHER_WORK_METRICS } from './v2-teacher-work.mjs';
import { TREND_METRICS } from './trend-metrics.mjs';
import { windowsFor } from './v2-screen-trend.mjs';
import { exitCleanupPolicy } from './v2-student-kpis.mjs';

// 장부 정리 1건을 가정한 단위 시험: 2.0 카드 수는 포함, 추세선은 제외, 두 화면의 안내는 같은 한 문장.
assert.deepEqual(exitCleanupPolicy(13, 1), {
  trendValue: 13, cardValue: 14, note: '장부 정리 1명 포함 · 추세선은 제외',
});
assert.equal(exitCleanupPolicy(13, 1).note, exitCleanupPolicy(null, 1).note, '카드와 추세의 안내 문장은 같다');
assert.deepEqual(exitCleanupPolicy(13, 0), { trendValue: 13, cardValue: 13, note: null });

const db = await openFullDatabase();
try {
  const asOf = (await copyClock()).day;
  await db.begin('isolation level repeatable read read only', async sql => {
    const dashboard = await dashboardKpiCards({ sql, asOf, tenantId, importV2 });
    const teacher = (await teacherWorkWeekly({ sql, asOf, tenantId, importV2 })).kpis;
    assert.deepEqual(dashboard.map(c => c.id), [...DASHBOARD_KPI_ORDER]);
    assert.deepEqual(teacher.map(c => c.id), TEACHER_WORK_METRICS.map(m => m.id));
    const cards = [...dashboard, ...teacher]; assert.equal(cards.length, 14);
    const mismatches = [];
    for (const card of cards) {
      const metric = TREND_METRICS.find(m => m.id === card.id);
      assert(metric, `${card.id}: 연결 지표`);
      if (card.label !== metric.label) mismatches.push(`${card.id}: 이름 ${card.label} ≠ ${metric.label}`);
      const grain = card.period === 'month' ? 'month' : 'week';
      const end = metric.endsYesterday ? addDays(asOf, -1) : asOf;
      const windows = windowsFor(grain, end);
      const trend = await metric.series({ sql, asOf, tenantId, importV2, windows, by: metric.dims[0].id, filter: null });
      const points = windows.map((w, i) => ({ label: w.label, value: trend.total[i] == null ? null : metric.unit === '%' ? rate(...trend.total[i]) : trend.total[i][0] }));
      const tail = points.slice(-card.points.length);
      for (let i = 0; i < card.points.length; i++) if (card.points[i].label !== tail[i].label || card.points[i].value !== tail[i].value)
        mismatches.push(`${card.id}: ${card.points[i].label} ${card.points[i].value} ≠ ${tail[i].label} ${tail[i].value}`);
      if (card.id === 'exits') {
        const policy = exitCleanupPolicy(points.at(-1).value, card.cleanupCount);
        if (card.value !== policy.cardValue) mismatches.push(`${card.id}: 2.0 카드 ${card.value} ≠ 추세 ${policy.trendValue} + 장부 정리 ${card.cleanupCount}`);
        if (card.cleanupNote !== policy.note || trend.cleanupNotes?.at(-1) !== policy.note)
          mismatches.push(`${card.id}: 카드·확장 추세 장부 정리 안내 불일치`);
      } else if (card.value !== points.at(-1).value) mismatches.push(`${card.id}: 큰 숫자 ${card.value} ≠ 마지막 추세 ${points.at(-1).value}`);
    }
    if (mismatches.length) throw new Error(`${mismatches.length}개 불일치\n${mismatches.join('\n')}`);
    console.log('KPI 14개: 카드 이름·모든 점·큰 숫자 일치(퇴원 장부 정리 예외 안내 포함)');
  });
} finally { await db.end(); }
