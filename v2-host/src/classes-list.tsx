// 2.0 수업목록(app/(shell)/classes/page.tsx)의 조립 — 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회·필터 해석은
// /api/v2/classes(Docker 복사본, v2-screen-classes.mjs)가 하고 여기서는 page.tsx의 그리기 부분을 같은 부품·같은 순서로 옮겼다.
// ⚠️ 빠진 것: makeedu 동기화 배지(MakeeduSyncBadge — 서버 컴포넌트) · 계정 보기 설정 저장(RememberPrefs — 3.0엔 계정이 없어 주소로만).
// `type HeadCells` 아래(빈 상태 · 요일 칩 · 표 · 카드)는 page.tsx 원문 그대로다 — verify-v2-screen-classes.mjs가 글자를 대조한다.
import { tipProps } from "@/components/hover-tip/tip";
import Link from "next/link";
import { BookOpen, Users, UserCheck, SearchX } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { Pill } from "@/components/atoms/pill";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { Button } from "@/components/ui/button";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { HeaderFilter } from "@/components/header-filter";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { ClassListRow, ClassDaySlot, ClassSort, ClassStatusFilter } from "@/features/classes/server/queries";
import { buildSubjectMaps, SUBJECT_SOLID, type SubjectMaps, type SubjectSetting } from "@/features/owner/subjects";
import { classNameFor } from "@/features/teacher-view/class-name";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { roomNameFor } from "@/features/teacher-view/room-name";
import { sheetDowLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import {
  CLASS_STATUS_DEFAULT,
  classKindMeta,
  classStatusMeta,
  KIND_FILTERS,
  SORT_OPTIONS,
  STATUS_FILTERS,
  classSortArrow,
  type ClassKindFilter,
  type ClassSortAxis,
  teacherTeaches,
  type ViewMode,
} from "@/features/classes/list-filters";
import { NewClassTrigger } from "@/app/(shell)/classes/_components/new-class-trigger";
import { HeaderDayFilter } from "@/app/(shell)/classes/_components/header-day-filter";
import { SortArrow } from "@/components/sort-arrow";

const VIEW_OPTION_KEYS = [{ value: "cards" as ViewMode, key: "cls.view.cards" as const }];

/** /api/v2/classes가 내려 주는 값 — page.tsx 지역 변수 이름 그대로(resolved = 필터 해석 결과). */
export type ClassListData = {
  resolved: { status: ClassStatusFilter | "all"; q: string; page: number; kind: ClassKindFilter; subject: string; teacherId: string; teacherReset: boolean; days: string[]; sortChosen: ClassSort; sort: ClassSort; view: ViewMode };
  rows: ClassListRow[]; total: number; pageSize: number;
  stats: { total: number; active: number; totalSeats: number };
  teachers: { id: string; name: string; subjects: string[] }[];
  settings: { operations: { subjects: SubjectSetting[] } & Record<string, unknown>; modules: { disabled: string[] } };
  teacherNames: Record<string, string>; lang: SheetLang;
  viewer: { canManageClasses: boolean; scopedTeacherId: string | null };
};

/** page.tsx `ClassesPage`의 그리기 — sp = 주소의 쿼리(문자열 그대로). */
export function ClassesListPage({ data, sp }: { data: ClassListData; sp: Record<string, string | undefined> }) {
  const { status, q, page, kind, subject, teacherId, teacherReset, days, sort, view } = data.resolved;
  const { rows: classes, total, stats, teachers, settings, lang } = data;
  const canManageClasses = data.viewer.canManageClasses, scopedTeacherId = data.viewer.scopedTeacherId;
  const PAGE_SIZE = data.pageSize;

  // 과목 라벨·색·필터 옵션은 학원설정(operations.subjects) 단일 소스 — 미등록 과목은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects, lang);
  const subjectOptions = subjects.filters.filter((f) => f.value !== "all");
  // 담임 선택지 — 현재 과목 담당만(전체면 전부). 선택 담임이 목록 밖이면(직접 URL) 앞에 보강해 라벨을 유지한다.
  const visibleTeachers = subject === "all" ? teachers : teachers.filter((t) => teacherTeaches(t.subjects, subject));
  const selectedTeacher = teacherId === "all" ? null : teachers.find((t) => t.id === teacherId);
  const teacherNames = data.teacherNames;
  const displayTeacher = (name: string) => teacherNameFor(name, teacherNames, lang) ?? name;
  const teacherOptions = visibleTeachers.map((t) => ({ value: t.id, label: displayTeacher(t.name) }));
  if (selectedTeacher && !visibleTeachers.some((t) => t.id === selectedTeacher.id)) {
    teacherOptions.unshift({ value: selectedTeacher.id, label: displayTeacher(selectedTeacher.name) });
  }
  const showTeacher = !scopedTeacherId;
  const shownClasses = classes.map((klass) => ({ ...klass,
    className: classNameFor(klass.className, lang),
    teacherName: teacherNameFor(klass.teacherName, teacherNames, lang),
    classroomName: roomNameFor(klass.classroomName, lang),
  }));
  const totalSeats = stats.totalSeats;
  const active = stats.active;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const listParams = (patch: { page?: number; status?: string } = {}) => {
    const params = new URLSearchParams();
    const st = patch.status ?? status;
    if (st !== CLASS_STATUS_DEFAULT) params.set("status", st);
    if (sp.kind !== undefined) params.set("kind", sp.kind);
    else if (kind !== "all") params.set("kind", kind);
    if (sp.subject !== undefined) params.set("subject", sp.subject);
    else if (subject !== "all") params.set("subject", subject);
    if (teacherReset) params.set("teacher", "all"); // 푼 담임은 링크에서도 전체(옛 필터바의 URL 되돌림과 같은 뜻)
    else if (sp.teacher !== undefined) params.set("teacher", sp.teacher);
    else if (teacherId !== "all") params.set("teacher", teacherId);
    if (sp.days !== undefined) params.set("days", sp.days);
    else if (days.length) params.set("days", days.join(","));
    if (sp.sort !== undefined) params.set("sort", sp.sort);
    else if (sort !== "name") params.set("sort", sort);
    if (sp.view !== undefined) params.set("view", sp.view);
    else if (view !== "table") params.set("view", view);
    if (q) params.set("q", q);
    if ((patch.page ?? 1) > 1) params.set("page", String(patch.page));
    const s = params.toString();
    return s ? `/classes?${s}` : "/classes";
  };
  const pageHref = (p: number) => listParams({ page: p });
  const exportHref = `/api/exports/classes?${new URLSearchParams({
    ...(kind !== "all" ? { kind } : {}),
    ...(subject !== "all" ? { subject } : {}),
    ...(teacherId !== "all" ? { teacher: teacherId } : {}),
    ...(days.length ? { days: days.join(",") } : {}),
    ...(q ? { q } : {}),
    ...(sort !== "name" ? { sort } : {}),
    status,
  }).toString()}`;

  const sortLink = (axis: ClassSortAxis) => {
    const { active, dir, next } = classSortArrow(sort, axis);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) if (typeof value === "string" && key !== "page") params.set(key, value);
    params.set("sort", next);
    const label = sheetT(lang, SORT_OPTIONS.find((o) => o.value === next)!.key);
    return { active, dir, href: `/classes?${params}`, label };
  };
  const ariaSortOf = (axis: ClassSortAxis) => {
    const { active, dir } = classSortArrow(sort, axis);
    return active ? (dir === "asc" ? ("ascending" as const) : ("descending" as const)) : ("none" as const);
  };
  const head: HeadCells = {
    ariaSort: { name: ariaSortOf("name"), students: ariaSortOf("students"), teacher: ariaSortOf("teacher") },
    kind: (
      <HeaderFilter
        paramName="kind"
        value={kind}
        options={KIND_FILTERS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
        axisLabel={sheetT(lang, "cls.col.kind")}
        allValue="all"
        explicitAll
      />
    ),
    subject: (
      <HeaderFilter paramName="subject" value={subject} options={subjectOptions} axisLabel={sheetT(lang, "cls.filter.subject")} allValue="all" explicitAll />
    ),
    name: (
      <SortArrow {...sortLink("name")} hintId="classes-sort-name-hint">
        <span className="text-foreground">{sheetT(lang, "cls.col.name")}</span>
      </SortArrow>
    ),
    students: (
      <SortArrow {...sortLink("students")} hintId="classes-sort-students-hint">
        <span className="text-foreground">{sheetT(lang, "cls.col.students")}</span>
      </SortArrow>
    ),
    teacher: (
      <span className="inline-flex items-center gap-0.5">
        <HeaderFilter paramName="teacher" value={teacherId} options={teacherOptions} axisLabel={sheetT(lang, "cls.col.teacher")} allValue="all" explicitAll cap={200} />
        <SortArrow {...sortLink("teacher")} />
      </span>
    ),
    days: <HeaderDayFilter value={days} />,
    status: (
      <HeaderFilter
        paramName="status"
        value={status}
        options={STATUS_FILTERS.filter((o) => o.value !== CLASS_STATUS_DEFAULT).map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
        axisLabel={sheetT(lang, "cls.filter.status")}
        allValue={CLASS_STATUS_DEFAULT}
        allLabel={sheetT(lang, "cls.status.operating")}
        showAll
      />
    ),
  };

  return (
    <div className="space-y-5 compact-chrome:space-y-3">
      <PageHeader
        eyebrow={sheetT(lang, "cls.eyebrow")}
        title={sheetT(lang, "cls.title")}
        actions={
          <>
            {canManageClasses ? <NewClassTrigger /> : null}
          </>
        }
      />
      <StatStrip>
        <BigStat label={sheetT(lang, "cls.stat.total")} value={stats.total} unit={sheetT(lang, "cls.unit.class")} tone="primary" icon={<BookOpen size={16} strokeWidth={1.8} />} />
        <BigStat label={sheetT(lang, "cls.stat.active")} value={active} unit={sheetT(lang, "cls.unit.class")} tone="green" icon={<MenuGlyph name="check" size={22} />} />
        <BigStat label={sheetT(lang, "cls.stat.seats")} value={totalSeats} unit={sheetT(lang, "cls.unit.people")} tone="blue" icon={<Users size={16} strokeWidth={1.8} />} />
        <BigStat
          label={sheetT(lang, "cls.stat.avg")}
          value={stats.total > 0 ? Math.round(totalSeats / stats.total) : 0}
          unit={sheetT(lang, "cls.unit.people")}
          tone="gold"
          icon={<UserCheck size={16} strokeWidth={1.8} />}
        />
      </StatStrip>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          {sheetT(lang, "cls.count.pre")}
          <span className="text-foreground font-bold">{total}</span>
          {sheetT(lang, "cls.count.post")}
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
          {q ? <span className="ml-1.5">· {sheetTf(lang, "cls.count.q", { q })}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            paramName="view"
            value={view}
            options={VIEW_OPTION_KEYS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
            allValue="table"
            allLabel={sheetT(lang, "cls.view.table")}
            axisLabel={sheetT(lang, "cls.view")}
            ariaLabel={sheetT(lang, "cls.view")}
            explicitAll
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <SearchToggle placeholder={sheetT(lang, "cls.filter.searchPh")} defaultValue={q} />
          <ExcelMenu exportHref={exportHref} exportLabel={sheetT(lang, "stu.excel")} importKind={canManageClasses ? "classes" : null} />
        </div>
      </div>

      {view === "table" ? (
        <TableView classes={shownClasses} subjects={subjects} showTeacher={showTeacher} head={head} lang={lang} empty={emptyState(total, status, q, listParams, lang)} />
      ) : (
        <CardsView classes={shownClasses} subjects={subjects} showTeacher={showTeacher} head={head} lang={lang} empty={emptyState(total, status, q, listParams, lang)} />
      )}
      {total > 0 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
    </div>
  );
}

type HeadCells = {
  kind: React.ReactNode; subject: React.ReactNode; name: React.ReactNode; students: React.ReactNode;
  teacher: React.ReactNode; days: React.ReactNode; status: React.ReactNode;
  /** 정렬 열의 지금 상태 — 표 보기 `<th aria-sort>`(카드 보기엔 열이 없다). */
  ariaSort: Record<ClassSortAxis, "ascending" | "descending" | "none">;
};

/** 빈 상태 — 설명 문장 없이 제목만(§4). 기본 필터(운영)가 숨긴 것일 수 있어 '전체 상태로 보기' 링크 하나(폐지 42 · 종강 5 실재). */
function emptyState(
  total: number,
  status: string,
  q: string,
  listParams: (patch: { status?: string }) => string,
  lang: SheetLang,
): React.ReactNode {
  if (total > 0) return null;
  return (
    <EmptyState
      image="classes"
      icon={() => <SearchX size={32} strokeWidth={1.8} />}
      title={sheetT(lang, "cls.empty.title")}
      action={
        status === "all" ? undefined : (
          // 공용 <Button>(control-scale) — 세로 패딩으로 높이를 만들지 않는다(v5 ②, 리뷰 2026-09-04).
          <Button variant="outline" render={<Link href={listParams({ status: "all" })} />}>
            {sheetT(lang, "cls.empty.showAll")}
          </Button>
        )
      }
    />
  );
}

/**
 * 운영 요일 칩 + 시작시각. 모든 요일이 같은 시각이면 시각 1개만(월·수·금 14:30),
 * 요일마다 다르면 요일별로(월14:30 목16:20). 시각 정보가 목록에서 사라지던 격차 보강.
 */
function DayChips({
  days,
  barClass,
  stale = false,
  center = false,
  lang,
}: {
  days: ClassDaySlot[];
  barClass: string;
  lang: SheetLang;
  /** 표 칸에서 가운데로 — 열 제목(가운데)과 같은 축에 선다. 폰 카드(`phone:`)에선 왼쪽 그대로. */
  center?: boolean;
  /**
   * 지금 유효하지 않은 배치(운영 기간이 끝났거나 시작 전) — 흐리게 + 이유를 툴팁으로.
   * 🔴 진하게 그리면 "종료일을 넣었는데도 월~금 운영 중"으로 보인다([[#88]], 실측 7반).
   */
  stale?: boolean;
}) {
  if (days.length === 0) return <span className="text-text-faint text-sm">—</span>;
  const starts = days.map((d) => d.start).filter((s): s is string => !!s);
  const uniform = starts.length === days.length && new Set(starts).size === 1;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${center ? "justify-center phone:justify-start" : ""}`}
      {...(stale ? { title: sheetT(lang, "cls.staleTitle") } : {})}
    >
      {/* 요일 원 = 글자 14(xs 바닥)에 24px — 종전 20px 원은 글자가 12px이었다(v5: 12px 이하 금지). */}
      <div className={`flex gap-0.5 text-xs font-bold ${stale ? "opacity-45" : ""}`}>
        {days.map((d) => (
          <span
            key={d.day}
            /* ⚠️ 영어 요일은 세 글자(`Mon`)라 `size-5`(20px)에 안 들어간다 — 높이만 고정하고
               가로는 `min-w-5 px-1`로 늘린다(한 글자인 한국어는 20px 그대로 = 원형 유지). */
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${
              stale ? "bg-neutral-fill" : barClass
            } text-white`}
          >
            {sheetDowLabel(d.day, lang)}
          </span>
        ))}
      </div>
      {stale ? <span className="text-text-faint text-sm">{sheetT(lang, "cls.stale")}</span> : null}
      {uniform ? (
        <span className="text-text-dim num text-sm">{starts[0]}</span>
      ) : starts.length > 0 ? (
        <span className="text-text-faint num text-sm">
          {days
            .filter((d) => d.start)
            .map((d) => sheetTf(lang, "cls.dayAt", { dow: sheetDowLabel(d.day, lang), time: d.start ?? "" }))
            .join(" ")}
        </span>
      ) : null}
    </div>
  );
}

function TableView({
  classes,
  subjects,
  showTeacher,
  head,
  empty,
  lang,
}: {
  classes: ClassListRow[];
  subjects: SubjectMaps;
  /** 강사 스코프에선 전 행이 같은 담임(=본인)이라 열을 통째로 감춘다 — 같은 이름 50줄은 정보가 아니다. */
  showTeacher: boolean;
  head: HeadCells;
  empty: React.ReactNode;
  lang: SheetLang;
}) {
  const colCount = showTeacher ? 9 : 8;
  return (
    // 이 메뉴의 최소 창(1100)에 맞춘 고정 열(`table-fixed`)이라 창 안에선 가로 스크롤이 없다. 🔴 폰에서도 `overflow-x-auto` 상자로 싸지
    // 않는다(overflow-y까지 auto가 되어 열 머리 팝업이 잘린다 — 학생목록 주석). 폰(최상위 프레임 <768px)은 `.stack-rows`(globals.css)가
    // 열 머리를 필터 칩 줄로, 행을 [구분 · 과목 | 반 이름 | 상태] / [담임 · 강의실 · 요일 · 인원] / 메모 두세 줄 카드로 접는다(2026-09-13 모바일
    // 전수검사 — 그전엔 표 896px가 본문을 가로로 밀어 담임 뒤 열이 전부 화면 밖이었다). 칸의 자리는 `data-cell`이 정한다.
    // ⚠️ `max-md:min-w-[56rem]`은 **창(iframe) 안을 위해 남긴다**(학생목록 주석과 같은 이유 — 창을 768 아래로 스냅하면 종전대로 가로 스크롤).
    <div className="stack-rows bg-card shadow-card rounded-2xl">
      <table className="w-full table-fixed text-sm max-md:min-w-[56rem]">
        {/* 열 폭 — 최소 창(1050 본문)에서 **값이 걸린 열 머리**가 제 칸에 들어가는 폭(실측 2026-09-18): `상태: 종강 ⌄`(≈112px) 13% ·
            `구분: 특강 ⌄`·`과목: 수학 ⌄`(≈96px) 10%씩(머리 칸 좌우 여백을 `px-1`로 줄여서) — 7%로 두면 34px가 옆 칸으로 넘쳐
            제목이 값보다 23px 오른쪽에 섰다. 🔴 넘친 머리는 가운데 정렬이 안 먹어(넘치면 왼쪽부터 선다) 이 열의 요청 자체가 깨진다.
            요일 20%는 요일마다 시각이 다른 두 요일(`월16:20 목17:00`)이 한 줄에 서는 폭 — 그 몫을 메모(7%, 전문은 마우스 오버)에서 냈다.
            2026-10-14 정렬을 열 머리 화살표(24)로 옮기며 반 이름 열의 `정렬: 수업명순 ⌄`(≈140) 몫이 빠졌다 → 반 이름 18→15%(158 ≥ `반 이름` 52 + 화살표 24 + 여백 24)
            · 담임 8→10%(105 − 여백 8 ≥ `담임 ⌄` 66 + 화살표 24) · 학생 6→7%(73 − 여백 8 ≥ `학생` 32 + 화살표 24). 담임·학생 머리는 여백을
            `px-1`로 줄인다(`data-tight`). 강사 스코프(담임 열 없음)는 영어 화면의 `Students ↓`(≈92)가 들어가게 학생 10% · 반 이름 22%.
            ⚠️ 담임에 값이 걸리면(`담임: 이성우 ⌄` + 화살표 ≈137) 아직 옆 칸으로 넘친다 — 종전(8%)에도 넘치던 자리라 폭을 더 떼지 않았다. */}
        <colgroup>
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className={showTeacher ? "w-[15%]" : "w-[22%]"} />
          {showTeacher ? <col className="w-[10%]" /> : null}
          <col className="w-[8%]" />
          <col className="w-[20%]" />
          <col className={showTeacher ? "w-[7%]" : "w-[10%]"} />
          <col className="w-[13%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead className="border-line border-b">
          {/* 🔴 열 제목과 본문 값은 **같은 축(가운데)**에 선다(원장 2026-09-18 *"행제목과 밑에 내용이 어긋난거 같은데 정렬해주고"*) —
              08-05 표 규약은 "제목만 가운데, 본문은 왼쪽"이었는데 이 표는 칸이 넓어 제목과 값이 서로 다른 자리에 섰다
              (반 이름 제목이 값보다 80px 오른쪽). 폰 카드(`.stack-rows`)는 globals.css가 전부 왼쪽으로 되돌린다. */}
          {/* 앞 두 칸(구분·과목)과 화살표가 붙는 좁은 칸(`data-tight` — 담임·학생)은 좌우 여백을 줄인다 — `!`로 덮지 말 것(레이어 안
              important가 폰 카드의 `padding:0 !important`를 이긴다). */}
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold [&>th]:whitespace-nowrap [&>th:nth-child(-n+2)]:px-1 [&>th[data-tight]]:px-1">
            <th scope="col">{head.kind}</th>
            <th scope="col">{head.subject}</th>
            {/* 정렬은 열마다 화살표(반 이름 · 담임 · 학생 수) — 2026-10-14 반 이름 열의 '정렬' 드롭다운을 걷었다. */}
            <th scope="col" aria-sort={head.ariaSort.name}>{head.name}</th>
            {showTeacher ? (
              <th scope="col" aria-sort={head.ariaSort.teacher} data-tight="">
                {head.teacher}
              </th>
            ) : null}
            {/* 라벨만 있는 머리는 th 자체에 표식 — 폰 카드에선 열이 없어 열 이름이 뜻을 잃고, span만 감추면 0×0 th가 칩 줄 간격을 먹는다. */}
            <th scope="col" data-cell="label">
              <span className="px-1">{sheetT(lang, "cls.col.room")}</span>
            </th>
            <th scope="col">{head.days}</th>
            <th scope="col" aria-sort={head.ariaSort.students} data-tight="">
              {head.students}
            </th>
            <th scope="col">{head.status}</th>
            <th scope="col" data-cell="label">
              <span className="px-1">{sheetT(lang, "cls.col.notes")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {empty ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-4">
                {empty}
              </td>
            </tr>
          ) : null}
          {classes.map((c) => {
            const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
            const kind = classKindMeta(c);
            const st = classStatusMeta(c);
            return (
              <tr key={c.id} className="hover:bg-bg-soft/50 transition-colors [&>td]:px-3 [&>td]:py-2.5 [&>td]:text-center">
                {/* 구분·과목은 둘 다 앞 알약 — 폰 카드에서도 첫 줄 머리에 나란히 선다(`lead`). */}
                <td data-cell="lead">
                  <Pill color={kind.color}>{sheetT(lang, kind.key)}</Pill>
                </td>
                <td data-cell="lead">
                  <Pill color={meta.color}>{meta.label}</Pill>
                </td>
                <td data-cell="primary">
                  <span className="phone:justify-start flex min-w-0 items-center justify-center gap-1.5">
                    {/* 반 이름은 1차 식별자(18px 굵게) — 좁으면 잘리되 전문은 마우스 오버(title). */}
                    <WindowLink
                      href={`/classes/${c.id}`}
                      title={c.className}
                      className="text-foreground min-w-0 truncate text-base font-bold hover:underline"
                    >
                      {c.className}
                    </WindowLink>
                    <EditingBadge scope={`class:${c.id}`} />
                  </span>
                </td>
                {showTeacher ? (
                  <td className="text-text-dim">
                    <span className="block truncate">{c.teacherName ?? <span className="text-text-faint">{sheetT(lang, "cls.teacherNone")}</span>}</span>
                  </td>
                ) : null}
                {/* 빈 값(`—`)은 폰 카드에서 감춘다(data-empty) — 열 머리 글자가 없는 카드에선 대시가 무엇의 빈칸인지 알 수 없다. */}
                <td className="text-text-dim" data-empty={c.classroomName ? undefined : "true"}>
                  <span className="block truncate">{c.classroomName ?? "—"}</span>
                </td>
                <td data-empty={c.days.length === 0 ? "true" : undefined}>
                  <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} stale={c.daysStale} center lang={lang} />
                </td>
                <td className="text-foreground num font-bold whitespace-nowrap">
                  {c.studentCount}
                  {sheetT(lang, "cls.unit.people")}
                </td>
                <td data-cell="status">
                  <Pill color={st.color}>{sheetT(lang, st.key)}</Pill>
                </td>
                <td className="text-text-dim" data-cell="wide" data-empty={c.notes?.trim() ? undefined : "true"}>
                  {c.notes ? (
                    <span className="line-clamp-1" {...tipProps(c.notes)}>
                      {c.notes}
                    </span>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CardsView({
  classes,
  subjects,
  showTeacher,
  head,
  empty,
  lang,
}: {
  classes: ClassListRow[];
  subjects: SubjectMaps;
  /** 테이블 '담임' 열과 같은 이유 — 스코프에선 전 카드가 본인 이름이라 강의실만 남긴다. */
  showTeacher: boolean;
  head: HeadCells;
  empty: React.ReactNode;
  lang: SheetLang;
}) {
  return (
    <div className="space-y-3">
      {/* 카드 보기엔 표 머리가 없다 — 같은 열 머리 필터를 격자 위 한 줄에 세운다(필터가 보기마다 다른 자리에 있으면 안 된다). */}
      <div className="text-text-dim flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-sm font-bold">
        {head.kind}
        {head.subject}
        {head.name}
        {showTeacher ? head.teacher : null}
        {head.students}
        {head.days}
        {head.status}
      </div>
      {empty}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => {
          const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
          const kind = classKindMeta(c);
          const st = classStatusMeta(c);
          return (
            <WindowLink
              key={c.id}
              href={`/classes/${c.id}`}
              title={c.className}
              className="bg-card shadow-card hover:shadow-card-hover flex flex-col gap-3 rounded-2xl p-5 transition"
            >
              <header className="flex items-center gap-2">
                <Pill color={kind.color}>{sheetT(lang, kind.key)}</Pill>
                <Pill color={meta.color}>{meta.label}</Pill>
                <Pill color={st.color}>{sheetT(lang, st.key)}</Pill>
              </header>
              {/* 구조화 카드(문법 ⑤) — 반 이름 bold + 담임·강의실 dim 서브 + 우측 재원수 */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-foreground flex flex-wrap items-center gap-1.5 text-lg leading-tight font-bold">
                    {c.className}
                    <EditingBadge scope={`class:${c.id}`} />
                  </h3>
                  <p className="text-text-dim mt-1 truncate text-sm">
                    {showTeacher
                      ? `${c.teacherName ?? sheetT(lang, "cls.card.teacherNone")}${c.classroomName ? ` · ${c.classroomName}` : ""}`
                      : (c.classroomName ?? sheetT(lang, "cls.card.roomNone"))}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="num text-foreground text-xl leading-none font-bold">{c.studentCount}</span>
                  <span className="text-text-dim ml-0.5 text-sm">{sheetT(lang, "cls.unit.people")}</span>
                  <span className="text-text-faint block text-sm">{sheetT(lang, "cls.card.enrolled")}</span>
                </p>
              </div>
              <div className="mt-auto pt-1">
                <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} stale={c.daysStale} lang={lang} />
              </div>
            </WindowLink>
          );
        })}
      </div>
    </div>
  );
}
