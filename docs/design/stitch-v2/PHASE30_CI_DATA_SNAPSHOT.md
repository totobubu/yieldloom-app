# 30차 운영 승격 후 CI 자료 의존성

전체 리디자인은 PR #236에서 work `7d9218f`, PR #241에서 main `95696da`로 병합됐다. 승격 PR의 CI41955614101은 4개 작업 모두 통과했다. 그동안 main의 자동 Content Studio 갱신 `0d003d6`·`b80acfa`가 추가됐고, 병합은 공개 자료 45파일을 보존했다. 앱·API·공용 로직·CI·의존성은 검증한 work와 같다.

최종 main CI41957058558의 application은 `share-monthly-dividends.test.mjs` 한 건에 실패했다. 기존 테스트는 계속 갱신되는 공개 YMAX history로 11월 3일의 고정 예상값을 검사했다. work 스냅샷에는 11월 4일 배당락·0.0528·선언일 11월 3일인 보도자료 한 건이 있었지만, main 갱신에는 같은 배당락·금액·지급일에 선언일이 11월 4일인 운용사 페이지도 보존돼 있다.

기존 `toBacktestData`는 같은 등급에서 최근 선언일을 고르므로 11월 4일을 택한다. 따라서 11월 3일 기준 `shareMonthlyDividends`는 null을 반환하고, 테스트의 `Number(total?.toFixed(4))`가 NaN으로 나타난다. 운영 계산이 NaN을 반환한 것으로 보고하지 않는다.

이 변경은 과거 예상값 테스트를 검증된 `7d9218f`의 실제 관측 10개로 고정한다. `tests/fixtures/ymax-declaration-20261103.json`에 sourceCommit·sourcePath를 명시하며 앱은 이 파일을 소비하지 않는다. 금액이나 선언일을 맞추기 위해 운영 자료를 수정하지 않았다. 추가 합성 중복 테스트는 입력 순서와 무관하게 기존 최근 선언일 정책 및 3일 null·4일 0.0528을 검사한다. 기존 금액 예상값과 안전 조건은 유지한다.

두 공식 출처의 선언일이 다른 이유는 이 UI 작업에서 해결하지 않았다. 과거 시점에 알 수 있었던 자료의 해석과 수집·개정·충돌 보존은 별도 데이터 검토 사항이다. 임의로 더 이른 날짜를 채택하거나 금융 정의를 추가하지 않는다. 앱·API·수집·금융 계산·권한은 변경하지 않았고, 실계좌나 운영 자료를 쓰지 않았다.

관련 7개 사례, 빌드, 전체 단위 테스트 813개와 변경 테스트의 ESLint가 통과했다. 최초 전체 단위 검사는 새 checkout에서 빌드 전에 실행해 dist가 필요한 3개 검사에 실패했다. 해당 설정 오류 기록을 보존하고 빌드 후 813개를 다시 확인했다. 최종 main의 원래 실패를 재실행으로 숨기지 않으며 수정 PR의 원격 CI와 구분한다.

외부 증거는 `/workspace/stitch-v2-evidence/checks/phase30/`의 main-share-monthly-reproduction.log, share-snapshot-test.log, share-fix-build.log, share-fix-unit-before-build.log, share-fix-unit.log이다. 테스트 자료 고정은 출처 간 날짜 차이의 해결이나 전체 시각 수용을 뜻하지 않는다.

원격 게시 시 이전 work 기준 트리가 최신 공개 자료를 누락할 위험으로 자동 승인 검토에서 거절됐다. 해당 커밋은 게시하지 않고, 최신 main `8a32356df1ac29ba469791d209a9763bfdbfe2c4`에서 별도 브랜치를 구성했다. 변경은 테스트·스냅샷·이 문서 3파일뿐이며 public/src/api/lib에는 변경이 없다. 최신 main의 모든 공개 자료를 보존한 상태에서 빌드와 전체 단위 813개를 다시 통과했다. 원격 PR은 이 main 기준 변경만 포함한다.
