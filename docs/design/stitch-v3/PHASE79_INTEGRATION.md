# 계좌 카드와 반응형 차트 포커스 통합 검증

기준7384e39에서 기존 데이터를 보존하고 [차트 포커스](PHASE79_FOCUSED_RESIZE.md), [자산관리 카드](PHASE79_ACCOUNT_CARDS.md)를 수정했다. 서로 다른2개 기존 화면의 일부 개선이며 새 기기 시안2개나 전체 리디자인 완료율이 아니다. source ID→경로/컴포넌트·폭·상태는 각각의 문서/측정 근거를 따른다.

로컬 Node819/819, 타입 포함 build, lint오류0·기존경고54를 통과했다. [Node](evidence/phase79-integration/node-suite.txt), [빌드](evidence/phase79-integration/build.txt), [lint](evidence/phase79-integration/lint.txt). 마지막 명의자 aria-label 보강/검증 HTML 인코딩 수정 후 새27상태와 lint/build를 다시 통과했다. 금융 로직을 바꾸지 않은 속성/검증기 수정이므로 그 사이 관련 변경이 없는 Node819 결과를 재사용했다.

배당 탐색3폭 왕복/비활성 포커스/해제·빈 자료, 카드27개 합성 상태, ETF기준/통화/조회전용/기존 KPI·일정 상세3폭, 공개 TTM·권한·캐시 데이터 계약을 통과했다. [기존 연계 흐름3폭](evidence/phase79-integration/priority-panels.txt), [데이터 계약](evidence/phase79-integration/data-contracts.txt). 새 카드 검사는 기존 CI browser 직렬 목록에1개 명령만 추가했다. 권한·액션·비밀 설정을 변경하거나 검사를 생략하지 않았다.

원격 CI·Preview·main 병합·Vercel/Pages 제공 확인은 아직 이 로컬 기록의 범위가 아니며 후속 운영 기록으로 구분한다. 실제 인증 계좌·고객PDF·운영 DB 쓰기 및 전체 native 원본 일치는 미검증/미수용이다. 원본 파일 연결·정의 없는 금융 지표·시뮬레이터 공개 PR 승인 차단을 우회하지 않았다.

## 원격 등록 검사에서 찾은 이전 접근성 이름

첫 CI는 일반 브라우저/앱/API 성공 후 등록 작업이 Chromium 설치에서12분 제한을 넘겼다. [첫 결과](evidence/phase79-integration/ci-first-status.json), [제한 초과 근거](evidence/phase79-integration/registration-timeout.json). 작업 종료 뒤 같은 SHA의 등록 작업만 재실행하자 설치는 성공했으나 기존 버튼 이름을 정확히 찾는 검사에서 실패했다. [실제 실패](evidence/phase79-integration/registration-old-name-failure.txt).

명의자·권한·유형을 추가한 접근성 이름은 새27상태 검사에서 이미 검증했지만 기존 등록 스위트의4개 exact 이름을 갱신하지 못했다. 해당4개 기대값을 전체 새 이름으로 바꿨고 부분/정규식 선택으로 완화하지 않았다. 앱 코드는 추가 변경하지 않았다. 격리된 loopback Memory API와 opt-in 합성 PDF로 기존 등록 전체 스위트를 다시 통과했다. 본인/가족 수동 등록, 잘못된 문서/암호, 합성 문서 추출→검토→저장, 업로드 실패 후 계좌 보존, 명의자/탭 이동 추가조회0,4폭×light/dark·키보드 파일 선택·넘침/오류 검사를 포함한다. [최종 합성 등록](evidence/phase79-integration/registration-final.json). 실제 고객 PDF나 실계좌 등록 결과는 아니다. 이 테스트 수정의 원격 CI는 새 최종 head에서 재실행한다.
