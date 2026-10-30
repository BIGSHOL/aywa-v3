// 2.0 화면 — 전자결재(결재함 · 결재 문서 · 기안하기) (V2-SCREENS.md `approvals`, 처리 화면 세션 R).
// 원장 10-28 *"근거보기 들어가도 뭘 처리할 수가 없음"* — 첫 화면 '결재 대기 문서'가 여기서 승인·반려·전결·대결까지 끝나야 한다.
// 그리기는 2.0의 실제 React 부품(v2-host/src/approvals.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 같은 결과로:
//  · 조회 = features/approvals/server/queries.ts(getApprovalBoxes · getApprovalDoc · getApprovalComments · getApproverCandidates ·
//    getMyLineTemplates · getMyLeaveBalance). 2.0은 **세션 클라이언트 + RLS**로 읽는다 — 여기서도 읽기 트랜잭션 안에서 고른 사람의 신분
//    (request.jwt.claims + authenticated 역할)으로 바꿔 같은 RLS를 지난다(누가 어떤 문서를 보는지가 2.0과 똑같다).
//    판정(isMyTurn · needsMyDeferredConfirm · 연차 기간·잔여 · 직급 정렬)은 2.0 순수 함수(importV2) 그대로.
//  · 보는 사람 = 3.0 셸 계정(GET ?actor=). 결재자 후보는 2.0처럼 재직 직원 전원이며,
//    결재함·기안은 2.0처럼 전자결재 메뉴가 열린 사람만, 결재 문서는 메뉴 없이 결재선·참조·원장이면 열린다.
//  · 저장 = 2.0 server/actions.ts의 11개 함수(같은 이름 · 같은 인자(_prev, FormData) · 같은 검증 · 같은 표·칸 · 같은 알림 줄 · 같은 감사로그).
//    2.0은 service_role(RLS 우회)로 쓴다 — 여기서도 신분 전환 없이 쓴다. 슬랙 깨우기(notifyUsers 안의 pokeSlack)는 바깥 전송이라 하지 않는다.
import { V2Error } from './v2-screens.mjs';
import { UUID, audit, readPeople, serverCall } from './v2-proc-people.mjs';

const ID = 'approvals', MENU = 'approvals', MODULE = 'features/approvals/server/actions.ts';
const MAX_TEXT = 500, MAX_REASON_HTML = 20_000, MAX_TITLE = 80, MAX_MONEY_AMOUNT = 1_000_000_000, DOC_NO_RETRY = 3;

let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [types, line, docNo, jobRank, accrual, balance, grants, days, sanitize, dateKst] = await Promise.all([
      'features/approvals/types.ts', 'features/approvals/line.ts', 'features/approvals/doc-no.ts', 'features/approvals/job-rank.ts',
      'features/leave/accrual.ts', 'features/leave/balance.ts', 'features/leave/test-grants.ts', 'features/leave/request-days.ts',
      'lib/html/sanitize.ts', 'lib/date-kst.ts',
    ].map(p => importV2(p)));
    return { ...types, ...line, ...docNo, ...jobRank, ...accrual, ...balance, ...grants, ...days, sanitizeRichHtml: sanitize.sanitizeRichHtml, kstToday: dateKst.kstToday };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isChinsan = people => !people.P.preset.isGenericTenant({ preset: people.P.preset.presetOfStored(people.settings.stored) });

/** 고를 수 있는 사람 = 재직 직원 전원(학생 제외 · 운영자 계정 제외) — 결재자 후보가 전 직원이라서(2.0). 원장 먼저. */
function staffOf(people) {
  const RANK = ['master', 'admin', 'manager', 'teacher'];
  return people.users.filter(u => !people.operators.has(u.id) && u.role !== 'student')
    .map(u => ({ ...u, rank: RANK.includes(u.role) ? RANK.indexOf(u.role) : RANK.length }))
    .sort((a, b) => a.rank - b.rank || a.display_name.localeCompare(b.display_name, 'ko'));
}
const editorList = (people, staff) => staff.map(u => ({ id: u.id, name: u.display_name, role: people.P.ROLE_LABEL[u.role] ?? '' }));
/** 2.0 신분 — 이 트랜잭션 안에서만 고른 사람으로 RLS를 지난다. */
async function actAsReader(sql, u) {
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: u.id, role: 'authenticated' })}, true)`;
  await sql`set local role authenticated`;
}

// ── queries.ts loadDocs(문서 + 결재선 + 참조 + 양식 상세) — PostgREST와 같은 JSON(to_json) ─────────────────────────────
async function loadDocs(sql, R, ids) {
  if (!ids.length) return [];
  const [docs, steps, refs, leaves, basics, expenses, incomes] = await Promise.all([
    sql`select d.id::text id, d.doc_no, d.form_type::text form_type, d.title, d.drafter_id::text drafter_id, d.status::text status, d.current_step,
        to_json(d.submitted_at)#>>'{}' submitted_at, to_json(d.completed_at)#>>'{}' completed_at, d.outcome_note, u.display_name drafter_name, u.job_title drafter_job
      from public.approval_documents d left join public.users u on u.id = d.drafter_id where d.id = any(${ids}::uuid[])`,
    sql`select s.document_id::text document_id, s.step_no, s.approver_id::text approver_id, s.role_label, s.decision::text decision, to_json(s.decided_at)#>>'{}' decided_at,
        s.comment, s.acted_by::text acted_by, a.display_name approver_name, a.job_title approver_job, x.display_name actor_name
      from public.approval_steps s left join public.users a on a.id = s.approver_id left join public.users x on x.id = s.acted_by
      where s.document_id = any(${ids}::uuid[]) order by s.step_no`,
    sql`select r.document_id::text document_id, r.user_id::text user_id, v.display_name from public.approval_refs r left join public.users v on v.id = r.user_id where r.document_id = any(${ids}::uuid[])`,
    sql`select document_id::text document_id, user_id::text user_id, leave_kind::text leave_kind, start_date::text start_date, end_date::text end_date, days, reason,
        period_start::text period_start, period_end::text period_end, granted_days from public.leave_forms where document_id = any(${ids}::uuid[])`,
    sql`select document_id::text document_id, body_html from public.approval_basic_forms where document_id = any(${ids}::uuid[])`,
    sql`select document_id::text document_id, amount, spend_date::text spend_date, category, body_html from public.approval_expense_forms where document_id = any(${ids}::uuid[])`,
    sql`select document_id::text document_id, amount, income_date::text income_date, category, body_html from public.approval_income_forms where document_id = any(${ids}::uuid[])`,
  ]);
  const group = (rows, f) => { const m = new Map(); for (const r of rows) (m.get(r.document_id) ?? m.set(r.document_id, []).get(r.document_id)).push(f(r)); return m; };
  const stepsBy = group(steps, s => ({ stepNo: num(s.step_no), approverId: s.approver_id, approverName: s.approver_name ?? '(이름 없음)', approverJobTitle: s.approver_job ?? null,
    roleLabel: s.role_label ?? '승인', decision: s.decision, decidedAt: s.decided_at ?? null, comment: s.comment ?? null, actedByName: s.acted_by ? (s.actor_name ?? '(이름 없음)') : null }));
  const refsBy = group(refs, r => ({ userId: r.user_id, name: r.display_name ?? '(이름 없음)' }));
  const one = (rows, f) => new Map(rows.map(r => [r.document_id, f(r)]));
  const leaveBy = one(leaves, l => ({ userId: l.user_id, kind: R.isLeaveKind(l.leave_kind) ? l.leave_kind : 'annual', startDate: l.start_date, endDate: l.end_date, days: num(l.days),
    reason: l.reason ?? null, periodStart: l.period_start, periodEnd: l.period_end, grantedDays: num(l.granted_days) }));
  const basicBy = one(basics, b => ({ bodyHtml: b.body_html ?? '' }));
  const expenseBy = one(expenses, e => ({ amount: num(e.amount), spendDate: e.spend_date, category: e.category ?? '기타', bodyHtml: e.body_html ?? '' }));
  const incomeBy = one(incomes, i => ({ amount: num(i.amount), incomeDate: i.income_date, category: i.category ?? '기타', bodyHtml: i.body_html ?? '' }));
  return docs.map(d => ({
    id: d.id, docNo: d.doc_no, form: d.form_type, title: d.title, drafterId: d.drafter_id, drafterName: d.drafter_name ?? '(이름 없음)', drafterJobTitle: d.drafter_job ?? null,
    status: d.status, currentStep: num(d.current_step), submittedAt: d.submitted_at, completedAt: d.completed_at ?? null, outcomeNote: d.outcome_note ?? null,
    steps: (stepsBy.get(d.id) ?? []).sort((a, b) => a.stepNo - b.stepNo), refs: refsBy.get(d.id) ?? [],
    leave: leaveBy.get(d.id) ?? null, basic: basicBy.get(d.id) ?? null, expense: expenseBy.get(d.id) ?? null, income: incomeBy.get(d.id) ?? null,
  }));
}
const isMyTurn = (doc, userId) => { if (doc.status !== 'pending') return false; const s = doc.steps.find(x => x.stepNo === doc.currentStep); return !!s && s.approverId === userId && s.decision === 'pending'; };
const needsMyDeferredConfirm = (doc, userId) => doc.steps.some(s => s.approverId === userId && s.decision === 'deferred');

/** getApprovalBoxes — 함마다 같은 판정(2.0 그대로). */
async function getApprovalBoxes(sql, R, userId, academyWide) {
  const [mine, asApprover, asRef, academy] = await Promise.all([
    sql`select id::text id from public.approval_documents where drafter_id=${userId} order by submitted_at desc limit 200`,
    sql`select document_id::text id from public.approval_steps where approver_id=${userId} order by created_at desc limit 300`,
    sql`select document_id::text id from public.approval_refs where user_id=${userId} order by created_at desc limit 300`,
    academyWide ? sql`select id::text id from public.approval_documents where status='pending' order by submitted_at asc limit 300` : [],
  ]);
  const emptyAcademy = academyWide ? [] : null;
  const EMPTY = { ready: true, loadError: null, waiting: [], upcoming: [], inProgress: [], completed: [], rejected: [], refDocs: [], all: [], academyPending: emptyAcademy };
  const refIds = new Set(asRef.map(r => r.id)), relatedIds = new Set([...mine.map(r => r.id), ...asApprover.map(r => r.id), ...refIds]);
  const academyIds = new Set(academy.map(r => r.id)), ids = [...new Set([...relatedIds, ...academyIds])];
  if (!ids.length) return EMPTY;
  let docs = await loadDocs(sql, R, ids);
  const academyDocs = docs.filter(d => academyIds.has(d.id) && d.status === 'pending');
  docs = docs.filter(d => relatedIds.has(d.id));
  const byNewest = (a, b) => b.submittedAt.localeCompare(a.submittedAt), byOldest = (a, b) => a.submittedAt.localeCompare(b.submittedAt);
  const myStep = d => d.steps.find(s => s.approverId === userId), involved = d => d.drafterId === userId || !!myStep(d);
  return {
    ready: true, loadError: null,
    waiting: docs.filter(d => isMyTurn(d, userId) || needsMyDeferredConfirm(d, userId)).sort(byOldest),
    upcoming: docs.filter(d => { if (d.status !== 'pending') return false; const s = myStep(d); return !!s && s.stepNo > d.currentStep; }).sort(byOldest),
    inProgress: docs.filter(d => { if (d.status !== 'pending') return false; if (d.drafterId === userId) return true; const s = myStep(d); return !!s && s.decision !== 'pending'; }).sort(byNewest),
    completed: docs.filter(d => d.status === 'approved' && involved(d)).sort(byNewest),
    rejected: docs.filter(d => (d.status === 'rejected' || d.status === 'canceled') && involved(d)).sort(byNewest),
    refDocs: docs.filter(d => refIds.has(d.id)).sort(byNewest),
    all: [...docs].sort(byNewest),
    academyPending: academyWide ? academyDocs.sort(byOldest) : null,
  };
}

/** getMyLeaveBalance — 부여는 입사일에서 계산(+ 조정), 사용·결재중은 결재 문서에서. */
async function getMyLeaveBalance(sql, R, people, userId) {
  const today = R.kstToday();
  const [me] = await sql`select hire_date::text hire_date from public.users where id=${userId}`;
  const hireDate = me?.hire_date ?? null;
  const period = R.applyLeaveGrantOverride(userId, R.resolveLeavePeriod(hireDate, today), isChinsan(people));
  if (!period) return { hireDate, period, adjustment: 0, granted: 0, used: 0, pending: 0, remaining: 0, usageUnknown: false };
  const [forms, adj] = await Promise.all([
    sql`select f.period_start::text period_start, f.period_end::text period_end, f.days, d.status::text status from public.leave_forms f
      left join public.approval_documents d on d.id = f.document_id where f.user_id=${userId} and f.period_start <= ${period.end}::date and f.period_end >= ${period.start}::date limit 500`,
    sql`select period_start::text period_start, period_end::text period_end, days from public.leave_adjustments
      where user_id=${userId} and period_start <= ${period.end}::date and period_end >= ${period.start}::date limit 500`,
  ]);
  const inPeriod = r => R.leaveRowMatchesPeriod({ periodStart: r.period_start, periodEnd: r.period_end }, period);
  const adjustment = R.sumAdjustments(adj.filter(inPeriod).map(r => ({ days: num(r.days) })));
  const granted = R.grantedTotal(period.granted, adjustment);
  let used = 0, pending = 0;
  for (const row of forms.filter(inPeriod)) { if (row.status === 'approved') used += num(row.days); else if (row.status === 'pending') pending += num(row.days); }
  used = R.roundDays(used); pending = R.roundDays(pending);
  return { hireDate, period, adjustment, granted, used, pending, remaining: R.remainingDays({ granted, used, pending }), usageUnknown: false };
}

async function getApprovalComments(sql, documentId) {
  const rows = await sql`select c.id::text id, c.author_id::text author_id, c.body, to_json(c.created_at)#>>'{}' created_at, u.display_name, u.job_title
    from public.approval_comments c left join public.users u on u.id = c.author_id where c.document_id=${documentId} order by c.created_at desc limit 200`;
  return { ready: true, loadError: null, comments: [...rows].reverse().map(c => ({ id: c.id, authorId: c.author_id, authorName: c.display_name ?? '(이름 없음)', authorJobTitle: c.job_title ?? null, body: c.body, createdAt: c.created_at })) };
}
async function getApproverCandidates(sql, R, jobTitles) {
  const rows = await sql`select id::text id, display_name, job_title from public.users where status::text <> 'inactive' and system_role::text <> 'student' limit 500`;
  return rows.map(u => ({ id: u.id, name: u.display_name ?? '(이름 없음)', jobTitle: u.job_title ?? null })).sort((a, b) => R.compareByJobRank(a, b, jobTitles));
}
async function getMyLineTemplates(sql) {
  const rows = await sql`select id::text id, name, approver_ids, ref_ids from public.approval_line_templates order by name limit 50`;
  const ids = v => (Array.isArray(v) ? v.map(String) : []);
  return rows.map(t => ({ id: t.id, name: t.name, approverIds: ids(t.approver_ids), refIds: ids(t.ref_ids) }));
}

// ── 화면 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const UUID_BODY = UUID.source.slice(1, -1);
const DOC = new RegExp(`^/approvals/(${UUID_BODY})$`, 'i');
async function build({ sql, params, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const staff = staffOf(people), editors = editorList(people, staff);
  const u = staff.find(s => s.id === params.actor) ?? null;
  if (!u) return { notAllowed: true, editors };
  const hasMenu = people.level(u, MENU) !== 'none';
  const [me] = await sql`select job_title from public.users where id=${u.id}`;
  const user = { id: u.id, systemRole: u.role, displayName: u.display_name, jobTitle: me?.job_title ?? null };
  const base = { editors, user, hasMenu, operations: people.settings.operations, today: R.kstToday() };
  const path = params.v2path ?? '/approvals';
  const doc = DOC.exec(path), jobTitles = people.settings.operations.jobTitles ?? [];
  await actAsReader(sql, u); // 여기부터 2.0 세션 클라이언트와 같은 RLS
  if (doc) {
    // 결재 문서 — 메뉴 게이트 없음(결재선·참조·원장이면 RLS가 연다). 강사 역할은 2.0 강사 화면 가드가 전자결재 권한을 본다.
    if (u.role === 'teacher' && !hasMenu) return { ...base, notFound: true };
    const [docs, commentsBox] = await Promise.all([loadDocs(sql, R, [doc[1]]), getApprovalComments(sql, doc[1])]);
    if (!docs[0]) return { ...base, notFound: true };
    // 2.0 page.tsx는 렌더 직전 서버에서 본문을 다시 위생처리한다 — 같은 함수(sanitizeRichHtml)를 여기서(서버) 거쳐 내려보낸다.
    const d = docs[0], clean = h => (h ? R.sanitizeRichHtml(h) : '');
    const html = { reason: clean(d.leave?.reason), basic: clean(d.basic?.bodyHtml), expense: clean(d.expense?.bodyHtml), income: clean(d.income?.bodyHtml) };
    return { ...base, doc: d, commentsBox, html };
  }
  if (!hasMenu) return { ...base, noMenu: true };
  if (path === '/approvals/new') {
    const [balance, candidates, templates] = await Promise.all([getMyLeaveBalance(sql, R, people, u.id), getApproverCandidates(sql, R, jobTitles), getMyLineTemplates(sql)]);
    return { ...base, balance, candidates, templates };
  }
  const [boxes, balance] = await Promise.all([getApprovalBoxes(sql, R, u.id, u.role === 'master'), getMyLeaveBalance(sql, R, people, u.id)]);
  return { ...base, boxes, balance };
}

// ── 저장(2.0 server/actions.ts) ───────────────────────────────────────────────────────────────────────────────────────
/** FormData 모양({ $formData: [[이름, 글자] …] }) → get(이름). */
function formOf(arg) {
  if (!arg || typeof arg !== 'object' || !Array.isArray(arg.$formData)) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  const entries = arg.$formData.filter(e => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string');
  return { get: k => { const e = entries.find(x => x[0] === k); return e ? e[1] : null; } };
}
const parseIds = raw => { try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v.map(String).filter(id => UUID.test(id)) : []; } catch { return []; } };
const isBlankHtml = html => html.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim().length === 0;
function parseRichBody(R, raw) {
  const text = String(raw ?? '').trim();
  if (text.length > MAX_REASON_HTML) return { error: '본문이 너무 깁니다 — 줄여 주세요' };
  if (!text) return { html: '' };
  const html = R.sanitizeRichHtml(text);
  return { html: isBlankHtml(html) ? '' : html };
}
function parseTitle(raw) {
  const title = String(raw ?? '').trim();
  if (!title) return { error: '제목을 입력하세요' };
  if (title.length > MAX_TITLE) return { error: `제목이 너무 깁니다 — ${MAX_TITLE}자 이내로 줄여 주세요` };
  return { title };
}
/** notifyUsers — 알림 줄까지(내 행동은 나에게 안 알린다). 슬랙 깨우기는 하지 않는다(바깥 전송). */
async function notifyUsers(sql, items) {
  for (const i of items.filter(x => x.recipientId && x.recipientId !== x.actorId)) {
    await sql`insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
      values (${i.tenantId}, ${i.recipientId}, ${i.type}, ${i.title}, ${i.body ?? null}, ${i.link ?? null}, ${i.actorId ?? null})`;
  }
}
async function ctxOf({ sql, body, tenantId: t, importV2 }, needMenu) {
  const [R, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const u = typeof body.actor === 'string' ? staffOf(people).find(s => s.id === body.actor) : null;
  if (!u) return { error: '로그인이 필요합니다' };
  if (needMenu) { const lv = people.level(u, MENU); if (lv !== 'full' && lv !== 'scoped') return { error: '전자결재 권한이 없습니다' }; }
  return { R, people, t, sql, user: { id: u.id, tenantId: t, displayName: u.display_name, systemRole: u.role, row: u }, fd: formOf(body.args[1]) };
}

async function activeStaffIds(sql, t) {
  return (await sql`select id::text id from public.users where tenant_id=${t} and status::text <> 'inactive' and system_role::text <> 'student' limit 500`).map(u => u.id);
}
/** createApprovalDocument — 결재선 검증 → 번호 채번(충돌 재시도) → 문서·결재선·참조·상세 → 1단계 알림 → 감사로그. */
async function createApprovalDocument(c, { form, title, line, refs, insertDetail, displayLabel, auditMetadata }) {
  const { sql, t, user, R } = c, label = displayLabel ?? title;
  const lineInvalid = R.validateApprovalLine({ drafterId: user.id, approverIds: line, refIds: refs, candidateIds: await activeStaffIds(sql, t) });
  if (lineInvalid) return { error: lineInvalid };
  const today = R.kstToday(), year = today.slice(0, 4);
  const [{ n }] = await sql`select count(*)::int n from public.approval_documents where tenant_id=${t} and form_type=${form} and doc_no like ${`%-${year}-%`}`;
  let docId = null, lastError = '';
  for (let attempt = 0; attempt < DOC_NO_RETRY && !docId; attempt += 1) {
    try {
      const [row] = await sql.savepoint(sp => sp`insert into public.approval_documents (tenant_id, doc_no, form_type, title, drafter_id, status, current_step)
        values (${t}, ${R.nextDocNo(form, today, n, attempt)}, ${form}, ${title}, ${user.id}, 'pending', 1) returning id::text id`);
      docId = row.id;
    } catch (e) { lastError = e?.message ?? ''; if (e?.code !== '23505') break; }
  }
  if (!docId) return { error: `상신 실패 — ${lastError || '알 수 없는 오류'}` };
  const roles = R.stepRoleLabels(line.length);
  try {
    await sql.savepoint(async sp => {
      for (const [i, approverId] of line.entries()) await sp`insert into public.approval_steps (tenant_id, document_id, step_no, approver_id, role_label) values (${t}, ${docId}, ${i + 1}, ${approverId}, ${roles[i] ?? '승인'})`;
      await insertDetail(sp, docId);
      for (const userId of refs) await sp`insert into public.approval_refs (tenant_id, document_id, user_id) values (${t}, ${docId}, ${userId})`;
    });
  } catch (e) {
    await sql`delete from public.approval_documents where id=${docId} and tenant_id=${t}`;
    if (/leave_forms_kind_valid/i.test(e?.message ?? '')) return { error: '반반차는 DB 마이그레이션(0223a) 적용 후 신청할 수 있습니다' };
    return { error: `상신 실패 — ${e?.message ?? ''}` };
  }
  if (line[0]) await notifyUsers(sql, [{ tenantId: t, recipientId: line[0], type: 'approval_requested', title: '결재 요청', body: `${user.displayName} · ${label}`, link: `/approvals/${docId}`, actorId: user.id }]);
  await audit(sql, t, user.row, 'approval_submit', 'approval_document', label, auditMetadata);
  return { ok: true, docId, notice: `결재를 올렸습니다 — 결재 ${line.length}단계${refs.length > 0 ? ` · 참조 ${refs.length}명` : ''}` };
}

const lineOf = (c) => { const line = c.R.normalizeLine(c.user.id, parseIds(c.fd.get('approverIds'))); return { line, refs: c.R.normalizeRefs(c.user.id, line, parseIds(c.fd.get('refIds'))) }; };
function money(c, field, dateField, dateMsg) {
  const amountRaw = String(c.fd.get('amount') ?? '').replace(/[,\s]/g, '');
  if (!amountRaw) return { error: '금액을 입력하세요' };
  if (!/^\d+$/.test(amountRaw)) return { error: '금액은 숫자로 입력하세요' };
  const amount = Number(amountRaw);
  if (amount < 1 || amount > MAX_MONEY_AMOUNT) return { error: '금액은 1원 이상 10억 원 이하로 입력하세요' };
  const date = String(c.fd.get(dateField) ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: dateMsg };
  return { amount, date };
}

const DRAFT = (needMenu, fn) => ({ validate: raw => serverCall(raw, [MODULE], 2), run: async ctx => { const c = await ctxOf(ctx, needMenu); return c.error ? { error: c.error } : fn(c); } });
const actions = {
  submitLeaveDraft: DRAFT(true, async c => {
    const { R, fd, user, sql, t } = c;
    const kindRaw = String(fd.get('kind') ?? 'annual'), kind = R.isLeaveKind(kindRaw) ? kindRaw : 'annual';
    const start = String(fd.get('startDate') ?? '').trim(), end = kind === 'half' ? start : String(fd.get('endDate') ?? '').trim() || start;
    const body = parseRichBody(R, fd.get('reason'));
    if ('error' in body) return { error: '사유가 너무 깁니다 — 줄여 주세요' };
    const reason = body.html || null;
    const [me] = await sql`select hire_date::text hire_date from public.users where id=${user.id} and tenant_id=${t}`;
    const today = R.kstToday();
    const period = R.applyLeaveGrantOverride(user.id, R.resolveLeavePeriod(me?.hire_date ?? null, start || today, today), isChinsan(c.people));
    if (!period) return { error: '입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 등록을 요청하세요' };
    const invalid = R.validateLeaveRange({ start, end, kind, periodEnd: period.end });
    if (invalid) return { error: invalid };
    const days = R.countLeaveDays(start, end, kind);
    // reservedLeaveDays · adjustmentDaysFor(features/leave/server/admin.ts) — 승인 + 결재중, 조정 합계.
    const [forms, adj] = await Promise.all([
      sql`select f.period_start::text period_start, f.period_end::text period_end, f.days, d.status::text status from public.leave_forms f left join public.approval_documents d on d.id=f.document_id
        where f.tenant_id=${t} and f.user_id=${user.id} and f.period_start <= ${period.end}::date and f.period_end >= ${period.start}::date limit 500`,
      sql`select period_start::text period_start, period_end::text period_end, days from public.leave_adjustments
        where tenant_id=${t} and user_id=${user.id} and period_start <= ${period.end}::date and period_end >= ${period.start}::date limit 500`,
    ]);
    const inPeriod = r => R.leaveRowMatchesPeriod({ periodStart: r.period_start, periodEnd: r.period_end }, period);
    const reserved = R.roundDays(forms.filter(inPeriod).reduce((a, r) => (r.status === 'approved' || r.status === 'pending' ? a + num(r.days) : a), 0));
    const adjustment = R.sumAdjustments(adj.filter(inPeriod).map(r => ({ days: num(r.days) })));
    const granted = R.grantedTotal(period.granted, adjustment), remaining = R.remainingDays({ granted, used: reserved, pending: 0 });
    if (days > remaining) {
      const grantedNote = adjustment === 0 ? R.formatLeaveDays(granted) : `${R.formatLeaveDays(granted)}(법정 ${R.formatLeaveDays(period.granted)} · 조정 ${R.formatSignedDays(adjustment)})`;
      return { error: remaining <= 0 ? `남은 연차가 없습니다 (${period.label} 부여 ${grantedNote} 전부 사용·결재중)` : `잔여 연차 ${R.formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다 (신청 ${R.formatLeaveDays(days)})` };
    }
    const title = `${R.APPROVAL_FORM_LABEL.leave} — ${start}${end !== start ? ` ~ ${end}` : ''} ${R.formatLeaveDays(days)}`;
    return createApprovalDocument(c, { form: 'leave', title, ...lineOf(c),
      insertDetail: (sp, docId) => sp`insert into public.leave_forms (document_id, tenant_id, user_id, leave_kind, start_date, end_date, days, reason, period_start, period_end, granted_days)
        values (${docId}, ${t}, ${user.id}, ${kind}, ${start}, ${end}, ${days}, ${reason}, ${period.start}, ${period.end}, ${granted})`,
      auditMetadata: { days, remaining, granted, period: R.leavePeriodLabel(period) } });
  }),
  submitBasicDraft: DRAFT(true, async c => {
    const { R, fd, t } = c;
    if (String(fd.get('formType') ?? '') !== 'proposal') return { error: '지원하지 않는 양식입니다' };
    const parsedTitle = parseTitle(fd.get('title')); if ('error' in parsedTitle) return parsedTitle;
    const body = parseRichBody(R, fd.get('body')); if ('error' in body) return body;
    return createApprovalDocument(c, { form: 'proposal', title: parsedTitle.title, ...lineOf(c), displayLabel: `${R.APPROVAL_FORM_LABEL.proposal} — ${parsedTitle.title}`,
      insertDetail: (sp, docId) => sp`insert into public.approval_basic_forms (document_id, tenant_id, body_html) values (${docId}, ${t}, ${body.html})` });
  }),
  submitExpenseDraft: DRAFT(true, async c => {
    const { R, fd, t } = c;
    const parsedTitle = parseTitle(fd.get('title')); if ('error' in parsedTitle) return parsedTitle;
    const m = money(c, 'amount', 'spendDate', '지출일을 선택하세요'); if (m.error) return { error: m.error };
    const raw = String(fd.get('category') ?? ''), category = R.EXPENSE_CATEGORIES.includes(raw) ? raw : '기타';
    const body = parseRichBody(R, fd.get('body')); if ('error' in body) return body;
    return createApprovalDocument(c, { form: 'expense', title: parsedTitle.title, ...lineOf(c), displayLabel: `${R.APPROVAL_FORM_LABEL.expense} — ${parsedTitle.title}`,
      insertDetail: (sp, docId) => sp`insert into public.approval_expense_forms (document_id, tenant_id, amount, spend_date, category, body_html) values (${docId}, ${t}, ${m.amount}, ${m.date}, ${category}, ${body.html})`,
      auditMetadata: { amount: m.amount, spendDate: m.date, category } });
  }),
  submitIncomeDraft: DRAFT(true, async c => {
    const { R, fd, t } = c;
    const parsedTitle = parseTitle(fd.get('title')); if ('error' in parsedTitle) return parsedTitle;
    const m = money(c, 'amount', 'incomeDate', '수입일을 선택하세요'); if (m.error) return { error: m.error };
    const raw = String(fd.get('category') ?? ''), category = R.INCOME_CATEGORIES.includes(raw) ? raw : '기타';
    const body = parseRichBody(R, fd.get('body')); if ('error' in body) return body;
    return createApprovalDocument(c, { form: 'income', title: parsedTitle.title, ...lineOf(c), displayLabel: `${R.APPROVAL_FORM_LABEL.income} — ${parsedTitle.title}`,
      insertDetail: (sp, docId) => sp`insert into public.approval_income_forms (document_id, tenant_id, amount, income_date, category, body_html) values (${docId}, ${t}, ${m.amount}, ${m.date}, ${category}, ${body.html})`,
      auditMetadata: { amount: m.amount, incomeDate: m.date, category } });
  }),

  /** 결재 처리(승인·반려·전결) + 후결 넘김 + 대결(원장). 한 트랜잭션이라 2.0의 '방금 쓴 칸 되돌리기'는 트랜잭션 되돌림으로 같다. */
  decideDocument: DRAFT(false, async c => {
    const { fd, user, sql, t } = c;
    const docId = String(fd.get('documentId') ?? '').trim(), decision = String(fd.get('decision') ?? '');
    const deferPrevious = String(fd.get('deferPrevious') ?? '') === '1';
    const comment = String(fd.get('comment') ?? '').trim().slice(0, MAX_TEXT) || null;
    if (!docId) return { error: '결재할 문서를 찾을 수 없습니다' };
    if (!['approved', 'rejected', 'final'].includes(decision)) return { error: '승인·반려·전결 중에서 선택하세요' };
    if (!UUID.test(docId)) return { error: '문서를 찾을 수 없습니다' };
    const [doc] = await sql`select id::text id, title, drafter_id::text drafter_id, status::text status, current_step from public.approval_documents where id=${docId} and tenant_id=${t}`;
    if (!doc) return { error: '문서를 찾을 수 없습니다' };
    if (doc.status !== 'pending') return { error: '이미 처리된 문서입니다' };
    if (doc.drafter_id === user.id) return { error: '본인이 올린 문서는 결재할 수 없습니다' };
    const line = await sql`select id::text id, step_no, approver_id::text approver_id, decision::text decision from public.approval_steps where document_id=${docId} order by step_no`;
    const currentCell = line.find(s => s.step_no === doc.current_step), myCell = line.find(s => s.approver_id === user.id);
    let target, proxy = false, deferredCells = [];
    if (currentCell && currentCell.approver_id === user.id) {
      if (currentCell.decision !== 'pending') return { error: '이미 결재한 문서입니다' };
      target = currentCell;
    } else if (deferPrevious) {
      if (!myCell) return { error: '이 문서의 결재선에 포함되지 않았습니다' };
      if (myCell.step_no <= doc.current_step) return { error: '후결로 넘길 앞 단계가 없습니다' };
      if (myCell.decision !== 'pending') return { error: '이미 결재한 문서입니다' };
      deferredCells = line.filter(s => s.step_no >= doc.current_step && s.step_no < myCell.step_no);
      if (deferredCells.some(s => s.decision !== 'pending')) return { error: '앞 단계가 이미 처리되고 있어 후결로 넘길 수 없습니다' };
      target = myCell;
    } else if (user.systemRole === 'master' && currentCell && currentCell.decision === 'pending') {
      proxy = true; target = currentCell;
    } else return { error: '지금은 내 결재 차례가 아닙니다' };
    const now = new Date().toISOString();
    if (deferredCells.length) {
      const marked = await sql`update public.approval_steps set decision='deferred' where id = any(${deferredCells.map(s => s.id)}::uuid[]) and decision='pending' returning id`;
      if (marked.length !== deferredCells.length) throw new V2Error(409, 'stale', '앞 단계 상태가 방금 바뀌었습니다 — 새로고침 후 다시 확인해 주세요');
    }
    const written = await sql`update public.approval_steps set decision=${decision}, decided_at=${now}, comment=${comment} ${proxy ? sql`, acted_by=${user.id}` : sql``}
      where id=${target.id} and decision='pending' returning id`;
    if (!written.length) return { error: '이미 결재된 칸입니다 — 새로고침 후 확인해 주세요' };
    const isFinal = decision === 'final';
    if (isFinal) await sql`update public.approval_steps set decision='skipped' where document_id=${docId} and step_no > ${target.step_no} and decision='pending'`;
    const deferredIds = new Set(deferredCells.map(s => s.id));
    const nextPending = isFinal ? undefined : line.find(s => s.step_no > target.step_no && s.decision === 'pending' && !deferredIds.has(s.id));
    const approvedLike = decision === 'approved' || isFinal, closes = !approvedLike || isFinal || !nextPending;
    const who = `${user.displayName}${proxy ? ' (대결)' : ''}`;
    const docWritten = !approvedLike
      ? await sql`update public.approval_documents set status='rejected', completed_at=${now}, outcome_note=${`반려 — ${who}${comment ? ` (${comment})` : ''}`} where id=${docId} and tenant_id=${t} and status='pending' returning id`
      : isFinal ? await sql`update public.approval_documents set status='approved', completed_at=${now}, outcome_note=${`전결 승인 — ${who}`} where id=${docId} and tenant_id=${t} and status='pending' returning id`
      : nextPending ? await sql`update public.approval_documents set current_step=${nextPending.step_no} where id=${docId} and tenant_id=${t} and status='pending' returning id`
      : await sql`update public.approval_documents set status='approved', completed_at=${now}, outcome_note=${`최종 승인 — ${who}`} where id=${docId} and tenant_id=${t} and status='pending' returning id`;
    // 2.0은 0행이면 방금 쓴 칸을 되돌리고 알린다 — 여기선 트랜잭션째 되돌린다(같은 결과).
    if (!docWritten.length) throw new V2Error(409, 'stale', '그 사이 문서가 회수되었거나 이미 처리되었습니다 — 새로고침 후 확인해 주세요');
    const base = { tenantId: t, link: `/approvals/${docId}`, actorId: user.id };
    if (proxy && target.approver_id && target.approver_id !== user.id) await notifyUsers(sql, [{ ...base, recipientId: target.approver_id, type: 'approval_decided', title: '대결 처리 안내',
      body: `${doc.title} — ${user.displayName}님이 내 결재 칸을 대신 ${!approvedLike ? '반려' : isFinal ? '전결' : '승인'}했습니다.` }]);
    if (deferredCells.length) await notifyUsers(sql, deferredCells.map(s => ({ ...base, recipientId: s.approver_id, type: 'approval_requested', title: '후결 처리 안내', body: `${doc.title} — 부재로 후결 처리됐습니다. 나중에 후결 확인이 필요합니다.` })));
    if (!closes && nextPending) await notifyUsers(sql, [{ ...base, recipientId: nextPending.approver_id, type: 'approval_requested', title: '결재 요청', body: `${doc.title}` }]);
    else if (closes) {
      const refRows = await sql`select user_id::text user_id from public.approval_refs where document_id=${docId} and tenant_id=${t}`;
      const outcome = !approvedLike ? '반려' : isFinal ? '전결 승인' : '승인';
      await notifyUsers(sql, [{ ...base, recipientId: doc.drafter_id, type: 'approval_decided', title: `결재 ${outcome}`, body: `${doc.title} — ${outcome}되었습니다${proxy ? ` (대결 — ${user.displayName})` : ''}` },
        ...refRows.map(r => ({ ...base, recipientId: r.user_id, type: 'approval_decided', title: `참조 문서 ${outcome}`, body: `${doc.title} — ${outcome}으로 종결되었습니다 (참조)` }))]);
    }
    await audit(sql, t, user.row, 'approval_decide', 'approval_document', `${doc.title} · ${!approvedLike ? '반려' : isFinal ? '전결' : '승인'}${proxy ? ' (대결)' : ''}`,
      { docId, decision, step: target.step_no, proxy, deferred: deferredCells.length });
    const deferNote = deferredCells.length ? '앞 단계를 후결로 넘기고 ' : '';
    return { ok: true, notice: !approvedLike ? `${deferNote}반려했습니다${proxy ? ' (대결)' : ''}` : isFinal ? `${deferNote}전결로 승인 종결했습니다${proxy ? ' (대결)' : ''}`
      : nextPending ? `${deferNote}승인했습니다 — 다음 결재자에게 넘어갔습니다${proxy ? ' (대결)' : ''}` : `${deferNote}최종 승인했습니다${proxy ? ' (대결)' : ''}` };
  }),
  confirmDeferredStep: DRAFT(false, async c => {
    const { fd, user, sql, t } = c, docId = String(fd.get('documentId') ?? '').trim();
    if (!docId) return { error: '확인할 문서를 찾을 수 없습니다' };
    const [doc] = UUID.test(docId) ? await sql`select id::text id, title from public.approval_documents where id=${docId} and tenant_id=${t}` : [];
    if (!doc) return { error: '문서를 찾을 수 없습니다' };
    const updated = await sql`update public.approval_steps set decision='post_approved', decided_at=${new Date().toISOString()} where document_id=${docId} and approver_id=${user.id} and decision='deferred' returning id`;
    if (updated.length > 1) throw new V2Error(409, 'stale', '후결 확인 실패 — 같은 사람의 후결 칸이 여럿입니다'); // 2.0 maybeSingle은 여러 줄이면 오류
    if (!updated.length) return { error: '후결 확인할 칸이 없습니다' };
    await audit(sql, t, user.row, 'approval_decide', 'approval_document', `${doc.title} · 후결 확인`, { docId, postApproval: true });
    return { ok: true, notice: '후결 확인했습니다' };
  }),
  withdrawDocument: DRAFT(false, async c => {
    const { fd, user, sql, t } = c, docId = String(fd.get('documentId') ?? '').trim();
    if (!docId) return { error: '회수할 문서를 찾을 수 없습니다' };
    if (!UUID.test(docId)) return { error: '진행중인 본인 기안만 회수할 수 있습니다' };
    const steps = await sql`select decision::text decision, step_no, approver_id::text approver_id from public.approval_steps where document_id=${docId}`;
    if (steps.some(s => s.decision !== 'pending')) return { error: '이미 결재가 시작돼 회수할 수 없습니다' };
    const [updated] = await sql`update public.approval_documents set status='canceled', completed_at=${new Date().toISOString()}, outcome_note='기안자 회수'
      where id=${docId} and tenant_id=${t} and drafter_id=${user.id} and status='pending' returning id::text id, title, current_step`;
    if (!updated) return { error: '진행중인 본인 기안만 회수할 수 있습니다' };
    const currentApprover = steps.find(s => s.step_no === updated.current_step)?.approver_id;
    if (currentApprover && currentApprover !== user.id) await notifyUsers(sql, [{ tenantId: t, recipientId: currentApprover, type: 'approval_decided', title: '결재 문서 회수',
      body: `${updated.title} — 기안자가 문서를 회수했습니다. 결재할 필요가 없습니다.`, link: `/approvals/${docId}`, actorId: user.id }]);
    await audit(sql, t, user.row, 'approval_withdraw', 'approval_document', docId, null);
    return { ok: true, notice: '기안을 회수했습니다' };
  }),
  addApprovalComment: DRAFT(false, async c => {
    const { fd, user, sql, t, people } = c;
    const docId = String(fd.get('documentId') ?? '').trim(), body = String(fd.get('body') ?? '').trim().slice(0, MAX_TEXT);
    if (!docId) return { error: '댓글을 남길 문서를 찾을 수 없습니다' };
    if (!body) return { error: '댓글 내용을 입력하세요' };
    const [doc] = UUID.test(docId) ? await sql`select id::text id, title, drafter_id::text drafter_id from public.approval_documents where id=${docId} and tenant_id=${t}` : [];
    if (!doc) return { error: '문서를 찾을 수 없습니다' };
    const [steps, refs] = await Promise.all([sql`select approver_id::text id from public.approval_steps where document_id=${docId}`, sql`select user_id::text id from public.approval_refs where document_id=${docId}`]);
    const participant = doc.drafter_id === user.id || steps.some(s => s.id === user.id) || refs.some(r => r.id === user.id) || user.systemRole === 'master' || people.operators.has(user.id);
    if (!participant) return { error: '이 문서의 기안자·결재자·참조자만 댓글을 남길 수 있습니다' };
    await sql`insert into public.approval_comments (tenant_id, document_id, author_id, body) values (${t}, ${docId}, ${user.id}, ${body})`;
    const recipients = [...new Set([doc.drafter_id, ...steps.map(s => s.id)])];
    await notifyUsers(sql, recipients.map(recipientId => ({ tenantId: t, recipientId, type: 'approval_comment', title: '결재 문서 댓글',
      body: `${doc.title} — ${user.displayName}: ${body.length > 60 ? `${body.slice(0, 60)}…` : body}`, link: `/approvals/${docId}`, actorId: user.id })));
    await audit(sql, t, user.row, 'approval_comment', 'approval_document', doc.title, { docId });
    return { ok: true, notice: '댓글을 남겼습니다' };
  }),
  deleteApprovalComment: DRAFT(false, async c => {
    const { fd, user, sql, t } = c, commentId = String(fd.get('commentId') ?? '').trim();
    if (!commentId) return { error: '삭제할 댓글을 찾을 수 없습니다' };
    const [data] = UUID.test(commentId) ? await sql`delete from public.approval_comments where id=${commentId} and tenant_id=${t} and author_id=${user.id} returning document_id::text document_id` : [];
    if (!data) return { error: '본인이 쓴 댓글만 삭제할 수 있습니다' };
    const [doc] = await sql`select title from public.approval_documents where id=${data.document_id} and tenant_id=${t}`;
    await audit(sql, t, user.row, 'approval_comment_delete', 'approval_document', doc?.title ?? '결재 문서', { commentId, docId: data.document_id });
    return { ok: true, notice: '댓글을 삭제했습니다' };
  }),
  saveLineTemplate: DRAFT(true, async c => {
    const { R, fd, user, sql, t } = c, name = String(fd.get('name') ?? '').trim().slice(0, 40);
    if (!name) return { error: '결재선 이름을 입력하세요' };
    const { line: approvers, refs } = lineOf(c);
    const invalid = R.validateApprovalLine({ drafterId: user.id, approverIds: approvers, refIds: refs, candidateIds: await activeStaffIds(sql, t) });
    if (invalid) return { error: invalid };
    await sql`insert into public.approval_line_templates (tenant_id, owner_id, name, approver_ids, ref_ids) values (${t}, ${user.id}, ${name}, ${sql.json(approvers)}, ${sql.json(refs)})
      on conflict (tenant_id, owner_id, name) do update set approver_ids = excluded.approver_ids, ref_ids = excluded.ref_ids`;
    return { ok: true, notice: `결재선 '${name}'을(를) 저장했습니다` };
  }),
  deleteLineTemplate: DRAFT(true, async c => {
    const { fd, user, sql, t } = c, id = String(fd.get('templateId') ?? '').trim();
    if (!id) return { error: '삭제할 결재선을 찾을 수 없습니다' };
    const [data] = UUID.test(id) ? await sql`delete from public.approval_line_templates where id=${id} and tenant_id=${t} and owner_id=${user.id} returning id` : [];
    if (!data) return { error: '본인이 저장한 결재선만 삭제할 수 있습니다' };
    return { ok: true, notice: '저장된 결재선을 삭제했습니다' };
  }),
};

export const screen = {
  id: ID, label: '전자결재', order: 41,
  params: { actor: UUID, v2path: new RegExp(`^/approvals(?:/new|/${UUID_BODY})?$`, 'i'), tab: /^[a-z]{1,10}$/ },
  actions,
  load: build,
};
export { loadRules };
