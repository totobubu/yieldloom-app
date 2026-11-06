# 시세 이력 표·카드 원본 대응

2026-11-06, 운영7b8f4ba 기준. source `7356929996797649648/87cd200796914464b7613003247de771`을 공식 Stitch MCP `tools/list → get_screen(name) → download_file(name)`로 다시 읽었다. 키는 런타임 환경에서만 사용했고 출력·파일에 기록하지 않았다. HTML은 보관 원본과 바이트가 같고, native PNG도 읽어 확인했다. [원본 해시](evidence/phase74-price/source.json).

## 구현과 측정

- 실제1280/1024/834/768/390 viewport, DPR2와 고정 공개 합성 데이터로 원본 HTML 재렌더와 Vue를 비교했다. 기존 공시 종가의 병합·미확인/0·소수점 최대4자리·거래량 단위·이벤트 우선순위·120일 범위·모바일10개씩 더보기·공유 조회 경로는 바꾸지 않았다.
- 원본은1024px **포함** 카드인데 기존은1023px 이하였다. 경계를 바로잡았다. 기존 반응형 검사도 source CSS에 맞춰1024에서 카드를 기대하도록 수정했다.
- 원본의12×14px 패딩,6px 세부 행 패딩,13px/19.5px 줄높이,15px 날짜행,점선 구분,8px 모서리와 종가 강조를 대응했다. PC는 public Column PT class를 통해12×14px/14px 본문과13px 헤더·우측 정렬·hover를 복원했다. 공개 PT 키는 설치 PrimeVue4.5.3 타입에서 확인했고 전역 DataTable을 바꾸지 않았다. 원본과 다른 줄무늬는 이 표에서만 제거했다.
- 제목을 원본 ‘시세 이력 기록’으로 맞추고 원본의 미수집일·종가만 확인된 날 안내를 본문에 표시했다. 기존 InfoHelp와 실제 자료 통화/기준 안내는 보존했다. 부모의18px 덮어쓰기를 해제해 이력 제목은 원본17px로 표시한다. 차트 제목은 기존대로 유지한다.

| 폭 | 원본 첫 기록 높이 | 기존 | 수정 | 표시 |
| --- | ---: | ---: | ---: | --- |
|1280|46px|49px|46px|표|
|1024|261.5px|49px 표|261.5px|카드|
|834|261.5px|235.3125px|261.5px|카드|
|768|261.5px|235.3125px|261.5px|카드|
|390|261.5px|235.3125px|261.5px|카드|

세부 행도 모든 카드 폭에서32.5px로 원본과 같았다. 고정6거래일 fixture의 초기 가격 API는1회, JS오류·외부 글꼴 실패·가로넘침0. 라이트/다크를 캡처했다. [전 측정](evidence/phase74-price/before.json), [후 측정](evidence/phase74-price/after.json), 같은 폴더의 reference/before/after PNG. 확인된 현재 측정에만 이 결과를 적용한다.

재현: 개발 서버를 띄운 뒤 `UI_BASE_URL=http://127.0.0.1:5234 STITCH_PRICE_RECORDS_DIR=/tmp/stitch-price-records PRICE_STAGE=after node scripts/design/measure-stock-price-records.mjs`. 고정 fixture는 브라우저 라우팅에서만 쓰며 운영 종목 데이터로 들어가지 않는다. `before`는 수정 전 서버를 명시해야 한다.

## 기능 검증과 남는 차이

- 기존 `stock-price-calendar.browser.mjs`:1440/768/390/360, 이전/다음/현재 월, 날짜 상세 키보드 진입·Escape·복귀,0거래량/종가만 제공,미수집·휴장일·오래된/빈 기록,탭 재진입 통과. 합성 최초 quote1/candles1,월/표/달력·재진입 추가0.
- 기존 `stitch-price-events.browser.mjs`:1280/768/390,정확한 날짜와 중복 우선순위,분할/0/미확인/미제공,더보기,다른 티커 분리,공유1조회 통과.
- `stitch-stock-layout.browser.mjs`의 details/prices×4폭과 기존 `stock-detail.browser.mjs` 통과. 기존 Node `stock-prices.test.mjs`6개 통과. 새 스타일을 그대로 복제하는 단위 테스트는 추가하지 않았다.
- 기존 `stock-price-refresh.browser.mjs`3폭의 정상 재조회/공유캐시/중복잠금/티커취소·오류재시도 통과. 타입 검사와수정 파일 lint오류0(부모 기존속성순서 경고2)는 [같은증거폴더](evidence/phase74-price)에 보관했다.
- CSS 일부 치수 일치는 **native PNG 전체 일치 판정이 아니다**. 원본의Pretendard 실제 렌더 글꼴은 확정되지 않았고 앱은 기존 글꼴·색 토큰을 유지한다. 원본 날짜의요일·점 구분과 앱ISO날짜,예시2자리 금액과 실제 최대4자리,통화/거래량 단위·미확인 대시,이벤트 배지 의미는 아직 다르며 예시 색/금액으로 금융 진실을 덮지 않았다.
- 원본 정적 표에는 월간 버튼이 있으나 실제 표는120거래일을 유지한다. 달력의 월 이동은 기존 동작이다. 별도 일자 상세 시트/달력 팝업 native 프레임은 없으므로 새 화면을 만들거나 완성으로 표시하지 않았다.
- 실제 계좌·고객PDF,계좌 쓰기 및원본 전체 PNG 수용은 미검증. 이 변경은 공개 시세 표현만 다룬다. 통합 CI·운영배포/실제 제공 버전은 이후 배포 보고에서 별도로 확인한다.
