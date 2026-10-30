// 비포클래스체크리스트: 2.0 부품을 Docker 복사본의 조회·저장 경로에 연결한다.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { ChecklistBoard } from '@/features/before-class/components/board';
import { ClassPicker } from '@/features/before-class/components/class-picker';
import type { ChecklistTarget, ClassMonth } from '@/features/before-class/types';
import { onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { HostFrame, HostMessage } from './host-frame';

export const HOST_TITLE = '비포클래스체크리스트';
export const HOST_ROUTE = '/before-class';
const SCREEN = 'before-class';

type Data = {
  editors: HostEditor[];
  viewer: { id: string; name: string } | null;
  notAllowed?: boolean;
  canEdit: boolean;
  ready: boolean;
  targets: ChecklistTarget[];
  current: ChecklistTarget | null;
  data: ClassMonth | null;
  month: string;
  today: string;
  initialDate: string | null;
  academyName: string;
  logoSrc: string | null;
};

registerHostHandler('features/before-class/server/stats-actions.ts', 'getBeforeClassStudentHistory', async (input) => {
  const args = input as { classId?: string; studentId?: string };
  const q = new URLSearchParams({ read: 'history', class: args.classId ?? '', student: args.studentId ?? '' });
  const actor = hostActor(); if (actor) q.set('actor', actor);
  const res = await fetch(`/api/v2/${SCREEN}?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  return res?.ok && body ? body : { ok: false, error: '기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요' };
});

function App() {
  const search = new URLSearchParams(useHostSearch());
  const [actor, setActor] = useState<string | null>(() => hostActor());
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  useEffect(() => onHostRefresh(() => setTick(n => n + 1)), []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const msg = event.data as { type?: string; id?: unknown } | null;
      if (msg?.type === 'v2-host-actor' && typeof msg.id === 'string') setActor(msg.id);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, []);
  const q = new URLSearchParams();
  for (const key of ['class', 'month', 'date']) { const value = search.get(key); if (value) q.set(key, value); }
  if (actor) q.set('actor', actor);
  const key = q.toString();
  useEffect(() => {
    if (!actor) return;
    let live = true;
    fetch(`/api/v2/${SCREEN}?${key}`, { headers: { Accept: 'application/json' } })
      .then(async res => { const body = await res.json().catch(() => null); if (!res.ok) throw new Error(body?.message || '체크리스트를 불러오지 못했습니다.'); return body as Data; })
      .then(data => { if (live) setState({ key, data }); })
      .catch((error: Error) => { if (live) setState({ key, error: error.message }); });
    return () => { live = false; };
  }, [actor, key, tick]);
  const data = state.key === key ? state.data : undefined;
  useEffect(() => { if (data?.editors) setHostEditors(data.editors); }, [data?.editors]);
  if (!actor) return <HostMessage text="계정을 불러오는 중…" />;
  if (state.key === key && state.error) return <HostMessage text={state.error} error />;
  if (!data) return <HostMessage text="비포클래스체크리스트를 불러오는 중…" />;
  if (data.notAllowed) return <HostMessage text="이 체크리스트를 볼 권한이 없습니다." />;
  return <HostFrame screen={SCREEN}>
    <PageHeader title="비포클래스체크리스트(초안)" description="수업 전 숙제·준비 체크 — 미흡 3개 이상이면 보충 필요" />
    {!data.ready ? <p className="text-text-dim px-1 py-6 text-sm">준비 중입니다 — 저장 공간이 아직 만들어지지 않았습니다.</p>
      : !data.current || !data.data ? <p className="text-text-dim px-1 py-6 text-sm">체크리스트를 쓰는 반이 아직 없습니다.</p>
        : <ChecklistBoard key={`${data.current.id}|${data.month}`} classId={data.current.id} month={data.month}
            dates={data.data.dates} students={data.data.students} initialChecks={data.data.checks}
            initialDate={data.initialDate} today={data.today} trackingStart={data.data.trackingStart}
            canEdit={data.canEdit} report={{ levels: data.data.reportLevels, className: data.current.name,
              teacherName: data.current.teacherName, logoSrc: data.logoSrc, academyName: data.academyName }}
            classPicker={<ClassPicker targets={data.targets} current={data.current.id} month={data.month} />} />}
  </HostFrame>;
}

createRoot(document.getElementById('root')!).render(<AppProviders><App /></AppProviders>);
