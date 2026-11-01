# 가족 계좌 프로필

## 설계와 호환

`wife-toss` / `husband-toss`는 소유자·증권사·계좌 바인딩을 갖는 독립 슬롯이다.
각 슬롯은 기존 비밀 참조 이름만 선택하며 자격증명이나 원장은 브라우저에 저장하지 않는다.
계좌 suffix와 전체 계좌번호의 SHA-256을 사전에 확인한 참조와 대조한다. 같은 계좌를
두 소유자에게 지정하거나 API 응답에서 계좌가 모호하면 수집/게시를 중단한다.
계좌 교체는 suffix만 덮어쓰는 작업이 아니다. 기존 바인딩과 이력 보존 검토가 별도로 필요하다.

기존 wife v1 경로·마커·기준 장부는 그대로 읽는다. 새 프로필 쓰기는
`brokerage/toss/<owner>-<suffix>/accounts/<account hash>/<source set hash>/`와
`reconciliation/increments/v2/<owner>/toss/<account hash>/index/`를 사용한다.
manifest와 marker에 같은 바인딩을 고정하고 collector의 accountSeq 해시까지 확인한다.
이전 v1 publication 재개는 기존 wife suffix 보호를 유지한다. v2는 명시한 프로필과
현재 참조의 계좌 해시까지 일치해야 한다. 각 publication은 독립 로컬 폴더에서 재개한다.

UI는 같은 관리자 UID의 기존 workbook 소유권 검증을 유지하며 가족 전체/아내/남편을
메모리에서 필터링한다. 서버의 한 요청에서 기준 장부와 허용된 프로필 증분을 읽는다.
남편 기준 장부는 생성하지 않으며 연결 전 상태를 빈 완전 원장으로 표현하지 않는다.
인증/권한 변경 시 기존 클라이언트 캐시와 화면을 폐기한다. 필터 선택은 세션 메모리에만
있고 새로고침/재시작은 가족 전체로 돌아온다. 프로필 변경은 새 수동 실행이다.

합계는 통화별로만 표시하고 환산하지 않는다(합산 환율 미적용).
배당·세금환급만 수입이며 이체를 수입으로 합산하지 않는다. 이체의 내부/외부 여부는
추정하지 않고 근거 없는 분류를 보류한다. 같은 계좌의 동일 ID/내용은 한 번만 세고
다른 내용은 충돌로 중단한다. 다른 계좌의 같은 주문 ID는 별도 사건이다.
관측 행 수와 계산 대상 거래 수는 별도다. 기존 2,962행 장부와 PDF 자료는 변경하지 않는다.

## 실행 양식 (이번 구현에서 실호출하지 않음)

`node scripts/toss/read-account-orders.mjs --help`를 먼저 확인한다.

```text
node scripts/toss/read-account-orders.mjs --live --profile wife-toss --status OPEN --env-file <기존파일> --prepare-publication
node scripts/toss/read-account-orders.mjs --live --profile husband-toss --status BOTH --from <YYYY-MM-DD> --to <YYYY-MM-DD> --env-file <기존파일> --prepare-publication
node scripts/toss/publish-account-observations.mjs --directory <기존publication> --profile husband-toss --env-file <기존파일> --publish
```

명시한 env-file은 독립 인증 소스다. OS 토큰/다른 파일과 합치지 않으며 파일이 없으면
실패한다. 프로필은 `TOSS_<OWNER>_ACCESS_TOKEN/CLIENT_ID/CLIENT_SECRET`만 참조하고
일반 `TOSS_ACCESS_TOKEN`을 사용하지 않는다. 토큰 발급에는 기존처럼 `--issue-token`이 필요하다.
브라우저 자료에는 독립 확인한 `accountVerified:true`, `profileId`, `accountNoSha256`과
`accountSuffix`가 필요하며 API 성공으로 대신하지 않는다. 과거 v1 입력 읽기는 보존하지만
새 브라우저 첨부에는 대상 확인을 요구한다.

서버에서도 동일 계좌 매핑 참조를 읽기 전용으로 설정한 뒤 프로필 증분을 조회한다.
`.env.example`은 참조 이름을 설명하는 placeholder이며 새 인증 설정 권한을 뜻하지 않는다.
실제 남편 연결·키 발급·금융 조회·R2 쓰기·운영 데이터 교체·push/배포는 별도 단계다.

## 합성 검증과 호출 범위

`node --test tests/family_account_profiles.test.mjs tests/toss_ledger_increments.test.mjs tests/final_ledger.test.mjs`
및 전체 `node --test tests/*.test.mjs`를 사용한다. 브라우저는 개발 서버에서
`CHROMIUM_PATH=<설치된Chromium경로> node tests/toss-increments.browser.mjs`로 검증한다.
모든 계좌·금액·인증은 합성 자료이며 금융 API/R2 실호출은 없다.

측정한 브라우저 가족 최초 조회는 API 1회, 동시 조회는 1회로 합쳐지고 계좌 필터 전환은
추가 API 0회다. 새로고침/권한 실패 후 재조회는 각각 새 요청을 수행한다.
서버 합성 검증에서 프로필 둘을 등록한 가족 조회는 기존 v1 목록 1회 + v2 계좌별 목록
각 1회이며 동일 동시 요청은 공유한다. 기존 기준 snapshot은 관리자 세션 범위 캐시를
재사용한다. 기존 인증 handler의 workbook 권한 확인은 요청당 Firestore 문서 2회다.
금융사 API 호출·운영 Firestore/R2 사용량·실제 청구량은 측정하지 않았다.

v2 중복키는 프로필/계좌 해시/주문 ID를 포함한다. 같은 wife 주문의 v1/v2 관측은
suffix와 **검증된 collector 계좌 해시(accountSeq의 SHA-256)**까지 일치할 때만 같은
계좌 namespace로 연결한다. 같은 owner의 v1끼리도 collector 계좌 해시가 다르면
전체 투영을 중단한다. 동일한 끝 4자리는 계좌 동일성의 증거가 아니다.

기존 채택 snapshot에는 계좌 바인딩 증거가 없다. 따라서 v2 관측은 기존 owner-only
주문 ID를 근거로 기준 행을 덮어쓰거나 snapshot 날짜 이전이라는 이유로 사라지지 않는다.
기준 장부에 같은 주문 ID 후보가 있으면 두 원문을 보존하고 신규 행에
`기준 계좌 연결 미확인 · 합계 제외`를 표시한다. 실제 원문으로 계좌 연결을 검증하기
전에는 신규 후보를 합계에 반영하지 않는다. 기존 v1 동작과 채택 원장은 보존한다.
다른 계좌로의 슬롯 교체나 과거 계좌 이력 합치기는 지원 범위가 아니다.

2026-11-01 보강 검증에서는 클라이언트 → 인증 handler → 실제 store → 메모리 R2
종단 fixture로 두 계좌의 동일 suffix/주문 ID, 계좌별 index 읽기, 동시 조회와 상세 접근
격리 및 원문·비밀값 비출력을 확인했다. 미분류 이체는 수입 합계에서 제외하고 통화별
십진수 합계를 유지한다. 독립 리뷰에서 발견한 legacy/v2 계좌 혼입 결함은 위 해시
대조와 기준 후보 보류로 수정했으며 재리뷰에서 해소를 확인했다. 전체 단위 테스트
630개와 관련 42개가 통과했다. 실제 금융 인증과 운영 자료 검증은 수행하지 않았다.
