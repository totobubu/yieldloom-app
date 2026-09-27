# stockMappings 관리 가이드

## 개요

Firebase Firestore `stockMappings` 컬렉션은 `nav.json`의 종목 데이터를 저장하고 관리합니다.

## 컬렉션 구조

### 문서 ID

- **ISIN** (예: `US88160R1014`)

### 필드

```javascript
{
  isin: "US88160R1014",      // ISIN 코드
  symbol: "TSLA",            // 티커 심볼
  koName: "테슬라",           // 한국어 종목명
  longName: "Tesla Inc.",    // 긴 종목명
  enName: "Tesla Inc.",      // 영문 종목명
  market: "NASDAQ",          // 시장
  currency: "USD",           // 통화
  company: "Tesla",          // 회사명
  yfSymbol: "TSLA",          // Yahoo Finance 티커
  ipoDate: "2010-06-29"      // 상장일
}
```

## 동기화 스크립트

### 전체 동기화

`nav.json`의 모든 데이터를 Firebase에 동기화합니다.

```bash
node scripts/mappings/sync-nav-to-firebase.js
```

**결과 예시:**

```
📊 Sync Summary:
   ✅ Total items in nav.json: 3,507
   ✅ Items with ISIN: 3,488
   ✅ Updated in Firebase: 3,488
```

### 개별 종목 동기화

특정 종목만 선택적으로 동기화할 수 있습니다.

```bash
# 단일 종목
node scripts/mappings/sync-nav-to-firebase.js --symbol VOO

# 여러 종목
node scripts/mappings/sync-nav-to-firebase.js --symbol VOO --symbol QQQ --symbol SPY
```

**결과 예시:**

```
🎯 Syncing specific symbols: VOO, QQQ

  ✓ VOO (Vanguard S&P 500 ETF)
  ✓ QQQ (Invesco QQQ Trust)

📊 Sync Summary:
   🎯 Symbols requested: VOO, QQQ
   ✅ Items found: 2
   ✅ Updated in Firebase: 2
```

## 마이그레이션 스크립트

### 1. ISIN 기반 마이그레이션

문서 ID를 `{brokerage}_{stockName}`에서 `{ISIN}`으로 변경합니다.

```bash
node scripts/mappings/migrate-stock-mappings.js
```

### 2. 필드 구조 최적화

불필요한 필드를 제거하고 구조를 최적화합니다.

```bash
node scripts/mappings/optimize-stock-mappings.js
```

## 필드 매핑

| nav.json      | stockMappings | 설명                   |
| ------------- | ------------- | ---------------------- |
| `symbol`      | `symbol`      | 티커 심볼              |
| `koName`      | `koName`      | 한국어 종목명          |
| `longName`    | `longName`    | 긴 종목명              |
| `englishName` | `enName`      | 영문 종목명            |
| `isin`        | `isin`        | ISIN 코드 (문서 ID)    |
| `market`      | `market`      | 시장 (NASDAQ, NYSE 등) |
| `currency`    | `currency`    | 통화 (USD, KRW)        |
| `company`     | `company`     | 회사명                 |
| `yfSymbol`    | `yfSymbol`    | Yahoo Finance 티커     |
| `ipoDate`     | `ipoDate`     | 상장일                 |

## 주의사항

⚠️ **ISIN 필수**: ISIN이 없는 항목은 동기화되지 않습니다.

⚠️ **Merge 방식**: 기존 데이터를 덮어쓰지 않고 병합합니다.

⚠️ **Null 값 제거**: null 값은 자동으로 제거됩니다.

## 유지보수

### GitHub Actions 자동 동기화

워크플로우 실행 시 `public/nav` 디렉토리의 변경사항이 자동으로 감지되어 Firebase에 동기화됩니다.

**동작 방식:**

- `public/nav` 디렉토리의 JSON 파일이 변경되면 자동 감지
- 변경된 파일에 포함된 모든 심볼을 추출
- 해당 심볼만 선택적으로 Firebase에 동기화

**관련 워크플로우:**

- [update_info_data_v2_kr.yml](file:///c:/workspace/toto/.github/workflows/update_info_data_v2_kr.yml)
- [update_info_data_v2_us.yml](file:///c:/workspace/toto/.github/workflows/update_info_data_v2_us.yml)

### nav.json 업데이트 후

```bash
# 전체 재동기화
node scripts/mappings/sync-nav-to-firebase.js

# 또는 변경된 종목만
node scripts/mappings/sync-nav-to-firebase.js --symbol AAPL --symbol MSFT
```

### 새로운 필드 추가

1. `useStockMapping.js`의 `saveStockMapping` 함수 수정
2. `sync-nav-to-firebase.js` 스크립트 수정
3. 재동기화 실행

## 관련 파일

- [useStockMapping.js](file:///c:/workspace/toto/src/composables/useStockMapping.js) - CRUD 작업
- [useAssetAdmin.js](file:///c:/workspace/toto/src/composables/useAssetAdmin.js) - 관리자 기능
- [sync-nav-to-firebase.js](file:///c:/workspace/toto/scripts/mappings/sync-nav-to-firebase.js) - 동기화 스크립트
- [migrate-stock-mappings.js](file:///c:/workspace/toto/scripts/mappings/migrate-stock-mappings.js) - 마이그레이션 스크립트
- [optimize-stock-mappings.js](file:///c:/workspace/toto/scripts/mappings/optimize-stock-mappings.js) - 최적화 스크립트
