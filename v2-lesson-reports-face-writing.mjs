// 2.0 화면 · 수업보고서 관리 — '작성률' 면(?tab=writing · ?rmonth=YYYY-MM 월간) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// 2.0 getWeeklyWritingRates(features/report-admin/server/queries.ts)를 Docker 복사본에서 그대로:
//  · 오늘 = 복사본 날짜 · '지금'(오늘 수업 시작·끝 판정) = 복사본을 뜬 시각(2.0 kstMinutesOfDay에 그 시각을 넘긴다).
//  · 시간표 재료 = 2.0 getTodaySchedule(오늘 요일 배치 — 아래 todaySchedule) · getWeeklySchedule(= 시간표 화면 weekSlots, ref=오늘) ·
//    getTeacherLabelsBySubject(아래 labelsBySubject). 계산은 2.0 순수 함수(computeWritingRates · judgeTodayLessonReports ·
//    computeEnglishRates · foldByTeacher · buildHasStudentsOn · buildDelegateAttribution · isReportTrackedSubject · 수강 판정).
//  · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본은 RLS가 없어 모든 조회에 tenant_id를 직접 건다.
//  · 2.0이 삼키는 조회(임시 위임 · 영어 재원 판정)는 sql.soft로 2.0 폴백 값 그대로. 나머지 실패는 2.0처럼 화면 실패.
// · 읽기 전용 · 바깥 호출 없음.
import { loadRules as timetableRules, weekSlots } from './v2-screen-timetable.mjs';

const MODULES = {
  rate: 'features/report-admin/writing-rate.ts', english: 'features/report-admin/english-writing.ts',
  presence: 'features/report-admin/english-class-presence.ts', delegation: 'features/report-admin/writing-rate-delegation.ts',
  today: 'features/dashboard/today-actions.ts', subjects: 'features/dashboard/report-subjects.ts',
  elig: 'features/enrollments/eligibility.ts', label: 'features/timetable/lib/teacher-label.ts', kst: 'lib/date-kst.ts',
};
let modsP = null;
const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)]))
  .then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

// 2.0 queries.ts의 날짜 도우미 — 본문 그대로.
const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayKeyOf = (ymd) => DOW_KEY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const daysBefore = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
const one = (v) => (Array.isArray(v) ? v[0] : v);

/** 2.0 TARGET_ENROLLMENT_COLS 줄 → 2.0 attendsOn(기간 · 휴원 · 반이동 반열림 · 분리등원 요일). */
const attendsOn = (M, e, date) => M.elig.isEnrollmentActiveOn(
  { startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred === true }, date,
) && M.elig.enrollmentAttendsOnDay(e.attendance_days, weekdayKeyOf(date));

/** 2.0 getTodaySchedule() — 작성률이 읽는 칸(classId · subject · teacherName · slotTeacherLabel · startTime · status)만. */
async function todaySchedule(sql, t, M, today, at) {
  const rows = await sql`select s.class_id::text class_id, s.start_time::text start_time, s.end_time::text end_time, s.slot_teacher_label,
      st.display_name slot_teacher_name, c.subject, c.closed_at::text closed_at, ct.display_name class_teacher_name
    from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active
    left join public.users st on st.id = s.teacher_id left join public.users ct on ct.id = c.teacher_id
    where s.tenant_id=${t} and s.day_of_week::text=${weekdayKeyOf(today)} and s.valid_from <= ${today} and (s.valid_to is null or s.valid_to >= ${today})
    order by s.start_time`;
  const toMins = (hms) => { const [h, m] = hms.split(':'); return Number(h) * 60 + Number(m); };
  const now = M.kst.kstMinutesOfDay(at);
  return rows.filter((r) => !r.closed_at || r.closed_at >= today).map((r) => {
    const slotTeacher = r.slot_teacher_name ? { display_name: r.slot_teacher_name } : null;
    return { classId: r.class_id, subject: r.subject ?? '?', startTime: r.start_time, endTime: r.end_time,
      teacherName: M.label.resolveSlotTeacherLabel(r.slot_teacher_label, slotTeacher) ?? r.class_teacher_name ?? null,
      slotTeacherLabel: M.label.resolveSlotTeacherLabel(r.slot_teacher_label, slotTeacher) };
  }).sort((a, b) => toMins(a.startTime) - toMins(b.startTime)).map((s) => {
    const start = toMins(s.startTime), end = toMins(s.endTime);
    return { ...s, status: now >= end ? 'done' : now >= start ? 'ongoing' : 'upcoming' };
  });
}

/** 2.0 getTeacherLabelsBySubject() — 활성 반 배치의 강사 라벨(교시 담당 → 반 담임)을 과목별로 · 가나다순. 보고서 설정 면도 이것을 쓴다. M = { label: teacher-label.ts }. */
export async function labelsBySubject(sql, t, M) {
  const [nameRows, rows] = await Promise.all([
    sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`,
    sql`select s.slot_teacher_label, st.display_name slot_teacher_name, c.subject, ct.display_name class_teacher_name
      from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active
      left join public.users st on st.id = s.teacher_id left join public.users ct on ct.id = c.teacher_id where s.tenant_id=${t}`,
  ]);
  const labelMap = M.label.buildTeacherLabelMap(nameRows.map((u) => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' })));
  const by = new Map();
  for (const r of rows) {
    if (!r.subject) continue;
    const label = M.label.resolveSlotTeacherLabel(r.slot_teacher_label, r.slot_teacher_name ? { display_name: r.slot_teacher_name } : null, labelMap)
      ?? M.label.resolveTeacherLabel(r.class_teacher_name ?? null, labelMap);
    if (!label) continue;
    (by.get(r.subject) ?? by.set(r.subject, new Set()).get(r.subject)).add(label);
  }
  return Object.fromEntries([...by].map(([s, set]) => [s, [...set].sort((a, b) => a.localeCompare(b, 'ko'))]));
}

/** 2.0 fetchDelegateAttribution — 조회 실패는 빈 귀속(2.0은 `data ?? []`). */
async function delegateAttribution(sql, t, M, since, until) {
  const rows = await sql.soft((sp) => sp`select d.class_id::text class_id, d.from_date::text from_date, d.to_date::text to_date,
      coalesce(trim(u.display_name), '') teacher_name
    from public.class_delegations d left join public.users u on u.id = d.delegate_user_id and u.tenant_id = d.tenant_id
    where d.tenant_id=${t} and d.revoked_at is null and d.from_date <= ${until} and d.to_date >= ${since} limit 500`, []);
  return M.delegation.buildDelegateAttribution(rows.map((r) => ({ classId: r.class_id, teacherName: r.teacher_name, fromDate: r.from_date, toDate: r.to_date })));
}

/** 2.0 getEnglishTeacherRates — ClassNote 반 보드 게시로 재는 영어 강사 행(일간 칸 · 오늘 칸은 비운다). */
async function englishRates(ctx, M, since, until, dates) {
  const { sql, t, today, settings, classnoteOn } = ctx;
  if (!classnoteOn) return [];
  const [classRows, schedRows] = await Promise.all([
    sql`select c.id::text id, c.class_name, u.display_name teacher from public.classes c left join public.users u on u.id = c.teacher_id
      where c.tenant_id=${t} and c.subject='english' and c.is_active and c.report_optout = false`,
    sql`select s.class_id::text class_id, s.day_of_week::text day_of_week, s.valid_from::text valid_from, s.valid_to::text valid_to
      from public.class_schedules s join public.classes c on c.id = s.class_id
      where s.tenant_id=${t} and c.subject='english' and c.is_active and c.report_optout = false`,
  ]);
  if (!classRows.length) return [];
  const classes = classRows.map((c) => ({ classId: c.id, className: c.class_name, teacher: c.teacher ?? null,
    dows: [...new Set(schedRows.filter((s) => s.class_id === c.id && (!s.valid_to || s.valid_to >= today) && (!s.valid_from || s.valid_from <= today)).map((s) => s.day_of_week))] }));
  const ids = classes.map((c) => c.classId);
  const [posts, enrollmentRows] = await Promise.all([
    sql`select board_name, posted_on::text posted_on from public.classnote_class_posts where tenant_id=${t} and posted_on >= ${since} and posted_on <= ${until}
      order by board_name, posted_on`,
    sql.soft((sp) => sp`select e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days
      from public.enrollments e join public.students st on st.id = e.student_id and st.is_test = false
      where e.tenant_id=${t} and e.class_id = any(${ids}::uuid[]) and (e.start_date is null or e.start_date <= ${until}) and (e.end_date is null or e.end_date >= ${since})`, null),
  ]);
  const lastCounted = until < today ? until : daysBefore(today, 1);
  const rows = M.english.computeEnglishRates(classes, posts.map((p) => ({ boardName: p.board_name, postedOn: String(p.posted_on).slice(0, 10) })), {
    from: since, to: lastCounted, holidays: settings.operations.holidays.map((h) => h.date),
    hasStudentsOn: enrollmentRows ? M.presence.buildHasStudentsOn(enrollmentRows) : undefined,
  });
  return M.english.foldByTeacher(rows).map((r) => ({
    teacher: r.teacher, daily: dates.map((date) => ({ date, count: 0, target: null, written: 0, rate: null })),
    weekWritten: r.written, weekTarget: r.sessions, weekRate: r.rate,
    todayTarget: 0, todayWritten: 0, todayMissing: [], todayRate: null, todayPending: null, subjects: ['english'], source: 'classnote',
  }));
}

/** 2.0 getWeeklyWritingRates(month) — 본문 차례 그대로. */
export async function writingRates(ctx, month) {
  const { sql, t, today, settings, base } = ctx;
  const M = await mods(ctx.importV2);
  const isMonth = !!month && /^\d{4}-\d{2}$/.test(month);
  const monday = daysBefore(today, (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7);
  const dates = isMonth ? monthDates(month) : Array.from({ length: 7 }, (_, i) => daysBefore(monday, -i));
  if (dates.length === 0) return null;
  const since = dates[0], until = dates[dates.length - 1];
  const range = { kind: isMonth ? 'month' : 'week', month: (month ?? today).slice(0, 7) };
  const includesToday = today >= since && today <= until;
  const testStudentIds = new Set((await sql`select id::text id from public.students where tenant_id=${t} and is_test`).map((s) => s.id));

  const TR = await timetableRules(ctx.importV2);
  const [reps, schedule, { slots: weekly }, labels, inactiveStaff, delegateOn, optoutRows] = await Promise.all([
    sql`select teacher_name, report_date::text report_date, covers_date::text covers_date, student_id::text student_id, class_id::text class_id
      from public.lesson_reports where tenant_id=${t}
        and ((report_date >= ${since} and report_date <= ${until}) or (covers_date >= ${since} and covers_date <= ${until})) order by report_date, id`,
    includesToday ? todaySchedule(sql, t, M, today, base.clock.at) : [],
    weekSlots(sql, t, TR, today, today),
    labelsBySubject(sql, t, M),
    sql`select display_name from public.users where tenant_id=${t} and status::text='inactive'`,
    delegateAttribution(sql, t, M, since, until),
    sql`select id::text id from public.classes where tenant_id=${t} and report_optout limit 500`,
  ]);
  const reportOptoutIds = new Set(optoutRows.map((r) => r.id));
  const exempt = new Set(settings.report.writingExemptTeachers);
  for (const u of inactiveStaff) { const name = u.display_name?.trim(); if (name) exempt.add(name); }
  const CLASSNOTE_MEASURED = new Set(['english']);
  const trackedSubjects = settings.report.classnoteSubjects ?? null;
  const measuredHere = (subject) => !CLASSNOTE_MEASURED.has(String(subject ?? '')) && M.subjects.isReportTrackedSubject(subject ?? null, trackedSubjects);
  const countedHere = (s) => measuredHere(s.subject) && !reportOptoutIds.has(s.classId);

  const repsCounted = reps.filter((r) => !r.class_id || !reportOptoutIds.has(r.class_id));
  const reports = repsCounted.map((r) => ({ teacher: r.teacher_name ?? '(미지정)', date: r.report_date, studentId: r.student_id }))
    .filter((r) => r.date >= since && r.date <= until).filter((r) => !exempt.has(r.teacher)).filter((r) => !testStudentIds.has(r.studentId));
  const dischargeKey = (studentId, date, teacher) => `${studentId}|${date}|${teacher}`;
  const discharged = new Set(repsCounted.filter((r) => r.covers_date).map((r) => dischargeKey(r.student_id, r.covers_date, r.teacher_name ?? '(미지정)')));

  // 오늘 시작된 반 → 강사(위임 → 반 담당 → 교시 강사 라벨).
  const teacherOfClass = new Map(), subjectOfClass = new Map();
  for (const s of schedule.filter((x) => x.status !== 'upcoming' && countedHere(x))) {
    const who = delegateOn(s.classId, today) ?? s.teacherName ?? s.slotTeacherLabel ?? '(미지정)';
    if (exempt.has(who)) continue;
    teacherOfClass.set(s.classId, who);
    if (s.subject) subjectOfClass.set(s.classId, s.subject);
  }
  const classIds = [...teacherOfClass.keys()];
  const pendingByTeacher = new Map();
  for (const s of schedule) {
    if (s.status !== 'upcoming' || !countedHere(s)) continue;
    const who = delegateOn(s.classId, today) ?? s.teacherName ?? s.slotTeacherLabel ?? '(미지정)';
    if (exempt.has(who)) continue;
    const cur = pendingByTeacher.get(who), start = s.startTime.slice(0, 5);
    pendingByTeacher.set(who, cur ? { classes: cur.classes + 1, firstStart: start < cur.firstStart ? start : cur.firstStart } : { classes: 1, firstStart: start });
  }
  const todayPendings = [...pendingByTeacher].map(([teacher, v]) => ({ teacher, ...v }));

  let todayTargets = [];
  if (classIds.length > 0) {
    const enr = (await sql`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days from public.enrollments e where e.tenant_id=${t} and e.class_id = any(${classIds}::uuid[])
        and e.start_date <= ${today} and (e.end_date is null or e.end_date >= ${today}) order by e.id`).filter((e) => attendsOn(M, e, today));
    const studentsByTeacher = new Map();
    for (const e of enr) {
      const who = teacherOfClass.get(e.class_id);
      if (!who || testStudentIds.has(e.student_id)) continue;
      (studentsByTeacher.get(who) ?? studentsByTeacher.set(who, new Set()).get(who)).add(e.student_id);
    }
    const allStudentIds = [...new Set(enr.map((e) => e.student_id))];
    const [attRows, todayRepRows, nameRows] = await Promise.all([
      sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start,
          status::text status, recorded_at from public.attendance_records where tenant_id=${t} and session_date=${today} and student_id = any(${allStudentIds}::uuid[])`,
      sql`select student_id::text student_id, subject, report_date::text report_date, covers_date::text covers_date, class_id::text class_id
        from public.lesson_reports where tenant_id=${t} and (report_date=${today} or covers_date=${today}) and student_id = any(${allStudentIds}::uuid[])`,
      sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${allStudentIds}::uuid[])`,
    ]);
    const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
    const judged = M.today.judgeTodayLessonReports(
      enr.filter((e) => teacherOfClass.has(e.class_id) && !testStudentIds.has(e.student_id))
        .map((e) => ({ studentId: e.student_id, classId: e.class_id, subject: subjectOfClass.get(e.class_id) ?? '' })),
      M.today.absentClassKeysOf(attRows.map((a) => ({ ...a, recorded_at: new Date(a.recorded_at).toISOString() }))),
      todayRepRows.filter((r) => !r.class_id || !reportOptoutIds.has(r.class_id)).map((r) => ({
        studentId: r.student_id, subject: r.subject, reportDate: r.report_date.slice(0, 10), coversDate: r.covers_date ? r.covers_date.slice(0, 10) : null })),
      today,
    );
    todayTargets = [...studentsByTeacher.keys()].map((teacher) => {
      const mine = (p) => p.classIds.some((c) => teacherOfClass.get(c) === teacher);
      const due = [...new Set(judged.due.filter(mine).map((p) => p.studentId))];
      const missingIds = [...new Set(judged.missing.filter(mine).map((p) => p.studentId))];
      return { teacher, target: due.length, written: due.length - missingIds.length, missing: missingIds.map((id) => nameById.get(id) ?? '(학생)').slice(0, 20) };
    });
  }

  // 과거일(범위 안 오늘 전) 강사×날짜 대상.
  const pastDates = dates.filter((d) => d < today);
  const dailyTargets = [];
  if (pastDates.length > 0) {
    const teacherOfClassByDate = new Map(), weekClassIds = new Set();
    for (const d of pastDates) {
      const key = weekdayKeyOf(d), m = new Map();
      for (const s of weekly) {
        if (s.dayOfWeek !== key || !countedHere(s)) continue;
        const who = delegateOn(s.classId, d) ?? s.teacherName ?? s.slotTeacherLabel ?? '(미지정)';
        if (exempt.has(who)) continue;
        m.set(s.classId, who);
        weekClassIds.add(s.classId);
      }
      teacherOfClassByDate.set(d, m);
    }
    if (weekClassIds.size > 0) {
      const first = pastDates[0], last = pastDates[pastDates.length - 1];
      const wenr = await sql`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days from public.enrollments e where e.tenant_id=${t} and e.class_id = any(${[...weekClassIds]}::uuid[])
        and e.start_date <= ${last} and (e.end_date is null or e.end_date >= ${first}) order by e.id`;
      const enrollmentsByClass = new Map(), weekStudentIds = new Set();
      for (const e of wenr) { (enrollmentsByClass.get(e.class_id) ?? enrollmentsByClass.set(e.class_id, []).get(e.class_id)).push(e); weekStudentIds.add(e.student_id); }
      const absRows = weekStudentIds.size ? await sql`select student_id::text student_id, session_date::text session_date from public.attendance_records
          where tenant_id=${t} and status::text='absent' and session_date >= ${first} and session_date <= ${last} and student_id = any(${[...weekStudentIds]}::uuid[])` : [];
      const absentByDate = new Map();
      for (const a of absRows) (absentByDate.get(a.session_date) ?? absentByDate.set(a.session_date, new Set()).get(a.session_date)).add(a.student_id);
      for (const d of pastDates) {
        const absent = absentByDate.get(d) ?? new Set(), studentsByTeacher = new Map();
        for (const [classId, teacher] of teacherOfClassByDate.get(d)) {
          const rows = enrollmentsByClass.get(classId);
          if (!rows) continue;
          const ts = studentsByTeacher.get(teacher) ?? studentsByTeacher.set(teacher, new Set()).get(teacher);
          for (const e of rows) if (attendsOn(M, e, d) && !testStudentIds.has(e.student_id)) ts.add(e.student_id);
        }
        for (const [teacher, ids] of studentsByTeacher)
          dailyTargets.push({ teacher, date: d, target: [...ids].filter((id) => !absent.has(id) && !discharged.has(dischargeKey(id, d, teacher))).length });
      }
    }
  }

  const subjectsOfTeacher = new Map();
  for (const [subj, names] of Object.entries(labels)) for (const n of names) (subjectsOfTeacher.get(n) ?? subjectsOfTeacher.set(n, new Set()).get(n)).add(subj);
  const rates = M.rate.computeWritingRates(dates, reports, todayTargets, dailyTargets, today, todayPendings, settings.operations.holidays)
    .map((r) => ({ ...r, subjects: [...(subjectsOfTeacher.get(r.teacher) ?? [])], source: 'aywa' }));
  const english = await englishRates(ctx, M, since, until, dates);
  return { dates, rates: [...rates, ...english], range };
}

/** 면 모듈 계약 — page.tsx: `getWeeklyWritingRates(/^\d{4}-\d{2}$/.test(sp.rmonth ?? "") ? sp.rmonth : undefined).then((rates) => ({ rates }))`. */
export async function loadFace(ctx) {
  const month = /^\d{4}-\d{2}$/.test(ctx.sp.rmonth ?? '') ? ctx.sp.rmonth : undefined;
  return { tabData: { rates: await writingRates(ctx, month) } };
}
