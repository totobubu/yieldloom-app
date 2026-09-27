# 배당 데이터 구조 재설계 제안

## 📋 현재 문제점

### 현재 구조
```json
{
  "backtestData": [
    {
      "date": "2025-11-26",
      "amount": 0.59,           // ❌ YF가 split 조정한 값 (오류 많음)
      "amountFixed": 0.0594,    // ✅ 실제 받은 금액
      "amountOriginal": null    // split 전 백업 (관리 복잡)
    },
    {
      "date": "2025-12-03",     // split 이후
      "amount": 0.588,
      "amountFixed": 0.5881
    }
  ]
}
```

### 문제점
1. **Yahoo Finance 데이터 신뢰도 낮음**: split 발생 시 과거 `amount` 값이 자동 조정되어 오류 발생
2. **amountOriginal 관리 복잡**: 백업 필드가 필요하지만 일관성 없음
3. **시간대별 비교 어려움**: split 전후 배당을 직접 비교하기 어려움
4. **데이터 정합성 검증 어려움**: split 비율과 amount의 관계 검증이 복잡

---

## 💡 제안하는 새로운 구조

### 제안 1: Split 구간별 객체 구조

```json
{
  "tickerInfo": {
    "events": {
      "splits": [
        {
          "date": "2025-12-01",
          "ratio": "1:10",
          "type": "split"
        }
      ]
    }
  },
  "backtestData": [
    {
      "date": "2025-11-26",
      "close": 5.94,
      "dividends": {
        "2025-12-01": 0.59,      // split 기준일별로 조정된 값
        "original": 0.0594       // 실제 받은 금액 (amountFixed)
      }
    },
    {
      "date": "2025-12-03",
      "close": 5.88,
      "dividends": {
        "original": 0.5881       // split 이후이므로 original만
      }
    }
  ]
}
```

**장점**:
- Split 구간별로 값 추적 가능
- 과거 어느 시점 기준으로도 계산 가능
- `amountOriginal` 불필요

**단점**:
- 객체 구조가 복잡해짐
- 프론트엔드에서 처리 로직 필요

---

### 제안 2: Split 구간별 배열 구조 (추천) ⭐

```json
{
  "tickerInfo": {
    "events": {
      "splits": [
        {
          "date": "2025-12-01",
          "ratio": "1:10",
          "type": "split",
          "splitId": "split_20251201"
        }
      ]
    }
  },
  "backtestData": [
    {
      "date": "2025-11-26",
      "close": 5.94,
      "dividend": 0.0594,        // 항상 실제 받은 금액만 저장
      "splitAdjusted": {         // 필요시에만 계산
        "split_20251201": 0.59   // 2025-12-01 split 기준 조정값
      }
    },
    {
      "date": "2025-12-03",
      "close": 5.88,
      "dividend": 0.5881         // split 이후이므로 조정 불필요
    }
  ]
}
```

**장점**:
- **단순성**: `dividend`는 항상 실제 받은 금액
- **명확성**: split 조정값은 선택적으로만 저장
- **확장성**: 여러 split 기준값 동시 보관 가능
- **호환성**: 기존 `amountFixed`를 `dividend`로 이름만 변경

**단점**:
- `splitAdjusted` 필드가 추가됨

---

### 제안 3: 메타데이터 분리 구조

```json
{
  "tickerInfo": {
    "events": {
      "splits": [
        {
          "date": "2025-12-01",
          "ratio": "1:10",
          "type": "split"
        }
      ]
    },
    "dividendConfig": {
      "useOriginalOnly": true,        // 항상 실제 받은 금액만 사용
      "latestSplitDate": "2025-12-01" // 최신 split 기준
    }
  },
  "backtestData": [
    {
      "date": "2025-11-26",
      "close": 5.94,
      "dividend": 0.0594    // 실제 받은 금액만
    },
    {
      "date": "2025-12-03",
      "close": 5.88,
      "dividend": 0.5881
    }
  ],
  "splitAdjustments": {
    // 클라이언트 요청 시에만 계산하여 제공
    "2025-12-01": {
      "2025-11-26": 0.59,
      "2025-11-19": 0.64,
      // ... 모든 과거 배당의 조정값
    }
  }
}
```

**장점**:
- **가장 단순한 데이터 구조**: `backtestData`는 실제 값만
- **성능**: 필요할 때만 계산/제공
- **명확성**: split 조정은 별도 섹션

**단점**:
- 조정값 사전 계산 시 `splitAdjustments` 크기 증가

---

## 🎯 최종 추천 구조

### 핵심 원칙
1. **`dividend` 필드는 항상 실제 받은 금액** (현재의 `amountFixed`)
2. **Split 조정은 런타임에 계산**
3. **Yahoo Finance 데이터는 검증 용도로만 사용**

### 최종 구조안

```json
{
  "tickerInfo": {
    "Symbol": "ULTY",
    "events": {
      "splits": [
        {
          "date": "2025-12-01",
          "ratio": "1:10",
          "type": "split"
        }
      ]
    }
  },
  "backtestData": [
    {
      "date": "2025-11-26",
      "open": 5.95,
      "high": 5.98,
      "low": 5.90,
      "close": 5.94,
      "volume": 1500000,
      "dividend": 0.0594        // 실제 받은 금액 (기존 amountFixed)
    },
    {
      "date": "2025-12-03",
      "open": 5.89,
      "high": 5.92,
      "low": 5.85,
      "close": 5.88,
      "volume": 1200000,
      "dividend": 0.5881
    }
  ]
}
```

### 클라이언트 측 처리

```javascript
// 최신 split 기준으로 과거 배당을 조정하여 표시
function getAdjustedDividends(data) {
  const splits = data.tickerInfo.events.splits;
  const backtest = data.backtestData;

  // 가장 최신 split 기준으로 조정
  const latestSplitDate = splits.length > 0
    ? splits[splits.length - 1].date
    : null;

  return backtest.map(item => {
    if (!item.dividend) return item;

    // Split 이전 배당이면 조정
    if (latestSplitDate && item.date < latestSplitDate) {
      const ratio = calculateCumulativeRatio(splits, item.date);
      return {
        ...item,
        dividendOriginal: item.dividend,
        dividendAdjusted: item.dividend * ratio,
        // 화면 표시용
        dividendDisplay: item.dividend * ratio
      };
    }

    // Split 이후 배당은 그대로
    return {
      ...item,
      dividendDisplay: item.dividend
    };
  });
}
```

---

## 🔄 마이그레이션 계획

### Phase 1: 필드명 통일

**작업**: `amountFixed` → `dividend` 이름 변경

```python
# 마이그레이션 스크립트
for item in backtest_data:
    if 'amountFixed' in item:
        item['dividend'] = item['amountFixed']
        del item['amountFixed']
    elif 'amount' in item:
        # YF 데이터만 있는 경우 (검증 필요)
        item['dividend'] = item['amount']
        item['needsVerification'] = True
```

**장점**: 간단하고 안전함

---

### Phase 2: amount 필드 제거

**작업**: Yahoo Finance의 `amount` 의존도 제거

```python
# 모든 배당 항목에서 amount 제거
for item in backtest_data:
    if 'amount' in item:
        # 검증용으로만 보관
        if 'dividend' not in item:
            item['dividend'] = item['amount']
            item['source'] = 'yfinance'  # 수동 확인 필요 플래그
        del item['amount']

    if 'amountOriginal' in item:
        del item['amountOriginal']  # 더 이상 불필요
```

**효과**:
- 데이터 크기 감소
- 혼란 제거
- 단일 진실 공급원 (Single Source of Truth)

---

### Phase 3: 클라이언트 로직 업데이트

**프론트엔드 변경**:
```javascript
// 기존
const dividend = item.amountFixed || item.amount;

// 변경 후
const dividend = item.dividend;
const adjustedDividend = calculateSplitAdjusted(dividend, splits, item.date);
```

**백테스트 로직**:
```javascript
// 수익률 계산 시 항상 최신 split 기준으로 조정
function calculateReturns(holdings, data) {
  const adjustedData = getAdjustedDividends(data);
  // ... 계산
}
```

---

## 📊 마이그레이션 스크립트

### 스크립트 1: 데이터 검증

```python
def validate_dividend_data():
    """마이그레이션 전 데이터 검증"""
    issues = []

    for file in all_json_files:
        data = load_json(file)
        for item in data['backtestData']:
            # Case 1: amountFixed 없이 amount만 있는 경우
            if 'amount' in item and 'amountFixed' not in item:
                issues.append({
                    'file': file,
                    'date': item['date'],
                    'issue': 'no_fixed_amount',
                    'amount': item['amount']
                })

            # Case 2: 둘 다 있지만 차이가 큰 경우
            if 'amount' in item and 'amountFixed' in item:
                if abs(item['amount'] - item['amountFixed']) > 0.01:
                    issues.append({
                        'file': file,
                        'date': item['date'],
                        'issue': 'mismatch',
                        'amount': item['amount'],
                        'fixed': item['amountFixed']
                    })

    return issues
```

### 스크립트 2: 실제 마이그레이션

```python
def migrate_dividend_structure():
    """배당 구조 마이그레이션"""

    for file in all_json_files:
        data = load_json(file)
        modified = False

        for item in data['backtestData']:
            # dividend 필드로 통일
            if 'amountFixed' in item:
                item['dividend'] = item['amountFixed']
                del item['amountFixed']
                modified = True
            elif 'amount' in item:
                # amountFixed 없으면 amount 사용 (나중에 검증)
                item['dividend'] = item['amount']
                item['needsVerification'] = True
                modified = True

            # amount, amountOriginal 제거
            if 'amount' in item:
                del item['amount']
                modified = True

            if 'amountOriginal' in item:
                del item['amountOriginal']
                modified = True

        if modified:
            save_json(file, data)
```

---

## ✅ 장점 요약

### 1. 데이터 정합성 향상
- **단일 진실 공급원**: `dividend`만 신뢰
- **Yahoo Finance 오류 제거**: 더 이상 YF의 split 조정 의존 안 함
- **검증 용이**: 실제 받은 금액과 기록 일치 여부만 확인

### 2. 유지보수 간소화
- **필드 3개 → 1개**: `amount`, `amountFixed`, `amountOriginal` → `dividend`
- **백업 불필요**: split 이력이 있으므로 언제든 재계산 가능
- **마이그레이션 간단**: 필드명 변경 수준

### 3. 성능 향상
- **데이터 크기 감소**: 불필요한 필드 제거
- **로딩 속도 향상**: 단순한 구조
- **계산 효율**: 필요할 때만 조정값 계산

### 4. 확장성
- **다중 split 대응**: split 이력만 관리하면 모든 구간 계산 가능
- **시점별 비교**: 특정 시점 기준으로 언제든 재계산
- **백테스트 정확도**: 실제 받은 금액 기준으로 계산

---

## ⚠️ 고려사항

### 1. 기존 시스템과의 호환성

**문제**: 기존에 `amount` 또는 `amountFixed`를 사용하는 코드

**해결**:
```javascript
// 호환성 레이어
function getDividend(item) {
  return item.dividend || item.amountFixed || item.amount || 0;
}
```

### 2. 데이터 유실 방지

**문제**: `amount`를 삭제하면 YF 데이터 복구 불가

**해결**:
- 마이그레이션 전 전체 백업
- `amount`와 `dividend` 차이가 큰 경우 별도 보관
- 또는 `yfAmount` 필드로 rename하여 참고용으로 보관

### 3. 과거 데이터 검증

**문제**: `amountFixed` 없이 `amount`만 있는 데이터 (2,629건)

**해결**:
- Level 1 오류 먼저 수정 (471건)
- 나머지는 `needsVerification: true` 플래그 추가
- 수동 검증 또는 실제 배당 수령 시 업데이트

---

## 🚀 실행 계획

### Step 1: 영향도 분석
```bash
python scripts/data_pipeline/analyze_dividend_migration_impact.py
```

### Step 2: 백업
```bash
# 전체 데이터 백업
cp -r public/data backups/before_dividend_migration_$(date +%Y%m%d)
```

### Step 3: 마이그레이션 (Dry-run)
```bash
python scripts/data_pipeline/migrate_dividend_structure.py --dry-run
```

### Step 4: 실제 마이그레이션
```bash
python scripts/data_pipeline/migrate_dividend_structure.py
```

### Step 5: 프론트엔드 업데이트
- `amount` → `dividend` 필드명 변경
- Split 조정 계산 로직 추가
- 백테스트 로직 검증

---

## 💭 결론

제안하신 방식이 **매우 좋은 접근**입니다:

1. ✅ **단순성**: 실제 받은 금액만 저장
2. ✅ **정확성**: Yahoo Finance 오류에서 자유로움
3. ✅ **유지보수성**: 불필요한 필드 제거
4. ✅ **확장성**: Split 이력만으로 모든 계산 가능

**추천**:
- `dividend` 필드로 통일 (현재 `amountFixed`)
- `amount`, `amountOriginal` 제거
- Split 조정은 클라이언트에서 계산

이 구조로 변경하시겠습니까? 마이그레이션 스크립트를 작성해드릴까요?
