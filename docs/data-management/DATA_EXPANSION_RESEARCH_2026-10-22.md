# 금융 데이터 수집 확장 조사와 분리 설계

조사일: 2026-10-22, 한국 시간. 상태: 도입 설계안. 수집기·앱·운영 설정 변경은 없다.

현재 미국 주식·배당 ETF 기능을 우선 대상으로 삼고, 한국 주식·ETF와 환율로 확장할 수 있는 구조를 검토했다. 구 R2는 과거 자료를 확인하는 출처 중 하나로 취급한다. 새 수집 범위와 계약의 기준으로 삼지 않는다.

## 1. 조사 범위와 확인 수준

공식 문서·안내·공개 표본 42개 URL을 직접 확인했다. HTTP 200은 40개, 404와 503은 각 1개였다. **200 응답 중 FRED/ALFRED 3개는 점검 안내였으므로 자료 확인 성공으로 세지 않았다.** 포털 진입 화면과 API 본문 확인도 구분했다.

실제 자료 표본은 Nasdaq 종목 목록, OpenFIGI AAPL 매핑, SEC AAPL 공시 JSON, iShares IVV 보유자산 CSV, NEOS SPYI 19a PDF, ECB 환율 XML, 한국은행 ECOS 공개 sample JSON이다. 유료 API 계약·키가 필요한 데이터 호출·전체 시장 수집은 수행하지 않았다. 조회 결과의 상태·URL·해시·한계는 [출처 검증 기록](data-source-audit-2026-10-22.json)에 보관했다. 외부 원문 전체를 Git에 넣지는 않았다.

## 2. 현재 시스템에서 확인한 점

아래 수치는 체크아웃의 파일·코드 기준이며 운영 서비스의 현재 상태를 재측정한 결과가 아니다.

| 대상 | 확인 결과 | 확장 설계에 주는 의미 |
| --- | --- | --- |
| `public/nav.json` | 2,173종목, 1,167,113바이트. 식별자·가격 경로·발행주식수·로고·기간·배당 빈도·분류·기초자산 등을 혼합 | 크기와 함께 소유자·갱신 주기·소비자 결합을 풀어야 한다 |
| `data-v2/catalog-seed.json` | 2,173종목 | 현재 식별 목록을 호환 입력으로 유지할 수 있다 |
| `data-v2/market-sources.json` | 가격 경로 2,165개 | 상품 식별과 공급자별 파일 경로를 분리하는 출발점이다 |
| 공식 배당 어댑터 | 15개 운용사 어댑터 | 배당 이벤트 계약을 유지하면서 다른 데이터 파서를 추가해야 한다 |
| `public/security-insights/*.json` | 64개 파일, 4,295종목, 스냅샷 기준일 2026-10-14 | 여러 항목이 이미 존재한다. 새 수집과 기존 수집의 중복을 피해야 한다 |
| NAV·AUM 관측값 | 각각 available 1,524건, 해당 값의 `asOfDate`는 모두 없음 | 수집 시각을 기준일로 대체하면 안 된다 |
| 비용률 | available 1,525건, 해당 값의 `asOfDate`는 모두 없음 | 총보수·순보수·연차보고서 비용률을 구분하고 적용 기간을 확보해야 한다 |
| 공식 NAV 이력 | VYM·VIG·SCHD 3종목 수집 경로 | Yahoo 최신 NAV 관측값과 공식 NAV 시계열의 커버리지가 다르다 |
| 기존 계산·분류 | TTM 배당, 공급자 보정 수익률, FCF 배당성향, 일부 보유종목 겹침, ROC 문서 파서가 존재 | 신규 기능으로 중복 구현하기보다 근거·범위를 보완한다 |

관련 코드: `scripts/content_pipeline/security_insights.py`, `tax_character.py`, `schema.sql`, `scripts/utils/collect_security_insights.py`, `export_security_insights.py`, `src/components/thumbnail/SecurityInsights.vue`.

기존 SQLite에는 `source_documents`, `collection_attempts`, `distribution_observations`, 이벤트 정정 이력, `history_sources`, 기업행동 관측 테이블도 있다. 원문·관측·확정 자료를 나누는 기반은 재사용할 수 있다. `security_insights`의 USD 주식·ETF 제한과 관측값의 기준일 누락은 별도 확장 과제다.

## 3. 도입 후보 데이터 사전

P0는 데이터 기반, P1은 현재 앱에 직접 유용한 확장, P2는 선행 자료·권리·정의 확보 후 도입할 항목이다. 모든 항목을 모든 종목에 강제하지 않는다.

| 영역 | 수집할 상세 항목 | 우선 출처 | 앱 활용과 우선순위 |
| --- | --- | --- | --- |
| 종목·상장 식별 | 내부 instrument/listing ID, ISIN, FIGI 계열, MIC, 공급자 코드, CIK/LEI, 상품 유형, 거래·펀드 기준통화, 상장·변경 유효기간 | 거래소 목록, OpenFIGI, GLEIF, SEC, 운용사 | 티커 충돌·변경·재사용 방지. **P0** |
| 기업행동·거래 상태 | 분할·병합의 신주/구주 수, 효력일, 티커·명칭 변경, 합병·분사·청산·상장폐지, 거래 정지와 재개 | 거래소 공지, SEC/DART 공시, 운용사, 계약된 시세 API | 가격·배당·보유수량 정합성. 공지일과 효력일 분리. **P0** |
| 시세·시장 거래 | 일별 OHLCV, 거래대금, 장 구분, 거래일·시간대, 통화, 공급자의 보정 방식, 정정 버전 | 권리·범위가 맞는 시세 공급자, 거래소 | 차트·수익률·정정 검증. 분할 보정과 총수익 보정을 분리. **P0** |
| ETF 기본·운용 조건 | 전략, 액티브/패시브, 벤치마크, 배당 정책, 레버리지 배수·방향·목표 기간, 환헤지, 설정일, 운용사·수탁사 | 운용사 상품 페이지·투자설명서, 공시 | 전략별 비교·필터·상품 이해. 이름에서 추정한 값과 공식 확인값 분리. **P1** |
| ETF 비용 | gross/net expense ratio, 운용보수, 총비용, 비용 면제 조건·종료일, 기준 문서·적용일 | 운용사·투자설명서·연차보고서 | 비용 비교와 면제 종료 알림. 한국 총보수와 미국 expense ratio를 같은 지표로 단정하지 않음. **P1** |
| ETF 가치·규모·유동성 | 공식 NAV·기준일, AUM·기준일, 발행좌수, 시장 종가, 공시 괴리율, 30일 중앙 호가 스프레드, 평균 거래량 | 운용사 일일 자료·CSV, 계약된 시장 데이터 | 거래비용·괴리·규모 변화 비교. 순간 호가와 30일 중앙값 분리. **P1** |
| 전체 보유자산 | 구성종목 ID, 수량, 시장가치, 비중, 자산군, 통화, 국가, 업종, 현금·담보, 기준일, 포괄 범위 | 운용사 보유자산 CSV, SEC N-PORT, 국내 운용사 공식 파일 | ETF 간 중복·집중도·포트폴리오 실질 노출. 상위 10종목과 전체 파일 구분. **P1** |
| 옵션·레버리지 노출 | 기초자산, 콜/풋, 매수/매도, 행사가, 만기, 계약 수·승수, 명목금액, 스왑 상대방, 담보 | 운용사 포지션 파일, N-PORT 파생상품 테이블 | 커버드콜·레버리지 ETF 전략 분석. 명목금액·시장가치·델타 노출을 구분. 자료 확보 후 **P1/P2** |
| 배당·분배 일정 | 발표·배당락·기준·지급일, 원문 금액·통화, 정기/특별 지급, 취소·정정, 빈도 정책·변경 이력 | 기존 공식 운용사 수집기, 거래소 공지 | 기존 원장 확장. 공시 일정·예상 일정·실제 입금은 별도 자료. **P0/P1** |
| 분배금 구성·세무 공시 | 투자소득, 단기/장기 자본이득, ROC 금액·비율, 당회/YTD, 회계연도·세무연도, 추정/확정·정정 상태 | 19a, 운용사 연간 세무 자료·Form 8937 등 | 높은 분배율의 구성과 변화 설명. 미국 펀드 공시를 한국 투자자의 확정 세금으로 해석하지 않음. **P1** |
| 주식 재무·배당 여력 | 매출·이익·EPS, 영업현금흐름·설비투자, 배당지출, 부채·이자비용, 주식수, 보고 기간·제출일·정정 | SEC XBRL/companyfacts, OpenDART, 기업 IR | 배당 여력·성장 비교. REIT FFO/AFFO와 금융업 지표는 별도 모델. **P1/P2** |
| 공시·상품 변경 | 공시 ID·유형·제출일, 설명서 개정, 전략·보수·벤치마크 변경, 신규 상장·청산, 근거 문서 | SEC submissions, DART/KIND, 거래소·운용사 | 변경 알림·이력 추적. 뉴스보다 원문 공시를 우선. **P1** |
| 환율·시장 달력·거시 | 기준통화/상대통화, 기준환율·고시 시각, 휴장·조기폐장, 정책금리·국채금리·물가, 발표·정정 시각 | ECB, ECOS, 거래소, FRED/ALFRED 후보 | 원화 기준 분석·갱신 스케줄·금리 민감도. 거래 체결환율과 참고환율 분리. **P1/P2** |
| 채권 ETF 특성 | 만기수익률 정의, SEC yield, 듀레이션·종류, 만기 분포, 신용등급, 발행자·통화 비중 | 운용사 팩트시트·보유자산, N-PORT | 금리·신용 위험 비교. 듀레이션 종류와 수익률 산식·기준일 필수. **P2** |
| 수급·공매도·평가·뉴스 | 공식 설정/환매, 발행좌수 기반 추정 자금흐름, short volume/short interest, 평점·전망·기사 메타데이터 | 운용사·거래소·FINRA·계약된 공급자 | 보조 분석. 범위와 이용권한 검토 후 **P2**. 추정값·의견을 관측 사실과 분리 |

ETF의 자산·파생상품과 ETN의 발행사 신용·상환조건은 다른 계약이다. `fundamental` 하나에 억지로 합치지 않는다. 국제 주식·ETF의 거래 통화, 펀드 기준통화, 보유자산 통화도 별도 필드다.

## 4. 웹에서 확인한 출처와 실제 도입 조건

| 출처 | 이번 확인 내용 | 도입 조건·범위 |
| --- | --- | --- |
| [Nasdaq Symbol Directory](https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs)와 [표본 파일](https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt) | 자료 행 5,622개, 시험 종목 8개, ETF·시장분류·재무상태·round lot·생성시각 | 마지막 생성시각 행은 종목이 아니다. Nasdaq 목록만으로 미국 전체 시장을 대체하지 않는다. Financial Status를 상장폐지 확정으로 쓰지 않는다 |
| [OpenFIGI](https://www.openfigi.com/api/documentation) | 무키 AAPL/US 매핑 응답에서 FIGI·compositeFIGI·shareClassFIGI 확인 | 키 유무별 rate limit. `exchCode=US` 결과를 개별 거래소 MIC로 오인하지 않는다. 모호한 매핑은 검토 대상 |
| [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) | 법인 식별·관계 API 문서 확인 | 발행사 식별 보완용. 법인 LEI가 종목·상장 ID를 대신하지 않음 |
| [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | 무키 submissions JSON 실제 조회, companyfacts/XBRL 기능·브라우저 CORS 미지원 안내 | 서버에서 수집. [공정 접근](https://www.sec.gov/about/developer-resources)은 사용자 전체 기준 최대 초당 10요청 안내. 여러 작업의 합산 예산 관리 필요 |
| [SEC N-PORT](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets)·[readme](https://www.sec.gov/files/nport_readme.pdf) | 보유자산·채무상품·파생상품 상대방·옵션·스왑·증권대여·월별 수익률 테이블 확인 | 월말 기준 보고 자료와 분기별 bulk 배포를 구분. 공개 지연 자료이므로 당일 포지션을 대체할 수 없음. 공시별 amendment 보존 |
| [iShares IVV](https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf)·[보유 CSV](https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv) | NAV·AUM·발행좌수·수익률·비용·스프레드 및 15열 CSV, 표 형식 행 508개 확인 | 원문 필드별 기준일이 다르다. 운용사마다 CSV 스키마·조회 구조·재사용 조건이 달라 어댑터가 필요 |
| [NEOS SPYI](https://neosfunds.com/spyi/)·[19a 표본](https://neosfunds.com/wp-content/uploads/SPYI-19a-1-Notice-9.16.26-Confidential.pdf) | 상품 설명·정책·보유자료 링크·19a·8937, 실제 PDF의 당회/YTD 추정 구성 확인 | 19a는 문서 자체가 추정값·세금 보고 목적 아님을 명시. 기존 ROC 파서 재사용·형식별 검증 확대 |
| [Alpha Vantage 문서](https://www.alphavantage.co/documentation/) | 가격·배당·분할·ETF profile/holdings·재무·상장 상태·뉴스 API 범위 | 실제 키·요금제·한국 시장 범위·서비스 공개/재배포 권한 미검증. 문서의 demo를 전 종목 이용권으로 간주하지 않음 |
| [Twelve Data 문서](https://twelvedata.com/docs)·[약관](https://twelvedata.com/terms) | ETF 목록·가격·배당·분할·재무 API, endpoint별 credit/plan 안내. Internal Use와 외부 상업 이용 구분 | 외부 표시·원본 재배포·파생 지표 제공의 계약 범위를 데이터별 확인. 대량 수집 전 비용 모델 필요 |
| [Massive splits 문서](https://massive.com/docs/rest/stocks/corporate-actions/splits) | 효력일, split_from/ split_to 및 보정계수 설명 | 현재 Polygon 계열의 공급자 후보. API 키·시장 범위·요금제·재배포는 별도 검증 |
| [KRX 서비스 목록](https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd)·[약관](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO002.jsp) | 주식 기본정보, ETF/ETN 일별매매 등 공식 목록 확인. 비상업적 목적 이용·제3자 대가 청구 제한 조항 확인 | 인증키·서비스 신청과 실제 서비스 이용 형태 확인 필요. 무료 API라는 이유로 상업적 공개 서비스의 기본 공급자로 확정하지 않음. PCF·전 종목 holdings는 이번 목록만으로 확보를 주장하지 않음 |
| [OpenDART 전체 재무제표](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020) | 키·보고서 코드·회계연도·`fs_div`의 OFS/CFS와 재무 항목 계약 확인 | 인증키 필요. 기업 코드·종목 코드 매핑과 정정공시, 연결/별도 구분을 보존. ETF 보유자산 API로 오인하지 않음 |
| [ECB 환율](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)·[XML](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml) | 2026-10-21 기준 29개 통화 XML, EUR 기준 USD·KRW 값 확인 | 참고환율이며 체결환율이 아님. USD/KRW 교차환율은 같은 기준일·고시를 사용한 파생값으로 표시 |
| [ECOS](https://ecos.bok.or.kr/api/)·[sample 목록](https://ecos.bok.or.kr/api/StatisticTableList/sample/json/kr/1/5/) | 실제 통계목록 JSON 5행·통계코드·주기 확인 | sample 성공은 실서비스 인증·개별 환율/금리 시리즈 검증과 다름. 코드·단위·고시 시각을 항목별 등록 |
| [FRED](https://fred.stlouisfed.org/docs/api/fred/)·[ALFRED](https://alfred.stlouisfed.org/) | 이번에는 점검 안내 반환 | 금리·물가·빈티지 자료 후보로만 유지. API 상세·시리즈 권리·공개 가능 시점 확인 후 채택 |
| [FINRA 설명](https://www.finra.org/rules-guidance/notices/information-notice-051019) | short sale volume의 off-exchange 범위와 short interest 해석 혼동 설명 확인 | 전체 시장 거래와 범위가 다르다. short volume을 공매도 잔고로 표시하지 않음. 이용 조건 검토 후 후순위 |
| [yfinance 문서](https://ranaroussi.github.io/yfinance/) | 비공식 라이브러리, Yahoo 약관 확인 및 personal use 목적 안내 | 기존 코드 의존성은 파악하되 공개 서비스용 신규 표준 공급자로 자동 확정하지 않음 |

정책 조건은 위 문서에서 확인한 설계 제약이며 개별 계약의 법적 적합성을 확정한 결과는 아니다. 공급자 선정에는 비용뿐 아니라 보관·공개 표시·원본/파생값 재배포 범위를 함께 기록해야 한다.

### 동일 상품에서도 기준일을 나눠야 하는 실제 예

확인한 IVV 페이지의 NAV·AUM·발행좌수는 10월 21일, 종가·스프레드·보유 CSV는 10월 20일, SEC yield는 9월 30일 기준이었다. CSV 발행좌수와 상품 페이지 발행좌수도 서로 다른 날짜의 관측이다.

따라서 종목 전체에 `updatedAt` 하나를 붙일 수 없다. 서로 다른 날의 종가와 NAV를 나눠 새로운 괴리율을 만들거나, CSV와 페이지의 발행좌수 차이를 같은 날의 정정으로 처리해서도 안 된다.

## 5. nav에 다시 모이지 않도록 나눌 책임

### 식별 목록

검색용 catalog에는 ID·현재 이름·상장·통화·유형·필터용 최소 요약만 둔다. 가격, AUM, 발행좌수, 보유자산, 배당 이력, 문서 원문, 공급자 경로, 작업 상태는 각각의 소유 영역에 둔다. 정책·분류를 검색에 노출할 때도 원장 원문 대신 작은 파생 인덱스를 발행한다.

식별 관계는 `issuer → fund/기업 → shareClass/instrument → listing`을 기본으로 한다. 기업과 펀드에 같은 관계를 강제하지 않는다. CIK/LEI, ISIN, FIGI, MIC, ticker는 각 레벨의 외부 식별자다. ticker만 전역 기본키로 삼지 않고, 이름·티커·공급자 코드 변경에 유효기간을 둔다. 기존 symbol 기반 앱·포트폴리오는 명시적 매핑 계층으로 호환한다.

신규 발견 종목은 discovery 후보에 저장한다. 거래소·통화·동일 종목 여부를 확인하기 전 기존 catalog와 사용자 보유 기록에 자동 병합하지 않는다.

### 데이터 영역

| 영역 | 원장 소유 내용 | 권장 갱신 기준 |
| --- | --- | --- |
| identity | 식별·상장·상품 유형·별칭·외부 ID | 일일 발견 + 변경 이벤트 |
| market-prices / actions | 실제 시세 / 기업행동·보정 근거 | 장 마감 후, 최근 구간 재조회, 공지 시 |
| fund-profile / fund-observations | 운용 조건·보수 / NAV·AUM·발행좌수·수익률 공시 | 문서 변경 시 / 기준일별 일일 또는 월간 |
| holdings / exposures | 실제 보유자산 / 산식이 명시된 경제적 노출 | 운용사 공시 주기·공시별 |
| distributions / tax-character | 확정 배당 / 당회·연간 분배금 구성 관측 | 발표·정정 시 / 세무 문서 공시 시 |
| financials / filings | 기간별 재무 관측 / 제출·정정 문서 | 제출·정정 이벤트별 |
| fx / macro / calendars | 기준환율 / 거시 관측·빈티지 / 거래 일정 | 해당 공시·시장 달력별 |
| analytics / views | 겹침·집중도·수익률·위험·화면용 요약 | 입력 버전이 바뀐 항목만 재계산 |
| collector-control | 출처별 능력·권리·주기·예산·커서·장애·검토 | 운영 상태 변화 시, 비공개 |

같은 운용사 페이지는 한 번 받아 공통 원문 캐시에 보관하고, NAV·보수·정책 파서가 공유한다. 기존 `ProviderAdapter.parse()`의 배당 반환 계약에 다른 자료를 억지로 넣지 않고 별도 typed parser를 붙인다. 기존 SQLite의 원문·관측·정정 구조를 확장하고 파일 시계열은 객체 저장소에 둔다. 운영 규모와 동시 작성 요구를 확인하기 전 메타데이터 DB까지 한꺼번에 교체할 필요는 없다.

## 6. 수집 파이프라인과 관측 계약

```text
출처·이용권한·능력 목록
  → 종목/문서 발견 및 식별 매핑
  → 출처별 예산·주기로 수집, 원문 공통 캐시
  → API/CSV/공시/PDF별 타입 파서
  → 날짜·단위·보정 기준을 보존한 관측 저장
  → 출처별 비교·정정·검토 및 확정 자료 선택
  → 데이터 영역별 발행
  → 입력 버전이 명시된 분석·작은 조회용 자료
  → 기존 앱 공용 캐시·API
```

소스 능력 목록에는 `datasets`, `entityTypes`, `coverage`, `fetchMode`, `authRef`, `parserVersion`, `schedule`, `rateBudget`, `retentionPolicy`, `licensePolicy`, `lastSuccessfulAsOf`, 장애·재시도 상태를 둔다. 인증키 값은 넣지 않는다. 출처가 지원하지 않는 필드는 파싱 실패와 구분한다.

공통 관측의 최소 필드:

```json
{
  "dataset": "fund_observations",
  "entityId": "instrument:<내부ID>",
  "field": "nav",
  "value": "776.56",
  "unit": "currency_per_share",
  "currency": "USD",
  "asOfDate": "2026-10-21",
  "publishedAt": null,
  "availableAt": null,
  "observedAt": "<실제 수집 시각>",
  "sourceDocumentId": "sha256:<원문해시>",
  "parserVersion": "issuer-nav-v1",
  "verificationStatus": "source_observed",
  "licensePolicyId": "<검토된 이용정책ID>",
  "revision": 1,
  "supersedes": null
}
```

예시는 계약 설명용이며 새로 발행한 레코드가 아니다. 금액·수량·비율 원문은 단위·scale과 함께 정확한 문자열로 보존한다. 분석 결과에는 별도 산식 버전·반올림 규칙·입력 릴리스 목록을 둔다.

- `asOfDate/periodStart/periodEnd`: 값이 적용되는 시점·기간.
- `publishedAt/availableAt`: 출처 공시·실제 이용 가능 시점. 모르면 null을 유지한다.
- `observedAt`: 우리가 확인한 시각. 기준일이나 공시일로 대신 사용하지 않는다.
- 상태: 값 0, 미공시, 해당 없음, 지원 안 함, 권리상 미공개, 일시 장애, 오래된 값, 정정 대기를 구분한다.
- 한 값에 여러 출처의 관측을 남긴다. 기준일·측정 정의가 같은 경우에 비교하고 원장 선택 정책을 기록한다. 최신 응답이 기존 값을 무조건 덮어쓰지 않는다.
- 출처 문서가 바뀌면 revision을 추가한다. 파서 변경은 기존 불변 원문을 재처리할 수 있게 한다.
- ETag/Last-Modified·304를 재사용하되 unchanged 응답으로 실제 자료 기준일을 오늘로 바꾸지 않는다.
- 큰 공시 원문은 bulk/증분 인덱스를 활용하고, SEC 등 host별 제한을 모든 작업이 공유한다. PDF/OCR·모델 추출은 명확한 문서 타입과 검증 절차를 거친다.

## 7. 저장·발행·조회 구조

아래는 제안 경로이며 현재 `core` schema v2의 경로·해시 규칙을 즉시 바꾸는 변경이 아니다.

```text
비공개 저장소 — 공개 버킷과 권한으로 분리
  raw/{sourceId}/{contentHash}/...
  collector-control/{sourceId}/{dataset}/{cursorKey}.json
  observations/{dataset}/{partition}/...
  review/{dataset}/{runId}/...

공개 저장소 — 공개·재배포 가능한 자료만
  datasets/identity/v1/current.json
  datasets/market-prices/v1/current.json
  datasets/fund-observations/v1/current.json
  datasets/holdings/v1/current.json
  datasets/distributions/v1/current.json
  datasets/<각영역>/v1/releases/{releaseId}/manifest.json
  objects/{contentHash}/...       # 변경된 내용만 새로 저장하는 후보 방식
  views/search/{version}/...
  views/security-summary/{version}/{shard}.json
  views/portfolio-facts/{version}/...
```

[Cloudflare 공개 버킷 문서](https://developers.cloudflare.com/r2/buckets/public-buckets/) 기준으로 **`private/`라는 경로명은 접근 제어가 아니다.** 원문·실행 상태·검토 자료는 비공개 버킷 또는 인증된 별도 접근 경로에 두어야 한다. CORS 역시 인증·공개 범위 제어를 대신하지 않는다. 이번 조사는 기존 운영 버킷의 전체 접근 정책을 감사한 결과는 아니다.

각 영역에 schema·소유자·갱신·품질·발행 상태를 둔다. 가격 변경 때문에 catalog·배당·세무 자료를 모두 재발행하지 않는다. 현재 `build_release.py`는 catalog 개별 파일까지 한 릴리스에 포함하므로, 새 항목을 계속 같은 manifest에 추가하기 전에 발행 경계를 나눠야 한다.

변경되지 않은 파일의 content-addressed 재사용은 중복 전송을 줄일 후보 방식이다. 현재 v2는 릴리스 상대 경로를 가정하므로 별도 스키마·리더 호환 계약을 먼저 정해야 한다. 원장별 pointer 분리 시 분석에는 `pricesRelease`, `actionsRelease`, `distributionsRelease`, `fxRelease`, `methodVersion`을 함께 고정해 재현성과 시점 정합성을 지킨다.

앱이 모든 영역의 pointer와 원문을 직접 읽게 하지 않는다. 검색은 작은 검색 인덱스, 상세는 묶음 요약과 요청한 이력, 비교는 필요한 종목·필드만 제공한다. 기존 `publicJson`, `request-cache`, `securityDirectory`, 서버 조회 서비스를 재사용하는 방향이다. 조회 횟수 예산은 구현 시 사용자 동작별로 검증하며, 이 조사에서 새로운 성능 수치를 측정하지는 않았다. 공용 시장 데이터를 계좌별 Firestore 문서에 반복 저장하지 않는다.

## 8. 계산·표현에서 지켜야 할 구분

1. 시장 종가 / 공식 NAV / 공급자 NAV 관측값. 같은 거래일·통화·시점이 없으면 새 괴리율을 계산하지 않는다.
2. 분할 보정 가격 / 배당 포함 공급자 보정 가격 / 재투자 총수익 / 투자자 세후 수익. 서로 다른 산식으로 관리한다.
3. SEC yield / 과거 12개월 분배율 / 최근 지급액 연율화. 금액·빈도와 함께 정의를 저장하며 미래 지급 보장으로 표시하지 않는다.
4. gross/net expense ratio / 총보수 / 총비용. 면제 종료일과 비용 범위를 분리한다.
5. 19a 당회·YTD 추정 / 운용사 연간 확정 공시 / 투자자별 실제 원천징수. ROC를 곧바로 한국 투자자의 비과세 소득으로 보지 않는다.
6. AUM 변화 / 공식 설정·환매 / 발행좌수 기반 추정 자금흐름. 분할·합병을 조정하지 않은 발행좌수 차이를 순유입으로 표시하지 않는다.
7. 보유 비중 / 파생상품 시장가치 / 명목·델타 노출. 파생상품·공매도·레버리지 때문에 합계 100%를 모든 자료의 검증 규칙으로 강제하지 않는다.
8. 일부 보유종목의 겹침 / 전체 포트폴리오 겹침. 기준일·커버리지·주식 외 자산 포함 여부를 표시한다. 기존 overlap 코드의 범위·기준일 표시를 유지한다.
9. short volume / short interest. 거래 범위와 시간 단위가 다르다.
10. 분기 현금흐름 / 누적 YTD / 연간·정정 보고서. 연결/별도, 회계 단위, 제출 시점을 맞춘다. 공개 전 자료를 과거 백테스트에 넣지 않는다.
11. 사실 / 운용사 설명 / 이름 기반 규칙 분류 / 모델의 추정·전망. 하나의 `official=true`로 모두 표현하지 않는다.

## 9. 권장 도입 순서와 완료 기준

### 단계 A — 확장 계약과 출처 목록

식별 ID 매핑, 데이터 영역 목록, 단위·시간·정정·이용정책, source capability를 먼저 정한다. 현재 seed·배당 원장·analysis snapshot을 이 영역으로 매핑하되 실제 이관은 별도 변경으로 한다.

완료 기준: 각 필드의 소유자·출처·기준일 의미·갱신 주기·공개 가능 범위를 설명할 수 있고, 없는 값과 해당 없는 값을 구분한다. 기존 앱 symbol 호환을 유지한다.

### 단계 B — 공식 ETF 자료 소규모 시험

SPYI·QQQI·TSLY·SCHD·VYM·VIG·IVV처럼 현재 기능과 전략이 다른 종목을 우선 검토한다. 출처가 실제 지원하는 종목에서 NAV/AUM/발행좌수/비용/보유 CSV/ROC를 수집한다. AAPL 같은 주식의 SEC 공시·재무 표본을 함께 검토한다. 지원하지 않는 운용사 자료는 다른 공급자 값으로 조용히 채우지 않는다.

완료 기준: 원문 → 관측 → 검증 → 화면 요약의 근거를 추적할 수 있다. 날짜 불일치, 포맷 변경, 누락·0, 자료 정정, 상장 상태 변경, 계약상 비공개 조건을 시험한다. 공개 자료만 시험 릴리스에 포함한다.

### 단계 C — 가격·기업행동·환율 원장과 연결

기존 가격 독립 계획에 새 식별·시간·보정 계약을 적용한다. 시장 데이터 공급자의 실제 범위·보관·공개/재배포 권리·요금제를 검증한 후 선정한다. 가격·배당·기업행동·환율 입력 버전을 고정한 수익률과 원화 가치 분석을 만든다.

완료 기준: 구 R2 자료만으로 새 원장을 정의하지 않으며, 수집·정정·재계산이 자체 경로에서 작동한다. 과거 자료의 보정 기준이 불명확하면 검증 상태를 유지한다. 이 단계는 구 R2 파일을 폴더 이동하는 것으로 완료되지 않는다.

### 단계 D — 한국 자료·공시·고급 노출 확대

OpenDART·ECOS의 키와 개별 계약을 확보하고 KRX 이용 형태를 검토한다. 국내 운용사 자료의 필드·권한을 확인한다. 기업 재무, 채권, 옵션 명목 노출, 공식 설정·환매, 파생 지표 순으로 확대한다. 뉴스·센티먼트·애널리스트 전망·실시간 주문장은 별도 비용·권리·검증 과제로 둔다.

완료 기준: 미국 데이터의 단위·회계·세무 정의를 국내 상품에 강제하지 않는다. 새 영역이 추가돼도 검색 catalog와 기존 영역을 전부 다시 수집·배포하지 않는다.

## 10. 이번 작업의 산출물과 한계

보고서와 42개 URL의 검증 기록만 추가했다. 앱·API·DB·수집 스케줄·R2·환경변수·기존 데이터는 변경하지 않았다. 실제 운용사 CSV/PDF·공식 표본과 현재 코드·공개 스냅샷을 확인했으며, 키가 필요한 API의 인증 데이터, 전체 종목 커버리지, 계약상 공개 권한과 운영 배포는 검증하지 않았다. 문서 변경이므로 앱 빌드와 테스트를 새로 실행하지 않았다.
