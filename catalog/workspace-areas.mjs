// 3.0 AX 원장 작업 공간 영역 정의(큐레이션) — build-workspace-catalog.mjs가 브라우저용 window.AxCatalog로 만든다.
// 영역 id = 패밀리 id(백엔드 model.workspaces.families와 같은 키). page = 'workspace-' + id.
// facet.ref = 원문 근거(빌드·검증 전용, 브라우저로 나가지 않는다): { route } 또는 { file, has }(그 파일에 has 문자열이 있어야 함).
// 실제 처리 화면이 있는 영역에는 그 화면으로 가는 단추를, 모든 영역에는 업무 요청 창을 연결한다.
// 역할별 화면 네 곳은 감사용 영역으로 유지하되 원장 메뉴에는 내보내지 않는다.
import { families } from './families.mjs';

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

export const AREA_GROUPS = [
  { id: 'home', label: '홈' }, { id: 'class', label: '수업' }, { id: 'student', label: '원생' }, { id: 'operation', label: '운영' },
  { id: 'support', label: '지원' }, { id: 'integration', label: '연동·자동화' }, { id: 'roles', label: '역할별 화면' },
];

const AREA_DEFINITIONS = [
  // ───────── 홈 ─────────
  { id: 'dashboard', label: '운영실', group: 'home', viewKind: 'report', summary: '역할별로 배치한 지표와 카드로 학원 현황을 봅니다.',
    facets: [fc('kpi', '상단 지표', text(REG, 'enrolledToday')), fc('attendance', '출결·수업', text(REG, '출결·수업'), 'filter'), fc('students', '원생·재원', text(REG, '학생·재원'), 'filter'),
      fc('admissions', '상담·신입', text(REG, '상담·신입'), 'filter'), fc('billing', '수납·지출', text(REG, '수납·지출'), 'filter'), fc('operations', '학원 운영', text(REG, '학원 운영'), 'filter'),
      fc('announcements', '학원 공지', route('/dashboard/announcements'), 'face')],
    actions: [] },
  { id: 'calendar', label: '캘린더', group: 'home', viewKind: 'timeline', summary: '학원 공용 일정과 보강 약속을 날짜로 봅니다.',
    facets: [fc('month', '월', route('/calendar')), fc('tags', '일정 태그', text('src/features/calendar/server/actions.ts', 'saveCalendarTag'), 'filter')],
    actions: [] },
  { id: 'tasks-notifications', label: '업무·알림', group: 'home', viewKind: 'flow', summary: '기록에서 자동으로 생긴 업무와 알림을 처리 상태로 봅니다.',
    facets: [fc('open', '미처리', text(KINDS, '미처리'), 'filter'), fc('late', '기한 초과', text(KINDS, '기한 초과'), 'filter'), fc('closed', '처리 완료', text(KINDS, '처리 완료'), 'filter'), fc('inbox', '알림함', route('/dashboard'), 'face')],
    actions: [] },
  // ───────── 수업 ─────────
  { id: 'onescreen', label: '선생님 수업보고서', group: 'class', viewKind: 'sheet', summary: '선생님이 수업보고서를 쓰고 보내며 출결·공지·보강까지 한곳에서 마감하는 화면을 봅니다.',
    facets: [fc('reports', '수업보고서', route('/onescreen')), fc('video', '영상 제출 현황', route('/onescreen/video-homework'), 'face'), fc('notice', '학부모 공지', text('src/features/onescreen/server/notice-actions.ts', 'sendOnescreenNotice'))],
    actions: [] },
  { id: 'video-homework', label: '영상 숙제', group: 'class', viewKind: 'records', summary: '영상 숙제 제출·배정·확인을 장부로 봅니다.',
    facets: [fc('ledger', '영상 제출 현황', route('/lesson-reports/video-homework')), fc('mine', '선생님별 장부', route('/onescreen/video-homework'), 'face'), fc('site', '숙제 영상 올리기', route('/v'), 'face')],
    actions: [] },
  { id: 'timetable', label: '시간표', group: 'class', viewKind: 'sheet', summary: '과목별 수업 배치와 반 이동·시트 가져오기를 봅니다.',
    facets: [fc('board', '시간표', route('/timetable')), fc('editor', '시간표 편집기', route('/timetable/editor'), 'face'), fc('english-sheet', '영어 시트 반영', route('/timetable/english-sheet'), 'face')],
    actions: [] },
  { id: 'class-sheets', label: '강사 시트', group: 'class', viewKind: 'sheet', summary: '영어·수학 강사 시트의 목표·수업계획·진도를 봅니다.',
    facets: [fc('ecs', '영어', route('/ecs')), fc('ecs-month', '월간', route('/ecs/[classId]/month'), 'face'), fc('goals', '반 계획 보기', route('/ecs/goals'), 'face'), fc('plan-gap', '계획 대비 현황', route('/ecs/plan-gap'), 'face'),
      fc('mcs', '수학', route('/mcs')), fc('mcs-teachers', '선생님별', route('/mcs/teachers'), 'face'), fc('progress-map', '수학 학습 진도맵', route('/mcs/progress-map'), 'face')],
    actions: [] },
  { id: 'attendance', label: '출석부', group: 'class', viewKind: 'sheet', summary: '월별 출석부·오늘 출결·자리 출석부·키오스크를 봅니다.',
    facets: [fc('monthly', '월별 출석부', route('/attendance')), fc('live', '오늘 출결', route('/attendance/live')), fc('quick', '출결 모드', route('/attendance/quick')), fc('date', '날짜별 입력', route('/attendance/[date]/[classId]'), 'face'),
      fc('seat', '랩실·JJ실 출석부', route('/attendance/seat/[seat]'), 'face'), fc('stats', '출결 통계', route('/attendance/stats'), 'face'), fc('units', '시수 마스터', route('/attendance/units-master'), 'face'), fc('kiosk', '키오스크 설정', route('/kiosk-settings'), 'face')],
    actions: [] },
  { id: 'classes', label: '수업목록', group: 'class', viewKind: 'records', summary: '반 목록과 반 상세(수강생·시간표·인수인계)를 봅니다.',
    facets: [fc('list', '수업목록', route('/classes')), fc('detail', '반 상세', route('/classes/[id]'), 'face'), fc('new', '새 반', route('/classes/new'), 'face')],
    actions: [] },
  { id: 'makeups', label: '보강관리', group: 'class', viewKind: 'flow', summary: '보강 사례를 접수부터 인정·종결까지 단계로 봅니다.',
    facets: [fc('cases', '보강관리', route('/makeups')), fc('candidates', '미연결 근거', route('/makeups/candidates'), 'face'), fc('dry-run', '도입 사전 점검', route('/makeups/dry-run'), 'face'), fc('reconciliation', '대사·복구', route('/makeups/reconciliation'), 'face')],
    actions: [] },
  { id: 'textbooks', label: '교재목록', group: 'class', viewKind: 'records', summary: '수업 교재와 차수별 진도·과제, 반 배정을 봅니다.',
    facets: [fc('books', '교재', text(TXB, '"교재"')), fc('plans', '반 배정', text(TXB, '반 배정'))],
    actions: [] },
  { id: 'lesson-reports', label: '수업보고서', group: 'class', viewKind: 'report', summary: '수업보고서 작성률·목록과 ClassNote 발송을 봅니다.',
    facets: [fc('writing', '작성률', text(LRF, '작성률')), fc('list', '목록', text(LRF, '"목록"')), fc('queue', '발송 큐', text(LRF, '발송 큐'), 'tab'), fc('boards', '반 구성', text(LRF, '반 구성')),
      fc('notice', '반 공지', text(LRF, '반 공지')), fc('compose', '직접 발송', text(LRF, '직접 발송')), fc('recall', '회수', text(LRF, '"회수"')), fc('parent_replies', '학부모 글·답글', text(LRF, '학부모 글·답글')),
      fc('report', '보고서 설정', text(LRF, '보고서 설정')), fc('ai_ment', 'AI 멘트', text(LRF, 'AI 멘트')), fc('stats', '보고서 통계', route('/lesson-reports/stats'), 'face')],
    actions: [] },
  { id: 'class-review', label: '직원 평가', group: 'class', viewKind: 'report', summary: '수업 참관 평가와 직원 포트폴리오를 봅니다.',
    facets: [fc('review', '직원 평가', text(CRF, '"직원 평가"')), fc('portfolio', '직원 포트폴리오', text(CRF, '직원 포트폴리오')), fc('board', '직원 평가 종합', route('/class-review/board'), 'face'), fc('template', '문항 편집', route('/class-review/template'), 'face')],
    actions: [] },
  // ───────── 원생 ─────────
  { id: 'students', label: '원생목록', group: 'student', viewKind: 'records', summary: '원생 명단과 원생 상세(수업·성적·출결·상담·수납 등)를 봅니다.',
    facets: [fc('list', '원생목록', route('/students')), fc('stats', '원생 통계', route('/students/stats'), 'face'),
      fc('overview', '개요', text(STD, '"개요"')), fc('classes', '수업', text(STD, '"수업"')), fc('grades', '성적', text(STD, '"성적"')), fc('srs', 'SRS', text(STD, '"SRS"')), fc('todays-math', '오늘 수학', text(STD, '"오늘 수학"')),
      fc('progress', '진도', text(STD, '"진도"')), fc('homework-videos', '숙제 영상', text(STD, '"숙제 영상"')), fc('attendance', '출결', text(STD, '"출결"')), fc('consultations', '상담', text(STD, '"상담"')),
      fc('memos', '특이사항', text(STD, '"특이사항"')), fc('billing', '수납', text(STD, '"수납"')), fc('contribution', '기여도', text(STD, '"기여도"')), fc('timeline', '타임라인', text(STD, '"타임라인"'))],
    actions: [] },
  { id: 'student-contribution', label: '원생 기여도', group: 'student', viewKind: 'records', summary: '원생별 운영 기여·학습 참여·연결 기록을 봅니다.',
    facets: [fc('list', '원생 기여도', route('/student-contribution')), fc('ontology', '원생 기록의 연결', route('/student-contribution/ontology'), 'face'), fc('referrals', '지난 소개 확인', route('/student-contribution/referrals'), 'face'), fc('settings', '기여도 배점 설정', route('/student-contribution/settings'), 'face')],
    actions: [] },
  { id: 'exams', label: '성적관리', group: 'student', viewKind: 'sheet', summary: '학기별 시험 성적을 입력 격자와 확인 뷰로 봅니다.',
    facets: [fc('unified', '통합 성적관리', route('/exams')), fc('input', '성적 입력', route('/exams/input'), 'face'), fc('view', '성적 확인', route('/exams/view'), 'face'), fc('jj', 'JJ실 시험 결과', route('/exams/jj/[deckId]'), 'face')],
    actions: [] },
  { id: 'consultations', label: '원생상담', group: 'student', viewKind: 'records', summary: '재원생 상담 기록과 후속조치를 봅니다.',
    facets: [fc('list', '원생상담', route('/consultations')), fc('stats', '상담 통계', route('/consultations/stats'), 'face'), fc('new', '새 원생상담', route('/consultations/new'), 'face')],
    actions: [] },
  { id: 'enrollment', label: '신규 콜&상담', group: 'student', viewKind: 'flow', summary: '신규 콜&상담을 접수부터 등록까지 단계로 봅니다.',
    facets: [fc('pending', '대기', text(OUTC, '"대기"'), 'stage'), fc('scheduled', '예약', text(OUTC, '"예약"'), 'stage'), fc('consulted', '상담완료', text(OUTC, '"상담완료"'), 'stage'), fc('enrolled', '재원생 등록 완료', text(OUTC, '재원생 등록 완료'), 'stage'),
      fc('declined', '거절', text(OUTC, '"거절"'), 'stage'), fc('no_show', '노쇼', text(OUTC, '"노쇼"'), 'stage'), fc('intake', 'QR 상담 접수', route('/intake/[token]'), 'face')],
    actions: [] },
  { id: 'retention', label: '이탈 방어', group: 'student', viewKind: 'flow', summary: '이탈 위험 원생과 재등록 캠페인을 봅니다.',
    facets: [fc('brief', '브리핑', text(RET, '"브리핑"')), fc('board', '리텐션 보드', text(RET, '리텐션 보드')), fc('messages', '학부모 메시지', text(RET, '학부모 메시지')), fc('campaign', '재등록 캠페인', text(RET, '재등록 캠페인'))],
    actions: [] },
  { id: 'newcomers', label: '신규생 관리', group: 'student', viewKind: 'flow', summary: '신입 등록 후 90일 체크리스트를 단계로 봅니다.',
    facets: [fc('pre_call', '수업 전 사전 콜', text(ONB, '수업 전 사전 콜'), 'stage'), fc('first_class_guide', '첫 수업 안내', text(ONB, '첫 수업 안내'), 'stage'), fc('ojt', 'OJT', text(ONB, '"OJT"'), 'stage'),
      fc('after_first_call', '첫 수업 후 콜', text(ONB, '첫 수업 후 콜'), 'stage'), fc('month1_call', '1개월 콜', text(ONB, '1개월 콜'), 'stage'), fc('stats', '신규생 기록', route('/newcomers/stats'), 'face')],
    actions: [] },
  { id: 'withdrawals', label: '퇴원관리', group: 'student', viewKind: 'flow', summary: '퇴원·수강종료를 사유와 추이로 봅니다.',
    facets: [fc('list', '퇴원관리', route('/withdrawals')), fc('detail', '퇴원 상세', route('/withdrawals/[studentId]'), 'face')],
    actions: [] },
  { id: 'withdrawal-reports', label: '퇴원보고서', group: 'student', viewKind: 'flow', summary: '퇴원보고서를 작성 요청부터 승인·처리까지 단계로 봅니다.',
    facets: [fc('list', '퇴원보고서', route('/withdrawal-reports')), fc('detail', '보고서', route('/withdrawal-reports/[id]'), 'face'), fc('archive', '스프레드시트 기록', route('/withdrawal-reports/archive/[id]'), 'face')],
    actions: [] },
  // ───────── 운영 ─────────
  { id: 'staff', label: '직원관리', group: 'operation', viewKind: 'records', summary: '직원 명부·계약·이력서·휴가·연차를 봅니다.',
    facets: [fc('list', '직원 목록', route('/staff')), fc('detail', '직원 상세', route('/staff/[id]'), 'face'), fc('leaves', '휴가 관리', route('/staff/leaves'), 'face'), fc('annual', '연차 관리', route('/staff/annual-leave'), 'face'), fc('payroll', '월별 급여', route('/staff/payroll'), 'face')],
    actions: [] },
  { id: 'payroll', label: '급여·명세서', group: 'operation', viewKind: 'report', summary: '급여명세서와 강사 정산을 봅니다.',
    facets: [fc('payslip', '급여명세서', route('/payroll/[teacherId]/payslip')), fc('teacher', '강사 정산', route('/staff/[id]/payroll'), 'face'), fc('month', '월별 급여', route('/staff/payroll'), 'face')],
    actions: [] },
  { id: 'billing', label: '수납관리', group: 'operation', viewKind: 'report', summary: '청구·수납과 교재·지출·회차 확정·환불을 봅니다.',
    facets: [fc('billing', '수납', text(BILL, '"수납"')), fc('textbooks', '교재', text(BILL, '"교재"')), fc('expenses', '지출', text(BILL, '"지출"')), fc('calculator', '수강료 계산기', text(BILL, '수강료 계산기')),
      fc('sessions', '회차 확정', text(BILL, '회차 확정')), fc('refunds', '환불 요청서', text(BILL, '환불 요청서')), fc('payroll', '강사 정산', text(BILL, '강사 정산')), fc('stats', '수납 통계', route('/billing/stats'), 'face'),
      fc('prices', '수강료 단가', text(CALC, '수강료 단가'), 'filter'), fc('catalog', '교재 단가표', text(TBF, '교재 단가표'), 'filter'), fc('holidays', '공휴일', text(CALC, '공휴일'), 'filter'), fc('quotes', '저장된 청구서', text(CALC, '저장된 청구서'), 'filter')],
    actions: [] },
  { id: 'textbook-requests', label: '교재 요청', group: 'operation', viewKind: 'flow', summary: '선생님이 요청한 교재가 주문·전달·납부되는 흐름을 봅니다.',
    facets: [fc('list', '교재 요청', route('/textbook-requests')), fc('print', '교재 요청서', route('/textbook/[id]/print'), 'face')],
    actions: [] },
  { id: 'expense-requests', label: '지출결의서', group: 'operation', viewKind: 'records', summary: '선생님이 제출한 지출결의서를 봅니다.',
    facets: [fc('list', '지출결의서', route('/expense-requests')), fc('detail', '지출결의서 상세', route('/expense-requests/[id]'), 'face')],
    actions: [] },
  { id: 'shuttle', label: '셔틀', group: 'operation', viewKind: 'timeline', summary: '노선 편성과 오늘 등하원·운행 현황을 봅니다.',
    facets: [fc('route', '노선 편성', text(NAV, '노선 편성')), fc('week', '주간 시간표', text(NAV, '주간 시간표')), fc('today', '오늘 등하원', text(NAV, '오늘 등하원')), fc('parent-rides', '학부모 등하원', text(NAV, '"학부모 등하원"')),
      fc('live', '운행 현황', text(NAV, '운행 현황')), fc('track', '실시간 위치', text(NAV, '실시간 위치')), fc('parents', '학부모 관리 현황', route('/shuttle/parents'), 'face')],
    actions: [] },
  { id: 'inventory', label: '재고관리', group: 'operation', viewKind: 'records', summary: '전자기기 자산·대여·실사·소모품·업체를 봅니다.',
    facets: [fc('assets', '자산', text(INV, '"자산"')), fc('loans', '대여', text(INV, '"대여"')), fc('audits', '실사', text(INV, '"실사"')), fc('supplies', '소모품', text(INV, '"소모품"')), fc('vendors', '업체리스트', text(INV, '업체리스트')), fc('qr', '자산 QR 라벨', route('/inventory/qr/print'), 'face')],
    actions: [] },
  { id: 'meetings', label: '회의록', group: 'operation', viewKind: 'timeline', summary: '회의록과 녹음 분석 결과를 봅니다.',
    facets: [fc('list', '회의록', route('/meetings')), fc('new', '새 회의록', route('/meetings/new'), 'face'), fc('detail', '회의록 상세', route('/meetings/[id]'), 'face')],
    actions: [] },
  { id: 'approvals', label: '전자결재', group: 'operation', viewKind: 'flow', summary: '결재함을 대기·예정·진행·완료로 봅니다.',
    facets: [fc('all', '전체', text(APR, '"전체"'), 'box'), fc('pending', '결재 대기', text(APR, '결재 대기'), 'box'), fc('upcoming', '결재 예정', text(APR, '결재 예정'), 'box'), fc('progress', '진행', text(APR, '"진행"'), 'box'),
      fc('done', '완료', text(APR, '"완료"'), 'box'), fc('rejected', '반려·회수', text(APR, '반려·회수'), 'box'), fc('cc', '참조', text(APR, '"참조"'), 'box'), fc('academy', '학원 전체 진행', text(APR, '학원 전체 진행'), 'box')],
    actions: [] },
  { id: 'documents', label: '데이터베이스', group: 'operation', viewKind: 'records', summary: '학원 서식·문서 저장소를 폴더로 봅니다.',
    facets: [fc('folders', '데이터베이스', route('/documents')), fc('detail', '문서 상세', route('/documents/[id]'), 'face'), fc('preview', '문서 보기', route('/documents/[id]/preview'), 'face')],
    actions: [] },
  // ───────── 지원 ─────────
  { id: 'support', label: '고객센터', group: 'support', viewKind: 'records', summary: '공지사항과 개선요청 처리 상태를 봅니다.',
    facets: [fc('notices', '공지사항', text(SUP, '공지사항')), fc('requests', '개선요청', text(SUP, '개선요청'))],
    actions: [] },
  { id: 'owner-settings', label: '학원 설정', group: 'support', viewKind: 'settings', summary: '학원 설정 18개 면(프로필·운영·과목·청구·권한·메뉴·연동 등)을 봅니다.',
    facets: [fc('profile', '프로필·브랜드', text(OWN, '프로필·브랜드'), 'face'), fc('operations', '운영 체계', text(OWN, '운영 체계'), 'face'), fc('subjects', '과목 운영', text(OWN, '과목 운영'), 'face'), fc('makeups', '보강 운영', text(OWN, '보강 운영'), 'face'),
      fc('evaluation', '강사평가', text(OWN, '"강사평가"'), 'face'), fc('contribution', '원생 기여도', text(OWN, '"원생 기여도"'), 'face'), fc('billing', '수납·청구', text(OWN, '수납·청구'), 'face'), fc('notifications', '알림·약관', text(OWN, '알림·약관'), 'face'),
      fc('consultations', '상담 양식', text(OWN, '상담 양식'), 'face'), fc('permissions', '역할·권한', text(OWN, '역할·권한'), 'face'), fc('navigation', '탭 및 메뉴 구성', text(OWN, '탭 및 메뉴 구성'), 'face'), fc('modules', '기능', text(OWN, '"기능"'), 'face'),
      fc('dashboard', '대시보드 관리', text(OWN, '대시보드 관리'), 'face'), fc('popups', '팝업 공지', text(OWN, '팝업 공지'), 'face'), fc('data', '데이터 정리', text(OWN, '데이터 정리'), 'face'), fc('import', '데이터 가져오기', text(OWN, '데이터 가져오기'), 'face'),
      fc('audit', '감사로그', text(OWN, '감사로그'), 'face'), fc('sheets', '연동', text(OWN, '"연동"'), 'face')],
    actions: [] },
  { id: 'help', label: '도움말', group: 'support', viewKind: 'records', summary: '화면 설명서와 질문 게시판을 봅니다.',
    facets: [fc('manuals', '도움말', route('/help')), fc('icons', '아이콘 시스템', route('/help/icons'), 'face'), fc('posts', '도움말 질문', route('/help/posts/[id]'), 'face')],
    actions: [] },
  // ───────── 연동·자동화 ─────────
  { id: 'slack', label: '슬랙 연동', group: 'integration', viewKind: 'settings', summary: '슬랙으로 무엇을 어디로 언제 보낼지 규칙을 봅니다.',
    facets: [fc('rules', '규칙', text(SLK, 'ACTIVITY_CATEGORIES')), fc('settings', '슬랙 연결', text(INTEG, '"슬랙"'), 'face')],
    actions: [] },
  { id: 'integrations', label: '외부 연동', group: 'integration', viewKind: 'settings', summary: '메이크에듀·구글 시트·숙제영상 드라이브·연동 PC·오늘 수학 연결을 봅니다.',
    facets: [fc('makeedu', '메이크에듀 동기화', text(INTEG, 'makeedu 동기화'), 'face'), fc('sheets', '구글 시트', text(INTEG, '구글 시트'), 'face'), fc('video', '숙제영상 드라이브', text(INTEG, '숙제영상 드라이브'), 'face'), fc('agent', '연동 PC', text(INTEG, '연동 PC'), 'face'), fc('todaysMath', '오늘 수학', text(INTEG, '"오늘 수학"'), 'face')],
    actions: [] },
  // ───────── 역할별 화면 ─────────
  { id: 'teacher-workspace', label: '강사 화면', group: 'roles', viewKind: 'records', summary: '선생님이 보는 내 메뉴·내 정보 화면을 미리 봅니다.',
    facets: [fc('me', '내 정보', route('/me')), fc('onescreen', '선생님 수업보고서', route('/onescreen'), 'face')],
    actions: [] },
  { id: 'parent-portal', label: '학부모 화면', group: 'roles', viewKind: 'timeline', summary: '학부모가 보는 셔틀·수업 시간표 화면을 미리 봅니다.',
    facets: [fc('live', '실시간 차량', text(PAR, '실시간 차량')), fc('rides', '등하원 시간 변경·확인', text(PAR, '등하원 시간 변경·확인')), fc('classes', '수업 시간표', text(PAR, '수업 시간표'))],
    actions: [] },
  { id: 'student-portal', label: '원생 화면', group: 'roles', viewKind: 'report', summary: '원생이 보는 내 학습 화면을 미리 봅니다(예시 데이터).',
    facets: [fc('summary', '내 학습 현황', route('/my-learning')), fc('report', '데일리 리포트', route('/my-learning/report'), 'face')],
    actions: [] },
  { id: 'public-sites', label: '학원 공개 페이지', group: 'roles', viewKind: 'report', summary: '학부모에게 보이는 학원 공개 페이지를 미리 봅니다.',
    facets: [fc('academy', '학원 공개 페이지', route('/academy'))],
    actions: [] },
];

// 2.0 이식 화면 중 해당 영역의 기록을 실제로 처리하는 목적지만 둔다.
const PROCESSING_SCREEN = {
  onescreen: 'onescreen', 'video-homework': 'video-homework', timetable: 'timetable',
  'class-sheets': 'ecs', attendance: 'attendance', classes: 'classes', textbooks: 'textbooks',
  'lesson-reports': 'lesson-reports', 'class-review': 'class-review', students: 'students',
  exams: 'exams', consultations: 'consultations', enrollment: 'enrollment', withdrawals: 'withdrawals',
  'withdrawal-reports': 'withdrawal-reports', staff: 'staff', billing: 'billing',
  'textbook-requests': 'textbook-requests', meetings: 'meetings', approvals: 'approvals',
  'owner-settings': 'owner',
};
const keyOpsByArea = Object.fromEntries(families.map(family => [family.id, family.keyOps.map(op => op.id)]));

export const AREAS = AREA_DEFINITIONS.map(area => {
  const screen = PROCESSING_SCREEN[area.id];
  const page = area.id === 'tasks-notifications' ? 'flow' : screen ? `v2-${screen}` : null;
  const actions = [];
  if (page) actions.push({
    id: `${area.id}.screen`, label: area.id === 'class-sheets' ? '영어 강사 시트 열기' : '처리 화면 열기', mode: 'navigate', target: { page },
    draft: { title: `${area.label} 처리 화면`, body: `${area.label}의 실제 처리 화면을 엽니다.` },
    fields: [], ops: [], result: '처리 화면 열기',
  });
  if (area.id === 'class-sheets') actions.push({
    id: 'class-sheets.math-screen', label: '수학 강사 시트 열기', mode: 'navigate', target: { page: 'v2-mcs' },
    draft: { title: '수학 강사 시트', body: '수학 강사 시트의 실제 처리 화면을 엽니다.' },
    fields: [], ops: [], result: '처리 화면 열기',
  });
  actions.push({
    id: `${area.id}.request`, label: '업무 요청', mode: 'request',
    draft: { title: `${area.label} 업무 요청`, body: `${area.label}에서 확인하거나 처리할 일을 적어 담당자에게 요청합니다.` },
    fields: [], ops: keyOpsByArea[area.id] || [], result: '업무 요청 창 열기',
  });
  return { ...area, menuHidden: area.group === 'roles', actions };
});
