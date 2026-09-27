# 17. 공식 수집 대조 및 기존 배당 이력 콘텐츠 반영

## 공식 수집 및 대조

- YieldMax 공식 ETF 펀드 이력 페이지를 수집해 SQLite 원장에 반영했다.
- 수집 후 `public/data`와 대조한 결과: `matched` 3,379건, `amount_mismatch` 171건, `expected_only` 41건, `needs_review` 36건, `missing_data_file` 25건이다.
- 차이·누락은 자동 반영하지 않으며 기존 수동 승인 절차를 유지한다.

## 이전 배당 비교 수정

- 문제: 콘텐츠 생성기는 SQLite에만 과거 이벤트가 있을 때 직전 배당을 계산했다. 기존 `public/data`에만 이력이 있는 티커는 “이전 기록 없음”으로 생성됐다.
- 수정: SQLite 직전 이벤트가 없을 때 `public/data/{market}/{ticker}.json`의 `backtestData`에서 현재 배당락일 이전의 마지막 실제 행(`expected: true` 제외)을 읽는다.
- `amountFixed`를 우선하고 없으면 `amount`를 사용한다. 이 읽기는 JSON을 수정하지 않는다.
- 산출물 manifest에는 `previousDistribution`과 `previousDistributionSource`(`sqlite` 또는 `public-data`)를 남긴다.

## 산출물 갱신

- 기존 bundle 51개 중 50개가 직전 배당을 찾도록 다시 생성했다.
- 그중 26개는 `public/data`, 24개는 SQLite 공식 원장을 기준으로 변화율을 계산했다.
- HTML 카드와 PNG 썸네일·블로그 커버를 강제 재렌더링하고 공개 산출물 복사본을 갱신했다.

## 검증

- 단위 테스트는 SQLite에 직전 이벤트가 없을 때 `public/data`의 마지막 실제 `amountFixed` 값을 가져오는지 확인한다.
