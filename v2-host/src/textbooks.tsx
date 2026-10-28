// 2.0 부품 호스트 — 교재목록 진입점. 3.0 `#v2-textbooks`가 같은 출처 iframe(/v2-host/textbooks.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터 = /api/v2/textbooks?tab=…&subject=…&area=…&q=…&page=…&viewer=…(Docker 복사본, v2-screen-textbooks.mjs) — 2.0 page.tsx가 서버에서 만들던 값 그대로.
// 보는 사람 = 3.0 띠가 고른 사람(강사는 읽기 전용 · 반 배정은 강사 시트 담당 범위 — 2.0과 같은 판정). 고르면 v2-host-actor로 알려 오고 다시 읽는다(MCS와 같은 방식).
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { TextbooksHostPage, type TextbooksPageData } from './textbooks-page';
import { onHostRefresh } from '../shims/host-nav';
import { hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 교재 다이얼로그가 열 때 읽는 2.0 loadTextbookDetail — 읽기라 같은 화면의 GET(detail)으로 묻는다(보는 사람으로). 답은 2.0 반환 모양. */
registerHostHandler('features/textbooks/server/actions.ts', 'loadTextbookDetail', async (id) => {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: true, status: 'ok', detail: null };
  const q = new URLSearchParams({ detail: id }); const actor = hostActor(); if (actor) q.set('viewer', actor);
  const r = await fetch(`/api/v2/textbooks?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r ? ((await r.json().catch(() => null)) as { ok?: unknown } | null) : null;
  return r?.ok && body && typeof body.ok === 'boolean' ? body : { ok: false, error: '교재를 불러오지 못했습니다' };
});

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '교재목록';
export const HOST_ROUTE = '/textbooks';

type Data = TextbooksPageData & {
  editors: HostEditor[];
  viewer: { id: string; name: string; role: string } | null;
  host: { operations: Parameters<typeof OperationsProvider>[0]; disabledModules: Parameters<typeof OperationsProvider>[0]['disabledModules'] };
  route: 'none' | 'page';
};

/** 2.0 page.tsx searchParams — 서버가 다시 그리던 열쇠(면 · 과목 · 구분 · 검색 · 쪽). */
const KEYS = ['tab', 'subject', 'area', 'q', 'page'] as const;
const ACTOR_KEY = 'v2-host-actor:textbooks';
const storedActor = () => { try { return localStorage.getItem(ACTOR_KEY); } catch { return null; } };

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
  const sp: Record<string, string | undefined> = {};
  const q = new URLSearchParams();
  for (const k of KEYS) { const v = search.get(k); if (v !== null) { q.set(k, v); sp[k] = v; } }
  if (viewer) q.set('viewer', viewer);
  const key = q.toString();
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/textbooks${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '교재목록을 불러오지 못했습니다.'); return body as Data; })
      .then((data) => live && setState({ key, data }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick]);
  const editors = state.data?.editors, resolvedViewer = state.data?.viewer?.id ?? null;
  useEffect(() => { shownViewer.current = resolvedViewer; }, [resolvedViewer]);
  useEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '교재목록을 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations;
  if (d.route === 'none') return <HostMessage text="교재목록을 볼 수 있는 직원이 없습니다." />;
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
      <TextbooksHostPage d={d} sp={sp} settings={{ operations: ops as never }} />
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="textbooks"><App /></HostFrame></AppProviders>);
