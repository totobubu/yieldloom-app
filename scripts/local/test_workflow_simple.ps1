# 워크플로우 로컬 테스트 스크립트 (간단 버전)
param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("market_data_v2_us", "market_data_v2_kr", "update_info_data_v2")]
    [string]$Workflow = "market_data_v2_us",
    
    [switch]$SkipR2Upload = $true,
    [switch]$SkipGitCommit = $true
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "워크플로우 로컬 테스트: $Workflow" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 프로젝트 루트로 이동
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptPath
Set-Location $projectRoot
Write-Host "작업 디렉토리: $projectRoot" -ForegroundColor Gray
Write-Host ""

# 공통 준비
Write-Host "[1/5] 의존성 확인 중..." -ForegroundColor Yellow
node --version
python --version
Write-Host ""

Write-Host "[2/5] 의존성 설치 중..." -ForegroundColor Yellow
npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm ci 실패" -ForegroundColor Red
    exit 1
}

python -m pip install --upgrade pip --quiet
pip install -r requirements-workflow.txt --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] pip install 실패" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] 의존성 설치 완료" -ForegroundColor Green
Write-Host ""

# 워크플로우별 실행
Write-Host "[3/5] 워크플로우 실행 중..." -ForegroundColor Yellow

switch ($Workflow) {
    "market_data_v2_us" {
        Write-Host "미국 시장 데이터 업데이트 중..." -ForegroundColor Gray
        $env:DATA_LAYOUT_MODE = "market"
        node tasks/updateHistoricalUsData.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 미국 시장 데이터 업데이트 실패" -ForegroundColor Red
            exit 1
        }
        
        if ($env:FIRESTORE_SA_KEY) {
            Write-Host "사이드바 생성 중..." -ForegroundColor Gray
            npm run generate-sidebar-tickers
        } else {
            Write-Host "[WARN] FIRESTORE_SA_KEY가 없어 사이드바 생성을 건너뜁니다." -ForegroundColor Yellow
        }
    }
    
    "market_data_v2_kr" {
        Write-Host "한국 시장 데이터 업데이트 중..." -ForegroundColor Gray
        $env:DATA_LAYOUT_MODE = "market"
        node tasks/updateHistoricalKrData.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 한국 시장 데이터 업데이트 실패" -ForegroundColor Red
            exit 1
        }
        
        if ($env:FIRESTORE_SA_KEY) {
            Write-Host "사이드바 생성 중..." -ForegroundColor Gray
            npm run generate-sidebar-tickers
        } else {
            Write-Host "[WARN] FIRESTORE_SA_KEY가 없어 사이드바 생성을 건너뜁니다." -ForegroundColor Yellow
        }
    }
    
    "update_info_data_v2" {
        Write-Host "티커 심볼 동기화 중..." -ForegroundColor Gray
        python scripts/utils/sync_nav_symbols_with_data.py --no-sync-nav-files
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 티커 심볼 동기화 실패" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "메타데이터 보강 중..." -ForegroundColor Gray
        python scripts/utils/enrich_kr_market_info.py --sync-nav-files
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 메타데이터 보강 실패" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "환율 데이터 업데이트 중..." -ForegroundColor Gray
        node scripts/exchange/fetch_all_exchange_rates.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 환율 데이터 업데이트 실패" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "IPO 날짜 동기화 중..." -ForegroundColor Gray
        npm run add-ipo-dates
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] IPO 날짜 동기화 실패" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "nav.json 생성 중..." -ForegroundColor Gray
        npm run generate-nav
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] nav.json 생성 실패" -ForegroundColor Red
            exit 1
        }
        
        if ($env:FIRESTORE_SA_KEY) {
            Write-Host "정보 데이터 업데이트 중..." -ForegroundColor Gray
            $env:DATA_LAYOUT_MODE = "market"
            python scripts/data_pipeline/info_data_pipeline_kr.py
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[ERROR] 정보 데이터 업데이트 실패" -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "[WARN] FIRESTORE_SA_KEY가 없어 정보 데이터 업데이트를 건너뜁니다." -ForegroundColor Yellow
        }
        
        Write-Host "배당 히스토리 처리 중..." -ForegroundColor Gray
        $env:DATA_LAYOUT_MODE = "market"
        python scripts/data_pipeline/scraper_dividend.py
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 배당 히스토리 처리 실패" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "분할 조정 적용 중..." -ForegroundColor Gray
        python scripts/data_processing/apply_split_adjustments.py
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 분할 조정 적용 실패" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "캘린더 이벤트 생성 중..." -ForegroundColor Gray
        npm run generate-calendar-events
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] 캘린더 이벤트 생성 실패" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host "[OK] 워크플로우 실행 완료" -ForegroundColor Green
Write-Host ""

# 포맷팅
Write-Host "[4/5] 파일 포맷팅 중..." -ForegroundColor Yellow
npm run format:changed
Write-Host "[OK] 포맷팅 완료" -ForegroundColor Green
Write-Host ""

# R2 업로드 (선택적)
if (-not $SkipR2Upload) {
    Write-Host "[5/5] R2 업로드 중..." -ForegroundColor Yellow
    $env:GITHUB_EVENT_NAME = "workflow_dispatch"
    python scripts/cloud/upload_changed_to_r2.py
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] R2 업로드 완료" -ForegroundColor Green
    } else {
        Write-Host "[WARN] R2 업로드 실패" -ForegroundColor Yellow
    }
} else {
    Write-Host "[5/5] R2 업로드 건너뛰기" -ForegroundColor Gray
}
Write-Host ""

# Git 상태 확인
if (-not $SkipGitCommit) {
    Write-Host "변경사항 확인 중..." -ForegroundColor Yellow
    $changes = git status --porcelain
    if ($changes) {
        Write-Host "변경된 파일:" -ForegroundColor Yellow
        Write-Host $changes
    } else {
        Write-Host "[OK] 변경된 파일이 없습니다." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "[OK] 테스트 완료!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

