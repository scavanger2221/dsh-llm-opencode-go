# AGENTS.md

Agent-facing contract for this repository. Read it before changing anything.

## What this repository is

One DeepSeek Harness plugin, published as one package, in two halves:

- `lib/index.js` + `lib/adapter.js` + `lib/catalog.js` + `lib/refresh.js` +
  `lib/convert.js` — the host half: the `opencode-go` LLM route.
- `lib/client.js` — the browser half: the settings card in the Models page footer
  (`settings.models.footer`).
- `cordis.patch.yml` — the bundle layer that mounts the single row which carries
  both halves (`dsh.bundle` + `dsh.client` in `package.json`).

**There is no build step.** `lib/` is the source, committed as-is, which is what
makes a GitHub installation work without a build-script allowlist. Do not add a
bundler, and do not generate `lib/` from anywhere else.

## Rules that are easy to get wrong

- **The client bundle is hand-written in the module-system format.** It must keep
  the `window.__ModuleLoader__.load({ id: '<package name>', factory })` wrapper,
  the `id` equal to the package name, and `exports.apply` + `exports.inject` on
  the returned object. Require only primitives the shipped package declares: a
  wrong export name is not an error, it silently becomes the card's fallback
  (the header chevron asked for `IconChevronDownOutline14`, which no package has
  ever exported, and drew a `▾` text glyph instead of the icon every shipped
  package uses, `IconChevronDownOutlineRegular`). It may `require` only the
  shell's static module table (`react`, `react/jsx-runtime`,
  `@deepseek-ai/dsh-client-ui-primitives`, …) plus its own files. Cross-plugin
  imports are forbidden: collaborate through cordis services (`exports.inject`)
  instead.
- **Every provider request carries the session headers.** `x-opencode-session` and
  `x-deepseek-harness-session-id` come from `GenerateOptions.sessionId`; Go
  refuses a request without them (`400 MissingSessionID`). The attribution headers
  from `attributionHeaders()` are mandatory and must not be overridable by
  deployment config.
- **`lib/convert.js` mirrors `dsh-llm-pi-ai`'s conversion, and must keep doing
  so.** The harness↔pi-ai seam (history refusals, `toolResult` projection,
  `userContent`, offload, stop/usage/error mapping) is owned by the shipped
  pi-ai adapter; this route duplicates that seam only because it must add the
  session headers, so a divergence is a bug in this plugin, not a design choice.
  A tool result is a first-class `{role:'tool', content, toolCallId, isError}`
  message — there is no `tool-result` block type — and images are legal in
  `user` and `tool` messages, refused in every other role. On a harness or
  pi-ai upgrade, re-diff the context region of `dsh-llm-pi-ai/lib/index.js`
  against `lib/convert.js`; `tests/adapter.smoke.mjs` pins the resulting rules.
- **The pi-ai context must be normalized before it reaches a provider.** From
  pi-ai 0.87 the prompt and the tool declarations are folded into the leading
  system message by `normalizeContext`, and only the `Models` registry
  (`Models.streamSimple`) calls it — the API implementations read
  `getDeclaredTools(messages)`/`getCurrentSystemMessage`, and nothing reads
  `context.systemPrompt` or `context.tools` any more. `dsh-llm-pi-ai` streams
  through that registry; this route dispatches through the provider it builds
  itself, so `lib/adapter.js` calls the same public `normalizeContext`
  (`@earendil-works/pi-ai/utils/transcript`) at the call site. Skip it and every
  request goes out with the user turn alone — no system prompt, no tools — and
  the model answers as a bare chat model, inventing tool markup as text instead
  of calling a tool. `tests/adapter.smoke.mjs` asserts a tool declaration and the
  system prompt reach the wire, and that a streamed tool call becomes a block.
- **Do not put a secret in a settings field.** The API key goes through the
  credentials service (`ctx.credentials.resolve(apiKeyEnv)`); settings fields are
  the endpoint, refresh policy, and model overrides. The `OPENCODE_GO_API_KEY`
  reference exists because an exported environment variable shadows the managed
  credential store.
- **A field must be `.volatile()` to be editable, or the card renders nothing.**
  On 0.1.7 the settings service projects a namespace only for a schema with at
  least one volatile node (`volatileForm`) — with none, `configForms.get(NS)`
  reports the namespace unavailable and the card returns `null`. Volatile also
  means "commit in place": the write does not remount the entry, so derived state
  is rebuilt from the `loader/volatile-update` event (see `resync`).
- **Read configuration through the live Config references.** From 0.1.7 the
  Loader hands `apply` a Schemastery Config whose volatile nodes are references
  (`config.apiRoot.get()`), not a plain object. Field access without `.get()`
  yields a reference object, so every `textOr(value, DEFAULT)` silently falls
  back to its default and the settings document appears to do nothing.
  `settings.installSection` and the `settingsScope` client service no longer
  exist.
- **The settings card lives in the Models page footer**, not in a provider row:
  `llm-pi-ai` declares the whole pi-ai provider catalog, `opencode-go` included,
  so `settings.models.provider-card` for that row dispatches under the
  `llm-pi-ai` namespace and this plugin's own directory entry is refused as a
  duplicate. `settings.models.footer` needs no directory row.
- **An override states only what it changes.** The card's per-model form keeps
  every untouched field on Inherit and leaves it out of the entry, because the
  catalog merge (`mergeModel`) only takes the fields an entry carries. Writing
  every field instead is not harmless: `LlmDiscoveredModel` — the whole
  `llm.registerModelDiscovery` contract — carries `id`, `name`, `contextWindow`,
  `maxTokens`, and `inputModalities`, and **not** the protocol or the reasoning
  flag, so a form that must state them can only guess, and a wrong guess switches
  a model's wire protocol. The discovery reply must keep carrying the facts it
  can (`catalogView`, host half): the per-model list renders exactly those.
- **A disabled model is described but not served.** `models:` entries take
  `disabled: true`, and the catalog keeps every described id in one ordered map:
  `models()`, `ids()`, and `get()` exclude the disabled ones (that is what the
  provider advertises and what the picker reads), while `all()` includes them
  (that is what `llm.registerModelDiscovery` must answer from, or the settings
  card loses the facts of the very row the user switched off). A live refresh
  must never re-add one — a configured id belongs to configuration, not to the
  endpoint — and an error naming a disabled model should say it is disabled
  rather than "unknown".
- **`$DSH_HOME/settings.yaml` is not a configuration surface on 0.1.7.** The
  Harness imported it once into `settings.yaml.imported` and stopped reading it;
  per-row settings live as a `config:` override on the row in the active
  profile's `cordis.patch.yml`, which is also where the card's saves land.
- **A symlinked checkout cannot be installed where it stands.** Node resolves a
  symlinked package to its real path, so the imports inside this plugin walk up
  from the checkout and fail. Install by copying into the profile tree
  (`scripts/install-local.sh`) or from GitHub.
- **Never hand-edit an installed copy** under `$DSH_HOME/profiles/*/plugins/`.
  Change this repository, then reinstall and restart.

## Tests

There is no install step and this repository is not a package-manager project.
Run the tests from an installed copy, where the harness packages resolve through
the profile's module fallback:

~~~sh
cd "$DSH_HOME/profiles/web/plugins/dsh-llm-opencode-go"   # after installing
node tests/adapter.smoke.mjs && node tests/host.smoke.mjs && node tests/card.smoke.mjs
~~~

A checkout placed inside the profile tree runs them in place.

**Never link `node_modules` at `$DSH_HOME/profiles/node_modules`.** That directory
is the shared module fallback every profile resolves through; pnpm follows the
link and rewrites it with npm-published package versions, which silently breaks
the installed harness (a real incident: `@deepseek-ai/dsh-brand` from npm does not
export `brandString`, so the host half stopped importing). If the fallback is ever
clobbered, rebuild it from the installation — `--dump-config` does not heal, only
a real boot does:

~~~sh
INSTALL="$(npm root -g)/@deepseek-ai/dsh"
node --input-type=module -e "
import { healProfilesModuleFallback } from '$INSTALL/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'
await healProfilesModuleFallback({ installAnchor: '$INSTALL/package.json', home: '$HOME/.dsh' })
"
~~~

`tests/adapter.smoke.mjs` drives a fake HTTP endpoint and asserts the wire request
and the conversion contracts; `tests/host.smoke.mjs` mounts the plugin into a stub
Cordis context and asserts the route registration, the directory entry, the
settings page policy, and — with a real `Config` — that configured values reach
the route instead of falling back to schema defaults; `tests/card.smoke.mjs` loads
the real browser bundle under a stub module system and drives the card's
interactions. All three must pass before a change is done — the card test in
particular catches hook and registration-shape mistakes that a syntax check
cannot.

## Documentation

`README.md` and `README.zh.md` are a pair, as are the ADRs under `docs/adr/`
(`*.md` and `*.zh.md`). A behaviour change updates `CHANGELOG.md`; a decision
change adds an ADR rather than rewriting an old one.
