// 2.0 부품 호스트 — 강사 시트 · 영어(ECS) 진입점. 3.0 `#v2-ecs`가 같은 출처 iframe(/v2-host/ecs.html?…)으로 연다.
// 2.0 (shell) 레이아웃 + ecs/layout.tsx가 감싸는 공급자(운영 설정 · 화면 언어 · 영어 이름 편집 권한) 그대로 감싸고, 화면은 ecs-page.tsx
// (2.0 page.tsx 조립)가 2.0 부품(SheetClient · MonthClient · EcsLandingList …)을 수정 없이 그린다.
// 데이터 = /api/v2/ecs?v2path=…&viewer=…&…(Docker 복사본) — 2.0 page.tsx가 부품에 넘기던 props 모양 그대로(v2-ecs-props.mjs).
// 2.0 주소: /ecs · /ecs/<반> · /ecs/<반>/month — 하위 주소는 iframe 주소의 v2path로 싣는다(3.0 쪽 v2-screen-ecs.js가 같은 규칙으로 연다).
// 보는 사람 = 저장하는 사람(3.0 띠에서 고른다 — 로그인 대신). 바뀌면 그 사람의 화면(권한·강사 스코프·보기 설정)으로 다시 받는다.
// 실시간 편집 표시(EditPresenceProvider)·알림은 감싸지 않는다 — 공급자가 없으면 2.0 훅이 아무것도 하지 않아 바깥 접속이 생기지 않는다.
// 서버 액션 모듈("use server" — shim이 /api/v2/ecs/<함수>로 잇는다): v2-screen-ecs.mjs 머리 주석의 대응표.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { SheetLangProvider } from '@/features/teacher-view/lang-context';
import { EnglishNameProvider } from '@/features/class-sheets/components/english-name-context';
import { onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { hostActor, registerHostFallback, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { HostFrame, HostMessage } from './host-frame';
import { EcsGoalsPage, EcsLandingPage, EcsMonthPage, EcsNotYetPage, EcsSheetPage, type GoalsData, type LandingData, type MonthData, type SheetData } from './ecs-page';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '강사 시트';
export const HOST_ROUTE = '/ecs';

/** 읽기 서버 액션 — 2.0 getEcsDayPlan(월간 '그 날 고치기') · getSlotPlanCompare([계획 비교])는 저장이 아니라 같은 화면의 GET으로 묻는다
 *  (시간표 loadExitOverlay와 같은 규약 — 보기는 쓰기 기록에 남지 않는다). 답은 2.0 반환 모양 그대로({ ok, … } · { ok:false, error }). */
const READ_FAILED = '불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.';
async function readOnServer(read: 'dayPlan' | 'compare', fields: Record<string, unknown>) {
  const q = new URLSearchParams({ read });
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string' && v) q.set(k, v);
  const viewer = hostActor();
  if (viewer) q.set('viewer', viewer);
  const r = await fetch(`/api/v2/ecs?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r ? ((await r.json().catch(() => null)) as { ok?: unknown } | null) : null;
  return r?.ok && body && typeof body.ok === 'boolean' ? body : { ok: false, error: READ_FAILED };
}
registerHostHandler('features/class-sheets/server/day-plan.ts', 'getEcsDayPlan', async (input) => {
  const { classId, planDate } = (input ?? {}) as { classId?: unknown; planDate?: unknown };
  return readOnServer('dayPlan', { class: classId, date: planDate });
});
registerHostHandler('features/textbooks/server/compare-actions.ts', 'getSlotPlanCompare', async (input) => {
  const { classId, date, slotStart } = (input ?? {}) as { classId?: unknown; date?: unknown; slotStart?: unknown };
  return readOnServer('compare', { class: classId, date, slot: slotStart });
});

/** 반환이 { ok, error }가 아닌 2.0 함수 — 저장이 안 될 때(받지 않는 함수 · 거절 · 불통) 2.0이 실패 때 내던 모양(부품이 그 모양으로 읽는다). 보강 추가 흐름(EcsMakeupAdder → MakeupAddFlow). */
registerHostFallback('features/attendance/server/actions.ts', 'searchMakeupStudents', () => []);
registerHostFallback('features/attendance/server/makeup-actions.ts', 'fetchMakeupAbsences', () => ({ options: [], hiddenBySubject: 0 }));
registerHostFallback('features/attendance/server/makeup-actions.ts', 'fetchMakeupHostClasses', () => ({ options: [], failed: true }));

type Ops = ComponentProps<typeof OperationsProvider>;
type Data = {
  asOf: string;
  editors: HostEditor[];
  viewer: { id: string; name: string; role: string } | null;
  host: { operations: Pick<Ops, 'subjects' | 'gradeLevels' | 'jobTitles' | 'jobTitlesByDepartment'>; disabledModules: Ops['disabledModules']; lang: 'ko' | 'en'; englishNameEnabled: boolean };
  route: 'none' | 'landing' | 'today' | 'room' | 'sheet' | 'month' | 'goals' | 'gap';
  scoped?: boolean;
  landing?: LandingData;
  sheet?: SheetData;
  month?: MonthData;
  goals?: GoalsData;
};

/** 서버를 다시 부르는 주소 열쇠 — 2.0에서 서버가 다시 그리던 것(주소·주·면·달·기간·날짜·읽기 전용). `day`는 2.0 시트가 주소만 바꾸는 값이라 뺀다. */
const KEYS = ['v2path', 'week', 'view', 'date', 'mode', 'month', 'period', 'readonly'] as const;
const ACTOR_KEY = 'v2-host-actor:ecs';
const storedActor = () => { try { return localStorage.getItem(ACTOR_KEY); } catch { return null; } };

function App() {
  const qs = useHostSearch(), search = new URLSearchParams(qs);
  // 보는 사람 — 3.0 띠가 고르면 v2-host-actor로 알려 준다(shim도 같은 알림으로 저장하는 사람을 정한다).
  // 처음 열 때 고른 사람이 없으면 서버가 첫 사람(원장 먼저)으로 정한다 — 3.0 띠가 그 사람을 다시 알려 와도 같은 사람이면 다시 받지 않는다(입력 중인 시트가 다시 서지 않게).
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
  const q = new URLSearchParams();
  for (const k of KEYS) { const v = search.get(k); if (v) q.set(k, v); }
  if (viewer) q.set('viewer', viewer);
  const key = q.toString();
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/ecs${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '강사 시트를 불러오지 못했습니다.'); return body as Data; })
      .then((data) => live && setState({ key, data }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick]);
  const editors = state.data?.editors;
  const resolvedViewer = state.data?.viewer?.id ?? null;
  // 순서: 먼저 '보이는 사람'을 적고 나서 목록을 알린다(3.0 띠의 답이 이 값과 비교된다).
  useEffect(() => { shownViewer.current = resolvedViewer; }, [resolvedViewer]);
  useEffect(() => { if (editors) setHostEditors(editors); }, [editors]);
  // 다른 주소·다른 사람의 자료로 새 주소를 그리지 않는다(바꾼 직후 · 받기 실패). 같은 주소의 새로고침(router.refresh)은 옛 화면을 둔 채 받는다.
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '강사 시트를 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations, lang = d.host.lang;
  if (d.route === 'none') return <HostMessage text="강사 시트를 볼 수 있는 직원이 없습니다." />;
  const body = d.route === 'landing' && d.landing ? <EcsLandingPage landing={d.landing} scoped={!!d.scoped} lang={lang} />
    : d.route === 'sheet' && d.sheet ? <EcsSheetPage sheet={d.sheet} />
      : d.route === 'month' && d.month ? <EcsMonthPage month={d.month} />
        : d.route === 'goals' && d.goals ? <EcsGoalsPage goals={d.goals} lang={lang} />
        : <EcsNotYetPage route={d.route === 'room' || d.route === 'goals' || d.route === 'gap' ? d.route : 'today'} scoped={!!d.scoped} lang={lang} />;
  return (
    <SheetLangProvider lang={lang}>
      <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
        {/* 2.0 ecs/layout.tsx — 학생 영어 이름 칸은 그 권한(student_english_name 쓰기)이 있는 사람만 고친다. */}
        <EnglishNameProvider key={d.viewer?.id ?? ''} enabled={d.host.englishNameEnabled}>{body}</EnglishNameProvider>
      </OperationsProvider>
    </SheetLangProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="ecs"><App /></HostFrame></AppProviders>);
