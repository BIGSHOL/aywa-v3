// 2.0 부품 호스트 — 수업목록 진입점. 3.0 `#v2-classes`가 같은 출처 iframe(/v2-host/classes.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터는 /api/v2/classes?…(Docker 복사본, v2-screen-classes.mjs)에서 2.0 page.tsx가 서버에서 만들던 값으로 받는다.
// 2.0 주소: /classes(목록) · /classes/<id>(반 상세, classes-detail.tsx) · /classes/<id>/edit(반 수정) · /classes/new(새 반, classes-form.tsx).
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { ClassesListPage, type ClassListData } from './classes-list';
import { ClassDetailPage, type ClassDetailData } from './classes-detail';
import { EditClassPage, NewClassPage, type ClassEditData, type ClassNewData } from './classes-form';
import { onHostRefresh } from '../shims/host-nav';
import { setHostEditors } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '수업목록';
export const HOST_ROUTE = '/classes';

/** 목록이 읽는 조회 조건(2.0 page.tsx searchParams) — 나머지 쿼리는 서버로 보내지 않는다(공통 틀이 모르는 키는 거절한다). */
const KEYS = ['kind', 'subject', 'teacher', 'days', 'q', 'view', 'sort', 'status', 'page'] as const;

function List() {
  const search = useSearchParams();
  const sp = useMemo(() => Object.fromEntries(KEYS.flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? '']] : []))) as Record<string, string | undefined>, [search]);
  const key = new URLSearchParams(sp as Record<string, string>).toString();
  const [state, setState] = useState<{ key?: string; data?: ClassListData & { editors?: Editors }; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/classes${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '수업목록을 불러오지 못했습니다.'); return body as ClassListData; })
      .then((data) => live && setState({ key, data }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick]);
  useEditors(state.data?.editors);
  // 다른 조건의 자료로 새 주소를 그리지 않는다(필터를 바꾼 직후 · 받기 실패).
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '수업목록을 불러오는 중…'} error={failed} />;
  }
  const ops = state.data.settings.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={state.data.settings.modules.disabled as never}>
      <ClassesListPage data={state.data} sp={sp} />
    </OperationsProvider>
  );
}

type SubData = { settings: { operations: unknown; modules: { disabled: unknown } }; editors?: Editors };
type Editors = Parameters<typeof setHostEditors>[0];
/** 저장할 수 있는 사람(수업 관리 '전체') — 3.0 띠가 이 목록에서 '저장하는 사람'을 고른다(시간표와 같은 신호). */
const useEditors = (editors: Editors | undefined) => useEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
/** 하위 화면(반 상세 · 반 수정 · 새 반) — 같은 화면의 GET(v2path)으로 읽는다. 없는(또는 고칠 수 없는) 반이면 2.0 notFound 자리에 안내 한 줄. */
function Sub<T extends SubData>({ path, render }: { path: string; render: (data: T) => ReactNode }) {
  const [state, setState] = useState<{ path?: string; data?: T; missing?: boolean; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/classes?${new URLSearchParams({ v2path: path })}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '반 정보를 불러오지 못했습니다.'); return body as T | { notFound: true }; })
      .then((body) => live && setState('notFound' in body ? { path, missing: true } : { path, data: body }))
      .catch((e: Error) => live && setState({ path, error: e.message }));
    return () => { live = false; };
  }, [path, tick]);
  useEditors(state.data?.editors);
  if (state.path !== path || (!state.data && !state.missing && !state.error)) return <HostMessage text="반 정보를 불러오는 중…" />;
  if (state.missing) return <HostMessage text="찾을 수 없는 반입니다. 목록으로 돌아가 다시 골라 주세요." error />;
  if (!state.data) return <HostMessage text={state.error!} error />;
  const ops = state.data.settings.operations as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={state.data.settings.modules.disabled as never}>
      {render(state.data)}
    </OperationsProvider>
  );
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DETAIL_PATH = new RegExp(`^/classes/${UUID}$`), EDIT_PATH = new RegExp(`^/classes/${UUID}/edit$`);
function App() {
  const path = usePathname();
  if (path === HOST_ROUTE) return <List />;
  if (DETAIL_PATH.test(path)) return <Sub<ClassDetailData> key={path} path={path} render={(d) => <ClassDetailPage data={d} />} />;
  if (EDIT_PATH.test(path)) return <Sub<ClassEditData> key={path} path={path} render={(d) => <EditClassPage data={d} />} />;
  if (path === '/classes/new') return <Sub<ClassNewData> key={path} path={path} render={(d) => <NewClassPage data={d} />} />;
  return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="classes"><App /></HostFrame></AppProviders>);
