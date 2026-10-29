// 원생 영역 두 번째 묶음 — 이탈 방어·신규생 관리·퇴원관리·퇴원보고서.
import { ISO_AT, PRIORITY, family, field, latest, metric, monthlyTrend, record, signal } from './domain-snapshot-core.mjs';

// src/features/withdrawals/types.ts REASON_LABEL·REASON_ALIAS와 같은 표(verify-domain-snapshot.mjs가 원본과 대조).
export const REASON_LABEL = { dissatisfaction: '수업·강사', grades: '성적', motivation: '원생 상태', method: '공부 방법 변경', competitor: '타 학원으로 이동', schedule: '시간/일정', financial: '경제적 이유', career: '진로·진학', peers: '가족·친구', illness: '질병', advised: '권고퇴원', relocation: '이사', graduated: '졸업', other: '기타' };
const REASON_ALIAS = { dissatisfied: 'dissatisfaction', unsatisfied: 'dissatisfaction', moved: 'relocation', graduate: 'graduated', cost: 'financial', money: 'financial' };
export const normalizeReason = raw => !raw ? null : raw in REASON_LABEL ? raw : REASON_ALIAS[raw] ?? 'other';
// src/features/withdrawals/system-bulk.ts — 수업 기록 없는 장부 정리 퇴원은 어디서도 세지 않는다.
export const SYSTEM_BULK_WITHDRAWAL_DATES = ['2026-07-10', '2026-07-03'];
const isCleanupMemo = memo => !!memo?.trim() && (memo.trim() === '데이터 정리 일괄 퇴원' || memo.trim().startsWith('수강 반 없음 일괄 퇴원 처리'));
export const isBookkeepingOnlyExit = (reason, memo, hasHistory) => { const key = normalizeReason(reason); return !hasHistory && !(key && key !== 'other') && isCleanupMemo(memo); };
const REPORT_STATUS = { requested: '작성 요청', revision: '반려 · 수정 요청', manager_pending: '관리자 승인 대기', director_pending: '원장 승인 대기', scheduled: '처리 예약', completed: '처리 완료' };
// src/features/retention/components/campaign-board.tsx COLUMNS와 같은 라벨.
const CAMPAIGN = { pending: '대상', contacted: '연락함', enrolled: '재등록 완료', declined: '이탈' };
const BUCKETS = [['d7', '0~7일', 7], ['d30', '8~30일', 30], ['d60', '31~60일', 60], ['d90', '61~90일', 90]];
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export async function lifecycleFamilies({ sql, t, asOf, month, monthStart, students, subjectLabel }) {
  const out = {};
  // 이탈 방어 — 2.0 화면은 출결·성적·상담·수납에서 위험도를 그 자리에서 계산한다. 저장된 것은 재등록 대상뿐.
  const targets = await sql`select r.id, s.name, r.status, to_char(r.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from public.reenrollment_campaign_targets r join public.students s on s.id=r.student_id and s.tenant_id=${t} where r.tenant_id=${t} and not coalesce(s.is_test,false) order by r.created_at desc`;
  const rt = { c: targets.length };
  out.retention = family('retention', '이탈 방어', {
    summary: rt.c ? `저장된 재등록 캠페인 대상 ${rt.c}명.` : '저장된 재등록 캠페인 대상이 없습니다.',
    metrics: [metric('재등록 캠페인 대상', rt.c, '명')], sourceLabel: '재등록 캠페인 대상', recordSource: 'reenrollment_campaign_targets',
    evidence: targets.map(r => record({ id: r.id, label: r.name, date: r.d, status: CAMPAIGN[r.status] || '대상', facets: [r.status && `status:${r.status}`] })),
    facetLabels: Object.fromEntries(Object.entries(CAMPAIGN).map(([k, v]) => [`status:${k}`, v])),
    coverageNote: '이탈 위험 점수는 저장되지 않아 재등록 캠페인 대상만 셉니다.',
    sources: [{ table: 'reenrollment_campaign_targets', rows: rt.c }],
  });

  // 신규생 관리 — 등록일부터 90일 창(7·30·60·90일), 체크리스트 완료 기록.
  const checks = await sql`select student_id, count(*) filter (where done_on is not null)::int done, count(*)::int rows_all from public.student_onboarding_checks where tenant_id=${t} group by 1`;
  const doneBy = new Map(checks.map(c => [c.student_id, c.done]));
  const newcomers = students.filter(s => s.st === 'enrolled' && s.enrolled && s.enrolled <= asOf && days(s.enrolled, asOf) <= 90).map(s => ({ ...s, elapsed: days(s.enrolled, asOf) }));
  const bucketOf = n => BUCKETS.find(([, , max]) => n <= max) || BUCKETS.at(-1);
  out.newcomers = family('newcomers', '신규생 관리(90일 체크리스트)', {
    summary: `체크리스트 기록 ${checks.reduce((n, c) => n + c.rows_all, 0)}건 중 완료 ${checks.reduce((n, c) => n + c.done, 0)}건.`,
    metrics: [metric('90일 안 신규생', newcomers.length, '명', '재원 · 등록일 기준'), ...BUCKETS.map(([, label, max], i) => metric(`등록 후 ${label}`, newcomers.filter(s => s.elapsed <= max && s.elapsed > (BUCKETS[i - 1]?.[2] ?? -1)).length, '명')), metric('체크 완료 기록', checks.reduce((n, c) => n + c.done, 0), '건', `체크 기록 ${checks.reduce((n, c) => n + c.rows_all, 0)}건`)],
    evidence: newcomers.sort((a, b) => b.enrolled.localeCompare(a.enrolled)).map(s => record({ id: s.id, label: s.name, date: s.enrolled, detail: [s.school, s.grade].filter(Boolean).join(' '), status: `등록 후 ${s.elapsed}일`, fields: [field('완료한 체크', doneBy.get(s.id) || 0)], facets: [`bucket:${bucketOf(s.elapsed)[0]}`, doneBy.get(s.id) ? 'has-checks' : 'no-checks'] })),
    facetOrder: [...BUCKETS.map(([id]) => `bucket:${id}`), 'has-checks', 'no-checks'], facetLabels: { ...Object.fromEntries(BUCKETS.map(([id, label]) => [`bucket:${id}`, `등록 후 ${label}`])), 'has-checks': '완료한 체크 있음', 'no-checks': '완료한 체크 없음' }, recordSource: 'students',
    sourceLabel: '원생 등록일 · 신규생 체크리스트', coverageNote: '목록은 등록 후 90일 안의 재원생입니다(최근 등록 순). 체크 항목은 기한 지남을 따지지 않고 완료만 셉니다.',
    sources: [{ table: 'students', rows: newcomers.length }, { table: 'student_onboarding_checks', rows: checks.reduce((n, c) => n + c.rows_all, 0) }],
  });

  // 퇴원관리 — 원생 상태 퇴원. 장부 정리(수업 기록 없음)는 빼고, 날짜 미상 시스템 정리는 따로 표시.
  const rows = await sql`select s.id, s.name, s.withdrawn_at::text d, s.withdrawal_metadata->>'reason' reason, s.withdrawal_metadata->>'memo' memo, exists(select 1 from public.enrollments e where e.tenant_id=${t} and e.student_id=s.id) hist from public.students s where s.tenant_id=${t} and s.status='withdrawn' and not coalesce(s.is_test,false) order by s.withdrawn_at desc nulls last`;
  const exits = rows.filter(r => !isBookkeepingOnlyExit(r.reason, r.memo, r.hist)).map(r => ({ ...r, key: normalizeReason(r.reason), bulk: SYSTEM_BULK_WITHDRAWAL_DATES.includes(r.d) && !r.hist }));
  const [ex] = await sql`select (select count(*)::int from public.students where tenant_id=${t} and withdrawn_at > ${asOf} and status <> 'withdrawn' and not coalesce(is_test,false)) scheduled, (select count(*)::int from public.enrollments e where e.tenant_id=${t} and e.end_date between ${monthStart} and ${asOf} and not coalesce(e.is_transferred,false) and e.student_id not in (select id from public.students where tenant_id=${t} and coalesce(is_test,false))) ended`;
  const year = `${asOf.slice(0, 4)}-01-01`, dated = exits.filter(r => r.d && !r.bulk && r.d <= asOf);
  out.withdrawals = family('withdrawals', '퇴원관리', {
    summary: `이번 달 끝난 수강 ${ex.ended}건(반 이동 제외 · 다른 반을 계속 다녀도 셈).`,
    metrics: [metric('올해 퇴원', dated.filter(r => r.d >= year).length, '명', '퇴원일 기준 · 장부 정리 제외'), metric('이번 달 퇴원', dated.filter(r => r.d >= monthStart).length, '명'), metric('퇴원 예약', ex.scheduled, '명', '퇴원일이 기준일 이후 · 그날까지 재원'), metric('날짜 미상 시스템 정리 퇴원', exits.filter(r => r.bulk).length, '명'), metric('이번 달 끝난 수강', ex.ended, '건', '반 이동 제외 · 다른 반을 계속 다녀도 셈')],
    trend: monthlyTrend('월별 퇴원', '명', Object.entries(Object.groupBy(dated, r => r.d.slice(0, 7))).map(([m, list]) => ({ month: m, value: list.length })), asOf),
    evidence: exits.map(r => record({ id: r.id, label: r.name, date: r.bulk ? '' : r.d, status: r.bulk ? '시스템 정리(날짜 미상)' : (r.key ? REASON_LABEL[r.key] : '사유 미기재'), fields: [field('퇴원일', r.bulk ? '날짜 미상' : r.d)], facets: [`reason:${r.key || 'none'}`, r.bulk ? 'system-bulk' : r.d >= year && 'this-year', r.d >= monthStart && !r.bulk && 'this-month'] })),
    facetOrder: ['this-month', 'this-year', ...Object.keys(REASON_LABEL).map(k => `reason:${k}`), 'reason:none', 'system-bulk'], facetLabels: { 'this-month': '이번 달', 'this-year': '올해', ...Object.fromEntries(Object.entries(REASON_LABEL).map(([k, v]) => [`reason:${k}`, v])), 'reason:none': '사유 미기재', 'system-bulk': '시스템 정리(날짜 미상)' }, recordSource: 'students',
    sourceLabel: '원생 퇴원 기록 · 수강 종료', coverageNote: `목록은 퇴원한 원생입니다(최근 순). 수업 기록 없는 장부 정리 퇴원 ${rows.length - exits.length}명은 뺐습니다.`,
    sources: [{ table: 'students', rows: rows.length }],
  });

  // 퇴원보고서 — 진행 중 보고서와 옛 시트 보관본.
  // at = 보고서가 마지막으로 바뀐 시각(승인 차례로 넘어온 때 — 따로 남는 제출 시각이 없다).
  const reports = await sql`select r.id, s.name, r.status, r.exit_kind, r.effective_date::text d, array_to_string(r.subjects, ',') subjects, u.display_name teacher, to_char(r.updated_at at time zone 'UTC', ${ISO_AT}) at from public.withdrawal_reports r join public.students s on s.id=r.student_id and s.tenant_id=${t} left join public.users u on u.id=r.teacher_id and u.tenant_id=${t} where r.tenant_id=${t} order by r.created_at desc`;
  const archives = await sql`select id, student_name, subject, exit_date::text d, mapping_kind from public.withdrawal_report_archives where tenant_id=${t} order by exit_date desc nulls last`;
  const pending = reports.filter(r => ['manager_pending', 'director_pending'].includes(r.status));
  const MAP = { auto: '자동 연결', manual: '직접 연결', unmapped: '연결 안 됨' };
  out['withdrawal-reports'] = family('withdrawal-reports', '퇴원보고서(작성·순차 승인·옛 시트)', {
    summary: '퇴원보고서 진행 상황과 예전 스프레드시트 퇴원 기록입니다.',
    metrics: [metric('진행 중 퇴원보고서', reports.filter(r => r.status !== 'completed').length, '건'), metric('승인 대기', pending.length, '건'), metric('처리 완료', reports.filter(r => r.status === 'completed').length, '건'), metric('옛 시트 보관', archives.length, '건', `원생 연결 안 됨 ${archives.filter(a => a.mapping_kind === 'unmapped').length}건`)],
    evidence: [...reports.map(r => record({ id: r.id, label: r.name, date: r.d, status: REPORT_STATUS[r.status] || '기타', detail: r.exit_kind === 'subject_end' ? '과목 수강 종료' : '퇴원', fields: [field('과목', r.subjects ? r.subjects.split(',').map(subjectLabel).join(', ') : null), field('담임', r.teacher)], facets: ['kind:report', `status:${r.status}`, pending.includes(r) && 'approval-pending'] })),
      ...archives.map(a => record({ id: a.id, label: a.student_name, date: a.d, status: '스프레드시트 기록', detail: MAP[a.mapping_kind] || '', fields: [field('과목', a.subject ? subjectLabel(a.subject) : null)], facets: ['kind:archive', `map:${a.mapping_kind}`] }))],
    facetLabels: { 'kind:report': '퇴원보고서', 'kind:archive': '옛 시트', 'approval-pending': '승인 대기(관리자·원장)', ...Object.fromEntries(Object.entries(REPORT_STATUS).map(([k, v]) => [`status:${k}`, v])), ...Object.fromEntries(Object.entries(MAP).map(([k, v]) => [`map:${k}`, v])) }, recordSource: 'withdrawal_reports,withdrawal_report_archives', detailLabel: '구분', dateLabel: '퇴원일',
    signals: pending.length ? [signal({ id: 'withdrawal-report-pending', title: `퇴원보고서 승인 대기 ${pending.length}건`, summary: `${pending.slice(0, 3).map(r => `${r.name}(${REPORT_STATUS[r.status]})`).join(', ')}${pending.length > 3 ? ` 외 ${pending.length - 3}건` : ''}.`, priority: PRIORITY.decide, source: '퇴원보고서 상태', recordIds: pending.map(r => r.id), facet: 'approval-pending', at: latest(pending.map(r => r.at)), draft: { title: '퇴원보고서 승인 검토', body: '승인을 기다리는 퇴원보고서의 내용과 수강 상태를 확인하고 승인 여부를 정해 주세요.' } })] : [],
    sourceLabel: '퇴원보고서 · 옛 시트 보관', coverageNote: '목록은 퇴원보고서(최근 순) 다음에 옛 스프레드시트 기록입니다.',
    sources: [{ table: 'withdrawal_reports', rows: reports.length }, { table: 'withdrawal_report_archives', rows: archives.length }],
  });
  return out;
}
