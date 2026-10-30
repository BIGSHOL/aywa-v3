// 운영 영역 — 셔틀·재고·회의록·전자결재·데이터베이스(+ 두 번째 묶음).
import { ISO_AT, PRIORITY, family, field, latest, md, metric, monthlyTrend, record, scrub, signal } from './domain-snapshot-core.mjs';
import { opsFamilies2 } from './domain-snapshot-ops2.mjs';
import { importV2 } from './v2-bridge.mjs';

const DAY = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const APPROVAL = { draft: '작성 중', pending: '결재 대기', approved: '승인 완료', rejected: '반려', canceled: '회수' };
// 2.0 APPROVAL_FORM_LABEL·LEAVE_KIND_LABEL 원문(src/features/approvals/types.ts · src/features/leave/request-days.ts).
const FORM = { leave: '휴가신청서', proposal: '품의서', expense: '지출결의서', income: '수입결의서' };
const LEAVE_KIND = { annual: '연차', half: '반차', quarter: '반반차' };
const dayCount = n => (n == null ? null : `${Number(n)}일`);
const dayRange = (a, b) => (!a ? null : !b || a === b ? md(a) : `${md(a)}~${md(b)}`);
const won = n => (n == null ? null : `${Math.round(n).toLocaleString('ko-KR')}원`);
// 휴가 사유는 편집기 HTML로 저장된다 — 글자만.
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const plain = html => String(html ?? '').replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k) => ENTITY[k]).replace(/\s+/g, ' ').trim() || null;
// 값이 있는 칸만 싣는다(없는 칸을 '—'로 남기면 상세 화면에 '기안 —'처럼 뜻 없는 줄이 생긴다).
const filled = pairs => pairs.filter(([, v]) => v != null && v !== '').map(([l, v]) => field(l, v));
const DOC_FORM = { staff_resume: '직원 이력서', refund_request: '환불 요청서', class_review: '수업 평가', class_review_template: '수업 평가 양식', staff_intake_token: '직원 정보 입력 링크' };
const PROCESS = { completed: 'AI 분석 완료', idle: '기록만', failed: '분석 실패', processing: '분석 중', transcribing: '전사 중' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));

export async function opsFamilies(ctx) {
  const { sql, t, asOf, monthStart } = ctx;
  const [{ ASSET_STATUS_LABEL, assetStatusLabel }, { unknownIfEmpty }] = await Promise.all([importV2('features/inventory/status.ts'), importV2('features/inventory/unknown-value.ts')]);
  const out = {};
  // 셔틀 — 정기 탑승 배정(근거)·노선·운행·승하차 기록. 승하차 기록이 없다고 미탑승으로 보지 않는다.
  const riders = await sql`select r.id, s.name, r.io_kind, r.weekdays, run.season, run.label, run.run_no, to_char(rs.at_time,'HH24:MI') at_time, st.name stop, v.name vehicle from public.shuttle_riders r join public.students s on s.id=r.student_id and s.tenant_id=${t} join public.shuttle_run_stops rs on rs.id=r.run_stop_id and rs.tenant_id=${t} join public.shuttle_runs run on run.id=rs.run_id and run.tenant_id=${t} left join public.shuttle_stops st on st.id=rs.stop_id and st.tenant_id=${t} left join public.shuttle_vehicles v on v.id=run.vehicle_id and v.tenant_id=${t} where r.tenant_id=${t} and not coalesce(s.is_test,false) order by run.season, run.run_no, s.name`;
  const [sh] = await sql`select (select count(*)::int from public.shuttle_vehicles where tenant_id=${t} and not coalesce(archived,false)) vehicles, (select count(*)::int from public.shuttle_runs where tenant_id=${t}) runs, (select count(*)::int from public.shuttle_runs where tenant_id=${t} and season='vacation') vacation_runs, (select count(*)::int from public.shuttle_stops where tenant_id=${t} and not coalesce(archived,false)) stops, (select count(*)::int from public.shuttle_trips where tenant_id=${t}) trips, (select max(ran_on)::text from public.shuttle_trips where tenant_id=${t}) last_trip, (select count(*)::int from public.shuttle_boardings where tenant_id=${t}) boardings, (select count(*)::int from public.shuttle_ride_exceptions where tenant_id=${t}) exceptions`;
  const seasonLabel = s => s === 'vacation' ? '방학' : '학기';
  out.shuttle = family('shuttle', '셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치)', {
    summary: `셔틀 타는 원생 ${new Set(riders.map(r => r.name)).size}명 · 운행 기록 ${sh.trips}회(최종 ${sh.last_trip ? md(sh.last_trip) : '기록 없음'}).`,
    metrics: [metric('운행 차량', sh.vehicles, '대'), metric('노선', sh.runs, '개', `학기 ${sh.runs - sh.vacation_runs} · 방학 ${sh.vacation_runs}`), metric('정류장', sh.stops, '곳'), metric('정기 탑승 배정', riders.length, '건'), metric('탑승 원생', new Set(riders.map(r => r.name)).size, '명'), metric('운행 기록', sh.trips, '회', `최종 ${sh.last_trip ? md(sh.last_trip) : '기록 없음'}`), metric('승하차 기록', sh.boardings, '건'), metric('등하원 변경', sh.exceptions, '건')],
    evidence: riders.map(r => record({ id: r.id, label: r.name, detail: `${seasonLabel(r.season)} ${r.label || `${r.run_no}회차`}`, status: r.io_kind === 'out' ? '하원' : '등원', fields: [field('요일', (r.weekdays || []).map(d => DAY[d] || d).join('·')), field('시각', r.at_time), field('정류장', r.stop), field('차량', r.vehicle)], facets: [`season:${r.season === 'vacation' ? 'vacation' : 'term'}`, `io:${r.io_kind === 'out' ? 'out' : 'in'}`] })),
    facetLabels: { 'season:term': '학기 노선', 'season:vacation': '방학 노선', 'io:in': '등원', 'io:out': '하원' }, recordSource: 'shuttle_riders',
    sourceLabel: '셔틀 노선 · 정기 탑승 · 운행 기록', coverageNote: '목록은 정기 탑승 배정입니다(노선 순). 승하차 기록이 없는 날을 미탑승으로 보지 않습니다.',
    sources: [{ table: 'shuttle_riders', rows: riders.length }, { table: 'shuttle_runs', rows: sh.runs }, { table: 'shuttle_trips', rows: sh.trips }, { table: 'shuttle_boardings', rows: sh.boardings }, { table: 'shuttle_ride_exceptions', rows: sh.exceptions }],
  });

  // 재고관리 — 자산(근거)·대여·실사·소모품.
  const assets = await sql`select a.id, a.asset_code, coalesce(c.label, a.category) category, a.maker, a.model, a.acquired_on::text acquired, a.status, a.location, a.holder_name, a.last_audited_on::text audited, a.disposed_on::text disposed, a.note from public.inventory_assets a left join public.inventory_categories c on c.key=a.category and c.tenant_id=${t} where a.tenant_id=${t} order by a.sort_order nulls last, a.asset_code`;
  const loans = await sql`select l.id, l.status, l.due_on::text due, l.due_note, l.lent_on::text lent, l.asset_id, coalesce(u.display_name, l.borrower_name) borrower from public.inventory_loans l left join public.users u on u.id=l.borrower_user_id and u.tenant_id=${t} where l.tenant_id=${t}`;
  const [inv] = await sql`select (select count(*)::int from public.inventory_audits where tenant_id=${t}) audits, (select max(audited_on)::text from public.inventory_audits where tenant_id=${t}) last_audit, (select count(*)::int from public.inventory_supplies where tenant_id=${t}) supplies, (select coalesce(sum(qty),0)::int from public.inventory_supplies where tenant_id=${t}) qty`;
  const overdueLoans = loans.filter(l => l.status === 'out' && l.due && l.due < asOf);
  const overdueAssets = new Set(overdueLoans.map(l => l.asset_id));
  // 지금 대여 중인 자산의 대여 — 대여자·대여일·반납 기한(기한 대신 적은 말 '상시' 등은 그대로) 칸. 같은 자산이 둘이면 기한 빠른 쪽.
  const outLoan = new Map(); for (const l of loans.filter(x => x.status === 'out').sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))) if (!outLoan.has(l.asset_id)) outLoan.set(l.asset_id, l);
  out.inventory = family('inventory', '재고관리(자산·대여·실사·소모품·업체)', {
    summary: `반납 기한 지난 대여 ${overdueLoans.length}건 · 소모품 ${inv.supplies}종 · 최종 실사 ${inv.last_audit ? md(inv.last_audit) : '기록 없음'}.`,
    metrics: [metric('전체 자산', assets.length, '대', '폐기·분실 포함'), ...Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => metric(`자산 ${v}`, assets.filter(a => a.status === k).length, '대')), metric('반납 전 대여', loans.filter(l => l.status === 'out').length, '건'), metric('반납 기한 지난 대여', overdueLoans.length, '건'), metric('실사 기록', inv.audits, '건', `최종 ${inv.last_audit ? md(inv.last_audit) : '기록 없음'}`), metric('소모품', inv.supplies, '종', `수량 합계 ${inv.qty}개`)],
    evidence: assets.map((a, i) => { const l = outLoan.get(a.id); return record({ id: a.id, label: a.asset_code, detail: unknownIfEmpty(a.model), date: a.audited, status: ASSET_STATUS_LABEL[a.status] ? assetStatusLabel(a.status) : '기타', fields: [field('No', i + 1), field('분류', a.category), field('제조사', unknownIfEmpty(a.maker)), field('입고일', unknownIfEmpty(a.acquired)), field('현위치', a.status === 'disposed' ? null : a.location), field('사용자', a.holder_name), field('폐기일', a.disposed), field('비고', a.note), ...filled([['대여자', l?.borrower], ['대여일', l?.lent ? md(l.lent) : null], ['반납 기한', l ? (l.due ? md(l.due) : l.due_note || '정하지 않음') : null]])], facets: [`status:${a.status}`, `category:${a.category}`, overdueAssets.has(a.id) && 'loan-overdue'] }); }),
    detailLabel: '모델명', dateLabel: '최종실사',
    facetLabels: { ...pre('status', ASSET_STATUS_LABEL), 'loan-overdue': '반납 기한 지남', ...Object.fromEntries([...new Set(assets.map(a => a.category))].map(c => [`category:${c}`, c])) }, recordSource: 'inventory_assets',
    signals: overdueLoans.length ? [signal({ id: 'inventory-loan-overdue', title: `반납 기한 지난 자산 대여 ${overdueLoans.length}건`, summary: `${overdueLoans.slice(0, 3).map(l => { const a = assets.find(x => x.id === l.asset_id); return `${a ? [a.category, a.asset_code].filter(Boolean).join(' ') : '자산'}(${md(l.due)}까지)`; }).join(', ')}${overdueLoans.length > 3 ? ` 외 ${overdueLoans.length - 3}건` : ''}. 아직 대여 중입니다.`, priority: PRIORITY.check, source: '재고관리 · 대여 기록', recordIds: [...overdueAssets], facet: 'loan-overdue', at: latest(overdueLoans.map(l => l.due)), draft: { title: '자산 반납 확인', body: '반납 예정일이 지난 대여 자산의 위치와 반납 일정을 확인해 주세요.' } })] : [],
    sourceLabel: '자산 · 대여 · 실사 · 소모품', coverageNote: '목록은 자산 전체입니다.',
    sources: [{ table: 'inventory_assets', rows: assets.length }, { table: 'inventory_loans', rows: loans.length }, { table: 'inventory_audits', rows: inv.audits }, { table: 'inventory_supplies', rows: inv.supplies }],
  });

  // 회의록 — 회의 기록(근거)·녹음·AI 분석. 녹음·전사 처리 상태도 여기서 본다.
  const meetings = await sql`select id, title, to_char(held_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, processing_status::text ps, audio_path is not null audio, case when jsonb_typeof(attendees)='array' then jsonb_array_length(attendees) end attendees, case when jsonb_typeof(ai_report->'actionItems')='array' then jsonb_array_length(ai_report->'actionItems') else 0 end actions from public.meeting_minutes where tenant_id=${t} and (held_at at time zone 'Asia/Seoul')::date <= ${asOf} order by held_at desc`;
  out.meetings = family('meetings', '회의록(녹음·AI 분석)', {
    summary: `분석 실패 ${meetings.filter(m => m.ps === 'failed').length}건 · AI가 뽑은 실행 항목 ${meetings.reduce((n, m) => n + m.actions, 0)}개.`,
    metrics: [metric('전체 회의록', meetings.length, '건'), metric('이번 달 회의', meetings.filter(m => m.d >= monthStart).length, '건'), metric('녹음 있는 회의', meetings.filter(m => m.audio).length, '건'), metric('AI 분석 완료', meetings.filter(m => m.ps === 'completed').length, '건'), metric('분석 실패', meetings.filter(m => m.ps === 'failed').length, '건'), metric('AI가 뽑은 실행 항목', meetings.reduce((n, m) => n + m.actions, 0), '개')],
    trend: monthlyTrend('월별 회의록', '건', Object.entries(Object.groupBy(meetings, m => m.d.slice(0, 7))).map(([k, rows]) => ({ month: k, value: rows.length })), asOf),
    evidence: meetings.map(m => record({ id: m.id, label: m.title || '제목 없음', date: m.d, status: PROCESS[m.ps] || '기타', fields: [field('참석', m.attendees ? `${m.attendees}명` : null), field('실행 항목', m.actions)], facets: [`process:${m.ps}`, m.audio && 'audio', m.d >= monthStart && 'this-month'] })),
    facetLabels: { ...pre('process', PROCESS), audio: '녹음 있음', 'this-month': '이번 달' }, recordSource: 'meeting_minutes',
    sourceLabel: '회의록 · 녹음 · AI 분석', coverageNote: '목록은 회의록 전체입니다(최근 순).',
    sources: [{ table: 'meeting_minutes', rows: meetings.length }],
  });

  // 전자결재 — 결재 문서(근거)와 결재선.
  // 문서 칸은 모든 양식에서 문서 제목, 휴가 신청자는 별도 칸에 둔다. 결재선은 '이름 역할 → …', 지금 차례는 대기 중 첫 칸.
  const docs = await sql`select d.id, d.title, d.form_type, d.status, to_char(d.submitted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, to_char(d.submitted_at at time zone 'UTC', ${ISO_AT}) submitted, u.display_name drafter,
      (select count(*)::int from public.approval_steps s where s.tenant_id=${t} and s.document_id=d.id) steps,
      (select count(*)::int from public.approval_steps s where s.tenant_id=${t} and s.document_id=d.id and s.decision='pending') waiting,
      (select string_agg(coalesce(a.display_name, '이름 없음') || ' ' || coalesce(s.role_label, '승인'), ' → ' order by s.step_no) from public.approval_steps s left join public.users a on a.id=s.approver_id and a.tenant_id=${t} where s.tenant_id=${t} and s.document_id=d.id) line,
      (select a.display_name from public.approval_steps s left join public.users a on a.id=s.approver_id and a.tenant_id=${t} where s.tenant_id=${t} and s.document_id=d.id and s.decision='pending' order by s.step_no limit 1) turn,
      l.leave_kind, l.start_date::text leave_from, l.end_date::text leave_to, l.days::float8 leave_days, l.reason leave_reason, lu.display_name applicant,
      coalesce(e.amount, i.amount)::float8 amount, coalesce(e.spend_date, i.income_date)::text money_date, coalesce(e.category, i.category) category
    from public.approval_documents d left join public.users u on u.id=d.drafter_id and u.tenant_id=${t}
      left join public.leave_forms l on l.document_id=d.id and l.tenant_id=${t} left join public.users lu on lu.id=l.user_id and lu.tenant_id=${t}
      left join public.approval_expense_forms e on e.document_id=d.id and e.tenant_id=${t} left join public.approval_income_forms i on i.document_id=d.id and i.tenant_id=${t}
    where d.tenant_id=${t} order by d.submitted_at desc nulls last`;
  const isLeave = d => d.form_type === 'leave' && d.leave_from;
  const turn = d => (d.status === 'pending' ? d.turn : null);
  const facets = d => [`status:${d.status}`, `form:${d.form_type}`];
  const docRecord = d => (isLeave(d)
    ? record({ id: d.id, label: d.title || '휴가 신청', date: d.d, status: APPROVAL[d.status] || '기타', facets: facets(d), fields: filled([['신청자', d.applicant || d.drafter], ['종류', `${LEAVE_KIND[d.leave_kind] || ''} 휴가`.trim()], ['기간', dayRange(d.leave_from, d.leave_to)], ['일수', dayCount(d.leave_days)], ['사유', plain(d.leave_reason)], ['결재 차례', turn(d)], ['결재선', d.line], ['기안', d.drafter && d.drafter !== d.applicant ? d.drafter : null]]) })
    : record({ id: d.id, label: d.title || '제목 없음', date: d.d, status: APPROVAL[d.status] || '기타', facets: facets(d), fields: filled([['종류', FORM[d.form_type] || '기타 양식'], ['기안', d.drafter], ['금액', won(d.amount)], [d.form_type === 'income' ? '수입일' : '지출일', d.money_date ? md(d.money_date) : null], ['분류', d.category], ['결재 차례', turn(d)], ['결재선', d.line]]) }));
  const docLine = d => (isLeave(d) ? `${d.applicant || d.drafter || '신청자 미상'} ${LEAVE_KIND[d.leave_kind] || '휴가'} ${dayRange(d.leave_from, d.leave_to)}(${dayCount(d.leave_days)})` : `${d.title || '제목 없음'}(기안 ${d.drafter || '미상'})`);
  const pending = docs.filter(d => d.status === 'pending');
  out.approvals = family('approvals', '전자결재(기안·결재함)', {
    summary: `반려 ${docs.filter(d => d.status === 'rejected').length}건 · 결정을 기다리는 결재 단계 ${docs.reduce((n, d) => n + d.waiting, 0)}개.`,
    metrics: [metric('결재 문서', docs.length, '건'), ...Object.entries(APPROVAL).map(([k, v]) => metric(v, docs.filter(d => d.status === k).length, '건')), metric('대기 중인 결재 단계', docs.reduce((n, d) => n + d.waiting, 0), '개')],
    evidence: docs.map(docRecord),
    facetLabels: { ...pre('status', APPROVAL), ...pre('form', FORM) }, recordSource: 'approval_documents',
    signals: pending.length ? [signal({ id: 'approval-pending', title: `결재 대기 문서 ${pending.length}건`, summary: scrub(`${pending.slice(0, 3).map(docLine).join(', ')}${pending.length > 3 ? ` 외 ${pending.length - 3}건` : ''}.`), priority: PRIORITY.decide, source: '전자결재 · 대기 문서', recordIds: pending.map(d => d.id), facet: 'status:pending', at: latest(pending.map(d => d.submitted)), draft: { title: '결재 문서 검토 및 보완', body: '결재 문서의 내용과 첨부 근거를 확인하고, 보완할 사항이 있으면 정리해서 알려 주세요.' } })] : [],
    sourceLabel: '전자결재 문서 · 결재선', coverageNote: '목록은 결재 문서 전체입니다(최근 상신 순).',
    sources: [{ table: 'approval_documents', rows: docs.length }, { table: 'approval_steps', rows: docs.reduce((n, d) => n + d.steps, 0) }],
  });

  // 데이터베이스(서식·문서) — 제목·폴더 경로·분류·날짜만. 열람 제한 문서는 표시만 하고 내용은 싣지 않는다.
  const { categoryLabelOf, categoryPathLabel } = await importV2('features/documents/categories.ts');
  const categories = (await sql`select key, label, parent_key from public.document_categories where tenant_id=${t}`).map(c => ({ key: c.key, label: c.label, parentKey: c.parent_key }));
  const files = await sql`select d.id, d.title, d.category, d.kind, d.form_type, coalesce(d.restricted,false) restricted, coalesce(d.pinned,false) pinned, to_char(d.updated_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.academy_documents d where d.tenant_id=${t} order by d.pinned desc, d.updated_at desc`;
  out.documents = family('documents', '데이터베이스(서식·문서 저장소)', {
    summary: '서식으로 쓴 문서와 올린 파일입니다. 열람 제한 문서는 제목만 보입니다.',
    metrics: [metric('문서', files.length, '건'), metric('서식으로 작성', files.filter(f => f.kind === 'form').length, '건'), metric('파일', files.filter(f => f.kind === 'file').length, '건'), metric('열람 제한', files.filter(f => f.restricted).length, '건'), ...Object.entries(DOC_FORM).map(([k, v]) => metric(v, files.filter(f => f.form_type === k).length, '건'))],
    evidence: files.map(f => record({ id: f.id, label: f.title, date: f.d, status: f.restricted ? '열람 제한' : '공개', detail: categoryLabelOf(categories, f.category), fields: [field('폴더', categoryPathLabel(categories, f.category)), field('종류', DOC_FORM[f.form_type] || (f.kind === 'file' ? '파일' : '서식'))], facets: [`kind:${f.kind}`, f.form_type && `form:${f.form_type}`, f.restricted && 'restricted', f.pinned && 'pinned'] })),
    facetLabels: { 'kind:form': '서식', 'kind:file': '파일', restricted: '열람 제한', pinned: '고정', ...pre('form', DOC_FORM) }, recordSource: 'academy_documents',
    sourceLabel: '서식 · 문서 저장소', coverageNote: '목록은 문서 전체입니다(고정 먼저 · 최근 수정 순).',
    sources: [{ table: 'academy_documents', rows: files.length }],
  });

  Object.assign(out, await opsFamilies2(ctx));
  return out;
}
