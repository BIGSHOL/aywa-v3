// 2.0 화면 — 교재 요청(V2-SCREENS.md 대상 `textbook-requests`). 그리기는 2.0의 실제 React 부품(v2-host/src/textbook-requests*.tsx),
// 이 모듈은 2.0 app/(shell)/textbook-requests/page.tsx가 서버에서 하던 조회와 요청서 저장을 Docker 복사본에서 같은 결과로 만든다:
//  · 조회 = billing/server/textbook-scope.ts textbookRequestStudentIds(강사 = 담임 ∪ 교시 담당 ∪ 임시 위임 반의 열린 수강) ·
//    textbook-queries.ts getTextbookOrdersForStudents · getTextbookOrdersCreatedBy · getStudentOptionsForIds(강사) /
//    getTextbookOrdersPage({}, 1, 100) · getStudentOptions(사무실) · textbook-notice-links.ts withTextbookNoticeLinks · catalog-queries.ts getCatalogOptions
//  · 저장 = textbook-actions.ts requestTextbook · updateTextbookRequest · deleteTextbookRequest(+ textbook-notice-handover.ts) — 판정·문구·감사로그 2.0 그대로.
// 사람마다 화면이 다르다(강사 = 담당 학생 + 본인 요청) — '보는 사람'을 고르고(교재목록과 같은 방식 · 운영자 계정 제외 · 원장 먼저) 그 사람이 저장도 한다.
// 2.0은 이 화면을 사용자 클라이언트(RLS)로 쓴다 — 쓰기는 같은 역할(authenticated)로 해서 소유 게이트(강사는 본인 이름·본인 작성만 고치고 지운다)가 2.0처럼 본다.
// 학원 로고는 파일 저장소·바깥 주소라 싣지 않는다(요청서 그림에 로고 자리가 빈다). 학부모 발송(ClassNote)·첨부 그림은 다음 단계.
import { V2Error } from './v2-screens.mjs';
import { audit } from './v2-timetable-save.mjs';
import { deepMerge } from './v2-screen-timetable.mjs';
import { UUID, loadRules, readSettings, readViewers, editorsOf } from './v2-mcs-core.mjs';

const ID = 'textbook-requests';
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** timestamptz → PostgREST가 내던 글자(UTC ISO · +00:00). */
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;

let rulesPromise = null;
function loadRequestRules(importV2) {
  rulesPromise ??= (async () => {
    const [progress, auditRules, ownership, dbError, notice] = await Promise.all(['features/billing/textbook-progress.ts', 'features/billing/textbook-audit.ts',
      'features/billing/textbook-ownership.ts', 'lib/supabase/db-error.ts', 'features/billing/textbook-notice.ts'].map(p => importV2(p)));
    return { progress, audit: auditRules, ownership, dbError, notice };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── 조회 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const orderCols = (sql, withNotice) => sql`id::text id, book_name, book_detail, student_id::text student_id, student_name, teacher_name, created_by::text created_by,
  ${withNotice ? sql`classnote_notice_id::text classnote_notice_id,` : sql``} price, status, request_date::text request_date, notes, ${ISO(sql, 'registered_at')} registered_at,
  ${ISO(sql, 'ordered_at')} ordered_at, ${ISO(sql, 'paid_at')} paid_at, status_by_name, ${ISO(sql, 'status_at')} status_at, ${ISO(sql, 'created_at')} created_at`;
// 2.0 to_char는 null이면 null — 위 ISO는 null || '+00:00' = null(문자열 연결은 null 전파).
const mapOrder = r => ({ id: r.id, bookName: r.book_name, bookDetail: r.book_detail, studentId: r.student_id, studentName: r.student_name, teacherName: r.teacher_name,
  price: Number(r.price), status: r.status, requestDate: r.request_date, notes: r.notes, registered: !!r.registered_at, ordered: !!r.ordered_at, paid: !!r.paid_at,
  registeredAt: r.registered_at, orderedAt: r.ordered_at, paidAt: r.paid_at, statusByName: r.status_by_name, statusAt: r.status_at, createdAt: r.created_at,
  createdBy: r.created_by ?? null, classnoteNoticeId: r.classnote_notice_id ?? null });

/** 2.0 textbookRequestStudentIds — teacherViewableClassIds(담임 ∪ 교시 담당(이력 포함) ∪ 오늘 ±7일 위임) 반의 열린 수강(end_date 없음) 학생. */
export async function requestStudentIds(sql, t, R, teacherId) {
  const today = R.dk.kstToday();
  const classIds = (await sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${teacherId}
    union select class_id::text from public.class_schedules where tenant_id=${t} and teacher_id=${teacherId}
    union select class_id::text from public.class_delegations where tenant_id=${t} and delegate_user_id=${teacherId} and revoked_at is null
      and from_date <= ${R.dk.addDays(today, 7)}::date and to_date >= ${R.dk.addDays(today, -7)}::date`).map(r => r.id);
  if (classIds.length === 0) return [];
  return (await sql`select distinct student_id::text id from public.enrollments where tenant_id=${t} and end_date is null and class_id = any(${classIds}::uuid[])`).map(r => r.id);
}

const sortName = rows => rows.map(s => ({ id: s.id, name: s.name, grade: s.grade })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const checkCount = r => (r.registered ? 1 : 0) + (r.paid ? 1 : 0) + (r.ordered ? 1 : 0);

async function readPage(sql, t, R, X, viewer) {
  const isTeacher = viewer.systemRole === 'teacher';
  let rows, students;
  if (isTeacher) {
    const ids = await requestStudentIds(sql, t, R, viewer.id);
    const [scoped, mine, opts] = await Promise.all([
      ids.length ? sql`select ${orderCols(sql, false)} from public.textbook_orders where tenant_id=${t} and student_id = any(${ids}::uuid[])` : [],
      sql`select ${orderCols(sql, false)} from public.textbook_orders where tenant_id=${t} and created_by=${viewer.id} order by created_at desc, id limit 500`,
      ids.length ? sql`select id::text id, name, grade from public.students where tenant_id=${t} and id = any(${ids}::uuid[]) and status::text <> 'withdrawn'` : [],
    ]);
    const scopedRows = scoped.map(mapOrder).map(r => ({ ...r, classnoteNoticeId: null })).sort((a, b) => (b.requestDate ?? '').localeCompare(a.requestDate ?? ''));
    const seen = new Set(scopedRows.map(r => r.id));
    const merged = [...scopedRows, ...mine.map(mapOrder).map(r => ({ ...r, classnoteNoticeId: null })).filter(r => !seen.has(r.id))]
      .sort((a, b) => (b.requestDate ?? '').localeCompare(a.requestDate ?? ''));
    // withTextbookNoticeLinks — '발송함' 표시는 이 화면에서 따로 붙인다.
    const links = merged.length ? await sql`select id::text id, classnote_notice_id::text n from public.textbook_orders where tenant_id=${t} and id = any(${merged.map(r => r.id)}::uuid[]) and classnote_notice_id is not null` : [];
    const byId = new Map(links.map(l => [l.id, l.n]));
    rows = merged.map(r => ({ ...r, classnoteNoticeId: byId.get(r.id) ?? r.classnoteNoticeId ?? null }));
    students = sortName(opts);
  } else {
    // getTextbookOrdersPage({}, 1, 100) — 체크 개수 오름차순 → 신청일 최신순, 앞 100건.
    const [all, opts] = await Promise.all([
      sql`select ${orderCols(sql, true)} from public.textbook_orders where tenant_id=${t} order by request_date desc nulls last, id`,
      sql`select id::text id, name, grade from public.students where tenant_id=${t} and status::text <> 'withdrawn' order by name asc, id asc`,
    ]);
    rows = all.map(mapOrder).sort((a, b) => checkCount(a) - checkCount(b) || (b.requestDate ?? '').localeCompare(a.requestDate ?? '')).slice(0, 100);
    students = opts.map(s => ({ id: s.id, name: s.name, grade: s.grade }));
  }
  return { rows, students, isTeacher };
}

/** 학원 설정의 이름(profile)·입금 계좌(billing) — 2.0 getTenantSettings(resolveSettings)와 같은 병합(이름이 비면 지점 이름). 계좌 고르기·기본 이름은 화면이 2.0 함수로. */
async function readBranding(sql, t, R) {
  const [[row], [tenant]] = await Promise.all([sql`select data from public.tenant_settings where tenant_id=${t}`, sql`select name from public.tenants where id=${t}`]);
  const stored = row?.data ?? null, base = R.preset.baseSettingsFor(R.preset.presetOfStored(stored));
  const profile = deepMerge(base.profile, plain(stored) ? stored.profile : undefined), billing = deepMerge(base.billing, plain(stored) ? stored.billing : undefined);
  return { profile: { ...profile, name: profile.name || tenant?.name || '' }, billing };
}

// ── 저장 — textbook-actions.ts ─────────────────────────────────────────────────────────────────────────────────────
/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → get · getAll. */
function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 500) throw bad();
  const pairs = v.$formData.map(p => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 100 || p[1].length > 5000) throw bad(); return p; });
  return { get: k => pairs.find(p => p[0] === k)?.[1] ?? null, getAll: k => pairs.filter(p => p[0] === k).map(p => p[1]) };
}
const won = v => Math.max(0, Number(String(v ?? '0').replace(/[,\s]/g, '')) || 0);
const parse = f => ({ bookName: String(f.get('bookName') ?? '').trim(), bookDetail: String(f.get('bookDetail') ?? '').trim() || null, studentId: String(f.get('studentId') ?? '').trim() || null,
  teacherName: String(f.get('teacherName') ?? '').trim() || null, price: won(f.get('price')), requestDate: String(f.get('requestDate') ?? '').trim() || null, notes: String(f.get('notes') ?? '').trim() || null });
const DELETE_BLOCKED_MSG = "이 요청서를 지울 권한이 없습니다 — 요청서에 적힌 담당 선생님 이름이 본인과 다르면 관리자에게 요청해주세요.";
const snapshotOf = row => ({ studentName: row?.student_name ?? null, teacherName: row?.teacher_name ?? null, bookName: row?.book_name ?? null, bookDetail: row?.book_detail ?? null,
  price: row?.price ?? null, requestDate: row?.request_date ?? null, notes: row?.notes ?? null });
const canWrite = actor => actor.level === 'full' || actor.level === 'scoped';

/** 2.0 사용자 클라이언트 = 그 사람의 신분(JWT claims) + authenticated 역할 — RLS(소유 게이트)가 2.0처럼 본다. 실패하면 저장점째 되돌아간다. */
async function asUser(sql, actor, fn) {
  try {
    return { data: await sql.savepoint(async s => {
      // set_config(…, true)는 저장점을 '풀어도' 트랜잭션 끝까지 남는다 — 끝나면 원래 신분으로 되돌린다(뒤의 서비스 키 같은 쓰기가 이 사람으로 판정되지 않게).
      const [{ prev }] = await s`select coalesce(current_setting('request.jwt.claims', true), '') prev`;
      await s`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
      await s`set local role authenticated`;
      const out = await fn(s);
      await s`reset role`;
      await s`select set_config('request.jwt.claims', ${prev}, true)`;
      return out;
    }), error: null };
  } catch (e) { return { data: null, error: { code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null, constraint: e?.constraint_name ?? null } }; }
}
const explain = (X, error, scope, fallback, op) => X.dbError.explainDbError(error, { scope, fallback, ...(op ? { op } : {}) }).message;

async function requestTextbook({ sql, t, R, X }, actor, [, formData]) {
  const f0 = formOf(formData);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWrite(actor)) return { error: '교재 요청 권한이 없습니다' };
  const f = parse(f0);
  if (!f.bookName) return { fieldErrors: { bookName: '교재명을 입력해주세요' } };
  const studentIds = [...new Set(f0.getAll('studentId').map(v => String(v).trim()).filter(Boolean))];
  if (studentIds.length === 0) return { fieldErrors: { studentId: '학생을 선택해주세요' } };
  if (!studentIds.every(id => UUID.test(id))) throw bad();
  if (actor.systemRole === 'teacher') {
    const scoped = new Set(await requestStudentIds(sql, t, R, actor.id));
    if (!studentIds.every(id => scoped.has(id))) return { error: '담당 학생만 교재를 요청할 수 있습니다' };
  }
  const names = await sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])`;
  const nameById = new Map(names.map(s => [s.id, s.name ?? null]));
  const nowIso = new Date().toISOString(), teacherName = f.teacherName || actor.name, requestDate = f.requestDate ?? R.dk.kstToday();
  const rows = studentIds.map(sid => ({ tenant_id: t, created_by: actor.id, student_id: sid, student_name: nameById.get(sid) ?? null, teacher_name: teacherName, book_name: f.bookName,
    book_detail: f.bookDetail, price: f.price, status: 'requested', request_date: requestDate, status_at: nowIso, status_by_name: actor.name, notes: f.notes }));
  const { data, error } = await asUser(sql, actor, s => s`insert into public.textbook_orders ${s(rows)} returning id::text id, student_name`);
  if (error) return { error: explain(X, error, 'billing.textbookRequest.create', '교재 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  const target = X.audit.textbookAuditTarget({ studentName: studentIds.length === 1 ? (nameById.get(studentIds[0]) ?? null) : null, bookName: f.bookName });
  await audit(sql, t, actor, 'textbook_order_create', 'textbook_order', { orderIds: data.map(r => r.id), target, price: f.price, count: studentIds.length, surface: 'request' }, target);
  return { ok: true, created: data.map(r => ({ id: r.id, studentName: r.student_name ?? null })) };
}

/** 2.0 loadEditableRequest — 강사는 담당 학생(또는 본인 작성) + 본인 요청만 · 사무실이 하나라도 처리했으면 잠금. */
async function loadEditableRequest({ sql, t, R, X }, actor, id) {
  const [row] = UUID.test(id) ? await sql`select created_by::text created_by, registered_at, ordered_at, paid_at, student_id::text student_id, student_name, teacher_name, book_name, book_detail,
      price, request_date::text request_date, notes from public.textbook_orders where tenant_id=${t} and id=${id}` : [];
  if (!row) return { error: '교재 요청을 찾을 수 없습니다' };
  if (actor.systemRole === 'teacher') {
    const studentIds = await requestStudentIds(sql, t, R, actor.id);
    const createdByViewer = !!row.created_by && row.created_by === actor.id;
    if (!createdByViewer && (!row.student_id || !studentIds.includes(row.student_id))) return { error: '담당 학생의 요청만 수정·삭제할 수 있습니다' };
    if (!X.ownership.ownsTextbookRequest(row.teacher_name, actor.name, row.created_by, actor.id))
      return { error: `본인이 낸 요청만 수정·삭제할 수 있습니다${row.teacher_name ? ` (이 요청: ${row.teacher_name})` : ''}` };
  }
  if (row.registered_at || row.ordered_at || row.paid_at) return { error: '사무실에서 처리 중인 요청은 수정·삭제할 수 없습니다' };
  return { ok: true, before: snapshotOf(row) };
}

async function updateTextbookRequest(io, actor, [, formData]) {
  const { sql, t, X } = io, f0 = formOf(formData);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWrite(actor)) return { error: '교재 요청 권한이 없습니다' };
  const id = String(f0.get('id') ?? '').trim();
  if (!id) return { error: '교재 요청 ID가 누락되었습니다' };
  const f = parse(f0);
  if (!f.bookName) return { fieldErrors: { bookName: '교재명을 입력해주세요' } };
  const gate = await loadEditableRequest(io, actor, id);
  if ('error' in gate) return { error: gate.error };
  const { error } = await asUser(sql, actor, s => s`update public.textbook_orders set book_name=${f.bookName}, book_detail=${f.bookDetail}, notes=${f.notes}, price=${f.price}, updated_at=now() where id=${id}`);
  if (error) return { error: explain(X, error, 'billing.textbookRequest.update', '교재 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  const changes = X.audit.diffTextbookOrder(gate.before, { bookName: f.bookName, bookDetail: f.bookDetail, price: f.price, notes: f.notes });
  if (changes.length > 0) {
    const target = X.audit.textbookAuditTarget({ studentName: gate.before.studentName, bookName: f.bookName });
    await audit(sql, t, actor, 'textbook_order_update', 'textbook_order', { orderId: id, target, changes, surface: 'request' }, target);
  }
  return { ok: true };
}

async function deleteTextbookRequest(io, actor, [, formData]) {
  const { sql, t, X } = io, f0 = formOf(formData);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWrite(actor)) return { error: '교재 요청 권한이 없습니다' };
  const id = String(f0.get('id') ?? '').trim();
  if (!id) return { error: '교재 요청 ID가 누락되었습니다' };
  const gate = await loadEditableRequest(io, actor, id);
  if ('error' in gate) return { error: gate.error };
  // RLS에 막힌 행은 에러 없이 0행 — 지운 행 수로 판정(2.0 그대로).
  const { data: gone, error } = await asUser(sql, actor, s => s`delete from public.textbook_orders where id=${id}
    returning id::text id, student_id::text student_id, book_name, request_date::text request_date, classnote_notice_id::text classnote_notice_id`);
  if (error) return { error: explain(X, error, 'billing.textbookRequest.delete', '교재 요청을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (!gone?.length) return { error: DELETE_BLOCKED_MSG };
  // textbook-notice-handover.ts — 발송 연결은 같은 학생·교재·요청일의 남은(연결 없는) 행 중 가장 먼저 만든 것으로.
  const d = gone[0];
  let noticeMovedTo = null;
  if (d.classnote_notice_id && d.student_id && d.book_name && d.request_date) {
    const [heir] = await sql`select id::text id from public.textbook_orders where tenant_id=${t} and student_id=${d.student_id} and book_name=${d.book_name}
      and request_date=${d.request_date}::date and classnote_notice_id is null order by created_at asc limit 1`;
    if (heir) {
      const moved = await sql`update public.textbook_orders set classnote_notice_id=${d.classnote_notice_id} where id=${heir.id} and tenant_id=${t} and classnote_notice_id is null returning id`;
      if (moved.length) noticeMovedTo = heir.id;
    }
  }
  const deletedTarget = X.audit.textbookAuditTarget(gate.before);
  await audit(sql, t, actor, 'textbook_order_delete', 'textbook_order', { orderId: id, target: deletedTarget, price: Number(gate.before.price ?? 0), surface: 'request',
    noticeId: d.classnote_notice_id ?? null, noticeMovedTo }, deletedTarget);
  return { ok: true };
}

// ── textbook-notice-actions.ts — 내 학부모 메시지(users.textbook_notice_ment) ─────────────────────────────────────────
/** loadMyTextbookMent() — 저장값(없거나 빈 글이면 기본 문구, 옛 기본 문구는 지금 기본으로 흡수 = resolveTextbookMent). 읽기라 화면 GET(ment). */
async function loadMyTextbookMent({ sql, t, X }, actor) {
  if (!actor) return X.notice.DEFAULT_TEXTBOOK_MENT;
  const [row] = await sql`select textbook_notice_ment from public.users where tenant_id=${t} and id=${actor.id}`;
  const v = row?.textbook_notice_ment ?? null;
  return X.notice.resolveTextbookMent(v && v.trim() ? v : null);
}
/** saveMyTextbookMent(text) — 본인 행만 · 2000자 · 빈 글은 null(중간저장이라 실패해도 조용히 ok:false). */
async function saveMyTextbookMent({ sql, t }, actor, [text]) {
  if (!actor) return { ok: false };
  const value = String(text ?? '').trim().slice(0, 2000) || null;
  try { await sql.savepoint(s => s`update public.users set textbook_notice_ment=${value} where id=${actor.id} and tenant_id=${t}`); return { ok: true }; } catch { return { ok: false }; }
}

// ── 공통 틀 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function io(sql, t, importV2) {
  const [R, X] = await Promise.all([loadRules(importV2), loadRequestRules(importV2)]);
  const env = await readSettings(sql, t, R);
  return { sql, t, R, X, env, viewers: await readViewers(sql, t, R, env, 'textbook_requests') };
}
const MODULE = 'features/billing/server/textbook-actions.ts', NOTICE = 'features/billing/server/textbook-notice-actions.ts';
const ACTIONS = { requestTextbook: { run: requestTextbook }, updateTextbookRequest: { run: updateTextbookRequest }, deleteTextbookRequest: { run: deleteTextbookRequest },
  saveMyTextbookMent: { run: saveMyTextbookMent, module: NOTICE, arity: 1 } };

export const screen = {
  id: ID, label: '교재 요청', order: 9,
  params: { viewer: UUID, studentId: UUID, ment: /^1$/ },
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([name, { run, module = MODULE, arity = 2 }]) => [name, {
    validate: raw => {
      if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length !== arity || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      if (module === MODULE) formOf(raw.args[1]); else if (typeof raw.args[0] !== 'string' || raw.args[0].length > 5000) throw bad();
      return { actor: raw.actor ?? null, args: raw.args };
    },
    run: async ({ sql, body, tenantId, importV2 }) => { const c = await io(sql, tenantId, importV2); return run(c, c.viewers.find(v => v.id === body.actor) ?? null, body.args); },
  }])),
  load: async ({ sql, params: sp, tenantId: t, importV2 }) => {
    const c = await io(sql, t, importV2), viewer = c.viewers.find(v => v.id === sp.viewer) ?? c.viewers[0] ?? null;
    // 작성 폼이 열 때 읽는 2.0 loadMyTextbookMent(읽기라 GET) — 답은 글자 하나({ ment }).
    if (sp.ment) return { ment: await loadMyTextbookMent(c, viewer) };
    const common = { editors: editorsOf(c.viewers), viewer: viewer && { id: viewer.id, name: viewer.name, role: viewer.roleLabel },
      host: { operations: c.env.operations, disabledModules: c.env.disabled } };
    if (!viewer) return { ...common, route: 'none' };
    const [page, catalog, branding] = await Promise.all([
      readPage(sql, t, c.R, c.X, viewer),
      sql`select id::text id, title, book_detail, price from public.textbook_catalog where tenant_id=${t} and is_active order by title asc`,
      readBranding(sql, t, c.R),
    ]);
    return { ...common, route: 'page', ...page,
      catalog: catalog.map(r => ({ id: r.id, title: r.title, bookDetail: r.book_detail, price: r.price == null ? 0 : Number(r.price) })),
      // page.tsx가 읽는 설정 칸(이름 · 계좌 · 모듈) — 로고는 파일 저장소·바깥 주소라 싣지 않는다(logoUrl = null).
      settings: { profile: { name: branding.profile.name }, billing: branding.billing, modules: { disabled: c.env.disabled } }, logoUrl: null,
      user: { id: viewer.id, displayName: viewer.name } };
  },
};
