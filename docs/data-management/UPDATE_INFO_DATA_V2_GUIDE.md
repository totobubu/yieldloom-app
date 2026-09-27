# Update Info Data v2 워크플로우 가이드

이 문서는 `update_info_data_v2` 워크플로우의 상세 내용과 데이터 저장 구조를 설명합니다.

## 📋 목차

1. [개요](#개요)
2. [워크플로우 구조](#워크플로우-구조)
3. [핵심 파일](#핵심-파일)
4. [데이터 저장 경로](#데이터-저장-경로)
5. [실행 단계별 설명](#실행-단계별-설명)
6. [데이터 확인 방법](#데이터-확인-방법)
7. [로컬 테스트](#로컬-테스트)

---

## 🔍 개요

**워크플로우 파일**: `.github/workflows/update_info_data_v2.yml`

**실행 빈도**: 매일 새벽 2시 (KST, UTC 17:00)

**목적**: 배당 데이터, 티커 정보, 시가총액 등 정보성 데이터 업데이트

**핵심 특징**:
- ✅ 통합 파이프라인으로 중복 API 호출 제거
- ✅ 시장별 디렉토리 구조 (`public/data/{{market}}/{{ticker}}.json`)
- ✅ 증분 업데이트로 효율성 향상
- ✅ 배당 빈도 분석 및 미래 배당일 예측

---

## 🏗️ 워크플로우 구조

```
1. 초기화
   ├─ Checkout
   ├─ Node.js Setup
   └─ Python Setup

2. 기본 데이터 준비
   ├─ 한국 티커 심볼 동기화
   ├─ 한국 시장 메타데이터 보강
   ├─ 환율 데이터 업데이트
   ├─ IPO 날짜 동기화
   └─ nav.json 생성

3. 통합 파이프라인 (핵심) ⚡
   └─ info_data_pipeline.py
      ├─ Step 1: 배당 데이터 업데이트
      ├─ Step 2: 티커 정보 + 시가총액 업데이트
      ├─ Step 3: 배당 빈도 분석
      └─ Step 4: 미래 배당일 예측

4. 부가 작업
   ├─ 배당 히스토리 처리
   ├─ 분할 조정 적용
   └─ 캘린더 이벤트 생성

5. 최종 처리
   ├─ 변경 파일 포맷팅
   ├─ R2 업로드
   └─ Git 커밋 & 푸시
```

---

## 📄 핵심 파일

### `scripts/data_pipeline/info_data_pipeline_kr.py` / `scripts/data_pipeline/info_data_pipeline_us.py`

정보성 데이터를 통합 처리하는 메인 파이프라인 스크립트입니다.

**주요 기능**:

1. **배당 데이터 업데이트** (`update_dividends`)
   - 마지막 배당일 이후의 새로운 배당 데이터만 수집
   - 접미사 자동 보정 (`.KS` ↔ `.KQ`)
   - 기존 데이터와 병합

2. **티커 정보 + 시가총액 업데이트** (`update_ticker_info`)
   - 배치 처리로 네트워크 효율성 향상
   - 시가총액을 `tickerInfo`와 함께 처리 (중복 API 호출 제거)
   - ISIN 정보 수집 및 업데이트
   - 변경사항 추적 (up/down)

3. **배당 빈도 분석** (`analyze_dividend_frequency`)
   - 배당 간격 분석 (매주/매월/분기/매년)
   - 그룹 분석 (요일 또는 월)
   - nav.json 업데이트

4. **미래 배당일 예측** (`project_future_dividends`)
   - 다음 6개월간의 배당일 예측
   - 휴일 고려한 영업일 조정
   - forecasted 플래그로 실제 배당과 구분

**시장 필터링 지원**:
```python
# 환경변수로 시장 필터링 가능
MARKET_FILTER=KR  # 한국 티커만
MARKET_FILTER=US  # 미국 티커만
# 또는 생략 (전체)
```

---

## 📂 데이터 저장 경로

### 레이아웃 모드

워크플로우는 `DATA_LAYOUT_MODE=market` 환경변수를 사용하여 시장별 디렉토리 구조로 데이터를 저장합니다.

### 파일 경로 구조

```
public/data/
├── NASDAQ/
│   ├── aapl.json
│   ├── msft.json
│   └── qqq.json
├── NYSE/
│   ├── spy.json
│   └── voo.json
├── KOSPI/
│   ├── 005930.json
│   └── 000660.json
├── KOSDAQ/
│   ├── 160580.json
│   └── 035720.json
└── KONEX/
    └── ...
```

### 경로 생성 규칙

```python
# scripts/utils.py의 get_data_file_path 함수
def get_data_file_path(symbol, market=None, *, layout=None):
    """
    DATA_LAYOUT_MODE=market일 때:
    - public/data/{market}/{sanitized_symbol}.json
    """
```

**예시**:
- `AAPL` (NASDAQ) → `public/data/NASDAQ/aapl.json`
- `SPY` (NYSE) → `public/data/NYSE/spy.json`
- `005930.KS` (KOSPI) → `public/data/KOSPI/005930.json`
- `160580.KQ` (KOSDAQ) → `public/data/KOSDAQ/160580.json`

---

## 🔄 실행 단계별 설명

### Step 1: 배당 데이터 업데이트

**함수**: `update_dividends()`

**처리 과정**:
1. 각 티커의 마지막 배당일 조회
2. 마지막 배당일 이후의 새로운 배당 데이터만 yfinance에서 수집
3. 접미사 자동 보정 (`.KS` ↔ `.KQ` 시도)
4. 기존 `backtestData`와 병합
5. 변경사항이 있을 때만 파일 저장

**데이터 구조**:
```json
{
  "backtestData": [
    {
      "date": "2024-01-15",
      "amount": 0.24
    },
    {
      "date": "2024-04-15",
      "amount": 0.24
    }
  ]
}
```

---

### Step 2: 티커 정보 + 시가총액 업데이트

**함수**: `update_ticker_info()`

**처리 과정**:
1. 배치 단위로 티커 정보 수집 (50개씩)
2. 각 티커의 정보 가공 (가격, 시가총액, 배당 수익률 등)
3. `tickerInfo` 업데이트
4. `marketCap`을 `backtestData`의 최근 항목에도 추가 (중복 API 호출 제거)
5. 변경사항 추적 (up/down 표시)
6. 데이터 변경 시에만 저장

**데이터 구조**:
```json
{
  "tickerInfo": {
    "Symbol": "AAPL",
    "koName": "애플",
    "longName": "Apple Inc.",
    "market": "NASDAQ",
    "currency": "USD",
    "regularMarketPrice": 175.43,
    "marketCap": 2734567890123,
    "Yield": 0.0048,
    "dividendRate": 0.96,
    "isin": "US0378331005",
    "Update": "2024-01-15 02:30:15 KST",
    "changes": {
      "regularMarketPrice": {
        "value": 174.50,
        "change": "up"
      }
    }
  },
  "backtestData": [
    {
      "date": "2024-01-15",
      "close": 175.43,
      "marketCap": 2734567890123
    }
  ]
}
```

---

### Step 3: 배당 빈도 분석

**함수**: `analyze_dividend_frequency()`

**처리 과정**:
1. 각 티커의 배당 히스토리 분석
2. 배당 간격 계산 (매주/매월/분기/매년)
3. 그룹 분석 (요일 또는 월)
4. nav.json 업데이트

**분석 결과**:
- **frequency**: `"매주"`, `"매월"`, `"분기"`, `"매년"`
- **group**: 요일 (`"월"`, `"화"`, `"수"`, `"목"`, `"금"`) 또는 월 (`"JFM"`, `"AMJ"` 등)

---

### Step 4: 미래 배당일 예측

**함수**: `project_future_dividends()`

**처리 과정**:
1. 각 티커의 배당 빈도 정보 확인
2. 마지막 배당일 기준으로 다음 배당일 계산
3. 휴일 고려한 영업일 조정
4. 6개월까지의 미래 배당일 예측
5. `forecasted: true` 플래그로 실제 배당과 구분

**데이터 구조**:
```json
{
  "backtestData": [
    {
      "date": "2024-01-15",
      "amount": 0.24
    },
    {
      "date": "2024-04-15",
      "forecasted": true
    },
    {
      "date": "2024-07-15",
      "forecasted": true
    }
  ]
}
```

---

## ✅ 데이터 확인 방법

### 1. 파일 존재 여부 확인

```bash
# 특정 티커 파일 확인
ls public/data/NASDAQ/aapl.json
ls public/data/KOSPI/005930.json
```

### 2. 데이터 내용 확인

```bash
# JSON 파일 내용 확인
cat public/data/NASDAQ/aapl.json | jq '.tickerInfo'

# 배당 데이터 확인
cat public/data/NASDAQ/aapl.json | jq '.backtestData[] | select(.amount != null)'

# 최근 시가총액 확인
cat public/data/NASDAQ/aapl.json | jq '.backtestData[-1].marketCap'
```

### 3. 시장별 파일 목록 확인

```bash
# NASDAQ 티커 목록
ls public/data/NASDAQ/

# KOSPI 티커 목록
ls public/data/KOSPI/
```

### 4. 업데이트 시간 확인

```bash
# Update 필드 확인
cat public/data/NASDAQ/aapl.json | jq '.tickerInfo.Update'
```

---

## 🧪 로컬 테스트

### 기본 테스트

```powershell
# Info Data 워크플로우 테스트
.\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2
```

### 시장 필터링 테스트

```powershell
# 한국 티커만 테스트
$env:MARKET_FILTER="KR"
python scripts/data_pipeline/info_data_pipeline_kr.py
python scripts/data_pipeline/info_data_pipeline_us.py

# 미국 티커만 테스트
$env:MARKET_FILTER="US"
python scripts/data_pipeline/info_data_pipeline_kr.py
python scripts/data_pipeline/info_data_pipeline_us.py
```

### 개별 단계 테스트

```python
# Python 인터프리터에서
from scripts.info_data_pipeline import *

# 초기화
initialize(market_filter="KR")  # 또는 "US" 또는 None

# 개별 단계 실행
update_dividends()
update_ticker_info()
analyze_dividend_frequency()
project_future_dividends()
```

### 데이터 검증

워크플로우 실행 후 다음을 확인하세요:

1. **파일 생성 확인**:
   ```bash
   # 예상 경로에 파일이 생성되었는지 확인
   ls public/data/NASDAQ/aapl.json
   ```

2. **데이터 구조 확인**:
   ```bash
   # tickerInfo와 backtestData가 있는지 확인
   cat public/data/NASDAQ/aapl.json | jq 'keys'
   ```

3. **업데이트 시간 확인**:
   ```bash
   # Update 필드가 최근 시간인지 확인
   cat public/data/NASDAQ/aapl.json | jq '.tickerInfo.Update'
   ```

4. **시가총액 추가 확인**:
   ```bash
   # backtestData의 최근 항목에 marketCap이 있는지 확인
   cat public/data/NASDAQ/aapl.json | jq '.backtestData[-1].marketCap'
   ```

---

## 🔧 주요 설정

### Rate Limit 설정

```python
# scripts/data_pipeline/info_data_pipeline_kr.py
# scripts/data_pipeline/info_data_pipeline_us.py
INFO_BATCH_SIZE = 50  # 배치 크기
INFO_BATCH_DELAY_SEC = 2.0  # 배치 간 대기 시간
INFO_SYMBOL_DELAY_SEC = 0.05  # 개별 심볼 간 대기 시간
DIVIDEND_SYMBOL_DELAY_SEC = 0.2  # 배당 수집 시 대기 시간
```

### 접미사 자동 보정

```python
# .KS ↔ .KQ 자동 시도
SUFFIX_FALLBACKS = {
    ".KS": [".KQ"],
    ".KQ": [".KS"],
}
```

### 시장 필터링

```python
# 환경변수로 필터링
MARKET_FILTER = os.environ.get("MARKET_FILTER")
# "KR" 또는 "US" 또는 None (전체)
```

---

## 📊 성능 최적화

### 통합 파이프라인 효과

**Before (개별 스크립트)**:
- 각 스크립트마다 yfinance import
- 각 스크립트마다 nav.json 로드
- marketCap과 tickerInfo를 따로 수집 (중복 API 호출)

**After (통합 파이프라인)**:
- ✅ yfinance 1회 import
- ✅ nav.json 1회 로드
- ✅ marketCap과 tickerInfo를 함께 처리
- ✅ 48분 → 14분 (68% 단축)

### 증분 업데이트

- 배당 데이터: 마지막 배당일 이후만 수집
- 티커 정보: 데이터 변경 시에만 저장
- Update 필드: 데이터 변경 시에만 갱신

---

## ⚠️ 주의사항

### 1. 환경변수

- `DATA_LAYOUT_MODE=market`: 시장별 디렉토리 구조 사용
- `FIRESTORE_SA_KEY`: 정보 데이터 업데이트 시 필요 (선택적)
- `MARKET_FILTER`: 시장 필터링 (선택적)

### 2. 파일 경로

데이터는 반드시 `public/data/{{market}}/{{ticker}}.json` 형식으로 저장됩니다.

예시:
- ✅ `public/data/NASDAQ/aapl.json`
- ✅ `public/data/KOSPI/005930.json`
- ❌ `public/data/aapl.json` (레이아웃 모드가 flat인 경우만)

### 3. 접근 권한

- 로컬 테스트: 파일 시스템에 직접 저장
- GitHub Actions: 커밋 후 푸시
- R2 업로드: 별도 스크립트로 처리

---

## 🔗 관련 문서

- [WORKFLOW_TEST_GUIDE.md](./WORKFLOW_TEST_GUIDE.md) - 워크플로우 로컬 테스트 가이드
- [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) - 워크플로우 전체 개요

---

## 📝 요약

### 데이터 저장 경로

**형식**: `public/data/{{market}}/{{ticker}}.json`

**예시**:
- `public/data/NASDAQ/aapl.json`
- `public/data/NYSE/spy.json`
- `public/data/KOSPI/005930.json`
- `public/data/KOSDAQ/160580.json`

### 데이터 구조

```json
{
  "tickerInfo": {
    "Symbol": "AAPL",
    "regularMarketPrice": 175.43,
    "marketCap": 2734567890123,
    "Update": "2024-01-15 02:30:15 KST"
  },
  "backtestData": [
    {
      "date": "2024-01-15",
      "close": 175.43,
      "amount": 0.24,
      "marketCap": 2734567890123
    }
  ]
}
```

### 확인 방법

1. 파일 존재: `ls public/data/{{market}}/{{ticker}}.json`
2. 데이터 내용: `cat public/data/{{market}}/{{ticker}}.json | jq`
3. 업데이트 시간: `cat public/data/{{market}}/{{ticker}}.json | jq '.tickerInfo.Update'`

---

**Last Updated**: 2025-01-XX  
**Version**: 1.0.0

