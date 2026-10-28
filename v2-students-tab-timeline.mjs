// 원생 상세 '타임라인' 탭(2.0 _tabs/timeline-tab.tsx) — getStudentTimeline을 Docker 복사본에서 같은 표·같은 조건·같은 조립으로.
// · 사건 = 수강 이력(2.0 enrollmentHistoryTimeline — 수강 행 + 변경 로그 activity_log + 감사로그 enrollment_days_update·enrollment_delete
//   + 반의 지금 요일 + 삭제된 수강의 반 이름) · 학생상담 · 특이사항 · 성적 · 교재 신청(금액 없음) · 재원 시작·퇴원(students 두 날짜) ·
//   입학 상담(콜&상담 권한이 있을 때만 — page.tsx canSeeEnrollment와 같은 판정).
// · 원장 화면이라 '본인이 등록한 상담만'·'강사는 변경 로그를 안 읽음'(강사 범위) 갈래는 없다. '오늘' = 복사본 날짜.
// · 판정·라벨은 2.0 순수 함수 그대로(enrollmentHistoryTimeline · visibleConsultationSummary · reasonDisplay · isMergedStudent · buildSubjectMaps).
//   임포트 노트 풀이(parseImportedNote)는 queries.ts 안의 함수라 본문을 옮겼고, 입학 상담 결과 이름(OUTCOME_LABEL)은 서버 전용 파일의 표를 읽는다.
// · 읽기 전용.
import { readFile } from 'node:fs/promises';

const MODULES = { history: 'features/students/enrollment-history.ts', link: 'features/consultations/internal-link.ts', wd: 'features/withdrawals/types.ts',
  merged: 'features/students/status/merged.ts', subjects: 'features/owner/subjects.ts' };
let rulesP = null;
const rules = (load) => (rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; }));

let outcomeP = null;
/** 2.0 features/enrollment/server/queries.ts의 OUTCOME_LABEL(서버 전용 파일이라 불러올 수 없어 표를 읽는다). */
export function outcomeLabels() {
  outcomeP ??= readFile(new URL('../../src/features/enrollment/server/queries.ts', import.meta.url), 'utf8').then((src) => {
    const block = /export const OUTCOME_LABEL[^=]*=\s*\{([\s\S]*?)\};/.exec(src)?.[1] ?? '';
    const map = Object.fromEntries([...block.matchAll(/^\s*([a-z_]+):\s*"([^"]+)"/gm)].map(([, k, v]) => [k, v]));
    if (!map.enrolled || !map.pending) throw new Error('입학 상담 결과 이름을 읽지 못했습니다');
    return map;
  }).catch((e) => { outcomeP = null; throw e; });
  return outcomeP;
}

/** queries.ts parseImportedNote 본문 그대로 — "[제목]\n본문\n[등록자: 이름]" → 제목·본문·등록자. */
function parseImportedNote(raw) {
  if (!raw) return { title: null, body: null, registrant: null };
  let text = raw.trim();
  let registrant = null;
  const reg = text.match(/\[등록자:\s*([^\]]+)\]\s*$/);
  if (reg) {
    registrant = reg[1].trim();
    text = text.slice(0, reg.index).trim();
  }
  let title = null;
  const t = text.match(/^\[([^\]]+)\]/);
  if (t) {
    title = t[1].trim();
    text = text.slice(t[0].length).trim();
  }
  return { title, body: text || null, registrant };
}

/** server/enrollment-history.ts loadEnrollmentHistorySeed + getStudentEnrollmentHistory — 같은 표·같은 조건(지점 직접). */
async function readEnrollmentHistory(sql, t, id, enrollments, today) {
  const [snapshots, audit] = [
    await sql`select id::text id, row_id::text row_id, op, target_label, actor_name, changed, to_json(created_at)#>>'{}' created_at
      from public.activity_log where tenant_id=${t} and table_name='enrollments' and op in ('INSERT', 'DELETE')
      and changed->>'student_id' = ${id} order by created_at, id`,
    await sql`select id::text id, action, actor_name, metadata, to_json(created_at)#>>'{}' created_at from public.audit_logs
      where tenant_id=${t} and action in ('enrollment_days_update', 'enrollment_delete')
        and (metadata->>'studentId' = ${id} or (metadata->'studentIds') ? ${id}) order by created_at, id`,
  ];
  const ids = [...new Set([...enrollments.map((e) => e.id), ...snapshots.map((r) => r.row_id)])];
  const snapshotClassIds = snapshots.flatMap((row) => (typeof row.changed?.class_id === 'string' ? [row.changed.class_id] : []));
  const classIds = [...new Set([...enrollments.map((e) => e.classId), ...snapshotClassIds])];
  const named = new Set(enrollments.map((e) => e.classId));
  const orphanClassIds = [...new Set(snapshotClassIds)].filter((c) => !named.has(c));
  const updates = ids.length ? await sql`select id::text id, row_id::text row_id, op, target_label, actor_name, changed, to_json(created_at)#>>'{}' created_at
    from public.activity_log where tenant_id=${t} and table_name='enrollments' and op='UPDATE'
    and row_id = any(${ids}::uuid[]) order by created_at, id` : [];
  const schedules = classIds.length ? await sql`select class_id::text class_id, day_of_week::text day_of_week from public.class_schedules where tenant_id=${t}
    and class_id = any(${classIds}::uuid[]) and valid_from <= ${today}::date and (valid_to is null or valid_to >= ${today}::date) order by id` : [];
  const classes = orphanClassIds.length ? await sql`select id::text id, class_name from public.classes where tenant_id=${t} and id = any(${orphanClassIds}::uuid[])` : [];
  const currentClassDays = new Map();
  for (const row of schedules) {
    const list = currentClassDays.get(row.class_id) ?? [];
    if (!list.includes(row.day_of_week)) list.push(row.day_of_week);
    currentClassDays.set(row.class_id, list);
  }
  const classNames = new Map();
  for (const row of classes) if (row.class_name) classNames.set(row.id, row.class_name);
  return { activity: [...snapshots, ...updates], audit, currentClassDays, classNames };
}

/** getStudentTimeline — 모양 = 2.0 TimelineEvent[](최신 → 과거). */
export async function readStudentTimeline({ sql, t, id, gates, settings, today, importV2 }) {
  const R = await rules(importV2);
  const canSeeEnrollment = !!gates.canSeeEnrollment;
  const enrollments = await sql`select e.id::text id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred,
      e.withdrawal_reason, c.class_name, c.subject
    from public.enrollments e left join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id=${id}`;
  const consultations = await sql`select to_json(consulted_at)#>>'{}' consulted_at, category, summary from public.student_consultations where tenant_id=${t} and student_id=${id}`;
  const memos = await sql`select to_json(created_at)#>>'{}' created_at, category, content from public.student_memos where tenant_id=${t} and student_id=${id}`;
  const grades = await sql`select taken_on::text taken_on, exam_name, subject, score::float8 score, max_score::float8 max_score from public.student_grades where tenant_id=${t} and student_id=${id}`;
  const textbooks = await sql`select book_name, book_detail, to_json(request_date)#>>'{}' request_date, to_json(created_at)#>>'{}' created_at, to_json(registered_at)#>>'{}' registered_at,
      to_json(ordered_at)#>>'{}' ordered_at, to_json(paid_at)#>>'{}' paid_at from public.textbook_orders where tenant_id=${t} and student_id=${id}`;
  const [student] = await sql`select enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, withdrawal_metadata, notes from public.students where tenant_id=${t} and id=${id}`;
  const enrollConsults = canSeeEnrollment
    ? await sql`select to_json(consulted_at)#>>'{}' consulted_at, outcome::text outcome, subject, parent_request from public.enrollment_consultations where tenant_id=${t} and student_id=${id}`
    : [];

  const events = [];
  const timelineEnrollments = enrollments.map((e) => ({ id: e.id, classId: e.class_id, className: e.class_name ?? '—', subject: e.subject ?? null,
    startDate: e.start_date, endDate: e.end_date, isTransferred: !!e.is_transferred, reason: e.withdrawal_reason }));
  const history = await readEnrollmentHistory(sql, t, id, timelineEnrollments, today);
  events.push(...R.history.enrollmentHistoryTimeline({ studentId: id, enrollments: timelineEnrollments, ...history }));

  const CONSULT_CATEGORY_LABEL = { general: '일반', academic: '학습/성적', emotional: '정서/심리', career: '진로', social: '교우관계', other: '기타' };
  for (const c of consultations) {
    const catLabel = c.category ? CONSULT_CATEGORY_LABEL[c.category] : null;
    const p = parseImportedNote(R.link.visibleConsultationSummary(c.summary));
    events.push({ date: String(c.consulted_at).slice(0, 10), kind: 'consultation', title: p.title ?? (catLabel ? `상담 — ${catLabel}` : '상담 기록'), description: p.body, registrant: p.registrant });
  }
  for (const m of memos) {
    const p = parseImportedNote(m.content);
    events.push({ date: String(m.created_at).slice(0, 10), kind: 'memo', title: p.title ?? (m.category ? `특이사항 — ${m.category}` : '특이사항'), description: p.body, registrant: p.registrant });
  }
  const subjectMaps = R.subjects.buildSubjectMaps(settings.operations.subjects);
  for (const g of grades) {
    events.push({ date: g.taken_on, kind: 'grade', title: `${subjectMaps.labelOf(g.subject)} — ${g.exam_name}`,
      description: g.score == null ? null : g.max_score ? `${g.score} / ${g.max_score}점` : `${g.score}점` });
  }
  for (const b of textbooks) {
    const done = [b.registered_at ? '등록' : null, b.paid_at ? '납부' : null, b.ordered_at ? '주문' : null].filter(Boolean);
    events.push({ date: String(b.request_date ?? b.created_at ?? '').slice(0, 10), kind: 'textbook', title: b.book_name,
      description: [b.book_detail, done.length === 3 ? '처리 완료' : done.length ? `${done.join('·')} 완료` : '처리 대기'].filter(Boolean).join(' · ') });
  }
  if (student?.enrolled_at) events.push({ date: String(student.enrolled_at).slice(0, 10), kind: 'status_change', title: '재원 시작' });
  if (student?.withdrawn_at && !R.merged.isMergedStudent(student.notes)) {
    const md = student.withdrawal_metadata;
    const wDate = String(student.withdrawn_at).slice(0, 10);
    events.push({ date: wDate, kind: 'status_change', title: wDate > today ? '퇴원 예정' : '퇴원',
      description: [R.wd.reasonDisplay(md?.reason), md?.memo].filter(Boolean).join(' · ') || null });
  }
  const OUTCOME_LABEL = await outcomeLabels();
  for (const ec of enrollConsults) {
    const outcome = ec.outcome ? OUTCOME_LABEL[ec.outcome] : null;
    const body = ec.parent_request?.startsWith('ℹ️') ? null : ec.parent_request;
    events.push({ date: String(ec.consulted_at).slice(0, 10), kind: 'enrollment_consultation',
      title: [ec.subject ? subjectMaps.labelOf(ec.subject) : null, '입학 상담'].filter(Boolean).join(' '), description: [outcome, body].filter(Boolean).join(' · ') || null });
  }
  events.sort((a, b) => b.date.localeCompare(a.date) || (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''));
  return events;
}

export async function loadTab(ctx) {
  return { events: await readStudentTimeline(ctx) };
}
