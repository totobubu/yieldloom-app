# 4단계 완료 보고서: YieldMax, Roundhill, REX 공식 수집기

- 완료일: 2026-09-19
- 구현 공급자: YieldMax, Roundhill Investments, REX Shares

## 수행 내용

- 공급자별 공식 URL allowlist를 적용한 HTTPS 수집기를 추가했다.
- HTML 표 헤더의 의미를 기준으로 데이터를 읽는 표준 라이브러리 파서를 구현했다.
- 공급자별 `discover`, `fetch`, `parse` 어댑터를 구현했다.
- `collect.py` CLI에서 자동 발견 또는 명시적 공식 URL을 처리할 수 있게 했다.
- 원문 HTML을 SHA-256 파일명으로 보존하고 SQLite에 출처와 이벤트를 연결한다.
- `--dry-run`은 데이터베이스나 원문 파일을 변경하지 않고 파싱 결과만 보고한다.

## 공급자별 정책

### YieldMax

- 1순위: 주간 배당 공식 보도자료의 전체 표
- fallback: 개별 ETF 공식 페이지의 Distribution History
- 선언일, 배당락일, 기준일, 지급일과 ROC를 읽는다.

### Roundhill

- Roundhill이 신고한 Cboe 공식 배당 통지의 통합 표를 사용한다.
- Roundhill 추적 티커 allowlist 밖의 행은 저장하지 않는다.
- 공급자 공식 발표와 거래소 공식 통지를 교차 확인하는 의미로 `cross_checked` 상태를 부여한다.

### REX

- REX 공식 News & Insights의 Latest Distributions 표를 사용한다.
- 표에 선언일이 없으므로 관측일을 선언일 대용으로 기록하고 자동 확정하지 않도록 `needs_review` 상태를 부여한다.

## 검증

- 전체 Python 단위 테스트 7건: 통과
- 비공식 도메인 URL 차단 테스트: 통과
- 실제 YieldMax TSLY 공식 페이지: 84개 이력 파싱 성공
- 실제 Cboe Roundhill 통지: 15개 이벤트 파싱 성공
- 실제 REX 공식 최신 배당 표: 4개 이벤트 파싱 성공
- `git diff --check`: 통과

YieldMax 보도자료의 GlobeNewswire 원문은 현재 실행 환경에서 읽기 시간이 초과됐다. 같은 데이터를 확인할 수 있는 YieldMax 개별 공식 ETF 페이지 fallback은 실데이터 검증을 통과했다.

## 다음 단계

수집 실행 이력, 검증 결과, 최근 발표와 검토 대기 항목을 한눈에 볼 수 있는 콘텐츠 스튜디오 대시보드를 구현한다.
