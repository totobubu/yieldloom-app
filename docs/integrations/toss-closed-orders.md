# 토스 주문의 로컬 관측 수집기

`scripts/toss/collect-closed-orders.mjs`는 계좌 하나의 주문 목록을 로컬 비공개
관측 자료로 보존한다. 기존 PDF·브라우저 관측이나 장부를 대체하지 않으며,
승인값·원금·Firebase/R2·앱 연결 상태를 변경하지 않는다. Node 24 내장 모듈을 사용한다.
이 문서는 저장소의 현재 수집기 구현을 설명하며 실제 인증·조회 성공을 보증하지 않는다.

## 설정과 계좌 선택

수집기는 저장소 루트의 `.env.toss-orders.local` 또는 OS 환경에서 아래 설정을 읽는다.
값은 명령행·공개 웹앱 환경변수·Git·채팅·로그에 넣지 않는다.

| 설정 이름 | 용도 |
| --- | --- |
| `TOSS_ACCESS_TOKEN` | 이미 발급된 유효 토큰으로 조회 |
| `TOSS_ACCOUNT_SEQ` | 조회할 계좌의 API 식별자 |
| `TOSS_CLIENT_ID` | 명시적으로 토큰을 발급할 때 사용할 client ID |
| `TOSS_CLIENT_SECRET` | 명시적으로 토큰을 발급할 때 사용할 secret |

`TOSS_ACCOUNT_SEQ`는 표시 계좌번호가 아니다. 수집기는 계좌 목록을 자동 탐색하지
않으므로 실제 실행 전에 인증정보·계좌의 소유 관계와 허용 IP를 별도로 확인한다.

설정 파일은 실행 디렉터리와 무관하게 저장소 루트에서 읽는다. UTF-8 BOM, 빈 줄,
`#` 주석, 한 줄의 따옴표 값을 지원하며 변수 확장·명령 실행·이스케이프 해석은 없다.
OS 환경의 비어 있지 않은 값이 파일보다 우선한다. 알 수 없는 설정 이름이나 잘못된
줄은 내용을 출력하지 않고 거절한다. 다른 `.env` 파일은 읽지 않는다.

공용 로더는 `TOSS_WIFE_`와 `TOSS_HUSBAND_` 접두사의 `ACCESS_TOKEN`, `CLIENT_ID`,
`CLIENT_SECRET`, `ACCOUNT_SUFFIX`, `ACCOUNT_SHA256`도 읽는다. 하지만 **이 CLI는
가족별 설정을 자동 선택하지 않고 위 표의 공통 설정을 사용한다.** 가족용 설정만
있다는 이유로 해당 명의 계좌가 선택되었다고 판단하지 않는다. 실제 연결·명의 검증
구현과 이 로컬 CLI를 구분한다.

`.env*`와 출력 경로는 Git 제외 대상이지만 Git 제외는 암호화·접근 통제가 아니다.
설정·출력 폴더는 개인 전용 위치에서 보호하고 공유·동기화하지 않는다. Windows에서는
파일 권한이 상위 디렉터리 ACL의 영향을 받는다.

## 실행과 토큰 발급

다음 도움말·합성 테스트는 실제 인증 없이 확인할 수 있다.

```sh
node scripts/toss/collect-closed-orders.mjs --help
node --test tests/toss_closed_orders.test.mjs tests/toss_open_orders.test.mjs
```

다음은 실제 조회를 승인받고 설정을 확인한 뒤 사용할 명령 예시다. 이 문서 복구
작업에서는 실행하지 않았다. run에는 계좌번호·이름 등 민감한 정보를 넣지 않는다.

```sh
# 기존 유효 토큰으로 CLOSED 주문 조회
node scripts/toss/collect-closed-orders.mjs --live --run initial

# 별도 승인된 토큰 발급 후 같은 실행에서 재사용
node scripts/toss/collect-closed-orders.mjs --live --issue-token --run initial

# 기존 유효 토큰으로 현재 OPEN 주문을 별도 관측
node scripts/toss/collect-closed-orders.mjs --live --status OPEN --run open-current
```

CLI는 `--live`와 `--run`을 모두 요구한다. 기본 상태는 `CLOSED`다. 토큰 발급은
`--issue-token`으로만 요청하며 POST `/oauth2/token`을 자동 재시도하지 않는다.
수집기 도움말의 기존 토큰 무효화 경고에 따라 같은 client의 다른 프로그램·계좌
수집과 발급을 동시에 실행하지 않는다. 발급 토큰은 저장·출력하지 않고 메모리에서
재사용한다. 완료된 run과 잠긴 run에서는 토큰도 발급하지 않는다. 인증 실패 때
자동 갱신이나 다른 인증 경로를 시도하지 않는다.

`--from YYYY-MM-DD`, `--to YYYY-MM-DD`는 API에 전달하는 날짜 범위다.
미지정 값과 symbol 필터는 보내지 않는다. `--limit`은 1~100(기본 100),
`--max-pages`는 1~1,000,000(기본 10,000)이다. 페이지 한도에 도달하면
`partial/page_limit`으로 끝난다. run은 영문·숫자로 시작하는 1~64자의
영문·숫자·밑줄·하이픈이며, OPEN은 `open-` 접두사가 필요하다.

OPEN은 기존 토큰만 허용하며 `--issue-token`과 토큰 발급 callback을 거절한다.
limit/cursor 없이 한 응답의 현재 주문을 보존한다. `hasNext=true`나 null이 아닌
`nextCursor`는 거절하며 임의의 페이지 순회를 하지 않는다. 새 시점의 OPEN 관측에는
새 run을 사용한다. CLOSED 원문과 자동 합치거나 과거 원문을 삭제하지 않는다.
응답 body는 최대 20 MiB이며 초과 응답을 잘라서 정상 자료로 저장하지 않는다.

## 원문 저장과 재개

출력은 `var/toss-orders/<sha256(accountSeq)>/<run>/`에 생성된다. 해시는 계좌 분리용이며
익명화를 보장하지 않는다. 원문·주문 ID·cursor도 개인 금융 자료다. 자동 업로드나
다른 장부로의 자동 제출은 없다.

| 파일 | 의미 |
| --- | --- |
| `manifest.json` | 계좌 해시·고정 조회 조건·개발 사양 버전·시작 시각 |
| `page-00000001.json` 등 | 요청 cursor·수집 시각·응답 body 해시·원문 base64 |
| `checkpoint.json` | 저장 페이지 수·다음 cursor·완료/부분 상태 |
| `orders-index.json` | 주문별 관측 참조와 원문 문자열 필드 |
| `rate-limit.json` | 재실행에도 지키는 다음 요청 허용 시각 |
| `writer.lock` | 같은 계좌/run의 동시 기록 방지 |

현재 수집기의 manifest는 개발 사양 버전 `1.2.24`를 기록한다. 이는 실행 중 최신
사양을 내려받거나 현재 공급자 지원 범위를 검증한다는 뜻이 아니다.

페이지 원문은 HTTP 콘텐츠 디코딩 후 응답 body 바이트다. 인증 헤더·쿠키·키·오류
응답 body는 저장하지 않으며 자격증명 필드나 현재 토큰이 반사된 응답을 거절한다.
임시 파일 쓰기·fsync·원자 rename 후 저장을 인정하고, 재개 시 연속 페이지 번호·
해시·cursor 연결을 검증한다. 체크포인트가 뒤처져도 원문 페이지를 기준으로 복원한다.
남은 `.tmp`는 완료 자료가 아니다. 손상·누락·조건 불일치·반복 cursor는 덮어쓰지 않는다.

재개에는 같은 계좌·run·상태·기간·limit을 사용한다. 완료된 run은 추가 API 호출 없이
검증·재생성한다. 새 순회는 새 run으로 시작해 원문을 보존한다. SIGINT/SIGTERM은 가능한
완료 페이지까지 저장하고 `partial/interrupted`로 종료한다. 강제 종료 후 남은 잠금은
해당 프로세스 종료를 확인한 뒤에만 수동 정리하며 실행 중 잠금이나 원문은 삭제하지 않는다.

같은 주문 ID의 동일 관측은 index에서 중복 제거하되 페이지 원문은 보존한다. 값이 다른
관측은 버전으로 나란히 남기고 충돌 건수를 증가시킨다. 최신값 자동 선택·승인·장부
덮어쓰기는 없다. index의 page/position은 원문 `result.orders`의 배열 위치다.
수량·금액·통화·시각은 알려진 문자열/null을 유지하며 숫자·Date로 변환하지 않는다.
index는 종료/중단 때 갱신되므로 실행 중에는 checkpoint와 시점이 다를 수 있다.

## 제한·오류·완료의 의미

기본 순차 요청 간격은 1.1초다. 네트워크 오류와 429/500/502/503/504는 기본 최대
3회 추가 재시도한다. `Retry-After`, `X-RateLimit-Reset`과 백오프를 반영하며 다음
허용 시각을 저장한다. 60초를 넘는 대기는 줄이지 않고 `partial/cooldown`으로
중단하며 재실행 때도 존중한다. 401/403은 `authentication_failed`, 그 밖의 HTTP
오류는 `http_error`로 중지한다. 실제 계정의 한도·인증·IP 허용 검증과는 별개다.

표준 출력은 상태·페이지·고유 주문·중복·충돌 건수 등 요약이다. 주문 내용·계좌
식별자·cursor·인증 헤더·공급자 오류 메시지·예외 스택을 출력하지 않는다.
종료코드는 `0=complete`, `2=partial`, `1=명령 오류`다.

`complete/provider_exhausted`는 CLOSED 관측이 `hasNext=false`까지 도달했다는 뜻이다.
OPEN의 `complete/open_observation_returned`는 현재 목록 응답 확보만 뜻한다.
`snapshotGuaranteed=false`를 유지하며 전체 평생 거래 이력·정산·실제 연결 완료를
보장하지 않는다. 수집·재개 사이 주문의 추가·정정·삭제로 누락될 수 있다. cursor가
무효화되면 같은 run에 처음부터 섞지 않고 새 run으로 관측해 비교한다.

CLOSED는 조회 그룹이지 체결 여부가 아니다. 취소·거절·부분 체결과 알 수 없는 상태를
보존하며, `executionPresence`는 제공된 filledQuantity의 0 여부만 구분한다. 목록은
주문별 체결 요약으로 개별 분할 체결 사건 원장이 아니다. 주문 상세를 자동 조회하지
않으며 입출금·환전·배당·세금 현금 거래·조건주문 감시 이력도 수집하지 않는다.
API 미지원 주문 등 누락 범위는 별도 검증하고 원문·PDF·브라우저 관측과 대조한다.
기존 장부·확정값으로 자동 승격하지 않는다.

합성 테스트는 주입한 fetch와 임시 폴더로 페이지 순회·중복·충돌·실패·재개·원문 손상·
호출 제한·계좌 분리·자격증명 비출력·OPEN 경계를 검사한다. 실제 키·실계좌 API·운영
자료는 사용하지 않는다. 개인 원문을 앱에 제출하는 별도 흐름은
[관측 배치 계약](../SHEET_OBSERVATION_BATCHES.md)을 따르며 이 CLI 실행과 구분한다.
