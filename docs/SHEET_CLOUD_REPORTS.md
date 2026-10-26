# 관리자 클라우드 대조 보고서

`/admin/sheet-ledger`의 수집·대조 패널은 읽기 전용이다. 기존 거래 목록의 전체
검색/정렬·브라우저 스크롤·수동 행 추가 및 관측 채택 API는 변경하지 않는다.
새 패널에는 채택 버튼이 없으며, 원금 확정 또는 완전 수집/검증을 주장하지 않는다.

## 비공개 조회 계약

기존 서버 함수 `/api/portfolio-capital?view=sheet-reports&accountId=wife|husband&section=summary|details`를 재사용한다.
Firebase 토큰(기존 취소 검증 포함)과 관리자 허용 목록을 검사한다. 현재 uid의
`sheetTrialLedgers/{uid}` 메타·첫 페이지(2문서)를 읽어, 이미 가져온 시트의
`source.spreadsheetId` SHA256이 비공개 인덱스의 출처와 일치할 때만 보고서를 반환한다.
다른 출처의 관리자·빈 장부는 거절하며 허용 목록만으로 전체 보고서 접근을 주지 않는다.
현재 계약은 부부 탭을 포함한 동일 시트 원본에 접근 가능한 관리자 범위다.

기존 서버 R2 인증(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)으로
고정 비공개 버킷 `yieldloom-data-private`만 읽는다. 공개 버킷명·공개 URL로 fallback하지
않으며 권한이 없으면 503을 표시한다. 새 키·권한을 생성하거나 복사하지 않는다.

`reconciliation/dashboard/v1/current.json`은 schemaVersion, runId, sourceBinding,
계좌별 summary/details의 불변 객체 키와 SHA256을 갖는다. 각 문서는 schemaVersion=1,
동일 runId, accountId, section을 포함한다. summary는 metrics/flows/holds/manualEvidence/
nonblocking/limitations를, details는 같은 계좌 items를 갖는다. 데이터 JSON은 Git·공개
번들에 넣지 않고 비공개 R2에만 저장한다. 원문은 그대로 보존하고 별도 화면용 모델을 사용한다.
서버는 경로·계좌·버전·본문 크기·SHA256을 검사하고 private/no-store로 반환한다.

## 성능·검증 범위

초기 진입은 선택 계좌 요약만 1회 HTTP, R2 인덱스+요약 2회 GET,
소유 출처 확인 2문서 읽기다. 근거를 펼칠 때만 상세를 별도로 읽는다.
계좌별 동시 GET을 합치고 같은 컴포넌트/로그인 사용자 메모리에서 30초 재사용한다.
계좌는 키에 포함하며 사용자·권한 변경/로그아웃/해제 때 캐시를 폐기한다.
수동 새로고침은 캐시를 지우며 실패 응답을 캐시하지 않는다. DB 쓰기는 없다.
실제 Firestore 청구량과 Auth 검증 비용을 이 문서 읽기 수로 단정하지 않는다.

남은 비체결 상세는 비차단 참고로 표시하며 추가 수집을 요구하지 않는다. 부분체결이나
실제 현금 이동 근거가 있으면 상태 표시만으로 제외하지 않는다. 수동 캡처는 금융사
상세원문 직접 수집 및 직접 주문 ID 확인과 구분한다. 미확정 비용을 0으로 채우지 않는다.

합성 검증: `node --test tests/sheet_reports.test.mjs`. 실제 운영 관리자 읽기는 별도
인증이 필요하며 합성 검사 성공을 실제 계좌 연동 성공으로 보고하지 않는다.
