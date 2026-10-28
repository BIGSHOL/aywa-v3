// 2.0 전자결재 결재 문서(app/(shell)/approvals/[id]/page.tsx)를 호스트로 옮긴 것 — 서버 컴포넌트라 그대로 불러올 수 없어
// 자료 받는 부분(getCurrentUser · getApprovalDoc · getApprovalComments · 렌더 직전 위생처리)만 /api/v2/approvals가 준 값으로 바꾸고
// 나머지(결재 이력 · 처리 패널 판정 · 문서 배치)는 원문 그대로다. verify-v2-screen-approvals.mjs가 원문과 글자를 대조한다.
import Link from "next/link";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { APPROVAL_FORM_LABEL, STEP_DECISION_LABEL, docStatusLabel } from "@/features/approvals/types";
import { formatLeaveDays, LEAVE_KIND_LABEL } from "@/features/leave/request-days";
import type { ApprovalCommentsBox, ApprovalDocRow } from "@/features/approvals/server/queries";
// queries.ts는 서버 전용이라 두 판정(isMyTurn · needsMyDeferredConfirm)만 원문 그대로 옮겼다.
function isMyTurn(doc: ApprovalDocRow, userId: string): boolean {
  if (doc.status !== "pending") return false;
  const step = doc.steps.find((s) => s.stepNo === doc.currentStep);
  return !!step && step.approverId === userId && step.decision === "pending";
}
function needsMyDeferredConfirm(doc: ApprovalDocRow, userId: string): boolean {
  return doc.steps.some((s) => s.approverId === userId && s.decision === "deferred");
}
import { ApprovalStamps } from "@/app/(shell)/approvals/[id]/_stamps";
import { CommentDeleteForm, CommentForm } from "@/app/(shell)/approvals/[id]/_comments";
import { DecidePanel, DeferredConfirmPanel, WithdrawPanel } from "@/app/(shell)/approvals/[id]/_decide-panel";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";


// ── 결재 이력 타임라인(하이웍스 '문서 진행 이력' 대응) ─────────────────────────
// 기안 → 처리된 단계(승인/반려 + 의견) → 종결(또는 "현재 N차 차례"). 결재 의견은 여기로 흡수한다
// (같은 의견을 두 번 그리지 않는다).

type TimelineTone = "neutral" | "green" | "danger" | "primary";

type TimelineEvent = {
  key: string;
  /** 줄 머리 — "기안"·"1차 검토"·"문서 종결"·"현재 2차 김예원 차례" */
  label: string;
  person: string | null;
  /** 결과 단어("승인"·"반려"·"회수") — tone 색으로 찍는다. */
  result: string | null;
  tone: TimelineTone;
  time: string | null;
  note: string | null;
};

const DOT_TONE: Record<TimelineTone, string> = {
  neutral: "bg-bg-soft border-line border",
  green: "bg-green",
  danger: "bg-danger",
  primary: "bg-primary",
};

const TEXT_TONE: Record<TimelineTone, string> = {
  neutral: "text-text-dim",
  green: "text-green",
  danger: "text-danger",
  primary: "text-primary",
};

/** ISO → "2026-08-14 12:34" (분까지). raw ISO 전체를 그대로 찍지 않는다. */
function fmtTime(iso: string | null): string | null {
  return iso ? iso.slice(0, 16).replace("T", " ") : null;
}

function buildTimeline(doc: ApprovalDocRow): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      key: "draft",
      label: "기안",
      person: doc.drafterName,
      result: null,
      tone: "neutral",
      time: fmtTime(doc.submittedAt),
      note: null,
    },
  ];

  for (const s of doc.steps) {
    // 처리된 칸만 — 대기(pending)·후결 대기(deferred)·전결 생략(skipped)은 결재란 도장이 이미 보여준다.
    if (s.decision === "pending" || s.decision === "deferred" || s.decision === "skipped") continue;
    events.push({
      key: `step-${s.stepNo}`,
      label: `${s.stepNo}차 ${s.roleLabel}`,
      person: s.approverName,
      result: STEP_DECISION_LABEL[s.decision], // 승인·반려·전결·후결 — 라벨 매핑 한 곳(types.ts)
      tone:
        s.decision === "rejected"
          ? "danger"
          : s.decision === "final" || s.decision === "post_approved"
            ? "primary"
            : "green",
      time: fmtTime(s.decidedAt),
      // 대결이면 실제 처리자를 함께 남긴다 — 결재란 도장 아래 표기와 같은 사실.
      note: [s.actedByName ? `대결 — ${s.actedByName}` : null, s.comment]
        .filter(Boolean)
        .join(" · ") || null,
    });
  }

  if (doc.status === "pending") {
    const current = doc.steps.find((s) => s.stepNo === doc.currentStep);
    events.push({
      key: "turn",
      label: `현재 ${doc.currentStep}차 ${current?.approverName ?? ""} 차례`.replace("  ", " "),
      person: null,
      result: null,
      tone: "primary",
      time: null,
      note: null,
    });
  } else {
    const closed = docStatusLabel(doc.status);
    events.push({
      key: "closed",
      label: "문서 종결",
      person: null,
      result: closed.label,
      tone: doc.status === "approved" ? "green" : doc.status === "rejected" ? "danger" : "neutral",
      time: fmtTime(doc.completedAt),
      note: doc.outcomeNote,
    });
  }
  return events;
}

/**
 * 결재 문서 1건 — **하이웍스 결재 문서 배치**(원장 스크린샷 2026-08-14 기준):
 * 가운데 큰 표제("휴가신청서") → 정보 격자표(문서 종류·번호·기안자·일시·상태) → **원형 도장 결재란 표**
 * (참조 행 포함) → 본문(양식 항목) → 결재 이력 → 처리(내 차례면 승인·반려, 기안자면 회수).
 *
 * 열람 자격은 RLS(기안자·결재자·참조자·원장)가 정한다 — 못 보는 문서는 조회가 비어 404로 떨어진다
 * ([[#77]]: 화면 조건이 아니라 데이터 게이트가 판정한다).
 */
/** /api/v2/approvals?v2path=/approvals/<id> — 2.0 page가 서버에서 받던 값(문서 · 댓글 · 보는 사람 · 서버에서 다시 위생처리한 본문). */
export type ApprovalDocData = {
  doc: ApprovalDocRow; commentsBox: ApprovalCommentsBox; user: { id: string; systemRole: string };
  html: { reason: string; basic: string; expense: string; income: string };
};
export function ApprovalDocPage({ data }: { data: ApprovalDocData }) {
  const { doc, commentsBox, user } = data;
  const status = docStatusLabel(doc.status);
  const myTurn = isMyTurn(doc, user.id);

  // ── 처리 패널 판정(0216a 특수 결재) — 서버 컴포넌트에서 한 번만 계산한다 ──────
  // 우선순위: 내 차례(turn) → 내가 뒤 차례인데 앞이 전부 미결(후결 넘김) → 원장 대결(proxy).
  // 전결 버튼은 "내 칸 뒤에 살아있는(pending) 단계가 있을 때만" — 마지막 단계면 전결=승인이라 숨긴다.
  const myStep = doc.steps.find((s) => s.approverId === user.id);
  const hasPendingAfter = (stepNo: number) =>
    doc.steps.some((s) => s.stepNo > stepNo && s.decision === "pending");
  let decidePanel: { mode: "turn" | "proxy"; canFinal: boolean; deferTargets: string[] } | null =
    null;
  if (doc.status === "pending") {
    if (myTurn && myStep) {
      decidePanel = { mode: "turn", canFinal: hasPendingAfter(myStep.stepNo), deferTargets: [] };
    } else if (myStep && myStep.decision === "pending" && myStep.stepNo > doc.currentStep) {
      // 내 앞 칸이 전부 미결일 때만 후결 넘김이 성립한다(누가 이미 반려/승인했다면 순차가 정상 진행 중).
      const between = doc.steps.filter(
        (s) => s.stepNo >= doc.currentStep && s.stepNo < myStep.stepNo,
      );
      if (between.length > 0 && between.every((s) => s.decision === "pending")) {
        decidePanel = {
          mode: "turn",
          canFinal: hasPendingAfter(myStep.stepNo),
          deferTargets: between.map((s) => s.approverName),
        };
      }
    } else if (user.systemRole === "master") {
      // 대결 v1 = 원장(master)이 부재자의 현재 차례를 대신 처리(0216a acted_by).
      const current = doc.steps.find((s) => s.stepNo === doc.currentStep);
      if (current && current.decision === "pending" && current.approverId !== user.id) {
        decidePanel = { mode: "proxy", canFinal: hasPendingAfter(current.stepNo), deferTargets: [] };
      }
    }
  }
  // 후결 확인 — 부재로 건너뛰어진 내 칸. 문서가 종결된 뒤에도 남는 사후 확인이다.
  const deferredConfirm = needsMyDeferredConfirm(doc, user.id);

  const canWithdraw =
    doc.drafterId === user.id &&
    doc.status === "pending" &&
    doc.steps.every((s) => s.decision === "pending");
  const leave = doc.leave;
  const timeline = buildTimeline(doc);
  // 사유는 리치 텍스트(HTML)다 — **렌더 직전에 다시 위생처리**한다(저장 때 한 번 걸렀어도 마찬가지).
  // 저장 시점의 선의를 믿고 innerHTML을 그리면 옛 행·직접 INSERT·위생 규칙 변경분이 그대로 새어 나온다.
  const reasonHtml = data.html.reason;
  // 품의서·지출결의서·수입결의서 본문도 같은 규약 — 렌더 직전 재위생처리(저장 시점을 믿지 않는다).
  const basicBodyHtml = data.html.basic;
  const expenseBodyHtml = data.html.expense;
  const incomeBodyHtml = data.html.income;

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4 p-4 md:p-6">
      <Link
        href="/approvals"
        className="text-text-dim hover:text-primary inline-flex items-center gap-1 text-sm font-medium transition print:hidden"
      >
        <ArrowLeft className="size-4" /> 결재함으로
      </Link>

      {/* 문서 — A4 종이 한 장 느낌(흰 판). 배치는 하이웍스 결재 문서 그대로. */}
      <article className="bg-card shadow-card space-y-5 rounded-2xl p-6">
        {/* ① 가운데 큰 표제(양식명) + 문서 제목 — 품의·지출·수입결의서는 제목이 곧 안건명이다. */}
        <header className="space-y-1.5">
          <h1 className="text-foreground text-center text-2xl font-bold tracking-tight">
            {APPROVAL_FORM_LABEL[doc.form] ?? "결재 문서"}
          </h1>
          <p className="text-foreground text-center text-base font-medium break-keep">{doc.title}</p>
        </header>

        {/* ② 정보 격자표 — 문서 종류·번호·기안자·일시·상태(하이웍스 상단 그리드). */}
        <table className="border-line w-full border-collapse border text-sm">
          <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_td]:text-sm">
            <tr>
              <th className="w-[96px]">문서 종류</th>
              <td>공통 · {APPROVAL_FORM_LABEL[doc.form] ?? doc.form}</td>
              <th className="w-[96px]">문서 번호</th>
              <td className="num">{doc.docNo}</td>
            </tr>
            <tr>
              <th>기안자</th>
              <td>
                {doc.drafterName}
                {doc.drafterJobTitle ? (
                  <span className="text-text-faint"> {doc.drafterJobTitle}</span>
                ) : null}
              </td>
              <th>기안 일시</th>
              <td className="num">{fmtTime(doc.submittedAt)}</td>
            </tr>
            <tr>
              <th>상태</th>
              <td>
                <Pill color={status.color}>{status.label}</Pill>
              </td>
              <th>완료 일시</th>
              <td className="num">{fmtTime(doc.completedAt) ?? "—"}</td>
            </tr>
          </tbody>
        </table>

        {/* ③ 결재란 — 원형 도장 표(참조 행 포함). */}
        {/* '결재' 칩은 실제로 처리할 수 있는 사람(결재 패널이 뜬 사람)에게만 버튼이다 —
            기안자·참관자에게 버튼처럼 보이면 "왜 눌러도 안 되지"가 된다(원장 2026-08-18 제보).
            ⚠️ actionable=true는 아래 DecidePanel이 **함께 마운트되는 페이지에서만** 넘길 것 —
            칩은 window 이벤트로 그 패널의 결재 창을 연다(리스너가 없으면 조용히 아무 일도 없다). */}
        <ApprovalStamps doc={doc} actionable={decidePanel !== null} />

        {leave ? (
          <table className="border-line w-full border-collapse border text-sm">
            <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_td]:text-sm">
              <tr>
                <th className="w-[110px]">휴가 종류</th>
                <td>{LEAVE_KIND_LABEL[leave.kind]}</td>
                <th className="w-[110px]">일수</th>
                <td className="num">{formatLeaveDays(leave.days)}</td>
              </tr>
              <tr>
                <th>기간</th>
                <td className="num" colSpan={3}>
                  {leave.startDate}
                  {leave.endDate !== leave.startDate ? ` ~ ${leave.endDate}` : ""}
                </td>
              </tr>
              <tr>
                <th>사유</th>
                <td className="break-keep" colSpan={3}>
                  {reasonHtml ? (
                    // 표·목록이 들어오면 셀보다 넓어질 수 있어 셀 안에서만 가로 스크롤한다.
                    <DragScrollArea>
                      <div
                        className="rich-content"
                        // 🔴 저장 시점 위생처리를 **믿지 않고** 서버에서 한 번 더 통과시킨 값이다(위 reasonHtml).
                        //    옛 행·직접 INSERT·위생 규칙 변경분까지 렌더 직전에 다시 걸러야 XSS 경로가 닫힌다.
                        dangerouslySetInnerHTML={{ __html: reasonHtml }}
                      />
                    </DragScrollArea>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>연차 근거</th>
                <td className="text-text-dim text-sm" colSpan={3}>
                  사용 기간{" "}
                  <span className="num">
                    {leave.periodStart} ~ {leave.periodEnd}
                  </span>{" "}
                  · 부여 <span className="num">{formatLeaveDays(leave.grantedDays)}</span> — 기안
                  시점으로 동결된 값입니다
                </td>
              </tr>
            </tbody>
          </table>
        ) : doc.expense ? (
          <>
            <table className="border-line w-full border-collapse border text-sm">
              <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_td]:text-sm">
                <tr>
                  <th className="w-[110px]">분류</th>
                  <td>{doc.expense.category}</td>
                  <th className="w-[110px]">금액</th>
                  <td>
                    <span className="num">{doc.expense.amount.toLocaleString("ko-KR")}</span>원
                  </td>
                </tr>
                <tr>
                  <th>지출일</th>
                  <td className="num" colSpan={3}>
                    {doc.expense.spendDate}
                  </td>
                </tr>
              </tbody>
            </table>
            {expenseBodyHtml ? (
              <DragScrollArea>
                <div
                  className="rich-content"
                  // 🔴 렌더 직전 재위생처리를 통과한 값만(위 expenseBodyHtml — 사유 렌더와 같은 규약).
                  dangerouslySetInnerHTML={{ __html: expenseBodyHtml }}
                />
              </DragScrollArea>
            ) : null}
          </>
        ) : doc.income ? (
          <>
            <table className="border-line w-full border-collapse border text-sm">
              <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_td]:text-foreground [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_td]:text-sm">
                <tr>
                  <th className="w-[110px]">분류</th>
                  <td>{doc.income.category}</td>
                  <th className="w-[110px]">금액</th>
                  <td>
                    <span className="num">{doc.income.amount.toLocaleString("ko-KR")}</span>원
                  </td>
                </tr>
                <tr>
                  <th>수입일</th>
                  <td className="num" colSpan={3}>
                    {doc.income.incomeDate}
                  </td>
                </tr>
              </tbody>
            </table>
            {incomeBodyHtml ? (
              <DragScrollArea>
                <div
                  className="rich-content"
                  // 🔴 렌더 직전 재위생처리를 통과한 값만(위 incomeBodyHtml — 사유 렌더와 같은 규약).
                  dangerouslySetInnerHTML={{ __html: incomeBodyHtml }}
                />
              </DragScrollArea>
            ) : null}
          </>
        ) : doc.basic ? (
          basicBodyHtml ? (
            <DragScrollArea>
              <div
                className="rich-content"
                // 🔴 렌더 직전 재위생처리를 통과한 값만(위 basicBodyHtml).
                dangerouslySetInnerHTML={{ __html: basicBodyHtml }}
              />
            </DragScrollArea>
          ) : (
            <p className="text-text-faint text-sm">—</p>
          )
        ) : (
          <p className="text-text-faint text-sm">양식 내용을 불러오지 못했습니다.</p>
        )}

        {/* 참조는 결재란 표의 [참조] 행이 담당한다(중복 표시 금지). */}

        {/* 결재 이력 — 기안부터 종결까지 시간순. 결재 의견은 각 줄에 실린다(따로 그리지 않는다). */}
        <section className="border-line space-y-2 border-t pt-4">
          <h2 className="text-foreground text-base font-bold">결재 이력</h2>
          <ol>
            {timeline.map((e, i) => (
              <li key={e.key} className="relative pb-3 pl-5 last:pb-0">
                {i < timeline.length - 1 ? (
                  <span aria-hidden className="border-line absolute top-[14px] bottom-[-2px] left-[4.5px] border-l" />
                ) : null}
                <span
                  aria-hidden
                  className={`absolute top-[4px] left-0 size-[10px] rounded-full ${DOT_TONE[e.tone]}`}
                />
                <p className="text-sm leading-tight">
                  <b className={e.tone === "primary" ? "text-primary" : "text-foreground"}>{e.label}</b>
                  {e.person ? <span className="text-text-dim ml-1.5">{e.person}</span> : null}
                  {e.result ? (
                    <span className={`ml-1.5 font-medium ${TEXT_TONE[e.tone]}`}>{e.result}</span>
                  ) : null}
                  {e.time ? <span className="num text-text-faint ml-2 text-xs">{e.time}</span> : null}
                </p>
                {e.note ? <p className="text-text-dim mt-0.5 text-sm break-keep">{e.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>

        {/* 댓글(0227a) — 하이웍스 개편 전자결재의 '댓글': 전결 사유·보충 설명을 참여자와 공유한다.
            결재 의견(도장에 붙는 처리 의견)과 별개. ready=false(0227a 미적용)면 섹션 자체를 숨긴다. */}
        {commentsBox.ready ? (
          <section className="border-line space-y-2.5 border-t pt-4">
            <h2 className="text-foreground text-base font-bold">
              댓글
              {commentsBox.comments.length > 0 ? (
                // 200 = 조회 상한 — 상한에 닿은 수를 그대로 찍으면 얼어붙은 거짓 건수가 된다([[#89]]).
                <span className="num ml-1">
                  {commentsBox.comments.length >= 200 ? "200+" : commentsBox.comments.length}
                </span>
              ) : null}
            </h2>
            {commentsBox.loadError ? (
              // 실패를 빈 목록으로 위장하지 않는다 — 한글 요약 + 원문은 툴팁([[#109]] 규약).
              <p className="text-danger text-sm" title={commentsBox.loadError.raw}>
                {commentsBox.loadError.summary}
              </p>
            ) : (
              <>
                {commentsBox.comments.length > 0 ? (
                  <ul className="space-y-2">
                    {commentsBox.comments.map((c) => (
                      <li key={c.id} className="border-line rounded-lg border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm leading-tight">
                            <b className="text-foreground">{c.authorName}</b>
                            {c.authorJobTitle ? (
                              <span className="text-text-faint ml-1">{c.authorJobTitle}</span>
                            ) : null}
                            <span className="num text-text-faint ml-2 text-xs">
                              {fmtTime(c.createdAt)}
                            </span>
                          </p>
                          {c.authorId === user.id ? <CommentDeleteForm commentId={c.id} /> : null}
                        </div>
                        <p className="text-foreground mt-1 text-sm break-keep whitespace-pre-wrap">
                          {c.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-text-faint text-sm">
                    아직 댓글이 없습니다 — 전결 사유·보충 설명을 참여자와 공유해 보세요.
                  </p>
                )}
                <CommentForm documentId={doc.id} />
              </>
            )}
          </section>
        ) : null}
      </article>

      {deferredConfirm ? <DeferredConfirmPanel documentId={doc.id} /> : null}
      {decidePanel ? (
        <DecidePanel
          documentId={doc.id}
          mode={decidePanel.mode}
          canFinal={decidePanel.canFinal}
          deferTargets={decidePanel.deferTargets}
        />
      ) : null}
      {canWithdraw ? <WithdrawPanel documentId={doc.id} /> : null}
    </div>
  );
}
