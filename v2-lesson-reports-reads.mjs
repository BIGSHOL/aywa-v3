// 2.0 화면 · 수업보고서 관리 — 목록·회수 면이 읽는 2.0 서버 조회 둘을 Docker 복사본에서(계약 = v2-screen-lesson-reports.mjs 머리 주석).
//  · listReports(features/report-admin/server/actions.ts) — 목록 첫 쪽(서버) + 면 안 클라 부품의 쪽 넘김·필터·정렬·학생 이름 검색(회수 면도 같은 함수).
//    클라에서 부르는 길 = 이 화면 GET 열쇠 `list`(필터를 JSON 한 덩어리로) + 호스트 registerHostHandler — readList.
//  · getReportFilterOptions(features/report-admin/server/queries.ts) — 강사·과목(최근 60일 보고서) · 반 목록 · 멘트 작성 방식 칸 유무.
// 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본은 RLS가 없어 모든 조회에 tenant_id를 직접 건다. 정렬 순서 = 2.0 reportOrderSpecs ·
// 평점 정렬 = 2.0 sortByRating · 평점 칸 = 2.0 parseRating(지금 기준 OWNER_RUBRIC_ID 줄만) · 안읽음 판정 절 = 2.0 UNREAD_MATCHABLE_OR 그대로(모양을 옮겨 SQL로).
// 화면 주인 = 원장(2.0 canWriteTenant('lesson_reports') = 평점을 본다). 오늘 = 복사본 날짜. · 읽기 전용 · 바깥 호출 없음.
import { studentsBase } from './v2-students-common.mjs';

const MODULES = {
  filters: 'features/report-admin/report-filters.ts', rating: 'features/report-admin/report-rating.ts',
  owner: 'features/report-rating/harness/owner.ts', ment: 'features/onescreen/ment-source.ts', unread: 'features/report-admin/unread-filter.ts',
};
let modsP = null;
const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)]))
  .then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

/** 2.0 actions.ts 상수 — 본문 그대로. */
export const REPORT_PAGE_SIZE = 30;
const STUDENT_SEARCH_CAP = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const daysBefore = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** 2.0 PostgREST `.or("a.not.is.null,b.is.null,b.neq.x")` → SQL. 모르는 모양이면 멈춘다(2.0 절이 바뀌면 조용히 다른 집합을 세지 않게). */
function postgrestOr(frag, clause) {
  const terms = clause.split(',').map((term) => {
    let m;
    if ((m = /^(\w+)\.not\.is\.null$/.exec(term))) return frag`${frag('r.' + m[1])} is not null`;
    if ((m = /^(\w+)\.is\.null$/.exec(term))) return frag`${frag('r.' + m[1])} is null`;
    if ((m = /^(\w+)\.neq\.([\w-]+)$/.exec(term))) return frag`${frag('r.' + m[1])} <> ${m[2]}`;
    throw new Error(`옮기지 않은 조건 모양입니다: ${term}`);
  });
  return terms.reduce((all, term) => frag`${all} or ${term}`);
}

/** 2.0 mentSourceColumnReady — lesson_reports.ment_source 칸이 있는가(0214a). */
async function mentSourceReady(sql) {
  const [row] = await sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='lesson_reports' and column_name='ment_source') ok`;
  return row.ok === true;
}

/** 2.0 getReportFilterOptions() — lesson_report_filter_options(p_since) RPC 본문(auth_tenant_id → 이 지점) · 반 목록 RPC가 없으면 2.0처럼 빈 목록. */
export async function reportFilterOptions(ctx) {
  const { sql, t, today } = ctx;
  const since = daysBefore(today, 60);
  const [main, cls, mentReady] = await Promise.all([
    sql`select distinct teacher_name, subject from public.lesson_reports
      where tenant_id=${t} and report_date >= ${since} and (teacher_name is not null or subject is not null)`,
    // 반 목록 RPC(lesson_report_class_options · 0147a)는 복사본에 없다 → 2.0은 오류를 로그로 남기고 반 목록 없이 그린다.
    // (함수가 생겨도 auth_tenant_id()가 이 조회엔 비어 늘 0행이다 — 부르지 않고 2.0이 실제로 그리는 빈 목록 그대로.)
    Promise.resolve([]),
    mentSourceReady(sql),
  ]);
  const classes = [];
  for (const r of cls ?? []) if (r.class_id && r.class_name) classes.push({ id: r.class_id, name: r.class_name });
  classes.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const teachers = new Set(), subjects = new Set();
  for (const r of main) { if (r.teacher_name) teachers.add(r.teacher_name); if (r.subject) subjects.add(r.subject); }
  return { teachers: [...teachers].sort(), subjects: [...subjects].sort(), classes, mentSourceReady: mentReady };
}

const LIST_COLS = (frag, mentReady) => frag`r.id::text id, r.student_id::text student_id, r.subject, r.report_date::text report_date,
  to_json(r.created_at)#>>'{}' created_at, to_json(r.classnote_sent_at)#>>'{}' classnote_sent_at, r.classnote_status::text classnote_status,
  to_json(r.classnote_read_at)#>>'{}' classnote_read_at, r.teacher_name, r.share_token, r.source, r.class_id::text class_id,
  ${mentReady ? frag`r.ment_source::text ment_source` : frag`null::text ment_source`}, c.class_name`;

/** 2.0 reportOrderSpecs → ORDER BY. `classes(class_name)`(to-one 임베드 정렬) = 조인한 반 이름 · 나머지는 보고서 칸. 빈 값은 늘 뒤. */
function orderBy(frag, specs) {
  return specs.map((o) => {
    const col = o.column === 'classes(class_name)' ? frag('c.class_name') : /^\w+$/.test(o.column) ? frag(`r.${o.column}`) : null;
    if (!col) throw new Error(`옮기지 않은 정렬 칸입니다: ${o.column}`);
    return frag`${col} ${o.ascending ? frag`asc` : frag`desc`} ${o.nullsFirst ? frag`nulls first` : frag`nulls last`}`;
  }).reduce((all, o) => frag`${all}, ${o}`);
}

/**
 * 2.0 listReports(filters) — 같은 거름·같은 정렬·같은 쪽(30건) · 같은 오류 문구.
 * ctx = { sql(queryGate), t, today, importV2, canSeeRatings }. 2.0이 DB 오류를 문구로 돌려주는 자리는 화면 실패(호스트가 2.0 실패 모양으로 바꾼다).
 */
export async function listReports(ctx, filters = {}) {
  const { sql, t } = ctx, frag = sql.frag, M = await mods(ctx.importV2);
  const page = Math.max(0, Number(filters.page) || 0);
  const canSeeRatings = M.rating.REPORT_RATING_VISIBLE ? ctx.canSeeRatings === true : false;
  const mentReady = await mentSourceReady(sql);

  let studentIds = null;
  if (typeof filters.student === 'string' && filters.student.trim()) {
    const term = filters.student.trim();
    const matched = await sql`select id::text id from public.students where tenant_id=${t} and name ilike ${`%${term}%`} limit ${STUDENT_SEARCH_CAP + 1}`;
    const sids = matched.map((s) => s.id);
    if (sids.length > STUDENT_SEARCH_CAP) return { ok: false, error: `"${term}"에 해당하는 학생이 너무 많습니다 — 이름을 더 입력해 주세요` };
    if (!sids.length) return { ok: true, rows: [], total: 0, page, pageSize: REPORT_PAGE_SIZE };
    studentIds = sids;
  }
  // 필터 JSON은 클라가 보낸 값 — 글자 칸에 글자가 아닌 값(배열 등)이 오면 거르지 않고 넘어가 필터 없이 전부를 세게 된다. 2.0은 그 값으로
  // 조회하다 실패해 humanizeDbError(…, '조회') 문구를 돌려준다 → 같은 문구로 막는다. 날짜는 형식 + 실제 날짜(2026-99-99는 2.0도 조회 실패).
  const BAD = { ok: false, error: '입력한 값이 올바르지 않아 조회하지 못했습니다 — 각 칸의 형식을 확인하세요' };
  for (const k of ['from', 'to', 'status', 'teacher', 'teacherName', 'subject', 'mentSource', 'student', 'read', 'sort', 'dir']) {
    if (filters[k] != null && typeof filters[k] !== 'string') return BAD;
  }
  if (filters.classId != null && typeof filters.classId !== 'string') return { ok: false, error: '반 필터 값이 올바르지 않습니다 — 뷰 설정에서 반을 다시 골라 주세요' };
  const realDay = (v) => { const d = new Date(`${v}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
  for (const k of ['from', 'to']) if (filters[k] && !realDay(filters[k])) return BAD;
  if (filters.classId && !UUID.test(filters.classId)) return { ok: false, error: '반 필터 값이 올바르지 않습니다 — 뷰 설정에서 반을 다시 골라 주세요' };
  let mentFilter;
  if (filters.mentSource) {
    mentFilter = M.ment.parseMentSource(filters.mentSource);
    if (!mentFilter) return { ok: false, error: '멘트 작성 방식 필터 값이 올바르지 않습니다 — 뷰 설정에서 다시 골라 주세요' };
    if (!mentReady) return { ok: false, error: '멘트 작성 방식 필터는 데이터베이스 업데이트(0214a) 적용 후 쓸 수 있습니다' };
  }

  const F = M.filters, U = M.unread, str = (v) => (typeof v === 'string' ? v : undefined);
  const conds = [frag`r.tenant_id = ${t}`];
  if (studentIds) conds.push(frag`r.student_id = any(${studentIds}::uuid[])`);
  if (str(filters.from)) conds.push(frag`r.report_date >= ${filters.from}`);
  if (str(filters.to)) conds.push(frag`r.report_date <= ${filters.to}`);
  if (filters.status === F.IMPORT_FILTER) conds.push(frag`r.source = 'edutrix_import'`);
  else if (filters.status === F.UNSENT_FILTER) conds.push(frag`r.classnote_status is null and (r.source is null or r.source <> 'edutrix_import')`);
  else if (str(filters.status)) conds.push(frag`r.classnote_status::text = ${filters.status}`);
  if (str(filters.teacher)) conds.push(frag`r.teacher_name = ${filters.teacher}`);
  if (str(filters.teacherName)?.trim()) {
    const term = filters.teacherName.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    conds.push(frag`r.teacher_name ilike ${`%${term}%`}`);
  }
  if (str(filters.subject)) conds.push(frag`r.subject = ${filters.subject}`);
  if (str(filters.classId)) conds.push(frag`r.class_id = ${filters.classId}::uuid`);
  if (mentFilter) conds.push(frag`r.ment_source::text = ${mentFilter}`);
  if (filters.read === 'read') conds.push(frag`r.classnote_read_at is not null`);
  else if (filters.read === 'unread')
    conds.push(frag`r.classnote_status::text = ${U.SENT_STATUS_SUCCESS} and r.classnote_read_at is null and (${postgrestOr(frag, U.UNREAD_MATCHABLE_OR)})`);
  const where = conds.reduce((all, c) => frag`${all} and ${c}`);
  const from = frag`public.lesson_reports r left join public.classes c on c.id = r.class_id`;

  let list, total;
  if (filters.sort === 'rating' && canSeeRatings) {
    const [order, pointRows] = await Promise.all([
      sql`select r.id::text id, r.report_date::text report_date, to_json(r.created_at)#>>'{}' created_at from ${from} where ${where} order by r.id`,
      sql.soft((sp) => sp`select report_id::text report_id, points from public.lesson_report_ratings where tenant_id=${t} and rubric=${M.owner.OWNER_RUBRIC_ID}`, []),
    ]);
    const points = new Map();
    for (const r of pointRows) { const n = typeof r.points === 'number' ? r.points : Number(r.points); if (Number.isFinite(n) && n >= 0 && n <= 5) points.set(r.report_id, n); }
    const sorted = F.sortByRating(order, points, filters.dir ?? 'asc');
    total = sorted.length;
    const pageIds = sorted.slice(page * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE + REPORT_PAGE_SIZE).map((r) => r.id);
    if (!pageIds.length) return { ok: true, rows: [], total, page, pageSize: REPORT_PAGE_SIZE };
    const got = await sql`select ${LIST_COLS(frag, mentReady)} from ${from} where ${where} and r.id = any(${pageIds}::uuid[])`;
    const at = new Map(pageIds.map((id, i) => [id, i]));
    list = got.sort((x, y) => (at.get(x.id) ?? 0) - (at.get(y.id) ?? 0));
  } else {
    const [rows, [{ n }]] = await Promise.all([
      sql`select ${LIST_COLS(frag, mentReady)} from ${from} where ${where} order by ${orderBy(frag, F.reportOrderSpecs(filters.sort, filters.dir))}
        limit ${REPORT_PAGE_SIZE} offset ${page * REPORT_PAGE_SIZE}`,
      sql`select count(*)::int n from ${from} where ${where}`,
    ]);
    list = rows; total = n;
  }
  const ids = [...new Set(list.map((r) => r.student_id))];
  const [nameRows, ratingRows] = await Promise.all([
    ids.length ? sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${ids}::uuid[])` : [],
    canSeeRatings && list.length
      ? sql.soft((sp) => sp`select report_id::text report_id, points, items, parent_feeling, suggestion, claim, claim_reason, rated_on::text rated_on
          from public.lesson_report_ratings where tenant_id=${t} and rubric=${M.owner.OWNER_RUBRIC_ID} and report_id = any(${list.map((r) => r.id)}::uuid[])`, [])
      : [],
  ]);
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const ratingById = new Map();
  for (const row of ratingRows) { const r = M.rating.parseRating(row); if (r) ratingById.set(row.report_id, r); }
  const rows = list.map((r) => ({
    id: r.id, studentName: nameById.get(r.student_id) ?? '(학생)', subject: r.subject, className: r.class_name ?? null,
    reportDate: r.report_date, createdAt: r.created_at, sentAt: r.classnote_sent_at, classnoteStatus: r.classnote_status,
    teacherName: r.teacher_name, shareToken: r.share_token, source: r.source, readAt: r.classnote_read_at, mentSource: r.ment_source ?? null,
    ...(canSeeRatings ? { rating: ratingById.get(r.id) ?? null } : {}),
  }));
  return { ok: true, rows, total, page, pageSize: REPORT_PAGE_SIZE };
}

/** 면 모듈이 쓰는 문맥 — 화면 문맥(ctx)에서 보는 사람의 평점 권한(2.0 canWriteTenant('lesson_reports')) 포함. */
export const readCtx = (ctx) => ({ sql: ctx.sql, t: ctx.t, today: ctx.today, importV2: ctx.importV2, canSeeRatings: ctx.gates.canSendReports });

/**
 * 화면 GET 열쇠 `list`(클라 부품의 listReports 한 번) — 2.0 listReports의 앞단(로그인 · lesson_reports 권한) 그대로 본 뒤 같은 조회.
 * 필터 JSON이 깨졌으면 2.0이 받을 수 없는 값이라 실패 모양으로 답한다.
 */
export async function readList({ sql: tx, tenantId: t, importV2, list, viewerId = null }) {
  let filters;
  try { filters = JSON.parse(list); } catch { filters = null; }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return { ok: false, error: '조회 조건을 읽지 못했습니다' };
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer) return { ok: false, error: '로그인이 필요합니다' };
  if (base.level('lesson_reports') === 'none') return { ok: false, error: '보고서 관리 권한이 없습니다' };
  const canSeeRatings = ['full', 'scoped'].includes(base.level('lesson_reports'));
  return listReports({ sql: base.sql, t, today: base.today, importV2: base.load, canSeeRatings }, filters);
}
