# 프로젝트 패턴과 검증 예시

아래 경로는 저장소 루트 기준이다. 각 예시는 특정 책임 분리를 보여주는 참조이며,
파일 전체의 구현·스타일이 모두 권장 기준이라는 뜻은 아니다.

| 목적                 | 참조                                                                                  | 살펴볼 점                                                                         |
| -------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Slots 기반 화면 조합 | `src/components/thumbnail/ThumbnailCardShell.vue`                                     | 공통 카드 골격에 header·본문·footer 콘텐츠를 조합                                 |
| 표현과 계산 분리     | `src/components/portfolio/TransactionAmount.vue`, `src/services/transactionAmount.js` | UI가 서비스의 통화·환율 표현 함수를 사용                                          |
| 앱 전체 테마 상태    | `src/composables/shared/useLayout.ts`                                                 | 공유 상태, 시스템 테마, 저장된 설정의 관계; 전역 상태를 모든 기능에 복제하지 않기 |
| 사용자별 비동기 상태 | `src/composables/usePortfolioDashboard.js`                                            | 주입된 사용자·조회 함수, 사용자 전환 시 초기화, 요청 경합과 scope 정리            |
| PrimeVue 디자인 토큰 | `src/config/theme.js`, `src/main.js`                                                  | Lara 기반 MyPreset, 한국어 locale, `.p-dark` 설정                                 |
| 스타일 체계          | `src/styles/style.scss`, `src/styles/abstracts/_theme.scss`                           | 앱 공통 스타일·테마와 카드 출력 스타일의 경계                                     |
| 컴포넌트 자동 import | `vite.config.js`, `components.d.ts`                                                   | PrimeVueResolver와 생성된 컴포넌트 타입                                           |

## 기존 테스트 연결

변경된 서비스의 import와 해당 테스트를 확인하고 필요한 명령을 선택한다.

```sh
# 거래 금액·통화·환율 표시
node --test tests/transaction_amount.test.mjs

# 배당 일정 검증
node --test tests/schedule_verification.test.mjs

# 포트폴리오 기간별 성과 계산
node --test tests/portfolio_performance.test.mjs

# 사용자 전환·비동기 응답 경합
node --test tests/portfolio_dashboard.test.mjs

# 프런트엔드 타입 검사
npm run type-check
```

UI 검증은 관련 라우트에서 수행한다. 검색은 `/`, 계좌·포트폴리오는 `/mypage`,
카드 출력은 `/stock/:ticker`가 출발점이다. `/thumbnail/:ticker`는 호환 리다이렉트다. 인증과 데이터가 필요한 화면은
사용 가능한 테스트 환경을 확인한다. 브라우저 자동화에서는 민감한 계좌 자료를
fixture나 로그에 복사하지 않는다.
