// 2.0 부품 호스트 — 직원 평가 진입점(작업자 v2-meetings). 3.0 `#v2-class-review`가 같은 출처 iframe(/v2-host/class-review.html?…)으로 연다.
// 2.0 주소: /class-review(직원 평가 면 · ?tab=portfolio 직원 포트폴리오 면 — class-review-page.tsx) · /class-review/<id>(상세) · /<id>/score(채점) ·
//          /class-review/new(새 평가) · /class-review/template(문항 세트) · /class-review/board(종합).
// 데이터 = /api/v2/class-review?…(Docker 복사본, v2-screen-class-review.mjs — 2.0 서버 함수 그대로). 보는·저장하는 사람 = 셸에서 선택한 현재 직원(?actor=).
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { hostNavigate, onHostRefresh } from '../shims/host-nav';
import { hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';
import { ClassReviewPage, type ClassReviewListData } from './class-review-page';
import { ClassReviewDetailPage, type ClassReviewDetailData } from './class-review-detail';
import { ClassReviewScorePage, type ClassReviewScoreData } from './class-review-score';
import { NewClassReviewPage, type ClassReviewNewData } from './class-review-new';
import { ClassReviewTemplatePage, type ClassReviewTemplateData } from './class-review-template';
import { ClassReviewBoardPage, type ClassReviewBoardData } from './class-review-board';
import { JudgmentFocus, type JudgmentFocusData } from './class-review-judgment-focus';

export const HOST_TITLE = '직원 평가';
export const HOST_ROUTE = '/class-review';
const SCREEN = 'class-review';
const CR = 'features/class-review/server/actions.ts', TP = 'features/teacher-portfolio/server/';

type Base = { editors: HostEditor[]; operations: Record<string, unknown>; modules: { disabled: string[] };
  page: 'list' | 'portfolio' | 'detail' | 'score' | 'new' | 'template' | 'board' | 'redirect' | 'missing' | 'noMenu' | 'notFound' | 'moduleOff' | 'judgmentMissing' | 'judgmentUnassigned';
  to?: string; focusJudgment?: { id: string; month: string } };

const UNREACHABLE = '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다';
/**
 * 읽기 전용 서버 액션(비교 표 · 직접 입력 값 · 만족도 관리 창) — 쓰기 경로(POST)가 아니라 읽기 경로(GET ?read=)로(보기 중 쓰기 0).
 * 저장하는 사람의 신분으로 읽는다(2.0 게이트가 그 사람으로 다시 본다). 못 받으면 그 함수의 2.0 실패 모양({ ok:false, error }).
 */
for (const [module, name] of [[`${TP}compare-actions.ts`, 'loadPortfolioComparison'], [`${TP}evaluation-actions.ts`, 'loadEvaluationEntries'], [`${TP}satisfaction-actions.ts`, 'loadSatisfactionBoard']] as const) {
  registerHostHandler(module, name, async (...args) => {
    const q = new URLSearchParams({ read: name, args: JSON.stringify(args) });
    const actor = hostActor();
    if (actor) q.set('actor', actor);
    try {
      const r = await fetch(`/api/v2/${SCREEN}?${q}`, { headers: { Accept: 'application/json' } });
      const body = (await r.json().catch(() => null)) as { result?: unknown; message?: string } | null;
      return r.ok && body ? body.result : { ok: false, error: body?.message || '불러오지 못했습니다. 잠시 후 다시 시도해 주세요' };
    } catch { return { ok: false, error: UNREACHABLE }; }
  });
}

/** 계정 보기 설정(목록 보기 필터 · 점수 기준 상자 접힘 · 비교 표 정렬) — 3.0엔 계정이 없어 저장하지 않는다(보기는 그 화면 안에서만). */
const noAccountPrefs = async () => ({ ok: false, error: '연습 자료에서는 보기 설정을 계정에 저장하지 않습니다' });
registerHostHandler(CR, 'setMyClassReviewFilter', noAccountPrefs);
for (const name of ['saveRuleBoxCollapsed', 'saveCompareSort']) registerHostHandler(`${TP}view-prefs-actions.ts`, name, noAccountPrefs);

/**
 * 성공하면 서버에서 redirect하는 2.0 함수(새 평가 → 그 평가지 · 문항 세트 저장 → 그 세트 · 세트 삭제 → 세트 관리) — 같은 쓰기 경로로 보내고,
 * 서버가 돌려준 redirectTo로 옮긴다(2.0 반환 = 없음). 실패는 2.0 모양 그대로({ error }).
 */
for (const name of ['createClassReview', 'saveChecklistTemplate', 'deleteChecklistTemplate']) {
  registerHostHandler(CR, name, async (_prev, fd) => {
    let res: Response;
    try {
      res = await fetch(`/api/v2/${SCREEN}/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ module: CR, actor: hostActor(), args: [null, { $formData: [...(fd as FormData).entries()].filter(([, v]) => typeof v === 'string') }] }),
      });
    } catch { return { error: UNREACHABLE }; }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { error?: string; redirectTo?: string } | null; message?: string } | null;
    if (!res.ok || !body?.ok) return { error: body?.message || '저장하지 못했습니다 — 바뀐 것은 없습니다' };
    if (body.result?.redirectTo) { hostNavigate(body.result.redirectTo, 'push'); return undefined; }
    return body.result ?? undefined;
  });
}

/** 저장하는 사람 — 셸에서 선택한 현재 값(부모 셸 계정). 바뀌면 다시 읽는다(보는 권한이 그 사람의 것). */
function useActor() {
  const [actor, setActor] = useState<string | null>(() => hostActor());
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; id?: unknown } | null;
      if (d?.type === 'v2-host-actor' && typeof d.id === 'string') setActor(d.id);
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  return actor;
}

const KNOWN = /^\/class-review(?:\/new|\/template|\/board|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/score)?)?$/i;
function App() {
  const path = usePathname(), search = useSearchParams(), actor = useActor();
  const known = KNOWN.test(path);
  const q = new URLSearchParams(search.toString());
  q.delete('actor');
  // 창 표식(embed=1) — 2.0 부품의 창 안 이동(WindowLink · withEmbed)이 싣는다. 서버가 보는 열쇠가 아니라 뺀다(실으면 조회가 400).
  q.delete('embed');
  if (path !== HOST_ROUTE) q.set('v2path', path);
  if (actor) q.set('actor', actor);
  const query = q.toString();
  const [state, setState] = useState<{ query?: string; data?: Base; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (!known) return;
    let live = true;
    fetch(`/api/v2/${SCREEN}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '직원 평가를 불러오지 못했습니다.'); return body as Base; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick, known]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  // 2.0 redirect(자격이 없는 하위 화면 → 목록 · 채점 자격 없음 → 상세) — 그 주소로 옮긴다.
  useEffect(() => { if (state.data?.page === 'redirect' && state.data.to) hostNavigate(state.data.to, 'replace'); }, [state.data]);
  if (!known) return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  if (!state.data && !state.error) return <HostMessage text="직원 평가를 불러오는 중…" />;
  if (!state.data) return <HostMessage text={state.error!} error />;
  const data = state.data;
  if (data.page === 'noMenu') return <HostMessage text="직원 평가를 열 수 있는 직원이 없습니다." error />;
  // 꺼진 지점(2.0 ModuleBoundary) = 없는 주소와 똑같이.
  if (data.page === 'notFound' || data.page === 'moduleOff') return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  if (data.page === 'redirect') return <HostMessage text="화면을 옮기는 중…" />;
  if (data.page === 'missing') return <HostMessage text="이 평가를 찾을 수 없습니다. 지워졌을 수 있습니다." error />;
  if (data.page === 'judgmentMissing') return <HostMessage text="이 판정 대기 글을 찾을 수 없습니다. 이미 처리됐을 수 있습니다." error />;
  if (data.page === 'judgmentUnassigned') return <HostMessage text="이 글은 선생님 평가 근거에 연결되지 않아 여기서 판정할 수 없습니다." error />;
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  // 2.0 page가 getTenantSettings()에서 읽던 것은 과목뿐이다(buildSubjectMaps).
  const page = { ...data, settings: { operations: { subjects: ops.subjects } } };
  const sp = Object.fromEntries([...new URLSearchParams(state.query ?? '').entries()].filter(([k]) => k !== 'actor' && k !== 'v2path' && k !== 'embed'));
  if (data.page === 'portfolio' && data.focusJudgment) sp.tab = 'portfolio';
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment}
      disabledModules={data.modules.disabled as never}>
      {data.page === 'detail' ? <ClassReviewDetailPage key={path} data={page as unknown as ClassReviewDetailData} />
        : data.page === 'score' ? <ClassReviewScorePage key={path} data={page as unknown as ClassReviewScoreData} />
        : data.page === 'new' ? <NewClassReviewPage key={path} data={page as unknown as ClassReviewNewData} />
        : data.page === 'template' ? <ClassReviewTemplatePage key={state.query} data={page as unknown as ClassReviewTemplateData} sp={sp} />
        : data.page === 'board' ? <ClassReviewBoardPage key={path} data={page as unknown as ClassReviewBoardData} />
        : <><ClassReviewPage key={state.query} data={page as unknown as ClassReviewListData} sp={sp} />
            {data.page === 'portfolio' && data.focusJudgment ? <JudgmentFocus key={state.query} data={page as unknown as JudgmentFocusData} /> : null}</>}
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
