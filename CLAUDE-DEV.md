# 로컬 비서 — 이 PC의 Claude 구독으로 답하기 (dev 전용)

원장 화면 시안의 대화 입력을 이 PC에 로그인된 Claude 구독(`claude -p`)으로 답하게 하는 로컬 개발 서버 기능입니다. 배포·운영 앱과는 연결하지 않습니다. DB에 쓰지 않고, 메시지·알림·업무 요청을 실제로 보내지 않습니다.

## 실행

```powershell
$env:OWNER_CONCEPT_PORT=4312; node experiments/owner-concept/serve-live.mjs
```

시작 로그에 `Assistant: claude -p via claude.ai subscription (max, firstParty) · /api/assistant`가 보이면 준비된 것입니다. 로그인 이메일·조직 정보는 출력하지 않습니다. 준비되지 않으면 `Assistant unavailable: <code>`가 보이고 요청은 503으로 응답합니다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `OWNER_CONCEPT_CLAUDE_BIN` | `%USERPROFILE%\.local\bin\claude.exe` | CLI 실행 파일(절대 경로) |
| `OWNER_CONCEPT_CLAUDE_RUNTIME` | 데이터 폴더 옆 `claude-runtime` (`F:/aywa-dev/claude-runtime`) | CLI 작업 폴더 |
| `OWNER_CONCEPT_CLAUDE_MODEL` | `sonnet` | `sonnet` · `opus` · `haiku`만 허용 |
| `OWNER_CONCEPT_CLAUDE_EFFORT` | `low` | `low` · `medium` · `high`만 허용 |
| `OWNER_CONCEPT_ASSISTANT=off` | — | 기능 끄기(404) |

`NODE_ENV=production`, `VERCEL`, `VERCEL_ENV`가 있으면 항상 꺼집니다(404, CLI를 실행하지 않음).

## 계약

`POST /api/assistant` · `Content-Type: application/json` · 같은 출처(Origin = `http://127.0.0.1:<port>` 또는 `http://localhost:<port>`)

```json
{ "prompt": "10월 미납 얼마야?", "contextIssueId": "billing", "history": [{ "role": "user", "content": "…" }] }
```

- `prompt` 1~1,000자, `contextIssueId`는 `null` 또는 `billing` `admissions` `attendance` `approval` `tasks` `books` `enrollment`.
- `history` 최대 12개, 각 1~2,000자, 합계 8,000자, `role`은 `user`·`assistant`. 생략하면 `null`·`[]`. 다른 키가 있으면 400.
- 본문 32KB 이하.

성공(200):

```json
{ "answer": "…", "issueIds": ["billing"], "suggestedTask": { "title": "…", "body": "…" }, "provider": "claude-cli" }
```

`suggestedTask`는 없으면 `null`입니다. 원장이 화면에서 직접 보낼 수 있는 **초안**일 뿐이며 서버는 아무것도 보내지 않습니다. 답변이 무언가를 보냈거나 바꾼 것처럼 읽히면 끝에 `※ 이 답변은 초안입니다. 실제 발송·요청·데이터 변경은 하지 않았습니다.`를 붙입니다. `answer`는 일반 텍스트이므로 화면에서는 이스케이프해서 표시합니다.

실패는 `{ "error": "<code>", "message": "<화면에 그대로 보여도 되는 한글>" }`입니다.

| 상태 | code |
|---|---|
| 400 | `invalid_request` |
| 403 | `forbidden_origin` |
| 404 | `not_found`(꺼짐) |
| 405 | `method_not_allowed` |
| 408 / 413 / 415 | `request_timeout` / `body_too_large` / `unsupported_media_type` |
| 429 | `busy`(한 번에 1건, `Retry-After: 5`) · `rate_limited`(5분에 10건 또는 Claude 사용 한도) |
| 502 | `invalid_output` · `cli_failed` |
| 503 | `cli_missing` · `auth_required` · `subscription_required` · `runtime_unsafe` |
| 504 | `timeout`(90초) |

브라우저가 요청을 끊으면(AbortController) 실행 중인 CLI를 종료합니다. 응답은 보통 5~15초 걸립니다.

## 근거 데이터 — 서버가 만든다

`serve-live.mjs`가 시작할 때 이미 검증한 스냅샷에서 `claude-bridge-context.mjs`가 이슈 7개의 집계를 한 번 계산합니다. 브라우저가 보낸 숫자는 사실로 쓰지 않습니다. 선택 조건은 `ax.js`의 이슈 정의와 같습니다.

- 들어가는 것: 기준일, 건수·금액 합계, 최근 6개월 추이, 상태·종류별 건수, 분포 구간, 기준과 주의 문구.
- 들어가지 않는 것: 학생·직원·상담자 이름, 연락처, 상담·업무·결재 본문과 제목, 급여, 인증 행, 접속 정보, DB 전체.
- 수납 잔액 = **할인 전 금액 − 할인액 − 수납액**(취소·환불 제외). 2026-10 청구분 잔액 329,000원·14건, 할인 1,987,500원은 미납이 아닙니다.
- 월별 청구 대상 원생(그 달 수강료가 청구된 학생)과 현재 재원생(학생 상태)은 다른 지표로 따로 적습니다.

포커스 이슈가 있으면 개요와 그 이슈만, 없으면 개요와 7개 이슈 집계를 보냅니다(약 2.6KB). 사용자가 보낸 질문·대화는 요청마다 다른 임의 표식으로 감싼 JSON으로 넣어, 신뢰 블록을 닫거나 위조할 수 없습니다.

## CLI 실행 방식과 차단 장치

- 실행 파일을 직접 실행합니다(`shell:false`). 인자는 서버가 켜져 있는 동안 고정이며 요청 내용은 **stdin으로만** 들어갑니다.
- 인자: `-p --output-format json --json-schema … --system-prompt … --model sonnet --effort low --tools "" --disallowedTools mcp__* --strict-mcp-config --mcp-config {"mcpServers":{}} --safe-mode --restricted --no-chrome --no-session-persistence --disable-slash-commands --permission-mode dontAsk --permission-prompts none --max-budget-usd 0.5`
  - 도구·MCP·훅·플러그인·스킬·CLAUDE.md·사용자/프로젝트 설정·세션 기록이 모두 꺼집니다. 권한 우회 옵션은 쓰지 않습니다.
  - `--bare`는 쓰지 않습니다. 구독 로그인(OAuth)을 읽지 않고 API 키만 쓰기 때문입니다.
- 자식 환경 변수는 허용 목록입니다. `ANTHROPIC_*` 키·주소, Bedrock/Vertex/Foundry 전환, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, 상위 세션 변수, DB 접속 정보는 넘기지 않으므로 기본 위치에 저장된 구독 로그인만 쓰입니다. 텔레메트리·자동 업데이트도 끕니다.
- 작업 폴더는 저장소 밖의 빈 폴더입니다. 그 폴더나 상위 폴더에 `CLAUDE.md` `CLAUDE.local.md` `.claude` `.mcp.json` `.git`이 있거나 저장소 안이면 실행하지 않습니다.
- 서버 시작 시와 15분마다(실패하면 30초 뒤) `claude auth status`로 로그인 방식을 확인합니다. 과금되지 않습니다. `claude.ai` 구독·firstParty가 아니면 호출하지 않으며 API 방식으로 대신 호출하지 않습니다.
- 동시 1건, 5분에 10건, 90초 시간 제한, 표준 출력 512KB 제한. 시간 초과·취소·출력 초과 시 Windows는 부모가 살아 있을 때 `taskkill /T /F`로 프로세스 트리를 먼저 종료하고, 남으면 부모를 직접 종료합니다(부모를 먼저 끄면 Job 밖 하위 프로세스가 남는 것을 테스트로 확인). 하위 프로세스가 출력 파이프를 붙잡아도 3초 뒤 강제로 마무리해 1건 슬롯이 막히지 않습니다.
- 오류 원문(stderr·경로·키 모양 문자열)은 응답에 넣지 않고 한글 요약만 돌려줍니다. 서버 로그에는 결과 코드·소요 시간·모델 이름만 남깁니다.

## 검증

```powershell
node --test experiments/owner-concept/verify-claude-bridge.mjs          # 오프라인, Claude 호출 없음
node experiments/owner-concept/verify-claude-live.mjs                   # 로컬 DB + 4312 서버, Claude 호출 없음
node experiments/owner-concept/verify-claude-live.mjs --call            # 위 + 실제 구독 호출 1회
```

- 오프라인 테스트는 가짜 CLI(`verify-claude-fake-cli.mjs`)로 인자 고정·stdin 전달·환경 변수 제거·시간 초과/취소/연결 끊김 시 종료·출력 초과·인증/한도/형식 오류 분류·오류 원문 비노출·출처/형식/크기 검증·동시 1건·횟수 제한·인증 실패와 꺼짐 상태의 무호출을 확인합니다.
- 라이브 검증은 실제 스냅샷 문맥에 사람 이름(학생·직원·상담 954개)과 전화번호가 없는지, 잔액 계산이 화면과 같은지 확인합니다. `--call`은 응답 형식과 잔액 금액 사용을 확인합니다.

2026-10-27 관찰: Claude Code 2.1.311, `claude auth status` = claude.ai · max · firstParty. 실제 호출은 `claude-sonnet-5-5`로 약 5.6초에 끝났고 작업 폴더는 비어 있었습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `claude-bridge-context.mjs` | 스냅샷 → 이슈별 집계 문맥 |
| `claude-bridge.mjs` | CLI 인자·환경·작업 폴더·실행·종료·오류 분류·인증 확인 |
| `claude-bridge-prompt.mjs` | 요청 검증, stdin 조립, 응답 정규화 |
| `claude-bridge-http.mjs` | `/api/assistant` 경로, 출처·형식·크기·동시성·횟수 제한, 서버 연결 |
| `verify-claude-*.mjs` | 테스트와 가짜 CLI |
