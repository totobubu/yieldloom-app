# FIFO 포트폴리오 전환 점검

## 현재 구현

- `/admin/fifo-portfolio`는 채택 장부의 FIFO 계산, 계좌별 보유·손익, 거래·배당 사건을 조회한다.
- 계정 메뉴의 독립 거래내역 링크는 제거했다.
- `VITE_FIFO_PORTFOLIO_READY=true`인 빌드에서 `/mypage`를 FIFO 화면으로 바꾸고 기존 PDF 화면 및 `/admin/sheet-ledger` 직접 진입을 `/mypage`로 보낸다. 기본값은 `false`다.
- 기존 Firestore·R2 자료와 읽기 API는 변경하지 않았다.

## 운영 전환 차단 조건

실제 인증된 채택 snapshot에서 계좌 목록, 현재 보유 수량, 거래·배당 사건 범위와 누락 여부를 읽기 전용으로 확인해야 한다. 현재 작업 환경에는 비공개 장부 조회 인증이 없어 검증하지 못했다. 합성 테스트는 이 조건을 대신하지 않는다. 검증 결과와 해당 배포의 정확한 SHA를 기록한 뒤에만 플래그를 켠다.

## 원격 브랜치 확인 (2026-11-02)

GitHub의 원격 `work`는 `900294a`, `main`은 `ec93a6c`였다. 이 로컬 checkout의 `work`는 `9f36b87`로 뒤처져 있다. 원격 `work` 기준 compare 결과:

| 브랜치 | ahead/behind | 잠정 판단 |
| --- | ---: | --- |
| `codex/thumbnail-projection-recovery` | 0/64 | 삭제 후보 |
| `feat/fifo-work-integration` | 0/73 | 삭제 후보 |
| `feat/adopted-ledger-fifo-report` | 3/85 | FIFO 원본 커밋의 통합 여부와 PR 확인 후 삭제 후보 |
| `feat/family-account-profiles` | 4/85 | 가족 프로필 원본 커밋의 통합 여부와 PR 확인 후 삭제 후보 |
| `backup/official-source-discovery` | 3/301 | 백업 목적·고유 변경 확인 전 보존 |
| `codex/register-yskh-20261028` | 2/135 | 열린 PR #179 확인 전 보존 |
| `feat/kis-local-history-collector-20261028` | 3/141 | 고유 수집기 변경 확인 전 보존 |

비교의 ahead 수는 내용이 미통합이라는 뜻이 아니다. 브랜치 삭제 전 PR 상태, 고유 변경, 소유자의 진행 작업을 재확인한다.
