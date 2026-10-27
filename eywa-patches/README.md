# eywa에 적용할 변경 (3.0 작업 중 이 폴더 밖에서 한 것)

3.0 시안 작업(2026-10-27) 중 eywa 저장소의 이 폴더 **밖**에서 바꾼 파일입니다. eywa 브랜치 `chrismathone/v3.0.0`에는 커밋돼 있지만 eywa main에는 아직 반영하지 않았습니다. 이 레포만 받아도 같은 변경을 eywa에 그대로 옮길 수 있도록 패치로 남겼습니다.

| 패치 | 바꾸는 파일 | 내용 |
|---|---|---|
| `0001-agents-scroll-chart-principles.patch` | `AGENTS.md` | 사용자 지시로 정한 **스크롤 UI 원칙**·**차트 상호작용 원칙**(2026-10-27) 두 절 추가. 원문은 `../HANDOFF.md` §5.7, 이 레포 최상위 `AGENTS.md`에도 있음 |
| `0002-pin-jev-1.14.0.patch` | `src/lib/ai/jev.ts` · `src/lib/ai/generate-decision.test.ts` · `src/features/attendance/parent-alerts/server/jev-shadow.test.ts` | 2.0의 Jev 어댑터를 `jev-1.13.0` → `jev-1.14.0`(최신)으로 고정. 사용자 지시 *"jev 버전 확인하고 최신버전으로"* |

## 확인한 것 (2026-10-27 22:18)

- 두 패치 모두 그 시점 eywa `origin/main`에 `git apply --check` 통과, 적용 결과가 브랜치의 파일과 같음.
- `0002` 적용 상태에서 `vitest run src/lib/ai/generate-decision.test.ts src/features/attendance/parent-alerts/server/jev-shadow.test.ts` → 2개 파일, 12건 통과.

## 적용하는 법 (eywa 저장소 루트에서)

```powershell
git apply --check experiments/owner-concept/eywa-patches/0001-agents-scroll-chart-principles.patch
git apply experiments/owner-concept/eywa-patches/0001-agents-scroll-chart-principles.patch
git apply --check experiments/owner-concept/eywa-patches/0002-pin-jev-1.14.0.patch
git apply experiments/owner-concept/eywa-patches/0002-pin-jev-1.14.0.patch
pnpm vitest run src/lib/ai/generate-decision.test.ts src/features/attendance/parent-alerts/server/jev-shadow.test.ts
```

- eywa main은 운영(프로덕션)입니다. 적용·커밋·푸시는 eywa의 작업 규칙(격리 워크트리, 적대적 리뷰, push 직전 최신 main 통합)을 따르고 **원장 승인 뒤에만** 올립니다.
- `0002`는 운영 중인 2.0 Jev 판정(학부모 출결 문자 비교 등)의 모델 버전을 바꿉니다. 올리기 전에 원장에게 확인합니다.
- `--check`가 실패하면 그 사이 main이 같은 줄을 바꾼 것입니다. 억지로 적용하지 말고 내용을 보고 손으로 옮깁니다.
