# 🔄 로컬 vs GitHub Workflows 비교

> 로컬 스크립트와 GitHub Actions 워크플로우의 차이점 정리

---

## 📋 전체 비교표

| 단계 | 로컬 스크립트 | GitHub Info Data | GitHub Market Data |
|-----|-------------|-----------------|-------------------|
| **3. 환율 데이터** | ✅ | ✅ | ❌ |
| **4. IPO 날짜** | ✅ | ✅ | ❌ |
| **5. 배당 빈도** | ✅ | ✅ | ❌ |
| **6. nav.json 생성** | ✅ | ✅ | ❌ |
| **7. 시가총액 업데이트** | ✅ | ✅ | ❌ |
| **7.5. 히스토리 가격** | ✅ | ❌ | ✅ |
| **8. 배당 데이터** | ✅ | ✅ | ❌ |
| **9. 배당 히스토리 처리** | ✅ | ✅ | ❌ |
| **9.5. 데이터 정리** | ✅ | ✅ | ❌ |
| **10. 티커 정보** | ✅ | ✅ | ❌ |
| **11. 북마크 인기도** | ✅ | ❌ | ✅ |
| **11.5. 미래 배당 예측** | ✅ | ✅ | ❌ |
| **12. 캘린더 이벤트** | ✅ | ✅ | ❌ |
| **13. 사이드바 티커** | ✅ | ❌ | ✅ |
| **14. 포맷팅** | ✅ (변경된 파일만) | ✅ (변경된 파일만) | ✅ (변경된 파일만) |
| **15. R2 업로드** | ❌ (로컬 불필요) | ✅ | ✅ |

---

## 🎯 핵심 차이점

### 1️⃣ **로컬 스크립트**
- **목적:** 모든 데이터를 한 번에 업데이트
- **실행:** 수동 (필요할 때만)
- **특징:** 통합 버전 (Info + Market 모두 포함)

### 2️⃣ **GitHub Info Data** (update_info_data_v2.yml)
- **목적:** 정보성 데이터만 업데이트
- **실행:** 하루 1회 (새벽 2시)
- **제외:** 
  - ❌ 히스토리 가격 데이터 (7.5)
  - ❌ 북마크 인기도 (11)
  - ❌ 사이드바 티커 (13)

### 3️⃣ **GitHub Market Data** (market_data_v2_kr.yml, market_data_v2_us.yml)
- **목적:** 시장 데이터만 업데이트
- **실행:** 평일 (한국장/미국장 마감 후)
- **포함:** 가격, 인기도, 사이드바 티커 등 **자주 변하는 데이터**
- **제외:** Info Data의 모든 항목

---

## 📝 단계별 상세 비교

### ✅ 정보성 데이터 (하루 1회)

| 순서 | 작업 | 로컬 | GitHub Info | 설명 |
|-----|------|------|------------|------|
| 3 | 환율 데이터 | ✅ | ✅ | `node scripts/exchange/fetch_all_exchange_rates.js` |
| 4 | IPO 날짜 | ✅ | ✅ | `npm run add-ipo-dates` |
| 5 | 배당 빈도 | ✅ | ✅ | `python scripts/data_pipeline/analyze_dividend_frequency.py` |
| 6 | nav.json | ✅ | ✅ | `npm run generate-nav` |
| 7 | 시가총액 | ✅ | ✅ | `python scripts/data_pipeline/update_market_cap.py` |
| 8 | 배당 데이터 | ✅ | ✅ | `python scripts/data_pipeline/update_dividends.py` |
| 9 | 배당 히스토리 | ✅ | ✅ | `python scripts/data_pipeline/scraper_dividend.py` |
| 9.5 | 데이터 정리 | ✅ | ✅ | `python scripts/data_processing/clean_data.py` |
| 10 | 티커 정보 | ✅ | ✅ | `python scripts/data_pipeline/scraper_info.py` |
| 11.5 | 미래 배당 예측 | ✅ | ✅ | `python scripts/data_pipeline/project_future_dividends.py` |
| 12 | 캘린더 이벤트 | ✅ | ✅ | `npm run generate-calendar-events` |

---

### ✅ 시장 데이터 (하루 2회)

| 순서 | 작업 | 로컬 | GitHub Market | 설명 |
|-----|------|------|--------------|------|
| 7.5 | 히스토리 가격 (KR) | ✅ | ✅ | `node tasks/updateHistoricalKrData.js` |
| 7.6 | 히스토리 가격 (US) | ✅ | ✅ | `node tasks/updateHistoricalUsData.js` |
| 11 | 북마크 인기도 | ✅ | ✅ | `python scripts/utils/popularity_utils.py` |
| 13 | 사이드바 티커 | ✅ | ✅ | `python scripts/utils/generateSidebar.py` |

---

### ✅ 공통 작업

| 순서 | 작업 | 로컬 | GitHub | 설명 |
|-----|------|------|--------|------|
| 14 | 포맷팅 | ✅ | ✅ | `npm run format:changed` (Git 변경분만) |
| 15 | R2 업로드 | ❌ | ✅ | `python scripts/cloud/upload_changed_to_r2.py` |

---

## ⚠️ 주요 차이점 요약

### 1️⃣ **단계 순서**

**로컬:**
```
7. 시가총액 업데이트
7.5. 히스토리 가격 데이터 업데이트
```

**GitHub Info Data:**
```
7. 시가총액 업데이트 (info_data_pipeline.py에 포함)
(7.5는 없음)
```

**GitHub Market Data:**
```
7. 히스토리 가격 데이터 업데이트 (KR/US 분리)
(시가총액은 없음 - Info Data에서 처리)
```

### 2️⃣ **포맷팅 명령어**

**이전:**
```bash
npm run format:data
npm run format:nav
npm run format:public
```

**현재 (최적화):**
```bash
npm run format:changed  # Git 변경된 파일만! 🚀
```

### 3️⃣ **R2 업로드**

**로컬:**
- ❌ R2 업로드 없음 (로컬 테스트용)

**GitHub:**
- ✅ R2 업로드 있음 (프로덕션 배포)
- `python scripts/cloud/upload_changed_to_r2.py`

---

## 🚀 로컬 스크립트 사용법

### PowerShell (권장)
```powershell
# 전체 실행
.\scripts\update_all_local.ps1

# 또는 개별 단계 실행
python scripts/workflows/run_new_ticker_workflow.py WEED MAGS
npm run generate-nav
```

### Batch File
```batch
# 전체 실행
scripts\update_all_local.bat
```

---

## 📊 실행 시간 비교

| 환경 | 예상 시간 | 특징 |
|-----|----------|------|
| **로컬 (전체)** | ~50-60분 | 모든 단계 포함 |
| **GitHub Info Data** | ~25분 | 하루 1회만 실행 |
| **GitHub Market Data (KR)** | ~15분 | 평일 한국장 마감 후 |
| **GitHub Market Data (US)** | ~15분 | 평일 미국장 마감 후 |
| **GitHub (하루 총)** | ~55-70분 | Info 1회 + Market (평일) |

---

## ✅ 동기화 완료

로컬 스크립트가 최신 GitHub Workflows와 동기화되었습니다:

1. ✅ **단계 순서 정리:** 7과 7.5 순서 조정
2. ✅ **포맷팅 최적화:** `format:changed` 사용
3. ✅ **R2 업로드:** 로컬에서는 제외 (의도적)

**차이점:**
- 로컬은 **통합 버전** (모든 단계 포함)
- GitHub은 **분리 버전** (Info/Market 분리)
- 이는 **의도된 설계**입니다! ✅

---

**마지막 업데이트:** 2025-11-04

