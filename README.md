# 토또부부 배당 썸네일 스튜디오

종목별 배당 콘텐츠 카드 제작에 집중한 Vue 앱입니다.

## 화면

- `/`: 티커·종목명·운용사 검색 및 종목 선택.
- `/thumbnail/:ticker`: 배당 요약, 배당 비교, 라이벌 비교, 배당 일정, 매수 효율 카드와 PNG 다운로드, 토스 게시 문구 복사.
- `?rivals=CRSH,TSII`: 라이벌 선택 공유. 최대 3종.
- 그 외 주소는 `/`로 이동합니다. `VITE_APP_MODE`에 따른 화면 전환은 제거했습니다.

## 개발 및 검증

```sh
npm ci
npm run dev
npm run build
node --test tests/rival_comparison.test.mjs tests/entry_income_efficiency.test.mjs tests/toss_portfolio.test.mjs tests/toss_statement_parser.test.mjs tests/recovery_ledger.test.mjs tests/content_refresh_input.test.mjs
python -m unittest discover -s tests/content_pipeline -p 'test_*.py'
```

## 데이터 공급

카드 페이지는 `public/nav.json`에 등록된 `dataPaths`의 가격·배당 JSON을 사용합니다. `backtestData`라는 필드명은 카드의 데이터 계약이며, 백테스터 화면과 별개로 유지합니다. 라이벌 비교에는 기초자산의 가격 이력도 필요합니다.

종목 데이터가 체크아웃에 없다면 기존 데이터 저장소에서 복원하거나 `VITE_R2_PUBLIC_URL`을 설정해야 합니다. `VITE_USE_R2=true`로 종목 데이터를 R2에서 우선 읽을 수 있습니다. 환경변수를 바꾸면 개발 서버 재시작 또는 재빌드가 필요합니다.

일정 카드는 `public/content-studio/distribution-index.json`과 티커별 공식 배당 이력, 또는 `VITE_DATA_RELEASE_BASE_URL`로 지정한 data v2 릴리스를 사용합니다. 가격 이력과 공식 배당 원장의 업데이트·정합성 검사는 계속 필요합니다.

공식 운용사 수집기 15종, SQLite 원장, 데이터 대조 및 릴리스·배포 도구는 유지합니다.

```sh
npm run content:run
npm run content:refresh -- --scope provider --provider yieldmax
```

수집 파이프라인은 기본적으로 카드용 데이터 작업을 수행합니다. 기존 블로그 Bundle·편집 캘린더·주간 대본 생성은 `--include-editorial`을 명시한 경우에만 실행합니다. 호환 도구와 기존 저장 데이터는 보존합니다.

## 별도 도구로 보존한 기능

Toss 계좌·보유수량·종료 주문 API, 브라우저 PDF 파서, 회수 원장 계산·승인 행 Firestore 저장 코드, Firebase 인증 상태, IndexedDB 유틸리티를 유지합니다. 현재 썸네일 앱에는 로그인·원장 진입 화면이 없으며, 해당 기능은 별도 도구로 옮길 대상입니다. Firestore 규칙 및 실제 Toss 계정 연결은 이 변경에서 수정하거나 배포하지 않습니다.

테마 전환·로컬 설정 저장, 오류 경계·Sentry, Android 구성도 유지합니다. Vercel Analytics는 기존 패키지 상태를 유지하며 새로 활성화하지 않았습니다.

## 정리 검증 기록

- TypeScript 검사 및 프로덕션 빌드 통과.
- 카드 계산·Toss·원장·갱신 입력 Node 테스트 18개 통과.
- 콘텐츠 파이프라인 Python 테스트 57개 통과. 데이터 전용 실행 검증 포함.
- 로컬 프로덕션 미리보기에서 검색, 직접 접속·새로고침, 카드 5종 PNG, 라이벌 URL, 문구 복사, 제거 경로 리다이렉트, 테마 유지 확인.
- 브라우저 카드 검증에는 종목 가격·배당 테스트 응답을 사용했습니다. 이 체크아웃에는 종목 JSON 및 R2 설정이 없어 실제 시장 데이터, 외부 수집, Toss 계정, Android 기기 동작은 검증하지 않았습니다.
