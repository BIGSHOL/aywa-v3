# 3차 검수 8번 — 운영실 재원생 KPI 원본 클릭 대조

2026-10-29, 지점 복사본 기준일 2026-10-27. `GET http://127.0.0.1:4310/api/v2/dashboard?props=1`의 재원생 값은 **333명**이다.

## 2.0 원본 동작

- `src/app/(shell)/dashboard/_overview/kpi-strip.tsx`의 재원생 카드 몸통은 `KpiCard`의 버튼이며, `StudentsPopup`을 연다. `src/app/(shell)/dashboard/_overview/kpi-card.tsx`의 ↗ 목적지 링크와 별개다.
- `src/app/(shell)/dashboard/_overview/kpi-popups.tsx`의 팝업은 333명 전체 명단 대신 프로그램별 인원과 미수강 인원을 보인다. 각 프로그램 행은 해당 필터의 원생목록 링크다.
- 원본 시험 `src/app/(shell)/dashboard/_overview/overview.test.tsx`의 `카드 몸통은 팝업을 열고 숫자가 같다`가 팝업·숫자·필터 링크를 검증한다. 해당 시험 1개 통과, 나머지 25개는 이름 필터로 제외했다.

## 3.0 호스트 실측

- `v2-host/src/dashboard.tsx`는 위 2.0 `Overview` 부품을 그대로 사용한다. 호스트의 클릭 가로채기는 링크만 대상으로 하므로 카드 버튼의 팝업을 가로채지 않는다.
- 4310의 `dashboard.html`을 1440×900 Edge에서 열어 `재원생 333명` 버튼을 눌렀다. 주소는 그대로였고 제목 `현재 재원생 프로그램별 인원`의 대화창이 열렸다.
- 팝업 내용: EiE **93명**, 인재원 영어 **137명**, 수학 **189명**, 미수강 **1명**. 각 행은 `students.html?status=enrolled&...&program=eie|injaewon|math` 또는 `subject=__none__`으로 이어진다. 클릭 확인 중 POST와 외부 주소 요청은 **0건**이었다.
- 호스트 빌드 경고 **0건**.

**판정: 2.0 동등.** 재원생 카드 몸통이 전체 333명 명단을 바로 열지 않는 것은 원본 동작이다. 전체 명단 직행은 별도 개선 과제로 남긴다. 8번에 대한 화면 코드 변경과 서버 재시작은 필요 없다.
