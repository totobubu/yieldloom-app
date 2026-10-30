# 비공개 저장과 장부 증분 연결

수동 스킬의 기본 완료 절차다. 기존 API 결과와 ego가 실제로 읽은 JSON을
사용한다. 브라우저 자료는 코드가 직접 수집한 것으로 표시하지 않는다. 실입금 상세의
통화/종목/총액/세금/입금액/표시일시/관측시각/표시 필드/확인 범위/계좌 확인 여부를 보존한다.
`publish-account-observations.mjs`와 `toss-ledger-increments.js`가 검증 계약이다.
현재 브라우저 입력은 실제 입금이 확인된 배당 한 건씩이며 취소·환수·정정 미확인은 합산하지 않는다.
사용자가 외부 저장을 명시적으로 금지한 경우만 해당 제한을 우선하고 조회 범위만 보고한다.
기존 private 대상에 대한 저장 승인은 새 persistent credential 생성·설정이나 비밀 복사 승인이 아니다.

## 실행

- 먼저 `node scripts/toss/read-account-orders.mjs --help`를 읽는다.
- 기존 조회 양식에 `--prepare-publication --ledger-account wife --browser-observation <기존egoJSON경로>`를
  붙이면 API 원문과 ego 관측으로 고유 로컬 publication을 만든다. 금융 자료는 Git 제외
  `var/toss-orders/`에만 둔다. 저장이 승인된 경우 기존 R2 환경 설정이 있으면
  `--prepare-publication` 대신 `--publish`로 수집→저장→검증→연결한다.
- R2 설정은 기존 `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 환경변수만
  사용한다. 없으면 키를 발급/복사하지 않고 기존 승인 Cloudflare 연결로 아래 계약을 수행한다.
  그 연결에 로컬 파일 입력이 없으면 금융 원문을 도구 stdout/로그에 출력해 운반하지 않는다.
  지원되는 안전한 전송 경로가 없으면 로컬 자료를 보존하고 `blocked`로 남긴다. 필요한 PC·버킷·
  최소 권한·저장 위치·사용자 조치를 구체적으로 제시하되 새 자격증명 설정은 별도 명시 승인을 기다린다.
- 중단·브라우저 후속 관측은 기존 API run을 재사용해 publication을 준비한다. R2 실패 때문에
  실제 API/ego를 다시 수집하지 않는다. `publish-account-observations.mjs --directory <기존publication> --publish`
  로 저장만 재개한다. `--publish` 없이는 오프라인 검증만 한다.
- API 먼저/ego 나중 순서에서는 helper의 `--prepare-publication --ledger-account wife`로 API 원문을
  준비하고 ego를 읽은 뒤 `node scripts/toss/publish-account-observations.mjs --directory <APIpublication> --attach-browser <실제egoJSON> --publish`
  로 이어간다. R2 환경 설정이 없으면 `--publish`를 빼서 준비한 뒤 기존 Cloudflare 연결을 사용한다.
  각 브라우저 입금은 원문을 따로 보존하며 같은 API 증거를 재사용한다. 새 입금을 붙이려고 API를 다시 호출하지 않는다.

## 기존 Cloudflare 연결을 쓰는 경우

1. Cloudflare 스킬과 현재 도구 계약을 읽는다. 대상은 기존 승인 계정의 `yieldloom-data-private`뿐이다.
2. 로컬 manifest/receipt와 bundle을 `loadPublication()`으로 검증한다. 기존 묶음이면
   part와 manifest/receipt를 GET 재확인하여 동일한 크기/SHA가 이미 있는 객체를 다시 PUT하지 않는다.
3. sourceSetHash로 결정된 새 prefix에 불변 part들을 저장하고 GET의 크기/SHA, gzip/archive/member 해시를
   모두 확인한다. 실패하면 기존 원문을 보존하고 완료 receipt/index를 만들지 않는다.
4. manifest와 완료 receipt도 GET 검증한다. 이전 index가 있다면 전체 바이트가 같은 경우만 재사용한다.
5. `incrementMarker()`가 만든 정확한 body를 `reconciliation/increments/v1/wife/index/<body SHA256>.json`에
   추가하고 GET의 크기/SHA를 검증한다. 원문 거래 ID가 아닌 내부 관측 증거의 연결 표지다.
6. SDK 경로는 `If-None-Match:*`를 사용한다. 조건부 입력이 없는 기존 REST 도구에서는
   **body SHA가 key인 불변 append-only 항목**만 추가한다. 같은 키의 다른 바이트는 충돌로 중단한다.
   동시 writer가 서로 다른 키에 추가하므로 공유 pointer 덮어쓰기/갱신 손실이 없다.
   고정 `current.json`이나 기존 baseline·채택값은 갱신하지 않는다.

## 읽기와 완료

관리자 API는 기존 Firebase 관리자/시트 소유권을 매 요청 확인한다. 새 index 목록은 요청마다
확인하며 baseline projection만 메모리 캐시한다. 목록 128개 초과/페이지 잘림은 오류이며 부분
자료를 정상 빈 결과로 노출하지 않는다. 각 index의 key/body hash와 receipt/manifest/모든 member를 검증한다.

동일 원문 재시도는 같은 index/관측으로 남는다. 웹 원문 ID가 없을 때 다른 독립 관측을
날짜·금액으로 합치지 않고 같은 날짜·종목·통화의 후보가 있으면 새 관측을 합계에서 제외한다.
API 계좌+orderId 최신 누적 상태만 화면에 투영하고 원문과 이전 baseline은 보존한다. 0건은 삭제가 아니다.

R2 검증과 index 연결은 앱 표시의 증거가 아니다. 해당 코드가 있는 로컬/Preview의 인증된 관리자
`/admin/sheet-ledger`에서 새로고침해 새 행·출처·세전/세금/실수령과 미확인 항목을 확인한다.
합성 로그인 테스트와 실제 사용자 로그인은 구분한다. 운영 반영은 별도 병합/배포 승인 범위다.

### 완료 체크포인트

| 단계 | 완료 증거 |
| --- | --- |
| 수집 | 실제 원문과 범위/상태; 실패를 0건으로 바꾸지 않음 |
| R2 보존 | 불변 원문 bundle·manifest·receipt 업로드와 원격 GET 크기/SHA 및 member 검증 |
| 장부 연결 | 내용 해시 기반 append-only index의 GET·해시 검증; 기존 baseline/pointer 불변 |
| 실제 반영 검증 | 서버 투영 또는 인증된 화면에서 신규 자료가 정확히 한 번 보임; 동일 관측 재실행 중복 없음 |

네 단계를 충족한 경우만 전체 `complete`로 보고한다. 가능한 기존 관리자 로그인 화면도 확인하고,
화면 미검증이면 서버 투영 검증과 별도로 그 상태를 명시한다. 로컬 prepare/합성 테스트/PUT 성공은
원격 GET·장부 반영 검증을 대체하지 않는다. 실패 단계는 `partial` 또는 `blocked`로 보고하며,
run 경로·원문 해시·이미 검증한 원격 객체·마지막 checkpoint를 보존해 그 단계부터 재개한다.
실제 확보한 자료가 없으면 저장 내용을 만들지 않는다. 예상·미확인 배당은 확정 장부에 넣지 않고
기존 자료를 삭제하거나 과거 채택값을 재계산하지 않는다.

합성 점검: 일부 업로드 실패/GET 해시 불일치에서는 index를 쓰지 않음; index 실패는 원문을
재수집하지 않고 재개; 동일 source hash 재실행은 기존 index 재사용; 서버 반영 실패는 저장 성공과
분리; 인증 화면 미확인은 실제 화면 성공으로 보고하지 않음; 데이터 미확보는 가짜 빈 거래를 만들지 않음.
