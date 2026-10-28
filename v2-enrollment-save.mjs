// 2.0 신규 콜&상담 · 저장(features/enrollment/server/actions.ts) — 같은 이름 · 같은 인자 · 같은 검증 · 같은 표·칸 · 같은 감사로그를 Docker 복사본에.
//  · updateEnrollmentConsultation(_prev, FormData) — 상담 수정(바꾼 칸만 저장 · 후속 조치 · 상담자 계정 · 소개한 사람 · 학교급 채움).
//    판정은 2.0 순수 함수 그대로(consultation-form-row · consultation-changed · follow-up · consultation-edit · counselor-account ·
//    consultation-audit · referrer · school-name). 2.0은 세션 클라이언트(RLS)로 쓴다 — 여기선 tenant_id를 직접 건다.
//    🔴 동시 저장 판정(2.0 `.eq("updated_at", 읽은 값)`)은 시각을 **글자로** 견준다 — postgres.js에 시각 글자를 ::timestamptz로 넘기면
//       마이크로초가 잘려 늘 0행(= 늘 '다른 저장이 먼저')이 된다.
//    녹음 첨부(audioPath)는 연습 화면에서 받지 않는다(업로드 자체를 거절 — 전사·AI 분석 없음).
import { audit } from './v2-proc-people.mjs';
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
    [saved] = await sql.savepoint((sp) => sp`update public.enrollment_consultations set ${setList(sp, write)}
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
  if (String(formData.get('audioPath') ?? '').trim()) return { error: '입력 내용은 저장되었습니다. 녹음 첨부만 실패: 연습 화면에서는 녹음을 받지 않습니다', saved: true };
  return { ok: true };
}

const OUTCOMES = ['pending', 'scheduled', 'consulted', 'ai_done', 'enrolled', 'declined', 'no_show'];
const dbWhy = (S, error, fallback) => S.dbError.describeDbError({ code: error?.code, message: error?.message ?? '', details: error?.detail ?? null, hint: error?.hint ?? null },
  { fallback, op: 'write' }).message;

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
    await sql.savepoint((sp) => sp`update public.enrollment_consultations set outcome = ${outcome}, updated_at = ${new Date().toISOString()} where tenant_id = ${t} and id = ${id}`);
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
    [updated] = await sql.savepoint((sp) => sp`update public.enrollment_consultations set ${setList(sp, { ...row, updated_at: new Date().toISOString() })}
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
  if (String(formData.get('audioPath') ?? '').trim()) return { error: '연습 화면에서는 녹음을 받지 않습니다' };
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
    [data] = await sql.savepoint((sp) => {
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
