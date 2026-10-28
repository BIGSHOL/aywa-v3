# 3차 합의 7번 — 원생 통계·성적관리

## 이식한 경로

- 원생목록 `통계 보기` → `/students/stats`: 2.0 `loadStudentStats`를 Docker 읽기 트랜잭션에서 실행하고, 원본의 재원생·강좌수·첫 수업·등록/퇴원·지난 기록 다섯 카드와 기간/과목 보기를 사용한다. 로더가 반환하는 카드별 Promise는 전용 읽기 작업 스레드에서 모두 기다린다. `saveStudentStatsPrefs`는 원본 서버 액션이다.
- `/exams`: 2.0 `getUnifiedGrades`, `gradeWriteError`, `getTenantSettings`, `goalViewsForRows`, `getStudentGradeGoals`, `loadTodaysMathMarks`를 원본 함수로 실행한다. 원본 여섯 탭의 JSX를 생성기에서 조회 자리만 치환해 사용한다. 원장·학생 이름 링크에서 `/students/<id>?tab=grades`로 이동한다.
- `/exams/input`, `/exams/view`: 2.0 `getGradeSheet`, `getGradeOverview`, `loadGradeSortPref`, `loadTodaysMathMonthly` 원본 함수와 입력 격자·학기 확인 표 부품을 사용한다. 저장은 원본 `saveGradeScores`, `createUnifiedGrade`, `saveUnifiedGrade`, `saveGradeSortPref`만 받는다.
- 인재원 JJ실 수치는 Docker에 없고 2.0이 외부 API에 매번 묻는다. 바깥 요청 0 조건에 따라 `/exams?view=jj*`와 `/exams/jj/**`에는 실시간 성적을 열 수 없다는 안내를 낸다. 엑셀 기능도 3.0 호스트의 기존 미지원 안내를 따른다.

## 확인

- 4310과 같은 `aywa_full_snapshot`을 **읽기 전용**으로 직접 조회: 원생 통계 다섯 카드, 성적 원본 기록 4,571건·학생 522명, 학기 입력 명단 72명, 학기 확인 시험 열 3개. 실제 4310 프로세스에는 새 화면 등록을 반영하는 재시작이 필요하다.
- 4310 호스트를 격리 빌드하고 브라우저에서 Docker 조회 결과를 API 응답으로 연결: 통계 다섯 카드, 성적 여섯 탭, 성적 현황 723건 중 첫 50줄, 학기 입력 격자, 학기 확인 표가 렌더됐다. 성적 원장의 학생 링크는 `students.html?v2path=/students/<id>&tab=grades`로 이동했다. 브라우저 오류 0, 바깥 요청 0, POST 0.
- `aywa_full_sandbox`(4311 시험장 DB), 메모 칸 없는 성적 격자에서 **시험장 검증**: 학생 `590aa1c5-0b4d-4fe8-ba1b-e20dd8011b67` 정채민, 2026년 2학기 수학 중간고사, 2026-10-29, 만점 100. 저장 전 GET 점수 `null` → 원본 `saveGradeScores` 응답 `{ok:true,saved:1,cleared:0}` → 저장 후 GET 점수 `81`. Docker `net.http_request_queue` 전후 `0→0`. 직접 SQL 쓰기는 없었다. 4311 실행 프로세스에도 새 화면 등록을 반영하는 재시작이 필요하므로 HTTP 경로의 후속 확인은 재시작 뒤 한다.
- `node --test experiments/owner-concept/verify-v2-review3-exams.mjs`: 4/4 통과. 원본 본문 생성기 네 개 `--check` 통과. 격리 호스트 빌드와 변경 TSX ESLint 통과. 좁힌 TypeScript 검사에서 이번 변경 파일 오류는 없고, 기존 `students-form.tsx`, `students-list.tsx`, `students-tab-*`, `src/components/*.module.css` 참조 오류만 확인됐다.

## 적대적 리뷰

- 학기 입력 저장은 원본 함수 한 건을 Docker 쓰기 러너에서 실행하고, 바깥 요청 대기열이 늘면 트랜잭션을 되돌린다. 저장 행위자 UUID·모듈 이름·폼 모양을 화면 경계에서 검사하고, 원본 `gradeWriteError`가 다시 권한을 검사한다.
- JJ 주소를 일반 성적 격자로 잘못 표시할 수 있던 경로를 명시적 안내로 바꿨다. 다른 화면의 학생 링크로 iframe이 넘어갈 때 3.0 해시도 해당 화면으로 맞추도록 했다.
- 서버 함수의 반환값을 브라우저에서 새로 계산하지 않는다. 통합 성적의 순수 필터·쪽 계산은 2.0 모델 함수를 사용하고, 화면 본문은 생성기 `--check`로 원본 글자와 대조한다.
