// 3.0 AX 원장 작업 공간 영역 정의(큐레이션) — build-workspace-catalog.mjs가 브라우저용 window.AxCatalog로 만든다.
// 영역 id = 패밀리 id(백엔드 model.workspaces.families와 같은 키). page = 'workspace-' + id.
// facet.ref = 원문 근거(빌드·검증 전용, 브라우저로 나가지 않는다): { route } 또는 { file, has }(그 파일에 has 문자열이 있어야 함).
// action.ops = 그 패밀리 핵심 동작 ID의 뒷부분(다른 패밀리는 'family.op'). 원장 표시 패밀리의 모든 핵심 동작은 어느 action엔가 연결돼야 한다.
// 핵심 동작 밖에서 새로 찾은 동작 묶음(operation-groups.mjs DISCOVERED)도 같은 id 공간이다 — 그 묶음의 dest.action이 이 동작이면 빌드가 sourceOperationIds에 더한다.
// mode: navigate = 같은 영역의 facet 또는 기존 시안 화면으로 이동 · preview = 저장하지 않는 로컬 계산·양식 미리보기 ·
//       request = 기존 다중 담당자 요청 흐름에 넣을 초안(원장이 담당자·기한을 고른다). 실제 쓰기·발송·결제는 없다.
// 필드 선택지는 opt('출처 id') — option-sources.mjs가 2.0 코드에서 읽는다.

const NAV = 'src/lib/navigation.ts';
const BILL = 'src/app/(shell)/billing/page.tsx';
const CALC = 'src/app/(shell)/billing/_components/calculator-panel.tsx';
const TBF = 'src/app/(shell)/billing/_components/textbooks-face.tsx';
const LRF = 'src/features/report-admin/lesson-report-faces.ts';
const INV = 'src/features/inventory/faces.ts';
const RET = 'src/features/retention/components/retention-tabs.tsx';
const APR = 'src/app/(shell)/approvals/page.tsx';
const STD = 'src/app/(shell)/students/[id]/_components/tabs-nav.tsx';
const CRF = 'src/features/class-review/faces.ts';
const TXB = 'src/features/textbooks/faces.ts';
const SUP = 'src/features/support/faces.ts';
const OWN = 'src/features/owner/tabs.ts';
const REG = 'src/features/dashboard/layout/registry.ts';
const INTEG = 'src/app/(shell)/owner/_components/integrations-face.tsx';
const PAR = 'src/app/(parent)/parent/_components/parent-tabs.tsx';
const KINDS = 'src/features/staff-tasks/kinds.ts';
const OUTC = 'src/features/enrollment/server/queries.ts';
const ONB = 'src/features/newcomers/onboarding-items.ts';
const SLK = 'src/features/slack/activity-catalog.ts';

const route = r => ({ route: r });
const text = (file, has) => ({ file, has });
const fc = (id, label, ref, kind = 'tab') => ({ id, label, kind, ref });
const opt = name => ({ optionsFrom: name });

// 필드
const f = (id, label, type, extra = {}) => ({ id, label, type, ...extra });
const student = (req = true) => f('student', '원생', 'student', { required: req });
const cls = (req = true) => f('class', '반', 'class', { required: req });
const staff = (label = '담당 직원', req = true) => f('staff', label, 'staff', { required: req });
const date = (id = 'date', label = '날짜', req = true) => f(id, label, 'date', { required: req });
const month = (req = true) => f('month', '월', 'month', { required: req });
const memo = (label = '메모', req = false) => f('memo', label, 'textarea', { required: req });
const sel = (id, label, source, req = true) => f(id, label, 'select', { required: req, ...opt(source) });

// 동작
const nav = (id, label, facet, ops, body, page = null) => ({ id, label, mode: 'navigate', target: { page, facet }, draft: { title: label, body }, fields: [], ops, result: '화면 이동' });
const pre = (id, label, fields, ops, title, body, result = '미리보기 — 저장되지 않습니다') => ({ id, label, mode: 'preview', draft: { title, body }, fields, ops, result });
const req = (id, label, fields, ops, title, body) => ({ id, label, mode: 'request', draft: { title, body }, fields, ops, result: '요청 초안으로 열기' });

export const AREA_GROUPS = [
  { id: 'home', label: '홈' }, { id: 'class', label: '수업' }, { id: 'student', label: '원생' }, { id: 'operation', label: '운영' },
  { id: 'support', label: '지원' }, { id: 'integration', label: '연동·자동화' }, { id: 'roles', label: '역할별 화면' },
];

export const AREAS = [
  // ───────── 홈 ─────────
  { id: 'dashboard', label: '대시보드', group: 'home', viewKind: 'report', summary: '역할별로 배치한 지표와 카드로 학원 현황을 봅니다.',
    facets: [fc('kpi', '상단 지표', text(REG, 'enrolledToday')), fc('attendance', '출결·수업', text(REG, '출결·수업'), 'filter'), fc('students', '학생·재원', text(REG, '학생·재원'), 'filter'),
      fc('admissions', '상담·신입', text(REG, '상담·신입'), 'filter'), fc('billing', '수납·지출', text(REG, '수납·지출'), 'filter'), fc('operations', '학원 운영', text(REG, '학원 운영'), 'filter'),
      fc('announcements', '학원 공지', route('/dashboard/announcements'), 'face')],
    actions: [
      nav('dashboard.kpi', '지표 다시 보기', 'kpi', ['refreshOverview', 'refreshClassroomPreview', 'saveDashboardChartKind', 'setOnboardingDismissed'], '재원생·강좌수·퇴원·신규문의 등 상단 지표와 카드 묶음을 엽니다.'),
      pre('dashboard.announcement', '학원 공지 작성', [f('title', '제목', 'text', { required: true }), f('body', '내용', 'textarea', { required: true }), f('pinned', '위에 고정', 'checkbox')], ['createAnnouncement'], '학원 공지 미리보기', '직원에게 보일 공지 문구를 미리 확인합니다.'),
      pre('dashboard.briefing', '일일 브리핑 상태', [], ['regenerateDailyBriefing'], '일일 브리핑', '일일 브리핑 생성은 현재 꺼져 있습니다. 이 화면의 이슈 정리로 대신 봅니다.', '꺼진 기능 안내'),
      nav('dashboard.layout', '역할별 대시보드 배치', 'dashboard', [], '원장이 역할마다 카드 배치를 정하는 설정 면으로 이동합니다.', 'workspace-owner-settings'),
    ] },
  { id: 'calendar', label: '캘린더', group: 'home', viewKind: 'timeline', summary: '학원 공용 일정과 보강 약속을 날짜로 봅니다.',
    facets: [fc('month', '월', route('/calendar')), fc('tags', '일정 태그', text('src/features/calendar/server/actions.ts', 'saveCalendarTag'), 'filter')],
    actions: [
      pre('calendar.event', '일정 추가', [f('title', '일정 제목', 'text', { required: true }), date('start', '시작일'), date('end', '종료일', false), f('time', '시작 시각', 'time')], ['saveCalendarEvent'], '일정 미리보기', '학원 일정에 추가될 모습을 미리 봅니다. 구글 캘린더로는 보내지 않습니다.'),
      pre('calendar.tag', '태그 만들기', [f('name', '태그 이름', 'text', { required: true })], ['saveCalendarTag'], '일정 태그', '일정을 묶어 볼 태그 이름을 정합니다.'),
    ] },
  { id: 'tasks-notifications', label: '할 일·알림', group: 'home', viewKind: 'flow', summary: '기록에서 자동으로 생긴 할 일과 알림을 처리 상태로 봅니다.',
    facets: [fc('open', '열린 일', text(KINDS, '열린 일'), 'filter'), fc('late', '늦음', text(KINDS, '늦음'), 'filter'), fc('closed', '끝난 일', text(KINDS, '끝난 일'), 'filter'), fc('inbox', '알림함', route('/dashboard'), 'face')],
    actions: [
      nav('tasks-notifications.inbox', '알림함 열기', null, ['markNotificationsRead'], '안 읽은 알림과 보관함을 봅니다.', 'inbox'),
      pre('tasks-notifications.kind', '할 일 종류별 보기', [sel('kind', '할 일 종류', 'staffTaskKind'), sel('filter', '상태', 'staffTaskFilter')], ['api-staff-tasks'], '할 일 목록', '자동 할 일은 기록이 바뀌면 저절로 닫힙니다. 여기서는 종류와 상태로 거른 목록을 봅니다.'),
      req('tasks-notifications.follow', '할 일 후속 요청', [sel('kind', '할 일 종류', 'staffTaskKind'), memo('요청 내용', true)], ['api-staff-tasks'], '할 일 처리 확인 요청', '아래 종류의 할 일이 어떻게 처리되고 있는지 확인해 알려 주세요. 할 일은 원래 기록이 바뀌어야 닫힙니다.'),
    ] },
  // ───────── 수업 ─────────
  { id: 'onescreen', label: '선생님 수업보고서', group: 'class', viewKind: 'sheet', summary: '선생님이 수업보고서를 쓰고 보내며 출결·공지·보강까지 한곳에서 마감하는 화면을 봅니다.',
    facets: [fc('reports', '수업보고서', route('/onescreen')), fc('video', '영상 제출 현황', route('/onescreen/video-homework'), 'face'), fc('notice', '학부모 공지', text('src/features/onescreen/server/notice-actions.ts', 'sendOnescreenNotice'))],
    actions: [
      req('onescreen.unwritten', '보고서 작성 요청', [cls(), date(), memo()], ['saveLessonReport', 'saveMyReportTemplate', 'issueReportAttachmentUploadTicket'], '수업보고서 작성 요청', '아래 반·날짜의 수업보고서를 작성해 주세요. 작성하면 발송 큐에 올라갑니다.'),
      pre('onescreen.ment', 'AI 멘트 미리보기', [student(), f('notes', '선생님 특이사항', 'textarea', { required: true })], ['generateReportComment', 'savePrompt'], 'AI 멘트 미리보기', '이 화면은 AI를 부르지 않습니다. 자동작성에 들어가는 입력 칸을 확인하는 양식입니다.', '입력 확인 — AI 호출 없음'),
      pre('onescreen.notice', '학부모 공지 초안', [cls(), f('body', '공지 내용', 'textarea', { required: true })], ['sendOnescreenNotice'], '학부모 공지 미리보기', '반 학부모에게 보낼 공지 문구를 미리 봅니다. 실제 ClassNote 발송은 하지 않습니다.'),
      pre('onescreen.makeup', '보강 학생 등록', [student(), cls(), date('date', '보강일')], ['registerMakeupEntries'], '보강 학생 등록 미리보기', '보강 학생을 수업 명단에 올리는 내용을 확인합니다.'),
      req('onescreen.share', '공유 링크 재발급 요청', [student(), memo('사유', true)], ['reissueShareLink'], '보고서 공유 링크 재발급', '학부모 공유 링크를 다시 발급해 주세요.'),
    ] },
  { id: 'video-homework', label: '영상 숙제', group: 'class', viewKind: 'records', summary: '영상 숙제 제출·배정·확인을 장부로 봅니다.',
    facets: [fc('ledger', '영상 제출 현황', route('/lesson-reports/video-homework')), fc('mine', '선생님별 장부', route('/onescreen/video-homework'), 'face'), fc('site', '숙제 영상 올리기', route('/v'), 'face')],
    actions: [
      pre('video-homework.mark', '제출 확인 표시', [student(), cls(), date('date', '숙제일'), sel('status', '확인 결과', 'videoLedgerStatus')], ['setVideoHomeworkMark'], '제출 확인 미리보기', '장부 칸의 확인 결과를 바꾸는 내용을 미리 봅니다.'),
      req('video-homework.assign', '미배정 영상 배정 요청', [student(), memo('영상·숙제 정보', true)], ['assignHomeworkVideo'], '미배정 영상 배정', '숙제 칸에 붙지 않은 영상을 해당 숙제에 배정해 주세요.'),
      req('video-homework.review', 'AI 메모 다시 분석 요청', [student(), memo()], ['rerunVideoReview'], '영상 AI 참고 메모 다시 분석', '아래 원생 영상의 AI 참고 메모를 다시 분석해 주세요.'),
      nav('video-homework.site', '올리기 사이트 미리보기', 'site', ['revokeVideoSubmitLinks', 'api-video-submit-start'], '학생이 휴대폰 뒷 4자리와 이름으로 영상을 올리는 공개 화면을 봅니다.'),
    ] },
  { id: 'timetable', label: '시간표', group: 'class', viewKind: 'sheet', summary: '과목별 수업 배치와 반 이동·시트 가져오기를 봅니다.',
    facets: [fc('board', '시간표', route('/timetable')), fc('editor', '시간표 편집기', route('/timetable/editor'), 'face'), fc('english-sheet', '영어 시트 반영', route('/timetable/english-sheet'), 'face')],
    actions: [
      pre('timetable.move', '반 배치 이동 미리보기', [cls(), sel('day', '요일', 'weekday'), f('start', '시작 시각', 'time', { required: true }), date('effective', '적용일')], ['moveClassSlots', 'createClassSplit'], '반 배치 이동 미리보기', '반의 요일·시각을 옮긴 모습을 확인합니다. 운영 시간표는 바뀌지 않습니다.'),
      req('timetable.import', '시트 가져오기 요청', [f('subject', '과목', 'subject', { required: true }), date('effective', '적용일'), memo()], ['previewSheetImport', 'previewMathSheetBundle', 'previewMasterSheet'], '시간표 시트 가져오기', '시트에서 바뀐 내용을 미리보기로 확인한 뒤 적용일부터 반영해 주세요.'),
      nav('timetable.editor', '편집기 연습본', 'editor', ['previewTimetableLabApply'], '운영과 분리된 연습본에서 다음 시간표를 짜 봅니다.'),
      pre('timetable.memo', '메모 시트 보기', [memo('메모 내용', true)], ['saveMemoSheet'], '영어 메모 시트', '영어 통합뷰 옆 메모 시트의 내용을 확인합니다.'),
    ] },
  { id: 'class-sheets', label: '강사 시트', group: 'class', viewKind: 'sheet', summary: '영어·수학 강사 시트의 목표·수업계획·진도를 봅니다.',
    facets: [fc('ecs', '영어', route('/ecs')), fc('ecs-month', '월간', route('/ecs/[classId]/month'), 'face'), fc('goals', '반 계획 보기', route('/ecs/goals'), 'face'), fc('plan-gap', '계획 대비 현황', route('/ecs/plan-gap'), 'face'),
      fc('mcs', '수학', route('/mcs')), fc('mcs-teachers', '선생님별', route('/mcs/teachers'), 'face'), fc('progress-map', '수학 학습 진도맵', route('/mcs/progress-map'), 'face')],
    actions: [
      pre('class-sheets.goal', '반 목표 미리보기', [cls(), f('scope', '범위', 'select', { required: true, options: [{ value: 'month', label: '월간 목표' }, { value: 'week', label: '주간 목표' }], evidence: { file: 'src/features/class-sheets/server/actions.ts', has: ['scope: "month" | "week"'] } }), f('goal', '목표', 'textarea', { required: true })], ['upsertGoal', 'saveMonthPlanCells', 'copyWeekFromPrevious'], '반 목표 미리보기', '영어 반의 월간·주간 목표 문구를 확인합니다.'),
      req('class-sheets.missing', '시트 작성 요청', [cls(), date('week', '주(월요일)'), memo()], ['upsertStudentMark', 'pullEcsMemorizedWords'], '강사 시트 작성 요청', '아래 반·주의 강사 시트(출결·진도·표시)를 채워 주세요.'),
      nav('class-sheets.gap', '계획 대비 현황', 'plan-gap', [], '선생님별로 실제 수업이 원래 월간계획과 얼마나 달랐는지 봅니다.'),
      pre('class-sheets.math', '수학 학습 목표 미리보기', [cls(), month(), f('goal', '목표 차시', 'text', { required: true })], ['saveMathLearningGoals'], '수학 학습 목표', '수학 반의 월 목표 차시를 확인합니다.'),
    ] },
  { id: 'attendance', label: '출석부', group: 'class', viewKind: 'sheet', summary: '월별 출석부·오늘 출결·자리 출석부·키오스크를 봅니다.',
    facets: [fc('monthly', '월별 출석부', route('/attendance')), fc('live', '오늘 출결', route('/attendance/live')), fc('quick', '출결 모드', route('/attendance/quick')), fc('date', '날짜별 입력', route('/attendance/[date]/[classId]'), 'face'),
      fc('seat', '랩실·JJ실 출석부', route('/attendance/seat/[seat]'), 'face'), fc('stats', '출결 통계', route('/attendance/stats'), 'face'), fc('units', '시수 마스터', route('/attendance/units-master'), 'face'), fc('kiosk', '키오스크 설정', route('/kiosk-settings'), 'face')],
    actions: [
      pre('attendance.mark', '출결 기록 미리보기', [student(), cls(), date(), sel('status', '출결', 'attendanceStatus'), memo('사유')], ['setAttendanceCell', 'setSeatCell'], '출결 기록 미리보기', '출결 칸에 들어갈 상태와 사유를 확인합니다. 출석부는 바뀌지 않습니다.'),
      req('attendance.absence-call', '결석 확인 전화 요청', [student(), date(), memo('확인할 내용')], ['requestDeskConfirm'], '결석 확인 전화', '결석한 원생의 사유를 보호자에게 확인하고 보강 필요 여부를 알려 주세요.'),
      pre('attendance.intake', '결석 사전 접수', [student(), date('from', '시작일'), date('to', '종료일', false), memo('사유', true)], ['previewAbsenceIntake'], '결석 사전 접수 미리보기', '보호자가 미리 알린 결석을 접수했을 때 영향을 받는 수업을 확인합니다.'),
      pre('attendance.makeup', '보강 예약', [student(), cls(), date('absence', '결석일'), date('makeup', '보강일'), f('slot', '교시 시각', 'time')], ['reserveMakeup'], '보강 예약 미리보기', '결석 칸과 보강 날짜·교시를 맞춰 봅니다.'),
      pre('attendance.recap', '출결 요약 보기', [date('from', '시작일'), date('to', '종료일')], ['generateRecapSummary'], '출결 요약', '기간의 출결 집계를 봅니다. 이 시안은 AI 요약을 부르지 않습니다.', '집계 미리보기 — AI 호출 없음'),
      nav('attendance.kiosk', '출석 키오스크 설정', 'kiosk', ['registerKioskDevice', 'api-attendance-checkin'], '출석 키오스크 기기와 알림 설정을 봅니다.'),
      nav('attendance.salary', '실급여 비율', 'monthly', ['saveAttendanceSalaryRates'], '선생님별 실급여 비율과 표시 여부를 월별 출석부에서 봅니다.'),
    ] },
  { id: 'classes', label: '수업목록', group: 'class', viewKind: 'records', summary: '반 목록과 반 상세(수강생·시간표·인수인계)를 봅니다.',
    facets: [fc('list', '수업목록', route('/classes')), fc('detail', '반 상세', route('/classes/[id]'), 'face'), fc('new', '새 반', route('/classes/new'), 'face')],
    actions: [
      nav('classes.legacy', '반 목록 열기', null, [], '현재 시안의 수업·시간표 화면을 엽니다.', 'classes'),
      req('classes.open', '반 개설 요청', [f('name', '반 이름', 'text', { required: true }), staff('담임'), sel('day', '요일', 'weekday'), f('start', '시작 시각', 'time')], ['createClass'], '반 개설 요청', '아래 조건으로 새 반을 만들어 주세요.'),
      pre('classes.handover', '담임 인수인계 예약', [cls(), staff('새 담임'), date('effective', '적용일')], ['scheduleHandover'], '인수인계 예약 미리보기', '적용일부터 담임이 바뀌는 내용을 확인합니다.'),
      pre('classes.delegation', '결근 대체 위임', [cls(), staff('대신 맡을 선생님'), date('from', '시작일'), date('to', '종료일')], ['createClassDelegation'], '결근 대체 위임 미리보기', '기간 동안 다른 선생님이 반을 맡는 내용을 확인합니다.'),
      pre('classes.enroll', '수강 배정', [student(), cls(), date('start', '시작일')], ['createEnrollment', 'rescheduleEnrollment'], '수강 배정 미리보기', '원생을 반에 배정하는 내용을 확인합니다.'),
      req('classes.term-end', '운영 기간 종료 요청', [cls(), date('end', '종료일'), memo()], ['endClassTerm'], '반 운영 기간 종료', '아래 반의 운영 기간을 종료해 주세요. 열린 수강은 종료일로 닫힙니다.'),
      pre('classes.classroom-auto', '강의실 자동배정 미리보기', [], ['classroom-auto'], '강의실 자동배정 미리보기', '반마다 강의실을 자동으로 정했을 때 바뀌는 반만 확인합니다. 적용하지 않습니다.'),
      req('classes.level', '반 레벨 변경 요청', [cls(), f('change', '변경', 'select', { required: true,
        options: [{ value: 'number-up', label: '숫자 올리기' }, { value: 'number-down', label: '숫자 내리기' }, { value: 'class-up', label: '레벨 올리기' }, { value: 'class-down', label: '레벨 내리기' }],
        evidence: [{ file: 'src/features/timetable/lib/level.ts', has: ['"number-up" | "number-down" | "class-up" | "class-down"'] },
          { file: 'src/features/teacher-view/i18n.ts', has: ['숫자 올리기 (예: DP3 → DP4)', '숫자 내리기 (예: DP4 → DP3)', '레벨 올리기 (예: DP3 → PL1)', '레벨 내리기 (예: PL1 → DP3)'] }] })],
      ['timetable.class-level'], '반 레벨 변경', '아래 영어 반의 이름을 레벨 규칙에 따라 바꿔 주세요(예: DP3 → DP4). 같은 이름의 반이 이미 있으면 바뀌지 않습니다.'),
    ] },
  { id: 'makeups', label: '보강관리', group: 'class', viewKind: 'flow', summary: '보강 사례를 접수부터 인정·종결까지 단계로 봅니다.',
    facets: [fc('cases', '보강관리', route('/makeups')), fc('candidates', '미연결 근거', route('/makeups/candidates'), 'face'), fc('dry-run', '도입 사전 점검', route('/makeups/dry-run'), 'face'), fc('reconciliation', '대사·복구', route('/makeups/reconciliation'), 'face')],
    actions: [
      pre('makeups.intake', '보강 접수', [student(), cls(), sel('reason', '보강 사유', 'makeupReason'), date('original', '원래 수업일'), memo()], ['executeMakeupCommand'], '보강 접수 미리보기', '보강 사례가 접수되는 내용을 확인합니다.'),
      pre('makeups.plan', '보강 계획', [sel('action', '처리', 'makeupAction'), date('due', '기한', false), staff('담당', false), memo()], ['executeMakeupCommand', 'searchMakeupOptions'], '보강 처리 미리보기', '선택한 처리(예약·일정 변경·인정 등)를 적용했을 때의 내용을 확인합니다.'),
      req('makeups.owner', '보강 담당 지정 요청', [student(), staff('담당'), date('due', '기한')], ['executeMakeupCommand'], '보강 담당 지정', '아래 보강 사례를 맡아 기한까지 처리해 주세요.'),
      nav('makeups.history', '보강 이력', 'cases', ['loadMakeupEvents'], '보강 사례의 처리 이력을 봅니다.'),
    ] },
  { id: 'textbooks', label: '교재목록', group: 'class', viewKind: 'records', summary: '수업 교재와 차수별 진도·과제, 반 배정을 봅니다.',
    facets: [fc('books', '교재', text(TXB, '"교재"')), fc('plans', '반 배정', text(TXB, '반 배정'))],
    actions: [
      pre('textbooks.book', '교재 미리보기', [f('title', '교재 이름', 'text', { required: true }), f('lessons', '차수', 'number', { required: true })], ['saveTextbook', 'registerTextbookCover'], '교재 미리보기', '교재와 차수 구성을 확인합니다.'),
      pre('textbooks.fill', '반 배정 채우기', [cls(), date('start', '시작일')], ['previewTextbookFill', 'saveMathTextbookAssignment'], '반 배정 미리보기', '반의 수업일에 차수를 차례로 채운 모습을 봅니다.'),
      req('textbooks.shift', '회차 미룸·당김 요청', [cls(), date(), f('direction', '방향', 'select', { required: true, options: [{ value: 'skip', label: '미룸' }, { value: 'advance', label: '당김' }], evidence: { file: 'src/features/textbooks/server/plan-actions.ts', has: ['"skip" | "advance"'] } })], ['setLessonShift'], '수업 회차 조정', '아래 반·날짜의 수업 회차를 조정해 주세요.'),
    ] },
  { id: 'lesson-reports', label: '수업보고서', group: 'class', viewKind: 'report', summary: '수업보고서 작성률·목록과 ClassNote 발송을 봅니다.',
    facets: [fc('writing', '작성률', text(LRF, '작성률')), fc('list', '목록', text(LRF, '"목록"')), fc('queue', '발송 큐', text(LRF, '발송 큐'), 'tab'), fc('boards', '반 구성', text(LRF, '반 구성')),
      fc('notice', '반 공지', text(LRF, '반 공지')), fc('compose', '직접 발송', text(LRF, '직접 발송')), fc('recall', '회수', text(LRF, '"회수"')), fc('parent_replies', '학부모 글·답글', text(LRF, '학부모 글·답글')),
      fc('report', '보고서 설정', text(LRF, '보고서 설정')), fc('ai_ment', 'AI 멘트', text(LRF, 'AI 멘트')), fc('stats', '보고서 통계', route('/lesson-reports/stats'), 'face')],
    actions: [
      nav('lesson-reports.queue', '발송 큐 보기', 'queue', ['refreshClassnoteQueue', 'listReports'], '발송 대기·실패·보류 보고서를 봅니다.'),
      pre('lesson-reports.compose', '직접 작성 미리보기', [student(), cls(), date(), f('body', '보고서 내용', 'textarea', { required: true })], ['saveAdminReport'], '수업보고서 미리보기', '학부모에게 보일 보고서 카드를 미리 봅니다. 발송하지 않습니다.'),
      pre('lesson-reports.notice', '반 공지 미리보기', [cls(), f('body', '공지 내용', 'textarea', { required: true })], ['previewClassNotice'], '반 공지 미리보기', '반 보드에 올릴 공지를 미리 봅니다.'),
      req('lesson-reports.recall', '보고서 회수 요청', [student(), date(), memo('회수 사유', true)], ['requestReportRecall'], '보고서 회수', '아래 보고서를 학부모 알림장에서 회수해 주세요.'),
      req('lesson-reports.board', '반 보드 원아 연결 요청', [student(), cls(), memo()], ['linkClassnoteChild'], 'ClassNote 반 보드 연결', '원생을 해당 반 보드의 원아와 연결해 주세요.'),
      pre('lesson-reports.reply', '학부모 글 답글 초안', [student(), f('body', '답글', 'textarea', { required: true })], ['requestParentReply'], '학부모 답글 미리보기', '학부모 글에 남길 답글을 미리 봅니다. 실제로 게시하지 않습니다.'),
      nav('lesson-reports.parents', '학부모 소통 보기', null, [], '현재 시안의 학부모 소통 화면을 엽니다.', 'parents'),
    ] },
  { id: 'class-review', label: '직원 평가', group: 'class', viewKind: 'report', summary: '수업 참관 평가와 직원 포트폴리오를 봅니다.',
    facets: [fc('review', '직원 평가', text(CRF, '"직원 평가"')), fc('portfolio', '직원 포트폴리오', text(CRF, '직원 포트폴리오')), fc('board', '직원 평가 종합', route('/class-review/board'), 'face'), fc('template', '문항 편집', route('/class-review/template'), 'face')],
    actions: [
      req('class-review.open', '참관 평가 개설 요청', [staff('평가 대상 선생님'), staff('평가자'), memo()], ['createClassReview'], '수업 참관 평가', '아래 선생님의 수업을 참관해 평가해 주세요.'),
      nav('class-review.portfolio', '직원 포트폴리오', 'portfolio', ['refreshTeacherPortfolioNow', 'decideJudgment'], '항목별 점수와 근거를 봅니다.'),
      nav('class-review.criteria', '평가 기준', 'evaluation', ['saveEvaluationSettings', 'saveChecklistTemplate'], '강사평가 지표·만점을 정하는 설정 면으로 이동합니다.', 'workspace-owner-settings'),
    ] },
  // ───────── 원생 ─────────
  { id: 'students', label: '원생목록', group: 'student', viewKind: 'records', summary: '원생 명단과 원생 상세(수업·성적·출결·상담·수납 등)를 봅니다.',
    facets: [fc('list', '원생목록', route('/students')), fc('stats', '원생 통계', route('/students/stats'), 'face'),
      fc('overview', '개요', text(STD, '"개요"')), fc('classes', '수업', text(STD, '"수업"')), fc('grades', '성적', text(STD, '"성적"')), fc('srs', 'SRS', text(STD, '"SRS"')), fc('todays-math', '오늘 수학', text(STD, '"오늘 수학"')),
      fc('progress', '진도', text(STD, '"진도"')), fc('homework-videos', '숙제 영상', text(STD, '"숙제 영상"')), fc('attendance', '출결', text(STD, '"출결"')), fc('consultations', '상담', text(STD, '"상담"')),
      fc('memos', '특이사항', text(STD, '"특이사항"')), fc('billing', '수납', text(STD, '"수납"')), fc('contribution', '기여도', text(STD, '"기여도"')), fc('timeline', '타임라인', text(STD, '"타임라인"'))],
    actions: [
      nav('students.legacy', '원생 화면 열기', null, [], '현재 시안의 원생 화면(검색·상세)을 엽니다.', 'students'),
      req('students.register', '원생 등록 요청', [f('name', '이름', 'text', { required: true }), f('school', '학교', 'text'), f('grade', '학년', 'text')], ['createStudent', 'updateStudentEnglishName'], '원생 등록', '아래 원생을 등록해 주세요.'),
      pre('students.status', '상태 전환 미리보기', [student(), f('status', '바꿀 상태', 'select', { required: true, optionsFrom: 'studentStatus', only: ['enrolled', 'on_hold'] }), date('effective', '적용일')], ['changeStudentStatus'], '상태 전환 미리보기', '재원·휴원 전환 내용을 확인합니다. 퇴원은 퇴원보고서로만 처리됩니다.'),
      pre('students.end', '수강 종료 미리보기', [student(), cls(), date('end', '종료일'), sel('reason', '종료 사유', 'withdrawalReason')], ['endStudentEnrollments'], '수강 종료 미리보기', '과목 수강을 종료할 때의 내용을 확인합니다.'),
      pre('students.memo', '특이사항 메모', [student(), f('body', '특이사항', 'textarea', { required: true })], ['createStudentMemo'], '특이사항 미리보기', '원생 상세에 남길 특이사항을 확인합니다.'),
      pre('students.grade', '성적 기록', [student(), date('taken', '시험일'), f('score', '점수', 'number', { required: true }), f('max', '만점', 'number')], ['createStudentGrade'], '성적 기록 미리보기', '원생 성적 기록을 확인합니다.'),
      req('students.progress', '진도 이상 확인 요청', [student(), memo('확인할 내용', true)], ['setProgressAnomalyResolved'], '진도 기록 이상 확인', '진도 기록 이상을 확인하고 처리 결과를 알려 주세요.'),
    ] },
  { id: 'student-contribution', label: '원생 기여도', group: 'student', viewKind: 'records', summary: '원생별 운영 기여·학습 참여·연결 기록을 봅니다.',
    facets: [fc('list', '원생 기여도', route('/student-contribution')), fc('ontology', '학생 기록의 연결', route('/student-contribution/ontology'), 'face'), fc('referrals', '지난 소개 확인', route('/student-contribution/referrals'), 'face'), fc('settings', '기여도 배점 설정', route('/student-contribution/settings'), 'face')],
    actions: [
      nav('student-contribution.list', '기여도 목록', 'list', ['refreshContribution'], '원생별 기여도와 최근 변화를 봅니다.'),
      pre('student-contribution.referral', '소개자 연결', [student(), f('referrer', '소개한 원생', 'student', { required: true })], ['searchReviewedReferrers'], '소개 연결 미리보기', '지난 소개 기록을 원생에게 잇는 내용을 확인합니다.'),
      pre('student-contribution.summary', '기록 요약 보기', [student()], ['generateStudentRecordSummary'], '원생 기록 요약', '최근 기록을 모아 봅니다. 이 시안은 AI 요약을 부르지 않습니다.', '기록 모음 — AI 호출 없음'),
      nav('student-contribution.settings', '배점 설정', 'settings', ['saveContributionSettings'], '기여도 배점 설정을 봅니다.'),
    ] },
  { id: 'exams', label: '성적관리', group: 'student', viewKind: 'sheet', summary: '학기별 시험 성적을 입력 격자와 확인 뷰로 봅니다.',
    facets: [fc('unified', '통합 성적관리', route('/exams')), fc('input', '성적 입력', route('/exams/input'), 'face'), fc('view', '성적 확인', route('/exams/view'), 'face'), fc('jj', 'JJ실 시험 결과', route('/exams/jj/[deckId]'), 'face')],
    actions: [
      pre('exams.score', '점수 입력 미리보기', [cls(), student(), f('exam', '시험', 'text', { required: true }), f('score', '점수', 'number', { required: true })], ['saveGradeScores'], '점수 입력 미리보기', '격자에 들어갈 점수를 확인합니다.'),
      req('exams.excel', '엑셀 성적 반영 요청', [cls(), f('exam', '시험', 'text', { required: true }), memo()], ['importGradesExcel'], '성적 엑셀 반영', '서식에 맞춘 성적 엑셀을 반영해 주세요.'),
      req('exams.ijw', '인재원 학생 연결 요청', [student(), memo()], ['linkIjwStudent'], '인재원 학생 연결', '원생과 인재원 학습 계정을 연결해 주세요.'),
      nav('exams.learning', '학습·성과 보기', null, [], '현재 시안의 학습·성과 화면을 엽니다.', 'learning'),
    ] },
  { id: 'consultations', label: '원생상담', group: 'student', viewKind: 'records', summary: '재원생 상담 기록과 후속조치를 봅니다.',
    facets: [fc('list', '원생상담', route('/consultations')), fc('stats', '상담 통계', route('/consultations/stats'), 'face'), fc('new', '새 원생상담', route('/consultations/new'), 'face')],
    actions: [
      pre('consultations.write', '상담 기록 미리보기', [student(), sel('category', '상담 분류', 'consultationCategory'), sel('audience', '상담 대상', 'consultationAudience'), f('summary', '상담 내용', 'textarea', { required: true }), date('followup', '후속조치 기한', false)], ['createStudentConsultation'], '상담 기록 미리보기', '상담 기록과 후속조치 기한을 확인합니다.'),
      req('consultations.followup', '후속조치 요청', [student(), date('due', '기한'), memo('후속조치 내용', true)], ['toggleConsultationFollowUp'], '상담 후속조치', '아래 원생의 상담 후속조치를 진행하고 결과를 남겨 주세요.'),
      pre('consultations.audio', '녹음으로 상담 시작', [student(), f('file', '녹음 파일 이름', 'text')], ['startStudentConsultationFromAudio'], '녹음 상담', '녹음 업로드 후 전사·분석이 진행되는 흐름입니다. 이 시안은 파일을 올리거나 분석하지 않습니다.', '흐름 안내 — 업로드 없음'),
    ] },
  { id: 'enrollment', label: '신규 콜&상담', group: 'student', viewKind: 'flow', summary: '신규 콜&상담을 접수부터 등록까지 단계로 봅니다.',
    facets: [fc('pending', '대기', text(OUTC, '"대기"'), 'stage'), fc('scheduled', '예약', text(OUTC, '"예약"'), 'stage'), fc('consulted', '상담완료', text(OUTC, '"상담완료"'), 'stage'), fc('enrolled', '재원생 등록 완료', text(OUTC, '재원생 등록 완료'), 'stage'),
      fc('declined', '거절', text(OUTC, '"거절"'), 'stage'), fc('no_show', '노쇼', text(OUTC, '"노쇼"'), 'stage'), fc('intake', 'QR 상담 접수', route('/intake/[token]'), 'face')],
    actions: [
      nav('enrollment.legacy', '신규 상담 보기', null, [], '현재 시안의 신규 콜&상담 화면을 엽니다.', 'admissions'),
      pre('enrollment.write', '상담 접수 미리보기', [f('name', '원생 이름', 'text', { required: true }), f('grade', '학년', 'text'), sel('path', '상담 경로', 'consultationPath'), date('consulted', '상담일')], ['createEnrollmentConsultation'], '신규 상담 접수', '접수될 상담 카드를 확인합니다.'),
      pre('enrollment.outcome', '결과 지정', [f('name', '원생 이름', 'text', { required: true }), sel('outcome', '결과', 'enrollmentOutcome'), date('next', '다음 상담일', false)], ['setEnrollmentOutcome'], '상담 결과 미리보기', '칸반 단계가 바뀌는 내용을 확인합니다.'),
      req('enrollment.convert', '원생 전환·반 배정 요청', [f('name', '원생 이름', 'text', { required: true }), cls()], ['convertConsultationToStudent'], '원생 전환', '아래 상담 학생을 원생으로 등록하고 반에 배정해 주세요.'),
      pre('enrollment.brief', '상담 준비 보기', [f('name', '원생 이름', 'text', { required: true })], ['regenerateConsultationAnalysis'], '상담 준비', '이전 상담과 같은 사람 기록을 모아 봅니다. 이 시안은 AI 분석을 부르지 않습니다.', '기록 모음 — AI 호출 없음'),
      nav('enrollment.qr', 'QR 상담 접수', 'intake', ['createIntakeToken'], '학부모가 QR로 상담을 신청하는 공개 화면을 봅니다.'),
      req('enrollment.makeedu', 'makeedu 전송 요청', [f('name', '원생 이름', 'text', { required: true })], ['enqueueConsultationPush'], 'makeedu 상담 전송', 'QR 접수 상담을 makeedu로 보내 주세요(연동 PC 필요).'),
    ] },
  { id: 'retention', label: '이탈 방어', group: 'student', viewKind: 'flow', summary: '이탈 위험 원생과 재등록 캠페인을 봅니다.',
    facets: [fc('brief', '브리핑', text(RET, '"브리핑"')), fc('board', '리텐션 보드', text(RET, '리텐션 보드')), fc('messages', '학부모 메시지', text(RET, '학부모 메시지')), fc('campaign', '재등록 캠페인', text(RET, '재등록 캠페인'))],
    actions: [
      pre('retention.campaign', '캠페인 대상 추가', [student(), memo()], ['campaignAdd'], '재등록 캠페인 미리보기', '원생을 재등록 캠페인 대상에 넣는 내용을 확인합니다.'),
      req('retention.contact', '보호자 연락 요청', [student(), memo('연락할 내용', true), date('due', '기한')], ['logRetentionAction'], '이탈 방어 연락', '아래 원생의 보호자에게 연락하고 결과를 남겨 주세요.'),
      nav('retention.board', '리텐션 보드', 'board', [], '이탈 위험이 있는 재원생을 봅니다.'),
    ] },
  { id: 'newcomers', label: '신규생 관리', group: 'student', viewKind: 'flow', summary: '신입 등록 후 90일 체크리스트를 단계로 봅니다.',
    facets: [fc('pre_call', '수업 전 사전 콜', text(ONB, '수업 전 사전 콜'), 'stage'), fc('first_class_guide', '첫 수업 안내', text(ONB, '첫 수업 안내'), 'stage'), fc('ojt', 'OJT', text(ONB, '"OJT"'), 'stage'),
      fc('after_first_call', '첫 수업 후 콜', text(ONB, '첫 수업 후 콜'), 'stage'), fc('month1_call', '1개월 콜', text(ONB, '1개월 콜'), 'stage'), fc('stats', '신규생 기록', route('/newcomers/stats'), 'face')],
    actions: [
      pre('newcomers.check', '체크 항목 완료', [student(), sel('item', '항목', 'onboardingItem'), date('done', '완료일')], ['setOnboardingCheck'], '신입 체크 미리보기', '체크리스트 항목을 완료로 표시했을 때의 진행을 확인합니다.'),
      req('newcomers.call', '신입 콜 요청', [student(), sel('item', '항목', 'onboardingItem'), date('due', '기한')], ['setOnboardingCheck'], '신입생 콜', '아래 신입생에게 체크리스트 항목에 맞춰 연락해 주세요.'),
    ] },
  { id: 'withdrawals', label: '퇴원관리', group: 'student', viewKind: 'flow', summary: '퇴원·수강종료를 사유와 추이로 봅니다.',
    facets: [fc('list', '퇴원관리', route('/withdrawals')), fc('detail', '퇴원 상세', route('/withdrawals/[studentId]'), 'face')],
    actions: [
      pre('withdrawals.reason', '퇴원 사유 정리', [student(), sel('reason', '대분류', 'withdrawalReason'), memo('세부 메모')], ['updateWithdrawalReason'], '퇴원 사유 미리보기', '퇴원 사유 분류를 확인합니다.'),
      req('withdrawals.reactivate', '재원 복귀 요청', [student(), date('effective', '복귀일'), memo()], ['reactivateStudent'], '재원 복귀', '아래 원생을 재원으로 되돌려 주세요.'),
    ] },
  { id: 'withdrawal-reports', label: '퇴원보고서', group: 'student', viewKind: 'flow', summary: '퇴원보고서를 작성 요청부터 승인·처리까지 단계로 봅니다.',
    facets: [fc('list', '퇴원보고서', route('/withdrawal-reports')), fc('detail', '보고서', route('/withdrawal-reports/[id]'), 'face'), fc('archive', '스프레드시트 기록', route('/withdrawal-reports/archive/[id]'), 'face')],
    actions: [
      req('withdrawal-reports.request', '퇴원보고서 작성 요청', [student(), memo('요청 메모')], ['requestWithdrawalReport'], '퇴원보고서 작성', '담임 선생님은 아래 원생의 퇴원보고서를 작성해 주세요.'),
      pre('withdrawal-reports.decide', '승인·반려 미리보기', [student(), f('decision', '결정', 'select', { required: true, options: [{ value: 'approve', label: '승인' }, { value: 'reject', label: '반려' }], evidence: { file: 'src/features/withdrawal-reports/server/actions.ts', has: ['"approve", "reject"'] } }), memo('의견')], ['changeWithdrawalReport'], '퇴원보고서 결정 미리보기', '보고서 단계가 바뀌는 내용을 확인합니다. 실제 퇴원 처리는 하지 않습니다.'),
      pre('withdrawal-reports.archive', '옛 기록 연결', [student()], ['mapArchive'], '옛 퇴원 기록 연결', '스프레드시트 시절 퇴원 기록을 원생에게 잇는 내용을 확인합니다.'),
    ] },
  // ───────── 운영 ─────────
  { id: 'staff', label: '직원관리', group: 'operation', viewKind: 'records', summary: '직원 명부·계약·이력서·휴가·연차를 봅니다.',
    facets: [fc('list', '직원 목록', route('/staff')), fc('detail', '직원 상세', route('/staff/[id]'), 'face'), fc('leaves', '휴가 관리', route('/staff/leaves'), 'face'), fc('annual', '연차 관리', route('/staff/annual-leave'), 'face'), fc('payroll', '월별 급여', route('/staff/payroll'), 'face')],
    actions: [
      nav('staff.legacy', '직원 화면 열기', null, [], '현재 시안의 직원 화면을 엽니다.', 'staff'),
      req('staff.register', '직원 등록 요청', [f('name', '이름', 'text', { required: true }), f('title', '직급', 'text'), date('hire', '입사일')], ['createStaff', 'changeStaffEmail', 'saveStaffResume', 'ensureStaffIntakeToken'], '직원 등록', '아래 직원의 계정과 이력서를 등록해 주세요.'),
      pre('staff.leave', '휴가 신청 미리보기', [staff('휴가 직원'), sel('type', '휴가 유형', 'leaveType'), date('from', '시작일'), date('to', '종료일')], ['requestLeave', 'addLeaveAdjustment'], '휴가 신청 미리보기', '휴가 기간과 유형을 확인합니다.'),
      req('staff.contract', '계약 갱신 요청', [staff('대상 직원'), date('end', '계약 만료일'), memo()], ['updateStaffContract'], '계약 갱신', '아래 직원의 계약 갱신을 준비해 주세요.'),
      req('staff.task', '직원 업무 요청', [staff('담당 직원'), f('title', '업무', 'text', { required: true }), date('due', '기한')], ['createStaffTask'], '직원 업무', '아래 업무를 진행하고 완료되면 알려 주세요.'),
      req('staff.schedule', '근무 설정 변경 요청', [staff('대상 직원'), f('days', '근무 요일', 'multiselect', { required: true, ...opt('weekday') }), f('time', '근무 시간', 'text'), memo()],
        ['work-schedule'], '근무 설정 변경', '아래 직원의 주간 근무 일정을 바꿔 주세요.'),
    ] },
  { id: 'payroll', label: '급여·명세서', group: 'operation', viewKind: 'report', summary: '급여명세서와 강사 정산을 봅니다.',
    facets: [fc('payslip', '급여명세서', route('/payroll/[teacherId]/payslip')), fc('teacher', '강사 정산', route('/staff/[id]/payroll'), 'face'), fc('month', '월별 급여', route('/staff/payroll'), 'face')],
    actions: [
      pre('payroll.payslip', '명세서 미리보기', [staff('선생님'), month()], ['issuePayslip', 'autoComputePayroll'], '급여명세서 미리보기', '출석부 실급여 합계 기준 명세서 구성을 확인합니다. 발행하지 않습니다.'),
      pre('payroll.class-salary', '반별 배분율', [cls(), f('rate', '배분율(%)', 'number', { required: true, min: 0, max: 100 })], ['saveClassSalary'], '반별 급여 배분 미리보기', '반의 급여 배분율(0~100%)을 확인합니다.'),
    ] },
  { id: 'billing', label: '수납관리', group: 'operation', viewKind: 'report', summary: '청구·수납과 교재·지출·회차 확정·환불을 봅니다.',
    facets: [fc('billing', '수납', text(BILL, '"수납"')), fc('textbooks', '교재', text(BILL, '"교재"')), fc('expenses', '지출', text(BILL, '"지출"')), fc('calculator', '수강료 계산기', text(BILL, '수강료 계산기')),
      fc('sessions', '회차 확정', text(BILL, '회차 확정')), fc('refunds', '환불 요청서', text(BILL, '환불 요청서')), fc('payroll', '강사 정산', text(BILL, '강사 정산')), fc('stats', '수납 통계', route('/billing/stats'), 'face'),
      fc('prices', '수강료 단가', text(CALC, '수강료 단가'), 'filter'), fc('catalog', '교재 단가표', text(TBF, '교재 단가표'), 'filter'), fc('holidays', '공휴일', text(CALC, '공휴일'), 'filter'), fc('quotes', '저장된 청구서', text(CALC, '저장된 청구서'), 'filter')],
    actions: [
      nav('billing.legacy', '수납 화면 열기', null, [], '현재 시안의 수납·재무 화면을 엽니다.', 'finance'),
      req('billing.remind', '수납 안내 요청', [student(), month(), f('amount', '남은 금액', 'money'), memo()], ['createInvoice'], '수납 확인·안내', '아래 원생의 남은 수납을 확인하고, 필요하면 보호자에게 안내한 뒤 결과를 남겨 주세요.'),
      pre('billing.quote', '수강료 계산기', [f('name', '원생 이름', 'text', { required: true }), f('sessions', '회차', 'number', { required: true }), f('unit', '회당 단가', 'money', { required: true }), f('discount', '할인', 'money')], ['saveTuitionQuote', 'createTuitionItem'], '수강료 견적', '회차 × 단가 − 할인으로 견적을 계산합니다. 저장하지 않습니다.', '계산 결과 미리보기'),
      pre('billing.expense', '지출 결의 미리보기', [sel('category', '분류', 'expenseCategory'), f('title', '내용', 'text', { required: true }), f('amount', '금액', 'money', { required: true }), date('spent', '지출일')], ['createExpense'], '지출 결의 미리보기', '지출 결의 내용을 확인합니다.'),
      pre('billing.textbook', '교재 주문 미리보기', [student(), f('book', '교재', 'text', { required: true }), f('price', '가격', 'money')], ['createTextbookOrder'], '교재 주문 미리보기', '교재 주문 줄을 확인합니다.'),
      pre('billing.session', '회차 확정 미리보기', [student(), cls(), month(), f('sessions', '확정 시수', 'number', { required: true, min: 0, max: 99 }), f('unit', '회당 단가', 'money')], ['confirmSessionTerm', 'saveSeatShareAdjust'], '회차 확정 미리보기', '확정 시수 × 단가를 확인합니다.'),
      pre('billing.refund', '환불 요청서 미리보기', [student(), f('amount', '환불 금액', 'money', { required: true }), memo('사유', true)], ['saveRefundRequest'], '환불 요청서 미리보기', '환불 요청서 내용을 확인합니다. 계좌 정보는 이 시안에 적지 않습니다.'),
    ] },
  { id: 'textbook-requests', label: '교재 요청', group: 'operation', viewKind: 'flow', summary: '선생님이 요청한 교재가 주문·전달·납부되는 흐름을 봅니다.',
    facets: [fc('list', '교재 요청', route('/textbook-requests')), fc('print', '교재 요청서', route('/textbook/[id]/print'), 'face')],
    actions: [
      nav('textbook-requests.legacy', '교재 흐름 보기', null, [], '현재 시안의 교재·재고·서식 화면을 엽니다.', 'resources'),
      req('textbook-requests.order', '교재 주문 확인 요청', [student(), f('book', '교재', 'text', { required: true })], ['requestTextbook', 'registerTextbookAttachment'], '교재 주문·전달 확인', '요청된 교재의 주문과 전달 상황을 확인해 주세요.'),
      pre('textbook-requests.notice', '교재 안내 공지 미리보기', [student(), f('body', '안내 문구', 'textarea', { required: true })], ['prepareTextbookNotice'], '교재 안내 공지', '학부모에게 보낼 교재 안내 문구를 확인합니다.'),
    ] },
  { id: 'expense-requests', label: '지출결의서', group: 'operation', viewKind: 'records', summary: '선생님이 제출한 지출결의서를 봅니다.',
    facets: [fc('list', '지출결의서', route('/expense-requests')), fc('detail', '지출결의서 상세', route('/expense-requests/[id]'), 'face')],
    actions: [
      req('expense-requests.review', '지출결의서 확인 요청', [staff('작성 선생님'), f('amount', '금액', 'money'), memo()], ['deleteExpense'], '지출결의서 확인', '제출된 지출결의서를 검토해 결재로 넘기거나 보완을 요청해 주세요.'),
    ] },
  { id: 'shuttle', label: '셔틀', group: 'operation', viewKind: 'timeline', summary: '노선 편성과 오늘 등하원·운행 현황을 봅니다.',
    facets: [fc('route', '노선 편성', text(NAV, '노선 편성')), fc('week', '주간 시간표', text(NAV, '주간 시간표')), fc('today', '오늘 등하원', text(NAV, '오늘 등하원')), fc('parent-rides', '학부모 등하원', text(NAV, '"학부모 등하원"')),
      fc('live', '운행 현황', text(NAV, '운행 현황')), fc('track', '실시간 위치', text(NAV, '실시간 위치')), fc('parents', '학부모 관리 현황', route('/shuttle/parents'), 'face')],
    actions: [
      nav('shuttle.legacy', '셔틀 화면 열기', null, [], '현재 시안의 차량·안전 화면을 엽니다.', 'shuttle'),
      pre('shuttle.run', '회차 편성 미리보기', [sel('season', '시즌', 'shuttleSeason'), sel('direction', '방향', 'shuttleDirection'), f('vehicle', '차량', 'text', { required: true })], ['createRun', 'createStop', 'saveVehicle'], '회차 편성 미리보기', '차량·시즌·방향별 회차를 확인합니다.'),
      pre('shuttle.rider', '학생 배정', [student(), sel('direction', '방향', 'shuttleDirection'), f('weekdays', '요일', 'multiselect', { required: true, optionsFrom: 'weekday' })], ['assignRider'], '셔틀 배정 미리보기', '정류장에 학생을 요일별로 배정한 모습을 봅니다.'),
      pre('shuttle.boarding', '탑승 기록 미리보기', [student(), date(), sel('status', '탑승', 'boardingStatus')], ['recordBoarding', 'staffChangeRideStop'], '탑승 기록 미리보기', '운행 시작 뒤 탑승 기록을 남기는 내용을 확인합니다.'),
      req('shuttle.parent-account', '학부모 계정 발급 요청', [student(), memo()], ['createParentAccount'], '학부모 계정 발급', '아래 원생의 학부모 계정을 발급해 주세요.'),
    ] },
  { id: 'inventory', label: '재고관리', group: 'operation', viewKind: 'records', summary: '전자기기 자산·대여·실사·소모품·업체를 봅니다.',
    facets: [fc('assets', '자산', text(INV, '"자산"')), fc('loans', '대여', text(INV, '"대여"')), fc('audits', '실사', text(INV, '"실사"')), fc('supplies', '소모품', text(INV, '"소모품"')), fc('vendors', '업체리스트', text(INV, '업체리스트')), fc('qr', '자산 QR 라벨', route('/inventory/qr/print'), 'face')],
    actions: [
      pre('inventory.asset', '자산 등록 미리보기', [f('code', '자산ID', 'text', { required: true }), f('model', '모델', 'text'), sel('status', '상태', 'assetStatus')], ['createAsset', 'importInventoryExcel'], '자산 등록 미리보기', '자산 대장 줄을 확인합니다(대여중은 대여 시작으로만).'),
      pre('inventory.loan', '대여 시작', [f('asset', '자산ID', 'text', { required: true }), f('borrower', '대여자', 'text', { required: true }), date('due', '반납 예정일', false)], ['startLoan'], '대여 미리보기', '자산 대여 기록을 확인합니다.'),
      pre('inventory.audit', '실사 기록', [f('asset', '자산ID', 'text', { required: true }), sel('result', '실사 결과', 'auditResult'), date('audited', '실사일')], ['recordAudit'], '실사 미리보기', '실사 결과를 확인합니다.'),
      req('inventory.supply', '소모품 보충 요청', [f('item', '품목', 'text', { required: true }), f('qty', '수량', 'number')], ['createSupply', 'createVendor'], '소모품 보충', '아래 소모품을 보충하고 업체 연락처를 확인해 주세요.'),
    ] },
  { id: 'meetings', label: '회의록', group: 'operation', viewKind: 'timeline', summary: '회의록과 녹음 분석 결과를 봅니다.',
    facets: [fc('list', '회의록', route('/meetings')), fc('new', '새 회의록', route('/meetings/new'), 'face'), fc('detail', '회의록 상세', route('/meetings/[id]'), 'face')],
    actions: [
      pre('meetings.text', '회의록 작성 미리보기', [f('title', '제목', 'text', { required: true }), date('held', '회의일'), f('content', '메모', 'textarea', { required: true })], ['createTextMeeting', 'updateMeetingNotepad'], '회의록 미리보기', '텍스트 회의록을 확인합니다.'),
      req('meetings.followup', '결정 사항 실행 요청', [f('title', '결정 사항', 'text', { required: true }), staff('담당'), date('due', '기한')], ['regenerateMeetingAnalysis'], '회의 결정 사항 실행', '회의에서 정한 아래 사항을 진행하고 결과를 알려 주세요.'),
      req('meetings.cleanup', '회의록 정리 요청', [f('title', '회의록 제목', 'text', { required: true }), memo('정리 내용', true)], ['deleteMeeting'], '회의록 정리', '아래 회의록을 정리(삭제·보관)해 주세요.'),
    ] },
  { id: 'approvals', label: '전자결재', group: 'operation', viewKind: 'flow', summary: '결재함을 대기·예정·진행·완료로 봅니다.',
    facets: [fc('all', '전체', text(APR, '"전체"'), 'box'), fc('pending', '결재 대기', text(APR, '결재 대기'), 'box'), fc('upcoming', '결재 예정', text(APR, '결재 예정'), 'box'), fc('progress', '진행', text(APR, '"진행"'), 'box'),
      fc('done', '완료', text(APR, '"완료"'), 'box'), fc('rejected', '반려·회수', text(APR, '반려·회수'), 'box'), fc('cc', '참조', text(APR, '"참조"'), 'box'), fc('academy', '학원 전체 진행', text(APR, '학원 전체 진행'), 'box')],
    actions: [
      nav('approvals.legacy', '결재 화면 열기', null, [], '현재 시안의 업무·결재 화면을 엽니다.', 'approvals'),
      pre('approvals.draft', '기안 미리보기', [sel('form', '양식', 'approvalForm'), f('title', '제목', 'text', { required: true }), f('body', '내용', 'textarea', { required: true })], ['submitLeaveDraft', 'saveLineTemplate'], '기안 미리보기', '결재 문서와 결재선을 확인합니다.'),
      pre('approvals.decide', '결재 결정 미리보기', [f('doc', '문서 제목', 'text', { required: true }), f('decision', '결정', 'select', { required: true, options: [{ value: 'approved', label: '승인' }, { value: 'rejected', label: '반려' }, { value: 'final', label: '전결' }], evidence: { file: 'src/features/approvals/server/actions.ts', has: ['decision !== "approved"', 'decision !== "rejected"', 'decision !== "final"'] } }), memo('의견')], ['decideDocument', 'addApprovalComment'], '결재 결정 미리보기', '결정 내용을 확인합니다. 실제 결재 상태는 바뀌지 않습니다.'),
    ] },
  { id: 'documents', label: '데이터베이스', group: 'operation', viewKind: 'records', summary: '학원 서식·문서 저장소를 폴더로 봅니다.',
    facets: [fc('folders', '데이터베이스', route('/documents')), fc('detail', '문서 상세', route('/documents/[id]'), 'face'), fc('preview', '문서 미리보기', route('/documents/[id]/preview'), 'face')],
    actions: [
      nav('documents.legacy', '문서 보기', null, [], '현재 시안의 교재·재고·서식 화면에서 문서를 봅니다.', 'resources'),
      req('documents.upload', '서식 등록 요청', [f('title', '문서 이름', 'text', { required: true }), f('folder', '폴더', 'text')], ['registerUploadedDocument', 'createDocumentCategory'], '서식 등록', '아래 서식을 데이터베이스에 등록해 주세요.'),
      req('documents.tidy', '문서 정리 요청', [f('title', '문서 이름', 'text', { required: true }), f('folder', '옮길 폴더', 'text')], ['updateDocument', 'moveDocumentFile'], '문서 정리', '아래 문서를 정리(수정·이동)해 주세요.'),
    ] },
  // ───────── 지원 ─────────
  { id: 'support', label: '고객센터', group: 'support', viewKind: 'records', summary: '공지사항과 개선요청 처리 상태를 봅니다.',
    facets: [fc('notices', '공지사항', text(SUP, '공지사항')), fc('requests', '개선요청', text(SUP, '개선요청'))],
    actions: [
      pre('support.request', '개선요청 초안', [f('title', '제목', 'text', { required: true }), f('body', '내용', 'textarea', { required: true })], ['createSupportRequest'], '개선요청 미리보기', '보낼 개선요청을 확인합니다. 실제로 접수하지 않습니다.'),
      pre('support.status', '처리 상태 보기', [sel('status', '처리 상태', 'supportStatus')], ['answerSupportRequest'], '개선요청 처리 상태', '접수·내용확인·처리중·완료 단계를 봅니다.'),
    ] },
  { id: 'owner-settings', label: '학원 설정', group: 'support', viewKind: 'settings', summary: '학원 설정 18개 면(프로필·운영·과목·청구·권한·메뉴·연동 등)을 봅니다.',
    facets: [fc('profile', '프로필·브랜드', text(OWN, '프로필·브랜드'), 'face'), fc('operations', '운영 체계', text(OWN, '운영 체계'), 'face'), fc('subjects', '과목 운영', text(OWN, '과목 운영'), 'face'), fc('makeups', '보강 운영', text(OWN, '보강 운영'), 'face'),
      fc('evaluation', '강사평가', text(OWN, '"강사평가"'), 'face'), fc('contribution', '원생 기여도', text(OWN, '"원생 기여도"'), 'face'), fc('billing', '수납·청구', text(OWN, '수납·청구'), 'face'), fc('notifications', '알림·약관', text(OWN, '알림·약관'), 'face'),
      fc('consultations', '상담 양식', text(OWN, '상담 양식'), 'face'), fc('permissions', '역할·권한', text(OWN, '역할·권한'), 'face'), fc('navigation', '탭 및 메뉴 구성', text(OWN, '탭 및 메뉴 구성'), 'face'), fc('modules', '기능', text(OWN, '"기능"'), 'face'),
      fc('dashboard', '대시보드 관리', text(OWN, '대시보드 관리'), 'face'), fc('popups', '팝업 공지', text(OWN, '팝업 공지'), 'face'), fc('data', '데이터 정리', text(OWN, '데이터 정리'), 'face'), fc('import', '데이터 가져오기', text(OWN, '데이터 가져오기'), 'face'),
      fc('audit', '감사로그', text(OWN, '감사로그'), 'face'), fc('sheets', '연동', text(OWN, '"연동"'), 'face')],
    actions: [
      nav('owner-settings.legacy', '설정 화면 열기', null, [], '현재 시안의 학원 설정 화면을 엽니다.', 'settings'),
      pre('owner-settings.face', '설정 면 미리보기', [sel('face', '설정 면', 'ownerFace')], ['saveOwnerSection', 'saveSettingRoles'], '학원 설정 면', '고른 설정 면의 항목을 봅니다. 저장하지 않습니다.'),
      pre('owner-settings.classroom', '강의실 추가', [f('name', '강의실 이름', 'text', { required: true }), f('capacity', '정원', 'number')], ['createClassroom'], '강의실 미리보기', '강의실 목록에 추가될 내용을 확인합니다.'),
      req('owner-settings.subject', '과목 정리 요청', [f('from', '정리할 과목', 'text', { required: true }), f('to', '옮겨 갈 과목', 'text', { required: true })], ['absorbSubject', 'savePeriodsForSubject'], '과목 정리', '아래 과목을 다른 과목으로 흡수하고 세션 기간을 맞춰 주세요.'),
      pre('owner-settings.popup', '팝업 공지 미리보기', [f('title', '제목', 'text', { required: true }), f('body', '내용', 'textarea', { required: true })], ['createNoticePopup'], '팝업 공지 미리보기', '직원 화면에 뜰 팝업 공지를 확인합니다.'),
      req('owner-settings.data', '데이터 정리 요청', [student(), memo('정리 내용', true)], ['mergeStudents'], '데이터 정리', '아래 원생의 데이터를 정리해 주세요(중복 원생 병합 등).'),
    ] },
  { id: 'help', label: '도움말', group: 'support', viewKind: 'records', summary: '화면 설명서와 질문 게시판을 봅니다.',
    facets: [fc('manuals', '도움말', route('/help')), fc('icons', '아이콘 시스템', route('/help/icons'), 'face'), fc('posts', '도움말 질문', route('/help/posts/[id]'), 'face')],
    actions: [
      pre('help.ask', '질문 초안', [f('title', '제목', 'text', { required: true }), f('body', '내용', 'textarea', { required: true })], ['createHelpPost'], '도움말 질문 미리보기', '질문 게시판에 올릴 내용을 확인합니다.'),
    ] },
  // ───────── 연동·자동화 ─────────
  { id: 'slack', label: '슬랙 연동', group: 'integration', viewKind: 'settings', summary: '슬랙으로 무엇을 어디로 언제 보낼지 규칙을 봅니다.',
    facets: [fc('rules', '규칙', text(SLK, 'ACTIVITY_CATEGORIES')), fc('settings', '슬랙 연결', text(INTEG, '"슬랙"'), 'face')],
    actions: [
      nav('slack.automation', '자동화 설정', null, ['saveSlackSchedule'], '현재 시안의 자동화 화면을 엽니다.', 'automation'),
      pre('slack.rule', '규칙 미리보기', [f('categories', '활동 범주', 'multiselect', { required: true, optionsFrom: 'slackCategory' }), f('target', '보낼 곳', 'text', { required: true })], ['saveSlackRule'], '슬랙 규칙 미리보기', '고른 범주의 알림이 어디로 가는지 확인합니다. 실제로 보내지 않습니다.'),
      req('slack.connect', '슬랙 연결 요청', [memo('연결할 워크스페이스·사람')], ['saveSlackToken', 'linkSlackByEmail'], '슬랙 연결', '학원 슬랙 워크스페이스를 연결하고 직원 계정을 이어 주세요.'),
    ] },
  { id: 'integrations', label: '외부 연동', group: 'integration', viewKind: 'settings', summary: 'makeedu·구글 시트·숙제영상 드라이브·연동 PC·오늘 수학 연결을 봅니다.',
    facets: [fc('makeedu', 'makeedu 동기화', text(INTEG, 'makeedu 동기화'), 'face'), fc('sheets', '구글 시트', text(INTEG, '구글 시트'), 'face'), fc('video', '숙제영상 드라이브', text(INTEG, '숙제영상 드라이브'), 'face'), fc('agent', '연동 PC', text(INTEG, '연동 PC'), 'face'), fc('todaysMath', '오늘 수학', text(INTEG, '"오늘 수학"'), 'face')],
    actions: [
      pre('integrations.status', '연동 상태 보기', [f('target', '연동', 'select', { required: true, optionsFrom: 'integrationSub', only: ['makeedu', 'sheets', 'video', 'agent', 'todaysMath'] })], ['setMakeeduSyncEnabled', 'setSheetsExportEnabled', 'loadTodaysMathMenus'], '연동 상태', '연동의 켜짐 여부와 최근 이력을 봅니다. 이 시안은 외부 연동을 실행하지 않습니다.'),
      req('integrations.agent', '연동 PC 점검 요청', [memo('증상', true)], ['issueAgentCode'], '연동 PC 점검', '연동 PC(AywaSync)의 상태를 확인하고 필요하면 다시 연결해 주세요.'),
      req('integrations.ijw', '인재원 연결 정리 요청', [memo()], ['linkIjwUniqueMatches'], '인재원 학생 한 번에 연결', '인재원 학생 가운데 이름이 양쪽 모두 하나뿐인 학생을 확인하고 원생과 연결해 주세요.'),
    ] },
  // ───────── 역할별 화면 ─────────
  { id: 'teacher-workspace', label: '강사 화면', group: 'roles', viewKind: 'records', summary: '선생님이 보는 내 메뉴·내 정보 화면을 미리 봅니다.',
    facets: [fc('me', '내 정보', route('/me')), fc('onescreen', '선생님 수업보고서', route('/onescreen'), 'face')],
    actions: [
      pre('teacher-workspace.preview', '강사 화면 미리보기', [staff('선생님'), f('lang', '화면 언어', 'select', { required: true, options: [{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }], evidence: { file: 'src/features/teacher-view/i18n.ts', has: ['SHEET_LANGS = ["ko", "en"]'] } })], ['setMyTeacherLang', 'switchToTeacherView'], '강사 화면 미리보기', '선생님 내 메뉴와 언어 설정을 봅니다.'),
      req('teacher-workspace.account', '계정 정보 정리 요청', [staff('선생님'), memo('바꿀 내용', true)], ['updateMyEmail'], '계정 정보 정리', '선생님 계정의 이메일·보고서 이름을 정리해 주세요.'),
    ] },
  { id: 'parent-portal', label: '학부모 화면', group: 'roles', viewKind: 'timeline', summary: '학부모가 보는 셔틀·수업 시간표 화면을 미리 봅니다.',
    facets: [fc('live', '실시간 차량', text(PAR, '실시간 차량')), fc('rides', '등하원 시간 변경·확인', text(PAR, '등하원 시간 변경·확인')), fc('classes', '수업 시간표', text(PAR, '수업 시간표'))],
    actions: [
      pre('parent-portal.change', '학부모 변경 요청 미리보기', [student(), date(), f('kind', '변경', 'select', { required: true, options: [{ value: 'absent', label: '안 탐' }, { value: 'stop', label: '정류장 변경' }], evidence: { file: 'src/features/shuttle/ride-change/server/parent-ride-actions.ts', has: ['absentParentRide', 'changeParentRideStop'] } })], ['absentParentRide', 'changeRegularRide'], '학부모 변경 요청', '학부모가 등하원을 바꿨을 때 직원에게 보이는 내용을 확인합니다.'),
      req('parent-portal.ack', '변경 확인 요청', [student(), memo()], ['ackShuttleHistory'], '학부모 변경 확인', '학부모가 바꾼 등하원 내역을 확인해 주세요.'),
    ] },
  { id: 'student-portal', label: '학생 화면', group: 'roles', viewKind: 'report', summary: '학생이 보는 내 학습 화면을 미리 봅니다(예시 데이터).',
    facets: [fc('summary', '내 학습 현황', route('/my-learning')), fc('report', '데일리 리포트', route('/my-learning/report'), 'face')],
    actions: [
      nav('student-portal.preview', '학생 화면 미리보기', 'summary', ['page-my-learning'], '학생 화면 구성을 봅니다. 실제 학생 데이터가 아닌 예시 데이터로 그립니다.'),
    ] },
  { id: 'public-sites', label: '학원 공개 페이지', group: 'roles', viewKind: 'report', summary: '학부모에게 보이는 학원 공개 페이지를 미리 봅니다.',
    facets: [fc('academy', '학원 공개 페이지', route('/academy'))],
    actions: [
      nav('public-sites.academy', '학원 공개 페이지 미리보기', 'academy', ['page-root'], '학원 브랜드로 그려지는 공개 페이지를 봅니다.'),
    ] },
];
