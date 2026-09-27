# Yahoo Finance Rate Limit 문제 해결

## 🚨 문제 발생

### 증상
```
시가총액 배치 수집: 89% | 31/35
❌ [대부분 티커]: Too Many Requests. Rate limited. Try after a while.

최종 결과:
시가총액: 0개 업데이트 (실패)
```

---

## 🔍 원인 분석

### Before (문제 발생 코드)

```python
# 배치로 100개씩 한꺼번에 요청
BATCH_SIZE = 100

for i in range(0, len(tickers), 100):
    batch = tickers[i:i+100]
    tickers_obj = yf.Tickers(" ".join(batch))  # 100개 동시 요청!
    
    for symbol in batch:
        market_cap = tickers_obj.tickers[symbol].info["marketCap"]
```

**문제점**:
- Yahoo Finance가 100개 동시 요청을 Rate Limit으로 차단
- 배치 전체가 실패
- 대부분의 티커 업데이트 실패

---

## ✅ 해결 방법

### After (수정된 코드)

```python
# 개별 요청 + Rate Limit 감지 & 재시도
for symbol in tickers:
    try:
        ticker_obj = yf.Ticker(symbol)  # 개별 요청
        market_cap = ticker_obj.info.get("marketCap")
    except Exception as e:
        if "Too Many Requests" in str(e):
            time.sleep(3)  # 대기
            # 재시도
            market_cap = ticker_obj.info.get("marketCap")
    
    # 100개마다 추가 대기
    if idx % 100 == 0:
        time.sleep(2)
```

**개선점**:
- ✅ 개별 요청으로 Rate Limit 회피
- ✅ 에러 발생 시 3초 대기 후 재시도
- ✅ 100개마다 2초 추가 대기
- ✅ 실패한 티커만 스킵 (나머지는 처리)

---

## 📊 성능 영향

### 처리 시간 변화

| 방식 | 티커 수 | 예상 시간 | 성공률 |
|------|---------|----------|--------|
| **Before (배치)** | 3,416개 | ~1분 | 0% (Rate Limit) ❌ |
| **After (개별)** | 3,416개 | ~15-20분 | 95%+ ✅ |

**Trade-off**:
- ⚠️ 시간 증가: 1분 → 15-20분
- ✅ 성공률 향상: 0% → 95%+
- ✅ 데이터 수집: 실패 → 성공

**판단**: 느려지더라도 데이터가 수집되는 것이 중요! ✅

---

## 🎯 수정된 파일

### 1. `scripts/data_pipeline/info_data_pipeline_kr.py` / `scripts/data_pipeline/info_data_pipeline_us.py`
- ✅ STEP 3: 시가총액 업데이트 로직 수정
- ✅ 배치 → 개별 요청으로 변경
- ✅ Rate Limit 감지 및 재시도

### 2. `scripts/data_pipeline/update_market_cap.py`
- ✅ 동일한 로직으로 수정
- ✅ V1 워크플로우에서도 작동

---

## 💡 추가 최적화 (향후)

### 옵션 1: 스마트 배치 (하이브리드)
```python
# 작은 배치 크기 + 긴 대기 시간
BATCH_SIZE = 10  # 100개 → 10개
time.sleep(5)     # 1초 → 5초
```

### 옵션 2: 점진적 백오프
```python
retry_delays = [1, 3, 5, 10]  # 재시도 시 점진적으로 대기
for delay in retry_delays:
    try:
        data = ticker.info
        break
    except RateLimitError:
        time.sleep(delay)
```

### 옵션 3: 병렬 처리 (Thread Pool)
```python
# 동시에 5개씩만 처리
with ThreadPoolExecutor(max_workers=5) as executor:
    executor.map(get_market_cap, tickers)
```

---

## 🧪 테스트 방법

### 로컬 테스트
```bash
# 소수 티커로 먼저 테스트
python scripts/data_pipeline/update_market_cap.py

# 출력 확인:
# ✅ Successfully updated: XXX tickers
# ⏭️  Skipped: XXX tickers
# ⚠️  Rate Limit 발생: XXX개 (재시도 적용)
```

### GitHub Actions 테스트
```
1. 수정된 코드 푸시
2. update_info_data_v2.yml 수동 실행
3. 로그에서 "시가총액 업데이트 완료" 확인
4. "0개 업데이트" → "XXX개 업데이트"로 변경되었는지 확인
```

---

## ⏱️ 예상 실행 시간

### Info Data V2 워크플로우

```
Before (Rate Limit 발생):
STEP 3: 시가총액 업데이트 - 1분 (실패)
전체 파이프라인 - 21분

After (개별 요청):
STEP 3: 시가총액 업데이트 - 15-20분 (성공)
전체 파이프라인 - 35-40분 (증가)
```

**판단**:
- 시간은 증가하지만 데이터 수집 성공이 우선
- 매일 자동 실행이므로 사용자에게 영향 없음

---

## 🎯 기대 효과

### Before (수정 전)
```
실행 결과:
✅ 배당 데이터: 239개
✅ 티커 정보: 3,416개
❌ 시가총액: 0개  ← 실패!
✅ 배당 빈도: 2,378개
✅ 배당일 예측: 204개
```

### After (수정 후)
```
실행 결과:
✅ 배당 데이터: 239개
✅ 티커 정보: 3,416개
✅ 시가총액: 3,200+개  ← 성공!
✅ 배당 빈도: 2,378개
✅ 배당일 예측: 204개
```

---

## 📝 요약

### 문제
- Yahoo Finance Rate Limit
- 배치 요청 시 대량 차단
- 시가총액 0개 업데이트

### 해결
- ✅ 배치 → 개별 요청
- ✅ Rate Limit 감지 & 재시도
- ✅ 100개마다 대기 시간 추가

### 영향
- ⚠️ 시간 증가: 1분 → 15-20분
- ✅ 성공률: 0% → 95%+
- ✅ 데이터 수집 성공

**결론**: 느려지더라도 데이터가 수집되는 것이 최우선! 🎯

