// 2.0 직원 평가 상세(app/(shell)/class-review/[id]/page.tsx)의 조립 — 조회(getClassReview · getReviewPrivileges · getReviewViewer · canWriteTenant ·
// getStaffOptions)와 서버 전용 모듈의 순수 함수(observerColumns · myScoreSlot · observerLimitOf)는 /api/v2/class-review?v2path=/class-review/<id>가
// 2.0 함수로 하고 본문은 **글자 그대로**(class-review-detail.swaps.json 짝만). 없는 평가지(2.0 notFound)는 진입점이 알린다.
// 🔴 실명 열람 자격이 없으면 서버가 평가자 이름을 비워 보낸다(2.0 화면은 '평가자 A/B/C'로만 그린다 — 평가자 관리 창이 열리는 사람은 2.0처럼 이름이 간다).
import Link from "next/link";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { Pill } from "@/components/atoms/pill";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { Button } from "@/components/ui/button";
import { DeleteReviewButton } from "@/app/(shell)/class-review/_components/delete-review-button";
import { ObserverManager } from "@/app/(shell)/class-review/_components/observer-manager";
import { FinalReviewPanel } from "@/app/(shell)/class-review/_components/final-review-panel";
import { kstDateOf } from "@/lib/date-kst";
import type { StaffOption } from "@/features/meetings/server/queries";
import type { ReviewDoc, ReviewViewer } from "@/features/class-review/server/queries";
import { averageTotals, computeTotals, itemCountOf, normalizeScore, type ChecklistArea } from "@/features/class-review/checklist";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

/** /api/v2/class-review?v2path=/class-review/<id> — 2.0 page가 서버에서 받던 값. */
export type ClassReviewDetailData = {
  found: { doc: ReviewDoc; areas: ChecklistArea[] };
  settings: { operations: { subjects: SubjectSetting[] } };
  priv: { seeNames: boolean; editTemplate: boolean; writeFinalReview: boolean; seePortfolio: boolean };
  canWrite: boolean; rv: ReviewViewer; staffOptions: StaffOption[];
  observerCols: { slot: string; name: string }[]; mine: { slot: string; submitted: boolean } | null; observerLimit: number;
};

/**
 * 참관 상세 — 시트 모양의 문항×평가자 매트릭스 + 영역 소계 + 총점/환산/등급 + 내 채점.
 * 평가자 실명은 **원장·지정 인원만**(원장 지시 2026-08-04) — 그 외는 '평가자 A/B/C'로 익명화.
 * 디자인은 구조·위계 위주(원장 2026-08-05 "색칠 말고") — 스탯은 공용 BigStat, 표는 소프트 패널.
 *
 * 강사 직급은 **자기 평가 전용**(원장 2026-08-19): 남의 평가지는 애초에 조회가 안 되고(getClassReview),
 * 본인 평가지도 본인 채점 한 장만 내려온다. 그래서 이 화면의 '평균'·'종합'은 강사에게 **본인 점수와
 * 같은 수**다 — 그대로 두면 평가자 채점이 반영된 종합 결과로 오해하므로 라벨·열을 갈아 끼운다.
 */
export function ClassReviewDetailPage({ data }: { data: ClassReviewDetailData }) {
  // 자기 평가 전용 판정·채점 슬롯 판정 주체 — '다른 강사 뷰'면 그 강사의 눈으로 본다(#77 단일 소스).
  const [found, settings, priv, canWrite, rv] = [data.found, data.settings, data.priv, data.canWrite, data.rv];
  const selfOnly = rv.selfOnly;
  // 강사는 본인 평가지라도 삭제 불가(인사 기록) — 서버 액션과 같은 조건으로 버튼을 감춘다.
  const canDelete = canWrite && !selfOnly;
  if (!found) return null;
  const { doc, areas } = found;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const openMode = doc.header.observerMode === "open";

  // 평가자 관리(지정 모드 · 사무실 · 비-강사) — 미채점 평가자를 교체(원장 2026-08-21).
  // 후보 명단은 이 조건일 때만 조회한다(불필요한 라운드트립·강사 화면 누수 방지).
  const canManageObservers = canWrite && !selfOnly && !openMode;
  const staffOptions = canManageObservers ? data.staffOptions : [];

  // 열 = 관찰자들(지정 순서 또는 선착순 제출 순서) + 본인. 익명화 시 관찰자 이름 → 평가자 A/B/C.
  const anon = (i: number) => `평가자 ${String.fromCharCode(65 + i)}`;
  const observerCols = data.observerCols.map((c, i) => ({
    slot: c.slot,
    label: priv.seeNames ? c.name : anon(i),
  }));
  // 선착순 모드: 아직 안 찬 슬롯을 빈 열로 보여준다(자리가 남았음이 보이게).
  // 정원은 문서마다 다르다(생성 시 선택) — 고정 상수로 되돌리면 5명짜리에 빈 칸이 3개만 그려진다.
  // ⚠️ 화면 문구에도 이 값을 쓸 것. 빈 칸 수만 고치고 라벨에 "3명"을 남기면 칸은 4개인데 글자는 3명이 된다.
  const observerLimit = data.observerLimit;
  const emptyOpenSlots = openMode ? Math.max(0, observerLimit - observerCols.length) : 0;
  const cols = [
    ...observerCols,
    ...Array.from({ length: emptyOpenSlots }, (_, i) => ({
      slot: `__empty${i}`,
      label: anon(observerCols.length + i),
    })),
    { slot: "self", label: "본인" },
  ].map((c) => {
    const sheet = c.slot.startsWith("__empty") ? null : (doc.submissions[c.slot] ?? null);
    return { ...c, sheet, totals: computeTotals(sheet, areas) };
  });
  const avg = averageTotals(
    cols.filter((c) => !c.slot.startsWith("__empty")).map((c) => c.sheet ?? { scores: [] }),
    areas,
  );

  // 내 채점 자격(공용 헬퍼) — 있으면 헤더에 평가하기/수정하기 버튼(채점은 별도 페이지, 원장 지시 2026-08-04).
  const mine = data.mine;

  // 채점이 실제로 들어온 열 수 — 상단 '제출' 스탯과 삭제 확인 문구가 같은 수를 쓴다("몇 명 것이 사라지나").
  const submittedCount = cols.filter((c) => c.totals.answered > 0).length;
  // 강사(자기 평가 전용)에겐 '평균' 열이 본인 점수를 한 번 더 그릴 뿐이라 숨긴다.
  // 🔴 조건을 `cols.length > 1`로 넓히지 말 것 — 관찰자 0명인 사무실 문서의 표 모양까지 바뀐다
  //    (이번 지시 범위는 강사 화면뿐이다).
  const showAvgCol = !selfOnly;

  const headerBits = [
    doc.header.subject ? subjects.labelOf(doc.header.subject) : null,
    // 평가자 방식(지정/선착순)은 강사에게 숨긴다 — "몇 명이 나를 평가하는지"도 인사 정보다.
    selfOnly ? null : openMode ? `선착순 ${observerLimit}명` : "평가자 지정",
    doc.templateName ?? null,
  ].filter(Boolean);

  return (
    <div className="w-full min-w-0 space-y-5 p-6">
      <div>
        <Link
          href="/class-review"
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 목록으로
        </Link>
        <PageHeader
          eyebrow="직원 평가"
          title={`${doc.header.teacherName} · ${doc.header.date}`}
          description={headerBits.join(" · ")}
          embedLabel={`직원 평가 — ${doc.header.teacherName}`}
          actions={
            mine || canDelete ? (
              <span className="flex flex-wrap items-center gap-2">
                {mine ? (
                  <Button render={<Link href={`/class-review/${doc.id}/score`} />}>
                    {mine.submitted ? "내 평가 수정하기" : "평가하기"}
                  </Button>
                ) : null}
                {canDelete ? (
                  <DeleteReviewButton
                    docId={doc.id}
                    teacherName={doc.header.teacherName}
                    date={doc.header.date}
                    submittedCount={submittedCount}
                  />
                ) : null}
              </span>
            ) : undefined
          }
        />
      </div>

      {/* 강사(자기 평가 전용) — 화면에 본인 것만 있다는 사실을 먼저 말한다(점수를 종합으로 오해하지 않게). */}
      {selfOnly ? (
        <p className="bg-bg-soft/60 text-text-dim rounded-2xl px-4 py-3 text-sm">
          본인 평가만 표시됩니다 — 평가자 채점과 종합 결과는 사무실에서 관리합니다.
        </p>
      ) : null}

      {/* 종합 — 평균 기준 빅 스탯(공용 아톰, 화면 로컬 Stat 금지 규칙) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {selfOnly ? (
          <BigStat
            label="본인 평가"
            value={submittedCount > 0 ? "제출됨" : "미제출"}
            sub={submittedCount > 0 ? "본인 채점" : "아직 작성 전"}
          />
        ) : (
          <BigStat label="제출" value={submittedCount} unit={`/ ${cols.length}`} sub="평가자 + 본인" />
        )}
        <BigStat
          label={selfOnly ? "총점(본인)" : "총점(평균)"}
          value={avg ? avg.total : "—"}
          unit={`/ ${itemCountOf(areas) * 4}`}
          sub={selfOnly ? "본인 채점 기준" : "제출된 채점 평균"}
        />
        <BigStat
          label="환산점수"
          value={avg ? avg.percent.toFixed(1) : "—"}
          unit="/ 100"
          sub={selfOnly ? "본인 평가 기준" : "100점 환산"}
        />
        <BigStat
          label={selfOnly ? "본인 평가 등급" : "종합 등급"}
          value={avg ? avg.grade : "—"}
          sub={
            selfOnly
              ? "최종 등급은 사무실에서 확정합니다"
              : avg?.grade === "재참관"
                ? "기준 미달 — 재참관 대상"
                : "등급 컷 기준"
          }
          valueClass={avg?.grade === "재참관" ? "text-danger" : undefined}
        />
      </div>

      {/* 문항 × 평가자 매트릭스 */}
      <DragScrollArea className="bg-card rounded-2xl shadow-card">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-line bg-bg-soft/60 border-b text-left">
              <th className="text-text-dim w-10 px-3 py-2.5 text-xs font-medium">No.</th>
              <th className="text-text-dim px-3 py-2.5 text-xs font-medium">평가항목</th>
              {cols.map((c) => (
                <th key={c.slot} className="w-20 px-2 py-2.5 text-center text-xs font-medium">
                  <span className="text-foreground font-bold">{c.label}</span>
                  {c.totals.answered === 0 ? (
                    <span className="text-text-dim block text-xs font-normal">미제출</span>
                  ) : null}
                </th>
              ))}
              {showAvgCol ? (
                <th className="text-text-dim bg-bg-soft/40 w-16 px-2 py-2.5 text-center text-xs font-medium">
                  평균
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {areas.map((area, ai) => {
              const base = areas.slice(0, ai).reduce((n, a) => n + a.items.length, 0);
              return [
                <tr key={area.key} className="border-line/60 bg-bg-soft/50 border-y">
                  {/* colSpan = No. + 평가항목 + 채점 열들 (+ 평균 열이 있으면 하나 더) */}
                  <td colSpan={cols.length + (showAvgCol ? 3 : 2)} className="px-3 py-2">
                    <span className="text-foreground text-xs font-bold">{area.title}</span>
                    <span className="text-text-dim ml-2 text-xs">
                      소계 {cols.map((c) => c.totals.areaSubtotals[ai]).join(" · ")}
                      {showAvgCol && avg ? ` · 평균 ${avg.areaSubtotals[ai]}` : ""}
                    </span>
                  </td>
                </tr>,
                ...area.items.map((item, i) => {
                  const qi = base + i;
                  const rowVals = cols.map((c) => normalizeScore(c.sheet?.scores?.[qi]));
                  const done = rowVals.filter((v) => v > 0);
                  const rowAvg = done.length
                    ? Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10
                    : null;
                  return (
                    <tr key={`${area.key}-${i}`} className="border-line/50 border-b last:border-0">
                      <td className="num text-text-dim px-3 py-2.5">{qi + 1}</td>
                      <td className="px-3 py-2.5 leading-relaxed break-keep">{item}</td>
                      {rowVals.map((v, ci) => (
                        <td
                          key={ci}
                          className={`num px-2 py-2.5 text-center ${
                            v === 0 ? "text-text-dim/50" : v <= 2 ? "text-danger font-bold" : "font-medium"
                          }`}
                        >
                          {v || "—"}
                        </td>
                      ))}
                      {showAvgCol ? (
                        <td className="num bg-bg-soft/40 px-2 py-2.5 text-center font-bold">{rowAvg ?? "—"}</td>
                      ) : null}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="border-line bg-bg-soft/60 border-t">
              <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-bold">
                총점 ({itemCountOf(areas) * 4}점)
              </td>
              {cols.map((c) => (
                <td key={c.slot} className="num px-2 py-2.5 text-center font-bold">
                  {c.totals.answered > 0 ? c.totals.total : "—"}
                </td>
              ))}
              {showAvgCol ? (
                <td className="num bg-bg-soft/40 px-2 py-2.5 text-center font-bold">{avg ? avg.total : "—"}</td>
              ) : null}
            </tr>
            <tr className="border-line bg-bg-soft/40 border-t">
              <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-bold">
                환산 (100점) · 등급
              </td>
              {cols.map((c) => (
                <td key={c.slot} className="num px-2 py-2.5 text-center">
                  {c.totals.answered > 0 ? (
                    <>
                      <span className="font-bold">{c.totals.percent.toFixed(1)}</span>{" "}
                      <Pill color={c.totals.grade === "재참관" ? "danger" : "primary"} soft>
                        {c.totals.grade}
                      </Pill>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
              {showAvgCol ? (
                <td className="num bg-bg-soft/40 px-2 py-2.5 text-center">
                  {avg ? (
                    <>
                      <span className="font-bold">{avg.percent.toFixed(1)}</span>{" "}
                      <Pill color={avg.grade === "재참관" ? "danger" : "primary"} soft>
                        {avg.grade}
                      </Pill>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </DragScrollArea>

      {/* 평가자 관리(지정 모드) — 미채점 평가자 교체. 서버 액션이 같은 조건·미채점 여부를 재검증한다(#77). */}
      {canManageObservers ? (
        <ObserverManager
          docId={doc.id}
          teacherId={doc.header.teacherId}
          observers={data.observerCols.map((c) => ({
            id: c.slot,
            name: c.name,
            submitted: !!doc.submissions[c.slot]?.scores?.some((v) => v > 0),
          }))}
          staff={staffOptions.map((s) => ({ value: s.id, label: s.name }))}
        />
      ) : null}

      {/* 평가자 코멘트 — 이름 익명화 규칙 동일, 인용 스타일(구조로 구분) */}
      {cols.some((c) => c.sheet?.comment) ? (
        <div className="bg-card rounded-2xl p-5 shadow-card">
          <p className="micro mb-3">{selfOnly ? "내 코멘트" : "평가자 코멘트"}</p>
          <ul className="space-y-3">
            {cols
              .filter((c) => c.sheet?.comment)
              .map((c) => (
                <li key={c.slot}>
                  <p className="text-foreground text-xs font-bold">{c.label}</p>
                  <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">{c.sheet!.comment}</p>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {/* 최종 총평 — 평가지당 하나(원장 2026-09-29). 작성 = 원장·지정 인원(서버 액션이 같은 판정을 재검증, #77).
          작성자 이름은 실명 열람 자격자에게만(평가자 익명화와 같은 규칙).
          강사에겐 조회 초크포인트에서 이미 잘려 오므로(redactForSelfOnly) 여기선 빈 값이라 안 그려진다. */}
      <FinalReviewPanel
        docId={doc.id}
        initialText={doc.finalReview?.text ?? ""}
        meta={
          doc.finalReview
            ? [priv.seeNames ? doc.finalReview.by.name || null : null, kstDateOf(doc.finalReview.updatedAt)]
                .filter(Boolean)
                .join(" · ") || null
            : null
        }
        editable={canWrite && priv.writeFinalReview}
      />

      {/* 채점은 별도 페이지(/score) — 상세는 보기 전용(원장 지시 2026-08-04). */}
      {mine ? (
        <div className="bg-bg-soft/40 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <p className="text-text-dim text-sm">
            {mine.submitted
              ? "내 채점이 저장돼 있습니다 — 필요하면 수정할 수 있습니다."
              : mine.slot === "self"
                ? "본인 평가가 아직 없습니다 — 지금 채점해 주세요."
                : "내 채점이 아직 없습니다 — 수업 내용을 채점해 주세요."}
          </p>
          <Button render={<Link href={`/class-review/${doc.id}/score`} />}>
            {mine.submitted ? "내 평가 수정하기" : "평가하기"}
          </Button>
        </div>
      ) : selfOnly ? null : ( // 강사는 본인 평가지만 열리므로 '평가자로 지정되지 않았다'는 안내가 나올 일이 없다
        <p className="text-text-dim text-xs">
          {openMode
            ? `선착순 평가자 ${observerLimit}명이 이미 채점을 마쳐 열람만 가능합니다.`
            : "이 평가 건의 평가자로 지정되어 있지 않아 채점은 열람만 가능합니다."}
        </p>
      )}
    </div>
  );
}
