# 저장 결과 카드 높이 보정 운영 확인

기능 PR [#273](https://github.com/totobubu/yieldloom-app/pull/273)과 운영 승격 [#274](https://github.com/totobubu/yieldloom-app/pull/274)를 병합했다. 운영 커밋은 `016fcddda89e0f5285a65446e8859adde247c208`이다. 두 실제 운영 주소의 app-release와 세 공개 메타데이터 파일의 결합 해시가 일치했다. 이는 모든 금융 이력의 해시 검증을 뜻하지 않는다.

Pages [42153915739](https://github.com/totobubu/yieldloom-app/actions/runs/42153915739) 성공, Vercel Production `dpl_Cw1SSqGgWbDn1cBxwxeJyhP41MSa` READY를 각각 확인했다. 두 주소에서 새 CSS·후속 작업 제목·실제 계좌 전체 CSV 범위 문구와 기존 매핑·검토·비교·장부 자산을 확인했다. 새 WOFF2 두 파일은 두 도메인에서 HTTP200, 동일 origin, wOF2 형식, 원본 bytes/SHA256 모두 일치했다. 실제 로그인 영수증 창을 열었다는 뜻은 아니다.

## 원본 대조 결과

최종 Tablet `cf7686fbb620465f93418fde1572a6cc`와 Mobile `f5a2132c4e234e648269220f0e889387`의 보존 MCP HTML·native PNG를 읽었다. 아래 수치는 같은 viewport·합성6행·DPR2에서 **원본 HTML을 다시 렌더한 결과**와의 비교다. Tablet 원시 PNG 폭은2560px이며834px의 별도 native PNG가 있다고 주장하지 않는다.

| viewport | 갱신 안내 구현/원본 px | 후속 작업 구현/원본 px | 전체 높이 차이 전→후 px |
| --- | --- | --- | --- |
|834|164.5 /164.5|288 /288|+32→0|
|768|164.5 /164.5|288 /288|+32→0|
|390|161.625 /161.625|304.5 /304.5|+14.875→+3.75|

390px 상세 일반 행129px·중복 행131px도 원본 HTML과 같다. 실제 index.html의 Google Fonts 링크를 포함한 별도5폭 감사에서도 같은 치수와 상태 검사를 통과했고 API0이었다. 1280/360px은 추가 반응형 검사다. [구현·합성 검증 상세](PHASE70_RECEIPT_FOLLOWUP_AND_REFERENCE_FONT.md), [index 글꼴 포함 측정](evidence/phase71/receipt-with-index-fonts.json).

Mobile 전체+3.75px는 요약+7.25px, 실제 금융 미제공 안내-19.5px, 서버 저장 의미 안내+16px의 합이다. 요약 카드 조립은 후속 UI 대상으로 남는다. 실제 금융 상태/설명을 지우거나 예시 금액·빈 공간으로 전체 높이를 상쇄하지 않았다. 전체 native PNG·글꼴·금융 예시 문구 일치는 수용하지 않았다.

## 코드·자료와 CI의 구분

기능 HEAD `85314d9`의 [42150103825](https://github.com/totobubu/yieldloom-app/actions/runs/42150103825), work `736c5fa`의 [42152205987](https://github.com/totobubu/yieldloom-app/actions/runs/42152205987), 승격 [42152257370](https://github.com/totobubu/yieldloom-app/actions/runs/42152257370)는 각각 application·portfolio-api·browser·registration-browser **4/4 성공**이다. 각 PR의 테스트 checkout은 GitHub 합성 병합 커밋이며 source HEAD와 구분한다. 기능 Preview와 work Preview의 정확한 release SHA·READY도 확인했다.

승격 전체 CI는 base `64f327e`의 합성 병합 `228f93a`를 검사했다. 검사 중 자동 자료 갱신 `f7e7d87`가 추가됐다. 앱·테스트·빌드/CI 코드 동일성을 확인하고 최신 자료를 포함한 로컬 병합에서 데이터 상태 검사와 타입 포함 빌드를 통과했다. 추가6개 JSON 및 이전 자동 갱신을 합친17개 Content Studio JSON의 유효성·해시·최신 main과의 바이트 동일성을 확인했다. 최종 운영 트리 `e01c056bec6bc0c96566b8b8b745a3062d86031c`는 그 로컬 검증 트리와 정확히 같다. 자료 값을 수동 편집하지 않았다. [병합 계보](evidence/phase71/merge-provenance.json), [자료 보존](evidence/phase71/latest-data-integrity.json).

최종 main의 [42153915815](https://github.com/totobubu/yieldloom-app/actions/runs/42153915815)는 기록 작성 중 진행 중이다. 앞선 성공과 별개이며 완료 후 상태를 갱신한다.

두 실제 운영 주소의 유사·테마 비교4조합에서1440/834/390px, 일반 직접주소200·새로고침200·쿼리 보존·보이는 메뉴 이동·기초자산 제목·홈/뒤로가기 제목을 확인했다. PC→Tablet 전환120프레임 넘침0, 공개 검색2주소1440/390px도 오류/넘침/쓰기0이었다. 익명 계좌 API는401·문서 읽기0·읽기 작업0이다. 기존 Node 인증서 검증 HTTPS→Chromium 전달을 사용했고 TLS 검증을 끄지 않았다. 실제 인증 계좌/고객PDF/운영 DB 쓰기는 하지 않았다.

## 다른 화면의 글꼴 점검과 남은 범위

운영 연결15개 선택 시안의 보존 HTML을 다시 읽고 해시가 등록부와 같음을 확인했다. Pretendard CDN 선언은 버전 포함6개이며, 실제 한글 표본에서 custom Pretendard를 쓰는 것은 열 연결Tablet·유사 비교Mobile·저장 결과Tablet·장부Mobile 네 개였다. 유사 비교Tablet은 CDN을 로드해도 잘못된 단일 family 문자열 때문에 Noto Sans CJK KR을 사용했고, 검토Tablet은 같은 잘못된 문자열과 Google Fonts 요청 실패를 보였다. 그 밖의 화면별 실제 글꼴은 [15개 원본 브라우저 감사](evidence/phase71/reference-used-fonts.json)에 남겼다. 새 MCP 목록/새 시안을 생성하지 않았고 글꼴 링크 존재를 실제 사용이나 PNG 일치로 간주하지 않았다.

운영 비교 화면 h1의 실제 글꼴도3기기에서 기록했다. Mobile은 Pretendard Variable, Tablet은 Noto Sans CJK KR, PC는 한글 Noto Sans CJK KR과 Hanken Grotesk였다. family 이름만으로 원본 정적 폰트 파일·글리프·native PNG 일치를 판정하지 않는다. 저장 결과 외 화면의 전역 글꼴을 이번에 바꾸지 않았다.

후속 대상은 저장 결과 Mobile 요약+7.25px 조립, 검토/업로드/비교/장부의 기록된 전체 프레임·상태·치수 차이다. 금융 원본/정의가 없는 지표는 미제공 상태를 유지한다. 전체 시안20개/9화면군 중 운영 연결15개·외부 인계/승인5개라는 수는 그대로이며 기존14종과 합산하지 않는다. 실제 계좌·고객PDF는 미검증, 시뮬레이터 공개PR 승인 차단은 유지한다. 구형 family-portfolio fixture의 관리자 가드 실패는 phase70 근거에 남겼고 현행 합성 broker/asset 및 전체 CI 성공과 구분한다.
