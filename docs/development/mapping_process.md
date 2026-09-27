# 종목명 매핑 프로세스 가이드

이 문서는 사용자로부터 종목명(koName) 승인 요청을 받고, 이를 시스템에 반영하여 로컬 데이터 파일까지 업데이트하는 전체 프로세스를 설명합니다.

## 1. 승인 요청 및 처리 (Admin Page)

사용자가 자산을 등록할 때, 시스템에 존재하지 않는 종목명인 경우 승인 요청이 생성됩니다. 관리자는 Admin 페이지에서 이를 승인하거나 거부할 수 있습니다.

### 1.1 승인 대기 목록 확인

- **경로**: `/admin` (AdminView)
- **기능**: 승인 대기 중인 항목(`pending`)을 조회합니다.

### 1.2 승인 (Approve)

- **동작**:
    1. `[승인]` 버튼 클릭.
    2. 해당 자산(`assets` 컬렉션)의 상태가 `approved`로 변경됩니다.
    3. 동시에 `stockMappings` 컬렉션에 매핑 정보가 저장됩니다.
        - 저장 정보: `brokerage`, `brokerageStockName` (koName), `brokerageTicker` (ISIN), `systemTicker` (Symbol).

### 1.3 매핑 동기화 (Sync Mappings)

- **목적**: 과거에 승인되었으나 `stockMappings` 컬렉션에 누락된 데이터를 복구합니다.
- **방법**: `[매핑 동기화]` 버튼 클릭.
- **동작**: `assets` 컬렉션에서 `approved` 상태인 항목을 모두 조회하여 `stockMappings`에 없는 경우 추가합니다.

## 2. 매핑 데이터 내보내기 (Export)

로컬 시스템의 데이터(`public/nav/**/*.json`)를 업데이트하기 위해 매핑 데이터를 추출합니다.

### 2.1 내보내기 실행

- **방법**: `[매핑 데이터 내보내기]` 버튼 클릭.
- **스마트 필터링**:
    - 시스템은 로컬의 JSON 파일들을 모두 스캔합니다.
    - 이미 로컬 파일에 `symbol`, `isin`, `koName`이 정확하게 일치하는 항목은 **제외**합니다.
    - 업데이트가 필요하거나 신규 추가가 필요한 항목만 `mappings.json`으로 다운로드됩니다.

## 3. 로컬 데이터 업데이트 (Script)

다운로드한 `mappings.json`을 사용하여 프로젝트 내의 정적 데이터 파일들을 일괄 업데이트합니다.

### 3.1 스크립트 위치

- `scripts/mappings/update_mappings.js`

### 3.2 실행 방법

터미널에서 프로젝트 루트 경로로 이동한 후 다음 명령어를 실행합니다.

```bash
node scripts/mappings/update_mappings.js public/mappings.json
```

**예시:**

```bash
node scripts/mappings/update_mappings.js "C:\Users\stead\Downloads\mappings.json"
```

### 3.3 스크립트 동작 원리

1. `mappings.json`을 읽어들입니다.
2. 각 항목의 `symbol`을 기반으로 대상 파일(`public/nav/{market}/{char}.json`)을 찾습니다.
3. **기존 항목이 있는 경우**: `koName`과 `isin`을 업데이트합니다.
4. **신규 항목인 경우**: 새로운 객체를 생성하여 파일에 추가합니다.
5. 변경된 파일만 저장합니다.

## 4. 배포 (Deploy)

로컬 데이터 파일(`public/nav/**/*.json`)이 업데이트되었으므로, 변경 사항을 Git에 커밋하고 배포하여 실제 서비스에 반영합니다.

```bash
git add public/nav
git commit -m "Update stock mappings and koNames"
git push
```
