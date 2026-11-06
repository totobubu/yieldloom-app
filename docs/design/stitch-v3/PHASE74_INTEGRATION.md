# 시세 기록·입력 보호 3단위 통합 검증

2026-11-06, 기반운영7b8f4bad9af7125fbe252b586a1caa59f74795bb. 기존사용자화면의3개독립개선이며새시안3개나전체시각완료율이아니다. [화면별잔여](REMAINING_USER_SURFACES_PHASE72.md), [원본ID/경로/기기/상태](evidence/phase74-integration/source-route-state-map.json).

| 단위 | 닫은 내용 | 근거·남은 범위 |
| --- | --- | --- |
|시세 이력|PC행46px·1024포함카드전환·모바일/태블릿카드261.5px·세부행32.5px·17px제목·미수집안내|[전후측정](PHASE74_PRICE_RECORDS.md). 날짜/금액표기·색토큰/글꼴·원본전체와없는별도팝업잔여|
|종목의견|전송중편집한내용이이전요청성공으로지워지는결함방지;기존busy로필드/제출잠금|[3기기회귀](PHASE74_FEEDBACK_PENDING.md). 전후앱idleRGB0은원본전체일치판정이아님;실제의견서비스에제출안함|
|열연결|수동·preset모두기존필수확인요구;동일tick/파일·계좌·매핑·통화·설정전환의확인초기화|[계약/검증](PHASE74_MAPPING_CONFIRMATION.md). 기존수동예외를이번원본필수UX로맞추는변경,서버권한이나최종저장승인확장없음|

## 검증

- Node819개통과,시세전용6개·달력4폭+오래된/빈데이터·이벤트3폭·기본상세및반응형4폭·재조회3폭통과. 가격·거래량0/미확인·소수점정밀도·이벤트우선순위와공유조회경로를보존했다.
- 의견3폭과열연결3폭의독립회귀를root통합에서재실행해통과했다. 수정전일반의견폼3폭RGB차이0,새pending별도native프레임은없다. 열연결원본strict4폭도통과(원본CDN/아이콘/JS오류0). symlink개발경로의폰트실패는격리Vite에서실제의존성read를허용해해결했고assertion을완화하지않았다.
- 기존broker-spreadsheet를실제XLSX/CSV합성파일·loopback FlaskMemory API로실행해열연결→검토→메모리저장과명세저장/조회/삭제까지통과했다.6개매핑다이얼로그폭/포트폴리오4폭,typing/mapping추가요청0. [실행근거](evidence/phase74-integration/broker-memory.txt). 로컬기본Python의firebase_admin미설치는기존격리venv로실행해해결했으며의존성이나운영설정을바꾸지않았다.
- 최종통합lint오류0(기존경고54),타입검사포함build통과. [lint](evidence/phase74-integration/lint.txt), [build](evidence/phase74-integration/build.txt). 기존번들크기경고는남는다. 신규2browser검사를기존CI직렬목록에추가해동시fixture수정/오류누락없이실행한다.

코드통합은로컬완료이며이문서커밋시점원격CI·Preview·운영승격은아직확인전이다. 이미검증된phase73운영자료는이번브랜치에문서전용체크포인트를그대로보존했다. 후속운영증거에서정확한SHA/CI/DeploymentID/두실제사이트제공버전을구분한다.

금융계산·API서비스/데이터·권한/보안·의존성·시뮬레이터소스는바꾸지않았다. 실제로그인계좌·고객PDF·실제의견POST·운영DB쓰기종단검증은미수행이다. 미지원원문/지표와정의없는금융값을채우지않았고시뮬레이터공개PR승인차단을유지했다. nativePNG전체일치·글꼴동일성은미수용이다.
