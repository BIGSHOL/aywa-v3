// Workflow rules: role mapping, 2.0 task kinds, event registry and templates. Code decides
// who may do what; AI (flow-decision.mjs) may only pick among these rules.

// src/lib/auth/role-hierarchy.ts ROLE_LABEL → preview roles (no platform labels).
export const ROLE_LABEL = { master: '원장', admin: '관리자', manager: '매니저', accountant: '회계', counselor: '상담사', teacher: '강사', viewer: '참관' };
export const ACTOR_ROLE = { master: 'owner', admin: 'manager', manager: 'manager', teacher: 'teacher', accountant: 'staff', counselor: 'staff', viewer: 'staff' };
export const ROLE_NAME = { owner: '원장', manager: '관리자', teacher: '강사', staff: '직원' };

// src/features/staff-tasks/kinds.ts TASK_KINDS (label · doneRule) + the workspace family each opens into.
export const TASK_KINDS = {
  report_send_failed: { label: '보고서 발송 실패', familyId: 'lesson-reports', doneRule: '그 보고서가 학부모에게 실제로 나가면 처리됩니다. 재발송 요청만으로는 처리되지 않습니다. 실패한 다음 날까지 못 보내면 늦음입니다.' },
  followup_due: { label: '상담 후속조치', familyId: 'consultations', doneRule: '원생상담에서 후속조치 완료를 체크하면 처리됩니다. 기한 날이 지나면 늦음입니다.' },
  enrollment_followup: { label: '콜&상담 후속 조치', familyId: 'enrollment', doneRule: '그 상담을 등록 또는 미등록으로 정하면 처리됩니다. 다음 상담 날짜를 옮기면 이 회차는 취소되고 새 날짜에 다시 열립니다. 그 날이 지나면 늦음입니다.' },
  progress_anomaly: { label: '진도 기록 이상', familyId: 'class-sheets', doneRule: "학생 상세 진도 탭에서 그 기록의 '이상 없음'을 누르면 처리됩니다(확인을 되돌리면 다시 열립니다). 생긴 다음 날까지 확인하지 않으면 늦음입니다." },
  attendance_absent_desk: { label: '결석 확인 전화', familyId: 'attendance', doneRule: "오늘 출결의 데스크 확인에서 이 결석의 연락 결과를 '저장'하거나 '해당 없음'을 누르면 처리됩니다. 출석으로 정정되면 취소됩니다. 입력한 다음 날이 되면 늦음, 7일이 지나면 기한 지남입니다." },
  video_upload_check: { label: '영상 업로드 확인', familyId: 'video-homework', doneRule: "그 숙제 영상이 실제로 들어오면(올리기 사이트에서 끝까지 올라오거나 영상 제출 현황이 '완료') 처리됩니다. 숙제를 취소하면 취소, 숙제일부터 14일이 지나면 기한 지남입니다. 다음 날까지 안 들어오면 늦음입니다." },
  video_unassigned: { label: '미배정 영상', familyId: 'video-homework', doneRule: '영상 제출 현황에서 이 영상을 숙제에 배정하거나 제외하면 처리됩니다. 영상이 아직 안 붙은 숙제가 있을 때만 생기고, 그 숙제가 다른 영상으로 채워지는 등 붙일 숙제가 없어지면 취소됩니다. 영상이 지워져도 취소, 올린 지 14일이 지나면 기한 지남입니다. 다음 날까지 배정하지 않으면 늦음입니다.' },
  unsent_report: { label: '미발송 수업 보고서', familyId: 'lesson-reports', doneRule: "그 보고서의 발송을 요청하면 처리됩니다(실제로 나갔는지는 '보고서 발송 실패'가 따로 확인합니다). 회수·삭제하거나 보낼 수 없게 되면 취소, 발송 기한이 지나면 기한 지남입니다. 찾은 날이 끝날 때까지 안 보내면 늦음입니다." },
  approval_turn: { label: '전자결재 차례', familyId: 'approvals', doneRule: "내 결재 차례에서 승인·반려·전결하면 처리됩니다. 후결로 넘겨진 칸은 '후결 확인'을 하면 처리됩니다. 문서가 취소되거나 내 차례가 전결로 생략되면 취소됩니다. 차례가 온 다음 날까지 결재하지 않으면 늦음입니다." },
  withdrawal_step: { label: '퇴원보고서', familyId: 'withdrawal-reports', doneRule: '작성 차례는 보고서를 제출하면, 승인 차례는 승인하면 처리됩니다. 보완 요청·취소로 차례가 없어지면 취소됩니다. 작성은 이틀, 승인은 다음 날까지 안 하면 늦음입니다.' },
  help_question: { label: '도움말 질문', familyId: 'help', doneRule: '질문에 답변이 달리거나 답변 완료·닫힘이 되면 처리됩니다. 질문이 지워지면 취소됩니다. 다음 날까지 답하지 않으면 늦음입니다.' },
};
// src/features/staff-tasks/kinds.ts CLOSE_REASON / TASK_STATE_LABEL.
export const CLOSE_REASON = { sent: '학부모에게 발송됨', revoked: '보고서 회수', recalled: '보고서 회수', deleted: '원래 기록이 삭제됨', too_old: '재발송 기한이 지남', deadline: '재발송 기한이 지남', followup_done: '후속조치 완료 체크', rescheduled: '기한을 다른 날로 옮김', cleared: '후속조치 기한을 지움', anomaly_resolved: '이상 없음으로 확인', desk_settled: '데스크 확인 기록으로 처리됨', not_absent: '결석이 아니게 정정됨', stale: '7일이 지나도록 확인하지 않음', video_arrived: '영상이 들어옴', homework_cancelled: '숙제를 취소함', upload_window: '올릴 수 있는 기간이 지남', video_removed: '영상이 지워짐', video_assigned: '숙제에 배정하거나 제외함', unassigned_window: '올린 지 14일이 지남', no_open_homework: '붙일 숙제가 없음', send_requested: '발송을 요청함', not_sendable: '보낼 수 없는 보고서가 됨', approval_decided: '결재함', document_canceled: '문서가 취소됨', turn_skipped: '내 차례가 생략됨', withdrawal_acted: '제출하거나 승인함', withdrawal_canceled: '퇴원보고서가 취소됨', turn_changed: '차례가 바뀜', help_answered: '답변이 달림' };
export const TASK_STATE_LABEL = { open: '처리 전', late: '늦음', done: '처리됨', cancelled: '취소됨', expired: '기한 지남' };
export const TASK_EVENT_LABEL = { opened: '할 일 생김', reopened: '다시 열림', assigned: '담당 지정', retry_requested: '재발송 요청', failed_again: '다시 실패', done: '처리됨', cancelled: '취소됨', expired: '기한 지남' };

// Event registry: every event type the engine emits, with whether it is implemented now or
// only declared for a future template (declared types are rejected by the command layer).
export const EVENT_TYPES = {
  'source.task_opened': { label: '할 일 생김(원본 기록)', implemented: true },
  'source.task_event': { label: '할 일 이력(원본 기록)', implemented: true },
  'source.signal': { label: '확인할 상태 발견(원본 기록)', implemented: true },
  // 원본 재대조(AX-H1·H4 — flow-reconcile.mjs): 원본을 다시 읽을 때마다 저장된 원본 업무를 다시 판정한 결과.
  'source.task_closed': { label: '원본에서 할 일이 닫힘', implemented: true },
  'source.task_reopened': { label: '원본에서 할 일이 다시 열림', implemented: true },
  'source.task_reassigned': { label: '원본 할 일 담당이 바뀜', implemented: true },
  'source.task_changed': { label: '원본 할 일 내용이 바뀜', implemented: true },
  'source.signal_cleared': { label: '원본에서 확인할 상태가 풀림', implemented: true },
  'source.signal_changed': { label: '확인할 근거 기록이 바뀜', implemented: true },
  'source.signal_reopened': { label: '확인할 상태가 다시 생김', implemented: true },
  'source.signal_handled': { label: '처리 완료(근거 기록 모두 처리 보고)', implemented: true },
  'absence.reported': { label: '결석 보고', implemented: true },
  'billing.flagged': { label: '수납 확인 요청', implemented: true },
  'consultation.followup_requested': { label: '상담 후속 요청', implemented: true },
  'request.created': { label: '업무 요청', implemented: true },
  'decision.requested': { label: '판정 요청', implemented: true },
  'decision.recorded': { label: '판정 기록', implemented: true },
  'step.routed': { label: '담당 지정', implemented: true },
  'step.acknowledged': { label: '확인함', implemented: true },
  'step.unacknowledged': { label: '확인 취소', implemented: true },
  'step.reported': { label: '결과 보고', implemented: true },
  'step.reviewed': { label: '검토 완료', implemented: true },
  'step.returned': { label: '보완 요청', implemented: true },
  'step.skipped': { label: '필요 없어 건너뜀', implemented: true },
  'step.reassigned': { label: '담당 변경', implemented: true },
  'case.closed': { label: '완료', implemented: true },
  'case.reopened': { label: '다시 열림', implemented: true },
  'followup.linked': { label: '후속 보고 연결', implemented: true },
  'enrollment.inquiry': { label: '신규 문의 접수', implemented: false },
  'parent.message': { label: '학부모 글', implemented: false },
  'withdrawal.requested': { label: '퇴원 요청', implemented: false },
};

// Step roles resolve to actual people in flow-engine.mjs (resolveRole); 'manager' with no
// person is the explicit manager queue.
export const STEP_ROLE_LABEL = { desk: '데스크', homeroom: '담임', billing: '수납 담당', counselor: '상담 담당', manager: '관리자', owner: '원장', assignee: '요청받은 사람', source: '원본 담당' };

export const TEMPLATES = {
  absence: {
    familyId: 'attendance', title: '결석 연락과 후속 조치', trigger: 'absence.reported',
    steps: [
      { key: 'desk_contact', label: '보호자 결석 확인 연락', role: 'desk', evidenceRequired: true },
      { key: 'manager_review', label: '관리자 검토', role: 'manager', review: true, when: 'needsReview' },
      { key: 'teacher_followup', label: '담임 후속 조치(보강·학습 안내)', role: 'homeroom', evidenceRequired: true },
    ],
  },
  billing: {
    familyId: 'billing', title: '수납 잔액 확인과 결정', trigger: 'billing.flagged',
    steps: [
      { key: 'staff_check', label: '납부 내역 대조', role: 'billing', evidenceRequired: true },
      { key: 'decision', label: '관리자·원장 결정', role: 'manager', review: true },
    ],
  },
  consultation: {
    familyId: 'consultations', title: '상담 후속 조치', trigger: 'consultation.followup_requested',
    steps: [
      { key: 'counselor_followup', label: '상담 담당 후속 연락', role: 'counselor', evidenceRequired: true },
      { key: 'manager_review', label: '관리자 검토', role: 'manager', review: true, when: 'needsReview' },
    ],
  },
};
export const SCENARIOS = Object.keys(TEMPLATES);

// Who may run which command (preview routing, not production authentication).
export const COMMAND_ROLES = {
  'request.create': ['owner', 'manager'],
  'event.simulate': ['owner', 'manager', 'teacher', 'staff'],
  'case.analyze': ['owner', 'manager'],
  'case.reassign': ['owner', 'manager'],
  'case.reopen': ['owner', 'manager'],
  'case.review': ['owner', 'manager'],
  'case.ack': ['owner', 'manager', 'teacher', 'staff'],
  'case.unack': ['owner', 'manager', 'teacher', 'staff'],
  'case.report': ['owner', 'manager', 'teacher', 'staff'],
};
export const COMMAND_KINDS = Object.keys(COMMAND_ROLES);
export const PRIORITIES = ['high', 'normal', 'low'];
export const REPORT_OUTCOMES = { done: '처리함', needs_review: '검토 필요', unreachable: '연락 안 됨', not_needed: '해당 없음' };

// 원본 신호 업무가 닫히는 법(AX-H1·H4). 보통 신호는 원본에서 그 상태가 풀릴 때(근거 기록이 신호에서 빠질 때) 닫힌다.
export const SIGNAL_DONE_RULE = '원본에서 이 상태가 풀리면(근거 기록이 신호에서 빠지면) 자동으로 닫힙니다.';
// 처리해도 사실이 그대로 남는 신호(AX-H4) — 담당자가 처리 결과를 보고하면 그때의 근거 기록을 '처리한 기록'으로 남기고 닫는다.
// 다시 읽을 때 처리한 기록에 없는 새 기록이 생길 때만 다시 연다. 원본 기록(결석 등)은 바꾸지 않는다. 여기 한 곳에서만 고른다.
export const FACT_SIGNALS = Object.freeze({
  // 미수납 잔액은 메이크에듀 동기화로만 바뀐다. 안내 등 후속 조치를 해도 청구 사실 자체는 남는다.
  'billing-remaining': { doneRule: '수납 반영은 메이크에듀 동기화로 들어옵니다. 청구별로 학부모 안내 등 처리 결과를 보고하면 닫힙니다. 보고 뒤 새 미수 청구가 생기면 다시 열립니다.' },
  // 이번 달 결석 횟수는 지난 출결 사실 — 보호자 연락·보강 계획을 마쳐도 결석 3회 이상은 그대로다(domain-snapshot-academic2.mjs).
  'attendance-repeat-absence': { doneRule: '담당 선생님이 결석 사유·연락·보강 계획을 보고하면 닫힙니다(결석 기록은 그대로). 보고 뒤 새 결석이 생기면 다시 열립니다.' },
  // 최근 7일 동기화 실패·일부 실패는 이미 끝난 실행의 결과 — 연동 PC를 확인해도 그 실행 기록은 바뀌지 않는다(domain-snapshot-support.mjs).
  'makeedu-sync-problem': { doneRule: '연동 PC 상태를 확인해 보고하면 닫힙니다(지난 실행 기록은 그대로). 보고 뒤 새 실패가 생기면 다시 열립니다.' },
});
// 처리 완료로 치는 보고 결과. '검토 필요'·'연락 안 됨'은 아직 남은 일이라 닫지 않는다.
export const HANDLED_OUTCOMES = Object.freeze(['done', 'not_needed']);
