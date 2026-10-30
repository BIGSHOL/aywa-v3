// 2.0 통합 성적관리 진입점 — 원본 UnifiedDashboard 본문과 여섯 탭의 부품.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { ExamsDashboard, type ExamsLoaded } from './exams-page';
import { ExamsInputPage, type InputLoaded } from './exams-input-page';
import { ExamsViewPage, type ViewLoaded } from './exams-view-page';
import { HostFrame, HostMessage } from './host-frame';
import { onHostRefresh } from '../shims/host-nav';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { hostActor, registerHostHandler, setHostEditors } from '../shims/server-action';

export const HOST_TITLE = '성적관리';
export const HOST_ROUTE = '/exams';
const KEYS = ['from', 'to', 'subject', 'kind', 'missing', 'student', 'cohortClass', 'schoolGroup', 'gradeGroup',
  'page', 'tab', 'q', 'month', 'level', 'tlevel', 'sort', 'dir', 'fSchool', 'fClass', 'fTeacher', 'fKind', 'fInfo', 'fScore', 'fDelta', 'fConsult',
  'entry', 'entryYear', 'entryTerm', 'entrySubject', 'entrySlot', 'entryClass', 'entryDate', 'entryMax',
  'year', 'term', 'class', 'slot', 'date', 'max', 'view', 'type', 'jjClass'] as const;
const asQuery = (sp: URLSearchParams, path: string) => new URLSearchParams([
  ...(path !== '/exams' ? [['v2path', path]] : []), ...KEYS.flatMap(k => sp.has(k) ? [[k, sp.get(k) ?? '']] : []),
]).toString();
const NOT_SAVED = '저장하지 못했습니다 — 바뀐 것은 없습니다';
const encodeArg = (v: unknown) => v instanceof FormData ? { $formData: [...v.entries()].filter(([, x]) => typeof x === 'string') } : v === undefined ? null : v;

registerHostHandler('features/grades/unified/server/entry-actions.ts', 'loadSchoolRoster', async (input) => {
  const q = new URLSearchParams({ roster: '1', args: JSON.stringify([input]) });
  const actor = hostActor(); if (actor) q.set('viewer', actor);
  const r = await fetch(`/api/v2/exams?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r ? await r.json().catch(() => null) : null;
  return r?.ok ? body?.value : { error: body?.message || NOT_SAVED };
});
for (const [name, module] of Object.entries({
  saveUnifiedGrade: 'features/grades/unified/server/actions.ts',
  createUnifiedGrade: 'features/grades/unified/server/create-action.ts',
  saveGradeScores: 'features/grades/server/actions.ts',
})) registerHostHandler(module, name, async (...args: unknown[]) => {
  const r = await fetch(`/api/v2/exams/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ module, actor: hostActor(), args: args.map(encodeArg) }),
  }).catch(() => null);
  const body = r ? await r.json().catch(() => null) : null;
  if (!r?.ok || !body?.ok) return { error: body?.message || NOT_SAVED };
  if (!body.result?.error) window.dispatchEvent(new Event('v2-exams-refresh'));
  return body.result;
});

function App() {
  const search = useSearchParams();
  const path = usePathname();
  const query = asQuery(search, path);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; route?: string; loaded?: ExamsLoaded | InputLoaded | ViewLoaded; error?: string }>({ key: '' });
  useEffect(() => onHostRefresh(() => setTick(n => n + 1)), []);
  useEffect(() => { const fn = () => setTick(n => n + 1); addEventListener('v2-exams-refresh', fn); return () => removeEventListener('v2-exams-refresh', fn); }, []);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams(query); const actor = hostActor(); if (actor) q.set('viewer', actor);
    fetch(`/api/v2/exams?${q}`, { headers: { Accept: 'application/json' } }).then(async r => {
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.message || '성적관리를 불러오지 못했습니다.');
      return body;
    }).then(body => {
      if (!live) return;
      if (Array.isArray(body.editors)) setHostEditors(body.editors);
      if (!actor || (body.loaded && !body.editors?.some((editor: { id: string }) => editor.id === actor))) {
        setState({ key: query, error: '이 계정은 이 화면을 볼 수 없습니다 · 계정 전환' });
        return;
      }
      setState(body.notFound ? { key: query, error: '성적관리를 열 수 없습니다.' }
        : body.route === 'external-unavailable' ? { key: query, error: body.message }
          : { key: query, route: body.route, loaded: body.loaded });
    }).catch(e => { if (live) setState({ key: query, error: e.message }); });
    return () => { live = false; };
  }, [query, tick]);
  if (!hostActor() || state.key !== query) return <HostMessage text="성적관리를 불러오는 중…" />;
  if (state.error || !state.loaded) return <HostMessage text={state.error || '성적관리를 불러오지 못했습니다.'} error />;
  const ops = state.loaded.settings.operations;
  return <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles}
    jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={state.loaded.settings.modules.disabled as never}>
    {state.route === 'input' ? <ExamsInputPage sp={Object.fromEntries(search.entries())} loaded={state.loaded as InputLoaded} />
      : state.route === 'view' ? <ExamsViewPage sp={Object.fromEntries(search.entries())} loaded={state.loaded as ViewLoaded} />
        : <ExamsDashboard searchParams={Object.fromEntries(search.entries())} loaded={state.loaded as ExamsLoaded} />}
  </OperationsProvider>;
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="exams"><App /></HostFrame></AppProviders>);
