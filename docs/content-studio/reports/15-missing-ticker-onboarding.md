# 15. 누락 티커 JSON 신규 티커 워크플로 연동

## 동작

- 대조기는 `public/data/{market}/{ticker}.json` 파일을 먼저 찾는다.
- 공식 확인 상태(`official`, `cross_checked`)의 수집 이벤트에 티커 JSON이 없으면 기존 `scripts/workflows/run_new_ticker_workflow.py`를 해당 티커 목록으로 한 번 실행한다.
- 워크플로가 끝난 후 파일 인덱스를 다시 읽어 같은 대조 실행 안에서 비교를 이어간다.
- 워크플로 실패 시 `newTickerWorkflow` 결과에 실패 원인, 종료 코드, 재시도 가능 여부를 남기고 `missing_data_file`로 보존한다.
- `needs_review` 이벤트는 공식 날짜·금액이 확정되지 않았으므로 신규 티커 자동 온보딩 대상에서 제외한다.

## 안전 장치

- 이 연동은 누락 티커의 기존 온보딩 절차만 실행한다. 수집 배당 이벤트의 `amount`/`amountFixed` 반영은 여전히 별도 수동 승인(`append` 또는 `replace`)을 요구한다.
- 필요 시 읽기 전용 대조는 `npm run content:reconcile -- --skip-onboard-missing`으로 실행할 수 있다.
- 파이프라인 실행은 기본적으로 누락 공식 티커를 온보딩한 뒤 대조 결과를 갱신한다.

## 검증

- 단위 테스트에서 누락된 공식 티커가 있을 때 워크플로가 정확히 한 번 호출되고, 실패 시에도 대조 결과와 재시도 정보가 유지되는 것을 확인한다.
