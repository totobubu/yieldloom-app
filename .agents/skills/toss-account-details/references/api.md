# 개인 주문 API 범위와 수동 실행

공식 [최신 OpenAPI](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)를
호출 전에 확인한다. 작성 시 확인한 버전은 1.2.24다. 정해진 호스트는
`https://openapi.tossinvest.com`이며, 다른 호스트·추정 endpoint로 인증을 보내지 않는다.

| 경로                               | 의미                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| `POST /oauth2/token`               | 기존 Client Credentials의 OAuth 토큰 발급. 새 영구 키 발급 아님 |
| `GET /api/v1/accounts`             | 대상 계좌 확인. 응답 accountSeq를 메모리에서만 헤더에 사용      |
| `GET /api/v1/orders?status=OPEN`   | 모든 현재 진행 주문. limit/cursor 무시                          |
| `GET /api/v1/orders?status=CLOSED` | 지원되는 종료 주문. nextCursor/hasNext로 마지막 페이지까지      |
| `GET /api/v1/orders/{orderId}`     | 필요 시 이전 OPEN 주문의 개별 상태 확인                         |
| `GET /api/v1/trades`               | **시장 체결**. 개인 거래내역으로 사용하지 않음                  |

개인 계좌 호출에는 Bearer와 `X-Tossinvest-Account`가 필요하다. 목록 from/to는
KST **주문 생성일 orderedAt**의 inclusive 필터이며 체결일/수정일 필터가 아니다.
오래전에 생성된 주문의 현재 체결·취소를 기간 필터만으로 빠짐없이 확인했다고 하지 않는다.
OPEN에서 사라진 주문은 체결·취소를 단정하지 말고 필요 시 승인된 상세 조회로 확인한다.
수동 helper는 목록만 지원하므로 개별 상세 호출을 했다고 보고하지 않는다.

REST 목록·상세는 주문별 누적 체결 요약이다. 개별 분할 체결 사건 전부의 원장이 아니며
filledQuantity·금액은 원문 소수 문자열을 유지한다. 부분 체결 후 취소도 수량을 보존한다.
API 미지원 호가 유형은 목록/상세에서 제외될 수 있다. 개인 배당 입금·입출금·환전은
확인한 REST 명세에 없으며, 배당은 ego light의 개인 입금 화면으로 별도 확인한다.

## 실행 계약

저장소 루트에서 Node 24로 실행한다. 먼저 다음 무인증 도움말을 확인한다.

```sh
node scripts/toss/read-account-orders.mjs --help
```

다음은 **실행 양식**이다. 꺾쇠 부분은 대화에서 확인된 값으로 바꾸며 그대로 실행하지 않는다.

```text
node scripts/toss/read-account-orders.mjs --live --account-suffix <선택한계좌끝4자리> --status BOTH --from <YYYY-MM-DD> --to <YYYY-MM-DD> --env-file <기존로컬설정파일절대경로>
node scripts/toss/read-account-orders.mjs --live --account-suffix <선택한계좌끝4자리> --status OPEN --env-file <기존로컬설정파일절대경로>
```

설정 이름은 `TOSS_ACCESS_TOKEN`, `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`,
`TOSS_ACCOUNT_SEQ`다. helper는 accounts 응답에서 지정된 끝자리와 일치하는 종합매매
계좌가 정확히 하나인지 검증하므로 accountSeq를 추측하거나 설정 파일에 써 넣지 않는다.
OS 환경의 기존 값이 파일보다 우선한다. 파일을 새 checkout으로 복사하지 않는다.

기존 유효 토큰이 없고 같은 키의 인증이 허용됐을 때만 위 양식에 `--issue-token`을
추가한다. 동일 client의 이전 토큰이 무효화되므로 다른 작업과 동시 발급하지 않는다.
토큰은 한 호출에서 재사용하고 출력·저장하지 않는다. 401/403은 중단하며 재발급·IP 변경으로
우회하지 않는다. 전체 과거를 명시 요청한 경우에만 날짜 대신 `--all-history`를 사용한다.

`BOTH`의 OPEN은 현재 주문 전체, CLOSED에만 요청 기간을 적용한다. collector는
호출마다 고유 run을 만들어 `var/toss-orders/`에 원문·해시·체크포인트를 보존한다.
summary의 apiStatus와 각 scopes를 확인한다. `complete`는 요청한 API 응답 범위의 종료다.
배당 브라우저 읽기나 계좌 평생 모든 금융사건의 완전성을 증명하지 않는다.
`partial`은 저장된 원문을 보존한 미완료, `authentication_required`는 조회 미실행이다.

숫자는 반올림하지 않고, 중복 주문을 목록/상세 합계로 두 번 세지 않는다. 이전 관측과
비교를 요청받으면 계좌+orderId별 status·execution.filledQuantity 등을 대조하되
기존 관리자 채택값을 바꾸지 않는다. 조회 사이 정정·새 주문이 있어 스냅샷 고정은 보장되지 않는다.
