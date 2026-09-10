# ADR 0001: Own the OpenCode Go route instead of pi-ai's built-in provider

English | [中文](0001-own-the-opencode-go-route.zh.md)

## Status

Accepted — 2026-09-10

## Context

`@earendil-works/pi-ai` already ships an `opencode-go` provider: it carries the
three wire protocols Go speaks (`openai-completions`, `openai-responses`,
`anthropic-messages`) and a pinned catalog of the models that existed when the
package was published. Delegating to it would cost no code at all — the profile
could declare a provider profile and be done.

Two facts rule that out.

**Go requires per-conversation session identity.** Its client matrix asks clients
for a stable session id so it can route requests and reuse prompt caches. A
request without it is refused outright:

```
HTTP 400
{"error":{"type":"MissingSessionID","message":"Request is missing x-opencode-session and cannot be routed efficiently"}}
```

pi-ai's provider does not send `x-opencode-session` (the string does not appear
anywhere in the package), and no configuration field adds it. The harness does
have the value — `GenerateOptions.sessionId`, stamped on every loop-built call —
but the seam that could attach it to a provider request belongs to the adapter,
not to the profile.

**The pinned catalog ages.** Go adds models on its own schedule. A pinned list
means a newly released model is not selectable until the dependency is bumped,
and a model whose context window or protocol changed is described wrongly until
then.

## Decision

Own the route in this plugin, on the harness's LLM seam:

- `LlmAdapter` (`lib/adapter.js`) registers the `opencode-go` route and builds
  the per-request options, including both `x-opencode-session` and the
  harness-native `x-deepseek-harness-session-id`, under the mandatory
  attribution headers.
- pi-ai still carries the wire protocols. The plugin calls
  `provider.streamSimple(model, context, { sessionId, … })` rather than
  reimplementing three protocols, so protocol behaviour stays with its owner.
- A three-layer catalog (`lib/catalog.js`) merges the pinned pi-ai models, user
  overrides from the settings section, and a live refresh of
  `{apiRoot}/v1/models` enriched from models.dev (`lib/refresh.js`). A refresh
  that adds models re-announces the route so the picker reloads.
- Configuration and the credential are read as ordinary harness seams: the
  `llm-opencode-go` settings section over the composition row, and
  `ctx.credentials.resolve(apiKeyEnv)` per request.

## Consequences

- Two behaviours the harness expects of a first-class provider — session
  identity and a route that answers `resolveModel` after the catalog changes —
  are ours to keep working. `tests/adapter.smoke.mjs` pins both.
- The plugin owns a model catalog, so it must handle ids it cannot describe:
  unknown ids are registered with a vendor-prefix protocol guess and corrected
  by hand through `models:` if the guess is wrong.
- The route is configurable from the GUI, because owning the settings namespace
  also makes the provider eligible for a card under Settings → Plugins — a
  surface pi-ai's shared provider profile cannot have per deployment.
- The conventional `OPENCODE_API_KEY` reference is not used. An exported
  environment value shadows the managed credential store, so a shell that
  exports another OpenCode key would silently win; the route pins
  `OPENCODE_GO_API_KEY` instead.
