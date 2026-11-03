#!/usr/bin/env bash
# Patch the installed VS Code (macOS) for 2 drag-and-drop behaviours that no
# extension can change:
#
# native-drag   Hold Option (Alt) when you start a drag in the Explorer. The
#               file then goes on the OS drag pasteboard as a real file, so you
#               can drop it into a browser (file upload), Finder, or any app.
#               Only the first selected file is dragged. Without Option, the
#               Explorer drag works as before.
#
#               How: the Explorer drag-start handler cancels the HTML drag,
#               resets the list state with a synthetic dragend event, and calls
#               the existing native host method startFileDrag(path), which runs
#               webContents.startDrag in the main process.
#
# webview-drop  A drop from the Explorer reaches a webview (for example the
#               CC GUI chat) without the Shift key. VS Code sets
#               "pointer-events: none" on every webview iframe while a drag runs
#               inside the window and lifts it only while Shift is down. The
#               patch inverts that rule: Shift gives the old behaviour.
#
# The identifiers in the minified bundles differ per build, so the script
# matches the code structure and reuses the captured names. It also updates the
# checksums in product.json so that VS Code does not show the "installation
# appears to be corrupt" warning.
#
# Usage:
#   scripts/patch-vscode.sh apply    # back up, patch, fix checksums
#   scripts/patch-vscode.sh restore  # put the backups back
#   scripts/patch-vscode.sh status   # show the state of each patch
#
# Environment:
#   VSCODE_APP      app bundle to patch (default: /Applications/Visual Studio Code.app)
#   CCGUI_PATCHES   space-separated list of patches to apply (default: "native-drag webview-drop")
#
# Run "apply" again after each VS Code update, because an update replaces the files.

set -euo pipefail

APP="${VSCODE_APP:-/Applications/Visual Studio Code.app}"
RES="$APP/Contents/Resources/app"
PRODUCT="$RES/product.json"
PATCHES="${CCGUI_PATCHES:-native-drag webview-drop}"
BUNDLE_KEYS=(
  "vs/workbench/workbench.desktop.main.js"
  "vs/sessions/sessions.desktop.main.js"
)

die() { echo "error: $*" >&2; exit 1; }

checksum() {
  openssl dgst -sha256 -binary "$1" | base64 | tr -d '='
}

set_product_checksum() {
  local key="$1" file="$2" sum
  sum="$(checksum "$file")"
  perl -0777 -pi -e "s{(\"\Q$key\E\":\s*\")[^\"]*(\")}{\$1$sum\$2}" "$PRODUCT"
  grep -q "\"$key\": \"$sum\"" "$PRODUCT" || die "could not update the checksum for $key in product.json"
}

# ---------------------------------------------------------------------------
# webview-drop: 2 listeners  n=>{n.shiftKey?unblock():block()}
# ---------------------------------------------------------------------------
WEBVIEW_PATTERN='(\.DRAG(?:_OVER)?,(\w+)=>\{\2\.shiftKey\?)(\w+)\(\):(\w+)\(\)\}'

# Print "patched", "original", "absent" or "unknown".
webview_state() {
  perl -0777 -ne '
    my ($block) = /\.DRAG_START,\(\)=>\{(\w+)\(\)\}/;
    my ($arg, $shift, $other) = /\.DRAG,(\w+)=>\{\1\.shiftKey\?(\w+)\(\):(\w+)\(\)\}/;
    if (!defined $block && !defined $shift) { print "absent"; }
    elsif (!defined $block || !defined $shift) { print "unknown"; }
    elsif ($shift eq $block) { print "patched"; }
    elsif ($other eq $block) { print "original"; }
    else { print "unknown"; }
  ' "$1"
}

webview_apply() {
  local file="$1" n
  n="$(perl -0777 -ne "my \$c=0; \$c++ while /$WEBVIEW_PATTERN/g; print \$c" "$file")"
  [ "$n" = "2" ] || die "webview-drop: expected 2 drag listeners in $(basename "$file"), found $n"
  perl -0777 -pi -e "s/$WEBVIEW_PATTERN/\$1\$4():\$3()}/g" "$file"
  [ "$(webview_state "$file")" = "patched" ] || die "webview-drop: patch verification failed in $(basename "$file")"
}

# ---------------------------------------------------------------------------
# native-drag: Explorer onDragStart
# ---------------------------------------------------------------------------
NATIVE_MARKER='ccguiNativeDrag'
NATIVE_PATTERN='onDragStart\((\w+),(\w+)\)\{let (\w+)=(\w+)\.getStatsFromDragAndDropData\(\1,\2\);if\(\3\.length&&\2\.dataTransfer\)\{this\.instantiationService\.invokeFunction\(\w+=>\w+\(\w+,\w+,\w+\)\);let (\w+)=\3\.filter\(\w+=>\w+\.resource\.scheme===(\w+)\.file\)\.map\(\w+=>\w+\.resource\.fsPath\);\5\.length&&\2\.dataTransfer\.setData\(\w+\.FILES,JSON\.stringify\(\5\)\)\}\}'

native_state() {
  local file="$1" n
  if grep -q "$NATIVE_MARKER" "$file"; then
    echo "patched"; return
  fi
  n="$(perl -0777 -ne "my \$c=0; \$c++ while /$NATIVE_PATTERN/g; print \$c" "$file")"
  case "$n" in
    1) echo "original" ;;
    0) echo "absent" ;;
    *) echo "unknown" ;;
  esac
}

native_apply() {
  local file="$1" nhs
  # The decorator variable of INativeHostService in this bundle.
  nhs="$(perl -0777 -ne 'if (/(\w+)=\w+\("nativeHostService"\)/) { print $1 }' "$file")"
  [ -n "$nhs" ] || die "native-drag: nativeHostService decorator not found in $(basename "$file")"
  # $1 data, $2 event, $3 stats, $4 explorer helper, $5 paths var, $6 Schemas var.
  CCGUI_NHS="$nhs" CCGUI_PAT="$NATIVE_PATTERN" perl -0777 -pi -e '
    my $nhs = $ENV{CCGUI_NHS};
    my $pat = qr/$ENV{CCGUI_PAT}/;
    s/$pat/
      my $rest = substr($&, index($&, "{this.instantiationService") + 1);
      "onDragStart($1,$2){let $3=$4.getStatsFromDragAndDropData($1,$2);" .
      "if($2.altKey&&$2.dataTransfer&&$3.length){" .
        "let ccguiNativeDrag=$3.filter(n=>n.resource.scheme===$6.file&&!n.isDirectory).map(n=>n.resource.fsPath);" .
        "if(ccguiNativeDrag.length){" .
          "$2.preventDefault();" .
          "let ccguiTarget=$2.target;" .
          "setTimeout(()=>{ccguiTarget&&ccguiTarget.dispatchEvent(new DragEvent(\"dragend\",{bubbles:!0}))},0);" .
          "this.instantiationService.invokeFunction(n=>n.get($nhs).startFileDrag(ccguiNativeDrag[0]));" .
          "return}}" .
      "if($3.length&&$2.dataTransfer){" . $rest
    /e;
  ' "$file"
  [ "$(native_state "$file")" = "patched" ] || die "native-drag: patch verification failed in $(basename "$file")"
}

# ---------------------------------------------------------------------------
patch_state() {
  case "$1" in
    native-drag) native_state "$2" ;;
    webview-drop) webview_state "$2" ;;
    *) die "unknown patch: $1" ;;
  esac
}

patch_apply() {
  case "$1" in
    native-drag) native_apply "$2" ;;
    webview-drop) webview_apply "$2" ;;
  esac
}

cmd_status() {
  local key file
  for key in "${BUNDLE_KEYS[@]}"; do
    file="$RES/out/$key"
    [ -f "$file" ] || { echo "$key: not found"; continue; }
    for p in $PATCHES; do
      echo "$key  $p: $(patch_state "$p" "$file")"
    done
    [ -f "$file.ccgui-orig" ] && echo "$key  backup: present" || true
  done
}

cmd_apply() {
  local key file state changed=0
  [ -f "$PRODUCT" ] || die "not found: $PRODUCT"
  [ -w "$PRODUCT" ] || die "not writable: $PRODUCT (run: sudo chown -R \"\$(whoami)\" \"$APP\")"
  if pgrep -f "$APP/Contents/MacOS/Electron" >/dev/null 2>&1; then
    echo "warning: VS Code runs now. Restart it after the patch." >&2
  fi
  [ -f "$PRODUCT.ccgui-orig" ] || cp -p "$PRODUCT" "$PRODUCT.ccgui-orig"
  for key in "${BUNDLE_KEYS[@]}"; do
    file="$RES/out/$key"
    [ -f "$file" ] || continue
    [ -w "$file" ] || die "not writable: $file"
    for p in $PATCHES; do
      state="$(patch_state "$p" "$file")"
      case "$state" in
        patched) echo "$key  $p: already patched" ;;
        absent) echo "$key  $p: not present in this bundle, skipped" ;;
        unknown) die "$key  $p: cannot identify the code in this VS Code build; nothing changed in this file" ;;
        original)
          [ -f "$file.ccgui-orig" ] || cp -p "$file" "$file.ccgui-orig"
          patch_apply "$p" "$file"
          echo "$key  $p: patched"
          changed=1
          ;;
      esac
    done
    set_product_checksum "$key" "$file"
  done
  if [ "$changed" = "1" ]; then
    echo "Checksums in product.json updated. Restart VS Code."
    echo "native-drag:  hold Option (Alt) when you start a drag in the Explorer, then drop the file in a browser or any app."
    echo "webview-drop: drop from the Explorer into a webview without Shift."
  fi
}

cmd_restore() {
  local key file restored=0
  for key in "${BUNDLE_KEYS[@]}"; do
    file="$RES/out/$key"
    if [ -f "$file.ccgui-orig" ]; then
      cp -p "$file.ccgui-orig" "$file" && rm -f "$file.ccgui-orig"
      echo "restored: $key"
      restored=1
    fi
  done
  if [ -f "$PRODUCT.ccgui-orig" ]; then
    cp -p "$PRODUCT.ccgui-orig" "$PRODUCT" && rm -f "$PRODUCT.ccgui-orig"
    echo "restored: product.json"
    restored=1
  fi
  [ "$restored" = "1" ] || die "no backups found under $RES"
}

case "${1:-}" in
  apply) cmd_apply ;;
  restore) cmd_restore ;;
  status) cmd_status ;;
  *) echo "usage: $0 apply|restore|status" >&2; exit 2 ;;
esac
