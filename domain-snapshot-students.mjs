// 원생 영역 패밀리 — 원생목록·기여도·성적·원생상담·신규 콜&상담(+ 두 번째 묶음).
import { PRIORITY, dailyTrend, family, field, md, metric, monthlyTrend, record, signal } from './domain-snapshot-core.mjs';
import { lifecycleFamilies } from './domain-snapshot-students2.mjs';

export const STUDENT_STATUS = { enrolled: '재원', on_hold: '휴원', prospect: '예비', withdrawn: '퇴원' };
const OUTCOME = { scheduled: '상담 예약', consulted: '상담 완료', ai_done: '상담 검토', enrolled: '등록', declined: '미등록', no_show: '미방문' };
const SLOT = { monthly: '월말평가', midterm: '중간고사', final: '기말고사' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));

export async function studentFamilies(ctx) {
  const { sql, t, asOf, month, monthStart, subjectLabel, subjectText, subjectFacets } = ctx;
  const out = {};

  // 원생목록 — 학생 상태가 단일 기준(테스트 학생 제외).
  const students = await sql`select id, name, school, grade, status::text st, enrolled_at::text enrolled, withdrawn_at::text withdrawn from public.students where tenant_id=${t} and not coalesce(is_test,false) order by (status='enrolled') desc, enrolled_at desc nulls last, name`;
  const daily = await sql`select stat_date::text as date, (data->>'enrolled')::int as value from public.student_daily_stats where tenant_id=${t} and data ? 'enrolled'`;
  const [aux] = await sql`select (select count(*)::int from public.student_siblings where tenant_id=${t}) siblings, (select count(*)::int from public.student_memos where tenant_id=${t}) memos`;
  const by = st => students.filter(s => s.st === st).length;
  const fresh = students.filter(s => s.enrolled >= monthStart && s.enrolled <= asOf && s.st !== 'prospect');
  out.students = family('students', '원생목록·원생 상세·원생 통계', {
    summary: `이번 달 등록 ${fresh.length}명(등록일 기준).`,
    metrics: [metric('재원', by('enrolled'), '명', '테스트 학생 제외'), metric('휴원', by('on_hold'), '명'), metric('예비', by('prospect'), '명'), metric('퇴원', by('withdrawn'), '명', '전체 기간'), metric('이번 달 등록', fresh.length, '명', '등록일 기준'), metric('직접 정한 형제 관계', aux.siblings, '쌍', '형제 지정 · 형제 아님 지정')],
    trend: dailyTrend('일별 재원생', '명', daily, asOf),
    evidence: students.map(s => record({ id: s.id, label: s.name, detail: [s.school, s.grade].filter(Boolean).join(' '), date: s.enrolled, status: STUDENT_STATUS[s.st] || '기타', fields: [field('학교', s.school), field('학년', s.grade), field('퇴원일', s.withdrawn)], facets: [`status:${s.st}`, fresh.includes(s) && 'new-this-month'] })),
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
    evidence: grades.map(g => record({ id: g.id, label: g.name, date: g.d, detail: g.exam_name || SLOT[g.exam_slot] || '', status: g.no_exam ? '시험 없음' : subjectLabel(g.subject), fields: [field('점수', g.no_exam || g.score === null ? null : `${g.score}/${g.max}`), field('시험', SLOT[g.exam_slot] || g.exam_name)], facets: [`subject:${g.subject || 'none'}`, g.exam_slot ? `slot:${g.exam_slot}` : 'slot:none', g.no_exam && 'no-exam'] })),
    facetLabels: { ...subjectFacets, ...pre('slot', SLOT), 'slot:none': '시험 구분 없음', 'no-exam': '시험 없음' }, recordSource: 'student_grades',
    sourceLabel: '입력된 성적', coverageNote: '목록은 입력된 성적 전체입니다(최근 시험일 순).',
    sources: [{ table: 'student_grades', rows: grades.length }],
  });

  // 원생상담 — 재원생 상담 기록. 후속 조치 기한이 지난 미완료만 신호로.
  const consults = await sql`select c.id, s.name, to_char(c.consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, c.subject, c.category, u.display_name counselor, c.follow_up_date::text due, coalesce(c.follow_up_done,false) done, c.ai_generated_at is not null ai, c.audio_path is not null audio, c.processing_status::text ps from public.student_consultations c join public.students s on s.id=c.student_id and s.tenant_id=${t} left join public.users u on u.id=c.counselor_id and u.tenant_id=${t} where c.tenant_id=${t} and not coalesce(s.is_test,false) and (c.consulted_at at time zone 'Asia/Seoul')::date <= ${asOf} order by c.consulted_at desc`;
  const overdue = consults.filter(c => c.due && c.due <= asOf && !c.done);
  out.consultations = family('consultations', '원생상담(재원생 상담·AI 분석)', {
    summary: `녹음 있는 상담 ${consults.filter(c => c.audio).length}건 · 전체 상담 기록 ${consults.length}건.`,
    metrics: [metric('이번 달 상담', consults.filter(c => c.d >= monthStart).length, '건', '상담일 기준'), metric('이번 달 상담 원생', new Set(consults.filter(c => c.d >= monthStart).map(c => c.name)).size, '명'), metric('기한 지난 후속 조치', overdue.length, '건', '후속 조치일이 기준일까지이고 완료 표시 없음'), metric('AI 분석 상담', consults.filter(c => c.ai).length, '건', '전체 기간'), metric('녹음 있는 상담', consults.filter(c => c.audio).length, '건', `전사·분석 실패 ${consults.filter(c => c.ps === 'failed').length}건`), metric('전체 상담 기록', consults.length, '건')],
    trend: monthlyTrend('월별 원생상담', '건', await sql`select to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM') as month, count(*)::int as value from public.student_consultations where tenant_id=${t} and (consulted_at at time zone 'Asia/Seoul')::date <= ${asOf} group by 1`, asOf),
    evidence: consults.map(c => record({ id: c.id, label: c.name, date: c.d, status: c.subject || '과목 미입력', fields: [field('상담자', c.counselor), field('후속 조치', c.due ? `${md(c.due)}${c.done ? ' 완료' : ''}` : null)], facets: [`subject:${c.subject || '미입력'}`, overdue.includes(c) && 'followup-overdue', c.d >= monthStart && 'this-month'] })),
    facetLabels: { 'followup-overdue': '후속 조치 기한 지남', 'this-month': '이번 달', ...Object.fromEntries([...new Set(consults.map(c => c.subject || '미입력'))].map(s => [`subject:${s}`, s === '미입력' ? '과목 미입력' : s])) }, recordSource: 'student_consultations',
    signals: overdue.length ? [signal({ id: 'consultation-followup-overdue', title: `원생상담 후속 조치 기한 지남 ${overdue.length}건`, summary: `${overdue.slice(0, 3).map(c => `${c.name}(${c.counselor || '상담자 모름'} · ${md(c.due)})`).join(', ')}${overdue.length > 3 ? ` 외 ${overdue.length - 3}건` : ''}. 완료 표시가 없습니다.`, priority: PRIORITY.check, source: '원생상담 후속 조치', recordIds: overdue.map(c => c.id), draft: { title: '상담 후속 조치 진행 확인', body: '후속 조치 날짜가 지난 상담의 진행 여부를 확인하고 결과를 남겨 주세요.' } })] : [],
    sourceLabel: '원생상담 기록', coverageNote: '목록은 원생상담 전체입니다(최근 순). 과목은 상담에 적힌 그대로입니다.',
    sources: [{ table: 'student_consultations', rows: consults.length }],
  });

  // 신규 콜&상담 — 접수일 = 접수일 → 상담 예정일 → 상담일 → 등록일(snapshot.mjs와 같은 순서).
  const leads = await sql`select c.id, c.prospect_name, c.prospect_grade, c.prospect_school, c.outcome::text oc, coalesce(c.received_date::text, c.consultation_date::text, to_char(c.consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD'), to_char(c.created_at at time zone 'Asia/Seoul','YYYY-MM-DD')) d, c.subject, u.display_name consultant, c.consultation_path, c.prep_brief_at is not null brief from public.enrollment_consultations c left join public.users u on u.id=c.consultant_id and u.tenant_id=${t} where c.tenant_id=${t} and (c.student_id is null or c.student_id not in (select id from public.students where tenant_id=${t} and coalesce(is_test,false)))`;
  const dated = leads.filter(l => l.d <= asOf).sort((a, b) => b.d.localeCompare(a.d));
  const monthLeads = dated.filter(l => l.d >= monthStart), review = monthLeads.filter(l => ['scheduled', 'consulted', 'ai_done'].includes(l.oc));
  const [qr] = await sql`select count(*) filter (where is_active)::int active, coalesce(sum(submission_count),0)::int submissions, (select count(*)::int from public.consultation_recordings where tenant_id=${t}) recordings from public.intake_tokens where tenant_id=${t}`;
  out.enrollment = family('enrollment', '신규 콜&상담(QR 접수·브리프·인수인계)', {
    summary: `QR 접수 ${qr.submissions}건 · 상담 녹음 ${qr.recordings}건(전체 기간).`,
    metrics: [metric('이번 달 접수', monthLeads.length, '건', '접수일 기준'), metric('이번 달 접수 중 등록', monthLeads.filter(l => l.oc === 'enrolled').length, '건', '현재 결과 기준'), metric('이번 달 접수 중 상담·검토 단계', review.length, '건', '상담 예약·상담 완료·상담 검토'), metric('전체 신규 상담', dated.length, '건', '전체 기간'), metric('QR 접수', qr.submissions, '건', `사용 중인 QR ${qr.active}개`), metric('상담 준비 브리프', dated.filter(l => l.brief).length, '건'), metric('상담 녹음', qr.recordings, '건')],
    trend: monthlyTrend('월별 신규 상담 접수', '건', Object.entries(Object.groupBy(dated, l => l.d.slice(0, 7))).map(([m, rows]) => ({ month: m, value: rows.length })), asOf),
    evidence: dated.map(l => record({ id: l.id, label: l.prospect_name || '이름 미입력', detail: [l.prospect_grade, l.prospect_school].filter(Boolean).join(' '), date: l.d, status: OUTCOME[l.oc] || '기타', fields: [field('과목', subjectText(l.subject)), field('상담자', l.consultant), field('경로', l.consultation_path)], facets: [`outcome:${l.oc}`, l.d >= monthStart && 'this-month', review.includes(l) && 'review'] })),
    summaryRecords: [...review, ...dated.filter(l => !review.includes(l))].map(l => record({ id: l.id, label: l.prospect_name || '이름 미입력', detail: [l.prospect_grade, l.prospect_school].filter(Boolean).join(' '), date: l.d, status: OUTCOME[l.oc] || '기타', fields: [field('과목', subjectText(l.subject)), field('상담자', l.consultant)], facets: [`outcome:${l.oc}`] })),
    facetOrder: ['this-month', 'review', ...Object.keys(OUTCOME).map(k => `outcome:${k}`)], facetLabels: { 'this-month': '이번 달 접수', review: '이번 달 상담·검토 단계', ...pre('outcome', OUTCOME) }, recordSource: 'enrollment_consultations',
    signals: review.length ? [signal({ id: 'enrollment-followup', title: `이번 달 신규 상담 중 등록 여부 미정 ${review.length}건`, summary: `상담자별: ${Object.entries(Object.groupBy(review, l => l.consultant || '상담자 미지정')).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(' · ')}.`, priority: PRIORITY.check, source: '신규 콜&상담 · 접수월과 현재 결과', recordIds: review.map(l => l.id), draft: { title: '상담 후속 일정 확인', body: '상담·검토 단계인 신규 상담의 다음 약속을 확인하고, 등록 여부가 바뀐 경우 함께 알려 주세요.' } })] : [],
    sourceLabel: '신규 콜&상담 · QR 접수 · 상담 녹음', coverageNote: '목록은 신규 상담 전체입니다(최근 접수 순 · 이전 시스템에서 옮긴 기록 포함).',
    sources: [{ table: 'enrollment_consultations', rows: leads.length }, { table: 'intake_tokens', rows: (await sql`select count(*)::int c from public.intake_tokens where tenant_id=${t}`)[0].c }, { table: 'consultation_recordings', rows: qr.recordings }],
  });

  Object.assign(out, await lifecycleFamilies({ ...ctx, students }));
  return out;
}
