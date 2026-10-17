---
name: git-ship
description: 현재 작업을 검증한 뒤 커밋·푸시·PR 생성 또는 재사용·병합·병합된 작업 브랜치 삭제까지 한 번에 완료한다. 사용자가 $git-ship, 커밋 푸시 머지, 커밋부터 병합까지, 병합 브랜치 삭제까지 한 번에 등을 요청할 때 적용한다. 배포 확인은 요청에 포함된 경우 추가한다.
---

# 커밋부터 병합 브랜치 정리까지

## 실행 범위

- 이 스킬을 실행해 달라는 요청은 검증 → 커밋 → 푸시 → PR → 병합 → 해당 작업 브랜치 정리까지의 승인이다. 단계마다 다시 확인을 요청하지 않는다.
- 스킬 작성·설명만 요청한 경우에는 Git 작업을 실행하지 않는다.
- 기본 정리 대상은 이번 작업 브랜치 하나다. 다른 병합 브랜치 전체 정리는 별도 요청이 있을 때만 수행한다.
- 사용자가 커밋·푸시까지만 등 범위를 제한하면 그 지시를 우선한다. 배포를 명시하면 마지막 배포 확인 절도 수행한다.
- 저장소의 AGENTS.md, README.md, 변경 영역의 지침을 읽는다. 시작할 때 이 스킬을 사용한다고 알리고, 대기 중에도 약 60초마다 진행 상황을 전한다.

## 1. 대상과 현재 상태 확인

```bash
git status --short
git branch --show-current
git remote
git worktree list --porcelain
git diff --stat
git diff --cached --stat
gh auth status
```

원격 URL은 메모리에서만 읽어 사용자 정보·토큰·query를 제거한 호스트와 저장소 경로만 확인한다. 원문 URL이나 `git remote -v` 출력은 남기지 않는다. 다음 대상을 별도로 기록하고 기존 세션에서 확인한 값을 재사용한다.

- `base_repo`: PR을 병합할 OWNER/REPO, `base_remote`: 그 저장소를 가리키는 Git 원격.
- `push_remote`: 작업 브랜치를 푸시하고 삭제할 원격, `head_owner`: 해당 저장소 소유자.
- 같은 저장소에서는 두 원격 모두 보통 origin이다. fork에서는 base 원격과 push 원격을 구분한다. 예시의 변수를 확인한 값으로 설정한 뒤 실행한다. 모든 `gh` 명령은 `--repo "$base_repo"`를 사용한다.

```bash
git fetch "$base_remote" --prune
gh repo view "$base_repo" --json defaultBranchRef --jq '.defaultBranchRef.name'
```

- 조회 결과를 `base_branch`, 작업 브랜치를 `task_branch`로 기록한다. 브랜치명과 PR 제목·본문은 셸 코드로 보간하지 않고 인자 또는 파일로 전달한다.
- 현재 기본/보호 브랜치에서 작업 중이면 변경을 보존한 채 의미 있는 새 작업 브랜치를 만든다. 만든 직후 `task_branch`를 새 이름으로 갱신하고 `git branch --show-current`와 일치하는지 확인한다. `git check-ref-format --branch "$task_branch"`로 유효성을 검사하고 base·보호 브랜치와 다름을 다시 확인한다. 기본 브랜치에 직접 커밋·푸시하지 않는다.
- detached HEAD나 충돌 중인 merge/rebase가 있으면 원인부터 확인한다. 기존 작업을 덮어쓰거나 임의로 abort하지 않는다.
- diff와 새 파일을 읽고 이번 요청에 속하는 파일만 선택한다. 비밀 파일, 인증 상태, 빌드 산출물, 무관한 사용자 변경은 포함하지 않는다. 상태 출력이나 PR에 자격 증명을 남기지 않는다.
- 변경도 미푸시 커밋도 없으면 기존 PR·병합 상태를 확인해 남은 단계만 수행한다. 빈 커밋이나 중복 PR을 만들지 않는다.

## 2. 변경 검증과 커밋

기존 대화에서 같은 변경을 이미 검증했고 이후 관련 수정이 없으면 그 결과를 재사용한다. 문서·스킬만 바뀌면 링크·명령·예시와 diff를 확인하며 앱 빌드는 하지 않는다. 앱 코드 변경은 저장소 지침에 따라 타입 검사, 관련 테스트, 필요한 브라우저 검사·빌드를 실행한다.

- 커밋 전 index 전체가 검토한 변경과 정확히 일치하는지 확인한다. 기존 무관한 staged 변경이나 같은 파일의 무관한 hunk가 있으면 일반 `git add`/`git commit`을 실행하지 않는다. 별도 임시 index 또는 worktree에 이번 요청의 hunk만 격리하여 커밋하고 원래 staged/unstaged 상태를 보존한다. 무관한 변경을 임의로 unstage·stash·reset하지 않는다. 이미 커밋된 작업만 있으면 커밋 단계를 생략하고 푸시로 진행한다.

```bash
git diff --check
git add -- <검토한 파일 경로들>
git diff --cached --check
git diff --cached
# staged diff 전체가 이번 요청에 속할 때만 커밋한다.
if ! git diff --cached --quiet; then
    git commit -m '<변경 목적을 설명하는 커밋 메시지>'
fi
```

- 검증 실패는 원인을 수정하고 관련 검사만 다시 실행한다. 기존 경고와 새 실패를 구별하고 실패를 성공으로 보고하지 않는다.
- `git add .`, 무검토 `git add -A`, `--no-verify`, secret 검사 우회, 기존 커밋의 무단 amend는 사용하지 않는다.
- `$base_remote/$base_branch`의 원격 base가 앞서 있으면 작업을 보존하며 통합한다. 새 로컬 미푸시 커밋은 rebase할 수 있고, 이미 공유한 브랜치는 원격 변경을 merge하여 강제 푸시를 피한다. 충돌은 실제 의도를 확인하고 해소한 뒤 영향받는 검사를 수행한다.
- 다른 사용자가 추가한 원격 작업 커밋을 덮어쓰지 않는다. 일반 push가 거절되면 fetch하여 원인과 diff를 확인한다.

## 3. 푸시와 PR 생성/재사용

```bash
git push -u "$push_remote" "refs/heads/$task_branch:refs/heads/$task_branch"
git rev-parse HEAD
gh pr list --repo "$base_repo" --head "$task_branch" --base "$base_branch" --state open --json number,url,headRefOid,headRepositoryOwner,headRepository
```

푸시한 SHA를 `reviewed_head`로 기록한다. 검색한 PR의 head 저장소·소유자가 push 대상과 일치하는지도 확인하고 같은 작업의 PR만 재사용한다. PR이 없으면 `pr_head`를 같은 저장소에서는 `task_branch`, fork에서는 `head_owner:task_branch`로 설정한다. 변경의 문제와 결과, 실제 검증, 미검증 범위를 담은 본문은 `mktemp`로 만든 이번 실행 전용 파일에 작성하고 사용 후 삭제한다. 파일 내용은 구조화된 도구나 실행되지 않는 literal로 전달한다.

```bash
# 전용 셸에서 실행해 성공·실패 모두 임시 파일을 정리한다.
pr_body_file=$(mktemp "${TMPDIR:-/tmp}/git-ship-pr.XXXXXXXX.md")
trap 'rm -f -- "$pr_body_file"' EXIT
# 이 파일에 검토한 본문을 작성한 뒤 실행한다. 고정 경로를 재사용하지 않는다.
gh pr create --repo "$base_repo" --base "$base_branch" --head "$pr_head" --title '<최종 변경을 설명하는 제목>' --body-file "$pr_body_file"
rm -- "$pr_body_file"
trap - EXIT
```

대화 이력보다 최종 변경을 설명한다. 본문은 실제 줄바꿈을 보존한다. PR 댓글·리뷰 요청·외부 알림은 별도로 요청받지 않았다면 보내지 않는다.

## 4. 검사 완료와 병합

```bash
gh pr view "$pr_number" --repo "$base_repo" --json state,isDraft,mergeable,reviewDecision,headRefOid,baseRefName,statusCheckRollup
gh pr checks "$pr_number" --repo "$base_repo" --watch --interval 15
```

- `gh pr checks --help`로 설치된 버전의 옵션 타입을 확인한다. 현재 저장소 환경은 정수 초 단위 `--interval 15`이며, duration 타입 버전에서만 `15s`를 사용한다.
- PR이 대상 base와 `reviewed_head`를 가리키는지 확인한다. 새 커밋이 추가됐으면 변경을 다시 확인하고 검증 결과를 갱신한다.
- 필수 검증과 관련 CI·배포 검사가 성공한 뒤 병합한다. 검사 없음과 실패·진행 중을 구분한다. 검사가 등록되지 않은 저장소는 실제 로컬 검증을 근거로 진행할 수 있다.
- 접근 가능한 실패 로그를 조사하고 허용된 범위에서 수정한다. 권한 오류는 동일한 저장소·프로젝트의 승인된 대체 경로가 있으면 사용한다. 권한이나 필수 리뷰를 우회하지 않는다.
- 기본 병합 방식은 merge commit이다. 저장소에서 허용하지 않으면 허용된 squash/rebase 방식을 선택하고 선택 이유를 보고한다. `--admin`이나 브랜치 보호 우회는 사용하지 않는다.

```bash
gh pr merge "$pr_number" --repo "$base_repo" --merge --match-head-commit "$reviewed_head"
gh pr view "$pr_number" --repo "$base_repo" --json state,mergedAt,mergeCommit,headRefOid
```

병합 명령 성공만으로 완료를 가정하지 않는다. 실제 `MERGED`, 병합 커밋, 검토한 head SHA를 확인한다. 이미 병합된 PR이면 같은 확인 후 다음 단계로 간다. 필수 리뷰·권한 부족 등 해결할 수 없는 외부 조건은 정확히 보고하고 완료한 단계까지 보존한다.

## 5. 병합된 작업 브랜치 삭제

```bash
git fetch "$base_remote" --prune
git status --short
git ls-remote --heads "$push_remote" "refs/heads/$task_branch"
```

- 기본·보호·장기 운영 브랜치와 다른 작업자의 브랜치는 삭제하지 않는다. 이번 PR이 실제 병합됐고 원격 브랜치가 여전히 `reviewed_head`일 때만 삭제한다. 병합 후 커밋이 추가됐으면 보존하고 이유를 보고한다.
- 원격 브랜치가 이미 없으면 정상 완료로 취급한다. 존재할 때는 아래처럼 삭제 대상의 SHA를 lease로 제한해 확인 후 추가된 커밋을 보호한다. 이는 해당 ref 삭제만 허용하며 브랜치의 강제 갱신에는 사용하지 않는다.

```bash
git push --force-with-lease="refs/heads/${task_branch}:${reviewed_head}" "$push_remote" ":refs/heads/${task_branch}"
```

현재 작업 트리와 index가 깨끗하고 다른 worktree에서 base를 사용 중이지 않으면 base로 이동해 fast-forward한다. switch 직전에 untracked 파일까지 포함한 상태를 다시 확인한다. 편집기나 다른 작업자가 동시에 수정 중이면 로컬 정리를 보류한다. switch 직후에도 상태를 확인하고 변경이 발견되면 병합·로컬 브랜치 삭제를 중단해 작업을 보존한다. 사용자 변경이 생겼으면 강제 checkout/reset/stash를 하지 말고 보존한다.

```bash
git status --porcelain=v1 --untracked-files=all
# 깨끗하고 동시 편집이 없음을 확인한 뒤 이동한다.
git switch "$base_branch"
git status --porcelain=v1 --untracked-files=all
# 여전히 깨끗한 경우에만 아래 정리를 계속한다.
git merge --ff-only "$base_remote/$base_branch"
git branch -d -- "$task_branch"
git fetch "$base_remote" --prune
git status --short
```

- 로컬 base가 분기됐거나 다른 worktree에서 사용 중이면 그 상태를 보존하고 원격 정리 결과와 로컬 미정리 이유를 구분한다.
- 다른 worktree에서 사용하는 작업 브랜치는 로컬 삭제를 건너뛴다.
- squash/rebase 병합 때문에 `-d`가 거절되면 먼저 PR의 실제 병합 상태와 로컬 브랜치 SHA가 `reviewed_head`와 동일한지 확인한다. 추가 로컬 커밋·미커밋 변경·다른 worktree 사용이 없음을 확인한 경우에만 해당 작업 브랜치에 한해 `git branch -D -- "$task_branch"`로 정리할 수 있다. 증명할 수 없으면 보존한다.
- 마지막으로 `git ls-remote --heads "$push_remote" "refs/heads/$task_branch"`에서 원격 작업 ref가 사라졌는지 확인한다. base와 push 원격이 다르면 두 원격의 추적 ref를 각각 prune한다. 삭제 거절을 무시하고 삭제 완료라고 보고하지 않는다.

## 6. 배포가 요청에 포함된 경우

기존 Git 연동과 CI를 우선 사용하며 중복 배포를 만들지 않는다. 배포 대상과 환경을 확인하고 해당 배포 스킬을 적용한다. 운영 브랜치 병합이 배포를 촉발하면 그 실행을 추적한다.

이 저장소는 Pages와 Vercel을 사용한다. 정확한 병합 커밋으로 두 운영 사이트의 버전을 확인한다.

```bash
node scripts/deploy/verify-release.mjs --sha "$merge_sha"
```

로컬 checkout이 병합 커밋과 동일한 데이터인지 먼저 확인한다. 프록시가 필요한 실행 환경에서 Node가 프록시를 자동 사용하지 않으면 지원하는 Node 버전에서 `node --use-env-proxy`로 실행한다. 프록시·TLS 검증을 우회하지 않는다.

페이지·API의 관련 흐름도 실제 운영 주소에서 읽기 중심으로 확인한다. 개인 자료나 운영 DB에 테스트 쓰기를 하지 않는다. 배포 완료와 관측하지 못한 로그·인증 쓰기 흐름을 구분한다.

## 최종 보고

간결하게 PR 링크, 최종 커밋, 푸시·병합·원격/로컬 브랜치 삭제 결과, 검증 결과를 보고한다. 배포가 포함됐다면 운영 URL과 버전 확인 결과도 포함한다. 실패·진행 중·외부 조건으로 남은 단계가 있으면 완료라고 뭉뚱그리지 않는다.
