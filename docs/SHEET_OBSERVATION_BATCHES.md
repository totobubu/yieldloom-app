# 시험 장부 관측 배치 저장·클라우드 검증 계약

실제 금융 원문은 Git에 넣지 않습니다. 로컬 수집기는 **기존 관리자 Firebase 로그인**으로
`/api/sheet-ledger`를 호출합니다. 모든 요청은 `Authorization: Bearer <Firebase ID token>`이
필요하고 서버는 관리자 권한을 검증합니다. 서비스 계정으로 사용자 로그인을 우회하지 않습니다.
같은 관리자 UID 아래 `wife` / `husband`를 분리합니다. 서로 다른 관리자 UID는 공유되지 않습니다.

토스 증권사 원문을 정본 근거로, 시트를 보조 이행 대조로 다루는 원칙은
[장부 기준](SHEET_TRIAL_LEDGER.md#정본과-이행-방향)을 따른다. 이 배치 API가 관측을
저장했다는 사실만으로 검증된 금융사건이나 관리자 승인으로 승격하지 않는다.

## 원문 보존과 저장

- 기존 거래 페이지, Google 원본, PDF 장부, 과거 `evidencePages`는 이전하거나 삭제하지 않습니다.
- 새 관측은 `reconciliationAccounts/{accountId}/observations/{sha256(logicalId)}`에 저장합니다.
  논리 ID는 `kind:accountId:sourceId`입니다. sourceId는 수집기가 재시도에도 동일하게 생성해야 합니다.
- 배치는 동일 계좌 **1~100건**, 전체 JSON 요청 **3,000,000 bytes 이하**입니다. 초과하면
  원문을 자르지 말고 건수를 줄입니다. 누적 2,000건 / 전체 원장 4MB 제한은 새 관측에 적용하지 않습니다.
- 정규화 투영과 별도로 제출 배열 전체를 원문 청크로 보존합니다. `rawText` 및 알 수 없는
  원본 필드도 보존됩니다. 비밀번호·쿠키·토큰·불필요한 개인정보는 입력하지 않습니다.
- 레코드·원문 청크·완료 영수증·계좌 체크포인트는 단일 Firestore 트랜잭션으로 저장합니다.
  완료 영수증이 없으면 저장 완료가 아닙니다. 부분 배치는 검증 대상에 노출되지 않습니다.
- 정규화 문서는 개별 크기 제한을 유지합니다. Firebase의 비용·용량·쿼터가 무제한이라는 뜻은 아닙니다.

## POST: preview / commit

아래는 모두 합성 예시입니다. `sourceHash`는 **수집기 전체 입력 파일 바이트의 SHA-256**,
`offset`은 그 파일 내 시작 인덱스, `count`는 배열 길이입니다. 수집기가 주장한 파일 해시이며
서버가 전체 파일을 받은 것으로 해석하지 않습니다. 서버는 배치 배열 원문 바이트를 별도
`receipt.archiveHash`로 검증합니다.

```json
{
    "action": "batch-preview",
    "accountId": "wife",
    "batchId": "file-hash-prefix-wife-000000",
    "checkpoint": {
        "sourceHash": "<64 lowercase hex>",
        "offset": 0,
        "count": 1
    },
    "observations": [
        {
            "kind": "TOSS_ORDER",
            "sourceId": "TEST-order-1",
            "accountId": "wife",
            "type": "BUY",
            "symbol": "TEST",
            "location": "합성 주문 상세",
            "values": {
                "date": "2025-02-03",
                "quantity": 1,
                "executedAt": "2025-02-03 14:51:05.005",
                "commissionUsd": null
            },
            "rawText": "화면에서 확보한 전체 원문"
        }
    ]
}
```

미리보기 응답에는 `fingerprint`, `staged.additions`, `staged.duplicates`가 있습니다.
저장 시 **같은 본문**에서 action만 `batch-commit`으로 바꾸고 fingerprint를 보냅니다.
자동 수집기의 결정적인 배치 제출은 preview 없이 commit도 가능합니다. 관측 저장은 canonical
장부 version과 독립적이므로 클라우드의 관리자 검토와 병행할 수 있습니다.
commit 응답은 `partial:true`, `canonicalUnchanged:true`, `receipt`, `replayed`,
`importedEvidence`, `observationDelta`를 반환하며 전체 원장이나 전체 원문을 반복 반환하지 않습니다.

- 같은 batchId + 같은 내용 재요청: 기존 완료 영수증, `replayed:true`, 새 쓰기 0건.
- 다른 batchId + 같은 출처 ID/원문: 중복 등록 방지. 제출 배치 원문은 별도로 보존.
- 같은 batchId 내용 변경 또는 같은 출처 ID 다른 원문: **409**, 자동 덮어쓰기 없음.
  실제 개정 자료라면 별도의 개정 sourceId로 제출하고 검토합니다.
- 400: 형식/필드/계좌 검증 오류. 401/403: 사용자 재인증/권한 확인 필요, 무한 재시도 금지.
  413: 배치를 줄여 다시 제출. 네트워크 중단/5xx는 영수증을 확인한 뒤 **같은 ID/본문**으로 재시도.
- 구형 `evidence-preview/evidence-commit` 쓰기 요청은 410 `OBSERVATION_BATCH_REQUIRED`입니다.
  기존 관측 읽기와 채택 이력은 보존합니다.

## GET: 클라우드 재개

모든 응답은 인증된 같은 UID 범위입니다. 페이지 커서는 불투명 값 그대로 다음 요청에 넣습니다.

| 쿼리                                               | 용도                                                |
| -------------------------------------------------- | --------------------------------------------------- |
| `resource=batches&accountId=wife&batchId=...`      | 특정 완료 영수증 확인, 없으면 404                   |
| `resource=batches&accountId=wife&after=0`          | 완료 배치 목록, 최대100개; nextCursor로 계속        |
| `resource=batch-source&accountId=wife&batchId=...` | 영수증 + 전체 originals 배열, 해시 검증 후 반환     |
| `resource=observations&accountId=wife`             | 기존/새 관측 요약 최대100개, nextCursor로 계속      |
| `resource=observation&accountId=wife&id=...`       | 한 관측과 보존 original을 필요할 때만 조회          |
| `resource=rows` (또는 기본 GET)                    | canonical 거래 최대500행/약1MB; nextCursor로 계속   |
| `resource=version&version=...`                     | 페이지 조회 중 canonical 버전 변경 확인, 변경 시409 |

관측·배치 커서는 완료 sequence의 watermark를 고정합니다. 조회 도중 들어온 새 배치는 다음
최초 조회에서 보입니다. 기록한 마지막 완료 sequence 다음부터 `batches&after=N`으로 재개합니다.
배치 목록에서 checkpoint/해시를 확인하고, 필요한 원문만 조회하여 매핑/검증합니다. 수집기는
**완료 영수증 검증 후에만** 로컬 완료 체크포인트를 전진시킵니다. 단순 HTTP 성공이나
`canonicalUnchanged`만으로 완료를 판정하지 않습니다. `receipt.status=complete` 및
배치 ID·계좌·fingerprint·checkpoint의 sourceHash/offset/count가 제출값과 일치하는지
확인합니다. 누락·불일치·중단 시 완료 위치를 유지하고 같은 배치를 재개합니다. 두 계좌와
파일별 체크포인트를 분리하고, 처리 완료 sequence는 검증 측에서도 별도로 기록합니다.

canonical 조회는 version 고정이며 변경 시 전체 조회를 재시작합니다. 브라우저 클라이언트는
최초 응답의 `parallelRows=true`와 `totalRows`를 확인하면
`resource=rows&offset=N&limit=500&version=V` 범위를 최대 3개씩 병렬 조회합니다.
시작 위치가 0보다 크면 고정 version이 필수이며 cursor와 offset을 섞지 않습니다.
응답 바이트 제한으로 범위가 덜 반환되면 해당 범위만 이어 읽고, 모든 범위를 순서대로
합친 뒤 총 건수/고유 ID를 검증합니다. 실패한 부분 목록을 정상 결과로 게시하지 않습니다.
신규 관측이 없는 계좌는 legacy 마지막 페이지에서 바로 끝내 빈 후속 요청을 만들지 않습니다.

브라우저 클라이언트는
모든 요약 페이지를 합쳐 전체 검색/정렬을 수행합니다. 화면에는 페이지 번호나 표 내부 세로
스크롤을 추가하지 않고 문서 스크롤과 제한된 DOM 창을 유지합니다. 원문은 검토할 때 조회합니다.
동일 세션의 동시 전체 조회는 합치고 로그아웃/계정 변경 시 메모리 자료를 폐기합니다.

## 관리자 검토

배당 상세의 확정·지급 상태는 메뉴 출처와 분리합니다.
[배당 상태 계약](SHEET_DIVIDEND_STATUS.md)의 paymentStatus/confirmationStatus/paidAt과
원문 dividendState를 지원하며, 확정 지급 자료도 기존 입금에 근거만 연결합니다.

관측 저장은 기존 거래값을 바꾸지 않습니다. `accept-evidence`는 canonical version,
accountId, observationId, reviewVersion, targetId, 선택 fields, note를 사용하며 명시적
채택 시에만 값과 관리자 검토 이력을 변경합니다. 원문은 변경하지 않습니다.
불명확한 후보·다중 후보는 관리자 검토로 남기고 미지급·미확정·상태 불명 배당을 실제 입금에 반영하지 않습니다.
거래일/체결일/결제일 의미와 실제 표시 정밀도를 유지하며, 누락 수수료/초는 추정하지 않습니다.

이 문서는 저장·조회 계약입니다. 실제 로컬 파일 업로드, 계좌 대조 완료, 원금 확정을 뜻하지 않습니다.

## 보존 후속 보고서의 읽기 연결

관측 저장과 별도로 기존 비공개 보고서 API의 `section=followup`을 사용한다. 고정된
검증 체크포인트에서 네 주문의 패널 발췌를 읽기 전용 관측 행으로 보여줄 수 있으나
이 행을 `observations` 컬렉션에 다시 저장하지 않는다. 배치 체크포인트·영수증·장부
버전·승인값은 바뀌지 않는다. 상세 권한·해시·오류 계약은
[SHEET_TRIAL_LEDGER.md](SHEET_TRIAL_LEDGER.md#토스-관측-중심-시험-화면)를 따른다.
