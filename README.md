# dsh-llm-opencode-go

[中文](README.zh.md) | English

OpenCode Go (`https://opencode.ai/docs/go/`) as a first-class DeepSeek Harness
model provider. One route — `opencode-go` — serves every model a Go subscription
exposes, over the wire protocol each model speaks, with the session identity Go
asks for on every request and a model catalog that follows the live endpoint.

The package root exposes the Cordis plugin contract and `OpenCodeGoAdapter`. The
same artifact exports `./client`, which contributes the OpenCode Go settings card
to the foot of the Settings → Models page. Why the route is owned here rather
than delegated to pi-ai's built-in `opencode-go` provider is recorded in
[ADR 0001](docs/adr/0001-own-the-opencode-go-route.md); why the card lives on the
Models page rather than the Plugins page is recorded in
[ADR 0002](docs/adr/0002-model-provider-settings-on-the-models-page.md); and how
that route's harness ↔ pi-ai conversion is kept honest — as a mirror of
`dsh-llm-pi-ai`'s own, re-diffed on every upgrade — is recorded in
[ADR 0004](docs/adr/0004-mirror-pi-ai-conversion.md).

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
dsh plugin --profile web add github:scavanger2221/dsh-llm-opencode-go#v0.1.3
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

Open **Settings → Models**: the card sits at the foot of the page, after the
provider rows and the add control. It stores the API key through the Harness
credentials service under `OPENCODE_GO_API_KEY` (the host never returns the stored
literal), edits the endpoint and the refresh interval, lists every model the route
serves with the facts a request would use, and can interrogate the endpoint for
the ids it currently advertises.

The list leads with each model's display name and states its facts compactly
(`1M ctx · 128K out · text + images`, with the exact counts in the tooltip), a
filter box narrows it by id or name, and the count line above it reports what is
there and where it came from (`27 models · 1 disabled · live catalog`). The
endpoint query and the catalog refresh live in the same row as the filter.

Each model in that list is editable on its own. Editing one opens a form whose
every field starts on **Inherit**, so an override states only what it changes:
setting one model's context window to `256K` leaves its protocol, reasoning flag,
and allowed input exactly as the catalog describes them. The list shows the
effective value per model, marks each one carrying an override, and offers
**Remove override** to hand it back to the catalog. A model the catalog does not
describe — one the endpoint advertises but the pinned pi-ai release predates — is
added by ID, and then its protocol has to be stated because there is nothing to
inherit it from. That override shape, and why an editor may not invent the fields
it cannot read, is recorded in
[ADR 0003](docs/adr/0003-per-model-overrides-that-state-only-what-changes.md).

**Disable** takes a model out of the catalog without removing what describes it.
The row stays — dimmed and marked *Disabled*, with its facts — while the model
picker stops offering it and a request naming it fails with an explanation rather
than going out. **Enable** puts it back, and drops the entry again when the flag
was everything it carried. A live catalog refresh does not resurrect a disabled
model. If a session, or the agent's default model, already names the one you
switch off, those requests fail with that explanation — pick another model or
turn it back on.

The card uses the `settings.models.footer` seat. The other extension seat on that
page, `settings.models.provider-card`, is keyed by the settings namespace of the
provider row it renders in — and it is unreachable for this route: `llm-pi-ai`
declares the whole pi-ai provider catalog, `opencode-go` included, so that row
dispatches with the `llm-pi-ai` namespace, while the host refuses a second
declaration of the same provider id. The footer seat needs no directory row and
is therefore always rendered.

Earlier deployments showed this card under **Settings → Plugins**; on 0.1.7 that
section is a read-only inventory of the plugins a deployment ships, and the seat it
used (`settings.plugin.item`) is declared by nothing.

## Configuration

Everything except the key is a settings field on the plugin's own row. The card
writes them through the settings service, which persists each edit as a `config:`
override on that row in the active profile's patch
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`), so a hand edit there is the
same document:

~~~yaml
llm-opencode-go:
  apiRoot: https://opencode.ai/zen/go
  refreshIntervalMs: 3600000        # hourly; 0 disables the timer
  refreshOnMount: true
  models:
    # States only the capacity it corrects. The pinned catalog still supplies
    # this model's protocol, reasoning flag, and allowed input.
    - id: glm-5.3
      contextWindow: 262144
    # A model no catalog describes: its protocol has to be stated.
    - id: some-new-model
      api: anthropic-messages       # openai-completions | openai-responses | anthropic-messages
      maxTokens: 65536
      reasoning: true
      input: [text, image]
    # Take a model out of the catalog. It stays described — the settings list
    # still shows it — but the picker stops offering it.
    - id: some-model-you-do-not-want
      disabled: true
~~~

Every field but `id` is optional, and an entry only overrides what it states —
`id: glm-5.3` with no other key is a no-op, which is what makes the card's
per-model form safe to apply after editing a single field.

> **There is no `settings.yaml` to edit on 0.1.7.** The Harness moved per-row
> settings into the profile composition and imported the old file once, leaving
> it as `$DSH_HOME/settings.yaml.imported`; it is no longer read. The live
> document for this row is the `config:` block above in the profile patch (or the
> card, which writes it).

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
| `lib/convert.js` | Harness ↔ pi-ai message, chunk, and replay-envelope conversion — a mirror of `dsh-llm-pi-ai`'s own conversion, with the route-named errors and the replay envelope as the only additions |
| `lib/client.js` | Browser half: the card at the foot of the Models settings page, with the per-model editor |
| `cordis.patch.yml` | The bundle layer `dsh plugin add` activates |

## Development

There is nothing to install: `lib/` is the source. The tests run against an
installed copy, because the host half imports harness packages and those resolve
through the profile's module fallback:

~~~sh
cd "$DSH_HOME/profiles/web/plugins/dsh-llm-opencode-go"   # after installing
node tests/adapter.smoke.mjs && node tests/host.smoke.mjs && node tests/card.smoke.mjs
~~~

A checkout placed inside the profile tree (e.g. at `$PROFILE/plugins/`) runs them
in place. Do **not** link `node_modules` at the profile's module fallback to make
a checkout outside the profile work: pnpm follows the link and rewrites the
shared fallback for every profile.

`tests/adapter.smoke.mjs` drives a fake endpoint and asserts the wire request
(URL, session headers, attribution headers, credential), the chunk stream, usage
mapping, the replay envelope, configured overrides — including that a partial
override keeps the installed protocol, reasoning flag, and modalities — and the
`MISSING_CREDENTIAL` path. `tests/host.smoke.mjs` mounts the plugin into a stub Cordis context and
asserts the route registration and the configurable-provider directory entry the
Models page builds its row from. `tests/card.smoke.mjs` loads the real browser
bundle under a stub module system and a stub React and asserts the card's
registration seat, chrome, the per-model list and its inherit-vs-state editor,
staging, and the exact save payload (including that an inherited field is absent
from the override).

## License

MIT
