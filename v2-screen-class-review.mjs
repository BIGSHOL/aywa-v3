// 2.0 화면 — 직원 평가(체크리스트 목록 · 상세 · 채점 · 새 평가 · 문항 세트 · 종합 · 직원 포트폴리오 면) (V2-SCREENS.md `class-review`, 팀장 세션 L · 작업자 v2-meetings).
// 그리기는 2.0의 실제 React 부품(v2-host/src/class-review.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 **2.0 서버 함수 그대로** 한다(공용 러너).
//  · 조회 = v2-class-review-load.mjs(2.0 page.tsx 일곱이 받던 값 · 2.0이 브라우저에 보내지 않던 이름·코멘트는 빼고).
//  · 보는·저장하는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 직원 평가 메뉴가 열린 재직 직원(2.0 requireAccess('class_review') · 권한 표 · v2-proc-people.mjs).
//    자기 평가 전용(강사) · 실명 열람 · 문항 편집 · 최종 총평 · 포트폴리오(원장 역할만)는 2.0 함수가 그 사람으로 다시 판정한다.
//  · 지점 기능(modules)에서 직원 평가가 꺼져 있으면 2.0 ModuleBoundary처럼 화면이 없다.
//
// 2.0 서버 함수 대응표(호스트가 부르는 이름 = actions 이름)
//  | 2.0 함수(모듈)                                                         | 여기                                                     |
//  | createClassReview · submitClassReviewScores · replaceReviewObserver · deleteClassReview · saveChecklistTemplate · deleteChecklistTemplate (class-review/server/actions.ts) | actions.<같은 이름> — 러너 write(2.0 함수 그대로) · redirect → { redirectTo } |
//  | saveFinalReview(class-review/server/final-review-actions.ts)           | actions.saveFinalReview                                   |
//  | refreshTeacherPortfolioNow(teacher-portfolio/server/actions.ts) — 지금 집계 | actions.refreshTeacherPortfolioNow(마감한 달은 2.0처럼 다시 쓰지 않는다 · DB 트리거 0357a도 그대로) |
//  | saveEvaluationEntries(evaluation-actions.ts) — 직접 입력              | actions.saveEvaluationEntries(마감한 달 거절 = 2.0 문구)   |
//  | decideJudgment · addSatisfactionClaim · cancelSatisfactionClaim · refreshAfterSatisfaction(satisfaction-actions.ts) | actions.<같은 이름> — 저장된 판정만 반영·무시(AI 판정 새로 안 함) |
//  | loadPortfolioComparison(compare-actions) · loadEvaluationEntries(evaluation-actions) · loadSatisfactionBoard(satisfaction-actions) — 읽기 | GET ?read=<이름>&args=<JSON>(보기 중 쓰기 0) |
//  | setMyClassReviewFilter · saveRuleBoxCollapsed · saveCompareSort — 계정 보기 설정 | 호스트가 보내지 않고 { ok:false }(3.0엔 계정이 없다) |
// AI 호출 0: 만족도 AI 판정(satisfaction-ai · satisfaction-judge)은 밤 정기 처리 몫이라 이 화면의 어떤 함수도 부르지 않는다 — 러너는 바깥 요청(fetch)도 막는다.
// 근태(메이크에듀)는 이미 동기화된 DB 표(staff_attendance_days)만 읽는다 — 바깥 연동 없음.
//
// 호스트에 붙일 때(의존)
//  · Next 전용: next/link · next/navigation(useRouter — review-table · score-panel · observer-manager · board-table · portfolio-board · 대화 창들) — shim 있음.
//  · 서버 컴포넌트(호스트로 조립을 옮김): page.tsx 여섯 + _components/portfolio/portfolio-face.tsx.
//  · 서버 액션 모듈: features/class-review/server/actions.ts · final-review-actions.ts · features/teacher-portfolio/server/{actions,compare-actions,evaluation-actions,satisfaction-actions,view-prefs-actions}.ts.
import { V2Error } from './v2-screens.mjs';
import { UUID, deepMerge, readPeople, serverCall } from './v2-proc-people.mjs';
import { runV2Server, V2ServerError } from './v2-server-runner.mjs';
import { loadClassReview, read } from './v2-class-review-load.mjs';

const ID = 'class-review', MENU = 'class_review';
const UUID_BODY = UUID.source.slice(1, -1);
const CR = 'features/class-review/server/actions.ts', TP = 'features/teacher-portfolio/server/';
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const modulesOf = (settings) => { const m = deepMerge(settings.base.modules ?? { disabled: [] }, settings.stored?.modules); return { disabled: Array.isArray(m?.disabled) ? m.disabled : [] }; };

/** 읽기 전용 2.0 서버 액션(GET ?read=) — 모듈 · 인자 수. */
export const READS = {
  loadPortfolioComparison: { module: `${TP}compare-actions.ts`, arity: 1 },
  loadEvaluationEntries: { module: `${TP}evaluation-actions.ts`, arity: 2 },
  loadSatisfactionBoard: { module: `${TP}satisfaction-actions.ts`, arity: 3 },
};
/** 저장 — 2.0 함수 이름 → 모듈 · 인자 수 · FormData를 받는가. */
export const WRITES = {
  createClassReview: { module: CR, arity: 2, form: true }, submitClassReviewScores: { module: CR, arity: 2, form: true },
  replaceReviewObserver: { module: CR, arity: 2, form: true }, deleteClassReview: { module: CR, arity: 2, form: true },
  saveChecklistTemplate: { module: CR, arity: 2, form: true }, deleteChecklistTemplate: { module: CR, arity: 2, form: true },
  saveFinalReview: { module: 'features/class-review/server/final-review-actions.ts', arity: 2, form: true },
  refreshTeacherPortfolioNow: { module: `${TP}actions.ts`, arity: 0 },
  saveEvaluationEntries: { module: `${TP}evaluation-actions.ts`, arity: 2 },
  decideJudgment: { module: `${TP}satisfaction-actions.ts`, arity: 3 }, addSatisfactionClaim: { module: `${TP}satisfaction-actions.ts`, arity: 1 },
  cancelSatisfactionClaim: { module: `${TP}satisfaction-actions.ts`, arity: 2 }, refreshAfterSatisfaction: { module: `${TP}satisfaction-actions.ts`, arity: 0 },
};
const ARG_LIMIT = 256 * 1024;
const isForm = (v) => !!v && typeof v === 'object' && Array.isArray(v.$formData) && v.$formData.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string');

async function load({ sql, params, tenantId: t, importV2 }) {
  const people = await readPeople(sql, t, importV2, MENU);
  const settings = people.settings, modules = modulesOf(settings);
  const base = { editors: people.editorList, operations: settings.operations, modules };
  // 2.0 layout ModuleBoundary id="class_review" — 꺼진 지점이면 화면이 없다.
  if (modules.disabled.includes('class_review')) return { ...base, page: 'moduleOff' };
  const v = people.pick(params.actor);
  if (!v) return { ...base, page: 'noMenu' };
  if (params.read) {
    const r = READS[params.read];
    let args;
    try { args = JSON.parse(params.args ?? '[]'); } catch { throw bad(); }
    if (!r || !Array.isArray(args) || args.length > r.arity) throw bad();
    const [value] = await read(t, v.id, [{ module: r.module, fn: params.read, args }]);
    return { page: 'read', result: value ?? null };
  }
  const sp = { tab: params.tab, teacher: params.teacher, set: params.set, new: params.new };
  return { ...base, ...(await loadClassReview({ t, v, path: params.v2path ?? '/class-review', sp, importV2 })) };
}

const refused = (e) => (e instanceof V2ServerError
  ? e.code === 'outbound_blocked' ? new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.')
    : e.code === 'unsupported' ? new V2Error(409, 'not_supported', '연습 화면에서는 아직 지원하지 않는 저장입니다.')
      : new V2Error(500, 'write_failed', '저장하지 못했습니다. 바뀐 것은 없습니다.')
  : e);
/** 쓰기 한 번 = 러너 write 한 번. test = 시험 전용(rollback · probes · allowRefs) — 화면 저장 경로는 넘기지 않는다. 지금 집계는 20초 넘게 걸린다. */
export async function runWrite(t, actorId, steps, test = {}) {
  try { return await runV2Server({ steps, actorId, tenantId: t, mode: 'write', ...test }, { timeoutMs: 280_000 }); } catch (e) { throw refused(e); }
}
const write = (name, { module, arity, form }) => ({
  validate: (raw) => {
    const body = serverCall(raw, [module], arity);
    if (form && (body.args.length !== 2 || !isForm(body.args[1]))) throw bad();
    if (JSON.stringify(body.args).length > ARG_LIMIT) throw bad();
    return { actor: body.actor, args: form ? [null, body.args[1]] : body.args };
  },
  run: async ({ sql, body, tenantId: t, importV2 }) => {
    const people = await readPeople(sql, t, importV2, MENU);
    // 직원 평가 메뉴를 열 수 있는 사람이 아니면 2.0 '로그인 없음' 자리(null) — 각 함수가 그 모양으로 거절한다.
    const actorId = body.actor && people.editors.some((e) => e.id === body.actor) ? body.actor : null;
    const { results: [r] } = await runWrite(t, actorId, [{ module, fn: name, args: body.args }]);
    if (r.redirect) return { redirectTo: r.redirect };
    return r.value ?? null;
  },
});

export const screen = {
  id: ID, label: '직원 평가', order: 46,
  params: {
    actor: UUID, v2path: new RegExp(`^/class-review(?:/new|/template|/board|/${UUID_BODY}(?:/score)?)?$`, 'i'),
    tab: /^(?:review|portfolio)$/, teacher: UUID, set: UUID, new: /^1$/,
    read: new RegExp(`^(?:${Object.keys(READS).join('|')})$`), args: /^\[[\s\S]*\]$/,
  },
  paramMax: { args: 4000 },
  actions: Object.fromEntries(Object.entries(WRITES).map(([name, spec]) => [name, write(name, spec)])),
  load,
};
