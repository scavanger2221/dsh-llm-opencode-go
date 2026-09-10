/**
 * OpenCode Go settings card (browser half of this package).
 *
 * The harness's Settings → Models page only knows how to edit the two provider
 * namespaces it ships layouts for (`llm-deepseek`, `llm-pi-ai`); a provider a
 * deployment adds itself renders there as a row with no editor. The documented
 * extension point for such a provider is this file: a card registered into the
 * `settings.plugin.item` slot under the provider's own settings namespace, which
 * the Plugins page dispatches by namespace alone.
 *
 * The card edits the `llm-opencode-go` namespace through the shared settings
 * scope, and manages the credential the route resolves (`apiKeyEnv`) through the
 * credentials remote — so the key lands in `$DSH_HOME/.credentials.yaml` and
 * everything else in `$DSH_HOME/settings.yaml`, exactly as a hand edit would.
 *
 * Shape follows the cards the harness ships (Bash, Agent Loop, Web Search): a
 * collapsible header naming the plugin, staged edits with one Save, an "unsaved"
 * marker, and a footer that discards. Staging is not decoration — every settings
 * write is a durable, revision-fenced document mutation, so committing per
 * keystroke would turn one edit into writes the user never asked for.
 *
 * Loaded by the browser module system, not by Node: the factory-form wrapper is
 * the bundle protocol every client package uses, and the module id is this
 * package's name, which is how the client-module registry pairs the declaration
 * in package.json with the loader row that mounts the host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-llm-opencode-go',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    /**
     * The shell's static module table always carries these primitives, but a
     * missing one must not take the whole card down with it: the chrome has a
     * plain fallback for each.
     */
    let primitives = {}
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
    } catch {
      primitives = {}
    }
    const Chevron =
      primitives.IconChevronDownOutline14 ??
      ((props) => h('span', props, '▾'))
    const Tag =
      primitives.Tag ??
      ((props) => h('span', { className: props.className }, props.children))

    /** Settings namespace the provider plugin owns and serves. */
    const NS = 'llm-opencode-go'
    /** Default route id, used only for display and discovery requests. */
    const ROUTE = 'opencode-go'
    /** Credential reference assumed while the namespace has not answered yet. */
    const DEFAULT_KEY_REF = 'OPENCODE_GO_API_KEY'
    /** Protocols the adapter can carry. */
    const APIS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    /** Input modalities the harness vocabulary distinguishes. */
    const MODALITIES = ['text', 'image']
    const HOUR_MS = 60 * 60 * 1000

    /** Every string this card renders, in the two locales DSH ships. */
    const en = {
      title: 'OpenCode Go',
      description: 'API key, endpoint, refresh policy, and model overrides for the OpenCode Go provider.',
      expand: 'Show settings',
      collapse: 'Hide settings',
      unsaved: 'Unsaved',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      unavailable: 'This deployment does not serve the llm-opencode-go settings namespace.',
      loading: 'Loading…',
      readOnly: 'The settings document is read-only in this deployment.',
      keyLabel: 'API key',
      keyRef: 'Read from {ref}',
      keyConfigured: 'Configured',
      keyMissing: 'Missing',
      keyEnvLocked: 'Provided by the launch environment (read-only)',
      keyPlaceholder: 'Enter your API key',
      keyStored: 'Configured — enter a new value to replace',
      keyRemove: 'Remove key',
      endpointLabel: 'Base URL',
      endpointHint: 'Go root; the adapter appends the protocol path itself.',
      intervalLabel: 'Automatic refresh',
      intervalHint: 'Hours between refreshes. 0 disables the timer; the catalog is still read on start.',
      hours: 'h',
      intervalInvalid: 'The refresh interval must be zero or more hours.',
      endpointRequired: 'The base URL cannot be empty.',
      overridden: 'Overridden',
      reset: 'Reset',
      refreshNow: 'Refresh catalog now',
      refreshQueued: 'Refresh requested; the picker updates as soon as the endpoint answers.',
      refreshRestart: 'One-click refresh needs the provider plugin restarted: this process loaded it before the field existed. Restart dsh web once.',
      catalogTitle: 'Advertised models',
      catalogLocal: '{count} models in the live catalog.',
      catalogLive: '{count} models advertised by the endpoint.',
      queryEndpoint: 'Query the endpoint',
      querying: 'Querying…',
      showIds: 'Show IDs',
      hideIds: 'Hide IDs',
      pickId: 'Use this ID',
      modelsTitle: 'Your models',
      modelsHint: 'Merged over the built-in catalog. Use an entry to add a model the endpoint advertises but the plugin does not know, or to correct its protocol, capacities, reasoning, and allowed input.',
      modelsEmpty: 'No overrides — the built-in catalog is used as it is.',
      addModel: 'Add model',
      editModel: 'Edit',
      deleteModel: 'Delete',
      applyModel: 'Apply to list',
      cancel: 'Cancel',
      idLabel: 'Model ID',
      nameLabel: 'Display name',
      nameHint: 'optional',
      apiLabel: 'Protocol',
      contextLabel: 'Context window',
      outputLabel: 'Max output tokens',
      capacityHint: 'e.g. 131072, 256K, 1M',
      reasoningLabel: 'Reasoning',
      reasoningHint: 'Offer the harness thinking levels for this model. Turn it off for a model that streams no reasoning.',
      inputLabel: 'Allowed input',
      inputHint: 'What this model accepts. A prompt carrying an image is refused before the request when the model does not list images.',
      inputText: 'Text',
      inputImage: 'Images',
      idRequired: 'A model ID is required.',
      idDuplicate: 'Each model ID may appear once.',
      capacityInvalid: 'Capacities are positive counts like 131072, 256K, or 1M.',
      saved: 'Saved.',
      failed: 'Failed: {message}',
      advancedHint: 'Headers, session-header names, image budgets, timeouts, and the metadata source stay in settings.yaml under llm-opencode-go.',
    }
    const zh = {
      title: 'OpenCode Go',
      description: 'OpenCode Go 提供方的 API 密钥、端点、刷新策略与模型覆盖项。',
      expand: '展开设置',
      collapse: '收起设置',
      unsaved: '未保存',
      save: '保存',
      saving: '保存中…',
      discard: '放弃',
      unavailable: '此部署没有提供 llm-opencode-go 设置命名空间。',
      loading: '加载中…',
      readOnly: '此部署中的设置文档为只读。',
      keyLabel: 'API 密钥',
      keyRef: '读取自 {ref}',
      keyConfigured: '已配置',
      keyMissing: '缺失',
      keyEnvLocked: '由启动环境提供（只读）',
      keyPlaceholder: '输入你的 API 密钥',
      keyStored: '已配置 — 输入新值即可替换',
      keyRemove: '移除密钥',
      endpointLabel: '基础 URL',
      endpointHint: 'Go 根地址，协议路径由适配器自行拼接。',
      intervalLabel: '自动刷新',
      intervalHint: '两次刷新之间的小时数。0 表示关闭定时器；启动时仍会读取一次。',
      hours: '小时',
      intervalInvalid: '刷新间隔必须为 0 或更多小时。',
      endpointRequired: '基础 URL 不能为空。',
      overridden: '已覆盖',
      reset: '重置',
      refreshNow: '立即刷新目录',
      refreshQueued: '已请求刷新；端点返回后选择器即会更新。',
      refreshRestart: '一键刷新需要提供方插件重新加载：当前进程在 refreshEpoch 出现之前就已加载它。请重启一次 dsh web。',
      catalogTitle: '端点提供的模型',
      catalogLocal: '本地目录中有 {count} 个模型。',
      catalogLive: '端点提供 {count} 个模型。',
      queryEndpoint: '查询端点',
      querying: '查询中…',
      showIds: '显示 ID',
      hideIds: '隐藏 ID',
      pickId: '使用该 ID',
      modelsTitle: '你的模型',
      modelsHint: '叠加在内置目录之上。用于补充端点已提供但插件尚不认识的模型，或修正其协议、容量、推理与允许的输入。',
      modelsEmpty: '没有覆盖项 — 直接使用内置目录。',
      addModel: '添加模型',
      editModel: '编辑',
      deleteModel: '删除',
      applyModel: '加入列表',
      cancel: '取消',
      idLabel: '模型 ID',
      nameLabel: '显示名称',
      nameHint: '可选',
      apiLabel: '协议',
      contextLabel: '上下文窗口',
      outputLabel: '最大输出 token',
      capacityHint: '例如 131072、256K、1M',
      reasoningLabel: '推理',
      reasoningHint: '为该模型提供 harness 的思考等级。对不输出推理内容的模型请关闭。',
      inputLabel: '允许的输入',
      inputHint: '该模型接受的模态。模型未列出图像时，携带图像的提示会在请求发出前被拒绝。',
      inputText: '文本',
      inputImage: '图像',
      idRequired: '必须填写模型 ID。',
      idDuplicate: '每个模型 ID 只能出现一次。',
      capacityInvalid: '容量需为 131072、256K、1M 这样的正整数。',
      saved: '已保存。',
      failed: '失败：{message}',
      advancedHint: '请求头、会话头名称、图像预算、超时与元数据来源仍位于 settings.yaml 的 llm-opencode-go 段。',
    }

    /**
     * The card's stylesheet: the chrome mirrors the shipped plugin cards so this
     * one sits in the list without looking foreign, and the rest uses the same
     * theme aliases those cards use.
     */
    const CSS = [
      '.ogcCard{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}',
      '.ogcCard:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.ogcCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.ogcHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
      '.ogcHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.ogcHeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
      '.ogcName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.ogcDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.ogcChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.ogcChevronOpen{transform:rotate(180deg)}',
      '.ogcPending{flex:none}',
      '.ogcBody{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.ogcReadOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}',
      '.ogcFooter{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
      '.ogcFailed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
      '.ogcSaved{min-width:0;color:var(--dsw-alias-state-success-primary);flex:1;margin:0;font-size:12px;line-height:1.5}',
      '.ogcDiscard,.ogcSave{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
      '.ogcDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
      '.ogcDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.ogcSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.ogcDiscard:disabled,.ogcSave:disabled{opacity:.4;cursor:default}',
      '.ogcDiscard:focus-visible,.ogcSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.ogcField{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
      '.ogcField+.ogcField{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.ogcFieldHead{align-items:center;gap:8px;display:flex}',
      '.ogcLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}',
      '.ogcBadges{align-items:center;gap:8px;display:inline-flex}',
      '.ogcReset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
      '.ogcReset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.ogcReset:disabled{cursor:default}',
      '.ogcInput{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box}',
      '.ogcInput:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.ogcInput:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.ogcSelect{appearance:none;cursor:pointer}',
      '.ogcGrow{flex:1;min-width:0}',
      '.ogcRow{align-items:center;gap:8px;display:flex;flex-wrap:wrap}',
      '.ogcAction{appearance:none;font:inherit;font-size:12px;line-height:1.5;cursor:pointer;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:3px 10px;background:0 0;color:var(--dsw-alias-label-secondary)}',
      '.ogcAction:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.ogcAction:disabled{opacity:.4;cursor:default}',
      '.ogcHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.ogcInvalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}',
      '.ogcDot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}',
      '.ogcDotOn{background:var(--dsw-alias-state-success-primary)}',
      '.ogcDotOff{background:var(--dsw-alias-state-error-primary)}',
      '.ogcChips{display:flex;flex-wrap:wrap;gap:4px;max-height:132px;overflow-y:auto}',
      '.ogcChip{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;padding:2px 8px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.ogcChip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ogcList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}',
      '.ogcItem{display:flex;align-items:center;gap:8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;padding:6px 8px}',
      '.ogcMono{font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.ogcMeta{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.ogcGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}',
      '.ogcCheck{align-items:center;gap:6px;display:inline-flex;font-size:12px;color:var(--dsw-alias-label-secondary)}',
    ].join('')

    /** Add this card's stylesheet once, returning the disposer that removes it. */
    function injectStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-llm-opencode-go-ui'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /** Read a settings scope's current snapshot. */
    function readScope(scope) {
      return scope.getSnapshot()
    }

    /** Read a local store's current state. */
    function readStore(store) {
      return store.get()
    }

    /**
     * `useSyncExternalStore` over one live source: a settings scope, whose read
     * is `getSnapshot`, or a local store, whose read is `get`.
     * @param source - the scope or store to follow.
     * @param read - its snapshot reader.
     * @returns the current snapshot.
     */
    function useStore(source, read) {
      const subscribe = React.useMemo(() => (listener) => source.subscribe(listener), [source])
      const getSnapshot = React.useMemo(() => () => read(source), [source, read])
      return React.useSyncExternalStore(subscribe, getSnapshot)
    }

    /** Parse `131072`, `256K`, or `1M` into a count, or undefined. */
    function parseCount(text) {
      const match = /^\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/i.exec(String(text ?? ''))
      if (match === null) return undefined
      const base = Number(match[1])
      if (!Number.isFinite(base) || base <= 0) return undefined
      const suffix = (match[2] ?? '').toLowerCase()
      return Math.round(suffix === 'k' ? base * 1024 : suffix === 'm' ? base * 1024 * 1024 : base)
    }

    /** Render a count for an input, or the empty string when unset. */
    function countText(value) {
      return typeof value === 'number' && value > 0 ? String(value) : ''
    }

    /** Whether the stored user layer overrides one field. */
    function overridden(user, field) {
      return user !== null && typeof user === 'object' && Object.hasOwn(user, field)
    }

    /** Hours as an input string, trimmed of float noise. */
    function hoursText(milliseconds) {
      const hours = (typeof milliseconds === 'number' ? milliseconds : 0) / HOUR_MS
      return String(Math.round(hours * 1000) / 1000)
    }

    /** One model override in the shape the card edits. */
    function modelDraftOf(entry) {
      return {
        id: typeof entry?.id === 'string' ? entry.id : '',
        name: typeof entry?.name === 'string' ? entry.name : '',
        api: APIS.includes(entry?.api) ? entry.api : APIS[0],
        contextWindow: countText(entry?.contextWindow),
        maxTokens: countText(entry?.maxTokens),
        reasoning: entry?.reasoning === true,
        input: Array.isArray(entry?.input)
          ? MODALITIES.filter((modality) => entry.input.includes(modality))
          : [],
      }
    }

    /** A blank model draft. */
    function emptyModelDraft() {
      return { id: '', name: '', api: APIS[0], contextWindow: '', maxTokens: '', reasoning: false, input: [] }
    }

    /**
     * The section as the card edits it: every field a string or a draft list, so
     * a form comparison and a form render both stay trivial.
     * @param value - the resolved settings section.
     * @returns the draft-shaped baseline.
     */
    function projectSection(value) {
      const models = Array.isArray(value?.models) ? value.models : []
      return {
        apiRoot: typeof value?.apiRoot === 'string' ? value.apiRoot : '',
        hours: hoursText(value?.refreshIntervalMs),
        models: models.map(modelDraftOf),
      }
    }

    /**
     * The one canonical form of a model entry, used both to compare a draft with
     * what is stored and to emit the write. Comparing drafts against stored
     * sections directly would report a difference for every field the schema
     * leaves implicit (`api`, an absent `input`).
     * @param draft - a model draft.
     * @returns the entry as the settings document would carry it.
     */
    function canonicalModel(draft) {
      const id = draft.id.trim()
      const contextWindow = draft.contextWindow.trim() === '' ? undefined : parseCount(draft.contextWindow)
      const maxTokens = draft.maxTokens.trim() === '' ? undefined : parseCount(draft.maxTokens)
      const name = draft.name.trim()
      return {
        id,
        ...(name === '' ? {} : { name }),
        api: draft.api,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        reasoning: draft.reasoning,
        // Text is the baseline the schema itself defaults to; the choice the
        // user makes here is whether images join it.
        input: draft.input.includes('image') ? ['text', 'image'] : ['text'],
      }
    }

    /** The canonical entries a stored section carries. */
    function canonicalStoredModels(value) {
      const models = Array.isArray(value?.models) ? value.models : []
      return models.map((entry) => canonicalModel(modelDraftOf(entry)))
    }

    /**
     * The credential half of the card: describe/set/unset one reference over the
     * credentials remote, with the last answer published to the component.
     * @param ctx - the browser plugin context.
     * @returns the store the card reads and writes through.
     */
    function createCredentialStore(ctx) {
      let state = { ref: undefined, status: 'idle', snapshot: undefined, error: undefined }
      let generation = 0
      const listeners = new Set()
      const publish = (next) => {
        state = next
        for (const listener of listeners) listener()
      }
      const load = async (ref) => {
        const current = ++generation
        try {
          const response = await ctx.remote.credentials.describe([ref])
          if (current !== generation) return
          publish(
            response.ok
              ? { ref, status: 'ready', snapshot: response.value?.[ref], error: undefined }
              : { ref, status: 'ready', snapshot: undefined, error: response.error?.message },
          )
        } catch (error) {
          if (current === generation) {
            publish({ ref, status: 'ready', snapshot: undefined, error: String(error) })
          }
        }
      }
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        get() {
          return state
        },
        /** Describe the reference unless its answer is already current. */
        ensure(ref) {
          if (state.ref === ref && state.status === 'ready') return
          state = { ...state, ref, status: 'loading' }
          for (const listener of listeners) listener()
          void load(ref)
        },
        /** Re-describe after an external credential change. */
        reload() {
          if (state.ref !== undefined) void load(state.ref)
        },
        async set(ref, value) {
          const response = await ctx.remote.credentials.set(ref, value)
          if (!response.ok) throw new Error(response.error?.message ?? 'credentials/set failed')
          await load(ref)
        },
        async unset(ref) {
          const response = await ctx.remote.credentials.unset(ref)
          if (!response.ok) throw new Error(response.error?.message ?? 'credentials/unset failed')
          await load(ref)
        },
      }
    }

    /** The card. Props arrive from its own slot `inject`. */
    function OpenCodeGoCard(props) {
      const { scope, credentials, discover, t } = props
      const snap = useStore(scope, readScope)
      const cred = useStore(credentials, readStore)
      const value = snap.value ?? {}
      const writable = snap.writable === true
      const stored = projectSection(value)
      const base = projectSection(snap.base)
      const keyRef =
        typeof value.apiKeyEnv === 'string' && value.apiKeyEnv.length > 0 ? value.apiKeyEnv : DEFAULT_KEY_REF
      // The provider plugin spells the refresh trigger in its own schema, so its
      // presence is what tells this card the host can honour the button.
      const canRefresh = Object.hasOwn(value, 'refreshEpoch')
      const keyConfigured = cred.snapshot?.configured === true
      const keyLocked = cred.snapshot !== undefined && cred.snapshot.writable === false

      const [open, setOpen] = React.useState(false)
      /** Staged edits; undefined means the form follows the stored section. */
      const [drafts, setDrafts] = React.useState(undefined)
      const [resetFields, setResetFields] = React.useState([])
      const [keyDraft, setKeyDraft] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [failure, setFailure] = React.useState(undefined)
      const [notice, setNotice] = React.useState(undefined)
      const [live, setLive] = React.useState({ status: 'idle', ids: [], source: 'local' })
      const [showIds, setShowIds] = React.useState(false)
      const [editor, setEditor] = React.useState(undefined)
      const alive = React.useRef(true)

      React.useEffect(
        () => () => {
          alive.current = false
        },
        [],
      )
      React.useEffect(() => {
        credentials.ensure(keyRef)
      }, [credentials, keyRef])
      React.useEffect(() => {
        let cancelled = false
        discover({ provider: ROUTE })
          .then((models) => {
            if (!cancelled) {
              setLive({ status: 'ready', ids: models.map((model) => model.id), source: 'local' })
            }
          })
          .catch((error) => {
            if (!cancelled) setLive({ status: 'error', ids: [], source: 'local', error: String(error) })
          })
        return () => {
          cancelled = true
        }
      }, [discover])

      const current = drafts ?? stored
      const dirty =
        resetFields.length > 0 ||
        keyDraft.trim() !== '' ||
        (drafts !== undefined && JSON.stringify(drafts) !== JSON.stringify(stored))

      /** Replace staged fields, materializing the draft from what is stored. */
      const patch = (changes) => {
        setDrafts({ ...current, ...changes })
      }

      /** Edit one field, dropping any pending reset of it. */
      const editField = (field, changes) => {
        setResetFields((fields) => fields.filter((name) => name !== field))
        patch(changes)
      }

      /** Ask for one field to fall back to the composition layer on save. */
      const resetField = (field) => {
        setResetFields((fields) => (fields.includes(field) ? fields : [...fields, field]))
        patch({ [field]: base[field] })
      }

      /**
       * The write this save would perform: one credential set plus one settings
       * mutation, or the message explaining why it cannot run.
       * @returns the planned operations, or the validation failure.
       */
      const buildPlan = () => {
        const ops = []
        const wantsReset = (field) => resetFields.includes(field) && overridden(snap.user, field)

        const models = []
        for (const draft of current.models) {
          const id = draft.id.trim()
          if (id === '') return { error: t('idRequired') }
          if (models.some((entry) => entry.id === id)) return { error: t('idDuplicate') }
          if (draft.contextWindow.trim() !== '' && parseCount(draft.contextWindow) === undefined) {
            return { error: t('capacityInvalid') }
          }
          if (draft.maxTokens.trim() !== '' && parseCount(draft.maxTokens) === undefined) {
            return { error: t('capacityInvalid') }
          }
          models.push(canonicalModel(draft))
        }
        if (wantsReset('models')) ops.push({ op: 'unset', path: ['models'] })
        else if (models.length === 0) {
          if (overridden(snap.user, 'models')) ops.push({ op: 'unset', path: ['models'] })
        } else if (JSON.stringify(models) !== JSON.stringify(canonicalStoredModels(value))) {
          ops.push({ op: 'set', path: ['models'], value: models })
        }

        const endpoint = current.apiRoot.trim()
        if (wantsReset('apiRoot')) ops.push({ op: 'unset', path: ['apiRoot'] })
        else if (endpoint === '') return { error: t('endpointRequired') }
        else if (endpoint !== stored.apiRoot) ops.push({ op: 'set', path: ['apiRoot'], value: endpoint })

        const hours = Number(current.hours)
        if (wantsReset('refreshIntervalMs')) ops.push({ op: 'unset', path: ['refreshIntervalMs'] })
        else if (current.hours.trim() === '' || !Number.isFinite(hours) || hours < 0) {
          return { error: t('intervalInvalid') }
        } else if (Math.round(hours * HOUR_MS) !== (typeof value.refreshIntervalMs === 'number' ? value.refreshIntervalMs : 0)) {
          ops.push({ op: 'set', path: ['refreshIntervalMs'], value: Math.round(hours * HOUR_MS) })
        }

        return { ops }
      }

      const plan = buildPlan()
      const blocked = !writable || busy !== '' || plan.error !== undefined

      /** Write the credential and the staged settings in one save. */
      const save = async () => {
        if (plan.error !== undefined) {
          setFailure(plan.error)
          return
        }
        setBusy('save')
        setFailure(undefined)
        setNotice(undefined)
        try {
          const key = keyDraft.trim()
          if (key !== '') await credentials.set(keyRef, key)
          if (plan.ops.length > 0) await scope.mutate(plan.ops, snap.revision)
          if (!alive.current) return
          setDrafts(undefined)
          setResetFields([])
          setKeyDraft('')
          setEditor(undefined)
          setNotice({ kind: 'ok', text: t('saved') })
          setOpen(false)
        } catch (error) {
          if (alive.current) {
            setFailure(t('failed').replace('{message}', String(error?.message ?? error)))
          }
        } finally {
          if (alive.current) setBusy('')
        }
      }

      /** Drop every staged edit. */
      const discard = () => {
        setDrafts(undefined)
        setResetFields([])
        setKeyDraft('')
        setEditor(undefined)
        setFailure(undefined)
        setNotice(undefined)
      }

      /** Run one immediate action (credential removal, catalog refresh). */
      const runNow = async (key, work, ok) => {
        setBusy(key)
        setFailure(undefined)
        setNotice(undefined)
        try {
          await work()
          if (alive.current) setNotice(ok)
        } catch (error) {
          if (alive.current) {
            setFailure(t('failed').replace('{message}', String(error?.message ?? error)))
          }
        } finally {
          if (alive.current) setBusy('')
        }
      }

      /** Interrogate the endpoint itself, catching a model Go added today. */
      const queryEndpoint = async () => {
        setBusy('endpoint')
        setFailure(undefined)
        setNotice(undefined)
        try {
          const models = await discover({ provider: ROUTE, baseURL: stored.apiRoot })
          if (alive.current) {
            setLive({ status: 'ready', ids: models.map((model) => model.id), source: 'endpoint' })
          }
        } catch (error) {
          if (alive.current) {
            setFailure(t('failed').replace('{message}', String(error?.message ?? error)))
          }
        } finally {
          if (alive.current) setBusy('')
        }
      }

      if (snap.status === 'unavailable') {
        // A deployment that does not compose the provider shows no trace of it.
        return null
      }

      const field = (name, label, hint, control, extra) =>
        h(
          'div',
          { className: 'ogcField', key: name },
          h(
            'div',
            { className: 'ogcFieldHead' },
            h('span', { className: 'ogcLabel' }, label),
            resetFields.includes(name)
              ? h('span', { className: 'ogcBadges' }, h(Tag, { tone: 'neutral' }, t('reset')))
              : overridden(snap.user, name)
                ? h('span', { className: 'ogcBadges' }, h(Tag, { tone: 'neutral' }, t('overridden')))
                : null,
            overridden(snap.user, name) || resetFields.includes(name)
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'ogcReset',
                    disabled: !writable || busy !== '',
                    onClick: () => resetField(name),
                  },
                  t('reset'),
                )
              : null,
          ),
          control,
          hint === undefined ? null : h('p', { className: 'ogcHint' }, hint),
          extra ?? null,
        )

      const keyField = h(
        'div',
        { className: 'ogcField', key: 'key' },
        h(
          'div',
          { className: 'ogcFieldHead' },
          h('span', { className: 'ogcLabel' }, t('keyLabel')),
          h('span', { className: keyConfigured ? 'ogcDot ogcDotOn' : 'ogcDot ogcDotOff' }),
          h(
            'span',
            { className: 'ogcMeta' },
            `${keyConfigured ? t('keyConfigured') : t('keyMissing')} · ${t('keyRef').replace('{ref}', keyRef)}`,
          ),
          keyConfigured
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'ogcReset',
                  disabled: !writable || busy !== '' || keyLocked,
                  onClick: () =>
                    void runNow('unset', () => credentials.unset(keyRef), { kind: 'ok', text: t('saved') }),
                },
                t('keyRemove'),
              )
            : null,
        ),
        h('input', {
          className: 'ogcInput',
          type: 'password',
          autoComplete: 'off',
          value: keyDraft,
          placeholder: keyLocked ? t('keyEnvLocked') : keyConfigured ? t('keyStored') : t('keyPlaceholder'),
          disabled: !writable || keyLocked,
          'aria-label': t('keyLabel'),
          onChange: (event) => setKeyDraft(event.target.value),
        }),
      )

      const catalogBlock = h(
        'div',
        { className: 'ogcField', key: 'catalog' },
        h('div', { className: 'ogcFieldHead' }, h('span', { className: 'ogcLabel' }, t('catalogTitle'))),
        h(
          'p',
          { className: 'ogcHint' },
          live.status === 'ready'
            ? t(live.source === 'endpoint' ? 'catalogLive' : 'catalogLocal').replace('{count}', String(live.ids.length))
            : live.status === 'error'
              ? t('failed').replace('{message}', String(live.error ?? ''))
              : t('loading'),
        ),
        h(
          'div',
          { className: 'ogcRow' },
          h(
            'button',
            {
              type: 'button',
              className: 'ogcAction',
              disabled: !writable || busy !== '',
              onClick: () => void queryEndpoint(),
            },
            busy === 'endpoint' ? t('querying') : t('queryEndpoint'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ogcAction',
              disabled: !writable || busy !== '' || !canRefresh,
              title: t('refreshQueued'),
              onClick: () => {
                // Guarded here too, not only by `disabled`: a host without the
                // field would refuse the write and show a raw validation error.
                if (canRefresh) {
                  void runNow('refresh', () => scope.set('refreshEpoch', Date.now()), {
                    kind: 'ok',
                    text: t('refreshQueued'),
                  })
                }
              },
            },
            t('refreshNow'),
          ),
          live.ids.length === 0
            ? null
            : h(
                'button',
                { type: 'button', className: 'ogcAction', onClick: () => setShowIds(!showIds) },
                showIds ? t('hideIds') : t('showIds'),
              ),
        ),
        canRefresh ? null : h('p', { className: 'ogcHint' }, t('refreshRestart')),
        showIds && live.ids.length > 0
          ? h(
              'div',
              { className: 'ogcChips' },
              live.ids.map((id) =>
                h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    className: 'ogcChip',
                    title: t('pickId'),
                    onClick: () =>
                      setEditor((editing) => ({
                        index: editing?.index ?? -1,
                        draft: { ...(editing?.draft ?? emptyModelDraft()), id },
                      })),
                  },
                  id,
                ),
              ),
            )
          : null,
      )

      /** One staged model override, with its display facts and actions. */
      const modelRow = (draft, index) =>
        h(
          'li',
          { className: 'ogcItem', key: `${draft.id}#${index}` },
          h('span', { className: 'ogcMono ogcGrow' }, draft.id === '' ? t('idRequired') : draft.id),
          h('span', { className: 'ogcMeta' }, draft.api),
          h('span', { className: 'ogcMeta' }, draft.contextWindow === '' ? '—' : draft.contextWindow),
          h('span', { className: 'ogcMeta' }, draft.reasoning ? t('reasoningLabel') : ''),
          h('span', { className: 'ogcMeta' }, draft.input.join('+')),
          h(
            'button',
            {
              type: 'button',
              className: 'ogcAction',
              disabled: !writable || busy !== '',
              onClick: () => setEditor({ index, draft: { ...draft } }),
            },
            t('editModel'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ogcAction',
              disabled: !writable || busy !== '',
              onClick: () =>
                editField('models', { models: current.models.filter((_, position) => position !== index) }),
            },
            t('deleteModel'),
          ),
        )

      /** The staged add/edit form for one override. */
      const modelEditor = () =>
        h(
          'div',
          { className: 'ogcField', key: 'editor' },
          h('div', { className: 'ogcGrid' },
            h('label', { className: 'ogcField' },
              h('span', { className: 'ogcMeta' }, t('idLabel')),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                value: editor.draft.id,
                disabled: !writable,
                onChange: (event) => setEditor({ ...editor, draft: { ...editor.draft, id: event.target.value } }),
              }),
            ),
            h('label', { className: 'ogcField' },
              h('span', { className: 'ogcMeta' }, `${t('nameLabel')} (${t('nameHint')})`),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                value: editor.draft.name,
                disabled: !writable,
                onChange: (event) => setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } }),
              }),
            ),
            h('label', { className: 'ogcField' },
              h('span', { className: 'ogcMeta' }, t('apiLabel')),
              h(
                'select',
                {
                  className: 'ogcInput ogcSelect',
                  value: editor.draft.api,
                  disabled: !writable,
                  onChange: (event) => setEditor({ ...editor, draft: { ...editor.draft, api: event.target.value } }),
                },
                APIS.map((api) => h('option', { key: api, value: api }, api)),
              ),
            ),
            h('label', { className: 'ogcField' },
              h('span', { className: 'ogcMeta' }, t('contextLabel')),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                placeholder: t('capacityHint'),
                value: editor.draft.contextWindow,
                disabled: !writable,
                onChange: (event) =>
                  setEditor({ ...editor, draft: { ...editor.draft, contextWindow: event.target.value } }),
              }),
            ),
            h('label', { className: 'ogcField' },
              h('span', { className: 'ogcMeta' }, t('outputLabel')),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                placeholder: t('capacityHint'),
                value: editor.draft.maxTokens,
                disabled: !writable,
                onChange: (event) => setEditor({ ...editor, draft: { ...editor.draft, maxTokens: event.target.value } }),
              }),
            ),
          ),
          h(
            'div',
            { className: 'ogcField' },
            h('span', { className: 'ogcMeta' }, t('reasoningLabel')),
            h(
              'label',
              { className: 'ogcCheck' },
              h('input', {
                type: 'checkbox',
                checked: editor.draft.reasoning,
                disabled: !writable,
                onChange: (event) => setEditor({ ...editor, draft: { ...editor.draft, reasoning: event.target.checked } }),
              }),
              t('reasoningHint'),
            ),
          ),
          h(
            'div',
            { className: 'ogcField' },
            h('span', { className: 'ogcMeta' }, t('inputLabel')),
            h(
              'div',
              { className: 'ogcRow' },
              MODALITIES.map((modality) =>
                h(
                  'label',
                  { className: 'ogcCheck', key: modality },
                  h('input', {
                    type: 'checkbox',
                    checked: editor.draft.input.includes(modality),
                    disabled: !writable,
                    onChange: (event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          input: event.target.checked
                            ? MODALITIES.filter((m) => m === modality || editor.draft.input.includes(m))
                            : editor.draft.input.filter((m) => m !== modality),
                        },
                      }),
                  }),
                  modality === 'image' ? t('inputImage') : t('inputText'),
                ),
              ),
            ),
            h('p', { className: 'ogcHint' }, t('inputHint')),
          ),
          h(
            'div',
            { className: 'ogcRow' },
            h(
              'button',
              {
                type: 'button',
                className: 'ogcAction',
                disabled: !writable,
                onClick: () =>
                  editField('models', {
                    models:
                      editor.index < 0
                        ? [...current.models, { ...editor.draft }]
                        : current.models.map((entry, position) =>
                            position === editor.index ? { ...editor.draft } : entry,
                          ),
                  }),
              },
              t('applyModel'),
            ),
            h(
              'button',
              { type: 'button', className: 'ogcAction', onClick: () => setEditor(undefined) },
              t('cancel'),
            ),
          ),
        )

      const modelsField = field(
        'models',
        t('modelsTitle'),
        t('modelsHint'),
        current.models.length === 0
          ? h('p', { className: 'ogcHint' }, t('modelsEmpty'))
          : h('ul', { className: 'ogcList' }, current.models.map(modelRow)),
        editor === undefined
          ? h(
              'div',
              { className: 'ogcRow' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ogcAction',
                  disabled: !writable || busy !== '',
                  onClick: () => setEditor({ index: -1, draft: emptyModelDraft() }),
                },
                t('addModel'),
              ),
            )
          : modelEditor(),
      )

      const messages = []
      if (!writable) messages.push(h('p', { className: 'ogcReadOnly', key: 'ro' }, t('readOnly')))
      if (plan.error !== undefined) messages.push(h('p', { className: 'ogcInvalid', key: 'err' }, plan.error))
      if (failure !== undefined) messages.push(h('p', { className: 'ogcFailed', key: 'fail' }, failure))
      if (notice !== undefined) {
        messages.push(h('p', { className: notice.kind === 'ok' ? 'ogcSaved' : 'ogcFailed', key: 'note' }, notice.text))
      }

      return h(
        'li',
        { className: open ? 'ogcCard ogcCardOpen' : 'ogcCard' },
        h(
          'button',
          {
            type: 'button',
            className: 'ogcHeader',
            'aria-expanded': open,
            'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
            onClick: () => setOpen(!open),
          },
          h(
            'span',
            { className: 'ogcHeadText' },
            h('span', { className: 'ogcName' }, t('title')),
            h('span', { className: 'ogcDescription' }, t('description')),
          ),
          dirty ? h(Tag, { tone: 'neutral', className: 'ogcPending' }, t('unsaved')) : null,
          h(Chevron, { className: open ? 'ogcChevron ogcChevronOpen' : 'ogcChevron' }),
        ),
        open
          ? h(
              'div',
              { className: 'ogcBody' },
              ...messages,
              keyField,
              field('apiRoot', t('endpointLabel'), t('endpointHint'), h('input', {
                className: 'ogcInput',
                type: 'text',
                value: current.apiRoot,
                disabled: !writable,
                'aria-label': t('endpointLabel'),
                onChange: (event) => editField('apiRoot', { apiRoot: event.target.value }),
              })),
              field('refreshIntervalMs', t('intervalLabel'), t('intervalHint'), h(
                'div',
                { className: 'ogcRow' },
                h('input', {
                  className: 'ogcInput',
                  style: { maxWidth: '120px' },
                  type: 'text',
                  inputMode: 'decimal',
                  value: current.hours,
                  disabled: !writable,
                  'aria-label': t('intervalLabel'),
                  onChange: (event) => editField('refreshIntervalMs', { hours: event.target.value }),
                }),
                h('span', { className: 'ogcMeta' }, t('hours')),
              )),
              catalogBlock,
              modelsField,
              h('p', { className: 'ogcHint' }, t('advancedHint')),
              h(
                'div',
                { className: 'ogcFooter' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ogcDiscard',
                    disabled: !dirty || busy !== '',
                    onClick: () => discard(),
                  },
                  t('discard'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ogcSave',
                    disabled: blocked || !dirty,
                    onClick: () => void save(),
                  },
                  busy === 'save' ? t('saving') : t('save'),
                ),
              ),
            )
          : null,
      )
    }

    /** Services this browser plugin waits for before it registers anything. */
    const inject = [
      'slots',
      'locale',
      'remote',
      'remote.credentials',
      'remote.llm',
      'settingsScope',
    ]

    /**
     * Register the card once its namespace is served.
     * @param ctx - browser root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'llm-opencode-go-ui: copy')
      ctx.effect(() => injectStyles(), 'llm-opencode-go-ui: stylesheet')
      const scope = ctx.settingsScope.bind({ namespace: NS })
      const credentials = createCredentialStore(ctx)
      const discover = async (request) => {
        const response = await ctx.remote.llm.discoverModels(NS, request)
        if (!response.ok) throw new Error(response.error?.message ?? 'llm/discoverModels failed')
        return response.value
      }
      ctx.effect(
        () =>
          ctx.remote.$on('credentials/reference-updated', (ref) => {
            if (ref === credentials.get().ref) credentials.reload()
          }),
        'llm-opencode-go-ui: credential invalidations',
      )
      // The slot is declared at runtime by the Plugins page, so registration
      // waits for the declaration rather than the plugin's activation order.
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NS,
            locale: NS,
            inject: () => ({ scope, credentials, discover }),
          },
          OpenCodeGoCard,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
