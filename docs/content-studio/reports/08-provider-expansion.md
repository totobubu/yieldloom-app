# 8단계 완료 보고서: JPMorgan, SCHD, NEOS, Defiance 확장

- 완료일: 2026-09-19
- 신규 공급자: J.P. Morgan Asset Management, Schwab Asset Management, NEOS Investments, Defiance ETFs

## 수행 내용

- 네 공급자를 기존 `ProviderAdapter` 레지스트리에 추가했다.
- JPMorgan JEPI·JEPQ는 공식 상품 화면을 Edge/Chromium으로 렌더링한 뒤 Dividend Schedule을 읽는다.
- NEOS SPYI·QQQI·IWMI는 공식 펀드 페이지의 선언일, 배당락일, 기준일, 지급일과 금액 표를 읽는다.
- SCHD는 공식 상품 페이지의 배당 이력 표 파서를 추가했다.
- Defiance는 공식 ETF 목록의 Latest Distributions 카드에서 금액, 지급일과 ROC 추정치를 읽는다.
- 공식 도메인 allowlist를 공급자별로 적용했다.

## 검증 상태 정책

- NEOS는 선언일을 포함한 전체 일정이 있으므로 `official`이다.
- JPMorgan은 공식 화면에 선언일이 없어 배당락일을 안정적인 대체 키로 사용하고 `needs_review`로 둔다.
- SCHD도 공식 이력에 선언일이 없어 `needs_review`로 둔다.
- Defiance 최신 카드에는 배당락일이 없어 지급일을 임시 날짜로 사용하고 `needs_review`로 둔다. 이 이벤트는 기본 콘텐츠 생성에서 차단된다.

즉, 날짜가 없는 데이터를 임의로 확정하지 않으며 운영자가 공식 통지와 대조하기 전에는 게시용으로 넘어가지 않는다.

## 실사이트 검증

- NEOS SPYI 공식 페이지: 9건 파싱 성공
- Defiance 공식 Latest Distributions: 8건 파싱 성공
- JPMorgan JEPI 공식 동적 Dividend Schedule: 12건 파싱 성공
- SCHD 공식 페이지: 파서 단위 테스트는 통과했으나 현재 실행 환경의 IP에 공식 사이트가 HTTP 403을 반환해 실사이트 수집은 미검증
- 전체 Python 단위 테스트 14건: 통과

SCHD 403은 비공식 데이터로 우회하지 않았다. 운영 배포 환경에서 접근을 재검증하고, 계속 차단되면 Schwab 공식 메일 또는 공식 배당 문서 입력을 대체 채널로 연결해야 한다.

## 공식 출처

- JPMorgan: `https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-46641q332#/dividends`
- SCHD: `https://www.schwabassetmanagement.com/products/schd`
- NEOS: `https://neosfunds.com/spyi/`
- Defiance: `https://www.defianceetfs.com/explore-our-etfs/`

## 다음 단계

누적된 공식 이벤트를 주간 단위로 묶어 뉴스레터와 유튜브 대본을 자동 생성한다.
