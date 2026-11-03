# 계좌별 로컬 API 업데이트 준비

2026-11-03, main `1fa7e9d`에서 분리한 변경이다. **화면·로컬 실행 계약과 합성
검증까지이며 실제 계좌 등록/키 보관/운영 동기화 완료가 아니다.** 운영 API는 계속
`execution_not_configured`이며, 실제 로컬 connector도 기본 null이다.

## 화면과 실행 경로

자산관리의 각 토스 계좌에 `토스 API 설정` 버튼을 두고 해당 accountId를 선택해
연결 패널을 연다. 기존 등록된 본인 연결 선택 흐름을 유지하고 별칭·마스킹 번호로
대상을 표시한다. 로컬 업데이트 영역에서 기간을 선택해 사용자 클릭으로 실행한다.
현재는 승인된 로컬 프로그램이 연결되지 않아 날짜 입력과 실행 버튼이 비활성이다.
실제 client_id/client_secret/token 입력·웹 저장은 제공하지 않는다.

`lib/account-toss-local-runner.js`는 네트워크 리스너나 자동 실행 CLI가 아닌
로컬 전용 실행 모듈이다. 기본 어댑터가 없으며 다음 의존성을 명시적으로 주입해야 한다.

- `authorize(accountId)`: 신뢰하는 앱 실행 경계에서 세션, 가족 참여, 계좌 ACL,
  명의자 본인, 승인된 계좌 전체번호 해시와 binding revision을 독립 검증한다.
  브라우저가 주장한 UID/해시를 그대로 신뢰하면 안 된다. Firebase 토큰을 수집기에
  넘기는 구현은 이 계약을 충족하지 않는다.
- `registry.list()`: 승인된 로컬 계좌 등록 목록. 동적 앱 accountId와 subjectUid,
  credentialRef, 전체 계좌번호 해시, suffix, revision, enabled를 보관한다.
  credentialRef는 프로그램이 관리하는 논리 참조이며 경로나 URL 입력이 아니다.
  신규 등록·영속 저장·키체인 구현은 아직 없고 연결된 계좌가 하나여야 실행한다.
- `credentials.withExistingToken(ref, work)`: 기존 토큰을 로컬 비밀 저장소에서 읽고
  실제 client 단위로 다른 CLI까지 포함하는 배타 실행을 보장한다. 새 토큰 발급이나
  재발급을 하지 않는다. 이 저장소·프로세스 간 잠금 어댑터도 아직 미연결이다.
- `root`: Git에서 제외된 개인 전용 로컬 보관 위치. 실제 승인 후 프로그램이 결정한다.
  accountId/전체번호 해시 아래 기존 수집기의 새 run에 원문을 보존한다.

프로그램은 계좌 검증 → 기존 토큰 읽기 → 권한/등록 재확인 → 공식 accounts 조회와
전체번호 해시 대조 → OPEN 및 지정 기간 CLOSED 주문 수집 → 권한/등록 재확인 순으로
진행한다. 기존 `readAccountOrders`를 재사용하며 동적 계좌 실행에 전체번호 해시
검증을 추가했다. 고정 wife/husband 프로필로 자동 변환하지 않는다. 같은 끝 4자리만
일치하는 다른 계좌, 중복 등록, viewer/보호자/다른 명의자, 변경된 revision은 거부한다.

조회 중 권한이 바뀌면 화면에 결과를 게시하지 않는다. 이미 보존된 로컬 원문은 지우지
않는다. 성공 응답은 `collected_locally`, `cloudSaved:false`,
`canonicalUnchanged:true`만 알리며 금융 원문·계좌번호·로컬 경로·인증정보는 반환하지
않는다. 계좌 장부 저장 완료로 표시하지 않는다. 재발급·자동 재시도·주문 실행·업로드는
없다. 기존 PDF, R2, Firestore 장부와 관리자 승인값을 변경하지 않는다.

## 공식 API와 네트워크 조사

공식 [OpenAPI 명세](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)
v1.2.28과 [FAQ](https://openapi.tossinvest.com/openapi-docs/faq.md)를 확인했다.
계좌 목록, 보유 주식, 주문 목록·상세를 제공한다. 현재 명세에는 현금 입출금·실제
환전 거래·배당 입금 원장 조회 경로가 없어 기존 PDF/웹 원문 경로를 대체하지 않는다.
환율 조회는 실제 환전 이력이 아니다. 토큰은 client당 하나이며 재발급이 기존 토큰을
무효화한다.

FAQ는 실제 송신 공인 IP가 허용 목록과 일치해야 한다고 설명한다. 로컬 PC라도 집
공인 IP가 바뀌면 재확인이 필요하며 웹 서버의 IP와 PC의 IP는 다르다. 웹 페이지에서
직접 호출하면 비밀키가 브라우저 코드·개발자 도구에 노출된다.

무인증 OPTIONS `/oauth2/token` 요청(Origin은 정식 웹앱)에 HTTP 200을 관측했으나
`Access-Control-Allow-Origin/Methods/Headers`는 없었다. 이는 해당 경로의 해당 응답
관측이며 전체 API의 CORS 지원 여부를 단정하지 않는다. 실제 토큰 요청은 하지 않았다.

## 연결 활성화 전에 필요한 승인과 구현

실제 키 발급·입력·파일/키체인 저장, 허용 IP 등록, 장기 접근 설정은 이번 작업에서
수행하지 않았다. 다음 실행 전 사용자가 대상 PC/계좌/키 보관 방식과 영향에 대해
시점별로 확인해야 한다. 본인 명의·제3자 보관/자료 이용 조건도 확인해야 한다.

권장 후속 경계는 로컬 프로그램의 신뢰하는 앱 창 또는 확장 native messaging이다.
공개 웹사이트에서 임의 localhost URL로 POST하는 기능은 추가하지 않았다.
별도 localhost 서버를 채택한다면 loopback bind, 정확한 Host/Origin, DNS rebinding
차단, 짧은 세션 pairing capability, 재사용/CSRF 차단과 로컬 네트워크 브라우저 권한을
구현·검증해야 한다. CORS만으로 로컬 접근을 인증하면 안 된다.

웹앱 로그인과 로컬 프로그램 사이의 권한 검증 bridge, OS 비밀 저장소, 영속 registry,
client 공용 잠금은 **실제 미구현**이다. connector prop만 주입해 운영 연결 완료라고
판정할 수 없다. 운영 활성화 전에 이 경계들을 구현·검증하고, 최초 실제 조회 범위와
그 뒤 클라우드 저장을 각각 확인해야 한다. 동적 investmentAccounts accountId와
기존 wife/husband 시험 원장의 자동 매핑도 하지 않는다. 원문 클라우드 저장을 추가할
때는 기존 관측 배치 preview/commit·완료 영수증·중복/개정 보존을 별도 적용한다.

## 재현 가능한 검증

```sh
node --test tests/account_toss_local_runner.test.mjs tests/account_toss_connection.test.mjs tests/toss_account_details.test.mjs
npm run type-check
npm run build
YIELDLOOM_TOSS_MOCK=1 npm run dev -- --host 127.0.0.1
node tests/account-toss-local.browser.mjs
node tests/account-toss.browser.mjs
```

합성 단위 테스트는 계좌 혼선/중복/권한/기간/오류/중복 클릭/조회 중 변경을 검증한다.
브라우저는 390px/1440px, 라이트/다크, 키보드 제출, 성공/실패 표시를 검증하며 외부
요청·브라우저 저장소 쓰기는 0회다. 로컬 UI의 status/update는 클릭당 각각 1회이고
날짜 입력만으로 조회하지 않는다. node 수집기 대조 테스트는 모의 accounts 1회,
해시 불일치 후 orders 0회다. 실제 금융 API, Firebase/R2 읽기·쓰기 및 청구량은
측정하지 않았다. 실제 계좌·분산 잠금·키체인·운영 배포는 검증하지 않았다.
