# 12단계 완료 보고서: Notion 안전 연동·관리 화면·분석 산출물

## Notion

- 데이터베이스 스키마는 `../notion-content-calendar-schema.md`에 정리했다.
- 상태는 `Draft → Ready → Approved → Published`다. 최초 생성은 Draft이며 편집·승인은 Notion에서 한다.
- `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID`는 사용자 환경 변수에서만 읽는다.
- 기본 `npm run content:notion`은 dry-run이다. 실제 쓰기는 사용자가 `npm run content:notion:apply`를 명시 실행할 때만 한다.
- 기존 Notion 페이지의 제목·본문·채널·상태는 보존하고, SQLite 원장 기반 공식 날짜·수치·URL만 갱신한다.

## 관리자 화면

- `/distributions`, `/content`, `/sources`, `/renders`, `/archive`를 콘텐츠 스튜디오에 추가했다.
- 정적 JSON은 파이프라인에서 생성하며 `/renders`는 생성물 복사본을 다운로드한다.
- 기존 개인 포트폴리오는 `VITE_APP_MODE=legacy-portfolio`에서 그대로 보존된다.

## 분석형 산출물

- 배당 목록 JSON에 직전 금액 및 SQLite 윈도우 함수 기반 4회·12회 평균을 포함했다.
- 최근 증감은 원장 수치로 계산된다. ROC는 제공될 때 원장에 보존되며, NAV·가격 결합은 공식 시장 데이터 어댑터가 아직 구성되지 않아 명시적으로 미구성 상태로 표시한다.
- 주간 산출물은 `facts.json`, 5~8분용 `youtube-script.md`, 30~60초용 `youtube-shorts-script.md`로 나누고 사실 데이터와 내레이션을 구분하며 투자 권유를 피한다.
