# 업무 영역 읽기 모델 (`model.workspaces`)

2.0 기능 인벤토리(`catalog/feature-inventory.json`)의 패밀리 47개마다, 로컬 검증 복사본(침산)에서 읽기 전용으로 계산한 업무 모델입니다. **로컬 개발 시안**이며 운영 이전이 아닙니다. 데이터 모델이 있다고 2.0 기능과 똑같이 동작한다는 뜻은 아닙니다 — 패밀리별로 하지 않는 것은 [`DOMAIN-COVERAGE.md`](DOMAIN-COVERAGE.md) 마지막 열에 있습니다.

## 만들어지는 곳

- `snapshot.mjs`의 같은 읽기 전용 트랜잭션(`127.0.0.1:5444/aywa_full_snapshot`, `tenant_id` = 침산) 안에서 `loadWorkspaces()`가 돈다. 쓰기는 없다.
- 영역별 로더: `domain-snapshot-academic*.mjs`(수업) · `-students*.mjs`(원생) · `-people.mjs`(직원·수납) · `-ops*.mjs`(운영) · `-support.mjs`(설정·연동·역할 셸·범위 밖). 계약 도우미와 검증기는 `domain-snapshot-core.mjs`.
- 모든 쿼리는 고정된 표·열 이름이고 값은 매개변수다. `tenant_id`가 없는 표는 쓰지 않으며, 조인한 표에도 `tenant_id` 조건을 건다. 테스트 학생(`is_test`)은 원생 기준 집계에서 뺀다.
- 기존 기본 모델 필드는 그대로다(새 키 `workspaces`만 추가). 기본 모델의 자유 글에는 아래 가리기만 적용된다.

## 계약

```
workspaces = { asOf, families: { [id]: {
  id, title, summary,
  metrics: [{ label, value: number|null, unit, detail }],
  trend: null | { label, unit, granularity: 'month'|'day', points: [{ date, value }] },
  signals: [{ id, title, summary, priority: '확인 필요'|'결정 필요'|'진행 확인', source, recordIds, draft: { title, body } }],
  facets: [{ id, label, count }],
  records: [{ id, label, detail, date, status, fields: [{ label, value }], facetIds }],   // 요약 ≤ 12
  totalRecords, sourceLabel, dataState, coverageNote,
  sources: [{ table, rows }], recordSource: 'table' | 'table,table' | null              // 출처(화면에 안 보여도 됨)
}}}
```

- **근거 목록(evidence)** = 그 패밀리에 해당하는 기록 전체. `snapshot.js`에는 요약 12건만 싣고 전체는 서버 저장소에만 둔다. `totalRecords` = 근거 전체 수.
- **분류(facets)** 는 근거 목록의 `facetIds`에서 센다 — 분류 칩 숫자와 조회 API 필터 결과가 항상 같다.
- **추이** 는 실제 기록이 있는 첫 달부터만(그 뒤 기록 없는 달은 진짜 0), 기준일을 넘지 않는다. 지난 기간을 추정으로 채우지 않는다.
- **신호** 는 2.0이 스스로 처리 대상으로 보는 상태만(기한 안 발송 실패, 기한 지난 할 일, 승인·결재 대기, 반납 기한 지난 대여, 보강일 지난 예약, 최근 7일 동기화 문제 등). 행 수나 위험 점수는 신호가 아니다. `draft`는 원장이 화면에서 직접 보낼 요청 초안일 뿐이다.
- **dataState**: `available` 지점 기록 있음 · `empty` 기능과 표는 있으나 지점 기록 0건(도움말·이탈 방어 캠페인·학부모 계정) · `unavailable` 화면은 있으나 데이터 연결 전(학생 내 학습) · `not-applicable` 원장 업무 공간 밖(인벤토리 `ownerScope = audit-only` 6개). 기록이 없다는 것은 기능이 없다는 뜻이 아니다.

## 근거 조회 API

`GET /api/workspaces/:familyId/records?q=&facet=&page=&pageSize=` (`domain-http.mjs`, `serve-live.mjs`가 연결)

- `familyId`는 고정 47개 중 하나, `q` ≤ 100자(공백으로 나눈 낱말이 모두 들어간 기록), `facet`은 그 패밀리의 분류 하나, `page` ≥ 1, `pageSize` 1~100(기본 20). 다른 매개변수·중복 매개변수는 400.
- 200: `{ familyId, total, filteredTotal, page, pageSize, pageCount, items, facets }` — `facets`는 검색어를 적용한 뒤(분류 필터 전)의 개수. 끝을 넘은 쪽은 빈 `items`.
- 오류: 400 `invalid_request` · 404 `unknown_family` · 405 `method_not_allowed` · 503 `records_unavailable`. GET/HEAD만, `serve-live.mjs`의 호스트·출처·cross-site 검사를 먼저 지난다.

## 가리기 (화면용 값만, DB는 그대로)

일정 제목·상담 칸 같은 자유 글에 전화번호가 직접 적혀 있었다(근거 기록 기준 일정 2,199건·신규 상담 1건, 기본 모델 일정 520건). `domain-snapshot-mask.mjs`가 이 지점의 실제 연락처·계좌 값을 읽어 두고, `scrub()`이

- 이메일 주소, 구분자가 있는 유선번호(`053-123-4567`), 휴대폰(`010…`, 구분자 있거나 없거나, `+82` 포함),
- 숫자가 실제 연락처·계좌 값과 같은 묶음(날짜·학년에 붙어 있어도 그 부분만)

을 `연락처 가림`으로 바꾼다. 금액·날짜·ID·일반 참조 번호는 그대로다(`verify-domain-core.mjs`가 잠금). 근거 기록 전체와 기본 모델의 자유 글(일정 제목, 학부모 글·답글, 상담 요약·후속 조치, 진도, 할 일, 결재, 문서, 지출 제목)에 적용된다. 연락처 열 자체(전화·이메일·주소)는 처음부터 읽지 않는다.

## 2.0 의미의 출처

| 영역 | 기준 | 2.0 출처 |
|---|---|---|
| 직원 명부 | 학생 계정 제외, 퇴사자 포함(기본 보기 재직). 운영 지원 계정은 `super_admins` 기준으로 '관리자'로만 표시 — 권한·집계 대상은 그대로. 전체 명부 63명 · 현재 재직 27명, 재직 강사 12명은 강사 작업 공간에만 | `src/features/staff/server/queries.ts` `getStaffList`, `src/app/(shell)/staff/page.tsx` `displayRoleFor`, `src/lib/auth/role-hierarchy.ts` `ROLE_LABEL` |
| 퇴원 | 학생 상태 퇴원, 수업 기록 없는 장부 정리 제외, 날짜 미상 시스템 정리 구분, 사유 표·별칭 | `src/features/withdrawals/system-bulk.ts`, `src/features/withdrawals/types.ts` |
| 수납 | 청구액 = 할인 전 − 할인, 잔액 = 청구액 − 수납, 취소·환불 제외 (10월 잔액 329,000원·14건) | `snapshot.mjs` 기본 모델(같은 계산) |
| 출석률 | (출석 + 지각) ÷ 기록 칸 전부, 보강은 출석 아님, 정정 줄은 최신만 | CLAUDE.md 출석 결정, `snapshot.mjs` |
| 신규생 | 등록일부터 90일 창(0~7·8~30·31~60·61~90일), 첫 수업일 기준 항목은 기한 판정 안 함 | `src/features/newcomers/onboarding-items.ts` |
| 보고서 발송 | 발송 기한 = 오늘 포함 7일, 평점은 현재 기준만 | CLAUDE.md 수업보고서 결정 |
| 긍정 신호 | 인정 = `observed`이고 취소 안 됨 | `src/features/student-contribution/components/presentation.ts` |
| 지출결의서 | 작성자 역할이 강사인 결의서, 결재 완료 = 원장·대표 둘 다 | `src/app/(shell)/expense-requests/page.tsx`, `src/features/billing/server/expense-actions.ts` |
| 교재 요청 | 소유자 = 요청 선생님(`teacher_name`), 대리 작성 포함 | CLAUDE.md gotcha #93 |
| 시간표 | 기준일에 유효한 배치 행만(이력 행 제외) | CLAUDE.md gotcha #88 |
| 과목 라벨 | 학원 설정 `operations.subjects`, 미등록 키는 옛 라벨로만 | `src/features/owner/subjects.ts` |
| 공개 랜딩 | 화면이 쓰는 이름·지점 표시·로고 문구·로고 유무만 | `src/features/owner/server/public-branding.ts` |

인벤토리 이름과 다른 실제 표: 회의록 `meeting_minutes`, 녹음 `consultation_recordings`, 영어 시트 학생 기록 `class_sheet_student_marks`, 영상 검사 `video_homework_marks`·`video_homework_auto_outcomes`, 환불 = 청구 상태 `refunded` + 문서 `refund_request`, 수업 평가 = 문서 `class_review` + `teacher_portfolio_months`, 휴가 `leave_forms`, 등하원 변경 `shuttle_ride_exceptions`, 퇴원보고서 승인 = `withdrawal_reports` 상태.

## 비서(Claude) 문맥

`claude-bridge-context.mjs`가 `[업무 영역 집계]` 블록을 붙인다 — 패밀리 짧은 제목(괄호 앞)과 지표 이름·숫자(최대 6개)만, 근거 기록·세부 문구·이름은 없다. 범위 밖 패밀리는 빼고 빈 상태는 "기록 없음". 이슈를 고르면 그 이슈의 패밀리 한 줄만(`billing→billing`, `admissions→enrollment`, `attendance→attendance`, `approval→approvals`, `tasks→tasks-notifications`, `books→textbook-requests`, `enrollment→students`). 급여·포트폴리오는 건수만 있다.

## 검증

```powershell
node --test experiments/owner-concept/verify-domain-core.mjs     # DB 없이: 가리기 보존·추이·계약 검증기·조회 API
$env:OWNER_CONCEPT_INVENTORY='<feature-inventory.json>'; node experiments/owner-concept/verify-domain-snapshot.mjs   # 로컬 DB
node experiments/owner-concept/verify-domain-report.mjs          # DOMAIN-COVERAGE.md 다시 생성
```

`verify-domain-snapshot.mjs`는 인벤토리 ID 대응(audit-only = 범위 밖), 기본 모델 키 불변, 기본 모델·AX 이슈와 같은 숫자, 표 전체가 근거인 패밀리의 독립 건수, 근거 ID가 선언된 표의 이 지점 행인지(다른 지점 행 0), `snapshot.js` 전체와 근거 저장소에 실제 연락처·토큰·계좌 값과 전화·이메일 형태가 없는지, 날짜, 조회 API, 비서 문맥의 이름·급여 비노출, 옮겨 적은 2.0 라벨 표가 원본과 같은지를 확인한다. 인벤토리 기본 경로는 `catalog/feature-inventory.json`(카탈로그 병합 후).

## 남은 한계

- 스냅샷은 서버 시작 때 한 번 읽는다(약 8초). 근거 저장소는 서버 메모리(약 5만 7천 건)에 있다.
- 기록이 시작되기 전 기간(예: 에이와 보고서는 2026-07부터, 이전은 옮긴 기록)은 coverageNote에 적었고, 추이는 실제 기록이 있는 달만 그린다.
