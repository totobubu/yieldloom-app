# 확장 데이터 수집 운영

2026-10-22 조사안을 반영한 첫 구현이다. 원문 → 관측값 → 영역별 검토 후보를
이 프로젝트에서 생성한다. 구 R2·`nav.json` 없이 실행하며, 기존 배당 원장·가격 공급과
앱의 소비 경로는 유지한다. 조사 근거는
[출처 조사](DATA_EXPANSION_RESEARCH_2026-10-22.md)를 참조한다.

## 데이터 경계

`data-v2/dataset-registry.json`은 데이터 값이 아닌 영역·필드·수집기·갱신 간격·이용 조건의
등록부다. 종목 마스터에 가격·보유자산·재무제표를 합치지 않는다.

| 영역 | 현재 수집 | 의미와 제한 |
| --- | --- | --- |
| identity | Nasdaq listed / other listed | 테스트 종목 제외. 서로 다른 디렉터리의 후보이며, 자동 catalog 등록·종목 수 합산 금지 |
| fund-profile | IVV 공시 보수 | 공시 문구의 보수, 총보수/순보수 구분과 기준일은 미확정 |
| fund-observations | IVV NAV·AUM·발행주식 수·종가·스프레드·SEC 수익률·후행 수익률 | 필드별 기준일·단위 유지, CSV와 상품 페이지의 발행주식 수 출처 구분 |
| holdings | IVV 공식 CSV | 종목·자산군·업종·지역·거래소·통화·비중·수량·시가·명목가·가격·환율 등 원문 열 보존 |
| fx | ECB 일별 환율 | EUR 기준 중앙은행 참고 환율. 거래 체결 환율로 사용하지 않음 |
| filings | AAPL SEC 최근 공시 최대 40건 | CIK·접수번호·서식·공시일·접수시각·보고기간·문서명. 재무 항목 추출은 후속 단계 |

보유자산의 ticker는 원문 식별자다. ISIN·MIC 등으로 대조하기 전 종목 마스터와 자동 연결하지
않는다. 같은 ticker·이름·자산군·통화·거래소 조합이 중복되면 임의 병합하지 않고 실패한다.
현금·파생상품의 음수/0 비중을 허용하고 합계를 강제로 100%로 만들지 않는다.

가격·기업행위·배당·세무 성격·재무제표·노출도·거시·분석까지 총 14개 영역의 책임을 등록했다.
배당·세무 수집은 기존 파이프라인이 담당한다. SEC 재무·ECB 정책금리와 비공개 보유자산
비중 분석을 추가했다. 새 가격·분할 공급은 보류다. OpenDART 인증·보고기간, KRX 이용 범위,
상용 시세 공급자·분할 보정·재배포 계약 등 선행 조건을 등록부에 명시했다.

## 실행

Python 3.11 이상, Node 24의 `--use-env-proxy` 지원 버전이 필요하다. 추가 Python/Node
패키지나 Firebase 키 없이 실행한다. 프록시가 설정되어 있으면 기존 환경을 사용한다.

```sh
npm run data:registry
npm run data:collect
# 특정 출처만 선택
npm run data:collect -- --source ishares-ivv-holdings
# 영역을 골라 새 경로에 검토 후보 생성 (기존 경로 덮어쓰기 금지)
npm run data:export-candidate -- --dataset fund-observations --dataset holdings --dataset fx --output var/data-platform/candidates/review-001
# 불필요한 HTTP 없이 저장된 원문을 재처리하려면 parserVersion을 올리고 collect 실행
python -m unittest discover -s tests/data_platform -v
```

`--root`로 영속 비공개 디렉터리를 지정할 수 있다. 기본값은 Git에서 제외한
`var/data-platform/`이다. **같은 저장소에는 한 번에 수집 프로세스 하나만 실행한다.**
정기 실행·원격 저장·공개 릴리스 코드는 준비했으며, 전용 R2 자격증명과 공개 이용 조건에
따라 운영 활성화를 구분한다. CI는 fixture 테스트만 실행하므로 PR마다 외부 사이트를 수집하지 않는다.

```text
var/data-platform/
  raw/{sha256}                 # 받은 원문, 내용 주소로 보존
  observations.sqlite          # 출처별 상태·HTTP 캐시·관측값·개정 이력·원문 증거
  review/latest.json           # 최신 실행 결과·요청 수·오류
  candidates/{새이름}/
    manifest.json              # 영역별 해시·건수·출처 버전·성공 시각·오류 상태
    {dataset}.json             # 선택한 영역의 현재 관측값
```

이 경로는 서버의 비공개 저장소다. `public/`, `dist/` 아래 저장은 코드에서 거부한다.
R2로 확장할 때도 실제 비공개 버킷과 접근 권한이 필요하며, 공개 버킷의 `private/` 폴더로
보안을 대신하지 않는다. 관측 DB·수집 상태 DB와 raw 디렉터리는 함께 백업한다. 자동 삭제는 하지 않는다.

## 관측값과 재수집 계약

- 값·단위·통화·기준일(`asOfDate`)·공시 시각(`publishedAt`)·관측 시각(`observedAt`)을 구분한다.
  없는 기준일을 수집일로 채우지 않는다. 소수는 문자열로 보존하여 금액 정밀도와 0을 유지한다.
- 원문 URL·SHA-256·파서 버전을 기록한다. 같은 값이면 새 개정을 만들지 않고 원문 증거를
  연결한다. 동일 출처·영역·개체·필드·기준일·qualifier의 값이 바뀌면 이전 값을 보존하고
  `revision`과 `supersedes`로 연결한다. 기준일이 바뀌면 별도 관측값이다.
- `source_observed`는 자동 수집 상태다. 검토 완료나 공식 원장 승인 상태로 승격하지 않는다.
- 기본 수집 간격은 출처당 24시간이다. 실행 중 같은 URL은 실패 응답을 포함해 한 번만 요청한다.
  ETag/Last-Modified를 재사용하고, 파서/설정 변경 시 보관 원문을 재처리한다.
  명시적 `--force`는 간격·백오프를 우회하므로 운영자 재시도에만 사용한다.
- 오류는 출처별로 격리한다. 마지막 성공 관측값과 성공 시각을 보존하고 지수 백오프한다.
  빈 결과·절반 이상 급감(이전 20건 초과)·중복 식별자·필수 필드 소실은 실패 처리한다.
  날짜가 오래된 정상 응답에 대한 출처별 신선도 SLA는 후속 설정이 필요하다.

## 공개 제공과 확장

ECB 환율과 SEC 구조화 정보는 출처 표시 조건으로 승인했고, Nasdaq·iShares는
`unreviewed`다. `export --public`은 하나라도 미승인이면 파일 생성 전에 중단한다.
승인 후에도 실패 상태·설정 변경 후 미검증 출처는
통과하지 못한다. 이 옵션은 비공개 위치에 검토용 공개 후보만 만들며 배포하지 않는다.
공개 이용·표시·재배포의 허용 범위 및 근거를 확인하고, 화면별 필드·권한·신선도·식별자
대조를 검증한 projection을 별도로 만들어야 앱/API에 연결할 수 있다.

새 영역은 등록부의 owner·필드와 독립된 parser를 추가하고, 날짜·단위·중복·결측·정정
fixture를 작성한다. 기존 parser 수정 시 `parserVersion`을 올린다. API 키는 등록부 URL에
넣지 않으며 인증 출처를 추가할 때 환경변수 기반 transport를 별도로 구현한다.
분석값은 입력 영역별 릴리스 버전과 산식 버전을 함께 기록해야 한다. 공개 릴리스는
영역별로 발행하고 화면에는 필요한 요약/분할 파일만 제공한다. 현재 후보 JSON은 내부
검토용 전체 영역 파일이며 화면에서 통째로 내려받는 용도가 아니다.

## 첫 실수집 확인

2026-10-22(한국 시간), 6회 HTTP 요청으로 6개 출처 모두 성공했다.

| 영역 | 현재 관측값 |
| --- | ---: |
| identity | 13,256 |
| fund-profile | 1 |
| fund-observations | 8 |
| holdings | 508 |
| fx | 29 |
| filings | 40 |
| 합계 | 13,842 |

identity의 두 디렉터리 건수는 각각 5,614 / 7,642이며 기존 catalog 수와 비교하거나
같은 수의 신규 투자 대상이라고 해석하지 않는다. IVV 보유자산의 안정된 행 식별자 변경은
저장 원문으로 재처리했고 HTTP 추가 요청은 없었다. 직후 반복 실행의 외부 요청도 0건이었다.
Firebase 읽기·쓰기·Auth 호출을 추가하지 않았다.

## 1단계: 비공개 체크포인트

Cloudflare 계정에 `yieldloom-data-private` 버킷을 생성했다. 2026-10-22 확인 결과
`r2.dev` 공개 접근은 비활성화, 사용자 도메인은 0개다. 공개 배당 버킷과 분리한다.
`scripts/data_platform/checkpoints.py`는 SQLite backup API 스냅샷과 DB에 기록된 모든
원문을 내용 주소 객체로 저장한다. 새 객체는 원격 해시를 확인하고, 이전에 검증한
manifest의 원문은 재조회 없이 참조를 재사용한 다음 새 manifest와 최신 포인터를 쓴다.
관측 DB(`observations.sqlite`)와 수집 상태 DB(`collection.sqlite`)를 분리한다.
상태 DB에는 출처별 성공·실패·재시도·현재 관측 ID와 HTTP ETag/Last-Modified 캐시를 둔다.
두 DB와 원문은 하나의 schemaVersion 2 manifest와 조건부 최신 포인터로 함께 확정한다.
DB 스냅샷은 결정적인 gzip(`mtime=0`)으로 압축하며 압축 전후 크기·해시를 기록한다.
이전 스냅샷과 압축 전 해시가 같으면 압축·업로드·원격 검증을 생략하고 참조를 재사용한다.
새 객체는 `If-None-Match: *` 업로드 후 한 번 조회해 검증한다. 기존 객체와의 조건부
충돌일 때만 기존 본문을 조회·비교한다. 권한 오류 등 다른 실패는 숨기지 않는다.
복원은 압축 해제 크기를 제한하고 두 해시를 검증한다. 이전 v1의 압축·비압축 백업도
복원할 수 있다. 기존 단일 DB는 열 때 상태·캐시를 별도 DB로 원자적으로 이관하고,
다음 정기 실행은 외부 자료의 수집 주기가 아니어도 v2 백업을 한 번 생성한다.
이전 원격 객체는 백업 과정에서 삭제하지 않는다. 별도 보존 정책은 아래 유지보수 절을 따른다.
포인터는 실행 시작 시 확보한 ETag로 조건부 갱신하여 오래된 실행의 덮어쓰기를 막는다.
R2 조건부 쓰기 근거: https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject

전용 환경변수 `DATA_PRIVATE_R2_ACCOUNT_ID`, `DATA_PRIVATE_R2_ACCESS_KEY_ID`,
`DATA_PRIVATE_R2_SECRET_ACCESS_KEY`, `DATA_PRIVATE_R2_BUCKET`을 사용한다. 마지막 값은
`yieldloom-data-private`이며, 객체 읽기·쓰기 권한은 이 버킷으로 제한한다.
기존 공개 R2 환경변수나 `.env.r2`를 읽어 대신 연결하지 않는다.

```sh
# 최초 백업만 bootstrap. 기존 체크포인트에는 사용 금지
python scripts/data_platform/checkpoints.py backup --root var/data-platform --run-id initial --bootstrap
# 복원 대상은 존재하지 않는 비공개 경로여야 함
python scripts/data_platform/checkpoints.py restore --root var/data-platform-restored
```

복원은 manifest·객체 크기와 해시·SQLite 무결성·원문 전체 포함 여부를 검증한 뒤
디렉터리를 노출한다. 실패 시 기존 디렉터리를 덮어쓰지 않는다. 자동 삭제는 활성화하지 않는다. 초기에는 전용 S3 자격증명이 없고 GitHub secrets 관리 API가 403으로 거절되어
메모리 원격 저장소로 먼저 검증했다. 이후 사용자가 전용 secrets를 등록하여 실제 R2 백업과
새 Actions 환경의 두 DB 복원이 통과했다. 실행 근거와 전체 원문 복원 판정은 유지보수 절을 참조한다. 메모리 원격 저장소를 통한
왕복 복원·업로드 실패·조건부 쓰기 충돌·손상 파일 검증은 통과했다.
첫 체크포인트 형식은 파일당 512 MiB, 전체 2 GiB, 파일 50,000개까지 지원한다.
백업도 같은 한도를 먼저 검사하여 복원할 수 없는 스냅샷으로 최신 포인터를 바꾸지 않는다.
대규모 가격 이력 이관 등으로 한도를 넘기기 전 저장 방식 확장이 필요하다.

## 2단계: 정기 수집과 상태 보고

`collect-data-platform.yml`은 한국 시간 09:30 일별 스케줄과 수동 실행을 제공한다.
스케줄·새 workflow의 수동 실행 등록은 기본 브랜치 반영 후 활성화된다. `work`에서는
관련 코드 병합 push로 검증한다. `main` 또는 `work`의 검토된 코드만 자격증명을 사용하며,
PR에서는 fixture 테스트만 한다. 스케줄 활성화를 위한 main 승격은 이번 ship에 포함하지 않는다.

실행은 항상 새 디렉터리에 두 DB와 검증한 manifest를 복원하고 마지막 성공 상태에 따라
증분 수집한다. 과거 원문 전체를 다운로드하지 않으며, 304 응답이나 파서 변경으로
필요한 원문만 크기·해시를 검증해 가져오고 실행 디렉터리에서 재사용한다.
수동 `checkpoints.py restore`는 원문 전체를 복원·검증하는 기존 동작을 유지한다.
DB 쓰기가 없는 실행은 새 스냅샷·manifest·포인터 쓰기를 모두 생략한다.
성공 확인 시각이나 실패·백오프가 변경된 실행은 반드시 저장한다. 관측·원문·증거가
같으면 상태 DB만 새로 저장하며, 관측 DB를 다시 업로드하지 않는다.
로컬 두 DB는 하나의 SQLite 연결에 ATTACH하고 DELETE 저널 모드를 사용하여
원문 기록+캐시 갱신, 관측 수락+출처 상태 변경을 동일 트랜잭션으로 처리한다.
분리된 저장소에서 어느 DB가 빠지거나 상태 테이블이 없으면 빈 상태로 재생성하지 않는다.
수동 파일 복사 시에도 두 DB를 함께 보존하고, 실행 중 백업에는 체크포인트 명령을 사용한다.
최초 실행만 명시적으로 bootstrap한다. 기존 포인터가 있는데 bootstrap하면 거부한다.
같은 작업의 GitHub concurrency와 POSIX 파일 잠금(Linux/macOS)으로 중복 쓰기를 막는다.
원문·DB를 Actions artifact/cache에 올리지 않는다. 오류 출처의 백오프 상태도 보존하고,
체크포인트 저장 실패는 성공으로 보고하지 않는다. 자동 복구 과정에서 빈 원장으로 초기화하지 않는다.

48시간 수집 성공 공백, 일별 데이터의 5일 기준일 지연을 경고한다. 공시 미발생은
데이터 지연으로 판정하지 않는다. Actions 요약에 건수·성공 시각·오류·신선도 상태만
남기고, 실패는 작업 실패로 표시한다. 외부 메일·메신저 발송은 추가하지 않는다.
전용 R2 secrets가 없으면 운영 작업은 수집 전에 실패한다. 2026-10-22 사용자가 해당 설정을 완료했다.

### R2 요청·전송량 최적화 검증

원문 20개가 보관된 메모리 원격 저장소에서 측정한 API 요청 시도다. 실제 청구량이나
SDK 내부 재시도 횟수는 아니다. 외부 출처 HTTP 요청과 R2 요청을 별도로 집계한다.

아래 표는 원격 쓰기 잠금 추가 전 측정이며, 잠금 도입 후 변경량은 유지보수 절에 별도 명시한다.

| 실행 | 최초 구조 GET / PUT | 이전 최적화 GET / PUT | 상태 분리 후 GET / PUT |
| --- | --- | --- | --- |
| 수집 주기 전, DB 변경 없음 | 46 / 2 | 3 / 0 | 4 / 0 |
| 일일 200 응답, 원문 바이트 동일 | 47 / 3 | 7 / 3 | 6 / 3 |
| 일일 304 응답, 캐시 원문 1개 필요 | 47 / 3 | 8 / 3 | 7 / 3 |
| 새로운 원문 1개 | 49 / 4 | 9 / 4 | 8 / 5 |

상태 분리로 복원에 작은 상태 객체의 GET 1회가 추가된다. 일일 동일 원문·오류 상태만
저장할 때 PUT 3회는 상태 DB·manifest·포인터이며 관측 DB는 쓰지 않는다. 새 자료가
발생하면 관측 DB·상태 DB·원문·manifest·포인터를 저장한다. 원문 수집 시 필요한
304 재처리 읽기는 별도이며 20개 출처 전체가 304일 때는 GET 26회·PUT 3회로 확인했다.

개선 후 원문 전체 보관 수와 관계없이 DB·포인터·manifest를 우선 읽고, 필요한
원문과 새 객체만 추가로 요청한다. 첫 bootstrap과 명시적 전체 복원은 전체 자료를 처리한다.
실행 결과와 Actions 요약에 `r2.getRequests`, `putRequests`, `downloadedBytes`,
`uploadedBytes`를 남긴다. 요청 수는 실패 시도도 포함하며 바이트는 완료된 객체 본문만 센다.
키·원문·자격증명은 기록하지 않는다. `checkpoint: unchanged`는 이전 포인터 유지를 뜻한다.
`checkpointFiles`는 두 DB 각각의 `reused`/`updated` 여부를 보고한다.

2026-10-22 로컬 자료의 SQLite backup API 스냅샷 69,423,104바이트는 gzip 후
9,224,551바이트로 86.7% 줄었다. 자료 구성에 따라 압축률은 달라진다.
이 수치는 전용 secrets 설정 전 로컬 측정이다. 이후 실제 R2 S3 왕복 요청 수는 유지보수 절에
별도로 기록했다. 실제 청구 금액은 확인하지 않았다.

같은 날 로컬 자료의 복사본에서 기존 단일 DB를 이관하고 메모리 원격 저장소로 검증했다.
관측 이력 34,231건이 일치했고, 외부 네트워크 없이 모의 304 응답으로 20개 출처의
성공 시각을 갱신한 뒤 전체 복원했다. 관측 객체는 동일하게 유지되었다. 압축 상태 DB는
88,551바이트(압축 전 270,336바이트), 상태 DB+manifest+포인터 업로드 합계는
92,885바이트였다. 이 실행의 다운로드는 38,509,866바이트로 DB 복원과 20개 캐시 원문
읽기를 포함한다. 업로드 절감률을 전체 전송량 절감률로 해석하지 않는다.

현재도 새 실행은 관측 DB 전체를 다운로드한다. 관측 데이터 분할·304 재파싱 생략·
보존기간 정책은 별도 유지보수 명령으로 제공한다. 앱 공개 데이터의 캐시·CDN 원본 호출률은
이번 변경 범위에 포함하지 않는다. v2 이관 뒤에는 두 파일과 새 복원 코드를 함께 사용한다.
이전 코드로 v2를 읽는 다운그레이드는 지원하지 않으며, 필요하면 보존된 v1 복구 지점을 사용한다.


## 3단계: 식별자와 품질 검사

`npm run data:quality`는 source의 ISIN 체크섬과 catalog 연결, 필드별 단위·통화·값·기준일,
수집 신선도를 검토하고 비공개 `review/quality.json`을 만든다. 종목 후보는 같은 ticker와
명확한 거래소 조건에서만 연결을 제안하며 자동 등록하지 않는다. 다른 거래소 표기나 여러
후보는 검토 대상으로 남긴다. 공개 후보 생성은 식별자 충돌·수집 실패·지연·기준일 미확정
보수·종목 후보 전체 덤프를 차단한다. SEC/후행 수익률은 60일, 일별 지표는 5일 기준이다.

첫 검토에서 catalog ISIN이 없거나 체크섬/형식 검사를 통과하지 못한 항목 18개가 발견되었다.
이는 공식 출처와의 전수 대조 완료를 뜻하지 않는다. IWM의 기존 ISIN `JP5841360000`도
출처 대조 대상으로 확인했으며, catalog와 개인 거래를 수정하지 않았다. 확대 수집 시
공식 상품 식별자와 catalog가 충돌하면 공개 연결을 보류한다. 최초 후보 연결 제안은
Nasdaq listed 226건, other listed 369건이며, 검토 완료나 신규 등록 건수가 아니다.

## 4단계: 무료 출처 정책

`data-v2/source-policies.json`에 공식 이용 조건의 근거·발췌·확인일·표시 의무·제외 범위를
기록했다. ECB와 SEC의 공식 안내를 2026-10-22 확인했으며, ECB 참고 환율·정책금리 및
SEC의 구조화된 사실·공시 메타데이터만 승인한다. 로고·첨부 원문·저자 명시 논문은 제외한다.
가공값은 가공 사실을 표시하며, ECB 자료가 유료 문서에 포함되면 무료 원본 제공 사실을
구매자에게 고지해야 한다. Nasdaq·iShares의 대량 공개 재배포 조건은 미확정으로 유지한다.

공개 후보는 무료 여부·표시·재배포·영역별 허용 범위를 모두 검증하고 정책 전문 메타데이터를
manifest에 넣는다. 단순 `publicDisplay` 토글만으로 통과하지 못한다. 정책 변경은 수집
fingerprint를 무효화하며, 저장 원문 재처리를 거쳐야 다시 공개할 수 있다. 기존 운영의
Yahoo 등 시세 공급 조건을 이번 검토로 승인한 것으로 해석하지 않는다.

## 5단계: 영역별 릴리스와 ETF 상세 연결

`scripts/data_platform/releases.py`는 승인된 출처만 골라 품질 검사 후 개체별 projection을
생성한다. `datasets/{영역}/releases/{버전}/manifest.json`과 개체별 JSON을 먼저 검증·발행하고
`datasets/{영역}/current.json`을 조건부 갱신한다. 배당 core 포인터와 독립적이다.
보유자산은 상위 10개 요약과 전체 위치 파일로 나뉜다. 전체 위치 파일은 앱에서 자동 요청하지 않는다.

```sh
python scripts/data_platform/releases.py --dataset fx --release-id fx-review-001 --output var/data-platform/releases/fx-review-001
# 같은 명령에 --publish를 명시하면 기존 공개 R2 환경변수로 발행 (현재 원격 미검증)
# 직전 릴리스로 복구: 현재 버전 일치·정책 불변·파일 무결성·48시간 이내 조건을 검증
python scripts/data_platform/releases.py rollback --dataset fx --release-id fx-review-001 --expected-current fx-review-002
```

종목 상세의 상세정보 탭에 공식 ETF 운용정보 컴포넌트를 연결했다. 활성화는
`VITE_DATA_PLATFORM_BASE_URL`에 공개 릴리스 root를 지정한 뒤 재빌드하는 방식이다.
기본값은 비활성이고 추가 요청이 없다. 공식 운용지표는 포인터·manifest·종목 파일 3개를
공용 캐시로 공유하며, 보유자산 버튼을 누를 때 해당 영역의 3개 파일을 추가 조회한다.
기준일·단위·출처·자료 미제공·실패/재시도를 구분하고, 탭 재진입은 캐시를 재사용한다.

IVV 자료의 공개 이용 조건은 아직 미승인이므로 ETF 릴리스 생성은 차단되며 실제 앱 설정을
활성화하지 않았다. UI는 합성 응답으로 모바일·다크 모드·재시도·지연 조회를 검증했다.
실제 공개 후보·원격 업로드·운영 앱 전환은 각각 별개이며, 이번 단계에서 운영 전환을
완료한 것으로 보고하지 않는다. Firebase·개인 계좌 조회는 추가하지 않았다.

### 공개 릴리스 캐시 최적화 (2026-10-22)

`releaseCacheOptions`는 `core/releases/{버전}/…json`과
`datasets/{영역}/releases/{버전}/…json`에만 장기 캐시를 적용한다.
포인터는 조회가 발생할 때 메모리에서 60초 재사용하고, 그 뒤 `no-store`로 확인한다.
강제 새로고침은 포인터를 `reload`로 확인하며 버전이 같으면 하위 파일을 재요청하지 않는다.
버전 파일은 제한된 메모리 캐시에 24시간 보관하고, 실제 HTTP 조회에는 `default`를 써서
서버의 Cache-Control과 브라우저 HTTP 캐시를 따른다. `force-cache`로 만료 자료를 강제
재사용하지 않는다. 메모리 한도 96개·8백만 문자, 동시 조회 공유와 소비자별 취소를 유지한다.

공식 ETF·프런트 core 목록/배당 원장에 적용하며, 서버 core 소비자도 포인터 확인과
manifest 캐시를 분리하고 해시 검증한 버전 파일을 최대 24시간 재사용한다. 서버 캐시는
프로세스별 제한된 메모리이므로 새 서버 인스턴스의 첫 조회는 별개다. 계좌·인증·변동 시세
경로에 장기 HTTP 캐시를 추가하지 않는다. 실패·스키마 오류는 정상 메모리 캐시에 넣지
않으며, 잘못된 200 응답이 브라우저 HTTP 캐시에 남은 경우 다음 시도에 `reload`한다.

R2 발행기는 이미 포인터 `public, max-age=60`, 버전 파일
`public, max-age=31536000, immutable`을 설정한다. Vercel의 같은 경로에도 헤더를
명시하여 일반 JSON의 1시간·stale-while-revalidate 설정이 포인터에 적용되지 않도록 한다.
포인터는 `must-revalidate`를 설정한다. GitHub Pages 자체의 HTTP 헤더는 이 설정으로
바뀌지 않으므로 배포 방식별 헤더를 구분한다.

Playwright 라우팅을 쓰면 HTTP 캐시가 비활성화되므로 별도 실제 로컬 HTTP 서버와
Chromium으로 검증했다(`tests/public-release-cache.browser.mjs`). 아래는 테스트 서버의
요청 수이며 Cloudflare CDN·R2 청구량 측정이 아니다.

| 동작 | 테스트 서버 요청 |
| --- | --- |
| 동시 최초 조회 | 3 |
| 메모리 캐시가 유효한 재진입 | 0 |
| 3분 후 같은 릴리스 조회 | 포인터 1 |
| JS 메모리 만료 후 조회 | fetch 호출 3, 서버 요청은 포인터 1 |
| 페이지 재로딩 후 같은 릴리스 조회 | 포인터 1, 하위 파일은 HTTP 캐시 |
| 새 릴리스 강제 확인 | 3 |
| 이전 릴리스로 롤백 | 포인터 1 |
| 잘못 캐시된 개체 응답 수정 후 재시도 | 개체 1 |

`publicJsonFor().metrics()`의 `fetchRequests`는 브라우저 HTTP 캐시 응답까지 포함한
fetch 호출 수다. 기존 `networkRequests`는 호환용 동일 값이며 실제 네트워크 요청 수가
아니다. `cacheHits`는 JS 메모리 재사용, `sharedRequests`는 진행 중 조회 합치기다.
`responseCacheStatuses`는 읽을 수 있는 CF-Cache-Status 헤더의 관측 집계이며,
헤더가 없거나 CORS로 가려지면 UNKNOWN이다. HTTP 캐시가 예전 헤더를 재사용할 수도
있으므로 이 집계를 CDN 적중률·R2 원본 읽기나 청구 횟수로 해석하지 않는다.

2026-10-22 읽기 전용 운영 점검: 공개 `divgrow-data` 버킷의 사용자 도메인은 0개이고
관리형 r2.dev 접근만 활성이다. 포인터 GET과 manifest HEAD 각 1회에서 200과 위
Cache-Control 값을 확인했으며 CF-Cache-Status·Age는 없었다. 비공개 버킷은 변경하지 않았다.
[Cloudflare R2 공식 문서](https://developers.cloudflare.com/r2/buckets/public-buckets/#caching)는
CDN 캐시에 사용자 도메인이 필요하고 JSON 캐시에는 별도 캐시 규칙이 필요함을 안내한다.
사용자 요청에 따라 도메인 연결과 실제 CDN 설정·적중률 측정은 보류한다.

향후 도메인 연결 시 공개 버킷의 버전 경로에만 캐시 허용 규칙을 적용하고, 원본
Cache-Control을 존중하며 포인터의 60초 TTL을 덮어쓰지 않는다. 비공개·계좌·API
경로에는 적용하지 않는다. CORS 진단 헤더 준비는 다음 명령으로 검토할 수 있다.

```sh
# 기존 origin·메서드·헤더를 보존하는 dry run. 실제 적용에는 별도로 --apply가 필요하다.
python scripts/data_v2/configure_cors.py --expose-cache
```

이는 ETag·Age·CF-Cache-Status 응답 노출을 추가하는 선택 옵션이며 이번 작업에서는
운영 CORS를 변경하지 않았다. 실제 측정에는 공개 데이터 도메인의 HIT/MISS, R2 작업
집계·데이터 접근 로그를 같은 관측 기간에 대조해야 한다. 브라우저 요청 수만으로
R2 절감률을 추정하지 않는다. fetch 캐시 모드 근거:
[MDN Request.cache](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache).

## 6단계: ETF·기업 공시 확대

16개 출처에서 IVV·IWM·EFA·EEM·AGG의 운용지표/보유자산과 AAPL·MSFT·NVDA의 최근 공시를
수집한다. 상품 페이지의 CUSIP과 이름·ticker, SEC의 CIK와 ticker를 대조한다.
같은 실행의 SEC 요청은 호스트별 최소 1초 간격으로 직렬 처리한다.

| ETF | 보유자산 행 수 |
| --- | ---: |
| IVV | 508 |
| IWM | 1,986 |
| EFA | 687 |
| EEM | 1,213 |
| AGG | 13,451 |

AGG는 ticker가 없는 채권 CSV이므로 ISIN·CUSIP·SEDOL·만기·쿠폰을 구분자로 보존한다.
액면 수량·듀레이션·YTM·최저 수익률·실질 듀레이션 등 열을 함께 보관하고,
주식 수량과 채권 액면 수량을 같은 의미로 바꾸지 않는다. 원문 보완 재처리는 HTTP 0건이었다.

현재 관측값은 총 31,295건(종목 후보 13,256 / 보유자산 17,845 / 운용지표 40 /
보수 5 / 환율 29 / 공시 120)이다. IWM의 공식 CUSIP `464287655`에 대응하는 ISIN과
기존 catalog가 충돌하므로 IWM 두 출처를 공개 연결에서 격리한다. catalog·개인 거래는
수정하지 않는다. 모든 iShares 자료는 이용 조건 미확정으로 공개 배포가 계속 차단된다.

## 7단계: 가격 공급 계약과 전환 보류

`data-v2/market-provider-decision.json`에 검토한 공급자의 근거와 미충족 조건을 기록했다.
검토한 후보 중 무료 공개 제공·재배포 권리, 필요한 이력·분할·정정 범위와 설정된 접근을
함께 충족하는 공급자는 아직 선정하지 못했다. 모든 무료 공급자가 불가능하다는 결론은 아니다.
기존 2,165개 가격 경로를 유지하며 과거 자료 이관·새 가격 공급 활성화는 시작하지 않는다.

후속 adapter는 `market_contract.py`의 가격/분할 검증을 통과해야 한다. 가격에는 안정된
개체·출처 원문·통화·거래일·coverage·보정 기준을 명시한다. 보정 기준은 `unadjusted`,
`split_adjusted`, `total_return_adjusted`로 구분하며 보정된 가격에는 보정 기준일을 넣는다.
종가만 있는 자료로 OHLC를 만들거나 거래량 미제공을 0으로 채우지 않는다. 거래량은 주 단위로
정규화할 공식 근거가 있어야 한다. 분할 비율은 `newShares / oldShares`이고, 합병·분사 등은
이 첫 계약에 포함하지 않는다. 정정은 기존 관측값 revision을 사용하고 원문을 보존한다.

계약의 정밀도·결측·OHLC 범위·보정 기준·거래량 단위·분할 방향 검증을 추가했다.
무료 공급자 선정과 병행 대조가 완료되기 전 가격 공급 독립 완료로 보고하지 않는다.

## 8단계: 재무·정책금리·보유자산 분석

SEC Company Facts에서 AAPL·MSFT·NVDA의 매출·순이익·영업현금흐름·자산·부채·현금·
설비투자·배당 지급액·자본을 수집한다. 원문에서 제공하는 US-GAAP 태그별로 통화·보고기간
시작/종료·서식·접수번호·공시일·회계연도/분기를 유지한다. 태그별 최근 60개 관측값을
보관하며 다른 태그나 기간을 임의 합산하지 않는다. 수정 공시는 원 공시와 별도 근거로 남긴다.
보고된 항목이 없는 경우 0으로 채우지 않는다. 이번 실수집은 AAPL 636 / MSFT 631 / NVDA 563건이다.

ECB 공식 정책금리 표에서 최근 30개 효력 발생일의 금리 90건을 수집했다. 예금금리·
주요 재융자 고정/변동입찰 금리·한계대출 금리를 구분하고, 기준일은 수집일이 아닌 효력일이다.
각주·미제공 표시·음수 기호를 분리해 정규화한다. 파서 수정은 저장 원문으로 재처리했다.

현재 20개 출처에 관측값 총 33,215건이 있다. 재무·거시의 개체별 공개 검토 릴리스도
로컬 생성했으며 원격 공개 발행은 하지 않았다.

```sh
npm run data:release -- --dataset financials --release-id financials-review-001 --output var/data-platform/releases/financials-review-001
npm run data:release -- --dataset macro --release-id macro-review-001 --output var/data-platform/releases/macro-review-001
npm run data:analytics -- --output var/data-platform/analytics/holdings-review-001
```

비중 분석은 기존 보유자산만 읽어 ETF 5종의 업종·Location·시장 통화별 합계를 계산한다.
입력 원문·파서·설정 버전과 입력 품질 상태, 산식 버전 `issuer-reported-weights-v1`을 기록한다.
결과는 `derived_estimate`이며 원문의 반올림 비중을 합산한 값이다. 음수·0·결측을 보존하고
합계를 강제로 100%로 만들지 않는다. 경제적 국가/통화 위험이나 헤지를 반영한 실질 노출도가 아니다.
모든 분석 산출물은 비공개 후보이며, iShares 이용 조건과 IWM 식별자 충돌은 그대로 적용된다.

## 운영 활성화에 남은 조건

| 영역 | 구현/검증 | 남은 조건 |
| --- | --- | --- |
| 비공개 저장·정기 수집 | 전용 secrets 등록, 실제 최초 수집·백업과 새 환경 DB 복원 성공 | 전체 원문 복원은 유지보수 workflow에서 판정. 기본 브랜치 반영 전 일별 스케줄은 비활성 |
| 식별자·품질 | 연결 제안·단위·날짜·정정·신선도 검사 | IWM 정정과 기존 18건 검토 완료. TSYW·BRK.A 보충 후 활성 누락 0건·비활성 미확정 16건 |
| 공개 릴리스·앱 | 영역별 projection·발행/복구 코드와 ETF UI 검증 | iShares/Nasdaq 공개 이용 조건 확인. ETF 기능 기본 비활성 |
| 가격 공급 | 계약과 무료 공급자 검토 기록 | 적합한 무료 공급자 선정·접근·병행 대조·과거 이관 |
| 재무·거시·분석 | 실제 SEC/ECB 수집과 ETF 5종 비중 분석 | 원격 발행/소비 활성화와 후속 범위 확대 |

GitHub `data-production` 환경에 `DATA_PRIVATE_R2_ACCOUNT_ID`, `DATA_PRIVATE_R2_ACCESS_KEY_ID`,
`DATA_PRIVATE_R2_SECRET_ACCESS_KEY`가 2026-10-22 사용자에 의해 등록됐다. 버킷명은 workflow에
비공개 버킷으로 고정했다. secrets 관리 API의 403 때문에 등록은 사용자가 수행했으며, 값은
채팅·Git·로그로 전달하지 않았다. 최초 bootstrap과 별도 Actions 환경의 두 DB 복원을 확인했다.
`work` ship은 운영 `main` 승격이나 스케줄 활성화를 포함하지 않는다.


## 비공개 백업 보존·복구 점검

`retention.py`는 기본 30일·최소 최근 7개 스냅샷·7일 유예 기간을 적용하는 **삭제 계획**만
생성한다. 현재·핀 지정 manifest와 그 참조 객체를 보호하며, 원문 역사도 현재 manifest가
참조하면 삭제하지 않는다. 인벤토리 10만 개 초과·손상 manifest·참조 누락은 중단한다.
대상은 내용 주소 manifest/objects로 제한하며 알 수 없는 키는 보호한다.

```sh
python scripts/data_platform/retention.py --output var/data-platform-review/retention.json
# R2용: 모든 platform/v1 작성자가 공용 잠금을 준수하는 경우의 별도 계획
python scripts/data_platform/retention.py --delete-mode exclusive-writer --output var/data-platform-review/retention-r2.json
# 위 명령의 planSha256과 비공개 계획의 삭제 대상을 확인한 후에만 사용
python scripts/data_platform/retention.py --apply-plan var/data-platform-review/retention.json --plan-sha256 REVIEWED_SHA256
python scripts/data_platform/operations.py drill
```

적용은 24시간 이내의 정확한 계획 해시를 요구하고 원격 인벤토리·포인터를 재검증한다.
실제 데이터 삭제 전에 임시 UUID 객체로 잘못된 ETag의 PUT/DELETE가 거절되는지 확인한다.
2026-10-22 이 버킷의 S3 실환경에서는 잘못된 ETag의 DELETE가 거절되지 않아
실제 보존 정리 적용을 차단했다. 근거: https://github.com/totobubu/yieldloom-app/actions/runs/39782326752
전체 복원 점검은 이 제한을 `conditionalDelete: false`·`retentionApply: blocked_conditional_delete_unsupported`로
보고하고 계속 수행한다. 기본 `conditional` 계획은 실제 백업 객체 삭제 전에 계속 중단한다.
R2에는 `exclusive-writer` 계획을 별도로 생성할 수 있다. 삭제 방식은 계획 본문과 검토 해시에
포함되므로 기존 계획의 방식을 바꾸어 적용할 수 없다. schemaVersion 1 계획은 재생성해야 한다.

이 방식은 조건부 PUT으로 취득한 **만료 없는 공용 writer 잠금** 안에서 검토 당시 시각으로
전체 계획을 다시 계산하고 일치를 확인한다. 임시 UUID 객체로 중복 생성·잘못된 ETag의 PUT이
거절되는지와 직렬 삭제를 검증한 뒤, 각 삭제 직전에 잠금 owner/body/ETag를 다시 확인한다.
내용 주소 manifest/objects만 삭제하며 current·writer·알 수 없는 키는 허용하지 않는다.
정리와 백업이 같은 잠금을 사용하므로 정리 중 새 백업이 참조를 발행할 수 없다.
잠금은 시간 경과로 탈취하지 않으며, 장애 후 복구는 실제 writer 종료 확인이 필요하다.
DELETE 응답이 실패하거나 시간 초과로 결과를 확정할 수 없으면 잠금을 해제하지 않는다.
이 경로의 DELETE는 SDK 자동 재시도도 끈다. 앞선 요청이 진행 중인데 재시도 성공만으로
잠금을 해제하는 일을 막는다.
늦게 완료되는 삭제와 다음 writer의 객체 재생성이 겹치지 않도록 원격 요청의 종료도 확인한 뒤 복구한다.

이는 S3의 원자적 조건부 DELETE와 같은 보장이 아니다. Dashboard·다른 도구의 쓰기·삭제나
잠금을 무시하는 writer는 함께 사용하면 안 된다. `platform/v1/`에 lifecycle 만료 규칙을
걸지 않는다. 수동 과거 복원에 필요한 manifest는 계획에 pin을 추가한다. 이 전제를 지킬 수
없으면 기본 차단 방식을 유지한다. 현재 workflow는 직렬 삭제의 **시험 객체**만 지우며,
실제 체크포인트 삭제는 검토한 계획·정확한 해시를 전달하는 CLI에만 있다.
근거: [R2 조건부 PUT 원자성](https://developers.cloudflare.com/r2/reference/consistency/#conditional-writes).

복구 점검의 `serializedDelete: true`, `serializedProbeRemoved: true`는 이 별도 경로의
연결 검증이며, `serializedRetentionApply`는 검토된 계획·공용 잠금이 필요한 상태임을 표시한다.
실패한 점검의 임시 probe가 남아도 보존 정리는 이를 삭제하지 않는다.
복구 점검은 모든 원문·압축 DB를 새 임시 경로로 완전히 복원하고 해시·SQLite 무결성을
검증한 뒤 로컬 복원물을 제거한다. 빈 버킷은 연결 점검만 통과하며 복원 완료로 표시하지 않는다.

백업·정리·복구 점검은 `platform/v1/writer.json`의 조건부 원격 쓰기 잠금을 공유한다.
체크포인트가 실제 생성될 때만 잠금 GET 2회·PUT 2회가 추가된다. 수집 주기가 아닌 실행은
기존 GET 4회·PUT 0회를 유지한다. 임의 만료·잠금 탈취는 하지 않는다. 중단 후 잠금이 남으면
모든 쓰기 작업이 종료됐는지 확인하고 다음 명령에서 읽은 owner/ETag로만 복구한다.

```sh
python scripts/data_platform/operations.py inspect-writer
python scripts/data_platform/operations.py recover-writer --writer-stopped --expected-owner INSPECTED_OWNER --expected-etag INSPECTED_ETAG
```

`maintain-data-platform.yml`은 수동 복구 점검과 선택적인 삭제 계획 계산만 제공한다.
수집 workflow와 동일한 concurrency를 사용하고 비공개 원문·DB·상세 계획은 artifact로 올리지 않는다.
선택적 계획은 R2용 `exclusive-writer` 방식으로 계산한다. 계획 계산 자체는 읽기 전용이다.
스케줄 삭제와 Actions 삭제 입력은 제공하지 않는다. 유지보수 workflow 자체를 `work`에 변경하면
복구 점검을 한 번 실행하여 기본 브랜치 승격 전에도 실행 대상을 등록한다. 이후 수동 실행으로
복구 점검과 선택적인 보존 계획을 확인할 수 있다. 이 실행은 체크포인트를 삭제하지 않는다.
전용 S3 secrets는 2026-10-22 등록 후 실제 R2 조회와 최초 수집·체크포인트 생성이 통과했다.
실행 근거: https://github.com/totobubu/yieldloom-app/actions/runs/39780606319
전체 복원 성공은 유지보수 workflow의 `restore: verified` 결과로 판정한다.
최초 수집은 20 HTTP 요청·실패 0건·`healthy`였고, R2 API 시도는 GET 26회·PUT 26회,
업로드 37,908,602바이트였다. 새 Actions 환경의 후속 실행은 두 DB를 복원하고
`checkpoint: unchanged`, HTTP 0회·R2 GET 4회·PUT 0회·다운로드 8,790,017바이트를 기록했다.
후속 실행: https://github.com/totobubu/yieldloom-app/actions/runs/39781165745
이 요청 수는 애플리케이션의 논리 시도이며 실제 과금 금액이나 SDK 내부 재시도 수가 아니다.


## 검토된 식별자 정정

2026-10-22 iShares 공식 IWM factsheet의 2026-06-30 자료에서 ISIN `US4642876555`,
CUSIP `464287655`, USD 및 NYSE Arca 상장을 확인했다.
근거: https://www.ishares.com/us/literature/fact-sheet/iwm-ishares-russell-2000-etf-fund-fact-sheet-ja-jp.pdf
`identity-corrections.json`에 이전 값·종목·시장·통화와 근거를 기록하고 catalog seed를 정정했다.
빌더는 이전 값 또는 정정 값과 정확히 일치할 때만 적용하며, 예기치 않은 식별자/시장/통화는
실패시킨다. 구 `JP5841360000`는 이 종목의 별칭으로 등록하지 않는다. 개인 거래의 자동 재연결이나
수정은 수행하지 않는다. 이전 절의 IWM 격리 설명은 정정 이전 실행의 기록이다. 이 변경은
공개 이용 조건 승인이나 기존 공개 릴리스 재발행을 의미하지 않는다.


## 기존 식별자 18건 검토 결과

2026-10-22 TSYW·BRK.A의 공식 식별자를 보충했다. 기존 제공 상태를 유지하며,
활성 종목 ISIN 누락은 0건, 비활성 미확정은 16건이다. `quality` 보고서는
`catalogActiveInvalidIsinCount`와 `catalogInactiveInvalidIsinCount`를 구분한다.
개별 판정과 근거는 [18건 검토 기록](IDENTITY_REVIEW_2026-10-22.md)과
`data-v2/identity-review.json`을 참조한다. 비활성·형식 오류·이름 충돌을 자동 별칭이나
상장폐지로 판정하지 않으며 개인 거래는 변경하지 않는다.

## 조회 요청과 영속 작업 실행 기반 (운영 미활성)

`discovery_requests.request_collection`은 서버가 신뢰하는 catalog의 티커·거래소를
정확히 대조하고, ISIN·통화·상장일이 있으면 상장일부터 요청 종료일까지 가격/배당
작업을 등록한다. 같은 요청과 종료일만 늘어난 요청은 기존 구간을 재사용한다.
미등록 종목은 최근 48시간 이내 성공한 공식 Nasdaq 디렉터리의 현재 관측값으로
티커·거래소를 대조한다. 이름 검색 결과나 과거에 삭제된 listing은 등록하지 않는다.
일치한 신규 listing은 비공개 `identity_enrichment_pending` 상태로 보관한다.
이 목록에는 통화·상장일·ISIN이 없으므로 이를 추정하여 공개 catalog로 승격하지 않는다.

`collection_worker.run_next`는 기본 비활성이며 호출자가 등록한 adapter만 실행한다.
기존 platform writer lock 안에서 실행하고 기존 두 DB/원문 체크포인트에 저장해야 한다.
출처별 실행 작업은 하나로 제한하고, 실패는 출처 전체에 지수 backoff를 적용한다.
프로세스 종료를 확인한 운영자만 `collection_jobs.recover(..., worker_stopped=True)`로
소유 토큰을 대조해 작업을 재개한다. 시간 만료만으로 실행 중인 작업을 탈취하지 않는다.
이전 소유자의 늦은 완료 처리는 거절한다. adapter는 재실행에도 중복 저장되지 않아야 한다.
빈 adapter 결과는 `partial`이며, 전체 요청 구간과 저장된 원문 근거가 있어야만
`complete`/`no_dividends`로 기록한다. 부분 완료 구간은 자동으로 완료 처리하지 않는다.

일봉 API의 비공개 outbox는 `market/v1/requests/{symbol}.json`이며 조건부 쓰기로
요청 종료일이 뒤로 이동하지 않게 한다. 기존 `run.py`의 명시적인
`--request-symbol AAPL` 입력이 이 요청을 읽고 catalog 식별자를 재검증하여 큐에 등록한다.
최대 20개 대상 요청과 실행당 가격 작업 1개로 제한한다. 추가 인자가 없는 기존 정기
워크플로는 이 경로를 실행하지 않는다. 성공 관측과 실패/backoff 상태는 기존 두 DB 및
원문 체크포인트에 함께 보존한다. 가격 요청은 query1 → query2 순으로 기존 고정 호스트
transport와 파서를 재사용한다. 정상 응답도 거래일 전체 범위와 분할 보정이 입증되지
않으면 `partial`로 유지하며, 날짜 누락을 삭제하거나 변경된 과거 가격을 자동 확정하지 않는다.

`--request-dividends`를 함께 지정하면 공식 배당 작업 1개와 기존 core 검증 기준의
비공개 후보 검토를 수행한다. 등록된 공식 수집기를 재사용하며 Roundhill은 운용사
출처를 먼저 시도하고 등록된 공식 공시로 보완한다. 새로운 임의 URL은 받지 않는다.
종목·통화·요청 연도를 대조하고 원문을 보관하며, 변경된 이벤트는 충돌로 발행 후보에서
제외한다. 후보는 기존 전체 확정 이력과 비교하므로 누락/정정/중복이 있으면 ready가
되지 않는다. 이 단계는 core pointer를 쓰거나 승인 상태를 변경하지 않는다.

Node API → outbox → Python 큐 → 실제 제공처 파서 → SQLite 저장/재조회 및 공식
수집기 → 후보 → 기존 core builder/validator를 합성 HTTP/저장소로 검증했다.
실제 제공처 읽기·운영 쓰기·배포는 수행하지 않았다. 신규 listing의 안정 식별자 보충,
자동 대상 발견 스케줄, 공개 발행 활성화는 남아 있다. 축적된 Python 가격 원장은
현재 비공개 read model이며 브라우저에 장기 backfill을 제공하는 공개 projection 전환도
별도 검증이 필요하다.

## OpenDART 단일 기업 재무제표 어댑터 (기본 비활성)

`opendart.collect_financials`는 공식 `fnlttSinglAcntAll.json` 응답을 기존 비공개
원문·관측 원장에 연결한다. 기업 고유번호 8자리, 사업연도, 보고서 코드 및 CFS/OFS를
명시하고 `enabled=True`로 호출해야 하며 서버의 `OPENDART_API_KEY`를 사용한다.
키는 요청 시에만 사용하고 저장하는 출처 URL에서 제외한다. 기본 transport의 요청
실패는 URL/키를 포함하지 않는 오류로 변환한다. 키가 응답에 포함되면 보관을 거절한다.

기업·보고서·사업연도·재무제표 기준을 대조하고, 당기/전기/전전기 금액과 기간 명칭을
분리한다. 0은 보존하고 미제공 표시는 관측값으로 만들지 않는다. 없는 보고기간 날짜를
수집일로 채우지 않는다. status 013은 `report_not_returned`로 기록하며 이전 관측은
보존한다. 재무제표의 배당 지급액을 주당 배당금/배당 일정으로 변환하지 않는다.

검증은 합성 응답과 임시 SQLite 저장소에서 수행했다. 실제 API 조회, 기업코드 자동
매핑, registry의 활성화, 정기 수집·공개 배포는 포함하지 않는다. 기존
`opendart-financials` 등록부의 disabled 상태는 유지한다.

### 2026-10-27 연결 검증과 비활성 전환 경로

- `DATA_CANDLE_READ_OWNED=true`는 별도의 비공개 `market/v1/read-models/`를
  읽어 일봉 API 응답에 장기 이력을 합치는 선택 경로다. 기본값은 비활성이다.
  카탈로그의 종목·ISIN·거래소·통화·상장일을 대조하고, 읽기 실패 시 기존 조회를
  유지한다. 공급자 오류 시 저장 이력을 stale로 반환하며 과거 행/충돌 표시는 보존한다.
- `owned_price_model.export_model`은 원장의 실제 OHLC 관측값으로 로컬 검토 파일을
  생성한다. 종가만 있는 행은 OHLC를 추정하지 않고 제외 개수를 표시한다.
  기존 파일 덮어쓰기나 원격 공개는 수행하지 않는다. 원격 read-model 발행은 아직 미연결이다.
- `resolve_registered_listing`은 보류 중인 종목을 서버의 검토된 카탈로그와 정확히
  대조하고 ISIN 체크섬을 확인한 뒤 상장 이후 수집을 요청한다. 안정 식별자가 없으면
  보류한다. 임의의 티커를 검색하는 것만으로 계산 가능한 종목으로 승격하지 않는다.
- `schedule_bridge.resolve_and_enqueue`는 기존 제공처 일정 해석기를 호출한다.
  기본 owner는 legacy이며 queue를 명시한 경우에만 공용 큐로 전달한다. 동일 슬롯은
  영속 receipt로 합치고 실행 중 작업을 빼앗지 않는다. 운영 전환 시 기존 실행자와
  공용 큐 중 하나만 소유하도록 해야 한다. 워크플로/cron은 변경하지 않았다.
  PR #164 (`9bac1e2`)의 YieldMax 일정·공용 해석기와 필요한 호환 변경을 재사용했다.
  실제 일정 해석 → 큐 등록 → 동일 슬롯 재사용을 테스트했다. 운영 워크플로는 가져오지 않았다.

실제 제공처 소수 읽기 검증(운영 저장 없음): Yahoo AAPL 5일 요청에서
2026-10-20~26의 일봉 5개, YieldMax TSLY 공식 페이지에서 배당 이벤트 89개,
OpenDART 삼성전자 2025년 사업보고서 CFS에서 상태 `000`, 원문 229행을
686개 재무 관측값으로 파싱했다. 이는 상장 이후 완전성이나 운영 발행 검증이 아니다.
OpenDART 비표준 계정 ID의 이름별 구분을 보완했으며 키/원문은 검증 로그에 남기지 않았다.
장기 원본 이관은 읽을 수 있는 실제 원본이 없어 합성 자료 대조까지만 검증했다.


### 계산 및 관리자 상태 연결 (후속 구현)

- 라이벌 비교는 요청한 최근 1년, 매수 시점별 배당률은 실제 표본의 선행 12개월까지
  `collectionCoverage`를 확인한다. 검증 자료가 없거나 기간이 짧으면 참고 계산임을
  카드에 표시한다. 기간 내 충돌/검토 대상 배당 또는 분할 검토가 있으면 계산을 보류한다.
  데이터 첫날·마지막 날만으로 완전성을 추론하지 않는다. 신규 원장 가격 모델에도
  이 계약을 포함하며 미검증 가격 조정 기준은 완전으로 승격하지 않는다.
- 기존 관리자 수집 기록 GET에 비공개 상태 조회를 함께 제공한다. 별도 수집 요청은
  만들지 않는다. 확보 기간, 출처, 마지막 관측 성공, 미해결 오류를 표시한다.
  기존 큐에 오류 시각이 없어 오류 발생 시각은 미확인으로 표시한다.
- 타겟 runner의 `--write-status`를 명시해야 체크포인트 이후 상태 JSON을 저장한다.
  기본 비활성이며 `market/v1/status/<symbol>.json`만 쓴다. 수집 전 ETag를 사용해
  뒤늦은 작업이 새 상태를 덮어쓰지 못하게 한다. 조회도 별도
  `DATA_COLLECTION_STATUS_READ=true` 설정이 필요하다. 이번 작업에서 둘 다 활성화하지 않았다.
- 로컬 Chromium에서 실제 관리자 Dialog와 비교 카드를 합성 응답으로 확인했다.
  390/1280px, 밝은/어두운 테마, Escape 닫기, 재열기 시 요청 재사용을 검사했다.
  운영 인증·운영 데이터 화면 검증은 아니다.

실제 원본 접근 조사: 앱의 `data-v2/market-sources.json` AAPL 경로와 환경의
`VITE_R2_PUBLIC_URL`을 조합한 읽기 요청은 HTTP 403을 반환했다.
`THUMBNAIL_SOURCE_BASE_URL`, `R2_PUBLIC_URL`, 일반 R2 및 DATA_PRIVATE_R2 인증 변수는
현재 환경에 없다. 키 값은 출력하지 않았고 새 인증을 설정하지 않았다.
실제 원본-대상 행/해시 대조 및 운영 이관은 미완료다. 이 403의 응답 본문·헤더는
보존하지 않아 R2와 네트워크 프록시 중 어느 계층의 거부인지는 확정하지 않았다.


### 고정 범위의 식별자·보충·core 후보 연결

후속 acceptance 범위와 실제 접근 진단은 [COLLECTION_ACCEPTANCE.md](COLLECTION_ACCEPTANCE.md)에
정리했다. `--enrich-identities`는 이미 공식 목록에서 발견한 대상 두 개까지만 보충하며,
`--prepare-core-candidate`는 타겟 수집 결과를 로컬 검토 디렉터리에만 묶는다.
둘 다 기본 비활성이고 원격 후보 발행 기능은 없다. 후보 생성 오류가 나도 이미 수집한
원장과 재시도 상태의 체크포인트 저장은 진행한다.
