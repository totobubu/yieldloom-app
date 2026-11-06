# 익명 의견 수정 재전송 운영 검증

2026-11-06, 기능 [#286](https://github.com/totobubu/yieldloom-app/pull/286)의 `02990db8132ba6c7f607f259e33261c99d59a888` → work `f162760133fc8040a6d76ee06c46f1f79398dbba` → 승격 [#287](https://github.com/totobubu/yieldloom-app/pull/287)의 main `160951854be8c74c81306bd20305eec79f364651` 순으로 반영했다. 두 실제 운영 release도 같은 main과 metadata `aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e`임을 확인했다. 기존14종의 종목 상세 보조 의견 폼 개선이며 새 시안이나 전체 리디자인 완료가 아니다.

## 적용과 동작 경계

Stitch `d33c8e06e86f4404a4b5388c7aa33e13`(프로젝트7356929996797649648) → `/stock/:ticker?tab=details` → StockFeedbackForm. 원본 HTML/PNG를 공식 MCP로 새로 읽어 해시를 확인했다. [구현·원본·로컬 검증](PHASE80_FEEDBACK_RETRY.md), [ID/경로/상태](evidence/phase80-production/source-route-state-map.json).

서버가 접수했지만 응답이 유실된 뒤 본문이나 유형을 바꾸면 이전 requestId로 중복 성공 처리되던 경로를 수정했다. 명시적으로 제출하는 내용이 바뀔 때 새 ID를 부여하고 같은 본문·임시 수정 후 원복 재시도는 ID를 유지한다. 입력 변경의 자동 요청·재시도나 영구 저장·로그는 없다. 기존 서버 중복 방지·권한·origin·횟수 제한·금융 데이터/계산/조회 계약을 유지했다. 이 변경은 기존 접수를 덮어쓰지 않고 변경된 명시적 제출을 별도 접수할 수 있게 한다.

## 검증과 병합

기능 [42215242683](https://github.com/totobubu/yieldloom-app/actions/runs/42215242683), work [42217680388](https://github.com/totobubu/yieldloom-app/actions/runs/42217680388), 승격 [42217905444](https://github.com/totobubu/yieldloom-app/actions/runs/42217905444), 최종 main [42221027876](https://github.com/totobubu/yieldloom-app/actions/runs/42221027876)의 앱/API/일반 브라우저/등록 브라우저가 모두 성공했다. [최종 main 상태](evidence/phase80-production/main-ci.json). 후보·실제 병합 tree `42097a68b4bcf8cdd25a505dbb75f19e39ae59cb`가 동일함을 확인했다. [후보](evidence/phase80-production/candidate-validation.json). 타입 포함 build·Node819·lint오류0/기존경고54 및3폭 합성24POST를 통과했다. 마지막 후속은 검사/문서만 수정했고 최종 head 전체 CI도 별도로 통과했다.

첫 기능CI의 기존 열 연결 확인란 Space 검사는 실패했다. 설치된 PrimeVue의 비동기 Select 닫힘/포커스 복귀와 검사 포커스의 경합을 지연 주입으로 재현하고, listbox 닫힘/실제 focus를 기다리는 검사만 보정했다. 제품 코드나 disabled·필수 확인·정확한 payload 검증을 완화하지 않았다. 당시 CI의 포커스 추적이 없어 역사적 원인까지 확정하지 않는다. CLI 로그 혼선과 진단 아티팩트403은 [원인 조사와 한계](PHASE80_FEEDBACK_RETRY.md)에 남겼고 서명 URL/권한/네트워크로 우회하지 않았다.

같은 입력·포커스·마우스·완료된 전환을 맞춘5상태×3폭 앱 전후15crop은 RGB차이0이다. 전체 native Stitch PNG/글꼴 일치 증명이 아니다. [전후 보존](evidence/phase80-feedback/visual-preservation.json).

최종 main 첫 일반 브라우저는 의견 검사를 통과한 뒤 기존 배당 차트768px의 resize 후 `.last().evaluate(activeElement)`에서30초 timeout으로 실패했다. locator는 보이는12월 버튼을 찾았지만 평가가 끝나지 않았다. [최초 상태](evidence/phase80-production/main-ci-first.json), [정확한 실패](evidence/phase80-production/main-browser-first-failure.txt). 차트와 해당 검사 파일은 이전 운영67a7b22 이후 변경하지 않았다. 같은 기준의 로컬 전체3폭·비활성·빈 자료는 통과했고, 기능/work/승격의 동일 앱 트리도 이미 통과한 상태에서 같은 main SHA의 실패 작업만1회 재실행했다. [로컬](evidence/phase80-production/dividend-navigation-after-main-failure.txt), [조사와 한계](evidence/phase80-production/main-browser-failure-investigation.json). 최종 성공을 당시 실행 문맥/브라우저 지연의 원인 규명이나 차트 결함 수정으로 표현하지 않는다. 시간·포커스 기준과 제품 코드를 완화하지 않았다.

## 실제 제공과 차단된 재전송 검사

[Vercel](https://yieldloom-app.vercel.app/)·[Pages](https://totobubu.github.io/yieldloom-app/)의 release commit과3개 공개 metadata 대상 해시를 대조했다. 이 해시는 전체 금융 이력/원장 완전성을 증명하지 않는다. [동기화](evidence/phase80-production/release-verification.txt), [최종 실제 응답](evidence/phase80-production/final-release-snapshot.json). Vercel `dpl_8KHFz7TKtN9ForgbmFEjda42YujK` READY, Pages [42221028048](https://github.com/totobubu/yieldloom-app/actions/runs/42221028048) 성공. [Vercel 기록](evidence/phase80-production/vercel-production.json). 최종 기능/work Preview의 실제 release도 확인했다. [Preview](evidence/phase80-production/preview-proof.json).

수정 전 실제 Pages 프런트엔드의 접수 응답 유실→수정 재시도에서 같은 ID가 나가는 실패를 기록했다. [수정 전](evidence/phase80-production/public-before-pages.json). 수정 후 두 사이트의 실제 익명 QQQI를1280/768/390px에서 열어 사이트별18건의 의견 POST를 **전송 전에 전부 가로채고**, 합성 응답/저장소로 동일·원복 ID 유지와 변경 본문/유형의 새 ID·정확한 저장 내용을 확인했다. 실제 공개 GET 데이터는 치환하지 않았다. pending잠금·성공 초기화·다크·추가 읽기0·JS오류/넘침0도 확인했다. [Vercel](evidence/phase80-production/public-results-vercel.json), [Pages](evidence/phase80-production/public-results-pages.json), [검증 스크립트](evidence/phase80-production/public-feedback-script.txt). Node의 기존 CA/프록시를 사용했고 TLS를 끄지 않았다. 실제 의견 접수·운영 DB 쓰기나 인증 계좌/PDF 종단 검증은 수행하지 않았다.

## 남은 원본 차이와 다음 범위

PC 공통 셸1170392357232825899도 공식 MCP로 새로 읽었다. 1280/1440/1600px에서 원본/앱 expanded 슬롯984px·collapsed1008px, 헤더 geometry가 맞는다. [무결성](evidence/phase80-production/shell-source-integrity.json), [치수](evidence/phase80-production/shell-measurements.json), [한계](evidence/phase80-production/shell-qualification.json). 과거 일반 ‘셸 폭 차이’를 모든 PC 화면의 현재 결함으로 재확정하지 않는다. standalone 콘텐츠 폭/열/줄바꿈은 남으므로 다음은 실제 셸 슬롯에 원본 콘텐츠를 조립하는 대조다. 존재하지 않는 합성 native 원본이 있다고 주장하거나 공통 폭을 임의 변경하지 않았다. 닫힌 PC·Tablet/Mobile 셸은 기존 캐시 HTML 대조이며 이번에 독립 MCP 재확인한 범위가 아니다.

종목 상세의 제목/공시/피드백/문자수/안내 글자 크기·행간과 Select/Textarea/버튼 높이·글자 크기8영역×3폭은 원본 치수와 맞는다. [선택 치수](evidence/phase80-production/detail-selected-measurements.json). font family/weight·전체 간격/PNG 수용은 아니며 과거 일반 글자 크기 실패를 현재 결함으로 반복 집계하지 않는다. 자산 카드1024열수·1280슬롯과 높이, 기타 콘텐츠 조립·상태/간격·미지원 금융 지표/원문 보관 권한·없는 상세 프레임은 여전히 남는다.

추가로 원본 자산 콘텐츠의 media viewport는 유지하고 main만984/708px로 제한한 탐색용 조립 측정을 했다. 1280px에서는 원본 카드296×324px/앱310.66×300px,1024px 원본3열의204×378px/앱1열708×284px이다.834/390px 원본 카드786/358px·앱766/338px로20px 차이도 남는다. 이는 padding/조립·반응형 열수 검토의 근거이며 실제 문구와 별도 native combined 프레임의 수용이 아니다. 독립 원본의284px 높이를 PC에 강제로 고정하는 것은 조립된 원본 줄바꿈도 훼손한다. [측정과 적용 한계](evidence/phase80-production/composite-card-qualification.json), [raw geometry](evidence/phase80-production/composite-card-raw-measurements.json), [읽기 전용 스크립트](evidence/phase80-production/composite-card-audit-script.txt). 기존 harness의 baseline 모드라 equality 검사는 꺼져 있고 일반 PASS 출력은 렌더 성공만 뜻한다. 이 탐색 결과만으로 제품 CSS나 시각 판정을 바꾸지 않았다. 1024px의 초기708px 제한은 과거 카드 폭을 main 폭으로 취급한 탐색 가정이었다. 실제 DOM의 main/ul은728px이고20px 들여쓰기 뒤 카드가708px였다. 따라서 이 초기1024 조립을 실제 셸 치수나 수용 근거로 쓰지 않으며 원자료는 기각한 가정으로 보존한다. [실제 래퍼 치수](evidence/phase80-production/asset-wrapper-audit.json). 후속으로20px는 부모의 일반 목록 규칙이 자식 루트 accounts의 padding0을 덮어쓰는 충돌임을 DOM/소스에서 확인했다. 별도 phase81에서 수정하며 이 main의 배포/시각 완료에 포함하지 않는다.

최종20개/9화면군은15개 운영 연결·5개 별도 인계/승인 상태 그대로다. 기존14종과 겹치며 이 동작 개선을 새 페이지나 전체 완료율로 세지 않는다. 실제 로그인 계좌·고객PDF·운영 원장 쓰기/청구량과 전체 native PNG/글꼴 일치는 미검증/미수용이다. 시뮬레이터 공개PR 승인 차단을 유지하고 새 PR이나 우회 게시를 하지 않았다. [화면별 잔여](REMAINING_USER_SURFACES_PHASE72.md). 이 기록은 문서 전용 체크포인트이며 추가 운영 배포를 만들지 않는다.

병합된 이번 원격 기능 브랜치만 검토한02990db head의 lease로 삭제했다. 로컬 활성 작업 공간·main/work·검증 문서 브랜치는 보존했다. [정리 범위](evidence/phase80-production/branch-cleanup.json).
