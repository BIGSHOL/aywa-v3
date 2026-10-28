// 2.0 부품 호스트 — 전자결재 진입점(처리 화면 세션 R). 3.0 `#v2-approvals`가 같은 출처 iframe(/v2-host/approvals.html?…)으로 연다.
// 2.0 주소: /approvals(결재함 · approvals-list.tsx) · /approvals/<id>(결재 문서 · approvals-doc.tsx) · /approvals/new(기안하기 · approvals-new.tsx).
// 데이터 = /api/v2/approvals?…(Docker 복사본, v2-screen-approvals.mjs) — 2.0 서버 컴포넌트가 부품에 넘기던 값.
// 보는 사람 = 3.0 띠에서 고른 직원(저장하는 사람과 같다) — 결재함·결재 단추가 그 사람의 것이라 조회에도 싣는다(?actor=).
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { onHostRefresh } from '../shims/host-nav';
import { setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';
import { ApprovalsPage, type ApprovalsListData } from './approvals-list';
import { ApprovalDocPage, type ApprovalDocData } from './approvals-doc';
import { NewApprovalPage, type NewApprovalData } from './approvals-new';

export const HOST_TITLE = '전자결재';
export const HOST_ROUTE = '/approvals';
const SCREEN = 'approvals';

type Base = { editors: HostEditor[]; operations: Record<string, unknown>; notFound?: boolean; noMenu?: boolean; notAllowed?: boolean };

const ACTOR_KEY = `v2-host-actor:${SCREEN}`;
/** 보는 사람 — 3.0 띠가 고른 값(같은 출처 저장소 + v2-host-actor 알림). 바뀌면 다시 읽는다. */
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

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DOC = new RegExp(`^/approvals/${UUID}$`, 'i');
function App() {
  const path = usePathname(), search = useSearchParams(), actor = useActor();
  const known = path === HOST_ROUTE || path === '/approvals/new' || DOC.test(path);
  const tab = path === HOST_ROUTE ? search.get('tab') ?? undefined : undefined;
  // 결재함 탭은 서버가 보지 않는다(2.0도 함 전부를 한 번에 받는다) — 조회 주소엔 경로와 사람만.
  const query = new URLSearchParams({ ...(path !== HOST_ROUTE && known ? { v2path: path } : {}), ...(actor ? { actor } : {}) }).toString();
  const [state, setState] = useState<{ query?: string; data?: Base; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (!known) return;
    let live = true;
    fetch(`/api/v2/${SCREEN}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '전자결재를 불러오지 못했습니다.'); return body as Base; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick, known]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  if (!known) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  if (state.query !== query || (!state.data && !state.error)) return <HostMessage text="전자결재를 불러오는 중…" />;
  if (!state.data) return <HostMessage text={state.error!} error />;
  const data = state.data;
  if (data.notFound) return <HostMessage text="이 문서를 볼 수 없습니다. 기안자·결재자·참조자나 원장으로 보는 사람을 바꿔 주세요." error />;
  if (data.noMenu) return <HostMessage text="고른 사람은 전자결재 메뉴가 없습니다. 위에서 다른 사람을 골라 주세요." error />;
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={[] as never}>
      {DOC.test(path) ? <ApprovalDocPage key={`${path}:${actor}`} data={data as unknown as ApprovalDocData} />
        : path === '/approvals/new' ? <NewApprovalPage key={actor ?? ''} data={data as unknown as NewApprovalData} />
        : <ApprovalsPage data={data as unknown as ApprovalsListData} sp={{ tab }} />}
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
