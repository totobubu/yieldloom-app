# 계좌 카드와 반응형 차트 포커스 통합 검증

기준7384e39에서 기존 데이터를 보존하고 [차트 포커스](PHASE79_FOCUSED_RESIZE.md), [자산관리 카드](PHASE79_ACCOUNT_CARDS.md)를 수정했다. 서로 다른2개 기존 화면의 일부 개선이며 새 기기 시안2개나 전체 리디자인 완료율이 아니다. source ID→경로/컴포넌트·폭·상태는 각각의 문서/측정 근거를 따른다.

로컬 Node819/819, 타입 포함 build, lint오류0·기존경고54를 통과했다. [Node](evidence/phase79-integration/node-suite.txt), [빌드](evidence/phase79-integration/build.txt), [lint](evidence/phase79-integration/lint.txt). 마지막 명의자 aria-label 보강/검증 HTML 인코딩 수정 후 새27상태와 lint/build를 다시 통과했다. 금융 로직을 바꾸지 않은 속성/검증기 수정이므로 그 사이 관련 변경이 없는 Node819 결과를 재사용했다.

배당 탐색3폭 왕복/비활성 포커스/해제·빈 자료, 카드27개 합성 상태, ETF기준/통화/조회전용/기존 KPI·일정 상세3폭, 공개 TTM·권한·캐시 데이터 계약을 통과했다. [기존 연계 흐름3폭](evidence/phase79-integration/priority-panels.txt), [데이터 계약](evidence/phase79-integration/data-contracts.txt). 새 카드 검사는 기존 CI browser 직렬 목록에1개 명령만 추가했다. 권한·액션·비밀 설정을 변경하거나 검사를 생략하지 않았다.

원격 CI·Preview·main 병합·Vercel/Pages 제공 확인은 아직 이 로컬 기록의 범위가 아니며 후속 운영 기록으로 구분한다. 실제 인증 계좌·고객PDF·운영 DB 쓰기 및 전체 native 원본 일치는 미검증/미수용이다. 원본 파일 연결·정의 없는 금융 지표·시뮬레이터 공개 PR 승인 차단을 우회하지 않았다.
