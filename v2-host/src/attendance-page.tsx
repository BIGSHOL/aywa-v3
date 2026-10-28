// 2.0 `src/app/(shell)/attendance/page.tsx`(월별 출석부)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 2.0 함수·같은 변수 이름.
// page.tsx는 서버 부품(쿠키·세션·DB)이라 그대로 불러올 수 없어서, 서버가 하던 조회·판정은 /api/v2/attendance(Docker 복사본)가
// page.tsx와 같은 이름의 값으로 내려 주고(v2-screen-attendance.mjs), 여기서는 page.tsx의 JSX를 그 값으로 그대로 그린다.
// 보는 사람 = 3.0 띠에서 고른 '출결 전체 권한' 직원(2.0의 로그인한 사람 · 관리자 보기 — 강사 렌즈 없음).
// 이 판에 아직 없는 것(2.0은 서다): 금액 열(청구액·등록 차수·차이확인·단가·실수업액·실급여)과 원장 전용 합계 — 회차 확정·금액 이월·
// 강사 몫 가중치·티어 정산 조회를 옮기기 전이라 열을 세우지 않는다(값 없는 열을 '미확정'으로 세우면 거짓이 된다).
import { Users } from '@/components/icons/aywa-icon-compat';
import { PeriodNav } from '@/components/period-nav';
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_SELECT } from '@/components/toolbar-controls';
import { HrefSelect } from '@/components/href-select';
import { EmptyState } from '@/components/empty-state';
import { FilterSelect } from '@/components/filter-select';
import { ExcelMenu } from '@/components/excel-import/excel-menu';
import { buildSubjectMaps } from '@/features/owner/subjects';
import { buildHolidayMap } from '@/features/attendance/calendar';
import { rowKey } from '@/features/attendance/grid/model';
import { schoolGradeLabel } from '@/lib/format/school-grade';
import { sheetMonthLabel, sheetT, sheetTf, type SheetLang } from '@/features/teacher-view/i18n';
import { periodWindowLabel } from '@/features/periods/window-label';
import type { AttendanceMatrix } from '@/features/attendance/server/queries';
import type { AttendanceViewPrefs } from '@/features/attendance/view-prefs';
import type { PeriodWindow } from '@/features/periods/resolve';
import type { SubstituteCell } from '@/features/attendance/server/substitute-cells';
import type { HolidayActivityCounts } from '@/features/attendance/holiday-activity';
import type { SubjectSetting } from '@/features/owner/settings-types';
import type { ModuleId } from '@/lib/modules';
import { MatrixTable, buildGridSource, type MatrixGroup } from '@/app/(shell)/attendance/_components/matrix-table';
import { AttendanceLegend } from '@/app/(shell)/attendance/_components/attendance-legend';
import { GridProvider } from '@/app/(shell)/attendance/_components/grid-context';
import { AttendanceScopeProvider } from '@/app/(shell)/attendance/_components/scope-context';
import { AttendanceSearchProvider, AttendanceSearchToggle } from '@/app/(shell)/attendance/_components/search-context';
import { HubStudentSearch } from '@/app/(shell)/attendance/_components/hub-student-search';
import { CollapseAllChip } from '@/app/(shell)/attendance/_components/class-group';
import { LiveStats } from '@/app/(shell)/attendance/_components/live-totals';
import { attHref, type ViewMode } from '@/app/(shell)/attendance/_components/att-href';
import { AttendanceSortSelect } from '@/app/(shell)/attendance/_components/sort-select';
import { HideRetiredToggle } from '@/app/(shell)/attendance/_components/hide-retired-toggle';
import { PeriodModeToggle } from '@/app/(shell)/attendance/_components/period-mode-toggle';
import { AttendanceHub, type HubTeacher } from '@/app/(shell)/attendance/_components/attendance-hub';
import { PayslipWindowButton } from '@/app/(shell)/attendance/_components/payslip-window-button';
import { ClassMonthPrintButton } from '@/app/(shell)/attendance/_components/class-month-print-button';
import { AbsenceIntakeButton } from '@/app/(shell)/attendance/_components/absence-intake-button';
import { UnitsMasterButton } from '@/app/(shell)/attendance/_components/units-master-button';
import { SubstituteCellsNote } from '@/app/(shell)/attendance/_components/substitute-cells-note';

type Option = { value: string; label: string; hint?: string };
/** /api/v2/attendance가 내려 주는 값 — 이름은 page.tsx의 지역 변수 그대로. */
export type AttendanceData = {
  asOf: string; lang: SheetLang; month: string; currentMonth: string;
  host: { operations: { subjects: SubjectSetting[]; gradeLevels: string[]; jobTitles: string[]; jobTitlesByDepartment: Record<string, string[]>; holidays: Parameters<typeof buildHolidayMap>[0] }; disabledModules: ModuleId[]; preset: string };
  editors: { id: string; name: string; role: string }[]; viewer: string | null; viewPrefs: AttendanceViewPrefs;
  seatPick: string | null; seatOn: boolean; payrollOn: boolean; sessionBillingOn: boolean; eieOn: boolean;
  subjectOptions: Option[]; effectiveSubject: string | null; subjectValue: string | null;
  teacherOptions: Option[]; effectiveTeacher: string | null; teacherValue: string | null; retiredCount: number;
  classOptions: Option[]; effectiveClassId: string | null; mode: ViewMode; matrixWindow: PeriodWindow;
  groups: MatrixGroup[]; orderedRows: { classId: string; studentId: string; className: string; name: string; grade: string | null }[];
  visibleDays: AttendanceMatrix['days']; showGroups: boolean;
  statsCount: Parameters<typeof LiveStats>[0]['fallback']; totalStudents: number; sheetEmpty: boolean; hubShown: boolean;
  notices: { key: string; parts: [string, string][] }[]; selectedClassLabel: string | null; searchSeed: string;
  attendanceScope: { teacherId: string; classIds: string[] } | null; lockBefore: string | null; substituteCells: SubstituteCell[];
  tools: { printClass: { id: string; className: string } | null; showUnitsMaster: boolean; canIntakeAbsence: boolean; canOpenPayslip: boolean };
  hub: { teachers: HubTeacher[]; holiday: { name: string; activity: HolidayActivityCounts | null } | null; todayLabel: string;
    seats: { key: string; name: string; room: string; href: string; monthHref: string; open: boolean }[] } | null;
};

/** page.tsx `shiftMonth` — 툴바의 이전·다음 달. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** page.tsx `formatMonth`. */
function formatMonth(month: string, lang: SheetLang = 'ko'): string {
  const [y, m] = month.split('-');
  return sheetMonthLabel(month, `${y}년 ${Number(m)}월`, lang);
}

export function AttendancePage({ data }: { data: AttendanceData }) {
  const d = data, lang = d.lang, month = d.month, viewPrefs = d.viewPrefs, mode = d.mode, allGroups = d.groups;
  const effectiveClassId = d.effectiveClassId, effectiveTeacher = d.effectiveTeacher, effectiveSubject = d.effectiveSubject;
  const subjectMaps = buildSubjectMaps(d.host.operations.subjects);
  const isTeacherView = false; // 보는 사람은 관리자 계열(page.tsx myTeacherId = null)
  const showSubjectFilter = !isTeacherView, showTeacherFilter = !isTeacherView, showViewToggle = !isTeacherView;
  const prevMonth = shiftMonth(month, -1), nextMonth = shiftMonth(month, 1), currentMonthKey = () => d.currentMonth;
  const visibleDays = d.visibleDays, sortKey = viewPrefs.sort, showGroups = d.showGroups, orderedRows = d.orderedRows;
  const hubShown = d.hubShown, sheetEmpty = d.sheetEmpty, totalStudents = d.totalStudents, statsCount = d.statsCount;
  const gridShown = allGroups.length > 0 && !sheetEmpty;
  const { printClass, showUnitsMaster, canIntakeAbsence, canOpenPayslip } = d.tools;
  const sheetTools =
    showUnitsMaster || canIntakeAbsence || (canOpenPayslip && effectiveTeacher) || printClass ? (
      <>
        {printClass ? <ClassMonthPrintButton classId={printClass.id} className={printClass.className} month={month} periodMode={viewPrefs.periodMode} lens={null} since={null} /> : null}
        {showUnitsMaster ? <UnitsMasterButton month={month} subject={effectiveSubject} /> : null}
        {canIntakeAbsence ? <AbsenceIntakeButton today={d.asOf} /> : null}
        {canOpenPayslip && effectiveTeacher ? <PayslipWindowButton teacherId={effectiveTeacher} period={month} subjectFiltered={!!effectiveSubject} /> : null}
      </>
    ) : null;
  const scopeChip =
    (mode === 'teacher') && allGroups.length > 0 ? (
      <span className="border-line text-text-dim shrink-0 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap" title={sheetT(lang, isTeacherView ? 'att.scopeChip.titleOwn' : 'att.scopeChip.title')}>
        {sheetT(lang, 'att.scopeChip')}
      </span>
    ) : null;
  const searchRows = allGroups.flatMap((g) => g.matrix.students.map((s) => ({ row: rowKey(g.classId, s.id), studentId: s.id, name: s.name, school: s.school, grade: s.grade, schoolGrade: schoolGradeLabel(s.school, s.grade) || null })));
  const gridSource = buildGridSource(allGroups, visibleDays, orderedRows);
  const noticeClass = 'text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs break-keep';
  const notices = d.notices.map((n) => (
    <p key={n.key} className={noticeClass}>{n.parts.map(([w, v], i) => (w === 'b' ? <strong key={i} className="text-foreground">{v}</strong> : <span key={i}>{v}</span>))}</p>
  ));

  return (
    <AttendanceSearchProvider rows={searchRows} initialQuery={d.searchSeed}>
    <AttendanceScopeProvider scope={d.attendanceScope}>
    <GridProvider rows={gridSource.rows} cols={gridSource.cols} initial={gridSource.initial} notMine={gridSource.notMine} slotCounts={gridSource.slotCounts}
      lockBefore={d.lockBefore} initialCollapsed={viewPrefs.collapsed} autoUnits={gridSource.autoUnits}>
      <div className="attendance-page flex h-full min-h-0 flex-col gap-1">
      <div className="relative flex shrink-0 flex-wrap items-center gap-2.5 px-1 py-1">
        <span data-help="att-filters" className="inline-flex flex-wrap items-center gap-2.5">
        {showSubjectFilter ? (
          <FilterSelect paramName="subject" value={d.subjectValue} options={d.subjectOptions} axisLabel={sheetT(lang, 'att.filter.subject')} ariaLabel={sheetT(lang, 'att.filter.subjectAria')}
            allLabel={sheetT(lang, 'att.filter.subjectAll')} prefixOnlyFor="" className="w-auto" triggerClassName={TOOLBAR_SELECT} />
        ) : null}
        {showTeacherFilter ? (
          <>
            <FilterSelect paramName="teacher" value={d.teacherValue} options={d.teacherOptions} axisLabel={sheetT(lang, 'att.filter.teacher')} ariaLabel={sheetT(lang, 'att.filter.teacherAria')}
              allLabel={sheetT(lang, 'att.filter.teacherAll')} prefixOnlyFor="" className="w-auto" triggerClassName={TOOLBAR_SELECT} />
            {d.retiredCount > 0 || !viewPrefs.hideRetired ? <HideRetiredToggle hidden={viewPrefs.hideRetired} count={d.retiredCount} /> : null}
          </>
        ) : null}
        <FilterSelect paramName="class" value={effectiveClassId} options={d.classOptions} axisLabel={sheetT(lang, 'att.filter.class')} ariaLabel={sheetT(lang, 'att.filter.classAria')}
          allLabel={sheetT(lang, isTeacherView ? 'att.filter.classAllMine' : 'att.filter.classAll')} cap={300} className="w-auto" triggerClassName={TOOLBAR_SELECT} marker />
        </span>
        <span data-help="att-month">
        <PeriodNav label={formatMonth(month, lang)}
          prevHref={attHref({ classId: effectiveClassId, month: prevMonth, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
          nextHref={attHref({ classId: effectiveClassId, month: nextMonth, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
          currentHref={attHref({ classId: effectiveClassId, month: currentMonthKey(), teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
          relation={month === currentMonthKey() ? 'current' : month < currentMonthKey() ? 'past' : 'future'}
          prevAriaLabel={sheetT(lang, 'att.nav.prev')} nextAriaLabel={sheetT(lang, 'att.nav.next')} currentTitle={sheetT(lang, 'att.nav.current')} />
        </span>
        <span data-help="att-filters">
        <PeriodModeToggle mode={viewPrefs.periodMode} windowLabel={periodWindowLabel(d.matrixWindow, lang)}
          disabledReason={mode === 'teacher' ? sheetT(lang, 'att.period.disabledTeacher') : !effectiveClassId ? sheetT(lang, 'att.period.disabledNoClass') : undefined} />
        </span>
        {showViewToggle ? (
          effectiveTeacher ? (
            <span data-help="att-view">
            <HrefSelect axisLabel={sheetT(lang, 'att.view')} ariaLabel={sheetT(lang, 'att.view')} value={mode}
              options={[
                { value: 'class', label: sheetT(lang, 'att.view.class'), href: attHref({ classId: effectiveClassId, month, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode: 'class' }) },
                { value: 'teacher', label: sheetT(lang, 'att.view.teacher'), href: attHref({ classId: null, month, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode: 'teacher' }) },
              ]} />
            </span>
          ) : (
            <span className="text-text-faint text-xs">{sheetT(lang, 'att.view.pickTeacher')}</span>
          )
        ) : null}
        {allGroups.length > 0 ? (
          <>
            <AttendanceSortSelect value={sortKey} />
            {showGroups ? <CollapseAllChip classIds={allGroups.map((g) => g.classId)} /> : null}
            <span data-help="att-search" className="inline-flex flex-wrap items-center gap-2.5"><AttendanceSearchToggle /></span>
            {canIntakeAbsence ? <ExcelMenu importKind="attendance" /> : null}
          </>
        ) : (
          <>
            <HubStudentSearch month={month} initialQuery={d.searchSeed} initialResult={null} />
            {canIntakeAbsence ? <ExcelMenu importKind="attendance" /> : null}
          </>
        )}
        {d.selectedClassLabel ? <span className="text-text-dim truncate text-xs font-medium">{d.selectedClassLabel}</span> : null}
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-3 [&>button]:shrink-0">
          {!gridShown && !hubShown ? sheetTools : null}
          {!gridShown ? scopeChip : null}
          {allGroups.length > 0 ? <LiveStats totalStudents={totalStudents} fallback={statsCount} /> : null}
          {notices.length > 0 ? (
            <details className="[&_summary::-webkit-details-marker]:hidden">
              <summary className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} list-none cursor-pointer`}>{sheetTf(lang, 'att.notices', { n: notices.length })}</summary>
              <div className="border-line bg-card absolute top-full right-1 z-40 mt-1 w-[min(560px,calc(100vw-3rem))] space-y-2 rounded-2xl border p-3 shadow-lg">{notices}</div>
            </details>
          ) : null}
        </div>
      </div>
      {hubShown && d.hub ? (
        <AttendanceHub tools={sheetTools} teachers={d.hub.teachers} holiday={d.hub.holiday} seats={d.hub.seats} month={month} lang={lang} subjectId={effectiveSubject}
          colorOf={subjectMaps.colorOf} labelOf={subjectMaps.labelOf} todayLabel={d.hub.todayLabel} />
      ) : sheetEmpty ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState image="students" icon={() => <Users size={32} strokeWidth={1.8} />} title={sheetT(lang, mode === 'teacher' ? 'att.empty.teacher' : 'att.empty.class')} description={sheetT(lang, 'att.empty.desc')} />
          <SubstituteCellsNote cells={d.substituteCells} lang={lang} />
        </div>
      ) : (
        <div className="isolate flex min-h-0 flex-1 flex-col">
          <MatrixTable groups={allGroups} days={visibleDays} ordered={orderedRows} showGroups={showGroups} showActualAmount={false}
            optionsLeading={<>{scopeChip}<AttendanceLegend lang={lang} showToday={visibleDays.some((x) => x.isToday)} showMathUnits={allGroups.some((g) => g.unitSuffix === 'T')} showEnglishUnits={allGroups.some((g) => g.unitSuffix === 'U')} eieOn={d.eieOn} /></>}
            optionsTools={sheetTools} money={null} moneyNote={null} settlementNote={null} lang={lang} lockBefore={d.lockBefore}
            holidays={buildHolidayMap(d.host.operations.holidays)} />
          <SubstituteCellsNote cells={d.substituteCells} lang={lang} />
        </div>
      )}
      </div>
    </GridProvider>
    </AttendanceScopeProvider>
    </AttendanceSearchProvider>
  );
}
