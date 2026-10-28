// 2.0 부품 호스트 — 원생목록 진입점. 3.0 `#v2-students`가 같은 출처 iframe(/v2-host/students.html?…)으로 연다.
// 2.0이 창(embed)으로 열 때의 틀(AppProviders · OperationsProvider) 그대로 감싸고, 데이터는 /api/v2/students?…(Docker 복사본, v2-screen-students.mjs)에서
// 2.0 page.tsx가 서버에서 만들던 값으로 받는다.
// 2.0 주소: /students(목록, students-list.tsx) · /students/<id>(원생 상세, students-detail.tsx — 탭은 students-tab-<탭>.tsx) ·
// /students/<id>/edit(학생 수정) · /students/new(새 학생) — 둘은 students-form.tsx.
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppProviders } from "@/lib/providers/app-providers";
import { OperationsProvider } from "@/features/owner/operations-context";
import { StudentsListPage, type StudentListData } from "./students-list";
import { StudentDetailPage, type StudentDetailData } from "./students-detail";
import { EditStudentPage, NewStudentPage, type StudentEditData, type StudentNewData } from "./students-form";
import { StudentTabDataProvider, setCopyDay } from "./students-shared";
import { onHostRefresh } from "../shims/host-nav";
import { registerHostHandler, setHostEditors } from "../shims/server-action";

/** 배정 창의 '반 이동' 후보 — 2.0 listMovableEnrollments는 읽기라 같은 화면의 GET(movable)으로 묻는다(수업목록과 같다). 답은 2.0 반환 모양. */
const MOVABLE_FAILED = "수강 목록을 불러오지 못했습니다";
registerHostHandler("features/enrollments/server/movable-actions.ts", "listMovableEnrollments", async (studentId) => {
  if (typeof studentId !== "string" || !/^[0-9a-f-]{36}$/i.test(studentId)) return { ok: false, error: "학생을 확인할 수 없습니다" };
  const r = await fetch(`/api/v2/students?${new URLSearchParams({ movable: studentId })}`, { headers: { Accept: "application/json" } }).catch(() => null);
  const body = r ? ((await r.json().catch(() => null)) as { ok?: unknown } | null) : null;
  return r?.ok && body && typeof body.ok === "boolean" ? body : { ok: false, error: MOVABLE_FAILED };
});
const contributionRead = async (studentId: unknown, kind: "video" | "parent" | "learning" | "communication", extra: Record<string, string> = {}) => {
  if (typeof studentId !== "string" || !/^[0-9a-f-]{36}$/i.test(studentId)) return { error: "학생을 확인할 수 없습니다." };
  const query = new URLSearchParams({ v2path: `/students/${studentId}`, contributionRead: kind, ...extra });
  const response = await fetch(`/api/v2/students?${query}`, { headers: { Accept: "application/json" } }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  return response?.ok && body?.result ? body.result : { error: "기여도 근거를 불러오지 못했습니다. 다시 시도해 주세요." };
};
registerHostHandler("features/student-contribution/server/video-check-action.ts", "readContributionVideoCheck", (input) => {
  const value = input as { studentId?: unknown; month?: unknown } | null;
  return contributionRead(value?.studentId, "video", { month: String(value?.month ?? "") });
});
registerHostHandler("features/student-contribution/server/parent-event-evidence.ts", "getParentEventEvidence", (sourceId, studentId) =>
  contributionRead(studentId, "parent", { sourceId: String(sourceId ?? "") }));
registerHostHandler("features/student-contribution/server/learning-actions.ts", "getStudentLearningConnections", (studentId) =>
  contributionRead(studentId, "learning"));
registerHostHandler("features/student-contribution/server/communication-actions.ts", "getStudentCommunicationConnections", (studentId) =>
  contributionRead(studentId, "communication"));
import { usePathname, useSearchParams } from "../shims/next-navigation";
import { HostFrame, HostMessage } from "./host-frame";

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = "원생목록";
export const HOST_ROUTE = "/students";

/** 목록 page.tsx searchParams(v2-screen-students.mjs LIST_KEYS와 같다 — 시험이 대조). 나머지 쿼리는 서버로 보내지 않는다. */
const KEYS = ["status", "subject", "q", "page", "grade", "teacher", "field", "sort", "noenr", "program", "first", "level", "mix", "from"] as const;
/** 상세 page.tsx searchParams(DETAIL_KEYS — embed는 창 표식이라 빼고). */
const DETAIL_KEYS = ["contribution", "month", "view", "entity", "status", "grade", "q", "tab", "video", "back", "jjFrom", "jjTo", "page", "from", "to",
  "subject", "kind", "sort", "dir", "fScore", "fDelta"] as const;

type Loaded<T> = { key?: string; data?: T; missing?: boolean; notFound?: boolean; error?: string };
type WithSettings = { settings: { operations: unknown; modules: { disabled: unknown } } };

/** 같은 화면의 GET 하나 — 주소(키)가 바뀌거나 저장 뒤 새로고침(onHostRefresh)이면 다시 받는다. 다른 키의 자료는 그리지 않는다. */
function useScreenData<T>(query: string, failed: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/students${query ? `?${query}` : ""}`, { headers: { Accept: "application/json" } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || failed); return body; })
      .then((body) => {
        if (!live) return;
        // 저장하는 사람(학생 관리 '전체') — 3.0 띠가 이 목록에서 고른다(수업목록과 같은 신호).
        if (Array.isArray(body?.editors)) setHostEditors(body.editors);
        setState(body?.notFound ? { key: query, notFound: true } : body?.missing ? { key: query, missing: true } : { key: query, data: body as T });
      })
      .catch((e: Error) => live && setState({ key: query, error: e.message }));
    return () => { live = false; };
  }, [query, tick, failed]);
  return state.key === query ? state : {};
}

/** 학원 설정 공급자(2.0 셸 레이아웃이 감싸던 OperationsProvider) — 창 안 부품이 과목·학년 이름을 여기서 읽는다. */
function Ops({ data, children }: { data: WithSettings; children: ReactNode }) {
  const ops = data.settings.operations as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.settings.modules.disabled as never}>
      {children}
    </OperationsProvider>
  );
}

/** 상태 → 안내 한 줄(받는 중 · 실패 · 없음 · 아직 없는 화면). 자료가 있으면 null. */
function pending<T>(s: Loaded<T>, what: { loading: string; missing: string }): ReactNode | null {
  if (s.data) return null;
  if (s.error) return <HostMessage text={s.error} error />;
  if (s.notFound) return <HostMessage text="찾을 수 없는 학생입니다. 원생목록으로 돌아가 다시 골라 주세요." error />;
  if (s.missing) return <HostMessage text={what.missing} />;
  return <HostMessage text={what.loading} />;
}
const LIST_TEXT = { loading: "원생목록을 불러오는 중…", missing: "원생목록은 연습 화면에서 아직 열 수 없습니다." };
const STUDENT_TEXT = { loading: "학생 정보를 불러오는 중…", missing: "이 화면은 연습 화면에서 아직 열 수 없습니다." };

function pickQuery(search: URLSearchParams, keys: readonly string[], extra: Record<string, string> = {}) {
  const sp = Object.fromEntries(keys.flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? ""]] : []))) as Record<string, string>;
  return { sp, query: new URLSearchParams({ ...extra, ...sp }).toString() };
}

function List() {
  const search = useSearchParams();
  const { sp, query } = useMemo(() => pickQuery(search, KEYS), [search]);
  const s = useScreenData<StudentListData & WithSettings>(query, "원생목록을 불러오지 못했습니다.");
  return pending(s, LIST_TEXT) ?? <Ops data={s.data!}><StudentsListPage data={s.data!} sp={sp} /></Ops>;
}

function Detail({ path, id }: { path: string; id: string }) {
  const search = useSearchParams();
  const { sp, query } = useMemo(() => pickQuery(search, DETAIL_KEYS, { v2path: path }), [search, path]);
  const s = useScreenData<StudentDetailData>(query, "학생 정보를 불러오지 못했습니다.");
  const wait = pending(s, STUDENT_TEXT);
  if (wait) return wait;
  const data = s.data!;
  setCopyDay(data.today);
  return (
    <Ops data={data}>
      <StudentTabDataProvider value={data.tab.data}>
        <StudentDetailPage data={data} params={{ id }} searchParams={sp} />
      </StudentTabDataProvider>
    </Ops>
  );
}

function Form<T extends WithSettings>({ path, render }: { path: string; render: (data: T) => ReactNode }) {
  const query = new URLSearchParams({ v2path: path }).toString();
  const s = useScreenData<T>(query, "학생 정보를 불러오지 못했습니다.");
  return pending(s, STUDENT_TEXT) ?? <Ops data={s.data!}>{render(s.data!)}</Ops>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DETAIL_PATH = new RegExp(`^/students/(${UUID})$`), EDIT_PATH = new RegExp(`^/students/(${UUID})/edit$`);
function App() {
  const path = usePathname();
  const detail = DETAIL_PATH.exec(path), edit = EDIT_PATH.exec(path);
  if (path === HOST_ROUTE) return <List />;
  if (detail) return <Detail key={path} path={path} id={detail[1]} />;
  if (edit) return <Form<StudentEditData> key={path} path={path} render={(d) => <EditStudentPage data={d} params={{ id: edit[1] }} />} />;
  if (path === "/students/new") return <Form<StudentNewData> key={path} path={path} render={(d) => <NewStudentPage data={d} />} />;
  return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
}

createRoot(document.getElementById("root")!).render(<AppProviders><HostFrame screen="students"><App /></HostFrame></AppProviders>);
