// 2.0 부품 호스트 — 운영실(대시보드) 진입점. 3.0 `#v2-dashboard`가 같은 출처 iframe(/v2-host/dashboard.html?…)으로 연다.
// 2.0 Overview를 호스트에서 그린다. 보강 KPI는 3.0 진행률 카드로 교체해 같은 2.0 카드 부품을 쓴다.
// 2.0 (shell) 레이아웃이 창(embed) 화면을 감싸는 공급자(Embed · 운영 설정)로 감싼다.
// 데이터 = /api/v2/dashboard?props=1(Docker 복사본) — 2.0 loadOverview가 돌려주던 스냅샷 모양 그대로(v2-dashboard-overview.mjs).
// 로그인이 없으니 '보는 사람'은 복사본 지점의 원장(원장 배치 · 원장 권한)이다.
// `preview` = 2.0 학원 설정 '대시보드 관리' 미리보기와 같은 모드 — 30초·포커스 갱신과 실시간 구독을 끈다. 갱신은 서버 액션(refreshOverview)인데
// 이 화면엔 그 동작이 없어 끄지 않으면 거절 응답이 스냅샷 자리에 들어가 화면이 깨진다(복사본은 연습 저장 말고는 바뀌지도 않는다).
// 카드·팝업의 2.0 주소(원생·반·출석부·시간표·공지·강의실 보기 …)는 이 iframe 안에서 열지 않는다 — 3.0(부모)에 넘겨 3.0 쪽 화면·기록 창으로 연다
// (iframe 안에서 다른 화면으로 바뀌면 운영실 자리를 차지하고, 운영실 안 이동은 '보는 원장'을 잃는다).
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useState, type ComponentProps } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { EmbedProvider } from '@/components/workspace/embed-context';
import { Overview } from '@/app/(shell)/dashboard/_overview/overview';
import { KpiCard } from '@/app/(shell)/dashboard/_overview/kpi-card';
import { identifyCard } from '@/app/(shell)/dashboard/_overview/card-id';
import { MenuGlyph } from '@/components/icons/menu-glyph';
import overviewStyle from '@/app/(shell)/dashboard/_overview/overview.module.css';
import { onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '운영실';
export const HOST_ROUTE = '/dashboard';

type Ops = ComponentProps<typeof OperationsProvider>;
type Data = {
  initial: ComponentProps<typeof Overview>['initial'] | null;
  chartKinds: ComponentProps<typeof Overview>['chartKinds'];
  host: { operations: Pick<Ops, 'subjects' | 'gradeLevels' | 'jobTitles' | 'jobTitlesByDepartment'>; disabledModules: Ops['disabledModules']; licenses: Ops['licenses'] } | null;
};
type ProgressRow = { id: string; studentId: string; name: string; className: string; absenceDate: string; makeupDate: string; slotStart: string; createdByName: string | null };
type Progress = { from: string; to: string; done: number; total: number; rate: number | null; pending: ProgressRow[]; upcoming: number };
type MakeupSection = { data: { progress?: Progress } | null; error?: boolean };

function MakeupProgressCard({ section }: { section: MakeupSection }) {
  const p = section.data?.progress, pending = p?.pending ?? [];
  const period = p ? `${p.from.slice(5).replace('-', '/')}~${p.to.slice(5).replace('-', '/')}` : '어제까지 30일';
  return identifyCard('kpi:makeup', <KpiCard label="보강 진행률" value={p?.rate == null ? '—' : String(p.rate)} unit="%"
    detailPrefix={period} labelNote="어제까지 30일" icon={<MenuGlyph name="undo" size={20} />} error={section.error}
    detail={p ? `보강 ${p.total}건 중 ${p.done}건 진행 · 미진행 ${pending.length}건 · 앞으로 잡힌 예약 ${p.upcoming}건` : '집계할 예약 없음'}
    popupTitle="보강 진행률 · 미진행 예약" jump={{ href: '/trend?metric=makeups', label: '보강 진행률 확장 추세 보기' }}>
    <p>보강일 {period} · 보강 {p?.total ?? 0}건 중 {p?.done ?? 0}건 진행 · 미진행 {pending.length}건</p>
    {pending.length ? <ul className={overviewStyle.kpiList}>{pending.map((r) => <li key={r.id} className={overviewStyle.kpiListRow}>
      <time className={overviewStyle.kpiTime}>{r.makeupDate.slice(5).replace('-', '/')} {r.slotStart}</time>
      <a href={`/students/${r.studentId}`}>{r.name}</a>
      <span className={overviewStyle.kpiListMeta}>{r.className} · 결석일 {r.absenceDate.slice(5).replace('-', '/')} · 세운 사람 {r.createdByName || '기록 없음'}</span>
    </li>)}</ul> : <p>{p ? '지난 30일 보강 중 미진행 예약이 없습니다.' : '보강 예약을 확인하지 못했습니다.'}</p>}
    <p className={overviewStyle.footnote}>앞으로 잡힌 예약 {p?.upcoming ?? 0}건은 시간표 보강 탭에서 확인할 수 있습니다.</p>
  </KpiCard>);
}

function App() {
  // 보는 사람 = 3.0 쪽이 고른 원장(주소 `viewer`) — 2.0은 로그인한 사람의 화면이라 이 값이 없다. 없으면 서버가 기본 원장을 고른다.
  const viewer = new URLSearchParams(useHostSearch()).get('viewer') ?? '';
  const [state, setState] = useState<{ key?: string; data?: Data | null; error?: string }>({});
  const [kpiRoot, setKpiRoot] = useState<HTMLElement | null>(null);
  const [tick, setTick] = useState(0);
  const client = useQueryClient();
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useLayoutEffect(() => {
    const old = state.data?.initial?.sections.makeup ? document.querySelector<HTMLElement>('[data-kpi="보강예정"]') : null;
    if (old) old.style.display = 'none';
    const frame = requestAnimationFrame(() => setKpiRoot(old?.parentElement ?? null));
    return () => { cancelAnimationFrame(frame); if (old) old.style.removeProperty('display'); };
  }, [state.data]);
  // 안쪽 링크는 모두 3.0(부모)에 넘긴다 — 2.0 Link가 iframe 안에서 이동하기 전에(capture) 가로챈다. 링크 대체 모듈은 호스트 화면 주소
  // (`<화면>.html?…` · 하위 경로는 `v2path`)를 href에 적으므로 2.0 경로로 되돌려 넘긴다. 바깥 주소(학생·반 …)는 그 모듈이 이미 넘긴다.
  // /api·http는 host-frame이 맡는다.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const raw = a?.getAttribute('href') ?? '';
      let href: string | null = null;
      if (raw.startsWith('/') && !raw.startsWith('//') && !/^\/(api|v2-host)\//.test(raw)) href = raw;
      else {
        const m = /^([a-z][a-z0-9-]*)\.html(\?[^#]*)?$/.exec(raw);
        if (m) {
          const q = new URLSearchParams(m[2]?.slice(1) ?? ''), sub = q.get('v2path');
          q.delete('v2path');
          const rest = q.toString();
          href = `${sub ?? `/${m[1]}`}${rest ? `?${rest}` : ''}`;
        }
      }
      if (!href) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.parent.postMessage({ type: 'v2-host-open', href }, window.location.origin);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ props: '1' });
    if (viewer) q.set('viewer', viewer);
    fetch(`/api/v2/dashboard?${q}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '운영실을 불러오지 못했습니다.'); return body as Data; })
      .then((data) => {
        if (!live) return;
        // 2.0 useOverview는 같은 원장이면 이미 있는 캐시를 읽고 새 initialData를 무시한다 — 새 스냅샷을 그리기 전에 비운다.
        client.removeQueries({ queryKey: ['dashboard-overview'] });
        setState({ key: viewer, data });
      })
      // 다시 받기가 실패하면 보이던 화면을 그대로 둔다 — 처음 받기만 오류를 띄운다.
      .catch((e: Error) => live && setState((s) => (s.key === viewer && s.data ? s : { key: viewer, error: e.message })));
    return () => { live = false; };
  }, [viewer, tick, client]);
  if (!state.data || state.key !== viewer) {
    const failed = state.key === viewer && !!state.error;
    return <HostMessage text={failed ? state.error! : '운영실을 불러오는 중…'} error={failed} />;
  }
  const d = state.data;
  if (!d.initial || !d.host) return <HostMessage text="운영실을 볼 원장 계정이 없습니다." />;
  const makeup = d.initial.sections.makeup as unknown as MakeupSection | undefined;
  const ops = d.host.operations;
  return (
    <EmbedProvider embed>
      <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules} licenses={d.host.licenses}>
        {/* 스냅샷이 바뀌면(다시 받기) 부품을 새로 그린다 — 캐시는 위에서 비웠다. */}
        <Overview key={d.initial.requestedAt} initial={d.initial} chartKinds={d.chartKinds} preview />
        {makeup && kpiRoot ? createPortal(<MakeupProgressCard section={makeup} />, kpiRoot) : null}
      </OperationsProvider>
    </EmbedProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="dashboard"><App /></HostFrame></AppProviders>);
