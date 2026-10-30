// 2.0 업무가 닫힌 근거 기록을 업무 ID로 읽는다. 업무 흐름과 작업 공간 '업무·알림'이 같은 사실을 사용한다.
// 문장 속 완료자·시각·근거 없음 판정은 task-close-evidence.mjs의 closeEvidence가 공통으로 맡는다.
export async function loadTaskCloseRecords({ sql, t, asOf, attendanceOutcomeLabel }) {
  const day = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.slice(0, 4) === String(asOf).slice(0, 4) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d : '';
  const records = new Map();
  const desk = await sql`select k.id::text task_id, f.state, f.outcome, f.handled_by::text handled_by, f.handled_at, f.contacted_via, a.id::text attendance_id
    from public.staff_tasks k join public.attendance_followups f on f.tenant_id=k.tenant_id and f.student_id=k.subject_id
      and f.session_date::text=split_part(k.cycle, '|', 1) and f.signal='absent' and f.state in ('resolved','dismissed')
    left join lateral (select id from public.attendance_records a where a.tenant_id=k.tenant_id and a.student_id=k.subject_id
      and a.class_id=f.class_id and a.session_date=f.session_date and (a.slot_start=f.slot_start or a.slot_start is null and f.slot_start is null)
      order by a.recorded_at desc limit 1) a on true
    where k.tenant_id=${t} and k.kind='attendance_absent_desk' and k.status='done' and k.close_reason='desk_settled'
      and (split_part(k.cycle, '|', 2)='' or f.slot_start is null or to_char(f.slot_start, 'HH24:MI')=split_part(k.cycle, '|', 2))`;
  for (const row of desk) {
    const previous = records.get(row.task_id);
    if (previous && new Date(previous.at).getTime() > new Date(row.handled_at).getTime()) continue;
    const result = row.state === 'dismissed' ? '확인 불필요' : attendanceOutcomeLabel[row.outcome] || '연락 결과';
    const via = { phone: '전화', kakao: '카카오톡', in_person: '직접' }[row.contacted_via] || '';
    records.set(row.task_id, { what: `출석부에 ${via ? `${via} ` : ''}확인 결과 ‘${result}’ 기록`, by: row.handled_by, at: row.handled_at,
      open: row.attendance_id ? `#v2-record-open?family=attendance&id=${row.attendance_id}` : `#v2-record-open?family=tasks-notifications&id=${row.task_id}` });
  }
  const videos = await sql`select k.id::text task_id, a.video_id::text video_id, a.homework_date::text homework_date, a.excluded,
    a.updated_by::text updated_by, a.updated_at from public.staff_tasks k
    join public.homework_video_assignments a on a.tenant_id=k.tenant_id and a.video_id=k.subject_id
    where k.tenant_id=${t} and k.kind='video_unassigned' and k.status='done'`;
  for (const row of videos) records.set(row.task_id, { what: row.excluded ? '숙제 아님으로 제외' : `${day(row.homework_date)} 숙제에 영상 연결`,
    by: row.updated_by, at: row.updated_at, open: `#v2-record-open?family=video-homework&id=${row.video_id}` });
  const leads = await sql`select k.id::text task_id, e.id::text record_id, e.outcome::text outcome from public.staff_tasks k
    join public.enrollment_consultations e on e.tenant_id=k.tenant_id and e.id=k.subject_id
    where k.tenant_id=${t} and k.kind='enrollment_followup' and k.status='done'`;
  for (const row of leads) records.set(row.task_id, { what: `콜&상담에서 ${row.outcome === 'registered' ? '등록' : row.outcome === 'not_registered' ? '미등록' : '등록 여부'} 결정`,
    open: `#v2-record-open?family=enrollment&id=${row.record_id}` });
  const withdrawal = await sql`select k.id::text task_id, e.id::text event_id, e.action::text action, e.actor_id::text actor_id, e.created_at, k.subject_id::text report_id
    from public.staff_tasks k left join lateral (select id, action, actor_id, created_at from public.withdrawal_report_events e
      where e.tenant_id=k.tenant_id and e.report_id=k.subject_id order by abs(extract(epoch from (e.created_at-k.closed_at))), e.created_at desc limit 1) e on true
    where k.tenant_id=${t} and k.kind='withdrawal_step' and k.status='done'`;
  for (const row of withdrawal) if (row.event_id) records.set(row.task_id, { what: { submit: '퇴원보고서 제출', manager_approve: '관리자 승인', director_approve: '원장 승인' }[row.action] || '퇴원보고서 처리',
    by: row.actor_id, at: row.created_at, open: `#v2-record-open?family=withdrawal-reports&id=${row.report_id}` });
  const marks = await sql`select k.id::text task_id, m.updated_by::text updated_by, m.updated_at, k.closed_at from public.staff_tasks k
    join public.video_homework_marks m on m.tenant_id=k.tenant_id and m.student_id=k.subject_id
      and m.class_id::text=split_part(k.cycle,'|',1) and m.homework_date::text=split_part(k.cycle,'|',2) and m.status='submitted'
    where k.tenant_id=${t} and k.kind='video_upload_check' and k.status='done'`;
  for (const row of marks) {
    const late = row.updated_at && row.closed_at && row.updated_at.getTime() > row.closed_at.getTime() + 60000;
    records.set(row.task_id, { what: late ? '영상 도착 판정' : '영상 제출 완료', by: late ? null : row.updated_by,
      at: late ? row.closed_at : row.updated_at, open: `#v2-record-open?family=tasks-notifications&id=${row.task_id}` });
  }
  // 시작 상태로 남은 원 업로드와 다른 링크라도, 같은 원생·반에서 닫힘 시각 전후에 끝났으면 후속 업로드로 연결한다.
  const uploads = await sql`select k.id::text task_id, u.video_id::text video_id, u.completed_at from public.staff_tasks k
    join public.homework_video_link_uploads first on first.tenant_id=k.tenant_id and first.id::text=substring(split_part(k.cycle,'|',2) from 3)
    join public.homework_video_links orig on orig.tenant_id=first.tenant_id and orig.id=first.link_id
    join lateral (select later.video_id, later.completed_at from public.homework_video_link_uploads later
      join public.homework_video_links target on target.tenant_id=later.tenant_id and target.id=later.link_id
      where later.tenant_id=first.tenant_id and target.student_id=orig.student_id and target.class_id=orig.class_id
        and later.status='completed' and later.completed_at between k.closed_at-interval '1 minute' and k.closed_at+interval '1 minute'
      order by abs(extract(epoch from (later.completed_at-k.closed_at))), later.completed_at desc limit 1) u on true
    where k.tenant_id=${t} and k.kind='video_upload_check' and k.status='done' and split_part(k.cycle,'|',2) like 'u:%'`;
  for (const row of uploads) if (!records.has(row.task_id)) records.set(row.task_id, { what: '후속 영상 업로드 완료', at: row.completed_at,
    open: row.video_id ? `#v2-record-open?family=video-homework&id=${row.video_id}` : `#v2-record-open?family=tasks-notifications&id=${row.task_id}` });
  return records;
}
