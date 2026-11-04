# Stitch 공개 UI 부분 릴리스

승인 범위: 기존 서비스의 기능·데이터·권한을 유지하는 표시 변경만 먼저 운영에 반영한다.
기준 main: ec8971fe1e97fe70c50be3f6decfcfb1e7492679.
전체 리디자인은 별도 작업 트리와 phase26 체크포인트에 보존하며 이 릴리스에 포함하지 않는다.

## 적용하는 부분

- 공통 헤더의 기존 36px 브랜드 박스에 승인된 청록·노랑·짙은 갈색 심볼. 계정 Drawer의 사용자 아이콘은 유지.
- 공개 종목 검색 카드: 이름을 상세 이동 링크 아래 전체 열에 배치하고 잘림 제거. 원본의 15px/600/20.25px 글꼴과 8px 제목 간격.
- 검색 페이지 버튼: 44×44px, 모서리 8px, 버튼 사이 8px.
- 티커, VS 기초자산 이동, 운용사·상장폐지 표시, 모든 금융 지표와 조회·필터·정렬·페이지 상태 계약은 유지.

원본: 콘텐츠 프로젝트 `7356929996797649648`, 검색 화면 `6e69286f8e3d4f98b3cbc125f2b2ecd0`.
공통 셸 프로젝트 `2458864221184522893` 및 사용자 승인 브랜드 심볼.
원본 HTML의 card-top gap=8px, stock-name=15px/600/1.35, page-btn height/min-width=44px를 확인했다.
PC 1280·Tablet 768·Mobile 390·좁은 Mobile 320에서 이름이 헤더 전체 너비를 차지함을 측정한다.
전체 화면 폭·카드 수·색상·밀도까지 원본과 일치한다는 승인은 아니다. 기존 탐색과 표시를 유지하는 이 세 부분만 배포한다.

## 검증

- `npm run build`: Vue/TypeScript, 번들, 공개 페이지 프리렌더 통과.
- `npm run lint:check`: 오류 0, 기존 경고 69. 자동 수정하지 않음.
- `node --test tests/*.test.mjs`: 788 통과, 실패 0.
- `tests/provider-filters.browser.mjs`: 1440/768/390/360, 키보드·검색·초기화·URL·테마·재조회 없음·넘침/실행 오류 없음.
- `tests/stitch-partial-public.browser.mjs`: 합성 공개 카탈로그로 1280/768/390/320 × 밝음/어두움, 전체 이름/44px 버튼/기존 링크/페이지 이동·재방문/동일 금융 문구/쓰기 요청 없음. 운영 데이터에 합성 값을 쓰지 않음.
- 새 검증을 Application quality의 기존 브라우저 작업에 등록. 최종 원격 CI 및 배포 SHA 확인은 별도로 수행.
- 로컬 개발 서버의 외부 node_modules 심볼릭 링크로 PrimeIcons 자산이 403이었다. 운영 번들 preview에서 글꼴 로딩을 추가 검증하며 배포 소스의 보안 설정은 변경하지 않는다.

증거: 클라우드 `/workspace/stitch-v2-evidence/partial-public-release/`의 원본·구현 PNG와 측정 JSON. 전체 진행 작업은 `/workspace/stitch-v2-evidence/checkpoints/phase26-manifest.json`.

## 제외·검증 한계

미완성 분석/포트폴리오/공유 등 전체 Vue 변경, 미생성 29종, 신규 금융 지표·팝업·계산·계좌 쓰기·권한 변경은 제외한다.
실제 인증 계좌·금융 장부 쓰기를 통한 검증은 이 공개 표시 릴리스의 범위에 포함하지 않는다.
CI 성공·Preview 성공·Production 활성화·실제 운영 릴리스 식별은 각각 구분한다.
