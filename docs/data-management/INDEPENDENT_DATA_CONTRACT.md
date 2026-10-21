# 독립 데이터 계약과 전환 상태

## 종목 목록

`data-v2/catalog-seed.json`은 이 프로젝트가 관리하는 종목 기준 목록이다.
`symbol`은 대문자 종목 키이며, `isin`, `market`, `currency`, `koName`,
`longName`, `active`, `officialProvider`, 검증된 `underlying`을 사용한다.
선택 필드 `ipoDate`(YYYY-MM-DD), `frequency`(기존 빈도 표기),
`noDividends`(boolean)는 검색·상장일 정렬·배당 표시를 위한 메타데이터다.
배당 빈도는 확정 지급 일정이나 향후 배당의 보증이 아니다.

검색 인덱스, 썸네일 API의 종목 식별, 포트폴리오 매핑은 이 목록을 사용한다.
홈과 상세 화면은 `securityDirectory`를 공유한다. 외부 DivGrow catalog와
구 R2의 목록으로 자동 대체하지 않는다. 자체 core 릴리스가 설정되면 해당
릴리스의 catalog를 읽으며, 빌더도 위 선택 필드를 보존한다.

`public/nav.json`은 이전 수집·관리 스크립트용으로 남아 있지만 앱·검색 빌드의
입력이 아니다. 종목을 등록할 때 기준 catalog를 갱신해야 한다.
`core:catalog:seed`는 명시적 `--input`이 있어야 실행되는 이관 도구다.
일상적인 catalog 갱신에 구 nav 재생성을 사용하지 않는다.

## 가격 공급 경계

`data-v2/market-sources.json`은 `symbol`, `yfSymbol`, `dataPath`만 보관하는
가격 공급 경로 목록이다. `dataPath`는 `data/{시장}/{파일}.json` 상대 경로다.
core catalog에 가격 파일 경로·차트 기간·로고·가격 값을 넣지 않는다.
썸네일 API와 가공 작업은 이 목록으로 가격 원본 경로를 찾는다.
가공 작업은 기본 실행에서 R2 `nav.json`을 요청하지 않는다.

가격 원본과 자체 증분 수집의 독립은 후속 단계다. 현재 원본 URL 설정과
가격 파일 형식(`backtestData`)은 유지한다. 가격은 양수의 실제 관측 날짜만
사용하며 forecast 행은 제외한다. 분할 보정이 검증되지 않은 원본은
`upstream_unverified` 상태를 유지하고, 가공 시 과거 날짜 누락을 거부한다.
가격·금액·통화를 경로 이전을 이유로 재해석하지 않는다.

2026-10-21 일회성 이관 결과는 `catalog-migration.json`에 입력 SHA-256과 함께
기록했다. 2,173종목, 가격 경로 2,165개, 상장일 2,156건, 빈도 1,788건,
무배당 표시 220건을 이관했다. catalog의 기존 식별 정보와 활성 상태가 우선한다.
이관 명령을 빌드나 정기 작업에서 재실행하지 않는다.

## 공식 배당

확정 원장은 schema v2의 `core/current.json` → immutable manifest →
`index.json` 및 `tickers/{종목}.json`이다. 금액은 `amount.raw`와
`amount.decimal`의 동일한 문자열로 보존한다. `currency`, `declaredDate`,
`exDate`, `recordDate`, `payableDate`, `verificationStatus`, 공식 출처 URL과
원문 SHA-256을 유지한다. `official`, `cross_checked`만 발행할 수 있다.
구 공개 이력을 재포장하거나 상태를 승격해 신규 공식 수집으로 취급하지 않는다.

검색·상세·포트폴리오 일정은 `dividendLedger`에서 원장 선택을 공유하고,
서버 상세 API·OG·SEO는 `official-dividends`에서 같은 선택을 사용한다.
서버 원장의 index와 종목 이력은 manifest SHA-256을 검사한다.
브라우저와 서버는 기존 URL별 진행 중 요청 합치기·유한 캐시를 재사용한다.
core가 설정된 상태에서 실패하면 구 원장으로 자동 전환하지 않는다.
가격이 정상일 때 배당 장애는 상세 API의 부분 실패 상태로 표시한다.

배포 설정은 브라우저/Pages 빌드의 `VITE_DATA_RELEASE_BASE_URL`과
API 서버의 `DATA_RELEASE_BASE_URL`을 같은 자체 R2 root로 맞춘다.
API 서버는 기존 VITE 변수도 지원한다. 서버 OG와 빌드 SEO도 이 원장을 사용한다.
설정하기 전에는 현재 배당 서비스를 유지하기 위해 기존 공개 원장을 사용한다.

## 전환 검사와 배포

```sh
# 기존 전체 확정 배당 이력과 새 후보를 비교한다. 실패 시 종료 코드 1.
npm run core:cutover:check -- --data-dir /path/to/candidate-release --output /tmp/dividend-cutover.json
```

검사는 snapshot 검증을 먼저 실행하고 모든 기존 확정 이력을 대조한다.
기존 이벤트 누락, 중복, 금액 문자열/통화·공시일·배당락일·기준일·지급일 차이는
전환을 막는다. 비어 있던 날짜의 보충과 새 이벤트 추가는 허용한다.
정당한 정정도 공식 근거를 검토해 비교 기준을 정비한 뒤 다시 검사해야 한다.
`Publish approved data v2 release`와 직접 발행 명령 모두 이 검사를 통과해야 한다.
워크플로는 비교 결과를 별도 아티팩트로 보관한다.

현재 체크아웃의 core manifest는 빈 bootstrap이다. 로컬 검사 결과 기존 확정
이력 4,914건을 대체할 수 없어 전환을 차단했다. 이는 운영 R2의 현재 내용을
검증한 결과가 아니다. 최신 수집 run `39559670797`은 성공 상태이나 이 환경의
아티팩트 다운로드는 HTTP 403으로 거부되어 내용을 검증하지 못했다.
GitHub 환경변수 조회도 권한 부족으로 확인하지 못했다.
따라서 운영 원장 발행과 환경변수 변경은 아직 수행하지 않았다.
검증 가능한 후보가 제공되면 위 대조를 통과한 결과를 발행하고, 동일 root 설정으로
재배포한 뒤 검색·상세·포트폴리오 일정·OG·SEO를 함께 확인해야 한다.

## 요청 횟수 검증

단일 종목 일정과 여러 포트폴리오 일정의 동시 조회는 URL별 index 1회와
종목당 history 1회를 공유한다. 정상 캐시 재진입은 추가 요청이 없고 명시적
새로고침은 재조회한다. core 서버 index와 history 동시 조회는 pointer와
manifest를 각각 1회만 읽는다. 이번 전환은 Firebase 호출을 추가하지 않는다.
검증 수치는 합성 테스트 기준이며 운영 요청량·과금 실측이 아니다.

## 이번 변경의 실제 검증

- `public/nav.json`을 잠시 제외한 `npm run build` 성공; 검증 후 원본 복구.
- Node 전체 단위 테스트 320개, data-v2 Python 테스트 27개 통과.
- `tests/core-ledger.browser.mjs`의 기본 core 모드와 `--legacy` 모드 통과.
  core 동시 조회는 pointer·manifest·catalog·배당 index·종목별 history 각각 1회,
  캐시 재진입은 추가 0회, 명시적 갱신은 5개 자료를 재조회했다.
  기존 원장 모드는 index·종목별 history 각각 1회, 갱신 시 3개 자료를 재조회했다.
  core 장애 때 구 배당 원장 요청은 0회였다.
- `tests/underlying-search.browser.mjs`의 검색·60개 카드·분류·모바일·다크 모드 통과.
- 기존 `tests/request-dedup.browser.mjs`는 가격·배당 중복 방지 assertions 이후,
  별도 계좌 권한 오류 메시지 대기 단계에서 타임아웃. 새 원장 전환 브라우저
  검사는 계좌 인증과 분리해 위 두 모드로 검증했다.
- 공개 R2의 `core/current.json` 조회도 HTTP 403으로 거부되어 운영 원장은 미검증.
- `npm run lint:check` 종료 코드 0; 오류 0개, Vue 속성 순서 등 경고 80개.
