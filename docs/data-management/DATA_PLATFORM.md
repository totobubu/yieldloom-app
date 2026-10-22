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
배당·세무 수집은 기존 파이프라인이 담당한다. 새 가격·분할 공급, 재무·거시 수집기,
노출도·분석 계산기는 아직 구현하지 않았다. OpenDART 인증·보고기간, KRX 이용 범위,
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
아직 정기 실행·원격 영속 저장소·공개 릴리스 포인터 전환은 연결하지 않았다.
CI는 fixture 테스트만 실행하므로 PR마다 외부 사이트를 수집하지 않는다.

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
보안을 대신하지 않는다. SQLite와 raw 디렉터리는 함께 백업한다. 자동 삭제는 하지 않는다.

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
원문을 내용 주소 객체로 저장하고, 원격 해시를 확인한 다음 manifest와 최신 포인터를 쓴다.
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
디렉터리를 노출한다. 실패 시 기존 디렉터리를 덮어쓰지 않는다. 원격 삭제·자동 보존기간은
설정하지 않는다. 현재 실행 환경에는 전용 S3 자격증명이 없고 GitHub secrets 관리 API는
403으로 거절되어, 실제 원격 업로드·복원은 아직 미확인이다. 메모리 원격 저장소를 통한
왕복 복원·업로드 실패·조건부 쓰기 충돌·손상 파일 검증은 통과했다.

## 2단계: 정기 수집과 상태 보고

`collect-data-platform.yml`은 한국 시간 09:30 일별 스케줄과 수동 실행을 제공한다.
스케줄·새 workflow의 수동 실행 등록은 기본 브랜치 반영 후 활성화된다. `work`에서는
관련 코드 병합 push로 검증한다. `main` 또는 `work`의 검토된 코드만 자격증명을 사용하며,
PR에서는 fixture 테스트만 한다. 스케줄 활성화를 위한 main 승격은 이번 ship에 포함하지 않는다.

실행은 항상 새 디렉터리에 체크포인트를 복원하고 마지막 성공 상태에 따라 증분 수집한다.
최초 실행만 명시적으로 bootstrap한다. 기존 포인터가 있는데 bootstrap하면 거부한다.
같은 작업의 GitHub concurrency와 POSIX 파일 잠금(Linux/macOS)으로 중복 쓰기를 막는다.
원문·DB를 Actions artifact/cache에 올리지 않는다. 오류 출처의 백오프 상태도 보존하고,
체크포인트 저장 실패는 성공으로 보고하지 않는다. 자동 복구 과정에서 빈 원장으로 초기화하지 않는다.

48시간 수집 성공 공백, 일별 데이터의 5일 기준일 지연을 경고한다. 공시 미발생은
데이터 지연으로 판정하지 않는다. Actions 요약에 건수·성공 시각·오류·신선도 상태만
남기고, 실패는 작업 실패로 표시한다. 외부 메일·메신저 발송은 추가하지 않는다.
전용 R2 secrets가 없으면 운영 작업은 수집 전에 실패한다. 현재는 해당 설정이 미완료다.

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
