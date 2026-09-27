# ADR 0002: Put the provider's settings card in the Models page footer

English | [中文](0002-model-provider-settings-on-the-models-page.zh.md)

## Status

Accepted — 2026-09-25

## Context

The card used to live under **Settings → Plugins**, registered into a
`settings.plugin.item` seat keyed by the provider's settings namespace. The 0.1.7
settings rework removed that destination and changed what a plugin's settings even
are:

- The Settings → Plugins section is now **Built-in plugins**, a shell around
  read-only inventory tabs. `settings.plugin.item` is declared by no shipped
  package, so a registration into it is accepted and rendered nowhere — the
  failure mode is a silently missing card, not an error.
- A plugin no longer installs a settings section. `settings.installSection` is
  gone: the settings service projects a namespace keyed by the entry id
  (`llm-opencode-go`) — but **only for a Config schema that declares at least one
  `.volatile()` field** (`volatileForm`). With none, the plugin has no namespace,
  `configForms.get(NS)` reports it unavailable, and the card renders nothing at
  all. A plugin that ships its own page then registers
  `settings.configure({ auto: false })`, and a write to a volatile field
  **commits into the running Config in place** (emitting
  `loader/volatile-update`) instead of remounting the entry.
- `apply` now receives a Schemastery Config whose fields are live references
  (`config.apiRoot.get()`), not a plain object. This plugin read them as plain
  fields, so every value resolved to its schema default: the settings document
  was silently ignored, and the removed `installSection` call threw inside its
  `ctx.inject` child.
- The Models page declares two seats for plugins distributed outside the harness
  repository: `settings.models.provider-card` (keyed by a provider row's settings
  namespace, dispatched on every card that renders a directory row) and
  `settings.models.footer` (an ordered list after the provider rows and the add
  controls).
- The `provider-card` seat is **unreachable for this route**. `llm-pi-ai`
  declares the whole pi-ai provider catalog on the configurable-provider
  directory — a bare mount offers every provider it ships, and a configured one
  still declares the catalog — and that catalog includes `opencode-go`. The host
  refuses a second declaration of the same provider id (all-or-nothing, so this
  plugin's own entry is dropped), the Models page joins the row to the
  `llm-pi-ai` namespace, and the seat is therefore dispatched with a key this
  plugin's card cannot own. Worse, that pi-ai entry is dormant: its
  `providers.opencode-go` profile does not resolve, so the row is not even in the
  saved-row list the seat belongs to.

So the old seat is dead, the provider-card seat is not addressable, and the page
still needs one always-rendered place for this provider's settings.

## Decision

Own the provider's settings surface in the **Models page footer**:

- `lib/index.js` reads configuration through the live Config references
  (`fieldOf`), so the deployment's endpoint, refresh policy, headers, credential
  reference, image budgets, and model overrides actually reach the route. A plain
  object is still accepted, which keeps a direct `apply` call and the host test
  working.
- The fields the card reads and writes — `apiRoot`, `refreshIntervalMs`, `models`,
  `refreshEpoch`, `apiKeyEnv`, `displayName` — are declared `.volatile()`. That is
  what makes the settings namespace exist at all, and it is also the boundary of
  what a form may write: the settings service refuses a path that is not volatile.
  `providerId` and the deployment-only fields stay ordinary, so changing one
  remounts the entry.
- Because a volatile write commits in place, `apply` subscribes to
  `loader/volatile-update` and rebuilds what was derived from the old values: the
  catalog, the refresher, and the cached provider instance. Re-announcing the
  route is what makes a changed model list reach the model picker, and the same
  path is what makes `refreshEpoch` (the card's "Refresh catalog now") work.
- It replaces the removed `installSection` call with the 0.1.7 policy seam —
  `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`
  — because this plugin ships its own editor. The route's own unsupported-`api`
  check goes with it: the Config schema's union already rejects that value.
- It keeps declaring the route on the configurable-provider directory as a
  best-effort: correct where nothing else owns the id, refused as
  `DUPLICATE_DIRECTORY` where `llm-pi-ai` does. That refusal is expected and
  logged at info level, and the card does not depend on the row.
- `lib/client.js` registers into `settings.models.footer` with its own entry id
  and locale. The seat is a list, always rendered, and needs no directory row.
- The card keeps its own `configForms` scope, credential store, staged edits,
  validation, and Save; the Models page's own editors never touch this namespace.
  It draws its own card box again (a page-level entry, not a fold inside a row)
  and titles itself from the namespace's resolved `displayName`, falling back to
  the shipped locale copy.
- No registration into `settings.models.provider-card` is kept: with the row
  dispatching under `llm-pi-ai` it would never render, and a guarded
  family-wide registration would mount one instance per pi-ai row for nothing.

## Consequences

- The card is at the foot of Settings → Models rather than inside an OpenCode Go
  row. That is less contextual, but it is guaranteed to render, which the
  provider-card seat is not.
- The route has no provider row of its own on the Models page: the directory
  entry belongs to `llm-pi-ai`, whose profile for `opencode-go` is dormant. A
  user who adopts that dormant row gets a pi-ai profile that can never register
  its route, because this plugin owns the `opencode-go` adapter.
- Configuration edits now genuinely apply. Before this change the plugin served
  requests from schema defaults only, so a user's `apiRoot`, headers, or model
  overrides had no effect.
- `tests/host.smoke.mjs` mounts a real `Config` with non-default values and
  asserts they reach the route, the directory entry, and the adapter catalog; its
  stub has no `installSection`, so a regression to the removed seam fails loudly.
- ADR 0001's consequence that the card lives under Settings → Plugins is
  superseded by this one; the route decision itself is unchanged.
