// 2.0 부품 호스트 — 퇴원보고서 진입점(처리 화면 세션 R). 3.0 `#v2-withdrawal-reports`가 같은 출처 iframe(/v2-host/withdrawal-reports.html?…)으로 연다.
// 2.0 주소: /withdrawal-reports(목록 · page.tsx) · /withdrawal-reports/<id>(보고서 상세 · [id]/page.tsx) · /withdrawal-reports/archive/<id>(원본 상세).
// 데이터 = /api/v2/withdrawal-reports?…(Docker 복사본, v2-screen-withdrawal-reports.mjs) — 2.0 서버 컴포넌트가 부품에 넘기던 값.
// 여기서는 page.tsx의 그리기(필터 해석 · 목록 만들기 · 쪽 나누기 · 부품 조립)를 같은 2.0 함수·같은 순서로 옮겼다.
// 보는 사람 = 셸에서 선택한 현재 직원(저장하는 사람과 같다) — 처리 화면은 보는 사람에 따라 열리는 단추가 달라 조회에도 싣는다(?actor=).
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { kstToday } from '@/lib/date-kst';
import { buildSubjectMaps } from '@/features/owner/subjects';
import { LIST_PAGE_SIZE, buildListItems, filterListItems, listHref, listWindow, parseListFilters, teacherOptions } from '@/features/withdrawal-reports/list-items';
import type { ReportListRow, StaffOption, StudentOption, WithdrawalReport, ReportEvent, ReportBody } from '@/features/withdrawal-reports/model';
import type { ArchiveDetail, ArchiveRow, ArchiveStudent } from '@/features/withdrawal-reports/archive-model';
import type { ReportConsultation } from '@/features/withdrawal-reports/consultation';
import { ReportList } from '@/app/(shell)/withdrawal-reports/_components/report-list';
import { ListToolbar } from '@/app/(shell)/withdrawal-reports/_components/list-toolbar';
import { RequestDialog } from '@/app/(shell)/withdrawal-reports/_components/request-dialog';
import { ReportDetail } from '@/app/(shell)/withdrawal-reports/_components/report-detail';
import { ArchiveDetailView } from '@/app/(shell)/withdrawal-reports/_components/archive-detail';
import { onHostRefresh } from '../shims/host-nav';
import { hostActor, setHostEditors, type HostEditor } from '../shims/server-action';
import { usePathname, useSearchParams } from '../shims/next-navigation';
import { HostFrame, HostMessage } from './host-frame';

export const HOST_TITLE = '퇴원보고서';
export const HOST_ROUTE = '/withdrawal-reports';
const SCREEN = 'withdrawal-reports';

type Viewer = { id: string; user: { id: string; systemRole: string }; writable: boolean; scope: string[] | null; teacherId: string | null; manage: boolean; request: boolean; directorLevel: boolean };
type Base = { editors: HostEditor[]; viewer: Viewer; labels: Record<string, string>; operations: Record<string, unknown> & { subjects: Parameters<typeof buildSubjectMaps>[0] }; notFound?: boolean; notAllowed?: boolean };
type ListData = Base & { list: { rows: ReportListRow[]; available: boolean; completedLimited: boolean }; staff: StaffOption[]; students: StudentOption[]; archives: ArchiveRow[] | null; shell: 'admin' | 'teacher'; directReady: boolean };
type DetailData = Base & { staff: StaffOption[]; withdrawalHref: string | null;
  record: { report: WithdrawalReport; events: ReportEvent[]; assignmentChanged: boolean; consultations: ReportConsultation[]; prefill?: Partial<ReportBody>; prefillWarning?: string } };
type ArchiveData = Base & { archive: ArchiveDetail; students: ArchiveStudent[]; withdrawalHref: string | null };

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

/** 목록이 읽는 주소 열쇠(2.0 page.tsx searchParams). */
const KEYS = ['status', 'range', 'from', 'to', 'subject', 'teacher', 'kind', 'mine', 'q', 'page', 'request'] as const;
function useScreenData<T extends Base>(path: string, sp: Record<string, string>) {
  const actor = useActor();
  const query = new URLSearchParams({ ...sp, ...(path !== HOST_ROUTE ? { v2path: path } : {}), ...(actor ? { actor } : {}) }).toString();
  const [state, setState] = useState<{ query?: string; data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/${SCREEN}?${query}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '퇴원보고서를 불러오지 못했습니다.'); return body as T; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  return state.query === query ? state : {};
}

function Shell({ data, children }: { data: Base; children: React.ReactNode }) {
  const ops = data.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={[] as never}>{children}</OperationsProvider>;
}

/** page.tsx `WithdrawalReportsPage`의 그리기 — 서버가 하던 조회는 load가, 목록 만들기·필터·쪽은 같은 2.0 함수로 여기서. */
function ListPage({ data, sp }: { data: ListData; sp: Record<string, string | undefined> }) {
  const { viewer, list, staff, students, labels, archives, shell, directReady } = data;
  const requestFor = sp.request && /^[0-9a-f-]{36}$/i.test(sp.request) ? sp.request : null;
  const header = (
    <PageHeader
      title="퇴원보고서"
      description={
        shell !== "teacher"
          ? "관리자가 작성을 요청하고, 강사별로 보고서를 제출합니다. 원장을 선택하지 않으면 관리자가 최종 승인합니다."
          : "작성을 요청받은 퇴원보고서를 작성해 제출합니다."
      }
    />
  );
  if (!list.available) {
    return (
      <div className="min-w-0 space-y-5 p-4 md:p-6">
        {header}
        <p className="bg-muted/30 rounded-lg border p-6 text-sm">퇴원보고서 기능을 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>
      </div>
    );
  }

  const subjectMaps = buildSubjectMaps(data.operations.subjects);
  const canSeeArchive = !!viewer.teacherId || viewer.manage;
  const items = buildListItems({ reports: list.rows, archives: archives ?? [], staff, labelOf: subjectMaps.labelOf, userId: viewer.user.id, writable: viewer.writable });
  const filters = parseListFilters(sp, canSeeArchive);
  const rangeWindow = listWindow(filters, kstToday());
  const found = filterListItems(items, filters, rangeWindow);
  const totalPages = Math.max(1, Math.ceil(found.length / LIST_PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const shown = found.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);
  const mineCount = filterListItems(items, { ...filters, status: "all", mine: true }, rangeWindow).length;
  const filterActive =
    filters.status !== "all" || filters.range !== "all" || filters.subject !== "all" || filters.teacher !== "all" || filters.kind !== "all" || filters.mine || !!filters.q;
  const subjects = viewer.scope ? subjectMaps.options.filter((o) => viewer.scope!.includes(o.value)) : subjectMaps.options;

  return (
    <div className="min-w-0 space-y-5 p-4 md:p-6">
      {header}
      <ListToolbar
        filters={filters}
        custom={"custom" in rangeWindow ? rangeWindow.custom : undefined}
        subjects={subjects}
        teachers={teacherOptions(items, staff)}
        archiveStatus={viewer.manage}
        mine={mineCount > 0 || filters.mine ? { href: listHref(sp, filters.mine ? { mine: null } : { mine: "approve", status: null }), count: mineCount } : null}
        resultText={filterActive ? `${found.length}건 / 전체 ${items.length}건` : `전체 ${items.length}건`}
        resetHref={filterActive ? listHref(sp.embed ? { embed: sp.embed } : {}, {}) : null}
        request={viewer.request ? <RequestDialog key={requestFor ?? "none"} staff={staff} students={students} labels={labels} scope={viewer.scope} initialStudentId={requestFor} directReady={directReady} /> : null}
      />
      {archives === null && canSeeArchive ? (
        <p role="alert" className="text-danger text-sm">
          기존 스프레드시트 기록을 불러오지 못했습니다. 웹에서 작성한 보고서만 표시합니다.
        </p>
      ) : null}
      <ReportList items={shown} />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={found.length}
          hrefForPage={(p) => listHref(sp, { page: p > 1 ? String(p) : null })}
          scroll={false}
        />
      ) : null}
      {list.completedLimited && (
        <p className="text-muted-foreground text-xs">진행 중인 요청은 모두 표시하며, 완료·취소 건은 최근 200건까지 표시합니다.</p>
      )}
    </div>
  );
}

/** [id]/page.tsx — 보고서 상세. */
function DetailPage({ data }: { data: DetailData }) {
  const r = data.record;
  return <div className="min-w-0 space-y-5 p-4 md:p-6">
    <PageHeader title={`${r.report.snapshot.name} · 퇴원보고서`} description="요청 당시의 학생·수강 정보를 기준으로 검토합니다." />
    <ReportDetail key={`${r.report.id}:${r.report.revision}:${data.viewer.id}`} {...r} staff={data.staff} labels={data.labels} userId={data.viewer.user.id} writable={data.viewer.writable} directorLevel={data.viewer.directorLevel} withdrawalHref={data.withdrawalHref} />
  </div>;
}

/** archive/[id]/page.tsx — 기존 스프레드시트 원본. */
function ArchivePage({ data }: { data: ArchiveData }) {
  return <div className="min-w-0 space-y-5 p-4 md:p-6"><ArchiveDetailView key={`${data.archive.id}:${data.archive.revision}`} archive={data.archive} students={data.students} canManage={data.viewer.request} withdrawalHref={data.withdrawalHref} /></div>;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DETAIL = new RegExp(`^/withdrawal-reports/${UUID}$`, 'i'), ARCHIVE = new RegExp(`^/withdrawal-reports/archive/${UUID}$`, 'i');
function App() {
  const path = usePathname(), search = useSearchParams();
  const known = path === HOST_ROUTE || DETAIL.test(path) || ARCHIVE.test(path);
  const sp = useMemo(() => (path === HOST_ROUTE ? Object.fromEntries(KEYS.flatMap((k) => (search.get(k) ? [[k, search.get(k)!]] : []))) : {}) as Record<string, string>, [path, search]);
  const state = useScreenData<Base>(known ? path : HOST_ROUTE, sp);
  if (!known) return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  if (state.error) return <HostMessage text={state.error} error />;
  if (!state.data) return <HostMessage text="퇴원보고서를 불러오는 중…" />;
  const data = state.data;
  if (data.notAllowed) return <HostMessage text="현재 계정은 퇴원보고서를 볼 수 없습니다. 왼쪽 아래에서 계정을 전환해 주세요." error />;
  if (data.notFound) return <HostMessage text="이 보고서를 볼 수 없습니다. 보는 사람을 바꾸거나 목록에서 다시 골라 주세요." error />;
  return <Shell data={data}>
    {ARCHIVE.test(path) ? <ArchivePage data={data as ArchiveData} /> : DETAIL.test(path) ? <DetailPage data={data as DetailData} /> : <ListPage data={data as ListData} sp={sp} />}
  </Shell>;
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
