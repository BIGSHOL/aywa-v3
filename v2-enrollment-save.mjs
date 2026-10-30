// 2.0 신규 콜&상담 · 저장(features/enrollment/server/actions.ts) — 같은 이름 · 같은 인자 · 같은 검증 · 같은 표·칸 · 같은 감사로그를 Docker 복사본에.
//  · updateEnrollmentConsultation(_prev, FormData) — 상담 수정(바꾼 칸만 저장 · 후속 조치 · 상담자 계정 · 소개한 사람 · 학교급 채움).
//    판정은 2.0 순수 함수 그대로(consultation-form-row · consultation-changed · follow-up · consultation-edit · counselor-account ·
//    consultation-audit · referrer · school-name). 2.0은 세션 클라이언트(RLS)로 쓴다 — 여기선 tenant_id를 직접 건다.
//    🔴 동시 저장 판정(2.0 `.eq("updated_at", 읽은 값)`)은 시각을 **글자로** 견준다 — postgres.js에 시각 글자를 ::timestamptz로 넘기면
//       마이크로초가 잘려 늘 0행(= 늘 '다른 저장이 먼저')이 된다.
//    녹음 첨부(audioPath)는 연습 자료에서 받지 않는다(업로드 자체를 거절 — 전사·AI 분석 없음).
import { audit } from './v2-proc-people.mjs';
import { notifyClassAssignment } from './v2-timetable-save.mjs'; // 2.0 notifyClassAssignment(반 담임 알림 줄 — 바깥 전송 없음)
import { countAssignedClasses, detailRules } from './v2-enrollment-detail.mjs'; // 2.0 countAssignedClasses(assigned-classes.ts)

const MODULES = { row: 'features/enrollment/consultation-form-row.ts', changed: 'features/enrollment/consultation-changed.ts', follow: 'features/enrollment/follow-up.ts',
  edit: 'features/enrollment/consultation-edit.ts', account: 'features/enrollment/counselor-account.ts', audit: 'features/enrollment/consultation-audit.ts',
  ref: 'features/enrollment/referrer.ts', school: 'features/schools/school-name.ts', board: 'features/enrollment/board-stages.ts', kst: 'lib/date-kst.ts',
  dbError: 'lib/supabase/db-error.ts' };
let rulesP = null;
export function saveRules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

const JSONB = new Set(['subject_details', 'learning_history', 'intake_checklist']);
/** UTC 마이크로초까지의 시각 글자 — 동시 저장 판정용(PostgREST가 돌려주는 updated_at과 같은 값을 글자로). */
export const stampSql = (sql, col = 'updated_at') => sql`to_char(${sql.unsafe(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/** FormData 모양({ $formData: [[이름, 글자] …] }) → 진짜 FormData(2.0 함수가 has/get/entries를 쓴다). */
export function formDataOf(arg) {
  const fd = new FormData();
  if (arg && typeof arg === 'object' && Array.isArray(arg.$formData)) for (const e of arg.$formData) if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') fd.append(e[0], e[1]);
  return fd;
}

/** 2.0 withSchoolKind/completeSchoolKind — 빠진 학교급을 채운다(그 지점 학교알리미 목록에 있을 때만). */
async function completeSchoolKind(sql, S, t, school, grade, aliases) {
  const candidate = S.school.schoolKindCandidate(school, grade);
  if (!candidate) return school;
  const rows = await sql`select name_key from public.school_enrollment_stats where tenant_id = ${t} and name_key = ${S.school.normalizeSchoolName(candidate)} limit 1`;
  return S.school.fillSchoolKind(school, grade, new Set(rows.map((r) => r.name_key)), aliases);
}

/** 2.0 resolveCounselorAccount — 상담자 이름과 표시 이름이 정확히 같은 재직 직원이 딱 한 명일 때만. */
async function resolveCounselorAccount(sql, t, name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return null;
  const rows = await sql`select id::text id from public.users where tenant_id = ${t} and status::text = 'active' and display_name = ${n} limit 2`;
  return rows.length === 1 ? rows[0].id : null;
}

async function referrerLabelOf(sql, t, cols) {
  if (cols?.referrer_student_id) { const [r] = await sql`select name from public.students where tenant_id = ${t} and id = ${cols.referrer_student_id}`; return r?.name ?? '원생'; }
  if (cols?.referrer_staff_id) { const [r] = await sql`select display_name from public.users where tenant_id = ${t} and id = ${cols.referrer_staff_id}`; return `${r?.display_name?.trim() || '이름 없음'}(직원)`; }
  return null;
}

/**
 * 2.0 저장은 세션 클라이언트(createClient — RLS·트리거가 그 사람을 본다)로 쓴다 — 쓰기 문장은 고른 사람 신분으로(asViewer: 저장점 안 · 끝나면 역할·claims 복원).
 * 실패는 던진다(부르는 쪽 try/catch가 2.0 문구로 바꾼다 · 저장점째 되돌아간다).
 */
async function viewerSave(sql, actorId, fn) {
  const r = await asViewer(sql, actorId, fn);
  if (r.error) throw r.error;
  return r.data;
}

/** 칸 → SET 조각(jsonb는 sql.json — 글자로 두 번 싸지 않게). */
function setList(sql, row) {
  return Object.entries(row).map(([k, v]) => sql`${sql(k)} = ${JSONB.has(k) && v !== null && v !== undefined ? sql.json(v) : v ?? null}`)
    .reduce((a, b) => sql`${a}, ${b}`);
}

/**
 * updateEnrollmentConsultation(_prev, formData) — 2.0 반환 그대로({ error } · { ok: true }).
 * ctx = { sql, t, user: { id, tenantId, displayName, row }, canWrite, operations, importV2 }.
 */
export async function updateEnrollmentConsultation(ctx, formData) {
  const { sql, t, user, operations, importV2 } = ctx;
  const [S, D] = await Promise.all([saveRules(importV2), detailRules(importV2)]);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const markConsulted = String(formData.get('markConsulted') ?? '') === '1';
  const parsed = S.row.createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요' };

  const [found] = /^[0-9a-f-]{36}$/i.test(id) ? await sql`select to_json(c) j, ${stampSql(sql, 'c.updated_at')} stamp from public.enrollment_consultations c where c.tenant_id = ${t} and c.id = ${id}` : [];
  if (!found) return { error: '상담을 불러오지 못했습니다. 다시 시도해 주세요.' };
  const existing = found.j;
  const baseValues = S.changed.parseEditBase(formData.get('editBase'));
  const baseParsed = baseValues ? S.row.createSchema.safeParse(baseValues) : null;
  const base = baseValues && baseParsed?.success ? { values: baseValues, data: baseParsed.data } : null;
  const lh = { ...(existing.learning_history ?? {}) };
  for (const key of ['prevAcademy', 'lastScore']) {
    const mine = parsed.data[key] || '';
    if (base && (base.data[key] || '') === mine) continue;
    if (mine) lh[key] = mine; else delete lh[key];
  }
  const promoteToConsulted = markConsulted && !!existing.from_public_intake && ['pending', 'scheduled'].includes(String(existing.outcome ?? ''));
  const referrer = S.ref.referrerColumns(formData);
  if ('error' in referrer) return { error: referrer.error };
  const aliases = operations.schoolSaveAliases ?? [];
  const mineRow = { ...S.row.buildConsultationRow(parsed.data, aliases), ...referrer.cols };
  const baseRow = base ? { ...S.row.buildConsultationRow(base.data, aliases), ...S.ref.referrerColumnsOf(base.values) } : null;
  const changed = baseRow ? S.changed.changedColumns(mineRow, baseRow) : null;
  const storedDate = existing.follow_up_date ?? null;
  const mineResult = S.follow.parseFollowUpResult(formData.get('followUpResult'));
  const mineDate = parsed.data.followUpDate || null;
  const effective = base
    ? S.changed.effectiveFollowUp({ mineResult, baseResult: S.follow.parseFollowUpResult(base.values.followUpResult ?? null), mineDate, baseDate: base.data.followUpDate || null,
      storedDate, storedStage: S.board.stageOfOutcome(String(existing.outcome)) })
    : { result: mineResult, followUpDate: mineDate };
  const followUp = S.follow.resolveFollowUp({
    current: promoteToConsulted ? 'consulted' : String(existing.outcome),
    assignedClassCount: await countAssignedClasses(sql, D, t, existing.student_id ?? null,
      changed && !changed.has('subject') ? (existing.subject ?? null) : parsed.data.subject || null, operations.subjects),
    result: effective.result, followUpDate: effective.followUpDate, storedDate, today: S.kst.kstToday(),
  });
  if ('error' in followUp) return { error: followUp.error };
  const outcomeTo = followUp.outcome !== existing.outcome ? followUp.outcome : null;

  const built = S.row.buildConsultationRow(parsed.data, aliases);
  const fullRow = { ...built, prospect_school: await completeSchoolKind(sql, S, t, built.prospect_school, built.prospect_grade, aliases), ...referrer.cols };
  let row = fullRow;
  if (changed && baseRow) {
    const keep = new Set(changed);
    if (keep.has('prospect_grade') && fullRow.prospect_school !== mineRow.prospect_school) keep.add('prospect_school');
    row = Object.fromEntries(Object.entries(fullRow).filter(([key]) => keep.has(key)));
    const details = S.changed.mergeSubjectDetails(existing.subject_details, baseRow.subject_details, mineRow.subject_details);
    if (details.changed) row.subject_details = details.value;
  }
  const referrerBefore = 'referrer_student_id' in row
    ? { referrer_student_id: existing.referrer_student_id ?? null, referrer_staff_id: existing.referrer_staff_id ?? null, referrer_name: existing.referrer_name ?? null } : null;
  const autofilled = S.edit.counselorAutofill({ ...existing, ...referrerBefore }, { ...row, learning_history: lh }, user.displayName, promoteToConsulted || !!outcomeTo);
  if (autofilled) row.counselor = autofilled;
  const account = S.account.counselorAccountPatch({
    beforeAccount: existing.consultant_id, patch: row, autofilled, userId: user.id,
    resolved: 'counselor' in row && !autofilled ? await resolveCounselorAccount(sql, t, row.counselor) : null,
  });
  if (account !== undefined) row.consultant_id = account;
  const write = { ...row, learning_history: Object.keys(lh).length > 0 ? lh : null, ...(outcomeTo ? { outcome: outcomeTo } : {}), updated_at: new Date().toISOString() };
  let saved;
  try {
    [saved] = await viewerSave(sql, user.id, (sp) => sp`update public.enrollment_consultations set ${setList(sp, write)}
      where tenant_id = ${t} and id = ${id} and ${stampSql(sp)} = ${found.stamp} returning id`);
  } catch (error) {
    return { error: S.dbError.describeDbError({ code: error?.code, message: error?.message ?? '', details: error?.detail ?? null, hint: error?.hint ?? null },
      { fallback: '상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', op: 'write' }).message };
  }
  if (!saved) return { error: '다른 저장이 먼저 반영되었습니다. 화면을 다시 열어 확인해주세요.' };

  const summary = S.audit.summarizeConsultationChanges(existing, row);
  if (referrerBefore && S.ref.referrerChanged(referrerBefore, row)) {
    const [from, to] = await Promise.all([referrerLabelOf(sql, t, referrerBefore), referrerLabelOf(sql, t, referrer.cols)]);
    summary.changed.push('소개한 사람');
    summary.changes.push({ field: '소개한 사람', from, to });
  }
  if (summary.changed.length > 0 || outcomeTo || autofilled) {
    await audit(sql, t, user.row, 'enrollment_consultation_update', 'enrollment_consultations', parsed.data.prospectName, {
      consultationId: id, ...summary, ...(autofilled ? { counselorAutofill: autofilled } : {}), ...(outcomeTo ? { outcomeTo } : {}),
    });
  }
  if (String(formData.get('audioPath') ?? '').trim()) return { error: '입력 내용은 저장되었습니다. 녹음 첨부만 실패: 연습 자료에서는 녹음을 받지 않습니다', saved: true };
  return { ok: true };
}

const OUTCOMES = ['pending', 'scheduled', 'consulted', 'ai_done', 'enrolled', 'declined', 'no_show'];
const dbWhy = (S, error, fallback, op = 'write') => S.dbError.describeDbError({ code: error?.code, message: error?.message ?? '', details: error?.detail ?? null, hint: error?.hint ?? null },
  { fallback, op }).message;

/** setEnrollmentOutcome(_prev, formData) — 칸반 끌기 · 목록 상태 칸 · 상세 '상태 변경'. 2.0 반환 { error } · { ok: true }. */
export async function setEnrollmentOutcome(ctx, formData) {
  const { sql, t, user, operations, importV2 } = ctx;
  const [S, D] = await Promise.all([saveRules(importV2), detailRules(importV2)]);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const id = String(formData.get('id') ?? '').trim();
  const outcome = String(formData.get('outcome') ?? '');
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  if (!OUTCOMES.includes(outcome)) return { error: '유효한 상태가 아닙니다' };
  const [cur] = /^[0-9a-f-]{36}$/i.test(id)
    ? await sql`select outcome::text outcome, prospect_name, student_id::text student_id, subject from public.enrollment_consultations where tenant_id = ${t} and id = ${id}` : [];
  if (!cur) return { error: '상담을 찾을 수 없습니다' };
  const assignedClassCount = await countAssignedClasses(sql, D, t, cur.student_id, cur.subject, operations.subjects);
  if (assignedClassCount > 0 && S.board.stageOfOutcome(outcome) !== 'enrolled') return { error: S.board.ASSIGNED_DRAG_BLOCKED };
  if (cur.outcome === 'enrolled' && outcome !== 'enrolled' && outcome !== 'declined') return { error: S.board.ENROLLED_REVERT_BLOCKED };
  try {
    await viewerSave(sql, user.id, (sp) => sp`update public.enrollment_consultations set outcome = ${outcome}, updated_at = ${new Date().toISOString()} where tenant_id = ${t} and id = ${id}`);
  } catch (error) { return { error: dbWhy(S, error, '상담 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (cur.outcome !== outcome) {
    await audit(sql, t, user.row, 'enrollment_consultation_outcome', 'enrollment_consultations', cur.prospect_name ?? null, { consultationId: id, from: cur.outcome, to: outcome });
  }
  return { ok: true };
}

/** 2.0 cellPatchSchema(actions.ts) — 칸·길이·문구 그대로. zod는 2.0이 쓰는 같은 묶음(저장소 node_modules). */
let cellSchemaP = null;
function cellSchema() {
  cellSchemaP ??= import('zod').then(({ z }) => {
    const tooLong = (what) => `${what}이(가) 너무 깁니다`;
    return z.object({
      prospectName: z.string().trim().min(1, '학생 이름을 입력해주세요').max(60, tooLong('학생 이름')),
      prospectSchool: z.string().trim().max(60, tooLong('학교')).nullable(),
      prospectGrade: z.string().trim().max(24, tooLong('학년')).nullable(),
      parentPhone: z.string().trim().max(40, tooLong('연락처')).nullable(),
      consultantId: z.string().uuid('상담사 값이 올바르지 않습니다').nullable(),
      subject: z.string().trim().max(40, tooLong('과목')).nullable(),
      parentRequest: z.string().max(20000, tooLong('상담 내용')).nullable(),
    }).partial().strict();
  }).catch((e) => { cellSchemaP = null; throw e; });
  return cellSchemaP;
}

/** patchConsultationCells(id, patch) — 목록 칸 수정(준 칸만). 2.0 반환 { ok: true } · { error }. */
export async function patchConsultationCells(ctx, id, patch) {
  const { sql, t, user, operations, importV2 } = ctx;
  const S = await saveRules(importV2);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  if (typeof id !== 'string' || !id.trim()) return { error: '상담 ID가 누락되었습니다' };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: '입력값을 확인해주세요' };
  const parsed = (await cellSchema()).safeParse(patch);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const known = issue && (issue.code === 'too_small' || issue.code === 'too_big' || issue.code === 'invalid_format');
    return { error: known ? issue.message : '입력값을 확인해주세요' };
  }
  const d = parsed.data;
  if (Object.keys(d).length === 0) return { error: '바꿀 칸이 없습니다' };
  const [found] = /^[0-9a-f-]{36}$/i.test(id)
    ? await sql`select to_json(c) j, ${stampSql(sql, 'c.updated_at')} stamp from public.enrollment_consultations c where c.tenant_id = ${t} and c.id = ${id}` : [];
  const before = found?.j ?? null;
  const aliases = operations.schoolSaveAliases ?? [];
  const row = {};
  if (d.prospectName !== undefined) row.prospect_name = d.prospectName;
  if (d.prospectSchool !== undefined) {
    const grade = d.prospectGrade !== undefined ? d.prospectGrade : (before?.prospect_grade ?? null);
    row.prospect_school = await completeSchoolKind(sql, S, t, S.school.canonicalSchoolName(d.prospectSchool, aliases), grade, aliases);
  }
  if (d.prospectGrade !== undefined) row.prospect_grade = d.prospectGrade || null;
  if (d.parentPhone !== undefined) row.parent_phone = d.parentPhone || null;
  if (d.parentRequest !== undefined) row.parent_request = d.parentRequest?.trim() ? d.parentRequest : null;
  if (d.subject !== undefined) {
    if (d.subject && !operations.subjects.some((x) => x.key === d.subject)) return { error: '학원설정에 없는 과목입니다' };
    row.subject = d.subject || null;
  }
  if (d.consultantId !== undefined) {
    if (d.consultantId) {
      const [staff] = await sql`select id from public.users where tenant_id = ${t} and id = ${d.consultantId} and status::text = 'active'`;
      if (!staff) return { error: '상담사를 찾을 수 없습니다' };
    }
    row.consultant_id = d.consultantId;
  }
  if (!before) return { error: '상담을 불러오지 못했습니다. 다시 시도해 주세요.' };
  const autofilled = S.edit.counselorAutofill(before, row, user.displayName);
  if (autofilled) row.counselor = autofilled;
  const account = S.account.counselorAccountPatch({ beforeAccount: before.consultant_id, patch: row, autofilled, userId: user.id,
    resolved: 'counselor' in row && !autofilled ? await resolveCounselorAccount(sql, t, row.counselor) : null });
  if (account !== undefined) row.consultant_id = account;
  let updated;
  try {
    [updated] = await viewerSave(sql, user.id, (sp) => sp`update public.enrollment_consultations set ${setList(sp, { ...row, updated_at: new Date().toISOString() })}
      where tenant_id = ${t} and id = ${id} and ${stampSql(sp)} = ${found.stamp} returning id`);
  } catch (error) { return { error: dbWhy(S, error, '상담 칸을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (!updated) return { error: '상담을 찾을 수 없습니다' };
  const summary = S.audit.summarizeConsultationChanges(before, row);
  if (summary.changed.length > 0 || autofilled) {
    // 2.0 metadata.via = 'list'(목록 칸 수정) — 공통 규약의 via('3.0 연습 복사본')와 자리가 겹쳐 2.0 값은 surface에 둔다.
    await audit(sql, t, user.row, 'enrollment_consultation_update', 'enrollment_consultations',
      (typeof row.prospect_name === 'string' ? row.prospect_name : null) ?? before.prospect_name ?? null,
      { consultationId: id, ...summary, surface: 'list', ...(autofilled ? { counselorAutofill: autofilled } : {}) });
  }
  return { ok: true };
}

/** createEnrollmentConsultation(_prev, formData) — 새 상담. 2.0 반환 { id } · { error }. 녹음 동반 생성은 받지 않는다. */
export async function createEnrollmentConsultation(ctx, formData) {
  const { sql, t, user, operations, importV2 } = ctx;
  const S = await saveRules(importV2);
  const parsed = S.row.createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? '입력값을 확인해주세요' };
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  if (!parsed.data.consultationPath) return { error: '상담 경로를 선택해주세요' };
  const followUpResult = S.follow.parseFollowUpResult(formData.get('followUpResult'));
  const followUp = S.follow.resolveFollowUp({ current: 'consulted', result: followUpResult, followUpDate: parsed.data.followUpDate || null, storedDate: null, today: S.kst.kstToday() });
  if ('error' in followUp) return { error: followUp.error };
  const referrer = S.ref.referrerColumns(formData);
  if ('error' in referrer) return { error: referrer.error };
  if (String(formData.get('audioPath') ?? '').trim()) return { error: '연습 자료에서는 녹음을 받지 않습니다' };
  const learningHistory = {};
  if (parsed.data.prevAcademy) learningHistory.prevAcademy = parsed.data.prevAcademy;
  if (parsed.data.lastScore) learningHistory.lastScore = parsed.data.lastScore;
  const aliases = operations.schoolSaveAliases ?? [];
  const built = S.row.buildConsultationRow(parsed.data, aliases);
  const insert = {
    tenant_id: t, ...built, prospect_school: await completeSchoolKind(sql, S, t, built.prospect_school, built.prospect_grade, aliases), ...referrer.cols,
    learning_history: Object.keys(learningHistory).length > 0 ? learningHistory : null,
    consultant_id: (await resolveCounselorAccount(sql, t, parsed.data.counselor)) ?? user.id,
    outcome: followUp.outcome,
  };
  let data;
  try {
    [data] = await viewerSave(sql, user.id, (sp) => {
      const cols = Object.keys(insert);
      const vals = cols.map((k) => sp`${JSONB.has(k) && insert[k] !== null && insert[k] !== undefined ? sp.json(insert[k]) : insert[k] ?? null}`).reduce((a, b) => sp`${a}, ${b}`);
      return sp`insert into public.enrollment_consultations (${sp(cols)}) values (${vals}) returning id::text id`;
    });
  } catch (error) { return { error: dbWhy(S, error, '상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (!data) return { error: '상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  await audit(sql, t, user.row, 'enrollment_consultation_create', 'enrollment_consultations', parsed.data.prospectName, {
    consultationId: data.id, subject: parsed.data.subject || null, followUp: followUpResult, outcome: followUp.outcome,
    ...(referrer.cols.referrer_student_id || referrer.cols.referrer_staff_id ? { referrer: await referrerLabelOf(sql, t, referrer.cols) } : {}),
  });
  return { id: data.id };
}

/**
 * deleteEnrollmentConsultation(_prev, formData) — 상담 완전 삭제(AI 분석·녹음 행은 FK cascade). 2.0은 성공하면 redirect(redirectTo) — 여기선
 * { redirectTo }를 돌려주고 호스트가 그 주소로 옮긴다(2.0 반환은 undefined). 녹음 파일(Storage) 정리는 하지 않는다(복사본엔 파일 저장소가 없다).
 */
export async function deleteEnrollmentConsultation(ctx, formData) {
  const { sql, t, user, importV2 } = ctx;
  const S = await saveRules(importV2);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const id = String(formData.get('id') ?? '').trim();
  const redirectTo = String(formData.get('redirectTo') ?? '').trim();
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const [c] = /^[0-9a-f-]{36}$/i.test(id)
    ? await sql`select id::text id, audio_path, prospect_name, student_id::text student_id from public.enrollment_consultations where tenant_id = ${t} and id = ${id}` : [];
  if (!c) return { error: '상담을 찾을 수 없습니다' };
  const [{ n: recCount }] = await sql`select count(*)::int n from public.consultation_recordings where consultation_id = ${id}`;
  try {
    await viewerSave(sql, user.id, (sp) => sp`delete from public.enrollment_consultations where tenant_id = ${t} and id = ${id}`);
  } catch (error) { return { error: dbWhy(S, error, '상담을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') }; }
  await audit(sql, t, user.row, 'enrollment_consultation_delete', 'enrollment_consultations', c.prospect_name ?? null,
    { consultationId: id, studentId: c.student_id ?? null, hadRecording: !!c.audio_path || recCount > 0 });
  return redirectTo ? { redirectTo } : undefined;
}

const EDITABLE_AUDIO_KEYS = new Set(['consultationType', 'summary', 'familyBackground', 'parentConcerns', 'parentQuestions', 'parentRequests', 'parentSatisfaction',
  'studentTraits', 'teacherResponse', 'salesPoints', 'agreements', 'followUps', 'warnings']);

/** updateConsultationReportSection(_prev, formData) — AI 분석 리포트 한 섹션의 글을 사람이 고친다(AI 호출 없음). 2.0 반환 { ok, editedBy, editedAt } · { error }. */
export async function updateConsultationReportSection(ctx, formData) {
  const { sql, t, user, importV2 } = ctx;
  const S = await saveRules(importV2);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const analysisId = String(formData.get('analysisId') ?? '').trim();
  const consultationId = String(formData.get('consultationId') ?? '').trim();
  const key = String(formData.get('key') ?? '').trim();
  const content = String(formData.get('content') ?? '');
  if (!analysisId) return { error: '분석 ID가 누락되었습니다' };
  if (!EDITABLE_AUDIO_KEYS.has(key)) return { error: '잘못된 섹션입니다' };
  // 2.0은 RLS(분석 행 → 상담 행의 지점)로 가린다 — 여기선 상담 행의 지점을 직접 본다.
  const [row] = /^[0-9a-f-]{36}$/i.test(analysisId)
    ? await sql`select a.print_payload, a.consultation_id::text consultation_id, c.prospect_name from public.consultation_ai_analysis a
      join public.enrollment_consultations c on c.id = a.consultation_id and c.tenant_id = ${t} where a.id = ${analysisId}` : [];
  if (!row) return { error: 'AI 분석을 찾을 수 없습니다' };
  const pp = row.print_payload && typeof row.print_payload === 'object' ? row.print_payload : {};
  const audioReport = pp.audioReport && typeof pp.audioReport === 'object' ? pp.audioReport : {};
  const now = new Date().toISOString();
  try {
    await viewerSave(sql, user.id, (sp) => sp`update public.consultation_ai_analysis set print_payload = ${sp.json({ ...pp, audioReport: { ...audioReport, [key]: content.trim() } })},
      report_edited_by = ${user.displayName}, report_edited_at = ${now} where id = ${analysisId}`);
  } catch (error) { return { error: dbWhy(S, error, '분석 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  await audit(sql, t, user.row, 'enrollment_consultation_report_edit', 'enrollment_consultations', row.prospect_name ?? null,
    { consultationId: row.consultation_id ?? (consultationId || null), analysisId, section: key, chars: content.trim().length });
  return { ok: true, editedBy: user.displayName, editedAt: now };
}

/** appendAiSummaryToConsultationContent(consultationId) — 이미 저장된 AI 요약을 상담 내용 끝에 붙인다(AI 호출 없음 · 같은 요약은 두 번 안 붙인다). */
export async function appendAiSummaryToConsultationContent(ctx, consultationId) {
  const { sql, t, user, importV2 } = ctx;
  const S = await saveRules(importV2);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  if (typeof consultationId !== 'string' || !consultationId) return { error: '상담 ID가 누락되었습니다' };
  const [consult] = /^[0-9a-f-]{36}$/i.test(consultationId)
    ? await sql`select id::text id, parent_request, prospect_name from public.enrollment_consultations where tenant_id = ${t} and id = ${consultationId}` : [];
  if (!consult) return { error: '상담을 찾을 수 없습니다' };
  const [ai] = await sql`select print_payload from public.consultation_ai_analysis where consultation_id = ${consultationId} order by generated_at desc limit 1`;
  const pp = ai?.print_payload && typeof ai.print_payload === 'object' ? ai.print_payload : null;
  const audioReport = pp?.audioReport && typeof pp.audioReport === 'object' ? pp.audioReport : null;
  const summary = typeof audioReport?.summary === 'string' ? audioReport.summary.trim() : '';
  if (!summary) return { error: '추가할 AI 요약이 없습니다. 먼저 분석/재분석을 실행하세요.' };
  const existing = (consult.parent_request ?? '').trim();
  if (existing.includes(summary)) return { error: '이미 이 AI 요약이 상담 내용에 들어 있습니다.' };
  const next = existing ? `${existing}\n\n— AI 상담 요약 —\n${summary}` : summary;
  let appended;
  try {
    [appended] = await viewerSave(sql, user.id, (sp) => sp`update public.enrollment_consultations set parent_request = ${next}, updated_at = ${new Date().toISOString()}
      where tenant_id = ${t} and id = ${consultationId} returning prospect_name`);
  } catch (error) { return { error: dbWhy(S, error, '상담 내용에 요약을 붙이지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (appended) {
    // 2.0 metadata.via = 'ai_summary' — 공통 규약 via와 자리가 겹쳐 surface에 둔다(목록 칸 수정과 같은 규칙).
    await audit(sql, t, user.row, 'enrollment_consultation_update', 'enrollment_consultations', appended.prospect_name ?? null, {
      consultationId, ...S.audit.summarizeConsultationChanges({ parent_request: consult.parent_request }, { parent_request: next }), surface: 'ai_summary' });
  }
  return { ok: true };
}

// ── 병합(server/merge-actions.ts) ──────────────────────────────────────────────────────────────────────────────────────
const MERGE_GAP_DAYS = 7, MAX_MERGE_ROWS = 10;
let mergeRulesP = null;
function mergeRules(importV2) {
  mergeRulesP ??= Promise.all(['features/enrollment/merge-plan.ts', 'features/enrollment/merge-policy.ts', 'features/enrollment/consult-origin.ts'].map((m) => importV2(m)))
    .then(([plan, policy, origin]) => ({ plan, policy, origin })).catch((e) => { mergeRulesP = null; throw e; });
  return mergeRulesP;
}

/**
 * 2.0 사용자 신분으로 한 번(저장점 안) — 이전 claims를 읽어 두고 끝나면 역할·claims를 되돌린다(수납 v2-billing-common asViewer와 같은 모양).
 * 실패하면 저장점째 되돌아가 claims도 함께 돌아간다. 반환 { data } · { error }.
 */
export async function asViewer(sql, actorId, fn) {
  try {
    return { data: await sql.savepoint(async (s) => {
      const [{ prev }] = await s`select coalesce(current_setting('request.jwt.claims', true), '') prev`;
      await s`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId, role: 'authenticated' })}, true)`;
      await s`set local role authenticated`;
      const out = await fn(s);
      await s`reset role`;
      await s`select set_config('request.jwt.claims', ${prev}, true)`;
      return out;
    }), error: null };
  } catch (e) { return { data: null, error: { code: e?.code ?? null, message: e?.message ?? '', detail: e?.detail ?? null, hint: e?.hint ?? null } }; }
}

/** loadRows — 대상 행(PostgREST select('*')와 같은 JSON) + 자식 개수 + 대기 중 makeedu 전송 + 분석 모델. */
async function loadMergeRows(sql, t, ids) {
  const [rows, ai, rec, push] = await Promise.all([
    sql`select to_json(c) j from public.enrollment_consultations c where c.tenant_id = ${t} and c.id = any(${ids}::uuid[])`,
    sql`select a.consultation_id::text consultation_id, a.model_version from public.consultation_ai_analysis a where a.consultation_id = any(${ids}::uuid[])`,
    sql`select consultation_id::text consultation_id from public.consultation_recordings where consultation_id = any(${ids}::uuid[])`,
    sql`select consultation_id::text consultation_id, status::text status from public.makeedu_push_requests where tenant_id = ${t} and consultation_id = any(${ids}::uuid[])`,
  ]);
  const children = {};
  const bump = (id, k) => { children[id] ??= { ai: 0, rec: 0, push: 0 }; children[id][k] += 1; };
  for (const r of ai) bump(r.consultation_id, 'ai');
  for (const r of rec) bump(r.consultation_id, 'rec');
  for (const r of push) bump(r.consultation_id, 'push');
  const models = {};
  for (const r of ai) (models[r.consultation_id] ??= []).push(String(r.model_version ?? ''));
  return { rows: rows.map((r) => r.j), children, pendingPush: push.filter((r) => ['pending', 'running'].includes(String(r.status))).length, models };
}
const uuidList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))] : []);

/** previewConsultationMerge(ids, forceWinnerId) — 읽기(호스트가 GET으로 부른다). 2.0 반환 { plan, rows } · { error }. */
export async function previewConsultationMerge(ctx, ids, forceWinnerId) {
  const { sql, t, importV2 } = ctx;
  if (!ctx.user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const M = await mergeRules(importV2);
  const unique = uuidList(ids);
  if (unique.length < 2) return { error: '병합하려면 상담을 2건 이상 골라야 합니다' };
  if (unique.length > MAX_MERGE_ROWS) return { error: `한 번에 ${MAX_MERGE_ROWS}건까지 합칠 수 있습니다` };
  const { rows, children, pendingPush, models } = await loadMergeRows(sql, t, unique);
  if (rows.length !== unique.length) return { error: '상담을 찾을 수 없습니다' };
  const plan = M.plan.planMerge(rows, { children, maxDayGap: MERGE_GAP_DAYS, forceWinnerId: typeof forceWinnerId === 'string' ? forceWinnerId : undefined });
  if (pendingPush > 0) plan.blockers.push('makeedu 전송 대기 중인 상담이 있어 병합할 수 없습니다');
  const winnerModels = new Set(models[plan.winnerId] ?? []);
  const dropped = plan.loserIds.flatMap((id) => (models[id] ?? []).filter((m) => winnerModels.has(m)));
  if (dropped.length > 0) plan.warnings.push(`같은 AI 모델의 분석이 양쪽에 있어 ${dropped.length}건은 남기는 상담 쪽만 보존됩니다`);
  const sourceOf = (r) => M.origin.consultOriginLabel({ legacyKey: r.legacy_key ?? null, makeeduId: r.makeedu_id ?? null, makeeduPushedAt: r.makeedu_pushed_at ?? null, fromPublicIntake: r.from_public_intake ?? null });
  return { plan, rows: rows.map((r) => ({ id: r.id, label: String(r.prospect_name ?? ''), outcome: String(r.outcome ?? ''), consultedAt: String(r.consulted_at ?? ''), source: sourceOf(r) })) };
}

/** mergeConsultations(winnerId, loserIds, choices) — 2.0 DB 함수 merge_enrollment_consultations를 고른 사람 신분으로. 반환 { ok, winnerId } · { error }. */
export async function mergeConsultations(ctx, winnerId, loserIds, choices = {}) {
  const { sql, t, user, importV2 } = ctx;
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const M = await mergeRules(importV2);
  const unique = uuidList([winnerId, ...(Array.isArray(loserIds) ? loserIds : [])]);
  if (typeof winnerId !== 'string' || !winnerId || unique.length < 2) return { error: '병합 대상이 올바르지 않습니다' };
  if (unique.length > MAX_MERGE_ROWS) return { error: `한 번에 ${MAX_MERGE_ROWS}건까지 합칠 수 있습니다` };
  const { rows, children } = await loadMergeRows(sql, t, unique);
  if (rows.length !== unique.length) return { error: '상담을 찾을 수 없습니다' };
  const winner = rows.find((r) => r.id === winnerId);
  if (!winner) return { error: '남길 상담을 찾을 수 없습니다' };
  const plan = M.plan.planMerge(rows, { children, maxDayGap: MERGE_GAP_DAYS, forceWinnerId: winnerId });
  if (plan.blockers.length > 0) return { error: plan.blockers[0] };
  const built = M.plan.buildMergePatch(plan, rows, winnerId, choices && typeof choices === 'object' && !Array.isArray(choices) ? choices : {});
  if (built.error !== undefined) {
    const miss = built.error.startsWith('MISSING_CHOICE:') ? built.error.slice('MISSING_CHOICE:'.length) : null;
    return { error: miss ? `'${M.policy.COLUMN_LABEL[miss] ?? miss}'을(를) 어느 쪽으로 남길지 정해주세요` : built.error };
  }
  const discarded = built.discarded.map((d) => ({ field: M.policy.COLUMN_LABEL[d.key] ?? d.key, values: d.values }));
  const r = await asViewer(sql, user.id, (s) => s`select public.merge_enrollment_consultations(${winnerId}::uuid, ${plan.loserIds}::uuid[], ${s.json(built.patch)}) result`);
  if (r.error) return { error: r.error.message };
  await audit(sql, t, user.row, 'consultation_merge', 'enrollment_consultations', String(winner.prospect_name ?? ''),
    { winnerId, loserIds: plan.loserIds, discarded, result: r.data[0]?.result ?? null });
  return { ok: true, winnerId };
}

// ── 수업 배정(convertConsultationToStudent) ────────────────────────────────────────────────────────────────────────────
let convertRulesP = null;
function convertRules(importV2) {
  convertRulesP ??= Promise.all(['features/enrollment/assign-start-date.ts', 'features/students/name-suffix.ts', 'lib/license/rule.ts'].map((m) => importV2(m)))
    .then(([start, suffix, license]) => ({ start, suffix, license })).catch((e) => { convertRulesP = null; throw e; });
  return convertRulesP;
}
/** lib/license/server.ts seatBlockReason — 재원생 좌석 한도(조회 실패는 허용 — 2.0과 같다). */
async function seatBlockReason(sql, C, t, adding) {
  try {
    return await sql.savepoint(async (s) => {
      const [row] = await s`select is_active, max_seats from public.tenant_licenses where tenant_id = ${t} and feature = 'student_seats'`;
      const limit = C.license.seatLimitOf(row ?? null);
      if (limit === null) return null;
      const [{ n }] = await s`select count(*)::int n from public.students where tenant_id = ${t} and status = 'enrolled'`;
      return C.license.seatsExceeded(limit, n, adding) ? C.license.seatBlockedMessage(limit, n) : null;
    });
  } catch { return null; }
}
/** findWithdrawnNaturalKeyMatch — 같은 정규화 이름·학교·학년의 퇴원생(조회 실패면 null). */
async function findWithdrawnNaturalKeyMatch(sql, S, key) {
  const norm = key.name.toLowerCase().replace(/\s+/g, '');
  if (!norm) return null;
  const rows = await sql`select id::text id, school, grade from public.students where tenant_id = ${key.tenantId} and name_normalized = ${norm} and status = 'withdrawn'
    order by withdrawn_at desc nulls last limit 20`;
  const hit = rows.find((s) => (S.school.canonicalSchoolName(s.school, key.aliases) ?? '') === (key.school ?? '') && (s.grade ?? '') === (key.grade ?? ''));
  return hit ? hit.id : null;
}

/** convertConsultationToStudent(_prev, formData) — 상담 → 학생 + 고른 반 수강(배정일) · 상담 연결·등록 완료. 반환 모양 2.0 그대로. */
export async function convertConsultationToStudent(ctx, formData) {
  const { sql, t, user, operations, importV2 } = ctx;
  const [S, C] = await Promise.all([saveRules(importV2), convertRules(importV2)]);
  if (!user) return { error: '로그인이 필요합니다' };
  if (!ctx.canWrite) return { error: '신규 콜&상담 권한이 없습니다' };
  const consultationId = String(formData.get('consultationId') ?? '').trim();
  if (!consultationId) return { error: '상담 ID가 누락되었습니다' };
  const classIds = formData.getAll('classIds').map((v) => String(v).trim()).filter(Boolean);
  const overrideName = String(formData.get('name') ?? '').trim();
  const overrideGrade = String(formData.get('grade') ?? '').trim() || null;
  const overrideSchool = String(formData.get('school') ?? '').trim() || null;
  const overrideParentName = String(formData.get('parentName') ?? '').trim() || null;
  const overrideParentPhone = String(formData.get('parentPhone') ?? '').trim() || null;
  const [c] = /^[0-9a-f-]{36}$/i.test(consultationId)
    ? await sql`select id::text id, tenant_id::text tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, student_id::text student_id, outcome::text outcome
      from public.enrollment_consultations where tenant_id = ${t} and id = ${consultationId}` : [];
  if (!c) return { error: '상담 정보를 불러오지 못했습니다' };
  if (c.student_id) return { studentId: c.student_id };
  if (classIds.length === 0) return { error: '배정할 반을 1개 이상 선택하세요' };
  const valid = classIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))
    ? new Set((await sql`select id::text id from public.classes where tenant_id = ${t} and id = any(${classIds}::uuid[])`).map((r) => r.id)) : new Set();
  if (classIds.some((id) => !valid.has(id))) return { error: '배정할 반을 찾을 수 없습니다' };
  const today = S.kst.kstToday();
  const startAt = C.start.normalizeAssignStartDate(String(formData.get('startDate') ?? ''), today);
  if ('error' in startAt) return { error: startAt.error };
  const startDate = startAt.date;
  const studentName = overrideName || c.prospect_name;
  const taken = new Set((await sql`select name from public.students where tenant_id = ${t}`).map((r) => (r.name ?? '').trim()).filter(Boolean));
  const uniqueName = C.suffix.resolveUniqueStudentName(studentName ?? '', taken);
  const studentSchool = overrideSchool ?? c.prospect_school, studentGrade = overrideGrade ?? c.prospect_grade;
  const aliases = operations.schoolSaveAliases ?? [];
  const savedSchool = await completeSchoolKind(sql, S, t, S.school.canonicalSchoolName(studentSchool, aliases), studentGrade, aliases);
  if (String(formData.get('ignoreWithdrawn') ?? '') !== '1') {
    const withdrawn = await findWithdrawnNaturalKeyMatch(sql, S, { tenantId: t, name: studentName ?? '', school: savedSchool, grade: studentGrade, aliases });
    if (withdrawn) {
      const who = [studentName, studentSchool, studentGrade].filter(Boolean).join(' · ');
      return { error: `같은 이름·학교·학년의 퇴원 학생이 있습니다 (${who}). 돌아온 학생이면 그 학생을 열어 '재원 복구'한 뒤 반을 배정해 주세요.`, existingStudentId: withdrawn, withdrawnMatch: true };
    }
  }
  const seat = await seatBlockReason(sql, C, t, 1);
  if (seat) return { error: seat };

  // 학생·수강·상담 연결은 2.0처럼 사용자 신분으로(세션 클라이언트 — RLS·트리거가 같은 사람을 본다).
  const stu = await asViewer(sql, user.id, (s) => s`insert into public.students (tenant_id, name, grade, school, parent_name, parent_phone, status, enrolled_at)
    values (${t}, ${uniqueName.name}, ${studentGrade}, ${savedSchool}, ${overrideParentName ?? c.parent_name}, ${overrideParentPhone ?? c.parent_phone}, 'enrolled', ${today}) returning id::text id`);
  let studentId, reusedExisting = false;
  if (!stu.error && stu.data[0]) {
    studentId = stu.data[0].id;
    await audit(sql, t, user.row, 'student_create', 'student', uniqueName.name, { studentId, source: 'enrollment_consultation', consultationId });
  } else {
    const isDuplicate = stu.error?.code === '23505' || /duplicate key|natural_key/i.test(stu.error?.message ?? '');
    if (!isDuplicate) return { error: '학생을 생성하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.' };
    const norm = studentName.toLowerCase().replace(/\s+/g, '');
    const candidates = await sql`select id::text id, school, grade from public.students where tenant_id = ${t} and name_normalized = ${norm} and status <> 'withdrawn'`;
    const existing = candidates.find((s) => (s.school ?? '') === (studentSchool ?? '') && (s.grade ?? '') === (studentGrade ?? ''));
    if (!existing) {
      const who = [studentName, studentSchool, studentGrade].filter(Boolean).join(' · ');
      return { error: `이미 같은 이름·학교·학년의 재원 학생이 있습니다 (${who}). 학생 목록에서 그 학생에 반을 배정해 주세요.`, existingStudentId: candidates[0]?.id };
    }
    studentId = existing.id; reusedExisting = true;
  }
  let assignClassIds = classIds;
  if (reusedExisting) {
    const inSet = new Set((await sql`select class_id::text class_id from public.enrollments where student_id = ${studentId} and class_id = any(${classIds}::uuid[])`).map((e) => e.class_id));
    assignClassIds = classIds.filter((id) => !inSet.has(id));
  }
  if (assignClassIds.length > 0) {
    const enr = await asViewer(sql, user.id, (s) => s`insert into public.enrollments ${s(assignClassIds.map((classId) => ({ tenant_id: t, student_id: studentId, class_id: classId, start_date: startDate })))}`);
    if (enr.error) return { error: '학생은 준비됐으나 반 배정에 실패했습니다. 학생 상세에서 반을 배정해 주세요.', studentId };
    await notifyClassAssignment(sql, t, { id: user.id }, assignClassIds.map((classId) => ({ classId, studentId })), 'enrollment_assigned');
    for (const classId of assignClassIds) await audit(sql, t, user.row, 'enrollment_assign', 'student', null, { studentId, classId, startDate, source: 'enrollment_consultation' });
  }
  const renameConsult = !reusedExisting && uniqueName.name !== (c.prospect_name ?? '') ? uniqueName.name : null;
  await asViewer(sql, user.id, (s) => s`update public.enrollment_consultations set student_id = ${studentId}, outcome = 'enrolled' ${renameConsult ? s`, prospect_name = ${renameConsult}` : s``}
    where tenant_id = ${t} and id = ${consultationId}`);
  // 2.0 metadata.via = 'convert' — 공통 규약 via와 자리가 겹쳐 surface에 둔다.
  if (renameConsult) await audit(sql, t, user.row, 'enrollment_consultation_update', 'enrollment_consultations', renameConsult,
    { consultationId, changes: [{ field: '이름', from: c.prospect_name ?? null, to: renameConsult }], surface: 'convert' });
  if (c.outcome !== 'enrolled') await audit(sql, t, user.row, 'enrollment_consultation_outcome', 'enrollment_consultations', c.prospect_name ?? null,
    { consultationId, from: c.outcome, to: 'enrolled', surface: 'convert' });
  if (reusedExisting) await audit(sql, t, user.row, 'consultation_link_existing', 'enrollment_consultations', c.prospect_name ?? null, { consultationId, studentId });
  return {
    studentId, assignedClassIds: assignClassIds, startDate,
    notice: uniqueName.suffixed ? `이미 '${studentName}' 학생이 있어 '${uniqueName.name}'(으)로 등록했습니다. 다른 학생이면 그대로 두고, 같은 학생이면 학생 목록에서 정리하세요.` : undefined,
  };
}
