#!/bin/bash
# Format only changed JSON files using prettier

set -e

# Get changed files from git status (staged and unstaged)
# This works better in GitHub Actions where git history might be limited
CHANGED_FILES=$(git status --porcelain | awk '{print $2}' | grep -E '\.(json)$' || true)

if [ -z "$CHANGED_FILES" ]; then
    echo "No changed JSON files to format."
    exit 0
fi

# Filter out excluded paths if EXCLUDE_PATHS environment variable is set
if [ -n "$EXCLUDE_PATHS" ]; then
    FILTERED_FILES=""
    while IFS= read -r file; do
        EXCLUDE=false
        for exclude_path in $EXCLUDE_PATHS; do
            if [[ "$file" == "$exclude_path"* ]]; then
                EXCLUDE=true
                break
            fi
        done
        if [ "$EXCLUDE" = false ]; then
            FILTERED_FILES="${FILTERED_FILES}${file}\n"
        fi
    done <<< "$CHANGED_FILES"
    CHANGED_FILES=$(echo -e "$FILTERED_FILES" | grep -v '^$' || true)
fi

if [ -z "$CHANGED_FILES" ]; then
    echo "No changed JSON files to format (after exclusions)."
    exit 0
fi

echo "Formatting changed JSON files:"
echo "$CHANGED_FILES" | while IFS= read -r file; do
    if [ -f "$file" ]; then
        echo "  - $file"
        npx prettier --write "$file" --log-level=warn || true
    fi
done

echo "✅ Formatting complete."

