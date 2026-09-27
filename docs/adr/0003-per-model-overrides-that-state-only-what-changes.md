# ADR 0003: Per-model overrides that state only what changes

English | [中文](0003-per-model-overrides-that-state-only-what-changes.zh.md)

## Status

Accepted — 2026-09-25

## Context

The card's model section was an editor for hand-written override entries. It
started empty — "No overrides — the built-in catalog is used as it is" — and
adding one meant typing a model ID that the user had to know already, or opening a
separate list of ID chips and picking one. The result was a settings surface that
*looked* like it had no per-model settings at all, which is how it was reported:
"there is no individual model setting on the plugin".

Three facts decide what a per-model editor can be:

- **`LlmDiscoveredModel` is the whole discovery contract.** The host answers
  `llm.registerModelDiscovery` with `id`, `name?`, `contextWindow?`, `maxTokens?`,
  and `inputModalities?`; the service normalizes the reply to exactly those keys.
  The **protocol** and the **reasoning flag** are not in it, and no configuration
  surface can read them back for a model it did not declare itself.
- **The catalog merge takes only what an override states.** `mergeModel` spreads
  the installed entry and applies the fields the entry carries, so an entry with
  one field changes one field.
- **The old editor stated every field.** `canonicalModel` always emitted `api`,
  `reasoning`, and `input`, defaulting the protocol to `openai-completions`.

Together those are a trap: a form that must write a protocol it cannot read has to
guess, and `mergeModel` applies the guess — editing one model's context window
would silently move that model from Anthropic Messages to Chat Completions.

The other configuration surface is the row's `config:` block in the profile
patch, and on 0.1.7 there is no `settings.yaml` to fall back on: the Harness
imported it once into `settings.yaml.imported` and stopped reading it.

## Decision

Make the model section a per-model editor over the **effective catalog**, and let
an override state only what it changes.

- The host half answers model discovery with the facts it has: each catalog
  model's `name`, `contextWindow`, `maxTokens`, and `inputModalities`, resolved
  through the live catalog (so a stored override is reflected in what the reply
  describes).
- `lib/client.js` renders one row per served model — the catalog's models in
  catalog order, then any override for an id the catalog does not advertise —
  showing the value a request would use: the override's where it states one, the
  catalog's otherwise. A row carrying an override is marked, and removing it hands
  the model back to the catalog.
- Every field of the editor starts on **Inherit**, and `canonicalModel` leaves an
  inherited field out of the entry. `modelDraftOf` maps an absent field back to
  Inherit, so a stored entry round-trips unchanged.
- The protocol may be inherited only from a model the plugin's own catalog
  describes. A model added by ID is not in it — the host would synthesize it from
  a same-protocol template — so that override states its protocol explicitly.
- Overrides are compared field by field rather than by `JSON.stringify`, so a
  hand-edited patch that spells the same override with its keys in another order
  is not staged as a change.
- An entry may also carry `disabled: true`, which the card offers as a per-row
  **Disable**. The catalog then keeps the id *described* but not *served*:
  `models()`, `ids()`, and `get()` skip it (the provider does not advertise it,
  the picker does not offer it, and a request naming it fails with an explanation
  that says it is disabled), while `all()` still yields it and model discovery
  answers from `all()`, so the card keeps rendering the row — with its facts — to
  switch it back on. A live refresh never re-adds a disabled id, because a
  configured id belongs to configuration rather than to the endpoint. Disabling
  writes the flag and nothing else, and enabling drops the entry again when the
  flag was everything it carried.
- The card keeps a single Save for everything staged; the per-model form only
  stages a list entry.

## Consequences

- Editing one fact about one model no longer rewrites the others. The card test
  pins this: the write for a model whose protocol was left on Inherit carries no
  `api` key, and the adapter test pins that a partial override keeps the installed
  protocol, reasoning flag, and modalities.
- The list is only as informative as discovery. A model that discovery cannot
  describe — one the endpoint advertises but neither the pinned catalog nor
  models.dev knows — shows its ID with unknown facts until the user states them;
  capacities are never invented.
- A model's protocol and reasoning flag are visible in the list only when an
  override states them, because the discovery contract has no field for either.
  Widening that contract is a Harness change, not this plugin's.
- A disabled model that a session — or `agent-default-model` — still names fails
  loudly instead of being sent. That is the point, but it means switching off the
  model you are currently talking to breaks the next request until you pick
  another one.
- The card's copy changed with the surface: the section is "Models" rather than
  "Your models", and Inherit is explained where it is offered.
