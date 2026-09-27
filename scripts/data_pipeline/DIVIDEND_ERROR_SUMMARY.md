# 배당 Amount 오류 분석 요약

**분석 일시**: 2025-12-20 13:25:03

---

## 🎯 핵심 발견사항

### 1. Level 1 오류: 확실한 데이터 오류 (471건)

**주요 특징**:
- `amountFixed` (실제 받은 배당)와 `amount` (YF 데이터)가 **약 10배 또는 4배** 차이
- 대부분 NYSE 상장 ETF (커버드콜 전략 ETF 등)
- Split이 없는 종목에서도 발생 → Yahoo Finance 데이터 품질 문제

**영향 종목 TOP 10**:
1. **ULTY** (47건) - 평균 900% 차이
2. **OARK** (41건) - 평균 400% 차이
3. **TSLY** (41건) - 평균 571% 차이
4. **CONY** (32건) - 평균 901% 차이
5. **AMDY** (29건) - 평균 400% 차이
6. **PYPY** (28건) - 평균 400% 차이
7. **MST** (26건) - 평균 300% 차이
8. **MRNY** (26건) - 평균 900% 차이
9. **XYZY** (26건) - 평균 400% 차이
10. **MSTY** (25건) - 평균 400% 차이

**예시 (MRNY)**:
```
날짜: 2024-01-05
amount: 26.54  ❌ (Yahoo Finance 데이터)
amountFixed: 2.65  ✅ (실제 받은 배당)
차이: 약 10배
```

**원인 분석**:
- Yahoo Finance가 split 조정을 잘못 적용
- 또는 데이터 수집 과정에서 단위 변환 오류
- 커버드콜 ETF 등 특정 종목군에 집중

**조치 방안**:
✅ **자동 수정 가능** - `amount`를 `amountFixed`로 교체

---

### 2. Level 2 오류: Split 조정 의심 (19,639건)

**주요 특징**:
- `amountOriginal`과 split 비율로 계산한 값이 실제 `amount`와 5% 이상 차이
- 매우 큰 split 비율을 가진 종목에서 주로 발생
- Split 데이터 자체가 잘못되었을 가능성

**영향 종목 사례**:

#### AIG (148건)
- Split 비율: **69.52:1** (매우 큰 비율)
- 2008년 금융위기 관련 reverse split
- amountOriginal: 0.01 → Expected: 0.0001 → Actual: 4
- **차이**: 278만% (split 비율 계산 오류 의심)

#### MSI (수백 건)
- Split 비율: **241.34:1** (극단적으로 큰 비율)
- Yahoo Finance split 데이터가 잘못되었을 가능성 높음

#### KOSDAQ 종목 (001440 등)
- 상대적으로 작은 split에서도 오류 발생
- 한국 시장 데이터 품질 문제

**조치 방안**:
⚠️ **수동 확인 필요** - Split 비율이 정확한지 먼저 검증

---

### 3. Level 3 오류: 시계열 이상치 (13,372건)

**주요 특징**:
- 연속 배당 간 50% 이상 급격한 변화
- 정상적인 특별 배당일 수도 있음
- 데이터 손상일 수도 있음

**극단적 사례**:
- **PDBC**: 0.001 → 5.39 (538,900% 증가)
- **EWC**: 0.004 → 5.057 (126,325% 증가)
- **SILJ**: 0.001 → 0.721 (72,000% 증가)

**조치 방안**:
ℹ️ **선택적 수동 확인** - 우선순위 낮음

---

### 4. Level 4 정보: amountFixed 누락 (698건)

**주요 특징**:
- Split 이력은 있지만 실제 받은 배당(`amountFixed`)이 기록되지 않음
- 오류는 아니지만, 향후 데이터 보완 필요

**영향 종목**:
- ADM (26번 split, 171개 배당)
- HBAN, HD, AIG (각 10번 이상 split)
- KOSDAQ 다수 종목

**조치 방안**:
📝 **정보성** - 향후 배당 수령 시 amountFixed 기록

---

## 📊 전체 통계

| 항목 | 수량 |
|------|------|
| 총 분석 파일 | 3,513 |
| 배당 데이터 보유 | 2,789 (79%) |
| Split 이력 보유 | 793 (23%) |
| amountOriginal 보유 | 703 (20%) |
| amountFixed 보유 | 160 (4%) |

## 🚨 오류 요약

| Level | 심각도 | 건수 | 자동 수정 | 우선순위 |
|-------|--------|------|-----------|----------|
| Level 1 | HIGH | 471 | ✅ 가능 | 1순위 |
| Level 2 | MEDIUM | 19,639 | ❌ 불가 | 2순위 |
| Level 3 | LOW | 13,372 | ❌ 불가 | 3순위 |
| Level 4 | INFO | 698 | - | - |

---

## 💡 권장 조치 순서

### 1단계: Level 1 오류 자동 수정 (즉시 실행 가능)

```bash
# 1. Dry-run으로 먼저 확인
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_dividend_errors.py --level1 --dry-run

# 2. 리포트 확인 후 실제 수정
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_dividend_errors.py --level1
```

**효과**: 471건의 확실한 오류 수정, 약 30개 종목 영향

---

### 2단계: Level 2 오류 샘플 수동 확인

**확인할 종목 우선순위**:
1. **AIG**: Split 비율 검증 (69.52:1이 맞는지)
2. **MSI**: Split 비율 검증 (241.34:1이 맞는지)
3. **KOSDAQ 001440**: 한국 시장 데이터 검증

**확인 방법**:
1. 해당 기업의 공식 IR 자료 확인
2. Yahoo Finance 웹사이트에서 직접 확인
3. 다른 금융 데이터 제공업체와 비교 (Bloomberg, Reuters 등)

**조치**:
- Split 비율이 정확하다면: `amount` 재계산
- Split 비율이 틀렸다면: `events.splits` 수정 후 재계산

---

### 3단계: Level 3 오류는 일단 보류

**이유**:
- 대부분 정상적인 특별 배당일 가능성
- 검증 비용 대비 효과가 낮음
- 급하지 않음

---

## 🔍 세부 확인이 필요한 케이스

### Case 1: 커버드콜 ETF 그룹 (Level 1)

**종목**: ULTY, CONY, MRNY, TSLY, OARK, MSTY, PYPY 등

**특징**:
- 모두 900% 또는 400% 차이 (정확히 10배 또는 4배)
- Split 없음에도 불구하고 차이 발생
- 같은 발행사/전략의 ETF들

**가설**:
- Yahoo Finance가 이 ETF 그룹의 배당을 잘못 처리
- 단위 변환 오류 (예: 달러 vs 센트)
- 또는 split 데이터가 기록되지 않음

**조치**:
1. 먼저 자동 수정 실행
2. 한 종목 샘플로 Yahoo Finance와 비교 검증
3. 문제 재발 시 데이터 수집 로직 개선

---

### Case 2: 극단적 Split 비율 (Level 2)

**종목**: AIG, MSI

**특징**:
- 매우 큰 split 비율 (50:1 이상)
- 수백 건의 오류 발생
- 과거 기업 구조조정/위기 관련

**가설**:
- Yahoo Finance가 reverse split을 잘못 기록
- 또는 여러 차례 split이 누적되어 계산 오류

**조치**:
1. SEC 공시 또는 공식 IR 자료로 split 이력 확인
2. Split 데이터 수정
3. 배당 금액 재계산

---

## 📁 생성된 파일

1. **[dividend_errors_report.md](scripts/data_pipeline/dividend_errors_report.md)**
   - 사람이 읽기 좋은 리포트
   - 각 레벨별 오류 목록
   - 상위 50개씩 표시

2. **[dividend_errors_detail.json](scripts/data_pipeline/dividend_errors_detail.json)**
   - 모든 오류의 상세 데이터 (JSON)
   - 프로그래밍 방식으로 처리 가능
   - 필터링/분석용

3. **[DIVIDEND_ERROR_ANALYSIS_README.md](scripts/data_pipeline/DIVIDEND_ERROR_ANALYSIS_README.md)**
   - 사용 가이드
   - 실행 방법
   - 문제 해결

4. **[DIVIDEND_ERROR_SUMMARY.md](scripts/data_pipeline/DIVIDEND_ERROR_SUMMARY.md)** (현재 파일)
   - 핵심 발견사항 요약
   - 권장 조치 방안

---

## 🎬 다음 단계

### 즉시 실행 (Level 1)
```bash
PYTHONIOENCODING=utf-8 python scripts/data_pipeline/fix_dividend_errors.py --level1
```

### 검토 필요 (Level 2)
1. `dividend_errors_report.md`에서 Level 2 오류 확인
2. AIG, MSI, 001440 등 주요 종목의 split 이력 검증
3. 필요 시 `events.splits` 데이터 수동 수정

### 보류 (Level 3, 4)
- Level 3: 특별 배당 등으로 판단, 검증 보류
- Level 4: 정보성, 조치 불필요

---

## ⚠️ 주의사항

1. **Level 1 수정은 안전함**
   - `amountFixed`는 실제 받은 금액이므로 100% 신뢰 가능
   - 자동 백업 생성됨 (`backups/dividend_fixes/`)
   - 문제 시 복원 가능

2. **Level 2는 신중하게**
   - Split 비율 검증 필수
   - 잘못 수정하면 모든 과거 배당 데이터 손상
   - 한 종목씩 테스트 후 진행

3. **백업 확인**
   - 수정 전 항상 백업 존재 확인
   - Git commit 후 수정 권장

---

**분석자**: Claude Code
**검토자**: (사용자가 직접 확인 후 기입)
**승인일**: (확인 후 기입)
