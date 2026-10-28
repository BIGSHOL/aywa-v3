// 2.0 수학 교재 조회 — features/textbooks/server/math-assignment-queries.ts · math-book-plan-queries.ts · school-exam-queries.ts를 Docker 복사본에서 같은 결과로.
// MCS(반 월간 시트 · 선생님별)와 교재 화면이 같이 쓴다. 판정(교재 맞추기 · 주문 교재 · 3개월 창)은 2.0 순수 함수(R = v2-mcs-core loadRules) 그대로.
// 2.0이 실패해도 null·'failed'로 넘어가는 조회는 저장점 안에서 돌려(읽기 트랜잭션이 끊기지 않게) 같은 모양으로 돌려준다.

/** math-sheets/lib/sent-reports.ts SENT_REPORT_OR — 학부모에게 실제로 나간 보고서(클래스노트 성공 · 발송 시각 · 옛 공유 · 데모 이력). revoked_at is null과 함께. */
export const sentReport = sql => sql`(classnote_status = 'success' or classnote_sent_at is not null or edutrix_share_token is not null or source = 'demo_history')`;
const soft = (sql, fn) => sql.savepoint(fn);
const REPORT_LOOKBACK_DAYS = 180, OTHER_BOOK_LOOKBACK_DAYS = 60;

/** getMathTextbookChoices — 활성 수학 교재(제목 · id 순), 학년·학기 칸이 없으면 빼고. 실패면 null. */
export async function mathTextbookChoices(sql, t) {
  const read = (s, withTerm) => s`select id::text id, title ${withTerm ? s`, grade_term` : s``} from public.textbooks where tenant_id=${t} and subject='math' and is_active order by title, id`;
  try {
    let rows;
    try { rows = await soft(sql, s => read(s, true)); } catch (e) { if (e?.code === '42703') rows = await soft(sql, s => read(s, false)); else throw e; }
    return rows.map(r => ({ id: r.id, title: r.title, gradeTerm: r.grade_term ?? null }));
  } catch { return null; }
}
/** getMathCatalogBooks — 교재 + 차시(차시 번호 순). 실패면 null. */
export async function mathCatalogBooks(sql, t) {
  const choices = await mathTextbookChoices(sql, t);
  if (choices === null) return null;
  if (choices.length === 0) return [];
  try {
    const lessons = await soft(sql, s => s`select textbook_id::text textbook_id, lesson_no, progress from public.textbook_lessons where tenant_id=${t}
      and textbook_id = any(${choices.map(c => c.id)}::uuid[]) order by textbook_id, lesson_no`);
    const byBook = new Map();
    for (const l of lessons) (byBook.get(l.textbook_id) ?? byBook.set(l.textbook_id, []).get(l.textbook_id)).push({ lessonNo: l.lesson_no, progress: l.progress });
    return choices.map(c => ({ ...c, lessons: byBook.get(c.id) ?? [] }));
  } catch { return null; }
}
/** getStudentBookOrders — 학생별 교재 주문(주문일 → 요청일 → 만든 날, KST 날짜). 실패면 null. */
export async function studentBookOrders(sql, t, R, studentIds) {
  if (studentIds.length === 0) return new Map();
  try {
    const rows = await soft(sql, s => s`select student_id::text student_id, book_name, request_date::text request_date, ordered_at, created_at from public.textbook_orders
      where tenant_id=${t} and student_id = any(${studentIds}::uuid[]) order by id`);
    const out = new Map();
    for (const r of rows) {
      const date = r.ordered_at ? R.dk.kstToday(new Date(r.ordered_at)) : (r.request_date ?? R.dk.kstToday(new Date(r.created_at)));
      (out.get(r.student_id) ?? out.set(r.student_id, []).get(r.student_id)).push({ bookName: r.book_name, date });
    }
    return out;
  } catch { return null; }
}
/** getClassReportLines — 이 반에서 학생별로 보낸 보고서(최근 180일)의 교재·진도. 실패면 null. */
async function classReportLines(sql, t, R, classId, studentIds) {
  if (studentIds.length === 0) return new Map();
  try {
    const rows = await soft(sql, s => s`select student_id::text student_id, report_date::text report_date, textbook, progress from public.lesson_reports
      where tenant_id=${t} and class_id=${classId} and student_id = any(${studentIds}::uuid[]) and ${sentReport(s)} and revoked_at is null
        and report_date >= ${R.dk.addDays(R.dk.kstToday(), -REPORT_LOOKBACK_DAYS)}::date order by id`);
    const out = new Map();
    for (const r of rows) (out.get(r.student_id) ?? out.set(r.student_id, []).get(r.student_id)).push({ date: r.report_date, textbook: r.textbook, progress: r.progress });
    return out;
  } catch { return null; }
}
/** 학생별 보낸 보고서(최근 180일, 반 무관) — 선생님별 보기가 학생×반 열쇠로 다시 나눈다(2.0 getMathTeacherRoster 안 조회). */
export async function recentReportsByStudentClass(sql, t, R, studentIds, today) {
  if (studentIds.length === 0) return [];
  return sql`select student_id::text student_id, class_id::text class_id, report_date::text report_date, textbook, progress from public.lesson_reports
    where tenant_id=${t} and student_id = any(${studentIds}::uuid[]) and ${sentReport(sql)} and revoked_at is null
      and report_date >= ${R.dk.addDays(today, -REPORT_LOOKBACK_DAYS)}::date order by id`;
}

const isMissingAssignTable = e => !!e && (e.code === '42P01' || /math_textbook_assignments/.test(e.message ?? '') && /not find|does not exist|schema cache/i.test(e.message ?? ''));
/** getMathClassTextbooks — 반·학생 배정 교재 · 학생별 지금 교재(배정 → 주문 → 반 → 보고서 추정)와 위치. */
export async function mathClassTextbooks(sql, t, R, classId, studentIds) {
  let assign = null, assignError = null;
  try {
    assign = await soft(sql, s => s`select a.student_id::text student_id, a.textbook_id::text textbook_id, b.title from public.math_textbook_assignments a
      left join public.textbooks b on b.id=a.textbook_id where a.tenant_id=${t} and a.class_id=${classId}`);
  } catch (e) { assignError = e; }
  const [catalog, reports, orders] = [await mathCatalogBooks(sql, t), await classReportLines(sql, t, R, classId, studentIds), await studentBookOrders(sql, t, R, studentIds)];
  const choices = catalog?.map(b => ({ id: b.id, title: b.title })) ?? [];
  const books = catalog ?? [];
  let status = 'ok', classBook = null;
  const byStudent = {};
  if (assignError) status = isMissingAssignTable(assignError) ? 'missing-table' : 'failed';
  else if (catalog === null) status = 'failed';
  else for (const r of assign) {
    const book = { textbookId: r.textbook_id, title: r.title ?? '(지워진 교재)' };
    if (r.student_id) byStudent[r.student_id] = book; else classBook = book;
  }
  const now = {};
  for (const sid of studentIds) {
    const lines = reports?.get(sid) ?? [];
    const ordered = R.bookWindow.latestOrderedBook(orders?.get(sid) ?? [], books);
    const assigned = byStudent[sid] ? { book: byStudent[sid], source: 'student' }
      : ordered ? { book: { textbookId: ordered.book.id, title: ordered.book.title }, source: 'order' }
        : classBook ? { book: classBook, source: 'class' } : null;
    if (assigned) {
      const cat = books.find(b => b.id === assigned.book.textbookId);
      now[sid] = { ...assigned, position: cat ? R.match.bookPosition(cat, lines, books) : null };
      continue;
    }
    const inferred = R.match.inferBookFromReports(lines, books);
    if (inferred) now[sid] = { book: { textbookId: inferred.id, title: inferred.title }, source: 'report', position: R.match.bookPosition(inferred, lines, books, true) };
  }
  return { status, classBook, byStudent, choices, now, sources: { catalog: books, orders: orders ?? new Map(), reports: reports ?? new Map() } };
}

/** getMathBookTargets — 학생별 사람이 고른 목표 권(series → target_key). */
export async function mathBookTargets(sql, t, studentIds) {
  const byStudent = new Map();
  if (studentIds.length === 0) return { status: 'ok', byStudent };
  try {
    const rows = await soft(sql, s => s`select student_id::text student_id, series, target_key from public.math_book_targets where tenant_id=${t} and student_id = any(${studentIds}::uuid[])`);
    for (const r of rows) byStudent.set(r.student_id, { ...byStudent.get(r.student_id), [r.series]: r.target_key });
    return { status: 'ok', byStudent };
  } catch (e) {
    const msg = e?.message ?? '';
    return { status: e?.code === '42P01' || (msg.includes('math_book_targets') && /not find|does not exist|schema cache/i.test(msg)) ? 'missing-table' : 'failed', byStudent };
  }
}
/** getRecentReportsAllClasses — 학생별 최근 60일 보낸 보고서(반 이름 포함 — 다른 반 교재 기록). 실패면 빈 표. */
export async function recentReportsAllClasses(sql, t, R, studentIds) {
  const out = new Map();
  if (studentIds.length === 0) return out;
  try {
    const rows = await soft(sql, s => s`select r.student_id::text student_id, r.report_date::text report_date, r.textbook, r.progress, c.class_name from public.lesson_reports r
      left join public.classes c on c.id=r.class_id and c.tenant_id=${t}
      where r.tenant_id=${t} and r.student_id = any(${studentIds}::uuid[]) and ${sentReport(s)} and r.revoked_at is null
        and r.report_date >= ${R.dk.addDays(R.dk.kstToday(), -OTHER_BOOK_LOOKBACK_DAYS)}::date order by r.id`);
    for (const r of rows) (out.get(r.student_id) ?? out.set(r.student_id, []).get(r.student_id)).push({ date: r.report_date, textbook: r.textbook, progress: r.progress, className: r.class_name ?? null });
  } catch { return new Map(); }
  return out;
}
/** getSchoolExamPeriods(schools) · getAllSchoolExamPeriods — 학교별 내신기간(학교 이름은 2.0 normalizeSchoolName 열쇠). */
export async function schoolExamPeriods(sql, t, R, schools) {
  const keys = schools === null ? null : [...new Set(schools.map(s => R.school.normalizeSchoolName(s)).filter(Boolean))];
  const byKey = new Map();
  if (keys && keys.length === 0) return { status: 'ok', rows: [], byKey };
  try {
    const raw = await soft(sql, s => s`select school_key, school_label, school_year, term, from_date::text from_date, to_date::text to_date from public.school_exam_periods
      where tenant_id=${t} ${keys ? s`and school_key = any(${keys})` : s``} order by id`);
    const rows = raw.map(r => ({ schoolKey: r.school_key, schoolLabel: r.school_label, schoolYear: r.school_year, term: r.term, from: r.from_date.slice(0, 10), to: r.to_date.slice(0, 10) }));
    for (const r of rows) byKey.set(r.schoolKey, [...(byKey.get(r.schoolKey) ?? []), { schoolYear: r.schoolYear, term: r.term, from: r.from, to: r.to }]);
    return { status: 'ok', rows, byKey };
  } catch (e) {
    const msg = e?.message ?? '';
    return { status: msg.includes('school_exam_periods') && /not find|does not exist|schema cache/i.test(msg) ? 'missing-table' : 'failed', rows: [], byKey };
  }
}
