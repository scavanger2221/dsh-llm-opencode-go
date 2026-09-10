# Changelog

## Unreleased

- Card: collapse like the shipped plugin cards (header with chevron, staged edits, Unsaved tag, Discard/Save footer), and expose per-model `reasoning` and allowed `input` in the model editor
- Settings: `refreshEpoch` gives the card a one-click "Refresh catalog now" that re-reads the live endpoint through the host's own refresher

## 0.1.0

- First release: the `opencode-go` route over the harness LLM seam, with session-affinity headers (`x-opencode-session` plus the harness-native `x-deepseek-harness-session-id`) on every request and the mandatory attribution headers
- Three-layer model catalog: pinned pi-ai models, per-model overrides from the `llm-opencode-go` settings section, and a live refresh of `{apiRoot}/v1/models` enriched from models.dev
- Refresh triggers: mount, interval, the `/opencode-refresh` chat command, and the settings card
- Web card under Settings → Plugins: API key (through the credentials service), endpoint, refresh policy, advertised-model lookup, and the model override editor
- `cordis.patch.yml` bundle layer, so `dsh plugin add` needs no profile edit
