# 수집 연결 acceptance 범위와 남은 전환 조건

2026-10-27 작업 브랜치 기준. 이 문서의 통과는 테스트 환경의 코드 연결을 뜻한다.
상장 이후 실제 전체 자료 확보나 운영 발행을 뜻하지 않는다.

## 고정 범위

대상은 AAPL, MSFT, NVDA, BAC, SCHD, IVV, TSLY, TOPW다.
`collection_scope.py`의 허용 목록 밖으로 식별자 보충·core 후보 생성을 확대하지 않는다.
기존 제공처 전체 수집 일정과 운영 플래그는 바꾸지 않는다.

| 대상 | 이번 연결 | 완전으로 승격하지 않는 경우 |
| --- | --- | --- |
| AAPL / MSFT / NVDA | 기존 검토 카탈로그로 식별자 확인, Yahoo 가격·참고 배당·분할 관측 원문 보존 | 새 기업 공식 배당 수집기는 추가하지 않음. 참고 배당은 core 승인 이벤트가 아님 |
| BAC | 기존 공식 IR 목록·뉴스룸 파서를 공용 원장에 연결, 최대 기사 2개 | 누락된 배당락일을 추정하지 않고 부분 공식 관측으로 보존 |
| SCHD | 공개 배당 index에 없어도 기존 Schwab 상품 URL로 요청 가능 | 접근 거부 뒤 다른 URL로 우회하지 않음. 공시일 미확인은 검토 대기 |
| IVV | 기존 iShares 상품 URL·실제 파서 연결, 공개 index 등록 여부와 독립 | 공시일 없는 이력은 검토 대기 |
| TSLY | 기존 YieldMax 공식 상품 이력 우선, 기존 공시 URL 보완·충돌 검사 | 복수 자료의 금액·날짜 등이 충돌하면 후보 보류 |
| TOPW | 기존 Roundhill issuer 후보 우선, 등록된 공식 거래소 공시 보완 | 추가 근거 없는 기간 완전성·분할 조정을 주장하지 않음 |

## 식별자 자동 보충

현재 공식 Nasdaq 목록에서 정확히 발견한 종목의 비공개 등록에만 적용한다.
회사명 유사도·오타·다른 거래소·임의 URL로 등록하지 않는다. 기존 검토 카탈로그에
동일 거래소의 완전한 식별자가 있으면 재사용한다. 그 외 지원 ETF의 등록된 공식
상품 문서에서 표/정의 목록에 명시된 티커·거래소·ISIN·통화·상장일을 읽는다.
ISIN 체크섬과 기존 값의 충돌을 확인하고 원문 해시를 보존한다.
CUSIP·펀드 설정일을 ISIN·상장일로 대신 쓰지 않는다. 필수 값이 없으면 보류한다.

자동 보충 결과는 비공개 카탈로그 overlay다. 공개 카탈로그·별칭·활성 종목 목록을
수정하지 않는다. 신규 공개 등록은 별도의 검토/발행이 필요하다. 기존
`review_identity_directory.py`의 미확정 비활성 종목 검토 정책을 우회하지 않는다.
공식 상품 페이지의 모든 HTML 형식을 지원한다는 보장은 없다. 이번 식별자 파서
검증은 명시적 라벨을 가진 합성 공식 응답을 사용했으며 실제 전체 종목 확정은 아니다.

## 연결된 후보 생성

테스트 경로:

1. 공식 목록 관측 → 정확한 비공개 listing 등록.
2. 공식 상품 식별자 증거 → 검증된 비공개 overlay → 상장 이후 연도별 큐.
3. 기존 Yahoo·운용사 파서 → 원문 및 관측 원장. 가격 재조회가 과거를 삭제하지 않음.
4. 실제 OHLC 장기 모델 + 배당 후보/기존 기준 대조 → 기존 core builder.
5. 기존 core validator + 가격 모델의 identity/OHLC/정렬/완전성 계약 검증.
6. 로컬 후보의 파일 해시·근거 원문 해시·차단 사유를 단일 review에 기록.

후보는 새 비공개 디렉터리에 원자적으로 생성한다. core manifest에 가격 모델 경로와
해시를 포함한다. 기존 디렉터리 덮어쓰기, public/dist 출력, 원격 클라이언트,
current 포인터 쓰기는 제공하지 않는다. 부분 종목 후보로 전체 릴리스를 대체할 수 없다.
`candidateBuilt`와 `snapshotValid`는 구조 검증이고, `readyForPublication`, `published`,
`replacementAllowed`는 모두 false다. 미검증 분할 기준·상장 이후 coverage 누락·자료 충돌은
차단 사유로 유지한다. candidate 생성 실패가 원장 체크포인트 보존을 막지 않는다.

코드 검증에 사용한 provider 응답과 객체 저장소는 합성 fixture다. 기존 실제 파서와
core builder/validator 자체를 실행했다. 이번 단계에서 제공처나 운영 R2 객체를 새로 조회·수정하지 않았다.
403 진단을 위해 기존 Cloudflare 연결로 bucket 목록과 관리 도메인 설정만 GET으로 읽었다. optional runner 실행 환경에는 기존 requirements-workflow.txt의
BeautifulSoup 의존성이 필요하며 validation CI에도 이를 설치하도록 반영했다.

## 기존 가격 원본 403: 확인 사실과 미확정

- 기존 요청: `GET https://pub-cdda6824954243b49965012b33c29bd6.r2.dev/data/nasdaq/aapl.json`
- 공개 r2.dev URL이며 S3 API가 아니다. 인증 헤더·서명·query token 없이 Python urllib로 요청했다.
- `VITE_R2_PUBLIC_URL`과 `data-v2/market-sources.json`의 `dataPath`를 조합했다.
- 기록된 응답은 HTTP 403뿐이다. 본문 오류 코드·메시지, server/request-id 헤더 및 정확한
  요청 시각은 당시 보존하지 않았다. 요청 작업일은 2026-10-27이다.
- HTTPS 프록시 환경 변수는 존재한다. 값은 출력하지 않았다.
- 후속으로 기존 Cloudflare 연결의 GET bucket 목록 및 managed-domain 설정을 읽었다.
  `divgrow-data` 버킷의 domain은 위 요청의 host와 정확히 일치하며 `enabled: true`였다.
  조회 자체는 HTTP 200이었다. 현재 공개 접근 비활성은 확인되지 않았다.
  `yieldloom-data-private`의 공개 도메인은 비활성이며 가격 원본 도메인과 다르다.
- 당시 경로/요청별 정책 거부와 네트워크 프록시 거부 중 원인은 여전히 미확정이다.
  현재 설정이 당시의 상태까지 입증하지는 않는다. S3 인증 변수 부재는 별도 사실이며
  공개 GET의 403 원인을 입증하지 않는다. 설정·인증은 변경하지 않았다.
- 403 이후 해당 주소 재요청, URL 변경, 다른 인증·권한을 통한 우회를 하지 않았다.

기존 앱의 원본 조회 우선순위는 `DIVGROW_DATA_BASE_URL` → `THUMBNAIL_PRICE_DATA_BASE_URL`
→ `VITE_R2_PUBLIC_URL`이다. 기존 가격 가공 workflow는 `THUMBNAIL_SOURCE_BASE_URL`
(repository variable), `R2_PUBLIC_URL` (repository secret), `VITE_R2_PUBLIC_URL` (variable)
순서의 공개 HTTPS 원본 연결을 사용한다. GitHub 변수/secret의 운영 값은 이 작업에서 조회·변경하지 않았다.
현재 실행 환경의 일반 R2 및 DATA_PRIVATE_R2 인증 변수는 없다.

대표 종목을 실제 대조하려면 기존 승인된 공개 원본 연결 또는 소유자가 제공한 동일 객체의
로컬 사본이 필요하다. 필요한 객체는 다음과 같다. 다른 bucket/key를 추측하지 않는다.

| 종목 | 기존 객체 경로 |
| --- | --- |
| AAPL | data/nasdaq/aapl.json |
| MSFT | data/nasdaq/msft.json |
| NVDA | data/nasdaq/nvda.json |
| BAC | data/nyse/bac.json |
| SCHD | data/nyse/schd.json |
| IVV | data/nyse/ivv.json |
| TSLY | data/nyse/tsly.json |
| TOPW | data/nasdaq/topw.json |

## 남은 일의 구분

- 추가 코드·자료 검증: 실제 제공처 형식별 식별자 파서 검증, 대표 일반주식의 공식 배당
  경로 확장, 누락된 과거 공시 확보, 공식 기업행사에 따른 가격·배당 보정 대조,
  전체 릴리스의 정책/자료 검토와 발행 연결. 단순 운영 승인으로 해결되는 항목이 아니다.
- 접근/자료 확보: 위 원본과 보존 대상의 실제 행·기간·해시 대조. 403 발생 계층은 미확정.
- 운영 승인 후 별도 실행: 기존 실행자와 공용 큐의 단일 소유 전환, 관련 플래그 활성화,
  승인된 범위의 초기 수집·재수집, 검증된 결과의 이관·발행·배포. 이번에는 수행하지 않았다.
