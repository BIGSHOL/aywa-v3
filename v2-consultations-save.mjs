// 2.0 화면 원생상담의 저장 — 2.0 "use server" 함수를 같은 이름 · 같은 인자 · 같은 검증 · 같은 표·칸 · 같은 감사로그로(Docker 복사본).
//  · features/consultations/server/actions.ts: createStudentConsultation · updateStudentConsultation · toggleConsultationFollowUp ·
//    deleteStudentConsultation · runStudentCareAnalysis(AI — 새로 부르지 않는다)
//  · features/consultations/server/audio-actions.ts: startStudentConsultationFromAudio(녹음·전사 — 하지 않는다) · runStudentConsultationAnalysis(AI — 하지 않는다)
//  · features/consultations/server/stats-prefs-actions.ts: saveConsultationStatsPrefs(본인 ui_prefs.consultations)
//  · features/media/server/upload-actions.ts: issueAudioUploadTicket(녹음 파일 올리기 — 하지 않는다)
//  (반 칸의 getConsultationClassOptions는 읽기라 화면의 읽기 경로(GET op=classOptions)로 간다 — v2-screen-consultations.mjs.)
// 2.0은 상담 행을 **세션 클라이언트 + RLS**로 쓴다 — 여기서도 고른 사람의 신분으로 쓰고(asUser), 끝나면 claims를 비우고 역할을 되돌린다
// (set_config(…, true)는 저장점을 풀어도 트랜잭션 끝까지 남는다). 신규생 체크 연결·보기 설정·감사로그는 2.0이 관리 키로 쓰는 곳이라 신분 없이 쓴다.
// 바깥 호출(AI · AssemblyAI · Storage 업로드)은 어떤 경로에서도 하지 않는다 — 2.0 함수가 실패 때 돌려주는 모양({ error })으로 한국어 사유를 돌려준다.
import { V2Error } from './v2-screens.mjs';
import { UUID, audit, readPeople, serverCall } from './v2-proc-people.mjs';
import { canConsultStudent, classOptionsFor, loadConsultRules, resolvedSettings, scopedIdOf } from './v2-consultations-read.mjs';

export const MODULES = {
  actions: 'features/consultations/server/actions.ts',
  audio: 'features/consultations/server/audio-actions.ts',
  prefs: 'features/consultations/server/stats-prefs-actions.ts',
  upload: 'features/media/server/upload-actions.ts',
};
const MENU = 'consultations';
const OUT_OF_SCOPE_CONSULTATION = '본인이 작성한 상담만 고칠 수 있습니다';
const OUT_OF_SCOPE_STUDENT = '담당 학생의 상담만 기록할 수 있습니다';
export const NO_AI = '연습 화면에서는 AI 분석을 새로 하지 않습니다 — 저장된 분석 결과만 볼 수 있습니다';
export const NO_RECORDING = '연습 화면에서는 녹음 상담을 새로 만들지 않습니다 — 아래 상담 기록 추가로 글로 남겨 주세요';
export const NO_UPLOAD = '연습 화면에서는 녹음 파일을 올리지 않습니다';
const CATEGORIES = ['general', 'academic', 'emotional', 'career', 'social', 'other'];
const AUDIENCES = ['parent', 'student', 'both'];
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** FormData 모양({ $formData: [[이름, 글자] …] }) → get · getAll. */
function formOf(arg) {
  if (!arg || typeof arg !== 'object' || !Array.isArray(arg.$formData)) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  const entries = arg.$formData.filter(e => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string');
  return { get: k => { const e = entries.find(x => x[0] === k); return e ? e[1] : null; }, getAll: k => entries.filter(x => x[0] === k).map(x => x[1]) };
}
const dbErr = e => ({ code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null, constraint: e?.constraint_name ?? null });

/**
 * 2.0 세션 클라이언트 쓰기 — 고른 사람의 신분(request.jwt.claims) + authenticated 역할로 저장점 하나. 실패하면 그 저장점만 되돌리고 { error }.
 * 🔴 끝나면(성공·실패 모두) claims를 비우고 역할을 되돌린다 — 뒤따르는 관리 키 자리의 쓰기(감사로그 · 신규생 체크)가 이 사람으로 판정되지 않게.
 */
export async function asUser(sql, u, fn) {
  try {
    const data = await sql.savepoint(async sp => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: u.id, role: 'authenticated' })}, true)`;
      await sp`set local role authenticated`;
      return fn(sp);
    });
    return { data };
  } catch (e) {
    if (e instanceof V2Error) throw e;
    return { error: dbErr(e) };
  } finally {
    await sql`select set_config('request.jwt.claims', '', true)`;
    await sql`set local role none`;
  }
}

async function ctxOf({ sql, body, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadConsultRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const u = typeof body.actor === 'string' ? people.editors.find(e => e.id === body.actor) ?? null : null;
  const settings = resolvedSettings(people);
  return { R, people, settings, t, sql, u, user: u ? { id: u.id, tenantId: t, displayName: u.display_name, systemRole: u.role, row: u } : null };
}
const canWrite = (c) => { const lv = c.people.level(c.u, MENU); return lv === 'full' || lv === 'scoped'; };
const explain = (c, error, scope, fallback, op) => c.R.dbError.explainDbError(error, { scope, fallback, ...(op ? { op } : {}) }).message;

function readConsultationForm(c, fd) {
  const get = k => { const v = fd.get(k); return v == null ? '' : String(v).trim(); };
  const category = get('category'), audience = get('audience'), classPick = get('classPick');
  return {
    classPick: classPick === 'auto' || classPick === 'manual' ? classPick : null,
    classId: get('classId') || null, studentId: get('studentId'), counselorId: get('counselorId') || null, consultedAt: get('consultedAt'),
    category: CATEGORIES.includes(category) ? category : null, subject: get('subject') || null, audience: AUDIENCES.includes(audience) ? audience : null,
    summary: c.R.link.visibleConsultationSummary(get('summary')), followUpAction: get('followUpAction') || null, followUpDate: get('followUpDate') || null,
    followUpDone: get('followUpDone') === 'true',
  };
}
function validateConsultation(input) {
  const errors = {};
  if (!input.studentId) errors.studentId = '학생을 선택해주세요';
  if (!input.summary || input.summary.length < 5) errors.summary = '요약을 5자 이상 작성해주세요';
  if (!input.consultedAt) errors.consultedAt = '상담 일시를 입력해주세요';
  return Object.keys(errors).length > 0 ? errors : null;
}
/** 폼 값이 uuid가 아니면 2.0 PostgREST가 조회 오류를 내는 자리 — 같은 '찾지 못함' 갈래로 보낸다. */
const uuidOr = v => (v && UUID.test(v) ? v : null);

async function subjectForConsultation(c, counselorId, entered) {
  const r = await asUser(c.sql, c.u, sp => sp`select subjects from public.users where id=${uuidOr(counselorId)} and tenant_id=${c.t}`);
  const counselor = r.data?.[0];
  if (r.error || !counselor) return { subject: null, error: '상담사를 확인할 수 없습니다.' };
  if (entered) return { subject: entered };
  return { subject: c.R.subject.consultationSubject(null, counselor.subjects, c.R.subjects.subjectLabelRecord(c.settings.operations.subjects)) };
}

/** class-save.ts decideClassForSave — 사람이 고른 반은 그날 그 학생의 수강 반이어야 · 그 밖은 서버가 다시 판정. */
async function decideClassForSave(c, input) {
  const r = await asUser(c.sql, c.u, sp => classOptionsFor(sp, c.R, c.settings, { studentId: input.studentId, date: input.date ?? '', counselorId: input.counselorId, subject: input.subject }));
  if (r.error) return null; // 2.0: 판정 실패는 반 없이(또는 반은 그대로) 저장
  const found = r.data;
  if (input.pick === 'manual') {
    if (!input.pickedClassId) return { supported: true, classId: null, className: null, source: 'manual', reason: null };
    const picked = found.options.find(o => o.id === input.pickedClassId);
    if (!picked) return { supported: true, error: '고른 반이 그날 이 학생의 수강 반이 아닙니다 — 반을 다시 골라 주세요' };
    return { supported: true, classId: picked.id, className: picked.name, source: 'manual', reason: null };
  }
  const auto = found.auto.classId ? found.options.find(o => o.id === found.auto.classId) : undefined;
  return { supported: true, classId: found.auto.classId, className: auto?.name ?? null, source: 'auto', reason: found.auto.reason };
}
const classColumns = d => (!d || !d.supported || 'error' in d ? {} : { class_id: d.classId, class_source: d.source });
const classAudit = d => (!d || !d.supported || 'error' in d ? {} : { classId: d.classId, className: d.className, classPick: d.source });

// ── 신규생 체크 연결(newcomers/server/consult-link.ts) — 관리 키 · 손 체크가 이긴다 ─────────────────────────────────────
async function linkedRowsOf(sql, t, consultationId) {
  try {
    return await sql.savepoint(sp => sp`select id::text id, student_id::text student_id, subject, item_key, done_on::text done_on, done_by::text done_by
      from public.student_onboarding_checks where tenant_id=${t} and consultation_id=${consultationId}`);
  } catch { return null; }
}
async function unlinkRows(c, consultationId, rows, afterDelete = false) {
  const { sql, t } = c;
  for (const r of rows) {
    const done = await sql`update public.student_onboarding_checks set done_on=null, done_by=null, consultation_id=null
      where tenant_id=${t} and id=${r.id} and ${afterDelete ? sql`consultation_id is null` : sql`consultation_id=${consultationId}`}
      and ${r.done_on ? sql`done_on=${r.done_on}::date` : sql`done_on is null`} and ${r.done_by ? sql`done_by=${r.done_by}` : sql`done_by is null`} returning id`;
    if (!r.done_on || done.length === 0) continue;
    await audit(sql, t, c.u, 'newcomer_uncheck', 'student', null, { studentId: r.student_id, itemKey: r.item_key, doneOn: null, subject: r.subject, consultationId, via: 'consultation' });
  }
}
async function writeLinkedCheck(c, input, p) {
  const { sql, t } = c;
  const [cur] = await sql`select id::text id, done_on::text done_on, consultation_id::text consultation_id from public.student_onboarding_checks
    where tenant_id=${t} and student_id=${input.studentId} and subject=${p.subject} and item_key=${p.itemKey}`;
  if (!cur) {
    try {
      await sql.savepoint(sp => sp`insert into public.student_onboarding_checks (tenant_id, student_id, subject, item_key, done_on, done_by, consultation_id)
        values (${t}, ${input.studentId}, ${p.subject}, ${p.itemKey}, ${input.consultedOn}, ${input.userId}, ${input.consultationId})`);
    } catch (e) { if (e?.code === '23505') return false; throw e; }
    return true;
  }
  const mine = !!cur.done_on && cur.consultation_id === input.consultationId;
  if (cur.done_on && !mine) return false;
  if (mine && cur.done_on === input.consultedOn) return false;
  const upd = await sql`update public.student_onboarding_checks set done_on=${input.consultedOn}::date, done_by=${input.userId}, consultation_id=${input.consultationId}
    where tenant_id=${t} and id=${cur.id} and (done_on is null or consultation_id=${input.consultationId}) returning id`;
  return upd.length > 0;
}
/** applyConsultationNewcomerLinks — 고른 칸을 완료로, 이 상담으로 했던 칸 중 빠진 것은 해제. 실패해도 상담 저장은 되돌리지 않는다(2.0처럼 로그만). */
async function applyNewcomerLinks(c, input) {
  const { R, sql, t } = c;
  if (!R.modules.isModuleEnabled(c.settings.modules?.disabled, 'newcomers')) return {};
  const existing = await linkedRowsOf(sql, t, input.consultationId);
  if (!existing) return { error: '신규생 체크 연결을 확인하지 못했습니다' };
  const picks = new Map();
  for (const p of input.picks) if (R.consultLink.CONSULT_LINK_ITEM_KEYS.includes(p.itemKey)) picks.set(`${p.subject}|${p.itemKey}`, p);
  try {
    return await sql.savepoint(async () => {
      const drop = existing.filter(r => r.student_id !== input.studentId || (input.renderedSubjects.has(r.subject) && !picks.has(`${r.subject}|${r.item_key}`)));
      await unlinkRows(c, input.consultationId, drop);
      for (const [k, p] of picks) if (!input.renderedSubjects.has(p.subject)) picks.delete(k);
      if (picks.size === 0) return {};
      const [student] = await sql`select id::text id, name, enrolled_at::text enrolled_at, status::text status from public.students where tenant_id=${t} and id=${input.studentId}`;
      const enrolledOn = student?.enrolled_at ? String(student.enrolled_at).slice(0, 10) : null;
      if (!student || !['enrolled', 'on_hold'].includes(String(student.status)) || !enrolledOn || enrolledOn < R.onboarding.newcomerWindowStart(R.kst.kstToday())) {
        return { error: '신규생 관리 대상이 아니라 체크하지 않았습니다' };
      }
      for (const p of picks.values()) {
        if (p.subject !== R.rows.ANY_SUBJECT) {
          const [hit] = await sql`select 1 from public.enrollments e join public.classes k on k.id = e.class_id
            where e.tenant_id=${t} and e.student_id=${input.studentId} and k.tenant_id=${t} and k.subject=${p.subject} limit 1`;
          if (!hit) continue;
        }
        if (!(await writeLinkedCheck(c, input, p))) continue;
        await audit(sql, t, c.u, 'newcomer_check', 'student', student.name ?? null, { studentId: input.studentId, itemKey: p.itemKey, doneOn: input.consultedOn, subject: p.subject, consultationId: input.consultationId, via: 'consultation' });
      }
      return {};
    });
  } catch { return { error: '신규생 체크를 저장하지 못했습니다' }; }
}
async function linkNewcomerChecks(c, consultationId, input, fd) {
  const picks = fd.getAll('newcomerLink').map(v => c.R.consultLink.decodeLinkPick(String(v))).filter(Boolean);
  const consultedOn = c.R.kst.kstDateOf(c.R.kst.kstLocalToIso(input.consultedAt)) ?? c.R.kst.kstToday();
  const res = await applyNewcomerLinks(c, { tenantId: c.t, userId: c.u.id, consultationId, studentId: input.studentId, consultedOn,
    renderedSubjects: new Set(fd.getAll('newcomerLinkRow').map(String)), picks });
  if (res.error) console.error('[consultation] newcomer link:', res.error);
}

// ── actions.ts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function createStudentConsultation(c, fd) {
  if (!c.u) return { error: '로그인이 필요합니다' };
  if (!canWrite(c)) return { error: '상담 관리 권한이 없습니다' };
  const input = readConsultationForm(c, fd), fieldErrors = validateConsultation(input);
  if (fieldErrors) return { fieldErrors };
  const scopedId = scopedIdOf(c.people, c.u);
  if (scopedId) {
    if (input.counselorId && input.counselorId !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    const ok = await asUser(c.sql, c.u, sp => canConsultStudent(sp, c.R, c.people, c.u, uuidOr(input.studentId)));
    if (ok.error || !ok.data) return { error: OUT_OF_SCOPE_STUDENT };
  }
  const counselorId = input.counselorId ?? c.u.id;
  const resolved = await subjectForConsultation(c, counselorId, input.subject);
  if (resolved.error) return { error: resolved.error };
  const consultedIso = c.R.kst.kstLocalToIso(input.consultedAt) ?? new Date().toISOString(), consultedOn = c.R.kst.kstDateOf(consultedIso);
  const decision = await decideClassForSave(c, { studentId: input.studentId, date: consultedOn, counselorId, subject: resolved.subject, pick: input.classPick ?? 'auto', pickedClassId: input.classId });
  if (decision && decision.supported && 'error' in decision) return { error: decision.error };
  const cls = classColumns(decision);
  const ins = await asUser(c.sql, c.u, sp => sp`insert into public.student_consultations (tenant_id, student_id, counselor_id, consulted_at, category, subject, audience, summary,
      follow_up_action, follow_up_date, follow_up_done${'class_source' in cls ? sp`, class_id, class_source` : sp``})
    values (${c.t}, ${input.studentId}, ${counselorId}, ${consultedIso}, ${input.category}, ${resolved.subject}, ${input.audience}, ${c.R.paste.stripPastedMarkup(input.summary)},
      ${input.followUpAction}, ${input.followUpDate}, ${input.followUpDone}${'class_source' in cls ? sp`, ${cls.class_id}, ${cls.class_source}` : sp``}) returning id::text id`);
  const row = ins.data?.[0];
  if (ins.error || !row) return { error: explain(c, ins.error, 'consultations.create', '상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  await linkNewcomerChecks(c, row.id, input, fd);
  await audit(c.sql, c.t, c.u, 'student_consultation_create', 'student_consultation', null, {
    consultationId: row.id, studentId: input.studentId, consultedAt: consultedOn, category: input.category, audience: input.audience,
    hasFollowUp: !!input.followUpAction, followUpDate: input.followUpDate, ...classAudit(decision) });
  return { ok: true, redirectTo: '/consultations', nonce: Date.now() };
}

async function updateStudentConsultation(c, fd) {
  if (!c.u) return { error: '로그인이 필요합니다' };
  if (!canWrite(c)) return { error: '상담 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const input = readConsultationForm(c, fd), fieldErrors = validateConsultation(input);
  if (fieldErrors) return { fieldErrors };
  const scopedId = scopedIdOf(c.people, c.u);
  if (scopedId) {
    const cur = await asUser(c.sql, c.u, sp => sp`select student_id::text student_id, counselor_id::text counselor_id from public.student_consultations where id=${id}`);
    if (cur.error) return { error: '상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    const current = cur.data[0];
    if (!current) return { error: '상담을 찾을 수 없습니다' };
    if (current.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    if (input.counselorId && input.counselorId !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    if (current.student_id !== input.studentId) {
      const ok = await asUser(c.sql, c.u, sp => canConsultStudent(sp, c.R, c.people, c.u, uuidOr(input.studentId)));
      if (ok.error || !ok.data) return { error: OUT_OF_SCOPE_STUDENT };
    }
  }
  const counselorId = input.counselorId ?? c.u.id;
  const resolved = await subjectForConsultation(c, counselorId, input.subject);
  if (resolved.error) return { error: resolved.error };
  const read = await asUser(c.sql, c.u, sp => sp`select c.summary, c.student_id::text student_id, c.subject, c.category, to_json(c.consulted_at)#>>'{}' consulted_at,
      c.class_id::text class_id, c.class_source, k.class_name from public.student_consultations c left join public.classes k on k.id = c.class_id
    where c.id=${id} and c.tenant_id=${c.t}`);
  const stored = read.data?.[0];
  if (read.error || !stored) return { error: '상담 기록을 찾지 못했습니다' };
  const prevClass = { id: stored.class_id ?? null, name: stored.class_name ?? null, source: stored.class_source ?? null };
  const consultedIso = c.R.kst.kstLocalToIso(input.consultedAt) ?? new Date().toISOString(), consultedOn = c.R.kst.kstDateOf(consultedIso);
  const contextChanged = stored.student_id !== input.studentId || c.R.kst.kstDateOf(stored.consulted_at) !== consultedOn;
  const keepManual = !input.classPick && prevClass.source === 'manual' && !contextChanged;
  const decision = keepManual ? null
    : await decideClassForSave(c, { studentId: input.studentId, date: consultedOn, counselorId, subject: resolved.subject, pick: input.classPick ?? 'auto', pickedClassId: input.classId });
  if (decision && decision.supported && 'error' in decision) return { error: decision.error };
  const judged = decision && decision.supported && !('error' in decision) ? decision : null;
  const resetStale = !judged && contextChanged && (prevClass.id !== null || prevClass.source !== null);
  const classPatch = judged ? classColumns(judged) : resetStale ? { class_id: null, class_source: null } : {};
  const cleanSummary = c.R.paste.stripPastedMarkup(input.summary) ?? '';
  const summary = stored.student_id === input.studentId && stored.subject === resolved.subject && stored.category === 'academic' && input.category === 'academic'
    ? c.R.link.preserveConsultationLink(cleanSummary, stored.summary ?? '') : cleanSummary;
  const savedClass = !!judged || resetStale;
  const upd = await asUser(c.sql, c.u, sp => sp`update public.student_consultations set student_id=${input.studentId}, counselor_id=${counselorId}, consulted_at=${consultedIso},
      category=${input.category}, subject=${resolved.subject}, audience=${input.audience}, summary=${summary}, follow_up_action=${input.followUpAction},
      follow_up_date=${input.followUpDate}, follow_up_done=${input.followUpDone}${savedClass ? sp`, class_id=${classPatch.class_id}, class_source=${classPatch.class_source}` : sp``}
    where id=${id} and tenant_id=${c.t}`);
  if (upd.error) return { error: explain(c, upd.error, 'consultations.update', '상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  await linkNewcomerChecks(c, id, input, fd);
  await audit(c.sql, c.t, c.u, 'student_consultation_update', 'student_consultation', null, {
    consultationId: id, studentId: input.studentId, consultedAt: consultedOn, category: input.category, audience: input.audience,
    hasFollowUp: !!input.followUpAction, followUpDate: input.followUpDate,
    ...(savedClass && judged ? classAudit(judged) : {}),
    ...(savedClass && !judged ? { classId: null, className: null } : {}),
    ...(savedClass && prevClass.source !== null && (judged ? judged.classId : null) !== prevClass.id ? { prevClassId: prevClass.id, prevClassName: prevClass.name } : {}),
  });
  return { ok: true, redirectTo: '/consultations', nonce: Date.now() };
}

/** 후속 조치 완료 토글 — 업무 흐름 신호 followup_due가 여기서 끝난다(follow_up_done 반전). 강사는 본인이 쓴 상담만. */
async function toggleConsultationFollowUp(c, fd) {
  if (!c.u) return { error: '로그인이 필요합니다' };
  if (!canWrite(c)) return { error: '상담 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim(), done = String(fd.get('done') ?? 'false') === 'true';
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const scopedId = scopedIdOf(c.people, c.u);
  // id는 2.0처럼 그대로 넘긴다 — uuid가 아니면 DB 오류(2.0 PostgREST와 같은 갈래 → explainDbError 문구).
  const r = await asUser(c.sql, c.u, sp => sp`update public.student_consultations set follow_up_done=${done} where id=${id}
    ${scopedId ? sp`and counselor_id=${scopedId}` : sp``} returning student_id::text student_id`);
  if (r.error) return { error: explain(c, r.error, 'consultations.followUp', '후속조치를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  const row = r.data[0];
  if (scopedId && !row) return { error: OUT_OF_SCOPE_CONSULTATION };
  await audit(c.sql, c.t, c.u, 'student_consultation_follow_up', 'student_consultation', null, { consultationId: id, studentId: row?.student_id ?? null, done });
  return undefined;
}

async function deleteStudentConsultation(c, fd) {
  if (!c.u) return { error: '로그인이 필요합니다' };
  if (!canWrite(c)) return { error: '상담 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim(), studentId = String(fd.get('studentId') ?? '').trim();
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const b = await asUser(c.sql, c.u, sp => sp`select student_id::text student_id, counselor_id::text counselor_id, to_json(consulted_at)#>>'{}' consulted_at, category, audience,
    follow_up_action, follow_up_done from public.student_consultations where id=${id}`);
  const before = b.data?.[0] ?? null;
  const scopedId = scopedIdOf(c.people, c.u);
  if (scopedId) {
    if (b.error) return { error: '상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    if (!before || before.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
  }
  const linked = await linkedRowsOf(c.sql, c.t, id);
  if (!linked) return { error: '신규생 체크 연결을 확인하지 못했습니다 — 상담을 지우지 않았습니다' };
  const del = await asUser(c.sql, c.u, sp => sp`delete from public.student_consultations where id=${id} ${scopedId ? sp`and counselor_id=${scopedId}` : sp``}`);
  if (del.error) return { error: explain(c, del.error, 'consultations.delete', '상담을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (linked.length) { try { await c.sql.savepoint(() => unlinkRows(c, id, linked, true)); } catch (e) { console.error('[consultation] newcomer unlink after delete:', e?.message); } }
  await audit(c.sql, c.t, c.u, 'student_consultation_delete', 'student_consultation', null, {
    consultationId: id, studentId: before?.student_id ?? (studentId || null), consultedAt: c.R.kst.kstDateOf(before?.consulted_at),
    category: before?.category ?? null, audience: before?.audience ?? null, hasFollowUp: !!before?.follow_up_action });
  // 2.0은 여기서 redirect(redirectTo) — 연습 화면은 화면(호스트)이 같은 주소로 옮긴다.
  return undefined;
}

// ── AI · 녹음 — 바깥 호출 0(2.0 실패 모양 { error }) ───────────────────────────────────────────────────────────────────
async function runStudentCareAnalysis(c) {
  if (!c.u) return { error: '로그인이 필요합니다' };
  if (c.people.level(c.u, 'students') !== 'full') return { error: 'AI 케어 분석 권한이 없습니다 — 강사 계정은 열람 전용입니다' };
  return { error: NO_AI };
}
async function requireConsultationWrite(c) {
  if (!c.u) return '로그인이 필요합니다';
  return canWrite(c) ? null : '상담 관리 권한이 없습니다';
}
async function startStudentConsultationFromAudio(c) { return { error: (await requireConsultationWrite(c)) ?? NO_RECORDING }; }
async function runStudentConsultationAnalysis(c) { return { error: (await requireConsultationWrite(c)) ?? NO_AI }; }
async function issueAudioUploadTicket(c) { return { error: c.u ? NO_UPLOAD : '로그인이 필요합니다' }; }

// ── stats-prefs-actions.ts(본인 ui_prefs.consultations — 관리 키 · 형제 키 보존) ───────────────────────────────────────
async function saveConsultationStatsPrefs(c, p) {
  if (!c.u) return { ok: false, error: '로그인이 필요합니다' };
  const R = c.R, patch = {};
  p = plain(p) ? p : {};
  if (p.unit === 'week' || p.unit === 'month') patch.stats_unit = p.unit === 'week' ? 'week' : undefined;
  if (p.metric && R.stats.STATS_METRICS.includes(p.metric)) patch.stats_metric = p.metric === 'count' ? undefined : p.metric;
  if (p.dim && R.stats.STATS_DIMS.includes(p.dim)) patch.stats_dim = p.dim === 'counselor' ? undefined : p.dim;
  if (plain(p.hrSort) && R.sortH.parseHomeroomSortKey(p.hrSort.key) && (p.hrSort.dir === 'asc' || p.hrSort.dir === 'desc')) {
    const isDefault = p.hrSort.key === 'name' && p.hrSort.dir === 'asc';
    patch.hr_sort = isDefault ? undefined : p.hrSort.key;
    patch.hr_dir = isDefault ? undefined : p.hrSort.dir;
  }
  if (p.hrFilter) { const f = R.sortH.parseHomeroomFilter(p.hrFilter); patch.hr_filter = R.sortH.isDefaultHomeroomFilter(f) ? undefined : f; }
  if (Object.keys(patch).length === 0) return { ok: false, error: '잘못된 값입니다' };
  const [row] = await c.sql`select ui_prefs from public.users where id=${c.u.id} and tenant_id=${c.t}`;
  const raw = plain(row?.ui_prefs) ? row.ui_prefs : {}, scope = plain(raw.consultations) ? { ...raw.consultations } : {};
  for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete scope[key]; else scope[key] = value; }
  const merged = { ...raw };
  if (Object.keys(scope).length === 0) delete merged.consultations; else merged.consultations = scope;
  await c.sql`update public.users set ui_prefs=${c.sql.json(merged)} where id=${c.u.id} and tenant_id=${c.t}`;
  return { ok: true };
}

const formAction = (module, fn) => ({
  validate: raw => ({ ...serverCall(raw, [module], 2), module }),
  run: async ctx => { const c = await ctxOf(ctx); return fn(c, formOf(ctx.body.args[1])); },
});
export const consultationActions = {
  createStudentConsultation: formAction(MODULES.actions, createStudentConsultation),
  updateStudentConsultation: formAction(MODULES.actions, updateStudentConsultation),
  toggleConsultationFollowUp: formAction(MODULES.actions, toggleConsultationFollowUp),
  deleteStudentConsultation: formAction(MODULES.actions, deleteStudentConsultation),
  runStudentCareAnalysis: formAction(MODULES.actions, runStudentCareAnalysis),
  startStudentConsultationFromAudio: formAction(MODULES.audio, startStudentConsultationFromAudio),
  runStudentConsultationAnalysis: formAction(MODULES.audio, runStudentConsultationAnalysis),
  issueAudioUploadTicket: formAction(MODULES.upload, issueAudioUploadTicket),
  saveConsultationStatsPrefs: {
    validate: raw => serverCall(raw, [MODULES.prefs], 1),
    run: async ctx => saveConsultationStatsPrefs(await ctxOf(ctx), ctx.body.args[0]),
  },
};
