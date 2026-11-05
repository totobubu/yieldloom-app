# 최종 Stitch 시안 적용 대조표

프로젝트 `17382728461495959991`의 최종 검수 ID 20개는 **9개 화면군의 기기별 상태**다. 새 페이지 20종으로 세지 않는다. 기존 14종, 중복 시안, 이전 버전, MCP 시험 프레임을 구분한다. 최신 선택은 [SCREEN_REGISTRY.json](SCREEN_REGISTRY.json)의 `selectedScreen`이며 `supersededCandidates`는 적용 대상이 아니다.

모든 최종 HTML·PNG를 읽기 전용 MCP로 다운로드했다. HTML 원본 20개는 `originals/17382728461495959991/`에 변경 없이 보존했다. PNG 해시와 MCP 리소스 이름도 등록했다. 원본 PNG의 물리 픽셀 크기를 CSS viewport로 간주하지 않는다.

| 화면군          | 기기   | 최종 시안 ID                       | 경로·상태                                                           | 담당 컴포넌트                                            | 적용·검증 상태                                                |
| --------------- | ------ | ---------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| 열 연결         | PC     | `9ae2f0f1253a41b1839e792d36996900` | `/mypage?tab=assets` / uploadDialog,inputMethod=broker,info present | `src/components/portfolio/BrokerSpreadsheetForm.vue`     | 열 연결 주요 치수·Dialog 폭 검증 통과, 전체 픽셀 일치 판정 전 |
| 열 연결         | Tablet | `0bb2ab1d8197472f910b73ed175c4448` | `/mypage?tab=assets` / uploadDialog,inputMethod=broker,info present | `src/components/portfolio/BrokerSpreadsheetForm.vue`     | 열 연결 주요 치수·Dialog 폭 검증 통과, 전체 픽셀 일치 판정 전 |
| 열 연결         | Mobile | `e0fb1368a1684edaa56c1a506e806530` | `/mypage?tab=assets` / uploadDialog,inputMethod=broker,info present | `src/components/portfolio/BrokerSpreadsheetForm.vue`     | 열 연결 주요 치수·Dialog 폭 검증 통과, 전체 픽셀 일치 판정 전 |
| 유사 비교       | Tablet | `77fdbd798a3941c68f098120a210c44d` | `/compare?view=similar` / existing similar comparison view          | `src/pages/UnderlyingExplorerView.vue`                   | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 유사 비교       | Mobile | `2476bb94e3174e6182500d8f520a6424` | `/compare?view=similar` / existing similar comparison view          | `src/pages/UnderlyingExplorerView.vue`                   | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 테마 비교       | Tablet | `12bcd42390bb468eb1700a909aec3f5d` | `/compare?view=theme` / existing theme comparison view              | `src/pages/UnderlyingExplorerView.vue`                   | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 테마 비교       | Mobile | `4dbfbf717c75483e88e6d1186ecbdb2b` | `/compare?view=theme` / existing theme comparison view              | `src/pages/UnderlyingExplorerView.vue`                   | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 파일 업로드     | Tablet | `3c2a0d37b5f54a63b3a633f01f0d2b33` | `/mypage?tab=assets` / uploadDialog,inputMethod=file,review absent  | `src/components/portfolio/PortfolioFileImportForm.vue`   | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 파일 업로드     | Mobile | `80b06442816e4d1baebc96cb520b19d6` | `/mypage?tab=assets` / uploadDialog,inputMethod=file,review absent  | `src/components/portfolio/PortfolioFileImportForm.vue`   | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 저장 결과       | Tablet | `cf7686fbb620465f93418fde1572a6cc` | `/mypage?tab=assets` / uploadDialog,importReceipt present           | `src/components/portfolio/PortfolioImportResult.vue`     | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 저장 결과       | Mobile | `f5a2132c4e234e648269220f0e889387` | `/mypage?tab=assets` / uploadDialog,importReceipt present           | `src/components/portfolio/PortfolioImportResult.vue`     | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 가져오기 검토   | Tablet | `5aa7a573854a46db9b106f89c09c4f23` | `/mypage?tab=assets` / uploadDialog,review present                  | `src/components/portfolio/PortfolioImportReview.vue`     | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 가져오기 검토   | Mobile | `6bd9777b8bea43b98aea8397a29f809a` | `/mypage?tab=assets` / uploadDialog,review present                  | `src/components/portfolio/PortfolioImportReview.vue`     | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 장부 분석       | Tablet | `65c1b225397746ada071cf14ae4f687c` | `/mypage?tab=insights` / AdvancedPortfolioInsights subsection       | `src/components/portfolio/AdvancedPortfolioInsights.vue` | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 장부 분석       | Mobile | `986013fd6b61404f82b4eeda2b643cd6` | `/mypage?tab=insights` / AdvancedPortfolioInsights subsection       | `src/components/portfolio/AdvancedPortfolioInsights.vue` | 기존 기능 존재, 최종 새 시안 적용·대조 미완료                 |
| 배당 시뮬레이터 | Tablet | `85f567e48c3c4dbdad938b7e210c22ed` | `/simulator` / comparison=strategy                                  | `src/pages/DividendSimulatorView.vue`                    | 별도 작업에서 구현 중, 이 체크포인트는 파일 수정 없음         |
| 배당 시뮬레이터 | Mobile | `fbb16724366740e1ab9d8fce50db986a` | `/simulator` / comparison=strategy                                  | `src/pages/DividendSimulatorView.vue`                    | 별도 작업에서 구현 중, 이 체크포인트는 파일 수정 없음         |
| 세율 비교       | PC     | `678e97a05dc14fec9c77e971bd5ef960` | `/simulator` / comparison=tax                                       | `src/pages/DividendSimulatorView.vue`                    | 별도 작업에서 구현 중, 이 체크포인트는 파일 수정 없음         |
| 세율 비교       | Tablet | `388202e7721941e98095ae02b264b1b1` | `/simulator` / comparison=tax                                       | `src/pages/DividendSimulatorView.vue`                    | 별도 작업에서 구현 중, 이 체크포인트는 파일 수정 없음         |
| 세율 비교       | Mobile | `b640738daaf5434d9af72530fe150006` | `/simulator` / comparison=tax                                       | `src/pages/DividendSimulatorView.vue`                    | 별도 작업에서 구현 중, 이 체크포인트는 파일 수정 없음         |

업로드·열 연결·검토·결과는 `/mypage?tab=assets` 안의 기존 가져오기 흐름이다. 시뮬레이터·세율 비교는 `/simulator`의 별도 모드다. 유사·테마 비교와 장부 분석은 기존 구현이 있는 경로이므로 중복 페이지를 만들지 않는다.

[열 연결 구현·검증과 남은 차이](PHASE32_COLUMN_MAPPING.md)를 확인한다. 기존 14종의 과거 검수 결과는 [CURRENT_MATRIX.md](../stitch-v2/CURRENT_MATRIX.md)에 유지한다. 이 등록부 갱신은 기존 화면 전체의 재검수나 배포 완료 증명이 아니다.

남은 순서는 파일 업로드 → 검토 → 저장 결과의 연속 흐름, 장부 분석, 유사·테마 비교의 최종 기기별 시안 대조다. 별도 담당 시뮬레이터 파일은 통합 시 최종 SHA와 테스트를 받아 합친다. 실제 로그인한 계좌/PDF 흐름은 합성 테스트와 분리해 검증해야 한다.

최신 열 연결 후속 치수·동작 검증은 [PHASE33_MAPPING_LAYOUT.md](PHASE33_MAPPING_LAYOUT.md)에 기록했다.
