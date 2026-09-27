# ADR 0004: Keep owning the route, mirror pi-ai's conversion

English | [中文](0004-mirror-pi-ai-conversion.zh.md)

## Status

Accepted — 2026-09-27

Amends [ADR 0001](0001-own-the-opencode-go-route.md), which stays accepted: the
route is still owned here. This ADR records what was re-examined, what the
delegation option would cost, and the rule that now governs the duplicated seam.

## Context

A session that had called `read_image` could not run again:

```
OpenCode Go cannot represent an image in an in-history tool message
```

The guard was ours (`lib/convert.js`), and it was stricter than the seam it was
copied from. In the 0.1.7 vocabulary a tool result is a first-class message —
`{role: 'tool', content, toolCallId, isError}`, `dsh-llm/lib/types/message.d.ts`
— and `dsh-llm-pi-ai` projects exactly that (`toolResultOf`), refusing images
only in roles that are neither `user` nor `tool`. Ours still looked for
`tool-result` blocks, which no current message carries, so a tool message fell
through to the user branch: its text was flattened into a `user` turn, its
`toolCallId` was dropped, and its image tripped the stricter guard. Two defects,
one of them silent, from the same cause: a hand-maintained copy of a seam that
someone else owns and keeps changing.

The obvious response was to stop owning the seam — delegate the route to the
shipped `llm-pi-ai` adapter, which now looks entirely possible:

- **pi-ai can send the session header after all.** ADR 0001 recorded that it
  never sends `x-opencode-session` (true — the string appears nowhere in the
  package) and that no configuration adds it. But Go accepts a second name:
  `compat.sendSessionAffinityHeaders: true` makes pi-ai emit
  `x-session-affinity: <sessionId>`, and Go answers `200` to it where a request
  without any session header is refused with `400 MissingSessionID`. Verified
  against the live endpoint, both ways.
- **Go's chat-completions endpoint is a superset.** Models the pinned catalog
  calls `anthropic-messages` answer on `/v1/chat/completions` too, so a single
  declared provider covers almost everything. Only genuinely responses-only
  models refuse it (`400 ModelProtocolUnsupported`).

What remains is not convertible, and it is all in `llm-pi-ai`'s configuration
schema rather than in pi-ai itself:

- **A provider profile sets `api` and `baseURL` per *route*, never per model.**
  `resolveRouteModels` resolves `api = request.api ?? base?.api ?? routeApi` and
  `baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl`, and a
  `models:` list *replaces* the served catalog — `modelOverrides`, the additive
  knob, refuses ids the pinned catalog does not describe and refuses to be
  combined with a `models:` list. So a route that serves Go's live models cannot
  keep per-model protocols: it becomes one route per protocol family.
- **The pinned catalog does not describe the models in use.** All six enabled
  models (`deepseek-v4.1-flash`, `mimo-v2.6-*`, `space-bunny-free`,
  `longcat-2.5-preview-free`, `gpt-6-luna`) are absent from
  `getBuiltinModels('opencode-go')`, which is the entire reason this plugin
  exists. Delegating moves the model list into another plugin's row: our card
  would have to write `providers.opencode-go.*` there (the host seam exists —
  `settings.mutate(ns, ops, revision)` is namespace-addressed and
  `providers` is volatile — but the configuration surface, the disabled flags,
  and the live refresh would all change hands).
- **The seam we would reuse is not importable.** `dsh-llm-pi-ai` exports
  `Config`, `PiAiAdapter`, `apply`, `inject`, `name`, `recordKeyFor`,
  `supportedProtocols` — no context conversion, and the `./src/*` subpath in its
  `exports` map points at sources the published package does not ship. Wrapping
  `PiAiAdapter` instead would mean reproducing its internal profile objects
  (`piProvider`, `resolveProfiles`, the auth context) — the same copying, only
  harder to notice.

## Decision

Own the route, as ADR 0001 decided, and treat the harness↔pi-ai seam in
`lib/convert.js` as a **mirror of `dsh-llm-pi-ai`'s conversion**, not as an
independent implementation:

- The history refusals are the same three (`developer` messages, tool-change
  blocks, images outside `user`/`tool`), `deferLoading` tools are refused, a tool
  message is projected as a pi-ai `toolResult`, `userContent` handles text and
  images with the same all-text collapse, offloaded images are skipped when
  request images are collected, and the stop/usage/error mapping follows the
  same table.
- Three things are deliberately ours and are documented as such in the module
  header: route-named error strings, the `PROVIDER_ERROR` fallback code, and the
  replay envelope — which stays an addition on top of durable content rather
  than a replacement for it.
- The mirror is a contract, not a habit. `AGENTS.md` requires re-diffing the
  context region of `dsh-llm-pi-ai/lib/index.js` against `lib/convert.js` on a
  harness or pi-ai upgrade, and `tests/adapter.smoke.mjs` pins the resulting
  rules: tool results on the wire as `tool` messages, in-history tool images
  replaying, and each refusal.
- Delegation is revisited only if pi-ai gains per-model protocol/baseURL
  configuration or a dynamic per-request header seam — at which point the
  arguments above stop applying, and ADR 0001's two reasons for owning the route
  are both satisfied upstream.

## Consequences

- The duplication stays, and so does the maintenance duty that comes with it.
  A harness or pi-ai change that touches context conversion is a change *here*,
  and the re-diff is a required step rather than a suggestion.
- The route keeps everything delegation would have cost: per-model protocols
  straight from the live catalog, `disabled` as a configuration fact, the live
  refresh, and model strings like `opencode-go/deepseek-v4.1-flash` that no
  deployment has to migrate.
- The session headers stay ours: `x-opencode-session` plus the harness-native
  `x-deepseek-harness-session-id`, emitted per request from
  `GenerateOptions.sessionId`, under the mandatory attribution headers.
- The findings above are now recorded where the next person will look: that Go
  accepts `x-session-affinity`, that its completions endpoint serves the
  models the pin calls anthropic, that a pi-ai profile cannot express a
  per-model protocol, and that the pinned catalog does not carry this
  deployment's models.
