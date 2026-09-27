# Firebase 누락 심볼 추출하기

## 준비 사항

1. **Service Account Key 다운로드**
    - Firebase Console 접속: https://console.firebase.google.com/
    - 프로젝트 선택 (totobubu-tracker)
    - 왼쪽 메뉴: ⚙️ Project Settings
    - **Service accounts** 탭
    - "Generate new private key" 버튼 클릭
    - 다운로드된 JSON 파일을 프로젝트 루트 폴더에 `serviceAccountKey.json` 이름으로 저장

2. **`.gitignore` 확인**
    - `serviceAccountKey.json`이 `.gitignore`에 포함되어 있는지 확인 (보안상 중요!)

## 사용법

```bash
node scripts/extract_missing_symbols.js
```

## 동작 방식

1. Firebase `stockMappings` 컬렉션에서 모든 데이터 가져오기
2. `public/nav` 폴더의 모든 JSON 파일 스캔
3. Firebase에는 있지만 `public/nav`에는 없는 심볼 찾기
4. 결과를 `missing_symbols.json`으로 저장

## 출력 파일 예시

```json
[
    {
        "symbol": "AAPL",
        "isin": "US0378331005",
        "koName": "애플"
    }
]
```

## 다음 단계

누락된 심볼들을 확인한 후:

- 해당 심볼들을 적절한 `public/nav/{market}/{letter}.json` 파일에 수동으로 추가
- 또는 자동 생성 스크립트 작성
