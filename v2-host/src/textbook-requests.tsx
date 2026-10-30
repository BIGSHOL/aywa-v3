// 2.0 부품 호스트 — 교재 요청 진입점. 3.0 `#v2-textbook-requests`가 같은 출처 iframe(/v2-host/textbook-requests.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터 = /api/v2/textbook-requests?viewer=…(Docker 복사본, v2-screen-textbook-requests.mjs) — 2.0 page.tsx가 서버에서 만들던 값 그대로.
// 보는 사람 = 셸에서 선택한 현재 사람(강사 = 담당 학생 + 본인 요청 — 2.0과 같은 판정). 고르면 v2-host-actor로 알려 오고 다시 읽는다(교재목록과 같은 방식).
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { TextbookRequestsHostPage, type TextbookRequestsPageData } from './textbook-requests-page';
import { onHostRefresh } from '../shims/host-nav';
import { hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { DEFAULT_TEXTBOOK_MENT } from '@/features/billing/textbook-notice';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 작성 폼이 열 때 읽는 2.0 loadMyTextbookMent — 읽기라 같은 화면의 GET(ment)으로 묻는다(쓰는 사람으로). 못 읽으면 2.0처럼 기본 문구. */
registerHostHandler('features/billing/server/textbook-notice-actions.ts', 'loadMyTextbookMent', async () => {
  const q = new URLSearchParams({ ment: '1' }); const actor = hostActor(); if (actor) q.set('viewer', actor);
  const r = await fetch(`/api/v2/textbook-requests?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r?.ok ? ((await r.json().catch(() => null)) as { ment?: unknown } | null) : null;
  return typeof body?.ment === 'string' ? body.ment : DEFAULT_TEXTBOOK_MENT;
});

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '교재 요청';
export const HOST_ROUTE = '/textbook-requests';

type Data = TextbookRequestsPageData & {
  editors: HostEditor[];
  viewer: { id: string; name: string; role: string } | null;
  host: { operations: Parameters<typeof OperationsProvider>[0]; disabledModules: Parameters<typeof OperationsProvider>[0]['disabledModules'] };
  route: 'none' | 'page';
};

const storedActor = () => hostActor();

function App() {
  const qs = useHostSearch(), search = new URLSearchParams(qs);
  const [viewer, setViewer] = useState<string | null>(storedActor);
  const shownViewer = useRef<string | null>(null);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; id?: unknown } | null;
      if (d?.type !== 'v2-host-actor' || typeof d.id !== 'string') return;
      const id = d.id;
      setViewer((prev) => (prev === null && id === shownViewer.current ? prev : id));
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  // 2.0 searchParams.studentId — 학생 선택칸의 초기값일 뿐(서버에 보내지 않는다). 여러 개면 모두.
  const initialStudentIds = search.getAll('studentId').map((v) => v.trim()).filter(Boolean);
  const q = new URLSearchParams();
  if (viewer) q.set('viewer', viewer);
  const orderId = search.get('orderId');
  if (orderId) q.set('orderId', orderId);
  const key = q.toString();
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/textbook-requests${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '교재 요청을 불러오지 못했습니다.'); return body as Data; })
      .then((data) => live && setState({ key, data }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick]);
  const editors = state.data?.editors, resolvedViewer = state.data?.viewer?.id ?? null;
  useEffect(() => { shownViewer.current = resolvedViewer; }, [resolvedViewer]);
  useEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '교재 요청을 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations;
  if (d.route === 'none') return <HostMessage text="교재 요청을 쓸 수 있는 직원이 없습니다." />;
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
      <TextbookRequestsHostPage d={d} initialStudentIds={initialStudentIds} />
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="textbook-requests"><App /></HostFrame></AppProviders>);
