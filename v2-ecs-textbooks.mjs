// 2.0 화면 · 강사 시트(ECS) — 교재 배정 창(TextbookFillDialog · TextbookFillExisting)이 여는 읽기 셋. 2.0 textbooks/server/plan-actions.ts의
// loadClassSlotChoices · loadClassTextbookPlans · loadAssignableTextbooks(속은 queries.ts getClassSlotChoices · getClassTextbookPlans · getAssignableTextbooks)와
// 같은 게이트·같은 조회·같은 반환 모양. 호스트는 이 셋을 저장 경로가 아니라 화면 GET(?read=slotChoices|textbookPlans|assignable)으로 묻는다.
// ctx = { sql, t, R, env, user, today } — screen.load가 만든다(읽기 전용 트랜잭션).
import { classAccess, readNames } from './v2-ecs-core.mjs';
import { visibleClassFilter } from './v2-ecs-props.mjs';

const str = v => (typeof v === 'string' ? v : '');

/** loadClassSlotChoices(classId) — 그 반이 오늘 도는 교시(시각 × 담당 칩, LAB 제외). 종료가 갈리면 교시 이름을 비운다. */
export async function readSlotChoices({ sql, t, R, env, user, today }, classId) {
  const gate = await classAccess(sql, t, R, env, user, str(classId));
  if (!gate.ok) return { ok: false, error: gate.error };
  const [sched, names] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, slot_teacher_label from public.class_schedules
      where tenant_id=${t} and class_id=${gate.access.classId} and valid_from <= ${today} and (valid_to is null or valid_to >= ${today}) order by start_time, id limit 300`,
    readNames(sql, t, R).catch(() => null),
  ]);
  const labelMap = names?.labelMap, periodsConfig = R.settingsToPeriodsConfig(env.operations);
  const tables = { weekday: R.tableToEntries(R.weekdayTableFor(gate.access.subject, periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const acc = new Map();
  for (const r of sched) {
    const label = r.slot_teacher_label ?? '', seat = R.specialSlotLabel(label || null);
    if (seat === 'LAB') continue;
    const start = r.start_time.slice(0, 5), dow = r.day_of_week, key = `${start}|${label}`;
    const cur = acc.get(key) ?? { start, label, ends: new Set(), dows: [], weekend: false };
    cur.ends.add(r.end_time ? r.end_time.slice(0, 5) : '');
    if (!cur.dows.includes(dow)) cur.dows.push(dow);
    if (R.isWeekendDow(dow)) cur.weekend = true;
    acc.set(key, cur);
  }
  const rows = [...acc.entries()].map(([key, a]) => {
    const onlyEnd = a.ends.size === 1 ? ([...a.ends][0] ?? '') : null, seat = R.specialSlotLabel(a.label || null);
    return { key, start: a.start, periodLabel: onlyEnd === null ? null : R.resolvePeriodLabel(a.start, onlyEnd || null, tables, a.weekend), seat: seat === 'JJ' ? 'JJ' : null,
      teacherLabel: a.label ? (R.resolveTeacherLabel(a.label, labelMap) ?? a.label) : null, dows: a.dows, picks: a.dows.map(d => R.slotPickKey(d, a.start)) };
  });
  return { ok: true, rows: rows.sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : (a.teacherLabel ?? '').localeCompare(b.teacherLabel ?? '', 'ko'))) };
}

/** loadClassTextbookPlans(classId) — 그 반에 걸린 배정(시작일 늦은 것 먼저). 교재목록 기능이 꺼진 학원은 빈 목록. */
export async function readClassTextbookPlans({ sql, t, R, env, user, today }, classId) {
  const gate = await classAccess(sql, t, R, env, user, str(classId));
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!env.textbooksOn) return { ok: true, rows: [] };
  const scope = await visibleClassFilter(sql, t, R, user, null, today);
  if (scope.classIds !== null && scope.classIds.length === 0) return { ok: true, rows: [] };
  const plans = await sql`select id::text id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode, start_date::text start_date, start_lesson_no, is_active, last_applied_at, slot_picks
    from public.class_textbook_plans where tenant_id=${t} and is_active and class_id=${gate.access.classId} order by start_date desc, id`;
  if (plans.length === 0) return { ok: true, rows: [] };
  const bookIds = [...new Set(plans.map(p => p.textbook_id))];
  const [classes, books] = await Promise.all([
    sql`select id::text id, class_name from public.classes where tenant_id=${t} and id=${gate.access.classId}`,
    sql`select id::text id, title, skill_area, session_count from public.textbooks where tenant_id=${t} and id = any(${bookIds}::uuid[])`,
  ]);
  const className = new Map(classes.map(c => [c.id, c.class_name])), bookById = new Map(books.map(b => [b.id, b]));
  return { ok: true, rows: plans.map(p => {
    const book = bookById.get(p.textbook_id);
    return { id: p.id, classId: p.class_id, className: className.get(p.class_id) ?? '(삭제된 반)', textbookId: p.textbook_id, textbookTitle: book?.title ?? '(삭제된 교재)',
      skillArea: book?.skill_area ?? null, sessionCount: Number(book?.session_count ?? 0), slotAxis: p.slot_axis === 'jj' ? 'jj' : 'class',
      slotPicks: Array.isArray(p.slot_picks) && p.slot_picks.length > 0 ? p.slot_picks.map(String) : null, pace: R.normalizeLessonPace(p.pace),
      termMode: p.term_mode === 'exam' ? 'exam' : 'regular', startDate: p.start_date, startLessonNo: Number(p.start_lesson_no ?? 1), isActive: p.is_active,
      lastAppliedAt: p.last_applied_at ? new Date(p.last_applied_at).toISOString() : null };
  }) };
}

/** loadAssignableTextbooks() — 교재목록 메뉴 접근이면 영어 교재 중 구분 있음·차수 ≥ 1(제목순, 500개). */
export async function readAssignableTextbooks({ sql, t, user }) {
  if (user.levels.textbooks === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  const rows = await sql`select id::text id, title, skill_area, session_count from public.textbooks
    where tenant_id=${t} and subject='english' and session_count >= 1 and skill_area is not null order by title limit 500`;
  return { ok: true, rows: rows.map(r => ({ id: r.id, title: String(r.title), skillArea: r.skill_area ?? null, sessionCount: Number(r.session_count ?? 0) })) };
}
