# Asset Symbol Migration Script

Firebase의 `userAssets` 컬렉션에서 잘못된 symbol을 수정하는 마이그레이션 스크립트입니다.

## 개요

이 스크립트는 `public/sidebar-tickers.json` 파일을 기준으로 Firebase에 저장된 자산의 symbol 필드를 검증하고 수정합니다.

## 사전 준비

1. **Firebase Service Account Key 설정**
    - Firebase Console에서 서비스 계정 키를 다운로드합니다.
    - 프로젝트 루트에 `serviceAccountKey.json` 파일로 저장합니다.
    - **중요**: 이 파일은 `.gitignore`에 포함되어 있어야 합니다.

2. **의존성 설치**
    ```bash
    npm install
    ```

## 사용법

### 1. Dry Run (미리보기)

실제 변경 없이 어떤 항목이 수정될지 확인합니다:

```bash
node scripts/migration/fix-asset-symbols.js
```

### 2. 실제 마이그레이션 실행

```bash
node scripts/migration/fix-asset-symbols.js --write
```

## 작동 방식

1. `public/sidebar-tickers.json`에서 ISIN → Symbol 매핑을 로드합니다.
2. Firebase의 모든 사용자를 순회합니다.
3. 각 사용자의 자산(`userAssets/{userId}/assets/{isin}`)을 확인합니다.
4. 자산의 ISIN과 현재 symbol을 비교합니다.
5. symbol이 올바르지 않으면 수정합니다.

## 출력 예시

```
🔍 자산 Symbol 마이그레이션 시작...
모드: 🔍 DRY RUN (실제 변경 없음)

👥 총 5명의 사용자 발견

📂 사용자: abc123def456
   자산 개수: 12
   🔧 [US0378331005] Symbol 수정 필요:
      현재: AAPL
      수정: AAPL
      ISIN: US0378331005
   🔧 [US88160R1014] Symbol 수정 필요:
      현재: TSLA
      수정: TSLA
      ISIN: US88160R1014

============================================================
📊 마이그레이션 결과 요약
============================================================
총 사용자 수: 5
총 자산 수: 45
수정된 자산: 3
오류/스킵: 2
============================================================

💡 실제로 변경하려면 --write 옵션을 사용하세요:
   node scripts/migration/fix-asset-symbols.js --write
```

## 주의사항

- **백업**: 마이그레이션 전에 Firebase 데이터를 백업하는 것을 권장합니다.
- **Dry Run 먼저**: 항상 dry run을 먼저 실행하여 변경 내용을 확인하세요.
- **서비스 계정 키**: `serviceAccountKey.json` 파일이 안전하게 관리되는지 확인하세요.

## 자산 등록 시 올바른 Symbol 사용

이제 자산을 등록할 때 `sidebar-tickers.json`의 `symbol` 필드를 우선적으로 사용하도록 수정되었습니다.

### 변경 사항

**src/pages/AssetView.vue** - `handleMappingComplete` 함수:

```javascript
// 이전
symbol = mapping.systemTicker || mapping.symbol;

// 변경 후
symbol = mapping.symbol || mapping.systemTicker;
```

이제 새로운 자산을 등록할 때 자동으로 올바른 symbol이 저장됩니다.

## 트러블슈팅

### "serviceAccountKey.json 파일을 찾을 수 없습니다"

- 프로젝트 루트에 `serviceAccountKey.json` 파일이 있는지 확인하세요.
- 파일 경로가 올바른지 확인하세요.

### "ISIN에 대한 매핑 없음"

- `sidebar-tickers.json`에 해당 ISIN이 없는 경우입니다.
- 필요한 경우 `sidebar-tickers.json`에 항목을 추가하세요.

### 권한 오류

- Firebase 서비스 계정에 Firestore 읽기/쓰기 권한이 있는지 확인하세요.
