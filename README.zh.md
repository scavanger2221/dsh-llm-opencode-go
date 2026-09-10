# dsh-llm-opencode-go

[English](README.md) | 中文

把 OpenCode Go（`https://opencode.ai/docs/go/`）作为 DeepSeek Harness 的一等模型提供方。一条路由 —— `opencode-go` —— 提供 Go 订阅暴露的全部模型，每个模型使用它自己的协议，并且每个请求都带 Go 要求的会话标识；模型目录跟随线上端点。

包根入口公开 Cordis plugin contract 与 `OpenCodeGoAdapter`。同一 artifact 还导出 `./client`，在 Settings → Plugins 中提供 OpenCode Go 卡片。为什么自己拥有这条路由、而不是直接使用 pi-ai 内置的 `opencode-go` provider，记录在 [ADR 0001](docs/adr/0001-own-the-opencode-go-route.zh.md)。

## 为什么需要它

Go 有两件事是共享的 pi-ai adapter 无法提供的：

- **会话标识。** Go 的客户端矩阵要求每个会话有稳定的 session id，用于路由请求和复用 prompt cache；无法路由的请求会被拒绝并返回 `400 MissingSessionID`。harness 在每次由 loop 构造的调用上写入 `GenerateOptions.sessionId`，本 adapter 把它同时映射为 `x-opencode-session` 与 harness 原生的 `x-deepseek-harness-session-id`。
- **跟得上变化的目录。** 固定的 pi-ai 版本只描述它发布时已存在的模型。本插件在挂载时、按间隔、以及按需刷新 `{apiRoot}/v1/models`，把新 id 合并到固定目录之上并用 models.dev 补全元数据 —— 因此 Go 今天发布的模型无需任何编辑即可选择。

## 安装

需要 DeepSeek Harness 0.1.0-rc.6 或更高版本。直接从 GitHub 安装：

~~~sh
dsh plugin --profile web add github:scavanger2221/dsh-llm-opencode-go#v0.1.0
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

打开 **Settings → Plugins → OpenCode Go**。卡片通过 Harness credentials 服务把 API key 存到 `OPENCODE_GO_API_KEY` 之下；Host 不会把已存的明文返回给浏览器。卡片还可编辑端点、刷新间隔与模型覆盖项，并能向端点查询它当前提供的 id。

之所以由卡片提供这个提供方的编辑器：Settings → Models 页面只为自己拥有的两个命名空间（`llm-deepseek`、`llm-pi-ai`）提供编辑布局，部署自行加入的提供方在那里只显示为一行、没有编辑器。Plugins 页面按设置命名空间分发卡片，这正是仓库之外分发的插件所需要的。

## 配置

除密钥外的一切都是设置字段，由 `$DSH_HOME/settings.yaml` 的 `llm-opencode-go` 段叠加在 bundle 行之上：

~~~yaml
llm-opencode-go:
  apiRoot: https://opencode.ai/zen/go
  refreshIntervalMs: 3600000        # 每小时；0 表示关闭定时器
  refreshOnMount: true
  models:
    - id: some-new-model
      api: anthropic-messages       # openai-completions | openai-responses | anthropic-messages
      contextWindow: 262144
      maxTokens: 65536
      reasoning: true
      input: [text, image]
~~~

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
| `lib/convert.js` | Harness ↔ pi-ai 的消息、chunk 与 replay envelope 转换 |
| `lib/client.js` | 浏览器半边：Settings → Plugins 卡片 |
| `cordis.patch.yml` | `dsh plugin add` 激活的 bundle layer |

## 开发

Host 测试会 import harness 包，因此需要它们可被解析 —— 把 `node_modules` 符号链接指向 profile 级模块回退目录（它镜像已安装的 harness）：

~~~sh
ln -s "$DSH_HOME/profiles/node_modules" node_modules
pnpm test          # 或：node tests/adapter.smoke.mjs && node tests/card.smoke.mjs
~~~

`tests/adapter.smoke.mjs` 驱动一个假端点，断言线上请求（URL、会话头、attribution 头、凭据）、chunk 流、usage 映射、replay envelope、配置覆盖项与 `MISSING_CREDENTIAL` 路径。`tests/card.smoke.mjs` 在 stub 模块系统与 stub React 下加载真实的浏览器 bundle，断言卡片的折叠外壳、暂存编辑与保存负载。

## 许可证

MIT
