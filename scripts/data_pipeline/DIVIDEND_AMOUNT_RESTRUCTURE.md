# 배당 Amount 필드 재구조화 제안

## 🎯 목표

**`amountFixed`는 유지**, `amount` 필드만 split 구간별 객체 구조로 변경하여 데이터 정합성 향상

---

## 📋 현재 구조

```json
{
  "backtestData": [
    {
      "date": "2025-11-26",
      "close": 5.94,
      "amount": 0.59,           // ❌ YF가 최신 split 기준으로 조정한 값 (오류 많음)
      "amountFixed": 0.0594     // ✅ 실제 받은 배당 (변경 없음, 유지)
    },
    {
      "date": "2025-12-03",
      "close": 5.88,
      "amount": 0.588,
      "amountFixed": 0.5881
    }
  ]
}
```

### 문제점
- `amount`는 Yahoo Finance가 최신 split 기준으로 조정한 값
- Split 발생 시 과거의 모든 `amount` 값이 자동으로 변경됨
- 특정 시점의 split 기준값을 알 수 없음
- 데이터 오류 발생 시 추적 어려움

---

## 💡 제안하는 새로운 구조

### Split 구간별 객체 구조

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
      "amountFixed": 0.0594,    // ✅ 실제 받은 배당 (그대로 유지)
      "amount": {
        "2025-12-01": 0.59      // 2025-12-01 split 기준 조정값
      }
    },
    {
      "date": "2025-12-03",
      "close": 5.88,
      "amountFixed": 0.5881,
      "amount": {
        "current": 0.5881       // split 이후 배당은 current만
      }
    }
  ]
}
```

---

## 🔍 상세 구조 설명

### Case 1: Split이 없는 종목

```json
{
  "date": "2025-11-26",
  "amountFixed": 0.0594,
  "amount": {
    "current": 0.0594    // Split 없으면 amountFixed와 동일
  }
}
```

### Case 2: 1번의 Split이 있는 종목 (ULTY)

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
    // Split 이전 배당
    {
      "date": "2025-11-26",
      "amountFixed": 0.0594,
      "amount": {
        "2025-12-01": 0.59   // 2025-12-01 split 기준 조정값
      }
    },
    // Split 이후 배당
    {
      "date": "2025-12-03",
      "amountFixed": 0.5881,
      "amount": {
        "current": 0.5881    // 최신이므로 current
      }
    }
  ]
}
```

### Case 3: 여러 번의 Split이 있는 종목 (AAPL)

```json
{
  "tickerInfo": {
    "events": {
      "splits": [
        {
          "date": "2014-06-09",
          "ratio": "7:1",
          "type": "split"
        },
        {
          "date": "2020-08-31",
          "ratio": "4:1",
          "type": "split"
        }
      ]
    }
  },
  "backtestData": [
    // 2014년 split 이전 배당
    {
      "date": "2012-11-07",
      "amountFixed": null,       // 과거 데이터라 실제 수령액 없을 수 있음
      "amount": {
        "2014-06-09": 0.44,      // 2014 split 기준
        "2020-08-31": 0.1571     // 2020 split 기준 (최신)
      }
    },
    // 2014-2020 사이 배당
    {
      "date": "2019-11-07",
      "amountFixed": null,
      "amount": {
        "2020-08-31": 0.1925     // 2020 split 기준
      }
    },
    // 2020 split 이후 배당
    {
      "date": "2024-11-08",
      "amountFixed": 0.25,
      "amount": {
        "current": 0.25          // 최신
      }
    }
  ]
}
```

---

## 📐 필드 구조 정의

### `amount` 객체 필드

```typescript
type AmountObject = {
  // 각 split 날짜를 키로 하는 조정값
  [splitDate: string]: number;  // YYYY-MM-DD 형식

  // 또는 최신 값 (split 이후 또는 split 없음)
  current?: number;
}
```

### 규칙

1. **Split 이전 배당**: 각 split 날짜를 키로 조정값 저장
2. **Split 이후 배당**: `current` 키만 사용
3. **Split 없는 종목**: `current` 키만 사용
4. **최신 split 기준값**: 가장 최근 split 날짜의 키 또는 `current`

---

## 🔄 마이그레이션 전략

### Phase 1: 데이터 구조 변환

```python
def migrate_amount_to_object(data):
    """
    amount 필드를 단순 값에서 객체로 변환
    """
    splits = data['tickerInfo']['events'].get('splits', [])
    backtest_data = data['backtestData']

    # Split 날짜들을 정렬
    split_dates = sorted([s['date'] for s in splits])
    latest_split = split_dates[-1] if split_dates else None

    for item in backtest_data:
        if 'amount' not in item:
            continue

        current_amount = item['amount']
        item_date = item['date']

        # Split 이후 배당
        if not latest_split or item_date >= latest_split:
            item['amount'] = {
                'current': current_amount
            }
        # Split 이전 배당
        else:
            # 해당 날짜 이후의 모든 split 기준값 저장
            amount_obj = {}
            for split_date in split_dates:
                if split_date > item_date:
                    # 이미 조정된 값 (현재 amount는 최신 split 기준)
                    amount_obj[split_date] = current_amount
                    break  # 가장 가까운 다음 split만

            item['amount'] = amount_obj

    return data
```

### Phase 2: 과거 split 기준값 복원 (선택적)

```python
def restore_historical_split_values(data):
    """
    amountOriginal과 split 비율을 사용하여 과거 split 기준값 계산
    """
    splits = data['tickerInfo']['events'].get('splits', [])
    backtest_data = data['backtestData']

    for item in backtest_data:
        if 'amount' not in item or not isinstance(item['amount'], dict):
            continue

        amount_original = item.get('amountOriginal')
        if not amount_original:
            continue

        item_date = item['date']

        # 각 split 기준으로 계산
        for split in splits:
            if split['date'] > item_date:
                ratio = parse_split_ratio(split['ratio'])
                calculated_value = amount_original * ratio
                item['amount'][split['date']] = calculated_value
```

---

## 💻 클라이언트 사용 예시

### 1. 최신 split 기준값 가져오기

```javascript
function getLatestAmount(item, splits) {
  if (!item.amount) return null;

  // 객체가 아니면 (마이그레이션 전)
  if (typeof item.amount === 'number') {
    return item.amount;
  }

  // current가 있으면 반환
  if (item.amount.current !== undefined) {
    return item.amount.current;
  }

  // 가장 최근 split 기준값 반환
  const splitDates = Object.keys(item.amount).sort().reverse();
  return item.amount[splitDates[0]];
}
```

### 2. 특정 시점 기준값 가져오기

```javascript
function getAmountAsOf(item, asOfDate, splits) {
  if (!item.amount || typeof item.amount === 'number') {
    return item.amount;
  }

  // asOfDate 이전의 가장 최근 split 찾기
  const applicableSplits = splits
    .filter(s => s.date <= asOfDate && s.date > item.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (applicableSplits.length === 0) {
    // Split 없으면 amountFixed 반환
    return item.amountFixed;
  }

  const splitDate = applicableSplits[0].date;
  return item.amount[splitDate] || item.amount.current;
}
```

### 3. 차트 표시용 데이터 준비

```javascript
function prepareDividendChartData(data, displayMode = 'latest') {
  const splits = data.tickerInfo.events.splits || [];
  const backtest = data.backtestData;

  return backtest
    .filter(item => item.amount)
    .map(item => {
      let displayAmount;

      if (displayMode === 'latest') {
        // 최신 split 기준
        displayAmount = getLatestAmount(item, splits);
      } else if (displayMode === 'original') {
        // 실제 받은 금액
        displayAmount = item.amountFixed;
      } else if (displayMode === 'asOf') {
        // 특정 시점 기준
        displayAmount = getAmountAsOf(item, displayMode.date, splits);
      }

      return {
        date: item.date,
        amount: displayAmount,
        originalAmount: item.amountFixed,
        hasSplitAdjustment: typeof item.amount === 'object'
          && !item.amount.current
      };
    });
}
```

---

## 📊 마이그레이션 스크립트

### 스크립트 1: 영향도 분석

```python
#!/usr/bin/env python3
# scripts/data_pipeline/analyze_amount_migration.py

import json
import glob
from pathlib import Path

def analyze_migration_impact():
    """마이그레이션 영향도 분석"""

    stats = {
        'total_files': 0,
        'files_with_dividends': 0,
        'files_with_splits': 0,
        'items_to_migrate': 0,
        'splits_distribution': {}  # split 횟수별 파일 수
    }

    files = glob.glob('public/data/**/*.json', recursive=True)

    for file_path in files:
        stats['total_files'] += 1

        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        splits = data.get('tickerInfo', {}).get('events', {}).get('splits', [])
        backtest = data.get('backtestData', [])

        div_items = [x for x in backtest if 'amount' in x]

        if div_items:
            stats['files_with_dividends'] += 1
            stats['items_to_migrate'] += len(div_items)

        if splits:
            stats['files_with_splits'] += 1
            split_count = len(splits)
            stats['splits_distribution'][split_count] = \
                stats['splits_distribution'].get(split_count, 0) + 1

    print("=== Amount 필드 마이그레이션 영향도 분석 ===\n")
    print(f"총 파일 수: {stats['total_files']:,}")
    print(f"배당 데이터 보유: {stats['files_with_dividends']:,}")
    print(f"Split 이력 보유: {stats['files_with_splits']:,}")
    print(f"마이그레이션 대상 항목: {stats['items_to_migrate']:,}개\n")

    print("Split 횟수별 분포:")
    for count in sorted(stats['splits_distribution'].keys()):
        files = stats['splits_distribution'][count]
        print(f"  {count}번 split: {files:,}개 파일")

    return stats

if __name__ == '__main__':
    analyze_migration_impact()
```

### 스크립트 2: 실제 마이그레이션

```python
#!/usr/bin/env python3
# scripts/data_pipeline/migrate_amount_structure.py

import json
import glob
import shutil
from pathlib import Path
from datetime import datetime
import argparse

def parse_split_ratio(ratio_str):
    """Split 비율 파싱"""
    try:
        if ':' in ratio_str:
            parts = ratio_str.split(':')
            numerator = float(parts[0])
            denominator = float(parts[1])
            return numerator / denominator
        return float(ratio_str)
    except:
        return 1.0

def migrate_amount_field(data, include_historical=False):
    """
    amount 필드를 객체 구조로 변환

    Args:
        data: JSON 데이터
        include_historical: True면 과거 split 기준값도 계산
    """
    splits = data.get('tickerInfo', {}).get('events', {}).get('splits', [])
    backtest_data = data.get('backtestData', [])

    if not splits:
        # Split 없으면 current만
        for item in backtest_data:
            if 'amount' in item and isinstance(item['amount'], (int, float)):
                item['amount'] = {'current': item['amount']}
        return data

    # Split 날짜 정렬
    split_dates = sorted([s['date'] for s in splits])
    latest_split = split_dates[-1]

    for item in backtest_data:
        if 'amount' not in item:
            continue

        current_amount = item['amount']
        if not isinstance(current_amount, (int, float)):
            continue  # 이미 마이그레이션됨

        item_date = item['date']

        # Split 이후 배당
        if item_date >= latest_split:
            item['amount'] = {'current': current_amount}
            continue

        # Split 이전 배당
        amount_obj = {}

        # 가장 가까운 다음 split 기준값
        for split_date in split_dates:
            if split_date > item_date:
                amount_obj[split_date] = current_amount
                break

        # 과거 split 기준값도 포함 (선택적)
        if include_historical and 'amountOriginal' in item:
            amount_original = item['amountOriginal']
            cumulative_ratio = 1.0

            for split in reversed(splits):
                if split['date'] > item_date:
                    ratio = parse_split_ratio(split['ratio'])
                    cumulative_ratio *= ratio
                    calculated = amount_original * cumulative_ratio
                    amount_obj[split['date']] = round(calculated, 4)

        item['amount'] = amount_obj

    return data

def main():
    parser = argparse.ArgumentParser(description='Amount 필드 구조 마이그레이션')
    parser.add_argument('--dry-run', action='store_true',
                        help='실제 수정하지 않고 시뮬레이션')
    parser.add_argument('--include-historical', action='store_true',
                        help='과거 split 기준값도 계산')
    parser.add_argument('--symbols', type=str,
                        help='특정 심볼만 처리 (쉼표 구분)')

    args = parser.parse_args()

    # 백업 디렉토리 생성
    if not args.dry_run:
        backup_dir = Path('backups') / f'amount_migration_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
        backup_dir.mkdir(parents=True, exist_ok=True)
        print(f"백업 디렉토리: {backup_dir}\n")

    # 대상 파일 수집
    files = glob.glob('public/data/**/*.json', recursive=True)

    if args.symbols:
        target_symbols = set(s.strip().upper() for s in args.symbols.split(','))
        files = [f for f in files if any(sym.lower() in f.lower() for sym in target_symbols)]

    print(f"{'[DRY-RUN] ' if args.dry_run else ''}마이그레이션 시작: {len(files)}개 파일\n")

    migrated_count = 0
    error_count = 0

    for file_path in files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # 배당 데이터 확인
            has_dividends = any('amount' in item for item in data.get('backtestData', []))
            if not has_dividends:
                continue

            # 백업
            if not args.dry_run:
                shutil.copy2(file_path, backup_dir / Path(file_path).name)

            # 마이그레이션
            migrated_data = migrate_amount_field(data, args.include_historical)

            # 저장
            if not args.dry_run:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(migrated_data, f, indent=4, ensure_ascii=False)

            symbol = data.get('tickerInfo', {}).get('Symbol', 'unknown')
            splits_count = len(data.get('tickerInfo', {}).get('events', {}).get('splits', []))
            print(f"✓ {symbol} (splits: {splits_count})")

            migrated_count += 1

        except Exception as e:
            print(f"✗ {file_path}: {e}")
            error_count += 1

    print(f"\n{'[DRY-RUN] ' if args.dry_run else ''}완료:")
    print(f"  성공: {migrated_count}개")
    print(f"  실패: {error_count}개")

    if not args.dry_run:
        print(f"\n백업 위치: {backup_dir}")

if __name__ == '__main__':
    main()
```

---

## ✅ 장점

1. **`amountFixed` 유지**
   - 기존 로직 100% 호환
   - 프론트엔드 수정 최소화
   - 안전한 마이그레이션

2. **Split 구간별 추적**
   - 각 split 시점 기준값 보관
   - 과거 시점 기준 계산 가능
   - 데이터 정합성 검증 용이

3. **유연한 표시**
   - 최신 기준 / 실제 받은 금액 / 특정 시점 기준 선택 가능
   - 차트에서 다양한 관점 제공

4. **점진적 마이그레이션**
   - 기존 숫자형 `amount`와 호환 가능
   - 단계적으로 적용 가능

---

## ⚠️ 주의사항

1. **타입 체크 필요**
```javascript
// 마이그레이션 전/후 모두 대응
function getAmount(item) {
  if (typeof item.amount === 'number') {
    return item.amount;  // 구 버전
  }
  return item.amount?.current || Object.values(item.amount)[0];  // 신 버전
}
```

2. **메모리 사용량**
   - Split 많은 종목은 `amount` 객체 크기 증가
   - 실제로는 최신 split만 저장하면 충분

3. **백업 필수**
   - 마이그레이션 전 전체 백업
   - 테스트 환경에서 먼저 검증

---

## 🚀 실행 순서

### 1단계: 영향도 분석
```bash
python scripts/data_pipeline/analyze_amount_migration.py
```

### 2단계: 샘플 테스트
```bash
# ULTY 하나만 테스트
python scripts/data_pipeline/migrate_amount_structure.py --symbols ULTY --dry-run
```

### 3단계: Dry-run 전체 테스트
```bash
python scripts/data_pipeline/migrate_amount_structure.py --dry-run
```

### 4단계: 실제 마이그레이션
```bash
# 백업 자동 생성됨
python scripts/data_pipeline/migrate_amount_structure.py
```

### 5단계: 검증
```bash
# 몇 개 샘플 파일 수동 확인
cat public/data/nyse/ulty.json | grep -A 3 "amount"
```

---

이 구조로 진행하시겠습니까? 마이그레이션 스크립트를 완성해드릴까요?
