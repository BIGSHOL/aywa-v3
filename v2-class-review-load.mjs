// 2.0 직원 평가(app/(shell)/class-review/**) — 화면 자료 = 2.0 서버 함수 그대로(공용 러너 읽기 · 고른 사람 신분 + RLS).
// 2.0 page.tsx 일곱(목록 · 포트폴리오 면 · 상세 · 채점 · 새 평가 · 문항 세트 · 종합)이 서버에서 받던 값을 같은 함수로 받는다:
//  · features/class-review/server/queries.ts — getReviewPrivileges · getReviewViewer · listClassReviews · getClassReview · getChecklistTemplates ·
//    myScoreSlot · observerColumns · observerLimitOf(순수 함수지만 서버 전용 모듈 안이라 러너로 부른다 — 브라우저 묶음에 서버 모듈을 싣지 않으려고)
//  · features/teacher-portfolio/server/queries.ts getPortfolioView — 🔴 2.0 게이트 그대로: 포트폴리오 면은 getReviewPrivileges().seePortfolio
//    (원장 역할 · 자기 눈)일 때만 **부른다**(못 지나면 조회 자체를 하지 않는다 — 2.0 page.tsx도 그 면일 때만 PortfolioFace를 그린다).
//  · lib/auth/perm-matrix.ts canWriteTenant · features/meetings/server/queries.ts getStaffOptions.
// 🔴 2.0이 브라우저에 보내지 않던 것은 여기서도 보내지 않는다 — 2.0 page는 서버에서 그리고 HTML만 보내지만 호스트는 자료째 받는다:
//  · 실명 열람 자격(seeNames)이 없으면 평가자·작성자 이름을 비운다(2.0 화면은 '평가자 A/B/C'로만 그린다). 단 평가자 관리 창(canManageObservers)은
//    2.0도 이름을 내려보낸다 — 그때는 둔다.
//  · 목록·종합은 코멘트 · 최종 총평 · 문항 스냅샷을 빼고 보낸다(2.0 목록 행·종합 표에 없는 칸).
// 계정 보기 설정(ui_prefs)은 읽지 않는다 — 3.0엔 계정이 없다(목록 보기 필터 = 2.0 기본값 · 점수 기준 상자 펼침 · 비교 정렬 기본).
import { V2Error } from './v2-screens.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const Q = 'features/class-review/server/queries.ts', P = 'features/teacher-portfolio/server/queries.ts';
const PERM = 'lib/auth/perm-matrix.ts', STAFF = 'features/meetings/server/queries.ts';

export const read = (t, actorId, steps) => runV2Server({ steps, actorId, tenantId: t, mode: 'read' })
  .then(({ results }) => results.map((r) => r.value))
  .catch(() => { throw new V2Error(500, 'load_failed', '직원 평가를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); });

/** 이름 비우기(실명 열람 자격이 없을 때) — 2.0 화면이 그리지 않는 칸만. id·제출 시각·점수는 그대로(판정에 쓴다). */
export function hideNames(doc) {
  return {
    ...doc,
    evaluators: doc.evaluators.map((e) => ({ ...e, name: '' })),
    submissions: Object.fromEntries(Object.entries(doc.submissions).map(([k, s]) => [k, s && typeof s === 'object' ? { ...s, by: s.by ? { ...s.by, name: '' } : s.by } : s])),
    ...(doc.finalReview ? { finalReview: { ...doc.finalReview, by: { ...doc.finalReview.by, name: '' } } } : {}),
  };
}
/** 목록·종합 행 — 2.0 화면이 쓰는 칸만(머리 · 평가자 id/종류 · 채점 점수/제출 시각/채점자 · 제출 수 · 정원 · 평균). */
export function listRow(row, seeNames) {
  const r = seeNames ? row : hideNames(row);
  return {
    id: r.id, createdAt: r.createdAt, header: r.header, evaluators: r.evaluators,
    submissions: Object.fromEntries(Object.entries(r.submissions).map(([k, s]) => [k, s && typeof s === 'object' ? { scores: s.scores, submittedAt: s.submittedAt, by: s.by } : s])),
    submittedCount: r.submittedCount, observerSlots: r.observerSlots, averages: r.averages,
  };
}

/**
 * 화면 하나의 자료. v = 고른 사람(readPeople editor — 2.0 requireAccess('class_review')를 지난 사람) · path = 2.0 주소 · sp = 쿼리.
 * 반환 page: list · portfolio · detail · score · new · template · board · redirect(to) · missing.
 */
export async function loadClassReview({ t, v, path, sp, importV2 }) {
  const [priv, rv] = await read(t, v.id, [{ module: Q, fn: 'getReviewPrivileges', args: [] }, { module: Q, fn: 'getReviewViewer', args: [] }]);
  const faceOptions = { portfolio: priv.seePortfolio };
  if (path === '/class-review') {
    const faces = await importV2('features/class-review/faces.ts');
    const tab = faces.resolveClassReviewTab(sp.tab, faceOptions);
    if (tab === 'portfolio') {
      // 2.0 PortfolioFace — getPortfolioView({ teacherId }) · canWriteTenant(role, 'class_review')(지금 집계 단추).
      const [view, canRefresh] = await read(t, v.id, [{ module: P, fn: 'getPortfolioView', args: [{ teacherId: sp.teacher ?? null }] }, { module: PERM, fn: 'canWriteTenant', args: [v.role, 'class_review'] }]);
      return { page: 'portfolio', priv, view, canRefresh, prefs: {} };
    }
    const [{ rows }] = await read(t, v.id, [{ module: Q, fn: 'listClassReviews', args: [] }]);
    const derived = rows.length ? await read(t, v.id, rows.flatMap((r) => [{ module: Q, fn: 'myScoreSlot', args: [r, rv.id] }, { module: Q, fn: 'observerLimitOf', args: [r] }])) : [];
    const myFilter = (await importV2('features/class-review/list-filter.ts')).normalizeClassReviewFilter(undefined);
    return { page: 'list', priv, rv, myFilter, rows: rows.map((r) => listRow(r, priv.seeNames)),
      mine: Object.fromEntries(rows.map((r, i) => [r.id, derived[i * 2] ?? null])), limits: Object.fromEntries(rows.map((r, i) => [r.id, derived[i * 2 + 1]])) };
  }
  if (path === '/class-review/new') {
    if (rv.selfOnly) return { page: 'redirect', to: '/class-review' };
    const [staff, templates] = await read(t, v.id, [{ module: STAFF, fn: 'getStaffOptions', args: [] }, { module: Q, fn: 'getChecklistTemplates', args: [t] }]);
    return { page: 'new', staff, templates };
  }
  if (path === '/class-review/template') {
    if (!priv.editTemplate) return { page: 'redirect', to: '/class-review' };
    const [templates] = await read(t, v.id, [{ module: Q, fn: 'getChecklistTemplates', args: [t] }]);
    return { page: 'template', templates };
  }
  if (path === '/class-review/board') {
    if (!priv.seeNames) return { page: 'redirect', to: '/class-review' };
    const [{ rows, areas }] = await read(t, v.id, [{ module: Q, fn: 'listClassReviews', args: [] }]);
    return { page: 'board', rows: rows.map((r) => listRow(r, true)), areas };
  }
  const m = /^\/class-review\/([0-9a-f-]{36})(\/score)?$/i.exec(path);
  if (!m) return { page: 'notFound' };
  const id = m[1].toLowerCase();
  if (m[2]) {
    // 2.0 [id]/score/page.tsx — 없으면 notFound · 채점 자격이 없으면 상세로.
    const [found] = await read(t, v.id, [{ module: Q, fn: 'getClassReview', args: [id] }]);
    if (!found) return { page: 'missing' };
    const [mine] = await read(t, v.id, [{ module: Q, fn: 'myScoreSlot', args: [found.doc, rv.id] }]);
    if (!mine) return { page: 'redirect', to: `/class-review/${id}` };
    // 채점 화면은 그 사람 자기 채점 한 장만 쓴다 — 다른 채점은 보내지 않는다(2.0 ScorePanel props와 같은 범위).
    return { page: 'score', doc: { id: found.doc.id, header: found.doc.header }, areas: found.areas, mine, mySheet: found.doc.submissions[mine.slot] ?? null };
  }
  // 2.0 [id]/page.tsx — getClassReview · canWriteTenant(보는 사람 역할) · 평가자 관리 명단(getStaffOptions)은 관리할 수 있을 때만 쓴다.
  const [found, canWrite, staff] = await read(t, v.id, [{ module: Q, fn: 'getClassReview', args: [id] }, { module: PERM, fn: 'canWriteTenant', args: [v.role, 'class_review'] },
    { module: STAFF, fn: 'getStaffOptions', args: [] }]);
  if (!found) return { page: 'missing' };
  const canManageObservers = canWrite && !rv.selfOnly && found.doc.header.observerMode !== 'open';
  const doc = priv.seeNames || canManageObservers ? found.doc : hideNames(found.doc);
  const [cols, mine, limit] = await read(t, v.id, [{ module: Q, fn: 'observerColumns', args: [doc] }, { module: Q, fn: 'myScoreSlot', args: [doc, rv.id] }, { module: Q, fn: 'observerLimitOf', args: [doc] }]);
  return { page: 'detail', found: { doc, areas: found.areas }, priv, rv, canWrite, staffOptions: canManageObservers ? staff : [], observerCols: cols, mine, observerLimit: limit };
}
