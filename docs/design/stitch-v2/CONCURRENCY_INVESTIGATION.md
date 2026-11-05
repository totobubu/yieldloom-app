# 병행 테스트 간섭 조사 — 17차

16차 QLDY768 검사는 도움말을 닫은 뒤 Oct15 회차1행 대신0행을 관측했다. 기존 로그에는 HMR/탐색 기록이 없어 **그 과거1회의 단독 원인을 확정할 수 없다**. 실패 로그의 마지막 수정시각은2026-11-04 17:32:22.386 UTC이고 같은 서버의 FIFO 검사 완료로그는17:32:23.810 UTC다. 이는 겹침의 증거이며 파일 삭제시각 자체의 기록은 아니다.

## 유한 재현과 수정

| 실험 | 다른 탭의 회차 표 | Vite 관측 | 결과/근거 |
|---|---|---|---|
| 수정 전 실제 FIFO helper의 파일 기반 HTML 진입/삭제 | 12→0, 기본 월별24셀로 복귀 | 전체 reload2개, path `*` | `checks/phase17/isolation-before.json` |
| 브라우저 내부 가상 응답으로 바꾼 같은 helper | 12→12, 월별0셀 | reload0/탐색0 | `isolation-after.json` |
| 실행 모듈이 없는 단순 임시HTML | 12→12 | 해당HTML 경로만 전송 | `isolation-control.json`; 처음의 포괄적 가설이 틀린 음성 대조 결과도 보존 |
| Vue inline module을 실제로 로드한 임시HTML을 닫고 삭제 | 12→0, 월별24셀로 복귀 | 해당HTML 경로 후 전체 `*` reload | `isolation-module-control.json`; HTML 모듈 그래프 경로를 포함한 충분조건 재현 |

Vite7의 `updateModules`/HTML proxy 경로에서 자기 수용되지 않는 엔트리 삭제는 전체 reload를 만들 수 있다. 단순HTML 변경은 특정 경로 reload라 다른탭이 무시하므로 ‘파일을 쓰면 항상 다른탭이 초기화된다’고 일반화하지 않는다. 이 재현은 과거와 같은 회차 표 소실을 설명하는 **확인된 개발 서버 간섭**이다. 과거 WebSocket 원본 로그를 대신하지 않는다.

`tests/support/fifo-calendar-browser.mjs`의 실제 디스크HTML 생성/삭제를 없애고 `page.route`로 같은URL에 합성HTML을 응답한다. Vue와PrimeVue는 실제 Vite 컴파일 참조를 사용한다. 기존 윤년/날짜미상/시간대/키보드/필터/라이트·다크·API0 기대값은 유지한다. 데이터·기간·회차를 바꾸거나 사라진 표를 기다려 임의 복구하는 코드는 넣지 않았다. 직접 패키지URL을 쓴 초기 가상화는 로드되지 않아 실제 최적화 참조를 사용하도록 수정했고 실패로그도 남겼다.

실제 `fifo-report`와강화된`security-insights`를 동일서버에서 동시에 실행한 제어검사도 모두 통과했다. 첫 실행은 FIFO의SHEET_LEDGER_UI_BASE_URL을 지정하지 않아 기본5185연결이 거절된 구성오류였으며 금융 assertion에 도달하지 않았다. 실제 검증서버5175를 지정한 재실행의 두로그/결과를 따로 보존했다. `controlled-concurrent-first-launch.json`과 `controlled-concurrent-results.json`을 구분한다.

기본CI에는 형제탭이12행을 유지하고 reload/탐색0인지 검사하는 `browser-harness-isolation.browser.mjs`를 추가했다. ROC테스트는 실패할 때 Vite 전체reload의종류/경로/폭/시각만 진단으로 출력하며 금융 기대값과 실패 종료 상태를 유지한다. 인증값·환경변수·실제 계좌 식별자는 기록하지 않는다.

## 실행 원칙과 남은 한계

같은Vite인스턴스의 전체브라우저스위트와원본비교캡처는 **순차로 실행**한다. 다른레거시검사(예:cash-review,cash-fx-links)는 아직 디스크HTML fixture를 사용하므로 모든 검사를 임의 병렬로 돌려도 안전하다고 주장하지 않는다. 병렬 그룹은 서로 다른포트/캐시의Vite인스턴스를 사용한다. 개발중 소스변경/최초의존성최적화도 HMR을 일으킬 수 있으므로 렌더링 검수 도중 제품파일을 수정하지 않는다.

재현은 합성공개시세/검토이벤트만 사용하며 실제계좌·DB·외부금융API에 쓰지 않는다. 현재일반실행은 파일을 만들지 않는다. `--expect-reload`는 명시적 음성대조로만 일시적인합성 inline-module HTML을 만들고 finally에서삭제한다. 정규CI는이플래그를사용하지않는다.

```sh
UI_BASE_URL=http://127.0.0.1:5175 node tests/browser-harness-isolation.browser.mjs
UI_BASE_URL=http://127.0.0.1:5175 node scripts/design/check-vite-browser-isolation.mjs --expect-reload
```
