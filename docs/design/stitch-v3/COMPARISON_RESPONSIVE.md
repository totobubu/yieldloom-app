# 유사·테마 비교의 태블릿·모바일 적용

범위는 `UnderlyingExplorerView.vue`의 유사·테마 비교와 전용 표현 컴포넌트 `ResponsiveComparison.vue`다. 기준 커밋은 `28791fa`, 작업 브랜치는 `feat/stitch-comparison-responsive-20261105`다. 다른 작업자의 업로드·저장 결과·시뮬레이터 파일은 수정하지 않았다. 코드와 합성 검증을 완료했으며 **전체 픽셀 일치 수용·실데이터 검증·운영 배포는 완료하지 않았다.**

## 원본 확인

공식 Stitch MCP `https://stitch.googleapis.com/mcp`에서 `tools/list`, `tools/call`의 `get_screen`, `download_file`을 읽기 전용으로 호출했다. 기존 `STITCH_API_KEY` 런타임 바인딩을 사용했으며 키를 출력하지 않았다. 다음 네 HTML은 MCP 재다운로드 바이트와 저장소의 원본 바이트가 모두 일치한다.

| 화면      | 기기   | 공식 최종 ID                       |
| --------- | ------ | ---------------------------------- |
| 유사 비교 | Tablet | `77fdbd798a3941c68f098120a210c44d` |
| 유사 비교 | Mobile | `2476bb94e3174e6182500d8f520a6424` |
| 테마 비교 | Tablet | `12bcd42390bb468eb1700a909aec3f5d` |
| 테마 비교 | Mobile | `4dbfbf717c75483e88e6d1186ecbdb2b` |

화면 메타데이터 제목의 V10 A11Y 표기와 실제 HTML `<title>` 버전 표기는 다를 수 있다. 이것은 본문이 변경됐다는 증거가 아니다. PNG도 공식 MCP에서 내려받았으며 물리 픽셀 크기는 CSS viewport로 사용하지 않았다. SHA-256·공식 리소스 이름·실측 결과는 [검증 기록](evidence/comparison-responsive-20261105.json)에 보존했다. 원본 HTML은 변경하지 않았다.

## 구현

- 1024px 이하에서 유사·테마 화면만 전용 표현을 사용한다. 641~1024px는 가로 스크롤 지표 행 비교표, 640px 이하는 종목별 카드다. PC와 기초자산별 비교는 기존 표현을 유지한다. 미디어 쿼리 이벤트는 해제하며 viewport 변경 시 부모의 필터·자료 상태를 유지한다.
- 원본의 2열 종속 필터, 검색, 통화 표시, 테마 설명과 근거, 분석 인사이트 3개와 주의 안내, 최대 3개 비교 트레이를 구현했다. 기존 전략·방향·배당·주기 옵션과 상위 선택 시 하위 초기화를 재사용한다. 상품명 검색은 이미 받은 목록에서 수행한다.
- 기존 수익률·운용 보수·가격 하락·기간·추정 여부·공식 연결 출처는 펼침 영역에 보존했다. 전체 페이지 명시 조회와 선택 트레이 조회를 제공한다. 부분 조회 후 조회하지 않은 종목을 미확인으로 바꾸지 않는다. 무배당·미확인·관측된 0을 구분하며 본주에 ETF 보수를 적용하지 않는다.
- 원본의 공유는 현재 링크와 조건을 클립보드에 복사한다. 링크가 필터를 복원한다고 안내하지 않는다. 저장은 공개 비교 조건 JSON의 로컬 다운로드이며 자동 복원은 미지원이라고 명시한다. API/DB 쓰기는 추가하지 않았다.
- 테마 원본의 USD 고정·가상 종목·가상 편입 관계를 실제 자료에 대입하지 않았다. 종목별 원문 통화를 유지하고 환산하지 않는다. 원본의 분배율·연속성 영역은 자료 미제공·산출 보류·연속성 미검증으로 남긴다.
- 원본의 Pretendard 1.3.9 변수 폰트를 OFL 라이선스와 함께 자체 호스팅하고 기존 로컬 Inter를 사용한다. 별도 `Comparison Pretendard`/`Comparison Inter` 패밀리로 등록해 PC와 다른 화면의 글꼴을 변경하지 않는다. Pretendard 파일은 약 2.06MB이며 이 표현이 사용하는 경우에만 브라우저가 읽는다.

## 수행한 검증

- `npm run lint:check`: 오류 0, 기존 범위 경고 54개. 변경 파일 대상 ESLint는 오류·경고 0.
- `npm run type-check`, `npm run build`: 통과. 기존 큰 vendor 청크 경고가 있다.
- 비교 분류·연결·수익률 관련 Node 테스트 13개 통과: `comparison_groups`, `security_underlyings`, `rival_comparison`.
- `tests/comparison-responsive.browser.mjs`: 1280/1024/834/768/640/390/320px × 유사·테마 14상태 통과. 태블릿 표/모바일 카드, 2열 44px 필터, 전체 페이지 넘침 없음, 종속 초기화, 로컬 검색/빈 결과, 명시 조회 전 무요청, 트레이 최대 3개·부분 조회·미조회 상태 보존, 0/미확인, 혼합 통화, 본주 보수 비적용, JSON 다운로드·조건 복사, 키보드 Escape, 다크 표시, viewport 전환을 합성 자료로 확인했다. 디렉터리는 최초 1회이며 필터·검색은 추가 조회가 없다.
- `tests/stitch-comparison-results.browser.mjs`: 기초자산/유사/테마 × 1280/768/390px의 기존 9상태 지표 검증 통과. 표시된 종목마다 명시적 가격 조회 1회, 개인계좌 요청·쓰기가 없음을 유지한다. 새 태블릿 비교표와 펼침 영역에 맞춰 검사 대상을 조정했다.
- `tests/stitch-priority-panels.browser.mjs`: 3폭 통과. 참고 ETF 변경이 필터 결과와 조회 수를 바꾸지 않고 선택 초점을 유지한다. 다른 기존 자산관리 검사도 통과했다.
- `tests/stitch-content-width.browser.mjs`: 기존 3종 콘텐츠 프레임 계약 × 4폭 통과.
- `scripts/design/capture-responsive-comparison.mjs`: 834/390px의 공식 원본과 구현을 별도 캡처·실측했다. 유사 Tablet/Theme Tablet 필터 폭은 각각 362/370px, Mobile 유사 필터 폭은 157px이며 높이 44px·두 열·8px 반경이 맞는다. 제목은 유사 Tablet 30/38px, Mobile 20/28px, 테마 두 기기 24/32px다. 모바일 카드 본문 폭 358px가 맞는다.
- 원본 브랜치를 별도 로컬 서버로 실행해 합성 자료로 비교했다. PC 유사·테마 1280px와 기초자산 390px의 변경 전후 PNG SHA가 각각 완전히 같다. 해시는 검증 기록에 있다.

재현:

```sh
# 각 명령은 로컬 Vite 서버를 대상으로 한다.
UI_BASE_URL=http://127.0.0.1:5175 node tests/comparison-responsive.browser.mjs
UI_BASE_URL=http://127.0.0.1:5175 node tests/stitch-comparison-results.browser.mjs
UI_BASE_URL=http://127.0.0.1:5175 node tests/stitch-priority-panels.browser.mjs
UI_BASE_URL=http://127.0.0.1:5175 node tests/stitch-content-width.browser.mjs
UI_BASE_URL=http://127.0.0.1:5175 COMPARISON_BASELINE_URL=http://127.0.0.1:5176 node scripts/design/capture-responsive-comparison.mjs
```

최초 작업 트리의 node_modules 심볼릭 링크가 원래 저장소를 가리켜 Vite 개발 서버가 글꼴 파일에 403을 반환했다. 테스트 전용 설정에서 `/workspace` 읽기를 허용한 별도 서버로 재검증했으며 프로젝트 Vite 설정은 수정하지 않았다. 최종 캡처의 글꼴 로딩 성공과 자산 오류 0을 기록했다. 개발 환경 자산 403을 운영 장애로 해석하지 않는다.

## 남은 차이와 미검증

**전체 시각 수용은 아직 미완료다.** 치수 일부 일치와 동작 통과를 전체 픽셀 일치로 표현하지 않는다.

- 가상 종목 3개·가상 수치·공통 예시 기준일 대신 실제 목록·각 지표의 기준일·미확인 상태를 표시한다. 항목 수와 긴 이름·통화·안내 문구가 달라 전체 높이·행 높이가 원본과 같지 않다. 현재 합성 캡처의 유사 모바일 카드 높이는 원본 306.5px 대 구현 393px이며, 추가 원문 기준일과 기존 지표 펼침 영역이 포함된다. 테마 카드도 원본 290~294px 대 구현 365px다. 이는 동일 데이터의 픽셀 비교가 아니다.
- 기존 지표를 보존하는 추가 펼침 영역과 실제 선택 체크박스가 있다. 원본의 작동하지 않는 보유 비중/섹터/현금흐름 가상 탭을 실제 데이터가 존재하는 것처럼 만들지 않고 기존 기초자산·유사·테마 내비게이션으로 연결했다. 따라서 탭 문구·영역 구성에 차이가 있다.
- PrimeVue/PrimeIcons와 원본 Material Symbols의 아이콘 모양, 일부 기본 버튼·테두리·타이포그래피의 픽셀 차이가 남아 있다. Tablet HTML 일부의 fontFamily 값은 전체 문자열 하나가 따옴표에 묶여 실제 Inter/Pretendard를 사용하지 않는 원본 결함이 있으며, 구현은 유효한 폰트 패밀리와 실제 로컬 폰트를 쓴다.
- 실제 전체 시장 자료의 완전성, 실제 개인계좌/PDF, 실기기 보조기술·브라우저 전체 조합, 운영 URL·배포는 이 범위에서 검증하지 않았다. Firebase/Firestore 실청구량도 측정하지 않았다.
- 새 전용 브라우저 검사는 로컬에서 수행했다. CI 워크플로 파일은 다른 통합 작업과의 충돌을 피하려고 수정하지 않았으며 통합자가 새 명령을 CI에 추가할 수 있다.
