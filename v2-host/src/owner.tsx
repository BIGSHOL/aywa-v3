// 2.0 부품 호스트 — 학원 설정 진입점. 3.0 `#v2-owner`가 같은 출처 iframe(/v2-host/owner.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터 = /api/v2/owner?tab=…&year=…&viewer=…(Docker 복사본, v2-screen-owner.mjs) — 2.0 page.tsx가 return 앞에서 만들던 값 그대로.
// 보는 사람 = 셸에서 선택한 현재 사람(면마다 그 사람의 권한 — 2.0과 같은 판정). 권한 없는 면 · 옛 주소는 서버가 알려 준 주소로 옮긴다(2.0 redirect).
import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { OwnerHostPage, type OwnerPageData } from './owner-page';
import { hostNavigate, onHostRefresh } from '../shims/host-nav';
import { hostActor, setHostEditors, registerHostHandler, VIEW_ONLY, type HostEditor } from '../shims/server-action';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '학원 설정';
export const HOST_ROUTE = '/owner';

// 슬랙 API 조회·발송은 외부 서비스에 닿는다. 2.0 부품의 함수 호출을 이 화면에서 즉시 거절한다.
for (const [module, names] of [
  ['features/slack/server/connection-actions.ts', ['saveSlackToken', 'resendSlackFailures', 'listSlackChannels']],
  ['features/slack/server/rule-actions.ts', ['sendSlackRuleSample']],
  ['features/slack/server/link-actions.ts', ['loadSlackPeople', 'linkSlackByEmail', 'unlinkSlackUser']],
] as const) for (const name of names) registerHostHandler(module, name,
  async () => ({ error: name === 'listSlackChannels' ? '연습 자료에서는 슬랙 채널 목록을 불러올 수 없습니다'
    : name === 'loadSlackPeople' ? '연습 자료에서는 슬랙 직원 목록을 불러올 수 없습니다' : VIEW_ONLY }));
registerHostHandler('features/video-submit/server/drive-settings-actions.ts', 'saveVideoDriveSetting', async () => ({ error: VIEW_ONLY }));
for (const name of ['loadTodaysMathMenus', 'saveTodaysMathMenus']) registerHostHandler('features/integrations/todays-math/server/branch-menus-actions.ts', name, async () => ({ ok: false, message: '연습 자료에서는 오늘 수학에 연결할 수 없습니다.' }));

registerHostHandler('features/sync-agent/server/actions.ts', 'getAgentDashboard', async (input) => {
  const p = input && typeof input === 'object' ? input as { module?: unknown; level?: unknown; date?: unknown; cursor?: { at?: unknown; id?: unknown } } : {};
  const q = new URLSearchParams({ tab: 'sheets', sub: 'agent', read: 'agent_dashboard' });
  const actor = hostActor(); if (actor) q.set('viewer', actor);
  if (typeof p.module === 'string') q.set('agentModule', p.module);
  if (typeof p.level === 'string') q.set('agentLevel', p.level);
  if (typeof p.date === 'string') q.set('agentDate', p.date);
  if (typeof p.cursor?.at === 'string' && typeof p.cursor.id === 'string') { q.set('agentCursorAt', p.cursor.at); q.set('agentCursorId', p.cursor.id); }
  const r = await fetch(`/api/v2/owner?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r ? await r.json().catch(() => null) : null;
  return r?.ok ? body?.page?.integrations?.agent ?? { error: '연동 PC 상태를 불러오지 못했습니다.' } : { error: '연동 PC 상태를 불러오지 못했습니다.' };
});
for (const name of ['issueAgentCode', 'issueAgentManagementCode', 'revokeAgentDevice', 'saveAgentSettings'])
  registerHostHandler('features/sync-agent/server/actions.ts', name, async () => ({ error: VIEW_ONLY }));

async function makeeduLive() {
  const q = new URLSearchParams({ tab: 'sheets', sub: 'makeedu' });
  const actor = hostActor(); if (actor) q.set('viewer', actor);
  const r = await fetch(`/api/v2/owner?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r ? await r.json().catch(() => null) : null;
  return r?.ok ? body?.page?.integrations?.makeedu ?? null : null;
}
registerHostHandler('features/integrations/server/actions.ts', 'checkMakeeduSyncLock', async () =>
  (await makeeduLive())?.lock ?? { busyUntil: null, running: false });
registerHostHandler('features/integrations/server/actions.ts', 'checkMakeeduSyncWorkers', async () => {
  const data = await makeeduLive(); return { workers: data?.workers ?? [], nowMs: Date.now() };
});
for (const name of ['triggerMakeeduSyncNow', 'enqueueConsultationPush'])
  registerHostHandler('features/integrations/server/actions.ts', name, async () => ({ error: VIEW_ONLY }));

// 슬랙 API 조회·발송은 외부 서비스에 닿는다. 2.0 부품의 함수 호출을 이 화면에서 즉시 거절한다.
for (const [module, names] of [
  ['features/slack/server/connection-actions.ts', ['saveSlackToken', 'resendSlackFailures', 'listSlackChannels']],
  ['features/slack/server/rule-actions.ts', ['sendSlackRuleSample']],
  ['features/slack/server/link-actions.ts', ['loadSlackPeople', 'linkSlackByEmail', 'unlinkSlackUser']],
] as const) for (const name of names) registerHostHandler(module, name,
  async () => ({ error: name === 'listSlackChannels' ? '연습 자료에서는 슬랙 채널 목록을 불러올 수 없습니다' : VIEW_ONLY }));

type Data = {
  page?: OwnerPageData;
  redirect?: string;
  editors: HostEditor[];
  viewer: { id: string; name: string; role: string } | null;
  host: { operations: Parameters<typeof OperationsProvider>[0]; disabledModules: Parameters<typeof OperationsProvider>[0]['disabledModules'] };
  route: 'none' | 'page' | 'redirect' | 'denied';
};

/** 2.0 page.tsx searchParams 중 서버가 다시 그리던 열쇠(면 · 세션 연도 · 연동 하위 탭). */
const KEYS = ['tab', 'year', 'sub', 'page', 'action', 'q', 'from', 'to'] as const;
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
    fetch(`/api/v2/owner${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '학원 설정을 불러오지 못했습니다.'); return body as Data; })
      .then((data) => live && setState({ key, data }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick]);
  const editors = state.data?.editors, resolvedViewer = state.data?.viewer?.id ?? null;
  useEffect(() => { shownViewer.current = resolvedViewer; }, [resolvedViewer]);
  useLayoutEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
  // 2.0 redirect(옛 설정 탭 · 권한 없는 면 → 맡은 면) — 주소를 바꿔 다시 읽는다.
  const redirect = state.key === key && state.data?.route === 'redirect' ? state.data.redirect ?? null : null;
  useEffect(() => { if (redirect) hostNavigate(redirect, 'replace'); }, [redirect]);
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '학원 설정을 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations;
  if (d.route === 'none') return <HostMessage text="학원 설정을 볼 수 있는 직원이 없습니다." />;
  if (d.route === 'redirect') return <HostMessage text="이동 중…" />;
  if (d.route === 'denied' || !d.page) return <HostMessage text="학원 설정을 볼 권한이 없습니다." error />;
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
      <OwnerHostPage d={d.page} sp={sp} />
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="owner"><App /></HostFrame></AppProviders>);
