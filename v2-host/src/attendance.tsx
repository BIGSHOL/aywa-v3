// 2.0 부품 호스트 — 월별 출석부 진입점. 3.0 `#v2-attendance`가 같은 출처 iframe(/v2-host/attendance.html?…)으로 연다.
// 2.0 page.tsx(`/attendance`)가 그리는 그대로(attendance-page.tsx), 2.0 (shell) 레이아웃이 창(embed) 화면을 감싸는
// 공급자(Embed · 화면 언어 · 운영 설정)로 감싼다. 데이터 = /api/v2/attendance?…(Docker 복사본) — page.tsx가 부품에 넘기던 값 그대로.
// 로그인이 없으니 '보는 사람'은 3.0 띠에서 고른 저장하는 사람(정렬·날짜축·퇴직 숨김·접은 반은 그 사람의 ui_prefs).
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { EmbedProvider } from '@/components/workspace/embed-context';
import { SheetLangProvider } from '@/features/teacher-view/lang-context';
import { hostNavigate, onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { hostActor, registerHostHandler, setHostEditors } from '../shims/server-action';
import { HostFrame, HostMessage } from './host-frame';
import { AttendancePage, type AttendanceData } from './attendance-page';
import { AttendanceSeatPage, type SeatDayData } from './attendance-seat-page';
import { AttendanceSeatMonth, AttendanceSeatMonthClosed, type SeatMonthData } from './attendance-seat-month';
import { AttendanceQuickPage, type QuickData } from './attendance-quick-page';
import { AttendanceLivePage, type LiveData } from './attendance-live-page';

/** 하위 주소의 값 — 자리 하루(seatDay) · 2.0 redirect · 2.0 notFound. 월별 출석부(`/attendance`)는 page 칸이 없다. */
type Host = { lang: 'ko' | 'en'; host: AttendanceData['host'] };
type Data = (AttendanceData & { page?: undefined }) | (SeatDayData & Host) | (SeatMonthData & Host) | (QuickData & Host) | (LiveData & Host) | (Host & { page: 'seatMonthClosed'; seatName: string })
  | (Host & { page: 'redirect'; to: string }) | (Host & { page: 'notFound' });

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '출석부';
export const HOST_ROUTE = '/attendance';

/**
 * 다시 받아야 하는 주소 열쇠 — 2.0에서 서버를 다시 그리던 것(달·과목·강사·반·보기 · 하위 주소 v2path · 자리의 날짜·교시).
 * `q`(학생 검색 씨앗)는 첫 렌더 씨앗일 뿐이라(2.0도 검색어는 History API로만 바꾼다 — att-search-seed.ts) 열쇠에 넣지 않고 함께 보내기만 한다.
 */
const KEYS = ['v2path', 'month', 'subject', 'teacher', 'class', 'mode', 'date', 'start', 'tab', 'from'] as const;

/**
 * 오늘 출결 화면의 폴링(2.0 `getLiveRecordedCount` · `getRecapStatus` — 바뀌었으면 router.refresh) — 읽기라 쓰기 경로(POST)가 아니라
 * 그 화면의 읽기 경로(GET ?poll=…)로 지문만 받는다(보기 중 쓰기 0). 못 받으면 null(2.0 부품이 '바뀐 것 없음'으로 읽는다).
 */
const pollRead = (kind: 'live' | 'recap', date: unknown, from?: unknown) => {
  const q = new URLSearchParams({ v2path: '/attendance/live', poll: kind });
  if (typeof date === 'string') q.set('date', date);
  if (typeof from === 'string') q.set('from', from);
  return fetch(`/api/v2/attendance?${q}`, { headers: { Accept: 'application/json' } })
    .then(async (r) => (r.ok ? ((await r.json()) as { fingerprint?: string }).fingerprint ?? null : null)).catch(() => null);
};
registerHostHandler('features/attendance/live/server/poll-actions.ts', 'getLiveRecordedCount', (date) => pollRead('live', date));
registerHostHandler('features/attendance/recap/server/poll-actions.ts', 'getRecapStatus', (from, to) => pollRead('recap', to, from));

function App() {
  const search = new URLSearchParams(useHostSearch());
  const [viewer, setViewer] = useState<string | null>(null);
  const key = [...KEYS.map((k) => `${k}=${search.get(k) ?? ''}`), `viewer=${viewer ?? ''}`].join('&');
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  // 지금 화면이 그려진 사람(서버가 고른 보는 사람) — 띠가 같은 사람을 다시 알려 오면 다시 받지 않는다.
  const drawnFor = useRef<string | null>(null);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  // 3.0 띠에서 저장하는 사람을 바꾸면 그 사람의 보기 설정으로 다시 받는다(shim이 먼저 받아 두므로 다음 틱에 읽는다).
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
    const q = new URLSearchParams();
    for (const k of [...KEYS, 'q'] as const) { const v = search.get(k); if (v) q.set(k, v); }
    if (viewer) q.set('viewer', viewer);
    fetch(`/api/v2/attendance${q.size ? `?${q}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '출석부를 불러오지 못했습니다.'); return body as Data; })
      .then((data) => {
        if (!live) return;
        if (data.page === 'redirect' || data.page === 'notFound' || data.page === 'seatMonthClosed') { setState({ key, data }); return; }
        setHostEditors(data.editors);
        // 띠에 남아 있던 사람(같은 출처 저장소)이 서버가 고른 사람과 다르면 그 사람으로 한 번 더 받는다.
        const picked = hostActor();
        if (picked && picked !== data.viewer && picked !== viewer) { setViewer(picked); return; }
        drawnFor.current = data.viewer;
        setState({ key, data });
      })
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
    // search는 key에 담긴 값만 다시 받는 이유가 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  // 2.0 redirect 자리 — 강사 드롭다운의 자리(랩실·JJ실) → 자리 출석부(page.tsx `redirect(/attendance/seat/<자리>)`) ·
  // `/attendance/seat` → 첫 자리(seat/page.tsx). 호스트 안 이동(replace)이라 같은 화면이 그 주소로 다시 받는다.
  const current = state.key === key ? state.data : undefined;
  const redirectTo = current?.page === 'redirect' ? current.to : current && !current.page && current.seatPick ? `/attendance/seat/${current.seatPick}` : null;
  useEffect(() => { if (redirectTo) hostNavigate(redirectTo, 'replace'); }, [redirectTo]);
  // 2.0도 달·반·강사를 바꾸면 loading.tsx가 선다(서버를 다시 그린다) — 다른 조건의 옛 표를 그대로 두지 않는다.
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '출석부를 불러오는 중…'} error={failed} />;
  }
  const d = state.data;
  if (redirectTo || d.page === 'redirect') return <HostMessage text="출석부를 불러오는 중…" />;
  // 2.0 notFound — 자리 기능이 꺼진 학원·없는 자리(2.0은 없는 주소와 똑같이 다룬다).
  if (d.page === 'notFound') return <HostMessage text="이 주소의 화면이 없습니다." />;
  if (d.page === 'seatMonthClosed') return <EmbedProvider embed><AttendanceSeatMonthClosed seatName={d.seatName} /></EmbedProvider>;
  if (!d.editors.length) return <HostMessage text={d.page === 'seatDay' || d.page === 'seatMonth' ? '이 자리 출석부를 입력할 수 있는 직원이 없습니다.' : '출결을 저장할 수 있는 직원이 없습니다.'} />;
  const ops = d.host.operations;
  return (
    <EmbedProvider embed>
      <SheetLangProvider lang={d.lang}>
        <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
          {d.page === 'seatDay' ? <AttendanceSeatPage data={d} />
            : d.page === 'seatMonth' ? <AttendanceSeatMonth data={d} holidaySource={d.host.operations.holidays} />
            : d.page === 'quick' ? <AttendanceQuickPage data={d} subjects={ops.subjects} />
            : d.page === 'live' ? <AttendanceLivePage data={d} subjects={ops.subjects} />
            : <AttendancePage data={d} />}
        </OperationsProvider>
      </SheetLangProvider>
    </EmbedProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="attendance"><App /></HostFrame></AppProviders>);
