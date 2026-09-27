/**
 * OpenCode Go settings card (browser half of this package).
 *
 * Settings → Models declares two seats for plugins distributed outside the
 * harness repository: `settings.models.provider-card` (keyed by a provider row's
 * settings namespace) and `settings.models.footer` (ordered, after the provider
 * rows and the add controls). This card uses the **footer**: the provider-card
 * seat is unreachable for this route, because `llm-pi-ai` declares the whole
 * pi-ai provider catalog — `opencode-go` included — so the Models page dispatches
 * that row's seat with the `llm-pi-ai` namespace, while the host refuses a second
 * declaration of the same provider id (this plugin's). The footer seat needs no
 * directory row and therefore always renders.
 *
 * The card edits the `llm-opencode-go` namespace through the shared settings
 * scope, and manages the credential the route resolves (`apiKeyEnv`) through the
 * credentials remote — so the key lands in `$DSH_HOME/.credentials.yaml` and a
 * form write persists as a `config:` override on this plugin's row in the active
 * profile's `cordis.patch.yml`. That namespace is projected automatically from
 * the host entry's Config schema (keyed by the entry id), which is why nothing
 * here installs a section.
 *
 * Shape follows the shipped settings cards: a collapsible header naming the
 * provider, staged edits with one Save, an "unsaved" marker, and a footer that
 * discards. Staging is not decoration — every settings write is a durable,
 * revision-fenced document mutation, so committing per keystroke would turn one
 * edit into writes the user never asked for.
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
      primitives.IconChevronDownOutlineRegular ??
      primitives.IconChevronDownOutline14 ??
      ((props) => h('span', props, '▾'))
    const Tag =
      primitives.Tag ??
      ((props) => h('span', { className: props.className }, props.children))

    /** Settings namespace the provider plugin owns and serves. */
    const NS = 'llm-opencode-go'
    /** Default route id, used only for display and discovery requests. */
    const ROUTE = 'opencode-go'
    /**
     * The host's own plan-usage route (`lib/usage.js` owns the upstream endpoint,
     * the credential, and the request itself). Spelled out rather than imported:
     * the browser bundle may require the shell's static module table and this
     * package's own files, not the Node half.
     */
    const USAGE_ROUTE = '/api/opencode-go/usage'
    /** Credential reference assumed while the namespace has not answered yet. */
    const DEFAULT_KEY_REF = 'OPENCODE_GO_API_KEY'
    /** Protocols the adapter can carry. */
    const APIS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    /**
     * Draft value for "this override does not state the field": the host keeps
     * the built-in catalog's value (`mergeModel` only takes what the entry
     * carries). Stating every field instead would make one edited capacity
     * silently rewrite the protocol of an installed model.
     */
    const INHERIT = 'inherit'
    /** Draft values of the allowed-input field. */
    const INPUT_TEXT = 'text'
    const INPUT_BOTH = 'both'
    /** Draft values of the reasoning field. */
    const REASONING_ON = 'on'
    const REASONING_OFF = 'off'
    const HOUR_MS = 60 * 60 * 1000

    /** Every string this card renders, in the two locales DSH ships. */
    const en = {
      title: 'OpenCode Go',
      description: 'API key, endpoint, refresh policy, and per-model settings for the OpenCode Go provider.',
      expand: 'Show settings',
      collapse: 'Hide settings',
      unsaved: 'Unsaved',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      unavailable: 'This deployment does not serve the llm-opencode-go settings namespace.',
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
      modelsMeta: '{count} models',
      modelsMetaOverrides: '{count} overridden',
      modelsMetaDisabled: '{count} disabled',
      catalogSourceLocal: 'live catalog',
      catalogSourceEndpoint: 'endpoint',
      filterModels: 'Filter models…',
      modelsNoMatch: 'No model matches “{query}”.',
      factsContext: 'ctx',
      factsOutput: 'out',
      factsBoth: 'text + images',
      factsText: 'text',
      queryEndpoint: 'Query the endpoint',
      querying: 'Querying…',
      modelsTitle: 'Models',
      modelsHint: 'Override a model\u2019s facts, or disable it to take it out of the model picker. A field left on Inherit keeps following the built-in catalog.',
      modelsLoading: 'Reading the catalog…',
      modelsEmpty: 'The catalog advertises no model yet. Query the endpoint, or add one by ID.',
      addModel: 'Add a model by ID',
      editModel: 'Edit',
      deleteModel: 'Reset',
      deleteModelHint: 'Hand this model back to the built-in catalog.',
      disableModel: 'Disable',
      enableModel: 'Enable',
      disabledTag: 'Disabled',
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
      inputLabel: 'Allowed input',
      inputText: 'Text',
      inputBoth: 'Text + images',
      inheritApi: 'Same as the catalog',
      inheritUnset: 'Inherit from the catalog',
      reasoningOn: 'On',
      reasoningOff: 'Off',
      overrideTag: 'Override',
      editorAdd: 'Add a model',
      editorEdit: 'Override {id}',
      editorInherit: 'A field left on Inherit keeps the built-in catalog value; what you fill in becomes part of this override.',
      editorUnknown: 'The catalog does not list this ID, so this override states its protocol itself.',
      factsUnknown: 'unknown',
      idRequired: 'A model ID is required.',
      idDuplicate: 'Each model ID may appear once.',
      capacityInvalid: 'Capacities are positive counts like 131072, 256K, or 1M.',
      saved: 'Saved.',
      failed: 'Failed: {message}',
      usageTitle: 'Plan usage',
      usageHint: 'Go meters a subscription in three windows: 20% of a model\u2019s monthly allowance per 5 hours, 50% per week, the whole allowance per month.',
      usageLoading: 'Reading plan usage…',
      usageRetry: 'Refresh',
      usageRefreshing: 'Refreshing…',
      usageUpdated: 'Updated {time}',
      usageMissingKey: 'Add an API key to read plan usage.',
      usageUnavailable: 'This deployment does not serve the plan-usage route.',
      usageFailed: 'Could not read plan usage: {message}',
      usageUsed: '{percent}% used',
      usageWindowRolling: '5-hour window',
      usageWindowWeekly: 'Weekly',
      usageWindowMonthly: 'Monthly',
      usageResets: 'resets in {when}',
      usageResetsNow: 'resetting now',
      usageDays: '{count}d',
      usageHours: '{count}h',
      usageMinutes: '{count}m',
      usageLimited: 'Limited',
      advancedHint: 'Headers, session-header names, image budgets, timeouts, and the metadata source stay in this row\u2019s Config in the profile patch.',
    }
    const zh = {
      title: 'OpenCode Go',
      description: 'OpenCode Go 提供方的 API 密钥、端点、刷新策略与按模型的设置。',
      expand: '展开设置',
      collapse: '收起设置',
      unsaved: '未保存',
      save: '保存',
      saving: '保存中…',
      discard: '放弃',
      unavailable: '此部署没有提供 llm-opencode-go 设置命名空间。',
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
      modelsMeta: '{count} 个模型',
      modelsMetaOverrides: '{count} 个覆盖项',
      modelsMetaDisabled: '{count} 个已停用',
      catalogSourceLocal: '实时目录',
      catalogSourceEndpoint: '端点',
      filterModels: '筛选模型…',
      modelsNoMatch: '没有匹配「{query}」的模型。',
      factsContext: '上下文',
      factsOutput: '输出',
      factsBoth: '文本 + 图像',
      factsText: '文本',
      queryEndpoint: '查询端点',
      querying: '查询中…',
      modelsTitle: '模型',
      modelsHint: '覆盖某个模型的事实，或停用它以将其移出模型选择器。留作「继承」的字段继续跟随内置目录。',
      modelsLoading: '正在读取目录…',
      modelsEmpty: '目录暂未提供任何模型。可查询端点，或按 ID 添加。',
      addModel: '按 ID 添加模型',
      editModel: '编辑',
      deleteModel: '重置',
      deleteModelHint: '把该模型交还给内置目录。',
      disableModel: '停用',
      enableModel: '启用',
      disabledTag: '已停用',
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
      inputLabel: '允许的输入',
      inputText: '文本',
      inputBoth: '文本 + 图像',
      inheritApi: '与目录一致',
      inheritUnset: '继承自目录',
      reasoningOn: '开启',
      reasoningOff: '关闭',
      overrideTag: '覆盖项',
      editorAdd: '添加模型',
      editorEdit: '覆盖 {id}',
      editorInherit: '留作「继承」的字段保持内置目录的值；填写的内容会成为该覆盖项的一部分。',
      editorUnknown: '目录未列出该 ID，因此该覆盖项需自行指定协议。',
      factsUnknown: '未知',
      idRequired: '必须填写模型 ID。',
      idDuplicate: '每个模型 ID 只能出现一次。',
      capacityInvalid: '容量需为 131072、256K、1M 这样的正整数。',
      saved: '已保存。',
      failed: '失败：{message}',
      usageTitle: '套餐用量',
      usageHint: 'Go 以三个窗口计量订阅：每 5 小时为月度额度的 20%，每周 50%，每月 100%。',
      usageLoading: '正在读取套餐用量…',
      usageRetry: '刷新',
      usageRefreshing: '刷新中…',
      usageUpdated: '更新于 {time}',
      usageMissingKey: '配置 API 密钥后即可查看套餐用量。',
      usageUnavailable: '此部署未提供套餐用量路由。',
      usageFailed: '无法读取套餐用量：{message}',
      usageUsed: '已用 {percent}%',
      usageWindowRolling: '5 小时窗口',
      usageWindowWeekly: '每周',
      usageWindowMonthly: '每月',
      usageResets: '{when}后重置',
      usageResetsNow: '即将重置',
      usageDays: '{count} 天',
      usageHours: '{count} 小时',
      usageMinutes: '{count} 分钟',
      usageLimited: '已受限',
      advancedHint: '请求头、会话头名称、图像预算、超时与元数据来源仍位于 profile patch 中该行的 Config。',
    }

    /**
     * The card's stylesheet. The card is a page-level entry in the Models
     * settings footer, so it draws its own box like the shipped settings cards,
     * using the same theme aliases the Models page uses for its row cards.
     */
    const CSS = [
      '.ogcCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);list-style:none}',
      '.ogcHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:var(--dsw-radius-xl);align-items:center;gap:12px;padding:12px 14px;display:flex}',
      '.ogcHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.ogcHeadText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}',
      '.ogcName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1.5}',
      '.ogcDescription{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
      '.ogcChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.ogcChevronOpen{transform:rotate(180deg)}',
      '.ogcPending{flex:none}',
      '.ogcBody{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 14px;padding-top:2px;padding-bottom:4px}',
      '.ogcUnavailable{color:var(--dsw-alias-label-tertiary);margin:0;padding:12px 14px;font-size:12px;line-height:1.5}',
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
      '.ogcAction{appearance:none;font:inherit;font-size:12px;line-height:1.5;cursor:pointer;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:3px 9px;background:0 0;color:var(--dsw-alias-label-secondary)}',
      '.ogcAction:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.ogcAction:disabled{opacity:.4;cursor:default}',
      '.ogcHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.ogcInvalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}',
      '.ogcDot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}',
      '.ogcDotOn{background:var(--dsw-alias-state-success-primary)}',
      '.ogcDotOff{background:var(--dsw-alias-state-error-primary)}',
      '.ogcDotWarn{background:var(--dsw-alias-state-warn-primary)}',
      '.ogcList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}',
      '.ogcScroll{max-height:342px;overflow-y:auto;overscroll-behavior:contain}',
      '.ogcScroll::-webkit-scrollbar{width:8px}',
      '.ogcScroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px}',
      '.ogcScroll::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2)}',
      '.ogcScroll::-webkit-scrollbar-track{background:0 0}',
      '.ogcItem{display:flex;align-items:center;gap:10px;height:52px;flex:none;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;padding:0 10px}',
      '.ogcItemOff .ogcItemMain{opacity:.55}',
      '.ogcModels{flex-direction:column;gap:8px;display:flex}',
      '.ogcTools{align-items:center;gap:6px;flex-wrap:wrap;display:flex}',
      '.ogcFilter{flex:1;min-width:130px;height:30px}',
      '.ogcItemMain{flex:1;min-width:0;flex-direction:column;gap:1px;display:flex}',
      '.ogcItemTitle{align-items:center;gap:8px;min-width:0;display:flex}',
      '.ogcItemName{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:1.45;overflow:hidden}',
      '.ogcItemId{flex:none;font-size:11px}',
      '.ogcItemFacts{align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.6;display:flex;min-width:0;overflow:hidden;white-space:nowrap}',
      '.ogcFact+.ogcFact:before{content:"\\b7";color:var(--dsw-alias-label-dimmed);margin-right:6px}',
      '.ogcItemActions{align-items:center;gap:6px;flex:none;display:flex}',
      '.ogcEditor{gap:8px}',
      '.ogcEditor .ogcField{padding:0;border-top:0}',
      '.ogcMono{font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.ogcMeta{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.ogcGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}',
      // Plan usage: one row per metered window, the bar carrying the only color
      // the panel needs, so a spent window is visible before its number is read.
      '.ogcUsage{flex-direction:column;gap:10px;display:flex}',
      '.ogcUsageRow{flex-direction:column;gap:5px;display:flex}',
      '.ogcUsageHead{align-items:baseline;gap:8px;display:flex}',
      '.ogcUsageName{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;font-size:12px;line-height:1.5}',
      '.ogcUsageValue{color:var(--dsw-alias-label-primary);font-size:12px;font-variant-numeric:tabular-nums;line-height:1.5}',
      '.ogcUsageReset{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}',
      '.ogcUsageLimited{color:var(--dsw-alias-state-error-primary)}',
      '.ogcBar{background:var(--dsw-alias-bg-layer-3);border-radius:3px;height:6px;overflow:hidden}',
      '.ogcBarFill{background:var(--dsw-alias-brand-primary);border-radius:3px;height:100%;transition:width .2s}',
      '.ogcBarWarn{background:var(--dsw-alias-state-warn-primary)}',
      '.ogcBarFull{background:var(--dsw-alias-state-error-primary)}',
      '.ogcUsageFoot{align-items:flex-end;gap:8px;display:flex}',
      '.ogcUsageFoot .ogcHint{flex:1;margin:0}',
      '.ogcUsagePill{align-items:center;gap:6px;display:inline-flex;font-variant-numeric:tabular-nums}',
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

    /**
     * One capacity field as the staged list carries it: the count the text means,
     * so the list shows the value a request would use rather than the shorthand
     * that was typed. Text that means nothing is kept verbatim, so the save plan
     * reports it instead of silently dropping the user's entry.
     * @param text - the field's text.
     * @returns the normalized count, or the original text when it means none.
     */
    function countDraft(text) {
      const trimmed = String(text ?? '').trim()
      if (trimmed === '') return ''
      const parsed = parseCount(trimmed)
      return parsed === undefined ? text : String(parsed)
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

    /**
     * One model override in the shape the card edits. An absent field becomes
     * `INHERIT` rather than a guess, so re-applying an untouched override writes
     * back exactly what it carried.
     */
    function modelDraftOf(entry) {
      return {
        id: typeof entry?.id === 'string' ? entry.id : '',
        name: typeof entry?.name === 'string' ? entry.name : '',
        api: APIS.includes(entry?.api) ? entry.api : INHERIT,
        contextWindow: countText(entry?.contextWindow),
        maxTokens: countText(entry?.maxTokens),
        reasoning:
          entry?.reasoning === true ? REASONING_ON : entry?.reasoning === false ? REASONING_OFF : INHERIT,
        input: Array.isArray(entry?.input)
          ? entry.input.includes('image')
            ? INPUT_BOTH
            : INPUT_TEXT
          : INHERIT,
        disabled: entry?.disabled === true,
      }
    }

    /**
     * A draft that states nothing but the id. Switching one model off must not
     * drag a protocol or a capacity into the entry by accident.
     * @param id - the model id.
     * @returns an all-inherited draft.
     */
    function inheritedModelDraft(id) {
      return { ...emptyModelDraft(), id, api: INHERIT }
    }

    /**
     * A blank draft for a model the catalog does not list. Its protocol cannot be
     * inherited from an entry that does not exist, so one is chosen explicitly.
     */
    function emptyModelDraft() {
      return {
        id: '',
        name: '',
        api: APIS[0],
        contextWindow: '',
        maxTokens: '',
        reasoning: INHERIT,
        input: INHERIT,
        disabled: false,
      }
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
     * sections directly would report a difference for every inherited field.
     *
     * Every inherited field is left out of the entry: the catalog merge only takes
     * what the entry states, so an override that changes one capacity keeps the
     * installed protocol, reasoning flag, and modalities.
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
        ...(draft.api === INHERIT ? {} : { api: draft.api }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(draft.reasoning === INHERIT ? {} : { reasoning: draft.reasoning === REASONING_ON }),
        ...(draft.input === INHERIT
          ? {}
          : { input: draft.input === INPUT_BOTH ? ['text', 'image'] : ['text'] }),
        ...(draft.disabled === true ? { disabled: true } : {}),
      }
    }

    /**
     * Whether an entry carries nothing but its id, and is therefore not worth
     * writing: re-enabling a model that had no other override has to leave the
     * configuration as it was.
     * @param draft - the draft to test.
     * @returns whether the entry states anything beyond its id.
     */
    function isBareOverride(draft) {
      return Object.keys(canonicalModel({ ...draft, disabled: false })).length === 1
    }

    /** The canonical entries a stored section carries. */
    function canonicalStoredModels(value) {
      const models = Array.isArray(value?.models) ? value.models : []
      return models.map((entry) => canonicalModel(modelDraftOf(entry)))
    }

    /**
     * Whether two canonical entries say the same thing. The comparison is
     * field-by-field rather than textual: a hand-edited profile patch may spell
     * the same override with its keys in another order, and that is not a change
     * the card should stage a rewrite for.
     * @param left - one canonical entry.
     * @param right - the other canonical entry.
     * @returns whether every field matches.
     */
    function sameModel(left, right) {
      const fields = ['id', 'name', 'api', 'contextWindow', 'maxTokens', 'reasoning', 'input', 'disabled']
      return fields.every((field) => {
        const a = left?.[field]
        const b = right?.[field]
        if (field === 'input') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
        return (a ?? null) === (b ?? null)
      })
    }

    /** Whether two canonical model lists say the same thing. */
    function sameModels(left, right) {
      return left.length === right.length && left.every((entry, at) => sameModel(entry, right[at]))
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

    /**
     * Read the host's plan-usage route.
     *
     * This page never talks to OpenCode Go itself: the API key lives behind the
     * credential seam, so the host makes the one request that needs it and this
     * reads the host's own answer — `{ windows, fetchedAt }`, or
     * `{ error: { code, message } }` for anything it could not read. A host half
     * old enough to predate the route answers the page shell instead of JSON,
     * which is reported as `unavailable` rather than as a provider failure.
     * @returns the host's parsed reply.
     * @throws an Error carrying the host's `code` (or `unavailable`).
     */
    async function readPlanUsage() {
      const response = await fetch(USAGE_ROUTE, { headers: { accept: 'application/json' } })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const fail = (code, message) => {
        const error = new Error(message)
        error.code = code
        throw error
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        fail('unavailable', 'the plan-usage route answered no JSON')
      }
      if (payload.error !== undefined) {
        fail(
          typeof payload.error?.code === 'string' ? payload.error.code : 'failed',
          String(payload.error?.message ?? 'the plan-usage route reported a failure'),
        )
      }
      if (!Array.isArray(payload.windows)) {
        fail('unavailable', 'the plan-usage route reported no window')
      }
      return payload
    }

    /**
     * The card. Service props arrive from its own slot `inject`; the Models
     * footer dispatches no owner props, so its title comes from the namespace's
     * own resolved value (a deployment may rename the provider).
     */
    function OpenCodeGoCard(props) {
      const { scope, credentials, discover, t } = props
      const snap = useStore(scope, readScope)
      const cred = useStore(credentials, readStore)
      const value = snap.value ?? {}
      const writable = snap.writable === true
      const stored = projectSection(value)
      const base = projectSection(snap.base)
      // The namespace carries the deployment's display name; the locale copy is
      // the fallback while the section has not answered yet.
      const heading =
        typeof value.displayName === 'string' && value.displayName.length > 0
          ? value.displayName
          : t('title')
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
      /**
       * What the route currently serves, with the effective facts per model: the
       * plugin's own catalog first (which already carries the stored overrides),
       * then whatever a direct endpoint query adds.
       */
      const [catalog, setCatalog] = React.useState({ status: 'idle', models: [], source: 'local' })
      /** The list filter: an id or a display name. */
      const [filter, setFilter] = React.useState('')
      /** The model staged in the editor: which row it came from, and its draft. */
      const [editor, setEditor] = React.useState(undefined)
      /**
       * What OpenCode Go reports for the configured key: the three metered
       * windows, read on mount. Mounting already means someone opened the Models
       * page, so this is one read per visit plus one per explicit Refresh — never
       * a poll against the provider.
       */
      const [usage, setUsage] = React.useState({
        status: 'loading',
        windows: [],
        error: undefined,
        code: undefined,
        at: undefined,
      })
      /** Bumped to read the plan again; the effect below owns the request. */
      const [usageEpoch, setUsageEpoch] = React.useState(0)
      /**
       * Sequence of plan reads. Answers are matched to their question: a read
       * started earlier can resolve later — a slow first read beside a quick
       * Refresh — and only the newest question's answer may describe the plan.
       */
      const usageRead = React.useRef(0)
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
              setCatalog({
                status: 'ready',
                models: models.map((model) => ({ ...model, source: 'catalog' })),
                source: 'local',
              })
            }
          })
          .catch((error) => {
            if (!cancelled) {
              setCatalog({ status: 'error', models: [], source: 'local', error: String(error) })
            }
          })
        return () => {
          cancelled = true
        }
      }, [discover])
      /**
       * One plan-usage read per mount and per bump. A failure is kept as state,
       * not thrown: the card still has every setting it can edit, and the panel
       * says what could not be read rather than disappearing.
       */
      React.useEffect(() => {
        const read = usageRead.current + 1
        usageRead.current = read
        const settle = (next) => {
          if (usageRead.current === read && alive.current) setUsage(next)
        }
        readPlanUsage()
          .then((payload) => {
            settle({
              status: 'ready',
              windows: payload.windows,
              error: undefined,
              code: undefined,
              at: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : new Date().toISOString(),
            })
          })
          .catch((error) => {
            settle({
              status: 'error',
              windows: [],
              error: String(error?.message ?? error),
              code: typeof error?.code === 'string' ? error.code : 'failed',
              at: undefined,
            })
          })
      }, [usageEpoch])

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
        } else if (!sameModels(models, canonicalStoredModels(value))) {
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
          // A save may have replaced the key the plan was read with; the read
          // belongs to the key, so it is redone rather than left describing the
          // previous one.
          refreshUsage()
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

      /**
       * Read the plan again, keeping whatever was shown while the read is in
       * flight: a stale figure with "Refreshing…" beside it reads better than a
       * panel that empties itself on every refresh, and the same state serves a
       * first read that came back with nothing.
       */
      const refreshUsage = () => {
        setUsage((previous) => ({ ...previous, status: 'loading' }))
        setUsageEpoch((epoch) => epoch + 1)
      }

      /** Interrogate the endpoint itself, catching a model Go added today. */
      const queryEndpoint = async () => {
        setBusy('endpoint')
        setFailure(undefined)
        setNotice(undefined)
        try {
          const models = await discover({ provider: ROUTE, baseURL: stored.apiRoot })
          if (alive.current) {
            // The endpoint answers with ids alone, so a model the plugin's own
            // catalog describes keeps the facts the catalog already told us.
            const known = new Map(catalog.models.map((model) => [model.id, model]))
            setCatalog({
              status: 'ready',
              source: 'endpoint',
              models: models.map((model) => known.get(model.id) ?? { ...model, source: 'endpoint' }),
            })
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
        // Never render nothing. The namespace is missing exactly when the host
        // half is old, misconfigured, or has no volatile fields — the failure
        // mode that hid this card for a whole release — so say so instead of
        // disappearing: the Models footer shows the notice and nothing else
        // would tell the user a settings surface was supposed to be here.
        return h(
          'div',
          { className: 'ogcCard' },
          h('p', { className: 'ogcUnavailable' }, t('unavailable')),
        )
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
                  // Removing the key ends the plan read too; the panel then says
                  // that a key is what it is waiting for.
                  onClick: () =>
                    void runNow('unset', () => credentials.unset(keyRef), { kind: 'ok', text: t('saved') }).then(
                      () => {
                        if (alive.current) refreshUsage()
                      },
                    ),
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

      /** A capacity as a list reads it: `131072` is `128K`, `1000000` is `1M`. */
      const compactCount = (text) => {
        const value = Number(text)
        if (!Number.isFinite(value) || value <= 0) return String(text)
        if (value >= 1000000) return `${String(Math.round(value / 100000) / 10).replace(/\.0$/, '')}M`
        if (value >= 1024) return `${Math.round(value / 1024)}K`
        return String(value)
      }

      /** The same count for a tooltip, thousands separated. */
      const exactCount = (text) => {
        const value = Number(text)
        return Number.isFinite(value) && value > 0 ? value.toLocaleString('en-US') : String(text)
      }

      /** A capacity for display, or the word the card uses when it has none. */
      const factText = (value) =>
        typeof value === 'number' && value > 0 ? String(value) : t('factsUnknown')

      /**
       * One row per model this route describes: the catalog's models in catalog
       * order, then an override for an id the catalog does not describe. A row's
       * facts come from the override where it states them and from the catalog
       * everywhere else — which is exactly what the request will use.
       */
      const modelRows = (() => {
        const storedById = new Map(current.models.map((draft) => [draft.id.trim(), draft]))
        const rows = []
        const seen = new Set()
        for (const model of catalog.models) {
          rows.push({ id: model.id, advertised: model, stored: storedById.get(model.id) })
          seen.add(model.id)
        }
        for (const [id, stored] of storedById) {
          if (!seen.has(id)) rows.push({ id, advertised: undefined, stored })
        }
        return rows
      })()

      const overriddenCount = modelRows.filter((row) => row.stored !== undefined).length
      const disabledCount = modelRows.filter((row) => row.stored?.disabled === true).length

      /** What one row would send, as display strings. */
      const factsOf = (row) => {
        const draft = row.stored
        const stated = (field) => draft !== undefined && draft[field] !== undefined
        const modalities = () => {
          if (stated('input') && draft.input !== INHERIT) {
            return draft.input === INPUT_BOTH ? t('factsBoth') : t('factsText')
          }
          const advertised = row.advertised?.inputModalities
          if (!Array.isArray(advertised)) return t('factsUnknown')
          return advertised.includes('image') ? t('factsBoth') : t('factsText')
        }
        const statedCount = (field) => stated(field) && draft[field].trim() !== ''
        const context = statedCount('contextWindow')
          ? draft.contextWindow
          : row.advertised?.contextWindow === undefined
            ? undefined
            : String(row.advertised.contextWindow)
        const output = statedCount('maxTokens')
          ? draft.maxTokens
          : row.advertised?.maxTokens === undefined
            ? undefined
            : String(row.advertised.maxTokens)
        return {
          context: context === undefined ? undefined : compactCount(context),
          contextTitle: context === undefined ? undefined : exactCount(context),
          output: output === undefined ? undefined : compactCount(output),
          outputTitle: output === undefined ? undefined : exactCount(output),
          modalities: modalities(),
          // The catalog's protocol is not part of the discovery contract, so it is
          // shown only when this override states it.
          api: stated('api') && draft.api !== INHERIT ? draft.api : undefined,
        }
      }

      /**
       * Whether an override for this row may leave its protocol unstated: only a
       * model the plugin's own catalog describes has one to inherit. An id that
       * merely the endpoint advertises is synthesized from a template, so its
       * protocol has to be chosen here.
       */
      const canInherit = (row) => row.advertised !== undefined && row.advertised.source === 'catalog'

      /** The first of these that actually says something. */
      const firstName = (...candidates) =>
        candidates.find((value) => typeof value === 'string' && value !== '') ?? ''

      /** What a row is called: an override's name, else the catalog's, else its id. */
      const nameOf = (row) => firstName(row.stored?.name, row.advertised?.name, row.id)

      /** Whether one row answers the filter box. */
      const matchesFilter = (row, query) => {
        if (query === '') return true
        const needle = query.toLowerCase()
        return (
          row.id.toLowerCase().includes(needle) || nameOf(row).toLowerCase().includes(needle)
        )
      }

      /** One fact of a row, with its exact value in the tooltip. */
      const fact = (text, title, key) =>
        text === undefined
          ? null
          : h('span', { className: 'ogcFact', key, ...(title === undefined ? {} : { title }) }, text)

      /** One described model, with its effective facts and the actions on it. */
      const modelRow = (row, index) => {
        const facts = factsOf(row)
        const off = row.stored?.disabled === true
        const name = nameOf(row)
        return h(
          'li',
          { className: off ? 'ogcItem ogcItemOff' : 'ogcItem', key: `${row.id}#${index}` },
          h(
            'div',
            { className: 'ogcItemMain' },
            h(
              'div',
              { className: 'ogcItemTitle' },
              h('span', { className: 'ogcItemName', title: row.id }, name === '' ? t('idRequired') : name),
              name === '' || name.toLowerCase() === row.id.toLowerCase()
                ? null
                : h('span', { className: 'ogcMono ogcItemId' }, row.id),
              row.stored === undefined ? null : h(Tag, { tone: 'neutral' }, t('overrideTag')),
              off ? h(Tag, { tone: 'neutral' }, t('disabledTag')) : null,
            ),
            h(
              'div',
              { className: 'ogcItemFacts' },
              fact(facts.context === undefined ? t('factsUnknown') : `${facts.context} ${t('factsContext')}`, facts.contextTitle, 'ctx'),
              fact(facts.output === undefined ? t('factsUnknown') : `${facts.output} ${t('factsOutput')}`, facts.outputTitle, 'out'),
              fact(facts.modalities, undefined, 'in'),
              fact(facts.api, undefined, 'api'),
            ),
          ),
          h(
            'div',
            { className: 'ogcItemActions' },
            h(
              'button',
              {
                type: 'button',
                className: 'ogcAction',
                disabled: !writable || busy !== '',
                // Disabling states the flag and nothing else; enabling drops the
                // entry entirely when the flag was all it carried, so switching a
                // model off and back on leaves the configuration as it was.
                onClick: () => {
                  if (off) {
                    const enabled = { ...row.stored, disabled: false }
                    editField('models', {
                      models: isBareOverride(enabled)
                        ? current.models.filter((entry) => entry.id.trim() !== row.id)
                        : current.models.map((entry) =>
                            entry.id.trim() === row.id ? enabled : entry,
                          ),
                    })
                    return
                  }
                  const disabled = { ...(row.stored ?? inheritedModelDraft(row.id)), disabled: true }
                  editField('models', {
                    models:
                      row.stored === undefined
                        ? [...current.models, disabled]
                        : current.models.map((entry) =>
                            entry.id.trim() === row.id ? disabled : entry,
                          ),
                  })
                },
              },
              off ? t('enableModel') : t('disableModel'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ogcAction',
                disabled: !writable || busy !== '',
                onClick: () =>
                  setEditor({
                    advertised: row.advertised,
                    // The id names an existing row, so the form shows it locked.
                    locked: true,
                    draft:
                      row.stored === undefined
                        ? { ...emptyModelDraft(), id: row.id, api: canInherit(row) ? INHERIT : APIS[0] }
                        : { ...row.stored },
                  }),
              },
              t('editModel'),
            ),
            row.stored === undefined
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ogcAction',
                    title: t('deleteModelHint'),
                    disabled: !writable || busy !== '',
                    onClick: () =>
                      editField('models', {
                        models: current.models.filter((entry) => entry.id.trim() !== row.id),
                      }),
                  },
                  t('deleteModel'),
                ),
          ),
        )
      }

      /**
       * The staged form for one override. Every field starts on Inherit, so an
       * override states only what it means to change — the merge keeps the
       * catalog's protocol, reasoning flag, and modalities otherwise.
       */
      const modelEditor = () => {
        const advertised = editor.advertised
        const inheritable = canInherit(editor)
        const draftOf = (changes) => setEditor({ ...editor, draft: { ...editor.draft, ...changes } })
        const label = (text) => h('span', { className: 'ogcMeta' }, text)
        return h(
          'div',
          { className: 'ogcField ogcEditor', key: 'editor' },
          h(
            'div',
            { className: 'ogcRow' },
            h(
              'span',
              { className: 'ogcLabel' },
              editor.locked
                ? t('editorEdit').replace('{id}', editor.draft.id.trim())
                : t('editorAdd'),
            ),
          ),
          h(
            'div',
            { className: 'ogcGrid' },
            h(
              'label',
              { className: 'ogcField' },
              label(t('idLabel')),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                value: editor.draft.id,
                disabled: !writable || editor.locked,
                'aria-label': t('idLabel'),
                onChange: (event) => draftOf({ id: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'ogcField' },
              label(`${t('nameLabel')} (${t('nameHint')})`),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                value: editor.draft.name,
                placeholder: advertised?.name ?? editor.draft.id,
                disabled: !writable,
                'aria-label': t('nameLabel'),
                onChange: (event) => draftOf({ name: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'ogcField' },
              label(t('apiLabel')),
              h(
                'select',
                {
                  className: 'ogcInput ogcSelect',
                  value: editor.draft.api,
                  disabled: !writable,
                  'aria-label': t('apiLabel'),
                  onChange: (event) => draftOf({ api: event.target.value }),
                },
                (inheritable ? [INHERIT, ...APIS] : APIS).map((api) =>
                  h('option', { key: api, value: api }, api === INHERIT ? t('inheritApi') : api),
                ),
              ),
            ),
            h(
              'label',
              { className: 'ogcField' },
              label(t('contextLabel')),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                placeholder:
                  advertised?.contextWindow === undefined
                    ? t('capacityHint')
                    : String(advertised.contextWindow),
                value: editor.draft.contextWindow,
                disabled: !writable,
                'aria-label': t('contextLabel'),
                onChange: (event) => draftOf({ contextWindow: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'ogcField' },
              label(t('outputLabel')),
              h('input', {
                className: 'ogcInput',
                type: 'text',
                placeholder:
                  advertised?.maxTokens === undefined ? t('capacityHint') : String(advertised.maxTokens),
                value: editor.draft.maxTokens,
                disabled: !writable,
                'aria-label': t('outputLabel'),
                onChange: (event) => draftOf({ maxTokens: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'ogcField' },
              label(t('reasoningLabel')),
              h(
                'select',
                {
                  className: 'ogcInput ogcSelect',
                  value: editor.draft.reasoning,
                  disabled: !writable,
                  'aria-label': t('reasoningLabel'),
                  onChange: (event) => draftOf({ reasoning: event.target.value }),
                },
                [
                  [INHERIT, t('inheritUnset')],
                  [REASONING_ON, t('reasoningOn')],
                  [REASONING_OFF, t('reasoningOff')],
                ].map(([value, text]) => h('option', { key: value, value }, text)),
              ),
            ),
            h(
              'label',
              { className: 'ogcField' },
              label(t('inputLabel')),
              h(
                'select',
                {
                  className: 'ogcInput ogcSelect',
                  value: editor.draft.input,
                  disabled: !writable,
                  'aria-label': t('inputLabel'),
                  onChange: (event) => draftOf({ input: event.target.value }),
                },
                [
                  [INHERIT, t('inheritUnset')],
                  [INPUT_TEXT, t('inputText')],
                  [INPUT_BOTH, t('inputBoth')],
                ].map(([value, text]) => h('option', { key: value, value }, text)),
              ),
            ),
          ),
          h('p', { className: 'ogcHint' }, t(inheritable ? 'editorInherit' : 'editorUnknown')),
          h(
            'div',
            { className: 'ogcRow' },
            h(
              'button',
              {
                type: 'button',
                className: 'ogcAction',
                disabled: !writable,
                onClick: () => {
                  const id = editor.draft.id.trim()
                  if (id === '') {
                    setFailure(t('idRequired'))
                    return
                  }
                  const next = {
                    ...editor.draft,
                    id,
                    contextWindow: countDraft(editor.draft.contextWindow),
                    maxTokens: countDraft(editor.draft.maxTokens),
                  }
                  const at = current.models.findIndex((entry) => entry.id.trim() === id)
                  setFailure(undefined)
                  editField('models', {
                    models:
                      at < 0
                        ? [...current.models, next]
                        : current.models.map((entry, position) => (position === at ? next : entry)),
                  })
                  setEditor(undefined)
                },
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
      }

      /** The count line above the list: what is here, and where it came from. */
      const catalogMeta = [
        t('modelsMeta').replace('{count}', String(modelRows.length)),
        ...(overriddenCount === 0 ? [] : [t('modelsMetaOverrides').replace('{count}', String(overriddenCount))]),
        ...(disabledCount === 0 ? [] : [t('modelsMetaDisabled').replace('{count}', String(disabledCount))]),
        t(catalog.source === 'endpoint' ? 'catalogSourceEndpoint' : 'catalogSourceLocal'),
      ].join(' · ')

      const visibleRows = modelRows.filter((row) => matchesFilter(row, filter))

      const modelsField = field(
        'models',
        t('modelsTitle'),
        t('modelsHint'),
        h(
          'div',
          { className: 'ogcModels' },
          h('p', { className: 'ogcMeta' }, catalogMeta),
          editor === undefined
            ? h(
                'div',
                { className: 'ogcTools' },
                h('input', {
                  className: 'ogcInput ogcFilter',
                  type: 'search',
                  value: filter,
                  placeholder: t('filterModels'),
                  disabled: !writable,
                  'aria-label': t('filterModels'),
                  onChange: (event) => setFilter(event.target.value),
                }),
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
                      // Guarded here too, not only by `disabled`: a host without
                      // the field would refuse the write and show a raw error.
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
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ogcAction',
                    disabled: !writable || busy !== '',
                    onClick: () => setEditor({ advertised: undefined, locked: false, draft: emptyModelDraft() }),
                  },
                  t('addModel'),
                ),
              )
            : null,
          canRefresh ? null : h('p', { className: 'ogcHint' }, t('refreshRestart')),
          modelRows.length === 0
            ? h(
                'p',
                { className: 'ogcHint' },
                catalog.status === 'error' ? t('modelsEmpty') : t('modelsLoading'),
              )
            : visibleRows.length === 0
              ? h('p', { className: 'ogcHint' }, t('modelsNoMatch').replace('{query}', filter))
              : h('ul', { className: 'ogcList ogcScroll' }, visibleRows.map(modelRow)),
        ),
        editor === undefined ? null : modelEditor(),
      )

      /** The window names this card knows; one the endpoint adds later shows its key. */
      const windowLabel = (key) =>
        key === 'rolling'
          ? t('usageWindowRolling')
          : key === 'weekly'
            ? t('usageWindowWeekly')
            : key === 'monthly'
              ? t('usageWindowMonthly')
              : `${key.charAt(0).toUpperCase()}${key.slice(1)}`

      /**
       * How long one window has left, as separately localized parts, or undefined
       * when the endpoint did not say. The parts stay apart so the copy decides
       * their order and their unit words — "3d 4h" and "3 天 4 小时" both read as
       * a duration rather than as a translated English string.
       */
      const resetParts = (window) => {
        const at = Date.parse(String(window?.resetsAt ?? ''))
        if (!Number.isFinite(at)) return undefined
        const minutes = Math.max(0, Math.round((at - Date.now()) / 60000))
        if (minutes === 0) return []
        const days = Math.floor(minutes / 1440)
        const hours = Math.floor((minutes % 1440) / 60)
        return [
          days === 0 ? undefined : t('usageDays').replace('{count}', String(days)),
          hours === 0 ? undefined : t('usageHours').replace('{count}', String(hours)),
          minutes % 60 === 0 ? undefined : t('usageMinutes').replace('{count}', String(minutes % 60)),
        ].filter((part) => part !== undefined)
      }

      /** "resets in 3d 4h", "resetting now", or nothing when the endpoint is silent. */
      const resetText = (window) => {
        const parts = resetParts(window)
        if (parts === undefined) return undefined
        return parts.length === 0 ? t('usageResetsNow') : t('usageResets').replace('{when}', parts.join(' '))
      }

      /** What one window's fill says at a glance: comfortable, nearly spent, or spent. */
      const usageTone = (window) =>
        window.status !== 'ok' || window.percent >= 100 ? 'full' : window.percent >= 85 ? 'warn' : 'ok'

      /** One metered window: its name, the share used, when it resets, and the bar. */
      const usageRow = (window) => {
        const percent = Math.round(window.percent)
        const tone = usageTone(window)
        const reset = resetText(window)
        const label = windowLabel(window.key)
        const at = Date.parse(String(window.resetsAt ?? ''))
        return h(
          'div',
          { className: 'ogcUsageRow', key: window.key },
          h(
            'div',
            { className: 'ogcUsageHead' },
            h('span', { className: 'ogcUsageName' }, label),
            window.status === 'ok'
              ? null
              : h('span', { className: 'ogcUsageReset ogcUsageLimited' }, t('usageLimited')),
            h('span', { className: 'ogcUsageValue' }, t('usageUsed').replace('{percent}', String(percent))),
            reset === undefined
              ? null
              : h(
                  'span',
                  {
                    className: 'ogcUsageReset',
                    ...(Number.isFinite(at) ? { title: new Date(at).toLocaleString() } : {}),
                  },
                  reset,
                ),
          ),
          // The bar is the same three facts as a shape, so a window at its limit
          // is visible before its number is read.
          h(
            'div',
            {
              className: 'ogcBar',
              role: 'progressbar',
              'aria-label': label,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': percent,
            },
            h('div', {
              className:
                tone === 'ok'
                  ? 'ogcBarFill'
                  : tone === 'warn'
                    ? 'ogcBarFill ogcBarWarn'
                    : 'ogcBarFill ogcBarFull',
              style: { width: `${String(Math.min(100, Math.max(0, percent)))}%` },
            }),
          ),
        )
      }

      /** The most-used window: the one worth naming on the card's closed header. */
      const worstWindow =
        usage.status === 'ready' && usage.windows.length > 0
          ? usage.windows.reduce((worst, window) => (window.percent > worst.percent ? window : worst))
          : undefined

      const usagePill =
        worstWindow === undefined
          ? null
          : h(
              Tag,
              { tone: 'neutral', className: 'ogcUsagePill' },
              h('span', {
                className:
                  usageTone(worstWindow) === 'ok'
                    ? 'ogcDot ogcDotOn'
                    : usageTone(worstWindow) === 'warn'
                      ? 'ogcDot ogcDotWarn'
                      : 'ogcDot ogcDotOff',
              }),
              `${windowLabel(worstWindow.key)} ${String(Math.round(worstWindow.percent))}%`,
            )

      /** What the panel says when it has no window to draw: why, and what to do. */
      const usageNotice =
        usage.status === 'loading'
          ? h('p', { className: 'ogcHint' }, t('usageLoading'))
          : usage.status === 'error' && usage.code === 'missing-key'
            ? h('p', { className: 'ogcHint' }, t('usageMissingKey'))
            : h(
                'p',
                { className: usage.code === 'unavailable' ? 'ogcHint' : 'ogcInvalid' },
                usage.code === 'unavailable'
                  ? t('usageUnavailable')
                  : t('usageFailed').replace('{message}', usage.error ?? ''),
              )

      const usagePanel = h(
        'div',
        { className: 'ogcField', key: 'usage' },
        h(
          'div',
          { className: 'ogcFieldHead' },
          h('span', { className: 'ogcLabel' }, t('usageTitle')),
          usage.status === 'ready' && usage.at !== undefined
            ? h(
                'span',
                { className: 'ogcMeta' },
                t('usageUpdated').replace(
                  '{time}',
                  new Date(usage.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                ),
              )
            : null,
        ),
        usage.windows.length > 0 ? h('div', { className: 'ogcUsage' }, usage.windows.map(usageRow)) : usageNotice,
        h(
          'div',
          { className: 'ogcUsageFoot' },
          h('p', { className: 'ogcHint' }, t('usageHint')),
          // Without a key there is nothing to retry: the panel is waiting for the
          // field below, and saving it reads the plan again on its own.
          usage.code === 'missing-key'
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'ogcAction',
                  disabled: usage.status === 'loading',
                  onClick: () => refreshUsage(),
                },
                usage.status === 'loading' ? t('usageRefreshing') : t('usageRetry'),
              ),
        ),
      )

      const messages = []
      if (!writable) messages.push(h('p', { className: 'ogcReadOnly', key: 'ro' }, t('readOnly')))
      if (plan.error !== undefined) messages.push(h('p', { className: 'ogcInvalid', key: 'err' }, plan.error))
      if (failure !== undefined) messages.push(h('p', { className: 'ogcFailed', key: 'fail' }, failure))
      if (notice !== undefined) {
        messages.push(h('p', { className: notice.kind === 'ok' ? 'ogcSaved' : 'ogcFailed', key: 'note' }, notice.text))
      }

      return h(
        // A block, not a list item: the footer seat renders entries into the
        // Models page's own container.
        'div',
        { className: open ? 'ogcCard ogcCardOpen' : 'ogcCard' },
        h(
          'button',
          {
            type: 'button',
            className: 'ogcHeader',
            'aria-expanded': open,
            'aria-label': `${t(open ? 'collapse' : 'expand')}: ${heading}`,
            onClick: () => setOpen(!open),
          },
          h(
            'span',
            { className: 'ogcHeadText' },
            h('span', { className: 'ogcName' }, heading),
            h('span', { className: 'ogcDescription' }, t('description')),
          ),
          dirty ? h(Tag, { tone: 'neutral', className: 'ogcPending' }, t('unsaved')) : null,
          usagePill,
          h(Chevron, { className: open ? 'ogcChevron ogcChevronOpen' : 'ogcChevron' }),
        ),
        open
          ? h(
              'div',
              { className: 'ogcBody' },
              ...messages,
              // Status before settings: what the plan has left is the reason the
              // key below matters, and it is the one read-only block in the card.
              usagePanel,
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
      'configForms',
    ]

    /**
     * Register the card once its namespace is served.
     * @param ctx - browser root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'llm-opencode-go-ui: copy')
      ctx.effect(() => injectStyles(), 'llm-opencode-go-ui: stylesheet')
      const scope = ctx.configForms.get(NS)
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
      // The Models section declares this seat at runtime, so registration waits
      // for the declaration rather than the plugin's activation order. It is a
      // list seat: the id is this plugin's own, and the entry renders after the
      // provider rows and the add controls.
      ctx.slots.inject('settings.models.footer', () =>
        ctx.slots.register(
          {
            name: 'settings.models.footer',
            id: NS,
            order: 0,
            label: () => t('title'),
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
