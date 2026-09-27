# 워크플로우 가이드

## 📋 목차

1. [워크플로우 개요](#워크플로우-개요)
2. [Info Data 워크플로우](#info-data-워크플로우)
4. [최적화 내역](#최적화-내역)
5. [성능 개선 효과](#성능-개선-효과)

---

## 🔍 워크플로우 개요

현재 프로젝트는 주요 데이터 업데이트 워크플로우로 구성되어 있습니다:

| 워크플로우 | 파일 | 실행 빈도 | 실행 시간 | 소요 시간 |
|-----------|------|----------|-----------|----------|
| **Info Data** | `update_info_data_v2.yml` | 매일 | 새벽 2시 (KST) | ~25분 |
| **Market Data KR** | `market_data_v2_kr.yml` | 평일 | 오후 4시 (KST) | ~15분 |
| **Market Data US** | `market_data_v2_us.yml` | 평일 | 오후 5시 (EST) | ~15분 |

---

## 📊 Info Data 워크플로우

### 개요

**파일**: `.github/workflows/update_info_data_v2.yml`

**실행 빈도**: 매일 새벽 2시 (KST)

**목적**: 배당 데이터, 티커 정보, 시가총액 등 정보성 데이터 업데이트

### 워크플로우 구조

```
1. 초기화
   ├─ Checkout
   ├─ Node.js Setup
   └─ Python Setup

2. 기본 데이터
   ├─ Exchange rate 업데이트
   ├─ IPO dates 동기화
   └─ nav.json 생성

3. 통합 파이프라인 (핵심)
   └─ info_data_pipeline.py (5-in-1)
      ├─ 배당 데이터 업데이트
      ├─ 티커 정보 + 시가총액 업데이트
      ├─ 배당 빈도 분석
      ├─ 미래 배당일 예측
      └─ (모든 작업을 한 번에 처리)

4. 부가 작업
   ├─ 배당 히스토리 처리
   └─ 캘린더 이벤트 생성

5. 최종 처리
   ├─ 변경 파일 포맷팅
   ├─ R2 업로드
   └─ Git 커밋 & 푸시
```

### 주요 특징

#### 1. 통합 파이프라인

기존에 5개의 개별 스크립트를 1개의 통합 파이프라인으로 처리:

```python
# 통합 파이프라인: scripts/data_pipeline/info_data_pipeline_kr.py / scripts/data_pipeline/info_data_pipeline_us.py
def main():
    # 1. nav.json을 1회만 로드
    nav_data = load_nav_json()
    
    # 2. yfinance를 1회만 import
    import yfinance as yf
    
    # 3. 모든 작업을 순차 처리
    update_dividends(nav_data, yf)
    update_ticker_info(nav_data, yf)  # marketCap 포함
    analyze_dividend_frequency(nav_data)
    project_future_dividends(nav_data)
```

**장점:**
- ✅ 중복 API 호출 제거 (marketCap을 tickerInfo와 함께 처리)
- ✅ yfinance를 1회만 import (메모리 효율)
- ✅ nav.json을 1회만 로드 (I/O 최적화)
- ✅ 배치 처리로 네트워크 오버헤드 감소

#### 2. Git 기반 최적화

```yaml
# 변경된 파일만 포맷팅 (90% 빠름)
- npm run format:changed

# 변경된 파일만 R2 업로드 (90% 빠름)
- python scripts/cloud/upload_changed_to_r2.py
```

#### 3. 스마트 업데이트

`Update` 필드는 데이터 변경 시에만 갱신:

```python
# scripts/data_pipeline/scraper_info.py
data_changed = json.dumps(old_data) != json.dumps(new_data)

if not data_changed:
    # 데이터 변경이 없으면 Update 필드 유지하고 저장 안함
    continue
```

### 스텝별 소요 시간 (참고)

| 스텝 | 소요 시간 | 비고 |
|------|----------|------|
| 초기화 | ~7분 | Checkout, Setup |
| Exchange rate | 0초 | - |
| IPO dates | 8초 | - |
| Generate nav.json | 17초 | - |
| **통합 파이프라인** | **13-14분** | 핵심 데이터 처리 |
| Dividend history | 3분 | - |
| Calendar events | 21초 | - |
| Format | 3-12분 | 변경 파일 수 의존 |
| R2 upload | 16-28분 | 변경 파일 수 의존 |
| Commit & push | ~30초 | - |

**순수 처리 시간**: ~24분 (포맷/R2 제외)

---


### 개요


**실행 빈도**: 매일 새벽 3시 30분 (KST)


### 워크플로우 구조

```

   - YieldMax: 57개 (웹 스크래핑)
   - 일반 ETF: ~900개 (Yahoo Finance API)

   - Roundhill: 43개 (완전 자동화)
   - 데이터 중복 자동 비교

   - ARK: 10개 (CSV 직접 다운로드)

   - iShares: 4개 (IBIT, ETHA, GARP, GSG)

6. Format changed files
   → npm run format:changed

7. Upload to R2
   → python scripts/cloud/upload_changed_to_r2.py

8. Commit and push
```


| ETF 유형 | 변경 빈도 | 예시 |
|---------|---------|------|
| **인덱스 ETF** | 월 1-2회 | SPY, QQQ, VOO |
| **액티브 ETF** | 주 1-2회 | TSLY, NVDY, APLY |
| **테마 ETF** | 월 1-2회 | MAGS, WEED, CHAT |
| **레버리지 ETF** | 일 1회+ | SQQQ, TQQQ |

### 분리 이유


**Before (Info에 포함):**
```
```

**After (별도 워크플로우):**
```
```

**장점:**
- ✅ Info Data가 빠르게 완료 (45분)
- ✅ Concurrency 그룹으로 순차 실행 보장
- ✅ 완전 자동화 (Roundhill 포함)

---

## 🎯 최적화 내역

### 1. 통합 파이프라인

#### Before (개별 스크립트)

```yaml
- name: Update market cap
  run: python scripts/data_pipeline/update_market_cap.py      # 17분

- name: Update dividends
  run: python scripts/data_pipeline/update_dividends.py       # 17분

- name: Update ticker info
  run: python scripts/data_pipeline/scraper_info.py           # 10분

- name: Dividend frequency
  run: python scripts/data_pipeline/analyze_dividend_frequency.py  # 2분

- name: Project future dividends
  run: python scripts/data_pipeline/project_future_dividends.py    # 2분
```

**문제점:**
- 각 스크립트마다 yfinance를 import
- 각 스크립트마다 nav.json을 로드
- 같은 티커에 대해 API를 여러 번 호출 (marketCap과 tickerInfo를 따로)

#### After (통합 파이프라인)

```yaml
- name: Update all info data
  run: python scripts/data_pipeline/info_data_pipeline_kr.py     # 14분 (KR)
  run: python scripts/data_pipeline/info_data_pipeline_us.py     # 14분 (US)
```

**개선:**
- ✅ yfinance 1회 import
- ✅ nav.json 1회 로드
- ✅ marketCap과 tickerInfo를 함께 처리 (중복 API 호출 제거)
- ✅ 48분 → 14분 (68% 단축)

### 2. Git 기반 처리

#### Before (전체 파일 처리)

```yaml
# 모든 파일 포맷팅
- run: npm run format           # 5분

# 모든 파일 해시 계산 후 업로드
- run: python scripts/cloud/upload_full_sync_to_r2.py  # 10분
```

#### After (변경 파일만 처리)

```yaml
# 변경된 파일만 포맷팅
- run: npm run format:changed   # 3초

# 변경된 파일만 업로드 (Git 기반)
- run: python scripts/cloud/upload_changed_to_r2.py  # 15초
```

**개선:**
- ✅ 해시 계산 불필요 (Git으로 변경 감지)
- ✅ 변경 파일만 처리
- ✅ 90% 이상 빠름

### 3. Update 필드 정책

#### Before (항상 업데이트)

```python
# 4시간마다 Update 필드 갱신
if last_update > 4_hours_ago:
    new_info["Update"] = now()  # 매번 변경
```

**문제:** 데이터 변경이 없어도 파일이 수정되어 불필요한 업로드 발생

#### After (변경 시만 업데이트)

```python
# 데이터 변경 시에만 Update 필드 갱신
data_changed = old_data != new_data

if data_changed:
    new_info["Update"] = now()
else:
    continue  # 저장하지 않음
```

**개선:**
- ✅ 불필요한 파일 변경 제거
- ✅ R2 업로드 파일 수 감소
- ✅ Git 커밋 크기 최소화


#### Before

```yaml
# Info 워크플로우에 포함 (매일)
```


#### After

```yaml
# 별도 워크플로우 (주 1회)
schedule:
  - cron: '0 18 * * 0'  # 일요일만
```

**개선:**
- ✅ 불필요한 실행 제거 (주 7회 → 1회)
- ✅ Info 워크플로우 속도 향상

---

## 📊 성능 개선 효과

### 실행 시간 비교

#### Info Data 워크플로우 (순수 처리 시간)

| 항목 | Before (V1) | After (통합) | 개선 |
|------|------------|-------------|------|
| **순수 처리** | 56분 33초 | 24분 13초 | **57% 단축** ⚡ |
| 핵심 데이터 | 43분 23초 | 13분 42초 | **68% 단축** ⚡ |
| 스텝 수 | 12개 | 8개 | **33% 감소** |

**시간 절약: 32분 20초**

#### 전체 실행 시간 (참고)

| 항목 | Before | After | 비고 |
|------|--------|-------|------|
| 순수 처리 | 56분 | 24분 | 워크플로우 성능 |
| 포맷팅 | 12분 | 3분 | 변경 파일 수 의존 |
| R2 업로드 | 28분 | 16분 | 변경 파일 수 의존 |
| **총 시간** | **1시간 37분** | **44분** | - |

### 월간 비용 절감

**순수 처리 시간 기준:**

| 항목 | Before (V1) | After (통합) | 절감 |
|------|------------|-------------|------|
| 일일 | 56분 33초 | 24분 13초 | 32분 20초 |
| 월간 | 20시간 44분 | 8시간 52분 | **11시간 52분** |
| GitHub Actions 비용 | $X | $0.43X | **57% 절감** |


| 항목 | Before | After | 절감 |
|------|--------|-------|------|
| 일일 | 23분 × 7일 = 161분 | 30분 × 1일 = 30분 | 131분 |
| 월간 | 10시간 44분 | 2시간 | **8시간 44분** |

**총 절감: 월 20시간 36분** 🎉

### 주요 개선사항

| 항목 | Before | After | 개선율 |
|------|--------|-------|--------|
| **API 호출** | 중복 다수 | 최적화 | 중복 제거 |
| **메모리 사용** | 높음 | 낮음 | 최적화 |
| **파일 변경** | 불필요한 변경 많음 | 최소화 | 데이터 변경 시만 |

---

## 🔧 기술적 개선

### 1. 통합 파이프라인

```python
# scripts/data_pipeline/info_data_pipeline_kr.py
# scripts/data_pipeline/info_data_pipeline_us.py

def main():
    # 1회만 로드
    nav_data = load_nav_json()
    import yfinance as yf
    
    # 순차 처리
    update_dividends(nav_data, yf)
    update_ticker_info(nav_data, yf)  # marketCap 포함
    analyze_dividend_frequency(nav_data)
    project_future_dividends(nav_data)
```

### 2. Git 기반 변경 감지

```bash
# 변경된 파일만 가져오기
git diff --name-only HEAD

# 변경된 파일만 포맷팅
npm run format:changed

# 변경된 파일만 R2 업로드
python scripts/cloud/upload_changed_to_r2.py
```

### 3. 배치 처리

```python
# Before: 티커별 개별 호출
for ticker in tickers:
    yf.Ticker(ticker).info  # N회 호출

# After: 배치 처리
tickers = yf.Tickers(' '.join(all_tickers))
tickers.tickers  # 1회 호출
```

---

## 📚 관련 문서

- [V1_V2_COMPARISON.md](./V1_V2_COMPARISON.md) - V1과 V2 상세 비교 (참고용)
- [UPDATE_POLICY.md](./UPDATE_POLICY.md) - Update 필드 정책
- [FORMAT_GUIDE.md](./FORMAT_GUIDE.md) - Git 기반 스마트 포맷

---

## 💡 요약

### 현재 워크플로우

**Info Data** (매일):
- ✅ 통합 파이프라인으로 최적화
- ✅ 중복 API 호출 제거
- ✅ 57% 빠른 처리 속도

- ✅ 별도 워크플로우로 분리
- ✅ 불필요한 실행 제거
- ✅ 월 8시간 절약

### 주요 성과

- ⚡ **순수 처리 시간 57% 단축** (56분 → 24분)
- 💰 **월 20시간 이상 절약**
- 🔧 **스텝 33% 감소** (12개 → 8개)
- 📊 **데이터 일관성 향상** (중복 제거)

---

**Last Updated**: 2025-11-05  
**Version**: 1.0.0 (통합 완료)
