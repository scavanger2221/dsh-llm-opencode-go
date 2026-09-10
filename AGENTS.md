# AGENTS.md

Agent-facing contract for this repository. Read it before changing anything.

## What this repository is

One DeepSeek Harness plugin, published as one package, in two halves:

- `lib/index.js` + `lib/adapter.js` + `lib/catalog.js` + `lib/refresh.js` +
  `lib/convert.js` — the host half: the `opencode-go` LLM route.
- `lib/client.js` — the browser half: the Settings → Plugins card.
- `cordis.patch.yml` — the bundle layer that mounts the single row which carries
  both halves (`dsh.bundle` + `dsh.client` in `package.json`).

**There is no build step.** `lib/` is the source, committed as-is, which is what
makes a GitHub installation work without a build-script allowlist. Do not add a
bundler, and do not generate `lib/` from anywhere else.

## Rules that are easy to get wrong

- **The client bundle is hand-written in the module-system format.** It must keep
  the `window.__ModuleLoader__.load({ id: '<package name>', factory })` wrapper,
  the `id` equal to the package name, and `exports.apply` + `exports.inject` on
  the returned object. It may `require` only the shell's static module table
  (`react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`, …) plus
  its own files. Cross-plugin imports are forbidden: collaborate through cordis
  services (`exports.inject`) instead.
- **Every provider request carries the session headers.** `x-opencode-session` and
  `x-deepseek-harness-session-id` come from `GenerateOptions.sessionId`; Go
  refuses a request without them (`400 MissingSessionID`). The attribution headers
  from `attributionHeaders()` are mandatory and must not be overridable by
  deployment config.
- **Do not put a secret in a settings field.** The API key goes through the
  credentials service (`ctx.credentials.resolve(apiKeyEnv)`); settings fields are
  the endpoint, refresh policy, and model overrides. The `OPENCODE_GO_API_KEY`
  reference exists because an exported environment variable shadows the managed
  credential store.
- **A symlinked checkout cannot be installed where it stands.** Node resolves a
  symlinked package to its real path, so the imports inside this plugin walk up
  from the checkout and fail. Install by copying into the profile tree
  (`scripts/install-local.sh`) or from GitHub.
- **Never hand-edit an installed copy** under `$DSH_HOME/profiles/*/plugins/`.
  Change this repository, then reinstall and restart.

## Tests

There is no install step and this repository is not a package-manager project.
Run the tests from an installed copy, where the harness packages resolve through
the profile's module fallback:

~~~sh
cd "$DSH_HOME/profiles/web/plugins/dsh-llm-opencode-go"   # after installing
node tests/adapter.smoke.mjs && node tests/card.smoke.mjs
~~~

A checkout placed inside the profile tree runs them in place.

**Never link `node_modules` at `$DSH_HOME/profiles/node_modules`.** That directory
is the shared module fallback every profile resolves through; pnpm follows the
link and rewrites it with npm-published package versions, which silently breaks
the installed harness (a real incident: `@deepseek-ai/dsh-brand` from npm does not
export `brandString`, so the host half stopped importing). If the fallback is ever
clobbered, rebuild it from the installation — `--dump-config` does not heal, only
a real boot does:

~~~sh
INSTALL="$(npm root -g)/@deepseek-ai/dsh"
node --input-type=module -e "
import { healProfilesModuleFallback } from '$INSTALL/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'
await healProfilesModuleFallback({ installAnchor: '$INSTALL/package.json', home: '$HOME/.dsh' })
"
~~~

`tests/adapter.smoke.mjs` drives a fake HTTP endpoint and asserts the wire request
and the conversion contracts; `tests/card.smoke.mjs` loads the real browser bundle
under a stub module system and drives the card's interactions. Both must pass
before a change is done — the card test in particular catches hook and
registration-shape mistakes that a syntax check cannot.

## Documentation

`README.md` and `README.zh.md` are a pair, as are the ADRs under `docs/adr/`
(`*.md` and `*.zh.md`). A behaviour change updates `CHANGELOG.md`; a decision
change adds an ADR rather than rewriting an old one.
