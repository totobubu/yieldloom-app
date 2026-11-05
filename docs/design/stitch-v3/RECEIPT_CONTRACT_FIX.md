# 영수증 실제 저장 계약 보완

운영 #251의 저장·계산은 변경하지 않는다. API `TYPES`의 9개 거래 코드와 표시 사전을 맞췄다. 입출금은 `deposit/withdrawal`이 아니라 `cash_in/cash_out`이며, 배당 취소와 이체 입·출고도 구분한다. 숫자와 부호를 다시 계산하지 않는다. 통화별 현황의 입출금 항목 판정도 같은 실제 코드를 사용하고 합계는 계속 미제공이다.

`securityName`은 이미 검증·저장되는 선택 필드다. 기존 commit 응답 투영에만 포함하고, 제공된 이름을 표시하며 없으면 기존대로 명칭 미제공이다. 별도 조회/쓰기/업체명 추정은 없다. 합성 시안에만 넣었던 비정규 거래 코드를 실제 API 코드로 고쳤다. 원래 값에 없던 회사 이름은 실제 데이터에 넣지 않는다.

API 64개, Node 814개·lint/타입/빌드 통과. 새 API 검사는 실제 저장된 이름과 응답 이름이 같고 canonical cash 코드가 유지됨을 확인한다. UI 캡처는 5개 폭에서 입·출금 이름과 입출금 항목, 제공된 명칭의 표시를 검사했다. [Tablet](evidence/receipt-contract/implementation-834.png), [Mobile](evidence/receipt-contract/implementation-390.png), [측정](evidence/receipt-contract/measurements.json). 전체 픽셀 승인과 실제 로그인 계좌/PDF는 미확인이다. 새 업로드 레이아웃은 이 수정에 포함하지 않는다.
