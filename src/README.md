# 배당 모아 (Div Grow) - 프로젝트 설정 가이드

## 1. 초기 환경 설정

### 1-1. Python 가상 환경 설정

프로젝트 루트에서 아래 명령어를 실행하여 파이썬 가상 환경을 생성하고 활성화합니다.

```bash
# '.venv' 라는 이름의 가상 환경 생성
python3 -m venv .venv

# 가상 환경 활성화 (Windows - Git Bash or WSL)
source .venv/bin/activate

# 가상 환경 활성화 (Windows - Command Prompt)
.venv\Scripts\activate

# 가상 환경 활성화 (Windows - PowerShell)
.venv\Scripts\Activate.ps1
```

### 1-2. 필수 라이브러리 설치

프로젝트에 필요한 Node.js와 Python 라이브러리를 설치합니다.

```bash
# Python 라이브러리 설치 (데이터 생성/워크플로우 용)
pip install -r requirements-workflow.txt

# Node.js 라이브러리 설치
npm install
```

## 2. 로컬에서 전체 데이터 업데이트 (한번에 실행)

GitHub Actions와 동일한 모든 작업을 로컬에서 한번에 실행할 수 있습니다.

### 방법 1: PowerShell 스크립트 실행 (권장)

```powershell
# PowerShell에서 실행
.\scripts\update_all_local.ps1
```

**처음 실행 시 권한 오류가 발생한다면:**

```powershell
# PowerShell을 관리자 권한으로 열고 실행
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 방법 2: 배치 파일 실행

```bash
# 명령 프롬프트 또는 PowerShell에서 실행
.\scripts\update_all_local.bat

# 또는 탐색기에서 update_all_local.bat 파일을 더블클릭
```

### 실행되는 작업 순서

1. 💱 환율 데이터 업데이트
2. 📅 IPO 날짜 동기화
3. 📊 배당 빈도 분석
4. 🗂️ nav.json 생성
7. 📈 히스토리 가격 데이터 업데이트
8. 💰 시가총액 업데이트
9. 💵 배당 데이터 업데이트
10. 📝 배당 히스토리 처리
11. 🧹 히스토리 데이터 정리
12. ℹ️ 최신 티커 정보 업데이트
13. ⭐ 북마크 인기도 집계 (선택사항)
14. 🔮 미래 배당 날짜 예측
15. 📆 캘린더 이벤트 생성
16. 📋 사이드바 티커 생성
17. ✨ 데이터 파일 포맷팅

⏱️ **소요 시간**: 약 10~30분

## 3. 데이터 업데이트 파이프라인 (개별 실행)

개별 스크립트를 하나씩 실행하고 싶을 때 사용합니다. 위의 전체 업데이트 스크립트가 아닌 특정 작업만 실행하려면 아래 순서를 따르세요.

### 3-1. (선택) 종목 추가/업데이트

```bash
# 새로운 티커 온보딩 워크플로우 실행
python scripts/run_new_ticker_workflow.py WEED MAGS

# ⭐ 자세한 가이드: docs/TICKER_MANAGEMENT_GUIDE.md 참고

# 특정 운용사의 모든 ETF 종목 추가
npm run add:etf "Roundhill"

# 한국 주식 전체 목록 업데이트
python scripts/fetch_kr_tickers.py
```

### 3-2. 필수 데이터 업데이트

```bash
# 1. 환율 데이터 업데이트
node scripts/fetch_all_exchange_rates.js

# 2. IPO 날짜 동기화 및 'upcoming' 상태 업데이트
npm run add-ipo-dates

# 3. 배당 주기(frequency) 및 그룹(group) 자동 분석
python scripts/analyze_dividend_frequency.py           # 전체
python scripts/analyze_dividend_frequency.py WEED      # 개별 티커
python scripts/analyze_dividend_frequency.py WEED MAGS # 여러 티커

# 4. 최종 nav.json 파일 생성
npm run generate-nav



# 7. 주가 데이터 증분 업데이트
node tasks/updateHistoricalKrData.js   # 한국 티커 전체
node tasks/updateHistoricalUsData.js   # 미국 티커 전체
node tasks/updateHistoricalKrData.js TICKER  # 한국 개별 티커
node tasks/updateHistoricalUsData.js TICKER  # 미국 개별 티커

# 8. 시가총액 업데이트
python scripts/update_market_cap.py           # 전체
python scripts/update_market_cap.py WEED      # 개별 티커
python scripts/update_market_cap.py WEED MAGS # 여러 티커

# 9. 배당 데이터 증분 업데이트
python scripts/update_dividends.py           # 전체
python scripts/update_dividends.py WEED      # 개별 티커
python scripts/update_dividends.py WEED MAGS # 여러 티커

# 10. 배당 내역 및 배당률 처리
python scripts/scraper_dividend.py           # 전체
python scripts/scraper_dividend.py WEED      # 개별 티커
python scripts/scraper_dividend.py WEED MAGS # 여러 티커

# 11. 히스토리 데이터 정리
python scripts/clean_data.py           # 전체
python scripts/clean_data.py WEED      # 개별 티커
python scripts/clean_data.py WEED MAGS # 여러 티커

# 12. 최신 기업 정보(시가총액 등) 업데이트
python scripts/scraper_info.py           # 전체
python scripts/scraper_info.py WEED      # 개별 티커
python scripts/scraper_info.py WEED MAGS # 여러 티커

# 13. 북마크 인기 데이터 집계 (FIRESTORE_SA_KEY 환경 변수 필요)
python scripts/aggregate_popularity.py

# 14. 미래 배당 날짜 예측
python scripts/project_future_dividends.py           # 전체
python scripts/project_future_dividends.py WEED      # 개별 티커
python scripts/project_future_dividends.py WEED MAGS # 여러 티커

# 15. 달력 이벤트 데이터 생성
npm run generate-calendar-events

# 16. 사이드바 목록 데이터 생성
python scripts/generate_sidebar_tickers.py

# 17. 생성된 모든 JSON 파일 포맷팅
npm run format:data
npm run format:nav
npm run format:public
```

## 4. 개발 서버 실행

```bash
npm run dev
```

## 5. Git 관련 유용한 명령어

```bash
# public/data 폴더의 변경사항을 Git에서 무시하기 (대용량 데이터 파일)
git ls-files -z public/data | xargs -0 git update-index --assume-unchanged

# 다시 추적하기
git ls-files -z public/data | xargs -0 git update-index --no-assume-unchanged

# 무시 중인 파일 확인
git ls-files -v | grep '^h'
# → h로 표시된 파일이 assume-unchanged 처리된 파일들
# (H: 추적 중, h: 무시 중)
```
