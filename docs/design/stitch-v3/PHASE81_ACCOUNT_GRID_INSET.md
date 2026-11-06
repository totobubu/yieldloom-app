# 자산 카드 목록의 중복 들여쓰기 제거

원본 `b611bd07ed0c464581479140b9207afb`(프로젝트7356929996797649648) → `/mypage?tab=assets` → FamilyPortfolioView의 AssetAccountList 목록에 적용한다. 공식 MCP로 HTML/PNG를 새로 읽어 기존 해시와 일치함을 확인했다. [무결성](evidence/phase81-account-inset/fresh-reference-integrity.json), [경로·전후 측정·범위](evidence/phase81-account-inset/scope.json). 기존14종 자산 관리의 CSS 수정이며 새 시안/기기/페이지가 아니다.

## 원인과 수정

자식의 `.accounts` 목록은 padding0이지만 부모의 scoped `.portfolio-tabs ul`은 자식 루트 ul에도 적용되어 왼쪽20px를 다시 넣고 있었다. 그래서 카드가 목록 시작점에서 밀리고 전체 카드 공간이20px 줄었다. 일반 목록 들여쓰기 규칙에서 `.accounts`만 제외했다. 카드 내용·선택·별칭·역할/유형·명의자·보유/통화·출처 미지원 상태와 셸/열수는 바꾸지 않았다. API·권한·금융 계산·데이터·의존성 변경은 없다.

기존 전체 앱 통합 테스트에 첫/마지막 카드가 그리드 양 끝에 정렬되는 검사를 추가했다. 수정 전1280px에서 시작점 검사가 실제 실패했고 수정 후1280/768/390px가 통과했다. 패딩 구현값을 강제로 대입하거나 더미 계좌를 실제 계좌로 취급하지 않았다. 기존 별칭 입력 포커스·명의자 범위 통화/미확인·viewer 권한·미지원 출처 버튼·분석 KPI/상세·추가 조회/쓰기 방지 검사도 그대로 수행했다. [수정 전 실패](evidence/phase81-account-inset/before-alignment.txt), [수정 후 전체 통합](evidence/phase81-account-inset/after-alignment.txt).

## 원본 대조와 한계

|viewport|독립 원본 카드 폭×높이|수정 전|수정 후|남은 차이|
|---|---|---|---|---|
|1280|394.66×284|310.66×300|317.33×300|실제 셸과 콘텐츠 조립/문구·줄바꿈 차이|
|1024|309.33×300,3열|708×284,1열|728×284,1열|좁은 셸 슬롯의 기존 안전한1열 유지,3열 수용 아님|
|834|786×284|766×284|786×284|전체 글꼴·PNG·실제 계좌 상태 미수용|
|390|358×284|338×284|358×284|전체 글꼴·PNG·실제 계좌 상태 미수용|

단일 반응형 HTML을4폭에서 측정한 것이며4개의 별도 native 시안을 생성/확정한 것은 아니다. [전후 원자료](evidence/phase81-account-inset/after/geometry.json). baseline 측정 모드의 일반 PASS 출력은 렌더 성공만 뜻한다. 별도로 JSON에서 이름/기관/역할/유형 font·line, 이름 weight, 카드 padding/radius, 도구 높이, snapshot padding과 넘침0을 원본과 대조했다. 전체 원본 PNG/글꼴 일치나 PC 카드의284px 고정 높이 적용 근거로 사용하지 않는다. 이전 독립 원본과 실제 셸 조립의 차이는 이 수정으로 덮어쓰지 않는다.

첫 locator 캡처에서는 고정 하단 메뉴가 Mobile 카드 도구 일부를 가려 검수 이미지로 쓰지 않았다. 카드를 viewport 중앙에 놓고 전후4폭을 다시 촬영했고 원본/앱 geometry JSON의 모든 행은 그대로임을 확인했다. [촬영 조건과 한계](evidence/phase81-account-inset/capture-normalization.json), [같은 합성 자료의 촬영 스크립트](evidence/phase81-account-inset/centered-capture-script.txt). 제품 CSS나 기능은 추가 변경하지 않았다.

타입 포함 [빌드](evidence/phase81-account-inset/build.txt)·[Node819](evidence/phase81-account-inset/node-summary.txt)·[lint오류0/기존경고54](evidence/phase81-account-inset/lint.txt)를 통과했다. 위 측정과 통합 검사는 합성 계좌/메모리 서비스이며 실제 로그인 계좌·고객PDF·운영 DB 쓰기 검증은 수행하지 않았다. 이 문서는 로컬 구현 시점 기록으로 원격 CI·Preview·운영 제공 완료를 주장하지 않는다. 최종 제공은 해당 PR의 후속 운영 근거와 실제 release를 따른다. 시뮬레이터 공개PR 승인 차단은 유지한다.
