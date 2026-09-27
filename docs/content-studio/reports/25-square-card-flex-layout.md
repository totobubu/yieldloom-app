# 25. 정사각형 썸네일 플렉스 레이아웃 보정

## 완료 사항

- 카드 최상위 컨테이너를 `display: flex`, `flex-direction: column`,
  `justify-content: space-between`으로 변경했다.
- 헤더 왼쪽에는 공급자명, 오른쪽에는 `Made by 토또부부`를 표시한다.
- 티커와 주당 배당금을 같은 행에서 더 큰 크기로 표시한다.
- 푸터를 카드 하단에 고정하고 공시일·배당락일·지급일 값을 더 크게 표시한다.
- 주배당 월별 표의 `최근 월별 주배당 합계 예정값 제외` 문구를 제거했다.

## 검증

- `python -m unittest discover -s tests/content_pipeline -v`: 26 passed
- `npm run type-check`: passed
- 공개 콘텐츠 스튜디오 데이터 재내보내기 완료
- `2026-09-18-armw-67/social-square.png`를 육안 검수했다. 티커/금액은 같은
  행에 배치되고, 날짜 3종은 카드 안 하단에 모두 표시된다.

## 알려진 빌드 상태

- `npm run build`는 기존 개인 포트폴리오 컴포넌트
  `src/components/portfolio/DividendChart.vue`의 `vue-echarts` `useECharts`
  내보내기 불일치 경고로 완료 상태를 확인하지 못했다. 이번 썸네일 변경과는
  무관하며, 콘텐츠 스튜디오 타입 검사는 통과했다.

## 범위

- 원장 및 공식 원문 데이터는 변경하지 않았다.
- 이 변경은 이후 생성되는 정사각형 PNG와 재생성한 ARMW 산출물에 적용된다.
