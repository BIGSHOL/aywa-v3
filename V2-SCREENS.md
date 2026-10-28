# 2.0 화면 — 2.0 형태 그대로 3.0 안의 새 페이지로 (2026-10-28)

## 원장 기준 (원문)

- *"2.0 사이트에 접속하게 하지말고 … 바로가기를 만들지말고 새 페이지를 만들어 db는 docker로 쓰면 되잖아."*
- *"이후에 2.0에서 완전히 3.0으로 갈아탈 수 있도록하기위해 3.0을 만드는 것이므로, 2.0으로 바로가기같은것은 어불성설임."*
- *"2.0에서 확인하거나 사용했던것들이 3.0에서 안되면 이상하다고 판단될 수 있기 때문이야."*
- *"2.0에서 사용하던 디자인이 너무 많이 바뀌면 안돼. … 2.0으로 표현할 수 밖에 없는건 2.0으로 표현해야함. 시간표 같은것 말이지. 수업보고서 발송이나"*
- 입력·저장을 어디에 쓸지(10-28 질문에 대한 답): *"일단은 docker. 연습용이므로 모두 docker"*
- 손으로 다시 그린 시간표 1단계를 보고(10-28): *"근데 시간표가 기존 2.0 뷰와 너무 다른데? 이런 시간표는 달라지면 혼돈을 줄 수 있는 메뉴 중 하나인데"*

> **그리는 방식 전환(10-28)**: 2.0 코드를 읽고 HTML·CSS로 다시 그리면 세부가 어긋난다. 2.0의 **실제 React 부품과 2.0 CSS(Tailwind 그대로 컴파일)를 빌드한 호스트** `v2-host/`가 같은 출처 iframe으로 3.0 안에서 그리고, 데이터는 `v2-screen-<id>.mjs`의 load가 2.0 `page.tsx`가 부품에 넘기는 **props와 같은 모양**으로 복사본에서 만든다. 2.0 서버 액션은 호스트에서 `actions`로 이어진다. 2.0 `src/`는 고치지 않고 가져다 쓰기만 한다. 아래 `.js`/`.css` 손그림 방식은 호스트가 그 화면을 대체할 때까지의 임시다(시간표가 시범).

→ 3.0은 2.0을 **대체**하려고 만든다. 2.0 사이트로 보내는 링크·끼워 넣기는 하지 않는다(10-28 바로가기 시안은 커밋하지 않고 걷어 냄). 2.0에서만 하던 일은 3.0 안의 새 페이지가 **같은 형태로 같은 일**을 한다. 데이터는 로컬 Docker 복사본.

## 대상과 맡은 세션 (원장 10-28 *"그렇게하고 진행해"* — `V2-CONFUSION-RISK.md`의 상·중 전부를 2.0 부품 그대로)

바뀌면 혼란을 주는 화면 전수는 `V2-CONFUSION-RISK.md`. 그 문서의 **상과 중 모두** 2.0 부품 그대로 3.0 안에 둔다. 하(재고·데이터베이스·고객센터·신규생·셔틀·이탈 방어·기여도·전자결재·지출결의서·보강관리·캘린더·도움말)는 지금의 3.0 작업 공간 그대로. 3.0이 새로 주는 기능(왜 줄었나·업무 흐름·요청·AI)은 2.0 화면을 바꾸지 않고 옆이나 위에 더한다.

맡은 세션: **T** = 시간표 세션(`term_8c081f9a`, 부품 호스트 `v2-host/`도) · **O** = 원스크린 세션(`term_235e25c2`) · **L** = 팀장 세션(`term_3d5da021`, 작업자 최대 둘). 앞 줄이 끝나면 다음 줄로. · **R** = 처리 화면 세션(10-28 메인이 띄움 — 업무 흐름 신호를 실제로 처리하는 화면: 퇴원보고서·전자결재·영상 제출 현황·퇴원관리. L에서 넘겨받음)

| id | 화면 | 위험 | 2.0 원본(읽을 곳) | 맡음 |
|---|---|---|---|---|
| `timetable` | 시간표(기본·강사·통합) — **호스트 시범** | 상 | `src/app/(shell)/timetable/**`, `src/features/timetable/**` | T |
| `onescreen` | 선생님 원스크린(보고서 작성·발송·공지, 격자 보기) | 상 | `src/app/(shell)/onescreen/**`, `src/features/onescreen/**`, `src/features/lesson-reports/**` | O |
| `ecs` | 강사 시트 · 영어(목록·주간·월간·MP·레일·오늘) | 상 | `src/app/(shell)/ecs/**`, `src/features/class-sheets/**` | L |
| `attendance` | 출석부(월별·출결 모드·오늘 출결·자리 출석부 메뉴) — 남은 일: 일별 목록·일별 폼(`saveAttendance`·보강 학생 추가, 30일 방문 0회) · 금액 열(청구액·실급여, 수납 뒤) · `linkMakeupToAbsence` → O(원스크린에서만 부름) | 상 | `src/app/(shell)/attendance/**`, `src/features/attendance/**` | L |
| `video-homework` | 영상 제출 현황(관리자 장부·강사 '내가 낸') | 상 | `src/app/(shell)/lesson-reports/video-homework/**`, `src/app/(shell)/onescreen/video-homework/**`, `src/features/video-homework/**` | R |
| `billing` | 수납관리 전체(수납·교재·지출·회차 확정·환불·계산기) | 상(교재·지출·회차) | `src/app/(shell)/billing/**`, `src/features/billing/**` | L |
| `dashboard` | 운영실(KPI 9칸·카드·역할별 배치) | 상 | `src/app/(shell)/dashboard/**`, `src/features/dashboard/**` | O |
| `students` | 원생목록 · 원생 상세(13탭) | 상 | `src/app/(shell)/students/**`, `src/features/students/**` | O |
| `classes` | 수업목록 · 반 상세 · 반 수정 | 중 | `src/app/(shell)/classes/**`, `src/features/classes/**` | T |
| `mcs` | 강사 시트 · 수학(MCS) | 중 | `src/app/(shell)/mcs/**`, `src/features/class-sheets/**` | T |
| `enrollment` | 신규 콜&상담(칸반·상세·수정·통계) | 중 | `src/app/(shell)/enrollment/**`, `src/features/enrollment/**` | L |
| `meetings` | 회의록 | 중 | `src/app/(shell)/meetings/**`, `src/features/meetings/**` | L |
| `consultations` | 원생상담 | 중 | `src/app/(shell)/consultations/**`, `src/features/consultations/**` | O |
| `exams` | 성적관리 | 중 | `src/app/(shell)/exams/**`, `src/features/grades/**` 등 | O |
| `lesson-reports` | 수업보고서 관리(목록·발송 큐·공지·학부모 글) | 중 | `src/app/(shell)/lesson-reports/**`, `src/features/report-admin/**` | O |
| `textbooks` · `textbook-requests` | 교재목록 · 교재 요청 | 중 | `src/app/(shell)/textbooks/**`, `src/app/(shell)/textbook-requests/**` | T |
| `class-review` | 직원 평가(채점·포트폴리오) | 중 | `src/app/(shell)/class-review/**` | L |
| `staff` | 직원관리 | 중 | `src/app/(shell)/staff/**`, `src/features/staff/**` | R |
| `withdrawals` · `withdrawal-reports` | 퇴원관리 · 퇴원보고서 | 중 | `src/app/(shell)/withdrawals/**`, `src/app/(shell)/withdrawal-reports/**` | R |
| `approvals` | 전자결재(결재함·기안·결재·결재선) | 중 | `src/app/(shell)/approvals/**`, `src/features/approvals/**` | R |
| `owner` | 학원 설정(18면) | 중 | `src/app/(shell)/owner/**`, `src/features/owner/**` | T |

**메인이 하는 공통 요소**(`V2-CONFUSION-RISK.md` §3): 3.0 사이드바를 2.0 메뉴 묶음·이름·순서로(3.0 새 기능은 별도 묶음), 강사 입구(수학 = 원스크린 · 영어 전담 = ECS), 숫자 정의는 2.0 함수로. 앱 밖 결과물(학부모 보고서 형식·공지·`/v`·자리 PIN·공유 링크·인쇄·엑셀)은 형식을 바꾸지 않는다.

## 만드는 법 (공통 틀 — 공용 파일을 고치지 않는다)

한 화면 = 파일 셋(+시험). 서버가 시작할 때 자동으로 찾고, 왼쪽 메뉴 '2.0 화면' 묶음에 나타난다.

- `v2-screen-<id>.mjs` — `export const screen = { id, label, order, params: { 이름: /정규식/ }, load: async ({ sql, params, tenantId, importV2 }) => data, actions: { 이름: { validate, run } } }`. `load`의 `sql`은 복사본의 **읽기 전용** 트랜잭션. `GET /api/v2/<id>?…`로 불린다(허용하지 않은 매개변수는 400).
- `actions`(저장, 선택) — `POST /api/v2/<id>/<이름>`. `validate(raw)`가 받은 JSON을 검사해 쓸 값만 돌려주고, `run({ sql, body, tenantId, importV2 })`가 **Docker 복사본의 쓰기 트랜잭션** 하나에서 저장한다. 사람에게 보일 거절은 `throw new V2Error(400|409, 'code', '한국어 문장')`(`v2-screens.mjs`에서 import). 그 밖의 오류는 고정 문구로 답하고 트랜잭션은 되돌린다. DB 제약 오류(23505·23503·42501 …)는 공통 틀이 한국어로 바꾼다.
- `v2-screen-<id>.js` — `V2Screens.register({ id, label, render(ctx) })`. `render`는 HTML 문자열을 **동기로** 돌려준다. 데이터는 `ctx.load(params)` → `{ status: 'loading'|'ready'|'error', data, error, refreshing }`(캐시, 도착하면 페이지가 다시 그려짐). 저장은 `await ctx.act('이름', body)` → 결과(실패하면 한국어 메시지로 reject). 저장이 끝나면 그 화면의 데이터를 보던 그대로 둔 채 새로 받아 다시 그린다. 저장하는 화면은 `ctx.copyNote`(연습용 복사본 안내 문장)를 머리에 보인다(`ctx.writable`). 이동은 `ctx.go(params)`(주소 `#v2-<id>?…` — 계정·새로고침에도 같은 화면), 매개변수는 `ctx.query`. 3.0 공용 도구는 `ctx.api`(h·fmt·won·dialog·toast·showStudent …).
- `v2-screen-<id>.css` — 그 화면 스타일(선택). 공통 틀은 `v2-screens.css`.
- `verify-v2-screen-<id>.mjs` — 시험.

**2.0 부품 호스트로 그리기(`v2-host/`)** — 진입점 붙이는 법(`build.mjs`는 고치지 않는다):
1. `v2-host/src/<id>.tsx`를 만들고 `export const HOST_TITLE = '화면 이름'`과 `export const HOST_ROUTE = '/2.0주소'`(없으면 `/<id>`)를 적는다 — 빌드가 이 표식으로 진입점을 찾고(`discoverEntries`), 2.0 부품이 그 주소로 이동하면 iframe 안에서 그 화면으로 간다.
2. 그 파일은 `createRoot`로 `AppProviders` › `HostFrame`(`./host-frame`) › 2.0 레이아웃 컨텍스트(`OperationsProvider` 등) › 2.0 `page.tsx` 조립을 옮긴 부품(2.0 부품·함수는 `@/…`로 그대로 import)을 그리고, 데이터는 `GET /api/v2/<id>`(load = 2.0 page가 서버에서 받던 모양)로 받는다. 서버 액션(`"use server"`)은 빌드가 자리표시로 바꾼다(`shims/server-action.ts`). 시간표가 본보기(`src/timetable.tsx`·`timetable-page.tsx`).
3. `node experiments/owner-concept/v2-host/build.mjs` → `dist/<id>.html`(4310은 새로고침으로 반영, 시작 때 `isBuilt()`가 거짓이면 스스로 짓는다). 3.0 화면 `v2-screen-<id>.js`는 같은 출처 iframe `/v2-host/<id>.html?…`을 자리 위에 한 번만 겹쳐 둔다(`v2-screen-timetable.js`). `shims/`·`host-frame.tsx`·`host.css`는 공용 — 더 필요하면 시간표 세션에 `[요청]`.

## 공용 도구: v2-server-runner (메인 결정 10-28 안 A · 주인 = 팀장 세션)

- **언제**: 조립·산식이 커서 SQL로 손 이식하면 2.0과 어긋날 위험이 큰 화면(수납 회차 확정 · 강사 정산 …). 순수 함수만 필요하면 `importV2`로 충분하다. 첫 사용처 = `v2-billing-sessions.mjs`.
- **쓰는 법**: `runV2Server({ steps: [{ module: 'features/…/server/x.ts', fn, args }], actorId, tenantId, mode: 'read' | 'write', rollback?, probes? })` → `{ results: [{ value } | { redirect } | { notFound }] }`. 동작 하나 = 복사본 트랜잭션 하나(읽기 = read only · 쓰기 = `net.http_request_queue`가 늘면 되돌림 · `rollback` = 시험용).
- **격리**: 모듈 훅은 전용 작업 스레드(`v2-server/worker.mjs`)에서만 register한다 — 4310 메인 스레드에는 걸지 않는다. 작업 스레드는 바깥 `fetch`를 막는다.
- **훅 지정자**: `server-only` · `next/cache`(캐시 없음 · 무효화 없음) · `next/headers`(쿠키·머리글 없음) · `next/navigation`(redirect · notFound는 던짐) · `next/server`(`after` = 같은 트랜잭션 끝에서) · `@/lib/supabase/server`(보는 사람 신분 + authenticated · RLS가 2.0처럼) · `@/lib/supabase/admin`(복사본 접속 = RLS 우회) · `@/lib/supabase/client`(던짐) · `@/lib/auth/current-user`(보는 사람) · `@/features/audit/server/log`(같은 표 + `metadata.via` '3.0 연습 복사본' · 슬랙 깨우기 없음). 학원 설정(`getTenantSettings`) · 권한 표(`perm-matrix`) · 지점 보기는 흉내 내지 않고 2.0 코드 그대로 돈다. 판정은 해석한 파일 경로로(`./server`든 `@/…`든 같다).
- **지원하는 PostgREST 모양**(`v2-server/postgrest.mjs`): `select`(칸 · `별칭:칸` · `칸::형식` · `*` · 임베드 `별칭:fk칸(…)` · `표!FK이름(…)` · `!inner`) · `count: 'exact'` · `head` · `eq` `neq` `gt` `gte` `lt` `lte` `like` `ilike` `is` `in` `contains` `containedBy` `overlaps` `not` `filter` `match` `or`(`and(…)` 포함) · 임베드 칸 거르기(`invoice.period`) · `order`(nullsFirst) · `range` · `limit` · `single` · `maybeSingle` · `insert` · `update` · `upsert`(onConflict · ignoreDuplicates) · `delete` · 뒤의 `.select()` · `rpc`(집합 · 하나짜리). PostgREST와 같게 **한 번에 1000행**(db-max-rows) · 값은 JSON(to_jsonb) · FK가 둘이면 PGRST201 · 없는 표 PGRST205 · 오류는 `{ data: null, error: { code, message, details, hint } }`. **모르는 모양(JSON 경로 · 임베드 정렬 · storage · auth.admin …)은 조용히 넘기지 않고 던진다**(`V2_UNSUPPORTED`) — 필요해지면 흉내를 늘리고 시험을 더한다.

## 지킬 것

- **같은 데이터는 같은 원본**: 2.0이 화면을 만드는 순수 함수(격자 만들기·명단·라벨·판정)는 `importV2('features/…/x.ts')`로 **그대로** 불러 쓴다(원인 추적의 `v2-bridge.mjs`와 같은 방식). 새로 계산해 2.0과 다른 값을 내지 않는다. 운영 enum(과목·학년·교시 라벨)은 학원 설정에서 읽는다.
- **2.0 형태**: 2.0 화면의 배치·라벨·글씨 서식을 따른다. 카드·요약으로 바꾸지 않는다. 3.0 공통 원칙(스크롤바 숨김 + 넘치는 가장자리만 페이드, 차트 앱 전용 팝오버, 한국어 라벨·원문 코드 노출 금지, 폰 폭)은 그대로.
- **1단계 = 보기 동등**: 2.0이 그 화면에서 보여 주는 정보를 모두 같은 형태로 보인다.
- **2단계 = 입력·저장도 2.0처럼 (원장 10-28 결정: 모두 Docker 복사본에)**: 2.0이 그 화면에서 저장하는 것(출결·진도·숙제·보고서 작성, 반 배치 …)을 같은 자리·같은 동작으로 저장한다. 저장은 `actions`로만, 대상은 Docker 복사본뿐이다.
  - **2.0 서버 액션과 같은 결과**: 2.0이 그 저장에서 바꾸는 표·칸을 같은 값으로 바꾸고, 2.0이 남기는 감사로그(`audit_logs`: actor_id·actor_name·action·target_type·target_label·metadata — `action` 이름도 2.0과 같게)도 같이 남긴다. 2.0의 검증·판정 순수 함수는 `importV2`로 그대로 쓴다.
  - **누가 저장했나**: 3.0 시안엔 로그인이 없다. 화면이 '이 선생님으로 보기'처럼 고른 사람을 actor로 쓰고, 그 사실을 화면과 감사로그 metadata(`{ via: '3.0 연습 복사본' }`)에 남긴다.
  - **발송**: 수업보고서 발송 같은 '보내기'는 2.0이 큐에 남기는 행까지만 복사본에 쓴다. 복사본엔 연동 PC가 붙어 있지 않아 실제로 나가지 않는다. 화면엔 '복사본 — 실제 발송 없음'으로 적는다. ClassNote·알림톡·슬랙·오늘 수학을 직접 부르는 코드는 어떤 단계에서도 쓰지 않는다.
  - **바깥 전송 차단(공통 틀이 강제)**: 복사본엔 2.0 트리거가 그대로 있어, 반·학생·수강·보고서·직원 표에 쓰면 오늘 수학 동기화가 `pg_net`으로 운영 주소를 부르려 한다. 공통 틀은 저장 트랜잭션 안에서 `net.http_request_queue`가 늘면 **통째로 되돌린다**(409 `outbound_blocked`). 복사본의 깨우기 설정(운영 주소·비밀값)도 지웠다(HANDOFF §2).
  - **기록**: 저장마다 `F:/aywa-dev/full-db/v2-writes.jsonl`에 한 줄(시각·화면·동작·입력·결과). 커밋하지 않는다.
  - **되돌리기**: 복사본을 처음 상태로 돌리는 방법은 HANDOFF §2(기준 사본 `aywa_full_baseline`). 원인 추적 등 분석 기능도 같은 복사본을 읽으므로, 연습 저장이 그 숫자를 바꿀 수 있다(원장 수용 — "일단은 docker").
- **성능**(CLAUDE.md B1~B7): 무페이징 전건 select로 세지 말 것, 큰 `in()`은 나눠서, 독립 조회는 병렬.
- 원본 운영 DB 접속 금지. 운영 배포·푸시 금지. 4310 재시작은 메인이 한다(서버 모듈을 바꾸면 메인에 요청).
- 개발 중 저장 시험은 복사본에 실제로 쓴다. 시험 데이터는 '학원이'(테스트 학생)·테스트 반을 쓰고, 시험이 끝나면 그 행을 지우거나 원래 값으로 되돌리는 정리까지 시험 안에 넣는다.
- 다른 세션 파일·공용 파일(`live.js`·`serve-live.mjs`·`live.html`·`workspaces.*`·`flow-*`)은 고치지 않는다. 필요하면 메인에 요청.
- 커밋은 자기 파일만 경로 지정, 커밋 전 적대적 리뷰 1회.
