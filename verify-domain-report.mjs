// Writes DOMAIN-COVERAGE.md from the live workspaces model (counts and labels only — no records/names).
//   node experiments/owner-concept/verify-domain-report.mjs
import { writeFile } from 'node:fs/promises';
import { loadSnapshot } from './snapshot.mjs';

// What each family deliberately does NOT reproduce from 2.0 (data model ≠ feature parity).
const GAPS = {
  dashboard: '위젯 27종·KPI 9칸을 다시 계산하지 않음. 브리핑 생성이 마지막 날 이후 멈춘 것을 그대로 보여 줌.',
  calendar: '구글 동기화 상태·태그 편집은 없음.',
  'tasks-notifications': '사람별 알림함·읽음 처리 없음(알림은 받는 사람 기준 건수).',
  slack: '전송 본문·채널은 싣지 않음.',
  onescreen: '학생 칸 점수·태도 값은 근거로 싣지 않음(공지가 근거).',
  'video-homework': '영상 제출 현황의 회차·영상 배정 판정은 다시 만들지 않음. AI 메모 본문 없음.',
  timetable: '메모 시트·칸 메모·연습실 초안 내용은 싣지 않음.',
  'class-sheets': '수학 진도 레일·계획 대비 판정은 계산하지 않음.',
  attendance: '자리(JJ·LAB) 출석부를 따로 가르지 않음. 키오스크 체크인 기록 없음.',
  classes: '인수인계 표가 없어 담임 변경 예약만 셈.',
  makeups: '새 보강 처리 표는 기록이 없어 예약·출결만 셈.',
  textbooks: '차수별 진도·과제 내용은 싣지 않음.',
  'lesson-reports': '현재 평점 기준만. ClassNote 반 보드 상태는 외부 연동에서.',
  'class-review': '포트폴리오 점수 값은 의도적으로 뺌.',
  students: '자동 판정 형제는 계산하지 않음(저장된 지정만).',
  'student-contribution': '월별 기여도 점수 값은 싣지 않음.',
  exams: '시험 등록 표는 2.0 결정대로 쓰지 않음.',
  consultations: '상담 내용·AI 분석 본문은 싣지 않음.',
  enrollment: '같은 학생 묶기(same-person) 판정은 하지 않음. 과목은 적힌 글 그대로(알려진 키만 라벨).',
  retention: '2.0 화면이 즉석 계산하는 위험도는 만들지 않음(창작 금지).',
  newcomers: '첫 수업일 기준 항목의 기한 지남 판정은 하지 않음.',
  withdrawals: '"이번 달 끝난 수강"은 같은 과목 계속 수강 여부를 따지지 않은 원자료 — 퇴원관리의 수강종료 판정과 다를 수 있음.',
  'withdrawal-reports': '승인자별 결정 내역은 싣지 않음.',
  staff: '계약 조건·이력서·급여는 싣지 않음.',
  payroll: '금액·공제는 싣지 않음. 명세서 발급 ≠ 송금.',
  billing: '회차 배분 상세는 싣지 않음. 외화 지출은 원화 합계에서 분리.',
  shuttle: '실시간 위치·현재 시즌 판정 없음.',
  inventory: '업체 정보는 싣지 않음.',
  meetings: '회의 내용·전사·AI 분석 본문은 싣지 않음.',
  approvals: '결재자별 결재함은 나누지 않음(원장 전체 보기).',
  documents: '열람 제한 문서 내용·첨부는 싣지 않음(내려받기는 기존 경로).',
  'owner-settings': '설정 값·권한 표·연동 키는 싣지 않음(횟수·목록만).',
  'teacher-workspace': 'AX 요청의 강사 수신함이 아직 없음.',
  'student-portal': '고정 미리보기 데이터 — 지점 기록 연결 전.',
  'parent-portal': '학부모 계정이 없어 셀 것이 없음.',
  'public-sites': '배포가 고른 브랜드 학원 하나만 공개 — 이 지점이 실제로 보이는지는 배포 설정에 달림.',
  integrations: '오류 원문·연동 키·시트 주소는 싣지 않음. IJW·오늘 수학 상세 없음.',
};
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const value = m => m.value === null ? '—' : `${Number.isInteger(m.value) ? m.value.toLocaleString('ko-KR') : m.value}${m.unit}`;

const s = await loadSnapshot(), ws = s.workspaces, families = Object.values(ws.families);
const count = state => families.filter(f => f.dataState === state).length;
const lines = [
  '# 업무 영역 읽기 모델 커버리지',
  '',
  `\`verify-domain-report.mjs\`가 ${ws.asOf} 로컬 검증 복사본(침산)에서 생성한 표입니다. 숫자는 그대로 옮긴 값이고 근거 기록·이름은 넣지 않았습니다. 데이터 모델이 있다고 2.0 기능과 같은 동작을 한다는 뜻은 아닙니다(마지막 열 참고).`,
  '',
  `패밀리 ${families.length}개 — 사용 가능 ${count('available')} · 빈 상태 ${count('empty')} · 연결 전 ${count('unavailable')} · 원장 범위 밖 ${count('not-applicable')}. 근거 기록 합계 ${families.reduce((n, f) => n + f.totalRecords, 0).toLocaleString('ko-KR')}건(요약 ${families.reduce((n, f) => n + f.records.length, 0)}건만 snapshot.js에 실림).`,
  '',
  '| 패밀리 | 상태 | 주요 지표 | 근거(전체 / 요약) · 출처 | 추이 · 신호 · 분류 | 의미 · 범위 | 하지 않는 것 |',
  '|---|---|---|---|---|---|---|',
  ...families.map(f => `| \`${f.id}\`<br>${cell(f.title)} | ${f.dataState} | ${cell(f.metrics.slice(0, 6).map(m => `${m.label} ${value(m)}`).join(' · ') || '—')} | ${f.totalRecords.toLocaleString('ko-KR')} / ${f.records.length}${f.recordSource ? ` · \`${f.recordSource}\`` : ''}<br>${cell(f.sources.map(x => `${x.table} ${x.rows}`).join(', '))} | ${f.trend ? `${cell(f.trend.label)} ${f.trend.points.length}점(${f.trend.points[0].date}~${f.trend.points.at(-1).date})` : '추이 없음'}<br>${f.signals.length ? cell(f.signals.map(x => `${x.priority}: ${x.title}`).join(' · ')) : '신호 없음'}<br>분류 ${f.facets.length}개 | ${cell(f.sourceLabel)} — ${cell(f.coverageNote)} | ${cell(GAPS[f.id] || '—')} |`),
  '',
];
await writeFile(new URL('./DOMAIN-COVERAGE.md', import.meta.url), lines.join('\n'));
console.log(`DOMAIN-COVERAGE.md · ${families.length} families`);
