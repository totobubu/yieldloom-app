# Yieldloom 로컬 코드 통합 (2026-11-02)

## 단일 개발 작업본

- 경로: `C:\Users\stead\Documents\Codex\2026-10-28\task\yieldloom-unified-20261102`
- 브랜치: `feat/fifo-unified-local-20261102`
- 기준: `origin/work`의 `900294aef8e8a8e49244be510aca83273440635e`
- 실행: 해당 폴더에서 `npm run dev`. 검사: `npm run type-check`, `npm run build`, `npm run lint:check`, 관련 `node --test`.
- FIFO 기본 화면 전환 플래그는 `VITE_FIFO_PORTFOLIO_READY=false`다. 실제 비공개 채택 장부의 계좌·보유·거래·배당 범위 검증 전에는 켜지 않는다.

## 출처와 보존 상태

| 기능 | 출처와 현재 상태 | 이번 통합 |
| --- | --- | --- |
| 가족 계좌 분리·채택 장부·FIFO 자산 리포트·안전 진단 | 이미 `origin/work` `900294a` 및 `origin/main` `ec93a6c`에 포함 | 기존 코드 재사용. 중복 적용 없음 |
| 공식 토스 주문 수집기와 OPEN/CLOSED 테스트 | 최신 `work`에 포함. 원래 업무 PC `yieldloom-app`의 `feat/toss-closed-order-collector`에는 별도 미커밋 파일이 남아 있음 | 기존 폴더 보존. 최신 수집기 코드로 덮어쓰지 않음 |
| 헤더·푸터 사이트 제목 | 종료된 클라우드 작업의 대화 기록에서 재구성한 로컬 커밋 `852ce3c13b74fcd2277358d7590f6394ff43a7a9` | 이 브랜치에 패치 적용. 원래 미커밋 파일의 바이트 단위 복구로 주장하지 않음 |
| FIFO 거래·배당 표, 미리보기 경로, 메뉴 정리, 전환 플래그 | 같은 클라우드 재구성 커밋 `5247318c9c4e03a2b5519f0fe7f165987e7e1709` | 이 브랜치에 패치 적용. 기본 `/mypage` 전환은 보류 |
| Wealthfolio 실험·토토·로또 | Yieldloom 앱의 이번 통합 대상이 아님 | 편입하지 않음 |

전달 패치는 비공개 Page 파일에서 받아 12,651바이트와 SHA-256
`779f423965f5b60603d63ac3c2baf0757d2d4787faf7c8f97d9d729b07cc73d8`을
확인했다. 원본 base는 `9f36b879f4b9ada232243e0f4d67e79a45f86aaa`다.
최신 `work`에 적용해 새 로컬 커밋을 만들었으므로 커밋 SHA는 원본과 다르다.

현재 작업은 코드 통합본이다. 실제 장부 자료 검증, `/mypage` 운영 전환,
원격 push·PR·병합·배포, 기존 작업 폴더 및 브랜치 삭제는 수행하지 않았다.
