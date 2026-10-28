// 운영 영역 두 번째 묶음 — 캘린더·할 일·알림·슬랙·대시보드.
import { PRIORITY, addDays, family, field, metric, monthlyTrend, record, signal } from './domain-snapshot-core.mjs';

// live.js taskKind와 같은 라벨 = 2.0 staff_tasks 종류 원문(src/features/staff-tasks/kinds.ts). owner_review는 시안의 원장 개인 업무.
const TASK_KIND = { report_send_failed: '보고서 발송 실패', followup_due: '상담 후속조치', enrollment_followup: '콜&상담 후속 조치', progress_anomaly: '진도 기록 이상', attendance_absent_desk: '결석 확인 전화', video_upload_check: '영상 업로드 확인', video_unassigned: '미배정 영상', unsent_report: '미발송 수업 보고서', approval_turn: '전자결재 차례', withdrawal_step: '퇴원보고서', help_question: '도움말 질문', owner_review: '원장 개인 업무' };
// 2.0 TASK_STATE_LABEL 원문. 기한이 지났지만 열린 일은 2.0처럼 '늦음'(아래 overdue)으로 따로 표시한다.
const TASK_STATUS = { open: '처리 전', done: '처리됨', cancelled: '취소됨', expired: '기한 지남' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));

export async function opsFamilies2({ sql, t, asOf, month, monthStart }) {
  const out = {};
  // 캘린더 — 일정 전체(앞으로의 일정 먼저). 구글 캘린더에서 받은 일정 포함.
  const events = await sql`select e.id, e.title, e.start_date::text d, e.end_date::text e_d, to_char(e.start_time,'HH24:MI') st, g.name tag, e.google_event_id is not null google from public.calendar_events e left join public.calendar_tags g on g.id=e.tag_id and g.tenant_id=${t} where e.tenant_id=${t} order by (e.start_date >= ${asOf}) desc, case when e.start_date >= ${asOf} then e.start_date end asc, e.start_date desc`;
  const [tags] = await sql`select count(*)::int c from public.calendar_tags where tenant_id=${t}`;
  const in14 = addDays(asOf, 13);
  out.calendar = family('calendar', '캘린더', {
    summary: `일정 ${events.length}건, ${month} ${events.filter(e => e.d >= monthStart && e.d.slice(0, 7) === month).length}건, 앞으로 14일 ${events.filter(e => e.d >= asOf && e.d <= in14).length}건.`,
    metrics: [metric('일정', events.length, '건'), metric('이번 달 일정', events.filter(e => e.d.slice(0, 7) === month).length, '건'), metric('앞으로 14일', events.filter(e => e.d >= asOf && e.d <= in14).length, '건', `${asOf}~${in14}`), metric('구글 캘린더 일정', events.filter(e => e.google).length, '건'), metric('태그', tags.c, '개')],
    trend: monthlyTrend('월별 일정', '건', Object.entries(Object.groupBy(events.filter(e => e.d <= asOf), e => e.d.slice(0, 7))).map(([m, rows]) => ({ month: m, value: rows.length })), asOf),
    evidence: events.map(e => record({ id: e.id, label: e.title || '제목 없음', date: e.d, detail: [e.st, e.e_d && e.e_d !== e.d ? `~${e.e_d}` : ''].filter(Boolean).join(' '), status: e.d >= asOf ? '예정' : '지난 일정', fields: [field('태그', e.tag)], facets: [e.d >= asOf ? 'upcoming' : 'past', e.d >= asOf && e.d <= in14 && 'next-14', e.google && 'google', e.tag && `tag:${e.tag}`] })),
    facetOrder: ['next-14', 'upcoming', 'past', 'google', ...[...new Set(events.map(e => e.tag).filter(Boolean))].map(g => `tag:${g}`)], facetLabels: { 'next-14': '앞으로 14일', upcoming: '예정', past: '지난 일정', google: '구글 캘린더', ...Object.fromEntries([...new Set(events.map(e => e.tag).filter(Boolean))].map(g => [`tag:${g}`, g])) }, recordSource: 'calendar_events',
    sourceLabel: '일정 · 태그 · 구글 캘린더 동기화', coverageNote: '근거 목록은 일정 전체(앞으로의 일정 먼저)입니다. 일정 메모는 보여 주지 않습니다.',
    sources: [{ table: 'calendar_events', rows: events.length }, { table: 'calendar_tags', rows: tags.c }],
  });

  // 할 일·알림 — 할 일은 기록의 사실로 자동 생성·종료된다(버튼 완료 아님).
  const tasks = await sql`select k.id, k.title, k.kind, k.status, to_char(k.opened_at at time zone 'Asia/Seoul','YYYY-MM-DD') opened, to_char(k.due_at at time zone 'Asia/Seoul','YYYY-MM-DD') due, (select string_agg(u.display_name, ', ' order by u.display_name) from public.staff_task_assignees a join public.users u on u.id=a.user_id and u.tenant_id=${t} where a.tenant_id=${t} and a.task_id=k.id) owners from public.staff_tasks k where k.tenant_id=${t} order by (k.status='open') desc, k.due_at asc nulls last`;
  const [nt] = await sql`select count(*) filter (where (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf})::int month_n, count(*) filter (where read_at is null and archived_at is null)::int unread, count(*)::int rows_all, (select count(*)::int from public.push_subscriptions where tenant_id=${t}) push from public.notifications where tenant_id=${t}`;
  const overdue = tasks.filter(k => k.status === 'open' && k.due && k.due < asOf);
  out['tasks-notifications'] = family('tasks-notifications', '할 일·알림(벨·푸시)', {
    summary: `열린 할 일 ${tasks.filter(k => k.status === 'open').length}건 중 늦음 ${overdue.length}건. ${month} 알림 ${nt.month_n}건.`,
    metrics: [metric('열린 할 일', tasks.filter(k => k.status === 'open').length, '건', '처리 전 · 늦음'), metric('늦은 할 일', overdue.length, '건', '기한이 지났고 아직 처리 전'), metric('처리된 할 일', tasks.filter(k => k.status === 'done').length, '건', '원래 기록의 처리로 자동으로 닫힘'), metric('이번 달 알림', nt.month_n, '건', '받는 사람 기준 건수'), metric('읽지 않은 알림', nt.unread, '건', '보관함으로 옮긴 알림 제외'), metric('폰 알림 구독', nt.push, '대')],
    evidence: tasks.map(k => record({ id: k.id, label: k.title, date: k.due, detail: (TASK_KIND[k.kind] || '운영 업무') === k.title ? '' : TASK_KIND[k.kind] || '운영 업무', status: overdue.includes(k) ? '늦음' : TASK_STATUS[k.status] || '기타', fields: [field('담당', k.owners || '담당 미지정'), field('생성', k.opened)], facets: [`status:${k.status}`, `kind:${k.kind}`, overdue.includes(k) && 'overdue'] })),
    facetOrder: ['overdue', ...Object.keys(TASK_STATUS).map(s => `status:${s}`), ...Object.keys(TASK_KIND).map(k => `kind:${k}`)], facetLabels: { overdue: '늦음', ...pre('status', { ...TASK_STATUS, open: '열린 일' }), ...pre('kind', TASK_KIND) }, recordSource: 'staff_tasks',
    signals: overdue.length ? [signal({ id: 'tasks-overdue', title: `늦은 할 일 ${overdue.length}건`, summary: '기한이 지났는데 아직 처리 전인 할 일입니다. 원래 기록을 처리하면 자동으로 닫히므로, 처리가 늦게 반영된 일인지 담당자에게 먼저 확인합니다.', priority: PRIORITY.check, source: '할 일 · 기한·처리 상태', recordIds: overdue.map(k => k.id), draft: { title: '늦은 할 일 확인', body: '기한이 지난 아래 할 일이 지금 어떻게 되어 있는지, 언제까지 처리할 수 있는지 알려 주세요. 이미 처리한 일은 결과를 남겨 주세요.' } })] : [],
    sourceLabel: '할 일 · 알림', coverageNote: '근거 목록은 할 일 전체(열린 일 먼저)입니다. 알림은 받는 사람마다 따로 쌓이므로 건수로만 보여 주고 본문은 싣지 않습니다.',
    sources: [{ table: 'staff_tasks', rows: tasks.length }, { table: 'notifications', rows: nt.rows_all }],
  });

  // 슬랙 연동 — 규칙(근거)·연결 상태·발송 집계. 발송 본문과 채널 정보는 싣지 않는다.
  const rules = await sql`select id, name, enabled, source, timing from public.slack_rules where tenant_id=${t} order by sort_order nulls last, name`;
  const [sl] = await sql`select (select status from public.slack_connections where tenant_id=${t} limit 1) status, (select count(*)::int from public.slack_outbox where tenant_id=${t} and (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf}) month_sent, (select count(*)::int from public.slack_outbox where tenant_id=${t} and status <> 'sent') unsent, (select count(*)::int from public.slack_outbox where tenant_id=${t}) outbox, (select count(*)::int from public.slack_user_links where tenant_id=${t}) links, (select max(to_char(sent_at at time zone 'Asia/Seoul','YYYY-MM-DD')) from public.slack_outbox where tenant_id=${t}) last_sent`;
  out.slack = family('slack', '슬랙 연동', {
    summary: `슬랙 ${sl.status === 'active' ? '연결됨' : '연결 안 됨'} · 켜진 규칙 ${rules.filter(r => r.enabled).length}/${rules.length}. ${month} 전송 ${sl.month_sent}건.`,
    metrics: [metric('켜진 규칙', rules.filter(r => r.enabled).length, '개', `전체 ${rules.length}개`), metric('이번 달 전송', sl.month_sent, '건'), metric('전송 대기·실패', sl.unsent, '건'), metric('연결된 직원', sl.links, '명'), metric('전체 전송 기록', sl.outbox, '건', `마지막 ${sl.last_sent || '기록 없음'}`)],
    trend: monthlyTrend('월별 슬랙 전송', '건', await sql`select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM') as month, count(*)::int as value from public.slack_outbox where tenant_id=${t} group by 1`, asOf),
    evidence: rules.map(r => record({ id: r.id, label: r.name || '이름 없는 규칙', status: r.enabled ? '켜짐' : '꺼짐', detail: r.source === 'activity' ? '활동 기록' : '알림', fields: [field('보내는 때', r.timing === 'digest' ? '모아 보내기' : '즉시')], facets: [r.enabled ? 'enabled' : 'disabled', `source:${r.source}`] })),
    facetLabels: { enabled: '켜짐', disabled: '꺼짐', 'source:activity': '활동 기록', 'source:notification': '알림' }, recordSource: 'slack_rules',
    sourceLabel: '슬랙 연결 · 규칙 · 전송 기록', coverageNote: '근거 목록은 슬랙 규칙 전체입니다. 전송 본문·채널·사람 연결 정보는 보여 주지 않습니다.',
    sources: [{ table: 'slack_rules', rows: rules.length }, { table: 'slack_outbox', rows: sl.outbox }, { table: 'slack_user_links', rows: sl.links }],
  });

  // 대시보드(운영실) — 일일 브리핑 기록·학원 공지·역할별 배치 저장 여부.
  const briefings = await sql`select id, briefing_date::text d, processing_status, notified_at is not null notified from public.daily_briefings where tenant_id=${t} and briefing_date <= ${asOf} order by briefing_date desc`;
  const [db] = await sql`select (select count(*)::int from public.announcements where tenant_id=${t}) announcements, (select count(*)::int from public.student_daily_stats where tenant_id=${t}) daily, (select case when jsonb_typeof(data->'dashboard'->'layouts')='object' then (select count(*)::int from jsonb_object_keys(data->'dashboard'->'layouts')) else 0 end from public.tenant_settings where tenant_id=${t}) layouts`;
  out.dashboard = family('dashboard', '대시보드(운영실)', {
    summary: `일일 브리핑 ${briefings.length}건(마지막 ${briefings[0]?.d || '없음'}). 저장된 역할별 운영실 배치 ${db.layouts}개, 학원 공지 ${db.announcements}건.`,
    metrics: [metric('일일 브리핑', briefings.length, '건', `마지막 ${briefings[0]?.d || '기록 없음'}`), metric('알림까지 보낸 브리핑', briefings.filter(b => b.notified).length, '건'), metric('저장된 역할별 배치', db.layouts, '개', '없으면 기본 배치'), metric('학원 공지', db.announcements, '건'), metric('일별 원생 기록', db.daily, '일')],
    evidence: briefings.map(b => record({ id: b.id, label: `일일 브리핑 ${b.d}`, date: b.d, status: b.processing_status === 'completed' ? '생성 완료' : '생성 실패', fields: [field('알림', b.notified ? '보냄' : '보내지 않음')], facets: [b.notified ? 'notified' : 'not-notified'] })),
    facetLabels: { notified: '알림 보냄', 'not-notified': '알림 안 보냄' }, recordSource: 'daily_briefings',
    sourceLabel: '일일 브리핑 · 학원 공지 · 운영실 배치', coverageNote: `근거 목록은 일일 브리핑 기록 전체이며 브리핑 본문은 보여 주지 않습니다.${briefings[0] ? ` ${briefings[0].d} 이후 생성된 브리핑은 없습니다.` : ''}`,
    sources: [{ table: 'daily_briefings', rows: briefings.length }, { table: 'announcements', rows: db.announcements }, { table: 'student_daily_stats', rows: db.daily }],
  });
  return out;
}
