#!/bin/bash

# Extract changed symbols from public/nav directory
# This script detects changes in public/nav JSON files and extracts all symbols from changed files

set -e

echo "🔍 Detecting changes in public/nav directory..."

# Get changed files in public/nav directory
# Compare HEAD with HEAD~1 to detect changes in the last commit
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD -- 'public/nav/**/*.json' 2>/dev/null || true)

# If no changes detected, exit early
if [ -z "$CHANGED_FILES" ]; then
  echo "✅ No changes detected in public/nav"
  echo "changed_symbols=" >> $GITHUB_OUTPUT
  exit 0
fi

echo "📝 Changed files:"
echo "$CHANGED_FILES"
echo ""

# Extract symbols from changed files
SYMBOLS=""
for file in $CHANGED_FILES; do
  if [ -f "$file" ]; then
    echo "📄 Processing: $file"
    
    # Extract all symbols from the JSON array
    FILE_SYMBOLS=$(jq -r '.[].symbol // empty' "$file" 2>/dev/null || true)
    
    if [ -n "$FILE_SYMBOLS" ]; then
      SYMBOLS="$SYMBOLS $FILE_SYMBOLS"
      echo "   Found symbols: $(echo $FILE_SYMBOLS | tr '\n' ' ')"
    fi
  fi
done

# Remove duplicates and trim whitespace
SYMBOLS=$(echo "$SYMBOLS" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' | xargs)

if [ -z "$SYMBOLS" ]; then
  echo ""
  echo "⚠️  No symbols found in changed files"
  echo "changed_symbols=" >> $GITHUB_OUTPUT
  exit 0
fi

echo ""
echo "✅ Changed symbols detected: $SYMBOLS"
echo "📊 Total unique symbols: $(echo $SYMBOLS | wc -w)"

# Output for GitHub Actions
echo "changed_symbols=$SYMBOLS" >> $GITHUB_OUTPUT
