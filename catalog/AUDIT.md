# 2.0 전체 기능 감사 · 3.0 AX 갭

> 기준 커밋 `3ffa7f58f109d0a443ff48a58ee5b9ca689d5af3` · 로컬 복사본 DB 읽기 `2026-10-27T07:54:13.759Z` · 기계 판독본 [`feature-inventory.json`](feature-inventory.json) · 검증기 [`verify-catalog.mjs`](verify-catalog.mjs)
> <!-- inventory-sha256: 98d5985f25cc8b72c2dd2a3799aa1436fb23f1a4325cbbdf826e50efda8e4123 -->

## 1. 결론

- **라우트 회계 완료**: 페이지 186개·API 92개(크론 핸들러 24개, vercel 일정 23개)·기능 모듈 80개·서버 액션 파일 252개(export 730개)·권한 메뉴 키 53개·내비/탭 항목 231개가 전부 47개 패밀리에 배정됐다. 검증기의 설명되지 않은 누락은 0건이다.
- 사용자 화면이 아닌 라우트는 클래스로 명시했다: auth 2 · detail 36 · dev 2 · device 2 · form 17 · platform 13 · portal 5 · print 12 · public-share 9 · redirect 10 · screen 72 · stats 6.
- 화면 게이트: custom-gate 24 · layout-gate 14 · menu-gate 128 · public-by-design 14 · session-only 1 · verified-in-loader 5 — 메뉴 게이트가 없는 화면은 레이아웃·재-export 뷰·원문 확인(verifiedGates)으로 판정했고 `none-detected`는 0건이다.
- 핵심 동작 189개는 실제 서버 액션 export 이름(또는 API·페이지)으로 근거를 달았고 검증기가 존재를 확인한다.
- 현재 AX(시안 13 + AX 4)는 **실제 쓰기를 하나도 하지 않는다**. 세션 메모리 흉내 동작 19종(advance-lead, approve, bill-note, calendar-note, close-menu, complete-task, event-note, lead-note, menu, message-draft, new-lead, new-task, reject, reply-draft, report-note, save-name, student-note, student-task, today)과 AX 이슈 7종(수납·상담·출결·결재·업무·교재·경영)이 전부다.
- AX에 전혀 없는 패밀리 16개: 교재목록(커리큘럼·반 배정), 직원 평가·직원 포트폴리오, 신규생 관리(90일 체크리스트), 회의록(녹음·AI 분석), 고객센터(공지·개선요청), 도움말(설명서·질문 게시판), 강사 작업 공간(미니셸·내 정보·뷰 전환), 학생 내 학습, 학부모 포털(셔틀·시간표), 공개 랜딩(제품·학원), 로그인·세션·링크 만료·지점 보기 안내, 운영 콘솔(슈퍼관리자), 외부 연동(makeedu·구글 시트·오늘 수학·IJW), 녹음·전사 파이프라인, 데모 지점 갱신, 개발용 화면.
- 불확실성은 0으로 꾸미지 않았다: 남은 패밀리 기록 6건 + 자동 감지 1건 + 메모 3건(§11). 원문을 읽어 해소한 것 4건은 따로 적었다.
- 검증 수준: reviewed 34 · source-read 13 패밀리. API 라우트 92개는 메서드·크론·테이블을 기계 추출한 `auto` 수준이다.

## 2. 방법

1. `scan-source.mjs` — `src/app`의 모든 `page`/`route` 파일, `"use server"` 파일의 export, `src/features/*`, `vercel.json` 크론, 권한 키(`MENU_LABEL`), 내비·탭 소스 34개 파일(TS AST), 화면 안 카탈로그(위젯·알림 유형·할 일 종류·설정 카드·상세 탭)를 읽는다. 라우트 그룹 `(x)`는 Next 규약대로 URL에서 뺀다.
2. `families.mjs` — 감사자가 페이지 머리 주석·제목·게이트·서버 액션 export 다이제스트를 읽고 47개 패밀리로 묶었다. 배정은 접두사 최장 일치·모듈 단일 소유라 사람 판단이 끼지 않는다. 핵심 동작·AX 갭·제안 진입점은 큐레이션이다.
3. `db-availability.mjs` — 로컬 Docker 복사본(127.0.0.1:5444)을 `read only` 트랜잭션으로 열어 337개 테이블의 전체 행 수와 침산(cs) 지점 행 수를 센다. 원본 DB·원본 env는 쓰지 않았다.
4. `assemble.mjs` — 위 셋을 합쳐 배정 누락·없는 함수 이름·없는 테이블·풀리지 않는 내비 주소를 문제로 낸다. 문제가 있으면 `build-inventory.mjs`가 파일을 쓰지 않는다.
5. `verify-catalog.mjs` — 새로 스캔한 소스와 커밋된 인벤토리를 집합 비교하고 assemble을 다시 돌려 0건인지 확인한다(§12).

## 3. 역할별 작업 공간

| 역할(시스템) | 셸·입구 | 근거 |
| --- | --- | --- |
| master·admin·manager·accountant·counselor·viewer | 관리자 풀셸(사이드바 업무군 8 + 지원 2, 창 모드) — 홈 = /dashboard | src/lib/menu-hub.ts HUB_GROUPS·SUPPORT_GROUPS, src/app/(shell)/layout.tsx |
| teacher | 강사 미니셸 "내 메뉴" 19개 링크 — 홈 = /onescreen(영어 전담 = /ecs), 언어 한국어/English | src/lib/teacher-menu-links.ts, src/app/home/route.ts |
| 겸직(관리자 계열 + 담당 반) | 강사뷰 ↔ 관리자뷰 전환, 다른 강사 뷰(열람 전용) | src/features/shell/view-actions.ts |
| student | /my-learning (데모 데이터, DB 미연동) | src/app/(shell)/my-learning/page.tsx 머리 주석 |
| parent | /parent — 탭 5칸 중 기능 3(실시간 차량·등하원 변경·수업 시간표) | src/app/(parent)/parent/_components/parent-tabs.tsx |
| super_admin(플랫폼) | /super-admin 운영 콘솔 6메뉴 — 지점 화면과 분리 | src/components/super-admin/nav.ts |
| device | /kiosk(출석 키오스크), /seat/[seat](자리 PIN) | src/app/(kiosk), src/app/(seat) |
| public | /, /academy, /intake/[token], /staff-intake/[token], /r/[token], /v, /v/[token], /expired, /inventory/asset/[code] | (marketing)·(academy)·(intake)·(share)·(asset) 그룹 |

시스템 역할 원본: `src/lib/permissions.ts` SYSTEM_ROLES = master, admin, manager, teacher, counselor, accountant, viewer, student.

## 4. 패밀리 목록

원장 범위(ownerScope): `owner` = 원장 AX에 표시 · `owner-linked` = 다른 역할의 화면이지만 원장 업무와 연결(관리·미리보기·요청 목적지) · `audit-only` = 감사 기록용(숨긴 것이 아니라 원장 화면 대상이 아님). 쓰기 경로(writePath): `reuse-2.0-actions` · `reuse+new-storage`(2.0에 없는 저장소 필요) · `read-only`(근거·미리보기) · `n/a`. 시안 동작은 모두 세션 전용이므로 운영 백엔드 이관은 별도 작업이다.

| 패밀리 | 영역 | 원장 범위 | 2.0 상태 | 페이지 | API | 핵심 동작 | AX | 쓰기 경로 | 우선 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard` 대시보드(운영실) | 홈 | owner | implemented | 3 | 1 | 6 | simulated | reuse-2.0-actions | P0 | source-read |
| `calendar` 캘린더 | 홈 | owner | implemented | 1 | 2 | 2 | simulated | reuse-2.0-actions | P2 | reviewed |
| `tasks-notifications` 할 일·알림(벨·푸시) | 홈 | owner | implemented | 0 | 6 | 2 | simulated | reuse+new-storage | P0 | source-read |
| `slack` 슬랙 연동 | 홈 | owner | implemented | 0 | 1 | 4 | simulated | reuse-2.0-actions | P1 | reviewed |
| `onescreen` 선생님 원스크린(수업 마감) | 수업 | owner-linked | implemented | 1 | 1 | 8 | read-only | reuse-2.0-actions | P0 | reviewed |
| `video-homework` 영상 숙제(제출 사이트·장부·AI 검토) | 수업 | owner | implemented | 4 | 15 | 5 | read-only | reuse-2.0-actions | P1 | reviewed |
| `timetable` 시간표(배치·가져오기·편집기·메모) | 수업 | owner | partial | 3 | 8 | 7 | read-only | reuse-2.0-actions | P1 | source-read |
| `class-sheets` 강사 시트(영어 ECS·수학 MCS) | 수업 | owner | partial | 10 | 0 | 6 | read-only | read-only | P1 | source-read |
| `attendance` 출석부(월별·오늘·출결 모드·자리·키오스크) | 수업 | owner | implemented | 16 | 1 | 9 | read-only | reuse-2.0-actions | P0 | source-read |
| `classes` 수업목록(반·수강·인수인계) | 수업 | owner | implemented | 4 | 3 | 6 | read-only | reuse-2.0-actions | P1 | reviewed |
| `makeups` 보강관리 | 수업 | owner | implemented | 6 | 0 | 3 | read-only | reuse-2.0-actions | P1 | reviewed |
| `textbooks` 교재목록(커리큘럼·반 배정) | 수업 | owner | implemented | 1 | 0 | 5 | absent | read-only | P2 | reviewed |
| `lesson-reports` 수업보고서·ClassNote 발송 | 수업 | owner | implemented | 4 | 6 | 7 | simulated | reuse-2.0-actions | P0 | reviewed |
| `class-review` 직원 평가·직원 포트폴리오 | 수업 | owner | partial | 6 | 1 | 5 | absent | read-only | P2 | reviewed |
| `students` 원생목록·원생 상세·원생 통계 | 원생 | owner | implemented | 5 | 3 | 7 | simulated | reuse-2.0-actions | P0 | reviewed |
| `student-contribution` 원생 기여도(온톨로지·소개) | 원생 | owner | implemented | 5 | 1 | 4 | read-only | read-only | P2 | source-read |
| `exams` 성적관리(통합·입력·확인·JJ실) | 원생 | owner | implemented | 6 | 2 | 3 | read-only | read-only | P1 | reviewed |
| `consultations` 원생상담(재원생 상담·AI 분석) | 원생 | owner | implemented | 5 | 1 | 3 | read-only | reuse-2.0-actions | P1 | reviewed |
| `enrollment` 신규 콜&상담(QR 접수·브리프·인수인계) | 원생 | owner | implemented | 7 | 1 | 6 | simulated | reuse-2.0-actions | P0 | reviewed |
| `retention` 이탈 방어 | 원생 | owner | implemented | 4 | 0 | 2 | read-only | reuse-2.0-actions | P1 | reviewed |
| `newcomers` 신규생 관리(90일 체크리스트) | 원생 | owner | implemented | 2 | 0 | 1 | absent | reuse-2.0-actions | P1 | reviewed |
| `withdrawals` 퇴원관리 | 원생 | owner | implemented | 2 | 1 | 2 | read-only | read-only | P1 | reviewed |
| `withdrawal-reports` 퇴원보고서(작성·순차 승인·옛 시트) | 원생 | owner | implemented | 4 | 0 | 3 | read-only | reuse-2.0-actions | P1 | reviewed |
| `staff` 직원관리(명부·계약·이력서·휴가·연차) | 운영 | owner | implemented | 13 | 0 | 8 | read-only | read-only | P1 | reviewed |
| `payroll` 급여·명세서·강사 정산 | 운영 | owner | implemented | 1 | 0 | 3 | read-only | read-only | P2 | reviewed |
| `billing` 수납관리(청구·교재·지출·계산기·회차 확정·환불·정산) | 운영 | owner | implemented | 5 | 3 | 8 | simulated | reuse-2.0-actions | P0 | reviewed |
| `textbook-requests` 교재 요청(강사) | 운영 | owner-linked | implemented | 2 | 0 | 3 | read-only | read-only | P1 | reviewed |
| `expense-requests` 지출결의서(강사 제출) | 운영 | owner-linked | implemented | 2 | 0 | 1 | read-only | read-only | P2 | reviewed |
| `shuttle` 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치) | 운영 | owner | partial | 8 | 0 | 7 | read-only | read-only | P2 | reviewed |
| `inventory` 재고관리(자산·대여·실사·소모품·업체) | 운영 | owner | implemented | 3 | 2 | 6 | read-only | read-only | P2 | reviewed |
| `meetings` 회의록(녹음·AI 분석) | 운영 | owner | implemented | 4 | 0 | 4 | absent | reuse+new-storage | P2 | reviewed |
| `approvals` 전자결재(기안·결재함) | 운영 | owner | implemented | 3 | 0 | 4 | simulated | reuse-2.0-actions | P1 | source-read |
| `documents` 데이터베이스(서식·문서 저장소) | 운영 | owner | implemented | 3 | 1 | 4 | read-only | read-only | P2 | reviewed |
| `support` 고객센터(공지·개선요청) | 지원 | owner | implemented | 9 | 0 | 2 | absent | read-only | P3 | reviewed |
| `owner-settings` 학원 설정(18면)·관리자 도구 | 지원 | owner | implemented | 6 | 2 | 7 | simulated | reuse-2.0-actions | P1 | source-read |
| `help` 도움말(설명서·질문 게시판) | 지원 | owner | implemented | 5 | 0 | 1 | absent | read-only | P3 | reviewed |
| `teacher-workspace` 강사 작업 공간(미니셸·내 정보·뷰 전환) | 역할 셸 | owner-linked | implemented | 1 | 0 | 3 | absent | reuse+new-storage | P1 | source-read |
| `student-portal` 학생 내 학습 | 역할 셸 | owner-linked | partial | 2 | 0 | 1 | absent | read-only | P3 | reviewed |
| `parent-portal` 학부모 포털(셔틀·시간표) | 역할 셸 | owner-linked | partial | 4 | 0 | 3 | absent | read-only | P3 | source-read |
| `public-sites` 공개 랜딩(제품·학원) | 공개 | audit-only | implemented | 2 | 0 | 1 | absent | n/a | P3 | reviewed |
| `auth-session` 로그인·세션·링크 만료·지점 보기 안내 | 공개 | audit-only | implemented | 4 | 4 | 1 | absent | n/a | P3 | source-read |
| `platform-console` 운영 콘솔(슈퍼관리자) | 플랫폼 | audit-only | implemented | 8 | 0 | 5 | absent | n/a | P3 | source-read |
| `integrations` 외부 연동(makeedu·구글 시트·오늘 수학·IJW) | 연동 | owner | implemented | 0 | 20 | 5 | absent | reuse-2.0-actions | P1 | reviewed |
| `recording-transcription` 녹음·전사 파이프라인 | 연동 | audit-only | implemented | 0 | 3 | 1 | absent | n/a | P2 | reviewed |
| `shell-infrastructure` 공용 기반(검색·동시편집·메뉴 기록·최대화·내보내기·통계·학교명) | 기반 | audit-only | implemented | 0 | 2 | 3 | simulated | n/a | P1 | reviewed |
| `demo-tenant` 데모 지점 갱신 | 기반 | audit-only | implemented | 0 | 1 | 1 | absent | n/a | P3 | reviewed |
| `dev-tools` 개발용 화면 | 기반 | audit-only | implemented | 2 | 0 | 1 | absent | n/a | P3 | source-read |

범위별 수: owner 34 · owner-linked 6 · audit-only 7.

## 5. 갭 매트릭스 — 시안 13 + AX 4 대비

시안 화면(시안 라벨 → AX 라벨): `home` 경영 흐름→브리핑 · `students` 학생 · 재원 관리→원생목록 · `admissions` 입학 · 상담→신규 콜&상담 · `classes` 수업 · 시간표→수업목록 · 시간표 · `learning` 학습 · 성과→성적관리 · 수업보고서 · `finance` 수납 · 재무→수납관리 · `staff` 직원 · 급여→직원관리 · `parents` 학부모 소통→학부모 소통 · `shuttle` 차량 · 안전→셔틀 · `approvals` 업무 · 결재→전자결재 · 할 일 · `resources` 교재 · 자산 · 문서→교재 · 재고 · 서식 · `calendar` 학원 일정→캘린더 · `settings` 학원 설정→학원 설정. AX 화면: `home` 브리핑 · `inbox` 알림 · `requests` 요청한 업무 · `automation` 자동화.

| 우선 | 패밀리 | 원장 범위 | 2.0 | AX | 쓰기 경로 | 시안 화면 | AX 화면·이슈 | cs 데이터 있는 핵심 표 | 시안 스냅샷 포함 | 판정 | 제안 진입점 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 출석부(월별·오늘·출결 모드·자리·키오스크) | owner | implemented | read-only | reuse-2.0-actions | students | home, inbox, issue:attendance | 3/4 | 3/4 | ui-partial | issue — 결석·미입력·데스크 확인 대기를 이슈로, 할 일 attendance_absent_desk(결석 확인 전화)를 요청 흐름으로 |
| P0 | 수납관리(청구·교재·지출·계산기·회차 확정·환불·정산) | owner | implemented | simulated | reuse-2.0-actions | finance | home, inbox, issue:billing, issue:books, issue:enrollment | 6/6 | 4/6 | ui-partial | issue — 잔액·미납 누적(알림 outstanding_alert)을 이슈로, 청구 상세를 근거로, 안내는 요청으로 |
| P0 | 대시보드(운영실) | owner | implemented | simulated | reuse-2.0-actions | home | home, issue:enrollment, issue:billing | 3/4 | 1/4 | ui-partial | issue — KPI·위젯의 변화를 이슈로 띄우고 위젯 자체를 근거 카드로 재사용(카드→원본 화면 딥링크) |
| P0 | 신규 콜&상담(QR 접수·브리프·인수인계) | owner | implemented | simulated | reuse-2.0-actions | admissions | home, inbox, issue:admissions | 2/2 | 1/2 | ui-partial | issue — 다음 상담 기한·장기 미결을 이슈로(할 일 enrollment_followup), 상담 카드를 근거로 |
| P0 | 수업보고서·ClassNote 발송 | owner | implemented | simulated | reuse-2.0-actions | parents, learning | — | 5/5 | 3/5 | ui-partial | issue — 발송 실패·미발송·미응답 학부모 글을 이슈로(할 일 report_send_failed·unsent_report), 답글은 원장 확인 후 요청 |
| P0 | 선생님 원스크린(수업 마감) | owner-linked | implemented | read-only | reuse-2.0-actions | learning, parents | — | 4/4 | 2/4 | ui-partial | request — 미작성·미발송 보고서 이슈 → 해당 강사에게 요청 → 원스크린 해당 반·날짜 딥링크 |
| P0 | 원생목록·원생 상세·원생 통계 | owner | implemented | simulated | reuse-2.0-actions | students | home, issue:attendance, issue:enrollment | 4/5 | 4/5 | ui-partial | evidence — 원생 상세를 모든 이슈의 공통 근거 패널로, 상태 전환은 요청/명령으로 |
| P0 | 할 일·알림(벨·푸시) | owner | implemented | simulated | reuse+new-storage | approvals | inbox, requests, issue:tasks | 4/4 | 2/4 | ui-partial | request — AX 요청한 업무를 staff_tasks와 같은 표면에 놓되, 자동 종료 규칙(사실 기반)과 사람이 보낸 요청을 구분하는 새 저장소 설계 필요 |
| P1 | 전자결재(기안·결재함) | owner | implemented | simulated | reuse-2.0-actions | approvals | home, inbox, issue:approval | 2/2 | 2/2 | ui-partial | issue — 내 차례 결재(할 일 approval_turn)를 결정 이슈로, 승인·반려는 실제 decideDocument 경로로 |
| P1 | 강사 시트(영어 ECS·수학 MCS) | owner | partial | read-only | read-only | learning | — | 5/5 | 0/5 | ui-partial | issue — 작성 누락·계획 대비 차이(/ecs/plan-gap 판정)를 이슈로, 반 시트를 근거로 |
| P1 | 수업목록(반·수강·인수인계) | owner | implemented | read-only | reuse-2.0-actions | classes | — | 4/4 | 3/4 | ui-partial | evidence — 반 상세를 근거 패널로, 반 개설·이동은 요청/명령으로 |
| P1 | 원생상담(재원생 상담·AI 분석) | owner | implemented | read-only | reuse-2.0-actions | students | — | 1/1 | 1/1 | ui-partial | issue — 후속조치 기한(할 일 followup_due)을 이슈로, 상담 기록을 근거로 |
| P1 | 성적관리(통합·입력·확인·JJ실) | owner | implemented | read-only | read-only | learning | — | 1/2 | 1/2 | ui-partial | issue — 성적 급락·미응시를 이슈로, 시험별 결과를 근거로 |
| P1 | 외부 연동(makeedu·구글 시트·오늘 수학·IJW) | owner | implemented | absent | reuse-2.0-actions | — | — | 5/5 | 0/5 | data-available-ui-absent | issue — 연동 실패(알림 makeedu_login_failed·slack_broken)를 이슈로, 설정 딥링크 |
| P1 | 보강관리 | owner | implemented | read-only | reuse-2.0-actions | calendar, classes | — | 3/4 | 2/4 | ui-partial | issue — 미처리 보강 분·기한 임박 사례를 이슈로, 보강 상세를 근거로 |
| P1 | 신규생 관리(90일 체크리스트) | owner | implemented | absent | reuse-2.0-actions | — | — | 1/1 | 1/1 | data-available-ui-absent | issue — 체크 기한이 지난 신입생을 이슈로 |
| P1 | 학원 설정(18면)·관리자 도구 | owner | implemented | simulated | reuse-2.0-actions | settings | automation | 5/5 | 1/5 | ui-partial | settings — AX 설정은 2.0 OWNER_FACES를 그대로 열고, AX 고유 규칙(이슈·요청)만 새 면으로 |
| P1 | 이탈 방어 | owner | implemented | read-only | reuse-2.0-actions | students | — | 1/2 | 1/2 | ui-partial | issue — 이탈 위험 원생을 이슈로, 로스터를 근거로, 캠페인 추가는 명령으로 |
| P1 | 공용 기반(검색·동시편집·메뉴 기록·최대화·내보내기·통계·학교명) | audit-only | implemented | simulated | n/a | — | home | 1/1 | 1/1 | ui-partial | command — AX 명령 입력이 2.0 팰릿 검색을 재사용 |
| P1 | 슬랙 연동 | owner | implemented | simulated | reuse-2.0-actions | — | automation | 4/4 | 0/4 | ui-partial | settings — AX 자동화 화면을 2.0 slack_rules 구조(범주 12·프리셋 4·전달 이벤트 38)에 그대로 맞춘다 |
| P1 | 직원관리(명부·계약·이력서·휴가·연차) | owner | implemented | read-only | read-only | staff | — | 3/5 | 3/5 | ui-partial | request — AX 요청의 담당자 선택 원천(users·직급·부서), 휴가·계약 만료를 이슈로 |
| P1 | 강사 작업 공간(미니셸·내 정보·뷰 전환) | owner-linked | implemented | absent | reuse+new-storage | — | — | 1/1 | 1/1 | data-available-ui-absent | request — AX 요청의 수신 측 — 강사 미니셸에 요청함(확인·완료 보고)을 붙여야 흐름이 닫힌다 |
| P1 | 교재 요청(강사) | owner-linked | implemented | read-only | read-only | resources | home, inbox, issue:books | 1/1 | 1/1 | ui-partial | issue — 요청·주문 상태 교재를 이슈로(시안과 동일), 처리는 수납 교재 면 딥링크 |
| P1 | 시간표(배치·가져오기·편집기·메모) | owner | partial | read-only | reuse-2.0-actions | classes | — | 5/7 | 2/7 | ui-partial | evidence — 시간표를 근거 패널로(학생·강사 충돌 근거), 편집은 2.0 편집기 딥링크 |
| P1 | 영상 숙제(제출 사이트·장부·AI 검토) | owner | implemented | read-only | reuse-2.0-actions | learning | — | 5/5 | 1/5 | ui-partial | issue — 미배정 영상·업로드 실패(할 일 video_unassigned·video_upload_check)를 이슈로, 장부를 근거로 |
| P1 | 퇴원보고서(작성·순차 승인·옛 시트) | owner | implemented | read-only | reuse-2.0-actions | approvals | issue:tasks | 4/4 | 2/4 | ui-partial | request — 승인 대기 보고서를 결정 이슈로(할 일 withdrawal_step), 승인은 원장 결정 버튼 |
| P1 | 퇴원관리 | owner | implemented | read-only | read-only | students | — | 2/2 | 2/2 | ui-partial | evidence — 청구 대상 감소 이슈의 근거로 퇴원·수강종료 목록 연결 |
| P2 | 캘린더 | owner | implemented | simulated | reuse-2.0-actions | calendar | — | 2/2 | 1/2 | ui-partial | evidence — 일정을 이슈 근거(입테·첫수업·휴원일)로 연결, 일정 추가는 명령 입력으로 |
| P2 | 직원 평가·직원 포트폴리오 | owner | partial | absent | read-only | — | — | 2/4 | 1/4 | data-available-ui-absent | evidence — 원장 전용 근거(직원 성과)로만, 이슈화는 원장 결정 후 |
| P2 | 데이터베이스(서식·문서 저장소) | owner | implemented | read-only | read-only | resources | — | 2/2 | 1/2 | ui-partial | evidence — 요청에 서식을 첨부하는 근거 저장소로 |
| P2 | 지출결의서(강사 제출) | owner-linked | implemented | read-only | read-only | finance | — | 1/1 | 1/1 | ui-partial | evidence — 결재 이슈의 근거로 |
| P2 | 재고관리(자산·대여·실사·소모품·업체) | owner | implemented | read-only | read-only | resources | — | 5/5 | 2/5 | ui-partial | evidence — 실사 누락·소모품 부족을 낮은 우선순위 이슈로 |
| P2 | 회의록(녹음·AI 분석) | owner | implemented | absent | reuse+new-storage | — | — | 1/1 | 0/1 | data-available-ui-absent | command — 회의 결정 사항을 요청(담당자·기한)으로 바로 넘기는 명령 |
| P2 | 급여·명세서·강사 정산 | owner | implemented | read-only | read-only | finance, staff | — | 1/2 | 2/2 | ui-partial | evidence — 원장 전용 근거로만(외부 AI 전송 금지) |
| P2 | 녹음·전사 파이프라인 | audit-only | implemented | absent | n/a | — | — | 2/2 | 0/2 | data-available-ui-absent | issue — 전사·분석 실패를 이슈로 |
| P2 | 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치) | owner | partial | read-only | read-only | shuttle | — | 6/6 | 6/6 | ui-partial | evidence — 학부모 변경 요청 미확인·운행 이상을 이슈로 |
| P2 | 원생 기여도(온톨로지·소개) | owner | implemented | read-only | read-only | learning | — | 4/4 | 1/4 | ui-partial | evidence — 원생 근거 패널의 한 탭으로 |
| P2 | 교재목록(커리큘럼·반 배정) | owner | implemented | absent | read-only | — | — | 3/3 | 0/3 | data-available-ui-absent | evidence — 진도 이슈의 근거로만 노출(편집은 2.0 화면) |
| P3 | 로그인·세션·링크 만료·지점 보기 안내 | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | settings — AX도 /home 판정을 그대로 재사용 |
| P3 | 데모 지점 갱신 | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | settings — 제외 |
| P3 | 개발용 화면 | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | settings — 제외 |
| P3 | 도움말(설명서·질문 게시판) | owner | implemented | absent | read-only | — | — | 0/2 | 0/2 | ui-absent | command — AI 업무 지원 입력창에서 도움말 문서를 근거로 답 |
| P3 | 학부모 포털(셔틀·시간표) | owner-linked | partial | absent | read-only | — | — | 2/5 | 0/5 | data-available-ui-absent | issue — 학부모 변경 요청을 셔틀 담당 확인 이슈로 |
| P3 | 운영 콘솔(슈퍼관리자) | audit-only | implemented | absent | n/a | — | — | 3/4 | 0/4 | data-available-ui-absent | settings — 분리 유지 |
| P3 | 공개 랜딩(제품·학원) | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | evidence — 원장 범위 밖 — 제외 |
| P3 | 학생 내 학습 | owner-linked | partial | absent | read-only | — | — | 0/0 | 0/0 | ui-absent | evidence — 원장 범위 밖 — 제외 유지 |
| P3 | 고객센터(공지·개선요청) | owner | implemented | absent | read-only | — | — | 1/2 | 0/2 | data-available-ui-absent | request — 원장 화면 밖 — 개선요청 답변 도착(알림 support_answer)만 알림함에 |

역방향(시안 화면 → 2.0 패밀리):

| 시안 화면 | AX 라벨 | 대응 2.0 패밀리 |
| --- | --- | --- |
| home 경영 흐름 | 브리핑 | dashboard |
| students 학생 · 재원 관리 | 원생목록 | attendance, students, consultations, retention, withdrawals |
| admissions 입학 · 상담 | 신규 콜&상담 | enrollment |
| classes 수업 · 시간표 | 수업목록 · 시간표 | timetable, classes, makeups |
| learning 학습 · 성과 | 성적관리 · 수업보고서 | onescreen, video-homework, class-sheets, lesson-reports, student-contribution, exams |
| finance 수납 · 재무 | 수납관리 | payroll, billing, expense-requests |
| staff 직원 · 급여 | 직원관리 | staff, payroll |
| parents 학부모 소통 | 학부모 소통 | onescreen, lesson-reports |
| shuttle 차량 · 안전 | 셔틀 | shuttle |
| approvals 업무 · 결재 | 전자결재 · 할 일 | tasks-notifications, withdrawal-reports, approvals |
| resources 교재 · 자산 · 문서 | 교재 · 재고 · 서식 | textbook-requests, inventory, documents |
| calendar 학원 일정 | 캘린더 | calendar, makeups |
| settings 학원 설정 | 학원 설정 | owner-settings |

| AX 이슈 | 근거 위치 | 대응 2.0 패밀리 |
| --- | --- | --- |
| billing 수납 | experiments/owner-concept/ax.js:23 | dashboard, billing |
| admissions 상담 | experiments/owner-concept/ax.js:24 | enrollment |
| attendance 출결 | experiments/owner-concept/ax.js:25 | attendance, students |
| approval 결재 | experiments/owner-concept/ax.js:26 | approvals |
| tasks 업무 | experiments/owner-concept/ax.js:27 | tasks-notifications, withdrawal-reports |
| books 교재 | experiments/owner-concept/ax.js:28 | billing, textbook-requests |
| enrollment 경영 | experiments/owner-concept/ax.js:29 | dashboard, students, billing |

## 6. 패밀리 상세

### `dashboard` 대시보드(운영실)

- 2.0: **implemented** — 역할별 배치(학원 설정 > 대시보드 관리) · 위젯 카드 27종 + 상단 KPI 9칸 · 과목 관리자는 과목별 커팅. /dashboard/briefing은 /dashboard로 돌려보내고, daily-briefing 크론 핸들러는 vercel.json에 일정이 없다.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollment_consultations`, `enrollments`, `invoices`, `lesson_reports`, `makeup_reservations`, `shuttle_vehicles`, `student_consultations`, `students`, `textbook_orders`, `users`
- 대상: master, admin, manager, accountant, counselor, viewer · 권한 키: `dashboard` · 검증: source-read (`src/features/dashboard/layout/registry.ts`, `src/app/(shell)/menu/page.tsx`)
- 페이지 3: `/dashboard`(screen) `/dashboard/announcements`(screen) `/dashboard/briefing`(redirect)
- API 1: `/api/cron/daily-briefing`
- 메뉴·탭 입구 1: 대시보드(/dashboard)
- 화면 안 카탈로그 `dashboardWidgets`: 36개 (§10)
- 핵심 동작:
  - 지표 재집계(전체·과목별) — `refreshOverview`, `refreshSubjectOverview`
  - 학원 공지 작성·수정·고정·삭제 — `createAnnouncement`, `updateAnnouncement`, `toggleAnnouncementPin`, `deleteAnnouncement`
  - AI 일일 브리핑 다시 생성 — `regenerateDailyBriefing`
  - 차트 형태 계정 저장 — `saveDashboardChartKind`
  - 강의실 미리보기 갱신 — `refreshClassroomPreview`
  - 온보딩 안내 닫기 — `setOnboardingDismissed`
- 서버 액션 전체(동사 갈래): 실행·발송·생성(AI 포함) 4 · 수정·처리 4 · 생성·등록 1 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `announcements` 10/0, `daily_briefings` 89/77, `student_daily_stats` 35/7★, `tenant_settings` 5/1 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 home · AX home, issue:enrollment, issue:billing · 우선 P0
  - 보이는 것: 청구 대상 원생 추이·누적 수납·학교 구성(경영 흐름), 경영 메모(세션 전용)·월별 지표 CSV 저장, 브리핑의 이슈 7종과 최근 변화 띠
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `report-note` `ax:select` `ax:filter` `ax:open-issue`
  - 빠진 것: 위젯 카탈로그 36종(카드 27 + KPI 9)·역할별 배치·과목 커팅·학원 공지·통계 상세 화면(/students/stats 등)으로의 드릴다운
  - 제안(issue): KPI·위젯의 변화를 이슈로 띄우고 위젯 자체를 근거 카드로 재사용(카드→원본 화면 딥링크)
- ⚠️ 불확실: daily-briefing 크론 핸들러는 있으나 vercel.json 일정이 없다 — 의도적 중지인지 미확인

### `calendar` 캘린더

- 2.0: **implemented** — NAV_GROUPS에서 hidden(원장 2026-09-10) — 주소로만 열림. 구글 캘린더 푸시 웹훅(/api/calendar/google-push) + vercel 일정 google-calendar-import(0 19 * * * UTC).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `calendar_events`
- 대상: master, admin, manager, teacher · 권한 키: `calendar` · 검증: reviewed
- 페이지 1: `/calendar`(screen)
- API 2: `/api/calendar/google-push` `/api/cron/google-calendar-import`@0 19 * * *
- 메뉴·탭 입구 2: 캘린더(/calendar) · menu.item.calendar(/calendar)
- 핵심 동작:
  - 일정 저장·삭제·불러오기 — `saveCalendarEvent`, `deleteCalendarEvent`, `loadCalendarEvent`
  - 일정 태그 저장·삭제 — `saveCalendarTag`, `deleteCalendarTag`
- 서버 액션 전체(동사 갈래): 삭제 2 · 조회 1 · 수정·처리 2 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `calendar_events` 7975/7968★, `calendar_tags` 13/13 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 calendar · AX — · 우선 P2
  - 보이는 것: 월 달력·일정·보강 예약 목록
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `calendar-note` `event-note`
  - 빠진 것: 실제 일정 저장·태그·구글 동기화 상태
  - 제안(evidence): 일정을 이슈 근거(입테·첫수업·휴원일)로 연결, 일정 추가는 명령 입력으로
- ⚠️ 불확실: CLAUDE.md 결정 로그는 구글 → aywa 전체 동기화를 "하루 2회 안전망"이라 적지만 vercel.json에는 google-calendar-import 일정이 하루 1회뿐 — 다른 트리거가 있는지 미확인

### `tasks-notifications` 할 일·알림(벨·푸시)

- 2.0: **implemented** — 할 일은 기록의 사실로 자동 생성·자동 종료(버튼으로 완료하지 않음 — CLAUDE.md 결정 로그). 종류 11개, 알림 유형 39개(NotificationType 유니언 — 그중 38개가 슬랙 전달 가능, daily_briefing 제외). DB 트리거 기반 알림 마이그레이션 9개.
- 원장 범위: **owner** · 쓰기 경로: reuse+new-storage · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollment_consultations`, `enrollments`, `lesson_reports`, `staff_task_assignees`, `staff_tasks`, `student_consultations`, `student_grades`, `students`, `users`
- 대상: master, admin, manager, teacher, accountant, counselor · 권한 키: — · 검증: source-read (`src/features/staff-tasks/kinds.ts`, `src/features/slack/events.ts`)
- API 6: `/api/cron/notification-maintenance`@0 22 * * * `/api/cron/staff-tasks`@*/30 * * * * `/api/notifications` `/api/push` `/api/staff-tasks` `/api/staff-tasks/[id]`
- 화면 안 카탈로그 `staffTaskKinds`: 11개 (§10)
- 화면 안 카탈로그 `notificationTypes`: 39개 (§10)
- 화면 안 카탈로그 `notificationForwardEvents`: 38개 (§10)
- 핵심 동작:
  - 알림 읽음·보관·보관 해제·삭제 — `markNotificationsRead`, `archiveNotification`, `unarchiveNotification`, `deleteNotification`, `deleteAllNotifications`
  - 내 할 일·알림 조회(GET 라우트) — API `/api/staff-tasks`, API `/api/notifications`
- 서버 액션 전체(동사 갈래): 수정·처리 3 · 삭제 2 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `notifications` 11585/11534, `staff_tasks` 238/238★, `staff_task_assignees` 246/246★, `push_subscriptions` 1/1 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 approvals · AX inbox, requests, issue:tasks · 우선 P0
  - 보이는 것: snapshot.mjs가 staff_tasks·staff_task_assignees를 실제로 읽는다 — 시안 "업무·결재" 화면의 할 일 목록(진행 중/완료/전체)과 AX 이슈 "기한 지난 업무"가 그 데이터다. AX 알림함·요청한 업무는 세션 전용(이슈와 요청만 담는다)
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `new-task` `complete-task` `ax:request` `ax:request-start` `ax:request-reopen` `ax:form:request` `ax:form:result` `ax:read` `ax:archive` `ax:read-all` `ax:inbox-tab` `ax:bell`
  - 빠진 것: notifications 미연결(2.0 유니언 39종, cs 31종 11,534행 — 벨·푸시·보관함) · 할 일 쓰기 없음(2.0 할 일은 사실 기반 자동 종료라 버튼 완료가 없다 — 시안 complete-task는 의미가 다르다) · 할 일 종류: 2.0 코드 11종 중 시안 라벨 맵(live.js taskKind)에 없는 5종 = report_send_failed·followup_due·progress_anomaly·approval_turn·help_question, 시안의 owner_review는 2.0 종류가 아니다, cs 데이터에 있는 종류는 6종(모두 시안 맵에 있음) · 원장→담당자 요청 저장 테이블 없음
  - 제안(request): AX 요청한 업무를 staff_tasks와 같은 표면에 놓되, 자동 종료 규칙(사실 기반)과 사람이 보낸 요청을 구분하는 새 저장소 설계 필요
- ⚠️ 불확실: AX "요청한 업무"(원장→담당자 지시·완료 보고)를 저장할 2.0 테이블이 없다 — staff/notion 연동 할 일(createStaffTask)이 가장 가까우나 Notion 매핑 전용

### `slack` 슬랙 연동

- 2.0: **implemented** — 지점 스위치(기본 꺼짐) · 규칙 최대 30개(대상 12) · 활동 범주 12 · 프리셋 4 · 매분 아웃박스 발송. 설정 입구 = 학원 설정 > 연동 > 슬랙, 본인 연결 = /me.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `students`, `users`
- 대상: master, admin · 권한 키: `integration_settings` · 검증: reviewed
- API 1: `/api/cron/slack-dispatch`@* * * * *
- 화면 안 카탈로그 `slackActivityCategories`: 12개 (§10)
- 화면 안 카탈로그 `slackRulePresets`: 4개 (§10)
- 핵심 동작:
  - 워크스페이스 토큰 저장·연결 해제·채널 목록 — `saveSlackToken`, `disconnectSlack`, `listSlackChannels`
  - 규칙 저장·삭제·샘플 발송 — `saveSlackRule`, `deleteSlackRule`, `sendSlackRuleSample`
  - 요약 일정 저장·실패 재발송 — `saveSlackSchedule`, `resendSlackFailures`
  - 직원 ↔ 슬랙 사용자 연결(이메일·본인 확인) — `linkSlackByEmail`, `unlinkSlackUser`, `startSlackSelfLink`, `confirmSlackSelfLink`, `unlinkMySlack`
- 서버 액션 전체(동사 갈래): 기타 1 · 조회 2 · 실행·발송·생성(AI 포함) 2 · 수정·처리 6 · 생성·등록 2 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `slack_connections` 1/1, `slack_rules` 4/4, `slack_outbox` 2131/2131, `slack_user_links` 2/2 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 — · AX automation · 우선 P1
  - 보이는 것: 복사본 슬랙 설정 요약(연결 여부·사용 규칙 수·요약·방해금지)과 슬랙 메시지 미리보기
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `ax:digest` `ax:slack` `ax:request-slack`
  - 빠진 것: 실제 규칙 편집(무엇을·어디로·어떻게·언제), 사람 연결, 실패 재발송, 발송 이력
  - 제안(settings): AX 자동화 화면을 2.0 slack_rules 구조(범주 12·프리셋 4·전달 이벤트 38)에 그대로 맞춘다

### `onescreen` 선생님 원스크린(수업 마감)

- 2.0: **implemented** — 강사 홈(영어 전담은 ECS). 출결·보고서·AI 멘트·공지·보강 등록을 한 화면에서 마감.
- 원장 범위: **owner-linked** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `students`, `users`
- 대상: teacher, master, admin · 권한 키: `teacher_onescreen` · 검증: reviewed
- 페이지 1: `/onescreen`(screen)
- API 1: `/api/cron/ment-style-rebuild`@0 11 * * 0
- 메뉴·탭 입구 2: 선생님 원스크린(/onescreen) · menu.item.teacher_onescreen(/onescreen)
- 핵심 동작:
  - 보고서 저장·ClassNote 발송 대기열 등록 — `saveLessonReport`, `saveAndQueueClassnote`, `saveOnescreenSession`
  - AI 멘트 자동작성(수학·영어) — `generateReportComment`, `generateEnglishMent`
  - 학부모 공지 발송·수정·취소 — `sendOnescreenNotice`, `editQueuedNotice`, `editPostedNotice`, `cancelOnescreenNotice`, `deleteQueuedNotice`
  - 보강 학생 등록·제거·반 지정 — `registerMakeupEntries`, `removeMakeupEntry`, `setMakeupClass`
  - 공유 링크 재발급·회수 — `reissueShareLink`, `revokeShareLink`
  - 첨부 업로드·등록 — `issueReportAttachmentUploadTicket`, `registerReportAttachment`, `removeReportAttachment`
  - 보고서 템플릿 저장·삭제 — `saveMyReportTemplate`, `deleteMyReportTemplate`
  - AI 멘트 프롬프트 편집·시험·초기화 — `savePrompt`, `testPrompt`, `resetPrompt`
- 서버 액션 전체(동사 갈래): 조회 16 · 실행·발송·생성(AI 포함) 6 · 기타 1 · 수정·처리 16 · 생성·등록 5 · 삭제 4 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `lesson_reports` 31043/23085★, `attendance_records` 36991/28174★, `classnote_notices` 197/197, `report_templates` 2/2 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 learning, parents · AX — · 우선 P0
  - 보이는 것: 월별 학습 리포트 수·전달/읽음 수(집계만)
  - 빠진 것: 강사의 수업 마감 흐름 전체(원장 작업 공간 밖이지만 요청의 목적지)
  - 제안(request): 미작성·미발송 보고서 이슈 → 해당 강사에게 요청 → 원스크린 해당 반·날짜 딥링크

### `video-homework` 영상 숙제(제출 사이트·장부·AI 검토)

- 2.0: **implemented** — /v 공개 업로드(휴대폰 뒷4자리+이름) · 장부(관리자 전체/강사 본인 출제분) · 영상 AI 참고 메모는 지점 스위치(video_review, 기본 꺼짐).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `makeup_reservations`, `student_homework_videos`, `students`, `users`
- 대상: teacher, master, admin, student, parent · 권한 키: `lesson_reports` `teacher_onescreen` · 검증: reviewed
- 페이지 4: `/lesson-reports/video-homework`(screen) `/onescreen/video-homework`(screen) `/v`(public-share) `/v/[token]`(public-share)
- API 15: `/api/classnote/reply-videos` `/api/cron/video-homework`@*/30 * * * * `/api/cron/video-review`@*/10 * * * * `/api/homework-videos/[id]/review` `/api/homework-videos/[id]/stream` `/api/integrations/homework-video-drive/callback` `/api/integrations/homework-video-drive/done` `/api/integrations/homework-video-drive/start` `/api/internal/video-drive-token` `/api/internal/video-review/upload` `/api/internal/video-submit-link` `/api/video-submit/complete` `/api/video-submit/event` `/api/video-submit/site` `/api/video-submit/start`
- 메뉴·탭 입구 2: menu.item.videoHomework(/onescreen/video-homework) · 영상 제출 현황(/lesson-reports/video-homework)
- 핵심 동작:
  - 제출 확인 체크·일괄 체크·회차 지정 — `setVideoHomeworkMark`, `setVideoHomeworkMarksBulk`, `setVideoHomeworkRound`
  - 영상 배정·반려·숙제 취소·추가 출제 — `assignHomeworkVideo`, `rejectHomeworkVideos`, `cancelVideoHomework`, `issueExtraVideoHomework`
  - AI 영상 검토 다시 실행 — `rerunVideoReview`
  - 제출 링크 회수·드라이브 계정 설정 — `revokeVideoSubmitLinks`, `saveVideoDriveSetting`
  - 공개 업로드 시작·완료(학생) — API `/api/video-submit/start`, API `/api/video-submit/complete`
- 서버 액션 전체(동사 갈래): 수정·처리 6 · 생성·등록 2 · 기타 1 · 조회 2 · 실행·발송·생성(AI 포함) 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `student_homework_videos` 733/733★, `video_homework_marks` 465/465, `homework_video_reviews` 495/495, `homework_video_links` 366/366, `homework_video_assignments` 72/72 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 learning · AX — · 우선 P1
  - 보이는 것: 월별 과제영상 등록 수(집계)
  - 빠진 것: 미배정 영상·미제출·반려 흐름, AI 검토 메모
  - 제안(issue): 미배정 영상·업로드 실패(할 일 video_unassigned·video_upload_check)를 이슈로, 장부를 근거로

### `timetable` 시간표(배치·가져오기·편집기·메모)

- 2.0: **partial** — 기본·강사·통합·교실 뷰, 드래그 반 이동, 시트 가져오기(영어 마스터·수학 격자·구조), 메모 시트, 칸 메모. 수업 나누기(class-splits)는 CLASS_SPLIT_ENABLED=false로 꺼짐.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollments`, `students`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `timetable` · 검증: source-read (`src/app/api/cron/apply-timetable-lab/route.ts`, `src/app/(shell)/timetable/english-sheet/page.tsx`, `src/features/class-splits/access.ts`)
- 페이지 3: `/timetable`(screen) `/timetable/editor`(screen) `/timetable/english-sheet`(screen)
- API 8: `/api/cron/apply-timetable-lab`@0 * * * * `/api/exports/timetable` `/api/timetable/cell-memos` `/api/timetable/end-scope` `/api/timetable/lab/drafts` `/api/timetable/lab/drafts/[id]` `/api/timetable/lab/source` `/api/timetable/student-busy`
- 메뉴·탭 입구 2: 시간표(/timetable) · menu.item.timetable(/timetable)
- 핵심 동작:
  - 반 배치 이동·학생 일괄 반 이동 — `moveClassSlots`, `moveEnrollmentsBatch`
  - 시트 가져오기 미리보기·적용·예약 취소 — `previewSheetImport`, `applySheetImport`, `previewTimetableImport`, `applyTimetableImport`, `cancelScheduledImport`
  - 수학 격자·구조 가져오기·되돌리기 — `previewMathSheetBundle`, `applyMathGridImport`, `previewStructureImport`, `applyStructureImport`, `rollbackStructureImport`
  - 영어 마스터 시트 반영 — `previewMasterSheet`, `applyMasterSheet`
  - 편집기 연습본 반영 예약·취소 — `previewTimetableLabApply`, `queueTimetableLabApply`, `cancelTimetableLabApplyJob`
  - 메모 시트·칸 메모 저장 — `saveMemoSheet`, `saveCellMemo`, `deleteCellMemo`
  - 수업 나누기(현재 꺼짐) — `createClassSplit`, `endClassSplit`
- 서버 액션 전체(동사 갈래): 생성·등록 2 · 수정·처리 15 · 실행·발송·생성(AI 포함) 8 · 삭제 1 · 조회 4 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `class_schedules` 1718/1605★, `classes` 208/179★, `timetable_snapshots` 19/19, `timetable_lab_apply_jobs` 1/1, `timetable_memo_sheets` 1/1, `timetable_cell_memos` 0/0, `class_splits` 0/0 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 classes · AX — · 우선 P1
  - 보이는 것: 요일별 수업 밀도·주간 시간표(읽기)
  - 빠진 것: 배치 편집·가져오기·충돌 판정·메모·연습본
  - 제안(evidence): 시간표를 근거 패널로(학생·강사 충돌 근거), 편집은 2.0 편집기 딥링크
- ⚠️ 불확실: /timetable/editor 머리 주석은 "운영 반영 경로 없음"이라 적었지만 queueTimetableLabApply와 매시 apply-timetable-lab 크론이 존재 — 주석이 낡았는지 확인 필요
- ⚠️ 불확실: /timetable/english-sheet 는 침산 tenant id를 코드에 직접 적는다(page.tsx)

### `class-sheets` 강사 시트(영어 ECS·수학 MCS)

- 2.0: **partial** — ECS 주간·월간·월간계획서 인쇄·반 계획 보기·계획 대비 현황, MCS 월간·선생님별. 수학 학습 진도맵(/mcs/progress-map)은 숨은 시안(샘플 데이터·관리자 이상).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollments`, `lesson_reports`, `students`, `users`
- 대상: teacher, master, admin, manager · 권한 키: `ecs` `mcs` · 검증: source-read (`src/app/(shell)/mcs/[classId]/month/page.tsx`, `src/app/(shell)/ecs/[classId]/month/page.tsx`, `src/app/(print)/ecs/[classId]/month-plan/print/page.tsx`)
- 페이지 10: `/ecs`(screen) `/ecs/[classId]`(detail) `/ecs/[classId]/month`(detail) `/ecs/[classId]/month-plan/print`(print) `/ecs/goals`(screen) `/ecs/plan-gap`(screen) `/mcs`(screen) `/mcs/[classId]/month`(detail) `/mcs/progress-map`(screen) `/mcs/teachers`(screen)
- 메뉴·탭 입구 7: 영어(/ecs) · 수학(/mcs) · 강사 시트(/ecs) · 영어 강사 시트(/ecs) · 수학 강사 시트(/mcs) · menu.item.ecs(/ecs) · menu.item.mcs(/mcs)
- 핵심 동작:
  - 목표·수업계획 줄 작성·이동·삭제 — `upsertGoal`, `createPlanLine`, `movePlanLine`, `deletePlanLine`
  - 학생 표시·시트 변경분 저장 — `upsertStudentMark`, `flushSheetPatches`, `commitSheetEdits`
  - 지난주·지난 칸 복사 — `copyWeekFromPrevious`, `copySlotFromPrevious`
  - 월간 계획·월 메모 저장 — `saveMonthPlanCells`, `saveMonthMemo`
  - 외운 단어 가져오기(IJW) — `pullEcsMemorizedWords`
  - 수학 학습 목표 저장·개정·트랙 지정 — `saveMathLearningGoals`, `reviseMathLearningGoal`, `setMathClassLearningTrack`
- 서버 액션 전체(동사 갈래): 수정·처리 33 · 생성·등록 1 · 삭제 2 · 조회 2 · 실행·발송·생성(AI 포함) 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `class_sheet_goals` 558/463, `class_sheet_plan_lines` 5385/3761, `class_sheet_student_marks` 15226/6100, `math_month_goals` 887/372, `math_learning_track_goals` 410/298 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 learning · AX — · 우선 P1
  - 보이는 것: 월별 진도 기록 수(집계)
  - 빠진 것: 시트 작성 현황·계획 대비 차이·목표
  - 제안(issue): 작성 누락·계획 대비 차이(/ecs/plan-gap 판정)를 이슈로, 반 시트를 근거로
- ✅ 원문으로 해소: /ecs/[classId]/month · /mcs/[classId]/month · /ecs/[classId]/month-plan/print 의 게이트는 조회 함수 안(requireEcsClassAccess · requireMcsClassAccess · getMonthPlanPrint) — 원문 확인

### `attendance` 출석부(월별·오늘·출결 모드·자리·키오스크)

- 2.0: **implemented** — 월별 출석부(기본 착지)·오늘 출결(좌석표+데스크 확인 큐)·출결 모드(강사 본인 반)·날짜별 입력·랩실/JJ실 자리 출석부(공개 PIN)·키오스크(카카오 알림톡)·출결 통계·시수 마스터.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_checkins`, `attendance_records`, `class_schedules`, `classes`, `classnote_parent_messages`, `classrooms`, `enrollments`, `invoices`, `lesson_reports`, `makeup_reservations`, `students`, `users`
- 대상: master, admin, manager, teacher, device, public · 권한 키: `attendance` `seat_attendance` `kiosk_settings` `attendance_salary_settings` · 검증: source-read (`src/app/(shell)/attendance/units-master/page.tsx`, `src/features/attendance/server/units-master.ts`)
- 페이지 16: `/attendance`(screen) `/attendance/[date]`(detail) `/attendance/[date]/[classId]`(detail) `/attendance/class/[classId]/month/print`(print) `/attendance/live`(screen) `/attendance/quick`(screen) `/attendance/seat`(redirect) `/attendance/seat/[seat]`(detail) `/attendance/seat/[seat]/month`(detail) `/attendance/seat/[seat]/month/print`(print) `/attendance/stats`(stats) `/attendance/units-master`(screen) `/kiosk`(device) `/kiosk-settings`(screen) `/seat`(redirect) `/seat/[seat]`(device)
- API 1: `/api/attendance/checkin`
- 메뉴·탭 입구 9: 오늘 출결(/attendance/live) · 출결 모드(/attendance/quick) · 월별 출석부(/attendance) · 출석부(/attendance) · {MENU_LABEL.kiosk_settings}(/kiosk-settings) · menu.item.attendanceQuick(/attendance/quick) · menu.item.attendance(/attendance)
- 핵심 동작:
  - 출결 칸 기록·일괄·구간 적용 — `setAttendanceCell`, `setAttendanceBulk`, `setAttendanceRange`, `saveAttendance`
  - 데스크 확인 요청·입력 요청·후속 기록 — `requestDeskConfirm`, `requestAttendanceInput`, `recordFollowup`
  - 결석 사전 접수 — `previewAbsenceIntake`, `recordAbsenceIntake`
  - 보강 예약·취소·결석 연결 — `reserveMakeup`, `cancelMakeupReservation`, `linkMakeupToAbsence`, `noteMakeupAgainstAbsence`
  - AI 출결 요약 생성 — `generateRecapSummary`
  - 자리 출석부 기록·교시 이동·PIN 입장 — `setSeatCell`, `fillSeatSlot`, `moveSeatStudentPeriod`, `submitSeatPin`
  - 키오스크 기기 등록·해지·코드 배정·알림톡 — `registerKioskDevice`, `revokeKioskDevice`, `assignAttendanceCodesAction`, `saveKakaoChannel`, `sendTestAlimtalk`
  - 실급여 비율·표시 저장 — `saveAttendanceSalaryRates`, `saveAttendanceSalaryVisible`
  - 키오스크 체크인(공개 POST) — API `/api/attendance/checkin`
- 서버 액션 전체(동사 갈래): 실행·발송·생성(AI 포함) 4 · 수정·처리 33 · 조회 12 · 생성·등록 8 · 삭제 2 · 감사로그 있음 · AI 없음 · 알림 발송 있음
- 핵심 표(전체/cs 행): `attendance_records` 36991/28174★, `attendance_checkins` 0/0★, `makeup_reservations` 15/11★, `kiosk_devices` 2/2 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 students · AX home, inbox, issue:attendance · 우선 P0
  - 보이는 것: 원생별 이번 달 결석·지각·보강 수, 결석 3회 이상 이슈
  - 빠진 것: 출결 입력·데스크 확인 큐·미입력 판정·자리/키오스크·통계 추이
  - 제안(issue): 결석·미입력·데스크 확인 대기를 이슈로, 할 일 attendance_absent_desk(결석 확인 전화)를 요청 흐름으로
- ✅ 원문으로 해소: /attendance/units-master 게이트 = loadUnitsMaster 안 requireAccess("attendance")(units-master.ts:39), 입구 = 월별 출석부의 UnitsMasterButton(canViewUnitsMaster) — 원문 확인

### `classes` 수업목록(반·수강·인수인계)

- 2.0: **implemented** — 반 생성·수정·보관, 운영 기간 종료·재개, 담임 인수인계 예약·적용, 결근 대체 위임, 수강 배정·이동·예약.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollments`, `invoices`, `lesson_reports`, `students`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `classes` · 검증: reviewed
- 페이지 4: `/classes`(screen) `/classes/[id]`(detail) `/classes/[id]/edit`(form) `/classes/new`(form)
- API 3: `/api/cron/apply-due-class-updates`@30 15 * * * `/api/cron/close-ended-class-periods`@35 15 * * * `/api/exports/classes`
- 메뉴·탭 입구 2: 수업목록(/classes) · menu.item.classes(/classes)
- 핵심 동작:
  - 반 만들기·수정·보관 — `createClass`, `updateClass`, `archiveClass`
  - 운영 기간 종료·재개 — `endClassTerm`, `reopenClassTerm`
  - 담임 인수인계 예약·적용·취소 — `scheduleHandover`, `applyHandover`, `cancelHandover`
  - 결근 대체 위임·해제 — `createClassDelegation`, `revokeClassDelegation`
  - 수강 배정·삭제·기간 수정·일괄 배정 — `createEnrollment`, `deleteEnrollment`, `updateEnrollmentDates`, `createEnrollmentsBulk`
  - 예약 수강 일정 변경·취소 — `rescheduleEnrollment`, `cancelScheduledEnrollment`
- 서버 액션 전체(동사 갈래): 수정·처리 15 · 생성·등록 4 · 조회 6 · 기타 1 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 있음
- 핵심 표(전체/cs 행): `classes` 208/179★, `enrollments` 1753/1534★, `classrooms` 25/21★, `class_delegations` 2/2 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 classes · AX — · 우선 P1
  - 보이는 것: 운영 반·수강 학생·주간 배치 수, 반 카드·반 상세(시간표·수강생)
  - 빠진 것: 반·수강 편집, 인수인계·위임
  - 제안(evidence): 반 상세를 근거 패널로, 반 개설·이동은 요청/명령으로

### `makeups` 보강관리

- 2.0: **implemented** — 명령 버스 하나(executeMakeupCommand)로 접수·배정·병합·종결. 운영 모드는 학원 설정 > 보강 운영(원장만). 도입 사전 점검·대사·복구 화면 포함.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `classes`
- 대상: master, admin, manager, teacher · 권한 키: `makeups` · 검증: reviewed
- 페이지 6: `/makeups`(screen) `/makeups/[id]`(detail) `/makeups/candidates`(screen) `/makeups/dry-run`(screen) `/makeups/new`(form) `/makeups/reconciliation`(screen)
- 메뉴·탭 입구 2: 보강관리(/makeups) · menu.item.makeups(/makeups)
- 핵심 동작:
  - 보강 명령 실행(접수·배정·병합·종결) — `executeMakeupCommand`
  - 보강 대상·배정 후보·병합 후보 검색 — `searchMakeupOptions`, `searchAllocationCases`, `searchMergeCases`
  - 보강 이력·상세 다시 읽기 — `loadMakeupEvents`, `reloadMakeupCaseDetail`
- 서버 액션 전체(동사 갈래): 기타 2 · 조회 4 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `makeup_cases` 0/0★, `makeup_reservations` 15/11★, `makeup_events` 4/4, `makeup_commands` 4/4 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 calendar, classes · AX — · 우선 P1
  - 보이는 것: 보강 예약 목록·전체 예약 수
  - 빠진 것: 보강 사례(미처리 분·기한)·명령
  - 제안(issue): 미처리 보강 분·기한 임박 사례를 이슈로, 보강 상세를 근거로

### `textbooks` 교재목록(커리큘럼·반 배정)

- 2.0: **implemented** — 교재·차수별 진도·과제 마스터와 반 배정(영어 시트 자동기입 재료). 수납관리 교재 단가표와 다른 물건.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `students`, `textbook_orders`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `textbooks` · 검증: reviewed
- 페이지 1: `/textbooks`(screen)
- 메뉴·탭 입구 3: 교재목록(/textbooks) · 교재(/textbooks) · 반 배정(/textbooks?tab=plans)
- 핵심 동작:
  - 교재 저장·차수 저장·삭제 — `saveTextbook`, `saveTextbookLessons`, `deleteTextbook`
  - 표지 등록·삭제 — `registerTextbookCover`, `removeTextbookCover`
  - 반 배정 채우기·미리보기·되돌리기 — `previewTextbookFill`, `applyTextbookFill`, `undoPlanImport`, `undoPlanDelete`
  - 수업 회차 미룸·당김 — `setLessonShift`, `undoLessonShift`
  - 수학 교재 배정·목표·학교 시험 기간 — `saveMathTextbookAssignment`, `saveMathBookTarget`, `saveSchoolExamPeriods`
- 서버 액션 전체(동사 갈래): 삭제 3 · 조회 5 · 수정·처리 11 · 생성·등록 2 · 실행·발송·생성(AI 포함) 2 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `textbooks` 160/158, `textbook_lessons` 1297/1273, `class_textbook_plans` 42/42 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 커리큘럼 마스터·반 배정 전부(시안의 "교재"는 주문 흐름뿐)
  - 제안(evidence): 진도 이슈의 근거로만 노출(편집은 2.0 화면)

### `lesson-reports` 수업보고서·ClassNote 발송

- 2.0: **implemented** — 면: 영상 제출 현황·작성률·목록·클래스노트(발송 큐·반 구성·반 공지·직접 발송·회수·학부모 글·답글)·보고서 설정·AI 멘트. 학부모 공개 링크 /r/[token]. 평점(참고용) 30분 크론.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classnote_parent_messages`, `classnote_parent_replies`, `enrollments`, `lesson_reports`, `student_homework_videos`, `students`, `users`
- 대상: master, admin, manager, teacher, parent · 권한 키: `lesson_reports` `report_settings` `ai_ment` · 검증: reviewed
- 페이지 4: `/lesson_reports/[id]/print`(print) `/lesson-reports`(screen) `/lesson-reports/stats`(stats) `/r/[token]`(public-share)
- API 6: `/api/cron/report-ratings`@*/30 * * * * `/api/internal/class-notice-attachments/[noticeId]` `/api/internal/notice-attachments/[noticeId]` `/api/internal/parent-messages/classify` `/api/internal/parent-messages/jev-shadow` `/api/internal/report-attachments/[reportId]`
- 메뉴·탭 입구 14: 수업보고서(/lesson-reports) · 보고서 설정(/lesson-reports?tab=report) · AI 멘트(/lesson-reports?tab=ai_ment) · 발송 큐(/lesson-reports?tab=classnote&section=queue) · 반 구성(/lesson-reports?tab=classnote&section=boards) · 반 공지(/lesson-reports?tab=classnote&section=notice) · 직접 발송(/lesson-reports?tab=classnote&section=compose) · 회수(/lesson-reports?tab=classnote&section=recall) · 학부모 글·답글(/lesson-reports?tab=classnote&section=parent_replies) · 작성률(/lesson-reports?tab=writing) · 목록(/lesson-reports?tab=list) · 클래스노트(/lesson-reports?tab=classnote)
- 핵심 동작:
  - ClassNote 대기열 새로고침·재시도·막힘 해제·미발송 일괄 발송 — `refreshClassnoteQueue`, `retryClassnote`, `resetStuckClassnote`, `sendClassnoteForUnsent`
  - 관리자 직접 작성·발송·일괄 발송 — `saveAdminReport`, `saveAndQueueAdminReport`, `sendBulkAdminReports`
  - 반 공지·전체 반 공지 발송 — `previewClassNotice`, `sendClassNotice`, `sendClassWideNotice`
  - 보고서 회수 요청 — `requestReportRecall`, `requestReportRecallByShareToken`
  - 반 보드 원아 연결·해제·동기화 요청 — `linkClassnoteChild`, `unlinkClassnoteChild`, `requestClassnoteBoardSync`, `downloadClassnoteSyncReport`
  - 학부모 글 답글·수정·삭제·공감 — `requestParentReply`, `requestParentReplyEdit`, `requestParentReplyDelete`, `requestParentReaction`, `requestParentReactionRemove`
  - 보고서 목록 조회 — `listReports`
- 서버 액션 전체(동사 갈래): 조회 13 · 생성·등록 9 · 수정·처리 5 · 실행·발송·생성(AI 포함) 7 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `lesson_reports` 31043/23085★, `classnote_parent_messages` 1167/1167★, `classnote_parent_replies` 23/23★, `lesson_report_send_events` 20629/20623, `lesson_report_ratings` 5496/5496 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 parents, learning · AX — · 우선 P0
  - 보이는 것: 전달·읽음·실패·답글 수, 학부모 메시지 분류·카드, 답글 초안(세션 전용)
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `message-draft` `reply-draft`
  - 빠진 것: 발송 큐·실패 재시도·회수·반 보드 동기화·실제 답글 발송·평점
  - 제안(issue): 발송 실패·미발송·미응답 학부모 글을 이슈로(할 일 report_send_failed·unsent_report), 답글은 원장 확인 후 요청

### `class-review` 직원 평가·직원 포트폴리오

- 2.0: **partial** — 실험실 메뉴(기본 전원 none, 개인 예외로만 개방). 참관 평가는 academy_documents에 문서로 저장(class-review/server/actions.ts). 포트폴리오는 원장 역할만, 지표·만점은 학원 설정 > 강사평가.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `classes`, `classnote_parent_messages`, `enrollments`, `invoices`, `lesson_reports`, `staff_attendance_days`, `staff_contracts`, `students`, `users`
- 대상: master, admin · 권한 키: `class_review` · 검증: reviewed
- 페이지 6: `/class-review`(screen) `/class-review/[id]`(detail) `/class-review/[id]/score`(detail) `/class-review/board`(screen) `/class-review/new`(form) `/class-review/template`(screen)
- API 1: `/api/cron/teacher-portfolio`@10 15 * * *
- 메뉴·탭 입구 4: 직원 평가(/class-review) · menu.item.class_review(/class-review) · 직원 포트폴리오(/class-review?tab=portfolio)
- 핵심 동작:
  - 참관 평가 개설·채점·최종 의견 — `createClassReview`, `submitClassReviewScores`, `saveFinalReview`
  - 문항 세트 저장·삭제 — `saveChecklistTemplate`, `deleteChecklistTemplate`
  - 포트폴리오 재계산·월 입력 저장 — `refreshTeacherPortfolioNow`, `saveEvaluationEntries`
  - 만족도 판정·이의 — `decideJudgment`, `addSatisfactionClaim`, `cancelSatisfactionClaim`
  - 평가 기준·구성 저장 — `saveEvaluationSettings`, `saveEvaluationPreset`
- 서버 액션 전체(동사 갈래): 생성·등록 3 · 삭제 3 · 수정·처리 11 · 실행·발송·생성(AI 포함) 2 · 조회 3 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `academy_documents` 191/188★, `teacher_portfolio_months` 126/126, `teacher_evaluation_settings` 0/0, `teacher_evaluation_entries` 0/0 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 평가·포트폴리오 전부
  - 제안(evidence): 원장 전용 근거(직원 성과)로만, 이슈화는 원장 결정 후

### `students` 원생목록·원생 상세·원생 통계

- 2.0: **implemented** — 상세 탭 13개(개요·수업·성적·SRS·오늘 수학·진도·숙제 영상·출결·상담·특이사항·수납·기여도·타임라인), 형제, 상태 전환, 원생 매일 기록 크론.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollment_consultations`, `enrollments`, `invoices`, `lesson_reports`, `progress_entries`, `student_consultations`, `student_daily_stats`, `student_grades`, `student_history_monthly`, `student_homework_videos`, `student_memos`, `students`, `textbook_orders`, `users`
- 대상: master, admin, manager, teacher, counselor, viewer · 권한 키: `students` `student_english_name` · 검증: reviewed
- 페이지 5: `/students`(screen) `/students/[id]`(detail) `/students/[id]/edit`(form) `/students/new`(form) `/students/stats`(stats)
- API 3: `/api/cron/student-daily-stats`@55 14 * * * `/api/exports/students` `/api/students/[id]/summary`
- 메뉴·탭 입구 16: 원생목록(/students) · menu.item.students(/students) · 개요 · 수업 · 성적 · SRS · 오늘 수학 · 진도 · 숙제 영상 · 출결 · 상담 · 특이사항 · 수납 · 기여도 · 타임라인 · {t.label}
- 화면 안 카탈로그 `studentDetailTabs`: 14개 (§10)
- 핵심 동작:
  - 원생 등록·수정·삭제 — `createStudent`, `updateStudent`, `deleteStudent`
  - 상태 전환·퇴원 예약 취소 — `changeStudentStatus`, `cancelScheduledWithdrawal`
  - 수강 종료·휴원 — `endStudentEnrollments`, `endSingleEnrollment`, `setStudentEnrollmentHolds`, `holdSingleEnrollment`
  - 특이사항 메모 작성·고정 — `createStudentMemo`, `updateStudentMemo`, `toggleStudentMemoPin`, `deleteStudentMemo`
  - 성적·레벨테스트·목표 기록 — `createStudentGrade`, `createStudentLevelTest`, `createStudentGoal`
  - 영어 이름 수정·형제 후보 — `updateStudentEnglishName`, `loadSiblingOptions`
  - 진도 이상 처리 — `setProgressAnomalyResolved`
- 서버 액션 전체(동사 갈래): 수정·처리 15 · 기타 1 · 조회 2 · 생성·등록 6 · 삭제 6 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `students` 1023/840★, `enrollments` 1753/1534★, `student_memos` 878/2★, `student_siblings` 0/0, `student_daily_stats` 35/7★ (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 students · AX home, issue:attendance, issue:enrollment · 우선 P0
  - 보이는 것: 재원 일별 추이·학년 구성·필터(재원/후속 확인/휴원/입학 검토/퇴원)·원생 상세(수업·성적·진도·보고서·상담·수납), 후속 업무·메모(세션 전용)
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `student-note` `student-task`
  - 빠진 것: 상세 탭 중 SRS·오늘 수학·숙제 영상·기여도·타임라인·형제, 상태 전환·수강 편집
  - 제안(evidence): 원생 상세를 모든 이슈의 공통 근거 패널로, 상태 전환은 요청/명령으로

### `student-contribution` 원생 기여도(온톨로지·소개)

- 2.0: **implemented** — 학생별 운영 기여·학습 참여·연결 기록, 긍정 신호(밤 판정), 지난 소개 확인, 배점 설정(학원 설정 > 원생 기여도).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classnote_parent_messages`, `classnote_parent_replies`, `enrollment_consultations`, `enrollments`, `lesson_reports`, `makeup_reservations`, `shuttle_boardings`, `student_consultations`, `student_memos`, `students`, `textbook_orders`, `users`
- 대상: master, admin · 권한 키: `student_contribution` · 검증: source-read (`src/app/(shell)/student-contribution/page.tsx`, `src/features/student-contribution/components/settings-view.tsx`)
- 페이지 5: `/student-contribution`(screen) `/student-contribution/[id]`(detail) `/student-contribution/ontology`(screen) `/student-contribution/referrals`(screen) `/student-contribution/settings`(screen)
- API 1: `/api/cron/student-contribution`@40 15 * * *
- 메뉴·탭 입구 1: 원생 기여도(/student-contribution)
- 핵심 동작:
  - 기여도 재계산·긍정 신호 변경 — `refreshContribution`, `changePositiveSignal`
  - 소개자 확인 연결 — `searchReviewedReferrers`, `linkReviewedReferral`
  - AI 기록 요약(명시 버튼) — `generateStudentRecordSummary`
  - 배점 설정 저장 — `saveContributionSettings`
- 서버 액션 전체(동사 갈래): 수정·처리 2 · 실행·발송·생성(AI 포함) 2 · 조회 7 · 생성·등록 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `student_positive_signals` 1000/1000★, `student_contribution_months` 12735/12735, `student_contribution_settings` 1/1, `student_ontology_summaries` 452/452 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 learning · AX — · 우선 P2
  - 보이는 것: 이번 달 긍정 피드백 수(집계)
  - 빠진 것: 기여도·온톨로지·소개
  - 제안(evidence): 원생 근거 패널의 한 탭으로
- ✅ 원문으로 해소: /student-contribution 하위 페이지는 기능 모듈 뷰를 재-export하고 뷰가 게이트를 건다(settings-view.tsx:6 gate.canConfigure, referral-view getContributionGate, list/ontology 데이터 없음 → redirect) — 원문 확인

### `exams` 성적관리(통합·입력·확인·JJ실)

- 2.0: **implemented** — 통합 성적관리·학기 격자 입력·확인 뷰·엑셀, JJ실 시험 결과·결과지·보카킹 리포트(1차 시안).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `student_consultations`, `student_grades`, `students`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `exams` · 검증: reviewed
- 페이지 6: `/exams`(screen) `/exams/input`(screen) `/exams/jj/[deckId]`(detail) `/exams/jj/attempt/[attemptId]`(detail) `/exams/jj/attempt/[attemptId]/vocabking`(detail) `/exams/view`(screen)
- API 2: `/api/exams/excel` `/api/exams/unified-export`
- 메뉴·탭 입구 7: 성적관리(/exams) · menu.item.exams(/exams) · 전체 · 초 · 중 · 고 · {l.label}
- 핵심 동작:
  - 점수 저장·통합 성적 생성 — `saveGradeScores`, `saveUnifiedGrade`, `createUnifiedGrade`
  - 엑셀 가져오기·내보내기 — `importGradesExcel`, API `/api/exams/excel`, API `/api/exams/unified-export`
  - IJW 학생 연결·프로필 보내기 — `linkIjwStudent`, `pushIjwProfilesNow`
- 서버 액션 전체(동사 갈래): 수정·처리 4 · 실행·발송·생성(AI 포함) 1 · 조회 2 · 생성·등록 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `student_grades` 1267/212★, `exams` 14/0 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 learning · AX — · 우선 P1
  - 보이는 것: 월별 시험별 평균(만점 100 환산)·학생 학습 카드
  - 빠진 것: 입력·응시율·성적 급락(알림 grade_drop)
  - 제안(issue): 성적 급락·미응시를 이슈로, 시험별 결과를 근거로

### `consultations` 원생상담(재원생 상담·AI 분석)

- 2.0: **implemented** — 목록·상세·작성·수정·통계, 녹음 업로드→전사→AI 분석, 후속조치 체크.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `enrollment_consultations`, `enrollments`, `student_consultations`, `students`, `users`
- 대상: master, admin, manager, teacher, counselor · 권한 키: `consultations` · 검증: reviewed
- 페이지 5: `/consultations`(screen) `/consultations/[id]`(detail) `/consultations/[id]/edit`(form) `/consultations/new`(form) `/consultations/stats`(stats)
- API 1: `/api/exports/consultations`
- 메뉴·탭 입구 2: 원생상담(/consultations) · menu.item.consultations(/consultations)
- 핵심 동작:
  - 상담 작성·수정·삭제 — `createStudentConsultation`, `updateStudentConsultation`, `deleteStudentConsultation`
  - 후속조치 완료 표시 — `toggleConsultationFollowUp`
  - 녹음으로 시작·AI 분석 — `startStudentConsultationFromAudio`, `runStudentConsultationAnalysis`, `runStudentCareAnalysis`
- 서버 액션 전체(동사 갈래): 생성·등록 2 · 삭제 1 · 실행·발송·생성(AI 포함) 2 · 수정·처리 3 · 조회 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `student_consultations` 2927/2043★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 students · AX — · 우선 P1
  - 보이는 것: 원생 상세의 상담 맥락·후속 확인 수
  - 빠진 것: 상담 작성·AI 분석·통계
  - 제안(issue): 후속조치 기한(할 일 followup_due)을 이슈로, 상담 기록을 근거로

### `enrollment` 신규 콜&상담(QR 접수·브리프·인수인계)

- 2.0: **implemented** — 칸반 4칸·목록·통계·관리현황, QR 공개 접수(/intake), 상담 준비 브리프(AI)·인수인계서 인쇄, 병합·원생 전환, makeedu 푸시.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollment_consultations`, `enrollments`, `students`, `users`
- 대상: master, admin, counselor, public · 권한 키: `enrollment` · 검증: reviewed
- 페이지 7: `/enrollment`(screen) `/enrollment/[id]`(detail) `/enrollment/[id]/edit`(form) `/enrollment/[id]/prep`(print) `/enrollment/[id]/print`(print) `/enrollment/new`(form) `/intake/[token]`(public-share)
- API 1: `/api/enrollment/prior-consults`
- 메뉴·탭 입구 1: 신규 콜&상담(/enrollment)
- 핵심 동작:
  - 상담 작성·수정·삭제·칸 편집 — `createEnrollmentConsultation`, `updateEnrollmentConsultation`, `deleteEnrollmentConsultation`, `patchConsultationCells`
  - 결과(후속 조치) 지정 — `setEnrollmentOutcome`
  - 원생으로 전환·상담 병합 — `convertConsultationToStudent`, `previewConsultationMerge`, `mergeConsultations`
  - AI 분석 재생성·상담 준비 브리프 — `regenerateConsultationAnalysis`, `generatePrepBrief`, `appendAiSummaryToConsultationContent`
  - QR 접수 토큰 발급·끄기·공개 제출 — `createIntakeToken`, `setIntakeTokenActive`, `submitPublicIntake`
  - makeedu로 상담 보내기 — `enqueueConsultationPush`
- 서버 액션 전체(동사 갈래): 기타 1 · 수정·처리 13 · 생성·등록 3 · 삭제 1 · 실행·발송·생성(AI 포함) 3 · 조회 3 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `enrollment_consultations` 2378/2258★, `intake_tokens` 2/2 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 admissions · AX home, inbox, issue:admissions · 우선 P0
  - 보이는 것: 접수 추이·유입 경로·단계 흐름·상담 카드, 상담 등록·단계 이동·메모(세션 전용), 상담 후속 확인 이슈
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `new-lead` `advance-lead` `lead-note`
  - 빠진 것: 실제 저장·후속 조치 필수 규칙·QR·AI 분석·브리프·병합·관리현황
  - 제안(issue): 다음 상담 기한·장기 미결을 이슈로(할 일 enrollment_followup), 상담 카드를 근거로

### `retention` 이탈 방어

- 2.0: **implemented** — 면 4개(브리핑·리텐션 보드·학부모 메시지·재등록 캠페인).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `enrollments`, `invoices`, `lesson_reports`, `student_consultations`, `student_grades`, `students`
- 대상: master, admin, manager · 권한 키: `retention` · 검증: reviewed
- 페이지 4: `/retention`(screen) `/retention/board`(screen) `/retention/campaign`(screen) `/retention/messages`(screen)
- 메뉴·탭 입구 5: 이탈 방어(/retention) · 브리핑(/retention) · 리텐션 보드(/retention/board) · 학부모 메시지(/retention/messages) · 재등록 캠페인(/retention/campaign)
- 핵심 동작:
  - 재등록 캠페인 추가·제거·상태 변경 — `campaignAdd`, `campaignRemove`, `campaignSetStatus`
  - 학부모 메시지 조치 기록 — `logRetentionAction`
- 서버 액션 전체(동사 갈래): 실행·발송·생성(AI 포함) 4 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `reenrollment_campaign_targets` 0/0, `student_consultations` 2927/2043★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 students · AX — · 우선 P1
  - 보이는 것: 원생 "후속 확인" 필터(결석 3회+ 또는 후속 상담)
  - 빠진 것: 위험 판정 로스터·캠페인·메시지 조치
  - 제안(issue): 이탈 위험 원생을 이슈로, 로스터를 근거로, 캠페인 추가는 명령으로

### `newcomers` 신규생 관리(90일 체크리스트)

- 2.0: **implemented** — 신입 등록 후 7·30·60·90일 체크, 기록(통계) 화면.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollments`, `student_onboarding_checks`, `students`
- 대상: master, admin, manager, counselor · 권한 키: `newcomers` · 검증: reviewed
- 페이지 2: `/newcomers`(screen) `/newcomers/stats`(stats)
- 메뉴·탭 입구 1: 신규생 관리(/newcomers)
- 핵심 동작:
  - 체크리스트 항목 완료 — `setOnboardingCheck`
- 서버 액션 전체(동사 갈래): 수정·처리 2 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `student_onboarding_checks` 172/22★ (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P1
  - 빠진 것: 체크리스트 전부 — 시안 스냅샷에는 student_onboarding_checks 표가 들어 있으나 화면이 없다
  - 제안(issue): 체크 기한이 지난 신입생을 이슈로

### `withdrawals` 퇴원관리

- 2.0: **implemented** — 퇴원+수강종료 한 목록, 분석 축 전환, 3개월 내 퇴원, 퇴원 예약 자정 처리 크론.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `classrooms`, `enrollments`, `students`, `users`
- 대상: master, admin, manager · 권한 키: `withdrawals` · 검증: reviewed
- 페이지 2: `/withdrawals`(screen) `/withdrawals/[studentId]`(detail)
- API 1: `/api/cron/apply-due-withdrawals`@5 15 * * *
- 메뉴·탭 입구 1: 퇴원관리(/withdrawals)
- 핵심 동작:
  - 재원 복귀 — `reactivateStudent`
  - 퇴원 사유 수정·상담 단계 체크 — `updateWithdrawalReason`, `toggleConsultationStep`
- 서버 액션 전체(동사 갈래): 수정·처리 4 · 조회 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `students` 1023/840★, `enrollments` 1753/1534★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 students · AX — · 우선 P1
  - 보이는 것: 퇴원 상태 필터
  - 빠진 것: 사유 분석·추이·3개월 내 퇴원·퇴원 상세
  - 제안(evidence): 청구 대상 감소 이슈의 근거로 퇴원·수강종료 목록 연결

### `withdrawal-reports` 퇴원보고서(작성·순차 승인·옛 시트)

- 2.0: **implemented** — 퇴원은 보고서로만(서버가 직접 퇴원 거절). 담임별 보고서·관리자 전원 승인·원장 선택 승인, 옛 시트 기록 매핑.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `invoices`, `student_consultations`, `students`, `users`, `withdrawal_report_archives`, `withdrawal_reports`
- 대상: master, admin, manager, teacher · 권한 키: `withdrawal_reports` · 검증: reviewed
- 페이지 4: `/withdrawal-reports`(screen) `/withdrawal-reports/[id]`(detail) `/withdrawal-reports/archive`(screen) `/withdrawal-reports/archive/[id]`(detail)
- 메뉴·탭 입구 2: 퇴원보고서(/withdrawal-reports) · menu.item.withdrawal_reports(/withdrawal-reports)
- 핵심 동작:
  - 작성 요청·바로 처리(관리자) — `requestWithdrawalReport`, `processWithdrawalDirectly`
  - 작성·승인·반려 등 단계 변경 — `changeWithdrawalReport`
  - 옛 시트 기록 원생 연결 — `mapArchive`
- 서버 액션 전체(동사 갈래): 수정·처리 3 · 생성·등록 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `withdrawal_reports` 1/1★, `withdrawal_report_events` 2/2, `withdrawal_report_archives` 421/421★, `withdrawal_report_archive_mappings` 13/13 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 approvals · AX issue:tasks · 우선 P1
  - 보이는 것: 할 일 종류 "퇴원 절차" 라벨
  - 빠진 것: 보고서 작성·승인 흐름
  - 제안(request): 승인 대기 보고서를 결정 이슈로(할 일 withdrawal_step), 승인은 원장 결정 버튼

### `staff` 직원관리(명부·계약·이력서·휴가·연차)

- 2.0: **implemented** — 직원 등록·근무 설정·계약(PDF OCR — 원장 승인 예외)·이력서·QR 직원 등록·휴가·연차 조정·Notion 할 일·대시보드 배정.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `staff_contracts`, `textbook_orders`, `users`
- 대상: master, admin · 권한 키: `staff` `teacher_view` · 검증: reviewed
- 페이지 13: `/staff`(screen) `/staff-intake/[token]`(public-share) `/staff/[id]`(detail) `/staff/[id]/edit`(form) `/staff/[id]/leaves`(detail) `/staff/[id]/payroll`(detail) `/staff/annual-leave`(screen) `/staff/leaves`(screen) `/staff/new`(form) `/staff/payroll`(screen) `/staff/resumes`(redirect) `/staff/resumes/[id]`(detail) `/staff/resumes/new`(form)
- 메뉴·탭 입구 2: 직원 목록(/staff) · 직원관리(/staff)
- 핵심 동작:
  - 직원 등록·수정·역할 변경·비활성·인계 후 비활성 — `createStaff`, `updateStaff`, `changeStaffRole`, `deactivateStaff`, `handoverAndDeactivate`
  - 계정 이메일·비밀번호 재설정·삭제 — `changeStaffEmail`, `resetStaffPassword`, `deleteStaff`
  - 계약 수정·연장·PDF 추출(OCR) — `updateStaffContract`, `extendStaffContract`, `extractContractFromPdf`
  - 이력서 저장·사진 — `saveStaffResume`, `issueResumePhotoTicket`
  - QR 직원 등록 토큰·공개 제출 — `ensureStaffIntakeToken`, `submitPublicStaffIntake`
  - 휴가 신청·승인·삭제 — `requestLeave`, `approveLeave`, `deleteLeave`
  - 연차 조정 — `addLeaveAdjustment`, `deleteLeaveAdjustment`
  - Notion 할 일 생성·완료·기한 이동 — `createStaffTask`, `toggleTaskDone`, `moveTaskDue`
- 서버 액션 전체(동사 갈래): 생성·등록 9 · 삭제 5 · 수정·처리 19 · 실행·발송·생성(AI 포함) 1 · 조회 5 · 기타 3 · 감사로그 있음 · AI 없음 · 알림 발송 있음
- 핵심 표(전체/cs 행): `users` 73/63★, `staff_contracts` 156/156★, `staff_attendance_days` 2342/2342★, `staff_leaves` 7/0, `leave_adjustments` 0/0 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 staff · AX — · 우선 P1
  - 보이는 것: 활동 직원·근무 기록·최근 명세서, 직원 카드·상세(담당 반·근무·명세서)
  - 빠진 것: 등록·계약·휴가·연차·권한
  - 제안(request): AX 요청의 담당자 선택 원천(users·직급·부서), 휴가·계약 만료를 이슈로

### `payroll` 급여·명세서·강사 정산

- 2.0: **implemented** — 프리랜서 명세서(출석부 실급여 합계)·월별 급여·강사 정산. 급여는 외부 AI 전송 금지 필드.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `class_schedules`, `classes`, `enrollments`, `payroll_records`, `payslips`, `staff_contracts`, `students`, `users`
- 대상: master · 권한 키: `payroll_settings` · 검증: reviewed
- 페이지 1: `/payroll/[teacherId]/payslip`(print)
- 핵심 동작:
  - 명세서 발급·발급 취소·조정 저장 — `issuePayslip`, `unissuePayslip`, `savePayslipAdjustments`
  - 급여 자동 계산·저장·지급 표시 — `autoComputePayroll`, `upsertPayroll`, `markPayrollPaid`
  - 반별 급여·강사 보수 저장 — `saveClassSalary`, `saveTeacherComp`
- 서버 액션 전체(동사 갈래): 수정·처리 7 · 기타 1 · 삭제 1 · 생성·등록 2 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `payslips` 7/7★, `payroll_records` 49/0★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 finance, staff · AX — · 우선 P2
  - 보이는 것: 명세서 발급 수·지급액 합계
  - 빠진 것: 계산·발급·조정
  - 제안(evidence): 원장 전용 근거로만(외부 AI 전송 금지)

### `billing` 수납관리(청구·교재·지출·계산기·회차 확정·환불·정산)

- 2.0: **implemented** — 면 7개(수납·교재·지출·수강료 계산기[하위 5]·회차 확정·환불 요청서·강사 정산), 교재 하위 2, 수납 통계. 청구는 makeedu 동기화 기반. 환불 요청서는 academy_documents에 문서로 저장(refund-actions.ts).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `class_schedules`, `classes`, `enrollments`, `expenses`, `invoices`, `student_history_monthly`, `students`, `textbook_orders`, `users`
- 대상: master, admin, accountant · 권한 키: `billing` `billing_settings` · 검증: reviewed
- 페이지 5: `/billing`(screen) `/billing/expenses/[id]`(detail) `/billing/refunds/[id]`(detail) `/billing/refunds/new`(form) `/billing/stats`(stats)
- API 3: `/api/exports/billing` `/api/exports/expenses` `/api/exports/session-terms`
- 메뉴·탭 입구 21: 수납(/billing) · 교재(/billing?tab=textbooks) · 지출(/billing?tab=expenses) · 수강료 계산기(/billing?tab=calculator) · 회차 확정(/billing?tab=sessions) · 환불 요청서(/billing?tab=refunds) · 수납관리(/billing) · 강사 정산(/billing?tab=payroll) · 계산기(/billing?tab=calculator) · 수강료 단가(/billing?tab=calculator&csub=prices) · 교재 단가표(/billing?tab=calculator&csub=catalog) · 공휴일(/billing?tab=calculator&csub=holidays) · 저장된 청구서(/billing?tab=calculator&csub=quotes) · 목록(/billing?tab=textbooks) · 교재 단가표(/billing?tab=textbooks&tsub=catalog)
- 핵심 동작:
  - 수기 청구 만들기·납부 표시·무효 — `createInvoice`, `markManualInvoicePaid`, `voidManualInvoice`
  - 교재 주문 생성·수정·체크·삭제 — `createTextbookOrder`, `updateTextbookOrder`, `toggleTextbookCheck`, `deleteTextbookOrder`
  - 지출 작성·수정·결재 토글·영수증 — `createExpense`, `updateExpense`, `toggleExpenseApproval`, `addExpenseReceipt`
  - 수강료 단가·교재 단가표 관리 — `createTuitionItem`, `updateTuitionItem`, `setTuitionPricingMode`, `createCatalogItem`, `updateCatalogItem`
  - 견적(계산기) 저장 — `saveTuitionQuote`, `deleteTuitionQuote`
  - 회차 확정·해제·이월·배분 — `confirmSessionTerm`, `confirmClassTerms`, `unconfirmSessionTerm`, `saveMoneyCarryover`, `saveReceiptAllocation`, `saveFreeReceiptAllocation`, `saveTeacherSplits`
  - 환불 요청서 저장·삭제 — `saveRefundRequest`, `deleteRefundRequest`
  - 자리 몫 조정 — `saveSeatShareAdjust`
- 서버 액션 전체(동사 갈래): 생성·등록 11 · 삭제 9 · 수정·처리 32 · 조회 8 · 기타 1 · 실행·발송·생성(AI 포함) 2 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `invoices` 4971/4291★, `expenses` 273/261★, `textbook_orders` 632/616★, `invoice_session_terms` 2019/2019, `tuition_quotes` 27/20, `academy_documents` 191/188★ (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 finance · AX home, inbox, issue:billing, issue:books, issue:enrollment · 우선 P0
  - 보이는 것: 월 청구·누적 수납·잔액·지출 구성·잔액 카드·청구 상세, 청구 메모·월간 검토(세션 전용), 수납 잔액 이슈·청구 대상 변화 이슈
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `bill-note` `report-note`
  - 빠진 것: 청구 생성·회차 확정·배분·환불·지출 결재·견적
  - 제안(issue): 잔액·미납 누적(알림 outstanding_alert)을 이슈로, 청구 상세를 근거로, 안내는 요청으로

### `textbook-requests` 교재 요청(강사)

- 2.0: **implemented** — 강사 미니셸 "내 메뉴" 전용 입구(NAV hidden + teacherMenuEntry). 처리는 수납관리 교재 면.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: teacher, master, admin, accountant · 권한 키: `textbook_requests` · 검증: reviewed
- 페이지 2: `/textbook-requests`(screen) `/textbook/[id]/print`(print)
- 메뉴·탭 입구 2: 교재 요청(/textbook-requests) · menu.item.textbook_requests(/textbook-requests)
- 핵심 동작:
  - 교재 요청·수정·삭제 — `requestTextbook`, `updateTextbookRequest`, `deleteTextbookRequest`
  - 첨부 등록 — `registerTextbookAttachment`
  - 교재 안내 공지 준비·발송 — `prepareTextbookNotice`, `sendTextbookNotice`
- 핵심 표(전체/cs 행): `textbook_orders` 632/616★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 resources · AX home, inbox, issue:books · 우선 P1
  - 보이는 것: 교재 상태 흐름(요청·주문·전달·납부), 교재 진행 확인 이슈
  - 빠진 것: 요청 작성·안내 발송
  - 제안(issue): 요청·주문 상태 교재를 이슈로(시안과 동일), 처리는 수납 교재 면 딥링크

### `expense-requests` 지출결의서(강사 제출)

- 2.0: **implemented** — 강사 본인 결의서 조회·삭제·상세(인쇄). 사무실 역할은 /billing 지출 면으로 보낸다.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: teacher · 권한 키: `expense_requests` · 검증: reviewed
- 페이지 2: `/expense-requests`(screen) `/expense-requests/[id]`(detail)
- 메뉴·탭 입구 2: 지출결의서(/expense-requests) · menu.item.expense_requests(/expense-requests)
- 핵심 동작:
  - 본인 결의서 삭제 — `deleteExpense`
- 핵심 표(전체/cs 행): `expenses` 273/261★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 finance · AX — · 우선 P2
  - 보이는 것: 지출 구성(집계)
  - 빠진 것: 강사 제출 흐름
  - 제안(evidence): 결재 이슈의 근거로
- ⚠️ 불확실: /expense-requests 페이지에서 도달하는 작성 액션이 deleteExpense뿐 — 작성 경로(전자결재 submitExpenseDraft 또는 billing 컴포넌트) 확인 필요

### `shuttle` 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치)

- 2.0: **partial** — 편성·주간 시간표·오늘 등하원·학부모 등하원·운행 현황·학부모 관리 현황·노선표 인쇄. 실시간 위치/지도는 지도 키 미정으로 자리만(원장 2026-09-03).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `shuttle_boardings`, `shuttle_riders`, `shuttle_run_stops`, `shuttle_runs`, `shuttle_stops`, `shuttle_vehicles`, `students`, `users`
- 대상: master, admin, manager, teacher, driver · 권한 키: `shuttle` · 검증: reviewed
- 페이지 8: `/shuttle`(screen) `/shuttle/live`(screen) `/shuttle/parent-rides`(screen) `/shuttle/parents`(screen) `/shuttle/route`(print) `/shuttle/today`(screen) `/shuttle/track`(screen) `/shuttle/week`(screen)
- 메뉴·탭 입구 18: 노선 편성(/shuttle) · 주간 시간표(/shuttle/week) · 오늘 등하원(/shuttle/today) · 학부모 등하원(/shuttle/parent-rides) · 운행 현황(/shuttle/live) · 실시간 위치(/shuttle/track) · 셔틀(/shuttle) · 학부모 관리 현황(/shuttle/parents) · {owner.vehicleName} · 회차 · 노선 · 학생
- 핵심 동작:
  - 회차·정류장·순서 편성 — `createRun`, `updateRun`, `deleteRun`, `addRunStop`, `removeRunStop`, `reorderRunStops`, `updateRunStopTime`
  - 정류장 마스터·위치 — `createStop`, `updateStop`, `archiveStop`, `saveStopLocation`
  - 학생 배정·이동·요일 — `assignRider`, `moveRider`, `removeRider`, `updateRiderWeekdays`
  - 탑승 기록·운행 시작/종료·예외 — `recordBoarding`, `clearBoarding`, `startTrip`, `endTrip`, `reopenTrip`, `setRideException`
  - 직원 측 승하차 변경·결석 — `staffChangeRideStop`, `staffAbsentRide`, `staffSkipRide`, `staffResetRide`
  - 차량 저장·위치 보고 — `saveVehicle`, `reportVehiclePosition`
  - 학부모 계정 생성·삭제 — `createParentAccount`, `deleteParentAccount`
- 서버 액션 전체(동사 갈래): 조회 8 · 기타 5 · 생성·등록 6 · 삭제 4 · 수정·처리 23 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `shuttle_runs` 30/30★, `shuttle_run_stops` 261/261★, `shuttle_stops` 23/23★, `shuttle_riders` 372/372★, `shuttle_boardings` 23/23★, `shuttle_vehicles` 3/3★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 shuttle · AX — · 우선 P2
  - 보이는 것: 차량·회차·정류장별 배정·날짜별 탑승 기록
  - 빠진 것: 편성·탑승 기록·학부모 변경 확인
  - 제안(evidence): 학부모 변경 요청 미확인·운행 이상을 이슈로

### `inventory` 재고관리(자산·대여·실사·소모품·업체)

- 2.0: **implemented** — 면 5개(업체리스트는 지정자만), 자산 QR 라벨 인쇄, 공개 자산 페이지(/inventory/asset/[code], noindex), 엑셀.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `inventory_assets`, `inventory_supplies`, `users`
- 대상: master, admin, manager, public · 권한 키: `inventory` · 검증: reviewed
- 페이지 3: `/inventory`(screen) `/inventory/asset/[code]`(public-share) `/inventory/qr/print`(print)
- API 2: `/api/inventory/excel` `/api/inventory/qr/[code]`
- 메뉴·탭 입구 7: 재고관리(/inventory) · 업체리스트(/inventory?tab=vendors) · 자산(/inventory) · 대여(/inventory?tab=loans) · 실사(/inventory?tab=audits) · 소모품(/inventory?tab=supplies)
- 핵심 동작:
  - 자산 등록·수정·상태·보유자 — `createAsset`, `updateAsset`, `setAssetStatus`, `setAssetHolder`, `deleteAsset`
  - 대여 시작·반납 — `startLoan`, `returnLoan`, `updateLoan`
  - 실사 기록 — `recordAudit`, `updateAudit`
  - 소모품 등록·수량 — `createSupply`, `updateSupplyQty`
  - 업체 관리 — `createVendor`, `updateVendor`, `deleteVendor`
  - 엑셀 가져오기 — `importInventoryExcel`
- 서버 액션 전체(동사 갈래): 생성·등록 4 · 삭제 5 · 수정·처리 9 · 실행·발송·생성(AI 포함) 2 · 기타 1 · 조회 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `inventory_assets` 139/132★, `inventory_loans` 8/8, `inventory_audits` 9/9, `inventory_supplies` 20/19★, `inventory_vendors` 1/1 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 resources · AX — · 우선 P2
  - 보이는 것: 자산 상태 분포·소모품 수량
  - 빠진 것: 대여·실사·업체·편집
  - 제안(evidence): 실사 누락·소모품 부족을 낮은 우선순위 이슈로

### `meetings` 회의록(녹음·AI 분석)

- 2.0: **implemented** — 텍스트·녹음 회의, 전사→AI 분석(Sonnet), 화자 지정, 다시 분석·전사부터 다시, 인쇄.
- 원장 범위: **owner** · 쓰기 경로: reuse+new-storage · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: master, admin, manager · 권한 키: `meetings` · 검증: reviewed
- 페이지 4: `/meetings`(screen) `/meetings/[id]`(detail) `/meetings/[id]/print`(print) `/meetings/new`(form)
- 메뉴·탭 입구 1: 회의록(/meetings)
- 핵심 동작:
  - 회의 만들기(텍스트·녹음) — `createTextMeeting`, `startMeetingFromAudio`
  - 분석 다시 생성·처리 재시도 — `regenerateMeetingAnalysis`, `retryMeetingProcessing`
  - 메모·보고서 구획·화자·제목 수정 — `updateMeetingNotepad`, `updateMeetingReportSection`, `updateMeetingSpeakers`, `updateMeetingTitle`
  - 회의 삭제 — `deleteMeeting`
- 서버 액션 전체(동사 갈래): 생성·등록 2 · 삭제 1 · 실행·발송·생성(AI 포함) 2 · 수정·처리 4 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `meeting_minutes` 95/86 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 회의록 전부
  - 제안(command): 회의 결정 사항을 요청(담당자·기한)으로 바로 넘기는 명령

### `approvals` 전자결재(기안·결재함)

- 2.0: **implemented** — 결재함 8면(전체·결재 대기·결재 예정·진행·완료·반려·회수·참조·학원 전체 진행), 양식 4종(휴가신청서·품의서·지출결의서·수입결의서 — src/features/approvals/types.ts:11, 업무연락 폐기), 결재선 템플릿.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `approval_documents`, `approval_steps`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `approvals` · 검증: source-read (`src/features/approvals/types.ts`, `src/app/(shell)/approvals/new/page.tsx`)
- 페이지 3: `/approvals`(screen) `/approvals/[id]`(detail) `/approvals/new`(form)
- 메뉴·탭 입구 10: 전자결재(/approvals) · menu.item.approvals(/approvals) · 전체 · 결재 대기 · 결재 예정 · 진행 · 완료 · 반려·회수 · 참조 · 학원 전체 진행
- 핵심 동작:
  - 기안(휴가·기본·지출·수입) — `submitLeaveDraft`, `submitBasicDraft`, `submitExpenseDraft`, `submitIncomeDraft`
  - 결재 승인·반려·회수·보류 단계 확인 — `decideDocument`, `withdrawDocument`, `confirmDeferredStep`
  - 댓글 — `addApprovalComment`, `deleteApprovalComment`
  - 결재선 템플릿 저장·삭제 — `saveLineTemplate`, `deleteLineTemplate`
- 서버 액션 전체(동사 갈래): 생성·등록 5 · 수정·처리 4 · 삭제 2 · 감사로그 있음 · AI 없음 · 알림 발송 있음
- 핵심 표(전체/cs 행): `approval_documents` 3/3★, `approval_steps` 5/5★ (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 approvals · AX home, inbox, issue:approval · 우선 P1
  - 보이는 것: 결재 상태 흐름·문서 카드·승인/반려(세션 전용), 결재 대기 이슈
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `approve` `reject`
  - 빠진 것: 실제 결재·기안·결재선
  - 제안(issue): 내 차례 결재(할 일 approval_turn)를 결정 이슈로, 승인·반려는 실제 decideDocument 경로로
- ✅ 원문으로 해소: 기안 화면 머리 주석(approvals/new/page.tsx:18)의 "업무연락"은 낡았다 — 원장 확정 양식은 types.ts:11의 휴가·품의·지출·수입 4종

### `documents` 데이터베이스(서식·문서 저장소)

- 2.0: **implemented** — 탐색기형 폴더·파일·링크·텍스트 문서, 즐겨찾기, 미리보기. 일부 문서 restricted(이력서 등).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`
- 대상: master, admin, manager, teacher · 권한 키: `documents` · 검증: reviewed
- 페이지 3: `/documents`(screen) `/documents/[id]`(detail) `/documents/[id]/preview`(detail)
- API 1: `/api/documents/[id]/file`
- 메뉴·탭 입구 2: 데이터베이스(/documents) · menu.item.documents(/documents)
- 핵심 동작:
  - 문서 업로드·링크·텍스트 만들기 — `registerUploadedDocument`, `createLinkDocument`, `createTextDocument`
  - 수정·삭제·고정 — `updateDocument`, `deleteDocument`, `toggleDocumentPin`
  - 폴더 만들기·이름·이동 — `createDocumentCategory`, `renameDocumentCategory`, `moveDocumentCategory`, `reparentDocumentCategory`
  - 파일 이동·이름·즐겨찾기 — `moveDocumentFile`, `renameDocumentFile`, `setDocumentFolderFavorite`
- 서버 액션 전체(동사 갈래): 생성·등록 5 · 삭제 2 · 조회 1 · 수정·처리 8 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `academy_documents` 191/188★, `document_categories` 36/12 (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 resources · AX — · 우선 P2
  - 보이는 것: 문서 분류 분포·최근 문서, 로컬 첨부 다운로드
  - 빠진 것: 폴더 편집·업로드
  - 제안(evidence): 요청에 서식을 첨부하는 근거 저장소로

### `support` 고객센터(공지·개선요청)

- 2.0: **implemented** — 지점: 공지사항·개선요청 작성. 운영자: 처리상태·답변·전 지점 공지.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: master, admin, platform · 권한 키: `support` · 검증: reviewed
- 페이지 9: `/super-admin/support`(platform) `/super-admin/support/[id]`(platform) `/super-admin/support/notices`(platform) `/super-admin/support/notices/[id]`(platform) `/super-admin/support/notices/new`(platform) `/support`(screen) `/support/notices/[id]`(detail) `/support/requests/[id]`(detail) `/support/requests/new`(form)
- 메뉴·탭 입구 4: 고객센터(/support) · 고객센터(/super-admin/support) · 공지사항(/support) · 개선요청(/support?tab=requests)
- 핵심 동작:
  - 개선요청 작성·수정 — `createSupportRequest`, `updateSupportRequest`
  - 운영자 답변·공지 저장·삭제 — `answerSupportRequest`, `saveSupportNotice`, `deleteSupportNotice`
- 서버 액션 전체(동사 갈래): 생성·등록 1 · 수정·처리 3 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `support_requests` 1/1, `support_notices` 0/— (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 고객센터 전부
  - 제안(request): 원장 화면 밖 — 개선요청 답변 도착(알림 support_answer)만 알림함에

### `owner-settings` 학원 설정(18면)·관리자 도구

- 2.0: **implemented** — 면 18개(기능 면은 일반판 전용), 연동 하위 6, 설정 카드 43개. /admin/* 는 전부 /owner로 돌려보낸다.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `calendar_events`, `class_schedules`, `classes`, `classrooms`, `enrollment_consultations`, `enrollments`, `expenses`, `invoices`, `shuttle_riders`, `shuttle_run_stops`, `shuttle_runs`, `shuttle_stops`, `shuttle_vehicles`, `student_consultations`, `students`, `users`
- 대상: master, admin · 권한 키: `owner` `admin` `profile_settings` `operations_settings` `notification_settings` `consultation_settings` `navigation_settings` `popup_settings` · 검증: source-read (`src/features/owner/tabs.ts`, `src/app/(shell)/owner/page.tsx`, `src/app/(shell)/owner/_components/integrations-face.tsx`, `src/app/admin/page.tsx`)
- 페이지 6: `/admin`(redirect) `/admin/audit`(redirect) `/admin/cleanup`(redirect) `/admin/duplicates`(redirect) `/admin/integrations/sheets`(redirect) `/owner`(screen)
- API 2: `/api/excel-import/[kind]` `/api/notice-popups`
- 메뉴·탭 입구 26: 학원 설정(/owner) · 관리자 도구(/admin) · 프로필·브랜드(/owner) · 운영 체계(/owner?tab=operations) · 과목 운영(/owner?tab=subjects) · 보강 운영(/owner?tab=makeups) · 강사평가(/owner?tab=evaluation) · 원생 기여도(/owner?tab=contribution) · 수납·청구(/owner?tab=billing) · 알림·약관(/owner?tab=notifications) · 상담 양식(/owner?tab=consultations) · 역할·권한(/owner?tab=permissions) · 탭 및 메뉴 구성(/owner?tab=navigation) · 기능(/owner?tab=modules) · 대시보드 관리(/owner?tab=dashboard) · 팝업 공지(/owner?tab=popups) · 데이터 정리(/owner?tab=data) · 데이터 가져오기(/owner?tab=import) · 감사로그(/owner?tab=audit) · 연동(/owner?tab=sheets) · 슬랙(/owner?tab=sheets&sub=slack) · makeedu 동기화(/owner?tab=sheets&sub=makeedu) · 구글 시트(/owner?tab=sheets&sub=sheets) · 숙제영상 드라이브(/owner?tab=sheets&sub=video) · 연동 PC(/owner?tab=sheets&sub=agent) · 오늘 수학(/owner?tab=sheets&sub=todaysMath)
- 화면 안 카탈로그 `ownerSettingsCards`: 43개 (§10)
- 핵심 동작:
  - 설정 섹션 저장(프로필·운영·과목·청구·알림·상담 양식·권한·메뉴·기능·대시보드) — `saveOwnerSection`
  - 강의실 관리 — `createClassroom`, `updateClassroom`, `setClassroomArchived`, `deleteClassroom`
  - 과목 흡수·미사용 과목 제거 — `absorbSubject`, `removeUnusedSubject`
  - 세션 기간 저장 — `savePeriodsForSubject`
  - 팝업 공지 관리·번역 — `createNoticePopup`, `updateNoticePopup`, `toggleNoticePopupActive`, `regenerateNoticeTranslation`
  - 데이터 정리(병합·일괄 퇴원·고아 수강 종료) — `mergeStudents`, `bulkWithdrawStudents`, `bulkDeleteStudents`, `closeOrphanEnrollments`
  - 설정별 역할 권한 저장 — `saveSettingRoles`
- 서버 액션 전체(동사 갈래): 기타 2 · 수정·처리 15 · 생성·등록 3 · 삭제 3 · 실행·발송·생성(AI 포함) 1 · 조회 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `tenant_settings` 5/1, `classrooms` 25/21★, `notice_popups` 5/5, `audit_logs` 36771/36619, `operating_periods` 24/24 (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 settings · AX automation · 우선 P1
  - 보이는 것: 학원 표시 이름 편집(세션 전용)·데이터 범위 안내, 자동화 토글(세션 전용)
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `save-name`
  - 빠진 것: 18면 전부(권한·메뉴·운영 체계·청구·알림·대시보드 배치·연동·데이터 정리·감사로그)
  - 제안(settings): AX 설정은 2.0 OWNER_FACES를 그대로 열고, AX 고유 규칙(이슈·요청)만 새 면으로

### `help` 도움말(설명서·질문 게시판)

- 2.0: **implemented** — 화면 설명서·아이콘 시스템·질문 게시판(할 일 help_question)·전체 설명서 인쇄.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: master, admin, manager, teacher, accountant, counselor, viewer · 권한 키: `help` · 검증: reviewed
- 페이지 5: `/help`(screen) `/help/[slug]`(detail) `/help/icons`(screen) `/help/posts/[id]`(detail) `/print/help/manuals`(print)
- 메뉴·탭 입구 3: 도움말(/help) · 아이콘 시스템(/help/icons)
- 핵심 동작:
  - 질문 작성·수정·답변·닫기·삭제 — `createHelpPost`, `updateHelpPost`, `createHelpAnswer`, `closeHelpPost`, `deleteHelpPost`
- 서버 액션 전체(동사 갈래): 수정·처리 2 · 생성·등록 2 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `help_posts` 0/0, `help_answers` 0/0 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 도움말 전부
  - 제안(command): AI 업무 지원 입력창에서 도움말 문서를 근거로 답

### `teacher-workspace` 강사 작업 공간(미니셸·내 정보·뷰 전환)

- 2.0: **implemented** — 강사 "내 메뉴" 19개 링크(원장이 순서·표시 설정), 화면 언어(한국어/English), 겸직 강사뷰↔관리자뷰, 다른 강사 뷰(열람 전용).
- 원장 범위: **owner-linked** · 쓰기 경로: reuse+new-storage · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `users`
- 대상: teacher, viewer, master, admin · 권한 키: — · 검증: source-read (`src/lib/teacher-menu-links.ts`)
- 페이지 1: `/me`(screen)
- 핵심 동작:
  - 내 이메일·비밀번호·보고서 이름 — `updateMyEmail`, `updateMyPassword`, `updateMyReportName`
  - 강사뷰 언어 — `setMyTeacherLang`
  - 강사뷰·관리자뷰·다른 강사 뷰 전환 — `switchToTeacherView`, `switchToAdminView`, `switchToOtherTeacherView`
- 서버 액션 전체(동사 갈래): 조회 1 · 수정·처리 4 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `users` 73/63★ (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P1
  - 빠진 것: 강사 쪽 수신함(요청 확인·완료 보고) 없음
  - 제안(request): AX 요청의 수신 측 — 강사 미니셸에 요청함(확인·완료 보고)을 붙여야 흐름이 닫힌다

### `student-portal` 학생 내 학습

- 2.0: **partial** — 페이지 머리 주석: "정적 결정적 데이터(DEMO_STUDENT), DB·AI 미연동" — 데모 이식 상태.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: student · 권한 키: `my_learning` · 검증: reviewed
- 페이지 2: `/my-learning`(portal) `/my-learning/report`(portal)
- 핵심 동작:
  - 누적 현황·데일리 리포트 열람(읽기 전용) — 페이지 `/my-learning`, 페이지 `/my-learning/report`
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음(원장 작업 공간 밖)
  - 제안(evidence): 원장 범위 밖 — 제외 유지

### `parent-portal` 학부모 포털(셔틀·시간표)

- 2.0: **partial** — 탭 5칸 중 3개만 기능(실시간 차량·등하원 변경·확인·수업 시간표), 2칸은 빈 슬롯. 실시간 차량은 지도 키가 없으면 안내만.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: parent · 권한 키: — · 검증: source-read (`src/app/(parent)/parent/_components/parent-tabs.tsx`)
- 페이지 4: `/parent`(redirect) `/parent/classes`(portal) `/parent/live`(portal) `/parent/rides`(portal)
- 화면 안 카탈로그 `parentTabs`: 3개 (§10)
- 핵심 동작:
  - 등하원 결석·정류장 변경·건너뛰기·되돌리기 — `absentParentRide`, `changeParentRideStop`, `skipParentRide`, `resetParentRide`
  - 정기 승하차 변경 — `changeRegularRide`
  - 변경 이력 확인 — `ackShuttleHistory`
- 핵심 표(전체/cs 행): `shuttle_ride_exceptions` 10/10, `shuttle_ride_exception_history` 14/14, `parent_accounts` 0/0, `parent_account_students` 0/0, `shuttle_history_acks` 0/0 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음(원장 작업 공간 밖)
  - 제안(issue): 학부모 변경 요청을 셔틀 담당 확인 이슈로

### `public-sites` 공개 랜딩(제품·학원)

- 2.0: **implemented** — / = aywa 제품 랜딩(원장 고객사 대상), /academy = 학원 공개 랜딩(학부모 대상, getPublicBranding).
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: public · 권한 키: — · 검증: reviewed
- 페이지 2: `/`(public-share) `/academy`(public-share)
- 핵심 동작:
  - 열람만 — 페이지 `/`, 페이지 `/academy`
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음
  - 제안(evidence): 원장 범위 밖 — 제외

### `auth-session` 로그인·세션·링크 만료·지점 보기 안내

- 2.0: **implemented** — /home = 역할·과목별 홈 서버 리다이렉터, /menu = 옛 주소(대시보드로), /view-reset = 보기 상태 비상 해제, /tenant-view/* = 운영자 읽기 전용 지점 보기.
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: public, master, admin, teacher, platform · 권한 키: — · 검증: source-read (`src/app/home/route.ts`, `src/app/tenant-view/unconfirmed/page.tsx`, `src/app/view-reset/route.ts`)
- 페이지 4: `/expired`(public-share) `/login`(auth) `/menu`(screen) `/tenant-view/unconfirmed`(auth)
- API 4: `/home` `/tenant-view/exit` `/tenant-view/sync` `/view-reset`
- 핵심 동작:
  - 로그인·홈 판정·보기 해제 — API `/home`, API `/view-reset`, API `/tenant-view/exit`
- 서버 액션 전체(동사 갈래): 조회 1 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음(기반)
  - 제안(settings): AX도 /home 판정을 그대로 재사용

### `platform-console` 운영 콘솔(슈퍼관리자)

- 2.0: **implemented** — 메뉴 6개(대시보드·전 지점 운영·실험실 메뉴·이용 분석·고객센터·감사 로그), 지점 발급·라이선스·AI 모델·창 모드·읽기 전용 지점 보기.
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollments`, `invoices`, `students`, `users`
- 대상: platform · 권한 키: — · 검증: source-read (`src/components/super-admin/nav.ts`)
- 페이지 8: `/super-admin`(platform) `/super-admin/audit`(platform) `/super-admin/laboratory`(platform) `/super-admin/tenants`(platform) `/super-admin/tenants/[id]`(platform) `/super-admin/tenants/[id]/view`(platform) `/super-admin/tenants/new`(platform) `/super-admin/usage`(platform)
- 메뉴·탭 입구 5: 대시보드(/super-admin) · 전 지점 운영(/super-admin/tenants) · 실험실 메뉴(/super-admin/laboratory) · 이용 분석(/super-admin/usage) · 감사 로그(/super-admin/audit)
- 핵심 동작:
  - 지점 발급·수정·라이선스 — `createTenantWithMaster`, `updateTenant`, `upsertTenantLicense`, `toggleTenantLicense`
  - 지점별 AI 모델·창 모드 — `setTenantAiModel`, `setTenantWindowMode`
  - 읽기 전용 지점 보기 — `startTenantView`, `logImpersonateView`
  - 계정 역할·활성·비밀번호 — `changeUserRole`, `setUserActive`, `resetUserPassword`
  - 실험실 메뉴 배정 — `toggleLaboratoryMenu`
- 서버 액션 전체(동사 갈래): 수정·처리 9 · 생성·등록 2 · 실행·발송·생성(AI 포함) 1 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `tenants` 5/—, `tenant_licenses` 15/11, `tenant_ai_models` 0/0, `lab_menu_assignments` 5/— (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음 — 지점 화면에 운영자 설정 노출 금지(CLAUDE.md)
  - 제안(settings): 분리 유지

### `integrations` 외부 연동(makeedu·구글 시트·오늘 수학·IJW)

- 2.0: **implemented** — makeedu = 연동 PC 앱(AywaSync) 경유, 구글 시트 매일 동기화, 오늘 수학 v2 API·자동 로그인·결과 가져오기, 인재원(IJW) 학습 데이터 pull. 설정 입구 = 학원 설정 > 연동(하위 6).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollment_consultations`, `enrollments`, `lesson_reports`, `students`, `users`
- 대상: master, admin, device · 권한 키: `integrations` `sheet_sync` · 검증: reviewed
- API 20: `/api/connected-apps/todays-math/authorize` `/api/connected-apps/todays-math/launch` `/api/cron/ijw-memorized-words`@20 19 * * * `/api/cron/ijw-profile-sync`@30 19 * * * `/api/cron/sheets-sync`@0 19 * * * `/api/cron/todays-math-results`@7 * * * * `/api/cron/todays-math-sync`@* * * * * `/api/integrations/todays-math/progress` `/api/integrations/todays-math/roster` `/api/integrations/todays-math/v2/control` `/api/integrations/todays-math/v2/menus-changed` `/api/integrations/todays-math/v2/results-wake` `/api/integrations/todays-math/v2/snapshots` `/api/integrations/todays-math/v2/snapshots/[snapshotId]` `/api/integrations/todays-math/v2/token` `/api/sync-agent/[action]` `/api/sync-agent/latest` `/api/sync-agent/operation` `/api/sync-agent/pair` `/api/sync-agent/query`
- 핵심 동작:
  - makeedu 동기화 켜기·지금 실행·워커 점검 — `setMakeeduSyncEnabled`, `triggerMakeeduSyncNow`, `checkMakeeduSyncWorkers`
  - 구글 시트 내보내기 켜기·과목 시트 지정·지금 동기화 — `setSheetsExportEnabled`, `setSubjectSheetTarget`, `syncSheetsNow`
  - 연동 PC 코드 발급·해지·설정 — `issueAgentCode`, `revokeAgentDevice`, `saveAgentSettings`
  - 오늘 수학 사용 메뉴 저장 — `loadTodaysMathMenus`, `saveTodaysMathMenus`
  - IJW 학생 연결·자동 매칭 — `linkIjwUniqueMatches`, `unlinkIjwStudent`
- 서버 액션 전체(동사 갈래): 생성·등록 5 · 실행·발송·생성(AI 포함) 3 · 수정·처리 7 · 조회 5 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `makeedu_sync_runs` 275/275, `makeedu_sync_requests` 42/42, `sync_agent_devices` 1/1, `sync_agent_events` 2974/2974, `user_integrations` 3/3 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P1
  - 빠진 것: 연동 상태·실패 이력
  - 제안(issue): 연동 실패(알림 makeedu_login_failed·slack_broken)를 이슈로, 설정 딥링크

### `recording-transcription` 녹음·전사 파이프라인

- 2.0: **implemented** — 오디오 업로드 티켓 → AssemblyAI(universal-2) 웹훅 → 상담·회의 분석. 보존 기한 정리·전사 대사 크론.
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `enrollment_consultations`, `student_consultations`
- 대상: master, admin, counselor · 권한 키: — · 검증: reviewed
- API 3: `/api/cron/reconcile-transcriptions`@0 18 * * * `/api/cron/recordings-retention`@0 17 * * * `/api/webhooks/assemblyai`
- 핵심 동작:
  - 오디오 업로드 티켓 발급 — `issueAudioUploadTicket`
- 서버 액션 전체(동사 갈래): 생성·등록 1 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `consultation_recordings` 41/41, `meeting_minutes` 95/86 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 처리 실패 표시
  - 제안(issue): 전사·분석 실패를 이슈로

### `shell-infrastructure` 공용 기반(검색·동시편집·메뉴 기록·최대화·내보내기·통계·학교명)

- 2.0: **implemented** — 검색 팰릿(Shift+F)·수정중 표시·메뉴 방문 기록·화면 최대화·엑셀 내보내기 라이브러리·통계 공용·학교 표기. english-assessment 는 외부 import 0건(고아).
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollment_consultations`, `enrollments`, `student_consultations`, `students`, `users`
- 대상: master, admin, manager, teacher, accountant, counselor, viewer · 권한 키: — · 검증: reviewed
- API 2: `/api/search/palette` `/api/usage`
- 핵심 동작:
  - 메뉴 방문 기록·검색 숨김 — `recordMenuVisit`, `saveMenuSearchHidden`
  - 화면 최대화 저장 — `setMyPageMaximized`
  - 검색 팰릿 조회 — API `/api/search/palette`
- 서버 액션 전체(동사 갈래): 수정·처리 3 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `users` 73/63★ (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 — · AX home · 우선 P1
  - 보이는 것: 전체 업무 런처·키보드 검색(시안)
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `ax:launcher` `ax:chat` `ax:prompt` `ax:ask` `ax:form:chat`
  - 빠진 것: 2.0 팰릿의 권한 반영 검색
  - 제안(command): AX 명령 입력이 2.0 팰릿 검색을 재사용

### `demo-tenant` 데모 지점 갱신

- 2.0: **implemented** — 가상 데모 지점만 매일 갱신(slug·명단 태그 확인).
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`
- 대상: platform · 권한 키: — · 검증: reviewed
- API 1: `/api/cron/demo-refresh`@5 21 * * *
- 핵심 동작:
  - 데모 명단 전환 — `switchDemoRoster`
- 서버 액션 전체(동사 갈래): 수정·처리 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음
  - 제안(settings): 제외

### `dev-tools` 개발용 화면

- 2.0: **implemented** — development 환경에서만 proxy가 통과시키는 하네스(대시보드·탭 구성 미리보기).
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: developer · 권한 키: — · 검증: source-read (`src/proxy.ts`)
- 페이지 2: `/dev/dashboard-harness`(dev) `/dev/navigation`(dev)
- 핵심 동작:
  - 미리보기 — 페이지 `/dev/dashboard-harness`, 페이지 `/dev/navigation`
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음
  - 제안(settings): 제외

## 7. 페이지 라우트 전수표

| URL | 클래스 | 패밀리 | 제목(metadata) | 게이트 상태 | 게이트·단서 | 파일 |
| --- | --- | --- | --- | --- | --- | --- |
| / | public-share | public-sites | — | public-by-design | — | src/app/(marketing)/page.tsx |
| /academy | public-share | public-sites | ${name} — 문 안쪽 | public-by-design | — | src/app/(academy)/academy/page.tsx |
| /admin | redirect | owner-settings | — | session-only | session | src/app/admin/page.tsx |
| /admin/audit | redirect | owner-settings | — | public-by-design | — | src/app/(shell)/admin/audit/page.tsx |
| /admin/cleanup | redirect | owner-settings | — | public-by-design | — | src/app/(shell)/admin/cleanup/page.tsx |
| /admin/duplicates | redirect | owner-settings | — | public-by-design | — | src/app/(shell)/admin/duplicates/page.tsx |
| /admin/integrations/sheets | redirect | owner-settings | — | public-by-design | — | src/app/(shell)/admin/integrations/sheets/page.tsx |
| /approvals | screen | approvals | 전자결재 — 에이와 | menu-gate | requireAccess:approvals requireAccess | src/app/(shell)/approvals/page.tsx |
| /approvals/[id] | detail | approvals | 결재 문서 — 에이와 | custom-gate | notFound redirect-when-no-data session | src/app/(shell)/approvals/[id]/page.tsx |
| /approvals/new | form | approvals | 기안하기 — 에이와 | menu-gate | requireAccess:approvals requireAccess | src/app/(shell)/approvals/new/page.tsx |
| /attendance | screen | attendance | ${sheetT(await getTeacherViewLang(), "att.title")}${PAGE_TITLE_SUFFIX} | menu-gate | requireAccess:attendance canManageTenant canShowAttendanceActualAmount canViewPayslipNow canViewUnitsMaster isModuleEnabled requireAccess | src/app/(shell)/attendance/page.tsx |
| /attendance/[date] | detail | attendance | 출석부 — 에이와 | menu-gate | requireAccess:attendance requireAccess | src/app/(shell)/attendance/[date]/page.tsx |
| /attendance/[date]/[classId] | detail | attendance | 출석 입력 — 에이와 | menu-gate | requireAccess:attendance notFound redirect-when-no-data requireAccess | src/app/(shell)/attendance/[date]/[classId]/page.tsx |
| /attendance/class/[classId]/month/print | print | attendance | 출석부 인쇄 — 에이와 | menu-gate | requireAccess:attendance requireAccess | src/app/(print)/attendance/class/[classId]/month/print/page.tsx |
| /attendance/live | screen | attendance | 오늘 출결 — 에이와 | menu-gate | requireAccess:attendance requireAccess | src/app/(shell)/attendance/live/page.tsx |
| /attendance/quick | screen | attendance | ${sheetT(await getTeacherViewLang(), "quick.title")}${PAGE_TITLE_SUFFIX} | menu-gate | requireAccess:attendance requireAccess | src/app/(shell)/attendance/quick/page.tsx |
| /attendance/seat | redirect | attendance | — | public-by-design | — | src/app/(shell)/attendance/seat/page.tsx |
| /attendance/seat/[seat] | detail | attendance | 랩실·JJ실 출석부 — 에이와 | menu-gate | requireAccess:seat_attendance canWriteTenant notFound redirect-when-no-data requireAccess session | src/app/(shell)/attendance/seat/[seat]/page.tsx |
| /attendance/seat/[seat]/month | detail | attendance | ${seat ? SEAT_NAME[seat] : "자리"} 월간 출석부 — 에이와 | menu-gate | requireAccess:seat_attendance notFound redirect-when-no-data requireAccess session | src/app/(shell)/attendance/seat/[seat]/month/page.tsx |
| /attendance/seat/[seat]/month/print | print | attendance | ${seat ? SEAT_NAME[seat] : "자리"} 월간 출석부 인쇄 — 에이와 | menu-gate | requireAccess:seat_attendance notFound redirect-when-no-data requireAccess session | src/app/(print)/attendance/seat/[seat]/month/print/page.tsx |
| /attendance/stats | stats | attendance | 출결 통계 — 에이와 | menu-gate | requireAccess:attendance requireAccess | src/app/(shell)/attendance/stats/page.tsx |
| /attendance/units-master | screen | attendance | 시수 마스터 — 에이와 | verified-in-loader | src/features/attendance/server/units-master.ts:39 — loadUnitsMaster가 requireAccess("attendance") | src/app/(shell)/attendance/units-master/page.tsx |
| /billing | screen | billing | 수납관리${suffix} — 에이와 | menu-gate | requireAccess requireAccess:billing canAccessTenant canManageTenant canReadSalary isModuleEnabled requireAccess | src/app/(shell)/billing/page.tsx |
| /billing/expenses/[id] | detail | billing | — | menu-gate | requireAccess:billing notFound redirect-when-no-data requireAccess | src/app/(shell)/billing/expenses/[id]/page.tsx |
| /billing/refunds/[id] | detail | billing | 환불 요청서 — 에이와 | menu-gate | requireAccess:billing canWriteTenant notFound redirect-when-no-data requireAccess | src/app/(shell)/billing/refunds/[id]/page.tsx |
| /billing/refunds/new | form | billing | 환불 요청서 작성 — 에이와 | menu-gate | requireAccess:billing canWriteTenant requireAccess | src/app/(shell)/billing/refunds/new/page.tsx |
| /billing/stats | stats | billing | 수납 통계 — 에이와 | menu-gate | requireAccess:billing requireAccess | src/app/(shell)/billing/stats/page.tsx |
| /calendar | screen | calendar | 캘린더 — 에이와 | menu-gate | requireAccess:calendar canManageTenant canWriteTenant requireAccess | src/app/(shell)/calendar/page.tsx |
| /class-review | screen | class-review | 직원 평가${tab === "portfolio" ? " · 직원 포트폴리오" : ""} — 에이와 | menu-gate | requireAccess:class_review requireAccess | src/app/(shell)/class-review/page.tsx |
| /class-review/[id] | detail | class-review | 직원 평가 상세 — 에이와 | menu-gate | requireAccess:class_review canWriteTenant notFound redirect-when-no-data requireAccess | src/app/(shell)/class-review/[id]/page.tsx |
| /class-review/[id]/score | detail | class-review | 직원 평가 채점 — 에이와 | menu-gate | requireAccess:class_review notFound redirect-when-no-data requireAccess | src/app/(shell)/class-review/[id]/score/page.tsx |
| /class-review/board | screen | class-review | 직원 평가 종합 — 에이와 | menu-gate | requireAccess:class_review redirect-when-no-data requireAccess | src/app/(shell)/class-review/board/page.tsx |
| /class-review/new | form | class-review | 새 평가 — 에이와 | menu-gate | requireAccess:class_review requireAccess | src/app/(shell)/class-review/new/page.tsx |
| /class-review/template | screen | class-review | 직원 평가 문항 편집 — 에이와 | menu-gate | requireAccess:class_review redirect-when-no-data requireAccess | src/app/(shell)/class-review/template/page.tsx |
| /classes | screen | classes | ${sheetT(await getTeacherViewLang(), "cls.title")}${PAGE_TITLE_SUFFIX} | menu-gate | requireAccess:classes canManageTenant requireAccess | src/app/(shell)/classes/page.tsx |
| /classes/[id] | detail | classes | ${sheetT(await getTeacherViewLang(), "cls.d.title")}${PAGE_TITLE_SUFFIX} | menu-gate | requireAccess:classes canEditEnrollmentDateClass canManageStudentStatusNow canManageTenant canWriteLoadedClass getEnrollmentDateAccess isModuleEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/classes/[id]/page.tsx |
| /classes/[id]/edit | form | classes | 반 수정 — 에이와 | menu-gate | requireAccess:classes canWriteLoadedClass isModuleEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/classes/[id]/edit/page.tsx |
| /classes/new | form | classes | 새 반 — 에이와 | menu-gate | requireAccess:classes isModuleEnabled requireAccess | src/app/(shell)/classes/new/page.tsx |
| /consultations | screen | consultations | 원생상담 — 에이와 | menu-gate | requireAccess:consultations canManageTenant isModuleEnabled requireAccess | src/app/(shell)/consultations/page.tsx |
| /consultations/[id] | detail | consultations | 상담 상세 — 에이와 | menu-gate | requireAccess:consultations notFound redirect-when-no-data requireAccess | src/app/(shell)/consultations/[id]/page.tsx |
| /consultations/[id]/edit | form | consultations | 상담 수정 — 에이와 | menu-gate | requireAccess:consultations notFound redirect-when-no-data requireAccess | src/app/(shell)/consultations/[id]/edit/page.tsx |
| /consultations/new | form | consultations | 새 원생상담 — 에이와 | menu-gate | requireAccess:consultations requireAccess | src/app/(shell)/consultations/new/page.tsx |
| /consultations/stats | stats | consultations | 상담 통계 — 에이와 | menu-gate | requireAccess:consultations isModuleEnabled requireAccess | src/app/(shell)/consultations/stats/page.tsx |
| /dashboard | screen | dashboard | 대시보드 — 에이와 | layout-gate | requireAccess:dashboard@src/app/(shell)/dashboard/layout.tsx requireAccess@src/app/(shell)/dashboard/layout.tsx | src/app/(shell)/dashboard/page.tsx |
| /dashboard/announcements | screen | dashboard | 학원 공지 — 에이와 | menu-gate | requireAccess:dashboard requireAccess:dashboard@src/app/(shell)/dashboard/layout.tsx requireAccess@src/app/(shell)/dashboard/layout.tsx canManageStaff canWrite requireAccess | src/app/(shell)/dashboard/announcements/page.tsx |
| /dashboard/briefing | redirect | dashboard | — | layout-gate | requireAccess:dashboard@src/app/(shell)/dashboard/layout.tsx requireAccess@src/app/(shell)/dashboard/layout.tsx | src/app/(shell)/dashboard/briefing/page.tsx |
| /dev/dashboard-harness | dev | dev-tools | — | custom-gate | notFound | src/app/dev/dashboard-harness/page.tsx |
| /dev/navigation | dev | dev-tools | 탭 구성 미리보기 — 에이와 | custom-gate | notFound | src/app/dev/navigation/page.tsx |
| /documents | screen | documents | 데이터베이스 — 에이와 | menu-gate | requireAccess:documents canAccessTenant canWriteTenant requireAccess | src/app/(shell)/documents/page.tsx |
| /documents/[id] | detail | documents | 문서 상세 — 에이와 | menu-gate | requireAccess:documents canWriteTenant notFound redirect-when-no-data requireAccess | src/app/(shell)/documents/[id]/page.tsx |
| /documents/[id]/preview | detail | documents | 문서 미리보기 — 에이와 | menu-gate | requireAccess:documents notFound requireAccess | src/app/(shell)/documents/[id]/preview/page.tsx |
| /ecs | screen | class-sheets | 영어 강사 시트 — 에이와 | menu-gate | requireAccess:ecs isModuleEnabled requireAccess | src/app/(shell)/ecs/page.tsx |
| /ecs/[classId] | detail | class-sheets | 영어 강사 시트 — 에이와 | menu-gate | requireEcsClassAccess requireEcsClassAccess | src/app/(shell)/ecs/[classId]/page.tsx |
| /ecs/[classId]/month | detail | class-sheets | 영어 강사 시트 · 월간 — 에이와 | verified-in-loader | isModuleEnabled src/app/(shell)/ecs/[classId]/month/page.tsx:23 주석 — 조회 안의 requireEcsClassAccess(주간과 같은 함수, #77) | src/app/(shell)/ecs/[classId]/month/page.tsx |
| /ecs/[classId]/month-plan/print | print | class-sheets | 월간 계획서 인쇄 — 에이와 | verified-in-loader | src/app/(print)/ecs/[classId]/month-plan/print/page.tsx:15·30 — getMonthPlanPrint(화면과 같은 게이트 + EiE 재확인) | src/app/(print)/ecs/[classId]/month-plan/print/page.tsx |
| /ecs/goals | screen | class-sheets | 반 계획 보기 — 에이와 | menu-gate | requireAccess:ecs requireAccess | src/app/(shell)/ecs/goals/page.tsx |
| /ecs/plan-gap | screen | class-sheets | 계획 대비 현황 — 에이와 | menu-gate | requireAccess:ecs requireAccess | src/app/(shell)/ecs/plan-gap/page.tsx |
| /enrollment | screen | enrollment | 신규 콜&상담 — 에이와 | menu-gate | requireAccess:enrollment canAccessTenant canManageTenant canPushToMakeedu canWriteTenant requireAccess | src/app/(shell)/enrollment/page.tsx |
| /enrollment/[id] | detail | enrollment | 신입생 상담 상세 — 에이와 | menu-gate | requireAccess:enrollment canViewClassDetail canWriteTenant isModuleEnabled notFound requireAccess | src/app/(shell)/enrollment/[id]/page.tsx |
| /enrollment/[id]/edit | form | enrollment | 신규 콜&상담 수정 — 에이와 | menu-gate | requireAccess:enrollment notFound redirect-when-no-data requireAccess | src/app/(shell)/enrollment/[id]/edit/page.tsx |
| /enrollment/[id]/prep | print | enrollment | 상담 준비 브리프 — 에이와 | menu-gate | requireAccess:enrollment notFound requireAccess | src/app/(print)/enrollment/[id]/prep/page.tsx |
| /enrollment/[id]/print | print | enrollment | 신입생 인수인계서 — 에이와 | menu-gate | requireAccess:enrollment notFound requireAccess | src/app/(print)/enrollment/[id]/print/page.tsx |
| /enrollment/new | form | enrollment | 신규 콜&상담 작성 — 에이와 | menu-gate | requireAccess:enrollment requireAccess | src/app/(shell)/enrollment/new/page.tsx |
| /exams | screen | exams | 통합 성적관리 — 에이와 | menu-gate | requireAccess:exams requireAccess | src/app/(shell)/exams/page.tsx |
| /exams/input | screen | exams | 성적관리 — 에이와 | menu-gate | requireAccess:exams requireAccess | src/app/(shell)/exams/input/page.tsx |
| /exams/jj/[deckId] | detail | exams | JJ실 시험 결과 — 에이와 | menu-gate | requireAccess:exams notFound requireAccess | src/app/(shell)/exams/jj/[deckId]/page.tsx |
| /exams/jj/attempt/[attemptId] | detail | exams | JJ실 시험 결과지 — 에이와 | menu-gate | requireAccess:exams notFound requireAccess | src/app/(shell)/exams/jj/attempt/[attemptId]/page.tsx |
| /exams/jj/attempt/[attemptId]/vocabking | detail | exams | 보카킹 종합평가 리포트 — 에이와 | menu-gate | requireAccess:exams notFound requireAccess | src/app/(shell)/exams/jj/attempt/[attemptId]/vocabking/page.tsx |
| /exams/view | screen | exams | 성적 확인 — 에이와 | menu-gate | requireAccess:exams requireAccess | src/app/(shell)/exams/view/page.tsx |
| /expense-requests | screen | expense-requests | — | menu-gate | requireAccess:expense_requests requireAccess | src/app/(shell)/expense-requests/page.tsx |
| /expense-requests/[id] | detail | expense-requests | 지출결의서 — 에이와 | menu-gate | requireAccess:expense_requests notFound requireAccess | src/app/(shell)/expense-requests/[id]/page.tsx |
| /expired | public-share | auth-session | 링크 만료 | public-by-design | — | src/app/(share)/expired/page.tsx |
| /help | screen | help | 도움말 — 에이와 | menu-gate | requireAccess:help canAskHelpBoard requireAccess | src/app/(shell)/help/page.tsx |
| /help/[slug] | detail | help | — | menu-gate | requireAccess:help notFound redirect-when-no-data requireAccess | src/app/(shell)/help/[slug]/page.tsx |
| /help/icons | screen | help | 아이콘 시스템 — 에이와 | menu-gate | requireAccess:help requireAccess | src/app/(shell)/help/icons/page.tsx |
| /help/posts/[id] | detail | help | 도움말 질문 — 에이와 | menu-gate | requireAccess:help canAnswerHelpBoard notFound redirect-when-no-data requireAccess | src/app/(shell)/help/posts/[id]/page.tsx |
| /intake/[token] | public-share | enrollment | 입학 상담 신청 | custom-gate | isModuleEnabled | src/app/(intake)/intake/[token]/page.tsx |
| /inventory | screen | inventory | 재고관리${TITLE_SUFFIX[tab]} — 에이와 | menu-gate | requireAccess:inventory canViewVendorsNow canWriteTenant requireAccess | src/app/(shell)/inventory/page.tsx |
| /inventory/asset/[code] | public-share | inventory | ${decodeURIComponent((await params).code)} — 재고관리 — 에이와 | custom-gate | notFound redirect-when-no-data | src/app/(asset)/inventory/asset/[code]/page.tsx |
| /inventory/qr/print | print | inventory | 자산 QR 라벨 인쇄 — 재고관리 — 에이와 | menu-gate | requireAccess:inventory requireAccess | src/app/(print)/inventory/qr/print/page.tsx |
| /kiosk | device | attendance | — | custom-gate | isLaboratoryMenuAvailable isModuleEnabled notFound | src/app/(kiosk)/kiosk/page.tsx |
| /kiosk-settings | screen | attendance | 출석 키오스크 설정 — 에이와 | menu-gate | requireAccess:kiosk_settings canWriteTenant requireAccess | src/app/(shell)/kiosk-settings/page.tsx |
| /lesson_reports/[id]/print | print | lesson-reports | 보고서 — 에이와 | custom-gate | canAccessTenant canViewStudentDetail notFound redirect-when-no-data | src/app/(print)/lesson_reports/[id]/print/page.tsx |
| /lesson-reports | screen | lesson-reports | 수업보고서 — 에이와 | menu-gate | requireAccess requireAccess:lesson_reports canAccessTenant canWriteTenant isFeatureLicensed requireAccess | src/app/(shell)/lesson-reports/page.tsx |
| /lesson-reports/stats | stats | lesson-reports | 보고서 통계 — 에이와 | menu-gate | requireAccess:lesson_reports requireAccess | src/app/(shell)/lesson-reports/stats/page.tsx |
| /lesson-reports/video-homework | screen | video-homework | 영상숙제 확인 · 에이와 | menu-gate | requireAccess:lesson_reports canAccessTenant canWriteTenant isFeatureLicensed isModuleEnabled isVideoHomeworkClassEnabled isVideoHomeworkEnabled requireAccess | src/app/(shell)/lesson-reports/video-homework/page.tsx |
| /login | auth | auth-session | 로그인 — 에이와 | public-by-design | — | src/app/(auth)/login/page.tsx |
| /makeups | screen | makeups | 보강관리 — 에이와 | menu-gate | requireAccess:makeups canWriteTenant requireAccess | src/app/(shell)/makeups/page.tsx |
| /makeups/[id] | detail | makeups | 보강관리 · 상세 — 에이와 | menu-gate | requireAccess:makeups notFound requireAccess | src/app/(shell)/makeups/[id]/page.tsx |
| /makeups/candidates | screen | makeups | 보강관리 · 미연결 근거 — 에이와 | menu-gate | requireAccess:makeups canWriteTenant requireAccess | src/app/(shell)/makeups/candidates/page.tsx |
| /makeups/dry-run | screen | makeups | 보강관리 · 도입 사전 점검 — 에이와 | menu-gate | requireAccess:makeups canWriteTenant requireAccess | src/app/(shell)/makeups/dry-run/page.tsx |
| /makeups/new | form | makeups | 보강 접수 — 에이와 | menu-gate | requireAccess:makeups canWriteTenant notFound requireAccess | src/app/(shell)/makeups/new/page.tsx |
| /makeups/reconciliation | screen | makeups | 보강관리 · 대사·복구 — 에이와 | menu-gate | requireAccess:makeups canWriteTenant requireAccess | src/app/(shell)/makeups/reconciliation/page.tsx |
| /mcs | screen | class-sheets | 수학 강사 시트 — 에이와 | menu-gate | requireAccess:mcs canPreviewProgressMap requireAccess | src/app/(shell)/mcs/page.tsx |
| /mcs/[classId]/month | detail | class-sheets | 수학 강사 시트 · 월간 — 에이와 | verified-in-loader | canResetMathLearningGoals src/app/(shell)/mcs/[classId]/month/page.tsx:28·66 — getMathSheetMonth 안 requireMcsClassAccess(#77) | src/app/(shell)/mcs/[classId]/month/page.tsx |
| /mcs/progress-map | screen | class-sheets | 수학 학습 진도맵 — 에이와 | menu-gate | requireAccess:mcs canPreviewProgressMap notFound requireAccess | src/app/(shell)/mcs/progress-map/page.tsx |
| /mcs/teachers | screen | class-sheets | 수학 강사 시트 · 선생님별 — 에이와 | menu-gate | requireAccess:mcs requireAccess | src/app/(shell)/mcs/teachers/page.tsx |
| /me | screen | teacher-workspace | ${sheetT(await getTeacherViewLang(), "me.eyebrow")}${PAGE_TITLE_SUFFIX} | custom-gate | canViewResume redirect-when-no-data session | src/app/(shell)/me/page.tsx |
| /meetings | screen | meetings | 회의록 — 에이와 | menu-gate | requireAccess:meetings requireAccess | src/app/(shell)/meetings/page.tsx |
| /meetings/[id] | detail | meetings | 회의록 상세 — 에이와 | menu-gate | requireAccess:meetings notFound redirect-when-no-data requireAccess | src/app/(shell)/meetings/[id]/page.tsx |
| /meetings/[id]/print | print | meetings | 회의록 인쇄 — 에이와 | menu-gate | requireAccess:meetings notFound redirect-when-no-data requireAccess | src/app/(print)/meetings/[id]/print/page.tsx |
| /meetings/new | form | meetings | 새 회의록 — 에이와 | menu-gate | requireAccess:meetings requireAccess | src/app/(shell)/meetings/new/page.tsx |
| /menu | screen | auth-session | 업무 선택 — 에이와 | custom-gate | canAccess redirect-when-no-data session | src/app/(shell)/menu/page.tsx |
| /my-learning | portal | student-portal | 내 학습 현황 — 에이와 | menu-gate | requireAccess:my_learning requireAccess | src/app/(shell)/my-learning/page.tsx |
| /my-learning/report | portal | student-portal | 데일리 리포트 — 에이와 | menu-gate | requireAccess:my_learning requireAccess | src/app/(shell)/my-learning/report/page.tsx |
| /newcomers | screen | newcomers | 신규생 관리 — 에이와 | menu-gate | requireAccess:newcomers canWriteTenant requireAccess | src/app/(shell)/newcomers/page.tsx |
| /newcomers/stats | stats | newcomers | 신규생 기록 — 에이와 | menu-gate | requireAccess:newcomers requireAccess | src/app/(shell)/newcomers/stats/page.tsx |
| /onescreen | screen | onescreen | 선생님 원스크린 — 에이와 | custom-gate | getJjAccess redirect-when-no-data session | src/app/(shell)/onescreen/page.tsx |
| /onescreen/video-homework | screen | video-homework | 영상 제출 현황 · 에이와 | custom-gate | canAccessTenant canWriteTenant isVideoHomeworkClassEnabled isVideoHomeworkEnabled redirect-when-no-data session | src/app/(shell)/onescreen/video-homework/page.tsx |
| /owner | screen | owner-settings | 학원 설정 · ${ownerTabLabel(tab)} — 에이와 | menu-gate | requireAccess canAccess canAccessTenant canManageTenant canWriteTenant getContributionGate getPortfolioGate isCurrentUserSuperAdmin isFeatureLicensed isLaboratoryMenuAvailable isModuleEnabled requireAccess | src/app/(shell)/owner/page.tsx |
| /parent | redirect | parent-portal | — | public-by-design | — | src/app/(parent)/parent/page.tsx |
| /parent/classes | portal | parent-portal | 수업 시간표 | custom-gate | redirect-when-no-data | src/app/(parent)/parent/classes/page.tsx |
| /parent/live | portal | parent-portal | 실시간 차량 | custom-gate | redirect-when-no-data | src/app/(parent)/parent/live/page.tsx |
| /parent/rides | portal | parent-portal | — | custom-gate | redirect-when-no-data | src/app/(parent)/parent/rides/page.tsx |
| /payroll/[teacherId]/payslip | print | payroll | 급여명세서 — 에이와 | custom-gate | canManagePayslipNow canViewPayslipNow redirect-when-no-data session | src/app/(print)/payroll/[teacherId]/payslip/page.tsx |
| /print/help/manuals | print | help | 전체 화면 설명서 — 에이와 | menu-gate | requireAccess:help requireAccess | src/app/(print)/print/help/manuals/page.tsx |
| /r/[token] | public-share | lesson-reports | 보고서 | custom-gate | notFound redirect-when-no-data | src/app/(share)/r/[token]/page.tsx |
| /retention | screen | retention | 이탈 방어 — 에이와 | menu-gate | requireAccess:retention requireAccess | src/app/(shell)/retention/page.tsx |
| /retention/board | screen | retention | 리텐션 보드 — 에이와 | menu-gate | requireAccess:retention requireAccess | src/app/(shell)/retention/board/page.tsx |
| /retention/campaign | screen | retention | 재등록 캠페인 — 에이와 | menu-gate | requireAccess:retention requireAccess | src/app/(shell)/retention/campaign/page.tsx |
| /retention/messages | screen | retention | 학부모 메시지 — 에이와 | menu-gate | requireAccess:retention requireAccess | src/app/(shell)/retention/messages/page.tsx |
| /seat | redirect | attendance | — | public-by-design | — | src/app/(seat)/seat/page.tsx |
| /seat/[seat] | device | attendance | 자리 출석부 | custom-gate | notFound redirect-when-no-data | src/app/(seat)/seat/[seat]/page.tsx |
| /shuttle | screen | shuttle | 셔틀 — 에이와 | menu-gate | requireShuttleView canManageTenant canWriteTenant isShuttleAdmin | src/app/(shell)/shuttle/(board)/page.tsx |
| /shuttle/live | screen | shuttle | 셔틀 운행 현황 — 에이와 | menu-gate | requireShuttleView isShuttleAdmin | src/app/(shell)/shuttle/live/page.tsx |
| /shuttle/parent-rides | screen | shuttle | 학부모 등하원 — aywa | menu-gate | requireShuttleView canRecordBoarding isShuttleAdmin | src/app/(shell)/shuttle/parent-rides/page.tsx |
| /shuttle/parents | screen | shuttle | 셔틀 학부모 관리 현황 — aywa | menu-gate | requireParentAccountsAccess requireParentAccountsAccess | src/app/(shell)/shuttle/parents/page.tsx |
| /shuttle/route | print | shuttle | 셔틀 노선표 인쇄 — 에이와 | menu-gate | requireShuttleView | src/app/(print)/shuttle/route/page.tsx |
| /shuttle/today | screen | shuttle | 셔틀 — 에이와 | menu-gate | requireShuttleView canRecordBoarding isShuttleAdmin | src/app/(shell)/shuttle/today/page.tsx |
| /shuttle/track | screen | shuttle | 셔틀 실시간 위치 — 에이와 | menu-gate | requireShuttleView isShuttleAdmin notFound | src/app/(shell)/shuttle/track/page.tsx |
| /shuttle/week | screen | shuttle | 셔틀 주간 시간표 — 에이와 | menu-gate | requireShuttleView | src/app/(shell)/shuttle/week/page.tsx |
| /staff | screen | staff | 직원관리 — 에이와 | menu-gate | requireAccess:staff canAdjustLeave canManageTenant canWriteTenant isCurrentUserSuperAdmin isPayrollEnabled isStaffLeavesEnabled requireAccess | src/app/(shell)/staff/page.tsx |
| /staff-intake/[token] | public-share | staff | 직원 등록 | public-by-design | — | src/app/(intake)/staff-intake/[token]/page.tsx |
| /staff/[id] | detail | staff | 직원 상세 — 에이와 | menu-gate | requireAccess:staff canManageStaffMember canManageThis canViewResume canWriteTenant isPayrollEnabled isStaffLeavesEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/staff/[id]/page.tsx |
| /staff/[id]/edit | form | staff | 근무 설정 — 에이와 | menu-gate | requireAccess:staff canWriteTenant isCurrentUserSuperAdmin isPayrollEnabled isStaffLeavesEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/staff/[id]/edit/page.tsx |
| /staff/[id]/leaves | detail | staff | 휴가 관리 — 에이와 | menu-gate | requireAccess:staff canWriteTenant isStaffLeavesEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/staff/[id]/leaves/page.tsx |
| /staff/[id]/payroll | detail | staff | 강사 정산 — 에이와 | menu-gate | requireAccess:staff canManageStaff isCurrentUserSuperAdmin isPayrollEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/staff/[id]/payroll/page.tsx |
| /staff/annual-leave | screen | staff | 연차 관리 — 에이와 | menu-gate | requireAccess:staff canAdjustLeave isCurrentUserSuperAdmin requireAccess | src/app/(shell)/staff/annual-leave/page.tsx |
| /staff/leaves | screen | staff | 휴가 관리 — 에이와 | menu-gate | requireAccess:staff canWriteTenant isStaffLeavesEnabled requireAccess | src/app/(shell)/staff/leaves/page.tsx |
| /staff/new | form | staff | 직원 등록 — 에이와 | menu-gate | requireAccess:staff canWriteTenant isCurrentUserSuperAdmin requireAccess | src/app/(shell)/staff/new/page.tsx |
| /staff/payroll | screen | staff | 월별 급여 — 에이와 | menu-gate | requireAccess:staff canManageSalary isPayrollEnabled requireAccess | src/app/(shell)/staff/payroll/page.tsx |
| /staff/resumes | redirect | staff | — | public-by-design | — | src/app/(shell)/staff/resumes/page.tsx |
| /staff/resumes/[id] | detail | staff | 직원 이력서 — 에이와 | menu-gate | requireAccess:staff canViewResume canWriteTenant notFound redirect-when-no-data requireAccess | src/app/(shell)/staff/resumes/[id]/page.tsx |
| /staff/resumes/new | form | staff | — | menu-gate | requireAccess:staff canWriteTenant requireAccess | src/app/(shell)/staff/resumes/new/page.tsx |
| /student-contribution | screen | student-contribution | 원생 기여도 — 에이와 | custom-gate | redirect-when-no-data | src/app/(shell)/student-contribution/page.tsx |
| /student-contribution/[id] | detail | student-contribution | 원생 기여도 상세 — 에이와 | custom-gate | getContributionGate | src/app/(shell)/student-contribution/[id]/page.tsx |
| /student-contribution/ontology | screen | student-contribution | 학생 기록의 연결 — 에이와 | custom-gate | redirect-when-no-data | src/app/(shell)/student-contribution/ontology/page.tsx |
| /student-contribution/referrals | screen | student-contribution | 지난 소개 확인 — 에이와 | custom-gate | getContributionGate | src/app/(shell)/student-contribution/referrals/page.tsx |
| /student-contribution/settings | screen | student-contribution | 기여도 배점 설정 — 에이와 | verified-in-loader | src/features/student-contribution/components/settings-view.tsx:6 — gate.canConfigure 아니면 redirect | src/app/(shell)/student-contribution/settings/page.tsx |
| /students | screen | students | ${sheetT(await getTeacherViewLang(), "stu.title")}${PAGE_TITLE_SUFFIX} | menu-gate | requireAccess:students isModuleEnabled requireAccess | src/app/(shell)/students/page.tsx |
| /students/[id] | detail | students | 학생 상세 — 에이와 | menu-gate | requireAccess:students canAccessTenant canManageStudentStatusNow canManageTenant canSeeStudentEnrollment canWriteTenant getContributionGate getEnrollmentDateAccess getJjAccess isCurrentUserSuperAdmin notFound requireAccess | src/app/(shell)/students/[id]/page.tsx |
| /students/[id]/edit | form | students | 학생 수정 — 에이와 | menu-gate | requireAccess:students canManageStudentStatusNow isModuleEnabled notFound redirect-when-no-data requireAccess | src/app/(shell)/students/[id]/edit/page.tsx |
| /students/new | form | students | 학생 등록 — 에이와 | menu-gate | requireAccess:students canManageStudentStatusNow isModuleEnabled requireAccess | src/app/(shell)/students/new/page.tsx |
| /students/stats | stats | students | 원생 통계 — 에이와 | menu-gate | requireAccess:students requireAccess | src/app/(shell)/students/stats/page.tsx |
| /super-admin | platform | platform-console | 슈퍼관리자 · 대시보드 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/page.tsx |
| /super-admin/audit | platform | platform-console | 슈퍼관리자 · 감사 로그 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/audit/page.tsx |
| /super-admin/laboratory | platform | platform-console | 슈퍼관리자 · 실험실 메뉴 — 에이와 | menu-gate | requireSuperAdmin requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/laboratory/page.tsx |
| /super-admin/support | platform | support | 슈퍼관리자 · 고객센터 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/support/page.tsx |
| /super-admin/support/[id] | platform | support | 슈퍼관리자 · 개선요청 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx notFound redirect-when-no-data | src/app/(super-admin)/super-admin/support/[id]/page.tsx |
| /super-admin/support/notices | platform | support | 슈퍼관리자 · 공지사항 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/support/notices/page.tsx |
| /super-admin/support/notices/[id] | platform | support | 슈퍼관리자 · 공지 수정 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx notFound redirect-when-no-data | src/app/(super-admin)/super-admin/support/notices/[id]/page.tsx |
| /super-admin/support/notices/new | platform | support | 슈퍼관리자 · 새 공지 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/support/notices/new/page.tsx |
| /super-admin/tenants | platform | platform-console | 슈퍼관리자 · 전 지점 운영 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/tenants/page.tsx |
| /super-admin/tenants/[id] | platform | platform-console | 슈퍼관리자 · 학원 상세 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx notFound redirect-when-no-data | src/app/(super-admin)/super-admin/tenants/[id]/page.tsx |
| /super-admin/tenants/[id]/view | platform | platform-console | 슈퍼관리자 · 지점장 보기 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx notFound redirect-when-no-data | src/app/(super-admin)/super-admin/tenants/[id]/view/page.tsx |
| /super-admin/tenants/new | platform | platform-console | 슈퍼관리자 · 신규 학원 발급 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/tenants/new/page.tsx |
| /super-admin/usage | platform | platform-console | 슈퍼관리자 · 이용 분석 — 에이와 | layout-gate | requireSuperAdmin@src/app/(super-admin)/layout.tsx | src/app/(super-admin)/super-admin/usage/page.tsx |
| /support | screen | support | 고객센터${TITLE_SUFFIX[tab]} — 에이와 | menu-gate | requireAccess:support canWriteSupportRequest requireAccess | src/app/(shell)/support/page.tsx |
| /support/notices/[id] | detail | support | 고객센터 · 공지사항 — 에이와 | menu-gate | requireAccess:support notFound redirect-when-no-data requireAccess | src/app/(shell)/support/notices/[id]/page.tsx |
| /support/requests/[id] | detail | support | 고객센터 · 개선요청 — 에이와 | menu-gate | requireAccess:support canAuthorEditRequest canWriteSupportRequest notFound redirect-when-no-data requireAccess | src/app/(shell)/support/requests/[id]/page.tsx |
| /support/requests/new | form | support | 고객센터 · 개선요청 글쓰기 — 에이와 | menu-gate | requireAccess:support canWriteSupportRequest requireAccess | src/app/(shell)/support/requests/new/page.tsx |
| /tenant-view/unconfirmed | auth | auth-session | 읽기 전용 보기 | public-by-design | — | src/app/tenant-view/unconfirmed/page.tsx |
| /textbook-requests | screen | textbook-requests | — | menu-gate | requireAccess:textbook_requests requireAccess | src/app/(shell)/textbook-requests/page.tsx |
| /textbook/[id]/print | print | textbook-requests | 교재 요청서 — 에이와 | menu-gate | requireAccess:textbook_requests notFound redirect-when-no-data requireAccess | src/app/(print)/textbook/[id]/print/page.tsx |
| /textbooks | screen | textbooks | 교재목록${TITLE_SUFFIX[tab]} — 에이와 | menu-gate | requireAccess:textbooks canManageTenant canWriteTenant requireAccess | src/app/(shell)/textbooks/page.tsx |
| /timetable | screen | timetable | 시간표 — 에이와 | menu-gate | requireAccess:timetable canAccessTenant canManageSheetSync canManageStudentStatusNow canManageTenant canManageTimetableImport canSplitClassNow canUseTimetableEditor canWriteTenant isModuleEnabled memoSheetAccess requireAccess | src/app/(shell)/timetable/page.tsx |
| /timetable/editor | screen | timetable | — | menu-gate | requireAccess:timetable canUseTimetableEditor requireAccess | src/app/(shell)/timetable/editor/page.tsx |
| /timetable/english-sheet | screen | timetable | — | custom-gate | canManageSheetSync canManageTimetableImport redirect-when-no-data session | src/app/(shell)/timetable/english-sheet/page.tsx |
| /v | public-share | video-homework | 숙제 영상 올리기 | custom-gate | notFound | src/app/(share)/v/page.tsx |
| /v/[token] | public-share | video-homework | 숙제 영상 제출 | custom-gate | notFound | src/app/(share)/v/[token]/page.tsx |
| /withdrawal-reports | screen | withdrawal-reports | 퇴원보고서 — 에이와 | menu-gate | requireAccess:withdrawal_reports canManageStudentStatusNow notFound redirect-when-no-data requireAccess | src/app/(shell)/withdrawal-reports/page.tsx |
| /withdrawal-reports/[id] | detail | withdrawal-reports | 퇴원보고서 — 에이와 | menu-gate | requireAccess:withdrawal_reports notFound requireAccess | src/app/(shell)/withdrawal-reports/[id]/page.tsx |
| /withdrawal-reports/archive | screen | withdrawal-reports | — | menu-gate | requireAccess:withdrawal_reports notFound requireAccess | src/app/(shell)/withdrawal-reports/archive/page.tsx |
| /withdrawal-reports/archive/[id] | detail | withdrawal-reports | — | menu-gate | requireAccess:withdrawal_reports notFound redirect-when-no-data requireAccess | src/app/(shell)/withdrawal-reports/archive/[id]/page.tsx |
| /withdrawals | screen | withdrawals | 퇴원관리 — 에이와 | menu-gate | requireAccess:withdrawals isModuleEnabled requireAccess | src/app/(shell)/withdrawals/page.tsx |
| /withdrawals/[studentId] | detail | withdrawals | 퇴원 상세 — 에이와 | menu-gate | requireAccess:withdrawals canEditEnrollmentDateClass canManageStudentStatusNow canWriteTenant getEnrollmentDateAccess notFound redirect-when-no-data requireAccess | src/app/(shell)/withdrawals/[studentId]/page.tsx |

## 8. API·크론 전수표

| URL | 클래스 | 패밀리 | 메서드 | vercel 일정 | 인증 단서 |
| --- | --- | --- | --- | --- | --- |
| /api/attendance/checkin | public-submit | attendance | POST | — | — |
| /api/calendar/google-push | webhook | calendar | POST | — | — |
| /api/classnote/reply-videos | client-fetch | video-homework | GET | — | getCurrentUser |
| /api/connected-apps/todays-math/authorize | integration | integrations | GET | — | getCurrentUser |
| /api/connected-apps/todays-math/launch | integration | integrations | GET | — | getCurrentUser |
| /api/cron/apply-due-class-updates | cron | classes | GET | 30 15 * * * | CRON_SECRET |
| /api/cron/apply-due-withdrawals | cron | withdrawals | GET | 5 15 * * * | CRON_SECRET |
| /api/cron/apply-timetable-lab | cron | timetable | GET | 0 * * * * | CRON_SECRET |
| /api/cron/close-ended-class-periods | cron | classes | GET | 35 15 * * * | CRON_SECRET |
| /api/cron/daily-briefing | cron | dashboard | GET | — | CRON_SECRET |
| /api/cron/demo-refresh | cron | demo-tenant | GET | 5 21 * * * | CRON_SECRET |
| /api/cron/google-calendar-import | cron | calendar | GET | 0 19 * * * | CRON_SECRET |
| /api/cron/ijw-memorized-words | cron | integrations | GET | 20 19 * * * | CRON_SECRET |
| /api/cron/ijw-profile-sync | cron | integrations | GET | 30 19 * * * | CRON_SECRET |
| /api/cron/ment-style-rebuild | cron | onescreen | GET | 0 11 * * 0 | CRON_SECRET |
| /api/cron/notification-maintenance | cron | tasks-notifications | GET | 0 22 * * * | CRON_SECRET |
| /api/cron/reconcile-transcriptions | cron | recording-transcription | GET | 0 18 * * * | CRON_SECRET |
| /api/cron/recordings-retention | cron | recording-transcription | GET | 0 17 * * * | CRON_SECRET |
| /api/cron/report-ratings | cron | lesson-reports | GET | */30 * * * * | CRON_SECRET |
| /api/cron/sheets-sync | cron | integrations | GET | 0 19 * * * | CRON_SECRET |
| /api/cron/slack-dispatch | cron | slack | GET | * * * * * | CRON_SECRET |
| /api/cron/staff-tasks | cron | tasks-notifications | GET | */30 * * * * | CRON_SECRET |
| /api/cron/student-contribution | cron | student-contribution | GET | 40 15 * * * | CRON_SECRET |
| /api/cron/student-daily-stats | cron | students | GET | 55 14 * * * | CRON_SECRET |
| /api/cron/teacher-portfolio | cron | class-review | GET | 10 15 * * * | CRON_SECRET |
| /api/cron/todays-math-results | cron | integrations | GET | 7 * * * * | CRON_SECRET |
| /api/cron/todays-math-sync | cron | integrations | GET,POST | * * * * * | CRON_SECRET |
| /api/cron/video-homework | cron | video-homework | GET | */30 * * * * | CRON_SECRET |
| /api/cron/video-review | cron | video-homework | GET | */10 * * * * | CRON_SECRET |
| /api/documents/[id]/file | client-fetch | documents | GET | — | — |
| /api/enrollment/prior-consults | client-fetch | enrollment | GET | — | getCurrentUser,requireAccess |
| /api/exams/excel | export | exams | GET | — | requireAccess |
| /api/exams/unified-export | export | exams | GET | — | requireAccess |
| /api/excel-import/[kind] | export | owner-settings | GET,POST | — | — |
| /api/exports/billing | export | billing | GET | — | requireAccess |
| /api/exports/classes | export | classes | GET | — | requireAccess |
| /api/exports/consultations | export | consultations | GET | — | — |
| /api/exports/expenses | export | billing | GET | — | requireAccess |
| /api/exports/session-terms | export | billing | GET | — | requireAccess |
| /api/exports/students | export | students | GET | — | requireAccess |
| /api/exports/timetable | export | timetable | GET | — | requireAccess |
| /api/homework-videos/[id]/review | client-fetch | video-homework | GET | — | — |
| /api/homework-videos/[id]/stream | client-fetch | video-homework | GET | — | — |
| /api/integrations/homework-video-drive/callback | integration | video-homework | GET | — | getCurrentUser |
| /api/integrations/homework-video-drive/done | integration | video-homework | GET | — | — |
| /api/integrations/homework-video-drive/start | integration | video-homework | POST | — | getCurrentUser |
| /api/integrations/todays-math/progress | integration | integrations | GET | — | — |
| /api/integrations/todays-math/roster | integration | integrations | GET | — | — |
| /api/integrations/todays-math/v2/control | integration | integrations | POST | — | — |
| /api/integrations/todays-math/v2/menus-changed | integration | integrations | POST | — | — |
| /api/integrations/todays-math/v2/results-wake | integration | integrations | POST | — | — |
| /api/integrations/todays-math/v2/snapshots | integration | integrations | POST | — | — |
| /api/integrations/todays-math/v2/snapshots/[snapshotId] | integration | integrations | GET | — | — |
| /api/integrations/todays-math/v2/token | integration | integrations | POST | — | — |
| /api/internal/class-notice-attachments/[noticeId] | worker-internal | lesson-reports | GET | — | — |
| /api/internal/notice-attachments/[noticeId] | worker-internal | lesson-reports | GET | — | — |
| /api/internal/parent-messages/classify | worker-internal | lesson-reports | POST | — | — |
| /api/internal/parent-messages/jev-shadow | worker-internal | lesson-reports | POST | — | — |
| /api/internal/report-attachments/[reportId] | worker-internal | lesson-reports | GET | — | — |
| /api/internal/video-drive-token | worker-internal | video-homework | POST | — | — |
| /api/internal/video-review/upload | worker-internal | video-homework | POST | — | — |
| /api/internal/video-submit-link | worker-internal | video-homework | POST | — | — |
| /api/inventory/excel | export | inventory | GET | — | requireAccess |
| /api/inventory/qr/[code] | client-fetch | inventory | GET | — | requireAccess |
| /api/notice-popups | client-fetch | owner-settings | GET | — | getCurrentUser |
| /api/notifications | client-fetch | tasks-notifications | GET | — | getCurrentUser |
| /api/push | client-fetch | tasks-notifications | DELETE,GET,POST | — | getCurrentUser |
| /api/search/palette | client-fetch | shell-infrastructure | GET | — | getCurrentUser |
| /api/staff-tasks | client-fetch | tasks-notifications | GET | — | — |
| /api/staff-tasks/[id] | client-fetch | tasks-notifications | GET | — | — |
| /api/students/[id]/summary | client-fetch | students | GET | — | requireAccess |
| /api/sync-agent/[action] | worker-internal | integrations | POST | — | — |
| /api/sync-agent/latest | worker-internal | integrations | POST | — | — |
| /api/sync-agent/operation | worker-internal | integrations | POST | — | — |
| /api/sync-agent/pair | worker-internal | integrations | POST | — | — |
| /api/sync-agent/query | worker-internal | integrations | POST | — | — |
| /api/timetable/cell-memos | client-fetch | timetable | GET | — | getCurrentUser |
| /api/timetable/end-scope | client-fetch | timetable | GET | — | getCurrentUser |
| /api/timetable/lab/drafts | client-fetch | timetable | GET,POST | — | — |
| /api/timetable/lab/drafts/[id] | client-fetch | timetable | GET | — | — |
| /api/timetable/lab/source | client-fetch | timetable | GET | — | getCurrentUser |
| /api/timetable/student-busy | client-fetch | timetable | GET | — | getCurrentUser |
| /api/usage | client-fetch | shell-infrastructure | POST | — | getCurrentUser |
| /api/video-submit/complete | public-submit | video-homework | POST | — | — |
| /api/video-submit/event | public-submit | video-homework | POST | — | — |
| /api/video-submit/site | public-submit | video-homework | POST | — | — |
| /api/video-submit/start | public-submit | video-homework | POST | — | — |
| /api/webhooks/assemblyai | webhook | recording-transcription | POST | — | webhook |
| /home | auth-redirect | auth-session | GET | — | getCurrentSuperAdmin,getCurrentUser,requireAccess |
| /tenant-view/exit | auth-redirect | auth-session | GET | — | — |
| /tenant-view/sync | auth-redirect | auth-session | GET | — | — |
| /view-reset | auth-redirect | auth-session | GET | — | — |

일정 없는 크론 핸들러: `/api/cron/daily-briefing`.

## 9. 내비·탭 소스 추적

| 소스 파일 | 항목 | 해석 | 패밀리 |
| --- | --- | --- | --- |
| src/lib/navigation.ts | 55 | literal 53 · derived 2 | billing, attendance, class-sheets, shuttle, staff, help, dashboard, calendar, onescreen, timetable, classes, makeups, textbooks, lesson-reports, students, student-contribution, exams, consultations, enrollment, retention, newcomers, withdrawals, withdrawal-reports, inventory, textbook-requests, expense-requests, meetings, class-review, approvals, documents, support, owner-settings |
| src/lib/menu-hub.ts | 50 | derived 4 · menuKey 26 · literal 19 · constant 1 | dashboard, timetable, class-sheets, attendance, makeups, classes, textbooks, lesson-reports, class-review, onescreen, students, student-contribution, exams, consultations, enrollment, newcomers, retention, withdrawals, withdrawal-reports, billing, staff, shuttle, inventory, meetings, approvals, documents, support, help |
| src/features/owner/tabs.ts | 18 | literal 18 | owner-settings |
| src/lib/teacher-menu-links.ts | 19 | literal 19 | attendance, onescreen, video-homework, class-sheets, students, makeups, classes, timetable, exams, consultations, textbook-requests, expense-requests, calendar, approvals, class-review, withdrawal-reports, documents |
| src/components/super-admin/nav.ts | 6 | literal 6 | platform-console, support |
| src/features/class-review/faces.ts | 2 | constant 2 | class-review |
| src/features/inventory/faces.ts | 6 | constant 5 · derived 1 | inventory |
| src/features/report-admin/lesson-report-faces.ts | 12 | literal 12 | lesson-reports, video-homework |
| src/features/shuttle/faces.ts | 1 | derived 1 | (파생) |
| src/features/support/faces.ts | 3 | constant 2 · derived 1 | support |
| src/features/textbooks/faces.ts | 2 | constant 2 | textbooks |
| src/app/(shell)/approvals/page.tsx | 8 | in-page 8 | approvals |
| src/app/(shell)/billing/page.tsx | 7 | literal 7 | billing |
| src/app/(shell)/billing/_components/calculator-panel.tsx | 5 | literal 5 | billing |
| src/app/(shell)/billing/_components/textbooks-face.tsx | 2 | literal 2 | billing |
| src/app/(shell)/exams/_components/cohorts-tab.tsx | 5 | in-page 5 | exams |
| src/app/(shell)/owner/_components/integrations-face.tsx | 7 | derived 1 · expanded 6 | owner-settings |
| src/app/(shell)/shuttle/parents/page.tsx | 1 | constant 1 | shuttle |
| src/app/(shell)/shuttle/track/_components/track-client.tsx | 1 | in-page 1 | shuttle |
| src/app/(shell)/shuttle/_components/shuttle-board-client.tsx | 3 | in-page 3 | shuttle |
| src/app/(shell)/students/[id]/_components/tabs-nav.tsx | 14 | in-page 14 | students |
| src/features/retention/components/retention-tabs.tsx | 4 | literal 4 | retention |

해석: literal = 문자열 주소 · constant = 경로 상수(CLASS_REVIEW_PATH, INVENTORY_PATH, SUPPORT_PATH, TEXTBOOKS_PATH, SHUTTLE_PARENTS_PATH) · menuKey = fromMenu()가 NAV_GROUPS 정의를 끌어옴 · in-page = 주소 없는 화면 안 탭/필터 · derived = 다른 목록을 그대로 비추는 항목(원본이 따로 잡힘) · expanded = 파생 항목을 펼친 값.

파생 항목의 원본:
- `src/lib/navigation.ts:140` `{t.href}` — SUBTABS_BY_MENU.owner = OWNER_TABS.map(...) — 원본은 src/features/owner/tabs.ts
- `src/lib/navigation.ts:422` `{item.href}` — fromMenu()가 NAV_GROUPS 항목을 그대로 복사 — 원본은 src/lib/navigation.ts
- `src/lib/menu-hub.ts:85` `{item.href}` — fromMenu()가 NAV_GROUPS 항목을 그대로 복사 — 원본은 src/lib/navigation.ts
- `src/lib/menu-hub.ts:104` `{tab.href}` — billingFace()가 SUBTABS_BY_MENU.billing을 찾아 쓴다 — 원본은 src/lib/navigation.ts
- `src/lib/menu-hub.ts:321` `{f.href}` — 면 정의 배열을 건수 라벨로 다시 매핑 — 원본은 같은 파일의 *_FACE_DEFS
- `src/lib/menu-hub.ts:477` `{k}` — 자주 방문한 메뉴(frequentFor) — 방문 기록의 메뉴 키를 NAV_GROUPS로 되돌린다(원본은 src/lib/navigation.ts)
- `src/features/inventory/faces.ts:48` `{f.href}` — 면 정의 배열을 건수 라벨로 다시 매핑 — 원본은 같은 파일의 *_FACE_DEFS
- `src/features/shuttle/faces.ts:36` `${tab.href}?season=${season}` — billingFace()가 SUBTABS_BY_MENU.billing을 찾아 쓴다 — 원본은 src/lib/navigation.ts
- `src/features/support/faces.ts:23` `{f.href}` — 면 정의 배열을 건수 라벨로 다시 매핑 — 원본은 같은 파일의 *_FACE_DEFS
- `src/app/(shell)/owner/_components/integrations-face.tsx:71` `/owner?tab=sheets&sub=${key}` — 연동 하위 면 6개(LABEL: slack·makeedu·sheets·video·agent·todaysMath) — integrations-face.tsx:28

## 10. 화면 안 카탈로그(설정 하위 패널·위젯·알림·할 일)

- 학원 설정 면 18개(OWNER_FACES, 기능 면은 일반판 전용) + 연동 하위 6개 + 설정 카드 43개:
  - `billing-section.tsx`: 공통 회당 단가 · EiE 월 수강료 · 청구 기본값 · 입금 계좌
  - `classroom-manager.tsx`: 강의실
  - `consultations-section.tsx`: 상담 양식
  - `evaluation-editor.tsx`: 강사평가 기준
  - `preset-bar.tsx`: 구성 저장·불러오기
  - `makeups-section.tsx`: 보강관리 운영
  - `modules-section.tsx`: 기능 켜기·끄기
  - `notifications-section.tsx`: 알림 · 인쇄물 · 공개 접수 약관
  - `operations-section.tsx`: 평일 교시 (기본값) · 주말 교시 · 학년 체계 · 직급 (공통) · 부서별 직급 · 공휴일·휴원일 · 셔틀버스 · 자리 출석부 비밀번호
  - `permissions-section.tsx`: 역할별 메뉴 권한 · 설정별 역할 권한
  - `profile-section.tsx`: 학원 정보 · 브랜드
  - `report-section.tsx`: 머리글 · 바닥글 · 표시 항목 · 테스트 문항수 · AI 멘트 공지 모드 · 작성률 예외 강사 · 발송 보류 예외 (동명이인 확인 완료)
  - `special-access-editor.tsx`: 개인별 기능 권한
  - `subjects-section.tsx`: 요일 병합 묶음 · 과목 운영
  - `teacher-menu-toggles.tsx`: 강사 ‘내 메뉴’ 표시
  - `todays-math-card.tsx`: 원스크린 시험 칸 채우기 · 성적관리 월말평가 채우기 · 월말평가 성적표 보고서 첨부 · 오늘 수학 결과 가져오기
  - `todays-math-menus-card.tsx`: 오늘 수학 사용 메뉴
  - `user-override-editor.tsx`: 개인별 메뉴 권한 ${visible.length
  - `video-homework-settings.tsx`: 영상 제출 검사
- 대시보드 위젯 36종: 강사별 업무 현황 · 재원생 구성 · 출결 현황 · 이번 달 수납 현황 · 신규생 단계별 관리 · 등록 · 퇴원 추이 · 등록 후 3개월 내 퇴원 · 6개월 청구 · 수납 · 재원생 추이 · 강좌수 추이 · 과목별 수강 · 학년별 재원생 · 학교별 학생 · 신규 콜&상담 전환 · 반복 결석 학생 · 최근 14일 등원율 · 상담 진행 · 학습 · 학부모 보고 · 학생 상담 · 신규생 체크 진행 · 강사 시트 작성 현황 · 현재 수업 현황 · 레벨테스트 및 첫수업 일정 · 직원 구성 · 행정 · 자산 · 이번 달 지출 내역 · 학원 공지 · 재원생 · 강좌수 · 퇴원&수업종료 · 신규문의 · 전일 입테 · 전일 / 이달 신규 · 오늘첫수업 · 최근 결석 · 보강예정
- 할 일 종류 11종: 보고서 발송 실패(`report_send_failed`) · 상담 후속조치(`followup_due`) · 콜&상담 후속 조치(`enrollment_followup`) · 진도 기록 이상(`progress_anomaly`) · 결석 확인 전화(`attendance_absent_desk`) · 영상 업로드 확인(`video_upload_check`) · 미배정 영상(`video_unassigned`) · 미발송 수업 보고서(`unsent_report`) · 전자결재 차례(`approval_turn`) · 퇴원보고서(`withdrawal_step`) · 도움말 질문(`help_question`)
- 알림 유형 전체(NotificationType 유니언, src/features/notifications/types.ts) 39종 — 슬랙 전달 목록에 없는 것: `daily_briefing`
- 알림 유형(슬랙 전달 가능) 38종: 내 반에 학생 배정(`enrollment_assigned`) · 반이동 전입(`enrollment_transferred_in`) · 담임 인수인계(`teacher_handover`) · 결근 대체 위임(`class_delegation`) · 반 출석 입력 완료(`attendance_complete`) · 강사 결석 입력(데스크 확인)(`attendance_absent_desk`) · 출결 입력 요청(`attendance_input_request`) · 데스크 확인 요청(`attendance_desk_confirm_request`) · 미출결 → 출석 전환(`attendance_unmarked_to_present`) · 결석 사전 접수(`attendance_absence_intake`) · 학부모 결석·지각 연락(`student_attendance_notice`) · 반복 결석(`absence_alert`) · 상담 후속조치 기한(`followup_due`) · 콜&상담 후속 조치(다음 상담)(`enrollment_followup`) · 늦은 할 일 요약(매일 아침)(`staff_task_digest`) · 성적 급락(`grade_drop`) · 미납 누적(`outstanding_alert`) · 미발송 수업 보고서(`unsent_report`) · 진도 기록 이상(`progress_anomaly`) · 퇴원보고서 없이 퇴원(`withdrawal_bypass`) · 학부모 ClassNote 글(`classnote_parent_post`) · 학부모 ClassNote 댓글(`classnote_parent_comment`) · 제출 링크로 숙제 영상 올림(`homework_video_link`) · 영상 숙제 제출됨(`video_homework_submitted`) · 영상 숙제 미제출(마감 지남)(`video_homework_missing`) · 숙제에 연결 안 된 영상(`video_homework_unassigned`) · 숙제 영상 업로드 확인 필요(`homework_video_upload_failed`) · 월말평가 성적표 첨부 못 함(오늘 수학)(`todays_math_exam_report`) · 보고서 발송 실패(`report_send_failed`) · 학부모 공지 게시 실패(`notice_send_failed`) · 결재 요청(`approval_requested`) · 결재 완료(`approval_decided`) · 결재 댓글(`approval_comment`) · 도움말 질문(`help_question`) · 도움말 답변(`help_answer`) · makeedu 로그인 실패(`makeedu_login_failed`) · 개선요청 답변(`support_answer`) · 슬랙 발송 멈춤(`slack_broken`)
- 슬랙 활동 범주 12 · 프리셋 4: 원생·수강 · 신규 콜&상담·학생상담 · 출결·보강·자리 · 청구·수납·지출 · 급여 · 반·시간표·강의실 · 보고서·학부모 발송 · 강사 시트·교재·성적 · 직원·결재·연차 · 일정·공지·회의·도움말 · 셔틀·재고 · 설정·연동 / 원장 활동 피드(원생·상담·수납) · 데스크 출결 알림 · 결재는 결재자 본인에게 · 하루 요약: 결석·성적·미납·발송 실패
- 원생 상세 탭 13개: 개요 · 수업 · 성적 · SRS · 오늘 수학 · 진도 · 숙제 영상 · 출결 · 상담 · 특이사항 · 수납 · 기여도 · 타임라인
- 학부모 탭: 실시간 차량 · 등하원 시간 변경·확인 · 수업 시간표 (+ 빈 슬롯 2)
- DB 트리거로 알림·할 일을 넣는 마이그레이션 9개: 0143a_notify_report_send_failed.sql, 0144a_notify_notice_send_failed.sql, 0153a_test_student_flag_notify_skip.sql, 0306a_trigger_tenant_guards.sql, 0377a_staff_tasks.sql, 0378a_staff_tasks_p4a.sql, 0425a_video_homework_due.sql, 0447a_unassigned_video_fillable_and_notification_cleanup.sql, 0454a_withdrawal_bypass_warning.sql

## 11. DB 엔티티 연결과 불확실성

- 복사본 337개 테이블(public 271) 중 패밀리 코드가 읽거나 쓰는 public 테이블 210개, 앱 코드에서 `.from()`으로 참조하지 않는 public 테이블 60개(RPC·트리거·뷰 전용이거나 미사용 — 판정은 하지 않았다).
- 시안 스냅샷 입력 46개 테이블: academy_documents, approval_documents, approval_steps, attendance_checkins, attendance_records, calendar_events, class_schedules, classes, classnote_parent_messages, classnote_parent_replies, classrooms, enrollment_consultations, enrollments, expenses, inventory_assets, inventory_supplies, invoices, lesson_reports, makeup_cases, makeup_reservations, payroll_records, payslips, progress_entries, shuttle_boardings, shuttle_riders, shuttle_run_stops, shuttle_runs, shuttle_stops, shuttle_vehicles, staff_attendance_days, staff_contracts, staff_task_assignees, staff_tasks, student_consultations, student_daily_stats, student_grades, student_history_monthly, student_homework_videos, student_memos, student_onboarding_checks, student_positive_signals, students, textbook_orders, users, withdrawal_report_archives, withdrawal_reports.
- 코드가 참조하는 이름 중 복사본 테이블에 없는 것 2개: homework_video_ledger_videos, shuttle_vehicle_positions.
- 앱 코드 미참조 public 테이블: assistant_conversations(9), attendance_salary_teacher_view(6), attendance_seat_share_adjust(3), calendar_sync_state(6), classnote_feed_state(3), classnote_video_files(532), edutrix_archive(29317), exams(0), homework_video_assignment_history(79), homework_video_assignments(72), homework_video_drive_account_owners(0), homework_video_drive_oauth_attempts(0), homework_video_site_attempts(84), lesson_report_rating_queue(103), lesson_report_send_events(20623), makeedu_push_batches(9), makeup_adjustments(0), makeup_allocations(0), makeup_case_sources(0), makeup_cases(0), makeup_commands(4), makeup_events(4), makeup_fulfillments(0), makeup_legacy_maps(0), makeup_participants(0), makeup_policy_versions(0), makeup_projection_jobs(0), makeup_recognitions(0), makeup_reconciliation(0), makeup_reconciliation_runs(0), makeup_sessions(0), migration_data_marks(1), page_usage_daily(3335), student_contribution_settings(1), student_ontology_summaries(452), student_ontology_summary_daily_usage(1), student_parent_event_revisions(36), student_parent_events(14), student_positive_signals(1000), sync_agent_attempts(1), sync_agent_codes(1), sync_agent_devices(1), sync_agent_events(2974), sync_agent_management_codes(1), sync_agent_module_sessions(2), sync_agent_releases(8), sync_agent_schedule_runs(58), sync_agent_settings(1), teacher_evaluation_entries(0), teacher_evaluation_presets(0), teacher_evaluation_settings(0), teacher_satisfaction_claims(0), teacher_satisfaction_judgments(996), timetable_cell_memos(0), timetable_lab_apply_jobs(1), video_homework_automation_config(1), video_homework_rejections(0), withdrawal_report_archive_mappings(13), withdrawal_report_sources(26), worker_execution_leases(0)

불확실성 — 패밀리 기록:
- `dashboard` daily-briefing 크론 핸들러는 있으나 vercel.json 일정이 없다 — 의도적 중지인지 미확인
- `calendar` CLAUDE.md 결정 로그는 구글 → aywa 전체 동기화를 "하루 2회 안전망"이라 적지만 vercel.json에는 google-calendar-import 일정이 하루 1회뿐 — 다른 트리거가 있는지 미확인
- `tasks-notifications` AX "요청한 업무"(원장→담당자 지시·완료 보고)를 저장할 2.0 테이블이 없다 — staff/notion 연동 할 일(createStaffTask)이 가장 가까우나 Notion 매핑 전용
- `timetable` /timetable/editor 머리 주석은 "운영 반영 경로 없음"이라 적었지만 queueTimetableLabApply와 매시 apply-timetable-lab 크론이 존재 — 주석이 낡았는지 확인 필요
- `timetable` /timetable/english-sheet 는 침산 tenant id를 코드에 직접 적는다(page.tsx)
- `expense-requests` /expense-requests 페이지에서 도달하는 작성 액션이 deleteExpense뿐 — 작성 경로(전자결재 submitExpenseDraft 또는 billing 컴포넌트) 확인 필요

원문을 읽어 해소한 것:
- `class-sheets` /ecs/[classId]/month · /mcs/[classId]/month · /ecs/[classId]/month-plan/print 의 게이트는 조회 함수 안(requireEcsClassAccess · requireMcsClassAccess · getMonthPlanPrint) — 원문 확인
- `attendance` /attendance/units-master 게이트 = loadUnitsMaster 안 requireAccess("attendance")(units-master.ts:39), 입구 = 월별 출석부의 UnitsMasterButton(canViewUnitsMaster) — 원문 확인
- `student-contribution` /student-contribution 하위 페이지는 기능 모듈 뷰를 재-export하고 뷰가 게이트를 건다(settings-view.tsx:6 gate.canConfigure, referral-view getContributionGate, list/ontology 데이터 없음 → redirect) — 원문 확인
- `approvals` 기안 화면 머리 주석(approvals/new/page.tsx:18)의 "업무연락"은 낡았다 — 원장 확정 양식은 types.ts:11의 휴가·품의·지출·수입 4종

불확실성 — 자동 감지(원문 확인 전):
- `src/features/english-assessment` (shell-infrastructure) — src 전체에서 모듈 밖 import가 0건(테스트 제외) — 사용처 없는 모듈일 수 있다

메모:
- 크론 핸들러 /api/cron/daily-briefing는 vercel.json 일정이 없다(수동/중지)
- 코드가 .from("homework_video_ledger_videos")로 읽지만 복사본 public 스키마에 없는 이름(뷰·다른 스키마·오래된 코드 가능)
- 코드가 .from("shuttle_vehicle_positions")로 읽지만 복사본 public 스키마에 없는 이름(뷰·다른 스키마·오래된 코드 가능)

## 12. 검증

```
node experiments/owner-concept/catalog/scan-source.mjs        # 소스 스캔(읽기 전용)
node experiments/owner-concept/catalog/db-availability.mjs    # 로컬 복사본 행 수(읽기 전용 트랜잭션)
node experiments/owner-concept/catalog/build-inventory.mjs    # 인벤토리·이 문서 생성(문제 1건이라도 있으면 실패)
node experiments/owner-concept/catalog/verify-catalog.mjs     # 소스 ↔ 인벤토리 집합 대조 + 문서 해시
```

검증기가 실패하는 조건: 새 페이지·API·크론·모듈·액션 파일·메뉴 키·내비 항목이 인벤토리에 없거나, 인벤토리에만 있는 낡은 항목이 있거나, 핵심 동작의 함수가 사라졌거나, 시안 화면·AX 화면이 어느 패밀리와도 이어지지 않았거나, 이 문서가 인벤토리와 다른 해시를 들고 있을 때. 결과는 `coverage-report.json`.

## 13. 다음 구현 권고

1. **요청 저장소부터** — AX "요청한 업무"(원장 → 담당자, 기한·우선순위·알림 채널, 확인·완료 보고)를 저장할 테이블이 2.0에 없다. `staff_tasks`는 기록의 사실로 자동 생성·자동 종료되는 할 일이라 사람이 보낸 요청과 섞으면 종료 규칙이 깨진다. 새 테이블(tenant_id + RLS) + 감사로그 + 강사 미니셸 수신함(teacher-workspace)이 한 묶음이다.
2. **P0 이슈 원천을 실제 판정으로 교체** — 시안 이슈 7종은 복사본 집계다. 2.0이 이미 판정하는 원천을 그대로 읽는다: 할 일 11종(`staff_tasks.kind`), 알림 38종(`notifications.type`), 대시보드 위젯 36종의 판정 함수(`src/features/dashboard/*`). 같은 숫자를 두 번 계산하지 않는다(같은 데이터는 같은 원본).
3. **근거 패널 = 2.0 상세 화면 딥링크** — 원생 상세(탭 13), 반 상세, 청구 상세, 상담 상세, 결재 문서, 보고서 발송 큐. 3.0 메뉴를 186개로 늘리지 않고 이슈 → 근거 → 2.0 화면(창)으로 들어간다.
4. **결정 이슈는 실제 경로로** — 결재(`decideDocument`), 퇴원보고서(`changeWithdrawalReport`), 학부모 답글(`requestParentReply`)처럼 원장이 결정하는 동작은 시안의 세션 흉내를 걷고 2.0 서버 액션을 그대로 부른다.
5. **자동화 = 2.0 슬랙 규칙 구조** — 범주 12·프리셋 4·전달 이벤트 38·요약 일정·방해금지. AX 자동화 토글은 새 저장소를 만들지 말고 `slack_rules`/`tenant_settings` 위에 얹는다.
6. **데이터는 있으나 화면이 없는 것부터 채운다** — 신규생 체크(`student_onboarding_checks`), 영상 숙제 장부, 강사 시트 작성 현황, 연동 실패 이력.
7. **P2·P3는 의도적 제외로 명시** — 플랫폼 콘솔·학부모/학생 포털·공개 랜딩·데모·개발 화면은 원장 AX 범위 밖이다(지점 화면에 운영자 설정 노출 금지 규칙).
