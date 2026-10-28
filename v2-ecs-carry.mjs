// 2.0 carrySelfStudyMarks의 IO. 판정과 패치 계산은 원본 순수 함수를 쓴다.
import { isoAt } from './v2-ecs-core.mjs';

const NOTHING = form => ({ form, patches: [], pending: false, error: null });
const missingColumn = e => e?.code === '42703' || e?.code === 'PGRST204'
  || (/listening_level|memorized_words/.test(String(e?.message ?? '')) && /column|schema cache/i.test(String(e?.message ?? '')));

export async function carrySelfStudyMarks(sql, t, R, user, classId, planDate, slotStart) {
  let form = 'default';
  try {
    // 계획 복사 RPC가 성공한 뒤에도 이어받기 실패가 계획을 취소하지 않게 저장점으로 격리한다.
    return await sql.savepoint(async s => {
      const schedules = await s`select start_time::text start_time, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
        from public.class_schedules where tenant_id=${t} and class_id=${classId} and day_of_week::text=${R.dowKeyOf(planDate)}`;
      const live = schedules.filter(row => row.start_time.slice(0, 5) === slotStart
        && (!row.valid_from || row.valid_from.slice(0, 10) <= planDate)
        && (!row.valid_to || row.valid_to.slice(0, 10) >= planDate));
      if (live.length === 0) return NOTHING(form);
      form = live.every(row => R.rosterFormOf(row.slot_teacher_label) === 'selfStudy') ? 'selfStudy' : 'default';
      if (form !== 'selfStudy') return NOTHING(form);

      const [enrollments, attendanceRows, pastRows, targetRows] = await Promise.all([
        s`select e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date,
          e.on_hold, e.is_transferred, e.attendance_days, st.withdrawn_at::text withdrawn_at
          from public.enrollments e join public.students st on st.id=e.student_id and st.tenant_id=e.tenant_id
          where e.tenant_id=${t} and e.class_id=${classId}`,
        s`select * from public.attendance_records where tenant_id=${t} and class_id=${classId} and session_date=${planDate} order by id`,
        s`select student_id::text student_id, mark_date::text mark_date, slot_start::text slot_start, listening_level, memorized_words
          from public.class_sheet_student_marks where tenant_id=${t} and class_id=${classId}
            and mark_date >= ${R.shiftDays(planDate, -56)} and mark_date < ${planDate}
            and (listening_level is not null or memorized_words is not null)
          order by mark_date desc limit 1000`,
        s`select student_id::text student_id, listening_level, memorized_words
          from public.class_sheet_student_marks where tenant_id=${t} and class_id=${classId}
            and mark_date=${planDate} and slot_start=${slotStart}`,
      ]);
      const dow = R.dowKeyOf(planDate);
      const eligible = enrollments.filter(e => !(e.withdrawn_at && e.withdrawn_at.slice(0, 10) < planDate)
        && R.isEnrollmentActiveOn({ startDate: e.start_date.slice(0, 10), endDate: e.end_date?.slice(0, 10) ?? null,
          onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined }, planDate)
        && R.enrollmentAttendsOnDay(e.attendance_days, dow)).map(e => e.student_id);
      const attendance = R.effectiveAttendanceRecords(attendanceRows.map(row => ({ ...row, recorded_at: isoAt(row.recorded_at) })))
        .map(row => ({ studentId: String(row.student_id), slotStart: row.slot_start ? String(row.slot_start).slice(0, 5) : null, status: String(row.status ?? '') }));
      const roster = R.carryRoster({ eligible, attendance, slotStart });
      if (roster.length === 0) return NOTHING(form);
      const patches = R.planCarryMarks({ roster,
        past: pastRows.map(row => ({ studentId: row.student_id, markDate: row.mark_date.slice(0, 10), slotStart: row.slot_start?.slice(0, 5) ?? null,
          listeningLevel: row.listening_level, memorizedWords: row.memorized_words })),
        target: targetRows.map(row => ({ studentId: row.student_id, listeningLevel: row.listening_level, memorizedWords: row.memorized_words })) });
      if (patches.length === 0) return NOTHING(form);
      for (const p of patches) await s`insert into public.class_sheet_student_marks
        (tenant_id, class_id, student_id, mark_date, slot_start, listening_level, memorized_words, updated_by, updated_at)
        values (${t}, ${classId}, ${p.studentId}, ${planDate}, ${slotStart}, ${p.listeningLevel}, ${p.memorizedWords}, ${user.id}, now())
        on conflict (tenant_id, class_id, student_id, mark_date, slot_start) do update
          set listening_level=excluded.listening_level, memorized_words=excluded.memorized_words,
              updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
      return { form, patches, pending: false, error: null };
    });
  } catch (e) {
    if (missingColumn(e)) return { form, patches: [], pending: true, error: null };
    console.error('ecs.carrySelfStudyMarks', e);
    return { form, patches: [], pending: false, error: '듣기 레벨·누적 암기 단어수는 채우지 못했습니다(잠시 후 다시 시도해 주세요)' };
  }
}
