# 무료 공급자와 공개 이용 조건 재검토

확인일: 2026-10-22. 가격 후보는 기존 7개에 4개를 추가해 총 11개다.
공급자별 판정은 `data-v2/market-provider-decision.json`에 기록했다.
**검토한 후보에서 무료 접근·운영 공개 재배포·가격/분할 계약을 모두 확인한 공급자는 아직 없다.**
기존 가격 경로 이관과 새 가격 공개 발행을 활성화하지 않는다.

## 추가 가격 후보

| 공급자 | 확인한 공식 근거 | 판정 |
| --- | --- | --- |
| [Alpaca Broker 문서](https://raw.githubusercontent.com/alpacahq/bkdocs/master/content/market-data/_index.md) | 샌드박스 IEX는 무료 최종 사용자 배포를 설명하나, 운영 활성화는 영업 문의가 필요하고 SIP는 별도 계약·요금이 필요함 | 샌드박스 권한을 운영 공개 R2 권한으로 확대하지 않음 |
| [Finnhub 약관](https://finnhub.io/terms-of-service) | 데이터·파생 결과의 제3자 공유에 서면 승인을 요구하며, 별도 명시 없는 요금제는 개인 용도 | 무료 공개 공급자로 선정하지 않음 |
| [Marketstack 가격](https://marketstack.com/pricing/)·[FAQ](https://marketstack.com/faq) | 무료 월 요청 수가 100/1,000으로 다르고 무료 이력은 12개월. [약관](https://marketstack.com/terms)은 APILayer 법률 안내로 연결됨 | 할당량·원시 데이터 재배포 권한 미확정, 전체 과거 이관에도 부족 |
| [Nasdaq Data Link WIKI](https://data.nasdaq.com/databases/WIKIP) | 공식 페이지에 2018-04-11 이후 적극적인 지원 중단이 명시됨 | 신규 일별 수집 공급자로 선정하지 않음 |

Marketstack.com과 marketstack.pro는 서로 다른 서비스이므로 후자의 약관을 전자에 적용하지 않는다.
단일 거래소 IEX 데이터는 통합 거래소 종가·거래량과 같은 의미로 취급하지 않는다.
무료 플랜이 있다는 사실만으로 상업 표시·원시 JSON 재배포·분할 보정 이력을 승인하지 않는다.
소스 계정 가입이나 유료 계약·결제는 수행하지 않았다.

## iShares 자동 수집과 공개 발행

보관된 미국 iShares 제품 HTML의 footer는 다음 [BlackRock 공식 약관](https://www.blackrock.com/corporate/compliance/terms-and-conditions)을 연결한다.
이 약관은 허가 없는 자동 검색·모니터링·복사와 공개·상업적 재사용을 제한한다.
서면 허가가 등록되지 않은 확장 플랫폼의 iShares 10개 출처를 비활성화하고
`issuer-review-required.automatedCollection=false`와 공개 발행 차단을 기록했다.

수집기는 이 정책을 요청·캐시 원문 재처리보다 먼저 확인한다. 별도 registry에서 enabled를
다시 켜거나 `--force`를 사용해도 해당 정책을 우회하지 않는다. 기존 원문·관측·수집 상태는
삭제하거나 빈 값으로 덮어쓰지 않는다. 이후 실행 결과와 Actions 요약에 차단 출처를 표시한다.

이는 확장 플랫폼의 iShares 프로필·보유자산 10개 출처에 대한 변경이며,
기존 별도 배당 파이프라인의 운영 설정을 일괄 변경하는 작업은 포함하지 않는다.
허가 후 재개하려면 정책의 근거·버전·자동 수집 허용과 각 출처 enabled를 함께 검토해야 한다.

## 계속 사용할 수 있는 범위

- SEC 구조화 공시·재무 사실과 ECB 환율·거시는 기존 출처 표시·정확한 재현 조건 아래 유지한다.
- Nasdaq 디렉터리 파일과 [필드 정의](https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs)는 접근·형식을 확인했다.
  공개 재배포 승인 근거는 아직 확보하지 못했으므로 기존 공개 차단을 유지한다.
- iShares 보유자산을 대체할 수 있는 후보로 SEC N-PORT 구조화 공시가 있으나,
  별도 파서·펀드 시리즈 매핑·보고 지연 계약을 갖추기 전에는 같은 날짜 자료로 대체하지 않는다.

이 검토는 제3자의 허가를 대신 발급하는 절차가 아니다. 앞으로 무료 운영 권한과 필요한
가격·분할·정정 범위를 확인한 공급자가 생기면 비공개 후보 원장으로 병행 대조한 뒤 전환한다.
