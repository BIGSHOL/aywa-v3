// Ontology and seed facts for the flow engine, read once from the verified local copy in a
// read-only transaction. Every relation is a foreign key (relation.source = "table.column");
// nothing is linked by matching names. Labels pass the shared contact scrub.
import { openFullDatabase, tenantId } from './full-db.mjs';
import { EVIDENCE, scrub } from './domain-snapshot-core.mjs';
import { ACTOR_ROLE, ROLE_LABEL, TASK_KINDS } from './flow-rules.mjs';
import { PROVIDER as INTEGRATION_LABEL } from './domain-snapshot-support.mjs';
import { importV2 } from './v2-bridge.mjs';

// Workspace evidence table → ontology type.
export const TYPE_OF_TABLE = { students: 'student', users: 'staff', classes: 'class', enrollments: 'enrollment', attendance_records: 'attendance', invoices: 'invoice', student_consultations: 'consultation', enrollment_consultations: 'lead', lesson_reports: 'report', staff_tasks: 'task', approval_documents: 'approval', withdrawal_reports: 'withdrawal_report', textbook_orders: 'textbook_order', inventory_assets: 'asset', student_homework_videos: 'video', teacher_satisfaction_judgments: 'satisfaction', makeup_reservations: 'makeup', makeedu_sync_runs: 'sync_run', classnote_notices: 'notice', user_integrations: 'integration' };
// Signal → the 2.0 table its recordIds belong to (AX-H5). Stated per signal: a family's recordSource can name several
// tables (직원 평가 = 포트폴리오 + 만족도 판정), and its first table is not always the one a signal points at.
// A signal missing here falls back to a single-table recordSource; anything else is a wiring gap (signalWiring).
export const SIGNAL_RECORD_TABLE = Object.freeze({ 'onescreen-notice-failed': 'classnote_notices', 'video-upload-failed': 'student_homework_videos', 'attendance-repeat-absence': 'attendance_records', 'makeup-overdue': 'makeup_reservations', 'makeup-overdue-older': 'makeup_reservations', 'report-send-failed': 'lesson_reports', 'satisfaction-pending': 'teacher_satisfaction_judgments', 'inventory-loan-overdue': 'inventory_assets', 'approval-pending': 'approval_documents', 'billing-remaining': 'invoices', 'textbook-waiting': 'textbook_orders', 'consultation-followup-overdue': 'student_consultations', 'enrollment-followup': 'enrollment_consultations', 'withdrawal-report-pending': 'withdrawal_reports', 'makeedu-sync-problem': 'makeedu_sync_runs', 'sheet-sync-error': 'user_integrations' });
const recordTable = (f, s) => SIGNAL_RECORD_TABLE[s.id] || ((f.recordSource || '').includes(',') ? null : f.recordSource || null);
export const WIRING_LABEL = { ok: '연결됨', partial: '일부만 연결', unlinked: '연결 0건(배선 누락)', unwired: '기록 종류 미상(배선 누락)', no_record_ids: '근거 기록 번호 없음(배선 누락)' };
/** Per signal: how many of its records became case refs. Anything but 'ok' is shown, never silently dropped. */
export function signalWiring(signals) {
  return signals.map(({ familyId, signal: s, table, refs }) => {
    const records = s.recordIds.length, linked = refs.length;
    const status = !records ? 'no_record_ids' : !table || !TYPE_OF_TABLE[table] ? 'unwired' : !linked ? 'unlinked' : linked < records ? 'partial' : 'ok';
    return { familyId, signalId: s.id, table: table || null, records, linked, status, label: WIRING_LABEL[status] };
  });
}
const TASK_SUBJECT = { attendance_absent_desk: 'student', video_upload_check: 'student', video_unassigned: 'video', unsent_report: 'report', report_send_failed: 'report', enrollment_followup: 'lead', withdrawal_step: 'withdrawal_report', followup_due: 'consultation', approval_turn: 'approval' };
const SKIP_SIGNALS = new Set(['tasks-overdue']); // the open staff_tasks themselves are source cases

export function deskCloseResult(cycle, rows, outcomeLabel) {
  const slot = String(cycle || '').split('|')[1] || '';
  const matched = slot ? (rows.some(r => r.slot === slot) ? rows.filter(r => r.slot === slot) : rows.filter(r => !r.slot))
    : (rows.some(r => !r.slot) ? rows.filter(r => !r.slot) : rows);
  const labels = [...new Set(matched.map(r => r.state === 'dismissed' ? '해당 없음' : outcomeLabel[r.outcome]).filter(Boolean))];
  return labels.length ? `데스크 확인 기록: ${labels.join(' · ')}` : '데스크 조치 기록으로 처리됨';
}

export function groupDeskTasks(tasks, absenceDays, entities, day) {
  const groups = new Map(), result = [];
  for (const task of tasks) {
    if (task.kind !== 'attendance_absent_desk') { result.push(task); continue; }
    const date = String(task.cycle || '').split('|')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { result.push(task); continue; }
    const key = `${task.subject_id}|${date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  for (const [key, group] of groups) {
    const bar = key.indexOf('|'), studentId = key.slice(0, bar), date = key.slice(bar + 1);
    group.sort((a, b) => String(a.opened || '').localeCompare(String(b.opened || '')) || String(a.id).localeCompare(String(b.id)));
    const rows = absenceDays.get(key) || [], first = group[0];
    const settled = group.find(t => t.close_reason === 'desk_settled');
    const open = group.find(t => t.status === 'open');
    const effective = settled || open || first;
    const student = entities.get(`student:${studentId}`)?.label || '원생';
    const records = [...Map.groupBy(rows, r => r.class_id || `unknown:${r.id}`).values()].map(group => group[0]);
    result.push({ ...first, status: settled ? settled.status : open ? 'open' : effective.status,
      close_reason: settled?.close_reason || (!open ? effective.close_reason : null), closed: settled?.closed || (!open ? effective.closed : null), closed_by: settled?.closed_by || (!open ? effective.closed_by : null),
      title: `${student} · ${day(date)} 결석 — 학부모 확인`,
      // 담당 = 2.0 원래 담당(출결 알림을 켠 데스크 직원 — absent-notify.ts) 그대로. 반 담임은 근거 줄에 표시만 한다.
      assignees: [...new Set(group.flatMap(t => t.assignees || []))],
      recordKeys: records.map(r => `attendance:${r.id}`), studentKey: `student:${studentId}`,
      groupDate: date, actionTaskId: open?.id || null, settledTaskId: settled?.id || null, mergedTaskIds: group.slice(1).map(t => t.id) });
  }
  return result;
}

export async function loadFlowSource({ workspaces, capturedAt, asOf }) {
  const { OUTCOME_LABEL: attendanceOutcomeLabel } = await importV2('features/attendance/live/queue.ts');
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

      const students = await sql`select id, name, status::text st, school, grade from public.students where tenant_id=${t} and not coalesce(is_test,false)`;
      // status/school/grade stay server-side (hierarchy cohort check and local labels); the /api/flow entity view does not copy them.
      for (const s of students) put('student', s.id, s.name, 'students', { status: s.st, school: scrub(s.school) || null, grade: scrub(s.grade) || null });
      const studentKey = id => id && entities.has(`student:${id}`) ? `student:${id}` : null;
      // Signals first: the records they point at are read below even when the base reads would not cover them (AX-H5).
      const defs = Object.values(workspaces?.families || {}).flatMap(f => (f.signals || []).filter(s => !SKIP_SIGNALS.has(s.id)).map(s => ({ f, s, table: recordTable(f, s) })));
      const want = (table, type) => [...new Set(defs.filter(d => d.table === table).flatMap(d => d.s.recordIds.map(String)))].filter(id => !entities.has(`${type}:${id}`));
      const byId = (table, type, q) => { const ids = want(table, type); return ids.length ? q(ids) : []; };
      const classes = await sql`select id, class_name, teacher_id from public.classes where tenant_id=${t}`;
      for (const c of classes) { const k = put('class', c.id, c.class_name, 'classes', { teacherId: c.teacher_id }); link('homeroom', k, staffKey(c.teacher_id), 'classes.teacher_id'); }
      const classKey = id => id && entities.has(`class:${id}`) ? `class:${id}` : null;
      // 원생에 딸린 기록 이름 = '<원생 이름> · <구분>'(원장 10-28 "학생이면 학생에게서 알아야할 정보들이 있잖아") — 원생 이름은 원생 기록과 같은 값.
      // 날짜는 M/D(올해가 아니면 연도째). 원생을 모르면 예전 이름 그대로.
      const year = asOf.slice(0, 4);
      const day = d => (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? '' : d.slice(0, 4) === year ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d);
      const monthOf = p => (/^\d{4}-\d{2}$/.test(p || '') && p.slice(0, 4) === year ? `${Number(p.slice(5, 7))}월` : p || '');
      const ofStudent = (id, what, fallback) => { const s = entities.get(`student:${id}`); return s && s.label && s.label !== '—' ? `${s.label} · ${what}` : fallback; };
      const enrollments = await sql`select id, student_id, class_id from public.enrollments where tenant_id=${t} and (start_date is null or start_date <= ${asOf}) and (end_date is null or end_date >= ${asOf}) and not coalesce(on_hold,false)`;
      for (const e of enrollments) { if (!studentKey(e.student_id) || !classKey(e.class_id)) continue; const k = put('enrollment', e.id, '수강', 'classes'); link('enrollment_of', k, studentKey(e.student_id), 'enrollments.student_id'); link('enrollment_in', k, classKey(e.class_id), 'enrollments.class_id'); }

      // 결석 업무의 원천 행은 업무 회차 날짜까지 읽는다. 이번 달 목록 후보와는 아래에서 따로 구분한다.
      const absences = await sql`select a.id, a.student_id, a.class_id, a.session_date::text d, to_char(a.slot_start,'HH24:MI') slot,
        span.session_start, span.session_end, span.slot_end, c.teacher_id, u.display_name teacher_name
        from public.attendance_records a left join public.classes c on c.tenant_id=a.tenant_id and c.id=a.class_id
        left join public.users u on u.tenant_id=a.tenant_id and u.id=c.teacher_id
        left join lateral (select to_char(min(s.start_time),'HH24:MI') session_start, to_char(max(s.end_time),'HH24:MI') session_end,
          to_char(max(s.end_time) filter (where s.start_time=a.slot_start),'HH24:MI') slot_end
          from public.class_schedules s where s.tenant_id=a.tenant_id and s.class_id=a.class_id
            and s.day_of_week::text=lower(to_char(a.session_date,'Dy')) and s.valid_from<=a.session_date
            and (s.valid_to is null or s.valid_to>=a.session_date)) span on true
        where a.tenant_id=${t} and a.status='absent' and (a.session_date between ${monthStart} and ${asOf}
          or exists (select 1 from public.staff_tasks k where k.tenant_id=${t} and k.kind='attendance_absent_desk' and k.subject_id=a.student_id and split_part(k.cycle,'|',1)=a.session_date::text))
          and not exists (select 1 from public.attendance_records b where b.tenant_id=${t} and b.supersedes_id=a.id)
        order by a.session_date desc, a.slot_start nulls first, a.class_id, a.id`;
      const classSessions = Map.groupBy(absences, a => `${a.student_id}|${a.d}|${a.class_id || 'unknown'}`);
      const sessionLabels = new Map();
      for (const group of classSessions.values()) {
        const first = group[0], student = entities.get(`student:${first.student_id}`)?.label || '원생', className = entities.get(`class:${first.class_id}`)?.label || '반 미상';
        const starts = group.map(a => a.slot || a.session_start).filter(Boolean).sort(), ends = group.map(a => a.slot ? a.slot_end || a.session_end : a.session_end).filter(Boolean).sort();
        const time = starts.length ? `${starts[0]}${ends.length ? `~${ends.at(-1)}` : ''}` : '시간 미상';
        const label = `${student} · ${day(first.d)} 결석 · ${className} ${time}`;
        for (const a of group) sessionLabels.set(a.id, label);
      }
      for (const a of absences) { if (!studentKey(a.student_id)) continue; const k = put('attendance', a.id, sessionLabels.get(a.id) || `${a.d} 결석`, 'attendance', { date: a.d, studentId: a.student_id, classId: a.class_id, slot: a.slot, teacherName: scrub(a.teacher_name) || null }); link('about_student', k, studentKey(a.student_id), 'attendance_records.student_id'); link('in_class', k, classKey(a.class_id), 'attendance_records.class_id'); }
      const invoices = await sql`select id, student_id, period, amount_total::float8 billed, coalesce(amount_discount,0)::float8 discount, coalesce(amount_paid,0)::float8 paid, greatest(0, amount_total - coalesce(amount_discount,0) - coalesce(amount_paid,0))::float8 remaining, due_date::text due, status::text st from public.invoices where tenant_id=${t} and period=${month} and status::text not in ('void','refunded')`;
      const putInvoice = i => { if (!studentKey(i.student_id)) return; const k = put('invoice', i.id, ofStudent(i.student_id, `${monthOf(i.period)} 청구`, `${i.period} 청구`), 'billing', { remaining: i.remaining, dueDate: i.due, period: i.period, billed: i.billed, discount: i.discount, paid: i.paid, studentId: i.student_id }); link('billed_to', k, studentKey(i.student_id), 'invoices.student_id'); };
      invoices.forEach(putInvoice);
      (await byId('invoices', 'invoice', ids => sql`select id, student_id, period, amount_total::float8 billed, coalesce(amount_discount,0)::float8 discount, coalesce(amount_paid,0)::float8 paid, greatest(0, amount_total - coalesce(amount_discount,0) - coalesce(amount_paid,0))::float8 remaining, due_date::text due from public.invoices where tenant_id=${t} and id::text = any(${ids})`)).forEach(putInvoice);
      const consults = await sql`select id, student_id, counselor_id, to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.student_consultations where tenant_id=${t} and (consulted_at at time zone 'Asia/Seoul')::date between ${asOf}::date - 30 and ${asOf} order by consulted_at desc, id`;
      const putConsult = c => { if (!studentKey(c.student_id)) return; const k = put('consultation', c.id, `${c.d} 상담`, 'consultations', { date: c.d }); link('about_student', k, studentKey(c.student_id), 'student_consultations.student_id'); link('counselor', k, staffKey(c.counselor_id), 'student_consultations.counselor_id'); };
      consults.forEach(putConsult);
      (await byId('student_consultations', 'consultation', ids => sql`select id, student_id, counselor_id, to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.student_consultations where tenant_id=${t} and id::text = any(${ids})`)).forEach(putConsult);
      // 진행 중 상담 + 할 일(콜&상담 후속 조치)이 가리키는 상담 — 후속 조치는 등록·미등록으로 끝난 상담에도 걸려 그 업무가 상담 기록을 잃었다(처리 화면으로 바로 열 수 없었다).
      const leads = await sql`select id, prospect_name, consultant_id from public.enrollment_consultations where tenant_id=${t} and (outcome::text in ('scheduled','consulted','ai_done') or id in (select subject_id from public.staff_tasks where tenant_id=${t} and kind='enrollment_followup'))`;
      for (const l of leads) { const k = put('lead', l.id, l.prospect_name || '이름 미입력', 'enrollment'); link('consultant', k, staffKey(l.consultant_id), 'enrollment_consultations.consultant_id'); }
      const approvals = await sql`select d.id, d.title, d.drafter_id, (select array_agg(s.approver_id::text) from public.approval_steps s where s.tenant_id=${t} and s.document_id=d.id and s.decision='pending') approvers from public.approval_documents d where d.tenant_id=${t}`;
      for (const a of approvals) { const k = put('approval', a.id, a.title, 'approvals', { approvers: a.approvers || [] }); link('drafter', k, staffKey(a.drafter_id), 'approval_documents.drafter_id'); for (const p of a.approvers || []) link('approver', k, staffKey(p), 'approval_steps.approver_id'); }
      const wreports = await sql`select id, student_id, teacher_id, manager_ids::text[] managers from public.withdrawal_reports where tenant_id=${t}`;
      for (const w of wreports) { const k = put('withdrawal_report', w.id, ofStudent(w.student_id, '퇴원보고서', '퇴원보고서'), 'withdrawal-reports', { managers: w.managers || [] }); link('about_student', k, studentKey(w.student_id), 'withdrawal_reports.student_id'); link('homeroom_teacher', k, staffKey(w.teacher_id), 'withdrawal_reports.teacher_id'); for (const m of w.managers || []) link('approver', k, staffKey(m), 'withdrawal_reports.manager_ids'); }
      const reports = await sql`select r.id, r.student_id, r.class_id, r.created_by, r.report_date::text d from public.lesson_reports r where r.tenant_id=${t} and (r.id in (select subject_id from public.staff_tasks where tenant_id=${t}) or r.id::text = any(${want('lesson_reports', 'report')}))`;
      for (const r of reports) { const k = put('report', r.id, ofStudent(r.student_id, `${day(r.d)} 수업보고서`, `${r.d} 수업보고서`), 'lesson-reports'); link('about_student', k, studentKey(r.student_id), 'lesson_reports.student_id'); link('in_class', k, classKey(r.class_id), 'lesson_reports.class_id'); link('written_by', k, staffKey(r.created_by), 'lesson_reports.created_by'); }
      const books = await sql`select id, book_name, student_id from public.textbook_orders where tenant_id=${t} and status in ('requested','ordered')`;
      for (const b of books) { const k = put('textbook_order', b.id, b.book_name, 'textbook-requests'); link('for_student', k, studentKey(b.student_id), 'textbook_orders.student_id'); }
      const assets = await sql`select a.id, a.asset_code, l.borrower_user_id from public.inventory_assets a join public.inventory_loans l on l.asset_id=a.id and l.tenant_id=${t} where a.tenant_id=${t} and l.status='out'`;
      for (const a of assets) { const k = put('asset', a.id, a.asset_code || '자산', 'inventory', { borrowerId: a.borrower_user_id }); link('borrower', k, staffKey(a.borrower_user_id), 'inventory_loans.borrower_user_id'); }
      const videos = await sql`select id, student_id, teacher_id, to_char(posted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.student_homework_videos where tenant_id=${t} and status='failed'`;
      // Signal records outside the base reads: 만족도 판정 · 보강 예약 · 메이크에듀 동기화 · 반 공지 · 연동(AX-H5).
      for (const j of await byId('teacher_satisfaction_judgments', 'satisfaction', ids => sql`select id, student_id, class_id, posted_on::text d from public.teacher_satisfaction_judgments where tenant_id=${t} and id::text = any(${ids})`)) { const k = put('satisfaction', j.id, ofStudent(j.student_id, `${day(j.d)} 학부모 글`, `${j.d || ''} 학부모 글`), 'class-review', { classId: j.class_id }); link('about_student', k, studentKey(j.student_id), 'teacher_satisfaction_judgments.student_id'); link('in_class', k, classKey(j.class_id), 'teacher_satisfaction_judgments.class_id'); }
      for (const m of await byId('makeup_reservations', 'makeup', ids => sql`select id, student_id, class_id, makeup_date::text d from public.makeup_reservations where tenant_id=${t} and id::text = any(${ids})`)) { const k = put('makeup', m.id, ofStudent(m.student_id, `${day(m.d)} 보강 예약`, `${m.d || ''} 보강 예약`), 'makeups', { classId: m.class_id }); link('about_student', k, studentKey(m.student_id), 'makeup_reservations.student_id'); link('in_class', k, classKey(m.class_id), 'makeup_reservations.class_id'); }
      for (const r of await byId('makeedu_sync_runs', 'sync_run', ids => sql`select id, to_char(started_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, to_char(started_at at time zone 'Asia/Seoul','HH24:MI') hm from public.makeedu_sync_runs where tenant_id=${t} and id::text = any(${ids})`)) put('sync_run', r.id, `메이크에듀 동기화 ${day(r.d)} ${r.hm}`, 'integrations');
      for (const n of await byId('classnote_notices', 'notice', ids => sql`select id, created_by, to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.classnote_notices where tenant_id=${t} and id::text = any(${ids})`)) { const k = put('notice', n.id, `${day(n.d)} 반 공지`, 'onescreen'); link('written_by', k, staffKey(n.created_by), 'classnote_notices.created_by'); }
      for (const l of await byId('user_integrations', 'integration', ids => sql`select id, provider from public.user_integrations where tenant_id=${t} and id::text = any(${ids})`)) put('integration', l.id, `${INTEGRATION_LABEL[l.provider] || '기타 연동'} 연동`, 'integrations');
      for (const v of videos) { const k = put('video', v.id, ofStudent(v.student_id, `${v.d ? `${day(v.d)} ` : ''}숙제 영상`, `${v.d || ''} 숙제 영상`), 'video-homework', { teacherId: v.teacher_id }); link('about_student', k, studentKey(v.student_id), 'student_homework_videos.student_id'); link('teacher', k, staffKey(v.teacher_id), 'student_homework_videos.teacher_id'); }

      // Every 2.0 staff_task (open and fact-closed) with its real assignees and audited history.
      const tasks = await sql`select k.id, k.kind, k.status, k.close_reason, to_char(k.closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') closed, k.closed_by::text closed_by, k.subject_id, k.title, k.detail, k.cycle, to_char(k.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') opened, to_char(k.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') due, (select array_agg(a.user_id::text order by a.user_id) from public.staff_task_assignees a where a.tenant_id=${t} and a.task_id=k.id) assignees from public.staff_tasks k where k.tenant_id=${t} order by k.opened_at, k.id`;
      const deskResults = await sql`select k.id task_id, coalesce(to_char(f.slot_start, 'HH24:MI'), '') slot, f.state, f.outcome
        from public.staff_tasks k join public.attendance_followups f on f.tenant_id=k.tenant_id and f.student_id=k.subject_id
          and f.session_date::text=split_part(k.cycle, '|', 1) and f.signal='absent' and f.state in ('resolved','dismissed')
        where k.tenant_id=${t} and k.kind='attendance_absent_desk' and k.status='done' and k.close_reason='desk_settled'
          and (split_part(k.cycle, '|', 2)='' or f.slot_start is null or to_char(f.slot_start, 'HH24:MI')=split_part(k.cycle, '|', 2))`;
      const deskByTask = new Map();
      for (const r of deskResults) { if (!deskByTask.has(r.task_id)) deskByTask.set(r.task_id, []); deskByTask.get(r.task_id).push(r); }
      const history = await sql`select e.id::text, e.task_id::text task, e.event, e.actor_id::text actor, to_char(e.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') at from public.staff_task_events e where e.tenant_id=${t} order by e.at, e.id`;
      for (const k of tasks) {
        const key = put('task', k.id, k.title || TASK_KINDS[k.kind]?.label || '업무', 'tasks-notifications');
        for (const a of k.assignees || []) link('assigned_to', key, staffKey(a), 'staff_task_assignees.user_id');
        const subjectType = TASK_SUBJECT[k.kind];
        if (subjectType && entities.has(`${subjectType}:${k.subject_id}`)) link('about', key, `${subjectType}:${k.subject_id}`, 'staff_tasks.subject_id');
      }
      const historyBy = new Map(); for (const h of history) { if (!historyBy.has(h.task)) historyBy.set(h.task, []); historyBy.get(h.task).push(h); }
      const enrollmentEvidence = new Map((workspaces?.families?.enrollment?.[EVIDENCE] || []).map(r => [String(r.id), r]));
      const taskDetail = k => {
        if (k.kind === 'attendance_absent_desk' && k.groupDate) return '출석부에 학부모 확인 결과를 남겨 주세요.';
        const r = k.kind === 'enrollment_followup' && ['open', 'late'].includes(k.status) ? enrollmentEvidence.get(String(k.subject_id)) : null;
        const pendingResult = r?.status === '등록 완료' && r.fields?.some(f => f.label === '상담 결과');
        return scrub([k.detail, pendingResult && '수강 중이나 상담 결과 미확정. 신규 콜&상담에서 결과를 등록 완료로 변경해 주세요.'].filter(Boolean).join(' · '));
      };
      const signals = defs.map(({ f, s, table }) => { const type = TYPE_OF_TABLE[table]; const refs = type ? s.recordIds.map(id => `${type}:${id}`).filter(k => entities.has(k)) : []; return { familyId: f.id, signal: s, table, refs }; });
      for (const w of signalWiring(signals)) if (w.status !== 'ok') console.warn(`flow source wiring: ${w.familyId}/${w.signalId} ${w.status} (records ${w.records}, linked ${w.linked})`);
      // signalFamilies = families whose signals were read (a signal missing there has cleared); loadedAt = when this source was read.
      const signalFamilies = Object.values(workspaces?.families || {}).filter(f => ['available', 'empty'].includes(f.dataState)).map(f => f.id);
      const absenceDays = new Map();
      for (const a of absences) { const key = `${a.student_id}|${a.d}`; if (!absenceDays.has(key)) absenceDays.set(key, []); absenceDays.get(key).push(a); }
      const groupedTasks = groupDeskTasks(tasks, absenceDays, entities, day);
      const taskCycles = new Map(tasks.map(k => [k.id, k.cycle]));
      return {
        identity: { tenantId: t, tenantSlug: 'cs', capturedAt, asOf }, loadedAt: new Date().toISOString(), signalFamilies, actors, entities, relations, signals,
        tasks: groupedTasks.map(k => ({ id: k.id, kind: k.kind, status: k.status, closeReason: k.close_reason, ...(k.kind === 'attendance_absent_desk' && k.close_reason === 'desk_settled' ? { closeResult: deskCloseResult(taskCycles.get(k.settledTaskId || k.id) || k.cycle, deskByTask.get(k.settledTaskId || k.id) || [], attendanceOutcomeLabel) } : {}), closedAt: k.closed, closedById: k.closed_by || null, title: scrub(k.title), detail: taskDetail(k), openedAt: k.opened, dueAt: k.due, assigneeIds: k.assignees || [], subjectKey: k.kind === 'attendance_absent_desk' || k.kind === 'video_upload_check' ? null : TASK_SUBJECT[k.kind] && entities.has(`${TASK_SUBJECT[k.kind]}:${k.subject_id}`) ? `${TASK_SUBJECT[k.kind]}:${k.subject_id}` : null, recordKeys: k.recordKeys || null, studentKey: k.studentKey || null, groupDate: k.groupDate || null, actionTaskId: k.actionTaskId || null, mergedTaskIds: k.mergedTaskIds || [], history: historyBy.get(k.id) || [] })),
        candidates: { absence: absences.filter(a => a.d >= monthStart && a.d <= asOf && studentKey(a.student_id)).map(a => a.id), billing: invoices.filter(i => i.remaining > 0 && studentKey(i.student_id)).map(i => i.id), consultation: consults.filter(c => studentKey(c.student_id)).map(c => c.id) },
      };
    });
  } finally { await db.end(); }
}
