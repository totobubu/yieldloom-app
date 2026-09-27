# Notion 콘텐츠 캘린더 스키마

Notion에서 새 데이터베이스를 만들고 다음 속성 이름과 타입을 그대로 사용한다.

| 속성 | 타입 | 용도 |
| --- | --- | --- |
| Name | Title | 콘텐츠 제목 |
| Event Key | Text | `공급자:티커:이벤트ID` 중복 방지 키 |
| Provider | Select | 운용사 |
| Ticker | Text | 티커 |
| Status | Select | Draft, Ready, Approved, Published |
| Publish Date | Date | 게시 예정일 |
| Ex-Date | Date | 배당락일 |
| Channels | Multi-select | Toss, Naver Blog, Newsletter, YouTube |
| Verification | Select | official, cross_checked, needs_review |
| Official URL | URL | 공식 원문 |
| Bundle Path | Text | 로컬 산출물 폴더 |

통합 연결에는 해당 데이터 소스를 공유하고 `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID` 환경 변수를 **사용자 환경 변수**로 설정한다. 토큰은 `.env`나 저장소에 커밋하지 않는다. PowerShell 예: `[Environment]::SetEnvironmentVariable('NOTION_TOKEN','…','User')` 및 `[Environment]::SetEnvironmentVariable('NOTION_DATA_SOURCE_ID','…','User')`.

동기화는 `Event Key`로 기존 페이지를 찾아 생성 또는 갱신하므로 반복 실행해도 같은 이벤트가 중복 생성되지 않는다. 기본 명령은 dry-run이며, 실제 쓰기는 사용자가 명시적으로 `npm run content:notion:apply`를 실행할 때만 허용된다. 기존 페이지에서는 제목, 본문, 채널, Status를 보존하고 원장의 공식 수치·날짜·URL만 갱신한다.
