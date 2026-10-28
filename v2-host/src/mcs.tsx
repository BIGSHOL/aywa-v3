// 2.0 부품 호스트 — 강사 시트 · 수학(MCS) 진입점. 3.0 `#v2-mcs`가 같은 출처 iframe(/v2-host/mcs.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터 = /api/v2/mcs?v2path=…&viewer=…&month=…(Docker 복사본, v2-screen-mcs.mjs) — 2.0 page.tsx가 서버에서 만들던 값 그대로.
// 2.0 주소: /mcs(반별) · /mcs/teachers(선생님별) — 반 월간(/mcs/<반>/month)·진도맵은 다음 단계(그때까지는 안내 한 줄).
// 보는 사람 = 3.0 띠가 고른 사람(강사는 담당 반만 — 2.0과 같은 범위). 고르면 v2-host-actor로 알려 오고, 이 화면이 다시 읽는다(ECS와 같은 방식).
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import type { MathLandingResult } from '@/features/math-sheets/server/landing';
import type { TeacherGroup } from '@/features/math-sheets/server/teacher-roster';
import { McsLandingPage, McsTeachersPage } from './mcs-pages';
import { onHostRefresh } from '../shims/host-nav';
import { setHostEditors, type HostEditor } from '../shims/server-action';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '강사 시트 · 수학';
export const HOST_ROUTE = '/mcs';

type Data = {
  editors: HostEditor[];
  viewer: { id: string; name: string; role: string } | null;
  host: { operations: Parameters<typeof OperationsProvider>[0]; disabledModules: Parameters<typeof OperationsProvider>[0]['disabledModules'] };
  route: 'none' | 'landing' | 'teachers';
  landing?: MathLandingResult;
  previewProgressMap?: boolean;
  teachers?: { ok: true; groups: TeacherGroup[]; today: string } | { ok: false; error: string };
};

/** 서버를 다시 부르는 주소 열쇠 — 2.0에서 서버가 다시 그리던 것(주소 · 달). */
const KEYS = ['v2path', 'month'] as const;
const ACTOR_KEY = 'v2-host-actor:mcs';
const storedActor = () => { try { return localStorage.getItem(ACTOR_KEY); } catch { return null; } };
const OWN = /^\/mcs(?:\/teachers)?$/;

function App() {
  const qs = useHostSearch(), search = new URLSearchParams(qs);
  // 처음 열 때 고른 사람이 없으면 서버가 첫 사람(원장 먼저)으로 정한다 — 3.0 띠가 그 사람을 다시 알려 와도 같은 사람이면 다시 받지 않는다.
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
  const path = search.get('v2path') || HOST_ROUTE;
  const q = new URLSearchParams();
  for (const k of KEYS) { const v = search.get(k); if (v) q.set(k, v); }
  if (viewer) q.set('viewer', viewer);
  const key = q.toString();
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (!OWN.test(path)) return;
    let live = true;
    fetch(`/api/v2/mcs${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '강사 시트를 불러오지 못했습니다.'); return body as Data; })
      .then((data) => live && setState({ key, data }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick, path]);
  const editors = state.data?.editors, resolvedViewer = state.data?.viewer?.id ?? null;
  // 순서: 먼저 '보이는 사람'을 적고 나서 목록을 알린다(3.0 띠의 답이 이 값과 비교된다).
  useEffect(() => { shownViewer.current = resolvedViewer; }, [resolvedViewer]);
  useEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
  if (!OWN.test(path)) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '강사 시트를 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations;
  if (d.route === 'none') return <HostMessage text="수학 강사 시트를 볼 수 있는 직원이 없습니다." />;
  const body = d.route === 'teachers' && d.teachers ? <McsTeachersPage res={d.teachers} />
    : d.route === 'landing' && d.landing ? <McsLandingPage res={d.landing} previewProgressMap={!!d.previewProgressMap} />
      : <HostMessage text="강사 시트를 불러오지 못했습니다." error />;
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
      {body}
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="mcs"><App /></HostFrame></AppProviders>);
