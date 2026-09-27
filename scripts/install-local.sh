#!/usr/bin/env bash
#
# Install this checkout into a DSH profile, and migrate it off the earlier
# two-package layout (a separate `dsh-llm-opencode-go-ui` package plus hand-written
# rows in the profile's cordis.patch.yml).
#
# Usage:  ./scripts/install-local.sh [--profile <name>] [--dsh-home <dir>]
#
# Why a copy: Node resolves a symlinked package to its real path, so a plugin
# whose source lives outside the profile cannot import the harness's own packages
# — the parent-directory walk from the checkout never reaches the profile's
# module fallback. `dsh plugin add <path outside the profile>` therefore boots
# with "Cannot find package '@earendil-works/pi-ai'". A copy under
# $PROFILE/plugins/<pkg> resolves. (Installing from GitHub avoids this entirely,
# because pnpm materializes the package inside the profile.)
set -euo pipefail

PROFILE=web
DSH_HOME_DIR=${DSH_HOME:-$HOME/.dsh}
PACKAGE=dsh-llm-opencode-go
LEGACY_PACKAGE=dsh-llm-opencode-go-ui
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE=${2:?--profile needs a name}; shift 2 ;;
    --dsh-home) DSH_HOME_DIR=${2:?--dsh-home needs a path}; shift 2 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-local.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

command -v dsh >/dev/null 2>&1 || { echo "install-local.sh: dsh is not on PATH" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "install-local.sh: pnpm is not on PATH (dsh plugin forwards to it)" >&2; exit 1; }
[ -f "$SOURCE_DIR/package.json" ] || { echo "install-local.sh: $SOURCE_DIR is not the package root" >&2; exit 1; }

PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
echo "install-local.sh: dsh home $DSH_HOME_DIR"
echo "install-local.sh: profile  $PROFILE"

# 1. The profile itself (a dump is the cheapest way to ask the loader to create
#    it from the shipped template).
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "install-local.sh: initializing profile '$PROFILE' from the shipped template"
  DSH_HOME="$DSH_HOME_DIR" dsh --profile "$PROFILE" --dump-config >/dev/null
fi

# 2. Retire the earlier two-package layout. Its card package and its hand-written
#    rows would otherwise mount the same route twice next to the bundle layer.
if node -e "process.exit(Object.keys(require('$PROFILE_DIR/package.json').dependencies ?? {}).includes('$LEGACY_PACKAGE') ? 0 : 1)"; then
  echo "install-local.sh: removing the legacy $LEGACY_PACKAGE dependency"
  (cd "$PROFILE_DIR" && DSH_HOME="$DSH_HOME_DIR" dsh plugin --profile "$PROFILE" remove "$LEGACY_PACKAGE")
fi
if [ -d "$PROFILE_DIR/plugins/$LEGACY_PACKAGE" ]; then
  rm -rf "${PROFILE_DIR:?}/plugins/$LEGACY_PACKAGE"
  echo "install-local.sh: removed $PROFILE_DIR/plugins/$LEGACY_PACKAGE"
fi
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml" LEGACY_PACKAGE="$LEGACY_PACKAGE" PACKAGE="$PACKAGE" node <<'NODE'
const { copyFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const file = process.env.PATCH_FILE
if (!existsSync(file)) process.exit(0)
const text = readFileSync(file, 'utf8')
// Split the top-level YAML list into items: one item starts at a line with no
// indentation and a leading "- ", and runs to the next such line. Legacy rows
// this plugin's earlier install wrote are dropped; anything else is preserved
// byte for byte, including comments.
const lines = text.split('\n')
const starts = []
for (const [index, line] of lines.entries()) if (/^- /.test(line)) starts.push(index)
const items = starts.map((start, at) => ({
  start,
  end: starts[at + 1] ?? lines.length,
}))
const legacy = items.filter((item) =>
  lines.slice(item.start, item.end).some((line) => line.includes(process.env.PACKAGE) || line.includes(process.env.LEGACY_PACKAGE)),
)
if (legacy.length === 0) {
  console.log('install-local.sh: no legacy rows in cordis.patch.yml')
  process.exit(0)
}
const drop = new Set()
for (const item of legacy) for (let at = item.start; at < item.end; at += 1) drop.add(at)
const kept = lines.filter((_, at) => !drop.has(at)).join('\n').replace(/\n{3,}/g, '\n\n')
// A patch file with no entries left must still be a top-level array: a
// comment-only file parses as null and the boot rejects it. Keep the comments
// and restate the empty list, which is the shipped template's own shape.
const next = /^- /m.test(kept) ? kept : `${kept.trimEnd()}\n[]\n`
copyFileSync(file, `${file}.bak`)
writeFileSync(file, next)
console.log(`install-local.sh: dropped ${legacy.length} legacy row block(s) from cordis.patch.yml (backup: ${file}.bak)`)
NODE

# 3. Copy the package into the profile tree, then register it. The dependency
#    entry makes it resolvable; its dsh.bundle declaration makes dsh add the
#    bundle layer, which mounts the row — no hand editing.
rm -rf "${PROFILE_DIR:?}/plugins/$PACKAGE"
mkdir -p "$PROFILE_DIR/plugins"
cp -R "$SOURCE_DIR" "$PROFILE_DIR/plugins/$PACKAGE"
rm -rf "${PROFILE_DIR:?}/plugins/$PACKAGE/node_modules" "${PROFILE_DIR:?}/plugins/$PACKAGE/.git"
echo "install-local.sh: installed $PROFILE_DIR/plugins/$PACKAGE"

echo "install-local.sh: registering the package"
(cd "$PROFILE_DIR" && DSH_HOME="$DSH_HOME_DIR" dsh plugin --profile "$PROFILE" add "./plugins/$PACKAGE")

cat <<EOF

install-local.sh: done.

Next:
  1. Restart the app so the row mounts:  dsh $PROFILE
  2. Set the API key if this harness home has none yet:
     Settings -> Models -> OpenCode Go -> API key
  3. Refresh the browser tab: the client module graph is served per page load,
     so a card that moved seats needs the new one.
EOF
