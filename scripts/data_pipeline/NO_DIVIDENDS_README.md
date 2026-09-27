# No-Dividend Symbols Management

배당이 없는 종목들을 관리하는 시스템입니다.

## 📋 개요

- **목적**: 배당 데이터가 없는 종목들을 `noDividends` 플래그로 표시하여 배당 업데이트 시 불필요한 API 호출을 줄입니다.
- **대상**: 1년 이상 된 종목 중 배당 이력이 없는 종목
- **자동 체크**: 매주 토요일 자동으로 상태를 확인하여 변경사항을 알립니다.

## 🔧 스크립트

### 1. `mark_all_no_dividends.py`

전체 종목을 스캔하여 배당이 없는 종목에 `noDividends` 플래그를 추가합니다.

```bash
python scripts/data_pipeline/mark_all_no_dividends.py
```

**기능:**

- 1년 이상 된 종목 중 배당 데이터가 없는 종목에 `noDividends: true` 추가
- 배당이 생긴 종목에서는 플래그 자동 제거
- 1년 미만 종목은 제외 (연배당 가능성)

### 2. `check_no_dividend_status.py`

`noDividends` 플래그가 있는 종목들의 현재 배당 상태를 확인합니다.

```bash
python scripts/data_pipeline/check_no_dividend_status.py
```

**기능:**

- `noDividends` 플래그가 있는 모든 종목 체크
- 새로 배당이 생긴 종목 리포트
- GitHub Actions에서 주간 자동 실행

### 3. `mark_no_dividends.py`

특정 리스트의 종목들에 `noDividends` 플래그를 추가합니다.

```bash
python scripts/data_pipeline/mark_no_dividends.py
```

**기능:**

- `failed_symbols_classified.json`의 `no_dividends` 리스트 기반
- 수동으로 분류된 종목들 처리

## 🤖 GitHub Actions

### Weekly No-Dividend Check

- **스케줄**: 매주 토요일 오전 9시 (KST)
- **워크플로우**: `.github/workflows/check-no-dividends.yml`

**동작:**

1. `noDividends` 플래그가 있는 모든 종목 체크
2. 배당이 새로 생긴 종목 발견 시 이슈 자동 생성
3. 체크 결과를 아티팩트로 저장 (30일 보관)

**수동 실행:**
GitHub Actions 탭에서 "Check No-Dividend Symbols" 워크플로우를 수동으로 실행할 수 있습니다.

## 📊 데이터 구조

### nav 파일

```json
{
    "symbol": "0000Y0",
    "koName": "HK 26-12 회사채(AA-이상)액티브",
    "yfSymbol": "0000Y0.KS",
    "noDividends": true
}
```

### 통계 (2025-12-03 기준)

- **전체 종목**: 1,344개
- **noDividends 표시**: 1,193개 (823 + 370)
- **1년 미만 제외**: 151개

## 🔄 워크플로우

### 초기 설정

```bash
# 1. 전체 종목 스캔 및 플래그 추가
python scripts/data_pipeline/mark_all_no_dividends.py
```

### 주간 체크 (자동)

```
매주 토요일 → GitHub Actions 실행 → 변경사항 발견 시 이슈 생성
```

### 업데이트 (수동)

```bash
# 1. 상태 확인
python scripts/data_pipeline/check_no_dividend_status.py

# 2. 변경사항이 있으면 플래그 업데이트
python scripts/data_pipeline/mark_all_no_dividends.py

# 3. 커밋 및 푸시
git add public/nav
git commit -m "Update noDividends flags"
git push
```

## 💡 배당 업데이트 스크립트 통합

`update_dividends.py`는 자동으로 `noDividends` 플래그가 있는 종목을 제외합니다:

```python
# noDividends 플래그가 있는 종목 제외
active_tickers_info = [t for t in active_tickers_info if not t.get("noDividends", False)]
```

**효과:**

- 1,193개 종목 건너뛰기
- API 호출 대폭 감소
- 처리 시간 단축

## 📝 참고사항

1. **1년 기준**: IPO 후 1년이 지나지 않은 종목은 연배당 가능성이 있어 제외됩니다.
2. **자동 제거**: 배당이 생긴 종목은 `mark_all_no_dividends.py` 실행 시 자동으로 플래그가 제거됩니다.
3. **ETF 중심**: 대부분의 `noDividends` 종목은 최근 상장된 ETF입니다.
4. **주간 모니터링**: GitHub Actions가 매주 자동으로 상태를 확인하여 변경사항을 알립니다.
