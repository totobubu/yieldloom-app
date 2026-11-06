# 자산 카드 라이트 팔레트와 hover 보정

Stitch `b611bd07ed0c464581479140b9207afb`(프로젝트7356929996797649648) → `/mypage?tab=assets` → AssetAccountList의 라이트 스타일을 보정했다. 공식 MCP로 HTML·PNG를 다시 읽어 기존 해시와 일치함을 확인했다. [무결성](evidence/phase82-account-palette/fresh-reference-integrity.json). 기존14종 자산 관리의 후속이며 새 시안·기기·페이지가 아니다.

본문 `#191c1e`, 보조 표기 `#6e7977`·`#3e4947`, 자료 배경 `rgba(242,244,246,.6)`, 역할·선택 배지와 별칭 버튼의 기본/hover 색상을 원본에 맞췄다. 선택하지 않은 카드의 hover에서 기본 PrimeVue 색상이 다시 적용되던 부분도 카드 안에서 제한했다. 원본처럼 선택 배지의 배경만 바뀌고 헤더 배경은 투명하게 유지한다. 기존 클릭 영역·키보드 포커스·disabled 동작은 그대로다.

공통 테마 프리셋을 바꾸지 않고 컴포넌트 전용 변수를 썼다. 별칭 버튼은 설치된 PrimeVue4.5.3의 secondary 디자인 토큰을 사용한다. [공식 Button 문서](https://v4.primevue.org/button/). Vue3.5.25·Vite7.2.7이며 [컴파일 범위와 script/template 해시](evidence/phase82-account-palette/scope-proof.json)로 조상 `:root:not(.p-dark)`와 컴포넌트 scoped 노드에만 규칙이 적용되는지 확인했다. 전역 root에 토큰을 선언하는 규칙은 없다.

JavaScript와 template은 기존 운영 dcc2c05와 해시가 같다. 이름·기관·별칭·권한/유형·통화/보유·기준일·미확인·0의 의미를 보존한다. 원본의 PDF·정상/추정 문구나 금액을 실제 계좌에 복사하지 않았고, 출처 원본 미지원·권한 없는 별칭 변경은 계속 native disabled다. API·금융 계산·데이터·의존성·조회/쓰기 흐름을 변경하지 않았다.

## 확인한 범위

1280/834/390px에서 원본의 owner/editor/viewer와 같은 조건의 합성 컴포넌트를 대조했다. 기본 색상180개·선택 hover27개·별칭 hover6개, 총213개의 선택된 computed 속성이 일치했다. 합성9종의 font/line/padding/폭/높이, 카드 밖 secondary 버튼의 라이트/다크 색상은 수정 전과 같다. 다크9종의 기록된 스타일과 owner 카드3개 RGB도 같다. [측정과 보존](evidence/phase82-account-palette/verification.json), [원본/전후 스크립트](evidence/phase82-account-palette/palette-audit-script.txt), [비교기](evidence/phase82-account-palette/compare-script.txt).

검증 HTML의20px 패딩은 실제 서비스 셸 조립을 대신하지 않는다. 별도 전체 앱 고정 fixture의1280/1024/834/390px 카드 치수는 이전 phase81 기록과 모두 같았다. [전체 앱 치수 보존](evidence/phase82-account-palette/full-app-preservation.json). PC317.33×300px·3열/1024px728×284px·1열과 원본의 조립·열수 차이는 해결했다고 표시하지 않았다.

기존9종×3폭의 계좌 선택·rename ID·권한/unknown·disabled·busy·다크·0/결측 보존·API0 검사가 통과했다. [기능](evidence/phase82-account-palette/functional-final.txt). 전체 앱1280/768/390px의 명의자/통화·viewer·별칭 입력 포커스·기존 비교/분석/캘린더 흐름도 통과했다. [전체 앱](evidence/phase82-account-palette/priority.txt). 타입 포함 [빌드](evidence/phase82-account-palette/build-verified.txt)·[lint오류0/기존경고54](evidence/phase82-account-palette/lint.txt)를 확인했다. 실제 계좌/고객PDF·서버 쓰기 검증은 아니다.

## 검증 중 교정한 사항과 남은 범위

초기 기준 HTML은 생성 캐시 URL을 고정해 Vue/PrimeVue 모듈404로 렌더되지 않았다. 최종 비교기는 실제 로컬 entry에서 버전이 붙은 모듈 URL을 읽고 사용한다. 중간 selector 컴파일과 다크 상속색 비교에서 발견한 범위/색상 변화도 교정한 뒤 최종213속성·다크 RGB·외부 컨트롤 검사를 통과했다. 실패한 중간 렌더를 수용 근거로 쓰지 않았다. [기록과 교정 범위](evidence/phase82-account-palette/verification-notes.json), [초기 진단](evidence/phase82-account-palette/baseline-probe.json).

단일 반응형 원본 HTML의3폭 재렌더이며 별도 native3장을 생성한 것이 아니다. 원본/합성 자료의 문구·권한, 카드 opacity·disabled 표현과 일부 금융 상태, 전체 폰트/픽셀은 동일하다고 판정하지 않았다. 원본 다크 프레임은 없으므로 다크는 기존 화면 보존 검증이다. PC 조립/패딩·열수·전체 native PNG/글꼴·실제 로그인 계좌와 고객PDF는 계속 미검증/미수용이다. 시뮬레이터 공개PR 승인 차단을 유지한다.

이 문서는 로컬 구현 시점 기록이다. 원격 CI·Preview·실제 운영 제공 완료는 후속 운영 기록과 실제 release를 따르며, 이전 [phase81 운영](PHASE81_PRODUCTION.md)을 이번 배포 증명으로 사용하지 않는다.
