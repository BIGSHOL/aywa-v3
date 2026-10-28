// 2.0 makeedu 동기화 배지(components/makeedu-sync-badge.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회 둘(getMakeeduSyncState ·
// 학원 설정 열람 권한)은 props로 받고 나머지는 **글자 그대로** 옮겼다(billing-page.swaps.json "badge" 짝). 화면 언어 = 한국어(사무실 화면).
import type { ReactNode } from "react";
import type { MakeeduSyncDomain, MakeeduSyncState } from "@/features/integrations/server/makeedu-sync";
import { EyIcon } from "@/components/icons/aywa-icons";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { WindowLink } from "@/components/workspace/window-link";
import { DismissibleDetails } from "@/components/dismissible-details";
import { humanizeMakeeduSyncError } from "@/features/integrations/sync-error";

/**
 * "N분 전" — 상대 시각. 🔴 **언어를 인자로 받는다**(전역 기본값은 한국어라 사무실은 불변).
 * 7일이 넘으면 절대 날짜로 떨어지는데, 그때 로케일도 함께 따라간다.
 */
function relativeSince(iso: string, lang: SheetLang): string {
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return sheetT(lang, "sync.justNow");
  if (min < 60) return sheetTf(lang, "sync.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return sheetTf(lang, "sync.hourAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return sheetTf(lang, "sync.dayAgo", { n: day });
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul",
  });
}
/** 툴팁의 절대 시각 — 🔴 시간대는 언제나 KST다(로케일만 언어를 따른다). */
function fullSince(iso: string, lang: SheetLang): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * makeedu 동기화 화면 상단의 "마지막 동기화: N분 전" 배지 (서버 컴포넌트).
 * 도메인마다 동기화 주기가 달라 각 화면이 자기 도메인의 시각을 표시한다. 동기화 이력 없으면 미표시
 * (= makeedu 연동이 없는 테넌트엔 버튼도 안 뜬다).
 *
 * 🔴 옛 '지금 동기화' 버튼은 **없앴다**(원장 2026-09-01: *"지금 동기화 삭제해버려 … 필요없다"*).
 * 동기화는 담당 PC 워처가 스스로 돌고(정방향은 스케줄러, 역방향은 매주 일요일 06:00) 손으로 돌릴 일이
 * 남으면 **연동 면(/owner)의 동기화 카드**가 그 자리다 — 목록 화면마다 같은 버튼을 두면 "눌러야 하나"가
 * 된다. 경고는 이 자리에서 펼쳐 읽고, 점검·실행은 연동 면으로 안내한다.
 * ⚠️ 되살릴 땐 이 배지가 아니라 연동 면에서.
 *
 * 🔑 화면 언어는 **여기서 직접 읽는다**(async 서버 컴포넌트라 안전) — 이 배지는 목록 화면 5곳이
 *    같은 모양으로 쓰므로 화면마다 prop을 배선하면 한 곳만 빠뜨려도 그 화면만 한글로 남는다.
 *    `getTeacherViewLang()`은 강사 미니셸이 아니면 한국어를 돌려주니 사무실 화면은 불변이다.
 *
 * `overlay` = 경고 상세를 **배지 아래에 띄운다**(흐름에서 뺀다) — 배지가 면 탭과 한 줄을 나눠 쓰는 화면(수납관리)용.
 *   흐름 안에서 펼치면 상자 폭만큼 배지 칸이 넓어져 줄이 넘어가고, 방금 누른 배지가 탭 아래 줄로 옮겨 간다(2026-10-15).
 *   ⚠️ 띄운 상자의 바탕은 불투명(카드) 위에 경고색 — `amber-soft`는 반투명이라 아래 표가 비친다(#74).
 *   ⚠️ 띄운 상자는 아래 툴바를 덮으므로 바깥 클릭·Esc로도 닫힌다(`DismissibleDetails`) · 겹침은 z-20(F1 도움말 막 z-30 아래).
 */
export function MakeeduSyncBadge({ domain, overlay = false, state, canManage: canManageOwner }: { domain: MakeeduSyncDomain; overlay?: boolean; state: MakeeduSyncState | null; canManage: boolean }) {
  const lang: SheetLang = "ko";
  if (!state) return null;
  const failed = state.status !== "ok";
  // status='ok'인데 이슈 요약이 있는 경우 = "동기화는 됐지만 반영 못 한 게 있다"(삭제 보류·학생 미매칭 등).
  // 실패와는 다른 축이라 amber '확인 필요'로 구분해 보여준다 — 예전엔 이 값이 화면에 전혀 안 나와서
  // 유령 미수가 '정상' 배지 뒤에 숨었다(2026-07-30 적대 리뷰).
  // ⚠️ `issue`는 워커가 쓴 **한국어 사실 문장**이라 번역하지 않는다(특이사항과 같은 축).
  const issue = !failed && state.issue ? state.issue : null;
  const tone = failed
    ? "text-[color:var(--danger)]"
    : issue
      ? "text-[color:var(--amber)]"
      : "text-[color:var(--text-faint)]";
  const badge = (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${issue || failed ? tone : "text-[color:var(--text-faint)]"}`}
        title={`${sheetTf(lang, "sync.title", { when: fullSince(state.syncedAt, lang) })}${
          state.rowCount != null ? sheetTf(lang, "sync.titleRows", { n: state.rowCount }) : ""
        }${state.issue ? sheetTf(lang, "sync.titleIssue", { issue: state.issue }) : ""}`}
      >
        {/* 🔴 예전엔 텍스트 글리프 `↻`(U+21BB)였다 — Pretendard 서브셋에 없는 PC에서 두부(□)로
            깨졌다(원장 2026-08-05 제보). 아이콘 자리엔 항상 EyIcon을 쓴다. */}
        <EyIcon name="sync" size={11} strokeWidth={1.8} className={failed || issue ? tone : ""} />
        {failed
          ? sheetT(lang, "sync.failed")
          : sheetTf(lang, "sync.ago", { when: relativeSince(state.syncedAt, lang) })}
        {issue ? <span className="font-medium">{sheetT(lang, "sync.issue")}</span> : null}
      </span>
  );
  if (!issue && !failed) return <div className="flex justify-end">{badge}</div>;
  const canManage = canManageOwner;
  return <div className="flex justify-end">
    {wrapDetails(overlay, domain, <>
      <summary className="flex cursor-pointer list-none items-center justify-end gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        {badge}
        <span className={`text-xs underline underline-offset-2 ${tone}`}>{sheetT(lang, "sync.details")}</span>
        <span className="shrink-0 transition-transform group-open:rotate-180"><EyIcon name="chevronDown" size={12} /></span>
      </summary>
      {wrapOverlay(overlay, <div className={`${overlay ? "" : "mt-2 "}space-y-2 rounded-lg border border-amber/40 bg-amber-soft p-3 text-left text-sm`} role="region" aria-label={sheetT(lang, "sync.detailsTitle")}>
        <p className="font-bold">{sheetT(lang, "sync.detailsTitle")}</p>
        <p className="break-words" title={state.issue ?? undefined}>{failed ? humanizeMakeeduSyncError(state.issue) || sheetT(lang, "sync.failed") : issue}</p>
        {domain === "invoices" ? <p className="text-text-dim">{sheetT(lang, "sync.invoiceGuide")}</p> : null}
        {canManage ? <WindowLink href="/owner?tab=sheets&sub=makeedu" className="inline-flex font-semibold text-primary underline underline-offset-2">{sheetT(lang, "sync.openSettings")}</WindowLink>
          : <p className="text-text-dim">{sheetT(lang, "sync.askManager")}</p>}
      </div>)}
    </>)}
  </div>;
}

/**
 * 상세를 품는 `<details>` — 흐름 안이면 그대로, 띄우면(`overlay`) 바깥 클릭·Esc로 닫히는 부품.
 * key = 도메인: 면 탭으로 수납 ↔ 교재를 오가면 같은 자리에 다시 그려지는데, 그대로 두면 열린 상자가 새 면의 툴바를 덮는다.
 */
function wrapDetails(overlay: boolean, domain: MakeeduSyncDomain, inner: ReactNode) {
  return overlay
    ? <DismissibleDetails key={domain} className="group relative min-w-0 max-w-xl">{inner}</DismissibleDetails>
    : <details className="group min-w-0 max-w-xl">{inner}</details>;
}

/** `overlay`면 상세 상자를 배지 오른쪽 끝에 맞춰 아래로 띄운다(불투명 카드 바탕 · 창 폭을 넘지 않게). */
function wrapOverlay(overlay: boolean, panel: ReactNode) {
  return overlay
    ? <div className="absolute right-0 top-full z-20 mt-2 w-max max-w-[min(36rem,calc(100vw-2rem))] rounded-lg bg-card shadow-lg">{panel}</div>
    : panel;
}
