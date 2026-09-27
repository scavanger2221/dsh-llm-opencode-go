# dsh-llm-opencode-go

[English](README.md) | 中文

把 OpenCode Go（`https://opencode.ai/docs/go/`）作为 DeepSeek Harness 的一等模型提供方。一条路由 —— `opencode-go` —— 提供 Go 订阅暴露的全部模型，每个模型使用它自己的协议，并且每个请求都带 Go 要求的会话标识；模型目录跟随线上端点。

包根入口公开 Cordis plugin contract 与 `OpenCodeGoAdapter`。同一 artifact 还导出 `./client`，把 OpenCode Go 设置卡片挂到 Settings → Models 页面的底部。为什么自己拥有这条路由、而不是直接使用 pi-ai 内置的 `opencode-go` provider，记录在 [ADR 0001](docs/adr/0001-own-the-opencode-go-route.zh.md)；为什么卡片在 Models 页面而不是 Plugins 页面，记录在 [ADR 0002](docs/adr/0002-model-provider-settings-on-the-models-page.zh.md)；这条路由的 harness ↔ pi-ai 转换如何保持诚实 —— 作为 `dsh-llm-pi-ai` 自身实现的镜像、并在每次升级时重新比对 —— 记录在 [ADR 0004](docs/adr/0004-mirror-pi-ai-conversion.zh.md)。

## 为什么需要它

Go 有两件事是共享的 pi-ai adapter 无法提供的：

- **会话标识。** Go 的客户端矩阵要求每个会话有稳定的 session id，用于路由请求和复用 prompt cache；无法路由的请求会被拒绝并返回 `400 MissingSessionID`。harness 在每次由 loop 构造的调用上写入 `GenerateOptions.sessionId`，本 adapter 把它同时映射为 `x-opencode-session` 与 harness 原生的 `x-deepseek-harness-session-id`。
- **跟得上变化的目录。** 固定的 pi-ai 版本只描述它发布时已存在的模型。本插件在挂载时、按间隔、以及按需刷新 `{apiRoot}/v1/models`，把新 id 合并到固定目录之上并用 models.dev 补全元数据 —— 因此 Go 今天发布的模型无需任何编辑即可选择。

## 安装

需要 DeepSeek Harness 0.1.0-rc.6 或更高版本。直接从 GitHub 安装：

~~~sh
dsh plugin --profile web add github:scavanger2221/dsh-llm-opencode-go#v0.1.3
dsh web
~~~

仓库跟踪可直接发布的 `lib/` 产物且没有构建步骤，因此从 GitHub 安装不需要 build-script 白名单。`dsh plugin add` 同时会激活本包的 bundle layer —— profile 从 `cordis.patch.yml` 获得这一行，无需手工编辑：

~~~yaml
- id: llm-opencode-go
  name: 'dsh-llm-opencode-go'
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    refreshOnMount: true
    refreshIntervalMs: 21600000
~~~

### 从本地 checkout 安装

源码 checkout 不能就地 link：Node 会把符号链接的包解析到真实路径，于是插件内部的 import 从 checkout 向上查找而非 profile，报错 `Cannot find package '@earendil-works/pi-ai'`。正确做法是把 checkout 复制进 profile 目录树 —— `scripts/install-local.sh` 正是这样做的，并重新注册依赖：

~~~sh
git clone https://github.com/scavanger2221/dsh-llm-opencode-go
cd dsh-llm-opencode-go
./scripts/install-local.sh          # 复制到 $DSH_HOME/profiles/web/plugins
dsh web
~~~

## Web 配置

打开 **Settings → Models**：卡片位于页面底部，在提供方行与添加按钮之后。它通过 Harness credentials 服务把 API key 存到 `OPENCODE_GO_API_KEY` 之下（Host 不会把已存的明文返回给浏览器），可编辑端点与刷新间隔，并列出该路由提供的每一个模型及其请求实际使用的事实，还能向端点查询它当前提供的 id。

列表以每个模型的显示名开头，并以紧凑的一行陈述其事实（`1M ctx · 128K out · text + images`，精确数值在 tooltip 中）；筛选框可按 id 或名称过滤，上方的计数行说明列表内容与来源（`27 models · 1 disabled · live catalog`），端点查询与目录刷新与该行放在一起。

列表中的每个模型都可单独编辑。编辑时表单的每个字段都从 **继承（Inherit）** 开始，因此覆盖项只声明它要改动的部分：把某个模型的上下文窗口设为 `256K`，它的协议、推理开关与允许的输入仍完全按目录所述。列表显示每个模型的实际生效值、标出带覆盖项的条目，并提供 **移除覆盖项** 把它交还给目录。目录未描述的模型（端点提供、但固定 pi-ai 版本尚未收录的 id）按 ID 添加，此时必须显式指定协议，因为没有可继承的来源。这种覆盖项形态、以及为什么编辑器不得臆造自己读不到的字段，记录在 [ADR 0003](docs/adr/0003-per-model-overrides-that-state-only-what-changes.zh.md)。

**停用**会把模型移出目录，但不会丢掉描述它的信息：该行仍在（变暗并标记为 *已停用*，仍显示各项事实），而模型选择器不再提供它，指名它的请求会直接失败并给出说明，而不是照常发出。**启用**可将其恢复；若该条目只带了这一个标记，启用会直接删掉它。目录刷新不会让已停用的模型复活。若某个会话或 agent 的默认模型已经指名了你停用的模型，那些请求会以该说明失败 —— 请另选模型或重新启用。

卡片使用 `settings.models.footer` 插槽。该页面另一个扩展插槽 `settings.models.provider-card` 按其所在提供方行的设置命名空间分发 —— 但对这条路由它不可达：`llm-pi-ai` 声明了整份 pi-ai 提供方目录（其中包含 `opencode-go`），因此那一行以 `llm-pi-ai` 命名空间分发，而 Host 会拒绝同一提供方 id 的第二次声明。footer 插槽不需要目录行，因此始终渲染。

更早的部署把这张卡片放在 **Settings → Plugins**；在 0.1.7 上该分区是只读的已安装插件清单，它使用的座位（`settings.plugin.item`）已无人声明。

## 配置

除密钥外的一切都是该插件自身行上的设置字段。卡片通过 settings 服务写入，每次编辑都会作为 `config:` 覆盖持久化到当前 profile patch（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）中的该行，因此手工编辑那里就是同一份文档：

~~~yaml
llm-opencode-go:
  apiRoot: https://opencode.ai/zen/go
  refreshIntervalMs: 3600000        # 每小时；0 表示关闭定时器
  refreshOnMount: true
  models:
    # 只声明要修正的容量：该模型的协议、推理开关与允许输入仍由固定目录提供。
    - id: glm-5.3
      contextWindow: 262144
    # 目录未描述的模型：必须显式指定协议。
    - id: some-new-model
      api: anthropic-messages       # openai-completions | openai-responses | anthropic-messages
      maxTokens: 65536
      reasoning: true
      input: [text, image]
    # 把某个模型移出目录。它仍被描述 —— 设置列表仍会显示它 —— 但选择器不再提供它。
    - id: some-model-you-do-not-want
      disabled: true
~~~

除 `id` 外每个字段都是可选的，且条目只覆盖它声明的字段 —— 只写 `id: glm-5.3` 等于不做任何改动；卡片的按模型表单正是因此可以只改一个字段就安全应用。

> **0.1.7 上没有可编辑的 `settings.yaml`。** Harness 已把每行的设置移入 profile 组合，并把旧文件一次性导入后留在 `$DSH_HOME/settings.yaml.imported`，不再读取。该行的现役文档就是上面 profile patch 中的 `config:` 段（或写入它的卡片）。

`input` 会被强制执行：模型未列出 `image` 时，携带图像的提示会在请求发出前以 `UNSUPPORTED_CONTENT` 被拒绝。`reasoning: false` 会隐藏该模型的 harness 思考等级。

密钥不是设置字段 —— 机密通过 credentials 服务存储，位于 `$DSH_HOME/.credentials.yaml`：

~~~yaml
refs:
  OPENCODE_GO_API_KEY: sk-...
~~~

该引用刻意避开传统的 `OPENCODE_API_KEY`：导出的环境变量会遮蔽托管存储，因此一个导出了另一个 OpenCode 密钥的 shell 会悄悄胜出。

> **Shell 导出警告。** 如果 shell 导出了 `OPENCODE_GO_API_KEY`，它会胜过托管存储，卡片的 API key 字段会显示为只读。请取消该导出，或把 `apiKeyEnv` 指向没有导出的引用。

## 模型目录

| 触发方式 | 时机 |
|---|---|
| 挂载 | `refreshOnMount: true`（默认） |
| 间隔 | 每 `refreshIntervalMs`（默认 6 小时，`0` 关闭） |
| 命令 | 聊天中的 `/opencode-refresh` |
| GUI | 卡片里的「Refresh catalog now」 |
| 任何设置写入 | 插件会重新同步并重新读取目录 |

刷新若加入新模型，会重新宣告路由，因此选择器的 `llm/adapters-updated` 监听会重载，新模型无需重启即可出现。Go 提供、但固定目录与 models.dev 都未描述的 id 仍会注册，协议按厂商前缀推断；上方段落中的 `models:` 可手工修正或补充任意条目。

## 结构

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 插件入口：配置 schema、凭据解析、路由注册、刷新调度、`/opencode-refresh`、会话头构造 |
| `lib/adapter.js` | `LlmAdapter`：模型描述、推理等级、经 pi-ai 的逐请求分发 |
| `lib/catalog.js` | 三层模型目录：pi-ai 固定目录、配置条目、线上刷新叠加 |
| `lib/refresh.js` | `GET {apiRoot}/v1/models` 与 models.dev 补全 |
| `lib/convert.js` | Harness ↔ pi-ai 的消息、chunk 与 replay envelope 转换：镜像 `dsh-llm-pi-ai` 自身的转换，仅额外包含路由命名的错误与 replay envelope |
| `lib/client.js` | 浏览器半边：Models 设置页面底部的卡片，含按模型编辑器 |
| `cordis.patch.yml` | `dsh plugin add` 激活的 bundle layer |

## 开发

无需安装任何东西：`lib/` 就是源码。测试针对已安装副本运行，因为 host 半边会 import harness 包，而这些包通过 profile 的模块回退目录解析：

~~~sh
cd "$DSH_HOME/profiles/web/plugins/dsh-llm-opencode-go"   # 安装之后
node tests/adapter.smoke.mjs && node tests/host.smoke.mjs && node tests/card.smoke.mjs
~~~

把 checkout 放在 profile 目录树内（例如 `$PROFILE/plugins/`）即可就地运行。**不要**把 `node_modules` 链接到 profile 的模块回退目录来让 profile 之外的 checkout 工作：pnpm 会跟随该链接并重写所有 profile 共享的回退目录。

`tests/adapter.smoke.mjs` 驱动一个假端点，断言线上请求（URL、会话头、attribution 头、凭据）、chunk 流、usage 映射、replay envelope、配置覆盖项（含「部分覆盖保留已装协议、推理开关与模态」）与 `MISSING_CREDENTIAL` 路径。`tests/host.smoke.mjs` 把插件挂载到 stub Cordis context，断言路由注册以及 Models 页面构建提供方行所依赖的 configurable-provider 目录条目。`tests/card.smoke.mjs` 在 stub 模块系统与 stub React 下加载真实的浏览器 bundle，断言卡片的注册位置、折叠外壳、按模型列表与「继承 vs 声明」编辑器、暂存编辑，以及精确的保存负载（包括继承字段不出现在覆盖项中）。

## 许可证

MIT
