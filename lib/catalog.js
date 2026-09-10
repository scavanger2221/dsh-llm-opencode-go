/**
 * Model catalog for the OpenCode Go route.
 *
 * The installed pi-ai catalog ships the OpenCode Go models as of the pi-ai
 * release this harness is pinned to (~25 models across three wire protocols).
 * OpenCode adds models continuously, so the catalog is a three-layer merge:
 *
 *  1. the installed pi-ai catalog (full metadata: protocol, capacities, compat);
 *  2. this plugin's `models:` configuration (add or correct entries by hand);
 *  3. a live refresh overlay (ids the Go `/v1/models` endpoint advertises that
 *     neither layer above describes), enriched from models.dev when reachable.
 *
 * @module dsh-llm-opencode-go/catalog
 */

import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'

/** OpenAI Chat Completions protocol. */
export const OPENAI_COMPLETIONS = 'openai-completions'
/** OpenAI Responses protocol. */
export const OPENAI_RESPONSES = 'openai-responses'
/** Anthropic Messages protocol. */
export const ANTHROPIC_MESSAGES = 'anthropic-messages'

/** Every protocol the Go endpoint serves through pi-ai. */
export const SUPPORTED_APIS = [OPENAI_COMPLETIONS, OPENAI_RESPONSES, ANTHROPIC_MESSAGES]

/** models.dev publishes the AI-SDK package that speaks each model's protocol. */
const API_BY_NPM = new Map([
  ['@ai-sdk/anthropic', ANTHROPIC_MESSAGES],
  ['@ai-sdk/openai', OPENAI_RESPONSES],
  ['@ai-sdk/openai-compatible', OPENAI_COMPLETIONS],
  ['@ai-sdk/openai-compatible-chat', OPENAI_COMPLETIONS],
])

/** Vendor-prefix fallback used when models.dev cannot be reached. */
const API_HINTS = [
  [/^(?:gpt|grok|o\d)/, OPENAI_RESPONSES],
  [/^(?:minimax|qwen)/, ANTHROPIC_MESSAGES],
]

/** Zero pricing for an entry no catalog prices; the harness never bills from it. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Endpoint prefix one protocol uses below the Go API root. Anthropic Messages
 * appends `/v1/messages` itself, so it takes the bare root; the OpenAI
 * protocols expect the `/v1` segment in the base URL.
 * @param api - wire protocol.
 * @param apiRoot - `https://opencode.ai/zen/go` by default.
 * @returns the base URL for that protocol.
 */
export function baseUrlFor(api, apiRoot) {
  return api === ANTHROPIC_MESSAGES ? apiRoot : `${apiRoot}/v1`
}

/** Resolve one ai-sdk package name (or model id) to a wire protocol. */
export function apiForNpm(npm, id = '') {
  const known = API_BY_NPM.get(String(npm ?? ''))
  if (known !== undefined) return known
  for (const [pattern, api] of API_HINTS) if (pattern.test(id)) return api
  return OPENAI_COMPLETIONS
}

/** Read the installed pi-ai catalog once, keeping one template per protocol. */
function installedCatalog(apiRoot, providerId) {
  const models = []
  const templates = new Map()
  for (const model of opencodeGoProvider().getModels()) {
    const rebased = {
      ...model,
      provider: providerId,
      ...(apiRoot === undefined ? {} : { baseUrl: baseUrlFor(model.api, apiRoot) }),
    }
    models.push(rebased)
    if (!templates.has(rebased.api)) templates.set(rebased.api, rebased)
  }
  // A deployment may narrow the endpoint to a protocol the catalog ships no
  // model for; fall back to any installed entry so a synthesized model still
  // carries plausible compat defaults.
  const fallback = models[0]
  for (const api of SUPPORTED_APIS) if (!templates.has(api) && fallback !== undefined) {
    templates.set(api, { ...fallback, api })
  }
  return { models, templates }
}

/** Pick the template a synthesized model of one protocol clones. */
function templateFor(templates, api) {
  return templates.get(api) ?? templates.values().next().value
}

/**
 * Build one model entry, cloning a same-protocol catalog entry for the compat
 * switches and capacities the caller did not state.
 * @param spec - id plus any known metadata.
 * @param templates - installed entries keyed by protocol.
 * @param apiRoot - endpoint root.
 * @param providerId - route id the model reports as its provider.
 * @returns a pi-ai `Model`.
 */
export function synthesizeModel(spec, templates, apiRoot, providerId = 'opencode-go') {
  const api = SUPPORTED_APIS.includes(spec.api) ? spec.api : OPENAI_COMPLETIONS
  const template = templateFor(templates, api)
  const base = template === undefined ? {} : template
  return {
    ...base,
    id: spec.id,
    name: spec.name ?? spec.id,
    api,
    provider: providerId,
    baseUrl: apiRoot === undefined ? (base.baseUrl ?? baseUrlFor(api)) : baseUrlFor(api, apiRoot),
    reasoning: spec.reasoning ?? base.reasoning ?? true,
    input: spec.input ?? base.input ?? ['text'],
    cost: spec.cost ?? NO_COST,
    contextWindow: spec.contextWindow ?? base.contextWindow ?? 262144,
    maxTokens: spec.maxTokens ?? base.maxTokens ?? 32768,
    ...(spec.thinkingLevelMap === undefined
      ? base.thinkingLevelMap === undefined
        ? {}
        : { thinkingLevelMap: base.thinkingLevelMap }
      : { thinkingLevelMap: spec.thinkingLevelMap }),
    ...(base.compat === undefined ? {} : { compat: base.compat }),
  }
}

/** Merge configured fields over an installed entry without losing its compat. */
function mergeModel(base, spec, apiRoot, providerId) {
  const api = SUPPORTED_APIS.includes(spec.api) ? spec.api : base.api
  const baseUrl =
    apiRoot !== undefined
      ? baseUrlFor(api, apiRoot)
      : api === base.api
        ? base.baseUrl
        : baseUrlFor(api)
  return {
    ...base,
    ...(spec.name === undefined ? {} : { name: spec.name }),
    api,
    provider: providerId ?? base.provider,
    baseUrl,
    ...(spec.reasoning === undefined ? {} : { reasoning: spec.reasoning }),
    ...(spec.input === undefined ? {} : { input: spec.input }),
    ...(spec.cost === undefined ? {} : { cost: spec.cost }),
    ...(spec.contextWindow === undefined ? {} : { contextWindow: spec.contextWindow }),
    ...(spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens }),
    ...(spec.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: spec.thinkingLevelMap }),
    ...(spec.compat === undefined ? {} : { compat: { ...(base.compat ?? {}), ...spec.compat } }),
  }
}

/**
 * Create the layered catalog.
 * @param options - endpoint root, route id, and the configured model entries.
 * @returns catalog accessors plus the refresh merge point.
 */
export function createCatalog(options) {
  const apiRoot = options.apiRoot
  const providerId = options.providerId ?? 'opencode-go'
  const installed = installedCatalog(apiRoot, providerId)
  const templates = installed.templates
  /** id -> model, current merged view. */
  const entries = new Map(installed.models.map((model) => [model.id, model]))
  /** ids contributed by the installed catalog (config overrides them instead of adding). */
  const installedIds = new Set(entries.keys())
  /** ids this catalog introduced from a live refresh, safe to re-merge. */
  const refreshedIds = new Set()
  /** ids a configured `models:` entry owns; a refresh never rewrites them. */
  const configuredIds = new Set()

  for (const spec of options.models ?? []) {
    if (typeof spec?.id !== 'string' || spec.id.length === 0) continue
    const base = entries.get(spec.id)
    entries.set(
      spec.id,
      base === undefined
        ? synthesizeModel(spec, templates, apiRoot, providerId)
        : mergeModel(base, spec, apiRoot, providerId),
    )
    configuredIds.add(spec.id)
  }

  return {
    /** Current merged model list, installed order first. */
    models() {
      return entries
    },
    /** One exact model, or undefined when the id is unknown. */
    get(id) {
      return entries.get(id)
    },
    /** Whether the id came from the installed catalog rather than a refresh. */
    isInstalled(id) {
      return installedIds.has(id)
    },
    /** Every id the merged catalog currently advertises. */
    ids() {
      return [...entries.keys()]
    },
    /**
     * Merge refreshed model specs, keeping the first answer for any id the
     * catalog already describes. An entry a live refresh introduced earlier is
     * re-merged, so later metadata still wins; a configured entry never is.
     * @param specs - refreshed entries (id plus known metadata).
     * @returns the ids this merge added.
     */
    mergeRefreshed(specs) {
      const added = []
      for (const spec of specs) {
        if (typeof spec?.id !== 'string' || spec.id.length === 0) continue
        const existing = entries.get(spec.id)
        if (existing !== undefined) {
          if (refreshedIds.has(spec.id) && !configuredIds.has(spec.id)) {
            entries.set(spec.id, mergeModel(existing, spec, apiRoot, providerId))
          }
          continue
        }
        entries.set(spec.id, synthesizeModel(spec, templates, apiRoot, providerId))
        refreshedIds.add(spec.id)
        added.push(spec.id)
      }
      return added
    },
  }
}
