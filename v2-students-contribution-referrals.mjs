// 2.0 getContributionReview와 같은 지점 설정·현재 상담 원본을 Docker에서 읽고 원본 reviewDisplay로 표시한다.
import { runV2Server } from './v2-server-runner.mjs';

export async function loadContributionReferrals(base) {
  const { results: [directoryResult] } = await runV2Server({ steps: [{ module: 'features/student-contribution/server/directory.ts',
    fn: 'getContributionDirectory', args: [] }], actorId: base.viewer.id, tenantId: base.t, mode: 'read' });
  const directory = directoryResult.value;
  if (!directory?.gate.canConfigure) return null;
  const [settings] = await base.sql`select referral_review from public.student_contribution_settings where tenant_id=${base.t} limit 1`;
  const report = settings?.referral_review ?? null;
  if (!report) return { gate: directory.gate, report: null, students: directory.rows };
  const ids = report.rows.map((row) => row.consultationId);
  const current = ids.length ? await base.sql`select id::text id, prospect_name, consultation_date, received_date,
    to_json(created_at)#>>'{}' created_at, referrer_student_id::text referrer_student_id, referrer_staff_id::text referrer_staff_id
    from public.enrollment_consultations where tenant_id=${base.t} and id = any(${ids}::uuid[]) order by id` : [];
  const { reviewDisplay } = await base.load('features/student-contribution/model/review-display.ts');
  return { gate: directory.gate, report: reviewDisplay(report, current),
    students: directory.rows.map(({ id, name, school, grade }) => ({ id, name, school, grade })) };
}
