// 2.0 부품 호스트 — 직원관리 진입점(처리 화면 세션 R · 작업자 A). 3.0 `#v2-staff`가 같은 출처 iframe(/v2-host/staff.html?…)으로 연다.
// 2.0 주소: /staff(목록 · staff-list.tsx) · /staff/<id>(상세 · staff-detail.tsx) · /staff/<id>/edit(근무 설정) · /staff/new(직원 등록, staff-form.tsx)
//  · 하위 화면(연차 관리 · 급여명세서 · 이력서)은 작업자 B의 staff-sub.tsx(isStaffSubPath · StaffSubPage)가 그린다 — 자료는 같은 GET.
// 데이터 = /api/v2/staff?…(Docker 복사본, v2-screen-staff.mjs) — 2.0 서버 page.tsx가 부품에 넘기던 값. 보는 사람 = 3.0 띠에서 고른 직원(?actor=).
// 저장 = 2.0 서버 함수 이름 그대로 POST /api/v2/staff/<함수>. 2.0이 저장 뒤 revalidatePath로 다시 그리던 자리는 여기서 자료를 다시 읽는다.
// 바깥 호출(노션 · 계약서 파일 저장소 · 계약서 AI 읽기)은 보내지 않고 이 자리에서 2.0 실패 모양으로 거절한다.
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppProviders } from "@/lib/providers/app-providers";
import { OperationsProvider } from "@/features/owner/operations-context";
import { hostNavigate, hostRefresh, onHostRefresh } from "../shims/host-nav";
import { hostActor, registerHostHandler, setHostEditors, type HostEditor } from "../shims/server-action";
import { usePathname, useSearchParams } from "../shims/next-navigation";
import { HostFrame, HostMessage } from "./host-frame";
import { StaffPage } from "./staff-list";
import { StaffDetailPage } from "./staff-detail";
import { EditStaffPage, NewStaffPage } from "./staff-form";
import { isStaffSubPath, StaffSubPage, STAFF_SUB_QUERY_KEYS } from "./staff-sub";
import type { StaffDetailData, StaffEditData, StaffListData, StaffNewData } from "./staff-host-parts";

export const HOST_TITLE = "직원관리";
export const HOST_ROUTE = "/staff";
const SCREEN = "staff";

/** 목록이 읽는 조회 조건(2.0 page.tsx searchParams) · 상세(tab · page · period) — 서버 LIST_KEYS · DETAIL_KEYS와 같다. */
const KEYS = ["invited", "tab", "role", "status", "subject", "emp", "q", "sort", "size", "page"] as const;
const DETAIL_KEYS = ["tab", "page", "period"] as const;

// ── 바깥 호출 거절(2.0 실패 모양) ─────────────────────────────────────────────────────────────────────────────────────
const NOTION = "features/staff/notion/server/notion-actions.ts";
const NOTION_REFUSED = "연습 화면에서는 노션 업무를 불러오거나 바꾸지 않습니다 — 노션에서 확인해 주세요";
// 연결 준비(prepareNotionMapping)는 탭을 열면 저절로 불린다 — 노션을 훑지 않으니 2.0의 '자동 연결 불가 · 후보 없음' 모양으로 조용히 둔다.
registerHostHandler(NOTION, "prepareNotionMapping", async () => ({ ok: true, prep: { state: "none" } }));
for (const name of ["getStaffMonthlyTasks", "getTaskComments", "toggleTaskDone", "moveTaskDue", "createStaffTask", "getTaskContent", "addTaskCommentAction", "setStaffNotionUserId"]) {
  registerHostHandler(NOTION, name, async () => ({ ok: false, error: NOTION_REFUSED }));
}
const EXTRACT = "features/staff/contract/server/contract-extract-actions.ts", FILES = "features/staff/contract/server/contract-file-actions.ts";
const CONTRACT_AI_REFUSED = "연습 화면에서는 계약서를 새로 읽지 않습니다 — 저장된 결과만 볼 수 있습니다";
const CONTRACT_FILE_REFUSED = "연습 화면에서는 계약서 파일을 올리거나 내려받거나 지우지 않습니다";
registerHostHandler(EXTRACT, "issueContractPdfTicket", async () => ({ error: CONTRACT_AI_REFUSED }));
registerHostHandler(EXTRACT, "extractContractFromPdf", async () => ({ error: CONTRACT_AI_REFUSED }));
for (const name of ["registerStaffContractFile", "deleteStaffContractFile", "signStaffContractFileUrl"]) {
  registerHostHandler(FILES, name, async () => ({ error: CONTRACT_FILE_REFUSED }));
}

// ── 저장 — 같은 POST, 성공하면 2.0 revalidatePath 자리처럼 자료를 다시 읽는다 ───────────────────────────────────────────────
const NOT_SAVED = "저장하지 못했습니다 — 바뀐 것은 없습니다", UNREACHABLE = "연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다";
const encodeArg = (v: unknown) =>
  v instanceof FormData ? { $formData: [...v.entries()].filter(([, x]) => typeof x === "string") } : v === undefined ? null : v;
async function post(module: string, name: string, args: unknown[]): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const res = await fetch(`/api/v2/${SCREEN}/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ module, actor: hostActor(), args: args.map(encodeArg) }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!res.ok || !body?.ok) return { ok: false, error: body?.message || NOT_SAVED };
    return { ok: true, result: body.result };
  } catch { return { ok: false, error: UNREACHABLE }; }
}
/** [모듈, 함수, 성공 뒤 다시 읽기] — 2.0이 revalidatePath를 부르는 함수만 true(보기 설정 저장은 다음 방문용이라 false). */
const SAVES: [string, string, boolean][] = [
  ["features/staff/server/actions.ts", "createStaff", false], ["features/staff/server/actions.ts", "updateStaff", false],
  ["features/staff/server/actions.ts", "changeStaffRole", true], ["features/staff/server/actions.ts", "deactivateStaff", true],
  ["features/staff/server/actions.ts", "handoverAndDeactivate", true],
  ["features/staff/server/account-actions.ts", "resetStaffPassword", false], ["features/staff/server/account-actions.ts", "changeStaffEmail", true],
  ["features/staff/server/account-actions.ts", "updateWorkSchedule", true],
  ["features/staff/contract/server/contract-actions.ts", "extendStaffContract", true], ["features/staff/contract/server/contract-actions.ts", "updateStaffContract", true],
  ["features/staff/contract/server/contract-actions.ts", "deleteStaffContract", true],
  ["features/staff/intake/server/intake-token-actions.ts", "ensureStaffIntakeToken", false], ["features/staff/intake/server/intake-token-actions.ts", "updateStaffIntakeToken", false],
  ["features/staff/list/server/list-prefs.ts", "saveStaffListPrefs", false],
];
for (const [module, name, refresh] of SAVES) {
  registerHostHandler(module, name, async (...args: unknown[]) => {
    const r = await post(module, name, args);
    // 연습 서버가 받지 않았을 때 — 그 함수가 실패 때 내던 모양(보기 설정은 { ok:false }, 나머지는 { error }).
    if (!r.ok) return name === "saveStaffListPrefs" ? { ok: false, error: r.error } : { error: r.error };
    const result = r.result as { error?: string; fieldErrors?: unknown } | null;
    if (refresh && result && !result.error && !result.fieldErrors) hostRefresh();
    return result;
  });
}
// 직원 삭제 — 2.0은 성공하면 redirect("/staff")(문서 이동). 서버가 { redirectTo }를 주면 목록으로 옮기고 버튼의 다음 줄까지는 가지 않는다.
registerHostHandler("features/staff/server/account-actions.ts", "deleteStaff", async (...args: unknown[]) => {
  const r = await post("features/staff/server/account-actions.ts", "deleteStaff", args);
  if (!r.ok) return { error: r.error };
  const result = r.result as { error?: string; redirectTo?: string } | null;
  if (!result?.redirectTo) return result;
  hostNavigate(result.redirectTo, "replace");
  return new Promise(() => {});
});

// ── 보는 사람 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const ACTOR_KEY = `v2-host-actor:${SCREEN}`;
/** 3.0 띠가 고른 값(같은 출처 저장소 + v2-host-actor 알림). 바뀌면 다시 읽는다. */
function useActor() {
  const [actor, setActor] = useState<string | null>(() => { try { return localStorage.getItem(ACTOR_KEY); } catch { return null; } });
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; id?: unknown } | null;
      if (d?.type === "v2-host-actor" && typeof d.id === "string") setActor(d.id);
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);
  return actor;
}

type Common = { editors?: HostEditor[]; operations?: Record<string, unknown>; modules?: { disabled: unknown }; notAllowed?: boolean; notFound?: boolean; redirect?: string; unknown?: boolean };

function Redirect({ to }: { to: string }) {
  useEffect(() => { hostNavigate(to, "replace"); }, [to]);
  return <HostMessage text="직원관리로 이동하는 중…" />;
}

/** 한 주소의 자료 받기 — 주소(v2path) · 조회 조건 · 보는 사람이 바뀌면 다시 읽는다. 다른 조건의 자료로 새 주소를 그리지 않는다. */
function Screen({ path, keys, render }: { path: string; keys: readonly string[]; render: (data: Common) => ReactNode }) {
  const search = useSearchParams(), actor = useActor();
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (path !== HOST_ROUTE) q.set("v2path", path);
    for (const k of keys) { const v = search.get(k); if (v !== null && v !== "") q.set(k, v); }
    if (actor) q.set("actor", actor);
    return q.toString();
  }, [path, keys, search, actor]);
  const [state, setState] = useState<{ query?: string; data?: Common; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/${SCREEN}${query ? `?${query}` : ""}`, { headers: { Accept: "application/json" } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || "직원관리를 불러오지 못했습니다."); return body as Common; })
      .then((data) => live && setState({ query, data }))
      .catch((e: Error) => live && setState({ query, error: e.message }));
    return () => { live = false; };
  }, [query, tick]);
  useEffect(() => { if (state.data?.editors) setHostEditors(state.data.editors); }, [state.data?.editors]);
  if (state.query !== query || (!state.data && !state.error)) {
    // 저장 뒤 다시 읽는 동안은 보던 화면을 그대로 둔다(같은 조건) — 2.0 revalidate처럼 화면이 깜빡이지 않게.
    if (state.data && state.query === query) return <>{render(state.data)}</>;
    return <HostMessage text="직원관리를 불러오는 중…" />;
  }
  if (!state.data) return <HostMessage text={state.error!} error />;
  const data = state.data;
  if (data.redirect) return <Redirect to={data.redirect} />;
  if (data.notAllowed) return <HostMessage text="고른 사람은 직원관리 메뉴가 없습니다. 위에서 다른 사람을 골라 주세요." error />;
  if (data.notFound) return <HostMessage text="찾을 수 없는 직원입니다. 목록으로 돌아가 다시 골라 주세요." error />;
  if (data.unknown) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  return <>{render(data)}</>;
}

function Ops({ data, children }: { data: Common; children: ReactNode }) {
  const ops = (data.operations ?? {}) as unknown as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={(data.modules?.disabled ?? []) as never}>
      {children}
    </OperationsProvider>
  );
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DETAIL = new RegExp(`^/staff/(${UUID})$`, "i"), EDIT = new RegExp(`^/staff/(${UUID})/edit$`, "i");
const sp = (search: URLSearchParams, keys: readonly string[]) => Object.fromEntries(keys.flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? ""]] : [])));

function App() {
  const path = usePathname(), search = useSearchParams();
  if (isStaffSubPath(path)) return <Screen key={path} path={path} keys={STAFF_SUB_QUERY_KEYS} render={(d) => <StaffSubPage path={path} data={d} />} />;
  if (path === HOST_ROUTE) return <Screen path={path} keys={KEYS} render={(d) => <Ops data={d}><StaffPage data={d as unknown as StaffListData} searchParams={sp(search, KEYS)} /></Ops>} />;
  if (path === "/staff/new") return <Screen key={path} path={path} keys={[]} render={(d) => <Ops data={d}><NewStaffPage data={d as unknown as StaffNewData} /></Ops>} />;
  const edit = EDIT.exec(path);
  if (edit) return <Screen key={path} path={path} keys={[]} render={(d) => <Ops data={d}><EditStaffPage data={d as unknown as StaffEditData} params={{ id: edit[1] }} /></Ops>} />;
  const detail = DETAIL.exec(path);
  if (detail) return <Screen key={path} path={path} keys={DETAIL_KEYS} render={(d) => <Ops data={d}><StaffDetailPage data={d as unknown as StaffDetailData} params={{ id: detail[1] }} searchParams={sp(search, DETAIL_KEYS)} /></Ops>} />;
  return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
}

createRoot(document.getElementById("root")!).render(<AppProviders><HostFrame screen={SCREEN}><App /></HostFrame></AppProviders>);
