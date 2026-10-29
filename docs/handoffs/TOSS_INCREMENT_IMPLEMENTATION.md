# 수동 수집 → private R2 → 장부 증분 연결 인계

상태: 클라우드에서 인계 코드 검증 및 무결성 보완. work/main 병합·운영 배포 없음.
이 문서는 실제 금융 값·자격증명을 포함하지 않는다. 실제 증거 객체의 정확한 경로와
검증 영수증은 통합 작업 대화로 전달한다. 로컬 금융 폴더를 클라우드/Git으로 복사하지 않는다.

## 브랜치와 기반

- `feat/toss-private-ledger-increments-20261029`, 기준 work `5c0d2bd`.
- 계획 커밋 `20c03d8`, 로컬 통합 커밋 `a68199b`.
- Draft PR181의 `bc1c4b7`을 이 feature에서 재사용했다. 원본 PR181은 변경하지 않았다.
- `PLAN.md`, `docs/TOSS_LEDGER_INCREMENTS.md`, 스킬의 publication reference가 계약이다.

## 구현

- `lib/toss-ledger-increments.js`: raw/manifest/receipt/member 검증, 불변 hash index,
  중복 관측 보존·합계 보류, API order별 최신 누적 상태의 읽기 projection.
- `scripts/toss/publish-account-observations.mjs`: 기존 run/ego JSON 준비, 사후 ego 붙이기,
  기존 R2 credentials의 조건부 불변 저장·GET 검증·index commit·실패 후 재개.
- `read-account-orders.mjs`: 명시적으로 승인된 저장 옵션. API 성공과 저장 상태를 분리한다.
- PR181 reader와 관리자 UI에서 baseline+검증된 증분을 읽는다. baseline 원문·채택값은 불변이다.
- REST connector가 조건부 헤더를 지원하지 않을 때도 공유 pointer는 갱신하지 않는다.
  body SHA 자체를 key로 쓰는 append-only index이므로 독립 동시 writer의 갱신 손실이 없다.
  SDK 쓰기는 If-None-Match:*와 충돌 시 정확한 바이트 GET 확인을 사용한다.

## 실제 외부 작업

이미 private R2에 보존한 묶음에 index 한 항목을 추가하고 GET 크기/SHA를 검증했다.
원문 묶음을 재업로드하거나 API/ego 재수집하지 않았다. 기존 baseline/dashboard pointer는
덮어쓰지 않았다. 향후 작업은 기존 index를 먼저 읽어 재사용해야 한다.
현재 운영 reader는 이 feature를 배포하지 않았으므로 실제 앱 반영 완료가 아니다.

## 검증 상태

- 증분 unit 13개: 최종 로컬 실행 통과. 중복 재실행/사후 ego 결합/원문 금액 일치/비밀 필드 거절,
  부분 업로드/손상 GET/동시 추가/충돌/재시작/배당 정밀도/빈 API/상태 갱신/reader 권한 실패 포함.
- 기존 final ledger + manual helper 17개는 앞선 실행 통과.
- 새 합성 브라우저 테스트: 단일 신규 행, source, 세전/세금/실수령/분 단위 시각, 모바일,
  권한 거부 후 화면 폐기 통과. 실제 사용자 로그인 검증은 아니다.
- type-check/build 통과 후 사후 ego 결합과 검증 강화가 추가됐다. 최종 head 전체 재검증 필요.
- 전체 Node의 이전 실행은 599개 중 597개 통과. 실패 2개는 Windows Python 실행/인코딩이었다.
  실제 Python 경로+PYTHONUTF8=1/PYTHONIOENCODING=utf-8로 해당 CSV 9개를 재실행하여 통과.
  최종 전체 Node/API/브라우저/타입/린트/빌드 및 exact-head CI 완료는 후속 작업이다.
- full lint의 최초 새 unused import 3개는 제거했다. 최종 제한 lint 결과는 작업 대화에 전달한다.
- 실제 증분 bundle은 최종 검증기로 오프라인 통과. 실제 baseline 전체를 Cloudflare 실행기에서
  읽어 projection하는 시도는 Worker 메모리 한도로 중단됐다. 원격 변경은 없었다.

## 환경과 실행

Node 24. Windows의 기존 의존성을 worktree node_modules junction으로 사용했다.
기존 빈 캐시는 workspace 밖이 아닌 같은 task의 별도 cache 폴더로 보존했다.
개발 서버는 `http://127.0.0.1:5173/`에서 HTTP200 확인. 서버는 기존 운영 API를 proxy하므로
로컬 feature API가 실제 동작한다고 단정하지 않는다. 로컬 프로세스 R2 환경변수는 없었다.
새 키/다른 환경의 키를 복사하지 않는다. 기존 Cloudflare 연결로 현재 private 객체를 읽을 수 있다.

```sh
npm ci --no-audit --no-fund
npm run type-check
npm run lint:check
npm run build
node --test tests/*.test.mjs
node --test tests/toss_ledger_increments.test.mjs tests/final_ledger.test.mjs tests/toss_account_details.test.mjs
node tests/toss-increments.browser.mjs
node tests/final-ledger.browser.mjs
node scripts/toss/publish-account-observations.mjs --help
```

브라우저 테스트는 기존 설치 Chromium을 CHROMIUM_PATH로 지정할 수 있다. 합성 테스트만
사용하며 사용자 토스 세션을 Playwright로 조작하지 않는다. 실제 화면은 기존 ego 계약을 따른다.

## 다음 작업

1. 원격 head와 이 인계 checkpoint를 확인하고 한 실행자만 수정한다.
2. 최종 코드 리뷰·전체 검사·Draft PR exact-head CI를 마친다. PR181 중복 수정에 주의한다.
3. 이미 연결된 private 증분을 기존 credentials의 Preview reader에서 읽는다. 실제 Firebase
   관리자/시트 소유권 로그인 후 화면에서 기존 행 불변과 신규 1회 표시를 확인해야 한다.
4. index 무결성 실패를 0건으로 숨기지 않는다. 실제 승인 baseline 전체의 행 수/합계 검증은 미완료다.
5. 사용자 별도 승인 전 work/main 병합·운영 배포하지 않는다. 이 로컬 작업은 인계 후 코드 수정 중지.

## 클라우드 후속 확인

- 인계 head `8d94360`의 application/portfolio-api/browser CI 모두 통과 및 Preview READY 확인.
- API 관측 순서는 page receipt의 `receivedAt`만 사용하도록 보완했다. 오래된 API →
  최신 API → 오래된 API에 브라우저 사후 첨부 순서와 입력 순서 역전을 회귀 검증했다.
- API 완료 표지와 포함 파일을 대조한다. manifest/checkpoint/index/page 유실, 계좌 해시,
  페이지 연속성·cursor 종료·주문 수·index 원문 참조 불일치는 연결 전 거절한다.
- 보완 후 전체 Node 605개, 증분 17개, API 관련 Python 62개 통과. 타입 포함 빌드 통과,
  full lint 오류 0개/기존 경고 72개, 변경 파일 lint/format/diff 검사 통과.
- 합성 증분 브라우저에서 신규 행 1회·출처·세전/세금/실수령·분 정밀도·모바일·권한 거부 후
  자료 폐기 통과. 로컬 Vite 의존성 사전 번들 캐시 오류를 격리한 뒤 재검증했다.
- 기존 R2 index/manifest/receipt/part 4객체를 실제 GET해 index SHA 및 내부 10파일 검증.
  기존 로컬 baseline은 pinned manifest/receipt/원문 해시를 검증해 재사용했다.
  전체 투영에서 기존 거래 2,957행과 합계 불변, 신규 1행 포함 2,958행, 반복 행 증가 없음.
  미체결 취소 580건 제외 및 계좌 미지정 PDF 200행 별도 유지. 이번 확인의 R2 쓰기 0건.
- 인증 없는 Preview 요청은 Vercel SSO 302다. 기존 로그인 브라우저 확인을 요청했으며,
  실제 관리자 → Preview API → R2 → 화면 검증은 아직 완료로 판정하지 않는다.
- 후속 보완 커밋 exact-head CI/Preview는 같은 PR #187에서 확인한다. PR181과 원본/채택값은 보존한다.
