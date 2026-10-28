# 업무 흐름 엔진 (로컬 미리보기)

"일이 생긴다 → 내가 할 일 → 내가 처리 → 다음 사람의 일 → 관리자 감독 → 원장 흐름"을 실제 복사본 기록 위에서 잇는 로컬 엔진입니다.
41개 작업 공간(`/api/workspaces/...`)은 아래로 파고드는 화면이고, 이 엔진이 중심입니다. **로컬 개발 전용**이며 운영 인증이 아닙니다.

- 원본 DB와 복사본 DB(127.0.0.1:5444/aywa_full_snapshot)는 **읽기만** 합니다(`repeatable read read only` 트랜잭션 한 번).
- 처리·요청 기록은 별도 파일 저장소(`F:/aywa-dev/owner-flow/...`)에만 남고, 화면에는 `origin: 'dev'`로 원본 기록(`origin: 'snapshot'`)과 구분됩니다.
- 실제 발송(슬랙·알림톡·ClassNote)은 없습니다. `channels: ['slack']`은 미리보기 표시일 뿐입니다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `flow-source.mjs` | 복사본에서 한 번 읽기: 실제 직원(actors), 엔티티, **외래키 관계만**(`relation.source = "표.열"`), 2.0 `staff_tasks` 전부와 이력, 작업 공간 신호, 시나리오 후보 |
| `flow-rules.mjs` | 2.0 의미(할 일 종류 11개·마감 규칙·마감 사유), 역할 라벨, 이벤트 목록(구현됨/예정), 흐름 템플릿, 명령별 허용 역할 |
| `flow-engine.mjs` | 역할 → 실제 사람 해석(코드), 단계 진행, 신호 기록의 담당자(외래키) |
| `flow-reconcile.mjs` (+`-signals`) | 원본 시드 + **재대조**: 원본을 읽을 때마다 저장된 원본 업무를 다시 판정(닫힘·다시 열림·담당·근거 기록), 사실이 남는 신호의 처리 완료 |
| `flow-commands.mjs` | `POST /api/flow/actions` 검증·권한·상태 전이, 멱등·revision, AI 2단계 처리 |
| `flow-decision.mjs` | AI 작업자 모듈(`decision-engine.mjs`·`decision-claude.mjs`·`decision-key.mjs`)과의 연결, 가명 맥락 |
| `flow-store.mjs` | 저장소: 배타 잠금, 직렬화된 원자적 쓰기 |
| `flow-service.mjs` · `flow-http.mjs` · `flow-view.mjs` | 서비스 조립, HTTP 가드, `GET /api/flow` 응답 |
| `verify-flow-engine.mjs` (+`-fixture`) | 합성 데이터 단위·통합 테스트(DB·네트워크 없음, 임시 폴더) |
| `verify-flow-engine-live.mjs` | 실제 복사본 + 실행 중 서버 검증(`--http`, `--ai`) |

`serve-live.mjs`는 assistant 다음에 흐름을 백그라운드로 준비합니다(준비 전 요청은 503 `flow_starting`). `NODE_ENV=production`·`VERCEL`·`OWNER_CONCEPT_FLOW=off`면 꺼집니다(404).

## 실제 기록에서 만드는 것 (복사본 2026-10-27 기준 실측)

- 직원 24명(+원장 미리보기 1): 재직(`active`)·플랫폼 계정 제외·역할은 2.0 라벨(원장·관리자·강사·참관 등). 참관(viewer)은 요청·재배정에서 **고를 수 없고**(`assignable:false`) AI 후보에도 들지 않습니다. 예외는 하나뿐입니다: 2.0에서 출결 알림을 켠 결석 확인 담당이면 2.0과 같은 판정으로 결석 연락 단계와 원래 배정된 할 일을 받습니다(그 밖의 권한은 늘리지 않음).
- 엔티티 2,974 · 관계 3,541. 관계 종류: 반 담임(`classes.teacher_id`), 수강(`enrollments.student_id/class_id`), 결석(`attendance_records.*`), 청구(`invoices.student_id`), 상담(`student_consultations.*`), 신규 상담(`enrollment_consultations.consultant_id`), 결재(`approval_documents.drafter_id`·`approval_steps.approver_id`), 퇴원보고서, 수업보고서, 교재 요청, 자산 대여, 숙제 영상, 할 일 배정(`staff_task_assignees.user_id`)·대상(`staff_tasks.subject_id`). 이름 맞추기로 잇지 않습니다.
- 원본 업무 248건 = 2.0 할 일 238건(열림 132 · 원본에서 닫힘 106) + 작업 공간 신호 10건. 이벤트 621건(원본 이력 그대로).
- 관리자 대기열 7건: 담당자가 없거나 재직 직원이 아닌 일.

## 업무(case) 종류와 닫힘

- `kind:'source'`, `closure:'fact'`: 원본에서 온 일. **원본을 다시 읽을 때마다 재대조**합니다(`flow-reconcile.mjs` — 서버 시작 + `reloadSource`). 사건은 모두 `origin:'snapshot'`.
  - 원본 할 일: 2.0에서 처리·취소·기한 지남이 되면 `sourceStatus`·`factClosed`·`closedReason`·`closedAt`을 고치고 남은 단계를 닫습니다(`source.task_closed`, 시각 = 원본의 닫힌 시각). 다시 열리면 다시 엽니다(`source.task_reopened`). 원본 담당이 바뀌면 단계 담당이 따라갑니다(`source.task_reassigned`) — **관리자가 바꾼 단계(`case.reassign`)·'확인'한 단계는 그대로**. 원본에서 사라진 할 일은 닫습니다(빈 목록이면 아무것도 닫지 않음). 여기서 보고하면 원본은 열린 채로 두고 연결된 로컬 후속 업무(`kind:'request'`, 완료)를 만듭니다 — 원본 할 일은 2.0에서 처리돼야 끝납니다.
  - 원본 신호: 신호가 원본에서 빠지면 닫고(`source.signal_cleared`, 시각 = 원본을 읽은 시각 `source.loadedAt`), 다시 나타나면 엽니다(`source.signal_reopened`). 근거 기록이 바뀌면 제목·요약·근거·단계를 새로 맞추고 건수를 남깁니다(`source.signal_changed`). 단계는 기록의 담당자마다 하나이고 **기록 순서대로 번호를 다시 매깁니다**(계층 화면과 같은 번호) — 같은 담당 = 같은 단계(사람의 담당 변경·확인 유지, 보고는 단계를 따라감), 새 담당 = 새 단계, 기록이 없어진 담당 = `retired`(기록 0, 이력용). 읽지 못한 영역의 신호는 닫지 않습니다(`signalFamilies`).
  - **사실이 남는 신호**(`FACT_SIGNALS`, `flow-rules.mjs` 한 곳 — 반복 결석·메이크에듀 동기화 문제): 보고가 후속 업무를 만들지 않고 이 업무에 남으며, 그 순간 그 단계의 근거 기록(기록·원생·반으로 좁힘)을 `coveredRefs`로 함께 저장합니다. 기록마다 가장 최근 보고가 '처리함'·'해당 없음'이면 처리 완료 — 단계의 기록이 모두 처리되면 단계가, 모든 단계가 처리되면 업무가 닫힙니다(`source.signal_handled`). **처리한 기록에 없는 새 기록**이 생기거나 더 새 보고가 '검토 필요'·'연락 안 됨'이면 다시 엽니다. 원본 기록(결석 등)은 바꾸지 않습니다.
- `kind:'scenario'`: 실제 복사본 기록 하나에 묶은 로컬 시나리오(`event.simulate`). 같은 기록의 열린 시나리오가 있으면 새로 만들지 않습니다(`duplicate:true`).
- `kind:'request'`: 원장·관리자의 요청. 지정한 사람 모두가 보고해야 관리자 검토로 넘어갑니다.
- 단계는 `group` 순서로 열립니다(`waiting → ready → working → done`). `when:'needsReview'` 단계는 검토가 필요할 때만 열리고, 아니면 `skipped`로 남습니다.
- 담당을 못 찾은 단계는 **사라지지 않고** `queue:'manager'` + `unassignedReason`으로 관리자 대기열에 섭니다. 관리자·원장이 받아 처리(`case.ack`)하거나 재배정(`case.reassign`)합니다.

## 구현된 템플릿

| 시나리오 | 단계 | 담당 해석(코드) |
|---|---|---|
| 결석 `absence` | 보호자 결석 확인 연락 → (검토 필요 시) 관리자 검토 → 담임 후속 조치 | 기존 결석 확인 담당 = 출결 알림을 켠 재직 직원(2.0 0378a와 같은 판정, `users.attendance_alert_optin`) → 관리자·원장 → 해당 반의 담당 강사(`classes.teacher_id`) |
| 수납 `billing` | 납부 내역 대조 → 관리자·원장 결정(항상) | 회계 담당 직원(없으면 관리자 대기열) → 관리자·원장 |
| 상담 `consultation` | 상담 담당 후속 연락 → (검토 필요 시) 관리자 검토 | 상담을 맡은 사람(`student_consultations.counselor_id`) |
| 원장 요청 `request.create` | 지정한 사람마다 확인·보고(동시) → 관리자 검토 후 마감 | 요청한 사람이 지정(1~10명, 배정 가능한 실제 직원만) |
| 원본 신호 | 근거 기록의 담당자별 확인 단계 | 결석=해당 반 담당 강사, 결재=결재 차례인 사람, 퇴원보고서=승인할 관리자, 자산=빌려 간 사람, 숙제 영상=숙제를 낸 선생님, 신규 상담=상담자. 담당 열이 없으면 관리자 대기열 |

`steps[].rule`은 화면용 업무 문구, `steps[].ruleSource`는 기술 출처(`classes.teacher_id` 등)입니다.

이벤트 목록(`EVENT_TYPES`): 구현됨 = 원본 할 일 생김/이력/신호, 결석 보고, 수납 확인 요청, 상담 후속 요청, 업무 요청, 판정 요청·기록, 단계 배정·접수·보고·검토·보완 요청·건너뜀·재배정, 마감, 다시 열기, 후속 연결. **예정(아직 없음)** = 신규 문의(`enrollment.inquiry`), 학부모 메시지(`parent.message`), 퇴원 요청(`withdrawal.requested`).

## API

`GET /api/flow[?casePage=N][&eventsBefore=N]` → `{ schemaVersion:1, mode:'local-preview', asOf, revision, source, actors, entities, relations, cases(≤500), casesTotal, casePage, casePageSize, casePageCount, events(최신 200), eventsTotal, metrics, aiStatus, scenarioCandidates }`. 읽기 전용이며 **AI를 부르지 않습니다**(5~10초 폴링 안전).

`scenarioCandidates` = `event.simulate`가 받는 실제 기록(각 100건까지, 결석은 최신 수업일 먼저) — `absence[{id,date,studentId,classId|null,followup}]` · `billing[{id,period,studentId,billed,discount,paid,remaining,due,followup}]`(remaining = billed − discount − paid) · `totals`(자르기 전 수) · `limit`. 외래키로 확인된 값만 담고 이름·연락처는 넣지 않습니다. `followup`은 같은 기록으로 열린 로컬 시나리오(`{caseId,state}`)가 있을 때만.

원생 → 반 → 강사 → 관리자·원장 계층과 그 AI 큐는 [`FLOW-HIERARCHY.md`](FLOW-HIERARCHY.md)(`GET /api/flow/hierarchy?caseId=`).

`POST /api/flow/actions` `{ commandId, expectedRevision, actorId, kind, caseId?, payload }`

| kind | 누가 | payload |
|---|---|---|
| `request.create` | 원장·관리자 | `title`(80) `body`(2,000) `assigneeIds`(1~10) `dueAt?`(YYYY-MM-DD) `priority?` `familyId?` `recordRefs?` `channels?` `source?` |
| `event.simulate` | 전원 | `scenario` `recordRef?`(그 시나리오 후보인 실제 기록만) |
| `case.ack` · `case.report` | 그 단계 담당(대기열은 관리자·원장) | report: `note`(2자 이상, 연락처 가림) `outcome?`(done·needs_review·unreachable·not_needed) `recordRefs?`(그 업무와 관련된 기록만) |
| `case.review` | 원장·관리자 | `decision: accept|return` `note`(보완 요청은 필수) |
| `case.reassign` · `case.reopen` | 원장·관리자 | `assigneeIds` / `note`(로컬 완료 업무만) |
| `case.analyze` | 원장·관리자 | `draft?: true`(Claude 초안까지) |

결과 `{ revision, caseId, eventIds, duplicate?, decision?:'pending'|'ok'|'unavailable'|'error'|'skipped', replayed? }`. 오류는 `{ error, message }`(한글): 400 `invalid_request`·`evidence_required`·`assignee_not_allowed`·`record_ref_not_allowed`, 403 `actor_not_allowed`·`action_not_allowed`·`not_assignee`·`forbidden_origin`, 404 `case_not_found`, 409 `revision_conflict`(+`revision`)·`command_conflict`·`step_not_ready`·`fact_case`, 413, 415, 503 `flow_starting`·저장소 오류, 500 `store_write_failed`.

- 같은 `commandId` + 같은 내용 = 처음 결과(`replayed:true`), 다른 내용 = 409. 재시작해도 유지됩니다.
- **`service.reloadSource(newSource)`**(AX-H2 계약, HTTP 없음): 같은 복사본(`identity.tenantId`·`capturedAt` 같음 — 다르면 `flow_state_mismatch`)을 다시 읽은 `loadFlowSource` 결과를 받아, 저장소 쓰기 줄 안에서 재대조·저장한 뒤 그 원본을 화면·명령·계층이 쓰게 합니다. 반환 `{ created, updated, closed, reopened, unchanged, changes:[{caseId,title,outcome,tags,events}], revision }`. 같은 원본을 두 번 넣으면 아무것도 바뀌지 않고 개정도 그대로입니다. 저장소 폴더는 복사본 시각으로 정해져 바뀌지 않습니다.
- 응답의 업무에는 신호 근거 전체 목록(`sourceRecords`)과 보고가 덮은 기록 목록이 빠지고 건수(`evidence[].coveredCount`)만 실립니다.
- 가드: `sec-fetch-site`가 cross-site면 403, POST는 정확히 같은 출처(`origin`)만, JSON만, 16KB 상한, 10초 수신 제한. 저장소 폴더·환경 파일은 어떤 경로로도 내보내지 않습니다.

## 저장소

- 위치: `<복사본 폴더>/../owner-flow/<워크트리 폴더 이름>/<지점>-<복사 시각>/state.json`(예 `F:/aywa-dev/owner-flow/ax-claude-dev/cs-20261027053406`). `OWNER_CONCEPT_FLOW_DIR`로 직접 지정, `OWNER_CONCEPT_FLOW_NAMESPACE`로 이름만 바꿀 수 있습니다. 워크트리 이름은 `v3.0.0`처럼 점을 허용합니다(구분자·`..` 금지).
- 다른 지점·다른 복사본·다른 형식 버전의 파일이면 `flow_state_mismatch`로 멈춥니다. **자동으로 지우거나 초기화하지 않습니다.** 파일을 옮긴 뒤 다시 시작하세요.
- 잠금 `state.lock` = 배타 생성(`pid:토큰`). 살아 있는 다른 소유자면 `store_locked`, 죽은 프로세스의 잠금만 치우고 한 번 다시 시도합니다. 닫을 때 대기 중인 쓰기를 마친 뒤 **자기 토큰일 때만** 지웁니다. 검증 실패로 열기를 그만두면 잠금을 반납합니다.
- 쓰기는 한 줄로 직렬화되고 임시 파일 + fsync + rename입니다. 디스크에 쓴 뒤에만 메모리를 바꾸므로 실패한 명령은 아무것도 남기지 않습니다(`store_write_failed`).
- 저장 내용은 업무·이벤트·명령 기록·판정 기록뿐이며 키·비밀번호·DB 접속 정보는 넣지 않습니다. 보고 메모는 연락처를 가립니다.

## AI 판정

- 새 시나리오(`event.simulate`)는 Jev 판정을 **한 번** 요청하고, 그 밖에는 `case.analyze`(명시 버튼)일 때만 부릅니다. 화면 조회·시드·재시작은 이 업무 판정 AI를 부르지 않습니다(예외: `OWNER_CONCEPT_HIERARCHY_AI=on`일 때 계층 큐가 서버 시작과 명령 직후 새·바뀐 근거만 백그라운드로 처리 — FLOW-HIERARCHY.md). 같은 맥락은 판정 모듈 캐시가 받습니다(`cache.hit`).
- **AI는 쓰기 대기열 밖에서 돕니다.** 1단계 쓰기에서 `decision.requested`를 남기고 일을 먼저 배정합니다(검토 단계는 보수적으로 포함). 판정은 그 뒤 따로 돌고(Jev 12초, Claude 초안 90초 제한), 2단계 쓰기가 `decision.recorded`(원인 = 판정 요청)를 남깁니다. 그동안 다른 직원의 처리는 그대로 저장됩니다. POST는 1.5초까지만 기다리고, 넘으면 `decision:'pending'`으로 답합니다.
  - 판정이 늦게 와도 이미 열린 검토 단계를 되돌리지 않습니다(`data.applied:false`). 사람이 `needs_review`·`unreachable`로 보고했으면 판정이 검토를 빼지 못합니다.
  - 판정이 도는 동안 같은 업무의 두 번째 `case.analyze`는 `duplicate:true`(revision 그대로).
  - 판정 중에 서버가 꺼지면 다음 시작 때 `서버가 다시 시작되어 판정이 중단됨`(오류, 검토 유지)으로 기록합니다. 다시 판정하려면 분석 버튼.
- 맥락은 가명입니다: 이름은 `학생A`·`직원`, 연락처는 가림, 날짜·횟수·금액은 코드가 계산한 사실, 후보 직원은 검증된 관계에서만 뽑고 배정 가능한 사람만. 급여·계좌·주민번호·이력서·상담 원문은 넣지 않습니다.
- 사람 배정은 코드가 합니다. AI는 담당자 ID를 만들 수 없고, 허용된 템플릿 밖의 일을 실행하지 못합니다. **수납·직원 인사 영역은 판정과 관계없이 항상 사람 검토**이고, Jev가 `auto_route`가 아니거나 영역이 엇갈리면 검토를 유지합니다(경로 임계값은 AI 작업자의 `decision-policy.mjs`, `AI-DECISIONS.md`).
- Claude는 이 PC의 구독 CLI(`claude -p`)만 씁니다(API 키 없음). Jev 키는 `OWNER_CONCEPT_TYPESAFE_KEY_FILE`이 가리키는 파일에서 `TYPESAFE_API_KEY` 한 줄만 읽습니다(`decision-key.mjs`). 이 엔진은 그 밖의 환경 파일을 읽지 않습니다. 키가 없거나 모듈·네트워크가 실패하면 일을 그대로 두고 이유를 표시합니다(가짜 판정 없음).
- 이 PC 상한: 판정 분당 12회, Claude 초안 10분당 3회(`flow-decision.mjs` `LIMITS`).
- 기한: 기록의 날짜 칸만 `requestedActionDate`로 넘깁니다 — 결석일(`attendance_records.session_date`), 청구 마감일(`invoices.due_date`), 요청의 기한(`dueAt`), 원본 할 일의 기한(`staff_tasks.due_at`, KST 날짜). 자유 글의 "내일" 같은 표현은 해석하지 않고, 오늘 ±366일 밖이면 빼고 보냅니다. 판정 모듈이 코드로 계산한 `deadline`이 있으면 우선순위는 그것을 따르고(오늘·내일·지남 = 높음, 7일 안 = 보통, 8일 이후 = 낮음) 모델의 긴급도는 참고로만 남깁니다. 기한은 배정·경로를 바꾸지 않고, 업무의 `dueAt`을 지어내지 않습니다.
- 화면용 `case.decision`: `null`(판정 안 함) 또는 `{ status: ok|pending|unavailable|error|skipped, reason(한글), route, routeLabel, providerLabel, modelLabel('Jev 1.14'·'Claude Sonnet 5.5'; 모르는 원시 이름은 표시 안 함), probabilities, deadline({date, relation, label, urgency, daysFromToday}|null), elapsedMs, usage, at, draft, codes(기술 사유 코드) }`.
- `actors[].assignable`: 담당자로 고를 수 있는 사람(요청·재배정). 참관 계정과 원장 미리보기는 `false`입니다.
- 함께 가져온 AI 작업자 커밋: 7ebd12bda · ffb701d25 · d38d7b569 · 9dbff3657 · 39a5b8be6 · 77216b46c(조정자 승인, 이 브랜치에서는 cherry-pick 사본).

## 검증 (2026-10-27)

- (10-28 재대조 추가 뒤) `verify-flow-engine.mjs` → **23/23**(재대조 8건 = `verify-flow-engine-reconcile.mjs`), `verify-flow-hierarchy.mjs` 9/9, `verify-flow-engine-live.mjs` 10/10.
- `node --test experiments/owner-concept/verify-flow-engine.mjs` → **15/15**: 시드 1:1·한 번만·원본 닫힘, 결석 흐름 원인 사슬과 업무 문구, 확실한 판정의 검토 건너뜀·수납 항상 사람, AI 실패 시 일 유지, **느린 AI 동안 다른 처리 저장**, 재시작 시 판정 중단 기록, 다중 담당 요청·보완 요청·다시 열기, 원본 업무 → 로컬 후속, 멱등·revision·중복 시나리오·재시작 유지, 다른 지점/복사본/형식 거부, **잠금(동시 열기 하나만·쓰기 중 닫기·막 만들어진 빈 잠금 존중·죽은 잠금 회수·남의 잠금 보존·검증 실패 시 반납)**, `v3.0.0` 이름(끝 점 거부), 가명 맥락, **신뢰 날짜만 기한으로·AI 모듈 검증기 통과·코드 기한이 모델 긴급도보다 우선**, HTTP 가드·`assignable`.
- `node experiments/owner-concept/verify-flow-engine-live.mjs --http=http://127.0.0.1:4312` → **11/11**: 읽기 전용 트랜잭션, 할 일 238건 담당자 1:1(SQL 재대조), 관계 종류별 외래키 재대조, 직원 = 재직·플랫폼 제외, 시드 수, 실제 직원으로 결석·수납·원장 요청·원본 후속·대기열 재배정, 재시작 유지, **원본 표 지문(할 일·배정·이력·출결·수납·상담) 전후 동일**, 4312 가드(출처·잘못된 요청은 저장소 불변·작업 공간 POST는 JSON 405·assistant 유지·비공개 경로 404). 다른 사람이 같은 서버에 POST하는 중에는 "저장소 불변" 확인이 흔들릴 수 있습니다.
- 실제 판정 1회(`--ai`, 판정 규칙 r1 시점): 실제 결석 기록의 가명 맥락 → Jev 1.14 `auto_route`(할 일 0.97 · 관리자 0.03 · 안전 0.02), 332ms. 이어진 `case.analyze`는 캐시 적중(Jev 추가 0회) + Claude Sonnet 5.5 초안 7.97초. 사용량 = Jev 1 + Claude 1(조정자 승인 2 + 1 안).

## 근거 연결 (AX-H5)

- 신호마다 근거 기록이 어느 표의 번호인지 `flow-source.mjs` `SIGNAL_RECORD_TABLE`에 적습니다(영역의 첫 표로 짐작하지 않음 — 직원 평가 = 포트폴리오 + 만족도 판정). 기본 읽기에 없는 기록(만족도 판정·보강 예약·메이크에듀 동기화·반 공지·연동, 다른 달 청구 등)은 번호로 따로 읽습니다.
- `signalWiring()` = 신호별 기록 수·연결 수·상태(연결됨·일부만·연결 0건·기록 종류 모름·근거 번호 없음). 'ok'가 아니면 서버 로그·드라이런에 '배선 누락'으로 남기고, 화면의 그 단계 사유(`unassignedReason`)는 '근거 기록을 이 업무에 잇지 못해'·'이어 줄 근거 기록이 없어'로 적습니다.
- 담당: 결석·보강 예약 = 반 담당 강사, 원생상담 = 상담자, 수업보고서 = 쓴 선생님, 반 공지 = 보낸 사람, 만족도 판정·연동·동기화 = 관리자 대기열(강사평가는 그 강사에게 보내지 않음).
- 미리 보기: `node work/owner-concept/flow-reconcile-dryrun.mjs [--h4]` — 실제 저장소를 **읽기만** 해서 임시 사본에 재대조한 결과(닫힘·열림·바뀜·사건·근거 연결·계층 번호 대조·멱등)를 냅니다.

## 남은 것
- 구글 시트 연동 오류 신호(`sheet-sync-error`)는 근거 기록 번호가 없어 '배선 누락'으로 보입니다(연동 영역 근거가 메이크에듀 동기화뿐이라 신호가 가리킬 기록이 없음).

- 실제 판정 1회는 기한 연결(`requestedActionDate`) 전, 판정 규칙 r1 시점에 돌렸습니다. 조정자 지시대로 유료 호출은 다시 하지 않았고, 기한 연결은 AI 모듈의 맥락 검증기와 가짜 판정으로만 확인했습니다.
- 시나리오 업무의 `dueAt`은 비어 있습니다(지어내지 않음). 재원생 상담 기록에는 "요청된 상담일" 칸이 없어 상담 시나리오는 기한을 보내지 않습니다.
- 결석 확인 담당은 2.0과 같은 판정(출결 알림을 켠 재직 직원)입니다. 복사본에서는 참관 계정 하나가 그 의무를 지고 있어 결석 연락 단계가 그 계정에 갑니다(그 밖의 권한은 주지 않습니다).
- 수납 시나리오의 회계 담당 해석은 역할(accountant)뿐이라 복사본에서는 관리자 대기열로 갑니다.
- 예정 이벤트 3종(신규 문의·학부모 메시지·퇴원 요청)은 템플릿이 없습니다.
- 작업 공간 화면용 정적 파일 허용 목록(`flow-ui.*` 등)은 카탈로그 작업자 몫이라 여기서 바꾸지 않았습니다.
- 행위자 선택은 미리보기 역할 라우팅일 뿐 인증이 아닙니다.
