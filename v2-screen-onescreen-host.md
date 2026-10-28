# 2.0 선생님 원스크린 — 호스트(v2-host)에 붙일 때 필요한 것

정정 지시(원장 10-28, task-v2-host-amend): 2.0 화면은 손으로 다시 그리지 않고 2.0 React 부품을 그대로 그린다. 이 메모는 원스크린을 호스트에 붙일 때 필요한 것을 정리한다.
지금 `v2-screen-onescreen.js/.css` 손그림은 호스트가 대체할 때까지 임시로 두고, 더 다듬지 않는다.

## 1. 2.0 page.tsx가 부품에 넘기는 것 (`src/app/(shell)/onescreen/page.tsx`)
- `OneScreenClient`(`features/onescreen/components/onescreen-client.tsx`) props
  - **`getTeacherRoster(date, all)`의 결과**: `students`(→ `initial`) · `today` · `date` · `classTags` · `todayClasses` · `allowTeacherTestMax` · `showDailyTest` · `showCheckTest` · `noticeMode` · `academyNoticeMode` · `classnoteSendEnabled` · `classnoteOn` · `sendWindow` · `showAttachments` · `canEditAttendance` · `fontSize` · `displayOptions` · `trendOptOut` · `noClassesToday` · `showingAll` · `holidayName` · `teacherName` · `reportSettings` · `academyName` · `logoSrc` · `makeupNotice`
  - 그 밖: `resolveReportAuthorSettings` 결과(`teacherName` · `reportClassNamePrefix`), `readonlyView`, `presenceScope`, `initialView`(`parseView`), `initialClassName`, `initialStudentId`, `canLinkIjw`(`getJjAccess`), `classnoteMatch`(`getClassnoteMatchMap` + `pickCnForClasses`)
- `VideoHomeworkProvider`(`features/video-homework/components/video-homework-provider.tsx`) props: 영상 숙제 검사 기록 · 배정 · 제출 링크 모드 · 마감 · 취소 정보(page.tsx가 학생 줄의 `videoHomework*` 값도 여기서 고친다).
- 서버 컴포넌트 두 줄(`TodayAttendanceStrip` · `MyTasksStrip`)은 Suspense 안의 별도 조회다 — 호스트에서는 따로 데이터를 넣거나 뺀다.
- **지금 상태**: 호스트 진입점 `v2-host/src/onescreen.tsx`가 2.0 부품을 수정 없이 그린다. 데이터 = `GET /api/v2/onescreen?props=1&teacher&date&all[&view&class&student]`(`v2-onescreen-roster.mjs`) + `host`(운영 설정·라이선스·화면 언어·선생님 목록). 3.0 쪽(`v2-screen-onescreen.js`)은 안내 한 줄 · 보는 선생님 · iframe 자리. 2.0 날짜 이동이 주소에서 teacher를 빼도 진입점과 3.0 쪽이 고른 선생님을 유지한다.
- 감싸지 않은 것: 실시간 편집 표시(EditPresenceProvider — 공급자가 없으면 2.0 훅이 아무것도 안 함 · 바깥 접속 없음) · 오늘 출석 미입력 줄 · 내 할 일 줄 · 강사 영어 이름(TeacherNamesProvider 빈 값).
- 2.0 `public/` 그림(예: `/badges/cnNote.png` ClassNote 배지)은 호스트가 아직 내주지 않아 404 — 공용 서빙이 필요하다.

## 2. Next 전용 모듈 (부품 그래프 295개 파일에서)
- `next/navigation` — onescreen-client · print-window · href-select 등
- `next/link` — embed-link · toolbar
- `next/dynamic` — onescreen-client
- `server-only`를 실제로 import하는 파일은 클라이언트 그래프에 없다(주석 언급만 있음). 브라우저 Supabase(`@supabase/ssr`)는 첨부 올리기(`lib/storage/upload-to-ticket.ts`)만 쓴다.

## 3. 부품이 부르는 서버 액션 모듈(`"use server"`, 25개)과 이 화면의 actions
| 2.0 서버 액션 | 여기 `actions` | 상태 |
|---|---|---|
| `features/onescreen/server/actions.ts` `saveLessonReport` | `saveLessonReport`(손그림용 `save`) | ✅ 같은 입력(`SaveLessonReportInput`) + `actor` |
| 같은 파일 `saveAndQueueClassnote` | `saveAndQueueClassnote`(`send`) | ✅ 큐 행까지만(실제 발송 없음) |
| `features/attendance/server/actions.ts` `setAttendanceCell` | `setAttendanceCell`(`attendance`) | ✅ 그날 칸(교시 없이) · 상태 · 메모 · onlyIfEmpty |
| 같은 파일 `saveOnescreenSession`(800ms 자동저장) | `saveOnescreenSession` | ✅ 읽은 판에서만 갱신(sessionSaveDecision · preserveMakeupSessionEntries · updated_at 비교) · 감사 줄 없음(2.0과 같다) |
| 나머지: attachment · bulk-log · calendar · display-options · english-ment · history · jj-day · makeup-*(5) · notice-*(2) · order · status · report-admin(class-notice · classnote-sync · sync-report · recall) · report-templates · video-homework | — | 아직 없음 |

- **호스트 경계**(`v2-host/shims/server-action.ts`, 시간표 세션): 2.0 함수 이름 그대로 `POST /api/v2/onescreen/<함수>` · 본문 `{ module, actor, args }`. 이 화면은 2.0 이름의 action이 `args[0]` + `actor`를 받는다(module이 다르면 거절). 저장하는 사람 = 보는 선생님 한 명(`setHostEditors`). 아직 잇지 않은 함수(예: 읽기용 `loadReportTrend`)는 404 → shim이 '복사본 보기 전용'으로 바꾼다.
- **입력 약속**: 2.0 입력 그대로 + `actor`(3.0엔 로그인이 없어 화면이 보여 주는 선생님을 넘긴다 — 시간표 화면과 같은 약속). 서버는 그 사람을 DB 신분(`request.jwt.claims`)으로 걸어 2.0 트리거(활동 기록·발송 이력)가 같은 사람을 보게 한다.
- **발송 관문은 2.0 순서 그대로**: 회수·취소·처리 중·발송됨 → 저장 → 새 수학 보고서(자동작성·`pilotCheck`·한 줄 멘트)·영어 한 줄 → 발송 스위치 → 과목 → 영어 그림 자리뿐 → 미발송 반 → 결석·출결 미체크 → 동명이인 → 반별 발송의 반 보드. 저장 뒤 거절은 2.0처럼 저장은 남기고 `{ ok:false, saved:true, error }`로 돌려준다. 반 보드가 없을 때 2.0은 동기화 요청까지 남기지만, 복사본엔 연동 PC가 없어 요청은 남기지 않는다(이유 문구는 '요청 안 함' 쪽).
- **출결 권한은 2.0 권한표 그대로**: 강사 수준(scoped) 계정만 7일 잠금·담당 반·수강생 검사를 받고, 원장·관리자는 받지 않는다. 기록 경로(`recorded_via`)는 그 반을 가르치면 teacher, 아니면 desk. 첫 체크의 `onlyIfEmpty`는 덮지 않고 `conflict`를 돌려준다.
- **아직 하지 않는 2.0 입력**: 영상 숙제(`videoHomework*` · `videoSubmitLink`) · 자동작성 원문(`mentAutoDraft`) · 영어 결과지(`jjExamPick`) · `classnoteClassId` — 받으면 빼고 결과의 `ignored`로 알린다. 보강·수업 외 보고서(`makeup` · `outOfClass` · `makeupClassId`), 출결의 메모만 저장·시수·교시·강사 보기 칸(`noteOnly` · `units` · `slotStart` · `periodStart` · `scopeTeacherId` · `ghostTransfer`), 보강 상태(`makeup`), 보강 예약·수업 나누기로 온 학생(`allowMakeup`)은 거절한다. 보강 예약 이행·되돌림, 진도 반영(`ingestReport`), 오늘 수학 성적표 첨부도 아직 없다.
- **결과 모양**: 2.0과 같은 키(`ok` · `id` · `shareToken` · `status` · `mentSource` · `autoUnits`)에 손그림 화면용 `message`가 붙는다. 2.0이 `{ ok:false, error }`로 돌려주는 거절은 여기서 HTTP 4xx + 한국어 문장이다 — 호스트의 서버 액션 대체 모듈이 `{ ok:false, error: message }`로 바꿔 주면 2.0 부품이 그대로 읽는다.
- **권한표**: 2.0 `resolveMatrix` + 개인 예외(`applyUserOverrides`) + `accessLevel`/`canWrite`. 2.0이 그 위에 더 거는 것(꺼진 모듈·설정 기능·보강 방식 막기, 개인 메뉴 차단, 운영자 권한 합치기)은 아직 없다 — 침산 출결 메뉴에서는 결과가 같다.
