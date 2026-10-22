# 독립 데이터 계약과 전환 상태

## 종목 목록

`data-v2/catalog-seed.json`은 이 프로젝트가 관리하는 종목 기준 목록이다.
`symbol`은 대문자 종목 키이며, `isin`, `market`, `currency`, `koName`,
`longName`, `active`, `officialProvider`, 검증된 `underlying`을 사용한다.
선택 필드 `ipoDate`(YYYY-MM-DD), `frequency`(기존 빈도 표기),
`noDividends`(boolean)는 검색·상장일 정렬·배당 표시를 위한 메타데이터다.
배당 빈도는 확정 지급 일정이나 향후 배당의 보증이 아니다.

검색 인덱스, 썸네일 API의 종목 식별, 포트폴리오 매핑은 이 목록을 사용한다.
홈과 상세 화면은 `securityDirectory`를 공유한다. 상장폐지 상태는 자체 `security-status` registry를 우선 적용하며, 검색 홈은 포함 옵션용으로 보관 종목도 함께 받는다. 필터 변경은 이미 받은 목록에서 처리하고 추가 조회하지 않는다. 외부 DivGrow catalog와
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

체크아웃의 core manifest는 빈 bootstrap이며 운영 릴리스는 별도로 발행한다.
로컬 아티팩트 다운로드가 HTTP 403으로 거부되어, GitHub 실행 환경에서
`review_only=true`로 비교하도록 검증 모드를 추가했다. 이 작업은 운영 환경과
R2 자격 증명을 사용하지 않으며, 현재 catalog로 후보를 다시 생성해 비교한다.
요약과 누락 항목은 check annotation, 전체 결과는 별도 아티팩트에 남긴다.

2026-10-21 수집 run `39559670797`의 후보 5,049건을 대조한 결과, 기존 확정
이력 4,914건 중 Roundhill 23건이 누락됐고 변경·중복은 없었다. 모두 10월 2일
발표·10월 5일 배당락인 이벤트다. 공식 Cboe 원문을 다시 조회해 23건의 금액과
날짜가 정확히 일치함을 확인했다. `--backfill roundhill:2026-10-05`로 공식
출처를 보충 수집하고 정상 수집 상태에 보존했다. 구 이력의 값은 가져오지 않았다.

보충 수집 run `39593238852`의 후보는 5,073건이다. 전체 비교 run
`39593606171`은 snapshot 유효, 기존 이력 누락·변경·중복 각 0건, 새 이벤트
159건으로 통과했다. 보충 수집 자체는 출처 오류 12개 때문에 실패 상태다.
YieldMax 6개 URL의 HTTP 404와 Global X 6개 페이지의 history payload 파싱
실패이며, 해당 출처의 기존 확정 이력은 보존됐다. 비교 통과는 모든 출처의 최신
조회 성공을 뜻하지 않는다. 이 수집 오류는 별도로 해결해야 한다.
Global X의 현재 QYLD HTML에는 기존 `distributionHistoryData`가 없고,
9월 21일 금액도 기존 원문의 `0.1767` 대신 화면 표시용 `$0.18`로 나온다.
이 표시 값을 원문 금액으로 가져오는 우회 파서는 추가하지 않았다.

`candidate-39593238852`를 발행 run `39593732155`에서 발행 완료했다.
R2 내부 조회로 2,332개 객체와 최종 manifest, 현재 pointer의 releaseId를 확인했다.
공개 Node 조회로 pointer·manifest, catalog와 배당 index 및 샘플 AAPW 이력의
해시를 검증했다. 116종목 배당과 2,188종목 catalog이며, 실제 서버 소비 코드로도
TSLY 이력 88건이 조회됐다. 최초 Python 공개 요청은 HTTP 403이었으나 앱과
동일한 Node fetch로 조회가 성공해 공개 검증기를 Node로 전환했다.

초기 CORS는 Pages만 허용하고 새 Vercel 운영 주소가 빠져 있었다. 운영 환경의
적용 run `39598010313`에서 기존 규칙을 보존하고
`https://yieldloom-app.vercel.app`만 GET/HEAD 허용 목록에 추가했다. 공개 검증은
Pages와 Vercel 양쪽 Origin으로 동일한 자료와 CORS를 확인했다. 설정 도구의
기본값은 dry run이며, 워크플로의 `configure_core_cors=true`는 `data-production`
환경에서 적용한다. 새 출처에 기존 쓰기 메서드가 부여되지 않는 경우도 검사했다.

검증 모드 `verify_public=true`로 공개 조회를 다시 실행할 수 있다. 이후 같은 root를
설정해 재배포하고 검색·상세·포트폴리오 일정·OG·SEO를 함께 확인해야 한다.
Vercel `totobubus-projects` 환경변수 접근과 GitHub Actions 변수 조회는 현재
403으로 거부되어 앱 소비 경로의 운영 전환은 아직 수행하지 않았다.
후속 data-v2 Python 테스트는 35개 통과했다. 발행 파일 업로드를 최대 8개 병렬로
바꾸고, 모든 파일 성공 후에만 manifest와 pointer를 기록하도록 유지했다.
업로드 실패와 전환 검사 실패 시 최종 원장이 노출되지 않는 테스트를 포함한다.

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
- 초기 Python 공개 R2 조회는 HTTP 403이었다. 후속 Node 공개 조회 결과는 위에 기록했다.
- `npm run lint:check` 종료 코드 0; 오류 0개, Vue 속성 순서 등 경고 80개.

## 최신 work 통합 검증

상장폐지 이력 보존과 검색·비교 개선을 포함한 `work`를 통합했다.
공통 종목 조회는 기본적으로 활성 종목을 반환하고, 검색 홈은 상장폐지 포함
옵션을 위해 보관 종목도 요청한다. 옵션 변경에 추가 네트워크 조회는 없다.
통합 후 타입 검사·프로덕션 빌드, Node 339개, data-v2 Python 27개와
상장 상태 Python 4개, 정적 검사(오류 0개·경고 72개)를 검증했다.
기존·core 배당 원장 브라우저 검사와 상장폐지 종목 브라우저 검사도 통과했다.
검색 브라우저 검사의 비교 링크 이름을 최신 접근성 이름인 ‘AAPL 기반 ETF 비교’로
갱신한 후 데스크톱·모바일·다크 모드와 이전 목록 overlay까지 통과했다.
