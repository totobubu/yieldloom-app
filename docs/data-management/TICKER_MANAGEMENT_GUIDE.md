# 📊 티커 관리 가이드

> 새로운 주식/ETF를 시스템에 추가하는 방법

## 📑 목차

- [개요](#개요)
- [run_new_ticker_workflow.py 사용법](#run_new_ticker_workflowpy-사용법)
- [실행 순서](#실행-순서)
- [옵션 설명](#옵션-설명)
- [문제 해결](#문제-해결)

---

## 개요

새로운 티커를 시스템에 추가할 때는 `run_new_ticker_workflow.py` 스크립트를 사용합니다. 이 스크립트는 새로운 티커를 온보딩하는 데 필요한 모든 단계를 자동으로 실행합니다.

**주요 기능:**
- ✅ IPO 날짜 업데이트
- ✅ 배당 빈도 분석
- ✅ nav.json 생성
- ✅ 정보 데이터 스크래핑
- ✅ 히스토리 가격 데이터 업데이트 (KR/US 자동 구분)
- ✅ 시가총액 업데이트
- ✅ 배당 데이터 업데이트
- ✅ 배당 히스토리 처리
- ✅ 미래 배당 예측
- ✅ 캘린더 이벤트 생성
- ✅ 사이드바 티커 생성
- ✅ 파일 포맷팅

---

## run_new_ticker_workflow.py 사용법

### 기본 사용법

```bash
# 단일 티커 추가
python scripts/workflows/run_new_ticker_workflow.py WEED

# 여러 티커 한 번에 추가
python scripts/workflows/run_new_ticker_workflow.py WEED MAGS AAPL
```

### 실행 예시

```bash
$ python scripts/workflows/run_new_ticker_workflow.py WEED MAGS

================================================================================
Local new-ticker workflow
Tickers: WEED, MAGS
Total steps: 15
Project root: C:\workspace\divgrow\totobubu.github.io
================================================================================

=== Step 1/15 ===

-> Update IPO dates (nav)
   $ npm run add-ipo-dates

=== Step 2/15 ===

-> Analyze dividend frequency
   $ python scripts/data_pipeline/analyze_dividend_frequency.py WEED MAGS

=== Step 3/15 ===


...

[OK] All steps completed successfully.
```

---

## 실행 순서

워크플로우는 다음 순서로 실행됩니다:

1. **IPO 날짜 업데이트** - nav.json의 IPO 날짜 동기화
2. **배당 빈도 분석** - 배당 주기 및 그룹 자동 분석
4. **nav.json 생성** - 최신 nav.json 파일 생성
5. **정보 데이터 스크래핑** - 티커 기본 정보 수집
7. **히스토리 가격 업데이트** - KR/US 자동 구분하여 가격 데이터 업데이트
8. **시가총액 업데이트** - 최신 시가총액 정보 업데이트
9. **배당 데이터 업데이트** - 배당 내역 업데이트
10. **배당 히스토리 처리** - 배당 히스토리 스크래핑
11. **미래 배당 예측** - 향후 배당 날짜 예측
12. **캘린더 이벤트 생성** - 배당 캘린더 이벤트 생성
13. **사이드바 티커 생성** - 사이드바 목록 업데이트
14. **파일 포맷팅** - 변경된 파일 자동 포맷팅

---

## 옵션 설명

### `--skip-format`

최종 포맷팅 단계를 건너뜁니다.

```bash
python scripts/workflows/run_new_ticker_workflow.py WEED --skip-format
```



```bash
```

### `--dry-run`

실제로 실행하지 않고 실행 계획만 출력합니다.

```bash
python scripts/workflows/run_new_ticker_workflow.py WEED MAGS --dry-run
```

**출력 예시:**
```
================================================================================
Local new-ticker workflow
Tickers: WEED, MAGS
Total steps: 15
Project root: C:\workspace\divgrow\totobubu.github.io
================================================================================

=== Step 1/15 ===

-> Update IPO dates (nav)
   $ npm run add-ipo-dates

[DRY-RUN] No commands were executed.
```

---

## 문제 해결

### ❌ 문제: "Step failed" 오류

**원인:** 특정 단계에서 오류 발생

**해결:**
1. 오류 메시지를 확인하여 어떤 단계에서 실패했는지 확인
2. 해당 단계를 개별적으로 실행하여 문제 파악

**예시:**
```bash

```

---

### ❌ 문제: 티커가 nav.json에 없어서 오류 발생

**원인:** 티커가 아직 nav.json에 등록되지 않음

**해결:**
1. 먼저 티커를 nav 파일에 수동으로 추가하거나
2. `fetch_kr_tickers.py` 또는 다른 티커 추가 스크립트를 먼저 실행

---

### ❌ 문제: "No module named 'xxx'" 오류

**원인:** 필요한 Python 패키지가 설치되지 않음

**해결:**
```bash
pip install -r requirements-workflow.txt
```

---

### ❌ 문제: Windows에서 npm/npx 명령어 오류

**원인:** Windows에서는 npm.cmd, npx.cmd를 사용해야 함

**해결:** 스크립트가 자동으로 처리하므로 문제 없어야 합니다. 계속 발생하면 스크립트의 `resolve_executable` 함수를 확인하세요.

---

### ❌ 문제: 특정 단계만 다시 실행하고 싶음

**해결:** 워크플로우는 중간에 실패해도 개별 단계를 직접 실행할 수 있습니다.

```bash
# 예: 배당 빈도 분석만 다시 실행
python scripts/data_pipeline/analyze_dividend_frequency.py WEED MAGS

# 예: 히스토리 가격만 업데이트
node tasks/updateHistoricalUsData.js WEED MAGS
```

---

## 💡 팁

### 1. 여러 티커를 한 번에 처리

```bash
# 여러 티커를 한 번에 추가하면 효율적입니다
python scripts/workflows/run_new_ticker_workflow.py WEED MAGS AAPL TSLA
```

### 2. Dry-run으로 먼저 확인

실행 전에 계획을 확인하고 싶을 때:

```bash
python scripts/workflows/run_new_ticker_workflow.py WEED MAGS --dry-run
```

### 3. 특정 단계만 건너뛰기


```bash
```

### 4. 변경사항 확인

워크플로우 실행 후 변경사항 확인:

```bash
git status
git diff public/nav/
git diff public/data/
```

### 5. 실수로 잘못 추가했을 때

```bash
# 변경사항 되돌리기
git checkout public/nav/ public/data/

# 다시 실행
python scripts/workflows/run_new_ticker_workflow.py WEED
```

---

## 📚 참고 자료

- **run_new_ticker_workflow.py 소스:** `scripts/workflows/run_new_ticker_workflow.py`
- **전체 데이터 업데이트:** `src/README.md` 참고
- **로컬 vs GitHub 워크플로우:** `docs/LOCAL_VS_GITHUB_WORKFLOWS.md` 참고

---

**마지막 업데이트:** 2025-01-01
