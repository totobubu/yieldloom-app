# YieldMax 월배당 관측 연결과 복구

BIGY·RNTY·SOXY는 월배당이다. 종목별 공식 표가 2026-09-01 선언에서 멈췄지만,
발행사 뉴스 목록이 연결하는 GlobeNewswire 공식 발표에 10월·11월 행이 있다.
공식 표와 보도자료는 같은 원장·원문 보존·중복/충돌 검증을 사용한다.

| 선언일 | 배당락·기준일 | 지급일 | BIGY USD | RNTY USD | SOXY USD |
| --- | --- | --- | --- | --- | --- |
| 2026-10-06 | 2026-10-07 | 2026-10-08 | 0.5323 | 0.4614 | 0.9992 |
| 2026-11-03 | 2026-11-04 | 2026-11-05 | 0.4977 | 0.4785 | 0.7730 |

근거:
- 발행사 뉴스 목록: https://yieldmaxetfs.com/news/
- 10월: https://www.globenewswire.com/news-release/2026/10/06/3375298/0/en/yieldmax-etfs-announces-distributions-on-bigy-rnty-and-soxy.html
- 11월: https://www.globenewswire.com/news-release/2026/11/03/3394019/0/en/yieldmax-etfs-announces-distributions-on-bigy-rnty-and-soxy.html

2026-11-03 R2 읽기 대조에서 `divgrow-data/data/nyse/{bigy,rnty,soxy}.json`의
10월 7일 `amountFixed`는 위 공식 값과 일치했다. 일반 파일은 그대로 보존한다.
해당 파일의 `announcementDate=2026-10-07`은 공식 선언일 10월 6일과 다르며,
이번 복구에서 원문·기존 값을 자동 정정하지 않는다. SOXY 일반 파일의 9월 4일 행도
이 작업의 자동 정정 대상이 아니다. 과거 전체 일반 이력의 완전성을 선언하지 않는다.

`monthly` 그룹은 기존 매일 4회 복구 슬롯에서 관측한다. 매월 첫 화요일을 관측의
명목 기준으로 쓰고 전후 3일을 확인한다. 주간 그룹의 발표 직후 집중 슬롯은 유지한다.
월 중간에 가상의 주간 회차를 만들지 않고, 이전 월과 다음 월 경계를 계산한다.
일정은 관측 힌트이며 공식 날짜를 바꾸지 않는다. 연말·휴일 등 창 밖 공식 발표는
`group=monthly`, 실제 `declarationDate`, 명목 `cycleDate`로 수동 매핑한다.

복구는 배포된 `observe-yieldmax.yml`의 수동 실행을 사용한다. 10월과 11월을 각각
`group=monthly`, `declarationDate=2026-10-06` / `2026-11-03`으로 실행한다.
`content-studio-state-write` 공용 잠금 안에서
`content-studio/state/latest.tar.gz`를 복원하고 원문·관측 원장을 누적 저장한다.
성공·검증된 공개 출력만 게시한다. 로컬 빈 원장으로 운영 상태를 대체하지 않는다.
재실행은 이미 확보된 회차를 확인하고 수집·게시를 건너뛴다.

회귀 검증은 월별 원문 표 발췌, 행별 날짜·금액·주기, 불완전/충돌 날짜 거부,
월/연 경계, 수동 회차 검증, 일부 날짜 확보 후 나머지 보도자료 탐색,
공용 수집→SQLite→공개 스냅샷→재실행 경로를 포함한다.
원문 표 테스트 fixture는 각 공식 발표의 표와 발행일 메타데이터 발췌다.
