// 2.0 학원 설정 '연동' 면(app/(shell)/owner/_components/integrations-face.tsx · sheets-face.tsx)의 그리기 — 둘 다 서버 컴포넌트라 그대로 못 불러와서,
// 서버가 하던 판정(켜진 연동 탭 · 고른 탭)·조회(과목별 구글 시트 상태)는 /api/v2/owner?tab=sheets(v2-screen-owner.mjs)가 하고 여기서는 두 파일의 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳 = 아직 옮기지 않은 서버 카드(연동 PC · makeedu 동기화)를 '아직' 자리로 — owner-integrations.swaps.json, verify가 대조한다.
// 구글 시트 절(과목별 카드 · 켜기 · 대상 시트)은 그대로 — 저장은 v2-owner-integrations.mjs(2.0 setSheetsExportEnabled · setSubjectSheetTarget).
import { FaceTabs, type Face } from "@/components/face-tabs";
import { EyIcon } from "@/components/icons/aywa-icons";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { SHEET_EXPORT_SUBJECTS } from "@/features/integrations/sheets-provider";
import type { IntegrationStatus } from "@/features/integrations/server/queries";
import type { TenantSettings } from "@/features/owner/settings-types";
import { SubjectSheetCard } from "@/app/(shell)/owner/_components/subject-sheet-card";
import { OwnerServerFace } from "./owner-server-face";
import { OwnerSlackCard } from "./owner-slack";
import { OwnerVideoCard, type OwnerVideoData } from "./owner-video";
import { TodaysMathCard } from "@/app/(shell)/owner/_components/todays-math-card";
import { TodaysMathMenusCard } from "@/app/(shell)/owner/_components/todays-math-menus-card";
import { AgentCard } from "@/app/(shell)/owner/_components/agent-card";

export type IntegrationSub = "slack" | "makeedu" | "sheets" | "video" | "agent" | "todaysMath";

/** /api/v2/owner?tab=sheets — integrations-face.tsx가 계산하던 값(켜진 탭 · 고른 탭)과 sheets-face.tsx의 시트 상태. */
export type OwnerIntegrationsData = { available: IntegrationSub[]; sheetStatuses: IntegrationStatus[]; saEmail: string | null; slack: import("@/features/slack/server/queries").SlackCardState | null; video: OwnerVideoData | null; agent: unknown };

const LABEL: Record<IntegrationSub, string> = { slack: "슬랙", makeedu: "makeedu 동기화", sheets: "구글 시트", video: "숙제영상 드라이브", agent: "연동 PC", todaysMath: "오늘 수학" };

/** sheets-face.tsx `SheetsFace`의 그리기(makeedu 부분은 '아직'). */
function OwnerSheetsFace({ subjects, makeeduOn, sheetsOn, sheetStatuses, saEmail }: {
  subjects: Parameters<typeof buildSubjectMaps>[0]; makeeduOn: boolean; sheetsOn: boolean; sheetStatuses: IntegrationStatus[]; saEmail: string | null;
}) {
  if (!makeeduOn && !sheetsOn) {
    return (
      <div className="bg-card shadow-card w-full rounded-2xl p-6">
        <p className="text-foreground text-sm font-bold">이 학원은 makeedu·구글 시트 연동을 쓰지 않습니다</p>
        <p className="text-text-dim mt-1 text-sm">
          makeedu 동기화·구글 시트 시간표 연동은 학원 설정의 &lsquo;기능&rsquo; 면에서 켤 수 있습니다.
        </p>
      </div>
    );
  }
  const subjectMaps = buildSubjectMaps(subjects);
  return (
    <div className="w-full space-y-8">
      {/* makeedu 자동 동기화 — 외부 연동 면 상단: 토글/버튼 카드 + 담당 PC 상태(0073a) + 최근 실행 이력(0070a) */}
      {makeeduOn ? <OwnerServerFace face="makeedu" /> : null}

      {sheetsOn ? (
      <div className="space-y-5">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 외부 연동</p>
        <h2 className="text-foreground text-lg font-bold">구글 시트 내보내기 (과목별)</h2>
        {/* text-balance(text-wrap: balance) = 짧은 문단의 줄 너비를 균등하게 나눠 마지막 줄이 짧게 남는 고아 방지
            (실측: 같은 폭에서 pretty는 [763,128] 고아, balance는 [447,444] 균등). max-w-3xl 고정폭도 풀어(max-w-5xl)
            넓은 창에선 한 줄로 붙고 좁으면 균등 2줄로 접히게 — 창 폭에 따라 스마트하게. */}
        <p className="text-muted-foreground mt-1 max-w-5xl text-sm text-balance">
          과목마다 <strong>전용 구글 시트</strong>를 등록하고 켜면 그 과목 시간표 화면에 ‘시트로 보내기’ 버튼이
          생깁니다(원장 전용). 누르면 등록한 시트에 현재 시간표가 <strong>통째로 덮어쓰기</strong>됩니다.
        </p>
        <p className="text-muted-foreground mt-2 flex max-w-5xl items-start gap-1.5 text-sm text-balance">
          <EyIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>전체 덮어쓰기라 <strong>과목마다 서로 다른 시트</strong>를 써야 합니다(수학·영어를 한 시트에 섞지 마세요).</span>
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {/* 좌 — 최초 1회 설정 안내(서비스계정은 새 시트를 못 만들어 사람이 만든 시트에 공유가 필요) */}
        <section className="border-border bg-card flex flex-col rounded-2xl border p-5 text-sm leading-relaxed">
          <p className="text-foreground font-bold">처음 한 번 설정 (과목마다)</p>
          <ol className="text-text-dim mt-2 list-decimal space-y-1.5 pl-5">
            <li>
              구글 드라이브에서 <strong>빈 구글 시트</strong>를 과목 수만큼 만듭니다(원장 계정 소유).
            </li>
            <li>
              각 시트를 아래 계정에 <strong>‘편집자’로 공유</strong>합니다:
              {saEmail ? (
                <code className="bg-bg-soft border-line mt-1 block w-fit rounded border px-1.5 py-0.5 text-xs break-all">
                  {saEmail}
                </code>
              ) : (
                <span className="text-danger ml-1">서비스계정 키 미설정 — 관리자에게 문의</span>
              )}
            </li>
            <li>
              시트 URL의 <code>/d/</code> 뒤 ID를 오른쪽 과목 카드의 <strong>Google Sheets ID</strong>에 등록합니다.
            </li>
            <li>토글을 켜고, 시간표 화면의 ‘시트로 보내기’ 버튼으로 동기화합니다.</li>
          </ol>
          <p className="text-text-faint mt-auto flex items-start gap-1.5 pt-3 text-xs text-balance">
            <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            <span>서비스계정은 저장공간이 없어 시트를 새로 만들 수 없습니다(미리 만든 시트 필요). 동기화는
            그 시트를 <strong>전체 덮어쓰기</strong>하므로 다른 내용과 섞지 말고 과목 전용 시트로 쓰세요.
            </span>
          </p>
        </section>

        {/* 우 — 과목별 시트 카드(토글 + 대상 ID + 상태) */}
        <div className="space-y-4">
          {SHEET_EXPORT_SUBJECTS.map((s, i) => (
            <SubjectSheetCard key={s} subject={s} label={subjectMaps.labelOf(s)} status={sheetStatuses[i]} />
          ))}
        </div>
      </div>
      </div>
      ) : null}
    </div>
  );
}

/** integrations-face.tsx `IntegrationsFace`의 그리기 — 켜진 탭(available)·시트 상태는 서버 결과에서, 고른 탭은 2.0과 같은 식으로 주소(sub · page)에서. */
export function OwnerIntegrationsFace({ d, settings, sub, page, isMaster }: { d: OwnerIntegrationsData; settings: Pick<TenantSettings, "operations" | "report">; sub: string | undefined; page: number; isMaster: boolean }) {
  const { available, sheetStatuses, saEmail } = d;
  if (available.length === 0) {
    return (
      <div className="border-border bg-card rounded-2xl border p-5">
        {/* 꺼진 연동의 이름을 늘어놓지 않는다(원장 2026-09-30 "꺼지면 있었는지조차 모르게"). */}
        <p className="text-foreground text-sm font-bold">이 학원은 켜진 외부 연동이 없습니다</p>
      </div>
    );
  }
  // sub 없는 옛 링크 중 실행 이력 페이저(`&page=N`)는 makeedu 면의 것이다.
  const wanted = sub ?? (page > 1 ? "makeedu" : "");
  const active: IntegrationSub = (available as string[]).includes(wanted) ? (wanted as IntegrationSub) : available[0]!;
  const faces: Face[] = available.map((key) => ({ key, label: LABEL[key], href: `/owner?tab=sheets&sub=${key}` }));

  return (
    <div className="space-y-4">
      {available.length > 1 ? <FaceTabs faces={faces} active={active} level="secondary" ariaLabel="연동 종류 전환" /> : null}
      {active === "slack" && d.slack ? <OwnerSlackCard state={d.slack} /> : null}
      {active === "makeedu" || active === "sheets" ? (
        <OwnerSheetsFace
          subjects={settings.operations.subjects}
          makeeduOn={active === "makeedu"}
          sheetsOn={active === "sheets"}
          sheetStatuses={sheetStatuses}
          saEmail={saEmail}
        />
      ) : null}
      {active === "video" ? <OwnerVideoCard view={d.video} /> : null}
      {active === "todaysMath" ? <TodaysMathCard report={settings.report} /> : null}
      {active === "todaysMath" && isMaster ? <TodaysMathMenusCard /> : null}
      {active === "agent" ? <AgentCard classnoteOn={available.includes("video")} makeeduOn={available.includes("makeedu")} /> : null}
    </div>
  );
}
