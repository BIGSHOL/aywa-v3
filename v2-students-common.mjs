// 2.0 화면 · 원생목록 · 원생 상세 공통 — 보는 사람 · 학원 설정 · 권한 칸 · 복사본 날짜(V2-SCREENS.md 대상 `students`).
// · 3.0엔 로그인이 없다 — 화면 주인 = 원장 한 명(운영실과 같은 고르기: 재직 원장 중 최근 30일 감사로그가 가장 많은 사람 · 플랫폼 운영 계정 제외).
//   권한 칸은 그 사람의 2.0 권한표(getUserPermMatrix와 같은 차례 — userPermMatrix)에서 2.0 판정 함수로 계산한다.
// · 학원 설정 = 2.0 getTenantSettings(resolveSettings) · 오늘 = 복사본 날짜(복사본을 뜬 날 — 2.0 kstToday 자리).
// · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
// · 읽기 전용 · 바깥 호출 없음.
import { queryGate, copyClock, rules as rosterRules, userPermMatrix } from './v2-onescreen-roster.mjs';
import { tenantSettings } from './v2-student-kpis.mjs';
import { pickViewer } from './v2-dashboard-overview.mjs';

export const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const UUID = new RegExp(`^${UUID_BODY}$`);

/** 상세·목록이 함께 쓰는 2.0 순수 함수(roster 규칙 묶음에 없는 것만). */
const EXTRA = { statusAccess: 'features/students/status-access.ts', dateAccess: 'features/enrollments/date-access.ts', merged: 'features/students/status/merged.ts',
  special: 'features/classes/special-lecture.ts', siblings: 'features/students/siblings.ts', samePerson: 'features/enrollment/same-person.ts' };
let extraP = null;
export function studentsRules(importV2) {
  extraP ??= Promise.all(Object.entries(EXTRA).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries).catch((e) => { extraP = null; throw e; });
  return extraP;
}

const based = new WeakMap();
/**
 * 한 트랜잭션의 공통 재료 — 관문(queryGate) 하나 · 학원 설정 · 보는 사람 · 권한표. 같은 트랜잭션이면 한 번만 만든다.
 * `sql` = 읽기 전용 트랜잭션(sql.begin) · `viewerId` = 고른 원장(없거나 원장이 아니면 기본 원장).
 */
export function studentsBase({ sql: tx, tenantId: t, importV2, viewerId = null }) {
  const m = based.get(tx) ?? new Map();
  if (!based.has(tx)) based.set(tx, m);
  const key = `${t}|${viewerId ?? ''}`;
  if (!m.has(key)) m.set(key, (async () => {
    const sql = queryGate(tx), load = importV2 ?? (await import('./v2-bridge.mjs')).importV2;
    const [RR, X, clock] = await Promise.all([rosterRules(load), studentsRules(load), copyClock()]);
    const settings = await tenantSettings(sql, t, load);
    const user = await pickViewer(sql, t, viewerId, clock.at);
    const matrix = user ? await userPermMatrix(sql, RR, settings, { id: user.id, system_role: user.role }, t, clock.at) : null;
    const level = (menu) => (user && matrix ? RR.accessLevel(user.role, menu, matrix) : 'none');
    const viewer = user ? { id: user.id, name: user.name, systemRole: user.role, isSuperAdmin: !!user.super, tenantId: t } : null;
    return { sql, tx, t, load, RR, X, clock, today: clock.day, settings, viewer, matrix, level, lang: 'ko' };
  })().catch((e) => { m.delete(key); throw e; }));
  return m.get(key);
}

// ── getStudentSiblings(features/students/server/siblings.ts) — 개요 탭 '형제' · 학생 수정의 형제 칸이 함께 쓴다 ─────────────
const SIBLING_CAP = 100;
const plainLike = (s) => s.replace(/["\\%_*,()]/g, '');
const siblingRow = (r) => ({ id: r.id, name: r.name, school: r.school, grade: r.grade, status: r.status, notes: r.notes, is_test: r.is_test, parent_name: r.parent_name, parent_phone: r.parent_phone });
const SIBLING_COLS = (sql) => sql`id::text id, name, school, grade, status::text status, notes, is_test, parent_name, parent_phone`;
/**
 * 2.0 getStudentSiblings — 자동 판정(학부모 휴대폰 뒤 8자리 · 학부모 이름 글자 차례로 후보 100명 → siblingBasis) + 직접 지정(student_siblings 0376a).
 * 짝 표가 없으면 ready:false(형제 칸을 안 띄운다) · 실패하면 빈 값(2.0과 같다 — 로그만). 원장은 모든 학생 상세를 연다(canViewStudentDetail).
 */
export async function readStudentSiblings(base, student) {
  const none = { ready: false, siblings: [], review: [], autoIds: [] };
  const { sql, t, X } = base, S = X.siblings, P = X.samePerson;
  try {
    const me = { id: student.id, name: student.name, parent_name: student.parentName, parent_phone: student.parentPhone };
    const phone = P.phoneKeyOf(me.parent_phone), parent = plainLike(P.personName(me.parent_name));
    const likes = [phone ? `%${phone.slice(-8, -4)}%${phone.slice(-4)}%` : null, parent.length >= 2 ? [...parent].join('%') : null];
    const cands = likes.some(Boolean) ? await sql`select ${SIBLING_COLS(sql.frag)} from public.students where tenant_id=${t} and id <> ${me.id}
        and ((${likes[0]}::text is not null and parent_phone ilike ${likes[0]}) or (${likes[1]}::text is not null and parent_name ilike ${likes[1]}))
        order by name, id limit ${SIBLING_CAP}` : [];
    const auto = cands.map(siblingRow).filter((r) => !r.is_test && !X.merged.isMergedStudent(r.notes))
      .flatMap((row) => { const basis = S.siblingBasis(me, row); return basis ? [{ row, basis }] : []; });
    const linkRows = await sql.soft((sp) => sp`select student_a::text a, student_b::text b, linked from public.student_siblings
      where tenant_id=${t} and (student_a=${me.id} or student_b=${me.id})`, null);
    const ready = linkRows !== null, links = new Map((linkRows ?? []).map((r) => [r.a === me.id ? r.b : r.a, r.linked]));
    const matched = auto.filter((a) => a.basis !== 'conflict');
    const ids = S.resolveSiblingIds(matched.map((a) => a.row.id), links);
    const known = new Map(auto.map((a) => [a.row.id, a]));
    const need = ids.filter((id) => !known.has(id));
    const extra = need.length ? (await sql`select ${SIBLING_COLS(sql.frag)} from public.students where tenant_id=${t} and id = any(${need}::uuid[])`).map(siblingRow) : [];
    const view = (row, basis) => ({ id: row.id, name: row.name ?? '', school: row.school, grade: row.grade, status: row.status, basis });
    const siblings = ids.flatMap((id) => {
      const hit = known.get(id);
      if (hit) return [view(hit.row, links.get(id) ? 'manual' : hit.basis)];
      const row = extra.find((r) => r.id === id);
      return row && !row.is_test && !X.merged.isMergedStudent(row.notes) ? [view(row, 'manual')] : [];
    });
    const chosen = new Set(siblings.map((s) => s.id));
    const review = auto.filter((a) => a.basis === 'conflict' && !chosen.has(a.row.id) && links.get(a.row.id) !== false).map((a) => view(a.row, 'conflict'));
    return { ready, siblings, review, autoIds: matched.map((a) => a.row.id) };
  } catch (e) {
    console.error('[원생] 형제 조회 실패', e?.message ?? e);
    return none;
  }
}

/**
 * 원생 상세 머리·탭이 읽는 2.0 권한 판정(page.tsx의 await 자리 그대로 — 원장 한 사람 · 강사 뷰·지점 보기 없음).
 * canManageStatus = canManageStudentStatusNow · dateAccess = getEnrollmentDateAccess · canSeeEnrollment = canSeeStudentEnrollment(원장은 콜&상담 권한으로).
 */
export function detailGates(base, student) {
  const { level, viewer, X, settings } = base;
  if (!viewer) return null;
  const studentsLevel = level('students');
  const privileged = viewer.isSuperAdmin;
  const canManageStatus = studentsLevel === 'full'
    && X.statusAccess.canManageStudentStatus(viewer, privileged, base.RR.studentStatusManagerIds(settings.permissions.specialAccess));
  const dateMenus = ['students', 'classes', 'withdrawals'].map(level);
  const dateAllowed = dateMenus.some((l) => l !== 'none') && X.dateAccess.canEditEnrollmentDates(viewer, privileged, settings.permissions.specialAccess.enrollmentDateEditorIds);
  const enrollmentAccess = level('enrollment') !== 'none';
  return {
    studentsLevel,
    canSeeBilling: level('billing') !== 'none',
    canManageStatus,
    canDeleteStudent: ['full', 'scoped'].includes(level('admin')),
    dateAccess: dateAllowed ? { allowed: true, classIds: dateMenus.some((l) => l === 'full' || l === 'readonly') ? null : [] } : { allowed: false, classIds: [] },
    canEditSchedule: level('classes') === 'full',
    canDeleteEnrollment: level('owner') === 'full' || privileged,
    enrollmentAccess,
    // 2.0 canSeeStudentEnrollment — 콜&상담 권한이 있으면 보인다(담당 학생 예외는 강사 갈래라 원장 화면엔 없다).
    canSeeEnrollment: enrollmentAccess,
    canManageScheduled: level('classes') === 'full',
    canSeeWithdrawals: student?.status === 'withdrawn' && level('withdrawals') !== 'none',
  };
}
