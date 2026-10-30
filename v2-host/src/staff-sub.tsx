// 직원관리 하위 화면(작업자 B) — 연차 관리 · 급여명세서 · 이력서. 진입점 staff.tsx(작업자 A)가 isStaffSubPath로 갈라 그린다.
// 자료 = GET /api/v2/staff?v2path=…(v2-staff-sub.mjs staffSubLoad) · 주소 열쇠 staff(이력서 작성의 직원 연결)·edit(바로 수정)도 함께 보낸다.
// 저장 = 2.0 서버 함수 이름 그대로 POST /api/v2/staff/<함수>(공용 serverAction). 2.0이 저장 뒤 revalidatePath로 다시 그리던 자리는
// 여기서 이 화면 자료를 다시 읽는다(hostRefresh).
import { useEffect } from "react";
import { OperationsProvider } from "@/features/owner/operations-context";
import { hostNavigate, hostRefresh } from "../shims/host-nav";
import { hostActor, registerHostHandler } from "../shims/server-action";
import { HostMessage } from "./host-frame";
import { AnnualLeavePage, type AnnualLeaveData } from "./staff-sub-annual-leave";
import { NewResumePage, ResumeViewPage, type ResumeNewData, type ResumeViewData } from "./staff-sub-resume";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SUB = new RegExp(`^/staff/(?:annual-leave|payroll|resumes(?:/new|/${UUID})?|${UUID}/payroll)$`, "i");
const RESUME_VIEW = new RegExp(`^/staff/resumes/${UUID}$`, "i");

/** 이 작업자의 경로인가 — 서버 isStaffSubPath와 같은 판정. */
export function isStaffSubPath(path: string): boolean { return SUB.test(path.split("?")[0]); }
/** 진입점이 조회 주소에 함께 실어 보낼 주소 열쇠(서버 staffSubParams와 같은 이름). */
export const STAFF_SUB_QUERY_KEYS = ["staff", "edit"] as const;

// ── 저장: 성공하면 이 화면 자료를 다시 읽는다 ─────────────────────────────────────────────────────────────────────────
const NOT_SAVED = "저장하지 못했습니다 — 바뀐 것은 없습니다", UNREACHABLE = "연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다";
const encodeArg = (v: unknown) =>
  v instanceof FormData ? { $formData: [...v.entries()].filter(([, x]) => typeof x === "string") } : v === undefined ? null : v;
async function post(module: string, name: string, args: unknown[]): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const res = await fetch(`/api/v2/staff/${name}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ module, actor: hostActor(), args: args.map(encodeArg) }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!res.ok || !body?.ok) return { ok: false, error: body?.message || NOT_SAVED };
    return { ok: true, result: body.result };
  } catch { return { ok: false, error: UNREACHABLE }; }
}
const LEAVE = "features/leave/server/actions.ts", RESUME = "features/staff/resume/server/resume-actions.ts";
for (const name of ["addLeaveAdjustment", "deleteLeaveAdjustment"]) {
  registerHostHandler(LEAVE, name, async (...args: unknown[]) => {
    const r = await post(LEAVE, name, args);
    if (!r.ok) return { error: r.error };
    const result = r.result as { ok?: boolean } | undefined;
    if (result?.ok) hostRefresh(); // 2.0 revalidatePath("/staff/annual-leave")
    return result;
  });
}
// 이력서 삭제 — 2.0 버튼은 성공하면 window.location.replace("/staff")로 문서를 통째로 옮긴다. 이 화면에선 그 주소가 호스트 밖이라,
// 성공하면 여기서 직원목록으로 옮기고 버튼의 이동 줄까지는 가지 않게 한다(옮긴 뒤 버튼은 사라진다).
registerHostHandler(RESUME, "deleteStaffResume", async (...args: unknown[]) => {
  const r = await post(RESUME, "deleteStaffResume", args);
  if (!r.ok) return { error: r.error };
  const result = r.result as { ok?: boolean; error?: string } | undefined;
  if (!result?.ok) return result ?? { error: NOT_SAVED };
  hostNavigate("/staff", "replace");
  return new Promise(() => {});
});

type SubData = {
  editors?: unknown; operations?: Record<string, unknown>;
  redirect?: string; notAllowed?: boolean; notFound?: boolean; unsupported?: boolean; notReady?: boolean;
};

function Redirect({ to }: { to: string }) {
  useEffect(() => { hostNavigate(to, "replace"); }, [to]);
  return <HostMessage text="직원관리로 이동하는 중…" />;
}

export function StaffSubPage({ path, data }: { path: string; data: unknown }) {
  const d = (data ?? {}) as SubData;
  const route = path.split("?")[0];
  if (d.redirect) return <Redirect to={d.redirect} />;
  if (d.notAllowed) return <HostMessage text="이 계정은 이 화면을 볼 수 없습니다 · 계정 전환" error />;
  if (d.notFound) return <HostMessage text="이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다." error />;
  if (d.unsupported || d.notReady || !d.operations) return <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />;
  const ops = d.operations as unknown as Parameters<typeof OperationsProvider>[0];
  return (
    <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={[] as never}>
      {route === "/staff/annual-leave" ? <AnnualLeavePage data={d as unknown as AnnualLeaveData} />
        : route === "/staff/resumes/new" ? <NewResumePage key={(d as unknown as ResumeNewData).userId} page={d as unknown as ResumeNewData} />
        : RESUME_VIEW.test(route) ? <ResumeViewPage key={`${route}:${(d as unknown as ResumeViewData).userId}`} data={d as unknown as ResumeViewData} />
        : <HostMessage text="이 화면은 연습 화면에서 아직 열 수 없습니다." />}
    </OperationsProvider>
  );
}
