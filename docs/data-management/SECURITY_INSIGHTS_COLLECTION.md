# ROC와 미국 주식·ETF 정보 수집

## 실행

기존 배당주 검증·등록 뒤 새 정보를 함께 수집하는 통합 명령:

```bash
python scripts/utils/run_us_collection.py --resume --workers 8
# npm run collect:us-data -- --resume --workers 8
```

기존 등록 목록의 정보만 수집하거나 특정 종목을 갱신할 수도 있습니다.

```bash
python scripts/utils/collect_security_insights.py --resume --workers 8
python scripts/utils/collect_security_insights.py --symbol TXN --symbol SPYI
python scripts/utils/collect_security_insights.py --symbol SPYI --tax-document SPYI=https://neosfunds.com/wp-content/uploads/SPYI-19a-1-Notice-9.16.26-Confidential.pdf
# npm run collect:security-insights -- --resume --workers 8
```

의존성은 `requirements-workflow.txt`의 yfinance·pandas·requests·BeautifulSoup·pdfplumber를 사용합니다.
기본 대상은 `public/us-dividend-stocks.json`과 `data-v2/catalog-seed.json`의 활성 USD 종목 합집합입니다.
`--limit`은 수집 수를 제한하며 0이 전체입니다. `--resume`은 같은 UTC 날짜와 수집기 버전의
완료된 관측을 재사용하고, 실패·부분 수집은 재시도합니다. 대상 일부만 다시 실행해도
나머지 종목의 기존 관측을 지우지 않습니다.

기존 Content Studio 수집에도 선택적으로 연결했습니다:

```bash
python scripts/content_pipeline/refresh.py --scope ticker --ticker SPYI --with-insights
```

보조 지표 조회 실패는 기존 공식 배당 원장을 지우거나 실패한 값으로 교체하지 않습니다.
운영 스케줄이나 배포를 새로 만들지 않으며, 명령을 실행할 때 수집합니다.

## 수집 항목과 기준

| 항목 | 출처·처리 |
|---|---|
| ROC | 기존 운용사 배당 표와 NEOS 19a·Form 8937 PDF, 원문 소수 문자열 보존 |
| 1년 배당 포함 총수익률 | Yahoo 조정 종가 비율, `provider_adjusted_estimate` 명시 |
| 최근 12개월 배당·증감·수익률 | 2년 가격/배당 이력, 배당락일 기준 두 연간 구간 비교 |
| 배당 지급 여력 | 보고된 이익 배당성향, 실제 4개 분기 FCF와 현금배당 합계·비율 |
| ETF NAV | Schwab SCHD 공식 CSV, Vanguard VYM·VIG 공식 NAV 시계열 |
| 비용·유동성 | ETF 보수, 순자산, 평균 거래량, 현재 호가 스프레드 |
| 편입·업종·중복 | 기존 공식 보유종목과 Yahoo 업종 비중, 두 ETF의 공통 종목별 최소 비중 합계 |
| 배당 일정 | 기존 승인된 공식 배당 날짜와 Yahoo 보고 날짜를 별도로 보존 |

Yahoo 조정 종가로 계산한 값은 운용사 공식 총수익률로 승격하지 않습니다. 가격과 현금배당에
다른 조정 기준이 섞이지 않도록 과거 2년 내 분할이 있는 종목의 TTM 현금배당 비교는
`needs_corporate_action_review`로 남깁니다. 1년·2년 이력이 부족하면 연간 지표를 계산하지 않습니다.
평균 호가 스프레드가 아닌 현재 호가 스냅샷이며, 한쪽 호가가 없으면 계산하지 않습니다.
ETF 편입 자료 기준일이 서로 다르면 중복 비중에 `mixed_or_unknown_as_of_dates`가 표시됩니다.

FCF 배당성향은 4개의 연속 분기 모두 실제 값이 있어야 계산합니다. FCF가 0 이하이거나
현금배당 부호가 모호하면 비율을 계산하지 않습니다. 각 분기 원본 금액과 보고 통화를 보존합니다.
REIT의 FFO/AFFO와 금융업의 특수 지표는 회사별 공식 공시가 필요한 항목으로 표시하며,
일반 FCF 비율로 대신하지 않습니다.

NAV에는 시장가격을 넣지 않습니다. 공식 시계열을 지원하지 않는 ETF는 Yahoo NAV 관측값만
출처와 함께 남기고 `navHistory`를 미확인으로 표시합니다. NAV 수준 변화는 분배금을 제외한
가용 구간의 변화율이며 총수익률과 다릅니다. 보고 기준일이 제공되지 않은 보수·업종 비중·NAV
스냅샷에는 `asOfDate: null`을 남기고 별도 수집 시각을 보존합니다.

## ROC 분류

- `estimated`: 19a 잠정 추정. 지급 건과 회계연도 누적치를 별도 관측으로 저장합니다.
- `final`: 운용사 Form 8937의 실제 지급 건별 첨부 표. 근거는 `issuer_form_8937`입니다.
- `unclassified`: 기존 운용사 표에 ROC 비율은 있지만 잠정·확정 근거를 저장하지 않았던 기록입니다.
- `not_disclosed`: 해당 종목에 ROC 근거가 없음. 0%를 뜻하지 않습니다.

19a의 기록일을 배당락일로 추정하지 않습니다. 회계연도와 개인의 달력연도 세무 처리를
동일시하지 않으며, 문서가 명시하지 않은 `taxYear`는 비워 둡니다. 기존 비율만으로 지급별
정확한 ROC 금액을 만들지 않습니다. 명시된 0%는 실제 값으로 보존합니다.

SPYI·QQQI·IWMI는 공식 페이지에서 문서 링크를 찾습니다. 인덱스가 403 등으로 조회되지 않으면
2026-10-14에 공식 링크를 검토한 2026년 9월 19a와 2025년 말 Form 8937의 시드 URL을 사용합니다.
시드는 해당 날짜의 문서이며 최신 공시 전체를 보장하지 않습니다. 원문 조회·문서 형식 실패는
`taxSources`에 남습니다. 다른 공식 PDF는 `--tax-document ETF=URL`로 지정할 수 있으며,
지원되지 않은 형식은 금액이나 분류를 추정하는 대신 실패로 기록합니다.

## 누적 저장

```text
var/data-management/security-insights/
  latest.json                       # 요약, 출처, 관측 파일 참조
  raw/                              # 원문 PDF·NAV·정규화된 공급자 응답, SHA-256 기준
  roc/                              # ROC 관측: 지급/누적/추정/확정 및 문서 수정별 별도 ID
  observations/{ticker}/{hash}.json  # 실제 가격·배당·분할·NAV와 지표 관측
  snapshots/{date}/{hash}.json       # 날짜별 실행 결과
```

개별 종목 원본 관측은 즉시 저장하고 진행 요약은 약 100개 단위와 종료·중단 시 원자적으로
저장합니다. 기존 원본이나 ROC 추정치를 확정자료로 덮어쓰지 않습니다. 같은 문서·같은 값은
중복 저장하지 않고 변경된 문서나 정정 값은 별도 관측으로 추가합니다.
`latest.json`의 `observationPath`에서 전체 가격·NAV 이력을 읽을 수 있습니다.

모든 자료는 비공개 관측 영역에 저장합니다. 공식 배당 원장·코어 릴리스·운영 검색 파일을
이 명령이 직접 갱신하거나 게시하지 않습니다. 누락 값은 `null`과 사유를 저장합니다.
실패한 소스가 있으면 성공한 자료도 보존하고 종료 코드 2를 반환합니다.
