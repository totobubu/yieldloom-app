# 19. 썸네일 정보 밀도 및 운용사 탭

## 완료 범위

- 정사각형 배당 카드를 상단 여백이 작은 밀도형 레이아웃으로 조정했다.
- 카드에 `Made by 토또부부`, 실제 주당 배당금 변화(퍼센트와 달러), 배당공시일·배당락일·지급일(YYMMDD)을 표시한다.
- 주배당 월별 합계 표의 행 높이와 여백을 줄여 1080px 캔버스 하단 일정 영역과 겹치지 않게 했다.
- 관제실 최근 발표에 운용사 탭을 추가했다.
- 배당 이력은 처음에는 최근 100건만 받고, 운용사 탭을 선택한 뒤에만 해당 운용사 이력을 200건 단위로 요청한다.
- PNG를 받을 때 내부 파일명 대신 `TICKER-YYYY-MM-DD-square.png` 및 `TICKER-YYYY-MM-DD-cover.png`를 브라우저 다운로드 이름으로 사용한다.

## 성능 구조

- `distribution-index.json`은 탭과 최근 발표만 제공한다.
- `distribution-{provider}-{page}.json`은 공급자별 200건 페이지다.
- 기존 `distributions.json`은 기존 연동 호환성을 위해 보존한다. 화면은 이를 최초 호출하지 않는다.

## 검증

- `python -m unittest discover -s tests/content_pipeline -v`: 25 passed
- `npm run type-check`: passed
- 콘텐츠 재생성과 PNG 재렌더링, 정적 export를 실행해 기존 생성물도 새 카드 템플릿을 사용하도록 갱신했다.

## 데이터 원칙

- 카드의 실제 금액 변화는 SQLite 공식 이벤트와 읽기 전용 `public/data`의 직전 실제 배당값을 우선 사용한다.
- 날짜가 없는 지급일은 `확인 필요`로 남기며 추정 날짜를 만들지 않는다.
