// Ontology and seed facts for the flow engine, read once from the verified local copy in a
// read-only transaction. Every relation is a foreign key (relation.source = "table.column");
// nothing is linked by matching names. Labels pass the shared contact scrub.
import { openFullDatabase, tenantId } from './full-db.mjs';
import { scrub } from './domain-snapshot-core.mjs';
import { ACTOR_ROLE, ROLE_LABEL, TASK_KINDS } from './flow-rules.mjs';

// Workspace evidence table → ontology type.
export const TYPE_OF_TABLE = { students: 'student', users: 'staff', classes: 'class', enrollments: 'enrollment', attendance_records: 'attendance', invoices: 'invoice', student_consultations: 'consultation', enrollment_consultations: 'lead', lesson_reports: 'report', staff_tasks: 'task', approval_documents: 'approval', withdrawal_reports: 'withdrawal_report', textbook_orders: 'textbook_order', inventory_assets: 'asset', student_homework_videos: 'video' };
const TASK_SUBJECT = { attendance_absent_desk: 'student', video_upload_check: 'student', video_unassigned: 'video', unsent_report: 'report', report_send_failed: 'report', enrollment_followup: 'lead', withdrawal_step: 'withdrawal_report', followup_due: 'consultation', approval_turn: 'approval' };
const SKIP_SIGNALS = new Set(['tasks-overdue']); // the open staff_tasks themselves are source cases

export async function loadFlowSource({ workspaces, capturedAt, asOf }) {
  const db = await openFullDatabase();
  try {
    return await db.begin('isolation level repeatable read read only', async sql => {
      const t = tenantId, month = asOf.slice(0, 7), monthStart = `${month}-01`;
      const [tenant] = await sql`select slug from public.tenants where id=${t}`;
      if (tenant?.slug !== 'cs') throw new Error('flow source tenant mismatch');
      const users = await sql`select u.id, u.display_name, u.system_role::text role, u.status::text st, coalesce(u.attendance_alert_optin,false) desk, exists (select 1 from public.super_admins sa where sa.id=u.id) platform from public.users u where u.tenant_id=${t} and u.system_role::text <> 'student'`;
      const actors = users.filter(u => u.st === 'active' && !u.platform && ACTOR_ROLE[u.role]).map(u => ({ id: u.id, name: u.display_name, role: ACTOR_ROLE[u.role], roleLabel: ROLE_LABEL[u.role], systemRole: u.role, desk: u.desk, assignable: u.role !== 'viewer' }))
        .sort((a, b) => ['owner', 'manager', 'teacher', 'staff'].indexOf(a.role) - ['owner', 'manager', 'teacher', 'staff'].indexOf(b.role) || a.name.localeCompare(b.name, 'ko'));
      const entities = new Map(), relations = [];
      const put = (type, id, label, familyId, extra = {}) => { const key = `${type}:${id}`; if (!entities.has(key)) entities.set(key, { type, id: String(id), label: scrub(label) || '—', familyId, recordId: String(id), ...extra }); return key; };
      const link = (type, from, to, source) => { if (from && to) relations.push({ id: `rel-${relations.length + 1}`, type, from: { type: from.split(':')[0], id: from.slice(from.indexOf(':') + 1) }, to: { type: to.split(':')[0], id: to.slice(to.indexOf(':') + 1) }, source }); };
      for (const u of users) put('staff', u.id, u.display_name, 'staff');
      const staffKey = id => id && entities.has(`staff:${id}`) ? `staff:${id}` : null;

      const students = await sql`select id, name from public.students where tenant_id=${t} and not coalesce(is_test,false)`;
      for (const s of students) put('student', s.id, s.name, 'students');
      const studentKey = id => id && entities.has(`student:${id}`) ? `student:${id}` : null;
      const classes = await sql`select id, class_name, teacher_id from public.classes where tenant_id=${t}`;
      for (const c of classes) { const k = put('class', c.id, c.class_name, 'classes', { teacherId: c.teacher_id }); link('homeroom', k, staffKey(c.teacher_id), 'classes.teacher_id'); }
      const classKey = id => id && entities.has(`class:${id}`) ? `class:${id}` : null;
      const enrollments = await sql`select id, student_id, class_id from public.enrollments where tenant_id=${t} and (start_date is null or start_date <= ${asOf}) and (end_date is null or end_date >= ${asOf}) and not coalesce(on_hold,false)`;
      for (const e of enrollments) { if (!studentKey(e.student_id) || !classKey(e.class_id)) continue; const k = put('enrollment', e.id, '수강', 'classes'); link('enrollment_of', k, studentKey(e.student_id), 'enrollments.student_id'); link('enrollment_in', k, classKey(e.class_id), 'enrollments.class_id'); }

      // Absences this month (latest correction only) — scenario candidates and the repeat-absence signal.
      const absences = await sql`select a.id, a.student_id, a.class_id, a.session_date::text d from public.attendance_records a where a.tenant_id=${t} and a.status='absent' and a.session_date between ${monthStart} and ${asOf} and not exists (select 1 from public.attendance_records b where b.tenant_id=${t} and b.supersedes_id=a.id) order by a.session_date desc, a.id`;
      for (const a of absences) { if (!studentKey(a.student_id)) continue; const k = put('attendance', a.id, `${a.d} 결석`, 'attendance', { date: a.d, studentId: a.student_id, classId: a.class_id }); link('about_student', k, studentKey(a.student_id), 'attendance_records.student_id'); link('in_class', k, classKey(a.class_id), 'attendance_records.class_id'); }
      const invoices = await sql`select id, student_id, period, greatest(0, amount_total - coalesce(amount_discount,0) - coalesce(amount_paid,0))::float8 remaining, due_date::text due, status::text st from public.invoices where tenant_id=${t} and period=${month} and status::text not in ('void','refunded')`;
      for (const i of invoices) { if (!studentKey(i.student_id)) continue; const k = put('invoice', i.id, `${i.period} 청구`, 'billing', { remaining: i.remaining, dueDate: i.due }); link('billed_to', k, studentKey(i.student_id), 'invoices.student_id'); }
      const consults = await sql`select id, student_id, counselor_id, to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.student_consultations where tenant_id=${t} and (consulted_at at time zone 'Asia/Seoul')::date between ${asOf}::date - 30 and ${asOf} order by consulted_at desc, id`;
      for (const c of consults) { if (!studentKey(c.student_id)) continue; const k = put('consultation', c.id, `${c.d} 상담`, 'consultations', { date: c.d }); link('about_student', k, studentKey(c.student_id), 'student_consultations.student_id'); link('counselor', k, staffKey(c.counselor_id), 'student_consultations.counselor_id'); }
      const leads = await sql`select id, prospect_name, consultant_id from public.enrollment_consultations where tenant_id=${t} and outcome::text in ('scheduled','consulted','ai_done')`;
      for (const l of leads) { const k = put('lead', l.id, l.prospect_name || '이름 미입력', 'enrollment'); link('consultant', k, staffKey(l.consultant_id), 'enrollment_consultations.consultant_id'); }
      const approvals = await sql`select d.id, d.title, d.drafter_id, (select array_agg(s.approver_id::text) from public.approval_steps s where s.tenant_id=${t} and s.document_id=d.id and s.decision='pending') approvers from public.approval_documents d where d.tenant_id=${t}`;
      for (const a of approvals) { const k = put('approval', a.id, a.title, 'approvals', { approvers: a.approvers || [] }); link('drafter', k, staffKey(a.drafter_id), 'approval_documents.drafter_id'); for (const p of a.approvers || []) link('approver', k, staffKey(p), 'approval_steps.approver_id'); }
      const wreports = await sql`select id, student_id, teacher_id, manager_ids::text[] managers from public.withdrawal_reports where tenant_id=${t}`;
      for (const w of wreports) { const k = put('withdrawal_report', w.id, '퇴원보고서', 'withdrawal-reports', { managers: w.managers || [] }); link('about_student', k, studentKey(w.student_id), 'withdrawal_reports.student_id'); link('homeroom_teacher', k, staffKey(w.teacher_id), 'withdrawal_reports.teacher_id'); for (const m of w.managers || []) link('approver', k, staffKey(m), 'withdrawal_reports.manager_ids'); }
      const reports = await sql`select r.id, r.student_id, r.class_id, r.created_by, r.report_date::text d from public.lesson_reports r where r.tenant_id=${t} and r.id in (select subject_id from public.staff_tasks where tenant_id=${t})`;
      for (const r of reports) { const k = put('report', r.id, `${r.d} 수업보고서`, 'lesson-reports'); link('about_student', k, studentKey(r.student_id), 'lesson_reports.student_id'); link('in_class', k, classKey(r.class_id), 'lesson_reports.class_id'); link('written_by', k, staffKey(r.created_by), 'lesson_reports.created_by'); }
      const books = await sql`select id, book_name, student_id from public.textbook_orders where tenant_id=${t} and status in ('requested','ordered')`;
      for (const b of books) { const k = put('textbook_order', b.id, b.book_name, 'textbook-requests'); link('for_student', k, studentKey(b.student_id), 'textbook_orders.student_id'); }
      const assets = await sql`select a.id, a.asset_code, l.borrower_user_id from public.inventory_assets a join public.inventory_loans l on l.asset_id=a.id and l.tenant_id=${t} where a.tenant_id=${t} and l.status='out'`;
      for (const a of assets) { const k = put('asset', a.id, a.asset_code || '자산', 'inventory', { borrowerId: a.borrower_user_id }); link('borrower', k, staffKey(a.borrower_user_id), 'inventory_loans.borrower_user_id'); }
      const videos = await sql`select id, student_id, teacher_id, to_char(posted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.student_homework_videos where tenant_id=${t} and status='failed'`;
      for (const v of videos) { const k = put('video', v.id, `${v.d || ''} 숙제 영상`, 'video-homework', { teacherId: v.teacher_id }); link('about_student', k, studentKey(v.student_id), 'student_homework_videos.student_id'); link('teacher', k, staffKey(v.teacher_id), 'student_homework_videos.teacher_id'); }

      // Every 2.0 staff_task (open and fact-closed) with its real assignees and audited history.
      const tasks = await sql`select k.id, k.kind, k.status, k.close_reason, to_char(k.closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') closed, k.subject_id, k.title, k.detail, k.cycle, to_char(k.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') opened, to_char(k.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') due, (select array_agg(a.user_id::text order by a.user_id) from public.staff_task_assignees a where a.tenant_id=${t} and a.task_id=k.id) assignees from public.staff_tasks k where k.tenant_id=${t} order by k.opened_at, k.id`;
      const history = await sql`select e.id::text, e.task_id::text task, e.event, e.actor_id::text actor, to_char(e.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') at from public.staff_task_events e where e.tenant_id=${t} order by e.at, e.id`;
      for (const k of tasks) {
        const key = put('task', k.id, k.title || TASK_KINDS[k.kind]?.label || '할 일', TASK_KINDS[k.kind]?.familyId || 'tasks-notifications');
        for (const a of k.assignees || []) link('assigned_to', key, staffKey(a), 'staff_task_assignees.user_id');
        const subjectType = TASK_SUBJECT[k.kind];
        if (subjectType && entities.has(`${subjectType}:${k.subject_id}`)) link('about', key, `${subjectType}:${k.subject_id}`, 'staff_tasks.subject_id');
      }
      const historyBy = new Map(); for (const h of history) { if (!historyBy.has(h.task)) historyBy.set(h.task, []); historyBy.get(h.task).push(h); }
      const signals = [];
      for (const f of Object.values(workspaces?.families || {})) for (const s of f.signals || []) {
        if (SKIP_SIGNALS.has(s.id)) continue;
        const type = TYPE_OF_TABLE[(f.recordSource || '').split(',')[0]];
        signals.push({ familyId: f.id, signal: s, refs: s.recordIds.map(id => `${type}:${id}`).filter(k => entities.has(k)) });
      }
      return {
        identity: { tenantId: t, tenantSlug: 'cs', capturedAt, asOf }, actors, entities, relations, signals,
        tasks: tasks.map(k => ({ id: k.id, kind: k.kind, status: k.status, closeReason: k.close_reason, closedAt: k.closed, title: scrub(k.title), detail: scrub(k.detail), openedAt: k.opened, dueAt: k.due, assigneeIds: k.assignees || [], subjectKey: TASK_SUBJECT[k.kind] && entities.has(`${TASK_SUBJECT[k.kind]}:${k.subject_id}`) ? `${TASK_SUBJECT[k.kind]}:${k.subject_id}` : null, history: historyBy.get(k.id) || [] })),
        candidates: { absence: absences.filter(a => studentKey(a.student_id)).map(a => a.id), billing: invoices.filter(i => i.remaining > 0 && studentKey(i.student_id)).map(i => i.id), consultation: consults.filter(c => studentKey(c.student_id)).map(c => c.id) },
      };
    });
  } finally { await db.end(); }
}
