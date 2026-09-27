# R2 데이터 수동 관리 가이드 (R2 Data Manual Management)

이 문서는 `scripts/utils/manage_r2_data.py` 스크립트를 사용하여 R2(Cloudflare Object Storage)에 저장된 데이터 파일을 수동으로 다운로드, 수정 및 재업로드하는 방법을 설명합니다.

`public/data` 폴더가 Git 관리에서 제외되었으므로, 데이터 수정이 필요할 때 이 도구를 사용해야 합니다.

## 🛠️ 사전 준비 (Prerequisites)

이 스크립트를 실행하기 위해서는 R2 접근 권한이 설정되어 있어야 합니다. 프로젝트 루트에 `.env.r2` 파일이 존재하고, 올바른 인증 정보가 입력되어 있는지 확인하세요.

```ini
# .env.r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=...
```

## 🚀 사용 흐름 (Workflow)

데이터 수정은 다음 두 단계로 진행됩니다:

1.  **다운로드 (`download`)**: R2에서 파일을 로컬 `public/data` 폴더로 내려받습니다.
2.  **수정 (Edit)**: 로컬에서 JSON 파일을 수정합니다.
3.  **업로드 (`upload`)**: 수정된 파일을 R2로 업로드하고, 로컬 파일은 자동으로 삭제합니다.

---

## 📚 상세 사용법 (Usage)

### 1. 심볼 기준 수정 (By Symbol)

특정 티커(심볼)의 데이터를 수정하고 싶을 때 사용합니다.

**1단계: 다운로드**

```bash
python scripts/utils/manage_r2_data.py --symbol TSLY NVDY --action download
```

- `public/data/nasdaq/tsly.json`, `public/data/nasdaq/nvdy.json` 등이 생성됩니다.
- VS Code 등을 사용하여 다운로드된 파일을 엽니다.

**2단계: 파일 수정**

- 데이터를 수정합니다. (JSON 문법 오류가 없도록 주의하세요.)

**3단계: 업로드 및 정리**

```bash
python scripts/utils/manage_r2_data.py --symbol TSLY NVDY --action upload
```

- 스크립트가 JSON 유효성을 검사한 후 R2에 업로드합니다.
- 업로드가 성공하면 로컬 파일은 자동으로 삭제됩니다.

### 2. 배당일 기준 수정 (By Expected Date)

특정 날짜에 배당 이벤트가 있는 모든 티커를 수정해야 할 때(예: 특정일의 배당락일 일괄 수정) 유용합니다.

**1단계: 다운로드**

```bash
# 형식: YYYY-MM-DD
python scripts/utils/manage_r2_data.py --expected 2025-12-11 --action download

# 또는: YY-MM-DD
python scripts/utils/manage_r2_data.py --expected 25-12-11 --action download
```

- 해당 날짜에 이벤트가 있는 모든 종목을 R2 캘린더 데이터에서 찾아 다운로드합니다.

**2단계: 파일 수정**

- 다운로드된 파일들을 수정합니다.

**3단계: 업로드 및 정리**

```bash
python scripts/utils/manage_r2_data.py --expected 2025-12-11 --action upload
```

- 수정된 파일들을 일괄 업로드하고 로컬에서 정리합니다.

### 3. 그룹 기준 수정 (By Group)

미리 정의된 티커 그룹을 사용하여 여러 종목을 한 번에 처리합니다. (예: `일드맥스화요일` 등)
스크립트 내 `SYMBOL_GROUPS` 변수에서 그룹을 정의할 수 있습니다.

**1단계: 다운로드**

```bash
python scripts/utils/manage_r2_data.py --group 일드맥스화요일 --action download
```

**2단계: 파일 수정**

- 다운로드된 파일들을 수정합니다.

**3단계: 업로드 및 정리**

```bash
python scripts/utils/manage_r2_data.py --group 일드맥스화요일 --action upload
```

### 4. 회사 기준 수정 (By Company)

특정 운용사(Company)의 모든 종목을 일괄 수정할 때 사용합니다. (부분 일치 검색 지원)
예: `Defiance`, `Roundhill` 등

**1단계: 다운로드**

```bash
python scripts/utils/manage_r2_data.py --company Defiance --action download
```

**2단계: 파일 수정**

- 다운로드된 파일들을 수정합니다.

**3단계: 업로드 및 정리**

```bash
python scripts/utils/manage_r2_data.py --company Defiance --action upload
```

## ⚠️ 주의사항

1.  **JSON 문법**: 업로드 시 JSON 문법(`json.JSONDecodeError`)이 올바르지 않으면 업로드가 거부되고 파일이 보존됩니다. 에러 메시지를 확인하고 수정한 뒤 다시 시도하세요.
2.  **로컬 파일 미존재**: 업로드(`upload`) 명령 실행 시 해당 로컬 파일이 없으면("Local file not found") 해당 파일은 건너뜁니다.
3.  **데이터 덮어쓰기**: R2에 업로드하면 기존 데이터는 즉시 덮어씌워지므로 주의해서 수정해주세요.
