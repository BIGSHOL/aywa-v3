// 2.0 화면 — 원생상담(목록 · 상세 · 작성 · 수정 · 통계) (V2-SCREENS.md `consultations`, 처리 화면 세션 R).
// 업무 흐름 신호 followup_due(상담 후속조치)가 여기서 끝난다 — 상세의 '완료 표시'(2.0 toggleConsultationFollowUp)로.
// 그리기는 2.0의 실제 React 부품(v2-host/src/consultations.tsx). 이 모듈은 2.0 서버 컴포넌트가 부품에 넘기던 값을 Docker 복사본에서 같은 모양으로 만든다:
//  · /consultations(page.tsx) = getStudentConsultationsPage · getStudentConsultationCounts · getConsultationCounselorOptions · 요약 띠(getConsultationStats)
//  · /consultations/<id>(상세) · /consultations/<id>/edit(수정) · /consultations/new(작성) · /consultations/stats(통계 — 집계 RPC · 상담 공백 · 담임별 현황 · 보기 설정)
//  · 반 칸의 선택지(2.0 getConsultationClassOptions — 읽기)는 op=classOptions 읽기 경로로(쓰기 기록에 남지 않게).
// 보는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 2.0 requireAccess('consultations')와 같은 메뉴 키로 고를 수 있는 사람(readPeople).
// 2.0은 세션 클라이언트 + RLS로 읽는다 — 읽기 트랜잭션 안에서 고른 사람의 신분으로 바꿔 같은 RLS를 지난다(보기 설정 · 담임 변경 감사로그 · 동기화 배지는
// 2.0도 관리 키로 읽으므로 신분을 바꾸기 전에). 강사는 2.0처럼 본인이 쓴 상담만(effectiveTeacherId) · 담당 학생만(학생 선택지).
// AI 분석은 저장된 결과만 보인다 — 새 분석·녹음·전사·업로드는 하지 않는다(v2-consultations-save.mjs).
import { readPeople } from './v2-proc-people.mjs';
import {
  actAsReader, classOptionsRead, consultationById, consultationCounts, consultationStats, consultationsPage, counselorOptions,
  homeroomHistory, homeroomStats, loadConsultRules, makeeduSyncState, newcomerLinkTargets, resolvedSettings, retiredStaffIds, statsPrefs,
  studentOptions, teacherIdOf, teacherOptions,
} from './v2-consultations-read.mjs';
import { consultationActions } from './v2-consultations-save.mjs';
import { overviewPrograms } from './v2-overview-program.mjs';
import { consultationOverview } from './v2-consultations-overview.mjs';

const ID = 'consultations', MENU = 'consultations';
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_BODY}$`, 'i');
const DETAIL = new RegExp(`^/consultations/(${UUID_BODY})$`, 'i'), EDIT = new RegExp(`^/consultations/(${UUID_BODY})/edit$`, 'i');
const msg = e => (e instanceof Error ? e.message : String(e));

/** 목록·통계가 같이 쓰는 필터(2.0 ConsultationListFilters) + 목록 주소 열쇠(ConsultationListParams). */
function filtersOf(R, params, subjects) {
  const one = k => params[k] ?? '';
  const listParams = {
    range: one('range') || 'all', cat: one('cat') || 'all', urg: one('urg') || 'all', who: one('who'), subject: one('subject'), q: one('q'),
    size: R.pageSize.clampPageSize(one('size') || undefined, R.listHref.CONSULT_DEFAULT_PAGE_SIZE), page: Math.max(1, Number(one('page')) || 1), studentId: one('studentId'),
  };
  const filters = { q: listParams.q, range: listParams.range, cat: listParams.cat, urg: listParams.urg, counselor: listParams.who || undefined,
    subject: listParams.subject || undefined, subjectLabel: listParams.subject ? subjects.labelOf(listParams.subject) : null, studentId: listParams.studentId || undefined };
  return { listParams, filters };
}

async function build({ sql, params, tenantId: t, importV2 }) {
  const [R, people] = await Promise.all([loadConsultRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const settings = resolvedSettings(people);
  const base = { editors: people.editorList, operations: settings.operations, modules: { disabled: settings.modules?.disabled ?? [] } };
  const u = people.pick(params.actor);
  if (!u) return { ...base, page: 'noMenu' };
  const user = { id: u.id, displayName: u.display_name, systemRole: u.role, tenantId: t };
  const teacherId = teacherIdOf(u);
  const path = params.v2path ?? '/consultations';
  const overview = !params.v2path;
  const subjects = R.subjects.buildSubjectMaps(settings.operations.subjects);

  // 반 칸 선택지(읽기) — 2.0 getConsultationClassOptions 반환 그대로.
  if (params.op === 'classOptions') {
    await actAsReader(sql, u);
    return { result: await classOptionsRead(sql, R, people, settings, u, { studentId: params.cStudent, consultedAt: params.cAt, counselorId: params.cCounselor, subject: params.cSubject }) };
  }

  const stats = path === '/consultations/stats';
  // 2.0이 관리 키로 읽는 것 — 신분을 바꾸기 전에.
  const [prefs, history, syncState] = await Promise.all([
    stats ? statsPrefs(sql, R, t, u.id) : null,
    stats || overview ? homeroomHistory(sql, R, t) : null,
    path === '/consultations' && !overview ? makeeduSyncState(sql, R, settings, t, 'consultations') : null,
  ]);
  await actAsReader(sql, u); // 여기부터 2.0 세션 클라이언트와 같은 RLS
  const shared = { ...base, user, teacherId };

  if (overview) {
    const programs = await overviewPrograms(importV2, settings, R.modules);
    const homeroom = await homeroomStats(sql, R, settings, teacherId, history, programs);
    const model = consultationOverview(homeroom, { program: params.program, teacher: params.teacher, actor: u.id });
    return { ...shared, page: 'overview', overview: model };
  }

  const detail = DETAIL.exec(path), edit = EDIT.exec(path);
  if (detail) {
    const item = await consultationById(sql, R, settings, detail[1], teacherId);
    return item ? { ...shared, page: 'detail', item } : { ...shared, page: 'notFound' };
  }
  if (edit) {
    const [item, students, counselors] = await Promise.all([consultationById(sql, R, settings, edit[1], teacherId), studentOptions(sql, R, teacherId), teacherOptions(sql)]);
    if (!item) return { ...shared, page: 'notFound' };
    // 신규생 관리 칸 — 못 읽어도 상담 수정은 된다(칸만 안 뜬다) · 고를 수 있는 학생의 것만.
    let newcomerTargets = [];
    try { newcomerTargets = await sql.savepoint(sp => newcomerLinkTargets(sp, R, settings, item.id)); } catch { /* 2.0 .catch(() => []) */ }
    return { ...shared, page: 'edit', item, students, counselors, newcomerTargets: newcomerTargets.filter(x => students.some(s => s.id === x.studentId)) };
  }
  if (path === '/consultations/new') {
    const [students, counselors] = await Promise.all([studentOptions(sql, R, teacherId), teacherOptions(sql)]);
    let newcomerTargets = [];
    try { newcomerTargets = await sql.savepoint(sp => newcomerLinkTargets(sp, R, settings, undefined)); } catch { /* 칸만 안 뜬다 */ }
    return { ...shared, page: 'new', students, counselors, templates: settings.consultations?.templates ?? [], classSupported: true,
      newcomerTargets: newcomerTargets.filter(x => students.some(s => s.id === x.studentId)) };
  }

  const { listParams, filters } = filtersOf(R, params, subjects);
  const syncOn = R.modules.isModuleEnabled(settings.modules?.disabled, 'makeedu');
  if (stats) {
    const options = await counselorOptions(sql, teacherId);
    // 통계 본문 — 집계가 실패해도 화면 틀은 산다. 담임별 현황은 실패해도 위 통계는 산다.
    let panel;
    try {
      panel = await sql.savepoint(async sp => {
        const [st, retired] = await Promise.all([consultationStats(sp, R, filters, teacherId), retiredStaffIds(sp)]);
        let homeroom = null;
        try { homeroom = await sp.savepoint(s2 => homeroomStats(s2, R, settings, teacherId, history)); }
        catch (e) { console.error('[consultations] 담임별 상담 현황 조회 실패:', msg(e)); }
        return { stats: st, retiredIds: [...retired], homeroom };
      });
    } catch (e) { panel = { error: msg(e) }; }
    return { ...shared, page: 'stats', listParams, filters, counselorOptions: options, syncOn, prefs, panel };
  }
  if (path !== '/consultations') return { ...shared, page: 'notFound' };

  const [list, counts, options] = await Promise.all([
    consultationsPage(sql, R, settings, filters, teacherId, listParams.page, listParams.size),
    consultationCounts(sql, R, teacherId),
    counselorOptions(sql, teacherId),
  ]);
  // 요약 띠 — 검색어 빼고 통계와 같은 조건. 실패해도 목록은 산다(띠 자리에 한 줄).
  let summary;
  try { summary = { stats: await sql.savepoint(sp => consultationStats(sp, R, { ...filters, q: '' }, teacherId)) }; }
  catch (e) { summary = { error: msg(e) }; }
  return { ...shared, page: 'list', listParams, filters, items: list.rows, total: list.total, classSupported: list.classSupported, counts, counselorOptions: options,
    canImportExcel: people.level(u, MENU) === 'full', syncOn, summary, syncState, canManageOwner: people.level(u, 'owner') !== 'none' };
}

const EMPTY_OK = re => new RegExp(`^(?:${re.source.replace(/^\^|\$$/g, '')})?$`, re.flags);
export const screen = {
  id: ID, label: '원생상담', order: 43,
  overview: { purpose: '담임별 월간 상담 이행과 지도 대상을 판단합니다.', layers: [{ key: 'program', label: '프로그램' }, { key: 'teacher', label: '담임' }, { key: 'student', label: '원생 상담 목록' }],
    columns: [{ key: 'name', label: '강사' }, { key: 'target', label: '상담 대상 원생' }, { key: 'rate', label: '이행률' }], listFilters: ['program', 'teacher', 'studentId'] },
  params: {
    actor: UUID,
    v2path: new RegExp(`^/consultations(?:/new|/stats|/${UUID_BODY}(?:/edit)?)?$`, 'i'),
    range: EMPTY_OK(/^(?:all|7d|30d)$/), cat: EMPTY_OK(/^[a-z_]{1,20}$/), urg: EMPTY_OK(/^[a-z]{1,10}$/), who: /^[\w-]{0,40}$/, subject: /^[\w-]{0,40}$/,
    q: /^[^\u0000-\u001f]{0,100}$/, page: /^\d{0,5}$/, size: /^\d{0,4}$/,
    studentId: EMPTY_OK(UUID), form: /^[\w-]{0,64}$/, recordStudent: EMPTY_OK(UUID),
    program: /^(?:eie|injaewon|math)$/, teacher: UUID,
    op: /^classOptions$/, cStudent: /^[\w-]{0,40}$/, cAt: /^[\dT:.-]{0,30}$/, cCounselor: /^[\w-]{0,40}$/, cSubject: /^[^\u0000-\u001f]{0,60}$/,
  },
  actions: consultationActions,
  load: build,
};
