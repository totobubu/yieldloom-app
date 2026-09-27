# 11단계 완료 보고서: 운영 자동화

## 구현

- `scripts/content_pipeline/pipeline.py`가 공식 수집, SQLite 반영, 검증 상태 게이트, 멱등 bundle 생성, 콘텐츠 캘린더, 주간 산출물, 대시보드 및 관리자 JSON 내보내기를 한 실행으로 묶는다.
- bundle 경로는 `선언일-티커-이벤트ID`, SQLite 이벤트는 `event_key` unique 제약을 사용해 반복 실행에도 중복을 만들지 않는다.
- 실패는 `pipeline_runs`와 `pipeline_run_steps`에 단계·공급자·오류·재시도 가능 여부로 남긴다. 공급자 수집 실패는 재시도 가능으로 기록한다.
- 수동 실행: `npm run content:run`. 수집 없이 산출물만 재생성: `npm run content:run -- --skip-collect`.
- Windows 예약 설치: `npm run content:schedule:install -- -Time 08:30`. Windows Task Scheduler에 일일 작업을 등록하며 외부 게시를 수행하지 않는다.

## 검증

- Python 콘텐츠 파이프라인 테스트: 통과 예정 실행 대상
- TypeScript 검사·프로덕션 빌드·브라우저 화면 QA는 이 단계 후 전체 확인으로 수행한다.
