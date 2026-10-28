// 원생 상세 '진도' 탭 자료 — 2.0 progress-tab.tsx(ProgressTab) · progress-panel.tsx(ProgressContainerPanel)가 서버에서 읽던 값을 Docker 복사본에서 같은 결과로.
// · first / shown = getStudentLessonReportsPage(10건 · 보고서 날짜 내림차순 + id 내림차순 · 날짜 조회는 양 끝 포함 · 모양이 어긋난 날짜는 무시) —
//   학부모 열람 수(share_link_views) · 과목(reportSubject: 보고서 과목 → 반 과목 → 옛 이관분 수학) · 링크 상태(회수 · 90일 만료 — 오늘 = 복사본 날짜).
//   끝 쪽 너머 쪽 번호면 마지막 쪽을 한 번 더 읽는다(page.tsx와 같은 규칙 — shown).
// · analytics = getStudentProgressAnalytics — 활성 컨테이너(현행/선행)별 위치·속도·또래 백분위·예측 + 이상 감지(미확인 20 · 확인 8) — 산출은 2.0 순수 함수.
// · anomalyGate = 패널의 '이상 없음' 버튼 판정 재료(원생 권한 수준 · 담당 학생 여부 — 원장은 담당 갈래가 아니다).
// · settings = 과목 이름 · ClassNote 스위치(학원 설정). 읽기 전용.
const MODULES = { analytics: 'features/progress/analytics.ts', position: 'features/progress/curriculum-position.ts', jump: 'features/progress/same-teacher-jump.ts',
  share: 'features/onescreen/share-expiry.ts', subject: 'features/timetable/lib/report-subject.ts' };
let modsP = null;
const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

export const PAGE_SIZE = 10; // 2.0 STUDENT_REPORTS_PAGE_SIZE
const WINDOW_DAYS = 30; // 2.0 progress/server/queries.ts
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** getStudentLessonReportsPage — { rows, total }. */
export async function readReportsPage(sql, t, id, M, today, { page = 1, from = null, to = null } = {}) {
  page = Math.max(1, Math.floor(page));
  const f = from && ISO.test(from) ? from : null, e = to && ISO.test(to) ? to : null;
  const where = sql.frag`tenant_id=${t} and student_id=${id} ${f ? sql.frag`and report_date >= ${f}::date` : sql.frag``} ${e ? sql.frag`and report_date <= ${e}::date` : sql.frag``}`;
  const [{ n: total }] = await sql`select count(*)::int n from public.lesson_reports where ${where}`;
  const data = await sql`select id::text id, report_date::text report_date, progress, exam_info, homework_score, teacher_name, classnote_status,
      revoked_at is not null revoked, subject, class_id::text class_id
    from public.lesson_reports where ${where} order by report_date desc, id desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  if (!data.length) return { rows: [], total };
  const ids = data.map((r) => r.id), classIds = [...new Set(data.map((r) => r.class_id).filter(Boolean))];
  const views = await sql`select lesson_report_id::text lesson_report_id from public.share_link_views where tenant_id=${t} and lesson_report_id = any(${ids}::uuid[])`;
  const classRows = classIds.length ? await sql`select id::text id, subject from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])` : [];
  const classSubject = new Map(classRows.map((c) => [c.id, c.subject])), viewCount = new Map();
  for (const v of views) viewCount.set(v.lesson_report_id, (viewCount.get(v.lesson_report_id) ?? 0) + 1);
  return {
    total,
    rows: data.map((r) => ({
      id: r.id, reportDate: r.report_date, progress: r.progress, examInfo: r.exam_info, homeworkScore: r.homework_score, teacherName: r.teacher_name,
      classnoteStatus: r.classnote_status, linkStatus: r.revoked ? 'revoked' : M.share.isShareExpired(r.report_date, today) ? 'expired' : 'active',
      viewCount: viewCount.get(r.id) ?? 0, subject: M.subject.reportSubject({ subject: r.subject, classSubject: r.class_id ? classSubject.get(r.class_id) : null }),
    })),
  };
}

/** peerSpeeds — 같은 지점·같은 학년(퇴원 아님 — 상태가 비어도 포함)·같은 track의 활성 컨테이너 학생의 수업당 속도. */
async function peerSpeeds(sql, t, M, grade, track, today) {
  const peers = await sql`select id::text id, status::text status from public.students where tenant_id=${t} and grade=${grade}`;
  const ids = peers.filter((p) => p.status !== 'withdrawn').map((p) => p.id);
  if (!ids.length) return [];
  const conts = await sql`select id::text id, student_id::text student_id, status from public.progress_containers where tenant_id=${t} and track=${track} and student_id = any(${ids}::uuid[])`;
  const byStudent = new Map(), active = new Set();
  for (const c of conts) {
    if (!byStudent.has(c.student_id)) byStudent.set(c.student_id, new Set());
    byStudent.get(c.student_id).add(c.id);
    if (c.status === 'active') active.add(c.student_id);
  }
  const activeIds = [...active];
  if (!activeIds.length) return [];
  const entries = await sql`select student_id::text student_id, global_position, entry_date::text entry_date, container_id::text container_id
    from public.progress_entries where tenant_id=${t} and student_id = any(${activeIds}::uuid[])`;
  const list = new Map();
  for (const e of entries) {
    if (!byStudent.get(e.student_id)?.has(e.container_id)) continue;
    if (!list.has(e.student_id)) list.set(e.student_id, []);
    list.get(e.student_id).push({ globalPosition: e.global_position, entryDate: e.entry_date });
  }
  return activeIds.map((sid) => M.analytics.computeSpeedStats(list.get(sid) ?? [], WINDOW_DAYS, today).speedPerLessonDay);
}

/** getStudentProgressAnalytics — StudentProgressAnalytics 모양 그대로. */
export async function readProgressAnalytics(sql, t, id, M, today) {
  const { describePosition, TOTAL_LESSONS } = M.position;
  const [stu] = await sql`select grade from public.students where tenant_id=${t} and id=${id}`;
  if (!stu) return { studentGrade: null, tracks: [], totalLessons: TOTAL_LESSONS, anomalies: [] };
  const studentGrade = stu.grade ?? null;
  const events = (resolved) => sql`select e.id::text id, e.event_type, to_json(e.created_at)#>>'{}' created_at, e.from_position, e.to_position, e.jump_size,
      to_json(e.resolved_at)#>>'{}' resolved_at, e.resolved_by::text resolved_by, e.details, u.display_name resolver_name
    from public.progress_events e left join public.users u on u.id = e.resolved_by
    where e.tenant_id=${t} and e.student_id=${id} and e.event_type in ('jump_error', 'overlap_error') and ${resolved ? sql.frag`e.resolved_at is not null` : sql.frag`e.resolved_at is null`}
    order by e.created_at desc limit ${resolved ? 8 : 20}`;
  const containers = await sql`select id::text id, track, status, last_position, chapter_count, grade_scope from public.progress_containers where tenant_id=${t} and student_id=${id}`;
  const entryRows = await sql`select global_position, entry_date::text entry_date, container_id::text container_id from public.progress_entries where tenant_id=${t} and student_id=${id}`;
  const anomEvents = [...(await events(false)), ...(await events(true))];
  const describe = (pos) => { if (typeof pos !== 'number') return null; const d = describePosition(pos); return d ? { grade: d.grade, lesson: d.lesson } : null; };
  const anomalies = anomEvents.map((e) => ({
    id: e.id, type: e.event_type, at: e.created_at, from: describe(e.from_position), to: describe(e.to_position),
    jumpSize: typeof e.jump_size === 'number' ? e.jump_size : null, resolvedAt: e.resolved_at ?? null, resolvedByName: e.resolver_name ?? null,
    autoResolvedLabel: e.resolved_at && !e.resolved_by ? M.jump.jumpSuppressionLabel(e.details) : null,
  }));
  const contTrack = new Map(containers.map((c) => [c.id, c.track])), activeByTrack = new Map();
  for (const c of containers) if (c.status === 'active') activeByTrack.set(c.track, c);
  const tracks = [];
  for (const track of ['current', 'ahead']) {
    const active = activeByTrack.get(track);
    if (!active) continue;
    const trackEntries = entryRows.filter((e) => contTrack.get(e.container_id) === track).map((e) => ({ globalPosition: e.global_position, entryDate: e.entry_date }));
    const speed = M.analytics.computeSpeedStats(trackEntries, WINDOW_DAYS, today);
    const pool = studentGrade ? await peerSpeeds(sql, t, M, studentGrade, track, today) : [];
    const percentile = M.analytics.percentileOf(speed.speedPerLessonDay, pool);
    const cur = active.last_position != null ? describePosition(active.last_position) : null;
    const predictions = speed.speedPerDay > 0 && active.last_position != null
      ? M.analytics.predict(active.last_position, speed.speedPerDay, [30, 90]).map((p) => { const d = describePosition(p.position); return { days: p.days, grade: d?.grade ?? '', lesson: d?.lesson ?? '' }; })
      : [];
    tracks.push({ track, current: cur ? { position: cur.position, grade: cur.grade, unit: cur.unit, lesson: cur.lesson } : null, chapterCount: active.chapter_count ?? 0,
      gradeScope: active.grade_scope ?? null, progressPct: cur ? Math.round((cur.position / TOTAL_LESSONS) * 100) : 0, speedPerLessonDay: speed.speedPerLessonDay,
      lessonDays: speed.lessonDays, percentile, poolSize: pool.length, predictions });
  }
  return { studentGrade, tracks, totalLessons: TOTAL_LESSONS, anomalies };
}

export async function loadTab(ctx) {
  const { base, sql, t, id, today, sp } = ctx;
  const M = await mods(ctx.importV2);
  // page.tsx가 진도 탭에 넘기는 값 그대로(page = 1 이상 정수 · from·to = 주소 값 그대로 — 조회에선 날짜 모양만 쓴다).
  const page = Math.max(1, Math.floor(Number(sp.page) || 1)), from = sp.from ?? null, to = sp.to ?? null;
  const first = await readReportsPage(sql, t, id, M, today, { page, from, to });
  const shownPage = Math.min(page, Math.max(1, Math.ceil(first.total / PAGE_SIZE)));
  const shown = shownPage !== page ? await readReportsPage(sql, t, id, M, today, { page: shownPage, from, to }) : null;
  const analytics = await readProgressAnalytics(sql, t, id, M, today);
  return {
    first, shown, analytics,
    anomalyGate: { level: base.level('students'), owns: false },
    settings: { operations: { subjects: ctx.settings.operations.subjects }, modules: ctx.settings.modules },
  };
}
