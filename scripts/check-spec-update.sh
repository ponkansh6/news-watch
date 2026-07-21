#!/usr/bin/env bash
# check-spec-update.sh
# Pre-commit check: if spec-sensitive files are staged, warn if spec.md is not.
# Exit 0 = pass (no warning needed, or spec.md is staged)
# Exit 1 = not used (never blocks, only warns)
#
# Spec-sensitive patterns:
#   - DB schema, scoring logic, scoring pipeline, config
#   - API routes, news fetchers, LLM integration, vector filter

set -euo pipefail

SPEC_FILE="openspec/specs/news-watch/spec.md"

# Patterns that likely require a spec.md review
SPEC_SENSITIVE_PATTERNS=(
  "src/lib/db/schema.ts"
  "src/lib/scoring.ts"
  "src/lib/score-pipeline.ts"
  "src/lib/config.ts"
  "src/lib/vector-filter.ts"
  "src/lib/embeddings.ts"
  "src/app/api/"
  "src/lib/news/"
  "src/lib/llm/"
  "drizzle.config.ts"
)

# Get staged files (only added/modified, not deleted)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Check if any staged file matches a spec-sensitive pattern
SENSITIVE_STAGED=false
for pattern in "${SPEC_SENSITIVE_PATTERNS[@]}"; do
  if echo "$STAGED_FILES" | grep -q "^${pattern}"; then
    SENSITIVE_STAGED=true
    break
  fi
done

if [ "$SENSITIVE_STAGED" = false ]; then
  exit 0
fi

# Check if spec.md is also staged
if echo "$STAGED_FILES" | grep -q "^${SPEC_FILE}$"; then
  echo "[spec-check] ✓ spec.md is staged alongside spec-sensitive changes."
  exit 0
fi

# spec.md is NOT staged but spec-sensitive files are
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  ⚠  spec.md 更新の確認が必要です                          │"
echo "│                                                             │"
echo "│  以下のファイルが staged されていますが、                  │"
echo "│  openspec/specs/news-watch/spec.md が含まれていません。    │"
echo "│                                                             │"

for pattern in "${SPEC_SENSITIVE_PATTERNS[@]}"; do
  MATCHES=$(echo "$STAGED_FILES" | grep "^${pattern}" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r f; do
      echo "│    • $f"
    done <<< "$MATCHES"
  fi
done

echo "│                                                             │"
echo "│  スキーマ・スコアリング・API の変更には spec.md の更新が   │"
echo "│  推奨されます。現状は warn のみで commit は阻止しません。   │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""

exit 0
