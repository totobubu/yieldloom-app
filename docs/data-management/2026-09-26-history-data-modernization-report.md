# 장기 시세·배당 데이터 고도화 보고서

작성일: 2026-09-26

## 완료 결과

`public/data`와 `public/content-studio`의 JSON 공백을 제거해, 가격·배당·예측 행을 삭제하거나 반올림하지 않고 저장 공간을 줄였다.

| 항목 | 이전 | 이후 | 변화 |
| --- | ---: | ---: | ---: |
| JSON 파일 | 2,312 | 2,312 | 유지 |
| JSON 크기 | 2,245,770,135 B | 1,277,202,611 B | -43.13% |
| 보존한 backtestData 행 | 8,575,096 | 8,575,096 | 유지 |
| `public/content-studio` 공개 JSON | 41.1 MB | 5.75 MB | 중복 export 제거 및 minify |

원본은 `C:\workspace\divgrow-data-archive\history-20260920-pre-compaction-retry.zip`에 보관했다. ZIP CRC 검사 결과는 `None`이며, 원본 파일·매니페스트 2,313개가 포함된다.

## 장기 이력 정책

10년 절단은 적용하지 않는다. 최초 수집에 기준일이나 상장일을 쓰며, 이미 있는 시계열은 삭제하지 않는다. 배당은 최신 건만 증분 수집하던 방식을 최근 120일 재조회로 바꿨다. Yahoo 관측값이 기존 과거 값과 다르면 기존 값을 덮어쓰지 않고 SQLite의 `dividend_conflicts`에 검토 대상으로 기록한다.

`history_sources`는 기존 JSON을 다시 복사하지 않고 경로·SHA-256·행 수·최초/최종 가격일을 SQLite 원장에 등록한다. 현재 2,168개 listing, 8,575,096개 이력 행, 2,259개 기업행동, 41개 배당주기 변경을 색인했다.

## 분할 및 배당 비교 보정

Yahoo 비율은 `new shares : old shares`다. 따라서 `2:1`은 순분할, `1:8`은 역분할이다. 수집기와 감지기의 역전된 판단을 수정했고, 기존 데이터의 781개 파일, 2,259개 이벤트 라벨을 정정했다. 가격·배당 원시 수치는 수정하지 않았다.

공개 배당 이력은 분할 또는 배당주기 변경을 넘어서 직전 배당·4회/12회 평균을 계산하지 않는다. 이 구간에서는 `comparisonBasis: corporate_action_or_frequency_change`를 기록한다.

## 데이터 출처 운영

| 목적 | 우선 출처 | 역할 |
| --- | --- | --- |
| ETF 배당·배당일 | 운용사 공식 공지와 펀드 이력 | 채택값 및 원문 보관 |
| 일반 주식 배당·분할 | 발행사/거래소 공지 | 채택값 확인 |
| 장기 가격·이벤트 탐지 | Yahoo | 기존 역사 보충·대조 |
| 실시간 가격·보유자산 | Toss | 서버 측 snapshot과 현 시세 |
| 독립 장기 EOD 대조 | Tiingo | raw/adjusted 가격·배당·분할 대조 |

Toss `candles` API는 페이지당 200개 일봉과 `nextBefore` cursor를 제공한다. 현재 명세는 가장 오래된 제공일을 보장하지 않으므로, Toss만으로 장기 아카이브를 대체하지 않는다. `history_sources.py`는 실제 요청이 목표 시작일에 도달했는지 `startReached`로 기록한다. Tiingo도 같은 방식의 보조 관측 경로로 준비했다.

## 검증

- JSON 컴팩션: UTF-8 JSON 파싱 후 토큰 단위로 공백만 제거
- 원본 보관: ZIP CRC `None`
- SQLite: `PRAGMA integrity_check = ok`
- Python 테스트: data pipeline 11건, content pipeline 29건 통과
- Node 테스트: 기업행동·Yahoo event object·이중 조정 방지 4건 통과
- TypeScript: `npm run type-check` 통과

## 운영 명령

```powershell
npm run data:audit-size
npm run data:compact
npm run data:repair-splits
npm run data:register
python scripts/data_pipeline/history_sources.py toss GE --start 1962-01-02
python scripts/data_pipeline/history_sources.py tiingo GE --start 1962-01-02
```

Toss와 Tiingo의 마지막 두 명령은 각각 `TOSS_ACCESS_TOKEN`, `TIINGO_API_TOKEN`을 서버 환경변수로 설정한 경우에만 실행한다. 관측 결과는 `var/data-management/observations`에 저장하며 기존 가격 원장을 덮어쓰지 않는다.

## GitHub Actions 정리

자동 데이터 쓰기 작업은 가격 갱신과 배당·정보 갱신이 별도 동시성 그룹에서 실행되고, push 실패 시 `git pull --rebase`로 재시도하고 있었다. 두 작업이 같은 `public/data`를 생성하므로 이 방식은 충돌을 자동 증폭시킬 수 있다.

다음 원칙으로 정리했다.

- `Market Data v2 US`, `Update Info Data v2 (US)`, 수동 `Regenerate Data`가 `repository-generated-data-write` 단일 잠금을 공유한다.
- 작업 시작 시 `main` 최신성을 확인하고, push 충돌 시 rebase를 시도하지 않는다. 다음 예약 실행이 새 `main`에서 재생성한다.
- 자동 커밋은 생성 대상 경로만 stage한다. `git add .`은 사용하지 않는다.
- R2 수동 업로드는 읽기 전용으로 바꿔 업로드가 저장소 커밋을 만들지 않도록 했다.
- 중복된 수동 `Regenerate Nav + Calendar Events`, `Regenerate Nav + Sidebar` 워크플로는 제거하고 `Regenerate Data`로 통합했다.
- Pages 배포는 R2에서 제공되는 생성 데이터만 바뀐 경우 건너뛰어, 매일의 데이터 커밋이 불필요한 Pages 빌드를 유발하지 않게 했다.
