# 워크플로우 로컬 테스트 가이드

이 문서는 GitHub Actions 워크플로우를 로컬에서 테스트하는 방법을 설명합니다.

## 📋 목차

1. [개요](#개요)
2. [사전 준비](#사전-준비)
3. [워크플로우 테스트 스크립트 사용법](#워크플로우-테스트-스크립트-사용법)
4. [지원하는 워크플로우](#지원하는-워크플로우)
5. [주의사항](#주의사항)

---

## 🔍 개요

`scripts/test_workflow_simple.ps1` 스크립트를 사용하면 GitHub Actions 워크플로우를 로컬에서 테스트할 수 있습니다.

이 스크립트는 다음 워크플로우를 지원합니다:

- **market_data_v2_us**: 미국 시장 데이터 업데이트
- **market_data_v2_kr**: 한국 시장 데이터 업데이트
- **update_info_data_v2**: 정보성 데이터 업데이트

---

## 🛠️ 사전 준비

### 1. PowerShell 실행 정책 설정

처음 실행 시 권한 오류가 발생할 수 있습니다. 다음 명령어로 실행 정책을 설정하세요:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 2. 의존성 확인

스크립트는 자동으로 의존성을 설치하지만, 다음이 설치되어 있어야 합니다:

- **Node.js** (v20 이상)
- **Python** (v3.11 이상)

---

## 🚀 워크플로우 테스트 스크립트 사용법

### 기본 사용법

프로젝트 루트에서 PowerShell로 실행:

```powershell
# US 워크플로우 테스트
.\scripts\test_workflow_simple.ps1 -Workflow market_data_v2_us

# KR 워크플로우 테스트
.\scripts\test_workflow_simple.ps1 -Workflow market_data_v2_kr

# Info Data 워크플로우 테스트
.\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2
```

### 옵션

```powershell
# R2 업로드 건너뛰기 (기본값: true)
.\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2 -SkipR2Upload

# Git 커밋 건너뛰기 (기본값: true)
.\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2 -SkipGitCommit

# 모든 옵션 활성화 (R2 업로드 및 Git 커밋 포함)
.\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2 -SkipR2Upload:$false -SkipGitCommit:$false
```

---

## 📊 지원하는 워크플로우

### 1. Market Data v2 US

**워크플로우 파일**: `.github/workflows/market_data_v2_us.yml`

**실행 내용**:
1. 미국 시장 히스토리 가격 데이터 업데이트
2. 사이드바 티커 생성 (인기도 100%)
3. 변경 파일 포맷팅
4. R2 업로드 (선택적)
5. Git 커밋 & 푸시 (선택적)

**테스트 명령어**:
```powershell
.\scripts\test_workflow_simple.ps1 -Workflow market_data_v2_us
```

**환경변수**:
- `DATA_LAYOUT_MODE=market`: 데이터를 시장별 디렉토리에 저장
- `FIRESTORE_SA_KEY`: 사이드바 생성 시 필요 (선택적)

---

### 2. Market Data v2 KR

**워크플로우 파일**: `.github/workflows/market_data_v2_kr.yml`

**실행 내용**:
1. 한국 시장 히스토리 가격 데이터 업데이트
2. 사이드바 티커 생성 (인기도 100%)
3. 변경 파일 포맷팅
4. R2 업로드 (선택적)
5. Git 커밋 & 푸시 (선택적)

**테스트 명령어**:
```powershell
.\scripts\test_workflow_simple.ps1 -Workflow market_data_v2_kr
```

**환경변수**:
- `DATA_LAYOUT_MODE=market`: 데이터를 시장별 디렉토리에 저장
- `FIRESTORE_SA_KEY`: 사이드바 생성 시 필요 (선택적)

---

### 3. Update Info Data v2

**워크플로우 파일**: `.github/workflows/update_info_data_v2.yml`

**실행 내용**:
1. 한국 티커 심볼 동기화
2. 한국 시장 메타데이터 보강
3. 환율 데이터 업데이트
4. IPO 날짜 동기화
5. nav.json 생성
6. 정보 데이터 업데이트 (배당, 티커 정보, 시가총액 등)
7. 배당 히스토리 처리
8. 분할 조정 적용
9. 캘린더 이벤트 생성
10. 변경 파일 포맷팅
11. R2 업로드 (선택적)
12. Git 커밋 & 푸시 (선택적)

**테스트 명령어**:
```powershell
.\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2
```

**환경변수**:
- `DATA_LAYOUT_MODE=market`: 데이터를 시장별 디렉토리에 저장
- `FIRESTORE_SA_KEY`: 정보 데이터 업데이트 시 필요 (선택적)

**상세 내용**: [UPDATE_INFO_DATA_V2_GUIDE.md](./UPDATE_INFO_DATA_V2_GUIDE.md) 참조

---

## ⚠️ 주의사항

### 1. 환경변수

일부 워크플로우는 환경변수가 필요합니다:

- **FIRESTORE_SA_KEY**: Firestore 접근 키 (선택적)
  - 없으면 해당 단계가 건너뜀
- **R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL**: R2 업로드 시 필요 (선택적)

### 2. 실행 시간

워크플로우에 따라 실행 시간이 다릅니다:

| 워크플로우 | 예상 소요 시간 |
|-----------|-------------|
| market_data_v2_us | ~5-10분 |
| market_data_v2_kr | ~5-10분 |
| update_info_data_v2 | ~15-25분 |

### 3. Git 상태

- 기본적으로 Git 커밋은 건너뜀 (`-SkipGitCommit:$true`)
- Git 상태를 확인하려면 `-SkipGitCommit:$false` 사용

### 4. 데이터 레이아웃

모든 워크플로우는 `DATA_LAYOUT_MODE=market`를 사용하여 데이터를 시장별 디렉토리에 저장합니다:

```
public/data/
├── NASDAQ/
│   ├── aapl.json
│   └── msft.json
├── NYSE/
│   └── spy.json
├── KOSPI/
│   └── 005930.json
└── KOSDAQ/
    └── 160580.json
```

---

## 📝 실행 예시

### 예시 1: Info Data 워크플로우 테스트 (기본)

```powershell
PS C:\workspace\divgrow\totobubu.github.io> .\scripts\test_workflow_simple.ps1 -Workflow update_info_data_v2

========================================
워크플로우 로컬 테스트: update_info_data_v2
========================================

[1/5] 의존성 확인 중...
v20.10.0
Python 3.11.5

[2/5] 의존성 설치 중...
[OK] 의존성 설치 완료

[3/5] 워크플로우 실행 중...
티커 심볼 동기화 중...
메타데이터 보강 중...
환율 데이터 업데이트 중...
IPO 날짜 동기화 중...
nav.json 생성 중...
정보 데이터 업데이트 중...
...

[OK] 워크플로우 실행 완료

[4/5] 파일 포맷팅 중...
[OK] 포맷팅 완료

[5/5] R2 업로드 건너뛰기

변경사항 확인 중...
[OK] 변경된 파일이 없습니다.

========================================
[OK] 테스트 완료!
========================================
```

### 예시 2: US 시장 데이터 업데이트 (R2 업로드 포함)

```powershell
PS C:\workspace\divgrow\totobubu.github.io> .\scripts\test_workflow_simple.ps1 -Workflow market_data_v2_us -SkipR2Upload:$false

========================================
워크플로우 로컬 테스트: market_data_v2_us
========================================

[1/5] 의존성 확인 중...
...

[3/5] 워크플로우 실행 중...
미국 시장 데이터 업데이트 중...
사이드바 생성 중...
...

[4/5] 파일 포맷팅 중...
[OK] 포맷팅 완료

[5/5] R2 업로드 중...
[OK] R2 업로드 완료

========================================
[OK] 테스트 완료!
========================================
```

---

## 🔗 관련 문서

- [UPDATE_INFO_DATA_V2_GUIDE.md](./UPDATE_INFO_DATA_V2_GUIDE.md) - Update Info Data v2 워크플로우 상세 가이드
- [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) - 워크플로우 전체 개요

---

**Last Updated**: 2025-01-XX  
**Version**: 1.0.0

