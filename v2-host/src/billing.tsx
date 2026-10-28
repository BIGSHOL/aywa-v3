// 2.0 부품 호스트 — 수납관리 진입점. 3.0 `#v2-billing`이 같은 출처 iframe(/v2-host/billing.html?…)으로 연다.
// 2.0 page.tsx(`/billing`)가 그리는 그대로(billing-page.tsx), 2.0 (shell) 레이아웃이 창(embed) 화면을 감싸는 공급자(Embed · 운영 설정)로 감싼다.
// 데이터 = /api/v2/billing?…(Docker 복사본, v2-screen-billing.mjs) — page.tsx와 각 면이 서버에서 받던 값 그대로.
// 보는 사람 = 3.0 띠가 고른 사람(수납 권한 · 급여 열람 · 쓰기 수준이 그 사람의 권한 표). 고르면 v2-host-actor로 알려 오고 다시 읽는다.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { EmbedProvider } from '@/components/workspace/embed-context';
import { onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { hostActor, setHostEditors, type HostEditor } from '../shims/server-action';
import { HostFrame, HostMessage } from './host-frame';
import { BillingPage, type BillingPageData } from './billing-page';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '수납관리';
export const HOST_ROUTE = '/billing';

type Ops = Parameters<typeof OperationsProvider>[0];
type Data = { editors: HostEditor[]; viewer: { id: string; name: string; role: string } | null; route: 'none' | 'page' }
  & Partial<Omit<BillingPageData, 'host'>> & { host: { operations: Ops; disabledModules: Ops['disabledModules'] } };

/** 2.0 page.tsx · 각 면의 searchParams — 서버가 다시 그리던 열쇠(v2path = 하위 주소). */
const KEYS = ['v2path', 'tab', 'period', 'q', 'sort', 'desc', 'page', 'overdue', 'missing', 'subject', 'only', 'allocation', 'confirmation', 'panel', 'status',
  'active', 'cactive', 'cat', 'cpage', 'cpmode', 'csub', 'grade', 'hm', 'hy', 'qid', 'qpage', 'tsub'] as const;

function App() {
  const search = new URLSearchParams(useHostSearch());
  const [viewer, setViewer] = useState<string | null>(null);
  const sp: Record<string, string | undefined> = {};
  const q = new URLSearchParams();
  for (const k of KEYS) { const v = search.get(k); if (v !== null) { q.set(k, v); if (k !== 'v2path') sp[k] = v; } }
  if (viewer) q.set('viewer', viewer);
  const key = q.toString();
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  const drawnFor = useRef<string | null>(null);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  // 3.0 띠에서 보는 사람을 바꾸면 그 사람의 권한으로 다시 받는다(shim이 먼저 받아 두므로 다음 틱에 읽는다).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent || (e.data as { type?: string } | null)?.type !== 'v2-host-actor') return;
      setTimeout(() => { const next = hostActor(); if (next && next !== drawnFor.current) setViewer(next); }, 0);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/billing${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '수납관리를 불러오지 못했습니다.'); return body as Data; })
      .then((data) => {
        if (!live) return;
        setHostEditors(data.editors);
        // 띠에 남아 있던 사람(같은 출처 저장소)이 서버가 고른 사람과 다르면 그 사람으로 한 번 더 받는다.
        const picked = hostActor();
        if (picked && data.viewer && picked !== data.viewer.id && picked !== viewer) { setViewer(picked); return; }
        drawnFor.current = data.viewer?.id ?? null;
        setState({ key, data });
      })
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick, viewer]);
  // 2.0도 면·달·검색을 바꾸면 서버를 다시 그린다(loading.tsx) — 다른 조건의 옛 표를 그대로 두지 않는다.
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '수납관리를 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations;
  if (d.route === 'none' || !d.access) return <HostMessage text="수납관리를 볼 수 있는 직원이 없습니다." />;
  return (
    <EmbedProvider embed>
      <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
        <BillingPage d={d as BillingPageData} sp={sp} />
      </OperationsProvider>
    </EmbedProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="billing"><App /></HostFrame></AppProviders>);
