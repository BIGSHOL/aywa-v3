// 2.0 화면 직원관리의 하위 화면(작업자 B) — 연차 관리(/staff/annual-leave) · 급여명세서(/staff/payroll · /staff/<id>/payroll) ·
// 이력서(/staff/resumes · /new · /<id>). 진입점(v2-screen-staff.mjs, 작업자 A)이 isStaffSubPath로 갈라 staffSubLoad를 부르고,
// staffSubActions를 제 actions에 더한다. 그리기는 v2-host/src/staff-sub.tsx.
//  · 연차 관리 = 2.0 features/leave/server/admin.ts getLeaveOverview(admin + tenant_id) — 잔여 산식은 balance.ts·accrual.ts를 importV2로
//    그대로(전자결재 getMyLeaveBalance·submitLeaveDraft와 같은 원본 — verify가 두 화면의 잔여를 대조한다).
//    게이트 둘(직원관리 메뉴 + canAdjustLeave — 원장 역할 · 학원 설정 leaveAdjusterIds) + 직원관리 과목 범위.
//    저장 = features/leave/server/actions.ts의 addLeaveAdjustment · deleteLeaveAdjustment(같은 검증·문구·표·감사로그).
//  · 급여명세서 = 2.0 isPayrollEnabled가 거짓이면(침산 — PAYROLL_ENABLED=false) 두 주소 모두 /staff로 돌려보낸다. 켜진 지점이면
//    연습 화면에선 열지 않는다(급여 = restricted 값 — 새로 내보내지 않는다).
//  · 이력서 = v2-staff-sub-resume.mjs.
import { V2Error } from './v2-screens.mjs';
import { UUID, audit, readPeople, serverCall } from './v2-proc-people.mjs';
import { STAFF_SCOPE_DENIED_MSG, canSeeStaffMember, formOf } from './v2-staff-sub-common.mjs';
import { resumeLoad, resumeActions, isResumePath } from './v2-staff-sub-resume.mjs';

const MENU = 'staff', LEAVE = 'features/leave/server/actions.ts';
const UUID_BODY = UUID.source.slice(1, -1);
const SUB = new RegExp(`^/staff/(?:annual-leave|payroll|resumes(?:/new|/${UUID_BODY})?|${UUID_BODY}/payroll)$`, 'i');

/** 이 작업자의 경로인가 — /staff/annual-leave · /staff/payroll · /staff/<id>/payroll · /staff/resumes(/new · /<id>). */
export function isStaffSubPath(path) { return typeof path === 'string' && SUB.test(path.split('?')[0]); }

/** 주소 열쇠(진입점 params에 더한다) — 이력서 작성의 직원 연결(?staff=) · 이력서 바로 수정(?edit=1). */
export const staffSubParams = { staff: UUID, edit: /^1$/ };

let rulesPromise = null;
export function loadSubRules(importV2) {
  rulesPromise ??= (async () => {
    const [accrual, balance, grants, days, access, jobRank, dateKst, payroll] = await Promise.all([
      'features/leave/accrual.ts', 'features/leave/balance.ts', 'features/leave/test-grants.ts', 'features/leave/request-days.ts',
      'features/leave/access.ts', 'features/approvals/job-rank.ts', 'lib/date-kst.ts', 'features/payroll/config.ts',
    ].map(p => importV2(p)));
    return { ...accrual, ...balance, ...grants, ...days, ...access, ...jobRank, kstToday: dateKst.kstToday, isPayrollEnabled: payroll.isPayrollEnabled };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isChinsan = people => people.P.preset.isChinsanTenant({ preset: people.P.preset.presetOfStored(people.settings.stored) });
/** 2.0 getTenantSettings의 preset·modules 칸(급여 스위치 판정용). */
function tenantSwitches(people) {
  const { base, stored } = people.settings, P = people.P;
  return { preset: P.preset.presetOfStored(stored), modules: { ...(base.modules ?? {}), ...(stored?.modules ?? {}), disabled: stored?.modules?.disabled ?? base.modules?.disabled ?? [] } };
}

// ── 연차 관리 조회(2.0 getLeaveOverview) ─────────────────────────────────────────────────────────────────────────────────
async function getLeaveOverview(sql, t, R, people, visible) {
  const today = R.kstToday(), chinsan = isChinsan(people);
  const everyone = await sql`select id::text id, display_name, job_title, hire_date::text hire_date, subjects from public.users
    where tenant_id=${t} and status::text <> 'inactive' and system_role::text <> 'student' limit 500`;
  const staff = visible ? everyone.filter(s => visible({ id: s.id, subjects: Array.isArray(s.subjects) ? s.subjects : [] })) : everyone;
  const ids = staff.map(s => s.id);
  const [forms, adjRows] = await Promise.all([
    sql`select f.user_id::text user_id, f.period_start::text period_start, f.period_end::text period_end, f.days, d.status::text status
      from public.leave_forms f left join public.approval_documents d on d.id = f.document_id
      where f.tenant_id=${t} and f.user_id = any(${ids}::uuid[]) order by f.document_id`,
    sql`select id::text id, user_id::text user_id, period_start::text period_start, period_end::text period_end, days, reason,
        to_json(created_at)#>>'{}' created_at, created_by::text created_by, used_start::text used_start, used_end::text used_end
      from public.leave_adjustments where tenant_id=${t} and user_id = any(${ids}::uuid[]) order by created_at desc, id desc`,
  ]);
  const nameById = new Map(everyone.map(s => [s.id, (s.display_name ?? '').trim() || '(이름 없음)']));
  const rows = staff.map(s => {
    const hireDate = s.hire_date ?? null;
    const period = R.applyLeaveGrantOverride(s.id, R.resolveLeavePeriod(hireDate, today), chinsan);
    const legalGranted = period?.granted ?? 0;
    const mine = period ? adjRows.filter(a => a.user_id === s.id && R.leaveRowMatchesPeriod({ periodStart: a.period_start, periodEnd: a.period_end }, period)) : [];
    const adjustment = R.sumAdjustments(mine.map(a => ({ days: num(a.days) })));
    const granted = R.grantedTotal(legalGranted, adjustment);
    let used = 0, pending = 0;
    if (period) for (const f of forms) {
      if (f.user_id !== s.id || !R.leaveRowMatchesPeriod({ periodStart: f.period_start, periodEnd: f.period_end }, period)) continue;
      if (f.status === 'approved') used += num(f.days); else if (f.status === 'pending') pending += num(f.days);
    }
    used = R.roundDays(used); pending = R.roundDays(pending);
    return {
      userId: s.id, name: nameById.get(s.id), jobTitle: s.job_title ?? null, hireDate, period, legalGranted, adjustment, granted, used, pending,
      remaining: R.remainingDays({ granted, used, pending }),
      adjustments: mine.map(a => ({ id: a.id, days: num(a.days), reason: a.reason, createdAt: a.created_at,
        createdByName: (a.created_by && nameById.get(a.created_by)) || null, usedStart: a.used_start ?? null, usedEnd: a.used_end ?? null })),
    };
  });
  const order = people.settings.operations.jobTitles;
  rows.sort((a, b) => R.compareByJobRank({ name: a.name, jobTitle: a.jobTitle }, { name: b.name, jobTitle: b.jobTitle }, order));
  return { rows, tableReady: true, usedRangeReady: true };
}

/** 그 경로의 화면 자료 — 보는 사람 = params.actor(직원관리 메뉴가 열린 재직 직원 중, 없으면 첫 사람). */
export async function staffSubLoad({ sql, params, tenantId: t, importV2, path }) {
  const route = String(path ?? params?.v2path ?? '').split('?')[0];
  if (isResumePath(route)) return resumeLoad({ sql, params, tenantId: t, importV2, path: route });
  const [R, people] = await Promise.all([loadSubRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const editors = people.editorList, u = people.pick(params?.actor);
  if (!u) return { notAllowed: true, editors };
  if (route !== '/staff/annual-leave') {
    // 급여명세서 두 주소 — 2.0: requireAccess("staff") 뒤 isPayrollEnabled가 거짓이면 redirect("/staff").
    if (!R.isPayrollEnabled(tenantSwitches(people))) return { editors, redirect: '/staff' };
    return { editors, unsupported: true };
  }
  // 2.0 AnnualLeavePage — 연차 조정 자격이 없으면 직원관리로.
  if (!R.canAdjustLeave({ id: u.id, systemRole: u.role }, people.operators.has(u.id), { adjusterIds: people.settings.permissions?.specialAccess?.leaveAdjusterIds ?? [] })) {
    return { editors, redirect: '/staff' };
  }
  const scope = people.staffScope(u);
  const overview = await getLeaveOverview(sql, t, R, people, scope ? s => s.id === u.id || people.P.scope.isStaffInSubjectScope(scope, s.subjects) : undefined);
  return { editors, operations: people.settings.operations, overview };
}

// ── 저장(2.0 features/leave/server/actions.ts) ──────────────────────────────────────────────────────────────────────────
const MAX_REASON = 200, YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const isQuarterStep = v => Math.round(v * 100) % 25 === 0;

/** requireAdjuster — 직원관리 메뉴 + canAdjustLeave. */
async function adjusterCtx({ sql, body, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadSubRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const known = typeof body.actor === 'string' && people.users.some(x => x.id === body.actor && x.role !== 'student');
  if (!known) return { error: '로그인이 필요합니다' };
  const u = people.editors.find(e => e.id === body.actor);
  if (!u || !R.canAdjustLeave({ id: u.id, systemRole: u.role }, people.operators.has(u.id), { adjusterIds: people.settings.permissions?.specialAccess?.leaveAdjusterIds ?? [] })) {
    return { error: R.LEAVE_ADJUST_DENIED_MSG };
  }
  return { R, people, sql, t, user: u, fd: formOf(body.args[1]) };
}

async function adjustmentDaysFor(sql, t, R, userId, period) {
  const rows = await sql`select period_start::text period_start, period_end::text period_end, days from public.leave_adjustments
    where tenant_id=${t} and user_id=${userId} and period_start <= ${period.end}::date and period_end >= ${period.start}::date limit 500`;
  return R.sumAdjustments(rows.filter(r => R.leaveRowMatchesPeriod({ periodStart: r.period_start, periodEnd: r.period_end }, period)).map(r => ({ days: num(r.days) })));
}
async function reservedLeaveDays(sql, t, R, userId, period) {
  const rows = await sql`select f.period_start::text period_start, f.period_end::text period_end, f.days, d.status::text status
    from public.leave_forms f left join public.approval_documents d on d.id = f.document_id
    where f.tenant_id=${t} and f.user_id=${userId} and f.period_start <= ${period.end}::date and f.period_end >= ${period.start}::date limit 500`;
  const total = rows.reduce((acc, r) => (!R.leaveRowMatchesPeriod({ periodStart: r.period_start, periodEnd: r.period_end }, period) ? acc
    : r.status === 'approved' || r.status === 'pending' ? acc + num(r.days) : acc), 0);
  return R.roundDays(total);
}
async function loadTarget(c, userId) {
  const { sql, t, R, people } = c;
  const [data] = await sql`select id::text id, display_name, hire_date::text hire_date, status::text status, system_role::text system_role from public.users where id=${userId} and tenant_id=${t}`;
  if (!data) return { error: '대상 직원을 찾을 수 없습니다' };
  if (data.status === 'inactive') return { error: '퇴사한 직원의 연차는 조정할 수 없습니다' };
  if (data.system_role === 'student') return { error: '학생 계정은 연차 대상이 아닙니다' };
  const period = R.applyLeaveGrantOverride(userId, R.resolveLeavePeriod(data.hire_date ?? null, R.kstToday()), isChinsan(people));
  if (!period) return { error: '입사일이 등록되지 않아 연차 구간을 계산할 수 없습니다 — 직원관리에서 입사일을 먼저 등록하세요' };
  const [adjustment, reserved] = await Promise.all([adjustmentDaysFor(sql, t, R, userId, period), reservedLeaveDays(sql, t, R, userId, period)]);
  return { target: { id: userId, name: (data.display_name ?? '').trim() || '(이름 없음)', period, adjustment, reserved, currentTotal: R.grantedTotal(period.granted, adjustment) } };
}

const LEAVE_ACTION = fn => ({ validate: raw => serverCall(raw, [LEAVE], 2), run: async ctx => { const c = await adjusterCtx(ctx); return c.error ? { error: c.error } : fn(c); } });

export const staffSubActions = {
  addLeaveAdjustment: LEAVE_ACTION(async c => {
    const { R, fd, user, sql, t, people } = c;
    const userId = String(fd.get('userId') ?? '').trim();
    if (!UUID.test(userId)) return { error: '대상 직원을 선택하세요' };
    if (!(await canSeeStaffMember(sql, t, people, user, userId))) return { error: STAFF_SCOPE_DENIED_MSG };
    const reason = String(fd.get('reason') ?? '').trim();
    if (reason.length > MAX_REASON) return { error: `사유는 ${MAX_REASON}자를 넘을 수 없습니다` };
    const usedStart = String(fd.get('usedStart') ?? '').trim(), usedEnd = String(fd.get('usedEnd') ?? '').trim();
    if (usedStart && !YMD_RE.test(usedStart)) return { error: '사용 시작일은 날짜로 골라 주세요(예: 2026-09-18)' };
    if (usedEnd && !YMD_RE.test(usedEnd)) return { error: '사용 종료일은 날짜로 골라 주세요(예: 2026-09-18)' };
    if (usedEnd && !usedStart) return { error: '사용 시작일을 먼저 고르세요' };
    if (usedStart && usedEnd && usedEnd < usedStart) return { error: '사용 종료일이 시작일보다 앞섭니다' };
    const mode = String(fd.get('mode') ?? 'delta') === 'total' ? 'total' : 'delta';
    const daysRaw = String(fd.get('days') ?? '').trim();
    if (!daysRaw) return { error: '일수를 입력하세요' };
    const raw = Number(daysRaw);
    if (!Number.isFinite(raw)) return { error: '일수를 숫자로 입력하세요' };
    if (!isQuarterStep(raw)) return { error: '연차는 0.25일(반반차) 단위로만 조정할 수 있습니다' };
    const loaded = await loadTarget(c, userId);
    if ('error' in loaded) return { error: loaded.error };
    const { target } = loaded;
    if ([usedStart, usedEnd].filter(Boolean).some(d => d < target.period.start || d > target.period.end)) {
      return { error: `사용 기간이 이 연차 구간(${target.period.start} ~ ${target.period.end}) 밖입니다 — 그 날이 속한 구간에서 조정하세요` };
    }
    let delta;
    if (mode === 'total') {
      const total = R.roundDays(raw);
      if (total < 0) return { error: '총 부여 일수는 0일보다 작을 수 없습니다' };
      if (total > R.MAX_LEAVE_TOTAL) return { error: `총 부여 일수는 ${R.MAX_LEAVE_TOTAL}일을 넘을 수 없습니다` };
      delta = R.deltaForTotal(total, target.currentTotal);
      if (delta === 0) return { error: `이미 총 ${R.formatLeaveDays(target.currentTotal)}입니다 — 바뀌는 값이 없습니다` };
    } else {
      delta = R.roundDays(raw);
      if (delta === 0) return { error: '0일은 조정이 아닙니다 — 늘릴 일수(+)나 줄일 일수(−)를 입력하세요' };
    }
    if (Math.abs(delta) > R.MAX_LEAVE_DELTA) return { error: `한 번에 조정할 수 있는 일수는 ${R.MAX_LEAVE_DELTA}일까지입니다` };
    const newTotal = R.grantedTotal(target.period.granted, R.roundDays(target.adjustment + delta));
    if (newTotal < target.reserved) {
      return { error: `이미 사용·결재중인 ${R.formatLeaveDays(target.reserved)}보다 적게 조정할 수 없습니다 (요청 결과 ${R.formatLeaveDays(newTotal)})` };
    }
    if (newTotal > R.MAX_LEAVE_TOTAL) return { error: `총 부여 일수는 ${R.MAX_LEAVE_TOTAL}일을 넘을 수 없습니다 (요청 결과 ${R.formatLeaveDays(newTotal)})` };
    try {
      await sql.savepoint(s => s`insert into public.leave_adjustments (tenant_id, user_id, period_start, period_end, days, reason, created_by, used_start, used_end)
        values (${t}, ${userId}, ${target.period.start}::date, ${target.period.end}::date, ${delta}, ${reason}, ${user.id}, ${usedStart || null}::date, ${usedEnd || null}::date)`);
    } catch (e) {
      if (e instanceof V2Error) throw e;
      return { error: `저장 실패 — ${e?.message ?? ''}` };
    }
    await audit(sql, t, user, 'leave_adjust', 'user', target.name, {
      days: delta, before: target.currentTotal, after: newTotal, period: `${target.period.start} ~ ${target.period.end}`, reason,
      usedStart: usedStart || null, usedEnd: usedEnd || null,
    });
    return { ok: true, notice: `${target.name} 연차 ${R.formatSignedDays(delta)} — 총 ${R.formatLeaveDays(newTotal)}` };
  }),
  deleteLeaveAdjustment: LEAVE_ACTION(async c => {
    const { R, fd, user, sql, t, people } = c;
    const id = String(fd.get('adjustmentId') ?? '').trim();
    if (!UUID.test(id)) return { error: '삭제할 조정을 찾을 수 없습니다' };
    const [row] = await sql`select id::text id, user_id::text user_id, days, reason, period_start::text period_start, period_end::text period_end
      from public.leave_adjustments where id=${id} and tenant_id=${t}`;
    if (!row) return { error: '이미 삭제된 조정입니다' };
    const targetId = row.user_id;
    if (!(await canSeeStaffMember(sql, t, people, user, targetId))) return { error: STAFF_SCOPE_DENIED_MSG };
    const [person] = await sql`select display_name, hire_date::text hire_date from public.users where id=${targetId} and tenant_id=${t}`;
    const name = (person?.display_name ?? '').trim() || '(이름 없음)';
    const period = R.applyLeaveGrantOverride(targetId, R.resolveLeavePeriod(person?.hire_date ?? null, R.kstToday()), isChinsan(people));
    const removed = Number(row.days) || 0;
    const samePeriod = period !== null && R.leaveRowMatchesPeriod({ periodStart: row.period_start, periodEnd: row.period_end }, period);
    let after = null;
    if (samePeriod) {
      const [adjustment, reserved] = await Promise.all([adjustmentDaysFor(sql, t, R, targetId, period), reservedLeaveDays(sql, t, R, targetId, period)]);
      after = R.grantedTotal(period.granted, R.roundDays(adjustment - removed));
      if (after < reserved) return { error: `이 조정을 지우면 총 ${R.formatLeaveDays(after)}이 되어 이미 사용·결재중인 ${R.formatLeaveDays(reserved)}보다 적어집니다` };
    }
    await sql`delete from public.leave_adjustments where id=${id} and tenant_id=${t}`;
    await audit(sql, t, user, 'leave_adjust_delete', 'user', name, {
      days: removed, ...(after === null ? {} : { after }), period: `${row.period_start} ~ ${row.period_end}`, reason: String(row.reason ?? ''),
    });
    return { ok: true, notice: `${name} 연차 조정 ${R.formatSignedDays(removed)}을 취소했습니다` };
  }),
  ...resumeActions,
};
