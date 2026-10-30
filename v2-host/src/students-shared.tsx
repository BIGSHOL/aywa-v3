// 원생 화면 호스트 공용 — 고른 탭의 자료(서버가 상세와 함께 실어 보낸 data.tab.data)를 탭 부품에 건네는 자리, 복사본 날짜, 아직 없는 탭 안내.
// 2.0 탭은 서버 컴포넌트(스스로 조회)라 호스트 탭 부품(students-tab-<탭>.tsx)은 같은 이름·같은 props로 서고 자료는 useStudentTab()으로 읽는다.
import { createContext, useContext, type ReactNode } from "react";
import { kstToday as realKstToday } from "@/lib/date-kst";

const TabData = createContext<unknown>(null);

export function StudentTabDataProvider({ value, children }: { value: unknown; children: ReactNode }) {
  return <TabData.Provider value={value}>{children}</TabData.Provider>;
}

/** 아직 옮기지 않은 탭이면 서버가 { missing: true }를 보낸다. */
export function isMissingTab(v: unknown): v is { missing: true } {
  return typeof v === "object" && v !== null && (v as { missing?: unknown }).missing === true;
}

/** 고른 탭의 자료 — 탭 부품만 부른다(모양은 그 탭의 v2-students-tab-<탭>.mjs loadTab이 정한다). */
export function useStudentTab<T>(): T {
  return useContext(TabData) as T;
}

/** 아직 옮기지 않은 탭 — 안내 한 줄(2.0 화면의 빈 탭 자리). */
export function MissingTab() {
  return <p className="text-text-dim py-8 text-center text-sm">아직 3.0에 없는 화면입니다.</p>;
}

let copyDay: string | null = null;
/** 상세 자료가 오면 복사본 날짜를 맞춘다 — 서버(load)가 '오늘'로 쓴 날과 같은 날로 그린다. */
export function setCopyDay(day: string | null | undefined) {
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) copyDay = day;
}
/** 2.0 kstToday 자리 — 복사본 날짜(없으면 브라우저 날짜). */
export function kstToday(): string {
  return copyDay ?? realKstToday();
}
