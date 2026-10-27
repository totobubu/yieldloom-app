# 앱 배포와 릴리스 확인

운영 절차는 [git-ship](../../.agents/skills/git-ship/SKILL.md), 실행 정의는
[Pages workflow](../../.github/workflows/deploy-pages.yml)와 기존 Vercel Git 연동을 따른다.
이 문서의 과거 `deploy.yml`·자동 R2 업로드·항상 동기화 설명은 현재 구현과 달라 폐기한다.

## 환경과 배포 범위

- 기능 PR은 `work`를 대상으로 검증하고, `work` 병합 후 Vercel Preview를 확인한다.
- 운영 승격은 검토한 원격 `work` 전체 diff와 승인을 확인한 뒤 `work` → `main` PR로 수행한다.
  승격 시 포함되는 기존 PR과 새 변경을 구분한다. 보호 브랜치 직접 푸시로 대체하지 않는다.
- Pages는 main push에서 빌드·배포한다. `data-v2/**`·`docs/**`만 바뀌면 `paths-ignore`로
  생략될 수 있다. 수동 실행은 승인된 main 커밋의 `release_sha`로 정확한 대상을 지정한다.
- Vercel은 기존 Git 연동의 배포·alias·실제 운영 응답을 확인한다. Pages 성공이
  Vercel 성공을 뜻하지 않으며 기존 자동 배포가 진행 중이면 중복 수동 배포를 만들지 않는다.

현재 Pages workflow에는 R2 업로드 단계가 없다. 데이터 수집·검토 후보·core 발행은
[데이터 workflow 안내](../data-management/WORKFLOWS.md)의 별도 경로다.
앱 배포를 R2 원문·가격 이력·비공개 장부 이관 또는 데이터 발행 완료로 간주하지 않는다.

## 검증과 완료 판정

병합 전 해당 head의 관련 CI·필수 리뷰를 확인한다. 병합 명령 성공 뒤 실제 MERGED 상태와
main 병합 SHA를 다시 조회한다. 검사 없음·진행 중·실패를 성공으로 표시하지 않는다.

병합 커밋과 동일한 checkout에서 다음을 실행한다. 다른 checkout의 데이터를 유지한 채
`--sha`만 바꾸면 기대 해시가 다른 커밋에서 계산될 수 있으므로 사용하지 않는다.

```sh
node scripts/deploy/verify-release.mjs --sha <검증한-main-병합-SHA>
# Node가 환경 프록시를 자동 사용하지 않으면 지원 버전에서 실행한다.
node --use-env-proxy scripts/deploy/verify-release.mjs --sha <검증한-main-병합-SHA>
```

실제 운영 주소는 [Pages](https://totobubu.github.io/yieldloom-app/)와
[Vercel](https://yieldloom-app.vercel.app/)이다. 양쪽 `app-release.json`의 commit과
metadataSha256이 기대값과 일치해야 동기화 완료다. 해시는 카탈로그·기초자산·수집 상태의
공개 메타데이터 3개 파일만 포함하며 전체 가격·배당·개인 장부 검증은 별도다.
개인 API는 익명 요청 차단과 관련 읽기 흐름을 확인하되 운영 테스트 쓰기는 하지 않는다.

코드 완료, 테스트 통과, 실데이터 검증, 플래그/일정 활성화, 양쪽 배포 완료를 구분해
SHA·검사 링크·실제 URL·해시·미확인 범위를 보고한다. 기본 OFF는 배포 후에도 OFF다.

## 통합 인계

원본 수집·장부 작업의 최종 PR/head·CI·쓰기 중단을 확인한 단일 실행자만 통합·배포한다.
기존 두 PR의 승인을 이후 새 기능·정책 변경·운영 데이터 쓰기·권한 확대로 확대하지 않는다.
새 변경의 운영 병합·배포는 변경 범위와 검증 결과를 제시하고 승인을 받은 뒤 진행한다.
기존 승인된 정확한 범위는 재승인 없이 진행한다.

결정 출처: 통합 배포 점검 `01a17c29-e9dc-7616-bfa1-bfead86f30ec` 및 통합 인계 요청
(2026-10-27). 기존 인계 요약은 전체 대화 원문 이전이 아니다.
