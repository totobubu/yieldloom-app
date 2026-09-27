# 7단계 완료 보고서: 로컬·Notion 콘텐츠 캘린더

- 완료일: 2026-09-19
- 로컬 원장: `var/content-studio/content-calendar.json`
- 교환 파일: `var/content-studio/content-calendar.csv`

## 수행 내용

- 생성된 모든 콘텐츠 bundle의 manifest를 읽어 로컬 콘텐츠 캘린더를 만든다.
- 이벤트별 제목, 운용사, 티커, 게시 예정일, 배당락일, 채널, 검증 상태, 공식 URL과 산출물 경로를 누적한다.
- Excel이나 다른 CMS에서도 읽을 수 있도록 UTF-8 BOM CSV를 함께 만든다.
- Notion 데이터 소스의 권장 속성 이름과 타입을 문서화했다.
- `Event Key`를 기준으로 기존 Notion 페이지를 조회한 뒤 생성 또는 갱신하는 멱등 동기화 클라이언트를 추가했다.
- Notion 토큰과 데이터 소스 ID는 환경 변수로만 받고 저장소에는 기록하지 않는다.

Notion 지식 캡처 지침에 따라 제목·상태·날짜·태그·출처·산출물 경로를 분리하고, 반복 실행 시 중복 페이지가 생기지 않는 구조를 선택했다.

## 실행 방법

```powershell
npm run content:calendar
npm run content:notion:dry
npm run content:notion
```

실제 동기화 전에 [Notion 콘텐츠 캘린더 스키마](../notion-content-calendar-schema.md)의 속성을 만들고 `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID`를 설정해야 한다.

## 검증

- Python 단위 테스트 10건: 통과
- 샘플 bundle 1건의 JSON·CSV 누적: 통과
- Notion 속성 payload dry-run: 통과
- Notion API 버전: `2026-03-11`
- 실제 Notion 쓰기: 미실행 — 현재 작업 환경에 사용자 Notion 연결·토큰이 없으며 외부 페이지를 임의로 생성하지 않았다.

## 다음 단계

JPMorgan, SCHD, NEOS, Defiance 공식 배당 데이터 공급자를 같은 공통 모델로 확장한다.
