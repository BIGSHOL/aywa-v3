// ECS 오늘 면의 2.0 서버 스트립 두 개: 출석 보드와 내 할 일 집계.
import { randomUUID } from 'node:crypto';
import { copyDay, UUID, DAY } from './v2-ecs-core.mjs';
import { loadRules as loadAttendanceRules, readSettings as readAttendanceSettings, toSplit } from './v2-screen-attendance.mjs';
import { copyClock, loadSeatRules } from './v2-attendance-seat.mjs';
import { loadLiveRules, readLiveBoard, readLiveSlots, readRequestMarks, readTaughtClassSet } from './v2-attendance-live.mjs';
import { audit, serverFn } from './v2-ecs-save.mjs';

const attendanceContext = async (sql, t, importV2) => {
  const [R, S, L] = await Promise.all([loadAttendanceRules(importV2), loadSeatRules(importV2), loadLiveRules(importV2)]);
  return { sql, t, R, S, L, toSplit, settings: await readAttendanceSettings(sql, t, R) };
};

/** TodayAttendanceStrip: getLiveBoard(today, true) + loadRequestMarks, 2.0 groupAdjacentSlots 그대로. */
export async function todayAttendanceStrip(sql, t, viewer, today, importV2) {
  try {
    const ctx = await attendanceContext(sql, t, importV2);
    const [board, marks] = await Promise.all([
      readLiveBoard(ctx, { id: viewer.id, role: viewer.systemRole }, today, true),
      readRequestMarks(sql, t, today, 'attendance_desk_confirm_request').catch(() => new Set()),
    ]);
    if (!board.canEdit) return null;
    const slots = ctx.L.seating.groupAdjacentSlots(board.teachers.flatMap(teacher => teacher.slots))
      .filter(slot => slot.phase !== 'before' && slot.recordedCount < slot.students.length
        && !ctx.R.tlabel.isSpecialSlotLabel(slot.slotTeacherLabel));
    if (!slots.length) return null;
    return { date: board.date, slots: slots.map(slot => ({
      key: slot.key, date: board.date, classId: slot.classId, className: slot.className,
      slotStart: slot.slotStart, saveSlot: slot.saveSlot, periodLabel: slot.periodLabel,
      pendingIds: slot.students.filter(student => student.status == null).map(student => student.studentId),
      pendingStudents: slot.students.filter(student => student.status == null).map(student => ({ name: student.studentName, englishName: student.englishName })),
      deskRequested: marks.has(`${slot.classId}|${slot.saveSlot ?? ''}`),
    })) };
  } catch (e) {
    console.error('ecs.todayAttendanceStrip', e);
    return null;
  }
}

/** MyTasksStrip: staff_task_counts(tenant, selected user), 열린 할 일이 있을 때만. */
export async function myTasksStrip(sql, t, viewer) {
  try {
    const rows = await sql`select user_id::text user_id, open_count, late_count from public.staff_task_counts(${t}::uuid, ${viewer.id}::uuid)`;
    const mine = rows.find(row => row.user_id === viewer.id);
    return Number(mine?.open_count ?? 0) > 0 ? { open: Number(mine.open_count), late: Number(mine.late_count), lang: viewer.lang } : null;
  } catch (e) {
    console.error('ecs.myTasksStrip', e);
    return null;
  }
}

/** StripSlot의 requestDeskConfirm — 같은 권한·명단·중복 bucket·알림·감사 규약. 복사본의 바깥 발송 깨우기는 생략한다. */
export const requestDeskConfirm = serverFn('features/attendance/live/server/actions.ts', 1, async ({ sql, t, user, importV2 }, raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !UUID.test(String(raw.classId ?? '')) || !DAY.test(String(raw.sessionDate ?? '')))
    return { error: '필수 값이 누락되었습니다' };
  if (user.levels.attendance !== 'full' && user.levels.attendance !== 'scoped') return { error: '출결 요청 권한이 없습니다' };
  const { classId, sessionDate } = raw;
  const today = await copyDay();
  if (sessionDate > today) return { error: '아직 지나지 않은 날짜입니다' };
  if (raw.slotStart != null && typeof raw.slotStart !== 'string') return { error: '잘못된 교시입니다' };
  const slot = raw.slotStart?.trim() || null;
  if (slot && !/^\d{2}:\d{2}$/.test(slot)) return { error: '잘못된 교시입니다' };
  const ctx = await attendanceContext(sql, t, importV2);
  if (user.levels.attendance === 'scoped') {
    const taught = await readTaughtClassSet(sql, t, ctx.R, ctx.settings, user.id, sessionDate);
    if (!taught.has(classId)) return { error: '담당 반이 아닙니다' };
  }
  const matched = (await readLiveSlots(ctx, sessionDate, [classId], { excludeTestStudents: true }))
    .filter(s => (s.saveSlot ?? null) === slot && !ctx.R.tlabel.isSpecialSlotLabel(s.slotTeacherLabel));
  if (!matched.length) {
    const withTest = (await readLiveSlots(ctx, sessionDate, [classId])).filter(s => (s.saveSlot ?? null) === slot && !ctx.R.tlabel.isSpecialSlotLabel(s.slotTeacherLabel));
    return { error: withTest.length ? '테스트 학생만 있는 수업이라 데스크에 요청하지 않았습니다' : '요청할 교시를 찾지 못했습니다 — 화면을 새로고침해 주세요' };
  }
  const { hm } = await copyClock(), nowMin = ctx.L.signals.hhmmToMin(hm);
  const slots = matched.filter(s => sessionDate !== today || ctx.L.signals.slotPhase(nowMin, ctx.L.signals.hhmmToMin(s.slotStart), ctx.L.signals.hhmmToMin(s.slotEnd)) !== 'before');
  if (!slots.length) return { error: '아직 시작하지 않은 교시입니다' };
  const pending = new Map();
  for (const s of slots) for (const student of s.students) if (student.status == null && !pending.has(student.studentId)) pending.set(student.studentId, student.studentName);
  if (!pending.size) return { error: '미입력 학생이 없습니다 — 이미 모두 입력됐어요' };
  const recipients = await sql`select id::text id from public.users where tenant_id=${t} and status::text='active' and desk_attendance_optin=true and id<>${user.id}`;
  if (!recipients.length) return { error: '출결 알림을 켠 데스크 직원이 없습니다 — 데스크에 직접 알려 주세요' };
  const [fresh] = await sql`insert into public.notification_events (tenant_id, event_type, subject_key, bucket, seeded)
    values (${t}, 'attendance_desk_confirm_request', ${classId}, ${`${sessionDate}|${slot ?? ''}`}, false)
    on conflict (tenant_id, event_type, subject_key, bucket) do nothing returning bucket`;
  if (!fresh) return { ok: true, sent: false };
  const namesRule = await importV2('features/attendance/live/notify-names.ts');
  const { names } = namesRule.collectStudentNames([...pending.keys()], pending);
  const { listedLabel } = namesRule.formatAttendanceNotifyNames(names.slice(0, 4), pending.size);
  const displayStart = slots.map(s => s.slotStart).sort()[0];
  try {
    await sql.savepoint(async s => {
      for (const recipient of recipients) await s`insert into public.notifications
        (id, tenant_id, recipient_id, type, title, body, link, actor_id)
        values (${randomUUID()}, ${t}, ${recipient.id}, 'attendance_desk_confirm_request',
          ${`데스크 확인 요청 — ${slots[0].className} ${displayStart}`},
          ${`강사가 미입력 ${listedLabel} 학생의 등원 확인을 요청했습니다.`},
          ${sessionDate === today ? '/attendance/live?tab=desk' : `/attendance/live?tab=desk&date=${sessionDate}`}, ${user.id})`;
    });
  } catch (e) { console.error('ecs.requestDeskConfirm.notify', e); }
  await audit(sql, t, user, 'attendance_desk_confirm_request', 'attendance', null, { classId, date: sessionDate,
    ...(slot ? { slotStart: slot } : {}), recipients: recipients.length, pending: pending.size });
  return { ok: true, sent: true };
});
