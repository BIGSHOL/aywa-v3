// 원생 영역 패밀리 — 원생목록·기여도·성적·원생상담·신규 콜&상담(+ 두 번째 묶음).
import { PRIORITY, dailyTrend, family, field, latest, md, metric, monthlyTrend, record, signal } from './domain-snapshot-core.mjs';
import { lifecycleFamilies } from './domain-snapshot-students2.mjs';
import { importV2 } from './v2-bridge.mjs';

export const STUDENT_STATUS = { enrolled: '재원', on_hold: '휴원', prospect: '예비', withdrawn: '퇴원' };
export const OUTCOME = { scheduled: '상담 예약', consulted: '상담 완료', ai_done: '상담 검토', enrolled: '등록', declined: '미등록', no_show: '미방문' };
const SLOT = { monthly: '월말평가', midterm: '중간고사', final: '기말고사' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));
export const enrollmentStageOf = (lead, assignedByLead, classKeysOf, stageOfCard) => {
  const subjects = assignedByLead.get(lead.id) || [], keys = classKeysOf(lead.subject);
  return stageOfCard({ outcome: lead.oc, assignedClassCount: keys === null ? subjects.length : subjects.filter(s => keys.includes(s)).length });
};

export async function studentFamilies(ctx) {
  const { sql, t, asOf, monthStart, subjectLabel, subjectText, subjectFacets } = ctx;
  const out = {};

  // 원생목록 — 원생 상태가 단일 기준(테스트 원생 제외).
  const students = await sql`select id, name, school, grade, nullif(btrim(parent_phone),'') is not null has_parent_phone, status::text st, enrolled_at::text enrolled, withdrawn_at::text withdrawn from public.students where tenant_id=${t} and not coalesce(is_test,false) order by (status='enrolled') desc, enrolled_at desc nulls last, name`;
  // 원생목록 2.0의 수강·담임 열: 퇴원생은 이력 전체, 그 밖은 종료되지 않고 휴원하지 않은 수강만 본다.
  const enrollments = await sql`select e.student_id, e.end_date, e.on_hold, c.subject, u.display_name teacher from public.enrollments e left join public.classes c on c.id=e.class_id and c.tenant_id=${t} left join public.users u on u.id=c.teacher_id and u.tenant_id=${t} where e.tenant_id=${t} and e.student_id in (select id from public.students where tenant_id=${t} and not coalesce(is_test,false))`;
  const studentsById = new Map(students.map(s => [s.id, s]));
  const subjectsByStudent = new Map(), teachersByStudent = new Map();
  for (const e of enrollments) {
    const student = studentsById.get(e.student_id);
    if (!student || (student.st !== 'withdrawn' && (e.end_date || e.on_hold))) continue;
    if (e.subject) { const subjects = subjectsByStudent.get(e.student_id) || new Set(); subjects.add(e.subject); subjectsByStudent.set(e.student_id, subjects); }
    if (e.teacher) { const teachers = teachersByStudent.get(e.student_id) || []; teachers.push({ subject: e.subject, name: e.teacher }); teachersByStudent.set(e.student_id, teachers); }
  }
  const [{ schoolGradeLabel }, { narrowTeacherNames }] = await Promise.all([importV2('lib/format/school-grade.ts'), importV2('features/students/scope-axis.ts')]);
  const daily = await sql`select stat_date::text as date, (data->>'enrolled')::int as value from public.student_daily_stats where tenant_id=${t} and data ? 'enrolled'`;
  const [aux] = await sql`select (select count(*)::int from public.student_siblings where tenant_id=${t}) siblings, (select count(*)::int from public.student_memos where tenant_id=${t}) memos`;
  const by = st => students.filter(s => s.st === st).length;
  const fresh = students.filter(s => s.enrolled >= monthStart && s.enrolled <= asOf && s.st !== 'prospect');
  out.students = family('students', '원생목록·원생 상세·원생 통계', {
    summary: `이번 달 등록 ${fresh.length}명(등록일 기준).`,
    metrics: [metric('재원', by('enrolled'), '명', '테스트 원생 제외'), metric('휴원', by('on_hold'), '명'), metric('예비', by('prospect'), '명'), metric('퇴원', by('withdrawn'), '명', '전체 기간'), metric('이번 달 등록', fresh.length, '명', '등록일 기준'), metric('직접 정한 형제 관계', aux.siblings, '쌍', '형제 지정 · 형제 아님 지정')],
    trend: dailyTrend('일별 재원생', '명', daily, asOf),
    evidence: students.map(s => record({ id: s.id, label: s.name, detail: schoolGradeLabel(s.school, s.grade), date: s.enrolled, status: STUDENT_STATUS[s.st] || '기타', fields: [field('과목', [...(subjectsByStudent.get(s.id) || [])].sort().map(subjectLabel).join(' · ')), field('담임', narrowTeacherNames(null, teachersByStudent.get(s.id) || []).join('·')), field('보호자 연락처', s.has_parent_phone ? '연락처 가림' : '연락처 없음'), field('퇴원일', s.withdrawn)], facets: [`status:${s.st}`, fresh.includes(s) && 'new-this-month'] })),
    facetOrder: [...Object.keys(STUDENT_STATUS).map(k => `status:${k}`), 'new-this-month'], facetLabels: { ...pre('status', STUDENT_STATUS), 'new-this-month': '이번 달 등록' }, recordSource: 'students',
    sourceLabel: '원생 · 일별 재원 기록', coverageNote: '목록은 원생 전체입니다(재원 먼저). 일별 재원생은 기록을 시작한 날부터이며 빠진 날은 비워 둡니다.',
    sources: [{ table: 'students', rows: students.length }, { table: 'student_daily_stats', rows: daily.length }],
  });

  // 원생 기여도 — 긍정 신호 판정(인정 = observed·취소 안 됨), 월별 기여도, 설명회 참여.
  const signals = await sql`select p.id, s.name, p.occurred_on::text d, p.source, p.classification, p.cancelled_at is not null cancelled from public.student_positive_signals p join public.students s on s.id=p.student_id and s.tenant_id=${t} where p.tenant_id=${t} and not coalesce(s.is_test,false) and p.occurred_on <= ${asOf} order by p.occurred_on desc`;
  const [cb] = await sql`select (select count(distinct month)::int from public.student_contribution_months where tenant_id=${t}) months, (select count(*)::int from public.student_contribution_months where tenant_id=${t} and closed_at is not null) closed, (select count(*)::int from public.student_contribution_months where tenant_id=${t}) rows_all, (select count(*)::int from public.student_parent_events where tenant_id=${t}) events, (select count(*)::int from public.student_parent_event_registrations where tenant_id=${t}) registrations, (select count(*)::int from public.student_parent_event_recognitions where tenant_id=${t}) recognitions`;
  const accepted = r => r.classification === 'observed' && !r.cancelled;
  out['student-contribution'] = family('student-contribution', '원생 기여도(온톨로지·소개)', {
    summary: `전체 긍정 신호 판정 ${signals.length}건 · 설명회 등록 ${cb.registrations}건.`,
    metrics: [metric('인정된 긍정 신호', signals.filter(accepted).length, '건', '전체 기간 · 판정 취소 제외'), metric('이번 달 긍정 신호 판정', signals.filter(r => r.d >= monthStart).length, '건'), metric('기여도 월 기록', cb.rows_all, '건', `${cb.months}개월 · 마감 ${cb.closed}건`), metric('학부모 설명회', cb.events, '회'), metric('설명회 등록', cb.registrations, '건', `형제 인정·최초 연결 ${cb.recognitions}건`)],
    trend: monthlyTrend('월별 긍정 신호 판정', '건', await sql`select to_char(occurred_on,'YYYY-MM') as month, count(*)::int as value from public.student_positive_signals where tenant_id=${t} and occurred_on <= ${asOf} group by 1`, asOf),
    evidence: signals.map(r => record({ id: r.id, label: r.name, date: r.d, status: r.cancelled ? '판정 취소' : r.classification === 'observed' ? '긍정 신호' : r.classification === 'thanks' ? '감사 인사' : '해당 없음', fields: [field('출처', r.source === 'teacher' ? '선생님' : '학부모')], facets: [r.cancelled ? 'cancelled' : `class:${r.classification}`, `source:${r.source}`] })),
    summaryRecords: signals.filter(accepted).map(r => record({ id: r.id, label: r.name, date: r.d, status: '긍정 신호', fields: [field('출처', r.source === 'teacher' ? '선생님' : '학부모')], facets: [`class:${r.classification}`, `source:${r.source}`] })),
    facetLabels: { 'class:observed': '긍정 신호', 'class:thanks': '감사 인사', 'class:other': '해당 없음', cancelled: '판정 취소', 'source:parent': '학부모 글', 'source:teacher': '선생님 기록' }, recordSource: 'student_positive_signals',
    sourceLabel: '긍정 신호 판정 · 월별 기여도 · 설명회', coverageNote: '목록은 긍정 신호 판정입니다(최근 순 · 감사 인사·해당 없음·판정 취소 포함).',
    sources: [{ table: 'student_positive_signals', rows: signals.length }, { table: 'student_contribution_months', rows: cb.rows_all }, { table: 'student_parent_events', rows: cb.events }],
  });

  // 성적관리 — 입력된 성적(근거). 시험 등록 표(exams)는 쓰지 않는다(결정 로그).
  const grades = await sql`select g.id, s.name, g.subject, g.exam_name, g.exam_slot, g.taken_on::text d, g.score::float8 score, g.max_score::float8 max, coalesce(g.no_exam,false) no_exam from public.student_grades g join public.students s on s.id=g.student_id and s.tenant_id=${t} where g.tenant_id=${t} and not coalesce(s.is_test,false) and (g.taken_on is null or g.taken_on <= ${asOf}) order by g.taken_on desc nulls last, s.name`;
  const scored = grades.filter(g => !g.no_exam && g.score !== null && g.max > 0);
  out.exams = family('exams', '성적관리(통합·입력·확인·JJ실)', {
    summary: `이번 달 성적 기록 ${grades.filter(g => g.d >= monthStart).length}건(시험일 기준).`,
    metrics: [metric('성적 기록', grades.length, '건', '전체 기간'), metric('성적이 있는 원생', new Set(grades.map(g => g.name)).size, '명'), metric('점수율 평균', scored.length ? Math.round(scored.reduce((n, g) => n + g.score / g.max * 100, 0) / scored.length * 10) / 10 : null, '%', '점수 ÷ 만점의 평균'), metric('시험 없음으로 적은 기록', grades.filter(g => g.no_exam).length, '건'), metric('이번 달 성적 기록', grades.filter(g => g.d >= monthStart).length, '건', '시험일 기준')],
    trend: monthlyTrend('월별 성적 기록', '건', await sql`select to_char(taken_on,'YYYY-MM') as month, count(*)::int as value from public.student_grades where tenant_id=${t} and taken_on <= ${asOf} group by 1`, asOf),
    evidence: grades.map(g => record({ id: g.id, label: g.name, date: g.d, subject: subjectLabel(g.subject), detail: g.exam_name || SLOT[g.exam_slot] || '', status: g.no_exam ? '시험 없음' : '', fields: [field('점수', g.no_exam || g.score === null ? null : `${g.score}/${g.max}`)], facets: [`subject:${g.subject || 'none'}`, g.exam_slot ? `slot:${g.exam_slot}` : 'slot:none', g.no_exam && 'no-exam'] })),
    facetLabels: { ...subjectFacets, ...pre('slot', SLOT), 'slot:none': '시험 구분 없음', 'no-exam': '시험 없음' }, recordSource: 'student_grades', dateLabel: '시험일',
    sourceLabel: '입력된 성적', coverageNote: '목록은 입력된 성적 전체입니다(최근 시험일 순).',
    sources: [{ table: 'student_grades', rows: grades.length }],
  });

  // 원생상담 — 재원생 상담 기록. 후속 조치 기한이 지난 미완료만 신호로.
  const [{ CONSULTATION_CATEGORY_LABEL }, { consultationPreview }] = await Promise.all([importV2('features/consultations/labels.ts'), importV2('features/consultations/summary-preview.ts')]);
  const consults = await sql`select c.id, s.name, s.grade student_grade, to_char(c.consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, to_char(c.consulted_at at time zone 'Asia/Seoul','HH24:MI') at_time, c.subject, c.category, c.summary, cl.class_name, u.display_name counselor, c.follow_up_action, c.follow_up_date::text due, coalesce(c.follow_up_done,false) done, c.ai_generated_at is not null ai, c.ai_summary is not null has_ai, c.audio_path is not null audio, c.processing_status::text ps from public.student_consultations c join public.students s on s.id=c.student_id and s.tenant_id=${t} left join public.classes cl on cl.id=c.class_id and cl.tenant_id=${t} left join public.users u on u.id=c.counselor_id and u.tenant_id=${t} where c.tenant_id=${t} and not coalesce(s.is_test,false) and (c.consulted_at at time zone 'Asia/Seoul')::date <= ${asOf} order by c.consulted_at desc`;
  const overdue = consults.filter(c => c.due && c.due <= asOf && !c.done);
  // 자유 글 요약에는 주소·연락처가 섞여 있어 기록 API에는 2.0 미리보기 함수로 판정한 내용 유무만 싣는다.
  out.consultations = family('consultations', '원생상담(재원생 상담·AI 분석)', {
    summary: `녹음 있는 상담 ${consults.filter(c => c.audio).length}건 · 전체 상담 기록 ${consults.length}건.`,
    metrics: [metric('이번 달 상담', consults.filter(c => c.d >= monthStart).length, '건', '상담일 기준'), metric('이번 달 상담 원생', new Set(consults.filter(c => c.d >= monthStart).map(c => c.name)).size, '명'), metric('후속조치 기한 경과', overdue.length, '건', '후속조치일이 기준일까지이고 완료 표시 없음'), metric('AI 분석 상담', consults.filter(c => c.ai).length, '건', '전체 기간'), metric('녹음 있는 상담', consults.filter(c => c.audio).length, '건', `전사·분석 실패 ${consults.filter(c => c.ps === 'failed').length}건`), metric('전체 상담 기록', consults.length, '건')],
    trend: monthlyTrend('월별 원생상담', '건', await sql`select to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM') as month, count(*)::int as value from public.student_consultations where tenant_id=${t} and (consulted_at at time zone 'Asia/Seoul')::date <= ${asOf} group by 1`, asOf),
    evidence: consults.map(c => record({ id: c.id, label: c.name, date: c.d, subject: c.subject ? subjectFacets[`subject:${c.subject}`] || c.subject : '과목 미입력', status: c.due ? c.done ? '후속조치 완료' : c.due <= asOf ? '후속조치 지남' : '후속조치 예정' : '', fields: [field('학년', c.student_grade), field('상담자', c.counselor), field('반', c.class_name), field('요약', consultationPreview(c.summary) === '상담 내용 미입력' ? '상담 내용 미입력' : '상담 내용 있음'), field('분류', c.category ? CONSULTATION_CATEGORY_LABEL[c.category] || '기타' : null), field('후속조치', [c.follow_up_action, c.due ? `${md(c.due)}${c.done ? ' 완료' : ''}` : ''].filter(Boolean).join(' · ')), field('녹음·AI', [c.audio && '녹음', c.has_ai && 'AI'].filter(Boolean).join(' · ')), field('시각', c.at_time)], facets: [`subject:${c.subject || '미입력'}`, overdue.includes(c) && 'followup-overdue', c.d >= monthStart && 'this-month'] })),
    facetLabels: { 'followup-overdue': '후속조치 기한 경과', 'this-month': '이번 달', ...Object.fromEntries([...new Set(consults.map(c => c.subject || '미입력'))].map(s => [`subject:${s}`, s === '미입력' ? '과목 미입력' : s])) }, recordSource: 'student_consultations',
    signals: overdue.length ? [signal({ id: 'consultation-followup-overdue', title: `원생상담 후속조치 기한 경과 ${overdue.length}건`, summary: `${overdue.slice(0, 3).map(c => `${c.name}(${c.counselor || '상담자 미상'} · ${md(c.due)})`).join(', ')}${overdue.length > 3 ? ` 외 ${overdue.length - 3}건` : ''}. 완료 표시가 없습니다.`, priority: PRIORITY.check, source: '원생상담 후속조치', recordIds: overdue.map(c => c.id), facet: 'followup-overdue', at: latest(overdue.map(c => c.due)), draft: { title: '상담 후속조치 진행 확인', body: '후속조치 날짜가 지난 상담의 진행 여부를 확인하고 결과를 남겨 주세요.' } })] : [],
    sourceLabel: '원생상담 기록', coverageNote: '목록은 원생상담 전체입니다(최근 순). 과목은 상담에 적힌 그대로입니다.',
    sources: [{ table: 'student_consultations', rows: consults.length }],
  });

  // 신규 콜&상담 — 접수일 = 접수일 → 상담 예정일 → 상담일 → 등록일(snapshot.mjs와 같은 순서).
  const leads = await sql`select c.id, c.student_id, c.prospect_name, c.prospect_grade, c.prospect_school, c.outcome::text oc, coalesce(c.received_date::text, c.consultation_date::text, to_char(c.consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD'), to_char(c.created_at at time zone 'Asia/Seoul','YYYY-MM-DD')) d, c.subject, c.follow_up_date::text follow_up_date, u.display_name consultant, c.consultation_path, c.prep_brief_at is not null brief from public.enrollment_consultations c left join public.users u on u.id=c.consultant_id and u.tenant_id=${t} where c.tenant_id=${t} and (c.student_id is null or c.student_id not in (select id from public.students where tenant_id=${t} and coalesce(is_test,false)))`;
  const [{ stageOfCard }, { consultClassKeysOf }] = await Promise.all([importV2('features/enrollment/board-stages.ts'), importV2('features/enrollment/consult-subject.ts')]);
  const classKeysOf = consultClassKeysOf(ctx.subjectSettings || []), today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  // 2.0 칸반과 같은 연결 원생·해당 과목의 미종료 수강. 결과 코드는 DB 원값 그대로 둔다.
  const assigned = await sql`select c.id, cl.subject from public.enrollment_consultations c join public.enrollments e on e.student_id=c.student_id and e.tenant_id=${t} join public.classes cl on cl.id=e.class_id and cl.tenant_id=${t} where c.tenant_id=${t} and (e.end_date is null or e.end_date >= ${today})`;
  const assignedByLead = new Map();
  for (const row of assigned) { if (!assignedByLead.has(row.id)) assignedByLead.set(row.id, []); assignedByLead.get(row.id).push(row.subject); }
  const stage = l => enrollmentStageOf(l, assignedByLead, classKeysOf, stageOfCard);
  const dated = leads.filter(l => l.d <= asOf).sort((a, b) => b.d.localeCompare(a.d));
  const monthLeads = dated.filter(l => l.d >= monthStart), review = monthLeads.filter(l => ['scheduled', 'consulted', 'ai_done'].includes(l.oc) && stage(l) !== 'enrolled');
  const [qr] = await sql`select count(*) filter (where is_active)::int active, coalesce(sum(submission_count),0)::int submissions, (select count(*)::int from public.consultation_recordings where tenant_id=${t}) recordings from public.intake_tokens where tenant_id=${t}`;
  out.enrollment = family('enrollment', '신규 콜&상담(QR 접수·브리프·인수인계)', {
    summary: `QR 접수 ${qr.submissions}건 · 상담 녹음 ${qr.recordings}건(전체 기간).`,
    metrics: [metric('이번 달 접수', monthLeads.length, '건', '접수일 기준'), metric('이번 달 접수 중 등록', monthLeads.filter(l => l.oc === 'enrolled').length, '건', '현재 결과 기준'), metric('이번 달 접수 중 상담·검토 단계', review.length, '건', '상담 예약·상담 완료·상담 검토'), metric('전체 신규 상담', dated.length, '건', '전체 기간'), metric('QR 접수', qr.submissions, '건', `사용 중인 QR ${qr.active}개`), metric('상담 준비 브리프', dated.filter(l => l.brief).length, '건'), metric('상담 녹음', qr.recordings, '건')],
    trend: monthlyTrend('월별 신규 상담 접수', '건', Object.entries(Object.groupBy(dated, l => l.d.slice(0, 7))).map(([m, rows]) => ({ month: m, value: rows.length })), asOf),
    evidence: dated.map(l => record({ id: l.id, label: l.prospect_name || '이름 미입력', detail: schoolGradeLabel(l.prospect_school, l.prospect_grade), date: l.d, status: stage(l) === 'enrolled' ? '등록 완료' : OUTCOME[l.oc] || '기타', fields: [field('과목', subjectText(l.subject)), field('상담자', l.consultant), field('경로', l.consultation_path), stage(l) === 'enrolled' && l.oc !== 'enrolled' && field('상담 결과', OUTCOME[l.oc] || '미확정'), field('후속 조치일', l.follow_up_date)].filter(Boolean), facets: [`outcome:${l.oc}`, l.d >= monthStart && 'this-month', review.includes(l) && 'review'] })),
    summaryRecords: [...review, ...dated.filter(l => !review.includes(l))].map(l => record({ id: l.id, label: l.prospect_name || '이름 미입력', detail: schoolGradeLabel(l.prospect_school, l.prospect_grade), date: l.d, status: stage(l) === 'enrolled' ? '등록 완료' : OUTCOME[l.oc] || '기타', fields: [field('과목', subjectText(l.subject)), field('상담자', l.consultant)], facets: [`outcome:${l.oc}`] })),
    facetOrder: ['this-month', 'review', ...Object.keys(OUTCOME).map(k => `outcome:${k}`)], facetLabels: { 'this-month': '이번 달 접수', review: '이번 달 상담·검토 단계', ...pre('outcome', OUTCOME) }, recordSource: 'enrollment_consultations',
    signals: review.length ? [signal({ id: 'enrollment-followup', title: `이번 달 신규 상담 중 등록 여부 미정 ${review.length}건`, summary: `상담자별: ${Object.entries(Object.groupBy(review, l => l.consultant || '상담자 미지정')).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(' · ')}.`, priority: PRIORITY.check, source: '신규 콜&상담 · 접수월과 현재 결과', recordIds: review.map(l => l.id), facet: 'review', at: latest(review.map(l => l.d)), draft: { title: '상담 후속 일정 확인', body: '상담·검토 단계인 신규 상담의 다음 약속을 확인하고, 등록 여부가 바뀐 경우 함께 알려 주세요.' } })] : [],
    sourceLabel: '신규 콜&상담 · QR 접수 · 상담 녹음', coverageNote: '목록은 신규 상담 전체입니다(최근 접수 순 · 이전 시스템에서 옮긴 기록 포함).',
    sources: [{ table: 'enrollment_consultations', rows: leads.length }, { table: 'intake_tokens', rows: (await sql`select count(*)::int c from public.intake_tokens where tenant_id=${t}`)[0].c }, { table: 'consultation_recordings', rows: qr.recordings }],
  });

  Object.assign(out, await lifecycleFamilies({ ...ctx, students, schoolGradeLabel }));
  return out;
}
