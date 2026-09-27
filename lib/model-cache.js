/**
 * The last model list OpenCode Go actually advertised, kept on disk.
 *
 * The pinned pi-ai catalog describes the Go models that existed when this
 * harness was released; Go keeps adding them, and the live refresh is what makes
 * a new id usable. That refresh is a network read, which leaves a hole: between
 * a (re)mount and the moment the endpoint answers, the route knows only the
 * pinned models — so a deployment whose default model is newer than the pin
 * answers `UNKNOWN_MODEL` for it. Every restart, and every hot reload, walks
 * into that hole.
 *
 * This cache closes it. A successful refresh writes the specs it merged, pruned
 * to the ids the endpoint still advertises; a mount seeds the catalog from
 * whatever is here before the live read starts, so the previous answer is served
 * immediately and the network read only updates it.
 *
 * Nothing here is a credential or a session: the payload is model metadata that
 * the endpoint publishes without authentication. It is a cache, not a source of
 * truth — every read is forgiving, and a file that is missing, truncated, or
 * written by a different version is treated as empty rather than as an error.
 * Reading is synchronous on purpose: seeding has to happen inside the same
 * `apply`, before the route is announced, or the hole it exists to close would
 * be open again.
 *
 * @module dsh-llm-opencode-go/model-cache
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { SUPPORTED_APIS } from './catalog.js'

/**
 * Cache generation. Bump it whenever the spec shape changes, so a file written
 * by an older plugin is ignored instead of seeding a catalog the current code
 * cannot render.
 */
export const CACHE_VERSION = 1

/** Refuse to read or write a cache beyond this size. */
export const MAX_CACHE_BYTES = 512 * 1024

/** Refuse to keep more models than a subscription could plausibly serve. */
export const MAX_CACHED_MODELS = 500

/** `$DSH_HOME/storages/<plugin>/catalog.json`, beside the other storages. */
export function defaultCatalogCacheFile(home = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
  return join(home, 'storages', 'llm-opencode-go', 'catalog.json')
}

/** Whether a value is a usable positive count. */
function countOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Map one cached entry onto the spec shape `catalog.mergeRefreshed` takes. */
function sanitizeSpec(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (id === '') return undefined
  const spec = { id }
  if (typeof entry.name === 'string' && entry.name.length > 0) spec.name = entry.name
  if (SUPPORTED_APIS.includes(entry.api)) spec.api = entry.api
  const contextWindow = countOf(entry.contextWindow)
  if (contextWindow !== undefined) spec.contextWindow = contextWindow
  const maxTokens = countOf(entry.maxTokens)
  if (maxTokens !== undefined) spec.maxTokens = maxTokens
  if (typeof entry.reasoning === 'boolean') spec.reasoning = entry.reasoning
  if (Array.isArray(entry.input)) {
    const input = [...new Set(entry.input.filter((modality) => modality === 'text' || modality === 'image'))]
    if (input.length > 0) spec.input = input
  }
  const cost = entry.cost
  if (cost !== null && typeof cost === 'object') {
    const fields = ['input', 'output', 'cacheRead', 'cacheWrite']
    if (fields.every((field) => typeof cost[field] === 'number' && Number.isFinite(cost[field]))) {
      spec.cost = Object.fromEntries(fields.map((field) => [field, cost[field]]))
    }
  }
  const thinking = entry.thinkingLevelMap
  if (thinking !== null && typeof thinking === 'object' && !Array.isArray(thinking)) {
    const clean = {}
    for (const [level, value] of Object.entries(thinking)) {
      if (typeof value === 'string' || value === null) clean[level] = value
    }
    if (Object.keys(clean).length > 0) spec.thinkingLevelMap = clean
  }
  return spec
}

/**
 * Read the cached specs.
 *
 * Every failure — no file, a directory in its place, half-written JSON, a
 * version this code does not know — answers an empty list: a cache that cannot
 * be trusted must not stop the plugin from mounting, and the live refresh is
 * about to replace it anyway.
 * @param file - cache path, or anything unusable to mean "no cache".
 * @returns the cached specs, newest shape only.
 */
export function readCatalogCache(file) {
  if (typeof file !== 'string' || file.length === 0) return []
  try {
    const text = readFileSync(file, 'utf8')
    if (text.length > MAX_CACHE_BYTES) return []
    const body = JSON.parse(text)
    if (body?.version !== CACHE_VERSION || !Array.isArray(body.models)) return []
    return body.models
      .slice(0, MAX_CACHED_MODELS)
      .map(sanitizeSpec)
      .filter((spec) => spec !== undefined)
  } catch {
    return []
  }
}

/**
 * Record what a live refresh learned.
 *
 * The merged set is pruned to the ids this run saw the endpoint advertise, so a
 * model Go withdraws stops being served on the next mount rather than lingering
 * in a file forever. `live` being empty is treated as "no trustworthy answer"
 * and writes nothing: a request that failed before listing ids must not wipe
 * what the cache knows.
 * @param file - cache path.
 * @param options - the specs this run merged, and every id the endpoint listed.
 * @returns nothing; the caller decides whether a failure matters.
 */
export async function writeCatalogCache(file, options) {
  if (typeof file !== 'string' || file.length === 0) return
  const live = new Set(
    (Array.isArray(options.live) ? options.live : []).filter((id) => typeof id === 'string' && id.length > 0),
  )
  if (live.size === 0) return
  const byId = new Map()
  for (const spec of readCatalogCache(file)) byId.set(spec.id, spec)
  for (const spec of options.specs ?? []) {
    const clean = sanitizeSpec(spec)
    if (clean !== undefined) byId.set(clean.id, clean)
  }
  const models = [...byId.values()].filter((spec) => live.has(spec.id)).slice(0, MAX_CACHED_MODELS)
  const payload = JSON.stringify({ version: CACHE_VERSION, at: new Date().toISOString(), models })
  if (payload.length > MAX_CACHE_BYTES) return
  await mkdir(dirname(file), { recursive: true })
  // Write beside the target and rename: a reader either sees the previous cache
  // or the new one, never the half-written middle of this one.
  const temporary = `${file}.${String(process.pid)}.tmp`
  await writeFile(temporary, payload, 'utf8')
  await rename(temporary, file)
}
