# 🖼️ 로고 자동 수집 가이드

`tasks/fetchMissingLogos.js` 스크립트는 `public/missing-logos.json`에 기록된 티커 중 아직 로고가 없는 항목을 대상으로, 인터넷에서 로고 이미지를 자동으로 내려받습니다.

## ✅ 현재 동작 방식

- **저장 경로**: `public/logos`
- **파일명 규칙**: `missing-logos.json`의 `normalizedSearchName` 값 + 확장자
- **기존 파일 보호**: 같은 이름의 로고 파일이 이미 존재하면 건너뜁니다.
- **로고 형태 우선순위**: 가로세로 비율 1:1인 정사각형 이미지를 가장 먼저 채택하며, 모든 소스가 비정사각형일 때만 예외적으로 저장합니다 (보고서에 별도 표기).
- **소스 우선순위**:
  1. `https://storage.googleapis.com/iex/api/logos/{symbol}.png` (미국 거래소 한정)
  2. `https://financialmodelingprep.com/image-stock/{symbol}.png`
- **출력 보고서**: 실행 후 `public/missing-logos-fetch-report.json`에 요약 정보를 저장합니다.

> ℹ️ 현재 공개적으로 접근 가능한 고품질 SVG 소스를 안정적으로 확보하기 어려워, 우선 PNG 소스만 연결했습니다. SVG 지원이 가능한 안전한 공급처를 찾으면 `buildSourceCandidates` 함수에 손쉽게 추가할 수 있도록 구조화해 두었습니다.

## 🚀 실행 방법

```bash
npm run fetch-logos
```

실행 로그에서 다음 정보를 확인할 수 있습니다.
- 새로 다운로드한 로고 개수와 파일 목록 (최대 20개까지 표시, 비정사각형이면 ⚠️ 표시)
- 이미 존재하여 건너뛴 항목 수
- 모든 소스 시도에 실패한 티커 목록
- 요약 보고서 저장 경로

## 🛠️ 커스터마이징 팁

- **새 소스 추가**: `tasks/fetchMissingLogos.js`의 `buildSourceCandidates` 함수에 공급처 URL 패턴을 추가하세요. `provider`, `url`, `ext`만 지정하면 됩니다.
- **시도 순서 변경**: `sources.push` 호출 순서를 바꾸면 우선순위를 제어할 수 있습니다.
- **요청 간 지연 조절**: `REQUEST_DELAY_MS` 상수를 조정하면 트래픽 제어에 도움이 됩니다.

## 📄 참고

- `npm run generate-nav` 실행 시 로고 파일이 존재하면 자동으로 매칭되며, 이후 `missing-logos.json`에서 해당 항목이 사라집니다.
- 보고서(`missing-logos-fetch-report.json`)는 후속 작업이나 재실행 시 참고용으로 남겨둡니다. 필요에 따라 삭제해도 무방합니다.

