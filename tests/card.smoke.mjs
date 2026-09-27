/**
 * Card smoke test: loads the real browser bundle under a stubbed module system
 * and a stub React, mounts it against stub services, and drives the interactions
 * that matter — open the collapsed card, stage a key and a model override with
 * its reasoning and allowed input, save once, and check the calls that reach the
 * wire.
 *
 * It cannot prove the browser paints the card (React comes from the shell's
 * static module table), but it executes every line of the plugin body and of
 * each render branch, which is what catches reference errors, hook misuse, a
 * wrong registration shape, or a write that fires when the user did not save.
 *
 * Run: node test/card.smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const ID = 'dsh-llm-opencode-go'
const NS = 'llm-opencode-go'

/** A React stand-in with the hooks this card uses. */
function createReact() {
  const hooks = { slots: [], effects: [], index: 0 }
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }) },
  })
  const slot = (init) => {
    const at = hooks.index++
    if (!(at in hooks.slots)) hooks.slots[at] = typeof init === 'function' ? init() : init
    return at
  }
  return {
    createElement,
    useState(init) {
      const at = slot(init)
      return [
        hooks.slots[at],
        (next) => {
          hooks.slots[at] = typeof next === 'function' ? next(hooks.slots[at]) : next
        },
      ]
    },
    useEffect(effect) {
      const at = slot(undefined)
      hooks.effects.push(effect)
      return at
    },
    useRef(init) {
      const at = slot({ current: init })
      return hooks.slots[at]
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      // Real React re-reads the snapshot on every render, so the slot holds the
      // latest read rather than the first one.
      const at = hooks.index++
      hooks.slots[at] = getSnapshot()
      return hooks.slots[at]
    },
    useMemo(factory) {
      slot(undefined)
      return factory()
    },
    useCallback(fn) {
      slot(undefined)
      return fn
    },
    /** Render once and run the effects that render queued. */
    render(component, props) {
      hooks.index = 0
      hooks.effects = []
      const tree = component(props)
      for (const effect of hooks.effects) effect()
      return tree
    },
  }
}

/**
 * Copy one value into this realm's plain objects. The plugin runs inside a vm
 * context, so its objects carry that context's prototypes and fail the strict
 * deep comparisons below for reasons that have nothing to do with the card.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Every string in one element tree, depth first. */
function texts(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out)
    return out
  }
  texts(node.props?.children, out)
  return out
}

/** Every element in one tree that satisfies the predicate. */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findAll(node.props?.children, predicate, out)
  return out
}

/** The first element whose rendered text is exactly `label`. */
function byText(tree, label, kind) {
  return findAll(tree, (element) => element.type === (kind ?? 'button') && texts(element).length === 1 && texts(element)[0] === label)[0]
}

// ── load the bundle exactly as the browser module system does ────────────────
/** Where the card's plan-usage read went, and what the route answers next. */
const usageCalls = []
const futureIso = (milliseconds) => new Date(Date.now() + milliseconds).toISOString()
let usageReply = {
  status: 200,
  body: {
    windows: [
      { key: 'rolling', status: 'ok', percent: 0, resetsAt: futureIso(4 * 3600000 + 51 * 60000) },
      { key: 'weekly', status: 'ok', percent: 40, resetsAt: futureIso(3 * 86400000 + 12 * 3600000) },
      { key: 'monthly', status: 'ok', percent: 59, resetsAt: futureIso(15 * 86400000) },
    ],
    fetchedAt: new Date().toISOString(),
  },
}
/**
 * The plan-usage route as the page sees it. The body is either the host's own
 * `{ windows }` reply or a raw string, which stands for a deployment whose host
 * half predates the route and answers the page shell instead of JSON.
 */
const fetchUsage = async (url, options) => {
  usageCalls.push({ url, options })
  const reply = usageReply
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    async json() {
      if (typeof reply.body === 'string') throw new SyntaxError('Unexpected token <')
      return reply.body
    },
  }
}

let registration
const sandbox = {
  window: { __ModuleLoader__: { load: (value) => (registration = value) } },
  fetch: fetchUsage,
  document: {
    head: { appendChild() {} },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  },
}
vm.createContext(sandbox)
vm.runInContext(readFileSync(CLIENT_PATH, 'utf8'), sandbox, { filename: CLIENT_PATH })
assert.equal(registration.id, ID, 'bundle registers under its package name')

const React = createReact()
const loaded = []
const module = registration.factory((specifier) => {
  loaded.push(specifier)
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      // The card must survive a shell that exports the primitives…
      IconChevronDownOutline14: (props) => React.createElement('svg', props),
      Tag: (props) => React.createElement('span', props, props.children),
    }
  }
  throw new Error(`unexpected require("${specifier}")`)
})
assert.deepEqual(loaded, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
assert.equal(typeof module.apply, 'function', 'exports apply')
for (const service of ['slots', 'locale', 'remote', 'configForms']) {
  assert.ok(module.inject.includes(service), `inject declares ${service}`)
}

// ── the host services the card consumes, recorded as it uses them ────────────
const calls = { credentialSet: [], credentialUnset: [], credentialDescribe: [], mutations: [], writes: [], discovery: [], registered: [] }
let state = {
  displayName: 'OpenCode Go',
  apiRoot: 'https://opencode.ai/zen/go',
  apiKeyEnv: 'OPENCODE_GO_API_KEY',
  refreshIntervalMs: 21600000,
  refreshEpoch: 0,
  models: [],
}
const base = { displayName: 'OpenCode Go', apiRoot: 'https://opencode.ai/zen/go', refreshIntervalMs: 21600000, models: [], apiKeyEnv: 'OPENCODE_GO_API_KEY', refreshEpoch: 0 }
let snapshot = { status: 'ready', writable: true, user: null, base, value: state, mode: 'host', revision: 1 }
const scope = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  set: async (field, value) => calls.writes.push({ op: 'set', field, value }),
  unset: async (field) => calls.writes.push({ op: 'unset', field }),
  mutate: async (ops) => calls.mutations.push(plain(ops)),
}
// What the host's model discovery answers: the effective catalog, facts included.
const advertised = [
  { id: 'glm-5.3', name: 'GLM 5.3', contextWindow: 1000000, maxTokens: 32768, inputModalities: ['text', 'image'] },
  { id: 'minimax-m3', name: 'MiniMax M3', contextWindow: 1048576, maxTokens: 65536, inputModalities: ['text'] },
  { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 131072, maxTokens: 16384, inputModalities: ['text'] },
]
const ctx = {
  effect: (factory) => {
    const disposer = factory()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  inject: (names, callback) => callback(ctx),
  locale: { register: () => {}, bind: () => (key) => key },
  configForms: { get: () => scope },
  remote: {
    $on: () => () => {},
    credentials: {
      describe: async (refs) => {
        calls.credentialDescribe.push([...refs])
        return {
          ok: true,
          value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, source: 'file', writable: true }])),
        }
      },
      set: async (ref, value) => {
        calls.credentialSet.push({ ref, value })
        return { ok: true }
      },
      unset: async (ref) => {
        calls.credentialUnset.push({ ref })
        return { ok: true }
      },
    },
    llm: {
      discoverModels: async (namespace, request) => {
        calls.discovery.push({ namespace, request })
        return { ok: true, value: advertised }
      },
    },
  },
  slots: {
    inject: (name, register) => {
      const result = register()
      calls.registered.push({ name, result })
    },
    register: (options, component) => ({ options, component }),
  },
}
module.apply(ctx)

const card = calls.registered.find((entry) => entry.name === 'settings.models.footer')
assert.ok(card !== undefined, 'registers into settings.models.footer')
assert.equal(card.result.options.id, NS, 'the footer entry carries this plugin id')
assert.equal(card.result.options.locale, NS, 'ships its own locale namespace')

const injected = card.result.options.inject()
assert.equal(injected.scope, scope)
assert.equal(typeof injected.credentials.set, 'function', 'injects the credential store the plugin built')

/** The card's copy, with the placeholders these assertions read. */
const copy = {
  keyRef: 'Read from {ref}',
  modelsMeta: '{count} models',
  modelsMetaOverrides: '{count} overridden',
  modelsMetaDisabled: '{count} disabled',
  catalogSourceLocal: 'live catalog',
  catalogSourceEndpoint: 'endpoint',
  factsContext: 'ctx',
  factsOutput: 'out',
  factsBoth: 'text + images',
  factsText: 'text',
  failed: 'Failed: {message}',
  usageTitle: 'Plan usage',
  usageHint: 'Go meters a subscription in three windows.',
  usageLoading: 'Reading plan usage…',
  usageRetry: 'Refresh plan usage',
  usageRefreshing: 'Refreshing plan usage…',
  usageUpdated: 'Updated {time}',
  usageMissingKey: 'Add an API key to read plan usage.',
  usageUnavailable: 'This deployment does not serve the plan-usage route.',
  usageFailed: 'Could not read plan usage: {message}',
  usageUsed: '{percent}% used',
  usageWindowRolling: '5-hour window',
  usageWindowWeekly: 'Weekly',
  usageWindowMonthly: 'Monthly',
  usageResets: 'resets in {when}',
  usageResetsNow: 'resetting now',
  usageDays: '{count}d',
  usageHours: '{count}h',
  usageMinutes: '{count}m',
  usageLimited: 'Limited',
}
const t = (key) => copy[key] ?? key
const render = () => React.render(card.result.component, { ...injected, t })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
/**
 * Render and make sure the card is open, clicking the *current* header. A saved
 * card collapses, and a handler captured from an older render closes over the
 * open state of that render.
 */
const openCard = () => {
  let tree = render()
  if (tree.props.className !== 'ogcCard ogcCardOpen') {
    findAll(tree, (element) => element.props?.className === 'ogcHeader')[0].props.onClick()
    tree = render()
  }
  return tree
}

/** The header button of one rendered tree. */
function headerOf(node) {
  return findAll(node, (element) => element.props?.className === 'ogcHeader')[0]
}

render()
await flush()
let tree = render()

// ── the chrome: a page-level card in the Models footer ──────────────────────
assert.equal(tree.type, 'div', 'renders a block, not a list item')
assert.equal(tree.props.className, 'ogcCard', 'starts collapsed')
const header = headerOf(tree)
assert.ok(header !== undefined, 'renders the header button')
assert.equal(header.props['aria-expanded'], false)
assert.deepEqual(
  texts(header).slice(0, 2),
  ['OpenCode Go', 'description'],
  'titles the card with the configured display name',
)
assert.deepEqual(
  texts(header).slice(2),
  ['Monthly 59%'],
  'the closed card names the most-used window, so the plan is readable without expanding',
)
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcBody').length, 0, 'no body while collapsed')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcPending').length, 0, 'clean card shows no unsaved tag')

// A deployment that renames the provider is what the heading follows; with no
// name in the section the shipped copy is the fallback.
snapshot = { ...snapshot, value: { ...state, displayName: '' } }
assert.deepEqual(
  texts(headerOf(render())).slice(0, 2),
  ['title', 'description'],
  'falls back to the shipped name',
)
snapshot = { ...snapshot, value: state }
tree = render()

// ── opening reveals the fields, and the mount reads already happened ─────────
header.props.onClick()
tree = render()
assert.equal(tree.props.className, 'ogcCard ogcCardOpen', 'header click opens the card')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcBody').length, 1)
const open = texts(tree)
for (const key of ['keyLabel', 'endpointLabel', 'intervalLabel', 'modelsTitle']) {
  assert.ok(open.includes(key), `open card renders ${key}`)
}
assert.ok(open.includes('Plan usage'), 'the open card renders the usage panel')
assert.ok(open.includes('3 models · live catalog'), 'the count line reports the list and its source')
assert.deepEqual(
  plain(calls.discovery[0]),
  { namespace: NS, request: { provider: 'opencode-go' } },
  'reads the local catalog on mount without hitting the endpoint',
)
assert.deepEqual(calls.credentialDescribe[0], ['OPENCODE_GO_API_KEY'], 'describes the credential on mount')

// ── plan usage: one read of the host route, drawn as three metered windows ──
assert.equal(usageCalls[0]?.url, '/api/opencode-go/usage', 'the card reads the host’s own plan-usage route')
assert.deepEqual(
  plain(usageCalls[0]?.options),
  { headers: { accept: 'application/json' } },
  'the page asks for JSON and carries no credential of its own',
)
assert.ok(open.includes('5-hour window'), 'a window names the rolling 5-hour limit')
assert.ok(open.includes('Weekly') && open.includes('Monthly'), 'the weekly and monthly windows are drawn too')
assert.ok(
  open.includes('0% used') && open.includes('40% used') && open.includes('59% used'),
  'each window states the share of its own allowance that is used',
)
assert.ok(open.includes('resets in 4h 51m'), 'a window says when it resets, in the units the copy orders')
assert.ok(open.includes('resets in 3d 12h'), 'a multi-day reset reads as days and hours')
assert.ok(open.includes('resets in 15d'), 'a whole-day reset keeps its days and drops the zero hours')
const bars = findAll(tree, (element) => element.props?.className === 'ogcBar')
assert.equal(bars.length, 3, 'one bar per metered window')
assert.deepEqual(
  bars.map((bar) => bar.props['aria-valuenow']),
  [0, 40, 59],
  'a bar exposes to assistive tech the same share it draws',
)
const fills = findAll(
  tree,
  (element) => typeof element.props?.className === 'string' && element.props.className.startsWith('ogcBarFill'),
)
assert.deepEqual(
  plain(fills.map((fill) => [fill.props.className, fill.props.style])),
  [
    ['ogcBarFill', { width: '0%' }],
    ['ogcBarFill', { width: '40%' }],
    ['ogcBarFill', { width: '59%' }],
  ],
  'a window below the warning line keeps the brand fill, at the width of its share',
)

// A nearly spent window is colored as one, and the header keeps naming it.
usageReply = {
  status: 200,
  body: {
    windows: [
      { key: 'rolling', status: 'ok', percent: 12, resetsAt: futureIso(3600000) },
      { key: 'weekly', status: 'ok', percent: 92, resetsAt: futureIso(86400000) },
      { key: 'monthly', status: 'limit_reached', percent: 100, resetsAt: futureIso(86400000) },
    ],
    fetchedAt: new Date().toISOString(),
  },
}
render()
await flush()
tree = render()
assert.deepEqual(
  plain(
    findAll(tree, (element) =>
      typeof element.props?.className === 'string' && element.props.className.startsWith('ogcBarFill'),
    ).map((fill) => fill.props.className),
  ),
  ['ogcBarFill', 'ogcBarFill ogcBarWarn', 'ogcBarFill ogcBarFull'],
  'a nearly spent window warns, and a spent one is an error rather than more brand color',
)
assert.ok(texts(tree).includes('Limited'), 'a window the endpoint reports as not ok says so')
assert.deepEqual(
  texts(headerOf(tree)).slice(2),
  ['Monthly 100%'],
  'the header names the most-used window, at its limit',
)

// ── what the panel says when there is no plan to draw ──────────────────────
usageReply = { status: 200, body: '<!doctype html><html><body>shell</body></html>' }
render()
await flush()
tree = render()
assert.ok(
  texts(tree).includes('This deployment does not serve the plan-usage route.'),
  'a host half without the route is named as such, not blamed on the provider',
)
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcBar').length, 0, 'no bar is drawn from a reply that carried none')
assert.ok(byText(tree, 'Refresh plan usage') !== undefined, 'a failed read still offers a retry')
assert.deepEqual(texts(headerOf(tree)).slice(2), [], 'the header stops naming a window it can no longer vouch for')

usageReply = {
  status: 502,
  body: { error: { code: 'endpoint', message: 'http://127.0.0.1:1/v1/usage answered HTTP 404' } },
}
render()
await flush()
tree = render()
assert.ok(
  texts(tree).includes('Could not read plan usage: http://127.0.0.1:1/v1/usage answered HTTP 404'),
  'a provider failure keeps the host’s message, address included',
)

usageReply = { status: 400, body: { error: { code: 'missing-key', message: 'No API key is configured for OPENCODE_GO_API_KEY.' } } }
render()
await flush()
tree = render()
assert.ok(
  texts(tree).includes('Add an API key to read plan usage.'),
  'a keyless deployment points at the field below instead of showing an error',
)
assert.equal(byText(tree, 'Refresh plan usage'), undefined, 'a keyless panel offers no retry that could not work')
assert.equal(calls.mutations.length, 0, 'reading the plan never writes a setting')

usageReply = {
  status: 200,
  body: {
    windows: [
      { key: 'rolling', status: 'ok', percent: 0, resetsAt: futureIso(4 * 3600000 + 51 * 60000) },
      { key: 'weekly', status: 'ok', percent: 40, resetsAt: futureIso(3 * 86400000 + 12 * 3600000) },
      { key: 'monthly', status: 'ok', percent: 59, resetsAt: futureIso(15 * 86400000) },
    ],
    fetchedAt: new Date().toISOString(),
  },
}
render()
await flush()
tree = render()
assert.deepEqual(texts(headerOf(tree)).slice(2), ['Monthly 59%'], 'the retry brings the plan back to the header')

// ── staging: nothing is written until Save ──────────────────────────────────
const keyInput = findAll(tree, (element) => element.props?.type === 'password')[0]
assert.ok(keyInput !== undefined, 'card renders the key input')
keyInput.props.onChange({ target: { value: 'sk-test-value' } })
tree = render()
const endpointInput = findAll(tree, (element) => element.props?.['aria-label'] === 'endpointLabel')[0]
assert.ok(endpointInput !== undefined, 'card renders the endpoint input')
endpointInput.props.onChange({ target: { value: 'https://example.test/go' } })
tree = render()
assert.equal(calls.mutations.length + calls.writes.length + calls.credentialSet.length, 0, 'staged edits write nothing')
assert.ok(texts(tree).includes('unsaved'), 'staging marks the card unsaved')

// ── the model list: one row per served model, with its effective facts ──────
/** Every model row. A disabled row carries the mark as a second class. */
const rows = () =>
  findAll(
    tree,
    (element) =>
      typeof element.props?.className === 'string' &&
      element.props.className.split(' ').includes('ogcItem'),
  )
assert.equal(rows().length, 3, 'the list has a row for every advertised model')
assert.ok(
  texts(rows()[0]).includes('GLM 5.3') && texts(rows()[0]).includes('1M ctx'),
  'a row names the model and the context window the request would use',
)
assert.ok(
  texts(rows()[0]).includes('text + images'),
  'a row states the modalities the catalog advertises',
)
assert.ok(!texts(tree).includes('overrideTag'), 'nothing is overridden before the user edits')

/** The row whose id is `id`. */
const rowOf = (id) => rows().find((row) => texts(row).includes(id))
/** Click the button labelled `label` inside one row. */
const clickIn = (row, label) => {
  const button = findAll(row, (element) => element.type === 'button' && texts(element).includes(label))[0]
  assert.ok(button !== undefined, `row offers ${label}`)
  button.props.onClick()
  tree = render()
}

// ── the filter narrows the list to what it matches ──────────────────────────
const filterInput = findAll(
  tree,
  (element) => element.props?.['aria-label'] === 'filterModels',
)[0]
assert.ok(filterInput !== undefined, 'the list carries a filter box')
filterInput.props.onChange({ target: { value: 'glm' } })
tree = render()
assert.equal(rows().length, 1, 'the filter narrows the list by id or name')
assert.ok(texts(rows()[0]).includes('glm-5.3'), 'the row left is the one that matched')
filterInput.props.onChange({ target: { value: 'nothing-like-this' } })
tree = render()
assert.ok(texts(tree).includes('modelsNoMatch'), 'an unmatched filter says so instead of showing nothing')
filterInput.props.onChange({ target: { value: '' } })
tree = render()
assert.equal(rows().length, 3, 'clearing the filter restores the list')

// ── editing one model states only what changed ──────────────────────────────
clickIn(rowOf('glm-5.3'), 'editModel')
const inheritOptions = () =>
  findAll(tree, (element) => element.type === 'option' && texts(element)[0] === 'inheritApi')
assert.equal(inheritOptions().length, 1, 'the protocol may be left to the catalog')
const contextPlaceholder = findAll(
  tree,
  (element) => element.type === 'input' && element.props['aria-label'] === 'contextLabel',
)[0]
assert.equal(contextPlaceholder.props.placeholder, '1000000', 'the editor shows the inherited capacity as its placeholder')
contextPlaceholder.props.onChange({ target: { value: '256K' } })
tree = render()
const reasoningSelect = findAll(
  tree,
  (element) => element.type === 'select' && element.props['aria-label'] === 'reasoningLabel',
)[0]
assert.equal(reasoningSelect.props.value, 'inherit', 'reasoning starts out inherited')
reasoningSelect.props.onChange({ target: { value: 'off' } })
tree = render()
const inputSelect = findAll(
  tree,
  (element) => element.type === 'select' && element.props['aria-label'] === 'inputLabel',
)[0]
inputSelect.props.onChange({ target: { value: 'both' } })
tree = render()
byText(tree, 'applyModel').props.onClick()
tree = render()
assert.ok(texts(rowOf('glm-5.3')).includes('overrideTag'), 'an edited model is marked as an override')
assert.ok(
  texts(rowOf('glm-5.3')).includes('256K ctx'),
  'the row shows the override where it states a value, not the catalog value it replaces',
)
assert.equal(rows().length, 3, 'editing a model does not add a row')

// ── an unparseable capacity is reported, and an override can be removed ─────
clickIn(rowOf('minimax-m3'), 'editModel')
const capacityInput = findAll(
  tree,
  (element) => element.type === 'input' && element.props['aria-label'] === 'contextLabel',
)[0]
capacityInput.props.onChange({ target: { value: 'lots' } })
tree = render()
byText(tree, 'applyModel').props.onClick()
tree = render()
assert.ok(texts(tree).includes('capacityInvalid'), 'an unparseable capacity is reported rather than dropped')
assert.equal(byText(tree, 'save').props.disabled, true, 'save is blocked while a capacity is invalid')
clickIn(rowOf('minimax-m3'), 'deleteModel')
assert.equal(rows().length, 3, 'removing an override leaves the model in the list')
assert.ok(!texts(rowOf('minimax-m3')).includes('overrideTag'), 'a removed override is no longer marked')

// ── adding a model the catalog does not list keeps the ID editable ──────────
byText(tree, 'addModel').props.onClick()
tree = render()
assert.equal(
  findAll(tree, (element) => element.type === 'option' && texts(element)[0] === 'inheritApi').length,
  0,
  'a model the catalog does not describe cannot inherit a protocol',
)
const idInput = findAll(
  tree,
  (element) => element.type === 'input' && element.props['aria-label'] === 'idLabel',
)[0]
assert.ok(idInput !== undefined, 'the add form renders a model ID input')
assert.equal(idInput.props.disabled, false, 'the ID of a new model stays editable')
idInput.props.onChange({ target: { value: 'glm-5.3-extra' } })
tree = render()
assert.equal(
  findAll(tree, (element) => element.type === 'input' && element.props['aria-label'] === 'idLabel')[0].props
    .disabled,
  false,
  'typing an ID does not lock the field after the first keystroke',
)
byText(tree, 'applyModel').props.onClick()
tree = render()
assert.equal(rows().length, 4, 'the added model joins the list')

// ── disabling a model keeps its row and states only the flag ────────────────
clickIn(rowOf('grok-4.6'), 'disableModel')
assert.ok(texts(rowOf('grok-4.6')).includes('disabledTag'), 'a disabled model is marked')
assert.equal(
  findAll(
    rowOf('grok-4.6'),
    (element) => element.type === 'button' && texts(element).includes('enableModel'),
  ).length,
  1,
  'a disabled model offers Enable instead',
)
assert.ok(
  texts(rowOf('grok-4.6')).includes('128K ctx'),
  'a disabled model still shows the facts it is described by',
)
assert.equal(rows().length, 4, 'a disabled model stays in the list')

// ── Save: one credentials write plus one mutation, then collapse ────────────
byText(tree, 'save').props.onClick()
await flush()
await flush()
assert.deepEqual(calls.credentialSet, [{ ref: 'OPENCODE_GO_API_KEY', value: 'sk-test-value' }], 'save stores the key')
assert.equal(calls.mutations.length, 1, 'save performs exactly one settings mutation')
assert.deepEqual(calls.mutations[0], [
  {
    op: 'set',
    path: ['models'],
    value: [
      // No `api`: the card states what it changed and leaves the installed
      // protocol, and everything else untouched, to the catalog merge.
      { id: 'glm-5.3', contextWindow: 262144, reasoning: false, input: ['text', 'image'] },
      { id: 'glm-5.3-extra', api: 'openai-completions' },
      // Nothing but the flag: switching a catalog model off must not restate
      // anything the catalog already describes.
      { id: 'grok-4.6', disabled: true },
    ],
  },
  { op: 'set', path: ['apiRoot'], value: 'https://example.test/go' },
], 'save emits the partial override, the added model, the disable, and the endpoint')

// The host answers: the stored section now carries what was saved — the partial
// override for the catalog's model, and the stated protocol of the added one.
state = {
  ...state,
  apiRoot: 'https://example.test/go',
  models: [
    { id: 'glm-5.3', contextWindow: 262144, reasoning: false, input: ['text', 'image'] },
    { id: 'glm-5.3-extra', api: 'openai-completions' },
    { id: 'grok-4.6', disabled: true },
  ],
}
snapshot = { ...snapshot, value: state, user: { apiRoot: 'https://example.test/go', models: state.models }, revision: 2 }
tree = render()
assert.equal(tree.props.className, 'ogcCard', 'a successful save collapses the card')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcPending').length, 0, 'a saved card is clean')

// ── enabling again drops an entry that carried nothing but the flag ─────────
tree = openCard()
assert.ok(texts(rowOf('grok-4.6')).includes('disabledTag'), 'the stored disable is what the card renders')
clickIn(rowOf('grok-4.6'), 'enableModel')
assert.ok(!texts(rowOf('grok-4.6')).includes('disabledTag'), 'enabling clears the mark')
assert.ok(
  !texts(rowOf('grok-4.6')).includes('overrideTag'),
  'enabling drops an entry that carried nothing but the flag',
)
assert.equal(calls.mutations.length, 1, 'enabling is staged, not written')
byText(tree, 'discard').props.onClick()
tree = render()
assert.ok(
  texts(rowOf('grok-4.6')).includes('disabledTag'),
  'discarding restores the stored state rather than the staged one',
)

// ── an overridden field offers Reset, which stages an unset ─────────────────
tree = openCard()
// The key's Remove shares the reset class, so match the field Reset by its label.
const resets = findAll(
  tree,
  (element) => element.props?.className === 'ogcReset' && texts(element).includes('reset'),
)
assert.ok(resets.length >= 2, 'overridden fields offer Reset')
assert.ok(texts(tree).includes('overridden'), 'overridden fields are marked')
resets[0].props.onClick()
tree = render()
byText(tree, 'save').props.onClick()
await flush()
await flush()
assert.deepEqual(
  plain(calls.mutations[1]),
  [{ op: 'unset', path: ['apiRoot'] }],
  'Reset stages an unset rather than writing the composition value',
)

// ── immediate actions: catalog refresh and endpoint query ──────────────────
tree = openCard()
const refresh = byText(tree, 'refreshNow')
assert.ok(refresh !== undefined, 'card renders Refresh catalog now')
assert.equal(refresh.props.disabled, false, 'refresh is enabled while the host spells refreshEpoch')
await refresh.props.onClick()
assert.equal(calls.writes.at(-1).field, 'refreshEpoch', 'refresh writes the epoch the provider watches')

tree = openCard()
const query = byText(tree, 'queryEndpoint')
await query.props.onClick()
await flush()
assert.deepEqual(
  plain(calls.discovery.at(-1).request),
  { provider: 'opencode-go', baseURL: 'https://example.test/go' },
  'endpoint query names the configured base URL',
)
tree = openCard()
assert.ok(
  texts(tree).includes('4 models · 3 overridden · 1 disabled · endpoint'),
  'the count line follows an endpoint query and reports the override and disable counts',
)
assert.equal(
  rows().length,
  4,
  'the endpoint list keeps the override the catalog does not advertise beside the models it does',
)

// ── a host without the trigger field offers no refresh that cannot work ─────
delete state.refreshEpoch
delete base.refreshEpoch
snapshot = { ...snapshot, value: { ...state }, base: { ...base } }
tree = openCard()
const oldRefresh = byText(tree, 'refreshNow')
assert.equal(oldRefresh.props.disabled, true, 'refresh is disabled when the host has no trigger field')
assert.ok(texts(tree).includes('refreshRestart'), 'card explains the restart instead of failing the write')

// ── an unserved namespace says so instead of vanishing ─────────────────────
snapshot = { ...snapshot, status: 'unavailable', value: undefined }
const missing = render()
assert.notEqual(missing, null, 'an unavailable namespace still renders, so the failure is visible')
assert.ok(
  texts(missing).includes('unavailable'),
  'an unavailable namespace explains itself instead of disappearing silently',
)

console.log('card smoke: PASS')
