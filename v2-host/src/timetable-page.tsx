// 2.0 `src/app/(shell)/timetable/page.tsx`의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 2.0 함수·같은 변수 이름.
// page.tsx는 서버 부품(쿠키·세션·DB)이라 그대로 불러올 수 없어서, 서버가 하던 조회만 /api/v2/timetable(복사본)의 원자료로 바꾸고
// 나머지(주·과목·구분·보기 해석, 필터, 툴바·본문 배치)는 page.tsx 순서 그대로 옮겼다. 원장 계정(관리자 계열)으로 보는 화면이다.
// 이 판에 아직 없는 것: 시간표 X(퇴원 겹침 — 서버 액션 조회), 강사뷰·교실뷰·보강 구분 — 그 자리는 '아직 옮기지 않음'으로 정직하게 말한다.
// 메모 시트는 보기만(편집 저장은 2단계).
import { PageHeader } from '@/components/page-header';
import { PageMaximizeToolbar } from '@/components/page-maximize/page-maximize-toolbar';
import { PhotoCard } from '@/components/atoms/photo-card';
import { Toolbar, ToolbarRow } from '@/components/toolbar';
import { Layers } from '@/components/icons/aywa-icon-compat';
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from '@/components/toolbar-controls';
import { timetableText } from '@/features/teacher-view/timetable-labels';
import { SUBJECT_SOFT, buildSubjectMaps } from '@/features/owner/subjects';
import { resolveSkillAreas } from '@/features/owner/skill-areas';
import { isModuleEnabled } from '@/lib/modules';
import { applySeatPinMarks, buildSeatLiveStarts, NO_SEAT_PINS } from '@/features/timetable/lib/seat-pin-mark';
import { applyLabSeparateMarks } from '@/features/timetable/lib/lab-separate';
import { settingsToPeriodsConfig } from '@/features/timetable/lib/periods';
import { buildRichClassCards, type TeacherColorMap } from '@/features/timetable/lib/class-grid';
import { resolveWeekdayGroups } from '@/features/timetable/lib/weekday-groups';
import { DEFAULT_TIMETABLE_KIND, isMakeupKind, matchesTimetableKind, parseTimetableKind, TIMETABLE_KINDS, TIMETABLE_KIND_LABEL, type TimetableKind } from '@/features/timetable/lib/class-kind';
import { ENGLISH_TRACK_FILTERS, ENGLISH_TRACK_FILTER_LABEL, keepEnglishTrack, normalizeEnglishTrackFilter, type EnglishTrackFilter } from '@/features/classes/english-track';
import { resolveIntegrationGroups } from '@/features/timetable/lib/integration-groups';
import { normalizePresets } from '@/features/timetable/lib/group-presets';
import { shouldSerializeView, subjectDefaultView, viewForSubjectSwitch } from '@/features/timetable/lib/view-default';
import { resolveTimetableSubject } from '@/features/timetable/lib/subject-default';
import { weekRelation, weekTitle } from '@/features/timetable/lib/week';
import { buildTimetableSearchIndex, timetableSearchScope } from '@/features/timetable/lib/student-search';
import { COMPACT1H_NONE } from '@/features/timetable/lib/pref-cookies';
import { applyGradeFilter, EMPTY_VIEW_PREFS } from '@/features/timetable/lib/view-prefs';
import { buildClassMoveIndex } from '@/features/timetable/lib/class-move';
import type { SubjectSetting } from '@/features/owner/settings-types';
import type { ScheduleSlotWithStudents } from '@/features/timetable/server/queries';
import { ParamLink } from '@/app/(shell)/timetable/_components/param-link';
import { ParamSelect } from '@/app/(shell)/timetable/_components/param-select';
import { RichGridView } from '@/app/(shell)/timetable/_components/rich-grid-view';
import { RosterMoveArea } from '@/app/(shell)/timetable/_components/roster-move';
import { IntegratedEditBoard } from '@/app/(shell)/timetable/_components/integrated-edit-board';
import { TimetableEditProvider, TimetableEditControls, TimetableDndArea } from '@/app/(shell)/timetable/_components/timetable-board';
import { TimetableToolbarActions } from '@/app/(shell)/timetable/_components/toolbar-actions';
import { TimetableViewPrefsSync } from '@/app/(shell)/timetable/_components/prefs-sync';
import { EmptyPeriodScope } from '@/app/(shell)/timetable/_components/empty-period-scope';
import { ClassMoveProvider } from '@/app/(shell)/timetable/_components/class-move-context';
import { TimetableColorPrefSync } from '@/app/(shell)/timetable/_components/color-mode-toggle';
import { TimetableFontPrefSync, TimetableZoomArea } from '@/app/(shell)/timetable/_components/font-size-toggle';
import { TimetableViewSettings } from '@/app/(shell)/timetable/_components/view-settings';
import { WeekNav } from '@/app/(shell)/timetable/_components/week-nav';
import { WeekdayGroupTables } from '@/app/(shell)/timetable/_components/weekday-group-tables';
import { EcsShortcut } from '@/app/(shell)/timetable/_components/ecs-shortcut';
import { EditorShortcut } from '@/app/(shell)/timetable/_components/editor-shortcut';
import { TimetableSearchEmptyNote, TimetableSearchProvider, TimetableSearchToggle } from '@/app/(shell)/timetable/_components/search-context';
import { ScheduledImportBadge } from '@/app/(shell)/timetable/_components/scheduled-import-badge';
import { buildVirtualLabs, knownLabSources, NO_VIRTUAL_LABS, type SeatMoveRow, type SeatLiveSlot } from '@/features/timetable/lib/virtual-lab';
import { groupScheduledImports, type ScheduledSnapshot } from '@/features/timetable/scheduled-import';
import { isMemoSheetSubject } from '@/features/timetable-memo/doc';
import type { PackedSheet } from '@/features/timetable-memo/pack';
import { MemoSheet } from '@/features/timetable-memo/ui/memo-sheet';
import { MemoSheetJumpButton, TimetableSplitPanes } from '@/features/timetable-memo/ui/split-panes';
import { attachReservedLines, type ReservationData } from './timetable-ports';

type MemoLoad = { status: 'ok'; packed: PackedSheet; version: number; updatedAt: string | null } | { status: 'unavailable' };
/** 2.0 MemoSheetPane(서버 부품)의 그리기 — 자료는 서버가 같은 loadMemoSheet 규칙으로 보냈다. */
function MemoSheetPane({ load, subject, canEdit }: { load: MemoLoad | undefined; subject: string; canEdit: boolean }) {
  if (!load || load.status !== 'ok') {
    return <div className="bg-card shadow-card flex h-full items-center justify-center rounded-2xl p-6 text-center text-sm">메모 시트를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</div>;
  }
  return <MemoSheet cacheKey={`docker-copy:${subject}`} subject={subject} packed={load.packed} version={load.version} updatedAt={load.updatedAt} canEdit={canEdit} />;
}

type ViewMode = 'basic' | 'integrated' | 'teacher' | 'rooms';
export type TimetableData = {
  today: string; thisWeek: string; week: string; referenceDate: string;
  allSlots: ScheduleSlotWithStudents[];
  settings: { operations: { subjects: SubjectSetting[]; gradeLevels: string[]; weekdayGroupings?: never } & Record<string, unknown>; modules: { disabled: string[] } };
  teacherColors: TeacherColorMap; teacherNicknames: Record<string, string>;
  labSeparateEnrollmentIds: string[]; seatPins: { pins: never[]; live: never[] | null };
  makeup: ReservationData; seatWeek: { moves: SeatMoveRow[] | null; live: SeatLiveSlot[] | null };
  scheduledImports: ScheduledSnapshot[]; memoSheets: Record<string, MemoLoad>;
  viewer: { canEdit: boolean; canEditRoster: boolean; canSplit: boolean; staffSubjects: string[] };
};

/** page.tsx 아래쪽 buildHref 그대로(주소만 /timetable → 호스트가 iframe 주소로 옮긴다). */
function buildHref(opts: { view: ViewMode; subject: string; kind: TimetableKind; week: string; thisWk: string; compact1h?: number[]; compact1hExplicit?: boolean; hideEmptyDays?: boolean; collapseEmptyPeriods?: boolean; hideStudents?: boolean; gedit?: boolean; englishTrack?: EnglishTrackFilter; defaultView?: ViewMode }): string {
  const params = new URLSearchParams();
  if (shouldSerializeView(opts.view, opts.defaultView ?? 'basic')) params.set('view', opts.view);
  if (opts.kind !== DEFAULT_TIMETABLE_KIND) params.set('kind', opts.kind);
  if (opts.subject) params.set('subject', opts.subject);
  if (opts.week !== opts.thisWk) params.set('week', opts.week);
  if (opts.compact1h && opts.compact1h.length) params.set('compact1h', [...opts.compact1h].sort((a, b) => a - b).join(','));
  else if (opts.compact1hExplicit) params.set('compact1h', COMPACT1H_NONE);
  if (opts.hideEmptyDays !== undefined) params.set('emptydays', opts.hideEmptyDays ? 'hide' : 'show');
  if (opts.collapseEmptyPeriods !== undefined) params.set('emptyperiods', opts.collapseEmptyPeriods ? 'collapse' : 'expand');
  if (opts.hideStudents !== undefined) params.set('students', opts.hideStudents ? 'hide' : 'show');
  if (opts.gedit) params.set('gedit', '1');
  if (opts.englishTrack !== undefined) params.set('etrack', opts.englishTrack);
  const q = params.toString();
  return q ? `/timetable?${q}` : '/timetable';
}

/** 아직 이 호스트로 옮기지 않은 보기·구분 — 2.0의 빈 화면 카드 자리에 사실대로 적는다. */
function NotYet({ what }: { what: string }) {
  return <div className="mx-auto w-full max-w-xl py-4"><PhotoCard src="/photos/timetable-empty.webp" alt="" caption={`${what}는 아직 3.0 연습 화면에 옮기지 않았습니다`} sub="기본뷰·통합뷰는 2.0과 같은 부품으로 볼 수 있습니다" aspect="3/2" sizes="576px" /></div>;
}

export function TimetablePage({ data, search }: { data: TimetableData; search: URLSearchParams }) {
  const viewParam = search.get('view'), subjectParam = search.get('subject') ?? undefined, kindRaw = search.get('kind') ?? undefined;
  const compact1hRaw = search.get('compact1h') ?? undefined, emptyperiodsRaw = search.get('emptyperiods'), studentsRaw = search.get('students');
  const emptydaysRaw = search.get('emptydays'), geditRaw = search.get('gedit'), etrackRaw = search.get('etrack') ?? undefined;
  const kind = parseTimetableKind(kindRaw);
  const compactFromParam = compact1hRaw === undefined ? null : compact1hRaw === COMPACT1H_NONE ? [] : compact1hRaw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const paramView: ViewMode | null = viewParam === 'integrated' ? 'integrated' : viewParam === 'teacher' ? 'teacher' : viewParam === 'rooms' ? 'rooms' : viewParam === 'basic' ? 'basic' : null;
  const { today, thisWeek: thisWk, week, referenceDate, settings } = data;
  const rel = weekRelation(week, today);
  const canEdit = data.viewer.canEdit, canEditRoster = data.viewer.canEditRoster;
  const effectiveDate = rel === 'future' ? week : undefined;
  const lang = 'ko';
  const tt = (text: string) => timetableText(lang, text);
  const roomsViewAllowed = true;
  const allSlots = data.allSlots;
  const storedTeacherColors: TeacherColorMap = paramView !== 'basic' ? data.teacherColors : {};
  const viewPrefs = EMPTY_VIEW_PREFS, staffSubjects = data.viewer.staffSubjects;
  const seatPins = data.seatPins.pins.length ? { pins: data.seatPins.pins, liveStarts: data.seatPins.live ? buildSeatLiveStarts(data.seatPins.live, referenceDate) : null } : NO_SEAT_PINS;
  const labSeparateIds = new Set(data.labSeparateEnrollmentIds);
  const hideEmptyDays = emptydaysRaw ? emptydaysRaw === 'hide' : false;
  const collapseEmptyPeriods = emptyperiodsRaw ? emptyperiodsRaw === 'collapse' : false;
  const hideStudents = studentsRaw ? studentsRaw === 'hide' : false;
  const periodsConfig = settingsToPeriodsConfig(settings.operations as never);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const kindSlots = allSlots.filter((s) => matchesTimetableKind(kind, s.isSpecialLecture));
  const available = isMakeupKind(kind) ? subjectMaps.options.map((o) => o.value) : subjectMaps.options.map((o) => o.value).filter((k) => kindSlots.some((s) => s.subject === k));
  const subject = resolveTimetableSubject(available, staffSubjects, subjectParam);
  const teacherColors = { ...storedTeacherColors };
  const trackApplies = subject === 'english' && isModuleEnabled(settings.modules.disabled as never, 'eie');
  const englishTrack: EnglishTrackFilter = !trackApplies ? 'all' : etrackRaw !== undefined ? normalizeEnglishTrackFilter(etrackRaw) : (viewPrefs.englishTrack ?? 'all');
  const carriedTrack = trackApplies ? englishTrack : undefined;
  const defaultViewOf = (key: string): ViewMode => subjectDefaultView(settings.operations.subjects, key);
  const thisSubjectDefaultView = defaultViewOf(subject);
  const view: ViewMode = paramView ?? thisSubjectDefaultView;
  const compactList = compactFromParam ?? [];
  const compactSections = new Set(compactList);
  const slots = applyLabSeparateMarks(applySeatPinMarks(applyGradeFilter(keepEnglishTrack(kindSlots.filter((s) => s.subject === subject), englishTrack), viewPrefs.grades), { pins: seatPins.pins, liveStarts: seatPins.liveStarts, referenceDate }), labSeparateIds)
    .map((slot) => ({ ...slot, sourceId: slot.id }));
  const subjectRow = settings.operations.subjects.find((s) => s.key === subject);
  const makeupTab = isMakeupKind(kind);
  const showEcsShortcut = subject === 'english' && resolveSkillAreas(subjectRow).length > 0;
  const showEditorShortcut = subject === 'english';
  const customGroups = resolveIntegrationGroups(subjectRow);
  const groupPresets = normalizePresets(subjectRow?.integrationGroupPresets, subjectRow?.integrationOthersTitle ?? '');
  const weekdayGroups = resolveWeekdayGroups(subjectRow?.weekdayGrouping, (settings.operations as { weekdayGroupings?: never }).weekdayGroupings);
  const allowsTeacherView = (k: string) => k === 'english' || ((settings.operations.subjects.find((s) => s.key === k)?.teacherViewLines?.length ?? 0) > 0);
  const teacherViewAllowed = allowsTeacherView(subject);
  const effView: ViewMode = view === 'teacher' && !teacherViewAllowed ? 'basic' : view === 'rooms' && !roomsViewAllowed ? 'basic' : view;
  const canEditGroups = effView === 'integrated' && canEdit;
  const groupEditing = canEditGroups && geditRaw === '1';
  const teacherNicknames = subject === 'english' ? data.teacherNicknames : undefined;
  const isIntegrated = effView === 'integrated';
  const isRooms = effView === 'rooms';
  // page.tsx: canManageImport(원장 계열) · canMasterImport(영어 + 시트 관리) · canSync(구글 시트 연동 — 복사본엔 바깥 시트가 없다)
  const canManageImport = true, canSync = false, canMasterImport = subject === 'english' && canManageImport;
  const scheduled = (canSync && canManageImport) || canMasterImport ? groupScheduledImports(data.scheduledImports, today) : [];
  // 메모 시트(영어 통합뷰 오른쪽 판) — 보기 권한은 원장 계열. 편집 저장은 2단계라 지금은 읽기만.
  const memoSlot = isIntegrated && !groupEditing && !makeupTab && slots.length > 0 && isMemoSheetSubject(subject);
  const memo = memoSlot ? { canView: true, canEdit: false } : { canView: false, canEdit: false };
  const memoSplit = memo.canView && !makeupTab && !isRooms && slots.length > 0 && isIntegrated && !groupEditing;
  const basicOnly = !makeupTab && effView === 'basic';
  const basicReserved = basicOnly ? attachReservedLines(slots, referenceDate, data.makeup) : null;
  const basicSlots = basicReserved?.slots ?? slots;
  const strayReserved = basicReserved?.strays ?? [];
  const labSources = isIntegrated && !groupEditing ? knownLabSources(seatPins, data.seatWeek.moves) : null;
  const virtualLabs = labSources ? buildVirtualLabs({ slots, pins: labSources.pins, moves: labSources.moves, live: data.seatWeek.live, referenceDate, subject, config: periodsConfig }) : NO_VIRTUAL_LABS;
  const searchEnabled = !isRooms && !(isIntegrated && groupEditing);
  const searchIndex = searchEnabled ? buildTimetableSearchIndex(slots) : [];
  const searchScope = timetableSearchScope([rel === 'current' ? '이번 주' : weekTitle(week), subjectMaps.labelOf(subject), kind === 'special' ? '특강' : null]);
  const integratedGrid = isIntegrated ? (
    <TimetableZoomArea>
      <RichGridView slots={slots} subjectMaps={subjectMaps} config={periodsConfig} teacherColors={teacherColors} teacherNicknames={teacherNicknames} compactSections={compactSections} customGroups={customGroups} hideStudents={hideStudents} virtualLabs={virtualLabs} />
    </TimetableZoomArea>
  ) : null;
  const toolbar = (
    <PageMaximizeToolbar>
      <Toolbar rail={false} gap="gap-3 compact-chrome:gap-1">
        <ToolbarRow>
          <WeekNav currentWeek={week} today={today} hrefForWeek={(monday) => buildHref({ view: effView, subject, kind, week: monday, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView })} />
          {scheduled.map((g) => <ScheduledImportBadge key={g.effectiveDate} effectiveDate={g.effectiveDate} today={today} sheetUrl={null} canCancel={(canSync && canManageImport) || canMasterImport} />)}
        </ToolbarRow>
        <ToolbarRow>
          <div className="toolbar-group flex min-w-0 flex-wrap items-center gap-3">
            {isRooms ? null : (
              <>
                {available.length === 0 ? null : (
                  <span data-help="tt-subject">
                    <ParamSelect axisLabel="과목" ariaLabel="과목 선택" value={subject} options={available.map((k) => ({ value: k, label: subjectMaps.labelOf(k), href: buildHref({ view: (() => { const carried = viewForSubjectSwitch(view, thisSubjectDefaultView, defaultViewOf(k)); return carried === 'teacher' && !allowsTeacherView(k) ? 'basic' : carried; })(), defaultView: defaultViewOf(k), subject: k, kind, week, thisWk, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: k === 'english' ? englishTrack : undefined }) }))} />
                  </span>
                )}
                <span data-help="tt-kind">
                  <ParamSelect axisLabel="구분" ariaLabel="정규·특강 구분" value={kind} options={TIMETABLE_KINDS.map((k) => ({ value: k, label: TIMETABLE_KIND_LABEL[k], href: buildHref({ view: effView, defaultView: thisSubjectDefaultView, subject, kind: k, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack }) }))} />
                </span>
                {trackApplies ? (
                  <span data-help="tt-program">
                    <ParamSelect axisLabel="프로그램" ariaLabel="영어 프로그램 필터" value={englishTrack} options={ENGLISH_TRACK_FILTERS.map((t) => ({ value: t, label: ENGLISH_TRACK_FILTER_LABEL[t], href: buildHref({ view: effView, defaultView: thisSubjectDefaultView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: t }) }))} />
                  </span>
                ) : null}
              </>
            )}
            {makeupTab ? null : (
              <span data-help="tt-view">
                <ParamSelect axisLabel="뷰" ariaLabel="시간표 보기 방식" value={effView} options={([{ key: 'basic', label: '기본뷰' }, { key: 'integrated', label: '통합뷰' }, ...(teacherViewAllowed ? [{ key: 'teacher' as ViewMode, label: '강사뷰' }] : []), ...(roomsViewAllowed ? [{ key: 'rooms' as ViewMode, label: '교실뷰' }] : [])] as { key: ViewMode; label: string }[]).map((v) => ({ value: v.key, label: v.label, href: buildHref({ view: v.key, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView }) }))} />
              </span>
            )}
            {makeupTab ? null : <span data-help="tt-search" className="inline-flex items-center gap-3"><TimetableSearchToggle /></span>}
            {canEditGroups ? (
              <>
                <span className="bg-line h-4 w-px" aria-hidden />
                <ParamLink href={buildHref({ view: effView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, gedit: !groupEditing, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView })} title="통합뷰를 수업명만 남긴 상태로 바꿔 반을 끌어 옮깁니다" className={`${TOOLBAR_CHIP} gap-1.5 ${groupEditing ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}>
                  <Layers size={11} strokeWidth={1.8} />그룹 설정
                </ParamLink>
              </>
            ) : null}
            {isRooms || makeupTab ? null : (
              <>
                <span className="bg-line h-4 w-px" aria-hidden />
                <span data-help="tt-settings" className="inline-flex items-center gap-3">
                  <TimetableViewSettings allGrades={settings.operations.gradeLevels ?? []} savedGrades={viewPrefs.grades} showColor={effView === 'basic'}
                    collapseHref={effView === 'basic' ? buildHref({ view: effView, defaultView: thisSubjectDefaultView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods: !collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack }) : undefined}
                    collapseOn={collapseEmptyPeriods}
                    hideEmptyDaysHref={effView === 'teacher' ? buildHref({ view: effView, defaultView: thisSubjectDefaultView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays: !hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack }) : undefined}
                    hideEmptyDaysOn={hideEmptyDays}
                    hideStudentsHref={effView === 'basic' || effView === 'integrated' ? buildHref({ view: effView, defaultView: thisSubjectDefaultView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents: !hideStudents, englishTrack: carriedTrack }) : undefined}
                    hideStudentsOn={hideStudents} />
                </span>
                {englishTrack !== 'all' && slots.length === 0 && kindSlots.some((s) => s.subject === subject) ? (
                  <span className="bg-accent text-accent-foreground rounded-full px-2.5 py-0.5 text-xs">프로그램 필터({ENGLISH_TRACK_FILTER_LABEL[englishTrack]})에 걸려 표시할 수업이 없습니다 — &lsquo;전체&rsquo;로 바꿔 보세요.</span>
                ) : null}
                <span className="bg-line h-4 w-px" aria-hidden />
                <span data-help="tt-excel">
                  <TimetableToolbarActions subject={subject} today={today} kind={kind} canSync={canSync} canManageImport={canManageImport} canMasterImport={canMasterImport} sheetUrl={null} compact1h={compactList} />
                </span>
              </>
            )}
          </div>
          <div className="rail-spacer ml-auto" aria-hidden />
          <div className="toolbar-group flex flex-wrap items-center gap-3">
            {showEcsShortcut && !isRooms ? <div className="hidden compact-chrome:block"><EcsShortcut week={week} /></div> : null}
            {showEditorShortcut && !isRooms ? <EditorShortcut /> : null}
            {memo.canView ? <MemoSheetJumpButton className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`} /> : null}
            {!makeupTab && (effView === 'basic' || effView === 'integrated') && slots.length > 0 && canEdit ? <span data-help="tt-save"><TimetableEditControls rosterHidden={hideStudents} /></span> : null}
          </div>
        </ToolbarRow>
      </Toolbar>
    </PageMaximizeToolbar>
  );
  return (
    <TimetableEditProvider effectiveDate={effectiveDate} today={today} canEdit={canEdit} canSplit={false} weekMonday={week}>
      <TimetableSearchProvider index={searchIndex} scope={searchScope} enabled={searchEnabled}>
        <div data-maximize-toolbar-page="" className="edge-to-edge flex h-full min-h-0 flex-col gap-4 compact-chrome:gap-3">
          <TimetableViewPrefsSync hideEmptyDays={hideEmptyDays} collapseEmptyPeriods={collapseEmptyPeriods} hideStudents={hideStudents} subject={subject} sections={compactList} englishTrack={carriedTrack} savedHideEmptyDays={viewPrefs.hideEmptyDays} savedCollapseEmptyPeriods={viewPrefs.collapseEmptyPeriods} savedHideStudents={viewPrefs.hideStudents} savedSections={viewPrefs.compact1h?.[subject] ?? null} savedEnglishTrack={viewPrefs.englishTrack} />
          <TimetableColorPrefSync mode={viewPrefs.colorMode} />
          <TimetableFontPrefSync fontSize={viewPrefs.fontSize} />
          <div data-maximize-title-row="" className="shrink-0 compact-chrome:hidden">
            <PageHeader eyebrow={tt('수업 운영')} title={tt('시간표')} description={isRooms ? tt('교실 사용 현황 지도') : `${subjectMaps.labelOf(subject)} 주간표`} actions={isRooms || !showEcsShortcut ? null : <EcsShortcut week={week} />} />
          </div>
          {memoSplit ? null : toolbar}
          {memoSplit ? null : <TimetableSearchEmptyNote />}
          {makeupTab ? <NotYet what="보강 구분" /> : isRooms ? <NotYet what="교실뷰" /> : slots.length === 0 ? (
            <div className="mx-auto w-full max-w-xl py-4">
              <PhotoCard src="/photos/timetable-empty.webp" alt="" caption={kind === 'special' ? '이 기간에 등록된 특강이 없습니다' : '해당 과목의 시간표가 없습니다'} sub={kind === 'special' ? "반을 만들 때 '특강'을 켜면 여기에 표시됩니다 (운영 종료일이 지난 특강은 자동으로 내려갑니다)" : '가져오기 또는 편집으로 반을 배치해 보세요'} aspect="3/2" sizes="(max-width: 768px) 100vw, 576px" />
            </div>
          ) : isIntegrated && groupEditing ? (
            <IntegratedEditBoard subject={subject} cards={buildRichClassCards(slots, periodsConfig)} config={periodsConfig} teacherColors={teacherColors} subjectSoftClass={SUBJECT_SOFT[subjectMaps.colorOf(subject)]}
              initialGroups={(subjectRow?.integrationGroups ?? []).map((g) => ({ id: g.id, title: g.title, classIds: g.classIds ?? [] }))} initialEnabled={subjectRow?.integrationGroupsEnabled === true} initialShowOthers={subjectRow?.integrationShowOthers !== false}
              initialOthersTitle={subjectRow?.integrationOthersTitle ?? ''} initialPresets={groupPresets} initialCompactSections={compactList}
              doneHref={buildHref({ view: effView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView })} />
          ) : isIntegrated ? (
            memoSplit ? (
              <TimetableSplitPanes top={<>{toolbar}<TimetableSearchEmptyNote /></>} left={<RosterMoveArea canEdit={canEditRoster} today={today}>{integratedGrid}</RosterMoveArea>}
                right={<MemoSheetPane load={data.memoSheets[subject]} subject={subject} canEdit={memo.canEdit} />} />
            ) : (
              <RosterMoveArea canEdit={canEditRoster} today={today}>{integratedGrid}</RosterMoveArea>
            )
          ) : effView === 'teacher' ? <NotYet what="강사뷰" /> : (
            <ClassMoveProvider index={canEdit ? buildClassMoveIndex([...allSlots], [...new Set(slots.map((s) => s.classId ?? s.id))]) : null}>
              <TimetableDndArea>
                <TimetableZoomArea>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <EmptyPeriodScope collapsed={collapseEmptyPeriods} hideStudents={hideStudents}>
                      <WeekdayGroupTables slots={basicSlots} strays={strayReserved} config={periodsConfig} weekMonday={week} dayGroups={weekdayGroups} collapseEmptyPeriods={collapseEmptyPeriods} hideStudents={hideStudents} teacherOrder={viewPrefs.teacherOrder?.[subject]} />
                    </EmptyPeriodScope>
                  </div>
                </TimetableZoomArea>
              </TimetableDndArea>
            </ClassMoveProvider>
          )}
        </div>
      </TimetableSearchProvider>
    </TimetableEditProvider>
  );
}
