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
let registration
const sandbox = {
  window: { __ModuleLoader__: { load: (value) => (registration = value) } },
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
for (const service of ['slots', 'locale', 'remote', 'settingsScope']) {
  assert.ok(module.inject.includes(service), `inject declares ${service}`)
}

// ── the host services the card consumes, recorded as it uses them ────────────
const calls = { credentialSet: [], credentialUnset: [], credentialDescribe: [], mutations: [], writes: [], discovery: [], registered: [] }
let state = {
  apiRoot: 'https://opencode.ai/zen/go',
  apiKeyEnv: 'OPENCODE_GO_API_KEY',
  refreshIntervalMs: 21600000,
  refreshEpoch: 0,
  models: [],
}
const base = { apiRoot: 'https://opencode.ai/zen/go', refreshIntervalMs: 21600000, models: [], apiKeyEnv: 'OPENCODE_GO_API_KEY', refreshEpoch: 0 }
let snapshot = { status: 'ready', writable: true, user: null, base, value: state, mode: 'host', revision: 1 }
const scope = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  set: async (field, value) => calls.writes.push({ op: 'set', field, value }),
  unset: async (field) => calls.writes.push({ op: 'unset', field }),
  mutate: async (ops) => calls.mutations.push(plain(ops)),
}
const advertised = [{ id: 'glm-5.3' }, { id: 'minimax-m3' }, { id: 'grok-4.6' }]
const ctx = {
  effect: (factory) => {
    const disposer = factory()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  inject: (names, callback) => callback(ctx),
  locale: { register: () => {}, bind: () => (key) => key },
  settingsScope: { bind: () => scope },
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

const card = calls.registered.find((entry) => entry.name === 'settings.plugin.item')
assert.ok(card !== undefined, 'registers into settings.plugin.item')
assert.equal(card.result.options.key, NS, 'keyed by the provider settings namespace')
assert.equal(card.result.options.locale, NS, 'ships its own locale namespace')

const injected = card.result.options.inject()
assert.equal(injected.scope, scope)
assert.equal(typeof injected.credentials.set, 'function', 'injects the credential store the plugin built')

/** The card's copy, with the placeholders these assertions read. */
const copy = {
  keyRef: 'Read from {ref}',
  catalogLocal: '{count} models in the live catalog.',
  catalogLive: '{count} models advertised by the endpoint.',
  failed: 'Failed: {message}',
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

render()
await flush()
let tree = render()

// ── the chrome: collapsed header, like the shipped plugin cards ──────────────
assert.equal(tree.type, 'li', 'renders a list item inside the cards list')
assert.equal(tree.props.className, 'ogcCard', 'starts collapsed')
const header = findAll(tree, (element) => element.props?.className === 'ogcHeader')[0]
assert.ok(header !== undefined, 'renders the header button')
assert.equal(header.props['aria-expanded'], false)
assert.deepEqual(texts(header), ['title', 'description'], 'the collapsed header names the plugin')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcBody').length, 0, 'no body while collapsed')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcPending').length, 0, 'clean card shows no unsaved tag')

// ── opening reveals the fields, and the mount reads already happened ─────────
header.props.onClick()
tree = render()
assert.equal(tree.props.className, 'ogcCard ogcCardOpen', 'header click opens the card')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcBody').length, 1)
const open = texts(tree)
for (const key of ['keyLabel', 'endpointLabel', 'intervalLabel', 'catalogTitle', 'modelsTitle']) {
  assert.ok(open.includes(key), `open card renders ${key}`)
}
assert.ok(open.includes('3 models in the live catalog.'), 'card reports the local catalog size')
assert.deepEqual(
  plain(calls.discovery[0]),
  { namespace: NS, request: { provider: 'opencode-go' } },
  'reads the local catalog on mount without hitting the endpoint',
)
assert.deepEqual(calls.credentialDescribe[0], ['OPENCODE_GO_API_KEY'], 'describes the credential on mount')

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

// ── the model editor: protocol, capacities, reasoning, and allowed input ────
byText(tree, 'addModel').props.onClick()
tree = render()
const idInput = findAll(tree, (element) => element.type === 'input' && element.props.type === 'text' && element.props.className === 'ogcInput' && element.props.value === '')[0]
assert.ok(idInput !== undefined, 'editor renders an empty model id input')
idInput.props.onChange({ target: { value: 'glm-5.3-extra' } })
tree = render()
const contextInput = findAll(tree, (element) => element.type === 'input' && element.props.placeholder === 'capacityHint')[0]
contextInput.props.onChange({ target: { value: '256K' } })
tree = render()
const checkboxes = findAll(tree, (element) => element.type === 'input' && element.props.type === 'checkbox')
assert.equal(checkboxes.length, 3, 'editor renders reasoning plus the two modalities')
/** Toggle the checkbox whose label text is `label`. */
const toggle = (label) => {
  const boxes = findAll(tree, (element) => element.type === 'input' && element.props.type === 'checkbox')
  const labels = findAll(tree, (element) => element.props?.className === 'ogcCheck')
  const at = labels.findIndex((element) => texts(element).includes(label))
  assert.ok(at >= 0, `editor offers a ${label} checkbox`)
  boxes[at].props.onChange({ target: { checked: true } })
  tree = render()
}
toggle('reasoningHint')
toggle('inputImage')
byText(tree, 'applyModel').props.onClick()
tree = render()
assert.ok(
  findAll(tree, (element) => element.props?.className === 'ogcItem').length === 1,
  'the applied model joins the staged list',
)

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
      {
        id: 'glm-5.3-extra',
        api: 'openai-completions',
        contextWindow: 262144,
        reasoning: true,
        input: ['text', 'image'],
      },
    ],
  },
  { op: 'set', path: ['apiRoot'], value: 'https://example.test/go' },
], 'save emits the staged model override, its reasoning and allowed input, and the endpoint')

// The host answers: the stored section now carries what was saved.
state = {
  ...state,
  apiRoot: 'https://example.test/go',
  models: [{ id: 'glm-5.3-extra', api: 'openai-completions', contextWindow: 262144, reasoning: true, input: ['text', 'image'] }],
}
snapshot = { ...snapshot, value: state, user: { apiRoot: 'https://example.test/go', models: state.models }, revision: 2 }
tree = render()
assert.equal(tree.props.className, 'ogcCard', 'a successful save collapses the card')
assert.equal(findAll(tree, (element) => element.props?.className === 'ogcPending').length, 0, 'a saved card is clean')

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
assert.deepEqual(
  plain(calls.discovery.at(-1).request),
  { provider: 'opencode-go', baseURL: 'https://example.test/go' },
  'endpoint query names the configured base URL',
)
tree = openCard()
byText(tree, 'showIds').props.onClick()
tree = render()
const chips = findAll(tree, (element) => element.props?.className === 'ogcChip')
assert.deepEqual(chips.map((chip) => texts(chip)[0]), ['glm-5.3', 'minimax-m3', 'grok-4.6'])

// ── a host without the trigger field offers no refresh that cannot work ─────
delete state.refreshEpoch
delete base.refreshEpoch
snapshot = { ...snapshot, value: { ...state }, base: { ...base } }
tree = openCard()
const oldRefresh = byText(tree, 'refreshNow')
assert.equal(oldRefresh.props.disabled, true, 'refresh is disabled when the host has no trigger field')
assert.ok(texts(tree).includes('refreshRestart'), 'card explains the restart instead of failing the write')

// ── an unserved namespace renders nothing at all ───────────────────────────
snapshot = { ...snapshot, status: 'unavailable', value: undefined }
assert.equal(render(), null, 'an unavailable namespace renders no card')

console.log('card smoke: PASS')
