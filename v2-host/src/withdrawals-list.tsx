// 퇴원관리 목록 — 2.0 `src/app/(shell)/withdrawals/page.tsx`의 그리기를 같은 2.0 함수·같은 순서로 옮겼다(필터 술어 · 카드별 모집단 ·
// 분석 카드 · 사유 카드 · 월별 추이 · 등록 후 띠 · 명단). 서버가 받던 재료(퇴원 · 수강종료 · 설정 · 추이 보기 · 담당 판정)는 load가 준다.
// 2.0은 담당 판정을 흘려받는다(Suspense) — 여기서는 `teacher`가 'loading'인 동안 2.0의 대기 모양(강사 칸 '세는 중' · 담당 칸 '…')을 그대로 보인다.
// 강사 칸 필터(`teacher=`)가 걸리면 2.0처럼 판정을 기다린 뒤 그린다(진입점이 막는다).
import Link from "next/link";
import type { ReactNode } from "react";
import { isValidYm, kstMonth, kstToday, monthLabel, shiftMonth } from "@/lib/date-kst";
import { withdrawalMonthWindow, withdrawalProgram } from "@/features/withdrawals/window";
import { inRange, parseType, resolveRange, sortExitRows, toExitRows, type ExitRow, type RangeKey, type TypeKey } from "@/features/withdrawals/exit-rows";
import { parseProgram, programLabel, subjectGroupOf, visiblePrograms, type Program } from "@/features/students/enrollment/program";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";
import { UserMinus, CalendarClock, ListChecks, Filter, UserX, BookOpen, X } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { SearchToggle } from "@/components/search-toggle";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_ON, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { EmbedLink } from "@/components/embed-link";
import { tipProps } from "@/components/hover-tip/tip";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { relativeDayKo } from "@/lib/relative-time";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { REASON_LABEL, type WithdrawalReason } from "@/features/withdrawals/types";
import {
  FACET_NONE, REASON_CLEANUP, parseBreakdownAxis, teacherFacetsIn, type RowTeachers, REASON_TEXT_PREFIX, REASON_UNSPECIFIED, gradeItems, gradeOf,
  judgeSubjects, parseFacet, reasonFacetLabel, reasonFacetOf, detailFacetLabel, detailItems, reasonDetailFacetOf, schoolItems, schoolOf,
  subjectComboItems, subjectItems, teacherCellText, teacherFacetLabel, teacherFilterOptions, teacherItems, type BreakdownAxis,
} from "@/features/withdrawals/breakdown";
import { Pagination } from "@/components/pagination";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WithdrawalTrendChart, type WithdrawalMonthPoint } from "@/app/(shell)/withdrawals/_components/trend-chart";
import { scopeText, spanText } from "@/features/withdrawals/scope-text";
import type { WithdrawalTrendPrefs } from "@/features/withdrawals/trend-prefs";
import { WithdrawalListLayout } from "@/app/(shell)/withdrawals/_components/list-layout";
import { CustomRange } from "@/app/(shell)/withdrawals/_components/custom-range";
import { withdrawalPage, withdrawalPageSize } from "@/features/withdrawals/list-pagination";
import { EARLY_MAX_DAYS, EARLY_SPANS, earlyCounts, earlySpan, isEarlyWithin, parseEarly, type EarlyKey } from "@/features/withdrawals/early-exit";
import { EarlyExitBand } from "@/app/(shell)/withdrawals/_components/early-exit-band";
import { WithdrawalBreakdownCard, type BreakdownRow, type BreakdownView } from "@/app/(shell)/withdrawals/_components/breakdown-card";
import { ReasonAnalysisCard } from "@/app/(shell)/withdrawals/_components/reason-analysis-card";
import { REASON_DETAILS, reasonDetailOf } from "@/features/withdrawals/reason-detail";
import type { SubjectSetting } from "@/features/owner/settings-types";

/** 담당 판정(load part=teacher) — 줄 → 과목 → 그 퇴원을 퇴원율에 센 선생님. null = 판정 실패. */
export type TeacherInfo = { map: ReadonlyMap<string, RowTeachers>; names: ReadonlyMap<string, string>; options: { excludeReasons: string[]; countEnded: boolean } } | null;
export type TeacherState = { status: "loading" } | { status: "ready"; info: TeacherInfo };
export type ListData = {
  withdrawn: Parameters<typeof toExitRows>[0];
  subjectEnded: Parameters<typeof toExitRows>[1];
  settings: { operations: { subjects: SubjectSetting[]; gradeLevels: string[] }; modules: { disabled: ModuleId[] } };
  trendPrefs: WithdrawalTrendPrefs;
  judgeFromMonth: string;
};

function monthlyExits(rows: { date: string | null }[]): WithdrawalMonthPoint[] {
  const thisMonth = kstMonth();
  const months: { key: string; point: WithdrawalMonthPoint }[] = [];
  for (let i = 11; i >= 0; i--) {
    const key = shiftMonth(thisMonth, -i);
    months.push({ key, point: { label: `${Number(key.slice(5))}월`, count: 0 } });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    const i = idx.get(r.date?.slice(0, 7) ?? "");
    if (i != null) months[i]!.point.count++;
  }
  return months.map((m) => m.point);
}

type ReasonKey = string;
type ConsultKey = "all" | "pending" | "done";
const RANGE_OPTIONS: { value: Exclude<RangeKey, "all" | "month">; label: string }[] = [
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "최근 1년" },
  { value: "custom", label: "직접 지정" },
];
const TYPE_OPTIONS: { value: Exclude<TypeKey, "all">; label: string }[] = [
  { value: "withdrawn", label: "퇴원" },
  { value: "subject-ended", label: "수강종료" },
];
const CONSULT_OPTIONS: { value: Exclude<ConsultKey, "all">; label: string }[] = [
  { value: "pending", label: "상담 미완료" },
  { value: "done", label: "상담 완료" },
];
const SELECT_PROPS = { className: "w-auto", triggerClassName: TOOLBAR_SELECT } as const;

type WdHrefParams = {
  type: TypeKey; range: RangeKey; from: string | null; to: string | null; month: string; reason: ReasonKey; detail: string | null; q: string;
  subject: string; program: Program | null; consult: ConsultKey; early: EarlyKey | null; grade: string | null; school: string | null; teacher: string | null;
};
function buildWdHref(p: WdHrefParams): string {
  const sp = new URLSearchParams();
  if (p.type !== "all") sp.set("type", p.type);
  if (p.range !== "all") sp.set("range", p.range);
  if (p.range === "month") sp.set("month", p.month);
  if (p.range === "custom" && p.from && p.to) {
    sp.set("from", p.from);
    sp.set("to", p.to);
  }
  if (p.reason !== "all") sp.set("reason", p.reason);
  if (p.reason !== "all" && p.detail) sp.set("detail", p.detail);
  if (p.subject !== "all") sp.set("subject", p.subject);
  if (p.program) sp.set("program", p.program);
  if (p.consult !== "all") sp.set("consult", p.consult);
  if (p.early) sp.set("early", p.early);
  if (p.grade) sp.set("grade", p.grade);
  if (p.school) sp.set("school", p.school);
  if (p.teacher) sp.set("teacher", p.teacher);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/withdrawals?${s}` : "/withdrawals";
}

export function WithdrawalsList({ data, teacher, sp }: { data: ListData; teacher: TeacherState; sp: Record<string, string | undefined> }) {
  const type = parseType(sp.type);
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const reason: ReasonKey = parseFacet(sp.reason) ?? "all";
  const reasonDetails = Object.hasOwn(REASON_DETAILS, reason) ? REASON_DETAILS[reason as WithdrawalReason] : [];
  const detailRaw = reasonDetails.length ? parseFacet(sp.detail) : null;
  const detailF = detailRaw && (detailRaw === FACET_NONE || reasonDetailOf(detailRaw)?.reason === reason) ? detailRaw : null;
  const gradeF = parseFacet(sp.grade);
  const schoolF = parseFacet(sp.school);
  const teacherF = parseFacet(sp.teacher);
  const subject = sp.subject ?? "all";
  const consult: ConsultKey = (sp.consult as ConsultKey) ?? "all";
  const early = type === "subject-ended" ? null : parseEarly(sp.early);
  const q = sp.q ?? "";
  const size = withdrawalPageSize(sp.size);
  const today = kstToday();
  const monthKey = isValidYm(sp.month) ? sp.month : kstMonth();
  const monthWindow = withdrawalMonthWindow(monthKey, today);
  const rangeWindow = resolveRange(range, { today, month: monthWindow, from: sp.from, to: sp.to });
  const program = parseProgram(sp.program);
  const withSubjectEnded = type !== "withdrawn";
  const { settings, trendPrefs, judgeFromMonth } = data;
  const axisParam = sp.axis ? parseBreakdownAxis(sp.axis) : null;
  const axis: BreakdownAxis = axisParam ?? trendPrefs.axis;
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const withdrawnRaw = data.withdrawn, subjectEndedRaw = withSubjectEnded ? data.subjectEnded : [];
  const all = sortExitRows(toExitRows(withdrawnRaw, subjectEndedRaw));
  const withdrawnTotal = withdrawnRaw.length;
  const subjectEndedTotal = all.length - withdrawnTotal;

  const term = q.toLowerCase();
  const byName = (r: ExitRow) => !q || r.name.toLowerCase().includes(term);
  const byType = (r: ExitRow) => type === "all" || r.kind === type;
  const byRange = (r: ExitRow) => inRange(r, rangeWindow);
  const byReason = (r: ExitRow) => (reason === "all" || reasonFacetOf(r).value === reason) && (!detailF || reasonDetailFacetOf(r) === detailF);
  const bySubject = (r: ExitRow) => subject === "all" || r.subjects.includes(subject);
  const byConsult = (r: ExitRow) => consult === "all" || (r.consulted !== null && (consult === "done" ? r.consulted : !r.consulted));
  const byProgram = (r: ExitRow) =>
    !program || withdrawalProgram({ lastClassSubject: r.programSubject, lastClassEnglishTrack: r.englishTrack }, settings.operations.subjects) === program;
  const byEarly = (r: ExitRow) => !early || (r.kind === "withdrawn" && isEarlyWithin(r.tenureDays, early));
  const byGrade = (r: ExitRow) => !gradeF || gradeOf(r) === gradeF;
  const bySchool = (r: ExitRow) => !schoolF || schoolOf(r) === schoolF;
  const programGroup = program ? (program === "math" ? "math" : "english") : null;
  const currentSubject = subject === "all" ? null : subject;
  const subjectsInScope = (r: ExitRow, subjectKey: string | null) =>
    judgeSubjects(r, { subject: subjectKey, programGroup }, (s) => subjectGroupOf(s, settings.operations.subjects));
  const teacherFacetsOf = (map: ReadonlyMap<string, RowTeachers>, r: ExitRow, subjectKey: string | null) => {
    const per = map.get(r.key);
    return per ? teacherFacetsIn(per, subjectsInScope(r, subjectKey)) : null;
  };
  // 강사 칸 필터가 걸렸을 때만 판정으로 거른다(2.0은 그때 판정을 기다린다 — 진입점이 판정 도착 뒤에 그린다).
  const info = teacher.status === "ready" ? teacher.info : null;
  const teacherMap = teacherF && info ? info.map : null;
  const teacherFailed = !!teacherF && teacher.status === "ready" && !info;
  const teacherMatches = (r: ExitRow, subjectKey: string | null) => {
    if (!teacherF || !teacherMap) return true;
    return teacherFacetsOf(teacherMap, r, subjectKey)?.includes(teacherF) ?? false;
  };
  const byTeacher = (r: ExitRow) => teacherMatches(r, currentSubject);
  const base = (r: ExitRow) => byName(r) && byProgram(r) && byType(r);
  const facets = { range: byRange, reason: byReason, subject: bySubject, consult: byConsult, early: byEarly, grade: byGrade, school: bySchool, teacher: byTeacher } as const;
  type Facet = keyof typeof facets;
  const facetKeys = Object.keys(facets) as Facet[];
  const passes = (r: ExitRow, ...skip: Facet[]) => base(r) && facetKeys.every((k) => skip.includes(k) || facets[k](r));

  const rows = all.filter((r) => passes(r));
  const trendRows = all.filter((r) => passes(r, "range"));
  const subjectRows = all
    .filter((r) => passes(r, "subject", "teacher"))
    .flatMap((r) => {
      if (!teacherF || !teacherMap) return [r];
      if (!r.subjects.length) return teacherMatches(r, null) ? [r] : [];
      const kept = r.subjects.filter((s) => teacherMatches(r, s));
      return kept.length ? [{ ...r, subjects: kept }] : [];
    });
  const gradeRows = all.filter((r) => passes(r, "grade"));
  const schoolRows = all.filter((r) => passes(r, "school"));
  const teacherRows = all.filter((r) => passes(r, "teacher"));
  const consultRows = all.filter((r) => r.kind === "withdrawn" && passes(r, "consult"));
  const reasonRows = all.filter((r) => passes(r, "reason"));
  const earlyRows = all.filter((r) => r.kind === "withdrawn" && passes(r, "early"));
  const earlyJudged = earlyRows.filter((r) => r.tenureDays !== null);
  const earlyCount = earlyCounts(earlyJudged.map((r) => ({ days: r.tenureDays })));
  const consultPending = consultRows.filter((r) => !r.consulted).length;
  const consultRate = consultRows.length ? Math.round(((consultRows.length - consultPending) / consultRows.length) * 100) : 0;

  const reasonGroups = new Map<string, { label: string; count: number }>();
  let cleanupCount = 0;
  for (const r of reasonRows) {
    const f = reasonFacetOf(r);
    if (f.value === REASON_CLEANUP) {
      cleanupCount++;
      continue;
    }
    const g = reasonGroups.get(f.value) ?? { label: f.label, count: 0 };
    g.count++;
    reasonGroups.set(f.value, g);
  }
  const topReasons = [...reasonGroups].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, "ko"));
  const reasonBase = reasonRows.length - cleanupCount;
  const recentWindow = resolveRange("month", { today, month: withdrawalMonthWindow(kstMonth(), today) });
  const recent = trendRows.filter((r) => inRange(r, recentWindow)).length;
  const systemBulkCount = trendRows.filter((r) => r.systemBulk).length;
  const cleanupTrendCount = trendRows.filter((r) => r.cleanup && !r.systemBulk).length;
  const trend = monthlyExits(trendRows.filter((r) => !r.systemBulk && !r.cleanup));
  const reasonOptions: { value: string; label: string }[] = [
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([k, label]) => ({ value: k, label })),
    { value: REASON_UNSPECIFIED, label: "미기재" },
    { value: REASON_CLEANUP, label: "장부 정리" },
    ...(reason.startsWith(REASON_TEXT_PREFIX) ? [{ value: reason, label: reasonFacetLabel(reason) ?? reason }] : []),
  ];

  const custom = "custom" in rangeWindow ? rangeWindow.custom : undefined;
  const current: WdHrefParams = {
    type, range, from: custom?.from ?? null, to: custom?.to ?? null, month: monthKey, reason, detail: detailF, q, subject, program, consult,
    early: parseEarly(sp.early), grade: gradeF, school: schoolF, teacher: teacherF,
  };
  const filterActive =
    type !== "all" || range !== "all" || reason !== "all" || subject !== "all" || consult !== "all" || !!program || !!early || !!gradeF || !!schoolF || !!teacherF || !!q;
  const rangeOptions = [{ value: "month" as const, label: monthKey === kstMonth() ? "이번 달" : monthLabel(monthKey) }, ...RANGE_OPTIONS];
  const withdrawnOnly = type === "withdrawn" || !!early;
  const noun = withdrawnOnly ? "퇴원" : type === "subject-ended" ? "수강종료" : "퇴원·수강종료";
  const hrefWith = (patch: Partial<WdHrefParams>) => {
    const href = buildWdHref({ ...current, ...patch });
    return `${href}${href.includes("?") ? "&" : "?"}size=${size}`;
  };
  const earlyHrefs = Object.fromEntries(EARLY_SPANS.map((s) => [s.key, hrefWith({ early: early === s.key ? null : s.key })])) as Record<EarlyKey, string>;
  const detailView = reasonDetails.length
    ? (() => {
        const inReason = reasonRows.filter((r) => reasonFacetOf(r).value === reason);
        return {
          reasonLabel: reasonFacetLabel(reason) ?? "",
          total: inReason.length,
          rows: detailItems(inReason, reason as WithdrawalReason).map((i) => ({ ...i, active: detailF === i.value, href: hrefWith({ detail: detailF === i.value ? null : i.value }) })),
        };
      })()
    : null;

  const names = teacherMap && info ? info.names : new Map<string, string>();
  const teacherLabel = (id: string) => teacherFacetLabel(id, (x) => names.get(x) ?? null);
  const teacherOptions = info
    ? teacherFilterOptions(teacherRows.map((r) => teacherFacetsOf(info.map, r, currentSubject)), teacherF, (id) => info.names.get(id) ?? null)
    : null;

  const yearStart = `${today.slice(0, 4)}-01-01`;
  const inYear = (r: ExitRow) => !!r.date && r.date >= yearStart && r.date <= today;
  const yearWithdrawn = all.filter((r) => r.kind === "withdrawn" && !r.systemBulk && inYear(r)).length;
  const yearBulk = all.filter((r) => r.kind === "withdrawn" && r.systemBulk && inYear(r)).length;
  const yearEnded = all.filter((r) => r.kind === "subject-ended" && inYear(r)).length;
  const firstWithdrawn = all.reduce<string | null>((m, r) => (r.kind === "withdrawn" && r.date && (!m || r.date < m) ? r.date : m), null);
  const eieOn = isModuleEnabled(settings.modules.disabled, "eie");
  const scopeParts = {
    program: program ? programLabel(program, settings.operations.subjects, eieOn) : null,
    subject: subject !== "all" ? subjectMaps.labelOf(subject) : null,
    reason: reason === "all" ? null : [reasonFacetLabel(reason), detailF ? detailFacetLabel(detailF) : null].filter(Boolean).join(" · ") || null,
    consult: consult === "all" ? null : (CONSULT_OPTIONS.find((o) => o.value === consult)?.label ?? null),
    early: early ? earlySpan(early).label : null,
    grade: gradeF ? (gradeF === FACET_NONE ? "학년 미기재" : gradeF) : null,
    school: schoolF ? (schoolF === FACET_NONE ? "학교 미기재" : schoolF) : null,
    teacher: teacherF && teacherMap ? teacherLabel(teacherF) : null,
    q: q || null,
  };
  const scope = scopeText(scopeParts);
  const consultScope = scopeText({ ...scopeParts, consult: null });
  const rangeText = rangeWindow.kind === "all" ? "전체 기간" : spanText(rangeWindow.from, rangeWindow.to);
  const caption = (n: number, skip: "subject" | "grade" | "school" | "teacher", on: boolean, label: string) =>
    `${n}건 · ${rangeText} · ${scopeText({ ...scopeParts, [skip]: null })}${on ? ` · ${label} 필터는 이 축이라 제외` : ""}`;
  const toRows = (items: readonly { value: string; label: string; count: number }[], picked: string | null, href: (value: string | null) => string): BreakdownRow[] =>
    items.map((i) => ({ ...i, active: picked === i.value, href: href(picked === i.value ? null : i.value) }));
  const breakdownViews = {
    subject:
      subject === "all"
        ? {
            caption: caption(subjectRows.length, "subject", false, "과목"),
            total: subjectRows.length,
            share: true,
            note: "두 과목을 함께 끊은 퇴원은 과목마다 셉니다.",
            rows: toRows(subjectItems(subjectRows, subjectMaps.labelOf), null, (v) => hrefWith({ subject: v ?? "all" })).map((r) =>
              r.value === FACET_NONE ? { ...r, href: null } : r,
            ),
          }
        : {
            caption: `${rows.length}건 · ${rangeText} · ${scope}`,
            total: rows.length,
            share: true,
            note: "함께 끊은 과목은 한 칸으로 묶어 셉니다.",
            rows: subjectComboItems(rows, subject, settings.operations.subjects.map((s) => s.key), subjectMaps.labelOf).map((i) => ({ ...i, active: false, href: null })),
          },
    grade: {
      caption: caption(gradeRows.length, "grade", !!gradeF, "학년"),
      total: gradeRows.length,
      share: true,
      note: "학년은 학생 기록에 적힌 값입니다.",
      rows: toRows(gradeItems(gradeRows, settings.operations.gradeLevels), gradeF, (v) => hrefWith({ grade: v })),
    },
    school: {
      caption: caption(schoolRows.length, "school", !!schoolF, "학교"),
      total: schoolRows.length,
      share: true,
      note: "학교는 학생 기록에 적힌 값입니다.",
      rows: toRows(schoolItems(schoolRows), schoolF, (v) => hrefWith({ school: v })),
    },
  } satisfies Record<string, BreakdownView>;
  function teacherView(map: ReadonlyMap<string, RowTeachers>, rules: { excludeReasons: string[]; countEnded: boolean }, names: ReadonlyMap<string, string>): BreakdownView {
    const judged = teacherRows.filter((r) => map.has(r.key));
    const outside = teacherRows.length - judged.length;
    const facetsOf = (r: ExitRow) => teacherFacetsOf(map, r, currentSubject);
    const offScope = judged.filter((r) => facetsOf(r) === null).length;
    const excluded = [
      ...(Object.keys(REASON_LABEL) as WithdrawalReason[]).filter((k) => rules.excludeReasons.includes(k)).map((k) => REASON_LABEL[k]),
      ...(rules.countEnded ? [] : ["과목만 끊은 수강종료"]),
    ];
    return {
      caption: caption(judged.length - offScope, "teacher", !!teacherF, "강사"),
      total: judged.length - offScope,
      share: false,
      rows: toRows(teacherItems(judged, facetsOf, (id) => names.get(id) ?? null), teacherF, (v) => hrefWith({ teacher: v })),
      note: [
        "강사 = 그 학생을 지난달 절반 이상 맡은 담임·교시 담당(시간표 X와 같은 판정) · 함께 맡았으면 각각 셉니다.",
        `담당 미반영 = 퇴원율로 세지 않은 과목이 있는 줄(두 과목 중 한쪽만 셌으면 그 선생님과 함께 섭니다) — 장부 정리 · 반 이동 · 같은 과목 다른 반을 계속 다님 · 수업이 끝남(반 폐지·종강·운영 기간 종료·폐강) · 끝난 특강 · 지난달 절반 미만 담당${excluded.length ? ` · ${excluded.join(" · ")}` : ""}.`,
        programGroup || subject !== "all" ? "걸린 과목·프로그램의 담당만 셉니다." : "",
        outside ? `${judgeFromMonth.replace("-", "년 ")}월 전 ${outside}건은 강사를 가리지 않았습니다.` : "",
        offScope ? `걸린 프로그램 밖 과목만 끊은 ${offScope}건은 세지 않았습니다.` : "",
      ].filter(Boolean).join(" "),
    };
  }
  // 강사 카드 — 판정이 오기 전엔 2.0의 대기 카드(teacherLoading), 오면 판정 그대로, 실패면 '못 불러옴'.
  const teacherCard = (() => {
    if (teacher.status === "loading") return { view: null, error: false, loading: true };
    if (!info) return { view: null, error: true, loading: false };
    try {
      return { view: teacherView(info.map, info.options, info.names), error: false, loading: false };
    } catch {
      return { view: null, error: true, loading: false };
    }
  })();
  const earlyScope = `${rangeText} · ${scopeText({ ...scopeParts, early: null })}`;
  const typeRows = all.filter((r) => (withdrawnOnly ? r.kind === "withdrawn" : byType(r)) && !r.systemBulk && !r.cleanup);
  const narrowed = trendRows.filter((r) => !r.systemBulk && !r.cleanup).length !== typeRows.length;
  const typeTrend = narrowed ? monthlyExits(typeRows) : null;
  const trendData: WithdrawalMonthPoint[] = typeTrend ? trend.map((p, i) => ({ ...p, total: typeTrend[i]?.count ?? 0 })) : trend;
  const sum = (xs: readonly { count: number }[]) => xs.reduce((a, x) => a + x.count, 0);

  const total = rows.length;
  const { page, totalPages, start, end } = withdrawalPage(sp.page, total, size);
  const pageRows = rows.slice(start, end);
  const teacherCell = (r: ExitRow): ReactNode => {
    if (teacher.status === "loading") return <span className="text-text-faint" title="담당 확인 중">…</span>;
    const text = info ? teacherCellText(teacherFacetsOf(info.map, r, currentSubject), (id) => info.names.get(id) ?? null) : "—";
    return <span title={info ? text : "담당을 불러오지 못했습니다"}>{text}</span>;
  };
  const pageHref = (p: number) => {
    const base = buildWdHref(current);
    const params = new URLSearchParams(base.split("?")[1]);
    params.set("size", String(size));
    if (p > 1) params.set("page", String(p));
    return `/withdrawals?${params}`;
  };

  return (
    <div className="space-y-5 compact-chrome:space-y-3">
      <PageHeader
        eyebrow="학생 케어"
        title="퇴원관리"
        description={`누적 퇴원 ${withdrawnTotal}명${firstWithdrawn ? `(${firstWithdrawn.slice(0, 7).replace("-", ".")}~)` : ""}${withSubjectEnded ? ` · 수강종료 ${subjectEndedTotal}건` : ""}`}
      />
      <StatStrip>
        <BigStat label="올해 퇴원" value={yearWithdrawn} unit="명" sub={`${spanText(yearStart, today)} · 학원 전체${yearBulk ? ` · 날짜 미상 ${yearBulk}명 제외` : ""}`} tone="rose" icon={<UserMinus size={16} strokeWidth={1.8} />} />
        {withSubjectEnded ? (
          <BigStat label="올해 수강종료" value={yearEnded} unit="건" sub={`${spanText(yearStart, today)} · 학원 전체 · 재원 중 한 과목을 끊음`} tone="amber" icon={<BookOpen size={16} strokeWidth={1.8} />} />
        ) : null}
        <BigStat label="이번 달" value={recent} unit="건" sub={`${noun} · ${spanText(`${kstMonth()}-01`, today)} · ${scope}`} tone="danger" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat label="상담 미완료" value={consultPending} unit="명" sub={`퇴원 사후상담 완료율 ${consultRate}% · ${rangeText} · ${consultScope}`} tone="amber" icon={<ListChecks size={16} strokeWidth={1.8} />} />
        <BigStat label="필터 결과" value={rows.length} unit="건" tone="blue" icon={<Filter size={16} strokeWidth={1.8} />} />
      </StatStrip>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <FilterSelect paramName="type" value={type === "all" ? "" : type} options={TYPE_OPTIONS} axisLabel="유형" ariaLabel="유형" {...SELECT_PROPS} />
        <FilterSelect paramName="range" value={range === "all" ? "" : range} options={rangeOptions} axisLabel="기간" ariaLabel="기간 필터" clearParams={["month", "from", "to"]} {...SELECT_PROPS} />
        {custom ? <CustomRange key={`${custom.from}~${custom.to}`} from={custom.from} to={custom.to} /> : null}
        <FilterSelect paramName="reason" value={reason === "all" ? "" : reason} options={reasonOptions} axisLabel="사유" ariaLabel="사유 필터" clearParams={["detail"]} {...SELECT_PROPS} />
        <FilterSelect paramName="subject" value={subject === "all" ? "" : subject} options={subjectMaps.options} axisLabel="과목" ariaLabel="과목 필터" {...SELECT_PROPS} />
        <FilterSelect
          paramName="program"
          value={program ?? ""}
          options={visiblePrograms(eieOn).map((p) => ({ value: p, label: programLabel(p, settings.operations.subjects, eieOn) }))}
          axisLabel="프로그램"
          ariaLabel="프로그램 필터"
          {...SELECT_PROPS}
        />
        {teacherF && !teacherMap ? null : (
          <TeacherFilter value={teacherF} options={teacherOptions ?? (teacher.status === "loading" && teacherF ? [{ value: teacherF, label: teacherLabel(teacherF) }] : [])} />
        )}
        <FilterSelect paramName="consult" value={consult === "all" ? "" : consult} options={CONSULT_OPTIONS} axisLabel="상담" ariaLabel="상담 필터" {...SELECT_PROPS} />
        {type !== "subject-ended" ? (
          <FilterSelect paramName="early" value={early ?? ""} options={EARLY_SPANS.map((s) => ({ value: s.key, label: s.label }))} axisLabel="등록 후" ariaLabel="등록 후 퇴원 기간 필터" {...SELECT_PROPS} />
        ) : null}
        {detailF ? <FacetChip label={`세부: ${detailFacetLabel(detailF)}`} href={hrefWith({ detail: null })} /> : null}
        {gradeF ? <FacetChip label={`학년: ${scopeParts.grade}`} href={hrefWith({ grade: null })} /> : null}
        {schoolF ? <FacetChip label={`학교: ${scopeParts.school}`} href={hrefWith({ school: null })} /> : null}
        {teacherFailed ? <FacetChip label="담당강사: 불러오지 못해 걸지 않음" href={hrefWith({ teacher: null })} /> : null}
        <SearchToggle placeholder="학생명" defaultValue={q} />
        {filterActive ? (
          <Link href="/withdrawals" className={`${CONTROL_H} ${CONTROL_LABEL} text-text-faint hover:text-foreground inline-flex items-center px-1 whitespace-nowrap transition`}>
            필터 초기화
          </Link>
        ) : null}
      </div>

      {all.length > 0 && type !== "subject-ended" ? (
        <EarlyExitBand counts={earlyCount} judged={earlyJudged.length} unjudged={earlyRows.length - earlyJudged.length} active={early} hrefs={earlyHrefs} scope={earlyScope} />
      ) : null}

      {all.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section className="bg-card shadow-card rounded-2xl p-5">
            <header className="mb-2 flex items-baseline justify-between">
              <h2 className="text-foreground text-base font-bold">월별 {noun} 추이</h2>
              <span className="text-text-faint text-xs">
                최근 12개월 · {typeTrend ? `학원 전체 ${sum(typeTrend)}건 · ${scope} ${sum(trend)}건` : `${scope} ${sum(trend)}건`}
                {range !== "all" ? " (기간 필터는 이 축이라 제외)" : ""}
                {systemBulkCount > 0 ? ` (시스템 정리 ${systemBulkCount}명 제외 — 퇴원일 미상)` : ""}
                {cleanupTrendCount > 0 ? ` (장부 정리 ${cleanupTrendCount}명 제외 — 퇴원일이 장부 날짜)` : ""}
              </span>
            </header>
            <WithdrawalTrendChart data={trendData} filterLabel={typeTrend ? scope : noun} initialPrefs={trendPrefs} unit={withdrawnOnly ? "명" : "건"} />
          </section>
          <WithdrawalBreakdownCard
            views={{ ...breakdownViews, teacher: teacherCard.view }}
            initialAxis={axis}
            teacherError={teacherCard.error}
            teacherLoading={teacherCard.loading}
          />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          image="withdrawals"
          icon={() => <UserX size={32} strokeWidth={1.8} />}
          title={`${noun} 학생이 없습니다`}
          description="퇴원 처리되거나 한 과목을 끊은 학생이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <WithdrawalListLayout size={size} total={total}>
          <section data-withdrawal-list className="bg-card shadow-card overflow-hidden rounded-2xl">
            <header data-withdrawal-header className="border-line flex items-baseline justify-between border-b px-5 py-4">
              <div>
                <p className="micro">최근 {noun}</p>
                <h2 className="text-foreground mt-1 text-base font-bold">학생 명단</h2>
              </div>
              <p className="text-text-faint num text-xs">
                {start + 1}–{end} / {total}건
              </p>
            </header>
            <ul data-withdrawal-rows className="divide-line divide-y">
              {pageRows.map((r) => (
                <ExitRowItem key={r.key} row={r} labelOf={subjectMaps.labelOf} today={today} teacher={teacherCell(r)} />
              ))}
            </ul>
            <div data-withdrawal-pager className="border-line border-t px-5 py-3">
              {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} scroll={false} /> : <p className="text-center text-xs">전체 {total}건</p>}
            </div>
          </section>
          <ReasonAnalysisCard
            noun={noun}
            base={reasonBase}
            unspecified={reasonGroups.get(REASON_UNSPECIFIED)?.count ?? 0}
            bars={topReasons.map(([value, g]) => ({ value, label: g.label, count: g.count, active: reason === value, href: hrefWith({ reason: reason === value ? "all" : value, detail: null }) }))}
            cleanup={cleanupCount > 0 ? { count: cleanupCount, active: reason === REASON_CLEANUP, href: hrefWith({ reason: reason === REASON_CLEANUP ? "all" : REASON_CLEANUP, detail: null }) } : null}
            details={detailView}
            summary={
              topReasons[0]?.[0] === REASON_UNSPECIFIED
                ? "사유 미기재가 가장 많습니다. 기록된 사유를 보완해야 퇴원 원인을 비교할 수 있습니다."
                : topReasons[0]?.[0] === "other"
                  ? "'기타'가 가장 많습니다. 막대를 눌러 명단 줄의 메모로 실제 사유를 확인하고, 알맞은 사유로 고쳐 주세요."
                  : topReasons[0]
                    ? `현재 가장 빈번한 ${noun} 사유는 "${topReasons[0][1].label}"입니다. 추세 모니터링과 사전 상담 강화를 고려해 보세요.`
                    : `${noun} 사유가 등록되면 인사이트가 표시됩니다.`
            }
          />
        </WithdrawalListLayout>
      )}
    </div>
  );
}

function ExitRowItem({ row: r, labelOf, today, teacher }: { row: ExitRow; labelOf: (key: string) => string; today: string; teacher: ReactNode }) {
  const ago = r.date && r.date > today ? "예정" : relativeDayKo(r.date, today);
  const where = schoolGradeLabel(r.school, r.grade);
  const ended = r.kind === "subject-ended";
  const reason = reasonFacetOf(r);
  const detail = r.detail ? reasonDetailOf(r.detail)?.label : null;
  const reasonText = detail ? `${reason.label} · ${detail}` : reason.label;
  return (
    <li className="hover:bg-bg-soft/50 transition">
      <WindowLink
        href={ended ? `/students/${r.studentId}` : `/withdrawals/${r.studentId}`}
        title={r.name}
        className="grid h-11 grid-cols-[auto_minmax(0,1fr)_6.5rem] items-center gap-3 px-5 sm:grid-cols-[4.75rem_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_6.5rem_5rem] xl:grid-cols-[4.75rem_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.55fr)_minmax(0,1fr)_6.5rem_5rem]"
      >
        <span className="whitespace-nowrap">
          <Pill color={ended ? "amber" : "rose"}>{ended ? "수강종료" : "퇴원"}</Pill>
        </span>
        <p className="text-foreground min-w-0 truncate text-base leading-none font-bold">
          {r.name}
          {where ? <span className="text-text-dim ml-1.5 text-sm font-semibold">{where}</span> : null}
          {r.onHold ? <span className="text-text-faint ml-1 text-sm font-normal">(휴원)</span> : null}
          {r.tenureDays !== null && r.tenureDays <= EARLY_MAX_DAYS ? <span className="text-rose ml-1.5 text-sm font-semibold">등록 {r.tenureDays}일 만</span> : null}
        </p>
        <p className="text-text-dim hidden min-w-0 truncate text-sm sm:block">
          {ended ? `${labelOf(r.subjects[0] ?? "")} 종료 · ` : ""}
          {r.className ?? "수강 반 없음"}
          {ended && r.activeSubjects?.length ? ` · ${r.activeSubjects.map(labelOf).join("·")} 수강중` : ""}
        </p>
        <p className="text-text-dim hidden min-w-0 truncate text-sm xl:block">{teacher}</p>
        <p className="text-text-dim hidden min-w-0 truncate text-sm sm:block" {...tipProps({ title: r.name, rows: [["사유", reasonText], ["메모", r.memo ?? ""]] })}>
          <span className={r.cleanup ? "text-text-faint" : "text-foreground font-semibold"}>{reasonText}</span>
          {r.memo && !r.cleanup ? ` · ${r.memo}` : ""}
        </p>
        {r.systemBulk ? (
          <>
            <span className="justify-self-end">
              <Pill color="neutral">시스템 정리</Pill>
            </span>
            <span className="text-text-faint hidden justify-self-end text-sm whitespace-nowrap sm:inline">퇴원일 미상</span>
          </>
        ) : (
          <>
            <span className="text-foreground num justify-self-end text-sm font-bold whitespace-nowrap">{r.date ?? "—"}</span>
            <span className="text-text-faint num hidden justify-self-end text-sm whitespace-nowrap sm:inline">{ago === r.date ? "" : ago}</span>
          </>
        )}
      </WindowLink>
    </li>
  );
}

function FacetChip({ label, href }: { label: string; href: string }) {
  return (
    <EmbedLink href={href} scroll={false} aria-label={`${label} 필터 해제`} className={`${TOOLBAR_CHIP} gap-1.5 ${TOOLBAR_CHIP_ON}`}>
      {label}
      <X size={12} strokeWidth={2} />
    </EmbedLink>
  );
}

function TeacherFilter({ value, options }: { value: string | null; options: { value: string; label: string }[] }) {
  return <FilterSelect paramName="teacher" value={value ?? ""} options={options} axisLabel="담당강사" ariaLabel="담당강사 필터" {...SELECT_PROPS} />;
}
