// 2.0 화면 — 신규 콜&상담(칸반 · 목록 · 통계 · 상세 · 새 상담 · 수정) (V2-SCREENS.md `enrollment`, 팀장 세션 L · 작업자 v2-enrollment).
// 그리기는 2.0의 실제 React 부품(v2-host/src/enrollment.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 같은 결과로:
//  · 칸반·목록 = v2-enrollment-list.mjs(2.0 server/queries.ts 목록 함수들) — 2.0 page.tsx가 부품에 넘기던 props 그대로.
//  · 통계 = v2-enrollment-stats.mjs(2.0 server/stats-queries.ts · intake-trend · management-attending · 매일 기록 · 퇴원 창) · 상세·수정 = v2-enrollment-detail.mjs · 저장 = v2-enrollment-save.mjs.
//  · 저장하는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 2.0 requireAccess('enrollment')를 지나는 사람(신규 콜&상담 메뉴가 열린 재직 직원).
//    칸반 끌기·목록 칸 수정(canWrite) · 엑셀 가져오기(full) · 수강료 계산기(수납 열람)는 그 사람의 권한으로(2.0과 같은 판정 — v2-proc-people.mjs).
//  · 계정 보기 설정(ui_prefs)은 쓰지 않는다 — 3.0엔 계정이 없어 보기는 주소(view=)로만 · 기본은 칸반(2.0 savedEnrollmentView({})).
//
// 2.0 서버 함수 대응표(호스트가 부르는 이름 = actions 이름)
//  | 2.0 함수(모듈)                                            | 여기                         |
//  | getConsultationTotalCount(server/poll-actions.ts) — 20초 폴링 | 읽기 — GET ?poll=count(쓰기 경로 아님) |
//  | loadReferrerOptions(server/referrer-actions.ts) — 소개한 사람 목록 | 읽기 — GET ?referrers=1(쓰기 권한 필요) |
//  | updateEnrollmentConsultation(server/actions.ts) — 상담 수정      | actions.updateEnrollmentConsultation(v2-enrollment-save.mjs) |
//  | regenerateConsultationAnalysis · generatePrepBrief(prep-actions) · issueAudioUploadTicket(media) — AI·녹음 | 호스트가 보내지 않고 { error: 지원하지 않는 기능 } |
//  | createEnrollmentConsultation(server/actions.ts) — 새 상담        | actions.createEnrollmentConsultation |
//  | setEnrollmentOutcome(server/actions.ts) — 칸반 끌기·상태 칸·상태 변경 | actions.setEnrollmentOutcome |
//  | patchConsultationCells(server/actions.ts) — 목록 칸 수정        | actions.patchConsultationCells |
//  | 통계의 보기 설정(view-pref-actions 다섯 · saveSchoolStatsPrefs) — 계정 저장 | 호스트가 보내지 않고 { ok:false }(3.0엔 계정이 없다 · 부품은 결과를 기다리지 않는다) |
//  | deleteEnrollmentConsultation(server/actions.ts) — 상담 삭제 | actions.deleteEnrollmentConsultation(성공 = { redirectTo } → 호스트가 이동 · 2.0 redirect) |
//  | updateConsultationReportSection(server/actions.ts) — AI 리포트 섹션 글 고치기(사람) | actions.updateConsultationReportSection |
//  | appendAiSummaryToConsultationContent(server/actions.ts) — 저장된 요약 붙이기(AI 호출 없음) | actions.appendAiSummaryToConsultationContent |
//  | previewConsultationMerge(server/merge-actions.ts) — 병합 미리보기 | 읽기 — GET ?mergeIds=a,b[&mergeWinner=] |
//  | mergeConsultations(server/merge-actions.ts) — 병합 | actions.mergeConsultations(DB 함수 merge_enrollment_consultations를 고른 사람 신분으로 · asViewer) |
//  | convertConsultationToStudent(server/actions.ts) — 수업 배정 | actions.convertConsultationToStudent(학생·수강·상담 연결은 고른 사람 신분 · 반 담임 알림 줄까지) |
//
// 호스트에 붙일 때(의존)
//  · Next 전용: next/link · next/navigation(useRouter — enrollment-kanban · column-cards · sheet-editable-cells · new-consultation-watcher · month-picker) ·
//    next/dynamic(stats-trend · trend-chart) — shim 있음. next/headers(intake-qr-section — 서버 컴포넌트라 호스트에서 뺐다).
//  · 서버 컴포넌트(호스트에서 뺌): IntakeQrSection · MakeeduPushSection · MakeeduSyncBadge · RememberPrefs(계정 저장).
//  · 서버 액션 모듈: features/enrollment/server/actions.ts(setEnrollmentOutcome · patchConsultationCells · 저장 함수들) ·
//    server/merge-actions.ts(previewConsultationMerge · mergeConsultations) · server/poll-actions.ts · server/view-pref-actions.ts ·
//    server/school-prefs-actions.ts · server/referrer-actions.ts · server/intake-actions.ts · features/media/server/upload-actions.ts.
//  · 브라우저 Supabase(실시간 '수정 중' 표시 — features/presence) = shim(아무것도 받지 않음).
import { UUID, deepMerge, readPeople, serverCall } from './v2-proc-people.mjs';
import { buildList, getConsultationTotalCount, listRules } from './v2-enrollment-list.mjs';
import { activeClasses, canViewClasses, detailRules, findMergeSuccessor, getAssignedClasses, getEnrollmentConsultationById, getSiblingConsultations,
  listReferrerOptions, loadConsultationReferrer, referrerCandidatesFor } from './v2-enrollment-detail.mjs';
import { buildStats } from './v2-enrollment-stats.mjs';
import { appendAiSummaryToConsultationContent, convertConsultationToStudent, createEnrollmentConsultation, deleteEnrollmentConsultation, formDataOf, patchConsultationCells, setEnrollmentOutcome,
  mergeConsultations, previewConsultationMerge, updateConsultationReportSection, updateEnrollmentConsultation } from './v2-enrollment-save.mjs';

const ID = 'enrollment', MENU = 'enrollment', ACTIONS = 'features/enrollment/server/actions.ts';
const UUID_BODY = UUID.source.slice(1, -1);
const DETAIL = new RegExp(`^/enrollment/(${UUID_BODY})(/edit)?$`, 'i');

let rulesP = null;
function rules(importV2) {
  rulesP ??= Promise.all([listRules(importV2), importV2('features/enrollment/view-pref.ts')])
    .then(([list, view]) => ({ ...list, view })).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

/** 2.0 접근 판정(역할 매트릭스 + 학원 설정 + 개인 예외) — 고른 사람으로. */
function viewerOf(people, actorId) {
  const u = people.pick(actorId);
  if (!u) return null;
  const lv = (m) => people.level(u, m);
  return { u, canWrite: ['full', 'scoped'].includes(lv(MENU)), canManage: lv(MENU) === 'full', canBilling: lv('billing') !== 'none', canExits: lv('withdrawals') !== 'none',
    canTextbook: ['full', 'scoped'].includes(lv('textbook_requests')), classLevel: lv('classes') };
}
const modulesOf = (settings) => { const m = deepMerge(settings.base.modules ?? { disabled: [] }, settings.stored?.modules); return { disabled: Array.isArray(m?.disabled) ? m.disabled : [] }; };

/** 상세(2.0 [id]/page.tsx)·수정([id]/edit/page.tsx) — 없는 상담이면 병합으로 남은 상담 주소(2.0 redirect) 또는 notFound. */
async function buildDetail({ sql, t, importV2, v, operations, modules, id, edit }) {
  const D = await detailRules(importV2);
  const consult = await getEnrollmentConsultationById(sql, D, t, id, operations.subjects);
  if (!consult) {
    const successor = await findMergeSuccessor(sql, t, id);
    return successor ? { page: 'redirect', to: `/enrollment/${successor}${edit ? '/edit' : ''}` } : { page: 'missing' };
  }
  const referrer = await loadConsultationReferrer(sql, D, t, id);
  if (edit) {
    const f = consult.fields;
    const candidates = referrer.ready && !referrer.referrer
      ? await referrerCandidatesFor(sql, D, t, { referrerName: referrer.referrerName, path: f.consultationPath, texts: [consult.parentRequest, f.safetyNotes, f.siblingsDetails] })
      : [];
    return { page: 'edit', id, viewer: { id: v.u.id, tenantId: t }, consult, referrer, candidates };
  }
  const { showAssigned } = (await importV2('features/enrollment/detail-panels.ts')).detailPanelsFor({ outcome: consult.outcome, assignedClassCount: consult.assignedClassCount });
  const [allClasses, siblings, assigned] = await Promise.all([
    activeClasses(sql, t), getSiblingConsultations(sql, D, t, id),
    showAssigned ? getAssignedClasses(sql, D, t, consult.studentId, consult.fields.subject, operations) : null,
  ]);
  const canOpenClass = showAssigned && assigned?.ok ? await canViewClasses(sql, v.classLevel, v.u.id, assigned.rows.map((r) => r.classId)) : false;
  return { page: 'detail', consult, allClasses, settings: { operations, modules }, siblings, canWrite: v.canWrite, canRequestTextbook: v.canTextbook, referrer, assigned, canOpenClass };
}

async function load({ sql, params, tenantId: t, importV2 }) {
  // 20초 폴링(2.0 getConsultationTotalCount) — 건수만(사람·설정은 읽지 않는다).
  if (params.poll === 'count') return { page: 'poll', count: await getConsultationTotalCount(sql, t) };
  const [R, people] = await Promise.all([rules(importV2), readPeople(sql, t, importV2, MENU)]);
  const settings = people.settings, operations = settings.operations;
  const modules = modulesOf(settings);
  const base = { editors: people.editorList, operations, modules };
  const v = viewerOf(people, params.actor);
  if (!v) return { ...base, page: 'noMenu' };
  // '소개한 사람' 고르기 목록(2.0 loadReferrerOptions — 읽기라 GET) · 쓰기 권한이 있어야(2.0 같은 문).
  if (params.referrers === '1') {
    if (!v.canWrite) return { page: 'referrers', result: { ok: false, error: '신규 콜&상담 권한이 없습니다' } };
    return { page: 'referrers', result: { ok: true, options: await listReferrerOptions(sql, await detailRules(importV2), t) } };
  }
  // 병합 미리보기(2.0 previewConsultationMerge — 읽기라 GET) · 같은 판정(planMerge)·같은 문구.
  if (params.mergeIds) {
    const e = people.editors.find((x) => x.id === v.u.id);
    return { page: 'mergePreview', result: await previewConsultationMerge({ sql, t, importV2, canWrite: v.canWrite, user: e ? { id: e.id } : null }, params.mergeIds.split(','), params.mergeWinner) };
  }
  const path = params.v2path ?? '/enrollment';
  // 새 상담(2.0 new/page.tsx) — 보는 사람 + 소개 칸이 DB에 있는지(2.0 referrerColumnsReady — #95).
  if (path === '/enrollment/new') {
    const [col] = await sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'enrollment_consultations' and column_name = 'referrer_name'`;
    return { ...base, page: 'new', viewer: { id: v.u.id, tenantId: t, displayName: v.u.display_name }, referrerReady: !!col };
  }
  const detail = DETAIL.exec(path);
  if (detail) return { ...base, ...(await buildDetail({ sql, t, importV2, v, operations, modules, id: detail[1].toLowerCase(), edit: !!detail[2] })) };
  if (path !== '/enrollment') return { ...base, page: 'notFound' };
  const uiPrefs = {};
  const view = R.view.parseEnrollmentView(params.view) ?? R.view.savedEnrollmentView(uiPrefs);
  const list = await buildList({ sql, R, t, sp: params, view, subjects: operations.subjects });
  // 통계 보기(page.tsx view=stats) — 연도·두 추이 카드·관리현황('등록 후 퇴원'은 퇴원관리를 열 수 있는 사람에게만 · 2.0 canSeeExits).
  const stats = view === 'stats' ? await buildStats({ sql, importV2, t, sp: params, subjects: operations.subjects, actorId: v.u.id, canSeeExits: v.canExits }) : null;
  return {
    ...base, page: 'list',
    canWriteEnrollment: v.canWrite, canOpenCalculator: v.canBilling, canImportExcel: v.canManage,
    // makeedu 보내기 = 바깥 전송(makeedu 큐) — 연습 화면에서는 단추째 없다(2.0도 권한이 없으면 자리째 없다).
    canPushMakeedu: false, uiPrefs,
    ...list,
    statsYears: [], schoolPrefs: null, progressRows: null, intake: null, stats: null, dist: null, withdrawals: null,
    ...stats,
  };
}

// ── 저장(2.0 server/actions.ts) ─────────────────────────────────────────────────────────────────────────────────────────
/** 저장하는 사람 = 3.0 띠에서 고른 직원(신규 콜&상담 메뉴가 열린 사람 · 쓰기는 2.0과 같은 판정으로 함수가 다시 본다). */
async function actCtx({ sql, body, tenantId: t, importV2 }) {
  const people = await readPeople(sql, t, importV2, MENU);
  const e = typeof body.actor === 'string' ? people.editors.find((x) => x.id === body.actor) : null;
  const v = e ? viewerOf(people, e.id) : null;
  return { sql, t, importV2, people, operations: people.settings.operations, canWrite: !!v?.canWrite, v,
    user: e ? { id: e.id, tenantId: t, displayName: e.display_name, systemRole: e.role, row: e } : null };
}
const ACT = (argCount, fn) => ({ validate: (raw) => serverCall(raw, [ACTIONS], argCount), run: async (ctx) => fn(await actCtx(ctx), ctx.body.args) });
/** 병합은 2.0 server/merge-actions.ts에 있다. */
const ACTM = (argCount, fn) => ({ validate: (raw) => serverCall(raw, ['features/enrollment/server/merge-actions.ts'], argCount), run: async (ctx) => fn(await actCtx(ctx), ctx.body.args) });

const YM = /^\d{4}-\d{2}$/, YMD = /^\d{4}-\d{2}-\d{2}$/;
export const screen = {
  id: ID, label: '신규 콜&상담', order: 30,
  params: {
    // embed=1 — 2.0 칸반 카드가 상세를 창으로 열 때 붙인다(호스트 이동이 그대로 실어 온다). 연습 화면엔 창 셸이 없어 받기만 하고 쓰지 않는다(Codex 검수 10-28: 없으면 400).
    embed: /^1$/,
    actor: UUID, v2path: new RegExp(`^/enrollment(?:/new|/${UUID_BODY}(?:/edit)?)?$`, 'i'), poll: /^count$/,
    view: /^(?:kanban|table|stats)$/, month: /^.{0,10}$/, consultant: /^.{0,40}$/, q: /^[\s\S]{0,100}$/, outcome: /^[a-z_]{0,20}$/, page: /^\d{1,5}$/,
    range: /^[0-9a-z]{0,4}$/, year: /^[0-9y]{1,4}$/, received: /^.{0,10}$/, from: /^[a-z]{0,20}$/,
    trend: /^[a-z]{0,10}$/, trendMonth: YM, trendFrom: YMD, trendTo: YMD, trendSpan: /^[0-9a-z]{0,6}$/,
    pg: /^[a-z]{0,10}$/, pgMonth: YM, pgFrom: YMD, pgTo: YMD, pgSpan: /^[0-9a-z]{0,6}$/, referrers: /^1$/, form: /^[A-Za-z0-9_-]{1,64}$/,
    mergeIds: new RegExp(`^${UUID_BODY}(?:,${UUID_BODY}){0,19}$`, 'i'), mergeWinner: UUID,
  },
  paramMax: { mergeIds: 800 },
  actions: {
    updateEnrollmentConsultation: ACT(2, (c, args) => updateEnrollmentConsultation(c, formDataOf(args[1]))),
    createEnrollmentConsultation: ACT(2, (c, args) => createEnrollmentConsultation(c, formDataOf(args[1]))),
    setEnrollmentOutcome: ACT(2, (c, args) => setEnrollmentOutcome(c, formDataOf(args[1]))),
    patchConsultationCells: ACT(2, (c, args) => patchConsultationCells(c, args[0], args[1])),
    deleteEnrollmentConsultation: ACT(2, (c, args) => deleteEnrollmentConsultation(c, formDataOf(args[1]))),
    updateConsultationReportSection: ACT(2, (c, args) => updateConsultationReportSection(c, formDataOf(args[1]))),
    appendAiSummaryToConsultationContent: ACT(1, (c, args) => appendAiSummaryToConsultationContent(c, args[0])),
    convertConsultationToStudent: ACT(2, (c, args) => convertConsultationToStudent(c, formDataOf(args[1]))),
    mergeConsultations: ACTM(3, (c, args) => mergeConsultations(c, args[0], args[1], args[2] ?? {})),
  },
  load,
};
