# 가져오기 검토 원본 헤더·폭 연결

최종 Tablet `5aa7a573854a46db9b106f89c09c4f23`, Mobile `6bd9777b8bea43b98aea8397a29f809a`의 HTML/PNG를 읽고 기존 검토 기능에 헤더·배지·단계·아이콘·콘텐츠/대화상자 폭을 연결한 **로컬 부분 구현**이다. 기존 거래/잔고 편집·필터·전체 행 저장·PDF 명의 확인·잔고 경고·금융 계산·원문 데이터와 권한을 유지했다. 별도 UnderlyingExplorerView.vue/DividendSimulatorView.vue는 수정하지 않았다.

고정 합성 6행과 같은 viewport/DPR2에서 [측정](evidence/phase39/measurements.json), [Tablet 원본 HTML](evidence/phase39/source-834.png)/[구현](evidence/phase39/implementation-834.png), [1280 원본 HTML](evidence/phase39/source-1280.png)/[구현](evidence/phase39/implementation-1280.png), [Mobile 원본 HTML](evidence/phase39/source-390.png)/[구현](evidence/phase39/implementation-390.png)을 보존했다. 헤더 높이는 1280/834/768에서217px,390에서181.5px로 변경 없는 원본 HTML과 같다. 치수 동일성을 캡처에서 단언한다. Mobile 원본 배지의 실제 line-height20px를 읽어 적용했으며 임의 고정 헤더 높이를 넣지 않았다. 추가 실제 계좌 이름은 DEMO이며 길이가100자를 넘는 합성 이름도 숨기지 않고 줄바꿈되는지 검사했다.

실제 앱 검토 대화상자의320/360/390/430/768/1024/1201/1280 콘텐츠 폭288/328/358/358/720/834/834/834px와 페이지 넘침 없음을 검사한다. Tablet 원본 PNG 물리폭2560px는834 CSS viewport가 아니다. 원본 HTML은1024px부터7:5 두 컬럼이고834px에서는한 컬럼이므로 그 규칙을 따른다. 표는 원본처럼 내부 가로 스크롤로 원문/금액 열에 접근한다. 이와 충돌하던 옛 데스크톱 무스크롤 단언2개를 내부 스크롤 단언으로 바꾸고, 바깥 넘침·행ID·수정/저장 검증은 유지했다. max834에서 4개 요약 카드를 유지하니 큰 건수가 넘쳤고, 이를 실제 콘텐츠 폭에 맞는2열로 수정해8개 폭에서 검사했다.

sync_alt/cloud_sync/swipe는 기존과 같은 Google Material Symbols commit10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7의 원본24px SVG이며 기존Apache2 라이선스를 따른다. Tablet 원본의 텍스트 글꼴 URL `https://fonts.googleapis.com/css2?family=Inter,+'Pretendard',+'Apple+SD+Gothic+Neo',+sans-serif:wght@100..900&display=swap`은HTTP400이었다. Material Symbols URL은200,Mobile 캡처는 리소스 실패0이다. Tablet fallback HTML 렌더링/헤더 치수를 원래 PNG 전체와 일치한 것으로 취급하지 않는다.

**전체 화면 시각 승인은 미완료다.** 통화별 매수/매도/입금/출금·순입출금 패널, 검토 요약 진행률, 일반 CSV의 모바일 거래 카드와 원문 인스펙터/예시 가이드, 최종 동의·저장 카드 배치가 남아 있다. 기존4개 요약·배당 차트와 작동하는 입력/필터는 보존했다. 시안의 정상100%·가상 수치/고유번호·누락통화를 실제 검토 결과로 만들지 않는다. `amount`의 원문 거래금액을 세전/세후/실지급 배당으로 바꾸지 않았고 새 금융 합계를 추가하지 않았다. 실제 지원 상태/원문이 없는 기능을 동작한다고 표시하지 않는다.

검증:5개 폭·다크·헤더 포커스·검색/필터 중 전체6행 유지·busy/저장 차단·긴 계좌명·API0회. 실제 Memory API의 portfolio-import-review는4716행/24분할 및 화면 밖 수정까지 전체 검증/저장하며 편집 요청0·8개 폭 밝음/어두움 검사가 통과했다. mobile-import-feedback 밝음/어두움 오류 보존/재시도(원장 쓰기0), manual-holdings, broker-spreadsheet, portfolio-enhancements, asset-management도 통과했다. lint오류0/기존경고54,Vue타입 검사·빌드 통과. 실제 로그인 계좌/PDF는 실행하지 않았다. 원격CI·Preview·운영은 별도 확인하며 이 부분 구현을 전체2종 완료로 세지 않는다.
