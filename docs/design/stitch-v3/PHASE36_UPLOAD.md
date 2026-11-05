# 파일 업로드 진행 및 검증 경계

원본은 최종 Tablet `3c2a0d37b5f54a63b3a633f01f0d2b33`, Mobile `80b06442816e4d1baebc96cb520b19d6`이며 기존 HTML을 변경하지 않았다. 새 헤더·단계·거래/잔고 라디오·파일 카드·규격·암호 상태·대상 계좌·미리보기 구역을 기존 기능에 연결했다. 수기 입력 버튼은 기존 수기 입력 경로로 이동한다. 별도 Simulator/Tax 파일은 변경하지 않는다.

기존 형식 선택·조회 종료일/잔고 기준일·본인 자료 확인·오류/재시도·표준 샘플/도움말·파일 제거·PDF 암호와 계좌 소유자 제한을 유지한다. 최대 파일/행/열·분할 저장·검증·권한·금융 계산과 API 호출 시점을 변경하지 않는다. 일반 XLSX는 첫 시트만 처리하므로 시안의 다중 시트 자동 인식 주장은 구현했다고 표시하지 않는다. PDF를 선택하면 기존 비밀번호·변경/삭제·기본 암호화 저장이 나타나고, CSV/XLSX는 실제 지원 상태를 안내한다.

**로컬 작업이며 운영 반영/전체 시각 승인이 아니다.** 시안은 추출된 가상 142행·3행 미리보기 상태다. 현재 기존 흐름은 사용자가 추출·미리보기를 눌러 다음 검토 화면으로 이동한다. 이를 자동 추출/새 API로 바꾸지 않았다. 미리보기 영역은 명시적으로 검토 화면에서 제공한다고 표시하며, 원문 행·통화·금액·인식 행수·소유권 검증을 조작하지 않는다. 체크박스는 사용자의 자료 대상 확인일 뿐 금융기관 인증 완료를 뜻하지 않는다. 즉시 미리보기 표는 구현 미완료로 남긴다.

Mobile 원본의 `https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700&display=swap`은 HTTP 400이다. Tablet의 Noto Sans KR/Inter·Material Symbols URL은 접근 가능했다. 모바일 원본을 대체 글꼴로 렌더링한 캡처는 fallback이며 원래 PNG와의 일치 증거가 아니다. 원본 HTML을 고치거나 인증서 검증을 끄지 않았다.

[원본/구현 측정](evidence/phase36/measurements.json), [Tablet 원본](evidence/phase36/source-834.png) / [구현](evidence/phase36/implementation-834.png), [Mobile 구현](evidence/phase36/implementation-390.png), [실제 Mobile Dialog](evidence/phase36/actual-dialog-390.png), [Dialog 6개 폭](evidence/phase36/actual-dialog.json). 834/768/390 콘텐츠 폭 786/720/358px. 높이 1342.625/1384.625/2416.1875px는 구현의 실제 필요한 입력/추출 전 상태를 포함하며, 시안 상태와 달라 개선율로 사용하지 않는다. 헤더/단계·형식/날짜 추가 입력·파일 선택 도구·규격·계좌 확인/미리보기 카드와 문구·상태·간격 차이가 남아 있다. 실제 Dialog에서 1440/1280/834/768/390/360 콘텐츠 폭 786/786/786/720/358/328px, 넘침 없음·resize API 0회 및 기존 수기 입력 전환 확인. 첫 측정은 Dialog 진입 애니메이션 중이어서 안정화 뒤 다시 측정했다.

합성 파일 캡처 5개 폭: 자료 종류·형식·파일 선택/제거·대상 확인·PDF 암호 소유자 제한·busy·다크·수기 입력 이벤트 통과, API 0회. 실제 앱 Memory API 흐름 asset-management, portfolio-import-review, mobile-import-feedback(light/dark·오류 보존/재시도·저장 0회), broker-spreadsheet, manual-holdings, portfolio-enhancements 통과. mobile-import-feedback의 첫 시도는 잘못된 환경 변수로 기본 5175 접속 실패했고 CAPITAL_TEST_URL을 5190으로 지정해 통과했다. 고객 계좌/PDF·실제 금융기관 인증은 사용하지 않았다. lint 오류 0/기존 경고 54, Vue 타입 검사·프로덕션 빌드 통과.

남은 단계는 실제 추출 상태의 미리보기 통합, 원본 카드/헤더 세부 치수·간격 대조와 모바일 글꼴 불가 처리, 최종 CI/Preview/운영 검증이다. 새 화면 전체를 완료했다고 계산하지 않는다. 현재 최종 20개 시안의 중복 없는 상태는 [적용 현황](CURRENT_ROLLOUT.md)을 따른다.
