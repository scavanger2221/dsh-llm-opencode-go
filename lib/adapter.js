/**
 * The OpenCode Go adapter for the harness LLM seam.
 *
 * Wire behavior belongs to pi-ai, whose installed catalog describes every Go
 * model's protocol (Chat Completions, Responses, or Anthropic Messages). This
 * adapter adds the two things a Go client must do and the shipped pi-ai
 * adapter does not:
 *
 *  1. **Session identity on every request.** OpenCode Go uses
 *     `x-opencode-session` for routing and prompt-cache affinity, and also
 *     recognizes the harness's own `x-deepseek-harness-session-id`. The
 *     harness stamps `GenerateOptions.sessionId` on loop-built requests, so
 *     both headers are emitted per request — not per profile, which is all a
 *     static `headers:` map on a pi-ai profile could express.
 *  2. **A model catalog that follows the live endpoint.** New Go models appear
 *     in the picker after a refresh instead of waiting for a pi-ai upgrade.
 *
 * @module dsh-llm-opencode-go/adapter
 */

import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  contentHasImage,
  resolveImageAttachmentAccess,
} from '@deepseek-ai/dsh-llm'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { classifyPiAiError, toPiContext, toStreamChunks } from './convert.js'

/** Human-readable label for one pi-ai thinking level. */
function levelName(level) {
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

/** Selectable efforts for one model, or nothing when the model cannot think. */
function reasoningInfo(model) {
  if (model.reasoning !== true) return {}
  const efforts = getSupportedThinkingLevels(model).map((level) => ({
    id: ReasoningEffortId(level),
    name: levelName(level),
  }))
  if (efforts.length === 0) return {}
  return { reasoning: { efforts } }
}

/** Validate one explicit effort against the exact model, before any provider I/O. */
function resolveReasoningEffort(model, effort) {
  if (effort === undefined) return undefined
  if (!getSupportedThinkingLevels(model).includes(String(effort))) {
    throw new LlmError(
      `opencode-go model "${model.id}" does not support reasoning effort "${String(effort)}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  return String(effort) === 'off' ? undefined : String(effort)
}

/** Turn any provider-side setup failure into a harness failure code. */
function asLlmError(error, apiKeyEnv) {
  if (error instanceof LlmError) return error
  const message = String(error?.message ?? error)
  if (/No API key for provider/i.test(message)) {
    return new LlmError(
      `llm-opencode-go: no credential resolved for ${apiKeyEnv}; store it through the credentials service (the Web Models page writes it) or export it`,
      'MISSING_CREDENTIAL',
      { cause: error },
    )
  }
  return new LlmError(message, classifyPiAiError(message), { cause: error })
}

/**
 * One adapter instance serves the single `opencode-go` route.
 */
export class OpenCodeGoAdapter extends LlmAdapter {
  constructor(config) {
    super()
    this.config = config
  }

  providerInfo(provider) {
    return { id: provider, name: this.config.displayName }
  }

  providerRetryPolicy() {
    // Normal mode with the seam's own defaults; the harness retry executor
    // re-runs failed steps, so the provider call itself must not retry.
    return undefined
  }

  listModels(provider) {
    return Promise.resolve(
      [...this.config.catalog.models().values()].map((model) => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      })),
    )
  }

  resolveModel(provider, model) {
    return Promise.resolve(this.describe(provider, model))
  }

  /** Describe one exact model from the current catalog generation. */
  describe(provider, model) {
    const entry = this.config.catalog.get(model)
    if (entry === undefined) {
      throw new LlmError(
        `opencode-go has no model "${model}"; refresh the catalog (the OpenCode Go provider refreshes on mount and on its interval) or add the id under the plugin's "models" configuration`,
        'UNKNOWN_MODEL',
      )
    }
    return {
      provider,
      id: model,
      name: entry.name,
      inputModalities: [...entry.input],
      context: { contextWindow: entry.contextWindow },
      ...reasoningInfo(entry),
    }
  }

  /**
   * Stream one model call. The request that reaches OpenCode Go carries the
   * harness attribution headers plus both session headers, so Go can route and
   * cache a conversation instead of treating every call as a new one.
   */
  async *stream(options) {
    if (options.stop !== undefined) {
      throw new LlmError('OpenCode Go streaming does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    const entry = this.config.catalog.get(options.model)
    if (entry === undefined) {
      throw new LlmError(`opencode-go has no model "${options.model}"`, 'UNKNOWN_MODEL')
    }
    const reasoning = resolveReasoningEffort(entry, options.reasoningEffort)
    const containsImage = options.messages.some((message) => contentHasImage(message.content))
    if (containsImage && !entry.input.includes('image')) {
      throw new LlmError(
        `opencode-go model "${entry.id}" does not accept image input`,
        'UNSUPPORTED_CONTENT',
      )
    }
    const attachments = containsImage ? this.config.resolveAttachments() : undefined
    if (containsImage && attachments === undefined) {
      throw new LlmError(
        'OpenCode Go image input requires the durable attachment service',
        'UNSUPPORTED_CONTENT',
      )
    }
    const apiKey = await this.config.resolveApiKey()
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new LlmError(
        `llm-opencode-go: no credential for the OpenCode Go route; store ${this.config.apiKeyEnv} through the credentials service (the Web Models page writes it) or export it, then retry`,
        'MISSING_CREDENTIAL',
      )
    }
    const context = await toPiContext(
      options,
      attachments === undefined
        ? undefined
        : {
            attachments,
            requestImagePolicy: this.config.requestImagePolicy,
            maxRequestImageBytes: this.config.maxRequestImageBytes,
            resolveAccess: (ref) =>
              resolveImageAttachmentAccess(
                attachments,
                (hostPath) => this.config.processPathFromHostPath(hostPath),
                ref,
              ),
          },
      this.config.onReplayDegrade,
    )
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    const headers = this.config.requestHeaders(sessionId)
    let events
    try {
      events = this.config.provider().streamSimple(entry, context, {
        apiKey,
        headers,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(reasoning === undefined ? {} : { reasoning }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(this.config.requestTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.config.requestTimeoutMs }),
        maxRetries: 0,
      })
    } catch (error) {
      throw asLlmError(error, this.config.apiKeyEnv)
    }
    yield* toStreamChunks(events, entry.contextWindow, options.signal, options.model)
  }
}
