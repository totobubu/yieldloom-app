# 배당 Amount 오류 검출 및 수정 가이드

## 📋 개요

이 문서는 배당 데이터의 `amount` 필드 오류를 검출하고 수정하는 프로세스를 설명합니다.

### 배당 데이터 구조

각 배당 항목은 다음 필드를 가질 수 있습니다:

- **`amount`**: Yahoo Finance에서 가져온 배당 금액 (split 조정됨)
- **`amountFixed`**: 실제 받은 배당 금액 (수동 입력, 가장 신뢰도 높음)
- **`amountOriginal`**: split 이전 원래 amount 값 (백업용)

### 문제점

Yahoo Finance는 주식 split 발생 시 과거 배당 금액을 자동으로 조정합니다. 하지만:
1. 조정이 잘못될 수 있음
2. 최신 데이터 수집 시 이전에 정확했던 값이 변경될 수 있음
3. `amountFixed`가 실제 받은 금액이므로 가장 신뢰할 수 있음

---

## 🔍 검출된 오류 레벨

### Level 1: amountFixed vs amount 불일치 ⚠️ **HIGH PRIORITY**

**검출 수**: 471건

**설명**: `amountFixed` (실제 받은 배당)와 `amount` (YF 데이터)가 다른 경우

**심각도**: 높음 - 확실한 오류

**조치**: `amount`를 `amountFixed` 값으로 교체

**예시**:
```json
{
  "date": "2025-11-20",
  "amount": 0.64,          // ❌ 잘못된 값
  "amountFixed": 0.0635    // ✅ 실제 받은 금액
}
```

**주요 영향 종목**:
- MRNY, CRSH, CONY, FIAT, ULTY, DIPS, AIYY 등 (주로 NYSE 종목)
- 대부분 900% 이상의 차이 (약 10배)

---

### Level 2: Split 조정 오류 ⚠️ **MEDIUM PRIORITY**

**검출 수**: 19,639건

**설명**: `amountOriginal`과 split 비율로 계산한 예상 `amount`가 실제와 5% 이상 차이

**심각도**: 중간 - split 비율이 정확한지 확인 필요

**조치**:
1. Yahoo Finance의 split 데이터 확인
2. 실제 split 비율이 맞다면 `amount` 재계산
3. 불확실하면 수동 확인 필요

**예시**:
```json
{
  "date": "2008-06-04",
  "amount": 4,               // 현재 값
  "amountOriginal": 0.01,    // split 전 원래 값
  "expected": 0.0001         // split 비율로 계산한 예상값
}
// Split ratio: 69.52:1
// Expected: 0.01 / 69.52 = 0.0001
// Actual: 4 (차이 매우 큼!)
```

**주요 영향 종목**:
- AIG (69.52:1 split, 100건 이상)
- MSI (241.34:1 split)
- 001440 (KOSDAQ, 2:1 split)

**주의**: 일부는 Yahoo Finance의 split 데이터 자체가 잘못되었을 수 있음

---

### Level 3: 시계열 이상치 ℹ️ **LOW PRIORITY**

**검출 수**: 13,372건

**설명**: 연속된 배당 간 50% 이상 급격한 변화

**심각도**: 낮음 - 정상적인 배당 변화일 수도 있음

**조치**: 수동 확인 필요 (자동 수정 권장하지 않음)

**예시**:
```json
// 정상 사례: 특별 배당
{
  "date": "2021-12-03",
  "amount": 5.39,        // 특별 배당
  "prev_amount": 0.001   // 일반 배당
}

// 오류 사례: 데이터 손상
{
  "date": "2024-06-11",
  "amount": 0.758,       // 갑자기 급등
  "prev_amount": 0.002
}
```

---

### Level 4: amountFixed 누락 ℹ️ **INFO**

**검출 수**: 698건

**설명**: `amountOriginal`은 있지만 `amountFixed`가 없는 종목

**심각도**: 정보성 - 오류는 아님

**조치**: 향후 실제 배당 수령 시 `amountFixed` 추가

**주요 영향 종목**:
- ADM (26번 split, 171개 배당)
- HBAN, HD, AIG 등 (10번 이상 split)
- KOSDAQ 다수 종목

---

## 🚀 실행 방법

### 1단계: 오류 검출

전체 데이터 분석 및 리포트 생성:

```bash
# Windows
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/analyze_dividend_errors.py

# 생성 파일:
# - scripts/data_pipeline/dividend_errors_report.md (사람이 읽는 리포트)
# - scripts/data_pipeline/dividend_errors_detail.json (상세 JSON 데이터)
```

### 2단계: 리포트 확인

생성된 `dividend_errors_report.md` 파일을 열어서:
- Level 1 오류 목록 확인
- 각 종목별로 어떤 날짜에 문제가 있는지 확인
- 심각도 (HIGH/MEDIUM/LOW) 확인

### 3단계: 오류 수정

#### 3-1. Dry-run으로 먼저 확인

```bash
# 실제 수정하지 않고 시뮬레이션
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_dividend_errors.py --level1 --dry-run

# 생성 파일:
# - scripts/data_pipeline/dividend_fix_report_dryrun.md
```

#### 3-2. Level 1 전체 수정 (권장)

```bash
# Level 1 오류 전체 자동 수정
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_dividend_errors.py --level1

# 주의: 백업이 자동으로 생성됨 (backups/dividend_fixes/)
```

#### 3-3. 특정 종목만 수정

```bash
# AMDU와 MST만 수정
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_dividend_errors.py --level1 --symbols AMDU,MST
```

### 4단계: 결과 확인

1. 수정 리포트 확인: `dividend_fix_report.md`
2. 실제 파일 확인: `public/data/{market}/{symbol}.json`
3. 백업 확인: `backups/dividend_fixes/`

---

## 📊 검출 결과 요약

| Level | 심각도 | 건수 | 조치 |
|-------|--------|------|------|
| Level 1 | HIGH | 471 | 자동 수정 권장 |
| Level 2 | MEDIUM | 19,639 | 수동 확인 필요 |
| Level 3 | LOW | 13,372 | 선택적 수동 확인 |
| Level 4 | INFO | 698 | 조치 불필요 (정보성) |

---

## ⚠️ 주의사항

### Level 1 수정 시

1. **백업 확인**: 수정 전 자동으로 백업이 생성됩니다
2. **amountOriginal 생성**: 기존 `amount`가 `amountOriginal`로 백업됨
3. **되돌리기**: 문제 발생 시 백업에서 복원 가능

### Level 2 수정 시 (현재 미구현)

1. **수동 확인 필수**: Split 비율이 정확한지 먼저 확인
2. **Yahoo Finance 데이터 검증**: 공식 발표와 대조
3. **단계별 수정**: 한 종목씩 신중하게 진행

### Level 3 수정 시 (권장하지 않음)

1. **정상 변화 가능성**: 특별 배당, 증배 등
2. **외부 검증 필요**: 기업 공시 확인
3. **자동 수정 금지**: 반드시 수동으로 확인

---

## 🔧 복원 방법

### 특정 파일 복원

```bash
# 백업 파일 목록 확인
ls backups/dividend_fixes/

# Windows
dir backups\dividend_fixes\

# 파일 복원 (예: AMDU)
cp backups/dividend_fixes/amdu_20251220_132503.json public/data/nasdaq/amdu.json

# Windows
copy backups\dividend_fixes\amdu_20251220_132503.json public\data\nasdaq\amdu.json
```

### 전체 복원

```bash
# 수정 전 전체 백업을 만들었다면
# (현재는 파일별 개별 백업)
```

---

## 📈 향후 개선 사항

1. **Level 2 자동 수정**: Split 비율 검증 후 자동 수정 기능 추가
2. **Level 3 필터링**: 정상 변화 패턴 학습으로 오탐 감소
3. **실시간 검증**: 데이터 수집 시점에 즉시 검증
4. **amountFixed 자동 수집**: 실제 배당 수령 시 자동 기록

---

## 📞 문제 해결

### Q1. 스크립트 실행 시 인코딩 오류

```bash
# Windows에서는 반드시 PYTHONIOENCODING=utf-8 사용
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/analyze_dividend_errors.py
```

### Q2. Level 1 수정 후 문제 발생

```bash
# 백업에서 복원
cp backups/dividend_fixes/[파일명] public/data/[market]/[symbol].json
```

### Q3. 특정 종목만 다시 분석하고 싶을 때

```python
# analyze_dividend_errors.py를 수정하여 특정 심볼만 처리
# 또는 생성된 dividend_errors_detail.json 파일에서 필터링
```

---

## 📝 변경 이력

- **2025-12-20**: 초기 버전 생성
  - Level 1-4 오류 검출 구현
  - Level 1 자동 수정 기능 구현
  - 리포트 생성 기능 구현

---

## 참고

- **검출 스크립트**: `scripts/data_pipeline/analyze_dividend_errors.py`
- **수정 스크립트**: `scripts/data_pipeline/fix_dividend_errors.py`
- **리포트 위치**: `scripts/data_pipeline/dividend_errors_report.md`
- **상세 데이터**: `scripts/data_pipeline/dividend_errors_detail.json`
- **백업 위치**: `backups/dividend_fixes/`
