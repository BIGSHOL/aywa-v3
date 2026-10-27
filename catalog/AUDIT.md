# 2.0 전체 기능 감사 · 3.0 AX 갭

> 기준 커밋 `2c5be8b7b4d4d8c2a30a33a40656d7cec967a005` · 로컬 복사본 DB 읽기 `2026-10-27T07:54:13.759Z` · 기계 판독본 [`feature-inventory.json`](feature-inventory.json) · 검증기 [`verify-catalog.mjs`](verify-catalog.mjs)
> <!-- inventory-sha256: f66ed58b6e5958caf7f1af1e71326dad593e2c344c5aa3c6775ed810241f11eb -->

## 1. 결론

- **라우트 회계 완료**: 페이지 186개·API 92개(크론 핸들러 24개, vercel 일정 23개)·기능 모듈 80개·서버 액션 파일 252개(export 730개)·권한 메뉴 키 53개·내비/탭 항목 231개가 전부 47개 패밀리에 배정됐다. 검증기의 설명되지 않은 누락은 0건이다.
- 사용자 화면이 아닌 라우트는 클래스로 명시했다: auth 2 · detail 36 · dev 2 · device 2 · form 17 · platform 13 · portal 5 · print 12 · public-share 9 · redirect 10 · screen 72 · stats 6.
- 화면 게이트: custom-gate 24 · layout-gate 14 · menu-gate 128 · public-by-design 14 · session-only 1 · verified-in-loader 5 — 메뉴 게이트가 없는 화면은 레이아웃·재-export 뷰·원문 확인(verifiedGates)으로 판정했고 `none-detected`는 0건이다.
- 핵심 동작 189개는 실제 서버 액션 export 이름(또는 API·페이지)으로 근거를 달았고 검증기가 존재를 확인한다.
- 현재 AX(시안 13 + AX 4)는 **실제 쓰기를 하나도 하지 않는다**. 세션 메모리 흉내 동작 19종(advance-lead, approve, bill-note, calendar-note, close-menu, complete-task, event-note, lead-note, menu, message-draft, new-lead, new-task, reject, reply-draft, report-note, save-name, student-note, student-task, today)과 AX 이슈 7종(수납·상담·출결·결재·업무·교재·경영)이 전부다.
- AX에 전혀 없는 패밀리 16개: 교재목록(커리큘럼·반 배정), 직원 평가·직원 포트폴리오, 신규생 관리(90일 체크리스트), 회의록(녹음·AI 분석), 고객센터(공지·개선요청), 도움말(설명서·질문 게시판), 강사 작업 공간(미니셸·내 정보·뷰 전환), 학생 내 학습, 학부모 포털(셔틀·시간표), 공개 랜딩(제품·학원), 로그인·세션·링크 만료·지점 보기 안내, 운영 콘솔(슈퍼관리자), 외부 연동(makeedu·구글 시트·오늘 수학·IJW), 녹음·전사 파이프라인, 데모 지점 갱신, 개발용 화면.
- 불확실성은 0으로 꾸미지 않았다: 남은 패밀리 기록 8건 + 자동 감지 1건 + 메모 3건(§11). 원문을 읽어 해소한 것 9건은 따로 적었다.
- 검증 수준(원문 검토이며 실행 시험이 아니다): 패밀리 source-read 47 — 패밀리마다 핵심 동작 대표 서버 액션의 본문 머리와 권한·쓰기·감사·외부 호출 줄을 줄 번호로 읽고 근거 앵커를 남겼다(본문 전체 정독이 아닌 곳은 readScope에 적음). API 92개: source-read 92(핸들러 본문 전체를 읽음, 부분 읽기 1건은 §11).
- 근거 앵커는 검증기가 줄 단위로 확인한다(파일·줄·포함 문자열). 실제 실행·외부 연동·원본 DB 접근은 하지 않았다 — 실행이 필요한 질문은 '실행 확인 필요'로 남겼다.
- 원장 표시: 41개 패밀리(핵심 동작 177개) · 감사 전용 6개(인증·운영 콘솔·개발·데모·공용 기반·녹음 파이프라인). 원장 표시 패밀리는 3.0 카탈로그(§13)에서 모든 핵심 동작에 목적지를 가진다.

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

| 패밀리 | 영역 | 원장 표시 | 원장 범위 | 2.0 상태 | 페이지 | API | 핵심 동작 | AX | 쓰기 경로 | 우선 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard` 대시보드(운영실) | 홈 | 표시 | owner | implemented | 3 | 1 | 6 | simulated | reuse-2.0-actions | P0 | source-read |
| `calendar` 캘린더 | 홈 | 표시 | owner | implemented | 1 | 2 | 2 | simulated | reuse-2.0-actions | P2 | source-read |
| `tasks-notifications` 할 일·알림(벨·푸시) | 홈 | 표시 | owner | implemented | 0 | 6 | 2 | simulated | reuse+new-storage | P0 | source-read |
| `slack` 슬랙 연동 | 홈 | 표시 | owner | implemented | 0 | 1 | 4 | simulated | reuse-2.0-actions | P1 | source-read |
| `onescreen` 선생님 원스크린(수업 마감) | 수업 | 표시 | owner-linked | implemented | 1 | 1 | 8 | read-only | reuse-2.0-actions | P0 | source-read |
| `video-homework` 영상 숙제(제출 사이트·장부·AI 검토) | 수업 | 표시 | owner | implemented | 4 | 15 | 5 | read-only | reuse-2.0-actions | P1 | source-read |
| `timetable` 시간표(배치·가져오기·편집기·메모) | 수업 | 표시 | owner | partial | 3 | 8 | 7 | read-only | reuse-2.0-actions | P1 | source-read |
| `class-sheets` 강사 시트(영어 ECS·수학 MCS) | 수업 | 표시 | owner | partial | 10 | 0 | 6 | read-only | read-only | P1 | source-read |
| `attendance` 출석부(월별·오늘·출결 모드·자리·키오스크) | 수업 | 표시 | owner | implemented | 16 | 1 | 9 | read-only | reuse-2.0-actions | P0 | source-read |
| `classes` 수업목록(반·수강·인수인계) | 수업 | 표시 | owner | implemented | 4 | 3 | 6 | read-only | reuse-2.0-actions | P1 | source-read |
| `makeups` 보강관리 | 수업 | 표시 | owner | implemented | 6 | 0 | 3 | read-only | reuse-2.0-actions | P1 | source-read |
| `textbooks` 교재목록(커리큘럼·반 배정) | 수업 | 표시 | owner | implemented | 1 | 0 | 5 | absent | read-only | P2 | source-read |
| `lesson-reports` 수업보고서·ClassNote 발송 | 수업 | 표시 | owner | implemented | 4 | 6 | 7 | simulated | reuse-2.0-actions | P0 | source-read |
| `class-review` 직원 평가·직원 포트폴리오 | 수업 | 표시 | owner | partial | 6 | 1 | 5 | absent | read-only | P2 | source-read |
| `students` 원생목록·원생 상세·원생 통계 | 원생 | 표시 | owner | implemented | 5 | 3 | 7 | simulated | reuse-2.0-actions | P0 | source-read |
| `student-contribution` 원생 기여도(온톨로지·소개) | 원생 | 표시 | owner | implemented | 5 | 1 | 4 | read-only | read-only | P2 | source-read |
| `exams` 성적관리(통합·입력·확인·JJ실) | 원생 | 표시 | owner | implemented | 6 | 2 | 3 | read-only | read-only | P1 | source-read |
| `consultations` 원생상담(재원생 상담·AI 분석) | 원생 | 표시 | owner | implemented | 5 | 1 | 3 | read-only | reuse-2.0-actions | P1 | source-read |
| `enrollment` 신규 콜&상담(QR 접수·브리프·인수인계) | 원생 | 표시 | owner | implemented | 7 | 1 | 6 | simulated | reuse-2.0-actions | P0 | source-read |
| `retention` 이탈 방어 | 원생 | 표시 | owner | implemented | 4 | 0 | 2 | read-only | reuse-2.0-actions | P1 | source-read |
| `newcomers` 신규생 관리(90일 체크리스트) | 원생 | 표시 | owner | implemented | 2 | 0 | 1 | absent | reuse-2.0-actions | P1 | source-read |
| `withdrawals` 퇴원관리 | 원생 | 표시 | owner | implemented | 2 | 1 | 2 | read-only | read-only | P1 | source-read |
| `withdrawal-reports` 퇴원보고서(작성·순차 승인·옛 시트) | 원생 | 표시 | owner | implemented | 4 | 0 | 3 | read-only | reuse-2.0-actions | P1 | source-read |
| `staff` 직원관리(명부·계약·이력서·휴가·연차) | 운영 | 표시 | owner | implemented | 13 | 0 | 8 | read-only | read-only | P1 | source-read |
| `payroll` 급여·명세서·강사 정산 | 운영 | 표시 | owner | implemented | 1 | 0 | 3 | read-only | read-only | P2 | source-read |
| `billing` 수납관리(청구·교재·지출·계산기·회차 확정·환불·정산) | 운영 | 표시 | owner | implemented | 5 | 3 | 8 | simulated | reuse-2.0-actions | P0 | source-read |
| `textbook-requests` 교재 요청(강사) | 운영 | 표시 | owner-linked | implemented | 2 | 0 | 3 | read-only | read-only | P1 | source-read |
| `expense-requests` 지출결의서(강사 제출) | 운영 | 표시 | owner-linked | implemented | 2 | 0 | 1 | read-only | read-only | P2 | source-read |
| `shuttle` 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치) | 운영 | 표시 | owner | partial | 8 | 0 | 7 | read-only | read-only | P2 | source-read |
| `inventory` 재고관리(자산·대여·실사·소모품·업체) | 운영 | 표시 | owner | implemented | 3 | 2 | 6 | read-only | read-only | P2 | source-read |
| `meetings` 회의록(녹음·AI 분석) | 운영 | 표시 | owner | implemented | 4 | 0 | 4 | absent | reuse+new-storage | P2 | source-read |
| `approvals` 전자결재(기안·결재함) | 운영 | 표시 | owner | implemented | 3 | 0 | 4 | simulated | reuse-2.0-actions | P1 | source-read |
| `documents` 데이터베이스(서식·문서 저장소) | 운영 | 표시 | owner | implemented | 3 | 1 | 4 | read-only | read-only | P2 | source-read |
| `support` 고객센터(공지·개선요청) | 지원 | 표시 | owner | implemented | 9 | 0 | 2 | absent | read-only | P2 | source-read |
| `owner-settings` 학원 설정(18면)·관리자 도구 | 지원 | 표시 | owner | implemented | 6 | 2 | 7 | simulated | reuse-2.0-actions | P1 | source-read |
| `help` 도움말(설명서·질문 게시판) | 지원 | 표시 | owner | implemented | 5 | 0 | 1 | absent | read-only | P2 | source-read |
| `teacher-workspace` 강사 작업 공간(미니셸·내 정보·뷰 전환) | 역할 셸 | 표시 | owner-linked | implemented | 1 | 0 | 3 | absent | reuse+new-storage | P1 | source-read |
| `student-portal` 학생 내 학습 | 역할 셸 | 표시 | owner-linked | partial | 2 | 0 | 1 | absent | read-only | P2 | source-read |
| `parent-portal` 학부모 포털(셔틀·시간표) | 역할 셸 | 표시 | owner-linked | partial | 4 | 0 | 3 | absent | read-only | P2 | source-read |
| `public-sites` 공개 랜딩(제품·학원) | 공개 | 표시 | owner-linked | implemented | 2 | 0 | 1 | absent | read-only | P2 | source-read |
| `auth-session` 로그인·세션·링크 만료·지점 보기 안내 | 공개 | 감사 전용 — 로그인·세션·지점 보기 안내 — 화면이 아니라 인증 기반 | audit-only | implemented | 4 | 4 | 1 | absent | n/a | P3 | source-read |
| `platform-console` 운영 콘솔(슈퍼관리자) | 플랫폼 | 감사 전용 — 운영 콘솔 — 지점 화면에 운영자 설정을 노출하지 않는다 | audit-only | implemented | 8 | 0 | 5 | absent | n/a | P3 | source-read |
| `integrations` 외부 연동(makeedu·구글 시트·오늘 수학·IJW) | 연동 | 표시 | owner | implemented | 0 | 20 | 5 | absent | reuse-2.0-actions | P1 | source-read |
| `recording-transcription` 녹음·전사 파이프라인 | 연동 | 감사 전용 — 녹음 전사 파이프라인 — 회의록·원생상담·신규 콜&상담 영역의 처리 상태로 노출 | audit-only | implemented | 0 | 3 | 1 | absent | n/a | P2 | source-read |
| `shell-infrastructure` 공용 기반(검색·동시편집·메뉴 기록·최대화·내보내기·통계·학교명) | 기반 | 감사 전용 — 검색·동시편집·메뉴 기록 등 공용 기반 — AX 검색·명령 입력에 흡수 | audit-only | implemented | 0 | 2 | 3 | simulated | n/a | P1 | source-read |
| `demo-tenant` 데모 지점 갱신 | 기반 | 감사 전용 — 가상 데모 지점 갱신 — 운영 지점의 업무가 아님 | audit-only | implemented | 0 | 1 | 1 | absent | n/a | P3 | source-read |
| `dev-tools` 개발용 화면 | 기반 | 감사 전용 — 개발 환경 전용 하네스 | audit-only | implemented | 2 | 0 | 1 | absent | n/a | P3 | source-read |

범위별 수: owner 34 · owner-linked 7 · audit-only 6.

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
| P2 | 도움말(설명서·질문 게시판) | owner | implemented | absent | read-only | — | — | 0/2 | 0/2 | ui-absent | command — 도움말 문서를 근거로 답하고, 질문 게시판 초안을 작성하는 미리보기 |
| P2 | 재고관리(자산·대여·실사·소모품·업체) | owner | implemented | read-only | read-only | resources | — | 5/5 | 2/5 | ui-partial | evidence — 실사 누락·소모품 부족을 낮은 우선순위 이슈로 |
| P2 | 회의록(녹음·AI 분석) | owner | implemented | absent | reuse+new-storage | — | — | 1/1 | 0/1 | data-available-ui-absent | command — 회의 결정 사항을 요청(담당자·기한)으로 바로 넘기는 명령 |
| P2 | 학부모 포털(셔틀·시간표) | owner-linked | partial | absent | read-only | — | — | 2/5 | 0/5 | data-available-ui-absent | issue — 학부모 변경 요청 확인 대기를 이슈로, 학부모 화면 3개 탭 미리보기 |
| P2 | 급여·명세서·강사 정산 | owner | implemented | read-only | read-only | finance, staff | — | 1/2 | 2/2 | ui-partial | evidence — 원장 전용 근거로만(외부 AI 전송 금지) |
| P2 | 공개 랜딩(제품·학원) | owner-linked | implemented | absent | read-only | — | — | 0/0 | 0/0 | ui-absent | evidence — 학원 공개 페이지(/academy) 미리보기 — 제품 랜딩(/)은 감사 전용 |
| P2 | 녹음·전사 파이프라인 | audit-only | implemented | absent | n/a | — | — | 2/2 | 0/2 | data-available-ui-absent | issue — 전사·분석 실패를 이슈로 |
| P2 | 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치) | owner | partial | read-only | read-only | shuttle | — | 6/6 | 6/6 | ui-partial | evidence — 학부모 변경 요청 미확인·운행 이상을 이슈로 |
| P2 | 원생 기여도(온톨로지·소개) | owner | implemented | read-only | read-only | learning | — | 4/4 | 1/4 | ui-partial | evidence — 원생 근거 패널의 한 탭으로 |
| P2 | 학생 내 학습 | owner-linked | partial | absent | read-only | — | — | 0/0 | 0/0 | ui-absent | evidence — 학생 화면 미리보기 — 2.0이 데모 데이터로 그린다는 사실을 함께 표시 |
| P2 | 고객센터(공지·개선요청) | owner | implemented | absent | read-only | — | — | 1/2 | 0/2 | data-available-ui-absent | request — 개선요청 초안을 작성하는 미리보기와 답변 도착(알림 support_answer)을 알림함에 |
| P2 | 교재목록(커리큘럼·반 배정) | owner | implemented | absent | read-only | — | — | 3/3 | 0/3 | data-available-ui-absent | evidence — 진도 이슈의 근거로만 노출(편집은 2.0 화면) |
| P3 | 로그인·세션·링크 만료·지점 보기 안내 | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | settings — AX도 /home 판정을 그대로 재사용 |
| P3 | 데모 지점 갱신 | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | settings — 제외 |
| P3 | 개발용 화면 | audit-only | implemented | absent | n/a | — | — | 0/0 | 0/0 | ui-absent | settings — 제외 |
| P3 | 운영 콘솔(슈퍼관리자) | audit-only | implemented | absent | n/a | — | — | 3/4 | 0/4 | data-available-ui-absent | settings — 분리 유지 |

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
| billing 수납 | experiments/owner-concept/ax.js:39 | dashboard, billing |
| admissions 상담 | experiments/owner-concept/ax.js:40 | enrollment |
| attendance 출결 | experiments/owner-concept/ax.js:41 | attendance, students |
| approval 결재 | experiments/owner-concept/ax.js:42 | approvals |
| tasks 업무 | experiments/owner-concept/ax.js:43 | tasks-notifications, withdrawal-reports |
| books 교재 | experiments/owner-concept/ax.js:44 | billing, textbook-requests |
| enrollment 경영 | experiments/owner-concept/ax.js:45 | dashboard, students, billing |

## 6. 패밀리 상세

### `dashboard` 대시보드(운영실)

- 2.0: **implemented** — 역할별 배치(학원 설정 > 대시보드 관리) · 위젯 카드 27종 + 상단 KPI 9칸 · 과목 관리자는 과목별 커팅. /dashboard/briefing은 /dashboard로 돌려보내고, daily-briefing 크론 핸들러는 vercel.json에 일정이 없다.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollment_consultations`, `enrollments`, `invoices`, `lesson_reports`, `makeup_reservations`, `shuttle_vehicles`, `student_consultations`, `students`, `textbook_orders`, `users`
- 대상: master, admin, manager, accountant, counselor, viewer · 권한 키: `dashboard` · 검증: source-read (`src/app/(shell)/dashboard/layout.tsx`, `src/app/(shell)/menu/page.tsx`, `src/features/dashboard/layout/registry.ts`, `src/features/dashboard/server/actions.ts`)
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
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `report-note` `ax:filter` `ax:open-issue` `ax:focus-issue` `ax:focus-list` `ax:expand`
  - 빠진 것: 위젯 카탈로그 36종(카드 27 + KPI 9)·역할별 배치·과목 커팅·학원 공지·통계 상세 화면(/students/stats 등)으로의 드릴다운
  - 제안(issue): KPI·위젯의 변화를 이슈로 띄우고 위젯 자체를 근거 카드로 재사용(카드→원본 화면 딥링크)
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 지표 재집계·학원 공지 CRUD·차트 형태 저장. 일일 브리핑 재생성은 DAILY_BRIEFING_ENABLED가 꺼져 있으면 즉시 거절한다.
  - 권한: 공지·브리핑은 직원 관리 역할 + 대시보드 쓰기 권한(canManageStaff && canWriteTenant). 화면은 레이아웃의 requireAccess("dashboard").
  - 연동: 없음(브리핑 AI는 꺼짐).
  - 근거: `src/features/dashboard/server/actions.ts:43` · `src/features/dashboard/server/actions.ts:161` · `src/app/(shell)/dashboard/layout.tsx:19`
  - 발견: 일일 브리핑은 액션(dashboard/server/actions.ts:161)과 크론(/api/cron/daily-briefing → 410) 양쪽에서 꺼져 있다 — 일정 없음은 의도된 중지다.
- ✅ 원문으로 해소: daily-briefing 일정 없음은 의도된 중지 — 크론 핸들러는 410(DAILY_BRIEFING_DISABLED_MESSAGE)을 돌려주고 재생성 액션도 DAILY_BRIEFING_ENABLED로 막는다(원문 확인)

### `calendar` 캘린더

- 2.0: **implemented** — NAV_GROUPS에서 hidden(원장 2026-09-10) — 주소로만 열림. 구글 캘린더 푸시 웹훅(/api/calendar/google-push) + vercel 일정 google-calendar-import(0 19 * * * UTC).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `calendar_events`
- 대상: master, admin, manager, teacher · 권한 키: `calendar` · 검증: source-read (`src/features/calendar/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 일정·태그 저장/삭제(제목 길이·날짜 순서·최대 1년 검증). 구글 캘린더 → aywa 한 방향 가져오기.
  - 권한: requireCalendarWriter() 게이트.
  - 연동: Google Calendar 푸시 웹훅 + 하루 1회 크론(단일 지점 전제 — 지점이 둘 이상이면 GOOGLE_CALENDAR_TENANT_ID 필요).
  - 근거: `src/features/calendar/server/actions.ts:120` · `src/features/calendar/server/actions.ts:134`
- ⚠️ 불확실: CLAUDE.md 결정 로그는 구글 → aywa 전체 동기화를 "하루 2회 안전망"이라 적지만 vercel.json에는 google-calendar-import 일정이 하루 1회뿐 — 다른 트리거가 있는지 미확인
- ⚠️ 불확실: 실행 확인 필요: 결정 로그의 "하루 2회 전체 동기화"를 만드는 두 번째 트리거가 무엇인지(크론은 하루 1회, ?full 강제 옵션만 있음)

### `tasks-notifications` 할 일·알림(벨·푸시)

- 2.0: **implemented** — 할 일은 기록의 사실로 자동 생성·자동 종료(버튼으로 완료하지 않음 — CLAUDE.md 결정 로그). 종류 11개, 알림 유형 39개(NotificationType 유니언 — 그중 38개가 슬랙 전달 가능, daily_briefing 제외). DB 트리거 기반 알림 마이그레이션 9개.
- 원장 범위: **owner** · 쓰기 경로: reuse+new-storage · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollment_consultations`, `enrollments`, `lesson_reports`, `staff_task_assignees`, `staff_tasks`, `student_consultations`, `student_grades`, `students`, `users`
- 대상: master, admin, manager, teacher, accountant, counselor · 권한 키: — · 검증: source-read (`src/app/api/cron/staff-tasks/route.ts`, `src/app/api/staff-tasks/route.ts`, `src/features/notifications/server/actions.ts`, `src/features/slack/events.ts`, `src/features/staff-tasks/kinds.ts`)
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
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `new-task` `complete-task` `ax:request` `ax:request-start` `ax:request-reopen` `ax:form:request` `ax:form:result` `ax:read` `ax:archive` `ax:read-all` `ax:inbox-tab` `ax:draft-reset` `ax:report-slack`
  - 빠진 것: notifications 미연결(2.0 유니언 39종, cs 31종 11,534행 — 벨·푸시·보관함) · 할 일 쓰기 없음(2.0 할 일은 사실 기반 자동 종료라 버튼 완료가 없다 — 시안 complete-task는 의미가 다르다) · 할 일 종류: 2.0 코드 11종 중 시안 라벨 맵(live.js taskKind)에 없는 5종 = report_send_failed·followup_due·progress_anomaly·approval_turn·help_question, 시안의 owner_review는 2.0 종류가 아니다, cs 데이터에 있는 종류는 6종(모두 시안 맵에 있음) · 원장→담당자 요청 저장 테이블 없음
  - 제안(request): AX 요청한 업무를 staff_tasks와 같은 표면에 놓되, 자동 종료 규칙(사실 기반)과 사람이 보낸 요청을 구분하는 새 저장소 설계 필요
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 알림 읽음·보관·삭제. 할 일은 staff_tasks_sync RPC가 30분마다 사실 기준으로 열고 닫는다(사람의 완료 버튼 없음).
  - 권한: 알림은 본인(getCurrentUser), 전체 할 일 목록은 canMonitor(업무 처리 현황 권한).
  - 연동: 웹 푸시(push_subscriptions, 출결 알림 수신 동의 필요).
  - 근거: `src/features/notifications/server/actions.ts:30` · `src/app/api/cron/staff-tasks/route.ts:24` · `src/app/api/staff-tasks/route.ts:21`
  - 발견: 원장 → 담당자 요청을 저장할 표가 없다(AX 요청한 업무는 세션 전용).
- ✅ 원문으로 해소: 확인된 부재: AX "요청한 업무"(원장→담당자 지시·완료 보고)를 저장할 2.0 테이블이 없다 — staff/notion 연동 할 일(createStaffTask)이 가장 가깝지만 Notion 매핑 전용이다

### `slack` 슬랙 연동

- 2.0: **implemented** — 지점 스위치(기본 꺼짐) · 규칙 최대 30개(대상 12) · 활동 범주 12 · 프리셋 4 · 매분 아웃박스 발송. 설정 입구 = 학원 설정 > 연동 > 슬랙, 본인 연결 = /me.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `students`, `users`
- 대상: master, admin · 권한 키: `integration_settings` · 검증: source-read (`src/app/api/cron/slack-dispatch/route.ts`, `src/features/slack/server/connection-actions.ts`, `src/features/slack/server/rule-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 봇 토큰 연결·규칙(대상 1개 이상·알림 1개 이상·최대 30개)·요약 일정·사람 연결. 실제 발송은 매분 크론의 아웃박스 비우기.
  - 권한: slackGate() 게이트(학원 설정 연동 권한).
  - 연동: Slack Web API.
  - 근거: `src/features/slack/server/connection-actions.ts:21` · `src/features/slack/server/rule-actions.ts:40` · `src/app/api/cron/slack-dispatch/route.ts:21`

### `onescreen` 선생님 원스크린(수업 마감)

- 2.0: **implemented** — 강사 홈(영어 전담은 ECS). 출결·보고서·AI 멘트·공지·보강 등록을 한 화면에서 마감.
- 원장 범위: **owner-linked** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `students`, `users`
- 대상: teacher, master, admin · 권한 키: `teacher_onescreen` · 검증: source-read (`src/features/onescreen/server/actions.ts`, `src/features/onescreen/server/notice-actions.ts`, `src/features/onescreen/server/prompt-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 보고서 저장·ClassNote 대기열·AI 멘트·공지 발송/수정/취소·보강 등록·공유 링크·첨부·템플릿·AI 멘트 프롬프트 편집.
  - 권한: 강사뷰 세션(getCurrentUser({ teacherView: true })) + 기능별 쓰기 판정(공지는 담당 강사 또는 lesson_reports 쓰기, 보강 등록은 attendance 쓰기, 프롬프트는 requireAiMentAccess).
  - 연동: ClassNote(연동 PC 경유 발송), AI(generateJSON), Storage 첨부.
  - 근거: `src/features/onescreen/server/actions.ts:234` · `src/features/onescreen/server/actions.ts:1745` · `src/features/onescreen/server/notice-actions.ts:121` · `src/features/onescreen/server/prompt-actions.ts:107`

### `video-homework` 영상 숙제(제출 사이트·장부·AI 검토)

- 2.0: **implemented** — /v 공개 업로드(휴대폰 뒷4자리+이름) · 장부(관리자 전체/강사 본인 출제분) · 영상 AI 참고 메모는 지점 스위치(video_review, 기본 꺼짐).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `makeup_reservations`, `student_homework_videos`, `students`, `users`
- 대상: teacher, master, admin, student, parent · 권한 키: `lesson_reports` `teacher_onescreen` · 검증: source-read (`src/features/video-homework/server/video-assignment.ts`, `src/features/video-review/server/actions.ts`, `src/features/video-submit/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 제출 확인 표시·영상 배정(RPC, 사유 300자 이내)·반려·취소·추가 출제·AI 메모 재실행·제출 링크 회수.
  - 권한: 세션 + 기능별 게이트(reviewAccess, video-submit gate).
  - 연동: Google Drive(업로드·재생), AI 검토(지점 스위치 video_review).
  - 근거: `src/features/video-homework/server/video-assignment.ts:172` · `src/features/video-review/server/actions.ts:13` · `src/features/video-submit/server/actions.ts:39`

### `timetable` 시간표(배치·가져오기·편집기·메모)

- 2.0: **partial** — 기본·강사·통합·교실 뷰, 드래그 반 이동, 시트 가져오기(영어 마스터·수학 격자·구조), 메모 시트, 칸 메모. 수업 나누기(class-splits)는 CLASS_SPLIT_ENABLED=false로 꺼짐.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollments`, `students`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `timetable` · 검증: source-read (`src/app/(shell)/timetable/english-sheet/page.tsx`, `src/app/api/cron/apply-timetable-lab/route.ts`, `src/features/class-splits/access.ts`, `src/features/class-splits/server/actions.ts`, `src/features/timetable-memo/server/actions.ts`, `src/features/timetable/server/import-actions.ts`, `src/features/timetable/server/move-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 반 배치 이동·시트 가져오기(미리보기 → 적용)·연습본 반영 예약·메모 시트(버전 비교)·수업 나누기(꺼짐).
  - 권한: 배치 이동 = canManageTenant(classes), 시트 가져오기 = canManageSheetSync, 메모 시트 = memoSheetAccess.canEdit, 나누기 = canSplitClassNow.
  - 연동: Google Sheets(가져오기·매일 내보내기).
  - 근거: `src/features/timetable/server/move-actions.ts:79` · `src/features/timetable/server/import-actions.ts:204` · `src/features/timetable-memo/server/actions.ts:35` · `src/features/class-splits/server/actions.ts:126`
  - 발견: 편집기 머리 주석의 "운영 반영 경로 없음"은 낡았다 — previewTimetableLabApply/queueTimetableLabApply와 매시 크론이 실제로 반영한다.
- ✅ 원문으로 해소: 편집기 머리 주석의 "운영 반영 경로 없음"은 낡았다 — queueTimetableLabApply와 매시 apply-timetable-lab 크론(runApplyJob)이 실제로 반영한다(원문 확인)
- ✅ 원문으로 해소: 사실 확인: /timetable/english-sheet page.tsx는 침산 tenant id를 직접 비교해 그 지점에만 원본 시트 링크를 보인다

### `class-sheets` 강사 시트(영어 ECS·수학 MCS)

- 2.0: **partial** — ECS 주간·월간·월간계획서 인쇄·반 계획 보기·계획 대비 현황, MCS 월간·선생님별. 수학 학습 진도맵(/mcs/progress-map)은 숨은 시안(샘플 데이터·관리자 이상).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollments`, `lesson_reports`, `students`, `users`
- 대상: teacher, master, admin, manager · 권한 키: `ecs` `mcs` · 검증: source-read (`src/app/(print)/ecs/[classId]/month-plan/print/page.tsx`, `src/app/(shell)/ecs/[classId]/month/page.tsx`, `src/app/(shell)/mcs/[classId]/month/page.tsx`, `src/features/class-sheets/server/actions.ts`, `src/features/math-sheets/server/learning-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 목표·수업계획 줄·학생 표시·지난주 복사(RPC ecs_copy_week)·월간 계획·외운 단어 가져오기, 수학 학습 목표.
  - 권한: requireEcsClassAccess / requireMcsClassAccess(write) — 조회와 같은 게이트(#77).
  - 연동: 인재원(IJW) 외운 단어.
  - 근거: `src/features/class-sheets/server/actions.ts:219` · `src/features/class-sheets/server/actions.ts:149` · `src/features/math-sheets/server/learning-actions.ts:55`
- ✅ 원문으로 해소: /ecs/[classId]/month · /mcs/[classId]/month · /ecs/[classId]/month-plan/print 의 게이트는 조회 함수 안(requireEcsClassAccess · requireMcsClassAccess · getMonthPlanPrint) — 원문 확인

### `attendance` 출석부(월별·오늘·출결 모드·자리·키오스크)

- 2.0: **implemented** — 월별 출석부(기본 착지)·오늘 출결(좌석표+데스크 확인 큐)·출결 모드(강사 본인 반)·날짜별 입력·랩실/JJ실 자리 출석부(공개 PIN)·키오스크(카카오 알림톡)·출결 통계·시수 마스터.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_checkins`, `attendance_records`, `class_schedules`, `classes`, `classnote_parent_messages`, `classrooms`, `enrollments`, `invoices`, `lesson_reports`, `makeup_reservations`, `students`, `users`
- 대상: master, admin, manager, teacher, device, public · 권한 키: `attendance` `seat_attendance` `kiosk_settings` `attendance_salary_settings` · 검증: source-read (`src/app/(shell)/attendance/units-master/page.tsx`, `src/features/attendance/intake/server/actions.ts`, `src/features/attendance/server/actions.ts`, `src/features/attendance/server/makeup-reservation-actions.ts`, `src/features/attendance/server/salary-rates-actions.ts`, `src/features/attendance/server/units-master.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 출결 칸 기록(본문 800줄 — 보강·정정·시수 처리 포함)·데스크 확인 요청·결석 사전 접수·보강 예약·AI 출결 요약·자리 출석부·키오스크 기기·실급여 비율.
  - 권한: 대부분 canWriteTenant(attendance), 데스크 확인은 full/scoped, 사전 접수는 canManageTenant(attendance), 실급여는 관리자용 출석부만.
  - 연동: 키오스크(카카오 알림톡), AI 요약.
  - 근거: `src/features/attendance/server/actions.ts:603` · `src/features/attendance/intake/server/actions.ts:195` · `src/features/attendance/server/makeup-reservation-actions.ts:275` · `src/features/attendance/server/salary-rates-actions.ts:69`
- ✅ 원문으로 해소: /attendance/units-master 게이트 = loadUnitsMaster 안 requireAccess("attendance")(units-master.ts:39), 입구 = 월별 출석부의 UnitsMasterButton(canViewUnitsMaster) — 원문 확인

### `classes` 수업목록(반·수강·인수인계)

- 2.0: **implemented** — 반 생성·수정·보관, 운영 기간 종료·재개, 담임 인수인계 예약·적용, 결근 대체 위임, 수강 배정·이동·예약.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollments`, `invoices`, `lesson_reports`, `students`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `classes` · 검증: source-read (`src/features/classes/server/actions.ts`, `src/features/enrollments/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 반 생성(수업 시간 저장 실패 시 안내)·운영 기간 종료·인수인계 예약(현재 담임과 같으면 거절)·결근 대체 위임·수강 배정(종료일은 상태 권한 필요)·예약 수강 변경.
  - 권한: requireClassManage / requireClassWrite / requireDelegationWrite, 수강 배정은 classes 또는 students 관리 권한(강사는 열람 전용).
  - 연동: 없음.
  - 근거: `src/features/classes/server/actions.ts:254` · `src/features/classes/server/actions.ts:917` · `src/features/enrollments/server/actions.ts:72`

### `makeups` 보강관리

- 2.0: **implemented** — 명령 버스 하나(executeMakeupCommand)로 접수·배정·병합·종결. 운영 모드는 학원 설정 > 보강 운영(원장만). 도입 사전 점검·대사·복구 화면 포함.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `classes`
- 대상: master, admin, manager, teacher · 권한 키: `makeups` · 검증: source-read (`src/features/makeups/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 모든 변경이 명령 하나(makeup_command RPC)로 들어간다 — 접수·배정·병합·종결. 검색은 학생·반·직원·강의실·정책·출결·보고서·세션.
  - 권한: 강사뷰 세션 + canWriteTenant(makeups).
  - 연동: 없음.
  - 근거: `src/features/makeups/server/actions.ts:37` · `src/features/makeups/server/actions.ts:44` · `src/features/makeups/server/actions.ts:90`
- ⚠️ 불확실: 실행 확인 필요: 침산 복사본의 makeup_cases가 0행이다 — 이 지점에서 새 보강관리 운영 모드가 아직 꺼져 있는지(학원 설정 > 보강 운영) 실행 상태 확인 필요

### `textbooks` 교재목록(커리큘럼·반 배정)

- 2.0: **implemented** — 교재·차수별 진도·과제 마스터와 반 배정(영어 시트 자동기입 재료). 수납관리 교재 단가표와 다른 물건.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `students`, `textbook_orders`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `textbooks` · 검증: source-read (`src/features/textbooks/server/actions.ts`, `src/features/textbooks/server/math-assignment-actions.ts`, `src/features/textbooks/server/plan-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 교재·차수 저장, 표지, 반 배정 채우기(미리보기·되돌리기), 회차 미룸·당김, 수학 교재 배정.
  - 권한: requireTextbookWrite, 반 단위는 requireEcsClassAccess/requireMcsClassAccess(write).
  - 연동: 없음.
  - 근거: `src/features/textbooks/server/actions.ts:47` · `src/features/textbooks/server/plan-actions.ts:1168` · `src/features/textbooks/server/math-assignment-actions.ts:39`

### `lesson-reports` 수업보고서·ClassNote 발송

- 2.0: **implemented** — 면: 영상 제출 현황·작성률·목록·클래스노트(발송 큐·반 구성·반 공지·직접 발송·회수·학부모 글·답글)·보고서 설정·AI 멘트. 학부모 공개 링크 /r/[token]. 평점(참고용) 30분 크론.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classnote_parent_messages`, `classnote_parent_replies`, `enrollments`, `lesson_reports`, `student_homework_videos`, `students`, `users`
- 대상: master, admin, manager, teacher, parent · 권한 키: `lesson_reports` `report_settings` `ai_ment` · 검증: source-read (`src/features/classnote-reply/server/reply-actions.ts`, `src/features/report-admin/server/actions.ts`, `src/features/report-admin/server/compose-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: ClassNote 대기열·관리자 직접 작성/발송·반 공지 미리보기/발송·회수 요청·반 보드 원아 연결·학부모 답글/공감·목록(평점은 쓰기 권한자만).
  - 권한: 조회 canAccessTenant(lesson_reports), 쓰기 canWriteTenant(lesson_reports), 답글은 replyGate + canReply.
  - 연동: ClassNote(연동 PC), AI 평점.
  - 근거: `src/features/report-admin/server/actions.ts:479` · `src/features/report-admin/server/compose-actions.ts:337` · `src/features/classnote-reply/server/reply-actions.ts:168` · `src/features/report-admin/server/actions.ts:511`

### `class-review` 직원 평가·직원 포트폴리오

- 2.0: **partial** — 실험실 메뉴(기본 전원 none, 개인 예외로만 개방). 참관 평가는 academy_documents에 문서로 저장(class-review/server/actions.ts). 포트폴리오는 원장 역할만, 지표·만점은 학원 설정 > 강사평가.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `classes`, `classnote_parent_messages`, `enrollments`, `invoices`, `lesson_reports`, `staff_attendance_days`, `staff_contracts`, `students`, `users`
- 대상: master, admin · 권한 키: `class_review` · 검증: source-read (`src/features/class-review/server/actions.ts`, `src/features/teacher-portfolio/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 참관 평가 개설(강사 직급은 본인 평가만)·문항 세트(원장·지정 인원)·포트폴리오 재계산·만족도 판정·평가 기준 저장.
  - 권한: requireWrite + 개설은 사무실, 문항 편집은 priv.editTemplate, 포트폴리오는 getPortfolioGate + canWriteTenant(class_review).
  - 연동: 없음(만족도 판정 AI는 학부모 글 분류에서).
  - 근거: `src/features/class-review/server/actions.ts:64` · `src/features/class-review/server/actions.ts:405` · `src/features/teacher-portfolio/server/actions.ts:23`

### `students` 원생목록·원생 상세·원생 통계

- 2.0: **implemented** — 상세 탭 13개(개요·수업·성적·SRS·오늘 수학·진도·숙제 영상·출결·상담·특이사항·수납·기여도·타임라인), 형제, 상태 전환, 원생 매일 기록 크론.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classrooms`, `enrollment_consultations`, `enrollments`, `invoices`, `lesson_reports`, `progress_entries`, `student_consultations`, `student_daily_stats`, `student_grades`, `student_history_monthly`, `student_homework_videos`, `student_memos`, `students`, `textbook_orders`, `users`
- 대상: master, admin, manager, teacher, counselor, viewer · 권한 키: `students` `student_english_name` · 검증: source-read (`src/features/students/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 원생 등록·상태 전환(퇴원으로의 전환은 거절 — 퇴원보고서로만)·수강 종료(사유 필수)·특이사항·성적·영어 이름·진도 이상 처리.
  - 권한: 등록 canManageStudentRecords, 상태·종료 canManageStudentStatusNow, 메모·성적 canWriteTenant(students), 영어 이름 ecs 권한.
  - 연동: 없음.
  - 근거: `src/features/students/server/actions.ts:175` · `src/features/students/server/actions.ts:582` · `src/features/students/server/actions.ts:1041`

### `student-contribution` 원생 기여도(온톨로지·소개)

- 2.0: **implemented** — 학생별 운영 기여·학습 참여·연결 기록, 긍정 신호(밤 판정), 지난 소개 확인, 배점 설정(학원 설정 > 원생 기여도).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `class_schedules`, `classes`, `classnote_parent_messages`, `classnote_parent_replies`, `enrollment_consultations`, `enrollments`, `lesson_reports`, `makeup_reservations`, `shuttle_boardings`, `student_consultations`, `student_memos`, `students`, `textbook_orders`, `users`
- 대상: master, admin · 권한 키: `student_contribution` · 검증: source-read (`src/app/(shell)/student-contribution/page.tsx`, `src/features/student-contribution/components/settings-view.tsx`, `src/features/student-contribution/server/actions.ts`, `src/features/student-contribution/server/summary-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 기여도 재계산·긍정 신호 변경·소개자 연결·AI 기록 요약(명시 버튼, ai_analysis 라이선스)·배점 저장.
  - 권한: requireContributionWrite, 페이지는 재-export 뷰의 게이트.
  - 연동: AI(요약).
  - 근거: `src/features/student-contribution/server/actions.ts:42` · `src/features/student-contribution/server/summary-actions.ts:27`
- ✅ 원문으로 해소: /student-contribution 하위 페이지는 기능 모듈 뷰를 재-export하고 뷰가 게이트를 건다(settings-view.tsx:6 gate.canConfigure, referral-view getContributionGate, list/ontology 데이터 없음 → redirect) — 원문 확인

### `exams` 성적관리(통합·입력·확인·JJ실)

- 2.0: **implemented** — 통합 성적관리·학기 격자 입력·확인 뷰·엑셀, JJ실 시험 결과·결과지·보카킹 리포트(1차 시안).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `student_consultations`, `student_grades`, `students`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `exams` · 검증: source-read (`src/features/grades/server/actions.ts`, `src/features/grades/server/excel-actions.ts`, `src/features/ijw/server/link-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 학기 격자 점수 저장(명단 밖 학생·음수 거절)·엑셀 가져오기(서식 검증)·IJW 학생 연결.
  - 권한: gradeWriteError 게이트, IJW 연결은 manager().
  - 연동: 인재원(IJW).
  - 근거: `src/features/grades/server/actions.ts:124` · `src/features/grades/server/excel-actions.ts:148` · `src/features/ijw/server/link-actions.ts:67`

### `consultations` 원생상담(재원생 상담·AI 분석)

- 2.0: **implemented** — 목록·상세·작성·수정·통계, 녹음 업로드→전사→AI 분석, 후속조치 체크.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `enrollment_consultations`, `enrollments`, `student_consultations`, `students`, `users`
- 대상: master, admin, manager, teacher, counselor · 권한 키: `consultations` · 검증: source-read (`src/features/consultations/server/actions.ts`, `src/features/consultations/server/audio-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 상담 작성(담당 범위 밖 학생 거절)·후속조치 토글·녹음으로 시작(라이선스·경로 검증) → 전사 → AI 분석.
  - 권한: canWriteTenant(consultations) + canConsultStudent 범위, 후속조치는 full/scoped.
  - 연동: AssemblyAI + AI 분석.
  - 근거: `src/features/consultations/server/actions.ts:313` · `src/features/consultations/server/actions.ts:323` · `src/features/consultations/server/audio-actions.ts:66`

### `enrollment` 신규 콜&상담(QR 접수·브리프·인수인계)

- 2.0: **implemented** — 칸반 4칸·목록·통계·관리현황, QR 공개 접수(/intake), 상담 준비 브리프(AI)·인수인계서 인쇄, 병합·원생 전환, makeedu 푸시.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollment_consultations`, `enrollments`, `students`, `users`
- 대상: master, admin, counselor, public · 권한 키: `enrollment` · 검증: source-read (`src/features/enrollment/server/actions.ts`, `src/features/integrations/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 상담 작성(경로 필수·후속 조치·소개자)·결과 지정(배정된 반이 있으면 등록 외 거절)·원생 전환(반 1개 이상)·AI 재분석(전사 필요)·QR 토큰·makeedu 전송(연동 PC 필요).
  - 권한: canWriteTenant(enrollment), QR은 requireIntakeAdmin, makeedu 전송은 canPushToMakeedu.
  - 연동: makeedu(연동 PC), AI, QR 공개 접수.
  - 근거: `src/features/enrollment/server/actions.ts:82` · `src/features/enrollment/server/actions.ts:574` · `src/features/integrations/server/actions.ts:498`

### `retention` 이탈 방어

- 2.0: **implemented** — 면 4개(브리핑·리텐션 보드·학부모 메시지·재등록 캠페인).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `enrollments`, `invoices`, `lesson_reports`, `student_consultations`, `student_grades`, `students`
- 대상: master, admin, manager · 권한 키: `retention` · 검증: source-read (`src/features/retention/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 재등록 캠페인 추가·제거·상태, 학부모 메시지 조치 기록(2자 이상).
  - 권한: canWriteTenant(retention).
  - 연동: 없음.
  - 근거: `src/features/retention/server/actions.ts:74` · `src/features/retention/server/actions.ts:29`
- ⚠️ 불확실: 실행 확인 필요: reenrollment_campaign_targets가 침산 복사본에서 0행 — 캠페인 기능을 실제로 쓰는지

### `newcomers` 신규생 관리(90일 체크리스트)

- 2.0: **implemented** — 신입 등록 후 7·30·60·90일 체크, 기록(통계) 화면.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollments`, `student_onboarding_checks`, `students`
- 대상: master, admin, manager, counselor · 권한 키: `newcomers` · 검증: source-read (`src/features/newcomers/server/actions.ts`)
- 페이지 2: `/newcomers`(screen) `/newcomers/stats`(stats)
- 메뉴·탭 입구 1: 신규생 관리(/newcomers)
- 핵심 동작:
  - 체크리스트 항목 완료 — `setOnboardingCheck`
- 서버 액션 전체(동사 갈래): 수정·처리 2 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `student_onboarding_checks` 172/22★ (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P1
  - 빠진 것: 체크리스트 전부 — 시안 스냅샷에는 student_onboarding_checks 표가 들어 있으나 화면이 없다
  - 제안(issue): 체크 기한이 지난 신입생을 이슈로
- 원문 검토(읽은 범위: key-actions):
  - 동작: 신입 체크리스트 항목 완료/취소(과목별).
  - 권한: canWriteTenant(newcomers).
  - 연동: 없음.
  - 근거: `src/features/newcomers/server/actions.ts:46`

### `withdrawals` 퇴원관리

- 2.0: **implemented** — 퇴원+수강종료 한 목록, 분석 축 전환, 3개월 내 퇴원, 퇴원 예약 자정 처리 크론.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `classrooms`, `enrollments`, `students`, `users`
- 대상: master, admin, manager · 권한 키: `withdrawals` · 검증: source-read (`src/features/withdrawals/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 재원 복귀(퇴원 권한 + 상태 권한 + 원생 관리 권한)·퇴원 사유 수정(대분류 검증)·상담 단계 체크.
  - 권한: canWriteTenant(withdrawals) + canManageStudentStatusNow + canManageTenant(students).
  - 연동: 없음.
  - 근거: `src/features/withdrawals/server/actions.ts:190` · `src/features/withdrawals/server/actions.ts:195`

### `withdrawal-reports` 퇴원보고서(작성·순차 승인·옛 시트)

- 2.0: **implemented** — 퇴원은 보고서로만(서버가 직접 퇴원 거절). 담임별 보고서·관리자 전원 승인·원장 선택 승인, 옛 시트 기록 매핑.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `invoices`, `student_consultations`, `students`, `users`, `withdrawal_report_archives`, `withdrawal_reports`
- 대상: master, admin, manager, teacher · 권한 키: `withdrawal_reports` · 검증: source-read (`src/features/withdrawal-reports/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 작성 요청(RPC request_withdrawal_report_group, 담당 과목만)·단계 변경 save/submit/approve/reject/cancel(revision 비교)·옛 시트 연결.
  - 권한: reportViewer().request / .writable.
  - 연동: 없음.
  - 근거: `src/features/withdrawal-reports/server/actions.ts:41` · `src/features/withdrawal-reports/server/actions.ts:82`

### `staff` 직원관리(명부·계약·이력서·휴가·연차)

- 2.0: **implemented** — 직원 등록·근무 설정·계약(PDF OCR — 원장 승인 예외)·이력서·QR 직원 등록·휴가·연차 조정·Notion 할 일·대시보드 배정.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `class_schedules`, `classes`, `enrollments`, `lesson_reports`, `staff_contracts`, `textbook_orders`, `users`
- 대상: master, admin · 권한 키: `staff` `teacher_view` · 검증: source-read (`src/features/leave/server/actions.ts`, `src/features/payroll/server/actions.ts`, `src/features/staff/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 직원 등록(Auth 계정 생성, 본인보다 높은 역할 부여 불가)·계약 수정·이력서·QR 직원 등록·휴가 신청(유형 5종)·연차 조정·Notion 할 일.
  - 권한: canWriteTenant(staff) + canSeeStaffMember 범위, 휴가는 직원 관리 역할, 연차 조정은 requireAdjuster.
  - 연동: Supabase Auth, Notion, 계약 PDF OCR(Claude, 원장 승인 예외).
  - 근거: `src/features/staff/server/actions.ts:109` · `src/features/payroll/server/actions.ts:198` · `src/features/leave/server/actions.ts:122`
  - 발견: 2.0 오류 문구가 원시 역할 키를 노출한다: payroll/server/actions.ts:207 "(master / admin / manager)", staff/server/actions.ts:123 "${newRole} 역할은…" — 3.0 카탈로그에는 옮기지 않았다.

### `payroll` 급여·명세서·강사 정산

- 2.0: **implemented** — 프리랜서 명세서(출석부 실급여 합계)·월별 급여·강사 정산. 급여는 외부 AI 전송 금지 필드.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `class_schedules`, `classes`, `enrollments`, `payroll_records`, `payslips`, `staff_contracts`, `students`, `users`
- 대상: master · 권한 키: `payroll_settings` · 검증: source-read (`src/features/payroll/server/class-salary-actions.ts`, `src/features/payroll/server/payslip-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 명세서 발행(정산 불가·실수령 음수면 거절)·급여 자동 계산·반별 급여 배분율(0~100).
  - 권한: canManagePayslipNow(원장 + 지정), 급여 계산은 직원 관리 역할 + staff 쓰기, 반별 급여는 canManageSalary.
  - 연동: 없음(급여는 외부 AI 전송 금지 필드).
  - 근거: `src/features/payroll/server/payslip-actions.ts:155` · `src/features/payroll/server/payslip-actions.ts:171` · `src/features/payroll/server/class-salary-actions.ts:38`
- ⚠️ 불확실: 실행 확인 필요: payroll_records가 침산 복사본에서 0행 — 급여 기능이 genericFeatureDisabled("payroll")로 꺼져 있는지(명세서 7건은 payslips 표)

### `billing` 수납관리(청구·교재·지출·계산기·회차 확정·환불·정산)

- 2.0: **implemented** — 면 7개(수납·교재·지출·수강료 계산기[하위 5]·회차 확정·환불 요청서·강사 정산), 교재 하위 2, 수납 통계. 청구는 makeedu 동기화 기반. 환불 요청서는 academy_documents에 문서로 저장(refund-actions.ts).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`, `attendance_records`, `class_schedules`, `classes`, `enrollments`, `expenses`, `invoices`, `student_history_monthly`, `students`, `textbook_orders`, `users`
- 대상: master, admin, accountant · 권한 키: `billing` `billing_settings` · 검증: source-read (`src/features/billing/server/actions.ts`, `src/features/billing/server/expense-actions.ts`, `src/features/billing/server/refund-actions.ts`, `src/features/billing/session-terms/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 수기 청구(같은 달 중복 거절)·교재 주문·지출 결의·수강료 단가·견적·회차 확정(시수 0~99)·환불 요청서(academy_documents)·자리 몫 조정.
  - 권한: canWriteTenant(billing), 지출은 expenseWriteScope, 단가·견적은 canWrite, 회차는 회차 정산 모듈이 켜져야.
  - 연동: makeedu(청구 동기화).
  - 근거: `src/features/billing/server/actions.ts:46` · `src/features/billing/server/expense-actions.ts:167` · `src/features/billing/session-terms/server/actions.ts:442` · `src/features/billing/server/refund-actions.ts:65`

### `textbook-requests` 교재 요청(강사)

- 2.0: **implemented** — 강사 미니셸 "내 메뉴" 전용 입구(NAV hidden + teacherMenuEntry). 처리는 수납관리 교재 면.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: teacher, master, admin, accountant · 권한 키: `textbook_requests` · 검증: source-read (`src/features/billing/server/textbook-actions.ts`, `src/features/billing/server/textbook-notice-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 강사 교재 요청(담당 학생만)·첨부·교재 안내 공지 준비/발송(연동 PC 게이트).
  - 권한: canWriteTenant(textbook_requests).
  - 연동: ClassNote 공지(연동 PC).
  - 근거: `src/features/billing/server/textbook-actions.ts:159` · `src/features/billing/server/textbook-actions.ts:170` · `src/features/billing/server/textbook-notice-actions.ts:116`

### `expense-requests` 지출결의서(강사 제출)

- 2.0: **implemented** — 강사 본인 결의서 조회·삭제·상세(인쇄). 사무실 역할은 /billing 지출 면으로 보낸다.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: teacher · 권한 키: `expense_requests` · 검증: source-read (`src/features/billing/server/expense-actions.ts`)
- 페이지 2: `/expense-requests`(screen) `/expense-requests/[id]`(detail)
- 메뉴·탭 입구 2: 지출결의서(/expense-requests) · menu.item.expense_requests(/expense-requests)
- 핵심 동작:
  - 본인 결의서 삭제 — `deleteExpense`
- 핵심 표(전체/cs 행): `expenses` 273/261★ (★ = 시안 스냅샷 입력)
- AX: **read-only** · 시안 finance · AX — · 우선 P2
  - 보이는 것: 지출 구성(집계)
  - 빠진 것: 강사 제출 흐름
  - 제안(evidence): 결재 이슈의 근거로
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 강사 본인 지출결의서 조회·삭제·상세. 작성은 같은 billing createExpense(expenseWriteScope)가 맡고 /billing과 /expense-requests를 함께 갱신한다.
  - 권한: expenseWriteScope + 본인 작성분.
  - 연동: 없음.
  - 근거: `src/features/billing/server/expense-actions.ts:294` · `src/features/billing/server/expense-actions.ts:218`
  - 발견: 감사 1차의 "작성 경로 미확인"은 해소: createExpense(expense-actions.ts:164)가 강사 범위(expenseWriteScope)로 작성하고 /expense-requests를 갱신한다.
- ✅ 원문으로 해소: 작성 경로 확인: billing createExpense(expense-actions.ts:164, expenseWriteScope)가 강사 작성분을 저장하고 /expense-requests를 갱신한다

### `shuttle` 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치)

- 2.0: **partial** — 편성·주간 시간표·오늘 등하원·학부모 등하원·운행 현황·학부모 관리 현황·노선표 인쇄. 실시간 위치/지도는 지도 키 미정으로 자리만(원장 2026-09-03).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `shuttle_boardings`, `shuttle_riders`, `shuttle_run_stops`, `shuttle_runs`, `shuttle_stops`, `shuttle_vehicles`, `students`, `users`
- 대상: master, admin, manager, teacher, driver · 권한 키: `shuttle` · 검증: source-read (`src/features/shuttle/parent-accounts/server/parent-actions.ts`, `src/features/shuttle/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 회차(30개까지)·정류장·학생 배정(요일 1개 이상, 학원 칸 배정 금지)·탑승 기록(출발 후에만)·차량·학부모 계정 발급(원장·관리자).
  - 권한: gate()/recordGate(), 학부모 계정은 원장·관리자.
  - 연동: 지도(키 미정, 자리만).
  - 근거: `src/features/shuttle/server/actions.ts:229` · `src/features/shuttle/server/actions.ts:639` · `src/features/shuttle/parent-accounts/server/parent-actions.ts:23`
- ⚠️ 불확실: 실행 확인 필요: parent_accounts가 침산 복사본에서 0행 — 학부모 포털을 실제로 발급해 쓰는지

### `inventory` 재고관리(자산·대여·실사·소모품·업체)

- 2.0: **implemented** — 면 5개(업체리스트는 지정자만), 자산 QR 라벨 인쇄, 공개 자산 페이지(/inventory/asset/[code], noindex), 엑셀.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `inventory_assets`, `inventory_supplies`, `users`
- 대상: master, admin, manager, public · 권한 키: `inventory` · 검증: source-read (`src/features/inventory/server/asset-actions.ts`, `src/features/inventory/server/audit-actions.ts`, `src/features/inventory/server/vendor-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 자산 등록(대여중은 대여 시작으로만, 폐기는 폐기일 필수, 자산ID 규칙)·대여·실사(미래일 금지)·소모품·업체·엑셀.
  - 권한: requireInventoryWrite, 업체는 requireVendorWrite.
  - 연동: 없음.
  - 근거: `src/features/inventory/server/asset-actions.ts:82` · `src/features/inventory/server/audit-actions.ts:30` · `src/features/inventory/server/vendor-actions.ts:78`

### `meetings` 회의록(녹음·AI 분석)

- 2.0: **implemented** — 텍스트·녹음 회의, 전사→AI 분석(Sonnet), 화자 지정, 다시 분석·전사부터 다시, 인쇄.
- 원장 범위: **owner** · 쓰기 경로: reuse+new-storage · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: master, admin, manager · 권한 키: `meetings` · 검증: source-read (`src/features/meetings/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 텍스트 회의 만들기·녹음 회의·AI 분석 재생성(전사 필요)·메모·삭제.
  - 권한: canWriteTenant(meetings).
  - 연동: AssemblyAI + AI.
  - 근거: `src/features/meetings/server/actions.ts:367` · `src/features/meetings/server/actions.ts:590`

### `approvals` 전자결재(기안·결재함)

- 2.0: **implemented** — 결재함 8면(전체·결재 대기·결재 예정·진행·완료·반려·회수·참조·학원 전체 진행), 양식 4종(휴가신청서·품의서·지출결의서·수입결의서 — src/features/approvals/types.ts:11, 업무연락 폐기), 결재선 템플릿.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `approval_documents`, `approval_steps`, `users`
- 대상: master, admin, manager, teacher · 권한 키: `approvals` · 검증: source-read (`src/app/(shell)/approvals/new/page.tsx`, `src/features/approvals/server/actions.ts`, `src/features/approvals/types.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 기안 4종(휴가·품의·지출·수입)·결재(승인·반려·전결)·댓글·결재선 템플릿.
  - 권한: 기안은 requireApprovalWriter, 결재·댓글은 requireSignedIn + 결재선 차례.
  - 연동: 없음.
  - 근거: `src/features/approvals/server/actions.ts:310` · `src/features/approvals/server/actions.ts:598` · `src/features/approvals/types.ts:11`
- ✅ 원문으로 해소: 기안 화면 머리 주석(approvals/new/page.tsx:18)의 "업무연락"은 낡았다 — 원장 확정 양식은 types.ts:11의 휴가·품의·지출·수입 4종

### `documents` 데이터베이스(서식·문서 저장소)

- 2.0: **implemented** — 탐색기형 폴더·파일·링크·텍스트 문서, 즐겨찾기, 미리보기. 일부 문서 restricted(이력서 등).
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `academy_documents`
- 대상: master, admin, manager, teacher · 권한 키: `documents` · 검증: source-read (`src/features/documents/server/actions.ts`, `src/features/documents/server/file-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: 업로드 등록(지점 경로 검증)·수정·폴더 만들기·파일 이동(동시 변경 감지).
  - 권한: requireDocumentWrite, 이동은 canWriteTenant(documents).
  - 연동: Supabase Storage.
  - 근거: `src/features/documents/server/actions.ts:87` · `src/features/documents/server/file-actions.ts:28`

### `support` 고객센터(공지·개선요청)

- 2.0: **implemented** — 지점: 공지사항·개선요청 작성. 운영자: 처리상태·답변·전 지점 공지.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: master, admin, platform · 권한 키: `support` · 검증: source-read (`src/features/support/server/actions.ts`, `src/features/support/server/admin-actions.ts`)
- 페이지 9: `/super-admin/support`(platform) `/super-admin/support/[id]`(platform) `/super-admin/support/notices`(platform) `/super-admin/support/notices/[id]`(platform) `/super-admin/support/notices/new`(platform) `/support`(screen) `/support/notices/[id]`(detail) `/support/requests/[id]`(detail) `/support/requests/new`(form)
- 메뉴·탭 입구 4: 고객센터(/support) · 고객센터(/super-admin/support) · 공지사항(/support) · 개선요청(/support?tab=requests)
- 핵심 동작:
  - 개선요청 작성·수정 — `createSupportRequest`, `updateSupportRequest`
  - 운영자 답변·공지 저장·삭제 — `answerSupportRequest`, `saveSupportNotice`, `deleteSupportNotice`
- 서버 액션 전체(동사 갈래): 생성·등록 1 · 수정·처리 3 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `support_requests` 1/1, `support_notices` 0/— (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 고객센터 전부
  - 제안(request): 개선요청 초안을 작성하는 미리보기와 답변 도착(알림 support_answer)을 알림함에
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 지점 개선요청 작성. 운영자가 처리상태·예정일·답변(완료는 답변 필수)과 전 지점 공지를 관리.
  - 권한: 지점 = canWriteSupportRequest, 운영자 = 운영 콘솔 게이트.
  - 연동: 없음.
  - 근거: `src/features/support/server/actions.ts:36` · `src/features/support/server/admin-actions.ts:29`

### `owner-settings` 학원 설정(18면)·관리자 도구

- 2.0: **implemented** — 면 18개(기능 면은 일반판 전용), 연동 하위 6, 설정 카드 43개. /admin/* 는 전부 /owner로 돌려보낸다.
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `attendance_records`, `calendar_events`, `class_schedules`, `classes`, `classrooms`, `enrollment_consultations`, `enrollments`, `expenses`, `invoices`, `shuttle_riders`, `shuttle_run_stops`, `shuttle_runs`, `shuttle_stops`, `shuttle_vehicles`, `student_consultations`, `students`, `users`
- 대상: master, admin · 권한 키: `owner` `admin` `profile_settings` `operations_settings` `notification_settings` `consultation_settings` `navigation_settings` `popup_settings` · 검증: source-read (`src/app/(shell)/owner/_components/integrations-face.tsx`, `src/app/(shell)/owner/page.tsx`, `src/app/admin/page.tsx`, `src/features/admin/server/actions.ts`, `src/features/owner/server/actions.ts`, `src/features/owner/tabs.ts`, `src/features/periods/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 섹션 단위 설정 저장(스키마 검증)·강의실·과목 흡수·세션 기간(RPC)·팝업 공지·데이터 정리(병합 등)·설정별 역할 권한(원장만).
  - 권한: saveOwnerSection 섹션 스키마 + 권한, 데이터 정리는 행정 상태 권한 + admin 쓰기, 설정 역할은 원장.
  - 연동: 연동 하위 면(슬랙·makeedu·시트·드라이브·연동 PC·오늘 수학).
  - 근거: `src/features/owner/server/actions.ts:105` · `src/features/periods/server/actions.ts:120` · `src/features/admin/server/actions.ts:53`

### `help` 도움말(설명서·질문 게시판)

- 2.0: **implemented** — 화면 설명서·아이콘 시스템·질문 게시판(할 일 help_question)·전체 설명서 인쇄.
- 원장 범위: **owner** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `users`
- 대상: master, admin, manager, teacher, accountant, counselor, viewer · 권한 키: `help` · 검증: source-read (`src/features/help/board/server/actions.ts`)
- 페이지 5: `/help`(screen) `/help/[slug]`(detail) `/help/icons`(screen) `/help/posts/[id]`(detail) `/print/help/manuals`(print)
- 메뉴·탭 입구 3: 도움말(/help) · 아이콘 시스템(/help/icons)
- 핵심 동작:
  - 질문 작성·수정·답변·닫기·삭제 — `createHelpPost`, `updateHelpPost`, `createHelpAnswer`, `closeHelpPost`, `deleteHelpPost`
- 서버 액션 전체(동사 갈래): 수정·처리 2 · 생성·등록 2 · 삭제 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `help_posts` 0/0, `help_answers` 0/0 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 도움말 전부
  - 제안(command): 도움말 문서를 근거로 답하고, 질문 게시판 초안을 작성하는 미리보기
- 원문 검토(읽은 범위: key-actions):
  - 동작: 도움말 질문 작성(게시판 표가 없으면 안내).
  - 권한: canAskHelpBoard.
  - 연동: 없음.
  - 근거: `src/features/help/board/server/actions.ts:21`
- ⚠️ 불확실: 실행 확인 필요: help_posts가 침산 복사본에서 0행 — 질문 게시판 사용 여부

### `teacher-workspace` 강사 작업 공간(미니셸·내 정보·뷰 전환)

- 2.0: **implemented** — 강사 "내 메뉴" 19개 링크(원장이 순서·표시 설정), 화면 언어(한국어/English), 겸직 강사뷰↔관리자뷰, 다른 강사 뷰(열람 전용).
- 원장 범위: **owner-linked** · 쓰기 경로: reuse+new-storage · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `users`
- 대상: teacher, viewer, master, admin · 권한 키: — · 검증: source-read (`src/features/shell/view-actions.ts`, `src/features/staff/server/me-actions.ts`, `src/lib/teacher-menu-links.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 내 이메일(중복 검사)·비밀번호·보고서 이름, 강사뷰 언어, 강사뷰·관리자뷰·다른 강사 뷰 전환(담당 반·위임이 있을 때만).
  - 권한: 본인 세션, 뷰 전환은 isFullShellRole + canUseTeacherView.
  - 연동: 없음.
  - 근거: `src/features/staff/server/me-actions.ts:46` · `src/features/shell/view-actions.ts:64`

### `student-portal` 학생 내 학습

- 2.0: **partial** — 페이지 머리 주석: "정적 결정적 데이터(DEMO_STUDENT), DB·AI 미연동" — 데모 이식 상태.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: student · 권한 키: `my_learning` · 검증: source-read (`src/app/(shell)/my-learning/page.tsx`)
- 페이지 2: `/my-learning`(portal) `/my-learning/report`(portal)
- 핵심 동작:
  - 누적 현황·데일리 리포트 열람(읽기 전용) — 페이지 `/my-learning`, 페이지 `/my-learning/report`
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 학생 화면 미리보기(현재 데모 데이터)
  - 제안(evidence): 학생 화면 미리보기 — 2.0이 데모 데이터로 그린다는 사실을 함께 표시
- 원문 검토(읽은 범위: page):
  - 동작: 누적 학습 현황·데일리 리포트 — 정적 데모 데이터(DEMO_STUDENT), DB·AI 미연동.
  - 권한: requireAccess("my_learning").
  - 연동: 없음.
  - 근거: `src/app/(shell)/my-learning/page.tsx:15`
  - 발견: 학생 화면은 실제 학생 데이터가 아니라 데모 데이터다.

### `parent-portal` 학부모 포털(셔틀·시간표)

- 2.0: **partial** — 탭 5칸 중 3개만 기능(실시간 차량·등하원 변경·확인·수업 시간표), 2칸은 빈 슬롯. 실시간 차량은 지도 키가 없으면 안내만.
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: parent · 권한 키: — · 검증: source-read (`src/app/(parent)/parent/_components/parent-tabs.tsx`, `src/features/shuttle/ride-change/server/parent-regular-ride-actions.ts`, `src/features/shuttle/ride-change/server/parent-ride-actions.ts`)
- 페이지 4: `/parent`(redirect) `/parent/classes`(portal) `/parent/live`(portal) `/parent/rides`(portal)
- 화면 안 카탈로그 `parentTabs`: 3개 (§10)
- 핵심 동작:
  - 등하원 결석·정류장 변경·건너뛰기·되돌리기 — `absentParentRide`, `changeParentRideStop`, `skipParentRide`, `resetParentRide`
  - 정기 승하차 변경 — `changeRegularRide`
  - 변경 이력 확인 — `ackShuttleHistory`
- 핵심 표(전체/cs 행): `shuttle_ride_exceptions` 10/10, `shuttle_ride_exception_history` 14/14, `parent_accounts` 0/0, `parent_account_students` 0/0, `shuttle_history_acks` 0/0 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 해당 없음(원장 작업 공간 밖)
  - 제안(issue): 학부모 변경 요청 확인 대기를 이슈로, 학부모 화면 3개 탭 미리보기
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 학부모 등하원 결석·정류장 변경·건너뛰기·정기 승하차 변경(월~금). 직원은 변경 내역 확인.
  - 권한: parentDayGate/parentGate(연결된 아이), 확인은 canRecordBoarding.
  - 연동: 지도(키 없으면 안내).
  - 근거: `src/features/shuttle/ride-change/server/parent-ride-actions.ts:77` · `src/features/shuttle/ride-change/server/parent-regular-ride-actions.ts:43`

### `public-sites` 공개 랜딩(제품·학원)

- 2.0: **implemented** — / = aywa 제품 랜딩(원장 고객사 대상), /academy = 학원 공개 랜딩(학부모 대상, getPublicBranding).
- 원장 범위: **owner-linked** · 쓰기 경로: read-only · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: 없음
- 대상: public · 권한 키: — · 검증: source-read (`src/app/(academy)/academy/page.tsx`)
- 페이지 2: `/`(public-share) `/academy`(public-share)
- 핵심 동작:
  - 열람만 — 페이지 `/`, 페이지 `/academy`
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 학원 공개 페이지 미리보기
  - 제안(evidence): 학원 공개 페이지(/academy) 미리보기 — 제품 랜딩(/)은 감사 전용
- 원문 검토(읽은 범위: page):
  - 동작: / = 제품 랜딩, /academy = 학원 공개 랜딩(학원명은 공개 브랜딩에서).
  - 권한: 공개.
  - 연동: 없음.
  - 근거: `src/app/(academy)/academy/page.tsx:2`

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
- 원문 검토(읽은 범위: page):
  - 동작: 역할·과목 홈 판정, 퇴사 계정 로그아웃, 학부모 → /parent, 지점 보기 정리.
  - 권한: 세션.
  - 연동: 없음.
  - 근거: `src/app/home/route.ts:107` · `src/app/home/route.ts:84`

### `platform-console` 운영 콘솔(슈퍼관리자)

- 2.0: **implemented** — 메뉴 6개(대시보드·전 지점 운영·실험실 메뉴·이용 분석·고객센터·감사 로그), 지점 발급·라이선스·AI 모델·창 모드·읽기 전용 지점 보기.
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollments`, `invoices`, `students`, `users`
- 대상: platform · 권한 키: — · 검증: source-read (`src/components/super-admin/nav.ts`, `src/features/super-admin/server/actions.ts`, `src/features/super-admin/server/laboratory-actions.ts`)
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
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 지점 발급(지점·설정·원장 계정)·AI 모델·지점 보기·계정 역할·실험실 메뉴.
  - 권한: requireSuperAdmin(운영 콘솔 레이아웃 + 액션).
  - 연동: Supabase Auth.
  - 근거: `src/features/super-admin/server/actions.ts:39` · `src/features/super-admin/server/laboratory-actions.ts:16`

### `integrations` 외부 연동(makeedu·구글 시트·오늘 수학·IJW)

- 2.0: **implemented** — makeedu = 연동 PC 앱(AywaSync) 경유, 구글 시트 매일 동기화, 오늘 수학 v2 API·자동 로그인·결과 가져오기, 인재원(IJW) 학습 데이터 pull. 설정 입구 = 학원 설정 > 연동(하위 6).
- 원장 범위: **owner** · 쓰기 경로: reuse-2.0-actions · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`, `enrollment_consultations`, `enrollments`, `lesson_reports`, `students`, `users`
- 대상: master, admin, device · 권한 키: `integrations` `sheet_sync` · 검증: source-read (`src/features/integrations/server/actions.ts`, `src/features/sync-agent/server/actions.ts`)
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
- 원문 검토(읽은 범위: key-actions):
  - 동작: makeedu 동기화 켜기·시트 내보내기 켜기·연동 PC 코드 발급(속도 제한 5)·오늘 수학 메뉴·IJW 자동 매칭.
  - 권한: canWriteTenant(integration_settings) + 모듈 켜짐, 연동 PC는 requireManager.
  - 연동: makeedu·Google Sheets·오늘 수학·IJW.
  - 근거: `src/features/integrations/server/actions.ts:253` · `src/features/sync-agent/server/actions.ts:50`

### `recording-transcription` 녹음·전사 파이프라인

- 2.0: **implemented** — 오디오 업로드 티켓 → AssemblyAI(universal-2) 웹훅 → 상담·회의 분석. 보존 기한 정리·전사 대사 크론.
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `enrollment_consultations`, `student_consultations`
- 대상: master, admin, counselor · 권한 키: — · 검증: source-read (`src/app/api/webhooks/assemblyai/route.ts`, `src/features/media/server/upload-actions.ts`)
- API 3: `/api/cron/reconcile-transcriptions`@0 18 * * * `/api/cron/recordings-retention`@0 17 * * * `/api/webhooks/assemblyai`
- 핵심 동작:
  - 오디오 업로드 티켓 발급 — `issueAudioUploadTicket`
- 서버 액션 전체(동사 갈래): 생성·등록 1 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `consultation_recordings` 41/41, `meeting_minutes` 95/86 (★ = 시안 스냅샷 입력)
- AX: **absent** · 시안 — · AX — · 우선 P2
  - 빠진 것: 처리 실패 표시
  - 제안(issue): 전사·분석 실패를 이슈로
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 오디오 업로드 티켓(종류별 메뉴 권한·확장자·형식 검증) → AssemblyAI 웹훅 → 분석. 멈춘 처리 회수·보존 기간 삭제 크론.
  - 권한: 업로드는 해당 메뉴 full/scoped.
  - 연동: AssemblyAI, Storage.
  - 근거: `src/features/media/server/upload-actions.ts:36` · `src/app/api/webhooks/assemblyai/route.ts:148`
- ⚠️ 불확실: 실행 확인 필요: 웹훅 분석 도우미 본문(약 600줄)은 읽지 않았다

### `shell-infrastructure` 공용 기반(검색·동시편집·메뉴 기록·최대화·내보내기·통계·학교명)

- 2.0: **implemented** — 검색 팰릿(Shift+F)·수정중 표시·메뉴 방문 기록·화면 최대화·엑셀 내보내기 라이브러리·통계 공용·학교 표기. english-assessment 는 외부 import 0건(고아).
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `class_schedules`, `classes`, `enrollment_consultations`, `enrollments`, `student_consultations`, `students`, `users`
- 대상: master, admin, manager, teacher, accountant, counselor, viewer · 권한 키: — · 검증: source-read (`src/app/api/search/palette/route.ts`, `src/features/nav/server/visit-actions.ts`)
- API 2: `/api/search/palette` `/api/usage`
- 핵심 동작:
  - 메뉴 방문 기록·검색 숨김 — `recordMenuVisit`, `saveMenuSearchHidden`
  - 화면 최대화 저장 — `setMyPageMaximized`
  - 검색 팰릿 조회 — API `/api/search/palette`
- 서버 액션 전체(동사 갈래): 수정·처리 3 · 감사로그 없음 · AI 없음 · 알림 발송 없음
- 핵심 표(전체/cs 행): `users` 73/63★ (★ = 시안 스냅샷 입력)
- AX: **simulated** · 시안 — · AX home · 우선 P1
  - 보이는 것: 전체 업무 런처·키보드 검색(시안)
  - 시안 흉내 동작(세션 전용, 근거 live.js·ax.js): `ax:launcher` `ax:chat` `ax:prompt` `ax:ask` `ax:form:chat` `ax:chat-task` `ax:chat-retry` `ax:chat-cancel` `ax:chat-context-clear`
  - 빠진 것: 2.0 팰릿의 권한 반영 검색
  - 제안(command): AX 명령 입력이 2.0 팰릿 검색을 재사용
- 원문 검토(읽은 범위: key-actions, page):
  - 동작: 메뉴 방문 기록(알려진 메뉴 키만)·화면 최대화 저장·검색 팰릿·수정중 표시·내보내기·통계 공용.
  - 권한: 세션.
  - 연동: 없음.
  - 근거: `src/features/nav/server/visit-actions.ts:18` · `src/app/api/search/palette/route.ts:18`
  - 발견: src/features/english-assessment는 모듈 밖 import 0건(고아).

### `demo-tenant` 데모 지점 갱신

- 2.0: **implemented** — 가상 데모 지점만 매일 갱신(slug·명단 태그 확인).
- 원장 범위: **audit-only** · 쓰기 경로: n/a · 이 패밀리 코드가 다루는 표 중 시안 스냅샷(snapshot-tables.mjs)도 읽는 표: `classes`
- 대상: platform · 권한 키: — · 검증: source-read (`src/features/demo-roster/server/actions.ts`)
- API 1: `/api/cron/demo-refresh`@5 21 * * *
- 핵심 동작:
  - 데모 명단 전환 — `switchDemoRoster`
- 서버 액션 전체(동사 갈래): 수정·처리 1 · 감사로그 있음 · AI 없음 · 알림 발송 없음
- AX: **absent** · 시안 — · AX — · 우선 P3
  - 빠진 것: 해당 없음
  - 제안(settings): 제외
- 원문 검토(읽은 범위: key-actions):
  - 동작: 데모 명단 시나리오 전환(원장만)·매일 데모 갱신 크론.
  - 권한: 원장 역할.
  - 연동: 없음.
  - 근거: `src/features/demo-roster/server/actions.ts:16`

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
- 원문 검토(읽은 범위: page):
  - 동작: 개발 환경에서만 proxy가 통과시키는 하네스.
  - 권한: NODE_ENV development.
  - 연동: 없음.
  - 근거: `src/proxy.ts:7`

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

각 핸들러 본문을 읽고 인증 방식·동작·쓰는 곳·외부 연동을 적었다(근거 줄은 feature-inventory.json의 apiRoutes[].semantics.evidence). 실행 시험은 하지 않았다.

| URL | 클래스 | 패밀리 | 메서드 | vercel 일정 | 인증 | 동작 | 외부 | 읽은 범위 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| /api/attendance/checkin | public-submit | attendance | POST | — | device-cookie — 키오스크 기기 쿠키 토큰(sha256)이 활성 kiosk_devices 행과 맞아야 하고, 키오스크 모듈·메뉴가 켜져 있어야 한다. 기기당 분당 20회 제한(메모리). | 출석 코드를 받아 기기 마지막 접속을 갱신하고 processKioskCheckin으로 등·하원 체크인을 처리한다. | — | 핸들러 전체 |
| /api/calendar/google-push | webhook | calendar | POST | — | webhook-channel — 구글 푸시 헤더(channel id·token·resource)를 저장된 동기화 상태와 대조(verifyPushHeaders). 항상 200으로 답한다. | 변경 알림이면 응답 뒤(after) 캘린더 모듈이 켜진 지점만 증분 가져오기를 실행한다. | Google Calendar | 핸들러 전체 |
| /api/classnote/reply-videos | client-fetch | video-homework | GET | — | session+permission — 핸들러는 messageId 형식만 보고, 권한은 getThreadVideoStates 안의 replyGate()와 답글 권한(canReply)이 판정한다 — 없으면 빈 결과. | 학부모 글 스레드에 달린 영상의 재생 가능 상태를 돌려준다(읽기 전용). | — | 핸들러 전체 |
| /api/connected-apps/todays-math/authorize | integration | integrations | GET | — | session+permission — 바인딩·출처 확인 후 로그인 사용자가 같은 지점이고 학생이 아니며, 오늘 수학 쪽 제어 상태에서 연결 가능한 사용자여야 한다. | PKCE 인가 코드를 발급(tm_sync_issue_code)하고 오늘 수학 콜백으로 보낸다. | 오늘 수학 | 핸들러 전체 |
| /api/connected-apps/todays-math/launch | integration | integrations | GET | — | session — 로그인 사용자와 연결 앱 사용 가능 여부(getMyConnectedApps). | 오늘 수학으로 이동 — 활성 바인딩이면 v2 SSO 시작, 아니면 서명 토큰(EYWA_SSO_SECRET)으로 자동 로그인 링크. | 오늘 수학 | 핸들러 전체 |
| /api/cron/apply-due-class-updates | cron | classes | GET | 30 15 * * * | cron-secret — Bearer CRON_SECRET | 기한이 된 시간표 예약(담임·강의실·반 이름·통합뷰 그룹)을 반에 적용하고 감사로그·가져오기 이력을 남긴다. 예약된 반 이름이 막히면 건너뛰고 기록한다. | — | 핸들러 전체 |
| /api/cron/apply-due-withdrawals | cron | withdrawals | GET | 5 15 * * * | cron-secret — Bearer CRON_SECRET | 퇴원일이 된 학생을 퇴원 처리하고 열린 수강을 그날로 닫는다(실패 시 상태 되돌림). 수학 시트에 퇴원을 적고, 기한 된 퇴원보고서도 처리한다. | Google Sheets | 핸들러 전체 |
| /api/cron/apply-timetable-lab | cron | timetable | GET | 0 * * * * | cron-secret — Bearer CRON_SECRET | 반영 시각이 된 시간표 연습본 반영 작업(최대 50건, 45초 예산)을 실행하고 관련 화면을 다시 읽게 한다. | — | 핸들러 전체 |
| /api/cron/close-ended-class-periods | cron | classes | GET | 35 15 * * * | cron-secret — Bearer CRON_SECRET | 운영 기간이 끝난 반의 열린 수강을 RPC로 닫고 감사로그를 남긴 뒤 종강 반 이름을 정리한다. | — | 핸들러 전체 |
| /api/cron/daily-briefing | cron | dashboard | GET | — | cron-secret — Bearer CRON_SECRET | 항상 410(꺼짐)을 돌려준다 — 일일 브리핑 생성은 의도적으로 중지됐다. | — | 핸들러 전체 |
| /api/cron/demo-refresh | cron | demo-tenant | GET | 5 21 * * * | cron-secret — Bearer CRON_SECRET | 가상 데모 지점의 이력과 수학 데이터를 갱신한다. | — | 핸들러 전체 |
| /api/cron/google-calendar-import | cron | calendar | GET | 0 19 * * * | cron-secret — Bearer CRON_SECRET | GOOGLE_CALENDAR_TENANT_ID(없으면 유일한 지점)의 캘린더를 가져온다. 지점이 둘 이상인데 env가 없으면 실패한다. ?full 강제 전체 옵션 있음. | Google Calendar | 핸들러 전체 |
| /api/cron/ijw-memorized-words | cron | integrations | GET | 20 19 * * * | cron-secret — Bearer CRON_SECRET | IJW_TENANT_ID 지점의 오늘 JJ실 명단으로 인재원에서 외운 단어 수를 가져와 시트에 채운다. | 인재원(IJW) | 핸들러 전체 |
| /api/cron/ijw-profile-sync | cron | integrations | GET | 30 19 * * * | cron-secret — Bearer CRON_SECRET | 학생 프로필을 인재원으로 보낸다. | 인재원(IJW) | 핸들러 전체 |
| /api/cron/ment-style-rebuild | cron | onescreen | GET | 0 11 * * 0 | cron-secret — Bearer CRON_SECRET | 활성 원장이 있는 지점마다 강사 멘트 말투 프로파일을 AI로 다시 만들고(100초 예산) 감사로그를 남긴다. | AI(generateJSON) | 핸들러 전체 |
| /api/cron/notification-maintenance | cron | tasks-notifications | GET | 0 22 * * * | cron-secret — Bearer CRON_SECRET | 보호 계정 무결성 점검, 지점별 영상 숙제 대조·이벤트 감지 알림(결석·후속·콜상담 후속·성적·미수)·발송 실패 알림 보정·늦은 할 일 아침 요약, 오래된 알림 정리. | — | 핸들러 전체 |
| /api/cron/reconcile-transcriptions | cron | recording-transcription | GET | 0 18 * * * | cron-secret — Bearer CRON_SECRET | 30분 넘게 전사·분석 중으로 멈춘 회의록·상담 행을 실패로 돌려 다시 실행할 수 있게 한다. | — | 핸들러 전체 |
| /api/cron/recordings-retention | cron | recording-transcription | GET | 0 17 * * * | cron-secret — Bearer CRON_SECRET | 보존 기간이 지난 녹음 원본을 저장소에서 지우고 audio_path를 비운다(테이블당 하루 100건). | — | 핸들러 전체 |
| /api/cron/report-ratings | cron | lesson-reports | GET | */30 * * * * | cron-secret — Bearer CRON_SECRET | 활성 원장이 있는 지점마다 수업보고서 평점(참고용) 정기 처리를 돌린다. | AI(generateJSON) | 핸들러 전체 |
| /api/cron/sheets-sync | cron | integrations | GET | 0 19 * * * | cron-secret — Bearer CRON_SECRET | 구글 시트 연동이 켜진 지점·과목 시트에 시간표를 덮어쓴다 — 라이선스·모듈·첫 수동 반영·리스·사람 편집 감지·빈 시간표 가드를 모두 통과해야 한다. | Google Sheets | 핸들러 전체 |
| /api/cron/slack-dispatch | cron | slack | GET | * * * * * | cron-secret — Bearer CRON_SECRET | 슬랙 아웃박스를 비운다(drainAll) — 실제 슬랙 발송. | Slack | 핸들러 전체 |
| /api/cron/staff-tasks | cron | tasks-notifications | GET | */30 * * * * | cron-secret — Bearer CRON_SECRET | 지점마다 staff_tasks_sync RPC로 할 일을 사실 기준으로 열고 닫는다. | — | 핸들러 전체 |
| /api/cron/student-contribution | cron | student-contribution | GET | 40 15 * * * | cron-secret — Bearer CRON_SECRET | 시범 지점(CONTRIBUTION_PILOT_TENANT) 한 곳만, 실험실 메뉴가 열렸을 때 원생 기여도를 밤마다 집계한다. | — | 핸들러 전체 |
| /api/cron/student-daily-stats | cron | students | GET | 55 14 * * * | cron-secret — Bearer CRON_SECRET | 오늘 날짜로 지점별 원생 매일 기록을 남긴다. | — | 핸들러 전체 |
| /api/cron/teacher-portfolio | cron | class-review | GET | 10 15 * * * | cron-secret — Bearer CRON_SECRET | 직원 평가 모듈·실험실이 열린 지점만 직원 포트폴리오를 재집계하고 마감 달이 생기면 감사로그를 남긴다. | — | 핸들러 전체 |
| /api/cron/todays-math-results | cron | integrations | GET | 7 * * * * | cron-secret — Bearer CRON_SECRET | 오늘 수학 결과를 가져와 반영한다. | 오늘 수학 | 핸들러 전체 |
| /api/cron/todays-math-sync | cron | integrations | GET,POST | * * * * * | cron-secret — GET = Bearer CRON_SECRET, POST = TODAYS_MATH_SYNC_WAKE_SECRET | 오늘 수학 동기화 이벤트를 보낸다(diagnostics=1이면 설정 진단만). | 오늘 수학 | 핸들러 전체 |
| /api/cron/video-homework | cron | video-homework | GET | */30 * * * * | cron-secret — Bearer CRON_SECRET | 지점마다 영상 숙제 제출 상태를 대조하고 연결 안 된 영상 알림을 보낸다. | — | 핸들러 전체 |
| /api/cron/video-review | cron | video-homework | GET | */10 * * * * | cron-secret — Bearer CRON_SECRET | 지점마다 영상 AI 참고 메모 처리를 한 차례 돌린다. | AI(generateJSON) | 핸들러 전체 |
| /api/documents/[id]/file | client-fetch | documents | GET | — | menu-gate — apiAccess("documents") | 서명 URL로 문서 파일을 가져와 그대로 흘려 보낸다(PDF·이미지는 미리보기, 그 밖은 내려받기). | Supabase Storage | 핸들러 전체 |
| /api/enrollment/prior-consults | client-fetch | enrollment | GET | — | session+permission — 로그인 + canAccessTenant(enrollment) | 이름·휴대폰·학교·학년으로 같은 사람의 이전 상담을 찾아 10건까지 돌려준다. | — | 핸들러 전체 |
| /api/exams/excel | export | exams | GET | — | menu-gate — requireAccess("exams") | 선택한 학기·과목·반·시험의 성적 격자를 엑셀로 만든다. | — | 핸들러 전체 |
| /api/exams/unified-export | export | exams | GET | — | menu-gate — requireAccess("exams") | 기간·종류·과목으로 거른 통합 성적 원장을 엑셀로 만든다. | — | 핸들러 전체 |
| /api/excel-import/[kind] | export | owner-settings | GET,POST | — | session+permission — GET은 핸들러가 gateImport, POST는 runImport 안에서 같은 gateImport를 부른다. | GET = 가져오기 서식 엑셀 내려받기, POST = 엑셀 올려 반영(5MB, 결과 파일 또는 JSON). | — | 핸들러 전체 |
| /api/exports/billing | export | billing | GET | — | menu-gate — requireAccess("billing") | 청구월 수납 목록(연체만·makeedu 누락만 거르기 가능)을 엑셀로 만들고 내려받기를 기록한다. | — | 핸들러 전체 |
| /api/exports/classes | export | classes | GET | — | menu-gate — requireAccess("classes") | 필터 그대로 수업목록을 엑셀로 만들고 내려받기를 기록한다. | — | 핸들러 전체 |
| /api/exports/consultations | export | consultations | GET | — | shared-secret — Bearer CONSULT_EXPORT_TOKEN(없으면 503). 세션이 아니다. 지점은 CONSULT_EXPORT_TENANT_ID 또는 유일한 지점. | 외부 반출 API — 원생상담·신규 콜&상담을 이름 가림(maskName·maskText)·가명(pseudonym)으로 내보내고 반출을 기록한다. 전사본은 include=transcript일 때만. | 외부 소비자(토큰 보유자) | 핸들러 전체 |
| /api/exports/expenses | export | billing | GET | — | menu-gate — requireAccess("billing") | 월 지출 목록을 엑셀로 만들고 내려받기를 기록한다. | — | 핸들러 전체 |
| /api/exports/session-terms | export | billing | GET | — | menu-gate — requireAccess("billing") + 회차 정산 모듈이 꺼지면 404 | 회차 확정 표를 필터대로 엑셀로 만든다(자리 몫 조정 포함 가능). | — | 핸들러 전체 |
| /api/exports/students | export | students | GET | — | menu-gate — requireAccess("students") + 강사 범위(applyTeacherScope) | 원생목록을 필터·정렬 그대로 엑셀로 만든다. | — | 핸들러 전체 |
| /api/exports/timetable | export | timetable | GET | — | menu-gate — requireAccess("timetable") + 강사 범위(effectiveTeacherId), 편집 시트는 canManageTimetableImport일 때만 | 수학·영어·통합 시간표를 엑셀로 만든다. | — | 핸들러 전체 |
| /api/homework-videos/[id]/review | client-fetch | video-homework | GET | — | session+permission — reviewAccess(videoId) | 영상의 AI 참고 메모 보기를 돌려준다. | — | 핸들러 전체 |
| /api/homework-videos/[id]/stream | client-fetch | video-homework | GET | — | session+permission — 핸들러는 위임만 — streamHomeworkVideo 안에서 canViewLinkedHomeworkVideo·Range·드라이브 자격을 확인한다. | 숙제 영상을 드라이브에서 범위 요청으로 흘려 보낸다. | Google Drive | 핸들러 전체 |
| /api/integrations/homework-video-drive/callback | integration | video-homework | GET | — | oauth-state — 호스트·state·PKCE 쿠키 + 로그인 + canWriteTenant(integration_settings) + ClassNote 모듈 | 구글 OAuth 콜백 — 시도 기록을 소비하고 지점 숙제 영상 드라이브 연결을 완료한다. | Google OAuth | 핸들러 전체 |
| /api/integrations/homework-video-drive/done | integration | video-homework | GET | — | none — 상태 안내 페이지만 그린다(데이터 없음). | OAuth 결과 안내 페이지. | — | 핸들러 전체 |
| /api/integrations/homework-video-drive/start | integration | video-homework | POST | — | session+permission — 같은 출처(origin·host·sec-fetch-site) + 로그인 + canWriteTenant(integration_settings) + ClassNote 모듈 | OAuth 시도를 만들고 구글 인증 화면으로 보낸다(검증자 쿠키 10분). | Google OAuth | 핸들러 전체 |
| /api/integrations/todays-math/progress | integration | integrations | GET | — | shared-secret — Authorization = TODAYS_MATH_API_KEY, 지점 = TODAYS_MATH_TENANT_ID, 지점 기능 사용 동의(isFeatureOptedIn) | 오늘 수학이 가져가는 진도 페이지(커서)를 돌려준다. | 오늘 수학(소비자) | 핸들러 전체 |
| /api/integrations/todays-math/roster | integration | integrations | GET | — | shared-secret — Authorization = TODAYS_MATH_API_KEY, 지점 = TODAYS_MATH_TENANT_ID, 기능 동의 | 오늘 수학이 가져가는 명단을 돌려준다. | 오늘 수학(소비자) | 핸들러 전체 |
| /api/integrations/todays-math/v2/control | integration | integrations | POST | — | signed-sync — authenticateSyncRequest(control) + 바인딩 일치 | 연동 제어 상태(사용자 연결 가능 여부 등)를 돌려준다. | 오늘 수학 | 핸들러 전체 |
| /api/integrations/todays-math/v2/menus-changed | integration | integrations | POST | — | signed-sync — authenticateSyncRequest(control) + 바인딩 + 기능 동의 | 오늘 수학 쪽 사용 메뉴 변경을 받아 감사로그로 남긴다(eventId로 중복 제거). | 오늘 수학 | 핸들러 전체 |
| /api/integrations/todays-math/v2/results-wake | integration | integrations | POST | — | signed-sync — authenticateSyncRequest(control) + 바인딩 + 기능 동의 | 결과 동기화 신호를 받으면 응답 뒤 결과·보고서 첨부 동기화를 돌린다. | 오늘 수학 | 핸들러 전체 |
| /api/integrations/todays-math/v2/snapshots | integration | integrations | POST | — | signed-sync — authenticateSyncRequest(control) + 바인딩 | 원본 스냅샷을 새로 만든다. | 오늘 수학 | 핸들러 전체 |
| /api/integrations/todays-math/v2/snapshots/[snapshotId] | integration | integrations | GET | — | signed-sync — authenticateSyncRequest(control) + 바인딩 | 원본 스냅샷의 한 페이지를 돌려준다. | 오늘 수학 | 핸들러 전체 |
| /api/integrations/todays-math/v2/token | integration | integrations | POST | — | signed-sync — authenticateSyncRequest(sso) + 인가 코드·PKCE 교환 + 연결 가능 사용자 | 인가 코드를 교환해 오늘 수학용 서명 어서션(이메일·이름 포함)을 돌려준다. | 오늘 수학 | 핸들러 전체 |
| /api/internal/class-notice-attachments/[noticeId] | worker-internal | lesson-reports | GET | — | internal-worker — x-eywa-internal 헤더(authorizeInternalWorker) + 지점 일치 | 연동 PC가 반 공지 첨부 이미지의 서명 URL을 받아 간다. | 연동 PC(소비자) | 핸들러 전체 |
| /api/internal/notice-attachments/[noticeId] | worker-internal | lesson-reports | GET | — | internal-worker — x-eywa-internal 헤더 + 지점 일치 | 연동 PC가 공지(공통·대상별) 첨부 서명 URL을 받아 간다. | 연동 PC(소비자) | 핸들러 전체 |
| /api/internal/parent-messages/classify | worker-internal | lesson-reports | POST | — | internal-worker — x-eywa-internal 헤더 | 대기 중인 학부모 글을 AI로 분류하고 만족도 판정을 돌린다. | AI(generateJSON) | 핸들러 전체 |
| /api/internal/parent-messages/jev-shadow | worker-internal | lesson-reports | POST | — | shared-secret — x-eywa-internal = CLASSNOTE_INTERNAL_SECRET | TypeSafe Jev와 기존 출결 판정을 비교만 한다(기존 판정은 바꾸지 않음). | TypeSafe Jev | 핸들러 전체 |
| /api/internal/report-attachments/[reportId] | worker-internal | lesson-reports | GET | — | internal-worker — x-eywa-internal 헤더 + 지점 일치 | 연동 PC가 보고서의 이미지가 아닌 첨부 파일 서명 URL을 받아 간다. | 연동 PC(소비자) | 핸들러 전체 |
| /api/internal/video-drive-token | worker-internal | video-homework | POST | — | internal-worker — x-eywa-internal 헤더 + ClassNote 모듈 + 3분 안에 살아 있는 연동 PC(postMode·기능 플래그) | 지점 숙제 영상 드라이브 OAuth 액세스 토큰을 짧게 발급한다. | Google Drive | 핸들러 전체 |
| /api/internal/video-review/upload | worker-internal | video-homework | POST | — | internal-worker — x-eywa-internal 헤더 + video_review 기능 동의 + 작업 잠금(10분) | 영상 검토 추출 산출물의 서명 업로드 URL을 만든다. | — | 핸들러 전체 |
| /api/internal/video-submit-link | worker-internal | video-homework | POST | — | internal-worker — x-eywa-internal 헤더 + 보고서 지점 일치 | 보고서 글에 붙일 영상 올리기 사이트 줄을 돌려준다(학생별 토큰은 없음). | — | 핸들러 전체 |
| /api/inventory/excel | export | inventory | GET | — | menu-gate — requireAccess("inventory") | 자산·소모품·분류를 엑셀로 만든다. | — | 핸들러 전체 |
| /api/inventory/qr/[code] | client-fetch | inventory | GET | — | menu-gate — requireAccess("inventory") | 자산 공개 페이지로 가는 QR SVG를 만든다. | — | 핸들러 전체 |
| /api/notice-popups | client-fetch | owner-settings | GET | — | session — 로그인 사용자 | 지금 보여야 할 팝업 공지를 역할·지점 기준으로 돌려준다. | — | 핸들러 전체 |
| /api/notifications | client-fetch | tasks-notifications | GET | — | session — 핸들러는 위임 — getMyNotifications가 로그인·지점 보기 상태를 확인한다(없으면 빈 목록). | 내 알림(활성·보관)을 돌려준다. | — | 핸들러 전체 |
| /api/push | client-fetch | tasks-notifications | DELETE,GET,POST | — | session — 로그인 + 출결 알림 수신 동의(attendance_alert_optin) | GET 구독 상태, POST 웹 푸시 구독 저장(다른 사용자 것이면 같은 지점일 때만 옮김), DELETE 구독 해제. | Web Push | 핸들러 전체 |
| /api/search/palette | client-fetch | shell-infrastructure | GET | — | session — 로그인 사용자(역할로 결과 범위) | 검색 팰릿 결과(두 글자 이상). | — | 핸들러 전체 |
| /api/staff-tasks | client-fetch | tasks-notifications | GET | — | session+permission — getStaffTaskViewer, scope=all은 canMonitor만 | 내 할 일 또는 전체 할 일 목록(필터·종류·페이지). | — | 핸들러 전체 |
| /api/staff-tasks/[id] | client-fetch | tasks-notifications | GET | — | session+permission — getStaffTaskViewer + 본인 또는 업무 처리 현황 권한(canMonitor) | 할 일 상세. | — | 핸들러 전체 |
| /api/students/[id]/summary | client-fetch | students | GET | — | menu-gate — apiAccess("students") | 학생 요약(호버 카드 등). | — | 핸들러 전체 |
| /api/sync-agent/[action] | worker-internal | integrations | POST | — | sync-agent-device — 연동 PC 기기 인증(authenticate) | 연동 PC 동작: configuration·acquire·heartbeat·release·events·cutover·schedule·unlock·module-start·module-stop. | 연동 PC(AywaSync) | 핸들러 전체 |
| /api/sync-agent/latest | worker-internal | integrations | POST | — | sync-agent-device — 연동 PC 기기 인증 | 폐기되지 않은 최신 서명 배포본 정보를 돌려준다. | 연동 PC(AywaSync) | 핸들러 전체 |
| /api/sync-agent/operation | worker-internal | integrations | POST | — | sync-agent-device — 연동 PC 기기 인증 | 연동 PC가 보낸 작업(2MB까지)을 실행한다. | makeedu(연동 PC 경유) | 핸들러 전체 |
| /api/sync-agent/pair | worker-internal | integrations | POST | — | public-token — 기기 인증 전 단계 — 본문의 일회용 연결 코드로 짝짓는다(IP 기록). | 연동 PC를 지점에 연결한다. | 연동 PC(AywaSync) | 핸들러 전체 |
| /api/sync-agent/query | worker-internal | integrations | POST | — | sync-agent-device — 연동 PC 기기 인증 | 연동 PC가 보낸 조회(2MB까지)를 실행한다. | 연동 PC(AywaSync) | 핸들러 전체 |
| /api/timetable/cell-memos | client-fetch | timetable | GET | — | session+permission — 로그인 + memoSheetAccess.canView | 주간 영어 강사뷰 칸 메모를 돌려준다. | — | 핸들러 전체 |
| /api/timetable/end-scope | client-fetch | timetable | GET | — | session+permission — 로그인 + canManageStudentStatusNow(아니면 null) | 수강 종료 범위(같은 과목 다른 반 등)를 계산해 돌려준다. | — | 핸들러 전체 |
| /api/timetable/lab/drafts | client-fetch | timetable | GET,POST | — | session+permission — draftUser() | GET 연습본 목록, POST 연습본 저장(같은 지점 원본만) + 감사로그. | — | 핸들러 전체 |
| /api/timetable/lab/drafts/[id] | client-fetch | timetable | GET | — | session+permission — draftUser() | 시간표 연습본 하나를 읽는다. | — | 핸들러 전체 |
| /api/timetable/lab/source | client-fetch | timetable | GET | — | session+permission — 로그인 + canUseTimetableEditor | 편집기가 불러올 기준일 주의 운영 시간표를 읽는다. | — | 핸들러 전체 |
| /api/timetable/student-busy | client-fetch | timetable | GET | — | session+permission — 로그인 + canManageTenant(classes)(아니면 빈 결과) | 학생의 주간 다른 수업 시간(드래그 막기 표시용). | — | 핸들러 전체 |
| /api/usage | client-fetch | shell-infrastructure | POST | — | session — 로그인 사용자(없으면 204), 읽기 전용 지점 보기는 기록 안 함 | 화면 이용 시간 비콘을 기록한다. | — | 핸들러 전체 |
| /api/video-submit/complete | public-submit | video-homework | POST | — | public-token — 제출 링크 토큰 + 업로드 id | 업로드 완료를 확정하고 응답 뒤 후속 처리(afterLinkUpload)를 한다. | Google Drive | 핸들러 전체 |
| /api/video-submit/event | public-submit | video-homework | POST | — | public-token — 같은 출처(uploadOrigin) + 4KB 상한 + 토큰 | 업로드 진행 이벤트를 기록한다. | — | 핸들러 전체 |
| /api/video-submit/site | public-submit | video-homework | POST | — | public-rate-limited — 휴대폰 뒷 4자리 + 이름, IP 기준 횟수 제한(초과 429) | /v 올리기 사이트 — 숙제 찾기(lookupSite)와 제출 링크 열기(openSiteLink). | — | 핸들러 전체 |
| /api/video-submit/start | public-submit | video-homework | POST | — | public-token — 제출 링크 토큰 + 출처·호스트(startLinkUpload 안) | 업로드를 시작하고 응답 뒤 후속 처리. | Google Drive | 핸들러 전체 |
| /api/webhooks/assemblyai | webhook | recording-transcription | POST | — | shared-secret — x-eywa-webhook-secret = ASSEMBLYAI_WEBHOOK_SECRET(timingSafeEqual) | transcript_id로 회의록·상담 녹음·신규 콜&상담(·원생상담)을 찾아 완료/진행 중이면 건너뛰고, 아니면 응답 뒤 270초 예산으로 분석한다(실패 시 행을 실패로). | AssemblyAI, AI(generateJSON) | 부분: 1,013줄 중 인증·라우팅·백그라운드 처리 골격(코드 약 250줄)만 읽었다. 분석 도우미(handleMeeting·handleConsultationRecording·recoverConsultationAnalysis 등) 본문은 읽지 않았다. |
| /home | auth-redirect | auth-session | GET | — | session — 세션이 없으면 학부모 → /parent, 퇴사 계정 → 로그아웃, 운영 계정 → 운영 콘솔, 그 밖은 /login | 역할·과목에 맞는 홈으로 보내는 서버 리다이렉터. 방금 로그인했으면 로그인 기록을 남긴다. | — | 핸들러 전체 |
| /tenant-view/exit | auth-redirect | auth-session | GET | — | session — 읽기 전용 지점 보기 쿠키 | 지점 보기를 끝내고 운영 콘솔의 학원 상세로 돌아간다. | — | 핸들러 전체 |
| /tenant-view/sync | auth-redirect | auth-session | GET | — | session — 읽기 전용 지점 보기 상태 | 보기 상태를 맞춘다 — 살아 있으면 /home, 아니면 보기를 닫는다. | — | 핸들러 전체 |
| /view-reset | auth-redirect | auth-session | GET | — | none — 세션·권한을 보지 않는 비상 출구(쿠키만 지운다) | 강사뷰·다른 강사 보기 쿠키를 지우고 /home으로. | — | 핸들러 전체 |

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
- `calendar` CLAUDE.md 결정 로그는 구글 → aywa 전체 동기화를 "하루 2회 안전망"이라 적지만 vercel.json에는 google-calendar-import 일정이 하루 1회뿐 — 다른 트리거가 있는지 미확인
- `calendar` 실행 확인 필요: 결정 로그의 "하루 2회 전체 동기화"를 만드는 두 번째 트리거가 무엇인지(크론은 하루 1회, ?full 강제 옵션만 있음)
- `makeups` 실행 확인 필요: 침산 복사본의 makeup_cases가 0행이다 — 이 지점에서 새 보강관리 운영 모드가 아직 꺼져 있는지(학원 설정 > 보강 운영) 실행 상태 확인 필요
- `retention` 실행 확인 필요: reenrollment_campaign_targets가 침산 복사본에서 0행 — 캠페인 기능을 실제로 쓰는지
- `payroll` 실행 확인 필요: payroll_records가 침산 복사본에서 0행 — 급여 기능이 genericFeatureDisabled("payroll")로 꺼져 있는지(명세서 7건은 payslips 표)
- `shuttle` 실행 확인 필요: parent_accounts가 침산 복사본에서 0행 — 학부모 포털을 실제로 발급해 쓰는지
- `help` 실행 확인 필요: help_posts가 침산 복사본에서 0행 — 질문 게시판 사용 여부
- `recording-transcription` 실행 확인 필요: 웹훅 분석 도우미 본문(약 600줄)은 읽지 않았다

원문을 읽어 해소한 것:
- `dashboard` daily-briefing 일정 없음은 의도된 중지 — 크론 핸들러는 410(DAILY_BRIEFING_DISABLED_MESSAGE)을 돌려주고 재생성 액션도 DAILY_BRIEFING_ENABLED로 막는다(원문 확인)
- `tasks-notifications` 확인된 부재: AX "요청한 업무"(원장→담당자 지시·완료 보고)를 저장할 2.0 테이블이 없다 — staff/notion 연동 할 일(createStaffTask)이 가장 가깝지만 Notion 매핑 전용이다
- `timetable` 편집기 머리 주석의 "운영 반영 경로 없음"은 낡았다 — queueTimetableLabApply와 매시 apply-timetable-lab 크론(runApplyJob)이 실제로 반영한다(원문 확인)
- `timetable` 사실 확인: /timetable/english-sheet page.tsx는 침산 tenant id를 직접 비교해 그 지점에만 원본 시트 링크를 보인다
- `class-sheets` /ecs/[classId]/month · /mcs/[classId]/month · /ecs/[classId]/month-plan/print 의 게이트는 조회 함수 안(requireEcsClassAccess · requireMcsClassAccess · getMonthPlanPrint) — 원문 확인
- `attendance` /attendance/units-master 게이트 = loadUnitsMaster 안 requireAccess("attendance")(units-master.ts:39), 입구 = 월별 출석부의 UnitsMasterButton(canViewUnitsMaster) — 원문 확인
- `student-contribution` /student-contribution 하위 페이지는 기능 모듈 뷰를 재-export하고 뷰가 게이트를 건다(settings-view.tsx:6 gate.canConfigure, referral-view getContributionGate, list/ontology 데이터 없음 → redirect) — 원문 확인
- `expense-requests` 작성 경로 확인: billing createExpense(expense-actions.ts:164, expenseWriteScope)가 강사 작성분을 저장하고 /expense-requests를 갱신한다
- `approvals` 기안 화면 머리 주석(approvals/new/page.tsx:18)의 "업무연락"은 낡았다 — 원장 확정 양식은 types.ts:11의 휴가·품의·지출·수입 4종

불확실성 — 자동 감지(원문 확인 전):
- `src/features/english-assessment` (shell-infrastructure) — src 전체에서 모듈 밖 import가 0건(테스트 제외) — 사용처 없는 모듈일 수 있다

불확실성 — 일부만 읽은 API 본문:
- `/api/webhooks/assemblyai` (recording-transcription) — 1,013줄 중 인증·라우팅·백그라운드 처리 골격(코드 약 250줄)만 읽었다. 분석 도우미(handleMeeting·handleConsultationRecording·recoverConsultationAnalysis 등) 본문은 읽지 않았다.

메모:
- 크론 핸들러 /api/cron/daily-briefing는 vercel.json 일정이 없다(수동/중지)
- 코드가 .from("homework_video_ledger_videos")로 읽지만 복사본 public 스키마에 없는 이름(뷰·다른 스키마·오래된 코드 가능)
- 코드가 .from("shuttle_vehicle_positions")로 읽지만 복사본 public 스키마에 없는 이름(뷰·다른 스키마·오래된 코드 가능)

## 12. 검증

```
node experiments/owner-concept/catalog/scan-source.mjs        # 소스 스캔(읽기 전용)
node experiments/owner-concept/catalog/db-availability.mjs    # 로컬 복사본 행 수(읽기 전용 트랜잭션)
node experiments/owner-concept/catalog/build-inventory.mjs    # 인벤토리·이 문서 생성(문제 1건이라도 있으면 실패)
node experiments/owner-concept/catalog/verify-catalog.mjs     # 소스 ↔ 인벤토리 집합 대조 + 근거 앵커 + 문서 해시
node experiments/owner-concept/catalog/build-workspace-catalog.mjs   # 3.0 카탈로그 생성(문제 1건이라도 있으면 실패)
node experiments/owner-concept/verify-workspace-catalog.mjs          # 카탈로그 재생성 일치·스키마·커버리지·선택지·문구·정적 서빙
```

검증기가 실패하는 조건: 새 페이지·API·크론·모듈·액션 파일·메뉴 키·내비 항목이 인벤토리에 없거나, 인벤토리에만 있는 낡은 항목이 있거나, 핵심 동작의 함수가 사라졌거나, 시안 화면·AX 화면이 어느 패밀리와도 이어지지 않았거나, 이 문서가 인벤토리와 다른 해시를 들고 있을 때. 결과는 `coverage-report.json`.

## 13. 3.0 원장 작업 공간 카탈로그(window.AxCatalog)

생성물 `experiments/owner-concept/workspace-catalog.js`(같은 데이터 `catalog/workspace-catalog.json`) · 생성기 `catalog/build-workspace-catalog.mjs` · 검증기 `verify-workspace-catalog.mjs`.

- 영역 41(= 원장 표시 패밀리) · facet 198 · 동작 148(navigate 31 · preview 72 · request 45) · 원장 표시 핵심 동작 177/177에 목적지 · 실제 쓰기 연결 0.
- 수치 구분: 원문 검토(source-audited) = 패밀리 47·API 92 / 런타임 미리보기(runtime-previews) = 동작 148(전부 로컬, liveWrite:false) / 실제 운영 연결(production-linked) = 0.
- facet은 2.0 화면의 실제 탭·면·결재함·단계를 원문 근거(라우트 또는 파일 안 문자열)로 확인했고, 필드 선택지는 2.0 열거값을 TS AST로 그대로 읽는다(catalog/option-sources.mjs).

| 영역 | 그룹 | 보기 | facet | 동작(이동/미리보기/요청) |
| --- | --- | --- | --- | --- |
| dashboard 대시보드 | 홈 | report | 상단 지표 · 출결·수업 · 학생·재원 · 상담·신입 · 수납·지출 · 학원 운영 · 학원 공지 | 2/2/0 |
| calendar 캘린더 | 홈 | timeline | 월 · 일정 태그 | 0/2/0 |
| tasks-notifications 할 일·알림 | 홈 | flow | 열린 일 · 늦음 · 끝난 일 · 알림함 | 1/1/1 |
| onescreen 선생님 원스크린 | 수업 | sheet | 수업보고서 · 영상 제출 현황 · 학부모 공지 | 0/3/2 |
| video-homework 영상 숙제 | 수업 | records | 영상 제출 현황 · 선생님별 장부 · 숙제 영상 올리기 | 1/1/2 |
| timetable 시간표 | 수업 | sheet | 시간표 · 시간표 편집기 · 영어 시트 반영 | 1/2/1 |
| class-sheets 강사 시트 | 수업 | sheet | 영어 · 월간 · 반 계획 보기 · 계획 대비 현황 · 수학 · 선생님별 · 수학 학습 진도맵 | 1/2/1 |
| attendance 출석부 | 수업 | sheet | 월별 출석부 · 오늘 출결 · 출결 모드 · 날짜별 입력 · 랩실·JJ실 출석부 · 출결 통계 · 시수 마스터 · 키오스크 설정 | 2/4/1 |
| classes 수업목록 | 수업 | records | 수업목록 · 반 상세 · 새 반 | 1/3/2 |
| makeups 보강관리 | 수업 | flow | 보강관리 · 미연결 근거 · 도입 사전 점검 · 대사·복구 | 1/2/1 |
| textbooks 교재목록 | 수업 | records | 교재 · 반 배정 | 0/2/1 |
| lesson-reports 수업보고서 | 수업 | report | 작성률 · 목록 · 발송 큐 · 반 구성 · 반 공지 · 직접 발송 · 회수 · 학부모 글·답글 · 보고서 설정 · AI 멘트 · 보고서 통계 | 2/3/2 |
| class-review 직원 평가 | 수업 | report | 직원 평가 · 직원 포트폴리오 · 직원 평가 종합 · 문항 편집 | 2/0/1 |
| students 원생목록 | 원생 | records | 원생목록 · 원생 통계 · 개요 · 수업 · 성적 · SRS · 오늘 수학 · 진도 · 숙제 영상 · 출결 · 상담 · 특이사항 · 수납 · 기여도 · 타임라인 | 1/4/2 |
| student-contribution 원생 기여도 | 원생 | records | 원생 기여도 · 학생 기록의 연결 · 지난 소개 확인 · 기여도 배점 설정 | 2/2/0 |
| exams 성적관리 | 원생 | sheet | 통합 성적관리 · 성적 입력 · 성적 확인 · JJ실 시험 결과 | 1/1/2 |
| consultations 원생상담 | 원생 | records | 원생상담 · 상담 통계 · 새 원생상담 | 0/2/1 |
| enrollment 신규 콜&상담 | 원생 | flow | 대기 · 예약 · 상담완료 · 재원생 등록 완료 · 거절 · 노쇼 · QR 상담 접수 | 2/3/2 |
| retention 이탈 방어 | 원생 | flow | 브리핑 · 리텐션 보드 · 학부모 메시지 · 재등록 캠페인 | 1/1/1 |
| newcomers 신규생 관리 | 원생 | flow | 수업 전 사전 콜 · 첫 수업 안내 · OJT · 첫 수업 후 콜 · 1개월 콜 · 신규생 기록 | 0/1/1 |
| withdrawals 퇴원관리 | 원생 | flow | 퇴원관리 · 퇴원 상세 | 0/1/1 |
| withdrawal-reports 퇴원보고서 | 원생 | flow | 퇴원보고서 · 보고서 · 스프레드시트 기록 | 0/2/1 |
| staff 직원관리 | 운영 | records | 직원 목록 · 직원 상세 · 휴가 관리 · 연차 관리 · 월별 급여 | 1/1/3 |
| payroll 급여·명세서 | 운영 | report | 급여명세서 · 강사 정산 · 월별 급여 | 0/2/0 |
| billing 수납관리 | 운영 | report | 수납 · 교재 · 지출 · 수강료 계산기 · 회차 확정 · 환불 요청서 · 강사 정산 · 수납 통계 · 수강료 단가 · 교재 단가표 · 공휴일 · 저장된 청구서 | 1/5/1 |
| textbook-requests 교재 요청 | 운영 | flow | 교재 요청 · 교재 요청서 | 1/1/1 |
| expense-requests 지출결의서 | 운영 | records | 지출결의서 · 지출결의서 상세 | 0/0/1 |
| shuttle 셔틀 | 운영 | timeline | 노선 편성 · 주간 시간표 · 오늘 등하원 · 학부모 등하원 · 운행 현황 · 실시간 위치 · 학부모 관리 현황 | 1/3/1 |
| inventory 재고관리 | 운영 | records | 자산 · 대여 · 실사 · 소모품 · 업체리스트 · 자산 QR 라벨 | 0/3/1 |
| meetings 회의록 | 운영 | timeline | 회의록 · 새 회의록 · 회의록 상세 | 0/1/2 |
| approvals 전자결재 | 운영 | flow | 전체 · 결재 대기 · 결재 예정 · 진행 · 완료 · 반려·회수 · 참조 · 학원 전체 진행 | 1/2/0 |
| documents 데이터베이스 | 운영 | records | 데이터베이스 · 문서 상세 · 문서 미리보기 | 1/0/2 |
| support 고객센터 | 지원 | records | 공지사항 · 개선요청 | 0/2/0 |
| owner-settings 학원 설정 | 지원 | settings | 프로필·브랜드 · 운영 체계 · 과목 운영 · 보강 운영 · 강사평가 · 원생 기여도 · 수납·청구 · 알림·약관 · 상담 양식 · 역할·권한 · 탭 및 메뉴 구성 · 기능 · 대시보드 관리 · 팝업 공지 · 데이터 정리 · 데이터 가져오기 · 감사로그 · 연동 | 1/3/2 |
| help 도움말 | 지원 | records | 도움말 · 아이콘 시스템 · 도움말 질문 | 0/1/0 |
| slack 슬랙 연동 | 연동·자동화 | settings | 규칙 · 슬랙 연결 | 1/1/1 |
| integrations 외부 연동 | 연동·자동화 | settings | makeedu 동기화 · 구글 시트 · 숙제영상 드라이브 · 연동 PC · 오늘 수학 | 0/1/2 |
| teacher-workspace 강사 화면 | 역할별 화면 | records | 내 정보 · 선생님 원스크린 | 0/1/1 |
| parent-portal 학부모 화면 | 역할별 화면 | timeline | 실시간 차량 · 등하원 시간 변경·확인 · 수업 시간표 | 0/1/1 |
| student-portal 학생 화면 | 역할별 화면 | report | 내 학습 현황 · 데일리 리포트 | 1/0/0 |
| public-sites 학원 공개 페이지 | 역할별 화면 | report | 학원 공개 페이지 | 1/0/0 |

### 13.1 워크플로·쓰기 공백 — 목적지가 있다고 완성이 아니다

- 카탈로그 177/177은 "원장이 그 일로 갈 곳이 있다"는 뜻이지 "3.0에서 그 일을 할 수 있다"는 뜻이 아니다. 미리보기(preview)는 입력 모양·2.0 선택지·근거를 보여 주는 로컬 화면이고, 요청(request)은 사람에게 보내는 원장 요청 초안이다. 둘 다 2.0의 상태 전이(결재 순서, 퇴원 처리 트랜잭션, 청구·배분 재확정, 발송 큐, 사실 기반 할 일 종료)를 실행하지 않는다.
- 2.0 쓰기 동작(쓰기가 있는 액션 파일의 조회 아닌 export): 전체 511개 · 원장 표시 패밀리 500개. 이 중 3.0 시안에서 2.0 기록(원본·복사본 DB)까지 가는 것 **0개**(로컬 오버레이 저장은 별개이며 2.0 쓰기를 대신하지 않는다).
- 원장 표시 패밀리 41개의 지금 시안 수준: 세션 흉내(저장 안 됨) 10 · 읽기 전용 20 · 없음 11. 카탈로그는 이 수준을 올리지 않는다(화면 목적지를 줄 뿐).
- 3.0의 다음 층(이벤트 → 규칙 → 케이스·단계 → 역할 수신함 → 근거 보고 → 다음 이벤트)이 메워야 할 것은 아래 "남은 워크플로" 열이다. 사실 기반으로 닫히는 2.0 할 일은 3.0이 대신 닫지 않는다.

| 패밀리 | 2.0 쓰기 동작(파일) | 알림·AI·감사 | 지금 시안 | 3.0 목적지(이동/미리보기/요청) | 3.0 실제 쓰기 | 남은 워크플로 |
| --- | --- | --- | --- | --- | --- | --- |
| dashboard 대시보드(운영실) | 6(2) | 감사 | 세션 흉내(저장 안 됨) | 2/2/0 | 0 | 위젯 카탈로그 36종(카드 27 + KPI 9)·역할별 배치·과목 커팅·학원 공지·통계 상세 화면(/students/stats 등)으로의 드릴다운 |
| calendar 캘린더 | 4(1) | 감사 | 세션 흉내(저장 안 됨) | 0/2/0 | 0 | 실제 일정 저장·태그·구글 동기화 상태 |
| tasks-notifications 할 일·알림(벨·푸시) | 5(1) | — | 세션 흉내(저장 안 됨) | 1/1/1 | 0 | notifications 미연결(2.0 유니언 39종, cs 31종 11,534행 — 벨·푸시·보관함) · 할 일 쓰기 없음(2.0 할 일은 사실 기반 자동 종료라 버튼 완료가 없다 — 시안 complete-task는 의미가 다르다) · 할 일 종류: 2.0 코드 11종 중 시안 라벨 맵(live.js taskKind)에 없는 5종 = report_send_failed·followup_due·progress_anomaly·approval_turn·help_question, 시안의 owner_review는 2.0 종류가 아니다, cs 데이터에 있는 종류는 6종(모두 시안 맵에 있음) · 원장→담당자 요청 저장 테이블 없음 |
| slack 슬랙 연동 | 9(3) | 감사 | 세션 흉내(저장 안 됨) | 1/1/1 | 0 | 실제 규칙 편집(무엇을·어디로·어떻게·언제), 사람 연결, 실패 재발송, 발송 이력 |
| onescreen 선생님 원스크린(수업 마감) | 24(8) | 감사 | 읽기 전용 | 0/3/2 | 0 | 강사의 수업 마감 흐름 전체(원장 작업 공간 밖이지만 요청의 목적지) |
| video-homework 영상 숙제(제출 사이트·장부·AI 검토) | 5(5) | 감사 | 읽기 전용 | 1/1/2 | 0 | 미배정 영상·미제출·반려 흐름, AI 검토 메모 |
| timetable 시간표(배치·가져오기·편집기·메모) | 17(8) | 감사 | 읽기 전용 | 1/2/1 | 0 | 배치 편집·가져오기·충돌 판정·메모·연습본 |
| class-sheets 강사 시트(영어 ECS·수학 MCS) | 32(6) | 감사 | 읽기 전용 | 1/2/1 | 0 | 시트 작성 현황·계획 대비 차이·목표 |
| attendance 출석부(월별·오늘·출결 모드·자리·키오스크) | 36(15) | 알림·감사 | 읽기 전용 | 2/4/1 | 0 | 출결 입력·데스크 확인 큐·미입력 판정·자리/키오스크·통계 추이 |
| classes 수업목록(반·수강·인수인계) | 21(6) | 알림·감사 | 읽기 전용 | 1/3/2 | 0 | 반·수강 편집, 인수인계·위임 |
| makeups 보강관리 | 2(1) | 감사 | 읽기 전용 | 1/2/1 | 0 | 보강 사례(미처리 분·기한)·명령 |
| textbooks 교재목록(커리큘럼·반 배정) | 17(8) | 감사 | 없음 | 0/2/1 | 0 | 커리큘럼 마스터·반 배정 전부(시안의 "교재"는 주문 흐름뿐) |
| lesson-reports 수업보고서·ClassNote 발송 | 20(9) | 감사 | 세션 흉내(저장 안 됨) | 2/3/2 | 0 | 발송 큐·실패 재시도·회수·반 보드 동기화·실제 답글 발송·평점 |
| class-review 직원 평가·직원 포트폴리오 | 12(3) | 감사 | 없음 | 2/0/1 | 0 | 평가·포트폴리오 전부 |
| students 원생목록·원생 상세·원생 통계 | 25(3) | 감사 | 세션 흉내(저장 안 됨) | 1/4/2 | 0 | 상세 탭 중 SRS·오늘 수학·숙제 영상·기여도·타임라인·형제, 상태 전환·수강 편집 |
| student-contribution 원생 기여도(온톨로지·소개) | 4(2) | 감사 | 읽기 전용 | 2/2/0 | 0 | 기여도·온톨로지·소개 |
| exams 성적관리(통합·입력·확인·JJ실) | 2(2) | 감사 | 읽기 전용 | 1/1/2 | 0 | 입력·응시율·성적 급락(알림 grade_drop) |
| consultations 원생상담(재원생 상담·AI 분석) | 7(2) | 감사 | 읽기 전용 | 0/2/1 | 0 | 상담 작성·AI 분석·통계 |
| enrollment 신규 콜&상담(QR 접수·브리프·인수인계) | 16(5) | 감사 | 세션 흉내(저장 안 됨) | 2/3/2 | 0 | 실제 저장·후속 조치 필수 규칙·QR·AI 분석·브리프·병합·관리현황 |
| retention 이탈 방어 | 4(1) | 감사 | 읽기 전용 | 1/1/1 | 0 | 위험 판정 로스터·캠페인·메시지 조치 |
| newcomers 신규생 관리(90일 체크리스트) | 1(1) | 감사 | 없음 | 0/1/1 | 0 | 체크리스트 전부 — 시안 스냅샷에는 student_onboarding_checks 표가 들어 있으나 화면이 없다 |
| withdrawals 퇴원관리 | 3(1) | 감사 | 읽기 전용 | 0/1/1 | 0 | 사유 분석·추이·3개월 내 퇴원·퇴원 상세 |
| withdrawal-reports 퇴원보고서(작성·순차 승인·옛 시트) | 4(2) | 감사 | 읽기 전용 | 0/2/1 | 0 | 보고서 작성·승인 흐름 |
| staff 직원관리(명부·계약·이력서·휴가·연차) | 28(10) | 알림·감사 | 읽기 전용 | 1/1/3 | 0 | 등록·계약·휴가·연차·권한 |
| payroll 급여·명세서·강사 정산 | 11(4) | 감사 | 읽기 전용 | 0/2/0 | 0 | 계산·발급·조정 |
| billing 수납관리(청구·교재·지출·계산기·회차 확정·환불·정산) | 52(19) | 감사 | 세션 흉내(저장 안 됨) | 1/5/1 | 0 | 청구 생성·회차 확정·배분·환불·지출 결재·견적 |
| textbook-requests 교재 요청(강사) | 0(0) | — | 읽기 전용 | 1/1/1 | 0 | 요청 작성·안내 발송 |
| expense-requests 지출결의서(강사 제출) | 0(0) | — | 읽기 전용 | 0/0/1 | 0 | 강사 제출 흐름 |
| shuttle 셔틀(노선 편성·주간·오늘·학부모 등하원·운행 현황·위치) | 30(7) | 감사 | 읽기 전용 | 1/3/1 | 0 | 편성·탑승 기록·학부모 변경 확인 |
| inventory 재고관리(자산·대여·실사·소모품·업체) | 21(7) | 감사 | 읽기 전용 | 0/3/1 | 0 | 대여·실사·업체·편집 |
| meetings 회의록(녹음·AI 분석) | 9(1) | 감사 | 없음 | 0/1/2 | 0 | 회의록 전부 |
| approvals 전자결재(기안·결재함) | 11(1) | 알림·감사 | 세션 흉내(저장 안 됨) | 1/2/0 | 0 | 실제 결재·기안·결재선 |
| documents 데이터베이스(서식·문서 저장소) | 15(4) | 감사 | 읽기 전용 | 1/0/2 | 0 | 폴더 편집·업로드 |
| support 고객센터(공지·개선요청) | 5(2) | 감사 | 없음 | 0/2/0 | 0 | 고객센터 전부 |
| owner-settings 학원 설정(18면)·관리자 도구 | 24(8) | 감사 | 세션 흉내(저장 안 됨) | 1/3/2 | 0 | 18면 전부(권한·메뉴·운영 체계·청구·알림·대시보드 배치·연동·데이터 정리·감사로그) |
| help 도움말(설명서·질문 게시판) | 5(1) | 감사 | 없음 | 0/1/0 | 0 | 도움말 전부 |
| teacher-workspace 강사 작업 공간(미니셸·내 정보·뷰 전환) | 3(1) | 감사 | 없음 | 0/1/1 | 0 | 강사 쪽 수신함(요청 확인·완료 보고) 없음 |
| student-portal 학생 내 학습 | 0(0) | — | 없음 | 1/0/0 | 0 | 학생 화면 미리보기(현재 데모 데이터) |
| parent-portal 학부모 포털(셔틀·시간표) | 0(0) | — | 없음 | 0/1/1 | 0 | 해당 없음(원장 작업 공간 밖) |
| public-sites 공개 랜딩(제품·학원) | 0(0) | — | 없음 | 1/0/0 | 0 | 학원 공개 페이지 미리보기 |
| integrations 외부 연동(makeedu·구글 시트·오늘 수학·IJW) | 10(2) | 감사 | 없음 | 0/1/2 | 0 | 연동 상태·실패 이력 |

## 14. 다음 구현 권고

1. **요청 저장소부터** — AX "요청한 업무"(원장 → 담당자, 기한·우선순위·알림 채널, 확인·완료 보고)를 저장할 테이블이 2.0에 없다. `staff_tasks`는 기록의 사실로 자동 생성·자동 종료되는 할 일이라 사람이 보낸 요청과 섞으면 종료 규칙이 깨진다. 새 테이블(tenant_id + RLS) + 감사로그 + 강사 미니셸 수신함(teacher-workspace)이 한 묶음이다.
2. **P0 이슈 원천을 실제 판정으로 교체** — 시안 이슈 7종은 복사본 집계다. 2.0이 이미 판정하는 원천을 그대로 읽는다: 할 일 11종(`staff_tasks.kind`), 알림 38종(`notifications.type`), 대시보드 위젯 36종의 판정 함수(`src/features/dashboard/*`). 같은 숫자를 두 번 계산하지 않는다(같은 데이터는 같은 원본).
3. **근거 패널 = 2.0 상세 화면 딥링크** — 원생 상세(탭 13), 반 상세, 청구 상세, 상담 상세, 결재 문서, 보고서 발송 큐. 3.0 메뉴를 186개로 늘리지 않고 이슈 → 근거 → 2.0 화면(창)으로 들어간다.
4. **결정 이슈는 실제 경로로** — 결재(`decideDocument`), 퇴원보고서(`changeWithdrawalReport`), 학부모 답글(`requestParentReply`)처럼 원장이 결정하는 동작은 시안의 세션 흉내를 걷고 2.0 서버 액션을 그대로 부른다.
5. **자동화 = 2.0 슬랙 규칙 구조** — 범주 12·프리셋 4·전달 이벤트 38·요약 일정·방해금지. AX 자동화 토글은 새 저장소를 만들지 말고 `slack_rules`/`tenant_settings` 위에 얹는다.
6. **데이터는 있으나 화면이 없는 것부터 채운다** — 신규생 체크(`student_onboarding_checks`), 영상 숙제 장부, 강사 시트 작성 현황, 연동 실패 이력.
7. **감사 전용은 6개뿐** — 인증·운영 콘솔·개발·데모·공용 기반·녹음 파이프라인. 학부모·학생·강사·공개 페이지는 원장이 관리·미리보기하는 영역으로 카탈로그에 있다(지점 화면에 운영자 설정 노출 금지 규칙은 유지).
8. **이벤트·케이스 층의 입력** — 할 일 11종(사실 기반 자동 종료)·알림 39종·DB 트리거 9개가 이미 있는 이벤트 원천이다. 원장 요청(사람이 확인·보고)과 사실 기반 자동 종료를 같은 상태 기계로 합치지 말 것. AI가 고르는 다음 행동은 핵심 동작 ID 공간(AxCatalog.coverage.operationDestinations)에서만 고르게 하면 없는 동작을 지어낼 수 없다.
