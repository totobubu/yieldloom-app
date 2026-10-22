# 가격·분할 비공개 후보 입력

무료 공개 재배포·접근·분할/보정 계약을 충족한 공급자는 아직 확정되지 않았다.
`market_import.py`는 공급자 연결 전에 사용할 **정규화 입력 저장·검증·비교 도구**다.
외부 HTTP 요청·수집 스케줄·공개 발행·구 R2 이관·앱 전환을 실행하지 않는다.
운영 가격이 독립했다는 의미가 아니다. 기존 가격 계약을 그대로 재사용한다.

## 입력 계약

입력은 비공개 JSON 파일이다. 숫자는 소수 문자열로 쓰며, 원화/달러와 가격 보정 기준을
명시한다. `sourceDocumentId`는 이 입력 파일의 실제 SHA-256으로 도구가 부여한다.
이 해시는 공급자 HTTP 응답을 직접 수집했다는 증명이 아니다. 실제 공급자 어댑터를 연결할 때
공급자 응답 원문 보관과 계약상 허용된 재사용 근거를 별도로 검증해야 한다.
입력 캐시는 내부 URN을 사용하므로 기존 외부 HTTP ETag 캐시와 충돌하지 않는다.

```json
{
  "schemaVersion": 1,
  "sourceId": "reviewed-provider",
  "sourceUrl": "https://provider.example/history",
  "prices": [{
    "entityId": "instrument:isin:US4642872000",
    "asOfDate": "2026-10-21",
    "currency": "USD",
    "priceBasis": "unadjusted",
    "coverage": "close_only",
    "close": "100.0000",
    "volume": null
  }],
  "actions": [{
    "entityId": "instrument:isin:US4642872000",
    "eventId": "stable-provider-event-1",
    "effectiveDate": "2026-10-01",
    "actionType": "split",
    "newShares": "2",
    "oldShares": "1"
  }]
}
```

예시는 가상 가격과 분할이다. `coverage=ohlc`면 실제 open/high/low를 제공해야 하며
없는 값을 종가로 채우지 않는다. volume은 결측과 0을 구분하고 값이 있으면 `volumeUnit=shares`가
필요하다. `split_adjusted`·`total_return_adjusted`는 `adjustmentAsOfDate`가 필요하다.
한 배치는 32 MiB·10만 행 이내다. 공급자 내 중복 가격 키·분할 eventId는 입력 전체를 거절한다.

## 저장과 병행 대조

```sh
python scripts/data_platform/market_import.py import --root var/data-market-candidate --input var/market-input/provider-a.json
python scripts/data_platform/market_import.py import --root var/data-market-candidate --input var/market-input/provider-b.json
python scripts/data_platform/market_import.py compare --root var/data-market-candidate --left-source provider-a --right-source provider-b --output var/market-review/comparison.json
```

증분 입력은 과거 행을 지우지 않는다. 같은 공급자·개체·날짜·통화·보정 기준의 값 변경은
새 revision이며, 분할은 안정된 eventId를 기준으로 시행일 정정도 추적한다.
내용이 같은 재입력은 revision을 늘리지 않고 새 입력 해시는 근거 이력에 추가한다.
명시적인 자료 철회/삭제 계약은 아직 지원하지 않으므로 빠진 행을 삭제로 해석하지 않는다.

기존 비공개 Store의 관측 DB에 `market_revisions`·`market_evidence`를 별도 저장하므로
관측값의 현재 집합을 바꾸지 않는다. 기존 체크포인트의 DB·입력 파일 해시 검증과 왕복 복원을
재사용한다. 기본 후보 경로는 기존 운영 수집 root와 분리되며, 정기 백업에 자동 편입되지 않는다.
보관이 필요하면 후보 root에 기존 checkpoint backup 명령을 명시적으로 사용한다.

비교는 같은 개체·날짜·통화·보정 기준끼리만 수행한다. 보정 기준일이 다르면 비교 불가로
분리한다. 종가·OHLC 차이와 커버리지·거래량 차이, 양쪽 누락을 보고한다.
가격 절대 허용치는 기본 0이며 `--absolute-tolerance`로만 바꾼다. 거래량에는 가격 허용치를
적용하지 않는다. 분할 원장 저장은 지원하나 공급자 간 분할 이벤트 대조와 보정 재계산은 후속이다.
보고서는 항상 `cutoverReady=false`이며 비교 일치만으로 공개 이용 권한이나 이관 승인을 추론하지 않는다.

## 2026-10-22 추가 공급자 검토

- [Financial Datasets 약관](https://www.financialdatasets.ai/terms-of-use): Professional 표시 권한과
  별개로 원시·bulk 데이터의 다운로드·feed·API 재배포 제한을 확인했다. 무료 공개 가격 R2 공급자로 선정하지 않는다.
- [Finazon US Equities Basic](https://finazon.io/dataset/us_stocks_essential): 상업 표시·재배포에 대한
  설명은 있으나 [가격 안내](https://finazon.io/pricing)는 구독 절차를 명시한다. 별도 라이선스 요금이
  없다는 문구를 무료 API 공급으로 해석하지 않는다. 무료 접근·정확한 보정 계약은 확인이 필요하다.
- [Stooq 다운로드](https://stooq.com/db/h/): 브라우저 확인 화면으로 원문 및 공식 재배포 조건을
  확인하지 못했다. 접근 우회나 공개 재배포 허용을 추정하지 않는다.
- iShares/Nasdaq 기존 약관 URL도 이번 웹 도구에서 접근하지 못했다. 공개 승인 상태를 변경하지 않는다.

이 도구의 로컬 왕복 복원·정정·중복·결측 검증과 실제 가격 공급자의 병행 실험은 별개다.
무료 공급자 확정, 실제 응답 원문 어댑터, 분할 대조/보정 재계산, 철회 계약,
과거 자료 병행 대조·복구 검증을 마친 후에만 기존 가격 경로를 전환한다.

추가 무료 공급자 4곳과 iShares 자동 수집 조건의 실제 적용 결과는
[무료 출처 재검토](FREE_SOURCE_REVIEW_2026-10-22.md)에 정리했다.
현재 가격 공급자 결정은 계속 `blocked`이며, iShares 10개 출처는 공식 허가 확인 전 자동 수집도 중지한다.
