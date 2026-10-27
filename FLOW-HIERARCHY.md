# 이슈 계층 — 원생 → 반 → 강사 → 관리자·원장 (로컬 dev 전용)

원본 신호 하나(지금은 **'결석 3회 이상 재원생'**)를 외래키로만 학원 → 강사 → 반 → 원생 → 근거 기록 나무로 펼치고, 아래에서 위로 AI가 거르고 요약합니다. 숫자·ID·담당은 코드가, AI는 **순서와 설명만** 맡습니다. 원본 DB는 읽기만 하고, AI 결과는 흐름 저장소 옆 별도 파일에만 남습니다. 배포·운영 앱과 연결하지 않습니다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `flow-hierarchy.mjs` | 나무 만들기(순수 함수). 지원 신호 목록 `ADAPTERS`, 단계 재계산, 보고 범위, 코호트 검증, 오류(`HierarchyError`) |
| `flow-hierarchy-ai.mjs` | 단계 정책 `STAGES`, 가명(S-/C-/T-), Jev 질문, Claude 프롬프트·스키마, 출력 검증, 가명 → 로컬 라벨 |
| `flow-hierarchy-providers.mjs` | 전송: Jev = 기존 키 어댑터, Claude = 구독 CLI(`claude -p`). 운영 API 전송은 인터페이스만(켜면 `transport_disabled`) |
| `flow-hierarchy-runtime.mjs` | 백그라운드 큐·캐시·예산·재시도·저장(`hierarchy-ai/state.json`) |
| `flow-hierarchy-view.mjs` | GET 응답 조립(노드별 AI 상태·stale·근거 id·analysis) |
| `verify-flow-hierarchy.mjs` (+`-fixture`) | 오프라인 테스트(DB·네트워크 없음) |
| `verify-flow-hierarchy-live.mjs` | 실제 복사본 재대조(+ `--http=` 실행 중 서버) |

함께 바꾼 기존 파일: `flow-source.mjs`(원생 재원 상태·학교·학년, 청구 금액 칸 — 서버 안에서만), `flow-commands.mjs`(보고 근거 인가 범위), `flow-service.mjs`·`flow-http.mjs`(연결), `flow-view.mjs`(`scenarioCandidates`), `serve-live.mjs`(`/context-picker.js`·`.css` 허용).

## 기준 — 원본 신호를 그대로

- 복사본 신호(`domain-snapshot-academic2.mjs`): **이번 달 1일~기준일**, 정정 반영 출결 중 결석, **재원(enrolled)**, 테스트 원생 제외, 원생별 결석 기록 **3건 이상**. 수업별 출결 칸 단위이며 사유·위험을 단정하지 않습니다.
- 2.0 반복 결석 알림은 **최근 14일 3/5/10회** 단계라 기준이 다릅니다. 응답 `basis.note2_0`에 그대로 적고, 이 화면은 해석을 바꾸지 않습니다.
- 실측(복사본 2026-10-27): 원생 80 · 결석 기록 414 · 반 57 · 강사 15(재직 아님 1명, 기록 4건) · 두 반 이상 원생 24 · 반·담임 미상 0. 이번 달 결석 전체 534건 중 코호트 414건만 들어갑니다(독립 SQL 재대조).

## 나무 만들기 (코드)

- 근거 = `source.signals[].refs` 전부. 시드는 업무·단계마다 근거를 50건까지만 저장했지만(이 사례 300/414) 나무는 414건 전부를 씁니다. 원래 단계 정체성은 **시드와 같은 외래키 규칙**(`classes.teacher_id`가 재직 직원이면 그 강사 단계, 아니면 관리자 대기열 단계, 근거 순서대로 번호)으로 다시 계산하고, 저장된 50건과 어긋나면 `warnings: step_mismatch`.
- 강사 → 반 → 원생 → 기록. 반이 없거나 담임이 없는 기록은 `teacher:unknown` / `class:unknown:<부모>` 묶음에 `unassigned:true`로 따로 둡니다. 재직이 아닌 담임은 `status:'inactive'`.
- 여러 반 원생은 반마다 원생 노드가 따로 있고, 위로 갈수록 **중복 없이** 셉니다(실측: 강사별 원생 합 108 ≠ 전체 80).
- 노드 ID는 안정적입니다: `academy`, `teacher:<직원 id>`, `class:<반 id>`, `class:<반 id>/student:<원생 id>`.
- 코호트 검증(`coverage.cohortCheck`): 3건 미만 원생·기간 밖 기록·재원 아닌 원생 수. 하나라도 있으면 `warnings: cohort_mismatch`와 `coverage.complete:false`(관계가 다 이어져도).

### 처리 상태(흐름)

원본 업무는 원본 기록이 바뀔 때만 닫히므로(`closure:'fact'`) 처리는 보고 근거(`case.evidence`)로 봅니다. 보고는 단계 안에서 **기록 하나 · 원생 · 반 · 단계 전체(근거를 안 붙인 보고)** 범위를 가지며, 기록마다 그중 **가장 최근 보고**가 적용됩니다(같은 시각이면 좁은 범위). 원생 노드는 모든 기록이 덮여야 `reported`, 일부면 `partial`(+`coverage{covered,total}`), 사람이 `needs_review`·`unreachable`로 보고한 기록이 하나라도 있으면 그 상태가 이깁니다. 반·강사·학원은 자식 상태를 모아 같으면 그 상태, 다르면 `partial`(+`byState`). 한 원생 보고가 다른 강사 반의 같은 원생을 닫지 않습니다.

보고 근거 인가(`flow-commands.mjs` `reportRefKeys`): 계층을 지원하는 신호 업무는 **보고하는 그 단계의 전체 근거(50건 제한 없이) + 외래키 한 단계**만 붙일 수 있습니다. 다른 강사 단계의 기록·무관한 기록은 계속 `record_ref_not_allowed`. 이 업무의 보고만 `recordRefs` 상한이 60(원생 칸 하나의 기록 전부 — 실측 한 반 한 원생 최대 18건), 다른 업무·명령은 20 그대로입니다. 화면은 원생 칸에서 연 보고에 그 칸의 `records[].id`를 빠짐없이 보내고, 강사 단계 전체 보고는 근거 없이 보냅니다.

집계 노드의 `flow.byState`는 모든 단계에서 **원생 칸 수**(반별 원생 노드)입니다. 중복 없는 원생 수는 `root.facts.studentsByFlowState`.

## AI 단계 (정책 `hier-p4`, 동결)

| 단계 | 모델(실제 응답 모델) | 단위 | 하는 일 |
|---|---|---|---|
| S1 원생 | Jev `jev-1.14.0`(추론 설정 없음) | **원생마다 1회**(여러 반 원생은 한 번만, 반 노드들이 공유) · 동시 4 | 확인 순서(먼저/이번 주/일반, Choice) + 관리자도 볼지(Noul) |
| S2 반 | 호출 없음 | — | 코드 집계. 반별 한 줄은 S3가 같은 호출에서 씀 |
| S3 강사 | Claude CLI `sonnet`/`low`(→ `claude-sonnet-5-5`) | 강사 묶음(최대 4명·원생 칸 24) · 동시 2 | 강사 요약·이유·조치 초안·관리자 확인 필요 여부 + 반별 한 줄 |
| S4 학원 | Claude CLI `sonnet`/`low` | 사례당 1회 | 관리자 요약(이번 주 볼 강사 묶음) + 원장 요약(전체 흐름·사람이 정할 일) |

- **승급**: 강사 아래 원생 중 Jev 순서가 애매하거나(Choice 집중도 < 0.35) 기록 사실과 어긋나면 그 강사는 `sonnet`/`medium`. 기본 등급 출력이 검사에서 걸리면 한 번만 `medium`으로 다시. 그 뒤에도 걸리면 오류로 남깁니다.
- **애매함은 사람에게**: 애매한 원생은 `ai.status:'review_needed'`. `manager_attention` 0.3~0.7은 '애매함' 표시만 합니다(그 구간만으로 실측 12명 중 5명이 검토로 몰려서).
- **숨기지 않음**: 순서가 '일반 확인'이어도 노드는 그대로이고 `deprioritized:true`로 보입니다. AI는 담당 변경·발송·마감·삭제를 못 하며 흐름 상태에 쓰지 않습니다.
- **보고 끝난 일**: 원생의 모든 반이 `reported`·`not_needed`면 S1을 건너뜀(`skipped`), `needs_review`·`unreachable`이면 AI 없이 `review_needed`. 강사 아래가 모두 보고되면 S3도 건너뜁니다. 끝난 일을 다시 올리지 않습니다.
- **부모는 기다림**: 사례의 원생 판정이 모두 끝난 뒤 강사 묶음을 짜고, 강사가 다 끝난 뒤 학원 요약. 재시도가 남은 자식이 있으면 기다리고, 끝난 오류가 있으면 `partial:true`로 진행합니다.
- **수납·인사·안전**: 이 신호는 출결이라 해당 없음. 그런 영역의 신호를 붙일 때는 항상 사람 검토로 둡니다(`flow-decision.mjs` `ALWAYS_REVIEW`와 같은 원칙).

### AI에 보내는 것 / 안 보내는 것

- 보냄: 가명 id(`S-`/`C-`/`T-` + sha256 8자, 사례별 고정), 결석 기록 수·날짜·반 수·최근 7일 수·처리 상태(한글 값), Jev 라벨, 강사 요약 글(검증된 AI 글, 가명).
- 안 보냄: 원생·직원 이름, 학교·학년, 반 이름, 연락처, 급여, 자유 글, 원본 id. 화면에서는 검증된 글의 가명을 로컬 라벨로 바꿔 보여 줍니다(`renderText`).
- Claude 입력은 키·값을 한글로 씁니다. 영어 코드(`open`·`first` 등)를 주면 글에 그대로 옮겨서였습니다(실측).

### 출력 검사 (통과한 것만 저장)

JSON 스키마 · 강사·반 누락/중복 · 근거 id ⊂ 보낸 가명 · 글에 나온 대상 id ⊂ 입력 · **글에 숫자 없음**(가명 속 숫자 제외) · 영어 코드 노출 · 사유·위험 단정 표현(위험·이탈·퇴원·질병 등). 실패는 `error`(`invalid_output` + 이유)로 보이고 가짜 요약은 없습니다. 진단용으로 걸린 숫자 조각만(`numbers`, 가명 글) 저장합니다.

- 숫자를 아예 금지한 까닭: "입력에 있는 숫자만 허용"은 의미를 보장하지 못합니다 — 실측에서 haiku 학원 요약이 사람 확인 원생을 "6명"이라 썼는데(실제 3명) 6이 입력의 다른 자리에 있어 통과했습니다. 건수·날짜는 코드 칩(`counts`·`facts`)이 보여 주고, Claude 글은 어느 원생·반·강사를 먼저 볼지와 그 까닭만 씁니다. Claude 결과에는 `draft:true` + `note`(AI 초안)가 붙습니다.
- 검사를 통과해도 내용이 사실이라는 보장은 아닙니다(대상·숫자·표현의 형식만 확인).
- 입력의 키·값에도 숫자를 두지 않습니다(`최근일주일결석`, `마지막결석: 최근 일주일 안|지난주|두 주 넘음`, 기준은 "세 번 이상"). v3에서 가장 큰 두 강사가 키 이름 "최근7일"을 글로 옮겨 승급 뒤에도 실패했기 때문입니다.

### 큐·캐시·예산

- 결과 키 = sha256(정책 버전 · 단계 · 등급 · **가명 입력 전체**). 같은 입력은 새로고침·폴링·재시작에도 다시 부르지 않습니다. 증거가 바뀌면 그 원생 → 그 강사 → 학원만 키가 바뀝니다(실측·테스트: t2 단계 보고 → Jev 5회 + Claude 1회).
- 저장 = `<흐름 저장소>/hierarchy-ai/state.json`(같은 잠금·원자적 쓰기·지점/복사본 확인). 마지막 성공 결과를 노드마다 기억해, 새 결과가 나오기 전에는 `stale:true`로 이전 결과를 보여 줍니다.
- 예산: Jev 시간당 240, Claude 시간당 24(넘으면 `queued` + '이 PC의 시간당 호출 한도로 대기'). 일시 오류(시간 초과·한도·연결)는 10분 뒤 한 번만 다시. 키 없음·검사 실패는 다시 부르지 않습니다.
- 켜기: `OWNER_CONCEPT_HIERARCHY_AI=on`(+ `OWNER_CONCEPT_TYPESAFE_KEY_FILE`). 기본은 꺼짐 — 기존 테스트와 다른 서버는 호출하지 않고, 저장된 결과만 읽습니다(`analysis.status:'disabled'`). `NODE_ENV=production`·`VERCEL`이면 항상 꺼짐.

## API

`GET /api/flow/hierarchy?caseId=<id>` (GET/HEAD, 같은 출처 가드, **provider 호출 0**). `ETag`(사례·흐름 revision·AI 결과 revision·큐 상태 포함) + `If-None-Match` → 304. 사례 유효성(404/422)을 먼저 확인한 뒤에만 304로 답합니다. 지원 사례: `src-sig-attendance-attendance-repeat-absence`.

오류 `{error, message}`: 400 `invalid_request`(caseId 하나만) · 404 `case_not_found` · 422 `hierarchy_unsupported`(관계 나무가 없는 업무 — 기존 순차 흐름 유지) · 422 `hierarchy_no_relationships` · 503 `flow_starting` · 405 · 403 `forbidden_origin`.

```text
{ schemaVersion:1, caseId, flowRevision, sourceFingerprint, basis{asOf,capturedAt,label,window,threshold,cohort,interpretation,note2_0},
  counts{students,classes,teachers,records,unmappedRecords}, units{…}, warnings[{code,message}],
  coverage{complete,totalRecords,returnedRecords,notes[],seedTruncation{entityRefs,stepRefs},unknown{teacherRecords,classRecords},cohortCheck{belowThreshold,outsideWindow,notEnrolled,ok}},
  root{ id:'academy', level, label, counts, stepIds, status, flow, facts, ai, children:[teacher → class → student] },
  managerSummary{…ai, facts}, ownerSummary{…ai, facts},
  analysis{status:'disabled|idle|running|partial|complete', revision, version, updatedAt, completed, running, pending, failed, skipped, stale, reviewNeeded, transport, policy{version,fingerprint,stages[]}, budget{…}} }
node = { id, level, label, detail?(원생 학교학년), entityRef?, unassigned?, stepIds[], counts, status, flow{state,scope,coverage?,byState?,reportedAt,followupCaseIds}, facts{origin:'code',…},
         records?[{id,date,status,statusLabel,familyId,recordId,classId,teacherId}], children[],
         ai{status:'not_started|queued|running|ready|review_needed|error|stale|skipped', stale, reason?, summary?, reasons?, suggestedAction?, evidenceIds?(노드 id),
            priority?, priorityLabel?, deprioritized?, uncertain?, managerAttention?, probabilities?{…, note}, attention?, origin, provider, model, modelLabel, effort, tier, partial, updatedAt} }
```

확률 표시: Choice `confidence`는 분포 집중도, Noul은 모델 추정값이며 **측정된 정확도가 아닙니다**(`probabilities.note`).

## 모델 선택 — 실측 (2026-10-27, 소규모 · 정확도 일반화 아님)

공식 문서 확인: Jev는 요청당 state 하나·배치 엔드포인트·샘플링/추론 설정 없음, 1.14가 최신(`jev-latest`=`jev-1.14.0`). Claude Code 2.1.311 구독(max·firstParty)에서 별칭 `sonnet`/`haiku`/`opus` = 5.5, effort `low`~`max`(기본 medium). 실제 응답 모델은 `claude-sonnet-5-5` · `claude-haiku-5-5`로 확인.

| 실험 | 결과 |
|---|---|
| Jev 원생 판정(실제 가명 12명, 동시 4) | 호출당 165~353ms, 입력 820~1,016토큰, 12건 0.75초. 합성 4건(많고 최근·여러 반 / 3건·20일 전 / …)은 예상 순서와 같음(연기 검사 수준) |
| Jev 반 묶음(state 1개에 4명·질문 8개) vs 개별 4회 | 187ms·2,570토큰 vs 각 ~180ms·합 3,501토큰. **4명 중 2명 답이 달라짐**(서로 영향) → 원생 단위 캐시가 깨져 개별 호출 채택 |
| Claude 강사 묶음(실제 3명 + 합성 1명, 입력 6KB) | haiku-low 22.6초·출력 6,090토큰·**숫자 검사 실패** / sonnet-low 27.4초·2,803토큰·통과 → sonnet-low |
| Claude 학원 요약(입력 3.3KB) | sonnet-low 10.1초 통과 / sonnet-medium 9.2초 **계산 숫자로 실패** / haiku-low 15.2초 통과(출력 3,615토큰) → sonnet-low |
| 순차 vs 병렬 | Jev 80명 ≈ 5초 vs Claude 강사 묶음 ≈ 20~30초/회. Claude가 Jev 라벨을 쓰므로 Jev → Claude 순차, 병렬은 서로 독립인 강사 묶음끼리만(동시 2) |
| 공통 | 두 모델 모두 원시 코드(`open`·`first`·`uncertain`)를 글에 옮김 → 입력을 한글 키·값으로 바꾸고 검사 추가 |
| 실서버 1차(4315, p2: 입력 숫자 허용) | Jev 80회 p50 180ms·최대 286ms·전체 3.8초 → 강사 묶음 6회(기본 sonnet-low 1회 11.7초, 승급 sonnet-medium 5회 11.8~26.1초 — 애매한 원생이 있는 강사 12명) → 학원 16.5초. 시작~완료 84초, 오류 0. 단계 보고 1건 뒤 Jev 2회 + Claude 1회(학원)만 다시, 강사 13명 요약은 캐시 |
| 실서버 2차(4315, p3: 숫자 금지) | 강사 15명 중 13명 통과, 가장 큰 두 강사는 기본·승급 모두 숫자 검사 실패 → `error`, 학원 요약은 `partial`로 정직하게 표시. 원인(입력 키·값의 숫자 echo)을 p4에서 제거 — p4 실측은 main 첫 실행에서 |

API 환산액(CLI 보고, 구독 실제 청구 아님): 강사 묶음 sonnet-low 0.049 USD · haiku-low 0.004 USD, 학원 sonnet-low 0.029 USD.

## 검증

- `node --test experiments/owner-concept/verify-flow-hierarchy.mjs` → **9/9**: 50건 넘는 근거 전부·중복 없는 수·여러 반 원생·미상/재직 아님 묶음·오류 코드·코호트 경고, 보고 범위(기록 일부 = partial, 새 단계 보고 > 옛 기록 보고 > 옛 단계 보고), 51번째 이후 근거 허용 + 다른 단계·무관 기록 거부 + 상한 60/20, byState 단위, Jev 원생당 1회·Claude 묶음·GET/재시작 무호출, 바뀐 증거만 다시(+ stale 표시), 애매 → 승급·검사 실패 → 1회 승급·키 없음 → 가짜 없음·partial, 검증기(숫자·대상 id·코드·단정), 예산·꺼짐, HTTP(ETag/304·다른 사례 태그로 304 안 됨·오류·가드).
- `node --test experiments/owner-concept/verify-flow-engine.mjs` → 15/15(기존).
- `node experiments/owner-concept/verify-flow-hierarchy-live.mjs [--http=http://127.0.0.1:4315]` → 읽기 전용, 독립 SQL 코호트와 기록 id·원생 수·반/담임 FK 일치, 이번 달 결석 전체가 아니라 코호트만, 시드 단계 정체성, 부모 중복 제거, 원본 표 지문 전후 동일.

## 한계

- 지원 신호는 하나입니다. 새 신호는 `ADAPTERS`에 기록 → 원생/반 매핑과 기준 문구를 더하고, 단계 재계산 규칙이 시드(`flow-engine.mjs` `signalOwner`)와 같은지 확인해야 합니다.
- 담임은 지금의 `classes.teacher_id`입니다(그 달에 담임이 바뀌었으면 결석 당시 담임과 다를 수 있음).
- 재직 아닌 담임의 기록은 원본 업무에서 관리자 대기열 단계 하나에 모여 있어 그 강사 노드의 `stepIds`도 대기열 단계입니다.
- Jev 판정은 숫자·날짜만 보므로 코드 규칙과 크게 다르지 않습니다. 학부모 글 같은 근거가 붙을 때 값이 커집니다. 임계값(0.35)은 이 학원 데이터로 보정한 값이 아닙니다.
- Claude CLI 동시 2는 이 PC 구독에서 한 번 확인한 값입니다.
