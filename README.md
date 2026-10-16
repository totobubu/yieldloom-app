# 토또부부 배당 썸네일 스튜디오

종목별 배당 콘텐츠 카드 제작에 집중한 Vue 앱입니다.

## 화면

- `/`: 티커·종목명·운용사 검색 및 종목 선택.
- `/login`: 이메일·비밀번호 또는 Google 로그인, 회원가입, 비밀번호 재설정. 로그인 유지 선택과 비밀번호 확인 입력을 제공합니다.
- `/mypage`: 본인 계좌 포트폴리오(기본), 선택형 가족 추가·관리, 파일 검토·수정 및 기준일 잔고 합산.
- `/mypage/legacy`: 이전 단일 계좌 자료 조회.
- `/stock/:ticker`: 종목 상세·시세·배당 정보와 배당 카드 PNG·게시 패키지 다운로드, 게시 문구 복사. `/thumbnail/:ticker`는 이 경로로 이동합니다.
- `/legal`: 데이터 출처·갱신·투자 면책 및 개인정보 안내.
- `?rivals=CRSH,TSII`: 라이벌 선택 공유. 최대 3종.
- 그 외 주소는 `/`로 이동합니다. `VITE_APP_MODE`에 따른 화면 전환은 제거했습니다.

## 개발 및 검증

```sh
npm ci
npm run dev
npm run build
node --test tests/*.test.mjs
python -m unittest discover -s tests/content_pipeline -p 'test_*.py'
```

## 인증 화면과 공유 카드

로그인·회원가입·재설정 화면은 Stitch 인증 시안의 웹·모바일 배치를 반영합니다. Firebase 재설정 링크(`/login?mode=resetPassword&oobCode=…`)의 검증·만료·재시도·변경 완료를 처리하며 작업 코드는 URL에서 제거하고 메모리에만 보관합니다. 메일에서 이 화면을 열려면 Firebase Console → Authentication → Templates의 비밀번호 재설정 작업 URL을 `https://yieldloom-app.vercel.app/login`으로 설정해야 합니다. 이메일 템플릿 설정을 바꾸지 않으면 기존 Firebase 호스팅 재설정 화면을 이용합니다.

공유정보 탭에서 1:1(720×720), 16:9(1280×720), 9:16(720×1280)과 기본·페이퍼·네이비 디자인을 선택합니다. 선택은 카드 5종의 미리보기·PNG·ZIP manifest·로컬 프리셋에 함께 반영됩니다. 기존 프리셋과 기본 PNG 파일명은 유지하며 앱 다크 모드와 출력 디자인은 독립적입니다. 디자인 원본 63개의 기능별 반영 현황은 [시안 대조표](docs/design/stitch-screen-mapping.json)와 [분석 문서](docs/design/STITCH_FEATURE_GAPS_KO.txt)에 기록합니다.

```sh
# 개발 서버(5173)에서 실행. 인증은 테스트 응답으로 대체하며 실제 메일·계정을 만들지 않습니다.
node tests/auth-flows.browser.mjs
node tests/share-presentation.browser.mjs
```

## 공용 개발 스킬

Vue·PrimeVue 구현과 리뷰 기준은 저장소의
[공용 스킬](.agents/skills/vue-primevue-best-practices/SKILL.md)에서 관리합니다.
Low-level composition, 반응성·수명주기, 테마·접근성 및 검증 기준을 포함하며,
[AGENTS.md](AGENTS.md)에 작업별 적용 시점을 명시합니다.

## 데이터 공급

검색 목록은 기본적으로 작은 `ticker-index.json`을 사용합니다. `VITE_DIVGROW_RELEASE_BASE_URL`을 설정하면 DivGrow의 버전 고정 `releases/v1/current.json`과 manifest·catalog를 검증해 목록을 읽습니다. 카드 페이지는 썸네일 API로 필요한 시세 보조 데이터를 요청하며, `DIVGROW_DATA_BASE_URL`은 DivGrow R2의 `data/` 경로를 가리킵니다. 검증된 공식 배당 원장은 data v2의 승인 릴리스로 분리합니다.

종목 데이터가 체크아웃에 없다면 기존 데이터 저장소에서 복원하거나 `VITE_R2_PUBLIC_URL`을 설정해야 합니다. `VITE_USE_R2=true`로 종목 데이터를 R2에서 우선 읽을 수 있습니다. 환경변수를 바꾸면 개발 서버 재시작 또는 재빌드가 필요합니다.

GitHub Pages 배포는 `VITE_API_BASE_URL` 설정이 없으면 정식 웹앱 API인 `https://yieldloom-app.vercel.app`을 사용합니다. 인증·계좌용 Node·Python API는 기본 프런트엔드 origin `https://totobubu.github.io`와 로컬 개발 주소를 허용하며, 추가 사이트는 서버의 `PUBLIC_APP_ORIGINS`에 명시합니다. 익명 시장 데이터만 반환하는 `/api/thumbnail-data`는 CDN에 저장된 응답도 같은 방식으로 읽을 수 있도록 공개 CORS를 사용하며, 브라우저 자격증명은 허용하지 않습니다. `FIRESTORE_SA_KEY`·Toss 자격증명은 서버 전용으로 유지합니다. Pages에 Firebase 웹 설정이 없는 경우 로그인 화면에서 정식 웹앱으로 이동해 계좌 기능을 이용할 수 있습니다.

## 광고 배치

공개 종목 검색 화면만 광고 슬롯을 지원합니다. `VITE_ADSENSE_CLIENT`과 `VITE_ADSENSE_HOME_SLOT`이 모두 유효할 때만 Google AdSense 스크립트를 지연 로드합니다. 개인 포트폴리오·로그인·PDF 업로드 화면에서는 광고를 로드하지 않습니다. 실제 활성화 전에는 AdSense 사이트 심사와 이용 지역에 맞는 개인정보·동의 고지를 별도로 완료해야 합니다.

일정 카드는 `public/content-studio/distribution-index.json`과 티커별 공식 배당 이력, 또는 `VITE_DATA_RELEASE_BASE_URL`로 지정한 data v2 릴리스를 사용합니다. 가격 이력과 공식 배당 원장의 업데이트·정합성 검사는 계속 필요합니다.

공식 운용사 수집기 15종, SQLite 원장, 데이터 대조 및 릴리스·배포 도구는 유지합니다.

```sh
npm run content:run
npm run content:refresh -- --scope provider --provider yieldmax
```

수집 파이프라인은 기본적으로 카드용 데이터 작업을 수행합니다. 기존 블로그 Bundle·편집 캘린더·주간 대본 생성은 `--include-editorial`을 명시한 경우에만 실행합니다. 호환 도구와 기존 저장 데이터는 보존합니다.

## R2 경량 가공 데이터

외부 수집 저장소의 원본을 읽어 썸네일용 가격 요약과 기간별 이력을 별도 R2 `thumbnail/v1/` 경로에 생성합니다. 원본·거래 원장은 수정하지 않으며 과거 가격 날짜 소실을 감지하면 이전 가공 결과를 유지합니다. 실행·환경변수·단계별 활성화 방법은 [가공 데이터 운영 안내](docs/data-management/THUMBNAIL_READ_MODELS.md)를 참조하세요.

```sh
npm run thumbnail:refresh -- --dry-run --symbols AMDY,TSLY,TOPW,AAPL,TSLA
```

## 개인화 포트폴리오

가족 공간의 성인 본인 참여와 계좌별 공유 권한을 분리합니다. 표준 CSV/토스 거래 PDF의 검토·수정·중복 차단, 자료 기준일 잔고 합산을 지원합니다. 전체 계좌번호·원본 파일·비밀번호는 저장하지 않습니다. 이전 단일 계좌 업로드는 종료했고 원본은 보존합니다.

마이페이지의 `CSV 내보내기`에서 읽기 권한이 있는 한 계좌의 최신 기준일 잔고 또는 저장된 전체 거래를 UTF-8 BOM CSV로 내려받을 수 있습니다. 통화·자료 기준일(`asOf`)·출처(`source`)를 보존하며 미확인 금액은 빈칸으로 둡니다. 거래는 200행씩 모두 읽되 한 번에 10,000행까지 지원하며, 조회 중 권한·로그인 계정·거래 원장이 바뀌면 부분 파일을 만들지 않습니다. 계좌번호·권한·PDF 비밀번호 같은 계좌 내부 필드는 출력하지 않습니다. XLSX 형식과 이전 단일 계좌 자료의 내보내기는 지원하지 않습니다.

수식으로 해석될 수 있는 텍스트는 작은따옴표로 보호하고 `csvEscaped` 열에 처리한 열 이름을 기록합니다. 다시 올릴 때 이 열을 유지하면 원래 거래 고유번호를 복원해 중복 검사를 유지합니다. 기존 CSV 업로드의 한 계좌·200행·2MB 제한과 잔고 전체 스냅샷 정책은 그대로 적용됩니다. 등록 완료 화면에서는 새로 저장한 행과 중복을 구분하고, 과거 기준일 잔고는 최신 잔고를 덮지 않았음을 안내합니다.

구조·제품 기본값·지원 형식·보존 이전·Firestore 규칙/TTL 적용·검증 방법은 [가족 포트폴리오 v2 안내](docs/architecture/FAMILY_PORTFOLIO_V2.md)를 참조하세요. 실제 증권사 API는 새 가족 기능에 연동하지 않았습니다.

테마 전환·로컬 설정 저장, 오류 경계·Sentry, Android 구성도 유지합니다. Vercel Analytics는 기존 패키지 상태를 유지하며 새로 활성화하지 않았습니다.

## 정리 검증 기록

- TypeScript 검사 및 프로덕션 빌드 통과.
- 카드 계산·Toss·원장·갱신 입력 Node 테스트 18개 통과.
- 콘텐츠 파이프라인 Python 테스트 57개 통과. 데이터 전용 실행 검증 포함.
- 로컬 프로덕션 미리보기에서 검색, 직접 접속·새로고침, 카드 5종 PNG, 라이벌 URL, 문구 복사, 제거 경로 리다이렉트, 테마 유지 확인.
- 브라우저 카드 검증에는 종목 가격·배당 테스트 응답을 사용했습니다. 이 체크아웃에는 종목 JSON 및 R2 설정이 없어 실제 시장 데이터, 외부 수집, Toss 계정, Android 기기 동작은 검증하지 않았습니다.
