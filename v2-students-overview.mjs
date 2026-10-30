// 원생 현황: 현재 재원 판정은 2.0 composeEnrolled/summarizePrograms/activeRows 그대로 쓴다.
// 월간 이동은 2.0 전체 모집단을 먼저 정한 뒤, 첫/마지막 반 이력으로만 귀속한다.
import { studentsBase } from './v2-students-common.mjs';
import { overviewPrograms } from './v2-overview-program.mjs';

const href = params => `#v2-students${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
const empty = () => ({ enrolled: new Set(), newly: new Set(), withdrawn: new Set(), hold: new Set(), classes: new Set() });
const put = (map, key, kind, id, classId) => {
  const value = map.get(key) ?? empty(); value[kind].add(id);
  if (classId && kind === 'enrolled') value.classes.add(classId);
  map.set(key, value);
};
const gradeKey = (R, student) => R.vals.studentLevelOf(student.grade);
const listOf = (rows, id) => rows.filter(row => row.student_id === id && row.class_id);
const classOf = row => ({ subject: row.subject, english_track: row.english_track });
const one = (map, key) => map.get(key) ?? empty();
const metric = (n, total) => `${n} / ${total}명`;
const columns = [{ key: 'name', label: '구분' }, { key: 'enrolled', label: '오늘 재원 / 전체' }, { key: 'newly', label: '이번 달 신규' },
  { key: 'withdrawn', label: '이번 달 퇴원' }, { key: 'hold', label: '휴원' }, { key: 'classes', label: '재원생 있는 반' }];

export async function studentOverview({ sql, tenantId, importV2, viewerId = null, params = {} }) {
  const base = await studentsBase({ sql, tenantId, importV2, viewerId });
  if (!base.viewer || base.level('students') === 'none') return null;
  const [comp, vals, merged, bulk, win, modules] = await Promise.all([
    importV2('features/students/enrollment/enrolled-composition.ts'), importV2('features/students/list-filter-values.ts'),
    importV2('features/students/status/merged.ts'), importV2('features/withdrawals/system-bulk.ts'),
    importV2('features/withdrawals/window.ts'), importV2('lib/modules.ts'),
  ]);
  const R = { comp, vals }, today = base.today, month = today.slice(0, 7), monthStart = `${month}-01`;
  const program = await overviewPrograms(importV2, base.settings, modules);
  const students = await base.sql`select id::text id, name, grade, school, status::text status, enrolled_at::text enrolled_at,
    withdrawn_at::text withdrawn_at, notes, withdrawal_metadata from public.students where tenant_id=${tenantId}
    and (status in ('enrolled','on_hold') or (status='withdrawn' and withdrawn_at >= ${monthStart}::date)) order by id`;
  const ids = students.map(s => s.id);
  const enrolledIds = new Set(students.filter(s => s.status === 'enrolled').map(s => s.id));
  const enrollment = ids.length ? await base.sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id,
    e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
    c.class_name, c.subject, c.english_track from public.enrollments e
    left join public.classes c on c.id=e.class_id and c.tenant_id=${tenantId}
    where e.tenant_id=${tenantId} and e.student_id=any(${ids}::uuid[]) order by e.id` : [];
  const active = enrollment.filter(e => e.end_date === null && !e.on_hold && e.class_id && enrolledIds.has(e.student_id))
    .map(e => ({ ...e, class: classOf(e), student: { status: 'enrolled' } }));
  const current = comp.composeEnrolled({ students: students.filter(s => s.status === 'enrolled').map(s => ({ id: s.id, grade: s.grade, school: s.school })),
    rows: active, scope: null, subjects: base.settings.operations.subjects, today });
  const allIds = current.students.map(s => s.id), total = allIds.length;
  const totals = comp.summarizePrograms(allIds, current.programs, current.active);
  const visible = new Set(allIds), byId = new Map(students.map(s => [s.id, s]));
  const byClass = new Map(enrollment.map(e => [e.class_id, e.class_name]));
  const programRows = new Map(), courseRows = new Map(), classRows = new Map();
  const add = (kind, s, key, classId = null) => {
    put(programRows, key, kind, s.id, classId);
    const level = gradeKey(R, s);
    put(courseRows, `${key}:${level}`, kind, s.id, classId);
    if (classId) put(classRows, `${key}:${level}:${classId}`, kind, s.id, classId);
  };
  for (const [e, cls] of comp.activeRows(active, null, today)) {
    if (!visible.has(e.student_id)) continue;
    const key = program.of(cls);
    if (key) add('enrolled', byId.get(e.student_id), key, e.class_id);
  }
  // 분류할 수 없는 재원도 전체 재원에 남는다. 프로그램 수치의 합과 전체 수치가 같을 필요는 없다.
  const newIds = new Set(), withdrawnIds = new Set(), holdIds = new Set();
  for (const s of students) {
    const history = listOf(enrollment, s.id);
    let kind = null, chosen = [];
    if (s.status === 'enrolled' && s.enrolled_at?.slice(0, 10) >= monthStart && !merged.isMergedStudent(s.notes)) {
      kind = 'newly'; newIds.add(s.id);
      // 프로그램별 첫 수강을 택한다. 같은 시작일에 두 프로그램이면 양쪽에 선다.
      const first = new Map();
      const admissionDay = s.enrolled_at.slice(0, 10);
      const admissionRows = history.filter(e => !e.start_date || e.start_date >= admissionDay);
      for (const e of (admissionRows.length ? admissionRows : history)) { const key = program.of(classOf(e)); if (!key) continue; const day = e.start_date || admissionDay;
        const old = first.get(key); if (!old || day < old.day) first.set(key, { day, rows: [e] }); else if (day === old.day) old.rows.push(e); }
      chosen = [...first].flatMap(([key, value]) => value.rows.map(e => ({ key, row: e })));
    } else if (s.status === 'withdrawn' && win.inWithdrawalWindow({ withdrawnAt: s.withdrawn_at, systemBulk: false }, monthStart, today)
      && !merged.isMergedStudent(s.notes) && !bulk.isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: history.some(e => e.end_date) })) {
      kind = 'withdrawn'; withdrawnIds.add(s.id);
      const last = new Map();
      for (const e of history.filter(e => e.end_date && e.end_date <= s.withdrawn_at.slice(0, 10) && !e.is_transferred)) { const key = program.of(classOf(e)); if (!key) continue;
        const old = last.get(key); if (!old || e.end_date > old.day) last.set(key, { day: e.end_date, rows: [e] }); else if (e.end_date === old.day) old.rows.push(e); }
      chosen = [...last].flatMap(([key, value]) => value.rows.map(e => ({ key, row: e })));
    } else if (s.status === 'on_hold') {
      kind = 'hold'; holdIds.add(s.id);
      const held = history.filter(e => e.on_hold && !e.end_date);
      const latest = held.length ? held : history.filter(e => !e.end_date);
      chosen = latest.flatMap(e => { const key = program.of(classOf(e)); return key ? [{ key, row: e }] : []; });
    }
    if (!kind) continue;
    if (!chosen.length) add(kind, s, 'unknown');
    else for (const { key, row } of chosen) add(kind, s, key, row.class_id);
  }
  const course = vals.STUDENT_LEVELS.find(x => x.key === params.course);
  const selectedProgram = program.order.includes(params.program) ? params.program : null;
  const root = { label: '원생목록', href: href({}) };
  const path = [selectedProgram ? root : { label: '원생목록' }, ...(selectedProgram ? [{ label: program.label(selectedProgram), href: course ? href({ program: selectedProgram }) : null }] : []),
    ...(course ? [{ label: course.label, href: params.classId ? href({ program: selectedProgram, course: course.key }) : null }] : []),
    ...(params.classId ? [{ label: byClass.get(params.classId) || '반' }] : [])];
  const row = (name, data, link, group) => ({ ...(group ? { group } : {}), href: link,
    cells: { name, enrolled: metric(data.enrolled.size, total), newly: data.newly.size, withdrawn: data.withdrawn.size,
      hold: data.hold.size, classes: data.classes.size } });
  let rows;
  if (!selectedProgram) rows = [...program.order, ...(programRows.has('unknown') ? ['unknown'] : [])].map(key =>
    row(key === 'unknown' ? '귀속 미정' : program.label(key), one(programRows, key), key === 'unknown' ? null : href({ program: key })));
  else if (!course) rows = vals.STUDENT_LEVELS.map(c => row(c.label, one(courseRows, `${selectedProgram}:${c.key}`),
    href({ program: selectedProgram, course: c.key }), program.label(selectedProgram)));
  else rows = [...classRows].filter(([key]) => key.startsWith(`${selectedProgram}:${course.key}:`)).map(([key, data]) => {
    const id = key.slice(`${selectedProgram}:${course.key}:`.length);
    return { id, ...row(byClass.get(id) || '반 이름 없음', data, href({ v2path: '/students', status: 'enrolled', program: selectedProgram, level: course.key, classId: id }), course.label) };
  }).sort((a, b) => String(a.cells.name).localeCompare(String(b.cells.name), 'ko'));
  const withdrawalMentions = [...programRows.values()].reduce((n, item) => n + item.withdrawn.size, 0);
  return { title: params.classId ? byClass.get(params.classId) || '반 원생' : course ? `${program.label(selectedProgram)} ${course.label} 반 현황` : selectedProgram ? `${program.label(selectedProgram)} 과정 현황` : '원생 현황',
    purpose: '프로그램과 과정에서 원생 이동과 반 배정을 확인합니다.', path, summary: `전체 재원 ${total}명 · 이번 달 신규 ${newIds.size}명 · 퇴원 ${withdrawnIds.size}명 · 휴원 ${holdIds.size}명`,
    columns, rows, totals, total, month, monthly: { newly: newIds.size, withdrawn: withdrawnIds.size, hold: holdIds.size },
    note: `재원 수는 오늘 시작한 수강 기준이며, 한 원생이 여러 프로그램·반에 설 수 있습니다. '재원생 있는 반'은 현재 재원생의 활성 수강이 있는 반 수로, 전체 운영 반 수와 다릅니다. 신규·퇴원은 첫·마지막 수강 반으로 묶고 두 프로그램이면 양쪽에 표시합니다. 따라서 프로그램별 퇴원 합 ${withdrawalMentions}명분은 서로 다른 퇴원 원생 ${withdrawnIds.size}명과 다를 수 있습니다. 휴원은 휴원한 반으로 묶고, 귀속할 반이 없으면 귀속 미정에 표시합니다. 지난달 비교는 같은 기준의 과거 기록이 확인된 뒤 표시합니다.` };
}

