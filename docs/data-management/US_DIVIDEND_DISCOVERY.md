# 미국 배당주·배당 ETF 편입 종목 수집

`scripts/utils/discover_us_dividend_stocks.py`는 신규 종목 후보와 근거를 별도
JSON 보고서에 저장합니다. `export_us_dividend_catalog.py`로 확인된 배당주를
앱 검색 목록에 등록합니다.

```bash
# SCHD, DGRO, HDV 공식 전체 보유종목 수집
python scripts/utils/discover_us_dividend_stocks.py --etf SCHD --etf DGRO --etf HDV

# 신규 후보 우선으로 최근 365일 배당 이력 20개 조회
python scripts/utils/discover_us_dividend_stocks.py --etf SCHD --etf DGRO --etf HDV --verify-limit 20

# 미국 상장 주식 전체를 후보에 추가하고 전체 배당 검증
python scripts/utils/discover_us_dividend_stocks.py --all-us --verify-limit -1 --workers 8

# 중단된 검증 재개: 당일 완료된 결과를 보존하고 미검증·실패 종목만 조회
python scripts/utils/discover_us_dividend_stocks.py --resume --verify-limit -1 --workers 8

# ETF 편입 자료도 갱신하면서 재개
python scripts/utils/discover_us_dividend_stocks.py --resume --refresh-etfs --verify-limit -1

# 검증된 종목을 앱 검색 목록에 등록
python scripts/utils/export_us_dividend_catalog.py

# Vanguard 공식 전체 보유종목 CSV를 함께 수집
python scripts/utils/discover_us_dividend_stocks.py --holdings-csv VYM=/path/vym.csv --holdings-csv VIG=/path/vig.csv
```

프로젝트 의존성은 `requirements-workflow.txt`를 사용합니다. npm 실행도 가능합니다:
`npm run discover:us-dividends -- --etf SCHD`, `npm run register:us-dividends`.

기본 ETF는 SCHD·DGRO·HDV·VYM·VIG입니다. SCHD 다운로드 링크는 공식 상품 페이지에서
찾고, DGRO·HDV는 iShares의 `latest-holdings.csv`를 사용합니다. VYM·VIG는 Vanguard의
공식 `vmf/api/<ETF>/portfolio-holding/stock.json`에서 모든 페이지를 조회합니다.
페이지별 기준일·전체 행 수·누락을 검사하고 Nasdaq Trader 목록과 연결해 미국 거래소를 확인합니다.
Vanguard 자료는 월말 기준일일 수 있으며 그 날짜를 그대로 보존합니다.
로컬 CSV는 `--holdings-csv ETF=PATH`로 제공할 수 있습니다.
CSV에는 `Ticker` 또는 `Symbol`, `Name`, `Exchange`, `Weight (%)` 또는
`Percent of Assets`가 필요합니다. 기준일은 `Fund Holdings as of` 또는 `As-Of-Date`에서
읽습니다. 현금·선물·비미국 거래소·비USD 자산은 제외합니다.

`--all-us`는 Nasdaq Trader의 Nasdaq 및 기타 거래소 종목 디렉터리를 함께 조회하며
ETF·테스트 종목·워런트·권리·SPAC 유닛을 제외합니다. 배당 가능한 상장 파트너십·예탁 유닛은
후보로 유지하고 USD 주식 여부와 배당 이력을 검증합니다. 전체 검증은 오래 걸릴 수 있습니다.
`--verify-limit` 기본값은 0(후보 수집), -1은 전체입니다. 기본 동시 조회 수는 4이고
`--workers`로 1~8개를 선택합니다. 조회 배치 사이 기본 간격은 1초이며
`--delay`로 조정합니다. 배당 조회는 Yahoo Finance/yfinance의 chart 조회를 사용합니다.
월별 가격 간격으로 전송량을 줄이되 배당 이벤트는 개별 배당락일을 보존합니다.
각 배치 완료 시 보고서를 임시 파일에 쓰고 원자적으로 교체하므로 중간 결과가 남습니다.
`--resume`은 이전 날짜의 검증 결과를 오늘의 배당주 판정에 재사용하지 않습니다.
새 실행 전에 기존 보고서를, 실행 완료 후에는 새 결과를
`var/data-management/us-dividend-discovery-archive/<기준일>/<내용 SHA-256>.json`에 누적합니다.
동일한 내용은 중복 저장하지 않고, 변경된 결과는 새 파일로 보존합니다.
각 스냅샷에는 종목별 개별 배당 이벤트와 검증 실패·출처가 포함되므로 다음 날짜의 조회가
이전 관측 자료를 덮어쓰지 않습니다. `--archive-dir`로 위치를 지정할 수 있습니다.
누적 자료는 비공개 관측 자료이며 공식 배당 원장과 구분합니다.

출력 기본 위치는 `var/data-management/us-dividend-discovery.json`입니다.
각 종목에는 ETF별 비중·기준일·출처와 기존 등록 여부가 기록됩니다.
같은 종목은 통합하지만 각 ETF 편입 근거는 유지합니다. 배당 검증 상태는
`verified`, `no_recent_dividends`, `not_checked`, `unavailable`, `ineligible`로 구분합니다.
Yahoo 배당 이력의 날짜는 배당락일이며 실제 현금 지급일 확인을 뜻하지 않습니다.
정기배당과 특별배당은 이 자료만으로 분류하지 않습니다.

`newVerifiedSymbols`는 최근 배당 이력이 확인된 미등록 종목 목록입니다.
`export_us_dividend_catalog.py`는 확인된 종목만 `public/us-dividend-stocks.json`에 등록합니다.
공식 코어 카탈로그의 기존 이름·ISIN·비활성 상태를 유지하면서 앱 검색 목록과 API 메타데이터에
연결하고, 주식 유형·영문명·편입 ETF·비중·기준일·Yahoo 배당 근거를 저장합니다.
당일 검증이 아니거나 배당 이벤트가 없거나 잘못된 금액이면 등록을 거부합니다.
빈 수집 결과가 기존 등록 목록을 지우지 않습니다.

검색 화면에서 영문명과 편입 ETF 티커로도 검색할 수 있습니다. 최근 배당금·배당락일은
기존 공식 자료가 있으면 우선 사용하고, 새 배당주는 Yahoo Finance 출처와 검증 기준일을 표시합니다.
Yahoo 자료는 공식 배당 원장이나 공식 배당 콘텐츠의 근거로 변환하지 않습니다.
ETF 편입만 확인된 종목이나 검증 실패 종목은 배당주로 등록하지 않습니다.

소스 또는 검증이 실패하면 성공한 결과도 저장하고 종료 코드 2를 반환합니다.
보고서의 `sources`와 `dividendVerification.error`에서 실패 이유를 확인할 수 있습니다.
