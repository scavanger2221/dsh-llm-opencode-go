#!/usr/bin/env bash
#
# Submit this plugin to the curated list at awesome-dsh-plugin/awesome-dsh-plugin.
#
#   ./scripts/submit-to-awesome.sh            # show the entry and the check result only
#   ./scripts/submit-to-awesome.sh --submit   # fork if needed, branch, commit, open the PR
#
# The list's rules (contributing.md): one YAML file per plugin at
# data/plugins/<owner>__<repo>.yml, the repo must declare a `dsh.bundle` and carry
# the `dsh-plugin` GitHub topic, and the repository must be at least one day old —
# that last one is checked by their CI, so a fresh repo is submitted a day later.
set -euo pipefail

OWNER=scavanger2221
REPO=dsh-llm-opencode-go
LIST=awesome-dsh-plugin/awesome-dsh-plugin
ENTRY="data/plugins/${OWNER}__${REPO}.yml"
BRANCH="add-${OWNER}-${REPO}"
SUBMIT=false
[ "${1:-}" = "--submit" ] && SUBMIT=true

command -v gh >/dev/null 2>&1 || { echo "submit-to-awesome: gh is not on PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "submit-to-awesome: node is not on PATH" >&2; exit 1; }

# The entry is the whole submission: url, link text, category, and a factual
# one-line description (the list rejects superlatives). Categories: run
# `gh api repos/$LIST/contents/data/plugins --jq '.[0].name'` for examples;
# `model` is Models & Providers.
read -r -d '' ENTRY_BODY <<'YAML' || true
url: https://github.com/scavanger2221/dsh-llm-opencode-go
name: scavanger2221/dsh-llm-opencode-go
category: model
description:
  en: OpenCode Go subscription models in DSH as one provider route that speaks each model's own protocol, sends the session-affinity headers Go requires, keeps its model catalog in step with the live endpoint, and ships a settings card for the API key, endpoint, refresh policy, and model overrides.
  zh: 把 OpenCode Go 订阅模型接入 DSH：一条 provider 路由按各模型自己的协议提供服务，携带 Go 要求的会话亲和头，模型目录跟随线上端点，并提供设置卡片管理 API key、端点、刷新策略与模型覆盖项。
YAML

echo "== repository checks =="
created=$(gh api "repos/$OWNER/$REPO" --jq .created_at)
age_hours=$(node -e "console.log(Math.floor((Date.now() - Date.parse('$created')) / 3600000))")
topics=$(gh api "repos/$OWNER/$REPO/topics" --jq '.names | join(", ")')
bundle=$(gh api "repos/$OWNER/$REPO/contents/package.json" --jq '.content' | base64 -d | node -e "
let raw='';process.stdin.on('data',(d)=>raw+=d).on('end',()=>{
  const dsh=JSON.parse(raw).dsh ?? {}
  console.log(dsh.bundle?.patch ? 'yes' : 'no')
})")
echo "  created      $created (${age_hours}h ago)"
echo "  topics       $topics"
echo "  dsh.bundle   $bundle"
[ "$bundle" = "yes" ] || { echo "submit-to-awesome: package.json must declare dsh.bundle" >&2; exit 1; }
case "$topics" in *dsh-plugin*) ;; *) echo "submit-to-awesome: the repo needs the dsh-plugin topic (gh repo edit $OWNER/$REPO --add-topic dsh-plugin)" >&2; exit 1 ;; esac
if [ "$age_hours" -lt 24 ]; then
  echo "  age          under 24h — their CI checks this, so submit again once it passes"
  [ "$SUBMIT" = true ] && { echo "submit-to-awesome: refusing --submit before the repo is a day old" >&2; exit 1; }
fi

echo
echo "== entry ($ENTRY) =="
printf '%s\n' "$ENTRY_BODY"

if [ "$SUBMIT" != true ]; then
  echo
  echo "Dry run. Re-run with --submit to fork, branch, commit, and open the PR."
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo
echo "== forking and preparing the PR =="
gh repo fork "$LIST" --clone=false >/dev/null 2>&1 || true
gh repo clone "$OWNER/$(basename "$LIST")" "$work" -- --depth 1 >/dev/null
mkdir -p "$work/$(dirname "$ENTRY")"
printf '%s' "$ENTRY_BODY" > "$work/$ENTRY"
( cd "$work" && git checkout -q -b "$BRANCH" && git add "$ENTRY" \
  && git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Add $OWNER/$REPO" \
  && git push -q -u origin "$BRANCH" )
gh pr create --repo "$LIST" --head "$OWNER:$BRANCH" \
  --title "Add $OWNER/$REPO" \
  --body "Adds \`$OWNER/$REPO\` under **Models & Providers**.

- One provider route serving every OpenCode Go model over the protocol it speaks, with \`x-opencode-session\` and \`x-deepseek-harness-session-id\` on every request (Go refuses an unrouteable request with \`400 MissingSessionID\`).
- Model catalog follows \`{apiRoot}/v1/models\`, enriched from models.dev, refreshed on mount, on an interval, on \`/opencode-refresh\`, and from the settings card.
- Declares \`dsh.bundle\` (plus \`dsh.client\` for the card); installs with \`dsh plugin --profile web add github:$OWNER/$REPO\`." \
  --web
