// 2.0 AuditFace의 JSX를 원본에서 생성. 서버 조회는 v2-owner-audit.mjs가 원본 함수를 실행한다.
import { ScrollText } from "@/components/icons/aywa-icon-compat";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { EmbedAnchor, EmbedHiddenInput } from "@/components/embed-link";
import { EmptyState } from "@/components/empty-state";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { auditActorName, auditDetail, auditTargetLabel, auditTargetName, AUDIT_TYPE_LABEL } from "@/features/audit/describe";
import { buildSubjectMaps } from "@/features/owner/subjects";
import actionLabels from "./owner-audit-actions.json";
import { hostNavigate } from "../shims/host-nav";

export type OwnerAuditData = {
  rows: Array<{ id: string; actorName: string | null; action: string; targetType: string | null;
    targetLabel: string | null; metadata: Record<string, unknown> | null; createdAt: string }>;
  total: number;
  error?: string;
  nameLookupTruncated?: boolean;
  names: Record<string, string>;
  subjects: Parameters<typeof buildSubjectMaps>[0];
};
const AUDIT_ACTIONS: Record<string, string> = actionLabels;
const auditActionLabel = (action: string) => AUDIT_ACTIONS[action] ?? '기타 작업';

const PAGE_SIZE = 50;

const ACTION_COLOR: Record<string, PillColor> = {
  staff_role_change: "amber",
  staff_delete: "danger",
  invoice_create: "primary",
  exam_create: "blue",
  exam_delete: "danger",
  exam_scores: "blue",
  payroll_upsert: "purple",
  withdrawal_update: "rose",
};

const ACTION_FILTERS = Object.entries(AUDIT_ACTIONS).map(([value, label]) => ({ value, label }));

function fmtTime(iso: string): string {
  // ⚠️ 시각은 KST 고정 — 서버(Vercel=UTC) 렌더라 timeZone 안 박으면 UTC로 나온다(makeedu-sync-runs.tsx 동일 경고).
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}


const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function OwnerAuditFace({ d, sp }: { d: OwnerAuditData; sp: Record<string, string | undefined> }) {
  const action = sp.action;
  const q = sp.q;
  const from = sp.from;
  const to = sp.to;
  const page = Math.max(1, Number(sp.page) || 1);
  const isEmbed = true;
  const query = (typeof q === "string" ? q : "").trim();
  let dateFrom = typeof from === "string" && YMD_RE.test(from) ? from : undefined;
  let dateTo = typeof to === "string" && YMD_RE.test(to) ? to : undefined;
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const { rows: logs, total, error: queryError, nameLookupTruncated } = d;
  const names = new Map(Object.entries(d.names));
  const subjects = buildSubjectMaps(d.subjects);
  const nameOf = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? null) : null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams({ tab: "audit" });
    if (action && action !== "all") params.set("action", action);
    if (query) params.set("q", query);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (p > 1) params.set("page", String(p));
    if (isEmbed) params.set("embed", "1");
    return `/owner?${params.toString()}`;
  };
  return (
    <div className="space-y-4">
      {/* Editorial 문법 ① — 구분선 대신 여백 리듬(문법 ⑥) */}
      <header>
        <p className="editorial-eyebrow">관리 · 운영 감사로그</p>
        <h2 className="text-foreground mt-1 text-lg font-bold">작업 이력</h2>
      </header>

      {/* ⚠️ 툴바엔 카드 껍데기를 두지 않는다(앱 전역 툴바 규약). */}
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        <span className="micro shrink-0">액션</span>
        <FilterSelect
          paramName="action"
          triggerClassName={TOOLBAR_SELECT}
          value={action ?? null}
          options={ACTION_FILTERS}
          ariaLabel="액션 필터"
        />
        {/* 텍스트+기간 검색(GET) — 서버 컴포넌트라 클라 JS 없이 폼 제출로 필터. tab·embed·action은
            hidden으로 동행(안 실으면 제출 순간 audit 면·창 모드·액션 필터가 풀린다). 페이지는 1로 리셋.
            ⚠️ embed는 서버의 isEmbed가 아니라 `EmbedHiddenInput`(클라 판정) — embed 없이 소프트 이동으로 들어온
            첫 렌더에선 isEmbed가 거짓이라 제출이 창 안에 전체 셸을 연다(전수검사 2026-09-11). */}
        <form method="get" action="/owner" className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const params = new URLSearchParams();
            for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value) params.set(key, value);
            hostNavigate(`/owner?${params.toString()}`);
          }}>
          <input type="hidden" name="tab" value="audit" />
          <EmbedHiddenInput />
          {action && action !== "all" ? <input type="hidden" name="action" value={action} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="이름·실행자·액션 검색"
            aria-label="감사로그 텍스트 검색"
            className="border-line bg-bg-soft text-foreground placeholder:text-text-faint h-8 w-44 rounded-lg border px-2.5 text-xs outline-none focus:border-primary"
          />
          <input
            type="date"
            name="from"
            defaultValue={dateFrom ?? ""}
            aria-label="검색 시작일"
            className="border-line bg-bg-soft text-foreground num h-8 rounded-lg border px-2 text-xs outline-none focus:border-primary"
          />
          <span className="text-text-faint text-xs">~</span>
          <input
            type="date"
            name="to"
            defaultValue={dateTo ?? ""}
            aria-label="검색 종료일"
            className="border-line bg-bg-soft text-foreground num h-8 rounded-lg border px-2 text-xs outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft h-8 rounded-lg border px-3 text-xs transition"
          >
            검색
          </button>
          {query || dateFrom || dateTo ? (
            <EmbedAnchor
              href={`/owner?tab=audit${action && action !== "all" ? `&action=${action}` : ""}`}
              className="text-text-faint hover:text-foreground text-xs underline-offset-2 hover:underline"
            >
              초기화
            </EmbedAnchor>
          ) : null}
        </form>
        <span className="text-text-faint num ml-auto text-xs">
          {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
        </span>
      </div>

      {/* 🔴 조회 실패는 "0건"으로 위장하지 않는다(#89) — 한글 배너 + 원문은 title 툴팁(raw 노출 금지 규칙). */}
      {queryError ? (
        <div
          className="border-danger/30 bg-danger/5 text-danger rounded-2xl border px-4 py-3 text-sm"
          title={queryError}
        >
          감사로그 조회 중 오류가 발생했어요 — 아래 결과가 비었거나 불완전할 수 있습니다. 잠시 후 다시 시도해 주세요.
        </div>
      ) : nameLookupTruncated ? (
        <div className="border-line bg-bg-soft text-text-dim rounded-2xl border px-4 py-3 text-sm">
          이름이 일치하는 학생·직원이 많아 일부만 검색에 반영됐어요 — 성과 이름을 더 구체적으로 입력해 보세요.
        </div>
      ) : null}

      {total === 0 ? (
        <EmptyState
          image="audit"
          icon={() => <ScrollText size={32} strokeWidth={1.8} />}
          title={
            query || dateFrom || dateTo || (action && action !== "all")
              ? "조건에 맞는 기록이 없습니다"
              : "기록된 작업이 없습니다"
          }
          description={
            query || dateFrom || dateTo || (action && action !== "all")
              ? "검색어·기간·액션 필터를 조정해 보세요."
              : "역할 변경·삭제·청구서·시험·급여 등 주요 작업이 발생하면 여기에 기록됩니다."
          }
        />
      ) : (
        <>
          <DragScrollArea className="bg-card shadow-card rounded-2xl">
            <table className="w-full text-xs [&_td]:whitespace-nowrap">
              <thead>
                <tr className="bg-bg-soft text-text-dim border-line border-b [&_th]:whitespace-nowrap">
                  <th className="px-4 py-2 text-left font-bold">시각</th>
                  <th className="px-4 py-2 text-left font-bold">실행자</th>
                  <th className="px-4 py-2 text-left font-bold">액션</th>
                  <th className="px-4 py-2 text-left font-bold">대상</th>
                  <th className="px-4 py-2 text-left font-bold">상세</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {logs.map((log) => {
                  // 대상 = 유형(접두) + 라벨. 라벨은 설정 키·과목 키·uuid만 한글/생략으로 접고 나머지는 원문.
                  const folded = auditTargetLabel(log.targetType, log.targetLabel, {
                    subjectLabel: subjects.labelOf,
                  });
                  const targetLabel = folded ?? auditTargetName(log.metadata, nameOf);
                  // 툴팁은 **접었을 때만** — 사람 이름에까지 같은 값을 붙이면 온 행이 툴팁 밭이 된다.
                  const actorName = auditActorName(log.actorName);
                  return (
                  <tr key={log.id} className="hover:bg-bg-soft/50">
                    <td className="text-text-dim num px-4 py-2.5 text-xs">{fmtTime(log.createdAt)}</td>
                    {/* 실행자 — 운영 스크립트가 남긴 `system:*` 식별자는 한글로(원문은 툴팁) */}
                    <td
                      className="text-text-dim px-4 py-2.5"
                      title={actorName !== log.actorName ? (log.actorName ?? undefined) : undefined}
                    >
                      {actorName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill color={ACTION_COLOR[log.action] ?? "neutral"} soft>
                        {auditActionLabel(log.action)}
                      </Pill>
                    </td>
                    {/* 위계: 액션(Pill bold) > 대상 dim — 행에서 액션이 먼저 읽히게.
                        🔴 유형 접두와 이름은 **붙어 보이면 안 된다**(원장 제보: "직원이다교"로 읽혔다) —
                        테두리 토큰으로 또렷이 분리(팔레트 v4 "구분은 테두리"). 접은 원문은 title 툴팁에. */}
                    <td
                      className="text-text-dim px-4 py-2.5"
                      title={folded !== log.targetLabel ? (log.targetLabel ?? undefined) : undefined}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {log.targetType ? (
                          <span className="border-line text-text-faint rounded-full border px-1.5 py-px text-xs">
                            {AUDIT_TYPE_LABEL[log.targetType] ?? "기타"}
                          </span>
                        ) : null}
                        <span>{targetLabel ?? "—"}</span>
                      </span>
                    </td>
                    {/* 상세 = 한글 요약, 원문 JSON은 title 툴팁으로만(raw 노출 금지 규칙) */}
                    <td
                      className="text-text-dim px-4 py-2.5 text-xs"
                      title={log.metadata ? JSON.stringify(log.metadata) : undefined}
                    >
                      <span className="inline-block max-w-[420px] truncate align-bottom">
                        {auditDetail(log.action, log.metadata, { nameOf, subjectLabel: subjects.labelOf }) ?? "—"}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </DragScrollArea>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
