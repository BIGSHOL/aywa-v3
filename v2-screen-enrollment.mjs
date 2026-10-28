// 2.0 화면 — 신규 콜&상담(칸반 · 목록 · 통계 · 상세 · 새 상담 · 수정) (V2-SCREENS.md `enrollment`, 팀장 세션 L · 작업자 v2-enrollment).
// 그리기는 2.0의 실제 React 부품(v2-host/src/enrollment.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 같은 결과로:
//  · 칸반·목록 = v2-enrollment-list.mjs(2.0 server/queries.ts 목록 함수들) — 2.0 page.tsx가 부품에 넘기던 props 그대로.
//  · 저장하는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 2.0 requireAccess('enrollment')를 지나는 사람(신규 콜&상담 메뉴가 열린 재직 직원).
//    칸반 끌기·목록 칸 수정(canWrite) · 엑셀 가져오기(full) · 수강료 계산기(수납 열람)는 그 사람의 권한으로(2.0과 같은 판정 — v2-proc-people.mjs).
//  · 계정 보기 설정(ui_prefs)은 쓰지 않는다 — 3.0엔 계정이 없어 보기는 주소(view=)로만 · 기본은 칸반(2.0 savedEnrollmentView({})).
//
// 2.0 서버 함수 대응표(호스트가 부르는 이름 = actions 이름)
//  | 2.0 함수(모듈)                                            | 여기                         |
//  | getConsultationTotalCount(server/poll-actions.ts) — 20초 폴링 | 읽기 — GET ?poll=count(쓰기 경로 아님) |
//
// 호스트에 붙일 때(의존)
//  · Next 전용: next/link · next/navigation(useRouter — enrollment-kanban · column-cards · sheet-editable-cells · new-consultation-watcher · month-picker) ·
//    next/dynamic(stats-trend · trend-chart) — shim 있음. next/headers(intake-qr-section — 서버 컴포넌트라 호스트에서 뺐다).
//  · 서버 컴포넌트(호스트에서 뺌): IntakeQrSection · MakeeduPushSection · MakeeduSyncBadge · RememberPrefs(계정 저장).
//  · 서버 액션 모듈: features/enrollment/server/actions.ts(setEnrollmentOutcome · patchConsultationCells · 저장 함수들) ·
//    server/merge-actions.ts(previewConsultationMerge · mergeConsultations) · server/poll-actions.ts · server/view-pref-actions.ts ·
//    server/school-prefs-actions.ts · server/referrer-actions.ts · server/intake-actions.ts · features/media/server/upload-actions.ts.
//  · 브라우저 Supabase(실시간 '수정 중' 표시 — features/presence) = shim(아무것도 받지 않음).
import { UUID, deepMerge, readPeople } from './v2-proc-people.mjs';
import { buildList, getConsultationTotalCount, listRules } from './v2-enrollment-list.mjs';

const ID = 'enrollment', MENU = 'enrollment';
const UUID_BODY = UUID.source.slice(1, -1);

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
  return { u, canWrite: ['full', 'scoped'].includes(lv(MENU)), canManage: lv(MENU) === 'full', canBilling: lv('billing') !== 'none', canExits: lv('withdrawals') !== 'none' };
}

async function load({ sql, params, tenantId: t, importV2 }) {
  // 20초 폴링(2.0 getConsultationTotalCount) — 건수만(사람·설정은 읽지 않는다).
  if (params.poll === 'count') return { page: 'poll', count: await getConsultationTotalCount(sql, t) };
  const [R, people] = await Promise.all([rules(importV2), readPeople(sql, t, importV2, MENU)]);
  const settings = people.settings, operations = settings.operations;
  const modules = deepMerge(settings.base.modules ?? { disabled: [] }, settings.stored?.modules);
  const base = { editors: people.editorList, operations, modules: { disabled: Array.isArray(modules?.disabled) ? modules.disabled : [] } };
  const v = viewerOf(people, params.actor);
  if (!v) return { ...base, page: 'noMenu' };
  const path = params.v2path ?? '/enrollment';
  if (path !== '/enrollment') return { ...base, page: 'notFound' };
  const uiPrefs = {};
  const view = R.view.parseEnrollmentView(params.view) ?? R.view.savedEnrollmentView(uiPrefs);
  const list = await buildList({ sql, R, t, sp: params, view, subjects: operations.subjects });
  return {
    ...base, page: 'list',
    canWriteEnrollment: v.canWrite, canOpenCalculator: v.canBilling, canImportExcel: v.canManage,
    // makeedu 보내기 = 바깥 전송(makeedu 큐) — 연습 화면에서는 단추째 없다(2.0도 권한이 없으면 자리째 없다).
    canPushMakeedu: false, uiPrefs,
    ...list,
    // 통계 보기 자료(4단계)
    statsYears: [], schoolPrefs: null, progressRows: null, intake: null, stats: null, dist: null, withdrawals: null,
  };
}

const YM = /^\d{4}-\d{2}$/, YMD = /^\d{4}-\d{2}-\d{2}$/;
export const screen = {
  id: ID, label: '신규 콜&상담', order: 30,
  params: {
    actor: UUID, v2path: new RegExp(`^/enrollment(?:/new|/${UUID_BODY}(?:/edit)?)?$`, 'i'), poll: /^count$/,
    view: /^(?:kanban|table|stats)$/, month: /^.{0,10}$/, consultant: /^.{0,40}$/, q: /^[\s\S]{0,100}$/, outcome: /^[a-z_]{0,20}$/, page: /^\d{1,5}$/,
    range: /^[0-9a-z]{0,4}$/, year: /^[0-9y]{1,4}$/, received: /^.{0,10}$/, from: /^[a-z]{0,20}$/,
    trend: /^[a-z]{0,10}$/, trendMonth: YM, trendFrom: YMD, trendTo: YMD, trendSpan: /^[0-9a-z]{0,6}$/,
    pg: /^[a-z]{0,10}$/, pgMonth: YM, pgFrom: YMD, pgTo: YMD, pgSpan: /^[0-9a-z]{0,6}$/,
  },
  actions: {},
  load,
};
