# ADR 0001：自己拥有 OpenCode Go 路由，而不是使用 pi-ai 内置的 provider

[English](0001-own-the-opencode-go-route.md) | 中文

## 状态

已接受 — 2026-09-10

## 背景

`@earendil-works/pi-ai` 已经附带了一个 `opencode-go` provider：它承载 Go 支持的三种线上协议（`openai-completions`、`openai-responses`、`anthropic-messages`），以及一份发布时已存在模型的固定目录。直接委托给它几乎不需要写代码 —— profile 声明一个 provider profile 即可。

有两个事实否决了这种做法。

**Go 要求每个会话的会话标识。** 它的客户端矩阵要求客户端提供稳定的 session id，以便路由请求并复用 prompt cache。缺少该标识的请求会被直接拒绝：

```
HTTP 400
{"error":{"type":"MissingSessionID","message":"Request is missing x-opencode-session and cannot be routed efficiently"}}
```

pi-ai 的 provider 不发送 `x-opencode-session`（该字符串在包中完全不出现），也没有任何配置字段可以加上它。harness 本身持有这个值 —— `GenerateOptions.sessionId`，在每次由 loop 构造的调用上写入 —— 但能把值附加到 provider 请求上的那层 seam 属于 adapter，而不是 profile。

**固定目录会过期。** Go 按自己的节奏增加模型。固定列表意味着新发布的模型在依赖升级之前无法选择，而上下文窗口或协议发生变化的模型在被升级之前描述有误。

## 决定

在本插件中、基于 harness 的 LLM seam 自己拥有这条路由：

- `LlmAdapter`（`lib/adapter.js`）注册 `opencode-go` 路由并构造逐请求选项，在强制的 attribution 头之下同时带上 `x-opencode-session` 与 harness 原生的 `x-deepseek-harness-session-id`。
- 线上协议仍由 pi-ai 承载。插件调用 `provider.streamSimple(model, context, { sessionId, … })`，而不是重新实现三种协议，因此协议行为仍归其所有者。
- 三层目录（`lib/catalog.js`）合并 pi-ai 固定模型、来自设置段的用户覆盖项，以及 `{apiRoot}/v1/models` 的线上刷新（经 models.dev 补全，`lib/refresh.js`）。加入新模型的刷新会重新宣告路由，使选择器重载。
- 配置与凭据都按 harness 的既有 seam 读取：`llm-opencode-go` 设置段叠加在 composition 行之上，以及逐请求的 `ctx.credentials.resolve(apiKeyEnv)`。

## 后果

- harness 对一等提供方期望的两项行为 —— 会话标识，以及目录变化后仍能应答 `resolveModel` 的路由 —— 由我们负责保持可用。`tests/adapter.smoke.mjs` 对两者都有断言。
- 插件拥有模型目录，因此必须处理自己无法描述的 id：未知 id 会按厂商前缀推断协议并注册，若推断有误可通过 `models:` 手工修正。
- 该路由可在 GUI 中配置：拥有设置命名空间也使该提供方有资格在 Settings → Plugins 下拥有卡片 —— 这是 pi-ai 的共享 provider profile 无法按部署提供的界面。
- 不使用传统的 `OPENCODE_API_KEY` 引用。导出的环境变量会遮蔽托管凭据存储，因此导出了另一个 OpenCode 密钥的 shell 会悄悄胜出；该路由固定使用 `OPENCODE_GO_API_KEY`。
