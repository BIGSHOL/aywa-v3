// 2.0 slack-card.tsx 본문 그대로: 서버 조회만 props로 옮긴다.
import type { SlackCardState } from "@/features/slack/server/queries";
import { ConnectionSection } from "@/app/(shell)/owner/_components/slack/connection-section";
import { PeopleSection } from "@/app/(shell)/owner/_components/slack/people-section";
import { RulesSection } from "./owner-slack-rules";
import { ScheduleSection } from "@/app/(shell)/owner/_components/slack/schedule-section";

/**
 * 슬랙 연동 카드(학원 설정 '연동' 면) — 슈퍼관리자가 '슬랙 알림 연결'을 켠 지점에만 선다.
 * aywa에서 일어나는 일(알림·활동 기록)을 규칙대로 슬랙 채널·1:1로 보낸다(2026-09-28, codex·grok 합의 설계).
 */
export function OwnerSlackCard({ state }: { state: SlackCardState }) {
  if (state.kind === "off") return null;

  return (
    <section className="border-border bg-card space-y-5 rounded-2xl border p-5" aria-label="슬랙 연동">
      <div>
        <h3 className="text-foreground text-sm font-bold">슬랙 연동</h3>
        <p className="text-text-dim mt-1 text-xs">
          에이와에서 일어나는 일(알림·활동 기록)을 정한 규칙대로 슬랙 채널이나 1:1로 보냅니다. 급여·이력서·근로계약·비밀번호 관련은
          보내지 않고, 돈 관련 활동은 누가 무엇을 했는지만 보냅니다. 학생 이름이 들어가므로 직원만 있는 워크스페이스에 연결하세요.
        </p>
      </div>
      {state.kind === "readonly" ? (
        <p className="text-text-dim text-sm">슬랙 연동은 원장만 설정할 수 있습니다.</p>
      ) : state.kind === "missing_table" ? (
        <p className="text-danger text-sm">슬랙 연동을 아직 쓸 수 없는 상태입니다. 준비가 끝나면 여기서 설정할 수 있습니다 — 계속 이렇게 보이면 고객센터로 알려 주세요.</p>
      ) : state.kind === "error" ? (
        <p className="text-danger text-sm">슬랙 설정을 읽지 못했습니다. 잠시 후 새로고침해 주세요.</p>
      ) : (
        <>
          <ConnectionSection
            connected={state.connected}
            maskedToken={state.maskedToken}
            teamName={state.teamName}
            broken={state.broken}
            lastDispatchAt={state.lastDispatchAt}
            lastErrorCode={state.lastErrorCode}
            health={state.health}
          />
          {state.connected ? (
            <>
              <ScheduleSection initial={state.schedule} />
              <RulesSection initialRules={state.rules} staff={state.staff} activityOptions={state.activityOptions} />
              {/* 사람 연결 명단(직원 전원)은 길다 — 접어 두고 필요할 때 연다(원장 2026-09-28 "세로 스크롤이 너무 길어짐"). */}
              <details className="border-border rounded-xl border">
                <summary className="text-foreground hover:bg-bg-soft/60 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-bold">
                  사람 연결 <span className="text-text-dim ml-1 text-xs font-normal">1:1 메시지를 받을 직원의 슬랙 계정 연결 · 누르면 펼침</span>
                </summary>
                <div className="border-line border-t px-4 py-3">
                  <PeopleSection />
                </div>
              </details>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
