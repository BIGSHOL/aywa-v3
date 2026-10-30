// 2.0 부품 호스트 — 회의록 진입점(작업자 v2-meetings). 3.0 `#v2-meetings`가 같은 출처 iframe(/v2-host/meetings.html?…)으로 연다.
// 2.0 주소: /meetings(목록 — meetings-page.tsx) · /meetings/<id>(상세 — meetings-detail.tsx) · /meetings/new(새 회의록 — meetings-new.tsx).
// 데이터 = /api/v2/meetings?…(Docker 복사본, v2-screen-meetings.mjs — 2.0 서버 함수 그대로) — 2.0 서버 컴포넌트가 부품에 넘기던 값.
// 저장하는 사람 = 셸에서 선택한 현재 직원 — 목록·상세도 그 사람의 신분으로 읽는다(?actor=).
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { hostNavigate, onHostRefresh } from '../shims/host-nav';
import { NOT_SUPPORTED, hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { useWindowStore } from '@/components/workspace/window-store';
import { HostFrame, HostMessage } from './host-frame';
import { MeetingsPage, type MeetingsListData } from './meetings-page';
import { MeetingDetailPage, type MeetingDetailData } from './meetings-detail';
import { NewMeetingPage, type MeetingNewData } from './meetings-new';
import { MeetingPrintPage, type MeetingPrintData } from './meetings-print';

export const HOST_TITLE = '회의록';
export const HOST_ROUTE = '/meetings';
const SCREEN = 'meetings';
const ACTIONS = 'features/meetings/server/actions.ts';

type Base = { editors: HostEditor[]; operations: Record<string, unknown>; modules: { disabled: string[] }; licenses: Record<string, boolean>;
  page: 'list' | 'detail' | 'new' | 'print' | 'missing' | 'noMenu' | 'notFound' };

/**
 * AI·녹음 — 연습 자료에서는 부르지 않는다(AI로 정리·분석 다시 생성(기둥 A) · 전사부터 다시(기둥 B) · 녹음으로 회의록 만들기 · 녹음 올리기 표).
 * 보내지 않고 그 자리에서 2.0 실패 모양({ error })으로. 저장된 마지막 결과는 2.0처럼 그대로 보인다.
 */
const notSupported = async () => ({ error: NOT_SUPPORTED });
for (const name of ['regenerateMeetingAnalysis', 'retryMeetingProcessing', 'startMeetingFromAudio']) registerHostHandler(ACTIONS, name, notSupported);
registerHostHandler('features/media/server/upload-actions.ts', 'issueAudioUploadTicket', notSupported);

/**
 * 회의록 삭제 — 2.0은 성공하면 서버에서 redirect(목록)한다. 호스트는 같은 쓰기 경로로 보내고, 서버가 돌려준 redirectTo로 옮긴다(2.0 반환 = undefined).
 * 실패는 2.0 모양 그대로({ error }).
 */
registerHostHandler(ACTIONS, 'deleteMeeting', async (_prev, fd) => {
  let res: Response;
  try {
    res = await fetch(`/api/v2/${SCREEN}/deleteMeeting`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: ACTIONS, actor: hostActor(), args: [null, { $formData: [...(fd as FormData).entries()].filter(([, v]) => typeof v === 'string') }] }),
    });
  } catch { return { error: '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다' }; }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { error?: string; redirectTo?: string } | null; message?: string } | null;
  if (!res.ok || !body?.ok) return { error: body?.message || '삭제하지 못했습니다 — 바뀐 것은 없습니다' };
  if (body.result?.error) return { error: body.result.error };
  if (body.result?.redirectTo) hostNavigate(body.result.redirectTo, 'replace');
  return undefined;
});

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

const DETAIL = /^\/meetings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRINT = /^\/meetings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/print$/i;
function App() {
  // 2.0의 인쇄 창 훅은 데스크톱에서 로컬 창 스토어를 연다. 호스트 iframe에는 창 캔버스가 없으므로
  // 회의록 인쇄 항목만 같은 화면의 인쇄 주소로 옮기고 다른 창 동작은 원본 스토어에 맡긴다.
  useEffect(() => {
    const original = useWindowStore.getState().open;
    const bridged: typeof original = (kind, params, anchor) => {
      if (kind === 'route' && params.id.startsWith('print/meetings/') && params.href && PRINT.test(params.href.split('?')[0])) {
        hostNavigate(params.href, 'push');
        return true;
      }
      return original(kind, params, anchor);
    };
    useWindowStore.setState({ open: bridged });
    return () => { if (useWindowStore.getState().open === bridged) useWindowStore.setState({ open: original }); };
  }, []);
  const path = usePathname(), search = useSearchParams(), actor = useActor();
  const known = path === HOST_ROUTE || path === '/meetings/new' || DETAIL.test(path) || PRINT.test(path);
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
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '회의록을 불러오지 못했습니다.'); return body as Base; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick, known]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  if (!known) return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  // 같은 화면에서 주소만 바뀐 새로고침(저장 뒤)은 받던 화면을 그대로 둔다 — 첫 자료가 오기 전까지만 '불러오는 중'.
  if (!state.data && !state.error) return <HostMessage text="회의록을 불러오는 중…" />;
  if (!state.data) return <HostMessage text={state.error!} error />;
  const data = state.data;
  if (data.page === 'noMenu') return <HostMessage text="회의록을 열 수 있는 직원이 없습니다." error />;
  if (data.page === 'notFound') return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  if (data.page === 'missing') return <HostMessage text="이 회의록을 찾을 수 없습니다. 지워졌을 수 있습니다." error />;
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  // 주소 열쇠는 그 자료를 받은 주소의 것(다음 자료가 오기 전 잠깐 옛 자료 + 새 주소로 어긋나 그리지 않게).
  const sp = Object.fromEntries([...new URLSearchParams(state.query ?? '').entries()].filter(([k]) => k !== 'actor' && k !== 'v2path' && k !== 'embed'));
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment}
      disabledModules={data.modules.disabled as never} licenses={data.licenses}>
      {data.page === 'print' ? <MeetingPrintPage key={path} data={data as unknown as MeetingPrintData} />
        : data.page === 'detail' ? <MeetingDetailPage key={path} data={data as unknown as MeetingDetailData} id={path.split('/')[2]!} />
        : data.page === 'new' ? <NewMeetingPage key={path} data={data as unknown as MeetingNewData} sp={sp} />
        : <MeetingsPage key={state.query} data={data as unknown as MeetingsListData} sp={sp as Parameters<typeof MeetingsPage>[0]["sp"]} />}
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
