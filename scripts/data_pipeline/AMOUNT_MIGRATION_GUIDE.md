# Amount 필드 마이그레이션 가이드

## 📋 개요

배당 데이터의 `amount` 필드를 단순 숫자에서 split 구간별 객체로 변경합니다.
**`amountFixed`는 그대로 유지**되어 기존 로직과 100% 호환됩니다.

---

## 🎯 변경 내용

### Before (현재)
```json
{
  "date": "2025-11-26",
  "amount": 0.59,           // 단순 숫자 (최신 split 기준)
  "amountFixed": 0.0594     // 실제 받은 금액
}
```

### After (마이그레이션 후)
```json
{
  "date": "2025-11-26",
  "amount": {
    "2025-12-01": 0.59      // Split 날짜별 객체
  },
  "amountFixed": 0.0594     // ✅ 그대로 유지
}
```

### Split 이후 배당
```json
{
  "date": "2025-12-03",
  "amount": {
    "current": 0.588        // 최신 값
  },
  "amountFixed": 0.5881
}
```

---

## 📊 영향도 분석 결과

```
총 파일:           3,513개
배당 데이터 보유:   2,790개
  - amount 보유:    2,790개 ← 마이그레이션 대상
  - amountFixed:    160개 ← 유지
Split 이력 보유:    911개

마이그레이션 항목:  132,581개
```

### 마켓별 분포
- NYSE: 1,610개
- KOSDAQ: 904개
- NASDAQ: 246개
- KOSPI: 25개
- BATS: 5개

### Split 횟수별 분포
- 1번 split: 418개
- 2번 split: 144개
- 3번 이상: 349개
- 최대: 26번 split (ADM)

---

## 🚀 실행 방법

### 1단계: 영향도 분석

```bash
python scripts/data_pipeline/analyze_amount_migration.py
```

**결과**:
- 콘솔에 통계 출력
- `amount_migration_analysis.json` 생성

---

### 2단계: 테스트 마이그레이션

#### 특정 종목으로 테스트 (권장)
```bash
# ULTY 하나만 dry-run
python scripts/data_pipeline/migrate_amount_structure.py --symbols ULTY --dry-run

# 실제 마이그레이션
python scripts/data_pipeline/migrate_amount_structure.py --symbols ULTY
```

#### 결과 확인
```bash
# 마이그레이션 전
cat public/data/nyse/ulty.json | grep -A 2 '"amount"'

# 백업에서 비교
cat backups/amount_migration/20251223_*/ulty.json | grep -A 2 '"amount"'
```

---

### 3단계: 검증

```bash
python scripts/data_pipeline/verify_amount_migration.py
```

**검증 항목**:
- ✓ amount가 객체인지
- ✓ split 날짜 참조가 유효한지
- ✓ amountFixed와 current가 일치하는지
- ✓ 빈 객체가 없는지

---

### 4단계: 전체 마이그레이션

#### 특정 마켓만 (권장)
```bash
# 작은 마켓부터 시작
python scripts/data_pipeline/migrate_amount_structure.py --market BATS
python scripts/data_pipeline/migrate_amount_structure.py --market KOSPI
python scripts/data_pipeline/migrate_amount_structure.py --market KOSDAQ
python scripts/data_pipeline/migrate_amount_structure.py --market NASDAQ
python scripts/data_pipeline/migrate_amount_structure.py --market NYSE
```

#### 전체 한번에
```bash
# Dry-run으로 먼저 확인
python scripts/data_pipeline/migrate_amount_structure.py --dry-run

# 실제 마이그레이션
python scripts/data_pipeline/migrate_amount_structure.py
```

---

### 5단계: 최종 검증

```bash
# 전체 검증
python scripts/data_pipeline/verify_amount_migration.py

# 이슈가 없으면 exit code 0
# 이슈가 있으면 exit code 1
```

---

## 📐 옵션 설명

### `--dry-run`
실제로 파일을 수정하지 않고 시뮬레이션만 합니다.

```bash
python scripts/data_pipeline/migrate_amount_structure.py --dry-run
```

### `--symbols`
특정 심볼만 처리합니다. 쉼표로 구분합니다.

```bash
python scripts/data_pipeline/migrate_amount_structure.py --symbols ULTY,AAPL,TSLA
```

### `--market`
특정 마켓만 처리합니다.

```bash
python scripts/data_pipeline/migrate_amount_structure.py --market NYSE
```

### `--include-historical`
과거 모든 split 기준값을 계산합니다 (`amountOriginal` 사용).

```bash
python scripts/data_pipeline/migrate_amount_structure.py --include-historical
```

**주의**: 데이터 크기가 증가할 수 있습니다.

---

## 💾 백업

### 자동 백업
마이그레이션 실행 시 자동으로 백업됩니다:

```
backups/amount_migration/
└── 20251223_110304/
    └── ulty.json
```

### 수동 백업 (전체)
```bash
# 전체 데이터 백업
cp -r public/data backups/before_amount_migration_$(date +%Y%m%d)

# Windows
xcopy public\data backups\before_amount_migration_%date:~0,8% /E /I
```

---

## 🔄 복원 방법

### 특정 파일 복원
```bash
# 백업 파일 찾기
ls backups/amount_migration/20251223_*/ulty.json

# 복원
cp backups/amount_migration/20251223_110304/ulty.json public/data/nyse/ulty.json

# Windows
copy backups\amount_migration\20251223_110304\ulty.json public\data\nyse\ulty.json
```

### 전체 복원
```bash
# 전체 백업에서 복원
cp -r backups/before_amount_migration_20251223/data/* public/data/

# Windows
xcopy backups\before_amount_migration_20251223\data\* public\data\ /E /Y
```

---

## 💻 클라이언트 코드 업데이트

### 호환성 레이어 (마이그레이션 전/후 모두 대응)

```javascript
/**
 * amount 필드에서 값 추출 (마이그레이션 전/후 모두 대응)
 */
function getAmount(item, mode = 'latest') {
  if (!item.amount) return null;

  // 마이그레이션 전 (숫자)
  if (typeof item.amount === 'number') {
    return item.amount;
  }

  // 마이그레이션 후 (객체)
  if (mode === 'latest' || mode === 'current') {
    // current가 있으면 반환
    if (item.amount.current !== undefined) {
      return item.amount.current;
    }

    // 가장 최근 split 기준값 반환
    const splitDates = Object.keys(item.amount).sort().reverse();
    return item.amount[splitDates[0]];
  }

  if (mode === 'original') {
    // 실제 받은 금액
    return item.amountFixed || getAmount(item, 'latest');
  }

  return null;
}
```

### 차트 표시용 데이터 준비

```javascript
/**
 * 배당 차트 데이터 준비
 */
function prepareDividendChartData(data, displayMode = 'latest') {
  const splits = data.tickerInfo.events.splits || [];
  const backtest = data.backtestData;

  return backtest
    .filter(item => item.amount)
    .map(item => {
      let displayAmount;

      switch (displayMode) {
        case 'latest':
          // 최신 split 기준
          displayAmount = getAmount(item, 'latest');
          break;

        case 'original':
          // 실제 받은 금액
          displayAmount = item.amountFixed;
          break;

        case 'asOf':
          // 특정 시점 기준 (split 날짜를 지정)
          displayAmount = getAmountAsOf(item, displayMode.date, splits);
          break;
      }

      return {
        date: item.date,
        amount: displayAmount,
        originalAmount: item.amountFixed,
        hasSplit: typeof item.amount === 'object' && !item.amount.current
      };
    });
}

/**
 * 특정 시점 기준 배당 금액 계산
 */
function getAmountAsOf(item, asOfDate, splits) {
  if (!item.amount) return null;

  // 숫자형이면 그대로 반환
  if (typeof item.amount === 'number') {
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
  return item.amount[splitDate] || item.amount.current || item.amountFixed;
}
```

### 백테스트 계산

```javascript
/**
 * 수익률 계산 (최신 split 기준)
 */
function calculateReturns(holdings, stockData) {
  let totalDividends = 0;

  stockData.backtestData.forEach(item => {
    if (item.amount) {
      const dividendPerShare = getAmount(item, 'latest');
      totalDividends += dividendPerShare * holdings.shares;
    }
  });

  return totalDividends;
}
```

---

## ⚠️ 주의사항

### 1. 점진적 마이그레이션 권장
```bash
# ✅ 좋은 방법: 마켓별로 단계적 진행
python migrate_amount_structure.py --market BATS
# 검증 후 다음 진행
python migrate_amount_structure.py --market KOSPI
# ...

# ❌ 피할 방법: 한번에 전체
python migrate_amount_structure.py  # 위험
```

### 2. 백업 확인 필수
```bash
# 마이그레이션 전 반드시 확인
ls -lh backups/

# 충분한 디스크 공간 확인
df -h
```

### 3. 클라이언트 로직 테스트
마이그레이션 후 반드시:
- 차트 표시 확인
- 백테스트 계산 확인
- 배당 금액 표시 확인

### 4. amountFixed 우선
항상 `amountFixed`를 우선적으로 사용하세요:
```javascript
const actualDividend = item.amountFixed || getAmount(item);
```

---

## 🐛 문제 해결

### Q1. 마이그레이션 후 amount가 여전히 숫자

**원인**: 해당 파일이 마이그레이션되지 않음

**해결**:
```bash
# 특정 심볼 다시 마이그레이션
python migrate_amount_structure.py --symbols SYMBOL
```

### Q2. split 날짜가 존재하지 않는다는 오류

**원인**: split 데이터가 잘못되었거나 누락됨

**해결**:
```bash
# 검증 스크립트로 확인
python verify_amount_migration.py

# 리포트에서 invalid_split_ref 확인
cat scripts/data_pipeline/amount_verification_report.json
```

### Q3. amountFixed와 current가 다름

**원인**: Level 1 오류 (이전에 발견된 오류)

**해결**:
```bash
# Level 1 오류 먼저 수정
python fix_dividend_errors.py --level1

# 그 후 마이그레이션
python migrate_amount_structure.py
```

### Q4. 백업에서 복원 후에도 문제

**원인**: 전체 백업이 아닌 부분 백업만 존재

**해결**:
```bash
# Git으로 복원
git checkout public/data/

# 또는 전체 백업에서 복원
cp -r backups/before_amount_migration_20251223/* public/
```

---

## 📈 권장 실행 순서

### 프로덕션 환경

```bash
# 1. 전체 백업
cp -r public/data backups/before_migration_$(date +%Y%m%d)

# 2. Level 1 오류 먼저 수정 (471건)
python fix_dividend_errors.py --level1

# 3. 영향도 분석
python analyze_amount_migration.py

# 4. 작은 마켓부터 시작
python migrate_amount_structure.py --market BATS --dry-run
python migrate_amount_structure.py --market BATS

# 5. 검증
python verify_amount_migration.py

# 6. 클라이언트 테스트
# ... 프론트엔드에서 확인

# 7. 다음 마켓 진행
python migrate_amount_structure.py --market KOSPI
# ...

# 8. 최종 검증
python verify_amount_migration.py
```

### 개발/테스트 환경

```bash
# 1. 샘플 테스트
python migrate_amount_structure.py --symbols ULTY,AAPL,MSFT --dry-run
python migrate_amount_structure.py --symbols ULTY,AAPL,MSFT

# 2. 검증
python verify_amount_migration.py

# 3. 전체 마이그레이션
python migrate_amount_structure.py

# 4. 최종 검증
python verify_amount_migration.py
```

---

## 📝 체크리스트

마이그레이션 전:
- [ ] 전체 데이터 백업 완료
- [ ] Level 1 오류 수정 완료
- [ ] 영향도 분석 완료
- [ ] 샘플 테스트 완료

마이그레이션 중:
- [ ] Dry-run으로 시뮬레이션
- [ ] 작은 마켓부터 단계적 진행
- [ ] 각 단계마다 검증

마이그레이션 후:
- [ ] 검증 스크립트 실행
- [ ] 클라이언트 로직 테스트
- [ ] 차트 표시 확인
- [ ] 백테스트 계산 확인
- [ ] Git commit

---

## 📞 참고 자료

- **설계 문서**: [DIVIDEND_AMOUNT_RESTRUCTURE.md](DIVIDEND_AMOUNT_RESTRUCTURE.md)
- **오류 분석**: [DIVIDEND_ERROR_SUMMARY.md](DIVIDEND_ERROR_SUMMARY.md)
- **검증 리포트**: `amount_verification_report.json`
- **마이그레이션 리포트**: `amount_migration_report.json`

---

**작성일**: 2025-12-23
**버전**: 1.0
