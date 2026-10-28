// 2.0 부품 호스트 — 선생님 원스크린 진입점. 3.0 `#v2-onescreen`이 같은 출처 iframe(/v2-host/onescreen.html?…)으로 연다.
// 2.0 page.tsx가 그리는 그대로: <VideoHomeworkProvider …><OneScreenClient …/></VideoHomeworkProvider>를 수정 없이,
// 2.0 (shell) 레이아웃이 창(embed) 화면을 감싸는 공급자(Embed · 화면 언어 · 운영 설정)로 감싼다.
// 데이터 = /api/v2/onescreen?props=1&…(Docker 복사본) — page.tsx가 부품에 넘기던 props 모양 그대로(v2-onescreen-roster.mjs).
// 로그인이 없으니 '그 선생님'은 주소의 teacher(3.0 쪽이 고른다). 실시간 편집 표시(EditPresenceProvider)·알림은 감싸지 않는다 —
// 공급자가 없으면 2.0 훅이 아무것도 하지 않아 바깥 접속이 생기지 않는다.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { EmbedProvider } from '@/components/workspace/embed-context';
import { SheetLangProvider } from '@/features/teacher-view/lang-context';
import { WorkspaceEnabledProvider } from '@/components/workspace/workspace-enabled';
import { OneScreenClient } from '@/features/onescreen/components/onescreen-client';
import { VideoHomeworkProvider } from '@/features/video-homework/components/video-homework-provider';
import { onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
// 저장 경계(시간표 세션 소유) — 저장하는 사람을 알리는 함수가 있으면 쓴다(없는 판의 shim에서도 빌드·화면이 깨지지 않게).
import * as serverActionShim from '../shims/server-action';
import { HostFrame, HostMessage } from './host-frame';

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '선생님 수업보고서';
export const HOST_ROUTE = '/onescreen';

type Ops = ComponentProps<typeof OperationsProvider>;
type Data = {
  asOf: string;
  actor: { id: string; name: string } | null;
  oneScreen: ComponentProps<typeof OneScreenClient> | null;
  videoHomework: Omit<ComponentProps<typeof VideoHomeworkProvider>, 'children'> | null;
  page: { makeupNotice: string | null };
  host: { operations: Pick<Ops, 'subjects' | 'gradeLevels' | 'jobTitles' | 'jobTitlesByDepartment'>; disabledModules: Ops['disabledModules']; licenses: Ops['licenses']; lang: 'ko' | 'en' };
};

/** 다시 받아야 하는 주소 열쇠 — 2.0에서 서버를 다시 그리던 것(선생님·날짜·전체 보기). 보기·반·학생은 2.0 화면 안 상태라 그대로 둔다. */
const KEYS = ['teacher', 'date', 'all'] as const;

function App() {
  const qs = useHostSearch(), search = new URLSearchParams(qs);
  // 2.0 부품은 선생님을 모른다(로그인한 사람의 화면) — 날짜를 옮기면 주소를 `?date=`만으로 새로 쓴다. 고른 선생님은 그대로 둔다.
  const sticky = useRef<string | null>(null);
  if (search.get('teacher')) sticky.current = search.get('teacher');
  if (!search.get('teacher') && sticky.current) search.set('teacher', sticky.current);
  const key = KEYS.map((k) => `${k}=${search.get(k) ?? ''}`).join('&');
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    // 처음 그릴 때만 view·class·student를 함께 보낸다(page.tsx가 initialView·initialClassName·initialStudentId로 쓰는 값).
    const q = new URLSearchParams({ props: '1' });
    for (const k of [...KEYS, 'view', 'class', 'student']) { const v = search.get(k); if (v) q.set(k, v); }
    fetch(`/api/v2/onescreen?${q}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '수업보고서를 불러오지 못했습니다.'); return body as Data; })
      .then((data) => {
        if (!live) return;
        // 저장하는 사람 = 이 화면의 선생님 한 명(2.0에서 원스크린은 로그인한 선생님의 것 — 다른 사람으로 저장하지 않는다).
        (serverActionShim as { setHostEditors?: (list: { id: string; name: string; role: string }[]) => void }).setHostEditors?.(data.actor ? [{ id: data.actor.id, name: data.actor.name, role: 'teacher' }] : []);
        setState({ key, data });
      })
      // A failed re-fetch keeps the screen that is showing (its pending autosave and typing stay); only a first load shows the error.
      .catch((e: Error) => live && setState((s) => (s.key === key && s.data ? s : { key, error: e.message })));
    return () => { live = false; };
    // search는 key에 담긴 값만 다시 받는 이유가 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '수업보고서를 불러오는 중…'} error={failed} />;
  }
  const d = state.data;
  if (!d.oneScreen || !d.videoHomework) return <HostMessage text="담당 반이 있는 선생님이 없습니다." />;
  const ops = d.host.operations;
  // 2.0's teacher mini-shell has no window canvas: WorkspaceEnabledProvider enabled={false} ((shell)/layout.tsx) — otherwise
  // print (PDF) opens a phantom window in a store nobody draws. With it off, print goes through the router like 2.0's teacher view.
  return (
    <WorkspaceEnabledProvider enabled={false}>
    <EmbedProvider embed>
      <SheetLangProvider lang={d.host.lang}>
        <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules} licenses={d.host.licenses}>
          {d.page.makeupNotice ? <p role="status" className="border-line mb-3 rounded-lg border p-3 text-sm">{d.page.makeupNotice}</p> : null}
          {/* page.tsx와 같은 key — 날짜를 바꾸면 2.0처럼 새 로스터로 처음부터 그린다(useState는 처음 한 번만). */}
          <VideoHomeworkProvider key={d.oneScreen.date} {...d.videoHomework}>
            <OneScreenClient key={d.oneScreen.date} {...d.oneScreen} />
          </VideoHomeworkProvider>
        </OperationsProvider>
      </SheetLangProvider>
    </EmbedProvider>
    </WorkspaceEnabledProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="onescreen"><App /></HostFrame></AppProviders>);
