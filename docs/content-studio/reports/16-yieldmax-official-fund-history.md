# 16. YieldMax 공식 펀드 이력 수집 전환

## 원인

- 기존 구현은 YieldMax 뉴스 목록에서 GlobeNewswire 보도자료를 발견해 수집했다.
- 현재 GlobeNewswire 개별 보도자료 요청은 타임아웃 또는 연결 종료로 실패해 수집 파이프라인 전체가 실패했다.

## 변경

- YieldMax 수집 출처를 `https://yieldmaxetfs.com/our-etfs/` 공식 ETF 목록과 각 공식 펀드 페이지로 전환했다.
- 각 `https://yieldmaxetfs.com/our-etfs/{ticker}/` 페이지의 배당 이력 표에서 주당 배당금, 선언일, 배당락일, 기준일, 지급일, ROC를 파싱한다.
- GlobeNewswire는 허용 도메인 및 탐색 경로에서 제거했다.
- YieldMax는 공식 펀드 이력을 모든 후보에 대해 수집할 수 있도록 기본 후보 상한을 100으로 설정했다. 다른 공급자의 기본 상한은 3으로 유지한다.

## 확인

- 실제 공식 TSLY 펀드 페이지 dry-run에서 배당 이력 84건을 파싱했다.
- 탐색 테스트는 GlobeNewswire 링크가 후보에 포함되지 않고 YieldMax 공식 펀드 페이지와 티커 메타데이터만 포함하는지 확인한다.
