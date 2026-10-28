// Source rows for the exit insight (INSIGHT-EXITS.md) — one repeatable-read, read-only transaction on the local copy
// (openFullDatabase), the cs tenant only. Column sets mirror 2.0's churn source (teacher-portfolio/server/churn-source.ts)
// so the 2.0 churn model sees the same shapes. Contact columns never leave SQL: siblings come back as a phone-key hash.
import { openFullDatabase, tenantId } from './full-db.mjs';

const iso = v => (v instanceof Date ? v.toISOString() : v ?? null);
// 2.0 same-person.ts phoneDigits/phoneKeyOf in SQL (digits only, +82 → 0, mobile only, no filler numbers) → md5 only.
const PHONE_KEY = `case when d ~ '^01[0-9]{8,9}$' and right(d, 8) !~ '^([0-9])\\1{7}$' then md5(d) end`;

export async function loadExitSource({ open = openFullDatabase, tenant = tenantId } = {}) {
  const db = await open();
  try {
    return await db.begin('isolation level repeatable read read only', async sql => {
      const t = tenant;
      const students = await sql`select id, name, english_name, nickname, parent_name, school, grade, status::text status, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at,
        withdrawal_metadata, coalesce(is_test,false) is_test, case when notes like '중복 병합%' then left(notes, 200) end notes from public.students where tenant_id=${t}`;
      const phones = await sql.unsafe(`select id, ${PHONE_KEY} phone_key from (select id, case when d0 like '82%' and length(d0) >= 11 then '0' || substr(d0, 3) else d0 end d
        from (select id, regexp_replace(coalesce(parent_phone, ''), '[^0-9]', '', 'g') d0 from public.students where tenant_id=$1) x) y`, [t]);
      const links = await sql`select student_a, student_b, linked from public.student_siblings where tenant_id=${t}`;
      const invoices = await sql`select id, student_id, period, status::text status, category, amount_total::float8 gross, coalesce(amount_discount,0)::float8 discount, line_items
        from public.invoices where tenant_id=${t} and status not in ('void','refunded')`;
      const terms = await sql`select st.invoice_id, st.class_id, st.subject, st.planned_sessions::float8 planned, st.confirmed_sessions::float8 confirmed, st.allocation_line_index line
        from public.invoice_session_terms st where st.tenant_id=${t}`;
      const classes = await sql`select id, class_name, subject, english_track, teacher_id, is_active, closed_at::text closed_at, report_optout, is_makeup_pool, is_special from public.classes where tenant_id=${t}`;
      const schedules = await sql`select id, class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, teacher_id, slot_teacher_label, lab_separate, valid_from::text valid_from, valid_to::text valid_to
        from public.class_schedules where tenant_id=${t}`;
      const enrollments = await sql`select id, student_id, class_id, start_date::text start_date, end_date::text end_date, coalesce(on_hold,false) on_hold, attendance_days, coalesce(is_transferred,false) is_transferred,
        coalesce(is_transferred_in,false) is_transferred_in, withdrawal_reason, withdrawal_detail, withdrawal_memo from public.enrollments where tenant_id=${t}`;
      const transitions = await sql`select target_label, created_at, metadata->>'classId' class_id, metadata->>'newTeacherId' teacher_id, metadata->>'previousTeacherId' previous_teacher_id, metadata->>'effectiveDate' effective_date
        from public.audit_logs where tenant_id=${t} and action in ('class_handover_apply','class_update') and metadata->>'newTeacherId' is not null order by created_at, id`;
      const users = await sql`select id, display_name, english_name, status::text status, job_title from public.users where tenant_id=${t} and system_role::text <> 'student'`;
      // Corrections replace earlier rows (supersedes_id) — the same rule as snapshot.mjs and the attendance workspace.
      const attendance = await sql`select a.id, a.student_id, a.class_id, a.session_date::text d, a.status::text status from public.attendance_records a
        where a.tenant_id=${t} and not exists (select 1 from public.attendance_records b where b.tenant_id=${t} and b.supersedes_id=a.id)`;
      const consultations = await sql`select id, student_id, class_id, to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, category, subject, summary, follow_up_action, counselor_id
        from public.student_consultations where tenant_id=${t}`;
      const reports = await sql`select id, student_id, teacher_id, status, exit_kind, effective_date::text d, subjects, body->>'reason' reason, body->>'reasonDetail' detail, body->>'teacherOpinion' opinion
        from public.withdrawal_reports where tenant_id=${t}`;
      const archives = await sql`select id, mapped_student_id student_id, exit_date::text d, class_name, subject, teacher_name, mapped_teacher_id, fields->>'퇴원사유' reason, fields->>'상세사유' detail,
        fields->>'담임의견' opinion, fields->>'학부모상담' parent_talk, fields->>'학생상담' student_talk from public.withdrawal_report_archives where tenant_id=${t} and mapped_student_id is not null`;
      const grades = await sql`select id, student_id, subject, exam_name, exam_slot, taken_on::text d, score::float8 score, max_score::float8 max, coalesce(no_exam,false) no_exam from public.student_grades where tenant_id=${t}`;
      const [settings] = await sql`select config from public.teacher_evaluation_settings where tenant_id=${t}`;
      // Subject labels from 학원 설정 (operations.subjects) — the same query as domain-snapshot.mjs; no hard-coded subject list.
      const subjects = await sql`select x->>'key' as key, x->>'label' as label from public.tenant_settings, jsonb_array_elements(case when jsonb_typeof(data->'operations'->'subjects')='array' then data->'operations'->'subjects' else '[]'::jsonb end) x where tenant_id=${t}`;
      return { students, phones, links, invoices, terms, classes, schedules, enrollments, users, attendance, consultations, reports, archives, grades, subjects,
        transitions: transitions.map(r => ({ ...r, created_at: iso(r.created_at) })), evaluationConfig: settings?.config ?? null };
    });
  } finally { await db.end(); }
}
