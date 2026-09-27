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
 *  - **Plan usage on the settings card.** Go meters a subscription in three
 *    windows (5-hour, weekly, monthly) and reports them itself at
 *    `{apiRoot}/v1/usage`; the plugin republishes that read to the browser half
 *    as an authenticated route so the card can show what is left without the
 *    key leaving this process (see `./usage.js`).
 *
 * Configuration is plain Cordis config, layered under the `llm-opencode-go`
 * user-settings section when the settings service is mounted, so deployment
 * defaults live in the profile composition and a user can override them from the
 * Models page.
 *
 * From 0.1.7 the settings service projects every mounted entry's Config into a
 * settings namespace keyed by the entry id (`llm-opencode-go`), persists a form
 * write as a `config:` override on this profile row, and remounts the entry so
 * `apply` re-runs with the new values. The route is also declared on the
 * configurable-provider directory on a best-effort basis, and the browser
 * half renders its card in the Models page's footer seat.
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
import { defaultCatalogCacheFile, readCatalogCache, writeCatalogCache } from './model-cache.js'
import { createRefresher, fetchLiveModelIds } from './refresh.js'
import { USAGE_ROUTE, fetchPlanUsage } from './usage.js'

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
  // Take the model out of the catalog without losing what is known about it: the
  // id stays described (a settings surface still lists it) but is not served, so
  // the picker stops offering it and a request naming it fails loudly.
  disabled: z.boolean(),
})

/**
 * Deployment defaults and user-editable fields.
 *
 * **A field must be `.volatile()` to be editable at all on 0.1.7.** The settings
 * service projects a namespace only for a schema that has at least one volatile
 * node (`volatileForm`) — with none, the plugin has no settings namespace, the
 * card's `configForms.get(NS)` reports `unavailable`, and the card renders
 * nothing. The six volatile fields here are exactly what the card reads and
 * writes: the endpoint, the refresh policy and its trigger, the model overrides,
 * the display name, and the credential reference.
 *
 * Volatile also means "commit in place": a write does not remount the entry, it
 * updates the running Config reference and emits `loader/volatile-update`, which
 * is why `apply` rebuilds its derived state from that event. Everything else
 * stays ordinary configuration — a change to it remounts the entry, and it is
 * edited in the profile patch rather than from the card.
 */
export const Config = z.object({
  providerId: z.string().default('opencode-go'),
  displayName: z.string().default('OpenCode Go').volatile(),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).volatile(),
  apiRoot: z.string().default(DEFAULT_API_ROOT).volatile(),
  sessionHeader: z.string().default(DEFAULT_SESSION_HEADER),
  harnessSessionHeader: z.string().default(DEFAULT_HARNESS_SESSION_HEADER),
  headers: z.dict(z.string()).default({}),
  models: z.array(modelEntry).default([]).volatile(),
  refreshOnMount: z.boolean().default(true),
  refreshIntervalMs: z.number().default(6 * 60 * 60 * 1000).volatile(),
  // Internal kick for the settings card's "Refresh now" button: the settings
  // service has no private wire method for it, so a monotonically newer value is
  // what makes the button work — the volatile update it raises is the signal.
  refreshEpoch: z.number().default(0).volatile(),
  metadataUrl: z.string().default('https://models.dev/api.json'),
  metadataTtlMs: z.number().default(24 * 60 * 60 * 1000),
  // Where the last live model list is kept, so a mount serves what the endpoint
  // advertised before this process started (`./model-cache.js`). Empty means
  // `$DSH_HOME/storages/llm-opencode-go/catalog.json`. Ordinary configuration,
  // not a settings-card field: it is a deployment's storage choice.
  catalogCacheFile: z.string(),
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
  /**
   * One config field as its live value. From 0.1.7 on the Loader hands `apply` a
   * Schemastery Config whose fields are references (`config.apiRoot.get()`), and
   * a settings write to an ordinary field remounts this entry — so `apply` runs
   * again with the new values and nothing here has to subscribe to changes. A
   * plain object is still accepted, which is what a direct `apply` call and the
   * host smoke test pass.
   * @param name - one Config field name.
   * @returns the field's current value.
   */
  const fieldOf = (name) => {
    const value = config?.[name]
    return value !== null && typeof value === 'object' && typeof value.get === 'function'
      ? value.get()
      : value
  }
  /**
   * Every field this plugin reads, resolved at the moment of use. Reading live
   * rather than caching is what keeps a route's header names, credential
   * reference, and image budgets current when the entry is updated in place.
   * @returns the resolved configuration.
   */
  const read = () => ({
    providerId: fieldOf('providerId'),
    displayName: fieldOf('displayName'),
    apiKeyEnv: fieldOf('apiKeyEnv'),
    apiRoot: fieldOf('apiRoot'),
    sessionHeader: fieldOf('sessionHeader'),
    harnessSessionHeader: fieldOf('harnessSessionHeader'),
    headers: fieldOf('headers'),
    models: fieldOf('models'),
    refreshOnMount: fieldOf('refreshOnMount'),
    refreshIntervalMs: fieldOf('refreshIntervalMs'),
    refreshEpoch: fieldOf('refreshEpoch'),
    metadataUrl: fieldOf('metadataUrl'),
    metadataTtlMs: fieldOf('metadataTtlMs'),
    catalogCacheFile: fieldOf('catalogCacheFile'),
    requestImagePixelBudget: fieldOf('requestImagePixelBudget'),
    requestImageMaxBytes: fieldOf('requestImageMaxBytes'),
    maxRequestImageBytes: fieldOf('maxRequestImageBytes'),
    requestTimeoutMs: fieldOf('requestTimeoutMs'),
  })

  const routeId = () => textOr(read().providerId, 'opencode-go')
  const apiKeyEnv = () => textOr(read().apiKeyEnv, DEFAULT_API_KEY_ENV)
  /** Where the last live model list is kept; empty config means the usual store. */
  const cacheFile = () => textOr(read().catalogCacheFile, '') || defaultCatalogCacheFile()

  let catalog
  let providerInstance
  let refresher
  let timer
  /** Stable facade: the adapter keeps this object while `catalog` is replaced. */
  const catalogView = {
    get: (id) => catalog.get(id),
    models: () => catalog.models(),
    all: () => catalog.all(),
    ids: () => catalog.ids(),
    isInstalled: (id) => catalog.isInstalled(id),
    isDisabled: (id) => catalog.isDisabled(id),
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
    // Serve what the endpoint advertised the last time this deployment asked,
    // before the next live read lands. The pinned pi-ai catalog predates the
    // newest Go models, so without this seed a reload or restart answers
    // UNKNOWN_MODEL for any model newer than the pin — including the model a
    // deployment's own `agent-default-model` names — until `/v1/models`
    // answers. A cached id is a merge, not configuration: a `models:` entry
    // still owns its id, a disabled model stays disabled, and the refresh below
    // replaces the facts as soon as it has better ones.
    catalog.mergeRefreshed(readCatalogCache(cacheFile()))
    providerInstance = undefined
    refresher = createRefresher({
      catalog,
      apiRoot: textOr(value.apiRoot, DEFAULT_API_ROOT),
      metadataUrl: textOr(value.metadataUrl, 'https://models.dev/api.json'),
      metadataTtlMs: value.metadataTtlMs ?? 24 * 60 * 60 * 1000,
      logger: ctx.logger,
      onRefreshed: ({ specs, live }) => {
        void writeCatalogCache(cacheFile(), { specs, live }).catch((error) => {
          ctx.logger.warn(
            `llm-opencode-go: could not write ${cacheFile()} (${String(error?.message ?? error)}); models the endpoint adds are re-read on the next start`,
          )
        })
      },
    })
  }

  const registration = (() => {
    build()
    return ctx.llm.registerAdapter([routeId()], adapter)
  })()

  /**
   * The directory entry the Models settings page renders this route from. The
   * page joins registered routes with the declared configurable providers and
   * can only offer an editor for a provider whose settings namespace it can
   * address, so a registered route with no entry here has no row of its own.
   *
   * An empty `settingsPath` says one route is configured by the namespace's own
   * section (rather than by a profile under a shared family namespace).
   *
   * This is best-effort, not something the settings card depends on: `llm-pi-ai`
   * declares the whole pi-ai provider catalog, which already claims the id
   * `opencode-go`, and a second declaration of the same id is refused. The card
   * therefore lives in the Models page's `settings.models.footer` seat, which
   * needs no directory row at all.
   * @returns the entry for `llm.registerConfigurableProviders`.
   */
  const directoryEntry = () => ({
    provider: routeId(),
    displayName: textOr(read().displayName, 'OpenCode Go'),
    settingsNs: NS,
    settingsPath: [],
  })

  /**
   * Announce the route on the Models settings page. A host without the seam, or
   * one where another plugin already declares this id (the standard case, with
   * `llm-pi-ai` mounted), still serves the route; only the directory row is not
   * ours, and the settings card does not depend on it.
   */
  let directory
  if (typeof ctx.llm.registerConfigurableProviders === 'function') {
    try {
      directory = ctx.llm.registerConfigurableProviders([directoryEntry()])
    } catch (error) {
      const alreadyDeclared = error?.code === 'DUPLICATE_DIRECTORY'
      const note = `llm-opencode-go: route "${routeId()}" keeps the configurable-provider entry another plugin declared (${String(error?.code ?? error)}); the provider works and its settings card renders in the Models page footer`
      if (alreadyDeclared) ctx.logger.info(note)
      else {
        ctx.logger.error(note)
        ctx.logger.error(error)
      }
    }
  } else {
    ctx.logger.warn(
      'llm-opencode-go: this harness has no configurable-provider seam; the route is not listed in the Models provider directory',
    )
  }

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

  ctx.effect(() => () => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  })

  schedule()

  /**
   * Rebuild everything derived from configuration after an in-place update.
   *
   * The editable fields are volatile, so a settings write commits into the
   * running Config instead of remounting this entry: `read()` already returns the
   * new values, but the catalog, the refresher, and the cached provider instance
   * were built from the old ones. Re-announcing the route is what makes a changed
   * model list reach the model picker, and the refresh is what makes a new
   * `refreshEpoch` — the card's "Refresh catalogue now" — do its work.
   */
  const resync = () => {
    build()
    schedule()
    try {
      registration.replace([routeId()])
    } catch (error) {
      ctx.logger.error('llm-opencode-go: could not re-announce the route after a settings change')
      ctx.logger.error(error)
      return
    }
    try {
      directory?.replace([directoryEntry()])
    } catch (error) {
      ctx.logger.error('llm-opencode-go: the provider directory entry could not follow the settings change')
      ctx.logger.error(error)
    }
    void refreshNow()
  }
  ctx.on('loader/volatile-update', () => resync())

  // Answer "which models can this provider serve?" for a configuration
  // surface editing this namespace; the local catalog answers first, so a
  // configured route costs no network call.
  //
  // The reply carries each model's effective capacities and modalities, not only
  // its id: what the settings card shows per model has to be what this route
  // would actually send, overrides included. It also lists **disabled** models
  // (`all()`, not `ids()`), because the card has to keep rendering the row the
  // user switched off — with its facts — while the picker, which reads
  // `listModels`, does not see it. `LlmDiscoveredModel` is the whole contract, so
  // an override may leave the protocol and the reasoning flag unstated and
  // inherit them here (see `mergeModel`).
  ctx.llm.registerModelDiscovery(NS, async (request, signal) => {
    if (request.provider === undefined || request.provider === routeId()) {
      const local = [...catalogView.all()].map(([id, model]) => ({
        id,
        ...(typeof model.name === 'string' ? { name: model.name } : {}),
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
        ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
        ...(Array.isArray(model.input) ? { inputModalities: [...model.input] } : {}),
      }))
      if (local.length > 0 && request.baseURL === undefined) return local
    }
    const ids = await fetchLiveModelIds({
      apiRoot: textOr(request.baseURL, textOr(read().apiRoot, DEFAULT_API_ROOT)),
      signal,
    })
    return ids.map((id) => ({ id }))
  })

  // From 0.1.7 the settings service projects the volatile part of every mounted
  // entry's Config into a namespace of its own, keyed by the entry id — the same
  // id this plugin's browser half addresses with `configForms.get(NS)`. Nothing
  // has to be installed.
  //
  // This plugin ships its own editor (the Models settings card), so it opts out
  // of a generated form; the policy changes no read or write.
  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx.settings.configure !== 'function') return
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'llm-opencode-go: settings page policy',
    )
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

  /**
   * Hand the subscription's own plan usage to the settings card.
   *
   * The page cannot read the key — the credentials remote deliberately reports
   * only "configured"/"writable" facts, and nothing here hands it a value — so
   * the one request that needs the key is made in this process and the card
   * reads the answer from an exact route on Connection's authenticated `/api`
   * channel (the sanctioned seam for plugin HTTP, and the reason a page that
   * was allowed to load at all may call it).
   *
   * `connection` is optional injection on purpose: a CLI deployment has no web
   * carrier, and the model route this plugin was mounted for must keep working
   * there. A deployment that never opens the page never calls the endpoint.
   */
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.get?.('connection') ?? connectionCtx.connection
    if (typeof connection?.fetch?.register !== 'function') return
    const noStore = { 'cache-control': 'no-store' }
    connectionCtx.effect(
      () =>
        connection.fetch.register({
          path: USAGE_ROUTE,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let key
            try {
              key = await resolveApiKey()
            } catch (error) {
              // A key the harness itself refuses is the same answer as no key:
              // the card must not report the provider's absence as a limit read.
              return Response.json(
                { error: { code: 'missing-key', message: String(error?.message ?? error) } },
                { status: 400, headers: noStore },
              )
            }
            if (key === undefined) {
              return Response.json(
                { error: { code: 'missing-key', message: `No API key is configured for ${apiKeyEnv()}.` } },
                { status: 400, headers: noStore },
              )
            }
            try {
              const usage = await fetchPlanUsage({
                apiRoot: textOr(read().apiRoot, DEFAULT_API_ROOT),
                apiKey: key,
                // The deployment's extra headers and the attribution user agent,
                // exactly as a model request carries them; no session header,
                // because a usage read is not part of a conversation.
                headers: sessionRequestHeaders(read(), undefined),
                timeoutMs: read().requestTimeoutMs,
                signal: request.signal,
              })
              return Response.json({ ...usage, fetchedAt: new Date().toISOString() }, { headers: noStore })
            } catch (error) {
              return Response.json(
                { error: { code: error?.code ?? 'usage-failed', message: String(error?.message ?? error) } },
                { status: error?.code === 'unauthorized' ? 401 : 502, headers: noStore },
              )
            }
          },
        }),
      `llm-opencode-go: GET ${USAGE_ROUTE}`,
    )
  })

  if (read().refreshOnMount !== false) void refreshNow()
}

// The settings card (dsh-llm-opencode-go-ui) writes `refreshEpoch` to ask for
// an immediate re-read of the live catalog.
