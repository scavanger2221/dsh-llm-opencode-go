/**
 * OpenCode Go (`https://opencode.ai/docs/go/`) as a first-class harness
 * model provider.
 *
 * Mounting this plugin registers one LLM route — `opencode-go` by default —
 * that serves every model the OpenCode Go subscription exposes, over the wire
 * protocol each model speaks (pi-ai carries Chat Completions, Responses and
 * Anthropic Messages). Two behaviors make it work well as a Go client:
 *
 *  - **Session identity on every request.** Go asks clients for a stable
 *    per-conversation session id so it can route requests and reuse prompt
 *    caches; the harness stamps `GenerateOptions.sessionId` on every
 *    loop-built call, and this adapter maps it onto both `x-opencode-session`
 *    and the harness-native `x-deepseek-harness-session-id`. That closes the
 *    gap OpenCode's client matrix records for DeepSeek Harness, where session
 *    information reached only some model paths.
 *  - **A catalog that follows the live endpoint.** The pinned pi-ai release
 *    describes the models that existed when it shipped; Go keeps adding them.
 *    The plugin refreshes `{apiRoot}/v1/models` on mount, on an interval, and
 *    on demand (`/opencode-refresh`), enriching unknown ids from models.dev so
 *    a newly released model is usable from the picker with no edit at all.
 *
 * Configuration is plain Cordis config, layered under the `llm-opencode-go`
 * user-settings section when the settings service is mounted, so deployment
 * defaults live in the profile composition and a user can override them in
 * `$DSH_HOME/settings.yaml`.
 *
 * @module dsh-llm-opencode-go
 */

import z from '@deepseek-ai/schemastery'
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { attributionHeaders, assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { OpenCodeGoAdapter } from './adapter.js'
import { SUPPORTED_APIS, createCatalog } from './catalog.js'
import { createRefresher, fetchLiveModelIds } from './refresh.js'

/** Cordis plugin name; also the route id and settings-namespace default. */
export const name = 'llm-opencode-go'
/** The seam this route registers on. */
export const inject = ['llm']
/** User-settings namespace that layers over this composition entry. */
export const NS = 'llm-opencode-go'

const DEFAULT_API_ROOT = 'https://opencode.ai/zen/go'
const DEFAULT_API_KEY_ENV = 'OPENCODE_API_KEY'
const DEFAULT_SESSION_HEADER = 'x-opencode-session'
const DEFAULT_HARNESS_SESSION_HEADER = 'x-deepseek-harness-session-id'

/** One hand-declared or corrected model. */
const modelEntry = z.object({
  id: z.string().required(),
  name: z.string(),
  api: z.union(SUPPORTED_APIS.map((api) => z.const(api))),
  contextWindow: z.number(),
  maxTokens: z.number(),
  reasoning: z.boolean(),
  input: z.array(z.union([z.const('text'), z.const('image')])),
})

/** Deployment defaults; each is overridable from the user settings document. */
export const Config = z.object({
  providerId: z.string().default('opencode-go'),
  displayName: z.string().default('OpenCode Go'),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV),
  apiRoot: z.string().default(DEFAULT_API_ROOT),
  sessionHeader: z.string().default(DEFAULT_SESSION_HEADER),
  harnessSessionHeader: z.string().default(DEFAULT_HARNESS_SESSION_HEADER),
  headers: z.dict(z.string()).default({}),
  models: z.array(modelEntry).default([]),
  refreshOnMount: z.boolean().default(true),
  refreshIntervalMs: z.number().default(6 * 60 * 60 * 1000),
  // Internal kick for the settings card's "Refresh now" button: every settings
  // change already re-syncs and re-reads the live catalog, so a monotonically
  // newer value is what makes that button work without a private wire method.
  refreshEpoch: z.number().default(0),
  metadataUrl: z.string().default('https://models.dev/api.json'),
  metadataTtlMs: z.number().default(24 * 60 * 60 * 1000),
  requestImagePixelBudget: z.number().default(4194304),
  requestImageMaxBytes: z.number().default(1048576),
  maxRequestImageBytes: z.number().default(20971520),
  requestTimeoutMs: z.number(),
})

/** Read one non-empty string setting, or its fallback. */
function textOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/**
 * Merge the deployment's extra headers under the mandatory attribution
 * headers, then add both session headers for this one request.
 *
 * Exported because it is the behavior OpenCode Go's client matrix asks for:
 * a stable per-conversation session id on every request, under Go's own
 * header name and the harness-native one it also recognizes.
 * @param value - resolved plugin configuration.
 * @param sessionId - the harness session identity, when the caller stamped one.
 * @returns the headers for one provider request.
 */
export function sessionRequestHeaders(value, sessionId) {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map((header) => header.toLowerCase()))
  const extra = Object.fromEntries(
    Object.entries(value.headers ?? {}).filter(
      ([header]) => !reserved.has(header.toLowerCase()),
    ),
  )
  const headers = { ...extra, ...attribution }
  if (sessionId !== undefined) {
    headers[textOr(value.sessionHeader, DEFAULT_SESSION_HEADER)] = sessionId
    headers[textOr(value.harnessSessionHeader, DEFAULT_HARNESS_SESSION_HEADER)] = sessionId
  }
  return headers
}

export function apply(ctx, config) {
  let current = () => config
  const read = () => current() ?? config

  const routeId = () => textOr(read().providerId, 'opencode-go')
  const apiKeyEnv = () => textOr(read().apiKeyEnv, DEFAULT_API_KEY_ENV)

  let catalog
  let providerInstance
  let refresher
  let timer
  /** Stable facade: the adapter keeps this object while `catalog` is replaced. */
  const catalogView = {
    get: (id) => catalog.get(id),
    models: () => catalog.models(),
    ids: () => catalog.ids(),
    isInstalled: (id) => catalog.isInstalled(id),
  }

  const provider = () => {
    if (providerInstance === undefined) {
      providerInstance = createProvider({
        id: routeId(),
        name: textOr(read().displayName, 'OpenCode Go'),
        auth: envApiKeyAuth('OpenCode Go API key', [apiKeyEnv()]),
        models: [...catalog.models().values()],
        api: {
          'anthropic-messages': anthropicMessagesApi(),
          'openai-completions': openAICompletionsApi(),
          'openai-responses': openAIResponsesApi(),
        },
      })
    }
    return providerInstance
  }

  /**
   * Resolve the credential through the harness seam (managed store, inherited
   * environment, `.env` fallbacks), then through the launch environment the
   * launcher captured. A reference that resolves to nothing leaves the route
   * configured but keyless, and the request fails with `MISSING_CREDENTIAL`.
   */
  const resolveApiKey = async () => {
    const ref = apiKeyEnv()
    const credentials = ctx.get('credentials')
    const hit =
      credentials !== undefined
        ? (await credentials.resolve(ref))?.value
        : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-opencode-go', ref)
    return undefined
  }

  const adapterConfig = {
    get catalog() {
      return catalogView
    },
    get displayName() {
      return textOr(read().displayName, 'OpenCode Go')
    },
    get apiKeyEnv() {
      return apiKeyEnv()
    },
    get requestImagePolicy() {
      const value = read()
      return {
        maxPixels: value.requestImagePixelBudget ?? 4194304,
        maxBytes: value.requestImageMaxBytes ?? 1048576,
      }
    },
    get maxRequestImageBytes() {
      return read().maxRequestImageBytes ?? 20971520
    },
    get requestTimeoutMs() {
      return read().requestTimeoutMs
    },
    provider,
    resolveApiKey,
    resolveAttachments: () => ctx.get('attachments'),
    processPathFromHostPath: (hostPath) => ctx.get('fs')?.processPathFromHostPath(hostPath),
    requestHeaders: (sessionId) => sessionRequestHeaders(read(), sessionId),
    onReplayDegrade: (reason) => {
      ctx.logger.warn(
        `llm-opencode-go: unusable replay state on assistant history for route "${routeId()}"; sending that message as provider-neutral content (${reason})`,
      )
    },
  }
  const adapter = new OpenCodeGoAdapter(adapterConfig)

  /** Rebuild the catalog, provider and refresher from the current config. */
  const build = () => {
    const value = read()
    catalog = createCatalog({
      apiRoot: textOr(value.apiRoot, DEFAULT_API_ROOT),
      providerId: routeId(),
      models: Array.isArray(value.models) ? value.models : [],
    })
    providerInstance = undefined
    refresher = createRefresher({
      catalog,
      apiRoot: textOr(value.apiRoot, DEFAULT_API_ROOT),
      metadataUrl: textOr(value.metadataUrl, 'https://models.dev/api.json'),
      metadataTtlMs: value.metadataTtlMs ?? 24 * 60 * 60 * 1000,
      logger: ctx.logger,
    })
  }

  const registration = (() => {
    build()
    return ctx.llm.registerAdapter([routeId()], adapter)
  })()

  /** Announce a changed model catalog to every registry observer. */
  const notify = () => {
    try {
      registration.replace([routeId()])
    } catch (error) {
      ctx.logger.error(`llm-opencode-go: could not re-announce the route after a refresh`)
      ctx.logger.error(error)
    }
  }

  const refreshNow = async () => {
    const outcome = await refresher.refresh()
    if (outcome.error !== undefined) {
      ctx.logger.warn(`llm-opencode-go: model refresh failed: ${outcome.error}`)
      return outcome
    }
    if (outcome.added.length > 0) {
      providerInstance = undefined
      ctx.logger.info(
        `llm-opencode-go: refresh advertised ${outcome.live} model(s) and added ${outcome.added.join(', ')} (${outcome.total} now configured, ${outcome.enriched} with full metadata)`,
      )
      notify()
    }
    return outcome
  }

  const schedule = () => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    const interval = read().refreshIntervalMs ?? 0
    if (!(typeof interval === 'number' && interval > 0)) return
    timer = setInterval(() => {
      void refreshNow()
    }, interval)
    timer.unref?.()
  }

  const resync = () => {
    build()
    schedule()
    try {
      registration.replace([routeId()])
    } catch (error) {
      ctx.logger.error(
        `llm-opencode-go: keeping the previously registered route after a refused config change`,
      )
      ctx.logger.error(error)
      return
    }
    void refreshNow()
  }

  ctx.effect(() => () => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  })

  schedule()

  // Answer "which models can this provider serve?" for a configuration
  // surface editing this namespace; the local catalog answers first, so a
  // configured route costs no network call.
  ctx.llm.registerModelDiscovery(NS, async (request, signal) => {
    if (request.provider === undefined || request.provider === routeId()) {
      const local = catalogView.ids().map((id) => ({ id, name: catalogView.get(id)?.name }))
      if (local.length > 0 && request.baseURL === undefined) return local
    }
    const ids = await fetchLiveModelIds({
      apiRoot: textOr(request.baseURL, textOr(read().apiRoot, DEFAULT_API_ROOT)),
      signal,
    })
    return ids.map((id) => ({ id }))
  })

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        resync()
      },
      validate: (value) => {
        for (const entry of value.models ?? []) {
          if (entry?.api !== undefined && !SUPPORTED_APIS.includes(entry.api)) {
            throw new Error(
              `llm-opencode-go: model "${entry.id}" names unsupported api "${entry.api}"; supported protocols are ${SUPPORTED_APIS.join(', ')}`,
            )
          }
        }
      },
    })
  })

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'opencode-refresh',
      description: 'Refresh the OpenCode Go model catalog from the live endpoint',
      handler: async () => {
        const outcome = await refreshNow()
        if (outcome.error !== undefined) {
          return { kind: 'error', text: `OpenCode Go refresh failed: ${outcome.error}` }
        }
        const added =
          outcome.added.length === 0
            ? 'no new models'
            : `added ${outcome.added.join(', ')}`
        return {
          kind: 'success',
          text: `OpenCode Go: ${outcome.live} model(s) advertised, ${added}; ${outcome.total} configured (${outcome.enriched} enriched from models.dev)`,
        }
      },
    })
  })

  if (read().refreshOnMount !== false) void refreshNow()
}

// The settings card (dsh-llm-opencode-go-ui) writes `refreshEpoch` to ask for
// an immediate re-read of the live catalog.
