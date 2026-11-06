# 월별 배당 차트 운영 반영과 실제 공개 검증

2026-11-06, [PR281](https://github.com/totobubu/yieldloom-app/pull/281)과 [승격 PR283](https://github.com/totobubu/yieldloom-app/pull/283)으로 월별 배당 차트의 원본 구조·상태 표시를 운영에 반영했다. UI 병합은 `9ad30456a033dc62cf7f0cbe3533ffc4ed541844`, 최종 제공 커밋은 `7384e39d0791f55fccc50f3fe8ab5593a414f656`다. [실제 두 사이트 응답](evidence/phase78-production/final-sites.json).

최종 제공 커밋은 별도 PR282의 `.github/workflows/test-dropbox-readonly.yml` 하나만 더해졌다. 앱·테스트·API·lib·공개 데이터·의존성은 UI 병합과 같으며 기존 다른 작업을 되돌리지 않았다. 이 스레드에서 PR282를 병합하거나 해당 연결 테스트를 실행한 것은 아니다. [차이와 자동 취소 구분](evidence/phase78-production/superseding-main.json).

## 원본·구현·운영의 구분

| 영역 | 실제 닫은 범위 | 아직 닫지 않은 범위 |
| --- | --- | --- |
|월별 배당 추이|MCP 원본bd619d...의 제목20/28px·범례12px·플롯224px/같은 폭·막대144px·패딩·격자·월 상태 표시|도움말/최근기간/선택상세의 원본 없는 추가 외형·전체 native PNG·실제 글꼴 수용|
|기존 실제 동작|집계 script 바이트 보존, 연도·12/24개월·선택·ROC·미확인·당월 관측 없음 유지|실제 인증 계좌·고객PDF·운영 DB 쓰기 종단 검증|
|공개 운영|실제 QQQI, 두 주소×4폭, 키보드 월 탐색·연도·24개월·다크, 변경 추가읽기0|시장 전체/공급자 최신성·전체 이력 완전성·서버 DB 청구량|

[원본ID·경로·컴포넌트·기기·상태와 수정 전후](PHASE78_DIVIDEND_TREND.md), [신규 원본 읽기 해시](evidence/phase78/fresh-reference-integrity.json), [4폭 치수](evidence/phase78/after/geometry.json)를 따른다. 이 한 단위는 새4페이지나 전체 리디자인 완료율이 아니다. 최종20개 기기ID/9화면군 중15개 운영 연결/5개 별도 인계·승인 상태는 그대로이고 기존14종과 중복된다.

## 정확한 커밋과 검사

| 단계 | SHA/실행 | 결과 |
| --- | --- | --- |
|기능|cbc4707,42184767590|Application quality4/4 성공|
|work|60c8c12,42186773314|Application quality4/4 성공|
|운영 승격|PR283,42186868324|Application quality4/4 성공|
|UI main|9ad3045,42189188689|새 main push로 자동 취소. 앱/API/등록 성공, browser 취소. 실패를 성공으로 세지 않음|
|최신 main|7384e39,42189433099|Application quality4/4 성공|

기능/work/승격은 같은 트리 `23961f7c8042047f0a7ff0e2582974a93e836ae4`를 검증했다. 최신 head/base·GitHub 병합 후보·로컬 후보·실제 병합 트리를 확인했고, 승격 diff는 이번 소스/테스트/측정기와 문서만 포함했다. [사전 대조](evidence/phase78-production/final-premerge.json). 로컬 Node819/819·타입 포함 build·lint 오류0/기존경고54와 해당 브라우저 로그는 [구현 증거](evidence/phase78)에 있다.

분할 비교는 실제 로그의20상태다. 최초 구현 문서의30 표기를 이번 체크포인트에서20으로 정정했고 PR 설명도 수정했다. 금융 assertion이나 검사 자체를 줄인 변경이 아니다. [정정](evidence/phase78-production/count-correction.json).

원격 CLI 로그는 browser 이름 아래 등록 검사 명령이 보이고 전체 추출에도 두 PASS행만 나오는 혼선이 있어 전체 사례 수를 산정하지 않았다. 직접 job 로그 읽기는 exit1이며 HTTP 원인은 미확정이다. 다른 인증이나 서명 URL로 우회하지 않았다. 원격의 확인된 각 job 성공 상태·정확한 head·실제 workflow blob 일치와 로컬 검사 증거를 분리해 보관했다. [로그 읽기 한계](evidence/phase78-production/log-inspection-limitation.json).

## 배포와 실제 응답

Vercel UI 배포 `dpl_FqszgLzQN6E9tg65LzrHQs9AXG1q`와 최종 제공 배포 `dpl_FG1W8ZN5bsuWiCsAue2FSCnNMw1A`는 READY다. Pages의 UI 실행42189188611은 후속 main push로 취소됐고 최신 실행42189432955가 성공했다. 수동 재배포나 보안·권한·배포 설정 변경 없이 기존 Git 연동으로 제공됐다. [배포 ID](evidence/phase78-production/deployments.json), [최신 Pages](evidence/phase78-production/pages-ci.json).

두 실제 주소의 HTTP200·커밋7384e39·공개 메타데이터 해시 `aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e`를 독립 확인했다. 해시는 공개 메타데이터3파일이며 전체 금융 이력/Content Studio JSON의 완전성 증명이 아니다. [공식 release 검증기](evidence/phase78-production/final-release-verified.txt).

첫 Node 확인기는 환경 프록시를 사용하지 않아 ECONNREFUSED로 대기했다. `NODE_USE_ENV_PROXY=1`과 상속된 인증서 검증을 사용해 해결했으며 Python의 같은 프록시/CA 경로도 같은200·버전을 확인했다. 네트워크 정책을 바꾸거나 TLS 검증을 끄지 않았다. 이전 대기를 운영 장애로 분류하지 않는다. [전송 관측](evidence/phase78-production/transport-observation.json).

## 실제 공개 화면과 남은 포커스 동작

두 운영 사이트에서 실제 QQQI 자료를 사용해1280/834/768/390px의 제목20/28px/600·범례12px·차트224px·막대144px·24/20px 패딩과12개 월을 확인했다. 연도 전환·24개월·다크·키보드 Tab 탐색과 마지막 월 내부 스크롤을 통과했고 페이지 넘침/JS오류/실패한 허용 host0이었다. 최초 각2개 공개 읽기 이후 전환·resize 추가읽기0이다. [Vercel 결과](evidence/phase78-production/public-results-vercel.json), [Pages 결과](evidence/phase78-production/public-results-pages.json), [실행기](evidence/phase78-production/public-trend.mjs.txt).

기존 익명 analytics POST각1개는 전송 전에 차단했고 전달된 쓰기0이었다. 브라우저는 새 익명 컨텍스트이며 개인 계좌 경로를 차단했다. 실제 의견·계좌·고객 문서를 전송하지 않았다. 관측된 브라우저 요청과 서버 DB 읽기·청구량을 같은 것으로 취급하지 않는다.

첫 운영 검사는 넓은 화면에서 이미 포커스한 마지막 월에 Mobile 전환 후 다시 focus()를 호출해 자동 스크롤을 기대하다 실패했다. 실제로 Mobile 전환 전후 포커스가 그대로이고 해당 월 left592px/차트 right354px·scrollLeft0이었다. 새로운 키보드 Tab 이동은 마지막 월을 보이게 하고 선택/상세를 정상 갱신했다. **같은 포커스를 유지한 채 폭만 줄였을 때의 자동 재스크롤은 미해결로 남긴다.** 검사를 약화해 이 동작이 수정됐다고 하지 않는다. 첫 실패 로그와 [관측 범위](evidence/phase78-production/focus-observation.json)를 함께 보존했다.

## 계속 남는 범위

원본/실제 자료와 정의가 없는 별도 자료 검토 목적 화면, 권한 있는 보관 파일 원문 연결, peer TTM·세전YOC·성장률 계약, 열린 시세/ROC 상세 프레임이 필요하다. 기존14종의 전체 글꼴·간격·상태 대응과 추가 도구 조립도 미수용이며 이번 부분 치수 PASS로 전체 승인하지 않는다. 시뮬레이터 공개 PR 승인 차단을 유지했고 생성·우회하지 않았다. 실제 계좌·고객PDF는 계속 미검증이다.
