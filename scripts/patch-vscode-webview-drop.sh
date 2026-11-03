#!/usr/bin/env bash
# Patch the installed VS Code so that a drag from the Explorer can drop into a
# webview without the Shift key.
#
# Why: VS Code sets "pointer-events: none" on every webview iframe while a drag
# runs inside the window. The iframe gets pointer events again only while the
# Shift key is down. This patch inverts that rule: the webview gets the drop by
# default, and the Shift key gives the old workbench behaviour (for example,
# drop a file on an editor group to open it).
#
# The patch changes two listeners in workbench.desktop.main.js:
#   DRAG      n=>{n.shiftKey?i():t()}   ->   n=>{n.shiftKey?t():i()}
#   DRAG_OVER n=>{n.shiftKey?i():t()}   ->   n=>{n.shiftKey?t():i()}
# The identifiers differ per build, so the script matches the structure.
#
# The script also updates the checksum in product.json so that VS Code does not
# show the "installation appears to be corrupt" warning.
#
# Usage:
#   scripts/patch-vscode-webview-drop.sh apply    # back up, patch, fix checksum
#   scripts/patch-vscode-webview-drop.sh restore  # put the backup back
#   scripts/patch-vscode-webview-drop.sh status   # show if the patch is applied
#
# Set VSCODE_APP to patch a different install (default: /Applications/Visual Studio Code.app).
# Run "apply" again after each VS Code update, because an update replaces the file.

set -euo pipefail

APP="${VSCODE_APP:-/Applications/Visual Studio Code.app}"
RES="$APP/Contents/Resources/app"
JS="$RES/out/vs/workbench/workbench.desktop.main.js"
PRODUCT="$RES/product.json"
JS_KEY="vs/workbench/workbench.desktop.main.js"
BACKUP="$JS.ccgui-orig"
PRODUCT_BACKUP="$PRODUCT.ccgui-orig"

# Structure of the two listeners. Group 1 = prefix, 2 = event arg, 3 = "unblock" fn, 4 = "block" fn.
PATTERN='(\.DRAG(?:_OVER)?,(\w+)=>\{\2\.shiftKey\?)(\w+)\(\):(\w+)\(\)\}'

die() { echo "error: $*" >&2; exit 1; }

checksum() {
  openssl dgst -sha256 -binary "$1" | base64 | tr -d '='
}

count_matches() {
  perl -0777 -ne "my \$c=0; \$c++ while /$PATTERN/g; print \$c" "$JS"
}

# Print "patched", "original" or "unknown" from the file content.
# The DRAG_START listener names the "block" function. In the original file the
# Shift branch of the DRAG listener calls the other ("unblock") function.
patch_state() {
  perl -0777 -ne '
    my ($block) = /\.DRAG_START,\(\)=>\{(\w+)\(\)\}/;
    my ($arg, $shift, $other) = /\.DRAG,(\w+)=>\{\1\.shiftKey\?(\w+)\(\):(\w+)\(\)\}/;
    if (!defined $block || !defined $shift) { print "unknown"; }
    elsif ($shift eq $block) { print "patched"; }
    elsif ($other eq $block) { print "original"; }
    else { print "unknown"; }
  ' "$JS"
}

is_patched() {
  [ "$(patch_state)" = "patched" ]
}

set_product_checksum() {
  local sum
  sum="$(checksum "$JS")"
  perl -0777 -pi -e "s{(\"\Q$JS_KEY\E\":\s*\")[^\"]*(\")}{\$1$sum\$2}" "$PRODUCT"
  grep -q "\"$JS_KEY\": \"$sum\"" "$PRODUCT" || die "could not update the checksum in product.json"
}

cmd_status() {
  [ -f "$JS" ] || die "not found: $JS"
  echo "state: $(patch_state) ($JS)"
  echo "drag listeners found: $(count_matches) (expected 2)"
  [ -f "$BACKUP" ] && echo "backup: $BACKUP" || true
}

cmd_apply() {
  [ -f "$JS" ] || die "not found: $JS"
  [ -w "$JS" ] || die "not writable: $JS (run: sudo chown -R \"\$(whoami)\" \"$APP\")"
  if pgrep -f "$APP/Contents/MacOS/Electron" >/dev/null 2>&1; then
    echo "warning: VS Code runs now. Restart it after the patch." >&2
  fi
  if is_patched; then
    echo "already patched: $JS"
    exit 0
  fi
  [ "$(patch_state)" = "original" ] || die "cannot identify the drag listeners in this VS Code build; the patch is not applied."
  local n
  n="$(count_matches)"
  [ "$n" = "2" ] || die "expected 2 drag listeners, found $n. This VS Code build is different; the patch is not applied."

  cp -p "$JS" "$BACKUP"
  cp -p "$PRODUCT" "$PRODUCT_BACKUP"
  perl -0777 -pi -e "s/$PATTERN/\$1\$4():\$3()}/g" "$JS"
  set_product_checksum
  echo "patched: $JS"
  echo "backup:  $BACKUP"
  echo "checksum in product.json updated."
  echo "Restart VS Code. Drag a file from the Explorer into the chat input. Hold Shift to get the old behaviour."
}

cmd_restore() {
  [ -f "$BACKUP" ] || die "no backup found: $BACKUP"
  cp -p "$BACKUP" "$JS"
  if [ -f "$PRODUCT_BACKUP" ]; then
    cp -p "$PRODUCT_BACKUP" "$PRODUCT"
    rm -f "$PRODUCT_BACKUP"
  fi
  rm -f "$BACKUP"
  echo "restored: $JS"
}

case "${1:-}" in
  apply) cmd_apply ;;
  restore) cmd_restore ;;
  status) cmd_status ;;
  *) echo "usage: $0 apply|restore|status" >&2; exit 2 ;;
esac
