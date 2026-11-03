#!/usr/bin/env bash
# Merge the upstream extension into this fork, rebuild, package and install.
#
# Usage: scripts/sync-upstream.sh [--no-install]
#
# Steps:
#   1. fetch upstream/main
#   2. set our package.json version to the upstream version so the version
#      line cannot conflict, then merge upstream/main into the current branch
#   3. set the fork version to (upstream major + 1).minor.patch, so that the
#      Marketplace release can never replace the fork
#   4. npm install where a lockfile changed, build, package the VSIX
#   5. install the VSIX into VS Code (unless --no-install)
set -euo pipefail
cd "$(dirname "$0")/.."

CODE_BIN="${CODE_BIN:-/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code}"
command -v code >/dev/null 2>&1 && CODE_BIN="$(command -v code)"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: the working tree has changes; commit or stash them first" >&2
  exit 1
fi

git fetch upstream
behind="$(git rev-list --count HEAD..upstream/main)"
if [ "$behind" = "0" ]; then
  echo "already up to date with upstream/main"
  exit 0
fi
echo "upstream/main has $behind new commit(s)"

upstream_version="$(git show upstream/main:package.json | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).version))')"
our_version="$(node -p 'require("./package.json").version')"
fork_version="$(node -e '
  const [major, minor, patch] = process.argv[1].split(".").map(Number);
  console.log(`${major + 1}.${minor}.${patch}`);
' "$upstream_version")"

# Step 2: align the version line, then merge.
if [ "$our_version" != "$upstream_version" ]; then
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync("package.json", "utf8");
    fs.writeFileSync("package.json", text.replace(/"version": "[^"]+"/, `"version": "${process.argv[1]}"`));
  ' "$upstream_version"
  git commit -qam "chore: align version with upstream $upstream_version before merge"
fi

if ! git merge --no-edit upstream/main; then
  cat >&2 <<MSG

error: the merge has conflicts. Resolve them, then run:
  git add -A && git commit
  node -e 'const fs=require("fs");fs.writeFileSync("package.json",fs.readFileSync("package.json","utf8").replace(/"version": "[^"]+"/,"\"version\": \"$fork_version\""))'
  git commit -qam "chore: set fork version $fork_version"
  npm run build && npm exec --yes --package=@vscode/vsce -- vsce package
MSG
  exit 1
fi

# Step 3: fork version above upstream.
node -e '
  const fs = require("fs");
  const text = fs.readFileSync("package.json", "utf8");
  fs.writeFileSync("package.json", text.replace(/"version": "[^"]+"/, `"version": "${process.argv[1]}"`));
' "$fork_version"
git commit -qam "chore: set fork version $fork_version"

# Step 4: dependencies, build, package.
for dir in . webview ai-bridge; do
  if git diff --name-only HEAD@{1} HEAD -- "$dir/package-lock.json" "$dir/package.json" | grep -q .; then
    echo "dependencies changed in $dir: npm install"
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
done
git checkout -q -- package-lock.json webview/package-lock.json ai-bridge/package-lock.json 2>/dev/null || true
npm run build
rm -f vscode-cc-gui-*.vsix
npm exec --yes --package=@vscode/vsce -- vsce package
vsix="$(ls -t vscode-cc-gui-*.vsix | head -1)"

# Step 5: install.
if [ "${1:-}" != "--no-install" ]; then
  "$CODE_BIN" --install-extension "./$vsix" --force
  echo "installed $vsix. Reload the VS Code window."
else
  echo "packaged $vsix"
fi
