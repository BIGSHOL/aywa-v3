// 운영 영역 — 셔틀·재고·회의록·전자결재·데이터베이스(+ 두 번째 묶음).
import { PRIORITY, family, field, metric, monthlyTrend, record, signal } from './domain-snapshot-core.mjs';
import { opsFamilies2 } from './domain-snapshot-ops2.mjs';

const DAY = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const ASSET = { in_use: '사용 중', on_loan: '대여 중', repair: '수리', lost: '분실', disposed: '폐기' };
const APPROVAL = { draft: '작성 중', pending: '결재 대기', approved: '승인 완료', rejected: '반려' };
const FORM = { leave: '휴가 신청', basic: '일반 기안', expense: '지출', income: '수입' };
const DOC_FORM = { staff_resume: '직원 이력서', refund_request: '환불 요청서', class_review: '수업 평가', class_review_template: '수업 평가 양식', staff_intake_token: '직원 정보 입력 링크' };
const PROCESS = { completed: 'AI 분석 완료', idle: '기록만', failed: '분석 실패', processing: '분석 중', transcribing: '전사 중' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));

export async function opsFamilies(ctx) {
  const { sql, t, asOf, month, monthStart } = ctx;
  const out = {};
  // 셔틀 — 정기 탑승 배정(근거)·노선·운행·승하차 기록. 승하차 기록이 없다고 미탑승으로 보지 않는다.
  const riders = await sql`select r.id, s.name, r.io_kind, r.weekdays, run.season, run.label, run.run_no, st.name stop, v.name vehicle from public.shuttle_riders r join public.students s on s.id=r.student_id and s.tenant_id=${t} join public.shuttle_run_stops rs on rs.id=r.run_stop_id and rs.tenant_id=${t} join public.shuttle_runs run on run.id=rs.run_id and run.tenant_id=${t} left join public.shuttle_stops st on st.id=rs.stop_id and st.tenant_id=${t} left join public.shuttle_vehicles v on v.id=run.vehicle_id and v.tenant_id=${t} where r.tenant_id=${t} and not coalesce(s.is_test,false) order by run.season, run.run_no, s.name`;
  const [sh] = await sql`select (select count(*)::int from public.shuttle_vehicles where tenant_id=${t} and not coalesce(archived,false)) vehicles, (select count(*)::int from public.shuttle_runs where tenant_id=${t}) runs, (select count(*)::int from public.shuttle_runs where tenant_id=${t} and season='vacation') vacation_runs, (select count(*)::int from public.shuttle_stops where tenant_id=${t} and not coalesce(archived,false)) stops, (select count(*)::int from public.shuttle_trips where tenant_id=${t}) trips, (select max(ran_on)::text from public.shuttle_trips where tenant_id=${t}) last_trip, (select count(*)::int from public.shuttle_boardings where tenant_id=${t}) boardings, (select count(*)::int from public.shuttle_ride_exceptions where tenant_id=${t}) exceptions`;
  const seasonLabel = s => s === 'vacation' ? '방학' : '학기';
  out.shuttle = family('shuttle', '셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치)', {
    summary: `차량 ${sh.vehicles}대 · 노선 ${sh.runs}개 · 정기 탑승 배정 ${riders.length}건(학생 ${new Set(riders.map(r => r.name)).size}명). 운행 기록 ${sh.trips}회.`,
    metrics: [metric('운행 차량', sh.vehicles, '대'), metric('노선', sh.runs, '개', `학기 ${sh.runs - sh.vacation_runs} · 방학 ${sh.vacation_runs}`), metric('정류장', sh.stops, '곳'), metric('정기 탑승 배정', riders.length, '건'), metric('탑승 학생', new Set(riders.map(r => r.name)).size, '명'), metric('운행 기록', sh.trips, '회', `마지막 ${sh.last_trip || '기록 없음'}`), metric('승하차 기록', sh.boardings, '건'), metric('등하원 변경', sh.exceptions, '건')],
    evidence: riders.map(r => record({ id: r.id, label: r.name, detail: `${seasonLabel(r.season)} ${r.label || `${r.run_no}회차`} · ${r.stop || '정류장 미지정'}`, status: r.io_kind === 'out' ? '하원' : '등원', fields: [field('요일', (r.weekdays || []).map(d => DAY[d] || d).join('·')), field('차량', r.vehicle)], facets: [`season:${r.season === 'vacation' ? 'vacation' : 'term'}`, `io:${r.io_kind === 'out' ? 'out' : 'in'}`] })),
    facetLabels: { 'season:term': '학기 노선', 'season:vacation': '방학 노선', 'io:in': '등원', 'io:out': '하원' }, recordSource: 'shuttle_riders',
    sourceLabel: '셔틀 노선 · 정기 탑승 · 운행 기록', coverageNote: '근거 목록은 정기 탑승 배정 전체입니다. 승하차 기록이 없는 날을 미탑승이나 결석으로 보지 않으며, 기사 연락처와 정류장 위치는 보여 주지 않습니다.',
    sources: [{ table: 'shuttle_riders', rows: riders.length }, { table: 'shuttle_runs', rows: sh.runs }, { table: 'shuttle_trips', rows: sh.trips }, { table: 'shuttle_boardings', rows: sh.boardings }, { table: 'shuttle_ride_exceptions', rows: sh.exceptions }],
  });

  // 재고관리 — 자산(근거)·대여·실사·소모품.
  const assets = await sql`select a.id, a.asset_code, coalesce(c.label, a.category) category, a.maker, a.model, a.status, a.location, a.holder_name, a.last_audited_on::text audited from public.inventory_assets a left join public.inventory_categories c on c.key=a.category and c.tenant_id=${t} where a.tenant_id=${t} order by a.sort_order nulls last, a.asset_code`;
  const loans = await sql`select l.id, l.status, l.due_on::text due, l.asset_id from public.inventory_loans l where l.tenant_id=${t}`;
  const [inv] = await sql`select (select count(*)::int from public.inventory_audits where tenant_id=${t}) audits, (select max(audited_on)::text from public.inventory_audits where tenant_id=${t}) last_audit, (select count(*)::int from public.inventory_supplies where tenant_id=${t}) supplies, (select coalesce(sum(qty),0)::int from public.inventory_supplies where tenant_id=${t}) qty`;
  const overdueLoans = loans.filter(l => l.status === 'out' && l.due && l.due < asOf);
  const overdueAssets = new Set(overdueLoans.map(l => l.asset_id));
  out.inventory = family('inventory', '재고관리(자산·대여·실사·소모품·업체)', {
    summary: `자산 ${assets.length}대(사용 중 ${assets.filter(a => a.status === 'in_use').length}), 대여 중 ${loans.filter(l => l.status === 'out').length}건 · 반납 기한 지남 ${overdueLoans.length}건. 소모품 ${inv.supplies}종.`,
    metrics: [metric('자산', assets.length, '대'), ...Object.entries(ASSET).map(([k, v]) => metric(`자산 ${v}`, assets.filter(a => a.status === k).length, '대')), metric('반납 전 대여', loans.filter(l => l.status === 'out').length, '건'), metric('반납 기한 지난 대여', overdueLoans.length, '건'), metric('실사 기록', inv.audits, '건', `마지막 ${inv.last_audit || '기록 없음'}`), metric('소모품', inv.supplies, '종', `수량 합계 ${inv.qty}개`)],
    evidence: assets.map(a => record({ id: a.id, label: [a.category, a.asset_code].filter(Boolean).join(' '), detail: [a.maker, a.model].filter(Boolean).join(' '), date: a.audited, status: ASSET[a.status] || '기타', fields: [field('위치', a.location), field('사용자', a.holder_name)], facets: [`status:${a.status}`, `category:${a.category}`, overdueAssets.has(a.id) && 'loan-overdue'] })),
    facetLabels: { ...pre('status', ASSET), 'loan-overdue': '반납 기한 지남', ...Object.fromEntries([...new Set(assets.map(a => a.category))].map(c => [`category:${c}`, c])) }, recordSource: 'inventory_assets',
    signals: overdueLoans.length ? [signal({ id: 'inventory-loan-overdue', title: `반납 기한 지난 대여 ${overdueLoans.length}건`, summary: '반납 예정일이 지났는데 아직 대여 중인 자산입니다.', priority: PRIORITY.check, source: '재고관리 · 대여 기록', recordIds: [...overdueAssets], draft: { title: '자산 반납 확인', body: '반납 예정일이 지난 대여 자산의 위치와 반납 일정을 확인해 주세요.' } })] : [],
    sourceLabel: '자산 · 대여 · 실사 · 소모품', coverageNote: '근거 목록은 자산 전체(폐기·분실 포함, 상태로 구분)입니다. 일련번호와 메모는 보여 주지 않습니다.',
    sources: [{ table: 'inventory_assets', rows: assets.length }, { table: 'inventory_loans', rows: loans.length }, { table: 'inventory_audits', rows: inv.audits }, { table: 'inventory_supplies', rows: inv.supplies }],
  });

  // 회의록 — 회의 기록(근거)·녹음·AI 분석. 녹음·전사 처리 상태도 여기서 본다.
  const meetings = await sql`select id, title, to_char(held_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, processing_status::text ps, audio_path is not null audio, case when jsonb_typeof(attendees)='array' then jsonb_array_length(attendees) end attendees, case when jsonb_typeof(ai_report->'actionItems')='array' then jsonb_array_length(ai_report->'actionItems') else 0 end actions from public.meeting_minutes where tenant_id=${t} and (held_at at time zone 'Asia/Seoul')::date <= ${asOf} order by held_at desc`;
  out.meetings = family('meetings', '회의록(녹음·AI 분석)', {
    summary: `회의록 ${meetings.length}건(${month} ${meetings.filter(m => m.d >= monthStart).length}건), AI 분석 완료 ${meetings.filter(m => m.ps === 'completed').length}건·실행 항목 ${meetings.reduce((n, m) => n + m.actions, 0)}개.`,
    metrics: [metric('회의록', meetings.length, '건'), metric('이번 달 회의', meetings.filter(m => m.d >= monthStart).length, '건'), metric('녹음 있는 회의', meetings.filter(m => m.audio).length, '건'), metric('AI 분석 완료', meetings.filter(m => m.ps === 'completed').length, '건'), metric('분석 실패', meetings.filter(m => m.ps === 'failed').length, '건'), metric('AI 실행 항목', meetings.reduce((n, m) => n + m.actions, 0), '개')],
    trend: monthlyTrend('월별 회의록', '건', Object.entries(Object.groupBy(meetings, m => m.d.slice(0, 7))).map(([k, rows]) => ({ month: k, value: rows.length })), asOf),
    evidence: meetings.map(m => record({ id: m.id, label: m.title || '제목 없음', date: m.d, status: PROCESS[m.ps] || '기타', fields: [field('참석', m.attendees === null ? null : `${m.attendees}명`), field('실행 항목', m.actions)], facets: [`process:${m.ps}`, m.audio && 'audio', m.d >= monthStart && 'this-month'] })),
    facetLabels: { ...pre('process', PROCESS), audio: '녹음 있음', 'this-month': '이번 달' }, recordSource: 'meeting_minutes',
    sourceLabel: '회의록 · 녹음 · AI 분석', coverageNote: '근거 목록은 회의록 전체입니다. 회의 내용·전사·AI 분석 본문은 보여 주지 않습니다.',
    sources: [{ table: 'meeting_minutes', rows: meetings.length }],
  });

  // 전자결재 — 결재 문서(근거)와 결재선.
  const docs = await sql`select d.id, d.title, d.form_type, d.status, d.current_step, to_char(d.submitted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, u.display_name drafter, (select count(*)::int from public.approval_steps s where s.tenant_id=${t} and s.document_id=d.id) steps, (select count(*)::int from public.approval_steps s where s.tenant_id=${t} and s.document_id=d.id and s.decision='pending') waiting from public.approval_documents d left join public.users u on u.id=d.drafter_id and u.tenant_id=${t} where d.tenant_id=${t} order by d.submitted_at desc nulls last`;
  const pending = docs.filter(d => d.status === 'pending');
  out.approvals = family('approvals', '전자결재(기안·결재함)', {
    summary: `결재 문서 ${docs.length}건 중 결재 대기 ${pending.length}건(대기 단계 ${docs.reduce((n, d) => n + d.waiting, 0)}개).`,
    metrics: [metric('결재 문서', docs.length, '건'), ...Object.entries(APPROVAL).map(([k, v]) => metric(v, docs.filter(d => d.status === k).length, '건')), metric('대기 중인 결재 단계', docs.reduce((n, d) => n + d.waiting, 0), '개')],
    evidence: docs.map(d => record({ id: d.id, label: d.title, date: d.d, status: APPROVAL[d.status] || '기타', detail: FORM[d.form_type] || '기타 양식', fields: [field('기안', d.drafter), field('결재선', `${d.current_step || 0}/${d.steps}단계`)], facets: [`status:${d.status}`, `form:${d.form_type}`] })),
    facetLabels: { ...pre('status', APPROVAL), ...pre('form', FORM) }, recordSource: 'approval_documents',
    signals: pending.length ? [signal({ id: 'approval-pending', title: `결재 대기 ${pending.length}건`, summary: '결재선에서 결정을 기다리는 문서입니다.', priority: PRIORITY.decide, source: '전자결재 · 대기 문서', recordIds: pending.map(d => d.id), draft: { title: '결재 문서 검토 및 보완', body: '결재 문서의 내용과 첨부 근거를 확인하고, 보완할 사항이 있으면 정리해서 알려 주세요.' } })] : [],
    sourceLabel: '전자결재 문서 · 결재선', coverageNote: '근거 목록은 결재 문서 전체입니다. 문서 본문·사유·의견은 보여 주지 않습니다.',
    sources: [{ table: 'approval_documents', rows: docs.length }, { table: 'approval_steps', rows: docs.reduce((n, d) => n + d.steps, 0) }],
  });

  // 데이터베이스(서식·문서) — 제목·분류·날짜만. 열람 제한 문서는 표시만 하고 내용은 싣지 않는다.
  const files = await sql`select d.id, d.title, coalesce(c.label, d.category) category, d.kind, d.form_type, coalesce(d.restricted,false) restricted, coalesce(d.pinned,false) pinned, to_char(d.updated_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.academy_documents d left join public.document_categories c on c.key=d.category and c.tenant_id=${t} where d.tenant_id=${t} order by d.pinned desc, d.updated_at desc`;
  out.documents = family('documents', '데이터베이스(서식·문서 저장소)', {
    summary: `문서 ${files.length}건(서식 ${files.filter(f => f.kind === 'form').length}·파일 ${files.filter(f => f.kind === 'file').length}), 열람 제한 ${files.filter(f => f.restricted).length}건.`,
    metrics: [metric('문서', files.length, '건'), metric('서식으로 작성', files.filter(f => f.kind === 'form').length, '건'), metric('파일', files.filter(f => f.kind === 'file').length, '건'), metric('열람 제한', files.filter(f => f.restricted).length, '건'), ...Object.entries(DOC_FORM).map(([k, v]) => metric(v, files.filter(f => f.form_type === k).length, '건'))],
    evidence: files.map(f => record({ id: f.id, label: f.title, date: f.d, status: f.restricted ? '열람 제한' : '공개', detail: f.category || '', fields: [field('종류', DOC_FORM[f.form_type] || (f.kind === 'file' ? '파일' : '서식'))], facets: [`kind:${f.kind}`, f.form_type && `form:${f.form_type}`, f.restricted && 'restricted', f.pinned && 'pinned'] })),
    facetLabels: { 'kind:form': '서식', 'kind:file': '파일', restricted: '열람 제한', pinned: '고정', ...pre('form', DOC_FORM) }, recordSource: 'academy_documents',
    sourceLabel: '서식 · 문서 저장소', coverageNote: '근거 목록은 문서 전체의 제목·분류·날짜입니다. 이력서·환불 요청서 같은 열람 제한 문서의 내용과 첨부는 보여 주지 않습니다(첨부 내려받기는 기존 화면 경로).',
    sources: [{ table: 'academy_documents', rows: files.length }],
  });

  Object.assign(out, await opsFamilies2(ctx));
  return out;
}
