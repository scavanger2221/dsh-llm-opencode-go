/**
 * OpenCode Go plan usage — the subscription's own limits, read from the
 * provider rather than guessed from token counts.
 *
 * `GET {apiRoot}/v1/usage` answers with the three windows Go meters a
 * subscription by, as percentages of each window's own allowance:
 *
 * ~~~json
 * {"usage":{"rolling":{"status":"ok","percent":0,"resetsAt":"…"},
 *           "weekly":{"status":"ok","percent":40,"resetsAt":"…"},
 *           "monthly":{"status":"ok","percent":59,"resetsAt":"…"}}}
 * ~~~
 *
 * The path shape matters: the bare `{apiRoot}/usage` this endpoint is often
 * quoted as answers 404 — the `/v1` segment is required. The key travels in an
 * `Authorization: Bearer` header, and the same attribution user agent the model
 * requests carry goes with it, because Go asks clients to identify themselves.
 *
 * This module never sees a credential: the caller resolves one through the
 * harness credential seam and passes it in. Nothing here writes it anywhere, so
 * an error message cannot leak it either — the only URL a message names is the
 * endpoint's, which is not a secret.
 *
 * @module dsh-llm-opencode-go/usage
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'

/** Path the usage endpoint hangs off the Go API root at. */
export const USAGE_PATH = '/v1/usage'

/**
 * This host's own route, on Connection's authenticated `/api` channel, that the
 * settings card reads. The browser cannot call Go itself: the key lives behind
 * the credential seam and is never handed to the page.
 */
export const USAGE_ROUTE = '/api/opencode-go/usage'

/**
 * The three windows Go meters, in the order the card renders them and the order
 * the endpoint reports them. The API's own keys are the contract here: the card
 * labels them `rolling` (5-hour), `weekly`, and `monthly`.
 */
export const USAGE_WINDOWS = ['rolling', 'weekly', 'monthly']

const DEFAULT_TIMEOUT_MS = 15000

/**
 * The usage endpoint for one Go API root.
 *
 * The root is the same value the adapter builds its protocol paths from, so a
 * deployment pointing `apiRoot` at a proxy reads that proxy's usage endpoint.
 * A trailing slash would produce `//v1/usage`, which some proxies reject.
 * @param apiRoot - the configured Go root.
 * @returns the absolute usage URL.
 */
export function usageUrl(apiRoot) {
  return `${String(apiRoot ?? '').replace(/\/+$/, '')}${USAGE_PATH}`
}

/**
 * One window as the card renders it. `percent` is a share of that window's own
 * allowance, so the three rows are not comparable to each other; a window the
 * endpoint reports without a usable percentage is dropped rather than drawn as
 * zero, which would read as "nothing used".
 * @param key - the endpoint's window key.
 * @param raw - the endpoint's window object.
 * @returns the normalized window, or undefined when it carries no percentage.
 */
function windowOf(key, raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const percent = Number(raw.percent)
  if (!Number.isFinite(percent)) return undefined
  return {
    key,
    status: typeof raw.status === 'string' && raw.status.length > 0 ? raw.status : 'ok',
    percent: Math.min(100, Math.max(0, percent)),
    ...(typeof raw.resetsAt === 'string' && raw.resetsAt.length > 0 ? { resetsAt: raw.resetsAt } : {}),
  }
}

/**
 * Project one usage reply into the windows this UI draws.
 *
 * The three known keys come first in their documented order; a window the
 * endpoint adds later is still carried through, so a new limit shows up as a
 * row with its raw key instead of being silently dropped. A reply with no
 * window at all is an error, not an empty panel: "no usage" and "nothing
 * reported" are different answers and only one of them is good news.
 * @param body - the parsed JSON reply.
 * @returns the windows, in render order.
 */
export function readUsageWindows(body) {
  const usage = body?.usage
  if (usage === null || typeof usage !== 'object') {
    throw new Error('the usage endpoint answered without a `usage` object')
  }
  const windows = []
  const keys = [...USAGE_WINDOWS, ...Object.keys(usage).filter((key) => !USAGE_WINDOWS.includes(key))]
  for (const key of keys) {
    const window = windowOf(key, usage[key])
    if (window !== undefined) windows.push(window)
  }
  if (windows.length === 0) throw new Error('the usage endpoint reported no readable window')
  return windows
}

/**
 * Read the plan usage behind one API key.
 *
 * Every failure is classified, because the card answers them differently: a
 * rejected key is the user's to fix, a missing endpoint is the deployment's,
 * and neither should be reported as the other.
 * @param options - the Go root, the resolved API key, extra headers, timeout and cancellation.
 * @returns the endpoint URL and the normalized windows.
 * @throws an Error whose `code` is `unauthorized`, `endpoint`, `unreachable`, or `malformed`.
 */
export async function fetchPlanUsage(options) {
  const url = usageUrl(options.apiRoot)
  const controller = new AbortController()
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  timer.unref?.()
  const signal =
    options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])
  const headers = {
    accept: 'application/json',
    ...attributionHeaders(),
    ...(options.headers ?? {}),
    // Last, and never from configuration: the credential is this request's own.
    authorization: `Bearer ${options.apiKey}`,
  }
  try {
    let response
    try {
      response = await fetch(url, { method: 'GET', headers, signal })
    } catch (error) {
      const failure = new Error(`could not reach ${url} (${String(error?.message ?? error)})`)
      failure.code = 'unreachable'
      throw failure
    }
    if (!response.ok) {
      const failure = new Error(
        response.status === 401 || response.status === 403
          ? `OpenCode Go rejected the API key (HTTP ${response.status})`
          : `${url} answered HTTP ${response.status}`,
      )
      failure.code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'endpoint'
      failure.status = response.status
      throw failure
    }
    let body
    try {
      body = await response.json()
    } catch {
      const failure = new Error(`${url} did not answer with JSON`)
      failure.code = 'malformed'
      throw failure
    }
    return { url, windows: readUsageWindows(body) }
  } finally {
    clearTimeout(timer)
  }
}
