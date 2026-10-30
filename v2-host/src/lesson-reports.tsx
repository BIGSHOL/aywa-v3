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
import { hostActor, registerHostHandler, setHostEditors, VIEW_ONLY } from "../shims/server-action";
import { usePathname, useSearchParams } from "../shims/next-navigation";
import { HostFrame, HostMessage } from "./host-frame";
import { LessonReportsStats } from "./lesson-reports-stats";

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = "수업보고서";
export const HOST_ROUTE = "/lesson-reports";

/** page.tsx searchParams(v2-screen-lesson-reports.mjs KEYS와 같다 — 시험이 대조). */
const KEYS = ["tab", "section", "status", "rmonth", "page"] as const;
const teacherHome = new URLSearchParams(location.search).get('teacherHome') === '1';

/** 면 안 부품이 다시 읽는 2.0 서버 함수(읽기) — 같은 화면의 GET 열쇠로 묻는다(v2-screen-lesson-reports.mjs params). 답은 2.0 반환 모양. */
async function ask(query: Record<string, string>): Promise<Record<string, unknown> | null> {
  const actor = hostActor(); if (!actor) return null;
  const r = await fetch(`/api/v2/lesson-reports?${new URLSearchParams({ ...query, viewer: actor })}`, { headers: { Accept: "application/json" } }).catch(() => null);
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
// 지금 반 보드 동기화 버튼 상태 — 못 받으면 2.0 실패 모양(버튼 숨김).
registerHostHandler("features/report-admin/server/classnote-sync-actions.ts", "getClassnoteSyncStatus", async () =>
  ((await ask({ cnread: "sync" }))?.cnread ?? { available: false, workerReady: false, active: null, latest: null, report: null, nowMs: Date.now() }));
// 원본은 생존 PC가 없으면 요청을 거절한다. 통과해도 복사본의 요청 행만 남기며 실제 동기화는 실행되지 않는다.
const SYNC_MODULE = "features/report-admin/server/classnote-sync-actions.ts";
registerHostHandler(SYNC_MODULE, "requestClassnoteBoardSync", async (...args) => {
  try {
    const response = await fetch("/api/v2/lesson-reports/requestClassnoteBoardSync", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ module: SYNC_MODULE, actor: hostActor(), args }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!response.ok || !body?.ok) return { ok: false, error: body?.message ?? "동기화 요청을 저장하지 못했습니다." };
    const result = body.result as { ok?: boolean; message?: string; error?: string } | null;
    if (result?.ok && typeof result.message === "string" && result.message.includes("연동 PC"))
      return { ...result, message: "요청을 복사본 대기열에 남겼습니다. 연습 자료라 실제 동기화는 실행되지 않습니다." };
    if (result && !result.ok && result.error?.startsWith("연동 PC가 꺼져 있거나"))
      return { ...result, error: "연습 자료에는 연동 PC가 없어 지금 동기화 요청을 받을 수 없습니다." };
    return result;
  } catch { return { ok: false, error: "동기화 요청을 저장하지 못했습니다." }; }
});
// 발송 요청은 2.0 함수를 Docker에서 실행한다. 대기열에 오른 뒤 2.0의 발송 PC 안내는 연습 자료 안내로 바꾼다.
const COPY_QUEUE_NOTICE = "연습 자료라 실제로 보내지지 않습니다 — 발송 대기로만 남습니다";
let queuedToastCount = 0;
const originalSuccess = toast.success;
toast.success = ((message, data) => {
  if (typeof message === "string" && (message.startsWith("게시취소를 요청했습니다 — 발송 PC가") || message.startsWith("수정을 요청했습니다 — 발송 PC가"))) {
    return originalSuccess(`${message.split(" — 발송 PC가")[0]} · ${COPY_QUEUE_NOTICE}`, data);
  }
  if (queuedToastCount > 0 && typeof message === "string" && /(?:재)?발송 대기/.test(message)) {
    queuedToastCount--;
    return originalSuccess(`${message.replace(" — 발송 PC가 순서대로 보냅니다", "").replace("(발송 PC가 순차 게시)", "").replace("(연동 PC가 순차 게시)", "").replace(" — 연동 PC가 자동으로 전송합니다(발송 허용 시간대 설정 시 그 시간에).", "")} · ${COPY_QUEUE_NOTICE}`, data);
  }
  return originalSuccess(message, data);
}) as typeof toast.success;
const originalMessage = toast.message;
toast.message = ((message, data) => originalMessage(
  typeof message === "string" && (message.startsWith("dry-run — 승인 전이라 실제") || message.startsWith("dry-run — '보고서 설정' 탭에서 'ClassNote 실제 발송'") || message.startsWith("실제 발송이 꺼져 있어 전송하지 않았습니다 — 대상"))
    ? "발송 설정이 꺼져 대기열에도 올리지 않았습니다. 연습 자료에서는 실제로 보내지지 않습니다."
    : message === "저장했습니다. 현재 실제 발송이 꺼져 있어 전송은 대기 상태입니다(원장 설정에서 켜야 전송)."
      ? "저장했습니다. 발송 설정이 꺼져 대기열에도 올리지 않았습니다. 연습 자료에서는 실제로 보내지지 않습니다."
    : typeof message === "string" && message.includes("발송 대기(연동 PC가 순차 게시)")
      ? `${message.replace("(연동 PC가 순차 게시)", "")} · ${COPY_QUEUE_NOTICE}`
    : message, data,
)) as typeof toast.message;

const QUEUE_ACTIONS: [string, string[]][] = [
  ["features/report-admin/server/actions.ts", ["sendClassnoteForUnsent", "retryClassnote"]],
  ["features/report-admin/server/notice-actions.ts", ["sendClassNotice"]],
  ["features/report-admin/server/class-notice-actions.ts", ["sendClassWideNotice"]],
  ["features/report-admin/server/compose-actions.ts", ["saveAndQueueAdminReport", "sendBulkAdminReports"]],
  ["features/onescreen/server/notice-actions.ts", ["sendOnescreenNotice"]],
];
for (const [module, names] of QUEUE_ACTIONS) for (const name of names) registerHostHandler(module, name, async (...args) => {
  try {
    const response = await fetch(`/api/v2/lesson-reports/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ module, actor: hostActor(), args }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!response.ok || !body?.ok) return { ok: false, error: body?.message ?? "발송 요청을 저장하지 못했습니다." };
    const result = body.result as { ok?: boolean; queued?: number; requeued?: number; dryRun?: boolean; status?: string } | null;
    if (result?.ok && !result.dryRun && ((result.queued ?? 0) > 0 || (result.requeued ?? 0) > 0 || result.status === "queued")) queuedToastCount++;
    return result;
  } catch { return { ok: false, error: "발송 요청을 저장하지 못했습니다." }; }
});

// 학부모 답글은 2.0의 생존 PC·권한·대상 판정을 그대로 거친다. 성공해도 복사본에는 요청 상태만 남는다.
const REPLY_MODULE = "features/classnote-reply/server/reply-actions.ts";
for (const name of ["requestParentReply", "requestParentReplyEdit", "requestParentReplyDelete"]) registerHostHandler(REPLY_MODULE, name, async (...args) => {
  try {
    const response = await fetch(`/api/v2/lesson-reports/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ module: REPLY_MODULE, actor: hostActor(), args }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!response.ok || !body?.ok) return { ok: false, error: body?.message ?? "답글 요청을 저장하지 못했습니다." };
    const result = body.result as { ok?: boolean; message?: string } | null;
    if (result?.ok && typeof result.message === "string" && result.message.includes(" — 연동 PC가"))
      return { ...result, message: `${result.message.split(" — 연동 PC가")[0]} · 연습 자료라 실제로 보내지지 않습니다` };
    return result;
  } catch { return { ok: false, error: "답글 요청을 저장하지 못했습니다." }; }
});

// 공감도 같은 복사본 경계를 쓴다. 원본은 생존 PC·확정 학생·중복·낙관적 잠금을 다시 판정한다.
const REACTION_MODULE = "features/classnote-reply/server/reaction-actions.ts";
for (const name of ["requestParentReaction", "requestParentReactionRemove"]) registerHostHandler(REACTION_MODULE, name, async (...args) => {
  try {
    const response = await fetch(`/api/v2/lesson-reports/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ module: REACTION_MODULE, actor: hostActor(), args }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!response.ok || !body?.ok) return { ok: false, error: body?.message ?? "공감 요청을 저장하지 못했습니다." };
    const result = body.result as { ok?: boolean; message?: string } | null;
    if (result?.ok && typeof result.message === "string" && result.message.includes(" — 연동 PC가"))
      return { ...result, message: `${result.message.split(" — 연동 PC가")[0]} · 연습 자료라 실제로 보내지지 않습니다` };
    return result;
  } catch { return { ok: false, error: "공감 요청을 저장하지 못했습니다." }; }
});

// 저장(회수 · 멈춤 복구 · 원아 연결 · 프롬프트 · 보고서 설정 · 통계 보기 기억)은 이 화면 actions(v2-lesson-reports-save.mjs)가 받는다 —
// 여기 적지 않은 함수는 shim이 쓰기 경로로 보낸다. 아래는 그 경로가 받지 않는 저장 — 보내지 않고 그 자리에서 2.0 거절 모양으로.
const REFUSE: Record<string, string[]> = {};
for (const [module, names] of Object.entries(REFUSE)) for (const name of names) registerHostHandler(module, name, async () => ({ ok: false, error: VIEW_ONLY }));
// AI를 부르는 일(멘트 자동작성 · 사랑의 한마디 초안 · 말투 지금 갱신)도 연습 자료에서 하지 않는다.
const NO_AI = { ok: false, error: "연습 자료에서는 AI를 부르지 않습니다" };
registerHostHandler("features/onescreen/server/actions.ts", "generateReportComment", async () => NO_AI);
registerHostHandler("features/onescreen/server/love-note-actions.ts", "suggestLoveNote", async () => NO_AI);
registerHostHandler("features/onescreen/server/ment-style-actions.ts", "rebuildMentStylesNow", async () => NO_AI);
// 직접 발송 · 답글 창의 읽기 넷은 서버 화면 actions가 2.0 함수를 읽기 전용 러너로 실행한다.
// AI를 부르는 미리보기는 연습 자료에서 하지 않는다. 학부모 글 공감 상태는 2.0 원본 읽기를 사용한다.
registerHostHandler("features/onescreen/server/prompt-actions.ts", "testPrompt", async () => ({ ok: false, error: "연습 자료에서는 AI 미리보기를 하지 않습니다" }));

type Loaded = { key?: string; data?: LessonReportsData; missing?: boolean; redirect?: string; error?: string };

function Page() {
  const search = useSearchParams();
  const { sp, query } = useMemo(() => {
    const sp = Object.fromEntries(KEYS.flatMap((k) => (search.has(k) ? [[k, search.get(k) ?? ""]] : []))) as Record<string, string>;
    const query = new URLSearchParams(sp);
    const actor = hostActor();
    if (actor) query.set('viewer', actor);
    if (teacherHome) query.set('teacherHome', '1');
    return { sp, query: query.toString() };
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
          : body?.noAccess || (!body?.missing && !body?.notFound && body?.viewer?.id !== hostActor()) ? { key: query, error: '이 계정은 이 화면을 볼 수 없습니다 · 계정 전환' }
            : body?.missing || body?.notFound ? { key: query, missing: true } : { key: query, data: body as LessonReportsData });
      })
      .catch((e: Error) => live && setState({ key: query, error: e.message }));
    return () => { live = false; };
  }, [query, tick]);
  // 다른 조건의 자료로 새 주소를 그리지 않는다(면을 바꾼 직후 · 받기 실패).
  if (!hostActor() || state.key !== query || (!state.data && !state.missing && !state.error && !state.redirect)) return <HostMessage text="수업보고서를 불러오는 중…" />;
  if (state.error) return <HostMessage text={state.error} error />;
  // 2.0 page.tsx 첫 판정(?tab=video_homework → 영상 제출 현황) — 서버가 면 조회 없이 알려 준 주소를 다른 3.0 화면으로 넘긴다.
  if (state.redirect) return <Elsewhere path={state.redirect} />;
  if (state.missing || !state.data) return <HostMessage text="아직 3.0에 없는 화면입니다." />;
  const data = state.data;
  setCopyDay(data.today);
  const ops = data.settings.operations as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={data.settings.modules.disabled as never}>
      <p className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">{COPY_QUEUE_NOTICE}</p>
      <LessonReportsPage data={data} searchParams={sp} />
      {data.faceMissing ? <p className="text-text-dim py-6 text-center text-sm" role="status">아직 3.0에 없는 화면입니다.</p> : null}
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
  if (/^\/r\/[^/]+$/.test(path) || /^\/lesson_reports\/[^/]+\/print$/.test(path)) { toast.info("아직 3.0에 없는 화면입니다"); return null; }
  return openWindow(url as string, ...(rest as [string?, string?]));
}) as typeof window.open;

/** 2.0 부품이 그리는 중에 던진 것(redirect · notFound · 그 밖) — 흰 화면 대신 안내 한 줄. */
class Boundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { failed: e instanceof Error ? e.message : "error" }; }
  render() {
    const f = this.state.failed;
    if (f === null) return this.props.children;
    return <HostMessage text={f === "redirect" ? "옮기는 중…" : f === "notFound" ? "현재 계정은 이 화면을 볼 수 없습니다." : "이 화면을 그리지 못했습니다. 새로고침해 주세요."} error={f !== "redirect" && f !== "notFound"} />;
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
  return <HostMessage text="아직 3.0에 없는 화면입니다." />;
}

/** 주소(면 · 하위 주소)가 바뀌면 안내를 걷고 다시 그린다 — 한 면의 오류가 다른 면까지 가두지 않게. */
function Guarded() {
  const path = usePathname(), search = useSearchParams().toString();
  return <Boundary key={`${path}?${search}`}><App /></Boundary>;
}

createRoot(document.getElementById("root")!).render(<AppProviders><HostFrame screen="lesson-reports"><Guarded /></HostFrame></AppProviders>);
