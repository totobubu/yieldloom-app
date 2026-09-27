# 6단계 완료 보고서: 콘텐츠 템플릿과 이미지 자동 생성

- 완료일: 2026-09-19
- 기본 출력: `var/content-studio/generated/<선언일>-<티커>-<이벤트ID>/`

## 수행 내용

- 검증 상태가 `official` 또는 `cross_checked`인 이벤트만 기본 생성 대상으로 제한했다.
- 동일 티커의 직전 공식 배당 기록을 찾아 증감률을 소수점 한 자리로 계산한다.
- 이벤트 한 건에서 다음 묶음을 동시에 생성한다.
  - `toss.txt`: 토스 커뮤니티용 짧은 문구
  - `naver-blog.md`: 네이버 블로그용 구조화 원고
  - `social-square.html`: 1080×1080 소셜 카드 원본
  - `blog-cover.html`: 1200×630 블로그 커버 원본
  - `manifest.json`: 이벤트, 공식 출처와 산출물 목록
- Playwright 렌더러가 HTML 원본을 동일 규격 PNG 두 장으로 변환한다.
- Windows에서는 번들 Chromium이 없을 때 설치된 Microsoft Edge를 자동 fallback으로 사용한다.

## 품질 게이트

- `needs_review` 이벤트는 기본적으로 생성되지 않는다.
- 예외적으로 검토용 초안을 만들 때만 `--allow-review`를 명시해야 한다.
- 모든 문구에 공식 출처 URL과 투자 권유가 아니라는 고지를 포함한다.
- 숫자와 날짜는 AI가 재작성하지 않고 SQLite의 정규화 값을 직접 사용한다.

## 실행 방법

```powershell
npm run content:generate
npm run content:images -- var/content-studio/generated/<생성된-폴더>
```

특정 이벤트는 `python scripts/content_pipeline/generate_content.py --event-id <ID>`로 생성한다.

## 검증

- Python 단위 테스트 9건: 통과
- 직전 배당 대비 `+6.4%` 계산: 통과
- 1080×1080, 1200×630 HTML 원본 및 manifest 생성: 통과
- 실제 Edge 렌더링으로 PNG 2종 생성: 통과
- 1080×1080 샘플 이미지 육안 검사: 잘림, 대비, 한글 표시 통과

## 다음 단계

생성된 manifest를 콘텐츠 캘린더 레코드로 누적하고, 선택적으로 Notion 데이터베이스에 동기화한다.
