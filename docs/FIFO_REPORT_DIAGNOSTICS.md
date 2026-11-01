# FIFO 비공개 리포트 안전 진단

## 범위와 운영 상태

운영 화면의 일반 무결성 오류만 관측했으며 실제 실패 검사, HTTP 응답,
요청 ID와 운영 SHA는 확보하지 못했다. FIFO 계산 오류나 자료 손상으로
확정하지 않는다. 이 변경은 로컬 코드·합성 검증 단계이며 운영 반영과
실제 장부 재검증은 별도다. 운영 원문·계좌·인증·스토리지 자료를 읽거나
수정하지 않는다.

조회 경로는 기존 Firebase 관리자 → 채택 workbook 접근 확인 → 가족 snapshot의
기존 legacy wife 및 설정된 v2 프로필 index 병렬 검증 → FIFO 입력 → 보정 이력이다.
진단 때문에 읽기 범위, 프로필 선택, DB/R2 호출 수나 권한을 추가하지 않는다.
어느 증분이라도 실패하면 전체 결과를 중단한다. 일부 실패를 제외한 합계나 0을
정상 리포트로 표시하지 않는다. 기존 v1 경로·v2 격리·해시·한도·PAID 근거를 유지한다.

## 응답과 로그 계약

관리자 및 workbook 접근 확인을 모두 통과한 요청의 자료 읽기·검증 실패에만
다음 정보를 반환한다. 인증 전 또는 workbook 권한 확인 실패에는 진단과
`X-Report-Request-ID` 헤더·진단 로그가 없다. 기존 접근 검사 자체의 예상하지 못한
실패도 upstream 오류문을 반환하지 않는다.

```json
{
    "error": "허용 목록에 정의한 정적 한국어 안내",
    "code": "INCREMENT_INTEGRITY_FAILED",
    "diagnostic": {
        "version": 1,
        "code": "INC_RECEIPT_DIGEST",
        "stage": "receipt",
        "requestId": "12345678-1234-4234-8234-123456789abc"
    }
}
```

예시는 합성 값이다. 요청 ID는 서버에서 매 요청 생성하는 무작위 UUID v4다.
자료·사용자에서 파생하지 않으며 오류 응답 헤더와 본문이 같은 ID를 사용한다.
서버 로그는 `requestId`, `code`, `stage` 세 필드만 기록한다. 외부 예외의 message,
cause, 임의 diagnosticCode를 신뢰하지 않는다. 모듈이 생성한 오류만 상세 코드로
전달하며 다른 예외는 호출 경계의 고정 코드로 치환한다. 병렬 검증은 공유되는
현재 단계 변수를 사용하지 않는다.

계좌번호·끝자리·uid·프로필 이름·collector hash·R2 key·파일 경로·토큰·원문금액·본문·
기대/실제 hash는 응답·진단 로그·복사 문자열에 포함하지 않는다. 화면은 코드와 단계가
공용 catalog와 일치하고 ID 형식이 유효한 경우만 표시한다. 응답의 오류 문자열이나
추가 필드는 표시/복사하지 않는다. 복사 범위는 버전·코드·단계·요청 ID 네 필드다.
세션 변경·새 조회·복구 때 이전 진단을 버리며 실패는 정상 캐시에 넣지 않는다.

## 안정 코드와 단계

전체 고정 코드/단계/메시지는 `lib/report-diagnostics.js`의 허용 목록이 기준이다.
기존 78개 검증 조건은 유지하고 각 조건에 고정 코드를 지정했다.

| 단계                                    | 구분하는 근거                                       |
| --------------------------------------- | --------------------------------------------------- |
| safety / encoding / marker              | 인증 필드 금지, 인코딩, marker 경로·범위·descriptor |
| manifest / receipt / parts / members    | 읽기, 크기·해시, 형식·한도, gzip·archive, 구성 파일 |
| collector_identity / collector_coverage | 계좌·수집 범위, 완료 및 건수 근거                   |
| collector_pages / collector_index       | 페이지 시각·커서·해시, 주문 완료 목록 참조          |
| orders / dividend                       | 주문 필드·숫자·시각, 배당 PAID 상세 입금 근거       |
| index / publication                     | index 목록·hash·범위, 게시 readback                 |
| integration                             | 개별 검증 후 함께 연결할 때 계좌·주문 충돌          |
| configuration / increment               | 계좌 연결 설정, 세부 코드 없는 기존 일반 오류       |
| baseline / snapshot / input             | 채택 자료 읽기/권한, snapshot 연결, 계산 입력       |
| adjustments / adjustment_write          | 보정 이력 읽기, 트랜잭션 저장 결과 미확정           |
| report                                  | 나머지 예상하지 못한 리포트 실패                    |

검증 불일치는409, 자료 읽기/설정 실패 및 저장 결과 미확정은503이다.
기존 `REPORT_STORAGE_DENIED` 공통 코드도 보존한다. POST의503은 저장 실패 확정이
아니므로 화면은 기존 요청 ID와 입력을 보존하고 새로 조회하거나 동일 요청을 재시도한다.
진단 요청 ID는 저장의 idempotency 요청 ID와 별개다. 오류 코드는 실패한 검사 위치를
가리키며 영구 손상·원인·수집 완료를 뜻하지 않는다.

## 운영 원인 확인에 필요한 최소 증거

이 로컬 변경만으로 운영 원인을 확정할 수 없다. 향후 별도 승인된 반영 후
이미 허가된 같은 화면 요청의 배포 SHA, HTTP 상태와 진단 네 필드만 먼저 받는다.
여기에 실제 계좌 식별자·해시·장부 원문을 붙이지 않는다. 부가 자료가 필요하면 해당
code/stage에 한정해 별도 최소 읽기 권한을 제시한다. 아내 화면 확인을 남편 원문 추가
조회 권한으로 확대하지 않는다. 기존 원문 접근 거부를 우회하지 않는다.

다음 조치는 이 진단 작업에 포함되지 않는다: index 삭제, receipt/hash 재작성,
52-part 미연결 bundle의 강제 연결, 검증 완화, 금융 API 호출, R2/Firebase 장부 쓰기,
PDF 교체·삭제, 공개 push/PR 또는 운영 배포.

## 합성 자료로 확인한 별도 계약 결함

정상 v2 bundle의 binding에서 JSON 객체 필드의 순서만 바꾸고 모든 키·타입·값 및
연결 hash를 일치시켜도 기존 `JSON.stringify` 비교는 거절했다. index 읽기에서
동일 binding을 다른 필드 순서로 전달해도 같은 문제가 재현됐다. 이 결함은 합성
fixture에서 확인했으며 운영 게시물이 실제로 이 순서 차이를 갖는지는 모른다.
운영 오류의 원인 확정이나 복구 완료를 뜻하지 않는다.

별도 수정은 manifest↔marker 및 호출 binding↔index marker의 **객체 필드 순서만**
동일성에서 제외한다. 양쪽에 기존 binding 유효성 검사를 적용하고 엄격한 깊은 비교로
모든 own 필드(미지의 추가 필드와 JSON의 `__proto__` 필드 포함), 타입, 값,
중첩 값과 배열 순서를 보존한다. 키 추가·삭제, 계좌·collector 변경, null·타입 변경,
배열 순서 변경은 여전히 거절한다. 이는 객체 필드 순서 차이에 대해서만 수용 범위를
바꾸는 계약 수정이다. marker/manifest/receipt/part/member의 실제 바이트 해시와
collector 계좌 일치 및 통합 충돌 검증은 유지한다. 실제 hash나 receipt를 다시 쓰지 않는다.

## 로컬 검증 증거

main `9f36b879`를 기반으로 다음 검사를 최종 코드에서 수행했다.

- `node --test tests/*.test.mjs`: 682개 통과.
- `npm run build`: `vue-tsc --noEmit` 포함 성공.
- `npm run lint:check`: 오류 0, 기존 경고 72개.
- 합성 브라우저 `tests/final-ledger.browser.mjs`, `tests/toss-increments.browser.mjs`,
  `tests/fifo-report.browser.mjs` 통과. 별도 로컬 Vite와 차단·대체한 API/Firebase만
  사용했다. FIFO의 보정 쓰기 4회는 메모리 DB fixture이며 운영 저장이 아니다.
- 독립 검토에서 진단 변경의 기존 78개 guard 조건 보존을 확인했다. 별도 바인딩
  수정에서는 정확히 두 비교 조건만 변경됐고, 미해결 P1/P2는 발견되지 않았다.

합성 검증은 실제 운영 장부·권한·R2 객체의 현재 상태를 증명하지 않는다.
