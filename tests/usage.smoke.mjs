/**
 * Usage smoke test: a fake OpenCode Go API root proves what the plan-usage read
 * actually sends and what it makes of the answers.
 *
 * Three failures are worth guarding here, because each one is silent in the UI:
 *
 *  - **The wrong path.** The endpoint this feature was asked for is
 *    `{root}/v1/usage`; the bare `{root}/usage` that is easy to write answers
 *    404 in production, and a 404 through this adapter would surface as an
 *    anonymous "could not read plan usage".
 *  - **A missing or leaked credential.** The read has to carry
 *    `Authorization: Bearer …` — and nothing else in the request may carry the
 *    key, because the reply is rendered in a browser panel.
 *  - **A reply shape read too optimistically.** `percent` is a share of one
 *    window's own allowance, so a window without a usable percentage must be
 *    dropped rather than drawn as 0% used.
 *
 * Run from an installed copy: node tests/usage.smoke.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchPlanUsage, readUsageWindows, usageUrl, USAGE_PATH, USAGE_ROUTE } from '../lib/usage.js'

const assertEqual = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label)
  console.log(`ok   ${label}`)
}

const ok = (condition, label) => {
  assert.ok(condition, label)
  console.log(`ok   ${label}`)
}

/** The three windows the live endpoint reports, as it reported them. */
const LIVE_REPLY = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-09-27T16:14:53.496Z' },
    weekly: { status: 'ok', percent: 40, resetsAt: '2026-09-28T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 59, resetsAt: '2026-10-12T12:22:06.000Z' },
  },
}

// ── the URL: the `/v1` segment is required, and a trailing root slash is not ──
assertEqual(usageUrl('https://opencode.ai/zen/go'), 'https://opencode.ai/zen/go/v1/usage', 'builds the /v1/usage URL')
assertEqual(usageUrl('https://opencode.ai/zen/go/'), 'https://opencode.ai/zen/go/v1/usage', 'a trailing root slash does not double')
assertEqual(USAGE_PATH, '/v1/usage', 'the path carries the /v1 segment the bare path 404s without')
ok(USAGE_ROUTE.startsWith('/api/'), 'the browser route lives on the authenticated API channel')

// ── the reply: windows in render order, percentages bounded, junk dropped ───
assertEqual(
  readUsageWindows(LIVE_REPLY).map((window) => [window.key, window.percent]),
  [
    ['rolling', 0],
    ['weekly', 40],
    ['monthly', 59],
  ],
  'reads the three windows in their documented order',
)
assertEqual(
  readUsageWindows({
    usage: {
      monthly: { status: 'exhausted', percent: 140, resetsAt: 'x' },
      daily: { status: 'ok', percent: 12, resetsAt: 'y' },
      rolling: { status: 'ok', percent: 5 },
    },
  }).map((window) => [window.key, window.percent, window.status]),
  [
    ['rolling', 5, 'ok'],
    ['monthly', 100, 'exhausted'],
    ['daily', 12, 'ok'],
  ],
  'bounds the percentage, keeps a status, and carries a window the card has no name for',
)
assertEqual(
  readUsageWindows({ usage: { weekly: { status: 'ok' }, rolling: { status: 'ok', percent: 3 } } }).map((w) => w.key),
  ['rolling'],
  'a window with no usable percentage is dropped rather than shown as unused',
)
assert.throws(
  () => readUsageWindows({}),
  /usage/,
  'a reply with no usage object is an error, not an empty plan',
)
console.log('ok   a reply with no usage object is an error, not an empty plan')

// ── the wire request, against a fake API root ───────────────────────────────
const seen = []
/** What the fake Go root answers next; the tests below change it. */
let reply = { status: 200, body: JSON.stringify(LIVE_REPLY), contentType: 'application/json' }
const server = createServer((req, res) => {
  seen.push({ url: req.url, headers: req.headers })
  res.writeHead(reply.status, { 'content-type': reply.contentType, 'cache-control': 'no-store' })
  res.end(reply.body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const apiRoot = `http://127.0.0.1:${server.address().port}`

const usage = await fetchPlanUsage({ apiRoot, apiKey: 'sk-usage-test' })
assertEqual(seen[0].url, '/v1/usage', 'the request goes to the /v1/usage path')
assertEqual(seen[0].headers.authorization, 'Bearer sk-usage-test', 'the credential travels as a bearer token')
assertEqual(seen[0].headers.accept, 'application/json', 'the request asks for JSON')
ok(
  String(seen[0].headers['user-agent'] ?? '').startsWith('deepseek-harness/'),
  'the attribution user agent goes with the read, as Go asks clients to identify themselves',
)
assertEqual(
  usage.windows.map((window) => [window.key, window.percent]),
  [
    ['rolling', 0],
    ['weekly', 40],
    ['monthly', 59],
  ],
  'the read returns the endpoint’s own windows',
)
assertEqual(usage.url, `${apiRoot}/v1/usage`, 'the read reports the URL it used for an error a user can act on')

// Extra deployment headers — the same ones model requests carry — are forwarded,
// and the credential still wins over anything configuration could name.
const withHeaders = await fetchPlanUsage({
  apiRoot,
  apiKey: 'sk-usage-test',
  headers: { 'x-deployment': 'test', authorization: 'Bearer configuration-value' },
})
ok(withHeaders.windows.length === 3, 'deployment headers do not disturb the read')
assertEqual(seen[1].headers['x-deployment'], 'test', 'deployment headers reach the endpoint')
assertEqual(seen[1].headers.authorization, 'Bearer sk-usage-test', 'configuration cannot replace the credential')

// ── failures are classified, because the card answers them differently ──────
const failureOf = async (options, next) => {
  reply = next
  try {
    await fetchPlanUsage({ apiRoot, apiKey: 'sk-usage-test', ...options })
    return undefined
  } catch (error) {
    return error
  }
}

const rejected = await failureOf({}, { status: 401, body: '{"error":{"message":"Unauthorized"}}', contentType: 'application/json' })
assertEqual(rejected?.code, 'unauthorized', 'a rejected key is reported as the key’s problem')
ok(/API key/.test(rejected.message), 'the message names the key rather than the endpoint')

const missing = await failureOf({}, { status: 404, body: '<!doctype html>', contentType: 'text/html' })
assertEqual(missing?.code, 'endpoint', 'a base URL without the endpoint is reported as the deployment’s problem')

const html = await failureOf({}, { status: 200, body: '<!doctype html>', contentType: 'text/html' })
assertEqual(html?.code, 'malformed', 'a 200 that is not JSON is its own failure, not a crash')

const unreachable = await failureOf({}, { status: 200, body: JSON.stringify(LIVE_REPLY), contentType: 'application/json' })
ok(unreachable === undefined, 'a live reply is parsed rather than reported as a failure')

// A port nothing listens on is the unreachable case.
const dead = await fetchPlanUsage({ apiRoot: 'http://127.0.0.1:1', apiKey: 'sk-usage-test' }).catch((error) => error)
assertEqual(dead?.code, 'unreachable', 'a refused connection is reported as unreachable')

// ── the timeout is this read's own, and it is honoured ──────────────────────
const slow = createServer((req, res) => {
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(LIVE_REPLY))
  }, 5000).unref?.()
})
await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve))
const timedOut = await fetchPlanUsage({
  apiRoot: `http://127.0.0.1:${slow.address().port}`,
  apiKey: 'sk-usage-test',
  timeoutMs: 50,
}).catch((error) => error)
assertEqual(timedOut?.code, 'unreachable', 'a stalled endpoint fails the read instead of hanging the panel')
ok(/timed out/.test(timedOut.message), 'the timeout says what happened')
slow.close()

server.close()
console.log('USAGE SMOKE OK')
