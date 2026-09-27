# 21. 공개 산출물 배당락 3회 보존

## 정책

- SQLite 원장, 공식 원문, `var/content-studio/generated`의 전체 번들은 삭제하지 않는다.
- `public/content-studio/renders`와 `content.json`에는 티커별 최근 **서로 다른 배당락일 3회**만 남긴다.
- 주배당·월배당·분기배당을 판별하거나 추정하지 않는다. 같은 기준이 모든 주기에 적용된다.

## 구현

- 정적 export는 티커마다 배당락일을 내림차순으로 확인해 최근 3개 날짜만 공개한다.
- 동일 티커·동일 배당락일의 중복 이벤트는 하나의 공개 bundle로 정리한다.
- 공개 캐시에서 제외된 이벤트 폴더만 제거한다. 전체 원본 bundle과 SQLite 이벤트는 그대로 보존된다.

## 기대 효과

- 산출물 화면의 목록 및 다운로드 JSON이 티커 수에 비례해 제한된다.
- 이미지가 모든 과거 이벤트에 누적되는 것을 방지하면서 최근 3회 비교 콘텐츠는 계속 제공한다.

## 검증 결과

- `python -m unittest discover -s tests/content_pipeline -v`: 26 passed
- `npm run type-check`: passed
- 공개 캐시 적용 후: 3,616개 이벤트 폴더 / 65.3MB에서 203개 / 24.7MB로 감소했다. `renders.json`은 2.59MB에서 0.16MB, `content.json`은 7.28MB에서 0.43MB가 됐다.
- `npm run build`는 콘텐츠 스튜디오와 무관한 기존 legacy portfolio 파일 `src/components/portfolio/DividendChart.vue`의 `vue-echarts` `useECharts` export 오류로 실패했다.
