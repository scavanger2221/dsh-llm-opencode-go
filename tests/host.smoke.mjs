/**
 * Host smoke test: mount the real plugin into a stub Cordis context and assert
 * the registrations and the configuration contract the Web GUI is built from.
 *
 * Two failures are guarded here, both of them silent in production:
 *
 *  - **The route is registered but the deployment's own configuration is
 *    ignored.** From 0.1.7 the Loader hands `apply` a Schemastery Config whose
 *    fields are live references (`config.apiRoot.get()`), not a plain object. A
 *    plugin that reads `config.apiRoot` gets a field object, so every
 *    `textOr(value, DEFAULT)` falls back to its default and the settings
 *    document looks like it does nothing. This file mounts a real `Config` with
 *    non-default values and asserts they reach the route and the directory.
 *  - **The settings page policy is installed through a seam that no longer
 *    exists.** 0.1.7 replaced `settings.installSection` with an automatically
 *    projected namespace plus `settings.configure({ auto: false })` for a plugin
 *    that ships its own page. The stub here has no `installSection` at all, so
 *    calling one throws.
 *
 * Run from an installed copy (it imports the harness packages the plugin's own
 * closure needs): node tests/host.smoke.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config, NS } from '../lib/index.js'
import { writeCatalogCache } from '../lib/model-cache.js'
import { USAGE_ROUTE } from '../lib/usage.js'

const assertEqual = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label)
  console.log(`ok   ${label}`)
}

/** A stub of the service surface `apply` touches, recording every call. */
function createContext() {
  const calls = { adapters: [], directory: [], discovery: [], discoverers: [], effects: [], commands: [], policies: [], routes: [], listeners: new Map() }
  /** The credential seam, mutable so the usage route can be driven keyless. */
  const credentials = {
    value: 'test-key',
    async resolve() {
      return credentials.value === undefined ? undefined : { value: credentials.value }
    },
  }
  const handle = (record) => Object.assign(() => {}, { replace: (next) => record(next) })
  const ctx = {
    fiber: {},
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => (name === 'credentials' ? credentials : undefined),
    on: (event, listener) => {
      calls.listeners.set(event, listener)
      return () => {}
    },
    effect: (factory, label) => {
      calls.effects.push(label)
      const disposer = factory()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject: (_names, callback) => callback(ctx),
    llm: {
      registerAdapter: (providers, adapter) => {
        calls.adapters.push({ providers: [...providers], adapter })
        return handle((next) => calls.adapters.push({ providers: [...next], adapter, replaced: true }))
      },
      registerConfigurableProviders: (entries) => {
        const detached = entries.map((entry) => ({ ...entry, settingsPath: [...entry.settingsPath] }))
        calls.directory.push(detached)
        return handle((next) =>
          calls.directory.push(next.map((entry) => ({ ...entry, settingsPath: [...entry.settingsPath] }))),
        )
      },
      registerModelDiscovery: (namespace, discover) => {
        calls.discovery.push(namespace)
        calls.discoverers.push(discover)
        return () => {}
      },
    },
    // Deliberately shaped like 0.1.7: no `installSection`, and a policy seam.
    settings: {
      configure: (presentation, owner) => {
        calls.policies.push({ presentation: { ...presentation }, owner })
        return () => {}
      },
    },
    commands: { register: (command) => calls.commands.push(command) },
    connection: {
      fetch: {
        register: (route) => {
          calls.routes.push(route)
          return () => {}
        },
      },
    },
  }
  return { ctx, calls, credentials }
}

/**
 * The shape the Loader actually hands `apply`: the resolved fiber config, whose
 * volatile nodes are live references (`{ get() }`) and whose ordinary nodes are
 * plain values. `holder` stands in for the running references the loader commits
 * an in-place update into.
 */
/**
 * What a previous live read learned. The pinned catalog does not describe these
 * ids, so a mount that did not seed from the cache would answer UNKNOWN_MODEL
 * for them until the network read lands — the failure a hot reload put in front
 * of a live session.
 */
const cacheDir = mkdtempSync(join(tmpdir(), 'opencode-go-host-'))
const cacheFile = join(cacheDir, 'catalog.json')
await writeCatalogCache(cacheFile, {
  specs: [
    {
      id: 'cached-brand-new',
      name: 'Cached Brand New',
      api: 'anthropic-messages',
      contextWindow: 200000,
      maxTokens: 32000,
      input: ['text', 'image'],
    },
  ],
  live: ['cached-brand-new'],
})

const holder = {
  providerId: 'opencode-go-renamed',
  displayName: 'Go Renamed',
  apiKeyEnv: 'OPENCODE_GO_API_KEY',
  apiRoot: 'http://127.0.0.1:1',
  models: [{ id: 'extra-model', api: 'anthropic-messages', contextWindow: 262144 }],
  refreshIntervalMs: 0,
  refreshEpoch: 0,
  refreshOnMount: false,
  // Never the real store: a test must not read or write the machine's cache.
  catalogCacheFile: cacheFile,
}
const ref = (name) => ({ get: () => holder[name] })
const live = {
  ...holder,
  providerId: ref('providerId'),
  displayName: ref('displayName'),
  apiKeyEnv: ref('apiKeyEnv'),
  apiRoot: ref('apiRoot'),
  models: ref('models'),
  refreshIntervalMs: ref('refreshIntervalMs'),
  refreshEpoch: ref('refreshEpoch'),
  refreshOnMount: ref('refreshOnMount'),
}

const { ctx, calls, credentials } = createContext()
apply(ctx, live)

assertEqual(calls.adapters[0].providers, ['opencode-go-renamed'], 'reads providerId through a live Config reference')
assertEqual(calls.discovery, [NS], 'offers model discovery under the namespace')
assertEqual(
  calls.directory[0],
  [
    {
      provider: 'opencode-go-renamed',
      displayName: 'Go Renamed',
      settingsNs: NS,
      settingsPath: [],
    },
  ],
  'the directory entry names the configured route and display name',
)
assertEqual(
  calls.policies.map((policy) => policy.presentation),
  [{ auto: false }],
  'opts out of a generated settings form through the 0.1.7 policy seam',
)

// The catalog the adapter serves must carry the configured override, which only
// happens when the live reference is read rather than the schema field object.
const models = await calls.adapters[0].adapter.listModels('opencode-go-renamed')
assert.ok(
  models.some((model) => model.id === 'extra-model'),
  'the configured model override reaches the adapter catalog',
)
console.log('ok   the configured model override reaches the adapter catalog')

// ── a (re)mount serves what the last live read learned ──────────────────────
// The live refresh is a network read and the pinned catalog predates the newest
// Go models, so without the cache seed there is a window after every mount in
// which a deployment's own default model is unknown to the route. This is the
// failure a hot reload produced against a live session; the seed closes it.
const servedAtMount = await calls.adapters[0].adapter.listModels('opencode-go-renamed')
assert.ok(
  servedAtMount.some((model) => model.id === 'cached-brand-new'),
  'a mount serves the models the last live read learned, before the endpoint answers',
)
const seededModel = await calls.adapters[0].adapter.resolveModel('opencode-go-renamed', 'cached-brand-new')
assert.equal(seededModel.context.contextWindow, 200000, 'a seeded model keeps the facts the cache recorded')
assert.ok(seededModel.inputModalities.join('+') === 'text+image', 'a seeded model keeps its modalities')
console.log('ok   a (re)mount serves the models the last live read learned')

// The settings card lists one row per served model with the facts the request
// would use, so the discovery reply has to carry capacities and modalities — an
// id alone would leave every row blank.
const discovered = await calls.discoverers[0]({ provider: 'opencode-go-renamed' })
const override = discovered.find((model) => model.id === 'extra-model')
assert.equal(override?.contextWindow, 262144, 'the discovery reply carries the configured context window')
assert.ok(
  Array.isArray(override?.inputModalities) && override.inputModalities.includes('text'),
  'the discovery reply carries the modalities the model accepts',
)
assert.ok(
  discovered.some((model) => model.id !== 'extra-model' && typeof model.contextWindow === 'number'),
  'the reply describes the catalog models, not only the configured ones',
)
console.log('ok   model discovery answers with each model\'s effective facts')

// On 0.1.7 the settings service serves a namespace only for a schema with at
// least one volatile node — with none there is no namespace, `configForms.get`
// reports it unavailable, and the card renders nothing at all. This is the
// failure that made the card disappear, so pin every field the card touches.
const schema = Config.toJSON()
const root = schema.refs[String(schema.uid)]
const volatileOf = (field) => schema.refs[String(root.dict[field])]?.meta?.volatile === true
for (const field of ['apiRoot', 'refreshIntervalMs', 'models', 'refreshEpoch', 'apiKeyEnv', 'displayName']) {
  assert.ok(volatileOf(field), `${field} is volatile, so the namespace exists and the card can read it`)
}
console.log('ok   the fields the card edits are volatile, so the settings namespace exists')
assert.ok(
  volatileOf('providerId') === false,
  'the route id stays ordinary configuration, so changing it remounts the entry',
)
console.log('ok   the route id stays ordinary configuration, so changing it remounts the entry')

// A volatile write commits in place and raises `loader/volatile-update`; the
// derived catalog, refresher, and cached provider must be rebuilt from it.
const listener = calls.listeners.get('loader/volatile-update')
assert.equal(typeof listener, 'function', 'subscribes to the in-place configuration update')
const before = calls.adapters.length
holder.models = [{ id: 'after-volatile', api: 'openai-completions' }]
listener()
assert.ok(calls.adapters.length > before, 'an in-place update re-announces the route')
const afterModels = await calls.adapters.at(-1).adapter.listModels('opencode-go-renamed')
assert.ok(
  afterModels.some((model) => model.id === 'after-volatile'),
  'the rebuilt catalog carries the in-place model change',
)
console.log('ok   an in-place configuration update rebuilds the catalog and re-announces the route')

// Disabling one model: the route stops offering it — which is what the picker
// reads — a request naming it says why, and the settings surface can still
// describe the row the user switched off.
const offered = await calls.adapters.at(-1).adapter.listModels('opencode-go-renamed')
const victim = offered.find((model) => model.id !== 'after-volatile')
holder.models = [{ id: victim.id, disabled: true }]
listener()
const stillOffered = await calls.adapters.at(-1).adapter.listModels('opencode-go-renamed')
assert.ok(
  !stillOffered.some((model) => model.id === victim.id),
  'a disabled model is no longer offered by the route',
)
assert.throws(
  () => calls.adapters.at(-1).adapter.resolveModel('opencode-go-renamed', victim.id),
  (error) => error?.code === 'UNKNOWN_MODEL' && /disabled/.test(String(error.message)),
  'a request naming a disabled model explains that it is disabled',
)
console.log('ok   a disabled model leaves the route and says so when named')

const reported = await calls.discoverers[0]({ provider: 'opencode-go-renamed' })
assert.ok(
  reported.some((model) => model.id === victim.id),
  'the settings card can still describe a disabled model',
)
console.log('ok   a disabled model stays described for the settings card')

// A plain object is still accepted — a direct `apply` call, an older loader, or
// this test's own predecessor — and must resolve the same fields.
const plain = createContext()
apply(plain.ctx, {
  providerId: 'opencode-go-plain',
  displayName: 'Go Plain',
  apiRoot: 'http://127.0.0.1:1',
  refreshOnMount: false,
  refreshIntervalMs: 0,
  catalogCacheFile: join(cacheDir, 'plain.json'),
})
assertEqual(plain.calls.adapters[0].providers, ['opencode-go-plain'], 'a plain config object resolves the same fields')

// ── plan usage: the one credential-bearing read is made host-side ───────────
// The page never holds the API key, so the card reads this process's answer over
// the authenticated API channel. What matters is that the route exists, that it
// resolves the live credential, asks the endpoint the adapter's own root names,
// and never echoes the key back in a reply.
const usageSeen = []
let usageReply = {
  status: 200,
  body: JSON.stringify({
    usage: {
      rolling: { status: 'ok', percent: 0, resetsAt: '2026-09-27T16:14:53.496Z' },
      weekly: { status: 'ok', percent: 40, resetsAt: '2026-09-28T00:00:00.000Z' },
      monthly: { status: 'ok', percent: 59, resetsAt: '2026-10-12T12:22:06.000Z' },
    },
  }),
}
const usageServer = createServer((req, res) => {
  usageSeen.push({ url: req.url, headers: req.headers })
  res.writeHead(usageReply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(usageReply.body)
})
await new Promise((resolve) => usageServer.listen(0, '127.0.0.1', resolve))
holder.apiRoot = `http://127.0.0.1:${usageServer.address().port}`

const usageRoute = calls.routes.find((route) => route.path === USAGE_ROUTE)
assert.ok(usageRoute !== undefined, 'registers the plan-usage route on the authenticated API channel')
assert.deepEqual(usageRoute.methods, ['GET'], 'the plan-usage route answers GET')
assert.equal(usageRoute.requestBody, 'buffered', 'the read needs no streaming request body')
console.log('ok   registers the plan-usage route on the authenticated API channel')

const ask = () => usageRoute.fetch(new Request(`http://127.0.0.1${USAGE_ROUTE}`))
const answered = await ask()
assert.equal(answered.status, 200, 'the route answers a readable plan with 200')
const plan = await answered.json()
assert.deepEqual(
  plan.windows.map((window) => [window.key, window.percent]),
  [
    ['rolling', 0],
    ['weekly', 40],
    ['monthly', 59],
  ],
  'the route republishes the endpoint’s own windows',
)
assert.equal(usageSeen[0].url, '/v1/usage', 'the route asks the API root’s /v1/usage path')
assert.equal(usageSeen[0].headers.authorization, 'Bearer test-key', 'the route authenticates with the resolved credential')
assert.ok(
  String(usageSeen[0].headers['user-agent'] ?? '').startsWith('deepseek-harness/'),
  'the read identifies the client the way Go asks it to',
)
console.log('ok   the route reads the endpoint with the resolved credential')

// No key is not a provider failure: the card says a key is what it waits for.
credentials.value = undefined
const keyless = await ask()
assert.equal(keyless.status, 400, 'a keyless deployment is told to configure a key, not blamed on the provider')
assert.equal((await keyless.json()).error.code, 'missing-key', 'the keyless answer is classified for the card')
console.log('ok   a keyless deployment is told to configure a key')

// A rejected key keeps its own identity all the way to the card…
credentials.value = 'test-key'
usageReply = { status: 401, body: JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Unauthorized' } }) }
const rejected = await ask()
assert.equal(rejected.status, 401, 'a rejected key keeps the endpoint’s status')
const refusal = await rejected.json()
assert.equal(refusal.error.code, 'unauthorized', 'a rejected key is classified as the key’s problem')
assert.ok(!JSON.stringify(refusal).includes('test-key'), 'no reply ever carries the credential')
console.log('ok   a rejected key is classified, and no reply carries the credential')

usageServer.close()
console.log('HOST SMOKE OK')
