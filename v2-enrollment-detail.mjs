// 2.0 신규 콜&상담 · 상세(app/(shell)/enrollment/[id]/page.tsx)와 수정([id]/edit/page.tsx)이 서버에서 받던 값 — Docker 복사본에서 같은 결과로.
// · getEnrollmentConsultationById(상담 행 + 최근 AI 분석 1건 + 녹음 행 + 추천 반 + 배정 반 수) · getSiblingConsultations(same-person-query.ts) ·
//   loadConsultationReferrer · referrerCandidatesFor(referrer-queries.ts) · getAssignedClasses(assigned-classes.ts — 교시 이력은 2.0 slotPhase로 지금 것만) ·
//   getClassesList({active}) 중 변환 창이 쓰는 칸 · findMergeSuccessor(병합 감사로그) · canViewClassDetail(담임·교시 담당).
// · 행은 PostgREST와 같은 JSON(to_json — timestamptz = ISO+오프셋 · numeric = 수 · jsonb = 값). 판정은 2.0 순수 함수(importV2).
// · 2.0은 사용자 클라이언트 RLS(지점 줄만)로 읽는다 — 여기선 tenant_id를 직접 건다. 읽기 전용 · 바깥 호출 없음.

const MODULES = { kst: 'lib/date-kst.ts', subj: 'features/enrollment/consult-subject.ts', person: 'features/enrollment/same-person.ts',
  board: 'features/enrollment/board-stages.ts', ref: 'features/enrollment/referrer.ts', maps: 'features/owner/subjects.ts',
  periods: 'features/timetable/lib/periods.ts', groups: 'features/classes/schedule-periods.ts', phase: 'features/classes/schedule-summary.ts',
  grade: 'lib/format/school-grade.ts' };
let rulesP = null;
export function detailRules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

const isPrepBriefRecord = (v) => !!v && typeof v === 'object' && v.version === 1 && !!v.brief && typeof v.brief === 'object' && !!v.facts;
const s = (v) => (v == null ? null : String(v));

/** 상담 과목 → 볼 반 과목 키(assigned-classes.ts classKeysFor). */
const classKeysFor = (D, subject, subjects) => (subject?.trim() ? D.subj.consultClassKeys(subject, subjects) : null);

/** countAssignedClasses — 상담 과목 기준 미종료 수강 수(반 행이 있는 것만 · class!inner). */
export async function countAssignedClasses(sql, D, t, studentId, subject, subjects) {
  if (!studentId) return 0;
  const keys = classKeysFor(D, subject, subjects);
  if (keys?.length === 0) return 0;
  const [{ n }] = await sql`select count(*)::int n from public.enrollments e join public.classes k on k.id = e.class_id and k.tenant_id = ${t}
    where e.tenant_id = ${t} and e.student_id = ${studentId} and (e.end_date is null or e.end_date >= ${D.kst.kstToday()}::date)
    ${keys ? sql`and k.subject = any(${[...keys]})` : sql``}`;
  return n;
}

/** getEnrollmentConsultationById — 없으면 null. */
export async function getEnrollmentConsultationById(sql, D, t, id, subjects) {
  const [row] = await sql`select to_json(c) j, u.display_name consultant_name from public.enrollment_consultations c left join public.users u on u.id = c.consultant_id
    where c.tenant_id = ${t} and c.id = ${id}`;
  if (!row) return null;
  const c = row.j;
  const [aiList, recRows] = await Promise.all([
    sql`select to_json(a) j from public.consultation_ai_analysis a where a.consultation_id = ${id} order by a.generated_at desc limit 1`,
    sql`select to_json(r) j, u.display_name recorded_by_name from public.consultation_recordings r left join public.users u on u.id = r.recorded_by
      where r.consultation_id = ${id} order by r.created_at asc`,
  ]);
  const ai = aiList[0]?.j ?? null;
  const recordings = recRows.map(({ j: r, recorded_by_name }) => ({
    id: r.id, createdAt: r.created_at, sizeBytes: r.audio_size_bytes, durationSec: r.audio_duration_sec, status: r.processing_status, error: r.processing_error,
    transcription: r.transcription, speakerLabels: Array.isArray(r.speaker_labels) ? r.speaker_labels : null, recordedByName: recorded_by_name ?? null,
  }));
  const recommendedIds = Array.isArray(ai?.recommended_class_ids) ? ai.recommended_class_ids : [];
  const recommendedClasses = recommendedIds.length
    ? (await sql`select id::text id, class_name, subject from public.classes where tenant_id = ${t} and id = any(${recommendedIds}::uuid[])`).map((r) => ({ id: r.id, className: r.class_name, subject: r.subject }))
    : [];
  const studentId = c.student_id ?? null;
  const assignedClassCount = await countAssignedClasses(sql, D, t, studentId, c.subject ?? null, subjects);
  const pp = ai?.print_payload && typeof ai.print_payload === 'object' ? ai.print_payload : null;
  return {
    id: c.id, prospectName: c.prospect_name, prospectGrade: c.prospect_grade, prospectSchool: c.prospect_school, parentName: c.parent_name, parentPhone: c.parent_phone,
    parentRequest: c.parent_request, learningHistory: c.learning_history ?? null, consultantName: row.consultant_name ?? null, counselorText: c.counselor?.trim() || null,
    outcome: c.outcome, consultedAt: c.consulted_at, hasAiAnalysis: ai !== null, processingStatus: c.processing_status, hasAudio: !!c.audio_path,
    fromPublicIntake: !!c.from_public_intake, syncAddedAt: null, studentInMakeedu: false, transcription: c.transcription,
    speakerLabels: Array.isArray(c.speaker_labels) ? c.speaker_labels : null,
    speakerRoles: pp?.speakerRoles ?? null, processingError: c.processing_error, audioDurationSec: c.audio_duration_sec, recordings,
    audioReport: pp && 'audioReport' in pp ? (pp.audioReport ?? null) : null, aiFormSuggestions: pp?.formSuggestions ?? null,
    aiAnalysis: ai ? { id: ai.id, modelVersion: ai.model_version, diagnosis: ai.diagnosis, learningPlan: ai.learning_plan, printPayload: ai.print_payload,
      recommendedClassIds: ai.recommended_class_ids, generatedAt: ai.generated_at, reportEditedBy: ai.report_edited_by ?? null, reportEditedAt: ai.report_edited_at ?? null } : null,
    recommendedClasses,
    prepBrief: isPrepBriefRecord(c.prep_brief) ? c.prep_brief : null,
    prepBriefStatus: c.prep_brief_status === 'generating' || c.prep_brief_status === 'failed' ? c.prep_brief_status : null,
    prepBriefError: c.prep_brief_error ?? null, studentId, assignedClassCount, personConsultCount: 1, personConsults: [], makeeduId: c.makeedu_id ?? null,
    fields: {
      englishName: s(c.english_name), gender: s(c.gender), bloodType: s(c.blood_type), birthDate: s(c.birth_date), studentPhone: s(c.student_phone), homePhone: s(c.home_phone),
      parentRelation: s(c.parent_relation), address: s(c.address), zipCode: s(c.zip_code), addressDetail: s(c.address_detail), consultationPath: s(c.consultation_path),
      subject: s(c.subject), careerGoal: s(c.career_goal), siblings: s(c.siblings), safetyNotes: s(c.safety_notes),
      registrationStatus: D.board.boardStatusOf({ outcome: String(c.outcome), assignedClassCount }).label,
      paymentAmount: s(c.payment_amount), paymentDate: s(c.payment_date), registrar: s(c.registrar), followUpDate: s(c.follow_up_date), followUpContent: s(c.follow_up_content),
      nonRegistrationReason: s(c.non_registration_reason), shuttleBusRequest: !!c.shuttle_bus_request, privacyAgreement: !!c.privacy_agreement,
      installmentAgreement: !!c.installment_agreement, subjectDetails: c.subject_details ?? null, intakeChecklist: c.intake_checklist ?? null, counselor: s(c.counselor),
      receivedDate: s(c.received_date), studentType: s(c.student_type), siblingsDetails: s(c.siblings_details), consultationDate: s(c.consultation_date),
    },
  };
}

const CANDIDATE_CAP = 500;
const plainName = (n) => n.replace(/["\\%_*,()]/g, '');
/** findSamePersonConsultations — 같은 원생 · 이름 꼴(띄어쓰기 무시) · 휴대폰 끝 8자리로 후보 → 2.0 samePersonOf. */
export async function findSamePersonConsultations(sql, D, t, self) {
  const ors = [];
  if (self.student_id) ors.push(sql`c.student_id::text = ${plainName(self.student_id)}`);
  const name = plainName(D.person.personName(self.prospect_name));
  if (name) ors.push(sql`c.prospect_name ilike ${[...name].join('%')}`);
  const phone = D.person.phoneKeyOf(self.parent_phone);
  if (name && phone) ors.push(sql`c.parent_phone ilike ${`%${phone.slice(-8, -4)}%${phone.slice(-4)}%`}`);
  if (!ors.length) return [];
  const pick = (cond) => sql`select c.id::text id, c.student_id::text student_id, c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_phone, c.subject,
    c.outcome::text outcome, to_json(c.consulted_at)#>>'{}' consulted_at, c.consultation_date::text consultation_date
    from public.enrollment_consultations c where c.tenant_id = ${t} and (${cond}) order by c.consulted_at desc limit ${CANDIDATE_CAP}`;
  let rows = await pick(ors.reduce((a, b) => sql`${a} or ${b}`));
  let same = D.person.samePersonOf(self, rows);
  const linked = self.student_id ? null : same.find((r) => r.student_id)?.student_id;
  if (linked) {
    const known = new Set(rows.map((r) => r.id));
    const extra = (await pick(sql`c.student_id = ${linked}`)).filter((r) => !known.has(r.id));
    if (extra.length) { rows = [...rows, ...extra].sort((a, b) => (a.consulted_at < b.consulted_at ? 1 : a.consulted_at > b.consulted_at ? -1 : 0)); same = D.person.samePersonOf(self, rows); }
  }
  return same;
}
export async function getSiblingConsultations(sql, D, t, id) {
  const [self] = await sql`select id::text id, student_id::text student_id, prospect_name, prospect_school, prospect_grade, parent_phone from public.enrollment_consultations where tenant_id = ${t} and id = ${id}`;
  if (!self) return [];
  return (await findSamePersonConsultations(sql, D, t, self)).map((c) => ({ id: c.id, prospectName: c.prospect_name ?? '', subject: c.subject, outcome: c.outcome, consultedAt: c.consulted_at }));
}

/** loadConsultationReferrer — 소개한 사람(원생·직원 연결 또는 신청서 이름). */
export async function loadConsultationReferrer(sql, D, t, id) {
  const [row] = await sql`select c.referrer_student_id::text referrer_student_id, c.referrer_staff_id::text referrer_staff_id, c.referrer_name,
    s.name s_name, s.school s_school, s.grade s_grade, u.display_name u_name
    from public.enrollment_consultations c left join public.students s on s.id = c.referrer_student_id left join public.users u on u.id = c.referrer_staff_id
    where c.tenant_id = ${t} and c.id = ${id}`;
  if (!row) return { ready: true, referrer: null, referrerName: null };
  const referrer = row.referrer_student_id
    ? { value: D.ref.referrerValueOf('student', row.referrer_student_id), label: row.s_name ?? '원생(이름 확인 불가)',
      hint: row.s_name ? D.grade.schoolGradeLabel(row.s_school, row.s_grade) || '원생' : '원생' }
    : row.referrer_staff_id ? { value: D.ref.referrerValueOf('staff', row.referrer_staff_id), label: row.u_name?.trim() || '직원', hint: '직원' } : null;
  return { ready: true, referrer, referrerName: row.referrer_name ?? null };
}

const STAFF_ROLES = ['master', 'admin', 'manager', 'counselor', 'teacher', 'accountant'];
/** listReferrerOptions — 그 학원 원생(퇴원·시험용 제외) + 재직 직원. */
export async function listReferrerOptions(sql, D, t) {
  const [students, staff] = await Promise.all([
    sql`select id::text id, name, school, grade from public.students where tenant_id = ${t} and status::text <> 'withdrawn' and is_test = false order by name, id`,
    sql`select id::text id, display_name from public.users where tenant_id = ${t} and status::text = 'active' and system_role::text = any(${STAFF_ROLES}) order by display_name, id`,
  ]);
  return [
    ...students.map((x) => ({ value: D.ref.referrerValueOf('student', x.id), label: x.name, hint: D.grade.schoolGradeLabel(x.school, x.grade) || '원생' })),
    ...staff.filter((u) => u.display_name?.trim()).map((u) => ({ value: D.ref.referrerValueOf('staff', u.id), label: u.display_name.trim(), hint: '직원' })),
  ];
}
export async function referrerCandidatesFor(sql, D, t, input) {
  const hinted = Boolean(input.referrerName?.trim()) || /소개|추천/.test(input.path ?? '');
  if (!hinted) return [];
  return D.ref.findReferrerCandidates([input.referrerName, input.path, ...input.texts], await listReferrerOptions(sql, D, t));
}

/** getAssignedClasses — 배정 반 상세(반 이름 · 과목 라벨 · 담임 · 지금 교시 묶음 · 휴원). */
export async function getAssignedClasses(sql, D, t, studentId, subject, operations) {
  if (!studentId) return { ok: true, rows: [] };
  const keys = classKeysFor(D, subject, operations.subjects);
  if (keys?.length === 0) return { ok: true, rows: [] };
  const today = D.kst.kstToday();
  const flat = await sql`select e.id::text id, e.on_hold, e.attendance_days, k.id::text class_id, k.class_name, k.subject, u.display_name teacher_name
    from public.enrollments e join public.classes k on k.id = e.class_id and k.tenant_id = ${t} left join public.users u on u.id = k.teacher_id
    where e.tenant_id = ${t} and e.student_id = ${studentId} and (e.end_date is null or e.end_date >= ${today}::date) ${keys ? sql`and k.subject = any(${[...keys]})` : sql``}`;
  if (!flat.length) return { ok: true, rows: [] };
  const classIds = [...new Set(flat.map((r) => r.class_id))];
  const scheds = await sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time,
    valid_from::text valid_from, valid_to::text valid_to from public.class_schedules where class_id = any(${classIds}::uuid[])`;
  const maps = D.maps.buildSubjectMaps(operations.subjects), periodsConfig = D.periods.settingsToPeriodsConfig(operations);
  const byClass = new Map();
  for (const x of scheds) (byClass.get(x.class_id) ?? byClass.set(x.class_id, []).get(x.class_id)).push(x);
  return {
    ok: true,
    rows: flat.map((r) => {
      const live = (byClass.get(r.class_id) ?? []).filter((x) => D.phase.slotPhase({ dayOfWeek: x.day_of_week, startTime: x.start_time, endTime: x.end_time, validFrom: x.valid_from, validTo: x.valid_to }, today) === 'current');
      const attKo = (r.attendance_days ?? []).map((d) => D.periods.enumDayToKo(d));
      return {
        enrollmentId: r.id, classId: r.class_id, className: r.class_name, subjectLabel: maps.labelOf(r.subject), teacherName: r.teacher_name ?? null,
        schedule: D.groups.groupSchedule(live.map((x) => ({ day: x.day_of_week, startTime: x.start_time.slice(0, 5), endTime: x.end_time.slice(0, 5) })), r.subject, attKo, periodsConfig),
        onHold: !!r.on_hold,
      };
    }),
  };
}

/** getClassesList({ active: 'active' }) 중 변환 창이 쓰는 칸(반 이름순). */
export async function activeClasses(sql, t) {
  const rows = await sql`select k.id::text id, k.class_name, k.subject, u.display_name teacher_name from public.classes k left join public.users u on u.id = k.teacher_id
    where k.tenant_id = ${t} and k.is_active = true order by k.class_name`;
  return rows.map((c) => ({ id: c.id, className: c.class_name, subject: c.subject, teacherName: c.teacher_name ?? null }));
}

/** findMergeSuccessor — 병합으로 사라진 상담 → 남은 상담(감사로그 사슬 · 5걸음). */
export async function findMergeSuccessor(sql, t, lostId) {
  const seen = new Set([lostId]);
  let cur = lostId;
  for (let hop = 0; hop < 5; hop += 1) {
    const [row] = await sql`select metadata from public.audit_logs where tenant_id = ${t} and action = 'consultation_merge' and metadata @> ${sql.json({ loserIds: [cur] })}
      order by created_at desc limit 1`;
    const winner = row?.metadata?.winnerId;
    if (!winner || seen.has(winner)) return null;
    const [alive] = await sql`select id from public.enrollment_consultations where tenant_id = ${t} and id::text = ${winner}`;
    if (alive) return winner;
    seen.add(winner); cur = winner;
  }
  return null;
}

/** canViewClassDetail — 반 열람이 scoped(선생님)면 담임이거나 그 반 교시 담당일 때만(2.0의 오늘 위임 갈래는 뺐다). */
export async function canViewClasses(sql, level, actorId, classIds) {
  if (level === 'none') return false;
  if (level !== 'scoped') return true;
  if (!classIds.length) return true;
  const own = await sql`select k.id::text id from public.classes k where k.id = any(${classIds}::uuid[]) and (k.teacher_id = ${actorId}
    or exists(select 1 from public.class_schedules x where x.class_id = k.id and x.teacher_id = ${actorId}))`;
  return own.length === classIds.length;
}
