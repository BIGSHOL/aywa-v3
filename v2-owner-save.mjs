// 2.0 화면 — 학원 설정 저장: 2.0 features/owner/server/actions.ts saveOwnerSection을 Docker 복사본에 같은 순서·같은 문구로.
//  · 게이트 = 역할·권한은 원장 + owner 쓰기 · 기능 켜기·끄기는 원장(일반판만) · 그 밖은 그 섹션의 메뉴 쓰기(OWNER_SECTION_MENU) — '저장하는 사람'(= 보는 사람)으로
//  · 섹션 스키마(SECTION_SCHEMAS) 검증 · 운영 섹션은 요청 형식(면 · 과목 칸 · 과목 삭제)대로 방금 읽은 값 위에 제 몫만(buildOperationsSave — #142) ·
//    역할·권한은 화면이 연 시점의 기준 token이 같아야 · 메뉴 구성은 기준 revision이 같아야 · 개인별 권한 대상은 재직 직원만 · 운영자 계정 줄은 지점에서 못 바꾼다
//  · 섹션 단위 머지(다른 섹션 보존) · 운영·권한 섹션은 순번(rev)을 섹션 안에 · 🔴 문서 최상위에 새 키를 두지 않는다(0335a 쓰기 가드)
//  · 쓰기 = 2.0 사용자 클라이언트(authenticated + 그 사람 신분) — 0335a·0080a·0281a 쓰기 가드가 2.0처럼 본다 · updated_at이 읽은 값과 같을 때만(다른 창 저장 보호)
//  · 감사로그 owner_settings_update(바뀐 칸 · 순번은 빼고) + '3.0 연습 복사본' 표시
// ⚠️ 보강 운영(makeups — 2.0은 DB 함수 makeup_command)과 대시보드 배치(dashboard — 원장 화면이 아직 '아직' 면)는 이 연습 화면에서 아직 받지 않는다.
import { V2Error } from './v2-screens.mjs';
import { audit, asAuthenticated } from './v2-timetable-save.mjs';
import { UUID } from './v2-mcs-core.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;
const NOT_YET = '연습 화면에서는 아직 지원하지 않는 저장입니다';

let rulesPromise = null;
function loadSaveRules(importV2) {
  rulesPromise ??= (async () => {
    const [diff, error, special, payslip, studentStatus, navigation, canonical, perms, dbError] = await Promise.all([
      'features/owner/settings-diff.ts', 'features/owner/settings-error.ts', 'features/owner/special-access.ts', 'features/owner/payslip-permissions.ts',
      'features/owner/student-status-permissions.ts', 'features/owner/normalize-navigation.ts', 'features/owner/permissions-canonical.ts', 'lib/permissions.ts', 'lib/supabase/db-error.ts',
    ].map(p => importV2(p)));
    return { diff, error, special, payslip, studentStatus, navigation, canonical, perms, dbError };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → 2.0이 읽는 get. */
function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 50) throw bad();
  const pairs = v.$formData.map(p => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 60 || p[1].length > 2_000_000) throw bad(); return p; });
  return { get: k => pairs.find(p => p[0] === k)?.[1] ?? null };
}
const canWrite = level => level === 'full' || level === 'scoped';
const equalRows = (a, b) => JSON.stringify(a.map(v => JSON.stringify(v)).sort()) === JSON.stringify(b.map(v => JSON.stringify(v)).sort());
const REV_SECTIONS = ['operations', 'permissions'];

/** platform-settings.ts platformSettingsError(permissions) — 운영자 계정에 걸린 줄(개인별 메뉴 · 기능 권한 · 과목 범위)은 지점에서 더하거나 바꾸거나 지울 수 없다. */
async function platformPermissionsError(sql, O, S, permissionAccountIds, next, previous) {
  const after = O.types.permissionsSchema.parse(next ?? { overrides: [] }), before = O.types.permissionsSchema.parse(previous ?? { overrides: [] });
  const people = [...new Set([...permissionAccountIds(O, after), ...permissionAccountIds(O, before)])];
  const ids = new Set(people.length ? (await sql`select id::text id from public.super_admins where id = any(${people}::uuid[])`).map(r => r.id) : []);
  const DENIED = '이 계정의 운영 설정은 지점에서 변경할 수 없습니다. 운영자 관리 화면을 이용해 주세요.';
  if (!equalRows(after.userOverrides.filter(r => ids.has(r.userId)), before.userOverrides.filter(r => ids.has(r.userId)))) return DENIED;
  for (const key of O.types.SPECIAL_ACCESS_ID_LISTS) {
    const list = value => (key === 'payslipManagerIds' ? S.payslip.effectivePayslipManagerIds(value.specialAccess) : value.specialAccess[key] ?? []);
    if (!equalRows(list(after).filter(id => ids.has(id)), list(before).filter(id => ids.has(id)))) return DENIED;
  }
  const scopesOf = value => value.specialAccess.staffSubjectScopes.filter(row => ids.has(row.userId));
  return equalRows(scopesOf(after), scopesOf(before)) ? null : DENIED;
}

/** saveOwnerSection(_prev, formData) — 2.0 반환 모양 OwnerSaveState({ ok, nonce, operations?, permissions?, version? } | { error }). */
export async function saveOwnerSection(io, actor, [, rawForm]) {
  const { sql, t, O, importV2, permissionAccountIds } = io;
  const formData = formOf(rawForm), S = await loadSaveRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  const section = String(formData.get('section') ?? '');
  if (!Object.hasOwn(O.types.SECTION_SCHEMAS, section)) return { error: '알 수 없는 설정 섹션입니다' };
  const schema = O.types.SECTION_SCHEMAS[section];
  if (!schema) return { error: '알 수 없는 설정 섹션입니다' };
  const MENU = O.roleCatalog.OWNER_SECTION_MENU;
  if (section === 'permissions') {
    if (actor.systemRole !== 'master' || !canWrite(actor.level('owner'))) return { error: '역할·권한은 원장만 변경할 수 있습니다' };
  } else if (!canWrite(actor.level(section in MENU ? MENU[section] : 'owner'))) {
    return { error: section === 'report' ? '보고서 설정 변경 권한이 없습니다' : '학원 설정 변경 권한이 없습니다' };
  }
  if (section === 'modules' && actor.systemRole !== 'master') return { error: '기능 켜기·끄기는 원장만 바꿀 수 있습니다' };
  if (section === 'dashboard' && actor.systemRole !== 'master') return { error: '대시보드 배치는 원장만 바꿀 수 있습니다' };
  if (section === 'dashboard' || section === 'makeups') return { error: NOT_YET };
  let parsedJson;
  try { parsedJson = JSON.parse(String(formData.get('data') ?? 'null')); } catch { return { error: '설정 데이터 형식이 올바르지 않습니다' }; }
  let operationsRequest;
  if (section === 'operations') {
    const read = O.opsSave.readOperationsRequest(formData, parsedJson);
    if ('error' in read) return { error: read.error };
    operationsRequest = read.request;
  }
  const permissionsBaseline = section === 'permissions' ? formData.get('permissionsBaseline') : null;
  if (section === 'permissions' && (typeof permissionsBaseline !== 'string' || !permissionsBaseline)) return { error: O.opsSave.STALE_FORM_ERROR };
  const sendsWholeSection = !operationsRequest || operationsRequest.kind === 'face';
  const result = sendsWholeSection ? schema.safeParse(parsedJson) : null;
  if (result && !result.success) return { error: S.error.settingsValidationError(section, result.error.issues[0], parsedJson) };
  if (section === 'permissions' && result && S.canonical.hasDuplicateRoleCells(result.data.overrides)) return { error: '같은 메뉴·직급의 권한을 두 번 지정할 수 없습니다' };

  // 🔴 못 읽었으면 저장하지 않는다 — 빈 문서 위에 이 섹션만 얹으면 다른 섹션이 전부 지워진다(2.0 그대로).
  let existing;
  try { [existing] = await sql.savepoint(s => s`select data, ${ISO(s, 'updated_at')} updated_at from public.tenant_settings where tenant_id=${t}`); }
  catch { return { error: '설정을 불러오지 못해 저장하지 않았습니다. 잠시 뒤 다시 시도하세요.' }; }
  const preset = O.preset.presetOfStored(existing?.data ?? null);
  if (section === 'modules' && preset !== 'generic') return { error: '이 학원은 기능 켜기·끄기를 쓰지 않습니다' };
  if (section === 'permissions' && permissionsBaseline !== O.permSave.permissionsToken(O.resolve.resolveSettings(existing?.data ?? null, { name: '' }).permissions))
    return { error: O.opsSave.CHANGED_ELSEWHERE_ERROR };
  if (section === 'permissions' && S.payslip.payslipRefreshRequired(parsedJson, existing?.data?.permissions)) return { error: '새로고침한 뒤 급여명세서 권한을 다시 설정해 주세요.' };
  if (section === 'permissions' && S.studentStatus.studentStatusRefreshRequired(parsedJson, existing?.data?.permissions))
    return { error: '원생 메뉴 권한을 바꾸기 전에 새로고침한 뒤 원생 상태 변경 담당자를 지정해 주세요.' };
  if (section === 'permissions') {
    const p = result.data, fresh = O.resolve.resolveSettings(existing?.data ?? null, { name: '' });
    const rowKey = r => `${r.userId}:${r.menu}:${r.access}`;
    const storedRows = preset === 'generic' ? [] : fresh.permissions.userOverrides;
    const special = S.special.specialAccessTargets(p.specialAccess, fresh.permissions.specialAccess);
    const knownSubjects = new Set(fresh.operations.subjects.map(s => s.key));
    if (special.subjects.some(key => !knownSubjects.has(key))) return { error: '과목 범위에는 학원 설정에 있는 과목만 넣을 수 있습니다' };
    const kept = new Set(storedRows.flatMap(r => (r && typeof r.userId === 'string' && typeof r.menu === 'string' && typeof r.access === 'string' ? [rowKey(r)] : [])));
    const checkedRows = p.userOverrides.filter(r => !kept.has(rowKey(r)));
    const ids = [...new Set([...checkedRows.map(r => r.userId), ...special.userIds])];
    if (ids.length > 0) {
      let people;
      try { people = await sql.savepoint(s => s`select id::text id, system_role::text system_role, status::text status from public.users where tenant_id=${t} and id = any(${ids}::uuid[]) limit 250`); }
      catch { return { error: '권한 대상 직원을 확인하지 못했습니다' }; }
      const validIds = new Set(people.filter(u => u.system_role !== 'student' && u.status !== 'inactive').map(u => u.id));
      if (ids.some(id => !validIds.has(id))) return { error: '현재 지점의 재직 직원만 권한 대상에 지정할 수 있습니다' };
      const roles = new Map(people.map(u => [u.id, u.system_role]));
      if (checkedRows.some(r => S.perms.isPermissionLocked(r.menu, roles.get(r.userId), r.access))) return { error: '이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다' };
    }
  }
  const base = existing?.data ?? {};
  if (section === 'navigation') {
    const expected = formData.get('navigationBaseline');
    if (typeof expected === 'string' && expected !== S.navigation.navigationRevision(base.navigation))
      return { error: '다른 창에서 메뉴 구성이 변경되었습니다. 현재 편집 내용은 유지했습니다. 최신 구성을 새로고침한 뒤 다시 저장해 주세요.' };
  }
  let sectionData;
  if (operationsRequest) {
    const fresh = O.resolve.resolveSettings(existing?.data ?? null, { name: '' }).operations;
    const built = O.opsSave.buildOperationsSave(operationsRequest, fresh, result?.data, { by: actor.name ?? undefined, at: new Date().toISOString() });
    if ('error' in built) return { error: built.issue ? S.error.settingsValidationError(section, built.issue, built.checked) : built.error };
    if ('unchanged' in built) return { ok: true, nonce: Date.now(), operations: O.opsSave.operationsReply(fresh, operationsRequest), version: O.stamp.settingsRevOf(base.operations) };
    sectionData = O.preset.prepareSectionForSave(preset, section, built.raw, built.parsed, base[section]);
  } else {
    sectionData = O.preset.prepareSectionForSave(preset, section, parsedJson, result?.data, base[section]);
  }
  if (section === 'permissions') {
    try {
      const boundary = await platformPermissionsError(sql, O, S, permissionAccountIds, sectionData, base[section]);
      if (boundary) return { error: boundary };
    } catch { return { error: '운영 설정 보호 여부를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }; }
  }
  const sectionRev = REV_SECTIONS.includes(section) ? O.stamp.settingsRevOf(base[section]) + 1 : undefined;
  const storedSection = sectionRev === undefined ? sectionData : { ...sectionData, rev: sectionRev };
  const nextData = { ...base, version: 1, [section]: storedSection };
  if (preset === 'generic') nextData.preset = 'generic';
  const stamp = O.stamp.nextSettingsStamp(existing?.updated_at);
  // 2.0 사용자 클라이언트 쓰기 — 그 사람 신분을 맡겨 두고 asAuthenticated 안에서만 세운다(0335a 쓰기 가드가 2.0처럼 본다).
  await sql`select set_config('v2.actor_claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  let written;
  try {
    written = await asAuthenticated(sql, s => (existing
      ? s`update public.tenant_settings set data=${s.json(nextData)}, updated_by=${actor.id}, updated_at=${stamp}::timestamptz where tenant_id=${t} and ${ISO(s, 'updated_at')} = ${existing.updated_at} returning tenant_id`
      : s`insert into public.tenant_settings (tenant_id, data, updated_by, updated_at) values (${t}, ${s.json(nextData)}, ${actor.id}, ${stamp}::timestamptz) returning tenant_id`));
  } catch (e) {
    const err = { code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null };
    return { error: S.error.plainSettingsReason(S.dbError.explainDbError(err, { scope: 'owner.saveOwnerSection', fallback: '설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }).message) };
  } finally { await sql`select set_config('v2.actor_claims', '', true)`; }
  if (!written.length) return { error: '다른 창에서 설정이 먼저 저장되었습니다. 새로고침한 뒤 다시 저장해 주세요.' };
  const diff = S.diff.diffSettingsSection(section, O.stamp.withoutSettingsRev(base[section]), sectionData);
  await audit(sql, t, actor, 'owner_settings_update', 'tenant_settings', { section, ...(diff.changes.length ? { changes: diff.changes } : {}), ...(diff.others ? { others: diff.others } : {}) },
    O.types.SECTION_LABELS[section]);
  const saved = sectionRev === undefined ? undefined : O.resolve.resolveSettings(nextData, { name: '' });
  const operations = saved && operationsRequest ? O.opsSave.operationsReply(saved.operations, operationsRequest) : undefined;
  const permissions = saved && section === 'permissions' ? { token: O.permSave.permissionsToken(saved.permissions) } : undefined;
  return { ok: true, nonce: Date.now(), ...(operations ? { operations } : {}), ...(permissions ? { permissions } : {}), ...(sectionRev === undefined ? {} : { version: sectionRev }) };
}

export const OWNER_ACTIONS_MODULE = 'features/owner/server/actions.ts';
export function ownerActions(makeIo) {
  return {
    saveOwnerSection: {
      validate: raw => {
        if (!plain(raw) || raw.module !== OWNER_ACTIONS_MODULE || !Array.isArray(raw.args) || raw.args.length !== 2 || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
        formOf(raw.args[1]);
        return { actor: raw.actor ?? null, args: raw.args };
      },
      run: async ({ sql, body, tenantId, importV2 }) => { const io = await makeIo(sql, tenantId, importV2); return saveOwnerSection(io, io.viewers.find(v => v.id === body.actor) ?? null, body.args); },
    },
  };
}
