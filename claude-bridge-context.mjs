// Server-side business context for the local assistant. Built once from the
// verified snapshot the server already loaded; the browser never supplies facts.
// Only aggregates leave this module: no names, phone numbers, notes, titles,
// auth rows or credentials.
export const ASSISTANT_ISSUE_IDS = Object.freeze(['billing', 'admissions', 'attendance', 'approval', 'tasks', 'books', 'enrollment']);

const nf = new Intl.NumberFormat('ko-KR');
const n = value => nf.format(Math.round(Number(value) || 0));
const won = value => `${n(value)}원`;
const signed = value => `${value > 0 ? '+' : ''}${n(value)}`;
const sum = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
const count = (rows, key, labels) => {
  const out = new Map();
  for (const row of rows) { const k = typeof key === 'function' ? key(row) : row[key]; const label = labels?.[k] || (labels ? '기타' : k); out.set(label, (out.get(label) || 0) + 1); }
  return [...out].sort((a, b) => b[1] - a[1]);
};
const list = pairs => pairs.length ? pairs.map(([label, c]) => `${label} ${n(c)}`).join(', ') : '없음';
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const kst = iso => { const d = new Date(Date.parse(iso) + 9 * 3600000); return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 16).replace('T', ' ')} KST`; };

const LABELS = {
  invoiceStatus: { paid: '납부완료', partial: '부분납부', unpaid: '미납', pending: '청구 대기' },
  category: { tuition: '수강료', textbook: '교재비', shuttle: '차량비', material: '재료비' },
  outcome: { scheduled: '상담 예약', consulted: '상담 완료', ai_done: '상담 검토', enrolled: '등록', declined: '미등록', no_show: '미방문' },
  form: { leave: '휴가 신청', expense: '지출', general: '일반' },
  approval: { pending: '결재 대기', approved: '승인 완료', rejected: '반려', draft: '작성 중' },
  taskKind: { report_send_failed: '보고서 발송 실패', followup_due: '상담 후속조치', enrollment_followup: '콜&상담 후속 조치', progress_anomaly: '진도 기록 이상', attendance_absent_desk: '결석 확인 전화', video_upload_check: '영상 업로드 확인', video_unassigned: '미배정 영상', unsent_report: '미발송 수업 보고서', approval_turn: '전자결재 차례', withdrawal_step: '퇴원보고서', help_question: '도움말 질문', owner_review: '원장 개인 업무' },
  taskStatus: { open: '처리 전', done: '처리됨', cancelled: '취소됨', expired: '기한 지남' },
  book: { requested: '요청', ordered: '주문', delivered: '전달', paid: '납부 완료' },
};
const REVIEW_OUTCOMES = ['scheduled', 'consulted', 'ai_done'];

// The same selections as ax.js issues(), recomputed from the server's copy.
function selections(db) {
  const { month, asOf } = db.meta;
  const trend = db.trend.filter(t => db.months.includes(t.month));
  const now = db.trend.find(t => t.month === month), prev = db.trend.at(-2);
  return {
    month, asOf, trend, now, prev,
    monthBills: db.invoices.filter(i => i.period === month),
    bills: db.invoices.filter(i => i.period === month && i.remaining > 0),
    monthLeads: db.admissions.filter(a => a.date.startsWith(month)),
    leads: db.admissions.filter(a => a.date.startsWith(month) && REVIEW_OUTCOMES.includes(a.outcome)),
    absent: db.students.filter(s => s.status === 'enrolled' && s.attendance.absent >= 3),
    pending: db.approvals.filter(a => a.status === 'pending'),
    overdue: db.tasks.filter(t => t.status === 'open' && t.due && t.due < asOf),
    books: db.textbooks.filter(t => ['requested', 'ordered'].includes(t.status)),
  };
}

function sections(db, s) {
  const enrolled = db.students.filter(x => x.status === 'enrolled').length, onHold = db.students.filter(x => x.status === 'on_hold').length;
  const delta = s.now.payingStudents - s.prev.payingStudents, latestDaily = db.daily.at(-1);
  const remaining = s.bills.map(b => b.remaining);
  const bucket = (rows, ranges) => ranges.map(([label, lo, hi]) => [label, rows.filter(v => v >= lo && v <= hi).length]).filter(([, c]) => c > 0);
  const overdueDays = s.overdue.map(t => days(t.due, s.asOf)), absences = s.absent.map(x => x.attendance.absent);
  const statuses = new Map(db.attendance.statuses.map(x => [x.label, x.count]));
  const attendanceTotal = [...statuses.values()].reduce((t, c) => t + c, 0);
  const followups = s.leads.filter(a => a.followup && a.followup >= s.asOf).length;
  return {
    billing: {
      title: `수납 확인 ${n(s.bills.length)}건`,
      lines: [
        '계산식: 남은 금액 = 할인 전 금액 − 할인액 − 수납액(청구별 0 미만은 0). 취소·환불 청구는 제외.',
        `${s.month} 청구 ${n(s.monthBills.length)}건: 할인 전 ${won(sum(s.monthBills, 'gross'))}, 할인 ${won(sum(s.monthBills, 'discount'))}, 실제 청구액 ${won(sum(s.monthBills, 'total'))}, 수납 ${won(sum(s.monthBills, 'paid'))}, 남은 금액 ${won(sum(s.monthBills, 'remaining'))}.`,
        `남은 금액이 있는 청구 ${n(s.bills.length)}건(합계 ${won(sum(s.bills, 'remaining'))}) · 항목별 ${list(count(s.bills, 'category', LABELS.category))} · 상태별 ${list(count(s.bills, 'status', LABELS.invoiceStatus))}${remaining.length ? ` · 건당 ${won(Math.min(...remaining))}~${won(Math.max(...remaining))}` : ''} · 납부 기한이 기준일 이전인 건 ${n(s.bills.filter(b => b.due && b.due < s.asOf).length)}건.`,
        `최근 6개월(청구월: 청구액 / 수납 / 남은 금액): ${s.trend.map(t => `${t.month} ${won(t.billed)} / ${won(t.paid)} / ${won(t.remaining)}`).join('; ')}.`,
        '주의: 수납액은 복사 시점까지 받은 누적 금액이며 입금일 기준 현금 흐름·확정 손익이 아님. 할인은 미납이 아님. 완납 청구는 대상이 아님.',
      ],
    },
    admissions: {
      title: `상담 후속 확인 ${n(s.leads.length)}건`,
      lines: [
        `${s.month} 접수 ${n(s.monthLeads.length)}건. 현재 결과별: ${list(count(s.monthLeads, 'outcome', LABELS.outcome))}.`,
        `상담·검토 단계(상담 예약·상담 완료·상담 검토) ${n(s.leads.length)}건 중 기준일 이후 다음 상담 일정이 기록된 건 ${n(followups)}건, 없거나 지난 건 ${n(s.leads.length - followups)}건.`,
        `${s.month} 접수 경로: ${list(db.admissionChannels.map(c => [c.label, c.count]))}.`,
        `최근 6개월(접수월: 접수 / 현재 등록): ${s.trend.map(t => `${t.month} ${n(t.inquiries)} / ${n(t.registered)}`).join('; ')}.`,
        '주의: 접수월 기준의 현재 결과임. 연락 기한이 지났다는 뜻이 아니며 다음 약속 유무를 확인하는 항목임.',
      ],
    },
    attendance: {
      title: `출결 특이사항 ${n(s.absent.length)}명`,
      lines: [
        `기준: 재원 상태이며 ${s.month} 결석 기록이 3회 이상인 원생 ${n(s.absent.length)}명. 결석 횟수 분포: ${list(bucket(absences, [['3회', 3, 3], ['4~5회', 4, 5], ['6~9회', 6, 9], ['10회 이상', 10, Infinity]]))}.`,
        `${s.month} 1일~기준일 유효 출결 ${n(attendanceTotal)}건: 출석 ${n(statuses.get('present'))}, 결석 ${n(statuses.get('absent'))}, 지각 ${n(statuses.get('late'))}, 조퇴 ${n(statuses.get('early_leave'))}, 보강 ${n(statuses.get('makeup'))}.`,
        `최근 6개월(월: 결석 / 출결 기록): ${s.trend.map(t => `${t.month} ${n(t.absent)} / ${n(t.attendance)}`).join('; ')}.`,
        '주의: 횟수는 수업별 출결 건수이며 연속 결석일이나 퇴원 위험 점수가 아님. 기록만으로 사유를 단정하지 않음. 수정된 출결은 최신 기록만 반영. 월별 출결 기록 수는 기록 방식 변화의 영향을 받을 수 있음.',
      ],
    },
    approval: {
      title: `결재 대기 ${n(s.pending.length)}건`,
      lines: [
        `대기 문서 양식별: ${list(count(s.pending, 'form', LABELS.form))}. 상신 후 경과일: ${s.pending.length ? s.pending.map(a => a.date ? `${days(a.date, s.asOf)}일` : '상신일 없음').join(', ') : '없음'}.`,
        `전체 결재 문서 ${n(db.approvals.length)}건: ${list(count(db.approvals, 'status', LABELS.approval))}.`,
        '주의: 원장 검토와 담당자 보완 요청을 구분함. 문서 본문과 첨부는 이 요약에 없음.',
      ],
    },
    tasks: {
      title: `기한 지난 업무 ${n(s.overdue.length)}건`,
      lines: [
        '기준: 진행 중이며 등록된 기한이 기준일보다 이전인 업무.',
        `종류별: ${list(count(s.overdue, 'kind', LABELS.taskKind))}. 기한 경과: ${list(bucket(overdueDays, [['7일 이내', 1, 7], ['8~30일', 8, 30], ['31일 이상', 31, Infinity]]))}. 담당자 미지정 ${n(s.overdue.filter(t => !t.owners.length).length)}건.`,
        `전체 업무 ${n(db.tasks.length)}건: ${list(count(db.tasks, 'status', LABELS.taskStatus))}.`,
        '주의: 완료 표시가 누락됐을 수 있으므로 담당자 확인이 먼저임.',
      ],
    },
    books: {
      title: `교재 진행 확인 ${n(s.books.length)}건`,
      lines: [
        `요청·주문 상태: ${list(count(s.books, 'status', LABELS.book))}, 금액 합계 ${won(sum(s.books, 'price'))}.`,
        `전체 교재 기록 ${n(db.textbooks.length)}건: ${list(count(db.textbooks, 'status', LABELS.book))}.`,
        '주의: 전달 기한이 기록되지 않으므로 배송 지연으로 판단하지 않음.',
      ],
    },
    enrollment: {
      title: `청구 대상 ${n(Math.abs(delta))}명 ${delta < 0 ? '감소' : delta > 0 ? '증가' : '유지'}`,
      lines: [
        `월별 수강료 청구 대상(고유 학생): ${s.trend.map(t => `${t.month} ${n(t.payingStudents)}명`).join(' → ')}. 전월 대비 ${signed(delta)}명.`,
        `현재 학생 상태 기준 재원 ${n(enrolled)}명, 휴원 ${n(onHold)}명(테스트 학생 제외).${latestDaily ? ` 일별 기록 최근값 ${latestDaily.date}: 재원 ${n(latestDaily.enrolled)}명, 휴원 ${n(latestDaily.onHold)}명.` : ''}`,
        '주의: 청구 대상 수는 그 달에 수강료가 청구된 학생 수(코호트)이며 현재 재원 수와 다른 지표임. 증감을 퇴원 인원으로 해석하지 않음. 원인은 기간별 수강·청구 대조가 필요함.',
      ],
    },
  };
}

export function buildAssistantContext(db) {
  const s = selections(db), parts = sections(db, s);
  const enrolled = db.students.filter(x => x.status === 'enrolled').length;
  const overview = [
    `기준일 ${s.asOf}(로컬 검증 복사본 · 원본 스냅샷 ${kst(db.meta.importedAt)}). 이번 달 = ${s.month}(1일~기준일).`,
    `현재 재원 ${n(enrolled)}명(학생 상태 기준). ${s.month} 수강료 청구 대상 ${n(s.now.payingStudents)}명 — 두 수는 다른 지표.`,
    `확인할 이슈: ${ASSISTANT_ISSUE_IDS.map(id => `${id}=${parts[id].title}`).join(' · ')}.`,
  ];
  const issues = Object.fromEntries(ASSISTANT_ISSUE_IDS.map(id => [id, Object.freeze({ title: parts[id].title, text: [`[${id}] ${parts[id].title}`, ...parts[id].lines.map(l => `- ${l}`)].join('\n') })]));
  return Object.freeze({ asOf: s.asOf, month: s.month, overview: overview.join('\n'), issues: Object.freeze(issues), domain: domainContext(db.workspaces) });
}

// 업무 영역 집계(model.workspaces) — 지표 이름·숫자만. 근거 기록·세부 문구·이름은 싣지 않는다.
export const ISSUE_FAMILY = Object.freeze({ billing: 'billing', admissions: 'enrollment', attendance: 'attendance', approval: 'approvals', tasks: 'tasks-notifications', books: 'textbook-requests', enrollment: 'students' });
const STATE_NOTE = { empty: '기록 없음', unavailable: '데이터 연결 전' };
// Short title (before the parenthesis): "학원 설정(18면)·관리자 도구" → "학원 설정".
const shortTitle = f => f.title.split('(')[0].trim();
const domainLine = f => STATE_NOTE[f.dataState] ? `- ${shortTitle(f)}: ${STATE_NOTE[f.dataState]}` : `- ${shortTitle(f)}: ${f.metrics.slice(0, 6).map(m => `${m.label} ${m.value === null ? '—' : Number.isInteger(m.value) ? n(m.value) : m.value.toFixed(1)}${m.unit}`).join(', ')}`;
function domainContext(ws) {
  if (!ws?.families) return null;
  const header = `[업무 영역 집계] ${ws.asOf} 기준 기능 영역별 지표(서버 계산).`;
  return Object.freeze({
    all: [header, ...Object.values(ws.families).filter(f => f.dataState !== 'not-applicable').map(domainLine)].join('\n'),
    byIssue: Object.freeze(Object.fromEntries(Object.entries(ISSUE_FAMILY).filter(([, id]) => ws.families[id]).map(([issue, id]) => [issue, `${header}\n${domainLine(ws.families[id])}`]))),
  });
}

// A focused issue gets its full section; without one every aggregate section is relevant.
export function contextText(context, issueId) {
  const ids = issueId ? [issueId] : ASSISTANT_ISSUE_IDS;
  const domain = context.domain ? (issueId ? context.domain.byIssue[issueId] : context.domain.all) : null;
  return [context.overview, ...ids.map(id => context.issues[id].text), domain].filter(Boolean).join('\n\n');
}
