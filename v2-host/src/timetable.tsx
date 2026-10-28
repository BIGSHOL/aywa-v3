// 2.0 부품 호스트 — 시간표 진입점. 3.0 `#v2-timetable`이 같은 출처 iframe(/v2-host/timetable.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider · <main class="embed-main">) 그대로 감싸고,
// 데이터는 /api/v2/timetable?week=…(Docker 복사본)에서 2.0 서버 함수가 내던 모양으로 받는다.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { TimetablePage, type TimetableData } from './timetable-page';
import { onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

type Raw = Omit<TimetableData, 'allSlots'> & { allSlots: Omit<TimetableData['allSlots'][number], 'students'>[]; rosters: Record<string, TimetableData['allSlots'][number]['students']> };

/** 반별로 받은 명단을 2.0 모양(배치마다 students)으로 다시 붙인다 — 같은 반 배치는 같은 명단 배열(2.0과 같다). */
const attach = (raw: Raw): TimetableData => ({ ...raw, allSlots: raw.allSlots.map((s) => ({ ...s, students: raw.rosters[s.classId] ?? [] })) as TimetableData['allSlots'] });

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
