# GitHub Actions 운영 안내

## 일상 운영

| 워크플로 | 용도 | 실행 시점 |
| --- | --- | --- |
| `content-studio-provider-refresh.yml` | 운영용 운용사 수집·검증·공개 Content Studio 갱신 | 기존 운용사별 일정, 수동 |
| `observe-roundhill-topw.yml` | TOPW 월요일 발표 집중 수집·누락 재확인 | 월 21:45~22:30 5분 간격, 월 23:00·화 09:00, 수동 (한국 시간) |
| `observe-roundhill-magy.yml` | MAGY 목요일 발표 집중 수집·누락 재확인 | 목 19:45~20:30 5분 간격, 목 21:00·금 09:00, 수동 (한국 시간) |
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

## TOPW 월요일 발표 관찰

`observe-roundhill-topw.yml`은 메일함에서 관찰한 월요일 22시 전후 발송 패턴을
초기 일정으로 사용한다. 메일은 읽지 않으며, 기존 Roundhill 수집기의 공식 거래소
Cboe 공시 경로를 재사용한다. 운용사 웹사이트 직접 수집은 이 작업에 포함하지 않는다.
메일 도착과 Cboe 게시 시각이 같다고 가정하지 않는다.

- 한국 시간 월요일 21:45~22:30에 5분 간격으로 실행하고 23:00과 화요일 09:00에
  재확인한다. UTC cron은 월요일 12:45~13:30, 14:00 및 화요일 00:00이다.
- 실행 시 서울 날짜로 해당 주 월요일을 계산한다. 화요일 복구 실행도 월요일
  공시를 조회하며, 저장된 전주 공시 URL을 재사용하지 않는다. Cboe 요청은
  `symbols=TOPW`, `declaration_dt=해당 월요일`로 한정해 회당 원문 1건만 조회한다.
- 공식 또는 교차 검증 상태의 해당 월요일 TOPW 분배금과 배당락일·기준일·지급일이
  원장과 공개 스냅샷에 일치하면 외부 조회·재가공·원장 저장을 생략한다. 이전 발표, 검토 필요 자료,
  날짜 누락·역전은 수집 완료로 인정하지 않는다. 다른 티커는 저장하지 않는다.
- 발표 전 정상 무자료 응답은 `pending`, 수집 오류는 `failed`로 구분한다.
  화요일 최종 확인에도 발표가 없으면 `missing`으로 실패 처리한다. 휴일로 인한
  발표 지연도 임의 보정하지 않으며 이 상태에서 운영자가 확인한다.
- 기존 원장의 이벤트 식별자·변경 이력을 사용한다. 성공 후 관찰은 중단하며,
  이후 정정 확인은 기존 운용사 정기 수집을 유지한다. 미국 서머타임에 맞춘 자동
  시간 이동은 하지 않으며 관측 결과에 따라 이 초기 시간대를 조정한다.

실행별 `topw-observation-{run_id}` 아티팩트에 발표 대상 날짜·수집 상태·기존 수집
보고서를 30일 보관한다. 기존 `content-studio-state-write` 잠금을 공유해 R2 원장의
복원부터 저장까지 직렬화하며, 브랜치 실행은 별도 R2 상태와 해당 브랜치 출력만
수정한다. 전체 운용사 수집·순환 증빙 검증·유료 대체 공급자 호출은 시작하지 않는다.
Firebase/Auth 호출도 추가하지 않는다. 공개 스냅샷 검증과 core 발행 승인 절차는 유지한다.

정기 실행은 main 반영 후 활성화된다. GitHub Actions의 지연·누락 및 공유 잠금의
대기/대기 작업 교체 때문에 실제 5분 간격 실행을 보장하지 않는다. 복구 일정은
이 누락을 보완하기 위한 것이다. 실제 외부 요청 횟수는 각 실행 보고서로 확인한다.

수동 확인은 Actions의 **Observe Roundhill TOPW Monday announcement**에서 실행한다.
`declarationDate`를 비우면 서울 날짜 기준 이번 주 월요일, 지정하면 해당 월요일을
조회한다. 미래 날짜와 월요일이 아닌 입력은 거절한다. 로컬 실행도 같은 경로를 쓴다.

```sh
python scripts/content_pipeline/observe_topw.py
python scripts/content_pipeline/observe_topw.py --declaration-date 2026-10-26 --require-announcement
python -m unittest discover -s tests/content_pipeline -p 'test_topw_observation.py' -v
```

## MAGY 목요일 발표 관찰

`observe-roundhill-magy.yml`은 메일 목록에서 관찰한 목요일 20시 전후 발송 패턴을
초기 일정으로 사용한다. 한국 시간 목요일 19:45~20:30에 5분 간격으로 실행하고,
21:00과 금요일 09:00에 재확인한다. UTC cron은 목요일 10:45~11:30, 12:00 및
금요일 00:00이다. 금요일 복구 실행도 직전 목요일 발표를 대상으로 한다.

TOPW와 MAGY는 `observe_roundhill.py`의 공용 완료 감지·오류 처리·보고서를 사용한다.
기존 TOPW 명령과 일정은 유지한다. MAGY는 기존 공식 수집 대상에도 등록해 운용사
정기 수집과 수동 종목 수집에서도 공시를 읽을 수 있다. 초기 등록 시 Cboe의
2026-10-22 MAGY 공식 공시를 실제 조회해 주당 금액·배당락일·기준일·지급일을 확인했다.
메일 발송 시각을 공시 게시 시각으로 단정하지 않으며, 운용사 웹사이트 대신 기존
Cboe 공식 공시 경로를 재사용한다.

일반 실행은 `symbols=MAGY`와 해당 목요일 날짜로 공식 원문 1건만 조회한다.
원장과 공개 스냅샷에 같은 주의 완료된 MAGY 발표가 있으면 외부 요청은 0건이다.
다른 티커나 전주 자료는 완료로 인정하지 않는다. 전체 운용사 조회·관련 없는 종목
온보딩·유료 공급자·Firebase/Auth 호출은 추가하지 않는다. R2 쓰기 잠금과 공개
스냅샷 게시 재시도·검증·core 발행 승인 절차는 TOPW와 동일하다.

메일 목록에는 수요일 발송 사례도 있으므로 금요일 최종 재확인에서 목요일 공시가
정상 무자료 응답이면 바로 전 수요일 공시 한 건을 추가 조회한다(최대 2건).
이미 수요일 발표가 원장과 공개 스냅샷에 있으면 목요일 반복 조회도 생략한다.
실제 공시의 발표 날짜를 그대로 보관하고 `matchedDeclarationDate`로 보고한다.
목요일 조회가 실패했을 때는 오류를 무자료로 바꾸지 않으며, 두 날짜 모두 미발견이면
`missing`으로 실패 처리한다. 임의의 과거 날짜나 다음 날 발표를 추정해 채우지 않는다.

실행별 `magy-observation-{run_id}` 아티팩트에 보고서를 30일 보관한다. 수동 실행의
`declarationDate`를 비우면 서울 날짜 기준 가장 최근 목요일을 사용한다. 과거의
목요일 또는 조기 발표의 수요일을 직접 지정할 수 있으며 미래 날짜는 거절한다.
정기 실행은 main 반영 후 활성화되고 GitHub cron의 지연·누락 가능성은 유지된다.

```sh
python scripts/content_pipeline/observe_roundhill.py --ticker MAGY
python scripts/content_pipeline/observe_roundhill.py --ticker MAGY --declaration-date 2026-10-22 --require-announcement
python -m unittest discover -s tests/content_pipeline -p 'test_*observation.py' -v
```

## 관리자 종목 수집 버튼

종목 상세 상단에서 관리자는 ‘공유 카드 만들기’ 대신 ‘데이터 수집’을 누른다.
`/api/stock-collection`은 기존 종목 작업 함수로 rewrite하여 Hobby 요금제의
12개 함수 제한 안에서 제공합니다. 수집과 피드백은 각자의 인증·캐시·CORS
정책을 유지합니다.

`POST /api/stock-collection`은 Firebase ID 토큰과 관리자 허용 목록을 서버에서
검사한 뒤 기존 운영 워크플로를 `scope=ticker`, 선택 종목 하나로 호출한다.
공식 배당 원장 또는 운용사 catalog에 수집 경로가 등록된 종목이 대상이며,
수집 경로 미등록·제공처 오류는 실패로 표시한다. 새 원문을 수집해도 검증 상태를
자동으로 확정하거나 core 릴리스를 발행하지 않는다.

Vercel 서버 환경변수 `CONTENT_STUDIO_GITHUB_TOKEN`에 이 저장소만 허용한
GitHub 토큰을 설정해야 한다. 필요한 권한은 Actions 읽기·쓰기(수집 실행·상태 조회)와
Contents 읽기(수집 커밋 확인)다. 브라우저용 `VITE_` 변수나 저장소 파일에 넣지 않는다.
기존 `FIRESTORE_SA_KEY`는 Firebase 토큰 검증에 재사용한다. 이 기능은 Firestore 문서를
읽거나 쓰지 않는다. 토큰 미설정은 503 안내로 표시하며, 설정 전 실제 수집은 시작하지 않는다.

화면은 15초 간격으로 최대 10분 동안 진행 상태를 확인한다. 수집 성공뿐 아니라
수집 요청 식별자가 기록된 커밋의 운영 반영까지 확인한 뒤 해당 종목 데이터만 적용한다.
화면의 수동 종목 수집 커밋에는 CI 생략 표시를 붙이지 않아 운영 배포가 정상 실행된다.
Preview·Pages에서도 운영 API의 최신 결과를 사용한다. 대기가 길거나 조회가 실패하면
‘수집 상태 확인’으로 같은 요청을 이어 확인할 수 있다. 화면 이동·로그아웃 시 대기는
중단하지만 이미 시작한 서버 수집은 취소하지 않는다. 같은 실행 인스턴스의 동시 요청과
GitHub에 등록된 동일 종목의 진행 중 작업은 재사용한다. 다른 실행 인스턴스에서 작업이
GitHub에 등록되기 전에 동시에 요청하면 중복 실행될 수 있으나 원장 쓰기는 기존
워크플로의 전역 직렬화로 보호된다.

종목별 수집은 공유 공시에서도 선택 종목의 배당·catalog 항목만 저장하고,
전체 운용사를 대상으로 하는 순환 증빙 검증을 시작하지 않는다.


### 종목 수집 실행 기록

관리자 종목 화면의 **수집 기록**에서 마지막 실행의 진행 단계·실패 이유와
GitHub 원본 로그 링크를 확인할 수 있습니다. 기록 조회는 재수집을 실행하지 않습니다.
공식 대상 미등록 오류는 출처·수집 대상 등록이 필요하다는 안내로 표시합니다.
워크플로의 정리 단계 완료는 공식 자료 수집 성공과 구분합니다.

기록 조회는 같은 관리자 인증을 사용합니다. 실패한 실행에 한해 GitHub 작업 목록과
작업 로그를 추가 조회하고, 알려진 오류 유형만 안내로 변환합니다. 원문 로그·환경 변수는
클라이언트에 반환하지 않습니다. 완료된 실패 진단은 서버 인스턴스 메모리에 최대 32개를
보관해 같은 실행의 상태 재확인 시 로그 다운로드를 반복하지 않습니다.
