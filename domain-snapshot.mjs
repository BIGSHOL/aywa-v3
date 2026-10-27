// model.workspaces — 2.0 기능 인벤토리(catalog/feature-inventory.json)의 패밀리마다 읽기 전용 업무 모델.
// snapshot.mjs가 같은 읽기 전용 트랜잭션 안에서 부른다. 전체 근거 목록은 snapshot.js에 싣지 않고
// 이 모듈의 저장소에만 둔다(GET /api/workspaces/:id/records, domain-http.mjs).
import { EVIDENCE, assertWorkspaces } from './domain-snapshot-core.mjs';
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

let store = null;
/** Server-side evidence store from the latest verified snapshot load (never serialized). */
export const workspaceRecords = () => store;

export async function loadWorkspaces(sql, { tenantId, asOf, capturedAt }) {
  const month = asOf.slice(0, 7), monthStart = `${month}-01`;
  const subjects = await sql`select x->>'key' as key, x->>'label' as label from public.tenant_settings, jsonb_array_elements(case when jsonb_typeof(data->'operations'->'subjects')='array' then data->'operations'->'subjects' else '[]'::jsonb end) x where tenant_id=${tenantId}`;
  const labels = { ...LEGACY_SUBJECTS, ...Object.fromEntries(subjects.filter(s => s.key && s.label).map(s => [s.key, s.label])) };
  const ctx = {
    sql, t: tenantId, asOf, month, monthStart, capturedAt,
    notTest: sql`and student_id not in (select id from public.students where tenant_id=${tenantId} and coalesce(is_test,false))`,
    subjectLabel: key => labels[key] || (key ? '기타 과목' : '과목 미지정'),
    // 상담처럼 과목을 글로 적는 칸: 알려진 키만 라벨로 바꾸고 사람이 쓴 글은 그대로.
    subjectText: text => text ? text.split(/\s*,\s*/).map(s => labels[s] || labels[s.toLowerCase()] || s).join(', ') : null,
    subjectFacets: { ...Object.fromEntries(Object.entries(labels).map(([k, v]) => [`subject:${k}`, v])), 'subject:none': '과목 미지정' },
  };
  const loaded = {};
  for (const load of [academicFamilies, studentFamilies, peopleFamilies, opsFamilies, supportFamilies]) Object.assign(loaded, await load(ctx));
  const families = Object.fromEntries(FAMILY_IDS.map(id => [id, loaded[id]]));
  for (const id of Object.keys(loaded)) if (!FAMILY_IDS.includes(id)) throw new Error(`workspaces: unmapped family ${id}`);
  const workspaces = { asOf, families };
  assertWorkspaces(workspaces, FAMILY_IDS);
  for (const id of AUDIT_ONLY) if (families[id].dataState !== 'not-applicable') throw new Error(`workspaces.${id}: audit-only family must be not-applicable`);
  store = Object.freeze({ asOf, families: new Map(FAMILY_IDS.map(id => [id, { facets: families[id].facets, records: families[id][EVIDENCE] }])) });
  return workspaces;
}
