# 기존 저장소의 배당 수집과 앱 배포 분리

이 변경은 **기본 비활성**이다. 기존 수집 주기·상태 저장·Git 발행·core 발행은 유지한다.
운영 환경 변경, main 병합, 배포, R2 삭제·보존 정책 변경은 수행하지 않았다.

## 공급 경로

기존 Content Studio 수집 → 기존 검증 → `public_content_release.py` →
`public-content/{channel}/current.json` → 불변 manifest → 파일별 내용 해시 객체.

- `channel`은 main의 `production`, 다른 브랜치의 `preview-{브랜치 SHA256 앞 16자리}`다.
  브랜치명을 단순 치환하지 않아 이름 충돌을 피한다. Preview 빌드·서버는 production
  채널 설정을 거부한다. Preview는 자기 브랜치의 검증된 초기 스냅샷이 필요하다.
- 공개 허용 목록은 배당 index/전체 ticker 이력, stock-evidence index/이력,
  price-index/price-quality JSON뿐이다. 개인 계좌·거래·PDF·자격증명·raw·DB·로그는
  이 발행기에서 읽거나 업로드하지 않는다. 기존 비공개 원문/개정 보존 경로를 변경하지 않는다.
- manifest에는 파일 해시, 의미 해시, 발행 시각, 수집 workflow run ID와 commit SHA를
  남긴다. 원래 JSON 바이트·소수 문자열·출처 URL/해시·검증 상태는 보존한다.
- root `generatedAt`만 달라진 재출력은 같은 자료로 취급한다. 출처/관측 시각과
  request ID, 검토 상태 등 나머지 필드는 비교한다. 전체가 같으면 쓰기 0회다.
  변경 시에도 이전 의미 해시가 같은 파일은 이전 객체를 그대로 참조한다.
  현재 방식의 용량 증가는 변경된 파일과 작은 manifest이며 전체 배당 이력 복사본이 아니다.
- 이전 파일 누락, index가 참조하는 이력 누락, 이전 history 행 소실/변경은 발행 전에
  차단한다. 정정은 기존 원문·개정 근거를 보존하는 별도 검토 절차가 필요하다.
  이 장치는 기존 이력의 완전성이나 모든 행의 공식 검증을 새로 보증하지 않는다.
- 객체/manifest가 완성된 뒤에만 최신 포인터를 교체한다. 불변 객체는 create-only,
  포인터는 이전 ETag 조건으로 교체해 동시 발행을 덮어쓰지 않는다. 업로드/권한/해시 오류나
  경합은 실패한다. 불확실한 원격 쓰기 결과는 pointer와 manifest를 먼저 읽어 확인한다.
  [R2 조건부 쓰기 계약](https://developers.cloudflare.com/r2/api/s3/extensions/)을 사용한다.
- 일부 업로드 후 실패하면 미참조 객체가 남을 수 있으나 현재 버전은 유지한다.
  재시도는 동일 객체를 검증해 재사용한다. 자동 삭제/GC/보존 기간 설정은 없다.

## 소비자와 최신성

`VITE_PUBLIC_CONTENT_BASE_URL` + `VITE_PUBLIC_CONTENT_CHANNEL`이 설정된 앱은
공통 공개 JSON 캐시를 통해 배당 index, ticker 전체 이력과 주식 근거를 읽는다.
기존 core 설정보다 이 경로가 우선하며, 설정하지 않으면 기존 계약을 유지한다.
공개 index의 이력 URL에는 snapshot ID를 붙여 도중에 포인터가 바뀌어도 해당 이력을
같은 버전에서 읽는다. 개인 원장·계좌 요청은 이 캐시에 들어가지 않는다.

서버는 `PUBLIC_CONTENT_BASE_URL` + `PUBLIC_CONTENT_CHANNEL`로 공식 배당,
일반 주식 근거 index/이력과 가격 index를 실행 시 조회한다. `/api/thumbnail-data` 및
이를 사용하는 카드·포트폴리오·OG 경로는 앱을 다시 빌드하지 않고 갱신 자료를 읽는다.
설정된 원격 조회가 실패하면 오래된 빌드 자료를 최신 자료인 것처럼 대신 제공하지 않는다.
기존 partial/unavailable/stale 처리와 가격 fallback은 유지한다.

포인터 메모리 캐시는 60초, 불변 객체는 최대 24시간이다. 동시 요청은 합친다.
서버 ticker 메모리 캐시도 60초로 줄였다. CDN의 기존
`s-maxage=60, stale-while-revalidate=300` 및 호출 시점 때문에 화면 반영은 즉시가 아니다.
자동 폴링은 추가하지 않았다. 기존 화면의 재조회·새로고침/진입 시 포인터를 확인한다.
정적 SEO 설명은 수치·배당락일을 빌드에 고정하지 않는 문구로 바꾸었으며,
숫자가 포함된 OG/화면은 실행 시 데이터를 이용한다. 신규 종목 목록/라우트 추가는
별도의 앱 metadata 배포 범위이며 이 전환이 이를 자동 해결한다고 주장하지 않는다.

## 단계별 운영 전환 (아직 실행하지 않음)

1. 기존 `legacy` 모드에서 이 코드를 검증·승인·배포한다. GitHub repository variable
   `PUBLIC_CONTENT_PUBLISH_MODE`의 기본값은 `legacy`다. 기존 수집 일정을 유지한다.
2. 독립 Preview 채널에서 `shadow`로 실행해 R2에도 발행하고 기존 Git 커밋도 유지한다. shadow 발행 오류는 경고로 남기고 Git 발행을 계속한다.
   공개 도메인의 허용 CORS·실제 객체 GET·해시·전체 이력/출처 대조, 실패 처리와 rollback을
   확인한다. 이 단계의 R2 쓰기도 승인된 대상·환경에서만 실행한다.
3. 같은 Preview 앱/서버에 위 두 쌍의 base/channel 설정을 적용해 최초 앱 배포를 한다.
   수집만 다시 실행해 같은 앱 deployment ID에서 자료가 바뀌는 것을 확인한다.
   Vercel Preview의 서버 변수와 프런트 빌드 변수, Pages 변수를 각각 확인한다.
   현재 운영 Vercel 프로젝트/도메인의 실제 응답까지 별도로 확인한다.
4. 전체 이력과 private raw/DB 백업·실제 접근 제어, 복구 단일 소유자, 공개 데이터의
   새 경로 사용을 확인한 뒤 해당 환경의 `PUBLIC_CONTENT_RUNTIME_VERIFIED=true`와
   `PUBLIC_CONTENT_PUBLISH_MODE=r2`를 활성화한다. 이후 배당 수집은 Git 커밋을 만들지 않는다. 명시적 render 작업의 앱 이미지 발행은 기존 Git 경로를 유지한다.
   r2 모드는 수집 전에 이전 공개 스냅샷 전체를 해시 검증해 복원한다. 따라서 이전
   Git 스냅샷에서 시작해 다른 운용사의 자료가 되돌아가는 것을 막는다.
   초기 pointer가 없으면 복원을 거부하므로 shadow 부트스트랩을 생략할 수 없다.
5. Production은 Preview 증거·변경 범위를 제시하고 별도 운영 승인 후 같은 절차로 전환한다.
   기존 core 발행과 collection-state는 호환을 위해 유지한다. 새 content 경로가 공식 배당을
   공급하는 환경에서 별도 core 발행을 켜거나 줄이는 작업은 이 변경에 포함하지 않는다.

복구는 검증된 이전 manifest의 release ID로 **포인터만 조건부 교체**하는 별도 승인 작업이다.
기존 객체·원장·raw는 지우지 않는다. Git 발행으로 복귀할 때는 먼저 현재 공개 스냅샷을
복원·검증해 최신 자료가 Git에도 반영되도록 하고 모드를 legacy로 돌린다. 단순히 오래된
Git 파일로 돌아가는 것은 허용하지 않는다. 실제 원격 rollback/복귀는 아직 실행하지 않았다.

## 검증 기록 (2026-11-04, 로컬)

- `npm run type-check`, `npm run build`: 통과. 기존 큰 chunk 경고가 있다.
- `npm run lint:check`: 오류 0, 경고 69. 관련 새 파일에서 오류/경고 없음.
- `node --test tests/*.test.mjs`: 790개 통과 (이후 추가한 손상 복구 테스트도 개별 통과).
- Python 새 발행기 6개, 기존 Git 발행기 7개, 기존 export 검증 4개 통과.
- 현재 체크아웃 export 검증: 운용사 17, index 종목 517, 가격 index 99.
  이는 공개 export의 구조 검사이며 실제 모든 종목 전체 이력 확보 증명이 아니다.
- 현재 공개 파일을 네트워크 없는 메모리 저장소에 발행: 객체 521개,
  manifest/pointer 포함 4,098,890 bytes. 동일 재발행 쓰기 0회, 실제 R2 쓰기 0회.
- `tests/public_content.test.mjs`: 서버 공식 이력/주식 근거/API, 포인터 만료,
  동시/반복 조회 재사용, 이전 버전 복귀, 손상 후 재시도, Preview 격리 통과.
- `tests/public-content.browser.mjs`: 동일 Vite/브라우저에서 실제 서비스 모듈을 사용해
  합성 v1 → v2 → v1 검증. force 없이 60초 캐시 만료를 가상 시간으로 진행하고,
  공식 이력과 참고 이력이 함께 추가되는 것을 확인했다. 앱 재빌드/배포 없음.
  실행: base를 `https://snapshot.invalid`, channel을 `preview-aaaaaaaaaaaaaaaa`로 설정해
  Vite를 5178에서 실행한 후 `node tests/public-content.browser.mjs`.
- 운영 상태: Vercel API에서 yieldloom-app의 기존 Production 배포 READY를 읽었으나
  이 코드/플래그 사용 증거는 아니다. GitHub actions variables 조회는 현재 integration의
  권한으로 HTTP 403 `Resource not accessible by integration`을 반환했다.
  운영 변수 조회·변경, 실제 R2 발행/CORS·운영 화면 갱신·원격 rollback은 미검증이다.
  연결 권한을 우회하거나 운영 데이터/보존 정책을 변경하지 않았다.
