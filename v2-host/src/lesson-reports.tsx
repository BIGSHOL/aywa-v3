// 2.0 부품 호스트 — 수업보고서 관리 진입점. 3.0 `#v2-lesson-reports`가 같은 출처 iframe(/v2-host/lesson-reports.html?…)으로 연다.
// 데이터는 /api/v2/lesson-reports?…(Docker 복사본, v2-screen-lesson-reports.mjs)에서 2.0 page.tsx가 서버에서 만들던 값으로 받는다.
// 2.0 주소: /lesson-reports(면은 ?tab= · ?tab=classnote&section=) · /lesson-reports/stats(통계 — 아직) ·
// /lesson-reports/video-homework(영상 제출 현황 — 다른 3.0 화면이라 부모에 창 열기를 알린다). 통계 = lesson-reports-stats.tsx.
import { createRoot } from "react-dom/client";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppProviders } from "@/lib/providers/app-providers";
import { OperationsProvider } from "@/features/owner/operations-context";
import { LessonReportsPage, type LessonReportsData } from "./lesson-reports-page";
import { setCopyDay } from "./students-shared";
import { onHostRefresh } from "../shims/host-nav";
import { registerHostHandler, setHostEditors, VIEW_ONLY } from "../shims/server-action";
import { usePathname, useSearchParams } from "../shims/next-navigation";
import { HostFrame, HostMessage } from "./host-frame";
import { LessonReportsStats } from "./lesson-reports-stats";

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = "수업보고서";
export const HOST_ROUTE = "/lesson-reports";

/** page.tsx searchParams(v2-screen-lesson-reports.mjs KEYS와 같다 — 시험이 대조). */
const KEYS = ["tab", "section", "status", "rmonth", "page"] as const;

/** 면 안 부품이 다시 읽는 2.0 서버 함수(읽기) — 같은 화면의 GET 열쇠로 묻는다(v2-screen-lesson-reports.mjs params). 답은 2.0 반환 모양. */
async function ask(query: Record<string, string>): Promise<Record<string, unknown> | null> {
  const r = await fetch(`/api/v2/lesson-reports?${new URLSearchParams(query)}`, { headers: { Accept: "application/json" } }).catch(() => null);
  const body = r ? ((await r.json().catch(() => null)) as Record<string, unknown> | null) : null;
  return r?.ok && body && typeof body === "object" ? body : null;
}
const okShape = (body: Record<string, unknown> | null, error: string) => (body && typeof body.ok === "boolean" ? body : { ok: false, error });
registerHostHandler("features/report-admin/server/actions.ts", "listReports", async (filters) =>
  okShape(await ask({ list: JSON.stringify(filters ?? {}) }), "보고서 목록을 불러오지 못했습니다"));
registerHostHandler("features/report-admin/server/actions.ts", "refreshClassnoteQueue", async (days) => {
  const n = Number(days ?? 3), window = Number.isFinite(n) ? Math.min(14, Math.max(1, Math.trunc(n))) : 3;
  return (await ask({ cnread: "queue", days: String(window) }))?.cnread ?? null;
});
registerHostHandler("features/report-admin/server/notice-actions.ts", "listClassNotices", async () =>
  okShape(((await ask({ cnread: "notices" }))?.cnread ?? null) as Record<string, unknown> | null, "공지 목록을 불러오지 못했습니다"));
registerHostHandler("features/report-admin/server/class-notice-actions.ts", "listClassWideNotices", async () =>
  okShape(((await ask({ cnread: "classwide" }))?.cnread ?? null) as Record<string, unknown> | null, "반 공지 목록을 불러오지 못했습니다"));
registerHostHandler("features/onescreen/server/prompt-actions.ts", "getPromptHistory", async (type) =>
  typeof type === "string" && /^[a-z0-9_]{1,40}$/.test(type) ? okShape(await ask({ promptHistory: type }), "이력을 불러오지 못했습니다") : { ok: false, error: "알 수 없는 프롬프트 유형" });
registerHostHandler("features/onescreen/server/prompt-actions.ts", "getRecentReportsForTest", async () =>
  okShape(await ask({ testReports: "1" }), "보고서를 불러오지 못했습니다"));
// 지금 반 보드 동기화 버튼 상태 — 못 받으면 2.0 실패 모양(버튼 숨김). 요청(저장)은 연동 PC를 부르므로 보내지 않고 2.0 거절 모양으로.
registerHostHandler("features/report-admin/server/classnote-sync-actions.ts", "getClassnoteSyncStatus", async () =>
  ((await ask({ cnread: "sync" }))?.cnread ?? { available: false, workerReady: false, active: null, latest: null, report: null, nowMs: Date.now() }));
registerHostHandler("features/report-admin/server/classnote-sync-actions.ts", "requestClassnoteBoardSync", async () => ({ ok: false, error: VIEW_ONLY }));
// 통계 화면의 보기 기억(계정 귀속 ui_prefs 저장) — 저장은 아직 없다. 2.0 부품은 결과를 보지 않으므로 보내지 않고 거절 모양만(없는 쓰기 경로 404 방지).
registerHostHandler("features/lesson-reports/stats/prefs-actions.ts", "saveReportStatsMode", async () => ({ ok: false, error: VIEW_ONLY }));
// 직접 발송 · 답글 창의 읽기 넷은 아직 옮기지 않았다 — '저장' 거절 문구가 아니라 읽기 안내로(2.0 실패 모양 { ok:false, error }).
// 거절은 그 자리에서 돌려준다(registerHostFallback은 쓰기 경로에 한 번 보낸 뒤라 없는 경로 404가 콘솔에 남는다).
const NOT_YET_OPEN = { ok: false, error: "연습 화면에서는 아직 열 수 없습니다" };
registerHostHandler("features/report-admin/server/compose-actions.ts", "getAdminComposeContext", async () => NOT_YET_OPEN);
registerHostHandler("features/report-admin/server/compose-actions.ts", "getAdminSendClassOptions", async () => NOT_YET_OPEN);
registerHostHandler("features/classnote-reply/server/reply-actions.ts", "getParentReplyContext", async () => NOT_YET_OPEN);
registerHostHandler("features/classnote-reply/server/notification-reply.ts", "getNotificationReplyContext", async () => NOT_YET_OPEN);
// AI를 부르는 미리보기는 연습 화면에서 하지 않는다 · 학부모 글 공감 상태는 바깥(ClassNote) 조회라 2.0 실패 값(null) 그대로.
registerHostHandler("features/onescreen/server/prompt-actions.ts", "testPrompt", async () => ({ ok: false, error: "연습 화면에서는 AI 미리보기를 하지 않습니다" }));
registerHostHandler("features/classnote-reply/server/reaction-actions.ts", "getParentReactionState", async () => null);

type Loaded = { key?: string; data?: LessonReportsData; missing?: boolean; redirect?: string; error?: string };

function Page() {
  const search = useSearchParams();
  const { sp, query } = useMemo(() => {
    const sp = Object.fromEntries(KEYS.flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? ""]] : []))) as Record<string, string>;
    return { sp, query: new URLSearchParams(sp).toString() };
  }, [search]);
  const [state, setState] = useState<Loaded>({});
  const [tick, setTick] = useState(0);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/lesson-reports${query ? `?${query}` : ""}`, { headers: { Accept: "application/json" } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || "수업보고서를 불러오지 못했습니다."); return body; })
      .then((body) => {
        if (!live) return;
        if (Array.isArray(body?.editors)) setHostEditors(body.editors);
        setState(typeof body?.redirect === "string" ? { key: query, redirect: body.redirect }
          : body?.missing || body?.notFound ? { key: query, missing: true } : { key: query, data: body as LessonReportsData });
      })
      .catch((e: Error) => live && setState({ key: query, error: e.message }));
    return () => { live = false; };
  }, [query, tick]);
  // 다른 조건의 자료로 새 주소를 그리지 않는다(면을 바꾼 직후 · 받기 실패).
  if (state.key !== query || (!state.data && !state.missing && !state.error && !state.redirect)) return <HostMessage text="수업보고서를 불러오는 중…" />;
  if (state.error) return <HostMessage text={state.error} error />;
  // 2.0 page.tsx 첫 판정(?tab=video_homework → 영상 제출 현황) — 서버가 면 조회 없이 알려 준 주소를 다른 3.0 화면으로 넘긴다.
  if (state.redirect) return <Elsewhere path={state.redirect} />;
  if (state.missing || !state.data) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  const data = state.data;
  setCopyDay(data.today);
  const ops = data.settings.operations as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.settings.modules.disabled as never}>
      <LessonReportsPage data={data} searchParams={sp} />
      {data.faceMissing ? <p className="text-text-dim py-6 text-center text-sm" role="status">이 면은 연습 화면에서 아직 열 수 없습니다.</p> : null}
    </OperationsProvider>
  );
}

/**
 * 면 탭 '영상 제출 현황'(2.0 링크 /lesson-reports/video-homework) — 그 주소는 다른 호스트 화면(video-homework)이라 그대로 두면 이 iframe 문서가
 * 통째로 그 화면으로 바뀐다(3.0 주소는 수업보고서인 채). 누르는 순간 가로채 3.0(부모)에 그 화면을 열어 달라고 한다(창 열기와 같은 길).
 */
const VIDEO_ROUTE = "/lesson-reports/video-homework";
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  // 링크 부품(next/link 자리)은 href를 이미 호스트 주소(video-homework.html?…)로 바꿔 그린다 — 2.0 주소 · 호스트 주소 둘 다 본다.
  const u = new URL(a.getAttribute("href") ?? "", location.href);
  if (u.pathname !== VIDEO_ROUTE && u.pathname !== "/v2-host/video-homework.html") return;
  e.preventDefault(); e.stopPropagation();
  window.parent.postMessage({ type: "v2-host-open", href: `${VIDEO_ROUTE}${u.search}` }, location.origin);
}, true);

/** 목록 '보기'의 새 탭(학부모 공유 /r/<토큰> · 인쇄 /lesson_reports/<id>/print) — 3.0에 없는 2.0 주소라 열지 않고 알린다. */
const openWindow = window.open.bind(window);
window.open = ((url?: string | URL, ...rest: unknown[]) => {
  const path = url ? new URL(String(url), location.origin).pathname : "";
  if (/^\/r\/[^/]+$/.test(path) || /^\/lesson_reports\/[^/]+\/print$/.test(path)) { toast.info("연습 화면에서는 아직 열 수 없습니다"); return null; }
  return openWindow(url as string, ...(rest as [string?, string?]));
}) as typeof window.open;

/** 2.0 부품이 그리는 중에 던진 것(redirect · notFound · 그 밖) — 흰 화면 대신 안내 한 줄. */
class Boundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { failed: e instanceof Error ? e.message : "error" }; }
  render() {
    const f = this.state.failed;
    if (f === null) return this.props.children;
    return <HostMessage text={f === "redirect" ? "옮기는 중…" : f === "notFound" ? "고른 사람은 이 화면을 볼 수 없습니다." : "이 화면을 그리지 못했습니다. 새로고침해 주세요."} error={f !== "redirect" && f !== "notFound"} />;
  }
}

/** 다른 3.0 화면의 2.0 주소(영상 제출 현황) — 부모에 창 열기를 알린다(3.0 감싸개가 그 화면으로 옮긴다). */
function Elsewhere({ path }: { path: string }) {
  useEffect(() => {
    // 이 문서 주소의 쿼리는 영상 제출 현황 열쇠일 때만 싣는다(?tab=video_homework에서 왔으면 수업보고서 열쇠라 버린다).
    const search = new URLSearchParams(location.search).has("tab") ? "" : location.search;
    if (window.parent !== window) window.parent.postMessage({ type: "v2-host-open", href: `${path}${search}` }, location.origin);
  }, [path]);
  return <HostMessage text="영상 제출 현황으로 옮기는 중…" />;
}

function App() {
  const path = usePathname();
  if (path === HOST_ROUTE) return <Page />;
  if (path === "/lesson-reports/stats") return <LessonReportsStats />;
  if (path === "/lesson-reports/video-homework") return <Elsewhere path={path} />;
  return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
}

/** 주소(면 · 하위 주소)가 바뀌면 안내를 걷고 다시 그린다 — 한 면의 오류가 다른 면까지 가두지 않게. */
function Guarded() {
  const path = usePathname(), search = useSearchParams().toString();
  return <Boundary key={`${path}?${search}`}><App /></Boundary>;
}

createRoot(document.getElementById("root")!).render(<AppProviders><HostFrame screen="lesson-reports"><Guarded /></HostFrame></AppProviders>);
