#!/usr/bin/env bash
set -Eeuo pipefail

branch="${1:-${GITHUB_REF_NAME:-}}"
max_attempts="${CONTENT_STUDIO_PUBLISH_MAX_ATTEMPTS:-3}"

if [[ -z "$branch" ]]; then
  echo "[content-studio-publish] ERROR: target branch is empty." >&2
  exit 2
fi
if ! [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "[content-studio-publish] ERROR: CONTENT_STUDIO_PUBLISH_MAX_ATTEMPTS must be a positive integer (got '$max_attempts')." >&2
  exit 2
fi

git add -- public/content-studio/
if git diff --cached --quiet; then
  echo "[content-studio-publish] No public Content Studio changes to publish."
  exit 0
fi

title='chore: refresh Content Studio data [skip ci]'
if [[ "${REFRESH_SCOPE:-}" == 'ticker' && -n "${REFRESH_REQUEST_ID:-}" ]]; then
  # Manual single-ticker requests need normal deployment triggers.
  title='chore: 선택 종목 수집 데이터 갱신'
fi
git commit -m "$title" -m "Refresh-Request: ${REFRESH_REQUEST_ID:-}"

remote_ref="refs/remotes/origin/$branch"
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  echo "[content-studio-publish] Attempt $attempt/$max_attempts for origin/$branch."

  if ! git fetch --no-tags origin "refs/heads/$branch:$remote_ref"; then
    echo "[content-studio-publish] ERROR: unable to fetch origin/$branch; refusing to publish against an unknown remote head." >&2
    exit 1
  fi

  remote_head="$(git rev-parse "$remote_ref")"
  local_head="$(git rev-parse HEAD)"

  # A previous concurrent publisher may already have published this commit.
  if git merge-base --is-ancestor "$local_head" "$remote_head"; then
    echo "[content-studio-publish] Remote already contains local snapshot commit ($local_head); nothing to push."
    exit 0
  fi

  if ! git merge-base --is-ancestor "$remote_head" "$local_head"; then
    echo "[content-studio-publish] Remote advanced to $remote_head; replaying the snapshot commit on top of it."
    if ! git rebase "$remote_ref"; then
      conflicted="$(git diff --name-only --diff-filter=U || true)"
      git rebase --abort || true
      if [[ -n "$conflicted" ]]; then
        echo "[content-studio-publish] ERROR: snapshot rebase conflicts with concurrent changes in:" >&2
        while IFS= read -r path; do [[ -n "$path" ]] && echo "  - $path" >&2; done <<< "$conflicted"
        echo "[content-studio-publish] No files were force-pushed or overwritten. Resolve these paths and rerun the provider refresh." >&2
      else
        echo "[content-studio-publish] ERROR: rebase onto $remote_head failed without a file conflict; inspect the rebase diagnostics above." >&2
      fi
      exit 1
    fi
  fi

  if [[ "$(git rev-parse HEAD)" == "$remote_head" ]]; then
    echo "[content-studio-publish] Rebased snapshot is already present on origin/$branch."
    exit 0
  fi

  if git push origin "HEAD:refs/heads/$branch"; then
    echo "[content-studio-publish] Published snapshot commit $(git rev-parse HEAD) to origin/$branch."
    exit 0
  fi

  echo "[content-studio-publish] Push attempt $attempt was rejected or failed; fetching the branch again before retry." >&2
done

echo "[content-studio-publish] ERROR: unable to publish after $max_attempts attempts. Last remote head: ${remote_head:-unknown}; local candidate: $(git rev-parse HEAD). The public snapshot remains committed locally in this job; no force push was attempted." >&2
exit 1
