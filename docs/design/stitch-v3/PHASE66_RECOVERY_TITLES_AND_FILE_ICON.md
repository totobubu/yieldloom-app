# 복구 후 비교 제목·열 연결 파일 아이콘 보정

기준 운영은0abdcdad7ada8b4fc95ac50a492f51565c134fdb다. 실행 환경 ready와 실제 셸 실행을 확인하고 재개했다. 별도 Browser Use의 크레딧 부족 요청은 재시도하지 않았고 복구된 환경의 기존 Playwright/Chromium을 사용했다. Vue3.5.25·PrimeVue4.5.3은 lockfile과 설치값이 일치한다. 이 문서는 로컬 코드/합성 검증 기록이며 신규 운영 배포 증거는 아니다.

## 비교 제목

기존 document.title은 `- 모으멍 배당달력`이었다. 수정 전 제목 검사는 실패했다. 최신 요청에서 비교 페이지 제목 해결을 명시했으므로 이전 병렬 소유 제한의 해당 파일에서는 제목 연결2줄만 변경했다. 기존 comparisonSections/section의 label을 @vueuse/head의 computed title로 연결한다. 전역 titleTemplate·라우터·비교 계산·조회·권한은 바꾸지 않는다.

직접 진입14개 폭/모드, similar→theme→underlying→잘못된 view의 기본값, 검색 복귀와 뒤로 가기를 통과했다. 비교 종류만 바꾸는 동안 directory 함수 호출1회·detail 호출0회다. 초기 추가 검사의 실패는 테스트가 앱과 다른 router 인스턴스를 import한 것이 원인이었다(same=false 진단 보존). 실제 앱 router를 사용하도록 바로잡았고 제품의 제목 반응성 결함으로 세지 않는다.

## 파일 아이콘과 태블릿 색

실제 최종 원본 PC9ae2f0f1253a41b1839e792d36996900, Tablet0bb2ab1d8197472f910b73ed175c4448, Mobilee0fb1368a1684edaa56c1a506e806530의 보존 HTML을 읽고 DPR2, 같은 합성3행에서 원본/수정 전/수정 후를 비교했다. 원본 파일은 수정하지 않았다.

기존 pi-file의 실제 glyph는16px였다. 이미 저장소에 있는 원본 공급자 description.svg와 StitchSymbol을 재사용해 PC/Mobile22px·Tablet24px로 맞췄다. Tablet 라이트 배경#f0fdfa·테두리#ccfbf1도 원본으로 맞췄다. 세 기기 다크의 기존 배경rgb(16,60,54)·테두리rgb(209,250,229)·전경rgb(125,214,200)은 전후 동일하다. 40px 버튼·파일 설정 열기·키보드 포커스·fieldset/처리중 차단은 보존했다.

| viewport | 기존 glyph | 수정 glyph | 원본/구현 중심Y px | 카드·헤더 치수 |
| --- | --- | --- | --- | --- |
|1280|16|22|179.75/179.75|전후 동일|
|768|16|24|276.25/276.25|전후 동일|
|834|16|24|253.5/253.5|전후 동일|
|390|16|22|239.75/239.75|전후 동일|

Tablet 원본은24px 글꼴의32px 줄 상자, 구현은24px SVG 상자다. 중심은 같고 font 줄 상자까지 같다고 주장하지 않는다. 원본 HTML 렌더링의 파일 아이콘 요소 캡처(물리80×82px)만 RGB 채널 평균 절대차0~255로 비교했다. PC/Mobile14.02749→1.45615, Tablet768/83424.00910→0.00864다. 채널차16 초과 픽셀은 PC/Mobile732→185, Tablet937→0이다. 남은 래스터 차이가 있으므로 아이콘도 완전 픽셀 일치로 판정하지 않는다. 이것은 native 원본 전체 PNG 비교나 화면 전체 승인율이 아니다. 별도 글꼴/단계 폭·간격·다른 아이콘·실제 문구/값 차이는 남는다.

## 기능·경계

원본4폭·선택 항목7개 펼침·Mobile dark, 필수 누락/준비/중복/처리중 상태와 원문3행 검사를 통과했다. 합성 XLSX/CSV→열 연결→검토→로컬 Memory API 저장 및 명세 저장/조회/삭제,6개 매핑 창 폭과4개 포트폴리오 폭을 통과했다. 금액 입력/매핑 중 요청0이다. 로컬 서버는 Store와 가짜 토큰 검증으로 분리했고 임의 포트에 bind한127.0.0.1에만 Vite를 연결했다. Python 의존성은 별도 /tmp venv에 설치했으며 프로젝트 의존성 파일은 변경하지 않았다.

타입 포함 빌드 성공, 린트 오류0/기존경고54다. 실제 로그인 계좌·고객PDF·운영 DB 쓰기는 시험하지 않았다. 시뮬레이터 파일과 공개PR 승인 차단을 유지한다. 원격 CI·Preview·운영 확인은 각 최종 SHA에서 별도 확인한다.

기준 서버의 첫 보강 캡처 실패는 테스트 HTML 부재로 생긴 harness 오류였고, 정확한 기존 Broker 소스와 별도 harness를 사용한 재검증을 통과했다. 수정 전 제품 제목 실패와 이 두 가지 측정 설정 실패를 구분한다.

[고정 데이터 측정](evidence/phase66/after-measurements.json), [아이콘 차이](evidence/phase66/fixed-icon-pixels.json), [색/다크 보존](evidence/phase66/icon-colors.json), [제목/이동 검사](evidence/phase66/comparison-final.txt), [빌드](evidence/phase66/build.txt), [린트](evidence/phase66/lint.txt).
