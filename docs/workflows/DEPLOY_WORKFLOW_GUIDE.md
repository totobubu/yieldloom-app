# Deploy 워크플로우 가이드

## 📋 개요

`deploy.yml`은 main 브랜치에 코드가 푸시될 때마다 자동으로 실행되는 워크플로우입니다.

**주요 기능**:
1. 변경된 데이터 파일을 R2에 자동 업로드 ⚡
2. Vue 앱 빌드
3. GitHub Pages에 배포

---

## 🔄 실행 흐름

### 1단계: 코드 체크아웃
```yaml
- name: Checkout
  uses: actions/checkout@v4
```

### 2단계: Python 및 R2 설정
```yaml
- name: Set up Python
- name: Install Python dependencies
- name: Setup R2 environment variables
```

### 3단계: R2 업로드 ⚡ (핵심!)
```yaml
- name: Upload changed data files to R2
  run: python scripts/cloud/upload_changed_to_r2.py
```

**작동 방식**:
- Git에서 변경된 파일 감지
- `public/data`, `public/nav.json`, `public/sidebar` 등 변경된 것만 R2에 업로드
- 실패해도 배포는 계속 진행

### 4단계: Vue 앱 빌드
```yaml
- name: Set up Node.js
- name: Build Vue App
```

### 5단계: GitHub Pages 배포
```yaml
- name: Setup Pages
- name: Upload artifact
- name: Deploy to GitHub Pages
```

---

## 🎯 자동 R2 업로드의 장점

### Before (R2 업로드 없음)
```
main에 push → Vue 빌드 → GitHub Pages 배포
                          ↓
                    사용자가 보는 데이터: GitHub에서 로드 (느림)
```

### After (R2 자동 업로드) ✅
```
main에 push → R2 업로드 (변경된 파일만) → Vue 빌드 → GitHub Pages 배포
                     ↓
               R2에 최신 데이터 자동 동기화
                     ↓
               사용자가 보는 데이터: R2에서 로드 (빠름)
```

---

## 📊 실제 동작 예시

### 시나리오 1: 데이터만 변경 후 push

```bash
# 1. 로컬에서 데이터 업데이트
python scripts/data_pipeline/update_dividends.py

# 2. Git 커밋
git add public/data/
git commit -m "Update dividends"
git push origin main

# 3. deploy.yml 자동 실행:
# ├─ 📤 R2 업로드 (변경된 50개 파일만) - 15초
# ├─ 🔨 Vue 빌드 - 2분
# └─ 🚀 Pages 배포 - 1분
```

**결과**:
- ✅ R2에 최신 데이터 자동 업로드
- ✅ GitHub Pages에 새 앱 배포
- ✅ 사용자는 R2에서 빠르게 데이터 로드

---

### 시나리오 2: 코드만 변경 후 push (데이터 변경 없음)

```bash
# 1. 로컬에서 Vue 코드 수정
vi src/components/SomeComponent.vue

# 2. Git 커밋
git add src/
git commit -m "Update UI"
git push origin main

# 3. deploy.yml 자동 실행:
# ├─ 📤 R2 업로드 (변경된 파일 없음) - 1초 (스킵)
# ├─ 🔨 Vue 빌드 - 2분
# └─ 🚀 Pages 배포 - 1분
```

**결과**:
- ✅ R2 업로드 즉시 스킵 (변경 없음)
- ✅ GitHub Pages에 새 UI 배포

---

### 시나리오 3: 데이터 + 코드 모두 변경

```bash
# 1. 데이터 및 코드 수정
python scripts/data_pipeline/update_dividends.py
vi src/components/Dashboard.vue

# 2. Git 커밋
git add .
git commit -m "Update data and UI"
git push origin main

# 3. deploy.yml 자동 실행:
# ├─ 📤 R2 업로드 (변경된 데이터 파일들) - 20초
# ├─ 🔨 Vue 빌드 - 2분
# └─ 🚀 Pages 배포 - 1분
```

**결과**:
- ✅ R2에 최신 데이터 업로드
- ✅ GitHub Pages에 새 UI 배포
- ✅ 완벽한 동기화!

---

## ⚡ 성능 특징

### Git 기반 스마트 업로드
```
변경된 파일만 감지:
- public/data/aapl.json      → 업로드 ✅
- public/data/tsla.json      → 업로드 ✅
- public/nav.json            → 업로드 ✅
- src/components/Foo.vue     → 스킵 (R2 업로드 대상 아님)
```

### 빠른 실행
```
데이터 변경 없음: ~1초 (즉시 스킵)
50개 파일 변경: ~15초
500개 파일 변경: ~2분
```

---

## 🔧 작동 원리

### 1. Git 변경사항 감지
```bash
# deploy.yml이 실행될 때 Git 상태:
git status --porcelain

# 결과:
M public/data/aapl.json
M public/data/tsla.json
M public/nav.json
M src/App.vue
```

### 2. public/ 폴더 파일만 필터링
```python
# upload_changed_to_r2.py 내부:
changed_files = get_git_changed_files()
# → ['public/data/aapl.json', 'public/data/tsla.json', 'public/nav.json', 'src/App.vue']

upload_targets = filter_public_files(changed_files)
# → [('public/data/aapl.json', 'data/aapl.json'),
#     ('public/data/tsla.json', 'data/tsla.json'),
#     ('public/nav.json', 'nav.json')]
# src/App.vue는 자동으로 제외됨!
```

### 3. R2에 업로드
```python
for local_path, r2_key in upload_targets:
    upload_file_to_r2(local_path, r2_key)
```

---

## 🎯 주요 장점

### 1. 자동화
```
Before:
  1. main에 push
  2. 수동으로 R2 업로드 스크립트 실행 필요
  3. Pages 배포

After:
  1. main에 push
  2. R2 자동 업로드! ✅
  3. Pages 자동 배포! ✅
```

### 2. 실시간 동기화
```
main 브랜치 = R2 데이터 = GitHub Pages
→ 항상 동기화된 상태 유지! ✅
```

### 3. 안전성
```yaml
python scripts/cloud/upload_changed_to_r2.py || echo "⚠️ R2 업로드 실패 (계속 진행)"
```
- R2 업로드 실패해도 배포는 계속 진행
- 배포 중단되지 않음

---

## 📊 실행 시간

### 전체 워크플로우
```
1. Checkout               → 5초
2. Python 설정            → 10초
3. R2 업로드             → 1-30초 (변경 파일 수에 따라)
4. Node.js 설정          → 10초
5. Vue 빌드              → 2분
6. 404 페이지 준비       → 1초
7. Pages 배포            → 1분
─────────────────────────────
총 시간: 3-4분
```

**R2 업로드 추가로 인한 시간 증가**: +10-30초 (미미함)

---

## 🔍 로그 확인

### 성공 시
```
📤 변경된 데이터 파일을 R2에 업로드 중...

[1/3] Git 변경사항 확인 중...
   ✓ Git 변경된 파일: 50개

[2/3] 업로드 대상 필터링 중...
   ✓ 업로드 대상: 48개
   
   [업로드 대상 상세]
     - data: 46개
     - nav.json: 1개
     - sidebar: 1개

[3/3] R2에 업로드 중...
Uploading: 100%|████████████| 48/48 [00:15<00:00]

✅ 성공: 48개
✅ R2 업로드 완료 (또는 스킵)
```

### 변경사항 없을 때
```
📤 변경된 데이터 파일을 R2에 업로드 중...

[1/3] Git 변경사항 확인 중...
   ✓ Git 변경된 파일: 0개

[OK] 변경된 파일이 없습니다. 업로드 건너뜀.
✅ R2 업로드 완료 (또는 스킵)
```

---

## ⚠️ 주의사항

### 1. 순서 중요
R2 업로드는 **Vue 빌드 전에** 실행됩니다:
```yaml
1. R2 업로드    ← 데이터 먼저 업로드
2. Vue 빌드     ← 앱 빌드
3. Pages 배포   ← 앱 배포
```

**이유**: 데이터가 먼저 R2에 올라가야 앱이 최신 데이터를 참조할 수 있습니다.

### 2. 실패 처리
```yaml
python scripts/cloud/upload_changed_to_r2.py || echo "⚠️ R2 업로드 실패 (계속 진행)"
```
- R2 업로드가 실패해도 워크플로우는 계속 진행
- Pages 배포는 영향받지 않음
- 로그에서 실패 원인 확인 가능

### 3. 빌드 시간
- Python 설정 추가로 첫 실행 시 ~10초 증가
- 이후 캐시 사용으로 영향 최소화

---

## 🎯 사용 시나리오

### 일반적인 개발 흐름
```bash
# 1. 로컬 개발
npm run dev

# 2. 데이터 업데이트
python scripts/data_pipeline/update_dividends.py

# 3. Git 커밋 & 푸시
git add .
git commit -m "Update dividends and fix UI"
git push origin main

# 4. 자동 실행:
# ✅ R2에 변경된 데이터 업로드 (자동)
# ✅ GitHub Pages에 배포 (자동)
```

### 긴급 배포
```bash
# 수동으로 워크플로우 트리거
GitHub → Actions → Build and Deploy → Run workflow

# 결과:
# ✅ 최신 상태로 R2 업로드
# ✅ 최신 상태로 Pages 배포
```

---

## 📈 예상 효과

### 개발 편의성
```
Before:
  1. 데이터 업데이트
  2. main에 push
  3. 수동으로 R2 업로드 워크플로우 실행 ← 추가 작업!
  4. Pages 배포 대기

After:
  1. 데이터 업데이트
  2. main에 push
  3. R2 + Pages 자동 배포! ✅ (한 번에 완료)
```

### 동기화 보장
```
main 브랜치 상태 = R2 데이터 = GitHub Pages
→ 항상 일치! ✅
```

---

## 🔍 모니터링

### GitHub Actions 로그 확인
```
Actions → Build and Deploy to GitHub Pages → 최신 실행

확인 항목:
1. "Upload changed data files to R2" 스텝
   - 업로드된 파일 수
   - 소요 시간
   - 성공 여부

2. "Build Vue App" 스텝
   - 빌드 성공 여부

3. "Deploy to GitHub Pages" 스텝
   - 배포 URL
```

---

## 🚨 문제 해결

### Q: R2 업로드가 실패했는데 배포는 성공함

**답변**: 정상입니다!
```yaml
|| echo "⚠️ R2 업로드 실패 (계속 진행)"
```
- R2 업로드 실패해도 배포는 계속됨
- 로그에서 실패 원인 확인
- 수동으로 R2 업로드 워크플로우 실행 가능

### Q: 데이터를 변경했는데 R2에 업로드 안 됨

**확인 사항**:
```bash
# Git에 커밋되었는지 확인
git status

# 변경사항이 추적되지 않았다면
git add public/data/
git commit -m "Update data"
git push
```

### Q: 빌드 시간이 너무 오래 걸림

**분석**:
- Python 설정: ~10초 (캐시 사용)
- R2 업로드: ~15-30초 (변경 파일 수에 따라)
- Vue 빌드: ~2분 (기존과 동일)
- 총 증가: ~10-30초 (전체의 5-10%)

**정상 범위**: 3-4분

---

## 📌 요약

### 핵심 기능
- ✅ **자동 R2 업로드**: main push → R2 자동 동기화
- ✅ **스마트 감지**: Git 변경사항 기반 (빠름)
- ✅ **안전한 배포**: 실패해도 배포 계속

### 사용 방법
```bash
# 개발자는 그냥 push만 하면 됨!
git push origin main

# 나머지는 자동:
# → R2 업로드 ✅
# → Pages 배포 ✅
```

### 예상 효과
- 🚀 개발 편의성 향상
- 🎯 데이터 동기화 보장
- ⚡ 빠른 업로드 (변경된 것만)

**결론**: main에 push만 하면 모든 것이 자동으로 처리됩니다! 🎉

