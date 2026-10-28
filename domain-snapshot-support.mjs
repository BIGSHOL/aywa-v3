// 지원·설정·연동·역할 셸 + 원장 작업 공간 밖(audit-only) 패밀리.
import { ISO_AT, PRIORITY, addDays, family, field, latest, md, metric, monthlyTrend, notApplicable, record, signal } from './domain-snapshot-core.mjs';

const RUN = { ok: '완료', partial: '일부 실패', error: '실패' };
const TRIGGER = { scheduled: '정기 실행', relay: '연동 PC 요청', button: '직접 실행' };
export const PROVIDER = { makeedu: '메이크에듀', google_sheets: '구글 시트', 'google_sheets:english': '구글 시트(영어)' };

export async function supportFamilies({ sql, t, asOf, month, monthStart, subjectLabel }) {
  const out = {};
  // 고객센터 — 지점이 낸 개선요청. 운영자 답변 화면은 운영 콘솔 쪽이다.
  const requests = await sql`select id, title, status, to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, answered_at is not null answered from public.support_requests where tenant_id=${t} order by created_at desc`;
  out.support = family('support', '고객센터(공지·개선요청)', {
    summary: requests.length ? '이 지점이 낸 개선요청과 답변 상태입니다.' : '이 지점이 낸 개선요청이 없습니다.',
    metrics: [metric('개선요청', requests.length, '건'), metric('답변 받음', requests.filter(r => r.answered).length, '건'), metric('답변 대기', requests.filter(r => !r.answered).length, '건')],
    evidence: requests.map(r => record({ id: r.id, label: r.title, date: r.d, status: r.answered ? '답변 완료' : '답변 대기', facets: [r.answered ? 'answered' : 'waiting'] })),
    facetLabels: { answered: '답변 완료', waiting: '답변 대기' }, recordSource: 'support_requests',
    sourceLabel: '개선요청', coverageNote: '목록은 개선요청 전체입니다(최근 순).',
    sources: [{ table: 'support_requests', rows: requests.length }],
  });

  // 학원 설정 — 원장이 관리하는 설정 기록(팝업 공지·세션 기간·강의실)과 설정 변경 이력 수. 설정 값 원문은 싣지 않는다.
  const popups = await sql`select id, title, audience::text audience, is_active, to_char(starts_at at time zone 'Asia/Seoul','YYYY-MM-DD') s, to_char(ends_at at time zone 'Asia/Seoul','YYYY-MM-DD') e from public.notice_popups where tenant_id=${t} order by created_at desc`;
  const periods = await sql`select id, subject_key, label_year, label_month, start_date::text s, end_date::text e from public.operating_periods where tenant_id=${t} order by start_date desc`;
  const rooms = await sql`select id, name, capacity from public.classrooms where tenant_id=${t} order by name`;
  const [st] = await sql`select (select count(*)::int from public.tenant_settings, jsonb_object_keys(data) k where tenant_id=${t} and jsonb_typeof(data->k)='object') sections, (select count(*)::int from public.audit_logs where tenant_id=${t} and action='owner_settings_update') changes, (select count(*)::int from public.audit_logs where tenant_id=${t} and action='owner_settings_update' and (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf}) month_changes, (select count(*)::int from public.audit_logs where tenant_id=${t} and (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf}) month_audit, (select count(*)::int from public.audit_logs where tenant_id=${t}) audit_all`;
  const livePopup = p => p.is_active && (!p.s || p.s <= asOf) && (!p.e || p.e >= asOf);
  out['owner-settings'] = family('owner-settings', '학원 설정(18면)·관리자 도구', {
    summary: `세션 기간 ${periods.length}개 · 강의실 ${rooms.length}개.`,
    metrics: [metric('저장된 설정 영역', st.sections, '개'), metric('설정 변경 기록', st.changes, '회', `이번 달 ${st.month_changes}회`), metric('이번 달 감사로그', st.month_audit, '건', `전체 ${st.audit_all}건`), metric('지금 보이는 팝업 공지', popups.filter(livePopup).length, '건', `전체 ${popups.length}건`), metric('세션 기간', periods.length, '개'), metric('강의실', rooms.length, '개')],
    evidence: [...popups.map(p => record({ id: p.id, label: `${p.title}${p.s ? ` · ${md(p.s)}${p.e ? `~${md(p.e)}` : '~'}` : ''}`, date: p.s || '', status: livePopup(p) ? '게시 중' : '게시 안 함', fields: [field('대상', { all: '전체', staff: '직원', office: '사무실', teachers: '선생님' }[p.audience] || p.audience)], facets: ['kind:popup', livePopup(p) && 'live'] })),
      ...periods.map(p => record({ id: p.id, label: `${String(p.label_year).slice(-2)}.${String(p.label_month).padStart(2, '0')} 세션${p.subject_key ? ` · ${subjectLabel(p.subject_key)}` : ''}`, date: p.s, detail: `${md(p.s)}~${md(p.e)}`, status: p.s <= asOf && p.e >= asOf ? '진행 중' : p.s > asOf ? '예정' : '지남', fields: [field('과목', p.subject_key ? subjectLabel(p.subject_key) : null)], facets: ['kind:period'] })),
      ...rooms.map(r => record({ id: r.id, label: r.name, status: '강의실', fields: [field('정원', r.capacity)], facets: ['kind:room'] }))],
    facetLabels: { 'kind:popup': '팝업 공지', 'kind:period': '세션 기간', 'kind:room': '강의실', live: '게시 중' }, recordSource: 'notice_popups,operating_periods,classrooms',
    sourceLabel: '학원 설정 · 팝업 공지 · 세션 기간 · 강의실 · 감사로그', coverageNote: '목록은 팝업 공지·세션 기간·강의실입니다.',
    sources: [{ table: 'tenant_settings', rows: 1 }, { table: 'notice_popups', rows: popups.length }, { table: 'operating_periods', rows: periods.length }, { table: 'classrooms', rows: rooms.length }, { table: 'audit_logs', rows: st.audit_all }],
  });

  // 도움말 — 질문 게시판.
  const [hp] = await sql`select (select count(*)::int from public.help_posts where tenant_id=${t}) posts, (select count(*)::int from public.help_answers where tenant_id=${t}) answers`;
  out.help = family('help', '도움말(설명서·질문 게시판)', {
    summary: hp.posts ? `질문 ${hp.posts}건 · 답변 ${hp.answers}건.` : '질문 게시판에 글이 없습니다.',
    metrics: [metric('질문', hp.posts, '건'), metric('답변', hp.answers, '건')], dataState: hp.posts ? 'available' : 'empty', sourceLabel: '도움말 질문 게시판',
    coverageNote: '질문 게시판 글만 셉니다(화면 설명서 제외).', sources: [{ table: 'help_posts', rows: hp.posts }, { table: 'help_answers', rows: hp.answers }],
  });

  // 강사 작업 공간 — 원장이 관리하는 강사뷰 설정(화면 언어·접근)과 오늘 수업 위임.
  const teachers = await sql`select u.id, u.display_name, coalesce(u.teacher_view_lang,'ko') lang, coalesce(u.teacher_view_access,false) access, u.report_display_name is not null custom_name, (select count(*)::int from public.classes c where c.tenant_id=${t} and c.teacher_id=u.id and c.is_active and not coalesce(c.is_makeup_pool,false)) classes from public.users u where u.tenant_id=${t} and u.status='active' and u.system_role='teacher' order by u.display_name`;
  const [tw] = await sql`select (select count(*)::int from public.audit_logs where tenant_id=${t} and action='teacher_view_impersonate' and (created_at at time zone 'Asia/Seoul')::date between ${monthStart} and ${asOf}) views, (select count(*)::int from public.class_delegations where tenant_id=${t}) delegations`;
  out['teacher-workspace'] = family('teacher-workspace', '강사 작업 공간(미니셸·내 정보·뷰 전환)', {
    summary: `수업 위임 기록 ${tw.delegations}건(전체 기간).`,
    metrics: [metric('재직 강사', teachers.length, '명'), metric('영어 화면을 쓰는 강사', teachers.filter(x => x.lang === 'en').length, '명'), metric('보고서 이름을 따로 정한 강사', teachers.filter(x => x.custom_name).length, '명'), metric("이번 달 '다른 강사 뷰' 열람", tw.views, '회'), metric('수업 위임 기록', tw.delegations, '건')],
    evidence: teachers.map(x => record({ id: x.id, label: x.display_name, status: x.lang === 'en' ? 'English 화면' : '한국어 화면', fields: [field('담임 반', x.classes), field('보고서 이름', x.custom_name ? '지정함' : '기본')], facets: [`lang:${x.lang}`, x.classes ? 'has-classes' : 'no-classes'] })),
    facetLabels: { 'lang:ko': '한국어 화면', 'lang:en': 'English 화면', 'has-classes': '담임 반 있음', 'no-classes': '담임 반 없음' }, recordSource: 'users',
    sourceLabel: '강사 계정 설정 · 강사뷰 열람 기록 · 수업 위임', coverageNote: '목록은 재직 강사입니다(이름 순).',
    sources: [{ table: 'users', rows: teachers.length }, { table: 'class_delegations', rows: tw.delegations }],
  });

  out['student-portal'] = family('student-portal', '학생 내 학습', {
    summary: '학생 화면은 예시 데이터로 그려지며 이 지점 기록과는 연결되지 않았습니다.', dataState: 'unavailable', sourceLabel: '예시 데이터',
    coverageNote: '학생 계정과 학습 열람 기록이 없어 볼 수치가 없습니다.',
  });

  // 학부모 포털 — 계정·학부모가 낸 등하원 변경.
  const [pp] = await sql`select (select count(*)::int from public.parent_accounts where tenant_id=${t}) accounts, (select count(*)::int from public.parent_account_students where tenant_id=${t}) links, (select count(*)::int from public.shuttle_ride_exceptions where tenant_id=${t} and actor_kind='parent') parent_changes, (select count(*)::int from public.shuttle_ride_exceptions where tenant_id=${t}) changes`;
  out['parent-portal'] = family('parent-portal', '학부모 포털(셔틀·시간표)', {
    summary: pp.accounts ? `학부모 계정과 학부모가 낸 등하원 변경입니다.` : '학부모 포털 계정이 아직 없습니다.',
    metrics: [metric('학부모 계정', pp.accounts, '개'), metric('연결된 원생', pp.links, '명'), metric('학부모가 낸 등하원 변경', pp.parent_changes, '건'), metric('직원이 기록한 등하원 변경', pp.changes - pp.parent_changes, '건')],
    dataState: pp.accounts ? 'available' : 'empty', sourceLabel: '학부모 계정 · 등하원 변경', coverageNote: '학부모 계정이 생기면 계정 수와 학부모가 낸 변경을 셉니다.',
    sources: [{ table: 'parent_accounts', rows: pp.accounts }, { table: 'shuttle_ride_exceptions', rows: pp.changes }],
  });

  // 외부 연동 — 메이크에듀 동기화 실행(근거)·연동 PC·구글 시트·ClassNote 반 보드 동기화.
  const runs = await sql`select id, status, trigger_source, to_char(started_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, to_char(started_at at time zone 'Asia/Seoul','HH24:MI') hm, to_char(started_at at time zone 'UTC', ${ISO_AT}) at, duration_ms, failed_domains from public.makeedu_sync_runs where tenant_id=${t} order by started_at desc`;
  const links = await sql`select provider, coalesce(sync_enabled,false) enabled, to_char(last_synced_at at time zone 'Asia/Seoul','YYYY-MM-DD') last, last_error is not null failing from public.user_integrations where tenant_id=${t}`;
  const [ig] = await sql`select (select count(*)::int from public.sync_agent_devices where tenant_id=${t} and revoked_at is null) agents, (select max(to_char(last_seen_at at time zone 'Asia/Seoul','YYYY-MM-DD')) from public.sync_agent_devices where tenant_id=${t} and revoked_at is null) agent_seen, (select count(*) filter (where not succeeded)::int from public.sync_agent_schedule_runs where tenant_id=${t}) agent_failed, (select count(*)::int from public.sync_agent_schedule_runs where tenant_id=${t}) agent_runs, (select count(*) filter (where not ok)::int from public.classnote_board_sync_runs where tenant_id=${t}) board_failed, (select count(*)::int from public.classnote_board_sync_runs where tenant_id=${t}) board_runs, (select count(*)::int from public.todays_math_test_results where tenant_id=${t}) todays_math`;
  const recentBad = runs.filter(r => r.status !== 'ok' && r.d >= addDays(asOf, -6)), failingLinks = links.filter(l => l.enabled && l.failing);
  const failingNames = [...new Set(failingLinks.map(l => PROVIDER[l.provider] || '기타 연동'))].join('·');
  out.integrations = family('integrations', '외부 연동(makeedu·구글 시트·오늘 수학·IJW)', {
    summary: `오류가 남은 연동 ${failingLinks.length}개${failingNames ? `(${failingNames})` : ''} · ClassNote 반 보드 동기화 실패 ${ig.board_failed}회(전체 기간).`,
    metrics: [metric('메이크에듀 동기화 실행', runs.length, '회', `전체 기간 · 실패 ${runs.filter(r => r.status === 'error').length} · 일부 실패 ${runs.filter(r => r.status === 'partial').length}`), metric('최근 7일 메이크에듀 동기화 문제', recentBad.length, '회', '실패 · 일부 실패'), metric('연동 PC', ig.agents, '대', `마지막 응답 ${ig.agent_seen ? md(ig.agent_seen) : '기록 없음'}`), metric('연동 PC 정기 작업 실패', ig.agent_failed, '회', `전체 ${ig.agent_runs}회 중`), metric('ClassNote 반 보드 동기화 실패', ig.board_failed, '회', `전체 ${ig.board_runs}회 중`), metric('오류가 남은 연동', failingLinks.length, '개', `마지막 동기화 ${links.map(l => `${PROVIDER[l.provider] || '기타 연동'} ${l.last ? md(l.last) : '날짜 없음'}`).join(' · ')}`), metric('오늘 수학 결과', ig.todays_math, '건')],
    trend: monthlyTrend('월별 메이크에듀 동기화', '회', Object.entries(Object.groupBy(runs.filter(r => r.d <= asOf), r => r.d.slice(0, 7))).map(([m, rows]) => ({ month: m, value: rows.length })), asOf),
    evidence: runs.map(r => record({ id: r.id, label: `메이크에듀 동기화 ${md(r.d)} ${r.hm}${(r.failed_domains || []).length ? ` — 실패 ${r.failed_domains.length}개 영역` : ''}`, date: r.d, status: RUN[r.status] || '기타', fields: [field('실행 방식', TRIGGER[r.trigger_source] || '기타'), field('소요', r.duration_ms ? `${Math.round(r.duration_ms / 1000)}초` : null)], facets: [`status:${r.status}`, `trigger:${r.trigger_source}`, recentBad.includes(r) && 'problem-recent'] })),
    facetLabels: { 'problem-recent': '최근 7일 동기화 문제(실패·일부 실패)', ...Object.fromEntries(Object.entries(RUN).map(([k, v]) => [`status:${k}`, v])), ...Object.fromEntries(Object.entries(TRIGGER).map(([k, v]) => [`trigger:${k}`, v])) }, recordSource: 'makeedu_sync_runs',
    signals: [
      ...(recentBad.length ? [signal({ id: 'makeedu-sync-problem', title: `최근 7일 메이크에듀 동기화 문제 ${recentBad.length}회`, summary: `${recentBad.slice(0, 3).map(r => `${md(r.d)} ${r.hm} ${RUN[r.status] || '기타'}`).join(' · ')}${recentBad.length > 3 ? ` 외 ${recentBad.length - 3}회` : ''}.`, priority: PRIORITY.check, source: '메이크에듀 동기화 기록', recordIds: recentBad.map(r => r.id), facet: 'problem-recent', at: latest(recentBad.map(r => r.at)), draft: { title: '메이크에듀 동기화 상태 확인', body: '최근 동기화에서 실패하거나 일부만 성공한 실행이 있습니다. 연동 PC 상태와 실패한 항목을 확인해 주세요.' } })] : []),
      ...(failingLinks.length ? [signal({ id: 'sheet-sync-error', title: `${failingNames} 연동 오류`, summary: `켜져 있는 ${failingNames} 연결에 마지막 동기화 오류가 남아 있습니다.`, priority: PRIORITY.check, source: '학원 설정 · 연동', draft: { title: `${failingNames} 연동 확인`, body: `${failingNames} 연결에 마지막 동기화 오류가 남아 있습니다. 연결 설정을 확인하고 다시 동기화해 주세요. 구글 시트는 공유 권한과 시트 지정을 확인해 주세요.` } })] : []),
    ],
    sourceLabel: '메이크에듀 동기화 · 연동 PC · 구글 시트 · ClassNote 동기화', coverageNote: '목록은 메이크에듀 동기화 실행 기록입니다(최근 순).',
    sources: [{ table: 'makeedu_sync_runs', rows: runs.length }, { table: 'user_integrations', rows: links.length }, { table: 'sync_agent_schedule_runs', rows: ig.agent_runs }, { table: 'classnote_board_sync_runs', rows: ig.board_runs }],
  });

  // 원장 작업 공간 밖 — 카탈로그 ownerScope = audit-only. 자리만 두고 사유를 적는다.
  // 공개 랜딩 — 원장이 미리 볼 /academy 화면 정보만(학원 이름·지점 표시·로고 문구·로고 유무). 제품 랜딩(/)은 지점과 무관.
  const [pf] = await sql`select tenant_id::text id, data->'profile'->>'name' name, data->'profile'->>'branchLabel' branch, data->'profile'->>'logoText' logo_text, coalesce(data->'profile'->>'logoUrl','') <> '' has_logo from public.tenant_settings where tenant_id=${t}`;
  const shown = pf ? [pf.name, pf.branch, pf.logo_text].filter(Boolean).length + (pf.has_logo ? 1 : 0) : 0;
  out['public-sites'] = family('public-sites', '공개 랜딩(제품·학원)', {
    summary: pf?.name ? '학부모가 보는 학원 공개 페이지에 쓰는 학원 정보입니다.' : '학원 공개 페이지에 쓸 학원 이름이 설정돼 있지 않습니다.',
    metrics: [metric('설정된 공개 페이지 학원 정보', shown, '개', '학원 이름 · 지점 표시 · 로고 문구 · 로고 이미지 4가지 중')],
    evidence: pf ? [record({ id: pf.id, label: pf.name || '학원 이름 미설정', detail: '학원 공개 페이지', status: '학원 설정 값', fields: [field('지점 표시', pf.branch), field('로고 문구', pf.logo_text), field('로고 이미지', pf.has_logo ? '있음' : '없음')], facets: [pf.has_logo ? 'logo' : 'no-logo'] })] : [],
    facetLabels: { logo: '로고 이미지 있음', 'no-logo': '로고 이미지 없음' }, recordSource: 'tenant_settings',
    sourceLabel: '학원 설정 · 프로필', coverageNote: '공개 페이지는 학원 설정의 프로필로 그립니다.',
    sources: [{ table: 'tenant_settings', rows: pf ? 1 : 0 }],
  });
  out['auth-session'] = notApplicable('auth-session', '로그인·세션·링크 만료·지점 보기 안내', '로그인과 세션은 기반 기능이며 원장 업무로 보여 주지 않습니다. 로그인 기록과 인증 정보는 싣지 않습니다.');
  out['platform-console'] = notApplicable('platform-console', '운영 콘솔(슈퍼관리자)', '운영 콘솔 설정(지점 발급·라이선스·AI 모델)은 지점 화면에 드러내지 않는 운영자 영역입니다.');
  out['recording-transcription'] = notApplicable('recording-transcription', '녹음·전사 파이프라인', '녹음·전사 처리 상태는 회의록·원생상담·신규 콜&상담의 지표로 보여 줍니다. 파이프라인 자체는 원장 업무 화면이 아닙니다.');
  out['shell-infrastructure'] = notApplicable('shell-infrastructure', '공용 기반(검색·동시편집·메뉴 기록·최대화·내보내기·통계·학교명)', '검색·내보내기 같은 공용 기능은 각 화면 안에서 쓰입니다. 이용 분석은 운영자만 보는 자료라 싣지 않습니다.');
  out['demo-tenant'] = notApplicable('demo-tenant', '데모 지점 갱신', '데모 지점 전용 작업이라 이 지점(침산)과 관계가 없습니다.');
  out['dev-tools'] = notApplicable('dev-tools', '개발용 화면', '개발 환경에서만 열리는 화면입니다.');
  return out;
}
