// 2.0 화면 · 출석부 — 오늘 출결(`/attendance/live`) 저장. v2-screen-attendance.mjs의 actions가 부른다(이름 = 2.0 export 이름).
// 2.0 features/attendance/live/server/의 "use server" 함수를 같은 입력·같은 표·칸·감사로그로 복사본에:
//   actions.ts       recordFollowup(attendance_followups upsert — 데스크 확인 기록 · attendance_followup) ·
//                    requestAttendanceInput(notification_events dedup + 강사 벨 notifications 행 · attendance_input_request)
//   prefs-actions.ts saveLiveSubjectFilter(users.ui_prefs.attendanceLive.subject — 감사로그 없음, 2.0과 같다)
// 출결(attendance_records)은 여기서 바꾸지 않는다(2.0과 같다 — '출석으로 정정'은 setAttendanceCell 게이트를 따로 지난다).
// 벨은 2.0이 남기는 행(notifications)까지만 — 웹 푸시·슬랙 발송은 없다(복사본에서는 그 행이 3.0 알림에만 보인다).
// 감사로그 metadata.via = '3.0 연습 복사본'(공통 규약). requestDeskConfirm(강사 → 데스크)은 강사 홈 스트립의 것이라 이 화면 범위가 아니다.
import { randomUUID } from 'node:crypto';
import { copyClock } from './v2-attendance-seat.mjs';
import { attendanceWritersOf, teachingClassIds } from './v2-attendance-live.mjs';

const VIA = '3.0 연습 복사본';
const STATES = ['open', 'resolved', 'dismissed'], OUTCOMES = ['coming', 'absent_today', 'sick', 'already_here', 'no_answer', 'other'];
const VIAS = ['phone', 'kakao', 'in_person', 'other'], SIGNALS = ['absent', 'unmarked'];
const audit = (sql, t, actor, action, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, 'attendance', null, ${sql.json({ ...metadata, via: VIA })})`;
const writerOf = async (c, id) => (await attendanceWritersOf(c.sql, c.t, c.R, c.settings)).find(w => w.id === id) ?? null;

/** 2.0 `recordFollowup(input)` — 데스크 확인 기록. 강사(담당 반만)는 담당 반(담임 ∪ 위임 ∪ JJ 담당) 학생만. */
export async function recordFollowup(c, input) {
  const actor = await writerOf(c, c.actorId);
  if (!actor) return { error: '출결 확인 권한이 없습니다' };
  const { studentId, classId, sessionDate } = input;
  if (!studentId || !classId) return { error: '필수 값이 누락되었습니다' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate ?? '')) return { error: '잘못된 날짜입니다' };
  const { day: today } = await copyClock();
  if (!input.allowFuture && sessionDate > today) return { error: '아직 지나지 않은 날짜입니다' };
  if (!SIGNALS.includes(input.signal)) return { error: '잘못된 신호입니다' };
  if (!STATES.includes(input.state)) return { error: '잘못된 상태입니다' };
  const outcome = input.outcome?.trim() || null;
  if (outcome && !OUTCOMES.includes(outcome)) return { error: '잘못된 결과입니다' };
  const via = input.contactedVia?.trim() || null;
  if (via && !VIAS.includes(via)) return { error: '잘못된 연락 방법입니다' };
  const note = input.note?.trim() || null, slot = input.slotStart?.trim() || null;
  if (slot && !/^\d{2}:\d{2}$/.test(slot)) return { error: '잘못된 교시입니다' };
  const settled = input.state === 'resolved' || input.state === 'dismissed';
  if (actor.level === 'scoped' && !(await teachingClassIds(c.sql, c.t, c.R, c.settings, actor.id, sessionDate)).includes(classId)) return { error: '담당 반이 아닙니다' };
  const now = new Date().toISOString();
  const row = { tenant_id: c.t, student_id: studentId, class_id: classId, session_date: sessionDate, slot_start: slot, signal: input.signal, state: input.state, outcome, note,
    contacted_via: via, handled_by: settled ? actor.id : null, handled_at: settled ? now : null, created_by: actor.id, updated_at: now };
  // 0210a `nulls not distinct` 유니크와 짝 — 같은 칸 두 번째 저장은 갱신(2.0 upsert는 보낸 칸을 모두 덮는다).
  const [saved] = await c.sql`insert into public.attendance_followups ${c.sql(row)}
    on conflict (tenant_id, student_id, session_date, slot_start) do update set class_id=excluded.class_id, signal=excluded.signal, state=excluded.state, outcome=excluded.outcome,
      note=excluded.note, contacted_via=excluded.contacted_via, handled_by=excluded.handled_by, handled_at=excluded.handled_at, created_by=excluded.created_by, updated_at=excluded.updated_at
    returning id::text id`;
  // 사유 원문(note)·결과(outcome — 건강 정보일 수 있다)는 싣지 않는다(2.0과 같다).
  await audit(c.sql, c.t, actor, 'attendance_followup', { studentId, classId, date: sessionDate, ...(slot ? { slotStart: slot } : {}), signal: input.signal, state: input.state,
    ...(via ? { contactedVia: via } : {}), hasNote: note !== null });
  return { ok: true, id: saved?.id ?? '' };
}

/** 2.0 `requestAttendanceInput(input)` — 레인 A: 강사에게 '출결 입력' 요청(그날 그 교시 담당 ∪ 담임 ∪ 그날 위임 대체 강사). 관리 권한(전체)만. */
export async function requestAttendanceInput(c, input) {
  const actor = await writerOf(c, c.actorId);
  if (!actor || actor.level !== 'full') return { error: '출결 요청 권한이 없습니다' };
  const { classId, sessionDate } = input;
  if (!classId || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate ?? '')) return { error: '필수 값이 누락되었습니다' };
  const { day: today } = await copyClock();
  if (sessionDate > today) return { error: '아직 지나지 않은 날짜입니다' };
  const slot = input.slotStart?.trim() || null;
  if (slot && !/^\d{2}:\d{2}$/.test(slot)) return { error: '잘못된 교시입니다' };
  const dow = c.R.axis.axisDowOf(sessionDate);
  if (!dow) return { error: '필수 값이 누락되었습니다' };
  const [[klass], slots, delegations] = await Promise.all([
    c.sql`select id::text id, class_name, teacher_id::text teacher_id from public.classes where tenant_id=${c.t} and id=${classId}`,
    c.sql`select day_of_week::text day_of_week, start_time::text start_time, teacher_id::text teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${c.t} and class_id=${classId} and day_of_week::text=${dow} and valid_from<=${sessionDate} and (valid_to is null or valid_to>=${sessionDate})`,
    c.sql`select id::text id, class_id::text class_id, delegate_user_id::text delegate_user_id, from_date::text from_date, to_date::text to_date, revoked_at
      from public.class_delegations where tenant_id=${c.t} and class_id=${classId} and revoked_at is null and from_date<=${sessionDate} and to_date>=${sessionDate} order by id`,
  ]);
  const recipients = c.R.axis.attendanceNoticeRecipients({ homeroomTeacherId: klass?.teacher_id ?? null, slots: slots.map(c.R.axis.axisSlotFromRow), date: sessionDate, slotStart: slot,
    delegations: delegations.map(r => ({ id: r.id, classId: r.class_id, delegateUserId: r.delegate_user_id, fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at })), excludeId: actor.id });
  if (recipients.length === 0) return { error: '이 반에 연결된 강사가 없습니다 — 직접 확인해 주세요' };
  const fresh = await c.sql`insert into public.notification_events (tenant_id, event_type, subject_key, bucket, seeded) values (${c.t}, 'attendance_input_request', ${classId}, ${`${sessionDate}|${slot ?? ''}`}, false)
    on conflict (tenant_id, event_type, subject_key, bucket) do nothing returning bucket`;
  if (!fresh.length) return { ok: true, sent: false };
  // 2.0 `notifyUsers` — 벨 행(내 행동은 나에게 알리지 않는다). 밖으로 나가는 발송은 없다.
  const rows = recipients.filter(id => id !== actor.id).map(recipientId => ({ id: randomUUID(), tenant_id: c.t, recipient_id: recipientId, type: 'attendance_input_request',
    title: `출결 입력 요청 — ${klass?.class_name ?? '수업'}${slot ? ` ${slot}` : ''}`, body: "데스크에서 오늘 출결 입력을 요청했습니다. 화면 위 '오늘 출석 미입력'에서 바로 찍을 수 있습니다.",
    link: sessionDate === today ? '/attendance/live' : `/attendance/live?date=${sessionDate}`, actor_id: actor.id }));
  if (rows.length) await c.sql`insert into public.notifications ${c.sql(rows)}`;
  await audit(c.sql, c.t, actor, 'attendance_input_request', { classId, date: sessionDate, ...(slot ? { slotStart: slot } : {}), recipients: recipients.length, recipientIds: recipients });
  return { ok: true, sent: true };
}

/** 2.0 `saveLiveSubjectFilter(subject)` — 그 사람의 users.ui_prefs.attendanceLive만(다른 화면 설정은 그대로). 2.0은 로그인한 누구나 — 3.0은 띠에서 고른 출결 권한 직원. */
export async function saveLiveSubjectFilter(c, subject) {
  const actor = await writerOf(c, c.actorId);
  if (!actor) return { ok: false, error: '로그인이 필요합니다' };
  const [row] = await c.sql`select ui_prefs from public.users where tenant_id=${c.t} and id=${actor.id}`;
  const raw = row?.ui_prefs && typeof row.ui_prefs === 'object' && !Array.isArray(row.ui_prefs) ? row.ui_prefs : {};
  const next = { ...c.L.viewPrefs.parseLiveViewPrefs(raw.attendanceLive), subject: c.L.viewPrefs.parseSubjectFilter(subject) };
  await c.sql`update public.users set ui_prefs=${c.sql.json({ ...raw, attendanceLive: next })} where tenant_id=${c.t} and id=${actor.id}`;
  return { ok: true };
}
