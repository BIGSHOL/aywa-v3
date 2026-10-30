// 2.0 부품 호스트 — 퇴원관리 진입점(처리 화면 세션 R). 3.0 `#v2-withdrawals`가 같은 출처 iframe(/v2-host/withdrawals.html?…)으로 연다.
// 2.0 주소: /withdrawals(목록 · page.tsx) · /withdrawals/<학생 id>(퇴원 상세 · [studentId]/page.tsx).
// 데이터 = /api/v2/withdrawals?…(Docker 복사본, v2-screen-withdrawals.mjs). 목록은 2.0처럼 둘로 받는다 — 목록 재료 먼저,
// 담당 판정(무겁다)은 같은 조건의 part=teacher로 나중에(2.0 Suspense 흘려받기). 강사 칸 필터가 걸리면 2.0처럼 판정까지 기다린다.
// 저장 = 2.0 부품이 부르는 2.0 서버 함수 이름 그대로(POST /api/v2/withdrawals/<함수>). 성공하면 2.0 revalidatePath처럼 이 화면을 다시 읽는다.
// 다른 2.0 화면 주소(원생 상세 · 퇴원보고서 · 콜&상담)는 이 창에서 열지 않고 3.0에 넘긴다(3.0에 그 화면이 있으면 그 화면으로).
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { hostRefresh, onHostRefresh } from '../shims/host-nav';
import { hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';
import { WithdrawalsList, type ListData, type TeacherInfo, type TeacherState } from './withdrawals-list';
import { WithdrawalDetail, type DetailData } from './withdrawals-detail';

export const HOST_TITLE = '퇴원관리';
export const HOST_ROUTE = '/withdrawals';
const SCREEN = 'withdrawals';

// ── 저장: 2.0 서버 함수 이름 그대로 보내고, 성공하면 다시 읽는다(2.0 revalidatePath('/withdrawals…')) ─────────────────────
const NOT_SAVED = '저장하지 못했습니다 — 바뀐 것은 없습니다', UNREACHABLE = '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다';
const encodeArg = (v: unknown) =>
  v instanceof FormData ? { $formData: [...v.entries()].filter(([, x]) => typeof x === 'string') } : v === undefined ? null : v;
function saving(module: string, name: string, refresh: boolean) {
  registerHostHandler(module, name, async (...args: unknown[]) => {
    let res: Response;
    try {
      res = await fetch(`/api/v2/${SCREEN}/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ module, actor: hostActor(), args: args.map(encodeArg) }),
      });
    } catch { return { error: UNREACHABLE, ok: false }; }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!res.ok || !body?.ok) return { error: body?.message || NOT_SAVED, ok: false };
    const r = body.result as { ok?: boolean; error?: string } | null | undefined;
    if (refresh && (r == null || r.ok === true)) hostRefresh();
    return r ?? undefined;
  });
}
const ACTIONS = 'features/withdrawals/server/actions.ts';
saving(ACTIONS, 'updateWithdrawalReason', true);
saving(ACTIONS, 'toggleConsultationStep', true);
saving(ACTIONS, 'reactivateStudent', true);
saving('features/enrollments/server/actions.ts', 'updateEnrollmentDates', true);
// 보기 취향 저장은 2.0도 다시 읽지 않는다(분석 카드가 필요할 때만 스스로 router.refresh).
saving('features/withdrawals/server/trend-prefs-actions.ts', 'saveWithdrawalTrendPrefs', false);

/** 보는 사람 — 셸에서 선택한 현재 값(부모 셸 계정). 바뀌면 다시 읽는다. */
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

type Base = { editors?: HostEditor[]; settings?: ListData['settings']; notFound?: boolean; notAllowed?: boolean };
/**
 * 화면 자료 — 같은 종류(`kind` — 목록 / 그 학생 상세)의 다른 조건으로 옮기는 동안엔 옛 자료를 그대로 보인다(2.0은 이동 중 옛 화면을 붙든다 —
 * 필터를 자주 바꾸는 화면이라 스켈레톤을 두지 않았다, page.tsx B7 주석). 종류가 바뀌면 비운다.
 */
function useFetch<T>(query: string | null, kind = '') {
  const [state, setState] = useState<{ query?: string; kind?: string; data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (query === null) return;
    let live = true;
    fetch(`/api/v2/${SCREEN}?${query}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '퇴원관리를 불러오지 못했습니다.'); return body as T; })
      .then((data) => live && setState({ query, kind, data }))
      .catch((e: Error) => live && setState({ query, kind, error: e.message }));
    return () => { live = false; };
  }, [query, kind, tick]);
  if (query === null) return {};
  if (state.query === query) return state;
  return kind && state.kind === kind && state.data ? { data: state.data } : {};
}

/** 목록이 읽는 주소 열쇠(2.0 page.tsx searchParams). */
const KEYS = ['type', 'range', 'month', 'from', 'to', 'reason', 'detail', 'q', 'subject', 'program', 'consult', 'early', 'grade', 'school', 'teacher', 'axis', 'page', 'size'] as const;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DETAIL = new RegExp(`^/withdrawals/${UUID}$`, 'i');

function Shell({ data, children }: { data: Base; children: React.ReactNode }) {
  const ops = data.settings!.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.settings!.modules.disabled as never}>{children}</OperationsProvider>;
}

/** 다른 2.0 화면 주소는 3.0에 넘긴다 — 이 창(iframe)에서 다른 화면 문서를 읽지 않게. */
function useForeignLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const href = a?.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
      const path = href.split(/[?#]/)[0];
      if (path === '/withdrawals' || path.startsWith('/withdrawals/')) return;
      e.preventDefault(); e.stopPropagation();
      window.parent.postMessage({ type: 'v2-host-open', href }, location.origin);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

function App() {
  useForeignLinks();
  const path = usePathname(), search = useSearchParams(), actor = useActor();
  const detail = DETAIL.test(path), known = detail || path === HOST_ROUTE;
  const sp = useMemo(() => (detail ? {} : Object.fromEntries(KEYS.flatMap((k) => (search.get(k) ? [[k, search.get(k)!]] : [])))) as Record<string, string>, [detail, search]);
  const query = new URLSearchParams({ ...sp, ...(detail ? { v2path: path } : {}), ...(actor ? { actor } : {}) }).toString();
  const main = useFetch<Base & ListData & DetailData>(known ? query : null, detail ? path : 'list');
  // 담당 판정 — 목록에서만(상세엔 없다). 같은 조건 + part=teacher. 받은 판정은 Map으로 되살린다.
  const teacherRaw = useFetch<{ teacher: { entries: [string, [string, string[]][]][]; names: Record<string, string>; options: { excludeReasons: string[]; countEnded: boolean } } | null }>(
    known && !detail ? `${query}${query ? '&' : ''}part=teacher` : null,
  );
  const teacher: TeacherState = useMemo(() => {
    if (teacherRaw.error) return { status: 'ready', info: null };
    if (!teacherRaw.data) return { status: 'loading' };
    const t = teacherRaw.data.teacher;
    const info: TeacherInfo = t ? { map: new Map(t.entries.map(([k, per]) => [k, new Map(per)])), names: new Map(Object.entries(t.names)), options: t.options } : null;
    return { status: 'ready', info };
  }, [teacherRaw]);
  useEffect(() => { if (main.data?.editors) setHostEditors(main.data.editors); }, [main.data?.editors]);

  if (!known) return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  if (main.error) return <HostMessage text={main.error} error />;
  if (!main.data) return <HostMessage text="퇴원관리를 불러오는 중…" />;
  const data = main.data;
  if (data.notAllowed) return <HostMessage text="현재 계정은 퇴원관리를 볼 수 없습니다. 왼쪽 아래에서 계정을 전환해 주세요." error />;
  if (data.notFound) return <HostMessage text="이 학생을 찾을 수 없습니다. 목록에서 다시 골라 주세요." error />;
  // 강사 칸 필터(`teacher=`)는 판정으로 명단을 거른다 — 2.0도 그때는 판정을 기다린 뒤 그린다.
  if (!detail && sp.teacher && teacher.status === 'loading') return <HostMessage text="퇴원관리를 불러오는 중…" />;
  return <Shell data={data}>{detail ? <WithdrawalDetail data={data} /> : <WithdrawalsList data={data} teacher={teacher} sp={sp} />}</Shell>;
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
