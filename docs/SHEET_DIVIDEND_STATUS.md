# 배당 상세 수집·정규화 계약

`TOSS_EXPECTED_DIVIDEND`는 토스의 **메뉴 출처 식별자**입니다. 메뉴명이 예상 배당금이어도
과거의 확정·지급 상세가 포함됩니다. 종류명/연도/날짜 경과로 지급을 추정하지 않습니다.
기존 kind와 sourceId를 바꿔 중복 수집하지 마세요. 배치 저장·재개는
[관측 배치 계약](SHEET_OBSERVATION_BATCHES.md)을 그대로 따릅니다.

## 상태 필드

| 필드                                  | 값/의미                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| `values.confirmationStatus`           | `CONFIRMED` 확정, `UNCONFIRMED` 미확정, `UNKNOWN` 확인 불가 |
| `values.paymentStatus`                | `PAID` 지급, `UNPAID` 미지급, `UNKNOWN` 확인 불가           |
| `values.paidAt`                       | 원문에서 확인한 **실제 지급** 날짜/일시 또는 null           |
| `dividendState.confirmationStatusRaw` | 확인한 확정 상태 원문 문자열                                |
| `dividendState.paymentStatusRaw`      | 확인한 지급 상태 원문 문자열                                |

`paidAt`은 `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, 초/밀리초까지 지원합니다. 보이지 않은
시분초·시간대는 추가하지 않습니다. 예정 지급일/예정 결제일을 paidAt에 복사하지 않습니다.
`paymentDate`와 실제 지급 일시는 별개입니다. 누락된 상태/일시는 `UNKNOWN`/null로 남깁니다.

확정 원문은 `확정`/`confirmed`, 미확정은 `미확정`/`unconfirmed`를 지원합니다.
지급 원문은 `지급`/`지급 완료`/`지급완료`/`paid`, 미지급은 `미지급`/`unpaid`를 지원합니다.
영문은 대소문자를 구분하지 않고 앞뒤 공백을 제외합니다. 미지원 원문은 UNKNOWN으로
보존합니다. 수집기가 지원되는 문구를 지어내면 안 됩니다. values의 확정 상태 주장이 실제
원문 문구와 다르거나 원문이 없으면 거절합니다. 알려진 원문만 제출하면 서버가 대응 enum을
설정할 수 있습니다. 전체 원문/기타 원본 필드는 `rawText`와 top-level `dividendState`에
그대로 보존되며 `original`/`batch-source`에서 조회할 수 있습니다.

```json
{
    "kind": "TOSS_EXPECTED_DIVIDEND",
    "sourceId": "SYNTHETIC-dividend-1",
    "accountId": "wife",
    "type": "DIVIDEND",
    "symbol": "TEST",
    "location": "합성 배당 상세",
    "dividendState": {
        "confirmationStatusRaw": "확정",
        "paymentStatusRaw": "지급"
    },
    "values": {
        "confirmationStatus": "CONFIRMED",
        "paymentStatus": "PAID",
        "paidAt": "2024-01-10",
        "netDividendUsd": 1
    },
    "rawText": "합성 원문 · 실제 계좌 자료 아님"
}
```

## 판단과 현금 중복 방지

- 확정·지급: `cashEligible=true`, `forecast=false`. **현금 생성 허가가 아니라 대조 자격**입니다.
- 확정·미지급: 확정액의 미지급 청구/예정 내역입니다. `cashEligible=false`, `forecast=false`.
- 미확정·미지급: `cashEligible=false`, `forecast=true`.
- 상태 불명: `cashEligible=false`. forecast는 미확정 원문이 있을 때만 true이며 UNKNOWN과 다릅니다.
- 미확정+지급, 미지급/지급불명+paidAt 등 모순은 거절하고 원문을 확인합니다.

관측 저장은 어느 상태에서도 거래나 현금유입을 만들지 않습니다. 기존 `accept-evidence`
액션에서 배당은 **기존 DIVIDEND/DEPOSIT 행에 근거만 연결**합니다. targetId가 없으면 새
입금으로 만들지 않고 거절합니다. accountId·observationId·reviewVersion·장부 version과
관리자 note는 기존 계약대로 사용합니다. 배당의 fields는 금융값 채택에 사용하지 않습니다.

연결 조건은 확정/지급 원문, 실제 paidAt, 같은 계좌·지급일·티커(기존 입금에 있는 경우),
같은 통화의 세후 배당/실제 입금액입니다. USD/KRW를 환산·합산하지 않습니다.
USD 0.005 / KRW 0.5 이내의 표시 반올림 차이만 허용하며 비교 가능한 양수 금액이 필요합니다.
하나라도 알려진 공통 통화의 금액이 다르면 거절합니다. 실제 지급일이 없거나 다중 후보이면
임의로 선택하지 않습니다. 관리자가 선택한 targetId로만 연결하고 미래 지급은 거절합니다.
둘 이상의 출처가 한 입금을 입증해도 기존 행/금액은 그대로이며, 같은 관측을 다른 입금에
다시 연결할 수 없습니다. `receiptLink`에 관리자·근거·시각이 남습니다.

기존 시트/PDF/legacy의 상태 불명 자료는 원문/거래값을 보존하고 지급으로 소급 확정하지
않습니다. 기존 저장 관측이 배당 상태 투영을 갖지 않으면 요약은 미확인으로 표시합니다.
원문 상세를 읽을 때는 보존 원본으로 상태를 재해석할 수 있지만 DB 마이그레이션/원문 변경은
하지 않습니다. 잘못된 과거 원문도 확인용으로 반환하고 상태 검토가 필요함을 표시합니다.
같은 sourceId의 원문/상태 변화는 기존과 같이 409이며, 실제 개정이면 새 개정 ID로 보존합니다.
