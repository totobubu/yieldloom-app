# 배당금 업데이트 스크립트 사용 설명서

이 문서는 `scripts/update_distributions.py` 스크립트의 사용법과 동작 방식을 설명합니다. 이 스크립트는 ETF 배당금 공지 스크린샷(OCR)을 분석하여 데이터 파일(`public/data/**/*.json`)의 배당금 정보를 자동으로 업데이트합니다.

## 1. 개요

- **스크립트 위치**: `scripts/update_distributions.py`
- **기능**: `public/screenshot` 폴더의 이미지를 OCR로 읽어, `public/data` 내 해당 ETF JSON 파일의 `amountFixed` 값을 업데이트하고 `expected: true` 플래그를 제거합니다.
- **지원 및 테스트된 ETF 운용사**:
    - **Roundhill**: 파일명에 `roundhill` 포함 시 (예: `roundhill.2026.01.20.png`)
    - **YieldMax**: 파일명에 `yieldmax` 포함 시 (예: `yieldmax_2026-01-15.png`)

## 2. 사전 준비 사항 (Prerequisites)

이 스크립트를 실행하기 위해서는 **Tesseract-OCR** 엔진이 설치되어 있어야 합니다.

1.  **Tesseract-OCR 설치**:
    - **Windows**:
        - [UB-Mannheim GitHub](https://github.com/UB-Mannheim/tesseract/wiki)에서 최신 설치러를 다운로드하여 설치합니다.
        - 설치 중 "Additional script data" 항목에서 "Hangul Script"와 "Hangul Vertical Script"를 체크하면 한글 인식도 가능합니다. (기본 경로: `C:\Program Files\Tesseract-OCR`)
        - 스크립트는 다음 경로들을 자동으로 확인합니다:
            - `C:\Program Files\Tesseract-OCR\tesseract.exe`
            - `C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`
            - `C:\Users\{User}\AppData\Local\Programs\Tesseract-OCR\tesseract.exe`
    - **Linux (Ubuntu/Debian)**:
        ```bash
        sudo apt install tesseract-ocr
        sudo apt install libtesseract-dev
        ```

2.  **초기 설정**:
    - 필요한 Python 라이브러리가 설치되어 있어야 합니다. (보통 `requirements.txt` 또는 `pip install pytesseract pillow` 명령어로 설치)

## 3. 사용 방법

### 1단계: 스크린샷 준비

배당금 공지 이미지를 `public/screenshot` 폴더에 저장합니다. 파일명은 다음 규칙을 따르는 것이 좋습니다.

- **파일명 규칙**: `{운용사명}_{날짜}.{확장자}`
    - 예: `yieldmax_2026-01-15.png`, `roundhill.2026.01.20.jpg`
    - **운용사명 구분**: 파일명에 `roundhill` 또는 `yieldmax`가 포함되어야 적절한 파서가 선택됩니다.
    - **날짜 인식**: 파일명에 `YYYY-MM-DD`, `YYYY.MM.DD` 또는 `YY-MM-DD` (20xx년 가정) 형식의 날짜가 있으면 그 날짜를 배당일로 사용합니다. 파일명에 날짜가 없으면 이미지 내 텍스트에서 날짜를 찾습니다.

### 2단계: 스크립트 실행

터미널에서 프로젝트 루트 경로로 이동한 후 다음 명령어를 실행합니다.

**Windows (PowerShell/CMD):**

```powershell
py scripts/data_pipeline/update_distributions.py
```

**Linux/Mac:**

```bash
python scripts/data_pipeline/update_distributions.py
```

> [!TIP]
> Windows에서 `py` 명령어가 작동하지 않는 경우, `python3 scripts/update_distributions.py`를 시도해보세요.

### 3단계: 결과 확인

스크립트가 실행되면 터미널에 진행 상황이 출력됩니다.

- 이미지 처리 시작 알림 (`Processing ...`)
- 추출된 날짜 확인 (`Date: ...`)
- 업데이트 내역 출력:
    - `[+] Updated ...`: `expected: true` 상태였던 항목을 정식 값으로 업데이트함.
    - `[+] Corrected ...`: 기존 값과 차이가 커서 수정한 경우.

실행 완료 후 `public/data` 폴더 내 변경된 JSON 파일들을 확인하고 커밋합니다.

## 4. 동작 원리

1.  **이미지 로드**: `public/screenshot` 폴더의 모든 `.png`, `.jpg`, `.webp` 파일을 스캔합니다.
2.  **OCR 분석**: Tesseract를 사용하여 이미지에서 텍스트를 추출합니다.
3.  **파싱 (Parsing)**:
    - **RoundhillParser**: 텍스트에서 티커(대문자 3~5글자)와 소수점 4자리 이상의 금액(예: `$0.2815`)을 찾습니다.
    - **YieldMaxParser**: 티커와 금액을 찾되, 소수점 처리 로직(예: 비상식적으로 큰 값 보정)이 포함되어 있습니다.
4.  **JSON 업데이트**:
    - 추출된 티커에 해당하는 JSON 파일을 `public/data`에서 찾습니다.
    - 이미지에서 파악된 날짜(`date`)와 일치하는 데이터 항목을 찾습니다.
    - 해당 항목이 `expected: true`인 경우, 이를 `amountFixed` 값으로 교체하고 `expected` 필드를 삭제합니다.

## 5. 문제 해결

- **Tesseract not found**: Tesseract가 설치되어 있는지, 경로가 올바른지 확인하세요. 스크립트 상단의 `TESSERACT_CMD_PATHS` 리스트에 설치 경로를 추가할 수 있습니다.
- **날짜 인식 실패**: 파일명에 정확한 날짜를 명시하는 것이 가장 정확합니다.
- **티커 인식 실패**: 이미지 화질이 좋지 않거나 폰트가 특이할 경우 인식이 안 될 수 있습니다. 선명한 스크린샷을 사용하세요.
