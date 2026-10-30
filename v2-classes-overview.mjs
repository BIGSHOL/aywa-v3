// 수업 현황의 반·명단 인원은 2.0 readClassesPage에서 읽고, 프로그램만 2.0 programOf로 묶는다.
import { overviewPrograms } from './v2-overview-program.mjs';

export const COURSE_KEYS = ['elem', 'middle', 'high', 'mixed', 'unclassified'];
const LABELS = { elem: '초등', middle: '중등', high: '고등', mixed: '혼합', unclassified: '미분류' };
const href = params => `#v2-classes${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
const average = (seats, classes) => classes ? `${(seats / classes).toFixed(1)}명` : '—';
const set = (a, key) => (a.get(key) ?? a.set(key, { classes: [], teachers: new Set() }).get(key));

// 이름은 검토 후보일 뿐, 원장이 저장하기 전에는 언제나 미분류다.
export function courseCandidate(name) {
  const found = new Set();
  if (/(초등|초[1-6]|초[가-힣])/u.test(name)) found.add('elem');
  if (/(중등|중[1-3]|중[가-힣])/u.test(name)) found.add('middle');
  if (/(고등|고[1-3]|고[가-힣])/u.test(name)) found.add('high');
  return found.size === 1 ? [...found][0] : found.size > 1 ? 'mixed' : null;
}

export async function classOverview({ sql, tenantId, importV2, R, params, readSettings, readClassesPage }) {
  const settings = await readSettings(sql, tenantId, R);
  const [program, configRow] = await Promise.all([
    overviewPrograms(importV2, settings, R),
    sql`select coalesce(data->'ownerConceptClassOverview','{}'::jsonb) overview from public.tenant_settings where tenant_id=${tenantId}`,
  ]);
  const config = configRow[0]?.overview ?? {};
  const { rows: classes, total } = await readClassesPage(sql, tenantId, R, { kind: 'all', subject: 'all', teacherId: 'all', days: [], q: '', sort: 'name', status: 'operating' }, 1, 10000);
  const all = new Map(), byCourse = new Map();
  for (const cls of classes) {
    const key = program.of({ subject: cls.subject, english_track: cls.englishTrack ?? null });
    if (!key) continue;
    const course = COURSE_KEYS.includes(config.classCourse?.[cls.id]) ? config.classCourse[cls.id] : 'unclassified';
    const record = { ...cls, program: key, course, candidate: courseCandidate(cls.className),
      capacity: Number.isInteger(config.classCapacity?.[cls.id]) ? config.classCapacity[cls.id] : Number.isInteger(config.courseCapacity?.[`${key}:${course}`]) ? config.courseCapacity[`${key}:${course}`] : null,
      ownCapacity: config.classCapacity?.[cls.id] ?? null };
    const root = set(all, key), branch = set(byCourse, `${key}:${course}`);
    root.classes.push(record); branch.classes.push(record);
    if (cls.teacherId) { root.teachers.add(cls.teacherId); branch.teachers.add(cls.teacherId); }
  }
  const chosenProgram = program.order.includes(params.program) ? params.program : null;
  const chosenCourse = COURSE_KEYS.includes(params.course) ? params.course : null;
  const totalSeats = classes.reduce((n, c) => n + c.studentCount, 0), totalAverage = average(totalSeats, total);
  const summary = `운영 반 ${total}개 · 명단 인원 ${totalSeats}명분 · 반당 평균 ${totalAverage}`;
  const columns = [{ key: 'name', label: '구분' }, { key: 'classes', label: '운영 반 / 전체' }, { key: 'seats', label: '명단 인원' },
    { key: 'average', label: '반당 평균 / 전체' }, { key: 'teachers', label: '담임' }, { key: 'small', label: '편성 검토' }, { key: 'capacity', label: '정원 대비 채움' }];
  const metric = (name, group, link) => {
    const list = group?.classes ?? [], seats = list.reduce((n, c) => n + c.studentCount, 0);
    const sized = list.filter(c => c.capacity);
    return { href: link, cells: { name, classes: `${list.length} / ${total}개`, seats: `${seats}명분`, average: `${average(seats, list.length)} / ${totalAverage}`,
      teachers: `${group?.teachers.size ?? 0}명`, small: `${list.filter(c => !c.isSpecial && c.studentCount < 4).length}개`,
      capacity: sized.length ? `${sized.reduce((n, c) => n + c.studentCount, 0)} / ${sized.reduce((n, c) => n + c.capacity, 0)}명 (${sized.length}반)` : '—' } };
  };
  const root = { label: '수업목록', href: href({}) };
  const path = [chosenProgram ? root : { label: '수업목록' }, ...(chosenProgram ? [{ label: program.label(chosenProgram), href: chosenCourse ? href({ program: chosenProgram }) : null }] : []),
    ...(chosenCourse ? [{ label: LABELS[chosenCourse] }] : [])];
  let rows;
  if (!chosenProgram) rows = program.order.map(key => metric(program.label(key), all.get(key), href({ program: key })));
  else if (!chosenCourse) rows = COURSE_KEYS.map(key => metric(LABELS[key], byCourse.get(`${chosenProgram}:${key}`), href({ program: chosenProgram, course: key })));
  else rows = (byCourse.get(`${chosenProgram}:${chosenCourse}`)?.classes ?? []).map(c => ({ id: c.id, candidate: c.candidate, course: c.course,
    ownCapacity: c.ownCapacity, isSpecial: c.isSpecial, teacherId: c.teacherId, studentCount: c.studentCount,
    href: href({ v2path: `/classes/${c.id}` }),
    cells: { name: c.className, classes: '1개', seats: `${c.studentCount}명분`, average: '—', teachers: c.teacherName || { text: '미지정', tone: 'low' },
      small: !c.isSpecial && c.studentCount < 4 ? '편성 검토' : '—',
      capacity: c.capacity ? { text: `${c.studentCount} / ${c.capacity}명`, tone: c.studentCount > c.capacity ? 'low' : '' } : '—' },
    action: { kind: 'settings', key: c.id, label: '설정 저장' } }));
  return { title: chosenCourse ? `${program.label(chosenProgram)} ${LABELS[chosenCourse]} 반 현황` : chosenProgram ? `${program.label(chosenProgram)} 과정 현황` : '수업 현황',
    purpose: '운영 중인 반과 명단 인원, 담임 배정과 편성을 확인합니다.', path, columns, rows, summary, total, totalSeats,
    config: { courseCapacity: config.courseCapacity ?? {}, classCourse: config.classCourse ?? {}, classCapacity: config.classCapacity ?? {} },
    selected: { program: chosenProgram, course: chosenCourse },
    note: '반 명단 인원은 2.0 수업목록의 오늘 명단 수입니다. 과정은 원장이 저장하기 전까지 미분류이며, 반 이름의 후보는 검토용입니다. 정규 반 4명 미만은 편성 검토 대상입니다.' };
}
