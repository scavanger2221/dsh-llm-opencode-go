/**
 * Live model-catalog refresh for the OpenCode Go route.
 *
 * Two public endpoints are involved, both reachable without a subscription
 * key:
 *
 *  - `{apiRoot}/v1/models` — the authoritative, always-current list of model
 *    ids OpenCode Go serves. This is what makes a newly released model usable
 *    without editing configuration or upgrading pi-ai.
 *  - `https://models.dev/api.json` — the community catalog pi-ai itself is
 *    generated from. It supplies per-model protocol, capacities, modalities
 *    and pricing for ids the pinned pi-ai release predates, so a refreshed
 *    model is configured with its real wire protocol instead of a guess.
 *
 * The metadata document is large and rarely changes, so it is fetched at most
 * once per TTL and only when the live list names an id the catalog cannot
 * already describe; when it is unreachable the entry still registers, using a
 * vendor-prefix guess for its protocol.
 *
 * @module dsh-llm-opencode-go/refresh
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { OPENAI_COMPLETIONS, OPENAI_RESPONSES, apiForNpm } from './catalog.js'

const DEFAULT_METADATA_URL = 'https://models.dev/api.json'
const DEFAULT_METADATA_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 30000

/** Fetch one URL with JSON parsing, attribution, bounded size and a timeout. */
async function readJson(url, signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  timer.unref?.()
  const composed = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...attributionHeaders() },
      signal: composed,
    })
    if (!response.ok) throw new Error(`GET ${url} answered HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read the model ids OpenCode Go currently serves.
 * @param options - API root, cancellation and timeout.
 * @returns advertised ids in endpoint order, duplicates removed.
 */
export async function fetchLiveModelIds(options) {
  const url = `${options.apiRoot}/v1/models`
  const body = await readJson(url, options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const rows = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body)
        ? body
        : []
  const ids = []
  for (const row of rows) {
    const id = typeof row === 'string' ? row : row?.id
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  if (ids.length === 0) throw new Error(`${url} advertised no models`)
  return ids
}

/** Keep the models.dev modalities pi-ai can carry, always including text. */
function inputModalities(entry) {
  const declared = Array.isArray(entry?.modalities?.input) ? entry.modalities.input : []
  const input = []
  if (declared.includes('text') || declared.length === 0) input.push('text')
  if (declared.includes('image')) input.push('image')
  return input
}

/** Map models.dev pricing onto pi-ai's cost shape. */
function costOf(entry) {
  const cost = entry?.cost
  if (cost === undefined || cost === null) return undefined
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    input: number(cost.input),
    output: number(cost.output),
    cacheRead: number(cost.cache_read),
    cacheWrite: number(cost.cache_write),
  }
}

const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Translate models.dev reasoning options into pi-ai's level map. Only the
 * OpenAI protocols consume the map; Anthropic Messages keeps pi-ai's own
 * effort handling.
 */
function thinkingLevelMapOf(entry, api) {
  if (api !== OPENAI_COMPLETIONS && api !== OPENAI_RESPONSES) return undefined
  const options = Array.isArray(entry?.reasoning_options) ? entry.reasoning_options : []
  const effort = options.find((option) => option?.type === 'effort')
  const values = Array.isArray(effort?.values) ? effort.values : undefined
  if (values === undefined) return undefined
  const map = {}
  for (const level of EFFORT_LEVELS) map[level] = values.includes(level) ? level : null
  if (values.includes('none')) map.off = 'none'
  return map
}

/** Build one catalog spec from a models.dev entry. */
function specFromModelsDev(id, entry) {
  const api = apiForNpm(entry?.provider?.npm, id)
  const context = entry?.limit?.context
  const output = entry?.limit?.output
  return {
    id,
    name: typeof entry?.name === 'string' && entry.name.length > 0 ? entry.name : id,
    api,
    ...(typeof context === 'number' && Number.isFinite(context) ? { contextWindow: context } : {}),
    ...(typeof output === 'number' && Number.isFinite(output) ? { maxTokens: output } : {}),
    ...(typeof entry?.reasoning === 'boolean' ? { reasoning: entry.reasoning } : {}),
    input: inputModalities(entry),
    ...(costOf(entry) === undefined ? {} : { cost: costOf(entry) }),
    ...(thinkingLevelMapOf(entry, api) === undefined
      ? {}
      : { thinkingLevelMap: thinkingLevelMapOf(entry, api) }),
    enriched: true,
  }
}

/**
 * Create the refresher bound to one catalog.
 * @param options - catalog, endpoint roots, TTLs, logger.
 * @returns `{ refresh }` plus the last outcome for diagnostics.
 */
export function createRefresher(options) {
  const metadataUrl = options.metadataUrl ?? DEFAULT_METADATA_URL
  const metadataTtlMs = options.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = options.logger
  let metadataCache
  let inflight
  let last

  async function metadataTable(signal) {
    if (metadataCache !== undefined && Date.now() - metadataCache.at < metadataTtlMs) {
      return metadataCache.table
    }
    const body = await readJson(metadataUrl, signal, timeoutMs)
    const provider = body?.['opencode-go']
    const table = new Map()
    for (const [id, entry] of Object.entries(provider?.models ?? {})) table.set(id, entry)
    metadataCache = { at: Date.now(), table }
    return table
  }

  async function run(signal) {
    const started = Date.now()
    const outcome = { at: started, live: 0, added: [], enriched: 0, total: 0 }
    try {
      const ids = await fetchLiveModelIds({ apiRoot: options.apiRoot, signal, timeoutMs })
      outcome.live = ids.length
      const missing = ids.filter((id) => options.catalog.get(id) === undefined)
      let specs = []
      if (missing.length > 0) {
        let table
        try {
          table = await metadataTable(signal)
        } catch (error) {
          log?.warn?.(`llm-opencode-go: models.dev metadata unavailable (${String(error?.message ?? error)}); registering new models from their id alone`)
        }
        specs = missing.map((id) => {
          const entry = table?.get(id)
          return entry === undefined
            ? { id, name: id, api: apiForNpm(undefined, id) }
            : specFromModelsDev(id, entry)
        })
        outcome.enriched = specs.filter((spec) => spec.enriched === true).length
      }
      outcome.added = options.catalog.mergeRefreshed(specs)
      outcome.total = options.catalog.models().size
    } catch (error) {
      outcome.error = String(error?.message ?? error)
    }
    outcome.ms = Date.now() - started
    last = outcome
    return outcome
  }

  return {
    /** Refresh once; concurrent callers share the in-flight run. */
    refresh(signal) {
      if (inflight !== undefined) return inflight
      inflight = run(signal).finally(() => {
        inflight = undefined
      })
      return inflight
    },
    /** The most recent outcome, for diagnostics. */
    last() {
      return last
    },
    /** Disarm the metadata cache (used when the endpoint changes). */
    reset() {
      metadataCache = undefined
    },
  }
}
