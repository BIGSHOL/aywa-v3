// 운영 영역 두 번째 묶음 — 캘린더·업무·알림·슬랙·대시보드.
import { PRIORITY, addDays, family, field, latest, md, metric, monthlyTrend, record, signal } from './domain-snapshot-core.mjs';
import { dashboardKpiCards } from './v2-dashboard-flow.mjs';
import { importV2 } from './v2-bridge.mjs';
import { closeEvidence } from './task-close-evidence.mjs';
import { OUTCOME as LEAD_OUTCOME } from './domain-snapshot-students.mjs';

// live.js taskKind와 같은 라벨 = 2.0 staff_tasks 종류 원문(src/features/staff-tasks/kinds.ts). owner_review는 시안의 원장 개인 업무.
const TASK_KIND = { report_send_failed: '보고서 발송 실패', followup_due: '상담 후속조치', enrollment_followup: '콜&상담 후속 조치', progress_anomaly: '진도 기록 이상', attendance_absent_desk: '결석 확인 전화', video_upload_check: '영상 업로드 확인', video_unassigned: '미배정 영상', unsent_report: '미발송 수업 보고서', approval_turn: '전자결재 차례', withdrawal_step: '퇴원보고서', help_question: '도움말 질문', owner_review: '원장 개인 업무' };
// 기한 지난 처리 전 = '지난 업무'(원장 10-29 확정 말) · 2.0 expired(기한이 지나 저절로 닫힘) = '만료됨' — 같은 이름 칩이 둘 생기지 않게.
const TASK_STATUS = { open: '처리 전', done: '처리됨', cancelled: '취소됨', expired: '만료됨' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));

export async function opsFamilies2({ sql, t, asOf, month, monthStart }) {
  const out = {};
  // 캘린더 — 일정 전체(앞으로의 일정 먼저). 구글 캘린더에서 받은 일정 포함.
  const events = await sql`select e.id, e.title, e.start_date::text d, e.end_date::text e_d, to_char(e.start_time,'HH24:MI') st, g.name tag, e.google_event_id is not null google from public.calendar_events e left join public.calendar_tags g on g.id=e.tag_id and g.tenant_id=${t} where e.tenant_id=${t} order by (e.start_date >= ${asOf}) desc, case when e.start_date >= ${asOf} then e.start_date end asc, e.start_date desc`;
  const [tags] = await sql`select count(*)::int c from public.calendar_tags where tenant_id=${t}`;
  const in14 = addDays(asOf, 13);
  out.calendar = family('calendar', '캘린더', {
    summary: `일정 태그 ${tags.c}개 · 구글 캘린더에서 받은 일정 포함.`,
    metrics: [metric('전체 일정', events.length, '건', '전체 기간'), metric('이번 달 일정', events.filter(e => e.d.slice(0, 7) === month).length, '건'), metric('앞으로 14일 일정', events.filter(e => e.d >= asOf && e.d <= in14).length, '건', `${md(asOf)}~${md(in14)}`), metric('구글 캘린더에서 받은 일정', events.filter(e => e.google).length, '건'), metric('일정 태그', tags.c, '개')],
    trend: monthlyTrend('월별 일정', '건', Object.entries(Object.groupBy(events.filter(e => e.d <= asOf), e => e.d.slice(0, 7))).map(([m, rows]) => ({ month: m, value: rows.length })), asOf),
    evidence: events.map(e => record({ id: e.id, label: e.title || '제목 없음', date: e.d, detail: [e.st, e.e_d && e.e_d !== e.d ? `~${e.e_d}` : ''].filter(Boolean).join(' '), status: e.d >= asOf ? '예정' : '지난 일정', fields: [field('태그', e.tag)], facets: [e.d >= asOf ? 'upcoming' : 'past', e.d >= asOf && e.d <= in14 && 'next-14', e.google && 'google', e.tag && `tag:${e.tag}`] })),
    facetOrder: ['next-14', 'upcoming', 'past', 'google', ...[...new Set(events.map(e => e.tag).filter(Boolean))].map(g => `tag:${g}`)], facetLabels: { 'next-14': '앞으로 14일', upcoming: '예정', past: '지난 일정', google: '구글 캘린더', ...Object.fromEntries([...new Set(events.map(e => e.tag).filter(Boolean))].map(g => [`tag:${g}`, g])) }, recordSource: 'calendar_events',
    sourceLabel: '일정 · 태그 · 구글 캘린더 동기화', coverageNote: '목록은 일정 전체입니다(앞으로의 일정 먼저).',
    sources: [{ table: 'calendar_events', rows: events.length }, { table: 'calendar_tags', rows: tags.c }],
  });

  // 업무·알림 — 업무는 기록의 사실로 자동 생성·종료된다(버튼 완료 아님).
  const tasks = await sql`select k.id, k.title, k.detail, k.kind, k.status, to_char(k.opened_at at time zone 'Asia/Seoul','YYYY-MM-DD') opened, to_char(k.due_at at time zone 'Asia/Seoul','YYYY-MM-DD') due, (select string_agg(u.display_name, ', ' order by u.display_name) from public.staff_task_assignees a join public.users u on u.id=a.user_id and u.tenant_id=${t} where a.tenant_id=${t} and a.task_id=k.id) owners, k.subject_id::text sid, k.cycle, k.close_reason, to_json(k.closed_at)#>>'{}' closed_at, k.closed_by::text closed_by, to_json(k.opened_at)#>>'{}' opened_at from public.staff_tasks k where k.tenant_id=${t} order by (k.status='open') desc, k.due_at asc nulls last`;
  const [nt] = await sql`select count(*) filter (where (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf})::int month_n, count(*) filter (where read_at is null and archived_at is null)::int unread, count(*)::int rows_all, (select count(*)::int from public.push_subscriptions where tenant_id=${t}) push from public.notifications where tenant_id=${t}`;
  const overdue = tasks.filter(k => k.status === 'open' && k.due && k.due < asOf);
  const { subjectName, evidenceOf } = await taskEvidence({ sql, t, tasks });
  out['tasks-notifications'] = family('tasks-notifications', '업무·알림(벨·푸시)', {
    summary: `읽지 않은 알림 ${nt.unread}건(보관함 제외) · 폰 알림 받는 기기 ${nt.push}대.`,
    metrics: [metric('남은 업무', tasks.filter(k => k.status === 'open').length, '건', '지난 업무 포함'), metric('지난 업무', overdue.length, '건', '기한이 지났고 아직 처리 전'), metric('완료된 업무', tasks.filter(k => k.status === 'done').length, '건', '원래 기록이 처리되면 저절로 닫힘'), metric('이번 달 알림', nt.month_n, '건', '받는 사람마다 셈'), metric('읽지 않은 알림', nt.unread, '건', '보관함으로 옮긴 알림 제외'), metric('폰 알림 받는 기기', nt.push, '대')],
    // 이름 칸 = 대상 원생(업무 제목·종류를 이름에 두 번 쓰지 않는다 — 원장 10-30 R4C-3) · 닫힌 업무는 상태 옆에 처리 근거 한 줄(task-close-evidence.mjs).
    evidence: tasks.map(k => { const who = subjectName.get(k.sid) || '', ev = evidenceOf(k), detail = who && String(k.detail || '').startsWith(`${who} · `) ? k.detail.slice(who.length + 3) : k.detail;
      return record({ id: k.id, label: who || k.title, date: k.due, status: overdue.includes(k) ? '지난 업무' : TASK_STATUS[k.status] || '기타', fields: [field('업무', TASK_KIND[k.kind] || k.title || '운영 업무'), field('처리 근거', ev?.line), field('내용', detail), field('담당', k.owners || '담당 미지정'), field('생성', k.opened)], facets: [`status:${k.status}`, `kind:${k.kind}`, overdue.includes(k) && 'overdue', ev?.missing && 'no-evidence'] }); }),
    facetOrder: ['overdue', ...Object.keys(TASK_STATUS).map(s => `status:${s}`), 'no-evidence', ...Object.keys(TASK_KIND).map(k => `kind:${k}`)], facetLabels: { overdue: '지난 업무', 'no-evidence': '처리됨 · 근거 기록 없음',...pre('status', { ...TASK_STATUS, open: '남은 업무' }), ...pre('kind', TASK_KIND) }, recordSource: 'staff_tasks',
    signals: overdue.length ? [signal({ id: 'tasks-overdue', title: `지난 업무 ${overdue.length}건`, summary: `종류별: ${Object.entries(Object.groupBy(overdue, k => TASK_KIND[k.kind] || '운영 업무')).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(' · ')}. 원래 기록이 처리되면 저절로 닫힙니다.`, priority: PRIORITY.check, source: '업무 · 기한·처리 상태', recordIds: overdue.map(k => k.id), facet: 'overdue', at: latest(overdue.map(k => k.due)), draft: { title: '지난 업무 확인', body: '기한이 지난 아래 업무가 지금 어떻게 되어 있는지, 언제까지 처리할 수 있는지 알려 주세요. 이미 처리한 업무는 결과를 남겨 주세요.' } })] : [],
    sourceLabel: '업무 · 알림', coverageNote: '목록은 업무 전체입니다(남은 업무 먼저 · 기한 빠른 순). 알림은 건수만 셉니다.',
    sources: [{ table: 'staff_tasks', rows: tasks.length }, { table: 'notifications', rows: nt.rows_all }],
  });

  // 슬랙 연동 — 규칙(근거)·연결 상태·발송 집계. 발송 본문과 채널 정보는 싣지 않는다.
  const rules = await sql`select id, name, enabled, source, timing from public.slack_rules where tenant_id=${t} order by sort_order nulls last, name`;
  const [sl] = await sql`select (select status from public.slack_connections where tenant_id=${t} limit 1) status, (select count(*)::int from public.slack_outbox where tenant_id=${t} and (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf}) month_sent, (select count(*)::int from public.slack_outbox where tenant_id=${t} and status <> 'sent') unsent, (select count(*)::int from public.slack_outbox where tenant_id=${t}) outbox, (select count(*)::int from public.slack_user_links where tenant_id=${t}) links, (select max(to_char(sent_at at time zone 'Asia/Seoul','YYYY-MM-DD')) from public.slack_outbox where tenant_id=${t}) last_sent`;
  out.slack = family('slack', '슬랙 연동', {
    summary: `슬랙 ${sl.status === 'active' ? '연결됨' : '연결 안 됨'} · 최종 전송 ${sl.last_sent ? md(sl.last_sent) : '기록 없음'}.`,
    metrics: [metric('켜진 규칙', rules.filter(r => r.enabled).length, '개', `전체 ${rules.length}개`), metric('이번 달 슬랙 전송', sl.month_sent, '건'), metric('전송 대기·실패', sl.unsent, '건'), metric('슬랙에 연결된 직원', sl.links, '명'), metric('전체 전송 기록', sl.outbox, '건')],
    trend: monthlyTrend('월별 슬랙 전송', '건', await sql`select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM') as month, count(*)::int as value from public.slack_outbox where tenant_id=${t} group by 1`, asOf),
    evidence: rules.map(r => record({ id: r.id, label: r.name || '이름 없는 규칙', status: r.enabled ? '켜짐' : '꺼짐', detail: r.source === 'activity' ? '활동 기록' : '알림', fields: [field('보내는 때', r.timing === 'digest' ? '모아 보내기' : '즉시')], facets: [r.enabled ? 'enabled' : 'disabled', `source:${r.source}`] })),
    facetLabels: { enabled: '켜짐', disabled: '꺼짐', 'source:activity': '활동 기록', 'source:notification': '알림' }, recordSource: 'slack_rules',
    sourceLabel: '슬랙 연결 · 규칙 · 전송 기록', coverageNote: '목록은 슬랙 규칙 전체입니다.',
    sources: [{ table: 'slack_rules', rows: rules.length }, { table: 'slack_outbox', rows: sl.outbox }, { table: 'slack_user_links', rows: sl.links }],
  });

  // 대시보드(운영실) — 일일 브리핑 기록·학원 공지·역할별 배치 저장 여부.
  const briefings = await sql`select id, briefing_date::text d, processing_status, notified_at is not null notified, left(coalesce(nullif(narrative, ''), team_report->>'headline', ''), 300) narrative, left(coalesce(processing_error, ''), 120) failure from public.daily_briefings where tenant_id=${t} and briefing_date <= ${asOf} order by briefing_date desc`;
  const [db] = await sql`select (select count(*)::int from public.announcements where tenant_id=${t}) announcements, (select count(*)::int from public.student_daily_stats where tenant_id=${t}) daily, (select case when jsonb_typeof(data->'dashboard'->'layouts')='object' then (select count(*)::int from jsonb_object_keys(data->'dashboard'->'layouts')) else 0 end from public.tenant_settings where tenant_id=${t}) layouts`;
  // KPI = 2.0 운영실 상단 칸 9개를 흐름(추세) 카드로(원장 10-28 "기존 2.0 kpi들을 전부 흐름으로") — 업무 영역 metrics(kind 'kpi') · 몇 칸을 어디에 보일지는 화면이 정한다.
  // 카드마다 id = 확장 추세 지표 id(trend-metrics.mjs). 묶음마다 저장점이라 DB 오류도 그 카드만 빠진다 · 하나도 못 세면 종전 숫자 칸으로(실패는 로그로).
  let dashKpis = [];
  try { dashKpis = await dashboardKpiCards({ sql, asOf, tenantId: t, importV2 }); } catch (e) { console.error(`workspaces.dashboard KPI: ${e.message}`); }
  out.dashboard = family('dashboard', '대시보드(운영실)', {
    summary: !briefings[0] ? '일일 브리핑 기록이 없습니다.' : briefings[0].d < asOf ? `일일 브리핑은 ${md(briefings[0].d)} 이후 만들어지지 않았습니다.` : `일일 브리핑은 ${md(asOf)}까지 있습니다.`,
    metrics: dashKpis.length ? dashKpis : [metric('전체 일일 브리핑', briefings.length, '건'), metric('알림까지 보낸 브리핑', briefings.filter(b => b.notified).length, '건'), metric('저장된 역할별 배치', db.layouts, '개', '없으면 기본 배치'), metric('학원 공지', db.announcements, '건'), metric('일별 원생 기록', db.daily, '일')],
    evidence: briefings.map(b => record({ id: b.id, label: '일일 브리핑', date: b.d, status: b.processing_status === 'completed' ? '생성 완료' : '생성 실패', fields: [field('요약', (b.processing_status === 'completed' ? (String(b.narrative).split(/(?<=[.!?。])\s|[\r\n]/)[0] || '내용 없음') : '생성 실패').slice(0, 70)), field('알림', b.notified ? '발송' : '미발송')], facets: [b.notified ? 'notified' : 'not-notified'] })),
    facetLabels: { notified: '알림 발송', 'not-notified': '알림 미발송' }, recordSource: 'daily_briefings',
    sourceLabel: '일일 브리핑 · 학원 공지 · 운영실 배치', coverageNote: '목록은 일일 브리핑입니다(최근 순).',
    sources: [{ table: 'daily_briefings', rows: briefings.length }, { table: 'announcements', rows: db.announcements }, { table: 'student_daily_stats', rows: db.daily }],
  });
  return out;
}

// 업무의 대상 원생 이름과 닫힌 업무의 근거 기록(O 조사 task-close-evidence-1030.md) — 근거 표마다 한 번씩만 읽는다.
// 대상 = subject_id가 가리키는 원생(원생 · 수업보고서 · 숙제 영상 · 콜&상담 · 퇴원보고서). 근거 = 업무 종류마다 그 일을 실제로 한 기록.
async function taskEvidence({ sql, t, tasks }) {
  const sids = [...new Set(tasks.map(k => k.sid).filter(Boolean))];
  const named = sids.length ? await sql`select x.sid, coalesce(s.name, ls.name, vs.name, e.prospect_name, ws.name) as name from unnest(${sids}::text[]) as x(sid)
    left join public.students s on s.tenant_id=${t} and s.id::text=x.sid
    left join public.lesson_reports l on l.tenant_id=${t} and l.id::text=x.sid left join public.students ls on ls.tenant_id=${t} and ls.id=l.student_id
    left join public.student_homework_videos v on v.tenant_id=${t} and v.id::text=x.sid left join public.students vs on vs.tenant_id=${t} and vs.id=v.student_id
    left join public.enrollment_consultations e on e.tenant_id=${t} and e.id::text=x.sid
    left join public.withdrawal_reports w on w.tenant_id=${t} and w.id::text=x.sid left join public.students ws on ws.tenant_id=${t} and ws.id=w.student_id` : [];
  const subjectName = new Map(named.filter(r => r.name).map(r => [r.sid, r.name]));
  const done = tasks.filter(k => k.status === 'done' && k.sid), ids = kind => [...new Set(done.filter(k => k.kind === kind).map(k => k.sid))];
  const none = Promise.resolve([]);
  const [people, desk, videos, leads, steps, uploads, queue, report] = await Promise.all([
    sql`select id::text id, display_name from public.users where tenant_id=${t}`,
    ids('attendance_absent_desk').length ? sql`select student_id::text sid, session_date::text d, outcome, contacted_via, handled_by::text actor, to_json(handled_at)#>>'{}' ts from public.attendance_followups where tenant_id=${t} and student_id::text = any(${ids('attendance_absent_desk')}) and signal='absent' and state='resolved' order by handled_at` : none,
    ids('video_unassigned').length ? sql`select video_id::text sid, homework_date::text d, excluded, updated_by::text actor, to_json(updated_at)#>>'{}' ts from public.homework_video_assignments where tenant_id=${t} and video_id::text = any(${ids('video_unassigned')})` : none,
    ids('enrollment_followup').length ? sql`select id::text sid, outcome from public.enrollment_consultations where tenant_id=${t} and id::text = any(${ids('enrollment_followup')})` : none,
    ids('withdrawal_step').length ? sql`select report_id::text sid, actor_id::text actor, action, to_json(created_at)#>>'{}' ts from public.withdrawal_report_events where tenant_id=${t} and report_id::text = any(${ids('withdrawal_step')}) and action in ('submit','approve','reject','cancel') order by created_at` : none,
    ids('video_upload_check').length ? sql`select student_id::text sid, to_json(uploaded_at)#>>'{}' ts from public.student_homework_videos where tenant_id=${t} and student_id::text = any(${ids('video_upload_check')}) and uploaded_at is not null` : none,
    importV2('features/attendance/live/queue.ts'), importV2('features/withdrawal-reports/model.ts'),
  ]);
  const names = new Map(people.map(p => [p.id, p.display_name]));
  const outcomes = queue.OUTCOME_LABEL, actions = report.REPORT_ACTION_LABEL || {};
  const outcomeOf = v => (Array.isArray(outcomes) ? outcomes.find(o => o.value === v)?.label : outcomes?.[v]) || '기타';
  const ms = v => (v ? Date.parse(v) : NaN), dayOf = k => String(k.cycle || '').split('|')[0];
  // 업무가 닫힌 순간까지(10분 여유)의 기록만 근거로 — 닫힌 뒤에 생긴 기록을 원인처럼 쓰지 않는다.
  const before = (k, at) => !Number.isFinite(ms(k.closed_at)) || !Number.isFinite(ms(at)) || ms(at) <= ms(k.closed_at) + 600000;
  const find = {
    attendance_absent_desk: k => { const f = desk.filter(r => r.sid === k.sid && r.d === dayOf(k) && before(k, r.ts)).at(-1); return f && { what: `출석부에 ${f.contacted_via === 'phone' ? '전화 ' : ''}확인 결과 ‘${outcomeOf(f.outcome)}’ 기록`, by: f.actor, at: f.ts }; },
    video_unassigned: k => { const a = videos.find(r => r.sid === k.sid); return a && { what: a.excluded ? '숙제 아님으로 제외' : a.d ? `${md(a.d)} 숙제에 영상 연결` : '숙제에 영상 연결', by: a.actor, at: a.ts }; },
    enrollment_followup: k => { const l = leads.find(r => r.sid === k.sid); return l && LEAD_OUTCOME[l.outcome] ? { what: `콜&상담 결과 ‘${LEAD_OUTCOME[l.outcome]}’` } : null; },
    withdrawal_step: k => { const e = steps.filter(r => r.sid === k.sid && before(k, r.ts)).at(-1); const act = actions[e?.action] || '처리'; return e && { what: act.startsWith('보고서') ? `퇴원${act}` : `퇴원보고서 ${act}`, by: e.actor, at: e.ts }; },
    video_upload_check: k => { const u = uploads.filter(r => r.sid === k.sid && before(k, r.ts) && (!Number.isFinite(ms(k.opened_at)) || ms(r.ts) >= ms(k.opened_at))).sort((a, b) => ms(a.ts) - ms(b.ts)).at(-1); return u && { what: '숙제 영상이 올라옴', at: u.ts }; },
  };
  const evidenceOf = k => closeEvidence({ status: k.status, close_reason: k.close_reason, closed_at: k.closed_at, closed_by: k.closed_by }, k.status === 'done' ? find[k.kind]?.(k) || null : null, names);
  return { subjectName, evidenceOf };
}
