# 계좌 카드와 배당 차트 포커스 운영 확인

2026-11-06, #284의 기능 head `c2c5818d86acf94b6ba2338405a5069557d4ee5e` → work `26b211e5f948a10093d6a04f803e65914c2080de` → [#285](https://github.com/totobubu/yieldloom-app/pull/285)의 main `67a7b2214c2678dea90b46a70e5e8c3303fd0966` 순으로 반영했다. 실제 Vercel·Pages 제공 커밋도 `67a7b2214c2678dea90b46a70e5e8c3303fd0966`이고 metadata SHA256은 `aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e`이다. 두 기존 화면의 일부 개선이며 새 시안2개나 전체 리디자인 완료가 아니다.

## 원본과 적용 범위

| 원본 / 경로 | 확인된 개선 | 남은 차이 |
| --- | --- | --- |
|b611bd07ed0c464581479140b9207afb / `/mypage?tab=assets`|명의자/기관/권한 묶음·실제 역할/유형 이름·36px 도구·16px SVG·20px Mobile 패딩; Tablet834/Mobile390 카드284px|1024px 원본3열/구현1열(976/708px 슬롯),1280px 카드394.66/310.66px·높이284/300px. 전체 native PNG/글꼴·실제 계좌 상태 미수용|
|bd619d24ceb74c92afad1787a364ab4b / `/stock/:ticker?tab=dividends`|화면 폭 변경 뒤 같은 활성 월이 보이도록 해당 차트만 가로 스크롤; 비활성 위치/초기 월/선택/집계 유지|전체 native PNG/글꼴·누락 상세 프레임 미수용|

[카드 원본·전후 측정·27개 합성 상태](PHASE79_ACCOUNT_CARDS.md), [포커스 재현·왕복·빈 자료/해제·전후 보존](PHASE79_FOCUSED_RESIZE.md), [ID→경로·폭·상태](evidence/phase79-production/source-route-state-map.json). 카드 원본은 MCP HTML/PNG 새 읽기·해시 확인을 수행했다. 단일 반응형 HTML의4폭 재렌더는4개의 별도 확정 native 프레임이 아니다. 차트 idle4폭 앱 전후 RGB차이0도 전체 원본 PNG 일치가 아니다.

## 병합과 검사

기능 [42200815763](https://github.com/totobubu/yieldloom-app/actions/runs/42200815763), work [42203234306](https://github.com/totobubu/yieldloom-app/actions/runs/42203234306), 승격 [42203281041](https://github.com/totobubu/yieldloom-app/actions/runs/42203281041), 최종 main [42206667537](https://github.com/totobubu/yieldloom-app/actions/runs/42206667537)의 앱/API/일반 브라우저/등록 브라우저4개 작업이 모두 성공했다. 이 문서의 원격 검증은 작업 상태와 해당 workflow의 실행 범위를 근거로 하며, CLI 로그 추출에서 누락된 개별 PASS 수를 만들어 세지 않았다. [상태 원문](evidence/phase79-production/main-ci.json).

최신 main 자동 콘텐츠 갱신 f1b1cb2의4개 Content Studio JSON을 보존한 후보 tree `bb3537521d48d684307e2924f0341f3c5fe52079`에서 타입 포함 build와 Node819/819를 통과했다. GitHub 병합 후보와 실제 main 트리가 이 값과 같음을 확인했다. [후보 검증](evidence/phase79-production/main-candidate-validation.json), [Node 요약](evidence/phase79-production/candidate-node-summary.txt), [빌드](evidence/phase79-production/candidate-build.txt). 첫 Node 호출은 source cwd였으므로 그 결과를 후보 cwd 근거로 쓰지 않고 정확한 후보 작업 공간에서 다시819개를 확인했다.

첫 기능 CI의 등록 Chromium 설치12분 초과와, 재실행에서 발견한 이전 접근성 이름4개는 [통합 기록](PHASE79_INTEGRATION.md)에 남겼다. 네 전체 exact 이름을 새 명의자/역할/유형으로 갱신했고, 합성 PDF+Memory API의 본인/가족 수동·문서 등록→검토→저장·오류/재시도·4폭×2테마를 통과했다. 실제 고객 PDF가 아니다.

work 첫 브라우저 실행은 변경하지 않은 장부 목록 시간 검사에서30,392ms가20,000ms 기준을 넘겨 실패했다. 같은 로컬 검사도20,736ms 실패/18,624ms 전체 통과를 보였다. 기준을 완화하거나 제품 코드를 바꿔 우회하지 않고 같은 work head의 실패 작업만1회 재실행해 전체 성공을 확인했다. 느려진 근본 원인은 미확정이다. 추가 대조용 과거 UI 실행은 합성 화면 초기화에서 실패해 기준 성능 근거로 쓰지 않았다. [최초 실패](evidence/phase79-production/work-browser-timing-failure.txt), [파일 해시와 조사 한계](evidence/phase79-production/ledger-timing-investigation.json). 재실행 성공을 원인 규명이나 안정적인 성능 보장으로 표현하지 않는다.

## 실제 운영 확인

[Vercel](https://yieldloom-app.vercel.app/), [Pages](https://totobubu.github.io/yieldloom-app/)의 실제 release commit·3개 metadata 대상 해시를 확인했다. 이 해시는 전체 금융 이력/공급자 자료의 완전성 증명이 아니다. [release 동기화](evidence/phase79-production/release-verification.txt), [마지막 실제 응답](evidence/phase79-production/final-release-snapshot.json). Vercel production ID `dpl_A9C9cNGmLBbpKDryE9snAbHftoF3`는 READY이며 [배포 기록](evidence/phase79-production/vercel-production.json), Pages [42206666240](https://github.com/totobubu/yieldloom-app/actions/runs/42206666240)도 성공했다.

실제 익명 QQQI 자료를1280/834/768/390px에서 읽고 처음 키보드로 고른 마지막 월이 크기 변경 후 재포커스 없이 계속 활성/가시 상태임을 확인했다. Mobile의 scrollLeft286·활성 월 x306~354px/clip right354px, 연도·24개월·다크·제목20/28px·224px플롯·144px막대·24/20px패딩, 각 사이트 최초 읽기2/추가0·JS오류/가로넘침0을 확인했다. 분석 POST는 전송 전에 차단했고 모든 실제 쓰기는0이다. [Vercel](evidence/phase79-production/public-results-vercel.json), [Pages](evidence/phase79-production/public-results-pages.json). Node의 기존 CA/프록시 HTTPS를 Chromium에 전달했으며 TLS 검증을 끄거나 합성 금융 값으로 치환하지 않았다.

자산관리 카드는 실제 인증 계좌에 접근하지 않았다.27개 컴포넌트 상태와 전체 앱의 합성 등록·권한/통화 흐름 검사이며 실계좌 운영 종단 검증과 구분한다. 실제 계좌·고객PDF·운영 DB 쓰기/청구량 및 전체14종·최종20기기 시안의 native PNG/글꼴 수용은 미검증/미완료다. 파일 원문 보존/권한 계약·미정 금융 지표·없는 상세 프레임과 시뮬레이터 공개PR 승인 차단은 그대로다.

[이전 운영 기록](https://github.com/totobubu/yieldloom-app/blob/bd861289bbbc15e0579d887d5d62c313669d27ae/docs/design/stitch-v3/PHASE78_PRODUCTION.md), [화면별 잔여](REMAINING_USER_SURFACES_PHASE72.md). 이 운영 근거는 문서 전용 체크포인트이며 별도 운영 배포를 만들지 않는다.
