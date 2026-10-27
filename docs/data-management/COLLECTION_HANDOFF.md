# 데이터 수집 통합 작업 인계 체크포인트

이 문서는 구현 결정과 검증 결과를 재개할 수 있게 정리한 요약이다. 기존 대화 원문
전체를 이전한 자료가 아니며, 원문·사용자 승인 내역은 기존 채팅에 남아 있다.

## 인계 대상과 실행 소유권

- 저장소: totobubu/yieldloom-app
- 브랜치: `feat/durable-collection-ledger`
- 검토용 draft PR: https://github.com/totobubu/yieldloom-app/pull/167 (base: `work`)
- 구현 head: `7460be54c8124f5f9bba954df99f0f4662487e89`. 이 문서는 후속 문서 커밋으로
  추가된다. 최종 인계 SHA와 해당 SHA의 CI 결과는 PR의 head/checks 및 최종 채팅 보고를 확인한다.
- 기존 작업: `01a17b9c-9a88-77fb-acd8-0fd25acb90af`.
  관리 채팅: `01a16619-95ac-73dc-90cd-8261d0c5702f`.
- 사용자는 Git 푸시·검토 PR을 승인했고, 이후 main 병합·운영 배포 및 새 통합 채팅 관리를
  추가 승인했다. **중복 실행 방지를 위해 이 작업은 draft PR·최종 CI 확인·인계까지만 맡는다.**
  병합과 배포는 새 통합 작업의 단일 실행자가 수행한다. 여기서는 병합/수동 배포하지 않았다.
- 새 승인으로 과거의 main/배포 제한은 갱신됐지만, 전체 시장 수집·새 자격 증명·권한 확대·
  운영 원장 덮어쓰기·대규모 이관까지 자동 승인된 것으로 해석하지 않는다.
- `feat/sheet-evidence-tools`는 PR 생성 시 이 checkout 및 원격 refs에 없었다. 타 작업 변경을
  흡수하지 않았다. 새 실행자는 장부 브랜치 푸시 후 파일 중복/merge 충돌을 다시 확인한다.

## 원래 사용자 요구 16개와 현재 상태

완료 표시는 코드와 제한된 테스트 범위 기준이다. 자료의 전체 확보·운영 전환을 뜻하지 않는다.

| 번호 | 요구 | 구현 및 미완료 |
| --- | --- | --- |
| 1 | 수집 직후 계산 가능 여부 | 라이벌 비교·매수 시점별 배당률에 요청 기간 coverage/충돌 연결. 부분 이력은 참고 표시, 충돌은 보류. 모든 계산 소비 경로의 전환은 아님 |
| 2 | 기간이 서로 다른 이유/통일 | 공용 수집 목표는 상장 이후, UI 조회 기간과 분리. 기존 모든 경로 교체는 남음 |
| 3 | 오래된 Yahoo 가격 누적 | API 일봉 및 원장 과거 행 보존. 정정은 별도 관측/충돌. Yahoo 10년 일괄 제한은 검증하지 않음 |
| 4 | 공식 출처 최우선 | issuer 경로 우선, 기존 공식 거래소/공시 보완. 원문 보존 및 충돌 보류 |
| 5 | 검색한 일반주 자동 등록 | 정확한 공식 목록→비공개 등록→검토 카탈로그 또는 명시적 공식 식별자로 보충. 안정 ID/거래소/통화/상장일 없으면 보류. 임의 전체 종목 확정은 아님 |
| 6 | Massive 제거 | 활성 수집 및 workflow fallback 차단. 과거 자료 파서 유지, 원격 secret 변경 없음 |
| 7 | 상장 이후 전체 배당 | 수집 목표와 누락/완전성 판정 구현. 실제 전체 배당 확보 미완료 |
| 8 | 실패 시 대체 루트 | 기존 운용사·BAC 경로 확대, index 누락과 독립. 접근 거부 후 URL/인증 우회 금지 |
| 9 | 빈 데이터 보강 | 미확보/정상 무배당/일시 오류 구분, 재시도·원문 보존. 빈 결과를 무배당으로 승격하지 않음 |
| 10 | OpenDART 연결 | 재무 어댑터와 소수 실제 읽기 검증. 한국주 전체 배당 이력 수집 완료는 아님 |
| 11 | 종목별 다른 기준 대신 상장 이후 | 신규 큐 inception 목표/연도 분할 구현. 설정일을 상장일로 추정하지 않음 |
| 12 | 타겟 일정·요청 수집 | 중복 큐, 출처별 동시성/backoff, 중단 복구. PR164의 YieldMax/기존 Roundhill 계획 재사용. 운영 단일 소유자 전환은 남음 |
| 13 | 기존 장기 가격을 우리 경로로 이관 | 읽기 대조 도구, 자체 모델 조회 flag 준비. 실제 원본 대조/이관 미완료(403 발생 계층 미확정) |
| 14 | 직접 조회 일봉 누적 | 조건부 영속 쓰기·누적·실패 시 저장 자료 반환 구현. 기본 OFF |
| 15 | 수집→화면→검증 core 일원화 | 원장→가격 모델/배당 검토→기존 core builder/validator→로컬 후보 연결. 운영 발행은 미연결·OFF |
| 16 | 출처/기간/성공·실패/사용 상태 정리 | 비공개 상태 JSON 및 기존 관리자 Dialog에 기간·출처·마지막 확보·미해결 오류 표시. 오류 발생 시각은 기존 큐에 없어 미확인으로 표시 |

## 핵심 결정과 코드 위치

- `collection_jobs.py`, `collection_worker.py`: 년도별 범위, overlap 합치기, 출처 단일 실행,
  소유자 fencing, backoff. 중단 복구는 작업자 종료를 명시적으로 확인해야 한다.
- `lib/candle-ledger.js`, `api/stock-prices.js`: 독립 인스턴스 CAS, 원문 hash, 과거 행 비삭제,
  수정값 revision, API outbox, 공급자 빈 결과/실패 때 보존 이력 반환.
- `discovery_requests.py`, `identity_enrichment.py`: 공식 Nasdaq 자료를 확인한 정확한 listing만
  보충. ISIN checksum 검사, 다른 거래소/기존 ID 충돌 시 보류, 공개 카탈로그 수정 없음.
- `request_bridge.py`, `official_backfill.py`: 기존 파서를 재사용하는 bounded worker.
  Yahoo 참고 배당과 분할 관측은 승인 core 배당으로 승격하지 않는다. BAC 공시도
  배당락일이 없으면 부분 공식 관측으로 보존한다.
- `schedule_bridge.py`: legacy owner 기본, queue owner 명시 필요. 같은 슬롯 receipt 중복 합침.
  `schedule_yieldmax.py`, `scheduled_observation.py` 등은 PR164 코드를 재사용했다.
  실행 workflow는 가져오거나 활성화하지 않았다.
- `owned_price_model.py`, `core_candidate.py`: 실제 관측 OHLC만 사용. 종가로 OHLC 추정 금지.
  raw 증거/hash/identity/정렬/OHLC/coverage 검증 후 로컬 새 디렉터리에 후보를 원자적으로 저장.
  `candidateBuilt`/`snapshotValid`와 `readyForPublication`을 구분한다. 후자는 항상 false이며
  부분 대상 후보의 전체 릴리스 대체도 금지한다. 후보 실패가 수집 checkpoint 저장을 막지 않는다.
- `collection_status.py`, `lib/stock-collection.js`, `AdminStockCollection.vue`: 관리자 인증 후
  기존 수집 기록 GET에 상태 포함, 추가 수집 요청 없음. 최초 읽기 ETag로 stale overwrite 방지.
- `calculationCoverage.js`: 가격 첫날·마지막 날로 완전성을 추론하지 않는다.
- `opendart.py`: 기본 disabled, API 키 출력/원문 저장 금지, 비표준 계정명을 구분한다.

## 고정 acceptance 범위

AAPL / MSFT / NVDA / BAC / SCHD / IVV / TSLY / TOPW.
식별자 보충 한 실행 최대 2개, 시장 worker 최대 5 jobs(기본 1), 공식 문서 최대 2개 경로,
BAC 최대 기사 2개. 새 시장 전체로 임의 확대하지 않는다.

AAPL/MSFT/NVDA의 새 공식 배당 어댑터는 구현하지 않았다. 기존 검토 ID와 참고 자료 경로를
사용한다. SCHD/IVV의 공시일 미확인 이력은 검토 대기다. 명시적 표/정의 목록 기반 식별자
파서는 합성 응답으로 검증했으며 실제 모든 운용사 HTML 형식을 검증한 것은 아니다.
자세한 표본별 기준은 `COLLECTION_ACCEPTANCE.md`를 본다.

## 검증 증거

구현 head 7460be5의 로컬 검증:

| 검사 | 결과 |
| --- | --- |
| `node --test tests/*.test.mjs` | 486 통과 |
| Python `tests/data_platform` | 116 통과 |
| Python `tests/data_v2` | 48 통과 |
| Python `tests/content_pipeline/test_roundhill*.py` | 26 통과 |
| Python `tests/content_pipeline/test_stock_collection.py` | 10 통과 |
| type-check / lint:check / build | 통과. 기존 lint 경고 72, 큰 번들 경고 유지 |

합계 686개. core 전체 테스트에 필요한 boto3/pytesseract는 로컬에 설치했다.
플랫폼 CI에는 새 parser 테스트가 사용하는 기존 의존성 BeautifulSoup 설치를 추가했다.
실제 제공처/원격 쓰기 대신 fixture와 메모리 객체 저장소를 사용한 연결 검증이며,
기존 실제 parser/core builder/validator를 실행했다. Local Chromium에서 390/1280px,
밝은/어두운 테마, 관리자 Dialog, 참고 계산 표시, Escape 닫기, 재열기 1회 요청 재사용을
확인했다. 운영 인증·운영 데이터 브라우저 검증과 구분한다.

별도 소수 실제 읽기(운영 저장 없음): Yahoo AAPL 5일 요청에서 일봉 5개
(2026-10-20~26), YieldMax TSLY 공식 페이지에서 배당 89개, OpenDART 삼성전자
2025년 CFS 사업보고서 status 000/229행에서 재무 관측 686개. 전체 이력 증명은 아니다.

PR 생성 직후 application/browser/portfolio-api/validate CI는 진행 중이었다.
인계 완료 전 최종 head CI를 별도로 확인한다. Vercel 자동 Preview check는 통과했으며,
여기서 수동 배포나 main 병합을 실행하지 않았다.

## 403 진단 및 실제 이관에 필요한 자료

- 기존 요청: GET `https://pub-cdda6824954243b49965012b33c29bd6.r2.dev/data/nasdaq/aapl.json`.
- `VITE_R2_PUBLIC_URL` + `data-v2/market-sources.json` 경로. 인증/서명/query token 없는 공개 GET.
  S3 API가 아니다. 당시 HTTP 403만 기록했고 응답 본문·server/request-ID·정확한 시각 미기록.
- 프록시 환경 변수 존재. 키/값 출력 없음. S3 인증 변수 부재는 공개 GET 403의 원인 증명이 아님.
- 기존 Cloudflare 연결에서 bucket 및 managed domain 설정 GET(HTTP200)을 수행했다.
  2026-10-27 06:29 UTC 무렵 `divgrow-data`의 domain은 요청 host와 정확히 같고 enabled=true.
  현재 공개 접근 비활성은 원인으로 확인되지 않았다. 당시 상태/요청별 정책/프록시 거부는 미확정.
- 원본 객체 재요청, 다른 URL/credential로 접근 우회, Cloudflare 설정 변경은 하지 않았다.
- 실제 이관은 미완료. 기존 승인된 공개 원본 연결 또는 소유자가 제공한 동일 객체의 로컬
  사본으로 행/기간/hash를 대조해야 한다. 8종목의 정확한 객체 경로와 기존 env 선택 순서는
  `COLLECTION_ACCEPTANCE.md`에 있다. 다른 bucket/key나 인증을 추측하지 않는다.

## 기본 OFF와 운영 전환 조건

- `DATA_CANDLE_PERSISTENCE`: API 일봉/outbox 영속 저장.
- `DATA_CANDLE_READ_OWNED`: 자체 장기 read-model 조회.
- `DATA_COLLECTION_STATUS_READ`: 관리자 비공개 상태 조회.
- optional runner: `--request-symbol`, `--request-dividends`, `--write-status`,
  `--enrich-identities`, `--prepare-core-candidate`. 기존 운영 workflow에 추가하지 않았다.
- private R2에는 기존 `DATA_PRIVATE_R2_ACCOUNT_ID`, `DATA_PRIVATE_R2_ACCESS_KEY_ID`,
  `DATA_PRIVATE_R2_SECRET_ACCESS_KEY`, `DATA_PRIVATE_R2_BUCKET` 설정이 필요하다. 값은 기록하지 않는다.
- source별 실행 소유자 단일화, 제한된 canary/실패 복구 확인, 실제 원본 보존 대조, 전체 기간
  및 분할 기준 검토가 필요하다. 플래그를 켜는 것만으로 데이터 검증이 완료되지 않는다.
- 새 통합 실행자는 승인된 main/배포 절차와 별도로 운영 수집·이관/덮어쓰기 범위를 확인한다.
  손실 없는 checkpoint/후보 확인 없이 기존 원장/포인터를 교체하지 않는다.

## 커밋 위치

기반: 4a4bf7c(Massive 차단), a1a85d7(원장/큐), 91b18f2(API 저장), 434f79d(이관 대조),
44e231b(등록/worker), 0b0a4d3·81fda10(OpenDART), 34ef158(API→worker 연결).
후속: 4bf56c0·9addca2(자체 조회/일정 준비), bf223bd(YieldMax 일정), d19d5d1(관리자 상태),
f5aeaef(계산 coverage), ed9b192(식별자 보충), 562474a(공식 보충), 7460be5(core 후보).

## 새 단일 실행자의 다음 순서

1. PR167 최종 head와 checks, 원격 work/main 및 장부 브랜치 상태를 다시 조회한다.
2. 장부 변경 파일 중복과 실제 merge 충돌을 대조한다. 기존 작업 변경을 임의로 흡수하지 않는다.
3. PR의 미완료 사항을 운영 준비 완료로 오인하지 않고, 필수 리뷰/관련 CI를 통과시킨다.
4. 최신 사용자 승인을 적용해 단일 실행자가 병합·배포한다. 기존 git-ship 절차와
   정확한 병합 SHA의 배포 확인을 따른다. 이 작업은 그 단계에 참여하지 않는다.
5. 추가 자료/승인이 필요한 이관·운영 활성화는 별도 구분하여 보고한다.
