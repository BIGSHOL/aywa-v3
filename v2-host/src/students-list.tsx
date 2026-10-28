// 2.0 원생목록(app/(shell)/students/page.tsx)의 조립 — 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회는
// /api/v2/students(Docker 복사본, v2-students-list.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(students-list.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-students-list.mjs가 2.0 본문에
// 같은 짝을 대어 이 파일과 글자를 대조한다.
// ⚠️ 빠진 것(swaps.json removed): makeedu 동기화 배지(MakeeduSyncBadge — 서버 컴포넌트) · 계정 보기 설정 저장(RememberPrefs — 3.0엔 계정이 없어 주소로만).
// 화면 주인 = 원장(강사 범위 없음 · 화면 언어 한국어) — 권한·담임 선택지·카드 숫자·쪽은 서버가 2.0 함수로 계산해 data로 내려 준다.
import { Users } from "@/components/icons/aywa-icon-compat";
import { isModuleEnabled } from "@/lib/modules";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { EditingBadge } from "@/features/presence/editing-badge";
import { FilterSelect } from "@/components/filter-select";
import { HeaderFilter } from "@/components/header-filter";
import { SearchToggle } from "@/components/search-toggle";
import { EmbedLink } from "@/components/embed-link";
import { ToolbarChip } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { StudentListRow, StudentSort } from "@/features/students/server/queries";
import {
  subjectAxisOf,
  narrowSubjectFilters,
  showSubjectFilter,
  coerceSubjectFilter,
} from "@/features/students/scope-axis";
import {
  DEFAULT_STUDENT_LIST_PREFS,
  dashboardExitParams,
  parseSearchField,
  parseStudentSort,
  studentListPrefsFromUrl,
  type StudentListPrefs,
} from "@/features/students/list/list-prefs";
import { WindowLink } from "@/components/workspace/window-link";
import { PageHeader } from "@/components/page-header";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import { studentStatusMeta } from "@/features/students/status/status-labels";
import { sheetT, sheetTf } from "@/features/teacher-view/i18n";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { buildSubjectMaps, type SubjectSetting } from "@/features/owner/subjects";
import { NewStudentTrigger } from "@/app/(shell)/students/_components/new-student-trigger";
import { StudentsMoreMenu } from "@/app/(shell)/students/_components/students-more-menu";
import { EyIcon } from "@/components/icons/aywa-icons";
import { isValidYmd } from "@/lib/date-kst";
import { parseProgram, programLabel, type Program } from "@/features/students/enrollment/program";
import {
  NO_SUBJECT,
  joinMulti,
  levelLabel,
  mixLabel,
  parseLevels,
  parseMixes,
  parseMulti,
  type StudentLevel,
  type StudentMixFilter,
} from "@/features/students/list-filter-values";
import { EnrolledStatCard } from "@/app/(shell)/students/_components/enrolled-stat-card";
import { SortArrow } from "@/components/sort-arrow";

/** /api/v2/students가 내려 주는 값 — page.tsx가 서버에서 받던 값(지역 변수 이름 그대로). resolved = 서버가 해석한 필터(시험·대조용). */
export type StudentListData = {
  viewer: { id: string; name: string; systemRole: string; tenantId: string };
  canManageStudent: boolean;
  scope: null;
  prefsLoaded: StudentListPrefs | null;
  teachers: { id: string; displayName: string }[];
  settings: { operations: { subjects: SubjectSetting[]; gradeLevels: string[] } & Record<string, unknown>; modules: { disabled: string[] } };
  counts: { enrolled: number; bySubject: Record<string, number>; combinations: { subjects: string[]; value: number }[] };
  page: { rows: StudentListRow[]; total: number; hiddenNotStarted: number };
  lang: "ko";
  teacherNames: Record<string, string>;
  resolved?: Record<string, unknown>;
};

// 상태 — 디폴트(재원)는 파라미터가 없을 때다(검색 중이면 디폴트 = 전체, 아래 statusDefault). "전체"는 명시적 status=all로만.
// 문구는 **사전 키**만 든다 — 화면 언어(강사 미니셸)가 영어면 그대로 따라간다.
const STATUS_OPTION_KEYS = [
  { value: "all", key: "stu.filter.all" },
  { value: "consulted", key: "stu.filter.status.consulted" },
  { value: "on_hold", key: "stu.filter.status.onHold" },
  { value: "withdrawn", key: "stu.filter.status.withdrawn" },
] as const;
const FIELD_OPTION_KEYS = [
  { value: "name", key: "stu.filter.field.name" },
  { value: "school", key: "stu.filter.field.school" },
  { value: "phone", key: "stu.filter.field.phone" },
  { value: "parent", key: "stu.filter.field.parent" },
  { value: "address", key: "stu.filter.field.address" },
  { value: "email", key: "stu.filter.field.email" },
  { value: "memo", key: "stu.filter.field.memo" },
] as const;
const PAGE_SIZE = 50;
/** 정렬 화살표의 읽어 주는 이름 = 누르면 걸릴 정렬(사전 키 — 강사 미니셸 영어 화면도 따라간다). */
const SORT_LABEL_KEY = {
  name: "stu.sort.name.asc",
  name_desc: "stu.sort.name.desc",
  grade: "stu.sort.grade.asc",
  grade_desc: "stu.sort.grade.desc",
} as const satisfies Record<StudentSort, string>;

/** 운영실 '재원생 구성' 칩 글자 — `초등 · 영어만·동시수강`(학교급·수강 구성 라벨은 list-filter-values 한 곳). */
function compositionChipLabel(levels: readonly StudentLevel[], mixes: readonly StudentMixFilter[]): string {
  return [levels.map(levelLabel).join("·"), mixes.map(mixLabel).join("·")].filter(Boolean).join(" · ");
}

export function StudentsListPage({
  data,
  sp: searchParams,
}: {
  data: StudentListData;
  sp: {
    status?: string;
    subject?: string;
    q?: string;
    page?: string;
    grade?: string;
    teacher?: string;
    field?: string;
    sort?: string;
    noenr?: string;
    program?: string;
    first?: string;
    /** 운영실 '재원생 구성' 막대 조각 — 학교급(`elem,middle`)·수강 구성(`englishOnly,both`). 칩으로만 푼다. */
    level?: string;
    mix?: string;
    from?: string;
  };
}) {
  const user = data.viewer;
  // 학생 생성(새 학생·엑셀 가져오기) = full만 — 강사(scoped)는 열람 전용(원장 지시 2026-08-18).
  // 서버 액션(createStudent·import-actions)도 같은 full 판정이라 UI 숨김은 이중 방어다(#77).
  const canManageStudent = data.canManageStudent;
  const sp = searchParams;
  // 상태 필터 디폴트 = 재원(운영에서 당장 중요한 건 재원생). "전체"는 명시적 status=all로만. 🔴 상태는 저장하지 않는다.
  // 🔑 **검색 중이면 디폴트 = 전체**(원장 2026-10-20 *"검색하면 디폴트를 전체원생 기준으로"*) — 퇴원·휴원생을 찾다가
  //    "없음"으로 오인하지 않게. 명시적으로 고른 상태(`status=enrolled` 포함)는 검색 중에도 그대로 따른다.
  const searching = (sp.q ?? "").trim() !== "";
  const statusDefault = searching ? "all" : "enrolled";
  const status = sp.status ?? statusDefault;
  // 보기 설정은 계정 귀속(users.ui_prefs.students, 원장 2026-08-04) — URL(명시값) → 저장값 → 기본값.
  // 표시 축(원장 2026-08-20) — 강사 스코프면 **담당 과목**으로 축을 좁힌다(관리자·담당 반 0개는 null=종전 동일).
  const [scope, prefsLoaded] = [data.scope, data.prefsLoaded];
  // 조회 실패(null)면 기본값으로 그리되 **이번 렌더는 저장하지 않는다** — 기본값을 저장값으로 알고 전체를 보내면 다른 축이 지워진다(리뷰 2026-09-04).
  const prefs = prefsLoaded ?? DEFAULT_STUDENT_LIST_PREFS;
  const axis = subjectAxisOf(scope);
  // 🔴 과목 필터를 감춘 화면(담당 과목 1개)에선 걸려 있던 값을 "전체"로 되돌린다 — 저장된 필터·직접 URL이 남아 있으면
  // 되돌릴 컨트롤이 없는데 행이 조용히 빠진다(축 밖 과목이면 0명 · 축 안 과목이어도 **휴원 학생이 사라진다**).
  const subjectRaw = coerceSubjectFilter(axis, sp.subject ?? prefs.subject);
  const q = sp.q ?? "";
  const gradeRaw = sp.grade ?? prefs.grade;
  const teacherRaw = sp.teacher ?? prefs.teacher;
  const field = parseSearchField(sp.field ?? prefs.field);
  const sort = parseStudentSort(sp.sort ?? prefs.sort);
  // URL은 명시적으로 `noenr=0`도 적는다(저장값을 이기려면 "없음"이 아니라 값이어야 한다).
  const excludeNoEnrollment = (sp.noenr ?? (prefs.noenr ? "1" : "0")) === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  // 운영실 KPI ↗ — 프로그램·첫 수업 집합. 모르는 값·달력에 없는 날짜는 무시(필터 없음, 칩도 없음).
  const program = parseProgram(sp.program);
  const firstDay = isValidYmd(sp.first) ? sp.first : null;
  const levels = parseLevels(sp.level);
  const mixes = parseMixes(sp.mix);
  // from=dashboard = 운영실 링크가 모든 축을 명시값(전체)으로 적은 **들어온 그 화면** — 그 렌더는 보기 설정을 저장하지 않는다
  // (저장하면 사용자가 골라 둔 학년·과목 필터가 운영실 링크 한 번에 지워진다). 필터를 바꾸면 from이 떨어진다(아래 exit·leave).
  const fromDashboard = sp.from === "dashboard";
  const restrictPromise = null;

  // 담임 필터 선택지 — 강사 스코프에선 **내 학생의 담당 과목 반 담당**만(고르면 결과가 0인 선택지 방지 +
  // 아래 '담당 강사' 열에 실제로 나오는 이름과 일치). 관리자면 종전 학원 전체 목록.
  const teacherOptionsPromise: { id: string; displayName: string }[] = data.teachers;
  const settingsPromise = data.settings;
  // 재원 통계는 지금 띄워 두고 맨 끝에 받는다 — 아래 저장값 검증이 기다리는 건 선택지(담임·학원설정) 둘뿐이라 통계까지 묶으면
  // 목록 조회가 통계를 기다린다(재리뷰 2026-09-03, B4). 그 사이 거절돼도 미처리 거절로 새지 않게 표식만 붙인다(값은 끝에서 받는다).
  const statCountsPromise = data.counts;
  const optionsPromise = [teacherOptionsPromise, settingsPromise] as const;
  // 저장값(URL이 아니라 계정 설정에서 온 값)은 **지금 선택지에 있을 때만** 쓴다 — 퇴사한 담임·학원설정에서 지운 학년·흡수된 과목이
  // 보이지 않는 필터로 남아 결과를 0명으로 만들지 않게(리뷰 확정 2026-09-03: 열 머리는 '학년'인데 0명). URL로 고른 값은 그대로
  // 믿는다(그 경우 목록 조회가 설정 조회를 기다리지 않는다, B4).
  let teacherId = teacherRaw;
  let grade = gradeRaw;
  let subject = subjectRaw;
  const fromPrefs = (key: "teacher" | "grade" | "subject") => sp[key] === undefined;
  if (
    (fromPrefs("teacher") && teacherRaw !== "all") ||
    (fromPrefs("grade") && gradeRaw !== "all") ||
    (fromPrefs("subject") && subjectRaw !== "all")
  ) {
    const [teachersEarly, settingsEarly] = optionsPromise;
    // 다중 선택(원장 2026-09-28)이라 **값마다** 본다 — 선택지 밖 값만 떨어지고 남은 게 없으면 "전체".
    const keepKnown = (raw: string, known: (v: string) => boolean) => joinMulti(parseMulti(raw).filter(known));
    if (fromPrefs("teacher")) teacherId = keepKnown(teacherRaw, (v) => teachersEarly.some((t) => t.id === v));
    if (fromPrefs("grade")) grade = keepKnown(gradeRaw, (v) => settingsEarly.operations.gradeLevels.includes(v));
    if (fromPrefs("subject"))
      subject = keepKnown(subjectRaw, (v) => v === NO_SUBJECT || settingsEarly.operations.subjects.some((s) => s.key === v));
  }
  // 수강 과목 = '미수강'(원장 2026-09-28) — 퇴원 목록에선 뜻이 없어(전원 미수강) 서버가 무시하고 선택지도 안 세운다.
  const wantsNoSubject = status !== "withdrawn" && parseMulti(subject).includes(NO_SUBJECT);

  const [{ rows, total, hiddenNotStarted }, counts, [teachers, settings]] = [data.page, statCountsPromise, optionsPromise];
  const [lang, teacherNames] = [data.lang, data.teacherNames];
  const showTeacher = (n: string) => teacherNameFor(n, teacherNames, lang) ?? n;
  const { enrolled, bySubject } = counts;
  // 과목·학년 필터·라벨·색은 학원설정(operations) 단일 소스 — 미등록 값은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects, lang);
  // 강사 스코프면 과목 선택지도 담당 과목만. 고를 게 1개뿐이면 필터 자체를 감춘다(잡음).
  // 맨 끝 '미수강' = 지금 수강 중인 과목이 하나도 없는 학생(운영실 '재원생 구성'의 미수강 막대와 같은 판정). 퇴원 목록엔 안 세운다.
  const subjectOptions = [
    ...narrowSubjectFilters(axis, subjects.filters).filter((f) => f.value !== "all"),
    ...(status !== "withdrawn" ? [{ value: NO_SUBJECT, label: sheetT(lang, "stu.filter.subject.none") }] : []),
  ];
  // 검색 중엔 디폴트가 '전체'라 선택지를 뒤집는다 — '재원'이 명시값(status=enrolled)이 되고 '전체'가 파라미터 없음이다
  // (안 뒤집으면 '재원'을 골라도 allValue라 파라미터가 지워져 다시 전체가 된다).
  const statusOptions = (
    searching
      ? [{ value: "enrolled", key: "stu.filter.status.enrolled" as const }, ...STATUS_OPTION_KEYS.filter((o) => o.value !== "all")]
      : STATUS_OPTION_KEYS
  ).map((o) => ({ value: o.value, label: sheetT(lang, o.key) }));
  const hideSubjectFilter = !showSubjectFilter(axis);
  const gradeOptions = settings.operations.gradeLevels.map((g) => ({ value: g, label: sheetSchoolGrade(null, g, lang) }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: showTeacher(t.displayName) }));
  // 담임 필터 — 스코프에서 고를 사람이 나 하나뿐이면 감춘다(전체/나 = 같은 결과).
  // ⚠️ 이미 값이 걸려 있으면 남겨 둔다 — 감추면 "전체"로 되돌릴 길이 없다.
  const hideTeacherFilter = axis !== null && teacherOptions.length <= 1 && teacherId === "all";

  // 저장할 보기 설정 — 저장값과 다르면 클라가 한 번 저장한다(공용 RememberPrefs — 수업목록과 한 벌). 🔴 **사용자가 고른 값(URL) 또는 이미 저장된 값**만 —
  // 위 보정(축 밖 과목 → 전체 · 선택지 밖 담임/학년 → 전체)은 이 화면 한정이라 계정에 쓰지 않는다(리뷰 확정 2026-09-03: 겸직 관리자가
  // 강사뷰·다른 강사 뷰를 열면 보정값이 관리자 본인의 저장 설정을 덮어썼다).
  // 🔑 저장값과 **같은 파서**를 지난다 — `?subject=`(빈 값)처럼 파서가 접는 값을 원문 그대로 두면 저장값과 영영 달라 렌더마다 저장한다.
  //    URL 값이 선택지 밖(옛 링크의 모르는 정렬·검색 범위)이면 보여 주기만 하고 저장값은 유지(리뷰 2026-09-04).
  const current: StudentListPrefs = studentListPrefsFromUrl(sp, prefs);

  /**
   * 목록 링크(쪽 넘김·미수강 토글)가 들고 갈 파라미터 — 기본값과 다르거나 **URL이 명시한** 축은 그대로 적는다.
   * 저장값에서 온 축도 값이 기본값과 다르면 적히므로, 링크를 따라가도 지금 보는 필터가 그대로다.
   * ⚠️ URL이 적은 과목은 **적힌 그대로** 잇는다(위 축 보정값이 아니라) — 보정값을 링크에 실으면 다음 렌더가 그것을 사용자 선택으로
   * 읽어 계정에 저장한다(재리뷰 2026-09-03). **정렬·검색 범위**도 파서가 보정하는 축이라 같이 원값으로 잇는다
   * (재리뷰 2026-09-04). 학년·담임은 URL 값이면 보정하지 않으니 그대로다.
   */
  // 운영실에서 온 화면(from=dashboard)에서 **필터를 바꿀 때** 함께 뗄 파라미터 — from과 바꾸지 않은 운영실 명시 축(D1).
  // 떼인 축은 다음 렌더에서 저장값으로 돌아가 RememberPrefs가 바꾼 축만 저장한다. 운영실에서 온 화면이 아니면 빈 목록.
  const exit = (param: string) => dashboardExitParams(fromDashboard, param);
  const listParams = (
    patch: {
      page?: number;
      noenr?: boolean;
      program?: Program | null;
      first?: string | null;
      /** 운영실 '재원생 구성' 조각(학교급·수강 구성) — null이면 둘 다 푼다(칩 하나). */
      composition?: null;
      leave?: boolean;
      /** 검색어(q)만 뺀다. 저장된 필터·페이지 언어는 그대로 둔다. */
      clearQ?: boolean;
    } = {},
  ) => {
    const params = new URLSearchParams();
    // 🔑 필터를 바꾸는 링크(leave)는 운영실 방문 표식과 운영실이 적은 축을 뗀다(위 exit와 같은 규칙).
    //    쪽 넘김은 필터 변경이 아니라 그대로 운영실 방문으로 남는다(저장 안 함).
    const leaving = fromDashboard && !!patch.leave;
    // 운영실 KPI 집합(프로그램·첫 수업)은 쪽 넘김·토글에도 따라간다(칩으로만 푼다).
    const programParam = patch.program === undefined ? program : patch.program;
    if (programParam) params.set("program", programParam);
    const firstParam = patch.first === undefined ? firstDay : patch.first;
    if (firstParam) params.set("first", firstParam);
    if (patch.composition !== null) {
      if (levels.length > 0) params.set("level", levels.join(","));
      if (mixes.length > 0) params.set("mix", mixes.join(","));
    }
    if (fromDashboard && !leaving) params.set("from", "dashboard");
    // 상태는 **URL이 적은 값만** 잇는다 — 디폴트는 검색어 유무로 갈리므로(검색 중 전체) 디폴트를 적으면 검색을 지운 뒤에도 전체가 남는다.
    if (sp.status !== undefined) params.set("status", sp.status);
    if (!leaving) {
      if (sp.subject !== undefined) params.set("subject", sp.subject);
      else if (subject !== DEFAULT_STUDENT_LIST_PREFS.subject) params.set("subject", subject);
      if (grade !== DEFAULT_STUDENT_LIST_PREFS.grade || sp.grade !== undefined) params.set("grade", grade);
      if (teacherId !== DEFAULT_STUDENT_LIST_PREFS.teacher || sp.teacher !== undefined) params.set("teacher", teacherId);
    }
    if (sp.field !== undefined) params.set("field", sp.field);
    else if (field !== DEFAULT_STUDENT_LIST_PREFS.field) params.set("field", field);
    if (sp.sort !== undefined) params.set("sort", sp.sort);
    else if (sort !== DEFAULT_STUDENT_LIST_PREFS.sort) params.set("sort", sort);
    if (patch.noenr !== undefined) params.set("noenr", patch.noenr ? "1" : "0");
    else if (!leaving && (excludeNoEnrollment || sp.noenr !== undefined)) {
      params.set("noenr", excludeNoEnrollment ? "1" : "0");
    }
    if (q && !patch.clearQ) params.set("q", q);
    if (!patch.clearQ && (patch.page ?? 1) > 1) params.set("page", String(patch.page));
    const s = params.toString();
    return s ? `/students?${s}` : "/students";
  };
  const pageHref = (p: number) => listParams({ page: p });
  // 열 머리 정렬 화살표(원장 2026-10-14) — 다른 열이면 그 열 오름차순, 같은 열이면 방향을 뒤집는다.
  // 🔴 주소는 **지금 주소 그대로에 sort만** 바꾼다(종전 정렬 드롭다운 = FilterSelect와 같다) — listParams로 만들면 저장값에서 온
  //    축의 **보정값**(강사뷰의 담당 과목 축 등)이 주소에 적혀 RememberPrefs가 계정 저장값을 덮는다(2026-09-03 리뷰가 막은 결함).
  //    운영실에서 들어온 화면이면 방문 표식·운영실 축을 뗀다(exit — 종전 드롭다운의 clearParams와 같다). 쪽은 처음으로.
  const sortArrow = (axis: "name" | "grade") => {
    const active = sort === axis || sort === `${axis}_desc`;
    const dir: "asc" | "desc" = sort === `${axis}_desc` ? "desc" : "asc";
    const next: StudentSort = active && dir === "asc" ? `${axis}_desc` : axis;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) if (typeof value === "string" && key !== "page") params.set(key, value);
    for (const key of exit("sort")) params.delete(key);
    params.set("sort", next);
    return { active, dir, href: `/students?${params}`, label: sheetT(lang, SORT_LABEL_KEY[next]) };
  };
  const ariaSortOf = (axis: "name" | "grade") =>
    sort === axis ? ("ascending" as const) : sort === `${axis}_desc` ? ("descending" as const) : ("none" as const);
  // 엑셀 API는 저장값을 모른다 — 지금 걸린 값 중 기본값이 아닌 것만 그대로 넘긴다(옛 링크와 같은 모양).
  const exportHref = `/api/exports/students?${new URLSearchParams({
    ...(status !== "all" ? { status } : {}),
    ...(subject !== "all" ? { subject } : {}),
    ...(q ? { q } : {}),
    ...(grade !== "all" ? { grade } : {}),
    ...(teacherId !== "all" ? { teacher: teacherId } : {}),
    ...(field !== "all" ? { field } : {}),
    ...(sort !== "grade" ? { sort } : {}),
    ...(excludeNoEnrollment ? { noenr: "1" } : {}),
    // 운영실 KPI 집합도 넘긴다 — 라우트가 같은 restrictIdsFor로 좁혀 파일 행 = 목록 행.
    ...(program ? { program } : {}),
    ...(firstDay ? { first: firstDay } : {}),
    ...(levels.length > 0 ? { level: levels.join(",") } : {}),
    ...(mixes.length > 0 ? { mix: mixes.join(",") } : {}),
  }).toString()}`;

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* 머리 — 지시서 §10: 상시 버튼은 Primary('새 학생') 하나. 엑셀 버튼은 **검색 줄**(공용 ExcelMenu)
          (원장 2026-09-29 탭 통일). 동기화 배지는 읽기 전용 표식이라 그대로. */}
      <PageHeader
        eyebrow={sheetT(lang, "stu.eyebrow")}
        title={sheetT(lang, "stu.title")}
        description={sheetTf(lang, "stu.desc", {
          n: enrolled,
          basis: sheetT(lang, axis ? "stu.basis.mine" : "stu.basis.settings"),
        })}
        actions={
          <>
            {canManageStudent ? <NewStudentTrigger /> : null}
          </>
        }
      />
      {/* 핵심 수치 — 재원 총원 + 과목별 재원생 비중(전체/퇴원은 상태 필터로). 과목이 늘어도 카드 1장 고정.
          재원생 0명 과목은 숨김(미운영 과목 노이즈 방지), 인원 내림차순. */}
      <EnrolledStatCard
        // 원생 통계 입구 — 강사(내 학생 축) 화면은 통계를 보이지 않으므로 세우지 않는다(load.ts teacherScoped).
        statsHref={scope ? null : "/students/stats"}
        enrolled={enrolled}
        subjects={subjects.options
          .map((s) => ({
            key: s.value,
            label: s.label,
            color: subjects.colorOf(s.value),
            count: bySubject[s.value] ?? 0,
          }))
          .filter((s) => s.count > 0)
          .sort((a, b) => b.count - a.count)}
      />

      {/* 결과 줄 — 숫자 + 토글 하나('미수강 제외', 자주 바꾸는 것 하나만 §10) + 검색(눌러야 나온다, 검색 필드는 열었을 때만).
          필터·정렬은 여기 없다 — 아래 표의 **열 머리**가 필터다(§10 "필터·정렬은 목록 헤더 라벨을 눌러 호출"). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          {sheetT(lang, "stu.count.pre")}
          <span className="text-foreground font-bold">{total}</span>
          {sheetT(lang, "stu.count.post")}
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
          {q ? <span className="ml-1.5">· {sheetTf(lang, "stu.count.q", { q })}</span> : null}
          {/* '실시간 재원생'(원장 2026-09-16) — 아직 한 과목도 시작 안 한 학생은 재원 목록·총원에서 빠진다.
              🔴 **조용히 빼지 않는다**: 왜 빠졌고 어디서 볼 수 있는지 한 마디로 밝힌다
              (검색해도 안 나오는데 이유가 없으면 "학생이 사라졌다"가 된다 — [[#105]]).
              ⚠️ **인원수는 안 적는다** — `hiddenNotStarted`는 이 학생 전체 수라, 과목·학년·검색이 함께
                 걸려 있으면 "N명 제외"가 실제로 빠진 수와 달라진다(숫자가 거짓말하는 자리). */}
          {hiddenNotStarted > 0 ? (
            <span className="text-amber ml-1.5">· {sheetT(lang, "stu.count.notStarted")}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* 운영실 KPI ↗가 건 집합 — 칩을 누르면 그 조건만 푼다(나머지 필터는 그대로). */}
          {program ? (
            <ToolbarChip active href={listParams({ program: null, leave: true })}>
              {sheetT(lang, "stu.filter.program")}: {programLabel(program, settings.operations.subjects, isModuleEnabled(settings.modules.disabled, "eie"))}
              <EyIcon name="close" size={12} aria-hidden />
            </ToolbarChip>
          ) : null}
          {levels.length > 0 || mixes.length > 0 ? (
            <ToolbarChip active href={listParams({ composition: null, leave: true })}>
              {sheetT(lang, "stu.filter.composition")}: {compositionChipLabel(levels, mixes)}
              <EyIcon name="close" size={12} aria-hidden />
            </ToolbarChip>
          ) : null}
          {firstDay ? (
            <ToolbarChip active href={listParams({ first: null, leave: true })}>
              {sheetTf(lang, "stu.filter.first", {
                m: Number(firstDay.slice(5, 7)),
                d: Number(firstDay.slice(8, 10)),
              })}
              <EyIcon name="close" size={12} aria-hidden />
            </ToolbarChip>
          ) : null}
          {/* 상태=퇴원에선 숨김 — 퇴원생은 활성 수강이 없어 이 토글이 켜져 있으면 전원이 걸러져
              "검색해도 항상 0명"이 된다(2026-08-18 실사고). 서버(getStudentsPage)도 같은 조건에서 무시. */}
          {/* 수강 과목에 '미수강'을 골랐으면 감춘다 — 둘은 서로 반대라 함께 걸면 늘 0명이고, 서버도 그땐 이 토글을 무시한다. */}
          {status !== "withdrawn" && !wantsNoSubject ? (
            <span data-help="st-unenrolled">
            <ToolbarChip active={excludeNoEnrollment} href={listParams({ noenr: !excludeNoEnrollment, leave: true })}>
              {sheetT(lang, "stu.filter.noEnr")}
            </ToolbarChip>
            </span>
          ) : null}
          <span data-help="st-search">
          <SearchToggle
            key={q}
            placeholder={sheetT(lang, "stu.filter.searchPh")}
            defaultValue={q}
            extra={
              <FilterSelect
                paramName="field"
                clearParams={exit("field")}
                value={field}
                options={FIELD_OPTION_KEYS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
                allValue="all"
                allLabel={sheetT(lang, "stu.filter.field.all")}
                axisLabel={sheetT(lang, "stu.filter.field")}
                ariaLabel={sheetT(lang, "stu.filter.field")}
                explicitAll
                className="w-auto"
                triggerClassName={TOOLBAR_SELECT}
              />
            }
          />
          </span>
          {/* 엑셀(공용 ExcelMenu) — 검색과 같은 줄(원장 2026-09-29 통일). 가져오기는 full만. */}
          <StudentsMoreMenu exportHref={exportHref} canImport={canManageStudent} />
        </div>
      </div>

      {/* 🔴 표는 결과가 0명이어도 그린다 — 열 머리가 곧 필터라, 표를 치우면 걸린 필터를 되돌릴 컨트롤이 함께 사라진다
          (실브라우저 검증 2026-09-03: 휴원+학년 '7세'로 0명이 되자 학년을 풀 길이 없었고 저장값이라 다음 방문에도 0명이었다).
          빈 상태는 표 본문 안에 선다. */}
      <>
          {/* 표 — 이 메뉴의 최소 창(960)에 맞춘 고정 열(`table-fixed`)이라 창 안에선 가로 스크롤이 없다. 🔴 폰에서도 `overflow-x-auto`
              상자로 싸지 않는다 — overflow-x가 auto면 overflow-y도 auto가 되어 열 머리 팝업(absolute)이 짧은 표 안에서 잘린다(리뷰 2026-09-04;
              폰에선 이 팝업이 유일한 필터다). 폰(최상위 프레임 <768px)은 `.stack-rows`(globals.css)가 열 머리를 필터 칩 줄로, 행을
              [이름 | 상태] / [학교·학년 · 과목 · 담당 강사 · 연락처] 두 줄 카드로 접는다(2026-09-13 모바일 전수검사 — 그전엔 표 736px가
              본문을 가로로 밀어 상태 뒤 열이 전부 화면 밖이었다). 칸의 자리는 `data-cell`이 정한다. ⚠️ `max-md:min-w-[46rem]`은
              **창(iframe) 안을 위해 남긴다** — 창을 768 아래로 스냅하면 `.stack-rows`가 안 걸리고(창 제외 스코프) 이 min-w가 종전대로 표를
              736px로 지켜 창이 가로로 스크롤한다(`WindowMinSizeNotice`의 "가로 스크롤로" 안내와 일치). 폰에선 `.stack-rows`가 이 값을 덮는다.
              행 = 이름 + 학교·학년 + 상태 + 과목 + 담당 강사 + 연락처 한 줄, 행 사이 헤어라인(§11). 이름과 학교·학년은 다른 열이다
              (원장 2026-10-14 *"이름과 학교학년 열 분리"* — 한 칸에 붙여 두면 이름 길이마다 학교·학년의 시작점이 달라 위아래로 못 훑는다). */}
          <div className="stack-rows bg-card shadow-card rounded-2xl">
            <table className="w-full table-fixed text-sm max-md:min-w-[46rem] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
              {/* 열 폭 — 2026-10-14 이름·학교·학년 열 분리 때 Pretendard로 다시 잰 값(표 폭 935 = 최소 창 960, 칸 내용 폭 = 열폭 − th px-3 24).
                  머리 트리거 = 굵게 16px 라벨 + 크롬 32(px-1 8 + gap-2 8 + 쉐브론 16). 🔴 트리거는 **말줄임되지 않고 넘친다**(바깥 상자가
                  `inline-block w-auto`) — 넘쳐도 가운데 정렬이라 양쪽 th 여백(12px씩) 안이면 옆 칸 글자와 겹치지 않는다.
                  2026-10-14 정렬을 열 머리 화살표(22)로 옮기며 이름 열의 드롭다운 몫을 학교·학년 열로, 상태 열 여유를 이름 열로 넘겼다:
                  이름 17% → 135 ≥ `이름` 36 + 2 + 화살표 22 = 60(값 = 이름 + 동명이인 접미사 · '수정 중' 꼬리표 — 종전 154에서 19 줄었다) /
                  학교·학년 16% → 126 ≥ `학년: 중1 ⌄` 89 + 2 + 화살표 22 = 113·값 `대구외국어고1` 90(학년 여럿 `학년: 중1 외 1 ⌄` 142는 여백 안) /
                  상태 15% → 116 ≥ `상태: 재원 ⌄` 96(`상태: 예비·상담 ⌄` 128은 여백 안 — 양쪽 6 ≤ 12) /
                  과목 18% → 144 ≥ `수강 과목: 수학 ⌄` 127(기본 과목 `수학(심화)` 167은 여백 안 — 16%였을 땐 담당 강사 글자와 겹쳤다) /
                  담당 강사 18% → 144 ≥ `담당 강사: 이수진 ⌄` 141 / 연락처 16% → 126 ≥ `010-0000-0000`(고정폭 숫자) 122. */}
              <colgroup>
                <col className="w-[17%]" />
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="border-line border-b">
                {/* 열 제목과 값은 같은 축(가운데 — 원장 2026-09-18). 폰 카드(`.stack-rows`)는 globals.css가 전부 왼쪽으로 되돌린다. */}
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold [&>th]:whitespace-nowrap">
                  <th scope="col" aria-sort={ariaSortOf("name")}>
                    {/* 정렬은 열마다 오름·내림 화살표(원장 2026-10-14 *"정렬 학년순이 왜 여깄는지 수정. 각 필터에 오름차순 내림차순이
                        있어야지"*) — 이름 열 = 이름순, 학교·학년 열 = 학년순. 등록일순은 붙일 열이 없어 없앴다(원장 선택).
                        필터가 없는 열이라 열 이름 글자까지 링크다(글자를 눌러도 정렬 · 폰 칩 줄에서도 무엇의 정렬인지 보인다). */}
                    <span className="flex items-center justify-center" data-help="st-sort">
                      <SortArrow {...sortArrow("name")} hintId="students-sort-name-hint">
                        <span className="text-foreground">{sheetT(lang, "stu.col.student")}</span>
                      </SortArrow>
                    </span>
                  </th>
                  {/* 학교·학년 열 머리 = 학년 필터 하나(상태 열과 같은 꼴) — 값이 `경명여고1`처럼 학교와 학년을 붙여 적는 열이다. */}
                  <th scope="col" data-help="st-grade" aria-sort={ariaSortOf("grade")}>
                    {/* 저장값을 이기려면 "전체"도 URL에 적혀야 한다(explicitAll) — 학년·과목·담임이 그렇다. */}
                    <span className="inline-flex items-center gap-0.5">
                      <HeaderFilter
                        paramName="grade"
                        clearParams={exit("grade")}
                        value={grade}
                        options={gradeOptions}
                        axisLabel={sheetT(lang, "stu.filter.grade")}
                        allValue="all"
                        explicitAll
                        multiple
                      />
                      <SortArrow {...sortArrow("grade")} />
                    </span>
                  </th>
                  <th scope="col" data-help="st-status">
                    {/* 기본값(재원)이 휴원·퇴원을 **숨기므로** 값을 항상 적는다(showAll). */}
                    <HeaderFilter
                      paramName="status"
                      clearParams={exit("status")}
                      value={status}
                      options={statusOptions}
                      axisLabel={sheetT(lang, "stu.filter.status")}
                      allValue={statusDefault}
                      allLabel={sheetT(lang, searching ? "stu.filter.all" : "stu.filter.status.enrolled")}
                      showAll
                    />
                  </th>
                  {/* 필터가 없는 갈래(강사 스코프)면 th 자체가 라벨 머리 — span만 감추면 0×0 th가 폰 칩 줄 간격을 먹는다. */}
                  <th scope="col" data-cell={hideSubjectFilter ? "label" : undefined}>
                    {hideSubjectFilter ? (
                      <span className="px-1">{sheetT(lang, "stu.col.subjects")}</span>
                    ) : (
                      <span data-help="st-subject">
                      <HeaderFilter
                        paramName="subject"
                        clearParams={exit("subject")}
                        // 퇴원 목록엔 '미수강' 선택지가 없다 — 저장값에 남아 있어도(서버도 무시한다) '선택지에 없는 값'으로 세우지 않는다.
                        value={status === "withdrawn" ? joinMulti(parseMulti(subject).filter((v) => v !== NO_SUBJECT)) : subject}
                        options={subjectOptions}
                        axisLabel={sheetT(lang, "stu.col.subjects")}
                        allValue="all"
                        explicitAll
                        multiple
                      />
                      </span>
                    )}
                  </th>
                  <th scope="col" data-cell={hideTeacherFilter ? "label" : undefined}>
                    {hideTeacherFilter ? (
                      <span className="px-1">{sheetT(lang, "stu.col.teacher")}</span>
                    ) : (
                      <span data-help="st-teacher">
                      <HeaderFilter
                        paramName="teacher"
                        clearParams={exit("teacher")}
                        value={teacherId}
                        options={teacherOptions}
                        axisLabel={sheetT(lang, "stu.col.teacher")}
                        allValue="all"
                        explicitAll
                        cap={200}
                        multiple
                      />
                      </span>
                    )}
                  </th>
                  {/* 라벨만 있는 머리는 th 자체에 표식 — span만 감추면 0×0 th가 폰 칩 줄의 간격을 먹는다. */}
                  <th scope="col" data-cell="label">
                    <span className="px-1">{sheetT(lang, "stu.col.parentPhone")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4">
                      {/* 설명 문장은 넣지 않는다(§4). 검색어만 0건을 만들면 그 q만 지우고, 저장된 필터는 둔다. */}
                      <EmptyState
                        image={q ? "search" : "students"}
                        icon={() => <Users size={32} strokeWidth={1.8} />}
                        title={sheetT(lang, "stu.empty.title")}
                        action={
                          q ? (
                            <EmbedLink
                              href={listParams({ clearQ: true })}
                              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex rounded-full border px-2.5 py-0.5 text-xs transition"
                            >
                              {sheetT(lang, "att.search.clear")}
                            </EmbedLink>
                          ) : null
                        }
                      />
                    </td>
                  </tr>
                ) : null}
                {rows.map((s) => {
                  const meta = studentStatusMeta(s.status, lang) ?? {
                    label: s.status,
                    color: "neutral" as PillColor,
                  };
                  // 학교·학년 압축 라벨("경명여중1") — 이름 옆 열에 따로 선다(원장 2026-10-14).
                  const sg = sheetSchoolGrade(s.school, s.grade, lang);
                  const shownName = studentDisplayName(s.name, s.englishName, lang);
                  return (
                    <tr key={s.id} data-help="st-row" className="hover:bg-bg-soft/50 transition-colors [&>td]:px-3 [&>td]:py-2.5 [&>td]:text-center">
                      <td data-cell="primary">
                        {/* `justify-center-safe` — 이름 + 꼬리표가 칸보다 길면(긴 이름 + '수정 중' 꼬리표) 가운데 정렬이
                            양쪽으로 넘쳐 카드 왼쪽 밖으로 나간다. 넘칠 때만 왼쪽 정렬로 바뀌어 넘침이 오른쪽 한쪽에만 생긴다. */}
                        <span className="phone:justify-start flex min-w-0 items-center justify-center-safe gap-1.5">
                          {/* 이름은 1차 식별자라 줄지 않는다(§1 "1차 핵심값 ellipsis 금지"). */}
                          <WindowLink
                            href={`/students/${s.id}`}
                            title={shownName}
                            ariaLabel={sheetTf(lang, "stu.rowAria", { name: shownName })}
                            className="text-foreground shrink-0 text-base font-bold whitespace-nowrap hover:underline"
                          >
                            {shownName}
                          </WindowLink>
                          {/* 이름 옆 꼬리표는 2026-10-14 전부 걷었다 — '병합됨'은 원장 *"이상한 라벨은 붙일 필요 없을거같은데"*,
                              남은 '동기화'·'의심'은 지울지 묻자 *"어"*. '의심'(동명이인 확인 필요)은 학생 상세 배지로 남고,
                              학원 설정 → 데이터 정리에서 이유와 함께 정리한다(짝이 없어도 뜬다 — *"데이터 정리에서는 여전히 정리할 수 있게"*). */}
                          <EditingBadge scope={`student:${s.id}`} />
                        </span>
                      </td>
                      {/* 학교가 길면 최소 창에서만 말줄임 — 전체는 title. 폰 카드에선 둘째 줄 맨 앞(원래 순서대로 흐른다). */}
                      <td className="text-text-dim" data-empty={sg ? undefined : "true"}>
                        {sg ? (
                          <span className="block truncate" title={sg}>
                            {sg}
                          </span>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </td>
                      <td data-cell="status">
                        <Pill color={meta.color}>{meta.label}</Pill>
                      </td>
                      <td data-empty={s.subjects.length === 0 ? "true" : undefined}>
                        {s.subjects.length === 0 ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <span className="phone:justify-start flex flex-wrap justify-center gap-1">
                            {s.subjects.map((sub) => (
                              <Pill key={sub} color={subjects.colorOf(sub)}>
                                {subjects.labelOf(sub)}
                              </Pill>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="text-text-dim" data-empty={s.teacherNames.length === 0 ? "true" : undefined}>
                        <span className="block truncate" title={s.teacherNames.map(showTeacher).join(" · ")}>
                          {s.teacherNames.length > 0 ? s.teacherNames.map(showTeacher).join("·") : "—"}
                        </span>
                      </td>
                      {/* 🔴 우측 정렬이 아니다 — 전화번호는 **자릿수를 견주는 수가 아니라 식별자**다(합계도 대소도 없다).
                          오른쪽에 붙여 두면 가운데 있는 열 제목과 이 열만 따로 놀고, 번호가 없는 행의 `—`가
                          표 오른쪽 끝에 홀로 매달린다. 열 제목과 같은 축(가운데 — 원장 2026-09-18)에 둔다.
                          ⚠️ `num`(고정폭 숫자)은 남긴다 — 자릿수가 같아야 번호가 위아래로 줄을 이룬다. */}
                      <td className="text-text-dim num whitespace-nowrap" data-empty={s.parentPhone ? undefined : "true"}>
                        {s.parentPhone ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 ? <Pagination lang={lang} page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
      </>
    </div>
  );
}
