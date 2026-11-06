# 정상 차트 시세 재조회 복원

로컬커밋0595acfaf8496575da1cc849d7deea66235c365f, base08b2c2a47a023d9ccb3e0140aaf49c5fb13ceee6, branch fix/stitch-price-refresh-phase72. 소스/전용회귀2개 파일만 포함. clean tree·쓰기중단·원격push/PR/병합/배포미실행.

원본 project7356929996797649648 / screen87cd200796914464b7613003247de771 HTML792–795의 정상차트 아래/시세이력 앞 재조회행을 복원. sourceHTML해시는 reference.json에서 mapping과 대조. 원본30px 버튼·12px/500·radius8·좌우10px을3폭에서같은HTML렌더로대조했다. 버튼폭117.046875 대 원본117px의subpixel차이는남겼고 임의폭상쇄없음. 전체nativePNG/원본상태전수/실제공급자·계좌·PDF는미검증.

새행은error가없을때표시되며초기/재조회loading중disabled/aria-busy이다. 정상버튼은 !loading && load(true)만호출. 동일tick의두click도두번째요청을막고, watch의합법적인종목전환load는막지않음. 기존error의다시시도분기/handler, load·stockPrices·publicJson/API/금융계산본문은변경하지않음. 원문도우미문구와차트다음행구조를유지하며새달력/상세팝업을만들지않음.

final.log 및 final/results.json:1280/768/390 각각 초기자동1·정상/재시도4·종목전환자동1=합성HTTP6회. cache순서 no-store/reload/reload/no-store/reload/reload, 모든signal보존, staleA refreshabort/늦은A응답B오염0. 기존캐시read/진행중shared-read/동일tickdoubleclick/disabledclick/기간·봉주기·테마변경추가조회0. 768Enter와390다크(transition완료후배경20,32,51/문자179,192,209/높이30)도검사. 브라우저강제캐시reload를검증했을뿐서버캐시우회/실제시장최신성/공급자호출량·과금으로표현하지말것.

price-events.log:기존3폭실제날짜/0/미확인/분할·종목격리/공유1read통과. price-calendar.log:1440/768/390/360 및stale/empty모두통과. stock-prices-unit.log:6/6. type-check-final.log, lint-final.log(기존속성순서4경고/오류0), prettier-final.log통과. 전체build는root요청으로통합후수행.

초기before.log는정상버튼count0/초기조회1의실제회귀baseline. first-geometry-attempt.log는전역studio-shell p-button min-height44가신규30규칙과충돌한실패로, 해당버튼의scoped선택자우선순위만고쳐통과. theme-transition-attempt.log는클래스변경직후white→dark CSStransition초기값을읽은진단이므로소스색상결함으로세지않으며, test에서WebAnimations종료후측정하도록정정.

전용CI명령: UI_BASE_URL=http://127.0.0.1:5175 node tests/stock-price-refresh.browser.mjs (CHROMIUM_PATH는기존CI환경사용). PRICE_REFRESH_EVIDENCE_DIR설정시3폭 source/implementation+dark스크린샷·results.json저장. 임시고유HTML은wx생성/finally삭제로동일worktree직렬실행. Vite5222는재검증용으로실행중.
