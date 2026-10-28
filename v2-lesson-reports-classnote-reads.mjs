// 2.0 화면 · 수업보고서 관리 — 클래스노트 면 다섯(발송 큐 · 반 구성 · 반 공지 · 직접 발송 · 학부모 글·답글)이 읽는 값. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// 2.0 서버 함수를 Docker 복사본에서 그대로:
//  · getClassnoteQueue(report-admin/server/queries.ts) · getBoardRosterCheck(board-roster-queries.ts) · getNoticeClassOptions · listClassNotices
//    (notice-actions.ts) · listClassWideNotices(class-notice-actions.ts) · listParentThreads(classnote-reply/server/reply-queries.ts).
//  · 판정·모양은 2.0 순수 함수(classnote-queue · unsent-sendable · worker-results · classnote-guard · absence-gate · english-writing ·
//    board-roster-diff · notice-links · class-notice · reply-policy · reaction-policy · thread-video). 서버 전용 도우미(결석 게이트 조회 ·
//    미발송 반 · 반 보드 이름 · 글 사진 거르기 · 공감 준비)는 같은 본문을 SQL로 옮겼다.
//  · '지금' = 복사본을 뜬 시각(clock.at) · '오늘' = 복사본 날짜 — 2.0 Date.now()·kstToday 자리.
//  · 2.0은 사용자 클라이언트(RLS)·admin 클라이언트로 이 지점 줄만 읽는다 — 복사본은 RLS가 없어 모든 조회에 tenant_id를 직접 건다.
//  · 화면이 보는 것은 복사본 표(발송 큐 행 · 반 보드 · 공지 행 · 학부모 글 미러 · 연동 PC 상태 행)뿐 — ClassNote · 연동 PC를 부르지 않는다.
// · 읽기 전용 · 바깥 호출 없음.
import { studentsBase } from './v2-students-common.mjs';

const MODULES = {
  gate: 'features/owner/classnote-gate.ts', queue: 'features/report-admin/classnote-queue.ts', unsent: 'features/report-admin/unsent-sendable.ts',
  worker: 'features/report-admin/worker-results.ts', guard: 'features/onescreen/classnote-guard.ts', absence: 'features/onescreen/absence-gate.ts',
  english: 'features/report-admin/english-writing.ts', roster: 'features/report-admin/board-roster-diff.ts', links: 'features/onescreen/notice-links.ts',
  classNotice: 'features/report-admin/class-notice.ts', reply: 'features/classnote-reply/reply-policy.ts',
  reaction: 'features/classnote-reply/reaction-policy.ts', video: 'features/classnote-reply/thread-video.ts',
};
let modsP = null;
export const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)]))
  .then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

/** timestamptz → 2.0(PostgREST)이 내려주는 글자 모양 그대로. */
const TS = (col) => `to_json(${col})#>>'{}'`;
/** 글자 그대로의 SQL 조각 — 관문(queryGate)이면 그 트랜잭션의 것, 저장점(sp)이면 그대로. */
const raw = (s, text) => (s.frag ?? s).unsafe(text);
// 2.0 queries.ts 날짜 도우미 — 본문 그대로.
const daysBefore = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const numOrNull = (v) => (v == null ? null : Number(v));

// ── 발송 큐(getClassnoteQueue) ─────────────────────────────────────────────────────────────────────────────────────────
const WORKER_OFFLINE_MINUTES = 3;
const EXPIRED_GRACE_DAYS = 3;
const QUEUE_COLS = (sql) => raw(sql, `id::text id, student_id::text student_id, subject, report_date::text report_date, classnote_status, classnote_error,
  ${TS('classnote_processing_at')} classnote_processing_at, share_token`);

/** 2.0 absenceKeyOf(onescreen/server/absence-gate.ts) — 본문 그대로. */
export const absenceKeyOf = (k) => `${k.studentId}|${k.reportDate}|${k.classId ? `c:${k.classId}` : `s:${k.subject ?? ''}`}`;

/** 2.0 getAbsenceBlockedKeys — 그날 출결 전건(학생 × 날짜) → 반 · 과목 두 축으로 묶어 2.0 isAbsentForSend. 조회 실패는 throw(2.0과 같다). */
async function absenceBlockedKeys(sql, t, M, keys) {
  const usable = keys.filter((k) => k.classId || k.subject);
  if (usable.length === 0) return new Set();
  const studentIds = [...new Set(usable.map((k) => k.studentId))], dates = [...new Set(usable.map((k) => k.reportDate))];
  const records = await sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, status::text status,
      ${raw(sql, TS('recorded_at'))} recorded_at
    from public.attendance_records where tenant_id=${t} and session_date = any(${dates}::date[]) and student_id = any(${studentIds}::uuid[]) order by id`;
  if (records.length === 0) return new Set();
  const classIds = [...new Set(records.map((r) => r.class_id))];
  const classes = await sql`select id::text id, subject from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`;
  const subjectByClass = new Map(classes.map((c) => [c.id, c.subject]));
  const byKey = new Map();
  const push = (key, rec) => (byKey.get(key) ?? byKey.set(key, []).get(key)).push(rec);
  for (const rec of records) {
    const date = rec.session_date.slice(0, 10), gateRec = { classId: rec.class_id, status: rec.status, recordedAt: rec.recorded_at, id: rec.id };
    push(`${rec.student_id}|${date}|c:${rec.class_id}`, gateRec);
    const subject = subjectByClass.get(rec.class_id);
    if (subject) push(`${rec.student_id}|${date}|s:${subject}`, gateRec);
  }
  const blocked = new Set();
  for (const k of usable) {
    const id = absenceKeyOf(k), list = byKey.get(id);
    if (list && M.absence.isAbsentForSend(list)) blocked.add(id);
  }
  return blocked;
}

/** 2.0 fetchReportOptoutClassIds — 수업보고서를 안 보내는 반(상한 500). */
const optoutClassIds = async (sql, t) =>
  new Set((await sql`select id::text id from public.classes where tenant_id=${t} and report_optout = true limit 500`).map((c) => c.id));

/** 2.0 loadSendableUnsent — 저장만 하고 안 보낸 보고서 중 지금 보낼 수 있는 건. 어느 조회든 실패하면 null(2.0 try/catch). */
async function sendableUnsent(sql, t, M, today, classnoteSubjects) {
  return sql.soft(async (sp) => {
    const minDate = M.guard.classnoteMinDate(today);
    const raw = await sp`select id::text id, student_id::text student_id, subject, report_date::text report_date, class_id::text class_id, makeup, notes
      from public.lesson_reports where tenant_id=${t} and classnote_status is null and revoked_at is null
        and (source is null or source <> 'edutrix_import') and report_date >= ${minDate} order by report_date, id`;
    if (raw.length === 0) return { count: 0, oldestDate: null };
    const rows = raw.map((r) => ({ id: r.id, studentId: r.student_id, reportDate: String(r.report_date).slice(0, 10), subject: r.subject,
      classId: r.class_id, makeup: r.makeup, ment: r.notes }));
    const [optout, blocked] = await Promise.all([optoutClassIds(sp, t), absenceBlockedKeys(sp, t, M, rows.filter((r) => !r.makeup)
      .map((r) => ({ studentId: r.studentId, reportDate: r.reportDate, subject: r.subject, classId: r.classId })))]);
    const sendable = M.unsent.filterUnsentSendable(rows, { today, classnoteSubjects, optoutClassIds: optout, absenceBlockedKeys: blocked,
      absenceKeyOf: (r) => absenceKeyOf({ studentId: r.studentId, reportDate: r.reportDate, subject: r.subject, classId: r.classId }) });
    return { count: sendable.length, oldestDate: sendable.length > 0 ? sendable[0].reportDate : null };
  }, null);
}

/** 2.0 getClassnoteQueue(days) — 모양 그대로(ClassnoteQueueView). ClassNote 모듈이 꺼지면 null. */
export async function classnoteQueue(base, days = 3) {
  const { sql, t, settings, today } = base;
  const M = await mods(base.load);
  if (!M.gate.classnoteModuleOn(settings)) return null;
  const since = daysBefore(today, days), nowMs = base.clock.at.getTime(), minDate = M.guard.classnoteMinDate(today);
  const cols = QUEUE_COLS(sql);
  const [rowsRaw, stuckRaw, failedRaw, [{ n: expiredUnsentCount }]] = await Promise.all([
    sql`select ${cols} from public.lesson_reports where tenant_id=${t} and report_date >= ${since} and classnote_status is not null
      order by report_date desc limit 1000`,
    sql`select ${cols} from public.lesson_reports where tenant_id=${t} and classnote_status = any(${[...M.queue.HUMAN_RESOLVED_STATUSES]}::text[])
      order by report_date desc limit 200`,
    sql`select ${cols} from public.lesson_reports where tenant_id=${t} and classnote_status = 'failed' and report_date >= ${daysBefore(minDate, EXPIRED_GRACE_DAYS)}
      order by report_date desc limit 200`,
    sql`select count(*)::int n from public.lesson_reports where tenant_id=${t} and classnote_status in ('failed', 'too_old')
      and report_date < ${minDate} and report_date >= ${daysBefore(today, 30)}`,
  ]);
  const byId = new Map();
  for (const r of [...rowsRaw, ...stuckRaw, ...failedRaw]) byId.set(r.id, r);
  const rows = [...byId.values()].sort((a, b) => String(b.report_date ?? '').localeCompare(String(a.report_date ?? '')));
  const summary = M.queue.summarizeQueue(rows.map((r) => ({ status: r.classnote_status, processingAt: r.classnote_processing_at })), nowMs);
  const attention = rows.filter((r) => M.queue.needsAttention(r.classnote_status, r.classnote_processing_at, nowMs)).slice(0, 100);
  const pendingRows = rows.filter((r) => (r.classnote_status === 'queued' || r.classnote_status === 'processing')
    && !M.queue.needsAttention(r.classnote_status, r.classnote_processing_at, nowMs)).slice(0, 100);
  const ids = [...new Set([...attention, ...pendingRows].map((r) => r.student_id))];
  const [nameRows, wk, unsent] = await Promise.all([
    ids.length ? sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${ids}::uuid[])` : [],
    sql`select hostname, ${raw(sql, TS('last_seen'))} last_seen, last_results from public.classnote_workers where tenant_id=${t}`,
    sendableUnsent(sql, t, M, today, settings.report.classnoteSubjects),
  ]);
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const toItem = (r) => ({ id: r.id, studentName: nameById.get(r.student_id) ?? '(학생)', subject: r.subject, reportDate: r.report_date,
    status: r.classnote_status, error: r.classnote_error, processingAt: r.classnote_processing_at, shareToken: r.share_token });
  const workers = wk.map((w) => {
    const mins = Math.floor((nowMs - Date.parse(w.last_seen)) / 60_000);
    return { hostname: w.hostname, lastSeenMinutes: Math.max(0, mins), online: mins < WORKER_OFFLINE_MINUTES,
      results: M.worker.formatWorkerResults(w.last_results), env: M.worker.extractWorkerEnv(w.last_results), nativePublish: M.worker.workerSupportsNativePublish(w.last_results) };
  });
  return { summary, items: attention.map(toItem), pending: pendingRows.map(toItem), workers, nowMs, since, days,
    sendEnabled: M.gate.classnoteSendOn(settings), expiredUnsent: expiredUnsentCount ?? 0, todayKst: today,
    unsentSendable: unsent ? unsent.count : null, unsentOldestDate: unsent?.oldestDate ?? null };
}

// ── 반 구성(getBoardRosterCheck) ───────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getBoardRosterCheck(subject) — 영어 반 명단 ↔ ClassNote 반 보드 원아(동기화 사본). 모듈이 꺼지면 null. */
export async function boardRosterCheck(base, canLink, subject = 'english') {
  const { sql, t, settings, today } = base;
  const M = await mods(base.load);
  if (!M.gate.classnoteModuleOn(settings)) return null;
  const [boardRows, memberRows, classRows, enrRows, linkRows] = await Promise.all([
    sql`select board_id, board_name, ${raw(sql, TS('synced_at'))} synced_at from public.classnote_boards where tenant_id=${t} order by board_id`,
    sql`select board_id, child_id, child_name, birth_year from public.classnote_board_members where tenant_id=${t} order by board_id, child_id`,
    sql`select c.id::text id, c.class_name, u.display_name teacher from public.classes c left join public.users u on u.id = c.teacher_id
      where c.tenant_id=${t} and c.subject=${subject} and c.is_active and c.report_optout = false order by c.id`,
    sql`select e.class_id::text class_id, e.end_date::text end_date, s.id::text id, s.name, s.classnote_name, s.grade, s.status::text status, s.is_test
      from public.enrollments e join public.classes c on c.id = e.class_id left join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and c.subject=${subject} and c.is_active and c.report_optout = false order by e.id`,
    sql`select student_id::text student_id, board_id, child_id, child_name_at_link from public.classnote_student_links where tenant_id=${t}`,
  ]);
  const syncedAt = boardRows.reduce((acc, b) => (b.synced_at && (!acc || b.synced_at > acc) ? b.synced_at : acc), null);
  if (!boardRows.length) return { checks: [], summary: M.roster.summarize([]), syncedAt: null, canLink };
  const membersByBoard = new Map();
  for (const m of memberRows) {
    const id = Number(m.board_id);
    (membersByBoard.get(id) ?? membersByBoard.set(id, []).get(id)).push({ childId: Number(m.child_id), childName: m.child_name, birthYear: numOrNull(m.birth_year) });
  }
  const boards = boardRows.map((b) => ({ boardId: Number(b.board_id), boardName: b.board_name, members: membersByBoard.get(Number(b.board_id)) ?? [] }));
  const links = linkRows.map((l) => ({ studentId: l.student_id, boardId: Number(l.board_id), childId: Number(l.child_id), childNameAtLink: l.child_name_at_link }));
  const enrByClass = new Map();
  for (const e of enrRows) (enrByClass.get(e.class_id) ?? enrByClass.set(e.class_id, []).get(e.class_id)).push(e);
  const classes = classRows.map((c) => {
    const seen = new Set();
    const students = (enrByClass.get(c.id) ?? [])
      .filter((e) => (!e.end_date || e.end_date >= today) && e.id && e.status === 'enrolled' && !e.is_test)
      .map((e) => ({ studentId: e.id, name: (e.classnote_name?.trim() || e.name || '').trim(), grade: e.grade }))
      .filter((s) => { if (!s.name || seen.has(s.studentId)) return false; seen.add(s.studentId); return true; })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { classId: c.id, className: c.class_name, teacher: c.teacher ?? null, students };
  });
  const checks = M.roster.checkClassRosters(classes, boards, { class: M.english.classKey, board: M.english.boardKey },
    { links, schoolYear: M.roster.kstSchoolYear(base.clock.at) })
    .sort((a, b) => b.problems - a.problems || a.className.localeCompare(b.className, 'ko'));
  return { checks, summary: M.roster.summarize(checks), syncedAt, canLink };
}

// ── 반 공지 · 직접 발송의 반 목록 ───────────────────────────────────────────────────────────────────────────────────────
const MODULE_OFF = { ok: false, error: '사용할 수 없는 기능입니다' };
const NO_ACCESS = { ok: false, error: '권한이 없습니다' };

/** 2.0 getNoticeClassOptions — 공지 대상 반(발송 과목의 활성 반 · 지금 수강생이 있는 반만). 실패는 2.0 안내 문구. */
export async function noticeClassOptions(base, canAccess) {
  const { sql, t, settings } = base;
  const M = await mods(base.load);
  if (!canAccess) return NO_ACCESS;
  if (!M.gate.classnoteModuleOn(settings)) return MODULE_OFF;
  const allowed = settings.report.classnoteSubjects;
  if (!allowed.length) return { ok: true, classes: [] };
  return sql.soft(async (sp) => {
    const classes = await sp`select id::text id, class_name, subject, report_optout from public.classes
      where tenant_id=${t} and is_active and subject = any(${allowed}::text[]) order by class_name, id`;
    const ids = classes.map((c) => c.id);
    const enr = ids.length ? await sp`select class_id::text class_id, student_id::text student_id from public.enrollments
      where tenant_id=${t} and class_id = any(${ids}::uuid[]) and end_date is null order by id` : [];
    const studentIds = [...new Set(enr.map((e) => e.student_id))];
    const studentRows = studentIds.length ? await sp`select id::text id, name, grade from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : [];
    const studentById = new Map(studentRows.map((s) => [s.id, s]));
    const rosterByClass = new Map();
    for (const e of enr) {
      const s = studentById.get(e.student_id);
      if (s) (rosterByClass.get(e.class_id) ?? rosterByClass.set(e.class_id, []).get(e.class_id)).push({ id: s.id, name: s.name, grade: s.grade });
    }
    return { ok: true, classes: classes.map((c) => {
      const roster = rosterByClass.get(c.id) ?? [];
      return { id: c.id, name: c.class_name, subject: c.subject, reportOptout: c.report_optout === true, studentCount: roster.length, students: roster };
    }).filter((c) => c.studentCount > 0) };
  }, { ok: false, error: '공지 대상 반 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요' });
}

/** 2.0 listClassNotices — 원생 개별 공지 최근 20건(발송 큐 행의 결과 · 학생 이름 · 보고서 링크 · 수정/회수 가능). */
export async function classNotices(base, canAccess) {
  const { sql, t, settings } = base;
  const M = await mods(base.load);
  if (!canAccess) return NO_ACCESS;
  if (!M.gate.classnoteModuleOn(settings)) return MODULE_OFF;
  const data = await sql.soft((sp) => sp`select id::text id, body, targets, status, results, error, ${raw(sp, TS('created_at'))} created_at,
      ${raw(sp, TS('processed_at'))} processed_at from public.classnote_notices where tenant_id=${t} order by created_at desc limit 20`, null);
  if (!data) return { ok: false, error: '조회에 실패했습니다' };
  return { ok: true, rows: data.map((r) => {
    const nameByBoard = new Map();
    if (Array.isArray(r.targets)) for (const x of r.targets) if (typeof x?.board === 'string' && typeof x?.studentName === 'string') nameByBoard.set(x.board, x.studentName);
    const results = r.results ?? null;
    return { id: r.id, body: r.body, targetCount: Array.isArray(r.targets) ? r.targets.length : 0, status: r.status,
      results: results ? results.map((x) => ({ ...x, studentName: nameByBoard.get(x.board) ?? M.links.boardStudentName(x.board ?? '') })) : null,
      reportLinks: M.links.flattenNoticeReportLinks(r.results, r.targets), ...M.links.noticePostedActions(r.status, r.results, r.targets),
      error: r.error, createdAt: r.created_at, processedAt: r.processed_at };
  }) };
}

/** 2.0 listClassWideNotices — 반 단체 공지 최근 20건 + 반 보드가 연결된 반. */
export async function classWideNotices(base, canAccess) {
  const { sql, t, settings } = base;
  const M = await mods(base.load);
  if (!canAccess) return NO_ACCESS;
  if (!M.gate.classnoteModuleOn(settings)) return MODULE_OFF;
  const [data, boards] = await Promise.all([
    sql.soft((sp) => sp`select id::text id, title, targets, is_test, status, results, error, ${raw(sp, TS('created_at'))} created_at
      from public.classnote_class_notices where tenant_id=${t} order by created_at desc limit 20`, null),
    sql.soft((sp) => sp`select class_id::text class_id from public.classnote_class_boards where tenant_id=${t}`, []),
  ]);
  if (!data) return { ok: false, error: '조회에 실패했습니다' };
  return { ok: true, boardClassIds: boards.map((b) => b.class_id), rows: data.map((r) => ({
    id: r.id, title: r.title, classNames: M.classNotice.classNoticeClassNames(r.targets, !!r.is_test),
    imageCount: M.classNotice.classNoticeAttachmentsOf(r.targets).length, isTest: !!r.is_test, status: r.status,
    failures: (r.results ?? []).filter((x) => x && x.ok === false).map((x) => `${x.className ?? '?'}: ${x.note ?? '실패'}`),
    error: r.error ?? null, createdAt: r.created_at,
  })) };
}

// ── 직접 발송의 학생 고르기(getStudentsList({ status: 'enrolled' })) ─────────────────────────────────────────────────────
/** 화면이 쓰는 칸(id · 이름 · 학교 · 학년)만 — 2.0 목록 순서(학년 → 이름 → id). 다른 거르기가 없어 수강 조회는 행을 바꾸지 않는다. */
export const enrolledStudents = (base) => base.sql`select id::text id, name, school, grade from public.students
  where tenant_id=${base.t} and status::text = 'enrolled' order by grade, name, id`;

// ── 학부모 글·답글(listParentThreads) ──────────────────────────────────────────────────────────────────────────────────
export const PARENT_THREAD_DAYS = 14;
export const PARENT_THREAD_LIMIT = 100;

/** 2.0 sanitizePhotos(classnote-reply/server/thread-data.ts) — https · 카카오 주소만 · 10장까지. */
function sanitizePhotos(raw) {
  const https = (v) => {
    try {
      const u = typeof v === 'string' ? new URL(v) : null;
      return u && u.protocol === 'https:' && /(^|\.)(kakao\.com|kakaocdn\.net)$/i.test(u.hostname) ? u.href : null;
    } catch { return null; }
  };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    const o = x ?? {}, large = https(o.large), small = https(o.small) ?? large;
    return large && small ? [{ small, large, width: num(o.width), height: num(o.height) }] : [];
  }).slice(0, 10);
}

/** 2.0 toMessage(reply-data.ts). */
const toMessage = (r) => ({
  id: String(r.id), source: r.source === 'comment' ? 'comment' : 'post', classnotePostId: Number(r.classnote_post_id),
  classnoteCommentId: r.classnote_comment_id == null ? null : Number(r.classnote_comment_id), childId: r.child_id == null ? null : Number(r.child_id),
  studentId: r.student_id ?? null, boardName: r.class_name ?? null, content: String(r.content ?? ''), postedAt: r.posted_at ?? null,
});

/** 2.0 toReactionView(reaction-data.ts) — 순수 판정은 reaction-policy 그대로. */
function toReactionView(M, messageId, row, user, manager, readonly = false) {
  if (!row) return { messageId, typeLabel: null, statusLabel: null, tone: 'inert', pressed: false, busy: false, by: null, error: null, errorRaw: null, canPress: !readonly, canRemove: false };
  const v = M.reaction.reactionStatusView({ status: row.status, processingAction: row.processingAction, error: row.error, failedAction: row.failedAction, unconfirmed: row.unconfirmed });
  return {
    messageId, typeLabel: M.reaction.isReactionType(row.reactionType) ? M.reaction.REACTION_LABELS[row.reactionType] : null, statusLabel: v.label, tone: v.tone,
    pressed: v.pressed, busy: v.busy, by: row.authorLabel || null, error: row.error, errorRaw: row.errorRaw,
    canPress: !readonly && M.reaction.canPressReaction(row.status),
    canRemove: !readonly && M.reaction.canRemoveReaction({ userId: user.id, role: user.systemRole, manager, authorUserId: row.authorUserId, status: row.status, unconfirmed: row.unconfirmed }),
  };
}

/** 2.0 reactionReady + loadReactions — 공감 표가 있고 연동 PC가 공감을 받는다고 알렸을 때만(못 읽으면 null = 공감 칸 없음). */
async function reactions(sql, t, M, ids, nowMs) {
  return sql.soft(async (sp) => {
    const [, workers] = await Promise.all([
      sp`select id from public.classnote_parent_reactions where tenant_id=${t} limit 1`,
      sp`select ${raw(sp, TS('last_seen'))} last_seen, last_results from public.classnote_workers where tenant_id=${t}`,
    ]);
    if (!M.reply.workerReadyForReplies(workers, nowMs, 'parentReaction')) return null;
    if (!ids.length) return new Map();
    const rows = await sp`select id::text id, message_id::text message_id, reaction_type, author_user_id::text author_user_id, author_label, status,
        processing_action, error, error_raw, failed_action, classnote_reaction_id, unconfirmed
      from public.classnote_parent_reactions where tenant_id=${t} and message_id = any(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.message_id, { id: r.id, messageId: r.message_id, reactionType: String(r.reaction_type ?? ''), authorUserId: r.author_user_id ?? null,
      authorLabel: String(r.author_label ?? ''), status: r.status, processingAction: r.processing_action ?? null, error: r.error ?? null, errorRaw: r.error_raw ?? null,
      failedAction: r.failed_action ?? null, reactionId: numOrNull(r.classnote_reaction_id), unconfirmed: r.unconfirmed === true }]));
  }, null);
}

/** 2.0 countThreadMedia — 글마다 영상(숙제 영상 보관 행) · 사진(글 첨부 사본) 수. 각 조회 실패는 0으로(2.0 .catch(() => [])). */
async function threadMedia(sql, t, M, messages) {
  const out = new Map();
  if (!messages.length) return out;
  const slot = (id) => out.get(id) ?? out.set(id, { videos: 0, photos: 0 }).get(id);
  const postIds = [...new Set(messages.map((m) => String(m.classnotePostId)))];
  const [vids, photos] = await Promise.all([
    sql.soft((sp) => sp`select post_id, comment_id, student_id::text student_id from public.student_homework_videos
      where tenant_id=${t} and post_id::text = any(${postIds}::text[])`, []),
    sql.soft((sp) => sp`select message_id::text message_id, attachments from public.classnote_parent_message_attachments
      where tenant_id=${t} and message_id = any(${messages.map((m) => m.id)}::uuid[])`, []),
  ]);
  for (const m of messages) {
    const mine = (v) => (m.studentId ? M.video.videoBelongsToThread(v.student_id, { studentId: m.studentId, allowUnmatched: m.childId != null }) : true);
    const n = vids.filter((v) => Number(v.post_id) === m.classnotePostId && mine(v)
      && (m.source === 'post' ? v.comment_id == null : v.comment_id != null && Number(v.comment_id) === m.classnoteCommentId)).length;
    if (n) slot(m.id).videos = n;
  }
  for (const p of photos) {
    const n = sanitizePhotos(p.attachments).length;
    if (n) slot(p.message_id).photos = n;
  }
  return out;
}

/** 2.0 uniqueClassBoardNames — 이 이름의 반 보드가 딱 하나인 이름만(괄호로 시작하는 1인 보드 이름은 뺀다). */
async function uniqueClassBoardNames(sql, t, boardNames) {
  const names = [...new Set(boardNames.map((n) => (n ?? '').trim()).filter((n) => n && !/^[([]/.test(n)))];
  if (!names.length) return new Set();
  const rows = await sql`select board_name from public.classnote_class_boards where tenant_id=${t} and board_name = any(${names}::text[])`;
  const count = new Map();
  for (const r of rows) count.set(r.board_name, (count.get(r.board_name) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n === 1).map(([name]) => name));
}

/** 2.0 listParentThreads({ mode, user, page }) — 최근 14일 학부모 글(사본) + 답글 상태 · 답글 가능 · 공감 · 영상/사진 수. 조회 실패는 throw(화면이 null로 그린다). */
export async function parentThreads(base, { mode, page: pageParam }) {
  const { sql, t, viewer } = base;
  const M = await mods(base.load);
  const nowMs = base.clock.at.getTime();
  const since = new Date(nowMs - PARENT_THREAD_DAYS * 86_400_000).toISOString();
  const [{ n: count }] = await sql`select count(*)::int n from public.classnote_parent_messages where tenant_id=${t} and posted_at >= ${since}`;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PARENT_THREAD_LIMIT));
  const requested = Number(pageParam);
  const page = Math.min(totalPages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const from = (page - 1) * PARENT_THREAD_LIMIT;
  const data = await sql`select id::text id, source, classnote_post_id, classnote_comment_id, child_id, student_id::text student_id, class_name, content,
      ${raw(sql, TS('posted_at'))} posted_at
    from public.classnote_parent_messages where tenant_id=${t} and posted_at >= ${since}
    order by posted_at desc, id desc limit ${PARENT_THREAD_LIMIT} offset ${from}`;
  const messages = data.map(toMessage), ids = messages.map((m) => m.id);
  const studentIds = [...new Set(messages.map((m) => m.studentId).filter(Boolean))];
  const [replies, students, reactionMap, classBoards, media] = await Promise.all([
    sql.soft(async (sp) => ({ ok: true, rows: ids.length ? await sp`select message_id::text message_id, status, ${raw(sp, TS('edited_at'))} edited_at, error,
        failed_action, ${raw(sp, TS('created_at'))} created_at from public.classnote_parent_replies where tenant_id=${t} and message_id = any(${ids}::uuid[])` : [] }),
      { ok: false, rows: [] }),
    studentIds.length ? sql.soft((sp) => sp`select id::text id, name, classnote_name from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])`, []) : [],
    reactions(sql, t, M, ids, nowMs),
    mode === 'on' ? sql.soft((sp) => uniqueClassBoardNames(sp, t, messages.map((m) => m.boardName)), new Set()) : new Set(),
    threadMedia(sql, t, M, messages),
  ]);
  // 원장 = 답글 관리 역할(2.0 isReplyManager) · 읽기 전용 강사 보기가 아니다(3.0엔 강사 보기 전환이 없다).
  const user = { id: viewer.id, systemRole: viewer.systemRole };
  const manager = M.reply.isReplyManager(viewer.systemRole) || !!viewer.isSuperAdmin, readonly = false;
  const nameOf = new Map(students.map((s) => [s.id, (s.classnote_name || s.name || '').trim() || null]));
  const byMessage = new Map();
  for (const r of replies.rows) (byMessage.get(r.message_id) ?? byMessage.set(r.message_id, []).get(r.message_id)).push(r);
  const rows = messages.map((m) => {
    const list = (byMessage.get(m.id) ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at));
    const last = list[list.length - 1];
    const v = last ? M.reply.replyStatusView({ status: last.status, editedAt: last.edited_at, error: last.error, failedAction: last.failed_action }) : null;
    const target = M.reply.replyTargetAllowed(mode, { boardName: m.boardName, childId: m.childId });
    const replyable = replies.ok && target.ok
      && M.reply.replyBoardKnown({ mode, testBoardId: target.boardId, boardIsClass: classBoards.has((m.boardName ?? '').trim()), boardName: m.boardName });
    return {
      messageId: m.id, source: m.source, boardName: m.boardName, studentName: m.studentId ? (nameOf.get(m.studentId) ?? null) : null,
      content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content, postedAt: m.postedAt,
      replyCount: list.filter((r) => r.status !== 'deleted').length, latest: v ? { label: v.label, tone: v.tone } : null,
      replyable, media: media.get(m.id) ?? { videos: 0, photos: 0 },
      reaction: replyable && reactionMap ? toReactionView(M, m.id, reactionMap.get(m.id) ?? null, user, manager, readonly) : null,
    };
  });
  return { rows, page, totalPages, total: count ?? rows.length, days: PARENT_THREAD_DAYS, replyReady: replies.ok, testOnly: mode === 'test' };
}

// ── 지금 반 보드 동기화 버튼 상태(getClassnoteSyncStatus — report-admin/server/classnote-sync-actions.ts) ──────────────────────
const SYNC_MODULES = { sync: 'features/report-admin/classnote-sync.ts', report: 'features/report-admin/classnote-sync-report.ts',
  release: 'features/report-admin/classnote-release-list.ts' };
let syncModsP = null;
const syncMods = (load) => (syncModsP ??= Promise.all(Object.entries(SYNC_MODULES).map(async ([k, p]) => [k, await load(p)]))
  .then(Object.fromEntries).catch((e) => { syncModsP = null; throw e; }));
const FAIL = Symbol('조회 실패');
const SYNC_COLS = (sp) => raw(sp, `id::text id, status, ${TS('requested_at')} requested_at, ${TS('started_at')} started_at, ${TS('finished_at')} finished_at,
  result, error, scope, merge_count, next_scope`);

/**
 * 2.0 getClassnoteSyncStatus() — 같은 표(classnote_sync_requests · classnote_class_boards · classnote_workers · classnote_board_sync_runs)·같은 조건.
 *  · 게이트(2.0 gate): ClassNote 모듈 · 보고서 쓰기(canExport) · 쓰기 없는 강사는 상태를 숨긴다(상태 조회는 자동 요청 문맥이 아니다). 3.0엔
 *    '다른 강사 뷰'(열람 전용)가 없어 그 거절은 없다.
 *  · '지금'(nowMs · 연동 PC 살아 있음 판정) = 복사본을 뜬 시각. 조회 실패·표 없음 = 숨김(HIDDEN) · 보고서 요약 실패 = null — 2.0과 같다.
 */
export async function classnoteSyncStatus(base) {
  const { sql, t } = base, nowMs = base.clock.at.getTime();
  const HIDDEN = { available: false, workerReady: false, active: null, latest: null, report: null, nowMs };
  const [M, S] = await Promise.all([mods(base.load), syncMods(base.load)]);
  if (!M.gate.classnoteModuleOn(base.settings)) return HIDDEN;
  const canExport = ['full', 'scoped'].includes(base.level('lesson_reports'));
  const teacherWithoutWrite = base.viewer.systemRole === 'teacher' && !canExport;
  if (!canExport && !teacherWithoutWrite) return HIDDEN;
  if (teacherWithoutWrite && !base.viewer.isSuperAdmin) return HIDDEN;
  const act = await sql.soft((sp) => sp`select ${SYNC_COLS(sp)} from public.classnote_sync_requests where tenant_id=${t} and status in ('pending','running') limit 1`, FAIL);
  const fin = await sql.soft((sp) => sp`select ${SYNC_COLS(sp)} from public.classnote_sync_requests where tenant_id=${t} and status in ('done','failed')
    order by finished_at desc nulls last limit 1`, FAIL);
  const boards = await sql.soft(async (sp) => (await sp`select count(*)::int n from public.classnote_class_boards where tenant_id=${t}`)[0].n, FAIL);
  const workers = await sql.soft((sp) => sp`select ${raw(sp, TS('last_seen'))} last_seen, last_results from public.classnote_workers where tenant_id=${t}`, FAIL);
  if (act === FAIL || fin === FAIL || boards === FAIL || !boards) return HIDDEN;
  const worker = workers === FAIL ? { ready: false, autoSync: false }
    : { ready: S.sync.workerReadyFromHeartbeats(workers, nowMs), autoSync: S.sync.workerAutoSyncFromHeartbeats(workers, nowMs) };
  let report = null;
  if (canExport) {
    // kind = null(아무 회차) · 'daily'(전체 동기화) — 2.0 loadLatestRows의 두 조회.
    const head = (kind) => sql.soft(async (sp) => (await sp`select kind, ${raw(sp, TS('finished_at'))} finished_at, ok, error, summary from public.classnote_board_sync_runs
      where tenant_id=${t} and (${kind}::text is null or kind=${kind}::text) order by finished_at desc limit 1`)[0] ?? null, FAIL);
    const latestRow = await head(null), dailyRow = await head('daily');
    const checked = await sql.soft((sp) => sp`select board_name, release_names, ${raw(sp, TS('release_checked_at'))} release_checked_at from public.classnote_class_boards
      where tenant_id=${t} and release_checked_at is not null order by class_id`, FAIL);
    if (latestRow !== FAIL && dailyRow !== FAIL && checked !== FAIL) {
      const latest = S.report.toSyncRunHead(latestRow);
      const boardsList = checked.map((r) => ({ boardName: r.board_name?.trim() || '이름 없는 반', className: null, names: S.release.parseReleaseNames(r.release_names), checkedAt: r.release_checked_at }));
      report = latest ? S.report.summarizeSyncReport(latest, boardsList, S.report.toSyncRunHead(dailyRow)) : null;
    }
  }
  const row = (rs) => (rs[0] ? S.sync.toSyncRow(rs[0]) : null);
  return { available: true, workerReady: worker.ready, autoSync: worker.autoSync, active: row(act), latest: row(fin), report, nowMs };
}

// ── 면 안 부품이 다시 읽는 2.0 서버 함수(이 화면 GET 열쇠 `cnread`) ─────────────────────────────────────────────────────
/**
 * 발송 큐 카드의 자동 갱신(2.0 refreshClassnoteQueue — 1~14일로 조인 창) · 공지 면의 목록 다시 읽기(listClassNotices · listClassWideNotices) ·
 * 지금 동기화 버튼 상태(getClassnoteSyncStatus — cnread=sync).
 * 답은 2.0 반환 모양 그대로(JSON). 큐는 수업보고서 열람 권한이 없으면 null(2.0과 같다).
 */
export async function readClassnote({ sql: tx, tenantId, importV2, viewerId = null, cnread, days }) {
  const base = await studentsBase({ sql: tx, tenantId, importV2, viewerId });
  if (!base.viewer) return { notFound: true };
  const canAccess = base.level('lesson_reports') !== 'none';
  if (cnread === 'queue') {
    if (!canAccess) return { value: null };
    const n = Number(days), window = Number.isFinite(n) ? Math.min(14, Math.max(1, Math.trunc(n))) : 3;
    return { value: await classnoteQueue(base, window) };
  }
  if (cnread === 'notices') return { value: await classNotices(base, canAccess) };
  if (cnread === 'classwide') return { value: await classWideNotices(base, canAccess) };
  if (cnread === 'sync') return { value: await classnoteSyncStatus(base) };
  return { notFound: true };
}
