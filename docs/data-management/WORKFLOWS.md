# GitHub Actions 운영 안내

## 일상 운영

| 워크플로 | 용도 | 실행 시점 |
| --- | --- | --- |
| `content-studio-provider-refresh.yml` | 운영용 운용사 수집·검증·공개 Content Studio 갱신 | 기존 운용사별 일정, 수동 |
| `collect-incremental-data-v2.yml` | 전체 공식 배당 릴리스의 검토 후보 생성 | 매일 한국 시간 13:10, 수동 |
| `publish-data-v2.yml` | 후보 대조·검토 및 승인된 core 릴리스 발행 | 수동 |
| `refresh-thumbnail-projections.yml` | 시세 원본을 앱 조회용 R2 데이터로 가공 | 화~토 한국 시간 12:30, 수동 |
| `refresh-underlying-metadata.yml` | 공식 ETF 기초자산 갱신 | 월~금 UTC 08:20, 수동 |
| `collect-data-platform.yml` | 확장 영역 비공개 데이터 수집·체크포인트 저장 | 매일 한국 시간 09:30, 관련 work push, 수동 |
| `maintain-data-platform.yml` | 비공개 체크포인트 복구 점검·삭제 없는 보관 계획 | 해당 workflow의 work push, 수동 |

운영 수집과 core 후보 생성은 출력·발행 경로가 다르므로 둘 다 유지한다.
시간별 후보 생성은 운영 수집과 중복 요청을 줄이기 위해 하루 한 번으로 변경했다.
추가 후보가 필요하면 `collect-incremental-data-v2.yml`을 수동 실행한다. 날짜별
공식 원문 보충은 기존 `backfill=운용사:YYYY-MM-DD` 입력을 사용한다.
발행은 자동으로 수행하지 않으며 기존 전체 이력 대조와 `data-production` 절차를 유지한다.

`prepare-pilot-data.yml`의 초기 후보 생성 진입점은 제거했다. 신규 후보는 증분 수집으로
만들고, 발행에는 그 실행의 `incremental-data-v2-review-{run_id}` 아티팩트를 사용한다.
기존 Python 수집·분석 명령과 과거 실행 결과는 보존한다.

## 필요할 때 실행하는 진단

`diagnose-data-sources.yml`에서 `mode`를 선택한다.

- `providers`: 등록된 공식 운용사별 원문 한 건을 점검한다. 기존
  `probe-official-providers.yml`을 대체한다. 앱 데이터는 발행하지 않는다.
- `email`: 로컬 업로드 명령이 반환한 SHA-256 `evidence_id`로 이메일 증빙을
  공식 수집 상태와 대조한다. 기존 `analyze-email-evidence.yml`을 대체한다.
  OCR 결과를 처리하며, 기존과 같이 원본 이메일 대신 검토 보고서만 아티팩트로 저장한다.

두 모드는 독립 job이며 선택하지 않은 모드는 실행하지 않는다. 이메일용 자격 증명은
이메일 비교 step에서만 전달한다.

## 검사와 배포

`app-quality.yml`, `validate-data-v2.yml`, `validate-data-platform.yml`은 각각
앱·core 데이터·확장 데이터 계약을 검증한다. `deploy-pages.yml`은 main의 Pages 배포다.
배당 발행과 프런트엔드 배포는 서로 대체하지 않는다.

Playwright를 설치하는 수집·진단 job은 `ubuntu-24.04`로 고정한다.
시세 가공에서 원본 누락·이력 축소가 발생하면 기존 거절 및 실패 처리를 유지한다.
`refresh-thumbnail-projections.yml` 실행 요약의 거절 목록과 JSON 아티팩트에서
문제 종목·사유·기존 버전 보존 여부를 확인한다. 실패를 숨기거나 가격을 채우지 않는다.

이 설정은 main에 반영된 이후 정기 실행에 적용된다. GitHub cron은 기본 브랜치에서
실행되며, 지정 시각보다 늦게 실행되거나 혼잡 시 건너뛸 수 있다.
