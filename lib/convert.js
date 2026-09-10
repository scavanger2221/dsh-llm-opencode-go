/**
 * Harness <-> pi-ai vocabulary conversion for the OpenCode Go adapter.
 *
 * The OpenCode Go catalog mixes three wire protocols (OpenAI Chat
 * Completions, OpenAI Responses, Anthropic Messages). pi-ai owns all three
 * translations, so this module only maps the harness's provider-neutral
 * message and chunk vocabulary onto pi-ai's `Context` and
 * `AssistantMessageEvent` protocol.
 *
 * Durable harness content is always the authoritative record. The replay
 * envelope carries only provider-native signatures (thinking signatures,
 * response ids); a later request rebuilds the assistant turn from durable
 * content plus those signatures. When the envelope cannot be matched to the
 * durable content, that one message degrades to provider-neutral history
 * instead of failing the request.
 *
 * @module dsh-llm-opencode-go/convert
 */

import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError,
  offloadRequestImagesWithPolicy,
  offloadedImageText,
  requestImageHandleText,
} from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { isContextOverflow } from '@earendil-works/pi-ai'

/** Replay envelope identity; bumped when the stored shape changes. */
const REPLAY_KIND = 'opencode-go'
const REPLAY_VERSION = 1

/** Parse tool-call argument JSON; tolerate model malformations with {}. */
function parseArguments(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed
  } catch {}
  return {}
}

/** Construct the zero usage value required by historical pi-ai messages. */
function emptyPiUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/**
 * Project a successful pi-ai response into the minimal durable replay state.
 * The per-block half is index-aligned with the streamed blocks, so the
 * assembler prunes an entry together with its block.
 * @param message - completed native pi-ai assistant response.
 * @param requestedModel - request identity recorded as the assistant source.
 * @returns the versioned lossless-JSON replay projection.
 */
function toPiReplayState(message, requestedModel = message.model) {
  const responseModel =
    message.api === 'anthropic-messages' && message.model !== requestedModel
      ? message.model
      : message.responseModel
  return {
    response: {
      kind: REPLAY_KIND,
      version: REPLAY_VERSION,
      api: message.api,
      provider: message.provider,
      model: requestedModel,
      ...(responseModel === undefined ? {} : { responseModel }),
      ...(message.responseId === undefined ? {} : { responseId: message.responseId }),
      ...(message.providerThinkingLevel === undefined
        ? {}
        : { providerThinkingLevel: message.providerThinkingLevel }),
      stopReason: message.stopReason,
    },
    blocks: message.content.map((block) => {
      switch (block.type) {
        case 'text':
          return {
            type: 'text',
            ...(block.textSignature === undefined ? {} : { textSignature: block.textSignature }),
          }
        case 'thinking':
          return {
            type: 'reasoning',
            ...(block.thinkingSignature === undefined
              ? {}
              : { thinkingSignature: block.thinkingSignature }),
            ...(block.redacted === undefined ? {} : { redacted: block.redacted }),
          }
        case 'toolCall':
          return {
            type: 'tool-call',
            ...(block.thoughtSignature === undefined
              ? {}
              : { thoughtSignature: block.thoughtSignature }),
          }
        default:
          return { type: 'unknown' }
      }
    }),
  }
}

/** An unusable replay envelope: recoverable, so the message degrades instead of failing. */
function invalidReplay(detail) {
  throw new LlmError(`invalid opencode-go replay state: ${detail}`, 'INVALID_REPLAY_STATE')
}

/** Validate the durable adapter-private envelope before it reaches pi-ai. */
function readReplayState(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidReplay('expected a replay envelope')
  }
  const rawResponse = value.response
  if (typeof rawResponse !== 'object' || rawResponse === null || Array.isArray(rawResponse)) {
    return invalidReplay('expected a response object')
  }
  const response = rawResponse
  if (response.kind !== REPLAY_KIND) return invalidReplay('unknown state kind')
  if (response.version !== REPLAY_VERSION) {
    return invalidReplay(`unsupported version ${String(response.version)}`)
  }
  for (const key of ['api', 'provider', 'model']) {
    if (typeof response[key] !== 'string' || response[key].length === 0) {
      return invalidReplay(`${key} must be a non-empty string`)
    }
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(response.stopReason))) {
    return invalidReplay('unknown stopReason')
  }
  for (const key of ['responseModel', 'responseId', 'providerThinkingLevel']) {
    if (response[key] !== undefined && typeof response[key] !== 'string') {
      return invalidReplay(`${key} must be a string`)
    }
  }
  const blocks = value.blocks
  if (!Array.isArray(blocks)) return invalidReplay('blocks must be an array')
  for (const [index, block] of blocks.entries()) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      return invalidReplay(`block ${index} must be an object`)
    }
    if (!['text', 'reasoning', 'tool-call'].includes(String(block.type))) {
      return invalidReplay(`block ${index} has an unknown type`)
    }
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature']) {
      if (block[signature] !== undefined && typeof block[signature] !== 'string') {
        return invalidReplay(`block ${index} ${signature} must be a string`)
      }
    }
    if (block.redacted !== undefined && typeof block.redacted !== 'boolean') {
      return invalidReplay(`block ${index} redacted must be boolean`)
    }
  }
  return { response, blocks }
}

/** Convert provider-neutral blocks without trusting them as same-model replay. */
function foreignAssistant(message) {
  const source = message.source?.kind === 'model' ? message.source : undefined
  const content = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text })
        break
      case 'reasoning':
        content.push({ type: 'thinking', thinking: block.text })
        break
      case 'tool-call':
        content.push({
          type: 'toolCall',
          id: String(block.id),
          name: block.name,
          arguments: parseArguments(block.arguments),
        })
        break
      case 'image':
        throw new LlmError(
          'OpenCode Go chat history cannot represent structured assistant image output',
          'UNSUPPORTED_CONTENT',
        )
      default:
        break
    }
  }
  return {
    role: 'assistant',
    content,
    api: 'opencode-go-foreign',
    provider: source?.provider ?? 'opencode-go-foreign',
    model: source?.model ?? 'opencode-go-foreign',
    usage: emptyPiUsage(),
    stopReason: content.some((piece) => piece.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

/** Recombine durable harness content with validated pi-ai replay metadata. */
function replayedAssistant(message, source, rawState) {
  const state = readReplayState(rawState)
  if (state.response.provider !== source.provider) {
    return invalidReplay('provider does not match assistant source')
  }
  if (state.response.model !== source.model) {
    return invalidReplay('model does not match assistant source')
  }
  if (state.blocks.length !== message.content.length) {
    return invalidReplay('block count does not match assistant content')
  }
  return {
    role: 'assistant',
    content: message.content.map((block, index) => {
      const replay = state.blocks[index]
      if (replay === undefined || replay.type !== block.type) {
        return invalidReplay(`block ${index} does not match assistant content`)
      }
      switch (block.type) {
        case 'text':
          return {
            type: 'text',
            text: block.text,
            ...(replay.type === 'text' && replay.textSignature !== undefined
              ? { textSignature: replay.textSignature }
              : {}),
          }
        case 'reasoning':
          return {
            type: 'thinking',
            thinking: block.text,
            ...(replay.type === 'reasoning' && replay.thinkingSignature !== undefined
              ? { thinkingSignature: replay.thinkingSignature }
              : {}),
            ...(replay.type === 'reasoning' && replay.redacted !== undefined
              ? { redacted: replay.redacted }
              : {}),
          }
        case 'tool-call':
          return {
            type: 'toolCall',
            id: String(block.id),
            name: block.name,
            arguments: parseArguments(block.arguments),
            ...(replay.type === 'tool-call' && replay.thoughtSignature !== undefined
              ? { thoughtSignature: replay.thoughtSignature }
              : {}),
          }
        default:
          return invalidReplay(`block ${index} has an unsupported harness type`)
      }
    }),
    api: state.response.api,
    provider: state.response.provider,
    model:
      state.response.api === 'anthropic-messages'
        ? (state.response.responseModel ?? state.response.model)
        : state.response.model,
    ...(state.response.responseModel === undefined
      ? {}
      : { responseModel: state.response.responseModel }),
    ...(state.response.responseId === undefined ? {} : { responseId: state.response.responseId }),
    ...(state.response.providerThinkingLevel === undefined
      ? {}
      : { providerThinkingLevel: state.response.providerThinkingLevel }),
    usage: emptyPiUsage(),
    stopReason: state.response.stopReason,
    timestamp: 0,
  }
}

/**
 * Convert one durable harness assistant message into pi-ai history.
 * @param message - assistant content with required source and optional replay metadata.
 * @param onDegrade - called with the diagnostic reason when an unusable replay
 *   state falls back to provider-neutral conversion.
 * @returns a native pi-ai assistant message reconstructed from durable content.
 */
export function toPiAssistant(message, onDegrade) {
  const source = message.source
  if (source?.kind !== 'model' || source.replayState === undefined) return foreignAssistant(message)
  try {
    return replayedAssistant(message, source, source.replayState)
  } catch (error) {
    if (!(error instanceof LlmError) || error.code !== 'INVALID_REPLAY_STATE') throw error
    onDegrade?.(error.message)
    return foreignAssistant(message)
  }
}

/** Flatten visible text of one message body. */
function flattenText(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Flatten text recursively inside one tool result. */
function toolResultText(blocks) {
  return blocks
    .map((block) =>
      block.type === 'text'
        ? block.text
        : block.type === 'tool-result'
          ? toolResultText(block.content)
          : '',
    )
    .join('')
}

/** Reject image roles pi-ai cannot replay before request-size offloading can replace them. */
function assertSupportedImageRoles(messages) {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `OpenCode Go cannot represent an image in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

function toolsOf(options) {
  return options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

/**
 * Select the pi-ai `systemPrompt` source. `options.system` wins when defined;
 * otherwise a leading `system` history message supplies the prompt and leaves
 * the converted history.
 */
function splitSystemPrompt(options) {
  if (options.system !== undefined) {
    return { systemPrompt: options.system, messages: options.messages }
  }
  const [first, ...rest] = options.messages
  if (first?.role !== 'system') return { systemPrompt: undefined, messages: options.messages }
  const text = flattenText(first)
  return { systemPrompt: text.length > 0 ? text : undefined, messages: rest }
}

/** Assemble the request-level pi-ai context envelope. */
function piContext(systemPrompt, options, messages) {
  const tools = toolsOf(options)
  return {
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    messages,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
  }
}

/** Collect every distinct image reference in request order. */
function collectImageRefs(blocks, refs) {
  for (const block of blocks) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

/** Read and normalize every request image once, keyed by attachment id. */
async function prepareRequestImages(messages, images, signal) {
  const refs = new Map()
  for (const message of messages) collectImageRefs(message.content, refs)
  const ordered = [...refs.values()]
  const prepared = await Promise.all(
    ordered.map((ref) => images.attachments.readImageRequest(ref, images.requestImagePolicy, signal)),
  )
  const versions = new Map()
  for (const [index, ref] of ordered.entries()) versions.set(ref.attachmentId, prepared[index])
  return versions
}

/** Project one block list to pi-ai user content. */
async function userContent(blocks, requestImages, resolveAccess) {
  const content = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const version = requestImages.get(block.attachment.attachmentId)
        content.push({
          type: 'text',
          text: requestImageHandleText(block.attachment, version, resolveAccess(block.attachment)),
        })
        content.push({
          type: 'image',
          data: Buffer.from(version.data).toString('base64'),
          mimeType: version.mediaType,
        })
        break
      }
      case 'tool-result': {
        const nested = await userContent(block.content, requestImages, resolveAccess)
        if (typeof nested === 'string') {
          if (nested.length > 0) content.push({ type: 'text', text: nested })
        } else content.push(...nested)
        break
      }
      default:
        break
    }
  }
  if (content.every((block) => block.type === 'text')) {
    return content.map((block) => block.text).join('')
  }
  return content
}

function appendAssistant(message, messages, toolNames, onDegrade) {
  const assistant = toPiAssistant(message, onDegrade)
  for (const block of assistant.content) {
    if (block.type === 'toolCall') toolNames.set(brandString(block.id), block.name)
  }
  messages.push(assistant)
}

/** Text-only projection: no attachment service is mounted for this request. */
function textOnlyContext(options, onDegrade) {
  assertSupportedImageRoles(options.messages)
  const split = splitSystemPrompt(options)
  const toolNames = new Map()
  const messages = []
  for (const message of split.messages) {
    if (contentHasImage(message.content)) {
      throw new LlmError(
        'OpenCode Go image conversion requires the durable attachment service',
        'UNSUPPORTED_CONTENT',
      )
    }
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      appendAssistant(message, messages, toolNames, onDegrade)
      continue
    }
    const text = flattenText(message)
    const results = message.content.filter((block) => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content: text, timestamp: 0 })
    }
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: String(result.toolCallId),
        toolName: toolNames.get(String(result.toolCallId)) ?? 'unknown',
        content: [{ type: 'text', text: toolResultText(result.content) || '(no output)' }],
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return piContext(split.systemPrompt, options, messages)
}

/** Image-aware projection: the attachment service is mounted for this request. */
async function imageContext(options, images, onDegrade) {
  assertSupportedImageRoles(options.messages)
  const split = splitSystemPrompt(options)
  const requestMessages = offloadRequestImagesWithPolicy(split.messages, {
    representation: 'base64',
    ...(images.maxRequestImageBytes === undefined ? {} : { maxBytes: images.maxRequestImageBytes }),
    byteQuantum: 1,
    byteLength: (ref) => Math.min(ref.bytes, images.requestImagePolicy.maxBytes),
    placeholder: (ref) => offloadedImageText(ref, images.resolveAccess(ref)),
  })
  const requestImages = await prepareRequestImages(requestMessages, images, options.signal)
  const exactMessages = offloadRequestImagesWithPolicy(requestMessages, {
    representation: 'base64',
    ...(images.maxRequestImageBytes === undefined ? {} : { maxBytes: images.maxRequestImageBytes }),
    byteQuantum: 1,
    byteLength: (ref) => requestImages.get(ref.attachmentId).bytes,
    placeholder: (ref) => offloadedImageText(ref, images.resolveAccess(ref)),
  })
  const toolNames = new Map()
  const messages = []
  for (const message of exactMessages) {
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      appendAssistant(message, messages, toolNames, onDegrade)
      continue
    }
    const content = await userContent(
      message.content.filter((block) => block.type !== 'tool-result'),
      requestImages,
      images.resolveAccess,
    )
    const results = message.content.filter((block) => block.type === 'tool-result')
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      const resultContent = await userContent(result.content, requestImages, images.resolveAccess)
      messages.push({
        role: 'toolResult',
        toolCallId: String(result.toolCallId),
        toolName: toolNames.get(String(result.toolCallId)) ?? 'unknown',
        content:
          typeof resultContent === 'string'
            ? [{ type: 'text', text: resultContent || '(no output)' }]
            : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return piContext(split.systemPrompt, options, messages)
}

/**
 * Convert one harness request into a pi-ai context.
 * @param options - the fully assembled request.
 * @param images - image projection inputs, or undefined for the text-only path.
 * @param onDegrade - replay-degradation diagnostic sink.
 * @returns the pi-ai context envelope.
 */
export function toPiContext(options, images, onDegrade) {
  return images === undefined
    ? Promise.resolve(textOnlyContext(options, onDegrade))
    : imageContext(options, images, onDegrade)
}

/** Map pi-ai usage (reasoning folded into output by pi-ai). */
function mapUsage(usage) {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}),
    ...(usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}),
  }
}

/** Classify one provider failure message into a stable harness code. */
export function classifyPiAiError(message) {
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  if (
    /\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i.test(
      message,
    )
  ) {
    return 'INVALID_REQUEST'
  }
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  if (/stream ended (?:before|without)\b/i.test(message)) return 'TRANSPORT'
  if (
    /\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message) ||
    /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(
      message,
    ) ||
    /\bterminated\b|premature close/i.test(message)
  ) {
    return 'TRANSPORT'
  }
  return 'PROVIDER_ERROR'
}

/** Map a terminal pi-ai event to a harness finish reason. */
function mapStopReason(message, contextWindow) {
  const providerOverflow = isContextOverflow(message, contextWindow)
  const harnessOverflow =
    message.stopReason === 'error' &&
    message.errorMessage !== undefined &&
    isContextWindowExceededError(message.errorMessage)
  if (providerOverflow || harnessOverflow) {
    return {
      kind: 'error',
      failure: {
        message:
          message.errorMessage ?? `OpenCode Go detected context overflow for model "${message.model}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    }
  }
  switch (message.stopReason) {
    case 'stop':
      if (message.content.length === 0) {
        return {
          kind: 'error',
          failure: {
            message: `model "${message.model}" returned a completed response with no content`,
            code: EMPTY_RESPONSE_CODE,
          },
        }
      }
      return { kind: 'stop' }
    case 'length':
      return { kind: 'max-tokens' }
    case 'toolUse':
      return { kind: 'tool-calls' }
    case 'aborted':
      return {
        kind: 'aborted',
        failure: { message: message.errorMessage ?? 'stream aborted', code: 'ABORTED' },
      }
    case 'error': {
      const text = message.errorMessage ?? 'OpenCode Go stream error'
      return { kind: 'error', failure: { message: text, code: classifyPiAiError(text) } }
    }
    default:
      return {
        kind: 'error',
        failure: {
          message: `OpenCode Go stream for model "${message.model}" ended in state "${String(message.stopReason)}"`,
          code: 'PROVIDER_ERROR',
        },
      }
  }
}

/**
 * Translate the pi-ai event stream into harness chunks. pi-ai reports
 * failures as terminal events rather than mid-stream throws, which become
 * error/aborted `finish` chunks.
 * @param events - one assistant turn's pi-ai event stream.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @param callerSignal - caller cancellation state.
 * @param requestedModel - request model identity for durable replay provenance.
 * @returns harness chunks ending with `usage` then `finish`.
 */
export async function* toStreamChunks(events, contextWindow, callerSignal, requestedModel) {
  const toolIds = new Map()
  for await (const event of events) {
    switch (event.type) {
      case 'start':
        break
      case 'text_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }
        break
      case 'text_delta':
        yield { type: 'text-delta', index: event.contentIndex, text: event.delta }
        break
      case 'text_end':
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: { type: 'text', text: event.content },
        }
        break
      case 'thinking_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }
        break
      case 'thinking_delta':
        yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }
        break
      case 'thinking_end':
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: { type: 'reasoning', text: event.content },
        }
        break
      case 'toolcall_start': {
        const partial = event.partial.content[event.contentIndex]
        const id = partial?.type === 'toolCall' ? partial.id : ''
        const name = partial?.type === 'toolCall' ? partial.name : ''
        toolIds.set(event.contentIndex, { id, name })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const known = toolIds.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: brandString(known?.id ?? ''),
          ...(known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {}),
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end':
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: {
            type: 'tool-call',
            id: brandString(event.toolCall.id),
            name: event.toolCall.name,
            arguments: JSON.stringify(event.toolCall.arguments ?? {}),
          },
        }
        break
      case 'done':
        yield { type: 'usage', usage: mapUsage(event.message.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(event.message, contextWindow),
          replayState: toPiReplayState(event.message, requestedModel),
        }
        return
      case 'error':
        yield { type: 'usage', usage: mapUsage(event.error.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(
            callerSignal?.aborted ? { ...event.error, stopReason: 'aborted' } : event.error,
            contextWindow,
          ),
        }
        return
      default:
        break
    }
  }
  throw new LlmError('OpenCode Go event stream ended without done/error', 'STREAM_CLOSED')
}
