// 2.0 부품 호스트 — 시간표 진입점. 3.0 `#v2-timetable`이 같은 출처 iframe(/v2-host/timetable.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터는 /api/v2/timetable?week=…(Docker 복사본)에서 2.0 서버 함수가 내던 모양으로 받는다.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { TimetablePage, type TimetableData } from './timetable-page';
import { onHostRefresh } from '../shims/host-nav';
import { VIEW_ONLY, registerHostHandler, setHostEditors } from '../shims/server-action';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

/** 시간표 X(퇴원 겹침) — 2.0 loadExitOverlay는 읽기라 같은 화면의 GET(exit·anchor)으로 묻는다. 답은 2.0 반환 모양({ ok, data } · { ok:false, error }). */
const EXIT_FAILED = '퇴원 목록을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
registerHostHandler('features/withdrawals/server/exit-overlay-actions.ts', 'loadExitOverlay', async (input) => {
  const { subject, anchor } = (input ?? {}) as { subject?: string; anchor?: string | null };
  const q = new URLSearchParams({ exit: String(subject ?? '') });
  if (anchor) q.set('anchor', anchor);
  const r = await fetch(`/api/v2/timetable?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r ? ((await r.json().catch(() => null)) as { ok?: unknown } | null) : null;
  return r?.ok && body && typeof body.ok === 'boolean' ? body : { ok: false, error: EXIT_FAILED };
});

/** 뷰 설정 저장(2.0 saveTimetableViewPrefs = 로그인한 사람의 ui_prefs) — 3.0엔 로그인이 없고 화면이 열릴 때마다 동기화가 부르므로
 *  고른 직원의 계정 설정을 덮지 않게 열지 않는다(보기는 주소로만). 서버로 보내지 않고 2.0 실패 모양으로 거절한다. */
registerHostHandler('features/timetable/server/view-prefs-actions.ts', 'saveTimetableViewPrefs', async () => ({ ok: false, error: VIEW_ONLY }));

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '시간표';
export const HOST_ROUTE = '/timetable';

type Raw = Omit<TimetableData, 'allSlots' | 'makeup' | 'seatWeek' | 'scheduledImports' | 'memoSheets'> & Partial<Pick<TimetableData, 'makeup' | 'seatWeek' | 'scheduledImports' | 'memoSheets'>> & { allSlots: Omit<TimetableData['allSlots'][number], 'students'>[]; rosters: Record<string, TimetableData['allSlots'][number]['students']> };

/** 반별로 받은 명단을 2.0 모양(배치마다 students)으로 다시 붙인다 — 같은 반 배치는 같은 명단 배열(2.0과 같다). */
const attach = (raw: Raw): TimetableData => ({
  ...raw,
  // 서버(4310)가 아직 옛 모듈이면 이 칸들이 없다 — 빈 값으로 그린다(보강 줄·*LAB 칸·배지·메모 시트만 빠진다).
  makeup: raw.makeup ?? { reservations: [], students: [] }, seatWeek: raw.seatWeek ?? { moves: null, live: null },
  scheduledImports: raw.scheduledImports ?? [], memoSheets: raw.memoSheets ?? {},
  allSlots: raw.allSlots.map((s) => ({ ...s, students: raw.rosters[s.classId] ?? [] })) as TimetableData['allSlots'],
});

function App() {
  // 주소는 호스트 안 이동(history)에 따라 바뀐다 — 쿼리는 화면 해석에, 주(week)만 다시 받아 오는 열쇠다(나머지는 2.0처럼 같은 자료에서 다시 조립).
  const qs = useHostSearch(), search = new URLSearchParams(qs);
  const week = search.get('week');
  const key = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : '';
  const [state, setState] = useState<{ key?: string; data?: TimetableData; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/timetable${key ? `?week=${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '시간표를 불러오지 못했습니다.'); return body as Raw; })
      .then((raw) => live && setState({ key, data: attach(raw) }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick]);
  // 저장할 수 있는 사람(수업 관리 '전체') — 3.0 띠가 이 목록에서 '저장하는 사람'을 고른다.
  const editors = state.data?.viewer.editors;
  useEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
  // 다른 주의 자료로 새 주소를 그리지 않는다(주를 바꾼 직후 · 받기 실패).
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '시간표를 불러오는 중…'} error={failed} />;
  }
  const ops = state.data.settings.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={state.data.settings.modules.disabled as never}>
      <TimetablePage data={state.data} search={search} />
    </OperationsProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="timetable"><App /></HostFrame></AppProviders>);
