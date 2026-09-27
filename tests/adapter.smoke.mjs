/**
 * End-to-end adapter test: a fake OpenCode Go endpoint proves what the wire
 * request actually carries (session headers, attribution, credential) and
 * that the pi-ai event stream becomes valid harness chunks.
 *
 * Run: node test/adapter.smoke.mjs
 */

import { createServer } from 'node:http'
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { OpenCodeGoAdapter } from '../lib/adapter.js'
import { createCatalog } from '../lib/catalog.js'
import { sessionRequestHeaders } from '../lib/index.js'

const seen = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (piece) => {
    body += piece
  })
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`)
    const common = { id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'glm-5.3' }
    chunk({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'hi ' }, finish_reason: null }] })
    chunk({ ...common, choices: [{ index: 0, delta: { content: 'there' }, finish_reason: null }] })
    chunk({
      ...common,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const apiRoot = `http://127.0.0.1:${server.address().port}`

const catalog = createCatalog({ apiRoot, providerId: 'opencode-go', models: [] })
const provider = createProvider({
  id: 'opencode-go',
  name: 'OpenCode Go',
  auth: envApiKeyAuth('OpenCode Go API key', ['OPENCODE_API_KEY']),
  models: [...catalog.models().values()],
  api: { 'openai-completions': openAICompletionsApi() },
})

const value = {
  sessionHeader: 'x-opencode-session',
  harnessSessionHeader: 'x-deepseek-harness-session-id',
  headers: { 'x-deployment': 'test' },
}
const adapter = new OpenCodeGoAdapter({
  catalog: {
    get: (id) => catalog.get(id),
    models: () => catalog.models(),
    ids: () => catalog.ids(),
    isInstalled: () => false,
  },
  displayName: 'OpenCode Go',
  apiKeyEnv: 'OPENCODE_API_KEY',
  requestImagePolicy: { maxPixels: 4194304, maxBytes: 1048576 },
  maxRequestImageBytes: 20971520,
  requestTimeoutMs: undefined,
  provider: () => provider,
  resolveApiKey: async () => 'test-key',
  resolveAttachments: () => undefined,
  processPathFromHostPath: () => undefined,
  requestHeaders: (sessionId) => sessionRequestHeaders(value, sessionId),
  onReplayDegrade: (reason) => console.log('DEGRADE', reason),
})

const assert = (condition, label) => {
  if (!condition) throw new Error(`FAIL: ${label}`)
  console.log(`ok   ${label}`)
}

assert(adapter.providerInfo('opencode-go').name === 'OpenCode Go', 'providerInfo display name')
const models = await adapter.listModels('opencode-go')
assert(models.length > 20, `listModels returns ${models.length} models`)
const resolved = await adapter.resolveModel('opencode-go', 'glm-5.3')
assert(resolved.context.contextWindow === 1000000, 'resolveModel context window')
assert(resolved.reasoning.efforts.some((effort) => effort.id === 'high'), 'resolveModel reasoning efforts')

// Configured overrides carry reasoning and allowed input, both for a model the
// pinned catalog does not know and for one it does.
const configured = createCatalog({
  apiRoot,
  providerId: 'opencode-go',
  models: [
    {
      id: 'brand-new-model',
      api: 'anthropic-messages',
      contextWindow: 262144,
      maxTokens: 65536,
      reasoning: true,
      input: ['text', 'image'],
    },
    { id: 'glm-5.3', reasoning: false, input: ['text'] },
  ],
})
const added = configured.get('brand-new-model')
assert(added !== undefined, 'a configured id outside the pinned catalog is registered')
assert(added.api === 'anthropic-messages' && added.contextWindow === 262144, 'configured protocol and window')
assert(added.input.join('+') === 'text+image', 'configured model accepts images')
assert(configured.get('glm-5.3').reasoning === false, 'an override can turn reasoning off')
assert(configured.get('glm-5.3').input.join('+') === 'text', 'an override can narrow allowed input')
assert(configured.get('glm-5.3').contextWindow === 1000000, 'an override keeps untouched installed facts')
assert(
  configured.get('glm-5.3').api === catalog.get('glm-5.3').api,
  'an override that states no protocol keeps the installed one',
)

// The settings card writes partial overrides — every field it leaves on Inherit
// is absent from the entry — so one edited capacity must not disturb a model's
// protocol, reasoning flag, or modalities.
const partial = createCatalog({
  apiRoot,
  providerId: 'opencode-go',
  models: [{ id: 'glm-5.3', contextWindow: 4242 }],
})
const merged = partial.get('glm-5.3')
const installed = catalog.get('glm-5.3')
assert(merged.contextWindow === 4242, 'a partial override states the capacity it changes')
assert(merged.api === installed.api, 'a partial override keeps the installed protocol')
assert(merged.reasoning === installed.reasoning, 'a partial override keeps the installed reasoning flag')
assert(merged.input.join('+') === installed.input.join('+'), 'a partial override keeps the installed modalities')

// Disabling takes a model out of the served catalog without losing what is known
// about it, and a later refresh must not quietly bring it back.
const off = createCatalog({
  apiRoot,
  providerId: 'opencode-go',
  models: [{ id: 'glm-5.3', disabled: true }],
})
assert(off.get('glm-5.3') === undefined, 'a disabled model is not served')
assert(!off.ids().includes('glm-5.3'), 'a disabled model is not advertised')
assert(off.isDisabled('glm-5.3') === true, 'the catalog reports why the id is missing')
assert(off.all().get('glm-5.3') !== undefined, 'a disabled model stays described')
assert(
  off.models().size === catalog.models().size - 1,
  'disabling removes that model from the served ones and nothing else',
)
assert(off.mergeRefreshed([{ id: 'glm-5.3', name: 'GLM 5.3' }]).length === 0, 'a refresh adds no disabled id')
assert(off.get('glm-5.3') === undefined, 'a disabled model stays disabled across a refresh')
const back = createCatalog({ apiRoot, providerId: 'opencode-go', models: [{ id: 'glm-5.3', disabled: false }] })
assert(back.get('glm-5.3') !== undefined, 'the same entry with the flag off serves the model again')

const chunks = []
const options = {
  provider: 'opencode-go',
  model: 'glm-5.3',
  sessionId: 'session-abc123',
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'say hi' }],
      source: { kind: 'user' },
    },
  ],
}
for await (const chunk of adapter.stream(options)) chunks.push(chunk)

const request = seen[0]
assert(seen.length === 1, 'exactly one provider request')
assert(request.url === '/v1/chat/completions', `request URL ${request.url}`)
assert(request.headers['x-opencode-session'] === 'session-abc123', 'x-opencode-session header')
assert(
  request.headers['x-deepseek-harness-session-id'] === 'session-abc123',
  'x-deepseek-harness-session-id header',
)
assert(String(request.headers['user-agent']).includes('deepseek'), `user-agent ${request.headers['user-agent']}`)
assert(request.headers['authorization'] === 'Bearer test-key', 'bearer credential')
assert(request.headers['x-deployment'] === 'test', 'deployment header')
assert(request.body.messages[0].content === 'say hi', 'user text reached the wire')
assert(request.body.stream === true, 'streaming request')

const types = chunks.map((chunk) => chunk.type)
assert(types.includes('text-delta'), `chunk stream has text deltas (${types.join(',')})`)
const finish = chunks.at(-1)
assert(finish.type === 'finish' && finish.reason.kind === 'stop', 'terminal finish is stop')
const usage = chunks.find((chunk) => chunk.type === 'usage')
assert(usage.usage.inputTokens === 10 && usage.usage.outputTokens === 2, 'usage mapping')
assert(finish.replayState?.response?.kind === 'opencode-go', 'replay envelope emitted')

// An unsupported effort must be refused before any provider I/O.
const before = seen.length
let refused = false
try {
  for await (const _chunk of adapter.stream({ ...options, reasoningEffort: 'nonsense' })) {
    /* not reached */
  }
} catch (error) {
  refused = error.code === 'UNSUPPORTED_REASONING_EFFORT'
}
assert(refused && seen.length === before, 'unsupported effort refused without I/O')

// A missing credential must be refused with MISSING_CREDENTIAL.
const noKey = new OpenCodeGoAdapter({
  ...adapter.config,
  resolveApiKey: async () => undefined,
})
let credentialFailure
try {
  for await (const _chunk of noKey.stream(options)) {
    /* not reached */
  }
} catch (error) {
  credentialFailure = error.code
}
assert(credentialFailure === 'MISSING_CREDENTIAL', `keyless request fails with ${credentialFailure}`)

// An image request must hand the attachment service a resolved pixel target.
// `readImageRequest(ref, target)` takes {width, height, maxBytes}; the route's
// pixel/byte budget is not a target, it is projected through the source size
// first. The stub below mirrors the harness's own validation so a budget-shaped
// object fails here the way it failed in production.
const imageReads = []
const fakeImages = {
  imageHostPath: () => undefined,
  async readImageRequest(ref, target) {
    for (const [name, value] of [
      ['width', target?.width],
      ['height', target?.height],
      ['maxBytes', target?.maxBytes],
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Image request ${name} must be a positive integer.`)
      }
    }
    imageReads.push({ ref, target })
    const data = new Uint8Array([1, 2, 3, 4])
    return {
      variantId: 'sha256:test',
      attachment: ref,
      data,
      mediaType: ref.mediaType,
      bytes: data.byteLength,
      width: target.width,
      height: target.height,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: false,
    }
  },
}
const imageAdapter = new OpenCodeGoAdapter({ ...adapter.config, resolveAttachments: () => fakeImages })
const imageOptions = {
  provider: 'opencode-go',
  model: 'deepseek-v4-flash-vision-exp',
  sessionId: 'session-image',
  messages: [
    {
      id: 'm-image',
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'att-1',
            mediaType: 'image/webp',
            bytes: 273152,
            width: 776,
            height: 352,
          },
        },
      ],
      source: { kind: 'user' },
    },
  ],
}
for await (const _chunk of imageAdapter.stream(imageOptions)) {
  /* drain */
}
assert(imageReads.length === 1, 'one request image read for one attachment')
assert(
  imageReads[0].target.width === 776 &&
    imageReads[0].target.height === 352 &&
    imageReads[0].target.maxBytes === 1048576,
  `image target is a resolved pixel target (${JSON.stringify(imageReads[0].target)})`,
)
assert(JSON.stringify(seen.at(-1).body).includes('base64'), 'image bytes reached the wire')

// A tool result is a first-class `tool` message whose own content is the tool's
// output. An image inside one is history the model has already been shown, so it
// replays from the tool result — failing the turn is not an option, and neither
// is attributing the output to the user.
const toolHistory = {
  provider: 'opencode-go',
  model: 'deepseek-v4-flash-vision-exp',
  sessionId: 'session-tool-image',
  messages: [
    {
      id: 'm-user',
      role: 'user',
      content: [{ type: 'text', text: 'what is in the image?' }],
      source: { kind: 'user' },
    },
    {
      id: 'm-assistant',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'call-read', name: 'read_image', arguments: '{}' }],
      source: { kind: 'model' },
    },
    {
      id: 'm-tool-image',
      role: 'tool',
      toolCallId: 'call-read',
      content: [
        { type: 'text', text: 'screenshot attached' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'att-2',
            mediaType: 'image/webp',
            bytes: 273152,
            width: 776,
            height: 352,
          },
        },
      ],
    },
    {
      id: 'm-assistant-2',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'call-shell', name: 'bash', arguments: '{}' }],
      source: { kind: 'model' },
    },
    {
      id: 'm-tool-text',
      role: 'tool',
      toolCallId: 'call-shell',
      content: [{ type: 'text', text: 'total 0' }],
    },
  ],
}
for await (const _chunk of imageAdapter.stream(toolHistory)) {
  /* drain */
}
const toolBody = seen.at(-1).body
const toolRoles = toolBody.messages.map((entry) => entry.role)
const shellResult = toolBody.messages.find(
  (entry) => entry.role === 'tool' && entry.tool_call_id === 'call-shell',
)
assert(
  shellResult !== undefined && shellResult.content === 'total 0',
  `a text tool result reaches the wire as a tool message (${toolRoles.join(',')})`,
)
assert(
  JSON.stringify(toolBody).includes('data:image/webp;base64'),
  'an in-history tool image replays instead of failing the turn',
)

// The refusals mirror `dsh-llm-pi-ai`'s own history guards, so a history this
// route accepts is a history pi-ai's conversion accepts — and one it refuses is
// refused before any provider I/O.
const refusal = async (label, base, messages, extra) => {
  const before = seen.length
  let code
  try {
    for await (const _chunk of base.stream({ ...(extra?.options ?? options), ...extra, messages })) {
      /* drain */
    }
  } catch (error) {
    code = error.code
  }
  assert(code === 'UNSUPPORTED_CONTENT' && seen.length === before, `${label} is refused with ${code}`)
}
await refusal('a developer message', adapter, [
  { id: 'd1', role: 'developer', content: [{ type: 'text', text: 'x' }], source: { kind: 'developer' } },
])
await refusal('a tool-change block', adapter, [
  {
    id: 'd2',
    role: 'user',
    content: [{ type: 'tool-addition', name: 'late-tool' }],
    source: { kind: 'user' },
  },
])
await refusal('deferred tool loading', adapter, options.messages, {
  tools: [{ name: 'late-tool', description: '', parameters: {}, deferLoading: true }],
})
await refusal(
  'an image in an assistant message',
  imageAdapter,
  [
    {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', text: 'x' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'att-3',
            mediaType: 'image/webp',
            bytes: 1024,
            width: 32,
            height: 32,
          },
        },
      ],
      source: { kind: 'model' },
    },
  ],
  { options: imageOptions },
)

server.close()
console.log('ADAPTER SMOKE OK')
