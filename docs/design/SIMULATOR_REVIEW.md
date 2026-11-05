# 배당 시뮬레이터·원천징수율 비교 독립 검토

2026-11-05. 기준 `origin/main` b4b0e7a, 기능 브랜치 `feat/stitch-simulator-review-20261105`.

**검토용 구현과 기능 검증은 완료했지만, 원본 전체 시각 일치는 미완료다.** 이 변경을 리디자인 전체 완료나 운영 배포 완료로 집계하지 않는다. 픽셀 오차율을 측정하지 않았으며 측정 도구의 `visualAcceptance: pending-review`는 자동 이미지 비교의 FAIL 판정이 아니다.

## 원본과 수집 근거

[Stitch 프로젝트](https://stitch.withgoogle.com/projects/17382728461495959991)의 공식 MCP `https://stitch.googleapis.com/mcp`에 환경의 설정된 인증을 사용했다. `tools/list`, `list_screens`, `get_screen`, `download_file`이 HTTP 200을 반환했고 아래 6개 HTML·PNG를 내려받았다. 서명 URL이나 인증 값은 저장소에 넣지 않았다. 원본의 후행 공백 3곳도 보존하기 위해 originals의 로컬 .gitattributes에 해당 HTML의 공백 검사/EOL 변환만 제한했다.

| 화면              | 선택한 원본 ID                   | 상태           |
| ----------------- | -------------------------------- | -------------- |
| 시뮬레이터 PC     | 9f08c008c0f1441fba8995b5683e6be6 | CLOUD MCP TEST |
| 시뮬레이터 Tablet | 85f567e48c3c4dbdad938b7e210c22ed | V6 REVIEWED    |
| 시뮬레이터 Mobile | fbb16724366740e1ab9d8fce50db986a | V6 REVIEWED    |
| 세율 비교 PC      | 678e97a05dc14fec9c77e971bd5ef960 | V6 REVIEWED    |
| 세율 비교 Tablet  | 388202e7721941e98095ae02b264b1b1 | V7 REFINED     |
| 세율 비교 Mobile  | b640738daaf5434d9af72530fe150006 | V6 REVIEWED    |

[기기별 원본·SHA-256](stitch-simulator/mapping.json)과 [원본 HTML](stitch-simulator/originals/)은 수정하지 않고 보존했다. Tablet 2종은 MCP 메타데이터가 DESKTOP/2560px이므로 제목의 Tablet 분류와 CSS의 최대 834px을 함께 기록한다. 원본 PNG·원시 MCP 응답은 `/tmp/stitch-simulator/`에 있다.

## 구현

`DividendSimulatorView.vue`만 제품 코드에서 수정했다. 공통 가정·A/B 입력을 왼쪽에, KPI·자산/주식/현금 구성·상세 대조·차트·월별 결과를 오른쪽에 배치한다. 모바일에서는 단일 열과 라벨이 있는 월별 카드로 표시하며 12개월씩 더 볼 수 있어 전체 360개월을 확인할 수 있다.

세율 모드 B는 세율만 입력하고 A에서 상속한 8개 조건을 읽기 전용 요약으로 표시한다. B 고유 입력은 A/B 모드로 돌아가면 보존된다. 차이 부호는 일반 모드 B−A, 세율 모드 A−B를 각 제목과 함께 명시한다. 저장/불러오기는 PrimeVue Popover에서 키보드·Escape로 조작한다.

계산 엔진, 기본 입력값, 주/월/분기/반기/연간 지급, 0~360개월, 원천징수·수수료·가격변화·소수주·세후 재투자, 저장 형식, 관리자 권한, API 경로는 기존 구현을 사용한다. 원본의 고정 금융 예시를 실제 계산에 주입하지 않았다. 기존 상세 계산 설명과 환산 없는 통화 전환 설명도 유지했다.

## 남은 차이와 차단 사항

- PC 시뮬레이터의 유일한 해당 원본은 **MCP 생성 테스트**이며, 1천만원·10년·수익률 모델과 간단 입력 패널이다. 최신 Tablet/Mobile은 1천달러·1년·연말 1회 배당·두 시나리오 전체 입력 모델이다. PC 원본을 다른 기기의 확정 원본으로 취급하거나 두 모델을 같은 화면이라고 주장하지 않았다. 최종 PC 시안을 확정한 뒤 전체 구조를 다시 대조해야 한다.
- 시뮬레이터 PC와 세율 비교 Mobile 원본의 Google Fonts URL은 HTTP 400을 반환했다. HTML을 고쳐 원본으로 부르지 않고 원본 자산 실패로 기록했다. 두 원본의 글꼴/전체 이미지 비교는 유효한 통과 근거가 아니다.
- 기기별 원본의 글꼴, 색상 토큰, 제목 구조, 입력 제어, 표시 항목 수가 서로 다르다. 현재는 기존 프로젝트 테마·접근성·계산 계약을 유지하며 프레임/패널/입력 규격을 맞춘 검토본이다. 완전 일치 구현으로 승인하지 않았다.
- 실제 사용자 가정/추가 기능을 보존하면서 원본의 고정 전제 문구, 고정 12개월 이벤트 카드, 계산 적용 버튼을 그대로 복제하지 않았다. 결과는 입력 즉시 계산하며 월별 데이터는 생략하지 않는다. 차트와 전체 계산 설명도 유지했다. 이런 차이는 의도적 제품 계약 보존이며 픽셀 일치로 집계하지 않는다.
- 실제 관리자 로그인·개인 계좌·PDF 흐름은 이 독립 범위에서 검증하지 않았다. 이 화면은 개인 계좌/PDF를 호출하지 않는다.

## 검증과 재현

- `node --test tests/dividend_simulation.test.mjs`: 12/12 통과. 지급 전 재투자 없음, 주 52회 지급, 세후 복리, 가격 경로, 수수료·소수주·잔여 현금, 0개월·100% 원천징수·오류 입력·저장 형식을 검증했다.
- `node tests/dividend-simulator.browser.mjs`: 합성 관리자 인증으로 두 모드 × 1440/834/768/390/360/320px 넘침 없음, 주기 마우스/키보드 조작, 세율 상속, 저장·복원·오류, 음의 주가 변화, 0개월, 통화, 모바일 24개월 이어보기, 모드 복귀 시 B 값 보존, Popover Enter/Escape, 다크 모드 통과. 로컬 요청 실패·페이지 JS 오류·API 쓰기 요청 0이다. 외부망 차단은 기존 fixture 정책을 따른다.
- `npm run type-check`, `npm run build`, `git diff --check` 통과. build의 기존 큰 청크 경고 유지.
- `npm run lint:check`: 오류 0, 기존 경고 54. 변경 코드 3개 파일의 개별 ESLint는 오류·경고 0이다.
- `node scripts/design/measure-stitch-simulator.mjs`: 원본 6개 해시와 같은 기기 폭의 원본/구현 PNG·DOM 속성을 남긴다. 구현 6개는 자산 실패·JS 오류·가로 넘침 0. 원본 2개의 글꼴 HTTP 400 때문에 전체 소스 건강 검사는 exit 1이며 통과로 보고하지 않는다.

근거는 `/tmp/stitch-simulator/comparison/results.json`, `comparison/*-{original,implementation}.png`, `implementation/*.png`, `browser-final.log`, `unit.log`, `type-final.log`, `build-final.log`, `lint.log`, `measurement-final.log`다. 프레임 치수 일치는 전체 화면 일치를 뜻하지 않는다. 다음 원본/구현 설정 패널은 동일 DPR2에서 폭·padding·radius와 제목 크기를 대조했다.

| 기기                    | 원본/구현 패널 폭 | 원본/구현 padding | radius | 제목 크기 |
| ----------------------- | ----------------- | ----------------- | ------ | --------- |
| 시뮬레이터 PC 1440px    | 437.328125px      | 24px              | 12px   | 32px      |
| 시뮬레이터 Tablet 834px | 315.828125px      | 16px              | 12px   | 24px      |
| 시뮬레이터 Mobile 390px | 366px             | 14px              | 12px   | 20px      |
| 세율 PC 1440px          | 442.65625px       | 24px              | 12px   | 30px      |
| 세율 Tablet 834px       | 313.5px           | 24px              | 12px   | 30px      |
| 세율 Mobile 390px       | 358px             | 16px              | 12px   | 20px      |

## 통합 시 파일 충돌

제품 변경은 `src/pages/DividendSimulatorView.vue`에 한정한다. 관련 테스트 `tests/dividend-simulator.browser.mjs`, 독립 측정 도구, `docs/design/stitch-simulator/` 및 이 문서만 추가/수정했다. 전체 매핑 파일과 다른 화면, main, 운영 데이터는 수정하지 않았다.

부모 레이아웃 파일을 수정하지 않기 위해 이 페이지가 존재할 때에만 `:has(> .simulator-page)`와 그 부모 셸을 대상으로 최대 폭/여백을 지정했다. 통합 작업이 `ThumbnailLayout.vue`의 시뮬레이터 프레임 규칙을 추가하면 이 독립 규칙과 중복될 수 있으므로 두 모드 × 세 기기에서 다시 확인해야 한다. `SimulationScenarioForm.vue`에는 페이지 안에서만 적용되는 제한된 deep CSS가 있으므로 그 컴포넌트를 다른 작업에서 변경하면 입력 구조/클래스를 대조해야 한다. PrimeVue 설치 버전은 4.5.3이다.

병합·푸시·운영 배포는 수행하지 않았다. 통합 실행자가 코드/시안 차이와 최종 원본을 검토해야 한다.
