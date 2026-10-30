// model.workspaces — 2.0 기능 인벤토리(catalog/feature-inventory.json)의 패밀리마다 읽기 전용 업무 모델.
// snapshot.mjs가 같은 읽기 전용 트랜잭션 안에서 부른다. 전체 근거 목록은 snapshot.js에 싣지 않고
// 이 모듈의 저장소에만 둔다(GET /api/workspaces/:id/records, domain-http.mjs).
import { EVIDENCE, assertWorkspaces, kpi, yymm, md } from './domain-snapshot-core.mjs';
import { academicFamilies } from './domain-snapshot-academic.mjs';
import { studentFamilies } from './domain-snapshot-students.mjs';
import { peopleFamilies } from './domain-snapshot-people.mjs';
import { opsFamilies } from './domain-snapshot-ops.mjs';
import { supportFamilies } from './domain-snapshot-support.mjs';

// 인벤토리와 같은 순서·ID. verify-domain-snapshot.mjs가 인벤토리 파일과 대조한다.
export const FAMILY_IDS = Object.freeze(['dashboard', 'calendar', 'tasks-notifications', 'slack', 'onescreen', 'video-homework', 'timetable', 'class-sheets', 'attendance', 'classes', 'makeups', 'textbooks', 'lesson-reports', 'class-review', 'students', 'student-contribution', 'exams', 'consultations', 'enrollment', 'retention', 'newcomers', 'withdrawals', 'withdrawal-reports', 'staff', 'payroll', 'billing', 'textbook-requests', 'expense-requests', 'shuttle', 'inventory', 'meetings', 'approvals', 'documents', 'support', 'owner-settings', 'help', 'teacher-workspace', 'student-portal', 'parent-portal', 'public-sites', 'auth-session', 'platform-console', 'integrations', 'recording-transcription', 'shell-infrastructure', 'demo-tenant', 'dev-tools']);
export const AUDIT_ONLY = Object.freeze(['auth-session', 'platform-console', 'recording-transcription', 'shell-infrastructure', 'demo-tenant', 'dev-tools']);
// src/features/owner/subjects.ts — 학원 설정 과목이 단일 소스, 미등록 키는 옛 라벨로만 표시.
const LEGACY_SUBJECTS = { math: '수학', english: '영어' };
/** 2.0 DEFAULT_ENGLISH_SKILL_AREAS(src/features/owner/skill-areas.ts)의 키·라벨 — 설정이 비었을 때만. */
const ENGLISH_SKILL_AREAS = [['vocab', 'Vocab'], ['listening', 'Listening'], ['reading', 'Reading'], ['grammar', 'Grammar'], ['writing', 'Writing'], ['speaking', 'Speaking']].map(([key, label]) => ({ key, label }));

// 작업 공간 위 칸 = 추세 카드(원장 10-30 *"상단 쪽의 카드도 전체 건수보다 추세를 보고 싶음"*). 화면용 `cards`로만 싣고 `metrics`는
// 그대로 둔다(AI 맥락·원장실·업무 흐름이 읽는다). 운영실 카드(2.0 운영실 상단 칸과 같은 함수 · 같은 id)를 그 지표가 속한 작업 공간에
// 나눠 싣고, 없으면 그 작업 공간의 월별 추세로 '이번 달' 카드 하나. 둘 다 없으면 cards 없음(종전 숫자 칸).
const DASHBOARD_CARDS_FOR = {
  students: ['enrolled-students', 'courses', 'exits', 'new-enrollments'], classes: ['courses', 'enrolled-students'],
  enrollment: ['intake', 'level-tests', 'new-enrollments', 'first-classes'], newcomers: ['new-enrollments', 'first-classes'],
  withdrawals: ['exits'], 'withdrawal-reports': ['exits'], attendance: ['recent-absent', 'makeups'], makeups: ['makeups'],
};
function monthCard(trend, asOf) {
  const points = trend.points.slice(-6).map(p => ({ label: yymm(p.date), value: p.value }));
  // 이번 달은 기준일까지라 전월(한 달 전체)과 견주면 작게 보인다 — 좋고 나쁨 색은 칠하지 않는다(better null).
  const basis = `이번 달은 ${md(asOf)}까지 · 전월은 한 달 전체`;
  return { ...kpi(String(trend.label).replace(/^월별\s*/, ''), trend.unit || '', points, { period: 'month', span: `${md(asOf)}까지`, basis }), detail: basis };
}
function attachCards(families, asOf) {
  const dash = (families.dashboard?.metrics || []).filter(m => m.kind === 'kpi');
  for (const [id, f] of Object.entries(families)) {
    if (!f || id === 'dashboard' || (f.metrics || []).some(m => m.kind === 'kpi')) continue;
    const mapped = (DASHBOARD_CARDS_FOR[id] || []).map(k => dash.find(m => m.id === k)).filter(Boolean);
    const own = !mapped.length && f.trend?.granularity === 'month' && f.trend.points.length >= 2 ? [monthCard(f.trend, asOf)] : [];
    if (mapped.length || own.length) f.cards = [...mapped, ...own];
  }
}

let store = null;
/** Server-side evidence store from the latest verified snapshot load (never serialized). */
export const workspaceRecords = () => store;

export async function loadWorkspaces(sql, { tenantId, asOf, capturedAt }) {
  const month = asOf.slice(0, 7), monthStart = `${month}-01`;
  const subjects = await sql`select x->>'key' as key, x->>'label' as label, x->'skillAreas' as areas from public.tenant_settings, jsonb_array_elements(case when jsonb_typeof(data->'operations'->'subjects')='array' then data->'operations'->'subjects' else '[]'::jsonb end) x where tenant_id=${tenantId}`;
  const labels = { ...LEGACY_SUBJECTS, ...Object.fromEntries(subjects.filter(s => s.key && s.label).map(s => [s.key, s.label])) };
  // 교재·수업계획 '구분' = 2.0 resolveSkillAreas·skillAreaLabelOf(src/features/owner/skill-areas.ts)와 같은 규칙:
  // 과목 설정의 skillAreas → 영어는 비었으면 기본 6영역 → 목록에 없는 키는 원문 그대로.
  const areasOf = Object.fromEntries(subjects.filter(s => s.key).map(s => [s.key, Array.isArray(s.areas) ? s.areas.filter(a => a?.key && a?.label) : []]));
  if (!areasOf.english?.length) areasOf.english = ENGLISH_SKILL_AREAS;
  const ctx = {
    sql, t: tenantId, asOf, month, monthStart, capturedAt, subjectSettings: subjects,
    notTest: sql`and student_id not in (select id from public.students where tenant_id=${tenantId} and coalesce(is_test,false))`,
    subjectLabel: key => labels[key] || (key ? '기타 과목' : '과목 미지정'),
    skillAreaLabel: (subject, key) => (areasOf[subject] || []).find(a => a.key === key)?.label || key,
    // 상담처럼 과목을 글로 적는 칸: 알려진 키만 라벨로 바꾸고 사람이 쓴 글은 그대로.
    subjectText: text => text ? text.split(/\s*,\s*/).map(s => labels[s] || labels[s.toLowerCase()] || s).join(', ') : null,
    subjectFacets: { ...Object.fromEntries(Object.entries(labels).map(([k, v]) => [`subject:${k}`, v])), 'subject:none': '과목 미지정' },
  };
  const loaded = {};
  for (const load of [academicFamilies, studentFamilies, peopleFamilies, opsFamilies, supportFamilies]) Object.assign(loaded, await load(ctx));
  const families = Object.fromEntries(FAMILY_IDS.map(id => [id, loaded[id]]));
  for (const id of Object.keys(loaded)) if (!FAMILY_IDS.includes(id)) throw new Error(`workspaces: unmapped family ${id}`);
  attachCards(families, asOf);
  const workspaces = { asOf, families };
  assertWorkspaces(workspaces, FAMILY_IDS);
  for (const id of AUDIT_ONLY) if (families[id].dataState !== 'not-applicable') throw new Error(`workspaces.${id}: audit-only family must be not-applicable`);
  store = Object.freeze({ asOf, families: new Map(FAMILY_IDS.map(id => [id, { title: families[id].title, facets: families[id].facets, records: families[id][EVIDENCE] }])) });
  return workspaces;
}
