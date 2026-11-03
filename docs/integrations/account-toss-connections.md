# 계좌별 토스 API 연결 — 모의 구현

후속 [계좌별 로컬 업데이트](toss-local-account-update.md)는 별도 로컬 프로그램의
등록·암호화 보관·서명 권한·원문 저장까지 구현한다. 아래 모의 서비스와 다른 경로이며
실제 키 등록과 운영 활성화는 하지 않았다. 운영 플래그와 서명키가 없으면 차단한다.

이 변경은 **개발/합성 검증만 가능한 계약과 화면**이다. 실제 키 등록·토큰 발급·금융 조회·R2 저장·장부 반영·배포는 수행하지 않았다. 운영 API는 Firebase 인증(취소 확인 포함), 동적 계좌 ACL, 가족 참여를 확인한 뒤 `execution_not_configured`를 반환한다. 모든 실제 변경/조회 요청은 503으로 차단한다. 환경변수에 토스 키를 추가해도 활성화되지 않는다.

## 화면과 로컬 재현

기존 선택 계좌 설정에 `토스 API 연결` 접기 영역을 추가했다. 열 때만 상태를 읽고 등록된 본인 연결 선택 → 등록 → 계좌 확인 → 잔고 조회 → 해제를 제공한다. 운영에서는 준비 중 상태와 비활성 안내만 표시한다. 원본 키/secret/token 입력란은 없다. 명의자·관리자/보호자는 다른 개념이며 이번 기본 정책은 명의자 본인만 설정·조회할 수 있도록 제한한다.

```sh
YIELDLOOM_TOSS_MOCK=1 npm run dev -- --host 127.0.0.1
# http://127.0.0.1:5173/tests/toss-connection-demo.html
node tests/account-toss.browser.mjs
node --test tests/account_toss_connection.test.mjs
```

모의 API `/__dev/toss-connection`은 명시적 플래그 + Vite serve + development 모드 + loopback 접속을 모두 요구한다. 교차 origin 요청도 차단한다. fixture는 테스트 전용 메모리 계좌/연결/토큰이며 네트워크 issuer가 없다. 모의 화면은 앱 라우트와 운영 빌드 입력에 없고, 응답과 화면 모두 simulation임을 명시한다. 모의 인증은 운영 API에서 허용되지 않는다. 개발 서버를 외부 프록시에 공개하지 않는다.

## 서버 계약

`lib/account-toss-connection.js`는 명시적으로 주입받은 repository/tokens/read만 사용한다. 운영 어댑터는 연결하지 않았다.

- Connection: 실제 API 명의자 subjectUid, credential generation, 실제 client 단위 clientIdentity, 승인된 서버 전용 secretRef, 실행준비 상태. secretRef는 사용자가 지정하는 경로나 URL이 아닌 승인된 서버 매핑이다. connection과 계좌는 1:N 가능하다.
- Account binding: 동적 investmentAccounts ID → connectionId + 사전 검증한 전체 계좌번호 해시 + suffix + collector accountSeq 해시 + revision/generation. accountSeq 원문은 서버 조회 안에서만 사용한다. 브라우저 요청은 앱 accountId만 받으며 임의 accountSeq/비밀 필드는 거부한다.
- Repository: account/family/connection/binding/options/read와 connection lock, 원자적 commit, audit 계약. commit은 최신 가족 참여/ACL/명의자/연결권한/generation/계좌해시/이전revision을 동일 트랜잭션에서 재검증해야 한다. memory fixture는 실제 분산 저장소를 대체하지 않는다.
- Token store: 실제 clientIdentity 단위 분산 lock 및 read/write/active 계약. active는 해당 client의 현재 credential generation과 사용 허용 상태를 확인해야 한다. clientIdentity는 원본 client_id의 브라우저 노출값이 아닌 내부 식별자다. 동일 client를 다른 연결 ID로 중복 등록해 별도 발급하지 못하도록 registry가 보장해야 한다. TTL은 응답 expires_in을 따르고 30초 여유를 둔다. refresh token이나 401/403 후 자동 재발급은 없다.
- Lock은 HTTP 인스턴스뿐 아니라 같은 client를 쓰는 CLI/실행자 전체에서 공유해야 한다. 프로세스 충돌·lease 만료·회전에는 fencing이 필요하다. issuer가 성공했으나 응답/저장이 유실된 경우 자동 재시도로 토큰을 반복 발급하지 않는 운영 절차도 필요하다. 현재 메모리 lock 경쟁검사는 인터페이스 검증이며 분산 장애 검증이 아니다.
- 조회 transport는 고정 공식 origin의 GET accounts/holdings/orders 목록·안전한 상세 경로만 허용한다. 토큰 POST 및 주문 생성/정정/취소는 allowlist에 없다. redirect:error, timeout, 안전한 오류 코드, 401/403 중단을 적용한다. 자동 retry는 없다. 이번 계좌 UI는 holdings 조회만 구현하며 주문 collector 교체가 아니다.
- 조회 전후 권한·연결 generation·계좌 binding을 재검증하고 늦은 결과를 폐기한다. query는 잔고 문자열 투영만 반환하고 holdings나 원장을 저장하지 않는다. 감사에는 내부 actor/account/connection ID, action, outcome, at만 기록한다. 실제 감사 저장소/보존정책은 미구현이다.
- 해제는 신규 조회를 막고 accountSeq binding을 해제한다. 비활성/회전된 연결도 해제 가능하다. 기존 장부·원문·감사 이력은 유지하며 공급자 키/토큰 폐기는 별도다.

기존 `GET /api/toss-portfolio?action=accounts|holdings&accountSeq=…`는 공용 키와 이메일 허용 목록만으로 앱 계좌 권한을 입증하지 못하므로 인증 후 410 `ACCOUNT_SCOPED_CONNECTION_REQUIRED`로 종료한다. 새 accountId 기반 GET/POST는 **같은 함수**를 사용해 Vercel 함수 12개 제한을 유지한다. 이 경로는 공급자 호출이 없는 비활성 어댑터만 연결한다. 기존 저수준 normalize/helper와 수동 CLI는 수정하지 않았다.

## 요청량·캐시

패널 최초 열기 상태 GET 1회, 동시 소비자의 같은 세션/계좌 GET은 1회로 합친다. GET 결과를 장기 캐시하지 않아 다시 열기/명시 재확인은 각 1회다. 닫힌 패널의 계좌 전환은 0회, 열린 패널은 새 계좌 상태 1회다. mutation은 임의로 합치거나 재시도하지 않는다. 처리 중 중복 버튼은 비활성이다. 취소/화면 이탈은 서버 변경 취소를 보장하지 않으므로 재진입 시 최신 상태를 다시 읽는다. 한 소비자 취소가 다른 소비자를 중단하지 않으며 로그아웃/계좌전환 뒤 응답은 폐기한다.

모의 register/verify/query/disconnect는 각각 브라우저 POST 1회다. mock verify는 accounts 1회, query는 accounts 1회 + holdings 1회 **가짜 함수 호출**이며 실제 금융 API는 0회다. 운영 상태 경로는 허용 계좌에서 Firestore 계좌+가족 2문서 읽기와 Firebase 취소 확인을 수행한다(코드상 예상, 실제 운영 측정 아님). 등록/동기화를 운영 활성화했을 때의 문서 읽기·쓰기와 청구량은 미측정이다.

## 실제 활성화 전에 남은 작업

명의자별 동의 및 제3자 키 공유/자료 이용 조건에 맞는 운영모델, 고정 송신 IP 실행 위치와 allowedIP, 승인된 비밀 저장소와 참조 등록, 공유 token store/분산 lock/CLI 조정, 거래형 repository/audit 저장소, 독립 계좌 소유 증거와 바인딩 등록 절차가 필요하다. 새 키·암호화키·네트워크/권한 설정은 별도 승인 범위다. API 명세는 client당 유효토큰 한 개와 재발급 시 기존 토큰 즉시 폐기를 명시한다. 공식 출처: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json 와 https://openapi.tossinvest.com/openapi-docs/faq.md .

고정 wife-toss/husband-toss CLI 프로필과 동적 앱 account ID의 자동 매핑은 하지 않는다. 기존 publication/R2/index/Google/PDF/장부는 변경하지 않는다. 후속 수집 연결에서는 기존 불변 원문·receipt·계좌별 index·중복검증 계약을 별도로 적용해야 한다. 연결 확인/잔고 조회는 과거 이력 completeness, 기초 lot, 개별 fill 순서, 배당 입금 확보를 증명하지 않는다.

## 검증 기록

전체 `node --test tests/*.test.mjs` 697개 통과(추가 연결 안전성 15개 포함), `npm run type-check` 및 `npm run build` 통과. `npm run lint:check`는 오류 0개/기존 경고 72개이며 신규 파일 대상 ESLint는 경고·오류 0개다. 빌드는 기존 큰 청크 경고가 있다. 운영 번들에서 모의 account/secretRef/token fixture 문자열이 없음을 확인했다.

브라우저는 실제 localhost Vite middleware → 인증 handler → 서비스 → 메모리 repository/token store → 가짜 provider를 통과했다. 최초 상태/등록/확인/조회는 각 HTTP 1회이고 전체 시나리오 13회였다. 계좌 전환 중 늦은 결과 폐기, 처리 중 중복 버튼 차단, 해제, 오류/재시도, 닫기/재열기와 뒤로가기, 키보드, 모바일 390px/데스크톱 1440px·다크 모드를 확인했다. 수평 넘침과 내부 세로 스크롤 0개, 외부 요청·Firebase/R2/금융 API·브라우저 저장 0회다. 실제 관리자 로그인·운영 계좌/서비스 및 진짜 분산 저장소 검증은 하지 않았다. 자체 리뷰에서 관리 권한 검사에 계좌 role(owner/editor)와 실제 명의자·authorityUid를 함께 적용하도록 보강했다.
