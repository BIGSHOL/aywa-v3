// 2.0 부품 호스트 — 신규 콜&상담 진입점(작업자 v2-enrollment). 3.0 `#v2-enrollment`가 같은 출처 iframe(/v2-host/enrollment.html?…)으로 연다.
// 2.0 주소: /enrollment(칸반 · 목록 · 통계 — enrollment-page.tsx).
// 데이터 = /api/v2/enrollment?…(Docker 복사본, v2-screen-enrollment.mjs) — 2.0 서버 컴포넌트가 부품에 넘기던 값.
// 저장하는 사람 = 3.0 띠에서 고른 직원 — 끌기·칸 수정 권한이 그 사람의 것이라 조회에도 싣는다(?actor=).
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { onHostRefresh } from '../shims/host-nav';
import { registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';
import { EnrollmentPage, type EnrollmentListData } from './enrollment-page';

export const HOST_TITLE = '신규 콜&상담';
export const HOST_ROUTE = '/enrollment';
const SCREEN = 'enrollment';

type Base = { editors: HostEditor[]; operations: Record<string, unknown>; modules: { disabled: string[] }; page: 'list' | 'noMenu' | 'notFound' };

/**
 * 20초 건수 폴링(2.0 getConsultationTotalCount — 늘었으면 router.refresh) — 읽기라 쓰기 경로(POST)가 아니라 읽기 경로(GET ?poll=count)로
 * 건수만 받는다(보기 중 쓰기 0). 못 받으면 null(2.0도 실패하면 null — 부품이 '바뀐 것 없음'으로 읽는다).
 */
registerHostHandler('features/enrollment/server/poll-actions.ts', 'getConsultationTotalCount', () =>
  fetch(`/api/v2/${SCREEN}?poll=count`, { headers: { Accept: 'application/json' } })
    .then(async (r) => (r.ok ? ((await r.json()) as { count?: number }).count ?? null : null)).catch(() => null));

const ACTOR_KEY = `v2-host-actor:${SCREEN}`;
/** 저장하는 사람 — 3.0 띠가 고른 값(같은 출처 저장소 + v2-host-actor 알림). 바뀌면 다시 읽는다(끌기·칸 수정 권한이 그 사람의 것). */
function useActor() {
  const [actor, setActor] = useState<string | null>(() => { try { return localStorage.getItem(ACTOR_KEY); } catch { return null; } });
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

function App() {
  const path = usePathname(), search = useSearchParams(), actor = useActor();
  const known = path === HOST_ROUTE;
  const q = new URLSearchParams(search.toString());
  q.delete('actor');
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
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '신규 콜&상담을 불러오지 못했습니다.'); return body as Base; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick, known]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  if (!known) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  // 같은 화면에서 주소만 바뀐 새로고침(저장 뒤 · 폴링)은 받던 화면을 그대로 둔다 — 첫 자료가 오기 전까지만 '불러오는 중'.
  if (!state.data && !state.error) return <HostMessage text="신규 콜&상담을 불러오는 중…" />;
  if (!state.data) return <HostMessage text={state.error!} error />;
  const data = state.data;
  if (data.page === 'noMenu') return <HostMessage text="신규 콜&상담을 열 수 있는 직원이 없습니다." error />;
  if (data.page === 'notFound') return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  // 주소 열쇠는 그 자료를 받은 주소의 것(다음 자료가 오기 전 잠깐 옛 자료 + 새 주소로 어긋나 그리지 않게).
  const sp = Object.fromEntries([...new URLSearchParams(state.query ?? '').entries()].filter(([k]) => k !== 'actor' && k !== 'v2path'));
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.modules.disabled as never}>
      <EnrollmentPage key={state.query} data={data as unknown as EnrollmentListData} sp={sp} />
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
