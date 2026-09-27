# 14. 기존 public/data 배당 대조 및 수동 승인

## 완료 범위

- `public/data/{market}/{ticker}.json`의 `backtestData`를 Content Studio SQLite 공식 배당 원장과 대조한다.
- 대조 키는 `ticker + ex_date`이며, SQLite의 공식 주당 배당금은 기존 JSON의 `amount`와 `amountFixed` 각각에 대해 비교한다.
- `expected: true`만 있고 실제 금액이 없는 행은 일치로 보지 않고 `expected_only` 승인 대기로 남긴다.
- 수집 이벤트 자체가 `needs_review`이면 수치가 우연히 같아도 해당 상태를 유지한다.
- 스캔은 SQLite의 `public_data_reconciliation_reviews`에 결과, 공식 URL, 제안 패치, 검토자 및 적용 전후 SHA-256을 기록한다.

## 상태와 정책

| 상태 | 의미 | public/data 자동 변경 |
| --- | --- | --- |
| `matched` | 같은 배당락일과 `amount` 또는 `amountFixed`가 일치 | 하지 않음 |
| `missing_date` | 티커 파일은 있으나 같은 배당락일 행이 없음 | 하지 않음 |
| `amount_mismatch` | 같은 배당락일 행의 두 금액 모두 불일치 | 하지 않음 |
| `expected_only` | 예정 행만 존재 | 하지 않음 |
| `needs_review` | SQLite 수집값 자체가 검토 대기 | 하지 않음 |
| `missing_data_file` | 티커 JSON 파일이 없음 | 기존 티커 온보딩 절차가 필요 |

## 운영 명령

```powershell
npm run content:reconcile

# 대조 화면의 review id를 사람이 확인한 뒤에만 실행
python scripts/content_pipeline/reconcile_public_data.py --apply-review 123 --reviewer "reviewer-name" --action append

# 이미 존재하는 예상/불일치 행을 실제 공식 값으로 바꾸는 경우
python scripts/content_pipeline/reconcile_public_data.py --apply-review 123 --reviewer "reviewer-name" --action replace
```

`append`는 동일 배당락일이 없는 경우만 허용하고, `replace`는 동일 날짜 행이 있는 경우만 허용한다. 승인자 이름과 적용 전후 파일 SHA-256은 SQLite에 남는다. 수집 파이프라인도 대조 스냅샷을 생성하지만, 이 단계는 읽기 전용이다.

## 관리자 화면

- `/reconciliation`의 **대조** 메뉴가 `public/content-studio/reconciliation.json`을 표시한다.
- 정적 관리자 화면에서는 파일을 쓸 수 없으므로 승인 버튼을 제공하지 않는다. 쓰기 권한과 승인자 식별을 요구하는 로컬 CLI만 반영 경로다.

## 확인 결과

- 실제 기존 SQLite 원장으로 초기 스캔을 실행해 `matched 32`, `needs_review 36`, `expected_only 18`을 기록했다.
- 이 초기 스캔에서는 `public/data` 파일을 수정하지 않았다.
- 단위 테스트는 일치, 누락, 금액 불일치, 예정 값 및 명시 승인 append를 검증한다.
