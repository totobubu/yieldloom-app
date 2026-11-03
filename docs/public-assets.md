# 썸네일 앱의 공개 자산

`npm run build`는 `scripts/publicAssets.mjs`의 Vite 플러그인으로 배포 자산을 구성한다.

- `logos`, `calendar`, `sidebar`, `popularity`, `brokerage`, `flags`, `holidays` 폴더는 로컬에서도 삭제했다. 기존 스크립트가 재생성하더라도 배포에서는 제외한다. 이 폴더를 참조하는 구 시스템 생성 스크립트는 실행 전에 수정이 필요하다.
- `nav` 폴더는 로컬 원본으로 보존하고 배포에서 제외한다.
- 사용하지 않는 최상위 JSON 10개(exchange-rates, live-data, mappings, missing-logos-fetch-report, missing-logos, missing_isin, popularity, sidebar-tickers, symbol-to-isin, thumbnail)를 삭제했다. 구 시스템의 환율·로고·매핑·사이드바 스크립트를 다시 사용하려면 해당 입력과 출력 경로를 정비해야 한다.
- 원본 `public/nav.json`은 데이터 생성 작업용으로 보존하지만 배포하지 않는다.
- 홈과 종목 화면은 자동 생성되는 `ticker-index.json`을 읽는다. 개발 서버는 요청 시 독립 `data-v2/catalog-seed.json`에서 생성하고, 빌드는 정적 파일로 출력한다. `nav.json`은 읽지 않는다. 별도 생성 명령은 필요 없다.
- 인덱스에는 종목 식별·검색·분류·상장일 메타데이터만 포함한다. 활성 catalog 종목을 유지하며 가격 파일 경로는 `data-v2/market-sources.json`에서 별도로 관리한다.
- 사용하지 않는 `thumbnail/{blue,gray,red}.png`와 Vite 기본 `vite.svg`를 Git에서 제거했다. 화면에서 소비되지 않던 배경 URL 계산도 제거했다. `content-studio/distribution-index.json`과 종목별 배당 이력은 계속 배포한다. 다른 공개 파일도 별도 제외 정책이 없는 한 유지한다.
- 종목 가격·배당 이력은 기존 dataPaths 및 R2 폴백으로 읽는다. 이번 변경은 데이터 공급 경로를 바꾸지 않는다.

검증: `npm run build` 후 `node --test tests/public_assets.test.mjs`.

구 시스템 스크립트도 정리했다. 환율 생성기, 예전 로컬 일괄 실행 4개, Firebase 자산·북마크·심볼 마이그레이션 5개와 관련 안내문, 사이드바·실시간 데이터 생성기, 사용처가 사라진 popularity 유틸리티를 삭제했다. 관련 npm 명령 3개도 제거했다. 데이터 수집·릴리스·콘텐츠 생성과 종목 등록에 연결된 스크립트는 유지한다.

운용사 명칭 통합이나 ETF만 표시하는 정책은 별도 데이터 정제가 필요하다. 현재 경량화는 종목을 제거하지 않고 불필요한 메타데이터만 제외한다.

## 2026-11-03 공개 자산 감사

main 5a2bbe5 기준 tracked 855개, 31,485,083바이트를 조사했다. 소스/API/수집·생성 스크립트/Actions/문서의 정적·동적 참조를 대조해 현재 소비자가 없는 배경 PNG 3개와 Vite 기본 SVG 1개만 제거했다. Git 이력은 보존하며 외부 저장소를 삭제하지 않았다.

- security-insights 64개는 종목 인사이트의 동적 bucket 로딩에 필요하다.
- content-studio 704개는 현재 API의 직접 import와 공개 배당 이력/운영 리포트의 배포 산출물이다. SQLite 정본 상태를 R2에 보존하더라도 현재 JSON 소비 경로가 있어 유지한다.
- nav 및 nav.json은 생성기 입력이며 배포에서 이미 제외된다. thumbnail-catalog와 us-dividend-stocks는 빌드 입력이다.
- screenshot 12개는 update_distributions.py의 OCR 입력이므로 유지한다.
- icon-192/512는 외부 설치 URL 의존성을 확인하지 못해 유지한다. 정적 파일 URL의 모든 외부 사용을 증명할 수는 없지만 삭제한 템플릿 배경은 현재 카드에서 사용하지 않는다.
