# 배당 캘린더 일정 카드와 날짜 표기 보정

같은 검수 원본 `fc276eb9388a48909296fb018f60771b` → `/mypage?tab=calendar` → PortfolioDividendCalendar의 Tablet/Mobile 일정 카드를 보정했다. [원본 무결성](evidence/phase84-calendar-list/fresh-reference-integrity.json), [검수 원본 native PNG](evidence/phase83-calendar-grid/original-native.png), [앞선 날짜 격자 단위](PHASE83_CALENDAR_GRID.md). 이 변경은 #292 작업의 후속 후보이며 원격 CI·운영 반영을 별도로 확인한다.

기존 날짜·종목·계좌/수량·금액4행을 원본의 날짜·종목·요약3행으로 조립했다. 계좌·수량 뒤에 같은 기존 금액을 그대로 표시하며 정보를 숨기거나 값을 재계산하지 않는다. 공시 일정은 청록4px 좌측 경계와 연한 배경·녹색 상태 배지, 주기 추정은 노랑 경계·배지로 구분한다. 기존 recorded/review의 의미와 상태 문구를 유지한다. 배지12/18px·600·2px8px패딩·4px모서리는 설치된 PrimeVue4 Tag의 공개 토큰과 루트 class로 제한했다. 깊은 내부 DOM 선택자나 공통 테마 변경은 없다.

카드 날짜는 같은 ISO 날짜를 `YYYY.MM.DD (요일)`로 표시한다. UTC를 명시한 표시 전용 formatter로 브라우저 시간대에 따른 전날 이동을 방지하고 `time.datetime`과 기존 detailDate에는 원래 ISO를 유지한다. 이 블록을 제외한 script는 이전 #292 소스와 같다. UI 상태 class·Tag severity와 배치 외에 API·계좌·권한·장부·금융 계산/서비스·날짜 선택·수량/0/결측·전체 목록/더 보기·대조/ICS를 바꾸지 않았다. [변경 경계](evidence/phase84-calendar-list/scope-proof.json).

834/390px에서 공시/추정 카드·날짜·배지·종목·요약의 선택146속성을 원본과 대조했다. Tablet의 동일 합성 계좌 카드는153.17px에서 원본과 같은102.5px로 줄었고 배지는32px에서24px로 맞췄다. 고정 높이는 쓰지 않았다. Mobile은 원본의 예시 설명이 더 길어 카드 전체 높이가 다를 수 있으며 이를 가짜 금융 문구로 채우지 않았다. 기존3개 계좌의 종목·금액은 그대로이며 메타데이터는 기존 계좌/수량+같은 금액이다. 실제 기존 서비스로 만든 주기 추정은 금액 미확인 상태를 유지했고 날짜기준 변경은 조회를 추가하지 않았다. PC 기본 격자 라이트/다크2캡처는 이전 #292 단위와 RGB가 같다. [실측·값 보존·차이](evidence/phase84-calendar-list/verification.json).

UTC·서울·LA의3개 브라우저 context에서 합성 `2026-11-25`가 모두 `2026.11.25 (수)`로 표시되고, 키보드로 연 상세는 원래 ISO 날짜를 유지했다. [시간대 확인](evidence/phase84-calendar-list/timezone.json). 기존 캘린더4폭과 관련 패널3폭의 읽기 전용 회귀, 기존 캘린더 서비스 단위7개·타입 포함 최종 빌드·scoped lint를 통과했다. 전체 lint는 오류0/기존경고54다. [기능](evidence/phase84-calendar-list/calendar-final.txt), [관련 패널](evidence/phase84-calendar-list/priority-final.txt), [빌드](evidence/phase84-calendar-list/build-final.txt).

원본은 단일 반응형 HTML의3폭 재렌더이며 별도의 native3장이 아니다. 실제 계좌명·종목 유형/명칭·상태와 금융 값, 날짜·요일 내용·글꼴, 추가 목록 제목/선택/더 보기·공시/기록/추정 상태 전체와 셸 조립은 완전 일치로 판정하지 않는다. 기록/검토를 공시 확정으로 바꾸거나 원본의 가상 주당금액/수량/합계를 넣지 않았다. 다크는 기존 테마 토큰을 활용한 실제 표시·기능 확인이며 dark native 원본은 없다. 실계좌·고객PDF·운영 DB 쓰기는 미검증이고 시뮬레이터 공개 PR 차단을 유지한다. 기존14종 및15개 운영 연결/5개 외부·승인 수는 변하지 않는다.

이 문서는 로컬 후보의 기록이다. 앞선 운영 버전이나 Preview를 이번 완료로 표시하지 않으며 원격 CI와 실제 운영 제공을 후속 기록한다.
