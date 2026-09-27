# ADR 0004：保留路由所有权，镜像 pi-ai 的转换

[English](0004-mirror-pi-ai-conversion.md) | 中文

## Status

Accepted — 2026-09-27

修订 [ADR 0001](0001-own-the-opencode-go-route.zh.md)，后者仍然有效：路由依然由本插件拥有。本 ADR 记录这次重新审视的对象、委托方案的实际代价，以及现在约束这段重复实现的规则。

## Context

一个调用过 `read_image` 的会话再也无法继续：

```
OpenCode Go cannot represent an image in an in-history tool message
```

这个守卫是我们自己加的（`lib/convert.js`），而且比它抄来的那段实现更严格。在 0.1.7 的词汇表里，工具结果是一等消息 —— `{role: 'tool', content, toolCallId, isError}`（`dsh-llm/lib/types/message.d.ts`），而 `dsh-llm-pi-ai` 正是这样投影的（`toolResultOf`），只在既非 `user` 也非 `tool` 的角色上拒绝图片。我们的实现仍在寻找当前消息根本不会携带的 `tool-result` block，于是 `tool` 消息落进了 user 分支：文本被压平成 `user` 轮次、`toolCallId` 被丢弃，其中的图片又触发了更严格的守卫。同一原因造成两个缺陷，其中一个还是静默的：对一段由别人拥有、且持续演进的接缝做手工维护的副本。

最自然的回应是干脆不再拥有这段接缝 —— 把路由委托给随发行版提供的 `llm-pi-ai` 适配器。这条路看起来完全可行：

- **pi-ai 其实能发送会话头。** ADR 0001 记录过它从不发送 `x-opencode-session`（属实 —— 该字符串在整个包里都不存在），也没有任何配置项能加上它。但 Go 还接受另一个名字：`compat.sendSessionAffinityHeaders: true` 会让 pi-ai 发出 `x-session-affinity: <sessionId>`，而 Go 对此返回 `200`，完全不带会话头的请求则被 `400 MissingSessionID` 拒绝。两个方向都对线上端点验证过。
- **Go 的 chat-completions 端点是超集。** 固定目录标为 `anthropic-messages` 的模型在 `/v1/chat/completions` 上同样可用，所以一个声明的 provider 几乎能覆盖全部。只有真正只支持 responses 的模型会拒绝（`400 ModelProtocolUnsupported`）。

无法转换的部分不在 pi-ai 本身，而在 `llm-pi-ai` 的配置 schema：

- **provider profile 的 `api` 与 `baseURL` 是按 *路由* 而非按模型设置的。** `resolveRouteModels` 解析 `api = request.api ?? base?.api ?? routeApi` 与 `baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl`，而 `models:` 列表会 *替换* 被服务的目录 —— 作为增量旋钮的 `modelOverrides` 拒绝固定目录未描述的 id，也拒绝与 `models:` 列表并用。于是服务 Go 线上模型的路由无法保留逐模型协议：它只能退化成「每个协议族一条路由」。
- **固定目录并不描述在用模型。** 六个启用模型（`deepseek-v4.1-flash`、`mimo-v2.6-*`、`space-bunny-free`、`longcat-2.5-preview-free`、`gpt-6-luna`）全都不在 `getBuiltinModels('opencode-go')` 里 —— 而这正是本插件存在的全部理由。委托意味着把模型清单搬进另一个插件的行：卡片得去写那里的 `providers.opencode-go.*`（宿主侧的接缝确实存在 —— `settings.mutate(ns, ops, revision)` 按命名空间寻址，且 `providers` 是 volatile —— 但配置面、禁用标记与实时刷新都要易主）。
- **我们要复用的那段接缝无法 import。** `dsh-llm-pi-ai` 只导出 `Config`、`PiAiAdapter`、`apply`、`inject`、`name`、`recordKeyFor`、`supportedProtocols` —— 没有上下文转换；其 `exports` 里的 `./src/*` 子路径指向已发布包并未附带的源码。改为包装 `PiAiAdapter`，则意味着复刻它内部的 profile 对象（`piProvider`、`resolveProfiles`、auth context）—— 同样是抄写，只是更难被发现。

## Decision

按 ADR 0001 的决定继续拥有路由，并把 `lib/convert.js` 中的 harness↔pi-ai 接缝视为 **`dsh-llm-pi-ai` 转换的镜像**，而不是一套独立实现：

- 历史拒绝规则完全相同的三条（`developer` 消息、tool-change block、`user`/`tool` 之外的图片），`deferLoading` 工具被拒绝，`tool` 消息投影为 pi-ai 的 `toolResult`，`userContent` 以同样的「全文本折叠」处理文本与图片，收集请求图片时跳过已 offload 的条目，stop/usage/error 映射遵循同一张表。
- 有三处有意保留为本插件所有，并在模块头部写明：以路由命名的错误文案、`PROVIDER_ERROR` 兜底码，以及 replay envelope —— 后者始终是在持久内容之上的补充，而非替代。
- 镜像是一条契约，不是习惯。`AGENTS.md` 要求在 harness 或 pi-ai 升级时，将 `dsh-llm-pi-ai/lib/index.js` 的 context 区段与 `lib/convert.js` 重新比对；`tests/adapter.smoke.mjs` 固定由此得到的规则：工具结果以 `tool` 消息上线、历史中的工具图片可重放、以及每一条拒绝。
- 只有当 pi-ai 获得逐模型的协议/baseURL 配置，或动态逐请求头接缝时，才重新讨论委托 —— 那时上述论据不再成立，而 ADR 0001 拥有路由的两条理由都已在上游得到满足。

## Consequences

- 重复实现保留，随之而来的维护义务也保留。任何触及上下文转换的 harness 或 pi-ai 变更，都是一次 *此处* 的变更，而重新比对是必需步骤而非建议。
- 路由保住了委托会失去的一切：直接来自线上目录的逐模型协议、作为配置事实的 `disabled`、实时刷新，以及无需任何部署迁移的模型字符串（如 `opencode-go/deepseek-v4.1-flash`）。
- 会话头继续由本插件负责：`x-opencode-session` 与 harness 原生的 `x-deepseek-harness-session-id`，在强制归属头之下，按 `GenerateOptions.sessionId` 逐请求发出。
- 上述发现已记录在下一个接手者会看的地方：Go 接受 `x-session-affinity`、其 completions 端点能服务固定目录标为 anthropic 的模型、pi-ai profile 无法表达逐模型协议，以及固定目录并不包含本部署在用的模型。
