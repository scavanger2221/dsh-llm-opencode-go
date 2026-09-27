/**
 * Model-cache smoke test: the last live model list has to survive a reload,
 * because the pinned pi-ai catalog does not describe the newest Go models.
 *
 * This pins a real failure, not a hypothetical one. The live refresh is a
 * network read, so between a (re)mount and the endpoint's answer the route knows
 * only the pinned models; a deployment whose default model is newer than the pin
 * answers `UNKNOWN_MODEL` for it and the turn fails. That is exactly what
 * happened to a live session on a hot reload. The cache is what closes the gap.
 *
 * The other half of the contract matters just as much: the cache is a hint, so
 * it must be unable to override configuration, resurrect a model the endpoint
 * stopped advertising, or survive a failed listing.
 *
 * Run from an installed copy: node tests/cache.smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCatalog } from '../lib/catalog.js'
import {
  CACHE_VERSION,
  defaultCatalogCacheFile,
  readCatalogCache,
  writeCatalogCache,
} from '../lib/model-cache.js'

const assertEqual = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label)
  console.log(`ok   ${label}`)
}

const ok = (condition, label) => {
  assert.ok(condition, label)
  console.log(`ok   ${label}`)
}

const dir = mkdtempSync(join(tmpdir(), 'opencode-go-cache-'))
const file = join(dir, 'catalog.json')
const apiRoot = 'https://example.test/go'

// ── a cache that cannot be read is an empty cache, never an error ───────────
assertEqual(readCatalogCache(join(dir, 'absent.json')), [], 'a missing cache file reads as empty')
assertEqual(readCatalogCache(''), [], 'no configured path reads as empty')
console.log('ok   a cache that cannot be read is an empty cache')

// ── what a refresh learns survives the process ─────────────────────────────
const spec = {
  id: 'a-model-newer-than-the-pin',
  name: 'A Model Newer Than The Pin',
  api: 'anthropic-messages',
  contextWindow: 200000,
  maxTokens: 64000,
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  thinkingLevelMap: { off: null, low: 'low', high: 'high' },
}
await writeCatalogCache(file, { specs: [spec], live: [spec.id, 'glm-5.3'] })
assertEqual(readCatalogCache(file), [spec], 'a written spec comes back whole')

// ── the cache follows the endpoint, and only the endpoint ─────────────────
await writeCatalogCache(file, { specs: [{ id: 'glm-5.3', name: 'GLM 5.3' }], live: ['glm-5.3'] })
assertEqual(
  readCatalogCache(file).map((entry) => entry.id),
  ['glm-5.3'],
  'a model the endpoint stopped advertising is dropped on the next write',
)
await writeCatalogCache(file, { specs: [], live: [] })
assertEqual(
  readCatalogCache(file).map((entry) => entry.id),
  ['glm-5.3'],
  'a run that listed no id leaves the cache alone instead of wiping it',
)
console.log('ok   the cache follows the endpoint, and a failed listing changes nothing')

// ── junk is ignored rather than trusted ────────────────────────────────────
writeFileSync(file, '{not json')
assertEqual(readCatalogCache(file), [], 'a half-written cache reads as empty')
writeFileSync(file, JSON.stringify({ version: CACHE_VERSION + 1, models: [{ id: 'x' }] }))
assertEqual(readCatalogCache(file), [], 'a cache from another generation is ignored, not partially read')
writeFileSync(
  file,
  JSON.stringify({
    version: CACHE_VERSION,
    models: [
      { id: '' },
      { id: '  ' },
      null,
      { id: 'usable', api: 'not-a-protocol', contextWindow: -4, maxTokens: 'many', reasoning: 'yes', input: ['audio', 'text', 'text'], cost: { input: 1, output: 2 } },
    ],
  }),
)
assertEqual(
  readCatalogCache(file),
  [{ id: 'usable', input: ['text'] }],
  'an entry is kept only for the fields this code can act on',
)
console.log('ok   junk is ignored rather than trusted')

// ── the point: a seeded catalog serves a model the pin does not describe ───
const cacheFile = join(dir, 'seed.json')
await writeCatalogCache(cacheFile, { specs: [spec], live: [spec.id] })
const pinned = createCatalog({ apiRoot, providerId: 'opencode-go', models: [] })
assertEqual(pinned.get(spec.id), undefined, 'the installed catalog does not describe a model newer than the pin')
pinned.mergeRefreshed(readCatalogCache(cacheFile))
const seeded = pinned.get(spec.id)
ok(seeded !== undefined, 'the cache is what makes such a model servable before the live read lands')
assertEqual(seeded.api, 'anthropic-messages', 'a seeded model keeps the protocol the cache recorded')
assertEqual(seeded.contextWindow, 200000, 'a seeded model keeps the window the cache recorded')

// The real id that failed a live session, when the installed catalog still
// predates it. Once pi-ai ships it, the assertion above carries the contract.
const live = createCatalog({ apiRoot, providerId: 'opencode-go', models: [] })
if (live.get('deepseek-v4.1-flash') === undefined) {
  await writeCatalogCache(join(dir, 'live.json'), {
    specs: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', api: 'openai-completions', contextWindow: 131072 }],
    live: ['deepseek-v4.1-flash'],
  })
  live.mergeRefreshed(readCatalogCache(join(dir, 'live.json')))
  ok(
    live.get('deepseek-v4.1-flash') !== undefined,
    'the model a live session lost on reload is servable from the cache alone',
  )
} else {
  console.log('ok   the installed catalog describes deepseek-v4.1-flash itself; the seed above carries the contract')
}

// ── a hint never beats configuration ──────────────────────────────────────
const configured = createCatalog({
  apiRoot,
  providerId: 'opencode-go',
  models: [{ id: spec.id, disabled: true }],
})
configured.mergeRefreshed(readCatalogCache(cacheFile))
assertEqual(configured.get(spec.id), undefined, 'a seeded model configuration switched off stays off')
ok(configured.all().has(spec.id), 'a disabled seeded model stays described for the settings card')
console.log('ok   a seeded model cannot be served past a configuration that disabled it')

// ── the default location sits with the deployment's other storages ─────────
ok(
  defaultCatalogCacheFile('/home/example/.dsh').endsWith(join('storages', 'llm-opencode-go', 'catalog.json')),
  'the default cache file lives under the harness home',
)

console.log('CACHE SMOKE OK')
