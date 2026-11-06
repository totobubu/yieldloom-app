# 자산 카드 목록 정렬의 운영 검증

2026-11-06, [#288](https://github.com/totobubu/yieldloom-app/pull/288)의 최종 기능 `612153e306c1b9409fe820fb3139c2dc34121b7e` → work `a1c5107f79c1b1850b7702910cef0eaae6a8df03` → [#289](https://github.com/totobubu/yieldloom-app/pull/289)의 main `dcc2c050c5977325ee36eaadcc04fbf2a6cb2e5b` 순으로 반영했다. 두 실제 운영 release도 같은 main과 metadata `aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e`임을 확인했다. 기존 자산 관리의 목록 정렬 보정이며 전체 리디자인 완료가 아니다.

## 원본과 수정

`b611bd07ed0c464581479140b9207afb`(프로젝트7356929996797649648) → `/mypage?tab=assets` → 부모 FamilyPortfolioView의 일반 목록 CSS가 AssetAccountList 루트에 미치는 범위다. 공식 MCP의 새 HTML/PNG가 기존 해시와 일치했다. [구현·원본·전후 측정](PHASE81_ACCOUNT_GRID_INSET.md), [원본ID/경로/상태](evidence/phase81-production/source-route-state-map.json).

자식 `.accounts`의 padding0을 부모 `.portfolio-tabs ul`의 왼쪽20px가 덮어쓰고 있었다. 일반 목록 규칙에서 `.accounts`만 제외했다. 다른 일반 목록·카드 내용·명의자/권한/통화·기존 열수·금융 계산/자료·서버 API·의존성은 유지한다. 부모 루트 패딩과 카드 폭을 구분했고, 임의로 셸을 넓히거나 숫자/문구를 원본의 예시로 바꾸지 않았다.

기존 통합 검사에서 수정 전1280px 카드 시작점 불일치를 재현했고, 수정 후1280/768/390px의 첫/마지막 카드 정렬과 기존 별칭·명의자·통화/미확인·viewer·미지원 출처·분석/캘린더 흐름이 통과했다. 타입 포함 build·Node819·lint오류0/기존경고54를 확인했다. 마지막612153e는 촬영 조건/문서만 바뀌었으며870393a와 앱·테스트 코드는 같다. 최종 head의 전체 원격 CI도 별도로 통과했다.

## 치수·촬영과 남은 시각 차이

834/390px의 카드 폭은766/338px에서 원본의786/358px로 맞았고 높이284px를 유지했다. 1280px는310.66→317.33px/높이300px,1024px는708→728px/높이284px이며 기존3열/1열을 유지했다. 이 PC 값은 독립 원본 전체 폭의394.66/309.33px·3열과 다르다. 따라서 Tablet/Mobile의 선택 치수 일치를 전체 native PNG 수용으로 올리지 않았다.

처음 locator 캡처의 Mobile 하단 도구에 고정 메뉴가 겹쳐 검수용으로 기각했다. 카드 위치만 중앙으로 옮겨 다시 촬영했고 모든 전후 geometry 행이 같은 것을 확인했다. [촬영 조건](evidence/phase81-account-inset/capture-normalization.json). 실제 카드 내용이나 source PNG를 수정하지 않았다.

추가 탐색에서는 실제 main 폭984/728px에 원본 콘텐츠를 제한하고 원래 viewport media query를 유지했다.1280px는 원본296×324px/앱317.33×300px,1024px는 원본210.66×374px·3열/앱728×284px·1열이다.834/390px는 원본/앱786/358×284px가 맞았다. [탐색 결과와 한계](evidence/phase81-production/composite-qualification.json), [원자료](evidence/phase81-production/composite-geometry.json). 이 강제 슬롯 렌더는 별도 승인된 native 조립 프레임이 아니며 원본 standalone284px를 모든 PC 카드에 고정할 근거도 아니다. 이전708px 가정을 실제main으로 쓰지 않는 수정은 [phase80](PHASE80_PRODUCTION.md)에 보존했다.

선택된 light 스타일에도 잔여 차이가 있다. 카드 본문 원본 `#191c1e`/앱 `#1e293b`, snapshot 원본 `rgba(242,244,246,.6)`/앱 `#f8fafc`이다. owner 역할 배지 배경은 양쪽 `#0d7a6e`로 같았다. [선택 computed style](evidence/phase81-production/card-style-gap-audit.json). 선언 font stack은 native PNG의 실제 한글 glyph 폰트 증명이 아니며, container font 차이가 모든 자식 글자 차이임을 뜻하지도 않는다. 전역 테마나 카드 색상을 이번 목록 수정에 섞지 않았다. PC 조립·패딩/열수·실제 문구 줄바꿈·전체 색상/폰트·PNG 검증은 계속 남는다.

## 원격 검사·실제 운영 제공

기능 [42223458245](https://github.com/totobubu/yieldloom-app/actions/runs/42223458245), work [42226084127](https://github.com/totobubu/yieldloom-app/actions/runs/42226084127), 승격 [42226105641](https://github.com/totobubu/yieldloom-app/actions/runs/42226105641), 최종 main [42228322203](https://github.com/totobubu/yieldloom-app/actions/runs/42228322203)의 앱/API/일반 브라우저/등록 브라우저4개가 모두 성공했다. [최종 상태](evidence/phase81-production/main-ci.json). 실제 main과 GitHub/로컬 후보 tree `9abc0772b41272390895159c9dd1ee5959c95d92`가 동일했다. [후보](evidence/phase81-production/candidate-validation.json). 초기870393a 실행은 문서 촬영 보정으로 새 head가 올라와 최종 대상에서 제외하며 별도의 제품 실패로 세지 않는다.

기능/work Preview READY 및 실제 release612153e/a1c5107도 확인했다. [Preview](evidence/phase81-production/preview-proof.json). Preview의 실제 인증 계좌 UI를 확인한 것은 아니다. Vercel production `dpl_FZcYzBKTw1quKMvHq7n29orWbTxF` READY, Pages [42228322200](https://github.com/totobubu/yieldloom-app/actions/runs/42228322200) 성공이며 두 실제 release의 SHA와3개 공개 metadata 해시를 확인했다. [release](evidence/phase81-production/final-release-snapshot.json), [Vercel](evidence/phase81-production/vercel-production.json). metadata 해시는 전체 시장/원장 완전성을 증명하지 않는다.

각 사이트의 실제 index→현재 module entry→CSS를 확인했다. Vercel은 `FamilyPortfolioView-DhSImp9W.css`/SHA256 `4e832696639f19ac289b1ff00a0c4fde6f98d1a78119f6f10b4e3fbdf2189205`, Pages는 `FamilyPortfolioView-D8uYLhRr.css`/`d93ffb117b804799f5134f1f61555c024c1a6af8b9b7e226c3be9cdeab0acae8`이다. 각 대상 설정으로 독립 빌드한 정확한 바이트와 실제 파일이 같고 새 scoped 규칙이 포함됐다. 로그인 계좌의 렌더/쓰기 검증은 아니다. [실제 CSS 응답·연결](evidence/phase81-production/public-css-verification.json), [검증 스크립트](evidence/phase81-production/verify-public-css-script.txt), [대상별 빌드 해시](evidence/phase81-production/css-build-proofs.json).

최초 검증기는 두 배포의 CSS 이름/해시가 같다고 가정해 Pages entry에서 실패했으며 성공으로 기록하지 않았다. vite.config.js의 GITHUB_ACTIONS 설정은 Pages base를 `/yieldloom-app/`로 바꾼다. 실제 차이는3개 폰트 URL 접두사의42바이트였다. Pages 설정으로 타입 포함 빌드도 다시 수행해 실제 Pages CSS와 독립적으로 바이트 일치를 확인했고, 각 대상의 원래 바이트 해시로 검증기를 수정했다. 다운로드한 CSS를 정규화해 통과시킨 것은 아니며 제품 코드/설정·배포를 바꾸지 않았다. [첫 실패](evidence/phase81-production/public-css-first-failure.txt), [진단](evidence/phase81-production/css-base-investigation.json), [Pages 빌드](evidence/phase81-production/pages-build.txt).

두 운영 주소의 실제 익명 QQQI를1280/768/390px에서 열어 기존 의견 재전송 회귀도 확인했다. 사이트별18건의 POST는 전송 전에 모두 가로채 합성 응답/저장소에서 같은·원복 ID 보존과 변경한 본문/유형의 새 ID를 확인했다. 실제 공개 GET은 치환하지 않았고 추가 읽기·JS오류/넘침·실제 쓰기는0이었다. [Vercel](evidence/phase81-production/public-results-vercel.json), [Pages](evidence/phase81-production/public-results-pages.json). 기존 CA/프록시/TLS를 사용했다. 실제 의견 접수·로그인 계좌·고객PDF·운영 DB/권한 쓰기와 청구량은 검증하지 않았다.

최종20기기/9화면군의15개 운영 연결·5개 외부 인계/승인 상태는 그대로다. 기존14종과 겹치며 새 페이지/기기 생성이나 전체 시각 완료로 계수하지 않는다. 실제 로그인 계좌·고객PDF와 전체 native PNG/글꼴 수용은 미검증/미완료다. 시뮬레이터 공개PR 승인 차단을 유지한다. [화면별 잔여](REMAINING_USER_SURFACES_PHASE72.md). 이 운영 증거는 문서 전용 체크포인트로 추가 운영 배포를 만들지 않는다.
