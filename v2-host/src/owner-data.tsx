// 2.0 학원 설정 데이터 정리의 서버 컴포넌트 세 구획에서 JSX 본문을 생성한다.
// 조회와 권한 판정은 /api/v2/owner의 v2-owner-data.mjs가 원본 서버 함수로 수행한다.
"use client";
import { useEffect, useRef, type RefObject } from "react";
import { Pagination } from "@/components/pagination";
import { MERGE_SCOPE_LABEL } from "@/features/admin/merge-scope";
import { CleanupClient } from "@/app/(shell)/admin/cleanup/_client";
import { DuplicatesClient } from "@/app/(shell)/admin/duplicates/_client";
import { LoneSuspects } from "@/app/(shell)/admin/duplicates/suspects";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { studentStatusMeta } from "@/features/students/status/status-labels";
import type { OrphanReport, DuplicateReview, SameNameStudentGroup } from "@/features/admin/server/queries";

export type OwnerData = {
  report: OrphanReport | null;
  review: DuplicateReview;
  groups: SameNameStudentGroup[];
  canManage: boolean;
  canConfirm: boolean;
  duplicateFailed: boolean;
  sameNameFailed: boolean;
};

function DataSection({ d }: { d: OwnerData }) {
  const report = d.report, canManage = d.canManage;
  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 데이터 정리</p>
        <h2 className="text-foreground text-lg font-bold">고아 데이터 점검</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          수강 없는 재원생·스케줄 없는 반 등 정합성이 깨진 데이터를 검출합니다.
        </p>
      </header>
      {report ? (
        <CleanupClient report={report} canManage={canManage} />
      ) : (
        <p role="alert" className="text-danger py-12 text-center text-sm">
          고아 데이터 점검을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요
        </p>
      )}
    </div>
  );
}

function DuplicatesSection({ d, page }: { d: OwnerData; page: number }) {
  const review = d.review, failed = d.duplicateFailed;
  const canManage = d.canManage, canConfirm = d.canConfirm;
  const isEmbed = false;
  const allGroups = review.groups;
  const total = allGroups.length;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const groups = allGroups.slice((page - 1) * 20, page * 20);
  const pageHref = (p: number) => {
    const sp = new URLSearchParams({ tab: "data" });
    if (p > 1) sp.set("page", String(p));
    if (isEmbed) sp.set("embed", "1");
    return `/owner?${sp.toString()}`;
  };
  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 중복 병합</p>
        <h2 className="text-foreground text-lg font-bold">
          중복 의심 학생
          {total > 0 ? (
            <span className="text-muted-foreground num ml-2 text-base font-normal">
              {total}건{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
            </span>
          ) : null}
        </h2>
        {/* 🔴 옮기는 기록은 병합 액션과 **같은 목록**에서 적는다(merge-scope.ts) — "모든 기록"이라고 적지 않는다.
            목록에 없는 기록은 옮겨지지 않고 퇴원 처리된 학생에게 남는다. */}
        <p className="text-muted-foreground mt-1 text-sm">
          이름·학년·학교가 같거나, 이름·학년이 같고 학부모 연락처가 동일하거나, 동기화가 이름 겹침으로
          자동 구분(접미사)한 학생들. 무엇이 같아서 후보인지는 그룹마다 표시됩니다. 통합하면{" "}
          <b>{MERGE_SCOPE_LABEL}</b> 기록이 보존할 학생에게 옮겨지고 나머지 중복 학생은 퇴원 처리됩니다. 그 밖의
          기록(수업 보고서 · 진도 · 레벨테스트 · 교재 요청 등)은 옮겨지지 않고 퇴원 처리된 학생에게 남습니다.
          통합은 되돌릴 수 없습니다.
        </p>
      </header>

      {failed ? (
        <p role="alert" className="text-danger py-12 text-center text-sm">
          중복 의심 학생을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요
        </p>
      ) : total === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {review.loneSuspects.length > 0 ? "병합할 중복 후보는 없습니다" : "중복 의심 학생이 없습니다"}
        </p>
      ) : (
        <>
          <DuplicatesClient groups={groups} canManage={canManage} canConfirm={canConfirm} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
      {!failed && review.loneSuspects.length > 0 ? (
        <LoneSuspects students={review.loneSuspects} canConfirm={canConfirm} />
      ) : null}
    </div>
  );
}

function SameNameSection({ d }: { d: OwnerData }) {
  const groups = d.groups;
  const error = d.sameNameFailed ? "같은 이름 점검을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" : null;
  const total = groups.length;
  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 이름 구분</p>
        <h2 className="text-foreground text-lg font-bold">
          같은 이름을 쓰는 학생
          {total > 0 ? (
            <span className="text-muted-foreground num ml-2 text-base font-normal">{total}건</span>
          ) : null}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          학교·학년이 달라 위 &lsquo;중복 의심&rsquo;에는 안 걸리지만 목록에서 이름이 똑같이 보이는
          학생들입니다. 같은 사람이면 위에서 통합하고, 다른 사람이면 학생 상세에서 이름을 구분해 주세요
          (예: 이지호A · 이지호B). 여기서 이름을 바꾸지는 않습니다.
        </p>
      </header>

      {error ? (
        <p className="text-danger py-12 text-center text-sm">{error}</p>
      ) : total === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">같은 이름을 쓰는 학생이 없습니다</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key} className="bg-card border-border rounded-md border p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h3 className="text-foreground text-sm font-bold">{g.name}</h3>
                <span className="text-muted-foreground num text-xs">{g.students.length}명</span>
              </header>
              <ul className="space-y-1.5">
                {g.students.map((s) => {
                  const meta = studentStatusMeta(s.status);
                  const where = schoolGradeLabel(s.school, s.grade);
                  return (
                    <li
                      key={s.id}
                      className="bg-bg-soft/30 border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border px-3 py-1.5 text-xs"
                    >
                      {/* 이름은 창으로 — 이 화면의 다른 링크와 같은 방식(WindowLink 규약). */}
                      <WindowLink
                        href={`/students/${s.id}`}
                        title={s.name}
                        className="text-foreground hover:text-primary font-medium underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </WindowLink>
                      <span className="text-muted-foreground">{where || "학교·학년 없음"}</span>
                      {meta ? (
                        <Pill color={meta.color}>{meta.label}</Pill>
                      ) : null}
                      <span className="text-muted-foreground">
                        {s.subjects.length > 0 ? s.subjects.join(" · ") : "수업 없음"}
                      </span>
                      <span className="text-muted-foreground num ml-auto">
                        {s.parentPhone?.trim() || "연락처 없음"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 원본 정리 목록의 높이 제한 스크롤에 위치별 페이드와 숨긴 스크롤바를 적용한다. */
function useCleanupScroll(root: RefObject<HTMLDivElement | null>, report: OrphanReport | null) {
  useEffect(() => {
    const lists = [...(root.current?.querySelectorAll<HTMLElement>("ul.max-h-72.overflow-auto") ?? [])];
    const cleanups = lists.map(el => {
      el.classList.add("scrollbar-hide");
      const update = () => {
        const top = el.scrollTop > 1 ? 14 : 0;
        const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? 14 : 0;
        el.style.maskImage = `linear-gradient(to bottom, transparent 0, black ${top}px, black calc(100% - ${bottom}px), transparent 100%)`;
      };
      const resize = new ResizeObserver(update);
      const mutation = new MutationObserver(update);
      resize.observe(el); mutation.observe(el, { childList: true, subtree: true });
      el.addEventListener("scroll", update, { passive: true });
      update();
      return () => { resize.disconnect(); mutation.disconnect(); el.removeEventListener("scroll", update); el.classList.remove("scrollbar-hide"); el.style.maskImage = ""; };
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, [root, report]);
}

export function OwnerDataFace({ d, page }: { d: OwnerData; page: number }) {
  const root = useRef<HTMLDivElement>(null);
  useCleanupScroll(root, d.report);
  return <div ref={root} className="space-y-8"><DataSection d={d} /><DuplicatesSection d={d} page={page} /><SameNameSection d={d} /></div>;
}
