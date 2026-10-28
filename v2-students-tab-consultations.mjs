// 원생 상세 '상담' 탭(2.0 _tabs/consultations-tab.tsx) — getStudentConsultationHistory · getStudentEnrollmentConsultations를 Docker 복사본에서.
// · 학생상담(student_consultations) = 상담일 최신순 · 상담자 이름 · 요약은 2.0 visibleConsultationSummary(내부 연결 표식을 뗀 글).
//   원장 화면이라 '본인이 등록한 상담만'(강사 범위) 갈래는 없다.
// · 입학 상담(enrollment_consultations) = 콜&상담 권한이 있을 때만(page.tsx canSeeEnrollment) — 날짜 = 상담일 → 상담 날짜 → 입력 시각.
//   못 읽으면 2.0처럼 'error'(실패를 '없음'으로 위장하지 않는다). AI 분석은 부르지 않는다(저장된 칸만).
// · 학원 설정(과목 이름)은 입학 상담을 보일 때만(2.0 getTenantSettings 자리). 읽기 전용.

import { readConsultationHistory } from './v2-students-tab-overview.mjs';

// 상담 이력 조회는 개요 탭과 같은 원본(readConsultationHistory — 2.0 getStudentConsultationHistory)을 쓴다.
/** getStudentEnrollmentConsultations — { status: 'ok', rows } · 못 읽으면 { status: 'error' }. */
export async function readEnrollmentConsultations(sql, t, id) {
  const rows = await sql.soft((sp) => sp`select id::text id, to_json(consulted_at)#>>'{}' consulted_at, to_json(consultation_date)#>>'{}' consultation_date,
      to_json(created_at)#>>'{}' created_at, subject, outcome::text outcome, parent_request, career_goal, follow_up_content
    from public.enrollment_consultations where tenant_id=${t} and student_id=${id} order by created_at desc, id`, null);
  if (!rows) return { status: 'error' };
  return { status: 'ok', rows: rows.map((r) => ({ id: r.id, date: r.consulted_at ?? r.consultation_date ?? r.created_at ?? null, subject: r.subject,
    outcome: r.outcome, request: r.parent_request, careerGoal: r.career_goal, followUp: r.follow_up_content })) };
}

export async function loadTab({ base, sql, t, id, gates, settings }) {
  const canSeeEnrollment = !!gates.canSeeEnrollment;
  const consults = await readConsultationHistory(base, id);
  const enrollResult = canSeeEnrollment ? await readEnrollmentConsultations(sql, t, id) : null;
  return { consults, enrollResult, settings: canSeeEnrollment ? { operations: { subjects: settings.operations.subjects } } : null };
}
