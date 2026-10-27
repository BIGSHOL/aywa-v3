# 업무 배정 판정 — Jev + Claude (로컬 dev 전용)

원장 화면 시안의 흐름(사건 → 판정 → 담당자 → 증거 → 다음 사건)에서 "새 기록이 일을 만드는가, 누구 일인가"를 정하는 **판정 전용** 서버 모듈입니다. 실행·발송·DB 쓰기를 하지 않습니다. 배포·운영 앱과 연결하지 않습니다.

- 숫자 판정 = **Jev**(TypeSafe System One, `jev-1.14.0` 고정). 확률·선택지만 냅니다.
- 담당자 = **코드**. 호출자가 DB 관계로 만든 후보 목록 안에서만 고릅니다. Jev는 사람·ID를 만들지 않습니다.
- 설명·다음 조치 초안 = **Claude**(`claude -p`, 이 PC의 claude.ai 구독). 검토가 필요한 건에만 백그라운드로. Anthropic API 키는 쓰지 않습니다.
- 각 값에 출처(`origin`: `jev` · `rule` · `adapter` · `claude-cli`)가 붙습니다. 규칙 문구를 AI 판단처럼 보이지 않게 합니다.

## 모델 고정 (2026-10-27 확인)

| 확인 | 결과 |
|---|---|
| `GET /v1/models` (키 인증) | 200 · 계정 목록 = 별칭 `jev-latest` · `jev-preview`만 |
| `POST /v1/systemone` model=`jev-1.14.0` | 200 · 응답 `model` = `jev-1.14.0` |
| `POST /v1/systemone` model=`jev-latest` | 200 · 응답 `model` = `jev-1.14.0` (2026-10-27T09:17:21Z) |
| 공식 모델 문서 | Jev 1.14 = 2026-10-14 출시 최신 정식판, `jev-preview`도 같은 모델(프리뷰 빌드 없음) |
| 목록가 | 입력 100만 토큰당 $0.042, 출력 무료 (docs.typesafe.ai/models) |

별칭은 새 버전이 나오면 답이 바뀌므로 버전 ID만 허용합니다(`jev-1.14.0`, 비교용 `jev-1.13.0`). 운영 `src/lib/ai/jev.ts`는 아직 `jev-1.13.0`입니다(이 작업은 운영 코드를 바꾸지 않음). 비용은 목록가 기준 **추정**이며 내부 요금제의 실제 청구액이 아닙니다.

## 연동 계약 `owner-decision/1`

```js
import { evaluateDecision, createDecisionEngine } from './decision-engine.mjs';
import { draftWithClaude } from './decision-claude.mjs';

const result = await evaluateDecision(context, { signal });          // 보통 0.2~1초, 실패해도 throw하지 않음
const draft  = await draftWithClaude(context, result, { signal });   // 수 초~수십 초, result.claudeRecommended일 때만
const engine = createDecisionEngine({ model: 'jev-1.14.0', timeoutMs: 8000, concurrency: 4, maxQueue: 64, cacheSize: 500 });
```

키: 기본은 `process.env.TYPESAFE_API_KEY`(호출 시점에 읽음). 로컬 dev는 `createDecisionEngine({ keyProvider })`(동기·비동기 모두 가능, 예외는 `jev_key_error` 검토 필요로 바뀜)에 `loadTypesafeKey()`(`decision-key.mjs`)의 값을 넘깁니다. 이 함수는 `OWNER_CONCEPT_TYPESAFE_KEY_FILE`(절대 경로)에서 `TYPESAFE_API_KEY` 한 줄만 읽고, 키 값·앞자리·길이·헤더를 로그에 남기지 않습니다.

### context (호출자가 만든다 — 좁고, 가린 값만)

| 필드 | 형식 | 뜻 |
|---|---|---|
| `recordId` | 문자열 ≤64 | 불투명 ID. 결과에 그대로 돌려줄 뿐 AI에 보내지 않음 |
| `source` | `parent_message` · `staff_note` · `system_event` · `consultation_note` · `task_comment` | 기록 종류 |
| `today`, `recordDate` | `YYYY-MM-DD`(KST) | 날짜 차이는 코드가 계산해 "오늘/어제/N일 전"으로 넣음. 미래 기록일은 거부 |
| `text` | ≤1,500자, 선택 | **이름은 이미 가린 글**(학생A·담임 등). 전화·주민번호·계좌·이메일 모양이 보이면 어떤 AI에도 보내지 않고 `invalid_context:unredacted_content` |
| `thread` | ≤5개 `{date, text≤500}` | 같은 기록 줄기의 앞선 글만(형제·다른 반 섞지 않기) |
| `facts` | ≤12개 `{키: 문자열≤120 · 숫자 · 참거짓}` | 코드가 만든 사실(`invoice_status`, `days_overdue` 등). 금액·날짜 계산은 코드에서 |
| `knownOpenWork` | ≤5개 `{area, code}` | **코드가 이미 아는 미해결 사실**(예 `{area:'billing', code:'invoice_overdue'}`). 있으면 Jev가 뭐라 하든 `no_action`으로 끝나지 않음 |
| `links` | `{student?, class?, invoice?, staff?: boolean}` | DB 관계가 있는지. 자동 배정의 증거 요건 |
| `candidates` | ≤20개 `{staffId, roles[], relation?}` | DB 관계로 고른 **자격 있는 직원**. AI에 보내지 않음 |

`roles` 값: `homeroom_teacher` · `subject_teacher` · `teacher` · `desk` · `billing` · `staff` · `manager` · `owner`.
흐름 계약(`actors.role` = owner/manager/teacher/staff)과의 대응: 그 학생의 담임 반 강사 → `homeroom_teacher`, 그 학생이 듣는 반 강사 → `subject_teacher`, 관계 없는 강사 → `teacher`(학업만, 최하위), 수납 권한 직원 → `billing`, 그 외 사무 직원 → `desk`/`staff`, manager → `manager`, owner → `owner`. 관계를 확인하지 못한 사람은 후보에 넣지 않습니다.

### DecisionResult

```js
{
  contract: 'owner-decision/1', recordId,
  status: 'decided' | 'review_needed' | 'cancelled',          // decided = auto_route 또는 no_action만
  route: 'auto_route' | 'no_action' | 'manager_review' | 'human_review' | 'insufficient_context',
  assignees: [{ staffId, role, origin: 'rule' }],               // candidates의 부분집합(최대 3)
  area: { value, confidence, probabilities, origin: 'jev' } | null,
  signals: { origin: 'jev', actionNeeded:{probability}, managerReview:{probability}, safetyConcern:{probability},
             contextSufficient:{probability}, secondArea:{probability},
             urgency:{ value:'today'|'this_week'|'no_deadline', confidence, probabilities } } | null,
  reasons: [{ code, origin: 'rule' | 'jev' | 'adapter' }],
  claudeRecommended: boolean,                                    // 이 결과에 Claude 초안이 도움이 되는가
  provider: 'typesafe', model: 'jev-1.14.0' | null,
  versions: { contract, questions: 'owner-decision-q1', rules: 'owner-decision-r1' },
  cache: { hit, shared, key }, elapsedMs, jevElapsedMs,       // shared = 같은 내용의 진행 중 호출에 합류(비용 0)
  usage: { inputTokens, outputTokens } | null,                   // 캐시 적중이면 원래 호출의 값
  cost: { estimatedUsd, basis, billedThisCall },                 // 목록가 추정 · HTTP 1회당 한 소비자만 billedThisCall=true
  claude: { status: 'not_requested' },
}
```

`area.value`: `attendance` 출결 · `billing` 수납 · `academic` 학습 · `counseling` 상담 · `enrollment` 신규·입학 · `schedule` 시간표 · `staff_hr` 직원 인사 · `operations` 시설·운영 · `none` 할 일 없음 · `unclear` 할 일은 있는데 무엇인지 모름.

Noul 값은 "예"일 확률 하나뿐이며 별도 신뢰도가 없습니다. Choice의 `confidence`는 분포 모양에서 계산한 값(공식 문서의 `(p_max − 1/n)/(1 − 1/n)`)이지 **정답률이 아닙니다**.

실패(키 없음·시간 초과·429/529·답 형식 오류·회로 차단·대기열 초과·잘못된 맥락)는 `status:'review_needed'`, `route:'human_review'`, `signals:null`, 사유 코드(`jev_timeout` 등)로 돌려줍니다. 가짜 확률을 만들지 않고, 일을 버리지 않습니다. 호출자가 취소하면 `status:'cancelled'`.

### ClaudeDraft

```js
{ status: 'drafted' | 'not_applicable' | 'busy' | 'unavailable' | 'timeout' | 'cancelled' | 'invalid_output',
  origin: 'claude-cli', model, explanation, nextAction: { title, body } | null, missingInfo: [],
  routeConcern: 'none' | 'route_may_be_wrong' | 'needs_more_context' | null,
  apiEquivalentUsd, usage, elapsedMs }
```

`apiEquivalentUsd`는 CLI가 보고하는 목록가 환산값이며 구독 요금의 실제 추가 비용이 아닙니다. 초안은 담당자가 검토할 글일 뿐 아무것도 보내지 않습니다.

## 경로 규칙 `owner-decision-r1` (코드)

임계값은 공식 문서의 출발점(예 0.7 / 아니오 0.3)을 보수적으로 조인 값이며, 이 학원 데이터로 보정한 값이 아닙니다.

1. 안전·법적 신호 p ≥ 0.3 → `manager_review`(높은 재현율).
2. 할 일 p ≤ 0.2 → `no_action`. 단 업무 영역이 뚜렷하거나(신뢰도 ≥ 0.6) 관리자 신호 ≥ 0.3, 오늘 처리 신호, `knownOpenWork`가 있으면 `human_review`.
3. 할 일 p 0.2~0.7 → `human_review`(`uncertain_action`).
4. 맥락 충분 p < 0.5 또는 영역 `unclear` → `insufficient_context`(사람이 되묻기).
5. 영역 신뢰도 < 0.5 → `human_review`. 관리자 신호 ≥ 0.3 또는 직원 인사 → `manager_review`.
6. 다른 영역의 둘째 일 p ≥ 0.5 → `human_review`(사람이 나눔).
7. 증거 요건: 출결·상담은 학생 관계, 학업은 학생 또는 반, 수납은 학생 또는 청구서 관계가 있어야 자동 배정.
8. 영역별 역할 우선순위에서 후보가 있는 첫 역할의 사람(최대 3명) → `auto_route`. 없으면 `human_review`(`no_eligible_staff`).

## 캐시·동시성·취소

- 캐시 키 = sha256(계약·질문·규칙 버전 + 모델 + 질문 + Jev 상태). 저장하는 것은 Jev 답이고 규칙은 매번 다시 적용하므로 후보 목록이 바뀌면 담당자도 바뀝니다. LRU 500개.
- 같은 내용의 동시 요청은 HTTP 한 번을 나눠 씁니다. 토큰·비용·실패는 한 소비자만 셉니다(나머지는 `cache.shared:true`, 비용 0). 모든 호출자가 취소해야 그 요청을 끊습니다.
- 동시 4건, 대기 64건(넘치면 `adapter_busy`로 검토 필요). 자동 재시도 없음. 서비스 오류 3번 연속 또는 인증 실패 시 30초(또는 `retry-after`) 동안 호출하지 않고 `jev_circuit_open`.
- 제한 시간 8초(응답 본문 읽기 포함). Claude는 한 번에 1건, 대기 4건, 120초.

## 파일

| 파일 | 역할 |
|---|---|
| `decision-engine.mjs` | `evaluateDecision` · `createDecisionEngine` |
| `decision-questions.mjs` | 맥락 검증 · Jev 상태 · 질문 7개 |
| `decision-policy.mjs` | 경로 규칙 · 담당자 선택 |
| `decision-jev.mjs` | System One 전송 · 응답 검증 · 모델 목록 · 목록가 |
| `decision-key.mjs` | 키 한 줄 읽기 |
| `decision-claude.mjs` · `decision-claude-cli.mjs` | Claude 초안 · 안전한 CLI 실행 |
| `decision-eval*.mjs` | 합성 데이터 평가(호출 예산 기록 포함) |
| `verify-decision*.mjs` | 오프라인 테스트 |

평가 결과는 아래 "평가"에 채웁니다.
