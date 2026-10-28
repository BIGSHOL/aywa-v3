// 직원관리 하위 화면(작업자 B) — 이력서(/staff/resumes · /staff/resumes/new · /staff/resumes/<id>).
// 2.0 원본: app/(shell)/staff/resumes/** · features/staff/resume/server/{resume-queries,resume-access,resume-actions}.ts.
//  · 이력서(academy_documents.form_data — 주민번호·급여·계좌가 든 restricted 행)는 2.0처럼 **고른 사람의 세션 RLS**로 읽고
//    (restricted 가드 정책을 그대로 지난다), 열람 게이트 canViewResume(직원관리 메뉴 + 과목 범위, 또는 본인)을 통과할 때만
//    form_data를 내려보낸다. 통과 못 하면 응답에 이력서 내용이 아예 없다(2.0 '열람 제한' 상자).
//  · 증명사진 = Storage 서명 주소를 만들지 않는다(사진 자리는 비어 보인다) · 사진 올리기 = 2.0 티켓 발급 실패 모양으로 거절.
//  · 저장 = saveStaffResume · deleteStaffResume · issueResumePhotoTicket(같은 이름·인자·검증·문구·감사로그). 바깥 호출
//    (직원명부 구글 시트 기입 · 로그인 계정 만들기 · 사진 지우기)은 하지 않는다 — 2.0이 그 부가 효과를
//    실패로 알리던 경고 모양으로 돌려준다(이력서 저장 자체는 된다). 시트 기입은 2.0의 '설정 안 됨'(조용히 건너뜀) 모양.
import { UUID, audit, readPeople, serverCall } from './v2-proc-people.mjs';
import { asActor, canSeeStaffMember, formOf } from './v2-staff-sub-common.mjs';
import { applyStaffEmailChange, applyStaffNameChange } from './v2-staff-save.mjs';

const MENU = 'staff', RESUME = 'features/staff/resume/server/resume-actions.ts';
const UUID_BODY = UUID.source.slice(1, -1);
const PATH = new RegExp(`^/staff/resumes(?:/new|/(${UUID_BODY}))?$`, 'i');
export const isResumePath = p => PATH.test(p);
const RESUME_LOCKED_MSG = '이력서는 직원관리 권한이 있는 계정과 본인만 열람·수정할 수 있습니다';
const NO_ACCOUNT = '연습 화면에서는 로그인 계정을 바꾸지 않습니다';

let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [resume, roles, email, dept, subjects, storage] = await Promise.all([
      'features/staff/resume/resume.ts', 'lib/auth/role-hierarchy.ts', 'features/staff/email.ts',
      'features/staff/department/department-subjects.ts', 'features/owner/subjects.ts', 'lib/storage/legacy-audio-path.ts',
    ].map(p => importV2(p)));
    return { ...resume, ...roles, ...email, ...dept, buildSubjectMaps: subjects.buildSubjectMaps, isTenantDocumentPath: storage.isTenantDocumentPath };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const staffWrite = (people, u) => { const lv = people.level(u, MENU); return lv === 'full' || lv === 'scoped'; };
/** 2.0 canViewResume — 본인 이력서 · 직원관리 메뉴 접근자(과목 범위가 걸리면 범위 안 직원의 것만, 주인 모르면 거절). */
async function canViewResume(sql, t, people, user, owner) {
  if (owner && owner === user.id) return true;
  if (people.level(user, MENU) === 'none') return false;
  if (!people.staffScope(user)) return true;
  if (!owner) return false;
  return canSeeStaffMember(sql, t, people, user, owner);
}

// ── 조회 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const readResume = (s, id) => s`select d.id::text id, d.form_data, to_json(d.created_at)#>>'{}' created_at, to_json(d.updated_at)#>>'{}' updated_at,
    d.uploaded_by::text uploaded_by, d.staff_user_id::text staff_user_id, u.display_name author_name
  from public.academy_documents d left join public.users u on u.id = d.uploaded_by where d.id=${id} and d.form_type='staff_resume'`;

export async function resumeLoad({ sql, params, tenantId: t, importV2, path }) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const editors = people.editorList, operations = people.settings.operations, u = people.pick(params?.actor);
  if (path === '/staff/resumes') return { editors, redirect: '/staff' }; // 2.0: 목록은 따로 없다 — 직원목록으로
  if (!u) return { notAllowed: true, editors };
  if (path === '/staff/resumes/new') {
    if (!staffWrite(people, u)) return { editors, redirect: '/staff' };
    let staff = null;
    if (params?.staff) {
      const [row] = await asActor(sql, u.id, s => s`select id::text id, display_name, english_name, email, phone, hire_date::text hire_date,
        department, employment_type, job_title, subjects from public.users where id=${params.staff}`);
      if (row && await canSeeStaffMember(sql, t, people, u, row.id, Array.isArray(row.subjects) ? row.subjects : [])) staff = row;
    }
    const data = R.emptyResume();
    if (staff) {
      data.personal.name = staff.display_name;
      data.personal.nameEn = staff.english_name ?? '';
      data.personal.email = R.isImportArtifactEmail(staff.email) ? '' : staff.email;
      data.personal.phone = staff.phone ?? '';
      data.contract.startDate = staff.hire_date ?? '';
      data.contract.division = staff.department ?? '';
      data.contract.employmentType = staff.employment_type ?? '';
      data.contract.jobTitle = staff.job_title ?? '';
    }
    return { editors, operations, userId: u.id, data, staff: staff ? { id: staff.id, displayName: staff.display_name } : null,
      assignableRoles: staff ? [] : R.assignableRoles(u.role) };
  }
  const id = PATH.exec(path)[1];
  const [resume] = await asActor(sql, u.id, s => readResume(s, id));
  if (!resume) return { editors, notFound: true };
  const data = R.normalizeResume(resume.form_data);
  const canView = await canViewResume(sql, t, people, u, resume.staff_user_id);
  const canWrite = canView && (staffWrite(people, u) || resume.staff_user_id === u.id);
  const head = { editors, operations, id, userId: u.id, name: data.personal.name || '(이름 미입력)', createdAt: resume.created_at,
    authorName: resume.author_name ?? null, canView, canWrite };
  // 🔴 열람 못 하면 이력서 내용(form_data)을 응답에 싣지 않는다 — 2.0도 sheet를 렌더하지 않아 클라로 가지 않는다.
  if (!canView) return head;
  // 증명사진 = 서명 주소를 만들지 않는다(Storage 호출 없음) — 2.0에서 주소를 못 얻은 사진과 같은 빈 자리.
  return { ...head, data, staffUserId: resume.staff_user_id ?? null, canWriteRole: staffWrite(people, u), edit: params?.edit ?? null,
    photoUrls: data.photos.map(() => null) };
}

// ── 저장 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function ctxOf({ sql, body, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const user = typeof body.actor === 'string' ? people.users.find(x => x.id === body.actor && !people.operators.has(x.id)) : null;
  return { R, people, sql, t, user, importV2 };
}
/** 2.0 requireResumeAccess — 행(RLS) · 열람 자격 · 남의 것이면 직원관리 쓰기. */
async function requireResumeAccess(c, id) {
  const { sql, t, people, user } = c;
  if (!user) return { error: '로그인이 필요합니다' };
  const [data] = UUID.test(id) ? await asActor(sql, user.id, s => s`select staff_user_id::text staff_user_id from public.academy_documents where id=${id} and form_type='staff_resume'`) : [];
  if (!data) return { error: '이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다' };
  const owner = data.staff_user_id ?? null;
  if (!(await canViewResume(sql, t, people, user, owner))) return { error: RESUME_LOCKED_MSG };
  if (owner !== user.id && !staffWrite(people, user)) return { error: '직원관리 권한이 없습니다' };
  return { ok: true };
}
const dbFail = (c, e, action) => ({ error: c.people.P.dbError.humanizeDbError(e?.message, action), detail: e?.message });
async function trySql(fn) { try { return { rows: await fn() }; } catch (e) { return { e }; } }

async function subjectsForDivision(c, division) {
  if (!division.trim()) return [];
  return c.R.subjectsFromDepartment(division, c.R.buildSubjectMaps(c.people.settings.operations.subjects).options);
}

/** 2.0 registerStaffFromResume — 같은 이메일 직원 연결(DB)까지. 새 로그인 계정 만들기는 하지 않는다(실패 경고 모양). */
async function registerStaffFromResume(c, data, roleRaw, resumeId) {
  const { R, sql, t, user, people } = c;
  if (!staffWrite(people, user)) return { warning: '직원 계정 등록 권한이 없어 이력서만 저장했습니다' };
  const role = roleRaw;
  if (!(role in R.ROLE_HIERARCHY) || role === 'student') return { warning: '직원 계정 역할을 선택하지 않아 이력서만 저장했습니다' };
  if (R.ROLE_HIERARCHY[user.role] >= R.ROLE_HIERARCHY[role]) return { warning: `'${role}' 역할은 본인 권한으로 부여할 수 없어 이력서만 저장했습니다` };
  let email = data.personal.email.trim().toLowerCase();
  if (!email || !R.EMAIL_RE.test(email)) {
    const taken = new Set((await sql`select lower(email) e from public.users where tenant_id=${t} and email is not null union select lower(email) from auth.users where email is not null`).map(r => r.e));
    const made = R.autoStaffEmail(data.personal.name, taken);
    if (!made) return { warning: '로그인 이메일을 자동으로 만들지 못했습니다 — 인적사항 E-mail을 직접 입력하세요' };
    email = made;
  }
  const derived = await subjectsForDivision(c, data.contract.division);
  const profile = { phone: data.personal.phone || null, hire_date: data.contract.startDate || null, department: data.contract.division || null,
    employment_type: data.contract.employmentType || null, job_title: data.contract.jobTitle || null };
  // 2.0 .ilike("email", email).maybeSingle() — 둘 이상이면 오류라 연결하지 않는다(dup = null).
  const dups = await sql`select id::text id, display_name, phone, hire_date::text hire_date, department, employment_type, job_title, subjects
    from public.users where tenant_id=${t} and email ilike ${email} limit 2`;
  const dup = dups.length === 1 ? dups[0] : null;
  if (dup) {
    const fill = {};
    for (const k of ['phone', 'hire_date', 'department', 'employment_type', 'job_title']) if (!dup[k] && profile[k]) fill[k] = profile[k];
    if (derived.length > 0 && !(Array.isArray(dup.subjects) && dup.subjects.length > 0)) fill.subjects = derived;
    if (Object.keys(fill).length > 0) await sql`update public.users set ${sql(fill)} where id=${dup.id}`;
    await sql`update public.academy_documents set staff_user_id=${dup.id} where id=${resumeId}`;
    await audit(sql, t, user, 'staff_link_from_resume', 'user', data.personal.name, { resumeId, userId: dup.id, filled: Object.keys(fill) });
    return { notice: `이미 등록된 직원(${dup.display_name ?? email})과 이력서를 연결했습니다` };
  }
  return { warning: `이력서는 저장됐지만 계정 생성에 실패했습니다 — ${NO_ACCOUNT}` };
}

function realFormData(entries) { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; }

async function saveStaffResume(c, fdRaw) {
  const { R, sql, t, user, people } = c;
  const fd = formOf(fdRaw);
  const id = String(fd.get('id') ?? '').trim();
  const linkRaw = String(fd.get('staff_user_id') ?? '').trim();
  const selfCreate = !id && !!user && linkRaw === user.id;
  if (!user) return { error: '로그인이 필요합니다' };
  if (id) { const g = await requireResumeAccess(c, id); if (g.error) return g; }
  else if (selfCreate) { if (user.role === 'student') return { error: '권한이 없습니다' }; }
  else if (!staffWrite(people, user)) return { error: '직원관리 권한이 없습니다' };
  const data = R.parseResumeForm(realFormData(fd.entries));
  if (!data.personal.name) return { error: '성명을 입력하세요' };
  for (const p of data.photos) if (!R.isTenantDocumentPath(p, t)) return { error: '사진 경로가 올바르지 않습니다 — 사진을 다시 첨부하세요' };

  if (id) {
    const [before] = await asActor(sql, user.id, s => s`select form_data from public.academy_documents where id=${id} and form_type='staff_resume'`);
    const bp = before?.form_data?.personal;
    const prevEmail = String(bp?.email ?? '').trim().toLowerCase(), prevName = String(bp?.name ?? '').trim();
    const up = await trySql(() => asActor(sql, user.id, s => s`update public.academy_documents set title=${R.resumeTitle(data)}, form_data=${s.json(data)},
      restricted=true, updated_at=now() where id=${id} and form_type='staff_resume' returning id::text id, staff_user_id::text staff_user_id`));
    if (up.e) return dbFail(c, up.e, '저장');
    if (!up.rows.length) return { error: '이력서를 찾을 수 없습니다 — 다른 사람이 삭제했을 수 있습니다. 입력한 내용을 복사해 두고 새로 작성하세요' };
    const linkedId = up.rows[0].staff_user_id ?? null, officeWrite = staffWrite(people, user);
    let hrSyncAllowed = false, current = {}, syncWarning = null, syncNotice = null, emailWarning = null, nameWarning = null, emailNotice = null, nameNotice = null;
    if (linkedId && officeWrite) {
      const [row] = await sql`select system_role::text system_role, department, employment_type, job_title, phone, hire_date::text hire_date
        from public.users where id=${linkedId} and tenant_id=${t}`;
      hrSyncAllowed = !!row && R.canManageStaffMember(user.role, row.system_role) && (await canSeeStaffMember(sql, t, people, user, linkedId));
      current = row ?? {};
    }
    if (linkedId) {
      const differs = (next, col) => Boolean(next) && String(next).trim() !== String(current[col] ?? '').trim();
      const sync = {};
      if (differs(data.contract.division, 'department')) sync.department = data.contract.division;
      if (differs(data.contract.employmentType, 'employment_type')) sync.employment_type = data.contract.employmentType;
      if (differs(data.contract.jobTitle, 'job_title')) sync.job_title = data.contract.jobTitle;
      if (differs(data.personal.phone, 'phone')) sync.phone = data.personal.phone;
      if (differs(data.contract.startDate, 'hire_date')) sync.hire_date = data.contract.startDate;
      const derived = hrSyncAllowed && 'department' in sync ? await subjectsForDivision(c, data.contract.division) : [];
      if (derived.length > 0) sync.subjects = derived;
      if (hrSyncAllowed && Object.keys(sync).length > 0) {
        const r = await trySql(() => sql.savepoint(s => s`update public.users set ${s(sync)} where id=${linkedId} and tenant_id=${t}`));
        if (r.e) syncWarning = `이력서는 저장했지만 직원 정보(부서·직급·입사일 등) 반영에 실패했습니다 — ${people.P.dbError.humanizeDbError(r.e.message)}`;
        else {
          const LABEL = { department: '부서', employment_type: '고용형태', job_title: '직급', phone: '연락처', hire_date: '입사일', subjects: '담당 과목' };
          syncNotice = `직원 정보도 함께 바꿨습니다: ${Object.keys(sync).map(k => LABEL[k] ?? k).join('·')}`;
        }
      }
      // 로그인 이메일·표시 이름 = 2.0처럼 계정 관리와 같은 구현(applyStaffEmailChange · applyStaffNameChange — 작업자 A의 v2-staff-save.mjs)을
      // 같은 쓰기 트랜잭션으로 태운다. 이름은 DB만이라 실제로 바뀌고, 로그인 계정이 있는 직원의 이메일은 그쪽이 거절 문구를 낸다.
      const nextEmail = data.personal.email.trim(), nextName = data.personal.name.trim();
      const acct = { sql, tenantId: t, importV2: c.importV2, actorId: user.id };
      if (nextEmail && nextEmail.toLowerCase() !== prevEmail && officeWrite) {
        const applied = await applyStaffEmailChange(acct, linkedId, nextEmail, 'resume');
        if ('error' in applied) emailWarning = `이력서는 저장했지만 로그인 이메일은 바꾸지 못했습니다 — ${applied.error}`;
        else if (applied.changed) emailNotice = `로그인 이메일을 ${nextEmail.toLowerCase()}(으)로 함께 변경했습니다`;
      }
      if (nextName && nextName !== prevName && officeWrite) {
        const applied = await applyStaffNameChange(acct, linkedId, nextName, 'resume');
        if ('error' in applied) nameWarning = `이력서는 저장했지만 표시 이름은 바꾸지 못했습니다 — ${applied.error}`;
        else if (applied.changed) {
          nameNotice = applied.ambiguous
            ? `표시 이름을 '${nextName}'(으)로 바꿨습니다 — 같은 이름의 다른 직원이 있어 과거 교재요청·보고서 연결은 옮기지 않았습니다(수동 확인 필요)`
            : `표시 이름을 '${nextName}'(으)로 바꿨습니다${applied.moved ? ` (과거 기록 ${applied.moved}건 연결 이전)` : ''}`;
          if (applied.backfillError) nameWarning = `이름은 바꿨지만 과거 기록 연결 이전에 실패했습니다 — ${applied.backfillError}`;
        }
      }
    }
    return { ok: true, id, nonce: Date.now(), redirectTo: `/staff/resumes/${id}`,
      ...(emailWarning || nameWarning || syncWarning ? { warning: [syncWarning, emailWarning, nameWarning].filter(Boolean).join(' · ') } : {}),
      ...(emailNotice || nameNotice || syncNotice ? { notice: [syncNotice, emailNotice, nameNotice].filter(Boolean).join(' · ') } : {}) };
  }

  let linkStaffUserId = null;
  if (linkRaw) {
    const [staffRow] = UUID.test(linkRaw) ? await asActor(sql, user.id, s => s`select id::text id from public.users where id=${linkRaw}`) : [];
    if (!staffRow) return { error: '연결할 직원을 찾을 수 없습니다 — 직원목록에서 다시 열어주세요' };
    linkStaffUserId = staffRow.id;
  }
  const ins = await trySql(() => asActor(sql, user.id, s => s`insert into public.academy_documents
      (tenant_id, title, category, kind, form_type, form_data, restricted, description, uploaded_by, staff_user_id)
    values (${t}, ${R.resumeTitle(data)}, 'hr', 'form', ${R.RESUME_FORM_TYPE}, ${s.json(data)}, true, '직원 이력서 (웹 작성)', ${user.id}, ${linkStaffUserId})
    returning id::text id`));
  if (ins.e || !ins.rows[0]) return dbFail(c, ins.e, '저장');
  const rowId = ins.rows[0].id;
  const account = !linkStaffUserId && fd.get('acct_register') === '1' ? await registerStaffFromResume(c, data, String(fd.get('acct_role') ?? ''), rowId) : {};
  return { ok: true, id: rowId, nonce: Date.now(), redirectTo: selfCreate ? '/me' : `/staff/resumes/${rowId}`,
    ...(account.notice ? { notice: account.notice } : {}), ...(account.warning ? { warning: account.warning } : {}) };
}

const RESUME_ACTION = (argCount, fn) => ({ validate: raw => serverCall(raw, [RESUME], argCount), run: async ctx => fn(await ctxOf(ctx), ctx.body.args) });
const PHOTO_CT = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const resumeActions = {
  saveStaffResume: RESUME_ACTION(2, (c, args) => saveStaffResume(c, args[1])),
  deleteStaffResume: RESUME_ACTION(1, async (c, args) => {
    const id = typeof args[0] === 'string' ? args[0] : '';
    const g = await requireResumeAccess(c, id);
    if (g.error) return g;
    const del = await trySql(() => asActor(c.sql, c.user.id, s => s`delete from public.academy_documents where id=${id} and form_type='staff_resume'
      returning id::text id, form_data, staff_user_id::text staff_user_id`));
    if (del.e) return dbFail(c, del.e, '삭제');
    if (!del.rows.length) return { error: '이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다' };
    const name = del.rows[0].form_data?.personal?.name;
    await audit(c.sql, c.t, c.user, 'staff_resume_delete', 'staff_resume', typeof name === 'string' && name.trim() ? name.trim() : null,
      { resumeId: id, userId: del.rows[0].staff_user_id ?? null });
    return { ok: true };
  }),
  issueResumePhotoTicket: RESUME_ACTION(2, async (c, args) => {
    if (!c.user) return { error: '로그인이 필요합니다' };
    if (c.user.role === 'student') return { error: '권한이 없습니다' };
    const fd = formOf(args[1]);
    if (!PHOTO_CT.has(String(fd.get('contentType') ?? ''))) return { error: '사진은 JPG·PNG·WebP만 첨부할 수 있습니다' };
    const size = Number(fd.get('size') ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) return { error: '사진이 너무 큽니다 (최대 5MB)' };
    return { error: '업로드 티켓 발급 실패 — 연습 화면에서는 사진을 올리지 않습니다' };
  }),
};
