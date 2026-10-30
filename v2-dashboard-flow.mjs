// 운영실 '흐름' 묶음(원장 10-28 *"재원생 흐름. 강좌수 흐름. 퇴원&수업종료 흐름. 전일신규/이달의신입 흐름. 신규문의흐름 전일 입학테스트 흐름. 오늘첫수업 흐름.
// 최근 결석 흐름 등 기존 2.0 kpi들을 전부 흐름으로"*) — 2.0 운영실 상단 KPI 칸 차례대로 kpi() 카드 9개와, 같은 id의 확장 추세 지표.
// 카드는 `dashboard` 업무 영역 metrics(kind 'kpi')로 싣고(domain-snapshot-ops2.mjs — 어디에 몇 칸 보일지는 화면이 정한다), 지표는 trend-metrics.mjs가 싣는다.
// 계산은 각 모듈(원생 · 입테 · 출결 · 수납)에 있다.
import { studentStatusKpis } from './v2-student-kpis.mjs';
import { STUDENT_TREND_METRICS } from './v2-dashboard-flow-students.mjs';
import { ADMISSIONS_TREND_METRICS, admissionsKpiCards } from './v2-dashboard-flow-admissions.mjs';
import { ATTENDANCE_TREND_METRICS, attendanceKpiCards } from './v2-dashboard-flow-attendance.mjs';
import { BILLING_TREND_METRICS } from './v2-dashboard-flow-billing.mjs';
import { isolated } from './v2-dashboard-isolate.mjs';

/** 운영실 KPI 칸 차례 — 재원생 · 강좌수 · 퇴원&수업종료 · 신규문의 · 전일 입테 · 전일/이달 신규 · 오늘첫수업 · 최근 결석 · 보강 진행률. */
export const DASHBOARD_KPI_ORDER = Object.freeze(['enrolled-students', 'courses', 'exits', 'intake', 'level-tests', 'new-enrollments', 'first-classes', 'recent-absent', 'makeups']);

/**
 * 운영실 KPI 카드 9개(kpi() 모양 · id 붙음 · 2.0 차례). `sql` = 읽기 전용 트랜잭션(저장점을 쓴다) — 같은 트랜잭션의 다른 조회와 나란히 부르지 말 것(따로 await).
 * 묶음마다 저장점 안에서 센다 — 한 묶음이 실패하면(DB 오류 포함) 그 묶음 카드만 빠지고 트랜잭션은 산다(다른 칸 · 뒤의 스냅샷 그대로 · 실패는 로그로).
 */
export async function dashboardKpiCards({ sql, asOf, tenantId, importV2 }) {
  const cards = [];
  for (const [what, load] of [
    ['원생', async (sp) => (await studentStatusKpis({ sql: sp, asOf, tenantId, importV2 })).kpis],
    ['입테', (sp) => admissionsKpiCards({ sql: sp, asOf, tenantId, importV2 })],
    ['출결', (sp) => attendanceKpiCards({ sql: sp, asOf, tenantId, importV2 })],
  ]) {
    try { cards.push(...(await isolated(sql, load))); } catch (e) { console.error(`운영실 KPI(${what}): ${e?.message ?? e}`); }
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  return DASHBOARD_KPI_ORDER.flatMap((id) => (byId.has(id) ? [byId.get(id)] : []));
}

/** 확장 추세 지표 — 카드 9칸 차례 다음에 운영실 위젯(등록·퇴원 · 3개월 내 퇴원 · 등원율 · 청구·수납). id가 겹치면 앞의 것. */
export const DASHBOARD_TREND_METRICS = Object.freeze((() => {
  const all = [...STUDENT_TREND_METRICS, ...ADMISSIONS_TREND_METRICS, ...ATTENDANCE_TREND_METRICS, ...BILLING_TREND_METRICS];
  const rank = (id) => { const i = DASHBOARD_KPI_ORDER.indexOf(id); return i < 0 ? DASHBOARD_KPI_ORDER.length : i; };
  const seen = new Set();
  return all.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => rank(a.id) - rank(b.id));
})());
