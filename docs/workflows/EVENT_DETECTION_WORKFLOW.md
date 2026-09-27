# 이벤트 변화 감지 워크플로우

배당 주기·요일 변경과 주식 병합/분할 이력을 자동으로 감지하고, 검토 후 정적 데이터에 반영하는 전체 과정을 정리했습니다.

## 1. 감지 스크립트 실행

```
node scripts/data_processing/detect_event_changes.js [옵션]
```

### 대표 옵션

| 옵션                 | 설명                                    | 예시                                                 |
| -------------------- | --------------------------------------- | ---------------------------------------------------- |
| `--company=YieldMax` | `nav.json`의 `company` 필드 기준 필터링 | YieldMax 전체 감지                                   |
| `--symbol=ULTY,AMZY` | 특정 심볼만 분석 (콤마 구분)            | 2개 티커만 감지                                      |
| `--output=경로`      | 보고서 출력 경로 지정                   | 기본값: `scripts/output/events-report.json`          |
| `--template=경로`    | 검토용 템플릿 파일 경로 지정            | 기본값: `scripts/output/events-config-template.json` |

스크립트를 실행하면 다음 두 파일이 생성됩니다.

- `events-report.json` : 감지 결과 전체 로그 (주기/요일 세그먼트, confidence 등)
- `events-config-template.json` : 적용 후보 템플릿 (`apply: false` 기본)

## 2. 검토 & 승인

1. `scripts/output/events-report.json`으로 근거(주기·요일, 평균 일수, confidence)를 확인합니다.
2. `scripts/output/events-config-template.json`에서 실제 반영할 항목만 `apply: true`로 수정합니다.  
   필요 없는 이벤트는 배열에서 삭제해도 됩니다.
3. (선택) 파일명을 변경해 승인 버전으로 보관할 수 있습니다.

## 3. 이벤트 반영

```
node scripts/data_processing/add_event_metadata.js --config=스크립트/템플릿/경로.json
node scripts/data_processing/add_event_metadata.js --config=scripts/output/events-config-template.json
```

### 적용 기준

- `config` 옵션을 지정하면 해당 파일의 `entries` 배열을 읽습니다.
- `apply: true`로 표시된 항목만 `public/data/<symbol>.json`의 `tickerInfo.events`에 추가됩니다.
- 중복 이벤트는 무시하고, 파일이 없으면 경고만 출력합니다.

옵션을 생략하면 `add_event_metadata.js` 내부의 `DEFAULT_CONFIG` 배열이 사용됩니다.

## 4. 데이터 구조

`public/data/<symbol>.json`에 저장되는 구조는 다음과 같습니다.

```json
"tickerInfo": {
  "events": {
    "frequencyChanges": [
      { "date": "2025-10-16", "from": "4주", "to": "매주" }
    ],
    "splits": [
      { "date": "2023-05-12", "ratio": "1:5", "type": "split" }
    ],
    "weekdayChanges": [
      { "date": "2025-10-16", "from": "목", "to": "수" }
    ]
  }
}
```

추가로 감지하고 싶은 이벤트 유형이 있다면 `events` 아래에 새로운 배열을 확장하면 됩니다.

## 5. 워크플로우 체크리스트

1. 감지: `detect_event_changes.js` 실행 (필터 옵션 선택)
2. 검토: `events-report.json` 확인 → `events-config-template.json` 편집
3. 적용: `add_event_metadata.js --config=...` 실행
4. 검증: 변경된 `public/data/<symbol>.json`을 확인 후 배포 파이프라인 진행

이 과정을 통해 감지 결과를 빠르게 승인·적용할 수 있습니다. 추가 기능이 필요하면 해당 스크립트를 확장해 주세요.
