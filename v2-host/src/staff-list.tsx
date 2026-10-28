// 2.0 직원관리 목록(app/(shell)/staff/page.tsx)의 조립 — 서버 컴포넌트라 그대로 못 불러와서, 서버가 하던 조회는 /api/v2/staff(Docker 복사본,
// v2-screen-staff.mjs · v2-staff-read.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다. 바꾼 곳은 서버 호출 자리뿐이다
// (staff-list.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-staff.mjs가 2.0 원문에 같은 짝을 대어 글자를 대조한다.
//  · 운영자 계정 표시(displayRoleFor)는 서버가 표시 역할로 입혀 보낸다 — 여기의 명단은 비어 있다(운영자 명단을 화면에 내리지 않는다).
//  · 직원 등록 QR(StaffQrSection)은 그리지 않고 안내 한 줄만 둔다(메인 10-28) — 등록 링크가 운영 양식으로 열려 연습 중 실제 등록이 운영 DB로 제출될 수 있다.
//  · 한 쪽 행 수의 기기 쿠키는 3.0에 없다 — 주소(?size=)와 기본값으로(2.0이 쿠키를 못 읽을 때와 같다).
import Link from "next/link";
import { AutoPageSize } from "@/components/auto-page-size";
import { clampPageSize, pageSizeCookieName } from "@/components/page-size";
import { Users, Wallet, CalendarClock } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Pill } from "@/components/atoms/pill";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { MobileScrollRow } from "@/components/ui/mobile-scroll-row";
import rowStyles from "@/app/(shell)/staff/staff-rows.module.css";
import { FilterSelect } from "@/components/filter-select";
import { SearchToggle } from "@/components/search-toggle";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import { jobTitleRank } from "@/features/approvals/job-rank";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { canAdjustLeave } from "@/features/leave/access";
import type { StaffRow } from "@/features/staff/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EMPLOYMENT_TYPES } from "@/features/staff/resume/resume";
import {
  DEFAULT_STAFF_LIST_PREFS,
  parseStaffEmp,
  parseStaffListPrefs,
  parseStaffRole,
  parseStaffSort,
  parseStaffStatus,
  pickStaffFilterPrefs,
  pickStaffViewPrefs,
  STAFF_PAGE_SIZE_DEFAULT,
  STAFF_PAGE_SIZE_KEY,
  STAFF_ROLE_OPTIONS,
  STAFF_SORT_OPTIONS,
  STAFF_STATUS_DEFAULT,
  STAFF_STATUS_OPTIONS,
  type StaffFilterPrefs,
  type StaffSortKey,
} from "@/features/staff/list/list-prefs";
import { NewStaffTrigger } from "@/app/(shell)/staff/_components/new-staff-trigger";
import { StaffTableScaleBox, StaffTableScaleControl } from "@/app/(shell)/staff/_components/table-scale";
import { StaffColumnPicker } from "@/app/(shell)/staff/_components/staff-column-picker";
import { StaffTable } from "@/app/(shell)/staff/_components/staff-table";
import { StaffRememberPrefs, StaffViewPrefsProvider } from "@/app/(shell)/staff/_components/staff-view-prefs";
import { isPayrollEnabled, isStaffLeavesEnabled } from "@/features/payroll/config";
import { displayRoleFor, HOST_COOKIES, type StaffListData } from "./staff-host-parts";

// ── app/(shell)/staff/page.tsx ──────────
/** 페이지 번호 나열(1 … 현재±2 … 끝) — 눈에 띄는 번호형 페이저용. null = 말줄임. */
function pageNumbers(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const around = [page - 1, page, page + 1].filter((n) => n > 1 && n < totalPages);
  const out: (number | null)[] = [1];
  if ((around[0] ?? totalPages) > 2) out.push(null);
  out.push(...around);
  if ((around[around.length - 1] ?? 1) < totalPages - 1) out.push(null);
  out.push(totalPages);
  return out;
}

/** 정렬 비교기 — null(미입력)은 항상 뒤로, 동률은 이름 가나다순. */
function sortStaff(rows: StaffRow[], sort: StaffSortKey): StaffRow[] {
  const byName = (a: StaffRow, b: StaffRow) => a.displayName.localeCompare(b.displayName, "ko");
  const nullsLast = (a: string | null, b: string | null) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "ko");
  };
  const sorted = [...rows];
  switch (sort) {
    case "name":
      return sorted.sort(byName);
    case "dept":
      return sorted.sort((a, b) => nullsLast(a.department, b.department) || byName(a, b));
    case "emp":
      return sorted.sort((a, b) => nullsLast(a.employmentType, b.employmentType) || byName(a, b));
    case "hire":
      // 최근 입사가 위(신입 파악 용도), 미입력은 뒤.
      return sorted.sort((a, b) => {
        if (!a.hireDate && !b.hireDate) return byName(a, b);
        if (!a.hireDate) return 1;
        if (!b.hireDate) return -1;
        return b.hireDate.localeCompare(a.hireDate) || byName(a, b);
      });
    default:
      return sorted; // role — getStaffList + 위장 role 재정렬이 이미 역할순
  }
}

/** 표 한 행의 최소 높이(px, 테두리 포함) — AutoPageSize는 실제 첫 행이 더 크면 그 값을 쓴다(글자 크기 확대). */
const STAFF_ROW_PX = 40;

export function StaffPage({
  data,
  searchParams,
}: {
  data: StaffListData;
  searchParams: {
    invited?: string;
    tab?: string;
    role?: string;
    status?: string;
    subject?: string;
    emp?: string;
    q?: string;
    sort?: string;
    size?: string;
    page?: string;
  };
}) {
  const user = data.user;
  const sp = searchParams;
  // 보기 설정은 계정 귀속(users.ui_prefs.staff, 원장 2026-08-04) — URL(명시값) → 저장값 → 기본값. 조회 실패(null)면 기본값으로
  // 그리되 이번 렌더는 저장하지 않는다(다른 축을 기본값으로 덮지 않게). 서로 독립인 조회는 한 번에(B4) — 저장값은 메모리 필터에만
  // 쓰여 목록 쿼리와 무관하다(학생·수업목록은 저장값이 서버 페이징 쿼리에 들어가 순서가 있지만 여기는 전건을 받아 거른다).
  // super_admin(숨은 총괄)은 학원 화면에서 '관리자'로 위장 표시(실제 role/접근 불변, displayRoleFor).
  const [prefsLoaded, rawAll, superAdminIds, settings, canManage, isSuperAdmin, jar, canImport] = [
    data.prefs,
    data.rows,
    new Set<string>(),
    data.settings,
    data.canManage,
    data.isSuperAdmin,
    HOST_COOKIES,
    data.canImport,
  ] as const;
  const prefs = prefsLoaded ?? DEFAULT_STAFF_LIST_PREFS;
  // '직원 이력서' 면은 2026-07-28 목록에 통합(이름 클릭=이력서, 등록=이력서 작성) — 옛 링크는 목록으로.

  const invited = sp.invited;
  const role = parseStaffRole(sp.role ?? prefs.role);
  // 기본 상태 = **재직**(원장 2026-08-07). 목록 쿼리가 퇴사자까지 내려주므로(그래야 '퇴사'가 동작한다) 기본을 all로 두면 평소
  // 화면에 퇴사자가 섞인다. '전체'는 ?status=all로만. 🔴 상태·검색어는 저장하지 않는다(늘 재직에서 시작).
  const status = parseStaffStatus(sp.status);
  const q = sp.q ?? "";
  const sort = parseStaffSort(sp.sort ?? prefs.sort);
  // 한 쪽 행 수 = 창 높이(AutoPageSize가 재어 ?size=N · 기기 쿠키) → 기본값. 계정 설정이 아니라 이 창의 측정값이다(page-size.ts).
  const size = clampPageSize(sp.size ?? jar.get(pageSizeCookieName(STAFF_PAGE_SIZE_KEY))?.value, STAFF_PAGE_SIZE_DEFAULT);
  const emp = parseStaffEmp(sp.emp ?? prefs.emp);
  const page = Math.max(1, Number(sp.page) || 1);

  // 과목 라벨·색은 학원설정 단일 소스(buildSubjectMaps) — 하드코딩 금지 규칙.
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 과목 필터(원장 요청 2026-07-28) — 선택지는 학원설정. URL·저장값 어느 쪽이든 지금 선택지에 있을 때만(흡수된 과목이 보이지 않는
  // 필터로 남지 않게 — 화면 한정 보정, 계정에는 원값이 남는다).
  const subjectRaw = sp.subject ?? prefs.subject;
  const subject = subjectMaps.options.some((o) => o.value === subjectRaw) ? subjectRaw : "all";
  const all = rawAll
    .map((s) => ({
      ...s,
      systemRole: displayRoleFor(s.id, s.systemRole, superAdminIds),
    }))
    // 배지뿐 아니라 정렬도 위장 role 기준으로 — 안 그러면 super_admin이 실제 role(master)로
    // 맨 위(owner 위)에 뜨는데 배지는 '관리자'라 어긋난다(위장 role로 재정렬).
    // 같은 역할 안에서는 **직급 서열**(학원설정 직급 순서, 결재선 후보와 같은 규칙) → 이름(원장 2026-10-06
    // "왜 부원장은 안 보여" — 이름순이면 정·허로 시작하는 부원장 둘이 관리자 그룹 맨 뒤라 다음 쪽으로 밀렸다).
    .sort(
      (a, b) =>
        ROLE_HIERARCHY[a.systemRole] - ROLE_HIERARCHY[b.systemRole] ||
        jobTitleRank(a.jobTitle, settings.operations.jobTitles) -
          jobTitleRank(b.jobTitle, settings.operations.jobTitles) ||
        a.displayName.localeCompare(b.displayName, "ko"),
    );
  let staff = all;
  if (q) {
    const term = q.toLowerCase();
    staff = staff.filter(
      (s) =>
        s.displayName.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        (s.phone ?? "").toLowerCase().includes(term),
    );
  }
  if (role !== "all") staff = staff.filter((s) => s.systemRole === role);
  if (status !== "all") staff = staff.filter((s) => s.status === status);
  if (subject !== "all") staff = staff.filter((s) => s.subjects.includes(subject));
  if (emp !== "all") staff = staff.filter((s) => s.employmentType === emp);
  staff = sortStaff(staff, sort);

  // 대시보드(원장 요청 2026-07-28): 전직원 수 · 근무형태별 · 과목별 — **재직+대기** 기준.
  // ⚠️ `all`에는 이제 퇴사자도 들어 있다(상태 '퇴사' 필터를 살리려고 쿼리에서 안 자른다) —
  //    집계에 그대로 쓰면 "전직원 수"가 퇴직자까지 세서 갑자기 부풀어 오른다.
  const onDuty = all.filter((s) => s.status !== "inactive");
  const empCount = (t: string) => onDuty.filter((s) => s.employmentType === t).length;
  const empUnset = onDuty.filter((s) => !s.employmentType).length;
  const subjectStats = subjectMaps.options
    .map((o) => ({
      key: o.value,
      label: o.label,
      color: subjectMaps.colorOf(o.value),
      count: onDuty.filter((s) => s.subjects.includes(o.value)).length,
    }))
    .filter((s) => s.count > 0);

  // 저장할 필터 — 저장값과 **같은 파서**를 지나고(빈 값이 저장값과 영영 달라 렌더마다 저장하지 않게), URL 값이 선택지 밖이면
  // 보여 주기만 하고 저장값은 유지. 🔴 **필터 5축만** 싣는다(pickStaffFilterPrefs) — 열·글자 크기까지 실으면 서버 렌더 시점의
  // 사본이 방금 클릭한 값을 되돌려 쓴다(뒤로 가기 캐시·클릭 직후 필터 전환, 적대적 리뷰 2026-09-04). 그 셋은 Provider가 클릭
  // 자리에서 따로 저장한다. 🔴 상태·검색어는 없다.
  const current: StaffFilterPrefs = pickStaffFilterPrefs(
    parseStaffListPrefs({
      role: sp.role === undefined || parseStaffRole(sp.role) === sp.role ? role : prefs.role,
      // URL의 과목이 지금 선택지 밖이면(흡수된 과목·오타) 보여 주기만 하고 저장값은 지킨다 — 다른 4축과 같은 왕복 검사.
      subject: sp.subject === undefined || subject === sp.subject ? subjectRaw : prefs.subject,
      emp: sp.emp === undefined || parseStaffEmp(sp.emp) === sp.emp ? emp : prefs.emp,
      sort: sp.sort === undefined || parseStaffSort(sp.sort) === sp.sort ? sort : prefs.sort,
    }),
  );
  const savedFilters = prefsLoaded ? pickStaffFilterPrefs(prefsLoaded) : null;
  // 계정 생성 직후의 `?invited=` 배너(+옛 `tab`)는 1회성 — 필터·검색을 바꾸면 함께 지운다(안 지우면 다음 필터에도 "계정이 생성되었습니다"가
  // 따라다닌다). 쪽 넘김(pageHref)은 애초에 안 싣는다.
  const INVITE_PARAMS = ["invited", "tab"];

  // 대시보드 집계는 전체(all) 기준 — 목록만 size명으로 슬라이스(메모리 페이지네이션, 창 높이가 정한다).
  const total = staff.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const pageStaff = staff.slice((page - 1) * size, page * size);

  /**
   * 쪽 넘김 링크가 들고 갈 파라미터 — 기본값과 다르거나 **URL이 명시한** 축은 그대로 적는다(URL 값은 보정하지 않고 원값).
   * 저장값에서 온 축도 값이 기본값과 다르면 적히므로, 링크를 따라가도 지금 보는 필터가 그대로다.
   */
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (sp.role !== undefined) params.set("role", sp.role);
    else if (role !== "all") params.set("role", role);
    if (status !== STAFF_STATUS_DEFAULT) params.set("status", status);
    if (sp.subject !== undefined) params.set("subject", sp.subject);
    else if (subject !== "all") params.set("subject", subject);
    if (sp.emp !== undefined) params.set("emp", sp.emp);
    else if (emp !== "all") params.set("emp", emp);
    if (sp.sort !== undefined) params.set("sort", sp.sort);
    else if (sort !== "role") params.set("sort", sort);
    if (size !== STAFF_PAGE_SIZE_DEFAULT) params.set("size", String(size));
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/staff?${s}` : "/staff";
  };

  // 페이저 링크·칸 치수 — control-scale(높이 = 라벨 + 4). 세로 패딩으로 높이를 만들지 않는다(v5).
  const pagerLink = `${CONTROL_H} ${CONTROL_LABEL} border-line bg-card text-foreground hover:border-primary/40 hover:bg-bg-soft inline-flex items-center rounded-lg border px-3 font-medium transition`;
  const pagerDisabled = `${CONTROL_H} ${CONTROL_LABEL} border-line text-text-faint inline-flex cursor-default items-center rounded-lg border px-3 opacity-40`;

  return (
    // 표 보기 3키(볼 열·순서·글자 크기)는 계정값을 서버 시드로 받아 첫 렌더부터 그 값으로 그린다(플래시·하이드레이션 불일치 없음).
    // 조회 실패(null)면 기본값으로 시드하되 클릭 저장은 그대로 된다(부분 객체라 다른 키를 안 건드린다).
    <StaffViewPrefsProvider initial={pickStaffViewPrefs(prefs)}>
    <div className="space-y-5">
      {savedFilters ? <StaffRememberPrefs current={current} saved={savedFilters} /> : null}
      {/* 머리 — 지시서 §10: 상시 버튼 = Primary '직원 등록' + 텍스트 '등록 QR', 그리고 조정 담당에게만 '연차 관리'(급여·옛 휴가 관리는 플래그가 꺼져 있다). 설명 문장은 뺐다(§4). */}
      <MobileScrollRow className={rowStyles.header}>
      <PageHeader
        eyebrow="운영"
        title="직원관리"
        actions={
          <>
            {isPayrollEnabled(settings) && user.systemRole === "master" ? (
              <Button variant="outline" render={<WindowLink href="/staff/payroll" title="월별 급여" />}>
                <Wallet className="size-4" />
                월별 급여
              </Button>
            ) : null}
            {/* 연차 관리 — 연차 **부여 일수**(이월·특별휴가·정산)를 고치는 자리(원장 2026-09-09:
                *"직원관리에 버튼 연동해주지 전자결재에 있는게 연차를 관리하는게 이상하자나"*).
                휴가 신청·결재는 여전히 전자결재다. 원장과 학원 설정 '역할·권한'에서 연차 조정으로 지정한 사람에게만 보이고
                실제 차단은 그 페이지·서버 액션이 같은 함수로 한다([[#77]]). */}
            {canAdjustLeave(user, isSuperAdmin, { adjusterIds: settings.permissions.specialAccess.leaveAdjusterIds }) ? (
              <Button variant="outline" render={<WindowLink href="/staff/annual-leave" title="연차 관리" />}>
                {/* 아이콘은 옛 '휴가 관리'(CalendarClock)와 **다른 것**으로 — 그 플래그를 되살리면
                    두 버튼이 나란히 서는데 같은 그림이면 무엇이 무엇인지 못 가린다. */}
                <EyIcon name="calendarCheck" size={16} />
                연차 관리
              </Button>
            ) : null}
            {isStaffLeavesEnabled(settings) && canManage ? (
              <Button variant="outline" render={<WindowLink href="/staff/leaves" title="휴가 관리" />}>
                <CalendarClock className="size-4" />
                휴가 관리
              </Button>
            ) : null}
            {canManage ? <p className="text-text-dim text-sm">연습 화면에서는 직원 등록 QR을 만들지 않습니다</p> : null}
            {canManage ? <NewStaffTrigger /> : null}
          </>
        }
      />

      </MobileScrollRow>

      {/* 직원 대시보드(원장 요청 2026-07-28) — 전직원 수 · 근무형태별 · 과목별 */}
      <MobileScrollRow className={rowStyles.stats}>
      <StatStrip>
        <BigStat label="전직원" value={onDuty.length} unit="명" tone="primary" icon={<Users size={16} strokeWidth={1.8} />} />
        {EMPLOYMENT_TYPES.map((t) => (
          <BigStat key={t} label={t} value={empCount(t)} unit="명" tone="neutral" />
        ))}
      </StatStrip>
      </MobileScrollRow>
      {subjectStats.length > 0 ? (
        <MobileScrollRow>
        <section className="border-line flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-1 pb-2">
          <span className="micro">과목별</span>
          {subjectStats.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-sm">
              <Pill color={s.color}>{s.label}</Pill>
              <span className="num text-foreground font-bold">{s.count}</span>
              <span className="text-text-dim text-xs">명</span>
            </span>
          ))}
          {empUnset > 0 ? (
            <span className="text-text-faint ml-auto text-xs">근무형태 미입력 {empUnset}명</span>
          ) : null}
        </section>
        </MobileScrollRow>
      ) : null}

      {/* 필터 — 라벨 하나씩(드롭다운, §10). 옛 세그먼트 칩 5묶음(역할 7·상태 4·과목 N·근무형태 4·정렬 5)을 걷었다.
          🔴 이 표는 볼 열과 순서를 사용자가 고르므로(열을 숨길 수 있다) 열 머리에 필터를 심지 않는다 — 숨긴 열에 걸린 필터를
             되돌릴 자리가 사라진다. 등록상담과 같은 "라벨 드롭다운 한 줄" 형이다. 검색은 눌러야 나온다.
          "전체"도 URL에 명시(explicitAll) — 저장값을 이기려면 값이어야 한다. 상태만 저장 안 함(기본 재직, 전체는 status=all). */}
      {/* 모바일도 한 줄 + 숨긴 스크롤바 + 가장자리 페이드. 필터와 열 선택 팝업은 Portal로 띄워 잘리지 않는다.
          스크롤은 MobileScrollRow 한 곳에서만 담당하므로 Toolbar의 중첩 레일은 끈다. */}
      <MobileScrollRow className={rowStyles.toolbar}>
      <Toolbar rail={false}>
        <div className="toolbar-group flex min-w-0 flex-wrap items-center gap-3">
        <FilterSelect
          paramName="role"
          clearParams={INVITE_PARAMS}
          value={role}
          options={STAFF_ROLE_OPTIONS}
          axisLabel="역할"
          ariaLabel="역할 필터"
          allValue="all"
          explicitAll
          prefixOnlyFor="all"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        <FilterSelect
          paramName="status"
          clearParams={INVITE_PARAMS}
          value={status}
          options={STAFF_STATUS_OPTIONS}
          axisLabel="상태"
          ariaLabel="상태 필터"
          allValue={STAFF_STATUS_DEFAULT}
          allLabel="재직"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        <FilterSelect
          paramName="subject"
          clearParams={INVITE_PARAMS}
          value={subject}
          options={subjectMaps.options}
          axisLabel="과목"
          ariaLabel="과목 필터"
          allValue="all"
          explicitAll
          prefixOnlyFor="all"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        <FilterSelect
          paramName="emp"
          clearParams={INVITE_PARAMS}
          value={emp}
          options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))}
          axisLabel="계약구분"
          ariaLabel="계약구분 필터"
          allValue="all"
          explicitAll
          prefixOnlyFor="all"
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        <FilterSelect
          paramName="sort"
          clearParams={INVITE_PARAMS}
          value={sort}
          options={STAFF_SORT_OPTIONS.filter((o) => o.value !== "role")}
          axisLabel="정렬"
          ariaLabel="정렬 기준"
          allValue="role"
          allLabel="역할순"
          explicitAll
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
        />
        </div>
        {/* 오른쪽 묶음 = 결과 숫자 + 표 보기 설정 셋(표시 수·글자 크기·볼 열) + 검색 — 한 줄(원장 2026-09-22 *"넓은 화면까지
            2행일 필요가 없어보임"*). 종전엔 이 셋이 따로 둘째 줄이라 넓은 창에서 두 줄 모두 대부분 비어 있었다.
            좁은 화면에서는 같은 행을 가로로 스크롤한다. 보기 설정 둘은 계정에 저장된다(§10 "설정은 한 곳"). */}
        <div className="toolbar-group ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-text-dim text-sm whitespace-nowrap">
          결과 <span className="text-foreground font-bold">{total}</span>명
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
          {q ? <span className="ml-1.5">· &ldquo;{q}&rdquo; 검색</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 표 글자 크기 −/+ · 볼 열 고르기(원장 지시 2026-07-31) — 둘 다 계정 설정(ui_prefs.staff). */}
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim text-sm">글자</span>
            <StaffTableScaleControl />
          </div>
          <StaffColumnPicker />
        </div>
        <SearchToggle placeholder="이름·이메일·연락처" defaultValue={q} resetParams={INVITE_PARAMS} />
        {/* 엑셀 가져오기(직원 계정) — 검색과 같은 줄(원장 2026-09-29 통일). */}
        {canImport ? <ExcelMenu importKind="staff" /> : null}
        </div>
      </Toolbar>
      </MobileScrollRow>

      {invited ? (
        <p className="border-primary/30 bg-primary-soft text-primary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <EyIcon name="check" size={14} />
          <span>{invited} 계정이 생성되었습니다. 임시 비밀번호를 직원에게 안내해주세요.</span>
        </p>
      ) : null}

      {total === 0 ? (
        // 필터가 위 드롭다운 줄에 있어 표를 치워도 되돌릴 컨트롤이 남는다(열 머리 필터 화면과 다른 점).
        <EmptyState image="staff" icon={() => <Users size={32} strokeWidth={1.8} />} title={q ? "검색 결과 없음" : "직원이 없습니다"} />
      ) : (
        <>
          {/* list(테이블) 형식 — 원장 지시 2026-07-28(카드 그리드에서 전환). 열 17개를 사용자가 고르므로 좁으면 가로 스크롤
              (필터가 열 머리에 없어 상자로 싸도 잘릴 팝업이 없다). */}
          {/* 표 형태(원장 지시 2026-07-31) — 셀마다 테두리를 그어 시트처럼 읽히게. 열 순서도 직원명부 시트와 같은
              소속 → 이름 → 직급 순. 글자 크기는 StaffTableScaleBox가 em 기준으로 한 번에 조절한다(기본 16px). */}
          {/* 넘치면 잡고 끌어서 가로 이동(원장 2026-09-04 *"가로스크롤이 제일 아래에 있어서 힘드니까 드래그 스크롤 가능하게"*) —
              행 클릭은 5px 안 움직임이면 그대로 산다(DragScrollArea가 실제로 끌었을 때만 뒤따르는 click 1회를 삼킨다). */}
          {/* 행 수는 창 높이가 정한다(AutoPageSize → ?size=N, 원장 2026-09-29) — 표 몸통(`tbody[data-autopage-list]`)의
              위치·첫 행 높이를 실제 DOM에서 재므로 글자 크기·가로 스크롤바도 그대로 반영된다. */}
          <AutoPageSize size={size} rowPx={STAFF_ROW_PX} storageKey={STAFF_PAGE_SIZE_KEY}>
            <StaffTableScaleBox className="bg-card shadow-card rounded-2xl">
              <DragScrollArea className="rounded-[inherit]">
                <StaffTable rows={pageStaff} />
              </DragScrollArea>
            </StaffTableScaleBox>
          </AutoPageSize>
          {/* 눈에 띄는 번호형 페이저(원장 지시 2026-07-28 — 표준 컴팩트 페이저는 존재감이 약해 이 목록만 강조형) */}
          {totalPages > 1 ? (
            <nav className="flex flex-wrap items-center justify-center gap-1.5 pt-1" aria-label="페이지 이동">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className={pagerLink}>
                  ← 이전
                </Link>
              ) : (
                <span className={pagerDisabled}>← 이전</span>
              )}
              {pageNumbers(page, totalPages).map((n, i) =>
                n === null ? (
                  <span key={`gap${i}`} className="text-text-faint px-1 text-sm">
                    …
                  </span>
                ) : (
                  <Link
                    key={n}
                    href={pageHref(n)}
                    aria-current={n === page ? "page" : undefined}
                    className={`num ${CONTROL_H} ${CONTROL_LABEL} inline-flex min-w-(--control-h) items-center justify-center rounded-lg border px-2.5 transition ${
                      n === page
                        ? "border-primary bg-primary text-primary-foreground font-bold"
                        : "border-line bg-card text-foreground hover:border-primary/40 hover:bg-bg-soft"
                    }`}
                  >
                    {n}
                  </Link>
                ),
              )}
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} className={pagerLink}>
                  다음 →
                </Link>
              ) : (
                <span className={pagerDisabled}>다음 →</span>
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
    </StaffViewPrefsProvider>
  );
}
