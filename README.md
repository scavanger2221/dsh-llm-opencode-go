# dsh-llm-opencode-go

[中文](README.zh.md) | English

OpenCode Go (`https://opencode.ai/docs/go/`) as a first-class DeepSeek Harness
model provider. One route — `opencode-go` — serves every model a Go subscription
exposes, over the wire protocol each model speaks, with the session identity Go
asks for on every request and a model catalog that follows the live endpoint.

The package root exposes the Cordis plugin contract and `OpenCodeGoAdapter`. The
same artifact exports `./client`, which contributes the OpenCode Go card under
Settings → Plugins. Why the route is owned here rather than delegated to pi-ai's
built-in `opencode-go` provider is recorded in
[ADR 0001](docs/adr/0001-own-the-opencode-go-route.md).

## Why it exists

Two things about Go need code the shared pi-ai adapter does not provide:

- **Session identity.** Go's client matrix asks for a stable per-conversation
  session id so it can route requests and reuse prompt caches, and it refuses an
  unrouteable request with `400 MissingSessionID`. The harness stamps
  `GenerateOptions.sessionId` on every loop-built call; this adapter maps it onto
  both `x-opencode-session` and the harness-native
  `x-deepseek-harness-session-id`.
- **A catalog that keeps up.** The pinned pi-ai release describes the models that
  existed when it shipped. The plugin refreshes `{apiRoot}/v1/models` on mount, on
  an interval, and on demand, merging new ids over the pinned catalog and
  enriching them from models.dev — so a model Go released today is selectable
  without an edit.

## Installation

DeepSeek Harness 0.1.0-rc.6 or later is required. Install directly from GitHub:

~~~sh
dsh plugin --profile web add github:scavanger2221/dsh-llm-opencode-go#v0.1.0
dsh web
~~~

The repository tracks release-ready `lib/` artifacts and has no build step, so a
GitHub installation needs no build-script allowlist. `dsh plugin add` also
activates the package's bundle layer — the profile gains this row from
`cordis.patch.yml`, so there is nothing to edit by hand:

~~~yaml
- id: llm-opencode-go
  name: 'dsh-llm-opencode-go'
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    refreshOnMount: true
    refreshIntervalMs: 21600000
~~~

### From a local checkout

A source checkout cannot simply be linked where it stands: Node resolves a
symlinked package to its real path, and the imports inside this plugin then walk
up from the checkout instead of the profile, failing with `Cannot find package
'@earendil-works/pi-ai'`. Copy the checkout into the profile tree instead —
`scripts/install-local.sh` does exactly that and re-registers the dependency:

~~~sh
git clone https://github.com/scavanger2221/dsh-llm-opencode-go
cd dsh-llm-opencode-go
./scripts/install-local.sh          # copies into $DSH_HOME/profiles/web/plugins
dsh web
~~~

## Web configuration

Open **Settings → Plugins → OpenCode Go**. The card stores the API key through
the Harness credentials service under `OPENCODE_GO_API_KEY`; the host never
returns the stored literal. It also edits the endpoint, the refresh interval, and
the model overrides, and it can interrogate the endpoint for the ids it currently
advertises.

The card is the supported editor for this provider because the Settings → Models
page ships layouts for the two namespaces it owns (`llm-deepseek`, `llm-pi-ai`)
and renders a deployment-added provider as a row with no editor. The Plugins page
dispatches a card by settings namespace instead, which is exactly what a plugin
distributed outside the harness repository needs.

## Configuration

Everything except the key is a settings field, layered over the bundle row by the
`llm-opencode-go` section of `$DSH_HOME/settings.yaml`:

~~~yaml
llm-opencode-go:
  apiRoot: https://opencode.ai/zen/go
  refreshIntervalMs: 3600000        # hourly; 0 disables the timer
  refreshOnMount: true
  models:
    - id: some-new-model
      api: anthropic-messages       # openai-completions | openai-responses | anthropic-messages
      contextWindow: 262144
      maxTokens: 65536
      reasoning: true
      input: [text, image]
~~~

`input` is enforced: a prompt carrying an image is refused with
`UNSUPPORTED_CONTENT` before the request when the model does not list `image`.
`reasoning: false` hides the harness thinking levels for that model.

The credential is not a settings field — secrets go through the credentials
service, which stores them in `$DSH_HOME/.credentials.yaml`:

~~~yaml
refs:
  OPENCODE_GO_API_KEY: sk-...
~~~

The reference deliberately avoids the conventional `OPENCODE_API_KEY`: an
exported environment value shadows the managed store, so a shell that exports
another OpenCode key would silently win.

> **Shell export warning.** If your shell exports `OPENCODE_GO_API_KEY`, that
> value wins over the store and the card's API key field renders as read-only.
> Unset it, or point `apiKeyEnv` at a reference nothing exports.

## Model catalog

| Trigger | When |
|---|---|
| mount | `refreshOnMount: true` (default) |
| interval | every `refreshIntervalMs` (default 6h, `0` disables) |
| command | `/opencode-refresh` in the chat |
| GUI | "Refresh catalog now" in the card |
| any settings write | the plugin re-syncs and re-reads the catalog |

A refresh that adds models re-announces the route, so the picker's
`llm/adapters-updated` listener reloads and the new models appear without a
restart. Ids Go advertises but neither the pinned catalog nor models.dev
describes are still registered, using a vendor-prefix guess for the protocol;
`models:` in the section above corrects or adds any entry by hand.

## Layout

| Path | Role |
|---|---|
| `lib/index.js` | Plugin entry: config schema, credential resolution, route registration, refresh scheduling, `/opencode-refresh`, session-header builder |
| `lib/adapter.js` | The `LlmAdapter`: model description, reasoning efforts, per-request dispatch through pi-ai |
| `lib/catalog.js` | Three-layer model catalog: pinned pi-ai catalog, configured entries, live refresh overlay |
| `lib/refresh.js` | `GET {apiRoot}/v1/models` plus models.dev enrichment |
| `lib/convert.js` | Harness ↔ pi-ai message, chunk, and replay-envelope conversion |
| `lib/client.js` | Browser half: the Settings → Plugins card |
| `cordis.patch.yml` | The bundle layer `dsh plugin add` activates |

## Development

There is nothing to install: `lib/` is the source. The tests run against an
installed copy, because the host half imports harness packages and those resolve
through the profile's module fallback:

~~~sh
cd "$DSH_HOME/profiles/web/plugins/dsh-llm-opencode-go"   # after installing
node tests/adapter.smoke.mjs && node tests/card.smoke.mjs
~~~

A checkout placed inside the profile tree (e.g. at `$PROFILE/plugins/`) runs them
in place. Do **not** link `node_modules` at the profile's module fallback to make
a checkout outside the profile work: pnpm follows the link and rewrites the
shared fallback for every profile.

`tests/adapter.smoke.mjs` drives a fake endpoint and asserts the wire request
(URL, session headers, attribution headers, credential), the chunk stream, usage
mapping, the replay envelope, configured overrides, and the `MISSING_CREDENTIAL`
path. `tests/card.smoke.mjs` loads the real browser bundle under a stub module
system and a stub React and asserts the card's chrome, staging, and save payload.

## License

MIT
