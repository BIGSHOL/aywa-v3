// 확장 추세 지표 목록(원장 10-28 "완전한 확장 추세 툴을 하나 만들고, 거기서 선택한 공통적으로 사용할 수 있는건 공통적으로 사용하면서
// 기준만 바꿔서 필터링") — 화면(v2-screen-trend.*)은 하나이고, 지표마다 다른 것은 여기 한 줄씩이다.
//   { id, label, group, unit('%' = 비율 · 그 밖 = 건수), better('up'|'down'), dims: [{ id, label }],
//     series({ sql, asOf, tenantId, importV2, windows, by, filter }) → { since?, total: [[분자, 분모] | null], rows: [{ key, label, points: [[분자, 분모] | null] }] } }
//     since = 그 지표를 믿을 수 있는 첫날(그보다 앞서 끝난 창은 화면이 잘라 낸다).
//   endsYesterday = 오늘은 아직 셀 수 없는 지표(출결 — 2.0 '어제까지') — 화면이 창을 어제까지로 끝낸다.
// 창(windows)·필터·이름 붙이기·응답 모양은 화면 서버가 공통으로 맡는다. 계산은 그 지표 카드와 같은 함수여야 한다(같은 데이터는 같은 원본).
// 필터는 { dim, key } — 지표가 알아듣는 기준만 온다(dims 중 하나).
import { TEACHER_WORK_METRICS, subjectKeyOf, teacherWorkTrend } from './v2-teacher-work.mjs';
// 운영실 — 2.0 상단 KPI 9칸(카드와 같은 id)과 추세가 있는 위젯(등록 · 퇴원 · 3개월 내 퇴원 · 등원율 · 청구·수납). 계산은 v2-dashboard-flow*.mjs.
import { DASHBOARD_TREND_METRICS } from './v2-dashboard-flow.mjs';

// 수업보고서·출결·영상 — 2.0 강사별 업무 현황 판정. 선생님·반·과목으로 묶고, 필터는 반 목록(scope)으로 좁힌다. 학생 묶음은 아직 없다.
const TEACHER_WORK_DIMS = Object.freeze([{ id: 'teacher', label: '선생님별' }, { id: 'class', label: '반별' }, { id: 'subject', label: '과목별' }]);
async function classScope(sql, tenantId, filter) {
  if (!filter) return null;
  const classes = await sql`select id, teacher_id, subject, english_track from public.classes where tenant_id=${tenantId}`;
  const hit = { teacher: (c) => (c.teacher_id ?? 'unassigned') === filter.key, class: (c) => c.id === filter.key, subject: (c) => subjectKeyOf({ subject: c.subject, track: c.english_track }) === filter.key }[filter.dim];
  return { classIds: hit ? classes.filter(hit).map((c) => c.id) : [] };
}

export const TREND_METRICS = Object.freeze([...TEACHER_WORK_METRICS.map((m) => Object.freeze({
  id: m.id, label: m.label, group: '선생님 수업보고서', unit: '%', better: 'up', dims: TEACHER_WORK_DIMS, endsYesterday: !!m.attendance,
  async series({ sql, asOf, tenantId, importV2, windows, by, filter }) {
    return teacherWorkTrend({ sql, asOf, tenantId, importV2, metric: m.id, windows, by, scope: await classScope(sql, tenantId, filter) });
  },
})), ...DASHBOARD_TREND_METRICS]);
