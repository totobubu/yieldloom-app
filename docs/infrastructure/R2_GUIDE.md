# R2 (Cloudflare) 업로드 가이드

## 📋 목차

1. [개요](#개요)
2. [스크립트 종류](#스크립트-종류)
3. [최적화 설명](#최적화-설명)
4. [수동 업로드 워크플로우](#수동-업로드-워크플로우)
5. [사용 예시](#사용-예시)

---

## 📊 개요

R2(Cloudflare R2)는 데이터 파일을 빠르게 제공하기 위한 클라우드 스토리지입니다.

### 왜 R2를 사용하나요?

- ⚡ **빠른 로딩**: GitHub보다 10배 빠른 데이터 로드
- 🌍 **글로벌 CDN**: 전 세계 어디서나 빠른 접근
- 💰 **무료**: Cloudflare R2는 egress 무료

---

## 📦 스크립트 종류

### 1. `upload_changed_to_r2.py` (⭐ 기본 사용)

**Git 변경사항 기반 빠른 업로드**

```bash
python scripts/cloud/upload_changed_to_r2.py
```

**특징**:

- ⚡ **매우 빠름** (10-30초)
- Git에서 변경된 파일만 업로드
- R2 API 호출 최소화
- MD5 해시 계산 불필요

**언제 사용**:

- ✅ 일반적인 모든 경우 (99%)
- ✅ GitHub Actions 워크플로우
- ✅ 로컬에서 스크립트 실행 후 업로드

**작동 방식**:

```python
# 1. Git에서 변경된 파일만 찾기
changed_files = git status --porcelain

# 2. public/ 폴더 필터링
upload_targets = filter_public_files(changed_files)

# 3. 바로 업로드
for file in upload_targets:
    upload_to_r2(file)
```

---

### 2. `upload_full_sync_to_r2.py` (🔧 전체/부분 동기화)

**R2 전체 또는 선택 영역 동기화 및 검증**

```bash
# 전체 비교 (기본)
python scripts/cloud/upload_full_sync_to_r2.py

# logos 폴더만 비교/업로드
python scripts/cloud/upload_full_sync_to_r2.py --target logos

# 여러 영역 동시 지정
python scripts/cloud/upload_full_sync_to_r2.py --target logos --target sidebar
```

**특징**:

- 🐌 **느림** (3-15분) — 전체 대상일 때
- 🎯 **선택 동기화 지원**: `--target` 인자를 이용해 `data`, `nav`, `sidebar`, `calendar`, `logos` 중 필요한 영역만 검사/업로드
- R2의 대상 파일들과 비교
- 대상 파일의 MD5 해시 계산
- 누락/변경된 파일 자동 감지 후 업로드

**언제 사용**:

- 🆕 초기 전체 업로드 (`--target` 생략 또는 `--target all`)
- 🔄 R2-로컬 동기화 검증 (필요한 영역만 골라서 빠르게 수행 가능)
- 🚨 R2 파일 누락 의심 시 특정 영역 점검 (`--target logos` 등)
- 🔧 Git 히스토리 없는 환경

---

### 3. `upload_specific_to_r2.py` (🎯 특정 파일)

**원하는 파일만 선택 업로드**

```bash
# 단일 파일
python scripts/cloud/upload_specific_to_r2.py public/nav.json

# 여러 파일
python scripts/cloud/upload_specific_to_r2.py public/nav.json public/data/aapl.json

# Glob 패턴
python scripts/cloud/upload_specific_to_r2.py "public/data/0*.json"
```

**특징**:

- ⚡ **매우 빠름** (5-10초)
- 원하는 파일만 지정
- Glob 패턴 지원

**언제 사용**:

- 📄 nav.json만 업데이트
- 📊 특정 티커만 업데이트
- 🎨 로고 파일만 업데이트

---

### 4. `cleanup_r2.py` (🧹 R2 불필요 파일 정리 - 통합)

**R2에서 로컬에 없는 파일 삭제 (logos 또는 data)**

```bash
# logos 폴더 삭제 대상 미리보기 (기본: dry-run)
python scripts/cloud/cleanup_r2.py --target logos

# data 폴더 전체 삭제 대상 미리보기
python scripts/cloud/cleanup_r2.py --target data

# 특정 market만 정리 (예: kosdaq)
python scripts/cloud/cleanup_r2.py --target data --market kosdaq

# 실제 삭제 수행 (--apply 필수)
python scripts/cloud/cleanup_r2.py --target logos --apply
python scripts/cloud/cleanup_r2.py --target data --apply

# 특정 market만 실제 삭제
python scripts/cloud/cleanup_r2.py --target data --market kosdaq --apply
```

**특징**:

- 🔍 로컬과 R2를 비교해 orphan 파일 목록 생성
- 🎯 `--target` 옵션으로 `logos` 또는 `data` 선택
- 🎯 `--market` 옵션으로 data 타겟일 때 특정 market만 선택 정리 가능 (kosdaq, kospi, nasdaq, nyse 등)
- 🛡️ 기본은 dry-run으로 단순 보고만 수행 (최대 20개까지 목록 표시)
- 🗑️ `--apply` 옵션을 주면 R2에서만 존재하는 파일을 일괄 삭제
- ⚠️ 실제 삭제 전에 확인 메시지 표시

**언제 사용**:

- **logos**: R2에 오래된 로고가 쌓여 용량이 낭비될 때
- **data**: 파일명 마이그레이션 후 (예: `473330-kq.json` → `473330.json`) 기존 파일이 R2에 남아있을 때
- 로컬에서 파일을 정리한 뒤 R2도 동일하게 정리하고 싶을 때
- 특정 market의 불필요한 파일만 선택적으로 정리하고 싶을 때
- 전체 동기화 후에도 R2 파일 수가 더 많은 경우

---

## ⚡ 최적화 설명

### Before (느림 🐌)

```python
# 1. R2의 모든 파일 목록 가져오기 (API 호출)
r2_files = get_r2_files()  # 느림!

# 2. 로컬의 모든 파일 스캔
local_files = get_local_files("public/data")

# 3. 1500개 파일 × MD5 해시 계산
for file in local_files:
    calculate_md5_hash(file)  # 매우 느림!

# 4. 해시 비교 후 업로드
for file in local_files:
    if local_hash != r2_hash:
        upload(file)

⏱️  소요 시간: 3-5분 😱
```

### After (빠름 🚀)

```python
# 1. Git에서 변경된 파일만 가져오기
changed_files = git status --porcelain  # 즉시!

# 2. public/ 폴더 필터링
upload_targets = filter_public_files(changed_files)

# 3. 바로 업로드
for file in upload_targets:
    upload(file)

⏱️  소요 시간: 10-30초 🚀
```

### 성능 비교

| 상황            | Before | After | 개선율     |
| --------------- | ------ | ----- | ---------- |
| **변경 없음**   | ~30초  | ~1초  | **97%** ⚡ |
| **50개 변경**   | ~3분   | ~15초 | **92%** ⚡ |
| **500개 변경**  | ~4분   | ~2분  | **50%** ⚡ |
| **1500개 전체** | ~15분  | ~10분 | **33%** ⚡ |

---

## 🎯 수동 업로드 워크플로우

GitHub Actions에서 수동으로 R2 업로드 가능 (3가지 모드):

### 실행 방법

1. **GitHub 저장소** → **Actions** 탭
2. 왼쪽에서 **"Manual Upload to R2"** 선택
3. **"Run workflow"** 버튼 클릭
4. **모드 선택**

---

### 모드 1: Changed Files ⚡ (기본값)

```yaml
업로드 모드: changed
특정 파일: (비워둠)
```

**특징**:

- Git 변경사항만 업로드
- ⏱️ 10-30초
- 💡 99%의 경우 이것만 사용

---

### 모드 2: Full Sync 🔧

```yaml
업로드 모드: full_sync
특정 파일: (비워둠)
```

**특징**:

- R2와 로컬 전체 비교
- ⏱️ 3-15분
- 💡 초기 설정, R2 검증 시에만

---

### 모드 3: Specific Files 🎯

```yaml
업로드 모드: specific
특정 파일: public/nav.json public/data/aapl.json
```

**특징**:

- 원하는 파일만 선택
- ⏱️ 5-10초
- 💡 개별 파일 수정 시

**예시**:

```
# nav.json만
특정 파일: public/nav.json

# 여러 파일
특정 파일: public/nav.json public/calendar-events.json

# 특정 티커들
특정 파일: public/data/aapl.json public/data/tsla.json

# 사이드바 파일들
특정 파일: public/sidebar/sidebar-tickers-us-etfs.json
```

---

## 💡 사용 예시

### 시나리오 1: 일반 데이터 업데이트

```bash
# 1. 데이터 업데이트
python scripts/data_pipeline/update_dividends.py

# 2. R2 업로드
python scripts/cloud/upload_changed_to_r2.py  # ⚡ 빠름!

# 3. 커밋
git add .
git commit -m "Update dividends"
```

**예상 시간**: ~30초

---

### 시나리오 2: 프로젝트 초기 설정

```bash
# 1. 저장소 클론
git clone https://github.com/user/repo.git

# 2. 데이터 생성
npm run generate-nav
# 데이터 업데이트는 각 워크플로우에서 처리됩니다

# 3. R2 전체 동기화
python scripts/cloud/upload_full_sync_to_r2.py  # 🐌 초기만

# 4. 이후부터는 빠른 방식
python scripts/cloud/upload_changed_to_r2.py  # ⚡ 항상
```

---

### 시나리오 3: nav.json만 업데이트

```bash
# 수정
vi public/nav.json

# GitHub Actions에서:
# 모드: specific
# 파일: public/nav.json

# 또는 로컬에서:
python scripts/cloud/upload_specific_to_r2.py public/nav.json
```

**예상 시간**: ~3초

---

### 시나리오 4: R2 검증

```bash
# R2에 파일이 제대로 있는지 확인 (전체)
python scripts/cloud/upload_full_sync_to_r2.py

# logos 폴더만 빠르게 검증/업로드
python scripts/cloud/upload_full_sync_to_r2.py --target logos

# 출력:
# [INFO] 누락된 파일: 0개
# [INFO] 변경된 파일: 0개
# [OK] 모든 파일이 동기화되었습니다!
```

---

## 🔧 자동 실행 (워크플로우)

### Info Data & Market Data 워크플로우

```yaml
# 모든 워크플로우에서 자동 사용
- name: Upload changed files to R2
  run: python scripts/cloud/upload_changed_to_r2.py
```

**적용된 워크플로우**:

- ✅ `update_info_data_v2.yml`
- ✅ `market_data_v2_kr.yml`
- ✅ `market_data_v2_us.yml`

### Deploy 워크플로우

```yaml
# main 브랜치 push 시 자동 실행
- name: Upload changed data files to R2
  run: python scripts/cloud/upload_changed_to_r2.py
```

**특징**:

- main 브랜치에 push → 자동으로 R2 업로드
- Vue 빌드 전에 실행
- 실패해도 배포는 계속

---

## 🎯 스크립트 선택 가이드

| 상황            | 사용할 스크립트             | 예상 시간 |
| --------------- | --------------------------- | --------- |
| **일반 업로드** | `upload_changed_to_r2.py`   | 15초 ⚡   |
| **초기 설정**   | `upload_full_sync_to_r2.py` | 10분 🔧   |
| **nav.json만**  | `upload_specific_to_r2.py`  | 3초 🎯    |
| **R2 검증**     | `upload_full_sync_to_r2.py` | 5분 🔍    |
| **파일 정리**   | `cleanup_r2.py`             | 1~3분 🧹  |
| **워크플로우**  | `upload_changed_to_r2.py`   | 자동 ✅   |

**기억**: 99%의 경우 `upload_changed_to_r2.py`만 사용! 🚀

---

## 🚨 문제 해결

### Q: "Git이 설치되어 있지 않습니다" 오류

```bash
# upload_changed_to_r2.py는 Git 필요
# 해결: full_sync 사용
python scripts/cloud/upload_full_sync_to_r2.py
```

### Q: 파일이 변경되었는데 업로드 안 됨

```bash
# Git이 변경사항을 추적하는지 확인
git status

# 추적되지 않은 파일이면 먼저 add
git add public/data/new-file.json

# 그 후 업로드
python scripts/cloud/upload_changed_to_r2.py
```

### Q: R2에서 파일이 누락된 것 같음

```bash
# 전체 동기화로 검증 및 복구
python scripts/cloud/upload_full_sync_to_r2.py
```

### Q: 너무 오래 걸림

```bash
# upload_changed_to_r2.py 사용 중인지 확인

# Before (느림)
python scripts/cloud/upload_full_sync_to_r2.py

# After (빠름)
python scripts/cloud/upload_changed_to_r2.py
```

---

## 📊 테스트 가이드

### 로컬 테스트

```bash
# 1. 환경변수 설정
export R2_ACCOUNT_ID=your_account_id
export R2_ACCESS_KEY_ID=your_access_key
export R2_SECRET_ACCESS_KEY=your_secret
export R2_BUCKET_NAME=your_bucket
export R2_PUBLIC_URL=https://your-domain.com

# 2. 테스트 실행
python scripts/cloud/upload_changed_to_r2.py

# 3. 결과 확인
# https://your-domain.com/nav.json
```

### GitHub Actions 테스트

```
1. Actions 탭 이동
2. "Manual Upload to R2" 선택
3. "Run workflow" 클릭
4. 모드 선택 (changed/full_sync/specific)
5. 실행 및 로그 확인
```

---

## 🎯 월간 절약 효과

### 일반적 사용 케이스 (50개 파일)

```
Before: 3-5분 × 2회/일 × 30일 = 3-5시간/월
After:  15초 × 2회/일 × 30일 = 15분/월

절약: 약 4.5시간/월 🎉
```

---

## 📝 요약

### 기본 사용

```bash
# 일반적으로 (99%)
python scripts/cloud/upload_changed_to_r2.py  # ⚡ 빠름!
```

### 특수 상황

```bash
# 초기 설정 (1회)
python scripts/cloud/upload_full_sync_to_r2.py  # 🔧 전체 동기화

# logos 등 일부 영역만 재검증/업로드
python scripts/cloud/upload_full_sync_to_r2.py --target logos  # 🎯 부분 동기화

# R2에만 남은 파일 삭제 (dry-run)
python scripts/cloud/cleanup_r2.py --target logos  # 🧹 로고 삭제 전 검토
python scripts/cloud/cleanup_r2.py --target data  # 🧹 데이터 삭제 전 검토

# 실제 삭제
python scripts/cloud/cleanup_r2.py --target logos --apply
python scripts/cloud/cleanup_r2.py --target data --apply

# 특정 market만 정리 (예: kosdaq)
python scripts/cloud/cleanup_r2.py --target data --market kosdaq --apply

# 특정 파일만
python scripts/cloud/upload_specific_to_r2.py public/nav.json  # 🎯 개별
```

### 자동화

```yaml
# 워크플로우에서 자동 실행
# - update_info_data_v2.yml
# - market_data_v2_kr.yml
# - market_data_v2_us.yml
# - deploy.yml
```

**결론**: 설정 불필요, 자동으로 처리됩니다! ✅
