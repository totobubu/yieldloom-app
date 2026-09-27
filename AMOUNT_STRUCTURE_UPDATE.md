# Amount 필드 구조 업데이트 완료

## 📋 개요

배당금 데이터 구조가 업그레이드되어 split 히스토리를 더 명확하게 관리할 수 있게 되었습니다.

## 🔄 변경된 데이터 구조

### 이전 (V1)
```json
{
  "date": "2023-01-10",
  "amount": {
    "2024-02-26": 4.993
  },
  "amountFixed": 0.9986,
  "amountOriginal": 0.4993
}
```

### 현재 (V2)
```json
{
  "date": "2023-01-10",
  "amount": 9.986,  // 최신 split 기준 최종 값 (숫자)
  "amountFixed": 0.9986,  // 실제 받은 금액 (변경 없음)
  "amountOriginal": 0.4993,  // YF 원본 값 (변경 없음)
  "amountSplitAdjustments": [
    {
      "date": "2024-02-26",
      "ratio": "1:2",
      "factor": 0.5,
      "amountAfterSplit": 1.9972
    },
    {
      "date": "2025-12-01",
      "ratio": "1:5",
      "factor": 0.2,
      "amountAfterSplit": 9.986
    }
  ]
}
```

## 📊 필드 설명

| 필드 | 타입 | 설명 | 용도 |
|------|------|------|------|
| `amount` | `number` | 최신 split 기준 최종 조정값 | 차트 계산, split 반영 비교 |
| `amountFixed` | `number` | 실제 받은 배당금 | **주요 표시 값**, 사용자에게 보여줄 금액 |
| `amountOriginal` | `number` | Yahoo Finance 원본 값 | 백업, 참고용 |
| `amountSplitAdjustments` | `SplitAdjustment[]` | Split 히스토리 | 각 split 시점의 금액 추적 |

### SplitAdjustment 타입
```typescript
interface SplitAdjustment {
  date: string;           // Split 발생일
  ratio: string;          // Split 비율 (예: "1:5")
  factor: number;         // Split factor (예: 0.2)
  amountAfterSplit: number;  // 해당 split 후 배당금액
}
```

## 🎯 사용 패턴

### 1. 기본 표시 (실제 받은 금액)
```typescript
const displayAmount = item.amountFixed ?? item.amount;
```

### 2. Split 조정값 비교
```typescript
if (item.amountSplitAdjustments && item.amountSplitAdjustments.length > 0) {
  const actualReceived = item.amountFixed;
  const splitAdjusted = item.amount;
  const multiplier = splitAdjusted / actualReceived;
  console.log(`실제: $${actualReceived}, 조정: $${splitAdjusted} (${multiplier}x)`);
}
```

### 3. Split 히스토리 확인
```typescript
item.amountSplitAdjustments?.forEach(adj => {
  console.log(`${adj.date}: ${adj.ratio} split → $${adj.amountAfterSplit}`);
});
```

## ✅ 업데이트된 파일 목록

### 타입 정의
- ✅ `src/composables/data/useStockData.ts` - `SplitAdjustment`, `DividendHistoryItem` 타입 추가

### 핵심 로직
- ✅ `src/composables/data/useStockData.ts` - 배당금 표시 로직 업데이트
- ✅ `src/composables/data/useBacktestData.ts` - 백테스팅 로직 문서화

### 차트 Composables
- ✅ `src/composables/ui/charts/useAnnualChart.ts` - 연간 차트
- ✅ `src/composables/ui/charts/useMonthlyChart.ts` - 월간 차트
- ✅ `src/composables/ui/charts/useQuarterlyChart.ts` - 분기 차트
- ✅ `src/composables/ui/charts/useWeeklyChart.ts` - 주간 차트

### Vue 컴포넌트
- ✅ `src/components/StockHistoryPanel.vue` - 배당 히스토리 패널
- ✅ `src/components/thumbnail/ThumbnailItem.vue` - 썸네일 아이템
- ✅ `src/pages/ThumbnailGenerator.vue` - 썸네일 생성기

### 유틸리티
- ✅ `src/utils/dividendParser.js` - Deprecated 표시 추가

## 🔍 주요 변경 사항

### 1. useStockData.ts
**변경 전:**
```typescript
let 배당금값 = item.amountOriginal ?? item.amountFixed ?? item.amount;
```

**변경 후:**
```typescript
const actualReceived = item.amountFixed;
const splitAdjusted = item.amount;
const adjustments = item.amountSplitAdjustments;

if (adjustments && adjustments.length > 0) {
  const totalFactor = adjustments.reduce((acc, adj) => acc * adj.factor, 1);
  const multiplier = totalFactor === 0 ? 0 : 1 / totalFactor;
  배당금값 = `${currencySymbol}${actualReceived.toLocaleString()} (${multiplier.toFixed(1)}x = ${currencySymbol}${splitAdjusted.toLocaleString()})`;
} else {
  배당금값 = actualReceived ?? splitAdjusted;
}
```

### 2. 차트 Composables
**공통 패턴:**
```typescript
// 표시용 금액 (amountFixed 우선)
const displayAmount = item.amountFixed ?? item.amount;

// Split 조정값 (툴팁용)
const splitAdjusted = item.amount;
const hasSplits = item.amountSplitAdjustments?.length > 0;

// 툴팁에 split 정보 표시
if (hasSplits && splitAdjusted !== displayAmount) {
  const multiplier = (splitAdjusted / displayAmount).toFixed(1);
  tooltip += `<br/>Split 조정: ${formatCurrency(splitAdjusted)} (${multiplier}x)`;
}
```

## 📈 마이그레이션 통계

### 데이터 마이그레이션
- **처리된 파일:** 3,513개
- **Split 있는 파일:** 911개
- **마이그레이션된 배당:** 37,954개
- **생성된 Adjustment:** 77,955개
- **검증 결과:** ✅ 모든 검증 통과

### 가장 많은 Split
1. **ADM** - 26번의 split (1980년대부터)
2. **006730 (KOSDAQ)** - 16번의 split
3. **008930 (KOSDAQ)** - 16번의 split

## 🔗 관련 문서

- [마이그레이션 가이드](scripts/data_pipeline/AMOUNT_MIGRATION_GUIDE.md)
- [구조 재설계 문서](scripts/data_pipeline/DIVIDEND_AMOUNT_RESTRUCTURE.md)
- [검증 리포트](scripts/data_pipeline/amount_v2_verification_report.json)

## 💾 백업

모든 변경 전 데이터는 백업되어 있습니다:
- **데이터 백업:** `backups/before_amount_migration_20251223/`
- **마이그레이션 백업:** `backups/amount_migration_v2/20251223_113540/`

## ⚡ 성능 영향

- **긍정적 영향:**
  - 문자열 파싱 제거로 렌더링 속도 향상
  - 명확한 타입으로 TypeScript 지원 개선
  - Split 히스토리 추적 간소화

- **주의사항:**
  - 기존 로직에서 `amountOriginal` 우선순위를 사용하던 부분 → `amountFixed` 우선순위로 변경
  - 문자열 기반 배당금 파싱 제거 (backward compatibility 유지)

## 🎉 결론

이번 업데이트로 인해:
1. ✅ Split 히스토리가 명확하게 관리됩니다
2. ✅ 실제 받은 금액과 조정값을 명확히 구분합니다
3. ✅ 타입 안정성이 향상되었습니다
4. ✅ 3회 이상의 복잡한 split도 정확히 추적됩니다
5. ✅ 차트와 UI에서 일관된 금액 표시가 가능합니다

---

**마지막 업데이트:** 2025-12-23
**버전:** V2
