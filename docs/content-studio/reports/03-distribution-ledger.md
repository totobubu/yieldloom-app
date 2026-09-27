# 3단계 완료 보고서: 배당 원장과 공통 공급자 모델

- 완료일: 2026-09-19
- 데이터베이스: `var/content-studio/distribution-events.sqlite`
- 스키마 버전: 1

## 수행 내용

- Python 표준 라이브러리 `sqlite3` 기반 배당 콘텐츠 원장을 추가했다.
- 공급자, 공식 원문, 배당 이벤트, 검증 결과, 파이프라인 실행 이력을 분리해 저장한다.
- 금액은 부동소수점이 아닌 원문 정밀도를 유지하는 decimal 문자열로 저장한다.
- 공식 원문은 SHA-256으로 식별해 같은 문서를 반복 수집해도 중복되지 않는다.
- 배당 이벤트는 공급자, 티커, 선언일, 배당락일로 안정적인 `event_key`를 만들고 공식 정정 시 같은 이벤트를 갱신한다.
- 공급자 구현이 따라야 할 `discover → fetch → parse` 어댑터 규약을 추가했다.
- 데이터베이스 초기화 및 상태 확인 CLI를 추가했다.

## 핵심 파일

- `scripts/content_pipeline/schema.sql`
- `scripts/content_pipeline/models.py`
- `scripts/content_pipeline/database.py`
- `scripts/content_pipeline/providers/base.py`
- `scripts/content_pipeline/manage.py`
- `tests/content_pipeline/test_database.py`

## 검증

- SQLite 초기화: 통과
- 빈 데이터베이스 summary: 5개 테이블 모두 0건으로 정상 생성
- 단위 테스트 2건: 통과
  - 공식 원문 및 배당 이벤트 중복 입력의 멱등성
  - 소수점 정밀도 보존
  - 잘못된 티커와 0 이하 배당금 거부
- `git diff --check`: 통과

시스템 기본 `python.exe`는 WindowsApps 자리표시자 오류로 실행되지 않아 Codex 작업 공간 번들 Python으로 검증했다. 프로젝트 코드는 일반 Python 3 표준 라이브러리만 사용한다.

## 저장 정책

- SQLite 실행 파일, 원문 아카이브, 생성 결과물은 Git에서 제외한다.
- 스키마, 파서, 테스트, 보고서만 Git으로 버전 관리한다.
- 기존 `public/data` 시세 JSON은 변경하지 않았다.

## 다음 단계

YieldMax, Roundhill, REX 공식 소스 어댑터를 구현하고 저장된 HTML fixture를 이용해 네트워크 없이 반복 검증 가능한 파서 테스트를 추가한다.
