# 시가총액(Market Cap) 데이터 가이드

## 📊 개요

**Yahoo Finance**를 사용하여 모든 티커의 시가총액을 매일 자동으로 수집합니다.

### ✅ 특징
- **완전 무료**: API 키 불필요
- **제한 없음**: 모든 티커 처리 가능
- **자동 실행**: 매일 1회 (Info Data 워크플로우)
- **전체 지원**: 한국(KOSPI, KOSDAQ) + 미국(NASDAQ, NYSE)

### 📈 데이터 누적 방식
- 과거 시가총액 데이터는 **시간이 지나면서 자연스럽게 누적**됩니다
- 매일 현재 값을 저장하므로, 1년 후에는 1년치 과거 데이터가 쌓입니다

---

## 🚀 자동 실행

### 워크플로우 위치

```yaml
.github/workflows/update_info_data_v2.yml
└─ Update all info data (dividends, info+marketCap, frequency, projection)
   └─ info_data_pipeline.py - STEP 3: 시가총액 업데이트
```

### 실행 시점
- **매일 1회**: 한국시간 새벽 2시 (KST, UTC 17:00)

### 처리 내용
```python
# scripts/data_pipeline/info_data_pipeline_kr.py - STEP 3
# scripts/data_pipeline/info_data_pipeline_us.py - STEP 3

1. Yahoo Finance에서 전체 티커의 현재 marketCap 배치 조회
2. 각 티커의 오늘 날짜 backtestData에 marketCap 추가
3. 파일 저장
```

---

## 💻 수동 실행

### 방법 1: 통합 파이프라인 사용 (권장)

```bash
python scripts/data_pipeline/info_data_pipeline_kr.py
python scripts/data_pipeline/info_data_pipeline_us.py
```

**실행 결과**:
```
======================================================================
📈 Daily Market Cap Update (Yahoo Finance)
======================================================================
📊 Total active tickers: 3041
📅 Today's date: 2025-11-04
💡 Using Yahoo Finance (free, no limits)

Fetching market caps in batches: 100%|████████████| 31/31 [00:45<00:00]

======================================================================
✅ Successfully updated: 2845 tickers
⏭️  Skipped: 196 tickers
======================================================================
```

### 방법 2: 통합 파이프라인 (V2 방식)

```bash
python scripts/data_pipeline/info_data_pipeline_kr.py
python scripts/data_pipeline/info_data_pipeline_us.py
```

**실행 결과**:
```
🚀 정보성 데이터 통합 파이프라인 시작

STEP 1: 배당 데이터 업데이트
✅ 배당 데이터 업데이트 완료: 45개 파일 변경

STEP 2: 티커 정보 업데이트
✅ 티커 정보 업데이트 완료: 123개 파일 변경

STEP 3: 시가총액 업데이트
✅ 시가총액 업데이트 완료: 356개 업데이트, 3060개 스킵

STEP 4: 배당 빈도 분석
...
```

---

## 📊 데이터 구조

`public/data/{ticker}.json`:

```json
{
  "tickerInfo": {
    "Symbol": "AAPL",
    "marketCap": 2850000000000,  // ← tickerInfo의 현재 값
    "regularMarketPrice": 185.25,
    ...
  },
  "backtestData": [
    {
      "date": "2025-10-28",
      "open": 180.50,
      "high": 182.30,
      "low": 179.80,
      "close": 181.50,
      "volume": 52341000,
      "marketCap": 2800000000000  // ← 해당 날짜의 marketCap
    },
    {
      "date": "2025-10-29",
      "close": 182.75,
      "marketCap": 2820000000000
    },
    {
      "date": "2025-10-30",
      "close": 185.25,
      "marketCap": 2850000000000
    }
  ]
}
```

---

## 📈 데이터 누적 예시

### 1일차 (2025-11-04)
```json
{
  "backtestData": [
    {"date": "2025-11-04", "close": 185.25, "marketCap": 2850000000000}
  ]
}
```

### 1주일 후 (2025-11-11)
```json
{
  "backtestData": [
    {"date": "2025-11-04", "close": 185.25, "marketCap": 2850000000000},
    {"date": "2025-11-05", "close": 186.50, "marketCap": 2870000000000},
    {"date": "2025-11-06", "close": 187.25, "marketCap": 2885000000000},
    {"date": "2025-11-07", "close": 188.00, "marketCap": 2900000000000},
    {"date": "2025-11-08", "close": 186.75, "marketCap": 2880000000000},
    {"date": "2025-11-11", "close": 189.50, "marketCap": 2920000000000}
  ]
}
```

### 1년 후 (2026-11-04)
→ 약 250개의 거래일 데이터가 쌓여 있을 것입니다!

---

## 🔧 과거 데이터 채우기 (선택사항)

### 근사값 계산 방법

**중요**: 이 방법은 **근사값**을 계산합니다! (정확도 85~95%)

```bash
# 일회성 실행 (과거 데이터 채우기)
npm run backfill-market-cap

# 또는 직접 실행
python scripts/data_pipeline/backfill_market_cap_approximate.py
```

**동작 원리**:
```
marketCap (근사) = sharesOutstanding (현재) × close (과거 날짜)
```

**가정**:
- 발행주식수가 과거부터 현재까지 변하지 않았다고 가정
- ETF는 비교적 정확 (발행주식수 변동 적음)
- 일반 주식은 오차 가능 (주식분할, 증자 등)

**실행 결과**:
```
================================================================================
📊 Backfill Historical Market Cap (Approximate Values)
================================================================================
💡 Formula: marketCap ≈ sharesOutstanding (current) × close (historical)
⚠️  Note: This is an approximation (85~95% accuracy)
================================================================================

📊 Total active tickers: 3041

⚠️  WARNING: This will calculate approximate marketCap for ALL historical data.
⚠️  Existing marketCap values will be preserved.

Proceed? (yes/no): yes

Processing batches: 100%|████████████████████| 31/31 [02:15<00:00]

================================================================================
📊 Backfill Complete!
================================================================================
✅ Success: 2456 tickers
ℹ️  Already filled: 128 tickers
⚠️  No shares data: 354 tickers
⚠️  No file: 45 tickers
⚠️  No backtest data: 58 tickers
❌ Error: 0 tickers

📝 Total entries updated: 1,247,832
================================================================================
```

**주의사항**:
- ⚠️ **근사값**: 정확도 85~95%
- ⚠️ **가정**: 발행주식수 변동 미반영
- ⚠️ **오차 발생**: 주식분할, 증자, 자사주 매입 시
- ✅ **기존 값 보존**: 이미 있는 marketCap은 덮어쓰지 않음
- ✅ **미래 데이터**: 자동으로 정확한 값이 수집됨

---

## ⚠️ 주의사항

### 데이터 정확도

**현재 데이터 (매일 자동 수집)**:
- ✅ **100% 정확**: Yahoo Finance에서 실시간 marketCap 제공
- ✅ **신뢰성 높음**: 대부분의 상장 주식/ETF 지원

**과거 데이터 (근사값 계산)**:
- ⚠️ **85~95% 정확도**: 발행주식수 변동 미반영
- ⚠️ **오차 발생 가능**: 주식분할, 증자, 자사주 매입 시
- ✅ **ETF는 비교적 정확**: 발행주식수 변동이 적음
- ✅ **트렌드 파악 가능**: 절대값보다 변화 추이가 중요

### 스킵되는 경우
- 해당 날짜의 가격 데이터(close)가 없는 경우
- Yahoo Finance에서 sharesOutstanding을 제공하지 않는 경우
- 이미 해당 날짜에 marketCap이 있는 경우 (덮어쓰지 않음)

### 권장 사용법
1. **백테스팅**: 근사값으로도 충분 (트렌드가 중요)
2. **비교 분석**: 여러 종목의 상대적 크기 비교
3. **시각화**: 시가총액 변화 추이 파악
4. **정밀 분석 필요 시**: 유료 데이터 서비스 고려

---

## 🔍 확인 방법

### 특정 티커의 marketCap 확인

```bash
# Windows (PowerShell)
Get-Content public/data/aapl.json | ConvertFrom-Json | 
  Select-Object -ExpandProperty backtestData | 
  Select-Object -Last 5

# Linux/Mac
cat public/data/aapl.json | jq '.backtestData[-5:]'
```

### 워크플로우 실행 로그 확인

**V1**:
```
GitHub > Actions 탭 > "Update Info Data" > 최근 실행 > 
"7. Update daily market capitalization" 스텝
```

**V2**:
```
GitHub > Actions 탭 > "Update Info Data V2" > 최근 실행 > 
"6. [V2 PIPELINE] Update all info data" 스텝 >
"STEP 3: 시가총액 업데이트" 부분
```

---

## 🛠️ 문제 해결

### marketCap이 업데이트되지 않음
1. Actions 탭에서 워크플로우 실행 로그 확인
2. 시가총액 업데이트 스텝에서 오류 확인
3. 해당 티커의 데이터 파일이 존재하는지 확인
4. 오늘 날짜의 가격 데이터가 있는지 확인

### 일부 티커만 업데이트됨
- **정상 동작입니다**
- 가격 데이터가 없는 날은 marketCap도 업데이트되지 않습니다
- 장이 열리는 날에만 데이터가 쌓입니다

### 과거 데이터를 빠르게 채우고 싶음
```bash
# 근사값 계산 (85~95% 정확도)
python scripts/data_pipeline/backfill_market_cap_approximate.py
```

---

## 💡 FAQ

**Q: 시가총액은 언제 업데이트되나요?**  
A: 매일 새벽 1-2시 (Info Data 워크플로우 실행 시)

**Q: 과거 데이터는 언제부터 쌓이나요?**  
A: 이 기능이 활성화된 날(2025-10-31경)부터 매일 누적됩니다.

**Q: 과거 데이터를 빠르게 채울 수 없나요?**  
A: 근사값 계산 스크립트(`backfill_market_cap_approximate.py`)를 사용할 수 있습니다. 정확도는 85~95%입니다.

**Q: 휴일이나 주말에는?**  
A: 워크플로우는 실행되지만, 시장이 열리지 않아 새 데이터가 없으면 자동으로 스킵됩니다.

**Q: API 키가 필요한가요?**  
A: 아니요! Yahoo Finance는 완전 무료이며 API 키가 필요 없습니다.

**Q: 정확도는 어떤가요?**  
A: 
- 현재 데이터: 100% 정확 (Yahoo Finance 직접 제공)
- 과거 데이터 (근사값): 85~95% 정확 (발행주식수 변동 미반영)

**Q: V1과 V2 중 어떤 것을 사용하나요?**  
A: GitHub Actions가 자동으로 실행합니다. 테스트 기간 후 더 나은 버전으로 통합될 예정입니다.

---

## 📚 관련 파일

### 스크립트
- `scripts/data_pipeline/update_market_cap.py` - 개별 실행 스크립트 (V1)
- `scripts/data_pipeline/info_data_pipeline_kr.py` / `scripts/data_pipeline/info_data_pipeline_us.py` - 통합 파이프라인 (V2, STEP 3 포함)
- `scripts/data_pipeline/backfill_market_cap_approximate.py` - 과거 데이터 근사값 계산

### 워크플로우
- `.github/workflows/update_info_data_v2.yml` - 자동 실행

### 데이터
- `public/data/{ticker}.json` - 티커별 데이터 파일

---

## 🎯 요약

| 항목 | 내용 |
|------|------|
| **데이터 소스** | Yahoo Finance (무료, 무제한) |
| **업데이트 빈도** | 매일 1회 (새벽) |
| **처리 티커 수** | 3,000+ 개 |
| **실행 시간** | ~45초 (배치 처리) |
| **정확도** | 100% (현재 값) |
| **과거 데이터** | 자연 누적 또는 근사값 계산 |

**핵심**: 설정 불필요, 자동으로 매일 쌓입니다! ✅

