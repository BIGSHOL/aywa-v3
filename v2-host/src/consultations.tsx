// 2.0 부품 호스트 — 원생상담 진입점(처리 화면 세션 R). 3.0 `#v2-consultations`가 같은 출처 iframe(/v2-host/consultations.html?…)으로 연다.
// 2.0 주소: /consultations(목록 · consultations-list.tsx) · /consultations/<id>(상세 · consultations-detail.tsx) · /consultations/<id>/edit ·
// /consultations/new(작성·수정 · consultations-form.tsx) · /consultations/stats(통계 · consultations-stats.tsx).
// 데이터 = /api/v2/consultations?…(Docker 복사본, v2-screen-consultations.mjs) — 2.0 서버 컴포넌트가 부품에 넘기던 값.
// 보는 사람 = 3.0 띠에서 고른 직원(저장하는 사람과 같다) — 강사면 본인이 쓴 상담만 보이므로 조회에도 싣는다(?actor=).
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { hostNavigate, hostRefresh, onHostRefresh } from '../shims/host-nav';
import { VIEW_ONLY, hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';
import { ConsultationsPage, SummaryData, type ConsultationsListData } from './consultations-list';
import { ConsultationDetailPage, type ConsultationDetailData } from './consultations-detail';
import { EditConsultationPage, NewConsultationPage, type EditConsultationData, type NewConsultationData } from './consultations-form';
import { ConsultationStatsPage, PanelData, type ConsultationStatsData } from './consultations-stats';

export const HOST_TITLE = '원생상담';
export const HOST_ROUTE = '/consultations';
const SCREEN = 'consultations';
const ACTIONS = 'features/consultations/server/actions.ts';
// 2.0 주소 열쇠 그대로(목록·통계 필터 · 새 상담의 학생) — 그 밖의 열쇠(embed 등)는 조회에 싣지 않는다.
const KEEP = ['range', 'cat', 'urg', 'who', 'subject', 'q', 'page', 'size', 'studentId', 'form', 'recordStudent'];

type Base = { editors: HostEditor[]; operations: Record<string, unknown>; modules: { disabled: string[] }; page: string };

/** 쓰기 경로(POST /api/v2/consultations/<함수>) — serverAction과 같은 본문·같은 거절 모양({ error }). 끝난 뒤 할 일(새로 읽기·이동)은 부르는 쪽이. */
async function post(name: string, args: unknown[]): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const enc = (v: unknown) => (v instanceof FormData ? { $formData: [...v.entries()].filter(([, x]) => typeof x === 'string') } : v === undefined ? null : v);
  try {
    const res = await fetch(`/api/v2/${SCREEN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: ACTIONS, actor: hostActor(), args: args.map(enc) }) });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; message?: string; error?: string } | null;
    if (res.status === 404 && body?.error === 'action_not_found') return { ok: false, error: VIEW_ONLY };
    if (!res.ok || !body?.ok) return { ok: false, error: body?.message || '저장하지 못했습니다 — 바뀐 것은 없습니다' };
    return { ok: true, result: body.result };
  } catch { return { ok: false, error: '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다' }; }
}
// 후속 조치 완료 — 2.0은 revalidatePath로 화면을 다시 그린다. 여기선 저장이 끝나면 이 화면 자료를 다시 읽는다.
registerHostHandler(ACTIONS, 'toggleConsultationFollowUp', async (prev, fd) => {
  const r = await post('toggleConsultationFollowUp', [prev, fd]);
  if (!r.ok) return { error: r.error };
  hostRefresh();
  return r.result ?? undefined;
});
// 상담 삭제 — 2.0은 성공하면 서버가 redirect(redirectTo). 여기선 같은 주소로 옮긴다.
registerHostHandler(ACTIONS, 'deleteStudentConsultation', async (prev, fd) => {
  const r = await post('deleteStudentConsultation', [prev, fd]);
  if (!r.ok) return { error: r.error };
  const result = r.result as { error?: string } | null | undefined;
  if (result?.error) return result;
  const to = fd instanceof FormData ? String(fd.get('redirectTo') ?? '') : '';
  if (to) hostNavigate(to, 'replace'); else hostRefresh();
  return undefined;
});
// 반 칸 선택지 — 읽기라 쓰기 경로가 아니라 이 화면의 읽기 경로(GET op=classOptions)로(보기 중 쓰기 0).
registerHostHandler('features/consultations/server/class-actions.ts', 'getConsultationClassOptions', async (input) => {
  const i = (input ?? {}) as { studentId?: string; consultedAt?: string; counselorId?: string | null; subject?: string | null };
  const q = new URLSearchParams({ op: 'classOptions', cStudent: i.studentId ?? '', cAt: i.consultedAt ?? '', cCounselor: i.counselorId ?? '', cSubject: (i.subject ?? '').slice(0, 60) });
  const actor = hostActor();
  if (actor) q.set('actor', actor);
  try {
    const r = await fetch(`/api/v2/${SCREEN}?${q}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { error: '반 목록을 불러오지 못했습니다' };
    return ((await r.json()) as { result: unknown }).result;
  } catch { return { error: '반 목록을 불러오지 못했습니다' }; }
});

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
const DETAIL = new RegExp(`^/consultations/${UUID}$`, 'i'), EDIT = new RegExp(`^/consultations/${UUID}/edit$`, 'i');
function App() {
  const path = usePathname(), search = useSearchParams(), actor = useActor();
  const known = path === HOST_ROUTE || path === '/consultations/new' || path === '/consultations/stats' || DETAIL.test(path) || EDIT.test(path);
  const q = new URLSearchParams();
  for (const k of KEEP) { const v = search.get(k); if (v !== null && v !== '') q.set(k, v); }
  if (path !== HOST_ROUTE) q.set('v2path', path);
  if (actor) q.set('actor', actor);
  const query = q.toString();
  const [state, setState] = useState<{ query?: string; data?: Base; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (!known) return;
    let live = true;
    fetch(`/api/v2/${SCREEN}?${query}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '원생상담을 불러오지 못했습니다.'); return body as Base; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick, known]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  if (!known) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  if (!state.data && !state.error) return <HostMessage text="원생상담을 불러오는 중…" />;
  if (!state.data) return <HostMessage text={state.error!} error />;
  const data = state.data;
  if (data.page === 'noMenu') return <HostMessage text="원생상담을 열 수 있는 직원이 없습니다." error />;
  if (data.page === 'notFound') return <HostMessage text="이 상담을 볼 수 없습니다. 지워졌거나, 강사는 본인이 쓴 상담만 볼 수 있습니다." error />;
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  // 주소 열쇠는 그 자료를 받은 주소의 것(다음 자료가 오기 전 잠깐 옛 자료 + 새 주소로 어긋나 그리지 않게).
  const sp = Object.fromEntries([...new URLSearchParams(state.query ?? '').entries()].filter(([k]) => k !== 'actor' && k !== 'v2path'));
  const d = data as never;
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.modules.disabled as never}>
      {data.page === 'list' ? (
        <SummaryData.Provider value={{ summary: (d as ConsultationsListData).summary, operations: (d as ConsultationsListData).operations }}><ConsultationsPage key={state.query} data={d} /></SummaryData.Provider>
      ) : data.page === 'detail' ? <ConsultationDetailPage key={state.query} data={d as ConsultationDetailData} />
        : data.page === 'edit' ? <EditConsultationPage key={`${path}:${actor}`} data={d as EditConsultationData} />
        : data.page === 'new' ? <NewConsultationPage key={`${actor}:${sp.form ?? ''}:${sp.recordStudent ?? ''}`} data={d as NewConsultationData} sp={sp} />
        : <PanelData.Provider value={d as ConsultationStatsData}><ConsultationStatsPage key={state.query} data={d} /></PanelData.Provider>}
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
