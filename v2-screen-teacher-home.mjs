// 강사 미니셸의 읽기: 보는 사람의 id를 서버에서 확인하고 각 칸의 명단과 숫자를 함께 낸다.
import { readPeople, deepMerge } from './v2-proc-people.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { studentsBase } from './v2-students-common.mjs';
import { writingRates } from './v2-lesson-reports-face-writing.mjs';
import { screen as attendanceScreen } from './v2-screen-attendance.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayOf = date => DOW[new Date(`${date}T00:00:00Z`).getUTCDay()];
const timeOf = value => String(value ?? '').slice(0, 5);
const unique = values => [...new Set(values)];

async function context({ sql, tenantId: t, importV2, params }) {
  const [people, clock, homeRule, axis] = await Promise.all([
    readPeople(sql, t, importV2, 'teacher_onescreen'), copyClock(), importV2('lib/auth/teacher-home-rule.ts'), importV2('features/attendance/teacher-axis.ts'),
  ]);
  const actor = people.users.find(u => u.id === params.actor && u.role === 'teacher');
  if (!actor) return null;
  const settings = deepMerge(people.settings.base, people.settings.stored ?? {});
  return { sql, t, importV2, actor, people, settings, homeRule, axis, clock, today: clock.day };
}

async function landing(c) {
  const { sql, t, actor, homeRule, people, today, settings } = c;
  const [modules, duty] = await Promise.all([
    c.importV2('lib/modules.ts'), c.importV2('features/attendance/seat/duty.ts'),
  ]);
  if (modules.isModuleEnabled(settings.modules?.disabled, 'seat_attendance')) {
    const [user] = await sql`select seat_lab_duty,seat_jj_duty from public.users where tenant_id=${t} and id=${actor.id}`;
    const seat = duty.landingPathFromDuties({ lab: user?.seat_lab_duty === true, jj: user?.seat_jj_duty === true });
    if (seat) return { actor: { id: actor.id, name: actor.display_name }, route: `#v2-attendance?v2path=${encodeURIComponent(seat)}&viewer=${actor.id}`, today };
  }
  const classes = await sql`select id::text id, subject from public.classes where tenant_id=${t} and teacher_id=${actor.id} and is_active and (closed_at is null or closed_at::date >= ${today}::date)`;
  let path = homeRule.teacherHomeFromClassSubjects(classes.map(x => x.subject).filter(Boolean));
  if (!path) {
    const [assist] = await sql`select count(distinct c.id)::int n from public.class_schedules s join public.classes c on c.id=s.class_id and c.tenant_id=${t}
      where s.tenant_id=${t} and s.teacher_id=${actor.id} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at::date >= ${today}::date)
        and s.valid_from<=${today}::date and (s.valid_to is null or s.valid_to>=${today}::date)`;
    path = homeRule.teacherHomeFromAssistantClasses(assist.n);
  }
  if (path === homeRule.ENGLISH_TEACHER_HOME && people.level(actor, 'ecs') === 'none') path = homeRule.DEFAULT_TEACHER_HOME;
  return { actor: { id: actor.id, name: actor.display_name }, home: path === homeRule.ENGLISH_TEACHER_HOME ? 'ecs' : 'onescreen', today };
}

async function lessons(c) {
  const { sql, t, actor, axis, today, settings, clock } = c;
  if ((settings.operations.holidays || []).some(h => h.date === today)) return { rows: [], total: 0, classes: 0, started: false };
  const rows = await sql`select s.id::text id, s.class_id::text class_id, s.day_of_week::text day_of_week, s.start_time::text start_time, s.end_time::text end_time,
      s.teacher_id::text teacher_id, s.slot_teacher_label, s.valid_from::text valid_from, s.valid_to::text valid_to,
      c.class_name, c.teacher_id::text homeroom_teacher_id from public.class_schedules s join public.classes c on c.id=s.class_id and c.tenant_id=${t}
    where s.tenant_id=${t} and s.day_of_week::text=${dayOf(today)} and c.is_active and (c.closed_at is null or c.closed_at::date >= ${today}::date)
      and s.valid_from<=${today}::date and (s.valid_to is null or s.valid_to>=${today}::date) order by s.start_time,s.class_id,s.id`;
  const mine = rows.filter(s => axis.slotLiveOn({ validFrom: s.valid_from, validTo: s.valid_to }, today) &&
    axis.taughtByForSlot({ homeroomTeacherId: s.homeroom_teacher_id, slot: { teacherId: s.teacher_id, slotTeacherLabel: s.slot_teacher_label } }).teacherId === actor.id);
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(clock.at);
  const items = mine.map(s => ({ id: s.id, classId: s.class_id, className: s.class_name, start: timeOf(s.start_time), end: timeOf(s.end_time), started: timeOf(s.start_time) <= now }));
  return { rows: items, total: items.length, classes: unique(items.map(x => x.classId)).length, started: items.some(x => x.started) };
}

async function attendance(c) {
  const taught = await lessons(c);
  if (!taught.started) return { today: c.today, rows: [], total: 0, cells: 0, before: true };
  const result = await attendanceScreen.load({ sql: c.sql, params: { v2path: `/attendance/${c.today}`, viewer: c.actor.id }, tenantId: c.t, importV2: c.importV2 });
  if (result.page !== 'dayList' || !Array.isArray(result.processing)) throw new Error('daily processing unavailable');
  const startedClasses = new Set(taught.rows.filter(x => x.started).map(x => x.classId));
  const rows = result.processing.flatMap(r => {
    const mine = r.byTeacher?.find(x => x.teacherId === c.actor.id);
    if (!mine || !startedClasses.has(r.classId) || mine.expected <= mine.recorded) return [];
    return [{ classId: r.classId, className: r.className, missing: mine.expected - mine.recorded }];
  });
  return { today: c.today, rows, total: rows.length, cells: rows.reduce((n, x) => n + x.missing, 0), before: false };
}

async function reports(c) {
  const tracked = (c.settings.report?.classnoteSubjects || []).filter(x => x !== 'english');
  const classes = await c.sql`select distinct subject from public.classes where tenant_id=${c.t} and teacher_id=${c.actor.id} and is_active`;
  if (classes.length && classes.every(x => x.subject === 'english')) return { rows: [], total: 0, pairs: 0, notApplicable: true };
  const base = await studentsBase({ sql: c.sql, tenantId: c.t, importV2: c.importV2, viewerId: c.actor.id });
  const data = await writingRates({ base, sql: base.sql, t: c.t, today: base.today, settings: base.settings, importV2: base.load, teacherHome: true });
  if (!data) throw new Error('writing rates unavailable');
  const own = data.teacherHomeRows.find(([name]) => name === c.actor.display_name)?.[1];
  const rows = own?.rows ?? [];
  return { rows, total: rows.length, pairs: own?.pairs ?? 0, notApplicable: !classes.some(x => x.subject !== 'english'), trackedSubjects: tracked.length };
}

export async function teacherParentMessages(c) {
  const gate = await c.importV2('features/owner/classnote-gate.ts');
  if (gate.classnoteReplyMode(c.settings) === 'off') return { hidden: true, rows: [], total: 0 };
  const [rule, policy] = await Promise.all([c.importV2('features/classnote-reply/reply-eligibility-rule.ts'), c.importV2('features/classnote-reply/reply-policy.ts')]);
  const since = new Date(c.clock.at.getTime() - 14 * 86400000).toISOString();
  const msgs = await c.sql`select id::text id, student_id::text student_id, class_name board_name, child_id, content, to_json(posted_at)#>>'{}' posted_at
    from public.classnote_parent_messages where tenant_id=${c.t} and posted_at >= ${since}::timestamptz order by posted_at desc,id desc`;
  if (!msgs.length) return { rows: [], total: 0 };
  const names = unique(msgs.map(m => m.board_name).filter(Boolean));
  const boards = names.length ? await c.sql`select board_name,class_id::text class_id from public.classnote_class_boards where tenant_id=${c.t} and board_name = any(${names}::text[])` : [];
  const boardByName = new Map(names.map(n => [n, boards.filter(b => b.board_name === n).length === 1 ? boards.find(b => b.board_name === n).class_id : null]));
  const boardClassIds = unique([...boardByName.values()].filter(Boolean));
  const members = boardClassIds.length ? await c.sql`select class_id::text class_id, child_id, student_id::text student_id from public.classnote_class_board_members
    where tenant_id=${c.t} and class_id = any(${boardClassIds}::uuid[]) and status='ok'` : [];
  const resolved = msgs.map(m => {
    const classId = boardByName.get(m.board_name) ?? null;
    const matches = classId && m.child_id != null ? members.filter(x => x.class_id === classId && String(x.child_id) === String(m.child_id)) : [];
    return { ...m, classId, studentId: m.student_id || (matches.length === 1 ? matches[0].student_id : null) };
  });
  const studentIds = unique(resolved.map(m => m.studentId).filter(Boolean));
  const enrollments = studentIds.length ? await c.sql`select student_id::text student_id,class_id::text class_id,start_date::text start_date,end_date::text end_date,is_transferred
    from public.enrollments where tenant_id=${c.t} and student_id = any(${studentIds}::uuid[])` : [];
  const classIds = unique([...boardClassIds, ...enrollments.map(e => e.class_id)]);
  const [classes, slots, delegations] = classIds.length ? await Promise.all([
    c.sql`select id::text id,subject,is_active,teacher_id::text teacher_id from public.classes where tenant_id=${c.t} and id = any(${classIds}::uuid[])`,
    c.sql`select class_id::text class_id,day_of_week::text day_of_week,start_time::text start_time,teacher_id::text teacher_id,slot_teacher_label,
      valid_from::text valid_from,valid_to::text valid_to from public.class_schedules where tenant_id=${c.t} and class_id = any(${classIds}::uuid[]) order by id`,
    c.sql`select class_id::text class_id,delegate_user_id::text delegate_user_id,from_date::text from_date,to_date::text to_date,
      to_json(revoked_at)#>>'{}' revoked_at from public.class_delegations where tenant_id=${c.t} and class_id = any(${classIds}::uuid[])
      and revoked_at is null and from_date<=${c.today}::date and to_date>=${c.today}::date`,
  ]) : [[], [], []];
  const people = rule.candidatePeople(classes, slots, delegations);
  const users = people.length ? await c.sql`select id::text id,tenant_id::text tenant_id,status::text status,system_role::text system_role from public.users
    where tenant_id=${c.t} and id = any(${people}::uuid[])` : [];
  const mathKeys = c.settings.operations.subjects.filter(s => s.key === 'math' || s.label?.includes('수학')).map(s => s.key);
  const rows = resolved.flatMap(m => {
    const label = policy.personalBoardSubject(m.board_name ?? '') ?? /^\[([^\]]+)\]/.exec(m.board_name ?? '')?.[1]?.trim() ?? null;
    const board = classes.find(x => x.id === m.classId);
    const keys = label === '영어' ? ['english'] : label === '수학' ? mathKeys : board?.subject ? (mathKeys.includes(board.subject) ? mathKeys : [board.subject]) : [];
    const facts = { classes, slots, delegations, users, keys, tenant: c.t, today: c.today };
    const teachers = m.studentId && keys.length ? rule.studentReplyTeachers({ ...facts, studentId: m.studentId, enrollments: enrollments.filter(e => e.student_id === m.studentId) })
      : !m.studentId && m.classId ? rule.classReplyTeachers({ ...facts, classId: m.classId }) : [];
    return teachers.includes(c.actor.id) ? [{ id: m.id, studentId: m.studentId, boardName: m.board_name, content: String(m.content ?? '').slice(0, 200), postedAt: m.posted_at }] : [];
  });
  return { rows, total: rows.length };
}

async function parentNotifications(c) {
  // 벨의 본인·비보관·미열람 판정을 먼저 그대로 실행한다. 벨 목록은 최대 100건이라
  // 학부모 알림 명단은 같은 판정으로 모두 읽고, 별도 count 없이 그 행 수를 쓴다.
  const [{ results: [bell] }, match] = await Promise.all([
    runV2Server({ actorId: c.actor.id, tenantId: c.t, mode: 'read', steps: [
      { module: 'features/notifications/server/queries.ts', fn: 'getMyNotifications', args: ['active', 100] },
    ] }),
    c.importV2('features/classnote-reply/notification-match.ts'),
  ]);
  if (!Number.isSafeInteger(bell?.value?.unread)) throw new Error('notification bell unavailable');
  const notes = await c.sql`select id::text id, type, title, body, link, to_json(created_at)#>>'{}' created_at
    from public.notifications where tenant_id=${c.t} and recipient_id=${c.actor.id}
      and type = any(${match.PARENT_MESSAGE_NOTIFICATION_TYPES}::text[])
      and read_at is null and archived_at is null order by created_at desc,id desc`;
  if (notes.length > bell.value.unread) throw new Error('notification bell count mismatch');
  const postIds = unique(notes.map(n => match.postIdFromClassnoteLink(n.link)).filter(Number.isInteger));
  const messages = postIds.length ? await c.sql`select m.id::text id, m.source, m.classnote_post_id::text classnote_post_id,
      m.classnote_comment_id::text classnote_comment_id, m.class_name board_name, m.content,
      to_json(m.posted_at)#>>'{}' posted_at, s.name student_name
    from public.classnote_parent_messages m left join public.students s on s.id=m.student_id and s.tenant_id=${c.t}
    where m.tenant_id=${c.t} and m.classnote_post_id = any(${postIds}::bigint[])` : [];
  const candidates = messages.map(m => ({ id: m.id, source: m.source, classnotePostId: Number(m.classnote_post_id),
    classnoteCommentId: m.classnote_comment_id == null ? null : Number(m.classnote_comment_id),
    content: String(m.content ?? ''), postedAt: m.posted_at }));
  const byId = new Map(messages.map(m => [m.id, m]));
  const rows = notes.filter(n => match.isParentMessageNotification(n.type)).map(n => {
    const messageId = match.pickMessageForNotification({ type: n.type, link: n.link, body: n.body, createdAt: n.created_at }, candidates);
    const message = messageId ? byId.get(messageId) : null;
    return { id: n.id, title: n.title, studentName: message?.student_name ?? null, boardName: message?.board_name ?? null,
      content: String(message?.content ?? n.body ?? '').slice(0, 200), createdAt: n.created_at, link: n.link, messageId };
  });
  return { rows, total: rows.length };
}

export const screen = { id: 'teacher-home', label: '선생님 오늘', order: 2,
  params: { actor: UUID, card: /^(?:landing|lessons|attendance|reports|parents)$/ },
  async load(args) {
    const c = await context(args);
    if (!c) return { error: '선생님을 찾지 못했습니다.' };
    const card = args.params.card || 'landing';
    return card === 'landing' ? landing(c) : card === 'lessons' ? lessons(c) : card === 'attendance' ? attendance(c) : card === 'reports' ? reports(c) : parentNotifications(c);
  },
};
