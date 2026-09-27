# 2단계 완료 보고서: 회원 및 개인 포트폴리오 의존성 분리

- 완료일: 2026-09-19
- 기본 모드: `content-studio`
- 보존 모드: `legacy-portfolio`

## 수행 내용

- `VITE_APP_MODE` 기반 애플리케이션 모드 경계를 추가했다.
- 기본 실행 모드를 Firebase 인증을 초기화하지 않는 콘텐츠 스튜디오로 변경했다.
- 콘텐츠 스튜디오 전용 레이아웃과 임시 홈 화면을 추가했다.
- 기존 회원, 개인 자산, 포트폴리오, 개인 북마크 경로는 `legacy-portfolio` 모드 안에 보존했다.
- 라우터의 Firebase 및 관리자 설정 import를 레거시 모드에서만 실행되는 동적 import로 변경했다.
- `main.js`의 전역 인증 store 초기화를 레거시 모드 전용으로 변경했다.

## 모드 사용법

기본 콘텐츠 스튜디오:

```powershell
npm run dev
```

기존 포트폴리오 화면 확인:

```powershell
$env:VITE_APP_MODE = 'legacy-portfolio'
npm run dev
```

## 검증

- `npm run type-check`: 통과
- `npm run build`: 통과
- `git diff --check`: 통과
- 콘텐츠 스튜디오 기본 라우트는 Firebase 사용자 조회 없이 진입하도록 분리했다.

빌드 중 기존 `src/components/portfolio/DividendChart.vue`의 `useECharts` export 관련 sourcemap 경고가 출력됐으나 빌드는 성공했다. 이번 단계에서 해당 레거시 차트 구현은 변경하지 않았다.

## 보존 및 미변경 범위

- 기존 회원 및 포트폴리오 코드는 삭제하지 않았다.
- 사용자 소유의 미추적 `public/screenshot/`은 변경하지 않았다.
- Firebase 패키지는 레거시 모드 복구를 위해 의존성에서 제거하지 않았다.

## 다음 단계

배당 발표를 공급자와 무관한 하나의 형식으로 저장할 수 있도록 SQLite 스키마, 공급자 인터페이스, 원본 보존 규칙과 CLI를 추가한다.
