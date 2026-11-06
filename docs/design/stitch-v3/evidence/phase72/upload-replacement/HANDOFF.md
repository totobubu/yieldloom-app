# 업로드 파일 변경 입력 손실 수정

기준 main016fcdd. 소유 소스 PortfolioFileImportForm.vue 및 새 upload-file-replacement.browser.mjs만 변경. 원격 push/PR/main/work 병합·배포 미실행. 전체 build는 root 통합 후 실행하도록 위임받아 생략.

## 실제 재현과 수정

기존 CSV/XLSX 파일명 변경 클릭은 기존파일/미리보기를 먼저 지운다. PrimeVue4.5.3의 fileLimit=1 input disabled가 clear 직후 DOM에 남아 선택창도 열리지 않는다. baseline replacement-before.log에 before/after model·chooserOpened:false·API0·JS오류0과 실패 assertion, replacement-before/replacement-did-not-open.png를 보존.

별도 숨김 native replacement chooser는 파일이 실제 선택될 때만 기존 uploader.clear→nextTick→공개 PT id로 지정한 원래 file input에 FileList/change를 전달한다. 기존 accept/2MB 검사와 select/clear 이벤트 경로, 새선택시 미리보기/명의확인 리셋을 유지. PDF는 기존 추가 선택 경로를 유지. 숨김 input은 레이아웃을 차지하지 않는다.

## 검증 범위

- replacement-release.log 및 replacement-release/results.json: 1280/834/390 CSV/XLSX 8사례에서 실제 Playwright filechooser, setFiles([]), synthetic native cancel event 후 파일/미리보기/명의확인/이벤트 보존. genuine replacement는 정확히1파일·clear/select·확인/미리보기 리셋. 확장자/2MB+1 바이트 거절. PDF chooser 두사례에서 기존+추가 파일 보존. API0. XLSX는 openpyxl로 생성한 합성 실제형식이며 PDF는 picker 전용 합성header로서 파싱 테스트가 아니다.
- Chromium oncancel property 지원 true. 실제 OS 취소버튼 클릭·실제PC/태블릿/휴대기기 하드웨어는 시험하지 않았음.
- upload-before 및 upload-after: 기존5폭(1280/834/768/390/360) 업로드 전체 컨트롤·확인·암호·형식·busy·dark·수기·제거 검사 통과/API0. upload-layout-preservation.json에서 전후 geometry 객체 전체동일. 실제 수치/문구와 원본 PNG 일치는 미수용.
- type-check.log: vue-tsc 통과. lint-final.log 오류/경고0, prettier-final.log 통과.
- 원본HTML4개 해시 등록부 일치(reference-integrity.json). 업로드 원본 Tablet/Mobile PNG 직접 열어 확인. Tablet는 2560px native PNG이며834px HTML재렌더와 구별. Mobile 원본 GoogleFonts 요청 실패는 기존상태로 유지.
- 검토 화면 원문 보기는 API 미제공으로 미지원, 금융지표/예시값·실계좌/PDF는 계약/검증 경계. 검토 소스는 바꾸지 않았고 새 검토 전체캡처를 주장하지 않음.

## 실행 명령

UI_BASE_URL=http://127.0.0.1:5222 UPLOAD_REPLACEMENT_EVIDENCE_DIR=/tmp/phase72-import/replacement-release CHROMIUM_PATH=/usr/bin/chromium node tests/upload-file-replacement.browser.mjs

원격 CI browser 단계에 이 새 회귀 파일을 추가하는 것은 root 담당. 단계는 직렬 실행해야 하며 별도 동시페이지 fixture를 공유하지 말 것. 테스트 생성 임시HTML은 동일 worktree에서 실행하고 finally로 제거, 기존파일은 wx로 덮어쓰지 않음.

초기 진단에서 Vite 변환 없는 virtual HTML의 bare import와 실제로 숨김 처리된 desktop toolbar 선택자를 잘못 사용한 시도가 있었다. 이를 고유 Vite HTML과 실제 보이는 파일명 제어로 교정한 뒤 제품 결함 baseline을 따로 기록했다. 이 초기 harness 오류를 제품 회귀라고 세지 않는다.

최종 로컬 커밋: 2dede2a0a12e78de4d624abe8c23f02e44fbf83c (fix/stitch-import-gap-phase72). source/tests 두 파일만 포함, clean 작업트리, 쓰기 중단. 전용 Vite5222는 재검증용으로 실행 중.

로컬 개발 node_modules symlink의 일부 PrimeIcons 폰트 요청은 Vite serving allow-list 밖으로 기록되었다. 테스트는 정확한 모델/파일선택 동작과 동일환경 전후geometry를 확인하며 전체 glyph/PNG 수용이 아니다. production assets/서버 설정은 변경하지 않았다.
