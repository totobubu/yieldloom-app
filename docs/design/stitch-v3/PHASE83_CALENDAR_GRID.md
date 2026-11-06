# 배당 캘린더 날짜 격자와 오늘 표시 보정

검수된 Stitch `fc276eb9388a48909296fb018f60771b` → `/mypage?tab=calendar` → PortfolioDividendCalendar의 PC 날짜 격자·오늘 표시·공시/추정 상태 외형을 보정했다. 공식 MCP로 HTML·PNG를 다시 읽어 기존 해시와 일치함을 확인했다. [원본 무결성](evidence/phase83-calendar-grid/fresh-reference-integrity.json), [원본 native PNG](evidence/phase83-calendar-grid/original-native.png), [기존 원본 HTML](../stitch-v2/originals/7356929996797649648/fc276eb9388a48909296fb018f60771b.html).

기존 붙은 격자를 원본의6px 간격·개별1px 테두리/8px 모서리로 바꾸고 요일 헤더와 날짜 묶음을 분리했다. 헤더 하단8px/테두리와 날짜 묶음까지16px, 날짜 내부4px 간격·12/18px 숫자, 실제 오늘의 배지·테두리·배경을 대조했다. 오늘 날짜 셀 버튼에는 기존 접근성 이름을 유지하며 `aria-current="date"`를 추가했다. 공시 일정은 청록 실선, 주기 추정은 노랑 점선으로 구분했다. 라이트 원본색은 `.month-grid` 안의 scoped 변수로 제한했고 다크는 기존 앱 테마 토큰을 사용한다.

script는 기존 운영 ba450ec와 바이트가 같다. 날짜·계좌·통화·기간/보기/상태 투영·클릭 핸들러, 공시/저장 기록/추정 계산·권한·API·금융 값은 바꾸지 않았다. 전체 일정과2개 이후 ‘더 보기’, 날짜 팝업·월간 목록/년 보기·대조/ICS 경로는 보존한다. 시안 예시의 날짜·수량·금액을 실제 값으로 복사하지 않았다. [변경 경계](evidence/phase83-calendar-grid/scope-proof.json).

PC1280px의 지정83개 computed 속성이 원본과 일치했다.834/390px는 원본처럼 격자를 숨기고 기존 목록을 유지하며, 라이트·다크4개 목록 캡처는 변경 전후 RGB가 같다. 기존 서비스가 합성 DEMO-M 과거 이력에서 실제로 도출한 추정 상태도 확인했다. 이 추가 fixture는 날짜 기준을 바꿔도 조회를 추가하지 않았다. 다크의 오늘/공시/추정 글자 대비는 약10.99/11.13/8.75다. [측정·비교 범위](evidence/phase83-calendar-grid/verification.json), [3폭 후속 상태](evidence/phase83-calendar-grid/verified-final/measurements.json), [상태 대조표](evidence/phase83-calendar-grid/state-matrix.json).

기존 캘린더4폭 회귀는 월/년·계좌/날짜·미확인 이력·읽기 전용 장부·다크·새로고침/로그아웃 경합을 통과했다. 최종 실행은 기존 목 응답 아래에 미매칭 쓰기 차단을 추가했다. 관련 패널3폭 회귀와 기존 캘린더 단위7개, 타입 포함 빌드·lint오류0/기존경고54를 확인했다. [캘린더 회귀](evidence/phase83-calendar-grid/calendar-guarded.txt), [관련 패널](evidence/phase83-calendar-grid/priority.txt), [단위](evidence/phase83-calendar-grid/calendar-unit.txt), [빌드](evidence/phase83-calendar-grid/build.txt).

추가 상태 비교의 첫 실행은 공유 브라우저 context의 테마가 이미 다크여서 도구의 ‘다크 모드’ 버튼 찾기가 실패했다. 페이지를 추가하기 전에 라이트로 복원해 원래 검사를 유지한 채 재검증했다. 실패한 캡처를 수용 근거로 쓰지 않았다. [최초 실패와 한계](evidence/phase83-calendar-grid/verification-notes.json).

단일 반응형 HTML의3폭 재렌더이며 별도 native3장 또는 전체 픽셀/글꼴 수용이 아니다. PC의 실제 셸 슬롯/셀 너비, 여러 일정과 ‘더 보기’로 달라지는 높이, 추가 도구/선택 상태와 실제 날짜·자료 문구는 잔여다. 원본의 선택 공시 이벤트 outline을 실제 선택 없이 가짜로 켜지 않았다. 다크 native 프레임·실제 인증 계좌·고객 PDF·운영 DB 쓰기는 미검증이다. 기존14종의 후속이며 최종20기기의15개 운영 연결/5개 외부·승인 수를 늘리지 않는다. 시뮬레이터 공개 PR 차단을 유지한다.

이 문서는 로컬 구현 기록이다. 원격 CI·Preview·운영 완료는 후속 기록과 실제 release로 따로 확인하며, 이전 phase82 운영을 이번 배포 증명으로 쓰지 않는다.
