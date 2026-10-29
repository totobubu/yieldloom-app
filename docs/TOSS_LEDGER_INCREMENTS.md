# 수동 토스 수집의 비공개 저장과 장부 증분 연결

미병합 PR181의 최종 장부 reader/UI를 통합 브랜치에서 재사용한다. 원본 PR과 기존
baseline·채택값·보고서 pointer를 유지한다. 운영 반영이나 예약 실행은 포함하지 않는다.

## 쓰기와 경합

API 원문, ego의 실제 읽기 JSON, 정규화 관측을 기존 private raw-bundle 형식에 보존한다.
manifest는 파일·압축 전후·part의 크기/SHA를 갖는다. API 성공과 저장 성공은 별개다.
부분 API 결과나 실패를 0건으로 공개하지 않는다. 저장 재개에 기존 run을 사용한다.

순서는 part → manifest → GET/복원/member 검증 → 완료 receipt → GET 검증 → index다.
중간 실패는 증거를 보존하며 index를 전진시키지 않는다. SDK는 If-None-Match:\*를 사용하고
412 충돌이면 GET의 전체 바이트 일치를 확인한다. 비밀값·전체 계좌번호는 출력하지 않는다.

index는 공유 current.json이 아닌 append-only commit log다.
`reconciliation/increments/v1/wife/index/<body SHA256>.json`의 body에는 accountId와
manifest/receipt 키·크기·SHA만 있다. 서로 다른 writer가 각기 다른 키에 추가하므로
다른 증분을 잃지 않는다. 같은 body는 같은 키이며 해시/바이트 충돌은 오류다.
조건부 헤더가 없는 기존 Cloudflare REST 연결도 이 불변 append만 사용한다.
공유 pointer를 새로 만들거나 기존 baseline을 갱신하지 않는다. 동시 추가가 목록 읽기 뒤
완료되면 다음 명시적 새로고침에서 보인다. 조회 시점 전체 원장의 고정 snapshot은 보장하지 않는다.

reader는 최대 128개 항목을 한 목록 응답으로 읽는다. 초과·페이지 잘림은 오류이며 일부를
정상 전체 결과로 내보내지 않는다. 매 요청 index와 모든 참조·원문 member를 검증한다.
immutable baseline만 owner별 5분 메모리 캐시하며 동시 요청은 합친다. 클라이언트는 기존
세션 캐시 30초와 명시적 새로고침을 사용한다. 추가 확장은 별도 index 분할 계약이 필요하다.

## 금융 의미

- 웹 관측 ID와 금융사 거래 ID는 별개다. 현재 계약은 확인된 실제 배당 입금이며 원문 거래
  ID가 없으면 null이다. 취소·환수·정정은 이 계약에서 자동 채택하지 않는다.
- 같은 원문 재실행은 중복 행을 만들지 않는다. 다른 관측은 날짜·종목·통화로 후보만
  표시하고 강제 병합하지 않는다. 후보가 있으면 신규 웹 행은 합계에서 제외한다.
- API account+orderId별 최신 누적 상태를 표시하며 이전 baseline·원문을 보존한다.
  같은 관측시각의 상충 값은 오류, baseline보다 오래된 관측은 최신값으로 쓰지 않는다.
  빈 결과는 삭제가 아니다. 개별 분할 체결 사건을 생성하지 않는다.
- 통화·소수 문자열·세전·세금·실수령·분 정밀도를 보존한다. 없는 수수료·환율·초는 null이다.

## 인증과 완료 판정

기존 Firebase 관리자 검증과 시트 출처 소유권을 통과한 section=final에서만 응답한다.
R2 경로와 credentials는 클라이언트 입력으로 받지 않는다. private/no-store를 유지한다.
기준 내역과 신규 관측의 출처·상태를 구별하고 출처 상세에 세전·세금·실수령을 표시한다.
관측 표시는 과거 채택값 수정이나 새 정본 자동 승인이 아니다.

R2 검증 / index 연결 / 합성 UI / 실제 관리자 표시 / Preview / 운영 배포를 각각 보고한다.
로컬 R2 환경변수가 없으면 키를 복사·발급하지 않는다. 기존 Cloudflare 연결로 보존·연결할 수
있으나 이를 로컬 Firebase 인증·실제 화면 표시 성공으로 주장하지 않는다.
