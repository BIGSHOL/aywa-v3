// 2.0 부품 호스트 — 영상 제출 현황 진입점(처리 화면 세션 R). 3.0 `#v2-video-homework`가 같은 출처 iframe(/v2-host/video-homework.html?…)으로 연다.
// 2.0 주소: /lesson-reports/video-homework(관리자 장부 · page.tsx) · /onescreen/video-homework(강사 '내가 낸' · page.tsx).
//  강사 화면은 HOST_ROUTE가 하나라 같은 진입점에서 `view=mine`으로 가른다(onescreen 진입점의 /onescreen 하위 주소와 겹치지 않게).
// 데이터 = /api/v2/video-homework?…(Docker 복사본, v2-screen-video-homework.mjs) — 2.0 서버가 읽던 장부 재료. 여기서는 page.tsx의 그리기
// (검사 대상 거르기 · 회차 · 강사 필터 · 첫 필터)를 같은 2.0 함수·같은 순서로 옮겼다.
// 2.0과 같게 하려고 진입점이 맡는 경계 셋:
//  · 기간 조회(툴바의 GET 폼) — 2.0은 문서를 그 주소로 다시 읽는다. 여기서는 호스트 이동으로(view=mine 유지).
//  · 저장 뒤 다시 읽기 — 2.0 부품의 useLedgerRefresh는 문서 주소(/v2-host/…)가 화면 주소와 달라 아무 일도 안 한다. 그래서 2.0이 다시 읽는
//    바로 그 자리(배정 · 반려 · 숙제 출제 · 취소 · 미확인 뒤 남은 칸)에서 저장 함수를 감싸 다시 읽는다.
//  · AI 참고 메모 읽기(/api/homework-videos/<id>/review) — 같은 화면의 읽기 경로로(저장된 결과만 · 다시 분석 없음).
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { PageHeader } from '@/components/page-header';
import { FaceTabs } from '@/components/face-tabs';
import { buildSubjectMaps } from '@/features/owner/subjects';
import { lessonReportFaces } from '@/features/report-admin/lesson-report-faces';
import { isVideoHomeworkEnabled } from '@/features/video-homework/policy';
import { keepLedgerRounds, ledgerPairKey, ownRoundKey } from '@/features/video-homework/ledger';
import { ledgerInitialFilters } from '@/features/video-homework/ledger-period';
import { buildLedgerRounds } from '@/features/video-homework/rounds';
import { VideoHomeworkManagement } from '@/features/video-homework/components/video-homework-management';
import type { BlankFacts } from '@/features/video-homework/no-homework';
import type { VideoArrival, VideoHomeworkMark, VideoHomeworkRosterRow } from '@/features/video-homework/types';
import type { VideoHomeworkPolicy } from '@/features/video-homework/policy';
import { hostNavigate, hostRefresh, onHostRefresh } from '../shims/host-nav';
import { hostActor, registerHostHandler, setHostEditors, VIEW_ONLY, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

export const HOST_TITLE = '영상 제출 현황';
export const HOST_ROUTE = '/lesson-reports/video-homework';
const SCREEN = 'video-homework';
const NOTE = 'border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs';

type BaseRow = VideoHomeworkRosterRow & { assignedDates: string[]; teacherName: string | null; hasAssignableVideos: boolean; needsVideoAssignment: boolean;
  extraDates: string[]; rejected?: Record<string, string>; kept?: string[]; dues?: Record<string, string>; aiReview?: true; lessonDates?: readonly string[] };
type Ledger = { rows: BaseRow[]; marks: VideoHomeworkMark[]; videos: VideoArrival[]; idleRoster: VideoHomeworkRosterRow[]; blankFacts: BlankFacts;
  assignedKnown: boolean; videosKnown: boolean; assignmentVideosKnown: boolean };
type Review = { fixable: number; duplicates: number; items: { id: string; fileName: string | null; reason: string | null; folderName: string | null }[] };
type Data = {
  editors: HostEditor[]; notAllowed?: boolean; redirectAdmin?: boolean; view: 'admin' | 'mine'; viewer: { id: string; name: string; role: string };
  today: string; fromDate: string; toDate: string; rangeTooLong: boolean; ledger: Ledger; lessonReportsLevel: string;
  operations: Record<string, unknown> & { subjects: Parameters<typeof buildSubjectMaps>[0] }; policy: VideoHomeworkPolicy;
  // 관리자
  issuers?: { issues: { classId: string; studentId: string; date: string; teacherIds: string[] }[]; names: [string, string][] } | null;
  classnoteOn?: boolean; manualReview?: Review | null; faces?: Parameters<typeof lessonReportFaces>[0];
  // 강사
  own?: { classId: string; studentId: string; date: string }[] | null; owned?: string[]; canTeacherWrite?: boolean;
};

// ── 저장 함수 — 2.0 부품이 부르는 그대로 쓰기 경로로 보내고, 2.0이 다시 읽는 자리에서 다시 읽는다 ─────────────────────────────
const NOT_SAVED = '저장하지 못했습니다 — 바뀐 것은 없습니다', UNREACHABLE = '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다';
type Result = { ok?: boolean; error?: string; kept?: boolean; rejected?: number; trashFailed?: number };
async function post(module: string, name: string, args: unknown[]): Promise<Result> {
  let res: Response;
  try {
    res = await fetch(`/api/v2/${SCREEN}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module, actor: hostActor(), args }) });
  } catch { return { ok: false, error: UNREACHABLE }; }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: Result; message?: string; error?: string } | null;
  if (res.status === 404 && body?.error === 'action_not_found') return { ok: false, error: VIEW_ONLY };
  if (!res.ok || !body?.ok || !body.result) return { ok: false, error: body?.message || NOT_SAVED };
  return body.result;
}
const VH = 'features/video-homework/server';
const save = (file: string, name: string, refreshWhen: (r: Result) => boolean) =>
  registerHostHandler(`${VH}/${file}`, name, async (...args: unknown[]) => {
    const result = await post(`${VH}/${file}`, name, args);
    if (refreshWhen(result)) hostRefresh();
    return result;
  });
save('actions.ts', 'setVideoHomeworkRound', (r) => !!r.ok && !!r.kept); // use-ledger-marks: 남은 칸이 생기면(onKept) 다시 읽는다
save('cancel-homework.ts', 'cancelVideoHomework', (r) => !!r.ok);
save('issue-actions.ts', 'issueExtraVideoHomework', (r) => !!r.ok);
save('video-assignment.ts', 'assignHomeworkVideo', (r) => !!r.ok);
registerHostHandler(`${VH}/reject-videos.ts`, 'rejectHomeworkVideos', async (...args: unknown[]) => {
  const result = await post(`${VH}/reject-videos.ts`, 'rejectHomeworkVideos', args);
  if (result.ok || result.rejected) hostRefresh();
  // 연습 자료은 드라이브 파일을 옮기지 않는다 — 반려는 끝났고, 파일은 그대로 남는다(2.0이 못 옮겼을 때와 같은 결과).
  if (result.ok && result.trashFailed) toast.info('연습 자료에서는 드라이브 파일을 옮기지 않습니다. 반려 기록만 남았습니다.');
  return result;
});
/** 화면의 읽기 경로(GET) — 보는 사람 · 화면(관리자/강사)을 함께 싣는다. */
async function read(fields: Record<string, string>) {
  const q = new URLSearchParams(fields);
  const actor = hostActor();
  if (actor) q.set('actor', actor);
  if (new URLSearchParams(location.search).get('view') === 'mine') q.set('view', 'mine');
  const r = await fetch(`/api/v2/${SCREEN}?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r?.ok ? ((await r.json().catch(() => null)) as { read?: unknown } | null) : null;
  return body?.read ?? null;
}
registerHostHandler(`${VH}/video-assignment.ts`, 'getVideoAssignmentOptions', async (input) => {
  const { classId, studentId, fromDate, toDate } = (input ?? {}) as Record<string, unknown>;
  const ok = [classId, studentId, fromDate, toDate].every((v) => typeof v === 'string' && v);
  const out = ok ? await read({ read: 'assign', class: String(classId), student: String(studentId), from: String(fromDate), to: String(toDate) }) : null;
  return out && typeof out === 'object' && 'ok' in out ? out : { ok: false, error: '영상 목록을 읽지 못했습니다.' };
});
// AI 참고 메모 — 2.0 AiReviewPanel이 fetch로 부르는 /api/homework-videos/<id>/review를 같은 화면의 읽기로 바꿔 답한다(다른 주소는 그대로).
const REVIEW = /^\/api\/homework-videos\/([0-9a-f-]{36})\/review$/i;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  const m = url.origin === location.origin ? REVIEW.exec(url.pathname) : null;
  if (!m) return nativeFetch(input, init);
  const out = (await read({ read: 'review', video: m[1] })) as { status?: number; view?: unknown } | null;
  const status = out?.status ?? 500;
  return new Response(JSON.stringify(status === 200 ? { view: out?.view ?? null } : { error: status === 404 ? '볼 수 없는 영상입니다' : 'AI 참고 메모를 불러오지 못했습니다' }),
    { status, headers: { 'Content-Type': 'application/json' } });
};

/** 툴바의 '기간 조회'(GET 폼) — 문서를 다시 읽지 않고 호스트 이동으로. 2.0 검증(onSubmit)이 막은 제출은 그대로 둔다. */
function useGetFormNavigation() {
  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || e.defaultPrevented || (form.getAttribute('method') ?? 'get').toLowerCase() !== 'get') return;
      const action = form.getAttribute('action') ?? '';
      if (!action.startsWith('/')) return;
      e.preventDefault();
      const q = new URLSearchParams();
      for (const [k, v] of new FormData(form).entries()) if (typeof v === 'string' && v && k !== 'embed') q.set(k, v);
      if (new URLSearchParams(location.search).get('view') === 'mine') q.set('view', 'mine');
      hostNavigate(`${action.split('?')[0]}${q.size ? `?${q}` : ''}`, 'push');
    };
    window.addEventListener('submit', onSubmit);
    return () => window.removeEventListener('submit', onSubmit);
  }, []);
}

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
/** 서버가 보는 주소 열쇠 — 기간 · 화면(관리자/강사) · 보는 사람. 필터(q · 상태 …)는 화면 안에서만 쓴다(2.0도 서버는 기간만 읽는다). */
const KEYS = ['view', 'from', 'to', 'date'] as const;
function useScreenData(sp: URLSearchParams) {
  const actor = useActor();
  const fields: Record<string, string> = Object.fromEntries(KEYS.flatMap((k) => (sp.get(k) ? [[k, sp.get(k)!]] : [])));
  const query = new URLSearchParams({ ...fields, ...(actor ? { actor } : {}) }).toString();
  const [state, setState] = useState<{ query?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/${SCREEN}?${query}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '영상 제출 현황을 불러오지 못했습니다.'); return body as Data; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  return state.query === query ? state : {};
}

function Shell({ data, children }: { data: Data; children: React.ReactNode }) {
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={[] as never}>{children}</OperationsProvider>;
}

/** 2.0 ManualDriveReviewList 그대로(그 파일은 서버 조회를 함께 묶고 있어 부품만 옮겼다). */
function ManualDriveReviewList({ review }: { review: Review | null | undefined }) {
  if (!review || !(review.fixable + review.duplicates)) return null;
  const shown = review.items.length;
  return <details className="border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs">
    <summary className="cursor-pointer">
      {review.fixable ? <>담임 폴더에 직접 올린 영상 <strong className="num">{review.fixable}</strong>개는 학생·반을 찾지 못해 세지 않았습니다 —
        파일 이름(학생_반_학교학년_날짜)을 고치면 10분 안에 다시 확인합니다.</> : null}
      {review.fixable && review.duplicates ? ' ' : null}
      {review.duplicates ? <>이미 보관된 같은 영상이라 따로 세지 않은 사본 <strong className="num">{review.duplicates}</strong>개(지워도 됩니다).</> : null}
    </summary>
    <ul className="divide-line mt-2 divide-y">
      {review.items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
          <span className="font-bold break-all">{item.fileName ?? '이름 없는 파일'}</span>
          <span>{item.reason ?? '확인이 필요합니다.'}</span>
          {item.folderName ? <span className="text-text-dim">{item.folderName}</span> : null}
        </li>
      ))}
    </ul>
    {review.fixable + review.duplicates > shown ? <p className="mt-1">최근 {shown}개만 보입니다.</p> : null}
  </details>;
}

function Notes({ data, candidates, shown, canEdit }: { data: Data; candidates: number; shown: number; canEdit: boolean }) {
  const { ledger } = data;
  return <>
    {!data.policy.enabled ? <p className={NOTE}>영상 제출 검사가 꺼져 있습니다. 지난 기록은 장부에서 읽기 전용으로 확인할 수 있습니다.</p>
      : candidates > shown ? <p className={NOTE}>현재 설정으로 {candidates - shown}명·반이 검사 대상에서 제외되었습니다. 기존 기록은 장부에 남습니다.</p> : null}
    {!ledger.assignedKnown ? <p role="status" className={NOTE}>수업보고서의 영상 과제 표시를 읽지 못해 이미 찍은 기록만 보여 줍니다. 잠시 뒤 다시 열어 주세요.</p> : null}
    {!ledger.videosKnown ? <p role="status" className={NOTE}>학부모 영상 도착 기록을 읽지 못해 이번 화면에서는 영상 자동 집계를 뺐습니다.</p> : null}
    {canEdit && !ledger.assignmentVideosKnown ? <p role="status" className={NOTE}>배정할 영상 목록을 확인하지 못했습니다. 잠시 뒤 새로고침해 주세요.</p> : null}
    {data.rangeTooLong ? <p role="status" className="text-text-dim text-xs">한 번에 최대 366일을 조회할 수 있어 종료일이 속한 달을 표시했습니다.</p> : null}
  </>;
}

/** lesson-reports/video-homework/page.tsx — 관리자 장부. */
function AdminPage({ data, param }: { data: Data; param: (name: string) => string }) {
  const view = useMemo(() => {
    const { ledger, fromDate, toDate, policy, issuers } = data;
    const canEdit = data.lessonReportsLevel === 'full';
    const subjectLabels = buildSubjectMaps(data.operations.subjects);
    const candidates = ledger.rows.map((row) => {
      const tracked = isVideoHomeworkEnabled(policy, { classId: row.classId, subjectKey: row.subject, grade: row.grade });
      return { ...row, subject: subjectLabels.labelOf(row.subject), tracked, editable: tracked && canEdit, canAssignVideos: canEdit };
    }).filter((row) => row.tracked || !row.lessonDates);
    const rounds = buildLedgerRounds({ rows: candidates, marks: ledger.marks, videos: [], fromDate, toDate });
    const displayRows = candidates.filter((row) => row.tracked || rounds.get(ledgerPairKey(row))?.length);
    const activeClasses = new Set(displayRows.filter((row) => rounds.get(ledgerPairKey(row))?.length).map((row) => row.classId));
    const ledgerRows = displayRows.filter((row) => activeClasses.has(row.classId) || !!row.lessonDates);
    const idleRoster = ledger.idleRoster.filter((entry) => isVideoHomeworkEnabled(policy, { classId: entry.classId, subjectKey: entry.subject, grade: entry.grade }))
      .map((entry) => ({ ...entry, subject: subjectLabels.labelOf(entry.subject) }));
    const names = new Map(issuers?.names ?? []);
    const shownPairs = new Set(ledgerRows.map((row) => ledgerPairKey(row)));
    const teacherRounds: Record<string, string[]> = {};
    for (const issue of issuers?.issues ?? []) {
      if (!shownPairs.has(ledgerPairKey(issue))) continue;
      for (const id of issue.teacherIds) if (names.has(id)) (teacherRounds[id] ??= []).push(ownRoundKey(issue, issue.date));
    }
    const teacherOptions = Object.keys(teacherRounds).map((id) => ({ value: id, label: names.get(id)! })).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    const initialFilters = ledgerInitialFilters(param, activeClasses, new Set(teacherOptions.map((option) => option.value)));
    return { canEdit, candidates, displayRows, ledgerRows, idleRoster, teacherRounds, teacherOptions, initialFilters };
  }, [data, param]);
  const { ledger, fromDate, toDate, today } = data;
  return <div className="w-full min-w-0 space-y-4">
    <PageHeader eyebrow="수업보고서 · 학습 관리" title="영상숙제 확인" description="숙제가 나간 수업을 학생별 회차로 세어 제출 여부를 확인합니다." />
    {data.faces ? <FaceTabs faces={lessonReportFaces(data.faces)} active="video_homework" ariaLabel="수업보고서 면" /> : null}
    {data.classnoteOn ? <ManualDriveReviewList review={data.manualReview} /> : null}
    <Notes data={data} candidates={view.candidates.length} shown={view.displayRows.length} canEdit={view.canEdit} />
    <VideoHomeworkManagement key={`${fromDate}:${toDate}`} rows={view.ledgerRows} initialMarks={ledger.marks} videos={ledger.videos} blankFacts={ledger.blankFacts} videosKnown={ledger.videosKnown}
      fromDate={fromDate} toDate={toDate} today={today} initialFilters={view.initialFilters} showTeacher
      teacherRounds={view.teacherRounds} teacherOptions={view.teacherOptions} idleRoster={view.idleRoster} />
  </div>;
}

/** onescreen/video-homework/page.tsx — 강사 '내가 낸'. */
function TeacherPage({ data, param }: { data: Data; param: (name: string) => string }) {
  const view = useMemo(() => {
    const { ledger, fromDate, toDate, policy } = data;
    const own = data.own ?? [], owned = new Set(data.owned ?? []);
    const ownPairs = new Set(own.map((row) => ledgerPairKey(row)));
    const keepRounds = own.map((row) => ownRoundKey(row, row.date));
    const canEdit = !!data.canTeacherWrite || data.lessonReportsLevel === 'full';
    const subjectLabels = buildSubjectMaps(data.operations.subjects);
    const candidates = ledger.rows.filter((row) => ownPairs.has(ledgerPairKey(row))
      || (owned.has(row.classId) && (!!row.lessonDates || !!row.hasAssignableVideos))).map((row) => {
      const tracked = isVideoHomeworkEnabled(policy, { classId: row.classId, subjectKey: row.subject, grade: row.grade });
      return { ...row, subject: subjectLabels.labelOf(row.subject), tracked, editable: tracked && canEdit,
        canAssignVideos: canEdit && (data.lessonReportsLevel === 'full' || owned.has(row.classId)) };
    }).filter((row) => row.tracked || ownPairs.has(ledgerPairKey(row)));
    const pairKeys = new Set(candidates.map((row) => ledgerPairKey(row)));
    const marks = ledger.marks.filter((mark) => pairKeys.has(ledgerPairKey(mark)));
    const videos = ledger.videos.filter((video) => !!video.classId && pairKeys.has(ledgerPairKey({ classId: video.classId, studentId: video.studentId })));
    const idleRoster = ledger.idleRoster.filter((entry) => owned.has(entry.classId)
      && isVideoHomeworkEnabled(policy, { classId: entry.classId, subjectKey: entry.subject, grade: entry.grade }))
      .map((entry) => ({ ...entry, subject: subjectLabels.labelOf(entry.subject) }));
    const draft = keepLedgerRounds(buildLedgerRounds({ rows: candidates, marks, videos: [], fromDate, toDate }), new Set(keepRounds));
    const rows = candidates.filter((row) => row.tracked || draft.get(ledgerPairKey(row))?.length);
    const shown = new Set(rows.map((row) => ledgerPairKey(row)));
    const blankFacts = Object.fromEntries(Object.entries(ledger.blankFacts).filter(([pair]) => shown.has(pair)));
    const initialFilters = ledgerInitialFilters(param, new Set(rows.map((row) => row.classId)));
    return { canEdit, candidates, rows, marks: marks.filter((mark) => shown.has(ledgerPairKey(mark))),
      videos: videos.filter((video) => shown.has(ledgerPairKey({ classId: video.classId!, studentId: video.studentId }))), blankFacts, idleRoster, keepRounds, initialFilters };
  }, [data, param]);
  const { ledger, fromDate, toDate, today } = data;
  return <div className="w-full min-w-0 space-y-4">
    <PageHeader eyebrow="강사뷰" title="영상 제출 현황" description="내가 '영상 과제 있음'으로 낸 수업 · 따로 낸 숙제 · 내가 보고서를 쓴 날 손으로 확인한 숙제를 학생별 회차로 셉니다." />
    {data.own === null ? <p role="status" className={NOTE}>내가 낸 영상 숙제를 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</p> : null}
    <Notes data={data} candidates={view.candidates.length} shown={view.rows.length} canEdit={view.canEdit} />
    <VideoHomeworkManagement key={`${fromDate}:${toDate}`} rows={view.rows} initialMarks={view.marks} videos={view.videos} blankFacts={view.blankFacts}
      videosKnown={ledger.videosKnown} fromDate={fromDate} toDate={toDate} today={today} initialFilters={view.initialFilters} keepRounds={view.keepRounds}
      idleRoster={view.idleRoster} />
  </div>;
}

function App() {
  const path = usePathname(), search = useSearchParams();
  useGetFormNavigation();
  const state = useScreenData(search);
  // 첫 필터는 연 순간의 주소로(2.0 page.tsx의 searchParams) — 그 뒤 필터는 화면이 주소에 적고(replaceState) 다시 읽지 않는다.
  const param = useMemo(() => { const q = new URLSearchParams(location.search); return (name: string) => q.get(name) ?? ''; }, [state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = state.data;
  useEffect(() => {
    // 강사 주소에 관리자 계열이 오면 2.0처럼 같은 기간·필터의 관리자 장부로(알림 링크가 강사 주소다).
    if (!data?.redirectAdmin) return;
    const q = new URLSearchParams(location.search); q.delete('view');
    hostNavigate(`${HOST_ROUTE}${q.size ? `?${q}` : ''}`, 'replace');
  }, [data?.redirectAdmin]);
  if (path !== HOST_ROUTE) return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  if (state.error) return <HostMessage text={state.error} error />;
  if (!data || data.redirectAdmin) return <HostMessage text="영상 제출 현황을 불러오는 중…" />;
  if (data.notAllowed) return <HostMessage text="현재 계정은 영상 제출 현황을 볼 수 없습니다. 왼쪽 아래에서 계정을 전환해 주세요." error />;
  return <Shell data={data}>{data.view === 'mine' ? <TeacherPage data={data} param={param} /> : <AdminPage data={data} param={param} />}</Shell>;
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
