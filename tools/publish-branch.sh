#!/usr/bin/env bash
# 建立（或更新）本機的 `publish` 分支，只含可以公開的檔案：
#   - 不含 docs/superpowers/（設計文件與開發計畫）
#   - 作者與提交者是中性名稱，不帶任何人的 email
#   - 發現疑似個人資料（email、本機路徑）時中止
# 用法：bash tools/publish-branch.sh [來源分支，預設 build]
# 之後只推這個分支：git push origin publish:main
set -euo pipefail

SRC="${1:-build}"
cd "$(git rev-parse --show-toplevel)"

TMP_INDEX="$(mktemp)"
trap 'rm -f "$TMP_INDEX"' EXIT
export GIT_INDEX_FILE="$TMP_INDEX"
git read-tree "$SRC"
git rm -r -q --cached --ignore-unmatch docs/superpowers
TREE="$(git write-tree)"
unset GIT_INDEX_FILE

# 防呆：發佈內容不可含 email 或本機路徑
if git grep -I -n -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|/Users/[A-Za-z0-9._-]+' "$TREE" -- . ':!tools/publish-branch.sh'; then
  echo "中止：上面的檔案疑似含有個人資料，請先移除再重跑。" >&2
  exit 1
fi

PARENT_ARGS=""
if git rev-parse -q --verify refs/heads/publish >/dev/null; then
  if [ "$(git rev-parse 'publish^{tree}')" = "$TREE" ]; then
    echo "publish 已是最新，沒有變更。"
    exit 0
  fi
  PARENT_ARGS="-p publish"
fi

export GIT_AUTHOR_NAME="jos-log" GIT_AUTHOR_EMAIL="noreply@example.invalid"
export GIT_COMMITTER_NAME="jos-log" GIT_COMMITTER_EMAIL="noreply@example.invalid"
# shellcheck disable=SC2086
COMMIT="$(git commit-tree "$TREE" $PARENT_ARGS -m "Publish $(date +%F)")"
git update-ref refs/heads/publish "$COMMIT"
echo "publish -> ${COMMIT}"
echo "接著執行：git push origin publish:main"
