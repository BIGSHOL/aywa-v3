// 2.0 선생님 원스크린 props — 2.0 `src/app/(shell)/onescreen/page.tsx`가 `<VideoHomeworkProvider>`·`<OneScreenClient>`에 넘기는 값을
// 로컬 Docker 복사본에서 **같은 키·같은 모양·같은 뜻**으로 만든다(V2-SCREENS.md '그리는 방식 전환'). '2.0 부품 호스트'가 2.0 React
// 부품을 고치지 않고 그릴 때 이 값을 그대로 props로 넣는다.
// · 조회 = 2.0 `getTeacherRoster`(features/onescreen/server/roster.ts)와 page.tsx의 조회들을 같은 순서·같은 조건으로 SQL에 옮긴 것.
//   Supabase 사용자 클라이언트(RLS = 지점 격리)로 읽던 곳은 `tenant_id` 조건으로, RPC·RLS 함수는 그 선생님 신분(request.jwt.claims)으로.
// · 판정 = 2.0 순수 함수를 importV2로 그대로. 설정 병합(resolve.ts)·영역 라벨(skill-areas.ts)만 그 파일이 설정 타입(화면 부품 import)을
//   물고 있어 불러올 수 없어서 같은 식으로 옮겼다(영어 기본 영역은 2.0 원본 파일에서 읽는다).
// · 날짜·시각 칸은 PostgREST가 내는 글자 모양 그대로(date "YYYY-MM-DD", time "HH:MM:SS", timestamptz "…+00:00") — 부품이 그 글자를
//   비교·저장한다. 자유 글(멘트·특이사항·메모)은 원문 그대로(이 값으로 다시 저장하므로 가리지 않는다).
// · '오늘' = 복사본 기준일(v2-screen-onescreen.mjs `copyDay`와 같은 계산). 읽기 전용 트랜잭션 · 쓰기 없음 · 바깥 호출 없음.
// · 2.0이 "실패해도 화면은 뜬다"로 삼키는 조회는 `sql.soft`(저장점 안에서 혼자)로 돌려 2.0의 폴백 값을 쓴다 — 아래 `queryGate`.
import { readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { activeBackup, fullDbRoot } from './full-db-paths.mjs';

const MODULES = ['lib/date-kst.ts', 'lib/permissions.ts', 'lib/modules.ts', 'lib/license/rule.ts', 'lib/laboratory/rule.ts', 'lib/auth/user-menu-blocks.ts',
  'lib/settings-role-catalog.ts', 'lib/storage/legacy-audio-path.ts', 'features/owner/defaults.ts', 'features/owner/preset.ts', 'features/owner/subjects.ts',
  'features/owner/classnote-gate.ts', 'features/owner/report-logo.ts', 'features/owner/lesson-profile.ts', 'features/owner/payslip-permissions.ts',
  'features/owner/student-status-permissions.ts', 'features/makeups/config.ts', 'features/makeups/types.ts', 'features/makeups/command-parse.ts',
  'features/makeups/roster-merge.ts', 'features/approvals/access.ts', 'features/student-contribution/model/access.ts', 'features/classes/delegation-window.ts',
  'features/attendance/teacher-axis.ts', 'features/attendance/calendar.ts', 'features/attendance/input-roster.ts', 'features/attendance/auto-units.ts',
  'features/attendance/makeup-reservation.ts', 'features/class-sheets/lib/holiday.ts', 'features/class-sheets/sheet-report-draft.ts',
  'features/class-splits/rules.ts', 'features/class-splits/period.ts', 'features/timetable/lib/teacher-label.ts', 'features/timetable/lib/report-subject.ts',
  'features/onescreen/textbook-carry.ts', 'features/onescreen/display-options.ts', 'features/onescreen/send-mark.ts', 'features/onescreen/trend-optout.ts',
  'features/onescreen/exam-info.ts', 'features/onescreen/classnote-guard.ts', 'features/onescreen/student-order.ts', 'features/onescreen/roster-filter.ts',
  'features/onescreen/class-tags.ts', 'features/onescreen/report-unit.ts', 'features/onescreen/makeup-owner.ts', 'features/onescreen/makeup-session.ts',
  'features/onescreen/reserved-makeup.ts', 'features/onescreen/split-rows.ts', 'features/onescreen/progress-status.ts', 'features/onescreen/font-size.ts',
  'features/onescreen/attendance-mark.ts', 'features/onescreen/math-report-pilot.ts', 'features/onescreen/math-report-pilot-sections.ts',
  'features/onescreen/todays-math-fill-rules.ts', 'features/onescreen/report-author-name.ts', 'features/onescreen/classnote-match.ts', 'features/onescreen/view.ts',
  'features/video-homework/assignment.ts', 'features/video-homework/lesson-marks.ts', 'features/video-homework/due.ts', 'features/video-submit/link-choice.ts'];
let rulesP = null, copyAt = null, englishAreas = null;
export async function rules(importV2) {
  // 이름이 겹치면 앞 모듈이 이긴다(`addDays` = lib/date-kst.ts — class-splits/period.ts에도 같은 이름이 있다). 실패는 기억하지 않는다(다음 호출에 다시).
  rulesP ??= Promise.all(MODULES.map((m) => importV2(m))).then((mods) => Object.assign({}, ...mods.reverse())).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/**
 * 복사본의 '지금' = 백업을 뜬 순간(2.0의 `new Date()` 자리)과 그 KST 날짜(`kstToday()` 자리).
 * 서버가 켜져 있는 동안 기억한다 — 복사본 백업을 바꾸면 서버를 다시 켤 것.
 */
export async function copyClock() {
  if (!copyAt) { const { directory } = await activeBackup(); const m = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); copyAt = new Date(m.capturedAt); }
  return { at: copyAt, day: new Date(copyAt.getTime() + 9 * 3600000).toISOString().slice(0, 10) };
}
export async function copyDay() { return (await copyClock()).day; }

/**
 * 트랜잭션 조회 관문. postgres.js 트랜잭션은 조회 하나만 실패해도 통째로 실패한다 — 오류를 `.catch`로 삼켜도 begin이 기억했다가
 * 끝에서 던지고, 그 사이에 나간 다른 조회도 전부 25P02로 깨진다. 그래서
 *  · 보통 조회(2.0도 실패하면 화면이 죽는 것) = `sql\`…\`` 그대로 나란히(B4). 실패는 그대로 load 실패.
 *  · 2.0이 삼키는 조회 = `sql.soft(sp => …, 폴백)` — 앞선 조회가 끝나길 기다렸다가 저장점 안에서 **혼자** 돌고(그동안 새 조회는 기다린다),
 *    실패하면 저장점으로 되돌리고 2.0의 폴백 값(함수면 오류를 받아 계산)을 돌려준다. 🔴 저장점 안에서는 `sp`만 쓸 것 — 저장점 안에서
 *    `sql`·`sql.soft`를 부르면 서로 기다려 영원히 멈추므로, 그 자리에서 `GateMisuseError`를 던진다(폴백으로 삼키지 않고 load 실패로).
 *  · 조각(fragment)은 `sql.frag\`…\``로 만든다(관문을 거치면 조각이 아니라 실행이 된다).
 */
export class GateMisuseError extends Error {}
export function queryGate(tx) {
  // 저장점이 없으면(트랜잭션이 아닌 sql) 삼키는 조회가 전부 조용히 폴백으로 떨어진다 — 그 전에 멈춘다.
  if (typeof tx?.savepoint !== 'function') throw new Error('읽기 전용 트랜잭션(sql.begin) 안에서 불러 주세요');
  // 이 관문의 저장점 안에서 이어지는 비동기 흐름에만 표식이 붙는다 — 다른 갈래에서 나란히 온 조회는 표식이 없어 정상으로 기다린다.
  const inSoft = new AsyncLocalStorage(), mark = {};
  const guard = () => { if (inSoft.getStore() === mark) throw new GateMisuseError('저장점(sql.soft) 안에서는 sp만 쓰세요 — sql·sql.soft를 부르면 멈춥니다'); };
  let readers = 0, writer = false;
  const waiting = [];
  const pump = () => {
    while (waiting.length) {
      const next = waiting[0];
      if (writer || (next.exclusive && readers > 0)) return;
      waiting.shift();
      if (next.exclusive) writer = true; else readers += 1;
      next.go();
    }
  };
  const hold = async (exclusive, fn) => {
    await new Promise((go) => { waiting.push({ exclusive, go }); pump(); });
    try { return await fn(); } finally { if (exclusive) writer = false; else readers -= 1; pump(); }
  };
  const sql = (strings, ...values) => { guard(); return hold(false, () => tx(strings, ...values)); };
  sql.frag = tx;
  sql.json = (value) => tx.json(value);
  sql.soft = async (fn, fallback) => {
    guard();
    try { return await hold(true, () => inSoft.run(mark, () => tx.savepoint((sp) => fn(sp)))); } catch (e) {
      if (e instanceof GateMisuseError) throw e;
      return typeof fallback === 'function' ? fallback(e) : fallback;
    }
  };
  return sql;
}
/** postgres.js 오류 → 2.0 판정 함수가 읽는 PostgREST 오류 모양(postgres.js는 `detail`, PostgREST는 `details`). */
export const pgError = (e) => ({ code: e?.code, message: e?.message, details: e?.details ?? e?.detail, hint: e?.hint });
/** 2.0 isMissingColumn(attendance/server/makeup-reservation-queries.ts) — 칸이 없을 때 그 칸을 빼고 다시 읽는 판정. */
const isMissingColumn = (e, column) => { const msg = e?.message ?? ''; return msg.includes(column) && /does not exist|not find|schema cache/i.test(msg); };
const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** 2.0 OperationsProvider의 라이선스 키(operations-context.tsx `LicenseKey` = rule.ts `LicensedFeature`). */
export const HOST_LICENSES = ['ai_analysis', 'google_sheets', 'meeting_recording', 'window_mode'];
const MAKEUP_UNREAD_NOTICE = '보강 배정을 확인하지 못했습니다. 새로고침해 다시 확인해 주세요.';
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── 학원 설정 = 2.0 resolveSettings(features/owner/resolve.ts) — 원스크린이 읽는 섹션까지 같은 식으로 ─────────────────────────────
function deepMerge(base, stored) {
  if (!isPlainObject(base)) return stored === undefined || stored === null ? base : stored;
  if (!isPlainObject(stored)) return base;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const b = base[key], s = stored[key];
    if (s === undefined) continue;
    if (Array.isArray(b)) out[key] = Array.isArray(s) ? s : b;
    else if (isPlainObject(b)) out[key] = deepMerge(b, s);
    else out[key] = s === null ? b : s;
  }
  return out;
}
function normalizeHolidays(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((h) => (typeof h === 'string' ? { date: h, name: '' } : h && typeof h === 'object' && typeof h.date === 'string'
    ? { date: h.date, name: typeof h.name === 'string' ? h.name : '' } : null)).filter((h) => h !== null);
}
function normalizeSubjects(arr, base) {
  const defaults = new Map(base.operations.subjects.map((s) => [s.key, s]));
  return arr.map((s) => {
    const d = defaults.get(s.key);
    if (!d) return s;
    const out = { ...s };
    if (out.weekdayPeriods === undefined && d.weekdayPeriods) out.weekdayPeriods = d.weekdayPeriods;
    if (out.teacherViewLines === undefined && d.teacherViewLines) out.teacherViewLines = d.teacherViewLines;
    if (out.teacherViewStep === undefined && d.teacherViewStep !== undefined) out.teacherViewStep = d.teacherViewStep;
    return out;
  });
}
function mergeDepartmentTitles(base, stored) {
  const out = { ...base };
  if (!isPlainObject(stored)) return out;
  for (const [department, titles] of Object.entries(stored)) if (Array.isArray(titles) && titles.every((t) => typeof t === 'string')) out[department] = titles;
  return out;
}
/** navigation·dashboard·billing 정규화는 원스크린이 읽지 않아 옮기지 않았다(병합값 그대로). */
export function resolveSettings(R, stored, tenantName) {
  const preset = R.presetOfStored(stored), base = R.baseSettingsFor(preset);
  const storedPermissions = isPlainObject(stored) && isPlainObject(stored.permissions) ? stored.permissions : undefined;
  const merged = deepMerge(base, stored);
  const storedOperations = isPlainObject(stored) && isPlainObject(stored.operations) ? stored.operations : undefined;
  return { ...merged, preset,
    permissions: { ...merged.permissions, specialAccess: { ...merged.permissions.specialAccess,
      payslipManagerIds: R.effectivePayslipManagerIds(storedPermissions?.specialAccess), studentStatusManagerIds: R.studentStatusManagerIds(storedPermissions?.specialAccess) } },
    profile: { ...merged.profile, name: merged.profile.name || tenantName },
    operations: { ...merged.operations, subjects: normalizeSubjects(merged.operations.subjects, base), holidays: normalizeHolidays(merged.operations.holidays),
      jobTitlesByDepartment: mergeDepartmentTitles(base.operations.jobTitlesByDepartment, storedOperations?.jobTitlesByDepartment) },
    modules: { disabled: R.normalizeDisabledModules(merged.modules.disabled) },
    makeups: R.normalizeMakeupSettings(merged.makeups) };
}
/** 2.0 resolveSkillAreas(features/owner/skill-areas.ts) — 영어 기본 영역은 그 파일의 DEFAULT_ENGLISH_SKILL_AREAS를 읽어 쓴다. */
async function resolveSkillAreas(subject) {
  if (!subject) return [];
  const stored = subject.skillAreas ?? [];
  if (stored.length > 0) return stored;
  if (subject.key !== 'english') return [];
  if (!englishAreas) {
    const src = await readFile(new URL('../../src/features/owner/skill-areas.ts', import.meta.url), 'utf8');
    const block = src.match(/DEFAULT_ENGLISH_SKILL_AREAS[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
    englishAreas = [...block.matchAll(/key:\s*"([^"]+)",\s*label:\s*"([^"]+)"(?:,\s*color:\s*"([^"]+)")?/g)].map(([, key, label, color]) => ({ key, label, color }));
    if (!englishAreas.length) throw new Error('2.0 영어 기본 영역을 읽지 못했습니다');
  }
  return [...englishAreas];
}

// ── 권한 = 2.0 perm-matrix.ts getPermMatrix → resolveActorPermMatrix → getActorPermMatrix → getUserPermMatrix(같은 차례·같은 순수 함수) ──
// 운영실(v2-dashboard-overview.mjs)도 같은 함수로 '보는 사람'의 메뉴를 판정한다. `R` = 이 파일의 rules(importV2) · `actor` = { id, system_role }.
export async function userPermMatrix(sql, R, settings, actor, t, at) {
  const [lab, lic, isSuper] = await Promise.all([
    sql.soft((sp) => sp`select menu_key from public.lab_menu_assignments`, null),
    sql.soft((sp) => sp`select feature, is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses where tenant_id=${t} and feature = any(${['laboratory', 'ai_analysis']})`, null),
    // 2.0 isCurrentUserSuperAdmin: `{ data }`만 본다 — 못 읽으면 아니다.
    sql.soft(async (sp) => (await sp`select exists(select 1 from public.super_admins where id=${actor.id}) yes`)[0].yes, false)]);
  const licRow = (f) => { const r = lic.find((x) => x.feature === f); return r ? { is_active: r.is_active, expires_at: r.expires_at } : null; };
  // 조회 실패면 2.0처럼 — 실험실 메뉴 = 대상 메뉴 전부(getLaboratoryMenus) · 실험실 켜짐 = 꺼짐(isFeatureOptedIn) · AI = 허용(isFeatureLicensed).
  const labMenus = lab ? [...new Set(lab.map((r) => r.menu_key))].filter((k) => R.LAB_ELIGIBLE_KEYS.has(k)) : R.LAB_ELIGIBLE_MENUS.map((m) => m.key);
  const labOn = lic ? R.licenseExplicitlyOn(licRow('laboratory'), at) : false, aiOn = lic ? R.licenseAllows(licRow('ai_analysis'), at) : true, role = actor.system_role;
  const capLaboratory = (m) => { m = R.capContributionMenu(m, t); return labMenus.length === 0 ? m : R.capLaboratoryMenus(m, labMenus, labOn); };
  const capSettingFeatures = (m) => (m.ai_ment[role] === 'none' || aiOn ? m : { ...m, ai_ment: Object.fromEntries(R.SYSTEM_ROLES.map((r) => [r, 'none'])) });
  const makeupMode = R.normalizeMakeupSettings(settings.makeups).mode, overrides = settings.permissions.overrides, disabled = settings.modules.disabled;
  const base = capLaboratory(R.capMakeupMode(R.capDisabledModules(overrides.length > 0 && isSuper
    ? R.mergeMostPermissive(R.resolveMatrix([]), R.resolveMatrix(overrides)) : R.resolveMatrix(overrides), disabled), makeupMode));
  const codeOverrides = R.approvalMenuOverridesFor(actor.id, isSuper), userOverrides = [...codeOverrides, ...settings.permissions.userOverrides];
  let resolved;
  if (userOverrides.length === 0 && !isSuper) resolved = capSettingFeatures(base);
  else {
    const applied = R.applyUserOverrides(base, actor.id, role, userOverrides);
    if (isSuper) {
      const merged = R.mergeMostPermissive(R.mergeMostPermissive(base, applied), R.applyUserOverrides(base, actor.id, role, codeOverrides));
      for (const menu of R.SETTINGS_ROLE_KEYS) merged[menu] = { ...merged[menu], [role]: 'full' };
      resolved = capSettingFeatures(R.capMakeupMode(R.capDisabledModules(merged, disabled), makeupMode));
    } else resolved = capSettingFeatures(R.capMakeupMode(R.capDisabledModules(applied, disabled), makeupMode));
  }
  // 지점 보기·다른 강사 뷰는 이 화면에 없다(로그인 = 고른 선생님 본인) — 개인 메뉴 차단 뒤 실험실 덮개(getUserPermMatrix).
  return capLaboratory(R.applyUserMenuBlocks(resolved, actor.id, [role, 'master']));
}

/** 2.0 resolveBrandingSrc — 서명 주소 대신 복사본 로컬 저장소(copy-storage.mjs가 받은 파일)의 data: 주소. 없거나 못 읽으면 null(2.0 실패와 같다). */
async function brandingSrc(sql, R, value, t) {
  if (!value) return null;
  if (/^https?:\/\//.test(value) || value.startsWith('/')) return value;
  try {
    if (!R.isTenantBrandingPath(value, t)) return null;
    const o = await sql.soft(async (sp) => (await sp`select id::text id, metadata->>'mimetype' mime from storage.objects where bucket_id='branding' and name=${value} limit 1`)[0] ?? null, null);
    if (!o || !/^[0-9a-f-]+$/i.test(o.id)) return null;
    const file = await readFile(new URL(`storage/branding/${o.id}`, fullDbRoot));
    return `data:${o.mime || 'image/png'};base64,${file.toString('base64')}`;
  } catch { return null; }
}

/** 2.0 loadNativeParticipants + readParticipantPages(보강 운영이 켜진 지점만 — 꺼져 있으면 RPC를 부르지 않는다). */
async function loadNativeParticipants(sql, R, settings, filter) {
  if (!R.featureLive(settings.makeups.mode)) return { status: 'off' };
  const rpc = async (payload) => {
    // RPC가 권한·운영 상태를 예외로 알린다 — 저장점 안에서 부르고, 판정 함수엔 PostgREST 오류 모양(details)으로 넘긴다.
    const res = await sql.soft(async (sp) => ({ data: (await sp`select public.makeup_list_participants(${sp.json(payload)}) body`)[0].body }), (e) => ({ error: pgError(e) }));
    if (res.error) {
      const error = res.error;
      if (R.isParticipantPermissionDenied(error)) return { status: 'off' };
      if (R.isModeOffError(error)) return { status: 'off' };
      if (R.isMissingMakeupRpc(error)) return { status: 'schema_missing' };
      return { status: 'failed', error: '보강 참여를 확인하지 못했습니다' };
    }
    const parsed = R.parseParticipantBody(res.data);
    return parsed.ok ? { status: 'ok', value: parsed.value } : { status: 'failed', error: parsed.error };
  };
  const participants = [], legacyMaps = [], seen = new Set();
  let after = null;
  for (let page = 1; page <= 8; page += 1) {
    const payload = { ...filter, limit: 500 };
    delete payload.page; delete payload.page_size; delete payload.after;
    if (after) payload.after = after; else { payload.page = 1; payload.page_size = 500; }
    const outcome = await rpc(payload);
    if (outcome.status !== 'ok') return outcome;
    const rows = outcome.value.participants;
    if (rows.length === 0) return page > 1 ? { status: 'failed', error: '보강 참여 목록이 잘렸습니다' } : { status: 'ok', value: { participants, legacyMaps, truncated: false, total: null, nextAfter: null } };
    if (rows.some((row) => seen.has(row.id))) return { status: 'failed', error: '보강 참여 목록이 잘렸습니다' };
    for (const row of rows) { seen.add(row.id); participants.push(row); }
    for (const map of outcome.value.legacyMaps) if (seen.has(map.participantId) && !legacyMaps.some((k) => k.id === map.id)) legacyMaps.push(map);
    const total = outcome.value.total;
    if (!outcome.value.truncated || (total !== null && participants.length >= total)) return { status: 'ok', value: { participants, legacyMaps, truncated: false, total, nextAfter: null } };
    const next = outcome.value.nextAfter ?? R.participantCursor(rows[rows.length - 1]);
    if (after && R.sameParticipantCursor(after, next)) return { status: 'failed', error: '보강 참여 목록이 잘렸습니다' };
    after = next;
  }
  return { status: 'failed', error: '보강 참여가 더 있습니다. 기간을 나눠 다시 조회해 주세요' };
}
function participantsOrLegacy(outcome) {
  if (outcome.status === 'off' || outcome.status === 'schema_missing') return [];
  if (outcome.status === 'failed') throw new Error(outcome.error);
  if (outcome.status === 'ok' && outcome.value.truncated) throw new Error('보강 참여 목록이 잘렸습니다');
  return outcome.value.participants;
}

/** 2.0 getTeachingClasses(classes/server/delegation.ts) — 담당 반(활성) ∪ 그날 위임받은 반 ∪ JJ 보고서 담당 반 + 위임 표식. */
async function getTeachingClasses(sql, R, settings, t, userId, date) {
  // 2.0 fetchJjManagedClassIds — 설정·조회 실패는 [](이 갈래만 닫힌다).
  const jjManaged = async () => {
    if (!(settings.permissions.specialAccess.jjReportManagerIds ?? []).includes(userId)) return [];
    const dow = R.axisDowOf(date);
    if (!dow) return [];
    return sql.soft(async (sp) => {
      const rows = await sp`select class_id, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
        where tenant_id=${t} and day_of_week::text=${dow} and teacher_id is null and slot_teacher_label is not null order by id`;
      return [...new Set(rows.filter((r) => { const slot = { teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: String(r.valid_from).slice(0, 10), validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null };
        return R.isSeatSlot(slot) && R.specialSlotLabel(r.slot_teacher_label) === R.SELF_STUDY_ROOM_LABEL && R.slotLiveOn(slot, date); }).map((r) => r.class_id))];
    }, []);
  };
  // 로스터 경로(strict 아님)는 담당 반·위임 조회의 오류를 `data ?? []`로 받는다 — 같은 폴백.
  const [ownRows, activeRaw, jj] = await Promise.all([
    sql.soft((sp) => sp`select id, class_name, subject, is_special, report_optout, closed_at::text closed_at from public.classes where tenant_id=${t} and teacher_id=${userId} and is_active = true`, []),
    sql.soft((sp) => sp`select class_id, delegate_user_id, from_date::text from_date, to_date::text to_date, to_json(revoked_at)#>>'{}' revoked_at from public.class_delegations
      where tenant_id=${t} and revoked_at is null and from_date<=${date} and to_date>=${date} limit 500`, []),
    jjManaged()]);
  const active = activeRaw.filter((r) => R.isDelegationActiveOn({ fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }, date));
  const ownSet = new Set(ownRows.map((c) => c.id));
  const wanted = [...new Set([...active.filter((r) => r.delegate_user_id === userId && !ownSet.has(r.class_id)).map((r) => r.class_id), ...jj.filter((id) => !ownSet.has(id))])];
  const awayByClass = new Map();
  for (const r of active) if (ownSet.has(r.class_id) && r.delegate_user_id !== userId) awayByClass.set(r.class_id, r.delegate_user_id);
  const classRows = wanted.length === 0 ? [] : await sql`select id, class_name, subject, is_special, report_optout, teacher_id, closed_at::text closed_at from public.classes
    where tenant_id=${t} and id = any(${wanted}) and is_active = true`;
  const nameWanted = [...new Set([...classRows.map((c) => c.teacher_id).filter(Boolean), ...awayByClass.values()])];
  const nameById = new Map();
  if (nameWanted.length) for (const u of await sql`select id, display_name from public.users where tenant_id=${t} and id = any(${nameWanted})`) if (u.display_name) nameById.set(u.id, u.display_name);
  return [...ownRows.map((c) => { const awayTo = awayByClass.get(c.id);
    return { id: c.id, className: c.class_name ?? '', subject: c.subject, isSpecial: !!c.is_special, reportOptout: !!c.report_optout, closedAt: c.closed_at ?? null,
      delegated: false, ownerName: null, delegatedAwayTo: awayTo ? (nameById.get(awayTo) ?? '다른 선생님') : null }; }),
  ...classRows.map((c) => ({ id: c.id, className: c.class_name ?? '', subject: c.subject, isSpecial: !!c.is_special, reportOptout: !!c.report_optout, closedAt: c.closed_at ?? null,
    delegated: true, ownerName: (c.teacher_id && nameById.get(c.teacher_id)) || null, delegatedAwayTo: null }))];
}

/** 2.0 getRosterReservationsOn + toReservation(attendance/server/makeup-reservation-queries.ts) — `report_mode` 칸이 없으면 그 칸 없이 다시, 그 밖의 실패는 빈 목록. */
async function getRosterReservationsOn(sql, R, t, date, classIds) {
  if (classIds.length === 0) return [];
  const read = (withMode) => sql.soft(async (sp) => ({ rows: await (withMode
    ? sp`select id, student_id, class_id, absence_date::text absence_date, makeup_date::text makeup_date, slot_start::text slot_start, slot_end::text slot_end,
        period_label, note, status, created_by, report_mode from public.makeup_reservations
      where tenant_id=${t} and makeup_date=${date} and status = any(${['reserved', 'done']}) and class_id = any(${classIds}) order by slot_start`
    : sp`select id, student_id, class_id, absence_date::text absence_date, makeup_date::text makeup_date, slot_start::text slot_start, slot_end::text slot_end,
        period_label, note, status, created_by from public.makeup_reservations
      where tenant_id=${t} and makeup_date=${date} and status = any(${['reserved', 'done']}) and class_id = any(${classIds}) order by slot_start`) }), (e) => ({ error: pgError(e) }));
  let res = await read(true);
  if (res.error && isMissingColumn(res.error, 'report_mode')) res = await read(false);
  if (res.error) return [];
  return res.rows.map((r) => ({ id: r.id, studentId: r.student_id, classId: r.class_id, absenceDate: String(r.absence_date).slice(0, 10), makeupDate: String(r.makeup_date).slice(0, 10),
    slotStart: String(r.slot_start ?? '').slice(0, 5), slotEnd: String(r.slot_end ?? '').slice(0, 5), periodLabel: r.period_label ?? null, note: r.note ?? null,
    status: r.status === 'done' ? 'done' : 'reserved', createdBy: r.created_by ?? null,
    ...(r.report_mode !== undefined ? { reportMode: R.isMakeupReportMode(r.report_mode) ? r.report_mode : null } : {}) }));
}
/** 2.0 getSplitsOnDate(class-splits/server/queries.ts) — 실패는 빈 결과. */
async function getSplitsOnDate(sql, R, t, date, classIds) {
  const ids = [...new Set(classIds.filter(Boolean))];
  if (ids.length === 0) return { splits: [], classNames: new Map() };
  // 2.0 getSplitsTouchingClasses — 표 없음·조회 실패는 빈 목록.
  const touching = await sql.soft(async (sp) => {
    const cols = (q) => sp`select id, student_id, source_class_id, target_class_id, day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from,
      valid_to::text valid_to, period_kind, note from public.class_splits where tenant_id=${t} and ${q} and valid_from<=${date}`;
    const [out, inc] = await Promise.all([cols(sp`source_class_id = any(${ids})`), cols(sp`target_class_id = any(${ids})`)]);
    const byId = new Map();
    for (const r of [...out, ...inc]) {
      if (!R.isSplitDay(r.day_of_week)) continue;
      const s = { id: r.id, studentId: r.student_id, sourceClassId: r.source_class_id, targetClassId: r.target_class_id, dayOfWeek: r.day_of_week,
        startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5), validFrom: String(r.valid_from).slice(0, 10), validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
        periodKind: r.period_kind === 'day' || r.period_kind === 'month' ? r.period_kind : 'forever', note: r.note ?? null };
      if (R.splitOverlapsRange(s, date, date)) byId.set(s.id, s);
    }
    return [...byId.values()];
  }, []);
  const splits = touching.filter((s) => R.splitActiveOn(s, date));
  if (splits.length === 0) return { splits, classNames: new Map() };
  const names = [...new Set(splits.flatMap((s) => [s.sourceClassId, s.targetClassId]))];
  const rows = await sql.soft((sp) => sp`select c.id, c.class_name, u.display_name from public.classes c left join public.users u on u.id=c.teacher_id where c.tenant_id=${t} and c.id = any(${names})`, []);
  return { splits, classNames: new Map(rows.map((r) => [r.id, { name: r.class_name, teacherName: r.display_name ?? null }])) };
}

/** 2.0 fetchMyMakeupReports — 그날 내가 쓴 순수 보강 보고서(반 없음) + 보고서 없이 추가만 한 보강(세션). */
async function fetchMyMakeupReports(sql, R, t, date, userId, teacherName) {
  const [data, sessions] = await Promise.all([
    sql`select student_id, subject, makeup_class_id, created_by, teacher_name from public.lesson_reports where tenant_id=${t} and report_date=${date} and makeup = true and class_id is null`,
    sql`select student_id, subject_progress from public.onescreen_daily_sessions where tenant_id=${t} and session_date=${date} and updated_by=${userId}`]);
  const reports = data.map((r) => ({ ...r })).filter((r) => R.ownsMakeupReport({ createdBy: r.created_by, teacherName: r.teacher_name }, userId, teacherName));
  const sessionRows = sessions.flatMap((row) => R.makeupSessionEntries(row.subject_progress).map((entry) => ({ student_id: row.student_id, subject: entry.subject,
    makeup_class_id: entry.makeupClassId ?? null, makeup_class_name: entry.makeupClassName, created_by: userId, teacher_name: teacherName })));
  const sessionName = new Map(sessionRows.filter((r) => r.makeup_class_id && r.makeup_class_name).map((r) => [`${r.student_id}|${r.subject}|${r.makeup_class_id}`, r.makeup_class_name]));
  for (const r of reports) {
    if (!r.makeup_class_id || r.makeup_class_name) continue;
    const name = sessionName.get(`${r.student_id}|${(r.subject ?? '').trim() || R.LEGACY_REPORT_SUBJECT}|${r.makeup_class_id}`);
    if (name) r.makeup_class_name = name;
  }
  return [...reports, ...sessionRows];
}

const blankStudent = (stu, tmax, extra) => ({ id: stu.id, name: stu.name, grade: stu.grade ?? '', ...extra, attendance: '출석', subjects: [],
  tests: { daily: { score: null, max: tmax, prevScore: null }, check: { score: null, max: tmax, prevScore: null } },
  attitude: null, homework: '', note: '', progressConfirmed: false, reportDraft: '', reportSent: false });

/** 2.0 getTeacherRoster(rawDate, showAll) — 같은 단계·같은 조건·같은 판정. `env`는 로그인 사용자·설정·권한 판정 재료. */
async function getTeacherRoster(sql, R, env, rawDate, showAll) {
  const { t, actor, settings, asOf } = env;
  const targetDate = R.resolveReportDate(rawDate, asOf), today = R.formatKoreanDate(targetDate), dow = DOW_KEY[R.weekdayIndexOf(targetDate)];
  const teacherId = actor.id, teacherName = actor.display_name ?? '';
  const subjects = R.buildSubjectMaps(settings.operations.subjects), gradeOrder = settings.operations.gradeLevels;
  const subjectTestMax = new Map(settings.operations.subjects.map((su) => [su.key, su.testMax ?? 5]));
  const allowTeacherTestMax = settings.report.allowTeacherTestMax, { showDailyTest, showCheckTest } = settings.report;
  const academyNoticeMode = settings.report.noticeMode ?? 'A';

  // 1) 그날 가르치는 반 · 본인 멘트 모드·화면 설정 · 학생 순서 · 출결 쓰기 권한 · 로고 · 휴원일 — 서로 독립(B4).
  const [teachingClasses, [meRow], orderRows, canEditAttendance, logoSrc, holidayName] = await Promise.all([
    getTeachingClasses(sql, R, settings, t, teacherId, targetDate),
    // 2.0은 둘 다 `{ data }`만 본다(`.single()` 실패 = 행 없음 · 순서 실패 = 순서 없음).
    sql.soft((sp) => sp`select report_notice_mode, ui_prefs from public.users where tenant_id=${t} and id=${teacherId}`, []),
    sql.soft((sp) => sp`select class_id, student_ids from public.onescreen_student_order where tenant_id=${t} and teacher_id=${teacherId}`, []),
    env.canWriteAttendance,
    settings.report.showLogo ? brandingSrc(sql, R, R.reportLogoPath(settings), t) : Promise.resolve(null),
    Promise.resolve().then(() => R.holidayNameOn(R.buildHolidayMap(settings.operations.holidays), targetDate)).catch(() => null)]);
  const orderByClass = new Map(orderRows.map((r) => [r.class_id, r.student_ids ?? []]));
  const noticeMode = meRow?.report_notice_mode ?? null;
  const config = { allowTeacherTestMax, showDailyTest, showCheckTest, noticeMode, academyNoticeMode,
    classnoteSendEnabled: R.classnoteSendOn(settings), classnoteOn: R.classnoteModuleOn(settings),
    sendWindow: R.classnoteSendWindowLabel(settings.report.classnoteSendWindowStart, settings.report.classnoteSendWindowEnd)
      ? { start: settings.report.classnoteSendWindowStart.trim(), end: settings.report.classnoteSendWindowEnd.trim() } : null,
    showAttachments: settings.report.showAttachments, canEditAttendance, fontSize: R.readOnescreenFontSize(meRow?.ui_prefs),
    displayOptions: R.readDisplayOptions(meRow?.ui_prefs), trendOptOut: R.readTrendOptOut(meRow?.ui_prefs),
    reportSettings: settings.report, academyName: settings.profile.name || '', logoSrc, holidayName };
  const emptyRoster = (cfg) => ({ today, date: targetDate, classTags: [R.CLASS_TAG_ALL], teacherName, students: [], todayClasses: [], noClassesToday: false, showingAll: false, ...cfg });

  const allClasses = teachingClasses.map((c) => ({ id: c.id, class_name: c.className, subject: c.subject, is_special: c.isSpecial, report_optout: c.reportOptout,
    delegated: c.delegated, ownerName: c.ownerName, delegatedAwayTo: c.delegatedAwayTo }));
  const allIds = allClasses.map((c) => c.id);
  // 보강 참여(운영 중일 때만 RPC) — 저장점을 쓰므로 다른 조회와 겹치지 않게 먼저 끝낸다(읽기라 순서는 결과를 바꾸지 않는다).
  const nativeOutcome = await loadNativeParticipants(sql, R, settings, { session_date: targetDate, limit: 500 })
    .catch(() => ({ status: 'failed', error: MAKEUP_UNREAD_NOTICE }));
  const [scheds, makeupReports, makeupAttRows, reservationsToday, splitsToday] = await Promise.all([
    allIds.length ? sql`select class_id, start_time::text start_time, end_time::text end_time, day_of_week::text day_of_week, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label
      from public.class_schedules where tenant_id=${t} and day_of_week::text=${dow} and class_id = any(${allIds})
      and (valid_from is null or valid_from<=${targetDate}) and (valid_to is null or valid_to>=${targetDate})` : [],
    fetchMyMakeupReports(sql, R, t, targetDate, teacherId, teacherName),
    allIds.length ? sql`select student_id, class_id from public.attendance_records where tenant_id=${t} and session_date=${targetDate} and status='makeup' and class_id = any(${allIds})` : [],
    getRosterReservationsOn(sql, R, t, targetDate, allIds),
    getSplitsOnDate(sql, R, t, targetDate, allIds)]);
  const reservedToday = reservationsToday.filter((r) => r.status === 'reserved');
  const nativeUnread = nativeOutcome.status === 'failed' || (nativeOutcome.status === 'ok' && nativeOutcome.value.truncated);
  const conducted = R.conductedPairs(nativeOutcome.status === 'ok' && !nativeUnread ? nativeOutcome.value.participants : [], teacherId);
  const emptyConfig = nativeUnread ? { ...config, makeupNotice: MAKEUP_UNREAD_NOTICE } : config;
  if (allClasses.length === 0 && makeupReports.length === 0 && makeupAttRows.length === 0 && reservedToday.length === 0 && conducted.length === 0) return emptyRoster(emptyConfig);
  const todayIds = new Set(scheds.map((s) => s.class_id));
  const endByClass = R.lessonEndsByClass(scheds), startByClass = new Map();
  for (const s of scheds) {
    const tm = s.start_time ? String(s.start_time).slice(0, 5) : null, prev = startByClass.get(s.class_id);
    if (prev === undefined) startByClass.set(s.class_id, tm);
    else if (tm && (prev === null || tm < prev)) startByClass.set(s.class_id, tm);
  }
  const autoUnitsByClass = new Map();
  {
    const schedsByClass = new Map();
    for (const s of scheds) { const list = schedsByClass.get(s.class_id) ?? []; list.push(R.toAutoUnitsSchedule(s)); schedsByClass.set(s.class_id, list); }
    if (R.lessonProfileOf(settings).autoUnits) for (const c of allClasses) {
      if (!R.isAutoUnitsSubject(c.subject)) continue;
      const u = R.autoUnitsOn(targetDate, schedsByClass.get(c.id) ?? []);
      if (u !== null) autoUnitsByClass.set(c.id, u);
    }
  }
  const noClassesToday = todayIds.size === 0;
  if (noClassesToday && !showAll && makeupReports.length === 0 && makeupAttRows.length === 0 && reservedToday.length === 0 && conducted.length === 0)
    return emptyRoster({ ...emptyConfig, noClassesToday: true });
  const activeClasses = noClassesToday ? (showAll ? allClasses : []) : allClasses.filter((c) => todayIds.has(c.id));
  const classById = new Map(activeClasses.map((c) => [c.id, c])), activeIds = activeClasses.map((c) => c.id);

  // 3) 그날 수강생 — 날짜창은 SQL, 분리등원·휴원·반이동은 2.0 rosterIncludesEnrollment.
  const enrollmentRows = activeIds.length ? await sql`select student_id, class_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days
    from public.enrollments where tenant_id=${t} and (start_date is null or start_date<=${targetDate}) and (end_date is null or end_date>=${targetDate}) and class_id = any(${activeIds})` : [];
  const enrollments = enrollmentRows.filter((e) => R.rosterIncludesEnrollment(e, targetDate, dow, todayIds.size > 0));
  enrollments.sort((a, b) => (startByClass.get(a.class_id) ?? '99:99').localeCompare(startByClass.get(b.class_id) ?? '99:99') || a.class_id.localeCompare(b.class_id));
  const classAttRows = activeIds.length ? await sql`select student_id, class_id from public.attendance_records where tenant_id=${t} and session_date=${targetDate} and class_id = any(${activeIds})` : [];
  const attMakeup = [];
  for (const classId of activeIds) {
    const enrolled = enrollments.filter((e) => e.class_id === classId).map((e) => e.student_id), recorded = classAttRows.filter((r) => r.class_id === classId).map((r) => r.student_id);
    for (const id of R.makeupStudentIds(recorded, enrolled)) attMakeup.push({ studentId: id, classId });
  }
  const activeIdSet = new Set(activeIds), rescueSeen = new Set();
  for (const r of makeupAttRows) {
    if (activeIdSet.has(r.class_id)) continue;
    const key = `${r.student_id}|${r.class_id}`;
    if (rescueSeen.has(key)) continue;
    rescueSeen.add(key);
    attMakeup.push({ studentId: r.student_id, classId: r.class_id });
    const cls = allClasses.find((c) => c.id === r.class_id);
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }
  const alreadyMakeup = new Set(attMakeup.map((m) => `${m.studentId}|${m.classId}`)), enrolledKey = new Set(enrollments.map((e) => `${e.student_id}|${e.class_id}`));
  const reservedPlan = R.planReservedMakeup(reservationsToday, enrolledKey), separateRegular = new Set(reservedPlan.separate.map((s) => `${s.studentId}|${s.classId}`));
  for (const r of reservationsToday) {
    const key = `${r.studentId}|${r.classId}`, splitOff = separateRegular.has(key);
    if (r.status !== 'reserved' && !splitOff) continue;
    if (alreadyMakeup.has(key) || (enrolledKey.has(key) && !splitOff)) continue;
    if (makeupReports.some((m) => m.student_id === r.studentId)) continue;
    alreadyMakeup.add(key);
    attMakeup.push({ studentId: r.studentId, classId: r.classId });
    const cls = allClasses.find((c) => c.id === r.classId);
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }
  const splitPlan = R.planSplitRows(activeIds, targetDate, splitsToday.splits, splitsToday.classNames, enrolledKey);
  const ownClassIds = new Set(allIds), nativePairs = R.rosterNativePairs(alreadyMakeup, participantsOrLegacy(nativeOutcome), teacherId, ownClassIds);
  const foreignIds = R.foreignClassIds(nativePairs.filter((pair) => pair.foreign), ownClassIds);
  let makeupNotice = null, foreignClasses = [];
  if (foreignIds.length > 0) {
    const rows = await sql.soft((sp) => sp`select id, class_name, subject from public.classes where tenant_id=${t} and id = any(${foreignIds})`, null);
    if (rows === null) makeupNotice = MAKEUP_UNREAD_NOTICE;
    else foreignClasses = rows.map((c) => ({ id: c.id, class_name: c.class_name, subject: c.subject, is_special: false, report_optout: false, delegated: false, ownerName: null, delegatedAwayTo: null }));
  }
  const foreignById = new Map(foreignClasses.map((c) => [c.id, c]));
  for (const row of nativePairs) {
    const key = `${row.studentId}|${row.classId}`, cls = row.foreign ? foreignById.get(row.classId) : allClasses.find((c) => c.id === row.classId);
    if (row.foreign && !cls) { makeupNotice = MAKEUP_UNREAD_NOTICE; continue; }
    alreadyMakeup.add(key);
    attMakeup.push({ studentId: row.studentId, classId: row.classId });
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }
  const studentIds = [...new Set([...enrollments.map((e) => e.student_id), ...makeupReports.map((r) => r.student_id), ...attMakeup.map((r) => r.studentId), ...splitPlan.incoming.map((r) => r.studentId)])];
  if (studentIds.length === 0) return emptyRoster({ ...config, ...(makeupNotice ? { makeupNotice } : {}), noClassesToday, showingAll: noClassesToday && showAll });

  // 4)~5) 학생 정보 → 학생 × 반 행(정규 · 보강 보고서 · 보강 출결/예약/참여 · 수업 나누기).
  const studentRows = await sql`select id, name, grade, school from public.students where tenant_id=${t} and id = any(${studentIds})`;
  const studById = new Map(studentRows.map((s) => [s.id, s])), byStudent = new Map(), classNamesByStudent = new Map();
  for (const e of enrollments) {
    const stu = studById.get(e.student_id), cls = classById.get(e.class_id);
    if (!stu || !cls) continue;
    const set = classNamesByStudent.get(stu.id) ?? new Set(); set.add(cls.class_name); classNamesByStudent.set(stu.id, set);
    let os = byStudent.get(stu.id);
    if (!os) { os = blankStudent(stu, subjectTestMax.get(cls.subject) ?? 5, { school: stu.school ?? '', tag: cls.class_name, className: cls.class_name, classId: cls.id }); byStudent.set(stu.id, os); }
    if (!os.subjects.some((su) => su.classId === cls.id)) {
      const label = subjects.labelOf(cls.subject);
      os.subjects.push({ name: label, subjectLabel: label, subjectKey: cls.subject, classId: cls.id, className: cls.class_name, isSpecial: !!cls.is_special,
        ...(cls.report_optout ? { reportOptout: true } : {}), prev: '', today: '', textbook: '', makeup: false, homeworkToday: '' });
    }
  }
  if (makeupReports.length) {
    const classNameById = new Map([...allClasses, ...foreignClasses].map((c) => [c.id, c.class_name]));
    for (const mr of makeupReports) {
      const stu = studById.get(mr.student_id);
      if (!stu) continue;
      const key = (mr.subject ?? '').trim() || R.LEGACY_REPORT_SUBJECT, label = subjects.labelOf(key);
      const anchorName = mr.makeup_class_id ? (classNameById.get(mr.makeup_class_id) ?? mr.makeup_class_name ?? null) : null;
      let os = byStudent.get(stu.id);
      if (!os) { os = blankStudent(stu, subjectTestMax.get(key) ?? 5, { tag: anchorName ?? '보강', className: anchorName ?? '보강', isMakeup: true }); byStudent.set(stu.id, os); }
      if (os.subjects.some((su) => su.makeup && !su.classId && (su.subjectKey ?? '') === key)) continue;
      os.subjects.push({ name: `${label} (보강)`, subjectLabel: label, subjectKey: key, classId: null, makeup: true, makeupClassId: mr.makeup_class_id, makeupClassName: anchorName,
        prev: '', today: '', textbook: '', homeworkToday: '' });
    }
  }
  if (attMakeup.length) {
    const classNameById = new Map(allClasses.map((c) => [c.id, c.class_name]));
    for (const row of attMakeup) {
      const stu = studById.get(row.studentId), cls = classById.get(row.classId);
      if (!stu || !cls) continue;
      const key = cls.subject, label = subjects.labelOf(key), anchorName = classNameById.get(row.classId) ?? cls.class_name;
      let os = byStudent.get(stu.id);
      if (!os) { os = blankStudent(stu, subjectTestMax.get(key) ?? 5, { tag: anchorName, className: anchorName, isMakeup: true }); byStudent.set(stu.id, os); }
      if (os.subjects.some((su) => su.makeup && !su.classId && (su.subjectKey ?? '') === key)) continue;
      os.subjects.push({ name: `${label} (보강)`, subjectLabel: label, subjectKey: key, classId: null, makeup: true, makeupClassId: row.classId, makeupClassName: anchorName,
        prev: '', today: '', textbook: '', homeworkToday: '' });
    }
  }
  for (const row of splitPlan.incoming) {
    const stu = studById.get(row.studentId), cls = classById.get(row.classId);
    if (!stu || !cls) continue;
    const label = subjects.labelOf(cls.subject);
    let os = byStudent.get(stu.id);
    if (!os) { os = blankStudent(stu, subjectTestMax.get(cls.subject) ?? 5, { school: stu.school ?? '', tag: cls.class_name, className: cls.class_name, classId: cls.id }); byStudent.set(stu.id, os); }
    const names = classNamesByStudent.get(stu.id) ?? new Set(); names.add(cls.class_name); classNamesByStudent.set(stu.id, names);
    if (os.subjects.some((su) => su.classId === cls.id)) continue;
    os.subjects.push({ name: label, subjectLabel: label, subjectKey: cls.subject, classId: cls.id, className: cls.class_name, isSpecial: !!cls.is_special, reportOptout: true,
      splitIn: row.note, prev: '', today: '', textbook: '', makeup: false, homeworkToday: '' });
  }
  if (splitPlan.outgoing.size > 0) for (const os of byStudent.values()) for (const su of os.subjects) {
    const note = su.classId ? splitPlan.outgoing.get(`${os.id}|${su.classId}`) : undefined;
    if (note) su.splitOut = note;
  }
  for (const os of byStudent.values()) {
    const dup = new Map();
    for (const su of os.subjects) dup.set(su.name, (dup.get(su.name) ?? 0) + 1);
    for (const su of os.subjects) if ((dup.get(su.name) ?? 0) > 1 && su.className) su.name = `${su.name} · ${su.className}`;
    const used = new Set();
    for (const su of os.subjects) {
      if (!used.has(su.name)) { used.add(su.name); continue; }
      let n = 2;
      while (used.has(`${su.name} (${n})`)) n += 1;
      su.name = `${su.name} (${n})`; used.add(su.name);
    }
  }

  // 오늘 보고서 · 직전 회차(RPC) · 출결 · 세션 · ECS 시트 · 교재요청서 · 학부모 읽음(RPC) · 진도 이상 · 문항수 승계 — 서로 독립(B4).
  const todayIso = targetDate, testMaxFrom = R.addDays(todayIso, -60);
  const [todayReports, priorRows, attRows, sessionRows, sheetPlanRows, sheetMarkRows, textbookRows, readStats, anomalyEvents, priorMaxRows] = await Promise.all([
    sql`select id, student_id, subject, class_id, makeup, share_token::text share_token, classnote_status, to_json(classnote_read_at)#>>'{}' classnote_read_at,
        to_json(revoked_at)#>>'{}' revoked_at, attachments, notes, trend_note, progress, textbook, homework_today, attitude, homework_score, exam_info
      from public.lesson_reports where tenant_id=${t} and report_date=${todayIso} and student_id = any(${studentIds}) order by created_at asc, id asc`,
    // 직전 회차 = 2.0 RPC 그대로(선생님 신분 — auth_tenant_id). 실패는 2.0처럼 로그만 남기고 빈 목록(이전 회차만 빠진다).
    sql.soft((sp) => sp`select student_id, subject, class_id, report_date::text report_date, progress, exam_info, textbook, homework_today, homework_score, attitude, notes, recent_progress
      from public.onescreen_prior_reports(${studentIds}::uuid[], ${todayIso}::date)`, (e) => { console.error('[v2-onescreen-roster] onescreen_prior_reports 실패', e.message); return []; }),
    sql`select student_id, class_id, status::text status, to_json(recorded_at)#>>'{}' recorded_at, note, session_units::text session_units
      from public.attendance_records where tenant_id=${t} and session_date=${todayIso} and student_id = any(${studentIds}) order by recorded_at desc, id desc`,
    sql`select student_id, study_grade, subject_progress, daily_score, daily_max, check_score, check_max, attitude, homework, special_note, progress_confirmed, to_json(updated_at)#>>'{}' updated_at
      from public.onescreen_daily_sessions where tenant_id=${t} and session_date=${todayIso} and updated_by=${teacherId} and student_id = any(${studentIds})`,
    // ECS 시트 계획·학생 기록 — 실패하면 초안·참고 표시만 빠진다(2.0 catch → []).
    activeIds.length ? sql.soft((sp) => sp`select class_id, slot_start::text slot_start, line_no, skill_area, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id = any(${activeIds}) and plan_date=${todayIso} order by id`, []) : [],
    activeIds.length ? sql.soft((sp) => sp`select class_id, student_id, slot_start::text slot_start, status, progress_note from public.class_sheet_student_marks
      where tenant_id=${t} and class_id = any(${activeIds}) and mark_date=${todayIso} order by id`, []) : [],
    // 교재요청서 = 2.0 getTextbookOrdersForStudents(RLS 역할 덮개 auth_textbook_can_use까지 — 선생님 신분으로 묻는다).
    sql`select public.auth_textbook_can_use() ok`.then(async ([g]) => (!g?.ok ? [] : (await sql`select book_name, student_id, teacher_name, request_date::text request_date,
        to_json(created_at)#>>'{}' created_at from public.textbook_orders where tenant_id=${t} and student_id = any(${studentIds})`)
      .map((r) => ({ bookName: r.book_name, studentId: r.student_id, teacherName: r.teacher_name, requestDate: r.request_date, createdAt: r.created_at }))
      .sort((a, b) => (b.requestDate ?? '').localeCompare(a.requestDate ?? '')))),
    // 학부모 읽음(RPC) · 진도 이상 · 문항수 승계 — 실패하면 배지·승계만 빠진다(2.0 [] 폴백).
    // ⚠️ 읽음 RPC의 '4일 지난 미확인'은 DB now()(실제 오늘) 기준이다 — 복사본 기준일로 바꿀 수 없다.
    sql.soft((sp) => sp`select student_id, trackable_count, aged_unread_count, read_count, to_json(last_read_at)#>>'{}' last_read_at
      from public.onescreen_parent_read_stats(${studentIds}::uuid[], 5)`, []),
    sql.soft((sp) => sp`select student_id from public.progress_events where tenant_id=${t} and event_type = any(${['jump_error', 'overlap_error']}) and resolved_at is null
      and created_at >= ${`${R.addDays(todayIso, -14)}T00:00:00+09:00`}::timestamptz and student_id = any(${studentIds})`, []),
    allowTeacherTestMax ? sql.soft((sp) => sp`select student_id, session_date::text session_date, daily_max, check_max from public.onescreen_daily_sessions where tenant_id=${t} and updated_by=${teacherId}
      and session_date<${todayIso} and session_date>=${testMaxFrom} and student_id = any(${studentIds}) order by session_date desc, student_id asc`, []) : []]);

  const sheetAreaLabel = new Map((await resolveSkillAreas(settings.operations.subjects.find((s) => s.key === 'english'))).map((a) => [a.key, a.label]));
  const sheetLinesByClass = new Map();
  for (const r of sheetPlanRows) {
    const arr = sheetLinesByClass.get(r.class_id) ?? [];
    arr.push({ slotStart: r.slot_start, lineNo: r.line_no, skillArea: r.skill_area, textbook: r.textbook, pageRange: r.page_range, progress: r.progress, homework: r.homework });
    sheetLinesByClass.set(r.class_id, arr);
  }
  const sheetDraftByClass = new Map();
  for (const [classId, lines] of sheetLinesByClass) { const draft = R.buildSheetDraft(lines, (k) => sheetAreaLabel.get(k) ?? null); if (R.hasSheetDraft(draft)) sheetDraftByClass.set(classId, draft); }
  const sheetMarkByKey = new Map();
  for (const r of [...sheetMarkRows].sort((a, b) => a.slot_start.localeCompare(b.slot_start) || a.student_id.localeCompare(b.student_id))) {
    const note = (r.progress_note ?? '').trim();
    if (!note) continue;
    const key = `${r.class_id}|${r.student_id}`, prev = sheetMarkByKey.get(key);
    sheetMarkByKey.set(key, prev ? `${prev}\n${note}` : note);
  }
  const seededDailyMax = new Set(), seededCheckMax = new Set();
  for (const r of priorMaxRows) {
    const os = byStudent.get(r.student_id);
    if (!os) continue;
    if (allowTeacherTestMax && r.daily_max != null && !seededDailyMax.has(r.student_id)) { os.tests.daily.max = r.daily_max; seededDailyMax.add(r.student_id); }
    if (allowTeacherTestMax && r.check_max != null && !seededCheckMax.has(r.student_id)) { os.tests.check.max = r.check_max; seededCheckMax.add(r.student_id); }
  }
  const sessionById = new Map(sessionRows.map((r) => [r.student_id, r]));
  const bookByStudent = new Map();
  {
    const byStu = new Map();
    for (const tb of textbookRows) { if (!tb.studentId || !tb.bookName?.trim()) continue; const arr = byStu.get(tb.studentId) ?? []; arr.push(tb); byStu.set(tb.studentId, arr); }
    for (const [sid, arr] of byStu) {
      const pick = [...arr].sort((a, b) => { const at = a.teacherName === teacherName ? 0 : 1, bt = b.teacherName === teacherName ? 0 : 1;
        if (at !== bt) return at - bt; return (b.requestDate ?? b.createdAt ?? '').localeCompare(a.requestDate ?? a.createdAt ?? ''); })[0];
      if (pick?.bookName?.trim()) bookByStudent.set(sid, pick.bookName.trim());
    }
  }
  const sentToday = new Set(), todayByStudent = new Map();
  for (const r of todayReports) { sentToday.add(r.student_id); (todayByStudent.get(r.student_id) ?? todayByStudent.set(r.student_id, []).get(r.student_id)).push(r); }
  const todayReportIds = todayReports.map((r) => r.id);
  const carryProgressOf = (r) => R.carryProgress(r.recent_progress);
  const rowSubjectsByStudent = new Map();
  for (const os of byStudent.values()) rowSubjectsByStudent.set(os.id, new Set(os.subjects.map((su) => su.subjectKey?.trim() || R.LEGACY_REPORT_SUBJECT)));
  const subjectOfPrior = (r) => R.reportSubject({ subject: r.subject, classSubject: r.class_id ? classById.get(r.class_id)?.subject : null });
  const priorReport = new Map(), priorByStudent = new Map();
  for (const r of priorRows) {
    (priorByStudent.get(r.student_id) ?? priorByStudent.set(r.student_id, []).get(r.student_id)).push(r);
    if (!rowSubjectsByStudent.get(r.student_id)?.has(subjectOfPrior(r))) continue;
    const cur = priorReport.get(r.student_id);
    if (!cur || r.report_date > cur.date) priorReport.set(r.student_id, { progress: carryProgressOf(r) ?? r.progress, examInfo: r.exam_info, date: r.report_date });
  }
  // 오늘 보고서 열람 수 — 2.0은 행을 받아 JS로 세었다. 같은 수를 SQL에서 센다(B2).
  const viewCountByReport = new Map((todayReportIds.length ? await sql`select lesson_report_id, count(*)::int n from public.share_link_views
    where tenant_id=${t} and lesson_report_id = any(${todayReportIds}) group by lesson_report_id` : []).map((v) => [v.lesson_report_id, v.n]));
  const myClassIdSet = new Set(allIds), myAttClassesByStudent = new Map();
  for (const a of attRows) {
    if (!myClassIdSet.has(a.class_id)) continue;
    (myAttClassesByStudent.get(a.student_id) ?? myAttClassesByStudent.set(a.student_id, new Set()).get(a.student_id)).add(a.class_id);
  }
  const attByRow = new Map();
  for (const a of attRows) {
    const k = `${a.student_id}::${a.class_id}`;
    if (attByRow.has(k)) continue;
    const u = a.session_units == null ? null : Number(a.session_units);
    attByRow.set(k, { status: a.status, note: a.note ?? null, units: Number.isFinite(u) ? u : null });
  }
  // 오늘 수학 채움 = 학원 설정 토글 ∧ 지점 라이선스(못 읽으면 꺼짐) — 결과 조회 실패는 채우지 않는다(2.0 loadTodaysMathFill).
  const todaysMathRows = settings.report.todaysMathTestFill && (await env.todaysMathOptedIn())
    ? await sql.soft((sp) => sp`select student_id, class_id, kind, question_count, absent, correct_count, to_json(taken_at)#>>'{}' taken_at from public.todays_math_test_results
        where tenant_id=${t} and test_date=${targetDate} and kind = any(${['daily', 'review']}) and student_id = any(${[...byStudent.keys()]})`, [])
    : [];

  for (const os of byStudent.values()) {
    os.reportSent = sentToday.has(os.id);
    const rowRefs = () => os.subjects.map((su) => ({ classId: su.classId ?? null, subjectKey: su.subjectKey ?? null, isSpecial: su.isSpecial, isMakeup: !!su.makeup && !su.classId }));
    const todayMatched = R.matchReportsToRows(rowRefs(), (todayByStudent.get(os.id) ?? []).map((r) => ({ ...r, classId: r.class_id })));
    const savedToday = new Map();
    os.subjects.forEach((su, i) => {
      const r = todayMatched[i];
      if (!r) return;
      savedToday.set(su.name, { progress: r.progress, textbook: r.textbook, homework_today: r.homework_today, attitude: r.attitude ?? null, homework_score: r.homework_score ?? null, exam_info: r.exam_info ?? null });
      su.reportSent = true;
      su.shareToken = r.share_token ?? undefined;
      su.classnoteStatus = r.classnote_status ?? undefined;
      su.classnoteReadAt = r.classnote_read_at ?? undefined;
      su.revokedAt = r.revoked_at ?? undefined;
      su.viewCount = viewCountByReport.get(r.id) ?? 0;
      su.attachments = r.attachments ?? [];
      if (r.notes) su.draft = r.notes;
      if (r.trend_note) su.trendDraft = r.trend_note;
    });
    for (const su of os.subjects) {
      if (!su.classId) continue;
      const rec = attByRow.get(`${os.id}::${su.classId}`);
      su.attendanceRaw = rec?.status ?? null; su.attendanceNote = rec?.note ?? null; su.attendanceUnits = rec?.units ?? null;
      const autoUnits = autoUnitsByClass.get(su.classId);
      if (autoUnits !== undefined) su.attendanceAutoUnits = autoUnits;
    }
    const rowClassIds = new Set(os.subjects.map((su) => su.classId).filter(Boolean)), offRow = {};
    let offRowCount = 0;
    for (const cid of myAttClassesByStudent.get(os.id) ?? []) {
      if (rowClassIds.has(cid)) continue;
      const rec = attByRow.get(`${os.id}::${cid}`);
      if (rec) { offRow[cid] = rec.status; offRowCount += 1; }
    }
    if (offRowCount) os.attendanceOffRow = offRow;
    os.attendance = R.studentMarkFromRows(os);
    const pr = priorReport.get(os.id);
    if (pr && !os.subjects.some((su) => su.isSpecial)) {
      const { daily, check } = R.parseExamScores(pr.examInfo);
      os.tests.daily.prevScore = daily; os.tests.check.prevScore = check;
      if (pr.progress) {
        let matched = false;
        for (const su of os.subjects) { const label = su.subjectLabel || su.name; if (label && pr.progress.startsWith(label)) { su.prev = pr.progress.slice(label.length).trim() || pr.progress; matched = true; } }
        if (!matched && os.subjects[0]) os.subjects[0].prev = pr.progress;
      }
    }
    const reqBook = bookByStudent.get(os.id);
    const priorMatched = R.matchReportsToRows(rowRefs(), (priorByStudent.get(os.id) ?? []).map((r) => ({ ...r, classId: r.class_id })), { legacyFallback: true });
    os.subjects.forEach((su, i) => {
      const pbs = priorMatched[i], label = su.subjectLabel || su.name;
      if (pbs) {
        const prog = pbs.progress && label && pbs.progress.startsWith(label) ? pbs.progress.slice(label.length).trim() || pbs.progress : pbs.progress;
        su.prevReport = { date: pbs.report_date, progress: prog ?? null, textbook: pbs.textbook ?? null, homeworkToday: pbs.homework_today ?? null, homeworkScore: pbs.homework_score ?? null,
          attitude: pbs.attitude ?? null, examInfo: pbs.exam_info ?? null, note: pbs.notes ?? null };
        if (prog) su.prev = prog;
        const carry = carryProgressOf(pbs);
        if (carry) su.prev = label && carry.startsWith(label) ? carry.slice(label.length).trim() || carry : carry;
      }
      const prevBook = R.stripTextbookPages(su.prevReport?.textbook ?? '');
      if (prevBook) su.textbook = prevBook;
      if (reqBook && (su.subjectKey?.trim() || R.LEGACY_REPORT_SUBJECT) === R.LEGACY_REPORT_SUBJECT) su.textbook = reqBook;
      const sheet = su.classId ? sheetDraftByClass.get(su.classId) : undefined;
      if (sheet) {
        su.sheetDraft = sheet;
        if (!su.reportSent) {
          if (sheet.progress && !su.today) su.today = sheet.progress;
          if (sheet.homework && !su.homeworkToday) su.homeworkToday = sheet.homework;
          const isMathRow = (su.subjectKey?.trim() || R.LEGACY_REPORT_SUBJECT) === R.LEGACY_REPORT_SUBJECT;
          if (sheet.textbook && !(isMathRow && reqBook)) su.textbook = sheet.textbook;
        }
      }
      const saved = savedToday.get(su.name);
      if (saved) {
        const prog = (saved.progress ?? '').trim();
        if (prog && !su.today) su.today = label && prog.startsWith(label) ? prog.slice(label.length).trim() || prog : prog;
        if (saved.textbook && !su.textbook) su.textbook = saved.textbook;
        if (saved.homework_today && !su.homeworkToday) su.homeworkToday = saved.homework_today;
        if (saved.attitude && su.attitude == null) su.attitude = saved.attitude;
        if (saved.homework_score && !su.homework) su.homework = saved.homework_score;
        const savedScore = R.parseExamScores(saved.exam_info), savedMax = R.parseExamMaxes(saved.exam_info);
        if (savedScore.daily != null && su.dailyScore == null) { su.dailyScore = savedScore.daily; if (savedMax.daily != null) su.dailyMax = savedMax.daily; }
        if (savedScore.check != null && su.checkScore == null) { su.checkScore = savedScore.check; if (savedMax.check != null) su.checkMax = savedMax.check; }
      }
      const mark = su.classId ? sheetMarkByKey.get(`${su.classId}|${os.id}`) : undefined;
      if (mark) su.sheetStudentNote = mark;
    });
    const sess = sessionById.get(os.id);
    if (sess) {
      if (sess.updated_at) os.sessionUpdatedAt = sess.updated_at;
      if (sess.study_grade) os.studyGrade = sess.study_grade;
      if (sess.daily_score != null) os.tests.daily.score = sess.daily_score;
      if (sess.daily_max != null) os.tests.daily.max = sess.daily_max;
      if (sess.check_score != null) os.tests.check.score = sess.check_score;
      if (sess.check_max != null) os.tests.check.max = sess.check_max;
      if (sess.attitude != null) os.attitude = sess.attitude;
      if (sess.homework != null) os.homework = sess.homework;
      if (sess.special_note != null) os.note = sess.special_note;
      if (sess.progress_confirmed != null) os.progressConfirmed = sess.progress_confirmed;
      const sp = sess.subject_progress ?? {}, legacyTaken = new Set();
      for (const su of os.subjects) {
        const makeupKey = su.makeup && !su.classId ? `makeup::${su.subjectKey || su.name}` : null;
        const legacyKey = su.subjectKey || su.name;
        let entry = makeupKey ? sp[makeupKey] : su.classId ? sp[su.classId] : undefined;
        if (!entry && !makeupKey && !su.splitIn && !legacyTaken.has(legacyKey)) { entry = sp[legacyKey]; if (entry) legacyTaken.add(legacyKey); }
        if (entry?.today) su.today = entry.today;
        if (entry?.mode != null) su.progressMode = entry.mode || null;
        if (entry?.textbook != null) su.textbook = entry.textbook;
        if (entry?.makeup != null) su.makeup = entry.makeup;
        if (entry?.homeworkToday != null) su.homeworkToday = entry.homeworkToday;
        if (typeof entry?.videoHomework === 'boolean') su.videoHomework = entry.videoHomework;
        if (typeof entry?.videoSubmitLink === 'boolean') su.videoSubmitLink = entry.videoSubmitLink;
        if (entry?.videoHomeworkDue === 'week' || entry?.videoHomeworkDue === 'next') su.videoHomeworkDue = entry.videoHomeworkDue;
        if (entry?.draft?.trim()) su.draft = entry.draft;
        if (entry?.trendDraft?.trim()) su.trendDraft = entry.trendDraft;
        if (entry?.autoDraft?.trim()) su.autoDraft = entry.autoDraft;
        if (entry?.trendAutoDraft?.trim()) su.trendAutoDraft = entry.trendAutoDraft;
        if (entry?.autoDraftTemplate === true) su.autoDraftTemplate = true;
        if (entry?.templateId) su.templateId = entry.templateId;
        if (entry?.nextTest != null) su.nextTest = entry.nextTest;
        if (entry?.aiIntro != null) su.aiIntro = entry.aiIntro;
        if (entry?.aiComment != null) su.aiComment = entry.aiComment;
        if (entry?.templateHash) su.templateHash = entry.templateHash;
        if (entry?.aiFactsHash) su.aiFactsHash = entry.aiFactsHash;
        if (entry?.composedFactsHash) su.composedFactsHash = entry.composedFactsHash;
        if (entry?.attitude !== undefined) su.attitude = entry.attitude;
        if (entry?.homework !== undefined) su.homework = entry.homework;
        if (entry?.note !== undefined) su.note = entry.note;
        if (entry?.dailyScore !== undefined) su.dailyScore = entry.dailyScore;
        if (entry?.dailyMax !== undefined) su.dailyMax = entry.dailyMax;
        if (entry?.checkScore !== undefined) su.checkScore = entry.checkScore;
        if (entry?.checkMax !== undefined) su.checkMax = entry.checkMax;
        if (entry?.understanding !== undefined) su.understanding = R.readUnderstanding(entry.understanding);
        if (entry?.dailyTestSkip !== undefined) su.dailyTestSkip = R.readTestSkip(entry.dailyTestSkip);
        if (entry?.homeworkMissReason !== undefined) su.homeworkMissReason = R.readHomeworkMissReason(entry.homeworkMissReason);
        if (entry?.attitudeNote !== undefined) su.attitudeNote = R.readAttitudeNote(entry.attitudeNote);
        if (entry?.makeupReason !== undefined) su.makeupReason = R.readMakeupReason(entry.makeupReason);
      }
    }
    R.applyReservedMakeup(os, reservedPlan);
    const prMax = R.parseExamMaxes(pr?.examInfo);
    if (prMax.daily != null && prMax.daily !== os.tests.daily.max) os.tests.daily.prevScore = null;
    if (prMax.check != null && prMax.check !== os.tests.check.max) os.tests.check.prevScore = null;
    if (todaysMathRows.length) {
      R.applyTodaysMathFill(os, todaysMathRows, { daily: showDailyTest, check: showCheckTest, isMathRow: (su) => (su.subjectKey?.trim() || R.LEGACY_REPORT_SUBJECT) === R.LEGACY_REPORT_SUBJECT });
      for (const su of os.subjects) {
        if (su.todaysMath?.daily && prMax.daily != null && prMax.daily !== su.todaysMath.daily.max) os.tests.daily.prevScore = null;
        if (su.todaysMath?.check && prMax.check != null && prMax.check !== su.todaysMath.check.max) os.tests.check.prevScore = null;
      }
    }
    const classNames = [...(classNamesByStudent.get(os.id) ?? [])];
    os.tags = classNames.length ? classNames : os.tag ? [os.tag] : [];
  }

  const gradeRank = (g) => { const i = gradeOrder.indexOf(g); return i === -1 ? 999 : i; };
  const countByClass = new Map();
  for (const e of enrollments) countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1);
  const todayClasses = activeClasses.map((c) => ({ id: c.id, name: c.class_name, subject: subjects.labelOf(c.subject), subjectKey: c.subject ?? '', startTime: startByClass.get(c.id) ?? null,
    endTime: endByClass.get(c.id) ?? null, studentCount: countByClass.get(c.id) ?? 0, reportOptout: !!c.report_optout, delegated: c.delegated, ownerName: c.ownerName, delegatedAwayTo: c.delegatedAwayTo }))
    .filter((c) => c.studentCount > 0).sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
  const readBySid = new Map(readStats.map((r) => [r.student_id, r])), anomalyCountBySid = new Map();
  for (const e of anomalyEvents) anomalyCountBySid.set(e.student_id, (anomalyCountBySid.get(e.student_id) ?? 0) + 1);
  for (const s of byStudent.values()) {
    const rs = readBySid.get(s.id);
    if (rs && rs.trackable_count > 0) s.parentRead = { trackableCount: rs.trackable_count, agedUnreadCount: rs.aged_unread_count, readCount: rs.read_count, lastReadAt: rs.last_read_at };
    const anomalyCount = anomalyCountBySid.get(s.id) ?? 0;
    if (anomalyCount > 0) s.progressSignal = { anomalyCount };
  }
  const classRank = new Map(todayClasses.map((c, i) => [c.name, i]));
  const students = R.applyStudentOrder([...byStudent.values()].sort((a, b) => (classRank.get(a.className ?? '') ?? 999) - (classRank.get(b.className ?? '') ?? 999)
    || gradeRank(a.grade) - gradeRank(b.grade) || a.name.localeCompare(b.name, 'ko')), orderByClass);
  return { today, date: targetDate, classTags: [R.CLASS_TAG_ALL, ...todayClasses.map((c) => c.name)], teacherName, students, todayClasses, ...config,
    ...(makeupNotice ? { makeupNotice } : {}), noClassesToday, showingAll: noClassesToday && showAll };
}

// ── page.tsx가 로스터 옆에서 읽는 것들 ─────────────────────────────────────────────────────────────────────────────────────
/** 2.0 report-author-name 서버의 칸 없음 판정(0217a 미적용). */
const isAuthorColumnMissing = (message) => /report_display_name|report_class_name_prefix/.test(message) && /(does not exist|42703|column)/i.test(message);
/** 2.0 resolveReportAuthorSettings — 발송용 이름(동명 직원이면 미적용). 새 옵션 칸이 없으면 그 칸 없이 다시, 그 밖의 실패는 원래 이름. */
async function resolveReportAuthorSettings(sql, R, t, teacherName) {
  const EMPTY = { name: null, includeClassName: false }, name = teacherName ?? '';
  if (!name.trim()) return EMPTY;
  let res = await sql.soft(async (sp) => ({ rows: await sp`select display_name, report_display_name, report_class_name_prefix from public.users
    where tenant_id=${t} and display_name=${name} and system_role <> 'student' limit 2` }), (e) => ({ error: pgError(e) }));
  if (res.error && /report_class_name_prefix/.test(res.error.message ?? '') && isAuthorColumnMissing(res.error.message ?? '')) {
    res = await sql.soft(async (sp) => ({ rows: (await sp`select display_name, report_display_name from public.users
      where tenant_id=${t} and display_name=${name} and system_role <> 'student' limit 2`).map((r) => ({ ...r, report_class_name_prefix: false })) }), (e) => ({ error: pgError(e) }));
  }
  if (res.error) return EMPTY;
  return R.pickReportAuthorSettings(name, res.rows.map((r) => ({ displayName: r.display_name, reportDisplayName: r.report_display_name, includeClassName: r.report_class_name_prefix === true })));
}
/** 2.0 getClassnoteMatchMap — 'C.N' 반 보드 매칭. 기능이 꺼졌거나 보드가 없거나 실패면 CN_UNAVAILABLE. */
async function getClassnoteMatchMap(sql, R, settings, t, today) {
  if (!R.classnoteModuleOn(settings)) return R.CN_UNAVAILABLE;
  return sql.soft(async (sp) => {
    const [members, boards, eligible] = await Promise.all([
      sp`select class_id, student_id, status, child_name, reason from public.classnote_class_board_members where tenant_id=${t} order by id`,
      sp`select class_id, board_name from public.classnote_class_boards where tenant_id=${t} order by class_id`,
      sp`select id, class_name, is_special, closed_at::text closed_at from public.classes where tenant_id=${t} and subject = any(${['math', 'subject_1']}) and is_active = true and report_optout = false order by id`]);
    if (boards.length === 0) return R.CN_UNAVAILABLE;
    const linked = new Set(boards.map((b) => b.class_id));
    return R.buildCnMatchMap(members, boards, eligible.filter((c) => !c.closed_at || c.closed_at >= today || linked.has(c.id)).map((c) => c.id));
  }, R.CN_UNAVAILABLE);
}
/** 2.0 video-homework 서버 조회(queries · assignments · report-due · cancels) + link-choice-db — 같은 조건, 같은 실패 처리. */
async function videoHomeworkReads(sql, R, t, ids, date, policyOn, targets, dates, ownerId) {
  // 2.0의 칸·표 probe(`select 칸 limit 1`이 되면 있다) — 못 물으면 없는 것으로(그 기능은 '모름'·'준비 안 됨'으로 떨어진다).
  const probe = (check) => sql.soft(async (sp) => { await check(sp); return true; }, false);
  const marks = async (homeworkDates) => {
    if (!ids.length) return [];
    const days = [...new Set(homeworkDates.filter(Boolean))];
    const map = (rows) => rows.map((r) => ({ classId: r.class_id, studentId: r.student_id, checkDate: r.check_date, homeworkDate: r.homework_date, status: r.status }));
    const [today, same] = await Promise.all([
      sql`select class_id, student_id, check_date::text check_date, homework_date::text homework_date, status from public.video_homework_marks where tenant_id=${t} and check_date=${date} and student_id = any(${ids}) order by id`,
      // 같은 숙제를 다른 자리에서 찍은 기록 = 덧붙는 조회(2.0 catch → []).
      days.length ? sql.soft((sp) => sp`select class_id, student_id, check_date::text check_date, homework_date::text homework_date, status from public.video_homework_marks
        where tenant_id=${t} and check_date <> ${date} and homework_date = any(${days}) and student_id = any(${ids}) order by id`, []) : []]);
    return [...map(today), ...map(same)];
  };
  const assignments = async () => {
    const days = [...new Set(dates.filter(Boolean))];
    if (!ids.length || !days.length) return {};
    if (!(await probe((sp) => sp`select video_homework from public.lesson_reports limit 1`))) return null;
    const out = await sql.soft(async (sp) => {
      const o = {};
      for (const r of await sp`select student_id, class_id, report_date::text report_date, video_homework from public.lesson_reports
          where tenant_id=${t} and student_id = any(${ids}) and report_date = any(${days}) and video_homework is not null order by id`)
        if (r.class_id && typeof r.video_homework === 'boolean') o[R.assignmentKey(r.student_id, r.report_date, r.class_id)] = r.video_homework;
      return o;
    }, null);
    if (out === null) return null;
    const issuedDays = [...new Set(targets.flatMap((x) => (x.homeworkDate && x.homeworkDate !== date ? [x.homeworkDate] : [])))];
    if (issuedDays.length) {
      // 2.0 extraIssuesReady: 표가 없으면 건너뛰고, 그 밖의 실패·조회 실패는 지난 수업일의 '없음'만 '모름'으로 돌린다.
      const ready = await sql.soft(async (sp) => { await sp`select homework_date from public.video_homework_extra_issues limit 1`; return 'ready'; },
        (e) => (e?.code === '42P01' || (/video_homework_extra_issues/.test(e?.message ?? '') && /(does not exist|schema cache|could not find)/i.test(e?.message ?? '')) ? 'missing' : 'failed'));
      const extra = ready === 'ready' ? await sql.soft((sp) => sp`select class_id, student_id, homework_date::text homework_date from public.video_homework_extra_issues
          where tenant_id=${t} and kept = false and student_id = any(${ids}) and homework_date = any(${issuedDays})`, null) : ready === 'missing' ? [] : null;
      if (extra) for (const r of extra) out[R.assignmentKey(r.student_id, r.homework_date, r.class_id)] = true;
      else {
        const issued = new Set(issuedDays);
        for (const key of Object.keys(out)) if (out[key] === false && issued.has(key.split('|')[1])) delete out[key];
      }
    }
    return out;
  };
  // 영상 첨부 링크 넣기: 2.0 reportLineMode()가 'off'면(REPORT_VIDEO_LINK_RETIRED) 조회 없이 off. 켜지면 Drive 연결 판정이 필요해 옮기지 않았다(off로 둔다).
  const submitLink = async () => ({ mode: 'off', choices: {}, ...(R.reportLineMode({}) !== 'off' ? { notPorted: true } : {}) });
  const others = async () => {
    if (!ids.length || !date) return [];
    return sql.soft(async (sp) => (await sp`select student_id, class_id, report_date::text report_date from public.lesson_reports where tenant_id=${t} and student_id = any(${ids})
        and report_date=${date} and class_id is not null and created_by is not null and created_by <> ${ownerId} order by id`).map((r) => R.assignmentKey(r.student_id, r.report_date, r.class_id)), []);
  };
  const NOT_READY = { ready: false, dues: {} };
  const dues = async () => {
    if (!(await probe((sp) => sp`select video_homework_due from public.lesson_reports limit 1`))) return NOT_READY;
    if (!ids.length || !date) return { ready: true, dues: {} };
    return sql.soft(async (sp) => {
      const out = {};
      for (const r of await sp`select student_id, class_id, report_date::text report_date, video_homework_due::text video_homework_due from public.lesson_reports
          where tenant_id=${t} and student_id = any(${ids}) and report_date=${date} and video_homework_due is not null order by id`)
        if (r.class_id && R.isCustomDue(r.report_date, r.video_homework_due)) out[R.assignmentKey(r.student_id, r.report_date, r.class_id)] = r.video_homework_due;
      return { ready: true, dues: out };
    }, NOT_READY);
  };
  const cancels = async () => {
    // 읽기 시작한 시각 = 실제 지금(저장 관문이 복사본에 실제 시각으로 적힌 취소와 견준다). 조회 실패·표 없음 = 빈 지도.
    const readAt = new Date().toISOString();
    const rows = ids.length ? await sql.soft((sp) => sp`select class_id, student_id, homework_date::text homework_date, to_json(cancelled_at)#>>'{}' cancelled_at
      from public.video_homework_cancels where tenant_id=${t} and homework_date=${date} and student_id = any(${ids})`, []) : [];
    return { cancels: new Map(rows.map((r) => [R.assignmentKey(r.student_id, r.homework_date, r.class_id), r.cancelled_at])), readAt };
  };
  return Promise.all([
    marks(policyOn ? targets.flatMap((x) => (x.homeworkDate ? [x.homeworkDate] : [])) : []),
    policyOn ? assignments() : {},
    policyOn ? submitLink() : { mode: 'off', choices: {} },
    policyOn ? others() : [],
    policyOn ? dues() : NOT_READY,
    policyOn ? cancels() : { cancels: new Map(), readAt: null }]);
}

/**
 * 기본 선생님 = v2-screen-onescreen.mjs load와 같은 규칙(활성 반 담임 중 최근 30일 보고서 작성 수가 가장 많은 사람) — 재직 중(active)인 사람만.
 * 직접 고른 사람은 2.0 로그인처럼 퇴사자(inactive)·학생만 거른다(2.0 강사뷰 진입 조건 — 실 강사 또는 담당 반 보유 — 은 보지 않는다).
 */
async function pickActor(sql, t, asOf, R, wanted) {
  const cols = sql.frag`u.id, u.display_name, u.system_role::text system_role, u.status::text status`;
  if (wanted) {
    const [u] = await sql`select ${cols} from public.users u where u.tenant_id=${t} and u.id=${wanted} and u.status::text <> 'inactive' and u.system_role::text <> 'student'`;
    if (u) return u;
  }
  const teachers = await sql`select ${cols}, (select count(*)::int from public.lesson_reports r where r.tenant_id=${t} and r.created_by=u.id and r.report_date > ${R.addDays(asOf, -30)}) recent
    from public.users u join public.classes c on c.teacher_id=u.id and c.tenant_id=${t} and c.is_active where u.tenant_id=${t} and u.status::text = 'active' group by u.id order by u.display_name`;
  return [...teachers].sort((a, b) => b.recent - a.recent)[0] ?? null;
}

/**
 * 2.0 원스크린 page.tsx의 부품 props. `params = { teacher?, date?, all? }`(+ 2.0 주소의 `view`·`class`·`student`도 받으면 page.tsx처럼 쓴다).
 * 돌려줌 = `{ asOf, actor, oneScreen, videoHomework, page: { makeupNotice }, hostSettings }` — hostSettings는 2.0 셸이 `<OperationsProvider>`에 넘기는 값,
 * oneScreen·videoHomework는 `<OneScreenClient>`·
 * `<VideoHomeworkProvider>`에 그대로(`key`·children 제외). 선생님이 없으면(활성 반 담임 0명) `actor: null`.
 */
export async function loadOnescreenProps({ sql: tx, params = {}, tenantId: t, importV2 }) {
  const sql = queryGate(tx);
  const R = await rules(importV2), { day: asOf, at: asOfAt } = await copyClock();
  // 2.0 loadTenantSettingsRaw: 설정 행과 지점 이름을 따로 읽는다 — 설정을 못 읽으면 빈 설정(= 침산 기본값)이되 지점 이름은 남고,
  // 지점 이름을 못 읽으면 ''. 라이선스 넷(getLicenseSnapshot)은 못 읽으면 전부 켜짐 = 빈 표.
  const [settingsRow, tenantName, licenseRows, actor] = await Promise.all([
    sql.soft(async (sp) => ({ data: (await sp`select data from public.tenant_settings where tenant_id=${t}`)[0]?.data ?? null }), { failed: true }),
    sql.soft(async (sp) => (await sp`select name from public.tenants where id=${t}`)[0]?.name ?? '', ''),
    sql.soft((sp) => sp`select feature, is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses where tenant_id=${t} and feature = any(${HOST_LICENSES})`, []),
    pickActor(sql, t, asOf, R, params.teacher)]);
  const settings = resolveSettings(R, settingsRow.failed ? {} : settingsRow.data, tenantName);
  // 2.0 (shell)/layout.tsx가 `<OperationsProvider>`에 넘기는 값 — 호스트가 그 부품을 감쌀 때 그대로 쓴다. 라이선스는 행이 있는 것만(없으면 '허용' = useLicenseOn).
  const hostSettings = { operations: { subjects: settings.operations.subjects, gradeLevels: settings.operations.gradeLevels, jobTitles: settings.operations.jobTitles,
    jobTitlesByDepartment: settings.operations.jobTitlesByDepartment }, disabledModules: settings.modules.disabled,
    licenses: Object.fromEntries(licenseRows.map((r) => [r.feature, R.licenseAllows({ is_active: r.is_active, expires_at: r.expires_at }, asOfAt)])) };
  if (!actor) return { asOf, actor: null, oneScreen: null, videoHomework: null, page: { makeupNotice: null }, hostSettings };
  // 이 읽기 트랜잭션 동안 DB가 보는 신분 = 그 선생님(2.0 로그인 세션 자리) — RPC·RLS 판정 함수가 이 값으로 지점·역할을 안다.
  // ⚠️ 트랜잭션 끝까지 남는다 — 같은 트랜잭션으로 다른 load를 부르지 말 것.
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  const matrix = await userPermMatrix(sql, R, settings, actor, t, asOfAt);
  // 2.0 isFeatureOptedIn('todays_math') — 채우기 토글이 켜진 지점만 묻는다. 못 읽으면 꺼짐. 기준 시각 = 복사본의 지금.
  const todaysMathOptedIn = async () => R.licenseExplicitlyOn(await sql.soft(async (sp) => (await sp`select is_active, to_json(expires_at)#>>'{}' expires_at
    from public.tenant_licenses where tenant_id=${t} and feature='todays_math'`)[0] ?? null, null), asOfAt);
  const env = { t, actor, settings, asOf, canWriteAttendance: R.canWrite(actor.system_role, 'attendance', matrix), todaysMathOptedIn };

  const [roster, sendName, classnoteMatch] = await Promise.all([
    getTeacherRoster(sql, R, env, params.date, params.all === '1'),
    resolveReportAuthorSettings(sql, R, t, actor.display_name),
    getClassnoteMatchMap(sql, R, settings, t, asOf)]);
  // 2.0 getJjAccess = 학생 기록 관리(students 'full') — 같은 권한 표로.
  const canLinkIjw = R.accessLevel(actor.system_role, 'students', matrix) === 'full';
  const initialClassName = params.class ? (roster.todayClasses.find((c) => c.id === params.class)?.name ?? null) : null;
  const initialStudentId = params.student && roster.students.some((s) => s.id === params.student) ? params.student : null;
  const rosterStudentIds = roster.students.map((s) => s.id), videoHwPolicy = roster.reportSettings.videoHomeworkPolicy;
  const videoHwDates = [roster.date, ...roster.students.flatMap((st) => st.subjects.map((su) => su.prevReport?.date ?? ''))];
  const videoHwTargets = roster.students.flatMap((st) => st.subjects.flatMap((su) => (su.classId ? [{ classId: su.classId, studentId: st.id, homeworkDate: su.prevReport?.date ?? null }] : [])));
  const [loadedMarks, loadedAssignments, submitLinkUi, othersReportKeys, videoDueUi, videoHwCancels] = await videoHomeworkReads(sql, R, t, rosterStudentIds, roster.date,
    videoHwPolicy.enabled, videoHwTargets, videoHwDates, actor.id);
  const othersReports = new Set(othersReportKeys), videoHomeworkAssignments = loadedAssignments ?? {};
  const videoHomeworkMarks = R.pickLessonMarks(loadedMarks, videoHwTargets, roster.date);
  const cancelOverridden = [];
  // page.tsx의 행 보정 루프 그대로 — 다른 선생님이 처음 쓴 줄 · 장부에서 취소한 숙제 · 세션이 없을 때의 저장값.
  for (const st of roster.students) for (const su of st.subjects) {
    if (!su.classId) continue;
    const key = R.assignmentKey(st.id, roster.date, su.classId);
    if (othersReports.has(key)) {
      su.videoHomework = R.assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId) ?? undefined;
      su.videoSubmitLink = R.assignmentOf(submitLinkUi.choices, st.id, roster.date, su.classId) ?? undefined;
      const othersDue = videoDueUi.dues[key];
      su.videoHomeworkDue = othersDue ? 'next' : undefined;
      su.videoHomeworkDueDate = othersDue;
      continue;
    }
    if (videoHwCancels.cancels.has(key) && R.assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId) === false) {
      if (su.videoHomework === true) cancelOverridden.push(key);
      su.videoHomework = false; su.videoSubmitLink = false; su.videoHomeworkDue = undefined; su.videoHomeworkDueDate = undefined;
      continue;
    }
    if (su.videoHomework == null) { const saved = R.assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId); if (saved != null) su.videoHomework = saved; }
    const savedDue = videoDueUi.dues[key];
    if (su.videoHomeworkDue == null && savedDue) su.videoHomeworkDue = 'next';
    if (savedDue) su.videoHomeworkDueDate = savedDue;
    if (su.videoSubmitLink == null) { const savedLink = R.assignmentOf(submitLinkUi.choices, st.id, roster.date, su.classId); if (savedLink != null) su.videoSubmitLink = savedLink; }
  }
  return {
    asOf, actor: { id: actor.id, name: actor.display_name ?? '' },
    oneScreen: {
      initial: roster.students, today: roster.today, date: roster.date, classTags: roster.classTags, todayClasses: roster.todayClasses,
      allowTeacherTestMax: roster.allowTeacherTestMax, showDailyTest: roster.showDailyTest, showCheckTest: roster.showCheckTest, noticeMode: roster.noticeMode,
      academyNoticeMode: roster.academyNoticeMode, classnoteSendEnabled: roster.classnoteSendEnabled, classnoteOn: roster.classnoteOn, sendWindow: roster.sendWindow,
      showAttachments: roster.showAttachments, canEditAttendance: roster.canEditAttendance,
      // 복사본 연습 화면은 그 선생님 본인으로 저장한다('다른 강사 뷰' 아님).
      readonlyView: false,
      initialFontSize: roster.fontSize, initialDisplayOptions: roster.displayOptions, initialTrendOptOut: roster.trendOptOut, noClassesToday: roster.noClassesToday,
      showingAll: roster.showingAll, holidayName: roster.holidayName, teacherName: sendName.name ?? roster.teacherName, reportClassNamePrefix: sendName.includeClassName,
      reportSettings: roster.reportSettings, academyName: roster.academyName, logoSrc: roster.logoSrc, presenceScope: `onescreen:${actor.id}:${roster.date}`,
      initialView: R.parseView(params.view), initialClassName, initialStudentId, canLinkIjw,
      classnoteMatch: R.pickCnForClasses(classnoteMatch, roster.students.flatMap((s) => s.subjects.map((su) => su.classId).filter((id) => !!id)), roster.students.map((s) => s.id)),
    },
    videoHomework: {
      initial: videoHomeworkMarks, checkDate: roster.date, policy: roster.reportSettings.videoHomeworkPolicy, assignments: videoHomeworkAssignments,
      assignmentsKnown: loadedAssignments !== null, submitLinkMode: submitLinkUi.mode, dueReady: videoDueUi.ready, othersReports: othersReportKeys,
      cancelInfo: { readAt: videoHwCancels.readAt, overridden: cancelOverridden },
    },
    page: { makeupNotice: roster.makeupNotice ?? null },
    hostSettings,
  };
}
